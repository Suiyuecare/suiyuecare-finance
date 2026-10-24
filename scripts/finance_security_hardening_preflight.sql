\set ON_ERROR_STOP on

-- Read-only prerequisites for 20261024100000. No business rows are read.
do $security_hardening_preflight$
declare r record;
begin
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
    raise exception 'Verified attachment read policy is missing' using errcode = '55000';
  end if;
  if pg_catalog.to_regclass('public.payee_bank_accounts') is null
     or pg_catalog.to_regclass('public.draft_requests') is null
     or pg_catalog.to_regprocedure('public.current_finance_user_id()') is null
     or not pg_catalog.has_function_privilege('authenticated', 'public.current_finance_user_id()', 'EXECUTE') then
    raise exception 'Verified identity helper or protected tables are missing' using errcode = '55000';
  end if;
end;
$security_hardening_preflight$;
select 'FINANCE_SECURITY_HARDENING_PREFLIGHT_OK' as marker;
