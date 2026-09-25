-- Catalog-only canary; no employee records or business data are read.
begin isolation level repeatable read read only;
set local statement_timeout='15s';
-- FINANCE_AUTHENTICATED_CANARY_CORE_BEGIN
do $demo_password_retirement_canary$
declare
  table_oid oid := 'public.finance_users'::pg_catalog.regclass;
begin
  if exists (
    select 1 from pg_catalog.pg_attribute
    where attrelid=table_oid and attname='demo_password'
      and attnum>0 and not attisdropped
  ) then
    raise exception 'Retired password column remains visible';
  end if;
  if exists (
    select 1 from pg_catalog.pg_trigger
    where tgrelid=table_oid and not tgisinternal
      and tgname='trg_finance_strip_demo_password'
  ) or pg_catalog.to_regprocedure('public.finance_strip_demo_password()') is not null then
    raise exception 'Retired password trigger/function remains installed';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_class
    where oid=table_oid and relrowsecurity and relforcerowsecurity
  ) then
    raise exception 'Finance user directory lost its forced RLS boundary';
  end if;
  if not pg_catalog.has_table_privilege('authenticated',table_oid,'SELECT') then
    raise exception 'Authenticated directory reads were unexpectedly revoked';
  end if;
  if not pg_catalog.has_column_privilege('authenticated',table_oid,'id','SELECT')
     or not pg_catalog.has_column_privilege('authenticated',table_oid,'name','SELECT')
     or not pg_catalog.has_column_privilege('authenticated',table_oid,'email','SELECT')
     or not pg_catalog.has_column_privilege('authenticated',table_oid,'role','SELECT')
     or not pg_catalog.has_column_privilege('authenticated',table_oid,'active','SELECT') then
    raise exception 'Authenticated Finance directory fields are not readable';
  end if;
  if exists (
    select 1 from pg_catalog.pg_policies
    where schemaname='public' and tablename='finance_users'
      and 'anon' = any(roles::text[]) and cmd in ('SELECT','ALL')
  ) then
    raise exception 'Anonymous Finance directory read policy is present';
  end if;
end;
$demo_password_retirement_canary$;
-- FINANCE_AUTHENTICATED_CANARY_CORE_END
rollback;
-- FINANCE_AUTHENTICATED_CANARY_ROLLBACK_CHECK_BEGIN
do $demo_password_retirement_rollback$
begin
  if auth.uid() is not null or current_user in ('anon','authenticated','service_role') then
    raise exception 'Password retirement canary left an employee/browser context';
  end if;
end;
$demo_password_retirement_rollback$;
-- FINANCE_AUTHENTICATED_CANARY_ROLLBACK_CHECK_END
select jsonb_build_object('canary','finance_demo_password_retirement_v1','ok',true,'rolled_back',true) as demo_password_retirement_canary_result;
