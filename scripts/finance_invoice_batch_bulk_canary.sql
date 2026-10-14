-- Read-only live catalog and anonymous-denial proof. Capacity and concurrency
-- are proven in an isolated native DB with real RPCs/guards/triggers.
begin isolation level repeatable read read only;
set local statement_timeout='20s';
-- FINANCE_AUTHENTICATED_CANARY_CORE_BEGIN
do $postflight$
declare r record;p pg_proc%rowtype;
begin
  for r in select * from(values
    ('public.finance_submit_invoice_batch(text,jsonb,text)','17a8a2420106c1b1a7d0ac9b633f428a',true),
    ('public.finance_submit_bill_batch(text,jsonb,text)','6ca77f1de6fde7edf8e6483b36760fff',true),
    ('private.finance_refresh_invoice_batch_approval_notification_statement_v2()','b72cc4fb038e98fb9517ca2398a40dcc',false),
    ('private.finance_history_projection_source_trigger_v1()','dacedbff7dc0b1a6ea7a1361951cc6bd',false),
    ('private.finance_enqueue_current_approval_email()','ebae3a8045744a11bfa2892f04d80f2f',false)
  )x(signature,source_md5,callable) loop
    select * into p from pg_proc where oid=to_regprocedure(r.signature);
    if p.oid is null or md5(p.prosrc)<>r.source_md5
       or pg_get_userbyid(p.proowner)<>'postgres' or not p.prosecdef
       or (r.callable and p.proconfig is distinct from array['search_path=""']::text[])
       or (r.signature like '%statement_v2%' and p.proconfig is distinct from array['search_path=""']::text[])
       or has_function_privilege('anon',p.oid,'EXECUTE')
       or has_function_privilege('authenticated',p.oid,'EXECUTE') is distinct from r.callable
       or has_function_privilege('service_role',p.oid,'EXECUTE') is distinct from r.callable
       or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE')
    then raise exception 'Invoice bulk source/authority drift: %',r.signature using errcode='55000';end if;
  end loop;
  if exists(select 1 from pg_trigger where tgrelid='public.invoices'::regclass and tgname='trg_zz_invoices_refresh_batch_approval_notification_v1')
     or not exists(select 1 from pg_trigger where tgrelid='public.invoices'::regclass and tgname='trg_zz_invoices_refresh_batch_approval_notification_insert_v2' and tgenabled='O' and tgtype=4 and tgnewtable='invoice_batch_new' and tgfoid='private.finance_refresh_invoice_batch_approval_notification_statement_v2()'::regprocedure)
     or not exists(select 1 from pg_trigger where tgrelid='public.invoices'::regclass and tgname='trg_zz_invoices_refresh_batch_approval_notification_update_v2' and tgenabled='O' and tgtype=16 and tgnewtable='invoice_batch_new' and tgoldtable='invoice_batch_old' and tgfoid='private.finance_refresh_invoice_batch_approval_notification_statement_v2()'::regprocedure)
     or not exists(select 1 from pg_trigger where tgrelid='public.invoices'::regclass and tgname='finance_history_projection_insert_v1' and tgenabled='O' and tgtype=4 and tgnewtable='new_source' and tgfoid='private.finance_history_projection_source_trigger_v1()'::regprocedure)
     or not exists(select 1 from pg_trigger where tgrelid='public.invoices'::regclass and tgname='trg_invoices_enqueue_approval_email' and tgenabled='O' and tgtype=21 and tgfoid='private.finance_enqueue_current_approval_email()'::regprocedure)
     or not exists(select 1 from pg_index where indexrelid=to_regclass('public.invoices_tenant_environment_batch_v2_idx') and indisvalid and indisready)
  then raise exception 'Invoice bulk trigger/index installation incomplete' using errcode='55000';end if;
end;
$postflight$;


do $anonymous$
declare denied boolean:=false;
begin
 if auth.uid() is not null then raise exception 'Invoice bulk canary requires no staff identity';end if;
 begin perform public.finance_submit_invoice_batch('__readonly_invoice_bulk_canary__','[]'::jsonb,'production');
 exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Anonymous invoice submit was not denied' using errcode='23514';end if;
end;
$anonymous$;
-- FINANCE_AUTHENTICATED_CANARY_CORE_END
rollback;
-- FINANCE_AUTHENTICATED_CANARY_ROLLBACK_CHECK_BEGIN
do $rolled_back$ begin
 if current_setting('transaction_read_only')='on' then raise exception 'Invoice bulk canary remains open';end if;
end; $rolled_back$;
-- FINANCE_AUTHENTICATED_CANARY_ROLLBACK_CHECK_END
select 'FINANCE_INVOICE_BATCH_BULK_CANARY_ROLLED_BACK' as marker,
 jsonb_build_object('canary','readonly_invoice_batch_bulk_v1','ok',true,'rolled_back',true,
 'identity_scope_preserved',true,'live_latency_proven',false) as invoice_batch_bulk_canary_result;

