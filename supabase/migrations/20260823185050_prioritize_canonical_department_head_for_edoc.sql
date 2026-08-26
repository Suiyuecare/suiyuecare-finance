-- Prefer the canonical department director over a section chief that owns a
-- department-management flag.  The flag is used by Finance for local unit
-- administration, but eDoc's departmentHead slot is the separate 主任 step.
--
-- This is a forward-only hotfix because finance_edoc_identity_snapshot is a
-- large existing function shared by the Finance login bridge.  We patch two
-- exact, fail-closed fragments of the installed definition rather than copy a
-- second full definition that could drift from the production function.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $department_head_resolution$
declare
  v_function regprocedure := 'public.finance_edoc_identity_snapshot(text)'::regprocedure;
  v_definition text;
  v_updated_definition text;
  v_old_order text := $old_order$
    order by manager_role.is_primary desc,
             manager_role.updated_at desc nulls last,
             manager_role.created_at,
             manager_role.id
    limit 1;$old_order$;
  v_new_order text := $new_order$
    order by case
               when manager_role.role_key in ('dept_manager', 'department_manager', 'department_head')
                 or manager_user.role in ('dept_manager', 'department_manager', 'department_head')
                 then 0
               when manager_role.is_department_manager then 1
               else 2
             end,
             manager_role.is_primary desc,
             manager_role.updated_at desc nulls last,
             manager_role.created_at,
             manager_role.id
    limit 1;$new_order$;
  v_old_guard text := $old_guard$
      if v_department_head is null then
        v_issues := v_issues || jsonb_build_array('department_head_missing');
      elsif exists ($old_guard$;
  v_new_guard text := $new_guard$
      if v_department_head is null then
        v_issues := v_issues || jsonb_build_array('department_head_missing');
      elsif lower(coalesce(v_department_head ->> 'role', '')) not in (
        'dept_manager',
        'department_manager',
        'department_head',
        'admin_director',
        'ceo'
      ) then
        v_issues := v_issues || jsonb_build_array('department_head_role_invalid');
      elsif exists ($new_guard$;
  v_invalid_ready_count integer := 0;
begin
  v_definition := pg_catalog.pg_get_functiondef(v_function);

  if (
    (length(v_definition) - length(pg_catalog.replace(v_definition, v_old_order, '')))
    / greatest(length(v_old_order), 1)
  ) <> 1 then
    raise exception 'department-head resolver order preflight mismatch';
  end if;

  if (
    (length(v_definition) - length(pg_catalog.replace(v_definition, v_old_guard, '')))
    / greatest(length(v_old_guard), 1)
  ) <> 1 then
    raise exception 'department-head role guard preflight mismatch';
  end if;

  v_updated_definition := pg_catalog.replace(v_definition, v_old_order, v_new_order);
  v_updated_definition := pg_catalog.replace(v_updated_definition, v_old_guard, v_new_guard);
  execute v_updated_definition;

  v_definition := pg_catalog.pg_get_functiondef(v_function);
  if position(v_new_order in v_definition) = 0
     or position(v_new_guard in v_definition) = 0
     or position(v_old_order in v_definition) > 0
     or position(v_old_guard in v_definition) > 0 then
    raise exception 'department-head resolver postflight mismatch';
  end if;

  select count(*)
  into v_invalid_ready_count
  from public.finance_users user_row
  cross join lateral public.finance_edoc_identity_snapshot(
    lower(pg_catalog.btrim(user_row.email))
  ) snapshot
  where user_row.active = true
    and lower(coalesce(nullif(user_row.org_status, ''), 'active')) = 'active'
    and coalesce((snapshot ->> 'workflowReady')::boolean, false) = true
    and snapshot #> '{actors,departmentHead}' is not null
    and snapshot #> '{actors,departmentHead}' <> 'null'::jsonb
    and lower(coalesce(snapshot #>> '{actors,departmentHead,role}', '')) not in (
      'dept_manager',
      'department_manager',
      'department_head',
      'admin_director',
      'ceo'
    );

  if v_invalid_ready_count <> 0 then
    raise exception 'workflow-ready snapshots contain % invalid department-head roles',
      v_invalid_ready_count;
  end if;
end;
$department_head_resolution$;

alter function public.finance_edoc_identity_snapshot(text) owner to postgres;
revoke all on function public.finance_edoc_identity_snapshot(text)
  from public, anon, authenticated;
grant execute on function public.finance_edoc_identity_snapshot(text)
  to service_role;

-- Re-project every real active Finance member through the corrected resolver.
-- The outbox compare-and-set revision keeps retries and delivery ordering safe.
do $refresh_members$
declare
  user_row record;
  v_revision bigint;
begin
  for user_row in
    select tenant_id, id
    from public.finance_users
    where active = true
      and lower(coalesce(nullif(org_status, ''), 'active')) = 'active'
    order by tenant_id, id
  loop
    v_revision := private.finance_edoc_touch_member_v1(
      user_row.tenant_id,
      user_row.id
    );
    if v_revision is null or v_revision < 1 then
      raise exception 'failed to enqueue corrected eDoc member projection';
    end if;
  end loop;
end;
$refresh_members$;

notify pgrst, 'reload schema';

commit;
