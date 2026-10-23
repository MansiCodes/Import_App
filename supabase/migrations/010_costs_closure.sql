-- ============================================================================
-- 010 Landed cost, warning overrides and closure (phase 11)
--
-- Landed cost is the number the whole system exists to produce, and it is the
-- easiest to get quietly wrong. Two rules govern it:
--
--   1. INR is derived ONLY where a human entered the rate. A cost line in EUR
--      with no fx_rate contributes to the EUR total and to NOTHING in the INR
--      total. It is reported as unconverted rather than folded in at some
--      invented rate.
--
--   2. An estimate is not an actual. `is_estimate` is carried right through to
--      the roll-up, so "landed cost" always states how much of itself is still
--      a guess.
-- ============================================================================

create table if not exists import_costs (
  id             uuid primary key default gen_random_uuid(),
  import_id      uuid not null references imports (id) on delete cascade,
  -- Null means the cost belongs to the order as a whole rather than to one lot.
  shipment_id    uuid references shipments (id) on delete set null,

  cost_type      text not null check (cost_type in (
                   'product', 'freight', 'insurance', 'duty', 'cha', 'handling',
                   'terminal', 'transport', 'bank_fx', 'other')),
  description    text,
  vendor         text,

  currency       text not null,
  amount         numeric(18, 4) not null,
  -- Human-entered, always. Never fetched, never defaulted.
  fx_rate        numeric(18, 6),
  inr_amount     numeric(18, 4),

  is_estimate    boolean not null default false,
  incurred_on    date,
  invoice_no     text,
  source_document_id uuid references documents (id) on delete set null,

  notes          text,
  created_by     uuid references profiles (id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists import_costs_import_idx on import_costs (import_id, cost_type);
create index if not exists import_costs_shipment_idx on import_costs (shipment_id)
  where shipment_id is not null;

drop trigger if exists import_costs_updated_at on import_costs;
create trigger import_costs_updated_at
  before update on import_costs
  for each row execute function touch_updated_at();

drop trigger if exists import_costs_audit on import_costs;
create trigger import_costs_audit
  after insert or update or delete on import_costs
  for each row execute function audit_row_change();


-- INR is recomputed from amount × fx_rate whenever either changes, and forced
-- to null when no rate is present. In the database rather than the application
-- so no code path can store an INR figure that its own rate does not support.
create or replace function costs_derive_inr()
returns trigger
language plpgsql
as $$
begin
  new.inr_amount := case
    when new.fx_rate is null or new.fx_rate <= 0 then null
    else round(new.amount * new.fx_rate, 2)
  end;
  return new;
end;
$$;

drop trigger if exists import_costs_inr on import_costs;
create trigger import_costs_inr
  before insert or update of amount, fx_rate on import_costs
  for each row execute function costs_derive_inr();


-- ============================================================================
-- WARNING OVERRIDES (spec §35)
--
-- A validation warning is never a blocker, but overriding one must leave a
-- name, a time and a reason. The reason is NOT NULL on purpose: an override
-- with no stated reason is indistinguishable from a mistake.
-- ============================================================================

create table if not exists warning_overrides (
  id          uuid primary key default gen_random_uuid(),
  import_id   uuid not null references imports (id) on delete cascade,

  -- What was overridden, e.g. 'schedule_total_mismatch', 'po_pi_value_mismatch'.
  warning_code text not null,
  context      text,
  reason       text not null,

  overridden_by uuid references profiles (id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  unique (import_id, warning_code)
);

create index if not exists warning_overrides_import_idx on warning_overrides (import_id);

drop trigger if exists warning_overrides_updated_at on warning_overrides;
create trigger warning_overrides_updated_at
  before update on warning_overrides
  for each row execute function touch_updated_at();

drop trigger if exists warning_overrides_audit on warning_overrides;
create trigger warning_overrides_audit
  after insert or update or delete on warning_overrides
  for each row execute function audit_row_change();


-- ============================================================================
-- CLOSURE
--
-- Closing is a human assertion that everything is settled, recorded with who
-- and when. `landed_cost_status` follows the same calculated/approved split as
-- the payment schedule: a rolled-up figure is not a signed-off figure.
-- ============================================================================

alter table imports
  add column if not exists closed_by uuid references profiles (id),
  add column if not exists closure_notes text,
  add column if not exists landed_cost_status text not null default 'none'
    check (landed_cost_status in ('none', 'calculated', 'approved')),
  add column if not exists landed_cost_verified_by uuid references profiles (id),
  add column if not exists landed_cost_verified_at timestamptz;


-- ============================================================================
-- LANDED COST ROLL-UP
--
-- Currency is not collapsed. Each currency totals separately, and the INR
-- column carries only what an entered rate justifies — `unconverted_count`
-- states how many lines are missing one, so a partial total can never be read
-- as a complete one.
-- ============================================================================

create or replace view v_import_cost_lines as
select
  ic.*,
  sh.seq          as shipment_seq,
  sh.shipment_no,
  (ic.fx_rate is null) as needs_rate
from import_costs ic
left join shipments sh on sh.id = ic.shipment_id;


create or replace view v_landed_cost as
select
  i.id                                                        as import_id,
  count(ic.id)                                                as line_count,
  count(ic.id) filter (where ic.fx_rate is null)              as unconverted_count,
  count(ic.id) filter (where ic.is_estimate)                  as estimate_count,

  -- INR totals. Lines without a rate contribute nothing here, by design.
  sum(coalesce(ic.inr_amount, 0))                             as inr_total,
  sum(coalesce(ic.inr_amount, 0)) filter (where not ic.is_estimate) as inr_actual_total,
  sum(coalesce(ic.inr_amount, 0)) filter (where ic.is_estimate)     as inr_estimate_total,

  sum(coalesce(ic.inr_amount, 0)) filter (where ic.cost_type = 'product')   as inr_product,
  sum(coalesce(ic.inr_amount, 0)) filter (where ic.cost_type = 'freight')   as inr_freight,
  sum(coalesce(ic.inr_amount, 0)) filter (where ic.cost_type = 'insurance') as inr_insurance,
  sum(coalesce(ic.inr_amount, 0)) filter (where ic.cost_type = 'duty')      as inr_duty,
  sum(coalesce(ic.inr_amount, 0)) filter (where ic.cost_type = 'cha')       as inr_cha,
  sum(coalesce(ic.inr_amount, 0)) filter (
    where ic.cost_type in ('handling', 'terminal', 'transport', 'bank_fx', 'other')) as inr_other,

  i.landed_cost_status,
  i.landed_cost_verified_at
from imports i
left join import_costs ic on ic.import_id = i.id
group by i.id, i.landed_cost_status, i.landed_cost_verified_at;


-- Per-currency breakdown, kept separate rather than crushed into the roll-up
-- above: "EUR 123,396 plus INR 412,000 of duty and freight" is the honest
-- statement, and a single number cannot make it.
create or replace view v_landed_cost_by_currency as
select
  ic.import_id,
  ic.currency,
  sum(ic.amount)                                    as amount_total,
  sum(coalesce(ic.inr_amount, 0))                   as inr_total,
  count(*)                                          as line_count,
  count(*) filter (where ic.fx_rate is null)        as unconverted_count
from import_costs ic
group by ic.import_id, ic.currency;


-- ============================================================================
-- Landed cost joins the verification queue once rolled up but not approved.
-- ============================================================================

create or replace view v_verification_queue as
select
  d.import_id,
  'document'                       as kind,
  dv.id::text                      as record_id,
  dt.name || ' received'           as title,
  coalesce(dv.file_name, dt.name)  as detail,
  dv.received_at::timestamptz      as since,
  'high'                           as priority
from document_versions dv
join documents d on d.id = dv.document_id
join imports i on i.id = d.import_id
left join lateral (
  select t.name
  from document_type_map m join document_types t on t.id = m.document_type_id
  where m.document_id = d.id
  order by t.sort_order
  limit 1
) dt on true
where dv.status = 'current'
  and dv.verification_status = 'received'
  and not i.is_archived
  and i.status not in ('Closed', 'Cancelled')

union all

select
  i.id, 'bank_account', b.id::text,
  'Bank details for ' || s.name,
  coalesce(b.bank_name, '') || ' · ' || coalesce(b.account_no, b.iban, ''),
  b.created_at, 'critical'
from supplier_bank_accounts b
join suppliers s on s.id = b.supplier_id
join imports i on i.supplier_id = s.id
where b.is_current
  and b.verification_status = 'received'
  and not i.is_archived
  and i.status not in ('Closed', 'Cancelled')

union all

select
  i.id, 'payment_schedule', i.id::text,
  'Payment schedule calculated',
  'Confirm the instalments add up and the dates are right',
  i.updated_at, 'high'
from imports i
where i.payment_schedule_status = 'calculated'
  and not i.is_archived
  and i.status not in ('Closed', 'Cancelled')

union all

select
  cr.import_id, 'customs_boe', cr.id::text,
  'Bill of Entry ' || coalesce(cr.boe_no, '(unnumbered)'),
  'Check the BOE against the commercial invoice and packing list',
  cr.updated_at, 'high'
from customs_records cr
join imports i on i.id = cr.import_id
where cr.boe_verification_status = 'received'
  and not i.is_archived
  and i.status not in ('Closed', 'Cancelled')

union all

select
  cr.import_id, 'customs_duty', cr.id::text,
  'Duty on BOE ' || coalesce(cr.boe_no, '(unnumbered)'),
  'Confirm the duty heads against the challan',
  cr.updated_at, 'high'
from customs_records cr
join imports i on i.id = cr.import_id
where cr.duty_verification_status in ('calculated', 'received')
  and not i.is_archived
  and i.status not in ('Closed', 'Cancelled')

union all

-- A landed cost that has been rolled up but not signed off.
select
  i.id, 'landed_cost', i.id::text,
  'Landed cost calculated',
  'Confirm the cost lines and exchange rates before closing',
  i.updated_at, 'high'
from imports i
where i.landed_cost_status = 'calculated'
  and not i.is_archived
  and i.status not in ('Closed', 'Cancelled');


-- ============================================================================
-- Rebuilt so the closure and landed-cost columns added above reach the pages
-- that read this view. `i.*` was expanded to explicit columns when the view was
-- created, so a new column on `imports` does NOT appear until the view is
-- dropped and recreated — see the note in 004.
-- ============================================================================

drop view if exists v_import_summary;

create view v_import_summary as
select
  i.*,
  c.name          as company_name,
  c.short_code    as company_code,
  s.name          as supplier_name,
  s.country       as supplier_country,
  ch.name         as cha_name,
  t.planned_total,
  t.outstanding_total,
  t.next_due_date,
  sht.shipment_count,
  sht.arrived_count,
  sht.in_transit_count,
  sht.next_eta,
  cus.duty_total,
  cus.open_queries,
  lc.inr_total            as landed_cost_inr,
  lc.unconverted_count    as cost_lines_without_rate,
  lc.estimate_count       as cost_lines_estimated,
  (select count(*) from tasks tk
     where tk.import_id = i.id and tk.status not in ('Done', 'Cancelled')) as open_task_count,
  (select count(*) from v_alerts a
     where a.import_id = i.id and a.severity = 'critical')  as critical_count,
  (select count(*) from v_alerts a
     where a.import_id = i.id and a.severity = 'due_today') as due_today_count,
  (select min(a.due_date) from v_alerts a where a.import_id = i.id) as earliest_due
from imports i
join companies c on c.id = i.company_id
left join suppliers s on s.id = i.supplier_id
left join chas ch on ch.id = i.cha_id
left join v_payment_totals t on t.import_id = i.id
left join v_shipment_totals sht on sht.import_id = i.id
left join v_customs_totals cus on cus.import_id = i.id
left join v_landed_cost lc on lc.import_id = i.id;


-- ============================================================================
-- RLS
-- ============================================================================

do $$
declare
  t text;
begin
  foreach t in array array['import_costs', 'warning_overrides']
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

grant select on v_verification_queue to authenticated;
grant select on v_landed_cost to authenticated;
grant select on v_landed_cost_by_currency to authenticated;
grant select on v_import_cost_lines to authenticated;
