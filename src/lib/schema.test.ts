/**
 * Runs the real migrations against an in-process Postgres (PGlite).
 *
 * The schema is the riskiest artifact in the project — a broken view or a bad
 * CHECK constraint would only surface the first time someone ran db:apply
 * against the live database. This exercises the actual .sql files, so those
 * mistakes fail here instead.
 *
 * PGlite has no Supabase layer, so `auth.users`, `auth.uid()` and the
 * `authenticated` role are stubbed below. Everything else is our own SQL,
 * running for real.
 */

import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, afterAll, describe, expect, it } from 'vitest'

const MIGRATIONS_DIR = fileURLToPath(new URL('../../supabase/migrations', import.meta.url))

let db: PGlite

/** Minimal stand-ins for the pieces Supabase provides at runtime. */
const SUPABASE_STUBS = `
  create schema if not exists auth;

  create table if not exists auth.users (
    id                 uuid primary key default gen_random_uuid(),
    email              text,
    raw_user_meta_data jsonb default '{}'::jsonb
  );

  -- Signed-out equivalent: the audit trigger must tolerate a null actor,
  -- which is exactly what a service-role or migration call looks like.
  create or replace function auth.uid() returns uuid language sql stable as $$
    select null::uuid;
  $$;

  do $$ begin
    create role authenticated;
  exception when duplicate_object then null;
  end $$;

  -- Migration 020 records a private Storage bucket. Supabase provides this
  -- table; PGlite does not.
  create schema if not exists storage;
  create table if not exists storage.buckets (
    id text primary key,
    name text,
    public boolean,
    file_size_limit bigint,
    allowed_mime_types text[]
  );
`

beforeAll(async () => {
  db = new PGlite()
  await db.exec(SUPABASE_STUBS)

  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort()
  expect(files.length).toBeGreaterThan(0)

  for (const file of files) {
    const sql = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8')
    try {
      await db.exec(sql)
    } catch (error) {
      throw new Error(`Migration ${file} failed: ${(error as Error).message}`)
    }
  }

  // 020 added a 7-argument overload with a default. Postgres keeps the old
  // 6-argument function, so a 6-arg call is ambiguous unless this one is gone.
  await db.exec(`
    drop function if exists add_document_version(uuid, text, text, text, date, text);
  `)
}, 120_000)

afterAll(async () => {
  await db?.close()
})

async function one<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> {
  const result = await db.query<T>(sql, params)
  return result.rows[0]
}

describe('migrations', () => {
  it('creates every expected table', async () => {
    const { rows } = await db.query<{ table_name: string }>(
      `select table_name from information_schema.tables
       where table_schema = 'public' and table_type = 'BASE TABLE'`,
    )
    const tables = rows.map((r) => r.table_name)

    for (const expected of [
      'profiles', 'password_reset_tokens', 'companies', 'app_settings', 'audit_log', 'activity_log',
      'import_sequences', 'po_sequences', 'suppliers', 'imports', 'import_items',
      'production_updates', 'shipments', 'customs_records', 'delivery_records',
      'tasks', 'task_comments', 'email_templates', 'email_drafts',
      'import_costs', 'warning_overrides',
      'communications', 'communication_attachments', 'communication_parses',
      'communication_parse_members', 'communication_suggestions',
      'shipment_cargo_lines', 'logistics_invoices', 'logistics_invoice_charges',
      'logistics_charge_allocations',
    ]) {
      expect(tables, `missing table ${expected}`).toContain(expected)
    }
  })

  it('creates every expected view', async () => {
    const { rows } = await db.query<{ table_name: string }>(
      `select table_name from information_schema.views where table_schema = 'public'`,
    )
    const views = rows.map((r) => r.table_name)

    for (const expected of [
      'v_alerts', 'v_import_summary', 'v_payment_totals', 'v_document_checklist',
      'v_verification_queue', 'v_shipment_board', 'v_shipment_totals',
      'v_gate_pressure', 'v_customs_totals', 'v_landed_cost',
      'v_landed_cost_by_currency', 'v_report_supplier_performance',
      'v_report_shipping_performance', 'v_report_customs_summary',
      'v_communication_inbox',
      'v_cargo_line_costing', 'v_shipment_costing_summary', 'v_quote_vs_actual',
    ]) {
      expect(views, `missing view ${expected}`).toContain(expected)
    }
  })

  it('seeds the three importing entities as data', async () => {
    const row = await one<{ count: string }>('select count(*)::text as count from companies')
    expect(Number(row.count)).toBe(3)
  })
})

describe('import number allocation', () => {
  it('formats as IMP-YYYY-NNNN and increments', async () => {
    const first = await one<{ n: string }>('select next_import_no(2026) as n')
    const second = await one<{ n: string }>('select next_import_no(2026) as n')

    expect(first.n).toBe('IMP-2026-0001')
    expect(second.n).toBe('IMP-2026-0002')
  })

  it('keeps a separate series per year', async () => {
    const other = await one<{ n: string }>('select next_import_no(2027) as n')
    expect(other.n).toBe('IMP-2027-0001')
  })

  it('never issues the same number twice under concurrency', async () => {
    // 50 allocations in parallel — a non-atomic implementation duplicates here.
    const results = await Promise.all(
      Array.from({ length: 50 }, () => one<{ n: string }>('select next_import_no(2030) as n')),
    )
    const numbers = results.map((r) => r.n)
    expect(new Set(numbers).size).toBe(50)
  })
})

describe('PO sequences', () => {
  it('peeks without consuming, and claims only when asked', async () => {
    const company = await one<{ id: string }>("select id from companies where short_code = 'ATC'")

    const peek1 = await one<{ s: number }>('select peek_po_seq($1, $2) as s', [company.id, '26-27'])
    const peek2 = await one<{ s: number }>('select peek_po_seq($1, $2) as s', [company.id, '26-27'])
    expect(peek1.s).toBe(1)
    expect(peek2.s).toBe(1) // peeking twice must not advance

    const claimed = await one<{ s: number }>('select claim_po_seq($1, $2) as s', [company.id, '26-27'])
    expect(claimed.s).toBe(1)

    const peek3 = await one<{ s: number }>('select peek_po_seq($1, $2) as s', [company.id, '26-27'])
    expect(peek3.s).toBe(2)
  })

  it('can be fast-forwarded to match history', async () => {
    // ATC has already issued POs 001-008 for FY 26-27 outside the system.
    const company = await one<{ id: string }>("select id from companies where short_code = 'ATC'")
    await db.query('select set_po_seq($1, $2, $3)', [company.id, '26-27', 9])

    const peek = await one<{ s: number }>('select peek_po_seq($1, $2) as s', [company.id, '26-27'])
    expect(peek.s).toBe(9)
  })
})

describe('audit trigger', () => {
  it('records an insert with the new values', async () => {
    await db.query(
      `insert into suppliers (name, country, default_currency) values ('Audit Test Co', 'China', 'USD')`,
    )

    const row = await one<{ action: string; table_name: string }>(
      `select action, table_name from audit_log
       where table_name = 'suppliers' and new_values ->> 'name' = 'Audit Test Co'`,
    )

    expect(row.action).toBe('insert')
  })

  it('records only the fields that actually changed', async () => {
    await db.query(`update suppliers set city = 'Ningbo' where name = 'Audit Test Co'`)

    const row = await one<{ keys: string[] }>(
      `select array(select jsonb_object_keys(changed_fields)) as keys
       from audit_log
       where table_name = 'suppliers' and action = 'update'
       order by created_at desc limit 1`,
    )

    expect(row.keys).toEqual(['city'])
  })

  it('ignores an update that changes nothing', async () => {
    const before = await one<{ count: string }>(
      `select count(*)::text as count from audit_log where table_name = 'suppliers'`,
    )

    // Re-writing the same value must not manufacture an audit entry.
    await db.query(`update suppliers set city = 'Ningbo' where name = 'Audit Test Co'`)

    const after = await one<{ count: string }>(
      `select count(*)::text as count from audit_log where table_name = 'suppliers'`,
    )
    expect(after.count).toBe(before.count)
  })

  it('audits a table whose primary key is not a uuid id', async () => {
    // Regression: app_settings is keyed by `key`, so a trigger reading NEW.id
    // raises "record new has no field id" and blocks the whole migration.
    await db.query(`update app_settings set value = '45' where key = 'idpms_closure_days'`)

    const row = await one<{ record_key: string; record_id: string | null }>(
      `select record_key, record_id from audit_log
       where table_name = 'app_settings' order by created_at desc limit 1`,
    )

    expect(row.record_key).toBe('idpms_closure_days')
    expect(row.record_id).toBeNull()

    await db.query(`update app_settings set value = '90' where key = 'idpms_closure_days'`)
  })

  it('stamps import_id so an import can show its own audit trail', async () => {
    const company = await one<{ id: string }>("select id from companies where short_code = 'NOTO'")
    const imp = await one<{ id: string }>(
      `insert into imports (import_no, company_id, currency, status)
       values ('IMP-2026-9001', $1, 'EUR', 'Draft') returning id`,
      [company.id],
    )

    const row = await one<{ import_id: string }>(
      `select import_id from audit_log where table_name = 'imports' and record_id = $1`,
      [imp.id],
    )

    expect(row.import_id).toBe(imp.id)
  })
})

