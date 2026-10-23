'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { calculateSchedule, parsePercentageTerms } from '@/lib/payment-schedule'
import { PAYMENT_STATUSES } from '@/lib/types'
import { createClient, getOperator } from '@/lib/supabase/server'

export interface ActionResult {
  ok: boolean
  error?: string
}

function emptyToNull(value: FormDataEntryValue | null): string | null {
  const str = typeof value === 'string' ? value.trim() : ''
  return str === '' ? null : str
}

const optionalMoney = z
  .union([z.string(), z.null()])
  .transform((v) => (v === null || v === '' ? null : Number(v)))
  .refine((v) => v === null || (Number.isFinite(v) && v >= 0), 'Must be a positive amount')

async function logActivity(importId: string, title: string, detail?: string | null) {
  const supabase = await createClient()
  const operator = await getOperator()

  await supabase.from('activity_log').insert({
    import_id: importId,
    event_type: 'payment',
    title,
    detail: detail ?? null,
    created_by: operator?.id ?? null,
  })
}

function revalidate(importId: string) {
  revalidatePath(`/imports/${importId}/payments`)
  revalidatePath(`/imports/${importId}`)
  revalidatePath('/payments')
  revalidatePath('/review')
  revalidatePath('/')
}

const generateSchema = z.object({
  import_id: z.string().uuid(),
  terms: z.string().trim().min(1, 'Enter the split, e.g. 20/30/50'),
  total: optionalMoney,
})

/**
 * Work out a schedule from a percentage split.
 *
 * Produces `calculated` rows and marks the import's schedule as CALCULATED —
 * explicitly not approved. Nothing acts on these figures until a human confirms
 * them (spec §14).
 */
export async function generateSchedule(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = generateSchema.safeParse({
    import_id: formData.get('import_id'),
    terms: formData.get('terms'),
    total: emptyToNull(formData.get('total')),
  })

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }

  const percentages = parsePercentageTerms(parsed.data.terms)
  if (!percentages) {
    return { ok: false, error: 'Could not read that split. Try something like 20/30/50.' }
  }

  const supabase = await createClient()
  const { data: imp } = await supabase
    .from('imports')
    .select('id, currency, pi_value')
    .eq('id', parsed.data.import_id)
    .single()

  if (!imp) return { ok: false, error: 'Import not found' }

  const total = parsed.data.total ?? (imp.pi_value === null ? null : Number(imp.pi_value))
  if (total === null || total <= 0) {
    return { ok: false, error: 'Enter the PI value first, or give a total to split.' }
  }

  const { count } = await supabase
    .from('import_payments')
    .select('id', { count: 'exact', head: true })
    .eq('import_id', parsed.data.import_id)

  if ((count ?? 0) > 0) {
    return {
      ok: false,
      error: 'This import already has payments. Delete them first, or add instalments manually.',
    }
  }

  let instalments
  try {
    instalments = calculateSchedule(
      total,
      percentages.map((percentage, index) => ({
        description:
          index === 0
            ? 'Advance'
            : index === percentages.length - 1
              ? 'Balance'
              : `Instalment ${index + 1}`,
        percentage,
      })),
    )
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Could not calculate' }
  }

  const { error } = await supabase.from('import_payments').insert(
    instalments.map((instalment) => ({
      import_id: parsed.data.import_id,
      seq: instalment.seq,
      description: instalment.description,
      currency: imp.currency,
      planned_amount: instalment.amount,
      percentage: instalment.percentage,
      is_advance: instalment.isAdvance,
      status: 'Planned',
    })),
  )

  if (error) return { ok: false, error: error.message }

  await supabase
    .from('imports')
    .update({ payment_schedule_status: 'calculated' })
    .eq('id', parsed.data.import_id)

  await logActivity(
    parsed.data.import_id,
    `Payment schedule calculated (${percentages.join('/')})`,
    'Awaiting approval',
  )

  revalidate(parsed.data.import_id)
  return { ok: true }
}

const approveScheduleSchema = z.object({
  import_id: z.string().uuid(),
  confirm: z.literal('on', { message: 'Tick the box to confirm you have checked the schedule' }),
})

export async function approveSchedule(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = approveScheduleSchema.safeParse({
    import_id: formData.get('import_id'),
    confirm: formData.get('confirm'),
  })

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }

  const supabase = await createClient()
  const operator = await getOperator()

  const { error } = await supabase
    .from('imports')
    .update({
      payment_schedule_status: 'approved',
      payment_schedule_verified_by: operator?.id ?? null,
      payment_schedule_verified_at: new Date().toISOString(),
    })
    .eq('id', parsed.data.import_id)

  if (error) return { ok: false, error: error.message }

  await logActivity(parsed.data.import_id, 'Payment schedule approved')
  revalidate(parsed.data.import_id)
  return { ok: true }
}

