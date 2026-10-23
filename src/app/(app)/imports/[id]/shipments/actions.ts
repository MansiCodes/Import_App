'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { SHIPMENT_MODES, SHIPMENT_STATUSES } from '@/lib/types'
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
const nullableNumber = z
  .union([z.string(), z.null()])
  .transform((v) => (v === null || v === '' ? null : Number(v)))
  .refine((v) => v === null || Number.isFinite(v), 'Must be a number')

async function logActivity(importId: string, title: string, detail?: string | null) {
  const supabase = await createClient()
  const operator = await getOperator()

  await supabase.from('activity_log').insert({
    import_id: importId,
    event_type: 'shipment',
    title,
    detail: detail ?? null,
    created_by: operator?.id ?? null,
  })
}

function revalidate(importId: string) {
  revalidatePath(`/imports/${importId}/shipments`)
  revalidatePath(`/imports/${importId}/customs`)
  revalidatePath(`/imports/${importId}/delivery`)
  revalidatePath(`/imports/${importId}`)
  revalidatePath('/shipments')
  revalidatePath('/')
}

const shipmentSchema = z.object({
  id: z.string().uuid().optional(),
  import_id: z.string().uuid(),
  shipment_no: nullableText,
  description: nullableText,
  mode: z.enum(SHIPMENT_MODES),
  status: z.enum(SHIPMENT_STATUSES),
  cha_id: z.union([z.string().uuid(), z.null()]),
  cha_agent_id: z.union([z.string().uuid(), z.null()]),
  origin_country: nullableText,
  origin_port: nullableText,
  destination_port: nullableText,
  incoterm: nullableText,
  pickup_date: nullableDate,
  etd: nullableDate,
  eta: nullableDate,
  revised_eta: nullableDate,
  actual_arrival: nullableDate,
  carrier: nullableText,
  vessel_flight: nullableText,
  awb: nullableText,
  hawb: nullableText,
  mawb: nullableText,
  bl_no: nullableText,
  bl_date: nullableDate,
  tracking_no: nullableText,
  container_nos: nullableText,
  container_count: nullableNumber,
  packages: nullableNumber,
  package_type: nullableText,
  gross_weight_kg: nullableNumber,
  net_weight_kg: nullableNumber,
  chargeable_weight_kg: nullableNumber,
  cbm: nullableNumber,
  freight_terms: nullableText,
  notes: z.string().trim().max(2000).nullable(),
})

function readShipmentForm(formData: FormData) {
  return {
    id: formData.get('id') || undefined,
    import_id: formData.get('import_id'),
    shipment_no: emptyToNull(formData.get('shipment_no')),
    description: emptyToNull(formData.get('description')),
    mode: formData.get('mode'),
    status: formData.get('status'),
    cha_id: emptyToNull(formData.get('cha_id')),
    cha_agent_id: emptyToNull(formData.get('cha_agent_id')),
    origin_country: emptyToNull(formData.get('origin_country')),
    origin_port: emptyToNull(formData.get('origin_port')),
    destination_port: emptyToNull(formData.get('destination_port')),
    incoterm: emptyToNull(formData.get('incoterm')),
    pickup_date: emptyToNull(formData.get('pickup_date')),
    etd: emptyToNull(formData.get('etd')),
    eta: emptyToNull(formData.get('eta')),
    revised_eta: emptyToNull(formData.get('revised_eta')),
    actual_arrival: emptyToNull(formData.get('actual_arrival')),
    carrier: emptyToNull(formData.get('carrier')),
    vessel_flight: emptyToNull(formData.get('vessel_flight')),
    awb: emptyToNull(formData.get('awb')),
    hawb: emptyToNull(formData.get('hawb')),
    mawb: emptyToNull(formData.get('mawb')),
    bl_no: emptyToNull(formData.get('bl_no')),
    bl_date: emptyToNull(formData.get('bl_date')),
    tracking_no: emptyToNull(formData.get('tracking_no')),
    container_nos: emptyToNull(formData.get('container_nos')),
    container_count: emptyToNull(formData.get('container_count')),
    packages: emptyToNull(formData.get('packages')),
    package_type: emptyToNull(formData.get('package_type')),
    gross_weight_kg: emptyToNull(formData.get('gross_weight_kg')),
    net_weight_kg: emptyToNull(formData.get('net_weight_kg')),
    chargeable_weight_kg: emptyToNull(formData.get('chargeable_weight_kg')),
    cbm: emptyToNull(formData.get('cbm')),
    freight_terms: emptyToNull(formData.get('freight_terms')),
    notes: emptyToNull(formData.get('notes')),
  }
}

/**
 * Create or update a shipment.
 *
 * The sequence is allocated by the database rather than counted here, so two
 * lots added at the same moment cannot collide on the same number.
 */
export async function saveShipment(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = shipmentSchema.safeParse(readShipmentForm(formData))

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }

  const { id, ...values } = parsed.data
  const supabase = await createClient()

  if (id) {
    const { data: before } = await supabase
      .from('shipments')
      .select('status, eta, revised_eta, seq, shipment_no')
      .eq('id', id)
      .single()

    const { error } = await supabase.from('shipments').update(values).eq('id', id)
    if (error) return { ok: false, error: error.message }

    const label = values.shipment_no ?? `#${before?.seq ?? ''}`

    if (before && before.status !== values.status) {
      await logActivity(
        values.import_id,
        `Shipment ${label} — ${before.status} → ${values.status}`,
      )
    }
    if (before && before.revised_eta !== values.revised_eta && values.revised_eta) {
      await logActivity(
        values.import_id,
        `Shipment ${label} ETA revised to ${values.revised_eta}`,
        before.eta ? `Originally ${before.eta}` : null,
      )
    }
  } else {
    const { data: seq } = await supabase.rpc('next_shipment_seq', {
      p_import_id: values.import_id,
    })

    const { error } = await supabase.from('shipments').insert({ ...values, seq: seq ?? 1 })
    if (error) return { ok: false, error: error.message }

    await logActivity(
      values.import_id,
      `Shipment added — ${values.mode}${values.shipment_no ? ` ${values.shipment_no}` : ''}`,
    )
  }

  revalidate(values.import_id)
  return { ok: true }
}

export async function deleteShipment(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const id = formData.get('id')
  const importId = formData.get('import_id')
  const confirm = formData.get('confirm')

  if (typeof id !== 'string' || typeof importId !== 'string') {
    return { ok: false, error: 'Invalid input' }
  }

  const supabase = await createClient()

  // Deleting a shipment takes its customs record and delivery record with it.
  // Worth saying out loud rather than discovering afterwards.
  const { count } = await supabase
    .from('customs_records')
    .select('id', { count: 'exact', head: true })
    .eq('shipment_id', id)

  if ((count ?? 0) > 0 && confirm !== 'DELETE') {
    return {
      ok: false,
      error: 'This shipment has a customs record. Type DELETE to remove both.',
    }
  }

  const { data: shipment } = await supabase
    .from('shipments')
    .select('seq, shipment_no')
    .eq('id', id)
    .single()

  const { error } = await supabase.from('shipments').delete().eq('id', id)
  if (error) return { ok: false, error: error.message }

  await logActivity(
    importId,
    `Shipment removed: ${shipment?.shipment_no ?? `#${shipment?.seq ?? ''}`}`,
  )

  revalidate(importId)
  return { ok: true }
}
