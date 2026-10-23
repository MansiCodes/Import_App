import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { createAuthClient } from '@/lib/supabase/auth'
import { AUTH_MESSAGES, emailSchema, passwordSchema } from '@/lib/auth/credentials'
import { findAuthUserByEmail } from '@/lib/auth/accounts'
import {
  RESET_TOKEN_TTL_MS,
  generateResetToken,
  hashResetToken,
  isResetToken,
} from '@/lib/auth/reset-token'

export interface ResetRequestResult {
  ok: boolean
  message?: string
  error?: string
}

export interface ResetCompleteResult {
  ok: boolean
  error?: string
}

type SendReset = (to: string, link: string) => Promise<void>

/**
 * Start a reset. Unknown addresses get the same success result as known ones.
 * The raw token is handed to `send` and is not returned, stored, or logged.
 */
export async function issuePasswordReset(
  emailInput: string,
  origin: string,
  send: SendReset,
  supabase?: SupabaseClient,
): Promise<ResetRequestResult> {
  const email = emailSchema.safeParse(emailInput)
  if (!email.success) {
    return { ok: false, error: AUTH_MESSAGES.emailInvalid }
  }

  const client = supabase ?? (await createClient(null))

  try {
    const user = await findAuthUserByEmail(client, email.data)
    if (!user?.email) {
      return { ok: true, message: AUTH_MESSAGES.resetSent }
    }

    const { data: profile, error: profileError } = await client
      .from('profiles')
      .select('is_active')
      .eq('id', user.id)
      .maybeSingle()

    if (profileError) {
      console.error('Password reset failed')
      return { ok: false, error: AUTH_MESSAGES.resetUnavailable }
    }

    if (!profile?.is_active) {
      return { ok: true, message: AUTH_MESSAGES.resetSent }
    }

    const now = Date.now()
    await client
      .from('password_reset_tokens')
      .delete()
      .lt('expires_at', new Date(now - 24 * 60 * 60 * 1000).toISOString())

    await client
      .from('password_reset_tokens')
      .update({ used_at: new Date(now).toISOString() })
      .eq('user_id', user.id)
      .is('used_at', null)

    const token = generateResetToken()
    const tokenHash = hashResetToken(token)
    const { error: insertError } = await client.from('password_reset_tokens').insert({
      user_id: user.id,
      token_hash: tokenHash,
      expires_at: new Date(now + RESET_TOKEN_TTL_MS).toISOString(),
    })

    if (insertError) {
      console.error('Password reset failed')
      return { ok: false, error: AUTH_MESSAGES.resetUnavailable }
    }

    const link = `${origin.replace(/\/$/, '')}/reset-password?token=${encodeURIComponent(token)}`

    try {
      await send(user.email, link)
    } catch {
      await client.from('password_reset_tokens').delete().eq('token_hash', tokenHash)
      console.error('Password reset failed')
      return { ok: false, error: AUTH_MESSAGES.resetUnavailable }
    }

    return { ok: true, message: AUTH_MESSAGES.resetSent }
  } catch {
    console.error('Password reset failed')
    return { ok: false, error: AUTH_MESSAGES.resetUnavailable }
  }
}

/**
 * Consume a reset token and set a new password.
 *
 * The update that stamps used_at is conditional, so two requests with the same
 * token cannot both succeed. The password is passed to Supabase Auth, which
 * stores a bcrypt hash. The hash is not read back.
 */
export async function completePasswordReset(
  token: string,
  password: string,
  confirm: string,
  supabase?: SupabaseClient,
): Promise<ResetCompleteResult> {
  if (!isResetToken(token)) {
    return { ok: false, error: AUTH_MESSAGES.resetExpired }
  }

  const parsedPassword = passwordSchema.safeParse(password)
  if (!parsedPassword.success) {
    return {
      ok: false,
      error: parsedPassword.error.issues[0]?.message ?? AUTH_MESSAGES.resetUnavailable,
    }
  }

  if (password !== confirm) {
    return { ok: false, error: AUTH_MESSAGES.passwordMismatch }
  }

  const client = supabase ?? (await createClient(null))
  const tokenHash = hashResetToken(token)

  const { data: consumed, error: consumeError } = await client
    .from('password_reset_tokens')
    .update({ used_at: new Date().toISOString() })
    .eq('token_hash', tokenHash)
    .is('used_at', null)
    .gt('expires_at', new Date().toISOString())
    .select('user_id')
    .maybeSingle()

  if (consumeError || !consumed?.user_id) {
    return { ok: false, error: AUTH_MESSAGES.resetExpired }
  }

  const { data: existing, error: readError } = await client.auth.admin.getUserById(consumed.user_id)
  if (readError || !existing.user) {
    console.error('Password reset failed')
    return { ok: false, error: AUTH_MESSAGES.resetUnavailable }
  }

  const { error: updateError } = await client.auth.admin.updateUserById(consumed.user_id, {
    password,
    email_confirm: true,
    app_metadata: { ...(existing.user.app_metadata ?? {}), password_login: true },
  })

  if (updateError) {
    console.error('Password reset failed')
    return { ok: false, error: AUTH_MESSAGES.resetUnavailable }
  }

  try {
    const auth = await createAuthClient()
    await auth.auth.signOut()
  } catch {
    // Cookie writes only exist inside a request. The password change already
    // succeeded; a missing session is not a failure.
  }

  return { ok: true }
}
