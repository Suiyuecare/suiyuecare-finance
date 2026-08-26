-- Versioned organization designer v1.
--
-- Forward-only/non-rerunnable: installs the missing backend used by the
-- existing organization editor.  A published version atomically updates the
-- Finance department settings, accounting responsibility centers and the
-- employee supervisor runtime.  Governance nodes stay out of accounting.

set lock_timeout = '5s';
set statement_timeout = '60s';

do $preflight$
begin
  if to_regclass('public.finance_department_units') is null
     or to_regclass('public.employee_department_roles') is null
     or to_regclass('public.system_settings') is null
     or to_regclass('public.departments') is null
     or to_regclass('public.companies') is null
     or to_regprocedure('public.finance_publish_department_settings_atomic(jsonb,bigint)') is null
     or to_regprocedure('public.save_finance_org_chart_rows(jsonb)') is null then
    raise exception 'Versioned organization prerequisites are missing';
  end if;
  if encode(extensions.digest(
       pg_get_functiondef('public.finance_publish_department_settings_atomic(jsonb,bigint)'::regprocedure),
       'sha256'
     ), 'hex') <> '1f5f83f8e5621f344f4b685ae27729ddae7ee596fd956a74bd9760b7d257fec3'
     or encode(extensions.digest(
       pg_get_functiondef('public.save_finance_org_chart_rows(jsonb)'::regprocedure),
       'sha256'
     ), 'hex') <> 'e0846760b51ecf6f057b95300cc477d3999f648642226d9edcc1438910dec5cb'
     or encode(extensions.digest(
       pg_get_functiondef('public.finance_assert_department_settings(jsonb,uuid)'::regprocedure),
       'sha256'
     ), 'hex') <> '3990bcf0949fe792fffeb3206f0975d364a65feb4b5a11c405b12a8f2aee0cde' then
    raise exception 'Versioned organization prerequisite definitions changed; review before applying';
  end if;
  if to_regclass('private.finance_membership_org_versions_v1') is not null
     or to_regprocedure('public.membership_org_get_published_graph()') is not null then
    raise exception 'Versioned organization designer v1 is already installed';
  end if;
end;
$preflight$;

create table private.finance_membership_org_versions_v1 (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on update cascade on delete restrict,
  version_no bigint not null,
  status text not null check (status in (
    'draft', 'validated', 'pending_review', 'published', 'archived',
    'rejected', 'cancelled', 'activation_failed'
  )),
  title text not null,
  reason text not null,
  snapshot jsonb not null,
  revision bigint not null default 1 check (revision > 0),
  etag text not null,
  validation_summary jsonb not null default '{}'::jsonb,
  impact_summary jsonb not null default '{}'::jsonb,
  source_version_id uuid references private.finance_membership_org_versions_v1(id) on update cascade on delete restrict,
  effective_at timestamptz not null default clock_timestamp(),
  created_by_finance_user_id text not null,
  submitted_by_finance_user_id text,
  submitted_at timestamptz,
  approved_by_finance_user_id text,
  published_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (tenant_id, version_no)
);

create unique index finance_membership_org_versions_v1_one_published_idx
  on private.finance_membership_org_versions_v1 (tenant_id)
  where status = 'published';

create index finance_membership_org_versions_v1_tenant_status_updated_idx
  on private.finance_membership_org_versions_v1 (tenant_id, status, updated_at desc);

alter table private.finance_membership_org_versions_v1 owner to postgres;
revoke all on table private.finance_membership_org_versions_v1 from public, anon, authenticated, service_role;

create or replace function private.finance_membership_org_etag_v1(
  p_snapshot jsonb,
  p_revision bigint
)
returns text
language sql
immutable
security definer
set search_path = ''
as $function$
  select encode(
    extensions.digest(coalesce(p_snapshot, '{}'::jsonb)::text || ':' || coalesce(p_revision, 0)::text, 'sha256'),
    'hex'
  )
$function$;

create or replace function private.finance_membership_org_role_label_v1(p_position_code text)
returns text
language sql
immutable
security definer
set search_path = ''
as $function$
  select case upper(btrim(coalesce(p_position_code, 'MEMBER')))
    when 'CHAIRMAN' then '董事長'
    when 'BOARD_MEMBER' then '董事'
    when 'GENERAL_MANAGER' then '總經理'
    when 'EXECUTIVE_DIRECTOR' then '執行長'
    when 'DIVISION_HEAD' then '處長'
    when 'DEPARTMENT_HEAD' then '部長'
    when 'SECTION_HEAD' then '課長'
    when 'TEAM_HEAD' then '組長'
    when 'DIRECTOR' then '主任'
    else '組員'
  end
$function$;

create or replace function private.finance_membership_org_seed_snapshot_v1(p_tenant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_shareholders_id uuid := gen_random_uuid();
  v_board_id uuid := gen_random_uuid();
  v_executive_id uuid := gen_random_uuid();
  v_entity_codes jsonb := '[]'::jsonb;
  v_units jsonb := '[]'::jsonb;
  v_assignments jsonb := '[]'::jsonb;
  v_governance_assignments jsonb := '[]'::jsonb;
  v_overrides jsonb := '[]'::jsonb;
begin
  select coalesce(jsonb_agg(entity ->> 'id' order by entity ->> 'id'), '[]'::jsonb)
    into v_entity_codes
  from public.system_settings settings_row
  cross join lateral jsonb_array_elements(settings_row.value) entity
  where settings_row.tenant_id = p_tenant_id
    and settings_row.key = 'entities';

  v_units := jsonb_build_array(
    jsonb_build_object(
      'id', v_shareholders_id, 'code', 'GOV_SHAREHOLDERS', 'name', '股東會',
      'unit_type', 'shareholders', 'parent_org_unit_id', null,
      'sort_order', 10, 'is_posting_unit', false,
      'entity_scope_mode', 'all', 'entity_codes', v_entity_codes,
      'active', true, 'metadata', jsonb_build_object('system_governance_node', true)
    ),
    jsonb_build_object(
      'id', v_board_id, 'code', 'GOV_BOARD', 'name', '董事會',
      'unit_type', 'board', 'parent_org_unit_id', v_shareholders_id,
      'sort_order', 10, 'is_posting_unit', false,
      'entity_scope_mode', 'all', 'entity_codes', v_entity_codes,
      'active', true, 'metadata', jsonb_build_object('system_governance_node', true)
    ),
    jsonb_build_object(
      'id', v_executive_id, 'code', 'GOV_EXECUTIVE', 'name', '經營層',
      'unit_type', 'executive', 'parent_org_unit_id', v_board_id,
      'sort_order', 10, 'is_posting_unit', false,
      'entity_scope_mode', 'all', 'entity_codes', v_entity_codes,
      'active', true, 'metadata', jsonb_build_object('system_governance_node', true)
    )
  );

  select v_units || coalesce(jsonb_agg(
    jsonb_build_object(
      'id', unit_row.id,
      'code', unit_row.code,
      'name', unit_row.name,
      'unit_type', unit_row.unit_type,
      'parent_org_unit_id', coalesce(unit_row.parent_unit_id, v_executive_id),
      'sort_order', unit_row.sort_order,
      'is_posting_unit', unit_row.is_posting_unit,
      'entity_scope_mode', 'explicit',
      'entity_codes', coalesce((
        select jsonb_agg(scope_row.entity_code order by scope_row.entity_code)
        from public.finance_department_entity_scopes scope_row
        where scope_row.tenant_id = unit_row.tenant_id
          and scope_row.unit_id = unit_row.id
          and scope_row.active = true
      ), jsonb_build_array(unit_row.primary_entity_code)),
      'active', unit_row.active,
      'legacy_department_code', unit_row.code,
      'metadata', coalesce(unit_row.metadata, '{}'::jsonb)
        || jsonb_build_object('seed_source', 'finance_department_units')
    ) order by unit_row.level, unit_row.sort_order, unit_row.code
  ), '[]'::jsonb)
    into v_units
  from public.finance_department_units unit_row
  where unit_row.tenant_id = p_tenant_id
    and unit_row.present_in_source = true;

  -- Preserve active legacy assignments whose historical department codes are
  -- not present in the Finance department projection.  They remain accounting
  -- units.  Company-root codes remain non-posting divisions, while named
  -- legacy departments/sections remain non-posting until explicitly enabled.
  -- The publish projection keeps each governance/division assignee's existing
  -- accounting responsibility center separate from their organization title.
  select v_units || coalesce(jsonb_agg(
    jsonb_build_object(
      'id', department_row.id,
      'code', upper(department_row.code),
      'name', department_row.name,
      'unit_type', case
        when department_row.name = company_row.name or upper(department_row.code) ~ '^[A-Z]1000$' then 'division'
        else 'department'
      end,
      'parent_org_unit_id', v_executive_id,
      'sort_order', 9000,
      'is_posting_unit', false,
      'entity_scope_mode', case when entity_match.entity_code is null then 'all' else 'explicit' end,
      'entity_codes', case
        when entity_match.entity_code is null then v_entity_codes
        else jsonb_build_array(entity_match.entity_code)
      end,
      'active', true,
      'legacy_department_code', upper(department_row.code),
      'metadata', jsonb_build_object(
        'seed_source', 'legacy_departments',
        'legacy_non_posting', true,
        'company_id', department_row.company_id
      )
    ) order by department_row.code
  ), '[]'::jsonb)
    into v_units
  from public.departments department_row
  join public.companies company_row on company_row.id = department_row.company_id
  left join lateral (
    select entity ->> 'id' entity_code
    from public.system_settings setting_row
    cross join lateral jsonb_array_elements(setting_row.value) entity
    where setting_row.tenant_id = p_tenant_id
      and setting_row.key = 'entities'
      and (
        (nullif(regexp_replace(coalesce(company_row.tax_id, ''), '[^0-9A-Za-z]', '', 'g'), '') is not null
          and upper(regexp_replace(coalesce(entity ->> 'taxId', ''), '[^0-9A-Za-z]', '', 'g'))
            = upper(regexp_replace(company_row.tax_id, '[^0-9A-Za-z]', '', 'g')))
        or lower(btrim(coalesce(entity ->> 'full', entity ->> 's', ''))) = lower(btrim(company_row.name))
      )
    order by case when lower(btrim(coalesce(entity ->> 'full', entity ->> 's', ''))) = lower(btrim(company_row.name)) then 0 else 1 end
    limit 1
  ) entity_match on true
  where department_row.status = 'active'
    and exists (
      select 1
      from public.employee_department_roles role_row
      where role_row.tenant_id = p_tenant_id
        and role_row.active = true
        and upper(role_row.department_code) = upper(department_row.code)
    )
    and not exists (
      select 1
      from public.finance_department_units unit_row
      where unit_row.tenant_id = p_tenant_id
        and upper(unit_row.code) = upper(department_row.code)
        and unit_row.present_in_source = true
    );

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', role_row.id,
      'finance_user_id', role_row.finance_user_id,
      'org_unit_id', role_row.unit_item ->> 'id',
      'org_unit_code', upper(role_row.unit_item ->> 'code'),
      'position_code', case
        when role_row.is_department_manager and role_row.unit_item ->> 'unit_type' = 'team' then 'TEAM_HEAD'
        when role_row.is_department_manager and role_row.unit_item ->> 'unit_type' = 'section' then 'SECTION_HEAD'
        when role_row.is_department_manager then 'DEPARTMENT_HEAD'
        when role_row.is_department_director then 'DIRECTOR'
        else 'MEMBER'
      end,
      'assignment_kind', case when role_row.is_primary then 'primary' else 'secondary' end,
      'head_kind', case
        when role_row.is_department_manager and role_row.manager_rank = 1 then 'permanent'
        else null
      end,
      'can_approve', role_row.can_approve,
      'effective_from', role_row.effective_from,
      'effective_to', role_row.effective_to,
      'active', role_row.active,
      'metadata', coalesce(role_row.metadata, '{}'::jsonb)
        || jsonb_build_object('seed_source', 'employee_department_roles')
    ) order by role_row.finance_user_id, role_row.is_primary desc, role_row.id
  ), '[]'::jsonb)
    into v_assignments
  from (
    select source_role.*,
           unit_row.item unit_item,
           row_number() over (
             partition by upper(source_role.department_code), source_role.is_department_manager
             order by source_role.is_primary desc,
               case
                 when unit_row.item ->> 'unit_type' = 'team' and source_role.role_key in ('team_head', 'section_chief') then 0
                 when unit_row.item ->> 'unit_type' = 'section' and source_role.role_key = 'section_chief' then 0
                 when unit_row.item ->> 'unit_type' = 'department' and source_role.role_key = 'dept_manager' then 0
                 else 1
               end,
               source_role.updated_at desc nulls last,
               source_role.id
           ) manager_rank
    from public.employee_department_roles source_role
    join lateral jsonb_array_elements(v_units) unit_row(item)
      on upper(unit_row.item ->> 'code') = upper(source_role.department_code)
    where source_role.tenant_id = p_tenant_id
      and source_role.active = true
  ) role_row;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', 'governance_' || user_row.id,
      'finance_user_id', user_row.id,
      'org_unit_id', case user_row.role
        when 'shareholder' then v_shareholders_id
        when 'board' then v_board_id
        else v_executive_id
      end,
      'position_code', case user_row.role
        when 'shareholder' then 'MEMBER'
        when 'board' then 'BOARD_MEMBER'
        else 'GENERAL_MANAGER'
      end,
      'assignment_kind', 'secondary',
      'head_kind', case when user_row.role = 'ceo' then 'permanent' else null end,
      'can_approve', user_row.role in ('board', 'ceo'),
      'effective_from', current_date,
      'effective_to', null,
      'active', true,
      'metadata', jsonb_build_object('seed_source', 'finance_users_governance')
    ) order by user_row.role, user_row.id
  ), '[]'::jsonb)
    into v_governance_assignments
  from public.finance_users user_row
  where user_row.tenant_id = p_tenant_id
    and user_row.active = true
    and user_row.role in ('shareholder', 'board', 'ceo');

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', 'reporting_' || role_row.id,
      'finance_user_id', role_row.finance_user_id,
      'supervisor_finance_user_id', role_row.direct_supervisor_finance_user_id,
      'effective_from', role_row.effective_from,
      'effective_to', role_row.effective_to,
      'active', role_row.active,
      'metadata', jsonb_build_object('seed_source', 'employee_department_roles')
    ) order by role_row.finance_user_id, role_row.id
  ), '[]'::jsonb)
    into v_overrides
  from public.employee_department_roles role_row
  where role_row.tenant_id = p_tenant_id
    and role_row.active = true
    and role_row.is_primary = true
    and role_row.direct_supervisor_finance_user_id is not null;

  return jsonb_build_object(
    'schema_version', 2,
    'units', v_units,
    'assignments', v_assignments || v_governance_assignments,
    'reporting_overrides', v_overrides
  );
