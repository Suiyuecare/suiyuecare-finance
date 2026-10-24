-- Read-only production proof; no employee identity, business mutation or Storage access.
begin isolation level repeatable read read only;
set local statement_timeout='20s';
-- FINANCE_AUTHENTICATED_CANARY_CORE_BEGIN
do $security_hardening_guard$
declare role_name text; v pg_catalog.regclass;
begin
  if auth.uid() is not null then raise exception 'Security hardening canary requires no staff identity';end if;
  foreach role_name in array array['anon','authenticated'] loop
    if pg_catalog.has_table_privilege(role_name,'public.ledger_entries','INSERT,UPDATE,DELETE,TRUNCATE')
       or pg_catalog.has_table_privilege(role_name,'public.vouchers','INSERT,UPDATE,DELETE,TRUNCATE')
       or pg_catalog.has_any_column_privilege(role_name,'public.ledger_entries','INSERT,UPDATE')
       or pg_catalog.has_any_column_privilege(role_name,'public.vouchers','INSERT,UPDATE') then
      raise exception 'Browser role can still write the books: %',role_name using errcode='23514';
    end if;
  end loop;
  foreach v in array array[pg_catalog.to_regclass('public.finance_production_ledger_entries'),pg_catalog.to_regclass('public.finance_test_ledger_entries')] loop
    if v is not null and (pg_catalog.has_table_privilege('anon',v,'SELECT')
      or not exists(select 1 from pg_catalog.pg_class c where c.oid=v and c.reloptions && array['security_invoker=true','security_invoker=on']::text[])) then
      raise exception 'Environment ledger view is not caller-scoped: %',v using errcode='23514';
    end if;
  end loop;
  if exists(select 1 from pg_catalog.pg_policy where polrelid='storage.objects'::pg_catalog.regclass and polname='finance attachment read scoped') then
    raise exception 'Legacy folder-wide attachment read policy remains' using errcode='23514';
  end if;
  if not exists(select 1 from pg_catalog.pg_policy where polrelid='public.payee_bank_accounts'::pg_catalog.regclass and polname='payee_bank_accounts_verified_identity_v1' and not polpermissive)
     or (select count(*) from pg_catalog.pg_policy where polrelid='public.draft_requests'::pg_catalog.regclass and not polpermissive and polname in ('draft_requests_insert_caller_owner_v1','draft_requests_update_caller_owner_v1'))<>2 then
    raise exception 'Verified-identity or caller-owner policy is missing' using errcode='23514';
  end if;
end;
$security_hardening_guard$;
-- FINANCE_AUTHENTICATED_CANARY_CORE_END
rollback;
-- FINANCE_AUTHENTICATED_CANARY_ROLLBACK_CHECK_BEGIN
do $rolled_back$ begin
 if current_setting('transaction_read_only')='on' then raise exception 'Security hardening canary remains open';end if;
end; $rolled_back$;
-- FINANCE_AUTHENTICATED_CANARY_ROLLBACK_CHECK_END
select 'FINANCE_SECURITY_HARDENING_CANARY_ROLLED_BACK' as marker,
 jsonb_build_object('canary','readonly_security_hardening_v1','ok',true,'rolled_back',true,
 'staff_identity_used',false,'business_mutation_performed',false) as security_hardening_canary_result;
