-- ============================================================================
-- 017 Freight quote requests, recipients, quotes and charges
--
-- Replaces a round of WhatsApp messages and an Excel comparison sheet: one
-- request goes to several CHAs, each opens a private link, fills a structured
-- form, and the app puts the answers side by side.
--
-- Three decisions worth stating, because each is a trap avoided:
--
--   CHARGE STATUS IS SEPARATE FROM CALCULATION METHOD. "At actual" is not a way
--   of calculating a number — it is the absence of one. Keeping both in one
--   column is how an unpriced charge silently becomes zero and the wrong quote
--   looks cheapest. Only `QUOTED` rows contribute to a comparable total;
--   everything else is carried through as a named unknown.
--
--   THE AGENT'S OWN FIGURES ARE PRESERVED VERBATIM. Their FX rate and their
--   stated total are stored beside ours, never replaced by them. Where the two
--   disagree, that is worth seeing rather than smoothing over.
--
--   QUOTES ARE VERSIONED, NEVER OVERWRITTEN. A revision supersedes the previous
--   version the same way a revised packing list does (migration 005), so "what
--   did they originally offer?" stays answerable.
-- ============================================================================


-- ============================================================================
-- CHARGE TYPES — reference data, not an enum
--
-- Follows document_types (005): the business will meet charges nobody listed
-- today, and meeting one should be a row rather than a migration. `applies_to`
-- drives which lines each form offers.
-- ============================================================================

