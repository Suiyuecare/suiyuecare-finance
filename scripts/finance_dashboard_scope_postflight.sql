\set ON_ERROR_STOP on
-- Repeatable read-only catalog and absent-identity proof.
do $finance_dashboard_scope_postflight$
declare p record;denied boolean:=false;
begin
 select * into p from pg_proc where oid=to_regprocedure('public.finance_executive_dashboard_v2(date,date,date,date,date,text,text)');
 if p.oid is null or md5(p.prosrc)<>'84043dbdd33bd3e4152f61727e25b202' or not p.prosecdef or p.provolatile<>'s' or pg_get_userbyid(p.proowner)<>'postgres'
  or p.proconfig is distinct from array['search_path=""']::text[] or has_function_privilege('anon',p.oid,'EXECUTE')
  or not has_function_privilege('authenticated',p.oid,'EXECUTE') or not has_function_privilege('service_role',p.oid,'EXECUTE')
  or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE') then raise exception 'Dashboard scoped source/authority mismatch';end if;
 if not exists(select 1 from pg_proc where oid=to_regprocedure('public.finance_executive_dashboard_v3(date,date,date,date,date,text,text)') and md5(prosrc)='36e536eb3ccfc071a8541719022597f1') then raise exception 'Canonical dashboard financial calculation changed';end if;
 if auth.uid() is null then
  begin perform public.finance_executive_dashboard_v2(current_date,current_date,current_date,current_date,current_date,null,'test');exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'Dashboard accepted absent identity';end if;
 end if;
end;
$finance_dashboard_scope_postflight$;
