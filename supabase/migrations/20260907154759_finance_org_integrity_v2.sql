-- Finance organization integrity v2. Apply inside one release transaction.
-- Preserves existing role authorization and all submitted approval snapshots.
-- The rollback backup contains definitions and old org versions, never passwords.
set lock_timeout = '5s';
set statement_timeout = '120s';
create table private.finance_org_integrity_backup_v2(kind text not null,key text not null,payload jsonb not null,primary key(kind,key));
alter table private.finance_org_integrity_backup_v2 enable row level security;
revoke all on private.finance_org_integrity_backup_v2 from public,anon,authenticated,service_role;


do $preflight$
declare r record;
begin
  if to_regprocedure('private.finance_org_runtime_revision_v2(uuid)') is not null then
    raise exception 'organization governance v2 is already installed';
  end if;
  for r in select * from (values
    ('finance_admin_upsert_member_atomic_v1(jsonb,bigint)','3b7d375406107d9904637d5938c767e9ec3e5b32f30c3ee4d84a237dadf2837e'),
    ('private.finance_membership_org_graph_v1(uuid,jsonb)','93d9c3c5d384357fc7bd08ff99ef5d61ea6a4b25cf79e9fd3a508413de1f6a1c'),
    ('private.finance_membership_org_publish_projection_v1(uuid,jsonb,uuid)','333487ff134b28361d04672a7d684794c8ab4cc37bec54e324069fa7d4c85b65'),
    ('private.finance_membership_org_seed_snapshot_v1(uuid)','97b049ecdfa81d6f3060cc8d4a032469d37bf201703bd52a66c5d4270e9da891'),
    ('private.finance_membership_org_supervisor_v1(jsonb,text,text)','6c92deb5200a66c9c73704bfa4452a8e230f618461efecab638cbff776071071'),
    ('private.finance_membership_org_validate_v1(uuid,jsonb)','c09929abf28d281b2d73721b1ec47c6f88bb8f74cf7c76ccd8f474d67359101c'),
    ('finance_org_chart_rows_for_tenant(uuid)','606c80cf7dec142389ccabc441055bac751c2b2f8d560b41d2ebc752940c5032'),
    ('finance_save_org_chart_atomic(jsonb,text)','b91b5dcf099a41bfe15143e6aa6a142299365a6879c1cddbfa912fe600991895'),
    ('membership_org_create_draft(text,text,timestamp with time zone,uuid)','365497fc66f894713ae328d4db376b182530d402fe00bcb78e0cc5f3830344fa'),
    ('membership_org_publish_draft(uuid,timestamp with time zone)','6a51cb1ada936168d99ab104b51beefac080e8bbfca062f5ddf386da4ff4ba3c'),
    ('save_finance_org_chart_rows(jsonb)','e0846760b51ecf6f057b95300cc477d3999f648642226d9edcc1438910dec5cb'),
    ('private.finance_membership_org_departments_v1(uuid,jsonb)','76a5c453f2abdfa48b28bebba09226fc696ae0a96ee724b2815f3d97cb97a4be')
  ) expected(signature,hash) loop
    if to_regprocedure(r.signature) is null or encode(extensions.digest(
      pg_get_functiondef(to_regprocedure(r.signature)), 'sha256'), 'hex') <> r.hash then
      raise exception 'Organization prerequisite drift: %', r.signature;
    end if;
    insert into private.finance_org_integrity_backup_v2 values('function',r.signature,jsonb_build_object('definition',pg_get_functiondef(to_regprocedure(r.signature))));
  end loop;
  if not exists(select 1 from pg_trigger where tgrelid='private.finance_membership_org_versions_v1'::regclass and tgname='finance_membership_org_versions_edoc_v2' and not tgisinternal and tgenabled<>'D') then
    raise exception 'Organization publication outbox trigger is missing';
  end if;
end;
$preflight$;

create or replace function private.finance_org_effective_now_v2(p_row jsonb,p_at timestamptz default statement_timestamp())
returns boolean language plpgsql stable set search_path = '' as $fn$
declare v_start timestamptz; v_end timestamptz; v_end_text text;
begin
  if not coalesce((p_row->>'active')::boolean,true) then return false; end if;
  v_start := case when nullif(p_row->>'effective_from','') ~ '^\d{4}-\d{2}-\d{2}$' then (p_row->>'effective_from')::date::timestamp at time zone 'Asia/Taipei' else nullif(p_row->>'effective_from','')::timestamptz end;
  v_end_text := nullif(p_row->>'effective_to','');
  if v_end_text ~ '^\d{4}-\d{2}-\d{2}$' then
    v_end := (v_end_text::date + 1)::timestamp at time zone 'Asia/Taipei';
  else v_end := v_end_text::timestamptz; end if;
  return (v_start is null or v_start <= p_at) and (v_end is null or p_at < v_end);
exception when invalid_datetime_format or datetime_field_overflow or invalid_text_representation then
  return false;
end;
$fn$;

create or replace function private.finance_org_runtime_revision_v2(p_tenant_id uuid)
returns text language sql stable security definer set search_path='' as $fn$
  select encode(extensions.digest(jsonb_build_object(
    
    'people',(select coalesce(jsonb_agg(jsonb_build_object('id',u.id,'role',u.role,'active',u.active,'department',u.department_code,'entity',u.entity_id,'revision',u.member_revision) order by u.id),'[]'::jsonb) from public.finance_users u where u.tenant_id=p_tenant_id),
    'roles',(select coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]'::jsonb) from public.employee_department_roles r where r.tenant_id=p_tenant_id),
    'departments',(select coalesce(jsonb_agg(jsonb_build_object('key',s.key,'value',s.value) order by s.key),'[]'::jsonb) from public.system_settings s where s.tenant_id=p_tenant_id and s.key in ('departments','entities'))
  )::text,'sha256'),'hex')
$fn$;

alter table private.finance_membership_org_versions_v1 add column source_runtime_revision text;
insert into private.finance_org_integrity_backup_v2 select 'published_version',tenant_id::text,to_jsonb(v) from private.finance_membership_org_versions_v1 v where status='published';


create or replace function private.finance_membership_org_supervisor_v1(p_snapshot jsonb,p_finance_user_id text,p_org_unit_id text)
returns text language plpgsql stable security definer set search_path='' as $fn$
declare v_tenant uuid; v_target text; v_unit text:=p_org_unit_id; v_seen text[]:='{}'; v_count integer; v_has_head boolean;
begin
  select u.tenant_id into v_tenant from public.finance_users u where u.id=p_finance_user_id and u.active=true;
  if v_tenant is null then return null; end if;
  select count(*),min(r->>'supervisor_finance_user_id') into v_count,v_target
  from jsonb_array_elements(coalesce(p_snapshot->'reporting_overrides','[]'::jsonb))r
  where r->>'finance_user_id'=p_finance_user_id and private.finance_org_effective_now_v2(r);
  if v_count>1 then raise exception '同一人有多筆同時生效的主管例外，請先修正' using errcode='23514'; end if;
  if v_count=1 then
    if v_target=p_finance_user_id or not exists(select 1 from public.finance_users u where u.id=v_target and u.tenant_id=v_tenant and u.active=true) then
      raise exception '指定的例外主管尚未具備有效簽核資格；請修正或指定正式代理人' using errcode='23514';
    end if;
    return v_target;
  end if;
  while nullif(v_unit,'') is not null loop
    if v_unit=any(v_seen) or cardinality(v_seen)>=64 then raise exception '組織主管鏈形成循環' using errcode='23514'; end if;
    v_seen:=array_append(v_seen,v_unit);
    select exists(select 1 from jsonb_array_elements(coalesce(p_snapshot->'assignments','[]'::jsonb))a
      where a->>'org_unit_id'=v_unit and a->>'finance_user_id'<>p_finance_user_id
        and coalesce((a->>'active')::boolean,true) and a->>'head_kind' in ('permanent','acting')) into v_has_head;
    select a->>'finance_user_id' into v_target
    from jsonb_array_elements(coalesce(p_snapshot->'assignments','[]'::jsonb))a
    where a->>'org_unit_id'=v_unit and a->>'finance_user_id'<>p_finance_user_id
      and a->>'head_kind' in ('permanent','acting') and private.finance_org_effective_now_v2(a)
      and coalesce((a->>'can_approve')::boolean,false)
      and exists(select 1 from public.finance_users u where u.tenant_id=v_tenant and u.id=a->>'finance_user_id' and u.active=true)
    order by case a->>'head_kind' when 'permanent' then 0 else 1 end limit 1;
    if v_target is not null then return v_target; end if;
    if v_has_head then raise exception '組織主管已到期、停用或不可簽核；請指定有效主管／代理人，不會改派其他角色' using errcode='23514'; end if;
    select nullif(u->>'parent_org_unit_id','') into v_unit
    from jsonb_array_elements(coalesce(p_snapshot->'units','[]'::jsonb))u where u->>'id'=v_unit and coalesce((u->>'active')::boolean,true);
  end loop;
  return null;
