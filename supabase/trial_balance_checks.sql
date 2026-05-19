-- Module Finance trial balance checks.
-- Apply after module_finance_production_schema.sql and accounting_rpc.sql.
--
-- Purpose:
--   Provide a database-side, official-ledger-only check for:
--   1. Period debit = credit
--   2. Cumulative debit = credit
--   3. Asset = liability + equity + current period P/L
--   4. Missing source / malformed ledger rows / duplicate posting keys

begin;

create or replace function public.period_range(
  p_period text,
  out start_date date,
  out end_date date
)
returns record
language plpgsql
stable
as $$
declare
  y int;
  q int;
  m int;
begin
  if p_period ~ '^[0-9]{4}$' then
    y := p_period::int;
    start_date := make_date(y, 1, 1);
    end_date := make_date(y, 12, 31);
  elsif p_period ~ '^[0-9]{4}-Q[1-4]$' then
    y := substring(p_period from 1 for 4)::int;
    q := substring(p_period from 7 for 1)::int;
    start_date := make_date(y, (q - 1) * 3 + 1, 1);
    end_date := (start_date + interval '3 months - 1 day')::date;
  else
    y := substring(coalesce(p_period, to_char(current_date, 'YYYY-MM')) from 1 for 4)::int;
    m := substring(coalesce(p_period, to_char(current_date, 'YYYY-MM')) from 6 for 2)::int;
    start_date := make_date(y, m, 1);
    end_date := (start_date + interval '1 month - 1 day')::date;
  end if;
end;
$$;

create or replace function public.finance_trial_balance(
  p_entity_id text,
  p_period text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r record;
  period_dr numeric := 0;
  period_cr numeric := 0;
  td_dr numeric := 0;
  td_cr numeric := 0;
  asset_total numeric := 0;
  liability_total numeric := 0;
  equity_total numeric := 0;
  revenue_total numeric := 0;
  expense_total numeric := 0;
  net_income numeric := 0;
  bs_diff numeric := 0;
  missing_source int := 0;
  malformed_rows int := 0;
  duplicate_keys int := 0;
begin
  if not public.is_finance_accounting() then
    raise exception 'Only accounting, admin director, or CEO can run trial balance checks';
  end if;

  select * into r from public.period_range(p_period);

  select
    coalesce(sum(debit), 0),
    coalesce(sum(credit), 0)
  into period_dr, period_cr
  from public.ledger_entries
  where entity_id = p_entity_id
    and entry_date between r.start_date and r.end_date
    and voided_at is null;

  select
    coalesce(sum(debit), 0),
    coalesce(sum(credit), 0)
  into td_dr, td_cr
  from public.ledger_entries
  where entity_id = p_entity_id
    and entry_date <= r.end_date
    and voided_at is null;

  select
    coalesce(sum(case when account_code like '1%' then debit - credit else 0 end), 0),
    coalesce(sum(case when account_code like '2%' then credit - debit else 0 end), 0),
    coalesce(sum(case when account_code like '3%' then credit - debit else 0 end), 0)
  into asset_total, liability_total, equity_total
  from public.ledger_entries
  where entity_id = p_entity_id
    and entry_date <= r.end_date
    and voided_at is null;

  select
    coalesce(sum(case when account_code like '4%' or account_code like '7%' then credit - debit else 0 end), 0),
    coalesce(sum(case when account_code like '5%' or account_code like '6%' or account_code like '9%' then debit - credit else 0 end), 0)
  into revenue_total, expense_total
  from public.ledger_entries
  where entity_id = p_entity_id
    and entry_date between r.start_date and r.end_date
    and voided_at is null;

  net_income := revenue_total - expense_total;
  bs_diff := asset_total - (liability_total + equity_total + net_income);

  select count(*)
  into missing_source
  from public.ledger_entries
  where entity_id = p_entity_id
    and entry_date between r.start_date and r.end_date
    and voided_at is null
    and coalesce(reference_no, source_no, voucher_no, posting_key, '') = '';

  select count(*)
  into malformed_rows
  from public.ledger_entries
  where entity_id = p_entity_id
    and entry_date between r.start_date and r.end_date
    and voided_at is null
    and (
      (coalesce(debit, 0) > 0 and coalesce(credit, 0) > 0)
      or (coalesce(debit, 0) = 0 and coalesce(credit, 0) = 0)
    );

  select count(*)
  into duplicate_keys
  from (
    select posting_key
    from public.ledger_entries
    where entity_id = p_entity_id
      and entry_date between r.start_date and r.end_date
      and voided_at is null
      and posting_key is not null
    group by posting_key
    having count(*) > 1
  ) d;

  return jsonb_build_object(
    'entity_id', p_entity_id,
    'period', p_period,
    'start_date', r.start_date,
    'end_date', r.end_date,
    'period_debit', period_dr,
    'period_credit', period_cr,
    'period_diff', period_dr - period_cr,
    'to_date_debit', td_dr,
    'to_date_credit', td_cr,
    'to_date_diff', td_dr - td_cr,
    'asset_total', asset_total,
    'liability_total', liability_total,
    'equity_total', equity_total,
    'net_income', net_income,
    'balance_sheet_diff', bs_diff,
    'missing_source_count', missing_source,
    'malformed_row_count', malformed_rows,
    'duplicate_posting_key_count', duplicate_keys,
    'ok',
      abs(period_dr - period_cr) < 0.5
      and abs(td_dr - td_cr) < 0.5
      and abs(bs_diff) < 0.5
      and missing_source = 0
      and malformed_rows = 0
      and duplicate_keys = 0
  );
end;
$$;

revoke all on function public.period_range(text) from public, anon;
revoke all on function public.finance_trial_balance(text,text) from public, anon;
grant execute on function public.finance_trial_balance(text,text) to authenticated;

commit;
