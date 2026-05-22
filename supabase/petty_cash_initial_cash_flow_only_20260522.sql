-- Petty cash initial funding is not an expense reimbursement and should not
-- create a formal voucher / ledger entry for balance sheet or P&L reporting.
-- It is shown only as a cash-flow event when the CEO disbursement step passes.

begin;

alter table public.expense_requests drop constraint if exists expense_requests_petty_initial_not_expense;

alter table public.expense_requests
  add constraint expense_requests_petty_initial_not_expense
  check (
    type <> 'petty_cash_request'
    or coalesce(petty_mode, 'general') <> 'initial'
    or coalesce(debit_account, '') in ('CF01','1191','')
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
      new.debit_account := 'CF01';
      new.debit_account_name := '零用金初次撥款-僅現金流控管';
      new.actual_amount := null;
      new.voucher_id := null;
      new.ledger_posted_at := null;
      new.form_payload := coalesce(new.form_payload, '{}'::jsonb)
        || jsonb_build_object(
          'pettyAccountingTreatment', 'cash_flow_only_no_voucher_no_bs_pl',
          'pettyExpenseRecognized', false,
          'voucherSuppressed', true,
          'voucherSuppressedReason', '零用金初次申請為公司墊付備用金，不產生正式傳票與分類帳分錄，只保留執行長放款現金流事件。'
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

commit;
