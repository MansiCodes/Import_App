'use client'

import { useActionState, useState } from 'react'
import { DollarSign, RotateCcw, Wallet } from 'lucide-react'
import {
  Badge,
  Button,
  CalculatedNotice,
  Field,
  FormGrid,
  Input,
  PanelSection,
  Select,
  Textarea,
} from '@/components/ui'
import { checkScheduleTotal } from '@/lib/payment-schedule'
import { PAYMENT_STATUSES, type ImportPayment, type PaymentStatus, type Refund } from '@/lib/types'
import { dueLabel } from '@/lib/import-status'
import { cn, formatDate, formatMoney } from '@/lib/utils'
import {
  approveSchedule,
  deletePayment,
  generateSchedule,
  recordIdpmsSubmission,
  savePayment,
  saveRefund,
  updatePaymentStatus,
  type ActionResult,
} from './actions'

const STATUS_TONES: Record<PaymentStatus, 'neutral' | 'due' | 'accent' | 'done' | 'critical'> = {
  Planned: 'neutral',
  Due: 'due',
  'Approval Required': 'due',
  Approved: 'accent',
  'Payment Initiated': 'accent',
  Paid: 'done',
  'Supplier Confirmed': 'done',
  Cancelled: 'neutral',
  Refunded: 'critical',
}

const PAID_STATUSES = new Set<PaymentStatus>(['Paid', 'Supplier Confirmed'])

const NESTED_FORM =
  'space-y-4 rounded-xl border border-border bg-surface-sunken/30 p-4'

function FormSaveBar({
  pending,
  label,
  pendingLabel,
  variant = 'primary',
  disabled,
  trailing,
}: {
  pending: boolean
  label: string
  pendingLabel: string
  variant?: 'primary' | 'danger'
  disabled?: boolean
  trailing?: React.ReactNode
}) {
  return (
    <div className="sticky bottom-3 z-10 flex flex-wrap items-center justify-end gap-2 rounded-2xl border border-border bg-surface-raised/95 px-4 py-3 shadow-lg backdrop-blur-md">
      {trailing}
      <Button type="submit" variant={variant} disabled={disabled || pending} className="rounded-xl px-5 py-2.5">
        {pending ? pendingLabel : label}
      </Button>
    </div>
  )
}

function GenerateSchedule({ importId, piValue }: { importId: string; piValue: string | null }) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    generateSchedule,
    null,
  )

  return (
    <form action={formAction} className={NESTED_FORM}>
      <input type="hidden" name="import_id" value={importId} />

      <FormGrid>
        <Field label="Split" htmlFor="terms" hint="e.g. 20/30/50">
          <Input id="terms" name="terms" placeholder="20/30/50" className="font-mono" />
        </Field>

        <Field
          label="Total to split"
          htmlFor="total"
          hint={piValue ? 'Defaults to the PI value' : 'No PI value recorded — enter one'}
        >
          <Input
            id="total"
            name="total"
            type="number"
            step="0.01"
            min="0"
            defaultValue={piValue ?? ''}
            className="tnum"
          />
        </Field>
      </FormGrid>

      {state?.error && <p className="text-critical">{state.error}</p>}

      <FormSaveBar pending={pending} label="Calculate schedule" pendingLabel="Calculating…" />
    </form>
  )
}

function ApproveSchedule({ importId }: { importId: string }) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    approveSchedule,
    null,
  )
  const [confirmed, setConfirmed] = useState(false)

  return (
    <form action={formAction} className="rounded-xl border border-due/30 bg-due-soft p-4">
      <input type="hidden" name="import_id" value={importId} />

      <CalculatedNotice>
        This schedule was calculated, not agreed. Check the amounts and dates against the PI before
        approving.
      </CalculatedNotice>

      <label className="mt-3 flex items-start gap-2">
        <input
          type="checkbox"
          name="confirm"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
          className="mt-0.5 size-4"
        />
        <span>I have checked these instalments against the proforma invoice.</span>
      </label>

      {state?.error && <p className="mt-2 text-critical">{state.error}</p>}

      <Button
        type="submit"
        variant="primary"
        disabled={pending || !confirmed}
        className="mt-3 rounded-xl px-5 py-2.5"
      >
        {pending ? 'Approving…' : 'Approve schedule'}
      </Button>
    </form>
  )
}

