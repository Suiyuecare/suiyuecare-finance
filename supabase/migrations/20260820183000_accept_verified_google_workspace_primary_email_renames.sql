-- Purpose: allow a verified Google Workspace primary-email rename to finish
-- the existing Finance first-login/rebind workflow without directly mutating
-- auth.users or auth.identities.  Google provider identity + verified company
-- email remain authoritative; duplicate identities and unapproved Finance
-- targets continue to fail closed.
--
-- This migration is intentionally non-rerunnable.  It pins the live function
-- definitions and applies exact, reversible replacements so unexpected schema
-- drift aborts the whole transaction.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $preflight$
declare
  v_actual text;
begin
  select encode(extensions.digest(pg_get_functiondef(
    'public.finance_verified_google_email(uuid)'::regprocedure
  ), 'sha256'), 'hex') into v_actual;
  if v_actual <> '84e0cfd4a03ca580bf9874a451bd7f3eaa74942a53684e3505412a6e2cbfbb9c' then
    raise exception 'finance_verified_google_email drifted: %', v_actual;
  end if;

  select encode(extensions.digest(pg_get_functiondef(
    'private.finance_complete_verified_google_account_link_v2(uuid,text,uuid)'::regprocedure
  ), 'sha256'), 'hex') into v_actual;
  if v_actual <> '4a77312957e60a2b352f4d25cf4827e6bb1cf56eeb5811af862315cb4bde5c09' then
    raise exception 'finance_complete_verified_google_account_link_v2 drifted: %', v_actual;
  end if;

  select encode(extensions.digest(pg_get_functiondef(
    'private.finance_google_projection_health_v2(uuid,text)'::regprocedure
  ), 'sha256'), 'hex') into v_actual;
  if v_actual <> 'c6d6eae5fd3ee5b4d9af535072dd539309d7e6fc77c79a3c7dd4d444db65e170' then
    raise exception 'finance_google_projection_health_v2 drifted: %', v_actual;
  end if;

  select encode(extensions.digest(pg_get_functiondef(
    'public.finance_admin_google_account_link_status_v2(text)'::regprocedure
  ), 'sha256'), 'hex') into v_actual;
  if v_actual <> 'a9101a76a46887747876f4e1c911cfea96f36579bd54febfcaa855d7538a3565' then
    raise exception 'finance_admin_google_account_link_status_v2 drifted: %', v_actual;
  end if;

  if (
    select count(*)
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where not t.tgisinternal
      and n.nspname = 'auth'
      and c.relname = 'identities'
      and t.tgenabled = 'O'
      and t.tgname in (
        'trg_finance_00_complete_google_account_link_v2',
        'trg_finance_00_guard_google_identity_lifecycle_v2'
      )
  ) <> 2 then
    raise exception 'Finance Google identity lifecycle triggers are unavailable';
  end if;
end;
$preflight$;

do $replace_definitions$
declare
  v_oid oid;
  v_source text;
  v_target text;
  v_old text;
  v_new text;
  v_count integer;
begin
  -- The verified Google provider identity is the authoritative source for a
  -- Workspace primary email.  auth.users.email may legitimately retain the
  -- pre-rename address; Auth itself still owns and verifies auth.identities.
  v_oid := 'public.finance_verified_google_email(uuid)'::regprocedure;
  v_source := pg_get_functiondef(v_oid);
  v_old := E'    and lower(btrim(auth_user.email)) =\n        lower(btrim(identity.identity_data ->> ''email''))\n';
  v_new := E'    -- GOOGLE_WORKSPACE_PRIMARY_EMAIL_RENAME_V1: the verified Google identity email is authoritative.\n';
  v_count := (length(v_source) - length(replace(v_source, v_old, ''))) / length(v_old);
  if v_count <> 1 then
    raise exception 'finance_verified_google_email replacement count: %', v_count;
  end if;
  v_target := replace(v_source, v_old, v_new);
  execute v_target;
  if pg_get_functiondef(v_oid) <> v_target then
    raise exception 'finance_verified_google_email replacement did not converge';
  end if;

  -- Preserve the full atomic linking workflow, but determine uniqueness from
  -- verified Google identities rather than the stale auth.users email field.
  v_oid := 'private.finance_complete_verified_google_account_link_v2(uuid,text,uuid)'::regprocedure;
  v_source := pg_get_functiondef(v_oid);
  v_old := E'    and lower(btrim(coalesce(auth_user.email, ''''))) = v_google_email\n';
  v_new := E'    -- GOOGLE_WORKSPACE_PRIMARY_EMAIL_RENAME_V1: auth.users.email may retain the pre-rename address.\n';
  v_count := (length(v_source) - length(replace(v_source, v_old, ''))) / length(v_old);
  if v_count <> 1 then
    raise exception 'finance_complete_verified_google_account_link_v2 replacement count: %', v_count;
  end if;
  v_target := replace(v_source, v_old, v_new);
  execute v_target;
  if pg_get_functiondef(v_oid) <> v_target then
    raise exception 'finance_complete_verified_google_account_link_v2 replacement did not converge';
  end if;

  -- Projection health must use the same authority rule as the finalizer or a
  -- successful bind would be rolled back as an apparent projection mismatch.
  v_oid := 'private.finance_google_projection_health_v2(uuid,text)'::regprocedure;
  v_source := pg_get_functiondef(v_oid);

  v_old := E'    and lower(btrim(coalesce(auth_user.email, ''''))) = lower(btrim(v_finance.email))\n';
  v_new := E'    -- GOOGLE_WORKSPACE_PRIMARY_EMAIL_RENAME_V1: current identity email is authoritative.\n';
  v_count := (length(v_source) - length(replace(v_source, v_old, ''))) / length(v_old);
  if v_count <> 1 then
    raise exception 'finance_google_projection_health_v2 current-email replacement count: %', v_count;
  end if;
  v_source := replace(v_source, v_old, v_new);

  v_old := E'    and lower(btrim(coalesce(auth_user.email, ''''))) = lower(btrim(v_finance.pending_login_email))\n';
  v_new := E'    -- GOOGLE_WORKSPACE_PRIMARY_EMAIL_RENAME_V1: pending identity email is authoritative.\n';
  v_count := (length(v_source) - length(replace(v_source, v_old, ''))) / length(v_old);
  if v_count <> 1 then
    raise exception 'finance_google_projection_health_v2 pending-email replacement count: %', v_count;
  end if;
  v_target := replace(v_source, v_old, v_new);
  execute v_target;
  if pg_get_functiondef(v_oid) <> v_target then
    raise exception 'finance_google_projection_health_v2 replacement did not converge';
  end if;

  -- Keep the administrator-facing identity count consistent with the actual
  -- login and projection rules.
  v_oid := 'public.finance_admin_google_account_link_status_v2(text)'::regprocedure;
  v_source := pg_get_functiondef(v_oid);
  v_old := E'    and lower(btrim(coalesce(auth_user.email, ''''))) =\n        lower(btrim(coalesce(v_finance.pending_login_email, v_finance.email)))\n';
  v_new := E'    -- GOOGLE_WORKSPACE_PRIMARY_EMAIL_RENAME_V1: count the verified Google identity, not a stale Auth email.\n';
  v_count := (length(v_source) - length(replace(v_source, v_old, ''))) / length(v_old);
  if v_count <> 1 then
    raise exception 'finance_admin_google_account_link_status_v2 replacement count: %', v_count;
  end if;
  v_target := replace(v_source, v_old, v_new);
  execute v_target;
  if pg_get_functiondef(v_oid) <> v_target then
    raise exception 'finance_admin_google_account_link_status_v2 replacement did not converge';
  end if;
