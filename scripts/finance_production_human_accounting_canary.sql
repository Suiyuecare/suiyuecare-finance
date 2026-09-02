\set ON_ERROR_STOP on

do $human_accounting_canary$
declare
  v_old jsonb := jsonb_build_object(
    'netAmount', 1000,
    'taxAmount', 50,
    'grossAmount', 1050,
    'debitAccount', '6221',
    'creditAccount', '1112',
    'manualOverride', true,
    'valueAuthority', 'human',
    'manualFields', jsonb_build_array(
      'netAmount', 'taxAmount', 'grossAmount', 'debitAccount', 'creditAccount'
    ),
    'manualOverrideHistory', jsonb_build_array(jsonb_build_object('source', 'canary'))
  );
  v_stale_ai jsonb := jsonb_build_object(
    'netAmount', 952,
    'taxAmount', 48,
    'grossAmount', 1000,
    'debitAccount', '9999',
    'creditAccount', '9998',
    'manualOverride', false,
    'valueAuthority', 'ai'
  );
  v_result jsonb;
begin
  if to_regprocedure('private.finance_merge_human_accounting_line(jsonb,jsonb)') is null then
    raise exception 'human accounting merge function is missing';
  end if;

  if not exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.expense_requests'::regclass
      and tgname = 'trg_zz_finance_preserve_human_accounting_authority'
      and not tgisinternal
  ) or not exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.expense_requests'::regclass
      and tgname = 'trg_zz_finance_sync_request_accounting_lines'
      and not tgisinternal
  ) then
    raise exception 'human accounting authority triggers are incomplete';
  end if;

  v_result := private.finance_merge_human_accounting_line(v_old, v_stale_ai);
  if v_result ->> 'netAmount' <> '1000'
     or v_result ->> 'taxAmount' <> '50'
     or v_result ->> 'grossAmount' <> '1050'
     or v_result ->> 'debitAccount' <> '6221'
     or v_result ->> 'creditAccount' <> '1112'
     or v_result ->> 'valueAuthority' <> 'human'
     or coalesce((v_result ->> 'manualOverride')::boolean, false) is not true then
    raise exception 'stale AI values overrode reviewed human accounting values';
  end if;
end;
$human_accounting_canary$;

select jsonb_build_object(
  'canary', 'human_accounting_authority',
  'human_values_preserved', true,
  'database_objects_verified', true,
  'read_only', true,
  'ok', true
) as human_accounting_canary_result;
