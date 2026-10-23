-- ============================================================================
-- 011 Reporting views (phase 12)
--
-- Views, not stored aggregates. Same reasoning as the alert engine: a report
-- computed at read time cannot drift, needs no scheduled job, and costs nothing
-- to keep current.
--
-- Every one of these deliberately reports its own incompleteness. A supplier
-- lead time computed from three orders is not the same claim as one computed
-- from thirty, so the count travels with the average rather than being dropped
-- once the number looks authoritative.
-- ============================================================================


-- ============================================================================
-- Portfolio by company and status — the "where does everything stand" table.
-- ============================================================================

create or replace view v_report_status_summary as
select
  c.id                                            as company_id,
  c.name                                          as company_name,
  c.short_code                                    as company_code,
  i.status,
  count(*)                                        as import_count,
  sum(coalesce(i.pi_value, 0))                    as value_total,
  -- Value is meaningless summed across currencies; the caller groups by it.
  i.currency
from imports i
join companies c on c.id = i.company_id
where not i.is_archived
group by c.id, c.name, c.short_code, i.status, i.currency;


-- ============================================================================
-- Payment exposure — what is committed, what has gone out, what is still owed.
-- ============================================================================

create or replace view v_report_payment_summary as
select
  c.id                                                   as company_id,
  c.name                                                 as company_name,
  p.currency,
  count(*)                                               as payment_count,
  sum(p.planned_amount)                                  as planned_total,
  sum(p.planned_amount) filter (
    where p.status in ('Paid', 'Supplier Confirmed'))    as paid_total,
  sum(p.planned_amount) filter (
    where p.status not in ('Paid', 'Supplier Confirmed', 'Cancelled', 'Refunded'))
                                                         as outstanding_total,
  sum(p.planned_amount) filter (
    where p.status not in ('Paid', 'Supplier Confirmed', 'Cancelled', 'Refunded')
      and p.due_date < current_date)                     as overdue_total,
  -- INR only where somebody entered a rate. The gap is reported, not filled.
  sum(coalesce(p.inr_amount, 0))                         as inr_recorded,
  count(*) filter (
    where p.status in ('Paid', 'Supplier Confirmed') and p.fx_rate is null)
                                                         as paid_without_rate
from import_payments p
join imports i on i.id = p.import_id
join companies c on c.id = i.company_id
where not i.is_archived
group by c.id, c.name, p.currency;


-- ============================================================================
-- Supplier performance — promise versus delivery, measured in days.
--
-- Lead time runs from PO date to actual goods ready; the slip is actual against
-- the FIRST promise, not the latest revision, because measuring against a date
-- that was moved three times measures nothing.
-- ============================================================================

create or replace view v_report_supplier_performance as
select
  s.id                                        as supplier_id,
  s.name                                      as supplier_name,
  s.country,
  count(i.id)                                 as import_count,
  count(i.id) filter (where i.actual_goods_ready is not null) as completed_count,

  round(avg(i.actual_goods_ready - i.po_date) filter (
    where i.actual_goods_ready is not null and i.po_date is not null), 1)
                                              as avg_lead_time_days,
  s.lead_time_days                            as quoted_lead_time_days,

  round(avg(i.actual_goods_ready - i.expected_goods_ready) filter (
    where i.actual_goods_ready is not null and i.expected_goods_ready is not null), 1)
                                              as avg_slip_days,
  count(*) filter (
    where i.actual_goods_ready is not null
      and i.expected_goods_ready is not null
      and i.actual_goods_ready <= i.expected_goods_ready)  as on_time_count,
  count(*) filter (
    where i.actual_goods_ready is not null and i.expected_goods_ready is not null)
                                              as measurable_count
from suppliers s
left join imports i on i.supplier_id = s.id and not i.is_archived
group by s.id, s.name, s.country, s.lead_time_days;


-- ============================================================================
-- Shipping performance — ETA accuracy and transit time by mode.
-- ============================================================================

