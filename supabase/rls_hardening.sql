-- Module Finance RLS hardening policies.
-- Goal: replace broad "authenticated can do everything" policies with role-aware access.
--
-- Apply after module_finance_production_schema.sql.
-- Important: this file keeps the current single-page app usable, but it is still row-level
-- security. Field-level integrity for approval/voucher mutations should later move to RPC.

begin;

-- ---------------------------------------------------------------------------
-- Helper functions
-- ---------------------------------------------------------------------------

create or replace function public.current_finance_user()
returns public.finance_users
language sql
stable
security invoker
set search_path = public
as $$
  select fu
  from public.finance_users fu
  where lower(fu.email) = lower(auth.jwt() ->> 'email')
    and fu.active = true
  limit 1
$$;

create or replace function public.current_finance_user_id()
returns text
language sql
stable
security invoker
set search_path = public
as $$
  select (public.current_finance_user()).id
$$;

create or replace function public.current_finance_user_name()
returns text
language sql
stable
security invoker
set search_path = public
as $$
  select (public.current_finance_user()).name
$$;

create or replace function public.current_finance_role()
returns text
language sql
stable
security invoker
set search_path = public
as $$
  select (public.current_finance_user()).role
$$;

create or replace function public.current_finance_department()
returns text
language sql
stable
security invoker
set search_path = public
as $$
  select (public.current_finance_user()).department_code
$$;

create or replace function public.current_finance_entity()
returns text
language sql
stable
security invoker
set search_path = public
as $$
  select (public.current_finance_user()).entity_id
$$;

create or replace function public.is_finance_admin()
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(public.current_finance_role() in ('ceo','admin_director'), false)
$$;

create or replace function public.is_finance_accounting()
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(public.current_finance_role() in ('ceo','admin_director','accountant'), false)
$$;

create or replace function public.is_finance_hr()
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(public.current_finance_role() in ('ceo','admin_director','hr'), false)
$$;

create or replace function public.is_finance_general_affairs()
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(public.current_finance_role() in ('ceo','admin_director','general_affairs'), false)
$$;

create or replace function public.json_steps_include_current_user(steps jsonb)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select exists (
    select 1
    from jsonb_array_elements(coalesce(steps, '[]'::jsonb)) s
    where s ->> 'uid' = public.current_finance_user_id()
       or s ->> 'n' = public.current_finance_user_name()
  )
$$;

create or replace function public.json_steps_role_matches(steps jsonb)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select exists (
    select 1
    from jsonb_array_elements(coalesce(steps, '[]'::jsonb)) s
    where s ->> 'rk' = public.current_finance_role()
       or s ->> 'approver_role' = public.current_finance_role()
  )
$$;

create or replace function public.json_active_step_matches_current_user(steps jsonb)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  with step_rows as (
    select
      s,
      row_number() over (
        order by coalesce(nullif(s ->> 'step_order', '')::int, nullif(s ->> 'order', '')::int, ordinality::int)
      ) as rn
    from jsonb_array_elements(coalesce(steps, '[]'::jsonb)) with ordinality as x(s, ordinality)
    where coalesce(s ->> 'a', s ->> 'status', '') not in ('approved','rejected','returned')
  )
  select exists (
    select 1
    from step_rows
    where rn = 1
      and (
        s ->> 'uid' = public.current_finance_user_id()
        or s ->> 'n' = public.current_finance_user_name()
        or s ->> 'rk' = public.current_finance_role()
        or s ->> 'approver_role' = public.current_finance_role()
      )
  )
$$;

create or replace function public.is_expense_request_owner(p_request public.expense_requests)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select
    p_request.applicant = public.current_finance_user_name()
    or p_request.applicant_id = public.current_finance_user_id()
    or lower(p_request.applicant_email) = lower(auth.jwt() ->> 'email')
    or p_request.form_payload -> 'applicantProfile' ->> 'id' = public.current_finance_user_id()
    or lower(p_request.form_payload -> 'applicantProfile' ->> 'email') = lower(auth.jwt() ->> 'email')
$$;

create or replace function public.is_invoice_owner(p_invoice public.invoices)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select
    p_invoice.applicant = public.current_finance_user_name()
    or p_invoice.applicant_id = public.current_finance_user_id()
$$;

create or replace function public.can_read_expense_request(p_request public.expense_requests)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select
    public.is_finance_accounting()
    or public.is_expense_request_owner(p_request)
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

create or replace function public.can_update_expense_request(p_request public.expense_requests)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select
    public.current_finance_role() in ('accountant','ceo')
    or public.json_active_step_matches_current_user(p_request.steps)
    or (
      public.is_expense_request_owner(p_request)
      and p_request.status in ('pending_applicant_confirm','returned')
    )
    or (
      public.current_finance_role() = 'general_affairs'
      and p_request.type = 'purchase_request'
      and p_request.status = 'pending_procurement'
    )
