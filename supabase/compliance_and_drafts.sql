-- Module Finance drafts and compliance persistence.
-- Apply after module_finance_production_schema.sql and rls_hardening.sql.

begin;

create table if not exists public.draft_requests (
  id text primary key,
  owner_id text,
  owner_email text not null,
  owner_name text,
  application_type text,
  title text,
  amount numeric(14,2),
  applicant text,
  payload jsonb not null default '{}'::jsonb,
  files jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.period_closes (
  id text primary key,
  entity_id text not null,
  period text not null,
  status text not null default 'closed',
  closed_by text,
  closed_at timestamptz not null default now(),
  note text,
  unique(entity_id, period)
);

create table if not exists public.compliance_archives (
  id text primary key,
  entity_id text not null,
  period text not null,
  docs_count int not null default 0,
  file_count int not null default 0,
  archived_by text,
  archived_at timestamptz not null default now(),
  retain_docs_until date,
  retain_books_until date
);

create table if not exists public.annual_reviews (
  id text primary key,
  entity_id text not null,
  period text not null,
  status text not null default 'approved',
  reviewed_by text,
  reviewed_at timestamptz not null default now(),
  note text,
  unique(entity_id, period)
);

create table if not exists public.compliance_audit_logs (
  id text primary key,
  action text not null,
  target text,
  detail text,
  actor_name text,
  actor_role text,
  created_at timestamptz not null default now()
);

alter table public.draft_requests enable row level security;
alter table public.period_closes enable row level security;
alter table public.compliance_archives enable row level security;
alter table public.annual_reviews enable row level security;
alter table public.compliance_audit_logs enable row level security;

alter table public.draft_requests force row level security;
alter table public.period_closes force row level security;
alter table public.compliance_archives force row level security;
alter table public.annual_reviews force row level security;
alter table public.compliance_audit_logs force row level security;

revoke all on table public.draft_requests from anon;
revoke all on table public.period_closes from anon;
revoke all on table public.compliance_archives from anon;
revoke all on table public.annual_reviews from anon;
revoke all on table public.compliance_audit_logs from anon;

revoke all on table public.draft_requests from authenticated;
revoke all on table public.period_closes from authenticated;
revoke all on table public.compliance_archives from authenticated;
revoke all on table public.annual_reviews from authenticated;
revoke all on table public.compliance_audit_logs from authenticated;

grant select, insert, update, delete on table public.draft_requests to authenticated;
grant select, insert, update, delete on table public.period_closes to authenticated;
grant select, insert, update, delete on table public.compliance_archives to authenticated;
grant select, insert, update, delete on table public.annual_reviews to authenticated;
grant select, insert, update, delete on table public.compliance_audit_logs to authenticated;

drop policy if exists draft_requests_select_own on public.draft_requests;
drop policy if exists draft_requests_insert_own on public.draft_requests;
drop policy if exists draft_requests_update_own on public.draft_requests;
drop policy if exists draft_requests_delete_own on public.draft_requests;

create policy draft_requests_select_own
on public.draft_requests
for select
to authenticated
using (
  lower(owner_email) = lower(auth.jwt() ->> 'email')
  or owner_id = public.current_finance_user_id()
  or public.is_finance_admin()
);

create policy draft_requests_insert_own
on public.draft_requests
for insert
to authenticated
with check (
  lower(owner_email) = lower(auth.jwt() ->> 'email')
  or owner_id = public.current_finance_user_id()
);

create policy draft_requests_update_own
on public.draft_requests
for update
to authenticated
using (
  lower(owner_email) = lower(auth.jwt() ->> 'email')
  or owner_id = public.current_finance_user_id()
)
with check (
  lower(owner_email) = lower(auth.jwt() ->> 'email')
  or owner_id = public.current_finance_user_id()
);

create policy draft_requests_delete_own
on public.draft_requests
for delete
to authenticated
using (
  lower(owner_email) = lower(auth.jwt() ->> 'email')
  or owner_id = public.current_finance_user_id()
);

drop policy if exists period_closes_select_finance on public.period_closes;
drop policy if exists period_closes_insert_finance on public.period_closes;
drop policy if exists period_closes_update_ceo on public.period_closes;
drop policy if exists period_closes_delete_ceo on public.period_closes;

create policy period_closes_select_finance on public.period_closes for select to authenticated using (public.is_finance_accounting());
create policy period_closes_insert_finance on public.period_closes for insert to authenticated with check (public.is_finance_accounting());
create policy period_closes_update_ceo on public.period_closes for update to authenticated using (public.current_finance_role() = 'ceo') with check (public.current_finance_role() = 'ceo');
create policy period_closes_delete_ceo on public.period_closes for delete to authenticated using (public.current_finance_role() = 'ceo');

drop policy if exists compliance_archives_select_finance on public.compliance_archives;
drop policy if exists compliance_archives_insert_finance on public.compliance_archives;
drop policy if exists compliance_archives_update_ceo on public.compliance_archives;
drop policy if exists compliance_archives_delete_ceo on public.compliance_archives;

create policy compliance_archives_select_finance on public.compliance_archives for select to authenticated using (public.is_finance_accounting());
create policy compliance_archives_insert_finance on public.compliance_archives for insert to authenticated with check (public.is_finance_accounting());
create policy compliance_archives_update_ceo on public.compliance_archives for update to authenticated using (public.current_finance_role() = 'ceo') with check (public.current_finance_role() = 'ceo');
create policy compliance_archives_delete_ceo on public.compliance_archives for delete to authenticated using (public.current_finance_role() = 'ceo');

drop policy if exists annual_reviews_select_finance on public.annual_reviews;
drop policy if exists annual_reviews_insert_ceo on public.annual_reviews;
drop policy if exists annual_reviews_update_ceo on public.annual_reviews;
drop policy if exists annual_reviews_delete_ceo on public.annual_reviews;

create policy annual_reviews_select_finance on public.annual_reviews for select to authenticated using (public.is_finance_accounting());
create policy annual_reviews_insert_ceo on public.annual_reviews for insert to authenticated with check (public.current_finance_role() = 'ceo');
create policy annual_reviews_update_ceo on public.annual_reviews for update to authenticated using (public.current_finance_role() = 'ceo') with check (public.current_finance_role() = 'ceo');
create policy annual_reviews_delete_ceo on public.annual_reviews for delete to authenticated using (public.current_finance_role() = 'ceo');

drop policy if exists compliance_audit_logs_select_finance on public.compliance_audit_logs;
drop policy if exists compliance_audit_logs_insert_authenticated on public.compliance_audit_logs;
drop policy if exists compliance_audit_logs_insert_finance on public.compliance_audit_logs;
drop policy if exists compliance_audit_logs_delete_ceo on public.compliance_audit_logs;

create policy compliance_audit_logs_select_finance on public.compliance_audit_logs for select to authenticated using (public.is_finance_accounting());
create policy compliance_audit_logs_insert_finance on public.compliance_audit_logs for insert to authenticated with check (public.is_finance_accounting());
create policy compliance_audit_logs_delete_ceo on public.compliance_audit_logs for delete to authenticated using (public.current_finance_role() = 'ceo');

commit;
