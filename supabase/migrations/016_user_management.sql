-- ============================================================================
-- 015 Real users, real roles
--
-- Migration 012 removed sign-in and collapsed identity to a single Operator
-- profile. Sign-in has since been restored, and a second person now needs
-- access — so identity has to mean something again.
--
-- Two problems this fixes, both of which only bite once there is more than one
-- person:
--
--   ATTRIBUTION WAS A GUESS. The audit trigger fell back to "the first active
--   profile" whenever auth.uid() was null — which is always, because the app
--   reaches the database with the service-role key. With one user that was
--   harmlessly right. With two it would record Bob's deletion as Ridh's, and an
--   audit trail that lies is worse than one that admits it does not know.
--
--   AUTH USERS HAD NO PROFILE. Anyone who could sign in got in, with no row
--   describing who they were or what they may do.
-- ============================================================================

-- ============================================================================
-- Every auth user needs a profile — without one there is no role and no
-- identity to attribute work to.
--
-- Existing users are seeded as `admin` deliberately: both addresses predate
-- user management and belong to the owner, and defaulting them to `viewer`
-- would lock the only administrator out of the screen that grants access.
-- Everyone added from here on gets the role an admin chooses.
-- ============================================================================

insert into profiles (id, email, full_name, role, is_active)
select
  u.id,
  u.email,
  coalesce(u.raw_user_meta_data ->> 'full_name', split_part(u.email, '@', 1)),
  'admin',
  true
from auth.users u
where not exists (select 1 from profiles p where p.id = u.id)
  and u.email is not null;

-- There must always be someone who can grant access. Not a constraint — a
-- constraint cannot express "at least one row somewhere" without locking the
-- table on every write — but the application enforces it on the way out.
do $$
begin
  if not exists (select 1 from profiles where role = 'admin' and is_active) then
    update profiles
    set role = 'admin'
    where id = (select id from profiles where is_active order by created_at limit 1);
  end if;
end;
$$;


-- ============================================================================
-- Honest attribution.
--
-- The actor is read from a request header the server sets, because the app
-- connects as the service role and therefore has no auth.uid(). PostgREST
-- exposes request headers to SQL, so the server can name the signed-in person
-- per request without weakening anything: the header is set server-side only,
-- and the service-role key it travels with never reaches a browser.
--
-- When no actor can be established the column is left NULL. It is not filled
-- with a plausible guess.
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
  -- audited table has an `id` column — app_settings is keyed by `key`.
  v_record_id := nullif(coalesce(v_new ->> 'id', v_old ->> 'id'), '')::uuid;
  v_record_key := coalesce(v_new ->> 'id', v_old ->> 'id', v_new ->> 'key', v_old ->> 'key');

  -- Field-level diff. updated_at is excluded so a touch alone is not "a change".
  select jsonb_object_agg(k, jsonb_build_object('old', v_old -> k, 'new', v_new -> k))
    into v_changed
  from (select jsonb_object_keys(v_old || v_new) as k) keys
  where (v_old -> k) is distinct from (v_new -> k)
    and k <> 'updated_at';

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

  -- The signed-in person, named by the server for this request.
  begin
    v_uid := nullif(current_setting('request.headers', true)::json ->> 'x-actor-id', '')::uuid;
  exception when others then
    v_uid := null;
  end;

  -- A real Supabase session, if this ever runs as one.
  if v_uid is null then
    begin
      v_uid := auth.uid();
    exception when others then
      v_uid := null;
    end;
  end if;

  -- Only attribute to somebody who actually exists.
  if v_uid is not null and not exists (select 1 from profiles where id = v_uid) then
    v_uid := null;
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