function StatusForm({ payment, importId }: { payment: ImportPayment; importId: string }) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    updatePaymentStatus,
    null,
  )

  const [status, setStatus] = useState<PaymentStatus>(payment.status)
  const [confirmed, setConfirmed] = useState(false)

  const movingToPaid = PAID_STATUSES.has(status) && !PAID_STATUSES.has(payment.status)
  const showPaidFields = PAID_STATUSES.has(status)

  return (
    <form action={formAction} className={cn('mt-3', NESTED_FORM)}>
      <input type="hidden" name="id" value={payment.id} />
      <input type="hidden" name="import_id" value={importId} />

      <FormGrid>
        <Field label="Status" htmlFor={`status-${payment.id}`}>
          <Select
            id={`status-${payment.id}`}
            name="status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as PaymentStatus)
              setConfirmed(false)
            }}
          >
            {PAYMENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </Field>

        {showPaidFields && (
          <>
            <Field label="Amount actually paid" htmlFor={`paid-amount-${payment.id}`}>
              <Input
                id={`paid-amount-${payment.id}`}
                name="paid_amount"
                type="number"
                step="0.01"
                min="0"
                defaultValue={payment.paid_amount ?? payment.planned_amount}
                className="tnum"
              />
            </Field>

            <Field label="Date paid" htmlFor={`paid-at-${payment.id}`}>
              <Input
                id={`paid-at-${payment.id}`}
                name="paid_at"
                type="date"
                defaultValue={payment.paid_at ?? ''}
              />
            </Field>

            <Field
              label="Exchange rate"
              htmlFor={`fx-${payment.id}`}
              hint="Optional — INR is only shown if you enter it"
            >
              <Input
                id={`fx-${payment.id}`}
                name="fx_rate"
                type="number"
                step="0.000001"
                min="0"
                defaultValue={payment.fx_rate ?? ''}
                className="tnum"
              />
            </Field>
          </>
        )}

        <Field label="Bank reference" htmlFor={`bank-ref-${payment.id}`}>
          <Input
            id={`bank-ref-${payment.id}`}
            name="bank_reference"
            defaultValue={payment.bank_reference ?? ''}
          />
        </Field>

        <Field label="SWIFT reference" htmlFor={`swift-ref-${payment.id}`}>
          <Input
            id={`swift-ref-${payment.id}`}
            name="swift_reference"
            defaultValue={payment.swift_reference ?? ''}
          />
        </Field>
      </FormGrid>

      {movingToPaid && (
        <label className="flex items-start gap-2 text-critical">
          <input
            type="checkbox"
            name="confirm"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            className="mt-0.5 size-4"
          />
          <span>
            Confirm the money has actually left the account. Nothing else in the system sets this.
          </span>
        </label>
      )}

      {state?.error && <p className="text-critical">{state.error}</p>}

      <FormSaveBar
        pending={pending}
        label="Update payment"
        pendingLabel="Saving…"
        variant={movingToPaid ? 'danger' : 'primary'}
        disabled={movingToPaid && !confirmed}
      />
    </form>
  )
}

function IdpmsForm({ payment, importId }: { payment: ImportPayment; importId: string }) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    recordIdpmsSubmission,
    null,
  )

  return (
    <form action={formAction} className={cn('mt-3', NESTED_FORM)}>
      <input type="hidden" name="id" value={payment.id} />
      <input type="hidden" name="import_id" value={importId} />

      <FormGrid>
        <Field
          label="BOE given to bank on"
          htmlFor={`idpms-${payment.id}`}
          hint="Closes this advance against the Bill of Entry (IDPMS)"
        >
          <Input
            id={`idpms-${payment.id}`}
            name="boe_submitted_to_bank_at"
            type="date"
            defaultValue={payment.boe_submitted_to_bank_at ?? ''}
          />
        </Field>

        <Field label="Notes" htmlFor={`idpms-notes-${payment.id}`} className="sm:col-span-2">
          <Input
            id={`idpms-notes-${payment.id}`}
            name="idpms_notes"
            placeholder="Notes (optional)"
          />
        </Field>
      </FormGrid>

      {state?.error && <p className="text-critical">{state.error}</p>}

      <FormSaveBar pending={pending} label="Record" pendingLabel="Saving…" />
    </form>
  )
}

