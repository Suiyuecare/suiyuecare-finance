\set ON_ERROR_STOP on
do $approval_tasks_identity_guard$
declare expected record; proc pg_catalog.pg_proc%rowtype;
begin
  for expected in select * from (values
    ('public.finance_approval_tasks_for_current_user(text)','a99f1dd41923ab610c88095c8cf1ab89','search_path=public, pg_temp',true),
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

select 'FINANCE_APPROVAL_TASKS_VERIFIED_SESSION_PREFLIGHT_OK' as marker;
