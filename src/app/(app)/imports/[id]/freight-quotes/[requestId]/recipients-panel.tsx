'use client'

import { useActionState, useState } from 'react'
import { Button, Card, CardHeader, CardTitle, Input } from '@/components/ui'
import { renderTemplate } from '@/lib/email-template'
import type { FreightQuoteRecipient, FreightQuoteRequestSummary } from '@/lib/types'
import { formatDate } from '@/lib/utils'
import { RecipientChip } from '../freight-ui'
import {
  addRecipient,
  markRecipientSent,
  recordReminder,
  revokeRecipient,
  sendWhatsApp,
  sendWhatsAppToAllPending,
  type ActionResult,
} from '../actions'

export interface RecipientSendState {
  destinationMasked: string | null
  status: string | null
  sentAt: string | null
  deliveredAt: string | null
  readAt: string | null
  failureReason: string | null
}

/**
 * What the provider has told us about one message.
 *
 * Only the states the provider actually reports are drawn. Meta reports read
 * receipts only when the recipient has them switched on, so an absent Read is
 * not a failure and is simply not shown.
 */
function DeliveryTrail({ state }: { state: RecipientSendState }) {
  if (!state.status || state.status === 'PENDING') return null

  if (state.status === 'FAILED') {
    return (
      <span className="text-critical" title={state.failureReason ?? undefined}>
        WhatsApp failed{state.failureReason ? ` — ${state.failureReason}` : ''}
      </span>
    )
  }

  const marks = [
    ['Sent', state.sentAt],
    ['Delivered', state.deliveredAt],
    ['Read', state.readAt],
  ].filter(([, at]) => at) as Array<[string, string]>

  if (marks.length === 0) return null

  return (
    <span className="text-done">
      {marks.map(([label]) => `${label} ✓`).join('  ')}
      <span className="ml-1 text-ink-faint">{timeOf(marks[marks.length - 1][1])}</span>
    </span>
  )
}

/** Copy to clipboard with a moment of confirmation, since nothing else moves. */
function useCopy() {
  const [copied, setCopied] = useState<string | null>(null)

  async function copy(key: string, text: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(key)
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1800)
    } catch {
      // Clipboard permission can be refused; the reveal panel is the fallback.
    }
  }

  return { copied, copy }
}

function timeOf(iso: string) {
  return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
}

function AddRecipient({
  importId,
  requestId,
  onDone,
}: {
  importId: string
  requestId: string
  onDone: () => void
}) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    async (prev, formData) => {
      const result = await addRecipient(prev, formData)
      if (result.ok) onDone()
      return result
    },
    null,
  )

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2 border-t bg-surface-sunken p-3">
      <input type="hidden" name="quote_request_id" value={requestId} />
      <input type="hidden" name="import_id" value={importId} />

      <label className="block">
        <span className="mb-1 block text-ink-muted">Company name</span>
        <Input name="recipient_name" required autoFocus className="w-56" />
      </label>

      <Button type="submit" variant="primary" disabled={pending}>
        {pending ? 'Adding…' : 'Add & generate link'}
      </Button>
      <Button type="button" onClick={onDone} disabled={pending}>
        Cancel
      </Button>

      {state?.error && <span className="text-critical">{state.error}</span>}
    </form>
  )
}

/**
 * Sending one recipient their link over WhatsApp.
 *
 * Always a two-step press. A send costs money and cannot be recalled, so the
 * masked number is shown and confirmed before anything leaves the server.
 * Nothing here replaces Copy link / Copy message — those stay available on
 * every row, including when sending is not configured at all.
 */