describe('imports constraints', () => {
  it('rejects an unknown status', async () => {
    const company = await one<{ id: string }>("select id from companies where short_code = 'NOTO'")

    await expect(
      db.query(
        `insert into imports (import_no, company_id, currency, status)
         values ('IMP-2026-9002', $1, 'EUR', 'Teleported')`,
        [company.id],
      ),
    ).rejects.toThrow()
  })

  it('rejects a duplicate import number', async () => {
    const company = await one<{ id: string }>("select id from companies where short_code = 'NOTO'")

    await expect(
      db.query(
        `insert into imports (import_no, company_id, currency) values ('IMP-2026-9001', $1, 'USD')`,
        [company.id],
      ),
    ).rejects.toThrow()
  })

  it('keeps a free-of-charge line out of the charged total', async () => {
    // TC FIRE USD 142,988 carries a free-of-charge line alongside priced ones
    // (Profroma_Invoice_$488.00_FOC.pdf). The line is a real part of the
    // consignment — customs still values it — so it is recorded, not dropped.
    // What it must never do is inflate what the supplier is owed, which is why
    // is_foc is a column rather than a zero unit price someone could edit away.
    const company = await one<{ id: string }>("select id from companies where short_code = 'NOTO'")
    const imp = await one<{ id: string }>(
      `insert into imports (import_no, company_id, currency, pi_value)
       values ((select next_import_no(2052)), $1, 'USD', 142988) returning id`,
      [company.id],
    )

    await db.query(
      `insert into import_items (import_id, line_no, description, quantity, unit_price, amount, is_foc)
       values ($1, 1, 'Fire alarm cable',   1000, 142.50, 142500, false),
              ($1, 2, 'Termination kit',      10,  48.80,    488, false),
              ($1, 3, 'Sample coil (FOC)',     1, 488.00,    488, true)`,
      [imp.id],
    )

    const row = await one<{ charged: string; declared: string; foc_lines: string }>(
      `select coalesce(sum(amount) filter (where not is_foc), 0)::text as charged,
              coalesce(sum(amount), 0)::text                          as declared,
              count(*) filter (where is_foc)::text                    as foc_lines
       from import_items where import_id = $1`,
      [imp.id],
    )

    expect(Number(row.charged)).toBe(142_988)
    expect(Number(row.declared)).toBe(143_476)
    expect(row.foc_lines).toBe('1')
  })
})

describe('v_alerts', () => {
  async function makeImport(fields: Record<string, string | null>) {
    const company = await one<{ id: string }>("select id from companies where short_code = 'NOTO'")
    const columns = ['import_no', 'company_id', 'currency', ...Object.keys(fields)]
    const values = [
      (await one<{ n: string }>('select next_import_no(2040) as n')).n,
      company.id,
      'EUR',
      ...Object.values(fields),
    ]
    const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ')

    return one<{ id: string }>(
      `insert into imports (${columns.join(', ')}) values (${placeholders}) returning id`,
      values,
    )
  }

  it('flags a past-due next action as critical', async () => {
    const imp = await makeImport({
      next_action_title: 'Approve payment',
      next_action_due: '2020-01-01',
      status: 'Payment Pending',
    })

    const row = await one<{ severity: string; title: string }>(
      `select severity, title from v_alerts where import_id = $1 and source = 'next_action'`,
      [imp.id],
    )

    expect(row.severity).toBe('critical')
    expect(row.title).toBe('Approve payment')
  })

  it('flags an action due today as due_today, not critical', async () => {
    const imp = await makeImport({
      next_action_title: 'Verify BOE',
      next_action_due: new Date().toISOString().slice(0, 10),
      status: 'Customs Clearance',
    })

    const row = await one<{ severity: string }>(
      `select severity from v_alerts where import_id = $1 and source = 'next_action'`,
      [imp.id],
    )

    expect(row.severity).toBe('due_today')
  })

  it('ignores an action beyond the configurable horizon', async () => {
    const far = new Date()
    far.setDate(far.getDate() + 60)

    const imp = await makeImport({
      next_action_title: 'Far future',
      next_action_due: far.toISOString().slice(0, 10),
      status: 'In Production',
    })

    const { rows } = await db.query(`select 1 from v_alerts where import_id = $1`, [imp.id])
    expect(rows).toHaveLength(0)
  })

  it('respects a changed horizon setting without a code change', async () => {
    const far = new Date()
    far.setDate(far.getDate() + 60)

    const imp = await makeImport({
      next_action_title: 'Far future',
      next_action_due: far.toISOString().slice(0, 10),
      status: 'In Production',
    })

    await db.query(`update app_settings set value = '90' where key = 'upcoming_horizon_days'`)

    const row = await one<{ severity: string }>(
      `select severity from v_alerts where import_id = $1`,
      [imp.id],
    )
    expect(row.severity).toBe('upcoming')

    await db.query(`update app_settings set value = '7' where key = 'upcoming_horizon_days'`)
  })

  it('flags a passed goods-ready date with no actual date', async () => {
    const imp = await makeImport({
      expected_goods_ready: '2020-05-01',
      status: 'In Production',
    })

    const row = await one<{ severity: string; waiting_on: string }>(
      `select severity, waiting_on from v_alerts where import_id = $1 and source = 'goods_ready'`,
      [imp.id],
    )

    expect(row.severity).toBe('critical')
    expect(row.waiting_on).toBe('Supplier')
  })

  it('stops flagging goods-ready once the actual date is recorded', async () => {
    const imp = await makeImport({
      expected_goods_ready: '2020-05-01',
      actual_goods_ready: '2020-05-04',
      status: 'Goods Ready',
    })

    const { rows } = await db.query(
      `select 1 from v_alerts where import_id = $1 and source = 'goods_ready'`,
      [imp.id],
    )
    expect(rows).toHaveLength(0)
  })

  it('prefers the revised goods-ready date over the original', async () => {
    const future = new Date()
    future.setDate(future.getDate() + 30)

    const imp = await makeImport({
      expected_goods_ready: '2020-05-01',
      revised_goods_ready: future.toISOString().slice(0, 10),
      status: 'In Production',
    })

    // The supplier renegotiated — the original date must stop alerting.
    const { rows } = await db.query(
      `select 1 from v_alerts where import_id = $1 and source = 'goods_ready'`,
      [imp.id],
    )
    expect(rows).toHaveLength(0)
  })

  it('goes quiet for closed and cancelled imports', async () => {
    for (const status of ['Closed', 'Cancelled']) {
      const imp = await makeImport({
        next_action_title: 'Should not alert',
        next_action_due: '2020-01-01',
        expected_goods_ready: '2020-01-01',
        status,
      })

      const { rows } = await db.query(`select 1 from v_alerts where import_id = $1`, [imp.id])
      expect(rows, `${status} should produce no alerts`).toHaveLength(0)
    }
  })
})

describe('supplier bank accounts', () => {
  it('supersedes rather than overwrites, keeping the old details', async () => {
    const supplier = await one<{ id: string }>("select id from suppliers where name = 'Securiton AG'")

    const firstId = await one<{ id: string }>(
      `select supersede_bank_account($1,'Securiton AG','UBS','111','CH11','UBSWCHZH',
        null,null,null,'EUR','From signed PI') as id`,
      [supplier.id],
    )

    const secondId = await one<{ id: string }>(
      `select supersede_bank_account($1,'Securiton AG','Credit Suisse','222','CH22','CRESCHZZ',
        null,null,null,'EUR','Emailed change request') as id`,
      [supplier.id],
    )

    const old = await one<{ is_current: boolean; superseded_by_id: string; account_no: string }>(
      `select is_current, superseded_by_id, account_no from supplier_bank_accounts where id = $1`,
      [firstId.id],
    )

    // The original details survive — that is the whole point after a fraud attempt.
    expect(old.is_current).toBe(false)
    expect(old.superseded_by_id).toBe(secondId.id)
    expect(old.account_no).toBe('111')

    const current = await one<{ count: string }>(
      `select count(*)::text as count from supplier_bank_accounts
       where supplier_id = $1 and is_current`,
      [supplier.id],
    )
    expect(Number(current.count)).toBe(1)
  })

  it('starts every new account unverified', async () => {
    const supplier = await one<{ id: string }>("select id from suppliers where name = 'Securiton AG'")

    const row = await one<{ verification_status: string }>(
      `select verification_status from supplier_bank_accounts
       where supplier_id = $1 and is_current`,
      [supplier.id],
    )

    // A changed account is never inherited as "already verified".
    expect(row.verification_status).toBe('received')
  })
})

