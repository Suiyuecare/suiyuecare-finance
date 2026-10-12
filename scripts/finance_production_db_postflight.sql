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
    -- FINANCE_PORTAL_IDENTITY_CURRENT_V1_BEGIN
    declare
      identity_tenant constant uuid := '00000000-0000-0000-0000-000000000001'::uuid;
      identity_finance_id constant text := 'u_1785138353548';
      identity_date constant date := (current_timestamp at time zone 'Asia/Taipei')::date;
      identity_finance public.finance_users%rowtype;
      identity_company public.companies%rowtype;
      identity_portal public.users%rowtype;
      identity_employee public.employees%rowtype;
      identity_department uuid;
      identity_count integer;
    begin
      -- Keep evidence of the reviewed historical repair, without freezing a
      -- person's former name, company, employee UUID or retired projection.
      if not exists (
        select 1 from supabase_migrations.schema_migrations
        where version='20260828015718'
          and name='repair_admin_ntpc_portal_employee_link_20260828'
      ) then raise exception 'reviewed admin.ntpc Portal employee-link repair is absent from ledger';end if;

      select f.* into identity_finance from public.finance_users f
      where f.tenant_id=identity_tenant and f.id=identity_finance_id;
      if not found or identity_finance.active is null
        or identity_finance.member_revision is null
        or nullif(pg_catalog.btrim(identity_finance.email),'') is null
        or pg_catalog.lower(pg_catalog.btrim(identity_finance.email)) !~ '^[^@[:space:]]+@suiyuecare[.]com$' then
        raise exception 'Portal current Finance identity is unavailable';
      end if;
      -- The private event is emitted by the authorized atomic member
      -- API. Google binding has its own verified identity/revision contract;
      -- later primary-email changes must not rewrite personnel audit history.
      if exists(select 1 from pg_catalog.pg_class c
        cross join lateral pg_catalog.aclexplode(coalesce(c.relacl,pg_catalog.acldefault('r',c.relowner))) a
        where c.oid='private.finance_member_admin_events_v1'::regclass and a.grantee<>c.relowner
          and a.privilege_type in('INSERT','UPDATE','DELETE','TRUNCATE','TRIGGER')) then
        raise exception 'Portal personnel authority audit permits unauthorized mutation';
      end if;
      if not exists (
        select 1 from private.finance_member_admin_events_v1 a
        where a.tenant_id=identity_tenant and a.finance_user_id=identity_finance_id
          and a.action in('create','update','activate')
          and nullif(pg_catalog.btrim(a.actor_finance_user_id),'') is not null
          and a.actor_auth_user_id is not null
          and a.after_state->>'member_revision'=identity_finance.member_revision::text
          and a.after_state->>'name'=identity_finance.name
          and a.after_state->>'role'=identity_finance.role
          and a.after_state->>'entity_id'=identity_finance.entity_id
          and a.after_state->>'department_code'=identity_finance.department_code
          and a.after_state->>'active'=case when identity_finance.active then 'true' else 'false' end
      ) then raise exception 'Portal current personnel revision lacks matching authorized source';end if;
      if (select count(*) from public.finance_users f where f.tenant_id=identity_tenant
          and f.active and (f.id=identity_finance_id
            or pg_catalog.lower(pg_catalog.btrim(f.email))=pg_catalog.lower(pg_catalog.btrim(identity_finance.email))
            or (identity_finance.auth_user_id is not null and f.auth_user_id=identity_finance.auth_user_id)))
         <> (case when identity_finance.active then 1 else 0 end) then
        raise exception 'Portal current Finance identity is duplicated';
      end if;

      select count(*) into identity_count from public.users u
      left join public.employees e on e.id=u.employee_id
      where u.status='active' and u.deleted_at is null
        and ((identity_finance.auth_user_id is not null and u.auth_user_id=identity_finance.auth_user_id)
          or pg_catalog.lower(pg_catalog.btrim(u.email))=pg_catalog.lower(pg_catalog.btrim(identity_finance.email))
          or e.employee_no=identity_finance_id or e.metadata->>'finance_user_id'=identity_finance_id);

      if not identity_finance.active then
        -- Offboarding is a valid authorized state, never a reason to reactivate
        -- an old Portal/employee row merely to deploy an unrelated UI fix.
        if identity_finance.org_status is distinct from 'inactive' or identity_count<>0
          or exists(select 1 from public.employees e join public.companies c on c.id=e.company_id
            where c.code=identity_finance.entity_id and e.employment_status='active' and e.deleted_at is null
              and (e.employee_no=identity_finance_id or e.metadata->>'finance_user_id'=identity_finance_id))
          or exists(select 1 from public.employee_department_roles r where r.tenant_id=identity_tenant
            and r.finance_user_id=identity_finance_id and r.active and r.is_primary)
          or exists(select 1 from public.tenant_members m where m.tenant_id=identity_tenant
            and m.finance_user_id=identity_finance_id and m.active)
          or exists(select 1 from public.finance_identity_links l where l.tenant_id=identity_tenant
            and l.finance_user_id=identity_finance_id and l.active) then
          raise exception 'Portal offboarded identity retained an active access projection';
        end if;
      else
        if identity_finance.org_status is distinct from 'active' then
          raise exception 'Portal active Finance employment state is inconsistent';
        end if;
        select c.* into identity_company from public.companies c
        where c.code=identity_finance.entity_id and c.status='active' and c.deleted_at is null;
        if not found or (select count(*) from public.companies c where c.code=identity_finance.entity_id
            and c.status='active' and c.deleted_at is null)<>1 then
          raise exception 'Portal canonical current company is unavailable or duplicated';
        end if;
        if (select count(*) from public.employee_department_roles r where r.tenant_id=identity_tenant
            and r.finance_user_id=identity_finance_id and r.active and r.is_primary
            and (r.effective_from is null or r.effective_from<=identity_date)
            and (r.effective_to is null or r.effective_to>=identity_date))<>1 then
          raise exception 'Portal canonical primary department authority is missing or duplicated';
        end if;
        select d.id into identity_department from public.employee_department_roles r
        join public.departments d on d.id=r.department_id
        where r.tenant_id=identity_tenant and r.finance_user_id=identity_finance_id
          and r.active and r.is_primary and r.department_code=identity_finance.department_code
          and r.role_key=identity_finance.role
          and (r.effective_from is null or r.effective_from<=identity_date)
          and (r.effective_to is null or r.effective_to>=identity_date)
          and d.company_id=identity_company.id and d.code=identity_finance.department_code
          and d.status='active' and d.deleted_at is null;
        if not found then raise exception 'Portal company/department disagrees with current Finance authority';end if;

        select count(*) into identity_count from public.employees e
        where e.company_id=identity_company.id and e.employment_status='active' and e.deleted_at is null
          and (e.employee_no=identity_finance_id or e.metadata->>'finance_user_id'=identity_finance_id);
        if identity_count>1 then raise exception 'Portal canonical current-company employee is duplicated';end if;
        select e.* into identity_employee from public.employees e
        where e.company_id=identity_company.id and e.employment_status='active' and e.deleted_at is null
          and e.employee_no=identity_finance_id and e.metadata->>'finance_user_id'=identity_finance_id
          and e.primary_department_id=identity_department
          and e.full_name=identity_finance.name
          and pg_catalog.lower(pg_catalog.btrim(e.email))=pg_catalog.lower(pg_catalog.btrim(identity_finance.email));

        if identity_finance.google_link_status='pending_first_login' then
          if identity_finance.auth_user_id is not null or identity_finance.google_login_verified_at is not null
            or not exists(select 1 from private.finance_member_admin_events_v1 a where a.tenant_id=identity_tenant
              and a.finance_user_id=identity_finance_id
              and a.after_state->>'member_revision'=identity_finance.member_revision::text
              and a.after_state->>'google_link_status'='pending_first_login')
            or exists(select 1 from public.users u left join public.employees e on e.id=u.employee_id
              where u.status='active' and u.deleted_at is null and u.auth_user_id is not null
                and (pg_catalog.lower(pg_catalog.btrim(u.email))=pg_catalog.lower(pg_catalog.btrim(identity_finance.email))
                  or e.employee_no=identity_finance_id or e.metadata->>'finance_user_id'=identity_finance_id))
            or exists(select 1 from public.tenant_members m where m.tenant_id=identity_tenant
              and m.finance_user_id=identity_finance_id and m.active)
            or exists(select 1 from public.finance_identity_links l where l.tenant_id=identity_tenant
              and l.finance_user_id=identity_finance_id and l.active) then
            raise exception 'Portal pending first login prematurely retained an authenticated identity';
          end if;
          -- A pending unbound person may have no Portal projection yet. A
          -- projection already present must remain unique, coherent and unbound.
          if identity_count=1 and identity_employee.id is null then
            raise exception 'Portal pending current-company employee projection is inconsistent';
          end if;
          select count(*) into identity_count from public.users u left join public.employees e on e.id=u.employee_id
          where u.status='active' and u.deleted_at is null and
            (pg_catalog.lower(pg_catalog.btrim(u.email))=pg_catalog.lower(pg_catalog.btrim(identity_finance.email))
              or e.employee_no=identity_finance_id or e.metadata->>'finance_user_id'=identity_finance_id);
          if identity_count>1 then raise exception 'Portal pending first-login projection is duplicated';end if;
          if identity_count=1 and not exists(select 1 from public.users u where u.status='active' and u.deleted_at is null
            and u.auth_user_id is null and u.company_id=identity_company.id and u.employee_id=identity_employee.id
            and pg_catalog.lower(pg_catalog.btrim(u.email))=pg_catalog.lower(pg_catalog.btrim(identity_finance.email))) then
            raise exception 'Portal pending first-login projection has foreign company or employee';
          end if;
        else
          if identity_finance.google_link_status is null or identity_finance.google_link_status not in('bound','pending_rebind')
            or identity_finance.auth_user_id is null or identity_finance.google_login_verified_at is null
            or identity_employee.id is null then
            raise exception 'Portal current canonical employee or verified binding is unavailable';
          end if;
          if not exists(select 1 from auth.users a where a.id=identity_finance.auth_user_id
            and a.email_confirmed_at is not null
            and pg_catalog.lower(pg_catalog.btrim(a.email))=pg_catalog.lower(pg_catalog.btrim(identity_finance.email))
            and exists(select 1 from auth.identities i where i.user_id=a.id and i.provider='google'
              and i.identity_data->>'email_verified'='true'
              and pg_catalog.lower(pg_catalog.btrim(i.identity_data->>'email'))=pg_catalog.lower(pg_catalog.btrim(a.email)))) then
            raise exception 'Portal canonical Auth is not the current verified Google identity';
          end if;
          select count(*) into identity_count from public.users u left join public.employees e on e.id=u.employee_id
          where u.status='active' and u.deleted_at is null and
            (u.auth_user_id=identity_finance.auth_user_id
              or pg_catalog.lower(pg_catalog.btrim(u.email))=pg_catalog.lower(pg_catalog.btrim(identity_finance.email))
              or e.employee_no=identity_finance_id or e.metadata->>'finance_user_id'=identity_finance_id);
          if identity_count<>1 then raise exception 'Portal canonical active identity is missing or duplicated';end if;
          select u.* into identity_portal from public.users u where u.auth_user_id=identity_finance.auth_user_id
            and u.status='active' and u.deleted_at is null;
          if not found or identity_portal.company_id is distinct from identity_company.id
            or identity_portal.employee_id is distinct from identity_employee.id
            or pg_catalog.lower(pg_catalog.btrim(identity_portal.email)) is distinct from pg_catalog.lower(pg_catalog.btrim(identity_finance.email)) then
            raise exception 'Portal current Auth/company/employee linkage is inconsistent';
          end if;
          if identity_finance.google_link_status='bound' and identity_finance.pending_login_email is not null then
            raise exception 'Portal bound identity retained an inconsistent pending target';
          end if;
          if identity_finance.google_link_status='pending_rebind' and
            (nullif(pg_catalog.btrim(identity_finance.pending_login_email),'') is null
              or pg_catalog.lower(pg_catalog.btrim(identity_finance.pending_login_email)) !~ '^[^@[:space:]]+@suiyuecare[.]com$'
              or pg_catalog.lower(pg_catalog.btrim(identity_finance.pending_login_email))=pg_catalog.lower(pg_catalog.btrim(identity_finance.email))
              or exists(select 1 from public.finance_users f where f.tenant_id=identity_tenant and f.id<>identity_finance_id and f.active
                and (pg_catalog.lower(pg_catalog.btrim(f.email))=pg_catalog.lower(pg_catalog.btrim(identity_finance.pending_login_email))
                  or pg_catalog.lower(pg_catalog.btrim(f.pending_login_email))=pg_catalog.lower(pg_catalog.btrim(identity_finance.pending_login_email))))
              or exists(select 1 from public.users u where u.status='active' and u.deleted_at is null
                and pg_catalog.lower(pg_catalog.btrim(u.email))=pg_catalog.lower(pg_catalog.btrim(identity_finance.pending_login_email)))) then
            raise exception 'Portal pending target obtained premature access or is inconsistent';
          end if;
        end if;
      end if;
    end;
    -- FINANCE_PORTAL_IDENTITY_CURRENT_V1_END
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
