import { notFound } from 'next/navigation'
import { createClient, canSendQuoteRequests, requireProfile } from '@/lib/supabase/server'
import { isOutboundConfigured, maskDestination, resolveDestination } from '@/lib/comms/outbound'
import { getSetting } from '@/lib/settings'
import { rankQuotes, summariseQuote, type QuoteCharge } from '@/lib/freight-quote'
import {
  type FreightChargeType,
  type FreightQuoteRecipient,
  type FreightQuoteRequestSummary,
} from '@/lib/types'
import { ComparisonPanel, type QuoteColumn } from './comparison-panel'
import { RecipientsPanel } from './recipients-panel'
import { RequestHeader } from './request-header'

export const dynamic = 'force-dynamic'

export default async function QuoteRequestPage({
  params,
}: {
  params: Promise<{ id: string; requestId: string }>
}) {
  const { id, requestId } = await params
  const profile = await requireProfile()
  const supabase = await createClient()

  const { data: requestRow } = await supabase
    .from('v_freight_quote_requests')
    .select('*')
    .eq('id', requestId)
    .maybeSingle()

  if (!requestRow) notFound()
  const request = requestRow as FreightQuoteRequestSummary

  const [recipientsResult, quotesResult, fxResult, chargeTypesResult, template, messagesResult] =
    await Promise.all([
      supabase
        .from('freight_quote_request_recipients')
        .select('*, chas(whatsapp_phone, phone)')
        .eq('quote_request_id', requestId)
        .order('created_at'),
      supabase
        .from('freight_quotes')
        .select('*, freight_quote_charges(*)')
        .eq('quote_request_id', requestId)
        .eq('is_current', true),
      supabase.from('freight_quote_fx_rates').select('*').eq('quote_request_id', requestId),
      supabase
        .from('freight_charge_types')
        .select('*')
        .eq('is_active', true)
        .contains('applies_to', [request.mode])
        .order('sort_order'),
      getSetting('freight_quote_message_template'),
      supabase
        .from('v_freight_quote_recipient_messages')
        .select('*')
        .eq('quote_request_id', requestId),
    ])

  const recipients = (recipientsResult.data ?? []) as FreightQuoteRecipient[]

  /*
   * Whether each recipient can actually be messaged, worked out on the server.
   * The browser never sees a phone number it does not need, and never has to
   * know how a destination is resolved.
   */
  const sendState = Object.fromEntries(
    (recipientsResult.data ?? []).map((row) => {
      const r = row as FreightQuoteRecipient & {
        chas?: { whatsapp_phone?: string | null; phone?: string | null } | null
      }
      const destination = resolveDestination({ phone: r.phone, cha: r.chas ?? null })
      const message = (messagesResult.data ?? []).find((m) => m.recipient_id === r.id)

      return [
        r.id,
        {
          // Masked: enough to confirm the right number, not enough to be a
          // contact list leaked into the page source.
          destinationMasked: maskDestination(destination),
          status: message?.status ?? null,
          sentAt: message?.sent_at ?? null,
          deliveredAt: message?.delivered_at ?? null,
          readAt: message?.read_at ?? null,
          failureReason: message?.failure_reason ?? null,
        },
      ]
    }),
  )
  const chargeTypes = (chargeTypesResult.data ?? []) as FreightChargeType[]

  const fxRates = Object.fromEntries(
    (fxResult.data ?? []).map((r) => [r.currency, Number(r.rate_to_comparison)]),
  )

  const labelFor = (code: string, custom: string | null) =>
    custom?.trim() || chargeTypes.find((t) => t.code === code)?.name || code

  // Summaries are computed here rather than in the browser: the arithmetic is
  // the point of the screen, and it is unit-tested in lib/freight-quote.
  const quoteRows = (quotesResult.data ?? []) as Array<Record<string, unknown>>

  const columns: QuoteColumn[] = quoteRows.map((quote) => {
    const charges = ((quote.freight_quote_charges ?? []) as Array<Record<string, string | null>>)
      .slice()
      .sort((a, b) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0))

    const mapped: QuoteCharge[] = charges.map((charge) => ({
      chargeType: charge.charge_type ?? 'misc',
      label: labelFor(charge.charge_type ?? 'misc', charge.custom_label),
      currency: charge.currency ?? (quote.currency as string),
      calculationMethod: (charge.calculation_method ?? 'FIXED') as QuoteCharge['calculationMethod'],
      chargeStatus: (charge.charge_status ?? 'QUOTED') as QuoteCharge['chargeStatus'],
      rate: charge.rate === null ? null : Number(charge.rate),
      quantity: charge.quantity === null ? null : Number(charge.quantity),
      totalAmount: charge.total_amount === null ? null : Number(charge.total_amount),
    }))

    const cargo = {
      grossWeightKg: quote.gross_weight_kg ? Number(quote.gross_weight_kg) : null,
      chargeableWeightKg: quote.chargeable_weight_kg
        ? Number(quote.chargeable_weight_kg)
        : null,
      cbm: quote.cbm ? Number(quote.cbm) : null,
      packageCount: quote.package_count ? Number(quote.package_count) : null,
      palletCount: quote.pallet_count ? Number(quote.pallet_count) : null,
    }

    const recipient = recipients.find((r) => r.id === quote.recipient_id)

    return {
      quoteId: quote.id as string,
      recipientId: quote.recipient_id as string,
      recipientName: recipient?.recipient_name ?? 'Unknown',
      versionNo: quote.version_no as number,
      submittedAt: quote.submitted_at as string,
      carrier: (quote.carrier as string) ?? null,
      routing: (quote.routing as string) ?? null,
      transitTime: (quote.transit_time as string) ?? null,
      validityDate: (quote.validity_date as string) ?? null,
      currency: quote.currency as string,
      remarks: (quote.remarks as string) ?? null,
      cargo,
      charges: mapped,
      summary: summariseQuote({
        charges: mapped,
        cargo,
        quoteCurrency: quote.currency as string,
        agentQuotedTotal: quote.agent_quoted_total ? Number(quote.agent_quoted_total) : null,
        fxRates,
        comparisonCurrency: request.comparison_currency,
      }),
    }
  })

  const ranked = rankQuotes(
    columns.map((c) => ({ recipientId: c.recipientId, summary: c.summary })),
  )

  const withRank = columns.map((column) => ({
    ...column,
    rank: ranked.find((r) => r.recipientId === column.recipientId)?.rank ?? null,
    hasMoreUnknowns:
      ranked.find((r) => r.recipientId === column.recipientId)?.hasMoreUnknowns ?? false,
  }))

  // Every currency any quote actually used, so a rate can be asked for.
  const currenciesInPlay = [
    ...new Set(columns.flatMap((c) => Object.keys(c.summary.totalsByCurrency))),
  ].filter((c) => c !== request.comparison_currency)

  return (
    <div className="space-y-4">
      <RequestHeader importId={id} request={request} />

      <RecipientsPanel
        importId={id}
        requestId={requestId}
        request={request}
        recipients={recipients}
        messageTemplate={String(template ?? '')}
        sendState={sendState}
        outboundConfigured={isOutboundConfigured()}
        canSend={canSendQuoteRequests(profile)}
      />

      <ComparisonPanel
        importId={id}
        requestId={requestId}
        comparisonCurrency={request.comparison_currency}
        selectedQuoteId={request.selected_quote_id}
        selectionReason={request.selection_reason}
        columns={withRank}
        chargeTypes={chargeTypes}
        fxRates={fxRates}
        currenciesInPlay={currenciesInPlay}
        recipients={recipients}
      />
    </div>
  )
}
