'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { financialYear } from '@/lib/fy'
import { renderPoNumber } from '@/lib/po-number'
import { IMPORT_STATUSES, PRIORITIES, WAITING_ON_OPTIONS } from '@/lib/import-status'
import { createClient, getOperator } from '@/lib/supabase/server'

export interface ActionResult {
  ok: boolean
  error?: string
}

function emptyToNull(value: FormDataEntryValue | null): string | null {
  const str = typeof value === 'string' ? value.trim() : ''
  return str === '' ? null : str
}

/** Money arrives as a string; '' must become NULL, not 0. */
const money = z
  .union([z.string(), z.number(), z.null()])
  .transform((v) => (v === null || v === '' ? null : Number(v)))
  .refine((v) => v === null || (Number.isFinite(v) && v >= 0), 'Must be a positive amount')

const dateish = z
  .union([z.string(), z.null()])
  .transform((v) => (v === null || v === '' ? null : v))

const importSchema = z.object({
  company_id: z.string().uuid('Choose a company'),
  supplier_id: z.string().uuid().nullable(),
  status: z.enum(IMPORT_STATUSES),
  title: z.string().trim().max(200).nullable(),
  currency: z.string().trim().min(1, 'Choose a currency').max(5),
  pi_number: z.string().trim().max(100).nullable(),
  pi_date: dateish,
  pi_value: money,
  po_number: z.string().trim().max(100).nullable(),
  po_date: dateish,
  po_value: money,
  incoterm: z.string().trim().max(10).nullable(),
  origin_country: z.string().trim().max(100).nullable(),
  payment_terms_text: z.string().trim().max(1000).nullable(),
  expected_goods_ready: dateish,
  revised_goods_ready: dateish,
  actual_goods_ready: dateish,
  next_action_title: z.string().trim().max(200).nullable(),
  next_action_due: dateish,
  next_action_priority: z.enum(PRIORITIES),
  waiting_on: z.enum(WAITING_ON_OPTIONS).nullable(),
  last_contact_at: dateish,
  last_response_at: dateish,
  next_followup_at: dateish,
  drive_folder_url: z.string().trim().max(500).nullable(),
  notes: z.string().trim().max(5000).nullable(),
})

function parseImportForm(formData: FormData) {
  return importSchema.safeParse({
    company_id: formData.get('company_id'),
    supplier_id: emptyToNull(formData.get('supplier_id')),
    status: formData.get('status'),
    title: emptyToNull(formData.get('title')),
    currency: formData.get('currency'),
    pi_number: emptyToNull(formData.get('pi_number')),
    pi_date: emptyToNull(formData.get('pi_date')),
    pi_value: emptyToNull(formData.get('pi_value')),
    po_number: emptyToNull(formData.get('po_number')),
    po_date: emptyToNull(formData.get('po_date')),
    po_value: emptyToNull(formData.get('po_value')),
    incoterm: emptyToNull(formData.get('incoterm')),
    origin_country: emptyToNull(formData.get('origin_country')),
    payment_terms_text: emptyToNull(formData.get('payment_terms_text')),
    expected_goods_ready: emptyToNull(formData.get('expected_goods_ready')),
    revised_goods_ready: emptyToNull(formData.get('revised_goods_ready')),
    actual_goods_ready: emptyToNull(formData.get('actual_goods_ready')),
    next_action_title: emptyToNull(formData.get('next_action_title')),
    next_action_due: emptyToNull(formData.get('next_action_due')),
    next_action_priority: formData.get('next_action_priority') || 'normal',
    waiting_on: emptyToNull(formData.get('waiting_on')),
    last_contact_at: emptyToNull(formData.get('last_contact_at')),
    last_response_at: emptyToNull(formData.get('last_response_at')),
    next_followup_at: emptyToNull(formData.get('next_followup_at')),
    drive_folder_url: emptyToNull(formData.get('drive_folder_url')),
    notes: emptyToNull(formData.get('notes')),
  })
}

/**
 * Suggest the next PO number for a company without consuming the sequence.
 * The operator can overwrite it entirely â€” the app never imposes a format.
 */
