'use server'

import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { z } from 'zod'
import { generateQuoteToken, quotePortalUrl } from '@/lib/freight-token'
import { pairNamedPhones } from '@/lib/quote-links'
import { formatDate } from '@/lib/utils'
import { sendQuoteLink } from '@/lib/comms/outbound'
import { rateLimit } from '@/lib/rate-limit'
import { createClient, getOperator, requireRole } from '@/lib/supabase/server'

export interface ActionResult {
  ok: boolean
  error?: string
  notice?: string
}

function emptyToNull(value: FormDataEntryValue | null): string | null {
  const str = typeof value === 'string' ? value.trim() : ''
  return str === '' ? null : str
}

const optionalNumber = z
  .union([z.string(), z.null()])
  .transform((v) => (v === null || v === '' ? null : Number(v)))
  .refine((v) => v === null || (Number.isFinite(v) && v >= 0), 'Must be a positive number')

async function logActivity(importId: string, title: string, detail?: string | null) {
  const supabase = await createClient()
  const operator = await getOperator()

  await supabase.from('activity_log').insert({
    import_id: importId,
    event_type: 'freight_quote',
    title,
    detail: detail ?? null,
    created_by: operator?.id ?? null,
  })
}

function revalidate(importId: string) {
  revalidatePath(`/imports/${importId}/freight-quotes`)
  revalidatePath(`/imports/${importId}`)
  revalidatePath('/freight-quotes')
  revalidatePath('/')
}

/**
 * Recalculate a request's status from its recipients.
 *
 * Derived rather than set by hand, so "2 of 4 submitted" can never disagree
 * with the rows underneath it. Closed and Cancelled are operator decisions and
 * are left alone.
 */
async function refreshRequestStatus(requestId: string) {
  const supabase = await createClient()

  const { data: request } = await supabase
    .from('freight_quote_requests')
    .select('status, import_id')
    .eq('id', requestId)
    .maybeSingle()

  if (!request || ['Closed', 'Cancelled', 'Draft'].includes(request.status)) return

  const { data: recipients } = await supabase
    .from('freight_quote_request_recipients')
    .select('status')
    .eq('quote_request_id', requestId)

  const live = (recipients ?? []).filter((r) => r.status !== 'Revoked')
  if (live.length === 0) return

  const submitted = live.filter((r) => ['Submitted', 'Revised'].includes(r.status)).length

  const status =
    submitted === 0 ? 'Open' : submitted < live.length ? 'Partially Submitted' : 'Complete'

  await supabase.from('freight_quote_requests').update({ status }).eq('id', requestId)
}

// ---------------------------------------------------------------------------
// FQ2 — the request itself
// ---------------------------------------------------------------------------

const createSchema = z.object({
  import_id: z.string().uuid(),
  shipment_id: z.union([z.string().uuid(), z.null()]),
  mode: z.enum(['AIR', 'SEA_LCL']),
})

/**
 * Open a quote request, pre-filled from what we already know.
 *
 * The CHA is never asked for a shipment fact the import already holds — that is
 * the difference between this and emailing a blank template. Everything copied
 * here stays editable, because our own record is sometimes wrong.
 */
