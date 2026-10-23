'use client'

import { useActionState, useState } from 'react'
import { Pencil, Plus, X } from 'lucide-react'
import { Badge, Button, Field, Input, Select, Textarea } from '@/components/ui'
import { financialYear } from '@/lib/fy'
import { renderPoNumber } from '@/lib/po-number'
import type { Company, PoSequence } from '@/lib/types'
import { cn } from '@/lib/utils'
import { saveCompany, setPoSequence, type ActionResult } from './actions'

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function CompanyForm({ company, onDone }: { company?: Company; onDone: () => void }) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    async (prev, formData) => {
      const result = await saveCompany(prev, formData)
      if (result.ok) onDone()
      return result
    },
    null,
  )

  // Live PO preview so the effect of a template edit is visible before saving.
  const [template, setTemplate] = useState(
    company?.po_number_template ?? '{COMPANY}_PO_{SEQ:3}_{FY}',
  )
  const [shortCode, setShortCode] = useState(company?.short_code ?? '')
  const [fyStartMonth, setFyStartMonth] = useState(company?.fy_start_month ?? 4)

  let preview = ''
  try {
    preview = renderPoNumber(template, {
      companyCode: shortCode || 'CODE',
      seq: 6,
      date: new Date(),
      fyStartMonth,
      supplierName: 'Thermocable',
    })
  } catch {
    preview = '—'
  }

  return (
    <form action={formAction} className="space-y-4 border-b bg-surface-sunken/50 px-4 py-4">
      {company && <input type="hidden" name="id" value={company.id} />}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" htmlFor="name" required>
          <Input id="name" name="name" defaultValue={company?.name} required maxLength={120} />
        </Field>

        <Field label="Legal name" htmlFor="legal_name" hint="As it appears on the IEC and invoices">
          <Input id="legal_name" name="legal_name" defaultValue={company?.legal_name ?? ''} />
        </Field>

        <Field
          label="Short code"
          htmlFor="short_code"
          required
          hint="Used by {COMPANY} in PO templates"
        >
          <Input
            id="short_code"
            name="short_code"
            required
            maxLength={10}
            value={shortCode}
            onChange={(e) => setShortCode(e.target.value.toUpperCase())}
            className="font-mono uppercase"
          />
        </Field>

        <Field
          label="Financial year starts"
          htmlFor="fy_start_month"
          hint="Drives {FY} in PO numbers. April gives ATC's 26-27."
        >
          <Select
            id="fy_start_month"
            name="fy_start_month"
            value={fyStartMonth}
            onChange={(e) => setFyStartMonth(Number(e.target.value))}
          >
            {MONTHS.map((month, index) => (
              <option key={month} value={index + 1}>
                {month}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="GSTIN" htmlFor="gstin">
          <Input id="gstin" name="gstin" defaultValue={company?.gstin ?? ''} maxLength={20} />
        </Field>

        <Field label="IEC" htmlFor="iec">
          <Input id="iec" name="iec" defaultValue={company?.iec ?? ''} maxLength={20} />
        </Field>
      </div>

      <Field
        label="PO number template"
        htmlFor="po_number_template"
        hint="Placeholders: {COMPANY} {SEQ} {SEQ:3} {FY} {FYYY} {YYYY} {SUPPLIER}"
      >
        <Input
          id="po_number_template"
          name="po_number_template"
          required
          value={template}
          onChange={(e) => setTemplate(e.target.value)}
          className="font-mono"
        />
      </Field>

      <p className="text-[13px] text-ink-muted">
        Suggestion for sequence 6 today:{' '}
        <span className="font-mono font-medium text-ink">{preview}</span>
      </p>

      <Field label="Drive folder URL" htmlFor="drive_folder_url" hint="The company's imports root in Google Drive">
        <Input
          id="drive_folder_url"
          name="drive_folder_url"
          type="url"
          defaultValue={company?.drive_folder_url ?? ''}
          placeholder="https://drive.google.com/drive/folders/…"
        />
      </Field>

      <Field label="Notes" htmlFor="notes">
        <Textarea id="notes" name="notes" defaultValue={company?.notes ?? ''} />
      </Field>

      <label className="flex items-center gap-2 text-[13px]">
        <input
          type="checkbox"
          name="is_active"
          defaultChecked={company?.is_active ?? true}
          className="size-4"
        />
        Active
      </label>

      {state?.error && (
        <p className="rounded-lg bg-critical-soft px-3 py-2 text-sm text-critical">
          {state.error}
        </p>
      )}

      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? 'Saving…' : company ? 'Save changes' : 'Add company'}
        </Button>
        <Button type="button" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

function PoSequenceRow({ company, sequences }: { company: Company; sequences: PoSequence[] }) {
  const fy = financialYear(new Date(), company.fy_start_month)
  const current = sequences.find((s) => s.company_id === company.id && s.fy_label === fy.label)

  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    setPoSequence,
    null,
  )

  return (
    <form
      action={formAction}
      className="flex items-center gap-2 rounded-xl border bg-surface-sunken/60 px-2.5 py-1.5"
    >
      <input type="hidden" name="company_id" value={company.id} />
      <input type="hidden" name="fy_label" value={fy.label} />

      <div className="min-w-0">
        <p className="text-[10px] font-medium tracking-wide text-ink-faint uppercase">
          Next PO · {fy.label}
        </p>
        <input
          id={`seq-${company.id}`}
          name="next_seq"
          type="number"
          min={1}
          defaultValue={current?.next_seq ?? 1}
          aria-label={`Next PO number for ${company.name} (${fy.label})`}
          className="w-14 bg-transparent text-[15px] font-semibold tnum text-ink outline-none"
        />
      </div>

      <button
        type="submit"
        disabled={pending}
        className={cn(
          'rounded-lg bg-accent px-2.5 py-1.5 text-[12px] font-semibold text-white transition hover:opacity-90',
          pending && 'pointer-events-none opacity-60',
        )}
      >
        {pending ? '…' : 'Set'}
      </button>

      {state?.error && (
        <span className="max-w-[8rem] truncate text-[11px] text-critical" title={state.error}>
          {state.error}
        </span>
      )}
      {state?.ok && <span className="text-[11px] font-medium text-done">Saved</span>}
    </form>
  )
}

export function CompaniesPanel({
  companies,
  sequences,
}: {
  companies: Company[]
  sequences: PoSequence[]
}) {
  const [editing, setEditing] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b px-4 py-3">
        <div>
          <p className="text-[14px] font-semibold text-ink">Importing entities</p>
          <p className="text-[12px] text-ink-muted">
            Companies are data, not code — add or rename them freely.
          </p>
        </div>
        <Button
          variant="primary"
          onClick={() => {
            setAdding(true)
            setEditing(null)
          }}
        >
          <Plus size={16} aria-hidden />
          Add company
        </Button>
      </div>

      {adding && <CompanyForm onDone={() => setAdding(false)} />}

      {companies.length === 0 && !adding ? (
        <p className="px-4 py-8 text-center text-[14px] text-ink-muted">
          No companies yet. Add the first importing entity above.
        </p>
      ) : (
        <ul className="divide-y">
          {companies.map((company) => {
            const isEditing = editing === company.id
            return (
              <li key={company.id} className={cn(isEditing && 'bg-surface-sunken/30')}>
                <div className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[14px] font-semibold text-ink">{company.name}</span>
                      <Badge tone="accent" className="font-mono">
                        {company.short_code}
                      </Badge>
                      {!company.is_active && <Badge>Inactive</Badge>}
                    </div>
                    <p className="mt-0.5 text-[13px] text-ink-muted">
                      {company.legal_name ?? 'No legal name'} · FY starts{' '}
                      {MONTHS[company.fy_start_month - 1]}
                    </p>
                    <p className="mt-0.5 font-mono text-[12px] text-ink-faint">
                      {company.po_number_template}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                    <PoSequenceRow company={company} sequences={sequences} />
                    <button
                      type="button"
                      onClick={() => {
                        setEditing(isEditing ? null : company.id)
                        setAdding(false)
                      }}
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-[13px] font-medium transition',
                        isEditing
                          ? 'border-accent bg-accent-soft text-accent'
                          : 'border-border bg-surface-raised text-ink-muted hover:border-border-strong hover:text-ink',
                      )}
                    >
                      {isEditing ? <X size={14} aria-hidden /> : <Pencil size={14} aria-hidden />}
                      {isEditing ? 'Close' : 'Edit'}
                    </button>
                  </div>
                </div>

                {isEditing && (
                  <CompanyForm company={company} onDone={() => setEditing(null)} />
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
