\set ON_ERROR_STOP on

-- Read-only source gate. The migration repeats these checks in its transaction.
do $preflight$
declare
  v_enqueue oid := pg_catalog.to_regprocedure('private.finance_enqueue_current_approval_email()')::oid;
  v_history_summary oid := pg_catalog.to_regprocedure('public.finance_personal_document_summary_v1(text,integer,integer,text,text)')::oid;
  v_history_detail oid := pg_catalog.to_regprocedure('public.finance_personal_document_detail_v1(text,text)')::oid;
begin
  if not exists (
      select 1 from supabase_migrations.schema_migrations
      where version = '20261008100000'
        and name = 'finance_bill_batch_bulk_insert_v1'
    )
    or exists (
      select 1 from supabase_migrations.schema_migrations
      where version = '20261010120000'
    )
    or not exists (
      select 1 from supabase_migrations.schema_migrations
      where version = '20261008090000'
        and name = 'finance_personal_history_permission_guard_v1'
    )
    or exists (
      select 1 from supabase_migrations.schema_migrations
      where version = '20261010130000'
    )
    or pg_catalog.to_regclass('public.invoices') is null
    or pg_catalog.to_regclass('public.notification_delivery_events') is null
    or pg_catalog.to_regclass('private.approval_notification_assignment_state') is null
    or v_enqueue is null
    or v_history_summary is null or v_history_detail is null
    or not exists (
      select 1 from pg_catalog.pg_proc p
      where p.oid=v_history_summary
        and pg_catalog.pg_get_userbyid(p.proowner)='postgres'
        and p.prosecdef and p.provolatile='s'
        and p.proconfig=array['search_path=""']::text[]
        and pg_catalog.md5(p.prosrc)='aa22dee9e0278261f556b0e719c6a2c9'
    )
    or not exists (
      select 1 from pg_catalog.pg_proc p
      where p.oid=v_history_detail
        and pg_catalog.pg_get_userbyid(p.proowner)='postgres'
        and p.prosecdef and p.provolatile='s'
        and p.proconfig=array['search_path=""']::text[]
        and pg_catalog.md5(p.prosrc)='42fdd32a60184cad0f1aa151c7093730'
    )
    or pg_catalog.to_regprocedure('private.finance_refresh_invoice_batch_approval_notification_v1()') is not null
    or not exists (
      select 1 from pg_catalog.pg_proc p
      where p.oid = v_enqueue
        and pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
        and p.prosecdef
        and pg_catalog.md5(p.prosrc) = 'ebae3a8045744a11bfa2892f04d80f2f'
    )
    or not exists (
      select 1 from pg_catalog.pg_trigger t
      where t.tgrelid = 'public.invoices'::pg_catalog.regclass
        and t.tgname = 'trg_invoices_enqueue_approval_email'
        and t.tgenabled = 'O' and t.tgtype = 21 and t.tgfoid = v_enqueue
    )
    or exists (
      select 1 from pg_catalog.pg_trigger t
      where t.tgrelid = 'public.invoices'::pg_catalog.regclass
        and t.tgname = 'trg_zz_invoices_refresh_batch_approval_notification_v1'
    ) then
    raise exception 'Invoice batch approval notification preflight found source, trigger, or ledger drift'
      using errcode = '55000';
  end if;
end;
$preflight$;

select 'FINANCE_INVOICE_BATCH_APPROVAL_PREFLIGHT_OK' as marker;
