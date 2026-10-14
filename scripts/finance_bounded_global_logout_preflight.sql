\set ON_ERROR_STOP on
-- Fixed additive migration only; no caller claims or real revocation.
do $bounded_logout_preflight$
declare expected record;
begin
  if not exists(select 1 from supabase_migrations.schema_migrations where version='20260927180201' and name='finance_portal_session_logout')
     or exists(select 1 from supabase_migrations.schema_migrations where version='20261014123017')
     or pg_catalog.to_regclass('logout_private.module_receipts') is not null
     or pg_catalog.to_regprocedure('public.portal_revoke_google_sessions_v2(uuid,text,text,timestamptz,timestamptz)') is not null then
    raise exception 'Bounded logout prerequisite or target collision' using errcode='55000';
  end if;
  for expected in select * from (values
    ('public.current_finance_user()','138acd5e90d5546d28de5874b83305ef'),
    ('public.finance_current_verified_google_email_v2()','e4681e519d5235ebae85324a87dfbe22'),
    ('public.finance_auth_session_active()','d2ca6446e8985414ad8272d551995973'),
    ('public.portal_session_status()','b5e917acd2aefde069077291b838c47b'),
    ('public.portal_revoke_google_sessions(text,text)','3518fcde07e723601eeb438bd374efcc')
  ) x(signature,definition_md5) loop
    if pg_catalog.md5(pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(expected.signature))) is distinct from expected.definition_md5 then
      raise exception 'Bounded logout existing session fence drift: %',expected.signature using errcode='55000';
    end if;
  end loop;
  if pg_catalog.has_function_privilege('anon','public.finance_auth_session_active()','EXECUTE')
     or pg_catalog.has_function_privilege('service_role','public.finance_auth_session_active()','EXECUTE')
     or pg_catalog.has_function_privilege('authenticated','public.finance_auth_session_active()','EXECUTE') is distinct from true then
    raise exception 'Existing session helper authority drift' using errcode='55000';
  end if;
end;
$bounded_logout_preflight$;
select 'FINANCE_BOUNDED_LOGOUT_PREFLIGHT_OK' as marker;
