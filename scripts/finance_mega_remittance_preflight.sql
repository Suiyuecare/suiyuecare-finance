\set ON_ERROR_STOP on

-- Catalog inspection only: no employee identities, requests or payroll values.
-- FINANCE_MEGA_EXISTING_AUTHORITY_BEGIN
do $mega_existing_authority$
declare expected record; proc pg_catalog.pg_proc%rowtype;
begin
  perform pg_catalog.set_config('search_path','',true);
  for expected in select * from (values
    ('public.current_finance_user()','6be8d5dcd919aa90abb13e9be00cc4eb',true,'s'),
    ('public.can_read_expense_request(public.expense_requests)','246cf9196ea0b5298108e431f562286f',false,'s'),
    ('private.finance_income_active_step_index(jsonb)','ee9262d3895a46cd966900b255efde9b',false,'i'),
    ('private.finance_income_step_role(jsonb)','be6a8e74dc4d01edce92881af09a05e1',false,'i'),
    ('private.finance_income_step_user_id(jsonb)','def324bfc6b15ffdf4b335a0b3527e62',false,'i')
  ) x(signature,definition_md5,security_definer,volatility) loop
    select * into proc from pg_catalog.pg_proc where oid=pg_catalog.to_regprocedure(expected.signature);
    if proc.oid is null or pg_catalog.md5(pg_catalog.pg_get_functiondef(proc.oid)) is distinct from expected.definition_md5
       or pg_catalog.pg_get_userbyid(proc.proowner) is distinct from 'postgres'
       or proc.prosecdef is distinct from expected.security_definer or proc.provolatile::text is distinct from expected.volatility
       or proc.proconfig is distinct from array['search_path=""']::text[] then
      raise exception 'Mega remittance existing authority drift: %',expected.signature using errcode='55000';
    end if;
  end loop;
end;
$mega_existing_authority$;
-- FINANCE_MEGA_EXISTING_AUTHORITY_END

do $mega_prerequisites$
declare signature text;
begin
  if pg_catalog.to_regclass('public.expense_requests') is null
     or pg_catalog.to_regclass('public.finance_users') is null
     or pg_catalog.to_regnamespace('private') is null then
    raise exception 'Mega remittance prerequisite schema missing' using errcode='55000';
  end if;
  foreach signature in array array[
    'public.current_finance_user()',
    'public.can_read_expense_request(public.expense_requests)',
    'private.finance_income_active_step_index(jsonb)',
    'private.finance_income_step_role(jsonb)',
    'private.finance_income_step_user_id(jsonb)'
  ] loop
    if pg_catalog.to_regprocedure(signature) is null then
      raise exception 'Mega remittance prerequisite function missing: %',signature using errcode='55000';
    end if;
  end loop;
  if exists(select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
       where n.nspname in ('private','public') and p.proname like 'finance_mega_%')
     or exists(select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
       where n.nspname='private' and c.relname like 'finance_mega_%')
     or exists(select 1 from supabase_migrations.schema_migrations where version='20261018074245') then
    raise exception 'Mega remittance new objects or migration receipt already exist' using errcode='55000';
  end if;
end;
$mega_prerequisites$;

select 'FINANCE_MEGA_REMITTANCE_PREFLIGHT_OK' as marker;
