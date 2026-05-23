-- HRIS/HRM role-based access control notes and starter RLS policies.
-- App role source:
-- 1. module_users.role stores the business role.
-- 2. auth.uid() maps to module_users.auth_user_id.
-- 3. Never use user-editable user_metadata for authorization decisions.

alter table companies enable row level security;
alter table branches enable row level security;
alter table departments enable row level security;
alter table teams enable row level security;
alter table module_users enable row level security;
alter table employee_branch_assignments enable row level security;
alter table hr_employee_profiles enable row level security;
alter table hr_attendance_records enable row level security;
alter table hr_leave_balances enable row level security;
alter table hr_requests enable row level security;
alter table hr_approval_steps enable row level security;
alter table hr_work_logs enable row level security;
alter table hr_payroll_runs enable row level security;
alter table hr_payroll_items enable row level security;
alter table hr_compliance_rules enable row level security;
alter table module_audit_logs enable row level security;

create or replace function current_module_user()
returns module_users
language sql
stable
security definer
set search_path = public
as $$
  select *
  from module_users
  where auth_user_id = auth.uid()
  limit 1
$$;

create or replace function current_hr_role()
returns hr_role
language sql
stable
security definer
set search_path = public
as $$
  select role from module_users where auth_user_id = auth.uid() limit 1
$$;

create or replace function is_hr_admin_role()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(current_hr_role() in ('super_admin','company_admin','hr_manager','hr_staff'), false)
$$;

revoke all on function current_module_user() from public;
revoke all on function current_hr_role() from public;
revoke all on function is_hr_admin_role() from public;
grant execute on function current_module_user() to authenticated;
grant execute on function current_hr_role() to authenticated;
grant execute on function is_hr_admin_role() to authenticated;

drop policy if exists "companies visible by scoped users" on companies;
create policy "companies visible by scoped users"
on companies for select
to authenticated
using (
  current_hr_role() = 'super_admin'
  or id = (current_module_user()).company_id
  or id = (current_module_user()).entity_id
);

drop policy if exists "branches visible by scoped users" on branches;
create policy "branches visible by scoped users"
on branches for select
to authenticated
using (
  current_hr_role() = 'super_admin'
  or company_id = (current_module_user()).company_id
  or company_id = (current_module_user()).entity_id
  or id = (current_module_user()).primary_branch_id
  or exists (
    select 1
    from employee_branch_assignments eba
    where eba.employee_id = (current_module_user()).id
      and eba.branch_id = branches.id
      and eba.is_active = true
      and (eba.effective_to is null or eba.effective_to >= current_date)
  )
);

drop policy if exists "departments visible by scoped users" on departments;
create policy "departments visible by scoped users"
on departments for select
to authenticated
using (
  current_hr_role() = 'super_admin'
  or company_id = (current_module_user()).company_id
  or company_id = (current_module_user()).entity_id
  or id = (current_module_user()).primary_department_id
);

drop policy if exists "teams visible by scoped users" on teams;
create policy "teams visible by scoped users"
on teams for select
to authenticated
using (
  current_hr_role() = 'super_admin'
  or company_id = (current_module_user()).company_id
  or company_id = (current_module_user()).entity_id
  or id = (current_module_user()).primary_team_id
);

drop policy if exists "employee branch assignments visible by scoped users" on employee_branch_assignments;
create policy "employee branch assignments visible by scoped users"
on employee_branch_assignments for select
to authenticated
using (
  current_hr_role() = 'super_admin'
  or employee_id = (current_module_user()).id
  or (
    current_hr_role() in ('company_admin','hr_manager','hr_staff')
    and company_id = coalesce((current_module_user()).company_id, (current_module_user()).entity_id)
  )
  or (
    current_hr_role() in ('department_manager','homecare_supervisor','daycare_staff')
    and branch_id = (current_module_user()).primary_branch_id
  )
);

drop policy if exists "module users can read scoped coworkers" on module_users;
create policy "module users can read scoped coworkers"
on module_users for select
to authenticated
using (
  current_hr_role() = 'super_admin'
  or id = (current_module_user()).id
  or (
    current_hr_role() in ('company_admin','hr_manager','hr_staff','accountant')
    and coalesce(company_id, entity_id) = coalesce((current_module_user()).company_id, (current_module_user()).entity_id)
  )
  or (
    current_hr_role() in ('department_manager','homecare_supervisor','daycare_staff')
    and coalesce(company_id, entity_id) = coalesce((current_module_user()).company_id, (current_module_user()).entity_id)
    and (
      primary_department_id = (current_module_user()).primary_department_id
      or department_code = (current_module_user()).department_code
      or primary_branch_id = (current_module_user()).primary_branch_id
    )
  )
);

drop policy if exists "employees can read own payroll items" on hr_payroll_items;
create policy "employees can read own payroll items"
on hr_payroll_items for select
to authenticated
using (
  employee_id = (current_module_user()).id
  or current_hr_role() in ('super_admin','company_admin','hr_manager','accountant')
);

drop policy if exists "requests visible by applicant or approver roles" on hr_requests;
create policy "requests visible by applicant or approver roles"
on hr_requests for select
to authenticated
using (
  applicant_id = (current_module_user()).id
  or current_hr_role() in ('super_admin','company_admin','hr_manager','hr_staff','accountant')
  or (
    current_hr_role() in ('department_manager','homecare_supervisor')
    and entity_id = coalesce((current_module_user()).company_id, (current_module_user()).entity_id)
    and department_code = (current_module_user()).department_code
  )
);