function SendControls({
  recipient,
  importId,
  state,
}: {
  recipient: FreightQuoteRecipient
  importId: string
  state: RecipientSendState | undefined
}) {
  const [confirming, setConfirming] = useState(false)
  const [result, formAction, pending] = useActionState<ActionResult | null, FormData>(
    async (prev, formData) => {
      const outcome = await sendWhatsApp(prev, formData)
      if (outcome.ok) setConfirming(false)
      return outcome
    },
    null,
  )

  if (!state?.destinationMasked) {
    return (
      <span className="text-ink-faint" title="Add a WhatsApp number to this company to send from here">
        No WhatsApp number
      </span>
    )
  }

  const sentAlready = state.status !== null && !['PENDING', 'FAILED'].includes(state.status)
  const label = sentAlready ? 'Resend' : state.status === 'FAILED' ? 'Retry send' : 'Send WhatsApp'

  if (confirming) {
    return (
      <form action={formAction} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="id" value={recipient.id} />
        <input type="hidden" name="import_id" value={importId} />
        {sentAlready && <input type="hidden" name="resend" value="on" />}
        <span className="text-ink-muted">
          {sentAlready ? 'Send again to' : 'Send to'} {state.destinationMasked}?
        </span>
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? 'Sending…' : 'Yes, send'}
        </Button>
        <Button type="button" onClick={() => setConfirming(false)} disabled={pending}>
          Cancel
        </Button>
        {result?.error && <span className="text-critical">{result.error}</span>}
      </form>
    )
  }

  return (
    <Button variant={sentAlready ? 'ghost' : 'primary'} onClick={() => setConfirming(true)}>
      {label}
    </Button>
  )
}

/**
 * Send to everyone still waiting.
 *
 * The confirmation names every company that will be messaged and, separately,
 * every company that will not be — so a missing number is noticed here rather
 * than discovered days later when one CHA never replied.
 */
function BulkSend({
  importId,
  requestId,
  ready,
  missing,
}: {
  importId: string
  requestId: string
  ready: FreightQuoteRecipient[]
  missing: FreightQuoteRecipient[]
}) {
  const [open, setOpen] = useState(false)
  const [result, formAction, pending] = useActionState<ActionResult | null, FormData>(
    async (prev, formData) => {
      const outcome = await sendWhatsAppToAllPending(prev, formData)
      if (outcome.ok) setOpen(false)
      return outcome
    },
    null,
  )

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)} disabled={ready.length === 0}>
        Send to all pending ({ready.length})
      </Button>
    )
  }

  return (
    <form action={formAction} className="w-full rounded-lg border border-border-strong bg-surface-sunken p-3">
      <input type="hidden" name="quote_request_id" value={requestId} />
      <input type="hidden" name="import_id" value={importId} />
      <input type="hidden" name="confirm" value="on" />

      <p className="font-medium">
        Send the quote link to {ready.length} compan{ready.length === 1 ? 'y' : 'ies'}?
      </p>
      <p className="mt-0.5 text-ink-muted">{ready.map((r) => r.recipient_name).join(', ')}</p>

      {missing.length > 0 && (
        <p className="mt-2 text-ink-muted">
          Not included — no WhatsApp number: {missing.map((r) => r.recipient_name).join(', ')}. Copy
          their link by hand.
        </p>
      )}

      <p className="mt-2 text-ink-faint">
        Each message is a billed WhatsApp template message. The PI and packing list are not sent —
        share those yourself, as usual.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? 'Sending…' : `Yes, send ${ready.length}`}
        </Button>
        <Button type="button" onClick={() => setOpen(false)} disabled={pending}>
          Cancel
        </Button>
        {result?.error && <span className="text-critical">{result.error}</span>}
      </div>
    </form>
  )
}