export async function suggestPoNumber(
  companyId: string,
  supplierName?: string | null,
): Promise<string> {
  if (!companyId) return ''

  const supabase = await createClient()

  const { data: company } = await supabase
    .from('companies')
    .select('short_code, fy_start_month, po_number_template')
    .eq('id', companyId)
    .single()

  if (!company) return ''

  const now = new Date()
  const fy = financialYear(now, company.fy_start_month)

  const { data: seq } = await supabase.rpc('peek_po_seq', {
    p_company: companyId,
    p_fy: fy.label,
  })

  return renderPoNumber(company.po_number_template, {
    companyCode: company.short_code,
    seq: typeof seq === 'number' ? seq : 1,
    date: now,
    fyStartMonth: company.fy_start_month,
    supplierName,
  })
}

export async function createImport(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = parseImportForm(formData)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }

  const supabase = await createClient()
  const operator = await getOperator()

  // Allocated by the database so two concurrent creates cannot collide.
  const { data: importNo, error: seqError } = await supabase.rpc('next_import_no')
  if (seqError || !importNo) {
    return { ok: false, error: seqError?.message ?? 'Could not allocate an import number' }
  }

  const { data: created, error } = await supabase
    .from('imports')
    .insert({ ...parsed.data, import_no: importNo, created_by: operator?.id ?? null })
    .select('id, import_no')
    .single()

  if (error) return { ok: false, error: error.message }

  // Consume the PO sequence only if the saved number is still the suggestion â€”
  // an overwritten or blank PO number must not burn a sequence value.
  if (parsed.data.po_number) {
    const { data: company } = await supabase
      .from('companies')
      .select('fy_start_month')
      .eq('id', parsed.data.company_id)
      .single()

    let supplierName: string | null = null
    if (parsed.data.supplier_id) {
      const { data: supplier } = await supabase
        .from('suppliers')
        .select('name')
        .eq('id', parsed.data.supplier_id)
        .single()
      supplierName = supplier?.name ?? null
    }

    const suggestion = await suggestPoNumber(parsed.data.company_id, supplierName)

    if (company && suggestion && parsed.data.po_number === suggestion) {
      await supabase.rpc('claim_po_seq', {
        p_company: parsed.data.company_id,
        p_fy: financialYear(new Date(), company.fy_start_month).label,
      })
    }
  }

  await supabase.from('activity_log').insert({
    import_id: created.id,
    event_type: 'import_created',
    title: `Import ${created.import_no} created`,
    detail: parsed.data.title,
    created_by: operator?.id ?? null,
  })

  revalidatePath('/imports')
  revalidatePath('/')
  redirect(`/imports/${created.id}`)
}

export async function updateImport(
  importId: string,
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = parseImportForm(formData)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }

  const supabase = await createClient()
  const { error } = await supabase.from('imports').update(parsed.data).eq('id', importId)

  if (error) return { ok: false, error: error.message }

  revalidatePath(`/imports/${importId}`)
  revalidatePath('/imports')
  revalidatePath('/')
  return { ok: true }
}

/** Clears the next-action fields when the operator marks it done. */
export async function completeNextAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const importId = String(formData.get('import_id') ?? '')
  if (!importId) return { ok: false, error: 'Missing import' }

  const supabase = await createClient()
  const operator = await getOperator()

  const { data: before } = await supabase
    .from('imports')
    .select('next_action_title')
    .eq('id', importId)
    .maybeSingle()

  const { error } = await supabase
    .from('imports')
    .update({
      next_action_title: null,
      next_action_due: null,
      next_action_priority: 'normal',
      waiting_on: null,
    })
    .eq('id', importId)

  if (error) return { ok: false, error: error.message }

  await supabase.from('activity_log').insert({
    import_id: importId,
    event_type: 'note',
    title: 'Next action marked done',
    detail: before?.next_action_title ?? null,
    created_by: operator?.id ?? null,
  })

  revalidatePath(`/imports/${importId}`)
  revalidatePath('/imports')
  revalidatePath('/')
  return { ok: true }
}

