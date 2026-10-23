-- ============================================================================
-- 008 Tasks (phase 9)
--
-- Distinct from Next Action, which is the ONE thing an import is waiting on and
-- lives on the import itself. Tasks are the many smaller things that do not
-- deserve to displace it: chase the insurance certificate, ask the CHA for the
-- duty working, remind accounts about the FX advice.
--
-- import_id is nullable on purpose. "Renew the marine open policy" belongs to
-- the operation, not to any one order, and forcing it under an arbitrary import
-- is how a task list stops being trusted.
-- ============================================================================

create table if not exists tasks (
  id             uuid primary key default gen_random_uuid(),
  import_id      uuid references imports (id) on delete cascade,

  title          text not null,
  description    text,
  category       text check (category is null or category in (
                   'Follow-up', 'Document', 'Payment', 'Shipping', 'Customs',
                   'Delivery', 'Compliance', 'Internal', 'Other')),

  -- Who owes the work. `owner_id` is one of us; `external_party` is the outside
  -- party we are waiting on. Both can be set: chasing a CHA is our task about
  -- their obligation.
  owner_id       uuid references profiles (id) on delete set null,
  external_party text check (external_party is null or external_party in (
                   'Supplier', 'CHA', 'Overseas Agent', 'Bank', 'Customs',
                   'Transporter', 'Insurance', 'Other')),

  due_date       date,
  priority       text not null default 'normal'
                 check (priority in ('low', 'normal', 'high', 'critical')),
  status         text not null default 'Open'
                 check (status in ('Open', 'In Progress', 'Blocked', 'Done', 'Cancelled')),

  completed_at   timestamptz,
  completed_by   uuid references profiles (id),

  created_by     uuid references profiles (id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists tasks_import_idx on tasks (import_id);
create index if not exists tasks_due_idx on tasks (due_date)
  where status not in ('Done', 'Cancelled');
create index if not exists tasks_owner_idx on tasks (owner_id)
  where status not in ('Done', 'Cancelled');

drop trigger if exists tasks_updated_at on tasks;
create trigger tasks_updated_at
  before update on tasks
  for each row execute function touch_updated_at();

drop trigger if exists tasks_audit on tasks;
create trigger tasks_audit
  after insert or update or delete on tasks
  for each row execute function audit_row_change();


-- Completion is stamped by the database, so "done" always carries a when and a
-- who — and reopening clears them rather than leaving a stale completion.
create or replace function tasks_stamp_completion()
returns trigger
language plpgsql
as $$
begin
  if new.status in ('Done', 'Cancelled')
     and (old.status is null or old.status not in ('Done', 'Cancelled')) then
    new.completed_at := coalesce(new.completed_at, now());
    new.completed_by := coalesce(new.completed_by, auth.uid());
  elsif new.status not in ('Done', 'Cancelled') then
    new.completed_at := null;
    new.completed_by := null;
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_completion on tasks;
create trigger tasks_completion
  before insert or update of status on tasks
  for each row execute function tasks_stamp_completion();


-- ============================================================================
-- TASK COMMENTS — the running conversation about a task.
-- ============================================================================

create table if not exists task_comments (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references tasks (id) on delete cascade,
  body       text not null,
  created_by uuid references profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists task_comments_task_idx on task_comments (task_id, created_at);

drop trigger if exists task_comments_updated_at on task_comments;
create trigger task_comments_updated_at
  before update on task_comments
  for each row execute function touch_updated_at();


-- ============================================================================
-- ALERT ENGINE — extended with open tasks.
-- ============================================================================

create or replace view v_alerts as
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

select
  i.id, 'schedule_verification', i.id::text, 'due_today',
  'Payment schedule calculated — needs your approval',
  null::date, 'Internal', 'high'
from imports i
where not i.is_archived
  and i.status not in ('Closed', 'Cancelled')
  and i.payment_schedule_status = 'calculated'

union all

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

select
  vq.import_id, 'verification', vq.record_id, 'due_today',
  vq.title || ' — awaiting verification',
  null::date, 'Internal', vq.priority
from v_verification_queue vq
where vq.kind = 'document'

union all

-- An open task reaching its due date. Import-less tasks carry a null import_id
-- and still surface on the dashboard — the Action Centre is the whole
-- operation's list, not just the imports' list.
select
  t.import_id, 'task', t.id::text,
  case
    when t.due_date < current_date then 'critical'
    when t.due_date = current_date then 'due_today'
    else 'upcoming'
  end,
  t.title, t.due_date,
  coalesce(t.external_party, 'Internal'),
  t.priority
from tasks t
left join imports i on i.id = t.import_id
where t.status not in ('Done', 'Cancelled')
  and t.due_date is not null
  and t.due_date <= current_date + setting_int('upcoming_horizon_days', 7)
  and (t.import_id is null
       or (not i.is_archived and i.status not in ('Closed', 'Cancelled')));


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
left join v_customs_totals cus on cus.import_id = i.id;


-- ============================================================================
-- RLS
-- ============================================================================

do $$
declare
  t text;
begin
  foreach t in array array['tasks', 'task_comments']
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
