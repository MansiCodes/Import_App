-- ============================================================================
-- 014 Rebuild v_import_summary so it carries the archive provenance columns
--
-- Migration 013 added imports.source_folder, but a view that selects `i.*`
-- expands that star ONCE, when the view is created — so v_import_summary was
-- still describing the shape of the table as it stood at migration 010, and
-- source_folder was invisible to every query that went through it.
--
-- This is the rule already written into 004: any migration that adds a column
-- to `imports` must DROP and recreate this view, because `create or replace
-- view` refuses to change the column list. 013 added the column without doing
-- so. This is the missing half.
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

grant select on v_import_summary to authenticated;