export async function createQuoteRequest(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = createSchema.safeParse({
    import_id: formData.get('import_id'),
    shipment_id: emptyToNull(formData.get('shipment_id')),
    mode: formData.get('mode'),
  })

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }

  const supabase = await createClient()
  const operator = await getOperator()

  const { data: imp } = await supabase
    .from('imports')
    .select('id, origin_country, incoterm, title')
    .eq('id', parsed.data.import_id)
    .maybeSingle()

  if (!imp) return { ok: false, error: 'Import not found' }

  const { data: shipment } = parsed.data.shipment_id
    ? await supabase
        .from('shipments')
        .select(
          'origin_port, destination_port, incoterm, gross_weight_kg, net_weight_kg, chargeable_weight_kg, cbm, packages',
        )
        .eq('id', parsed.data.shipment_id)
        .maybeSingle()
    : { data: null }

  const { data: requestNo } = await supabase.rpc('next_quote_request_no', {
    p_year: new Date().getFullYear(),
  })

  const { data: created, error } = await supabase
    .from('freight_quote_requests')
    .insert({
      import_id: parsed.data.import_id,
      shipment_id: parsed.data.shipment_id,
      request_no: requestNo,
      mode: parsed.data.mode,
      status: 'Draft',
      origin: shipment?.origin_port ?? imp.origin_country ?? null,
      destination: shipment?.destination_port ?? null,
      incoterm: shipment?.incoterm ?? imp.incoterm ?? null,
      cargo_description: imp.title ?? null,
      gross_weight_kg: shipment?.gross_weight_kg ?? null,
      net_weight_kg: shipment?.net_weight_kg ?? null,
      chargeable_weight_kg: shipment?.chargeable_weight_kg ?? null,
      cbm: shipment?.cbm ?? null,
      package_count: shipment?.packages ?? null,
      created_by: operator?.id ?? null,
    })
    .select('id, request_no')
    .single()

  if (error) return { ok: false, error: error.message }

  await logActivity(
    parsed.data.import_id,
    `Freight quote request ${created.request_no} created`,
    parsed.data.mode === 'AIR' ? 'Air' : 'Sea LCL',
  )

  revalidate(parsed.data.import_id)
  return { ok: true, notice: `${created.request_no} created.` }
}

const updateSchema = z.object({
  id: z.string().uuid(),
  import_id: z.string().uuid(),
  origin: z.string().trim().max(200).nullable(),
  destination: z.string().trim().max(200).nullable(),
  incoterm: z.string().trim().max(20).nullable(),
  cargo_description: z.string().trim().max(500).nullable(),
  gross_weight_kg: optionalNumber,
  net_weight_kg: optionalNumber,
  chargeable_weight_kg: optionalNumber,
  cbm: optionalNumber,
  package_count: optionalNumber,
  pallet_count: optionalNumber,
  request_notes: z.string().trim().max(2000).nullable(),
  response_deadline: z.union([z.string(), z.null()]).transform((v) => (v === '' ? null : v)),
  comparison_currency: z.string().trim().min(1).max(5),
})

export async function updateQuoteRequest(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = updateSchema.safeParse({
    id: formData.get('id'),
    import_id: formData.get('import_id'),
    origin: emptyToNull(formData.get('origin')),
    destination: emptyToNull(formData.get('destination')),
    incoterm: emptyToNull(formData.get('incoterm')),
    cargo_description: emptyToNull(formData.get('cargo_description')),
    gross_weight_kg: emptyToNull(formData.get('gross_weight_kg')),
    net_weight_kg: emptyToNull(formData.get('net_weight_kg')),
    chargeable_weight_kg: emptyToNull(formData.get('chargeable_weight_kg')),
    cbm: emptyToNull(formData.get('cbm')),
    package_count: emptyToNull(formData.get('package_count')),
    pallet_count: emptyToNull(formData.get('pallet_count')),
    request_notes: emptyToNull(formData.get('request_notes')),
    response_deadline: emptyToNull(formData.get('response_deadline')),
    comparison_currency: formData.get('comparison_currency'),
  })

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }

  const { id, import_id, ...values } = parsed.data
  const supabase = await createClient()

  const { error } = await supabase.from('freight_quote_requests').update(values).eq('id', id)
  if (error) return { ok: false, error: error.message }

  revalidate(import_id)
  return { ok: true }
}

// ---------------------------------------------------------------------------
// FQ3 — recipients and their private links
// ---------------------------------------------------------------------------

const recipientSchema = z.object({
  quote_request_id: z.string().uuid(),
  import_id: z.string().uuid(),
  cha_id: z.union([z.string().uuid(), z.null()]),
  agent_id: z.union([z.string().uuid(), z.null()]),
  recipient_name: z.string().trim().min(1, 'Name the recipient').max(200),
  phone: z.string().trim().max(50).nullable(),
  email: z.union([z.string().trim().email('Enter a valid email'), z.null()]),
  expires_in_days: optionalNumber,
})

