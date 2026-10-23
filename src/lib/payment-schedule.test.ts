import { describe, expect, it } from 'vitest'
import {
  calculateSchedule,
  checkScheduleTotal,
  parsePercentageTerms,
  toInr,
} from './payment-schedule'

const sum = (values: number[]) => Number(values.reduce((a, b) => a + b, 0).toFixed(2))

describe('calculateSchedule', () => {
  it('produces the schedule from the spec example', () => {
    // EUR 100,000 at 20% advance / 30% before dispatch / 50% credit.
    const result = calculateSchedule(100_000, [
      { description: 'Advance', percentage: 20 },
      { description: 'Before dispatch', percentage: 30 },
      { description: '30-day credit', percentage: 50 },
    ])

    expect(result.map((r) => r.amount)).toEqual([20_000, 30_000, 50_000])
    expect(result.map((r) => r.seq)).toEqual([1, 2, 3])
  })

  it('always sums to the total, even with repeating decimals', () => {
    const result = calculateSchedule(100, [
      { description: 'A', percentage: 33.333 },
      { description: 'B', percentage: 33.333 },
      { description: 'C', percentage: 33.334 },
    ])

    // The last instalment absorbs the residual: 33.33 / 33.33 / 33.34.
    expect(sum(result.map((r) => r.amount))).toBe(100)
    expect(result[2].amount).toBe(33.34)
  })

  it('sums exactly on a real invoice value with awkward splits', () => {
    // Securiton EUR 123,396.00 — a real value from the archive.
    const result = calculateSchedule(123_396, [
      { description: 'Advance', percentage: 10 },
      { description: 'Second', percentage: 49.5 },
      { description: 'Balance', percentage: 40.5 },
    ])

    expect(sum(result.map((r) => r.amount))).toBe(123_396)
  })

  it('handles a single 100% instalment', () => {
    const result = calculateSchedule(2696.15, [{ description: 'Full payment', percentage: 100 }])

    expect(result).toHaveLength(1)
    expect(result[0].amount).toBe(2696.15)
  })

  it('does not lose fractional currency amounts', () => {
    const result = calculateSchedule(86.61, [
      { description: 'Half', percentage: 50 },
      { description: 'Half', percentage: 50 },
    ])

    expect(sum(result.map((r) => r.amount))).toBe(86.61)
    // 43.305 rounds to 43.31, so the remainder must be 43.30 — not another 43.31.
    expect(result[0].amount).toBe(43.31)
    expect(result[1].amount).toBe(43.3)
  })

  it('marks the first instalment as an advance by default', () => {
    const result = calculateSchedule(1000, [
      { description: 'Advance', percentage: 30 },
      { description: 'Balance', percentage: 70 },
    ])

    expect(result[0].isAdvance).toBe(true)
    expect(result[1].isAdvance).toBe(false)
  })

  it('lets the caller override which instalments are advances', () => {
    const result = calculateSchedule(1000, [
      { description: 'On delivery', percentage: 100, isAdvance: false },
    ])

    expect(result[0].isAdvance).toBe(false)
  })

  it('rejects a non-positive total and an empty schedule', () => {
    expect(() => calculateSchedule(0, [{ description: 'A', percentage: 100 }])).toThrow()
    expect(() => calculateSchedule(-5, [{ description: 'A', percentage: 100 }])).toThrow()
    expect(() => calculateSchedule(100, [])).toThrow()
  })
})

describe('parsePercentageTerms', () => {
  it('parses the common shorthands', () => {
    expect(parsePercentageTerms('20/30/50')).toEqual([20, 30, 50])
    expect(parsePercentageTerms('30 / 70')).toEqual([30, 70])
    expect(parsePercentageTerms('20%, 80%')).toEqual([20, 80])
    expect(parsePercentageTerms('50+50')).toEqual([50, 50])
  })

  it('returns null for input that is not percentages', () => {
    expect(parsePercentageTerms('')).toBeNull()
    expect(parsePercentageTerms('net 30 days')).toBeNull()
    expect(parsePercentageTerms('-20/120')).toBeNull()
  })

  it('does not silently fix a set that misses 100', () => {
    // Reporting 20/30 as valid is correct — the caller warns about the total.
    expect(parsePercentageTerms('20/30')).toEqual([20, 30])
  })
})

describe('checkScheduleTotal', () => {
  it('accepts a schedule that matches the PI', () => {
    expect(checkScheduleTotal([20_000, 30_000, 50_000], 100_000, 'EUR').ok).toBe(true)
  })

  it('flags a shortfall with the amount', () => {
    const result = checkScheduleTotal([20_000, 30_000], 100_000, 'EUR')

    expect(result.ok).toBe(false)
    expect(result.difference).toBe(-50_000)
    expect(result.message).toContain('short of the PI value')
    expect(result.message).toContain('50,000.00')
  })

  it('flags an overpayment', () => {
    const result = checkScheduleTotal([60_000, 50_000], 100_000, 'EUR')

    expect(result.ok).toBe(false)
    expect(result.difference).toBe(10_000)
    expect(result.message).toContain('exceeds the PI value')
  })

  it('tolerates a rounding-sized difference', () => {
    expect(checkScheduleTotal([33.33, 33.33, 33.33], 100, 'USD', 0.01).ok).toBe(true)
  })

  it('says nothing when there is no PI value to compare against', () => {
    const result = checkScheduleTotal([1000], null, 'USD')
    expect(result.ok).toBe(true)
    expect(result.message).toBeNull()
  })
})

describe('toInr', () => {
  it('converts using the rate given', () => {
    expect(toInr(1000, 95.5)).toBe(95_500)
  })

  it('refuses to guess without a rate', () => {
    expect(toInr(1000, null)).toBeNull()
    expect(toInr(null, 95.5)).toBeNull()
  })

  it('rejects a nonsensical rate rather than producing zero', () => {
    expect(toInr(1000, 0)).toBeNull()
    expect(toInr(1000, -95)).toBeNull()
  })
})
