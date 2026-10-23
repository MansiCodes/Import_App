'use client'

import { useActionState, useState } from 'react'
import { ShieldCheck } from 'lucide-react'
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
import { QUERY_STATUSES, type CustomsRecord, type Shipment } from '@/lib/types'
import {
  pushDutyToCosts,
  saveCustomsQuery,
  saveCustomsRecord,
  verifyCustoms,
  type ActionResult,
} from './actions'

const DUTY_HEADS = [
  { name: 'bcd', label: 'Basic customs duty' },
  { name: 'sws', label: 'Social welfare surcharge' },
  { name: 'igst', label: 'IGST' },
  { name: 'compensation_cess', label: 'Compensation cess' },
  { name: 'other_duty', label: 'Other duty' },
] as const

function CustomsForm({
  importId,
  shipmentId,
  record,
  onDone,
}: {
  importId: string
  shipmentId: string
  record?: CustomsRecord
  onDone: () => void
}) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    async (prev, formData) => {
      const result = await saveCustomsRecord(prev, formData)
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

      <FormGrid className="lg:grid-cols-5">
        <Field label="BOE number" htmlFor="boe_no">
          <Input id="boe_no" name="boe_no" defaultValue={record?.boe_no ?? ''} />
        </Field>
        <Field label="BOE date" htmlFor="boe_date">
          <Input id="boe_date" name="boe_date" type="date" defaultValue={record?.boe_date ?? ''} />
        </Field>
        <Field label="Type" htmlFor="boe_type" hint="Home / warehouse">
          <Input id="boe_type" name="boe_type" defaultValue={record?.boe_type ?? ''} />
        </Field>
        <Field label="Port code" htmlFor="port_code">
          <Input id="port_code" name="port_code" defaultValue={record?.port_code ?? ''} />
        </Field>
        <Field label="ICEGATE reference" htmlFor="icegate_ref">
          <Input id="icegate_ref" name="icegate_ref" defaultValue={record?.icegate_ref ?? ''} />
        </Field>
      </FormGrid>

      <FormGrid className="lg:grid-cols-2">
        <Field label="Assessable value (INR)" htmlFor="assessable_value">
          <Input
            id="assessable_value"
            name="assessable_value"
            type="number"
            step="any"
            className="tnum"
            defaultValue={record?.assessable_value ?? ''}
          />
        </Field>
        <Field
          label="Customs exchange rate"
          htmlFor="exchange_rate"
          hint="The notified rate on the BOE, not the bank's"
        >
          <Input
            id="exchange_rate"
            name="exchange_rate"
            type="number"
            step="any"
            className="tnum"
            defaultValue={record?.exchange_rate ?? ''}
          />
        </Field>
      </FormGrid>

      <FormGrid className="lg:grid-cols-5">
        {DUTY_HEADS.map(({ name, label }) => (
          <Field key={name} label={label} htmlFor={name}>
            <Input
              id={name}
              name={name}
              type="number"
              step="any"
              className="tnum"
              defaultValue={(record?.[name] as string | null) ?? ''}
            />
          </Field>
        ))}
      </FormGrid>

      <FormGrid>
        <Field
          label="Total duty"
          htmlFor="total_duty"
          hint="Left blank, the heads are summed. A typed total always wins."
        >
          <Input
            id="total_duty"
            name="total_duty"
            type="number"
            step="any"
            className="tnum"
            defaultValue={record?.total_duty ?? ''}
          />
        </Field>
        <Field label="Duty paid on" htmlFor="duty_paid_at">
          <Input
            id="duty_paid_at"
            name="duty_paid_at"
            type="date"
            defaultValue={record?.duty_paid_at ?? ''}
          />
        </Field>
        <Field label="Challan number" htmlFor="duty_challan_no">
          <Input
            id="duty_challan_no"
            name="duty_challan_no"
            defaultValue={record?.duty_challan_no ?? ''}
          />
        </Field>
      </FormGrid>

      <FormGrid>
        <Field label="Examination" htmlFor="examination_at">
          <Input
            id="examination_at"
            name="examination_at"
            type="date"
            defaultValue={record?.examination_at?.slice(0, 10) ?? ''}
          />
        </Field>
        <Field label="Out of charge" htmlFor="oocc_at">
          <Input
            id="oocc_at"
            name="oocc_at"
            type="date"
            defaultValue={record?.oocc_at?.slice(0, 10) ?? ''}
          />
        </Field>
        <Field label="Cleared" htmlFor="cleared_at">
          <Input
            id="cleared_at"
            name="cleared_at"
            type="date"
            defaultValue={record?.cleared_at?.slice(0, 10) ?? ''}
          />
        </Field>
      </FormGrid>

      <FormGrid>
        <Field label="Gate pass" htmlFor="gate_pass_no">
          <Input id="gate_pass_no" name="gate_pass_no" defaultValue={record?.gate_pass_no ?? ''} />
        </Field>
        <Field label="E-way bill" htmlFor="eway_bill_no">
          <Input id="eway_bill_no" name="eway_bill_no" defaultValue={record?.eway_bill_no ?? ''} />
        </Field>
        <Field label="E-way bill valid till" htmlFor="eway_bill_valid_till">
          <Input
            id="eway_bill_valid_till"
            name="eway_bill_valid_till"
            type="date"
            defaultValue={record?.eway_bill_valid_till ?? ''}
          />
        </Field>
      </FormGrid>

      <FormGrid>
        <Field label="Notes" htmlFor="notes" className="lg:col-span-3">
          <Textarea id="notes" name="notes" defaultValue={record?.notes ?? ''} maxLength={2000} />
        </Field>
      </FormGrid>

      {state?.error && <p className="text-critical">{state.error}</p>}

      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? 'Saving…' : 'Save customs record'}
        </Button>
        <Button type="button" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

