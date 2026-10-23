#!/usr/bin/env node
/**
 * One-shot Supabase project setup via the Management API.
 *
 * Creates the dedicated project, waits for it to come up, retrieves the API
 * keys and connection string, writes them into .env.local, and applies the
 * migrations — so the only manual step is generating one access token.
 *
 * Prerequisite: put a personal access token in .env.local as
 *   SUPABASE_ACCESS_TOKEN=sbp_...
 * Generate one at https://supabase.com/dashboard/account/tokens
 *
 *   npm run db:setup
 *
 * Safe to re-run: if a project of the same name already exists it is adopted
 * rather than duplicated, and migrations skip anything already applied.
 */

import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const API = 'https://api.supabase.com/v1'
const PROJECT_NAME = process.env.SUPABASE_PROJECT_NAME || 'notofire-import-tower'
const REGION = process.env.SUPABASE_REGION || 'ap-south-1'
const ENV_PATH = '.env.local'

const token = process.env.SUPABASE_ACCESS_TOKEN

if (!token) {
  console.error(`
Missing SUPABASE_ACCESS_TOKEN.

  1. Go to https://supabase.com/dashboard/account/tokens
  2. Generate a new token (name it anything, e.g. "import-tower-setup")
  3. Add this line to .env.local:

       SUPABASE_ACCESS_TOKEN=sbp_xxxxxxxxxxxxxxxxxxxx

  4. Run this again:  npm run db:setup

The token is only used locally, by this script, to create the project.
`)
  process.exit(1)
}

async function api(path, options = {}) {
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  })

  const text = await response.text()
  let body
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }

  if (!response.ok) {
    const detail = typeof body === 'string' ? body : JSON.stringify(body)
    throw new Error(`${options.method ?? 'GET'} ${path} → ${response.status}: ${detail}`)
  }

  return body
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Strong random database password — no dictionary words, URL-safe. */
function generatePassword() {
  return randomBytes(24).toString('base64url')
}

/** Replace or append a KEY=value line, preserving the rest of the file. */
function upsertEnvLine(contents, key, value) {
  const line = `${key}=${value}`
  const pattern = new RegExp(`^${key}=.*$`, 'm')
  return pattern.test(contents)
    ? contents.replace(pattern, line)
    : `${contents.trimEnd()}\n${line}\n`
}

/**
 * Build the migration connection string.
 *
 * The pooler host and user are read from the API rather than assembled from a
 * template, because the host embeds the region (`aws-0-ap-south-1...`) and the
 * user is `postgres.<ref>`, not `postgres`. Port 5432 on the pooler is SESSION
 * mode; 6543 is transaction mode, which mishandles multi-statement DDL.
 *
 * The direct host `db.<ref>.supabase.co` is not used: on new projects it does
 * not resolve.
 */
