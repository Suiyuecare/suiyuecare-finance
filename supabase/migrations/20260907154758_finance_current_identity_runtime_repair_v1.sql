set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Employee login recovery must not call the personnel-management RPC. This
-- zero-argument endpoint repairs only missing, non-privileged projections of
-- the caller's already approved Finance identity. No role/manager editing.
do $preflight$
begin
  if to_regprocedure('public.current_finance_user()') is null
     or to_regprocedure('public.finance_verified_google_email(uuid)') is null
     or to_regprocedure('public.current_tenant_id()') is null
     or to_regprocedure('public.finance_stable_setting_id(text,text)') is null
     or to_regclass('public.system_settings') is null
     or to_regclass('public.module_audit_logs') is null then
    raise exception 'Current identity repair requires the adopted Finance identity/schema baseline';
  end if;
end;
$preflight$;

create or replace function public.finance_repair_current_identity_runtime_v1()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor uuid := auth.uid();
  v_tenant uuid := public.current_tenant_id();
  v_current public.finance_users%rowtype := public.current_finance_user();
  v_user public.finance_users%rowtype;
  v_email text;
  v_department uuid;
  v_company_count integer;
  v_department_count integer;
  v_members integer := 0;
  v_roles integer := 0;
  v_needs_management boolean := false;
