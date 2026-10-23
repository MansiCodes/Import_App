import 'server-only'

import { createHash, randomBytes } from 'node:crypto'

/** One hour. A reset link is single-use as well as short-lived. */
export const RESET_TOKEN_TTL_MS = 60 * 60 * 1000

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43,128}$/

export function generateResetToken(): string {
  return randomBytes(32).toString('base64url')
}

/** SHA-256 hex. The raw token is only ever emailed, never stored or logged. */
export function hashResetToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

export function isResetToken(value: string): boolean {
  return TOKEN_PATTERN.test(value)
}
