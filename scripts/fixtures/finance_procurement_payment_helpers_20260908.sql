-- Read-only production function snapshots from 2026-09-08. No business rows or secrets.
-- Loaded only into isolated PGlite tests to exercise actual assignment/audit/file rules.

CREATE OR REPLACE FUNCTION private.finance_income_active_step_index(p_steps jsonb)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select (step_rows.ordinality - 1)::int
  from pg_catalog.jsonb_array_elements(coalesce(p_steps, '[]'::jsonb))
    with ordinality as step_rows(step_value, ordinality)
  where coalesce(step_rows.step_value ->> 'a', '') = ''
  order by step_rows.ordinality
  limit 1
$function$;

CREATE OR REPLACE FUNCTION private.finance_income_step_role(p_step jsonb)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select pg_catalog.lower(coalesce(
    nullif(p_step ->> 'rk', ''),
    nullif(p_step ->> 'role_key', ''),
    nullif(p_step ->> 'roleKey', ''),
    nullif(p_step ->> 'role', ''),
    nullif(p_step ->> 'key', ''),
    ''
  ))
$function$;

CREATE OR REPLACE FUNCTION private.finance_income_step_user_id(p_step jsonb)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select coalesce(
    nullif(p_step ->> 'uid', ''),
    nullif(p_step ->> 'user_id', ''),
    nullif(p_step ->> 'userId', ''),
    nullif(p_step ->> 'finance_user_id', ''),
    nullif(p_step ->> 'financeUserId', ''),
    ''
  )
$function$;

