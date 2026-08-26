-- Complete the New Taipei organization repair and correct the Taipei roster
-- name. The previous incident repair fixed canonical reporting relationships,
-- but left stale personnel titles and the imported PPT roster unchanged.
-- Those legacy fields could still be rendered by an already-loaded client.
begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $preflight$
declare
  v_tenant constant uuid := '00000000-0000-0000-0000-000000000001'::uuid;
  v_count integer;
  v_roster jsonb;
begin
  select count(*) into v_count
  from (values
    ('u_ppt_a25be81b2bcc9e00', 'manager.ntpc@suiyuecare.com'),
    ('u_1785138304566', 'homecare.ntpc@suiyuecare.com'),
    ('u_ppt_1e57f2bfdec1e65e', 'homecare.ntpc2@suiyuecare.com'),
    ('u_ppt_5df79081f0c7c3cb', 'homecare.ntpc3@suiyuecare.com'),
    ('u_ppt_58b24e472ef9efdd', 'cms.ntpc2@suiyuecare.com'),
    ('u_ppt_3e10a7f120d84353', 'cms.ntpc1@suiyuecare.com'),
    ('u_ppt_46a575c1cbecffdc', 'cms.ntpc3@suiyuecare.com'),
    ('u_ppt_46748bf48c321519', 'homecare.tpe4@suiyuecare.com')
  ) expected(finance_user_id, login_email)
  join public.finance_users user_row
    on user_row.tenant_id = v_tenant
   and user_row.id = expected.finance_user_id
   and lower(user_row.email) = expected.login_email
   and user_row.active = true;
  if v_count <> 8 then
    raise exception 'Organization correction expected 8 exact active identities, found %', v_count
      using errcode = '23514';
  end if;

  select count(*) into v_count
  from public.employee_department_roles role_row
  where role_row.tenant_id = v_tenant
    and role_row.active = true
    and (
      (role_row.finance_user_id = 'u_ppt_a25be81b2bcc9e00'
        and role_row.department_code in ('G1100', 'G1101', 'G1102'))
      or (role_row.finance_user_id = 'u_1785138304566'
        and role_row.department_code = 'G1101')
      or (role_row.finance_user_id in ('u_ppt_1e57f2bfdec1e65e', 'u_ppt_5df79081f0c7c3cb')
        and role_row.department_code = 'G1101')
      or (role_row.finance_user_id in ('u_ppt_58b24e472ef9efdd', 'u_ppt_3e10a7f120d84353', 'u_ppt_46a575c1cbecffdc')
        and role_row.department_code = 'G1102')
    );
  if v_count <> 9 then
    raise exception 'New Taipei role preflight expected 9 active assignments, found %', v_count
      using errcode = '23514';
  end if;

  select value into strict v_roster
  from public.system_settings
  where tenant_id = v_tenant
    and key = 'pptx_organization_roster'
    and is_active = true
    and deleted_at is null
  for update;

  if jsonb_typeof(v_roster -> 'branches') <> 'array' then
    raise exception 'PPT organization roster branches are not an array'
      using errcode = '23514';
  end if;

  select count(*) into v_count
  from jsonb_array_elements(v_roster -> 'branches') branch
  where branch ->> 'key' in ('taipei', 'new_taipei');
  if v_count <> 2 then
    raise exception 'PPT organization roster must contain Taipei and New Taipei exactly once, found %', v_count
      using errcode = '23514';
  end if;

  select count(*) into v_count
  from jsonb_array_elements(v_roster -> 'branches') branch
  cross join lateral jsonb_array_elements(coalesce(branch -> 'units', '[]'::jsonb)) unit
  cross join lateral jsonb_array_elements(coalesce(unit -> 'people', '[]'::jsonb)) person
  where branch ->> 'key' = 'taipei'
    and unit ->> 'code' = 'B1101'
    and lower(person ->> 'loginEmail') = 'homecare.tpe4@suiyuecare.com';
  if v_count <> 1 then
    raise exception 'Taipei roster expected one homecare.tpe4 identity, found %', v_count
      using errcode = '23514';
  end if;
