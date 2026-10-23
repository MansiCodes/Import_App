import { createClient } from '@/lib/supabase/server'
import { tokenState } from '@/lib/freight-token'
import { FREIGHT_MODE_LABELS, type FreightChargeType } from '@/lib/types'
import { QuoteForm, type ResolvedCargo } from './quote-form'
import { recordView } from './actions'

export const dynamic = 'force-dynamic'

/**
 * The public quote portal.
 *
 * Reached with a token and nothing else — no account, no sign-in. Everything
 * here is deliberately narrow: the agent sees the shipment facts they need in
 * order to quote, and their own form. They never see another agent, another
 * quote, a price, a document, or anything about the import beyond the cargo.
 *
 * The lookup runs server-side with the service-role key and is scoped by token
 * to exactly one recipient, so the page being public never makes the data
 * public.
 */

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-surface-sunken px-4 py-10">
      <div className="w-full max-w-md rounded-xl border border-border bg-surface-raised p-8 text-center shadow-sm">
        <h1 className="text-lg font-semibold">{title}</h1>
        <div className="mt-2 text-ink-muted">{children}</div>
      </div>
    </main>
  )
}

export default async function QuotePortalPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const supabase = await createClient()

  const { data: recipient } = await supabase
    .from('freight_quote_request_recipients')
    .select(
      'id, recipient_name, status, revoked_at, token_expires_at, submitted_at, latest_quote_id, quote_request_id',
    )
    .eq('token', token)
    .maybeSingle()

  // Same answer whether the token is wrong or the request never existed.
  if (!recipient) {
    return (
      <Shell title="This link is not valid">
        Please check you copied the whole link, or ask your contact to send it again.
      </Shell>
    )
  }

  const { data: request } = await supabase
    .from('freight_quote_requests')
    .select(
      'id, request_no, mode, status, shipment_id, origin, destination, incoterm, cargo_description, gross_weight_kg, net_weight_kg, chargeable_weight_kg, cbm, package_count, pallet_count, request_notes, response_deadline',
    )
    .eq('id', recipient.quote_request_id)
    .maybeSingle()

  // Cascade should make this impossible; treat it as an invalid link rather
  // than throwing a stack trace at an external agent.
  if (!request) {
    return (
      <Shell title="This link is not valid">
        Please check you copied the whole link, or ask your contact to send it again.
      </Shell>
    )
  }

  const state = tokenState({
    revoked_at: recipient.revoked_at,
    token_expires_at: recipient.token_expires_at,
    request_status: request.status,
  })

  if (!state.usable) {
    const messages: Record<string, string> = {
      revoked: 'This quotation link has been withdrawn. Please contact us if you think that is a mistake.',
      expired: 'This quotation link has expired. Ask us for a fresh one if you would still like to quote.',
      closed: 'This quotation request has closed. Thank you for your time.',
    }
    return <Shell title="This link is no longer open">{messages[state.reason]}</Shell>
  }

  if (recipient.status === 'Declined') {
    return (
      <Shell title="Thank you">
        You have told us you will not be quoting for this shipment. Nothing further is needed.
      </Shell>
    )
  }

  // Best effort, and never allowed to stop the page rendering.
  try {
    await recordView(token)
  } catch {
    // Ignored: a missed view timestamp is not worth a broken portal.
  }

  /*
   * The cargo figures, resolved once and never asked for again.
   *
   * The quoting company used to type its own chargeable weight into this form.
   * It no longer does, so the figure has to come from what we already hold.
   * Order matters and is a business decision, not a convenience:
   *
   *   1. The quote request. This is the figure we stated to this company when
   *      we asked them to quote, so it is what their price answers.
   *   2. The shipment behind the request, when one is linked.
   *
   * Gross weight is NOT a third fallback. It is a different measurement, and a
   * cost-per-kg computed against it would read as chargeable while being
   * something else. When neither source has a chargeable figure the portal says
   * so rather than inventing one.
   */
  const { data: shipment } = request.shipment_id
    ? await supabase
        .from('shipments')
        .select('gross_weight_kg, chargeable_weight_kg, cbm, packages')
        .eq('id', request.shipment_id)
        .maybeSingle()
    : { data: null }

  const numeric = (value: string | number | null | undefined): number | null => {
    if (value === null || value === undefined || value === '') return null
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }

  const requestChargeable = numeric(request.chargeable_weight_kg)
  const shipmentChargeable = numeric(shipment?.chargeable_weight_kg)

  const cargo: ResolvedCargo = {
    chargeableWeightKg: requestChargeable ?? shipmentChargeable,
    grossWeightKg: numeric(request.gross_weight_kg) ?? numeric(shipment?.gross_weight_kg),
    cbm: numeric(request.cbm) ?? numeric(shipment?.cbm),
    packageCount: numeric(request.package_count) ?? numeric(shipment?.packages),
    palletCount: numeric(request.pallet_count),
    weightSource:
      requestChargeable !== null ? 'request' : shipmentChargeable !== null ? 'shipment' : null,
  }

  const { data: chargeTypes } = await supabase
    .from('freight_charge_types')
    .select('id, code, name, applies_to, default_method, sort_order, is_active')
    .eq('is_active', true)
    .contains('applies_to', [request.mode])
    .order('sort_order')

  // Their previous submission, so a revision starts from what they last said
  // rather than from an empty form.
  const { data: existingQuote } = recipient.latest_quote_id
    ? await supabase
        .from('freight_quotes')
        .select('*, freight_quote_charges(*)')
        .eq('id', recipient.latest_quote_id)
        .maybeSingle()
    : { data: null }

  return (
    <QuoteForm
      token={token}
      recipientName={recipient.recipient_name}
      request={request}
      cargo={cargo}
      modeLabel={FREIGHT_MODE_LABELS[request.mode] ?? request.mode}
      chargeTypes={(chargeTypes ?? []) as FreightChargeType[]}
      existing={existingQuote}
      alreadySubmitted={['Submitted', 'Revised'].includes(recipient.status)}
    />
  )
}
