'use client'

import { useActionState, useState } from 'react'
import { Package, Truck } from 'lucide-react'
import {
  Badge,
  Button,
  EmptyState,
  Fact,
  Field,
  FormGrid,
  Input,
  PanelSection,
  Textarea,
} from '@/components/ui'
import { formatDate } from '@/lib/utils'
import type { DeliveryRecord, Shipment } from '@/lib/types'
import { saveDeliveryRecord, type ActionResult } from './actions'

function DeliveryForm({
  importId,
  shipmentId,
  record,
  onDone,
}: {
  importId: string
  shipmentId: string
  record?: DeliveryRecord
  onDone: () => void
}) {
  const [discrepancy, setDiscrepancy] = useState(
    Boolean(record?.has_shortage || record?.has_damage),
  )

  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    async (prev, formData) => {
      const result = await saveDeliveryRecord(prev, formData)
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
      {record && <input type="hidden" name="id" value={record.id} />}
      <input type="hidden" name="import_id" value={importId} />
      <input type="hidden" name="shipment_id" value={shipmentId} />

      <FormGrid>
        <Field label="Transporter" htmlFor="transporter">
          <Input id="transporter" name="transporter" defaultValue={record?.transporter ?? ''} />
        </Field>
        <Field label="LR number" htmlFor="lr_no">
          <Input id="lr_no" name="lr_no" defaultValue={record?.lr_no ?? ''} />
        </Field>
        <Field label="Vehicle" htmlFor="vehicle_no">
          <Input id="vehicle_no" name="vehicle_no" defaultValue={record?.vehicle_no ?? ''} />
        </Field>
      </FormGrid>

      <FormGrid className="lg:grid-cols-4">
        <Field label="Dispatched" htmlFor="dispatched_at">
          <Input
            id="dispatched_at"
            name="dispatched_at"
            type="date"
            defaultValue={record?.dispatched_at ?? ''}
          />
        </Field>
        <Field label="Expected delivery" htmlFor="expected_delivery">
          <Input
            id="expected_delivery"
            name="expected_delivery"
            type="date"
            defaultValue={record?.expected_delivery ?? ''}
          />
        </Field>
        <Field label="Actual delivery" htmlFor="actual_delivery">
          <Input
            id="actual_delivery"
            name="actual_delivery"
            type="date"
            defaultValue={record?.actual_delivery ?? ''}
          />
        </Field>
        <Field label="Location" htmlFor="delivery_location">
          <Input
            id="delivery_location"
            name="delivery_location"
            defaultValue={record?.delivery_location ?? ''}
          />
        </Field>
      </FormGrid>

      <FormGrid>
        <Field label="Received by" htmlFor="received_by">
          <Input id="received_by" name="received_by" defaultValue={record?.received_by ?? ''} />
        </Field>
        <Field label="Material receipt date" htmlFor="material_receipt_at">
          <Input
            id="material_receipt_at"
            name="material_receipt_at"
            type="date"
            defaultValue={record?.material_receipt_at ?? ''}
          />
        </Field>
        <Field label="MRN" htmlFor="mrn_no">
          <Input id="mrn_no" name="mrn_no" defaultValue={record?.mrn_no ?? ''} />
        </Field>
      </FormGrid>

      <div className="space-y-3 rounded-xl border border-border bg-surface-raised p-4">
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              name="has_shortage"
              defaultChecked={record?.has_shortage}
              onChange={(e) => e.target.checked && setDiscrepancy(true)}
            />
            <span>Short delivery</span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              name="has_damage"
              defaultChecked={record?.has_damage}
              onChange={(e) => e.target.checked && setDiscrepancy(true)}
            />
            <span>Damage</span>
          </label>
        </div>

        {discrepancy && (
          <FormGrid className="lg:grid-cols-[1fr_auto]">
            <Field label="What was wrong" htmlFor="discrepancy_notes" required>
              <Textarea
                id="discrepancy_notes"
                name="discrepancy_notes"
                defaultValue={record?.discrepancy_notes ?? ''}
              />
            </Field>
            <Field label="Shortage qty" htmlFor="shortage_qty">
              <Input
                id="shortage_qty"
                name="shortage_qty"
                type="number"
                step="any"
                className="tnum"
                defaultValue={record?.shortage_qty ?? ''}
              />
            </Field>
          </FormGrid>
        )}
      </div>

      <FormGrid>
        <Field label="Notes" htmlFor="notes" className="lg:col-span-3">
          <Textarea id="notes" name="notes" defaultValue={record?.notes ?? ''} maxLength={2000} />
        </Field>
      </FormGrid>

      {state?.error && <p className="text-critical">{state.error}</p>}

      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? 'Saving…' : 'Save delivery'}
        </Button>
        <Button type="button" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

function DeliveryCard({
  importId,
  shipment,
  record,
}: {
  importId: string
  shipment: Shipment
  record?: DeliveryRecord
}) {
  const [editing, setEditing] = useState(false)
  const label = shipment.shipment_no ?? `Lot ${shipment.seq}`

  const overdue =
    record?.expected_delivery &&
    !record.actual_delivery &&
    new Date(record.expected_delivery) < new Date(new Date().toDateString())

  const iconTone = record?.actual_delivery
    ? 'done'
    : overdue || record?.has_shortage || record?.has_damage
      ? 'critical'
      : 'accent'

  return (
    <PanelSection
      title={
        <span className="flex flex-wrap items-center gap-2">
          {label}
          {record?.actual_delivery && <Badge tone="done">Delivered</Badge>}
          {overdue && <Badge tone="critical">Overdue</Badge>}
          {record?.has_shortage && <Badge tone="critical">Short</Badge>}
          {record?.has_damage && <Badge tone="critical">Damaged</Badge>}
        </span>
      }
      description={
        record
          ? 'Inland transport and material receipt for this lot.'
          : 'No delivery recorded yet for this lot.'
      }
      icon={record?.actual_delivery ? <Package size={15} aria-hidden /> : <Truck size={15} aria-hidden />}
      iconTone={iconTone}
      actions={
        record && !editing ? (
          <Button type="button" onClick={() => setEditing(true)}>
            Edit
          </Button>
        ) : undefined
      }
    >
      {editing ? (
        <DeliveryForm
          importId={importId}
          shipmentId={shipment.id}
          record={record}
          onDone={() => setEditing(false)}
        />
      ) : record ? (
        <>
          <dl className="grid gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-4">
            <Fact label="Transporter">
              {record.transporter ?? '—'}
              {record.lr_no && (
                <span className="ml-2 font-mono text-xs font-normal text-ink-muted">
                  LR {record.lr_no}
                </span>
              )}
            </Fact>
            <Fact label="Dispatched">{formatDate(record.dispatched_at)}</Fact>
            <Fact label={record.actual_delivery ? 'Delivered' : 'Expected'}>
              <span className={overdue ? 'text-critical' : undefined}>
                {formatDate(record.actual_delivery ?? record.expected_delivery)}
              </span>
            </Fact>
            <Fact label="Location">{record.delivery_location ?? '—'}</Fact>
            <Fact label="Received by">{record.received_by ?? '—'}</Fact>
            <Fact label="Material receipt">
              {formatDate(record.material_receipt_at)}
              {record.mrn_no && (
                <span className="ml-2 font-mono text-xs font-normal text-ink-muted">
                  {record.mrn_no}
                </span>
              )}
            </Fact>
          </dl>

          {record.discrepancy_notes && (
            <div className="mt-4 rounded-xl border border-critical/20 bg-critical-soft px-4 py-3 text-critical">
              <p className="font-medium">
                {record.has_shortage && record.has_damage
                  ? 'Shortage and damage'
                  : record.has_shortage
                    ? 'Shortage'
                    : 'Damage'}
                {record.shortage_qty && ` — ${Number(record.shortage_qty)} short`}
              </p>
              <p className="mt-1 whitespace-pre-wrap text-[13px]">{record.discrepancy_notes}</p>
            </div>
          )}

          {record.notes && (
            <p className="mt-4 whitespace-pre-wrap text-[14px] text-ink-muted">{record.notes}</p>
          )}
        </>
      ) : (
        <div className="flex flex-col items-start gap-3 py-1">
          <p className="text-[13px] text-ink-muted">
            Capture transporter and arrival details when the consignment moves inland.
          </p>
          <Button type="button" variant="primary" onClick={() => setEditing(true)}>
            Record delivery
          </Button>
        </div>
      )}
    </PanelSection>
  )
}

export function DeliveryPanel({
  importId,
  shipments,
  records,
}: {
  importId: string
  shipments: Shipment[]
  records: DeliveryRecord[]
}) {
  if (shipments.length === 0) {
    return (
      <EmptyState
        title="No shipments yet"
        description="Delivery is recorded per consignment. Add a shipment first."
      />
    )
  }

  return (
    <div className="space-y-4">
      {shipments.map((shipment) => (
        <DeliveryCard
          key={shipment.id}
          importId={importId}
          shipment={shipment}
          record={records.find((r) => r.shipment_id === shipment.id)}
        />
      ))}
    </div>
  )
}
