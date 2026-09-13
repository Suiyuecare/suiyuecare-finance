\set ON_ERROR_STOP on

do $postflight$
declare
  v_proc record;
begin
  select p.*, r.rolname as owner_name into v_proc
  from pg_proc p join pg_roles r on r.oid = p.proowner
  where p.oid = 'public.finance_statement_source_page_v1(text,text,integer,integer)'::regprocedure;
  if md5(v_proc.prosrc) <> 'fe39d7ec0b151e30cc36e9e2cb7538dc' or v_proc.prosecdef or v_proc.provolatile <> 's' or v_proc.owner_name <> 'postgres'
     or not (coalesce(v_proc.proconfig, array[]::text[]) @> array['search_path=""'])
     or not has_function_privilege('authenticated',v_proc.oid,'EXECUTE')
     or has_function_privilege('anon',v_proc.oid,'EXECUTE')
     or has_function_privilege('service_role',v_proc.oid,'EXECUTE')
     or exists (
       select 1 from aclexplode(coalesce(v_proc.proacl,acldefault('f',v_proc.proowner)))
       where grantee=0 and privilege_type='EXECUTE'
     ) then
    raise exception 'Statement source paging authority contract failed';
  end if;
  if exists (
    select 1 from pg_class c
    where c.oid in ('public.expense_requests'::regclass,'public.bills'::regclass,'public.invoices'::regclass)
      and not c.relrowsecurity
  ) then
    raise exception 'Statement source tables must retain row-level security';
  end if;
end;
$postflight$;