end;
$function$;

create or replace function private.finance_membership_org_departments_v1(
  p_tenant_id uuid,
  p_snapshot jsonb
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  with recursive
  units as (
    select
      item ->> 'id' id,
      upper(btrim(item ->> 'code')) code,
      btrim(item ->> 'name') name,
      lower(btrim(item ->> 'unit_type')) unit_type,
      nullif(item ->> 'parent_org_unit_id', '') parent_id,
      coalesce((item ->> 'sort_order')::integer, 0) sort_order,
      coalesce((item ->> 'is_posting_unit')::boolean, false) is_posting_unit,
      lower(btrim(coalesce(item ->> 'entity_scope_mode', 'inherit'))) scope_mode,
      coalesce(item -> 'entity_codes', '[]'::jsonb) entity_codes,
      coalesce((item ->> 'active')::boolean, true) active,
      item
    from jsonb_array_elements(coalesce(p_snapshot -> 'units', '[]'::jsonb)) item
  ),
  entity_settings as (
    select entity ->> 'id' entity_code
    from public.system_settings setting_row
    cross join lateral jsonb_array_elements(setting_row.value) entity
    where setting_row.tenant_id = p_tenant_id and setting_row.key = 'entities'
  ),
  ancestor_chain as (
    select u.id root_id, u.id current_id, u.parent_id, u.scope_mode, u.entity_codes, 0 depth
    from units u
    union all
    select chain.root_id, parent.id, parent.parent_id, parent.scope_mode, parent.entity_codes, chain.depth + 1
    from ancestor_chain chain
    join units parent on parent.id = chain.parent_id
    where chain.depth < 32
  ),
  effective_scopes as (
    select root.id,
      coalesce((
        select case
          when chain.scope_mode = 'all' then (
            select coalesce(jsonb_agg(entity_code order by entity_code), '[]'::jsonb)
            from entity_settings
          )
          else chain.entity_codes
        end
        from ancestor_chain chain
        where chain.root_id = root.id
          and chain.scope_mode in ('all', 'explicit')
        order by chain.depth
        limit 1
      ), '[]'::jsonb) entity_codes
    from units root
  ),
  parent_chain as (
    select u.id root_id, u.parent_id current_id, 1 depth
    from units u
    union all
    select chain.root_id, parent.parent_id, chain.depth + 1
    from parent_chain chain
    join units parent on parent.id = chain.current_id
    where chain.depth < 32
  ),
  projected as (
    select
      u.*,
      case u.unit_type when 'department' then 3 when 'section' then 4 when 'team' then 5 end level_no,
      scope.entity_codes effective_entities,
      (
        select parent.code
        from parent_chain chain
        join units parent on parent.id = chain.current_id
        where chain.root_id = u.id
          and parent.active
          and parent.unit_type in ('department', 'section', 'team')
        order by chain.depth
        limit 1
      ) parent_code
    from units u
    join effective_scopes scope on scope.id = u.id
    where u.active and u.unit_type in ('department', 'section', 'team')
  ),
  rows as (
    select jsonb_build_object(
      'c', p.code,
      'n', p.name,
      'lv', p.level_no,
      'eid', coalesce((select value #>> '{}' from jsonb_array_elements(p.effective_entities) with ordinality e(value, ord) order by ord limit 1), ''),
      'sort', p.sort_order,
      'active', true,
      'parent', coalesce(p.parent_code, ''),
      'parentCode', p.parent_code,
      'parent_department_code', p.parent_code,
      'shared', jsonb_array_length(p.effective_entities) > 1,
      'unitType', p.unit_type,
      'entityCodes', p.effective_entities,
      'newFormEntityCodes', p.effective_entities,
      'isPostingUnit', p.is_posting_unit,
      'managerId', (
        select assignment ->> 'finance_user_id'
        from jsonb_array_elements(coalesce(p_snapshot -> 'assignments', '[]'::jsonb)) assignment
        where assignment ->> 'org_unit_id' = p.id
          and coalesce((assignment ->> 'active')::boolean, true)
          and assignment ->> 'head_kind' in ('permanent', 'acting')
        order by case assignment ->> 'head_kind' when 'permanent' then 0 else 1 end
        limit 1
      ),
      'directorId', (
        select assignment ->> 'finance_user_id'
        from parent_chain chain
        join units parent on parent.id = chain.current_id
        cross join lateral jsonb_array_elements(coalesce(p_snapshot -> 'assignments', '[]'::jsonb)) assignment
        where chain.root_id = p.id
          and assignment ->> 'org_unit_id' = parent.id
          and coalesce((assignment ->> 'active')::boolean, true)
          and assignment ->> 'head_kind' in ('permanent', 'acting')
        order by chain.depth, case assignment ->> 'head_kind' when 'permanent' then 0 else 1 end
        limit 1
      )
    ) row_value,
    p.level_no,
    p.sort_order,
    p.code
    from projected p
  )
  select coalesce(jsonb_agg(row_value order by level_no, sort_order, code), '[]'::jsonb)
  from rows
$function$;

create or replace function private.finance_membership_org_supervisor_v1(
  p_snapshot jsonb,
  p_finance_user_id text,
  p_org_unit_id text
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_supervisor text;
begin
  select override_row ->> 'supervisor_finance_user_id'
    into v_supervisor
  from jsonb_array_elements(coalesce(p_snapshot -> 'reporting_overrides', '[]'::jsonb)) override_row
  where override_row ->> 'finance_user_id' = p_finance_user_id
    and coalesce((override_row ->> 'active')::boolean, true)
    and nullif(override_row ->> 'supervisor_finance_user_id', '') is not null
  limit 1;
  if v_supervisor is not null and v_supervisor <> p_finance_user_id then
    return v_supervisor;
  end if;

  select assignment ->> 'finance_user_id'
    into v_supervisor
  from jsonb_array_elements(coalesce(p_snapshot -> 'assignments', '[]'::jsonb)) assignment
  where assignment ->> 'org_unit_id' = p_org_unit_id
    and assignment ->> 'finance_user_id' <> p_finance_user_id
    and coalesce((assignment ->> 'active')::boolean, true)
    and assignment ->> 'head_kind' in ('permanent', 'acting')
  order by case assignment ->> 'head_kind' when 'permanent' then 0 else 1 end
  limit 1;
  if v_supervisor is not null then return v_supervisor; end if;

  with recursive units as (
    select item ->> 'id' id, nullif(item ->> 'parent_org_unit_id', '') parent_id
    from jsonb_array_elements(coalesce(p_snapshot -> 'units', '[]'::jsonb)) item
  ), chain as (
    select u.parent_id current_id, 1 depth from units u where u.id = p_org_unit_id
    union all
    select parent.parent_id, chain.depth + 1
    from chain join units parent on parent.id = chain.current_id
    where chain.depth < 32
  )
  select assignment ->> 'finance_user_id'
    into v_supervisor
  from chain
  cross join lateral jsonb_array_elements(coalesce(p_snapshot -> 'assignments', '[]'::jsonb)) assignment
  where assignment ->> 'org_unit_id' = chain.current_id
    and assignment ->> 'finance_user_id' <> p_finance_user_id
    and coalesce((assignment ->> 'active')::boolean, true)
    and assignment ->> 'head_kind' in ('permanent', 'acting')
  order by chain.depth, case assignment ->> 'head_kind' when 'permanent' then 0 else 1 end
  limit 1;
  return v_supervisor;
end;
$function$;

create or replace function private.finance_membership_org_validate_v1(
  p_tenant_id uuid,
  p_snapshot jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_errors text[] := '{}'::text[];
  v_warnings text[] := '{}'::text[];
  v_departments jsonb := '[]'::jsonb;
  v_unit_count integer := 0;
  v_assignment_count integer := 0;
begin
  if jsonb_typeof(p_snapshot) is distinct from 'object'
     or jsonb_typeof(p_snapshot -> 'units') is distinct from 'array'
     or jsonb_typeof(p_snapshot -> 'assignments') is distinct from 'array'
     or jsonb_typeof(coalesce(p_snapshot -> 'reporting_overrides', '[]'::jsonb)) is distinct from 'array' then
    return jsonb_build_object(
      'ok', false,
      'errors', jsonb_build_array('組織草稿格式不正確'),
      'warnings', '[]'::jsonb
    );
  end if;

  v_unit_count := jsonb_array_length(p_snapshot -> 'units');
  v_assignment_count := jsonb_array_length(p_snapshot -> 'assignments');
  if v_unit_count < 3 or v_unit_count > 500 then
    v_errors := array_append(v_errors, '組織單位數必須介於 3 至 500 個');
  end if;
  if v_assignment_count > 2000 then
    v_errors := array_append(v_errors, '任職資料不可超過 2,000 筆');
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_snapshot -> 'units') item
    where nullif(item ->> 'id', '') is null
       or nullif(btrim(item ->> 'name'), '') is null
       or upper(btrim(item ->> 'code')) !~ '^[A-Z0-9_-]{2,32}$'
       or lower(btrim(item ->> 'unit_type')) not in (
         'shareholders', 'board', 'executive', 'division',
         'department', 'section', 'team'
       )
       or lower(btrim(coalesce(item ->> 'entity_scope_mode', 'inherit'))) not in ('inherit', 'all', 'explicit')
       or (item ? 'entity_codes' and jsonb_typeof(item -> 'entity_codes') is distinct from 'array')
  ) then
    v_errors := array_append(v_errors, '單位代碼、名稱、層級或公司範圍格式不正確');
  end if;

  if v_unit_count <> (
    select count(distinct item ->> 'id') from jsonb_array_elements(p_snapshot -> 'units') item
  ) then
    v_errors := array_append(v_errors, '組織單位識別碼不可重複');
  end if;
  if v_unit_count <> (
    select count(distinct upper(btrim(item ->> 'code'))) from jsonb_array_elements(p_snapshot -> 'units') item
  ) then
    v_errors := array_append(v_errors, '組織單位代碼不可重複');
  end if;

  if (
    select count(*)
    from jsonb_array_elements(p_snapshot -> 'units') item
    where lower(item ->> 'unit_type') = 'shareholders'
      and nullif(item ->> 'parent_org_unit_id', '') is null
      and coalesce((item ->> 'active')::boolean, true)
  ) <> 1 then
    v_errors := array_append(v_errors, '啟用中的組織必須恰好有一個股東會根節點');
  end if;

  if exists (
    with units as (
      select item ->> 'id' id,
             nullif(item ->> 'parent_org_unit_id', '') parent_id,
             lower(item ->> 'unit_type') unit_type,
             coalesce((item ->> 'active')::boolean, true) active,
             case lower(item ->> 'unit_type')
               when 'shareholders' then 1 when 'board' then 2 when 'executive' then 3
               when 'division' then 4 when 'department' then 5 when 'section' then 6
               when 'team' then 7 else 99 end rank_no
      from jsonb_array_elements(p_snapshot -> 'units') item
    )
    select 1
    from units child
    left join units parent on parent.id = child.parent_id
    where child.active and (
      (child.parent_id is not null and parent.id is null)
      or (child.parent_id is not null and not parent.active)
      or (parent.id is not null and parent.rank_no >= child.rank_no)
      or child.id = child.parent_id
    )
  ) then
    v_errors := array_append(v_errors, '上層單位不存在、已停用，或層級不是上一階');
  end if;

  if exists (
    with recursive units as (
      select item ->> 'id' id, nullif(item ->> 'parent_org_unit_id', '') parent_id
      from jsonb_array_elements(p_snapshot -> 'units') item
    ), chain(root_id, current_id, path, cycle, depth) as (
      select id, parent_id, array[id], false, 1 from units where parent_id is not null
      union all
      select chain.root_id, parent.parent_id, chain.path || parent.id,
             parent.id = any(chain.path), chain.depth + 1
      from chain join units parent on parent.id = chain.current_id
      where not chain.cycle and chain.depth < 64
    )
    select 1 from chain where cycle or current_id = root_id
  ) then
    v_errors := array_append(v_errors, '組織圖不可形成循環');
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_snapshot -> 'units') item
    cross join lateral jsonb_array_elements_text(coalesce(item -> 'entity_codes', '[]'::jsonb)) entity_code
    where nullif(btrim(entity_code), '') is null
       or not exists (
         select 1
         from public.system_settings setting_row
         cross join lateral jsonb_array_elements(setting_row.value) entity
         where setting_row.tenant_id = p_tenant_id
           and setting_row.key = 'entities'
           and upper(btrim(entity ->> 'id')) = upper(btrim(entity_code))
       )
  ) then
    v_errors := array_append(v_errors, '單位使用了不存在的公司代碼');
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_snapshot -> 'units') item
    where lower(item ->> 'unit_type') in ('shareholders', 'board', 'executive', 'division')
      and coalesce((item ->> 'is_posting_unit')::boolean, false)
  ) then
    v_errors := array_append(v_errors, '股東會、董事會、經營層與處不可作為費用責任中心');
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_snapshot -> 'assignments') assignment
    where nullif(assignment ->> 'id', '') is null
       or nullif(assignment ->> 'finance_user_id', '') is null
       or nullif(assignment ->> 'org_unit_id', '') is null
       or upper(btrim(coalesce(assignment ->> 'position_code', 'MEMBER'))) not in (
         'CHAIRMAN', 'BOARD_MEMBER', 'GENERAL_MANAGER', 'EXECUTIVE_DIRECTOR',
         'DIVISION_HEAD', 'DEPARTMENT_HEAD', 'SECTION_HEAD', 'TEAM_HEAD',
         'DIRECTOR', 'MEMBER'
       )
       or lower(btrim(coalesce(assignment ->> 'assignment_kind', 'secondary'))) not in ('primary', 'secondary')
       or lower(btrim(coalesce(assignment ->> 'head_kind', ''))) not in ('', 'permanent', 'acting')
       or not exists (
         select 1 from public.finance_users fu
         where fu.tenant_id = p_tenant_id
           and fu.id = assignment ->> 'finance_user_id'
           and fu.active = true
       )
       or not exists (
         select 1 from jsonb_array_elements(p_snapshot -> 'units') unit_item
         where unit_item ->> 'id' = assignment ->> 'org_unit_id'
           and coalesce((unit_item ->> 'active')::boolean, true)
       )
  ) then
    v_errors := array_append(v_errors, '任職人員、單位、職位或主兼任格式不正確');
  end if;

  if exists (
    select assignment ->> 'finance_user_id'
    from jsonb_array_elements(p_snapshot -> 'assignments') assignment
    where coalesce((assignment ->> 'active')::boolean, true)
      and lower(coalesce(assignment ->> 'assignment_kind', 'secondary')) = 'primary'
    group by assignment ->> 'finance_user_id'
    having count(*) > 1
  ) then
    v_errors := array_append(v_errors, '同一人不可同時有兩個主要任職');
  end if;

  if exists (
    select 1
    from public.finance_users fu
    where fu.tenant_id = p_tenant_id
      and fu.active = true
      and coalesce(fu.org_status, 'active') <> 'system_account'
      and 1 <> (
        select count(*)
        from jsonb_array_elements(p_snapshot -> 'assignments') assignment
        where assignment ->> 'finance_user_id' = fu.id
          and coalesce((assignment ->> 'active')::boolean, true)
          and lower(coalesce(assignment ->> 'assignment_kind', 'secondary')) = 'primary'
      )
  ) then
    v_errors := array_append(v_errors, '每位啟用中的正式人員都必須恰好有一個主要任職');
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_snapshot -> 'assignments') assignment
    join jsonb_array_elements(p_snapshot -> 'units') unit_item
      on unit_item ->> 'id' = assignment ->> 'org_unit_id'
    join public.finance_users fu
      on fu.tenant_id = p_tenant_id
     and fu.id = assignment ->> 'finance_user_id'
     and fu.active = true
    where coalesce((assignment ->> 'active')::boolean, true)
      and lower(coalesce(assignment ->> 'assignment_kind', 'secondary')) = 'primary'
      and lower(unit_item ->> 'unit_type') in ('shareholders', 'board', 'executive', 'division')
      and (
        nullif(btrim(coalesce(fu.department_code, '')), '') is null
        or not exists (
          select 1 from public.departments department_row
          where department_row.code = fu.department_code
            and department_row.deleted_at is null
        )
      )
  ) then
    v_errors := array_append(v_errors, '治理層或處級任職人員仍須保留一個有效的費用責任中心');
  end if;

  if exists (
    select assignment ->> 'org_unit_id', assignment ->> 'head_kind'
    from jsonb_array_elements(p_snapshot -> 'assignments') assignment
    where coalesce((assignment ->> 'active')::boolean, true)
      and assignment ->> 'head_kind' in ('permanent', 'acting')
    group by assignment ->> 'org_unit_id', assignment ->> 'head_kind'
    having count(*) > 1
  ) then
    v_errors := array_append(v_errors, '同一單位只能有一位正主管與一位代理主管');
  end if;

  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_snapshot -> 'reporting_overrides', '[]'::jsonb)) override_row
    where override_row ->> 'finance_user_id' = override_row ->> 'supervisor_finance_user_id'
       or not exists (
         select 1 from public.finance_users fu
         where fu.tenant_id = p_tenant_id and fu.active = true
           and fu.id = override_row ->> 'finance_user_id'
       )
       or not exists (
         select 1 from public.finance_users fu
         where fu.tenant_id = p_tenant_id and fu.active = true
           and fu.id = override_row ->> 'supervisor_finance_user_id'
       )
  ) then
    v_errors := array_append(v_errors, '直屬主管例外的人員不存在或指向自己');
  end if;

  begin
    v_departments := private.finance_membership_org_departments_v1(p_tenant_id, p_snapshot);
    perform public.finance_assert_department_settings(v_departments, p_tenant_id);
  exception when others then
    v_errors := array_append(v_errors, '會計責任中心驗證失敗：' || sqlerrm);
  end;

  select array_cat(v_warnings, coalesce(array_agg((unit_item ->> 'name') || ' 尚未設定主管'), '{}'::text[]))
    into v_warnings
  from jsonb_array_elements(p_snapshot -> 'units') unit_item
  where coalesce((unit_item ->> 'active')::boolean, true)
    and lower(unit_item ->> 'unit_type') not in ('shareholders')
    and not exists (
      select 1
      from jsonb_array_elements(p_snapshot -> 'assignments') assignment
      where assignment ->> 'org_unit_id' = unit_item ->> 'id'
        and coalesce((assignment ->> 'active')::boolean, true)
        and assignment ->> 'head_kind' in ('permanent', 'acting')
    );

  return jsonb_build_object(
    'ok', cardinality(v_errors) = 0,
    'errors', to_jsonb(v_errors),
    'warnings', to_jsonb(v_warnings),
    'unit_count', v_unit_count,
    'assignment_count', v_assignment_count,
    'posting_department_count', jsonb_array_length(v_departments)
  );
