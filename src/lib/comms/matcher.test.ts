import { describe, expect, it } from 'vitest'
import { matchImport, type MatchCandidate } from './matcher'

const TC_FIRE: MatchCandidate = {
  importId: 'aaaaaaaa-0000-0000-0000-000000000001',
  importNo: 'IMP-2026-0018',
  poNumber: 'ATC_PO_005_26-27',
  piNumber: 'PI-TCATC-260213',
  supplierId: 'supplier-tc-fire',
  isActive: true,
  awbs: ['020-12345678'],
  blNumbers: ['MEDUX7788991'],
  containerNumbers: ['MSKU1234565'],
  boeNumbers: ['9068987'],
}

const SECURITON: MatchCandidate = {
  importId: 'bbbbbbbb-0000-0000-0000-000000000002',
  importNo: 'IMP-2026-0014',
  poNumber: 'ATC_PO_008_SECURITON',
  piNumber: null,
  supplierId: 'supplier-securiton',
  isActive: true,
  awbs: [],
  blNumbers: [],
  containerNumbers: [],
  boeNumbers: [],
}

const CANDIDATES = [TC_FIRE, SECURITON]

describe('matchImport', () => {
  it('matches on our own import number with near certainty', () => {
    const result = matchImport('Update on IMP-2026-0014 — cleared today.', CANDIDATES)

    expect(result.status).toBe('matched')
    expect(result.importId).toBe(SECURITON.importId)
    expect(result.confidence).toBeGreaterThan(0.9)
    expect(result.signals.map((s) => s.kind)).toContain('import_no')
  })

  it('matches on a PO number quoted in the supplier’s own punctuation', () => {
    const result = matchImport('Balance payment against ATC PO 005 26-27?', CANDIDATES)

    expect(result.status).toBe('matched')
    expect(result.importId).toBe(TC_FIRE.importId)
  })

  it('matches on a transport reference', () => {
    const awb = matchImport('MAWB 020-1234 5678 departed last night.', CANDIDATES)
    expect(awb.importId).toBe(TC_FIRE.importId)

    const container = matchImport('Stuffed MSKU 123456 5 this morning.', CANDIDATES)
    expect(container.importId).toBe(TC_FIRE.importId)

    const boe = matchImport('BOE 9068987 filed, duty payable.', CANDIDATES)
    expect(boe.importId).toBe(TC_FIRE.importId)
  })

  it('grows more confident as signals agree, without ever reaching certainty from weak ones', () => {
    const one = matchImport('BOE 9068987 filed.', CANDIDATES)
    const two = matchImport('BOE 9068987 filed against ATC_PO_005_26-27.', CANDIDATES)

    expect(two.confidence).toBeGreaterThan(one.confidence)
    expect(two.confidence).toBeLessThan(1)
  })

  it('refuses to choose between two imports that score alike', () => {
    // Both orders are with the same supplier and nothing else distinguishes
    // them. Picking one would file a promise against the wrong order.
    const sameSupplier: MatchCandidate[] = [
      { ...TC_FIRE, supplierId: 'shared' },
      { ...SECURITON, supplierId: 'shared' },
    ]

    const result = matchImport('Goods will be ready Friday.', sameSupplier, {
      senderSupplierId: 'shared',
      minConfidence: 0.2,
    })

    expect(result.status).toBe('ambiguous')
    expect(result.importId).toBeNull()
    expect(result.alternatives).toHaveLength(2)
  })

  it('leaves a message unmatched rather than guessing from the sender alone', () => {
    // Knowing who sent a message narrows the field; it does not identify the
    // order. The default threshold is above what a sender match can reach.
    const result = matchImport('Goods will be ready Friday.', CANDIDATES, {
      senderSupplierId: 'supplier-tc-fire',
    })

    expect(result.status).toBe('unmatched')
    expect(result.importId).toBeNull()
  })

  it('still lists what it considered when nothing was certain enough', () => {
    // "Nothing was found" and "nothing was sure enough" look identical to the
    // operator otherwise, and the second deserves a shortlist.
    const result = matchImport('Goods will be ready Friday.', CANDIDATES, {
      senderSupplierId: 'supplier-tc-fire',
    })

    expect(result.alternatives).toHaveLength(1)
    expect(result.alternatives[0].importNo).toBe('IMP-2026-0018')
  })

  it('returns unmatched with nothing to show when the message names no order', () => {
    const result = matchImport('Ok noted, thanks.', CANDIDATES)

    expect(result.status).toBe('unmatched')
    expect(result.confidence).toBe(0)
    expect(result.alternatives).toEqual([])
  })

  it('does not offer a closed import on the strength of its supplier', () => {
    const closed: MatchCandidate[] = [{ ...TC_FIRE, isActive: false }]

    const result = matchImport('Any update?', closed, {
      senderSupplierId: 'supplier-tc-fire',
      minConfidence: 0.2,
    })

    expect(result.status).toBe('unmatched')
    expect(result.alternatives).toEqual([])
  })

  it('still matches a closed import when a hard identifier names it', () => {
    // Suppressing the weak signal must not suppress the evidence.
    const closed: MatchCandidate[] = [{ ...TC_FIRE, isActive: false }]

    const result = matchImport('Query on IMP-2026-0018.', closed)
    expect(result.status).toBe('matched')
  })

  it('honours a threshold raised by settings', () => {
    const result = matchImport('BOE 9068987 filed.', CANDIDATES, { minConfidence: 0.95 })
    expect(result.status).toBe('unmatched')
  })

  it('copes with no candidates at all', () => {
    const result = matchImport('IMP-2026-0014 update', [])
    expect(result.status).toBe('unmatched')
    expect(result.alternatives).toEqual([])
  })
})
