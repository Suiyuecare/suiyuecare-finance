-- Fix approval visibility after submitting expense requests.
-- Run this in Supabase SQL Editor if applicants or next approvers cannot see submitted forms.

alter table public.expense_requests add column if not exists applicant_id text;
alter table public.expense_requests add column if not exists applicant_email text;

create or replace function public.can_read_expense_request(p_request public.expense_requests)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.is_finance_accounting()
    or p_request.applicant = public.current_finance_user_name()
    or p_request.applicant_id = public.current_finance_user_id()
    or lower(p_request.applicant_email) = lower(auth.jwt() ->> 'email')
    or p_request.form_payload -> 'applicantProfile' ->> 'id' = public.current_finance_user_id()
    or lower(p_request.form_payload -> 'applicantProfile' ->> 'email') = lower(auth.jwt() ->> 'email')
    or public.json_steps_include_current_user(p_request.steps)
    or public.json_steps_role_matches(p_request.steps)
    or (
      public.current_finance_role() in ('section_chief','dept_manager')
      and p_request.department_code = public.current_finance_department()
    )
    or (
      public.current_finance_role() = 'general_affairs'
      and p_request.type = 'purchase_request'
    )
$$;

drop policy if exists expense_requests_insert_own_or_finance on public.expense_requests;
create policy expense_requests_insert_own_or_finance
on public.expense_requests
for insert
to authenticated
with check (
  public.is_finance_accounting()
  or applicant = public.current_finance_user_name()
  or applicant_id = public.current_finance_user_id()
  or lower(applicant_email) = lower(auth.jwt() ->> 'email')
  or form_payload -> 'applicantProfile' ->> 'id' = public.current_finance_user_id()
  or lower(form_payload -> 'applicantProfile' ->> 'email') = lower(auth.jwt() ->> 'email')
);
