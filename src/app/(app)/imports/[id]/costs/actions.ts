'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { COST_TYPES } from '@/lib/types'
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

async function logActivity(importId: string, title: string, detail?: string | null) {
  const supabase = await createClient()
  const operator = await getOperator()

  await supabase.from('activity_log').insert({
    import_id: importId,
    event_type: 'cost',
    title,
    detail: detail ?? null,
    created_by: operator?.id ?? null,
  })
}

function revalidate(importId: string) {
  revalidatePath(`/imports/${importId}/costs`)
  revalidatePath(`/imports/${importId}`)
  revalidatePath('/review')
  revalidatePath('/reports')
  revalidatePath('/')
}

const costSchema = z.object({
  id: z.string().uuid().optional(),
  import_id: z.string().uuid(),
  shipment_id: z.union([z.string().uuid(), z.null()]),
  cost_type: z.enum(COST_TYPES),
  description: z.string().trim().max(500).nullable(),
  vendor: z.string().trim().max(200).nullable(),
  currency: z.string().trim().min(1).max(5),
  amount: z
    .union([z.string(), z.number()])
    .transform(Number)
    .refine((v) => Number.isFinite(v) && v > 0, 'Enter an amount'),
  // Optional by design. A line with no rate contributes to its own currency
  // total and to nothing in INR — it is reported as unconverted, never guessed.
  fx_rate: z
    .union([z.string(), z.null()])
    .transform((v) => (v === null || v === '' ? null : Number(v)))
    .refine((v) => v === null || (Number.isFinite(v) && v > 0), 'Enter a valid exchange rate'),
  is_estimate: z.coerce.boolean(),
  incurred_on: nullableDate,
  invoice_no: z.string().trim().max(100).nullable(),
  notes: z.string().trim().max(2000).nullable(),
})

export async function saveCost(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = costSchema.safeParse({
    id: formData.get('id') || undefined,
    import_id: formData.get('import_id'),
    shipment_id: emptyToNull(formData.get('shipment_id')),
    cost_type: formData.get('cost_type'),
    description: emptyToNull(formData.get('description')),
    vendor: emptyToNull(formData.get('vendor')),
    currency: formData.get('currency'),
    amount: formData.get('amount'),
    fx_rate: emptyToNull(formData.get('fx_rate')),
    is_estimate: formData.get('is_estimate') === 'on',
    incurred_on: emptyToNull(formData.get('incurred_on')),
    invoice_no: emptyToNull(formData.get('invoice_no')),
    notes: emptyToNull(formData.get('notes')),
  })

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }

  const { id, ...values } = parsed.data
  const supabase = await createClient()

  const { error } = id
    ? await supabase.from('import_costs').update(values).eq('id', id)
    : await supabase.from('import_costs').insert(values)

  if (error) return { ok: false, error: error.message }

  // Any change to the lines invalidates a previous sign-off: the figure that
  // was approved is no longer the figure on the screen.
  await supabase
    .from('imports')
    .update({
      landed_cost_status: 'calculated',
      landed_cost_verified_by: null,
      landed_cost_verified_at: null,
    })
    .eq('id', values.import_id)

  revalidate(values.import_id)
  return { ok: true }
}

export async function deleteCost(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const id = formData.get('id')
  const importId = formData.get('import_id')
  if (typeof id !== 'string' || typeof importId !== 'string') {
    return { ok: false, error: 'Invalid input' }
  }

  const supabase = await createClient()
  const { error } = await supabase.from('import_costs').delete().eq('id', id)
  if (error) return { ok: false, error: error.message }

  await supabase
    .from('imports')
    .update({
      landed_cost_status: 'calculated',
      landed_cost_verified_by: null,
      landed_cost_verified_at: null,
    })
    .eq('id', importId)

  revalidate(importId)
  return { ok: true }
}

const approveSchema = z.object({
  import_id: z.string().uuid(),
  confirm: z.literal('on', {
    message: 'Tick the box to confirm you have checked the lines and the rates',
  }),
})

