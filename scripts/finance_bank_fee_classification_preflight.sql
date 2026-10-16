\set ON_ERROR_STOP on
do $bank_fee_identity_guard$
declare expected record; proc pg_catalog.pg_proc%rowtype;
begin
  for expected in select * from (values
    ('private.finance_expense_resubmit_applicant_revision_v1_unsafe(text,text,text,integer,timestamptz,integer,text,jsonb,jsonb,text)','5dedbec02d1440f855c69cdab2684515',false),
    ('public.finance_expense_resubmit_applicant_revision(text,text,text,integer,timestamptz,integer,text,jsonb,jsonb,text)','6af47c58cd50b60f0a500ac8221a57e3',true)
  ) x(signature,definition_md5,client_execute) loop
    select * into proc from pg_catalog.pg_proc where oid=pg_catalog.to_regprocedure(expected.signature);
    if proc.oid is null or pg_catalog.md5(pg_catalog.pg_get_functiondef(proc.oid)) is distinct from expected.definition_md5
       or pg_catalog.pg_get_userbyid(proc.proowner) is distinct from 'postgres'
       or proc.prosecdef is distinct from true or proc.provolatile is distinct from 'v'
       or proc.proconfig is distinct from array['search_path=""']::text[]
       or pg_catalog.has_function_privilege('anon',proc.oid,'EXECUTE')
       or pg_catalog.has_function_privilege('authenticated',proc.oid,'EXECUTE') is distinct from expected.client_execute
       or pg_catalog.has_function_privilege('service_role',proc.oid,'EXECUTE') is distinct from expected.client_execute
       or exists(select 1 from pg_catalog.aclexplode(coalesce(proc.proacl,pg_catalog.acldefault('f',proc.proowner))) a
         where a.privilege_type='EXECUTE' and a.grantee<>(select oid from pg_catalog.pg_roles where rolname='postgres')
           and (not expected.client_execute or a.grantee not in (
             (select oid from pg_catalog.pg_roles where rolname='authenticated'),
             (select oid from pg_catalog.pg_roles where rolname='service_role')))) then
      raise exception 'Bank fee classification authority/source drift: %',expected.signature using errcode='55000';
    end if;
  end loop;
end;
$bank_fee_identity_guard$;

select 'FINANCE_BANK_FEE_CLASSIFICATION_PREFLIGHT_OK' as marker;
