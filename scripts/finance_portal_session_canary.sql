-- Pure catalog canary. No employee identity, messages, financial or tax writes.
begin isolation level repeatable read read only;
set local statement_timeout='20s';
-- FINANCE_AUTHENTICATED_CANARY_CORE_BEGIN
do $portal_session_canary$ declare r text;begin
 if auth.uid() is not null or current_user in('anon','authenticated','service_role') then raise exception 'Portal session canary cannot borrow a user identity';end if;
 if (select md5(prosrc) from pg_proc where oid='public.current_finance_user()'::regprocedure)<>'6dae0e205f8268d0064c8c49990e5bd4' then raise exception 'Portal session user fence changed';end if;
 if (select md5(prosrc) from pg_proc where oid='public.finance_current_verified_google_email_v2()'::regprocedure)<>'679b68e0c8317f133504515cd58e306d' then raise exception 'Portal session read fence changed';end if;
 foreach r in array array['anon','authenticated'] loop
  if has_function_privilege(r,'public.portal_revoke_google_sessions(text,text)','execute') or (r='anon' and has_function_privilege(r,'public.portal_session_status()','execute')) then raise exception 'Portal session confidentiality changed';end if;
 end loop;
end $portal_session_canary$;
-- FINANCE_AUTHENTICATED_CANARY_CORE_END
rollback;
-- FINANCE_AUTHENTICATED_CANARY_ROLLBACK_CHECK_BEGIN
do $portal_session_rollback$ begin
 if auth.uid() is not null or current_user in('anon','authenticated','service_role') then raise exception 'Portal session canary left user context';end if;
end $portal_session_rollback$;
-- FINANCE_AUTHENTICATED_CANARY_ROLLBACK_CHECK_END
select jsonb_build_object('canary','readonly_portal_session_v1','ok',true,'rolled_back',true,'privacy_preserved',true) as hr_portal_session_canary_result;
