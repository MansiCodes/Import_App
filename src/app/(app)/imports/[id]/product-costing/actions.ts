'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import {
  ALLOCATION_BASES,
  allocateCharge,
  allocationsBalance,
  defaultAllocationBasis,
  invoiceChargeGap,
  type AllocationBasis,
} from '@/lib/product-costing'
import { createClient, getOperator } from '@/lib/supabase/server'

export interface ActionResult {
  ok: boolean
  error?: string
  warning?: string
}

function emptyToNull(value: FormDataEntryValue | null): string | null {
  const str = typeof value === 'string' ? value.trim() : ''
  return str === '' ? null : str
}

const nullableText = z.string().trim().max(500).nullable()
const nullableNumber = z
  .union([z.string(), z.null()])
  .transform((v) => (v === null || v === '' ? null : Number(v)))
  .refine((v) => v === null || Number.isFinite(v), 'Must be a number')

function revalidate(importId: string) {
  revalidatePath(`/imports/${importId}/product-costing`)
  revalidatePath(`/imports/${importId}/costs`)
  revalidatePath(`/imports/${importId}`)
  revalidatePath('/')
}

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

// ---------------------------------------------------------------------------
// Cargo lines
// ---------------------------------------------------------------------------

const cargoSchema = z.object({
  id: z.string().uuid().optional(),
  import_id: z.string().uuid(),
  shipment_id: z.string().uuid(),
  import_item_id: z.union([z.string().uuid(), z.null()]),
  sku: nullableText,
  product_code: nullableText,
  description: z.string().trim().min(1, 'Description is required').max(500),
  quantity: nullableNumber,
  unit: nullableText,
  gross_weight_kg: nullableNumber,
  net_weight_kg: nullableNumber,
  cbm: nullableNumber,
  packages: nullableNumber,
  unit_value: nullableNumber,
  line_value: nullableNumber,
  currency: z.string().trim().max(5).nullable(),
  packing_list_ref: nullableText,
  sort_order: z.coerce.number().int().optional(),
})

export async function saveCargoLine(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = cargoSchema.safeParse({
    id: formData.get('id') || undefined,
    import_id: formData.get('import_id'),
    shipment_id: formData.get('shipment_id'),
    import_item_id: emptyToNull(formData.get('import_item_id')),
    sku: emptyToNull(formData.get('sku')),
    product_code: emptyToNull(formData.get('product_code')),
    description: formData.get('description'),
    quantity: emptyToNull(formData.get('quantity')),
    unit: emptyToNull(formData.get('unit')),
    gross_weight_kg: emptyToNull(formData.get('gross_weight_kg')),
    net_weight_kg: emptyToNull(formData.get('net_weight_kg')),
    cbm: emptyToNull(formData.get('cbm')),
    packages: emptyToNull(formData.get('packages')),
    unit_value: emptyToNull(formData.get('unit_value')),
    line_value: emptyToNull(formData.get('line_value')),
    currency: emptyToNull(formData.get('currency')),
    packing_list_ref: emptyToNull(formData.get('packing_list_ref')),
    sort_order: formData.get('sort_order') || 100,
  })

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }

  const { id, ...data } = parsed.data
  const supabase = await createClient()

  const { data: shipment } = await supabase
    .from('shipments')
    .select('id, import_id')
    .eq('id', data.shipment_id)
    .maybeSingle()

  if (!shipment || shipment.import_id !== data.import_id) {
    return { ok: false, error: 'Shipment does not belong to this import' }
  }

  if (id) {
    const { error } = await supabase.from('shipment_cargo_lines').update(data).eq('id', id)
    if (error) return { ok: false, error: error.message }
  } else {
    const { error } = await supabase.from('shipment_cargo_lines').insert(data)
    if (error) return { ok: false, error: error.message }
  }

  const realloc = await reallocateShipmentCharges(data.import_id, data.shipment_id)
  await logActivity(data.import_id, id ? 'Cargo line updated' : 'Cargo line added', data.description)
  revalidate(data.import_id)
  return { ok: true, warning: realloc.warning }
}

