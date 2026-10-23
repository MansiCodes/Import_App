-- ============================================================================
-- 021 Password reset tokens
--
-- Sign-in is email + password. Supabase Auth stores the bcrypt hash in
-- auth.users; this table never holds a password.
--
-- A reset token is 32 random bytes. Only its SHA-256 hash is stored. The row
-- expires, and completing a reset stamps used_at so the same token cannot be
-- replayed. Issuing a new token also stamps every older unused row for that
-- person.
--
-- RLS is on and no API role is granted access. The service-role key, which
-- never reaches the browser, is the only caller.
-- ============================================================================

create table if not exists password_reset_tokens (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  token_hash  text not null unique,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists password_reset_tokens_user_id_idx
  on password_reset_tokens (user_id);

alter table password_reset_tokens enable row level security;

revoke all on table public.password_reset_tokens from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on table public.password_reset_tokens from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on table public.password_reset_tokens from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant all on table public.password_reset_tokens to service_role';
  end if;
end;
$$;
