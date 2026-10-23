'use client'

import { useActionState, useEffect, useState, useTransition } from 'react'
import Link from 'next/link'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ClipboardList,
  Factory,
  FileText,
  FolderOpen,
  Loader2,
  PackagePlus,
  Plus,
} from 'lucide-react'
import { Button, Field, Input, Select, Textarea } from '@/components/ui'
import { Modal } from '@/components/ui/modal'
import {
  IMPORT_STATUSES,
  PRIORITIES,
  WAITING_ON_OPTIONS,
} from '@/lib/import-status'
import { cn } from '@/lib/utils'
import { createImport, suggestPoNumber, type ActionResult } from './actions'
import {
  loadNewImportOptions,
  type NewImportOptions,
} from './load-new-import-options'

const STEPS = [
  { id: 'order', label: 'The order', icon: PackagePlus },
  { id: 'pi', label: 'PI & PO', icon: FileText },
  { id: 'production', label: 'Production', icon: Factory },
  { id: 'action', label: 'Next action', icon: ClipboardList },
  { id: 'filing', label: 'Filing', icon: FolderOpen },
] as const

type StepId = (typeof STEPS)[number]['id']

export function NewImportButton({
  className,
  label = 'New Import',
  variant = 'primary',
}: {
  className?: string
  label?: string
  variant?: 'primary' | 'secondary'
}) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button
        type="button"
        variant={variant}
        className={cn('rounded-xl px-4 py-2.5 shadow-sm', className)}
        onClick={() => setOpen(true)}
      >
        <Plus size={16} aria-hidden />
        {label}
      </Button>
      <NewImportDialog open={open} onClose={() => setOpen(false)} />
    </>
  )
}

