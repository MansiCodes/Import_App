'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { extractPlaceholders } from '@/lib/email-template'
import { createClient } from '@/lib/supabase/server'

export interface ActionResult {
  ok: boolean
  error?: string
}

const companySchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1, 'Name is required').max(120),
  legal_name: z.string().trim().max(200).optional().nullable(),
  short_code: z
    .string()
    .trim()
    .min(2, 'Short code must be at least 2 characters')
    .max(10)
    .regex(/^[A-Za-z0-9]+$/, 'Short code may contain only letters and numbers')
    .transform((v) => v.toUpperCase()),
  gstin: z.string().trim().max(20).optional().nullable(),
  iec: z.string().trim().max(20).optional().nullable(),
  fy_start_month: z.coerce.number().int().min(1).max(12),
  po_number_template: z.string().trim().min(1, 'Template is required').max(120),
  drive_folder_url: z
    .string()
    .trim()
    .url('Must be a full URL')
    .optional()
    .nullable()
    .or(z.literal('')),
  notes: z.string().trim().max(2000).optional().nullable(),
  is_active: z.coerce.boolean(),
})

/** Blank optional inputs arrive as '' from FormData; store them as NULL. */
function emptyToNull(value: FormDataEntryValue | null): string | null {
  const str = typeof value === 'string' ? value.trim() : ''
  return str === '' ? null : str
}

export async function saveCompany(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = companySchema.safeParse({
    id: formData.get('id') || undefined,
    name: formData.get('name'),
    legal_name: emptyToNull(formData.get('legal_name')),
    short_code: formData.get('short_code'),
    gstin: emptyToNull(formData.get('gstin')),
    iec: emptyToNull(formData.get('iec')),
    fy_start_month: formData.get('fy_start_month'),
    po_number_template: formData.get('po_number_template'),
    drive_folder_url: emptyToNull(formData.get('drive_folder_url')),
    notes: emptyToNull(formData.get('notes')),
    is_active: formData.get('is_active') === 'on',
  })

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }

  const { id, ...values } = parsed.data
  const payload = { ...values, drive_folder_url: values.drive_folder_url || null }

  const supabase = await createClient()
  const { error } = id
    ? await supabase.from('companies').update(payload).eq('id', id)
    : await supabase.from('companies').insert(payload)

  if (error) {
    // 23505 = unique_violation. Name and short_code are both unique.
    const message =
      error.code === '23505'
        ? 'A company already uses that name or short code.'
        : error.message
    return { ok: false, error: message }
  }

  revalidatePath('/settings')
  return { ok: true }
}

const settingSchema = z.object({
  key: z.string().trim().min(1),
  value: z.string(),
})

export async function saveSetting(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = settingSchema.safeParse({
    key: formData.get('key'),
    value: formData.get('value'),
  })

  if (!parsed.success) {
    return { ok: false, error: 'Invalid input' }
  }

  // Settings are jsonb. Accept raw JSON (numbers, arrays) and fall back to
  // treating the input as a plain string so a typo cannot wipe a setting.
  let value: unknown
  try {
    value = JSON.parse(parsed.data.value)
  } catch {
    value = parsed.data.value
  }

  const supabase = await createClient()
  const { error } = await supabase
    .from('app_settings')
    .update({ value })
    .eq('key', parsed.data.key)

  if (error) return { ok: false, error: error.message }

  revalidatePath('/settings')
  return { ok: true }
}

const poSequenceSchema = z.object({
  company_id: z.string().uuid(),
  fy_label: z.string().trim().min(1).max(20),
  next_seq: z.coerce.number().int().min(1).max(999999),
})

/**
 * Fast-forward a PO sequence to match history — ATC has already issued POs 001
 * to 008 for FY 26-27, so the app must not restart at 001.
 */
export async function setPoSequence(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = poSequenceSchema.safeParse({
    company_id: formData.get('company_id'),
    fy_label: formData.get('fy_label'),
    next_seq: formData.get('next_seq'),
  })

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }

  const supabase = await createClient()
  const { error } = await supabase.rpc('set_po_seq', {
    p_company: parsed.data.company_id,
    p_fy: parsed.data.fy_label,
    p_next: parsed.data.next_seq,
  })

  if (error) return { ok: false, error: error.message }

  revalidatePath('/settings')
  return { ok: true }
}

const emailTemplateSchema = z.object({
  id: z.string().uuid().optional(),
  code: z
    .string()
    .trim()
    .min(2, 'Code is required')
    .max(60)
    .regex(/^[a-z0-9_]+$/, 'Code may contain lowercase letters, numbers and underscores only'),
  name: z.string().trim().min(1, 'Name is required').max(120),
  category: z.string().trim().max(40).nullable(),
  subject: z.string().trim().min(1, 'Subject is required').max(500),
  body: z.string().trim().min(1, 'Body is required').max(20000),
  is_active: z.coerce.boolean(),
})

/**
 * Save an email template.
 *
 * The placeholder list is recorded from the text itself rather than typed
 * separately, so it cannot drift out of step with what the template actually
 * uses. It is descriptive only — an unrecognised placeholder is left visible in
 * the prepared email rather than blanked, which is what makes a broken template
 * obvious before it reaches a supplier.
 */
export async function saveEmailTemplate(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = emailTemplateSchema.safeParse({
    id: formData.get('id') || undefined,
    code: formData.get('code'),
    name: formData.get('name'),
    category: emptyToNull(formData.get('category')),
    subject: formData.get('subject'),
    body: formData.get('body'),
    is_active: formData.get('is_active') === 'on',
  })

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }

  const { id, ...values } = parsed.data
  const placeholders = extractPlaceholders(`${values.subject}\n${values.body}`)

  const supabase = await createClient()
  const { error } = id
    ? await supabase.from('email_templates').update({ ...values, placeholders }).eq('id', id)
    : await supabase.from('email_templates').insert({ ...values, placeholders })

  if (error) {
    return {
      ok: false,
      error:
        error.code === '23505'
          ? `A template with the code "${values.code}" already exists.`
          : error.message,
    }
  }

  revalidatePath('/settings')
  return { ok: true }
}
