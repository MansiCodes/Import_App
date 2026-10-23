import { describe, expect, it } from 'vitest'
import { pairNamedPhones, pendingVendors, whatsappChatUrl } from './quote-links'

describe('pairNamedPhones', () => {
  it('keeps each extra company with the phone typed on the same row', () => {
    expect(pairNamedPhones(['ABC Supplier', 'XYZ Supplier'], ['9876543210', '9123456789'])).toEqual([
      { name: 'ABC Supplier', phone: '9876543210' },
      { name: 'XYZ Supplier', phone: '9123456789' },
    ])
  })

  it('allows a name with no phone', () => {
    expect(pairNamedPhones(['PQR Supplier'], [])).toEqual([{ name: 'PQR Supplier', phone: null }])
  })
})

describe('pendingVendors', () => {
  it('keeps unsubmitted vendors in the comparison once others have replied', () => {
    const recipients = [
      { id: 'a', status: 'Submitted' },
      { id: 'b', status: 'Submitted' },
      { id: 'c', status: 'Pending' },
      { id: 'd', status: 'Revoked' },
    ]

    expect(pendingVendors(recipients, ['a', 'b']).map((r) => r.id)).toEqual(['c'])
  })
})

describe('whatsappChatUrl', () => {
  it('puts a different unique link in each recipient message', () => {
    const a = whatsappChatUrl('919876543210', 'Hello ABC\nhttps://app/q/token-aaa')
    const b = whatsappChatUrl('919123456789', 'Hello XYZ\nhttps://app/q/token-bbb')

    expect(a).toContain('token-aaa')
    expect(a).not.toContain('token-bbb')
    expect(b).toContain('token-bbb')
    expect(b).not.toContain('token-aaa')
    expect(a).not.toBe(b)
  })
})
