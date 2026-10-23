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

function revalidate(importId: string) {
  revalidatePath(`/imports/${importId}/emails`)
  revalidatePath(`/imports/${importId}`)
  revalidatePath(`/imports/${importId}/timeline`)
}

const draftSchema = z.object({
  import_id: z.string().uuid(),
  template_id: z.union([z.string().uuid(), z.null()]),
  to_email: z.string().trim().max(500).nullable(),
  cc_email: z.string().trim().max(500).nullable(),
  subject: z.string().trim().min(1, 'The subject is empty').max(500),
  body: z.string().trim().min(1, 'The body is empty').max(20000),
})

/**
 * Record that a draft was prepared.
 *
 * Preparing is not sending. The app has no mailbox access and asserts nothing
 * about delivery — `sent_manually_at` stays null until a human says otherwise.
 */
export async function saveDraft(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = draftSchema.safeParse({
    import_id: formData.get('import_id'),
    template_id: emptyToNull(formData.get('template_id')),
    to_email: emptyToNull(formData.get('to_email')),
    cc_email: emptyToNull(formData.get('cc_email')),
    subject: formData.get('subject'),
    body: formData.get('body'),
  })

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }

  const supabase = await createClient()
  const operator = await getOperator()

  const { error } = await supabase
    .from('email_drafts')
    .insert({ ...parsed.data, prepared_by: operator?.id ?? null })

  if (error) return { ok: false, error: error.message }

  await supabase.from('activity_log').insert({
    import_id: parsed.data.import_id,
    event_type: 'email',
    title: `Email prepared: ${parsed.data.subject}`,
    detail: parsed.data.to_email,
    created_by: operator?.id ?? null,
  })

  revalidate(parsed.data.import_id)
  return { ok: true }
}

const sentSchema = z.object({
  id: z.string().uuid(),
  import_id: z.string().uuid(),
  gmail_thread_url: z.string().trim().max(1000).nullable(),
})

/**
 * Mark a prepared draft as actually sent.
 *
 * The operator asserting it, not the system inferring it — there is no way for
 * this app to know, and pretending otherwise would make the log worthless.
 */
export async function markDraftSent(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = sentSchema.safeParse({
    id: formData.get('id'),
    import_id: formData.get('import_id'),
    gmail_thread_url: emptyToNull(formData.get('gmail_thread_url')),
  })

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }

  const supabase = await createClient()

  const { error } = await supabase
    .from('email_drafts')
    .update({
      sent_manually_at: new Date().toISOString(),
      gmail_thread_url: parsed.data.gmail_thread_url,
    })
    .eq('id', parsed.data.id)

  if (error) return { ok: false, error: error.message }

  // Sending is contact. The follow-up clock runs off this.
  await supabase
    .from('imports')
    .update({ last_contact_at: new Date().toISOString().slice(0, 10) })
    .eq('id', parsed.data.import_id)

  revalidate(parsed.data.import_id)
  revalidatePath('/')
  return { ok: true }
}

export async function deleteDraft(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const id = formData.get('id')
  const importId = formData.get('import_id')
  if (typeof id !== 'string' || typeof importId !== 'string') {
    return { ok: false, error: 'Invalid input' }
  }

  const supabase = await createClient()
  const { error } = await supabase.from('email_drafts').delete().eq('id', id)
  if (error) return { ok: false, error: error.message }

  revalidate(importId)
  return { ok: true }
}