/** Sign off the landed cost. Calculated is not approved (spec §14). */
export async function approveLandedCost(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = approveSchema.safeParse({
    import_id: formData.get('import_id'),
    confirm: formData.get('confirm'),
  })

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }

  const supabase = await createClient()

  // An unconverted line means the INR total is incomplete. Approving that would
  // sign off a number that is knowably wrong, so it is refused — and the fix is
  // to enter the rate, not to override it.
  const { data: rollup } = await supabase
    .from('v_landed_cost')
    .select('unconverted_count, line_count')
    .eq('import_id', parsed.data.import_id)
    .maybeSingle()

  if (!rollup || rollup.line_count === 0) {
    return { ok: false, error: 'Add cost lines before approving a landed cost.' }
  }

  if (rollup.unconverted_count > 0) {
    return {
      ok: false,
      error: `${rollup.unconverted_count} cost ${
        rollup.unconverted_count === 1 ? 'line has' : 'lines have'
      } no exchange rate, so the INR total is incomplete. Enter the rates first.`,
    }
  }

  const operator = await getOperator()

  const { error } = await supabase
    .from('imports')
    .update({
      landed_cost_status: 'approved',
      landed_cost_verified_by: operator?.id ?? null,
      landed_cost_verified_at: new Date().toISOString(),
    })
    .eq('id', parsed.data.import_id)

  if (error) return { ok: false, error: error.message }

  await logActivity(parsed.data.import_id, 'Landed cost approved')
  revalidate(parsed.data.import_id)
  return { ok: true }
}

const closeSchema = z.object({
  import_id: z.string().uuid(),
  confirm: z.string(),
  closure_notes: z.string().trim().max(2000).nullable(),
})

/**
 * Close the import.
 *
 * Typed confirmation, because closing hides it from every working list. It is
 * reversible — the point of the friction is that it should be deliberate, not
 * that it should be permanent.
 */
export async function closeImport(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = closeSchema.safeParse({
    import_id: formData.get('import_id'),
    confirm: formData.get('confirm') ?? '',
    closure_notes: emptyToNull(formData.get('closure_notes')),
  })

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }

  if (parsed.data.confirm !== 'CLOSE') {
    return { ok: false, error: 'Type CLOSE to confirm.' }
  }

  const supabase = await createClient()

  // Everything that would be left dangling, stated plainly rather than
  // discovered in an audit later. None of it blocks: the operator decides.
  const [{ data: payments }, { data: rollup }] = await Promise.all([
    supabase
      .from('v_payment_totals')
      .select('outstanding_total')
      .eq('import_id', parsed.data.import_id)
      .maybeSingle(),
    supabase
      .from('v_landed_cost')
      .select('landed_cost_status')
      .eq('import_id', parsed.data.import_id)
      .maybeSingle(),
  ])

  const operator = await getOperator()

  const warnings: string[] = []
  if (payments?.outstanding_total && Number(payments.outstanding_total) > 0) {
    warnings.push('payments still outstanding')
  }
  if (rollup?.landed_cost_status !== 'approved') {
    warnings.push('landed cost not approved')
  }

  const { error } = await supabase
    .from('imports')
    .update({
      status: 'Closed',
      closed_at: new Date().toISOString(),
      closed_by: operator?.id ?? null,
      closure_notes: parsed.data.closure_notes,
    })
    .eq('id', parsed.data.import_id)

  if (error) return { ok: false, error: error.message }

  await logActivity(
    parsed.data.import_id,
    'Import closed',
    warnings.length > 0 ? `Closed with ${warnings.join(' and ')}` : parsed.data.closure_notes,
  )

  revalidate(parsed.data.import_id)
  revalidatePath('/imports')
  return { ok: true }
}

export async function reopenImport(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const importId = formData.get('import_id')
  const reason = emptyToNull(formData.get('reason'))

  if (typeof importId !== 'string') return { ok: false, error: 'Invalid input' }
  if (!reason) return { ok: false, error: 'Say why it is being reopened.' }

  const supabase = await createClient()
  const { error } = await supabase
    .from('imports')
    .update({ status: 'Financial Closure', closed_at: null, closed_by: null })
    .eq('id', importId)

  if (error) return { ok: false, error: error.message }

  await logActivity(importId, 'Import reopened', reason)
  revalidate(importId)
  revalidatePath('/imports')
  return { ok: true }
}
