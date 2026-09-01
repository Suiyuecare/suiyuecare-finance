-- Assign the canonical CEO account as the formal cashier secondary role,
-- remove the historical general-affairs fallback from both database actor
-- resolvers, and move the three currently pending cashier tasks from u8 to the
-- formal cashier.  The request step keeps an embedded reassignment history and
-- the before/after state is also written to audit_logs.

do $migration$
declare
  v_role_oid oid := 'public.finance_org_role_members(text,text)'::regprocedure::oid;
  v_resolver_oid oid := 'public.finance_org_resolve_actor(text,text,text,text,text)'::regprocedure::oid;
  v_definition text;
  v_source text;
  v_expected_source text;
  v_actual_source text;
  v_old_cashier_normalization constant text := 'when ''cashier'' then ''general_affairs''';
  v_new_cashier_normalization constant text := 'when ''cashier'' then ''cashier''';
  v_old_general_affairs_fallback constant text := 'or (p_role_key = ''cashier'' and fu.role = ''general_affairs'')';
  v_new_general_affairs_fallback constant text := 'or false /* general-affairs fallback removed */';
  v_old_cashier_department_scope constant text := 'case when v_kind = ''cashier'' then v_department_code else null end';
  v_new_cashier_department_scope constant text := 'null::text';
begin
  select pg_catalog.pg_get_functiondef(proc_row.oid), proc_row.prosrc
    into v_definition, v_source
  from pg_catalog.pg_proc proc_row
  where proc_row.oid = v_role_oid
    and pg_catalog.pg_get_userbyid(proc_row.proowner) = 'postgres'
    and proc_row.prosecdef
    and proc_row.proconfig = array['search_path=public, pg_temp']::text[]
    and not pg_catalog.has_function_privilege('public', proc_row.oid, 'EXECUTE')
    and not pg_catalog.has_function_privilege('anon', proc_row.oid, 'EXECUTE')
    and pg_catalog.has_function_privilege('authenticated', proc_row.oid, 'EXECUTE')
    and pg_catalog.has_function_privilege('service_role', proc_row.oid, 'EXECUTE');

  if v_definition is null or v_source is null then
    raise exception 'finance_org_role_members owner, security, search_path or ACL baseline drifted';
  end if;
  if extensions.digest(v_source::bytea, 'sha256') <>
       pg_catalog.decode('52e4fe984d2ee7bbadb72a6d96dfe443caf9de91b08eba689e21249a78a33213', 'hex') then
    raise exception 'finance_org_role_members source is not the reviewed production baseline';
  end if;
  if (pg_catalog.length(v_source) - pg_catalog.length(pg_catalog.replace(v_source, v_old_cashier_normalization, '')))
       / pg_catalog.length(v_old_cashier_normalization) <> 1
     or (pg_catalog.length(v_source) - pg_catalog.length(pg_catalog.replace(v_source, v_old_general_affairs_fallback, '')))
       / pg_catalog.length(v_old_general_affairs_fallback) <> 1 then
    raise exception 'finance_org_role_members cashier fallback statements are missing or duplicated';
  end if;

  v_expected_source := pg_catalog.replace(
    pg_catalog.replace(v_source, v_old_cashier_normalization, v_new_cashier_normalization),
    v_old_general_affairs_fallback,
    v_new_general_affairs_fallback
  );
  v_definition := pg_catalog.replace(
    pg_catalog.replace(v_definition, v_old_cashier_normalization, v_new_cashier_normalization),
    v_old_general_affairs_fallback,
    v_new_general_affairs_fallback
  );
  execute v_definition;

  select proc_row.prosrc
    into v_actual_source
  from pg_catalog.pg_proc proc_row
  where proc_row.oid = v_role_oid;

  if extensions.digest(v_actual_source::bytea, 'sha256') <>
       extensions.digest(v_expected_source::bytea, 'sha256')
     or pg_catalog.strpos(v_actual_source, v_old_cashier_normalization) > 0
     or pg_catalog.strpos(v_actual_source, v_old_general_affairs_fallback) > 0 then
    raise exception 'finance_org_role_members cashier fallback removal did not match reviewed patch';
  end if;

  select pg_catalog.pg_get_functiondef(proc_row.oid), proc_row.prosrc
    into v_definition, v_source
  from pg_catalog.pg_proc proc_row
  where proc_row.oid = v_resolver_oid
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
       pg_catalog.decode('1fff070fc78f2d0182647f496b51119ecfa072a7b189bc25fb767567d99c874a', 'hex') then
    raise exception 'finance_org_resolve_actor source is not the reviewed production baseline';
  end if;
  if (pg_catalog.length(v_source) - pg_catalog.length(pg_catalog.replace(v_source, v_old_cashier_department_scope, '')))
       / pg_catalog.length(v_old_cashier_department_scope) <> 1 then
    raise exception 'finance_org_resolve_actor cashier department scope statement is missing or duplicated';
  end if;

  v_expected_source := pg_catalog.replace(v_source, v_old_cashier_department_scope, v_new_cashier_department_scope);
  v_definition := pg_catalog.replace(v_definition, v_old_cashier_department_scope, v_new_cashier_department_scope);
  execute v_definition;

  select proc_row.prosrc
    into v_actual_source
  from pg_catalog.pg_proc proc_row
  where proc_row.oid = v_resolver_oid;

  if extensions.digest(v_actual_source::bytea, 'sha256') <>
       extensions.digest(v_expected_source::bytea, 'sha256')
     or pg_catalog.strpos(v_actual_source, v_old_cashier_department_scope) > 0 then
    raise exception 'finance_org_resolve_actor global cashier patch did not match reviewed patch';
  end if;
