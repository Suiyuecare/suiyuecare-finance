-- Fix RLS recursion on public.users.
-- Problem:
--   policy "user managers can manage company users" queried public.users
--   inside a policy defined on public.users, causing:
--   infinite recursion detected in policy for relation "users".
--
-- Approach:
--   move the current user's company lookup into a SECURITY DEFINER helper,
--   then reference that helper from the policy.

begin;

create or replace function public.current_hr_user_company_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select u.company_id
  from public.users u
  where u.auth_user_id = auth.uid()
    and u.deleted_at is null
    and u.status = 'active'
  limit 1
$$;

revoke all on function public.current_hr_user_company_id() from public;
grant execute on function public.current_hr_user_company_id() to authenticated;

drop policy if exists "user managers can manage company users" on public.users;
create policy "user managers can manage company users"
on public.users for all
to authenticated
using (
  public.can_manage_employee_data()
  and company_id = public.current_hr_user_company_id()
)
with check (
  public.can_manage_employee_data()
  and company_id = public.current_hr_user_company_id()
);

commit;
