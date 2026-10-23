/**
 * Freight quote arithmetic and normalisation.
 *
 * The whole point of this module is to make quotes comparable WITHOUT pretending
 * to know things it does not. Two rules drive every function here:
 *
 *   AN UNPRICED CHARGE IS NEVER ZERO. "At actual", "as per receipt" and
 *   "excluded" mean the number is not yet known. Adding them in as nothing is
 *   how the quote with the most hidden charges wins a comparison.
 *
 *   A MISSING EXCHANGE RATE IS NOT 1:1. A quote in a currency nobody has given
 *   a rate for is reported as not comparable, rather than silently ranked
 *   against rupees.
 *
 * All money is summed in minor units and converted back once, so a comparison
 * total cannot drift from the lines it came from.
 */

export const CALCULATION_METHODS = [
  'FIXED',
  'PER_KG',
  'PER_CHARGEABLE_KG',
  'PER_PACKAGE',
  'PER_PALLET',
  'PER_CBM',
  'NONE',
] as const

export type CalculationMethod = (typeof CALCULATION_METHODS)[number]

export const CHARGE_STATUSES = [
  'QUOTED',
  'AT_ACTUAL',
  'AS_PER_RECEIPT',
  'INCLUDED',
  'NOT_APPLICABLE',
  'EXCLUDED',
] as const

export type ChargeStatus = (typeof CHARGE_STATUSES)[number]

export const METHOD_LABELS: Record<CalculationMethod, string> = {
  FIXED: 'Fixed amount',
  PER_KG: 'Per kg (gross)',
  PER_CHARGEABLE_KG: 'Per chargeable kg',
  PER_PACKAGE: 'Per package',
  PER_PALLET: 'Per pallet',
  PER_CBM: 'Per CBM',
  NONE: 'No amount',
}

export const STATUS_LABELS: Record<ChargeStatus, string> = {
  QUOTED: 'Quoted',
  AT_ACTUAL: 'At actual',
  AS_PER_RECEIPT: 'As per receipt',
  INCLUDED: 'Included',
  NOT_APPLICABLE: 'Not applicable',
  EXCLUDED: 'Excluded',
}

/**
 * Statuses that carry a real, comparable number.
 *
 * INCLUDED and NOT_APPLICABLE genuinely cost nothing extra, so they do not make
 * a quote incomparable — but they are still not "quoted", and are reported
 * separately so a reader can see what was folded in.
 */
export const PRICED_STATUSES: readonly ChargeStatus[] = ['QUOTED']

/** Statuses that mean real money may still arrive later. */
export const OPEN_ENDED_STATUSES: readonly ChargeStatus[] = [
  'AT_ACTUAL',
  'AS_PER_RECEIPT',
  'EXCLUDED',
]

export interface CargoBasis {
  grossWeightKg?: number | null
  chargeableWeightKg?: number | null
  cbm?: number | null
  packageCount?: number | null
  palletCount?: number | null
}

export interface QuoteCharge {
  chargeType: string
  label: string
  currency: string
  calculationMethod: CalculationMethod
  chargeStatus: ChargeStatus
  rate?: number | null
  quantity?: number | null
  totalAmount?: number | null
}

/** The cargo quantity a method multiplies its rate by. */
export function quantityForMethod(
  method: CalculationMethod,
  cargo: CargoBasis,
): number | null {
  switch (method) {
    case 'PER_KG':
      return cargo.grossWeightKg ?? null
    case 'PER_CHARGEABLE_KG':
      return cargo.chargeableWeightKg ?? cargo.grossWeightKg ?? null
    case 'PER_CBM':
      return cargo.cbm ?? null
    case 'PER_PACKAGE':
      return cargo.packageCount ?? null
    case 'PER_PALLET':
      return cargo.palletCount ?? null
    case 'FIXED':
      return 1
    case 'NONE':
      return null
  }
}

/**
 * What a line comes to in its own currency.
 *
 * An explicitly entered total always wins over rate x quantity: the agent's own
 * sheet is the source of truth for their own numbers, and it sometimes rounds.
 * Returns null when the line carries no amount at all — which is different from
 * an amount of zero, and stays different all the way through.
 */
