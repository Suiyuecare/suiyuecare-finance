-- 2026-10-24 audit hardening. Privileges, view options and one Storage policy
-- only; no business row is read for output, inserted, updated or deleted.
--
-- 1. Browser roles lose direct INSERT/UPDATE/DELETE/TRUNCATE on the books.
--    Every posting path is a SECURITY DEFINER RPC; a direct REST write could
--    create an unbalanced voucher, edit unkeyed history or squat posting keys.
-- 2. The optional environment ledger views run with the caller's rights so the
--    ledger RLS, including the restrictive HR salary scope, applies to them.
-- 3. The legacy folder-wide Storage read rule is removed. The verified
--    parent-scoped read policy from the 2026-09-22 release remains.
-- 4. Shared payee bank accounts require a verified, bound Finance identity,
--    not merely a token whose email claim matches an active user.
-- 5. A draft can only be written as the caller's own, so nobody can place a
--    draft into another person's (for example the CEO's) draft list.
do $preflight$
declare r record;
begin
  -- Revoking browser writes must not strand a routine that writes the books
  -- with the caller's rights; such a routine stops the release unchanged.
  for r in
    select p.oid::pg_catalog.regprocedure::text as signature
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where (n.nspname in ('public', 'private', 'logout_private') or n.nspname like 'finance\_%')
      and p.prokind = 'f'
      and not p.prosecdef
      and p.prosrc ~* '(insert[[:space:]]+into|update|delete[[:space:]]+from)[[:space:]]+("?public"?[[:space:]]*\.[[:space:]]*)?"?(ledger_entries|vouchers)"?([^[:alnum:]_]|$)'
      and (pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
        or p.prorettype = 'pg_catalog.trigger'::pg_catalog.regtype)
  loop
    raise exception 'Caller-rights routine writes ledger_entries or vouchers: %', r.signature
      using errcode = '55000';
  end loop;

  if pg_catalog.to_regclass('public.ledger_entries') is null
     or pg_catalog.to_regclass('public.vouchers') is null then
    raise exception 'Finance books tables are missing' using errcode = '55000';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_policy
    where polrelid = 'storage.objects'::pg_catalog.regclass
      and polname = 'finance_attachments_select_verified_tenant_metadata_v2'
      and polpermissive and polcmd = 'r'
  ) then
    raise exception 'Verified attachment read policy is missing; the legacy rule cannot be removed'
      using errcode = '55000';
  end if;

  if pg_catalog.to_regclass('public.payee_bank_accounts') is null
     or pg_catalog.to_regclass('public.draft_requests') is null
     or pg_catalog.to_regprocedure('public.current_finance_user_id()') is null
     or not pg_catalog.has_function_privilege('authenticated', 'public.current_finance_user_id()', 'EXECUTE') then
    raise exception 'Verified identity helper or protected tables are missing' using errcode = '55000';
  end if;
end
$preflight$;

revoke insert, update, delete, truncate on table public.ledger_entries, public.vouchers
  from public, anon, authenticated;

-- Column grants survive a table-level REVOKE, so remove any that exist.
do $column_grants$
declare r record;
begin
  for r in
    select c.oid::pg_catalog.regclass as relation, a.attname, grantee.rolname, acl.privilege_type
    from pg_catalog.pg_class c
    join pg_catalog.pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
    cross join lateral pg_catalog.aclexplode(a.attacl) acl
    join pg_catalog.pg_roles grantee on grantee.oid = acl.grantee
    where c.oid in ('public.ledger_entries'::pg_catalog.regclass, 'public.vouchers'::pg_catalog.regclass)
      and grantee.rolname in ('anon', 'authenticated')
      and acl.privilege_type in ('INSERT', 'UPDATE')
  loop
    execute pg_catalog.format('revoke %s (%I) on table %s from %I',
      r.privilege_type, r.attname, r.relation, r.rolname);
  end loop;
end
$column_grants$;

do $environment_views$
declare v pg_catalog.regclass;
begin
  foreach v in array array[
    pg_catalog.to_regclass('public.finance_production_ledger_entries'),
    pg_catalog.to_regclass('public.finance_test_ledger_entries')
  ] loop
    if v is not null then
      execute pg_catalog.format('alter view %s set (security_invoker = true)', v);
      execute pg_catalog.format('revoke all on table %s from public, anon', v);
    end if;
  end loop;
end
$environment_views$;

drop policy if exists "finance attachment read scoped" on storage.objects;

drop policy if exists payee_bank_accounts_verified_identity_v1 on public.payee_bank_accounts;
create policy payee_bank_accounts_verified_identity_v1 on public.payee_bank_accounts
  as restrictive for all to authenticated
  using ((select public.current_finance_user_id()) is not null)
  with check ((select public.current_finance_user_id()) is not null);

drop policy if exists draft_requests_insert_caller_owner_v1 on public.draft_requests;
create policy draft_requests_insert_caller_owner_v1 on public.draft_requests
  as restrictive for insert to authenticated
  with check (owner_id = (select public.current_finance_user_id()));

drop policy if exists draft_requests_update_caller_owner_v1 on public.draft_requests;
create policy draft_requests_update_caller_owner_v1 on public.draft_requests
  as restrictive for update to authenticated
  using (true)
  with check (owner_id = (select public.current_finance_user_id()));
