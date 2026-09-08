\set ON_ERROR_STOP on
-- Read-only and repeatable; no historical accounting backfill is expected.
do $postflight$
declare v_request public.expense_requests%rowtype;v_rejected boolean:=false;
begin
  if not exists(select 1 from pg_proc where oid='public.finalize_expense_request(text,text,integer,jsonb,numeric,numeric,text,text,text,jsonb,numeric,text,date,jsonb)'::regprocedure
    and prosecdef and proconfig=array['search_path=""'] and prosrc like '%private.finance_finalize_accounting_patch_v1(%'
    and prosrc like '%saved.form_payload->''accountingLines''=v_final_form_patch->''accountingLines''%') then
    raise exception 'Final accounting atomic persistence postflight failed';end if;
  if not exists(select 1 from pg_trigger where tgrelid='public.expense_requests'::regclass
    and tgfoid='private.finance_sync_request_accounting_lines()'::regprocedure and not tgisinternal and tgenabled='O') then
    raise exception 'Final accounting requires the active transactional accounting-line sync trigger';end if;
  if has_function_privilege('anon','private.finance_finalize_accounting_patch_v1(public.expense_requests,jsonb,jsonb,numeric,text)','EXECUTE')
    or has_function_privilege('authenticated','private.finance_finalize_accounting_patch_v1(public.expense_requests,jsonb,jsonb,numeric,text)','EXECUTE')
    or has_function_privilege('service_role','private.finance_finalize_accounting_patch_v1(public.expense_requests,jsonb,jsonb,numeric,text)','EXECUTE') then
    raise exception 'Final accounting private helper has unexpected caller privileges';end if;
  v_request:=jsonb_populate_record(null::public.expense_requests,'{"type":"payment_request","form_payload":{"accountingLines":[]}}');
  begin
    perform private.finance_finalize_accounting_patch_v1(v_request,'{"accountingLines":[]}','[]',100,'postflight');
  exception when invalid_parameter_value then v_rejected:=true;end;
  if not v_rejected then raise exception 'Final accounting accepted an empty accounting revision';end if;
  v_request.type:='advance_request';
  if private.finance_finalize_accounting_patch_v1(v_request,'{}','[]',100,'postflight')<>'{}'::jsonb then
    raise exception 'Final accounting changed the separate advance settlement contract';end if;
end;
$postflight$;
