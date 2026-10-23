/**
 * Product-wise logistics allocation.
 *
 * Allocations are DERIVED views of invoice charge lines — they never create
 * new expenses. Sum of product allocations for a charge must equal the charge
 * amount (within 0.01); leftover paise land on the largest basis line.
 */

export const ALLOCATION_BASES = [
  'gross_weight',
  'net_weight',
  'quantity',
  'cbm',
  'equal',
  'manual',
] as const

export type AllocationBasis = (typeof ALLOCATION_BASES)[number]

export const COSTING_BUCKETS = [
  'freight',
  'bl_awb',
  'cha',
  'local',
  'other',
  'tax',
] as const

export type CostingBucket = (typeof COSTING_BUCKETS)[number]

export const ALLOCATION_BASIS_LABELS: Record<AllocationBasis, string> = {
  gross_weight: 'By gross weight',
  net_weight: 'By net weight',
  quantity: 'By quantity',
  cbm: 'By CBM',
  equal: 'Equal split',
  manual: 'Manual',
}

/** Default basis for freight-like charges. */
export function defaultAllocationBasis(bucket: CostingBucket | null | undefined): AllocationBasis {
  if (bucket === 'tax') return 'equal'
  if (bucket === 'freight') return 'gross_weight'
  return 'gross_weight'
}

export type CargoBasisLine = {
  id: string
  quantity: number | null
  gross_weight_kg: number | null
  net_weight_kg: number | null
  cbm: number | null
}

export type AllocationRow = {
  cargoLineId: string
  basisValue: number
  allocatedAmount: number
}

export type AllocationResult = {
  rows: AllocationRow[]
  /** True when weight/qty/cbm were all zero and we fell back to equal. */
  fellBackToEqual: boolean
  warning: string | null
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function basisValue(line: CargoBasisLine, basis: AllocationBasis): number {
  switch (basis) {
    case 'gross_weight':
      return Math.max(0, line.gross_weight_kg ?? 0)
    case 'net_weight':
      return Math.max(0, line.net_weight_kg ?? 0)
    case 'quantity':
      return Math.max(0, line.quantity ?? 0)
    case 'cbm':
      return Math.max(0, line.cbm ?? 0)
    case 'equal':
      return 1
    case 'manual':
      return 0
  }
}

/**
 * Distribute `amount` across cargo lines by basis.
 * Manual basis is not computed here — caller must supply amounts.
 */
export function allocateCharge(
  amount: number,
  cargo: CargoBasisLine[],
  basis: AllocationBasis,
): AllocationResult {
  if (!Number.isFinite(amount)) {
    return { rows: [], fellBackToEqual: false, warning: 'Invalid charge amount' }
  }
  if (cargo.length === 0) {
    return {
      rows: [],
      fellBackToEqual: false,
      warning: 'No cargo lines to allocate against',
    }
  }
  if (basis === 'manual') {
    return {
      rows: [],
      fellBackToEqual: false,
      warning: 'Manual allocation must be entered by hand',
    }
  }

  let effectiveBasis = basis
  let fellBackToEqual = false
  let warning: string | null = null

  let values = cargo.map((line) => basisValue(line, effectiveBasis))
  let total = values.reduce((sum, v) => sum + v, 0)

  if (total <= 0 && effectiveBasis !== 'equal') {
    effectiveBasis = 'equal'
    fellBackToEqual = true
    warning = `No ${basis.replace('_', ' ')} on cargo — fell back to equal split`
    values = cargo.map(() => 1)
    total = values.length
  }

  if (total <= 0) {
    return {
      rows: [],
      fellBackToEqual,
      warning: warning ?? 'Nothing to allocate against',
    }
  }

  const raw = values.map((v) => (amount * v) / total)
  const floored = raw.map((v) => round2(v))
  let allocated = floored.reduce((sum, v) => sum + v, 0)
  let remainder = round2(amount - allocated)

  // Put leftover on the largest basis line (stable: first max wins).
  let maxIdx = 0
  for (let i = 1; i < values.length; i++) {
    if (values[i]! > values[maxIdx]!) maxIdx = i
  }
  floored[maxIdx] = round2(floored[maxIdx]! + remainder)
  allocated = floored.reduce((sum, v) => sum + v, 0)

  // Final guard for floating noise
  const drift = round2(amount - allocated)
  if (Math.abs(drift) >= 0.01) {
    floored[maxIdx] = round2(floored[maxIdx]! + drift)
  }

  const rows: AllocationRow[] = cargo.map((line, i) => ({
    cargoLineId: line.id,
    basisValue: values[i]!,
    allocatedAmount: floored[i]!,
  }))

  return { rows, fellBackToEqual, warning }
}

/** True when sum of allocations matches the charge within 0.01. */
export function allocationsBalance(
  chargeAmount: number,
  allocatedAmounts: number[],
  tolerance = 0.01,
): boolean {
  const sum = round2(allocatedAmounts.reduce((s, n) => s + n, 0))
  return Math.abs(round2(chargeAmount) - sum) <= tolerance
}

/** Invoice header vs sum of charge lines. */
export function invoiceChargeGap(
  grandTotal: number,
  chargeAmounts: number[],
): number {
  const charges = round2(chargeAmounts.reduce((s, n) => s + n, 0))
  return round2(grandTotal - charges)
}

export function formatDiffPct(diffPct: number | null): string {
  if (diffPct === null || !Number.isFinite(diffPct)) return '—'
  const sign = diffPct > 0 ? '+' : ''
  return `${sign}${diffPct.toFixed(1)}%`
}

/** Highlight when absolute percentage deviation is large. */
export function isLargeDeviation(diffPct: number | null, threshold = 10): boolean {
  if (diffPct === null || !Number.isFinite(diffPct)) return false
  return Math.abs(diffPct) >= threshold
}

export function costPerKg(total: number, weightKg: number | null): number | null {
  if (weightKg === null || weightKg <= 0 || !Number.isFinite(total)) return null
  return round2(total / weightKg)
}

export function costPerCbm(total: number, cbm: number | null): number | null {
  if (cbm === null || cbm <= 0 || !Number.isFinite(total)) return null
  return round2(total / cbm)
}
