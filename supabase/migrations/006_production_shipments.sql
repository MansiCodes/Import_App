-- ============================================================================
-- 006 Production and Shipments (phases 5 and 6)
--
-- One import can dispatch in several lots — Thermocable ships three against a
-- single commercial order — so shipments hang beneath the import rather than
-- replacing it. Everything downstream (customs, delivery, freight cost) keys
-- off the shipment, not the import, because that is the level at which those
-- facts actually exist.
--
-- Production is deliberately thin. There is no production table in the design:
-- the promised, revised and actual goods-ready dates already live on `imports`,
-- and what was missing is the record of what the supplier said in between. That
-- is what production_updates holds — reported observations, each attributed and
-- dated, never a status the system infers.
-- ============================================================================


-- ============================================================================
-- PRODUCTION UPDATES
--
-- A supplier saying "70% done, ready by the 20th" is a claim, not a fact. It is
-- stored as a dated report with a source, so a promise that slipped three times
-- reads as three rows rather than one silently overwritten date.
-- ============================================================================

create table if not exists production_updates (
  id             uuid primary key default gen_random_uuid(),
  import_id      uuid not null references imports (id) on delete cascade,

  reported_on    date not null default current_date,
  -- Where the claim came from: an email, a call, an inspection visit.
  source         text,
  stage          text check (stage is null or stage in (
                   'Not started', 'Materials', 'In production', 'Assembly',
                   'Testing', 'Inspection', 'Packing', 'Ready')),
  percent_complete numeric(5, 2) check (
                   percent_complete is null or (percent_complete >= 0 and percent_complete <= 100)),

  -- What the supplier promised THIS time. Compared against the import's
  -- goods-ready dates so a slipping promise is visible rather than implied.
  promised_ready_date date,
  detail         text,

  created_by     uuid references profiles (id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists production_updates_import_idx
  on production_updates (import_id, reported_on desc);

drop trigger if exists production_updates_updated_at on production_updates;
create trigger production_updates_updated_at
  before update on production_updates
  for each row execute function touch_updated_at();

drop trigger if exists production_updates_audit on production_updates;
create trigger production_updates_audit
  after insert or update or delete on production_updates
  for each row execute function audit_row_change();


-- ============================================================================
-- SHIPMENTS
--
-- The column set spans four modes, and most columns are null for any given
-- shipment: a courier consignment has a tracking number and nothing else, while
-- a sea shipment carries a bill of lading, containers and a vessel. Rather than
-- four tables that would all need joining anyway, one table with honest nulls —
-- the UI shows only the fields that apply to the chosen mode.
-- ============================================================================

create table if not exists shipments (
  id                uuid primary key default gen_random_uuid(),
  import_id         uuid not null references imports (id) on delete cascade,

  -- Sequence within the import. Thermocable's three lots are 1, 2, 3.
  seq               integer not null,
  -- The carrier's own reference for the consignment, whatever form it takes.
  shipment_no       text,
  description       text,

  mode              text not null default 'sea'
                    check (mode in ('air', 'sea', 'courier', 'road')),

  cha_id            uuid references chas (id) on delete set null,
  cha_agent_id      uuid references cha_agents (id) on delete set null,

  origin_country    text,
  origin_port       text,
  destination_port  text,
  incoterm          text,

  -- Dates. `revised_eta` exists because an ETA that moves must not erase the
  -- one that was originally promised.
  pickup_date       date,
  etd               date,
  eta               date,
  revised_eta       date,
  actual_arrival    date,

  carrier           text,
  vessel_flight     text,
  -- Air uses AWB (with house/master split); sea uses a bill of lading; courier
  -- uses a tracking number. All optional, all free text — real data has typos.
  awb               text,
  hawb              text,
  mawb              text,
  bl_no             text,
  bl_date           date,
  tracking_no       text,

  container_nos     text,
  container_count   integer,
  packages          integer,
  package_type      text,
  gross_weight_kg   numeric(14, 3),
  net_weight_kg     numeric(14, 3),
  chargeable_weight_kg numeric(14, 3),
  cbm               numeric(14, 3),

  status            text not null default 'Planned' check (status in (
                      'Planned', 'Booked', 'Picked Up', 'In Transit',
                      'Arrived', 'Customs Cleared', 'Delivered', 'Cancelled')),

  freight_terms     text,
  notes             text,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  unique (import_id, seq)
);

create index if not exists shipments_import_idx on shipments (import_id, seq);
create index if not exists shipments_eta_idx on shipments ((coalesce(revised_eta, eta)))
  where status not in ('Delivered', 'Cancelled');
create index if not exists shipments_status_idx on shipments (status);

drop trigger if exists shipments_updated_at on shipments;
create trigger shipments_updated_at
  before update on shipments
  for each row execute function touch_updated_at();

drop trigger if exists shipments_audit on shipments;
create trigger shipments_audit
  after insert or update or delete on shipments
  for each row execute function audit_row_change();


-- ============================================================================
-- Documents and checklists can now point at a specific shipment.
--
-- Necessary as soon as an import has more than one lot: a packing list belongs
-- to the consignment it describes, not to the order in general.
-- ============================================================================

alter table documents
  add column if not exists shipment_id uuid references shipments (id) on delete set null;

create index if not exists documents_shipment_idx on documents (shipment_id)
  where shipment_id is not null;


-- ============================================================================
-- Next shipment sequence — allocated the same way as everything else that must
-- not collide, rather than by counting rows in the application.
-- ============================================================================

create or replace function next_shipment_seq(p_import_id uuid)
returns integer
language sql
volatile
as $$
  select coalesce(max(seq), 0) + 1 from shipments where import_id = p_import_id;
$$;


-- ============================================================================
-- SHIPMENT BOARD — the in-transit / arriving view (/shipments).
-- ============================================================================

create or replace view v_shipment_board as
select
  sh.*,
  coalesce(sh.revised_eta, sh.eta)                        as effective_eta,
  case
    when sh.actual_arrival is not null then null
    when coalesce(sh.revised_eta, sh.eta) is null then null
    else coalesce(sh.revised_eta, sh.eta) - current_date
  end                                                     as days_to_eta,
  -- An ETA that has been moved is worth seeing on the board itself; it is the
  -- single most common thing an operator is asked about.
  (sh.revised_eta is not null and sh.eta is not null and sh.revised_eta <> sh.eta) as eta_revised,
  i.import_no,
  i.status                                                as import_status,
  i.is_archived,
  c.name                                                  as company_name,
  c.short_code                                            as company_code,
  s.name                                                  as supplier_name,
  ch.name                                                 as cha_name,
  ag.name                                                 as agent_name
from shipments sh
join imports i on i.id = sh.import_id
join companies c on c.id = i.company_id
left join suppliers s on s.id = i.supplier_id
left join chas ch on ch.id = sh.cha_id
left join cha_agents ag on ag.id = sh.cha_agent_id;


-- ============================================================================
-- ALERT ENGINE — extended with shipment and production rules.
--
-- Replaced wholesale, as each phase does, so every rule stays readable in one
-- place rather than accumulating across migrations.
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

-- Promised goods-ready date passed with no actual date recorded.
select
  i.id, 'goods_ready', i.id::text, 'critical',
  'Goods-ready date passed — no confirmation from supplier',
  coalesce(i.revised_goods_ready, i.expected_goods_ready),
  'Supplier', 'high'
from imports i
where not i.is_archived
  and i.status not in ('Closed', 'Cancelled', 'Delivered', 'Financial Closure')
  and i.actual_goods_ready is null
  and coalesce(i.revised_goods_ready, i.expected_goods_ready) is not null
  and coalesce(i.revised_goods_ready, i.expected_goods_ready)
      < current_date - setting_int('goods_ready_grace_days', 0)

union all

-- Follow-up date reached.
select
  i.id, 'followup', i.id::text,
  case when i.next_followup_at < current_date then 'critical' else 'due_today' end,
  'Follow-up due', i.next_followup_at,
  coalesce(i.waiting_on, 'Supplier'), 'normal'
from imports i
where not i.is_archived
  and i.status not in ('Closed', 'Cancelled')
  and i.next_followup_at is not null
  and i.next_followup_at <= current_date

union all

-- A payment whose due date has arrived or passed and which nobody has marked
-- paid. Passing the date changes NOTHING about the payment's own status.
select
  p.import_id, 'payment', p.id::text,
  case
    when p.due_date < current_date then 'critical'
    when p.due_date = current_date then 'due_today'
    else 'upcoming'
  end,
  p.description || ' — ' || p.currency || ' ' ||
    trim(to_char(p.planned_amount, 'FM999999999990.00')),
  p.due_date,
  case when p.status in ('Approval Required', 'Planned') then 'Internal' else 'Bank' end,
  case when p.due_date < current_date then 'critical' else 'normal' end
from import_payments p
join imports i on i.id = p.import_id
where not i.is_archived
  and i.status not in ('Closed', 'Cancelled')
  and p.status not in ('Paid', 'Supplier Confirmed', 'Cancelled', 'Refunded')
  and p.due_date is not null
  and p.due_date <= current_date + setting_int('upcoming_horizon_days', 7)

union all

-- A schedule the system worked out that nobody has confirmed yet.
select
  i.id, 'schedule_verification', i.id::text, 'due_today',
  'Payment schedule calculated — needs your approval',
  null::date, 'Internal', 'high'
from imports i
where not i.is_archived
  and i.status not in ('Closed', 'Cancelled')
  and i.payment_schedule_status = 'calculated'

union all

-- Advance remittance not yet closed against a Bill of Entry with the bank.
-- The window comes from app_settings and defaults to 90 days — a default, not
-- a rule: it has to be confirmed with the bank.
select
  p.import_id, 'idpms', p.id::text, 'critical',
  'Advance remitted ' || (current_date - p.paid_at) ||
    ' days ago — Bill of Entry not yet submitted to the bank (IDPMS)',
  p.paid_at + setting_int('idpms_closure_days', 90),
  'Internal', 'high'
from import_payments p
join imports i on i.id = p.import_id
where not i.is_archived
  and i.status <> 'Cancelled'
  and p.is_advance
  and p.status in ('Paid', 'Supplier Confirmed')
  and p.paid_at is not null
  and p.boe_submitted_to_bank_at is null
  and p.paid_at + setting_int('idpms_closure_days', 90) <= current_date

union all

-- Bank details received from a supplier that nobody has verified. Payment
-- fraud starts exactly here.
select
  i.id, 'bank_verification', b.id::text, 'critical',
  'Unverified bank details for ' || s.name || ' — verify before paying',
  null::date, 'Internal', 'critical'
from supplier_bank_accounts b
join suppliers s on s.id = b.supplier_id
join imports i on i.supplier_id = s.id
where b.is_current
  and b.verification_status = 'received'
  and not i.is_archived
  and i.status not in ('Closed', 'Cancelled')
  and exists (
    select 1 from import_payments p
    where p.import_id = i.id
      and p.status not in ('Paid', 'Supplier Confirmed', 'Cancelled', 'Refunded')
  )

union all

-- A shipment that should have landed and has not been marked arrived. The
-- revised ETA wins where one exists; passing the date does not move the
-- shipment's status, exactly as with payments.
select
  sh.import_id, 'shipment_eta', sh.id::text,
  case
    when coalesce(sh.revised_eta, sh.eta) < current_date then 'critical'
    when coalesce(sh.revised_eta, sh.eta) = current_date then 'due_today'
    else 'upcoming'
  end,
  case
    when coalesce(sh.revised_eta, sh.eta) < current_date
      then 'Shipment ' || coalesce(sh.shipment_no, '#' || sh.seq) || ' overdue — not marked arrived'
    else 'Shipment ' || coalesce(sh.shipment_no, '#' || sh.seq) || ' arriving'
  end,
  coalesce(sh.revised_eta, sh.eta),
  'Freight forwarder',
  case when coalesce(sh.revised_eta, sh.eta) < current_date then 'high' else 'normal' end
from shipments sh
join imports i on i.id = sh.import_id
where not i.is_archived
  and i.status not in ('Closed', 'Cancelled')
  and sh.status not in ('Arrived', 'Customs Cleared', 'Delivered', 'Cancelled')
  and sh.actual_arrival is null
  and coalesce(sh.revised_eta, sh.eta) is not null
  and coalesce(sh.revised_eta, sh.eta) <= current_date + setting_int('upcoming_horizon_days', 7)

union all

-- The supplier's most recent promised ready date has passed without a further
-- update. Distinct from the goods-ready rule above: that one watches the date
-- on the order, this one watches the last thing the supplier actually said.
select
  pu.import_id, 'production_promise', pu.id::text, 'critical',
  'Supplier promised ready by ' || to_char(pu.promised_ready_date, 'DD Mon') ||
    ' — no update since',
  pu.promised_ready_date, 'Supplier', 'normal'
from production_updates pu
join imports i on i.id = pu.import_id
where not i.is_archived
  and i.status not in ('Closed', 'Cancelled', 'Delivered', 'Financial Closure')
  and i.actual_goods_ready is null
  and pu.promised_ready_date is not null
  and pu.promised_ready_date < current_date
  -- Only the latest report per import; earlier promises are history.
  and pu.reported_on = (
    select max(pu2.reported_on) from production_updates pu2
    where pu2.import_id = pu.import_id and pu2.promised_ready_date is not null
  );


-- ============================================================================
-- Shipment totals per import, so the list and detail pages can say "3 lots,
-- 1 arrived" without each page assembling it.
-- ============================================================================

create or replace view v_shipment_totals as
select
  sh.import_id,
  count(*)                                                      as shipment_count,
  count(*) filter (where sh.status = 'Delivered')                as delivered_count,
  count(*) filter (where sh.actual_arrival is not null)          as arrived_count,
  count(*) filter (where sh.status in ('Booked', 'Picked Up', 'In Transit')) as in_transit_count,
  min(coalesce(sh.revised_eta, sh.eta)) filter (
    where sh.actual_arrival is null and sh.status <> 'Cancelled') as next_eta,
  max(sh.actual_arrival)                                        as last_arrival
from shipments sh
group by sh.import_id;


-- Rebuilt because v_alerts was replaced and the summary depends on it, and
-- because it selects imports.* — see the note in 004.
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
left join v_shipment_totals sht on sht.import_id = i.id;


-- ============================================================================
-- RLS
-- ============================================================================

do $$
declare
  t text;
begin
  foreach t in array array['production_updates', 'shipments']
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

grant select on v_alerts to authenticated;
grant select on v_import_summary to authenticated;
grant select on v_shipment_board to authenticated;
grant select on v_shipment_totals to authenticated;
