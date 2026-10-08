-- Production-safe canary: metadata and unauthenticated denial only.
begin isolation level repeatable read read only;
set local statement_timeout = '20s';
-- FINANCE_AUTHENTICATED_CANARY_CORE_BEGIN
do $canary$
declare
  v_summary oid := pg_catalog.to_regprocedure(
    'public.finance_personal_document_summary_v1(text,integer,integer,text,text)')::oid;
  v_detail oid := pg_catalog.to_regprocedure(
    'public.finance_personal_document_detail_v1(text,text)')::oid;
  v_legacy_summary oid := pg_catalog.to_regprocedure(
    'public.finance_approval_history_summary_v1(integer,integer,text,text)')::oid;
  v_legacy_detail oid := pg_catalog.to_regprocedure(
    'public.finance_approval_history_detail_v1(text,text)')::oid;
  v_legacy_full oid := pg_catalog.to_regprocedure(
    'public.finance_approval_participant_history_for_current_user(integer,integer,text,text)')::oid;
  v_summary_denied boolean := false;
  v_detail_denied boolean := false;
begin
  if auth.uid() is not null or v_summary is null or v_detail is null
     or v_legacy_summary is null or v_legacy_detail is null or v_legacy_full is null then
    raise exception 'Personal history permission canary identity or RPC baseline is unexpected';
  end if;
  if pg_catalog.has_function_privilege('anon',v_summary,'EXECUTE')
     or pg_catalog.has_function_privilege('anon',v_detail,'EXECUTE')
     or pg_catalog.has_function_privilege('service_role',v_summary,'EXECUTE')
     or pg_catalog.has_function_privilege('service_role',v_detail,'EXECUTE')
     or not pg_catalog.has_function_privilege('authenticated',v_summary,'EXECUTE')
     or not pg_catalog.has_function_privilege('authenticated',v_detail,'EXECUTE')
     or pg_catalog.has_function_privilege('anon',v_legacy_summary,'EXECUTE')
     or pg_catalog.has_function_privilege('anon',v_legacy_detail,'EXECUTE')
     or pg_catalog.has_function_privilege('anon',v_legacy_full,'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated',v_legacy_summary,'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated',v_legacy_detail,'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated',v_legacy_full,'EXECUTE')
     or pg_catalog.has_function_privilege('service_role',v_legacy_summary,'EXECUTE')
     or pg_catalog.has_function_privilege('service_role',v_legacy_detail,'EXECUTE')
     or pg_catalog.has_function_privilege('service_role',v_legacy_full,'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated',
       'private.finance_personal_document_authorized_v1(public.finance_users,text,text,text)',
       'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated',
       'private.finance_personal_history_page_allows_v1(public.finance_users)',
       'EXECUTE') then
    raise exception 'Personal history permission canary detected a privilege boundary change';
  end if;
  if not exists(select 1 from pg_catalog.pg_proc p
    where p.oid=v_summary and p.prosrc like '%private.finance_personal_history_page_allows_v1(v_user)%')
     or not exists(select 1 from pg_catalog.pg_proc p
    where p.oid=v_detail and p.prosrc like '%private.finance_personal_history_page_allows_v1(v_user)%')
     or not exists(select 1 from pg_catalog.pg_proc p
    where p.oid=pg_catalog.to_regprocedure('private.finance_history_actor_v1()')
      and p.prosrc like '%private.finance_personal_history_page_allows_v1(v_user)%') then
    raise exception 'Personal history permission guard is absent';
  end if;
  begin
    perform public.finance_personal_document_summary_v1('all',1,0,null,'production');
  exception when insufficient_privilege then v_summary_denied := true;
  end;
  begin
    perform public.finance_personal_document_detail_v1('bills:FICTIONAL-NONEXISTENT','production');
  exception when insufficient_privilege then v_detail_denied := true;
  end;
  if not v_summary_denied or not v_detail_denied then
    raise exception 'Personal history permission accepted a caller without verified identity';
  end if;
end;
$canary$;
-- FINANCE_AUTHENTICATED_CANARY_CORE_END
rollback;
-- FINANCE_AUTHENTICATED_CANARY_ROLLBACK_CHECK_BEGIN
do $rollback_check$
begin
  if pg_catalog.current_setting('transaction_read_only') = 'on' then
    raise exception 'Personal history permission canary transaction remained open';
  end if;
end;
$rollback_check$;
-- FINANCE_AUTHENTICATED_CANARY_ROLLBACK_CHECK_END
select 'FINANCE_PERSONAL_HISTORY_CANARY_ROLLED_BACK' as marker,
  pg_catalog.jsonb_build_object(
    'canary','readonly_personal_history_permission_v1','ok',true,'rolled_back',true,
    'permission_guard_preserved',true) as personal_history_permission_canary_result;
