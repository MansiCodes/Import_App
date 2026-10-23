#!/usr/bin/env node
/**
 * Inspect or remove Supabase auth users.
 *
 * Sign-in is email and password. This script no longer creates accounts,
 * because a passwordless user cannot log in. Seed the first admin with
 * `npm run auth:seed`, then add people from Settings.
 *
 *   npm run auth:allow -- --list
 *   npm run auth:allow -- --revoke someone@example.com
 */

import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local', override: true })

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !serviceKey) {
  console.error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local.')
  process.exit(1)
}

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const args = process.argv.slice(2)

async function list() {
  const { data, error } = await supabase.auth.admin.listUsers()
  if (error) throw new Error(error.message)

  if (data.users.length === 0) {
    console.log('No addresses are authorised — nobody can sign in.')
    return
  }

  console.log(`${data.users.length} address(es) authorised:`)
  for (const user of data.users) {
    const seen = user.last_sign_in_at
      ? `last signed in ${new Date(user.last_sign_in_at).toLocaleDateString('en-IN')}`
      : 'never signed in'
    console.log(`  ${user.email}  (${seen})`)
  }
}

async function revoke(email) {
  const { data, error } = await supabase.auth.admin.listUsers()
  if (error) throw new Error(error.message)

  const user = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())
  if (!user) {
    console.error(`${email} is not authorised, so there is nothing to revoke.`)
    process.exitCode = 1
    return
  }

  const { error: deleteError } = await supabase.auth.admin.deleteUser(user.id)
  if (deleteError) throw new Error(deleteError.message)

  console.log(`Revoked ${email}. Existing sessions stay valid until they expire.`)
}

async function authorize() {
  console.error('This command no longer creates a passwordless account.')
  console.error('Seed the first admin with:  npm run auth:seed')
  console.error('Add further users from Settings after you log in.')
  process.exitCode = 1
}

try {
  if (args.length === 0 || args[0] === '--list') {
    await list()
  } else if (args[0] === '--revoke') {
    if (!args[1]) throw new Error('Give an address to revoke.')
    await revoke(args[1])
  } else {
    await authorize()
  }
} catch (error) {
  console.error(`Failed: ${error.message}`)
  process.exitCode = 1
}