describe('document versioning', () => {
  async function makeDocumentWithTypes(codes: string[]) {
    const company = await one<{ id: string }>("select id from companies where short_code = 'NOTO'")
    const imp = await one<{ id: string }>(
      `insert into imports (import_no, company_id, currency)
       values ((select next_import_no(2050)), $1, 'USD') returning id`,
      [company.id],
    )

    const doc = await one<{ id: string }>(
      `insert into documents (import_id, title) values ($1, 'Test doc') returning id`,
      [imp.id],
    )

    for (const code of codes) {
      await db.query(
        `insert into document_type_map (document_id, document_type_id)
         select $1, id from document_types where code = $2`,
        [doc.id, code],
      )
    }

    return { importId: imp.id, documentId: doc.id }
  }

  it('keeps exactly one current version and numbers them in order', async () => {
    const { documentId } = await makeDocumentWithTypes(['packing_list'])

    await db.query(`select add_document_version($1,null,null,'Packing_List_481_boxes.pdf',null,null)`, [documentId])
    await db.query(`select add_document_version($1,null,null,'Revised_Packing_list_479packages.pdf',null,null)`, [documentId])

    const { rows } = await db.query<{ version_no: number; status: string; file_name: string }>(
      `select version_no, status, file_name from document_versions
       where document_id = $1 order by version_no`,
      [documentId],
    )

    expect(rows).toHaveLength(2)
    expect(rows[0].status).toBe('superseded')
    expect(rows[0].file_name).toBe('Packing_List_481_boxes.pdf')
    expect(rows[1].status).toBe('current')
    expect(rows[1].version_no).toBe(2)
  })

  it('links the superseded version to the one that replaced it', async () => {
    const { documentId } = await makeDocumentWithTypes(['commercial_invoice'])

    await db.query(`select add_document_version($1,null,null,'v1.pdf',null,null)`, [documentId])
    await db.query(`select add_document_version($1,null,null,'v2.pdf',null,null)`, [documentId])

    const row = await one<{ superseded_by: string; replacement: string }>(
      `select old.superseded_by_id::text as superseded_by, new.id::text as replacement
       from document_versions old
       join document_versions new on new.document_id = old.document_id and new.version_no = 2
       where old.document_id = $1 and old.version_no = 1`,
      [documentId],
    )

    expect(row.superseded_by).toBe(row.replacement)
  })

  it('lets one file satisfy two checklist items', async () => {
    // Real case: Updated_CI_PL_DIMENSION.pdf is both invoice and packing list.
    const { importId, documentId } = await makeDocumentWithTypes([
      'commercial_invoice',
      'packing_list',
    ])

    await db.query(`select add_document_version($1,null,null,'Updated_CI_PL_DIMENSION.pdf',null,null)`, [documentId])

    const template = await one<{ id: string }>(
      "select id from checklist_templates where name = 'Standard sea'",
    )
    await db.query('select apply_checklist_template($1, $2)', [importId, template.id])

    const { rows } = await db.query<{ type_code: string; state: string }>(
      `select type_code, state from v_document_checklist
       where import_id = $1 and type_code in ('commercial_invoice','packing_list')`,
      [importId],
    )

    expect(rows).toHaveLength(2)
    expect(rows.every((r) => r.state === 'received')).toBe(true)
  })

  it('reports verified only once a human has verified it', async () => {
    const { importId, documentId } = await makeDocumentWithTypes(['boe'])
    const versionId = await one<{ id: string }>(
      `select add_document_version($1,null,null,'BOE_2419568.pdf',null,null) as id`,
      [documentId],
    )

    const template = await one<{ id: string }>(
      "select id from checklist_templates where name = 'Standard air'",
    )
    await db.query('select apply_checklist_template($1, $2)', [importId, template.id])

    const received = await one<{ state: string }>(
      `select state from v_document_checklist where import_id = $1 and type_code = 'boe'`,
      [importId],
    )
    expect(received.state).toBe('received')

    await db.query(
      `update document_versions set verification_status = 'verified', verified_at = now()
       where id = $1`,
      [versionId.id],
    )

    const verified = await one<{ state: string }>(
      `select state from v_document_checklist where import_id = $1 and type_code = 'boe'`,
      [importId],
    )
    expect(verified.state).toBe('verified')
  })
})

describe('checklist templates', () => {
  it('does not ask a courier import for a Bill of Lading', async () => {
    const company = await one<{ id: string }>("select id from companies where short_code = 'NOTO'")
    const imp = await one<{ id: string }>(
      `insert into imports (import_no, company_id, currency)
       values ((select next_import_no(2051)), $1, 'USD') returning id`,
      [company.id],
    )

    const template = await one<{ id: string }>(
      "select id from checklist_templates where name = 'Courier / small'",
    )
    await db.query('select apply_checklist_template($1, $2)', [imp.id, template.id])

    const { rows } = await db.query<{ type_code: string }>(
      `select type_code from v_document_checklist where import_id = $1`,
      [imp.id],
    )
    const codes = rows.map((r) => r.type_code)

    // A JLCPCB consignment has no PO, no PI and no bill of lading.
    expect(codes).toContain('commercial_invoice')
    expect(codes).toContain('boe')
    expect(codes).not.toContain('bl')
    expect(codes).not.toContain('po')
  })

  it('never overwrites a not-applicable decision when reapplied', async () => {
    const company = await one<{ id: string }>("select id from companies where short_code = 'NOTO'")
    const imp = await one<{ id: string }>(
      `insert into imports (import_no, company_id, currency)
       values ((select next_import_no(2052)), $1, 'USD') returning id`,
      [company.id],
    )

    const template = await one<{ id: string }>(
      "select id from checklist_templates where name = 'Standard air'",
    )
    await db.query('select apply_checklist_template($1, $2)', [imp.id, template.id])

    await db.query(
      `update document_checklist set requirement = 'not_applicable'
       where import_id = $1
         and document_type_id = (select id from document_types where code = 'insurance')`,
      [imp.id],
    )

    await db.query('select apply_checklist_template($1, $2)', [imp.id, template.id])

    const row = await one<{ requirement: string }>(
      `select requirement from v_document_checklist
       where import_id = $1 and type_code = 'insurance'`,
      [imp.id],
    )
    expect(row.requirement).toBe('not_applicable')
  })
})

