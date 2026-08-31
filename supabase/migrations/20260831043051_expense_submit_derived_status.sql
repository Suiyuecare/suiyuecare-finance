-- Derive the persisted request status and approval step from the canonical,
-- database-validated workflow immediately before the insert.  status/step are
-- projections of steps, not client-owned authorization input.  Recomputing
-- them here prevents reviewed self-skip routes from being rejected when their
-- first real pending actor is later than the legacy second step.
--
-- The patch is deliberately limited to the public v3 submit wrapper and is
-- pinned to the exact production source/security/ACL baseline.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $migration$
declare
  v_oid oid := 'public.finance_submit_expense_request(jsonb,uuid,text,jsonb)'::regprocedure::oid;
  v_definition text;
  v_source text;
  v_expected_source text;
  v_actual_source text;
  v_old_declare constant text := E'  v_result jsonb;\nbegin';
  v_new_declare constant text := E'  v_result jsonb;\n  v_derived jsonb;\nbegin';
  v_old_submit constant text := E'  begin\n    v_result := private.finance_submit_expense_request_v1_unsafe(';
  v_new_submit constant text := E'  v_derived := private.finance_income_status_from_steps(v_form -> ''steps'');\n  if coalesce(v_derived ->> ''approval_status'', '''') in ('''', ''completed'') then\n    raise exception ''簽核流程沒有可執行的下一關'' using errcode = ''23514'';\n  end if;\n  v_form := v_form || pg_catalog.jsonb_build_object(\n    ''status'', v_derived ->> ''approval_status'',\n    ''step'', (v_derived ->> ''approval_step'')::integer\n  );\n\n  begin\n    v_result := private.finance_submit_expense_request_v1_unsafe(';
begin
  select pg_catalog.pg_get_functiondef(proc_row.oid), proc_row.prosrc
    into v_definition, v_source
  from pg_catalog.pg_proc proc_row
  where proc_row.oid = v_oid
    and pg_catalog.pg_get_userbyid(proc_row.proowner) = 'postgres'
    and proc_row.prosecdef
    and proc_row.proconfig = array['search_path=""']::text[]
    and not pg_catalog.has_function_privilege('public', proc_row.oid, 'EXECUTE')
    and not pg_catalog.has_function_privilege('anon', proc_row.oid, 'EXECUTE')
    and pg_catalog.has_function_privilege('authenticated', proc_row.oid, 'EXECUTE')
    and pg_catalog.has_function_privilege('service_role', proc_row.oid, 'EXECUTE');

  if v_definition is null or v_source is null then
    raise exception 'finance_submit_expense_request owner, security, search_path or ACL baseline drifted';
  end if;
  if extensions.digest(v_source::bytea, 'sha256') <>
       pg_catalog.decode('4c309af8e1cd1384fe6121a452d2a378d1f3ed07cf3a32c0618b97913b1f6927', 'hex') then
    raise exception 'finance_submit_expense_request source is not the reviewed production baseline';
  end if;
  if (pg_catalog.length(v_source) - pg_catalog.length(pg_catalog.replace(v_source, v_old_declare, '')))
       / pg_catalog.length(v_old_declare) <> 1
     or (pg_catalog.length(v_source) - pg_catalog.length(pg_catalog.replace(v_source, v_old_submit, '')))
       / pg_catalog.length(v_old_submit) <> 1 then
    raise exception 'finance_submit_expense_request patch anchors are missing or duplicated';
  end if;

  v_expected_source := pg_catalog.replace(
    pg_catalog.replace(v_source, v_old_declare, v_new_declare),
    v_old_submit,
    v_new_submit
  );
  v_definition := pg_catalog.replace(
    pg_catalog.replace(v_definition, v_old_declare, v_new_declare),
    v_old_submit,
    v_new_submit
  );
  execute v_definition;

  select proc_row.prosrc
    into v_actual_source
  from pg_catalog.pg_proc proc_row
  where proc_row.oid = v_oid
    and pg_catalog.pg_get_userbyid(proc_row.proowner) = 'postgres'
    and proc_row.prosecdef
    and proc_row.proconfig = array['search_path=""']::text[]
    and not pg_catalog.has_function_privilege('public', proc_row.oid, 'EXECUTE')
    and not pg_catalog.has_function_privilege('anon', proc_row.oid, 'EXECUTE')
    and pg_catalog.has_function_privilege('authenticated', proc_row.oid, 'EXECUTE')
    and pg_catalog.has_function_privilege('service_role', proc_row.oid, 'EXECUTE');

  if extensions.digest(v_actual_source::bytea, 'sha256') <>
       extensions.digest(v_expected_source::bytea, 'sha256') then
    raise exception 'finance_submit_expense_request postflight source differs from the reviewed patch';
  end if;
  if pg_catalog.strpos(v_actual_source, 'v_derived := private.finance_income_status_from_steps') = 0
     or pg_catalog.strpos(v_actual_source, '''status'', v_derived ->> ''approval_status''') = 0
     or pg_catalog.strpos(v_actual_source, '''step'', (v_derived ->> ''approval_step'')::integer') = 0 then
    raise exception 'finance_submit_expense_request did not install server-derived status and step';
  end if;
end;
$migration$;

comment on function public.finance_submit_expense_request(jsonb,uuid,text,jsonb) is
  'Submits an expense through the canonical v3 route; request status and active step are derived server-side from the validated workflow.';

notify pgrst, 'reload schema';
