'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'

export interface ActionResult {
  ok: boolean
  error?: string
}

function emptyToNull(value: FormDataEntryValue | null): string | null {
  const str = typeof value === 'string' ? value.trim() : ''
  return str === '' ? null : str
}

const chaSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1, 'Name is required').max(200),
  company_name: z.string().trim().max(200).nullable(),
  contact_person: z.string().trim().max(200).nullable(),
  email: z.union([z.string().trim().email('Enter a valid email'), z.null()]),
  phone: z.string().trim().max(50).nullable(),
  whatsapp_phone: z.string().trim().max(50).nullable(),
  address: z.string().trim().max(500).nullable(),
  notes: z.string().trim().max(2000).nullable(),
  is_active: z.coerce.boolean(),
})

export async function saveCha(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = chaSchema.safeParse({
    id: formData.get('id') || undefined,
    name: formData.get('name'),
    company_name: emptyToNull(formData.get('company_name')),
    contact_person: emptyToNull(formData.get('contact_person')),
    email: emptyToNull(formData.get('email')),
    phone: emptyToNull(formData.get('phone')),
    whatsapp_phone: emptyToNull(formData.get('whatsapp_phone')),
    address: emptyToNull(formData.get('address')),
    notes: emptyToNull(formData.get('notes')),
    is_active: formData.get('is_active') === 'on',
  })

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }

  const { id, ...values } = parsed.data
  const supabase = await createClient()

  const { error } = id
    ? await supabase.from('chas').update(values).eq('id', id)
    : await supabase.from('chas').insert(values)

  if (error) {
    return {
      ok: false,
      error: error.code === '23505' ? 'A CHA with that name already exists.' : error.message,
    }
  }

  revalidatePath('/cha')
  return { ok: true }
}

const agentSchema = z.object({
  id: z.string().uuid().optional(),
  cha_id: z.string().uuid(),
  name: z.string().trim().min(1, 'Name is required').max(200),
  country: z.string().trim().max(100).nullable(),
  city: z.string().trim().max(100).nullable(),
  contact_person: z.string().trim().max(200).nullable(),
  email: z.union([z.string().trim().email('Enter a valid email'), z.null()]),
  phone: z.string().trim().max(50).nullable(),
  whatsapp_phone: z.string().trim().max(50).nullable(),
  modes: z.array(z.enum(['air', 'sea', 'courier', 'road'])),
  notes: z.string().trim().max(2000).nullable(),
})

export async function saveAgent(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = agentSchema.safeParse({
    id: formData.get('id') || undefined,
    cha_id: formData.get('cha_id'),
    name: formData.get('name'),
    country: emptyToNull(formData.get('country')),
    city: emptyToNull(formData.get('city')),
    contact_person: emptyToNull(formData.get('contact_person')),
    email: emptyToNull(formData.get('email')),
    phone: emptyToNull(formData.get('phone')),
    whatsapp_phone: emptyToNull(formData.get('whatsapp_phone')),
    modes: formData.getAll('modes'),
    notes: emptyToNull(formData.get('notes')),
  })

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }

  const { id, ...values } = parsed.data
  const supabase = await createClient()

  const { error } = id
    ? await supabase.from('cha_agents').update(values).eq('id', id)
    : await supabase.from('cha_agents').insert(values)

  if (error) return { ok: false, error: error.message }

  revalidatePath('/cha')
  return { ok: true }
}

export async function deactivateAgent(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const id = formData.get('id')
  if (typeof id !== 'string') return { ok: false, error: 'Invalid input' }

  const supabase = await createClient()
  const { error } = await supabase.from('cha_agents').update({ is_active: false }).eq('id', id)

  if (error) return { ok: false, error: error.message }

  revalidatePath('/cha')
  return { ok: true }
}
