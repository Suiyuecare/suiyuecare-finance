-- Read-only production proof; no employee identity, business mutation or notification.
begin isolation level repeatable read read only;
set local statement_timeout='20s';
-- FINANCE_AUTHENTICATED_CANARY_CORE_BEGIN
do $invoice_approval_guard$
declare p pg_proc%rowtype;
begin
  select * into p from pg_proc where oid=to_regprocedure('public.finance_invoice_act_active_step_v2(text[],text,text,text,jsonb,text,jsonb,jsonb,text)');
  if p.oid is null or md5(p.prosrc) is distinct from 'b8f16d4644a5bfbe367a97c671937001'
     or pg_get_userbyid(p.proowner)<>'postgres' or not p.prosecdef
     or p.proconfig is distinct from array['search_path=""']::text[]
     or has_function_privilege('anon',p.oid,'EXECUTE')
     or not has_function_privilege('authenticated',p.oid,'EXECUTE')
     or not has_function_privilege('service_role',p.oid,'EXECUTE')
     or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE')
     or not exists(select 1 from pg_proc helper
       where helper.oid=to_regprocedure('private.finance_invoice_actor_can_act(uuid,public.invoices,integer,jsonb,text,text,text)')
         and md5(helper.prosrc)='675ec0629eff80846200ad3e54e6d5d0'
         and pg_get_userbyid(helper.proowner)='postgres' and not helper.prosecdef
         and helper.proconfig=array['search_path=""']::text[]
         and not has_function_privilege('anon',helper.oid,'EXECUTE')
         and not has_function_privilege('authenticated',helper.oid,'EXECUTE')
         and not has_function_privilege('service_role',helper.oid,'EXECUTE')
         and not exists(select 1 from aclexplode(coalesce(helper.proacl,acldefault('f',helper.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE'))
     or (select md5(prosrc) from pg_proc where oid=to_regprocedure('private.finance_history_projection_source_trigger_v1()')) is distinct from 'dacedbff7dc0b1a6ea7a1361951cc6bd'
     or (select md5(prosrc) from pg_proc where oid=to_regprocedure('private.finance_refresh_invoice_batch_approval_notification_statement_v2()')) is distinct from 'b72cc4fb038e98fb9517ca2398a40dcc'
     or not exists(select 1 from pg_trigger where tgrelid='public.invoices'::regclass
       and tgname='finance_history_projection_update_v1' and tgenabled='O' and tgtype=16
       and tgnewtable='new_source' and tgoldtable='old_source'
       and tgfoid='private.finance_history_projection_source_trigger_v1()'::regprocedure)
     or not exists(select 1 from pg_trigger where tgrelid='public.invoices'::regclass
       and tgname='trg_zz_invoices_refresh_batch_approval_notification_update_v2' and tgenabled='O' and tgtype=16
       and tgnewtable='invoice_batch_new' and tgoldtable='invoice_batch_old'
       and tgfoid='private.finance_refresh_invoice_batch_approval_notification_statement_v2()'::regprocedure)
  then raise exception 'Invoice approval function/authority/batch trigger drifted; review before release' using errcode='55000';end if;
end;
$invoice_approval_guard$;
do $anonymous$
declare denied boolean:=false;
begin
 if auth.uid() is not null then raise exception 'Invoice approval canary requires no staff identity';end if;
 begin perform public.finance_invoice_act_active_step_v2(array['__readonly_invoice_approval_canary__'],'approve','__readonly_invoice_approval_canary__',null,'[]',null,'{}','{}','production');
 exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Anonymous invoice approval was not denied' using errcode='23514';end if;
end;
$anonymous$;
-- FINANCE_AUTHENTICATED_CANARY_CORE_END
rollback;
-- FINANCE_AUTHENTICATED_CANARY_ROLLBACK_CHECK_BEGIN
do $rolled_back$ begin
 if current_setting('transaction_read_only')='on' then raise exception 'Invoice approval canary remains open';end if;
end; $rolled_back$;
-- FINANCE_AUTHENTICATED_CANARY_ROLLBACK_CHECK_END
select 'FINANCE_INVOICE_APPROVAL_BULK_CANARY_ROLLED_BACK' as marker,
 jsonb_build_object('canary','readonly_invoice_approval_bulk_v1','ok',true,'rolled_back',true,
 'identity_scope_preserved',true,'live_latency_proven',false) as invoice_approval_bulk_canary_result;
