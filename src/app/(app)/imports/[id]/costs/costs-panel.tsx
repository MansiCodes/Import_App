'use client'

import { useActionState, useState } from 'react'
import Link from 'next/link'
import { Archive, Calculator, Receipt } from 'lucide-react'
import {
  Badge,
  Button,
  CalculatedNotice,
  EmptyState,
  Fact,
  Field,
  FormGrid,
  Input,
  PanelSection,
  Select,
  Textarea,
} from '@/components/ui'
import { formatDate, formatMoney } from '@/lib/utils'
import {
  COST_TYPES,
  COST_TYPE_LABELS,
  type CostType,
  type ImportCost,
  type LandedCost,
  type LandedCostByCurrency,
  type Shipment,
} from '@/lib/types'
import {
  approveLandedCost,
  closeImport,
  deleteCost,
  reopenImport,
  saveCost,
  type ActionResult,
} from './actions'

function CostForm({
  importId,
  currency,
  shipments,
  cost,
  onDone,
}: {
  importId: string
  currency: string
  shipments: Shipment[]
  cost?: ImportCost
  onDone: () => void
}) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    async (prev, formData) => {
      const result = await saveCost(prev, formData)
      if (result.ok) onDone()
      return result
    },
    null,
  )

  return (
    <form
      action={formAction}
      className="space-y-4 rounded-xl border border-border bg-surface-sunken/30 p-4"
    >
      {cost && <input type="hidden" name="id" value={cost.id} />}
      <input type="hidden" name="import_id" value={importId} />

      <FormGrid className="lg:grid-cols-4">
        <Field label="Cost type" htmlFor="cost_type" required>
          <Select id="cost_type" name="cost_type" required defaultValue={cost?.cost_type ?? 'freight'}>
            {COST_TYPES.map((t) => (
              <option key={t} value={t}>
                {COST_TYPE_LABELS[t]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Vendor" htmlFor="vendor">
          <Input id="vendor" name="vendor" defaultValue={cost?.vendor ?? ''} />
        </Field>
        <Field label="Invoice number" htmlFor="invoice_no">
          <Input id="invoice_no" name="invoice_no" defaultValue={cost?.invoice_no ?? ''} />
        </Field>
        <Field label="Incurred on" htmlFor="incurred_on">
          <Input
            id="incurred_on"
            name="incurred_on"
            type="date"
            defaultValue={cost?.incurred_on ?? ''}
          />
        </Field>
      </FormGrid>

      <FormGrid>
        <Field label="Description" htmlFor="description" className="lg:col-span-3">
          <Input id="description" name="description" defaultValue={cost?.description ?? ''} />
        </Field>
      </FormGrid>

      <FormGrid className="lg:grid-cols-4">
        <Field label="Currency" htmlFor="currency" required>
          <Input
            id="currency"
            name="currency"
            required
            maxLength={5}
            defaultValue={cost?.currency ?? currency}
          />
        </Field>
        <Field label="Amount" htmlFor="amount" required>
          <Input
            id="amount"
            name="amount"
            type="number"
            step="any"
            required
            className="tnum"
            defaultValue={cost?.amount ?? ''}
          />
        </Field>
        <Field
          label="Exchange rate to INR"
          htmlFor="fx_rate"
          hint="Leave blank if not known — it will not be guessed"
        >
          <Input
            id="fx_rate"
            name="fx_rate"
            type="number"
            step="any"
            className="tnum"
            defaultValue={cost?.fx_rate ?? ''}
          />
        </Field>
        <Field label="Against lot" htmlFor="shipment_id" hint="Blank = whole order">
          <Select id="shipment_id" name="shipment_id" defaultValue={cost?.shipment_id ?? ''}>
            <option value="">Whole order</option>
            {shipments.map((s) => (
              <option key={s.id} value={s.id}>
                Lot {s.seq}
                {s.shipment_no ? ` — ${s.shipment_no}` : ''}
              </option>
            ))}
          </Select>
        </Field>
      </FormGrid>

      <label className="flex items-center gap-2">
        <input type="checkbox" name="is_estimate" defaultChecked={cost?.is_estimate} />
        <span>This is an estimate, not an invoiced figure</span>
      </label>

      <FormGrid>
        <Field label="Notes" htmlFor="notes" className="lg:col-span-3">
          <Textarea id="notes" name="notes" defaultValue={cost?.notes ?? ''} maxLength={2000} />
        </Field>
      </FormGrid>

      {state?.error && <p className="text-critical">{state.error}</p>}

      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? 'Saving…' : 'Save line'}
        </Button>
        <Button type="button" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

function CostRow({
  cost,
  importId,
  currency,
  shipments,
}: {
  cost: ImportCost
  importId: string
  currency: string
  shipments: Shipment[]
}) {
  const [editing, setEditing] = useState(false)
  const [, deleteAction, deleting] = useActionState<ActionResult | null, FormData>(deleteCost, null)

  if (editing) {
    return (
      <li className="list-none">
        <CostForm
          importId={importId}
          currency={currency}
          shipments={shipments}
          cost={cost}
          onDone={() => setEditing(false)}
        />
      </li>
    )
  }

  return (
    <li className="rounded-xl border border-border bg-white px-4 py-3.5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[14px] font-semibold text-ink">
              {COST_TYPE_LABELS[cost.cost_type as CostType] ?? cost.cost_type}
            </span>
            {cost.is_estimate && <Badge tone="due">Estimate</Badge>}
            {cost.logistics_invoice_id && <Badge tone="accent">Product Costing</Badge>}
          </div>
          <p className="mt-0.5 text-[13px] text-ink-muted">
            {[
              cost.description || null,
              cost.vendor || null,
              cost.shipment_seq ? `Lot ${cost.shipment_seq}` : 'Whole order',
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <dl className="grid grid-cols-3 gap-x-5 text-right">
            <Fact label="Amount">
              <span className="tnum">{formatMoney(cost.amount, cost.currency)}</span>
            </Fact>
            <Fact label="Rate">
              <span className="tnum">
                {cost.fx_rate ? (
                  Number(cost.fx_rate).toFixed(4)
                ) : (
                  <span className="text-critical">no rate</span>
                )}
              </span>
            </Fact>
            <Fact label="INR">
              <span className="tnum">
                {cost.inr_amount ? formatMoney(cost.inr_amount, 'INR') : '—'}
              </span>
            </Fact>
          </dl>

          <div className="flex shrink-0 items-center gap-1">
            {cost.logistics_invoice_id ? (
              <Link
                href={`/imports/${importId}/product-costing?view=setup`}
                className="px-2 text-[13px] font-medium text-accent hover:underline"
              >
                Edit in Product Costing
              </Link>
            ) : (
              <>
                <Button type="button" variant="ghost" onClick={() => setEditing(true)}>
                  Edit
                </Button>
                <form action={deleteAction} className="inline">
                  <input type="hidden" name="id" value={cost.id} />
                  <input type="hidden" name="import_id" value={importId} />
                  <Button type="submit" variant="ghost" disabled={deleting} className="text-critical">
                    Remove
                  </Button>
                </form>
              </>
            )}
          </div>
        </div>
      </div>
    </li>
  )
}

function Closure({
  importId,
  status,
  closedAt,
  closureNotes,
}: {
  importId: string
  status: string
  closedAt: string | null
  closureNotes: string | null
}) {
  const [closeState, closeAction, closing] = useActionState<ActionResult | null, FormData>(
    closeImport,
    null,
  )
  const [reopenState, reopenAction, reopening] = useActionState<ActionResult | null, FormData>(
    reopenImport,
    null,
  )

  if (status === 'Closed') {
    return (
      <PanelSection
        title="Closure"
        description={`Closed ${formatDate(closedAt)}.`}
        icon={<Archive size={15} aria-hidden />}
        iconTone="done"
        actions={<Badge tone="done">Closed</Badge>}
      >
        {closureNotes && (
          <p className="mb-4 whitespace-pre-wrap text-[14px] text-ink-muted">{closureNotes}</p>
        )}
        <form
          action={reopenAction}
          className="space-y-4 rounded-xl border border-border bg-surface-sunken/30 p-4"
        >
          <input type="hidden" name="import_id" value={importId} />
          <FormGrid className="lg:grid-cols-[1fr_auto] sm:grid-cols-[1fr_auto]">
            <Field label="Why is this being reopened?" htmlFor="reopen-reason">
              <Input id="reopen-reason" name="reason" placeholder="Refund still to come back" />
            </Field>
            <div className="flex items-end">
              <Button type="submit" disabled={reopening}>
                {reopening ? 'Reopening…' : 'Reopen'}
              </Button>
            </div>
          </FormGrid>
          {reopenState?.error && <p className="text-critical">{reopenState.error}</p>}
        </form>
      </PanelSection>
    )
  }

  return (
    <PanelSection
      title="Closure"
      description="Closing removes this import from the working lists."
      icon={<Archive size={15} aria-hidden />}
      iconTone="neutral"
    >
      <form
        action={closeAction}
        className="space-y-4 rounded-xl border border-border bg-surface-sunken/30 p-4"
      >
        <input type="hidden" name="import_id" value={importId} />

        <p className="text-[13px] text-ink-muted">
          Outstanding payments and an unapproved landed cost do not block it — they are recorded on
          the timeline so the decision is visible.
        </p>

        <FormGrid>
          <Field label="Closing notes" htmlFor="closure_notes" className="lg:col-span-3">
            <Textarea id="closure_notes" name="closure_notes" maxLength={2000} />
          </Field>
          <Field label="Type CLOSE to confirm" htmlFor="close-confirm">
            <Input id="close-confirm" name="confirm" placeholder="CLOSE" />
          </Field>
        </FormGrid>

        {closeState?.error && <p className="text-critical">{closeState.error}</p>}

        <Button type="submit" variant="danger" disabled={closing}>
          {closing ? 'Closing…' : 'Close this import'}
        </Button>
      </form>
    </PanelSection>
  )
}

export function CostsPanel({
  importId,
  currency,
  status,
  closedAt,
  closureNotes,
  costs,
  shipments,
  rollup,
  byCurrency,
}: {
  importId: string
  currency: string
  status: string
  closedAt: string | null
  closureNotes: string | null
  costs: ImportCost[]
  shipments: Shipment[]
  rollup: LandedCost | null
  byCurrency: LandedCostByCurrency[]
}) {
  const [adding, setAdding] = useState(false)

  const [approveState, approveAction, approving] = useActionState<ActionResult | null, FormData>(
    approveLandedCost,
    null,
  )

  const unconverted = rollup ? Number(rollup.unconverted_count) : 0
  const estimates = rollup ? Number(rollup.estimate_count) : 0
  const approved = rollup?.landed_cost_status === 'approved'

  return (
    <div className="space-y-4">
      <PanelSection
        title="Landed cost"
        description="Product, freight, insurance, duty and charges rolled into INR."
        icon={<Calculator size={15} aria-hidden />}
        iconTone={approved ? 'done' : rollup && Number(rollup.line_count) > 0 ? 'due' : 'accent'}
        actions={
          approved ? (
            <Badge tone="done">✓ Approved {formatDate(rollup?.landed_cost_verified_at)}</Badge>
          ) : rollup && Number(rollup.line_count) > 0 ? (
            <Badge tone="due">Calculated</Badge>
          ) : undefined
        }
      >
        {!rollup || Number(rollup.line_count) === 0 ? (
          <p className="text-[13px] text-ink-muted">
            No cost lines yet. Product value, freight, insurance, duty, CHA charges and inland
            transport together make the landed cost.
          </p>
        ) : (
          <div className="space-y-4">
            <dl className="grid gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-4">
              {(
                [
                  ['Product', rollup.inr_product],
                  ['Freight', rollup.inr_freight],
                  ['Insurance', rollup.inr_insurance],
                  ['Duty', rollup.inr_duty],
                  ['CHA', rollup.inr_cha],
                  ['Other', rollup.inr_other],
                ] as const
              ).map(([label, value]) =>
                Number(value) > 0 ? (
                  <Fact key={label} label={label}>
                    <span className="tnum">{formatMoney(value, 'INR')}</span>
                  </Fact>
                ) : null,
              )}
            </dl>

            <div className="rounded-xl border border-border bg-surface-sunken/30 p-4">
              <p className="text-[12px] font-medium text-ink-faint">
                Total in INR, from the lines that have a rate
              </p>
              <p className="mt-1 text-xl font-semibold tnum text-ink">
                {formatMoney(rollup.inr_total, 'INR')}
              </p>
              {estimates > 0 && (
                <p className="mt-1 text-[13px] text-ink-muted">
                  Includes {formatMoney(rollup.inr_estimate_total, 'INR')} still estimated across{' '}
                  {estimates} {estimates === 1 ? 'line' : 'lines'}.
                </p>
              )}
            </div>

            {byCurrency.length > 0 && (
              <div>
                <p className="mb-2 text-[12px] font-medium text-ink-faint">
                  By currency, as transacted
                </p>
                <ul className="flex flex-wrap gap-x-6 gap-y-1">
                  {byCurrency.map((row) => (
                    <li key={row.currency} className="tnum text-[14px] font-medium text-ink">
                      {formatMoney(row.amount_total, row.currency)}
                      {Number(row.unconverted_count) > 0 && (
                        <span className="ml-1 text-critical">
                          ({row.unconverted_count} unconverted)
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {unconverted > 0 && (
              <p className="rounded-xl border border-critical/20 bg-critical-soft px-4 py-3 text-critical">
                {unconverted} {unconverted === 1 ? 'line has' : 'lines have'} no exchange rate, so
                the INR total above is incomplete. Nothing has been converted at a guessed rate.
              </p>
            )}

            {!approved && (
              <div className="space-y-3 rounded-xl border border-border bg-surface-sunken/30 p-4">
                <CalculatedNotice>
                  This total is calculated from the lines below. Check it before it is used for
                  pricing or closure.
                </CalculatedNotice>

                <form action={approveAction} className="space-y-3">
                  <input type="hidden" name="import_id" value={importId} />
                  <label className="flex items-start gap-2">
                    <input type="checkbox" name="confirm" className="mt-1" />
                    <span>
                      I have checked every cost line and every exchange rate against its invoice.
                    </span>
                  </label>
                  {approveState?.error && <p className="text-critical">{approveState.error}</p>}
                  <Button type="submit" variant="primary" disabled={approving}>
                    {approving ? 'Recording…' : 'Approve landed cost'}
                  </Button>
                </form>
              </div>
            )}
          </div>
        )}
      </PanelSection>

      <PanelSection
        title="Cost lines"
        description={
          costs.length === 0
            ? 'Add each invoice as it arrives.'
            : `${costs.length} ${costs.length === 1 ? 'line' : 'lines'} on this order.`
        }
        icon={<Receipt size={15} aria-hidden />}
        iconTone="accent"
        actions={
          !adding && costs.length > 0 ? (
            <Button type="button" onClick={() => setAdding(true)}>
              Add line
            </Button>
          ) : undefined
        }
      >
        {costs.length === 0 && !adding ? (
          <EmptyState
            title="No costs recorded"
            description="Add each invoice as it arrives. Duty can be copied straight across from the customs tab once it has been verified."
            action={
              <Button type="button" variant="primary" onClick={() => setAdding(true)}>
                Add the first line
              </Button>
            }
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {costs.map((cost) => (
              <CostRow
                key={cost.id}
                cost={cost}
                importId={importId}
                currency={currency}
                shipments={shipments}
              />
            ))}
          </ul>
        )}

        {adding && (
          <div className={costs.length > 0 ? 'mt-4' : ''}>
            <CostForm
              importId={importId}
              currency={currency}
              shipments={shipments}
              onDone={() => setAdding(false)}
            />
          </div>
        )}
      </PanelSection>

      <Closure
        importId={importId}
        status={status}
        closedAt={closedAt}
        closureNotes={closureNotes}
      />
    </div>
  )
}