describe('payment alerts', () => {
  async function makePayment(fields: Record<string, unknown>) {
    const company = await one<{ id: string }>("select id from companies where short_code = 'ATC'")
    const imp = await one<{ id: string }>(
      `insert into imports (import_no, company_id, currency, status)
       values ((select next_import_no(2060)), $1, 'EUR', 'Payment Pending') returning id`,
      [company.id],
    )

    const columns = ['import_id', 'seq', 'description', 'currency', 'planned_amount', ...Object.keys(fields)]
    const values = [imp.id, 1, 'Advance', 'EUR', 50000, ...Object.values(fields)]
    const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ')

    await db.query(
      `insert into import_payments (${columns.join(', ')}) values (${placeholders})`,
      values,
    )

    return imp.id
  }

  it('flags an overdue unpaid payment as critical', async () => {
    const importId = await makePayment({ due_date: '2020-01-01', status: 'Approved' })

    const row = await one<{ severity: string; title: string }>(
      `select severity, title from v_alerts where import_id = $1 and source = 'payment'`,
      [importId],
    )

    expect(row.severity).toBe('critical')
    expect(row.title).toContain('EUR 50000.00')
  })

  it('goes quiet once the payment is marked Paid', async () => {
    const importId = await makePayment({
      due_date: '2020-01-01',
      status: 'Paid',
      paid_at: '2020-01-05',
    })

    const { rows } = await db.query(
      `select 1 from v_alerts where import_id = $1 and source = 'payment'`,
      [importId],
    )
    expect(rows).toHaveLength(0)
  })

  it('raises an IDPMS alert once an advance passes the configured window', async () => {
    const importId = await makePayment({
      due_date: '2020-01-01',
      status: 'Paid',
      paid_at: '2020-01-05',
      is_advance: true,
    })

    const row = await one<{ severity: string; title: string }>(
      `select severity, title from v_alerts where import_id = $1 and source = 'idpms'`,
      [importId],
    )

    expect(row.severity).toBe('critical')
    expect(row.title).toContain('Bill of Entry not yet submitted')
  })

  it('clears the IDPMS alert once the BOE is filed with the bank', async () => {
    const importId = await makePayment({
      due_date: '2020-01-01',
      status: 'Paid',
      paid_at: '2020-01-05',
      is_advance: true,
      boe_submitted_to_bank_at: '2020-02-01',
    })

    const { rows } = await db.query(
      `select 1 from v_alerts where import_id = $1 and source = 'idpms'`,
      [importId],
    )
    expect(rows).toHaveLength(0)
  })

  it('does not chase IDPMS for a payment that is not an advance', async () => {
    const importId = await makePayment({
      due_date: '2020-01-01',
      status: 'Paid',
      paid_at: '2020-01-05',
      is_advance: false,
    })

    const { rows } = await db.query(
      `select 1 from v_alerts where import_id = $1 and source = 'idpms'`,
      [importId],
    )
    expect(rows).toHaveLength(0)
  })

  it('totals planned and outstanding per import', async () => {
    const company = await one<{ id: string }>("select id from companies where short_code = 'ATC'")
    const imp = await one<{ id: string }>(
      `insert into imports (import_no, company_id, currency, pi_value)
       values ((select next_import_no(2061)), $1, 'EUR', 100000) returning id`,
      [company.id],
    )

    await db.query(
      `insert into import_payments (import_id, seq, description, currency, planned_amount, status)
       values ($1,1,'Advance','EUR',20000,'Paid'),
              ($1,2,'Before dispatch','EUR',30000,'Planned'),
              ($1,3,'Balance','EUR',50000,'Planned')`,
      [imp.id],
    )

    const row = await one<{ planned_total: string; outstanding_total: string }>(
      `select planned_total::text, outstanding_total::text from v_payment_totals where import_id = $1`,
      [imp.id],
    )

    expect(Number(row.planned_total)).toBe(100000)
    expect(Number(row.outstanding_total)).toBe(80000)
  })
})

describe('verification queue', () => {
  it('surfaces an unverified document and drops it once verified', async () => {
    const company = await one<{ id: string }>("select id from companies where short_code = 'VCON'")
    const imp = await one<{ id: string }>(
      `insert into imports (import_no, company_id, currency)
       values ((select next_import_no(2070)), $1, 'GBP') returning id`,
      [company.id],
    )
    const doc = await one<{ id: string }>(
      `insert into documents (import_id, title) values ($1,'CI') returning id`,
      [imp.id],
    )
    await db.query(
      `insert into document_type_map (document_id, document_type_id)
       select $1, id from document_types where code = 'commercial_invoice'`,
      [doc.id],
    )
    const version = await one<{ id: string }>(
      `select add_document_version($1,null,null,'ci.pdf',null,null) as id`,
      [doc.id],
    )

    const queued = await one<{ kind: string; title: string }>(
      `select kind, title from v_verification_queue where import_id = $1 and kind = 'document'`,
      [imp.id],
    )
    expect(queued.title).toBe('Commercial Invoice received')

    await db.query(
      `update document_versions set verification_status = 'verified' where id = $1`,
      [version.id],
    )

    const { rows } = await db.query(
      `select 1 from v_verification_queue where import_id = $1 and kind = 'document'`,
      [imp.id],
    )
    expect(rows).toHaveLength(0)
  })

  it('surfaces a calculated payment schedule until it is approved', async () => {
    const company = await one<{ id: string }>("select id from companies where short_code = 'NOTO'")
    const imp = await one<{ id: string }>(
      `insert into imports (import_no, company_id, currency, payment_schedule_status)
       values ((select next_import_no(2071)), $1, 'USD', 'calculated') returning id`,
      [company.id],
    )

    const row = await one<{ title: string }>(
      `select title from v_verification_queue where import_id = $1 and kind = 'payment_schedule'`,
      [imp.id],
    )
    expect(row.title).toBe('Payment schedule calculated')

    await db.query(`update imports set payment_schedule_status = 'approved' where id = $1`, [imp.id])

    const { rows } = await db.query(
      `select 1 from v_verification_queue where import_id = $1 and kind = 'payment_schedule'`,
      [imp.id],
    )
    expect(rows).toHaveLength(0)
  })
})

describe('v_import_summary', () => {
  it('joins company and supplier names and counts critical alerts', async () => {
    const company = await one<{ id: string }>("select id from companies where short_code = 'VCON'")
    const supplier = await one<{ id: string }>("select id from suppliers where name = 'Thermocable'")

    const imp = await one<{ id: string }>(
      `insert into imports
         (import_no, company_id, supplier_id, currency, status, next_action_title, next_action_due)
       values ('IMP-2026-9500', $1, $2, 'GBP', 'In Transit', 'Chase BL', '2020-01-01')
       returning id`,
      [company.id, supplier.id],
    )

    const row = await one<{
      company_name: string
      supplier_name: string
      supplier_country: string
      critical_count: string
    }>(`select company_name, supplier_name, supplier_country, critical_count::text
        from v_import_summary where id = $1`, [imp.id])

    expect(row.company_name).toBe('Valuecon')
    expect(row.supplier_name).toBe('Thermocable')
    expect(row.supplier_country).toBe('United Kingdom')
    expect(Number(row.critical_count)).toBe(1)
  })
})

describe('shipments', () => {
  async function makeImport(year: number) {
    const company = await one<{ id: string }>("select id from companies where short_code = 'NOTO'")
    return one<{ id: string }>(
      `insert into imports (import_no, company_id, currency, status)
       values ((select next_import_no($2)), $1, 'GBP', 'In Transit') returning id`,
      [company.id, year],
    )
  }

  it('allocates a sequence per import, so three lots read 1, 2, 3', async () => {
    // Thermocable ships three lots against one commercial order.
    const imp = await makeImport(2080)

    for (let i = 0; i < 3; i += 1) {
      await db.query(
        `insert into shipments (import_id, seq, mode)
         values ($1, (select next_shipment_seq($1)), 'sea')`,
        [imp.id],
      )
    }

    const { rows } = await db.query<{ seq: number }>(
      'select seq from shipments where import_id = $1 order by seq',
      [imp.id],
    )
    expect(rows.map((r) => r.seq)).toEqual([1, 2, 3])
  })

  it('refuses two lots with the same sequence', async () => {
    const imp = await makeImport(2081)
    await db.query(`insert into shipments (import_id, seq, mode) values ($1, 1, 'air')`, [imp.id])

    await expect(
      db.query(`insert into shipments (import_id, seq, mode) values ($1, 1, 'air')`, [imp.id]),
    ).rejects.toThrow()
  })

  it('flags a passed ETA as critical while the shipment is not marked arrived', async () => {
    const imp = await makeImport(2082)
    await db.query(
      `insert into shipments (import_id, seq, mode, eta, status)
       values ($1, 1, 'sea', current_date - 3, 'In Transit')`,
      [imp.id],
    )

    const row = await one<{ severity: string; title: string }>(
      `select severity, title from v_alerts where import_id = $1 and source = 'shipment_eta'`,
      [imp.id],
    )
    expect(row.severity).toBe('critical')
    expect(row.title).toContain('overdue')
  })

  it('prefers the revised ETA over the original', async () => {
    const imp = await makeImport(2083)
    await db.query(
      `insert into shipments (import_id, seq, mode, eta, revised_eta, status)
       values ($1, 1, 'sea', current_date - 10, current_date + 3, 'In Transit')`,
      [imp.id],
    )

    const row = await one<{ severity: string }>(
      `select severity from v_alerts where import_id = $1 and source = 'shipment_eta'`,
      [imp.id],
    )
    // The original slipped, but the revised date has not arrived — not critical.
    expect(row.severity).toBe('upcoming')
  })

  it('goes quiet once the shipment is marked arrived', async () => {
    const imp = await makeImport(2084)
    await db.query(
      `insert into shipments (import_id, seq, mode, eta, actual_arrival, status)
       values ($1, 1, 'air', current_date - 5, current_date - 1, 'Arrived')`,
      [imp.id],
    )

    const { rows } = await db.query(
      `select 1 from v_alerts where import_id = $1 and source = 'shipment_eta'`,
      [imp.id],
    )
    expect(rows).toHaveLength(0)
  })

  it('counts lots and reports the next outstanding ETA on the import summary', async () => {
    const imp = await makeImport(2085)
    await db.query(
      `insert into shipments (import_id, seq, mode, eta, status) values
         ($1, 1, 'sea', current_date + 30, 'In Transit'),
         ($1, 2, 'sea', current_date + 10, 'In Transit'),
         ($1, 3, 'sea', current_date + 20, 'Arrived')`,
      [imp.id],
    )
    await db.query(
      'update shipments set actual_arrival = current_date where seq = 3 and import_id = $1',
      [imp.id],
    )

    const row = await one<{ shipment_count: string; arrived_count: string; next_eta: string }>(
      `select shipment_count::text, arrived_count::text, next_eta::text
       from v_import_summary where id = $1`,
      [imp.id],
    )

    expect(Number(row.shipment_count)).toBe(3)
    expect(Number(row.arrived_count)).toBe(1)

    // The arrived lot is excluded, so the soonest outstanding ETA wins.
    const expected = await one<{ d: string }>('select (current_date + 10)::text as d')
    expect(row.next_eta).toBe(expected.d)
  })
})

