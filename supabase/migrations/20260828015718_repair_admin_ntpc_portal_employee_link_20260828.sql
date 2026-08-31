do $repair$
declare
  v_auth_user_id uuid := 'c50e9e4f-0b63-44e9-b445-9dd5fe7d9f2e'::uuid;
  v_portal_user_id uuid := 'b1f0c6bd-3e22-45c0-b6f4-81d7ebd3d369'::uuid;
  v_retired_employee_id uuid := '6c101aa3-b91d-4590-ae7a-5df070af2793'::uuid;
  v_active_employee_id uuid := '73c0ce88-c0f7-4276-ba0e-938cea9d53ce'::uuid;
  v_active_company_id uuid := 'd114b583-824e-42c9-9d4e-5ab3cf17ac65'::uuid;
  v_updated integer;
begin
  if not exists (
    select 1 from auth.users
    where id = v_auth_user_id
      and lower(email) = 'admin.ntpc@suiyuecare.com'
  ) then
    raise exception 'Expected verified Auth identity is missing';
  end if;

  if not exists (
    select 1 from public.employees
    where id = v_retired_employee_id
      and lower(email) = 'admin.ntpc@suiyuecare.com'
      and employment_status = 'terminated'
      and deleted_at is not null
  ) then
    raise exception 'Expected retired duplicate employee fingerprint is missing';
  end if;

  if not exists (
    select 1 from public.employees
    where id = v_active_employee_id
      and lower(email) = 'admin.ntpc@suiyuecare.com'
      and employee_no = 'u_1785138353548'
      and company_id = v_active_company_id
      and employment_status = 'active'
      and deleted_at is null
  ) then
    raise exception 'Expected active canonical employee fingerprint is missing';
  end if;

  update public.users
     set employee_id = v_active_employee_id,
         company_id = v_active_company_id,
         updated_at = clock_timestamp()
   where id = v_portal_user_id
     and auth_user_id = v_auth_user_id
     and lower(email) = 'admin.ntpc@suiyuecare.com'
     and status = 'active'
     and deleted_at is null
     and employee_id = v_retired_employee_id;

  get diagnostics v_updated = row_count;

  if v_updated not in (0, 1) then
    raise exception 'Unexpected Portal user repair row count: %', v_updated;
  end if;

  if not exists (
    select 1
    from public.users u
    join public.employees e on e.id = u.employee_id
    where u.id = v_portal_user_id
      and u.auth_user_id = v_auth_user_id
      and u.company_id = v_active_company_id
      and u.status = 'active'
      and u.deleted_at is null
      and e.id = v_active_employee_id
      and e.employment_status = 'active'
      and e.deleted_at is null
  ) then
    raise exception 'Portal user did not converge to active employee projection';
  end if;
end
$repair$;
