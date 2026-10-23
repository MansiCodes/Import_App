'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { QUERY_STATUSES } from '@/lib/types'
import { createClient, getOperator } from '@/lib/supabase/server'

export interface ActionResult {
  ok: boolean
  error?: string
}

function emptyToNull(value: FormDataEntryValue | null): string | null {
  const str = typeof value === 'string' ? value.trim() : ''
  return str === '' ? null : str
}

const nullableDate = z.union([z.string(), z.null()]).transform((v) => (v === '' ? null : v))
const nullableText = z.string().trim().max(500).nullable()
const nullableMoney = z
  .union([z.string(), z.null()])
  .transform((v) => (v === null || v === '' ? null : Number(v)))
  .refine((v) => v === null || (Number.isFinite(v) && v >= 0), 'Must be a positive amount')

async function logActivity(importId: string, title: string, detail?: string | null) {
  const supabase = await createClient()
  const operator = await getOperator()

  await supabase.from('activity_log').insert({
    import_id: importId,
    event_type: 'customs',
    title,
    detail: detail ?? null,
    created_by: operator?.id ?? null,
  })
}

function revalidate(importId: string) {
  revalidatePath(`/imports/${importId}/customs`)
  revalidatePath(`/imports/${importId}/costs`)
  revalidatePath(`/imports/${importId}`)
  revalidatePath('/review')
  revalidatePath('/')
}

const customsSchema = z.object({
  id: z.string().uuid().optional(),
  import_id: z.string().uuid(),
  shipment_id: z.string().uuid(),

  boe_no: nullableText,
  boe_date: nullableDate,
  boe_type: nullableText,
  port_code: nullableText,
  icegate_ref: nullableText,

  assessable_value: nullableMoney,
  exchange_rate: z
    .union([z.string(), z.null()])
    .transform((v) => (v === null || v === '' ? null : Number(v)))
    .refine((v) => v === null || (Number.isFinite(v) && v > 0), 'Enter a valid rate'),
  bcd: nullableMoney,
  sws: nullableMoney,
  igst: nullableMoney,
  compensation_cess: nullableMoney,
  other_duty: nullableMoney,
  total_duty: nullableMoney,
  duty_paid_at: nullableDate,
  duty_challan_no: nullableText,

  examination_at: nullableDate,
  oocc_at: nullableDate,
  cleared_at: nullableDate,
  gate_pass_no: nullableText,
  eway_bill_no: nullableText,
  eway_bill_valid_till: nullableDate,

  notes: z.string().trim().max(2000).nullable(),
})

/**
 * Save the Bill of Entry and its duty heads.
 *
 * `total_duty` is computed from the heads only when the operator left it blank.
 * The challan states its own total, and where the two disagree that disagreement
 * is worth seeing rather than papering over — so a typed total always wins.
 *
 * Entering duty figures moves the duty verification back to `calculated`: new
 * numbers are unconfirmed numbers, whoever approved the previous ones.
 */
export async function saveCustomsRecord(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = customsSchema.safeParse({
    id: formData.get('id') || undefined,
    import_id: formData.get('import_id'),
    shipment_id: formData.get('shipment_id'),
    boe_no: emptyToNull(formData.get('boe_no')),
    boe_date: emptyToNull(formData.get('boe_date')),
    boe_type: emptyToNull(formData.get('boe_type')),
    port_code: emptyToNull(formData.get('port_code')),
    icegate_ref: emptyToNull(formData.get('icegate_ref')),
    assessable_value: emptyToNull(formData.get('assessable_value')),
    exchange_rate: emptyToNull(formData.get('exchange_rate')),
    bcd: emptyToNull(formData.get('bcd')),
    sws: emptyToNull(formData.get('sws')),
    igst: emptyToNull(formData.get('igst')),
    compensation_cess: emptyToNull(formData.get('compensation_cess')),
    other_duty: emptyToNull(formData.get('other_duty')),
    total_duty: emptyToNull(formData.get('total_duty')),
    duty_paid_at: emptyToNull(formData.get('duty_paid_at')),
    duty_challan_no: emptyToNull(formData.get('duty_challan_no')),
    examination_at: emptyToNull(formData.get('examination_at')),
    oocc_at: emptyToNull(formData.get('oocc_at')),
    cleared_at: emptyToNull(formData.get('cleared_at')),
    gate_pass_no: emptyToNull(formData.get('gate_pass_no')),
    eway_bill_no: emptyToNull(formData.get('eway_bill_no')),
    eway_bill_valid_till: emptyToNull(formData.get('eway_bill_valid_till')),
    notes: emptyToNull(formData.get('notes')),
  })

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }

  const { id, ...values } = parsed.data

  const heads = [
    values.bcd,
    values.sws,
    values.igst,
    values.compensation_cess,
    values.other_duty,
  ]

  if (values.total_duty === null && heads.some((h) => h !== null)) {
    values.total_duty = Number(
      heads.reduce((sum: number, h) => sum + (h ?? 0), 0).toFixed(4),
    )
  }

  const hasDutyFigures = values.total_duty !== null || heads.some((h) => h !== null)

  const supabase = await createClient()

  const patch: Record<string, unknown> = { ...values }
  if (hasDutyFigures) {
    patch.duty_verification_status = 'calculated'
    patch.duty_verified_by = null
    patch.duty_verified_at = null
  }
  if (values.boe_no) {
    // A BOE that has arrived is received, not verified. Only an explicit human
    // action moves it further, and only if it is not already there.
    patch.boe_verification_status = id ? undefined : 'received'
  }

  Object.keys(patch).forEach((k) => patch[k] === undefined && delete patch[k])

  const { error } = id
    ? await supabase.from('customs_records').update(patch).eq('id', id)
    : await supabase.from('customs_records').insert(patch)

  if (error) {
    return {
      ok: false,
      error:
        error.code === '23505'
          ? 'This shipment already has a customs record. Edit that one instead.'
          : error.message,
    }
  }

  await logActivity(
    values.import_id,
    id
      ? `Customs record updated — BOE ${values.boe_no ?? '(unnumbered)'}`
      : `Bill of Entry filed — ${values.boe_no ?? '(unnumbered)'}`,
    values.total_duty !== null ? `Duty ${values.total_duty}` : null,
  )

  revalidate(values.import_id)
  return { ok: true }
}