end;
$fn$;

CREATE OR REPLACE FUNCTION private.finance_membership_org_seed_snapshot_v1(p_tenant_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_shareholders_id uuid := md5(p_tenant_id::text||':org-shareholders-v2')::uuid;
  v_board_id uuid := md5(p_tenant_id::text||':org-board-v2')::uuid;
  v_executive_id uuid := md5(p_tenant_id::text||':org-executive-v2')::uuid;
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
      'role_key', role_row.role_key,
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
      'effective_from', coalesce(role_row.metadata #>> '{org_effective_period,effective_from}',role_row.effective_from::text),
      'effective_to', case when role_row.metadata->'org_effective_period' ? 'effective_to' then role_row.metadata #>> '{org_effective_period,effective_to}' else role_row.effective_to::text end,
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
      and exists(select 1 from public.finance_users person where person.tenant_id=p_tenant_id and person.id=source_role.finance_user_id and person.active=true)
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
      'effective_from', coalesce(role_row.metadata #>> '{org_effective_period,effective_from}',role_row.effective_from::text),
      'effective_to', case when role_row.metadata->'org_effective_period' ? 'effective_to' then role_row.metadata #>> '{org_effective_period,effective_to}' else role_row.effective_to::text end,
      'active', role_row.active,
      'metadata', jsonb_build_object('seed_source', 'employee_department_roles')
    ) order by role_row.finance_user_id, role_row.id
  ), '[]'::jsonb)
    into v_overrides
  from public.employee_department_roles role_row
  where role_row.tenant_id = p_tenant_id
    and role_row.active = true
    and role_row.is_primary = true
    and role_row.direct_supervisor_finance_user_id is not null
    and exists(select 1 from public.finance_users person where person.tenant_id=p_tenant_id and person.id=role_row.finance_user_id and person.active=true);

  -- Preserve dated overrides projected by an organization version until a
  -- supervisor editor explicitly changes that person's relationship.
  select coalesce(jsonb_agg(override_item),'[]'::jsonb) into v_overrides from (
    select override_item from jsonb_array_elements(v_overrides) override_item
    where not exists(select 1 from public.employee_department_roles role_row
      where role_row.tenant_id=p_tenant_id and role_row.is_primary and role_row.active
        and role_row.finance_user_id=override_item->>'finance_user_id'
        and jsonb_typeof(role_row.metadata->'org_reporting_overrides')='array'
        and role_row.direct_supervisor_finance_user_id is not distinct from role_row.metadata->>'org_projected_supervisor_id')
    union all
    select override_item from public.employee_department_roles role_row
    cross join lateral jsonb_array_elements(coalesce(role_row.metadata->'org_reporting_overrides','[]'::jsonb)) override_item
    where role_row.tenant_id=p_tenant_id and role_row.is_primary and role_row.active
      and role_row.direct_supervisor_finance_user_id is not distinct from role_row.metadata->>'org_projected_supervisor_id'
      and exists(select 1 from public.finance_users u where u.tenant_id=p_tenant_id and u.id=role_row.finance_user_id and u.active)
  ) overrides;
  return jsonb_build_object(
    'schema_version', 2,
    'units', v_units,
    'assignments', v_assignments || v_governance_assignments,
    'reporting_overrides', v_overrides
  );
end;
$function$;

CREATE OR REPLACE FUNCTION private.finance_membership_org_validate_v1(p_tenant_id uuid, p_snapshot jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    where coalesce((assignment ->> 'active')::boolean,true) and (nullif(assignment ->> 'id', '') is null
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
       ))
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
    where private.finance_org_effective_now_v2(assignment)
      and assignment ->> 'head_kind' in ('permanent', 'acting')
    group by assignment ->> 'org_unit_id', assignment ->> 'head_kind'
    having count(*) > 1
  ) then
    v_errors := array_append(v_errors, '同一單位只能有一位正主管與一位代理主管');
  end if;

  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_snapshot -> 'reporting_overrides', '[]'::jsonb)) override_row
    where coalesce((override_row ->> 'active')::boolean,true) and (override_row ->> 'finance_user_id' = override_row ->> 'supervisor_finance_user_id'
       or not exists (
         select 1 from public.finance_users fu
         where fu.tenant_id = p_tenant_id and fu.active = true
           and fu.id = override_row ->> 'finance_user_id'
       )
       or not exists (
         select 1 from public.finance_users fu
         where fu.tenant_id = p_tenant_id and fu.active = true
           and fu.id = override_row ->> 'supervisor_finance_user_id'
       ))
  ) then
    v_errors := array_append(v_errors, '直屬主管例外的人員不存在或指向自己');
  end if;

  if exists(select 1 from jsonb_array_elements(p_snapshot->'assignments') a
    where coalesce((a->>'active')::boolean,true) and lower(coalesce(a->>'assignment_kind','secondary'))='primary'
      and not private.finance_org_effective_now_v2(a)) then
    v_errors:=array_append(v_errors,'主要任職必須目前已生效且未到期；預約調任請在生效日發布，不會提前變更主管');
  end if;
  if exists (
    select 1 from jsonb_array_elements((p_snapshot->'assignments')||coalesce(p_snapshot->'reporting_overrides','[]')) item
    where coalesce((item->>'active')::boolean,true) and nullif(item->>'effective_from','') is not null
      and nullif(item->>'effective_to','') is not null
      and (item->>'effective_from')::timestamptz > (item->>'effective_to')::timestamptz
  ) then v_errors:=array_append(v_errors,'生效時間不可晚於到期時間'); end if;
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

CREATE OR REPLACE FUNCTION private.finance_membership_org_departments_v1(p_tenant_id uuid, p_snapshot jsonb)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
          and private.finance_org_effective_now_v2(assignment)
          and exists(select 1 from public.finance_users signer where signer.tenant_id=p_tenant_id and signer.id=assignment->>'finance_user_id' and signer.active=true)
          and public.finance_org_signer_is_runtime_ready(p_tenant_id,assignment->>'finance_user_id')
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
          and private.finance_org_effective_now_v2(assignment)
          and exists(select 1 from public.finance_users signer where signer.tenant_id=p_tenant_id and signer.id=assignment->>'finance_user_id' and signer.active=true)
          and public.finance_org_signer_is_runtime_ready(p_tenant_id,assignment->>'finance_user_id')
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

