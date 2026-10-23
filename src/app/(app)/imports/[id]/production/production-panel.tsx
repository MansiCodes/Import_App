'use client'

import { useActionState, useRef, useState } from 'react'
import { Activity, CalendarDays, ListOrdered } from 'lucide-react'
import {
  Badge,
  Button,
  EmptyState,
  Field,
  FormGrid,
  Input,
  PanelSection,
  Select,
  Textarea,
} from '@/components/ui'
import { formatDate, formatMoney } from '@/lib/utils'
import { PRODUCTION_STAGES, type ProductionUpdate } from '@/lib/types'
import {
  addProductionUpdate,
  deleteImportItem,
  saveGoodsReadyDates,
  saveImportItem,
  type ActionResult,
} from './actions'

interface ImportItem {
  id: string
  line_no: number | null
  description: string
  hsn_code: string | null
  quantity: string | null
  unit: string | null
  unit_price: string | null
  amount: string | null
  is_foc: boolean
  remarks: string | null
}

const today = () => new Date().toISOString().slice(0, 10)

const NESTED_FORM =
  'space-y-4 rounded-xl border border-border bg-surface-sunken/30 p-4'

function FormSaveBar({
  pending,
  label,
  pendingLabel,
  trailing,
  hint,
}: {
  pending: boolean
  label: string
  pendingLabel: string
  trailing?: React.ReactNode
  hint?: string
}) {
  return (
    <div className="sticky bottom-3 z-10 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-surface-raised/95 px-4 py-3 shadow-lg backdrop-blur-md">
      {hint ? <p className="text-[13px] text-ink-muted">{hint}</p> : <span />}
      <div className="flex items-center gap-2">
        {trailing}
        <Button
          type="submit"
          variant="primary"
          disabled={pending}
          className="rounded-xl px-5 py-2.5"
        >
          {pending ? pendingLabel : label}
        </Button>
      </div>
    </div>
  )
}

/**
 * Goods-ready dates.
 *
 * Three fields rather than one, because the difference between them is the
 * whole point: promised, re-promised, and what actually happened.
 */
function GoodsReady({
  importId,
  expected,
  revised,
  actual,
}: {
  importId: string
  expected: string | null
  revised: string | null
  actual: string | null
}) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    saveGoodsReadyDates,
    null,
  )

  const slipDays =
    actual && expected
      ? Math.round(
          (new Date(actual).getTime() - new Date(expected).getTime()) / 86_400_000,
        )
      : null

  const badge = actual ? (
    <Badge tone="done">Confirmed ready</Badge>
  ) : revised ? (
    <Badge tone="due">Date revised</Badge>
  ) : (
    <Badge tone="neutral">Awaiting confirmation</Badge>
  )

  return (
    <PanelSection
      title="Goods ready"
      description="Promised, revised, and actual readiness — kept as three dates so slip is visible."
      icon={<CalendarDays size={15} aria-hidden />}
      iconTone="due"
      actions={badge}
    >
      <form action={formAction} className="space-y-4">
        <input type="hidden" name="import_id" value={importId} />

        <FormGrid>
          <Field label="Originally promised" htmlFor="expected_goods_ready">
            <Input
              id="expected_goods_ready"
              name="expected_goods_ready"
              type="date"
              defaultValue={expected ?? ''}
            />
          </Field>
          <Field
            label="Revised promise"
            htmlFor="revised_goods_ready"
            hint="Leave the original alone"
          >
            <Input
              id="revised_goods_ready"
              name="revised_goods_ready"
              type="date"
              defaultValue={revised ?? ''}
            />
          </Field>
          <Field label="Actually ready" htmlFor="actual_goods_ready">
            <Input
              id="actual_goods_ready"
              name="actual_goods_ready"
              type="date"
              defaultValue={actual ?? ''}
            />
          </Field>
        </FormGrid>

        {slipDays !== null && slipDays > 0 && (
          <p className="text-critical">
            {slipDays} {slipDays === 1 ? 'day' : 'days'} later than first promised.
          </p>
        )}
        {slipDays !== null && slipDays <= 0 && (
          <p className="text-done">On or ahead of the original promise.</p>
        )}

        {state?.error && <p className="text-critical">{state.error}</p>}

        <FormSaveBar
          pending={pending}
          label="Save dates"
          pendingLabel="Saving…"
          hint="Update readiness dates when the supplier confirms."
        />
      </form>
    </PanelSection>
  )
}

