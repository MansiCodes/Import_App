-- ============================================================================
-- NOTOFIRE Import Control Tower — 001 Foundation
--
-- Runs in a DEDICATED Supabase project (not the shared `notofire-tender` one),
-- so tables are plain-named. Unlike the sibling apps, RLS is ENABLED here from
-- the first migration: the browser only ever holds the anon key and the service
-- role key never leaves the server.
--
-- Conventions used throughout every migration in this project:
--   * Money is numeric(18,4); FX rates numeric(18,6). NEVER float — a rounding
--     drift on a EUR 185,094 remittance is real money.
--   * Status columns are text + CHECK, not enums. Enum values cannot be removed
--     and altering them mid-migration is painful; spec §48 demands these stay
--     configurable, so CHECK constraints are the right trade-off.
--   * Every business number the operator might want to change lives in
--     app_settings, never as a literal in application code.
-- ============================================================================

-- gen_random_uuid() is core Postgres (13+), so no extension is required. This
-- keeps the schema portable enough to run in-process during tests.


-- ============================================================================
-- SHARED HELPERS
-- ============================================================================

-- Keeps updated_at honest on every table.
create or replace function touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;


-- ============================================================================
-- AUDIT LOG (spec §32)
--
-- Written by a database trigger rather than application code, so no code path
-- — including a future script or a manual SQL edit through PostgREST — can
-- mutate a tracked row without leaving a record.
-- ============================================================================

create table if not exists audit_log (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid,
  user_email     text,
  table_name     text not null,
  record_id      uuid,
  action         text not null check (action in ('insert', 'update', 'delete')),
  -- Text identity, for tables whose primary key is not a uuid `id` — app_settings
  -- is keyed by `key`, so record_id is null there and this carries the identity.
  record_key     text,
  changed_fields jsonb,
  old_values     jsonb,
  new_values     jsonb,
  -- Denormalised so the Audit tab of an import is a single indexed lookup.
  import_id      uuid,
  created_at     timestamptz not null default now()
);

create index if not exists audit_log_import_idx on audit_log (import_id, created_at desc);
create index if not exists audit_log_record_idx on audit_log (table_name, record_id, created_at desc);
create index if not exists audit_log_created_idx on audit_log (created_at desc);

-- Generic trigger. Attach with:
--   create trigger <table>_audit after insert or update or delete on <table>
--     for each row execute function audit_row_change();
create or replace function audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old        jsonb;
  v_new        jsonb;
  v_changed    jsonb;
  v_record_id  uuid;
  v_record_key text;
  v_import_id  uuid;
  v_action     text;
  v_uid        uuid;
begin
  if TG_OP = 'INSERT' then
    v_old := '{}'::jsonb;
    v_new := to_jsonb(NEW);
    v_action := 'insert';
  elsif TG_OP = 'UPDATE' then
    v_old := to_jsonb(OLD);
    v_new := to_jsonb(NEW);
    v_action := 'update';
  else
    v_old := to_jsonb(OLD);
    v_new := '{}'::jsonb;
    v_action := 'delete';
  end if;

  -- Identity is read from the row's jsonb rather than NEW.id, because not every
  -- audited table has an `id` column — app_settings is keyed by `key`. Reading
  -- NEW.id directly raises "record new has no field id" on those tables.
  v_record_id := nullif(coalesce(v_new ->> 'id', v_old ->> 'id'), '')::uuid;
  v_record_key := coalesce(v_new ->> 'id', v_old ->> 'id', v_new ->> 'key', v_old ->> 'key');

  -- Field-level diff. updated_at is excluded so a touch alone is not "a change".
  select jsonb_object_agg(k, jsonb_build_object('old', v_old -> k, 'new', v_new -> k))
    into v_changed
  from (select jsonb_object_keys(v_old || v_new) as k) keys
  where (v_old -> k) is distinct from (v_new -> k)
    and k <> 'updated_at';

  -- A no-op UPDATE is not worth a row.
  if TG_OP = 'UPDATE' and (v_changed is null or v_changed = '{}'::jsonb) then
    return NEW;
  end if;

  if TG_TABLE_NAME = 'imports' then
    v_import_id := v_record_id;
  elsif v_new ? 'import_id' then
    v_import_id := nullif(v_new ->> 'import_id', '')::uuid;
  elsif v_old ? 'import_id' then
    v_import_id := nullif(v_old ->> 'import_id', '')::uuid;
  end if;

  -- auth.uid() is null for service-role calls (migrations, admin scripts);
  -- that is recorded honestly rather than attributed to a person.
  begin
    v_uid := auth.uid();
  exception when others then
    v_uid := null;
  end;

  insert into audit_log (
    user_id, user_email, table_name, record_id, record_key, action,
    changed_fields, old_values, new_values, import_id
  )
  values (
    v_uid,
    (select email from profiles where id = v_uid),
    TG_TABLE_NAME,
    v_record_id,
    v_record_key,
    v_action,
    v_changed,
    case when TG_OP = 'INSERT' then null else v_old end,
    case when TG_OP = 'DELETE' then null else v_new end,
    v_import_id
  );

  if TG_OP = 'DELETE' then
    return OLD;
  end if;
  return NEW;