describe('production updates', () => {
  async function makeImport(year: number) {
    const company = await one<{ id: string }>("select id from companies where short_code = 'ATC'")
    return one<{ id: string }>(
      `insert into imports (import_no, company_id, currency, status)
       values ((select next_import_no($2)), $1, 'EUR', 'In Production') returning id`,
      [company.id, year],
    )
  }

  it('chases only the latest promise, not every one that was superseded', async () => {
    const imp = await makeImport(2090)

    await db.query(
      `insert into production_updates (import_id, reported_on, promised_ready_date) values
         ($1, current_date - 30, current_date - 20),
         ($1, current_date - 5,  current_date - 1)`,
      [imp.id],
    )

    const { rows } = await db.query(
      `select 1 from v_alerts where import_id = $1 and source = 'production_promise'`,
      [imp.id],
    )

    // One alert, about the most recent promise — not one per broken promise.
    expect(rows).toHaveLength(1)
  })

  it('stops chasing once the goods are confirmed ready', async () => {
    const imp = await makeImport(2091)
    await db.query(
      `insert into production_updates (import_id, reported_on, promised_ready_date)
       values ($1, current_date - 5, current_date - 1)`,
      [imp.id],
    )
    await db.query('update imports set actual_goods_ready = current_date where id = $1', [imp.id])

    const { rows } = await db.query(
      `select 1 from v_alerts where import_id = $1 and source = 'production_promise'`,
      [imp.id],
    )
    expect(rows).toHaveLength(0)
  })

  it('rejects a percentage outside 0 to 100', async () => {
    const imp = await makeImport(2092)

    await expect(
      db.query('insert into production_updates (import_id, percent_complete) values ($1, 140)', [
        imp.id,
      ]),
    ).rejects.toThrow()
  })
})

describe('customs', () => {
  async function makeShipment(year: number) {
    const company = await one<{ id: string }>("select id from companies where short_code = 'NOTO'")
    const imp = await one<{ id: string }>(
      `insert into imports (import_no, company_id, currency, status)
       values ((select next_import_no($2)), $1, 'USD', 'Customs Clearance') returning id`,
      [company.id, year],
    )
    const shipment = await one<{ id: string }>(
      `insert into shipments (import_id, seq, mode) values ($1, 1, 'sea') returning id`,
      [imp.id],
    )
    return { importId: imp.id, shipmentId: shipment.id }
  }

  it('derives import_id from the shipment rather than trusting the caller', async () => {
    const { importId, shipmentId } = await makeShipment(2100)
    const other = await one<{ id: string }>(
      "select id from imports where import_no = 'IMP-2026-9001'",
    )

    // Deliberately pass the WRONG import — the trigger must correct it.
    const row = await one<{ import_id: string }>(
      `insert into customs_records (shipment_id, import_id, boe_no)
       values ($1, $2, '2419568') returning import_id`,
      [shipmentId, other.id],
    )

    expect(row.import_id).toBe(importId)
  })

  it('allows only one customs record per shipment', async () => {
    const { importId, shipmentId } = await makeShipment(2101)
    await db.query(
      `insert into customs_records (shipment_id, import_id, boe_no) values ($1, $2, 'A')`,
      [shipmentId, importId],
    )

    await expect(
      db.query(`insert into customs_records (shipment_id, import_id, boe_no) values ($1, $2, 'B')`, [
        shipmentId,
        importId,
      ]),
    ).rejects.toThrow()
  })

  it('raises a critical alert while a query is open, and drops it once closed', async () => {
    const { importId, shipmentId } = await makeShipment(2102)
    const record = await one<{ id: string }>(
      `insert into customs_records (shipment_id, import_id, boe_no, query_status, query_raised_at)
       values ($1, $2, '2682983', 'open', current_date) returning id`,
      [shipmentId, importId],
    )

    const alert = await one<{ severity: string; waiting_on: string }>(
      `select severity, waiting_on from v_alerts where import_id = $1 and source = 'customs_query'`,
      [importId],
    )
    expect(alert.severity).toBe('critical')
    expect(alert.waiting_on).toBe('CHA')

    await db.query(`update customs_records set query_status = 'closed' where id = $1`, [record.id])

    const { rows } = await db.query(
      `select 1 from v_alerts where import_id = $1 and source = 'customs_query'`,
      [importId],
    )
    expect(rows).toHaveLength(0)
  })

  it('verifies the Bill of Entry and the duty separately', async () => {
    const { importId, shipmentId } = await makeShipment(2103)
    const record = await one<{ id: string }>(
      `insert into customs_records
         (shipment_id, import_id, boe_no, total_duty,
          boe_verification_status, duty_verification_status)
       values ($1, $2, '2419568', 412000, 'received', 'calculated') returning id`,
      [shipmentId, importId],
    )

    const { rows: both } = await db.query<{ kind: string }>(
      'select kind from v_verification_queue where import_id = $1 order by kind',
      [importId],
    )
    expect(both.map((r) => r.kind)).toEqual(['customs_boe', 'customs_duty'])

    // Verifying the BOE must not silently approve the duty as well.
    await db.query(`update customs_records set boe_verification_status = 'verified' where id = $1`, [
      record.id,
    ])

    const { rows: remaining } = await db.query<{ kind: string }>(
      'select kind from v_verification_queue where import_id = $1',
      [importId],
    )
    expect(remaining.map((r) => r.kind)).toEqual(['customs_duty'])
  })

  it('totals duty per import for the landed cost', async () => {
    const { importId, shipmentId } = await makeShipment(2104)
    await db.query(
      `insert into customs_records (shipment_id, import_id, bcd, sws, igst, total_duty)
       values ($1, $2, 100000, 10000, 302000, 412000)`,
      [shipmentId, importId],
    )

    const row = await one<{ duty_total: string; boe_count: string }>(
      'select duty_total::text, boe_count::text from v_customs_totals where import_id = $1',
      [importId],
    )
    expect(Number(row.duty_total)).toBe(412000)
    expect(Number(row.boe_count)).toBe(1)
  })
})

describe('delivery', () => {
  async function makeShipment(year: number) {
    const company = await one<{ id: string }>("select id from companies where short_code = 'NOTO'")
    const imp = await one<{ id: string }>(
      `insert into imports (import_no, company_id, currency, status)
       values ((select next_import_no($2)), $1, 'USD', 'Out for Delivery') returning id`,
      [company.id, year],
    )
    const shipment = await one<{ id: string }>(
      `insert into shipments (import_id, seq, mode) values ($1, 1, 'road') returning id`,
      [imp.id],
    )
    return { importId: imp.id, shipmentId: shipment.id }
  }

  it('raises a discrepancy alert for a short or damaged delivery', async () => {
    const { importId, shipmentId } = await makeShipment(2110)
    await db.query(
      `insert into delivery_records
         (shipment_id, import_id, actual_delivery, has_shortage, discrepancy_notes)
       values ($1, $2, current_date, true, '2 cartons short')`,
      [shipmentId, importId],
    )

    const row = await one<{ severity: string; title: string }>(
      `select severity, title from v_alerts where import_id = $1 and source = 'discrepancy'`,
      [importId],
    )
    expect(row.severity).toBe('critical')
    expect(row.title).toContain('Shortage')
  })

  it('chases a delivery that passed its expected date', async () => {
    const { importId, shipmentId } = await makeShipment(2111)
    await db.query(
      `insert into delivery_records (shipment_id, import_id, expected_delivery)
       values ($1, $2, current_date - 2)`,
      [shipmentId, importId],
    )

    const row = await one<{ severity: string; waiting_on: string }>(
      `select severity, waiting_on from v_alerts where import_id = $1 and source = 'delivery'`,
      [importId],
    )
    expect(row.severity).toBe('critical')
    expect(row.waiting_on).toBe('Transporter')
  })
})

