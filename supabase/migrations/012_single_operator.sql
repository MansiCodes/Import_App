-- ============================================================================
-- 012 Single operator, no sign-in
--
-- The app is no longer behind a login: whoever holds the URL uses it. That is a
-- deliberate choice for a single-operator tool, and it changes two things here.
--
-- IDENTITY. `profiles` existed one-row-per-login and hung off auth.users. With
-- no logins there are no auth users, so every attribution column —
-- verified_by, approved_by, created_by, completed_by — would be null forever,
-- and the audit log would stop being able to answer "who". Instead the FK is
-- dropped and a single Operator profile is seeded. Attribution now says
-- "Operator" rather than nothing, which is the truth for a one-person system,
-- and the role column stays so that reinstating real logins later is a
-- migration on top rather than a rebuild.
--
-- ACCESS. RLS stays ON with policies scoped to `authenticated`, and nothing is
-- granted to `anon`. That is not vestigial — it is what stops the anon key,
-- which any visitor can read out of the page, from being usable against the
-- REST API directly. The application reaches the database with the service-role
-- key from the server only, where it is never exposed. So the app is open, and
-- the database behind it still is not.
-- ============================================================================

-- The sign-in trigger has nothing left to fire on.
drop trigger if exists on_auth_user_created on auth.users;
drop function if exists handle_new_user();

-- A profile no longer requires an auth user to exist.
alter table profiles drop constraint if exists profiles_id_fkey;


-- ============================================================================
-- THE OPERATOR
--
-- One row, fixed id, so every environment attributes to the same identity.
-- Editable — change the name and email freely; nothing keys off their values.
--
-- Guarded on the table being EMPTY rather than on the id, because a project
-- that ran with sign-in already has a real profile carrying a real name. Adding
-- a generic second one there would leave two candidates and attribute work to
-- whichever sorted first, which is how attribution quietly becomes wrong.
-- ============================================================================

insert into profiles (id, email, full_name, role)
select '00000000-0000-0000-0000-000000000001', 'operator@notofire.local', 'Operator', 'admin'
where not exists (select 1 from profiles);


-- ============================================================================
-- Audit attribution falls back to the operator.
--
-- auth.uid() is null on every call now, so without this the audit log would
-- record a complete field-level history attributed to nobody. The fallback is
-- the seeded operator; a migration or maintenance script running before that
-- row exists still records null, which remains honest.
-- ============================================================================

create or replace function audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old        jsonb;
  v_new        jsonb;
  v_changed    jsonb;
  v_record_id  uuid;
  v_record_key text;
  v_import_id  uuid;
  v_action     text;
  v_uid        uuid;
begin
  if TG_OP = 'INSERT' then
    v_old := '{}'::jsonb;
    v_new := to_jsonb(NEW);
    v_action := 'insert';
  elsif TG_OP = 'UPDATE' then
    v_old := to_jsonb(OLD);
    v_new := to_jsonb(NEW);
    v_action := 'update';
  else
    v_old := to_jsonb(OLD);
    v_new := '{}'::jsonb;
    v_action := 'delete';
  end if;

  -- Identity is read from the row's jsonb rather than NEW.id, because not every
  -- audited table has an `id` column — app_settings is keyed by `key`. Reading
  -- NEW.id directly raises "record new has no field id" on those tables.
  v_record_id := nullif(coalesce(v_new ->> 'id', v_old ->> 'id'), '')::uuid;
  v_record_key := coalesce(v_new ->> 'id', v_old ->> 'id', v_new ->> 'key', v_old ->> 'key');

  -- Field-level diff. updated_at is excluded so a touch alone is not "a change".
  select jsonb_object_agg(k, jsonb_build_object('old', v_old -> k, 'new', v_new -> k))
    into v_changed
  from (select jsonb_object_keys(v_old || v_new) as k) keys
  where (v_old -> k) is distinct from (v_new -> k)
    and k <> 'updated_at';

  -- A no-op UPDATE is not worth a row.
  if TG_OP = 'UPDATE' and (v_changed is null or v_changed = '{}'::jsonb) then
    return NEW;
  end if;

  if TG_TABLE_NAME = 'imports' then
    v_import_id := v_record_id;
  elsif v_new ? 'import_id' then
    v_import_id := nullif(v_new ->> 'import_id', '')::uuid;
  elsif v_old ? 'import_id' then
    v_import_id := nullif(v_old ->> 'import_id', '')::uuid;
  end if;

  -- auth.uid() is null throughout now that there is no sign-in. Fall back to
  -- the single operator so the history has an author; null only if even that
  -- row is absent, which is the case during the migrations themselves.
  begin
    v_uid := auth.uid();
  exception when others then
    v_uid := null;
  end;

  if v_uid is null then
    select id into v_uid from profiles where is_active order by created_at limit 1;
  end if;

  insert into audit_log (
    user_id, user_email, table_name, record_id, record_key, action,
    changed_fields, old_values, new_values, import_id
  )
  values (
    v_uid,
    (select email from profiles where id = v_uid),
    TG_TABLE_NAME,
    v_record_id,
    v_record_key,
    v_action,
    v_changed,
    case when TG_OP = 'INSERT' then null else v_old end,
    case when TG_OP = 'DELETE' then null else v_new end,
    v_import_id
  );

  if TG_OP = 'DELETE' then
    return OLD;
  end if;
  return NEW;
end;
$$;