export async function deleteCargoLine(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const id = String(formData.get('id') ?? '')
  const importId = String(formData.get('import_id') ?? '')
  if (!id || !importId) return { ok: false, error: 'Missing id' }

  const supabase = await createClient()
  const { data: line } = await supabase
    .from('shipment_cargo_lines')
    .select('shipment_id, description')
    .eq('id', id)
    .maybeSingle()

  const { error } = await supabase.from('shipment_cargo_lines').delete().eq('id', id)
  if (error) return { ok: false, error: error.message }

  if (line?.shipment_id) {
    await reallocateShipmentCharges(importId, line.shipment_id)
  }
  await logActivity(importId, 'Cargo line removed', line?.description)
  revalidate(importId)
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Logistics invoices
// ---------------------------------------------------------------------------

const invoiceSchema = z.object({
  id: z.string().uuid().optional(),
  import_id: z.string().uuid(),
  shipment_id: z.string().uuid(),
  vendor: nullableText,
  invoice_no: nullableText,
  invoice_date: z.union([z.string(), z.null()]).transform((v) => (v === '' ? null : v)),
  currency: z.string().trim().min(1).max(5),
  subtotal: nullableNumber,
  tax_total: nullableNumber,
  grand_total: z
    .union([z.string(), z.number()])
    .transform(Number)
    .refine((v) => Number.isFinite(v) && v >= 0, 'Enter invoice total'),
  notes: z.string().trim().max(2000).nullable(),
  sync_to_costs: z.coerce.boolean().optional(),
  fx_rate: nullableNumber,
})

export async function saveLogisticsInvoice(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = invoiceSchema.safeParse({
    id: formData.get('id') || undefined,
    import_id: formData.get('import_id'),
    shipment_id: formData.get('shipment_id'),
    vendor: emptyToNull(formData.get('vendor')),
    invoice_no: emptyToNull(formData.get('invoice_no')),
    invoice_date: emptyToNull(formData.get('invoice_date')),
    currency: formData.get('currency'),
    subtotal: emptyToNull(formData.get('subtotal')),
    tax_total: emptyToNull(formData.get('tax_total')),
    grand_total: formData.get('grand_total'),
    notes: emptyToNull(formData.get('notes')),
    sync_to_costs: formData.get('sync_to_costs') === 'on',
    fx_rate: emptyToNull(formData.get('fx_rate')),
  })

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }

  const { id, sync_to_costs, fx_rate, ...data } = parsed.data
  const supabase = await createClient()
  const operator = await getOperator()

  let invoiceId = id

  if (id) {
    const { error } = await supabase.from('logistics_invoices').update(data).eq('id', id)
    if (error) return { ok: false, error: error.message }
  } else {
    const { data: created, error } = await supabase
      .from('logistics_invoices')
      .insert({ ...data, created_by: operator?.id ?? null })
      .select('id')
      .single()
    if (error || !created) return { ok: false, error: error?.message ?? 'Could not create invoice' }
    invoiceId = created.id
  }

  if (sync_to_costs && invoiceId) {
    const sync = await syncInvoiceToCosts(invoiceId, fx_rate)
    if (!sync.ok) return sync
  }

  await logActivity(
    data.import_id,
    id ? 'Logistics invoice updated' : 'Logistics invoice added',
    data.invoice_no ?? data.vendor,
  )
  revalidate(data.import_id)
  return { ok: true }
}

export async function deleteLogisticsInvoice(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const id = String(formData.get('id') ?? '')
  const importId = String(formData.get('import_id') ?? '')
  if (!id || !importId) return { ok: false, error: 'Missing id' }

  const supabase = await createClient()
  const { data: inv } = await supabase
    .from('logistics_invoices')
    .select('import_cost_id, invoice_no')
    .eq('id', id)
    .maybeSingle()

  // Clear reverse link then delete rollup cost if present
  if (inv?.import_cost_id) {
    await supabase
      .from('import_costs')
      .update({ logistics_invoice_id: null })
      .eq('id', inv.import_cost_id)
    await supabase.from('import_costs').delete().eq('id', inv.import_cost_id)
  }

  const { error } = await supabase.from('logistics_invoices').delete().eq('id', id)
  if (error) return { ok: false, error: error.message }

  await logActivity(importId, 'Logistics invoice removed', inv?.invoice_no)
  revalidate(importId)
  return { ok: true }
}

export async function syncInvoiceRollup(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const invoiceId = String(formData.get('invoice_id') ?? '')
  const fx = emptyToNull(formData.get('fx_rate'))
  if (!invoiceId) return { ok: false, error: 'Missing invoice' }
  return syncInvoiceToCosts(invoiceId, fx === null ? null : Number(fx))
}

