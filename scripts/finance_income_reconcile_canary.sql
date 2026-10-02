-- This canary has no application identity and runs in a read-only transaction.
begin isolation level repeatable read read only;
set local statement_timeout = '20s';

-- FINANCE_AUTHENTICATED_CANARY_CORE_BEGIN
do $canary$
declare
  v_denied boolean := false;
begin
  if auth.uid() is not null then
    raise exception 'income reconciliation canary must run without a user identity';
  end if;
  begin
    perform public.finance_income_reconcile_submission_v1(
      'invoice', 'fictional-income-canary-0001', 'production');
  exception when sqlstate '42501' then
    v_denied := true;
  end;
  if not v_denied then
    raise exception 'income reconciliation accepted an unauthenticated caller';
  end if;
end;
$canary$;
-- FINANCE_AUTHENTICATED_CANARY_CORE_END

rollback;
-- FINANCE_AUTHENTICATED_CANARY_ROLLBACK_CHECK_BEGIN
do $rollback_check$
begin
  if pg_catalog.current_setting('transaction_read_only') = 'on' then
    raise exception 'income reconciliation canary transaction remained open';
  end if;
end;
$rollback_check$;
-- FINANCE_AUTHENTICATED_CANARY_ROLLBACK_CHECK_END
select
  'FINANCE_INCOME_RECONCILE_CANARY_ROLLED_BACK' as marker,
  pg_catalog.jsonb_build_object(
    'canary', 'readonly_income_reconcile_v1',
    'ok', true,
    'rolled_back', true,
    'identity_scope_preserved', true
  ) as income_reconcile_canary_result;
