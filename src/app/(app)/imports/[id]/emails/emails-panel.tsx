'use client'

import { useActionState, useMemo, useState } from 'react'
import {
  Badge,
  Button,
  Card,
  CardHeader,
  CardTitle,
  EmptyState,
  Field,
  Input,
  Select,
  Textarea,
} from '@/components/ui'
import { formatDate } from '@/lib/utils'
import {
  emptyPlaceholders,
  gmailComposeUrl,
  missingPlaceholders,
  renderTemplate,
  type Placeholders,
} from '@/lib/email-template'
import type { EmailDraft, EmailTemplate } from '@/lib/types'
import { deleteDraft, markDraftSent, saveDraft, type ActionResult } from './actions'

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false)

  return (
    <Button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      }}
    >
      {copied ? 'Copied' : label}
    </Button>
  )
}

/**
 * Prepare → review → copy or open in Gmail.
 *
 * The rendered text is shown in an editable box before it goes anywhere: the
 * substitution is mechanical, so the judgement about whether it reads properly
 * has to be a human's.
 */
function Composer({
  importId,
  templates,
  values,
  defaultTo,
}: {
  importId: string
  templates: EmailTemplate[]
  values: Placeholders
  defaultTo: string | null
}) {
  const [templateId, setTemplateId] = useState('')
  const template = templates.find((t) => t.id === templateId)

  const rendered = useMemo(() => {
    if (!template) return { subject: '', body: '', missing: [] as string[], empty: [] as string[] }
    return {
      subject: renderTemplate(template.subject, values),
      body: renderTemplate(template.body, values),
      missing: [
        ...new Set([
          ...missingPlaceholders(template.subject, values),
          ...missingPlaceholders(template.body, values),
        ]),
      ],
      empty: [
        ...new Set([
          ...emptyPlaceholders(template.subject, values),
          ...emptyPlaceholders(template.body, values),
        ]),
      ],
    }
  }, [template, values])

  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [to, setTo] = useState(defaultTo ?? '')
  const [cc, setCc] = useState('')

  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    saveDraft,
    null,
  )

  function pickTemplate(id: string) {
    setTemplateId(id)
    const next = templates.find((t) => t.id === id)
    if (next) {
      setSubject(renderTemplate(next.subject, values))
      setBody(renderTemplate(next.body, values))
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Prepare an email</CardTitle>
        <span className="text-ink-faint">The app does not send — you do</span>
      </CardHeader>

      <form action={formAction} className="space-y-3 p-4">
        <input type="hidden" name="import_id" value={importId} />
        <input type="hidden" name="template_id" value={templateId} />

        <Field label="Template" htmlFor="template">
          <Select id="template" value={templateId} onChange={(e) => pickTemplate(e.target.value)}>
            <option value="">Choose a template…</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {t.category ? ` — ${t.category}` : ''}
              </option>
            ))}
          </Select>
        </Field>

        {template && rendered.missing.length > 0 && (
          <p className="rounded-lg bg-critical-soft px-3 py-2 text-critical">
            This template asks for {rendered.missing.map((p) => `{{${p}}}`).join(', ')}, which this
            app does not supply. Those tags are left visible in the text below — edit them out or fix
            the template in Settings.
          </p>
        )}

        {template && rendered.empty.length > 0 && (
          <p className="rounded-lg bg-due-soft px-3 py-2 text-due">
            Nothing recorded for {rendered.empty.join(', ')} — those spots came out blank.
          </p>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="To" htmlFor="to_email">
            <Input
              id="to_email"
              name="to_email"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </Field>
          <Field label="Cc" htmlFor="cc_email">
            <Input id="cc_email" name="cc_email" value={cc} onChange={(e) => setCc(e.target.value)} />
          </Field>
        </div>

        <Field label="Subject" htmlFor="subject" required>
          <Input
            id="subject"
            name="subject"
            required
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
          />
        </Field>

        <Field label="Body" htmlFor="body" required hint="Read it before it goes anywhere">
          <Textarea
            id="body"
            name="body"
            required
            rows={16}
            className="min-h-64 font-mono"
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </Field>

        {state?.error && <p className="text-critical">{state.error}</p>}

        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="primary" disabled={pending || !subject || !body}>
            {pending ? 'Recording…' : 'Record as prepared'}
          </Button>
          <CopyButton text={body} label="Copy body" />
          <CopyButton text={subject} label="Copy subject" />
          {subject && body && (
            <a
              href={gmailComposeUrl({ to, cc, subject, body })}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center rounded-lg border border-border-strong px-3 py-1.5 font-medium hover:bg-surface-sunken"
            >
              Open in Gmail ↗
            </a>
          )}
        </div>
      </form>
    </Card>
  )
}

