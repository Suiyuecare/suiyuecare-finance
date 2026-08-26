-- Repair the two confirmed account-scope drifts and publish the intended
-- New Taipei reporting graph. Google Auth identities are deliberately not
-- manufactured here: pending first-login users must still prove ownership of
-- their exact Workspace primary email.
begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $preflight$
declare
  v_tenant constant uuid := '00000000-0000-0000-0000-000000000001'::uuid;
  v_count integer;
begin
  select count(*) into v_count
  from public.finance_users
  where tenant_id = v_tenant
    and id in (
      'u6',
      'u_1785138353548',
      'u_ppt_a25be81b2bcc9e00',
      'u_1785138304566',
      'u_ppt_1e57f2bfdec1e65e',
      'u_ppt_5df79081f0c7c3cb',
      'u_ppt_58b24e472ef9efdd',
      'u_ppt_3e10a7f120d84353',
      'u_ppt_46a575c1cbecffdc'
    )
    and active = true;
  if v_count <> 9 then
    raise exception 'Account/org repair preflight expected 9 active users, found %', v_count
      using errcode = '23514';
  end if;

  select count(*) into v_count
  from (values
    ('u_ppt_3e10a7f120d84353', 'cms.ntpc1@suiyuecare.com'),
    ('u_ppt_58b24e472ef9efdd', 'cms.ntpc2@suiyuecare.com'),
    ('u_ppt_46a575c1cbecffdc', 'cms.ntpc3@suiyuecare.com')
  ) expected(finance_user_id, login_email)
  join public.finance_users user_row
    on user_row.tenant_id = v_tenant
   and user_row.id = expected.finance_user_id
   and lower(user_row.email) = expected.login_email
   and user_row.active = true
   and user_row.auth_user_id is null
   and user_row.google_link_status = 'pending_first_login';
  if v_count <> 3 then
    raise exception 'New Taipei case-manager login preflight drifted: expected 3 pending first-login identities, found %', v_count
      using errcode = '23514';
  end if;

  -- You Ting-sheng is also a valid, active first-login profile. Do not bind it
  -- to the different homecare.taipei account that appeared in diagnostics.
  if not exists (
    select 1
    from public.finance_users
    where tenant_id = v_tenant
      and id = 'u_ppt_65af0fe56faa6789'
      and lower(email) = 'homecare.taipei2@suiyuecare.com'
      and department_code = 'B1101'
      and entity_id = 'E5'
      and active = true
      and auth_user_id is null
      and google_link_status = 'pending_first_login'
  ) then
    raise exception 'You Ting-sheng exact first-login profile drifted'
      using errcode = '23514';
  end if;

  select count(*) into v_count
  from public.employee_department_roles
  where tenant_id = v_tenant
    and finance_user_id in (
      'u_ppt_58b24e472ef9efdd',
      'u_ppt_3e10a7f120d84353',
      'u_ppt_46a575c1cbecffdc'
    )
    and department_code = 'G1102'
    and active = true
    and is_primary = true;
  if v_count <> 3 then
    raise exception 'New Taipei case-management assignment preflight expected 3 primary rows, found %', v_count
      using errcode = '23514';
  end if;

  select count(*) into v_count
  from public.employee_department_roles
  where tenant_id = v_tenant
    and finance_user_id = 'u_1785138353548'
    and active = true
    and is_primary = true;
  if v_count <> 1 then
    raise exception 'Su Zhixuan primary assignment preflight expected one row, found %', v_count
      using errcode = '23514';
  end if;

  select count(*) into v_count
  from public.departments
  where code = 'A1200'
    and status = 'active';
  if v_count <> 1 then
    raise exception 'Canonical A1200 department is not unique: %', v_count
      using errcode = '23514';
  end if;

  select count(*) into v_count
  from public.system_settings
  where tenant_id = v_tenant
    and key in ('departments', 'organization_chart')
    and is_active = true
    and deleted_at is null;
  if v_count <> 2 then
    raise exception 'Canonical department/org settings preflight expected 2 rows, found %', v_count
      using errcode = '23514';
  end if;
end
$preflight$;

