/**
 * Exercises the real Supabase project. Skipped unless AUTH_LIVE_TEST=1 so a
 * normal `npm test` never creates or deletes users.
 */
import { randomBytes } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import { afterAll, describe, expect, it } from 'vitest'
import { AUTH_MESSAGES } from '@/lib/auth/credentials'
import { hashResetToken } from '@/lib/auth/reset-token'
import { completePasswordReset, issuePasswordReset } from '@/lib/auth/reset'

dotenv.config({
  path: path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../.env.local'),
})

const live = process.env.AUTH_LIVE_TEST === '1'
const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

describe.skipIf(!live || !url || !anonKey || !serviceKey)('password authentication', () => {
  const admin = createClient(url!, serviceKey!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const anon = createClient(url!, anonKey!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const created: string[] = []

  afterAll(async () => {
    for (const id of created) {
      await admin.from('password_reset_tokens').delete().eq('user_id', id)
      await admin.from('profiles').delete().eq('id', id)
      await admin.auth.admin.deleteUser(id)
    }
  })

  async function makeUser(password: string, role: 'admin' | 'viewer' = 'viewer') {
    const email = `auth-check-${randomBytes(6).toString('hex')}@example.com`
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      app_metadata: { password_login: true },
    })
    if (error || !data.user) throw new Error(error?.message ?? 'create failed')
    created.push(data.user.id)

    const { error: profileError } = await admin.from('profiles').insert({
      id: data.user.id,
      email,
      full_name: 'Auth Check',
      role,
      is_active: true,
    })
    if (profileError) throw new Error(profileError.message)

    return { id: data.user.id, email, password }
  }

  function tokenFrom(link: string): string {
    const token = new URL(link).searchParams.get('token')
    if (!token) throw new Error('reset link had no token')
    return token
  }

  it('signs in with a password and rejects the wrong one', async () => {
    const user = await makeUser(`pw-${randomBytes(9).toString('hex')}`)

    const bad = await anon.auth.signInWithPassword({
      email: user.email,
      password: `nope-${randomBytes(9).toString('hex')}`,
    })
    expect(bad.error).toBeTruthy()

    const unknown = await anon.auth.signInWithPassword({
      email: `missing-${randomBytes(6).toString('hex')}@example.com`,
      password: user.password,
    })
    expect(unknown.error).toBeTruthy()
    expect(unknown.error?.message).toBe(bad.error?.message)

    const good = await anon.auth.signInWithPassword({
      email: user.email,
      password: user.password,
    })
    expect(good.error).toBeNull()
    expect(good.data.user?.email).toBe(user.email)
    await anon.auth.signOut()
  })

  it('resets a password with a single-use token and rejects a bad one', async () => {
    const user = await makeUser(`old-${randomBytes(9).toString('hex')}`)
    const nextPassword = `new-${randomBytes(9).toString('hex')}`
    let sent: string | null = null

    const missing = await issuePasswordReset(
      `missing-${randomBytes(6).toString('hex')}@example.com`,
      'http://localhost:3000',
      async () => {
        throw new Error('should not send')
      },
      admin as SupabaseClient,
    )
    expect(missing).toEqual({ ok: true, message: AUTH_MESSAGES.resetSent })

    const issued = await issuePasswordReset(
      user.email,
      'http://localhost:3000',
      async (_to, link) => {
        sent = link
      },
      admin as SupabaseClient,
    )
    expect(issued.ok).toBe(true)
    expect(sent).toBeTruthy()

    const token = tokenFrom(sent!)
    const mismatch = await completePasswordReset(token, nextPassword, 'different-password-1', admin)
    expect(mismatch).toEqual({ ok: false, error: AUTH_MESSAGES.passwordMismatch })

    const expiredToken = randomBytes(32).toString('base64url')
    await admin.from('password_reset_tokens').insert({
      user_id: user.id,
      token_hash: hashResetToken(expiredToken),
      expires_at: new Date(Date.now() - 60_000).toISOString(),
    })
    const expired = await completePasswordReset(expiredToken, nextPassword, nextPassword, admin)
    expect(expired).toEqual({ ok: false, error: AUTH_MESSAGES.resetExpired })

    const stillOld = await anon.auth.signInWithPassword({
      email: user.email,
      password: user.password,
    })
    expect(stillOld.error).toBeNull()
    await anon.auth.signOut()

    const done = await completePasswordReset(token, nextPassword, nextPassword, admin)
    expect(done).toEqual({ ok: true })

    const reused = await completePasswordReset(token, nextPassword, nextPassword, admin)
    expect(reused).toEqual({ ok: false, error: AUTH_MESSAGES.resetExpired })

    const oldPassword = await anon.auth.signInWithPassword({
      email: user.email,
      password: user.password,
    })
    expect(oldPassword.error).toBeTruthy()

    const changed = await anon.auth.signInWithPassword({
      email: user.email,
      password: nextPassword,
    })
    expect(changed.error).toBeNull()
    await anon.auth.signOut()
  })

  it('lets a second user sign in without affecting the first', async () => {
    const first = await makeUser(`first-${randomBytes(9).toString('hex')}`, 'admin')
    const second = await makeUser(`second-${randomBytes(9).toString('hex')}`, 'viewer')

    const a = await anon.auth.signInWithPassword({ email: first.email, password: first.password })
    expect(a.error).toBeNull()
    await anon.auth.signOut()

    const b = await anon.auth.signInWithPassword({ email: second.email, password: second.password })
    expect(b.error).toBeNull()
    await anon.auth.signOut()

    const again = await anon.auth.signInWithPassword({ email: first.email, password: first.password })
    expect(again.error).toBeNull()
    await anon.auth.signOut()
  })
})