end
$preflight$;

-- The primary personnel record is authoritative for names and titles. Keep
-- the three case managers as individual contributors; Yang is the regional
-- manager and concurrent G1102 section head; Jin is the G1101 section head.
update public.finance_users
set job_title = case id
      when 'u_ppt_a25be81b2bcc9e00' then '新北區經理'
      when 'u_1785138304566' then '新北居服課課長'
      when 'u_ppt_1e57f2bfdec1e65e' then '新北居服課專員'
      when 'u_ppt_5df79081f0c7c3cb' then '新北居服課專員'
      when 'u_ppt_58b24e472ef9efdd' then '新北個管課專員'
      when 'u_ppt_3e10a7f120d84353' then '新北個管課專員'
      when 'u_ppt_46a575c1cbecffdc' then '新北個管課專員'
      else job_title
    end,
    role = case
      when id = 'u_ppt_a25be81b2bcc9e00' then 'dept_manager'
      when id = 'u_1785138304566' then 'section_chief'
      else 'employee'
    end,
    role_label = case
      when id = 'u_ppt_a25be81b2bcc9e00' then '部門主管'
      when id = 'u_1785138304566' then '課長'
      else '一般組員'
    end
where tenant_id = '00000000-0000-0000-0000-000000000001'::uuid
  and id in (
    'u_ppt_a25be81b2bcc9e00',
    'u_1785138304566',
    'u_ppt_1e57f2bfdec1e65e',
    'u_ppt_5df79081f0c7c3cb',
    'u_ppt_58b24e472ef9efdd',
    'u_ppt_3e10a7f120d84353',
    'u_ppt_46a575c1cbecffdc'
  )
  and active = true;

update public.finance_users
set name = '杜依靜',
    init = '杜'
where tenant_id = '00000000-0000-0000-0000-000000000001'::uuid
  and id = 'u_ppt_46748bf48c321519'
  and lower(email) = 'homecare.tpe4@suiyuecare.com'
  and active = true;

-- If the pending first-login profile has already created a tenant membership
-- by apply time, keep that projection in sync without manufacturing Auth data.
update public.tenant_members
set name = '杜依靜',
    updated_at = now()
where tenant_id = '00000000-0000-0000-0000-000000000001'::uuid
  and finance_user_id = 'u_ppt_46748bf48c321519';

-- Reassert the exact canonical New Taipei graph. This is intentionally
-- idempotent with the earlier relationship repair and touches no Auth rows.
update public.employee_department_roles
set direct_supervisor_finance_user_id = 'u_ppt_a25be81b2bcc9e00',
    is_department_manager = true,
    is_department_director = false,
    can_approve = true,
    updated_at = now()
where tenant_id = '00000000-0000-0000-0000-000000000001'::uuid
  and finance_user_id = 'u_1785138304566'
  and department_code = 'G1101'
  and active = true;

update public.employee_department_roles
set direct_supervisor_finance_user_id = 'u_1785138304566',
    is_department_manager = false,
    is_department_director = false,
    can_approve = false,
    updated_at = now()
where tenant_id = '00000000-0000-0000-0000-000000000001'::uuid
  and finance_user_id in ('u_ppt_1e57f2bfdec1e65e', 'u_ppt_5df79081f0c7c3cb')
  and department_code = 'G1101'
  and active = true;

update public.employee_department_roles
set direct_supervisor_finance_user_id = 'u_ppt_a25be81b2bcc9e00',
    is_department_manager = false,
    is_department_director = false,
    can_approve = false,
    updated_at = now()
where tenant_id = '00000000-0000-0000-0000-000000000001'::uuid
  and finance_user_id in ('u_ppt_58b24e472ef9efdd', 'u_ppt_3e10a7f120d84353', 'u_ppt_46a575c1cbecffdc')
  and department_code = 'G1102'
  and active = true;