-- The accountant profile accidentally stored an employee number in entity_id.
update public.finance_users
set entity_id = 'E1'
where tenant_id = '00000000-0000-0000-0000-000000000001'::uuid
  and id = 'u6'
  and active = true;

update public.tenant_members
set entity_id = 'E1',
    department_code = 'A1101',
    updated_at = now()
where tenant_id = '00000000-0000-0000-0000-000000000001'::uuid
  and finance_user_id = 'u6'
  and active = true;

-- Su Zhixuan was left on historical New Taipei alias G1103. Move the primary
-- runtime identity to the canonical teaching/quality department; keep the
-- existing A1202 secondary assignment as history/detail context.
update public.finance_users
set entity_id = 'E1',
    department_code = 'A1200'
where tenant_id = '00000000-0000-0000-0000-000000000001'::uuid
  and id = 'u_1785138353548'
  and active = true;

update public.tenant_members
set entity_id = 'E1',
    department_code = 'A1200',
    updated_at = now()
where tenant_id = '00000000-0000-0000-0000-000000000001'::uuid
  and finance_user_id = 'u_1785138353548'
  and active = true;

update public.employee_department_roles edr
set department_code = 'A1200',
    department_id = (
      select d.id
      from public.departments d
      where d.code = 'A1200'
        and d.status = 'active'
    ),
    role_key = 'employee',
    role_type = 'primary',
    relation_type = 'primary',
    is_primary = true,
    direct_supervisor_finance_user_id = 'u_1779425863955',
    is_department_manager = false,
    is_department_director = false,
    can_approve = false,
    metadata = coalesce(edr.metadata, '{}'::jsonb) || jsonb_build_object(
      'incident_repair', '20260820052216_repair_account_and_new_taipei_runtime',
      'previous_department_code', edr.department_code,
      'canonical_department_code', 'A1200',
      'repaired_at', now()
    ),
    updated_at = now()
where edr.tenant_id = '00000000-0000-0000-0000-000000000001'::uuid
  and edr.finance_user_id = 'u_1785138353548'
  and edr.active = true
  and edr.is_primary = true;

-- All three New Taipei case managers are individual contributors under Yang.
update public.finance_users
set role = 'employee',
    role_label = '一般組員',
    department_code = 'G1102',
    entity_id = 'E9'
where tenant_id = '00000000-0000-0000-0000-000000000001'::uuid
  and id in (
    'u_ppt_58b24e472ef9efdd',
    'u_ppt_3e10a7f120d84353',
    'u_ppt_46a575c1cbecffdc'
  )
  and active = true;

update public.tenant_members
set role = 'employee',
    role_label = '一般組員',
    department_code = 'G1102',
    entity_id = 'E9',
    updated_at = now()
where tenant_id = '00000000-0000-0000-0000-000000000001'::uuid
  and finance_user_id in (
    'u_ppt_58b24e472ef9efdd',
    'u_ppt_3e10a7f120d84353',
    'u_ppt_46a575c1cbecffdc'
  )
  and active = true;

update public.employee_department_roles edr
set role_key = 'employee',
    role_type = 'primary',
    relation_type = 'primary',
    direct_supervisor_finance_user_id = 'u_ppt_a25be81b2bcc9e00',
    is_department_manager = false,
    is_department_director = false,
    can_approve = false,
    metadata = coalesce(edr.metadata, '{}'::jsonb) || jsonb_build_object(
      'incident_repair', '20260820052216_repair_account_and_new_taipei_runtime',
      'new_taipei_branch', 'case_management',
      'repaired_at', now()
    ),
    updated_at = now()
where edr.tenant_id = '00000000-0000-0000-0000-000000000001'::uuid
  and edr.finance_user_id in (
    'u_ppt_58b24e472ef9efdd',
    'u_ppt_3e10a7f120d84353',
    'u_ppt_46a575c1cbecffdc'
  )
  and edr.department_code = 'G1102'
  and edr.active = true
  and edr.is_primary = true;

