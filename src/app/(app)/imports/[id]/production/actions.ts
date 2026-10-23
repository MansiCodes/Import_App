'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { PRODUCTION_STAGES } from '@/lib/types'
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
    event_type: 'production',
    title,
    detail: detail ?? null,
    created_by: operator?.id ?? null,
  })
}

function revalidate(importId: string) {
  revalidatePath(`/imports/${importId}/production`)
  revalidatePath(`/imports/${importId}`)
  revalidatePath('/')
}

const datesSchema = z.object({
  import_id: z.string().uuid(),
  expected_goods_ready: nullableDate,
  revised_goods_ready: nullableDate,
  actual_goods_ready: nullableDate,
})

/**
 * Record the goods-ready dates.
 *
 * All three are kept. A revised date never overwrites the original, because
 * "they promised the 10th and delivered on the 28th" is the question anyone
 * actually asks, and an overwritten date cannot answer it.
 */
export async function saveGoodsReadyDates(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = datesSchema.safeParse({
    import_id: formData.get('import_id'),
    expected_goods_ready: emptyToNull(formData.get('expected_goods_ready')),
    revised_goods_ready: emptyToNull(formData.get('revised_goods_ready')),
    actual_goods_ready: emptyToNull(formData.get('actual_goods_ready')),
  })

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }

  const { import_id, ...dates } = parsed.data
  const supabase = await createClient()

  const { data: before } = await supabase
    .from('imports')
    .select('expected_goods_ready, revised_goods_ready, actual_goods_ready')
    .eq('id', import_id)
    .single()

  const { error } = await supabase.from('imports').update(dates).eq('id', import_id)
  if (error) return { ok: false, error: error.message }

  if (before?.actual_goods_ready !== dates.actual_goods_ready && dates.actual_goods_ready) {
    await logActivity(import_id, `Goods confirmed ready on ${dates.actual_goods_ready}`)
  } else if (before?.revised_goods_ready !== dates.revised_goods_ready && dates.revised_goods_ready) {
    await logActivity(
      import_id,
      `Goods-ready date revised to ${dates.revised_goods_ready}`,
      before?.expected_goods_ready ? `Originally promised ${before.expected_goods_ready}` : null,
    )
  }

  revalidate(import_id)
  return { ok: true }
}

const updateSchema = z.object({
  import_id: z.string().uuid(),
  reported_on: z.string().min(1, 'When was this reported?'),
  source: z.string().trim().max(200).nullable(),
  stage: z
    .union([z.enum(PRODUCTION_STAGES), z.null()])
    .transform((v) => (v === null ? null : v)),
  percent_complete: z
    .union([z.string(), z.null()])
    .transform((v) => (v === null || v === '' ? null : Number(v)))
    .refine((v) => v === null || (Number.isFinite(v) && v >= 0 && v <= 100), '0 to 100'),
  promised_ready_date: nullableDate,
  detail: z.string().trim().max(2000).nullable(),
})

/** Record what the supplier said, as a dated claim rather than a fact. */
export async function addProductionUpdate(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const rawStage = emptyToNull(formData.get('stage'))

  const parsed = updateSchema.safeParse({
    import_id: formData.get('import_id'),
    reported_on: formData.get('reported_on'),
    source: emptyToNull(formData.get('source')),
    stage: rawStage,
    percent_complete: emptyToNull(formData.get('percent_complete')),
    promised_ready_date: emptyToNull(formData.get('promised_ready_date')),
    detail: emptyToNull(formData.get('detail')),
  })

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }

  const supabase = await createClient()
  const operator = await getOperator()

  const { error } = await supabase
    .from('production_updates')
    .insert({ ...parsed.data, created_by: operator?.id ?? null })

  if (error) return { ok: false, error: error.message }

  await logActivity(
    parsed.data.import_id,
    `Production update: ${parsed.data.stage ?? 'reported'}${
      parsed.data.percent_complete !== null ? ` — ${parsed.data.percent_complete}%` : ''
    }`,
    parsed.data.detail,
  )

  revalidate(parsed.data.import_id)
  return { ok: true }
}

const itemSchema = z.object({
  id: z.string().uuid().optional(),
  import_id: z.string().uuid(),
  line_no: z
    .union([z.string(), z.number(), z.null()])
    .transform((v) => (v === null || v === '' ? null : Number(v))),
  description: z.string().trim().min(1, 'Describe the line').max(500),
  hsn_code: z.string().trim().max(20).nullable(),
  quantity: z
    .union([z.string(), z.null()])
    .transform((v) => (v === null || v === '' ? null : Number(v))),
  unit: z.string().trim().max(20).nullable(),
  unit_price: z
    .union([z.string(), z.null()])
    .transform((v) => (v === null || v === '' ? null : Number(v))),
  amount: z
    .union([z.string(), z.null()])
    .transform((v) => (v === null || v === '' ? null : Number(v))),
  is_foc: z.coerce.boolean(),
  remarks: z.string().trim().max(1000).nullable(),
})

/**
 * Save a PI line.
 *
 * `is_foc` is a flag rather than a zero price: a free-of-charge line still has
 * a value for customs, and storing it as zero would understate the assessable
 * value while looking perfectly ordinary.
 */
export async function saveImportItem(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = itemSchema.safeParse({
    id: formData.get('id') || undefined,
    import_id: formData.get('import_id'),
    line_no: emptyToNull(formData.get('line_no')),
    description: formData.get('description'),
    hsn_code: emptyToNull(formData.get('hsn_code')),
    quantity: emptyToNull(formData.get('quantity')),
    unit: emptyToNull(formData.get('unit')),
    unit_price: emptyToNull(formData.get('unit_price')),
    amount: emptyToNull(formData.get('amount')),
    is_foc: formData.get('is_foc') === 'on',
    remarks: emptyToNull(formData.get('remarks')),
  })

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }

  const { id, ...values } = parsed.data

  // Amount is computed only when the operator left it blank — an invoice that
  // states its own line total wins over our arithmetic.
  if (values.amount === null && values.quantity !== null && values.unit_price !== null) {
    values.amount = Number((values.quantity * values.unit_price).toFixed(4))
  }

  const supabase = await createClient()
  const { error } = id
    ? await supabase.from('import_items').update(values).eq('id', id)
    : await supabase.from('import_items').insert(values)

  if (error) return { ok: false, error: error.message }

  revalidate(values.import_id)
  return { ok: true }
}

export async function deleteImportItem(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const id = formData.get('id')
  const importId = formData.get('import_id')
  if (typeof id !== 'string' || typeof importId !== 'string') {
    return { ok: false, error: 'Invalid input' }
  }

  const supabase = await createClient()
  const { error } = await supabase.from('import_items').delete().eq('id', id)
  if (error) return { ok: false, error: error.message }

  revalidate(importId)
  return { ok: true }
}
