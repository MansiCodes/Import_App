import 'server-only'

import { getSender } from './adapters/meta-cloud-sender'
import { toE164 } from './adapters/meta-cloud-sender'
import { renderTemplate } from '@/lib/email-template'
import { getSetting } from '@/lib/settings'
import { createClient } from '@/lib/supabase/server'

/**
 * Sending a quote link, as the freight quote module sees it.
 *
 * The module calls this and never a provider endpoint, so replacing Meta with
 * anything else is a change to the adapter and this file, not to quote logic.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO:
 *   - It never sends the PI or packing list. Those are shared by hand, by
 *     design, and no document reference reaches the provider.
 *   - It never sends on its own. Every send is a person pressing a button.
 *   - It never fails a quote request because a message failed. A recipient
 *     with no number still has a working link the operator can copy.
 */

export type SendOutcome =
  | { ok: true; messageId: string; providerMessageId: string | null }
  | { ok: false; reason: 'not_configured' | 'no_destination' | 'already_sent' | 'provider_error'; detail: string }

export interface QuoteLinkContext {
  recipientName: string
  importNo: string
  mode: string
  origin: string
  destination: string
  grossWeight: string
  packages: string
  incoterm: string
  quoteLink: string
  /** Already-worded, because a blank deadline must leave no empty sentence. */
  deadlineLine: string
}

/**
 * The ordered values substituted into the approved template's body.
 *
 * The order is the contract with whatever template is approved in Meta's
 * console — {{1}} is the recipient's name, {{8}} is the link. Changing this
 * order silently reshuffles a live template, so it is written down here and in
 * the setup notes rather than left implicit.
 */
export function templateParameters(context: QuoteLinkContext): string[] {
  return [
    context.recipientName,
    context.mode,
    context.origin || '-',
    context.destination || '-',
    context.grossWeight || '-',
    context.packages || '-',
    context.incoterm || '-',
    context.quoteLink,
  ]
}

/**
 * The message an operator configured, rendered for one recipient.
 *
 * The same `freight_quote_message_template` setting that produces the text
 * behind Copy message. A CHA should not be able to tell whether a human pasted
 * the message or the app sent it, and an operator who edits the wording should
 * not have to edit it twice.
 *
 * Only reachable on the free-text path. A business-initiated message must use
 * a template approved in Meta's console, and that wording lives there — which
 * is why WHATSAPP_QUOTE_TEMPLATE_NAME selects it rather than this setting.
 */
export async function configuredMessage(context: QuoteLinkContext): Promise<string> {
  const template = await getSetting('freight_quote_message_template')
  if (!template?.trim()) return plainMessage(context)

  return renderTemplate(String(template), {
    import_no: context.importNo,
    mode: context.mode,
    origin: context.origin,
    destination: context.destination,
    incoterm: context.incoterm,
    gross_weight: context.grossWeight,
    package_count: context.packages,
    quote_link: context.quoteLink,
    deadline_line: context.deadlineLine,
    // Present in the manual template's vocabulary; not carried into a send.
    chargeable_weight: '',
    cbm: '',
  })
}

/** The fallback wording, used when no template has been configured. */
export function plainMessage(context: QuoteLinkContext): string {
  return [
    `Hello ${context.recipientName},`,
    '',
    `Please submit your ${context.mode} freight quotation for:`,
    '',
    `Origin: ${context.origin || '-'}`,
    `Destination: ${context.destination || '-'}`,
    `Gross weight: ${context.grossWeight || '-'}`,
    `Packages: ${context.packages || '-'}`,
    `Incoterm: ${context.incoterm || '-'}`,
    '',
    'Quote link:',
    context.quoteLink,
    '',
    'PI & Packing List have been shared separately.',
    '',
    'Thank you.',
  ].join('\n')
}

export function isOutboundConfigured(): boolean {
  return getSender() !== null
}

/**
 * Where a recipient's message should go.
 *
 * Checked in the order the operator would: what was recorded against this
 * recipient, then the CHA's WhatsApp number, then the CHA's ordinary phone.
 * Returns null when nothing usable exists — which is a normal state, not an
 * error.
 */
export function resolveDestination(recipient: {
  phone?: string | null
  cha?: { whatsapp_phone?: string | null; phone?: string | null } | null
}): string | null {
  return (
    toE164(recipient.phone) ??
    toE164(recipient.cha?.whatsapp_phone) ??
    toE164(recipient.cha?.phone) ??
    null
  )
}

/**
 * A number the operator can recognise but the page cannot leak.
 *
 * Enough digits to confirm the right company is being messaged, not enough to
 * turn the rendered HTML into a contact list.
 */
export function maskDestination(destination: string | null): string | null {
  if (!destination) return null
  const tail = destination.slice(-4)
  const head = destination.slice(0, 2)
  return `+${head} ${'•'.repeat(Math.max(0, destination.length - 6))}${tail}`
}

/**
 * Send one recipient their own quote link.
 *
 * Idempotency is the database's job, not the button's: the attempt row is
 * inserted BEFORE the provider is called, and (recipient_id, attempt_no) is
 * unique. A double-click therefore loses the race on the insert and returns
 * `already_sent` rather than sending twice.
 */
