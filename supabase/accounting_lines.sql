-- Module Finance P1: normalized accounting line audit table.
-- Apply after module_finance_production_schema.sql and RLS hardening scripts.

create table if not exists public.application_accounting_lines (
  id text primary key,
  request_id text not null,
  request_no text,
  line_index integer not null,
  source text not null default 'detail',
  description text,
  entity_id text,
  department_code text,
  gross_amount numeric not null default 0,
  net_amount numeric not null default 0,
  tax_amount numeric not null default 0,
  debit_account text,
  debit_account_name text,
  credit_account text,
  credit_account_name text,
  ai_reason text,
  reviewed_by text,
  reviewed_at timestamptz,
  payload jsonb not null default '{}'::jsonb,
  data_environment text not null default 'production',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (request_id, line_index)
);

create index if not exists idx_application_accounting_lines_request
  on public.application_accounting_lines(request_id, line_index);

create index if not exists idx_application_accounting_lines_env_entity
  on public.application_accounting_lines(data_environment, entity_id, department_code);

create or replace function public.touch_application_accounting_lines_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_application_accounting_lines_updated_at on public.application_accounting_lines;
create trigger trg_application_accounting_lines_updated_at
before update on public.application_accounting_lines
for each row execute function public.touch_application_accounting_lines_updated_at();

alter table public.application_accounting_lines enable row level security;
alter table public.application_accounting_lines force row level security;

revoke all on table public.application_accounting_lines from anon;
revoke all on table public.application_accounting_lines from authenticated;
grant select, insert, update on table public.application_accounting_lines to authenticated;

create or replace function public.can_access_application_accounting_lines(p_request_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.expense_requests r
    where r.id = p_request_id
      and (
        lower(coalesce(r.applicant_email, '')) = lower(coalesce((select auth.email()), ''))
        or exists (
          select 1
          from public.finance_users u
          where lower(u.email) = lower(coalesce((select auth.email()), ''))
            and u.role in ('accountant','ceo','admin_director')
        )
        or coalesce(r.steps, '[]'::jsonb)::text ilike '%' || coalesce((select auth.email()), '') || '%'
      )
  );
$$;

drop policy if exists application_accounting_lines_select on public.application_accounting_lines;
drop policy if exists application_accounting_lines_insert on public.application_accounting_lines;
drop policy if exists application_accounting_lines_update on public.application_accounting_lines;

create policy application_accounting_lines_select
on public.application_accounting_lines
for select
to authenticated
using (public.can_access_application_accounting_lines(request_id));

create policy application_accounting_lines_insert
on public.application_accounting_lines
for insert
to authenticated
with check (public.can_access_application_accounting_lines(request_id));

create policy application_accounting_lines_update
on public.application_accounting_lines
for update
to authenticated
using (
  exists (
    select 1 from public.finance_users u
    where lower(u.email) = lower(coalesce((select auth.email()), ''))
      and u.role in ('accountant','ceo','admin_director')
  )
)
with check (
  exists (
    select 1 from public.finance_users u
    where lower(u.email) = lower(coalesce((select auth.email()), ''))
      and u.role in ('accountant','ceo','admin_director')
  )
);
