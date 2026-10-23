-- ============================================================================
-- 018 Outbound WhatsApp messages
--
-- Records every quote-link message the app sends, and what the provider said
-- happened to it afterwards.
--
-- A SEPARATE TABLE, NOT `communications`. That table looks like a fit — it has
-- `direction` and `provider_message_id` — but v_communication_inbox selects
-- from it with no direction filter, so every message we sent would appear in
-- the operator's Inbox as something to read and triage. Its `status` column
-- also means inbox triage ('new', 'in_review', …), not delivery lifecycle.
-- Overloading it would conflate "somebody wrote to us" with "we wrote to
-- somebody", which are different things with different lifecycles.
--
-- DELIVERY STATE IS COMMUNICATION METADATA ONLY. Nothing here may influence a
-- quote, a recipient's submission status, or the comparison. A message being
-- delivered says nothing about whether a quotation was given.
-- ============================================================================

create table if not exists freight_quote_messages (
  id                  uuid primary key default gen_random_uuid(),

  quote_request_id    uuid not null references freight_quote_requests (id) on delete cascade,
  recipient_id        uuid not null references freight_quote_request_recipients (id) on delete cascade,

  -- Which attempt this is for that recipient. 1 is the first send, 2 the first
  -- resend, and so on. Paired with the unique index below it is the
  -- idempotency key: a double-clicked button cannot produce two rows.
  attempt_no          integer not null,

  provider            text not null default 'meta_cloud',
  provider_message_id text,

  -- The number as actually dialled, in E.164. Stored rather than resolved
  -- later, because a CHA's number may be corrected after the fact and this has
  -- to keep saying where the message really went.
  destination         text not null,

  -- 'template' for business-initiated sends, 'text' only inside an open
  -- 24-hour service window. Recorded because it determines both whether Meta
  -- accepts the send and whether it is billed.
  message_type        text not null default 'template'
                      check (message_type in ('template', 'text')),
  template_name       text,
  template_language   text,
  -- What we actually sent, for the audit trail. Never the token alone.
  body_preview        text,

  status              text not null default 'PENDING'
                      check (status in ('PENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED')),

  sent_at             timestamptz,
  delivered_at        timestamptz,
  read_at             timestamptz,
  failed_at           timestamptz,
  failure_code        text,
  failure_reason      text,

  sent_by             uuid references profiles (id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  unique (recipient_id, attempt_no)
);

create index if not exists fqm_request_idx on freight_quote_messages (quote_request_id);
create index if not exists fqm_recipient_idx on freight_quote_messages (recipient_id);
-- Delivery callbacks arrive keyed only by the provider's message id.
create index if not exists fqm_provider_message_idx on freight_quote_messages (provider_message_id)
  where provider_message_id is not null;

drop trigger if exists fqm_updated_at on freight_quote_messages;
create trigger fqm_updated_at
  before update on freight_quote_messages
  for each row execute function touch_updated_at();

drop trigger if exists fqm_audit on freight_quote_messages;
create trigger fqm_audit
  after insert or update or delete on freight_quote_messages
  for each row execute function audit_row_change();


-- ============================================================================
-- What the recipient rows need in order to show a send state.
-- ============================================================================

create or replace view v_freight_quote_recipient_messages as
select distinct on (m.recipient_id)
  m.recipient_id,
  m.id                as message_id,
  m.quote_request_id,
  m.attempt_no,
  m.status,
  m.destination,
  m.sent_at,
  m.delivered_at,
  m.read_at,
  m.failed_at,
  m.failure_reason,
  m.message_type
from freight_quote_messages m
-- The latest attempt is the one whose state the row should show.
order by m.recipient_id, m.attempt_no desc;


-- ============================================================================
-- RLS — same posture as everything else: on, scoped to `authenticated`, and
-- nothing granted to `anon`. The public quote portal never reads this.
-- ============================================================================

alter table freight_quote_messages enable row level security;
drop policy if exists authenticated_all on freight_quote_messages;
create policy authenticated_all on freight_quote_messages
  for all to authenticated using (true) with check (true);

grant select on v_freight_quote_recipient_messages to authenticated;
