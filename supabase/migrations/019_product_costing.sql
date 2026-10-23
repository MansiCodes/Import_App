-- ============================================================================
-- 019 Product-wise costing
--
-- Logistics invoices are the detailed source of truth (Air Freight, Trucking,
-- AAI…). Product allocations are DERIVED views of those charges — never new
-- expenses. One import_costs rollup line is synced per invoice for landed-cost
-- totals. Cargo lines live on shipments (one packing-list worth per lot).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Extend freight_charge_types with invoice-side codes
-- ---------------------------------------------------------------------------

insert into freight_charge_types (code, name, applies_to, default_method, is_system, sort_order) values
  ('trucking',      'Trucking',              '{AIR,SEA_LCL}', 'FIXED', true, 25),
  ('bl_charges',    'BL Charges',            '{SEA_LCL}',     'FIXED', true, 45),
  ('awb_charges',   'AWB Charges',           '{AIR}',         'FIXED', true, 45),
  ('house_doc',     'House Document Charges','{AIR,SEA_LCL}', 'FIXED', true, 42),
  ('airline_doc',   'Airline Document Charges','{AIR}',       'FIXED', true, 48),
  ('handling',      'Handling',              '{AIR,SEA_LCL}', 'FIXED', true, 75),
  ('cha_charges',   'CHA Charges',           '{AIR,SEA_LCL}', 'FIXED', true, 72),
  ('gst',           'GST / Tax',             '{AIR,SEA_LCL}', 'FIXED', true, 110)
on conflict (code) do nothing;

-- Display buckets for product-wise columns (freight | bl_awb | cha | local | other | tax)
alter table freight_charge_types
  add column if not exists costing_bucket text
    check (costing_bucket is null or costing_bucket in (
      'freight', 'bl_awb', 'cha', 'local', 'other', 'tax'
    ));

update freight_charge_types set costing_bucket = 'freight'
  where code in ('air_freight', 'ocean_freight', 'origin_exw', 'trucking', 'xray')
    and costing_bucket is null;

update freight_charge_types set costing_bucket = 'bl_awb'
  where code in ('house_do', 'airline_do', 'do_fees', 'documentation',
                 'bl_charges', 'awb_charges', 'house_doc', 'airline_doc')
    and costing_bucket is null;

update freight_charge_types set costing_bucket = 'cha'
  where code in ('customs_clearance', 'cha_charges')
    and costing_bucket is null;

update freight_charge_types set costing_bucket = 'local'
  where code in ('local_delivery', 'labour')
    and costing_bucket is null;

update freight_charge_types set costing_bucket = 'other'
  where code in ('aai', 'cfs_terminal', 'misc', 'handling')
    and costing_bucket is null;

update freight_charge_types set costing_bucket = 'tax'
  where code = 'gst' and costing_bucket is null;

update freight_charge_types set costing_bucket = 'other'
  where costing_bucket is null;


-- ---------------------------------------------------------------------------
-- Shipment cargo lines (products on a packing list / lot)
-- ---------------------------------------------------------------------------

