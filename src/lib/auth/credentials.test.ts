import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import {
  AUTH_MESSAGES,
  emailSchema,
  loginFailureMessage,
  passwordSchema,
  redactSecret,
  safeNextPath,
} from '@/lib/auth/credentials'
import { hashResetToken, isResetToken, generateResetToken } from '@/lib/auth/reset-token'

describe('login credentials', () => {
  it('accepts a normal email and rejects a malformed one', () => {
    expect(emailSchema.parse('  Admin@Example.com ')).toBe('admin@example.com')
    expect(emailSchema.safeParse('not-an-email').success).toBe(false)
    expect(emailSchema.safeParse('').success).toBe(false)
  })

  it('requires a password of 8 to 72 characters', () => {
    expect(passwordSchema.safeParse('short').success).toBe(false)
    expect(passwordSchema.safeParse('long-enough').success).toBe(true)
    expect(passwordSchema.safeParse('x'.repeat(73)).success).toBe(false)
  })

  it('uses one message for a bad login and a different one for a provider limit', () => {
    expect(loginFailureMessage({ message: 'Invalid login credentials' })).toBe(
      AUTH_MESSAGES.invalidLogin,
    )
    expect(loginFailureMessage({ message: 'Email not confirmed' })).toBe(AUTH_MESSAGES.invalidLogin)
    expect(loginFailureMessage({ code: 'over_email_send_rate_limit', message: 'Email rate limit exceeded' })).toBe(
      AUTH_MESSAGES.loginUnavailable,
    )
  })

  it('keeps post-login redirects inside the app', () => {
    expect(safeNextPath('/imports/123')).toBe('/imports/123')
    expect(safeNextPath('https://evil.example/phish')).toBe('/')
    expect(safeNextPath('//evil.example')).toBe('/')
    expect(safeNextPath(null)).toBe('/')
  })

  it('removes a password if a provider error echoes it', () => {
    expect(redactSecret('rejected secret-value here', 'secret-value')).toBe('rejected [redacted] here')
  })
})

describe('reset tokens', () => {
  it('stores a hash, not the token', () => {
    const token = generateResetToken()
    expect(isResetToken(token)).toBe(true)
    const hash = hashResetToken(token)
    expect(hash).toHaveLength(64)
    expect(hash).not.toBe(token)
    expect(hash).toBe(createHash('sha256').update(token, 'utf8').digest('hex'))
  })

  it('rejects tokens that were not issued by us', () => {
    expect(isResetToken('')).toBe(false)
    expect(isResetToken('short')).toBe(false)
    expect(isResetToken(`${'a'.repeat(43)}&inject`)).toBe(false)
  })
})
