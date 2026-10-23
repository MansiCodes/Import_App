'use client'

import { useMemo, useState, useTransition } from 'react'
import type { CalculationMethod, ChargeStatus } from '@/lib/freight-quote'
import type { FreightChargeType } from '@/lib/types'
import {
  ChargeRow,
  currencyMark,
  lineAmount,
  lineIsMeaningful,
  toChargePayload,
  type ChargeLine,
} from './charge-row'
import { declineQuote, submitQuote } from './actions'

interface RequestFacts {
  request_no: string
  mode: string
  origin: string | null
  destination: string | null
  incoterm: string | null
  cargo_description: string | null
  gross_weight_kg: string | null
  net_weight_kg: string | null
  chargeable_weight_kg: string | null
  cbm: string | null
  package_count: number | null
  pallet_count: number | null
  request_notes: string | null
  response_deadline: string | null
}

/**
 * The cargo this quotation is priced against, resolved on the server.
 *
 * Nobody types these figures here any more. They come from the quote request,
 * and from the shipment behind it — see the resolution order in page.tsx. A
 * null chargeable weight stays null: gross weight is a different measurement
 * and presenting it as chargeable would be a guess dressed as an answer.
 */
export interface ResolvedCargo {
  chargeableWeightKg: number | null
  grossWeightKg: number | null
  cbm: number | null
  packageCount: number | null
  palletCount: number | null
  /** Where the chargeable figure came from, for the line under the summary. */
  weightSource: 'request' | 'shipment' | null
}

