'use client'

import { useActionState, useState } from 'react'
import { Plus } from 'lucide-react'
import { Badge, Button, Field, Input, Select, Textarea } from '@/components/ui'
import { extractPlaceholders } from '@/lib/email-template'
import type { EmailTemplate } from '@/lib/types'
import { saveEmailTemplate, type ActionResult } from './actions'

const CATEGORIES = [
  'Follow-up',
  'Payment',
  'Documents',
  'Shipping',
  'Customs',
  'Delivery',
  'Other',
] as const

/**
 * The placeholders the import pages can actually fill. Anything else a template
 * asks for is left visible in the prepared email rather than silently blanked,
 * so this list is guidance, not a constraint.
 */
const SUPPORTED = [
  'import_no',
  'po_number',
  'pi_number',
  'currency',
  'pi_value',
  'company_name',
  'supplier_name',
  'supplier_contact',
  'cha_name',
  'expected_goods_ready',
  'next_eta',
  'sender_name',
]

function TemplateForm({ template, onDone }: { template?: EmailTemplate; onDone: () => void }) {
  const [subject, setSubject] = useState(template?.subject ?? '')
  const [body, setBody] = useState(template?.body ?? '')

  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    async (prev, formData) => {
      const result = await saveEmailTemplate(prev, formData)
      if (result.ok) onDone()
      return result
    },
    null,
  )

  const used = [...new Set([...extractPlaceholders(subject), ...extractPlaceholders(body)])]
  const unknown = used.filter((p) => !SUPPORTED.includes(p))

  return (
    <form action={formAction} className="space-y-3 border-b bg-surface-sunken/50 px-4 py-4">
      {template && <input type="hidden" name="id" value={template.id} />}

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Name" htmlFor="name" required>
          <Input id="name" name="name" required defaultValue={template?.name ?? ''} />
        </Field>
        <Field label="Code" htmlFor="code" required hint="Unique, lowercase">
          <Input
            id="code"
            name="code"
            required
            defaultValue={template?.code ?? ''}
            readOnly={template?.is_system}
          />
        </Field>
        <Field label="Category" htmlFor="category">
          <Select id="category" name="category" defaultValue={template?.category ?? ''}>
            <option value="">—</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
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

      <Field label="Body" htmlFor="body" required>
        <Textarea
          id="body"
          name="body"
          required
          rows={12}
          className="min-h-48 font-mono text-[13px]"
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
      </Field>

      <div className="rounded-xl border bg-surface-raised p-3">
        <p className="mb-2 text-[11px] font-medium tracking-wide text-ink-faint uppercase">
          Placeholders
        </p>
        <div className="flex flex-wrap gap-1.5">
          {SUPPORTED.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setBody((b) => `${b}{{${p}}}`)}
              className="rounded-md bg-surface-sunken px-2 py-0.5 font-mono text-[11px] text-ink-muted transition hover:bg-accent-soft hover:text-accent"
            >
              {`{{${p}}}`}
            </button>
          ))}
        </div>

        {unknown.length > 0 && (
          <p className="mt-3 text-[13px] text-critical">
            {unknown.map((p) => `{{${p}}}`).join(', ')} will not be filled in — it will appear in the
            email exactly as written.
          </p>
        )}
      </div>

      <label className="flex items-center gap-2 text-[13px]">
        <input type="checkbox" name="is_active" defaultChecked={template?.is_active ?? true} />
        <span>Available when preparing an email</span>
      </label>

      {state?.error && (
        <p className="rounded-lg bg-critical-soft px-3 py-2 text-sm text-critical">{state.error}</p>
      )}

      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? 'Saving…' : 'Save template'}
        </Button>
        <Button type="button" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

export function TemplatesPanel({ templates }: { templates: EmailTemplate[] }) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b px-4 py-3">
        <div>
          <p className="text-[14px] font-semibold text-ink">Email templates</p>
          <p className="text-[12px] text-ink-muted">
            Substitution only — the app prepares text for you to review, never sends.
          </p>
        </div>
        {!adding && (
          <Button
            type="button"
            variant="primary"
            onClick={() => {
              setAdding(true)
              setEditingId(null)
            }}
          >
            <Plus size={16} aria-hidden />
            Add template
          </Button>
        )}
      </div>

      {adding && <TemplateForm onDone={() => setAdding(false)} />}

      {templates.length === 0 && !adding ? (
        <p className="px-4 py-8 text-center text-[14px] text-ink-muted">No templates yet.</p>
      ) : (
        <ul className="divide-y">
          {templates.map((template) => (
            <li key={template.id}>
              {editingId === template.id ? (
                <TemplateForm template={template} onDone={() => setEditingId(null)} />
              ) : (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3.5 hover:bg-surface-sunken/40">
                  <span className="text-[14px] font-semibold text-ink">{template.name}</span>
                  {template.category && <Badge tone="neutral">{template.category}</Badge>}
                  {template.is_system && <Badge tone="accent">Seeded</Badge>}
                  {!template.is_active && <Badge>Inactive</Badge>}
                  <span className="min-w-0 flex-1 truncate text-[13px] text-ink-muted">
                    {template.subject}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      setEditingId(template.id)
                      setAdding(false)
                    }}
                  >
                    Edit
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
