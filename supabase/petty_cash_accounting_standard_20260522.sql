-- Standard petty cash accounting.
-- Initial funding: Dr 1111 petty cash / Cr 1112 bank, no P&L.
-- Reimbursement: Dr expense / Cr 1111 petty cash, then Dr 1111 / Cr 1112
-- to replenish the approved amount. This prevents duplicate expense booking.

begin;

alter table public.expense_requests drop constraint if exists expense_requests_petty_initial_not_expense;

alter table public.expense_requests
  add constraint expense_requests_petty_initial_not_expense
  check (
    type <> 'petty_cash_request'
    or coalesce(petty_mode, 'general') <> 'initial'
    or coalesce(debit_account, '') in ('1111','')
  )
  not valid;

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

commit;