export async function addRecipient(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = recipientSchema.safeParse({
    quote_request_id: formData.get('quote_request_id'),
    import_id: formData.get('import_id'),
    cha_id: emptyToNull(formData.get('cha_id')),
    agent_id: emptyToNull(formData.get('agent_id')),
    recipient_name: formData.get('recipient_name'),
    phone: emptyToNull(formData.get('phone')),
    email: emptyToNull(formData.get('email')),
    expires_in_days: emptyToNull(formData.get('expires_in_days')),
  })

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }

  const { import_id, expires_in_days, ...values } = parsed.data
  const supabase = await createClient()

  const expiresAt = expires_in_days
    ? new Date(Date.now() + expires_in_days * 86_400_000).toISOString()
    : null

  const { error } = await supabase.from('freight_quote_request_recipients').insert({
    ...values,
    token: generateQuoteToken(),
    token_expires_at: expiresAt,
  })

  if (error) return { ok: false, error: error.message }

  await logActivity(import_id, `Quote link generated for ${values.recipient_name}`)
  revalidate(import_id)
  return { ok: true }
}

const recipientActionSchema = z.object({
  id: z.string().uuid(),
  import_id: z.string().uuid(),
})

/**
 * Record that the link has gone out.
 *
 * The operator pastes it into WhatsApp themselves, so the app cannot observe
 * delivery. Marking it sent is therefore an assertion by a person, exactly like
 * marking a payment paid — and it is what starts the reminder clock.
 */
export async function markRecipientSent(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = recipientActionSchema.safeParse({
    id: formData.get('id'),
    import_id: formData.get('import_id'),
  })
  if (!parsed.success) return { ok: false, error: 'Invalid input' }

  const supabase = await createClient()

  const { data: recipient } = await supabase
    .from('freight_quote_request_recipients')
    .select('recipient_name, quote_request_id, status')
    .eq('id', parsed.data.id)
    .maybeSingle()

  if (!recipient) return { ok: false, error: 'Recipient not found' }

  // Never walk a recipient backwards from a submission to "sent".
  if (['Submitted', 'Revised'].includes(recipient.status)) {
    return { ok: false, error: 'They have already submitted a quote.' }
  }

  const { error } = await supabase
    .from('freight_quote_request_recipients')
    .update({ status: 'Sent', sent_at: new Date().toISOString() })
    .eq('id', parsed.data.id)

  if (error) return { ok: false, error: error.message }

  await supabase
    .from('freight_quote_requests')
    .update({ status: 'Open' })
    .eq('id', recipient.quote_request_id)
    .eq('status', 'Draft')

  await logActivity(parsed.data.import_id, `Quote request sent to ${recipient.recipient_name}`)
  revalidate(parsed.data.import_id)
  return { ok: true }
}

/** FQ11 — a nudge the operator sends by hand, never automatically. */
export async function recordReminder(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = recipientActionSchema.safeParse({
    id: formData.get('id'),
    import_id: formData.get('import_id'),
  })
  if (!parsed.success) return { ok: false, error: 'Invalid input' }

  const supabase = await createClient()

  const { data: recipient } = await supabase
    .from('freight_quote_request_recipients')
    .select('recipient_name, reminder_count')
    .eq('id', parsed.data.id)
    .maybeSingle()

  if (!recipient) return { ok: false, error: 'Recipient not found' }

  const { error } = await supabase
    .from('freight_quote_request_recipients')
    .update({
      reminder_count: recipient.reminder_count + 1,
      last_reminder_at: new Date().toISOString(),
    })
    .eq('id', parsed.data.id)

  if (error) return { ok: false, error: error.message }

  await logActivity(parsed.data.import_id, `Reminder sent to ${recipient.recipient_name}`)
  revalidate(parsed.data.import_id)
  return { ok: true }
}

/**
 * Revoke a link.
 *
 * Deletes nothing: any quote they already submitted stays, and stays comparable.
 * Revoking withdraws the ability to submit again, not the record of having done
 * so.
 */
