#!/usr/bin/env node
/**
 * Apply SQL migrations in order against the Supabase Postgres database.
 *
 * Uses a direct connection rather than the Supabase CLI so there is nothing
 * extra to install.
 *
 * Connect through the Supavisor pooler in SESSION mode (port 5432). On this
 * project the direct host `db.<ref>.supabase.co` does not resolve at all, and
 * the pooler works — the opposite of what the sibling Notofire project needed.
 * Use session mode, not transaction mode (6543): migrations run multi-statement
 * DDL, which transaction pooling mishandles.
 *
 * Migrations are recorded in `schema_migrations`, so re-running is safe: only
 * files that have not been applied are executed.
 *
 *   npm run db:apply
 *   npm run db:apply -- --dry-run
 */

import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import postgres from 'postgres'
import dotenv from 'dotenv'

// Prefer .env.local (Next convention); fall back to .env for local clones.
dotenv.config({ path: '.env.local' })
dotenv.config({ path: '.env' })

const MIGRATIONS_DIR = fileURLToPath(new URL('../supabase/migrations', import.meta.url))
const dryRun = process.argv.includes('--dry-run')

const connectionString = process.env.SUPABASE_DB_URL?.trim()

if (!connectionString) {
  console.error(
    'SUPABASE_DB_URL is not set.\n' +
      'Add it to .env or .env.local — Supabase → Project Settings → Database →\n' +
      'Connection string → URI (use Session pooler, port 5432).\n' +
      'Example:\n' +
      '  SUPABASE_DB_URL="postgresql://postgres.cpphzhifogmpknnodckp:YOUR_PASSWORD@aws-0-….pooler.supabase.com:5432/postgres"',
  )
  process.exit(1)
}

if (connectionString.includes('pooler.supabase.com:6543')) {
  console.warn(
    'Warning: port 6543 is the pooler in TRANSACTION mode, which mishandles the\n' +
      'multi-statement DDL in these migrations. Use port 5432 (session mode) on the\n' +
      'same pooler host.\n',
  )
}

const sql = postgres(connectionString, { max: 1, onnotice: () => {} })

try {
  await sql`
    create table if not exists schema_migrations (
      filename    text primary key,
      applied_at  timestamptz not null default now()
    )
  `

  // RLS with NO policy: this table is deployment infrastructure, not app data,
  // so nothing should reach it through PostgREST. Without this it is readable
  // by anyone holding the anon key, which the browser has. Migrations
  // themselves connect directly and bypass RLS.
  await sql`alter table schema_migrations enable row level security`

  const applied = new Set(
    (await sql`select filename from schema_migrations`).map((row) => row.filename),
  )

  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort()

  if (files.length === 0) {
    console.log('No migration files found.')
    process.exit(0)
  }

  let ran = 0

  for (const file of files) {
    if (applied.has(file)) {
      console.log(`  skip  ${file} (already applied)`)
      continue
    }

    const contents = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8')

    if (dryRun) {
      console.log(`  would apply  ${file} (${contents.length} bytes)`)
      ran++
      continue
    }

    process.stdout.write(`  apply ${file} … `)

    // Each migration runs in one transaction, so a failure half-way leaves the
    // database untouched rather than partially migrated.
    await sql.begin(async (tx) => {
      await tx.unsafe(contents)
      await tx`insert into schema_migrations (filename) values (${file})`
    })

    console.log('done')
    ran++
  }

  console.log(
    ran === 0
      ? '\nDatabase is already up to date.'
      : `\n${dryRun ? 'Would apply' : 'Applied'} ${ran} migration(s).`,
  )
} catch (error) {
  console.error('\nMigration failed:', error.message)
  process.exitCode = 1
} finally {
  await sql.end()
}
