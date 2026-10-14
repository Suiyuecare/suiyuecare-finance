\set ON_ERROR_STOP on
-- Preserve the exact live validation/authority contracts while replacing repeated work.
do $guard$
begin
  if (select md5(prosrc) from pg_proc where oid='public.finance_submit_invoice_batch(text,jsonb,text)'::regprocedure) is distinct from '9a5ffcb22087913916545381e28a7158'
     or (select md5(prosrc) from pg_proc where oid='public.finance_submit_bill_batch(text,jsonb,text)'::regprocedure) is distinct from 'cb5815484b3f90c0f4a73bf4461021d5'
     or (select md5(prosrc) from pg_proc where oid='private.finance_history_projection_source_trigger_v1()'::regprocedure) is distinct from 'dacedbff7dc0b1a6ea7a1361951cc6bd'
     or (select md5(prosrc) from pg_proc where oid='private.finance_refresh_invoice_batch_approval_notification_v1()'::regprocedure) is distinct from 'dda1bdef0235a592beddc380dec514f5'
     or (select md5(prosrc) from pg_proc where oid='private.finance_enqueue_current_approval_email()'::regprocedure) is distinct from 'ebae3a8045744a11bfa2892f04d80f2f'
     or not exists(select 1 from pg_trigger where tgrelid='public.invoices'::regclass and tgname='finance_history_projection_insert_v1' and tgenabled='O' and tgtype=4 and tgnewtable='new_source' and tgfoid='private.finance_history_projection_source_trigger_v1()'::regprocedure)
     or not exists(select 1 from pg_trigger where tgrelid='public.invoices'::regclass and tgname='trg_zz_invoices_refresh_batch_approval_notification_v1' and tgenabled='O' and tgtype=21 and tgfoid='private.finance_refresh_invoice_batch_approval_notification_v1()'::regprocedure)
     or to_regprocedure('private.finance_refresh_invoice_batch_approval_notification_statement_v2()') is not null
  then
    raise exception 'Invoice submission/notification source drifted; review before bulk repair' using errcode='55000';
  end if;
end;
$guard$;

select 'FINANCE_INVOICE_BATCH_BULK_PREFLIGHT_OK' as marker;
