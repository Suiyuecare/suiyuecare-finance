-- Read-only catalog canary. Never borrows an employee identity or creates financial records.
begin isolation level repeatable read read only;
set local statement_timeout='20s';
-- FINANCE_AUTHENTICATED_CANARY_CORE_BEGIN
do $finance_audit_controls_20260927_canary$
declare r text;table_name text;
begin
 foreach table_name in array array['public.finance_document_archives_v1','private.finance_period_close_events_v1','private.finance_archive_verifications_v1','private.finance_reporting_rule_preparers_v1','private.finance_payroll_accruals_v1','private.finance_payroll_evidence_intents_v1','private.finance_payroll_accrual_events_v1'] loop
  if to_regclass(table_name) is null or not exists(select 1 from pg_class where oid=to_regclass(table_name) and relrowsecurity) then raise exception 'Canary protected table missing: %',table_name;end if;
  foreach r in array array['anon','authenticated','service_role'] loop if has_table_privilege(r,table_name,'SELECT,INSERT,UPDATE,DELETE') then raise exception 'Canary direct-table bypass: %, %',r,table_name;end if;end loop;
 end loop;
 if not exists(select 1 from pg_proc where oid='private.finance_assert_period_open(uuid,text,text,date,text)'::regprocedure and provolatile='v') then raise exception 'Canary volatile period guard missing';end if;
 if has_function_privilege('authenticated','public.finance_reporting_profile_save_pre_review_v1(text,bigint,jsonb,text,text)','EXECUTE') then raise exception 'Canary direct reporting review bypass';end if;
 if (select count(*) from storage.buckets where id in('finance-audit-archives','finance-payroll-evidence') and not public)<>2 then raise exception 'Canary protected buckets missing';end if;
 if auth.uid() is not null or current_user in('anon','authenticated','service_role') then raise exception 'Catalog canary may not borrow an employee/browser context';end if;
end;
$finance_audit_controls_20260927_canary$;
-- FINANCE_AUTHENTICATED_CANARY_CORE_END
rollback;
-- FINANCE_AUTHENTICATED_CANARY_ROLLBACK_CHECK_BEGIN
do $finance_audit_controls_20260927_rollback$
begin
 if auth.uid() is not null or current_user in('anon','authenticated','service_role') then raise exception 'Audit controls canary left employee/browser context';end if;
end;
$finance_audit_controls_20260927_rollback$;
-- FINANCE_AUTHENTICATED_CANARY_ROLLBACK_CHECK_END
select jsonb_build_object('canary','readonly_audit_controls_20260927_v1','ok',true,'rolled_back',true,'catalog_scope_preserved',true) as audit_controls_20260927_canary_result;
