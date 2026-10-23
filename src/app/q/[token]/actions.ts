'use server'

import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { tokenState } from '@/lib/freight-token'
import { callerKey, rateLimit } from '@/lib/rate-limit'
import { createClient } from '@/lib/supabase/server'

export interface PortalResult {
  ok: boolean
  error?: string
}

/**
 * Everything an unauthenticated agent can do.
 *
 * Two rules hold this together:
 *
 *   THE TOKEN IS THE ONLY AUTHORISATION, so every action re-reads it from the
 *   database and re-checks that it is live. Nothing trusts a hidden form field
 *   naming the request or recipient — those are attacker-controlled.
 *
 *   THE AGENT NEVER LEARNS ANYTHING. Errors say what they need to and no more:
 *   an invalid token gets the same answer whether or not the request exists.
 */

/** Resolve a token to its recipient, or explain why not. */
async function resolveToken(token: string) {
  const supabase = await createClient()

  const { data } = await supabase
    .from('freight_quote_request_recipients')
    .select(
      'id, quote_request_id, recipient_name, status, revoked_at, token_expires_at, freight_quote_requests(status)',
    )
    .eq('token', token)
    .maybeSingle()

  if (!data) return null

  const requestStatus =
    (data as { freight_quote_requests?: { status?: string } }).freight_quote_requests?.status ?? ''

  const state = tokenState({
    revoked_at: data.revoked_at,
    token_expires_at: data.token_expires_at,
    request_status: requestStatus,
  })

  return { recipient: data, state }
}

const chargeSchema = z.object({
  charge_type: z.string().trim().min(1).max(60),
  custom_label: z.string().trim().max(120).nullable(),
  currency: z.string().trim().min(1).max(5),
  calculation_method: z.enum([
    'FIXED',
    'PER_KG',
    'PER_CHARGEABLE_KG',
    'PER_PACKAGE',
    'PER_PALLET',
    'PER_CBM',
    'NONE',
  ]),
  charge_status: z.enum([
    'QUOTED',
    'AT_ACTUAL',
    'AS_PER_RECEIPT',
    'INCLUDED',
    'NOT_APPLICABLE',
    'EXCLUDED',
  ]),
  rate: z.number().nullable(),
  quantity: z.number().nullable(),
  total_amount: z.number().nullable(),
  remarks: z.string().trim().max(500).nullable(),
  sort_order: z.number().int(),
})

const submissionSchema = z.object({
  currency: z.string().trim().min(1).max(5),
  carrier: z.string().trim().max(200).nullable(),
  routing: z.string().trim().max(300).nullable(),
  transit_time: z.string().trim().max(120).nullable(),
  schedule_note: z.string().trim().max(200).nullable(),
  free_days: z.number().int().min(0).max(365).nullable(),
  origin: z.string().trim().max(200).nullable(),
  destination: z.string().trim().max(200).nullable(),
  incoterm: z.string().trim().max(20).nullable(),
  gross_weight_kg: z.number().nullable(),
  chargeable_weight_kg: z.number().nullable(),
  cbm: z.number().nullable(),
  package_count: z.number().int().nullable(),
  pallet_count: z.number().int().nullable(),
  agent_fx_rate: z.number().nullable(),
  agent_quoted_total: z.number().nullable(),
  validity_date: z.string().nullable(),
  remarks: z.string().trim().max(2000).nullable(),
  charges: z.array(chargeSchema).min(1, 'Add at least one charge line').max(40),
})

/**
 * Receive a quote.
 *
 * A revision never overwrites: the previous version is marked superseded and
 * the new one becomes current, so what was originally offered stays on record
 * — the same rule documents follow.
 */