$$;

create or replace function public.can_read_invoice(p_invoice public.invoices)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select
    public.is_finance_accounting()
    or public.is_invoice_owner(p_invoice)
    or public.json_steps_include_current_user(p_invoice.steps)
    or public.json_steps_role_matches(p_invoice.steps)
    or (
      public.current_finance_role() in ('section_chief','dept_manager')
      and p_invoice.department_code = public.current_finance_department()
    )
$$;

create or replace function public.can_update_invoice(p_invoice public.invoices)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select
    public.current_finance_role() in ('accountant','ceo','admin_director')
    or public.json_active_step_matches_current_user(p_invoice.steps)
    or public.is_invoice_owner(p_invoice)
$$;

revoke all on function public.current_finance_user() from public, anon, authenticated;
revoke all on function public.current_finance_user_id() from public, anon, authenticated;
revoke all on function public.current_finance_user_name() from public, anon, authenticated;
revoke all on function public.current_finance_role() from public, anon, authenticated;
revoke all on function public.current_finance_department() from public, anon, authenticated;
revoke all on function public.current_finance_entity() from public, anon, authenticated;
revoke all on function public.is_finance_admin() from public, anon, authenticated;
revoke all on function public.is_finance_accounting() from public, anon, authenticated;
revoke all on function public.is_finance_hr() from public, anon, authenticated;
revoke all on function public.is_finance_general_affairs() from public, anon, authenticated;
revoke all on function public.json_steps_include_current_user(jsonb) from public, anon, authenticated;
revoke all on function public.json_steps_role_matches(jsonb) from public, anon, authenticated;
revoke all on function public.json_active_step_matches_current_user(jsonb) from public, anon, authenticated;
revoke all on function public.is_expense_request_owner(public.expense_requests) from public, anon, authenticated;
revoke all on function public.is_invoice_owner(public.invoices) from public, anon, authenticated;
revoke all on function public.can_read_expense_request(public.expense_requests) from public, anon, authenticated;
revoke all on function public.can_update_expense_request(public.expense_requests) from public, anon, authenticated;
revoke all on function public.can_read_invoice(public.invoices) from public, anon, authenticated;
revoke all on function public.can_update_invoice(public.invoices) from public, anon, authenticated;

grant execute on function public.current_finance_user() to authenticated;
grant execute on function public.current_finance_user_id() to authenticated;
grant execute on function public.current_finance_user_name() to authenticated;
grant execute on function public.current_finance_role() to authenticated;
grant execute on function public.current_finance_department() to authenticated;
grant execute on function public.current_finance_entity() to authenticated;
grant execute on function public.is_finance_admin() to authenticated;
grant execute on function public.is_finance_accounting() to authenticated;
grant execute on function public.is_finance_hr() to authenticated;
grant execute on function public.is_finance_general_affairs() to authenticated;
grant execute on function public.json_steps_include_current_user(jsonb) to authenticated;
grant execute on function public.json_steps_role_matches(jsonb) to authenticated;
grant execute on function public.json_active_step_matches_current_user(jsonb) to authenticated;
grant execute on function public.is_expense_request_owner(public.expense_requests) to authenticated;
grant execute on function public.is_invoice_owner(public.invoices) to authenticated;
grant execute on function public.can_read_expense_request(public.expense_requests) to authenticated;
grant execute on function public.can_update_expense_request(public.expense_requests) to authenticated;
grant execute on function public.can_read_invoice(public.invoices) to authenticated;
grant execute on function public.can_update_invoice(public.invoices) to authenticated;

-- ---------------------------------------------------------------------------
-- Remove broad policies
-- ---------------------------------------------------------------------------

alter table public.finance_users enable row level security;
alter table public.system_settings enable row level security;
alter table public.voucher_serials enable row level security;
alter table public.expense_requests enable row level security;
alter table public.invoices enable row level security;
alter table public.vouchers enable row level security;
alter table public.bills enable row level security;
alter table public.notifications enable row level security;
alter table public.ledger_entries enable row level security;
alter table public.module_audit_logs enable row level security;

alter table public.finance_users force row level security;
alter table public.system_settings force row level security;
alter table public.voucher_serials force row level security;
alter table public.expense_requests force row level security;
alter table public.invoices force row level security;
alter table public.vouchers force row level security;
alter table public.bills force row level security;
alter table public.notifications force row level security;
alter table public.ledger_entries force row level security;
alter table public.module_audit_logs force row level security;

