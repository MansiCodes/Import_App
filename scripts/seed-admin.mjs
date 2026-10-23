#!/usr/bin/env node
/**
 * Create or update the single initial admin.
 *
 * The password is read from the environment and handed to Supabase Auth, which
 * stores a bcrypt hash. This script never writes the password into source, the
 * database, or its own output.
 *
 *   INITIAL_ADMIN_EMAIL=admin@example.com
 *   INITIAL_ADMIN_PASSWORD=...
 *   npm run auth:seed
 *
 * Running it again does not create a second user. The password is set when the
 * account is first prepared for password login, and left alone after that.
 * Pass --reset-password to replace it from INITIAL_ADMIN_PASSWORD.
 */

import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local', override: true })

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const email = process.env.INITIAL_ADMIN_EMAIL?.trim().toLowerCase() ?? ''
const password = process.env.INITIAL_ADMIN_PASSWORD ?? ''
const fullName = process.env.INITIAL_ADMIN_NAME?.trim() || 'Admin'
const resetPassword = process.argv.includes('--reset-password')

function fail(message) {
  console.error(message)
  process.exit(1)
}

function safe(message) {
  if (!password) return message
  return String(message).split(password).join('[redacted]')
}

if (!url || !serviceKey) {
  fail('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local.')
}

if (!email || !password) {
  fail('Set INITIAL_ADMIN_EMAIL and INITIAL_ADMIN_PASSWORD in .env.local, then re-run.')
}

if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
  fail('INITIAL_ADMIN_EMAIL is not a valid email address.')
}

if (password.length < 8 || password.length > 72) {
  fail('INITIAL_ADMIN_PASSWORD must be 8 to 72 characters.')
}

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

async function findUser(target) {
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 })
    if (error) throw new Error(error.message)
    const found = data.users.find((user) => user.email?.toLowerCase() === target)
    if (found) return found
    if (data.users.length < 200) return null
  }
  return null
}

async function ensureProfile(userId) {
  const { data: existing, error: readError } = await supabase
    .from('profiles')
    .select('id')
    .eq('id', userId)
    .maybeSingle()
  if (readError) throw new Error(readError.message)

  if (!existing) {
    const { error } = await supabase.from('profiles').insert({
      id: userId,
      email,
      full_name: fullName,
      role: 'admin',
      is_active: true,
    })
    if (error) throw new Error(error.message)
    return
  }

  const { error } = await supabase
    .from('profiles')
    .update({ email, role: 'admin', is_active: true })
    .eq('id', userId)
  if (error) throw new Error(error.message)
}

try {
  let user = await findUser(email)
  let passwordUpdated = false

  if (!user) {
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
      app_metadata: { password_login: true },
    })
    if (error) throw new Error(error.message)
    user = data.user
    passwordUpdated = true
  } else if (resetPassword || user.app_metadata?.password_login !== true) {
    const { error } = await supabase.auth.admin.updateUserById(user.id, {
      password,
      email_confirm: true,
      app_metadata: { ...(user.app_metadata ?? {}), password_login: true },
    })
    if (error) throw new Error(error.message)
    passwordUpdated = true
  }

  await ensureProfile(user.id)

  console.log(`Initial admin ready: ${email}`)
  if (passwordUpdated) {
    console.log('Password set from INITIAL_ADMIN_PASSWORD. The value was not printed.')
  } else {
    console.log('Account already had a password. It was left unchanged.')
    console.log('Re-run with --reset-password to replace it from INITIAL_ADMIN_PASSWORD.')
  }
} catch (error) {
  console.error(`Failed: ${safe(error instanceof Error ? error.message : error)}`)
  process.exitCode = 1
}