/** One import_costs rollup per logistics invoice — never product allocations. */
export async function syncInvoiceToCosts(
  invoiceId: string,
  fxRate: number | null = null,
): Promise<ActionResult> {
  const supabase = await createClient()
  const operator = await getOperator()

  const { data: inv, error } = await supabase
    .from('logistics_invoices')
    .select('*')
    .eq('id', invoiceId)
    .maybeSingle()

  if (error || !inv) return { ok: false, error: error?.message ?? 'Invoice not found' }

  const payload = {
    import_id: inv.import_id,
    shipment_id: inv.shipment_id,
    cost_type: 'freight' as const,
    description: `Logistics invoice ${inv.invoice_no ?? ''}`.trim(),
    vendor: inv.vendor,
    currency: inv.currency,
    amount: inv.grand_total,
    fx_rate: fxRate,
    is_estimate: false,
    incurred_on: inv.invoice_date,
    invoice_no: inv.invoice_no,
    logistics_invoice_id: inv.id,
    notes: 'Synced from Product Costing — do not edit amount here',
    created_by: operator?.id ?? null,
  }

  if (inv.import_cost_id) {
    const { error: updErr } = await supabase
      .from('import_costs')
      .update(payload)
      .eq('id', inv.import_cost_id)
    if (updErr) return { ok: false, error: updErr.message }
  } else {
    const { data: cost, error: insErr } = await supabase
      .from('import_costs')
      .insert(payload)
      .select('id')
      .single()
    if (insErr || !cost) return { ok: false, error: insErr?.message ?? 'Could not sync cost' }

    await supabase
      .from('logistics_invoices')
      .update({ import_cost_id: cost.id })
      .eq('id', invoiceId)
  }

  revalidate(inv.import_id)
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Charges
// ---------------------------------------------------------------------------

const chargeSchema = z.object({
  id: z.string().uuid().optional(),
  invoice_id: z.string().uuid(),
  import_id: z.string().uuid(),
  charge_type_id: z.string().uuid(),
  description: nullableText,
  is_tax: z.coerce.boolean(),
  amount: z
    .union([z.string(), z.number()])
    .transform(Number)
    .refine((v) => Number.isFinite(v), 'Enter an amount'),
  currency: z.string().trim().min(1).max(5),
  allocation_basis: z.enum(ALLOCATION_BASES),
  sort_order: z.coerce.number().int().optional(),
})

export async function saveInvoiceCharge(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = chargeSchema.safeParse({
    id: formData.get('id') || undefined,
    invoice_id: formData.get('invoice_id'),
    import_id: formData.get('import_id'),
    charge_type_id: formData.get('charge_type_id'),
    description: emptyToNull(formData.get('description')),
    is_tax: formData.get('is_tax') === 'on',
    amount: formData.get('amount'),
    currency: formData.get('currency'),
    allocation_basis: formData.get('allocation_basis') || 'gross_weight',
    sort_order: formData.get('sort_order') || 100,
  })

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }

  const { id, import_id, ...data } = parsed.data
  const supabase = await createClient()

  const { data: inv } = await supabase
    .from('logistics_invoices')
    .select('id, shipment_id, grand_total, currency')
    .eq('id', data.invoice_id)
    .maybeSingle()
  if (!inv) return { ok: false, error: 'Invoice not found' }

  // Default basis from charge type bucket when creating
  if (!id) {
    const { data: ct } = await supabase
      .from('freight_charge_types')
      .select('costing_bucket')
      .eq('id', data.charge_type_id)
      .maybeSingle()
    if (!formData.get('allocation_basis') && ct?.costing_bucket) {
      data.allocation_basis = defaultAllocationBasis(
        ct.costing_bucket as 'freight' | 'tax' | 'bl_awb' | 'cha' | 'local' | 'other',
      )
    }
  }

  let chargeId = id
  if (id) {
    const { error } = await supabase.from('logistics_invoice_charges').update(data).eq('id', id)
    if (error) return { ok: false, error: error.message }
  } else {
    const { data: created, error } = await supabase
      .from('logistics_invoice_charges')
      .insert(data)
      .select('id')
      .single()
    if (error || !created) return { ok: false, error: error?.message ?? 'Could not save charge' }
    chargeId = created.id
  }

  const { data: allCharges } = await supabase
    .from('logistics_invoice_charges')
    .select('amount')
    .eq('invoice_id', data.invoice_id)

  const gap = invoiceChargeGap(
    Number(inv.grand_total),
    (allCharges ?? []).map((c) => Number(c.amount)),
  )

  let warning: string | undefined
  if (Math.abs(gap) > 0.01) {
    warning = `Charges differ from invoice total by ${gap.toFixed(2)} ${inv.currency}`
  }

  if (chargeId && data.allocation_basis !== 'manual') {
    const alloc = await reallocateCharge(chargeId)
    if (alloc.warning) warning = [warning, alloc.warning].filter(Boolean).join(' · ')
  }

  revalidate(import_id)
  return { ok: true, warning }
}

export async function deleteInvoiceCharge(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const id = String(formData.get('id') ?? '')
  const importId = String(formData.get('import_id') ?? '')
  if (!id || !importId) return { ok: false, error: 'Missing id' }

  const supabase = await createClient()
  const { error } = await supabase.from('logistics_invoice_charges').delete().eq('id', id)
  if (error) return { ok: false, error: error.message }

  revalidate(importId)
  return { ok: true }
}

