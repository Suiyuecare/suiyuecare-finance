-- Petty cash must not be accidentally recognized as a normal expense twice.
-- Initial petty cash funding moves bank cash into petty cash asset, with no P&L.
-- General petty cash reimbursement recognizes receipts as expense once, then
-- replenishes petty cash back to the approved amount.

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
        or coalesce(debit_account, '') in ('1111','')
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
      new.debit_account := '1111';
      new.debit_account_name := '零用金';
      new.credit_account := '1112';
      new.credit_account_name := '銀行存款';
      new.actual_amount := null;
      new.form_payload := coalesce(new.form_payload, '{}'::jsonb)
        || jsonb_build_object(
          'pettyAccountingTreatment', 'initial_fund_asset_no_expense',
          'pettyExpenseRecognized', false,
          'pettyAccountingRule', 'Dr 1111 零用金 / Cr 1112 銀行存款；不進損益表'
        );
    else
      new.form_payload := coalesce(new.form_payload, '{}'::jsonb)
        || jsonb_build_object(
          'pettyAccountingTreatment', 'reimbursement_expense_then_replenish',
          'pettyAccountingRule', '依憑據 Dr 費用 / Cr 1111 零用金，再補足 Dr 1111 / Cr 1112，費用只認列一次'
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
