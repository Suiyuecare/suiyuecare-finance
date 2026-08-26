\set ON_ERROR_STOP on
select pg_catalog.set_config('finance.release_migration_versions', :'migration_versions', false);
do $gate$
declare
  v_phase text := pg_catalog.current_setting('finance.release_migration_versions');
  v_versions text[];
  v_relation regclass;
  v_oid oid;
  v_definition text;
begin
  if v_phase = 'none' then v_versions := array[]::text[];
  else v_versions := pg_catalog.string_to_array(v_phase, ',');
  end if;
  if v_versions is distinct from array[]::text[]
     and v_versions is distinct from array['20260826070814']::text[]
     and v_versions is distinct from array['20260826155840']::text[] then raise exception 'unsupported migration phase'; end if;
  if (select count(*) from supabase_migrations.schema_migrations) <> (select count(distinct version) from supabase_migrations.schema_migrations) then raise exception 'Supabase migration ledger contains duplicate versions'; end if;
  if not exists (select 1 from supabase_migrations.schema_migrations where version='20260826070814') then raise exception 'v1 baseline is absent from ledger'; end if;
  if v_phase = '20260826070814' and exists (select 1 from supabase_migrations.schema_migrations where version='20260826155840') then raise exception 'v1 compatibility phase unexpectedly installed v2'; end if;
  if v_phase in ('20260826155840','none') and not exists (select 1 from supabase_migrations.schema_migrations where version='20260826155840') then raise exception 'v2 authority baseline is absent from ledger'; end if;

  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='notifications' and column_name='data_environment' and data_type='text' and is_nullable='NO' and column_default='''production''::text')
     or not exists (select 1 from information_schema.columns where table_schema='public' and table_name='notifications' and column_name='tenant_id' and data_type='uuid' and is_nullable='NO' and column_default like '%default_tenant_id%') then raise exception 'v1 notification columns/defaults are invalid'; end if;
  if (select count(*) from pg_catalog.pg_constraint where conrelid='public.notifications'::regclass and conname in ('notifications_data_environment_check_v1','notifications_tenant_id_fkey_v1') and convalidated) <> 2 then raise exception 'v1 notification constraints are absent or unvalidated'; end if;
  if not exists (select 1 from pg_catalog.pg_indexes where schemaname='public' and tablename='notifications' and indexname='notifications_tenant_environment_created_idx_v1' and indexdef ilike '%(tenant_id, data_environment, created_at desc)%') then raise exception 'v1 notification index is invalid'; end if;
  foreach v_relation in array array['public.notifications'::regclass,'public.finance_portal_roles'::regclass,'public.file_attachments'::regclass] loop
    if not exists (select 1 from pg_catalog.pg_class where oid=v_relation and relrowsecurity and relforcerowsecurity) then raise exception 'RLS is not enabled and forced on %', v_relation; end if;
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
  ) then raise exception 'active Portal Finance entry invariant is invalid'; end if;
  if exists (
    select 1 from public.finance_portal_roles
    where active and (
      nullif(pg_catalog.btrim(finance_role),'') is null
      or coalesce(pg_catalog.cardinality(pg_catalog.array_positions(modules,'會計系統')),0) > 1
      or coalesce(pg_catalog.cardinality(pg_catalog.array_positions(modules,'全部模組')),0) > 1
      or coalesce(pg_catalog.cardinality(pg_catalog.array_positions(modules,'會計系統')),0)
         + coalesce(pg_catalog.cardinality(pg_catalog.array_positions(modules,'全部模組')),0) < 1
    )
  ) then raise exception 'an active Portal role is missing its Finance role or entry'; end if;
  if (
    select count(*)
    from (
      values
        ('business-director'::text,'dept_manager'::text),
        ('ga-chief'::text,'general_affairs'::text),
        ('hr-chief'::text,'hr'::text),
        ('section-chief'::text,'section_chief'::text),
        ('staff'::text,'employee'::text),
        ('team-lead'::text,'section_chief'::text)
    ) expected_role(id,finance_role)
    join public.finance_portal_roles portal_role
      on portal_role.id=expected_role.id
     and portal_role.finance_role=expected_role.finance_role
     and portal_role.active
     and coalesce(pg_catalog.cardinality(pg_catalog.array_positions(portal_role.modules,'會計系統')),0)=1
  ) <> 6 then raise exception 'the six audited Portal roles did not converge to one Finance entry each'; end if;

  if v_phase = '20260826070814' then
    if not exists (
      select 1
      from pg_catalog.pg_attribute attribute_row
      join pg_catalog.pg_attrdef default_row
        on default_row.adrelid=attribute_row.attrelid and default_row.adnum=attribute_row.attnum
      where attribute_row.attrelid='public.file_attachments'::regclass
        and attribute_row.attname='path' and attribute_row.atttypid='text'::regtype
        and attribute_row.attgenerated='s' and not attribute_row.attisdropped
        and pg_catalog.pg_get_expr(default_row.adbin,default_row.adrelid)='storage_path'
    ) then raise exception 'v1 compatibility alias is not an exact generated storage_path alias'; end if;
    if pg_catalog.to_regprocedure('private.finance_expense_assert_authoritative_route_v2(uuid,text,text,text,numeric,jsonb,jsonb,jsonb,boolean)') is not null
       or pg_catalog.to_regprocedure('private.finance_submit_expense_request_v1_unsafe(jsonb,uuid,text,jsonb)') is not null
       or pg_catalog.to_regprocedure('private.finance_resubmit_expense_request_v1_unsafe(text,jsonb,uuid,text,jsonb)') is not null then raise exception 'v1 compatibility phase unexpectedly installed route v2'; end if;
  else
    if not exists (
      select 1
      from pg_catalog.pg_attribute attribute_row
      join pg_catalog.pg_attrdef default_row
        on default_row.adrelid=attribute_row.attrelid and default_row.adnum=attribute_row.attnum
      where attribute_row.attrelid='public.file_attachments'::regclass
        and attribute_row.attname='path' and attribute_row.atttypid='text'::regtype
        and attribute_row.attgenerated='s' and not attribute_row.attisdropped
        and pg_catalog.pg_get_expr(default_row.adbin,default_row.adrelid)='storage_path'
    ) then raise exception 'v2 must retain the exact generated read-only storage_path compatibility alias'; end if;
    foreach v_oid in array array[
      'public.finance_submit_expense_request(jsonb,uuid,text,jsonb)'::regprocedure::oid,
      'public.finance_resubmit_expense_request(text,jsonb,uuid,text,jsonb)'::regprocedure::oid
    ] loop
      if not exists (select 1 from pg_catalog.pg_proc where oid=v_oid and pg_catalog.pg_get_userbyid(proowner)='postgres' and prosecdef and proconfig=array['search_path=""']::text[])
         or pg_catalog.has_function_privilege('public',v_oid,'EXECUTE')
         or pg_catalog.has_function_privilege('anon',v_oid,'EXECUTE')
         or not pg_catalog.has_function_privilege('authenticated',v_oid,'EXECUTE')
         or not pg_catalog.has_function_privilege('service_role',v_oid,'EXECUTE') then raise exception 'public route wrapper owner/ACL/security/search_path is invalid'; end if;
    end loop;
    foreach v_oid in array array[
      'private.finance_expense_assert_authoritative_route_v2(uuid,text,text,text,numeric,jsonb,jsonb,jsonb,boolean)'::regprocedure::oid,
      'private.finance_submit_expense_request_v1_unsafe(jsonb,uuid,text,jsonb)'::regprocedure::oid,
      'private.finance_resubmit_expense_request_v1_unsafe(text,jsonb,uuid,text,jsonb)'::regprocedure::oid
    ] loop
      if not exists (select 1 from pg_catalog.pg_proc where oid=v_oid and pg_catalog.pg_get_userbyid(proowner)='postgres' and prosecdef and proconfig=array['search_path=""']::text[])
         or pg_catalog.has_function_privilege('public',v_oid,'EXECUTE')
         or pg_catalog.has_function_privilege('anon',v_oid,'EXECUTE')
         or pg_catalog.has_function_privilege('authenticated',v_oid,'EXECUTE')
         or pg_catalog.has_function_privilege('service_role',v_oid,'EXECUTE') then raise exception 'private route function owner/ACL/security/search_path is invalid'; end if;
    end loop;
    v_definition := pg_catalog.pg_get_functiondef('private.finance_expense_assert_authoritative_route_v2(uuid,text,text,text,numeric,jsonb,jsonb,jsonb,boolean)'::regprocedure);
    if v_definition not ilike '%private.finance_membership_org_versions_v1%'
       or v_definition not ilike '%workflow_templates%'
       or v_definition not ilike '%approval_routing_policy%'
       or v_definition not ilike '%finance_org_resolve_actor%'
       or v_definition not ilike '%finance_user_is_approval_identity_ready%' then raise exception 'route-authority helper definition is incomplete'; end if;
    v_definition := pg_catalog.pg_get_functiondef('public.finance_submit_expense_request(jsonb,uuid,text,jsonb)'::regprocedure);
    if v_definition not ilike '%private.finance_expense_assert_authoritative_route_v2%'
       or v_definition not ilike '%private.finance_submit_expense_request_v1_unsafe%'
       or v_definition not ilike '%auth.uid()%' then raise exception 'submit wrapper definition is not authoritative'; end if;
    v_definition := pg_catalog.pg_get_functiondef('public.finance_resubmit_expense_request(text,jsonb,uuid,text,jsonb)'::regprocedure);
    if v_definition not ilike '%private.finance_expense_assert_authoritative_route_v2%'
       or v_definition not ilike '%private.finance_resubmit_expense_request_v1_unsafe%'
       or v_definition not ilike '%for update%' then raise exception 'resubmit wrapper definition is not authoritative'; end if;
  end if;
end $gate$;
select 'PASS finance production database postflight' as result;
