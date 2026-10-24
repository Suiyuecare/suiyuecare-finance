-- Read-only ACL/source checks. Does not impersonate staff, mint sessions or consume handoffs.
begin isolation level repeatable read read only;
set local statement_timeout='20s';
-- FINANCE_AUTHENTICATED_CANARY_CORE_BEGIN
do $portal_handoff_canary$
declare expected record; proc pg_catalog.pg_proc%rowtype; relation pg_catalog.pg_class%rowtype;
 consume_denied boolean:=false; finalize_denied boolean:=false;
begin
  if not exists(select 1 from supabase_migrations.schema_migrations where version='20261024210000' and name='finance_portal_handoff_v1'
      and pg_catalog.md5(pg_catalog.array_to_string(statements,''))='54578a7b09c112923efc44e0fb06026f') then
    raise exception 'Portal handoff sealed ledger is absent or differs' using errcode='55000';
  end if;
  for expected in select * from (values
    ('public.finance_portal_handoff_consume(jsonb)','49cdf9178c6838a179a3ec16a3e79fbf'),
    ('public.finance_portal_handoff_finalize(jsonb)','0e464eb64ccbc9431a31beb939e2d594')
  ) x(signature,source_md5) loop
    select * into proc from pg_catalog.pg_proc where oid=pg_catalog.to_regprocedure(expected.signature);
    if proc.oid is null or proc.prosecdef is distinct from true
       or pg_catalog.md5(proc.prosrc) is distinct from expected.source_md5
       or pg_catalog.has_function_privilege('service_role',proc.oid,'EXECUTE') is distinct from true
       or pg_catalog.has_function_privilege('anon',proc.oid,'EXECUTE')
       or pg_catalog.has_function_privilege('authenticated',proc.oid,'EXECUTE') then
      raise exception 'Portal handoff authority/source drift: %',expected.signature using errcode='55000';
    end if;
  end loop;
  select * into relation from pg_catalog.pg_class where oid=pg_catalog.to_regclass('portal_handoff_private.consumed');
  if relation.oid is null or relation.relforcerowsecurity is distinct from true
     or exists(select 1 from pg_catalog.pg_policy where polrelid=relation.oid)
     or pg_catalog.has_schema_privilege('authenticated','portal_handoff_private','USAGE') then
    raise exception 'Portal handoff private receipt authority drift' using errcode='55000';
  end if;
  execute 'set local role authenticated';
  if auth.uid() is not null then raise exception 'Portal handoff canary requires no staff identity';end if;
  begin perform public.finance_portal_handoff_consume('{}'::jsonb);
    exception when insufficient_privilege then consume_denied:=true;end;
  begin perform public.finance_portal_handoff_finalize('{}'::jsonb);
    exception when insufficient_privilege then finalize_denied:=true;end;
  if not consume_denied or not finalize_denied then raise exception 'Portal handoff browser authority was not denied';end if;
  execute 'reset role';
end;
$portal_handoff_canary$;
-- FINANCE_AUTHENTICATED_CANARY_CORE_END
rollback;
-- FINANCE_AUTHENTICATED_CANARY_ROLLBACK_CHECK_BEGIN
do $portal_handoff_rollback$
begin
 if pg_catalog.current_setting('transaction_read_only')='on' then raise exception 'Portal handoff canary remains open';end if;
end;
$portal_handoff_rollback$;
-- FINANCE_AUTHENTICATED_CANARY_ROLLBACK_CHECK_END
select 'FINANCE_PORTAL_HANDOFF_CANARY_ROLLED_BACK' as marker,
 pg_catalog.jsonb_build_object('canary','readonly_portal_handoff_v1','ok',true,'rolled_back',true,
 'privacy_preserved',true,'session_minted',false) as portal_handoff_canary_result;
