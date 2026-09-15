-- Pure read-only canary: no borrowed employee identity or source data writes.
begin isolation level repeatable read read only;
set local statement_timeout='15s';
-- FINANCE_AUTHENTICATED_CANARY_CORE_BEGIN
do $history_summary_canary$
declare terms jsonb;plain text;normal text;grams text[];denied boolean:=false;
begin
 plain:='虛構日照 自費九月 -00012.50 台北 部門金額';
 normal:=private.finance_history_search_text_v1(plain);
 terms:=private.finance_history_compile_query_v1('日照 NT$ 1,250');
 grams:=private.finance_history_index_grams_v1(plain||' 1250');
 if not private.finance_history_index_matches_v1(terms,plain,normal,array['1250'])
  or not (grams @> private.finance_history_index_grams_v1('日照'))
  or not private.finance_history_index_matches_v1(private.finance_history_compile_query_v1('-12.50'),plain,normal,array['-12.5'])
  or private.finance_history_index_matches_v1(private.finance_history_compile_query_v1('12.50'),'', '112.50','{}')
  or private.finance_history_index_matches_v1(private.finance_history_compile_query_v1('外部無關'),plain,normal,array['1250']) then
  raise exception 'Indexed summary exact text/money contract failed';
 end if;
 if auth.uid() is null then
  begin perform public.finance_approval_history_summary_v1(50,0,'日照','production');exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'Summary accepted absent identity';end if;
  denied:=false;
  begin perform public.finance_approval_history_detail_v1('expense_requests:FICTIONAL-NONEXISTENT','production');exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'Detail accepted absent identity';end if;
 end if;
 if has_table_privilege('authenticated','private.finance_history_source_projection_v1','select')
  or has_table_privilege('authenticated','private.finance_history_group_projection_v1','select')
  or has_function_privilege('authenticated','private.finance_history_groups_v1(public.finance_users,text)','execute') then raise exception 'Private search projection exposure';end if;
end;
$history_summary_canary$;
-- FINANCE_AUTHENTICATED_CANARY_CORE_END
rollback;
-- FINANCE_AUTHENTICATED_CANARY_ROLLBACK_CHECK_BEGIN
do $history_summary_rollback$
begin
 -- Tables legitimately exist after an applied release. The enclosing complete
 -- schema/data fingerprint proves rehearsal rollback, including first install.
 if exists(select 1 from pg_proc p where p.oid=to_regprocedure('public.finance_approval_history_summary_v1(integer,integer,text,text)')
  and (has_function_privilege('anon',p.oid,'execute') or not p.prosecdef)) then raise exception 'History summary authority changed';end if;
end;
$history_summary_rollback$;
-- FINANCE_AUTHENTICATED_CANARY_ROLLBACK_CHECK_END
select jsonb_build_object('canary','readonly_approval_history_summary_v1','ok',true,'rolled_back',true,'participant_scope_preserved',true) as approval_history_summary_canary_result;
