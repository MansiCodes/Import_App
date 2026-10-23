import { z } from 'zod'

/** Shown to people. Never a stack trace, a provider code, or a password. */
export const AUTH_MESSAGES = {
  invalidLogin: 'Invalid email or password',
  loginUnavailable: 'Unable to sign in right now. Please try again shortly.',
  resetUnavailable: 'Unable to reset password',
  resetSent:
    'If an account exists for that email, password reset instructions have been sent.',
  resetExpired: 'That password reset link has expired or was already used.',
  resetSuccess: 'Password reset successful. Sign in with your new password.',
  emailInvalid: 'Enter a valid email address.',
  passwordMismatch: 'Those passwords do not match.',
} as const

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email(AUTH_MESSAGES.emailInvalid)

/**
 * Supabase Auth hashes with bcrypt, which only uses the first 72 bytes.
 * Rejecting longer passwords avoids storing something other than what was typed.
 */
export const passwordSchema = z
  .string()
  .min(8, 'Use at least 8 characters.')
  .max(72, 'Use at most 72 characters.')

export function loginFailureMessage(error: { message?: string; code?: string } | null): string {
  const code = error?.code ?? ''
  const message = error?.message ?? ''
  if (
    code === 'over_request_rate_limit' ||
    code === 'over_email_send_rate_limit' ||
    /rate limit/i.test(message)
  ) {
    return AUTH_MESSAGES.loginUnavailable
  }
  return AUTH_MESSAGES.invalidLogin
}

/** Internal paths only. An absolute URL here would be an open redirect. */
export function safeNextPath(value: string | null | undefined): string {
  if (!value) return '/'
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\') || value.includes('://')) {
    return '/'
  }
  return value
}

export function redactSecret(message: string, secret: string): string {
  if (!secret) return message
  return message.split(secret).join('[redacted]')
}
