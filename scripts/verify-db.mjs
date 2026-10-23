#!/usr/bin/env node
/**
 * Confirm the live database matches what the migrations intended.
 *
 * Distinct from the PGlite tests, which prove the SQL is correct in isolation.
 * This proves it actually landed on the real project: tables present, RLS on
 * every one of them, seed data in place, and the alert engine answering.
 *
 *   npm run db:verify
 */

import postgres from 'postgres'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local', override: true })

const connectionString = process.env.SUPABASE_DB_URL
if (!connectionString) {
  console.error('SUPABASE_DB_URL is not set. Run `npm run db:setup` first.')
  process.exit(1)
}

const sql = postgres(connectionString, { max: 1, onnotice: () => {} })

const EXPECTED_TABLES = [
  'profiles', 'password_reset_tokens', 'companies', 'app_settings', 'audit_log', 'activity_log',
  'import_sequences', 'po_sequences', 'suppliers', 'imports', 'import_items',
  'supplier_contacts', 'supplier_bank_accounts', 'chas', 'cha_agents',
  'import_payments', 'refunds', 'document_types', 'documents',
  'document_type_map', 'document_versions', 'checklist_templates',
  'checklist_template_items', 'document_checklist',
  'production_updates', 'shipments', 'customs_records', 'delivery_records',
  'tasks', 'task_comments', 'email_templates', 'email_drafts',
  'import_costs', 'warning_overrides',
  'communications', 'communication_attachments', 'communication_parses',
  'communication_parse_members', 'communication_suggestions',
  'freight_charge_types', 'freight_quote_sequences', 'freight_quote_requests',
  'freight_quote_fx_rates', 'freight_quote_request_recipients',
  'freight_quotes', 'freight_quote_charges',
]

const EXPECTED_VIEWS = [
  'v_alerts', 'v_import_summary', 'v_payment_totals',
  'v_document_checklist', 'v_verification_queue',
  'v_shipment_board', 'v_shipment_totals', 'v_gate_pressure', 'v_customs_totals',
  'v_landed_cost', 'v_landed_cost_by_currency', 'v_import_cost_lines',
  'v_report_status_summary', 'v_report_payment_summary',
  'v_report_supplier_performance', 'v_report_shipping_performance',
  'v_report_customs_summary', 'v_report_monthly_volume',
  'v_report_document_compliance', 'v_communication_inbox',
  'v_freight_quote_requests',
]

let failures = 0

function check(label, ok, detail = '') {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures += 1
}

try {
  console.log('\nTables')
  const tables = (
    await sql`select table_name from information_schema.tables
              where table_schema = 'public' and table_type = 'BASE TABLE'`
  ).map((r) => r.table_name)

  const missing = EXPECTED_TABLES.filter((t) => !tables.includes(t))
  check(`${EXPECTED_TABLES.length} expected tables`, missing.length === 0, missing.join(', '))

  console.log('\nViews')
  const views = (
    await sql`select table_name from information_schema.views where table_schema = 'public'`
  ).map((r) => r.table_name)

  const missingViews = EXPECTED_VIEWS.filter((v) => !views.includes(v))
  check(`${EXPECTED_VIEWS.length} expected views`, missingViews.length === 0, missingViews.join(', '))

  console.log('\nRow Level Security')
  const unprotected = (
    await sql`select relname from pg_class c
              join pg_namespace n on n.oid = c.relnamespace
              where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`
  ).map((r) => r.relname)

  check('RLS enabled on every table', unprotected.length === 0, unprotected.join(', '))

  console.log('\nSeed data')
  // Seeded records must still be there; extras are the point. Companies, CHAs
  // and checklist templates are all master data the operator adds to, so an
  // equality check here fails the first time the app is used as designed.
  const [{ count: companies }] = await sql`select count(*)::int from companies`
  check('importing entities present', companies >= 3, `found ${companies}`)

  const [{ count: settings }] = await sql`select count(*)::int from app_settings`
  check('configuration seeded', settings > 0, `${settings} settings`)

  const [{ count: docTypes }] = await sql`select count(*)::int from document_types`
  check('document types seeded', docTypes > 30, `${docTypes} types`)

  const [{ count: templates }] = await sql`select count(*)::int from checklist_templates`
  check('checklist templates seeded', templates >= 3, `found ${templates}`)

  const [{ count: chas }] = await sql`select count(*)::int from chas`
  check('clearing agents seeded', chas >= 3, `found ${chas}`)

  const [{ count: emailTemplates }] = await sql`select count(*)::int from email_templates`
  check('email templates seeded', emailTemplates >= 5, `${emailTemplates} templates`)

  const [{ count: chargeTypes }] = await sql`select count(*)::int from freight_charge_types`
  check('freight charge types seeded', chargeTypes >= 14, `${chargeTypes} types`)

  console.log('\nFunctions')
  const [{ next_import_no: importNo }] = await sql`select next_import_no(2026)`
  check('import number allocation', /^IMP-2026-\d{4}$/.test(importNo), importNo)

  const [{ next_quote_request_no: quoteNo }] = await sql`select next_quote_request_no(2026)`
  check('quote request number allocation', /^FQR-2026-\d{4}$/.test(quoteNo), quoteNo)

  console.log('\nViews answer')
  const [{ count: alerts }] = await sql`select count(*)::int from v_alerts`
  check('v_alerts queryable', Number.isInteger(alerts), `${alerts} alerts`)

  const [{ count: queue }] = await sql`select count(*)::int from v_verification_queue`
  check('v_verification_queue queryable', Number.isInteger(queue), `${queue} items`)

  const [{ count: board }] = await sql`select count(*)::int from v_shipment_board`
  check('v_shipment_board queryable', Number.isInteger(board), `${board} shipments`)

  const [{ count: landed }] = await sql`select count(*)::int from v_landed_cost`
  check('v_landed_cost queryable', Number.isInteger(landed), `${landed} imports`)

  const [{ count: report }] = await sql`select count(*)::int from v_report_supplier_performance`
  check('reporting views queryable', Number.isInteger(report), `${report} suppliers`)

  const [{ count: applied }] = await sql`select count(*)::int from schema_migrations`
  console.log(`\n${applied} migration(s) recorded.`)

  if (failures > 0) {
    console.error(`\n${failures} check(s) failed.`)
    process.exitCode = 1
  } else {
    console.log('\nEverything checks out.')
  }
} catch (error) {
  console.error(`\nVerification failed: ${error.message}`)
  process.exitCode = 1
} finally {
  await sql.end()
}