function UpdateForm({
  importId,
  onDone,
}: {
  importId: string
  onDone?: () => void
}) {
  const formRef = useRef<HTMLFormElement>(null)

  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    async (prev, formData) => {
      const result = await addProductionUpdate(prev, formData)
      if (result.ok) {
        formRef.current?.reset()
        onDone?.()
      }
      return result
    },
    null,
  )

  return (
    <form ref={formRef} action={formAction} className={NESTED_FORM}>
      <input type="hidden" name="import_id" value={importId} />

      <FormGrid>
        <Field label="Reported on" htmlFor="reported_on" required>
          <Input id="reported_on" name="reported_on" type="date" required defaultValue={today()} />
        </Field>
        <Field label="Stage" htmlFor="stage">
          <Select id="stage" name="stage" defaultValue="">
            <option value="">—</option>
            {PRODUCTION_STAGES.map((stage) => (
              <option key={stage} value={stage}>
                {stage}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Percent complete" htmlFor="percent_complete">
          <Input
            id="percent_complete"
            name="percent_complete"
            type="number"
            min={0}
            max={100}
            step="1"
          />
        </Field>
        <Field label="Promised ready by" htmlFor="promised_ready_date">
          <Input id="promised_ready_date" name="promised_ready_date" type="date" />
        </Field>
        <Field
          label="Where this came from"
          htmlFor="source"
          hint="Email, call, inspection visit"
          className="sm:col-span-2"
        >
          <Input id="source" name="source" placeholder="Email from Mr Chen, 14 Aug" />
        </Field>
        <Field label="What they said" htmlFor="detail" className="sm:col-span-2 lg:col-span-3">
          <Textarea id="detail" name="detail" maxLength={2000} />
        </Field>
      </FormGrid>

      {state?.error && <p className="text-critical">{state.error}</p>}

      <FormSaveBar
        pending={pending}
        label="Record update"
        pendingLabel="Recording…"
        trailing={
          onDone ? (
            <Button type="button" onClick={onDone}>
              Cancel
            </Button>
          ) : undefined
        }
      />
    </form>
  )
}

function UpdatesList({ updates }: { updates: ProductionUpdate[] }) {
  if (updates.length === 0) {
    return (
      <p className="py-2 text-ink-faint">
        Nothing recorded yet. Each update is kept, so a promise that moves three times reads as
        three entries rather than one overwritten date.
      </p>
    )
  }

  return (
    <ul className="divide-y divide-border">
      {updates.map((update) => (
        <li key={update.id} className="py-3 first:pt-0 last:pb-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{formatDate(update.reported_on)}</span>
            {update.stage && <Badge tone="accent">{update.stage}</Badge>}
            {update.percent_complete !== null && (
              <Badge tone="neutral">{Number(update.percent_complete)}%</Badge>
            )}
            {update.promised_ready_date && (
              <Badge tone="due">Ready by {formatDate(update.promised_ready_date)}</Badge>
            )}
          </div>
          {update.detail && <p className="mt-1 whitespace-pre-wrap">{update.detail}</p>}
          {update.source && <p className="mt-1 text-xs text-ink-faint">Source: {update.source}</p>}
        </li>
      ))}
    </ul>
  )
}

function UpdatesSection({
  importId,
  updates,
}: {
  importId: string
  updates: ProductionUpdate[]
}) {
  const [recording, setRecording] = useState(false)

  return (
    <PanelSection
      title="Updates"
      description="A running log of what the supplier reported — each entry is kept."
      icon={<Activity size={15} aria-hidden />}
      iconTone="accent"
      actions={
        !recording ? (
          <Button type="button" onClick={() => setRecording(true)}>
            Record update
          </Button>
        ) : undefined
      }
    >
      <div className="space-y-4">
        <UpdatesList updates={updates} />
        {recording && (
          <UpdateForm importId={importId} onDone={() => setRecording(false)} />
        )}
      </div>
    </PanelSection>
  )
}

function ItemRow({
  item,
  importId,
  currency,
}: {
  item: ImportItem
  importId: string
  currency: string
}) {
  const [editing, setEditing] = useState(false)
  const [, deleteAction, deleting] = useActionState<ActionResult | null, FormData>(
    deleteImportItem,
    null,
  )

  if (editing) {
    return (
      <tr>
        <td colSpan={7} className="p-0">
          <div className="px-5 py-4">
            <ItemForm
              importId={importId}
              item={item}
              currency={currency}
              onDone={() => setEditing(false)}
            />
          </div>
        </td>
      </tr>
    )
  }

  return (
    <tr className="border-t border-border hover:bg-surface-sunken/50">
      <td className="px-5 py-2 tnum">{item.line_no ?? '—'}</td>
      <td className="px-3 py-2">
        {item.description}
        {item.is_foc && (
          <Badge tone="waiting" className="ml-2">
            Free of charge
          </Badge>
        )}
        {item.hsn_code && <span className="ml-2 text-xs text-ink-faint">HSN {item.hsn_code}</span>}
      </td>
      <td className="px-3 py-2 text-right tnum">
        {item.quantity ? Number(item.quantity).toLocaleString('en-IN') : '—'} {item.unit ?? ''}
      </td>
      <td className="px-3 py-2 text-right tnum">{formatMoney(item.unit_price, currency)}</td>
      <td className="px-3 py-2 text-right tnum">{formatMoney(item.amount, currency)}</td>
      <td className="px-3 py-2 text-right">
        <Button type="button" variant="ghost" onClick={() => setEditing(true)}>
          Edit
        </Button>
      </td>
      <td className="px-3 py-2 pr-5 text-right">
        <form action={deleteAction}>
          <input type="hidden" name="id" value={item.id} />
          <input type="hidden" name="import_id" value={importId} />
          <Button type="submit" variant="ghost" disabled={deleting} className="text-critical">
            Remove
          </Button>
        </form>
      </td>
    </tr>
  )
}

function ItemForm({
  importId,
  item,
  currency,
  onDone,
}: {
  importId: string
  item?: ImportItem
  currency: string
  onDone: () => void
}) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    async (prev, formData) => {
      const result = await saveImportItem(prev, formData)
      if (result.ok) onDone()
      return result
    },
    null,
  )

  return (
    <form action={formAction} className={NESTED_FORM}>
      {item && <input type="hidden" name="id" value={item.id} />}
      <input type="hidden" name="import_id" value={importId} />

      <FormGrid>
        <Field label="Line" htmlFor="line_no">
          <Input id="line_no" name="line_no" type="number" min={1} defaultValue={item?.line_no ?? ''} />
        </Field>
        <Field label="HSN code" htmlFor="hsn_code">
          <Input id="hsn_code" name="hsn_code" defaultValue={item?.hsn_code ?? ''} />
        </Field>
        <Field label="Quantity" htmlFor="quantity">
          <Input
            id="quantity"
            name="quantity"
            type="number"
            step="any"
            defaultValue={item?.quantity ?? ''}
          />
        </Field>
        <Field label="Unit" htmlFor="unit">
          <Input id="unit" name="unit" placeholder="pcs" defaultValue={item?.unit ?? ''} />
        </Field>
        <Field label="Description" htmlFor="description" required className="sm:col-span-2">
          <Input id="description" name="description" required defaultValue={item?.description ?? ''} />
        </Field>
        <Field label={`Unit price (${currency})`} htmlFor="unit_price">
          <Input
            id="unit_price"
            name="unit_price"
            type="number"
            step="any"
            defaultValue={item?.unit_price ?? ''}
          />
        </Field>
        <Field
          label={`Line amount (${currency})`}
          htmlFor="amount"
          hint="Left blank, this is quantity × unit price"
        >
          <Input id="amount" name="amount" type="number" step="any" defaultValue={item?.amount ?? ''} />
        </Field>
      </FormGrid>

      <label className="flex items-center gap-2">
        <input type="checkbox" name="is_foc" defaultChecked={item?.is_foc} />
        <span>
          Free of charge — still declared to customs, but not owed to the supplier
        </span>
      </label>

      {state?.error && <p className="text-critical">{state.error}</p>}

      <FormSaveBar
        pending={pending}
        label="Save line"
        pendingLabel="Saving…"
        trailing={
          <Button type="button" onClick={onDone}>
            Cancel
          </Button>
        }
      />
    </form>
  )
}