CREATE OR REPLACE FUNCTION public.save_finance_org_chart_rows(p_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_actor text := public.current_finance_user_id();
  v_rows jsonb := coalesce(p_rows, '[]'::jsonb);
  v_stage jsonb := '[]'::jsonb;
  v_input_count int := 0;
  v_stage_count int := 0;
  v_touched int := 0;
  v_has_cycle boolean := false;
begin
  if auth.uid() is not null
     and coalesce(public.current_finance_role(), '') not in ('ceo', 'admin_director', 'hr')
     and not coalesce(public.is_finance_admin(), false) then
    raise exception 'Only Finance administrators can update organization chart roles'
      using errcode = '42501';
  end if;

  if jsonb_typeof(v_rows) <> 'array' then
    raise exception 'organization chart rows must be a JSON array'
      using errcode = '22023';
  end if;

  v_input_count := jsonb_array_length(v_rows);

  select coalesce(jsonb_agg(to_jsonb(stage_row) order by stage_row.ord), '[]'::jsonb)
    into v_stage
  from (
    select distinct on (fu.id)
      org.ord::int as ord,
      fu.id as finance_user_id,
      coalesce(dept.id, existing_role.department_id) as department_id,
      coalesce(public.finance_jsonb_pick_text(org.item, array['departmentCode', 'department_code', 'dc']), fu.department_code, existing_role.department_code) as department_code,
      coalesce(nullif(fu.role, ''), public.finance_jsonb_pick_text(org.item, array['userRole', 'role', 'role_key']), 'employee') as role_key,
      coalesce(existing_role.role_type, public.finance_jsonb_pick_text(org.item, array['roleType', 'role_type']), 'primary') as role_type,
      case when supervisor.id is not null and supervisor.id <> fu.id then supervisor.id else null end as direct_supervisor_finance_user_id,
      public.finance_jsonb_pick_bool(org.item, array['canApprove', 'can_approve'], coalesce(existing_role.can_approve, true)) as can_approve,
      public.finance_jsonb_pick_bool(org.item, array['isDepartmentManager', 'is_department_manager', 'departmentManager'], coalesce(existing_role.is_department_manager, fu.role = 'dept_manager')) as is_department_manager,
      public.finance_jsonb_pick_bool(org.item, array['isDepartmentDirector', 'is_department_director', 'departmentDirector'], coalesce(existing_role.is_department_director, fu.role in ('admin_director', 'ceo'))) as is_department_director,
      case when delegatee.id is not null and delegatee.id <> fu.id then delegatee.id else null end as approval_delegate_finance_user_id,
      existing_role.id as existing_role_id,
      coalesce(existing_role.permissions_override, '{}'::jsonb) as permissions_override,
      coalesce(existing_role.metadata, '{}'::jsonb) as metadata,
      org.item as source_payload
    from jsonb_array_elements(v_rows) with ordinality as org(item, ord)
    join public.finance_users fu
      on fu.tenant_id = v_tenant_id
     and fu.active = true
     and (
        fu.id = public.finance_jsonb_pick_text(org.item, array['userId', 'finance_user_id', 'financeUserId', 'id'])
        or (
          nullif(public.finance_jsonb_pick_text(org.item, array['userEmail', 'email']), '') is not null
          and lower(fu.email) = lower(public.finance_jsonb_pick_text(org.item, array['userEmail', 'email']))
        )
        or (
          nullif(public.finance_jsonb_pick_text(org.item, array['userName', 'name']), '') is not null
          and fu.name = public.finance_jsonb_pick_text(org.item, array['userName', 'name'])
          and coalesce(public.finance_jsonb_pick_text(org.item, array['userRole', 'role']), fu.role, '') = coalesce(fu.role, '')
        )
     )
    left join lateral (
      select edr.*
      from public.employee_department_roles edr
      where edr.tenant_id = v_tenant_id
        and edr.finance_user_id = fu.id
        and edr.is_primary = true
      order by edr.active desc, edr.updated_at desc nulls last, edr.created_at desc nulls last, edr.id asc
      limit 1
    ) existing_role on true
    left join lateral (
      select d.id
      from public.departments d
      where d.deleted_at is null
        and d.code = coalesce(public.finance_jsonb_pick_text(org.item, array['departmentCode', 'department_code', 'dc']), fu.department_code, existing_role.department_code)
      order by d.created_at asc nulls last, d.id asc
      limit 1
    ) dept on true
    left join lateral (
      select su.*
      from public.finance_users su
      where su.tenant_id = v_tenant_id
        and su.active = true
        and (
          su.id = public.finance_jsonb_pick_text(org.item, array['supervisorId', 'supervisor_finance_user_id', 'direct_supervisor_finance_user_id'])
          or (
            nullif(public.finance_jsonb_pick_text(org.item, array['supervisorEmail', 'supervisor_email']), '') is not null
            and lower(su.email) = lower(public.finance_jsonb_pick_text(org.item, array['supervisorEmail', 'supervisor_email']))
          )
          or (
            nullif(public.finance_jsonb_pick_text(org.item, array['supervisorName', 'supervisor_name']), '') is not null
            and su.name = public.finance_jsonb_pick_text(org.item, array['supervisorName', 'supervisor_name'])
            and coalesce(public.finance_jsonb_pick_text(org.item, array['supervisorRole', 'supervisor_role']), su.role, '') = coalesce(su.role, '')
          )
        )
      order by
        case when su.id = public.finance_jsonb_pick_text(org.item, array['supervisorId', 'supervisor_finance_user_id', 'direct_supervisor_finance_user_id']) then 0 else 1 end,
        case when lower(su.email) = lower(coalesce(public.finance_jsonb_pick_text(org.item, array['supervisorEmail', 'supervisor_email']), '')) then 0 else 1 end,
        su.id asc
      limit 1
    ) supervisor on true
    left join lateral (
      select du.*
      from public.finance_users du
      where du.tenant_id = v_tenant_id
        and du.active = true
        and (
          du.id = public.finance_jsonb_pick_text(org.item, array['approvalDelegateId', 'approval_delegate_finance_user_id', 'delegateId', 'delegate_finance_user_id'])
          or (
            nullif(public.finance_jsonb_pick_text(org.item, array['approvalDelegateEmail', 'delegateEmail', 'delegate_email']), '') is not null
            and lower(du.email) = lower(public.finance_jsonb_pick_text(org.item, array['approvalDelegateEmail', 'delegateEmail', 'delegate_email']))
          )
        )
      order by
        case when du.id = public.finance_jsonb_pick_text(org.item, array['approvalDelegateId', 'approval_delegate_finance_user_id', 'delegateId', 'delegate_finance_user_id']) then 0 else 1 end,
        du.id asc
      limit 1
    ) delegatee on true
    order by fu.id, org.ord
  ) stage_row;

  v_stage_count := jsonb_array_length(v_stage);

  if exists (
    select 1
    from jsonb_to_recordset(v_stage) as s(
      finance_user_id text,
      direct_supervisor_finance_user_id text
    )
    where s.finance_user_id = s.direct_supervisor_finance_user_id
  ) then
    raise exception 'direct supervisor cannot be the same user'
      using errcode = '22023';
  end if;

  with recursive stage_rows as (
    select *
    from jsonb_to_recordset(v_stage) as s(
      finance_user_id text,
      direct_supervisor_finance_user_id text
    )
  ), chain(root_id, current_id, path, cycle) as (
    select
      s.finance_user_id,
      s.direct_supervisor_finance_user_id,
      array[s.finance_user_id],
      false
    from stage_rows s
    where s.direct_supervisor_finance_user_id is not null
    union all
    select
      c.root_id,
      s.direct_supervisor_finance_user_id,
      c.path || s.finance_user_id,
      s.finance_user_id = any(c.path)
    from chain c
    join stage_rows s
      on s.finance_user_id = c.current_id
    where c.current_id is not null
      and not c.cycle
      and array_length(c.path, 1) < 64
  )
  select exists (
    select 1
    from chain
    where cycle
       or current_id = root_id
  )
  into v_has_cycle;

  if v_has_cycle then
    raise exception 'organization chart cannot contain supervisor cycles'
      using errcode = '22023';
  end if;

  with stage_rows as (
    select *
    from jsonb_to_recordset(v_stage) as s(
      existing_role_id text,
      finance_user_id text,
      department_id uuid,
      department_code text,
      role_key text,
      role_type text,
      direct_supervisor_finance_user_id text,
      can_approve boolean,
      is_department_manager boolean,
      is_department_director boolean,
      approval_delegate_finance_user_id text,
      permissions_override jsonb,
      metadata jsonb,
      source_payload jsonb
    )
  )
  insert into public.employee_department_roles (
    id,
    tenant_id,
    finance_user_id,
    department_id,
    department_code,
    position_id,
    role_key,
    role_type,
    relation_type,
    is_primary,
    effective_from,
    effective_to,
    active,
    direct_supervisor_finance_user_id,
    is_department_manager,
    is_department_director,
    can_approve,
    approval_delegate_finance_user_id,
    permissions_override,
    metadata
  )
  select
    coalesce(s.existing_role_id, public.finance_stable_setting_id('edr_primary', s.finance_user_id)),
    v_tenant_id,
    s.finance_user_id,
    s.department_id,
    s.department_code,
    null,
    coalesce(nullif(s.role_key, ''), 'employee'),
    coalesce(nullif(s.role_type, ''), 'primary'),
    'primary',
    true,
    coalesce((nullif(s.source_payload->>'effective_from','')::timestamptz at time zone 'Asia/Taipei')::date,(statement_timestamp() at time zone 'Asia/Taipei')::date),
    (nullif(s.source_payload->>'effective_to','')::timestamptz at time zone 'Asia/Taipei')::date,
    true,
    s.direct_supervisor_finance_user_id,
    coalesce(s.is_department_manager, false),
    coalesce(s.is_department_director, false),
    coalesce(s.can_approve, true),
    s.approval_delegate_finance_user_id,
    coalesce(s.permissions_override, '{}'::jsonb),
    (case when not (s.source_payload ? 'sourceVersionId') and s.metadata ? 'org_projected_supervisor_id' and s.direct_supervisor_finance_user_id is distinct from s.metadata->>'org_projected_supervisor_id' then coalesce(s.metadata,'{}'::jsonb) - array['org_reporting_overrides','org_projected_supervisor_id'] else coalesce(s.metadata,'{}'::jsonb) end)
      || jsonb_build_object(
        'source', 'employee_department_roles.canonical_org_chart',
        'source_payload', coalesce(s.source_payload, '{}'::jsonb),
        'org_effective_period',coalesce(s.metadata->'org_effective_period','{}'::jsonb) || (case when s.source_payload ? 'effective_from' then jsonb_build_object('effective_from',s.source_payload->'effective_from') else '{}'::jsonb end) || (case when s.source_payload ? 'effective_to' then jsonb_build_object('effective_to',s.source_payload->'effective_to') else '{}'::jsonb end),
        'last_org_chart_saved_at', now(),
        'saved_by_finance_user_id', v_actor,
        'lint_safe_repair', '20260704051725_org_chart_save_lint_safe_repair'
      )
  from stage_rows s
  on conflict (id) do update
  set department_id = excluded.department_id,
      department_code = excluded.department_code,
      position_id = excluded.position_id,
      role_key = excluded.role_key,
      role_type = excluded.role_type,
      relation_type = excluded.relation_type,
      is_primary = true,
      effective_from = case when excluded.metadata->'source_payload' ? 'effective_from' then excluded.effective_from else public.employee_department_roles.effective_from end,
      effective_to = case when excluded.metadata->'source_payload' ? 'effective_to' then excluded.effective_to else public.employee_department_roles.effective_to end,
      active = true,
      direct_supervisor_finance_user_id = excluded.direct_supervisor_finance_user_id,
      is_department_manager = excluded.is_department_manager,
      is_department_director = excluded.is_department_director,
      can_approve = excluded.can_approve,
      approval_delegate_finance_user_id = excluded.approval_delegate_finance_user_id,
      permissions_override = coalesce(public.employee_department_roles.permissions_override, '{}'::jsonb),
      metadata = excluded.metadata,
      updated_at = now();

  get diagnostics v_touched = row_count;

  return jsonb_build_object(
    'ok', true,
    'canonical_source', 'employee_department_roles',
    'lint_safe_repair', '20260704051725_org_chart_save_lint_safe_repair',
    'input_count', v_input_count,
    'resolved_count', v_stage_count,
    'ignored_count', greatest(v_input_count - v_stage_count, 0),
    'employee_roles_touched', v_touched,
    'rows', public.finance_org_chart_rows_for_tenant(v_tenant_id),
    'tenant_id', v_tenant_id,
    'saved_at', now()
  );
end;
$function$;

CREATE OR REPLACE FUNCTION private.finance_membership_org_publish_projection_v1(p_tenant_id uuid, p_snapshot jsonb, p_version_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  v_control_roles jsonb;
begin
  select coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]'::jsonb) into v_control_roles
  from public.employee_department_roles r where r.tenant_id=p_tenant_id and not r.is_primary and (r.role_key in ('cashier','accountant','external_audit') or r.role_key is distinct from (select u.role from public.finance_users u where u.tenant_id=r.tenant_id and u.id=r.finance_user_id));
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
      'sourceVersionId', p_version_id,
      'effective_from', assignment_row.assignment ->> 'effective_from',
      'effective_to', assignment_row.assignment ->> 'effective_to'
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
  set metadata=coalesce(role_row.metadata,'{}'::jsonb)||jsonb_build_object(
    'org_projected_supervisor_id',role_row.direct_supervisor_finance_user_id,
    'org_reporting_overrides',coalesce((select jsonb_agg(o) from jsonb_array_elements(coalesce(p_snapshot->'reporting_overrides','[]')) o where o->>'finance_user_id'=role_row.finance_user_id),'[]'::jsonb))
  where role_row.tenant_id=p_tenant_id and role_row.is_primary and role_row.active;

  update public.employee_department_roles role_row
  set active = false,
      effective_to = coalesce(role_row.effective_to, current_date),
      updated_at = clock_timestamp(),
      metadata = coalesce(role_row.metadata, '{}'::jsonb)
        || jsonb_build_object('disabled_by_org_version_id', p_version_id)
  where role_row.tenant_id = p_tenant_id
    and role_row.is_primary = false
    and role_row.role_key not in ('cashier','accountant','external_audit') and role_row.role_key is not distinct from (select u.role from public.finance_users u where u.tenant_id=role_row.tenant_id and u.id=role_row.finance_user_id)
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
      and not exists(select 1 from public.employee_department_roles preserved
        where preserved.tenant_id=p_tenant_id and not preserved.is_primary
          and preserved.id=assignment_row.assignment_id
          and (preserved.role_key in ('cashier','accountant','external_audit') or preserved.role_key is distinct from (select u.role from public.finance_users u where u.tenant_id=preserved.tenant_id and u.id=preserved.finance_user_id)))
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
         coalesce((nullif(source_row.assignment ->> 'effective_from', '')::timestamptz at time zone 'Asia/Taipei')::date, current_date),
         (nullif(source_row.assignment ->> 'effective_to', '')::timestamptz at time zone 'Asia/Taipei')::date,
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
             'position_code', source_row.position_code,
             'org_effective_period',jsonb_build_object('effective_from',source_row.assignment->'effective_from','effective_to',source_row.assignment->'effective_to')
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
      entity_id = user_row.entity_id,
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

  if v_control_roles is distinct from (select coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]'::jsonb)
    from public.employee_department_roles r where r.tenant_id=p_tenant_id and not r.is_primary and (r.role_key in ('cashier','accountant','external_audit') or r.role_key is distinct from (select u.role from public.finance_users u where u.tenant_id=r.tenant_id and u.id=r.finance_user_id))) then
    raise exception '組織發布不得變更獨立出納／會計控制角色，交易已取消' using errcode='23514';
  end if;
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

