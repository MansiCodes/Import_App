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

const supplierSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1, 'Name is required').max(200),
  legal_name: z.string().trim().max(200).nullable(),
  country: z.string().trim().max(100).nullable(),
  city: z.string().trim().max(100).nullable(),
  default_currency: z.string().trim().max(5).nullable(),
  default_incoterm: z.string().trim().max(10).nullable(),
  payment_terms_text: z.string().trim().max(1000).nullable(),
  lead_time_days: z
    .union([z.string(), z.null()])
    .transform((v) => (v === null || v === '' ? null : Number(v)))
    .refine((v) => v === null || (Number.isInteger(v) && v >= 0), 'Lead time must be whole days'),
  website: z.string().trim().max(300).nullable(),
  notes: z.string().trim().max(5000).nullable(),
  is_active: z.coerce.boolean(),
})

export async function saveSupplier(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = supplierSchema.safeParse({
    id: formData.get('id') || undefined,
    name: formData.get('name'),
    legal_name: emptyToNull(formData.get('legal_name')),
    country: emptyToNull(formData.get('country')),
    city: emptyToNull(formData.get('city')),
    default_currency: emptyToNull(formData.get('default_currency')),
    default_incoterm: emptyToNull(formData.get('default_incoterm')),
    payment_terms_text: emptyToNull(formData.get('payment_terms_text')),
    lead_time_days: emptyToNull(formData.get('lead_time_days')),
    website: emptyToNull(formData.get('website')),
    notes: emptyToNull(formData.get('notes')),
    is_active: formData.get('is_active') === 'on',
  })

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }

  const { id, ...values } = parsed.data
  const supabase = await createClient()

  const { error } = id
    ? await supabase.from('suppliers').update(values).eq('id', id)
    : await supabase.from('suppliers').insert(values)

  if (error) {
    return {
      ok: false,
      error: error.code === '23505' ? 'A supplier with that name already exists.' : error.message,
    }
  }

  revalidatePath('/suppliers')
  if (id) revalidatePath(`/suppliers/${id}`)
  return { ok: true }
}

const contactSchema = z.object({
  id: z.string().uuid().optional(),
  supplier_id: z.string().uuid(),
  name: z.string().trim().min(1, 'Name is required').max(200),
  role: z.string().trim().max(100).nullable(),
  email: z.union([z.string().trim().email('Enter a valid email'), z.null()]),
  phone: z.string().trim().max(50).nullable(),
  whatsapp: z.string().trim().max(50).nullable(),
  is_primary: z.coerce.boolean(),
  notes: z.string().trim().max(2000).nullable(),
})

export async function saveContact(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = contactSchema.safeParse({
    id: formData.get('id') || undefined,
    supplier_id: formData.get('supplier_id'),
    name: formData.get('name'),
    role: emptyToNull(formData.get('role')),
    email: emptyToNull(formData.get('email')),
    phone: emptyToNull(formData.get('phone')),
    whatsapp: emptyToNull(formData.get('whatsapp')),
    is_primary: formData.get('is_primary') === 'on',
    notes: emptyToNull(formData.get('notes')),
  })

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }

  const { id, ...values } = parsed.data
  const supabase = await createClient()

  // Only one primary contact per supplier â€” demote the incumbent first, or the
  // partial unique index rejects the insert.
  if (values.is_primary) {
    let demote = supabase
      .from('supplier_contacts')
      .update({ is_primary: false })
      .eq('supplier_id', values.supplier_id)
      .eq('is_primary', true)

    if (id) demote = demote.neq('id', id)
    await demote
  }

  const { error } = id
    ? await supabase.from('supplier_contacts').update(values).eq('id', id)
    : await supabase.from('supplier_contacts').insert(values)

  if (error) return { ok: false, error: error.message }

  revalidatePath(`/suppliers/${values.supplier_id}`)
  return { ok: true }
}

export async function removeContact(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const id = formData.get('id')
  const supplierId = formData.get('supplier_id')
  if (typeof id !== 'string' || typeof supplierId !== 'string') {
    return { ok: false, error: 'Invalid input' }
  }

  const supabase = await createClient()
  // Deactivated, not deleted â€” historical imports referenced this person.
  const { error } = await supabase
    .from('supplier_contacts')
    .update({ is_active: false, is_primary: false })
    .eq('id', id)

  if (error) return { ok: false, error: error.message }

  revalidatePath(`/suppliers/${supplierId}`)
  return { ok: true }
}

