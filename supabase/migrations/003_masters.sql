-- ============================================================================
-- 003 Masters — supplier contacts, supplier bank accounts, CHAs and agents
--
-- The bank account design is the important part of this migration. Changing a
-- supplier's bank details is the single highest-risk edit in the whole system:
-- it is the classic invoice-fraud vector, and the money does not come back. So
-- bank details are NEVER updated in place — a change inserts a new row and
-- supersedes the old one, leaving the full history and forcing re-verification.
-- ============================================================================

-- ============================================================================
-- SUPPLIER CONTACTS
-- ============================================================================

create table if not exists supplier_contacts (
  id          uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references suppliers (id) on delete cascade,
  name        text not null,
  role        text,
  email       text,
  phone       text,
  whatsapp    text,
  is_primary  boolean not null default false,
  notes       text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists supplier_contacts_supplier_idx on supplier_contacts (supplier_id);
-- At most one primary contact per supplier.
create unique index if not exists supplier_contacts_one_primary
  on supplier_contacts (supplier_id) where is_primary and is_active;

drop trigger if exists supplier_contacts_updated_at on supplier_contacts;
create trigger supplier_contacts_updated_at
  before update on supplier_contacts
  for each row execute function touch_updated_at();

drop trigger if exists supplier_contacts_audit on supplier_contacts;
create trigger supplier_contacts_audit
  after insert or update or delete on supplier_contacts
  for each row execute function audit_row_change();


-- ============================================================================
-- SUPPLIER BANK ACCOUNTS
--
-- Append-only by convention: `supersede_bank_account()` is the only supported
-- way to change details, and it writes a new row rather than mutating one.
-- Carries the standard verification quartet (spec §34).
-- ============================================================================

create table if not exists supplier_bank_accounts (
  id                   uuid primary key default gen_random_uuid(),
  supplier_id          uuid not null references suppliers (id) on delete cascade,

  beneficiary_name     text not null,
  bank_name            text not null,
  account_no           text,
  iban                 text,
  swift                text,
  bank_address         text,
  intermediary_bank    text,
  intermediary_swift   text,
  currency             text,

  effective_from       date not null default current_date,
  is_current           boolean not null default true,
  superseded_by_id     uuid references supplier_bank_accounts (id),

  -- Received from the supplier is not the same as checked by a human.
  verification_status  text not null default 'received'
                       check (verification_status in ('received', 'verified', 'rejected')),
  verified_by          uuid references profiles (id),
  verified_at          timestamptz,
  verification_remarks text,

  source_note          text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists supplier_bank_supplier_idx on supplier_bank_accounts (supplier_id);
-- Exactly one current account per supplier per currency.
create unique index if not exists supplier_bank_one_current
  on supplier_bank_accounts (supplier_id, coalesce(currency, '')) where is_current;

drop trigger if exists supplier_bank_updated_at on supplier_bank_accounts;
create trigger supplier_bank_updated_at
  before update on supplier_bank_accounts
  for each row execute function touch_updated_at();

drop trigger if exists supplier_bank_audit on supplier_bank_accounts;
create trigger supplier_bank_audit
  after insert or update or delete on supplier_bank_accounts
  for each row execute function audit_row_change();

/**
 * Replace a supplier's bank details.
 *
 * Marks the existing current row superseded and inserts the new details as
 * unverified. Returns the new row's id. Deliberately the only path the app
 * offers — an UPDATE would destroy the evidence of what the details used to be.
 */
create or replace function supersede_bank_account(
  p_supplier_id        uuid,
  p_beneficiary_name   text,
  p_bank_name          text,
  p_account_no         text,
  p_iban               text,
  p_swift              text,
  p_bank_address       text,
  p_intermediary_bank  text,
  p_intermediary_swift text,
  p_currency           text,
  p_source_note        text
)
returns uuid
language plpgsql
as $$
declare
  v_old_id uuid;
  v_new_id uuid;
begin
  select id into v_old_id
  from supplier_bank_accounts
  where supplier_id = p_supplier_id
    and is_current
    and coalesce(currency, '') = coalesce(p_currency, '');

  -- Retire the old row BEFORE inserting: the unique index permits only one
  -- current account per supplier and currency, so inserting first would violate
  -- it. superseded_by_id is set afterwards, once the new id exists.
  if v_old_id is not null then
    update supplier_bank_accounts set is_current = false where id = v_old_id;
  end if;

  insert into supplier_bank_accounts (
    supplier_id, beneficiary_name, bank_name, account_no, iban, swift,
    bank_address, intermediary_bank, intermediary_swift, currency, source_note
  )
  values (
    p_supplier_id, p_beneficiary_name, p_bank_name, p_account_no, p_iban, p_swift,
    p_bank_address, p_intermediary_bank, p_intermediary_swift, p_currency, p_source_note
  )
  returning id into v_new_id;

  if v_old_id is not null then
    update supplier_bank_accounts set superseded_by_id = v_new_id where id = v_old_id;
  end if;

  return v_new_id;
end;
$$;


-- ============================================================================
-- CHAs AND OVERSEAS AGENTS
--
-- One CHA has many overseas agents across different countries (spec §12).
-- ============================================================================

create table if not exists chas (
  id             uuid primary key default gen_random_uuid(),
  name           text not null unique,
  company_name   text,
  contact_person text,
  email          text,
  phone          text,
  address        text,
  notes          text,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

drop trigger if exists chas_updated_at on chas;
create trigger chas_updated_at
  before update on chas
  for each row execute function touch_updated_at();

drop trigger if exists chas_audit on chas;
create trigger chas_audit
  after insert or update or delete on chas
  for each row execute function audit_row_change();

create table if not exists cha_agents (
  id             uuid primary key default gen_random_uuid(),
  cha_id         uuid not null references chas (id) on delete cascade,
  name           text not null,
  country        text,
  city           text,
  contact_person text,
  email          text,
  phone          text,
  -- Which shipment modes this agent handles: air / sea / courier / road.
  modes          text[] not null default '{}',
  notes          text,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists cha_agents_cha_idx on cha_agents (cha_id);
create index if not exists cha_agents_country_idx on cha_agents (country);

drop trigger if exists cha_agents_updated_at on cha_agents;
create trigger cha_agents_updated_at
  before update on cha_agents
  for each row execute function touch_updated_at();

drop trigger if exists cha_agents_audit on cha_agents;
create trigger cha_agents_audit
  after insert or update or delete on cha_agents
  for each row execute function audit_row_change();


-- ============================================================================
-- Link the CHA to the import.
--
-- Shipments arrive in Phase 6 and will carry their own CHA, which takes
-- precedence for that shipment. Until then this is the only place to record who
-- is clearing an import — and in the archive it is DV Logistics almost every
-- time, so it is worth capturing from the start.
-- ============================================================================

alter table imports add column if not exists cha_id uuid references chas (id);
create index if not exists imports_cha_idx on imports (cha_id) where not is_archived;


-- ============================================================================
-- RLS
-- ============================================================================

do $$
declare
  t text;
begin
  foreach t in array array['supplier_contacts', 'supplier_bank_accounts', 'chas', 'cha_agents']
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


-- ============================================================================
-- SEED — clearing agents seen in the archive.
--
-- DV Logistics handles freight AND clearance on most imports; Sabers appears on
-- the Cheemi import; UPS carries the courier consignments (JLCPCB, Digi-Key).
-- ============================================================================

insert into chas (name, company_name, notes) values
  ('DV Logistics', 'DV Logistics', 'Handles both freight forwarding and customs clearance on most imports.'),
  ('Sabers',       'Sabers',       'Freight on the Cheemi consignment.'),
  ('UPS',          'UPS',          'Courier imports — clears its own consignments.')
on conflict (name) do nothing;