end;
$replace_definitions$;

do $postflight$
declare
  v_count integer;
begin
  select count(*) into v_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where (n.nspname, p.proname) in (
    ('public', 'finance_verified_google_email'),
    ('private', 'finance_complete_verified_google_account_link_v2'),
    ('private', 'finance_google_projection_health_v2'),
    ('public', 'finance_admin_google_account_link_status_v2')
  )
    and p.prokind = 'f'
    and p.prosecdef = true
    and p.proowner = 'postgres'::regrole
    and array_position(p.proconfig, 'search_path=""') is not null;

  -- finance_verified_google_email deliberately retains its existing explicit
  -- public/auth search_path; the other three remain empty-search-path SECDEF.
  if v_count <> 3 then
    raise exception 'SECURITY DEFINER owner/search_path postflight failed: %', v_count;
  end if;

  if not exists (
    select 1
    from pg_proc p
    where p.oid = 'public.finance_verified_google_email(uuid)'::regprocedure
      and p.prosecdef = true
      and p.proowner = 'postgres'::regrole
      and p.proconfig = array['search_path=public, auth, pg_temp']::text[]
      and p.prosrc like '%GOOGLE_WORKSPACE_PRIMARY_EMAIL_RENAME_V1%'
  ) then
    raise exception 'finance_verified_google_email postflight failed';
  end if;

  if (
    select count(*)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where (n.nspname, p.proname) in (
      ('public', 'finance_verified_google_email'),
      ('private', 'finance_complete_verified_google_account_link_v2'),
      ('private', 'finance_google_projection_health_v2'),
      ('public', 'finance_admin_google_account_link_status_v2')
    )
      and p.prosrc like '%GOOGLE_WORKSPACE_PRIMARY_EMAIL_RENAME_V1%'
  ) <> 4 then
    raise exception 'Workspace primary-email rename markers are incomplete';
  end if;

  -- Public must not gain execution rights.  The two private helpers remain
  -- postgres-only; the two public functions retain their original narrow ACLs.
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x on true
    where (n.nspname, p.proname) in (
      ('public', 'finance_verified_google_email'),
      ('private', 'finance_complete_verified_google_account_link_v2'),
      ('private', 'finance_google_projection_health_v2'),
      ('public', 'finance_admin_google_account_link_status_v2')
    )
      and x.grantee = 0
  ) then
    raise exception 'PUBLIC execute privilege unexpectedly present';
  end if;

  if (
    select count(*)
    from auth.identities identity
    join auth.users auth_user on auth_user.id = identity.user_id
    where identity.provider = 'google'
      and lower(coalesce(identity.identity_data ->> 'email_verified', 'false')) in ('true', '1')
      and lower(split_part(btrim(coalesce(identity.identity_data ->> 'email', '')), '@', 2)) = 'suiyuecare.com'
      and auth_user.deleted_at is null
      and coalesce(btrim(identity.provider_id), '') <> ''
  ) < 1 then
    raise exception 'No verified company Google identity remains available';
  end if;
end;
$postflight$;

comment on function public.finance_verified_google_email(uuid) is
  'Returns the unique verified company Google identity email for an Auth user. Google identity email is authoritative across Workspace primary-email renames; auth.users.email may be stale.';

notify pgrst, 'reload schema';

commit;
