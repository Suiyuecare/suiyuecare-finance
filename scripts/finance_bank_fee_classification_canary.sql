-- Exact catalog and anonymous rejection only; no staff identity or business action.
begin isolation level repeatable read read only;
set local statement_timeout='20s';
-- FINANCE_AUTHENTICATED_CANARY_CORE_BEGIN
do $bank_fee_identity_guard$
declare expected record; proc pg_catalog.pg_proc%rowtype;
begin
  for expected in select * from (values
    ('private.finance_expense_resubmit_applicant_revision_v1_unsafe(text,text,text,integer,timestamptz,integer,text,jsonb,jsonb,text)','ccaad5b351be270e9597a02271518585',false),
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
do $bank_fee_ledger_guard$
begin
  if not exists(select 1 from supabase_migrations.schema_migrations
      where version='20261016043221' and name='finance_bank_fee_classification_v1'
        and pg_catalog.md5(pg_catalog.array_to_string(statements,''))='de4fabd6b440789435a1ff499f20c868') then
    raise exception 'Bank fee classification sealed ledger missing or differs' using errcode='55000';
  end if;
end;
$bank_fee_ledger_guard$;
do $bank_fee_no_identity$
declare action text; denied boolean;
begin
  execute 'set local role authenticated';
  if auth.uid() is not null then raise exception 'Bank fee classification canary requires no staff identity';end if;
  foreach action in array array['resubmit','cancel']::text[] loop
    denied:=false;
    begin
      perform public.finance_expense_resubmit_applicant_revision(
        'anonymous-bank-fee-canary',action,'anonymous-bank-fee-canary-'||action,
        1,'2000-01-01T00:00:00Z'::timestamptz,1,null,'{}'::jsonb,'[]'::jsonb,'test');
    exception when insufficient_privilege then denied:=true;
    end;
    if not denied then raise exception 'Revision accepted an anonymous session' using errcode='42501';end if;
  end loop;
  execute 'reset role';
end;
$bank_fee_no_identity$;
-- FINANCE_AUTHENTICATED_CANARY_CORE_END
rollback;
-- FINANCE_AUTHENTICATED_CANARY_ROLLBACK_CHECK_BEGIN
do $bank_fee_rollback$
begin
  if pg_catalog.current_setting('transaction_read_only')='on' then raise exception 'Bank fee classification canary remains open';end if;
end;
$bank_fee_rollback$;
-- FINANCE_AUTHENTICATED_CANARY_ROLLBACK_CHECK_END
select 'FINANCE_BANK_FEE_CLASSIFICATION_CANARY_ROLLED_BACK' as marker,
 pg_catalog.jsonb_build_object('canary','readonly_bank_fee_classification_v1','ok',true,'rolled_back',true,
 'staff_identity_used',false,'business_mutation_performed',false) as bank_fee_classification_canary_result;
