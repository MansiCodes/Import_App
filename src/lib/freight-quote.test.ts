import { describe, expect, it } from 'vitest'
import {
  computeLineTotal,
  quantityForMethod,
  rankQuotes,
  summariseQuote,
  type QuoteCharge,
} from './freight-quote'

const CARGO = {
  grossWeightKg: 300,
  chargeableWeightKg: 420,
  cbm: 2.5,
  packageCount: 12,
  palletCount: 3,
}

function charge(overrides: Partial<QuoteCharge> = {}): QuoteCharge {
  return {
    chargeType: 'air_freight',
    label: 'Air Freight',
    currency: 'USD',
    calculationMethod: 'FIXED',
    chargeStatus: 'QUOTED',
    ...overrides,
  }
}

describe('quantityForMethod', () => {
  it('picks the right cargo basis for each method', () => {
    expect(quantityForMethod('PER_KG', CARGO)).toBe(300)
    expect(quantityForMethod('PER_CHARGEABLE_KG', CARGO)).toBe(420)
    expect(quantityForMethod('PER_CBM', CARGO)).toBe(2.5)
    expect(quantityForMethod('PER_PACKAGE', CARGO)).toBe(12)
    expect(quantityForMethod('PER_PALLET', CARGO)).toBe(3)
    expect(quantityForMethod('FIXED', CARGO)).toBe(1)
    expect(quantityForMethod('NONE', CARGO)).toBeNull()
  })

  it('falls back to gross weight when no chargeable weight is given', () => {
    // Air quotes are priced on chargeable weight, but small consignments are
    // often quoted on gross because the two are the same.
    expect(quantityForMethod('PER_CHARGEABLE_KG', { grossWeightKg: 80 })).toBe(80)
  })

  it('returns null rather than guessing a missing basis', () => {
    expect(quantityForMethod('PER_CBM', { grossWeightKg: 300 })).toBeNull()
    expect(quantityForMethod('PER_PALLET', {})).toBeNull()
  })
})

describe('computeLineTotal', () => {
  it('multiplies rate by the cargo basis', () => {
    const line = charge({ calculationMethod: 'PER_CHARGEABLE_KG', rate: 3.2 })
    expect(computeLineTotal(line, CARGO)).toBe(1344) // 3.2 x 420
  })

  it('prefers an explicitly entered total over rate x quantity', () => {
    // The agent's own sheet is the truth for their own numbers, rounding included.
    const line = charge({ calculationMethod: 'PER_CHARGEABLE_KG', rate: 3.2, totalAmount: 1340 })
    expect(computeLineTotal(line, CARGO)).toBe(1340)
  })

  it('honours a quantity the agent typed over the one we inferred', () => {
    const line = charge({ calculationMethod: 'PER_KG', rate: 2, quantity: 500 })
    expect(computeLineTotal(line, CARGO)).toBe(1000)
  })

  it('returns null for every unpriced status', () => {
    for (const status of ['AT_ACTUAL', 'AS_PER_RECEIPT', 'INCLUDED', 'NOT_APPLICABLE', 'EXCLUDED'] as const) {
      expect(computeLineTotal(charge({ chargeStatus: status, rate: 999 }), CARGO)).toBeNull()
    }
  })

  it('returns null when quoted but no number was given', () => {
    expect(computeLineTotal(charge({ calculationMethod: 'PER_CBM' }), CARGO)).toBeNull()
  })
})