export function NewImportDialog({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const [options, setOptions] = useState<NewImportOptions | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, startLoad] = useTransition()
  const [step, setStep] = useState<StepId>('order')

  const [companyId, setCompanyId] = useState('')
  const [supplierId, setSupplierId] = useState('')
  const [currency, setCurrency] = useState('')
  const [poNumber, setPoNumber] = useState('')
  const [suggestion, setSuggestion] = useState('')

  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    createImport,
    null,
  )

  useEffect(() => {
    if (!open) return

    setStep('order')
    setLoadError(null)
    setPoNumber('')
    setSuggestion('')
    setSupplierId('')
    setCurrency('')

    startLoad(async () => {
      try {
        const data = await loadNewImportOptions()
        setOptions(data)
        setCompanyId(data.companies[0]?.id ?? '')
      } catch (error) {
        setLoadError(error instanceof Error ? error.message : 'Could not load form')
      }
    })
  }, [open])

  const supplier = options?.suppliers.find((s) => s.id === supplierId)

  useEffect(() => {
    if (!open || !companyId) return
    let cancelled = false

    suggestPoNumber(companyId, supplier?.name ?? null).then((value) => {
      if (!cancelled) setSuggestion(value)
    })

    return () => {
      cancelled = true
    }
  }, [open, companyId, supplier?.name])

  function handleSupplierChange(nextId: string) {
    setSupplierId(nextId)
    if (currency) return
    const next = options?.suppliers.find((s) => s.id === nextId)
    if (next?.default_currency) setCurrency(next.default_currency)
  }

  const stepIndex = STEPS.findIndex((s) => s.id === step)

  function goNext() {
    if (step === 'order') {
      if (!companyId || !currency) return
      setStep('pi')
      return
    }
    if (step === 'pi') {
      setStep('production')
      return
    }
    if (step === 'production') {
      setStep('action')
      return
    }
    if (step === 'action') setStep('filing')
  }

  function goBack() {
    const order: StepId[] = ['order', 'pi', 'production', 'action', 'filing']
    const i = order.indexOf(step)
    if (i > 0) setStep(order[i - 1]!)
  }

  const canContinue =
    step === 'order' ? Boolean(companyId && currency) : true

  const StepIcon = STEPS[stepIndex]?.icon ?? PackagePlus

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New import"
      icon={<PackagePlus size={22} strokeWidth={1.75} aria-hidden />}
      headerAlign="center"
      size="xl"
      footer={
        options && options.companies.length > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-1.5">
              {STEPS.map((s, i) => (
                <button
                  key={s.id}
                  type="button"
                  title={s.label}
                  onClick={() => {
                    if (i <= stepIndex || (companyId && currency)) setStep(s.id)
                  }}
                  className={cn(
                    'h-1.5 w-7 rounded-full transition sm:w-9',
                    i <= stepIndex ? 'bg-accent' : 'bg-surface-sunken',
                  )}
                />
              ))}
            </div>
            <div className="flex gap-2">
              {step !== 'order' && (
                <Button type="button" onClick={goBack} disabled={pending}>
                  <ArrowLeft size={14} aria-hidden />
                  Back
                </Button>
              )}
              {step !== 'filing' ? (
                <Button
                  type="button"
                  variant="primary"
                  onClick={goNext}
                  disabled={!canContinue}
                >
                  Continue
                  <ArrowRight size={14} aria-hidden />
                </Button>
              ) : (
                <Button
                  type="submit"
                  form="new-import-dialog-form"
                  variant="primary"
                  disabled={pending || !companyId || !currency}
                >
                  {pending ? (
                    <>
                      <Loader2 size={14} className="animate-spin" aria-hidden />
                      Creating…
                    </>
                  ) : (
                    <>
                      <Check size={14} aria-hidden />
                      Create import
                    </>
                  )}
                </Button>
              )}
            </div>
          </div>
        ) : null
      }
    >
      {loading && !options ? (
        <div className="flex items-center justify-center gap-2 py-16 text-ink-muted">
          <Loader2 size={18} className="animate-spin" aria-hidden />
          Loading…
        </div>
      ) : loadError ? (
        <p className="rounded-xl bg-critical-soft px-3 py-2 text-critical">{loadError}</p>
      ) : !options || options.companies.length === 0 ? (
        <div className="py-8 text-center">
          <PackagePlus size={28} className="mx-auto text-ink-faint" aria-hidden />
          <p className="mt-3 font-medium">Add a company first</p>
          <p className="mt-1 text-sm text-ink-muted">
            Every import belongs to an importing entity.
          </p>
          <Link href="/settings" className="mt-4 inline-block" onClick={onClose}>
            <Button variant="primary">Go to Settings</Button>
          </Link>
        </div>
      ) : (
        <form id="new-import-dialog-form" action={formAction} className="space-y-4">
          <input type="hidden" name="company_id" value={companyId} />
          <input type="hidden" name="supplier_id" value={supplierId} />
          <input type="hidden" name="currency" value={currency} />
          <input type="hidden" name="po_number" value={poNumber || suggestion} />

          <div className="mb-2 flex items-center justify-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-accent-soft text-accent">
              <StepIcon size={16} strokeWidth={1.75} aria-hidden />
            </span>
            <p className="text-sm font-medium text-ink">
              Step {stepIndex + 1} of {STEPS.length} — {STEPS[stepIndex]?.label}
            </p>
          </div>

          {/* Step 1: The order */}
          <div className={cn('grid gap-4 sm:grid-cols-2', step !== 'order' && 'hidden')}>
            <Field label="Company" htmlFor="ni_company" required>
              <Select
                id="ni_company"
                value={companyId}
                onChange={(e) => setCompanyId(e.target.value)}
              >
                <option value="">Choose…</option>
                {options.companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Supplier" htmlFor="ni_supplier">
              <Select
                id="ni_supplier"
                value={supplierId}
                onChange={(e) => handleSupplierChange(e.target.value)}
              >
                <option value="">Not decided yet</option>
                {options.suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                    {s.country ? ` — ${s.country}` : ''}
                  </option>
                ))}
              </Select>
            </Field>

            <Field
              label="Description"
              htmlFor="ni_title"
              hint="What this order is for, e.g. 500 panels"
              className="sm:col-span-2"
            >
              <Input
                id="ni_title"
                name="title"
                maxLength={200}
                placeholder="e.g. Xian Shelok — spare parts"
                autoFocus={step === 'order'}
              />
            </Field>

            <Field label="Status" htmlFor="ni_status">
              <Select id="ni_status" name="status" defaultValue="Draft">
                {IMPORT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Currency" htmlFor="ni_currency" required>
              <Select
                id="ni_currency"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
              >
                <option value="">Choose…</option>
                {options.currencies.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Incoterm" htmlFor="ni_incoterm">
              <Select id="ni_incoterm" name="incoterm" defaultValue="">
                <option value="">—</option>
                {options.incoterms.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Origin country" htmlFor="ni_origin">
              <Input
                key={supplierId || 'none'}
                id="ni_origin"
                name="origin_country"
                defaultValue={supplier?.country ?? ''}
              />
            </Field>

            <Field
              label="Payment terms"
              htmlFor="ni_terms"
              hint="As agreed — e.g. 30% advance, 70% before dispatch"
              className="sm:col-span-2"
            >
              <Input
                id="ni_terms"
                name="payment_terms_text"
                placeholder="30% advance, 70% before dispatch"
              />
            </Field>
          </div>

          {/* Step 2: PI and PO */}
          <div className={cn('grid gap-4 sm:grid-cols-2', step !== 'pi' && 'hidden')}>
            <Field label="PI number" htmlFor="ni_pi_number">
              <Input id="ni_pi_number" name="pi_number" />
            </Field>

            <Field label="PI date" htmlFor="ni_pi_date">
              <Input id="ni_pi_date" name="pi_date" type="date" />
            </Field>

            <Field label="PI value" htmlFor="ni_pi_value">
              <Input
                id="ni_pi_value"
                name="pi_value"
                type="number"
                step="0.01"
                min="0"
                className="tnum"
                placeholder="0.00"
              />
            </Field>

            <Field
              label="PO number"
              htmlFor="ni_po_number"
              hint={
                suggestion
                  ? `Suggested: ${suggestion}`
                  : 'Suggested from this company’s template — overwrite it freely'
              }
            >
              <div className="flex gap-2">
                <Input
                  id="ni_po_number"
                  value={poNumber}
                  onChange={(e) => setPoNumber(e.target.value)}
                  placeholder={suggestion}
                  className="font-mono"
                />
                {suggestion && poNumber !== suggestion && (
                  <Button type="button" onClick={() => setPoNumber(suggestion)}>
                    Use
                  </Button>
                )}
              </div>
            </Field>

            <Field label="PO date" htmlFor="ni_po_date">
              <Input id="ni_po_date" name="po_date" type="date" />
            </Field>

            <Field
              label="PO value"
              htmlFor="ni_po_value"
              hint="Leave blank if the same as the PI"
            >
              <Input
                id="ni_po_value"
                name="po_value"
                type="number"
                step="0.01"
                min="0"
                className="tnum"
              />
            </Field>
          </div>

          {/* Step 3: Production */}
          <div className={cn('grid gap-4 sm:grid-cols-3', step !== 'production' && 'hidden')}>
            <Field label="Promised goods-ready" htmlFor="ni_expected_gr">
              <Input id="ni_expected_gr" name="expected_goods_ready" type="date" />
            </Field>

            <Field label="Revised goods-ready" htmlFor="ni_revised_gr">
              <Input id="ni_revised_gr" name="revised_goods_ready" type="date" />
            </Field>

            <Field
              label="Actual goods-ready"
              htmlFor="ni_actual_gr"
              hint="Filling this stops the delay alert"
            >
              <Input id="ni_actual_gr" name="actual_goods_ready" type="date" />
            </Field>
          </div>

          {/* Step 4: Next action */}
          <div className={cn('grid gap-4 sm:grid-cols-2', step !== 'action' && 'hidden')}>
            <Field
              label="What needs doing"
              htmlFor="ni_next"
              className="sm:col-span-2"
            >
              <Input
                id="ni_next"
                name="next_action_title"
                placeholder="Request production update"
                autoFocus={step === 'action'}
              />
            </Field>

            <Field label="Due" htmlFor="ni_due">
              <Input id="ni_due" name="next_action_due" type="date" />
            </Field>

            <Field label="Priority" htmlFor="ni_priority">
              <Select id="ni_priority" name="next_action_priority" defaultValue="normal">
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Waiting on" htmlFor="ni_waiting">
              <Select id="ni_waiting" name="waiting_on" defaultValue="">
                <option value="">—</option>
                {WAITING_ON_OPTIONS.map((w) => (
                  <option key={w} value={w}>
                    {w}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Last contacted" htmlFor="ni_last_contact">
              <Input id="ni_last_contact" name="last_contact_at" type="date" />
            </Field>

            <Field label="Last response" htmlFor="ni_last_response">
              <Input id="ni_last_response" name="last_response_at" type="date" />
            </Field>

            <Field label="Next follow-up" htmlFor="ni_followup">
              <Input id="ni_followup" name="next_followup_at" type="date" />
            </Field>
          </div>

          {/* Step 5: Filing */}
          <div className={cn('grid gap-4', step !== 'filing' && 'hidden')}>
            <Field
              label="Drive folder"
              htmlFor="ni_drive"
              hint="Paste the link to this import's folder"
            >
              <Input
                id="ni_drive"
                name="drive_folder_url"
                type="url"
                placeholder="https://drive.google.com/drive/folders/…"
              />
            </Field>

            <Field label="Notes" htmlFor="ni_notes">
              <Textarea
                id="ni_notes"
                name="notes"
                placeholder="Anything useful for the team…"
              />
            </Field>
          </div>

          {state?.error && (
            <p className="rounded-xl bg-critical-soft px-3 py-2 text-sm text-critical">
              {state.error}
            </p>
          )}
        </form>
      )}
    </Modal>
  )
}