const bankSchema = z.object({
  supplier_id: z.string().uuid(),
  beneficiary_name: z.string().trim().min(1, 'Beneficiary name is required').max(200),
  bank_name: z.string().trim().min(1, 'Bank name is required').max(200),
  account_no: z.string().trim().max(60).nullable(),
  iban: z.string().trim().max(60).nullable(),
  swift: z.string().trim().max(20).nullable(),
  bank_address: z.string().trim().max(500).nullable(),
  intermediary_bank: z.string().trim().max(200).nullable(),
  intermediary_swift: z.string().trim().max(20).nullable(),
  currency: z.string().trim().max(5).nullable(),
  source_note: z.string().trim().max(500).nullable(),
  confirm: z.literal('on', { message: 'Tick the confirmation to record new bank details' }),
})

/**
 * Record new bank details.
 *
 * Always inserts and supersedes â€” never updates in place. This is the highest
 * risk edit in the system (spec Â§35), so it requires explicit confirmation and
 * the new row always starts unverified.
 */
export async function changeBankAccount(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = bankSchema.safeParse({
    supplier_id: formData.get('supplier_id'),
    beneficiary_name: formData.get('beneficiary_name'),
    bank_name: formData.get('bank_name'),
    account_no: emptyToNull(formData.get('account_no')),
    iban: emptyToNull(formData.get('iban')),
    swift: emptyToNull(formData.get('swift')),
    bank_address: emptyToNull(formData.get('bank_address')),
    intermediary_bank: emptyToNull(formData.get('intermediary_bank')),
    intermediary_swift: emptyToNull(formData.get('intermediary_swift')),
    currency: emptyToNull(formData.get('currency')),
    source_note: emptyToNull(formData.get('source_note')),
    confirm: formData.get('confirm'),
  })

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }

  if (!parsed.data.account_no && !parsed.data.iban) {
    return { ok: false, error: 'Enter an account number or an IBAN.' }
  }

  const supabase = await createClient()
  const { error } = await supabase.rpc('supersede_bank_account', {
    p_supplier_id: parsed.data.supplier_id,
    p_beneficiary_name: parsed.data.beneficiary_name,
    p_bank_name: parsed.data.bank_name,
    p_account_no: parsed.data.account_no,
    p_iban: parsed.data.iban,
    p_swift: parsed.data.swift,
    p_bank_address: parsed.data.bank_address,
    p_intermediary_bank: parsed.data.intermediary_bank,
    p_intermediary_swift: parsed.data.intermediary_swift,
    p_currency: parsed.data.currency,
    p_source_note: parsed.data.source_note,
  })

  if (error) return { ok: false, error: error.message }

  revalidatePath(`/suppliers/${parsed.data.supplier_id}`)
  revalidatePath('/review')
  return { ok: true }
}

const verifyBankSchema = z.object({
  id: z.string().uuid(),
  supplier_id: z.string().uuid(),
  decision: z.enum(['verified', 'rejected']),
  remarks: z.string().trim().max(1000).nullable(),
})

export async function verifyBankAccount(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = verifyBankSchema.safeParse({
    id: formData.get('id'),
    supplier_id: formData.get('supplier_id'),
    decision: formData.get('decision'),
    remarks: emptyToNull(formData.get('remarks')),
  })

  if (!parsed.success) return { ok: false, error: 'Invalid input' }

  const supabase = await createClient()
  const operator = await getOperator()

  const { error } = await supabase
    .from('supplier_bank_accounts')
    .update({
      verification_status: parsed.data.decision,
      verified_by: operator?.id ?? null,
      verified_at: new Date().toISOString(),
      verification_remarks: parsed.data.remarks,
    })
    .eq('id', parsed.data.id)

  if (error) return { ok: false, error: error.message }

  revalidatePath(`/suppliers/${parsed.data.supplier_id}`)
  revalidatePath('/review')
  revalidatePath('/')
  return { ok: true }
}