create or replace function private.finance_org_snapshot_from_runtime_v2(p_tenant_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $fn$
declare
  v_previous private.finance_membership_org_versions_v1%rowtype;
  v_seed jsonb; v_snapshot jsonb; v_units jsonb; v_assignments jsonb;
begin
  select * into v_previous from private.finance_membership_org_versions_v1
    where tenant_id=p_tenant_id and status='published';
  v_seed:=private.finance_membership_org_seed_snapshot_v1(p_tenant_id);
  -- Preserve designed hierarchy and unit IDs. Direct people edits do not
  -- restructure units; append only genuinely new runtime units.
  select coalesce(jsonb_agg(item),'[]'::jsonb) into v_units from (
    select item || coalesce((select jsonb_build_object('name',runtime_unit->'name','active',runtime_unit->'active','entity_scope_mode',runtime_unit->'entity_scope_mode','entity_codes',runtime_unit->'entity_codes','is_posting_unit',runtime_unit->'is_posting_unit')
      from jsonb_array_elements(v_seed->'units') runtime_unit where upper(runtime_unit->>'code')=upper(item->>'code') and item->>'unit_type' in ('department','section','team')),'{}'::jsonb) as item
    from jsonb_array_elements(coalesce(v_previous.snapshot->'units','[]'::jsonb)) item
    union all
    select item || jsonb_build_object('parent_org_unit_id',coalesce((
      select old_parent->>'id' from jsonb_array_elements(v_seed->'units') seed_parent
      join jsonb_array_elements(coalesce(v_previous.snapshot->'units','[]'::jsonb)) old_parent
        on upper(old_parent->>'code')=upper(seed_parent->>'code')
      where seed_parent->>'id'=item->>'parent_org_unit_id'
    ),item->>'parent_org_unit_id')) from jsonb_array_elements(v_seed->'units') item
    where not exists(select 1 from jsonb_array_elements(coalesce(v_previous.snapshot->'units','[]'::jsonb)) old
      where upper(old->>'code')=upper(item->>'code'))
  ) merged;
  -- Map runtime IDs to canonical unit IDs by unique code.  Existing hierarchy
  -- assignments outside accounting departments remain explicit, never inferred.
  select coalesce(jsonb_agg(a || jsonb_build_object('org_unit_id',u->>'id')),'[]'::jsonb)
    into v_assignments
  from jsonb_array_elements(v_seed->'assignments') a
  join jsonb_array_elements(v_seed->'units') seed_unit on seed_unit->>'id'=a->>'org_unit_id'
  join jsonb_array_elements(v_units) u on upper(u->>'code')=upper(seed_unit->>'code')
  where exists(select 1 from public.finance_users person where person.tenant_id=p_tenant_id
    and person.id=a->>'finance_user_id' and person.active=true)
    and not exists (
      select 1 from jsonb_array_elements(coalesce(v_previous.snapshot->'assignments','[]'::jsonb)) old
      join jsonb_array_elements(v_units) old_unit on old_unit->>'id'=old->>'org_unit_id'
      where old->>'finance_user_id'=a->>'finance_user_id'
        and coalesce(old->>'assignment_kind','secondary')=coalesce(a->>'assignment_kind','secondary')
        and old_unit->>'unit_type' in ('shareholders','board','executive','division')
        and (a->>'assignment_kind'='primary' or upper(old_unit->>'code')=upper(seed_unit->>'code'))
        and private.finance_org_effective_now_v2(old)
    );
  select v_assignments || coalesce(jsonb_agg(a),'[]'::jsonb) into v_assignments
  from jsonb_array_elements(coalesce(v_previous.snapshot->'assignments','[]'::jsonb)) a
  join jsonb_array_elements(v_units) u on u->>'id'=a->>'org_unit_id'
  where u->>'unit_type' in ('shareholders','board','executive','division')
    and private.finance_org_effective_now_v2(a)
    and exists(select 1 from public.finance_users person where person.tenant_id=p_tenant_id
      and person.id=a->>'finance_user_id' and person.active=true);
  v_snapshot:=v_seed || jsonb_build_object('units',v_units,'assignments',v_assignments);
  return v_snapshot;
end;
$fn$;

alter function public.finance_admin_upsert_member_atomic_v1(jsonb,bigint) rename to finance_admin_upsert_member_org_base_v1;
alter function public.finance_admin_upsert_member_org_base_v1(jsonb,bigint) set schema private;
alter function public.finance_save_org_chart_atomic(jsonb,text) rename to finance_save_org_chart_org_base_v1;
alter function public.finance_save_org_chart_org_base_v1(jsonb,text) set schema private;
revoke all on function private.finance_admin_upsert_member_org_base_v1(jsonb,bigint),private.finance_save_org_chart_org_base_v1(jsonb,text) from public,anon,authenticated,service_role;


create or replace function private.finance_org_publish_runtime_v2(p_tenant_id uuid,p_actor text,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare v_previous private.finance_membership_org_versions_v1%rowtype;v_snapshot jsonb;v_validation jsonb;v_new private.finance_membership_org_versions_v1%rowtype;v_next bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended('finance-org-governance:'||p_tenant_id::text,0));
  perform pg_advisory_xact_lock(hashtextextended('membership-org:'||p_tenant_id::text,0));
  select * into v_previous from private.finance_membership_org_versions_v1 where tenant_id=p_tenant_id and status='published' for update;
  v_snapshot:=private.finance_org_snapshot_from_runtime_v2(p_tenant_id);
  v_validation:=private.finance_membership_org_validate_v1(p_tenant_id,v_snapshot);
  if not coalesce((v_validation->>'ok')::boolean,false) then raise exception '正式組織一致性檢查未通過：%',v_validation->'errors' using errcode='23514';end if;
  select coalesce(max(version_no),0)+1 into v_next from private.finance_membership_org_versions_v1 where tenant_id=p_tenant_id;
  update private.finance_membership_org_versions_v1 set status='archived',updated_at=clock_timestamp() where tenant_id=p_tenant_id and status='published';
  insert into private.finance_membership_org_versions_v1(tenant_id,version_no,status,title,reason,snapshot,revision,etag,validation_summary,source_version_id,source_runtime_revision,created_by_finance_user_id,approved_by_finance_user_id,effective_at,published_at)
  values(p_tenant_id,v_next,'published','正式人員與主管關係同步',p_reason,v_snapshot,1,private.finance_membership_org_etag_v1(v_snapshot,1),v_validation,v_previous.id,private.finance_org_runtime_revision_v2(p_tenant_id),p_actor,null,clock_timestamp(),clock_timestamp()) returning * into v_new;
  return jsonb_build_object('org_version_id',v_new.id,'org_version_no',v_new.version_no,'org_etag',v_new.etag);
end;$fn$;

create or replace function public.finance_admin_upsert_member_atomic_v1(p_member jsonb,p_expected_revision bigint default null)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare v_result jsonb;v_tenant uuid:=public.current_tenant_id();
begin
  perform private.finance_membership_org_actor_v1(true,false);
  perform pg_advisory_xact_lock(hashtextextended('finance-org-governance:'||v_tenant::text,0));
  v_result:=private.finance_admin_upsert_member_org_base_v1(p_member,p_expected_revision);
  if not coalesce((v_result->>'ok')::boolean,false) then raise exception '人員異動未完整寫入' using errcode='55000';end if;
  return v_result||private.finance_org_publish_runtime_v2(v_tenant,public.current_finance_user_id(),'人員維護同步正式組織')||jsonb_build_object('org_revision',private.finance_org_runtime_revision_v2(v_tenant));
end;$fn$;

create or replace function public.finance_save_org_chart_atomic(p_rows jsonb,p_summary text default '更新人員主管圖與簽核主管關係')
returns jsonb language plpgsql security definer set search_path='' as $fn$
begin raise exception '主管圖已啟用版本保護，請重新整理頁面再儲存；本次沒有覆蓋資料' using errcode='55000';end;$fn$;

create or replace function public.finance_save_org_chart_versioned_v2(p_rows jsonb,p_expected_revision text,p_summary text default '更新人員主管圖與簽核主管關係')
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare v_result jsonb;v_tenant uuid:=public.current_tenant_id();
begin
  perform private.finance_membership_org_actor_v1(true,false);
  perform pg_advisory_xact_lock(hashtextextended('finance-org-governance:'||v_tenant::text,0));
  if nullif(p_expected_revision,'') is null or p_expected_revision is distinct from private.finance_org_runtime_revision_v2(v_tenant) then raise exception '組織或人員已由其他人變更，請重新載入核對；本次沒有覆蓋資料' using errcode='40001';end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows)=0 then raise exception '主管設定不可空白' using errcode='22023';end if;
  v_result:=private.finance_save_org_chart_org_base_v1(p_rows,p_summary);
  if not coalesce((v_result->>'ok')::boolean,false) then raise exception '主管異動未完整寫入' using errcode='55000';end if;
  return v_result||private.finance_org_publish_runtime_v2(v_tenant,public.current_finance_user_id(),p_summary)||jsonb_build_object('org_revision',private.finance_org_runtime_revision_v2(v_tenant));