export async function revokeRecipient(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = recipientActionSchema.safeParse({
    id: formData.get('id'),
    import_id: formData.get('import_id'),
  })
  if (!parsed.success) return { ok: false, error: 'Invalid input' }

  const supabase = await createClient()

  const { data: recipient } = await supabase
    .from('freight_quote_request_recipients')
    .select('recipient_name, quote_request_id')
    .eq('id', parsed.data.id)
    .maybeSingle()

  const { error } = await supabase
    .from('freight_quote_request_recipients')
    .update({ revoked_at: new Date().toISOString(), status: 'Revoked' })
    .eq('id', parsed.data.id)

  if (error) return { ok: false, error: error.message }

  if (recipient) {
    await refreshRequestStatus(recipient.quote_request_id)
    await logActivity(parsed.data.import_id, `Quote link revoked for ${recipient.recipient_name}`)
  }

  revalidate(parsed.data.import_id)
  return { ok: true }
}

// ---------------------------------------------------------------------------
// FQ7 — the rate the comparison is made at
// ---------------------------------------------------------------------------

const fxSchema = z.object({
  quote_request_id: z.string().uuid(),
  import_id: z.string().uuid(),
  currency: z.string().trim().min(1).max(5),
  rate: z
    .union([z.string(), z.number()])
    .transform(Number)
    .refine((v) => Number.isFinite(v) && v > 0, 'Enter a positive rate'),
})

/**
 * Set the rate one currency is compared at.
 *
 * Entered by a person, never fetched — the same rule the rest of the app
 * follows for money. The agent's own rate is stored on their quote and is never
 * used here, because comparing quotes at different rates compares nothing.
 */
export async function setComparisonRate(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = fxSchema.safeParse({
    quote_request_id: formData.get('quote_request_id'),
    import_id: formData.get('import_id'),
    currency: formData.get('currency'),
    rate: formData.get('rate'),
  })

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }

  const supabase = await createClient()
  const operator = await getOperator()

  const { error } = await supabase.from('freight_quote_fx_rates').upsert(
    {
      quote_request_id: parsed.data.quote_request_id,
      currency: parsed.data.currency,
      rate_to_comparison: parsed.data.rate,
      set_by: operator?.id ?? null,
      set_at: new Date().toISOString(),
    },
    { onConflict: 'quote_request_id,currency' },
  )

  if (error) return { ok: false, error: error.message }

  await logActivity(
    parsed.data.import_id,
    `Comparison rate set: 1 ${parsed.data.currency} = ${parsed.data.rate}`,
  )
  revalidate(parsed.data.import_id)
  return { ok: true }
}

// ---------------------------------------------------------------------------
// FQ8 — selection
// ---------------------------------------------------------------------------

const selectSchema = z.object({
  quote_request_id: z.string().uuid(),
  import_id: z.string().uuid(),
  quote_id: z.string().uuid(),
  reason: z.string().trim().max(1000).nullable(),
  confirm: z.literal('on', { message: 'Tick the box to confirm this selection' }),
})

/**
 * Award the business to one quote.
 *
 * Always a person's decision. Nothing here reads the totals — the cheapest
 * comparable quote is frequently not the one to take, because the comparison
 * deliberately cannot price "at actual" charges.
 */
export async function selectQuote(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = selectSchema.safeParse({
    quote_request_id: formData.get('quote_request_id'),
    import_id: formData.get('import_id'),
    quote_id: formData.get('quote_id'),
    reason: emptyToNull(formData.get('reason')),
    confirm: formData.get('confirm'),
  })

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }

  const supabase = await createClient()
  const operator = await getOperator()

  const { data: quote } = await supabase
    .from('freight_quotes')
    .select('id, recipient_id, freight_quote_request_recipients(recipient_name)')
    .eq('id', parsed.data.quote_id)
    .maybeSingle()

  const { error } = await supabase
    .from('freight_quote_requests')
    .update({
      selected_quote_id: parsed.data.quote_id,
      selected_by: operator?.id ?? null,
      selected_at: new Date().toISOString(),
      selection_reason: parsed.data.reason,
    })
    .eq('id', parsed.data.quote_request_id)

  if (error) return { ok: false, error: error.message }

  const name =
    (quote as { freight_quote_request_recipients?: { recipient_name?: string } } | null)
      ?.freight_quote_request_recipients?.recipient_name ?? 'a quote'

  await logActivity(parsed.data.import_id, `Freight quote selected: ${name}`, parsed.data.reason)
  revalidate(parsed.data.import_id)
  return { ok: true, notice: 'Quote selected.' }
}

