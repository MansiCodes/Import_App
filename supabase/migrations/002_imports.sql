-- ============================================================================
-- 002 Imports — the control tower core
--
-- An Import is ONE COMMERCIAL ORDER (one PI, usually one PO). Lots and partial
-- dispatches become shipments beneath it in a later migration, so Thermocable's
-- "2nd lot" / "3rd lot" is one import with three shipments — not three imports.
--
-- `suppliers` is created here in minimal form because imports must reference
-- it; contacts, bank accounts and the supplier master UI arrive in Phase 3.
-- ============================================================================

-- ============================================================================
-- SETTINGS ACCESSORS
--
-- Let SQL views read app_settings, so thresholds stay configurable all the way
-- down into the alert engine rather than being frozen into the view text.
-- ============================================================================

create or replace function setting_int(p_key text, p_default integer)
returns integer
language sql
stable
as $$
  select coalesce(
    (select nullif(value #>> '{}', '')::integer from app_settings where key = p_key),
    p_default
  );
$$;

create or replace function setting_num(p_key text, p_default numeric)
returns numeric
language sql
stable
as $$
  select coalesce(
    (select nullif(value #>> '{}', '')::numeric from app_settings where key = p_key),
    p_default
  );
$$;


-- ============================================================================
-- SUPPLIERS (minimal — expanded in Phase 3)
-- ============================================================================

create table if not exists suppliers (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null unique,
  legal_name         text,
  country            text,
  city               text,
  default_currency   text,
  default_incoterm   text,
  -- Free text on purpose: terms vary per supplier and per order, and spec §48
  -- forbids assuming a house standard such as "always 30% advance".
  payment_terms_text text,
  lead_time_days     integer,
  website            text,
  notes              text,
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists suppliers_active_idx on suppliers (name) where is_active;

drop trigger if exists suppliers_updated_at on suppliers;
create trigger suppliers_updated_at
  before update on suppliers
  for each row execute function touch_updated_at();

drop trigger if exists suppliers_audit on suppliers;
create trigger suppliers_audit
  after insert or update or delete on suppliers
  for each row execute function audit_row_change();


-- ============================================================================
-- IMPORTS
--
-- Status is text + CHECK, and ANY transition is allowed. Real imports skip
-- stages constantly — a JLCPCB courier import has no PO, no production and no
-- freight arrangement — so a state machine here would fight reality. Changes
-- are logged by the audit trigger; they are never blocked.
-- ============================================================================

create table if not exists imports (
  id                   uuid primary key default gen_random_uuid(),

  -- Permanent. Never changes when value, supplier or shipping mode changes.
  import_no            text not null unique,

  company_id           uuid not null references companies (id) on delete restrict,
  supplier_id          uuid references suppliers (id) on delete restrict,

  status               text not null default 'Draft' check (status in (
                         'Draft', 'PO Stage', 'Payment Pending', 'In Production',
                         'Goods Ready', 'Freight Arrangement', 'Pickup Scheduled',
                         'In Transit', 'Arrived', 'Customs Clearance', 'Cleared',
                         'Out for Delivery', 'Delivered', 'Financial Closure',
                         'Closed', 'On Hold', 'Cancelled')),

  -- Short human label, e.g. "500 panels" — folders currently encode this in the
  -- name ("SECURITON EURO 300 PCS 185094.00"), which is how they collide.
  title                text,

  po_number            text,
  po_date              date,
  pi_number            text,
  pi_date              date,

  currency             text not null,
  -- Both are stored: a PO/PI mismatch is a warning, never a blocker (spec §35).
  pi_value             numeric(18, 4),
  po_value             numeric(18, 4),

  incoterm             text,
  payment_terms_text   text,
  origin_country       text,

  expected_goods_ready date,
  revised_goods_ready  date,
  actual_goods_ready   date,

  -- Next Action (spec §9). Operator-owned; the alert engine reads but never
  -- overwrites these.
  next_action_title    text,
  next_action_due      date,
  next_action_priority text not null default 'normal'
                       check (next_action_priority in ('low', 'normal', 'high', 'critical')),
  waiting_on           text check (waiting_on in (
                         'Internal', 'Supplier', 'CHA', 'Overseas Agent', 'Bank',
                         'Customs', 'Transporter', 'Insurance', 'Other')),

  -- Follow-up tracking (spec §25). The app never contacts anyone by itself.
  last_contact_at      date,
  last_response_at     date,
  next_followup_at     date,

  drive_folder_url     text,
  notes                text,

  closed_at            timestamptz,
  is_archived          boolean not null default false,
  created_by           uuid references profiles (id),

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists imports_company_idx on imports (company_id) where not is_archived;
create index if not exists imports_supplier_idx on imports (supplier_id) where not is_archived;
create index if not exists imports_status_idx on imports (status) where not is_archived;
create index if not exists imports_next_action_idx on imports (next_action_due)
  where not is_archived and next_action_due is not null;
-- Global search covers PO, PI and import number (spec §38).
create index if not exists imports_po_idx on imports (po_number);
create index if not exists imports_pi_idx on imports (pi_number);

drop trigger if exists imports_updated_at on imports;
create trigger imports_updated_at
  before update on imports
  for each row execute function touch_updated_at();

drop trigger if exists imports_audit on imports;
create trigger imports_audit
  after insert or update or delete on imports
  for each row execute function audit_row_change();


-- ============================================================================
-- IMPORT ITEMS — optional PI lines
-- ============================================================================

create table if not exists import_items (
  id          uuid primary key default gen_random_uuid(),
  import_id   uuid not null references imports (id) on delete cascade,
  line_no     integer,
  description text not null,
  hsn_code    text,
  quantity    numeric(18, 4),
  unit        text,
  unit_price  numeric(18, 4),
  amount      numeric(18, 4),
  -- Free-of-charge lines are real: Profroma_Invoice_$488.00_FOC.pdf.
  is_foc      boolean not null default false,
  remarks     text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists import_items_import_idx on import_items (import_id, line_no);

drop trigger if exists import_items_updated_at on import_items;
create trigger import_items_updated_at
  before update on import_items
  for each row execute function touch_updated_at();

drop trigger if exists import_items_audit on import_items;
create trigger import_items_audit
  after insert or update or delete on import_items
  for each row execute function audit_row_change();


-- ============================================================================
-- ALERT ENGINE (spec §8, §9)
--
-- One view, evaluated at read time. There is no cron job and no stored "is
-- overdue" flag that could go stale — the dashboard is correct the instant it
-- loads. This also sidesteps Vercel Hobby's 2-cron / once-daily limit entirely.
--
-- Each phase adds a UNION branch: payments in Phase 4, shipments in Phase 6,
-- documents and verification in Phase 7, customs in Phase 8, tasks in Phase 9.
-- ============================================================================

create or replace view v_alerts as
-- Next Action reaching or passing its due date.
select
  i.id                                  as import_id,
  'next_action'                         as source,
  i.id::text                            as source_id,
  case
    when i.next_action_due < current_date then 'critical'
    when i.next_action_due = current_date then 'due_today'
    else 'upcoming'
  end                                   as severity,
  coalesce(i.next_action_title, 'Next action')  as title,
  i.next_action_due                     as due_date,
  coalesce(i.waiting_on, 'Internal')    as waiting_on,
  i.next_action_priority                as priority
from imports i
where not i.is_archived
  and i.status not in ('Closed', 'Cancelled')
  and i.next_action_due is not null
  and i.next_action_due <= current_date + setting_int('upcoming_horizon_days', 7)

union all

-- Promised goods-ready date passed with no actual date recorded. The grace
-- period is configurable because "one day late" is not news for every supplier.
select
  i.id,
  'goods_ready',
  i.id::text,
  'critical',
  'Goods-ready date passed — no confirmation from supplier',
  coalesce(i.revised_goods_ready, i.expected_goods_ready),
  'Supplier',
  'high'
from imports i
where not i.is_archived
  and i.status not in ('Closed', 'Cancelled', 'Delivered', 'Financial Closure')
  and i.actual_goods_ready is null
  and coalesce(i.revised_goods_ready, i.expected_goods_ready) is not null
  and coalesce(i.revised_goods_ready, i.expected_goods_ready)
      < current_date - setting_int('goods_ready_grace_days', 0)

union all

-- Follow-up date reached. Surfaces the reminder; sending anything is manual.
select
  i.id,
  'followup',
  i.id::text,
  case when i.next_followup_at < current_date then 'critical' else 'due_today' end,
  'Follow-up due',
  i.next_followup_at,
  coalesce(i.waiting_on, 'Supplier'),
  'normal'
from imports i
where not i.is_archived
  and i.status not in ('Closed', 'Cancelled')
  and i.next_followup_at is not null
  and i.next_followup_at <= current_date;


-- ============================================================================
-- IMPORT SUMMARY — one row per import with the joins the list and dashboard
-- both need, so neither has to re-derive them.
-- ============================================================================

create or replace view v_import_summary as
select
  i.*,
  c.name                                        as company_name,
  c.short_code                                  as company_code,
  s.name                                        as supplier_name,
  s.country                                     as supplier_country,
  (select count(*) from v_alerts a
     where a.import_id = i.id and a.severity = 'critical')  as critical_count,
  (select count(*) from v_alerts a
     where a.import_id = i.id and a.severity = 'due_today') as due_today_count,
  (select min(a.due_date) from v_alerts a where a.import_id = i.id) as earliest_due
from imports i
join companies c on c.id = i.company_id
left join suppliers s on s.id = i.supplier_id;


-- ============================================================================
-- RLS
-- ============================================================================

do $$
declare
  t text;
begin
  foreach t in array array['suppliers', 'imports', 'import_items']
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

-- Views run with the privileges of the querying user, so the underlying table
-- policies above apply. Granting select keeps PostgREST able to expose them.
grant select on v_alerts to authenticated;
grant select on v_import_summary to authenticated;


-- ============================================================================
-- SEED — suppliers observed in the historical archive.
--
-- Names only; countries where the folders make them unambiguous. Everything
-- else is left null rather than guessed — spec §48.
-- ============================================================================

insert into suppliers (name, country, default_currency) values
  ('Securiton AG',                          'Switzerland', 'EUR'),
  ('Thermocable',                           'United Kingdom', 'GBP'),
  ('TC Fire',                               'China', 'USD'),
  ('Rongda',                                'China', 'USD'),
  ('Beijing PTS',                           'China', 'CNY'),
  ('Ningbo Siterwell',                      'China', 'CNY'),
  ('Zhongshan',                             'China', 'CNY'),
  ('Jiangshan',                             'China', 'CNY'),
  ('Cheemi Technology Co. Ltd',             'China', 'USD'),
  ('Xian Shelok',                           'China', 'USD'),
  ('JLCPCB',                                'China', 'USD'),
  ('Nichia',                                'Japan', 'USD'),
  ('Digi-Key',                              'United States', 'USD'),
  ('Scientific and Technical Enterprise',   'Ukraine', 'EUR')
on conflict (name) do nothing;
