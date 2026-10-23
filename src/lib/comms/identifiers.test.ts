import { describe, expect, it } from 'vitest'
import {
  extractAwbNumbers,
  extractContainerNumbers,
  extractImportNumbers,
  findKnown,
  isValidContainerNumber,
  normalise,
  splitContainerList,
} from './identifiers'

describe('normalise', () => {
  it('strips the punctuation people type identifiers with', () => {
    // The database holds 020-12345678; a supplier writes 020 1234 5678.
    expect(normalise('020-1234 5678')).toBe('02012345678')
    expect(normalise('atc_po_005_26-27')).toBe('ATCPO0052627')
    expect(normalise(null)).toBe('')
  })
})

describe('extractImportNumbers', () => {
  it('reads our own format however it is punctuated', () => {
    expect(extractImportNumbers('re IMP-2026-0014 please confirm')).toEqual(['IMP-2026-0014'])
    expect(extractImportNumbers('imp 2026 0014')).toEqual(['IMP-2026-0014'])
    expect(extractImportNumbers('IMP_2026_0014')).toEqual(['IMP-2026-0014'])
  })

  it('finds several in one message without repeating any', () => {
    expect(extractImportNumbers('IMP-2026-0014 and IMP-2026-0015 and IMP-2026-0014')).toEqual([
      'IMP-2026-0014',
      'IMP-2026-0015',
    ])
  })

  it('does not read a number that is merely nearby', () => {
    expect(extractImportNumbers('invoice 2026 0014')).toEqual([])
  })
})

describe('extractAwbNumbers', () => {
  it('reads an air waybill written with spaces or hyphens', () => {
    expect(extractAwbNumbers('MAWB 020-1234 5678 uplifted')).toEqual(['02012345678'])
    expect(extractAwbNumbers('awb 02012345678')).toEqual(['02012345678'])
  })

  it('ignores a run of digits that is the wrong length', () => {
    expect(extractAwbNumbers('reference 1234567890')).toEqual([])
    expect(extractAwbNumbers('reference 123456789012')).toEqual([])
  })
})

describe('isValidContainerNumber', () => {
  it('accepts a number whose check digit computes', () => {
    expect(isValidContainerNumber('MSKU1234565')).toBe(true)
    expect(isValidContainerNumber('TCLU0000009')).toBe(true)
  })

  it('rejects one whose check digit does not', () => {
    // The whole point: without this test any eleven alphanumerics in a message
    // would read as a container and match the wrong import.
    expect(isValidContainerNumber('MSKU1234567')).toBe(false)
  })

  it('rejects anything that is not a freight container', () => {
    expect(isValidContainerNumber('MSKA1234565')).toBe(false) // category must be U, J or Z
    expect(isValidContainerNumber('MSK1234565')).toBe(false)
    expect(isValidContainerNumber('')).toBe(false)
  })
})

describe('extractContainerNumbers', () => {
  it('reads a valid container out of a sentence', () => {
    expect(extractContainerNumbers('stuffed into MSKU 123456 5 today')).toEqual(['MSKU1234565'])
  })

  it('silently drops an invalid one rather than matching on it', () => {
    expect(extractContainerNumbers('container MSKU1234567')).toEqual([])
  })
})

describe('findKnown', () => {
  it('finds a stored PO however the supplier punctuated it', () => {
    // Real formats from the archive sit side by side and share no shape.
    const known = ['ATC_PO_005_26-27', 'ATC_PTS_PO_003']
    expect(findKnown('payment against ATC PO 005 26-27 please', known)).toEqual([
      'ATC_PO_005_26-27',
    ])
    expect(findKnown('as per atc_pts_po_003', known)).toEqual(['ATC_PTS_PO_003'])
  })

  it('ignores a reference too short to be evidence', () => {
    // A stored BOE of "12" would otherwise match almost every message.
    expect(findKnown('paid 12 cartons', ['12'])).toEqual([])
  })

  it('skips nulls rather than matching everything', () => {
    expect(findKnown('anything at all', [null, undefined, ''])).toEqual([])
  })

  it('returns nothing for an empty message', () => {
    expect(findKnown('', ['ATC_PO_005_26-27'])).toEqual([])
  })
})

describe('splitContainerList', () => {
  it('splits the one free-text column that may hold several numbers', () => {
    expect(splitContainerList('MSKU1234565, TCLU0000009')).toEqual(['MSKU1234565', 'TCLU0000009'])
    expect(splitContainerList('MSKU1234565 / TCLU0000009')).toEqual([
      'MSKU1234565',
      'TCLU0000009',
    ])
    expect(splitContainerList(null)).toEqual([])
  })
})