export async function sendQuoteLink(params: {
  recipientId: string
  context: QuoteLinkContext
  actorId: string | null
  /** Set only for a deliberate resend, which the caller confirms first. */
  resend?: boolean
}): Promise<SendOutcome> {
  const supabase = await createClient()

  const { data: recipient } = await supabase
    .from('freight_quote_request_recipients')
    .select('id, quote_request_id, phone, revoked_at, chas(whatsapp_phone, phone)')
    .eq('id', params.recipientId)
    .maybeSingle()

  if (!recipient) return { ok: false, reason: 'no_destination', detail: 'Recipient not found' }
  if (recipient.revoked_at) {
    return { ok: false, reason: 'no_destination', detail: 'This link has been revoked' }
  }

  const destination = resolveDestination({
    phone: recipient.phone,
    cha: (recipient as { chas?: { whatsapp_phone?: string | null; phone?: string | null } }).chas,
  })

  if (!destination) {
    return { ok: false, reason: 'no_destination', detail: 'No WhatsApp number on file' }
  }

  const sender = getSender()
  if (!sender) {
    return {
      ok: false,
      reason: 'not_configured',
      detail: 'WhatsApp sending is not configured on this deployment',
    }
  }

  const { data: previous } = await supabase
    .from('freight_quote_messages')
    .select('attempt_no, status')
    .eq('recipient_id', params.recipientId)
    .order('attempt_no', { ascending: false })
    .limit(1)
    .maybeSingle()

  // Only an explicit resend may follow a send that already succeeded.
  if (previous && !params.resend && previous.status !== 'FAILED') {
    return { ok: false, reason: 'already_sent', detail: 'Already sent — use Resend' }
  }

  const attemptNo = (previous?.attempt_no ?? 0) + 1

  const templateName = process.env.WHATSAPP_QUOTE_TEMPLATE_NAME ?? null
  const templateLanguage = process.env.WHATSAPP_QUOTE_TEMPLATE_LANGUAGE ?? 'en'
  const messageType = templateName ? 'template' : 'text'

  // Worked out before the row is written, so body_preview records what was
  // actually put on the wire rather than an approximation of it.
  const body = templateName ? null : await configuredMessage(params.context)

  const { data: record, error: insertError } = await supabase
    .from('freight_quote_messages')
    .insert({
      quote_request_id: recipient.quote_request_id,
      recipient_id: params.recipientId,
      attempt_no: attemptNo,
      destination,
      message_type: messageType,
      template_name: templateName,
      template_language: templateName ? templateLanguage : null,
      body_preview: (body ?? plainMessage(params.context)).slice(0, 500),
      status: 'PENDING',
      sent_by: params.actorId,
    })
    .select('id')
    .single()

  if (insertError) {
    // The unique index rejected a second attempt with the same number: another
    // click got here first, and it is already sending.
    return { ok: false, reason: 'already_sent', detail: 'That send is already in progress' }
  }

  const result = templateName
    ? await sender.sendTemplate({
        to: destination,
        templateName,
        languageCode: templateLanguage,
        parameters: templateParameters(params.context),
      })
    : await sender.sendText({ to: destination, body: body as string })

  const now = new Date().toISOString()

  await supabase
    .from('freight_quote_messages')
    .update(
      result.ok
        ? { status: 'SENT', sent_at: now, provider_message_id: result.providerMessageId }
        : {
            status: 'FAILED',
            failed_at: now,
            failure_code: result.errorCode,
            failure_reason: result.errorReason,
          },
    )
    .eq('id', record.id)

  if (!result.ok) {
    return { ok: false, reason: 'provider_error', detail: result.errorReason ?? 'Send failed' }
  }

  // The recipient's own status moves only on a successful send, and only
  // forwards — a message never un-submits a quotation.
  await supabase
    .from('freight_quote_request_recipients')
    .update({ status: 'Sent', sent_at: now })
    .eq('id', params.recipientId)
    .in('status', ['Pending'])

  return { ok: true, messageId: record.id, providerMessageId: result.providerMessageId }
}

/**
 * Apply provider delivery callbacks.
 *
 * Matched on provider_message_id alone, and touching nothing but this table.
 * States only move forwards — a `sent` callback arriving after `read` (they are
 * not ordered) must not walk the record backwards.
 */
export async function applyDeliveryStatuses(payload: unknown): Promise<number> {
  const sender = getSender()
  if (!sender) return 0

  const statuses = sender.parseDeliveryStatuses(payload)
  if (statuses.length === 0) return 0

  const supabase = await createClient()
  const RANK = { PENDING: 0, SENT: 1, DELIVERED: 2, READ: 3, FAILED: 4 } as const
  let applied = 0

  for (const status of statuses) {
    const { data: message } = await supabase
      .from('freight_quote_messages')
      .select('id, status')
      .eq('provider_message_id', status.providerMessageId)
      .maybeSingle()

    if (!message) continue

    const next = status.state.toUpperCase() as keyof typeof RANK
    if (RANK[next] <= RANK[message.status as keyof typeof RANK] && next !== 'FAILED') continue

    const at = status.at ?? new Date().toISOString()

    await supabase
      .from('freight_quote_messages')
      .update({
        status: next,
        ...(next === 'DELIVERED' ? { delivered_at: at } : {}),
        ...(next === 'READ' ? { read_at: at } : {}),
        ...(next === 'FAILED'
          ? { failed_at: at, failure_code: status.errorCode, failure_reason: status.errorReason }
          : {}),
      })
      .eq('id', message.id)

    applied += 1
  }

  return applied
}
