-- ============================================================================
-- 007 Customs and Delivery (phase 8)
--
-- Customs records key off the SHIPMENT, not the import. The archive settles the
-- question: OOCC_2419568, GATEPASS_2419568 and E-Way Bill System_2419568 all
-- carry the same Bill of Entry number, and one commercial order that dispatches
-- in three lots clears three times.
--
-- The BOE and the duty are verified SEPARATELY. They arrive at different times
-- from different places — the BOE from the CHA, the duty figures from the
-- ICEGATE challan — and a system that treats "the BOE is right" and "the duty
-- is right" as one assertion will get one of them wrong.
--
-- This migration also fills two rules from the alert design that phase 7 left
-- unimplemented: a required document missing at an imminent gate, and an item
-- sitting in the verification queue. Both need a shipment to know what
-- "imminent" means, which is why they land here rather than earlier.
-- ============================================================================


-- ============================================================================
-- CUSTOMS RECORDS
-- ============================================================================

create table if not exists customs_records (
  id                   uuid primary key default gen_random_uuid(),
  shipment_id          uuid not null unique references shipments (id) on delete cascade,
  -- Denormalised so every customs query can filter by import without a join
  -- through shipments. Kept in step by a trigger, not by the application.
  import_id            uuid not null references imports (id) on delete cascade,

  boe_no               text,
  boe_date             date,
  boe_type             text,
  port_code            text,
  icegate_ref          text,

  -- Duty. Stored as the individual heads because that is how the challan
  -- presents them and how any dispute is argued; the total is stored too
  -- because the challan states its own total and ours must be reconcilable
  -- against it rather than silently recomputed.
  assessable_value     numeric(18, 4),
  exchange_rate        numeric(18, 6),
  bcd                  numeric(18, 4),
  sws                  numeric(18, 4),
  igst                 numeric(18, 4),
  compensation_cess    numeric(18, 4),
  other_duty           numeric(18, 4),
  total_duty           numeric(18, 4),
  duty_paid_at         date,
  duty_challan_no      text,

  -- An open query stops everything and is the single most expensive thing to
  -- forget, so it is a first-class field rather than a note.
  query_text           text,
  query_raised_at      date,
  query_status         text not null default 'none'
                       check (query_status in ('none', 'open', 'replied', 'closed')),
  query_replied_at     date,

  examination_at       timestamptz,
  oocc_at              timestamptz,
  cleared_at           timestamptz,
  gate_pass_no         text,
  eway_bill_no         text,
  eway_bill_valid_till date,

  -- Two independent human confirmations, per the note above.
  boe_verification_status  text not null default 'pending'
                       check (boe_verification_status in
                              ('pending', 'received', 'verified', 'rejected')),
  boe_verified_by      uuid references profiles (id),
  boe_verified_at      timestamptz,

  duty_verification_status text not null default 'pending'
                       check (duty_verification_status in
                              ('pending', 'calculated', 'verified', 'approved', 'rejected')),
  duty_verified_by     uuid references profiles (id),
  duty_verified_at     timestamptz,
  verification_remarks text,

  notes                text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists customs_import_idx on customs_records (import_id);
create index if not exists customs_boe_idx on customs_records (boe_no);
create index if not exists customs_query_idx on customs_records (query_status)
  where query_status = 'open';

drop trigger if exists customs_records_updated_at on customs_records;
create trigger customs_records_updated_at
  before update on customs_records
  for each row execute function touch_updated_at();

drop trigger if exists customs_records_audit on customs_records;
create trigger customs_records_audit
  after insert or update or delete on customs_records
  for each row execute function audit_row_change();


-- Keep import_id honest: it must always be the shipment's import, whatever the
-- caller passed. Enforced here rather than trusted from the application.
create or replace function customs_sync_import()
returns trigger
language plpgsql
as $$
begin
  select import_id into new.import_id from shipments where id = new.shipment_id;
  return new;
end;
$$;

drop trigger if exists customs_records_sync_import on customs_records;
create trigger customs_records_sync_import
  before insert or update of shipment_id on customs_records
  for each row execute function customs_sync_import();


-- ============================================================================
-- DELIVERY RECORDS
--
-- What happened after clearance: who moved it, when it landed, and — the part
-- that matters commercially — whether it arrived complete and undamaged.
-- ============================================================================

create table if not exists delivery_records (
  id                 uuid primary key default gen_random_uuid(),
  shipment_id        uuid not null unique references shipments (id) on delete cascade,
  import_id          uuid not null references imports (id) on delete cascade,

  transporter        text,
  lr_no              text,
  vehicle_no         text,

  dispatched_at      date,
  expected_delivery  date,
  actual_delivery    date,
  delivery_location  text,

  received_by        text,
  material_receipt_at date,
  mrn_no             text,

  -- Discrepancies are recorded as flags AND free text: the flags drive alerts
  -- and reporting, the text carries what actually happened.
  has_shortage       boolean not null default false,
  has_damage         boolean not null default false,
  discrepancy_notes  text,
  shortage_qty       numeric(18, 4),

  notes              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists delivery_import_idx on delivery_records (import_id);

drop trigger if exists delivery_records_updated_at on delivery_records;
create trigger delivery_records_updated_at
  before update on delivery_records
  for each row execute function touch_updated_at();

drop trigger if exists delivery_records_audit on delivery_records;
create trigger delivery_records_audit
  after insert or update or delete on delivery_records
  for each row execute function audit_row_change();

create or replace function delivery_sync_import()
returns trigger
language plpgsql
as $$
begin
  select import_id into new.import_id from shipments where id = new.shipment_id;
  return new;
end;
$$;

drop trigger if exists delivery_records_sync_import on delivery_records;
create trigger delivery_records_sync_import
  before insert or update of shipment_id on delivery_records
  for each row execute function delivery_sync_import();


-- ============================================================================
-- GATE IMMINENCE
--
-- A checklist gate is "imminent" when the event it guards is close. Expressed
-- once, here, so the alert view reads as a rule rather than as a wall of dates.
-- Everything is driven off app_settings; nothing is a literal.
-- ============================================================================

-- One row per (import, gate). Deduplicated here rather than in the alert view:
-- an import with three lots would otherwise raise the same missing-document
-- alert three times.
create or replace view v_gate_pressure as
select distinct
  i.id as import_id,
  g.gate
from imports i
left join shipments sh
  on sh.import_id = i.id and sh.status <> 'Cancelled'
cross join lateral (values
  ('before_payment'),
  ('before_pickup'),
  ('before_shipment'),
  ('customs'),
  ('post_clearance')
) as g(gate)
where not i.is_archived
  and i.status not in ('Closed', 'Cancelled')
  and case g.gate
    -- Money is about to move.
    when 'before_payment' then exists (
      select 1 from import_payments p
      where p.import_id = i.id
        and p.status not in ('Paid', 'Supplier Confirmed', 'Cancelled', 'Refunded')
        and p.due_date is not null
        and p.due_date <= current_date + setting_int('upcoming_horizon_days', 7))
    -- Goods are about to be collected.
    when 'before_pickup' then sh.pickup_date is not null
      and sh.actual_arrival is null
      and sh.pickup_date <= current_date + setting_int('upcoming_horizon_days', 7)
    -- The vessel or aircraft is about to leave.
    when 'before_shipment' then sh.etd is not null
      and sh.actual_arrival is null
      and sh.etd <= current_date + setting_int('upcoming_horizon_days', 7)
    -- It is about to land, or has landed and is not cleared.
    when 'customs' then coalesce(sh.revised_eta, sh.eta) is not null
      and sh.status <> 'Delivered'
      and coalesce(sh.revised_eta, sh.eta) <= current_date + setting_int('upcoming_horizon_days', 7)
    -- It cleared; the post-clearance set is now owed.
    when 'post_clearance' then sh.status in ('Customs Cleared', 'Delivered')
    else false
  end;


-- ============================================================================
-- ALERT ENGINE — extended with customs, delivery, the missing-document gate
-- rule and the verification-queue rule.
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

-- A shipment that should have landed and has not been marked arrived.
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

-- The supplier's latest promised ready date has passed with no further update.
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
  and pu.reported_on = (
    select max(pu2.reported_on) from production_updates pu2
    where pu2.import_id = pu.import_id and pu2.promised_ready_date is not null
  )

union all

-- An open customs query. Nothing moves until it is answered, and demurrage
-- accrues daily while it sits.
select
  cr.import_id, 'customs_query', cr.id::text, 'critical',
  'Customs query open on BOE ' || coalesce(cr.boe_no, '(not yet numbered)'),
  cr.query_raised_at, 'CHA', 'critical'
from customs_records cr
join imports i on i.id = cr.import_id
where not i.is_archived
  and i.status not in ('Closed', 'Cancelled')
  and cr.query_status = 'open'

union all

-- Cleared but not delivered by the date that was expected.
select
  dr.import_id, 'delivery', dr.id::text,
  case when dr.expected_delivery < current_date then 'critical' else 'due_today' end,
  'Delivery expected ' || to_char(dr.expected_delivery, 'DD Mon') || ' — not recorded as delivered',
  dr.expected_delivery, 'Transporter', 'normal'
from delivery_records dr
join imports i on i.id = dr.import_id
where not i.is_archived
  and i.status not in ('Closed', 'Cancelled')
  and dr.actual_delivery is null
  and dr.expected_delivery is not null
  and dr.expected_delivery <= current_date

union all

-- Goods arrived short or damaged and the discrepancy has not been resolved.
select
  dr.import_id, 'discrepancy', dr.id::text, 'critical',
  case
    when dr.has_shortage and dr.has_damage then 'Shortage and damage recorded on delivery'
    when dr.has_shortage then 'Shortage recorded on delivery'
    else 'Damage recorded on delivery'
  end,
  dr.actual_delivery, 'Internal', 'high'
from delivery_records dr
join imports i on i.id = dr.import_id
where not i.is_archived
  and i.status not in ('Closed', 'Cancelled')
  and (dr.has_shortage or dr.has_damage)

union all

-- A REQUIRED document still missing at a gate that is imminent. This is the
-- rule that stops a payment going out against an unseen invoice.
select
  cl.import_id, 'checklist_gate', cl.id::text, 'critical',
  cl.type_name || ' missing — needed ' ||
    case cl.gate
      when 'before_payment'  then 'before the next payment'
      when 'before_pickup'   then 'before pickup'
      when 'before_shipment' then 'before dispatch'
      when 'customs'         then 'for customs clearance'
      else 'after clearance'
    end,
  null::date, 'Supplier', 'high'
from v_document_checklist cl
join v_gate_pressure gp on gp.import_id = cl.import_id and gp.gate = cl.gate
where cl.requirement = 'required'
  and cl.state = 'pending'

union all

-- Anything sitting in the verification queue. Surfaced on the dashboard too,
-- so /review is where you go to clear them rather than where you go to find
-- out they exist.
select
  vq.import_id, 'verification', vq.record_id, 'due_today',
  vq.title || ' — awaiting verification',
  null::date, 'Internal', vq.priority
from v_verification_queue vq
where vq.kind = 'document';


-- ============================================================================
-- Customs and delivery join the verification queue.
-- ============================================================================

create or replace view v_verification_queue as
-- Documents that have arrived but not been checked.
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

-- Supplier bank details awaiting verification — the highest-risk item here.
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

-- A calculated payment schedule nobody has approved.
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

-- A Bill of Entry the CHA filed that nobody here has read against the invoice.
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

-- Duty figures entered but not confirmed. Separate from the BOE above, because
-- they are separate assertions arriving from separate places.
select
  cr.import_id, 'customs_duty', cr.id::text,
  'Duty on BOE ' || coalesce(cr.boe_no, '(unnumbered)'),
  'Confirm the duty heads against the challan',
  cr.updated_at, 'high'
from customs_records cr
join imports i on i.id = cr.import_id
where cr.duty_verification_status in ('calculated', 'received')
  and not i.is_archived
  and i.status not in ('Closed', 'Cancelled');


-- ============================================================================
-- Customs totals per import, for the landed-cost roll-up and the import header.
-- ============================================================================

create or replace view v_customs_totals as
select
  cr.import_id,
  count(*)                                              as boe_count,
  sum(coalesce(cr.total_duty, 0))                       as duty_total,
  sum(coalesce(cr.assessable_value, 0))                 as assessable_total,
  count(*) filter (where cr.query_status = 'open')      as open_queries,
  count(*) filter (where cr.cleared_at is not null)     as cleared_count,
  max(cr.cleared_at)                                    as last_cleared_at
from customs_records cr
group by cr.import_id;


-- Rebuilt: v_alerts was replaced, and this view selects imports.*.
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
left join v_customs_totals cus on cus.import_id = i.id;


-- ============================================================================
-- RLS
-- ============================================================================

do $$
declare
  t text;
begin
  foreach t in array array['customs_records', 'delivery_records']
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
grant select on v_verification_queue to authenticated;
grant select on v_customs_totals to authenticated;
grant select on v_gate_pressure to authenticated;