describe('summariseQuote', () => {
  const base = {
    cargo: CARGO,
    quoteCurrency: 'USD',
    comparisonCurrency: 'INR',
    fxRates: { USD: 88 },
  }

  it('totals priced lines and converts at the confirmed rate', () => {
    const summary = summariseQuote({
      ...base,
      charges: [
        charge({ calculationMethod: 'PER_CHARGEABLE_KG', rate: 3, label: 'Air Freight' }), // 1260
        charge({ chargeType: 'customs_clearance', label: 'Customs', totalAmount: 100 }),
      ],
    })

    expect(summary.totalsByCurrency).toEqual({ USD: 1360 })
    expect(summary.comparableTotal).toBe(119_680) // 1360 x 88
    expect(summary.unpriced).toHaveLength(0)
  })

  it('NEVER counts an at-actual charge as zero', () => {
    const summary = summariseQuote({
      ...base,
      charges: [
        charge({ totalAmount: 1000, label: 'Air Freight' }),
        charge({ chargeType: 'aai', label: 'AAI', chargeStatus: 'AT_ACTUAL', calculationMethod: 'NONE' }),
      ],
    })

    expect(summary.comparableTotal).toBe(88_000)
    // The AAI charge is money that will still arrive — it is reported, not summed.
    expect(summary.unpriced).toEqual([{ label: 'AAI', status: 'AT_ACTUAL' }])
  })

  it('separates charges that genuinely cost nothing from unknowns', () => {
    const summary = summariseQuote({
      ...base,
      charges: [
        charge({ totalAmount: 500 }),
        charge({ chargeType: 'labour', label: 'Labour', chargeStatus: 'INCLUDED', calculationMethod: 'NONE' }),
        charge({ chargeType: 'xray', label: 'X-Ray', chargeStatus: 'NOT_APPLICABLE', calculationMethod: 'NONE' }),
        charge({ chargeType: 'aai', label: 'AAI', chargeStatus: 'AT_ACTUAL', calculationMethod: 'NONE' }),
      ],
    })

    expect(summary.noCost.map((n) => n.label)).toEqual(['Labour', 'X-Ray'])
    expect(summary.unpriced.map((n) => n.label)).toEqual(['AAI'])
  })

  it('treats a quoted line with no number as an unknown, not as free', () => {
    const summary = summariseQuote({
      ...base,
      charges: [charge({ totalAmount: 200 }), charge({ chargeType: 'misc', label: 'Misc' })],
    })

    expect(summary.comparableTotal).toBe(17_600)
    expect(summary.unpriced.map((u) => u.label)).toEqual(['Misc'])
  })

  it('refuses to compare when a currency has no confirmed rate', () => {
    // Silently treating EUR as 1:1 with INR would rank this quote absurdly cheap.
    const summary = summariseQuote({
      ...base,
      charges: [
        charge({ totalAmount: 1000, currency: 'USD' }),
        charge({ chargeType: 'origin_exw', label: 'EXW', currency: 'EUR', totalAmount: 200 }),
      ],
    })

    expect(summary.comparableTotal).toBeNull()
    expect(summary.missingRatesFor).toEqual(['EUR'])
    expect(summary.totalsByCurrency).toEqual({ USD: 1000, EUR: 200 })
  })

  it('needs no rate for a quote already in the comparison currency', () => {
    const summary = summariseQuote({
      cargo: CARGO,
      quoteCurrency: 'INR',
      comparisonCurrency: 'INR',
      fxRates: {},
      charges: [charge({ currency: 'INR', totalAmount: 45_000 })],
    })

    expect(summary.comparableTotal).toBe(45_000)
    expect(summary.missingRatesFor).toEqual([])
  })

  it('reports a discrepancy between the agent total and their own lines', () => {
    const summary = summariseQuote({
      ...base,
      agentQuotedTotal: 1500,
      charges: [charge({ totalAmount: 1000 }), charge({ chargeType: 'misc', label: 'Misc', totalAmount: 400 })],
    })

    expect(summary.calculatedTotal).toBe(1400)
    expect(summary.agentQuotedTotal).toBe(1500)
    expect(summary.discrepancy).toBe(100)
  })

  it('reports no discrepancy when the two agree', () => {
    const summary = summariseQuote({
      ...base,
      agentQuotedTotal: 1400,
      charges: [charge({ totalAmount: 1400 })],
    })

    expect(summary.discrepancy).toBeNull()
  })

  it('works out effective cost per chargeable kg and per CBM', () => {
    const summary = summariseQuote({
      ...base,
      charges: [charge({ totalAmount: 1000 })],
    })

    expect(summary.comparableTotal).toBe(88_000)
    expect(summary.costPerChargeableKg).toBe(209.52) // 88000 / 420
    expect(summary.costPerCbm).toBe(35_200) // 88000 / 2.5
  })

  it('does not divide by a missing weight', () => {
    const summary = summariseQuote({
      ...base,
      cargo: { cbm: 2 },
      charges: [charge({ totalAmount: 100 })],
    })

    expect(summary.costPerChargeableKg).toBeNull()
    expect(summary.costPerCbm).toBe(4400)
  })

  it('sums in minor units so a total matches its own lines', () => {
    // Three lines that each round badly on their own.
    const summary = summariseQuote({
      ...base,
      fxRates: { USD: 1 },
      charges: [
        charge({ totalAmount: 33.33 }),
        charge({ chargeType: 'a', label: 'A', totalAmount: 33.33 }),
        charge({ chargeType: 'b', label: 'B', totalAmount: 33.34 }),
      ],
    })

    expect(summary.comparableTotal).toBe(100)
  })
})

describe('rankQuotes', () => {
  const summaryFor = (total: number | null, unknowns = 0) =>
    summariseQuote({
      cargo: CARGO,
      quoteCurrency: 'INR',
      comparisonCurrency: 'INR',
      fxRates: {},
      charges: [
        ...(total === null ? [] : [charge({ currency: 'INR', totalAmount: total })]),
        ...Array.from({ length: unknowns }, (_, i) =>
          charge({ chargeType: `u${i}`, label: `Unknown ${i}`, chargeStatus: 'AT_ACTUAL', calculationMethod: 'NONE' }),
        ),
      ],
    })

  it('ranks by comparable total, cheapest first', () => {
    const ranked = rankQuotes([
      { recipientId: 'dv', summary: summaryFor(282_408) },
      { recipientId: 'traqo', summary: summaryFor(260_107) },
      { recipientId: 'btc', summary: summaryFor(291_000) },
    ])

    expect(ranked.find((r) => r.recipientId === 'traqo')?.rank).toBe(1)
    expect(ranked.find((r) => r.recipientId === 'dv')?.rank).toBe(2)
    expect(ranked.find((r) => r.recipientId === 'btc')?.rank).toBe(3)
  })

  it('flags a cheap quote that hides more unknowns than its rivals', () => {
    // The point of the flag: cheapest-of-the-known is not cheapest.
    const ranked = rankQuotes([
      { recipientId: 'cheap', summary: summaryFor(200_000, 3) },
      { recipientId: 'complete', summary: summaryFor(250_000, 0) },
    ])

    const cheap = ranked.find((r) => r.recipientId === 'cheap')
    expect(cheap?.rank).toBe(1)
    expect(cheap?.hasMoreUnknowns).toBe(true)
    expect(ranked.find((r) => r.recipientId === 'complete')?.hasMoreUnknowns).toBe(false)
  })

  it('leaves an uncomparable quote unranked rather than last', () => {
    const uncomparable = summariseQuote({
      cargo: CARGO,
      quoteCurrency: 'USD',
      comparisonCurrency: 'INR',
      fxRates: {},
      charges: [charge({ currency: 'USD', totalAmount: 1000 })],
    })

    const ranked = rankQuotes([
      { recipientId: 'priced', summary: summaryFor(100_000) },
      { recipientId: 'norate', summary: uncomparable },
    ])

    expect(ranked.find((r) => r.recipientId === 'priced')?.rank).toBe(1)
    expect(ranked.find((r) => r.recipientId === 'norate')?.rank).toBeNull()
  })
})