const copyCostSchema = z.object({
  quote_request_id: z.string().uuid(),
  import_id: z.string().uuid(),
  amount: z
    .union([z.string(), z.number()])
    .transform(Number)
    .refine((v) => Number.isFinite(v) && v > 0, 'Enter the amount to record'),
  currency: z.string().trim().min(1).max(5),
  fx_rate: z
    .union([z.string(), z.null()])
    .transform((v) => (v === null || v === '' ? null : Number(v)))
    .refine((v) => v === null || (Number.isFinite(v) && v > 0), 'Enter a valid rate'),
  vendor: z.string().trim().max(200).nullable(),
  confirm: z.literal('on', { message: 'Confirm before recording a cost' }),
})

/**
 * Copy the selected quote into the import's costs.
 *
 * Separated from selection and separately confirmed, because this one writes a
 * financial figure into landed cost. Recorded as an ESTIMATE: a quote is a
 * price offered, not an invoice received, and the two differ often enough that
 * conflating them would quietly corrupt the landed cost.
 */
export async function copyQuoteToCosts(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = copyCostSchema.safeParse({
    quote_request_id: formData.get('quote_request_id'),
    import_id: formData.get('import_id'),
    amount: formData.get('amount'),
    currency: formData.get('currency'),
    fx_rate: emptyToNull(formData.get('fx_rate')),
    vendor: emptyToNull(formData.get('vendor')),
    confirm: formData.get('confirm'),
  })

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }

  const supabase = await createClient()
  const operator = await getOperator()

  const { data: request } = await supabase
    .from('freight_quote_requests')
    .select('request_no, shipment_id')
    .eq('id', parsed.data.quote_request_id)
    .maybeSingle()

  const { error } = await supabase.from('import_costs').insert({
    import_id: parsed.data.import_id,
    shipment_id: request?.shipment_id ?? null,
    cost_type: 'freight',
    description: `Selected freight quote ${request?.request_no ?? ''}`.trim(),
    vendor: parsed.data.vendor,
    currency: parsed.data.currency,
    amount: parsed.data.amount,
    fx_rate: parsed.data.fx_rate,
    inr_amount: parsed.data.fx_rate
      ? Number((parsed.data.amount * parsed.data.fx_rate).toFixed(2))
      : null,
    is_estimate: true,
    created_by: operator?.id ?? null,
  })

  if (error) return { ok: false, error: error.message }

  await logActivity(
    parsed.data.import_id,
    `Freight cost recorded from ${request?.request_no ?? 'quote'}`,
    'Marked as an estimate until the freight invoice arrives',
  )
  revalidatePath(`/imports/${parsed.data.import_id}/costs`)
  revalidate(parsed.data.import_id)
  return { ok: true, notice: 'Recorded as an estimated freight cost.' }
}

const closeSchema = z.object({
  id: z.string().uuid(),
  import_id: z.string().uuid(),
  action: z.enum(['close', 'reopen', 'cancel']),
})

