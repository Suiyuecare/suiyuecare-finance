-- Retire a legacy plaintext-password field that the application no longer uses.
-- Existing rows were verified empty. Fail closed if any credential-like value
-- appears, and let PostgreSQL reject any unknown schema dependency.
set local lock_timeout = '5s';

do $preflight$
begin
  if not exists (
    select 1 from pg_catalog.pg_attribute
    where attrelid='public.finance_users'::pg_catalog.regclass
      and attname='demo_password' and attnum>0 and not attisdropped
  ) then
    raise exception 'Expected retired demo_password column is missing';
  end if;

  if exists (
    select 1 from public.finance_users
    where demo_password is not null
  ) then
    raise exception 'finance_users.demo_password contains data; migration refused';
  end if;
end;
$preflight$;

drop trigger if exists trg_finance_strip_demo_password on public.finance_users;
drop function if exists public.finance_strip_demo_password();
alter table public.finance_users drop column demo_password;
