-- ============================================================================
-- 009 Email templates and drafts (phase 10)
--
-- Deterministic substitution only. `{{placeholder}}` is replaced with a value
-- read from the import; nothing is generated, rephrased or summarised. There is
-- no model call anywhere in this system, and this is the one place someone
-- would be tempted to add one.
--
-- The app also does not SEND. It prepares text, records that it was prepared,
-- and hands it to the operator to copy or open in Gmail. Sending on someone's
-- behalf to a supplier is a commercial act, and this system does not make
-- commercial decisions.
-- ============================================================================

create table if not exists email_templates (
  id           uuid primary key default gen_random_uuid(),
  code         text not null unique,
  name         text not null,
  category     text check (category is null or category in (
                 'Follow-up', 'Payment', 'Documents', 'Shipping', 'Customs',
                 'Delivery', 'Other')),

  subject      text not null,
  body         text not null,

  -- Recorded for the UI's placeholder helper. Descriptive, not enforced: an
  -- unknown placeholder is left visible in the output rather than silently
  -- blanked, so a broken template is obvious on the review screen.
  placeholders text[] not null default '{}',

  is_system    boolean not null default false,
  is_active    boolean not null default true,
  sort_order   integer not null default 100,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

drop trigger if exists email_templates_updated_at on email_templates;
create trigger email_templates_updated_at
  before update on email_templates
  for each row execute function touch_updated_at();

drop trigger if exists email_templates_audit on email_templates;
create trigger email_templates_audit
  after insert or update or delete on email_templates
  for each row execute function audit_row_change();


-- ============================================================================
-- DRAFTS — what was prepared, when, and by whom.
--
-- `sent_manually_at` is set by the operator asserting they sent it. The system
-- cannot know, and does not pretend to: an unset value means "prepared, not
-- confirmed sent", which is honest.
-- ============================================================================

create table if not exists email_drafts (
  id               uuid primary key default gen_random_uuid(),
  import_id        uuid references imports (id) on delete cascade,
  template_id      uuid references email_templates (id) on delete set null,

  to_email         text,
  cc_email         text,
  subject          text not null,
  body             text not null,

  prepared_at      timestamptz not null default now(),
  prepared_by      uuid references profiles (id),
  sent_manually_at timestamptz,
  -- Pasted back after sending, so the thread is reachable from the import.
  gmail_thread_url text,

  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists email_drafts_import_idx on email_drafts (import_id, prepared_at desc);

drop trigger if exists email_drafts_updated_at on email_drafts;
create trigger email_drafts_updated_at
  before update on email_drafts
  for each row execute function touch_updated_at();


-- ============================================================================
-- Seed templates.
--
-- Wording drawn from what these emails actually have to say. Seeded as data and
-- fully editable — none of this is referenced from code.
-- ============================================================================

insert into email_templates (code, name, category, subject, body, placeholders, is_system, sort_order)
values
  ('production_followup', 'Production follow-up', 'Follow-up',
   'Production status — {{po_number}} / {{pi_number}}',
   'Dear {{supplier_contact}},

Could you please confirm the current production status for our order {{po_number}} ({{pi_number}}), value {{currency}} {{pi_value}}?

Our records show goods ready was expected by {{expected_goods_ready}}. If that date has moved, please let us know the revised date so we can plan the freight booking.

Best regards,
{{sender_name}}
{{company_name}}',
   array['supplier_contact','po_number','pi_number','currency','pi_value','expected_goods_ready','sender_name','company_name'],
   true, 10),

  ('goods_ready_request', 'Goods-ready confirmation request', 'Shipping',
   'Goods ready confirmation — {{po_number}}',
   'Dear {{supplier_contact}},

Please confirm the goods for {{po_number}} are ready for collection, and send us:

  - Final commercial invoice
  - Final packing list with carton count, dimensions and gross/net weight
  - Any certificates applicable to this consignment

We will arrange collection once these are received.

Best regards,
{{sender_name}}
{{company_name}}',
   array['supplier_contact','po_number','sender_name','company_name'],
   true, 20),

  ('payment_advice', 'Payment advice', 'Payment',
   'Payment sent — {{po_number}} / {{currency}} {{pi_value}}',
   'Dear {{supplier_contact}},

We have remitted payment against {{po_number}} ({{pi_number}}).

Please confirm receipt and share the updated proforma or commercial invoice reflecting this payment.

Best regards,
{{sender_name}}
{{company_name}}',
   array['supplier_contact','po_number','pi_number','currency','pi_value','sender_name','company_name'],
   true, 30),

  ('document_chase', 'Missing document chase', 'Documents',
   'Documents outstanding — {{import_no}} / {{po_number}}',
   'Dear {{supplier_contact}},

The following documents are still outstanding for {{po_number}}:

  - [list the documents]

These are needed before we can clear the consignment, so an early reply would help.

Best regards,
{{sender_name}}
{{company_name}}',
   array['supplier_contact','import_no','po_number','sender_name','company_name'],
   true, 40),

  ('cha_clearance_brief', 'Clearance instructions to CHA', 'Customs',
   'Clearance — {{import_no}} / {{supplier_name}}',
   'Dear {{cha_name}},

Please arrange clearance for the consignment below.

  Import reference : {{import_no}}
  Importer         : {{company_name}}
  Supplier         : {{supplier_name}}
  Invoice value    : {{currency}} {{pi_value}}
  Expected arrival : {{next_eta}}

The document set is attached. Please confirm the Bill of Entry number once filed, and let us know immediately if any query is raised.

Best regards,
{{sender_name}}
{{company_name}}',
   array['cha_name','import_no','company_name','supplier_name','currency','pi_value','next_eta','sender_name'],
   true, 50)
on conflict (code) do nothing;


-- ============================================================================
-- RLS
-- ============================================================================

do $$
declare
  t text;
begin
  foreach t in array array['email_templates', 'email_drafts']
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