update public.employee_department_roles
set is_department_manager = (department_code in ('G1100', 'G1102')),
    is_department_director = true,
    can_approve = true,
    updated_at = now()
where tenant_id = '00000000-0000-0000-0000-000000000001'::uuid
  and finance_user_id = 'u_ppt_a25be81b2bcc9e00'
  and department_code in ('G1100', 'G1101', 'G1102')
  and active = true;

-- Replace the imported New Taipei branch with the exact two requested units,
-- and correct the Taipei roster name by its stable login identity.
do $repair_roster$
declare
  v_tenant constant uuid := '00000000-0000-0000-0000-000000000001'::uuid;
  v_setting_id uuid;
  v_roster jsonb;
  v_branches jsonb;
begin
  select id, value into strict v_setting_id, v_roster
  from public.system_settings
  where tenant_id = v_tenant
    and key = 'pptx_organization_roster'
    and is_active = true
    and deleted_at is null
  for update;

  select jsonb_agg(
    case branch ->> 'key'
      when 'new_taipei' then
        branch || jsonb_build_object(
          'name', '新北區',
          'manager', jsonb_build_object(
            'name', '楊書竣',
            'title', '新北區經理',
            'loginEmail', 'manager.ntpc@suiyuecare.com',
            'contactEmail', 'manager.ntpc@suiyuecare.com'
          ),
          'units', jsonb_build_array(
            jsonb_build_object(
              'code', 'G1101',
              'name', '新北居服課',
              'people', jsonb_build_array(
                jsonb_build_object('name', '金哲宇', 'title', '課長', 'loginEmail', 'homecare.ntpc@suiyuecare.com', 'contactEmail', 'homecare.ntpc@suiyuecare.com'),
                jsonb_build_object('name', '周育安', 'title', '專員', 'loginEmail', 'homecare.ntpc2@suiyuecare.com', 'contactEmail', 'homecare.ntpc2@suiyuecare.com'),
                jsonb_build_object('name', '陳欣語', 'title', '專員', 'loginEmail', 'homecare.ntpc3@suiyuecare.com', 'contactEmail', 'homecare.ntpc3@suiyuecare.com')
              )
            ),
            jsonb_build_object(
              'code', 'G1102',
              'name', '新北個管課',
              'people', jsonb_build_array(
                jsonb_build_object('name', '楊書竣', 'title', '課長', 'loginEmail', 'manager.ntpc@suiyuecare.com', 'contactEmail', 'manager.ntpc@suiyuecare.com'),
                jsonb_build_object('name', '游雅婷', 'title', '專員', 'loginEmail', 'cms.ntpc2@suiyuecare.com', 'contactEmail', 'cms.ntpc2@suiyuecare.com'),
                jsonb_build_object('name', '方意婷', 'title', '專員', 'loginEmail', 'cms.ntpc1@suiyuecare.com', 'contactEmail', 'cms.ntpc1@suiyuecare.com'),
                jsonb_build_object('name', '呂欣穎', 'title', '專員', 'loginEmail', 'cms.ntpc3@suiyuecare.com', 'contactEmail', 'cms.ntpc3@suiyuecare.com')
              )
            )
          )
        )
      when 'taipei' then
        jsonb_set(
          branch,
          '{units}',
          coalesce((
            select jsonb_agg(
              case when unit ->> 'code' = 'B1101' then
                jsonb_set(
                  unit,
                  '{people}',
                  coalesce((
                    select jsonb_agg(
                      case when lower(person ->> 'loginEmail') = 'homecare.tpe4@suiyuecare.com'
                        then person || jsonb_build_object('name', '杜依靜')
                        else person
                      end
                      order by person_ordinal
                    )
                    from jsonb_array_elements(coalesce(unit -> 'people', '[]'::jsonb))
                      with ordinality as people(person, person_ordinal)
                  ), '[]'::jsonb),
                  true
                )
              else unit end
              order by unit_ordinal
            )
            from jsonb_array_elements(coalesce(branch -> 'units', '[]'::jsonb))
              with ordinality as units(unit, unit_ordinal)
          ), '[]'::jsonb),
          true
        )
      else branch
    end
    order by branch_ordinal
  ) into v_branches
  from jsonb_array_elements(v_roster -> 'branches')
    with ordinality as branches(branch, branch_ordinal);

  v_roster := jsonb_set(v_roster, '{branches}', v_branches, true);
  v_roster := jsonb_set(
    v_roster,
    '{source,correctedAt}',
    to_jsonb(now()),
    true
  );
  v_roster := jsonb_set(
    v_roster,
    '{source,correction}',
    to_jsonb('20260820063544_repair_new_taipei_org_and_taipei_name'::text),
    true
  );

  update public.system_settings
  set value = v_roster,
      setting_value = v_roster,
      version = version + 1,
      updated_by = '20260820063544_repair_new_taipei_org_and_taipei_name',
      updated_at = now()
  where id = v_setting_id;