drop policy if exists finance_users_authenticated on public.finance_users;
drop policy if exists expense_requests_authenticated on public.expense_requests;
drop policy if exists invoices_authenticated on public.invoices;
drop policy if exists vouchers_authenticated on public.vouchers;
drop policy if exists bills_authenticated on public.bills;
drop policy if exists notifications_authenticated on public.notifications;
drop policy if exists ledger_entries_authenticated on public.ledger_entries;
drop policy if exists module_audit_logs_authenticated_read on public.module_audit_logs;

-- System settings policies from the base schema are already role constrained, but
-- recreate the read policy so all signed-in app users can still load settings.
drop policy if exists system_settings_read on public.system_settings;
drop policy if exists system_settings_admin_insert on public.system_settings;
drop policy if exists system_settings_admin_update on public.system_settings;
drop policy if exists system_settings_admin_delete on public.system_settings;

-- Re-applying this file should be safe in production. Drop the scoped policies
-- this file owns before recreating them.
drop policy if exists finance_users_select_authenticated on public.finance_users;
drop policy if exists finance_users_insert_admin on public.finance_users;
drop policy if exists finance_users_update_admin on public.finance_users;
drop policy if exists finance_users_delete_ceo on public.finance_users;
drop policy if exists system_settings_select_authenticated on public.system_settings;
drop policy if exists system_settings_insert_admin on public.system_settings;
drop policy if exists system_settings_update_admin on public.system_settings;
drop policy if exists system_settings_delete_ceo on public.system_settings;
drop policy if exists voucher_serials_accounting on public.voucher_serials;
drop policy if exists expense_requests_select_scoped on public.expense_requests;
drop policy if exists expense_requests_insert_own_or_finance on public.expense_requests;
drop policy if exists expense_requests_update_actor on public.expense_requests;
drop policy if exists expense_requests_delete_ceo_only on public.expense_requests;
drop policy if exists invoices_select_scoped on public.invoices;
drop policy if exists invoices_insert_authenticated_requester on public.invoices;
drop policy if exists invoices_update_actor on public.invoices;
drop policy if exists invoices_delete_ceo_only on public.invoices;
drop policy if exists vouchers_select_accounting on public.vouchers;
drop policy if exists vouchers_insert_accountant_ceo on public.vouchers;
drop policy if exists vouchers_update_accountant_ceo on public.vouchers;
drop policy if exists vouchers_delete_ceo_only on public.vouchers;
drop policy if exists ledger_entries_select_accounting on public.ledger_entries;
drop policy if exists ledger_entries_insert_accountant_ceo on public.ledger_entries;
drop policy if exists ledger_entries_update_accountant_ceo on public.ledger_entries;
drop policy if exists ledger_entries_delete_ceo_only on public.ledger_entries;
drop policy if exists bills_select_finance on public.bills;
drop policy if exists bills_insert_finance on public.bills;
drop policy if exists bills_update_finance on public.bills;
drop policy if exists bills_delete_ceo_only on public.bills;
drop policy if exists notifications_select_authenticated on public.notifications;
drop policy if exists notifications_insert_finance_or_system_actor on public.notifications;
drop policy if exists notifications_update_authenticated_read_state on public.notifications;
drop policy if exists notifications_delete_ceo_only on public.notifications;
drop policy if exists module_audit_logs_select_admin_accounting on public.module_audit_logs;

-- ---------------------------------------------------------------------------
-- finance_users
-- ---------------------------------------------------------------------------

create policy finance_users_select_authenticated
on public.finance_users
for select
to authenticated
using (
  active = true
  or public.is_finance_admin()
);

create policy finance_users_insert_admin
on public.finance_users
for insert
to authenticated
with check (public.is_finance_admin());

create policy finance_users_update_admin
on public.finance_users
for update
to authenticated
using (public.is_finance_admin())
with check (public.is_finance_admin());

create policy finance_users_delete_ceo
on public.finance_users
for delete
to authenticated
using (public.current_finance_role() = 'ceo');

-- ---------------------------------------------------------------------------
-- system_settings
-- ---------------------------------------------------------------------------

create policy system_settings_select_authenticated
on public.system_settings
for select
to authenticated
using (public.current_finance_user_id() is not null);

create policy system_settings_insert_admin
on public.system_settings
for insert
to authenticated
with check (public.is_finance_admin());

create policy system_settings_update_admin
on public.system_settings
for update
to authenticated
using (public.is_finance_admin())
with check (public.is_finance_admin());

create policy system_settings_delete_ceo
on public.system_settings
for delete
to authenticated
using (public.current_finance_role() = 'ceo');

-- ---------------------------------------------------------------------------
-- voucher_serials
-- ---------------------------------------------------------------------------

