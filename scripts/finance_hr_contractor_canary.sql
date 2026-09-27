-- Pure catalog canary. No employee identity, messages, financial or tax writes.
begin isolation level repeatable read read only;
set local statement_timeout='20s';
-- FINANCE_AUTHENTICATED_CANARY_CORE_BEGIN
do $contractor_canary$ declare r text;begin
 if auth.uid() is not null or current_user in('anon','authenticated','service_role') then raise exception 'Contractor canary cannot borrow a user identity';end if;
 if (select md5(prosrc) from pg_proc where oid='finance_hr_private.finance_hr_intake(uuid,jsonb)'::regprocedure)<>'10ac04b3e8a6b0d48ce06cdc75333ade' then raise exception 'Contractor intake changed';end if;
 foreach r in array array['anon','authenticated'] loop
  if has_function_privilege(r,'public.finance_hr_intake(uuid,jsonb)','execute') or has_table_privilege(r,'finance_hr_private.finance_hr_obligations','SELECT,INSERT,UPDATE,DELETE') then raise exception 'Contractor confidentiality changed';end if;
 end loop;
end $contractor_canary$;
-- FINANCE_AUTHENTICATED_CANARY_CORE_END
rollback;
-- FINANCE_AUTHENTICATED_CANARY_ROLLBACK_CHECK_BEGIN
do $contractor_rollback$ begin
 if auth.uid() is not null or current_user in('anon','authenticated','service_role') then raise exception 'Contractor canary left user context';end if;
end $contractor_rollback$;
-- FINANCE_AUTHENTICATED_CANARY_ROLLBACK_CHECK_END
select jsonb_build_object('canary','readonly_hr_contractor_v1','ok',true,'rolled_back',true,'privacy_preserved',true) as hr_contractor_canary_result;
