#!/usr/bin/env node
/**
 * Configure the Supabase project's auth settings for this app.
 *
 * A new project gets three things wrong for a gated, server-rendered app:
 *
 *   1. SIGNUPS ARE OPEN. Left alone, anyone could register with the public anon
 *      key. Signups are disabled here. Accounts are created by `npm run auth:seed`
 *      and, after that, by an admin in Settings.
 *
 *   2. THE MAGIC-LINK TEMPLATE USES `{{ .ConfirmationURL }}`, which lands the
 *      session in a URL fragment. Fragments never reach the server, so the
 *      callback sees nothing and sign-in dead-ends with "that link was
 *      incomplete". The template is repointed at /auth/confirm with
 *      `{{ .TokenHash }}`, which arrives as a normal query parameter.
 *
 *   3. `uri_allow_list` IS EMPTY, so any emailRedirectTo the app asks for is
 *      ignored in favour of the site URL.
 *
 *   npm run auth:configure
 *   npm run auth:configure -- https://imports.example.com
 */

import dotenv from 'dotenv'

dotenv.config({ path: '.env.local', override: true })

const token = process.env.SUPABASE_ACCESS_TOKEN
const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL

if (!token || !projectUrl) {
  console.error('SUPABASE_ACCESS_TOKEN and NEXT_PUBLIC_SUPABASE_URL must be set in .env.local.')
  process.exit(1)
}

const ref = projectUrl.match(/https:\/\/([^.]+)\./)?.[1]
const siteUrl = (process.argv[2] ?? 'http://localhost:3000').replace(/\/$/, '')

// Localhost stays allowed even once a production URL is set, so the same
// project still works for local development.
const allowList = [...new Set([`${siteUrl}/**`, 'http://localhost:3000/**'])].join(',')

const magicLinkTemplate = `<h2>Your sign-in link</h2>

<p>Follow the link below to sign in. It expires shortly and can only be used once.</p>
<p><a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=magiclink">Sign in</a></p>

<p>If you did not request this, you can ignore this email — the link is useless without your inbox.</p>`

async function patch(body) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  return { ok: response.ok, status: response.status, text: await response.text() }
}

// The settings that actually gate access. These work on every plan.
const core = await patch({
  site_url: siteUrl,
  uri_allow_list: allowList,
  disable_signup: true,
  mailer_otp_exp: 3600,
})

if (!core.ok) {
  console.error(`Failed (${core.status}): ${core.text}`)
  process.exitCode = 1
} else {
  console.log('Auth configured.')
  console.log(`  site url     ${siteUrl}`)
  console.log(`  allow list   ${allowList}`)
  console.log('  signups      DISABLED — only authorised addresses can sign in')

  // Applied separately because Supabase rejects template changes on the free
  // tier with the built-in mail provider. That is not fatal: the app's callback
  // handles the DEFAULT template too (PKCE, ?code=…), so sign-in works either
  // way. This just makes the email nicer once custom SMTP exists.
  const template = await patch({
    mailer_subjects_magic_link: 'Your sign-in link',
    mailer_templates_magic_link_content: magicLinkTemplate,
  })

  if (template.ok) {
    console.log('  email        legacy magic-link template updated')
  } else {
    console.log('  email        login does not use the built-in sender')
  }

  console.log('\nSeed the first admin with INITIAL_ADMIN_EMAIL and INITIAL_ADMIN_PASSWORD:')
  console.log('  npm run auth:seed')
}
