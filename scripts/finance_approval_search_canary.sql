-- Pure read-only release canary. No employee identity is borrowed, no source
-- records are created, and no operational write or notification is executed.
begin isolation level repeatable read read only;
set local statement_timeout='15s';
-- FINANCE_AUTHENTICATED_CANARY_CORE_BEGIN
do $approval_search_readonly$
declare f jsonb; denied boolean:=false; signature text;
begin
 f:=private.finance_history_search_fields_v1(jsonb_build_object(
  'no','SEARCH-20260914','description','自費照顧服務','amount',1250,
  'department_name','新北個管課','form_payload',jsonb_build_object(
   'requestPurpose','九月服務','accountingLines',jsonb_build_array(jsonb_build_object('description','交通費','grossAmount',12.5))),
  'files',jsonb_build_array(jsonb_build_object('n','繳費附件.pdf','url','https://example.invalid/PRIVATE_URL_MARKER','fileData','PRIVATE_BINARY_MARKER'))));
 if not private.finance_history_document_search_v1('自費',f->>'text',f->'amounts')
  or not private.finance_history_document_search_v1('新北個管課 NT$ 1,250',f->>'text',f->'amounts')
  or not private.finance_history_document_search_v1('交通費 12.50',f->>'text',f->'amounts')
  or not private.finance_history_document_search_v1('繳費附件.pdf',f->>'text',f->'amounts')
  or private.finance_history_document_search_v1('PRIVATE_URL_MARKER',f->>'text',f->'amounts')
  or private.finance_history_document_search_v1('PRIVATE_BINARY_MARKER',f->>'text',f->'amounts')
  or private.finance_history_document_search_v1('12.00',f->>'text',f->'amounts') then
  raise exception 'Approval search business-field/amount projection failed';
 end if;
 if private.finance_history_search_text_v1('NT$ 1,250元')<>'1250'
  or private.finance_history_search_text_v1('1,25')<>'1,25'
  or not private.finance_history_document_search_v1('−12.50','測試','[-12.5]')
  or private.finance_history_document_search_v1('12.50','112.50','[]') then
  raise exception 'Approval search monetary normalization changed';
 end if;
 signature:='public.finance_approval_participant_history_for_current_user(integer,integer,text,text)';
 if has_function_privilege('anon',signature,'execute') or not has_function_privilege('authenticated',signature,'execute')
  or has_function_privilege('authenticated','private.finance_history_search_fields_v1(jsonb)','execute') then
  raise exception 'Approval search execution scope changed';
 end if;
 if auth.uid() is null then
  begin perform public.finance_approval_participant_history_for_current_user(1,0,'自費','production');
  exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'Approval search accepted absent identity';end if;
 end if;
end;
$approval_search_readonly$;
-- FINANCE_AUTHENTICATED_CANARY_CORE_END
rollback;
-- FINANCE_AUTHENTICATED_CANARY_ROLLBACK_CHECK_BEGIN
do $approval_search_rollback$
begin
 if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='private' and p.proname='finance_history_search_fields_v1' and p.prosecdef) then
  raise exception 'Search projection must remain a pure invoker function';
 end if;
end;
$approval_search_rollback$;
-- FINANCE_AUTHENTICATED_CANARY_ROLLBACK_CHECK_END
select jsonb_build_object('canary','readonly_approval_search_v1','ok',true,'rolled_back',true,'participant_scope_preserved',true) as approval_search_canary_result;
