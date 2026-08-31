-- Route a missing same-department supervisor / department manager to the
-- canonical department director.  The organization context already proves
-- that this director is active, approval-capable, effective today and belongs
-- to the applicant's department.  This closes the top-level CEO case without
-- allowing a client-supplied actor or an unrelated active user to take over.
--
-- This migration deliberately patches only the two pinned resolver lines.  A
-- source hash preflight makes the migration fail closed if production has
-- drifted from the reviewed baseline.
do $migration$
declare
  v_oid oid := 'public.finance_org_resolve_actor(text,text,text,text,text)'::regprocedure::oid;
  v_definition text;
  v_source text;
  v_expected_source text;
  v_actual_source text;
  v_old_direct constant text :=
    'v_target_user_id := nullif(v_context #>> ''{approval_chain,direct_supervisor_finance_user_id}'', '''');';
  v_new_direct constant text :=
    'v_target_user_id := coalesce(nullif(v_context #>> ''{approval_chain,direct_supervisor_finance_user_id}'', ''''), nullif(v_context #>> ''{approval_chain,department_director_finance_user_id}'', ''''));';
  v_old_manager constant text :=
    'v_target_user_id := nullif(v_context #>> ''{approval_chain,department_manager_finance_user_id}'', '''');';
  v_new_manager constant text :=
    'v_target_user_id := coalesce(nullif(v_context #>> ''{approval_chain,department_manager_finance_user_id}'', ''''), nullif(v_context #>> ''{approval_chain,department_director_finance_user_id}'', ''''));';
begin
  select pg_catalog.pg_get_functiondef(proc_row.oid), proc_row.prosrc
    into v_definition, v_source
  from pg_catalog.pg_proc proc_row
  where proc_row.oid = v_oid
    and pg_catalog.pg_get_userbyid(proc_row.proowner) = 'postgres'
    and proc_row.prosecdef
    and proc_row.proconfig = array['search_path=public, pg_temp']::text[]
    and not pg_catalog.has_function_privilege('public', proc_row.oid, 'EXECUTE')
    and not pg_catalog.has_function_privilege('anon', proc_row.oid, 'EXECUTE')
    and pg_catalog.has_function_privilege('authenticated', proc_row.oid, 'EXECUTE')
    and pg_catalog.has_function_privilege('service_role', proc_row.oid, 'EXECUTE');

  if v_definition is null or v_source is null then
    raise exception 'finance_org_resolve_actor owner, security, search_path or ACL baseline drifted';
  end if;
  if extensions.digest(v_source::bytea, 'sha256') <>
       extensions.decode('c5b8ac8042c4df045589a5f25ec05ee3c5d660b9692efe0182c17f07c0cf25eb', 'hex') then
    raise exception 'finance_org_resolve_actor source is not the reviewed production baseline';
  end if;
  if (pg_catalog.length(v_source) - pg_catalog.length(pg_catalog.replace(v_source, v_old_direct, '')))
       / pg_catalog.length(v_old_direct) <> 1
     or (pg_catalog.length(v_source) - pg_catalog.length(pg_catalog.replace(v_source, v_old_manager, '')))
       / pg_catalog.length(v_old_manager) <> 1 then
    raise exception 'finance_org_resolve_actor target statements are missing or duplicated';
  end if;

  v_expected_source := pg_catalog.replace(
    pg_catalog.replace(v_source, v_old_direct, v_new_direct),
    v_old_manager,
    v_new_manager
  );
  v_definition := pg_catalog.replace(
    pg_catalog.replace(v_definition, v_old_direct, v_new_direct),
    v_old_manager,
    v_new_manager
  );
  execute v_definition;

  select proc_row.prosrc
    into v_actual_source
  from pg_catalog.pg_proc proc_row
  where proc_row.oid = v_oid
    and pg_catalog.pg_get_userbyid(proc_row.proowner) = 'postgres'
    and proc_row.prosecdef
    and proc_row.proconfig = array['search_path=public, pg_temp']::text[]
    and not pg_catalog.has_function_privilege('public', proc_row.oid, 'EXECUTE')
    and not pg_catalog.has_function_privilege('anon', proc_row.oid, 'EXECUTE')
    and pg_catalog.has_function_privilege('authenticated', proc_row.oid, 'EXECUTE')
    and pg_catalog.has_function_privilege('service_role', proc_row.oid, 'EXECUTE');

  if extensions.digest(v_actual_source::bytea, 'sha256') <>
       extensions.digest(v_expected_source::bytea, 'sha256') then
    raise exception 'finance_org_resolve_actor postflight source differs from the reviewed patch';
  end if;
  if pg_catalog.position(v_new_direct in v_actual_source) = 0
     or pg_catalog.position(v_new_manager in v_actual_source) = 0 then
    raise exception 'finance_org_resolve_actor did not install the department-director fallback';
  end if;
end;
$migration$;

comment on function public.finance_org_resolve_actor(text,text,text,text,text) is
  'Resolves canonical Finance approval actors; missing same-department supervisor/manager falls back to the formally assigned department director.';
