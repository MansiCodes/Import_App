import { describe, expect, it } from 'vitest'
import { generateQuoteToken, quotePortalPath, quotePortalUrl } from './freight-token'

describe('generateQuoteToken', () => {
  it('issues a different unguessable token every time', () => {
    const tokens = new Set(Array.from({ length: 20 }, generateQuoteToken))
    expect(tokens.size).toBe(20)
    for (const token of tokens) {
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
      expect(token).not.toMatch(/^\d+$/)
    }
  })
})

describe('quotePortalUrl', () => {
  it('builds a unique URL from the token, not from a sequential id', () => {
    expect(quotePortalPath('tok-aaa')).toBe('/q/tok-aaa')
    expect(quotePortalUrl('tok-aaa', 'https://app.example/')).toBe('https://app.example/q/tok-aaa')
    expect(quotePortalUrl('tok-bbb', 'https://app.example')).not.toBe(
      quotePortalUrl('tok-aaa', 'https://app.example'),
    )
  })
})
