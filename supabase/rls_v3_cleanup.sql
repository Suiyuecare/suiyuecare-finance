-- Finance OS V3 RLS cleanup
-- Purpose:
--   1. Remove old broad "active finance users can access ..." policies that
--      bypass scoped request/invoice/ledger/voucher permissions.
--   2. Replace notification visibility with request/invoice-aware visibility.
--   3. Remove anonymous execute permission from the audit trigger function.

-- Remove legacy broad policies. Scoped policies are defined in
-- rls_hardening.sql / rls_formal_apply.sql.
drop policy if exists "active finance users can access expense requests" on public.expense_requests;
drop policy if exists "active finance users can access invoices" on public.invoices;
drop policy if exists "active finance users can access ledger entries" on public.ledger_entries;
drop policy if exists "active finance users can access vouchers" on public.vouchers;
drop policy if exists "active finance users can access bills" on public.bills;
drop policy if exists "active finance users can access notifications" on public.notifications;

create or replace function public.can_read_notification(p_notification public.notifications)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.current_finance_user_id() is not null
    and (
      p_notification.request_id is null
      or public.is_finance_accounting()
      or exists (
        select 1
        from public.expense_requests r
        where (r.id = p_notification.request_id or r.no = p_notification.request_id)
          and public.can_read_expense_request(r)
      )
      or exists (
        select 1
        from public.invoices i
        where (i.id = p_notification.request_id or i.no = p_notification.request_id)
          and public.can_read_invoice(i)
      )
    )
$$;

revoke all on function public.can_read_notification(public.notifications) from public, anon;
grant execute on function public.can_read_notification(public.notifications) to authenticated;

drop policy if exists notifications_select_authenticated on public.notifications;
drop policy if exists notifications_insert_finance_or_system_actor on public.notifications;
drop policy if exists notifications_update_authenticated_read_state on public.notifications;
drop policy if exists notifications_delete_ceo_only on public.notifications;
drop policy if exists notifications_select_scoped on public.notifications;
drop policy if exists notifications_insert_authenticated on public.notifications;
drop policy if exists notifications_update_scoped on public.notifications;

create policy notifications_select_scoped
on public.notifications
for select
to authenticated
using (public.can_read_notification(notifications));

create policy notifications_insert_authenticated
on public.notifications
for insert
to authenticated
with check (public.current_finance_user_id() is not null);

create policy notifications_update_scoped
on public.notifications
for update
to authenticated
using (public.can_read_notification(notifications))
with check (public.can_read_notification(notifications));

create policy notifications_delete_ceo_only
on public.notifications
for delete
to authenticated
using (public.current_finance_role() = 'ceo');

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Trigger functions should not be callable as public RPC endpoints.
revoke all on function public.write_module_audit_log() from public, anon, authenticated;
