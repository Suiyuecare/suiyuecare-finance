\set ON_ERROR_STOP on
select pg_catalog.set_config('finance.release_migration_versions', :'migration_versions', false);
do $gate$
declare
  v_phase text := pg_catalog.current_setting('finance.release_migration_versions');
  v_versions text[];
  v_missing_finance_entry_ids text[];
  v_relation regclass;
  v_oid oid;
  v_definition text;
begin
  if v_phase = 'none' then v_versions := array[]::text[];
  else v_versions := pg_catalog.string_to_array(v_phase, ',');
  end if;
  if v_versions is distinct from array[]::text[]
     and v_versions is distinct from array['20260826070814']::text[]
     and v_versions is distinct from array['20260826155840']::text[] then
    raise exception 'this exact preflight has no contract for the requested migration phase';
  end if;
  if pg_catalog.to_regclass('supabase_migrations.schema_migrations') is null then raise exception 'Supabase migration ledger is missing'; end if;
  if (select count(*) from supabase_migrations.schema_migrations) <> (select count(distinct version) from supabase_migrations.schema_migrations) then raise exception 'Supabase migration ledger contains duplicate versions'; end if;
  if cardinality(v_versions) > 0 and exists (select 1 from supabase_migrations.schema_migrations where version = any(v_versions)) then raise exception 'a requested migration is already recorded'; end if;

  if v_phase = '20260826070814' then
    if exists (select 1 from supabase_migrations.schema_migrations where version in ('20260826070814','20260826155840')) then raise exception 'v1 compatibility phase ledger is not pristine'; end if;
    if pg_catalog.to_regclass('public.notifications') is null
       or pg_catalog.to_regclass('public.file_attachments') is null
       or pg_catalog.to_regclass('public.finance_portal_roles') is null
       or pg_catalog.to_regclass('public.employees') is null
       or pg_catalog.to_regclass('public.tenants') is null
       or pg_catalog.to_regprocedure('public.current_tenant_id()') is null
       or pg_catalog.to_regprocedure('public.default_tenant_id()') is null then raise exception 'notification migration prerequisites are missing'; end if;
    if exists (select 1 from pg_catalog.pg_attribute where attrelid='public.notifications'::regclass and attname in ('data_environment','tenant_id') and attnum>0 and not attisdropped) then raise exception 'target notification columns already exist outside migration ledger'; end if;
    if exists (select 1 from pg_catalog.pg_constraint where conrelid='public.finance_portal_roles'::regclass and conname='finance_portal_roles_active_finance_entry_check_v1') then raise exception 'Portal Finance entry invariant already exists outside migration ledger'; end if;
    if not exists (select 1 from pg_catalog.pg_attribute where attrelid='public.file_attachments'::regclass and attname='storage_path' and attnum>0 and not attisdropped)
       or exists (select 1 from pg_catalog.pg_attribute where attrelid='public.file_attachments'::regclass and attname='path' and attnum>0 and not attisdropped) then raise exception 'attachment schema is not canonical'; end if;
    if exists (
      select 1 from public.finance_portal_roles
      where active and (
        nullif(pg_catalog.btrim(finance_role),'') is null
        or coalesce(pg_catalog.cardinality(pg_catalog.array_positions(modules,'會計系統')),0) > 1
        or coalesce(pg_catalog.cardinality(pg_catalog.array_positions(modules,'全部模組')),0) > 1
      )
    ) then raise exception 'active Portal role mapping or module multiplicity is invalid'; end if;
    select coalesce(pg_catalog.array_agg(id order by id),array[]::text[])
      into v_missing_finance_entry_ids
    from public.finance_portal_roles
    where active
      and coalesce(pg_catalog.cardinality(pg_catalog.array_positions(modules,'會計系統')),0)=0
      and coalesce(pg_catalog.cardinality(pg_catalog.array_positions(modules,'全部模組')),0)=0;
    if v_missing_finance_entry_ids is distinct from array['business-director','ga-chief','hr-chief','section-chief','staff','team-lead']::text[] then raise exception 'Portal Finance entry repair target set drifted: %', v_missing_finance_entry_ids; end if;
    if public.default_tenant_id() is null or not exists (select 1 from public.tenants where id=public.default_tenant_id()) then raise exception 'canonical default tenant is missing'; end if;
  else
    -- v2-only and none both require the complete, already-applied v1 baseline.
    if not exists (select 1 from supabase_migrations.schema_migrations where version='20260826070814') then raise exception 'v1 baseline is not recorded'; end if;
    if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='notifications' and column_name='data_environment' and data_type='text' and is_nullable='NO' and column_default='''production''::text')
       or not exists (select 1 from information_schema.columns where table_schema='public' and table_name='notifications' and column_name='tenant_id' and data_type='uuid' and is_nullable='NO' and column_default like '%default_tenant_id%') then raise exception 'v1 notification columns/defaults are invalid'; end if;
    if v_phase in ('20260826155840', 'none') then
      if not exists (
        select 1
        from pg_catalog.pg_attribute attribute_row
        join pg_catalog.pg_attrdef default_row
          on default_row.adrelid=attribute_row.attrelid and default_row.adnum=attribute_row.attnum
        where attribute_row.attrelid='public.file_attachments'::regclass
          and attribute_row.attname='path' and attribute_row.atttypid='text'::regtype
          and attribute_row.attgenerated='s' and not attribute_row.attisdropped
          and pg_catalog.pg_get_expr(default_row.adbin,default_row.adrelid)='storage_path'
      ) then raise exception 'the exact generated read-only storage_path compatibility alias must remain installed'; end if;
    end if;
    if (select count(*) from pg_catalog.pg_constraint where conrelid='public.notifications'::regclass and conname in ('notifications_data_environment_check_v1','notifications_tenant_id_fkey_v1') and convalidated) <> 2 then raise exception 'v1 notification constraints are absent or unvalidated'; end if;
    if not exists (select 1 from pg_catalog.pg_indexes where schemaname='public' and tablename='notifications' and indexname='notifications_tenant_environment_created_idx_v1' and indexdef ilike '%(tenant_id, data_environment, created_at desc)%') then raise exception 'v1 notification index is invalid'; end if;
    foreach v_relation in array array['public.notifications'::regclass,'public.finance_portal_roles'::regclass,'public.file_attachments'::regclass] loop
      if not exists (select 1 from pg_catalog.pg_class where oid=v_relation and relrowsecurity and relforcerowsecurity) then raise exception 'v1 RLS is not enabled and forced on %', v_relation; end if;
    end loop;
    if not exists (select 1 from pg_catalog.pg_policies where schemaname='public' and tablename='notifications' and policyname='notifications_tenant_production_isolation_v1' and permissive='RESTRICTIVE' and cmd='ALL' and roles=array['authenticated'::name] and qual ilike '%tenant_id%current_tenant_id%data_environment%production%' and with_check ilike '%tenant_id%current_tenant_id%data_environment%production%') then raise exception 'v1 restrictive notification policy is invalid'; end if;
    if exists (select 1 from public.notifications where tenant_id is null or data_environment not in ('production','test')) then raise exception 'v1 notification backfill is incomplete'; end if;
    if not exists (
      select 1 from pg_catalog.pg_constraint
      where conrelid='public.finance_portal_roles'::regclass
        and conname='finance_portal_roles_active_finance_entry_check_v1'
        and contype='c' and convalidated
        and pg_catalog.pg_get_expr(conbin,conrelid) like '%active%'
        and pg_catalog.pg_get_expr(conbin,conrelid) like '%finance_role%'
        and pg_catalog.pg_get_expr(conbin,conrelid) like '%會計系統%'
        and pg_catalog.pg_get_expr(conbin,conrelid) like '%全部模組%'
    ) then raise exception 'v1 active Portal Finance entry invariant is invalid'; end if;
    if exists (
      select 1 from public.finance_portal_roles
      where active and (
        nullif(pg_catalog.btrim(finance_role),'') is null
        or coalesce(pg_catalog.cardinality(pg_catalog.array_positions(modules,'會計系統')),0) > 1
        or coalesce(pg_catalog.cardinality(pg_catalog.array_positions(modules,'全部模組')),0) > 1
        or coalesce(pg_catalog.cardinality(pg_catalog.array_positions(modules,'會計系統')),0)
           + coalesce(pg_catalog.cardinality(pg_catalog.array_positions(modules,'全部模組')),0) < 1
      )
    ) then raise exception 'v1 active Portal role is missing its Finance role or entry'; end if;
  end if;

  if pg_catalog.to_regprocedure('public.finance_submit_expense_request(jsonb,uuid,text,jsonb)') is null
     or pg_catalog.to_regprocedure('public.finance_resubmit_expense_request(text,jsonb,uuid,text,jsonb)') is null
     or pg_catalog.to_regprocedure('public.finance_org_resolve_actor(text,text,text,text,text)') is null
     or pg_catalog.to_regprocedure('private.finance_income_step_role(jsonb)') is null
     or pg_catalog.to_regprocedure('public.finance_user_is_approval_identity_ready(uuid,text)') is null
     or pg_catalog.to_regprocedure('public.current_finance_user()') is null
     or pg_catalog.to_regclass('private.finance_membership_org_versions_v1') is null
     or pg_catalog.to_regclass('public.system_settings') is null
     or pg_catalog.to_regclass('public.finance_users') is null
     or pg_catalog.to_regclass('public.employee_department_roles') is null
     or pg_catalog.to_regclass('public.expense_requests') is null then raise exception 'route-authority prerequisites are missing'; end if;

  if v_phase in ('20260826070814','20260826155840') then
    if pg_catalog.to_regprocedure('private.finance_expense_assert_authoritative_route_v2(uuid,text,text,text,numeric,jsonb,jsonb,jsonb,boolean)') is not null
       or pg_catalog.to_regprocedure('private.finance_submit_expense_request_v1_unsafe(jsonb,uuid,text,jsonb)') is not null
       or pg_catalog.to_regprocedure('private.finance_resubmit_expense_request_v1_unsafe(text,jsonb,uuid,text,jsonb)') is not null then raise exception 'route-authority migration is already partially installed'; end if;
  else
    -- none is a frontend-only release and therefore requires the complete v2 baseline too.
    if not exists (select 1 from supabase_migrations.schema_migrations where version='20260826155840') then raise exception 'none phase requires v2 to be recorded'; end if;
    foreach v_oid in array array[
      'private.finance_expense_assert_authoritative_route_v2(uuid,text,text,text,numeric,jsonb,jsonb,jsonb,boolean)'::regprocedure::oid,
      'private.finance_submit_expense_request_v1_unsafe(jsonb,uuid,text,jsonb)'::regprocedure::oid,
      'private.finance_resubmit_expense_request_v1_unsafe(text,jsonb,uuid,text,jsonb)'::regprocedure::oid
    ] loop
      if not exists (select 1 from pg_catalog.pg_proc where oid=v_oid and pg_catalog.pg_get_userbyid(proowner)='postgres' and prosecdef and proconfig=array['search_path=""']::text[])
         or pg_catalog.has_function_privilege('public',v_oid,'EXECUTE')
         or pg_catalog.has_function_privilege('anon',v_oid,'EXECUTE')
         or pg_catalog.has_function_privilege('authenticated',v_oid,'EXECUTE')
         or pg_catalog.has_function_privilege('service_role',v_oid,'EXECUTE') then raise exception 'none phase private route baseline ACL is invalid'; end if;
    end loop;
    v_definition := pg_catalog.pg_get_functiondef('private.finance_expense_assert_authoritative_route_v2(uuid,text,text,text,numeric,jsonb,jsonb,jsonb,boolean)'::regprocedure);
    if v_definition not ilike '%private.finance_membership_org_versions_v1%'
       or v_definition not ilike '%workflow_templates%'
       or v_definition not ilike '%approval_routing_policy%'
       or v_definition not ilike '%finance_org_resolve_actor%'
       or v_definition not ilike '%finance_user_is_approval_identity_ready%' then raise exception 'none phase route-authority definition is incomplete'; end if;
  end if;
end $gate$;
select 'PASS finance production database preflight' as result;
