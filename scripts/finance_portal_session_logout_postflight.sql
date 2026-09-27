\set ON_ERROR_STOP on
do $postflight$
declare result jsonb;failed text;
begin
 result:=jsonb_build_object(
 'version','finance-portal-session-logout-v1',
 'currentUserFence',md5(pg_get_functiondef('public.current_finance_user()'::regprocedure))='138acd5e90d5546d28de5874b83305ef',
 'readFence',md5(pg_get_functiondef('public.finance_current_verified_google_email_v2()'::regprocedure))='e4681e519d5235ebae85324a87dfbe22',
 'sessionHelperSeal',md5(pg_get_functiondef('public.finance_auth_session_active()'::regprocedure))='d2ca6446e8985414ad8272d551995973',
 'statusSeal',md5(pg_get_functiondef('public.portal_session_status()'::regprocedure))='b5e917acd2aefde069077291b838c47b',
 'revocationSeal',md5(pg_get_functiondef('public.portal_revoke_google_sessions(text,text)'::regprocedure))='3518fcde07e723601eeb438bd374efcc',
 'sessionHelperAuthenticated',has_function_privilege('authenticated','public.finance_auth_session_active()','execute'),
 'sessionHelperAnonymousDenied',not has_function_privilege('anon','public.finance_auth_session_active()','execute'),
 'sessionHelperServiceDenied',not has_function_privilege('service_role','public.finance_auth_session_active()','execute'),
 'sessionStatusAuthenticated',has_function_privilege('authenticated','public.portal_session_status()','execute'),
 'sessionStatusAnonymousDenied',not has_function_privilege('anon','public.portal_session_status()','execute'),
 'serviceRevocation',has_function_privilege('service_role','public.portal_revoke_google_sessions(text,text)','execute'),
 'authenticatedRevocationDenied',not has_function_privilege('authenticated','public.portal_revoke_google_sessions(text,text)','execute'),
 'anonymousRevocationDenied',not has_function_privilege('anon','public.portal_revoke_google_sessions(text,text)','execute'),
 'restrictedSearchPath',not exists(select 1 from pg_proc p where p.oid in ('public.portal_session_status()'::regprocedure,'public.portal_revoke_google_sessions(text,text)'::regprocedure,'public.finance_auth_session_active()'::regprocedure) and (not p.prosecdef or not p.proconfig @> array['search_path=""']))
);
 select string_agg(key,', ' order by key) into failed from jsonb_each(result) where key<>'version' and value<>'true'::jsonb;
 if failed is not null then raise exception 'FINANCE_PORTAL_SESSION_POSTFLIGHT_FAILED: %',failed;end if;
end $postflight$;
select jsonb_build_object(
 'version','finance-portal-session-logout-v1',
 'currentUserFence',md5(pg_get_functiondef('public.current_finance_user()'::regprocedure))='138acd5e90d5546d28de5874b83305ef',
 'readFence',md5(pg_get_functiondef('public.finance_current_verified_google_email_v2()'::regprocedure))='e4681e519d5235ebae85324a87dfbe22',
 'sessionHelperSeal',md5(pg_get_functiondef('public.finance_auth_session_active()'::regprocedure))='d2ca6446e8985414ad8272d551995973',
 'statusSeal',md5(pg_get_functiondef('public.portal_session_status()'::regprocedure))='b5e917acd2aefde069077291b838c47b',
 'revocationSeal',md5(pg_get_functiondef('public.portal_revoke_google_sessions(text,text)'::regprocedure))='3518fcde07e723601eeb438bd374efcc',
 'sessionHelperAuthenticated',has_function_privilege('authenticated','public.finance_auth_session_active()','execute'),
 'sessionHelperAnonymousDenied',not has_function_privilege('anon','public.finance_auth_session_active()','execute'),
 'sessionHelperServiceDenied',not has_function_privilege('service_role','public.finance_auth_session_active()','execute'),
 'sessionStatusAuthenticated',has_function_privilege('authenticated','public.portal_session_status()','execute'),
 'sessionStatusAnonymousDenied',not has_function_privilege('anon','public.portal_session_status()','execute'),
 'serviceRevocation',has_function_privilege('service_role','public.portal_revoke_google_sessions(text,text)','execute'),
 'authenticatedRevocationDenied',not has_function_privilege('authenticated','public.portal_revoke_google_sessions(text,text)','execute'),
 'anonymousRevocationDenied',not has_function_privilege('anon','public.portal_revoke_google_sessions(text,text)','execute'),
 'restrictedSearchPath',not exists(select 1 from pg_proc p where p.oid in ('public.portal_session_status()'::regprocedure,'public.portal_revoke_google_sessions(text,text)'::regprocedure,'public.finance_auth_session_active()'::regprocedure) and (not p.prosecdef or not p.proconfig @> array['search_path=""']))
) as result;