create table if not exists shipment_cargo_lines (
  id               uuid primary key default gen_random_uuid(),
  import_id        uuid not null references imports (id) on delete cascade,
  shipment_id      uuid not null references shipments (id) on delete cascade,
  import_item_id   uuid references import_items (id) on delete set null,

  sku              text,
  product_code     text,
  description      text not null,

  quantity         numeric(18, 4),
  unit             text,
  gross_weight_kg  numeric(14, 3),
  net_weight_kg    numeric(14, 3),
  cbm              numeric(14, 3),
  packages         numeric(14, 3),

  unit_value       numeric(18, 4),
  line_value       numeric(18, 4),
  currency         text,

  packing_list_ref text,
  sort_order       integer not null default 100,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists shipment_cargo_lines_shipment_idx
  on shipment_cargo_lines (shipment_id, sort_order);
create index if not exists shipment_cargo_lines_import_idx
  on shipment_cargo_lines (import_id);

drop trigger if exists shipment_cargo_lines_updated_at on shipment_cargo_lines;
create trigger shipment_cargo_lines_updated_at
  before update on shipment_cargo_lines
  for each row execute function touch_updated_at();

drop trigger if exists shipment_cargo_lines_audit on shipment_cargo_lines;
create trigger shipment_cargo_lines_audit
  after insert or update or delete on shipment_cargo_lines
  for each row execute function audit_row_change();


-- ---------------------------------------------------------------------------
-- Logistics invoices (source totals — never invent expense from allocations)
-- ---------------------------------------------------------------------------

create table if not exists logistics_invoices (
  id                  uuid primary key default gen_random_uuid(),
  import_id           uuid not null references imports (id) on delete cascade,
  shipment_id         uuid not null references shipments (id) on delete restrict,

  vendor              text,
  invoice_no          text,
  invoice_date        date,

  currency            text not null,
  subtotal            numeric(18, 4),
  tax_total           numeric(18, 4),
  grand_total         numeric(18, 4) not null check (grand_total >= 0),

  source_document_id  uuid references documents (id) on delete set null,
  -- Single rollup into import_costs — product allocations never create more.
  import_cost_id      uuid references import_costs (id) on delete set null,

  notes               text,
  created_by          uuid references profiles (id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create unique index if not exists logistics_invoices_cost_uidx
  on logistics_invoices (import_cost_id) where import_cost_id is not null;

create index if not exists logistics_invoices_import_idx
  on logistics_invoices (import_id);
create index if not exists logistics_invoices_shipment_idx
  on logistics_invoices (shipment_id);

drop trigger if exists logistics_invoices_updated_at on logistics_invoices;
create trigger logistics_invoices_updated_at
  before update on logistics_invoices
  for each row execute function touch_updated_at();

drop trigger if exists logistics_invoices_audit on logistics_invoices;
create trigger logistics_invoices_audit
  after insert or update or delete on logistics_invoices
  for each row execute function audit_row_change();

-- Point back from import_costs for UI badges
alter table import_costs
  add column if not exists logistics_invoice_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'import_costs_logistics_invoice_fk'
  ) then
    alter table import_costs
      add constraint import_costs_logistics_invoice_fk
      foreign key (logistics_invoice_id) references logistics_invoices (id) on delete set null;
  end if;
end;
$$;

create unique index if not exists import_costs_logistics_invoice_uidx
  on import_costs (logistics_invoice_id) where logistics_invoice_id is not null;


-- ---------------------------------------------------------------------------
-- Invoice charge lines
-- ---------------------------------------------------------------------------

create table if not exists logistics_invoice_charges (
  id                uuid primary key default gen_random_uuid(),
  invoice_id        uuid not null references logistics_invoices (id) on delete cascade,
  charge_type_id    uuid not null references freight_charge_types (id),

  description       text,
  is_tax            boolean not null default false,
  amount            numeric(18, 4) not null,
  currency          text not null,

  allocation_basis  text not null default 'gross_weight'
    check (allocation_basis in (
      'gross_weight', 'net_weight', 'quantity', 'cbm', 'equal', 'manual'
    )),

  sort_order        integer not null default 100,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists logistics_invoice_charges_invoice_idx
  on logistics_invoice_charges (invoice_id, sort_order);

drop trigger if exists logistics_invoice_charges_updated_at on logistics_invoice_charges;
create trigger logistics_invoice_charges_updated_at
  before update on logistics_invoice_charges
  for each row execute function touch_updated_at();

drop trigger if exists logistics_invoice_charges_audit on logistics_invoice_charges;
create trigger logistics_invoice_charges_audit
  after insert or update or delete on logistics_invoice_charges
  for each row execute function audit_row_change();


-- ---------------------------------------------------------------------------
-- Allocations (derived only)
-- ---------------------------------------------------------------------------

create table if not exists logistics_charge_allocations (
  id                uuid primary key default gen_random_uuid(),
  charge_id         uuid not null references logistics_invoice_charges (id) on delete cascade,
  cargo_line_id     uuid not null references shipment_cargo_lines (id) on delete cascade,

  basis_value       numeric(18, 6),
  allocated_amount  numeric(18, 4) not null,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  unique (charge_id, cargo_line_id)
);

create index if not exists logistics_charge_allocations_cargo_idx
  on logistics_charge_allocations (cargo_line_id);

drop trigger if exists logistics_charge_allocations_updated_at on logistics_charge_allocations;
create trigger logistics_charge_allocations_updated_at
  before update on logistics_charge_allocations
  for each row execute function touch_updated_at();


-- ---------------------------------------------------------------------------
-- Views
-- ---------------------------------------------------------------------------

create or replace view v_cargo_line_costing as
select
  cl.id                                              as cargo_line_id,
  cl.import_id,
  cl.shipment_id,
  cl.sku,
  cl.product_code,
  cl.description,
  cl.quantity,
  cl.unit,
  cl.gross_weight_kg,
  cl.net_weight_kg,
  cl.cbm,
  cl.packages,
  cl.unit_value,
  cl.line_value,
  cl.currency                                        as product_currency,
  cl.packing_list_ref,
  cl.sort_order,
  s.seq                                              as shipment_seq,
  s.shipment_no,
  s.bl_no,
  s.awb,
  s.hawb,
  s.mawb,
  coalesce(sum(a.allocated_amount) filter (
    where ct.costing_bucket = 'freight'), 0)         as freight_alloc,
  coalesce(sum(a.allocated_amount) filter (
    where ct.costing_bucket = 'bl_awb'), 0)           as bl_awb_alloc,
  coalesce(sum(a.allocated_amount) filter (
    where ct.costing_bucket = 'cha'), 0)              as cha_alloc,
  coalesce(sum(a.allocated_amount) filter (
    where ct.costing_bucket = 'local'), 0)            as local_alloc,
  coalesce(sum(a.allocated_amount) filter (
    where ct.costing_bucket = 'other'), 0)            as other_alloc,
  coalesce(sum(a.allocated_amount) filter (
    where ct.costing_bucket = 'tax' or ch.is_tax), 0) as tax_alloc,
  coalesce(sum(a.allocated_amount), 0)               as total_logistics,
  case
    when cl.quantity is not null and cl.quantity > 0
      then round(coalesce(sum(a.allocated_amount), 0) / cl.quantity, 4)
    else null
  end                                                as logistics_per_unit,
  coalesce(cl.line_value, 0) + coalesce(sum(a.allocated_amount), 0)
                                                     as landed_cost
from shipment_cargo_lines cl
join shipments s on s.id = cl.shipment_id
left join logistics_charge_allocations a on a.cargo_line_id = cl.id
left join logistics_invoice_charges ch on ch.id = a.charge_id
left join freight_charge_types ct on ct.id = ch.charge_type_id
group by
  cl.id, cl.import_id, cl.shipment_id, cl.sku, cl.product_code, cl.description,
  cl.quantity, cl.unit, cl.gross_weight_kg, cl.net_weight_kg, cl.cbm, cl.packages,
  cl.unit_value, cl.line_value, cl.currency, cl.packing_list_ref, cl.sort_order,
  s.seq, s.shipment_no, s.bl_no, s.awb, s.hawb, s.mawb;


create or replace view v_shipment_costing_summary as
select
  s.id                                               as shipment_id,
  s.import_id,
  s.seq                                              as shipment_seq,
  s.shipment_no,
  s.bl_no,
  s.awb,
  s.hawb,
  s.mawb,
  s.gross_weight_kg                                  as shipment_gross_weight_kg,
  s.cbm                                              as shipment_cbm,
  (select count(*) from shipment_cargo_lines cl
     where cl.shipment_id = s.id)                    as product_count,
  (select coalesce(sum(cl.quantity), 0) from shipment_cargo_lines cl
     where cl.shipment_id = s.id)                    as total_quantity,
  (select coalesce(sum(cl.gross_weight_kg), 0) from shipment_cargo_lines cl
     where cl.shipment_id = s.id)                    as cargo_gross_weight_kg,
  (select coalesce(sum(cl.line_value), 0) from shipment_cargo_lines cl
     where cl.shipment_id = s.id)                    as product_value_total,
  (select coalesce(sum(inv.grand_total), 0) from logistics_invoices inv
     where inv.shipment_id = s.id)                   as invoice_grand_total,
  (select coalesce(sum(ch.amount), 0)
     from logistics_invoice_charges ch
     join logistics_invoices inv on inv.id = ch.invoice_id
     where inv.shipment_id = s.id)                   as charges_total,
  (select coalesce(sum(a.allocated_amount), 0)
     from logistics_charge_allocations a
     join logistics_invoice_charges ch on ch.id = a.charge_id
     join logistics_invoices inv on inv.id = ch.invoice_id
     where inv.shipment_id = s.id)                   as allocated_total,
  (select coalesce(sum(inv.grand_total), 0) from logistics_invoices inv
     where inv.shipment_id = s.id)
  - (select coalesce(sum(ch.amount), 0)
       from logistics_invoice_charges ch
       join logistics_invoices inv on inv.id = ch.invoice_id
       where inv.shipment_id = s.id)                 as invoice_charge_gap,
  (select coalesce(sum(ch.amount), 0)
     from logistics_invoice_charges ch
     join logistics_invoices inv on inv.id = ch.invoice_id
     where inv.shipment_id = s.id)
  - (select coalesce(sum(a.allocated_amount), 0)
       from logistics_charge_allocations a
       join logistics_invoice_charges ch on ch.id = a.charge_id
       join logistics_invoices inv on inv.id = ch.invoice_id
       where inv.shipment_id = s.id)                 as unallocated_amount
from shipments s;


create or replace view v_quote_vs_actual as
with selected as (
  select
    r.import_id,
    r.shipment_id,
    r.id as request_id,
    r.selected_quote_id,
    q.currency as quote_currency
  from freight_quote_requests r
  join freight_quotes q on q.id = r.selected_quote_id
  where r.selected_quote_id is not null
),
quoted as (
  select
    s.import_id,
    s.shipment_id,
    s.request_id,
    ct.code as charge_code,
    ct.name as charge_name,
    ct.costing_bucket,
    s.quote_currency,
    sum(
      case
        when c.charge_status = 'QUOTED' then
          coalesce(
            c.total_amount,
            case
              when c.calculation_method = 'FIXED' then c.rate
              when c.calculation_method = 'NONE' then null
              else c.rate * c.quantity
            end,
            0
          )
        else 0
      end
    ) as quoted_amount
  from selected s
  join freight_quote_charges c on c.quote_id = s.selected_quote_id
  join freight_charge_types ct on ct.code = c.charge_type
  group by s.import_id, s.shipment_id, s.request_id, ct.code, ct.name,
           ct.costing_bucket, s.quote_currency
),
actual as (
  select
    inv.import_id,
    inv.shipment_id,
    ct.code as charge_code,
    ct.name as charge_name,
    ct.costing_bucket,
    inv.currency as actual_currency,
    sum(ch.amount) as actual_amount
  from logistics_invoices inv
  join logistics_invoice_charges ch on ch.invoice_id = inv.id
  join freight_charge_types ct on ct.id = ch.charge_type_id
  group by inv.import_id, inv.shipment_id, ct.code, ct.name,
           ct.costing_bucket, inv.currency
)
select
  coalesce(q.import_id, a.import_id)                 as import_id,
  coalesce(q.shipment_id, a.shipment_id)             as shipment_id,
  q.request_id,
  coalesce(q.charge_code, a.charge_code)             as charge_code,
  coalesce(q.charge_name, a.charge_name)             as charge_name,
  coalesce(q.costing_bucket, a.costing_bucket)       as costing_bucket,
  q.quote_currency,
  a.actual_currency,
  coalesce(q.quoted_amount, 0)                       as quoted_amount,
  coalesce(a.actual_amount, 0)                       as actual_amount,
  coalesce(a.actual_amount, 0) - coalesce(q.quoted_amount, 0)
                                                     as diff_amount,
  case
    when coalesce(q.quoted_amount, 0) = 0 then null
    else round(
      ((coalesce(a.actual_amount, 0) - q.quoted_amount) / q.quoted_amount) * 100,
      2
    )
  end                                                as diff_pct
from quoted q
full outer join actual a
  on a.import_id = q.import_id
 and a.charge_code = q.charge_code
 and (a.shipment_id is not distinct from q.shipment_id);


-- Rebuild v_import_cost_lines to expose logistics_invoice_id
drop view if exists v_import_cost_lines;
create view v_import_cost_lines as
select
  ic.*,
  s.seq   as shipment_seq,
  s.shipment_no,
  (ic.fx_rate is null) as needs_rate
from import_costs ic
left join shipments s on s.id = ic.shipment_id;


-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'shipment_cargo_lines',
    'logistics_invoices',
    'logistics_invoice_charges',
    'logistics_charge_allocations'
  ]
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

grant select on v_cargo_line_costing to authenticated;
grant select on v_shipment_costing_summary to authenticated;
grant select on v_quote_vs_actual to authenticated;
grant select on v_import_cost_lines to authenticated;
