'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { findUnparsed, runPipeline } from '@/lib/comms/pipeline'
import { createClient, getOperator } from '@/lib/supabase/server'

/**
 * Deciding what an inbound message means.
 *
 * Linking a communication to an import is a HUMAN act, and these actions are
 * the only way it happens. The matcher writes its belief to
 * communication_parses.matched_import_id and stops there; nothing here promotes
 * a guess without someone pressing the button.
 */

export interface ActionResult {
  ok: boolean
  error?: string
}

function emptyToNull(value: FormDataEntryValue | null): string | null {
  const str = typeof value === 'string' ? value.trim() : ''
  return str === '' ? null : str
}

function revalidate(communicationId?: string, importId?: string | null) {
  revalidatePath('/inbox')
  if (communicationId) revalidatePath(`/inbox/${communicationId}`)
  if (importId) {
    revalidatePath(`/imports/${importId}`)
    revalidatePath(`/imports/${importId}/timeline`)
  }
  revalidatePath('/')
}

const linkSchema = z.object({
  communication_id: z.string().uuid(),
  import_id: z.string().uuid({ message: 'Choose an import' }),
})

export async function linkCommunication(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = linkSchema.safeParse({
    communication_id: formData.get('communication_id'),
    import_id: formData.get('import_id'),
  })

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }

  const supabase = await createClient()
  const operator = await getOperator()

  const { error } = await supabase
    .from('communications')
    .update({
      import_id: parsed.data.import_id,
      linked_by: operator?.id ?? null,
      linked_at: new Date().toISOString(),
      status: 'in_review',
    })
    .eq('id', parsed.data.communication_id)

  if (error) return { ok: false, error: error.message }

  // The matcher's belief is now settled, whatever it had guessed.
  const { data: members } = await supabase
    .from('communication_parse_members')
    .select('parse_id')
    .eq('communication_id', parsed.data.communication_id)

  const parseIds = (members ?? []).map((row) => row.parse_id)
  if (parseIds.length > 0) {
    await supabase
      .from('communication_parses')
      .update({ match_status: 'confirmed' })
      .in('id', parseIds)
  }

  const { data: communication } = await supabase
    .from('communications')
    .select('body_text, sender_name, sender_phone, sent_at')
    .eq('id', parsed.data.communication_id)
    .single()

  // The timeline is where an import's history lives, so a linked message
  // belongs on it — with the words intact, not a summary of them.
  await supabase.from('activity_log').insert({
    import_id: parsed.data.import_id,
    event_type: 'whatsapp',
    title: `WhatsApp message linked${communication?.sender_name ? ` — ${communication.sender_name}` : ''}`,
    detail: communication?.body_text ?? null,
    occurred_at: communication?.sent_at ?? new Date().toISOString(),
    created_by: operator?.id ?? null,
  })

  revalidate(parsed.data.communication_id, parsed.data.import_id)
  return { ok: true }
}

const unlinkSchema = z.object({ communication_id: z.string().uuid() })

export async function unlinkCommunication(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = unlinkSchema.safeParse({ communication_id: formData.get('communication_id') })
  if (!parsed.success) return { ok: false, error: 'Invalid input' }

  const supabase = await createClient()

  const { data: existing } = await supabase
    .from('communications')
    .select('import_id')
    .eq('id', parsed.data.communication_id)
    .single()

  const { error } = await supabase
    .from('communications')
    .update({ import_id: null, linked_by: null, linked_at: null })
    .eq('id', parsed.data.communication_id)

  if (error) return { ok: false, error: error.message }

  revalidate(parsed.data.communication_id, existing?.import_id ?? null)
  return { ok: true }
}

const statusSchema = z.object({
  communication_id: z.string().uuid(),
  status: z.enum(['new', 'in_review', 'actioned', 'ignored', 'archived']),
})

export async function setCommunicationStatus(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = statusSchema.safeParse({
    communication_id: formData.get('communication_id'),
    status: formData.get('status'),
  })

  if (!parsed.success) return { ok: false, error: 'Invalid input' }

  const supabase = await createClient()
  const { error } = await supabase
    .from('communications')
    .update({ status: parsed.data.status })
    .eq('id', parsed.data.communication_id)

  if (error) return { ok: false, error: error.message }

  revalidate(parsed.data.communication_id)
  return { ok: true }
}

/**
 * Interpret whatever has never been interpreted.
 *
 * There is no scheduler in this application, so this button is the retry. A
 * parse that failed — or never ran because the platform cut the request short —
 * waits here rather than being silently forgotten.
 */
export async function parseUnparsed(): Promise<ActionResult> {
  try {
    const ids = await findUnparsed()
    if (ids.length === 0) return { ok: true }

    await runPipeline(ids)
    revalidate()
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Parsing failed' }
  }
}

const reparseSchema = z.object({ communication_id: z.string().uuid() })

export async function reparseCommunication(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = reparseSchema.safeParse({ communication_id: formData.get('communication_id') })
  if (!parsed.success) return { ok: false, error: 'Invalid input' }

  const supabase = await createClient()

  // Supersede rather than delete: what was proposed before is part of the
  // record, even when it was wrong.
  const { data: members } = await supabase
    .from('communication_parse_members')
    .select('parse_id')
    .eq('communication_id', parsed.data.communication_id)

  const parseIds = (members ?? []).map((row) => row.parse_id)
  if (parseIds.length > 0) {
    await supabase
      .from('communication_parses')
      .update({ status: 'superseded' })
      .in('id', parseIds)
      .neq('status', 'superseded')
  }

  await runPipeline([parsed.data.communication_id])

  revalidate(parsed.data.communication_id)
  return { ok: true }
}

const manualSchema = z.object({
  body_text: z.string().trim().min(1, { message: 'Paste the message' }).max(10000),
  sender_name: z.string().trim().max(200).nullable(),
  sender_phone: z.string().trim().max(50).nullable(),
  sent_at: z.string().trim().max(40).nullable(),
})

/**
 * The manual fallback.
 *
 * Everything must stay usable when the webhook is not configured, or when a
 * message arrived somewhere the integration cannot see. A pasted message is a
 * first-class communication — `source = 'manual'`, no provider id, and the same
 * matching runs over it.
 */
export async function ingestManualMessage(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = manualSchema.safeParse({
    body_text: formData.get('body_text'),
    sender_name: emptyToNull(formData.get('sender_name')),
    sender_phone: emptyToNull(formData.get('sender_phone')),
    sent_at: emptyToNull(formData.get('sent_at')),
  })

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }

  const supabase = await createClient()

  const { data, error } = await supabase
    .from('communications')
    .insert({
      source: 'manual',
      direction: 'inbound',
      message_type: 'text',
      body_text: parsed.data.body_text,
      sender_name: parsed.data.sender_name,
      sender_phone: parsed.data.sender_phone,
      sent_at: parsed.data.sent_at ? new Date(parsed.data.sent_at).toISOString() : null,
      status: 'new',
    })
    .select('id')
    .single()

  if (error) return { ok: false, error: error.message }

  await runPipeline([data.id])

  revalidate(data.id)
  return { ok: true }
}