const num = (value: string | number | null | undefined): number | null => {
  const trimmed = value?.toString().trim()
  if (!trimmed) return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

const money = (value: number) =>
  value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const field =
  'w-full rounded-lg border border-border-strong bg-surface-raised px-3 py-2 outline-none focus:border-accent'

function Section({
  title,
  hint,
  children,
}: {
  title: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <section className="rounded-xl border border-border bg-surface-raised shadow-sm">
      <div className="border-b px-4 py-2.5">
        <h2 className="font-semibold">{title}</h2>
        {hint && <p className="text-ink-muted">{hint}</p>}
      </div>
      {children}
    </section>
  )
}

function Text({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  type?: string
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-ink-muted">{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={`${field} ${type === 'number' ? 'tnum' : ''}`}
        inputMode={type === 'number' ? 'decimal' : undefined}
      />
    </label>
  )
}

/** One of the three figures the quotation comes down to. */
function Stat({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface-sunken px-3 py-2.5">
      <p className="text-ink-muted">{label}</p>
      <p className="tnum mt-0.5 text-lg font-semibold">{value}</p>
      {unit && <p className="text-ink-faint">{unit}</p>}
    </div>
  )
}

export function QuoteForm({
  token,
  recipientName,
  request,
  cargo,
  modeLabel,
  chargeTypes,
  existing,
  alreadySubmitted,
}: {
  token: string
  recipientName: string
  request: RequestFacts
  cargo: ResolvedCargo
  modeLabel: string
  chargeTypes: FreightChargeType[]
  existing: Record<string, unknown> | null
  alreadySubmitted: boolean
}) {
  const isAir = request.mode === 'AIR'

  const existingCharges = (existing?.freight_quote_charges ?? []) as Array<
    Record<string, string | null>
  >

  /*
   * Rupees, unless we are reopening a quotation that was submitted in something
   * else. There is no currency control on this form; showing an older USD
   * figure with a rupee sign in front of it would be a lie, so the line carries
   * its own currency and simply displays it.
   */
  const quoteCurrency = (existing?.currency as string) ?? 'INR'

  /*
   * Every charge we know about, with whatever was said last time filled in.
   *
   * A revision used to show only the lines the previous submission carried, so
   * a charge left blank the first time could not be added the second — the only
   * way back was to re-add it by hand as a custom line. Seeding from the charge
   * types and overlaying the existing answers means a revision can correct an
   * omission as easily as it corrects a figure.
   */
  const [lines, setLines] = useState<ChargeLine[]>(() => {
    const labelOf = (code: string) => chargeTypes.find((t) => t.code === code)?.name ?? code

    const toLine = (
      key: string,
      chargeType: string,
      charge: Record<string, string | null> | undefined,
    ): ChargeLine => ({
      key,
      charge_type: chargeType,
      label: labelOf(chargeType),
      custom_label: charge?.custom_label ?? '',
      is_custom: Boolean(charge?.custom_label),
      currency: charge?.currency ?? (charge ? quoteCurrency : 'INR'),
      charge_status: (charge?.charge_status ?? 'QUOTED') as ChargeStatus,
      total_amount: charge?.total_amount ?? '',
      carried_rate: num(charge?.rate),
      carried_method: (charge?.calculation_method ?? 'FIXED') as CalculationMethod,
    })

    // Lines they named themselves are keyed by that name, not by charge type —
    // several of them can share `misc`.
    const named = existingCharges.filter((charge) => charge.custom_label)
    const byType = new Map(
      existingCharges.filter((charge) => !charge.custom_label).map((c) => [c.charge_type, c]),
    )

    const ours = chargeTypes.map((type, index) =>
      toLine(`seed-${index}`, type.code, byType.get(type.code)),
    )

    // A charge type that has since been retired, but which they priced before.
    const retired = [...byType.entries()]
      .filter(([code]) => !chargeTypes.some((t) => t.code === code))
      .map(([code, charge], index) => toLine(`retired-${index}`, code ?? 'misc', charge))

    const theirs = named.map((charge, index) =>
      toLine(`named-${index}`, charge.charge_type ?? 'misc', charge),
    )

    return [...ours, ...retired, ...theirs]
  })

  const [form, setForm] = useState({
    carrier: (existing?.carrier as string) ?? '',
    routing: (existing?.routing as string) ?? '',
    transit_time: (existing?.transit_time as string) ?? '',
    schedule_note: (existing?.schedule_note as string) ?? '',
    free_days: String((existing?.free_days as number) ?? ''),
    validity_date: (existing?.validity_date as string) ?? '',
    remarks: (existing?.remarks as string) ?? '',
  })

  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [declining, setDeclining] = useState(false)

  /** What has actually been typed in, per currency. Blank lines are not zero. */
  const totals = useMemo(() => {
    const byCurrency: Record<string, number> = {}
    for (const line of lines) {
      const amount = num(line.total_amount)
      if (amount === null) continue
      byCurrency[line.currency] = (byCurrency[line.currency] ?? 0) + amount
    }
    return byCurrency
  }, [lines])

  const currencies = Object.keys(totals)
  const singleTotal = currencies.length === 1 ? totals[currencies[0]] : null
  const totalCurrency = currencies.length === 1 ? currencies[0] : null

  // Air is priced per chargeable kilo, sea per cubic metre. Same shape, and the
  // labels below follow whichever this request actually is.
  const basis = isAir ? cargo.chargeableWeightKg : cargo.cbm
  const costPerUnit = singleTotal !== null && basis ? singleTotal / basis : null

  const update = (key: string, patch: Partial<ChargeLine>) =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)))

  function submit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)

    /*
     * Only lines that say something are sent.
     *
     * A blank line is not a charge of zero — it is a charge nobody has priced,
     * and the comparison would otherwise show it as free. A line carried over
     * from an earlier submission with a status like "at actual" is kept even
     * without an amount, so revising a quotation does not quietly turn an
     * unknown cost into nothing.
     */
    const payloadCharges = lines.filter(lineIsMeaningful).map(toChargePayload)

    if (!payloadCharges.some((c) => c.total_amount !== null || c.rate !== null)) {
      setError('Enter at least one amount before sending this quotation.')
      return
    }

    const unnamed = lines.find(
      (line) => line.is_custom && !line.custom_label.trim() && lineAmount(line) !== null,
    )
    if (unnamed) {
      setError('Give every extra charge a name.')
      return
    }

    startTransition(async () => {
      const result = await submitQuote(token, {
        currency: quoteCurrency,
        carrier: form.carrier.trim() || null,
        routing: form.routing.trim() || null,
        transit_time: form.transit_time.trim() || null,
        schedule_note: form.schedule_note.trim() || null,
        free_days: num(form.free_days),
        origin: request.origin,
        destination: request.destination,
        incoterm: request.incoterm,
        // Recorded as the basis this quotation was priced against, so the
        // comparison divides by the same figure the agent saw.
        gross_weight_kg: cargo.grossWeightKg,
        chargeable_weight_kg: cargo.chargeableWeightKg,
        cbm: cargo.cbm,
        package_count: cargo.packageCount,
        pallet_count: cargo.palletCount,
        agent_fx_rate: null,
        agent_quoted_total: null,
        validity_date: form.validity_date || null,
        remarks: form.remarks.trim() || null,
        charges: payloadCharges,
      })

      if (result.ok) setDone(true)
      else setError(result.error ?? 'Something went wrong')
    })
  }

  if (done) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-surface-sunken px-4">
        <div className="w-full max-w-sm rounded-xl border border-border bg-surface-raised p-8 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-done-soft text-done">
            ✓
          </div>
          <h1 className="text-lg font-semibold">Quotation received</h1>
          <p className="mt-2 text-ink-muted">
            Thank you. Your quotation for {request.request_no} is with us. You can reopen this link
            to revise it while the request is open.
          </p>
        </div>
      </main>
    )
  }

  const shipmentFacts = [
    ['Incoterm', request.incoterm],
    ['Cargo', request.cargo_description],
    ['Gross weight', cargo.grossWeightKg && `${cargo.grossWeightKg.toLocaleString('en-IN')} kg`],
    isAir
      ? [
          'Chargeable weight',
          cargo.chargeableWeightKg && `${cargo.chargeableWeightKg.toLocaleString('en-IN')} kg`,
        ]
      : ['CBM', cargo.cbm],
    ['Packages', cargo.packageCount],
    ['Pallets', cargo.palletCount],
  ].filter(([, value]) => value !== null && value !== undefined && value !== '')

  return (
    <main className="min-h-dvh bg-surface-sunken pb-28">
      <header className="border-b bg-surface-raised">
        <div className="mx-auto max-w-3xl px-4 py-5">
          <p className="text-xs font-semibold tracking-widest text-ink-faint uppercase">Notofire</p>
          <h1 className="mt-0.5 text-xl font-semibold tracking-tight">Freight quotation request</h1>
          <p className="mt-1 text-ink-muted">
            <span className="font-medium">{modeLabel}</span>
            {request.origin && ` · ${request.origin}`}
            {request.destination && ` → ${request.destination}`}
          </p>
          <p className="mt-1 text-ink-faint">
            {request.request_no} · for {recipientName}
            {request.response_deadline && ` · reply by ${request.response_deadline}`}
          </p>
        </div>
      </header>

      <div className="mx-auto max-w-3xl space-y-4 px-4 py-5">
        {alreadySubmitted && (
          <p className="rounded-lg bg-due-soft px-3 py-2 text-due">
            You have already sent a quotation. Submitting again records a new version — your earlier
            one is kept.
          </p>
        )}

        <Section title="Shipment" hint="What we are asking you to quote for.">
          {shipmentFacts.length > 0 ? (
            <dl className="px-4 py-2">
              {shipmentFacts.map(([label, value]) => (
                <div
                  key={String(label)}
                  className="flex justify-between gap-4 border-b py-1.5 last:border-0"
                >
                  <dt className="text-ink-muted">{label}</dt>
                  <dd className="text-right font-medium">{String(value)}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="px-4 py-3 text-ink-muted">
              Please quote on the details we sent you separately.
            </p>
          )}
          {request.request_notes && (
            <p className="border-t px-4 py-2 whitespace-pre-wrap text-ink-muted">
              {request.request_notes}
            </p>
          )}
        </Section>

        <form onSubmit={submit} className="space-y-4">
          <Section title="Routing" hint="Where it is going and how long it will take.">
            <div className="grid gap-3 px-4 py-3 sm:grid-cols-2">
              <Text
                label={isAir ? 'Airline (optional)' : 'Shipping line (optional)'}
                value={form.carrier}
                onChange={(v) => setForm({ ...form, carrier: v })}
                placeholder={isAir ? 'e.g. Emirates' : 'e.g. Maersk'}
              />
              <Text
                label="Routing"
                value={form.routing}
                onChange={(v) => setForm({ ...form, routing: v })}
                // Our own lane, as a suggestion. It is still their routing to
                // state — they may tranship somewhere we did not ask about.
                placeholder={
                  request.origin && request.destination
                    ? `${request.origin} – ${request.destination}`
                    : isAir
                      ? 'PVG – DEL'
                      : 'Ningbo – Nhava Sheva'
                }
              />
              <Text
                label="Transit time"
                value={form.transit_time}
                onChange={(v) => setForm({ ...form, transit_time: v })}
                placeholder="5–7 days"
              />
              <Text
                label="Quote valid until"
                type="date"
                value={form.validity_date}
                onChange={(v) => setForm({ ...form, validity_date: v })}
              />
            </div>

            <details className="border-t px-4 py-2">
              <summary className="cursor-pointer text-ink-faint">
                More routing detail (optional)
              </summary>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                <Text
                  label={isAir ? 'Flight frequency' : 'Sailing frequency'}
                  value={form.schedule_note}
                  onChange={(v) => setForm({ ...form, schedule_note: v })}
                />
                {!isAir && (
                  <Text
                    label="Free days"
                    type="number"
                    value={form.free_days}
                    onChange={(v) => setForm({ ...form, free_days: v })}
                  />
                )}
              </div>
            </details>
          </Section>

          <Section title="Cost breakdown" hint="Enter the charges for this shipment.">
            <div>
              {lines.map((line) => (
                <ChargeRow
                  key={line.key}
                  line={line}
                  onChange={(patch) => update(line.key, patch)}
                  onRemove={
                    line.is_custom
                      ? () => setLines((prev) => prev.filter((l) => l.key !== line.key))
                      : undefined
                  }
                />
              ))}
            </div>

            <div className="border-t px-4 py-2">
              <button
                type="button"
                onClick={() =>
                  setLines((prev) => [
                    ...prev,
                    {
                      key: `added-${Date.now()}`,
                      charge_type: 'misc',
                      label: 'Other charge',
                      custom_label: '',
                      is_custom: true,
                      currency: quoteCurrency,
                      charge_status: 'QUOTED',
                      total_amount: '',
                      carried_rate: null,
                      carried_method: 'FIXED',
                    },
                  ])
                }
                className="text-accent hover:underline"
              >
                + Add another charge
              </button>
            </div>
          </Section>

          <Section title="Summary" hint="Calculated from the charges above.">
            <div className="space-y-3 px-4 py-3">
              <div className="grid gap-3 sm:grid-cols-3">
                <Stat
                  label={isAir ? 'Total chargeable weight' : 'Total volume'}
                  value={basis === null ? '—' : basis.toLocaleString('en-IN')}
                  unit={isAir ? 'kg' : 'CBM'}
                />
                <Stat
                  label="Total charge"
                  value={
                    singleTotal !== null
                      ? `${currencyMark(totalCurrency as string)} ${money(singleTotal)}`
                      : currencies.length > 1
                        ? Object.entries(totals)
                            .map(([c, t]) => `${c} ${money(t)}`)
                            .join('  ·  ')
                        : '—'
                  }
                  unit={totalCurrency ?? undefined}
                />
                <Stat
                  label={isAir ? 'Cost per kg' : 'Cost per CBM'}
                  value={
                    costPerUnit !== null
                      ? `${currencyMark(totalCurrency as string)} ${money(costPerUnit)}`
                      : '—'
                  }
                  unit={totalCurrency ? `${totalCurrency} / ${isAir ? 'kg' : 'CBM'}` : undefined}
                />
              </div>

              {basis === null && (
                <p className="text-ink-faint">
                  We have not given you a {isAir ? 'chargeable weight' : 'CBM'} for this shipment, so{' '}
                  {isAir ? 'cost per kg' : 'cost per CBM'} cannot be worked out here. Send your
                  amounts anyway — we will add it at our end.
                </p>
              )}

              <label className="block">
                <span className="mb-1 block text-ink-muted">
                  Remarks and conditions (optional)
                </span>
                <textarea
                  rows={3}
                  value={form.remarks}
                  onChange={(e) => setForm({ ...form, remarks: e.target.value })}
                  placeholder="Add any notes, assumptions or conditions…"
                  className={field}
                />
              </label>
            </div>
          </Section>

          {error && <p className="rounded-lg bg-critical-soft px-3 py-2 text-critical">{error}</p>}

          {!declining ? (
            <button
              type="button"
              onClick={() => setDeclining(true)}
              className="text-ink-faint hover:underline"
            >
              We will not be quoting for this
            </button>
          ) : (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2">
              <span className="text-ink-muted">Let us know and we will stop chasing:</span>
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    const result = await declineQuote(token, null)
                    if (result.ok) window.location.reload()
                    else setError(result.error ?? 'Something went wrong')
                  })
                }
                className="rounded-lg border border-border-strong px-3 py-1.5 hover:bg-surface-sunken"
              >
                Confirm
              </button>
              <button
                type="button"
                onClick={() => setDeclining(false)}
                className="text-ink-muted hover:underline"
              >
                Cancel
              </button>
            </div>
          )}

          {/*
            Pinned so the action is always one tap away. On a long quotation
            opened from WhatsApp on a phone, a submit button at the very bottom
            is a scroll away from wherever the forwarder happens to be.
          */}
          <div className="fixed inset-x-0 bottom-0 border-t bg-surface-raised/95 backdrop-blur">
            <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
              <span className="tnum text-ink-muted">
                {singleTotal !== null
                  ? `${currencyMark(totalCurrency as string)} ${money(singleTotal)}`
                  : Object.entries(totals)
                      .map(([c, t]) => `${c} ${money(t)}`)
                      .join(' · ') || 'No charges yet'}
              </span>
              <button
                type="submit"
                disabled={pending}
                className="rounded-lg bg-accent px-5 py-2.5 font-medium text-white hover:bg-accent-hover disabled:opacity-50"
              >
                {pending ? 'Sending…' : alreadySubmitted ? 'Submit revision' : 'Save quotation'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </main>
  )
}
