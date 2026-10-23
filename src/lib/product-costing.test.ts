import { describe, expect, it } from 'vitest'
import {
  allocateCharge,
  allocationsBalance,
  costPerKg,
  defaultAllocationBasis,
  invoiceChargeGap,
  isLargeDeviation,
} from './product-costing'

const cargo = [
  {
    id: 'a',
    quantity: 10,
    gross_weight_kg: 100,
    net_weight_kg: 90,
    cbm: 1,
  },
  {
    id: 'b',
    quantity: 5,
    gross_weight_kg: 50,
    net_weight_kg: 45,
    cbm: 0.5,
  },
  {
    id: 'c',
    quantity: 5,
    gross_weight_kg: 50,
    net_weight_kg: 45,
    cbm: 0.5,
  },
]

describe('allocateCharge', () => {
  it('splits by gross weight and balances to the charge', () => {
    const result = allocateCharge(124_517, cargo, 'gross_weight')
    expect(result.fellBackToEqual).toBe(false)
    expect(result.rows).toHaveLength(3)
    expect(result.rows[0]!.allocatedAmount).toBe(62_258.5)
    expect(result.rows[1]!.allocatedAmount + result.rows[2]!.allocatedAmount).toBe(62_258.5)
    expect(allocationsBalance(124_517, result.rows.map((r) => r.allocatedAmount))).toBe(true)
  })

  it('splits equally when requested', () => {
    const result = allocateCharge(300, cargo, 'equal')
    expect(result.rows.every((r) => r.allocatedAmount === 100)).toBe(true)
  })

  it('falls back to equal when weights are missing', () => {
    const empty = cargo.map((c) => ({ ...c, gross_weight_kg: 0 }))
    const result = allocateCharge(99, empty, 'gross_weight')
    expect(result.fellBackToEqual).toBe(true)
    expect(allocationsBalance(99, result.rows.map((r) => r.allocatedAmount))).toBe(true)
  })

  it('does not invent rows for manual basis', () => {
    const result = allocateCharge(100, cargo, 'manual')
    expect(result.rows).toHaveLength(0)
    expect(result.warning).toMatch(/Manual/)
  })
})

describe('invoiceChargeGap', () => {
  it('reports zero when charge lines equal the invoice total', () => {
    const exact = [88288.2, 13876.8, 1770, 6490, 4130, 3540, 6421.56]
    expect(Math.abs(invoiceChargeGap(124516.56, exact))).toBeLessThan(0.01)
  })

  it('reports a positive gap when charges undershoot the invoice', () => {
    expect(invoiceChargeGap(100, [40, 40])).toBe(20)
  })
})

describe('helpers', () => {
  it('defaults freight to gross weight', () => {
    expect(defaultAllocationBasis('freight')).toBe('gross_weight')
    expect(defaultAllocationBasis('tax')).toBe('equal')
  })

  it('flags large deviations', () => {
    expect(isLargeDeviation(12)).toBe(true)
    expect(isLargeDeviation(5)).toBe(false)
  })

  it('computes cost per kg', () => {
    expect(costPerKg(124_517, 462)).toBe(269.52)
  })
})
