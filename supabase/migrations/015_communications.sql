-- ============================================================================
-- 015 Communications — WhatsApp intake (phase W1-W3)
--
-- The operator forwards operational messages from suppliers, factories, CHAs
-- and agents into a dedicated chat. This records them. It does not act on them.
--
-- The separation this schema enforces is the whole point:
--
--   communications            what was said                    (fact)
--   communication_parses      what we think it meant           (belief)
--   communication_suggestions what we propose doing about it   (proposal)
--   ... a human approves ...
--   imports / shipments / …   what is true of the business     (record)
--
-- Nothing a supplier says may cross into the last layer without a person
-- agreeing to it. That is why the matcher's guess is called
-- `matched_import_id` and NOT `import_id`: audit_row_change() files any row
-- carrying an `import_id` against that import, and an unconfirmed guess has no
-- business appearing on an import's audit trail. `communications.import_id` is
-- the human's link, and it is deliberately a different column on a different
-- table.
--
-- NOTE FOR THE NEXT MIGRATION: this one adds no column to `imports`, so it does
-- not rebuild v_import_summary. If a later phase adds even one column there, it
-- MUST `drop view if exists v_import_summary;` and recreate the whole 014 body
-- — `create or replace view` cannot change a column list, which is the entire
-- reason migration 014 exists.
-- ============================================================================


-- ============================================================================
-- COMMUNICATIONS — the raw message, durable before anything interprets it.
--
-- Provider-agnostic from the first row. WhatsApp is the only source today, but
-- an email intake would be the same table with `source = 'gmail'`, and building
-- a second table later would mean a second Inbox.
-- ============================================================================

