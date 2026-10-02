-- Transactional fictional-row test; no production business row is changed.
begin isolation level repeatable read;
set local statement_timeout = '20s';
set local lock_timeout = '3s';

-- FINANCE_AUTHENTICATED_CANARY_CORE_BEGIN
do $canary$
declare
  v_human jsonb := pg_catalog.jsonb_build_object(
    'id', 'fictional_line',
    'netAmount', 12.1,
    'taxAmount', 0.30000000000000004,
    'grossAmount', 12.4,
    'debitAccount', '6217',
    'creditAccount', '1112',
    'manualOverride', true,
    'valueAuthority', 'human',
    'manualFields', pg_catalog.jsonb_build_array(
      'netAmount', 'taxAmount', 'grossAmount',
      'debitAccount', 'creditAccount'
    ),
    'manualOverrideHistory', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('at', 'fictional_review')
    )
  );
  v_saved jsonb;
  v_rejected boolean := false;
begin
  execute 'create temporary table finance_human_float_fixture (
    id text primary key, form_payload jsonb not null) on commit drop';
  execute 'create trigger finance_human_float_fixture_guard
    before update on finance_human_float_fixture for each row
    execute function private.finance_preserve_human_accounting_authority()';
  insert into finance_human_float_fixture(id, form_payload)
  values ('tail', pg_catalog.jsonb_build_object(
    'accountingLines', pg_catalog.jsonb_build_array(v_human)));

  update finance_human_float_fixture
  set form_payload = pg_catalog.jsonb_build_object(
    'accountingLines', pg_catalog.jsonb_build_array(
      v_human || pg_catalog.jsonb_build_object(
        'netAmount', 12.4,
        'taxAmount', 0,
        'debitAccount', '9999',
        'manualOverride', false,
        'valueAuthority', 'system',
        'manualFields', '[]'::jsonb
      )
    )
  )
  where id = 'tail';
  select form_payload -> 'accountingLines' -> 0
    into v_saved
  from finance_human_float_fixture where id = 'tail';
  if v_saved -> 'netAmount' is distinct from v_human -> 'netAmount'
     or v_saved -> 'taxAmount' is distinct from v_human -> 'taxAmount'
     or v_saved -> 'grossAmount' is distinct from v_human -> 'grossAmount'
     or v_saved -> 'debitAccount' is distinct from v_human -> 'debitAccount'
     or v_saved -> 'creditAccount' is distinct from v_human -> 'creditAccount'
     or v_saved -> 'manualOverrideHistory'
        is distinct from v_human -> 'manualOverrideHistory' then
    raise exception 'human accounting values or audit history were not preserved';
  end if;

  insert into finance_human_float_fixture(id, form_payload)
  values ('bad', pg_catalog.jsonb_build_object(
    'accountingLines', pg_catalog.jsonb_build_array(
      v_human || pg_catalog.jsonb_build_object('grossAmount', 12.41)
    )));
  begin
    update finance_human_float_fixture
    set form_payload = form_payload where id = 'bad';
  exception when check_violation then
    v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'materially unbalanced human accounting line passed';
  end if;
end;
$canary$;
-- FINANCE_AUTHENTICATED_CANARY_CORE_END

rollback;
-- FINANCE_AUTHENTICATED_CANARY_ROLLBACK_CHECK_BEGIN
do $rollback_check$
begin
  if pg_catalog.to_regclass('pg_temp.finance_human_float_fixture') is not null then
    raise exception 'fictional accounting canary table survived rollback';
  end if;
end;
$rollback_check$;
-- FINANCE_AUTHENTICATED_CANARY_ROLLBACK_CHECK_END
select 'FINANCE_HUMAN_FLOAT_CANARY_ROLLED_BACK' as marker;