function DeleteButton({ payment, importId }: { payment: ImportPayment; importId: string }) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    deletePayment,
    null,
  )
  const [confirming, setConfirming] = useState(false)

  if (!confirming) {
    return (
      <Button variant="ghost" onClick={() => setConfirming(true)}>
        Remove
      </Button>
    )
  }

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="id" value={payment.id} />
      <input type="hidden" name="import_id" value={importId} />
      <span className="text-ink-muted">Remove this instalment?</span>
      <Button type="submit" variant="danger" disabled={pending}>
        Yes
      </Button>
      <Button type="button" onClick={() => setConfirming(false)}>
        No
      </Button>
      {state?.error && <span className="text-critical">{state.error}</span>}
    </form>
  )
}

function AddPayment({
  importId,
  currency,
  nextSeq,
  onDone,
}: {
  importId: string
  currency: string
  nextSeq: number
  onDone: () => void
}) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    async (prev, formData) => {
      const result = await savePayment(prev, formData)
      if (result.ok) onDone()
      return result
    },
    null,
  )

  return (
    <form action={formAction} className={NESTED_FORM}>
      <input type="hidden" name="import_id" value={importId} />
      <input type="hidden" name="currency" value={currency} />
      <input type="hidden" name="seq" value={nextSeq} />

      <FormGrid>
        <Field label="Description" htmlFor="new-description" required>
          <Input id="new-description" name="description" required placeholder="Advance" />
        </Field>

        <Field label={`Amount (${currency})`} htmlFor="new-amount" required>
          <Input
            id="new-amount"
            name="planned_amount"
            type="number"
            step="0.01"
            min="0"
            required
            className="tnum"
          />
        </Field>

        <Field label="Due date" htmlFor="new-due">
          <Input id="new-due" name="due_date" type="date" />
        </Field>

        <Field label="Condition" htmlFor="new-condition" hint="e.g. Before dispatch">
          <Input id="new-condition" name="payment_condition" />
        </Field>
      </FormGrid>

      <label className="flex items-center gap-2">
        <input type="checkbox" name="is_advance" className="size-4" />
        This is an advance — track it for IDPMS closure with the bank
      </label>

      {state?.error && <p className="text-critical">{state.error}</p>}

      <FormSaveBar
        pending={pending}
        label="Add instalment"
        pendingLabel="Adding…"
        trailing={
          <Button type="button" onClick={onDone} disabled={pending}>
            Cancel
          </Button>
        }
      />
    </form>
  )
}

function AddRefund({
  importId,
  currency,
  onDone,
}: {
  importId: string
  currency: string
  onDone: () => void
}) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    async (prev, formData) => {
      const result = await saveRefund(prev, formData)
      if (result.ok) onDone()
      return result
    },
    null,
  )

  return (
    <form action={formAction} className={NESTED_FORM}>
      <input type="hidden" name="import_id" value={importId} />
      <input type="hidden" name="currency" value={currency} />

      <FormGrid>
        <Field label={`Amount (${currency})`} htmlFor="refund-amount" required>
          <Input
            id="refund-amount"
            name="amount"
            type="number"
            step="0.01"
            min="0"
            required
            className="tnum"
          />
        </Field>

        <Field label="Status" htmlFor="refund-status">
          <Select id="refund-status" name="status" defaultValue="Expected">
            {['Expected', 'Requested', 'Received', 'Cancelled'].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Requested on" htmlFor="refund-requested">
          <Input id="refund-requested" name="requested_at" type="date" />
        </Field>

        <Field label="Received on" htmlFor="refund-received">
          <Input id="refund-received" name="received_at" type="date" />
        </Field>

        <Field label="Reason" htmlFor="refund-reason" className="sm:col-span-2 lg:col-span-3">
          <Textarea id="refund-reason" name="reason" />
        </Field>
      </FormGrid>

      {state?.error && <p className="text-critical">{state.error}</p>}

      <FormSaveBar
        pending={pending}
        label="Record refund"
        pendingLabel="Saving…"
        trailing={
          <Button type="button" onClick={onDone} disabled={pending}>
            Cancel
          </Button>
        }
      />
    </form>
  )
}

