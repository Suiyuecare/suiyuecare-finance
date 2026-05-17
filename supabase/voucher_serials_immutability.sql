-- Formal voucher serial numbers and immutable posted vouchers.
-- Apply after posting_idempotency_hardening.sql, then re-apply accounting_rpc.sql.

begin;

create table if not exists public.voucher_serials (
  kind text not null,
  year int not null,
  last_no int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (kind, year)
);

alter table public.vouchers add column if not exists posted_at timestamptz not null default now();
alter table public.vouchers add column if not exists posting_locked_at timestamptz;
alter table public.vouchers add column if not exists voided_at timestamptz;
alter table public.vouchers add column if not exists adjusts_voucher_no text;
alter table public.vouchers add column if not exists adjustment_type text;

do $$
begin
  alter table public.vouchers add constraint vouchers_adjustment_type_check
  check (adjustment_type is null or adjustment_type in ('reversal','adjustment'));
exception
  when duplicate_object then null;
end $$;

create or replace function public.prevent_posted_voucher_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op in ('UPDATE','DELETE') and old.posted = true and old.voided_at is null then
    raise exception 'Posted vouchers are immutable; create a reversal or adjustment voucher instead.';
  end if;
  return coalesce(new, old);
end;
$$;

create or replace function public.prevent_posted_ledger_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op in ('UPDATE','DELETE') and old.posting_key is not null and old.voided_at is null then
    raise exception 'Posted ledger entries are immutable; create a reversal or adjustment voucher instead.';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_prevent_posted_voucher_mutation on public.vouchers;
create trigger trg_prevent_posted_voucher_mutation before update or delete on public.vouchers
for each row execute function public.prevent_posted_voucher_mutation();

drop trigger if exists trg_prevent_posted_ledger_mutation on public.ledger_entries;
create trigger trg_prevent_posted_ledger_mutation before update or delete on public.ledger_entries
for each row execute function public.prevent_posted_ledger_mutation();

commit;
