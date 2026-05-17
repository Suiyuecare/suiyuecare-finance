-- Petty cash must not be accidentally recognized as a normal expense twice.
-- Initial petty cash funding is an asset / temporary-payment control event.
-- General petty cash reimbursement is recognized as expense once, at final accounting.

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'expense_requests_petty_mode_valid'
      and conrelid = 'public.expense_requests'::regclass
  ) then
    alter table public.expense_requests
      add constraint expense_requests_petty_mode_valid
      check (type <> 'petty_cash_request' or coalesce(petty_mode, 'general') in ('initial','general'))
      not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'expense_requests_petty_initial_not_expense'
      and conrelid = 'public.expense_requests'::regclass
  ) then
    alter table public.expense_requests
      add constraint expense_requests_petty_initial_not_expense
      check (
        type <> 'petty_cash_request'
        or coalesce(petty_mode, 'general') <> 'initial'
        or left(coalesce(debit_account, ''), 1) = '1'
      )
      not valid;
  end if;
end $$;

create or replace function public.enforce_petty_cash_non_duplicate()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.type = 'petty_cash_request' then
    new.petty_mode := coalesce(nullif(new.petty_mode, ''), 'general');

    if new.petty_mode = 'initial' then
      new.debit_account := '1191';
      new.debit_account_name := '暫付款-零用金初次申請';
      new.actual_amount := null;
      new.form_payload := coalesce(new.form_payload, '{}'::jsonb)
        || jsonb_build_object(
          'pettyAccountingTreatment', 'initial_fund_non_expense',
          'pettyExpenseRecognized', false
        );
    else
      new.form_payload := coalesce(new.form_payload, '{}'::jsonb)
        || jsonb_build_object(
          'pettyAccountingTreatment', 'reimbursement_expense_once'
        );
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_petty_cash_non_duplicate on public.expense_requests;
create trigger trg_enforce_petty_cash_non_duplicate
before insert or update on public.expense_requests
for each row
execute function public.enforce_petty_cash_non_duplicate();