function QueryForm({ importId, record }: { importId: string; record: CustomsRecord }) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    saveCustomsQuery,
    null,
  )

  return (
    <form
      action={formAction}
      className="mt-4 space-y-4 rounded-xl border border-border bg-surface-sunken/30 p-4"
    >
      <input type="hidden" name="id" value={record.id} />
      <input type="hidden" name="import_id" value={importId} />

      <FormGrid>
        <Field label="Query status" htmlFor={`qs-${record.id}`}>
          <Select id={`qs-${record.id}`} name="query_status" defaultValue={record.query_status}>
            {QUERY_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s === 'none' ? 'No query' : s}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Raised on" htmlFor={`qr-${record.id}`}>
          <Input
            id={`qr-${record.id}`}
            name="query_raised_at"
            type="date"
            defaultValue={record.query_raised_at ?? ''}
          />
        </Field>
        <Field label="Replied on" htmlFor={`qp-${record.id}`}>
          <Input
            id={`qp-${record.id}`}
            name="query_replied_at"
            type="date"
            defaultValue={record.query_replied_at ?? ''}
          />
        </Field>
        <Field label="What customs asked" htmlFor={`qt-${record.id}`} className="lg:col-span-3">
          <Textarea id={`qt-${record.id}`} name="query_text" defaultValue={record.query_text ?? ''} />
        </Field>
      </FormGrid>

      {state?.error && <p className="text-critical">{state.error}</p>}

      <Button type="submit" disabled={pending}>
        {pending ? 'Saving…' : 'Save query'}
      </Button>
    </form>
  )
}

function VerifyBlock({
  importId,
  record,
  target,
}: {
  importId: string
  record: CustomsRecord
  target: 'boe' | 'duty'
}) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    verifyCustoms,
    null,
  )

  const status = target === 'boe' ? record.boe_verification_status : record.duty_verification_status
  const settled = status === 'verified' || status === 'approved'

  if (settled) {
    return (
      <div className="flex items-center gap-2">
        <Badge tone="done">
          ✓ {target === 'boe' ? 'BOE verified' : 'Duty approved'}
        </Badge>
        <span className="text-xs text-ink-faint">
          {formatDate(target === 'boe' ? record.boe_verified_at : record.duty_verified_at)}
        </span>
      </div>
    )
  }

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="id" value={record.id} />
      <input type="hidden" name="import_id" value={importId} />
      <input type="hidden" name="target" value={target} />
      <input type="hidden" name="decision" value="verified" />

      <label className="flex items-start gap-2">
        <input type="checkbox" name="confirm" className="mt-1" />
        <span>
          {target === 'boe'
            ? 'I have read the Bill of Entry against the commercial invoice and packing list.'
            : 'I have checked every duty head against the challan.'}
        </span>
      </label>

      <Field label="Remarks" htmlFor={`vr-${record.id}-${target}`}>
        <Input id={`vr-${record.id}-${target}`} name="remarks" />
      </Field>

      {state?.error && <p className="text-critical">{state.error}</p>}

      <Button type="submit" variant="primary" disabled={pending}>
        {pending ? 'Recording…' : target === 'boe' ? 'Verify BOE' : 'Approve duty'}
      </Button>
    </form>
  )
}

