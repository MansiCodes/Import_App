-- Document file uploads (PDF / JPG / PNG) alongside Drive links.
-- Adds storage_path on versions, renames primary-tab labels, and creates
-- a private Storage bucket for server-side uploads.

alter table document_versions
  add column if not exists storage_path text;

create index if not exists document_versions_storage_path_idx
  on document_versions (storage_path)
  where storage_path is not null;

-- Display names for the primary document tabs.
update document_types set name = 'Terminal Charges' where code = 'terminal_receipt';
update document_types set name = 'CHA Freight Bill' where code = 'cha_bill';
update document_types set name = 'Payment / SWIFT Copy' where code = 'swift_copy';
update document_types set name = 'Other Documents' where code = 'misc';
update document_types set name = 'Out of Charge Copy' where code = 'oocc';

/**
 * Add a new version, optionally with a Supabase Storage path for uploaded files.
 * Existing callers that omit storage_path keep working (default null).
 */
create or replace function add_document_version(
  p_document_id   uuid,
  p_drive_url     text,
  p_drive_file_id text,
  p_file_name     text,
  p_received_at   date,
  p_notes         text,
  p_storage_path  text default null
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

  if v_old_id is not null then
    update document_versions set status = 'superseded' where id = v_old_id;
  end if;

  insert into document_versions (
    document_id, version_no, drive_url, drive_file_id, file_name,
    received_at, notes, storage_path
  )
  values (
    p_document_id, v_next_no, p_drive_url, p_drive_file_id, p_file_name,
    coalesce(p_received_at, current_date), p_notes, p_storage_path
  )
  returning id into v_new_id;

  if v_old_id is not null then
    update document_versions set superseded_by_id = v_new_id where id = v_old_id;
  end if;

  return v_new_id;
end;
$$;

-- Private bucket; the app uploads via the service-role client.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'import-documents',
  'import-documents',
  false,
  20971520, -- 20 MB
  array['application/pdf', 'image/jpeg', 'image/png']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