export async function setRequestState(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = closeSchema.safeParse({
    id: formData.get('id'),
    import_id: formData.get('import_id'),
    action: formData.get('action'),
  })
  if (!parsed.success) return { ok: false, error: 'Invalid input' }

  const supabase = await createClient()

  if (parsed.data.action === 'reopen') {
    await supabase
      .from('freight_quote_requests')
      .update({ status: 'Open', closed_at: null })
      .eq('id', parsed.data.id)
    await refreshRequestStatus(parsed.data.id)
    await logActivity(parsed.data.import_id, 'Quote request reopened')
  } else {
    const status = parsed.data.action === 'cancel' ? 'Cancelled' : 'Closed'
    await supabase
      .from('freight_quote_requests')
      .update({ status, closed_at: new Date().toISOString() })
      .eq('id', parsed.data.id)
    await logActivity(parsed.data.import_id, `Quote request ${status.toLowerCase()}`)
  }

  revalidate(parsed.data.import_id)
  return { ok: true }
}

// ---------------------------------------------------------------------------
// One-shot creation
// ---------------------------------------------------------------------------

const combinedSchema = z.object({
  import_id: z.string().uuid(),
  shipment_id: z.union([z.string().uuid(), z.null()]),
  mode: z.enum(['AIR', 'SEA_LCL']),
  origin: z.string().trim().max(200).nullable(),
  destination: z.string().trim().max(200).nullable(),
  incoterm: z.string().trim().max(20).nullable(),
  cargo_description: z.string().trim().max(500).nullable(),
  gross_weight_kg: optionalNumber,
  chargeable_weight_kg: optionalNumber,
  cbm: optionalNumber,
  package_count: optionalNumber,
  pallet_count: optionalNumber,
  response_deadline: z.union([z.string(), z.null()]).transform((v) => (v === '' ? null : v)),
  request_notes: z.string().trim().max(2000).nullable(),
  cha_ids: z.array(z.string().uuid()),
  extra_names: z.array(z.string()),
  extra_phones: z.array(z.string()),
})

/**
 * Create the request AND every recipient link in one action.
 *
 * Replaces a two-screen flow where a request was created empty and recipients
 * added afterwards. Asking for the mode and then making somebody navigate to a
 * second screen to say who it is for split one decision across two pages for no
 * reason — the operator already knows both before they start.
 *
 * Everything the CHA will see is submitted with it, so the shipment facts can
 * be corrected before any link exists rather than after they are sent.
 */
export async function createRequestWithRecipients(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = combinedSchema.safeParse({
    import_id: formData.get('import_id'),
    shipment_id: emptyToNull(formData.get('shipment_id')),
    mode: formData.get('mode'),
    origin: emptyToNull(formData.get('origin')),
    destination: emptyToNull(formData.get('destination')),
    incoterm: emptyToNull(formData.get('incoterm')),
    cargo_description: emptyToNull(formData.get('cargo_description')),
    gross_weight_kg: emptyToNull(formData.get('gross_weight_kg')),
    chargeable_weight_kg: emptyToNull(formData.get('chargeable_weight_kg')),
    cbm: emptyToNull(formData.get('cbm')),
    package_count: emptyToNull(formData.get('package_count')),
    pallet_count: emptyToNull(formData.get('pallet_count')),
    response_deadline: emptyToNull(formData.get('response_deadline')),
    request_notes: emptyToNull(formData.get('request_notes')),
    cha_ids: formData.getAll('cha_ids').filter((v) => typeof v === 'string' && v !== ''),
    extra_names: formData.getAll('extra_names').map((v) => String(v)),
    extra_phones: formData.getAll('extra_phones').map((v) => String(v)),
  })

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }

  const { import_id, cha_ids, extra_names, extra_phones, ...facts } = parsed.data
  const extras = pairNamedPhones(
    extra_names.map((name) => name.trim()),
    extra_phones,
  ).filter((extra) => extra.name.length > 0 && extra.name.length <= 200)

  if (cha_ids.length === 0 && extras.length === 0) {
    return { ok: false, error: 'Choose at least one company to request a quote from.' }
  }

  const supabase = await createClient()
  const operator = await getOperator()

  const { data: requestNo } = await supabase.rpc('next_quote_request_no', {
    p_year: new Date().getFullYear(),
  })

  const { data: created, error } = await supabase
    .from('freight_quote_requests')
    .insert({
      ...facts,
      import_id,
      request_no: requestNo,
      // Open, not Draft: the links exist the moment this returns, so the
      // request is genuinely out for quotation.
      status: 'Open',
      created_by: operator?.id ?? null,
    })
    .select('id, request_no')
    .single()

  if (error) return { ok: false, error: error.message }

  // Names and numbers are read from the CHA master at this moment and stored on
  // the recipient, so renaming a CHA later cannot rewrite what was sent.
  const { data: chas } =
    cha_ids.length > 0
      ? await supabase.from('chas').select('id, name, phone, whatsapp_phone').in('id', cha_ids)
      : { data: [] as Array<{ id: string; name: string; phone: string | null; whatsapp_phone: string | null }> }

  const recipients = [
    ...(chas ?? []).map((cha) => ({
      quote_request_id: created.id,
      cha_id: cha.id,
      recipient_name: cha.name,
      phone: cha.whatsapp_phone || cha.phone || null,
      token: generateQuoteToken(),
    })),
    ...extras.map(({ name, phone }) => ({
      quote_request_id: created.id,
      recipient_name: name,
      phone,
      token: generateQuoteToken(),
    })),
  ]

  const { error: recipientError } = await supabase
    .from('freight_quote_request_recipients')
    .insert(recipients)

  if (recipientError) {
    // Leave no half-made request behind for somebody to puzzle over.
    await supabase.from('freight_quote_requests').delete().eq('id', created.id)
    return { ok: false, error: recipientError.message }
  }

  await logActivity(
    import_id,
    `Freight quote request ${created.request_no} created`,
    `${facts.mode === 'AIR' ? 'Air' : 'Sea LCL'} · ${recipients.length} recipient${recipients.length === 1 ? '' : 's'}`,
  )

  revalidate(import_id)
  return {
    ok: true,
    notice: `${created.request_no} created with ${recipients.length} link${recipients.length === 1 ? '' : 's'}.`,
  }
}

