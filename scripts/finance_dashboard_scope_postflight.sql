\set ON_ERROR_STOP on
-- Repeatable read-only catalog and absent-identity proof.
do $finance_dashboard_scope_postflight$
declare hr_bridge_installed boolean:=false;ar_scope_installed boolean:=false;p record;denied boolean:=false;
begin
 if to_regclass('supabase_migrations.schema_migrations') is not null then
  execute $hr_ledger$select count(*)=3 from supabase_migrations.schema_migrations where version in ('20260922072109','20260922072737','20260922075604')$hr_ledger$ into hr_bridge_installed;
  execute $ar_ledger$select exists(select 1 from supabase_migrations.schema_migrations where version='20260922072737')$ar_ledger$ into ar_scope_installed;
 end if;
 select * into p from pg_proc where oid=to_regprocedure('public.finance_executive_dashboard_v2(date,date,date,date,date,text,text)');
 if p.oid is null or md5(p.prosrc)<>(case when hr_bridge_installed then '7734154b2b22e212c5dc0774cd4f7a06' else '84043dbdd33bd3e4152f61727e25b202' end) or not p.prosecdef or p.provolatile<>'s' or pg_get_userbyid(p.proowner)<>'postgres'
  or p.proconfig is distinct from array['search_path=""']::text[] or has_function_privilege('anon',p.oid,'EXECUTE')
  or not has_function_privilege('authenticated',p.oid,'EXECUTE') or not has_function_privilege('service_role',p.oid,'EXECUTE')
  or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE') then raise exception 'Dashboard scoped source/authority mismatch';end if;
 if not exists(select 1 from pg_proc where oid=to_regprocedure('public.finance_executive_dashboard_v3(date,date,date,date,date,text,text)') and md5(prosrc)=(case when hr_bridge_installed then '3d370f03d925cb8318a65e382b83cae1' else '36e536eb3ccfc071a8541719022597f1' end)) then raise exception 'Canonical dashboard financial calculation changed';end if;
 if auth.uid() is null then
  begin perform public.finance_executive_dashboard_v2(current_date,current_date,current_date,current_date,current_date,null,'test');exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'Dashboard accepted absent identity';end if;
 end if;
end;
$finance_dashboard_scope_postflight$;