end;
$migration$;

comment on function public.finance_org_role_members(text,text) is
  'Returns only formally assigned role members; cashier never falls back to general affairs.';

comment on function public.finance_org_resolve_actor(text,text,text,text,text) is
  'Resolves canonical Finance approval actors; cashier is a global formal role and never falls back to general affairs.';

do $migration$
declare
  v_tenant_id constant uuid := '00000000-0000-0000-0000-000000000001'::uuid;
  v_cashier_user_id constant text := 'u_entrepreneur';
  v_cashier_email constant text := 'entrepreneur@suiyuecare.com';
  v_cashier_department_code constant text := 'A1000';
  v_role_id constant text := 'edr_cashier_u_entrepreneur_20260901';
  v_department_id uuid;
  v_existing_role jsonb;
  v_new_role jsonb;
begin
  if not exists (
    select 1
    from public.finance_users
    where tenant_id = v_tenant_id
      and id = v_cashier_user_id
      and active is true
      and role = 'ceo'
      and lower(email) = v_cashier_email
  ) then
    raise exception 'Canonical CEO account for the formal cashier role is missing or inactive';
  end if;

  if exists (
    select 1
    from public.employee_department_roles role_row
    join public.finance_users finance_user
      on finance_user.id = role_row.finance_user_id
     and finance_user.tenant_id = role_row.tenant_id
    where role_row.tenant_id = v_tenant_id
      and role_row.active is true
      and role_row.role_key = 'cashier'
      and role_row.finance_user_id <> v_cashier_user_id
      and finance_user.active is true
  ) then
    raise exception 'Another active formal cashier exists; refusing to replace it implicitly';
  end if;

  select department.id
    into v_department_id
  from public.departments department
  where department.code = v_cashier_department_code
    and department.status = 'active'
  order by department.created_at, department.id
  limit 1;

  if v_department_id is null then
    raise exception 'A1000 department required for the formal cashier role is missing';
  end if;

  select pg_catalog.to_jsonb(role_row)
    into v_existing_role
  from public.employee_department_roles role_row
  where role_row.id = v_role_id;

  insert into public.employee_department_roles (
    id,
    tenant_id,
    finance_user_id,
    department_id,
    department_code,
    position_id,
    role_key,
    role_type,
    relation_type,
    is_primary,
    effective_from,
    effective_to,
    active,
    direct_supervisor_finance_user_id,
    is_department_manager,
    is_department_director,
    can_approve,
    approval_delegate_finance_user_id,
    permissions_override,
    metadata,
    created_at,
    updated_at
  ) values (
    v_role_id,
    v_tenant_id,
    v_cashier_user_id,
    v_department_id,
    v_cashier_department_code,
    null,
    'cashier',
    'secondary',
    'concurrent',
    false,
    current_date,
    null,
    true,
    null,
    false,
    false,
    true,
    null,
    '{}'::jsonb,
    pg_catalog.jsonb_build_object(
      'source', '20260901072349_assign_ceo_cashier_and_reassign_pending_cashier',
      'assignment_reason', 'CEO Lee Chia-Tai is the designated formal cashier',
      'primary_role_preserved', 'ceo',
      'authorized_in_codex', true,
      'assigned_at', pg_catalog.now()
    ),
    pg_catalog.now(),
    pg_catalog.now()
  )
  on conflict (id) do update
    set tenant_id = excluded.tenant_id,
        finance_user_id = excluded.finance_user_id,
        department_id = excluded.department_id,
        department_code = excluded.department_code,
        position_id = excluded.position_id,
        role_key = excluded.role_key,
        role_type = excluded.role_type,
        relation_type = excluded.relation_type,
        is_primary = excluded.is_primary,
        effective_from = excluded.effective_from,
        effective_to = excluded.effective_to,
        active = excluded.active,
        direct_supervisor_finance_user_id = excluded.direct_supervisor_finance_user_id,
        is_department_manager = excluded.is_department_manager,
        is_department_director = excluded.is_department_director,
        can_approve = excluded.can_approve,
        approval_delegate_finance_user_id = excluded.approval_delegate_finance_user_id,
        permissions_override = excluded.permissions_override,
        metadata = excluded.metadata,
        updated_at = excluded.updated_at;

  select pg_catalog.to_jsonb(role_row)
    into v_new_role
  from public.employee_department_roles role_row
  where role_row.id = v_role_id;

  if coalesce((v_new_role ->> 'active')::boolean, false) is not true
     or v_new_role ->> 'finance_user_id' <> v_cashier_user_id
     or v_new_role ->> 'role_key' <> 'cashier'
     or coalesce((v_new_role ->> 'is_primary')::boolean, true) is not false
     or coalesce((v_new_role ->> 'can_approve')::boolean, false) is not true then
    raise exception 'Formal cashier secondary role did not persist as expected';
  end if;

  insert into public.audit_logs (
    action,
    resource_type,
    resource_id,
    before_data,
    after_data,
    metadata
  ) values (
    'cashier_role_assigned',
    'employee_department_role',
    v_role_id,
    v_existing_role,
    v_new_role,
    pg_catalog.jsonb_build_object(
      'migration', '20260901072349_assign_ceo_cashier_and_reassign_pending_cashier',
      'reason', 'Designate Lee Chia-Tai as the formal cashier while preserving the CEO primary role',
      'authorized_in_codex', true
    )
  );
