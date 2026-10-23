import 'server-only'

import { randomBytes } from 'node:crypto'

/**
 * The secret in a quote portal link.
 *
 * 32 random bytes, base64url-encoded to 43 URL-safe characters. That is the
 * same order of entropy as a session id and far beyond guessing, which matters
 * because the token IS the authorisation — there is no second factor and no
 * account behind it.
 *
 * Deliberately not derived from the request or recipient id: a token that
 * encodes anything can be reasoned about, and one agent could work out
 * another's link.
 */
export function generateQuoteToken(): string {
  return randomBytes(32).toString('base64url')
}

/** Where an agent goes to fill in their quote. */
export function quotePortalPath(token: string): string {
  return `/q/${token}`
}

export function quotePortalUrl(token: string, origin: string): string {
  return `${origin.replace(/\/$/, '')}${quotePortalPath(token)}`
}

export interface TokenState {
  usable: boolean
  reason: 'ok' | 'revoked' | 'expired' | 'closed'
}

/**
 * Whether a link should still open, and why not when it should not.
 *
 * Separated from the lookup so the portal can say something honest — "this
 * request has closed" reads very differently from a blank 404 to an agent who
 * did nothing wrong.
 */
export function tokenState(recipient: {
  revoked_at: string | null
  token_expires_at: string | null
  request_status: string
}): TokenState {
  if (recipient.revoked_at) return { usable: false, reason: 'revoked' }

  if (recipient.token_expires_at && new Date(recipient.token_expires_at) < new Date()) {
    return { usable: false, reason: 'expired' }
  }

  if (['Closed', 'Cancelled'].includes(recipient.request_status)) {
    return { usable: false, reason: 'closed' }
  }

  return { usable: true, reason: 'ok' }
}
