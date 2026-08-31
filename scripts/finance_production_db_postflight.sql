\set ON_ERROR_STOP on
select pg_catalog.set_config('finance.release_migration_versions', :'migration_versions', false);
do $gate$
declare
  v_phase text := pg_catalog.current_setting('finance.release_migration_versions');
  v_versions text[];
  v_relation regclass;
  v_oid oid;
  v_definition text;
  v_source_sha256 text;
begin
  if v_phase = 'none' then v_versions := array[]::text[];
  else v_versions := pg_catalog.string_to_array(v_phase, ',');
  end if;
  if v_versions is distinct from array[]::text[]
     and v_versions is distinct from array['20260826070814']::text[]
     and v_versions is distinct from array['20260826155840']::text[]
     and v_versions is distinct from array['20260827052447']::text[] then raise exception 'unsupported migration phase'; end if;
  if (select count(*) from supabase_migrations.schema_migrations) <> (select count(distinct version) from supabase_migrations.schema_migrations) then raise exception 'Supabase migration ledger contains duplicate versions'; end if;
  if not exists (select 1 from supabase_migrations.schema_migrations where version='20260826070814') then raise exception 'v1 baseline is absent from ledger'; end if;
  if v_phase = '20260826070814' and exists (select 1 from supabase_migrations.schema_migrations where version='20260826155840') then raise exception 'v1 compatibility phase unexpectedly installed v2'; end if;
  if v_phase in ('20260826155840','20260827052447','none') and not exists (select 1 from supabase_migrations.schema_migrations where version='20260826155840') then raise exception 'v2 authority baseline is absent from ledger'; end if;
  if v_phase = '20260826155840' and exists (select 1 from supabase_migrations.schema_migrations where version='20260827052447') then raise exception 'v2 authority phase unexpectedly installed v3'; end if;
  if v_phase in ('20260827052447','none') and not exists (select 1 from supabase_migrations.schema_migrations where version='20260827052447') then raise exception 'v3 authority baseline is absent from ledger'; end if;
  if v_phase in ('20260827052447','none') then
    if not exists (
      select 1
      from supabase_migrations.schema_migrations
      where version='20260828015718'
        and name='repair_admin_ntpc_portal_employee_link_20260828'
    ) then raise exception 'reviewed admin.ntpc Portal employee-link repair is absent from ledger'; end if;
    if not exists (
      select 1
      from auth.users auth_user
      join public.users portal_user
        on portal_user.auth_user_id=auth_user.id
      join public.employees employee_row
        on employee_row.id=portal_user.employee_id
      where auth_user.id='c50e9e4f-0b63-44e9-b445-9dd5fe7d9f2e'::uuid
        and pg_catalog.lower(auth_user.email)='admin.ntpc@suiyuecare.com'
        and portal_user.id='b1f0c6bd-3e22-45c0-b6f4-81d7ebd3d369'::uuid
        and portal_user.company_id='d114b583-824e-42c9-9d4e-5ab3cf17ac65'::uuid
        and portal_user.status='active'
        and portal_user.deleted_at is null
        and employee_row.id='73c0ce88-c0f7-4276-ba0e-938cea9d53ce'::uuid
        and employee_row.employee_no='u_1785138353548'
        and employee_row.company_id=portal_user.company_id
        and employee_row.employment_status='active'
        and employee_row.deleted_at is null
    ) then raise exception 'admin.ntpc Portal identity did not retain the reviewed active employee projection'; end if;
    if not exists (
      select 1
      from public.employees
      where id='6c101aa3-b91d-4590-ae7a-5df070af2793'::uuid
        and pg_catalog.lower(email)='admin.ntpc@suiyuecare.com'
        and employment_status='terminated'
        and deleted_at is not null
    ) then raise exception 'admin.ntpc retired duplicate employee fingerprint drifted'; end if;
  end if;

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

  if v_phase in ('20260827052447','none') then
    if pg_catalog.to_regprocedure(
         'public.claim_approval_notification_delivery_events(integer,text,integer)'
       ) is null
       or pg_catalog.to_regclass(
         'private.approval_notification_assignment_state'
       ) is null
       or pg_catalog.to_regprocedure('extensions.digest(bytea,text)') is null then
      raise exception 'approval notification claim worker postflight prerequisites are missing';
    end if;
    select pg_catalog.encode(
             extensions.digest(proc_row.prosrc::bytea, 'sha256'),
             'hex'
           )
      into v_source_sha256
    from pg_catalog.pg_proc proc_row
    where proc_row.oid =
      'public.claim_approval_notification_delivery_events(integer,text,integer)'::regprocedure::oid;
    if v_source_sha256 is distinct from
         '5f70ec460e9dcc611419097e28084d1916b0ca2bf908e25d35a4aa55d8f437a0'
       or not exists (
         select 1
         from pg_catalog.pg_proc proc_row
         where proc_row.oid =
           'public.claim_approval_notification_delivery_events(integer,text,integer)'::regprocedure::oid
           and pg_catalog.pg_get_userbyid(proc_row.proowner) = 'postgres'
           and proc_row.prosecdef
           and proc_row.proconfig = array['search_path=""']::text[]
           and proc_row.proacl::text =
             '{postgres=X/postgres,service_role=X/postgres}'
       )
       or pg_catalog.has_function_privilege(
         'public',
         'public.claim_approval_notification_delivery_events(integer,text,integer)'::regprocedure,
         'EXECUTE'
       )
       or pg_catalog.has_function_privilege(
         'anon',
         'public.claim_approval_notification_delivery_events(integer,text,integer)'::regprocedure,
         'EXECUTE'
       )
       or pg_catalog.has_function_privilege(
         'authenticated',
         'public.claim_approval_notification_delivery_events(integer,text,integer)'::regprocedure,
         'EXECUTE'
       )
       or not pg_catalog.has_function_privilege(
         'service_role',
         'public.claim_approval_notification_delivery_events(integer,text,integer)'::regprocedure,
         'EXECUTE'
       ) then
      raise exception 'approval notification claim worker postflight is invalid';
    end if;
    if not exists (
         select 1
         from pg_catalog.pg_class relation_row
         where relation_row.oid =
           'private.approval_notification_assignment_state'::regclass
           and relation_row.relkind = 'r'
           and pg_catalog.pg_get_userbyid(relation_row.relowner) = 'postgres'
           and relation_row.relacl::text =
             '{postgres=arwdDxtm/postgres}'
           and not relation_row.relrowsecurity
           and not relation_row.relforcerowsecurity
       )
       or pg_catalog.has_table_privilege(
         'service_role',
         'private.approval_notification_assignment_state',
         'SELECT'
       )
       or pg_catalog.has_table_privilege(
         'authenticated',
         'private.approval_notification_assignment_state',
         'SELECT'
       )
       or pg_catalog.has_table_privilege(
         'anon',
         'private.approval_notification_assignment_state',
         'SELECT'
       ) then
      raise exception 'private approval notification assignment-state table was exposed';
    end if;
  end if;

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
       or pg_catalog.to_regprocedure('private.finance_resubmit_expense_request_v1_unsafe(text,jsonb,uuid,text,jsonb)') is not null
       or pg_catalog.to_regprocedure('private.finance_expense_assert_dept_manager_autoskip_v3(uuid,text,text,jsonb,boolean)') is not null
       or pg_catalog.to_regprocedure('private.finance_expense_assert_authoritative_route_v3(uuid,text,text,text,numeric,jsonb,jsonb,jsonb,boolean)') is not null
       or pg_catalog.to_regprocedure('private.finance_expense_assert_applicant_revision_future_route_v3(uuid,text,text,text,numeric,jsonb,jsonb,integer)') is not null
       or pg_catalog.to_regprocedure('private.finance_expense_resubmit_applicant_revision_v1_unsafe(text,text,text,integer,timestamptz,integer,text,jsonb,jsonb,text)') is not null then raise exception 'v1 compatibility phase unexpectedly installed route authority'; end if;
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
      'public.finance_resubmit_expense_request(text,jsonb,uuid,text,jsonb)'::regprocedure::oid,
      'public.finance_expense_resubmit_applicant_revision(text,text,text,integer,timestamptz,integer,text,jsonb,jsonb,text)'::regprocedure::oid
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
    if v_phase = '20260826155840' then
      if pg_catalog.to_regprocedure('private.finance_expense_assert_authoritative_route_v3(uuid,text,text,text,numeric,jsonb,jsonb,jsonb,boolean)') is not null
         or pg_catalog.to_regprocedure('private.finance_expense_assert_dept_manager_autoskip_v3(uuid,text,text,jsonb,boolean)') is not null
         or pg_catalog.to_regprocedure('private.finance_expense_assert_applicant_revision_future_route_v3(uuid,text,text,text,numeric,jsonb,jsonb,integer)') is not null
         or pg_catalog.to_regprocedure('private.finance_expense_submission_payload_sha256_v3(jsonb,uuid,text)') is not null
         or pg_catalog.to_regprocedure('private.finance_expense_idempotent_replay_result_v3(public.expense_requests)') is not null
         or pg_catalog.to_regprocedure('private.finance_expense_resubmit_applicant_revision_v1_unsafe(text,text,text,integer,timestamptz,integer,text,jsonb,jsonb,text)') is not null then raise exception 'v2 postflight unexpectedly installed v3'; end if;
      v_definition := pg_catalog.pg_get_functiondef('public.finance_submit_expense_request(jsonb,uuid,text,jsonb)'::regprocedure);
      if v_definition not ilike '%private.finance_expense_assert_authoritative_route_v2%'
         or v_definition not ilike '%private.finance_submit_expense_request_v1_unsafe%'
         or v_definition not ilike '%auth.uid()%' then raise exception 'v2 submit wrapper definition is not authoritative'; end if;
    else
      foreach v_oid in array array[
        'private.finance_expense_assert_authoritative_route_v3(uuid,text,text,text,numeric,jsonb,jsonb,jsonb,boolean)'::regprocedure::oid,
        'private.finance_expense_assert_dept_manager_autoskip_v3(uuid,text,text,jsonb,boolean)'::regprocedure::oid,
        'private.finance_expense_assert_applicant_revision_future_route_v3(uuid,text,text,text,numeric,jsonb,jsonb,integer)'::regprocedure::oid,
        'private.finance_expense_submission_payload_sha256_v3(jsonb,uuid,text)'::regprocedure::oid,
        'private.finance_expense_idempotent_replay_result_v3(public.expense_requests)'::regprocedure::oid,
        'private.finance_expense_resubmit_applicant_revision_v1_unsafe(text,text,text,integer,timestamptz,integer,text,jsonb,jsonb,text)'::regprocedure::oid
      ] loop
        if not exists (select 1 from pg_catalog.pg_proc where oid=v_oid and pg_catalog.pg_get_userbyid(proowner)='postgres' and proconfig=array['search_path=""']::text[])
           or pg_catalog.has_function_privilege('public',v_oid,'EXECUTE')
           or pg_catalog.has_function_privilege('anon',v_oid,'EXECUTE')
           or pg_catalog.has_function_privilege('authenticated',v_oid,'EXECUTE')
           or pg_catalog.has_function_privilege('service_role',v_oid,'EXECUTE') then raise exception 'v3 private route function owner/ACL/search_path is invalid'; end if;
      end loop;
      foreach v_oid in array array[
        'private.finance_expense_assert_authoritative_route_v3(uuid,text,text,text,numeric,jsonb,jsonb,jsonb,boolean)'::regprocedure::oid,
        'private.finance_expense_assert_dept_manager_autoskip_v3(uuid,text,text,jsonb,boolean)'::regprocedure::oid,
        'private.finance_expense_assert_applicant_revision_future_route_v3(uuid,text,text,text,numeric,jsonb,jsonb,integer)'::regprocedure::oid,
        'private.finance_expense_resubmit_applicant_revision_v1_unsafe(text,text,text,integer,timestamptz,integer,text,jsonb,jsonb,text)'::regprocedure::oid
      ] loop
        if not exists (select 1 from pg_catalog.pg_proc where oid=v_oid and prosecdef) then raise exception 'v3 route guards must remain SECURITY DEFINER'; end if;
      end loop;
      v_definition := pg_catalog.pg_get_functiondef('private.finance_expense_assert_dept_manager_autoskip_v3(uuid,text,text,jsonb,boolean)'::regprocedure);
      if v_definition !~* $resolver$finance_org_resolve_actor\(\s*'direct_supervisor'$resolver$
         or v_definition !~* $resolver$finance_org_resolve_actor\(\s*'dept_manager'$resolver$
         or v_definition not ilike '%v_manager_resolution -> ''candidates''% = 1%'
         or v_definition not ilike '%v_submitted_direct_uid is distinct from v_direct_uid%'
         or v_definition not ilike '%v_submitted_manager_uid is distinct from v_manager_uid%'
         or v_definition not ilike '%same_direct_supervisor_and_dept_manager_runtime%'
         or v_definition not ilike '%申請人上一層級主管與部門主管為同一位%'
         or v_definition not ilike '%autoSkipAudit%'
         or v_definition not ilike '%auto_skip_audit%'
         or v_definition not ilike '%errcode = ''42501''%' then raise exception 'v3 manager guard semantic definition is incomplete'; end if;
      v_definition := pg_catalog.pg_get_functiondef('public.finance_submit_expense_request(jsonb,uuid,text,jsonb)'::regprocedure);
      if v_definition not ilike '%private.finance_expense_assert_authoritative_route_v3%'
         or v_definition not ilike '%submissionAttemptId%'
         or v_definition not ilike '%idempotent_replay%'
         or v_definition not ilike '%if v_attempt_id is null then%'
         or v_definition not ilike '%頁面版本已過期，請重新整理後再送出%' then raise exception 'v3 submit wrapper definition is not authoritative'; end if;
      v_definition := pg_catalog.pg_get_functiondef('public.finance_resubmit_expense_request(text,jsonb,uuid,text,jsonb)'::regprocedure);
      if v_definition not ilike '%private.finance_expense_assert_authoritative_route_v3%'
         or v_definition not ilike '%_submissionPayloadSha256V3%'
         or v_definition not ilike '%for update%' then raise exception 'v3 resubmit wrapper definition is not authoritative'; end if;
      v_definition := pg_catalog.pg_get_functiondef('private.finance_expense_assert_applicant_revision_future_route_v3(uuid,text,text,text,numeric,jsonb,jsonb,integer)'::regprocedure);
      if v_definition not ilike '%workflow_templates%'
         or v_definition not ilike '%historical_prefix_preserved%'
         or v_definition not ilike '%into v_historical_key_count, v_historical_anchor_index%'
         or v_definition not ilike '%if v_historical_key_count > 1 then%'
         or v_definition not ilike '%v_expected_index := greatest(%'
         or v_definition not ilike '%v_historical_anchor_index + 1%'
         or v_definition not ilike '%fixed_user%'
         or v_definition not ilike '%future_steps_validated%'
         or v_definition not ilike '%auto_skip_audit%'
         or v_definition not ilike '%自動跳關不得保持待簽狀態%'
         or v_definition not ilike '%作業關卡 % 必須由指定人實際處理%' then raise exception 'v3 applicant-revision future-route guard semantics are incomplete'; end if;
      v_definition := pg_catalog.pg_get_functiondef('public.finance_expense_resubmit_applicant_revision(text,text,text,integer,timestamptz,integer,text,jsonb,jsonb,text)'::regprocedure);
      if v_definition not ilike '%pending_applicant_confirm%'
         or v_definition not ilike '%private.finance_expense_assert_applicant_revision_future_route_v3%'
         or v_definition not ilike '%private.finance_expense_resubmit_applicant_revision_v1_unsafe%'
         or v_definition not ilike '%for update%' then raise exception 'v3 actual applicant-revision wrapper definition is not authoritative'; end if;
      if not exists (
        select 1
        from pg_catalog.pg_proc proc_row
        join pg_catalog.pg_language language_row on language_row.oid=proc_row.prolang
        where proc_row.oid='public.finance_expense_resubmit_applicant_revision(text,text,text,integer,timestamptz,integer,text,jsonb,jsonb,text)'::regprocedure::oid
          and proc_row.proargnames=array['p_request_id','p_action','p_idempotency_key','p_expected_ver','p_expected_updated_at','p_expected_active_step_index','p_comment','p_form_patch','p_step_files','p_data_environment']::text[]
          and proc_row.pronargdefaults=4
          and proc_row.prorettype='jsonb'::regtype
          and language_row.lanname='plpgsql'
      ) then raise exception 'v3 actual applicant-revision wrapper PostgREST contract drifted'; end if;
      select pg_catalog.encode(extensions.digest(proc_row.prosrc::bytea,'sha256'),'hex')
        into v_source_sha256
      from pg_catalog.pg_proc proc_row
      where proc_row.oid='private.finance_expense_resubmit_applicant_revision_v1_unsafe(text,text,text,integer,timestamptz,integer,text,jsonb,jsonb,text)'::regprocedure::oid;
      if v_source_sha256 is distinct from '012297096ad81638aae4fc26e9fe23a2009e576a5bff5a67ae3166eff9cac17e' then raise exception 'v3 applicant-revision delegate source drifted'; end if;
    end if;
  end if;
end $gate$;
select 'PASS finance production database postflight' as result;