const paymentSchema = z.object({
  id: z.string().uuid().optional(),
  import_id: z.string().uuid(),
  seq: z.coerce.number().int().min(1),
  description: z.string().trim().min(1, 'Describe the instalment').max(200),
  payment_condition: z.string().trim().max(500).nullable(),
  currency: z.string().trim().min(1).max(5),
  planned_amount: z
    .union([z.string(), z.number()])
    .transform(Number)
    .refine((v) => Number.isFinite(v) && v > 0, 'Enter an amount'),
  due_date: z.union([z.string(), z.null()]).transform((v) => (v === '' ? null : v)),
  is_advance: z.coerce.boolean(),
  notes: z.string().trim().max(2000).nullable(),
})

export async function savePayment(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = paymentSchema.safeParse({
    id: formData.get('id') || undefined,
    import_id: formData.get('import_id'),
    seq: formData.get('seq'),
    description: formData.get('description'),
    payment_condition: emptyToNull(formData.get('payment_condition')),
    currency: formData.get('currency'),
    planned_amount: formData.get('planned_amount'),
    due_date: emptyToNull(formData.get('due_date')),
    is_advance: formData.get('is_advance') === 'on',
    notes: emptyToNull(formData.get('notes')),
  })

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }

  const { id, ...values } = parsed.data
  const supabase = await createClient()

  const { error } = id
    ? await supabase.from('import_payments').update(values).eq('id', id)
    : await supabase.from('import_payments').insert(values)

  if (error) {
    return {
      ok: false,
      error:
        error.code === '23505'
          ? `Instalment ${values.seq} already exists on this import.`
          : error.message,
    }
  }

  revalidate(values.import_id)
  return { ok: true }
}

const statusSchema = z.object({
  id: z.string().uuid(),
  import_id: z.string().uuid(),
  status: z.enum(PAYMENT_STATUSES),
  paid_amount: optionalMoney,
  paid_at: z.union([z.string(), z.null()]).transform((v) => (v === '' ? null : v)),
  fx_rate: z
    .union([z.string(), z.null()])
    .transform((v) => (v === null || v === '' ? null : Number(v)))
    .refine((v) => v === null || (Number.isFinite(v) && v > 0), 'Enter a valid exchange rate'),
  bank_reference: z.string().trim().max(200).nullable(),
  swift_reference: z.string().trim().max(200).nullable(),
  confirm: z.string().nullable(),
})

/**
 * Move a payment along its status.
 *
 * Reaching Paid or Supplier Confirmed requires an explicit tick and a paid
 * date. Nothing in the system marks a payment paid on its own — a due date
 * passing is an alert, not a state change (spec §13).
 */
export async function updatePaymentStatus(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = statusSchema.safeParse({
    id: formData.get('id'),
    import_id: formData.get('import_id'),
    status: formData.get('status'),
    paid_amount: emptyToNull(formData.get('paid_amount')),
    paid_at: emptyToNull(formData.get('paid_at')),
    fx_rate: emptyToNull(formData.get('fx_rate')),
    bank_reference: emptyToNull(formData.get('bank_reference')),
    swift_reference: emptyToNull(formData.get('swift_reference')),
    confirm: emptyToNull(formData.get('confirm')),
  })

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }

  const movingToPaid = parsed.data.status === 'Paid' || parsed.data.status === 'Supplier Confirmed'

  if (movingToPaid) {
    if (parsed.data.confirm !== 'on') {
      return { ok: false, error: 'Tick the confirmation — this records that money actually left.' }
    }
    if (!parsed.data.paid_at) {
      return { ok: false, error: 'Enter the date the payment was actually made.' }
    }
  }

  const supabase = await createClient()
  const operator = await getOperator()

  const { data: existing } = await supabase
    .from('import_payments')
    .select('description, currency, planned_amount, status')
    .eq('id', parsed.data.id)
    .single()

  const patch: Record<string, unknown> = {
    status: parsed.data.status,
    bank_reference: parsed.data.bank_reference,
    swift_reference: parsed.data.swift_reference,
    fx_rate: parsed.data.fx_rate,
  }

  if (parsed.data.status === 'Approved') {
    patch.approved_at = new Date().toISOString()
    patch.approved_by = operator?.id ?? null
  }

  if (movingToPaid) {
    const amount = parsed.data.paid_amount ?? Number(existing?.planned_amount ?? 0)
    patch.paid_amount = amount
    patch.paid_at = parsed.data.paid_at
    patch.paid_by = operator?.id ?? null
    // INR only when a human supplied the rate — never fetched, never guessed.
    patch.inr_amount = parsed.data.fx_rate ? Number((amount * parsed.data.fx_rate).toFixed(2)) : null
  }

  const { error } = await supabase.from('import_payments').update(patch).eq('id', parsed.data.id)
  if (error) return { ok: false, error: error.message }

  await logActivity(
    parsed.data.import_id,
    `${existing?.description ?? 'Payment'} — ${existing?.status ?? '?'} → ${parsed.data.status}`,
    parsed.data.bank_reference ? `Ref ${parsed.data.bank_reference}` : null,
  )

  revalidate(parsed.data.import_id)
  return { ok: true }
}