export function PaymentsPanel({
  importId,
  currency,
  piValue,
  scheduleStatus,
  payments,
  refunds,
  idpmsDays,
}: {
  importId: string
  currency: string
  piValue: string | null
  scheduleStatus: 'none' | 'calculated' | 'approved'
  payments: ImportPayment[]
  refunds: Refund[]
  idpmsDays: number
}) {
  const [adding, setAdding] = useState(false)
  const [addingRefund, setAddingRefund] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)

  const check = checkScheduleTotal(
    payments.map((p) => Number(p.planned_amount)),
    piValue === null ? null : Number(piValue),
    currency,
  )

  const nextSeq = payments.reduce((max, p) => Math.max(max, p.seq), 0) + 1

  const paidTotal = payments
    .filter((p) => PAID_STATUSES.has(p.status))
    .reduce((sum, p) => sum + Number(p.paid_amount ?? p.planned_amount), 0)

  const outstandingTotal = payments
    .filter(
      (p) =>
        !PAID_STATUSES.has(p.status) && p.status !== 'Cancelled' && p.status !== 'Refunded',
    )
    .reduce((sum, p) => sum + Number(p.planned_amount), 0)

  const scheduleDescription =
    scheduleStatus === 'approved'
      ? 'Approved instalments for this import.'
      : scheduleStatus === 'calculated'
        ? 'Calculated — not yet approved. Check amounts against the PI.'
        : payments.length === 0
          ? 'Enter the agreed split to calculate instalments. You approve the proposal before it takes effect.'
          : 'Instalments for this import.'

  return (
    <div className="space-y-4">
      <PanelSection
        title="Payment summary"
        description="Invoice value versus what has been paid and what is still outstanding."
        icon={<DollarSign size={15} aria-hidden />}
        iconTone="done"
      >
        <div className="grid gap-2 sm:grid-cols-3">
          <div className="rounded-xl border border-border bg-white px-4 py-3">
            <p className="text-[12px] font-medium text-ink-faint">Invoice / PI value</p>
            <p className="mt-1 text-[15px] font-semibold tnum text-ink">
              {formatMoney(piValue, currency)}
            </p>
          </div>
          <div className="rounded-xl border border-border bg-white px-4 py-3">
            <p className="text-[12px] font-medium text-ink-faint">Paid total</p>
            <p className="mt-1 text-[15px] font-semibold tnum text-ink">
              {formatMoney(paidTotal, currency)}
            </p>
          </div>
          <div className="rounded-xl border border-border bg-white px-4 py-3">
            <p
              className={cn(
                'text-[12px] font-medium',
                outstandingTotal > 0 ? 'text-critical' : 'text-ink-faint',
              )}
            >
              Outstanding
            </p>
            <p
              className={cn(
                'mt-1 text-[15px] font-semibold tnum',
                outstandingTotal > 0 ? 'text-critical' : 'text-ink',
              )}
            >
              {formatMoney(outstandingTotal, currency)}
            </p>
          </div>
        </div>
      </PanelSection>

      <PanelSection
        title="Payment schedule"
        description={scheduleDescription}
        icon={<Wallet size={15} aria-hidden />}
        iconTone={scheduleStatus === 'approved' ? 'done' : scheduleStatus === 'calculated' ? 'due' : 'accent'}
        actions={
          <>
            {scheduleStatus === 'approved' && <Badge tone="done">✓ Approved</Badge>}
            {scheduleStatus === 'calculated' && (
              <Badge tone="due">Calculated — not yet approved</Badge>
            )}
            {payments.length > 0 && (
              <Button onClick={() => setAdding(true)}>Add instalment</Button>
            )}
          </>
        }
      >
        {payments.length === 0 ? (
          <GenerateSchedule importId={importId} piValue={piValue} />
        ) : (
          <div className="space-y-3">
            {!check.ok && (
              <p className="rounded-lg bg-due-soft px-3 py-2 text-due">
                ⚠ {check.message} That is allowed — but worth confirming it is deliberate.
              </p>
            )}

            <ul className="flex flex-col gap-2">
              {payments.map((payment) => {
                const isPaid = PAID_STATUSES.has(payment.status)
                const idpmsOutstanding =
                  payment.is_advance && isPaid && !payment.boe_submitted_to_bank_at

                return (
                  <li
                    key={payment.id}
                    className="rounded-xl border border-border bg-white px-4 py-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-ink-faint tnum">{payment.seq}.</span>
                          <span className="font-medium">{payment.description}</span>
                          <Badge tone={STATUS_TONES[payment.status]}>{payment.status}</Badge>
                          {payment.is_advance && <Badge tone="accent">Advance</Badge>}
                          {idpmsOutstanding && <Badge tone="critical">IDPMS pending</Badge>}
                        </div>

                        <p className="text-ink-muted">
                          {[
                            payment.payment_condition,
                            payment.due_date
                              ? `Due ${formatDate(payment.due_date)} · ${dueLabel(payment.due_date)}`
                              : null,
                            payment.paid_at ? `Paid ${formatDate(payment.paid_at)}` : null,
                            payment.bank_reference ? `Ref ${payment.bank_reference}` : null,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </p>
                      </div>

                      <div className="flex items-center gap-3 whitespace-nowrap">
                        <div className="text-right">
                          <div className="tnum font-medium">
                            {formatMoney(payment.planned_amount, payment.currency)}
                          </div>
                          {payment.inr_amount && (
                            <div className="text-ink-muted tnum">
                              ₹{Number(payment.inr_amount).toLocaleString('en-IN')}
                            </div>
                          )}
                        </div>

                        <Button
                          variant="ghost"
                          onClick={() => setExpanded(expanded === payment.id ? null : payment.id)}
                        >
                          {expanded === payment.id ? 'Close' : 'Update'}
                        </Button>

                        {!isPaid && <DeleteButton payment={payment} importId={importId} />}
                      </div>
                    </div>

                    {expanded === payment.id && (
                      <>
                        <StatusForm payment={payment} importId={importId} />
                        {payment.is_advance && isPaid && (
                          <IdpmsForm payment={payment} importId={importId} />
                        )}
                      </>
                    )}

                    {idpmsOutstanding && expanded !== payment.id && (
                      <p className="mt-2 text-critical">
                        Advance remitted — the Bill of Entry must reach the bank within{' '}
                        {idpmsDays} days of payment to close IDPMS.
                      </p>
                    )}
                  </li>
                )
              })}
            </ul>

            {scheduleStatus === 'calculated' && <ApproveSchedule importId={importId} />}
          </div>
        )}

        {adding && (
          <div className="mt-3">
            <AddPayment
              importId={importId}
              currency={currency}
              nextSeq={nextSeq}
              onDone={() => setAdding(false)}
            />
          </div>
        )}
      </PanelSection>

      <PanelSection
        title="Refunds"
        description={
          refunds.length === 0 && !addingRefund
            ? 'No refunds on this import.'
            : 'Money expected back from the supplier.'
        }
        icon={<RotateCcw size={15} aria-hidden />}
        iconTone="neutral"
        actions={<Button onClick={() => setAddingRefund(true)}>Record refund</Button>}
      >
        {addingRefund || refunds.length > 0 ? (
          <div className="space-y-3">
            {addingRefund && (
              <AddRefund
                importId={importId}
                currency={currency}
                onDone={() => setAddingRefund(false)}
              />
            )}

            {refunds.length > 0 && (
              <ul className="flex flex-col gap-2">
                {refunds.map((refund) => (
                  <li
                    key={refund.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-white px-4 py-2.5"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="tnum font-medium">
                          {formatMoney(refund.amount, refund.currency)}
                        </span>
                        <Badge tone={refund.status === 'Received' ? 'done' : 'due'}>
                          {refund.status}
                        </Badge>
                      </div>
                      {refund.reason && (
                        <p className="text-ink-muted">{refund.reason}</p>
                      )}
                    </div>
                    <span className="text-ink-muted">
                      {refund.received_at
                        ? `Received ${formatDate(refund.received_at)}`
                        : refund.requested_at
                          ? `Requested ${formatDate(refund.requested_at)}`
                          : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
      </PanelSection>
    </div>
  )
}
