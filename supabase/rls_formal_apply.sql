-- Formal RLS apply script for Module Finance.
-- Run after:
--   1. module_finance_production_schema.sql
--   2. compliance_and_drafts.sql
--   3. storage_attachments.sql
--   4. accounting_rpc.sql
--   5. rls_hardening.sql
--
-- Purpose:
--   * Remove broad anon/authenticated table grants.
--   * Force RLS on every exposed public table used by the finance app.
--   * Keep the SPA usable through authenticated Data API access.
--   * Tighten notifications to request/invoice visibility instead of global read/update.

begin;

-- ---------------------------------------------------------------------------
-- Exposed schema grants
-- ---------------------------------------------------------------------------

revoke all on schema public from anon;
grant usage on schema public to authenticated;

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

revoke all on table
  public.finance_users,
  public.system_settings,
  public.voucher_serials,
  public.expense_requests,
  public.invoices,
  public.vouchers,
  public.bills,
  public.notifications,
  public.ledger_entries,
  public.module_audit_logs
from authenticated;

grant select, insert, update, delete on table public.finance_users to authenticated;
grant select, insert, update, delete on table public.system_settings to authenticated;
grant select, insert, update on table public.voucher_serials to authenticated;
grant select, insert, update, delete on table public.expense_requests to authenticated;
grant select, insert, update, delete on table public.invoices to authenticated;
grant select, insert, update, delete on table public.vouchers to authenticated;
grant select, insert, update, delete on table public.bills to authenticated;
grant select, insert, update, delete on table public.notifications to authenticated;
grant select, insert, update, delete on table public.ledger_entries to authenticated;
grant select on table public.module_audit_logs to authenticated;
grant usage, select on all sequences in schema public to authenticated;

do $$
begin
  if to_regclass('public.draft_requests') is not null then
    execute 'revoke all on table public.draft_requests from anon, authenticated';
    execute 'grant select, insert, update, delete on table public.draft_requests to authenticated';
  end if;
  if to_regclass('public.period_closes') is not null then
    execute 'revoke all on table public.period_closes from anon, authenticated';
    execute 'grant select, insert, update, delete on table public.period_closes to authenticated';
  end if;
  if to_regclass('public.compliance_archives') is not null then
    execute 'revoke all on table public.compliance_archives from anon, authenticated';
    execute 'grant select, insert, update, delete on table public.compliance_archives to authenticated';
  end if;
  if to_regclass('public.annual_reviews') is not null then
    execute 'revoke all on table public.annual_reviews from anon, authenticated';
    execute 'grant select, insert, update, delete on table public.annual_reviews to authenticated';
  end if;
  if to_regclass('public.compliance_audit_logs') is not null then
    execute 'revoke all on table public.compliance_audit_logs from anon, authenticated';
    execute 'grant select, insert, delete on table public.compliance_audit_logs to authenticated';
  end if;
  if to_regclass('public.file_attachments') is not null then
    execute 'revoke all on table public.file_attachments from anon, authenticated';
    execute 'grant select, insert, delete on table public.file_attachments to authenticated';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Enforce RLS on every public table used by the app
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

do $$
begin
  if to_regclass('public.draft_requests') is not null then
    execute 'alter table public.draft_requests enable row level security';
    execute 'alter table public.draft_requests force row level security';
  end if;
  if to_regclass('public.period_closes') is not null then
    execute 'alter table public.period_closes enable row level security';
    execute 'alter table public.period_closes force row level security';
  end if;
  if to_regclass('public.compliance_archives') is not null then
    execute 'alter table public.compliance_archives enable row level security';
    execute 'alter table public.compliance_archives force row level security';
  end if;
  if to_regclass('public.annual_reviews') is not null then
    execute 'alter table public.annual_reviews enable row level security';
    execute 'alter table public.annual_reviews force row level security';
  end if;
  if to_regclass('public.compliance_audit_logs') is not null then
    execute 'alter table public.compliance_audit_logs enable row level security';
    execute 'alter table public.compliance_audit_logs force row level security';
  end if;
  if to_regclass('public.file_attachments') is not null then
    execute 'alter table public.file_attachments enable row level security';
    execute 'alter table public.file_attachments force row level security';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Notification visibility helper
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- Verification snapshot for SQL Editor / CLI output
-- ---------------------------------------------------------------------------

create or replace view public.rls_formal_status
with (security_invoker = true)
as
select
  n.nspname as schema_name,
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as rls_forced,
  count(p.polname) as policy_count
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_policy p on p.polrelid = c.oid
where n.nspname = 'public'
  and c.relkind = 'r'
  and c.relname in (
    'finance_users',
    'system_settings',
    'voucher_serials',
    'expense_requests',
    'invoices',
    'vouchers',
    'bills',
    'notifications',
    'ledger_entries',
    'module_audit_logs',
    'draft_requests',
    'period_closes',
    'compliance_archives',
    'annual_reviews',
    'compliance_audit_logs',
    'file_attachments'
  )
group by n.nspname, c.relname, c.relrowsecurity, c.relforcerowsecurity
order by c.relname;

grant select on public.rls_formal_status to authenticated;

commit;
