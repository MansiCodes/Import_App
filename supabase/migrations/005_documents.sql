-- ============================================================================
-- 005 Documents, checklist and verification
--
-- Three things the real archive forced into this design:
--
--   1. ONE FILE CAN BE TWO DOCUMENTS. `Updated_CI_PL_DIMENSION.pdf` and
--      `commercial invoice packing list_CNY 86,050.00.pdf` are each a single
--      file serving as both Commercial Invoice and Packing List. Hence the
--      many-to-many `document_type_map`, and hence one upload can satisfy two
--      checklist rows.
--
--   2. DOCUMENTS GET REVISED SILENTLY. `Packing_List_481_boxes.pdf` was
--      superseded by `Revised_Packing_list_479packages.pdf` — a two-package
--      difference that reaches customs. Versions are never overwritten.
--
--   3. CHECKLIST STATE IS DERIVED, NOT STORED. A stored state drifts the moment
--      a document is added outside the flow that sets it. Requirement (required
--      / optional / not applicable) is the operator's choice and is stored;
--      whether it is satisfied is computed from the documents themselves.
-- ============================================================================

-- ============================================================================
-- DOCUMENT TYPES — configurable (spec §17 allows custom types)
-- ============================================================================

create table if not exists document_types (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique,
  name       text not null,
  category   text not null check (category in (
               'Commercial', 'Payment', 'Production', 'Shipping',
               'Freight', 'Customs', 'Delivery', 'Reference', 'Other')),
  -- Seeded types cannot be deleted, only deactivated — the checklist templates
  -- reference them.
  is_system  boolean not null default false,
  sort_order integer not null default 100,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists document_types_updated_at on document_types;
create trigger document_types_updated_at
  before update on document_types
  for each row execute function touch_updated_at();


-- ============================================================================
-- DOCUMENTS — the logical slot, and its versions
-- ============================================================================

create table if not exists documents (
  id         uuid primary key default gen_random_uuid(),
  import_id  uuid not null references imports (id) on delete cascade,
  -- Payment documents (remittance request, debit advice, SWIFT, FX advice) hang
  -- off a specific payment; everything else hangs off the import.
  payment_id uuid references import_payments (id) on delete set null,
  title      text not null,
  notes      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists documents_import_idx on documents (import_id);

drop trigger if exists documents_updated_at on documents;
create trigger documents_updated_at
  before update on documents
  for each row execute function touch_updated_at();

drop trigger if exists documents_audit on documents;
create trigger documents_audit
  after insert or update or delete on documents
  for each row execute function audit_row_change();

-- A document can be of several types at once.
create table if not exists document_type_map (
  document_id      uuid not null references documents (id) on delete cascade,
  document_type_id uuid not null references document_types (id) on delete restrict,
  primary key (document_id, document_type_id)
);

create index if not exists document_type_map_type_idx on document_type_map (document_type_id);

create table if not exists document_versions (
  id                   uuid primary key default gen_random_uuid(),
  document_id          uuid not null references documents (id) on delete cascade,
  version_no           integer not null,

  -- Google Drive stays the repository; we hold the pointer (spec §17).
  drive_url            text,
  drive_file_id        text,
  file_name            text,

  received_at          date not null default current_date,
  status               text not null default 'current'
                       check (status in ('current', 'superseded', 'rejected')),
  superseded_by_id     uuid references document_versions (id),

  -- Arrived is not the same as checked (spec §20).
  verification_status  text not null default 'received'
                       check (verification_status in ('received', 'verified', 'rejected')),
  verified_by          uuid references profiles (id),
  verified_at          timestamptz,
  verification_remarks text,

  notes                text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  unique (document_id, version_no)
);

create index if not exists document_versions_document_idx on document_versions (document_id);
-- Exactly one current version per document — the invariant that makes "which
-- one is the real invoice?" answerable.
create unique index if not exists document_versions_one_current
  on document_versions (document_id) where status = 'current';

drop trigger if exists document_versions_updated_at on document_versions;
create trigger document_versions_updated_at
  before update on document_versions
  for each row execute function touch_updated_at();

drop trigger if exists document_versions_audit on document_versions;
create trigger document_versions_audit
  after insert or update or delete on document_versions
  for each row execute function audit_row_change();

/**
 * Add a new version of a document, superseding whatever was current.
 *
 * The only supported way to record a revision — an UPDATE would destroy the
 * evidence that the packing list once said 481 packages.
 */
create or replace function add_document_version(
  p_document_id   uuid,
  p_drive_url     text,
  p_drive_file_id text,
  p_file_name     text,
  p_received_at   date,
  p_notes         text
)
returns uuid
language plpgsql
as $$
declare
  v_old_id  uuid;
  v_next_no integer;
  v_new_id  uuid;
begin
  select id into v_old_id
  from document_versions
  where document_id = p_document_id and status = 'current';

  select coalesce(max(version_no), 0) + 1 into v_next_no
  from document_versions
  where document_id = p_document_id;

  -- Retire the old version FIRST: the unique index allows only one current
  -- version, so inserting before superseding would violate it.
  if v_old_id is not null then
    update document_versions set status = 'superseded' where id = v_old_id;
  end if;

  insert into document_versions (
    document_id, version_no, drive_url, drive_file_id, file_name, received_at, notes
  )
  values (
    p_document_id, v_next_no, p_drive_url, p_drive_file_id, p_file_name,
    coalesce(p_received_at, current_date), p_notes
  )
  returning id into v_new_id;

  if v_old_id is not null then
    update document_versions set superseded_by_id = v_new_id where id = v_old_id;
  end if;

  return v_new_id;
end;
$$;


-- ============================================================================
-- CHECKLIST
--
-- Templates differ by shipment mode: a courier import must not be asked for a
-- Bill of Lading, and the archive's JLCPCB imports have four documents in total.
-- ============================================================================

create table if not exists checklist_templates (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  mode       text not null default 'any' check (mode in ('any', 'air', 'sea', 'courier', 'road')),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists checklist_template_items (
  id               uuid primary key default gen_random_uuid(),
  template_id      uuid not null references checklist_templates (id) on delete cascade,
  document_type_id uuid not null references document_types (id) on delete cascade,
  gate             text not null check (gate in (
                     'before_payment', 'before_pickup', 'before_shipment',
                     'customs', 'post_clearance')),
  requirement      text not null default 'required'
                   check (requirement in ('required', 'optional')),
  sort_order       integer not null default 100,
  unique (template_id, document_type_id, gate)
);

-- Per-import checklist. Stores only what the OPERATOR decides — whether the
-- item is required at all. Whether it is satisfied is computed (see the view).
create table if not exists document_checklist (
  id               uuid primary key default gen_random_uuid(),
  import_id        uuid not null references imports (id) on delete cascade,
  document_type_id uuid not null references document_types (id) on delete cascade,
  gate             text not null check (gate in (
                     'before_payment', 'before_pickup', 'before_shipment',
                     'customs', 'post_clearance')),
  requirement      text not null default 'required'
                   check (requirement in ('required', 'optional', 'not_applicable')),
  notes            text,
  sort_order       integer not null default 100,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (import_id, document_type_id, gate)
);

create index if not exists document_checklist_import_idx on document_checklist (import_id);

drop trigger if exists document_checklist_updated_at on document_checklist;
create trigger document_checklist_updated_at
  before update on document_checklist
  for each row execute function touch_updated_at();

drop trigger if exists document_checklist_audit on document_checklist;
create trigger document_checklist_audit
  after insert or update or delete on document_checklist
  for each row execute function audit_row_change();

/**
 * Instantiate a checklist for an import from a template.
 * Existing rows are left alone, so re-running never overwrites the operator's
 * "not applicable" decisions.
 */
create or replace function apply_checklist_template(p_import_id uuid, p_template_id uuid)
returns integer
language plpgsql
as $$
declare
  v_added integer;
begin
  insert into document_checklist (import_id, document_type_id, gate, requirement, sort_order)
  select p_import_id, i.document_type_id, i.gate, i.requirement, i.sort_order
  from checklist_template_items i
  where i.template_id = p_template_id
  on conflict (import_id, document_type_id, gate) do nothing;

  get diagnostics v_added = row_count;
  return v_added;
end;
$$;


-- ============================================================================
-- DERIVED CHECKLIST STATE
--
-- Computed from the documents that actually exist, so it cannot drift out of
-- sync with reality. A document satisfies a checklist row if it is mapped to
-- that type and has a current version.
-- ============================================================================

create or replace view v_document_checklist as
select
  cl.id,
  cl.import_id,
  cl.document_type_id,
  dt.code                as type_code,
  dt.name                as type_name,
  dt.category,
  cl.gate,
  cl.requirement,
  cl.notes,
  cl.sort_order,
  d.id                   as document_id,
  dv.id                  as version_id,
  dv.version_no,
  dv.drive_url,
  dv.file_name,
  dv.received_at,
  dv.verification_status,
  case
    when cl.requirement = 'not_applicable'          then 'not_applicable'
    when dv.id is null                              then 'pending'
    when dv.verification_status = 'rejected'        then 'rejected'
    when dv.verification_status = 'verified'        then 'verified'
    else 'received'
  end                    as state
from document_checklist cl
join document_types dt on dt.id = cl.document_type_id
left join lateral (
  select d.id
  from documents d
  join document_type_map m on m.document_id = d.id
  where d.import_id = cl.import_id
    and m.document_type_id = cl.document_type_id
    and exists (select 1 from document_versions v
                where v.document_id = d.id and v.status = 'current')
  order by d.created_at desc
  limit 1
) d on true
left join document_versions dv
  on dv.document_id = d.id and dv.status = 'current';


-- ============================================================================
-- VERIFICATION CENTRE (spec §21)
--
-- One feed of everything a human still has to confirm. Each phase adds a branch
-- here; customs amounts and landed cost join it later.
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
  and i.status not in ('Closed', 'Cancelled');


-- ============================================================================
-- RLS
-- ============================================================================

do $$
declare
  t text;
begin
  foreach t in array array['document_types', 'documents', 'document_type_map',
                           'document_versions', 'checklist_templates',
                           'checklist_template_items', 'document_checklist']
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

grant select on v_document_checklist to authenticated;
grant select on v_verification_queue to authenticated;


-- ============================================================================
-- SEED — document types.
--
-- The spec's list, PLUS types that only showed up in the real folders:
-- Sales Order Confirmation, Terminal Receipt, AAI Receipt, DO Charges Invoice,
-- FX Advice, Bank Imaging / IDPMS submission, country declarations, and the
-- per-batch spool certificates on the Thermocable consignments.
-- ============================================================================

insert into document_types (code, name, category, is_system, sort_order) values
  ('requirement',      'Requirement',                  'Commercial', true, 10),
  ('quotation',        'Quotation',                    'Commercial', true, 20),
  ('pi',               'Proforma Invoice',             'Commercial', true, 30),
  ('signed_pi',        'Signed PI',                    'Commercial', true, 40),
  ('po',               'Purchase Order',               'Commercial', true, 50),
  ('sales_order',      'Sales Order Confirmation',     'Commercial', true, 60),
  ('commercial_invoice','Commercial Invoice',          'Commercial', true, 70),
  ('packing_list',     'Packing List',                 'Commercial', true, 80),

  ('bank_details',     'Bank Details',                 'Payment',    true, 110),
  ('payment_request',  'Remittance Request',           'Payment',    true, 120),
  ('debit_advice',     'Debit Advice',                 'Payment',    true, 130),
  ('swift_copy',       'SWIFT Copy',                   'Payment',    true, 140),
  ('fx_advice',        'FX Advice',                    'Payment',    true, 150),
  ('bank_imaging',     'Bank Imaging / IDPMS Submission','Payment',  true, 160),

  ('production_update','Production Update',            'Production', true, 210),
  ('test_certificate', 'Test Certificate',             'Production', true, 220),
  ('batch_certificate','Batch / Spool Certificate',    'Production', true, 230),

  ('insurance',        'Insurance Certificate',        'Shipping',   true, 310),
  ('awb',              'Airway Bill',                  'Shipping',   true, 320),
  ('hawb',             'House Airway Bill',            'Shipping',   true, 330),
  ('bl',               'Bill of Lading',               'Shipping',   true, 340),

  ('freight_quotation','Freight Quotation',            'Freight',    true, 410),
  ('freight_invoice',  'Freight Invoice',              'Freight',    true, 420),
  ('cha_bill',         'CHA Bill',                     'Freight',    true, 430),
  ('post_clearance_bill','Post-Clearance Bill',        'Freight',    true, 440),
  ('do_charges',       'DO Charges Invoice',           'Freight',    true, 450),

  ('boe',              'Bill of Entry',                'Customs',    true, 510),
  ('duty_challan',     'Duty Challan',                 'Customs',    true, 520),
  ('icegate_receipt',  'ICEGATE Receipt',              'Customs',    true, 530),
  ('oocc',             'Out of Charge (OOCC)',         'Customs',    true, 540),
  ('terminal_receipt', 'Terminal Receipt',             'Customs',    true, 550),
  ('aai_receipt',      'AAI Receipt',                  'Customs',    true, 560),

  ('gate_pass',        'Gate Pass',                    'Delivery',   true, 610),
  ('eway_bill',        'E-Way Bill',                   'Delivery',   true, 620),
  ('material_receipt', 'Material Receipt',             'Delivery',   true, 630),

  ('catalogue',        'Catalogue',                    'Reference',  true, 710),
  ('declaration',      'Country Declaration',          'Reference',  true, 720),
  ('certificate',      'Certificate',                  'Reference',  true, 730),
  ('misc',             'Miscellaneous',                'Other',      true, 900)
on conflict (code) do nothing;


-- ============================================================================
-- SEED — checklist templates.
--
-- Air and sea share the full set; courier is deliberately tiny, because the
-- archive's courier imports genuinely have no PO, no PI and no freight
-- arrangement — asking for them would train the operator to ignore the list.
-- ============================================================================

insert into checklist_templates (name, mode, is_default) values
  ('Standard air',     'air',     true),
  ('Standard sea',     'sea',     true),
  ('Courier / small',  'courier', true)
on conflict (name) do nothing;

-- Full templates for air and sea.
insert into checklist_template_items (template_id, document_type_id, gate, requirement, sort_order)
select t.id, dt.id, x.gate, x.requirement, dt.sort_order
from checklist_templates t
cross join (values
  ('pi',                'before_payment',  'required'),
  ('signed_pi',         'before_payment',  'optional'),
  ('po',                'before_payment',  'required'),
  ('bank_details',      'before_payment',  'required'),
  ('commercial_invoice','before_pickup',   'required'),
  ('packing_list',      'before_pickup',   'required'),
  ('insurance',         'before_shipment', 'optional'),
  ('freight_quotation', 'before_shipment', 'optional'),
  ('boe',               'customs',         'required'),
  ('duty_challan',      'customs',         'required'),
  ('icegate_receipt',   'customs',         'optional'),
  ('oocc',              'customs',         'required'),
  ('gate_pass',         'post_clearance',  'required'),
  ('eway_bill',         'post_clearance',  'required'),
  ('material_receipt',  'post_clearance',  'required'),
  ('cha_bill',          'post_clearance',  'optional')
) as x(code, gate, requirement)
join document_types dt on dt.code = x.code
where t.name in ('Standard air', 'Standard sea')
on conflict (template_id, document_type_id, gate) do nothing;

-- Mode-specific transport document.
insert into checklist_template_items (template_id, document_type_id, gate, requirement, sort_order)
select t.id, dt.id, 'before_shipment', 'required', 300
from checklist_templates t
join document_types dt
  on dt.code = case when t.mode = 'air' then 'awb' else 'bl' end
where t.name in ('Standard air', 'Standard sea')
on conflict (template_id, document_type_id, gate) do nothing;

-- Courier: what a JLCPCB or Digi-Key consignment actually produces.
insert into checklist_template_items (template_id, document_type_id, gate, requirement, sort_order)
select t.id, dt.id, x.gate, x.requirement, dt.sort_order
from checklist_templates t
cross join (values
  ('commercial_invoice', 'before_pickup',  'required'),
  ('boe',                'customs',        'required'),
  ('icegate_receipt',    'customs',        'optional'),
  ('oocc',               'customs',        'optional'),
  ('gate_pass',          'post_clearance', 'optional')
) as x(code, gate, requirement)
join document_types dt on dt.code = x.code
where t.name = 'Courier / small'
on conflict (template_id, document_type_id, gate) do nothing;
