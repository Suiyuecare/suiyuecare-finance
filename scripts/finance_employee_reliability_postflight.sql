\set ON_ERROR_STOP on
-- Pure read-only catalog, authority and anonymous rejection checks.
do $employee_reliability_postflight$
declare expected record;p record;relation text;denied boolean:=false;
begin
 for expected in select * from (values
('private.finance_payment_concern_handler_v1(public.expense_requests,public.finance_users)', '3c65e1654f62ec3f541e0ac701fa7a96'),
('public.finance_payment_concern_read_v1(text,text)', '5bb0032a9307fc2f0400ad9d020afd14'),
('public.finance_payment_concern_action_v1(text,text,text,integer,uuid,text)', 'a0450b372afc77e68f74417c50311274')
 ) sources(signature,digest) loop
  select * into p from pg_proc where oid=to_regprocedure(expected.signature);
  if p.oid is null or pg_get_userbyid(p.proowner)<>'postgres' or not p.prosecdef or p.proconfig is distinct from array['search_path=""']::text[]
   or md5(p.prosrc)<>expected.digest or has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('service_role',p.oid,'EXECUTE')
   or has_function_privilege('authenticated',p.oid,'EXECUTE') is distinct from (left(expected.signature,7)='public.')
   or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE') then raise exception 'Employee concern function authority/source differs: %',expected.signature;end if;
 end loop;
 foreach relation in array array['private.finance_payment_concerns_v1','private.finance_payment_concern_events_v1'] loop
  if not exists(select 1 from pg_class where oid=to_regclass(relation) and relrowsecurity)
   or has_table_privilege('anon',relation,'SELECT,INSERT,UPDATE,DELETE') or has_table_privilege('authenticated',relation,'SELECT,INSERT,UPDATE,DELETE') or has_table_privilege('service_role',relation,'SELECT,INSERT,UPDATE,DELETE') then raise exception 'Employee concern relation directly exposed';end if;
 end loop;
 if not exists(select 1 from pg_constraint where conrelid=to_regclass('private.finance_payment_concern_events_v1') and contype='u' and pg_get_constraintdef(oid)='UNIQUE (tenant_id, data_environment, request_id, version)') then raise exception 'Employee concern event revision uniqueness missing';end if;
 if auth.uid() is null then
  begin perform public.finance_payment_concern_read_v1(null,'test');exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'Employee concern accepted missing actor';end if;
 end if;
end;
$employee_reliability_postflight$;