end
$repair_roster$;

-- Refresh the legacy snapshot only after all canonical rows are correct.
update public.system_settings
set value = public.finance_org_chart_rows_for_tenant(tenant_id),
    setting_value = public.finance_org_chart_rows_for_tenant(tenant_id),
    version = version + 1,
    updated_by = '20260820063544_repair_new_taipei_org_and_taipei_name',
    updated_at = now()
where tenant_id = '00000000-0000-0000-0000-000000000001'::uuid
  and key = 'organization_chart'
  and is_active = true
  and deleted_at is null;

do $postflight$
declare
  v_tenant constant uuid := '00000000-0000-0000-0000-000000000001'::uuid;
  v_count integer;
  v_roster jsonb;
begin
  if not exists (
    select 1 from public.finance_users
    where tenant_id = v_tenant
      and id = 'u_ppt_46748bf48c321519'
      and name = '杜依靜'
      and init = '杜'
      and lower(email) = 'homecare.tpe4@suiyuecare.com'
      and active = true
  ) or exists (
    select 1 from public.finance_users
    where tenant_id = v_tenant
      and name = '李曉雯'
      and active = true
  ) then
    raise exception 'Taipei name correction did not converge'
      using errcode = '23514';
  end if;

  select count(*) into v_count
  from public.finance_users
  where tenant_id = v_tenant
    and id in ('u_ppt_58b24e472ef9efdd', 'u_ppt_3e10a7f120d84353', 'u_ppt_46a575c1cbecffdc')
    and role = 'employee'
    and role_label = '一般組員'
    and job_title = '新北個管課專員'
    and department_code = 'G1102'
    and entity_id = 'E9'
    and active = true;
  if v_count <> 3 then
    raise exception 'New Taipei case-manager titles did not converge: %', v_count
      using errcode = '23514';
  end if;

  if not exists (
    select 1 from public.finance_users
    where tenant_id = v_tenant and id = 'u_ppt_a25be81b2bcc9e00'
      and role = 'dept_manager' and job_title = '新北區經理' and active = true
  ) or not exists (
    select 1 from public.finance_users
    where tenant_id = v_tenant and id = 'u_1785138304566'
      and role = 'section_chief' and job_title = '新北居服課課長' and active = true
  ) then
    raise exception 'New Taipei leadership titles did not converge'
      using errcode = '23514';
  end if;

  select count(*) into v_count
  from public.employee_department_roles
  where tenant_id = v_tenant
    and finance_user_id in ('u_ppt_58b24e472ef9efdd', 'u_ppt_3e10a7f120d84353', 'u_ppt_46a575c1cbecffdc')
    and department_code = 'G1102'
    and direct_supervisor_finance_user_id = 'u_ppt_a25be81b2bcc9e00'
    and is_department_manager = false
    and is_department_director = false
    and active = true;
  if v_count <> 3 then
    raise exception 'New Taipei case-management reporting graph did not converge: %', v_count
      using errcode = '23514';
  end if;

  if not exists (
    select 1 from public.employee_department_roles
    where tenant_id = v_tenant
      and finance_user_id = 'u_ppt_a25be81b2bcc9e00'
      and department_code = 'G1102'
      and is_department_manager = true
      and is_department_director = true
      and active = true
  ) or not exists (
    select 1 from public.employee_department_roles
    where tenant_id = v_tenant
      and finance_user_id = 'u_1785138304566'
      and department_code = 'G1101'
      and direct_supervisor_finance_user_id = 'u_ppt_a25be81b2bcc9e00'
      and is_department_manager = true
      and active = true
  ) then
    raise exception 'New Taipei two-unit leadership did not converge'
      using errcode = '23514';
  end if;

  select value into strict v_roster
  from public.system_settings
  where tenant_id = v_tenant
    and key = 'pptx_organization_roster'
    and is_active = true
    and deleted_at is null;

  select count(*) into v_count
  from jsonb_array_elements(v_roster -> 'branches') branch
  cross join lateral jsonb_array_elements(coalesce(branch -> 'units', '[]'::jsonb)) unit
  where branch ->> 'key' = 'new_taipei'
    and unit ->> 'code' in ('G1101', 'G1102');
  if v_count <> 2 or exists (
    select 1
    from jsonb_array_elements(v_roster -> 'branches') branch
    cross join lateral jsonb_array_elements(coalesce(branch -> 'units', '[]'::jsonb)) unit
    where branch ->> 'key' = 'new_taipei'
      and unit ->> 'code' not in ('G1101', 'G1102')
  ) then
    raise exception 'New Taipei roster must contain exactly G1101 and G1102'
      using errcode = '23514';
  end if;

  select count(*) into v_count
  from jsonb_array_elements(v_roster -> 'branches') branch
  cross join lateral jsonb_array_elements(branch -> 'units') unit
  cross join lateral jsonb_array_elements(unit -> 'people') person
  where branch ->> 'key' = 'new_taipei'
    and (
      (unit ->> 'code' = 'G1101' and person ->> 'name' in ('金哲宇', '周育安', '陳欣語'))
      or (unit ->> 'code' = 'G1102' and person ->> 'name' in ('楊書竣', '游雅婷', '方意婷', '呂欣穎'))
    );
  if v_count <> 7 then
    raise exception 'New Taipei roster expected 7 exact unit placements, found %', v_count
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(v_roster -> 'branches') branch
    cross join lateral jsonb_array_elements(coalesce(branch -> 'units', '[]'::jsonb)) unit
    cross join lateral jsonb_array_elements(coalesce(unit -> 'people', '[]'::jsonb)) person
    where person ->> 'name' in ('李曉雯')
  ) or not exists (
    select 1
    from jsonb_array_elements(v_roster -> 'branches') branch
    cross join lateral jsonb_array_elements(coalesce(branch -> 'units', '[]'::jsonb)) unit
    cross join lateral jsonb_array_elements(coalesce(unit -> 'people', '[]'::jsonb)) person
    where branch ->> 'key' = 'taipei'
      and unit ->> 'code' = 'B1101'
      and person ->> 'name' = '杜依靜'
      and lower(person ->> 'loginEmail') = 'homecare.tpe4@suiyuecare.com'
  ) then
    raise exception 'Taipei roster name correction did not converge'
      using errcode = '23514';
  end if;

  select count(*) into v_count
  from jsonb_array_elements(public.finance_org_chart_rows_for_tenant(v_tenant)) row
  where row ->> 'userId' in (
    'u_ppt_a25be81b2bcc9e00',
    'u_1785138304566',
    'u_ppt_1e57f2bfdec1e65e',
    'u_ppt_5df79081f0c7c3cb',
    'u_ppt_58b24e472ef9efdd',
    'u_ppt_3e10a7f120d84353',
    'u_ppt_46a575c1cbecffdc',
    'u_ppt_46748bf48c321519'
  );
  if v_count <> 8 then
    raise exception 'Published organization snapshot is missing corrected people: %', v_count
      using errcode = '23514';
  end if;
end
$postflight$;

commit;
