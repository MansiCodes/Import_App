import { describe, expect, it } from 'vitest'
import { identifySender, normalisePhone, phoneSuffix, type DirectoryEntry } from './sender'

const DIRECTORY: DirectoryEntry[] = [
  {
    role: 'Supplier',
    phone: '+86 138 0000 0001',
    name: 'Mr Zhang',
    supplierId: 'supplier-tc-fire',
    contactId: 'contact-zhang',
  },
  {
    role: 'CHA',
    phone: '+91 98100 00002',
    name: 'DV Logistics',
    chaId: 'cha-dv',
  },
  {
    role: 'Overseas Agent',
    phone: '00 41 44 000 0003',
    name: 'Securiton AG desk',
    chaId: 'cha-dv',
    chaAgentId: 'agent-ch',
  },
]

describe('normalisePhone', () => {
  it('keeps only the digits, because everything else is presentation', () => {
    expect(normalisePhone('+86 138 0000 0001')).toBe('8613800000001')
    expect(normalisePhone('(011) 4000-1234')).toBe('01140001234')
    expect(normalisePhone(null)).toBe('')
  })
})

describe('phoneSuffix', () => {
  it('takes the trailing digits an international prefix cannot disturb', () => {
    expect(phoneSuffix('+86 138 0000 0001')).toBe('800000001')
    expect(phoneSuffix('008613800000001')).toBe('800000001')
  })

  it('gives nothing for a number too short to be dependable', () => {
    expect(phoneSuffix('12345')).toBe('')
  })
})

describe('identifySender', () => {
  it('recognises an exact number and reports how it knew', () => {
    const match = identifySender('+86 138 0000 0001', DIRECTORY)

    expect(match.role).toBe('Supplier')
    expect(match.method).toBe('phone_exact')
    expect(match.supplierId).toBe('supplier-tc-fire')
    expect(match.contactId).toBe('contact-zhang')
    expect(match.name).toBe('Mr Zhang')
  })

  it('recognises the same number written without its country code', () => {
    // Stored as +86 138 0000 0001, arrives as 13800000001.
    const match = identifySender('13800000001', DIRECTORY)

    expect(match.role).toBe('Supplier')
    expect(match.method).toBe('phone_suffix')
    expect(match.supplierId).toBe('supplier-tc-fire')
  })

  it('carries an overseas agent’s CHA through with it', () => {
    const match = identifySender('+41 44 000 0003', DIRECTORY)

    expect(match.role).toBe('Overseas Agent')
    expect(match.chaAgentId).toBe('agent-ch')
    expect(match.chaId).toBe('cha-dv')
  })

  it('answers Unknown for a number nobody holds', () => {
    // The honest answer for most real messages: the schema has no phone for a
    // bank, customs, insurance or a transporter.
    const match = identifySender('+1 555 000 9999', DIRECTORY)

    expect(match.role).toBe('Unknown')
    expect(match.method).toBe('none')
    expect(match.supplierId).toBeNull()
  })

  it('answers Unknown rather than picking between two near matches', () => {
    const colliding: DirectoryEntry[] = [
      { role: 'Supplier', phone: '+86 138 0000 0001', supplierId: 'a' },
      { role: 'CHA', phone: '+91 138 0000 0001', chaId: 'b' },
    ]

    const match = identifySender('138 0000 0001', colliding)
    expect(match.role).toBe('Unknown')
  })

  it('answers Unknown when two directory rows hold the same number', () => {
    // A duplicate is a data problem, not a licence to choose one.
    const duplicated: DirectoryEntry[] = [
      { role: 'Supplier', phone: '+91 98100 00002', supplierId: 'a' },
      { role: 'CHA', phone: '+91 98100 00002', chaId: 'b' },
    ]

    expect(identifySender('+91 98100 00002', duplicated).role).toBe('Unknown')
  })

  it('answers Unknown for a missing number instead of throwing', () => {
    expect(identifySender(null, DIRECTORY).role).toBe('Unknown')
    expect(identifySender('', DIRECTORY).role).toBe('Unknown')
  })

  it('skips directory rows with no phone at all', () => {
    const sparse: DirectoryEntry[] = [{ role: 'Supplier', phone: null, supplierId: 'a' }]
    expect(identifySender('13800000001', sparse).role).toBe('Unknown')
  })
})
