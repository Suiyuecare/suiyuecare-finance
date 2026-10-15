-- Real catalog and anonymous-session checks only; no staff identity or business action.
begin isolation level repeatable read read only;
set local statement_timeout='20s';
-- FINANCE_AUTHENTICATED_CANARY_CORE_BEGIN
do $approval_tasks_identity_guard$
declare expected record; proc pg_catalog.pg_proc%rowtype;
begin
  for expected in select * from (values
    ('public.finance_approval_tasks_for_current_user(text)','765a6b9f47b54802c86cea8423d6d90d','search_path=public, pg_temp',true),
    ('public.current_finance_user()','138acd5e90d5546d28de5874b83305ef','search_path=""',true),
    ('public.finance_auth_session_active()','d2ca6446e8985414ad8272d551995973','search_path=""',false)
  ) x(signature,definition_md5,search_path,service_execute) loop
    select * into proc from pg_catalog.pg_proc where oid=pg_catalog.to_regprocedure(expected.signature);
    if proc.oid is null or pg_catalog.md5(pg_catalog.pg_get_functiondef(proc.oid)) is distinct from expected.definition_md5
       or pg_catalog.pg_get_userbyid(proc.proowner) is distinct from 'postgres'
       or proc.prosecdef is distinct from true or proc.provolatile is distinct from 's'
       or proc.proconfig is distinct from array[expected.search_path]::text[]
       or pg_catalog.has_function_privilege('anon',proc.oid,'EXECUTE')
       or pg_catalog.has_function_privilege('authenticated',proc.oid,'EXECUTE') is distinct from true
       or pg_catalog.has_function_privilege('service_role',proc.oid,'EXECUTE') is distinct from expected.service_execute
       or exists(select 1 from pg_catalog.aclexplode(coalesce(proc.proacl,pg_catalog.acldefault('f',proc.proowner))) a
         where a.privilege_type='EXECUTE' and a.grantee not in (
           (select oid from pg_catalog.pg_roles where rolname='postgres'),
           (select oid from pg_catalog.pg_roles where rolname='authenticated'),
           (select oid from pg_catalog.pg_roles where rolname='service_role'))) then
      raise exception 'Approval tasks verified session authority/source drift: %',expected.signature using errcode='55000';
    end if;
  end loop;
end;
$approval_tasks_identity_guard$;
do $approval_tasks_ledger_guard$
begin
  if not exists(select 1 from supabase_migrations.schema_migrations
      where version='20261015172658' and name='finance_approval_tasks_verified_session_v1'
        and pg_catalog.md5(pg_catalog.array_to_string(statements,''))='1450d72c0fa19b9870150ec399dd29c1') then
    raise exception 'Approval tasks verified session sealed ledger missing or differs' using errcode='55000';
  end if;
end;
$approval_tasks_ledger_guard$;
do $approval_tasks_no_identity$
begin
  execute 'set local role authenticated';
  if auth.uid() is not null then raise exception 'Approval tasks canary requires no staff identity';end if;
  if public.finance_auth_session_active() is distinct from false then raise exception 'Anonymous session was activated';end if;
  if exists(select 1 from public.finance_approval_tasks_for_current_user('pending'))
     or exists(select 1 from public.finance_approval_tasks_for_current_user(null)) then
    raise exception 'Approval tasks exposed records without a verified session' using errcode='42501';
  end if;
  execute 'reset role';
end;
$approval_tasks_no_identity$;
-- FINANCE_AUTHENTICATED_CANARY_CORE_END
rollback;
-- FINANCE_AUTHENTICATED_CANARY_ROLLBACK_CHECK_BEGIN
do $approval_tasks_rollback$
begin
  if pg_catalog.current_setting('transaction_read_only')='on' then raise exception 'Approval tasks canary remains open';end if;
end;
$approval_tasks_rollback$;
-- FINANCE_AUTHENTICATED_CANARY_ROLLBACK_CHECK_END
select 'FINANCE_APPROVAL_TASKS_VERIFIED_SESSION_CANARY_ROLLED_BACK' as marker,
 pg_catalog.jsonb_build_object('canary','readonly_approval_tasks_verified_session_v1','ok',true,'rolled_back',true,
 'staff_identity_used',false,'business_mutation_performed',false) as approval_tasks_verified_session_canary_result;
