'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
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

async function logActivity(importId: string, title: string, detail?: string | null) {
  const supabase = await createClient()
  const operator = await getOperator()

  await supabase.from('activity_log').insert({
    import_id: importId,
    event_type: 'delivery',
    title,
    detail: detail ?? null,
    created_by: operator?.id ?? null,
  })
}

function revalidate(importId: string) {
  revalidatePath(`/imports/${importId}/delivery`)
  revalidatePath(`/imports/${importId}`)
  revalidatePath('/')
}

const deliverySchema = z.object({
  id: z.string().uuid().optional(),
  import_id: z.string().uuid(),
  shipment_id: z.string().uuid(),

  transporter: nullableText,
  lr_no: nullableText,
  vehicle_no: nullableText,

  dispatched_at: nullableDate,
  expected_delivery: nullableDate,
  actual_delivery: nullableDate,
  delivery_location: nullableText,

  received_by: nullableText,
  material_receipt_at: nullableDate,
  mrn_no: nullableText,

  has_shortage: z.coerce.boolean(),
  has_damage: z.coerce.boolean(),
  discrepancy_notes: z.string().trim().max(2000).nullable(),
  shortage_qty: z
    .union([z.string(), z.null()])
    .transform((v) => (v === null || v === '' ? null : Number(v)))
    .refine((v) => v === null || Number.isFinite(v), 'Must be a number'),

  notes: z.string().trim().max(2000).nullable(),
})

/**
 * Record the delivery leg.
 *
 * A shortage or damage flag with no explanation is not much use to anyone
 * arguing a claim later, so ticking either one requires the note.
 */
export async function saveDeliveryRecord(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = deliverySchema.safeParse({
    id: formData.get('id') || undefined,
    import_id: formData.get('import_id'),
    shipment_id: formData.get('shipment_id'),
    transporter: emptyToNull(formData.get('transporter')),
    lr_no: emptyToNull(formData.get('lr_no')),
    vehicle_no: emptyToNull(formData.get('vehicle_no')),
    dispatched_at: emptyToNull(formData.get('dispatched_at')),
    expected_delivery: emptyToNull(formData.get('expected_delivery')),
    actual_delivery: emptyToNull(formData.get('actual_delivery')),
    delivery_location: emptyToNull(formData.get('delivery_location')),
    received_by: emptyToNull(formData.get('received_by')),
    material_receipt_at: emptyToNull(formData.get('material_receipt_at')),
    mrn_no: emptyToNull(formData.get('mrn_no')),
    has_shortage: formData.get('has_shortage') === 'on',
    has_damage: formData.get('has_damage') === 'on',
    discrepancy_notes: emptyToNull(formData.get('discrepancy_notes')),
    shortage_qty: emptyToNull(formData.get('shortage_qty')),
    notes: emptyToNull(formData.get('notes')),
  })

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }

  const { id, ...values } = parsed.data

  if ((values.has_shortage || values.has_damage) && !values.discrepancy_notes) {
    return {
      ok: false,
      error: 'Describe the shortage or damage — a bare flag will not support a claim later.',
    }
  }

  const supabase = await createClient()

  const { error } = id
    ? await supabase.from('delivery_records').update(values).eq('id', id)
    : await supabase.from('delivery_records').insert(values)

  if (error) {
    return {
      ok: false,
      error:
        error.code === '23505'
          ? 'This shipment already has a delivery record. Edit that one instead.'
          : error.message,
    }
  }

  if (values.actual_delivery) {
    await logActivity(
      values.import_id,
      `Delivered ${values.actual_delivery}${values.delivery_location ? ` to ${values.delivery_location}` : ''}`,
      values.has_shortage || values.has_damage ? values.discrepancy_notes : null,
    )
  }

  revalidate(values.import_id)
  return { ok: true }
}
