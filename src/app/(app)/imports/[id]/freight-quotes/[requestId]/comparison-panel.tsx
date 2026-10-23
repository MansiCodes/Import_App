'use client'

import { useActionState, useState } from 'react'
import Link from 'next/link'
import { Badge, Button, Card, CardHeader, CardTitle, Input } from '@/components/ui'
import { STATUS_LABELS, computeLineTotal, type QuoteCharge, type QuoteSummary } from '@/lib/freight-quote'
import type { FreightChargeType, FreightQuoteRecipient } from '@/lib/types'
import { formatDate } from '@/lib/utils'
import { RecipientChip } from '../freight-ui'
import { copyQuoteToCosts, selectQuote, setComparisonRate, type ActionResult } from '../actions'

export interface QuoteColumn {
  quoteId: string
  recipientId: string
  recipientName: string
  versionNo: number
  submittedAt: string
  carrier: string | null
  routing: string | null
  transitTime: string | null
  validityDate: string | null
  currency: string
  remarks: string | null
  cargo: {
    grossWeightKg: number | null
    chargeableWeightKg: number | null
    cbm: number | null
    packageCount: number | null
    palletCount: number | null
  }
  charges: QuoteCharge[]
  summary: QuoteSummary
  rank?: number | null
  hasMoreUnknowns?: boolean
}