end;
$migration$;

do $migration$
declare
  v_request public.expense_requests%rowtype;
  v_target_nos constant text[] := array['20260827012','20260831007','20260831008']::text[];
  v_old_cashier_user_id constant text := 'u8';
  v_new_cashier_user_id constant text := 'u_entrepreneur';
  v_new_cashier_name constant text := '李佳泰';
  v_new_cashier_email constant text := 'entrepreneur@suiyuecare.com';
  v_step_count integer;
  v_step_index integer;
  v_before_step jsonb;
  v_after_step jsonb;
  v_after_steps jsonb;
  v_reassignment jsonb;
  v_processed integer := 0;
begin
  if (
    select pg_catalog.count(*)
    from public.expense_requests
    where no = any(v_target_nos)
      and status = 'pending_cashier'
  ) <> pg_catalog.array_length(v_target_nos, 1) then
    raise exception 'The three reviewed requests are no longer all pending_cashier; refusing partial reassignment';
  end if;

  for v_request in
    select request_row.*
    from public.expense_requests request_row
    where request_row.no = any(v_target_nos)
    order by request_row.no
    for update
  loop
    select pg_catalog.count(*), pg_catalog.min(step_item.ordinality - 1)::integer
      into v_step_count, v_step_index
    from pg_catalog.jsonb_array_elements(coalesce(v_request.steps, '[]'::jsonb))
      with ordinality step_item(step_row, ordinality)
    where step_item.step_row ->> 'rk' = 'cashier'
      and coalesce(step_item.step_row ->> 'a', '') = ''
      and step_item.step_row ->> 'status' = 'pending_cashier'
      and step_item.step_row ->> 'uid' = v_old_cashier_user_id;

    if v_step_count <> 1 or v_step_index is null then
      raise exception 'Request % does not have exactly one pending cashier step assigned to u8', v_request.no;
    end if;

    v_before_step := v_request.steps -> v_step_index;
    v_reassignment := pg_catalog.jsonb_build_object(
      'fromFinanceUserId', v_old_cashier_user_id,
      'fromName', '朱夏欣',
      'toFinanceUserId', v_new_cashier_user_id,
      'toName', v_new_cashier_name,
      'toEmail', v_new_cashier_email,
      'reason', 'Formal cashier corrected by authorized user request; general-affairs fallback removed',
      'migration', '20260901072349_assign_ceo_cashier_and_reassign_pending_cashier',
      'reassignedAt', pg_catalog.now()
    );
    v_after_step := v_before_step || pg_catalog.jsonb_build_object(
      'uid', v_new_cashier_user_id,
      'runtimeResolvedAt', pg_catalog.now(),
      'runtimeResolvedBy', 'formal_cashier_reassignment_20260901',
      'runtimeOriginalUid', v_new_cashier_user_id,
      'runtimeOriginalFinanceUserId', v_new_cashier_user_id,
      'runtimeDelegatedFromFinanceUserId', '',
      'runtimeCandidateCount', 1,
      'reassignmentHistory', coalesce(v_before_step -> 'reassignmentHistory', '[]'::jsonb) || pg_catalog.jsonb_build_array(v_reassignment)
    );
    v_after_steps := pg_catalog.jsonb_set(
      v_request.steps,
      array[v_step_index::text],
      v_after_step,
      false
    );

    update public.expense_requests
       set steps = v_after_steps,
           ver = coalesce(ver, 1) + 1,
           updated_at = pg_catalog.now()
     where id = v_request.id
       and tenant_id = v_request.tenant_id
       and no = v_request.no
       and status = 'pending_cashier';

    if not found then
      raise exception 'Request % changed while cashier reassignment was running', v_request.no;
    end if;

    insert into public.audit_logs (
      action,
      resource_type,
      resource_id,
      request_id,
      before_data,
      after_data,
      metadata
    ) values (
      'cashier_reassigned',
      'expense_request_cashier_assignment',
      v_request.id,
      v_request.no,
      pg_catalog.jsonb_build_object(
        'status', v_request.status,
        'step_index', v_step_index,
        'cashier_step', v_before_step
      ),
      pg_catalog.jsonb_build_object(
        'status', v_request.status,
        'step_index', v_step_index,
        'cashier_step', v_after_step
      ),
      pg_catalog.jsonb_build_object(
        'migration', '20260901072349_assign_ceo_cashier_and_reassign_pending_cashier',
        'from_finance_user_id', v_old_cashier_user_id,
        'to_finance_user_id', v_new_cashier_user_id,
        'reason', 'Formal cashier corrected by authorized user request; general-affairs fallback removed',
        'authorized_in_codex', true
      )
    );

    v_processed := v_processed + 1;
  end loop;

  if v_processed <> pg_catalog.array_length(v_target_nos, 1) then
    raise exception 'Expected to reassign three cashier requests, processed %', v_processed;
  end if;
