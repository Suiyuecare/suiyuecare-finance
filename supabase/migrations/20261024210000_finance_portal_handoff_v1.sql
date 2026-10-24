-- Portal -> Finance single sign-on. Service-only consume/finalize; never
-- provisions an account, never trusts Portal roles, and never replaces a
-- sealed session or logout function.
do $finance_portal_handoff_prerequisites$
begin
  if pg_catalog.to_regclass('logout_private.module_receipts') is null
     or pg_catalog.to_regprocedure('public.portal_session_status()') is null
     or pg_catalog.to_regclass('public.finance_users') is null then
    raise exception 'Finance portal handoff prerequisites are missing' using errcode = '55000';
  end if;
end;
$finance_portal_handoff_prerequisites$;

create schema portal_handoff_private;
revoke all on schema portal_handoff_private from public, anon, authenticated, service_role;

create table portal_handoff_private.consumed (
  jti uuid primary key,
  user_id uuid not null,
  google_subject text not null,
  verified_email text not null,
  issued_at timestamptz not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default statement_timestamp()
);
alter table portal_handoff_private.consumed enable row level security;
alter table portal_handoff_private.consumed force row level security;
revoke all on table portal_handoff_private.consumed from public, anon, authenticated, service_role;

-- Called only by the Finance handoff route after HMAC, origin, audience and
-- TTL checks. Maps the exact Google identity to an existing Auth user bound to
-- an active Finance member, rejects replay and assertions issued at or before
-- the latest coordinated logout cutoff for that person.
create function public.finance_portal_handoff_consume(payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $finance_portal_handoff_consume$
declare
  v_email text;
  v_subject text;
  v_jti uuid;
  v_issued bigint;
  v_expires bigint;
  v_target uuid;
  v_candidates bigint;
  v_auth_email text;
begin
  if payload is null or pg_catalog.jsonb_typeof(payload) <> 'object'
     or payload->>'aud' is distinct from 'accounting'
     or payload->>'source' is distinct from 'logging-portal' then
    raise exception 'FINANCE_PORTAL_HANDOFF_INVALID' using errcode = '42501';
  end if;
  begin
    v_email := pg_catalog.lower(pg_catalog.btrim(payload->>'email'));
    v_subject := payload->>'googleSubject';
    v_jti := (payload->>'jti')::uuid;
    v_issued := (payload->>'iat')::bigint;
    v_expires := (payload->>'exp')::bigint;
  exception when others then
    raise exception 'FINANCE_PORTAL_HANDOFF_INVALID' using errcode = '42501';
  end;
  if v_jti is null or v_issued is null or v_expires is null
     or pg_catalog.to_timestamp(v_issued) > pg_catalog.clock_timestamp() + interval '5 seconds'
     or pg_catalog.to_timestamp(v_issued) < pg_catalog.clock_timestamp() - interval '65 seconds'
     or v_expires <= v_issued or v_expires > v_issued + 60
     or pg_catalog.to_timestamp(v_expires) <= pg_catalog.clock_timestamp()
     or v_email is null or v_email !~ '^[^[:space:]@]+@suiyuecare[.]com$'
     or v_subject is null or pg_catalog.length(v_subject) < 1 or pg_catalog.length(v_subject) > 256 then
    raise exception 'FINANCE_PORTAL_HANDOFF_INVALID' using errcode = '42501';
  end if;

  select pg_catalog.count(distinct u.id), pg_catalog.min(u.id::text)::uuid
    into v_candidates, v_target
  from auth.users u
  join auth.identities i on i.user_id = u.id
  where i.provider = 'google'
    and coalesce(i.identity_data->>'sub', i.provider_id) = v_subject
    and u.email_confirmed_at is not null
    and coalesce((i.identity_data->>'email_verified')::boolean, false)
    and pg_catalog.lower(i.identity_data->>'email') = v_email;
  if v_candidates <> 1 or v_target is null then
    raise exception 'FINANCE_PORTAL_HANDOFF_FORBIDDEN' using errcode = '42501';
  end if;

  -- Coordinated logout locks the same Auth row before deleting sessions.
  select pg_catalog.lower(pg_catalog.btrim(u.email)) into v_auth_email
  from auth.users u where u.id = v_target for share;
  if v_auth_email is null or not exists (
    select 1 from public.finance_users fu
    where fu.active = true
      and fu.auth_user_id = v_target
      and fu.google_link_status in ('bound', 'pending_rebind')
      and pg_catalog.lower(pg_catalog.btrim(fu.email)) = v_email
  ) then
    raise exception 'FINANCE_PORTAL_HANDOFF_FORBIDDEN' using errcode = '42501';
  end if;

  -- Assertions carry whole seconds; reject the entire logout second.
  if exists (
    select 1 from logout_private.module_receipts r
    where (r.google_subject = v_subject or r.verified_email = v_email)
      and r.revoke_before >= pg_catalog.to_timestamp(v_issued)
  ) then
    raise exception 'FINANCE_PORTAL_HANDOFF_REVOKED' using errcode = '42501';
  end if;

  insert into portal_handoff_private.consumed(jti, user_id, google_subject, verified_email, issued_at, expires_at)
  values (v_jti, v_target, v_subject, v_email, pg_catalog.to_timestamp(v_issued), pg_catalog.to_timestamp(v_expires));
  return pg_catalog.jsonb_build_object('userId', v_target, 'authEmail', v_auth_email);
exception when unique_violation then
  raise exception 'FINANCE_PORTAL_HANDOFF_REPLAY' using errcode = '42501';
end;
$finance_portal_handoff_consume$;
revoke all on function public.finance_portal_handoff_consume(jsonb) from public, anon, authenticated;
grant execute on function public.finance_portal_handoff_consume(jsonb) to service_role;

-- Rechecked after the Finance session is minted, so a logout or membership
-- change during the exchange cannot leave a new session open.
create function public.finance_portal_handoff_finalize(payload jsonb)
returns boolean language plpgsql stable security definer set search_path = '' as $finance_portal_handoff_finalize$
declare
  v_jti uuid;
  v_user uuid;
  v_receipt portal_handoff_private.consumed%rowtype;
begin
  begin
    v_jti := (payload->>'jti')::uuid;
    v_user := (payload->>'userId')::uuid;
  exception when others then
    return false;
  end;
  select * into v_receipt from portal_handoff_private.consumed h
  where h.jti = v_jti and h.user_id = v_user;
  if v_receipt.jti is null or v_receipt.expires_at <= pg_catalog.clock_timestamp() then
    return false;
  end if;
  if exists (
    select 1 from logout_private.module_receipts r
    where (r.google_subject = v_receipt.google_subject or r.verified_email = v_receipt.verified_email)
      and r.revoke_before >= v_receipt.issued_at
  ) then
    return false;
  end if;
  return exists (
    select 1 from public.finance_users fu
    where fu.active = true
      and fu.auth_user_id = v_receipt.user_id
      and fu.google_link_status in ('bound', 'pending_rebind')
      and pg_catalog.lower(pg_catalog.btrim(fu.email)) = v_receipt.verified_email
  );
end;
$finance_portal_handoff_finalize$;
revoke all on function public.finance_portal_handoff_finalize(jsonb) from public, anon, authenticated;
grant execute on function public.finance_portal_handoff_finalize(jsonb) to service_role;
notify pgrst, 'reload schema';