const money = (value: number | null, currency: string) =>
  value === null
    ? '—'
    : `${currency} ${value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

function FxRates({
  importId,
  requestId,
  currencies,
  rates,
  comparisonCurrency,
}: {
  importId: string
  requestId: string
  currencies: string[]
  rates: Record<string, number>
  comparisonCurrency: string
}) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    setComparisonRate,
    null,
  )

  if (currencies.length === 0) return null

  const missing = currencies.filter((c) => !(rates[c] > 0))

  return (
    <div className="flex flex-wrap items-end gap-x-4 gap-y-2 border-b bg-surface-sunken px-4 py-2.5">
      <span className="text-ink-muted">Compare at</span>

      {currencies.map((currency) => (
        <form key={currency} action={formAction} className="flex items-end gap-1.5">
          <input type="hidden" name="quote_request_id" value={requestId} />
          <input type="hidden" name="import_id" value={importId} />
          <input type="hidden" name="currency" value={currency} />
          <span className="pb-2 text-ink-muted">1 {currency} =</span>
          <Input
            name="rate"
            type="number"
            step="0.000001"
            min="0"
            defaultValue={rates[currency] ?? ''}
            className="w-24 tnum"
            aria-label={`${currency} to ${comparisonCurrency}`}
          />
          <span className="pb-2 text-ink-muted">{comparisonCurrency}</span>
          <Button type="submit" disabled={pending}>
            Set
          </Button>
        </form>
      ))}

      {missing.length > 0 && (
        <span className="text-due">
          {missing.join(', ')} has no rate — those quotes cannot be compared yet.
        </span>
      )}
      {state?.error && <span className="text-critical">{state.error}</span>}
    </div>
  )
}

function SelectForm({
  importId,
  requestId,
  column,
  onDone,
}: {
  importId: string
  requestId: string
  column: QuoteColumn
  onDone: () => void
}) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    async (prev, formData) => {
      const result = await selectQuote(prev, formData)
      if (result.ok) onDone()
      return result
    },
    null,
  )
  const [confirmed, setConfirmed] = useState(false)

  return (
    <form action={formAction} className="space-y-3 border-t bg-surface-sunken p-4">
      <input type="hidden" name="quote_request_id" value={requestId} />
      <input type="hidden" name="import_id" value={importId} />
      <input type="hidden" name="quote_id" value={column.quoteId} />

      <p className="font-medium">Award to {column.recipientName}</p>

      {column.summary.unpriced.length > 0 && (
        <p className="rounded-lg bg-due-soft px-3 py-2 text-due">
          {column.summary.unpriced.length} charge
          {column.summary.unpriced.length === 1 ? ' is' : 's are'} not priced:{' '}
          {column.summary.unpriced.map((u) => u.label).join(', ')}. Those will still be billed.
        </p>
      )}

      <Input name="reason" placeholder="Why this one? (optional)" className="max-w-md" />

      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          name="confirm"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
          className="mt-0.5 size-4"
        />
        <span>I am awarding this shipment to {column.recipientName}.</span>
      </label>

      {state?.error && <p className="text-critical">{state.error}</p>}

      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={pending || !confirmed}>
          {pending ? 'Selecting…' : 'Confirm'}
        </Button>
        <Button type="button" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

function CopyCostForm({
  importId,
  requestId,
  column,
  onDone,
}: {
  importId: string
  requestId: string
  column: QuoteColumn
  onDone: () => void
}) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    async (prev, formData) => {
      const result = await copyQuoteToCosts(prev, formData)
      if (result.ok) onDone()
      return result
    },
    null,
  )
  const [confirmed, setConfirmed] = useState(false)

  const ownTotal = column.summary.totalsByCurrency[column.currency] ?? null

  return (
    <form action={formAction} className="space-y-3 border-t bg-surface-sunken p-4">
      <input type="hidden" name="quote_request_id" value={requestId} />
      <input type="hidden" name="import_id" value={importId} />
      <input type="hidden" name="vendor" value={column.recipientName} />
      <input type="hidden" name="currency" value={column.currency} />

      <p className="font-medium">Record as an estimated freight cost</p>
      <p className="text-ink-muted">
        Goes into landed cost as an <strong>estimate</strong> — a quote is a price offered, not an
        invoice received. Replace it when the freight bill arrives.
      </p>

      <div className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="mb-1 block text-ink-muted">Amount ({column.currency})</span>
          <Input
            name="amount"
            type="number"
            step="0.01"
            min="0"
            defaultValue={ownTotal ?? ''}
            className="w-40 tnum"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-ink-muted">FX rate (optional)</span>
          <Input name="fx_rate" type="number" step="0.000001" min="0" className="w-32 tnum" />
        </label>
      </div>

      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          name="confirm"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
          className="mt-0.5 size-4"
        />
        <span>Record this against the import&apos;s costs.</span>
      </label>

      {state?.error && <p className="text-critical">{state.error}</p>}

      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={pending || !confirmed}>
          {pending ? 'Recording…' : 'Record cost'}
        </Button>
        <Button type="button" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

/** Everything one agent said, for when the comparison row is not enough. */
function FullQuote({ column, comparisonCurrency }: { column: QuoteColumn; comparisonCurrency: string }) {
  return (
    <div className="border-t bg-surface-sunken px-4 py-3">
      <p className="mb-2 font-medium">{column.recipientName} — full quotation</p>

      <dl className="mb-3 grid gap-x-6 gap-y-0.5 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ['Carrier', column.carrier],
          ['Routing', column.routing],
          ['Transit', column.transitTime],
          ['Valid until', column.validityDate && formatDate(column.validityDate)],
          ['Gross weight', column.cargo.grossWeightKg && `${column.cargo.grossWeightKg} kg`],
          [
            'Chargeable',
            column.cargo.chargeableWeightKg && `${column.cargo.chargeableWeightKg} kg`,
          ],
          ['CBM', column.cargo.cbm],
          ['Packages', column.cargo.packageCount],
        ]
          .filter(([, value]) => value !== null && value !== undefined && value !== '')
          .map(([label, value]) => (
            <div key={String(label)} className="flex justify-between gap-3">
              <dt className="text-ink-muted">{label}</dt>
              <dd>{String(value)}</dd>
            </div>
          ))}
      </dl>

      <ul className="divide-y border-y">
        {column.charges.map((charge, index) => {
          const total = computeLineTotal(charge, column.cargo)
          return (
            <li key={index} className="flex items-center justify-between gap-4 py-1.5">
              <span>{charge.label}</span>
              <span className={charge.chargeStatus === 'QUOTED' ? 'tnum' : 'text-due'}>
                {charge.chargeStatus === 'QUOTED'
                  ? money(total, charge.currency)
                  : STATUS_LABELS[charge.chargeStatus]}
              </span>
            </li>
          )
        })}
      </ul>

      <div className="mt-2 flex justify-between font-medium">
        <span>Known comparable total</span>
        <span className="tnum">{money(column.summary.comparableTotal, comparisonCurrency)}</span>
      </div>

      {column.remarks && <p className="mt-2 text-ink-muted">{column.remarks}</p>}
    </div>
  )
}

export function ComparisonPanel({
  importId,
  requestId,
  comparisonCurrency,
  selectedQuoteId,
  selectionReason,
  columns,
  chargeTypes,
  fxRates,
  currenciesInPlay,
  recipients,
}: {
  importId: string
  requestId: string
  comparisonCurrency: string
  selectedQuoteId: string | null
  selectionReason: string | null
  columns: QuoteColumn[]
  chargeTypes: FreightChargeType[]
  fxRates: Record<string, number>
  currenciesInPlay: string[]
  recipients: FreightQuoteRecipient[]
}) {
  const [selecting, setSelecting] = useState<string | null>(null)
  const [copying, setCopying] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)

  const live = recipients.filter((r) => r.status !== 'Revoked')

  /*
   * The empty state used to be a full-height panel reserving hundreds of pixels
   * for a table that did not exist yet. It is now a few lines that answer the
   * only question worth asking before quotes arrive: who have we not heard from?
   */
  if (columns.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Comparison</CardTitle>
          <span className="text-ink-muted tnum">0 of {live.length} received</span>
        </CardHeader>

        <div className="px-4 py-3">
          <ul className="mb-2 divide-y">
            {live.map((recipient) => (
              <li key={recipient.id} className="flex items-center justify-between py-1.5">
                <span>{recipient.recipient_name}</span>
                <RecipientChip status={recipient.status} />
              </li>
            ))}
          </ul>
          <p className="text-ink-faint">Comparison appears here as quotations arrive.</p>
        </div>
      </Card>
    )
  }

  const chargeCodes = [
    ...new Set([
      ...chargeTypes.map((t) => t.code),
      ...columns.flatMap((c) => c.charges.map((ch) => ch.chargeType)),
    ]),
  ]

  const labelFor = (code: string) =>
    chargeTypes.find((t) => t.code === code)?.name ??
    columns.flatMap((c) => c.charges).find((ch) => ch.chargeType === code)?.label ??
    code

  const selectedColumn = columns.find((c) => c.quoteId === selectedQuoteId)

  /** One charge row's cell for a given quote, shared by table and card layouts. */
  function chargeCell(column: QuoteColumn, code: string) {
    const charge = column.charges.find((ch) => ch.chargeType === code)
    if (!charge) return <span className="text-ink-faint">not quoted</span>

    if (charge.chargeStatus !== 'QUOTED') {
      const muted = ['INCLUDED', 'NOT_APPLICABLE'].includes(charge.chargeStatus)
      return (
        <span className={muted ? 'text-ink-muted' : 'font-medium text-due'}>
          {STATUS_LABELS[charge.chargeStatus]}
        </span>
      )
    }

    return <span className="tnum">{money(computeLineTotal(charge, column.cargo), charge.currency)}</span>
  }

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Quote comparison</CardTitle>
          <p className="text-ink-muted tnum">
            {columns.length} of {live.length} received · compared in {comparisonCurrency}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {selectedColumn && <Badge tone="done">Selected: {selectedColumn.recipientName}</Badge>}
          <Link href={`/imports/${importId}/product-costing?view=compare`}>
            <Button type="button">Compare to actuals</Button>
          </Link>
        </div>
      </CardHeader>

      <FxRates
        importId={importId}
        requestId={requestId}
        currencies={currenciesInPlay}
        rates={fxRates}
        comparisonCurrency={comparisonCurrency}
      />

      {/* Desktop: one column per quote. */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full border-collapse">
          <thead className="border-b">
            <tr>
              <th className="w-44 px-3 py-2 text-left font-medium text-ink-muted">Charge</th>
              {columns.map((column) => (
                <th key={column.quoteId} className="min-w-40 border-l px-3 py-2 text-left">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-semibold">{column.recipientName}</span>
                    {column.versionNo > 1 && <Badge tone="due">v{column.versionNo}</Badge>}
                  </div>
                  <div className="font-normal text-ink-faint">
                    {formatDate(column.submittedAt)}
                  </div>
                </th>
              ))}
            </tr>
          </thead>

          <tbody className="divide-y">
            {chargeCodes.map((code) => (
              <tr key={code}>
                <td className="px-3 py-1.5 text-ink-muted">{labelFor(code)}</td>
                {columns.map((column) => (
                  <td key={column.quoteId} className="border-l px-3 py-1.5">
                    {chargeCell(column, code)}
                  </td>
                ))}
              </tr>
            ))}

            <tr className="border-t-2">
              <td className="px-3 py-2 font-medium">Known total</td>
              {columns.map((column) => (
                <td key={column.quoteId} className="border-l px-3 py-2">
                  {column.summary.comparableTotal === null ? (
                    <span className="text-due">
                      No rate for {column.summary.missingRatesFor.join(', ')}
                    </span>
                  ) : (
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="tnum font-semibold">
                        {money(column.summary.comparableTotal, comparisonCurrency)}
                      </span>
                      {column.rank === 1 && <Badge tone="done">Lowest known</Badge>}
                    </span>
                  )}
                </td>
              ))}
            </tr>

            <tr>
              <td className="px-3 py-1.5 text-ink-muted">Unpriced</td>
              {columns.map((column) => (
                <td key={column.quoteId} className="border-l px-3 py-1.5">
                  {column.summary.unpriced.length === 0 ? (
                    <span className="text-done">None</span>
                  ) : (
                    <span className="text-due">
                      {column.summary.unpriced.length} item
                      {column.summary.unpriced.length === 1 ? '' : 's'}
                      {column.hasMoreUnknowns && ' — most here'}
                    </span>
                  )}
                </td>
              ))}
            </tr>

            <tr>
              <td className="px-3 py-1.5 text-ink-muted">Transit</td>
              {columns.map((column) => (
                <td key={column.quoteId} className="border-l px-3 py-1.5">
                  {column.transitTime ?? '—'}
                </td>
              ))}
            </tr>

            <tr>
              <td className="px-3 py-1.5 text-ink-muted">Validity</td>
              {columns.map((column) => (
                <td key={column.quoteId} className="border-l px-3 py-1.5">
                  {column.validityDate ? formatDate(column.validityDate) : '—'}
                </td>
              ))}
            </tr>

            <tr>
              <td className="px-3 py-2" />
              {columns.map((column) => (
                <td key={column.quoteId} className="border-l px-3 py-2">
                  <div className="flex flex-wrap gap-1.5">
                    <Button
                      variant="ghost"
                      onClick={() => setExpanded(expanded === column.quoteId ? null : column.quoteId)}
                    >
                      {expanded === column.quoteId ? 'Hide' : 'View full'}
                    </Button>
                    {column.quoteId === selectedQuoteId ? (
                      <Button onClick={() => setCopying(column.quoteId)}>Record cost</Button>
                    ) : (
                      <Button onClick={() => setSelecting(column.quoteId)}>Select</Button>
                    )}
                  </div>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      {/* Mobile: one card per quote, because five columns cannot fit 360px. */}
      <ul className="divide-y md:hidden">
        {columns.map((column) => (
          <li key={column.quoteId} className="px-4 py-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold">{column.recipientName}</span>
              {column.rank === 1 && <Badge tone="done">Lowest known</Badge>}
            </div>

            <div className="mb-2 flex items-baseline justify-between">
              <span className="text-ink-muted">Known total</span>
              <span className="tnum text-lg font-semibold">
                {column.summary.comparableTotal === null
                  ? '—'
                  : money(column.summary.comparableTotal, comparisonCurrency)}
              </span>
            </div>

            <p className="text-ink-muted">
              {column.summary.unpriced.length === 0
                ? 'Nothing unpriced'
                : `${column.summary.unpriced.length} unpriced`}
              {column.transitTime && ` · ${column.transitTime}`}
            </p>

            <div className="mt-2 flex flex-wrap gap-1.5">
              <Button
                variant="ghost"
                onClick={() => setExpanded(expanded === column.quoteId ? null : column.quoteId)}
              >
                {expanded === column.quoteId ? 'Hide' : 'View full'}
              </Button>
              {column.quoteId === selectedQuoteId ? (
                <Button onClick={() => setCopying(column.quoteId)}>Record cost</Button>
              ) : (
                <Button onClick={() => setSelecting(column.quoteId)}>Select</Button>
              )}
            </div>
          </li>
        ))}
      </ul>

      {expanded && (
        <FullQuote
          column={columns.find((c) => c.quoteId === expanded)!}
          comparisonCurrency={comparisonCurrency}
        />
      )}

      <p className="border-t px-4 py-2 text-ink-faint">
        &ldquo;Lowest known&rdquo; means cheapest of the priced charges only. Charges marked at
        actual are deliberately not counted, so it is not a recommendation.
      </p>

      {selectionReason && (
        <p className="border-t px-4 py-2 text-ink-muted">Reason: {selectionReason}</p>
      )}

      {selecting && (
        <SelectForm
          importId={importId}
          requestId={requestId}
          column={columns.find((c) => c.quoteId === selecting)!}
          onDone={() => setSelecting(null)}
        />
      )}

      {copying && (
        <CopyCostForm
          importId={importId}
          requestId={requestId}
          column={columns.find((c) => c.quoteId === copying)!}
          onDone={() => setCopying(null)}
        />
      )}
    </Card>
  )
}