function RowActions({
  recipient,
  importId,
  link,
  message,
  copied,
  copy,
  sendState,
  canSendHere,
}: {
  recipient: FreightQuoteRecipient
  importId: string
  link: string
  message: string
  copied: string | null
  copy: (key: string, text: string) => void
  sendState: RecipientSendState | undefined
  /** Sending is both configured on this deployment and allowed for this user. */
  canSendHere: boolean
}) {
  const [, sentAction] = useActionState<ActionResult | null, FormData>(markRecipientSent, null)
  const [, remindAction, remindPending] = useActionState<ActionResult | null, FormData>(
    recordReminder,
    null,
  )
  const [, revokeAction, revokePending] = useActionState<ActionResult | null, FormData>(
    revokeRecipient,
    null,
  )
  const [confirming, setConfirming] = useState(false)

  const submitted = ['Submitted', 'Revised'].includes(recipient.status)

  if (recipient.status === 'Revoked') return null

  if (confirming) {
    return (
      <form action={revokeAction} className="flex items-center gap-2">
        <input type="hidden" name="id" value={recipient.id} />
        <input type="hidden" name="import_id" value={importId} />
        <span className="text-ink-muted">Revoke?</span>
        <Button type="submit" variant="danger" disabled={revokePending}>
          Yes
        </Button>
        <Button type="button" onClick={() => setConfirming(false)}>
          No
        </Button>
      </form>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {!submitted && canSendHere && (
        <SendControls recipient={recipient} importId={importId} state={sendState} />
      )}

      {!submitted && (
        <>
          <Button onClick={() => copy(`link-${recipient.id}`, link)}>
            {copied === `link-${recipient.id}` ? 'Copied' : 'Copy link'}
          </Button>
          <Button
            variant={canSendHere ? undefined : 'primary'}
            onClick={() => {
              copy(`msg-${recipient.id}`, message)
              // Copying the message IS sending it, as far as the app can know.
              if (recipient.status === 'Pending') {
                const data = new FormData()
                data.set('id', recipient.id)
                data.set('import_id', importId)
                sentAction(data)
              }
            }}
          >
            {copied === `msg-${recipient.id}` ? 'Copied' : 'Copy message'}
          </Button>
        </>
      )}

      {!submitted && recipient.sent_at && (
        <form action={remindAction}>
          <input type="hidden" name="id" value={recipient.id} />
          <input type="hidden" name="import_id" value={importId} />
          <Button type="submit" variant="ghost" disabled={remindPending}>
            Remind
          </Button>
        </form>
      )}

      <Button variant="ghost" onClick={() => setConfirming(true)}>
        Revoke
      </Button>
    </div>
  )
}

export function RecipientsPanel({
  importId,
  requestId,
  request,
  recipients,
  messageTemplate,
  sendState,
  outboundConfigured,
  canSend,
}: {
  importId: string
  requestId: string
  request: FreightQuoteRequestSummary
  recipients: FreightQuoteRecipient[]
  messageTemplate: string
  /** Per recipient, keyed by id: whether they can be messaged and what happened. */
  sendState: Record<string, RecipientSendState>
  /** Whether this deployment has WhatsApp sending credentials at all. */
  outboundConfigured: boolean
  /** Whether this user's role may send. */
  canSend: boolean
}) {
  const [adding, setAdding] = useState(false)
  const [revealed, setRevealed] = useState<string | null>(null)
  const { copied, copy } = useCopy()

  // Only used for the text an operator copies. The links the app itself sends
  // are built server-side, from the request, and never from this.
  const origin = typeof window === 'undefined' ? '' : window.location.origin

  const linkFor = (recipient: FreightQuoteRecipient) => `${origin}/q/${recipient.token}`

  function messageFor(recipient: FreightQuoteRecipient) {
    return renderTemplate(messageTemplate, {
      import_no: request.import_no,
      mode: request.mode === 'AIR' ? 'AIR' : 'SEA LCL',
      origin: request.origin ?? '',
      destination: request.destination ?? '',
      incoterm: request.incoterm ?? '',
      gross_weight: request.gross_weight_kg
        ? `${Number(request.gross_weight_kg).toLocaleString('en-IN')} kg`
        : '',
      chargeable_weight: request.chargeable_weight_kg
        ? `${Number(request.chargeable_weight_kg).toLocaleString('en-IN')} kg`
        : '',
      cbm: request.cbm ? String(request.cbm) : '',
      package_count: request.package_count ? String(request.package_count) : '',
      quote_link: linkFor(recipient),
      deadline_line: request.response_deadline
        ? `Please submit by ${formatDate(request.response_deadline)}.`
        : '',
    })
  }

  const active = recipients.filter((r) => r.status !== 'Revoked')
  const awaiting = active.filter((r) => !['Submitted', 'Revised'].includes(r.status))

  const sendingAvailable = outboundConfigured && canSend
  // Bulk only ever touches recipients nothing has been sent to yet.
  const pending = active.filter((r) => r.status === 'Pending')
  const bulkReady = pending.filter((r) => sendState[r.id]?.destinationMasked)
  const bulkMissing = pending.filter((r) => !sendState[r.id]?.destinationMasked)

  /**
   * Every message, separated and labelled.
   *
   * Each block still carries only that recipient's own link — the point of one
   * link per company is lost the moment two of them share one.
   */
  const allMessages = awaiting
    .map((recipient) => `--- ${recipient.recipient_name} ---\n\n${messageFor(recipient)}`)
    .join('\n\n')

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Recipients</CardTitle>
          <p className="text-ink-muted">
            {sendingAvailable
              ? 'Each company gets its own link. Send it from here, or copy it and paste it yourself — the PI and packing list are always shared by hand.'
              : 'Paste each link into that company’s WhatsApp group, alongside the PI and packing list you share by hand.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {sendingAvailable && pending.length > 1 && (
            <BulkSend
              importId={importId}
              requestId={requestId}
              ready={bulkReady}
              missing={bulkMissing}
            />
          )}
          {awaiting.length > 1 && (
            <Button onClick={() => copy('all', allMessages)}>
              {copied === 'all' ? 'Copied' : `Copy all ${awaiting.length} messages`}
            </Button>
          )}
          <Button onClick={() => setAdding(true)}>Add recipient</Button>
        </div>
      </CardHeader>

      {adding && (
        <AddRecipient importId={importId} requestId={requestId} onDone={() => setAdding(false)} />
      )}

      <ul className="divide-y">
        {recipients.map((recipient) => (
          <li key={recipient.id} className="px-4 py-2.5">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{recipient.recipient_name}</span>
                  <RecipientChip
                    status={recipient.status}
                    autoSent={Boolean(
                      sendState[recipient.id]?.status &&
                        sendState[recipient.id].status !== 'FAILED',
                    )}
                  />
                  {recipient.reminder_count > 0 && (
                    <span className="text-ink-faint">
                      {recipient.reminder_count} reminder{recipient.reminder_count === 1 ? '' : 's'}
                    </span>
                  )}
                </div>
                <p className="text-ink-muted">
                  {recipient.submitted_at
                    ? `Received ${formatDate(recipient.submitted_at)} at ${timeOf(recipient.submitted_at)}`
                    : recipient.first_viewed_at
                      ? `Opened ${formatDate(recipient.first_viewed_at)}`
                      : recipient.sent_at
                        ? `${
                            sendState[recipient.id]?.sentAt ? 'Link sent' : 'Link copied'
                          } ${formatDate(recipient.sent_at)}`
                        : 'Link ready'}
                  {sendState[recipient.id]?.status && (
                    <>
                      {' · '}
                      <DeliveryTrail state={sendState[recipient.id]} />
                    </>
                  )}
                </p>
              </div>

              <RowActions
                recipient={recipient}
                importId={importId}
                link={linkFor(recipient)}
                message={messageFor(recipient)}
                copied={copied}
                copy={copy}
                sendState={sendState[recipient.id]}
                canSendHere={sendingAvailable}
              />
            </div>

            {recipient.status !== 'Revoked' &&
              !['Submitted', 'Revised'].includes(recipient.status) && (
                <button
                  type="button"
                  onClick={() => setRevealed(revealed === recipient.id ? null : recipient.id)}
                  className="mt-1 text-ink-faint hover:underline"
                >
                  {revealed === recipient.id ? 'Hide message' : 'Show message'}
                </button>
              )}

            {revealed === recipient.id && (
              <textarea
                readOnly
                rows={11}
                value={messageFor(recipient)}
                onFocus={(e) => e.currentTarget.select()}
                className="mt-2 w-full rounded-lg border border-border-strong bg-surface-sunken px-3 py-2 font-mono text-xs"
              />
            )}
          </li>
        ))}
      </ul>
    </Card>
  )
}