async function buildDbUrl(ref, password) {
  const encoded = encodeURIComponent(password)

  try {
    const [pooler] = await api(`/projects/${ref}/config/database/pooler`)
    if (pooler?.db_host && pooler?.db_user) {
      return `postgresql://${pooler.db_user}:${encoded}@${pooler.db_host}:5432/${pooler.db_name ?? 'postgres'}`
    }
  } catch {
    // Fall through to the templated form below.
  }

  console.warn('Could not read pooler config; falling back to the templated host.')
  return `postgresql://postgres.${ref}:${encoded}@aws-0-${REGION}.pooler.supabase.com:5432/postgres`
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', shell: process.platform === 'win32' })
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`)),
    )
  })
}

try {
  // ---- Organisation --------------------------------------------------------
  const orgs = await api('/organizations')
  if (!orgs?.length) {
    throw new Error('This token has access to no organisations.')
  }

  // With more than one organisation, guessing is wrong: the project would land
  // in the wrong place for billing and access. Make the choice explicit.
  const wantedOrg = process.env.SUPABASE_ORG_ID
  let org

  if (wantedOrg) {
    org = orgs.find((o) => o.id === wantedOrg || o.name === wantedOrg)
    if (!org) {
      throw new Error(
        `SUPABASE_ORG_ID="${wantedOrg}" matches none of your organisations:\n` +
          orgs.map((o) => `  - ${o.name} (${o.id})`).join('\n'),
      )
    }
  } else if (orgs.length === 1) {
    org = orgs[0]
  } else {
    throw new Error(
      `You belong to ${orgs.length} organisations, so pick one deliberately.\n` +
        orgs.map((o) => `  - ${o.name} (${o.id})`).join('\n') +
        `\n\nAdd the one you want to .env.local and re-run:\n\n` +
        `  SUPABASE_ORG_ID=${orgs[0].id}\n`,
    )
  }

  console.log(`Organisation: ${org.name} (${org.id})`)

  // ---- Project -------------------------------------------------------------
  const projects = await api('/projects')
  let project = projects.find((p) => p.name === PROJECT_NAME)
  let dbPassword = process.env.SUPABASE_DB_PASSWORD

  if (project) {
    console.log(`Project "${PROJECT_NAME}" already exists (${project.id}) — adopting it.`)
    if (!dbPassword) {
      console.log(
        '\nNote: the database password is only shown at creation time. Because this\n' +
          'project already existed, SUPABASE_DB_URL cannot be built automatically.\n' +
          'Reset it in Dashboard → Settings → Database, then set SUPABASE_DB_PASSWORD\n' +
          'in .env.local and re-run.',
      )
    }
  } else {
    dbPassword = generatePassword()
    console.log(`Creating project "${PROJECT_NAME}" in ${REGION} …`)

    project = await api('/projects', {
      method: 'POST',
      body: JSON.stringify({
        name: PROJECT_NAME,
        organization_id: org.id,
        region: REGION,
        db_pass: dbPassword,
      }),
    })

    console.log(`Created. Ref: ${project.id}`)
  }

  const ref = project.id

  // ---- Wait for it to come up ---------------------------------------------
  process.stdout.write('Waiting for the project to become healthy ')
  const deadline = Date.now() + 6 * 60 * 1000

  let status = 'UNKNOWN'

  for (;;) {
    try {
      status = (await api(`/projects/${ref}`)).status
      if (status === 'ACTIVE_HEALTHY') break
    } catch (error) {
      // A freshly created project 404s for a few seconds before the API knows
      // about it. Only a timeout should end this loop, not a transient blip.
      if (Date.now() > deadline) throw error
    }

    if (Date.now() > deadline) {
      throw new Error(`Project stuck in status ${status} after 6 minutes.`)
    }

    process.stdout.write('.')
    await sleep(5000)
  }
  console.log(' ready.')

  // ---- Keys ----------------------------------------------------------------
  // Newer Management API versions mask secret keys unless ?reveal=true is asked
  // for; older ones do not know the parameter. Try the modern form, fall back.
  let keys
  try {
    keys = await api(`/projects/${ref}/api-keys?reveal=true`)
  } catch {
    keys = await api(`/projects/${ref}/api-keys`)
  }

  const anonKey = keys.find((k) => k.name === 'anon')?.api_key
  const serviceKey = keys.find((k) => k.name === 'service_role')?.api_key

  if (!anonKey || !serviceKey) {
    throw new Error(
      'Could not read the anon / service_role keys from the API.\n' +
        'Copy them from Dashboard → Project Settings → API into .env.local instead.',
    )
  }

  // ---- Write .env.local ----------------------------------------------------
  let env = existsSync(ENV_PATH) ? await readFile(ENV_PATH, 'utf8') : ''

  env = upsertEnvLine(env, 'NEXT_PUBLIC_SUPABASE_URL', `https://${ref}.supabase.co`)
  env = upsertEnvLine(env, 'NEXT_PUBLIC_SUPABASE_ANON_KEY', anonKey)
  env = upsertEnvLine(env, 'SUPABASE_SERVICE_ROLE_KEY', serviceKey)

  if (dbPassword) {
    env = upsertEnvLine(env, 'SUPABASE_DB_PASSWORD', dbPassword)
    env = upsertEnvLine(env, 'SUPABASE_DB_URL', await buildDbUrl(ref, dbPassword))
  }

  await writeFile(ENV_PATH, env, 'utf8')
  console.log(`\nWrote credentials to ${ENV_PATH} (gitignored).`)

  // ---- Migrations ----------------------------------------------------------
  if (dbPassword) {
    // The child inherits this process's environment, which already contains the
    // EMPTY placeholder values dotenv read at startup. dotenv will not override
    // a variable that is already set, so without this the child would see
    // SUPABASE_DB_URL="" and refuse to run — even though the file is correct.
    process.env.NEXT_PUBLIC_SUPABASE_URL = `https://${ref}.supabase.co`
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = anonKey
    process.env.SUPABASE_SERVICE_ROLE_KEY = serviceKey
    process.env.SUPABASE_DB_PASSWORD = dbPassword
    process.env.SUPABASE_DB_URL = await buildDbUrl(ref, dbPassword)

    console.log('\nApplying migrations …')
    await run('node', ['scripts/apply-migrations.mjs'])

    // Without this the project ships with signups OPEN, which would let anyone
    // request a working sign-in link and walk straight past the gate.
    console.log('\nConfiguring auth …')
    await run('node', ['scripts/configure-auth.mjs'])
  }


  console.log(`
Done.

  Project   ${PROJECT_NAME}
  Ref       ${ref}
  URL       https://${ref}.supabase.co
  Dashboard https://supabase.com/dashboard/project/${ref}

Next:  set INITIAL_ADMIN_EMAIL and INITIAL_ADMIN_PASSWORD, then
       npm run auth:seed
       npm run dev
Log in with that email and password.
`)
} catch (error) {
  console.error(`\nSetup failed: ${error.message}`)
  process.exitCode = 1
}