-- Home-care branch: Jin leads Zhou and Chen; Yang remains branch director.
update public.employee_department_roles edr
set direct_supervisor_finance_user_id = 'u_ppt_a25be81b2bcc9e00',
    is_department_manager = true,
    is_department_director = false,
    can_approve = true,
    metadata = coalesce(edr.metadata, '{}'::jsonb) || jsonb_build_object(
      'incident_repair', '20260820052216_repair_account_and_new_taipei_runtime',
      'new_taipei_branch', 'home_care',
      'repaired_at', now()
    ),
    updated_at = now()
where edr.tenant_id = '00000000-0000-0000-0000-000000000001'::uuid
  and edr.finance_user_id = 'u_1785138304566'
  and edr.department_code = 'G1101'
  and edr.active = true
  and edr.is_primary = true;

update public.employee_department_roles edr
set direct_supervisor_finance_user_id = 'u_1785138304566',
    is_department_manager = false,
    is_department_director = false,
    can_approve = false,
    metadata = coalesce(edr.metadata, '{}'::jsonb) || jsonb_build_object(
      'incident_repair', '20260820052216_repair_account_and_new_taipei_runtime',
      'new_taipei_branch', 'home_care',
      'repaired_at', now()
    ),
    updated_at = now()
where edr.tenant_id = '00000000-0000-0000-0000-000000000001'::uuid
  and edr.finance_user_id in ('u_ppt_1e57f2bfdec1e65e', 'u_ppt_5df79081f0c7c3cb')
  and edr.department_code = 'G1101'
  and edr.active = true
  and edr.is_primary = true;

-- Yang is the New Taipei director over both branches and the actual G1102
-- case-management head. Jin remains the separate G1101 home-care head.
update public.employee_department_roles edr
set is_department_manager = case when edr.department_code in ('G1100', 'G1102') then true else false end,
    is_department_director = true,
    can_approve = true,
    metadata = coalesce(edr.metadata, '{}'::jsonb) || jsonb_build_object(
      'incident_repair', '20260820052216_repair_account_and_new_taipei_runtime',
      'new_taipei_director', true,
      'repaired_at', now()
    ),
    updated_at = now()
where edr.tenant_id = '00000000-0000-0000-0000-000000000001'::uuid
  and edr.finance_user_id = 'u_ppt_a25be81b2bcc9e00'
  and edr.department_code in ('G1100', 'G1101', 'G1102')
  and edr.active = true;

update public.employee_department_roles edr
set active = false,
    effective_to = greatest(edr.effective_from, current_date),
    metadata = coalesce(edr.metadata, '{}'::jsonb) || jsonb_build_object(
      'ended_by', '20260820052216_repair_account_and_new_taipei_runtime',
      'ended_reason', 'retired historical New Taipei branch assignment',
      'ended_at', now()
    ),
    updated_at = now()
where edr.tenant_id = '00000000-0000-0000-0000-000000000001'::uuid
  and edr.department_code = 'G1103'
  and edr.active = true
  and edr.finance_user_id in ('u_ppt_a25be81b2bcc9e00', 'u_entrepreneur');

-- Remove the obsolete CEO placeholders now that both real branch heads exist.
update public.employee_department_roles edr
set active = false,
    effective_to = greatest(edr.effective_from, current_date),
    metadata = coalesce(edr.metadata, '{}'::jsonb) || jsonb_build_object(
      'ended_by', '20260820052216_repair_account_and_new_taipei_runtime',
      'ended_reason', 'real New Taipei branch leadership is active',
      'ended_at', now()
    ),
    updated_at = now()
where edr.tenant_id = '00000000-0000-0000-0000-000000000001'::uuid
  and edr.finance_user_id = 'u_entrepreneur'
  and edr.department_code in ('G1101', 'G1102')
  and edr.active = true
  and edr.relation_type = 'concurrent';

