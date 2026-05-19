-- Module Finance audit log export support.
-- Apply after compliance_and_drafts.sql and rls_hardening.sql.
--
-- Purpose:
--   Keep compliance audit logs queryable/exportable by finance roles without
--   exposing them to general users. Frontend exports CSV; this RPC provides the
--   same filtered rowset from Supabase for formal exports.

begin;

create table if not exists public.compliance_audit_logs (
  id text primary key,
  action text not null,
  target text,
  detail text,
  actor_name text,
  actor_role text,
  created_at timestamptz not null default now()
);

alter table public.compliance_audit_logs add column if not exists entity_id text;
alter table public.compliance_audit_logs add column if not exists period text;
alter table public.compliance_audit_logs add column if not exists export_batch_id text;

create index if not exists idx_compliance_audit_logs_created_at
on public.compliance_audit_logs(created_at desc);

create index if not exists idx_compliance_audit_logs_entity_period
on public.compliance_audit_logs(entity_id, period, created_at desc);

alter table public.compliance_audit_logs enable row level security;
alter table public.compliance_audit_logs force row level security;

revoke all on table public.compliance_audit_logs from anon;
revoke all on table public.compliance_audit_logs from authenticated;
grant select, insert on table public.compliance_audit_logs to authenticated;

drop policy if exists compliance_audit_logs_select_finance on public.compliance_audit_logs;
drop policy if exists compliance_audit_logs_insert_finance on public.compliance_audit_logs;
drop policy if exists compliance_audit_logs_insert_authenticated on public.compliance_audit_logs;
drop policy if exists compliance_audit_logs_delete_ceo on public.compliance_audit_logs;

create policy compliance_audit_logs_select_finance
on public.compliance_audit_logs
for select
to authenticated
using (public.is_finance_accounting());

create policy compliance_audit_logs_insert_finance
on public.compliance_audit_logs
for insert
to authenticated
with check (public.is_finance_accounting());

create or replace function public.finance_audit_log_export(
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_entity_id text default null,
  p_period text default null
)
returns table (
  id text,
  created_at timestamptz,
  actor_name text,
  actor_role text,
  action text,
  target text,
  detail text,
  entity_id text,
  period text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    l.id,
    l.created_at,
    l.actor_name,
    l.actor_role,
    l.action,
    l.target,
    l.detail,
    l.entity_id,
    l.period
  from public.compliance_audit_logs l
  where public.is_finance_accounting()
    and (p_from is null or l.created_at >= p_from)
    and (p_to is null or l.created_at <= p_to)
    and (p_entity_id is null or l.entity_id = p_entity_id or l.entity_id is null)
    and (p_period is null or l.period = p_period or l.period is null)
  order by l.created_at desc;
$$;

revoke all on function public.finance_audit_log_export(timestamptz,timestamptz,text,text) from public, anon;
grant execute on function public.finance_audit_log_export(timestamptz,timestamptz,text,text) to authenticated;

commit;