export async function setNextActionPriority(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const importId = String(formData.get('import_id') ?? '')
  const priority = String(formData.get('priority') ?? '')
  if (!importId) return { ok: false, error: 'Missing import' }
  if (!PRIORITIES.includes(priority as (typeof PRIORITIES)[number])) {
    return { ok: false, error: 'Invalid priority' }
  }

  const supabase = await createClient()
  const { error } = await supabase
    .from('imports')
    .update({ next_action_priority: priority })
    .eq('id', importId)

  if (error) return { ok: false, error: error.message }

  revalidatePath(`/imports/${importId}`)
  return { ok: true }
}

const statusChangeSchema = z.object({
  import_id: z.string().uuid(),
  status: z.enum(IMPORT_STATUSES),
  note: z.string().trim().max(1000).optional().nullable(),
})

/**
 * Status changes are never blocked â€” real imports skip stages. The change is
 * recorded on the timeline, and the audit trigger records the field diff.
 */
export async function changeStatus(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = statusChangeSchema.safeParse({
    import_id: formData.get('import_id'),
    status: formData.get('status'),
    note: emptyToNull(formData.get('note')),
  })

  if (!parsed.success) return { ok: false, error: 'Invalid status' }

  const supabase = await createClient()
  const operator = await getOperator()

  const { data: before } = await supabase
    .from('imports')
    .select('status, import_no')
    .eq('id', parsed.data.import_id)
    .single()

  if (before?.status === parsed.data.status) {
    return { ok: true }
  }

  const patch: Record<string, unknown> = { status: parsed.data.status }
  // Closing stamps the date; reopening clears it so the field never lies.
  if (parsed.data.status === 'Closed') patch.closed_at = new Date().toISOString()
  else patch.closed_at = null

  const { error } = await supabase.from('imports').update(patch).eq('id', parsed.data.import_id)
  if (error) return { ok: false, error: error.message }

  await supabase.from('activity_log').insert({
    import_id: parsed.data.import_id,
    event_type: 'status_changed',
    title: `Status changed from ${before?.status ?? 'unknown'} to ${parsed.data.status}`,
    detail: parsed.data.note,
    created_by: operator?.id ?? null,
  })

  revalidatePath(`/imports/${parsed.data.import_id}`)
  revalidatePath('/imports')
  revalidatePath('/')
  return { ok: true }
}

const noteSchema = z.object({
  import_id: z.string().uuid(),
  title: z.string().trim().min(1, 'Write something first').max(200),
  detail: z.string().trim().max(5000).optional().nullable(),
})

export async function addNote(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = noteSchema.safeParse({
    import_id: formData.get('import_id'),
    title: formData.get('title'),
    detail: emptyToNull(formData.get('detail')),
  })

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }

  const supabase = await createClient()
  const operator = await getOperator()

  const { error } = await supabase.from('activity_log').insert({
    import_id: parsed.data.import_id,
    event_type: 'note',
    title: parsed.data.title,
    detail: parsed.data.detail,
    created_by: operator?.id ?? null,
  })

  if (error) return { ok: false, error: error.message }

  revalidatePath(`/imports/${parsed.data.import_id}`)
  return { ok: true }
}

const supplierSchema = z.object({
  name: z.string().trim().min(1, 'Supplier name is required').max(200),
  country: z.string().trim().max(100).optional().nullable(),
  default_currency: z.string().trim().max(5).optional().nullable(),
})

/** Quick-add so creating an import is never blocked by a missing supplier. */
export async function createSupplier(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = supplierSchema.safeParse({
    name: formData.get('name'),
    country: emptyToNull(formData.get('country')),
    default_currency: emptyToNull(formData.get('default_currency')),
  })

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }

  const supabase = await createClient()
  const { error } = await supabase.from('suppliers').insert(parsed.data)

  if (error) {
    return {
      ok: false,
      error: error.code === '23505' ? 'A supplier with that name already exists.' : error.message,
    }
  }

  revalidatePath('/imports/new')
  revalidatePath('/suppliers')
  return { ok: true }
}