const idpmsSchema = z.object({
  id: z.string().uuid(),
  import_id: z.string().uuid(),
  boe_submitted_to_bank_at: z.string().min(1, 'Enter the date you gave the BOE to the bank'),
  idpms_notes: z.string().trim().max(1000).nullable(),
})

/** Record that the Bill of Entry has been filed with the bank, closing IDPMS. */
export async function recordIdpmsSubmission(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = idpmsSchema.safeParse({
    id: formData.get('id'),
    import_id: formData.get('import_id'),
    boe_submitted_to_bank_at: formData.get('boe_submitted_to_bank_at'),
    idpms_notes: emptyToNull(formData.get('idpms_notes')),
  })

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }

  const supabase = await createClient()
  const { error } = await supabase
    .from('import_payments')
    .update({
      boe_submitted_to_bank_at: parsed.data.boe_submitted_to_bank_at,
      idpms_notes: parsed.data.idpms_notes,
    })
    .eq('id', parsed.data.id)

  if (error) return { ok: false, error: error.message }

  await logActivity(parsed.data.import_id, 'Bill of Entry submitted to bank (IDPMS)')
  revalidate(parsed.data.import_id)
  return { ok: true }
}

export async function deletePayment(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const id = formData.get('id')
  const importId = formData.get('import_id')
  if (typeof id !== 'string' || typeof importId !== 'string') {
    return { ok: false, error: 'Invalid input' }
  }

  const supabase = await createClient()

  // A payment that has been made is a financial record, not a draft.
  const { data: payment } = await supabase
    .from('import_payments')
    .select('status, description')
    .eq('id', id)
    .single()

  if (payment && ['Paid', 'Supplier Confirmed'].includes(payment.status)) {
    return {
      ok: false,
      error: 'This payment is recorded as paid. Cancel it instead of deleting the record.',
    }
  }

  const { error } = await supabase.from('import_payments').delete().eq('id', id)
  if (error) return { ok: false, error: error.message }

  await logActivity(importId, `Payment removed: ${payment?.description ?? ''}`)
  revalidate(importId)
  return { ok: true }
}

const refundSchema = z.object({
  import_id: z.string().uuid(),
  currency: z.string().trim().min(1).max(5),
  amount: z
    .union([z.string(), z.number()])
    .transform(Number)
    .refine((v) => Number.isFinite(v) && v > 0, 'Enter an amount'),
  reason: z.string().trim().max(1000).nullable(),
  status: z.enum(['Expected', 'Requested', 'Received', 'Cancelled']),
  requested_at: z.union([z.string(), z.null()]).transform((v) => (v === '' ? null : v)),
  received_at: z.union([z.string(), z.null()]).transform((v) => (v === '' ? null : v)),
  bank_reference: z.string().trim().max(200).nullable(),
})

export async function saveRefund(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = refundSchema.safeParse({
    import_id: formData.get('import_id'),
    currency: formData.get('currency'),
    amount: formData.get('amount'),
    reason: emptyToNull(formData.get('reason')),
    status: formData.get('status'),
    requested_at: emptyToNull(formData.get('requested_at')),
    received_at: emptyToNull(formData.get('received_at')),
    bank_reference: emptyToNull(formData.get('bank_reference')),
  })

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }

  const supabase = await createClient()
  const { error } = await supabase.from('refunds').insert(parsed.data)

  if (error) return { ok: false, error: error.message }

  await logActivity(
    parsed.data.import_id,
    `Refund recorded: ${parsed.data.currency} ${parsed.data.amount}`,
    parsed.data.reason,
  )

  revalidate(parsed.data.import_id)
  return { ok: true }
}