end;
$function$;

create or replace function private.finance_membership_org_impact_v1(
  p_old_snapshot jsonb,
  p_new_snapshot jsonb
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  with old_units as (
    select item ->> 'code' code, item from jsonb_array_elements(coalesce(p_old_snapshot -> 'units', '[]'::jsonb)) item
    where coalesce((item ->> 'active')::boolean, true)
  ), new_units as (
    select item ->> 'code' code, item from jsonb_array_elements(coalesce(p_new_snapshot -> 'units', '[]'::jsonb)) item
    where coalesce((item ->> 'active')::boolean, true)
  ), old_assignments as (
    select item ->> 'id' id, item from jsonb_array_elements(coalesce(p_old_snapshot -> 'assignments', '[]'::jsonb)) item
    where coalesce((item ->> 'active')::boolean, true)
  ), new_assignments as (
    select item ->> 'id' id, item from jsonb_array_elements(coalesce(p_new_snapshot -> 'assignments', '[]'::jsonb)) item
    where coalesce((item ->> 'active')::boolean, true)
  )
  select jsonb_build_object(
    'units_added', (select count(*) from new_units n where not exists (select 1 from old_units o where o.code=n.code)),
    'units_disabled', (select count(*) from old_units o where not exists (select 1 from new_units n where n.code=o.code)),
    'units_renamed', (select count(*) from new_units n join old_units o using(code) where n.item ->> 'name' is distinct from o.item ->> 'name'),
    'units_moved', (select count(*) from new_units n join old_units o using(code) where n.item ->> 'parent_org_unit_id' is distinct from o.item ->> 'parent_org_unit_id'),
    'posting_changed', (select count(*) from new_units n join old_units o using(code) where n.item ->> 'is_posting_unit' is distinct from o.item ->> 'is_posting_unit'),
    'assignments_added', (select count(*) from new_assignments n where not exists (select 1 from old_assignments o where o.id=n.id)),
    'assignments_disabled', (select count(*) from old_assignments o where not exists (select 1 from new_assignments n where n.id=o.id)),
    'assignments_changed', (select count(*) from new_assignments n join old_assignments o using(id) where n.item is distinct from o.item),
    'affected_workflow_steps', '[]'::jsonb,
    'vacant_head_unit_codes', coalesce((
      select jsonb_agg(n.code order by n.code)
      from new_units n
      where lower(n.item ->> 'unit_type') not in ('shareholders')
        and not exists (
          select 1 from new_assignments a
          where a.item ->> 'org_unit_id' = n.item ->> 'id'
            and a.item ->> 'head_kind' in ('permanent', 'acting')
        )
    ), '[]'::jsonb)
  )
$function$;

create or replace function private.finance_membership_org_version_payload_v1(p_version_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select jsonb_build_object(
    'id', version_row.id,
    'version_no', version_row.version_no,
    'status', version_row.status,
    'title', version_row.title,
    'reason', version_row.reason,
    'revision', version_row.revision,
    'etag', version_row.etag,
    'effective_at', version_row.effective_at,
    'validation_summary', version_row.validation_summary,
    'impact_summary', version_row.impact_summary,
    'submitted_at', version_row.submitted_at,
    'published_at', version_row.published_at,
    'created_at', version_row.created_at,
    'updated_at', version_row.updated_at
  )
  from private.finance_membership_org_versions_v1 version_row
  where version_row.id = p_version_id
$function$;

create or replace function private.finance_membership_org_actor_v1(
  p_require_manage boolean default false,
  p_require_publish boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_tenant_id uuid;
  v_finance_user_id text;
  v_role text;
  v_can_manage boolean := false;
  v_can_publish boolean := false;
begin
  if auth.uid() is null then
    raise exception '請先使用公司 Google Workspace 帳號登入'
      using errcode = '42501';
  end if;

  v_tenant_id := public.current_tenant_id();
  v_finance_user_id := public.current_finance_user_id();
  if v_tenant_id is null or nullif(v_finance_user_id, '') is null then
    raise exception '目前登入帳號尚未完成公司與人員身分綁定'
      using errcode = '42501';
  end if;

  select lower(btrim(user_row.role))
    into v_role
  from public.finance_users user_row
  where user_row.tenant_id = v_tenant_id
    and user_row.id = v_finance_user_id
    and user_row.active = true;
  if v_role is null then
    raise exception '目前登入人員已停用或不存在'
      using errcode = '42501';
  end if;

  v_can_manage := v_role in ('ceo', 'admin_director', 'hr')
    or coalesce(public.is_finance_admin(), false);
  v_can_publish := v_role = 'ceo';
  if p_require_manage and not v_can_manage then
    raise exception '只有執行長、行政部門主任或人資可以編輯組織圖'
      using errcode = '42501';
  end if;
  if p_require_publish and not v_can_publish then
    raise exception '只有目前啟用中的執行長可以發布組織版本'
      using errcode = '42501';
  end if;

  return jsonb_build_object(
    'tenant_id', v_tenant_id,
    'finance_user_id', v_finance_user_id,
    'role', v_role,
    'can_manage', v_can_manage,
    'can_publish', v_can_publish,
    'can_view_people', v_can_manage,
    'is_permanent_ceo', v_can_publish
  );
end;
$function$;

create or replace function private.finance_membership_org_graph_v1(
  p_version_id uuid,
  p_permissions jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_version private.finance_membership_org_versions_v1%rowtype;
  v_units jsonb := '[]'::jsonb;
  v_assignments jsonb := '[]'::jsonb;
  v_entities jsonb := '[]'::jsonb;
begin
  select * into v_version
  from private.finance_membership_org_versions_v1 version_row
  where version_row.id = p_version_id;
  if not found then
    raise exception '找不到組織版本' using errcode = 'P0002';
  end if;

  with recursive units as (
    select item ->> 'id' id,
           nullif(item ->> 'parent_org_unit_id', '') parent_id,
           upper(btrim(item ->> 'code')) code,
           item,
           coalesce((item ->> 'sort_order')::integer, 0) sort_order
    from jsonb_array_elements(v_version.snapshot -> 'units') item
  ), paths as (
    select u.id, u.parent_id, array[u.code] path_codes, 0 depth, array[u.id] seen
    from units u where u.parent_id is null
    union all
    select child.id, child.parent_id, parent.path_codes || child.code,
           parent.depth + 1, parent.seen || child.id
    from paths parent
    join units child on child.parent_id = parent.id
    where not child.id = any(parent.seen) and parent.depth < 63
  )
  select coalesce(jsonb_agg(
    unit_row.item
      || jsonb_build_object(
        'path_codes', to_jsonb(coalesce(path_row.path_codes, array[unit_row.code])),
        'depth', coalesce(path_row.depth, 0),
        'head', coalesce((
          select jsonb_build_object(
            'finance_user_id', assignment ->> 'finance_user_id',
            'name', person.name,
            'head_kind', assignment ->> 'head_kind',
            'position_code', assignment ->> 'position_code',
            'vacant', false
          )
          from jsonb_array_elements(v_version.snapshot -> 'assignments') assignment
          join public.finance_users person
            on person.tenant_id = v_version.tenant_id
           and person.id = assignment ->> 'finance_user_id'
          where assignment ->> 'org_unit_id' = unit_row.id
            and coalesce((assignment ->> 'active')::boolean, true)
            and assignment ->> 'head_kind' in ('permanent', 'acting')
          order by case assignment ->> 'head_kind' when 'permanent' then 0 else 1 end
          limit 1
        ), jsonb_build_object('vacant', true))
      )
    order by coalesce(path_row.path_codes, array[unit_row.code]), unit_row.sort_order, unit_row.code
  ), '[]'::jsonb)
    into v_units
  from units unit_row
  left join paths path_row on path_row.id = unit_row.id;

  select coalesce(jsonb_agg(
    assignment
      || jsonb_build_object(
        'name', person.name,
        'position_name', private.finance_membership_org_role_label_v1(assignment ->> 'position_code')
      )
    order by assignment ->> 'org_unit_id', assignment ->> 'head_kind' nulls last,
             person.name, assignment ->> 'id'
  ), '[]'::jsonb)
    into v_assignments
  from jsonb_array_elements(v_version.snapshot -> 'assignments') assignment
  join public.finance_users person
    on person.tenant_id = v_version.tenant_id
   and person.id = assignment ->> 'finance_user_id';

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', entity ->> 'id',
    'code', entity ->> 'id',
    'short_name', coalesce(entity ->> 's', entity ->> 'short_name', entity ->> 'id'),
    'legal_name', coalesce(entity ->> 'full', entity ->> 'legal_name', entity ->> 's', entity ->> 'id'),
    'tax_id', coalesce(entity ->> 'taxId', entity ->> 'tax_id'),
    'active', coalesce((entity ->> 'active')::boolean, true)
  ) order by entity ->> 'id'), '[]'::jsonb)
    into v_entities
  from public.system_settings setting_row
  cross join lateral jsonb_array_elements(setting_row.value) entity
  where setting_row.tenant_id = v_version.tenant_id
    and setting_row.key = 'entities';

  return jsonb_build_object(
    'ok', true,
    'org_version_id', v_version.id,
    'version_no', v_version.version_no,
    'etag', v_version.etag,
    'activated_at', v_version.published_at,
    'next_effective_change_at', null,
    'units', v_units,
    'assignments', v_assignments,
    'legal_entities', v_entities,
    'permissions', coalesce(p_permissions, '{}'::jsonb)
  );
end;
$function$;

create or replace function private.finance_membership_org_publish_projection_v1(
  p_tenant_id uuid,
  p_snapshot jsonb,
  p_version_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_validation jsonb;
  v_departments jsonb;
  v_current_department_version bigint;
  v_department_publish jsonb;
  v_primary_rows jsonb := '[]'::jsonb;
  v_org_save jsonb;
  v_expected_primary integer := 0;
  v_secondary_touched integer := 0;
  v_people_touched integer := 0;
begin
  v_validation := private.finance_membership_org_validate_v1(p_tenant_id, p_snapshot);
  if not coalesce((v_validation ->> 'ok')::boolean, false) then
    raise exception '組織版本驗證未通過：%', v_validation -> 'errors'
      using errcode = '23514';
  end if;

  v_departments := private.finance_membership_org_departments_v1(p_tenant_id, p_snapshot);
  select setting_row.version::bigint
    into v_current_department_version
  from public.system_settings setting_row
  where setting_row.tenant_id = p_tenant_id and setting_row.key = 'departments'
  for update;
  if not found then v_current_department_version := 0; end if;

  v_department_publish := public.finance_publish_department_settings_atomic(
    v_departments,
    v_current_department_version
  );
  if not coalesce((v_department_publish ->> 'ok')::boolean, false) then
    raise exception '部門與會計責任中心發布失敗：%', v_department_publish
      using errcode = '40001';
  end if;

  with assignments as (
    select assignment,
           assignment ->> 'finance_user_id' finance_user_id,
           assignment ->> 'org_unit_id' org_unit_id
    from jsonb_array_elements(p_snapshot -> 'assignments') assignment
    where coalesce((assignment ->> 'active')::boolean, true)
      and lower(coalesce(assignment ->> 'assignment_kind', 'secondary')) = 'primary'
  ), units as (
    select item ->> 'id' id, upper(btrim(item ->> 'code')) code,
           lower(item ->> 'unit_type') unit_type
    from jsonb_array_elements(p_snapshot -> 'units') item
    where coalesce((item ->> 'active')::boolean, true)
  ), rows as (
    select jsonb_build_object(
      'userId', assignment_row.finance_user_id,
      'departmentCode', case
        when unit_row.unit_type in ('department', 'section', 'team') then unit_row.code
        else coalesce(user_row.department_code, existing_role.department_code)
      end,
      'supervisorId', private.finance_membership_org_supervisor_v1(
        p_snapshot, assignment_row.finance_user_id, assignment_row.org_unit_id
      ),
      'canApprove', coalesce((assignment_row.assignment ->> 'can_approve')::boolean, false),
      'isDepartmentManager', assignment_row.assignment ->> 'head_kind' in ('permanent', 'acting'),
      'isDepartmentDirector', upper(coalesce(assignment_row.assignment ->> 'position_code', '')) in (
        'CHAIRMAN', 'GENERAL_MANAGER', 'EXECUTIVE_DIRECTOR', 'DIVISION_HEAD'
      ),
      'roleType', lower(coalesce(assignment_row.assignment ->> 'position_code', 'MEMBER')),
      'sourceVersionId', p_version_id
    ) row_value
    from assignments assignment_row
    join units unit_row on unit_row.id = assignment_row.org_unit_id
    join public.finance_users user_row
      on user_row.tenant_id = p_tenant_id
     and user_row.id = assignment_row.finance_user_id
     and user_row.active = true
    left join lateral (
      select role_row.department_code
      from public.employee_department_roles role_row
      where role_row.tenant_id = p_tenant_id
        and role_row.finance_user_id = assignment_row.finance_user_id
        and role_row.is_primary = true
      order by role_row.active desc, role_row.updated_at desc nulls last, role_row.id
      limit 1
    ) existing_role on true
    where unit_row.unit_type in ('department', 'section', 'team')
       or nullif(coalesce(user_row.department_code, existing_role.department_code), '') is not null
  )
  select coalesce(jsonb_agg(row_value), '[]'::jsonb), count(*)
    into v_primary_rows, v_expected_primary
  from rows;

  if (
    select count(*)
    from public.finance_users user_row
    where user_row.tenant_id = p_tenant_id
      and user_row.active = true
      and coalesce(user_row.org_status, 'active') <> 'system_account'
  ) <> (
    select count(*)
    from jsonb_array_elements(p_snapshot -> 'assignments') assignment
    join jsonb_array_elements(p_snapshot -> 'units') unit_row
      on unit_row ->> 'id' = assignment ->> 'org_unit_id'
    join public.finance_users user_row
      on user_row.tenant_id = p_tenant_id
     and user_row.id = assignment ->> 'finance_user_id'
     and user_row.active = true
     and coalesce(user_row.org_status, 'active') <> 'system_account'
    where coalesce((assignment ->> 'active')::boolean, true)
      and lower(coalesce(assignment ->> 'assignment_kind', 'secondary')) = 'primary'
      and coalesce((unit_row ->> 'active')::boolean, true)
  ) then
    raise exception '主要任職未能完整對應啟用中的人員，已停止發布'
      using errcode = '23514';
  end if;

  v_org_save := public.save_finance_org_chart_rows(v_primary_rows);
  if not coalesce((v_org_save ->> 'ok')::boolean, false)
     or coalesce((v_org_save ->> 'resolved_count')::integer, -1) <> v_expected_primary then
    raise exception '主管與簽核路徑投影不完整：%', v_org_save
      using errcode = '23514';
  end if;

  update public.employee_department_roles role_row
  set active = false,
      effective_to = coalesce(role_row.effective_to, current_date),
      updated_at = clock_timestamp(),
      metadata = coalesce(role_row.metadata, '{}'::jsonb)
        || jsonb_build_object('disabled_by_org_version_id', p_version_id)
  where role_row.tenant_id = p_tenant_id
    and role_row.is_primary = false
    and role_row.active = true;

  with units as (
    select item ->> 'id' id, upper(btrim(item ->> 'code')) code,
           lower(item ->> 'unit_type') unit_type
    from jsonb_array_elements(p_snapshot -> 'units') item
    where coalesce((item ->> 'active')::boolean, true)
  ), assignments as (
    select assignment, assignment ->> 'id' assignment_id,
           assignment ->> 'finance_user_id' finance_user_id,
           assignment ->> 'org_unit_id' org_unit_id
    from jsonb_array_elements(p_snapshot -> 'assignments') assignment
    where coalesce((assignment ->> 'active')::boolean, true)
      and lower(coalesce(assignment ->> 'assignment_kind', 'secondary')) = 'secondary'
  ), source_rows as (
    select assignment_row.*, unit_row.code,
           assignment_row.assignment ->> 'position_code' position_code,
           assignment_row.assignment ->> 'head_kind' head_kind,
           coalesce((assignment_row.assignment ->> 'can_approve')::boolean, false) can_approve
    from assignments assignment_row
    join units unit_row on unit_row.id = assignment_row.org_unit_id
    where unit_row.unit_type in ('department', 'section', 'team')
  )
  insert into public.employee_department_roles (
    id, tenant_id, finance_user_id, department_id, department_code,
    position_id, role_key, role_type, relation_type, is_primary,
    effective_from, effective_to, active,
    direct_supervisor_finance_user_id,
    is_department_manager, is_department_director, can_approve,
    approval_delegate_finance_user_id, permissions_override, metadata,
    created_at, updated_at
  )
  select 'mo_secondary_' || substr(encode(extensions.digest(source_row.assignment_id, 'sha256'), 'hex'), 1, 32),
         p_tenant_id, source_row.finance_user_id,
         department_row.id, source_row.code,
         null, user_row.role, lower(coalesce(source_row.position_code, 'MEMBER')),
         'secondary', false,
         coalesce((nullif(source_row.assignment ->> 'effective_from', '')::timestamptz)::date, current_date),
         (nullif(source_row.assignment ->> 'effective_to', '')::timestamptz)::date,
         true,
         private.finance_membership_org_supervisor_v1(
           p_snapshot, source_row.finance_user_id, source_row.org_unit_id
         ),
         source_row.head_kind in ('permanent', 'acting'),
         upper(coalesce(source_row.position_code, '')) in (
           'CHAIRMAN', 'GENERAL_MANAGER', 'EXECUTIVE_DIRECTOR', 'DIVISION_HEAD'
         ),
         source_row.can_approve,
         null, '{}'::jsonb,
         coalesce(source_row.assignment -> 'metadata', '{}'::jsonb)
           || jsonb_build_object(
             'source', 'membership_org_designer_v1',
             'org_version_id', p_version_id,
             'position_code', source_row.position_code
           ),
         clock_timestamp(), clock_timestamp()
  from source_rows source_row
  join public.finance_users user_row
    on user_row.tenant_id = p_tenant_id
   and user_row.id = source_row.finance_user_id
   and user_row.active = true
  left join public.departments department_row
    on department_row.code = source_row.code
   and department_row.deleted_at is null
  on conflict (id) do update set
    department_id = excluded.department_id,
    department_code = excluded.department_code,
    role_key = excluded.role_key,
    role_type = excluded.role_type,
    relation_type = excluded.relation_type,
    is_primary = false,
    effective_from = excluded.effective_from,
    effective_to = excluded.effective_to,
    active = true,
    direct_supervisor_finance_user_id = excluded.direct_supervisor_finance_user_id,
    is_department_manager = excluded.is_department_manager,
    is_department_director = excluded.is_department_director,
    can_approve = excluded.can_approve,
    metadata = excluded.metadata,
    updated_at = clock_timestamp();
  get diagnostics v_secondary_touched = row_count;

  with units as (
    select item ->> 'id' id, upper(btrim(item ->> 'code')) code
    from jsonb_array_elements(p_snapshot -> 'units') item
  ), primaries as (
    select assignment ->> 'finance_user_id' finance_user_id,
           assignment ->> 'org_unit_id' org_unit_id
    from jsonb_array_elements(p_snapshot -> 'assignments') assignment
    where coalesce((assignment ->> 'active')::boolean, true)
      and lower(coalesce(assignment ->> 'assignment_kind', 'secondary')) = 'primary'
  ), primary_entity as (
    select primary_row.finance_user_id, unit_row.code,
           department ->> 'eid' entity_id
    from primaries primary_row
    join units unit_row on unit_row.id = primary_row.org_unit_id
    join lateral jsonb_array_elements(v_departments) department
      on department ->> 'c' = unit_row.code
  )
  update public.finance_users user_row
  set department_code = primary_entity.code,
      entity_id = primary_entity.entity_id,
      org_source = 'membership_org_designer_v1',
      org_source_updated_at = clock_timestamp()
  from primary_entity
  where user_row.tenant_id = p_tenant_id
    and user_row.id = primary_entity.finance_user_id;
  get diagnostics v_people_touched = row_count;

  update public.tenant_members member_row
  set department_code = user_row.department_code,
      entity_id = user_row.entity_id,
      updated_at = clock_timestamp()
  from public.finance_users user_row
  where member_row.tenant_id = p_tenant_id
    and user_row.tenant_id = p_tenant_id
    and member_row.finance_user_id = user_row.id
    and member_row.active = true;

  return jsonb_build_object(
    'ok', true,
    'department_publish', v_department_publish,
    'org_save', v_org_save,
    'primary_count', v_expected_primary,
    'secondary_touched', v_secondary_touched,
    'people_touched', v_people_touched
  );
end;
$function$;

create or replace function public.membership_org_get_published_graph()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_actor jsonb;
  v_version_id uuid;
begin
  v_actor := private.finance_membership_org_actor_v1(false, false);
  select version_row.id into v_version_id
  from private.finance_membership_org_versions_v1 version_row
  where version_row.tenant_id = (v_actor ->> 'tenant_id')::uuid
    and version_row.status = 'published';
  if v_version_id is null then
    raise exception '正式組織版本尚未建立' using errcode = 'P0002';
  end if;
  return private.finance_membership_org_graph_v1(v_version_id, v_actor - 'tenant_id' - 'finance_user_id' - 'role');
end;
$function$;

create or replace function public.membership_org_list_people()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_actor jsonb;
begin
  v_actor := private.finance_membership_org_actor_v1(true, false);
  return jsonb_build_object('ok', true, 'items', coalesce((
    select jsonb_agg(jsonb_build_object(
      'finance_user_id', user_row.id,
      'name', user_row.name,
      'email', coalesce(user_row.pending_login_email, user_row.email),
      'job_title', user_row.job_title,
      'department_code', user_row.department_code,
      'entity_id', user_row.entity_id,
      'active', user_row.active
    ) order by user_row.active desc, user_row.name, user_row.id)
    from public.finance_users user_row
    where user_row.tenant_id = (v_actor ->> 'tenant_id')::uuid
  ), '[]'::jsonb));
end;
$function$;

create or replace function public.membership_org_create_draft(
  p_title text,
  p_reason text,
  p_effective_at timestamptz default clock_timestamp(),
  p_from_version_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor jsonb;
  v_tenant_id uuid;
  v_source private.finance_membership_org_versions_v1%rowtype;
  v_created private.finance_membership_org_versions_v1%rowtype;
  v_next_version bigint;
begin
  v_actor := private.finance_membership_org_actor_v1(true, false);
  v_tenant_id := (v_actor ->> 'tenant_id')::uuid;
  if length(btrim(coalesce(p_title, ''))) < 2 or length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception '草稿標題至少 2 字，異動原因至少 3 字' using errcode = '22023';
  end if;
  if p_effective_at > clock_timestamp() + interval '1 minute' then
    raise exception '第一版僅支援立即發布；請在實際生效時再核准' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('membership-org:' || v_tenant_id::text, 0));
  if exists (
    select 1 from private.finance_membership_org_versions_v1 version_row
    where version_row.tenant_id = v_tenant_id
      and version_row.status in ('draft', 'validated', 'pending_review', 'rejected')
  ) then
    raise exception '已有尚未完成的組織草稿；請先完成或關閉原草稿' using errcode = '55000';
  end if;

  select * into v_source
  from private.finance_membership_org_versions_v1 version_row
  where version_row.tenant_id = v_tenant_id
    and version_row.id = coalesce(p_from_version_id, (
      select published_row.id
      from private.finance_membership_org_versions_v1 published_row
      where published_row.tenant_id = v_tenant_id and published_row.status = 'published'
    ));
  if not found then raise exception '找不到草稿來源版本' using errcode = 'P0002'; end if;

  select coalesce(max(version_row.version_no), 0) + 1 into v_next_version
  from private.finance_membership_org_versions_v1 version_row
  where version_row.tenant_id = v_tenant_id;

  insert into private.finance_membership_org_versions_v1(
    tenant_id, version_no, status, title, reason, snapshot, revision, etag,
    source_version_id, effective_at, created_by_finance_user_id
  ) values (
    v_tenant_id, v_next_version, 'draft', btrim(p_title), btrim(p_reason),
    v_source.snapshot, 1, private.finance_membership_org_etag_v1(v_source.snapshot, 1),
    v_source.id, clock_timestamp(), v_actor ->> 'finance_user_id'
  ) returning * into v_created;

  return jsonb_build_object(
    'ok', true,
    'version', private.finance_membership_org_version_payload_v1(v_created.id),
    'snapshot', v_created.snapshot
  );
end;
$function$;

create or replace function public.membership_org_cancel_draft(p_version_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor jsonb;
  v_version private.finance_membership_org_versions_v1%rowtype;
begin
  v_actor := private.finance_membership_org_actor_v1(true, false);
  perform pg_advisory_xact_lock(hashtextextended(
    'membership-org:' || (v_actor ->> 'tenant_id'), 0
  ));

  update private.finance_membership_org_versions_v1 version_row
  set status = 'cancelled',
      reason = version_row.reason || E'\n作廢：由管理者取消此草稿',
      updated_at = clock_timestamp()
  where version_row.id = p_version_id
    and version_row.tenant_id = (v_actor ->> 'tenant_id')::uuid
    and version_row.status in ('draft', 'validated', 'pending_review', 'rejected')
    and (
      version_row.created_by_finance_user_id = v_actor ->> 'finance_user_id'
      or v_actor ->> 'role' in ('ceo', 'admin_director')
    )
  returning * into v_version;

  if not found then
    raise exception '找不到可作廢的草稿，或你不是草稿建立人' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'ok', true,
    'cancelled', true,
    'version', private.finance_membership_org_version_payload_v1(v_version.id)
  );
end;
$function$;

create or replace function public.membership_org_get_draft(p_version_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_actor jsonb;
  v_version private.finance_membership_org_versions_v1%rowtype;
begin
  v_actor := private.finance_membership_org_actor_v1(true, false);
  select * into v_version
  from private.finance_membership_org_versions_v1 version_row
  where version_row.id = p_version_id
    and version_row.tenant_id = (v_actor ->> 'tenant_id')::uuid;
  if not found then raise exception '找不到組織草稿' using errcode = 'P0002'; end if;
  return jsonb_build_object(
    'ok', true,
    'version', private.finance_membership_org_version_payload_v1(v_version.id),
    'snapshot', v_version.snapshot
  );
end;
$function$;

create or replace function public.membership_org_save_draft(
  p_version_id uuid,
  p_etag text,
  p_snapshot jsonb,
  p_title text,
  p_reason text,
  p_effective_at timestamptz default clock_timestamp()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor jsonb;
  v_version private.finance_membership_org_versions_v1%rowtype;
  v_published_snapshot jsonb := '{}'::jsonb;
  v_next_revision bigint;
  v_impact jsonb;
begin
  v_actor := private.finance_membership_org_actor_v1(true, false);
  if length(btrim(coalesce(p_title, ''))) < 2 or length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception '草稿標題至少 2 字，異動原因至少 3 字' using errcode = '22023';
  end if;
  if p_effective_at > clock_timestamp() + interval '1 minute' then
    raise exception '第一版僅支援立即發布；請在實際生效時再核准' using errcode = '22023';
  end if;

  select * into v_version
  from private.finance_membership_org_versions_v1 version_row
  where version_row.id = p_version_id
    and version_row.tenant_id = (v_actor ->> 'tenant_id')::uuid
  for update;
  if not found then raise exception '找不到組織草稿' using errcode = 'P0002'; end if;
  if v_version.status not in ('draft', 'validated', 'rejected') then
    raise exception '此版本目前不可編輯' using errcode = '55000';
  end if;
  if v_version.etag <> p_etag then
    raise exception '草稿已在其他視窗更新，請重新載入後再編輯' using errcode = '40001';
  end if;
  if jsonb_typeof(p_snapshot) is distinct from 'object' then
    raise exception '組織草稿格式不正確' using errcode = '22023';
  end if;

  select published_row.snapshot into v_published_snapshot
  from private.finance_membership_org_versions_v1 published_row
  where published_row.tenant_id = v_version.tenant_id and published_row.status = 'published';
  v_next_revision := v_version.revision + 1;
  v_impact := private.finance_membership_org_impact_v1(v_published_snapshot, p_snapshot);

  update private.finance_membership_org_versions_v1 version_row
  set snapshot = p_snapshot,
      revision = v_next_revision,
      etag = private.finance_membership_org_etag_v1(p_snapshot, v_next_revision),
      title = btrim(p_title),
      reason = btrim(p_reason),
      status = 'draft',
      effective_at = clock_timestamp(),
      validation_summary = '{}'::jsonb,
      impact_summary = v_impact,
      updated_at = clock_timestamp()
  where version_row.id = v_version.id
  returning * into v_version;

  return jsonb_build_object(
    'ok', true,
    'version', private.finance_membership_org_version_payload_v1(v_version.id),
    'snapshot', v_version.snapshot,
    'impact', v_impact
  );
end;
$function$;

create or replace function public.membership_org_validate_draft(p_version_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor jsonb;
  v_version private.finance_membership_org_versions_v1%rowtype;
  v_published_snapshot jsonb := '{}'::jsonb;
  v_validation jsonb;
  v_impact jsonb;
begin
  v_actor := private.finance_membership_org_actor_v1(true, false);
  select * into v_version
  from private.finance_membership_org_versions_v1 version_row
  where version_row.id = p_version_id
    and version_row.tenant_id = (v_actor ->> 'tenant_id')::uuid
  for update;
  if not found then raise exception '找不到組織草稿' using errcode = 'P0002'; end if;
  if v_version.status not in ('draft', 'validated', 'rejected') then
    raise exception '此版本目前不可驗證' using errcode = '55000';
  end if;
  select published_row.snapshot into v_published_snapshot
  from private.finance_membership_org_versions_v1 published_row
  where published_row.tenant_id = v_version.tenant_id and published_row.status = 'published';
  v_validation := private.finance_membership_org_validate_v1(v_version.tenant_id, v_version.snapshot);
  v_impact := private.finance_membership_org_impact_v1(v_published_snapshot, v_version.snapshot);

  update private.finance_membership_org_versions_v1 version_row
  set status = case when coalesce((v_validation ->> 'ok')::boolean, false) then 'validated' else 'draft' end,
      validation_summary = v_validation,
      impact_summary = v_impact,
      updated_at = clock_timestamp()
  where version_row.id = v_version.id
  returning * into v_version;

  return jsonb_build_object(
    'ok', coalesce((v_validation ->> 'ok')::boolean, false),
    'version', private.finance_membership_org_version_payload_v1(v_version.id),
    'validation', v_validation,
    'impact', v_impact
  );
end;
$function$;

create or replace function public.membership_org_submit_draft(p_version_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor jsonb;
  v_version private.finance_membership_org_versions_v1%rowtype;
  v_validation jsonb;
  v_impact jsonb;
  v_published_snapshot jsonb := '{}'::jsonb;
begin
  v_actor := private.finance_membership_org_actor_v1(true, false);
  select * into v_version
  from private.finance_membership_org_versions_v1 version_row
  where version_row.id = p_version_id
    and version_row.tenant_id = (v_actor ->> 'tenant_id')::uuid
  for update;
  if not found then raise exception '找不到組織草稿' using errcode = 'P0002'; end if;
  if v_version.status not in ('draft', 'validated', 'rejected') then
    raise exception '此版本目前不可送審' using errcode = '55000';
  end if;
  v_validation := private.finance_membership_org_validate_v1(v_version.tenant_id, v_version.snapshot);
  select published_row.snapshot into v_published_snapshot
  from private.finance_membership_org_versions_v1 published_row
  where published_row.tenant_id = v_version.tenant_id and published_row.status = 'published';
  v_impact := private.finance_membership_org_impact_v1(v_published_snapshot, v_version.snapshot);
  if not coalesce((v_validation ->> 'ok')::boolean, false) then
    update private.finance_membership_org_versions_v1
    set status = 'draft', validation_summary = v_validation,
        impact_summary = v_impact, updated_at = clock_timestamp()
    where id = v_version.id;
    return jsonb_build_object(
      'ok', false,
      'version', private.finance_membership_org_version_payload_v1(v_version.id),
      'validation', v_validation,
      'impact', v_impact
    );
  end if;

  update private.finance_membership_org_versions_v1 version_row
  set status = 'pending_review',
      validation_summary = v_validation,
      impact_summary = v_impact,
      submitted_by_finance_user_id = v_actor ->> 'finance_user_id',
      submitted_at = clock_timestamp(),
      updated_at = clock_timestamp()
  where version_row.id = v_version.id
  returning * into v_version;
  return jsonb_build_object(
    'ok', true,
    'version', private.finance_membership_org_version_payload_v1(v_version.id),
    'validation', v_validation,
    'impact', v_impact
  );
end;
$function$;

create or replace function public.membership_org_publish_draft(
  p_version_id uuid,
  p_effective_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor jsonb;
  v_version private.finance_membership_org_versions_v1%rowtype;
  v_validation jsonb;
  v_projection jsonb;
begin
  v_actor := private.finance_membership_org_actor_v1(true, true);
  if p_effective_at is not null and p_effective_at > clock_timestamp() + interval '1 minute' then
    raise exception '第一版僅支援立即發布；請在實際生效時再核准' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('membership-org:' || (v_actor ->> 'tenant_id'), 0));
  select * into v_version
  from private.finance_membership_org_versions_v1 version_row
  where version_row.id = p_version_id
    and version_row.tenant_id = (v_actor ->> 'tenant_id')::uuid
  for update;
  if not found then raise exception '找不到組織草稿' using errcode = 'P0002'; end if;
  if v_version.status <> 'pending_review' then
    raise exception '只有已送審且尚未發布的版本可以核准' using errcode = '55000';
  end if;
  v_validation := private.finance_membership_org_validate_v1(v_version.tenant_id, v_version.snapshot);
  if not coalesce((v_validation ->> 'ok')::boolean, false) then
    raise exception '正式發布前驗證未通過：%', v_validation -> 'errors' using errcode = '23514';
  end if;

  v_projection := private.finance_membership_org_publish_projection_v1(
    v_version.tenant_id, v_version.snapshot, v_version.id
  );

  update private.finance_membership_org_versions_v1 archived_row
  set status = 'archived', updated_at = clock_timestamp()
  where archived_row.tenant_id = v_version.tenant_id
    and archived_row.status = 'published'
    and archived_row.id <> v_version.id;

  update private.finance_membership_org_versions_v1 version_row
  set status = 'published',
      approved_by_finance_user_id = v_actor ->> 'finance_user_id',
      effective_at = clock_timestamp(),
      published_at = clock_timestamp(),
      validation_summary = v_validation,
      updated_at = clock_timestamp()
  where version_row.id = v_version.id
  returning * into v_version;

  return jsonb_build_object(
    'ok', true,
    'published', true,
    'scheduled', false,
    'version', private.finance_membership_org_version_payload_v1(v_version.id),
    'projection', v_projection,
    'graph', private.finance_membership_org_graph_v1(
      v_version.id, v_actor - 'tenant_id' - 'finance_user_id' - 'role'
    )
  );
end;
$function$;

create or replace function public.membership_org_reject_draft(
  p_version_id uuid,
  p_comment text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor jsonb;
  v_version private.finance_membership_org_versions_v1%rowtype;
begin
  v_actor := private.finance_membership_org_actor_v1(true, true);
  if length(btrim(coalesce(p_comment, ''))) < 3 then
    raise exception '退回原因至少 3 字' using errcode = '22023';
  end if;
  update private.finance_membership_org_versions_v1 version_row
  set status = 'rejected',
      reason = version_row.reason || E'\n退回：' || btrim(p_comment),
      approved_by_finance_user_id = v_actor ->> 'finance_user_id',
      updated_at = clock_timestamp()
  where version_row.id = p_version_id
    and version_row.tenant_id = (v_actor ->> 'tenant_id')::uuid
    and version_row.status = 'pending_review'
  returning * into v_version;
  if not found then raise exception '找不到可退回的待審版本' using errcode = 'P0002'; end if;
  return jsonb_build_object('ok', true, 'version', private.finance_membership_org_version_payload_v1(v_version.id));
end;
$function$;

create or replace function public.membership_org_cancel_scheduled(p_version_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
begin
  perform private.finance_membership_org_actor_v1(true, true);
  raise exception '目前沒有排程發布；請直接在生效當下核准發布' using errcode = '55000';
end;
$function$;

create or replace function public.membership_org_list_versions(p_limit integer default 40)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_actor jsonb;
begin
  v_actor := private.finance_membership_org_actor_v1(true, false);
  return jsonb_build_object('ok', true, 'items', coalesce((
    select jsonb_agg(private.finance_membership_org_version_payload_v1(version_row.id)
                     order by version_row.version_no desc)
    from (
      select source_row.id, source_row.version_no
      from private.finance_membership_org_versions_v1 source_row
      where source_row.tenant_id = (v_actor ->> 'tenant_id')::uuid
      order by source_row.version_no desc
      limit least(greatest(coalesce(p_limit, 40), 1), 100)
    ) version_row
  ), '[]'::jsonb));
end;
$function$;

create or replace function public.membership_org_create_rollback_draft(
  p_published_version_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor jsonb;
  v_source private.finance_membership_org_versions_v1%rowtype;
begin
  v_actor := private.finance_membership_org_actor_v1(true, false);
  select * into v_source
  from private.finance_membership_org_versions_v1 version_row
  where version_row.id = p_published_version_id
    and version_row.tenant_id = (v_actor ->> 'tenant_id')::uuid
    and version_row.status in ('published', 'archived');
  if not found then raise exception '找不到可回復的歷史版本' using errcode = 'P0002'; end if;
  return public.membership_org_create_draft(
    '回復至版本 ' || v_source.version_no,
    p_reason,
    clock_timestamp(),
    v_source.id
  );
end;
$function$;

create or replace function public.membership_org_suggest_unit_code(
  p_unit_type text,
  p_entity_code text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_actor jsonb;
  v_prefix text;
  v_seq integer := 1;
  v_code text;
begin
  v_actor := private.finance_membership_org_actor_v1(true, false);
  v_prefix := case lower(btrim(coalesce(p_unit_type, '')))
    when 'division' then 'V'
    when 'department' then 'D'
    when 'section' then 'S'
    when 'team' then 'T'
    else 'O'
  end;
  loop
    v_code := v_prefix || lpad(v_seq::text, 6, '0');
    exit when not exists (
      select 1
      from private.finance_membership_org_versions_v1 version_row
      cross join lateral jsonb_array_elements(version_row.snapshot -> 'units') unit_row
      where version_row.tenant_id = (v_actor ->> 'tenant_id')::uuid
        and upper(unit_row ->> 'code') = v_code
    ) and not exists (
      select 1 from public.finance_department_units department_row
      where department_row.tenant_id = (v_actor ->> 'tenant_id')::uuid
        and upper(department_row.code) = v_code
    );
    v_seq := v_seq + 1;
    if v_seq > 999999 then raise exception '單位代碼已用盡' using errcode = '54000'; end if;
  end loop;
  return jsonb_build_object(
    'ok', true,
    'code', v_code,
    'unit_type', lower(btrim(p_unit_type)),
    'entity_code', nullif(upper(btrim(coalesce(p_entity_code, ''))), '')
  );
end;
$function$;

do $seed$
declare
  tenant_row record;
  v_snapshot jsonb;
  v_validation jsonb;
  v_id uuid;
begin
  for tenant_row in
    select distinct user_row.tenant_id
    from public.finance_users user_row
    where user_row.tenant_id is not null
  loop
    v_snapshot := private.finance_membership_org_seed_snapshot_v1(tenant_row.tenant_id);
    v_validation := private.finance_membership_org_validate_v1(tenant_row.tenant_id, v_snapshot);
    if not coalesce((v_validation ->> 'ok')::boolean, false) then
      raise exception '既有正式組織無法安全建立初始版本（tenant %）：%',
        tenant_row.tenant_id, v_validation -> 'errors';
    end if;
    v_id := gen_random_uuid();
    insert into private.finance_membership_org_versions_v1(
      id, tenant_id, version_no, status, title, reason, snapshot,
      revision, etag, validation_summary, impact_summary,
      effective_at, created_by_finance_user_id,
      approved_by_finance_user_id, published_at
    ) values (
      v_id, tenant_row.tenant_id, 1, 'published', '既有正式組織基準',
      '由目前正式部門、任職與主管資料建立初始版本', v_snapshot,
      1, private.finance_membership_org_etag_v1(v_snapshot, 1), v_validation, '{}'::jsonb,
      clock_timestamp(), 'migration_20260821150000',
      'migration_20260821150000', clock_timestamp()
    );
  end loop;
end;
$seed$;

alter function private.finance_membership_org_etag_v1(jsonb,bigint) owner to postgres;
alter function private.finance_membership_org_role_label_v1(text) owner to postgres;
alter function private.finance_membership_org_seed_snapshot_v1(uuid) owner to postgres;
alter function private.finance_membership_org_departments_v1(uuid,jsonb) owner to postgres;
alter function private.finance_membership_org_supervisor_v1(jsonb,text,text) owner to postgres;
alter function private.finance_membership_org_validate_v1(uuid,jsonb) owner to postgres;
alter function private.finance_membership_org_impact_v1(jsonb,jsonb) owner to postgres;
alter function private.finance_membership_org_version_payload_v1(uuid) owner to postgres;
alter function private.finance_membership_org_actor_v1(boolean,boolean) owner to postgres;
alter function private.finance_membership_org_graph_v1(uuid,jsonb) owner to postgres;
alter function private.finance_membership_org_publish_projection_v1(uuid,jsonb,uuid) owner to postgres;

revoke all on function private.finance_membership_org_etag_v1(jsonb,bigint) from public, anon, authenticated, service_role;
revoke all on function private.finance_membership_org_role_label_v1(text) from public, anon, authenticated, service_role;
revoke all on function private.finance_membership_org_seed_snapshot_v1(uuid) from public, anon, authenticated, service_role;
revoke all on function private.finance_membership_org_departments_v1(uuid,jsonb) from public, anon, authenticated, service_role;
revoke all on function private.finance_membership_org_supervisor_v1(jsonb,text,text) from public, anon, authenticated, service_role;
revoke all on function private.finance_membership_org_validate_v1(uuid,jsonb) from public, anon, authenticated, service_role;
revoke all on function private.finance_membership_org_impact_v1(jsonb,jsonb) from public, anon, authenticated, service_role;
revoke all on function private.finance_membership_org_version_payload_v1(uuid) from public, anon, authenticated, service_role;
revoke all on function private.finance_membership_org_actor_v1(boolean,boolean) from public, anon, authenticated, service_role;
revoke all on function private.finance_membership_org_graph_v1(uuid,jsonb) from public, anon, authenticated, service_role;
revoke all on function private.finance_membership_org_publish_projection_v1(uuid,jsonb,uuid) from public, anon, authenticated, service_role;

alter function public.membership_org_get_published_graph() owner to postgres;
alter function public.membership_org_list_people() owner to postgres;
alter function public.membership_org_create_draft(text,text,timestamptz,uuid) owner to postgres;
alter function public.membership_org_cancel_draft(uuid) owner to postgres;
alter function public.membership_org_get_draft(uuid) owner to postgres;
alter function public.membership_org_save_draft(uuid,text,jsonb,text,text,timestamptz) owner to postgres;
alter function public.membership_org_validate_draft(uuid) owner to postgres;
alter function public.membership_org_submit_draft(uuid) owner to postgres;
alter function public.membership_org_publish_draft(uuid,timestamptz) owner to postgres;
alter function public.membership_org_reject_draft(uuid,text) owner to postgres;
alter function public.membership_org_cancel_scheduled(uuid) owner to postgres;
alter function public.membership_org_list_versions(integer) owner to postgres;
alter function public.membership_org_create_rollback_draft(uuid,text) owner to postgres;
alter function public.membership_org_suggest_unit_code(text,text) owner to postgres;

revoke all on function public.membership_org_get_published_graph() from public, anon, authenticated, service_role;
revoke all on function public.membership_org_list_people() from public, anon, authenticated, service_role;
revoke all on function public.membership_org_create_draft(text,text,timestamptz,uuid) from public, anon, authenticated, service_role;
revoke all on function public.membership_org_cancel_draft(uuid) from public, anon, authenticated, service_role;
revoke all on function public.membership_org_get_draft(uuid) from public, anon, authenticated, service_role;
revoke all on function public.membership_org_save_draft(uuid,text,jsonb,text,text,timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.membership_org_validate_draft(uuid) from public, anon, authenticated, service_role;
revoke all on function public.membership_org_submit_draft(uuid) from public, anon, authenticated, service_role;
revoke all on function public.membership_org_publish_draft(uuid,timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.membership_org_reject_draft(uuid,text) from public, anon, authenticated, service_role;
revoke all on function public.membership_org_cancel_scheduled(uuid) from public, anon, authenticated, service_role;
revoke all on function public.membership_org_list_versions(integer) from public, anon, authenticated, service_role;
revoke all on function public.membership_org_create_rollback_draft(uuid,text) from public, anon, authenticated, service_role;
revoke all on function public.membership_org_suggest_unit_code(text,text) from public, anon, authenticated, service_role;

grant execute on function public.membership_org_get_published_graph() to authenticated, service_role;
grant execute on function public.membership_org_list_people() to authenticated, service_role;
grant execute on function public.membership_org_create_draft(text,text,timestamptz,uuid) to authenticated, service_role;
grant execute on function public.membership_org_cancel_draft(uuid) to authenticated, service_role;
grant execute on function public.membership_org_get_draft(uuid) to authenticated, service_role;
grant execute on function public.membership_org_save_draft(uuid,text,jsonb,text,text,timestamptz) to authenticated, service_role;
grant execute on function public.membership_org_validate_draft(uuid) to authenticated, service_role;
grant execute on function public.membership_org_submit_draft(uuid) to authenticated, service_role;
grant execute on function public.membership_org_publish_draft(uuid,timestamptz) to authenticated, service_role;
grant execute on function public.membership_org_reject_draft(uuid,text) to authenticated, service_role;
grant execute on function public.membership_org_cancel_scheduled(uuid) to authenticated, service_role;
grant execute on function public.membership_org_list_versions(integer) to authenticated, service_role;
grant execute on function public.membership_org_create_rollback_draft(uuid,text) to authenticated, service_role;
grant execute on function public.membership_org_suggest_unit_code(text,text) to authenticated, service_role;

do $postflight$
declare
  v_count integer;
begin
  if encode(extensions.digest(
       pg_get_functiondef('public.finance_publish_department_settings_atomic(jsonb,bigint)'::regprocedure),
       'sha256'
     ), 'hex') <> '1f5f83f8e5621f344f4b685ae27729ddae7ee596fd956a74bd9760b7d257fec3'
     or encode(extensions.digest(
       pg_get_functiondef('public.save_finance_org_chart_rows(jsonb)'::regprocedure),
       'sha256'
     ), 'hex') <> 'e0846760b51ecf6f057b95300cc477d3999f648642226d9edcc1438910dec5cb'
     or encode(extensions.digest(
       pg_get_functiondef('public.finance_assert_department_settings(jsonb,uuid)'::regprocedure),
       'sha256'
     ), 'hex') <> '3990bcf0949fe792fffeb3206f0975d364a65feb4b5a11c405b12a8f2aee0cde' then
    raise exception 'Versioned organization changed prerequisite definitions';
  end if;
  if to_regclass('private.finance_membership_org_versions_v1') is null then
    raise exception 'Versioned organization table missing after migration';
  end if;
  select count(*) into v_count
  from pg_proc proc_row
  join pg_namespace namespace_row on namespace_row.oid = proc_row.pronamespace
  where namespace_row.nspname = 'public'
    and proc_row.proname like 'membership_org_%';
  if v_count <> 14 then
    raise exception 'Expected exactly 14 membership_org public functions, found %', v_count;
  end if;
  if exists (
    select 1
    from pg_proc proc_row
    join pg_namespace namespace_row on namespace_row.oid = proc_row.pronamespace
    where namespace_row.nspname = 'public'
      and proc_row.proname like 'membership_org_%'
      and (
        not proc_row.prosecdef
        or coalesce(proc_row.proconfig, '{}'::text[]) <> array['search_path=""']::text[]
        or exists (
          select 1 from aclexplode(coalesce(proc_row.proacl, acldefault('f', proc_row.proowner))) acl
          where acl.privilege_type = 'EXECUTE'
            and acl.grantee in (0, (select oid from pg_roles where rolname = 'anon'))
        )
      )
  ) then
    raise exception 'Versioned organization public function security contract failed';
  end if;
  if exists (
    select tenant_id
    from private.finance_membership_org_versions_v1
    where status = 'published'
    group by tenant_id having count(*) <> 1
  ) then
    raise exception 'Every initialized tenant must have exactly one published organization version';
  end if;
end;
$postflight$;

notify pgrst, 'reload schema';