-- Publish manager/director fields through the canonical setting. Its trigger
-- atomically projects the same values into finance_department_units.
with rebuilt as (
  select s.id,
         jsonb_agg(
           case coalesce(item ->> 'c', item ->> 'code')
             when 'G1100' then item || jsonb_build_object(
               'managerId', 'u_ppt_a25be81b2bcc9e00',
               'manager_finance_user_id', 'u_ppt_a25be81b2bcc9e00',
               'directorId', 'u_ppt_a25be81b2bcc9e00',
               'director_finance_user_id', 'u_ppt_a25be81b2bcc9e00'
             )
             when 'G1101' then item || jsonb_build_object(
               'managerId', 'u_1785138304566',
               'manager_finance_user_id', 'u_1785138304566',
               'directorId', 'u_ppt_a25be81b2bcc9e00',
               'director_finance_user_id', 'u_ppt_a25be81b2bcc9e00'
             )
             when 'G1102' then item || jsonb_build_object(
               'managerId', 'u_ppt_a25be81b2bcc9e00',
               'manager_finance_user_id', 'u_ppt_a25be81b2bcc9e00',
               'directorId', 'u_ppt_a25be81b2bcc9e00',
               'director_finance_user_id', 'u_ppt_a25be81b2bcc9e00'
             )
             else item
           end
           order by ordinal
         ) as next_value
  from public.system_settings s
  cross join lateral jsonb_array_elements(s.value) with ordinality as entry(item, ordinal)
  where s.tenant_id = '00000000-0000-0000-0000-000000000001'::uuid
    and s.key = 'departments'
    and s.is_active = true
    and s.deleted_at is null
  group by s.id
)
update public.system_settings s
set value = rebuilt.next_value,
    setting_value = rebuilt.next_value,
    version = s.version + 1,
    updated_by = '20260820052216_repair_account_and_new_taipei_runtime',
    updated_at = now()
from rebuilt
where s.id = rebuilt.id;

update public.system_settings s
set value = public.finance_org_chart_rows_for_tenant(s.tenant_id),
    setting_value = public.finance_org_chart_rows_for_tenant(s.tenant_id),
    version = s.version + 1,
    updated_by = '20260820052216_repair_account_and_new_taipei_runtime',
    updated_at = now()
where s.tenant_id = '00000000-0000-0000-0000-000000000001'::uuid
  and s.key = 'organization_chart'
  and s.is_active = true
  and s.deleted_at is null;

do $postflight$
declare
  v_tenant constant uuid := '00000000-0000-0000-0000-000000000001'::uuid;
  v_count integer;