export async function submitQuote(token: string, payload: unknown): Promise<PortalResult> {
  const headerList = await headers()

  // A valid token holder submitting far faster than a person could type.
  const limit = rateLimit(callerKey(headerList, `submit:${token.slice(0, 12)}`), 10, 600)
  if (!limit.allowed) {
    return {
      ok: false,
      error: `Too many submissions. Try again in ${Math.ceil(limit.retryAfterSeconds / 60)} minutes.`,
    }
  }

  const resolved = await resolveToken(token)
  if (!resolved) return { ok: false, error: 'This link is not valid.' }

  if (!resolved.state.usable) {
    const reasons: Record<string, string> = {
      revoked: 'This link has been withdrawn.',
      expired: 'This link has expired.',
      closed: 'This quote request has closed.',
    }
    return { ok: false, error: reasons[resolved.state.reason] ?? 'This link is no longer open.' }
  }

  const parsed = submissionSchema.safeParse(payload)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Please check the form' }
  }

  const { charges, ...quote } = parsed.data
  const supabase = await createClient()
  const recipientId = resolved.recipient.id

  // Version from what exists, not from what the browser claims.
  const { data: previous } = await supabase
    .from('freight_quotes')
    .select('id, version_no')
    .eq('recipient_id', recipientId)
    .order('version_no', { ascending: false })
    .limit(1)
    .maybeSingle()

  const nextVersion = (previous?.version_no ?? 0) + 1

  // Retire the current version first: a partial unique index permits only one,
  // so inserting before superseding would violate it.
  if (previous) {
    await supabase.from('freight_quotes').update({ is_current: false }).eq('id', previous.id)
  }

  const { data: created, error } = await supabase
    .from('freight_quotes')
    .insert({
      ...quote,
      quote_request_id: resolved.recipient.quote_request_id,
      recipient_id: recipientId,
      version_no: nextVersion,
      is_current: true,
    })
    .select('id')
    .single()

  if (error) {
    // Put the previous version back rather than leaving the recipient with none.
    if (previous) {
      await supabase.from('freight_quotes').update({ is_current: true }).eq('id', previous.id)
    }
    return { ok: false, error: 'Could not save the quote. Please try again.' }
  }

  const { error: chargeError } = await supabase.from('freight_quote_charges').insert(
    charges.map((charge) => ({ ...charge, quote_id: created.id })),
  )

  if (chargeError) return { ok: false, error: 'Could not save the charges. Please try again.' }

  await supabase
    .from('freight_quote_request_recipients')
    .update({
      status: nextVersion > 1 ? 'Revised' : 'Submitted',
      submitted_at: new Date().toISOString(),
      latest_quote_id: created.id,
    })
    .eq('id', recipientId)

  // Keep the request's headline count honest.
  const { data: siblings } = await supabase
    .from('freight_quote_request_recipients')
    .select('status')
    .eq('quote_request_id', resolved.recipient.quote_request_id)

  const live = (siblings ?? []).filter((r) => r.status !== 'Revoked')
  const submitted = live.filter((r) => ['Submitted', 'Revised'].includes(r.status)).length

  await supabase
    .from('freight_quote_requests')
    .update({
      status: submitted >= live.length ? 'Complete' : 'Partially Submitted',
    })
    .eq('id', resolved.recipient.quote_request_id)
    .not('status', 'in', '("Closed","Cancelled")')

  const { data: request } = await supabase
    .from('freight_quote_requests')
    .select('import_id')
    .eq('id', resolved.recipient.quote_request_id)
    .maybeSingle()

  if (request) {
    await supabase.from('activity_log').insert({
      import_id: request.import_id,
      event_type: 'freight_quote',
      title:
        nextVersion > 1
          ? `${resolved.recipient.recipient_name} revised their quote (v${nextVersion})`
          : `${resolved.recipient.recipient_name} submitted a quote`,
      created_by: null,
    })

    revalidatePath(`/imports/${request.import_id}/freight-quotes`)
  }

  revalidatePath(`/q/${token}`)
  return { ok: true }
}

/** Record that a recipient will not be quoting, so they stop being chased. */
export async function declineQuote(token: string, reason: string | null): Promise<PortalResult> {
  const headerList = await headers()
  const limit = rateLimit(callerKey(headerList, `decline:${token.slice(0, 12)}`), 5, 600)
  if (!limit.allowed) return { ok: false, error: 'Too many attempts. Please try again later.' }

  const resolved = await resolveToken(token)
  if (!resolved || !resolved.state.usable) {
    return { ok: false, error: 'This link is no longer open.' }
  }

  const supabase = await createClient()

  const { error } = await supabase
    .from('freight_quote_request_recipients')
    .update({
      status: 'Declined',
      decline_reason: reason?.slice(0, 500) ?? null,
    })
    .eq('id', resolved.recipient.id)

  if (error) return { ok: false, error: 'Could not record that. Please try again.' }

  revalidatePath(`/q/${token}`)
  return { ok: true }
}

/** Note that the link was opened. Best effort — never blocks the page. */
export async function recordView(token: string): Promise<void> {
  const supabase = await createClient()
  const now = new Date().toISOString()

  const { data } = await supabase
    .from('freight_quote_request_recipients')
    .select('id, status, first_viewed_at')
    .eq('token', token)
    .maybeSingle()

  if (!data) return

  await supabase
    .from('freight_quote_request_recipients')
    .update({
      first_viewed_at: data.first_viewed_at ?? now,
      last_viewed_at: now,
      // Only advance a recipient who has not already done something bigger.
      ...(data.status === 'Sent' || data.status === 'Pending' ? { status: 'Viewed' } : {}),
    })
    .eq('id', data.id)
}
