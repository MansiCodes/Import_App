'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import {
  Briefcase,
  ChevronDown,
  FileText,
  FolderOpen,
  ListChecks,
  UploadCloud,
} from 'lucide-react'
import {
  Button,
  Field,
  FormGrid,
  Input,
  PanelSection,
  Select,
  Textarea,
} from '@/components/ui'
import { IMPORT_STATUSES, PRIORITIES, WAITING_ON_OPTIONS, type ImportSummary } from '@/lib/import-status'
import type { Company } from '@/lib/types'
import { cn, formatDate } from '@/lib/utils'
import type { MergedShipment } from '@/lib/pdf-import/merge'
import { PdfImportPanel, type FilledField } from './pdf-import-panel'
import { createImport, suggestPoNumber, updateImport, type ActionResult } from './actions'

export interface SupplierOption {
  id: string
  name: string
  country: string | null
  default_currency: string | null
}

export function ImportForm({
  companies,
  suppliers,
  currencies,
  incoterms,
  existing,
}: {
  companies: Company[]
  suppliers: SupplierOption[]
  currencies: string[]
  incoterms: string[]
  existing?: ImportSummary
}) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    existing ? updateImport.bind(null, existing.id) : createImport,
    null,
  )

  const [companyId, setCompanyId] = useState(existing?.company_id ?? companies[0]?.id ?? '')
  const [supplierId, setSupplierId] = useState(existing?.supplier_id ?? '')
  const [currency, setCurrency] = useState(existing?.currency ?? '')
  const [poNumber, setPoNumber] = useState(existing?.po_number ?? '')
  const [suggestion, setSuggestion] = useState('')
  const [showMore, setShowMore] = useState(!existing)

  const formRef = useRef<HTMLFormElement>(null)
  const supplier = suppliers.find((s) => s.id === supplierId)

  useEffect(() => {
    if (!companyId) return
    let cancelled = false

    suggestPoNumber(companyId, supplier?.name ?? null).then((value) => {
      if (!cancelled) setSuggestion(value)
    })

    return () => {
      cancelled = true
    }
  }, [companyId, supplier?.name])

  function handleSupplierChange(nextSupplierId: string) {
    setSupplierId(nextSupplierId)

    if (existing || currency !== '') return

    const nextSupplier = suppliers.find((s) => s.id === nextSupplierId)
    if (nextSupplier?.default_currency) setCurrency(nextSupplier.default_currency)
  }

  function applyDocuments(shipment: MergedShipment): FilledField[] {
    const form = formRef.current
    if (!form) return []

    const filled: FilledField[] = []
    const source = (field: string) => shipment.sources[field] ?? 'document'

    const set = (name: string, value: string | null, label: string, field: string) => {
      if (value === null || value === '') return

      const input = form.elements.namedItem(name)
      if (!(input instanceof HTMLInputElement || input instanceof HTMLSelectElement)) return
      if (input.value) return

      if (input instanceof HTMLSelectElement && ![...input.options].some((o) => o.value === value)) {
        return
      }

      input.value = value
      filled.push({ label, value, source: source(field) })
    }

    if (shipment.currency && !currency) {
      setCurrency(shipment.currency)
      filled.push({ label: 'Currency', value: shipment.currency, source: source('currency') })
    }

    set('title', shipment.cargoDescription, 'Description', 'totalQuantity')
    set('incoterm', shipment.incoterm, 'Incoterm', 'incoterm')
    set('origin_country', shipment.originCountry, 'Origin country', 'originCountry')
    set('pi_number', shipment.piNumber, 'PI number', 'piNumber')
    set('pi_date', shipment.documentDate, 'PI date', 'documentDate')
    set(
      'pi_value',
      shipment.totalValue === null ? null : String(shipment.totalValue),
      'PI value',
      'totalValue',
    )

    return filled
  }

  function resetForm() {
    if (!existing || !formRef.current) return
    formRef.current.reset()
    setCompanyId(existing.company_id)
    setSupplierId(existing.supplier_id ?? '')
    setCurrency(existing.currency)
    setPoNumber(existing.po_number ?? '')
  }

  return (
    <form ref={formRef} action={formAction} className="space-y-4 pb-24">
      {/* Fill from PDF — screenshot blue banner */}
      <div className="overflow-hidden rounded-2xl border border-accent/20 bg-accent-soft/70 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <p className="text-[15px] font-semibold text-ink">Fill from PDF</p>
            <p className="mt-0.5 text-[13px] text-ink-muted">
              Upload the proforma or commercial invoice to fill the order and PI details.
            </p>
          </div>
          <div className="min-w-[220px] flex-1 sm:max-w-sm">
            <PdfImportPanel
              bare
              compact
              onApply={applyDocuments}
              hint="PDF only · empty fields fill automatically"
            />
          </div>
        </div>
      </div>

      {/* Order details — 3-column grid like screenshot */}
      <PanelSection
        title="Order details"
        description="Basic information about this import order."
        icon={<Briefcase size={16} aria-hidden />}
        iconTone="accent"
      >
        <FormGrid>
          <Field label="Company" htmlFor="company_id" required>
            <Select
              id="company_id"
              name="company_id"
              required
              value={companyId}
              onChange={(e) => setCompanyId(e.target.value)}
            >
              <option value="">Choose…</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Supplier" htmlFor="supplier_id">
            <Select
              id="supplier_id"
              name="supplier_id"
              value={supplierId}
              onChange={(e) => handleSupplierChange(e.target.value)}
            >
              <option value="">Not decided yet</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.country ? ` — ${s.country}` : ''}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="Description"
            htmlFor="title"
            hint="What this order is for, e.g. 500 panels"
          >
            <Input id="title" name="title" defaultValue={existing?.title ?? ''} maxLength={200} />
          </Field>

          <Field label="Status" htmlFor="status">
            <Select id="status" name="status" defaultValue={existing?.status ?? 'Draft'}>
              {IMPORT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Currency" htmlFor="currency" required>
            <Select
              id="currency"
              name="currency"
              required
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
            >
              <option value="">Choose…</option>
              {currencies.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Incoterm" htmlFor="incoterm">
            <Select id="incoterm" name="incoterm" defaultValue={existing?.incoterm ?? ''}>
              <option value="">—</option>
              {incoterms.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Origin country" htmlFor="origin_country">
            <Input
              id="origin_country"
              name="origin_country"
              defaultValue={existing?.origin_country ?? supplier?.country ?? ''}
            />
          </Field>

          <Field
            label="Payment terms"
            htmlFor="payment_terms_text"
            className="lg:col-span-2"
            hint="As agreed — e.g. 30% advance, 70% before dispatch"
          >
            <Input
              id="payment_terms_text"
              name="payment_terms_text"
              defaultValue={existing?.payment_terms_text ?? ''}
            />
          </Field>
        </FormGrid>
      </PanelSection>

      {/* PI & PO */}
      <PanelSection
        title="PI & PO"
        description="Attach and manage Proforma Invoice and Purchase Order."
        icon={<FileText size={16} aria-hidden />}
        iconTone="upcoming"
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-4 rounded-xl border border-border bg-surface-sunken/30 p-4">
            <div className="flex items-center gap-2">
              <span className="flex size-9 items-center justify-center rounded-xl bg-upcoming-soft text-upcoming">
                <UploadCloud size={16} aria-hidden />
              </span>
              <div>
                <p className="text-[14px] font-semibold text-ink">Proforma Invoice (PI)</p>
                <p className="text-[12px] text-ink-faint">From the supplier</p>
              </div>
            </div>
            <FormGrid className="sm:grid-cols-2 lg:grid-cols-2">
              <Field label="PI number" htmlFor="pi_number" className="sm:col-span-2">
                <Input id="pi_number" name="pi_number" defaultValue={existing?.pi_number ?? ''} />
              </Field>
              <Field label="PI date" htmlFor="pi_date">
                <Input
                  id="pi_date"
                  name="pi_date"
                  type="date"
                  defaultValue={existing?.pi_date ?? ''}
                />
              </Field>
              <Field label="PI value" htmlFor="pi_value">
                <Input
                  id="pi_value"
                  name="pi_value"
                  type="number"
                  step="0.01"
                  min="0"
                  className="tnum"
                  defaultValue={existing?.pi_value ?? ''}
                />
              </Field>
            </FormGrid>
          </div>

          <div className="space-y-4 rounded-xl border border-border bg-surface-sunken/30 p-4">
            <div className="flex items-center gap-2">
              <span className="flex size-9 items-center justify-center rounded-xl bg-done-soft text-done">
                <UploadCloud size={16} aria-hidden />
              </span>
              <div>
                <p className="text-[14px] font-semibold text-ink">Purchase Order (PO)</p>
                <p className="text-[12px] text-ink-faint">Your internal PO</p>
              </div>
            </div>
            <FormGrid className="sm:grid-cols-2 lg:grid-cols-2">
              <Field
                label="PO number"
                htmlFor="po_number"
                className="sm:col-span-2"
                hint={
                  suggestion && poNumber !== suggestion
                    ? `Suggested: ${suggestion}`
                    : 'From this company’s template — overwrite freely'
                }
              >
                <div className="flex gap-2">
                  <Input
                    id="po_number"
                    name="po_number"
                    value={poNumber}
                    onChange={(e) => setPoNumber(e.target.value)}
                    placeholder={suggestion}
                    className="font-mono"
                  />
                  {suggestion && poNumber !== suggestion && (
                    <Button
                      type="button"
                      variant="primary"
                      className="shrink-0"
                      onClick={() => setPoNumber(suggestion)}
                    >
                      Use
                    </Button>
                  )}
                </div>
              </Field>
              <Field label="PO date" htmlFor="po_date">
                <Input
                  id="po_date"
                  name="po_date"
                  type="date"
                  defaultValue={existing?.po_date ?? ''}
                />
              </Field>
              <Field label="PO value" htmlFor="po_value" hint="Blank = same as PI">
                <Input
                  id="po_value"
                  name="po_value"
                  type="number"
                  step="0.01"
                  min="0"
                  className="tnum"
                  defaultValue={existing?.po_value ?? ''}
                />
              </Field>
            </FormGrid>
          </div>
        </div>
      </PanelSection>

      {/* Notes */}
      <PanelSection
        title="Notes & Drive"
        description="Optional filing links and free-text notes."
        icon={<FolderOpen size={16} aria-hidden />}
        iconTone="neutral"
      >
        <FormGrid>
          <Field
            label="Drive folder"
            htmlFor="drive_folder_url"
            className="lg:col-span-2"
            hint="Paste the link to this import’s folder"
          >
            <Input
              id="drive_folder_url"
              name="drive_folder_url"
              type="url"
              defaultValue={existing?.drive_folder_url ?? ''}
              placeholder="https://drive.google.com/drive/folders/…"
            />
          </Field>
          <Field label="Notes" htmlFor="notes" className="lg:col-span-3">
            <Textarea id="notes" name="notes" defaultValue={existing?.notes ?? ''} />
          </Field>
        </FormGrid>
      </PanelSection>

      {/* More settings */}
      <div className="overflow-hidden rounded-2xl border border-border bg-surface-raised shadow-sm">
        <button
          type="button"
          onClick={() => setShowMore((v) => !v)}
          className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left sm:px-6"
        >
          <div className="flex items-center gap-3">
            <span className="flex size-9 items-center justify-center rounded-xl bg-surface-sunken text-ink-muted">
              <ListChecks size={16} aria-hidden />
            </span>
            <div>
              <p className="text-[15px] font-semibold text-ink">More settings</p>
              <p className="text-[13px] text-ink-muted">Goods-ready dates and next action</p>
            </div>
          </div>
          <ChevronDown
            size={18}
            className={cn('text-ink-faint transition', showMore && 'rotate-180')}
            aria-hidden
          />
        </button>

        <div className={cn('space-y-5 border-t px-5 py-5 sm:px-6', !showMore && 'hidden')}>
          <FormGrid>
            <Field label="Promised goods-ready" htmlFor="expected_goods_ready">
              <Input
                id="expected_goods_ready"
                name="expected_goods_ready"
                type="date"
                defaultValue={existing?.expected_goods_ready ?? ''}
              />
            </Field>
            <Field label="Revised goods-ready" htmlFor="revised_goods_ready">
              <Input
                id="revised_goods_ready"
                name="revised_goods_ready"
                type="date"
                defaultValue={existing?.revised_goods_ready ?? ''}
              />
            </Field>
            <Field label="Actual goods-ready" htmlFor="actual_goods_ready">
              <Input
                id="actual_goods_ready"
                name="actual_goods_ready"
                type="date"
                defaultValue={existing?.actual_goods_ready ?? ''}
              />
            </Field>
          </FormGrid>

          <FormGrid>
            <Field label="What needs doing" htmlFor="next_action_title" className="lg:col-span-2">
              <Input
                id="next_action_title"
                name="next_action_title"
                defaultValue={existing?.next_action_title ?? ''}
                placeholder="Request production update"
              />
            </Field>
            <Field label="Due" htmlFor="next_action_due">
              <Input
                id="next_action_due"
                name="next_action_due"
                type="date"
                defaultValue={existing?.next_action_due ?? ''}
              />
            </Field>
            <Field label="Priority" htmlFor="next_action_priority">
              <Select
                id="next_action_priority"
                name="next_action_priority"
                defaultValue={existing?.next_action_priority ?? 'normal'}
              >
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Waiting on" htmlFor="waiting_on">
              <Select id="waiting_on" name="waiting_on" defaultValue={existing?.waiting_on ?? ''}>
                <option value="">—</option>
                {WAITING_ON_OPTIONS.map((w) => (
                  <option key={w} value={w}>
                    {w}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Last contacted" htmlFor="last_contact_at">
              <Input
                id="last_contact_at"
                name="last_contact_at"
                type="date"
                defaultValue={existing?.last_contact_at ?? ''}
              />
            </Field>
            <Field label="Last response" htmlFor="last_response_at">
              <Input
                id="last_response_at"
                name="last_response_at"
                type="date"
                defaultValue={existing?.last_response_at ?? ''}
              />
            </Field>
            <Field label="Next follow-up" htmlFor="next_followup_at">
              <Input
                id="next_followup_at"
                name="next_followup_at"
                type="date"
                defaultValue={existing?.next_followup_at ?? ''}
              />
            </Field>
          </FormGrid>
        </div>
      </div>

      {state?.error && (
        <p className="rounded-xl bg-critical-soft px-4 py-3 text-sm text-critical">{state.error}</p>
      )}
      {state?.ok && existing && (
        <p className="rounded-xl bg-done-soft px-4 py-3 text-sm text-done">Saved.</p>
      )}

      {/* Sticky footer — Discard + Save like screenshot */}
      <div className="sticky bottom-3 z-20 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-surface-raised/95 px-4 py-3 shadow-lg backdrop-blur-md">
        <p className="text-[13px] text-ink-muted">
          {existing?.updated_at
            ? `Last updated ${formatDate(existing.updated_at)}`
            : existing
              ? 'Edit and save when ready.'
              : 'Creates a new import record.'}
        </p>
        <div className="flex items-center gap-2">
          {existing && (
            <Button type="button" className="rounded-xl px-4" onClick={resetForm}>
              Discard
            </Button>
          )}
          <Button
            type="submit"
            variant="primary"
            disabled={pending}
            className="rounded-xl px-5 py-2.5"
          >
            {pending ? 'Saving…' : existing ? 'Save changes' : 'Create import'}
          </Button>
        </div>
      </div>
    </form>
  )
}
