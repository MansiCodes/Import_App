import { describe, expect, it } from 'vitest'
import { financialYear } from './fy'
import { renderPoNumber } from './po-number'

describe('financialYear', () => {
  it('places an August date in the FY starting that April', () => {
    // 14 Aug 2026, April start -> FY 26-27, matching ATC's folder name.
    expect(financialYear(new Date(2026, 7, 14), 4)).toMatchObject({
      startYear: 2026,
      endYear: 2027,
      label: '26-27',
      longLabel: '2026-27',
    })
  })

  it('places a pre-April date in the previous FY', () => {
    expect(financialYear(new Date(2026, 1, 14), 4).label).toBe('25-26')
  })

  it('treats the first day of the FY as inside it', () => {
    expect(financialYear(new Date(2026, 3, 1), 4).label).toBe('26-27')
  })

  it('treats the last day before the FY as outside it', () => {
    expect(financialYear(new Date(2026, 2, 31), 4).label).toBe('25-26')
  })

  it('uses a single-year label for calendar-year companies', () => {
    expect(financialYear(new Date(2026, 7, 14), 1)).toMatchObject({
      startYear: 2026,
      endYear: 2026,
      label: '2026',
    })
  })

  it('rejects an out-of-range start month', () => {
    expect(() => financialYear(new Date(2026, 7, 14), 0)).toThrow()
    expect(() => financialYear(new Date(2026, 7, 14), 13)).toThrow()
  })
})

describe('renderPoNumber', () => {
  const august2026 = new Date(2026, 7, 14)

  it("reproduces ATC's real PO format", () => {
    // Real file: PO_ATC_006_26-27.pdf
    expect(
      renderPoNumber('{COMPANY}_PO_{SEQ:3}_{FY}', {
        companyCode: 'ATC',
        seq: 6,
        date: august2026,
        fyStartMonth: 4,
      }),
    ).toBe('ATC_PO_006_26-27')
  })

  it("reproduces Valuecon's supplier-bearing format", () => {
    // Real file: PO_VCON_Thermo_034.pdf
    expect(
      renderPoNumber('PO_{COMPANY}_{SUPPLIER}_{SEQ:3}', {
        companyCode: 'VCON',
        seq: 34,
        date: august2026,
        fyStartMonth: 4,
        supplierName: 'Thermo',
      }),
    ).toBe('PO_VCON_THERMO_034')
  })

  it('pads to the requested width and leaves unpadded {SEQ} alone', () => {
    const ctx = { companyCode: 'NOTO', seq: 7, date: august2026, fyStartMonth: 4 }
    expect(renderPoNumber('{SEQ:4}', ctx)).toBe('0007')
    expect(renderPoNumber('{SEQ}', ctx)).toBe('7')
  })

  it('does not truncate a sequence wider than its padding', () => {
    expect(
      renderPoNumber('{SEQ:2}', { companyCode: 'ATC', seq: 1234, date: august2026, fyStartMonth: 4 }),
    ).toBe('1234')
  })

  it('collapses punctuation in a supplier name to single underscores', () => {
    expect(
      renderPoNumber('{SUPPLIER}', {
        companyCode: 'NOTO',
        seq: 1,
        date: august2026,
        fyStartMonth: 4,
        supplierName: 'Cheemi Technology Co. Ltd',
      }),
    ).toBe('CHEEMI_TECHNOLOGY_CO_LTD')
  })

  it('leaves an unknown placeholder visible so a bad template is obvious', () => {
    expect(
      renderPoNumber('{COMPANY}_{NOPE}', {
        companyCode: 'ATC',
        seq: 1,
        date: august2026,
        fyStartMonth: 4,
      }),
    ).toBe('ATC_{NOPE}')
  })

  it('renders {SUPPLIER} as empty when no supplier is set', () => {
    expect(
      renderPoNumber('{COMPANY}{SUPPLIER}_{SEQ:2}', {
        companyCode: 'ATC',
        seq: 3,
        date: august2026,
        fyStartMonth: 4,
      }),
    ).toBe('ATC_03')
  })
})