// ---------------------------------------------------------------------------
// WhatsApp distribution
//
// Sending is never automatic. A request is created with its links and nothing
// leaves until a person presses a button — which is also why the send actions
// live here rather than inside createRequestWithRecipients.
// ---------------------------------------------------------------------------

/**
 * Where this deployment lives, taken from the request rather than the browser.
 *
 * The quote link goes out in a message to an outside company, so the host it
 * points at must not be something a client can supply. Reading it here means a
 * tampered form cannot turn a quote request into a link to somewhere else.
 */
async function requestOrigin(): Promise<string> {
  const headerList = await headers()
  const host = headerList.get('x-forwarded-host') ?? headerList.get('host')
  const proto = headerList.get('x-forwarded-proto') ?? 'https'
  return host ? `${proto}://${host}` : ''
}

/** Build what the message needs from the request and recipient. */
async function quoteLinkContext(recipientId: string, origin: string) {
  const supabase = await createClient()

  const { data } = await supabase
    .from('freight_quote_request_recipients')
    .select(
      'recipient_name, token, freight_quote_requests(mode, origin, destination, gross_weight_kg, package_count, incoterm, response_deadline, imports(import_no))',
    )
    .eq('id', recipientId)
    .maybeSingle()

  if (!data) return null

  // PostgREST types an embedded relation as an array even when it resolves to
  // one row, and returns either shape depending on the query. Normalise both.
  const embedded = (data as unknown as { freight_quote_requests?: unknown })
    .freight_quote_requests
  const request = (Array.isArray(embedded) ? embedded[0] : embedded) as
    | Record<string, unknown>
    | undefined

  const parent = Array.isArray(request?.imports) ? request.imports[0] : request?.imports
  const deadline = request?.response_deadline ? String(request.response_deadline) : null

  return {
    recipientName: data.recipient_name,
    importNo: String((parent as Record<string, unknown>)?.import_no ?? ''),
    mode: request?.mode === 'AIR' ? 'AIR' : 'SEA LCL',
    origin: String(request?.origin ?? ''),
    destination: String(request?.destination ?? ''),
    grossWeight: request?.gross_weight_kg
      ? `${Number(request.gross_weight_kg).toLocaleString('en-IN')} kg`
      : '',
    packages: request?.package_count ? String(request.package_count) : '',
    incoterm: String(request?.incoterm ?? ''),
    quoteLink: quotePortalUrl(data.token, origin),
    deadlineLine: deadline ? `Please submit by ${formatDate(deadline)}.` : '',
  }
}