describe('tasks', () => {
  it('stamps completion, and clears it again when reopened', async () => {
    const task = await one<{ id: string }>(
      `insert into tasks (title, status) values ('Chase insurance certificate', 'Open') returning id`,
    )

    const before = await one<{ completed_at: string | null }>(
      'select completed_at from tasks where id = $1',
      [task.id],
    )
    expect(before.completed_at).toBeNull()

    await db.query(`update tasks set status = 'Done' where id = $1`, [task.id])
    const done = await one<{ completed_at: string | null }>(
      'select completed_at from tasks where id = $1',
      [task.id],
    )
    expect(done.completed_at).not.toBeNull()

    await db.query(`update tasks set status = 'Open' where id = $1`, [task.id])
    const reopened = await one<{ completed_at: string | null }>(
      'select completed_at from tasks where id = $1',
      [task.id],
    )
    expect(reopened.completed_at).toBeNull()
  })

  it('surfaces a task belonging to no import at all', async () => {
    // "Renew the marine open policy" belongs to the operation, not an order.
    await db.query(
      `insert into tasks (title, due_date, status)
       values ('Renew marine open policy', current_date - 1, 'Open')`,
    )

    const row = await one<{ severity: string; import_id: string | null }>(
      `select severity, import_id from v_alerts
       where source = 'task' and title = 'Renew marine open policy'`,
    )
    expect(row.severity).toBe('critical')
    expect(row.import_id).toBeNull()
  })

  it('goes quiet once the task is done', async () => {
    const task = await one<{ id: string }>(
      `insert into tasks (title, due_date, status)
       values ('Chase FX advice', current_date - 1, 'Open') returning id`,
    )

    await db.query(`update tasks set status = 'Done' where id = $1`, [task.id])

    const { rows } = await db.query(
      `select 1 from v_alerts where source = 'task' and source_id = $1`,
      [task.id],
    )
    expect(rows).toHaveLength(0)
  })
})

describe('landed cost', () => {
  async function makeImport(year: number) {
    const company = await one<{ id: string }>("select id from companies where short_code = 'NOTO'")
    return one<{ id: string }>(
      `insert into imports (import_no, company_id, currency, status)
       values ((select next_import_no($2)), $1, 'EUR', 'Financial Closure') returning id`,
      [company.id, year],
    )
  }

  it('derives INR from the entered rate, and refuses to invent one', async () => {
    const imp = await makeImport(2120)

    await db.query(
      `insert into import_costs (import_id, cost_type, currency, amount, fx_rate) values
         ($1, 'product', 'EUR', 1000, 95.5),
         ($1, 'freight', 'EUR', 200, null)`,
      [imp.id],
    )

    const { rows } = await db.query<{ cost_type: string; inr_amount: string | null }>(
      `select cost_type, inr_amount::text from import_costs
       where import_id = $1 order by cost_type`,
      [imp.id],
    )

    // 'freight' sorts first: no rate, therefore no INR at all.
    expect(rows[0].inr_amount).toBeNull()
    expect(Number(rows[1].inr_amount)).toBe(95500)
  })

  it('recomputes INR when the rate changes, rather than leaving it stale', async () => {
    const imp = await makeImport(2121)
    const cost = await one<{ id: string }>(
      `insert into import_costs (import_id, cost_type, currency, amount, fx_rate)
       values ($1, 'freight', 'USD', 100, 80) returning id`,
      [imp.id],
    )

    await db.query('update import_costs set fx_rate = 84 where id = $1', [cost.id])

    const row = await one<{ inr_amount: string }>(
      'select inr_amount::text from import_costs where id = $1',
      [cost.id],
    )
    expect(Number(row.inr_amount)).toBe(8400)
  })

  it('clears INR when the rate is removed', async () => {
    const imp = await makeImport(2122)
    const cost = await one<{ id: string }>(
      `insert into import_costs (import_id, cost_type, currency, amount, fx_rate)
       values ($1, 'cha', 'INR', 5000, 1) returning id`,
      [imp.id],
    )

    await db.query('update import_costs set fx_rate = null where id = $1', [cost.id])

    const row = await one<{ inr_amount: string | null }>(
      'select inr_amount::text from import_costs where id = $1',
      [cost.id],
    )
    expect(row.inr_amount).toBeNull()
  })

  it('reports how much of the roll-up is unconverted or still estimated', async () => {
    const imp = await makeImport(2123)

    await db.query(
      `insert into import_costs (import_id, cost_type, currency, amount, fx_rate, is_estimate) values
         ($1, 'product',   'EUR', 1000, 95,   false),
         ($1, 'freight',   'USD',  500, null, false),
         ($1, 'insurance', 'INR', 2000, 1,    true)`,
      [imp.id],
    )

    const row = await one<{
      line_count: string
      unconverted_count: string
      estimate_count: string
      inr_total: string
      inr_estimate_total: string
    }>(
      `select line_count::text, unconverted_count::text, estimate_count::text,
              inr_total::text, inr_estimate_total::text
       from v_landed_cost where import_id = $1`,
      [imp.id],
    )

    expect(Number(row.line_count)).toBe(3)
    expect(Number(row.unconverted_count)).toBe(1)
    expect(Number(row.estimate_count)).toBe(1)
    // 95,000 + 2,000. The unconverted USD line contributes nothing at all.
    expect(Number(row.inr_total)).toBe(97000)
    expect(Number(row.inr_estimate_total)).toBe(2000)
  })

  it('keeps currencies apart rather than summing across them', async () => {
    const imp = await makeImport(2124)
    await db.query(
      `insert into import_costs (import_id, cost_type, currency, amount, fx_rate) values
         ($1, 'product', 'EUR', 1000, 95),
         ($1, 'duty',    'INR', 41200, 1)`,
      [imp.id],
    )

    const { rows } = await db.query<{ currency: string; amount_total: string }>(
      `select currency, amount_total::text from v_landed_cost_by_currency
       where import_id = $1 order by currency`,
      [imp.id],
    )

    expect(rows.map((r) => r.currency)).toEqual(['EUR', 'INR'])
    expect(Number(rows[0].amount_total)).toBe(1000)
  })

  it('surfaces a calculated landed cost for verification until it is approved', async () => {
    const imp = await makeImport(2125)
    await db.query(`update imports set landed_cost_status = 'calculated' where id = $1`, [imp.id])

    const row = await one<{ title: string }>(
      `select title from v_verification_queue where import_id = $1 and kind = 'landed_cost'`,
      [imp.id],
    )
    expect(row.title).toBe('Landed cost calculated')

    await db.query(`update imports set landed_cost_status = 'approved' where id = $1`, [imp.id])

    const { rows } = await db.query(
      `select 1 from v_verification_queue where import_id = $1 and kind = 'landed_cost'`,
      [imp.id],
    )
    expect(rows).toHaveLength(0)
  })
})

describe('warning overrides', () => {
  it('demands a reason — an override without one is indistinguishable from a mistake', async () => {
    const company = await one<{ id: string }>("select id from companies where short_code = 'NOTO'")
    const imp = await one<{ id: string }>(
      `insert into imports (import_no, company_id, currency)
       values ((select next_import_no(2130)), $1, 'USD') returning id`,
      [company.id],
    )

    await expect(
      db.query(
        `insert into warning_overrides (import_id, warning_code)
         values ($1, 'schedule_total_mismatch')`,
        [imp.id],
      ),
    ).rejects.toThrow()
  })
})

describe('email templates', () => {
  it('seeds templates as data, with their placeholders recorded', async () => {
    const row = await one<{ count: string }>('select count(*)::text as count from email_templates')
    expect(Number(row.count)).toBeGreaterThanOrEqual(5)

    const template = await one<{ placeholders: string[] }>(
      "select placeholders from email_templates where code = 'production_followup'",
    )
    expect(template.placeholders).toContain('po_number')
  })

  it('keeps template codes unique', async () => {
    await expect(
      db.query(
        `insert into email_templates (code, name, subject, body)
         values ('production_followup', 'Duplicate', 's', 'b')`,
      ),
    ).rejects.toThrow()
  })
})

