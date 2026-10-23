/**
 * What the simplified quotation form actually writes.
 *
 * The form itself only asks for a name and a rupee amount. Everything the old
 * form asked for — rate, basis, currency, status — still exists in the table
 * and still drives the comparison, so the rules for what happens to those
 * columns are worth pinning down: a blank line must not become a charge of
 * zero, and reopening an older quotation must not quietly erase what it said.
 */

import { describe, expect, it } from 'vitest'
import {
  carriedNote,
  currencyMark,
  lineAmount,
  lineIsMeaningful,
  toChargePayload,
  type ChargeLine,
} from './charge-row'

function line(overrides: Partial<ChargeLine> = {}): ChargeLine {
  return {
    key: 'seed-0',
    charge_type: 'air_freight',
    label: 'Air Freight',
    custom_label: '',
    is_custom: false,
    currency: 'INR',
    charge_status: 'QUOTED',
    total_amount: '',
    carried_rate: null,
    carried_method: 'FIXED',
    ...overrides,
  }
}

describe('what counts as an amount', () => {
  it('reads a typed figure', () => {
    expect(lineAmount(line({ total_amount: '60000' }))).toBe(60000)
    expect(lineAmount(line({ total_amount: '1234.56' }))).toBe(1234.56)
  })

  it('treats blank and nonsense as no amount, never as zero', () => {
    expect(lineAmount(line({ total_amount: '' }))).toBeNull()
    expect(lineAmount(line({ total_amount: '   ' }))).toBeNull()
    expect(lineAmount(line({ total_amount: 'abc' }))).toBeNull()
  })

  it('keeps a genuine zero, which is a real thing to quote', () => {
    expect(lineAmount(line({ total_amount: '0' }))).toBe(0)
  })
})

describe('which lines get sent', () => {
  it('drops a line nobody filled in', () => {
    expect(lineIsMeaningful(line())).toBe(false)
  })

  it('sends a line with an amount', () => {
    expect(lineIsMeaningful(line({ total_amount: '500' }))).toBe(true)
  })

  it('keeps a line an earlier submission marked at actual', () => {
    expect(lineIsMeaningful(line({ charge_status: 'AT_ACTUAL' }))).toBe(true)
  })

  it('keeps a line an earlier submission priced by rate', () => {
    expect(
      lineIsMeaningful(line({ carried_rate: 100, carried_method: 'PER_CHARGEABLE_KG' })),
    ).toBe(true)
  })
})

describe('toChargePayload', () => {
  it('writes a typed amount as a plain fixed charge', () => {
    expect(toChargePayload(line({ total_amount: '60000' }), 0)).toEqual({
      charge_type: 'air_freight',
      custom_label: null,
      currency: 'INR',
      calculation_method: 'FIXED',
      charge_status: 'QUOTED',
      rate: null,
      quantity: null,
      total_amount: 60000,
      remarks: null,
      sort_order: 0,
    })
  })

  it('names a charge the company added themselves', () => {
    const payload = toChargePayload(
      line({
        key: 'added-1',
        charge_type: 'misc',
        is_custom: true,
        custom_label: ' Terminal Handling ',
        total_amount: '1570',
      }),
      3,
    )
    expect(payload.custom_label).toBe('Terminal Handling')
    expect(payload.total_amount).toBe(1570)
    expect(payload.sort_order).toBe(3)
  })

  it('carries an older rate through a revision rather than dropping it', () => {
    const payload = toChargePayload(
      line({ currency: 'USD', carried_rate: 100, carried_method: 'PER_CHARGEABLE_KG' }),
      0,
    )
    expect(payload.rate).toBe(100)
    expect(payload.calculation_method).toBe('PER_CHARGEABLE_KG')
    expect(payload.currency).toBe('USD')
    expect(payload.total_amount).toBeNull()
  })

  it('lets a typed amount replace what the line used to be', () => {
    const payload = toChargePayload(
      line({ carried_rate: 100, carried_method: 'PER_CHARGEABLE_KG', total_amount: '85430' }),
      0,
    )
    expect(payload.total_amount).toBe(85430)
    expect(payload.rate).toBeNull()
    expect(payload.calculation_method).toBe('FIXED')
    expect(payload.charge_status).toBe('QUOTED')
  })

  it('keeps an at-actual flag, so an unknown cost does not become nothing', () => {
    const payload = toChargePayload(line({ charge_status: 'AT_ACTUAL' }), 0)
    expect(payload.charge_status).toBe('AT_ACTUAL')
    expect(payload.total_amount).toBeNull()
    expect(payload.calculation_method).toBe('NONE')
  })

  it('lets an amount settle a charge that was previously at actual', () => {
    const payload = toChargePayload(line({ charge_status: 'AT_ACTUAL', total_amount: '2400' }), 0)
    expect(payload.charge_status).toBe('QUOTED')
    expect(payload.total_amount).toBe(2400)
  })
})

describe('a charge the company added themselves', () => {
  it('is recognised on reopening by its own name, not by how it got here', () => {
    // The line comes back from the database with a fresh key and no memory of
    // having been added by hand; the custom label is what identifies it.
    const reopened = line({
      key: 'existing-9',
      charge_type: 'misc',
      is_custom: true,
      custom_label: 'Terminal Handling',
      total_amount: '1570',
    })
    expect(toChargePayload(reopened, 5).custom_label).toBe('Terminal Handling')
  })
})

describe('what the line shows', () => {
  it('marks rupees with the symbol and anything else with its code', () => {
    expect(currencyMark('INR')).toBe('₹')
    expect(currencyMark('USD')).toBe('USD')
  })

  it('says what an older line used to be worth', () => {
    expect(carriedNote(line({ currency: 'USD', carried_rate: 100, carried_method: 'PER_CHARGEABLE_KG' })))
      .toBe('previously USD 100 per chargeable kg')
    expect(carriedNote(line({ carried_rate: 5000, carried_method: 'FIXED' }))).toBe(
      'previously ₹ 5,000',
    )
  })

  it('says nothing when there is nothing carried', () => {
    expect(carriedNote(line())).toBeNull()
  })
})
