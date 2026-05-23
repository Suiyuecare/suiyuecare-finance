alter table public.overtime_requests
  add column if not exists compensation_type text not null default 'overtime_pay'
    check (compensation_type in ('overtime_pay','compensatory_leave')),
  add column if not exists attachment_ids jsonb not null default '[]'::jsonb,
  add column if not exists workflow_stage text not null default 'applicant_submitted'
    check (workflow_stage in ('draft','applicant_submitted','direct_manager','department_manager','admin_director','hr_confirm','completed','rejected','cancelled')),
  add column if not exists review_note text;

drop policy if exists "employees can manage own overtime requests" on public.overtime_requests;
create policy "employees can manage own overtime requests"
on public.overtime_requests for all
to authenticated
using (
  auth.uid() is not null
  and deleted_at is null
  and employee_id = public.current_employee_id()
)
with check (
  auth.uid() is not null
  and employee_id = public.current_employee_id()
);

drop policy if exists "request approvers can manage company overtime requests" on public.overtime_requests;
create policy "request approvers can manage company overtime requests"
on public.overtime_requests for all
to authenticated
using (
  public.current_role_key() in ('super_admin','company_admin','hr_manager','hr_staff','department_manager','homecare_supervisor','admin_director','ceo')
  and company_id = (
    select users.company_id
    from public.users
    where users.auth_user_id = auth.uid()
      and users.deleted_at is null
    limit 1
  )
)
with check (
  public.current_role_key() in ('super_admin','company_admin','hr_manager','hr_staff','department_manager','homecare_supervisor','admin_director','ceo')
  and company_id = (
    select users.company_id
    from public.users
    where users.auth_user_id = auth.uid()
      and users.deleted_at is null
    limit 1
  )
);