describe('single operator', () => {
  it('seeds exactly one operator profile', async () => {
    const row = await one<{ count: string; full_name: string; role: string }>(
      `select (select count(*)::text from profiles) as count, full_name, role
       from profiles order by created_at limit 1`,
    )

    expect(Number(row.count)).toBe(1)
    expect(row.full_name).toBe('Operator')
    expect(row.role).toBe('admin')
  })

  it('does not require an auth user to exist', async () => {
    // The FK to auth.users is dropped, so a profile stands on its own. Without
    // this the seed above could not have been inserted at all.
    const { rows } = await db.query<{ conname: string }>(
      `select conname from pg_constraint
       where conrelid = 'profiles'::regclass and contype = 'f'`,
    )
    expect(rows).toHaveLength(0)
  })

  it('attributes an audited change to whoever the server names', async () => {
    // This used to assert the opposite: that an unattributed change was signed
    // by "the first active profile". That was safe only while exactly one
    // person could sign in. Migration 015 replaced the guess with the actor the
    // server names for the request — see the attribution tests below, which
    // cover the unnamed and forged cases.
    const operator = await one<{ id: string; email: string }>(
      `select id, email from profiles order by created_at limit 1`,
    )
    await db.query(`select set_config('request.headers', $1, false)`, [
      JSON.stringify({ 'x-actor-id': operator.id }),
    ])

    const company = await one<{ id: string }>("select id from companies where short_code = 'NOTO'")
    const imp = await one<{ id: string }>(
      `insert into imports (import_no, company_id, currency)
       values ((select next_import_no(2140)), $1, 'USD') returning id`,
      [company.id],
    )

    const row = await one<{ user_email: string; user_id: string | null }>(
      `select user_email, user_id::text from audit_log
       where table_name = 'imports' and record_id = $1`,
      [imp.id],
    )

    expect(row.user_id).toBe(operator.id)
    expect(row.user_email).toBe(operator.email)

    await db.query(`select set_config('request.headers', '{}', false)`)
  })
})

describe('communications', () => {
  async function makeImport(year: number) {
    const company = await one<{ id: string }>("select id from companies where short_code = 'ATC'")
    return one<{ id: string; import_no: string }>(
      `insert into imports (import_no, company_id, currency)
       values ((select next_import_no($1)), $2, 'USD') returning id, import_no`,
      [year, company.id],
    )
  }

  it('refuses a second row for the same provider message', async () => {
    // Webhooks are delivered more than once. A retry must not produce a
    // duplicate communication, or every downstream suggestion doubles too.
    await db.query(
      `insert into communications (provider, provider_message_id, body_text)
       values ('meta_cloud', 'wamid.TEST_DUPLICATE', 'Container picked up.')`,
    )

    await expect(
      db.query(
        `insert into communications (provider, provider_message_id, body_text)
         values ('meta_cloud', 'wamid.TEST_DUPLICATE', 'Container picked up.')`,
      ),
    ).rejects.toThrow()
  })

  it('allows many manually entered rows, which carry no provider id', async () => {
    // NULLs are distinct in a plain unique index, which is exactly why the
    // index is plain rather than partial.
    await db.query(
      `insert into communications (source, body_text) values ('manual', 'Phoned the CHA')`,
    )
    await db.query(
      `insert into communications (source, body_text) values ('manual', 'Phoned the supplier')`,
    )

    const row = await one<{ count: string }>(
      "select count(*)::text as count from communications where source = 'manual'",
    )
    expect(Number(row.count)).toBe(2)
  })

  it('files a human link against the import, and a matcher guess against nothing', async () => {
    // The whole reason the matcher's column is called matched_import_id: an
    // unconfirmed guess must not appear on an import's audit trail.
    const imp = await makeImport(2150)

    const comm = await one<{ id: string }>(
      `insert into communications (body_text, import_id)
       values ('Cleared today.', $1) returning id`,
      [imp.id],
    )

    const linked = await one<{ count: string }>(
      `select count(*)::text as count from audit_log
       where table_name = 'communications' and record_id = $1 and import_id = $2`,
      [comm.id, imp.id],
    )
    expect(Number(linked.count)).toBe(1)

    const parse = await one<{ id: string }>(
      `insert into communication_parses (provider_version, matched_import_id, match_confidence)
       values ('test-1', $1, 0.94) returning id`,
      [imp.id],
    )

    const guessed = await one<{ count: string }>(
      `select count(*)::text as count from audit_log
       where table_name = 'communication_parses' and record_id = $1 and import_id is not null`,
      [parse.id],
    )
    expect(Number(guessed.count)).toBe(0)
  })

  it('lets exactly one caller claim a suggestion', async () => {
    // supabase-js has no transactions, so double-clicking Apply is guarded by
    // this compare-and-set rather than by a read-then-write in the action.
    const parse = await one<{ id: string }>(
      "insert into communication_parses (provider_version) values ('test-1') returning id",
    )
    const suggestion = await one<{ id: string }>(
      `insert into communication_suggestions (parse_id, seq, kind, title, decision)
       values ($1, 1, 'event', 'Pickup completed', 'approved') returning id`,
      [parse.id],
    )

    const first = await one<{ claim_communication_suggestion: boolean }>(
      'select claim_communication_suggestion($1)',
      [suggestion.id],
    )
    const second = await one<{ claim_communication_suggestion: boolean }>(
      'select claim_communication_suggestion($1)',
      [suggestion.id],
    )

    expect(first.claim_communication_suggestion).toBe(true)
    expect(second.claim_communication_suggestion).toBe(false)
  })

  it('keeps a parse covering several messages in order', async () => {
    // "Stuffing tomorrow" only means anything after "Container picked up".
    const parse = await one<{ id: string }>(
      "insert into communication_parses (provider_version) values ('test-1') returning id",
    )
    const first = await one<{ id: string }>(
      "insert into communications (body_text) values ('Container picked up.') returning id",
    )
    const second = await one<{ id: string }>(
      "insert into communications (body_text) values ('Stuffing tomorrow.') returning id",
    )

    await db.query(
      `insert into communication_parse_members (parse_id, communication_id, seq)
       values ($1, $2, 1), ($1, $3, 2)`,
      [parse.id, first.id, second.id],
    )

    // The same message cannot sit twice in one bundle, nor two messages share a
    // position — either would make "in order" meaningless.
    await expect(
      db.query(
        `insert into communication_parse_members (parse_id, communication_id, seq)
         values ($1, $2, 3)`,
        [parse.id, first.id],
      ),
    ).rejects.toThrow()
  })

  it('enables row level security on every communications table', async () => {
    const { rows } = await db.query<{ relname: string }>(
      `select c.relname from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
         and c.relname like 'communication%'`,
    )
    expect(rows.map((r) => r.relname)).toEqual([])
  })

  it('answers the inbox view for an unmatched message', async () => {
    // An unmatched communication must still appear — dropping it would be the
    // one failure the spec forbids outright.
    const comm = await one<{ id: string }>(
      `insert into communications (body_text, sender_phone)
       values ('Please share the BL draft.', '+8613800000000') returning id`,
    )

    const row = await one<{
      id: string
      import_no: string | null
      parse_id: string | null
      suggestion_count: string | null
      attachment_count: string
    }>('select * from v_communication_inbox where id = $1', [comm.id])

    expect(row.id).toBe(comm.id)
    expect(row.import_no).toBeNull()
    expect(row.parse_id).toBeNull()
    expect(Number(row.attachment_count)).toBe(0)
  })
})