end;
$$;


-- ============================================================================
-- ACTIVITY LOG (spec §31) — the human-readable import timeline.
--
-- Distinct from audit_log on purpose: audit_log answers "what field changed",
-- activity_log answers "what happened". The timeline reads from this.
-- ============================================================================

create table if not exists activity_log (
  id          uuid primary key default gen_random_uuid(),
  import_id   uuid,
  event_type  text not null,
  title       text not null,
  detail      text,
  occurred_at timestamptz not null default now(),
  created_by  uuid,
  created_at  timestamptz not null default now()
);

create index if not exists activity_log_import_idx on activity_log (import_id, occurred_at desc);


-- ============================================================================
-- PROFILES — one row per login (spec §33)
--
-- Roles exist in the schema from day one so enabling them later is a policy
-- change, not a migration. v1 runs with a single operator.
-- ============================================================================

create table if not exists profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  email      text not null,
  full_name  text,
  role       text not null default 'viewer'
             check (role in ('admin', 'import_manager', 'accounts', 'viewer')),
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists profiles_updated_at on profiles;
create trigger profiles_updated_at
  before update on profiles
  for each row execute function touch_updated_at();

drop trigger if exists profiles_audit on profiles;
create trigger profiles_audit
  after insert or update or delete on profiles
  for each row execute function audit_row_change();

-- The very first person to sign in becomes admin; everyone after starts as
-- viewer and must be promoted deliberately.
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    case when (select count(*) from public.profiles) = 0 then 'admin' else 'viewer' end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();


-- ============================================================================
-- COMPANIES — importing entities (spec §4)
--
-- Notofire / ATC / Valuecon are seeded as DATA. No entity name may ever appear
-- in application logic; admins add more without a code change.
-- ============================================================================

