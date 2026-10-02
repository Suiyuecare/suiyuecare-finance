\set ON_ERROR_STOP on

-- Fail closed if any authority helper, trigger, owner or ACL has drifted.
do $preflight$
declare
  v_row record;
  v_function oid;
begin
  if pg_catalog.to_regclass('public.expense_requests') is null
     or not exists (
       select 1 from information_schema.columns
       where table_schema = 'public'
         and table_name = 'expense_requests'
         and column_name = 'form_payload'
         and data_type = 'jsonb'
     )
     or not exists (
       select 1 from supabase_migrations.schema_migrations
       where version = '20260902054834'
     )
     or exists (
       select 1 from supabase_migrations.schema_migrations
       where version = '20261002035707'
     ) then
    raise exception 'human accounting float baseline or ledger drifted';
  end if;

  for v_row in
    select * from (values
      ('private.finance_accounting_line_is_human(jsonb)'::text,
       '9629c9014bd4f614f239d5093f38ea8e'::text, false),
      ('private.finance_merge_human_accounting_line(jsonb,jsonb)',
       'd2d9aaee13a9ebbdcecac3161bcc2c46', false),
      ('private.finance_merge_human_accounting_lines(jsonb,jsonb)',
       'dc69d47de0c50dafd6b23e8ce4d917df', false),
      ('private.finance_preserve_human_accounting_authority()',
       '39a28d0a2e14302193fbf769a094fd4b', true)
    ) expected(signature, definition_md5, security_definer)
  loop
    v_function := pg_catalog.to_regprocedure(v_row.signature)::oid;
    if v_function is null
       or not exists (
         select 1 from pg_catalog.pg_proc proc_row
         where proc_row.oid = v_function
           and pg_catalog.md5(pg_catalog.pg_get_functiondef(proc_row.oid))
               = v_row.definition_md5
           and pg_catalog.pg_get_userbyid(proc_row.proowner) = 'postgres'
           and proc_row.prosecdef = v_row.security_definer
           and proc_row.proconfig = array['search_path=""']::text[]
           and proc_row.proacl is null
       ) then
      raise exception 'human accounting authority function drifted: %',
        v_row.signature;
    end if;
  end loop;

  if not exists (
    select 1 from pg_catalog.pg_trigger trigger_row
    where trigger_row.tgrelid = 'public.expense_requests'::regclass
      and trigger_row.tgname =
        'trg_zz_finance_preserve_human_accounting_authority'
      and trigger_row.tgfoid =
        'private.finance_preserve_human_accounting_authority()'::regprocedure
      and trigger_row.tgenabled = 'O'
      and not trigger_row.tgisinternal
      and pg_catalog.md5(pg_catalog.pg_get_triggerdef(trigger_row.oid)) =
        '833406b39efb428e13c9c306e6cf03c9'
  ) then
    raise exception 'human accounting before-update trigger drifted';
  end if;
end;
$preflight$;

select 'FINANCE_HUMAN_FLOAT_PREFLIGHT_OK' as marker;
