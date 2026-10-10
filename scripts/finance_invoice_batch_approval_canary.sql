-- Metadata-only canary. Never creates or modifies a production invoice/event.
begin isolation level repeatable read read only;
set local statement_timeout = '20s';

-- FINANCE_AUTHENTICATED_CANARY_CORE_BEGIN
do $canary$
declare
  v_enqueue oid := pg_catalog.to_regprocedure('private.finance_enqueue_current_approval_email()')::oid;
  v_refresh oid := pg_catalog.to_regprocedure('private.finance_refresh_invoice_batch_approval_notification_v1()')::oid;
  v_history_summary oid := pg_catalog.to_regprocedure('public.finance_personal_document_summary_v1(text,integer,integer,text,text)')::oid;
  v_history_detail oid := pg_catalog.to_regprocedure('public.finance_personal_document_detail_v1(text,text)')::oid;
begin
  if auth.uid() is not null or v_enqueue is null or v_refresh is null
     or v_history_summary is null or v_history_detail is null
     or not exists (
       select 1 from supabase_migrations.schema_migrations
       where version='20261010130000'
         and name='finance_personal_invoice_batch_history_v1'
     )
     or not exists (
       select 1 from pg_catalog.pg_proc p
       where p.oid=v_history_summary
         and pg_catalog.pg_get_userbyid(p.proowner)='postgres'
         and p.prosecdef and p.provolatile='s'
         and p.proconfig=array['search_path=""']::text[]
         and pg_catalog.md5(p.prosrc)='f68644d4f30ee10fd4b2bd76da4a2b83'
     )
     or not exists (
       select 1 from pg_catalog.pg_proc p
       where p.oid=v_history_detail
         and pg_catalog.pg_get_userbyid(p.proowner)='postgres'
         and p.prosecdef and p.provolatile='s'
         and p.proconfig=array['search_path=""']::text[]
         and pg_catalog.md5(p.prosrc)='34989c18188536e079e63ff81370c2cf'
     )
     or pg_catalog.has_function_privilege('anon',v_history_summary,'EXECUTE')
     or pg_catalog.has_function_privilege('anon',v_history_detail,'EXECUTE')
     or pg_catalog.has_function_privilege('service_role',v_history_summary,'EXECUTE')
     or pg_catalog.has_function_privilege('service_role',v_history_detail,'EXECUTE')
     or not pg_catalog.has_function_privilege('authenticated',v_history_summary,'EXECUTE')
     or not pg_catalog.has_function_privilege('authenticated',v_history_detail,'EXECUTE')
     or not exists (
       select 1 from pg_catalog.pg_proc p
       where p.oid = v_enqueue
         and pg_catalog.md5(p.prosrc) = 'ebae3a8045744a11bfa2892f04d80f2f'
     )
     or not exists (
       select 1 from pg_catalog.pg_proc p
       where p.oid = v_refresh
         and pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
         and p.prosecdef
         and p.proconfig = array['search_path=""']::text[]
         and pg_catalog.md5(p.prosrc) = 'dda1bdef0235a592beddc380dec514f5'
     )
     or not exists (
       select 1 from pg_catalog.pg_trigger t
       where t.tgrelid = 'public.invoices'::pg_catalog.regclass
         and t.tgname = 'trg_zz_invoices_refresh_batch_approval_notification_v1'
         and t.tgenabled = 'O' and t.tgtype = 21 and t.tgfoid = v_refresh
     )
     or pg_catalog.has_function_privilege('anon', v_refresh, 'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated', v_refresh, 'EXECUTE')
     or pg_catalog.has_function_privilege('service_role', v_refresh, 'EXECUTE') then
    raise exception 'Invoice batch approval notification canary found changed authority or trigger'
      using errcode = '23514';
  end if;
end;
$canary$;
-- FINANCE_AUTHENTICATED_CANARY_CORE_END

rollback;
-- FINANCE_AUTHENTICATED_CANARY_ROLLBACK_CHECK_BEGIN
do $rollback_check$
begin
  if pg_catalog.current_setting('transaction_read_only') = 'on' then
    raise exception 'Invoice batch approval notification canary transaction remained open';
  end if;
end;
$rollback_check$;
-- FINANCE_AUTHENTICATED_CANARY_ROLLBACK_CHECK_END
select 'FINANCE_INVOICE_BATCH_APPROVAL_CANARY_ROLLED_BACK' as marker,
  pg_catalog.jsonb_build_object(
    'canary', 'readonly_invoice_batch_approval_notification_v1',
    'ok', true,
    'rolled_back', true,
    'authority_preserved', true
  ) as invoice_batch_approval_canary_result;