begin
  if v_actor is null or v_tenant is null or v_current.id is null then
    raise exception 'A verified active Finance identity is required' using errcode = '42501';
  end if;
  v_email := public.finance_verified_google_email(v_actor);
  select fu.* into v_user from public.finance_users fu
  where fu.id = v_current.id and fu.tenant_id = v_tenant
    and fu.auth_user_id = v_actor and fu.active = true
    and fu.google_link_status in ('bound', 'pending_rebind')
    and lower(btrim(fu.email)) = v_email
  for update;
  if v_user.id is null or v_email is null then
    raise exception 'Finance identity is inactive or outside the current tenant' using errcode = '42501';
  end if;

  -- Do not reactivate revoked membership or overwrite a conflicting binding.
  if not exists (
    select 1 from public.tenant_members tm where tm.tenant_id = v_tenant
      and tm.finance_user_id = v_user.id and tm.auth_user_id = v_actor
      and lower(btrim(tm.email)) = v_email and tm.active = true
  ) then
    if exists (
      select 1 from public.tenant_members tm where tm.tenant_id = v_tenant
        and (tm.finance_user_id = v_user.id or tm.auth_user_id = v_actor or lower(btrim(tm.email)) = v_email)
    ) then
      return jsonb_build_object('ok', false, 'finance_user_id', v_user.id,
        'tenant_id', v_tenant, 'tenant_members_created', 0, 'employee_roles_created', 0,
        'requires_management_review', true, 'reason', 'membership_revoked_or_conflict');
    end if;
    insert into public.tenant_members (
      tenant_id, auth_user_id, finance_user_id, email, name, role, role_label,
      entity_id, department_code, active, updated_at
    ) values (
      v_tenant, v_actor, v_user.id, v_email, v_user.name, v_user.role,
      v_user.role_label, v_user.entity_id, v_user.department_code, true, now()
    );
    get diagnostics v_members = row_count;
  end if;

  -- Existing memberships and assignments remain administrator-owned. A
  -- matching UUID/email is not permission to rewrite a changed role, date,
  -- company, department or approval assignment through a self-service RPC.
  if exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = v_tenant and tm.finance_user_id = v_user.id and tm.active = true
      and (tm.role is distinct from v_user.role
        or tm.entity_id is distinct from v_user.entity_id
        or tm.department_code is distinct from v_user.department_code)
  ) or exists (
    select 1 from public.employee_department_roles edr
    where edr.tenant_id = v_tenant and edr.finance_user_id = v_user.id
      and edr.is_primary = true and edr.active = true
      and (edr.role_key is distinct from v_user.role
        or edr.department_code is distinct from v_user.department_code
        or edr.effective_from > current_date
        or edr.effective_to < current_date)
  ) then
    v_needs_management := true;
  end if;

  if not exists (
    select 1 from public.employee_department_roles edr
    where edr.tenant_id = v_tenant and edr.finance_user_id = v_user.id
      and edr.is_primary = true and edr.active = true
  ) then
    -- A missing employee projection is recoverable; a revoked assignment or
    -- privileged assignment must go through the existing approved admin path.
    if v_user.role is distinct from 'employee' or exists (
      select 1 from public.employee_department_roles edr
      where edr.tenant_id = v_tenant and edr.finance_user_id = v_user.id and edr.is_primary = true
    ) then
      v_needs_management := true;
    else
      -- companies/departments are shared HR projections without tenant_id.
      -- A code alone cannot prove tenant ownership. Require the published
      -- tenant's entity + legal tax ID mapping to resolve exactly one company
      -- and one active department; do not choose the first duplicate.
      with configured_entities as (
        select entity_item from public.system_settings ss
        cross join lateral jsonb_array_elements(case when jsonb_typeof(ss.value) = 'array' then ss.value else '[]'::jsonb end) entity_item
        where ss.tenant_id = v_tenant and ss.key = 'entities'
          and coalesce(nullif(entity_item ->> 'id', ''), nullif(entity_item ->> 'eid', ''), nullif(entity_item ->> 'code', ''), nullif(entity_item ->> 'c', '')) = v_user.entity_id
          and lower(coalesce(entity_item ->> 'active', entity_item ->> 'on', 'true')) not in ('false', '0', 'no', 'off')
      ), company_mapping as (
        select distinct c.id from public.companies c join configured_entities e
          on c.code = v_user.entity_id
          and nullif(btrim(e.entity_item ->> 'taxId'), '') = nullif(btrim(c.tax_id), '')
        where c.deleted_at is null and c.status = 'active'
      ), department_mapping as (
        select distinct d.id from public.departments d join company_mapping c on c.id = d.company_id
        where d.code = v_user.department_code and d.deleted_at is null and d.status = 'active'
      )
      select (select count(*) from company_mapping), (select count(*) from department_mapping),
        (select (array_agg(id))[1] from department_mapping)
      into v_company_count, v_department_count, v_department;
      if v_company_count <> 1 or v_department_count <> 1 or v_department is null then
        v_needs_management := true;
      else
        insert into public.employee_department_roles (
          id, tenant_id, finance_user_id, department_id, department_code,
          role_key, role_type, relation_type, is_primary, effective_from,
          active, is_department_manager, is_department_director, can_approve,
          permissions_override, metadata, created_at, updated_at
        ) values (
          public.finance_stable_setting_id('edr_primary', v_user.id),
          v_tenant, v_user.id, v_department, v_user.department_code,
          'employee', 'primary', 'primary', true, current_date,
          true, false, false, false, '{}'::jsonb,
          jsonb_build_object('source', 'current_identity_repair_v1', 'actor_auth_user_id', v_actor), now(), now()
        );
        get diagnostics v_roles = row_count;
      end if;
    end if;
  end if;
  if v_members + v_roles > 0 then
    insert into public.module_audit_logs (table_name, row_id, action, actor_email, before_data, after_data)
    values ('finance_users', v_user.id, 'SELF_IDENTITY_RUNTIME_REPAIR', v_email,
      jsonb_build_object('tenant_id', v_tenant, 'actor_auth_user_id', v_actor),
      jsonb_build_object('tenant_members_created', v_members, 'employee_roles_created', v_roles,
        'can_approve_granted', false, 'management_permissions_granted', false));
  end if;
  return jsonb_build_object('ok', not v_needs_management, 'finance_user_id', v_user.id,
    'tenant_id', v_tenant, 'tenant_members_created', v_members,
    'employee_roles_created', v_roles, 'requires_management_review', v_needs_management);
end;
$function$;

alter function public.finance_repair_current_identity_runtime_v1() owner to postgres;
revoke all on function public.finance_repair_current_identity_runtime_v1() from public, anon, service_role;
grant execute on function public.finance_repair_current_identity_runtime_v1() to authenticated;
comment on function public.finance_repair_current_identity_runtime_v1() is
  'Self-only missing employee projection recovery; never reactivates revoked rows or grants approval/management rights.';

do $postflight$
begin
  if not has_function_privilege('authenticated', 'public.finance_repair_current_identity_runtime_v1()', 'execute')
     or has_function_privilege('anon', 'public.finance_repair_current_identity_runtime_v1()', 'execute')
     or has_function_privilege('service_role', 'public.finance_repair_current_identity_runtime_v1()', 'execute') then
    raise exception 'Current identity repair execute privilege postflight failed';
  end if;
end;
$postflight$;
notify pgrst, 'reload schema';