const sendSchema = z.object({
  id: z.string().uuid(),
  import_id: z.string().uuid(),
  resend: z.string().nullable(),
})

/** Send one recipient their own link. */
export async function sendWhatsApp(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requireRole(['admin', 'import_manager'])

  const parsed = sendSchema.safeParse({
    id: formData.get('id'),
    import_id: formData.get('import_id'),
    resend: emptyToNull(formData.get('resend')),
  })
  if (!parsed.success) return { ok: false, error: 'Invalid input' }

  const limit = rateLimit(`fq-send:${actor.id}`, 30, 300)
  if (!limit.allowed) {
    return { ok: false, error: 'Too many sends just now. Try again in a few minutes.' }
  }

  const context = await quoteLinkContext(parsed.data.id, await requestOrigin())
  if (!context) return { ok: false, error: 'Recipient not found' }

  const outcome = await sendQuoteLink({
    recipientId: parsed.data.id,
    context,
    actorId: actor.id,
    resend: parsed.data.resend === 'on',
  })

  if (!outcome.ok) {
    revalidate(parsed.data.import_id)
    return { ok: false, error: outcome.detail }
  }

  await logActivity(parsed.data.import_id, `Quote link sent to ${context.recipientName} on WhatsApp`)
  revalidate(parsed.data.import_id)
  return { ok: true, notice: `Sent to ${context.recipientName}.` }
}

const bulkSchema = z.object({
  quote_request_id: z.string().uuid(),
  import_id: z.string().uuid(),
  confirm: z.literal('on', { message: 'Confirm before sending' }),
})

/**
 * Send to everyone still waiting.
 *
 * One recipient without a number must not stop the rest, so each is attempted
 * independently and the outcome is reported per company. Recipients who have
 * already been sent to are skipped — this never resends.
 */
export async function sendWhatsAppToAllPending(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requireRole(['admin', 'import_manager'])

  const parsed = bulkSchema.safeParse({
    quote_request_id: formData.get('quote_request_id'),
    import_id: formData.get('import_id'),
    confirm: formData.get('confirm'),
  })
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }

  const limit = rateLimit(`fq-bulk:${actor.id}`, 5, 300)
  if (!limit.allowed) {
    return { ok: false, error: 'Too many bulk sends just now. Try again in a few minutes.' }
  }

  const supabase = await createClient()
  const { data: recipients } = await supabase
    .from('freight_quote_request_recipients')
    .select('id, recipient_name, status')
    .eq('quote_request_id', parsed.data.quote_request_id)
    .is('revoked_at', null)
    .eq('status', 'Pending')

  if (!recipients?.length) return { ok: false, error: 'Nobody is waiting to be sent to.' }

  const origin = await requestOrigin()
  const sent: string[] = []
  const skipped: string[] = []

  for (const recipient of recipients) {
    const context = await quoteLinkContext(recipient.id, origin)
    if (!context) continue

    const outcome = await sendQuoteLink({
      recipientId: recipient.id,
      context,
      actorId: actor.id,
    })

    if (outcome.ok) sent.push(recipient.recipient_name)
    else skipped.push(`${recipient.recipient_name} — ${outcome.detail}`)
  }

  if (sent.length > 0) {
    await logActivity(
      parsed.data.import_id,
      `Quote links sent on WhatsApp to ${sent.length} recipient${sent.length === 1 ? '' : 's'}`,
      sent.join(', '),
    )
  }

  revalidate(parsed.data.import_id)

  return {
    ok: sent.length > 0,
    notice: sent.length ? `Sent to ${sent.join(', ')}.` : undefined,
    error: skipped.length ? `Not sent — ${skipped.join('; ')}` : undefined,
  }
}