CREATE OR REPLACE FUNCTION private.finance_income_status_from_steps(p_steps jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare
  v_index int;
  v_step jsonb;
begin
  v_index := private.finance_income_active_step_index(p_steps);
  if v_index is null then
    return pg_catalog.jsonb_build_object(
      'approval_status', 'completed',
      'approval_step', greatest(
        pg_catalog.jsonb_array_length(coalesce(p_steps, '[]'::jsonb)),
        1
      )
    );
  end if;

  v_step := p_steps -> v_index;
  return pg_catalog.jsonb_build_object(
    'approval_status', coalesce(
      nullif(v_step ->> 'status', ''),
      'pending_approval'
    ),
    'approval_step', v_index + 1
  );
end;
$function$;

CREATE OR REPLACE FUNCTION private.finance_expense_action_log_is_valid(p_old_step jsonb, p_new_step jsonb, p_action text, p_actor_finance_user_id text, p_actor_name text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_old_log jsonb;
  v_new_log jsonb;
  v_old_legacy_log jsonb;
  v_new_legacy_log jsonb;
  v_entry jsonb;
  v_entry_at timestamptz;
  v_note text;
  v_expected_comment text;
begin
  v_old_log := case
    when pg_catalog.jsonb_typeof(p_old_step -> 'actionLog') = 'array'
      then p_old_step -> 'actionLog'
    else '[]'::jsonb
  end;
  v_new_log := case
    when pg_catalog.jsonb_typeof(p_new_step -> 'actionLog') = 'array'
      then p_new_step -> 'actionLog'
    else '[]'::jsonb
  end;
  v_old_legacy_log := case
    when pg_catalog.jsonb_typeof(p_old_step -> 'action_log') = 'array'
      then p_old_step -> 'action_log'
    else '[]'::jsonb
  end;
  v_new_legacy_log := case
    when pg_catalog.jsonb_typeof(p_new_step -> 'action_log') = 'array'
      then p_new_step -> 'action_log'
    else '[]'::jsonb
  end;

  if p_action = 'cancelled' then
    return v_new_log = v_old_log
      and v_new_legacy_log = v_old_legacy_log
      and coalesce(p_new_step ->> 'c', '') =
          '申請人自行抽單';
  end if;

  if pg_catalog.jsonb_array_length(v_new_log) =
       pg_catalog.jsonb_array_length(v_old_log) + 1
     and (
       v_new_log - (pg_catalog.jsonb_array_length(v_new_log) - 1)
     ) = v_old_log
     and v_new_legacy_log = v_old_legacy_log then
    v_entry := v_new_log -> (
      pg_catalog.jsonb_array_length(v_new_log) - 1
    );
  elsif pg_catalog.jsonb_array_length(v_new_legacy_log) =
          pg_catalog.jsonb_array_length(v_old_legacy_log) + 1
        and (
          v_new_legacy_log - (
            pg_catalog.jsonb_array_length(v_new_legacy_log) - 1
          )
        ) = v_old_legacy_log
        and v_new_log = v_old_log then
    v_entry := v_new_legacy_log -> (
      pg_catalog.jsonb_array_length(v_new_legacy_log) - 1
    );
  else
    return false;
  end if;

  if pg_catalog.jsonb_typeof(v_entry) <> 'object'
     or (v_entry - array[
       'action',
       'by',
       'byId',
       'at',
       'comment'
     ]::text[]) <> '{}'::jsonb
     or coalesce(v_entry ->> 'action', '') <> '簽核通過'
     or coalesce(v_entry ->> 'byId', '') <>
        coalesce(p_actor_finance_user_id, '')
     or coalesce(v_entry ->> 'by', '') <>
        coalesce(p_actor_name, '') then
    return false;
  end if;

  if coalesce(v_entry ->> 'at', '') !~
       '^[0-9]{4}-[0-9]{2}-[0-9]{2}T' then
    return false;
  end if;
  v_entry_at := (v_entry ->> 'at')::timestamptz;
  if v_entry_at is null
     or v_entry_at < pg_catalog.now() - interval '15 minutes'
     or v_entry_at > pg_catalog.now() + interval '5 minutes' then
    return false;
  end if;

  v_note := (v_entry ->> 'action') || '（' ||
    p_actor_name || '，' || (p_new_step ->> 't') || '）' ||
    case
      when coalesce(v_entry ->> 'comment', '') <> ''
        then '：' || (v_entry ->> 'comment')
      else ''
    end;
  v_expected_comment := case
    when coalesce(p_old_step ->> 'c', '') = '' then v_note
    else (p_old_step ->> 'c') || pg_catalog.chr(10) || v_note
  end;

  return coalesce(p_new_step ->> 'c', '') = v_expected_comment;
end;
$function$;

CREATE OR REPLACE FUNCTION private.finance_expense_is_exact_step_transition(p_old_steps jsonb, p_new_steps jsonb, p_step_index integer, p_action text, p_actor_finance_user_id text, p_actor_name text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_length int;
  v_index int;
  v_old_step jsonb;
  v_new_step jsonb;
  v_old_files jsonb;
  v_new_files jsonb;
  v_file_index int;
  v_mutable_keys text[] := array[
    'a',
    'n',
    't',
    'c',
    'files',
    'actionLog',
    'action_log'
  ];
begin
  if pg_catalog.jsonb_typeof(p_old_steps) <> 'array'
     or pg_catalog.jsonb_typeof(p_new_steps) <> 'array'
     or pg_catalog.jsonb_array_length(p_old_steps) <>
        pg_catalog.jsonb_array_length(p_new_steps) then
    return false;
  end if;

  v_length := pg_catalog.jsonb_array_length(p_old_steps);
  if p_step_index is null
     or p_step_index < 0
     or p_step_index >= v_length
     or p_action not in ('approved', 'cancelled') then
    return false;
  end if;

  for v_index in 0..v_length - 1 loop
    if v_index <> p_step_index
       and p_old_steps -> v_index <> p_new_steps -> v_index then
      return false;
    end if;
  end loop;

  v_old_step := p_old_steps -> p_step_index;
  v_new_step := p_new_steps -> p_step_index;
  v_old_files := case
    when pg_catalog.jsonb_typeof(v_old_step -> 'files') = 'array'
      then v_old_step -> 'files'
    else '[]'::jsonb
  end;
  v_new_files := case
    when pg_catalog.jsonb_typeof(v_new_step -> 'files') = 'array'
      then v_new_step -> 'files'
    else '[]'::jsonb
  end;

  if pg_catalog.jsonb_array_length(v_new_files) <
       pg_catalog.jsonb_array_length(v_old_files)
     or (
       p_action = 'cancelled'
       and v_new_files <> v_old_files
     ) then
    return false;
  end if;
  if pg_catalog.jsonb_array_length(v_old_files) > 0 then
    for v_file_index in
      0..pg_catalog.jsonb_array_length(v_old_files) - 1
    loop
      if v_old_files -> v_file_index <>
         v_new_files -> v_file_index then
        return false;
      end if;
    end loop;
  end if;

  return coalesce(v_old_step ->> 'a', '') = ''
    and coalesce(v_new_step ->> 'a', '') = p_action
    and coalesce(v_new_step ->> 'n', '') =
        coalesce(p_actor_name, '')
    and coalesce(v_new_step ->> 't', '') in (
      pg_catalog.to_char(
        pg_catalog.timezone('Asia/Taipei', pg_catalog.now()),
        'MM/DD'
      ),
      pg_catalog.to_char(
        pg_catalog.timezone('Asia/Taipei', pg_catalog.now()),
        'YYYY/MM/DD'
      ),
      pg_catalog.to_char(current_date, 'MM/DD'),
      pg_catalog.to_char(current_date, 'YYYY/MM/DD')
    )
    and private.finance_income_step_role(v_old_step) =
        private.finance_income_step_role(v_new_step)
    and private.finance_income_step_user_id(v_old_step) =
        private.finance_income_step_user_id(v_new_step)
    and pg_catalog.lower(coalesce(v_old_step ->> 'email', '')) =
        pg_catalog.lower(coalesce(v_new_step ->> 'email', ''))
    and (v_old_step - v_mutable_keys) =
        (v_new_step - v_mutable_keys)
    and private.finance_expense_action_log_is_valid(
      v_old_step,
      v_new_step,
      p_action,
      p_actor_finance_user_id,
      p_actor_name
    );
end;
$function$;

CREATE OR REPLACE FUNCTION private.finance_expense_actor_can_act(p_tenant_id uuid, p_expense expense_requests, p_step_index integer, p_step jsonb, p_actor_finance_user_id text, p_actor_email text, p_actor_role text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_role_key text := private.finance_income_step_role(p_step);
  v_explicit_user_id text :=
    private.finance_income_step_user_id(p_step);
  v_explicit_email text := pg_catalog.lower(coalesce(
    nullif(p_step ->> 'email', ''),
    nullif(p_step ->> 'user_email', ''),
    nullif(p_step ->> 'approver_email', ''),
    ''
  ));
begin
  if p_actor_finance_user_id is null or p_step_index is null then
    return false;
  end if;

  -- Owning a request never grants access to a manager/accounting gate.
  -- Two operational completion gates may be performed by the applicant only
  -- when the frozen step explicitly names them: the final accounting post,
  -- and a cashier disbursement by a currently active formal cashier. Ordinary
  -- manager, director, CEO, or accounting approvals remain self-protected.
  if p_actor_finance_user_id = p_expense.applicant_id
     and v_role_key not in (
       'applicant_revision',
       'applicant_confirm'
     )
     and not (
       p_expense.status = 'pending_voucher'
       and v_role_key in ('accountant_final', 'accounting')
       and pg_catalog.jsonb_typeof(p_expense.steps) = 'array'
       and p_step_index =
         pg_catalog.jsonb_array_length(p_expense.steps) - 1
       and p_step = p_expense.steps -> p_step_index
       and (
         (
           v_explicit_user_id <> ''
           and v_explicit_user_id = p_actor_finance_user_id
         )
         or (
           v_explicit_user_id = ''
           and v_explicit_email <> ''
           and v_explicit_email = pg_catalog.lower(
             coalesce(p_actor_email, '')
           )
         )
       )
     )
     and not (
       p_expense.status = 'pending_cashier'
       and p_expense.cash_posted_at is null
       and v_role_key = 'cashier'
       and pg_catalog.jsonb_typeof(p_expense.steps) = 'array'
       and p_step = p_expense.steps -> p_step_index
       and v_explicit_user_id <> ''
       and v_explicit_user_id = p_actor_finance_user_id
       and exists (
         select 1
         from public.employee_department_roles cashier_role
         where cashier_role.tenant_id = p_tenant_id
           and cashier_role.finance_user_id = p_actor_finance_user_id
           and cashier_role.role_key = 'cashier'
           and cashier_role.active is true
           and cashier_role.can_approve is true
           and cashier_role.effective_from <= current_date
           and (
             cashier_role.effective_to is null
             or cashier_role.effective_to >= current_date
           )
       )
     ) then
    return false;
  end if;

  -- UID is authoritative whenever present.  A stale/malicious second email
  -- must never turn one frozen step into two valid assignees.
  if v_explicit_user_id <> '' then
    if v_explicit_email <> ''
       and not exists (
         select 1
         from public.finance_users explicit_user
         where explicit_user.tenant_id = p_tenant_id
           and explicit_user.id = v_explicit_user_id
           and pg_catalog.lower(explicit_user.email) =
               v_explicit_email
       ) then
      return false;
    end if;

    if v_explicit_user_id = p_actor_finance_user_id then
      return true;
    end if;
  elsif v_explicit_email <> ''
        and v_explicit_email =
          pg_catalog.lower(coalesce(p_actor_email, '')) then
    return true;
  end if;

  -- Historical deployments used both singular and table-name record types.
  if exists (
    select 1
    from public.approval_step_actor_snapshots snapshot_row
    where snapshot_row.tenant_id = p_tenant_id
      and snapshot_row.data_environment = p_expense.data_environment
      and snapshot_row.record_type in (
        'expense_request',
        'expense_requests'
      )
      and snapshot_row.record_id = p_expense.id
      and snapshot_row.step_index = p_step_index + 1
      and snapshot_row.resolved_user_id = p_actor_finance_user_id
      and snapshot_row.resolution_status = 'resolved'
      and snapshot_row.resolved_active is true
      and (
        v_explicit_user_id <> ''
        or v_explicit_email <> ''
      )
      and snapshot_row.raw_step = p_step
  ) then
    return true;
  end if;

  if v_explicit_user_id <> '' and exists (
    select 1
    from public.approval_delegations delegation
    where delegation.tenant_id = p_tenant_id
      and delegation.delegator_finance_user_id = v_explicit_user_id
      and delegation.delegatee_finance_user_id =
        p_actor_finance_user_id
      and delegation.active is true
      and delegation.starts_at <= pg_catalog.now()
      and (
        delegation.ends_at is null
        or delegation.ends_at > pg_catalog.now()
      )
      and (
        delegation.role_key is null
        or delegation.role_key = v_role_key
      )
      and (
        coalesce(
          delegation.scope_json ->> 'entity_id',
          delegation.scope_json ->> 'entityId',
          ''
        ) = ''
        or coalesce(
          delegation.scope_json ->> 'entity_id',
          delegation.scope_json ->> 'entityId'
        ) = p_expense.entity_id
      )
      and (
        coalesce(
          delegation.scope_json ->> 'department_code',
          delegation.scope_json ->> 'departmentCode',
          ''
        ) = ''
        or coalesce(
          delegation.scope_json ->> 'department_code',
          delegation.scope_json ->> 'departmentCode'
        ) = p_expense.department_code
      )
      and exists (
        select 1
        from public.finance_users delegator_user
        where delegator_user.tenant_id = p_tenant_id
          and delegator_user.id = v_explicit_user_id
          and delegator_user.active is true
      )
      and exists (
        select 1
        from public.employee_department_roles delegator_role
        where delegator_role.tenant_id = p_tenant_id
          and delegator_role.finance_user_id =
              v_explicit_user_id
          and delegator_role.active is true
          and delegator_role.can_approve is true
          and delegator_role.effective_from <= current_date
          and (
            delegator_role.effective_to is null
            or delegator_role.effective_to >= current_date
          )
          and (
            delegator_role.role_key = v_role_key
            or (
              v_role_key = 'direct_supervisor'
              and delegator_role.role_key in (
                'section_chief',
                'dept_manager',
                'admin_director',
                'ceo'
              )
            )
            or (
              v_role_key = 'assigned_user'
              and delegator_role.role_key <> 'employee'
            )
          )
          and (
            delegator_role.department_code =
              p_expense.department_code
            or (
              delegator_role.department_code is null
              and delegator_role.role_key in (
                'accountant',
                'accountant_final',
                'cashier',
                'ceo',
                'admin_director',
                'general_affairs',
                'procurement_payment',
                'procurement_receipt',
                'procurement_review',
                'hr'
              )
            )
          )
      )
  ) then
    return true;
  end if;

  -- Explicit/frozen assignment is authoritative.  Never broaden an
  -- unmatched explicit assignment to everyone with the same role.
  if v_explicit_user_id <> '' or v_explicit_email <> '' then
    return false;
  end if;

  if v_role_key in ('applicant_revision', 'applicant_confirm')
     and p_expense.applicant_id = p_actor_finance_user_id then
    return true;
  end if;

  -- Reporting-line roles must always be frozen to a user at submission.
  -- A request department is not a safe substitute for the applicant's
  -- effective reporting chain.
  if v_role_key in (
    'direct_supervisor',
    'section_chief',
    'dept_manager'
  ) then
    return false;
  end if;

  if exists (
    select 1
    from public.employee_department_roles employee_role
    where employee_role.tenant_id = p_tenant_id
      and employee_role.finance_user_id = p_actor_finance_user_id
      and employee_role.active is true
      and employee_role.can_approve is true
      and employee_role.effective_from <= current_date
      and (
        employee_role.effective_to is null
        or employee_role.effective_to >= current_date
      )
      and employee_role.role_key = v_role_key
      and (
        employee_role.department_code =
          p_expense.department_code
        or (
          employee_role.department_code is null
          and v_role_key in (
            'accountant',
            'accountant_final',
            'cashier',
            'ceo',
            'admin_director',
            'general_affairs',
            'procurement_payment',
            'procurement_receipt',
            'procurement_review',
            'hr'
          )
        )
      )
  ) then
    return true;
  end if;

  -- Do not fall back to finance_users.role: doing so would bypass current
  -- Membership/EDR revocation, scope, and explicit deny decisions.
  return false;
end;
$function$;

CREATE OR REPLACE FUNCTION private.finance_expense_new_files_are_owned(p_tenant_id uuid, p_expense expense_requests, p_old_files jsonb, p_new_files jsonb, p_actor_finance_user_id text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_old_files jsonb := case
    when pg_catalog.jsonb_typeof(p_old_files) = 'array'
      then p_old_files
    else '[]'::jsonb
  end;
  v_new_files jsonb := case
    when pg_catalog.jsonb_typeof(p_new_files) = 'array'
      then p_new_files
    else '[]'::jsonb
  end;
  v_old_length int;
  v_index int;
  v_file jsonb;
  v_path text;
begin
  v_old_length := pg_catalog.jsonb_array_length(v_old_files);
  if pg_catalog.jsonb_array_length(v_new_files) < v_old_length then
    return false;
  end if;

  if v_old_length > 0 then
    for v_index in 0..v_old_length - 1 loop
      if v_old_files -> v_index <> v_new_files -> v_index then
        return false;
      end if;
    end loop;
  end if;

  if pg_catalog.jsonb_array_length(v_new_files) = v_old_length then
    return true;
  end if;

  for v_index in
    v_old_length..pg_catalog.jsonb_array_length(v_new_files) - 1
  loop
    v_file := v_new_files -> v_index;
    v_path := coalesce(
      v_file ->> 'path',
      v_file ->> 'storagePath',
      v_file ->> 'storage_path',
      ''
    );

    if pg_catalog.jsonb_typeof(v_file) <> 'object'
       or coalesce(
         v_file ->> 'bucket',
         v_file ->> 'storage_bucket',
         ''
       ) <> 'finance-attachments'
       or v_path = ''
       or coalesce(
         v_file ->> 'dataEnv',
         v_file ->> 'data_environment',
         ''
       ) <> p_expense.data_environment
       or not exists (
         select 1
         from public.file_attachments attachment_row
         join storage.objects storage_object
           on storage_object.bucket_id = attachment_row.bucket_id
          and storage_object.name = attachment_row.storage_path
         where attachment_row.tenant_id = p_tenant_id
           and attachment_row.bucket_id = 'finance-attachments'
           and attachment_row.storage_path = v_path
           and attachment_row.record_type in (
             'expense_request',
             'expense_requests'
           )
           and attachment_row.record_no = p_expense.no
           and attachment_row.data_environment =
               p_expense.data_environment
           and attachment_row.uploaded_by =
               p_actor_finance_user_id
       ) then
      return false;
    end if;
  end loop;

  return true;
end;
$function$;

CREATE OR REPLACE FUNCTION private.finance_expense_optional_permission_allows(p_tenant_id uuid, p_actor_finance_user_id text, p_permission_code text, p_context jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_member_id uuid;
  v_linked boolean := false;
  v_denied boolean := false;
  v_allowed boolean := false;
begin
  if pg_catalog.to_regclass('public.membership_users') is null
     and pg_catalog.to_regprocedure(
       'public.membership_current_user_id()'
     ) is null
     and pg_catalog.to_regprocedure(
       'public.membership_can(uuid,text,jsonb)'
     ) is null
     and pg_catalog.to_regprocedure(
       'public.membership_has_explicit_deny(uuid,text,jsonb)'
     ) is null then
    return true;
  end if;

  if pg_catalog.to_regclass('public.membership_users') is null
     or pg_catalog.to_regprocedure(
       'public.membership_current_user_id()'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.membership_can(uuid,text,jsonb)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.membership_has_explicit_deny(uuid,text,jsonb)'
     ) is null then
    return false;
  end if;

  execute
    'select public.membership_current_user_id()'
    into v_member_id;
  if v_member_id is null then
    return false;
  end if;

  execute
    'select exists (
       select 1
       from public.membership_users membership_user
       where membership_user.id = $1
         and membership_user.tenant_id = $2
         and membership_user.legacy_finance_user_id = $3
         and membership_user.auth_user_id = auth.uid()
         and membership_user.status = ''active''
     )'
    into v_linked
    using v_member_id, p_tenant_id, p_actor_finance_user_id;
  if not coalesce(v_linked, false) then
    return false;
  end if;

  execute
    'select public.membership_has_explicit_deny($1, $2, $3)'
    into v_denied
    using
      v_member_id,
      p_permission_code,
      coalesce(p_context, '{}'::jsonb);
  if coalesce(v_denied, false) then
    return false;
  end if;

  execute
    'select public.membership_can($1, $2, $3)'
    into v_allowed
    using
      v_member_id,
      p_permission_code,
      coalesce(p_context, '{}'::jsonb);

  -- A complete Membership control plane is fail-closed: explicit deny and
  -- absent/revoked allow grants both block the action.  Production currently
  -- has none of these optional objects and therefore uses the legacy branch
  -- above; grants must be completed before a future Membership cut-over.
  return coalesce(v_allowed, false);
end;
$function$;