function DraftRow({ draft, importId }: { draft: EmailDraft; importId: string }) {
  const [expanded, setExpanded] = useState(false)
  const [sentState, sentAction, sending] = useActionState<ActionResult | null, FormData>(
    markDraftSent,
    null,
  )
  const [, deleteAction, deleting] = useActionState<ActionResult | null, FormData>(deleteDraft, null)

  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-medium">{draft.subject}</span>
        {draft.sent_manually_at ? (
          <Badge tone="done">Sent {formatDate(draft.sent_manually_at)}</Badge>
        ) : (
          <Badge tone="due">Prepared, not confirmed sent</Badge>
        )}
        <span className="text-ink-muted">{draft.to_email ?? 'no recipient'}</span>
        <span className="text-ink-faint">{formatDate(draft.prepared_at)}</span>

        <span className="ml-auto">
          <Button type="button" variant="ghost" onClick={() => setExpanded(!expanded)}>
            {expanded ? 'Hide' : 'Show'}
          </Button>
        </span>
      </div>

      {expanded && (
        <div className="mt-2">
          <pre className="overflow-x-auto rounded-lg bg-surface-sunken p-3 whitespace-pre-wrap">
            {draft.body}
          </pre>

          {draft.gmail_thread_url && (
            <a
              href={draft.gmail_thread_url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-block text-accent hover:underline"
            >
              Open the thread ↗
            </a>
          )}

          {!draft.sent_manually_at && (
            <form action={sentAction} className="mt-3 flex flex-wrap items-end gap-2">
              <input type="hidden" name="id" value={draft.id} />
              <input type="hidden" name="import_id" value={importId} />
              <Field
                label="Gmail thread link"
                htmlFor={`thread-${draft.id}`}
                className="flex-1"
                hint="Optional — paste it back so the thread is reachable from here"
              >
                <Input id={`thread-${draft.id}`} name="gmail_thread_url" />
              </Field>
              <Button type="submit" variant="primary" disabled={sending}>
                {sending ? 'Recording…' : 'I have sent this'}
              </Button>
            </form>
          )}
          {sentState?.error && <p className="mt-1 text-critical">{sentState.error}</p>}

          <form action={deleteAction} className="mt-2">
            <input type="hidden" name="id" value={draft.id} />
            <input type="hidden" name="import_id" value={importId} />
            <Button type="submit" variant="ghost" disabled={deleting} className="text-critical">
              Delete draft
            </Button>
          </form>
        </div>
      )}
    </li>
  )
}

export function EmailsPanel({
  importId,
  templates,
  drafts,
  values,
  defaultTo,
}: {
  importId: string
  templates: EmailTemplate[]
  drafts: EmailDraft[]
  values: Placeholders
  defaultTo: string | null
}) {
  return (
    <div className="space-y-5">
      <Composer
        importId={importId}
        templates={templates}
        values={values}
        defaultTo={defaultTo}
      />

      <Card>
        <CardHeader>
          <CardTitle>Prepared earlier</CardTitle>
        </CardHeader>

        {drafts.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title="Nothing prepared yet"
              description="Drafts recorded here show what was said and when, which is what a follow-up needs to be fair."
            />
          </div>
        ) : (
          <ul className="divide-y">
            {drafts.map((draft) => (
              <DraftRow key={draft.id} draft={draft} importId={importId} />
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
