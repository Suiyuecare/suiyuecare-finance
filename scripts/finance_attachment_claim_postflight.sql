\set ON_ERROR_STOP on

do $postflight$
declare
  v_function oid := pg_catalog.to_regprocedure(
    'private.finance_claim_attachment_metadata_v2()'
  )::oid;
  v_source_sha256 text;
begin
  if v_function is null then
    raise exception 'attachment claim trigger function is absent';
  end if;

  select pg_catalog.encode(
           extensions.digest(proc_row.prosrc::bytea, 'sha256'),
           'hex'
         )
    into v_source_sha256
  from pg_catalog.pg_proc proc_row
  where proc_row.oid = v_function;

  if v_source_sha256 is distinct from
       'f6b0a07ae4ee42f178da9e09fa46aee85aa902cc98936175389449b06680bbe3'
     or not exists (
       select 1
       from pg_catalog.pg_proc proc_row
       where proc_row.oid = v_function
         and pg_catalog.pg_get_userbyid(proc_row.proowner) = 'postgres'
         and proc_row.prosecdef
         and proc_row.proconfig = array['search_path=""']::text[]
         and proc_row.proacl::text =
           '{postgres=X/postgres,service_role=X/postgres}'
     )
     or pg_catalog.has_function_privilege(
       'public',
       'private.finance_claim_attachment_metadata_v2()'::regprocedure,
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'anon',
       'private.finance_claim_attachment_metadata_v2()'::regprocedure,
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'authenticated',
       'private.finance_claim_attachment_metadata_v2()'::regprocedure,
       'EXECUTE'
     )
     or not pg_catalog.has_function_privilege(
       'service_role',
       'private.finance_claim_attachment_metadata_v2()'::regprocedure,
       'EXECUTE'
     ) then
    raise exception 'attachment claim trigger source or privilege boundary drifted';
  end if;

  if (
    select count(*)
    from pg_catalog.pg_trigger trigger_row
    where trigger_row.tgfoid = v_function
      and trigger_row.tgenabled = 'O'
      and (
        (trigger_row.tgrelid, trigger_row.tgname) in (
          ('public.expense_requests'::regclass, 'trg_claim_expense_attachments_v2'),
          ('public.invoices'::regclass, 'trg_claim_invoice_attachments_v2'),
          ('public.bills'::regclass, 'trg_claim_bill_attachments_v2'),
          ('public.vouchers'::regclass, 'trg_claim_voucher_attachments_v2')
        )
      )
  ) <> 4 then
    raise exception 'attachment claim trigger bindings drifted';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_index index_row
    where index_row.indrelid = 'public.file_attachments'::regclass
      and index_row.indexrelid =
        'public.file_attachments_storage_path_key'::regclass
      and index_row.indisunique
      and index_row.indisvalid
      and index_row.indisready
  ) then
    raise exception 'unique attachment storage_path index is unavailable';
  end if;

  if not exists (
    select 1
    from supabase_migrations.schema_migrations
    where version = '20261001030323'
      and name = 'fix_attachment_claim_path_lookup'
  ) then
    raise exception 'attachment claim migration is absent from ledger';
  end if;
end;
$postflight$;

select 'FINANCE_ATTACHMENT_CLAIM_POSTFLIGHT_OK' as result;