export function ProductionPanel({
  importId,
  currency,
  expected,
  revised,
  actual,
  updates,
  items,
}: {
  importId: string
  currency: string
  expected: string | null
  revised: string | null
  actual: string | null
  updates: ProductionUpdate[]
  items: ImportItem[]
}) {
  const [adding, setAdding] = useState(false)

  const charged = items
    .filter((i) => !i.is_foc)
    .reduce((sum, i) => sum + Number(i.amount ?? 0), 0)
  const focCount = items.filter((i) => i.is_foc).length

  return (
    <div className="space-y-5">
      <GoodsReady importId={importId} expected={expected} revised={revised} actual={actual} />

      <UpdatesSection importId={importId} updates={updates} />

      <PanelSection
        title="Invoice lines"
        description="Optional line items for checking the invoice against packing lists or the Bill of Entry."
        icon={<ListOrdered size={15} aria-hidden />}
        actions={
          !adding ? (
            <Button type="button" onClick={() => setAdding(true)}>
              Add line
            </Button>
          ) : undefined
        }
        bodyClassName={items.length === 0 && !adding ? undefined : 'px-0 pt-4 pb-5'}
      >
        {items.length === 0 && !adding ? (
          <EmptyState
            title="No lines recorded"
            description="Optional. Worth entering when the invoice has to be checked line by line against the packing list or the Bill of Entry."
            action={
              <Button type="button" variant="primary" onClick={() => setAdding(true)}>
                Add the first line
              </Button>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="text-left text-[12px] text-ink-faint">
                <tr>
                  <th className="px-5 py-2 font-medium">#</th>
                  <th className="px-3 py-2 font-medium">Description</th>
                  <th className="px-3 py-2 text-right font-medium">Qty</th>
                  <th className="px-3 py-2 text-right font-medium">Unit price</th>
                  <th className="px-3 py-2 text-right font-medium">Amount</th>
                  <th />
                  <th className="pr-5" />
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <ItemRow key={item.id} item={item} importId={importId} currency={currency} />
                ))}
              </tbody>
              {items.length > 0 && (
                <tfoot className="border-t border-border">
                  <tr>
                    <td colSpan={4} className="px-5 py-2 text-right font-medium">
                      Chargeable total
                      {focCount > 0 && (
                        <span className="ml-2 font-normal text-ink-faint">
                          ({focCount} free-of-charge {focCount === 1 ? 'line' : 'lines'} excluded)
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right font-medium tnum">
                      {formatMoney(charged, currency)}
                    </td>
                    <td colSpan={2} className="pr-5" />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}

        {adding && (
          <div className="mt-3 px-5">
            <ItemForm importId={importId} currency={currency} onDone={() => setAdding(false)} />
          </div>
        )}
      </PanelSection>
    </div>
  )
}