function CustomsCard({
  importId,
  shipment,
  record,
}: {
  importId: string
  shipment: Shipment
  record?: CustomsRecord
}) {
  const [editing, setEditing] = useState(false)
  const [, pushAction, pushing] = useActionState<ActionResult | null, FormData>(
    pushDutyToCosts,
    null,
  )

  const label = shipment.shipment_no ?? `Lot ${shipment.seq}`
  const iconTone = record?.cleared_at
    ? 'done'
    : record?.query_status === 'open'
      ? 'critical'
      : 'accent'

  return (
    <PanelSection
      title={
        <span className="flex flex-wrap items-center gap-2">
          {label}
          <Badge tone="accent">{shipment.mode}</Badge>
          {record?.boe_no && (
            <span className="font-mono text-sm font-normal text-ink-muted">BOE {record.boe_no}</span>
          )}
          {record?.query_status === 'open' && <Badge tone="critical">Query open</Badge>}
          {record?.cleared_at && <Badge tone="done">Cleared</Badge>}
        </span>
      }
      description={
        record
          ? 'Bill of Entry, duty heads, and clearance dates for this lot.'
          : 'No customs record yet for this lot.'
      }
      icon={<ShieldCheck size={15} aria-hidden />}
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
        <CustomsForm
          importId={importId}
          shipmentId={shipment.id}
          record={record}
          onDone={() => setEditing(false)}
        />
      ) : record ? (
        <>
          <dl className="grid gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-4">
            <Fact label="BOE date">{formatDate(record.boe_date)}</Fact>
            <Fact label="Assessable value">
              <span className="tnum">{formatMoney(record.assessable_value, 'INR')}</span>
            </Fact>
            <Fact label="Total duty">
              <span className="tnum">{formatMoney(record.total_duty, 'INR')}</span>
            </Fact>
            <Fact label="Duty paid">{formatDate(record.duty_paid_at)}</Fact>
            <Fact label="Out of charge">{formatDate(record.oocc_at)}</Fact>
            <Fact label="Gate pass">
              <span className="font-mono">{record.gate_pass_no ?? '—'}</span>
            </Fact>
            <Fact label="E-way bill">
              <span className="font-mono">{record.eway_bill_no ?? '—'}</span>
            </Fact>
            <Fact label="Cleared">{formatDate(record.cleared_at)}</Fact>
          </dl>

          {record.total_duty !== null && record.duty_verification_status === 'calculated' && (
            <div className="mt-4">
              <CalculatedNotice>
                Duty totals {formatMoney(record.total_duty, 'INR')} from the heads entered. Check it
                against the challan before it reaches the landed cost.
              </CalculatedNotice>
            </div>
          )}

          <div className="mt-5 grid gap-4 border-t border-border pt-4 sm:grid-cols-2">
            <div className="space-y-3 rounded-xl border border-border bg-surface-sunken/30 p-4">
              <p className="text-[13px] font-semibold text-ink">Bill of Entry</p>
              <VerifyBlock importId={importId} record={record} target="boe" />
            </div>
            <div className="space-y-3 rounded-xl border border-border bg-surface-sunken/30 p-4">
              <p className="text-[13px] font-semibold text-ink">Duty figures</p>
              <VerifyBlock importId={importId} record={record} target="duty" />

              {record.duty_verification_status === 'approved' && record.total_duty !== null && (
                <form action={pushAction} className="mt-1">
                  <input type="hidden" name="id" value={record.id} />
                  <input type="hidden" name="import_id" value={importId} />
                  <Button type="submit" disabled={pushing}>
                    {pushing ? 'Adding…' : 'Add duty to landed cost'}
                  </Button>
                </form>
              )}
            </div>
          </div>

          <QueryForm importId={importId} record={record} />
        </>
      ) : (
        <div className="flex flex-col items-start gap-3 py-1">
          <p className="text-[13px] text-ink-muted">
            Add the Bill of Entry and duty figures when clearance starts.
          </p>
          <Button type="button" variant="primary" onClick={() => setEditing(true)}>
            Record customs
          </Button>
        </div>
      )}
    </PanelSection>
  )
}

export function CustomsPanel({
  importId,
  shipments,
  records,
}: {
  importId: string
  shipments: Shipment[]
  records: CustomsRecord[]
}) {
  if (shipments.length === 0) {
    return (
      <EmptyState
        title="No shipments yet"
        description="A Bill of Entry clears a consignment, not an order. Add a shipment first and its customs entry belongs to that lot."
      />
    )
  }

  return (
    <div className="space-y-4">
      {shipments.map((shipment) => (
        <CustomsCard
          key={shipment.id}
          importId={importId}
          shipment={shipment}
          record={records.find((r) => r.shipment_id === shipment.id)}
        />
      ))}
    </div>
  )
}
