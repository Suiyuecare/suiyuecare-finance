\set ON_ERROR_STOP on
-- Read-only, repeatable after rollback rehearsal or apply; no temp tables or
-- migration-ledger dependency, and no rewrite/scan of historical expense data.
do $finance_utility_tax_postflight$
declare v_fn oid;v_rejected boolean:=false;v_request public.expense_requests%rowtype;
begin
  foreach v_fn in array array[
    'private.finance_utility_line_v1(jsonb)'::regprocedure::oid,
    'private.finance_assert_utility_lines_v1(jsonb)'::regprocedure::oid,
    'private.finance_utility_expense_guard_v1()'::regprocedure::oid,
    'private.finance_assert_utility_posting_v1(public.expense_requests,jsonb,jsonb)'::regprocedure::oid,
    'private.finance_finalize_utility_advance_patch_v1(public.expense_requests,jsonb,jsonb,numeric,text)'::regprocedure::oid,
    'private.finance_correction_patch_v1(public.expense_requests,jsonb,text)'::regprocedure::oid
  ] loop
    if not exists(select 1 from pg_catalog.pg_proc where oid=v_fn and proconfig=array['search_path=""'] and pg_catalog.pg_get_userbyid(proowner)='postgres')
      or pg_catalog.has_function_privilege('anon',v_fn,'execute')
      or pg_catalog.has_function_privilege('authenticated',v_fn,'execute')
      or pg_catalog.has_function_privilege('service_role',v_fn,'execute') then
      raise exception 'Utility postflight function ownership, search path or private ACL differs';end if;
  end loop;
  if not exists(select 1 from pg_catalog.pg_trigger where tgrelid='public.expense_requests'::regclass
    and tgname='trg_zzz_finance_utility_expense_guard_v1' and tgfoid='private.finance_utility_expense_guard_v1()'::regprocedure
    and tgenabled='O' and not tgisinternal and tgtype=23)
    or not exists(select 1 from pg_catalog.pg_trigger where tgrelid='public.expense_requests'::regclass
      and tgname='trg_zz_finance_preserve_human_accounting_authority' and tgenabled='O' and not tgisinternal)
    or exists(select 1 from pg_catalog.pg_trigger where tgrelid='public.expense_requests'::regclass
      and tgfoid='private.finance_preserve_human_accounting_authority()'::regprocedure
      and tgname>='trg_zzz_finance_utility_expense_guard_v1' and tgenabled<>'D' and not tgisinternal) then
    raise exception 'Utility postflight human-merge / guard trigger order differs';end if;
  if not exists(select 1 from pg_catalog.pg_proc where oid='public.finalize_expense_request(text,text,integer,jsonb,numeric,numeric,text,text,text,jsonb,numeric,text,date,jsonb)'::regprocedure
      and prosecdef and proconfig=array['search_path=""'] and prosrc like '%private.finance_assert_utility_posting_v1(%'
      and prosrc like '%private.finance_finalize_accounting_patch_v1(%'
      and prosrc like '%private.finance_finalize_utility_advance_patch_v1(%') then
    raise exception 'Utility postflight finalizer assertion is missing';end if;
  if not exists(select 1 from pg_catalog.pg_proc where oid='private.finance_correction_patch_v1(public.expense_requests,jsonb,text)'::regprocedure
      and prosrc like '%perform private.finance_assert_utility_lines_v1(v_merged);%')
    or not exists(select 1 from pg_catalog.pg_proc where oid='private.finance_finalize_utility_advance_patch_v1(public.expense_requests,jsonb,jsonb,numeric,text)'::regprocedure
      and prosrc like '%private.finance_accounting_human_event_is_fresh_v2(%'
      and prosrc like '%private.finance_expense_optional_permission_allows(%'
      and prosrc like '%private.finance_merge_human_accounting_lines(%'
      and prosrc like '%FINAL_ACCOUNTING_VOUCHER_MISMATCH%'
      and prosrc like '%coalesce(p_request.estimated_amount,p_request.amount)%') then
    raise exception 'Utility correction / advance human authority or exact settlement contract is missing';end if;
  if not private.finance_utility_line_v1('{"item":"水費11508"}')
    or not private.finance_utility_line_v1('{"label":"115年8月電費"}')
    or not private.finance_utility_line_v1('{"itemName":"水 電 費"}')
    or private.finance_utility_line_v1('{"item":"電費補助"}')
    or private.finance_utility_line_v1('{"description":"水電工程"}')
    or private.finance_utility_line_v1('{"item":"飲水機維修"}')
    or private.finance_utility_line_v1('{"item":"瓦斯費","debitAccount":"6202"}')
    or private.finance_utility_line_v1('{"item":"文具","description":"水費"}') then
    raise exception 'Utility postflight classifier differs from the agreed line-only rule';end if;
  perform private.finance_assert_utility_lines_v1('[{"description":"水費","netAmount":1050,"taxAmount":0,"grossAmount":1050,"debitAccount":"6202","creditAccount":"1112"}]');
  begin
    perform private.finance_assert_utility_lines_v1('[{"description":"電費","netAmount":1000,"taxAmount":50,"grossAmount":1050}]');
  exception when check_violation then v_rejected:=true;end;
  if not v_rejected then raise exception 'Utility postflight accepted positive input tax';end if;
  v_request:=pg_catalog.jsonb_populate_record(null::public.expense_requests,
    '{"type":"advance_request","form_payload":{"lazyRows":[{"item":"水費","netAmount":1000,"taxAmount":50,"grossAmount":1050}]}}');
  perform private.finance_assert_utility_posting_v1(v_request,'{}','[{"t":"dr","ac":"6202","amt":1050},{"t":"cr","ac":"1191","amt":1050}]');
  v_rejected:=false;
  begin
    perform private.finance_assert_utility_posting_v1(v_request,'{}','[{"t":"dr","ac":"6202","amt":1000},{"t":"dr","ac":"1144","amt":50},{"t":"cr","ac":"1191","amt":1050}]');
  exception when check_violation then v_rejected:=true;end;
  if not v_rejected then raise exception 'Utility postflight accepted tax in advance fallback entries';end if;
end;
$finance_utility_tax_postflight$;