create policy voucher_serials_accounting
on public.voucher_serials
for all
to authenticated
using (public.is_finance_accounting())
with check (public.is_finance_accounting());

-- ---------------------------------------------------------------------------
-- expense_requests
-- ---------------------------------------------------------------------------

create policy expense_requests_select_scoped
on public.expense_requests
for select
to authenticated
using (public.can_read_expense_request(expense_requests));

create policy expense_requests_insert_own_or_finance
on public.expense_requests
for insert
to authenticated
with check (
  public.is_finance_accounting()
  or public.is_expense_request_owner(expense_requests)
);

create policy expense_requests_update_actor
on public.expense_requests
for update
to authenticated
using (public.can_update_expense_request(expense_requests))
with check (public.can_read_expense_request(expense_requests));

create policy expense_requests_delete_ceo_only
on public.expense_requests
for delete
to authenticated
using (public.current_finance_role() = 'ceo');

-- ---------------------------------------------------------------------------
-- invoices
-- ---------------------------------------------------------------------------

create policy invoices_select_scoped
on public.invoices
for select
to authenticated
using (public.can_read_invoice(invoices));

create policy invoices_insert_authenticated_requester
on public.invoices
for insert
to authenticated
with check (
  public.is_finance_accounting()
  or public.is_invoice_owner(invoices)
);

create policy invoices_update_actor
on public.invoices
for update
to authenticated
using (public.can_update_invoice(invoices))
with check (public.can_read_invoice(invoices));

create policy invoices_delete_ceo_only
on public.invoices
for delete
to authenticated
using (public.current_finance_role() = 'ceo');

-- ---------------------------------------------------------------------------
-- vouchers and ledger_entries
-- ---------------------------------------------------------------------------

create policy vouchers_select_accounting
on public.vouchers
for select
to authenticated
using (public.is_finance_accounting());

create policy vouchers_insert_accountant_ceo
on public.vouchers
for insert
to authenticated
with check (public.current_finance_role() in ('accountant','ceo'));

create policy vouchers_update_accountant_ceo
on public.vouchers
for update
to authenticated
using (public.current_finance_role() in ('accountant','ceo'))
with check (public.current_finance_role() in ('accountant','ceo'));

create policy vouchers_delete_ceo_only
on public.vouchers
for delete
to authenticated
using (public.current_finance_role() = 'ceo');

create policy ledger_entries_select_accounting
on public.ledger_entries
for select
to authenticated
using (public.is_finance_accounting());

create policy ledger_entries_insert_accountant_ceo
on public.ledger_entries
for insert
to authenticated
with check (public.current_finance_role() in ('accountant','ceo'));

create policy ledger_entries_update_accountant_ceo
on public.ledger_entries
for update
to authenticated
using (public.current_finance_role() in ('accountant','ceo'))
with check (public.current_finance_role() in ('accountant','ceo'));

create policy ledger_entries_delete_ceo_only
on public.ledger_entries
for delete
to authenticated
using (public.current_finance_role() = 'ceo');

-- ---------------------------------------------------------------------------
-- bills
-- ---------------------------------------------------------------------------

create policy bills_select_finance
on public.bills
for select
to authenticated
using (public.is_finance_accounting());

create policy bills_insert_finance
on public.bills
for insert
to authenticated
with check (public.is_finance_accounting());

create policy bills_update_finance
on public.bills
for update
to authenticated
using (public.is_finance_accounting())
with check (public.is_finance_accounting());

create policy bills_delete_ceo_only
on public.bills
for delete
to authenticated
using (public.current_finance_role() = 'ceo');

-- ---------------------------------------------------------------------------
-- notifications
-- ---------------------------------------------------------------------------
-- Current notifications table has no recipient column, so users can read system
-- notifications. Once recipient_id / recipient_role is added, scope this tighter.

create policy notifications_select_authenticated
on public.notifications
for select
to authenticated
using (public.current_finance_user_id() is not null);

create policy notifications_insert_finance_or_system_actor
on public.notifications
for insert
to authenticated
with check (public.is_finance_accounting());

create policy notifications_update_authenticated_read_state
on public.notifications
for update
to authenticated
using (public.current_finance_user_id() is not null)
with check (public.current_finance_user_id() is not null);

create policy notifications_delete_ceo_only
on public.notifications
for delete
to authenticated
using (public.current_finance_role() = 'ceo');

-- ---------------------------------------------------------------------------
-- audit logs
-- ---------------------------------------------------------------------------

create policy module_audit_logs_select_admin_accounting
on public.module_audit_logs
for select
to authenticated
using (public.is_finance_accounting());

-- No insert/update/delete policy for module_audit_logs.
-- Audit rows should only be written by database triggers.

commit;
