-- No business writes or real employee claims. Complete positive parity is
-- exercised locally with actual authority functions and fictional identities.
begin isolation level repeatable read read only;
set local lock_timeout='5s';
set local statement_timeout='15s';
-- FINANCE_AUTHENTICATED_CANARY_CORE_BEGIN
do $ar_verified_accounting_installed$
declare expected record;proc record;
begin
 for expected in select * from (values
  ('public.can_read_invoice(public.invoices)','d761ec0bbd1544410ae52bd860ec78b6',false,'search_path=""'),
  ('public.current_finance_role()','21dee4f613511ba49f259a8371005e9d',false,'search_path=public'),
  ('public.current_finance_user()','5fc4f077185c7e351c730378e4d0eca4',true,'search_path=""'),
  ('public.current_finance_user_id()','14764ed0aa1758b0d159b8506b0f8c26',false,'search_path=public'),
  ('public.current_tenant_id()','7db91f7dbfb876063cd14610b2c310e4',true,'search_path=""'),
  ('public.finance_current_verified_google_email_v2()','9d9d0c836e527510ca3a76b569c95f82',true,'search_path=""'),
  ('public.finance_verified_google_email(uuid)','cc9904d39d410a933a2a31ccddc91038',true,'search_path=public, auth, pg_temp'),
  ('public.is_finance_accounting()','b615fdf7d194eab2ef2003874db09318',false,'search_path=public'),
  ('private.finance_correction_actor_v1()','e61d45d9aa0e001b0ae212678b0a196a',true,'search_path=""'),
  ('private.finance_receivables_payload_v1(date,text,text,text,boolean)','710c8fa2ca2736f58c13847be1861b6b',true,'search_path=""'),
  ('private.finance_ar_reconciliation_scope_v1(uuid,text,date,text,text)','edaf8ff23d45c773419606e543e4632e',true,'search_path=""')
 ) pins(signature,body_md5,is_definer,path_setting) loop
  select * into proc from pg_proc where oid=to_regprocedure(expected.signature);
  if proc.oid is null or md5(proc.prosrc)<>expected.body_md5 or proc.provolatile<>'s'
   or proc.prosecdef is distinct from expected.is_definer
   or proc.proconfig is distinct from array[expected.path_setting]::text[]
   or pg_get_userbyid(proc.proowner)<>'postgres' then
   raise exception 'AR reader identity/helper source or authority differs: %',expected.signature;
  end if;
  if expected.signature like 'private.%' and (
   has_function_privilege('anon',proc.oid,'EXECUTE') or has_function_privilege('authenticated',proc.oid,'EXECUTE')
   or has_function_privilege('service_role',proc.oid,'EXECUTE')
   or exists(select 1 from aclexplode(coalesce(proc.proacl,acldefault('f',proc.proowner))) acl where acl.grantee=0 and acl.privilege_type='EXECUTE')) then
   raise exception 'AR private reader is exposed: %',expected.signature;
  end if;
 end loop;
end;
$ar_verified_accounting_installed$;
do $ar_verified_accounting_public_boundary$
declare p record;denied boolean:=false;
begin
 select * into p from pg_proc where oid=to_regprocedure('public.finance_receivables_v1(date,text,text,text)');
 if p.oid is null or md5(p.prosrc)<>'3919420d06b2c7818615f757fa759195'
  or not p.prosecdef or p.provolatile<>'s' or pg_get_userbyid(p.proowner)<>'postgres'
  or p.proconfig is distinct from array['search_path=""']::text[]
  or has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('service_role',p.oid,'EXECUTE')
  or not has_function_privilege('authenticated',p.oid,'EXECUTE')
  or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl where acl.grantee=0 and acl.privilege_type='EXECUTE') then
  raise exception 'AR public read boundary differs';
 end if;
 if auth.uid() is null then
  begin perform public.finance_receivables_v1(current_date,null,null,'production');
  exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'AR read accepted absent verified identity';end if;
 end if;
end;
$ar_verified_accounting_public_boundary$;
do $ar_verified_accounting_denied_roles$
declare browser_role text;denied boolean;
begin
 if auth.uid() is not null then raise exception 'AR proof must not assume an employee identity';end if;
 foreach browser_role in array array['anon','authenticated','service_role'] loop
  execute format('set local role %I',browser_role);
  denied:=false;
  begin perform private.finance_receivables_payload_v1(current_date,null,null,'production',false);
  exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'Private AR read accepted browser role';end if;
  denied:=false;
  begin perform public.finance_receivables_v1(current_date,null,null,'production');
  exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'AR read accepted absent identity';end if;
  execute 'reset role';
 end loop;
end;
$ar_verified_accounting_denied_roles$;
-- FINANCE_AUTHENTICATED_CANARY_CORE_END
rollback;
-- FINANCE_AUTHENTICATED_CANARY_ROLLBACK_CHECK_BEGIN
do $ar_verified_accounting_rollback$
begin
 if current_user in ('anon','authenticated','service_role') or auth.uid() is not null then
  raise exception 'AR proof left a browser role or employee context';end if;
end;
$ar_verified_accounting_rollback$;
-- FINANCE_AUTHENTICATED_CANARY_ROLLBACK_CHECK_END
select jsonb_build_object('canary','readonly_ar_verified_accounting_scope_v1','ok',true,'rolled_back',true,'ordinary_scope_preserved',true) as ar_verified_accounting_scope_canary_result;
