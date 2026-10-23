/**
 * Payment schedule calculation.
 *
 * The system may work out that 20/30/50 of EUR 100,000 is 20,000 / 30,000 /
 * 50,000 — but what it produces is a PROPOSAL. It is stored as `calculated`
 * and stays that way until a human approves it (spec §14). Nothing here writes
 * an approved schedule.
 *
 * All arithmetic is in whole minor units (cents) and only converted back at the
 * end, so a schedule can never fail to add up to the invoice.
 */

export interface InstalmentInput {
  description: string
  /** Percentage of the total, e.g. 20 for 20%. */
  percentage: number
  dueDate?: string | null
  condition?: string | null
  isAdvance?: boolean
}

export interface CalculatedInstalment {
  seq: number
  description: string
  percentage: number
  amount: number
  dueDate: string | null
  condition: string | null
  isAdvance: boolean
}

/**
 * Split a total across percentage instalments.
 *
 * The final instalment absorbs any rounding residual, so the instalments always
 * sum to exactly the total. Splitting 100 three ways gives 33.33 / 33.33 /
 * 33.34 — never 99.99.
 */
export function calculateSchedule(
  total: number,
  instalments: InstalmentInput[],
): CalculatedInstalment[] {
  if (!Number.isFinite(total) || total <= 0) {
    throw new Error('Total must be a positive amount')
  }
  if (instalments.length === 0) {
    throw new Error('At least one instalment is required')
  }

  // Work in minor units so intermediate rounding cannot accumulate.
  const totalMinor = Math.round(total * 100)
  let allocated = 0

  return instalments.map((instalment, index) => {
    const isLast = index === instalments.length - 1

    const amountMinor = isLast
      ? totalMinor - allocated
      : Math.round((totalMinor * instalment.percentage) / 100)

    allocated += amountMinor

    return {
      seq: index + 1,
      description: instalment.description,
      percentage: instalment.percentage,
      amount: amountMinor / 100,
      dueDate: instalment.dueDate ?? null,
      condition: instalment.condition ?? null,
      // Anything before the goods ship is an advance for IDPMS purposes; the
      // caller can override, and the operator can always correct it.
      isAdvance: instalment.isAdvance ?? index === 0,
    }
  })
}

/**
 * Parse shorthand terms such as "20/30/50" or "30 / 70".
 * Returns null when the input is not a clean set of percentages.
 */
export function parsePercentageTerms(input: string): number[] | null {
  const parts = input
    .split(/[/,+]/)
    .map((p) => p.trim().replace(/%$/, ''))
    .filter((p) => p !== '')

  if (parts.length === 0) return null

  const numbers = parts.map(Number)
  if (numbers.some((n) => !Number.isFinite(n) || n <= 0)) return null

  return numbers
}

export interface ScheduleCheck {
  ok: boolean
  difference: number
  message: string | null
}

/**
 * Does the schedule add up to the invoice?
 *
 * A mismatch is a WARNING, never a block (spec §35) — an operator may
 * deliberately schedule less than the PI value, and the app must not pretend to
 * know better. It just refuses to let it pass unnoticed.
 */
export function checkScheduleTotal(
  amounts: number[],
  expectedTotal: number | null,
  currency: string,
  tolerance = 0.01,
): ScheduleCheck {
  const sum = amounts.reduce((acc, amount) => acc + amount, 0)

  if (expectedTotal === null) {
    return { ok: true, difference: 0, message: null }
  }

  const difference = Number((sum - expectedTotal).toFixed(2))

  if (Math.abs(difference) <= tolerance) {
    return { ok: true, difference: 0, message: null }
  }

  const formatted = Math.abs(difference).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })

  return {
    ok: false,
    difference,
    message:
      difference > 0
        ? `Schedule exceeds the PI value by ${currency} ${formatted}.`
        : `Schedule is short of the PI value by ${currency} ${formatted}.`,
  }
}

/**
 * Convert to INR using a rate a human entered. Returns null without one — the
 * app never fetches or assumes an exchange rate.
 */
export function toInr(amount: number | null, fxRate: number | null): number | null {
  if (amount === null || fxRate === null) return null
  if (!Number.isFinite(amount) || !Number.isFinite(fxRate) || fxRate <= 0) return null

  return Number((amount * fxRate).toFixed(2))
}