end;$fn$;


create or replace function public.finance_org_chart_editor_state_v2()
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare v_tenant uuid:=public.current_tenant_id(); v_actor text:=public.current_finance_user_id();
begin
  if auth.uid() is null or v_tenant is null or nullif(v_actor,'') is null then
    raise exception '請先使用正式公司帳號登入' using errcode='42501';
  end if;
  return jsonb_build_object('ok',true,'source','employee_department_roles',
    'rows',public.finance_org_chart_rows_for_tenant(v_tenant),
    'revision',private.finance_org_runtime_revision_v2(v_tenant));
end;
$fn$;

create or replace function private.finance_org_stamp_draft_runtime_v2()
returns trigger language plpgsql security definer set search_path = ''
as $fn$
begin
  if new.status in ('draft','validated','pending_review','rejected') then
    new.source_runtime_revision := private.finance_org_runtime_revision_v2(new.tenant_id);
  end if;
  return new;
end;
$fn$;

create trigger finance_org_stamp_draft_runtime_v2 before insert on private.finance_membership_org_versions_v1 for each row execute function private.finance_org_stamp_draft_runtime_v2();

CREATE OR REPLACE FUNCTION public.membership_org_create_draft(p_title text, p_reason text, p_effective_at timestamp with time zone DEFAULT clock_timestamp(), p_from_version_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

  perform pg_advisory_xact_lock(hashtextextended('finance-org-governance:' || v_tenant_id::text, 0));
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
  -- Historical versions remain immutable. New work starts from current canonical personnel.
  if p_from_version_id is null then
    v_source.snapshot := private.finance_org_snapshot_from_runtime_v2(v_tenant_id);
  end if;

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

CREATE OR REPLACE FUNCTION public.membership_org_publish_draft(p_version_id uuid, p_effective_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  perform pg_advisory_xact_lock(hashtextextended('finance-org-governance:' || (v_actor ->> 'tenant_id'), 0));
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
  if v_version.source_runtime_revision is distinct from private.finance_org_runtime_revision_v2(v_version.tenant_id) then
    raise exception '組織或人員在草稿建立後已有變更；不可覆蓋新資料，請重新建立草稿並核對差異' using errcode = '40001';
  end if;
  if v_actor ->> 'role' = 'hr' then raise exception '人資草稿必須由主管核准' using errcode = '42501'; end if;
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
      source_runtime_revision = private.finance_org_runtime_revision_v2(v_version.tenant_id),
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

CREATE OR REPLACE FUNCTION private.finance_membership_org_graph_v1(p_version_id uuid, p_permissions jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
            and private.finance_org_effective_now_v2(assignment)
            and coalesce(person.active, false)
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
    'source', 'published_snapshot',
    'runtime_consistent', v_version.status <> 'published' or v_version.source_runtime_revision is not distinct from private.finance_org_runtime_revision_v2(v_version.tenant_id),
    'published_snapshot_preserved', true,
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

do $resolver_preflight$
begin
 if encode(extensions.digest(pg_get_functiondef('public.finance_org_resolve_actor(text,text,text,text,text)'::regprocedure),'sha256'),'hex') <> '16aa0f3f341a7a290892bf7cb1f70956b60d9c876f4298388d809322033857dd' then raise exception 'Actor resolver prerequisite drift';end if;
 insert into private.finance_org_integrity_backup_v2 values('function','finance_org_resolve_actor(text,text,text,text,text)',jsonb_build_object('definition',pg_get_functiondef('public.finance_org_resolve_actor(text,text,text,text,text)'::regprocedure)));
end;$resolver_preflight$;
create or replace function private.finance_org_current_manager_v2(p_tenant_id uuid,p_finance_user_id text,p_department_code text,p_kind text)
returns text language plpgsql stable security definer set search_path='' as $fn$
declare v_snapshot jsonb;v_unit_id text;v_target text;
begin
 select snapshot into v_snapshot from private.finance_membership_org_versions_v1 where tenant_id=p_tenant_id and status='published';
 if v_snapshot is null then raise exception '找不到正式組織版本，請先完成組織核對' using errcode='55000';end if;
 if p_kind='department_manager' then
   select coalesce(nullif(d->>'managerId',''),nullif(d->>'directorId','')) into v_target
   from jsonb_array_elements(private.finance_membership_org_departments_v1(p_tenant_id,v_snapshot)) d
   where upper(d->>'c')=upper(p_department_code);
   return v_target;
 end if;
 select a->>'org_unit_id' into v_unit_id from jsonb_array_elements(v_snapshot->'assignments') a
 where a->>'finance_user_id'=p_finance_user_id and a->>'assignment_kind'='primary' and private.finance_org_effective_now_v2(a);
 if v_unit_id is null then return null;end if;
 return private.finance_membership_org_supervisor_v1(v_snapshot,p_finance_user_id,v_unit_id);
end;$fn$;

CREATE OR REPLACE FUNCTION public.finance_org_resolve_actor(p_actor_kind text, p_applicant_finance_user_id text, p_department_code text DEFAULT NULL::text, p_role_key text DEFAULT NULL::text, p_actor_ref text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_user_id text;
  v_tenant_id uuid;
  v_kind text;
  v_context jsonb;
  v_department_code text;
  v_role_key text;
  v_target_user_id text;
  v_candidates jsonb := '[]'::jsonb;
  v_missing_reason text := null;
  v_department_source text := 'request_or_applicant_department';
begin
  v_user_id := public.finance_approval_runtime_require_user();
  v_tenant_id := public.current_tenant_id();

  if nullif(p_applicant_finance_user_id, '') is null then
    raise exception 'Applicant finance user id is required for actor resolution'
      using errcode = '22023';
  end if;

  v_kind := case nullif(lower(trim(coalesce(p_actor_kind, ''))), '')
    when 'applicant_submit' then 'applicant'
    when 'applicant_confirm' then 'applicant'
    when 'applicant_invoice_delivery' then 'applicant'
    when 'section_chief' then 'department_manager'
    when 'dept_manager' then 'department_manager'
    when 'department_director' then 'department_manager'
    when 'accountant_invoice' then 'accountant'
    when 'general_affairs' then 'finance_role'
    when 'procurement_payment' then 'finance_role'
    when 'procurement_receipt' then 'finance_role'
    else nullif(lower(trim(coalesce(p_actor_kind, ''))), '')
  end;

  v_role_key := lower(trim(coalesce(nullif(p_role_key, ''), nullif(p_actor_ref, ''), '')));

  if v_kind = 'department_role'
     and v_role_key in ('dept_manager', 'department_manager', 'department_director') then
    v_kind := 'department_manager';
  end if;

  v_context := public.finance_org_user_context(p_applicant_finance_user_id);
  if coalesce((v_context->>'ok')::boolean, false) = false then
    return jsonb_build_object(
      'ok', false,
      'actor_kind', v_kind,
      'applicant_finance_user_id', p_applicant_finance_user_id,
      'error', coalesce(v_context->>'error', 'APPLICANT_CONTEXT_NOT_FOUND')
    );
  end if;

  if v_kind = 'department_manager' then
    v_department_code := coalesce(
      nullif(v_context #>> '{department,code}', ''),
      nullif(v_context #>> '{finance_user,department_code}', '')
    );
    v_department_source := 'applicant_department';
  else
    v_department_code := coalesce(
      nullif(p_department_code, ''),
      nullif(v_context #>> '{department,code}', ''),
      nullif(v_context #>> '{finance_user,department_code}', '')
    );
  end if;

  if v_role_key = '' then
    v_role_key := null;
  end if;

  if v_kind = 'applicant' then
    v_target_user_id := p_applicant_finance_user_id;
  elsif v_kind = 'direct_supervisor' then
    v_target_user_id := private.finance_org_current_manager_v2(v_tenant_id,p_applicant_finance_user_id,v_department_code,'direct_supervisor');
    v_context := jsonb_set(v_context,'{approval_chain,direct_supervisor_finance_user_id}',coalesce(to_jsonb(v_target_user_id),'null'::jsonb));
  elsif v_kind = 'department_manager' then
    v_target_user_id := private.finance_org_current_manager_v2(v_tenant_id,p_applicant_finance_user_id,v_department_code,'department_manager');
    v_context := jsonb_set(v_context,'{approval_chain,department_manager_finance_user_id}',coalesce(to_jsonb(v_target_user_id),'null'::jsonb));
    v_role_key := coalesce(v_role_key, 'dept_manager');
  elsif v_kind = 'fixed_user' then
    v_target_user_id := nullif(p_actor_ref, '');
  end if;

  if v_target_user_id is not null then
    select coalesce(jsonb_agg(jsonb_build_object(
        'finance_user_id', fu.id,
        'name', fu.name,
        'email', fu.email,
        'role', fu.role,
        'role_label', fu.role_label,
        'entity_id', fu.entity_id,
        'department_code', fu.department_code,
        'effective_finance_user_id', coalesce(delegate.delegatee_finance_user_id, fu.id),
        'delegated_to_finance_user_id', delegate.delegatee_finance_user_id,
        'source', v_kind
      ) order by fu.name, fu.id), '[]'::jsonb)
      into v_candidates
    from public.finance_users fu
    left join lateral (
      select ad.delegatee_finance_user_id
      from public.approval_delegations ad
      where ad.tenant_id = v_tenant_id
        and ad.active = true
        and ad.delegator_finance_user_id = fu.id
        and ad.starts_at <= now()
        and (ad.ends_at is null or ad.ends_at > now())
        and (ad.role_key is null or ad.role_key = coalesce(v_role_key, v_kind))
      order by ad.starts_at desc
      limit 1
    ) delegate on true
    where fu.tenant_id = v_tenant_id
      and fu.active = true
      and fu.id = v_target_user_id;
  elsif v_kind in ('admin_director', 'accountant', 'ceo', 'cashier') then
    select coalesce(jsonb_agg(jsonb_build_object(
        'finance_user_id', m.finance_user_id,
        'name', m.finance_user_name,
        'email', m.finance_user_email,
        'role', m.finance_user_role,
        'role_label', m.finance_user_role_label,
        'entity_id', m.entity_id,
        'department_code', m.department_code,
        'department_name', m.department_name,
        'employee_role_key', m.employee_role_key,
        'effective_finance_user_id', coalesce(delegate.delegatee_finance_user_id, m.approval_delegate_finance_user_id, m.finance_user_id),
        'delegated_to_finance_user_id', coalesce(delegate.delegatee_finance_user_id, m.approval_delegate_finance_user_id),
        'source', v_kind
      ) order by m.is_primary desc, m.finance_user_name, m.finance_user_id), '[]'::jsonb)
      into v_candidates
    from public.finance_org_role_members(
      case when v_kind = 'cashier' then 'cashier' else v_kind end,
      null::text
    ) m
    left join lateral (
      select ad.delegatee_finance_user_id
      from public.approval_delegations ad
      where ad.tenant_id = v_tenant_id
        and ad.active = true
        and ad.delegator_finance_user_id = m.finance_user_id
        and ad.starts_at <= now()
        and (ad.ends_at is null or ad.ends_at > now())
        and (ad.role_key is null or ad.role_key = v_kind)
      order by ad.starts_at desc
      limit 1
    ) delegate on true;
  elsif v_kind in ('finance_role', 'department_role') then
    if nullif(v_role_key, '') is null then
      v_missing_reason := 'ROLE_KEY_REQUIRED';
    else
      select coalesce(jsonb_agg(jsonb_build_object(
          'finance_user_id', m.finance_user_id,
          'name', m.finance_user_name,
          'email', m.finance_user_email,
          'role', m.finance_user_role,
          'role_label', m.finance_user_role_label,
          'entity_id', m.entity_id,
          'department_code', m.department_code,
          'department_name', m.department_name,
          'employee_role_key', m.employee_role_key,
          'effective_finance_user_id', coalesce(delegate.delegatee_finance_user_id, m.approval_delegate_finance_user_id, m.finance_user_id),
          'delegated_to_finance_user_id', coalesce(delegate.delegatee_finance_user_id, m.approval_delegate_finance_user_id),
          'source', v_kind
        ) order by m.is_primary desc, m.finance_user_name, m.finance_user_id), '[]'::jsonb)
        into v_candidates
      from public.finance_org_role_members(
        v_role_key,
        case when v_kind = 'department_role' then v_department_code else null end
      ) m
      left join lateral (
        select ad.delegatee_finance_user_id
        from public.approval_delegations ad
        where ad.tenant_id = v_tenant_id
          and ad.active = true
          and ad.delegator_finance_user_id = m.finance_user_id
          and ad.starts_at <= now()
          and (ad.ends_at is null or ad.ends_at > now())
          and (ad.role_key is null or ad.role_key = v_role_key)
        order by ad.starts_at desc
        limit 1
      ) delegate on true;
    end if;
  elsif v_kind in ('direct_supervisor', 'department_manager', 'fixed_user') then
    v_missing_reason := 'NO_MATCHING_ACTOR';
  else
    v_missing_reason := 'UNSUPPORTED_ACTOR_KIND';
  end if;

  if jsonb_array_length(coalesce(v_candidates, '[]'::jsonb)) = 0 and v_missing_reason is null then
    v_missing_reason := 'NO_MATCHING_ACTOR';
  end if;

  return jsonb_build_object(
    'ok', v_missing_reason is null,
    'actor_kind', v_kind,
    'applicant_finance_user_id', p_applicant_finance_user_id,
    'department_code', v_department_code,
    'department_source', v_department_source,
    'role_key', v_role_key,
    'candidates', coalesce(v_candidates, '[]'::jsonb),
    'missing_reason', v_missing_reason,
    'applicant_context', v_context
  );
end;
$function$;

do $reconcile$
declare v record;v_before jsonb;
begin
  for v in select tenant_id from private.finance_membership_org_versions_v1 where status='published' loop
    select jsonb_agg(to_jsonb(r) order by r.id) into v_before from public.employee_department_roles r where r.tenant_id=v.tenant_id;
    perform private.finance_org_publish_runtime_v2(v.tenant_id,'migration_finance_org_integrity_v2','核對目前有效人員、兼任及主管關係；保留組織階層與歷史版本');
    if v_before is distinct from (select jsonb_agg(to_jsonb(r) order by r.id) from public.employee_department_roles r where r.tenant_id=v.tenant_id) then raise exception 'Reconciliation changed runtime roles';end if;
  end loop;
end;$reconcile$;


alter function private.finance_org_effective_now_v2(jsonb,timestamptz) owner to postgres;
revoke all on function private.finance_org_effective_now_v2(jsonb,timestamptz) from public,anon,authenticated,service_role;

alter function private.finance_org_runtime_revision_v2(uuid) owner to postgres;
revoke all on function private.finance_org_runtime_revision_v2(uuid) from public,anon,authenticated,service_role;

alter function private.finance_membership_org_supervisor_v1(jsonb,text,text) owner to postgres;
revoke all on function private.finance_membership_org_supervisor_v1(jsonb,text,text) from public,anon,authenticated,service_role;

alter function private.finance_membership_org_seed_snapshot_v1(uuid) owner to postgres;
revoke all on function private.finance_membership_org_seed_snapshot_v1(uuid) from public,anon,authenticated,service_role;

alter function private.finance_membership_org_validate_v1(uuid,jsonb) owner to postgres;
revoke all on function private.finance_membership_org_validate_v1(uuid,jsonb) from public,anon,authenticated,service_role;

alter function private.finance_membership_org_departments_v1(uuid,jsonb) owner to postgres;
revoke all on function private.finance_membership_org_departments_v1(uuid,jsonb) from public,anon,authenticated,service_role;

alter function public.save_finance_org_chart_rows(jsonb) owner to postgres;
revoke all on function public.save_finance_org_chart_rows(jsonb) from public,anon,authenticated,service_role;

alter function private.finance_membership_org_publish_projection_v1(uuid,jsonb,uuid) owner to postgres;
revoke all on function private.finance_membership_org_publish_projection_v1(uuid,jsonb,uuid) from public,anon,authenticated,service_role;

alter function private.finance_org_snapshot_from_runtime_v2(uuid) owner to postgres;
revoke all on function private.finance_org_snapshot_from_runtime_v2(uuid) from public,anon,authenticated,service_role;

alter function private.finance_org_publish_runtime_v2(uuid,text,text) owner to postgres;
revoke all on function private.finance_org_publish_runtime_v2(uuid,text,text) from public,anon,authenticated,service_role;

alter function public.finance_admin_upsert_member_atomic_v1(jsonb,bigint) owner to postgres;
revoke all on function public.finance_admin_upsert_member_atomic_v1(jsonb,bigint) from public,anon,authenticated,service_role;

grant execute on function public.finance_admin_upsert_member_atomic_v1(jsonb,bigint) to authenticated,service_role;

alter function public.finance_save_org_chart_atomic(jsonb,text) owner to postgres;
revoke all on function public.finance_save_org_chart_atomic(jsonb,text) from public,anon,authenticated,service_role;

grant execute on function public.finance_save_org_chart_atomic(jsonb,text) to authenticated,service_role;

alter function public.finance_save_org_chart_versioned_v2(jsonb,text,text) owner to postgres;
revoke all on function public.finance_save_org_chart_versioned_v2(jsonb,text,text) from public,anon,authenticated,service_role;

grant execute on function public.finance_save_org_chart_versioned_v2(jsonb,text,text) to authenticated,service_role;

alter function public.finance_org_chart_editor_state_v2() owner to postgres;
revoke all on function public.finance_org_chart_editor_state_v2() from public,anon,authenticated,service_role;

grant execute on function public.finance_org_chart_editor_state_v2() to authenticated,service_role;

alter function private.finance_org_stamp_draft_runtime_v2() owner to postgres;
revoke all on function private.finance_org_stamp_draft_runtime_v2() from public,anon,authenticated,service_role;

alter function public.membership_org_create_draft(text,text,timestamp with time zone,uuid) owner to postgres;
revoke all on function public.membership_org_create_draft(text,text,timestamp with time zone,uuid) from public,anon,authenticated,service_role;

grant execute on function public.membership_org_create_draft(text,text,timestamp with time zone,uuid) to authenticated,service_role;

alter function public.membership_org_publish_draft(uuid,timestamp with time zone) owner to postgres;
revoke all on function public.membership_org_publish_draft(uuid,timestamp with time zone) from public,anon,authenticated,service_role;

grant execute on function public.membership_org_publish_draft(uuid,timestamp with time zone) to authenticated,service_role;

alter function private.finance_membership_org_graph_v1(uuid,jsonb) owner to postgres;
revoke all on function private.finance_membership_org_graph_v1(uuid,jsonb) from public,anon,authenticated,service_role;

alter function private.finance_org_current_manager_v2(uuid,text,text,text) owner to postgres;
revoke all on function private.finance_org_current_manager_v2(uuid,text,text,text) from public,anon,authenticated,service_role;

alter function public.finance_org_resolve_actor(text,text,text,text,text) owner to postgres;
revoke all on function public.finance_org_resolve_actor(text,text,text,text,text) from public,anon,authenticated,service_role;

grant execute on function public.finance_org_resolve_actor(text,text,text,text,text) to authenticated,service_role;

grant execute on function public.save_finance_org_chart_rows(jsonb) to service_role;

do $postflight$
declare v record;
begin
 for v in select * from private.finance_membership_org_versions_v1 where status='published' loop
   if not coalesce((private.finance_membership_org_validate_v1(v.tenant_id,v.snapshot)->>'ok')::boolean,false) then raise exception 'Published organization validation failed';end if;
   if v.source_runtime_revision is distinct from private.finance_org_runtime_revision_v2(v.tenant_id) then raise exception 'Published runtime revision mismatch';end if;
 end loop;
 if exists(select 1 from private.finance_org_integrity_backup_v2 b join private.finance_membership_org_versions_v1 history_row on history_row.id=(b.payload->>'id')::uuid where b.kind='published_version' and (history_row.snapshot is distinct from b.payload->'snapshot' or history_row.status<>'archived')) then raise exception 'Historical published snapshot changed';end if;
 if has_function_privilege('authenticated','public.save_finance_org_chart_rows(jsonb)','EXECUTE') or has_function_privilege('anon','public.finance_save_org_chart_versioned_v2(jsonb,text,text)','EXECUTE') or has_function_privilege('anon','public.finance_org_chart_editor_state_v2()','EXECUTE') then raise exception 'Organization RPC privilege regression';end if;
 if private.finance_org_effective_now_v2('{"effective_to":"2020-01-02"}'::jsonb,'2026-09-07T00:00:00Z') or private.finance_org_effective_now_v2('{"effective_from":"2099-01-01"}'::jsonb,'2026-09-07T00:00:00Z') then raise exception 'Organization effective-period regression';end if;
 if to_regprocedure('public.finance_save_org_chart_versioned_v2(jsonb,text,text)') is null or to_regprocedure('private.finance_org_current_manager_v2(uuid,text,text,text)') is null then raise exception 'Versioned organization RPC missing';end if;
end;$postflight$;
notify pgrst,'reload schema';
