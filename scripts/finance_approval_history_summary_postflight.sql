\set ON_ERROR_STOP on
-- Read-only catalog and backfill reconciliation. No claims, DDL, or business writes.
do $history_summary_postflight$
declare x record;proc record;rel regclass;n integer;
begin
 for x in select * from(values
  ('private.finance_history_index_grams_v1(text)','f4ddedc9860d42e3e491bb62994472ed',false,false),
  ('private.finance_history_compile_query_v1(text)','03169c24adb1d8ae210a943a48612108',false,false),
  ('private.finance_history_index_matches_v1(jsonb,text,text,text[])','8a3310ad9dd3db6e75a1da0d4272a42d',false,false),
  ('private.finance_history_source_business_v1(text,jsonb,text)','1eb4756117802d82ef66ebb0229c77b8',false,false),
  ('private.finance_history_summary_number_v1(jsonb)','84bbf0ed508520242ad0b0161dec5c5e',false,false),
  ('private.finance_history_summary_amount_v1(text,jsonb)','d436b83b37aa9bf210833b3fd726b522',false,false),
  ('private.finance_history_project_source_v1(text,jsonb)','f3be6d3a40390852a29cf95ae6a3ff2e',false,false),
  ('private.finance_history_refresh_group_v1(uuid,text,text,text)','02195407467826edf87e331b7fa995ce',false,false),
  ('private.finance_history_actor_v1()','8d218d188d9bc054554c83007e838990',false,false),
  ('private.finance_history_groups_v1(public.finance_users,text)','c133bcd10e4fbbfb6aa8cbc92daed290',false,false),
  ('public.finance_approval_history_summary_v1(integer,integer,text,text)','30eca33cceb1d47970546741b066a326',true,false),
  ('public.finance_approval_history_detail_v1(text,text)','9dc8508ca37333396009d6a5b79539c4',true,false),
  ('private.finance_history_projection_source_trigger_v1()','dacedbff7dc0b1a6ea7a1361951cc6bd',false,true),
  ('private.finance_history_projection_department_trigger_v1()','670b14a057ac5ce0573044d1afe456b6',false,true),
  ('private.finance_history_projection_truncate_trigger_v1()','a1b0a994a0b47888bb1c4aabc04439e1',false,true)
 ) expected(signature,body_hash,public_rpc,is_trigger) loop
  select * into proc from pg_proc where oid=to_regprocedure(x.signature);
  if proc.oid is null or md5(proc.prosrc)<>x.body_hash or pg_get_userbyid(proc.proowner)<>'postgres'
   or proc.proconfig is distinct from array['search_path=""']::text[]
   or proc.prosecdef is distinct from (x.public_rpc or x.is_trigger)
   or has_function_privilege('anon',proc.oid,'execute')
   or has_function_privilege('authenticated',proc.oid,'execute') is distinct from x.public_rpc
   or has_function_privilege('service_role',proc.oid,'execute') is distinct from x.public_rpc
   or exists(select 1 from aclexplode(coalesce(proc.proacl,acldefault('f',proc.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE') then
   raise exception 'History summary function/authority contract failed: %',x.signature;
  end if;
 end loop;
 foreach rel in array array['private.finance_history_source_projection_v1'::regclass,'private.finance_history_group_projection_v1'::regclass] loop
  if not exists(select 1 from pg_class where oid=rel and relrowsecurity and pg_get_userbyid(relowner)='postgres')
   or has_table_privilege('anon',rel,'select') or has_table_privilege('authenticated',rel,'select') or has_table_privilege('service_role',rel,'select')
   or has_table_privilege('authenticated',rel,'insert,update,delete') then raise exception 'History projection table must remain private';end if;
 end loop;
 if not exists(select 1 from pg_index i join pg_class c on c.oid=i.indexrelid join pg_am a on a.oid=c.relam
   where c.oid=to_regclass('private.finance_history_group_search_v1') and i.indisvalid and i.indisready and a.amname='gin') then raise exception 'History GIN index not ready';end if;
 foreach rel in array array['public.expense_requests'::regclass,'public.bills'::regclass,'public.invoices'::regclass] loop
  for x in select * from(values
   ('finance_history_projection_insert_v1',4,null::text,'new_source'::text,'private.finance_history_projection_source_trigger_v1()'),
   ('finance_history_projection_update_v1',16,'old_source','new_source','private.finance_history_projection_source_trigger_v1()'),
   ('finance_history_projection_delete_v1',8,'old_source',null,'private.finance_history_projection_source_trigger_v1()'),
   ('finance_history_projection_truncate_v1',32,null,null,'private.finance_history_projection_truncate_trigger_v1()')
  ) expected(name,event_type,old_name,new_name,signature) loop
   if not exists(select 1 from pg_trigger where tgrelid=rel and tgname=x.name and not tgisinternal and tgenabled='O'
    and tgfoid=x.signature::regprocedure and tgtype=x.event_type and tgoldtable is not distinct from x.old_name
    and tgnewtable is not distinct from x.new_name and tgnargs=0 and tgattr::text='') then
    raise exception 'History source statement/transition contract failed: %.%',rel,x.name;
   end if;
  end loop;
 end loop;
 if not exists(select 1 from pg_trigger t where tgrelid='public.finance_department_units'::regclass and tgname='finance_history_projection_department_v1'
  and tgfoid='private.finance_history_projection_department_trigger_v1()'::regprocedure and tgenabled='O' and tgtype=29 and tgnargs=0
  and tgoldtable is null and tgnewtable is null
  and (select array_agg(a.attname::text order by a.attname) from pg_attribute a where a.attrelid=t.tgrelid and a.attnum=any(t.tgattr::smallint[]))=array['code','name','tenant_id']::text[]) then
  raise exception 'History department rename maintenance absent or changed';end if;
 if not exists(select 1 from pg_trigger where tgrelid='public.finance_department_units'::regclass and tgname='finance_history_projection_truncate_v1'
  and tgfoid='private.finance_history_projection_truncate_trigger_v1()'::regprocedure and tgenabled='O' and tgtype=32 and tgnargs=0) then
  raise exception 'History department truncate maintenance absent';end if;
 if exists(
  with sources as (
   select tenant_id,data_environment,'expense_requests'::text record_type,id source_id,id group_key from public.expense_requests where tenant_id is not null and data_environment in('production','test')
   union all select tenant_id,data_environment,'bills',id,coalesce(nullif(btrim(batch_id),''),id) from public.bills where tenant_id is not null and data_environment in('production','test')
   union all select tenant_id,data_environment,'invoices',id,coalesce(nullif(btrim(batch_id),''),id) from public.invoices where tenant_id is not null and data_environment in('production','test')
  ) select 1 from sources s full join private.finance_history_source_projection_v1 p using(tenant_id,data_environment,record_type,source_id)
   where s.source_id is null or p.source_id is null or s.group_key is distinct from p.group_key
 ) then raise exception 'History source projection coverage/orphan mismatch';end if;
 if exists(
  with groups as(select tenant_id,data_environment,record_type,group_key,count(*)::integer n,string_agg(search_text,' ' order by source_no,source_id) raw,
    case when count(summary_amount)=count(*) then sum(summary_amount) end amount
    from private.finance_history_source_projection_v1 group by tenant_id,data_environment,record_type,group_key)
  select 1 from groups s full join private.finance_history_group_projection_v1 p using(tenant_id,data_environment,record_type,group_key)
   where s.group_key is null or p.group_key is null or s.n is distinct from p.source_count or s.n is distinct from (p.summary->>'source_count')::integer
    or s.raw is distinct from p.search_text or s.amount is distinct from (p.summary->>'amount')::numeric
 ) then raise exception 'History group projection count/text/amount mismatch';end if;
end;
$history_summary_postflight$;
