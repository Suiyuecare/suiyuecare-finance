\set ON_ERROR_STOP on
-- Catalog and account readiness only: no lecturer identity, bank, or payroll row is returned.
do $finance_external_labor_postflight$
declare r record;role_name text;required_code text;missing_code text;
begin
 if to_regclass('private.finance_labor_statements_v1') is null
  or to_regclass('private.finance_labor_payments_v1') is null
  or to_regclass('private.finance_labor_payment_lines_v1') is null then
  raise exception 'External labor private schema is incomplete';end if;
 for r in select c.oid,c.relname,c.relrowsecurity,c.relforcerowsecurity
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='private' and c.relkind='r' and c.relname like 'finance_labor_%_v1' loop
  if not r.relrowsecurity or not r.relforcerowsecurity then
   raise exception 'External labor RLS/force boundary changed: %',r.relname;end if;
  foreach role_name in array array['anon','authenticated','service_role'] loop
   if has_table_privilege(role_name,r.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then
    raise exception 'External labor private table exposed: % / %',r.relname,role_name;end if;
  end loop;
 end loop;
 if (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='private' and c.relkind='r' and c.relname like 'finance_labor_%_v1')<>10 then
  raise exception 'External labor private table catalog differs';end if;
 for r in select p.oid,p.proname,n.nspname,p.prosecdef,p.proconfig
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in('private','public') and p.proname like 'finance_labor_%_v1' loop
  if r.proconfig is distinct from array['search_path=""']::text[] then
   raise exception 'External labor search_path unsealed: %',p.oid::regprocedure;end if;
  if r.nspname='public' and r.prosecdef is distinct from true then
   raise exception 'External labor wrapper privilege differs: %',r.oid::regprocedure;end if;
  if has_function_privilege('anon',r.oid,'execute') then
   raise exception 'External labor callable by anon: %',r.oid::regprocedure;end if;
  if r.nspname='private' then
   if has_function_privilege('authenticated',r.oid,'execute')
    or has_function_privilege('service_role',r.oid,'execute') then
    raise exception 'External labor private helper exposed: %',r.oid::regprocedure;end if;
  elsif r.proname like 'finance_labor_guest_%' then
   if has_function_privilege('authenticated',r.oid,'execute')
    or not has_function_privilege('service_role',r.oid,'execute') then
    raise exception 'External labor guest wrapper ACL differs: %',r.oid::regprocedure;end if;
  elsif not has_function_privilege('authenticated',r.oid,'execute')
   or has_function_privilege('service_role',r.oid,'execute') then
   raise exception 'External labor staff wrapper ACL differs: %',r.oid::regprocedure;
  end if;
 end loop;
 foreach required_code in array array['finance_labor_request_guard_v1','finance_labor_legacy_book_v1'] loop
  if not exists(select 1 from pg_trigger t where t.tgrelid='public.expense_requests'::regclass
   and t.tgname=required_code and t.tgenabled='O') and required_code='finance_labor_request_guard_v1' then
   raise exception 'External labor request guard missing';end if;
 end loop;
 if (select count(*) from pg_trigger where tgname='finance_labor_legacy_book_v1'
  and tgrelid in('public.vouchers'::regclass,'public.ledger_entries'::regclass) and tgenabled='O')<>2
  or (select count(*) from pg_trigger where tgname='finance_labor_atomic_post_v1'
   and tgrelid in('public.vouchers'::regclass,'public.ledger_entries'::regclass) and tgenabled='O')<>2 then
  raise exception 'External labor legacy/atomic posting guards missing';end if;
 if not exists(select 1 from storage.buckets where id='finance-external-labor' and public=false)
  or not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects'
   and policyname='finance_external_labor_authenticated_deny_v1' and permissive='RESTRICTIVE')
  or not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects'
   and policyname='finance_external_labor_anon_deny_v1' and permissive='RESTRICTIVE') then
  raise exception 'External labor private Storage boundary missing';end if;
 if not exists(select 1 from pg_index i join pg_class c on c.oid=i.indexrelid
  where c.relname='finance_labor_posting_once_v1' and i.indisvalid and i.indisready)
  or not exists(select 1 from pg_index i join pg_class c on c.oid=i.indexrelid
   where c.relname='finance_labor_one_teacher_month_v1' and i.indisvalid and i.indisready) then
  raise exception 'External labor unique posting/source indexes missing';end if;
 -- The new flow must not go live only to discover that the required payable,
 -- bank, or deduction accounts are missing from an active production tenant.
 for r in select distinct u.tenant_id from public.finance_users u where u.active=true
  and exists(select 1 from public.system_settings s where s.tenant_id=u.tenant_id and s.key='accounts') loop
  foreach required_code in array array['2131','1112','21953','21955'] loop
   if not exists(select 1 from public.system_settings s
    cross join lateral jsonb_array_elements(case when jsonb_typeof(s.value)='array'
     then s.value else '[]'::jsonb end) account
    where s.tenant_id=r.tenant_id and s.key='accounts' and account->>'c'=required_code
     and account->>'on'='true') then
    raise exception 'External labor required account missing: %',required_code;end if;
  end loop;
 end loop;
end $finance_external_labor_postflight$;