create table if not exists companies (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null unique,
  legal_name         text,
  -- Short code used when rendering PO number templates, e.g. ATC, VCON, NOTO.
  short_code         text not null unique,
  gstin              text,
  iec                text,
  -- Only ATC currently files by financial year (its folders are "26-27"), so
  -- this is per-company rather than a global assumption.
  fy_start_month     smallint not null default 4 check (fy_start_month between 1 and 12),
  -- Placeholders: {COMPANY} {SEQ} {SEQ:n} {FY} {FYYY} {YYYY} {SUPPLIER}
  po_number_template text not null default '{COMPANY}_PO_{SEQ:3}_{FY}',
  drive_folder_url   text,
  notes              text,
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

drop trigger if exists companies_updated_at on companies;
create trigger companies_updated_at
  before update on companies
  for each row execute function touch_updated_at();

drop trigger if exists companies_audit on companies;
create trigger companies_audit
  after insert or update or delete on companies
  for each row execute function audit_row_change();


-- ============================================================================
-- IDENTIFIER SEQUENCES
--
-- Import numbers are permanent (spec §5) and must never collide, which is the
-- whole point: the current folder tree names imports by value and has already
-- produced duplicates ("TC FIRE USD $102000.00" vs "TC FIRE USD 102,000.00").
-- ============================================================================

create table if not exists import_sequences (
  year     integer primary key,
  next_seq integer not null default 1
);

-- Atomic: the upsert takes a row lock, so two concurrent creates cannot both
-- receive IMP-2026-0001.
create or replace function next_import_no(p_year integer default null)
returns text
language plpgsql
as $$
declare
  v_year integer;
  v_seq  integer;
begin
  v_year := coalesce(p_year, extract(year from current_date)::integer);

  insert into import_sequences (year, next_seq)
  values (v_year, 2)
  on conflict (year) do update
    set next_seq = import_sequences.next_seq + 1
  returning next_seq - 1 into v_seq;

  return 'IMP-' || v_year::text || '-' || lpad(v_seq::text, 4, '0');
end;
$$;

-- PO numbers are SUGGESTED, never imposed (user decision). Peek reads the next
-- value without consuming it, so abandoning a draft form leaves no gap; claim
-- is called only when a PO number that matches the suggestion is actually saved.
create table if not exists po_sequences (
  company_id uuid not null references companies (id) on delete cascade,
  fy_label   text not null,
  next_seq   integer not null default 1,
  primary key (company_id, fy_label)
);

create or replace function peek_po_seq(p_company uuid, p_fy text)
returns integer
language sql
stable
as $$
  select coalesce(
    (select next_seq from po_sequences where company_id = p_company and fy_label = p_fy),
    1
  );
$$;

create or replace function claim_po_seq(p_company uuid, p_fy text)
returns integer
language plpgsql
as $$
declare
  v_seq integer;
begin
  insert into po_sequences (company_id, fy_label, next_seq)
  values (p_company, p_fy, 2)
  on conflict (company_id, fy_label) do update
    set next_seq = po_sequences.next_seq + 1
  returning next_seq - 1 into v_seq;

  return v_seq;
end;
$$;

-- Lets the operator fast-forward a sequence to match history, e.g. ATC is
-- already at PO 008 for FY 26-27.
create or replace function set_po_seq(p_company uuid, p_fy text, p_next integer)
returns void
language sql
as $$
  insert into po_sequences (company_id, fy_label, next_seq)
  values (p_company, p_fy, p_next)
  on conflict (company_id, fy_label) do update set next_seq = excluded.next_seq;
$$;


-- ============================================================================
-- APP SETTINGS (spec §48 — do not invent business rules)
--
-- Every threshold the alert engine uses is a row here. None is a literal in
-- application code, so the operator can correct any of them without a deploy.
-- ============================================================================

create table if not exists app_settings (
  key         text primary key,
  value       jsonb not null,
  description text not null,
  updated_at  timestamptz not null default now()
);

drop trigger if exists app_settings_updated_at on app_settings;
create trigger app_settings_updated_at
  before update on app_settings
  for each row execute function touch_updated_at();

drop trigger if exists app_settings_audit on app_settings;
create trigger app_settings_audit
  after insert or update or delete on app_settings
  for each row execute function audit_row_change();

insert into app_settings (key, value, description) values
  ('idpms_closure_days', '90',
   'Days after an advance remittance by which the Bill of Entry should be submitted to the bank for IDPMS closure. DEFAULT ONLY — confirm the actual window with your bank.'),
  ('default_followup_days', '7',
   'Default gap in days before a supplier or CHA follow-up becomes due again.'),
  ('upcoming_horizon_days', '7',
   'How many days ahead the dashboard treats an item as Upcoming.'),
  ('goods_ready_grace_days', '0',
   'Days of grace after a promised goods-ready date before it is flagged as delayed.'),
  ('eta_grace_days', '0',
   'Days of grace after ETA before a shipment is flagged as not arrived.'),
  ('currencies', '["USD","EUR","GBP","CNY","CHF","JPY","SGD","AED","INR"]',
   'Selectable transaction currencies. Constrained to prevent the GPB/GBP typos present in the historical folders.'),
  ('incoterms', '["EXW","FCA","FOB","CFR","CIF","CPT","CIP","DAP","DPU","DDP"]',
   'Selectable Incoterms.'),
  ('drive_folder_template',
   '["01 PO & PI","02 Payments","03 Production","04 Shipping Documents","05 Freight & CHA","06 Customs","07 Delivery","08 Costing","09 Miscellaneous"]',
   'Folder names used when the Drive API phase creates an import folder. Configurable; historical folders are never restructured.'),
  ('payment_total_tolerance', '0.01',
   'Absolute tolerance when checking that a payment schedule sums to the PI value.')
on conflict (key) do nothing;


-- ============================================================================
-- ROW LEVEL SECURITY
--
-- v1: any authenticated user has full access; the role column is carried but
-- not yet enforced. Because RLS is ON, the anon key is safe in the browser and
-- an unauthenticated request reaches nothing.
--
-- audit_log is deliberately SELECT-only — spec §32 forbids normal users
-- deleting audit history. With no insert/update/delete policy, the only writer
-- is the SECURITY DEFINER trigger, which is owned by the table owner and so
-- bypasses RLS.
-- ============================================================================

do $$
declare
  t text;
begin
  foreach t in array array['profiles', 'companies', 'app_settings',
                           'import_sequences', 'po_sequences']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists authenticated_all on public.%I', t);
    execute format(
      'create policy authenticated_all on public.%I for all to authenticated using (true) with check (true)',
      t
    );
  end loop;
end;
$$;

alter table audit_log enable row level security;
drop policy if exists audit_log_read on audit_log;
create policy audit_log_read on audit_log
  for select to authenticated using (true);

alter table activity_log enable row level security;
drop policy if exists activity_log_read on activity_log;
create policy activity_log_read on activity_log
  for select to authenticated using (true);
drop policy if exists activity_log_write on activity_log;
create policy activity_log_write on activity_log
  for insert to authenticated with check (true);


-- ============================================================================
-- SEED — importing entities
--
-- Names sourced from the real archive. ATC's legal name is confirmed by the
-- Drive account atlantatelecables@gmail.com and the file ATLANTA_PO_006_PTS.pdf.
-- These are rows, not constants: add or rename entities freely.
-- ============================================================================

insert into companies (name, legal_name, short_code, fy_start_month, po_number_template) values
  ('Notofire',  'Notofire Private Limited', 'NOTO', 4, '{COMPANY}_PO_{SEQ:3}_{FY}'),
  ('ATC',       'Atlanta Telecables',       'ATC',  4, '{COMPANY}_PO_{SEQ:3}_{FY}'),
  ('Valuecon',  null,                       'VCON', 4, 'PO_{COMPANY}_{SEQ:3}')
on conflict (name) do nothing;