begin
  if not exists (
    select 1 from public.finance_users
    where tenant_id = v_tenant and id = 'u6'
      and entity_id = 'E1' and department_code = 'A1101' and active = true
  ) or not exists (
    select 1 from public.tenant_members
    where tenant_id = v_tenant and finance_user_id = 'u6'
      and entity_id = 'E1' and department_code = 'A1101' and active = true
  ) then
    raise exception 'Accountant entity repair did not converge' using errcode = '23514';
  end if;

  if not exists (
    select 1 from public.finance_users
    where tenant_id = v_tenant and id = 'u_1785138353548'
      and entity_id = 'E1' and department_code = 'A1200' and active = true
  ) or not exists (
    select 1 from public.tenant_members
    where tenant_id = v_tenant and finance_user_id = 'u_1785138353548'
      and entity_id = 'E1' and department_code = 'A1200' and active = true
  ) then
    raise exception 'Su Zhixuan canonical department repair did not converge' using errcode = '23514';
  end if;

  if not exists (
    select 1 from public.employee_department_roles
    where tenant_id = v_tenant
      and finance_user_id = 'u_1785138353548'
      and department_code = 'A1200'
      and role_key = 'employee'
      and direct_supervisor_finance_user_id = 'u_1779425863955'
      and active = true
      and is_primary = true
  ) then
    raise exception 'Su Zhixuan primary role projection did not converge' using errcode = '23514';
  end if;

  select count(*) into v_count
  from public.finance_users
  where tenant_id = v_tenant
    and id in ('u_ppt_58b24e472ef9efdd', 'u_ppt_3e10a7f120d84353', 'u_ppt_46a575c1cbecffdc')
    and role = 'employee'
    and department_code = 'G1102'
    and entity_id = 'E9'
    and active = true
    and auth_user_id is null
    and google_link_status = 'pending_first_login';
  if v_count <> 3 then
    raise exception 'New Taipei case-manager runtime repair did not converge: %', v_count
      using errcode = '23514';
  end if;

  select count(*) into v_count
  from public.employee_department_roles
  where tenant_id = v_tenant
    and finance_user_id in ('u_ppt_58b24e472ef9efdd', 'u_ppt_3e10a7f120d84353', 'u_ppt_46a575c1cbecffdc')
    and department_code = 'G1102'
    and role_key = 'employee'
    and direct_supervisor_finance_user_id = 'u_ppt_a25be81b2bcc9e00'
    and is_department_manager = false
    and can_approve = false
    and active = true
    and is_primary = true;
  if v_count <> 3 then
    raise exception 'New Taipei case-manager supervisor graph did not converge: %', v_count
      using errcode = '23514';
  end if;

  if not exists (
    select 1 from public.employee_department_roles
    where tenant_id = v_tenant
      and finance_user_id = 'u_1785138304566'
      and department_code = 'G1101'
      and direct_supervisor_finance_user_id = 'u_ppt_a25be81b2bcc9e00'
      and is_department_manager = true
      and can_approve = true
      and active = true
  ) then
    raise exception 'New Taipei home-care manager graph did not converge' using errcode = '23514';
  end if;

  select count(*) into v_count
  from public.employee_department_roles
  where tenant_id = v_tenant
    and finance_user_id in ('u_ppt_1e57f2bfdec1e65e', 'u_ppt_5df79081f0c7c3cb')
    and department_code = 'G1101'
    and direct_supervisor_finance_user_id = 'u_1785138304566'
    and is_department_manager = false
    and is_department_director = false
    and can_approve = false
    and active = true
    and is_primary = true;
  if v_count <> 2 then
    raise exception 'New Taipei home-care subordinate graph did not converge: %', v_count
      using errcode = '23514';
  end if;

  if not exists (
    select 1 from public.employee_department_roles
    where tenant_id = v_tenant
      and finance_user_id = 'u_ppt_a25be81b2bcc9e00'
      and department_code = 'G1102'
      and is_department_manager = true
      and is_department_director = true
      and can_approve = true
      and active = true
  ) then
    raise exception 'New Taipei director/case-management head did not converge' using errcode = '23514';
  end if;

  if exists (
    select 1 from public.employee_department_roles
    where tenant_id = v_tenant
      and department_code = 'G1103'
      and finance_user_id in ('u_ppt_a25be81b2bcc9e00', 'u_entrepreneur')
      and active = true
  ) then
    raise exception 'Retired G1103 leadership assignments remain active' using errcode = '23514';
  end if;

  if not exists (
    select 1 from public.finance_department_units
    where tenant_id = v_tenant and code = 'G1101'
      and manager_finance_user_id = 'u_1785138304566'
      and director_finance_user_id = 'u_ppt_a25be81b2bcc9e00'
      and active = true
  ) or not exists (
    select 1 from public.finance_department_units
    where tenant_id = v_tenant and code = 'G1102'
      and manager_finance_user_id = 'u_ppt_a25be81b2bcc9e00'
      and director_finance_user_id = 'u_ppt_a25be81b2bcc9e00'
      and active = true
  ) then
    raise exception 'Canonical New Taipei unit leadership projection did not converge' using errcode = '23514';
  end if;

  select count(*) into v_count
  from jsonb_array_elements(public.finance_org_chart_rows_for_tenant(v_tenant)) row_value
  where row_value ->> 'userId' in (
    'u_ppt_a25be81b2bcc9e00',
    'u_1785138304566',
    'u_ppt_1e57f2bfdec1e65e',
    'u_ppt_5df79081f0c7c3cb',
    'u_ppt_58b24e472ef9efdd',
    'u_ppt_3e10a7f120d84353',
    'u_ppt_46a575c1cbecffdc',
    'u_1785138353548'
  );
  if v_count <> 8 then
    raise exception 'Published org chart is missing repaired users: %', v_count using errcode = '23514';
  end if;

  if not exists (
    select 1
    from public.finance_users
    where tenant_id = v_tenant
      and id = 'u_ppt_65af0fe56faa6789'
      and lower(email) = 'homecare.taipei2@suiyuecare.com'
      and active = true
      and auth_user_id is null
      and google_link_status = 'pending_first_login'
  ) then
    raise exception 'You Ting-sheng profile was modified without verified Google ownership'
      using errcode = '23514';
  end if;
end
$postflight$;

commit;
