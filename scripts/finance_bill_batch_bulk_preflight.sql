\set ON_ERROR_STOP on

-- Read-only source and privilege gate. The migration repeats the drift checks
-- under the protected transaction before replacing the function.
do $preflight$
declare
  v_rpc oid := pg_catalog.to_regprocedure('public.finance_submit_bill_batch(text,jsonb,text)')::oid;
  v_history oid := pg_catalog.to_regprocedure('private.finance_history_projection_source_trigger_v1()')::oid;
begin
  if not exists (select 1 from supabase_migrations.schema_migrations where version='20261008031845')
    or not exists (
      select 1 from supabase_migrations.schema_migrations
      where version='20261008055528'
        and name='finance_personal_document_history_v1'
    )
    or not exists (
      select 1 from supabase_migrations.schema_migrations
      where version='20261008090000'
        and name='finance_personal_history_permission_guard_v1'
    )
    or exists (select 1 from supabase_migrations.schema_migrations where version='20261008100000')
    or v_rpc is null or v_history is null
    or pg_catalog.to_regclass('public.bills') is null
    or pg_catalog.to_regprocedure('private.finance_income_begin_operation(uuid,text,text,text,text,text)') is null
    or pg_catalog.to_regprocedure('private.finance_income_next_number(uuid,text,text,text)') is null
    or pg_catalog.to_regprocedure('private.finance_income_finish_operation(uuid,text,text,text,jsonb)') is null
    or not exists (
      select 1 from pg_catalog.pg_proc p where p.oid=v_rpc
        and pg_catalog.pg_get_userbyid(p.proowner)='postgres'
        and p.prosecdef and p.proconfig=array['search_path=""']::text[]
        and pg_catalog.md5(p.prosrc)='5ecf99368dc04b576651475c42199c8e'
    )
    or not exists (
      select 1 from pg_catalog.pg_proc p where p.oid=v_history
        and pg_catalog.md5(p.prosrc)='dacedbff7dc0b1a6ea7a1361951cc6bd'
    )
    or not exists (
      select 1 from pg_catalog.pg_trigger t
      where t.tgrelid='public.bills'::pg_catalog.regclass
        and t.tgname='finance_history_projection_insert_v1'
        and t.tgenabled='O' and t.tgnewtable='new_source' and t.tgtype=4
        and t.tgfoid=v_history
    )
    or pg_catalog.has_function_privilege('anon',v_rpc,'EXECUTE')
    or not pg_catalog.has_function_privilege('authenticated',v_rpc,'EXECUTE')
    or not pg_catalog.has_function_privilege('service_role',v_rpc,'EXECUTE')
    or exists (select 1 from pg_catalog.pg_proc p,
      pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) acl
      where p.oid=v_rpc and acl.grantee=0 and acl.privilege_type='EXECUTE')
  then
    raise exception 'bill batch bulk preflight found unreviewed source, grants, trigger, or ledger';
  end if;
end;
$preflight$;

select 'FINANCE_BILL_BATCH_BULK_PREFLIGHT_OK' as marker;
