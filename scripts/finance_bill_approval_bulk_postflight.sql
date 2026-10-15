\set ON_ERROR_STOP on
do $bill_approval_guard$
declare p pg_proc%rowtype;
begin
  select * into p from pg_proc where oid=to_regprocedure('public.finance_bill_act_active_step_v2(text[],text,text,text,jsonb,text,jsonb,text)');
  if p.oid is null or md5(p.prosrc) is distinct from '435f663305bce08a8fe7a05fe4747d66'
     or pg_get_userbyid(p.proowner)<>'postgres' or not p.prosecdef
     or p.proconfig is distinct from array['search_path=""','lock_timeout=5s']::text[]
     or has_function_privilege('anon',p.oid,'EXECUTE')
     or not has_function_privilege('authenticated',p.oid,'EXECUTE')
     or not has_function_privilege('service_role',p.oid,'EXECUTE')
     or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE')
     or (select md5(prosrc) from pg_proc where oid=to_regprocedure('private.finance_history_projection_source_trigger_v1()')) is distinct from 'dacedbff7dc0b1a6ea7a1361951cc6bd'
     or not exists(select 1 from pg_trigger where tgrelid='public.bills'::regclass
       and tgname='finance_history_projection_update_v1' and tgenabled='O' and tgtype=16
       and tgnewtable='new_source' and tgoldtable='old_source'
       and tgfoid='private.finance_history_projection_source_trigger_v1()'::regprocedure)
  then raise exception 'Bill approval function/authority/history trigger drifted; review before release' using errcode='55000';end if;
end;
$bill_approval_guard$;

select 'FINANCE_BILL_APPROVAL_BULK_POSTFLIGHT_OK' as marker;
