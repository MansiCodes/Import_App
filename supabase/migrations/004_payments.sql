-- ============================================================================
-- 004 Payments
--
-- Two rules govern this migration:
--
--   1. `Paid` is a human assertion, never an inference. Nothing in here moves a
--      payment to Paid because a due date passed (spec §13). The alert engine
--      shouts about overdue payments; it does not resolve them.
--
--   2. A schedule the system calculated is CALCULATED, not APPROVED. The
--      distinction is stored, not merely displayed, so an unapproved schedule
--      cannot be mistaken for a confirmed one.
-- ============================================================================

-- ============================================================================
-- Schedule-level verification lives on the import: the schedule is approved as
-- a whole, because "20/30/50 adds up to the PI value" is a statement about the
-- set, not about any one instalment.
-- ============================================================================

alter table imports
  add column if not exists payment_schedule_status text not null default 'none'
    check (payment_schedule_status in ('none', 'calculated', 'approved')),
  add column if not exists payment_schedule_verified_by uuid references profiles (id),
  add column if not exists payment_schedule_verified_at timestamptz;


-- ============================================================================
-- IMPORT PAYMENTS
-- ============================================================================

create table if not exists import_payments (
  id                   uuid primary key default gen_random_uuid(),
  import_id            uuid not null references imports (id) on delete cascade,

  seq                  integer not null,
  description          text not null,
  -- When the money is due in business terms, e.g. "Before dispatch",
  -- "30 days from BL date". Free text: terms vary per supplier and per order.
  payment_condition    text,

  currency             text not null,
  planned_amount       numeric(18, 4) not null,
  percentage           numeric(7, 4),
  due_date             date,

  status               text not null default 'Planned' check (status in (
                         'Planned', 'Due', 'Approval Required', 'Approved',
                         'Payment Initiated', 'Paid', 'Supplier Confirmed',
                         'Cancelled', 'Refunded')),

  requested_at         timestamptz,
  approved_at          timestamptz,
  approved_by          uuid references profiles (id),

  -- What actually left the bank. Kept separate from planned_amount because the
  -- two genuinely differ — bank charges, rounding, or a renegotiated instalment.
  paid_amount          numeric(18, 4),
  paid_at              date,
  paid_by              uuid references profiles (id),

  -- INR is derived ONLY from a rate a human entered. The app never fetches or
  -- invents an exchange rate.
  fx_rate              numeric(18, 6),
  inr_amount           numeric(18, 4),

  bank_reference       text,
  swift_reference      text,
  -- Which bank details the money was actually sent to — the audit question that
  -- matters after a fraud attempt.
  bank_account_id      uuid references supplier_bank_accounts (id),

  -- Advance remittances must be closed against a Bill of Entry with the bank
  -- (IDPMS). The window is configurable in app_settings, not assumed here.
  is_advance           boolean not null default false,
  boe_submitted_to_bank_at date,
  idpms_notes          text,

  notes                text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  unique (import_id, seq)
);

create index if not exists import_payments_import_idx on import_payments (import_id, seq);
create index if not exists import_payments_due_idx on import_payments (due_date)
  where status not in ('Paid', 'Supplier Confirmed', 'Cancelled', 'Refunded');

drop trigger if exists import_payments_updated_at on import_payments;
create trigger import_payments_updated_at
  before update on import_payments
  for each row execute function touch_updated_at();

drop trigger if exists import_payments_audit on import_payments;
create trigger import_payments_audit
  after insert or update or delete on import_payments
  for each row execute function audit_row_change();


-- ============================================================================
-- REFUNDS (spec §29)
--
-- Real in the archive: the Cheemi USD 2,696.15 import has a REFUND folder with
-- its own full remittance document set.
-- ============================================================================

create table if not exists refunds (
  id             uuid primary key default gen_random_uuid(),
  import_id      uuid not null references imports (id) on delete cascade,
  payment_id     uuid references import_payments (id) on delete set null,

  currency       text not null,
  amount         numeric(18, 4) not null,
  reason         text,

  status         text not null default 'Expected'
                 check (status in ('Expected', 'Requested', 'Received', 'Cancelled')),
  requested_at   date,
  received_at    date,

  fx_rate        numeric(18, 6),
  inr_amount     numeric(18, 4),
  bank_reference text,
  notes          text,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists refunds_import_idx on refunds (import_id);

drop trigger if exists refunds_updated_at on refunds;
create trigger refunds_updated_at
  before update on refunds
  for each row execute function touch_updated_at();

drop trigger if exists refunds_audit on refunds;
create trigger refunds_audit
  after insert or update or delete on refunds
  for each row execute function audit_row_change();


-- ============================================================================
-- PAYMENT SUMMARY — totals per import, for the warning that a schedule does
-- not add up to the PI value (spec §35).
-- ============================================================================

create or replace view v_payment_totals as
select
  p.import_id,
  count(*)                                                         as payment_count,
  sum(p.planned_amount)                                            as planned_total,
  sum(p.planned_amount) filter (
    where p.status in ('Paid', 'Supplier Confirmed'))              as paid_planned_total,
  sum(coalesce(p.paid_amount, 0)) filter (
    where p.status in ('Paid', 'Supplier Confirmed'))              as paid_actual_total,
  sum(p.planned_amount) filter (
    where p.status not in ('Paid', 'Supplier Confirmed', 'Cancelled', 'Refunded'))
                                                                   as outstanding_total,
  min(p.due_date) filter (
    where p.status not in ('Paid', 'Supplier Confirmed', 'Cancelled', 'Refunded'))
                                                                   as next_due_date
from import_payments p
group by p.import_id;


-- ============================================================================
-- ALERT ENGINE — extended with payment and IDPMS rules.
--
-- The view is replaced wholesale each phase rather than layered, so the entire
-- set of rules is readable in one place.
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
  );


-- Rebuilt because v_alerts was replaced and the summary depends on it.
--
-- DROPPED rather than replaced: this view selects `imports.*`, and migration
-- 003 added imports.cha_id, which shifts the column positions. `create or
-- replace view` refuses to reorder or rename columns, so any migration that
-- adds a column to imports must drop this view rather than replace it.
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
  (select count(*) from v_alerts a
     where a.import_id = i.id and a.severity = 'critical')  as critical_count,
  (select count(*) from v_alerts a
     where a.import_id = i.id and a.severity = 'due_today') as due_today_count,
  (select min(a.due_date) from v_alerts a where a.import_id = i.id) as earliest_due
from imports i
join companies c on c.id = i.company_id
left join suppliers s on s.id = i.supplier_id
left join chas ch on ch.id = i.cha_id
left join v_payment_totals t on t.import_id = i.id;


-- ============================================================================
-- RLS
-- ============================================================================

do $$
declare
  t text;
begin
  foreach t in array array['import_payments', 'refunds']
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
grant select on v_payment_totals to authenticated;
