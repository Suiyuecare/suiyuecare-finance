\set ON_ERROR_STOP on
do $bill_batch_history_postflight$
declare v_expected record; v_proc pg_catalog.pg_proc%rowtype;
begin
  if not exists(select 1 from supabase_migrations.schema_migrations
    where version='20261013091000' and name='finance_personal_bill_batch_history_v1') then
    raise exception 'Personal bill batch history ledger is absent' using errcode='55000';
  end if;
  for v_expected in select * from (values
    ('private.finance_personal_bill_group_key_v1(public.bills)',false,'i','6525019afa69b00119e69216e9084a6f'),
    ('private.finance_personal_document_authorized_v1(public.finance_users,text,text,text)',false,'s','1db71550a2ec13ece520e25abb211e09'),
    ('public.finance_personal_document_summary_v1(text,integer,integer,text,text)',true,'s','d623593ac629ceb854dfa7e837e5b249'),
    ('public.finance_personal_document_detail_v1(text,text)',true,'s','cdc8db2ccb2db89e5f8a932b6213d331'),
    ('private.finance_history_actor_v1()',false,'s','4fa4b048271075bade4b7ddd3f424fc4'),
    ('private.finance_personal_history_page_allows_v1(public.finance_users)',true,'s','b2fed44ca1b66208649d50c7bfae921d')
  ) x(signature,security_definer,volatility,source_md5) loop
    select * into v_proc from pg_catalog.pg_proc where oid=pg_catalog.to_regprocedure(v_expected.signature);
    if v_proc.oid is null or pg_catalog.pg_get_userbyid(v_proc.proowner)<>'postgres'
       or v_proc.prosecdef is distinct from v_expected.security_definer
       or v_proc.provolatile::text<>v_expected.volatility
       or v_proc.proconfig is distinct from array['search_path=""']::text[]
       or pg_catalog.md5(v_proc.prosrc) is distinct from v_expected.source_md5
       or pg_catalog.has_function_privilege('anon',v_proc.oid,'EXECUTE')
       or pg_catalog.has_function_privilege('service_role',v_proc.oid,'EXECUTE')
       or pg_catalog.has_function_privilege('authenticated',v_proc.oid,'EXECUTE') is distinct from (v_expected.signature like 'public.%')
       or exists(select 1 from pg_catalog.aclexplode(coalesce(v_proc.proacl,pg_catalog.acldefault('f',v_proc.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE') then
      raise exception 'Personal bill batch history source or authority drift: %',v_expected.signature using errcode='23514';
    end if;
  end loop;
  if pg_catalog.has_table_privilege('anon','private.finance_history_source_projection_v1','SELECT')
     or pg_catalog.has_table_privilege('authenticated','private.finance_history_source_projection_v1','SELECT')
     or pg_catalog.has_table_privilege('service_role','private.finance_history_source_projection_v1','SELECT') then
    raise exception 'Private source projection exposure' using errcode='23514';
  end if;
end;
$bill_batch_history_postflight$;
select 'FINANCE_PERSONAL_BILL_BATCH_HISTORY_POSTFLIGHT_OK' as marker;
