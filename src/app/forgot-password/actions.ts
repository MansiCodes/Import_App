'use server'

import { headers } from 'next/headers'
import { callerKey, rateLimit } from '@/lib/rate-limit'
import { AUTH_MESSAGES, emailSchema } from '@/lib/auth/credentials'
import { resetMailConfigured, sendResetEmail } from '@/lib/auth/mail'
import { issuePasswordReset, type ResetRequestResult } from '@/lib/auth/reset'

function requestOrigin(headerList: Headers): string {
  const origin = headerList.get('origin')
  if (origin && /^https?:\/\/[^/]+$/.test(origin)) return origin

  const host = headerList.get('x-forwarded-host') ?? headerList.get('host')
  const proto = headerList.get('x-forwarded-proto') ?? 'http'
  if (host && !host.includes(' ')) return `${proto}://${host}`

  return (process.env.AUTH_SITE_URL ?? 'http://localhost:3000').replace(/\/$/, '')
}

export async function requestPasswordReset(
  _prev: ResetRequestResult | null,
  formData: FormData,
): Promise<ResetRequestResult> {
  const email = formData.get('email')
  const parsed = emailSchema.safeParse(typeof email === 'string' ? email : '')
  if (!parsed.success) {
    return { ok: false, error: AUTH_MESSAGES.emailInvalid }
  }

  // Same response whether or not the address exists. Checked before lookup so a
  // missing mailer cannot be used to tell accounts apart.
  if (!resetMailConfigured()) {
    return { ok: false, error: AUTH_MESSAGES.resetUnavailable }
  }

  const headerList = await headers()
  const limit = rateLimit(`pwreset:${callerKey(headerList, parsed.data)}`, 5, 60 * 60)
  if (!limit.allowed) {
    return { ok: false, error: AUTH_MESSAGES.resetUnavailable }
  }

  return issuePasswordReset(parsed.data, requestOrigin(headerList), sendResetEmail)
}