const querySchema = z.object({
  id: z.string().uuid(),
  import_id: z.string().uuid(),
  query_status: z.enum(QUERY_STATUSES),
  query_text: z.string().trim().max(4000).nullable(),
  query_raised_at: nullableDate,
  query_replied_at: nullableDate,
})

/** Record a customs query, and whether it is still open. */
export async function saveCustomsQuery(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = querySchema.safeParse({
    id: formData.get('id'),
    import_id: formData.get('import_id'),
    query_status: formData.get('query_status'),
    query_text: emptyToNull(formData.get('query_text')),
    query_raised_at: emptyToNull(formData.get('query_raised_at')),
    query_replied_at: emptyToNull(formData.get('query_replied_at')),
  })

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }

  const { id, import_id, ...values } = parsed.data
  const supabase = await createClient()

  const { error } = await supabase.from('customs_records').update(values).eq('id', id)
  if (error) return { ok: false, error: error.message }

  await logActivity(
    import_id,
    values.query_status === 'open'
      ? 'Customs query raised'
      : `Customs query ${values.query_status}`,
    values.query_text,
  )

  revalidate(import_id)
  return { ok: true }
}

const verifySchema = z.object({
  id: z.string().uuid(),
  import_id: z.string().uuid(),
  target: z.enum(['boe', 'duty']),
  decision: z.enum(['verified', 'rejected']),
  remarks: z.string().trim().max(1000).nullable(),
  confirm: z.string().nullable(),
})

/**
 * Verify the BOE or the duty — separately, always.
 *
 * They are two assertions arriving from two places, and a single "customs is
 * fine" tick would hide which of them was actually checked.
 */
export async function verifyCustoms(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = verifySchema.safeParse({
    id: formData.get('id'),
    import_id: formData.get('import_id'),
    target: formData.get('target'),
    decision: formData.get('decision'),
    remarks: emptyToNull(formData.get('remarks')),
    confirm: emptyToNull(formData.get('confirm')),
  })

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }

  if (parsed.data.decision === 'verified' && parsed.data.confirm !== 'on') {
    return {
      ok: false,
      error:
        parsed.data.target === 'boe'
          ? 'Tick to confirm you have read the BOE against the invoice and packing list.'
          : 'Tick to confirm you have checked the duty against the challan.',
    }
  }

  const supabase = await createClient()
  const operator = await getOperator()

  const now = new Date().toISOString()
  const patch =
    parsed.data.target === 'boe'
      ? {
          boe_verification_status: parsed.data.decision,
          boe_verified_by: operator?.id ?? null,
          boe_verified_at: now,
          verification_remarks: parsed.data.remarks,
        }
      : {
          duty_verification_status:
            parsed.data.decision === 'verified' ? 'approved' : 'rejected',
          duty_verified_by: operator?.id ?? null,
          duty_verified_at: now,
          verification_remarks: parsed.data.remarks,
        }

  const { error } = await supabase.from('customs_records').update(patch).eq('id', parsed.data.id)
  if (error) return { ok: false, error: error.message }

  await logActivity(
    parsed.data.import_id,
    `${parsed.data.target === 'boe' ? 'Bill of Entry' : 'Duty'} ${
      parsed.data.decision === 'verified' ? 'verified' : 'rejected'
    }`,
    parsed.data.remarks,
  )

  revalidate(parsed.data.import_id)
  return { ok: true }
}

/**
 * Copy the verified duty onto the landed cost as a cost line.
 *
 * Only once the duty has been approved — an unapproved figure has no business
 * in a landed cost. INR is the transaction currency here, so no rate is needed.
 */
export async function pushDutyToCosts(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const id = formData.get('id')
  const importId = formData.get('import_id')
  if (typeof id !== 'string' || typeof importId !== 'string') {
    return { ok: false, error: 'Invalid input' }
  }

  const supabase = await createClient()
  const { data: record } = await supabase
    .from('customs_records')
    .select('shipment_id, boe_no, total_duty, duty_paid_at, duty_verification_status')
    .eq('id', id)
    .single()

  if (!record) return { ok: false, error: 'Customs record not found' }
  if (record.duty_verification_status !== 'approved') {
    return { ok: false, error: 'Verify the duty first — an unchecked figure should not reach the landed cost.' }
  }
  if (record.total_duty === null) return { ok: false, error: 'No duty total to copy.' }

  const operator = await getOperator()

  const { error } = await supabase.from('import_costs').insert({
    import_id: importId,
    shipment_id: record.shipment_id,
    cost_type: 'duty',
    description: `Customs duty — BOE ${record.boe_no ?? '(unnumbered)'}`,
    currency: 'INR',
    amount: record.total_duty,
    fx_rate: 1,
    is_estimate: false,
    incurred_on: record.duty_paid_at,
    created_by: operator?.id ?? null,
  })

  if (error) return { ok: false, error: error.message }

  await logActivity(importId, 'Customs duty added to landed cost')
  revalidate(importId)
  return { ok: true }
}