describe('user management and attribution (015)', () => {
  /** Name an actor the way PostgREST does, so the trigger can read it. */
  async function actingAs(actorId: string | null) {
    const headers = actorId ? JSON.stringify({ 'x-actor-id': actorId }) : '{}'
    await db.query(`select set_config('request.headers', $1, false)`, [headers])
  }

  async function latestAuditFor(table: string) {
    return one<{ user_id: string | null; user_email: string | null }>(
      `select user_id, user_email from audit_log
       where table_name = $1 order by created_at desc limit 1`,
      [table],
    )
  }

  it('records the acting user on the audit row', async () => {
    const operator = await one<{ id: string; email: string }>(
      `select id, email from profiles order by created_at limit 1`,
    )

    await actingAs(operator.id)
    await db.query(
      `insert into suppliers (name, country) values ('Attribution Co', 'China')`,
    )

    const row = await latestAuditFor('suppliers')
    expect(row.user_id).toBe(operator.id)
    expect(row.user_email).toBe(operator.email)

    await actingAs(null)
  })

  it('records NULL rather than guessing when nobody is named', async () => {
    // The old behaviour picked "the first active profile", which was right only
    // while one person existed and would otherwise credit one colleague's work
    // to another. An audit trail that admits it does not know beats one that
    // quietly invents an author.
    await actingAs(null)
    await db.query(`insert into suppliers (name, country) values ('Anonymous Co', 'China')`)

    const row = await latestAuditFor('suppliers')
    expect(row.user_id).toBeNull()
    expect(row.user_email).toBeNull()
  })

  it('ignores an actor id that is not a real profile', async () => {
    await actingAs('11111111-1111-1111-1111-111111111111')
    await db.query(`insert into suppliers (name, country) values ('Forged Actor Co', 'China')`)

    const row = await latestAuditFor('suppliers')
    expect(row.user_id).toBeNull()

    await actingAs(null)
  })

  it('audits a role change, keeping both the old and new value', async () => {
    const operator = await one<{ id: string }>(
      `select id from profiles order by created_at limit 1`,
    )

    const colleague = await one<{ id: string }>(
      `insert into profiles (id, email, full_name, role)
       values (gen_random_uuid(), 'colleague@example.com', 'Colleague', 'viewer')
       returning id`,
    )

    await actingAs(operator.id)
    await db.query(`update profiles set role = 'accounts' where id = $1`, [colleague.id])

    const row = await one<{ user_id: string; old_role: string; new_role: string }>(
      `select user_id,
              changed_fields -> 'role' ->> 'old' as old_role,
              changed_fields -> 'role' ->> 'new' as new_role
       from audit_log
       where table_name = 'profiles' and record_id = $1
       order by created_at desc limit 1`,
      [colleague.id],
    )

    expect(row.old_role).toBe('viewer')
    expect(row.new_role).toBe('accounts')
    expect(row.user_id).toBe(operator.id)

    await actingAs(null)
  })

  it('revoking access keeps the person and their history', async () => {
    const colleague = await one<{ id: string }>(
      `select id from profiles where email = 'colleague@example.com'`,
    )

    // Something they did, attributed to them.
    await actingAs(colleague.id)
    await db.query(`insert into suppliers (name, country) values ('Their Work Co', 'Japan')`)
    const work = await latestAuditFor('suppliers')
    expect(work.user_id).toBe(colleague.id)

    await actingAs(null)
    await db.query(`update profiles set is_active = false where id = $1`, [colleague.id])

    // The row survives, so every created_by and audit entry still resolves.
    const still = await one<{ count: string; is_active: boolean }>(
      `select (select count(*)::text from audit_log where user_id = $1) as count, is_active
       from profiles where id = $1`,
      [colleague.id],
    )

    expect(still.is_active).toBe(false)
    expect(Number(still.count)).toBeGreaterThan(0)
  })

  it('keeps the four roles the app offers', async () => {
    for (const role of ['admin', 'import_manager', 'accounts', 'viewer']) {
      await db.query(
        `insert into profiles (id, email, role) values (gen_random_uuid(), $1, $2)`,
        [`${role}@example.com`, role],
      )
    }

    await expect(
      db.query(`insert into profiles (id, email, role) values (gen_random_uuid(), 'x@y.z', 'owner')`),
    ).rejects.toThrow()
  })
})

describe('outbound quote messages (018)', () => {
  let recipientId: string
  let requestId: string

  beforeAll(async () => {
    const supplier = await one<{ id: string }>(
      `insert into suppliers (name, country) values ('Freight Send Co', 'China') returning id`,
    )
    const company = await one<{ id: string }>(`select id from companies limit 1`)
    const imp = await one<{ id: string }>(
      `insert into imports (import_no, company_id, supplier_id, currency, status)
       values ('IMP-2026-9101', $1, $2, 'USD', 'Draft') returning id`,
      [company.id, supplier.id],
    )
    const request = await one<{ id: string }>(
      `insert into freight_quote_requests (import_id, request_no, mode, status)
       values ($1, 'FQR-TEST-0001', 'AIR', 'Open') returning id`,
      [imp.id],
    )
    requestId = request.id

    const recipient = await one<{ id: string }>(
      `insert into freight_quote_request_recipients (quote_request_id, recipient_name, token)
       values ($1, 'DV Logistics', 'tok-send-test') returning id`,
      [requestId],
    )
    recipientId = recipient.id
  })

  async function insertAttempt(attemptNo: number, status = 'PENDING') {
    return db.query(
      `insert into freight_quote_messages
         (quote_request_id, recipient_id, attempt_no, destination, status)
       values ($1, $2, $3, '919810000002', $4)`,
      [requestId, recipientId, attemptNo, status],
    )
  }

  it('cannot record the same attempt twice, which is what makes a double click safe', async () => {
    await insertAttempt(1, 'SENT')
    await expect(insertAttempt(1)).rejects.toThrow()
  })

  it('allows a deliberate resend as a new attempt', async () => {
    await insertAttempt(2, 'SENT')
    const row = await one<{ count: string }>(
      `select count(*)::text as count from freight_quote_messages where recipient_id = $1`,
      [recipientId],
    )
    expect(Number(row.count)).toBe(2)
  })

  it('only accepts the delivery states the provider actually reports', async () => {
    await expect(insertAttempt(3, 'OPENED')).rejects.toThrow()
  })

  it('shows the latest attempt as the recipient’s send state', async () => {
    const row = await one<{ attempt_no: number; status: string }>(
      `select attempt_no, status from v_freight_quote_recipient_messages where recipient_id = $1`,
      [recipientId],
    )
    expect(row.attempt_no).toBe(2)
  })

  it('leaves the recipient’s quote status alone — delivery is not a quotation', async () => {
    const row = await one<{ status: string }>(
      `select status from freight_quote_request_recipients where id = $1`,
      [recipientId],
    )
    // Nothing in 018 has a trigger onto the recipient row; the send path sets
    // this explicitly and only on success.
    expect(row.status).toBe('Pending')
  })

  it('keeps the message out of the operator’s inbox', async () => {
    const inboxCount = async () =>
      Number((await one<{ count: string }>(`select count(*)::text as count from v_communication_inbox`)).count)

    // Outbound quote messages live in their own table precisely so that sending
    // one never puts something in front of a person to read and triage.
    const before = await inboxCount()
    await insertAttempt(4, 'SENT')
    expect(await inboxCount()).toBe(before)
  })

  it('is audited like everything else, and reachable only when signed in', async () => {
    const audited = await one<{ count: string }>(
      `select count(*)::text as count from audit_log where table_name = 'freight_quote_messages'`,
    )
    expect(Number(audited.count)).toBeGreaterThan(0)

    const rls = await one<{ relrowsecurity: boolean }>(
      `select relrowsecurity from pg_class where relname = 'freight_quote_messages'`,
    )
    expect(rls.relrowsecurity).toBe(true)

    const anonGrants = await one<{ count: string }>(
      `select count(*)::text as count from information_schema.role_table_grants
       where table_name = 'freight_quote_messages' and grantee = 'anon'`,
    )
    expect(Number(anonGrants.count)).toBe(0)
  })
})

describe('password reset tokens', () => {
  it('keeps reset tokens behind RLS and rejects a replayed hash', async () => {
    const user = await one<{ id: string }>(
      `insert into auth.users (id, email)
       values ('11111111-1111-4111-8111-111111111111', 'reset-check@example.com')
       returning id`,
    )

    await db.query(
      `insert into password_reset_tokens (user_id, token_hash, expires_at)
       values ($1, 'hash-one', now() + interval '1 hour')`,
      [user.id],
    )

    await expect(
      db.query(
        `insert into password_reset_tokens (user_id, token_hash, expires_at)
         values ($1, 'hash-one', now() + interval '1 hour')`,
        [user.id],
      ),
    ).rejects.toThrow()

    const rls = await one<{ relrowsecurity: boolean }>(
      `select relrowsecurity from pg_class where relname = 'password_reset_tokens'`,
    )
    expect(rls.relrowsecurity).toBe(true)

    const grants = await one<{ count: string }>(
      `select count(*)::text as count from information_schema.role_table_grants
       where table_name = 'password_reset_tokens'
         and grantee in ('anon', 'authenticated')`,
    )
    expect(Number(grants.count)).toBe(0)
  })
})