create or replace view v_report_shipping_performance as
select
  sh.mode,
  ch.name                                        as cha_name,
  count(*)                                       as shipment_count,
  count(*) filter (where sh.actual_arrival is not null) as arrived_count,
  round(avg(sh.actual_arrival - sh.etd) filter (
    where sh.actual_arrival is not null and sh.etd is not null), 1)
                                                 as avg_transit_days,
  -- Measured against the ORIGINAL eta: a revised ETA that was met still means
  -- the first one was wrong, and the first one is what plans were made on.
  round(avg(sh.actual_arrival - sh.eta) filter (
    where sh.actual_arrival is not null and sh.eta is not null), 1)
                                                 as avg_eta_slip_days,
  count(*) filter (
    where sh.actual_arrival is not null and sh.eta is not null
      and sh.actual_arrival <= sh.eta)           as on_time_count,
  count(*) filter (where sh.revised_eta is not null) as revised_count
from shipments sh
join imports i on i.id = sh.import_id
left join chas ch on ch.id = sh.cha_id
where not i.is_archived
group by sh.mode, ch.name;


-- ============================================================================
-- Duty and clearance — what customs actually cost, and how often it snagged.
-- ============================================================================

create or replace view v_report_customs_summary as
select
  c.id                                            as company_id,
  c.name                                          as company_name,
  date_trunc('month', cr.boe_date)::date          as month,
  count(*)                                        as boe_count,
  sum(coalesce(cr.assessable_value, 0))           as assessable_total,
  sum(coalesce(cr.bcd, 0))                        as bcd_total,
  sum(coalesce(cr.sws, 0))                        as sws_total,
  sum(coalesce(cr.igst, 0))                       as igst_total,
  sum(coalesce(cr.total_duty, 0))                 as duty_total,
  count(*) filter (where cr.query_status <> 'none') as queried_count,
  round(avg(extract(epoch from (cr.cleared_at - cr.boe_date::timestamptz)) / 86400) filter (
    where cr.cleared_at is not null and cr.boe_date is not null), 1)
                                                  as avg_clearance_days
from customs_records cr
join imports i on i.id = cr.import_id
join companies c on c.id = i.company_id
where not i.is_archived
group by c.id, c.name, date_trunc('month', cr.boe_date);


-- ============================================================================
-- Monthly import volume — the shape of the operation over time.
-- ============================================================================

create or replace view v_report_monthly_volume as
select
  c.id                                        as company_id,
  c.name                                      as company_name,
  date_trunc('month', coalesce(i.po_date, i.created_at::date))::date as month,
  i.currency,
  count(*)                                    as import_count,
  sum(coalesce(i.pi_value, 0))                as value_total,
  count(*) filter (where i.status = 'Closed') as closed_count
from imports i
join companies c on c.id = i.company_id
where not i.is_archived
group by c.id, c.name, date_trunc('month', coalesce(i.po_date, i.created_at::date)), i.currency;


-- ============================================================================
-- Document compliance — how much of the required set actually arrives, and how
-- much of what arrived anyone checked.
-- ============================================================================

create or replace view v_report_document_compliance as
select
  c.id                                                     as company_id,
  c.name                                                   as company_name,
  count(*) filter (where cl.requirement = 'required')      as required_count,
  count(*) filter (where cl.requirement = 'required' and cl.state = 'pending')  as missing_count,
  count(*) filter (where cl.requirement = 'required' and cl.state = 'received') as unverified_count,
  count(*) filter (where cl.requirement = 'required' and cl.state = 'verified') as verified_count
from v_document_checklist cl
join imports i on i.id = cl.import_id
join companies c on c.id = i.company_id
where not i.is_archived
group by c.id, c.name;


grant select on v_report_status_summary to authenticated;
grant select on v_report_payment_summary to authenticated;
grant select on v_report_supplier_performance to authenticated;
grant select on v_report_shipping_performance to authenticated;
grant select on v_report_customs_summary to authenticated;
grant select on v_report_monthly_volume to authenticated;
grant select on v_report_document_compliance to authenticated;
