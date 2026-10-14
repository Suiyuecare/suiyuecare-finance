-- Read-only ACL/source checks. Does not impersonate or revoke real staff sessions.
begin isolation level repeatable read read only;
set local statement_timeout='20s';
-- FINANCE_AUTHENTICATED_CANARY_CORE_BEGIN
do $bounded_logout_postflight$
declare expected record; proc pg_catalog.pg_proc%rowtype; relation pg_catalog.pg_class%rowtype;
 revocation_denied boolean:=false;status_denied boolean:=false;
begin
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
  if not exists(select 1 from supabase_migrations.schema_migrations where version='20261014123017' and name='finance_bounded_global_logout'
      and pg_catalog.md5(pg_catalog.array_to_string(statements,''))='09735581990f1648aab1e9242b2db58a') then
    raise exception 'Bounded logout sealed ledger is absent or differs' using errcode='55000';
  end if;
  select * into proc from pg_catalog.pg_proc where oid=pg_catalog.to_regprocedure('public.portal_revoke_google_sessions_v2(uuid,text,text,timestamptz,timestamptz)');
  if proc.oid is null or pg_catalog.pg_get_userbyid(proc.proowner) is distinct from 'postgres'
     or proc.prosecdef is distinct from true or proc.proconfig is distinct from array['search_path=""']::text[]
     or pg_catalog.md5(proc.prosrc) is distinct from '5bb6eb8cc3e983c7cd78ecdb020d1bf3'
     or pg_catalog.has_function_privilege('service_role',proc.oid,'EXECUTE') is distinct from true
     or pg_catalog.has_function_privilege('anon',proc.oid,'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated',proc.oid,'EXECUTE')
     or exists(select 1 from pg_catalog.aclexplode(coalesce(proc.proacl,pg_catalog.acldefault('f',proc.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE') then
    raise exception 'Bounded logout revocation authority/source drift' using errcode='55000';
  end if;
  select * into relation from pg_catalog.pg_class where oid=pg_catalog.to_regclass('logout_private.module_receipts');
  if relation.oid is null or pg_catalog.pg_get_userbyid(relation.relowner) is distinct from 'postgres'
     or relation.relrowsecurity is distinct from true or relation.relforcerowsecurity is distinct from true
     or exists(select 1 from pg_catalog.pg_policy where polrelid=relation.oid)
     or exists(select 1 from pg_catalog.pg_roles r where r.rolname in ('anon','authenticated','service_role')
       and pg_catalog.has_table_privilege(r.oid,relation.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))
     or pg_catalog.has_schema_privilege('anon','logout_private','USAGE')
     or pg_catalog.has_schema_privilege('authenticated','logout_private','USAGE') then
    raise exception 'Bounded logout private receipt authority drift' using errcode='55000';
  end if;
  if (select pg_catalog.array_agg(a.attname||':'||pg_catalog.format_type(a.atttypid,a.atttypmod)||':'||a.attnotnull::text order by a.attnum)
        from pg_catalog.pg_attribute a where a.attrelid=relation.oid and a.attnum>0 and not a.attisdropped)
       is distinct from array['operation_id:uuid:true','google_subject:text:true','verified_email:text:true','revoke_before:timestamp with time zone:true','expires_at:timestamp with time zone:true','result:jsonb:false','created_at:timestamp with time zone:true']::text[] then
    raise exception 'Bounded logout receipt fields differ' using errcode='55000';
  end if;
  execute 'set local role authenticated';
  if auth.uid() is not null then raise exception 'Bounded logout canary requires no staff identity';end if;
  if public.finance_auth_session_active() is distinct from false then raise exception 'Anonymous session was activated';end if;
  begin perform public.portal_revoke_google_sessions_v2(null,null,null,null,null);
    exception when insufficient_privilege then revocation_denied:=true;end;
  begin perform public.portal_session_status();
    exception when insufficient_privilege then status_denied:=true;end;
  if not revocation_denied or not status_denied then raise exception 'Bounded logout anonymous authority was not denied';end if;
  execute 'reset role';
end;
$bounded_logout_postflight$;
-- FINANCE_AUTHENTICATED_CANARY_CORE_END
rollback;
-- FINANCE_AUTHENTICATED_CANARY_ROLLBACK_CHECK_BEGIN
do $bounded_logout_rollback$
begin
 if pg_catalog.current_setting('transaction_read_only')='on' then raise exception 'Bounded logout canary remains open';end if;
end;
$bounded_logout_rollback$;
-- FINANCE_AUTHENTICATED_CANARY_ROLLBACK_CHECK_END
select 'FINANCE_BOUNDED_LOGOUT_CANARY_ROLLED_BACK' as marker,
 pg_catalog.jsonb_build_object('canary','readonly_bounded_global_logout_v2','ok',true,'rolled_back',true,
 'privacy_preserved',true,'real_sessions_revoked',false) as bounded_global_logout_canary_result;