end;
$migration$;

do $postflight$
declare
  v_cashier_role_count integer;
  v_request_count integer;
  v_audit_count integer;
begin
  select pg_catalog.count(*)
    into v_cashier_role_count
  from public.employee_department_roles role_row
  where role_row.tenant_id = '00000000-0000-0000-0000-000000000001'::uuid
    and role_row.finance_user_id = 'u_entrepreneur'
    and role_row.role_key = 'cashier'
    and role_row.active is true
    and role_row.is_primary is false
    and role_row.can_approve is true
    and (role_row.effective_from is null or role_row.effective_from <= current_date)
    and (role_row.effective_to is null or role_row.effective_to >= current_date);

  select pg_catalog.count(*)
    into v_request_count
  from public.expense_requests request_row
  where request_row.no in ('20260827012','20260831007','20260831008')
    and request_row.status = 'pending_cashier'
    and exists (
      select 1
      from pg_catalog.jsonb_array_elements(coalesce(request_row.steps, '[]'::jsonb)) step_item(step_row)
      where step_item.step_row ->> 'rk' = 'cashier'
        and step_item.step_row ->> 'uid' = 'u_entrepreneur'
        and step_item.step_row ->> 'status' = 'pending_cashier'
        and pg_catalog.jsonb_array_length(coalesce(step_item.step_row -> 'reassignmentHistory', '[]'::jsonb)) >= 1
    );

  select pg_catalog.count(*)
    into v_audit_count
  from public.audit_logs audit_row
  where audit_row.action = 'cashier_reassigned'
    and audit_row.request_id in ('20260827012','20260831007','20260831008')
    and audit_row.metadata ->> 'migration' = '20260901072349_assign_ceo_cashier_and_reassign_pending_cashier';

  if v_cashier_role_count <> 1 then
    raise exception 'Formal cashier role postflight failed: % rows', v_cashier_role_count;
  end if;
  if v_request_count <> 3 then
    raise exception 'Cashier reassignment postflight failed: % requests', v_request_count;
  end if;
  if v_audit_count <> 3 then
    raise exception 'Cashier reassignment audit postflight failed: % rows', v_audit_count;
  end if;
end;
$postflight$;