create table if not exists freight_charge_types (
  id             uuid primary key default gen_random_uuid(),
  code           text not null unique,
  name           text not null,
  -- Which modes offer this line: {AIR}, {SEA_LCL}, or both.
  applies_to     text[] not null default '{}',
  -- The method an agent most often uses, offered as the default and freely
  -- changed by them. Never enforced.
  default_method text,
  is_system      boolean not null default false,
  sort_order     integer not null default 100,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

drop trigger if exists freight_charge_types_updated_at on freight_charge_types;
create trigger freight_charge_types_updated_at
  before update on freight_charge_types
  for each row execute function touch_updated_at();


-- ============================================================================
-- REQUEST NUMBERS — FQR-YYYY-NNNN, allocated atomically like import numbers.
-- ============================================================================

create table if not exists freight_quote_sequences (
  year     integer primary key,
  next_seq integer not null default 1
);

create or replace function next_quote_request_no(p_year integer default null)
returns text
language plpgsql
as $$
declare
  v_year integer;
  v_seq  integer;
begin
  v_year := coalesce(p_year, extract(year from current_date)::integer);

  insert into freight_quote_sequences (year, next_seq)
  values (v_year, 2)
  on conflict (year) do update
    set next_seq = freight_quote_sequences.next_seq + 1
  returning next_seq - 1 into v_seq;

  return 'FQR-' || v_year::text || '-' || lpad(v_seq::text, 4, '0');
end;
$$;


-- ============================================================================
-- QUOTE REQUESTS
-- ============================================================================

create table if not exists freight_quote_requests (
  id                   uuid primary key default gen_random_uuid(),
  import_id            uuid not null references imports (id) on delete cascade,
  -- Nullable on purpose: a quote is usually needed BEFORE a shipment record
  -- exists — the freight decision is what creates one.
  shipment_id          uuid references shipments (id) on delete set null,

  request_no           text not null unique,

  -- SEA_FCL and COURIER are permitted here so extending the app later is a UI
  -- change rather than a migration. Only AIR and SEA_LCL are offered today.
  mode                 text not null check (mode in ('AIR', 'SEA_LCL', 'SEA_FCL', 'COURIER')),

  status               text not null default 'Draft' check (status in (
                         'Draft', 'Open', 'Partially Submitted', 'Complete',
                         'Closed', 'Cancelled')),

  -- Shipment facts copied from the import or shipment, so a CHA never re-enters
  -- what we already know — and editable before sending, because we are
  -- sometimes wrong.
  origin               text,
  destination          text,
  incoterm             text,
  cargo_description    text,
  gross_weight_kg      numeric(14, 3),
  net_weight_kg        numeric(14, 3),
  chargeable_weight_kg numeric(14, 3),
  cbm                  numeric(14, 3),
  package_count        integer,
  pallet_count         integer,

  request_notes        text,
  response_deadline    date,

  -- What quotes are normalised into for comparison. The rates themselves are
  -- entered per request below — never fetched, in keeping with the rest of the
  -- app.
  comparison_currency  text not null default 'INR',

  selected_quote_id    uuid,
  selected_by          uuid references profiles (id),
  selected_at          timestamptz,
  selection_reason     text,

  created_by           uuid references profiles (id),
  closed_at            timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists fq_requests_import_idx on freight_quote_requests (import_id);
create index if not exists fq_requests_status_idx on freight_quote_requests (status)
  where status not in ('Closed', 'Cancelled');

drop trigger if exists fq_requests_updated_at on freight_quote_requests;
create trigger fq_requests_updated_at
  before update on freight_quote_requests
  for each row execute function touch_updated_at();

drop trigger if exists fq_requests_audit on freight_quote_requests;
create trigger fq_requests_audit
  after insert or update or delete on freight_quote_requests
  for each row execute function audit_row_change();


-- ============================================================================
-- COMPARISON RATES
--
-- One rate per currency per request, entered by a person. Held apart from the
-- agent's own rate so "what did they assume" and "what are we comparing at"
-- can never be confused with each other.
-- ============================================================================

create table if not exists freight_quote_fx_rates (
  quote_request_id   uuid not null references freight_quote_requests (id) on delete cascade,
  currency           text not null,
  rate_to_comparison numeric(18, 6) not null check (rate_to_comparison > 0),
  set_by             uuid references profiles (id),
  set_at             timestamptz not null default now(),
  primary key (quote_request_id, currency)
);

drop trigger if exists fq_fx_audit on freight_quote_fx_rates;
create trigger fq_fx_audit
  after insert or update or delete on freight_quote_fx_rates
  for each row execute function audit_row_change();


-- ============================================================================
-- RECIPIENTS — one private link each
--
-- Never one shared link: a shared link cannot tell you who answered, cannot be
-- revoked for a single party, and lets any holder see that submissions exist.
-- ============================================================================

create table if not exists freight_quote_request_recipients (
  id               uuid primary key default gen_random_uuid(),
  quote_request_id uuid not null references freight_quote_requests (id) on delete cascade,

  cha_id           uuid references chas (id) on delete set null,
  agent_id         uuid references cha_agents (id) on delete set null,

  -- Denormalised deliberately: who we actually sent it to, as they were at the
  -- time. Renaming a CHA next year must not rewrite this history.
  recipient_name   text not null,
  phone            text,
  email            text,

  /*
   * The token is stored as issued rather than hashed.
   *
   * Hashing is the stronger choice when a link is shown once. Here it is the
   * operator's only distribution mechanism — they copy it into WhatsApp by
   * hand, repeatedly — and a hash cannot be reversed to show them the link
   * again. Rotating on each copy would invalidate links already sent.
   *
   * The exposure is bounded and mitigated instead: the portal shows shipment
   * facts and that recipient's own form, and nothing else — no documents, no
   * other agent, no prices. Tokens are 32 random bytes, individually revocable,
   * optionally expiring, and the table is unreachable except through the server.
   */
  token            text not null unique,
  token_expires_at timestamptz,
  revoked_at       timestamptz,

  status           text not null default 'Pending' check (status in (
                     'Pending', 'Sent', 'Viewed', 'Submitted', 'Revised',
                     'Declined', 'Revoked')),

  sent_at          timestamptz,
  first_viewed_at  timestamptz,
  last_viewed_at   timestamptz,
  submitted_at     timestamptz,

  latest_quote_id  uuid,
  reminder_count   integer not null default 0,
  last_reminder_at timestamptz,

  decline_reason   text,
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists fq_recipients_request_idx
  on freight_quote_request_recipients (quote_request_id);
create index if not exists fq_recipients_token_idx
  on freight_quote_request_recipients (token);

drop trigger if exists fq_recipients_updated_at on freight_quote_request_recipients;
create trigger fq_recipients_updated_at
  before update on freight_quote_request_recipients
  for each row execute function touch_updated_at();

drop trigger if exists fq_recipients_audit on freight_quote_request_recipients;
create trigger fq_recipients_audit
  after insert or update or delete on freight_quote_request_recipients
  for each row execute function audit_row_change();


-- ============================================================================
-- QUOTES — one row per submission, versioned
-- ============================================================================

create table if not exists freight_quotes (
  id                   uuid primary key default gen_random_uuid(),
  quote_request_id     uuid not null references freight_quote_requests (id) on delete cascade,
  recipient_id         uuid not null references freight_quote_request_recipients (id) on delete cascade,

  version_no           integer not null,
  is_current           boolean not null default true,

  -- Routing, as offered.
  carrier              text,
  routing              text,
  transit_time         text,
  schedule_note        text,
  free_days            integer,
  origin               text,
  destination          text,
  incoterm             text,

  -- Cargo AS THE AGENT READ IT, kept apart from the request's own figures. A
  -- chargeable weight they worked out differently is the commonest reason two
  -- quotes are not comparable, and it has to be visible rather than assumed.
  gross_weight_kg      numeric(14, 3),
  chargeable_weight_kg numeric(14, 3),
  cbm                  numeric(14, 3),
  package_count        integer,
  pallet_count         integer,

  currency             text not null,
  -- Theirs, preserved. Never used for our comparison.
  agent_fx_rate        numeric(18, 6),
  -- What they said the total is. Compared against the sum of their own lines,
  -- never silently replaced by it.
  agent_quoted_total   numeric(18, 4),

  validity_date        date,
  remarks              text,

  submitted_at         timestamptz not null default now(),
  created_at           timestamptz not null default now(),

  unique (recipient_id, version_no)
);

create index if not exists fq_quotes_request_idx on freight_quotes (quote_request_id);
-- Exactly one current version per recipient — the invariant that makes "which
-- quote are we comparing?" answerable.
create unique index if not exists fq_quotes_one_current
  on freight_quotes (recipient_id) where is_current;

drop trigger if exists fq_quotes_audit on freight_quotes;
create trigger fq_quotes_audit
  after insert or update or delete on freight_quotes
  for each row execute function audit_row_change();

-- Added after both tables exist, so creation order does not matter.
alter table freight_quote_requests
  drop constraint if exists freight_quote_requests_selected_quote_fk;
alter table freight_quote_requests
  add constraint freight_quote_requests_selected_quote_fk
  foreign key (selected_quote_id) references freight_quotes (id) on delete set null;

alter table freight_quote_request_recipients
  drop constraint if exists fq_recipients_latest_quote_fk;
alter table freight_quote_request_recipients
  add constraint fq_recipients_latest_quote_fk
  foreign key (latest_quote_id) references freight_quotes (id) on delete set null;


-- ============================================================================
-- CHARGES
-- ============================================================================

create table if not exists freight_quote_charges (
  id                 uuid primary key default gen_random_uuid(),
  quote_id           uuid not null references freight_quotes (id) on delete cascade,

  charge_type        text not null,
  -- Set when an agent adds a line we do not know about. Real quotations do.
  custom_label       text,

  currency           text not null,

  -- HOW the number was reached. NONE when there is no number to reach.
  calculation_method text not null default 'FIXED' check (calculation_method in (
                       'FIXED', 'PER_KG', 'PER_CHARGEABLE_KG', 'PER_PACKAGE',
                       'PER_PALLET', 'PER_CBM', 'NONE')),

  -- WHETHER there is a number at all. Only QUOTED counts toward a comparable
  -- total; the rest are carried into the comparison as named unknowns.
  charge_status      text not null default 'QUOTED' check (charge_status in (
                       'QUOTED', 'AT_ACTUAL', 'AS_PER_RECEIPT', 'INCLUDED',
                       'NOT_APPLICABLE', 'EXCLUDED')),

  rate               numeric(18, 4),
  quantity           numeric(14, 3),
  quantity_unit      text,
  -- What the line comes to in its own currency. Worked out for the agent from
  -- rate x quantity, and overridable — their own sheet sometimes rounds.
  total_amount       numeric(18, 4),

  remarks            text,
  sort_order         integer not null default 100,
  created_at         timestamptz not null default now()
);

create index if not exists fq_charges_quote_idx on freight_quote_charges (quote_id);

drop trigger if exists fq_charges_audit on freight_quote_charges;
create trigger fq_charges_audit
  after insert or update or delete on freight_quote_charges
  for each row execute function audit_row_change();


-- ============================================================================
-- Contact points on the CHA master.
--
-- Neither table had anywhere to keep a WhatsApp number. Group ids are recorded
-- for later: the official Cloud API cannot address a group, so nothing sends to
-- one today, but the operator already knows which group each CHA uses.
-- ============================================================================

alter table chas
  add column if not exists whatsapp_phone text,
  add column if not exists whatsapp_group_id text;

alter table cha_agents
  add column if not exists whatsapp_phone text;


-- ============================================================================
-- REQUEST PROGRESS — the counts every screen asks for.
-- ============================================================================

create or replace view v_freight_quote_requests as
select
  r.*,
  i.import_no,
  c.short_code                                            as company_code,
  s.name                                                  as supplier_name,
  (select count(*) from freight_quote_request_recipients p
     where p.quote_request_id = r.id)                     as recipient_count,
  (select count(*) from freight_quote_request_recipients p
     where p.quote_request_id = r.id
       and p.status in ('Submitted', 'Revised'))          as submitted_count,
  (select count(*) from freight_quote_request_recipients p
     where p.quote_request_id = r.id
       and p.status = 'Pending')                          as pending_count,
  (select count(*) from freight_quote_request_recipients p
     where p.quote_request_id = r.id
       and p.status = 'Viewed')                           as viewed_count
from freight_quote_requests r
join imports i on i.id = r.import_id
join companies c on c.id = i.company_id
left join suppliers s on s.id = i.supplier_id;


-- ============================================================================
-- RLS
--
-- Same posture as every other table: enabled, scoped to `authenticated`, and
-- nothing granted to `anon`. The public portal does NOT read through the anon
-- key — it runs server-side and looks the recipient up by token, so the portal
-- being public never makes the data public.
-- ============================================================================

do $$
declare
  t text;
begin
  foreach t in array array['freight_charge_types', 'freight_quote_sequences',
                           'freight_quote_requests', 'freight_quote_fx_rates',
                           'freight_quote_request_recipients', 'freight_quotes',
                           'freight_quote_charges']
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

grant select on v_freight_quote_requests to authenticated;


-- ============================================================================
-- SEED — the charge lines our actual CHA quotations contain.
-- ============================================================================

insert into freight_charge_types (code, name, applies_to, default_method, is_system, sort_order) values
  ('air_freight',       'Air Freight',            '{AIR}',            'PER_CHARGEABLE_KG', true, 10),
  ('ocean_freight',     'Ocean Freight',          '{SEA_LCL}',        'PER_CBM',           true, 10),
  ('origin_exw',        'EXW / Origin Charges',   '{AIR,SEA_LCL}',    'FIXED',             true, 20),
  ('xray',              'X-Ray / Inspection',     '{AIR}',            'PER_KG',            true, 30),
  ('house_do',          'House DO',               '{AIR,SEA_LCL}',    'FIXED',             true, 40),
  ('airline_do',        'Airline DO',             '{AIR}',            'FIXED',             true, 50),
  ('do_fees',           'DO Fees',                '{SEA_LCL}',        'FIXED',             true, 50),
  ('aai',               'AAI Charges',            '{AIR}',            'FIXED',             true, 60),
  ('cfs_terminal',      'CFS / Terminal Charges', '{SEA_LCL}',        'FIXED',             true, 60),
  ('customs_clearance', 'Customs Clearance',      '{AIR,SEA_LCL}',    'FIXED',             true, 70),
  ('labour',            'Labour / Loading',       '{AIR,SEA_LCL}',    'FIXED',             true, 80),
  ('local_delivery',    'Transportation / Local Delivery', '{AIR,SEA_LCL}', 'FIXED',       true, 90),
  ('documentation',     'Documentation / BL Charges', '{SEA_LCL}',    'FIXED',             true, 95),
  ('misc',              'Miscellaneous',          '{AIR,SEA_LCL}',    'FIXED',             true, 100)
on conflict (code) do nothing;


-- ============================================================================
-- SEED — the message the operator pastes into WhatsApp.
--
-- Configurable rather than hardcoded, in keeping with the rest of the app. The
-- app never sends this: it renders it, the operator copies it, and it goes into
-- whichever group they already use. Deliberately says nothing about PI or
-- packing list, because those are shared separately by hand.
-- ============================================================================

insert into app_settings (key, value, description) values (
  'freight_quote_message_template',
  to_jsonb($tpl$Hello,

Please submit your freight quotation for the following shipment.

Import: {{import_no}}
Mode: {{mode}}
Origin: {{origin}}
Destination: {{destination}}
Gross weight: {{gross_weight}}
Packages: {{package_count}}

Submit your quotation here:
{{quote_link}}

{{deadline_line}}
Thank you.$tpl$::text),
  'The WhatsApp message shown for copying when a freight quote request goes out.'
)
on conflict (key) do nothing;