export async function saveManualAllocations(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const chargeId = String(formData.get('charge_id') ?? '')
  const importId = String(formData.get('import_id') ?? '')
  if (!chargeId || !importId) return { ok: false, error: 'Missing charge' }

  const supabase = await createClient()
  const { data: charge } = await supabase
    .from('logistics_invoice_charges')
    .select('amount, allocation_basis')
    .eq('id', chargeId)
    .maybeSingle()
  if (!charge) return { ok: false, error: 'Charge not found' }

  const cargoIds = formData.getAll('cargo_line_id').map(String)
  const amounts = formData.getAll('allocated_amount').map((v) => Number(v))

  if (cargoIds.length !== amounts.length) {
    return { ok: false, error: 'Allocation rows mismatch' }
  }
  if (!allocationsBalance(Number(charge.amount), amounts)) {
    return {
      ok: false,
      error: `Allocations must sum to ${Number(charge.amount).toFixed(2)} (got ${amounts.reduce((s, n) => s + n, 0).toFixed(2)})`,
    }
  }

  await supabase.from('logistics_charge_allocations').delete().eq('charge_id', chargeId)

  const rows = cargoIds.map((cargoLineId, i) => ({
    charge_id: chargeId,
    cargo_line_id: cargoLineId,
    basis_value: null,
    allocated_amount: amounts[i],
  }))

  if (rows.length > 0) {
    const { error } = await supabase.from('logistics_charge_allocations').insert(rows)
    if (error) return { ok: false, error: error.message }
  }

  if (charge.allocation_basis !== 'manual') {
    await supabase
      .from('logistics_invoice_charges')
      .update({ allocation_basis: 'manual' })
      .eq('id', chargeId)
  }

  revalidate(importId)
  return { ok: true }
}

export async function reallocateCharge(chargeId: string): Promise<ActionResult> {
  const supabase = await createClient()

  const { data: charge } = await supabase
    .from('logistics_invoice_charges')
    .select('id, amount, allocation_basis, invoice_id')
    .eq('id', chargeId)
    .maybeSingle()
  if (!charge) return { ok: false, error: 'Charge not found' }

  if (charge.allocation_basis === 'manual') {
    return { ok: true, warning: 'Manual allocation left unchanged' }
  }

  const { data: inv } = await supabase
    .from('logistics_invoices')
    .select('shipment_id')
    .eq('id', charge.invoice_id)
    .maybeSingle()
  if (!inv) return { ok: false, error: 'Invoice not found' }

  const { data: cargo } = await supabase
    .from('shipment_cargo_lines')
    .select('id, quantity, gross_weight_kg, net_weight_kg, cbm')
    .eq('shipment_id', inv.shipment_id)
    .order('sort_order')

  const result = allocateCharge(
    Number(charge.amount),
    (cargo ?? []).map((c) => ({
      id: c.id,
      quantity: c.quantity === null ? null : Number(c.quantity),
      gross_weight_kg: c.gross_weight_kg === null ? null : Number(c.gross_weight_kg),
      net_weight_kg: c.net_weight_kg === null ? null : Number(c.net_weight_kg),
      cbm: c.cbm === null ? null : Number(c.cbm),
    })),
    charge.allocation_basis as AllocationBasis,
  )

  await supabase.from('logistics_charge_allocations').delete().eq('charge_id', chargeId)

  if (result.rows.length > 0) {
    const { error } = await supabase.from('logistics_charge_allocations').insert(
      result.rows.map((r) => ({
        charge_id: chargeId,
        cargo_line_id: r.cargoLineId,
        basis_value: r.basisValue,
        allocated_amount: r.allocatedAmount,
      })),
    )
    if (error) return { ok: false, error: error.message }
  }

  return { ok: true, warning: result.warning ?? undefined }
}

export async function reallocateShipmentCharges(
  importId: string,
  shipmentId: string,
): Promise<ActionResult> {
  const supabase = await createClient()
  const { data: invoices } = await supabase
    .from('logistics_invoices')
    .select('id')
    .eq('shipment_id', shipmentId)

  const warnings: string[] = []
  for (const inv of invoices ?? []) {
    const { data: charges } = await supabase
      .from('logistics_invoice_charges')
      .select('id, allocation_basis')
      .eq('invoice_id', inv.id)

    for (const ch of charges ?? []) {
      if (ch.allocation_basis === 'manual') continue
      const r = await reallocateCharge(ch.id)
      if (r.warning) warnings.push(r.warning)
    }
  }

  revalidate(importId)
  return { ok: true, warning: warnings[0] }
}
