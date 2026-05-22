-- Reusable payee bank accounts for payment shortcuts.
-- Deduplication key: data_environment + normalized payee/bank/branch/account.

create table if not exists public.payee_bank_accounts (
  id text primary key,
  payee text not null,
  bank_type text,
  bank_name text not null,
  bank_branch text not null,
  bank_no text not null,
  account_key text not null,
  passbook_files jsonb not null default '[]'::jsonb,
  note text,
  use_count integer not null default 0 check (use_count >= 0),
  last_used_at timestamptz,
  active boolean not null default true,
  data_environment text not null default 'production' check (data_environment in ('production','test')),
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_payee_bank_accounts_env_key
  on public.payee_bank_accounts(data_environment, account_key);

create index if not exists idx_payee_bank_accounts_lookup
  on public.payee_bank_accounts(data_environment, active, payee, bank_name, bank_branch);

create or replace function public.touch_payee_bank_accounts_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_payee_bank_accounts_updated_at on public.payee_bank_accounts;
create trigger trg_payee_bank_accounts_updated_at
before update on public.payee_bank_accounts
for each row execute function public.touch_payee_bank_accounts_updated_at();

alter table public.payee_bank_accounts enable row level security;
alter table public.payee_bank_accounts force row level security;

revoke all on table public.payee_bank_accounts from anon;
revoke all on table public.payee_bank_accounts from authenticated;
grant select, insert, update on table public.payee_bank_accounts to authenticated;

drop policy if exists payee_bank_accounts_select_active_finance_user on public.payee_bank_accounts;
drop policy if exists payee_bank_accounts_insert_active_finance_user on public.payee_bank_accounts;
drop policy if exists payee_bank_accounts_update_active_finance_user on public.payee_bank_accounts;

create policy payee_bank_accounts_select_active_finance_user
on public.payee_bank_accounts
for select
to authenticated
using (
  exists (
    select 1 from public.finance_users fu
    where lower(fu.email) = lower(auth.jwt() ->> 'email')
      and fu.active = true
  )
);

create policy payee_bank_accounts_insert_active_finance_user
on public.payee_bank_accounts
for insert
to authenticated
with check (
  exists (
    select 1 from public.finance_users fu
    where lower(fu.email) = lower(auth.jwt() ->> 'email')
      and fu.active = true
  )
);

create policy payee_bank_accounts_update_active_finance_user
on public.payee_bank_accounts
for update
to authenticated
using (
  exists (
    select 1 from public.finance_users fu
    where lower(fu.email) = lower(auth.jwt() ->> 'email')
      and fu.active = true
  )
)
with check (
  exists (
    select 1 from public.finance_users fu
    where lower(fu.email) = lower(auth.jwt() ->> 'email')
      and fu.active = true
  )
);
