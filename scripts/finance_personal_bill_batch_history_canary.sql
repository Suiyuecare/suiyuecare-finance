-- Read-only metadata and anonymous-denial proof. Native synthetic tests prove
-- full identity/pagination/batch parity; this canary does not impersonate staff
-- or claim production end-to-end performance from planner estimates.
begin isolation level repeatable read read only;
set local statement_timeout='20s';
-- FINANCE_AUTHENTICATED_CANARY_CORE_BEGIN
do $personal_bill_batch_history_canary$
declare v_expected record; v_proc pg_catalog.pg_proc%rowtype;
begin
  select * into v_proc from pg_catalog.pg_proc where oid=pg_catalog.to_regprocedure('private.finance_personal_bill_group_key_v1(public.bills)');
  if v_proc.oid is null or v_proc.prosecdef or v_proc.provolatile<>'i'
     or pg_catalog.md5(v_proc.prosrc)<>'6525019afa69b00119e69216e9084a6f'
     or pg_catalog.has_function_privilege('anon',v_proc.oid,'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated',v_proc.oid,'EXECUTE')
     or pg_catalog.has_function_privilege('service_role',v_proc.oid,'EXECUTE') then
    raise exception 'Private bill batch grouping authority drifted' using errcode='23514';
  end if;
  for v_expected in select * from (values
      ('private.finance_personal_document_authorized_v1(public.finance_users,text,text,text)',false,'1db71550a2ec13ece520e25abb211e09'),
      ('public.finance_personal_document_summary_v1(text,integer,integer,text,text)',true,'d623593ac629ceb854dfa7e837e5b249'),
      ('public.finance_personal_document_detail_v1(text,text)',true,'cdc8db2ccb2db89e5f8a932b6213d331'),
      ('private.finance_history_actor_v1()',false,'4fa4b048271075bade4b7ddd3f424fc4'),
      ('private.finance_personal_history_page_allows_v1(public.finance_users)',true,'b2fed44ca1b66208649d50c7bfae921d')
  ) x(signature,security_definer,source_md5) loop
    select * into v_proc from pg_catalog.pg_proc where oid=pg_catalog.to_regprocedure(v_expected.signature);
    if v_proc.oid is null or pg_catalog.pg_get_userbyid(v_proc.proowner)<>'postgres'
       or v_proc.prosecdef is distinct from v_expected.security_definer
       or v_proc.provolatile<>'s' or v_proc.proconfig is distinct from array['search_path=""']::text[]
       or pg_catalog.md5(v_proc.prosrc) is distinct from v_expected.source_md5
       or pg_catalog.has_function_privilege('anon',v_proc.oid,'EXECUTE')
       or pg_catalog.has_function_privilege('service_role',v_proc.oid,'EXECUTE')
       or pg_catalog.has_function_privilege('authenticated',v_proc.oid,'EXECUTE') is distinct from (v_expected.signature like 'public.%')
       or exists(select 1 from pg_catalog.aclexplode(coalesce(v_proc.proacl,pg_catalog.acldefault('f',v_proc.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE') then
      raise exception 'Personal history bill batch history authority/source drift: %',v_expected.signature using errcode='55000';
    end if;
  end loop;
end;
$personal_bill_batch_history_canary$;
do $personal_bill_batch_history_anonymous$
declare v_summary_denied boolean:=false;v_detail_denied boolean:=false;
begin
  if auth.uid() is not null then raise exception 'Bill batch history canary requires no staff identity';end if;
  begin perform public.finance_personal_document_summary_v1('all',1,0,null,'production');
    exception when insufficient_privilege then v_summary_denied:=true;end;
  begin perform public.finance_personal_document_detail_v1('expense_requests:__nonexistent_personal_bill_batch_history__','production');
    exception when insufficient_privilege then v_detail_denied:=true;end;
  if not v_summary_denied or not v_detail_denied then
    raise exception 'Personal bill batch history anonymous access was not denied' using errcode='23514';
  end if;
end;
$personal_bill_batch_history_anonymous$;
-- FINANCE_AUTHENTICATED_CANARY_CORE_END
rollback;
-- FINANCE_AUTHENTICATED_CANARY_ROLLBACK_CHECK_BEGIN
do $personal_bill_batch_history_rollback$
begin
  if pg_catalog.current_setting('transaction_read_only')='on' then raise exception 'Personal bill batch history read-only canary remains open';end if;
end;
$personal_bill_batch_history_rollback$;
-- FINANCE_AUTHENTICATED_CANARY_ROLLBACK_CHECK_END
select 'FINANCE_PERSONAL_BILL_BATCH_HISTORY_CANARY_ROLLED_BACK' as marker,
  pg_catalog.jsonb_build_object('canary','readonly_personal_bill_batch_history_v1','ok',true,'rolled_back',true,
    'identity_scope_preserved',true,'permission_guard_preserved',true,'live_latency_proven',false) as personal_bill_batch_history_canary_result;