create table if not exists communications (
  id                  uuid primary key default gen_random_uuid(),

  source              text not null default 'whatsapp'
                      check (source in ('whatsapp', 'gmail', 'manual')),
  provider            text,
  provider_message_id text,
  direction           text not null default 'inbound'
                      check (direction in ('inbound', 'outbound')),

  -- Three identities, deliberately kept apart. A forwarded WhatsApp message
  -- arrives from the OPERATOR'S handset, not from the supplier — the provider
  -- payload says so, and pretending otherwise would attribute a promise to the
  -- wrong party. Where the original sender is not in the payload, these stay
  -- null. Never infer them.
  forwarded_by_phone  text,
  forwarded_by_name   text,
  sender_phone        text,
  sender_name         text,

  sender_role         text check (sender_role is null or sender_role in (
                        'Supplier', 'CHA', 'Overseas Agent', 'Bank', 'Customs',
                        'Transporter', 'Insurance', 'Internal', 'Unknown')),
  sender_supplier_id  uuid references suppliers (id) on delete set null,
  sender_contact_id   uuid references supplier_contacts (id) on delete set null,
  sender_cha_id       uuid references chas (id) on delete set null,
  sender_cha_agent_id uuid references cha_agents (id) on delete set null,
  sender_match_method text check (sender_match_method is null or sender_match_method in (
                        'phone_exact', 'phone_suffix', 'manual', 'none')),

  message_type        text not null default 'text' check (message_type in (
                        'text', 'image', 'document', 'audio', 'video',
                        'contact', 'location', 'other')),
  body_text           text,

  -- The PROVIDER'S timestamp. "Tomorrow" is resolved against when the message
  -- was sent, never against when our server happened to receive it.
  sent_at             timestamptz,
  received_at         timestamptz not null default now(),

  raw_payload         jsonb not null default '{}'::jsonb,

  status              text not null default 'new'
                      check (status in ('new', 'in_review', 'actioned', 'ignored', 'archived')),

  -- The HUMAN's link to an import. The matcher's belief lives elsewhere.
  import_id           uuid references imports (id) on delete set null,
  linked_by           uuid references profiles (id),
  linked_at           timestamptz,

  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- Idempotency. Webhooks are delivered more than once and a retry must not
-- create a second row.
--
-- Plain rather than partial: Postgres treats NULLs as distinct, so manually
-- entered rows with no provider id coexist freely, AND a plain index can serve
-- as an ON CONFLICT arbiter — which a partial index cannot, through PostgREST.
create unique index if not exists communications_provider_msg_idx
  on communications (provider, provider_message_id);

create index if not exists communications_queue_idx
  on communications (received_at desc) where status in ('new', 'in_review');
create index if not exists communications_import_idx
  on communications (import_id, received_at desc);
create index if not exists communications_sender_idx
  on communications (sender_phone);

drop trigger if exists communications_updated_at on communications;
create trigger communications_updated_at
  before update on communications
  for each row execute function touch_updated_at();

-- Audited because linking a message to an import, and marking one actioned,
-- are decisions worth a record. The cost is that raw_payload is copied into
-- audit_log.new_values on insert — about a kilobyte per text message, which is
-- nothing against the free tier. Revisit only if media-heavy payloads land.
drop trigger if exists communications_audit on communications;
create trigger communications_audit
  after insert or update or delete on communications
  for each row execute function audit_row_change();


-- ============================================================================
-- ATTACHMENTS — recorded, dated, and expiry-flagged.
--
-- The app holds no Google Drive credentials, by design (src/lib/drive.ts: "v1
-- stores links only — no OAuth, no API"). So it cannot file a PDF for you.
--
-- What it can do is refuse to let one disappear quietly. WhatsApp keeps media
-- about 30 days; `provider_expires_at` turns "the file silently vanished" into
-- a dated prompt on the Inbox. `storage` and `fetch_status` are already shaped
-- for a later phase that pulls bytes into Supabase Storage behind a flag.
-- ============================================================================

create table if not exists communication_attachments (
  id                  uuid primary key default gen_random_uuid(),
  communication_id    uuid not null references communications (id) on delete cascade,

  provider_media_id   text,
  file_name           text,
  mime_type           text,
  size_bytes          bigint,
  sha256              text,
  caption             text,

  storage             text not null default 'none'
                      check (storage in ('none', 'supabase', 'drive')),
  drive_url           text,
  drive_file_id       text,
  storage_path        text,

  fetch_status        text not null default 'not_fetched'
                      check (fetch_status in ('not_fetched', 'fetched', 'expired', 'failed', 'skipped')),
  fetch_error         text,
  fetched_at          timestamptz,
  provider_expires_at timestamptz,

  -- Set only once a document suggestion has been approved and applied.
  document_id         uuid references documents (id) on delete set null,
  document_version_id uuid references document_versions (id) on delete set null,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists communication_attachments_comm_idx
  on communication_attachments (communication_id);

drop trigger if exists communication_attachments_updated_at on communication_attachments;
create trigger communication_attachments_updated_at
  before update on communication_attachments
  for each row execute function touch_updated_at();

drop trigger if exists communication_attachments_audit on communication_attachments;
create trigger communication_attachments_audit
  after insert or update or delete on communication_attachments
  for each row execute function audit_row_change();


-- ============================================================================
-- PARSES — one interpretation of one or more messages.
--
-- Kept as rows rather than recomputed on read, and the distinction from
-- v_alerts is worth stating because it looks inconsistent otherwise.
--
-- v_alerts can be a view because every branch is a total function of stored
-- data and current_date: `next_action_due < current_date` gives the same answer
-- forever. A parse is a function of a PARSER VERSION, which is not stored data
-- and will change. Recomputing would retroactively rewrite what the operator
-- approved — the same failure document_versions avoids by superseding rather
-- than replacing.
-- ============================================================================

create table if not exists communication_parses (
  id                 uuid primary key default gen_random_uuid(),

  provider_name      text not null default 'rules',
  provider_version   text not null,

  status             text not null default 'pending'
                     check (status in ('pending', 'parsed', 'failed', 'superseded')),
  failure_reason     text,

  -- The structured output exactly as the contract accepted it. Never edited:
  -- this is the record of what was PROPOSED, which has to survive the parser
  -- being replaced.
  envelope           jsonb,

  -- The matcher's belief. See the header for why this is not called import_id.
  matched_import_id  uuid references imports (id) on delete set null,
  match_confidence   numeric(4,3)
                     check (match_confidence is null or (match_confidence between 0 and 1)),
  match_signals      jsonb not null default '[]'::jsonb,
  match_status       text not null default 'unmatched'
                     check (match_status in ('unmatched', 'ambiguous', 'proposed', 'confirmed', 'rejected')),

  overall_confidence numeric(4,3),
  risk_level         text not null default 'LOW' check (risk_level in ('LOW', 'MEDIUM', 'HIGH')),
  warnings           jsonb not null default '[]'::jsonb,

  parsed_at          timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists communication_parses_open_idx
  on communication_parses (created_at desc) where status in ('pending', 'parsed');

drop trigger if exists communication_parses_updated_at on communication_parses;
create trigger communication_parses_updated_at
  before update on communication_parses
  for each row execute function touch_updated_at();

drop trigger if exists communication_parses_audit on communication_parses;
create trigger communication_parses_audit
  after insert or update or delete on communication_parses
  for each row execute function audit_row_change();


-- ============================================================================
-- PARSE MEMBERS — the bundle.
--
-- Operational meaning routinely spans several messages: "Container picked."
-- / "Okay." / "Stuffing tomorrow." A parse therefore covers 1..N messages, and
-- `seq` matters — "the ETD I mentioned" only resolves if the earlier message is
-- read first.
--
-- A uuid[] on the parse row would have been lighter (cha_agents.modes is
-- precedent), but a join table keeps referential integrity and makes "which
-- parse covers this message" an indexed lookup, which the Inbox runs per row.
-- ============================================================================

create table if not exists communication_parse_members (
  id               uuid primary key default gen_random_uuid(),
  parse_id         uuid not null references communication_parses (id) on delete cascade,
  communication_id uuid not null references communications (id) on delete cascade,
  seq              integer not null,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  unique (parse_id, communication_id),
  unique (parse_id, seq)
);

create index if not exists communication_parse_members_comm_idx
  on communication_parse_members (communication_id);

drop trigger if exists communication_parse_members_updated_at on communication_parse_members;
create trigger communication_parse_members_updated_at
  before update on communication_parse_members
  for each row execute function touch_updated_at();

drop trigger if exists communication_parse_members_audit on communication_parse_members;
create trigger communication_parse_members_audit
  after insert or update or delete on communication_parse_members
  for each row execute function audit_row_change();


-- ============================================================================
-- SUGGESTIONS — the reviewable unit. One row is one Approve / Edit / Reject.
--
-- Populated from phase W4 onward; the table exists now so the Inbox and the
-- apply layer are built against a settled shape rather than a guessed one.
--
-- `source_quote` is not optional in spirit: nobody should approve a change
-- without being able to read the sentence it came from.
-- ============================================================================

create table if not exists communication_suggestions (
  id                  uuid primary key default gen_random_uuid(),
  parse_id            uuid not null references communication_parses (id) on delete cascade,
  communication_id    uuid references communications (id) on delete set null,
  seq                 integer not null,

  kind                text not null check (kind in (
                        'event', 'field_change', 'document_action', 'payment_action',
                        'task', 'followup', 'bank_alert', 'note')),

  -- No CHECK on purpose. The controlled event dictionary lives in TypeScript
  -- (src/lib/comms/events.ts) and is enforced at the runtime boundary by
  -- zod's z.enum under .strict(), the same way activity_log.event_type is free
  -- text. A CHECK here would turn "recognise one more phrase" into a database
  -- migration.
  event_code          text,

  title               text not null,
  detail              text,
  source_quote        text,

  target_table        text,
  target_record_id    uuid,
  proposed_value      jsonb not null default '{}'::jsonb,

  -- What the field held when this was proposed. Re-read at apply time: if it
  -- has moved, the world changed under the suggestion and it is stale, not
  -- applicable. This is what stops an approval silently reverting a manual edit
  -- made in between.
  current_value       jsonb,

  raw_date_expression text,
  interpreted_date    date,
  date_confidence     numeric(4,3),

  confidence          numeric(4,3),
  risk_level          text not null default 'LOW' check (risk_level in ('LOW', 'MEDIUM', 'HIGH')),
  sop_rule_code       text,

  decision            text not null default 'proposed' check (decision in (
                        'proposed', 'approved', 'applying', 'applied',
                        'rejected', 'failed', 'superseded')),
  decided_by          uuid references profiles (id),
  decided_at          timestamptz,
  decision_note       text,

  -- What the operator actually agreed to, when they edited before approving.
  -- Kept apart from proposed_value so "what was proposed vs what was applied"
  -- stays answerable.
  approved_value      jsonb,

  applied_at          timestamptz,
  applied_record_id   uuid,
  apply_error         text,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  unique (parse_id, seq)
);

create index if not exists communication_suggestions_open_idx
  on communication_suggestions (created_at) where decision = 'proposed';
create index if not exists communication_suggestions_parse_idx
  on communication_suggestions (parse_id, seq);

drop trigger if exists communication_suggestions_updated_at on communication_suggestions;
create trigger communication_suggestions_updated_at
  before update on communication_suggestions
  for each row execute function touch_updated_at();

drop trigger if exists communication_suggestions_audit on communication_suggestions;
create trigger communication_suggestions_audit
  after insert or update or delete on communication_suggestions
  for each row execute function audit_row_change();


-- ============================================================================
-- THE APPLY LATCH
--
-- Compare-and-set, so exactly one caller can move a suggestion out of
-- 'approved'. Clicking Apply twice cannot write twice.
--
-- This is SQL rather than a read-then-write in the server action because
-- supabase-js has no transactions: a check followed by an update from
-- application code is two round trips with a race between them.
-- ============================================================================

create or replace function claim_communication_suggestion(p_id uuid)
returns boolean
language plpgsql
as $$
declare
  v_ok boolean;
begin
  update communication_suggestions
     set decision = 'applying'
   where id = p_id and decision = 'approved'
  returning true into v_ok;

  return coalesce(v_ok, false);
end;
$$;


-- ============================================================================
-- THE INBOX
--
-- A read-time projection over persisted rows: the queue with its newest
-- non-superseded parse and its counts. Consistent with the no-cron rule — the
-- work happens when someone looks.
-- ============================================================================

create or replace view v_communication_inbox as
select
  c.id,
  c.source,
  c.provider,
  c.message_type,
  c.body_text,
  c.forwarded_by_phone,
  c.sender_phone,
  c.sender_name,
  c.sender_role,
  c.sent_at,
  c.received_at,
  c.status,
  c.import_id,
  c.linked_at,

  i.import_no,
  i.status                          as import_status,
  s.name                            as supplier_name,

  p.id                              as parse_id,
  p.status                          as parse_status,
  p.failure_reason,
  p.matched_import_id,
  p.match_confidence,
  p.match_status,
  p.risk_level,
  mi.import_no                      as matched_import_no,

  (select count(*) from communication_suggestions cs
     where cs.parse_id = p.id)                              as suggestion_count,
  (select count(*) from communication_suggestions cs
     where cs.parse_id = p.id and cs.decision = 'proposed')  as open_suggestion_count,
  (select count(*) from communication_attachments ca
     where ca.communication_id = c.id)                       as attachment_count
from communications c
left join imports i on i.id = c.import_id
left join suppliers s on s.id = i.supplier_id
-- Newest parse, expressed once here rather than re-derived in TypeScript.
left join lateral (
  select pp.id, pp.status, pp.failure_reason, pp.matched_import_id,
         pp.match_confidence, pp.match_status, pp.risk_level
  from communication_parses pp
  join communication_parse_members pm on pm.parse_id = pp.id
  where pm.communication_id = c.id
    and pp.status <> 'superseded'
  order by pp.created_at desc
  limit 1
) p on true
left join imports mi on mi.id = p.matched_import_id;

grant select on v_communication_inbox to authenticated;


-- ============================================================================
-- SETTINGS
--
-- Thresholds are rows, never literals in application code (spec §1). Anything
-- read through getSetting() must also be added to FALLBACKS in
-- src/lib/settings.ts or it will not typecheck.
-- ============================================================================

insert into app_settings (key, value, description) values
  ('business_timezone', '"Asia/Kolkata"',
   'IANA timezone used to read relative dates in messages — "tomorrow" means tomorrow here, not wherever the server runs.'),
  ('comm_match_min_confidence', '0.6',
   'Minimum confidence before a communication is proposed against an import. Below this it stays unmatched rather than guessing.'),
  ('comm_bundle_window_minutes', '10',
   'Messages forwarded from the same sender within this many minutes are offered as one bundle to review together.')
on conflict (key) do nothing;


-- ============================================================================
-- MATCHING INDEXES — deliberately absent
--
-- Identifiers in shipments.awb / hawb / mawb / bl_no / tracking_no /
-- container_nos are free text carrying real-world noise ("MAWB 020-1234 5678"),
-- so matching normalises them in TypeScript (src/lib/comms/matcher.ts) where it
-- is pure and unit-testable. A plain btree on those columns would never be used
-- by a normalised comparison — it would be dead weight that looks like it is
-- doing something.
--
-- If the candidate snapshot ever gets expensive, the index that would actually
-- help is an EXPRESSION index matching the normaliser:
--
--   create index shipments_awb_norm_idx on shipments
--     (upper(regexp_replace(coalesce(awb, ''), '[^A-Za-z0-9]', '', 'g')));
--
-- Note also that container_nos is ONE free-text column that may hold several
-- numbers, so a container match is a normalised substring test, never equality.
-- ============================================================================


-- ============================================================================
-- RLS
-- ============================================================================

do $$
declare
  t text;
begin
  foreach t in array array['communications', 'communication_attachments',
                           'communication_parses', 'communication_parse_members',
                           'communication_suggestions']
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