export function computeLineTotal(charge: QuoteCharge, cargo: CargoBasis): number | null {
  if (!PRICED_STATUSES.includes(charge.chargeStatus)) return null

  if (charge.totalAmount !== null && charge.totalAmount !== undefined) {
    return round2(charge.totalAmount)
  }

  const rate = charge.rate
  if (rate === null || rate === undefined) return null

  const quantity = charge.quantity ?? quantityForMethod(charge.calculationMethod, cargo)
  if (quantity === null) return null

  return round2(rate * quantity)
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

export interface UnpricedItem {
  label: string
  status: ChargeStatus
}

export interface QuoteSummary {
  /** Sum of priced lines, per currency, before any conversion. */
  totalsByCurrency: Record<string, number>

  /**
   * The comparable figure, in the request's comparison currency.
   * Null when any priced currency has no rate — see `missingRatesFor`.
   */
  comparableTotal: number | null

  /** Currencies that carry money but have no comparison rate set. */
  missingRatesFor: string[]

  /** Charges that may still cost money but carry no number. */
  unpriced: UnpricedItem[]

  /** Charges confirmed to add nothing — folded in or not applicable. */
  noCost: UnpricedItem[]

  /** What the agent said the total was, in their quote currency. */
  agentQuotedTotal: number | null

  /** Sum of the agent's own priced lines, in their quote currency. */
  calculatedTotal: number | null

  /**
   * agentQuotedTotal - calculatedTotal, when both exist and differ by more than
   * a rounding cent. Never reconciled automatically.
   */
  discrepancy: number | null

  costPerChargeableKg: number | null
  costPerCbm: number | null
}

export interface SummariseInput {
  charges: QuoteCharge[]
  cargo: CargoBasis
  quoteCurrency: string
  agentQuotedTotal?: number | null
  /** currency -> multiplier into the comparison currency. */
  fxRates: Record<string, number>
  comparisonCurrency: string
}

/**
 * Reduce one quote to the handful of numbers a comparison needs.
 *
 * Deliberately returns `comparableTotal: null` rather than a partial figure
 * when a rate is missing. A total that quietly omits one currency is worse than
 * no total, because it still looks like an answer.
 */
export function summariseQuote(input: SummariseInput): QuoteSummary {
  const { charges, cargo, quoteCurrency, fxRates, comparisonCurrency } = input

  const minorByCurrency: Record<string, number> = {}
  const unpriced: UnpricedItem[] = []
  const noCost: UnpricedItem[] = []

  for (const charge of charges) {
    if (OPEN_ENDED_STATUSES.includes(charge.chargeStatus)) {
      unpriced.push({ label: charge.label, status: charge.chargeStatus })
      continue
    }

    if (!PRICED_STATUSES.includes(charge.chargeStatus)) {
      noCost.push({ label: charge.label, status: charge.chargeStatus })
      continue
    }

    const total = computeLineTotal(charge, cargo)
    if (total === null) {
      // Marked as quoted but carrying no number — an incomplete submission, not
      // a free line.
      unpriced.push({ label: charge.label, status: 'AT_ACTUAL' })
      continue
    }

    const currency = charge.currency || quoteCurrency
    minorByCurrency[currency] = (minorByCurrency[currency] ?? 0) + Math.round(total * 100)
  }

  const totalsByCurrency = Object.fromEntries(
    Object.entries(minorByCurrency).map(([currency, minor]) => [currency, minor / 100]),
  )

  // The comparison currency needs no rate for itself.
  const missingRatesFor = Object.keys(minorByCurrency).filter(
    (currency) => currency !== comparisonCurrency && !(fxRates[currency] > 0),
  )

  let comparableTotal: number | null = null
  if (missingRatesFor.length === 0) {
    let minor = 0
    for (const [currency, currencyMinor] of Object.entries(minorByCurrency)) {
      const rate = currency === comparisonCurrency ? 1 : fxRates[currency]
      minor += Math.round(currencyMinor * rate)
    }
    comparableTotal = minor / 100
  }

  // The agent's own arithmetic, checked in their own currency only.
  const ownMinor = minorByCurrency[quoteCurrency]
  const calculatedTotal = ownMinor === undefined ? null : ownMinor / 100

  const agentQuotedTotal = input.agentQuotedTotal ?? null
  const discrepancy =
    agentQuotedTotal !== null && calculatedTotal !== null
      ? round2(agentQuotedTotal - calculatedTotal)
      : null

  const chargeableWeight = cargo.chargeableWeightKg ?? cargo.grossWeightKg ?? null

  return {
    totalsByCurrency,
    comparableTotal,
    missingRatesFor,
    unpriced,
    noCost,
    agentQuotedTotal,
    calculatedTotal,
    discrepancy: discrepancy !== null && Math.abs(discrepancy) > 0.009 ? discrepancy : null,
    costPerChargeableKg:
      comparableTotal !== null && chargeableWeight
        ? round2(comparableTotal / chargeableWeight)
        : null,
    costPerCbm:
      comparableTotal !== null && cargo.cbm ? round2(comparableTotal / cargo.cbm) : null,
  }
}

export interface RankedQuote {
  recipientId: string
  summary: QuoteSummary
  /** 1 is the lowest comparable total. Null when the quote cannot be ranked. */
  rank: number | null
  /** True when other quotes carry fewer open-ended charges than this one. */
  hasMoreUnknowns: boolean
}

/**
 * Order quotes by comparable total, and say plainly which cannot be ordered.
 *
 * Ranking is presentation, not a recommendation: a rank of 1 means "cheapest of
 * the known numbers", and `hasMoreUnknowns` exists so that a cheap quote hiding
 * three at-actual charges cannot pass as straightforwardly cheapest. The app
 * never selects — a person does.
 */
export function rankQuotes(
  quotes: Array<{ recipientId: string; summary: QuoteSummary }>,
): RankedQuote[] {
  const comparable = quotes
    .filter((q) => q.summary.comparableTotal !== null)
    .sort((a, b) => (a.summary.comparableTotal ?? 0) - (b.summary.comparableTotal ?? 0))

  const rankByRecipient = new Map(comparable.map((q, index) => [q.recipientId, index + 1]))
  const fewestUnknowns = Math.min(...quotes.map((q) => q.summary.unpriced.length))

  return quotes.map((q) => ({
    recipientId: q.recipientId,
    summary: q.summary,
    rank: rankByRecipient.get(q.recipientId) ?? null,
    hasMoreUnknowns: q.summary.unpriced.length > fewestUnknowns,
  }))
}
