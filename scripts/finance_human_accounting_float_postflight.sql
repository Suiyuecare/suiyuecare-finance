\set ON_ERROR_STOP on

-- Run inside the atomic migration+ledger transaction and again afterwards.
-- This inspects only schema metadata; request contents remain untouched.
do $postflight$
declare
  v_row record;
  v_function oid;
begin
  for v_row in
    select * from (values
      ('private.finance_accounting_line_is_human(jsonb)'::text,
       '9629c9014bd4f614f239d5093f38ea8e'::text),
      ('private.finance_merge_human_accounting_line(jsonb,jsonb)',
       'd2d9aaee13a9ebbdcecac3161bcc2c46'),
      ('private.finance_merge_human_accounting_lines(jsonb,jsonb)',
       'dc69d47de0c50dafd6b23e8ce4d917df')
    ) expected(signature, definition_md5)
  loop
    v_function := pg_catalog.to_regprocedure(v_row.signature)::oid;
    if v_function is null
       or not exists (
         select 1 from pg_catalog.pg_proc proc_row
         where proc_row.oid = v_function
           and pg_catalog.md5(pg_catalog.pg_get_functiondef(proc_row.oid))
               = v_row.definition_md5
           and pg_catalog.pg_get_userbyid(proc_row.proowner) = 'postgres'
           and not proc_row.prosecdef
           and proc_row.proconfig = array['search_path=""']::text[]
           and proc_row.proacl is null
       ) then
      raise exception 'human accounting helper changed: %', v_row.signature;
    end if;
  end loop;

  v_function := pg_catalog.to_regprocedure(
    'private.finance_preserve_human_accounting_authority()'
  )::oid;
  if v_function is null
     or not exists (
       select 1 from pg_catalog.pg_proc proc_row
       where proc_row.oid = v_function
         and pg_catalog.md5(proc_row.prosrc) =
           '5063469c0ca7c63b29996ff615121c40'
         and pg_catalog.pg_get_userbyid(proc_row.proowner) = 'postgres'
         and proc_row.prosecdef
         and proc_row.proconfig = array['search_path=""']::text[]
         and proc_row.proacl is null
     ) then
    raise exception 'human accounting float guard source or authority drifted';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_trigger trigger_row
    where trigger_row.tgrelid = 'public.expense_requests'::regclass
      and trigger_row.tgname =
        'trg_zz_finance_preserve_human_accounting_authority'
      and trigger_row.tgfoid = v_function
      and trigger_row.tgenabled = 'O'
      and not trigger_row.tgisinternal
      and pg_catalog.md5(pg_catalog.pg_get_triggerdef(trigger_row.oid)) =
        '833406b39efb428e13c9c306e6cf03c9'
  ) then
    raise exception 'human accounting float guard trigger changed';
  end if;
end;
$postflight$;

select 'FINANCE_HUMAN_FLOAT_POSTFLIGHT_OK' as marker;
