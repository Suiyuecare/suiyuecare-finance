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

CREATE OR REPLACE FUNCTION private.finance_preserve_human_accounting_authority()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_old_lines jsonb := coalesce(old.form_payload -> 'accountingLines', '[]'::jsonb);
  v_new_lines jsonb := new.form_payload -> 'accountingLines';
  v_merged_lines jsonb;
  v_write_context text := coalesce(
    pg_catalog.current_setting('app.finance_expense_write_context', true),
    ''
  );
begin
  if tg_op <> 'UPDATE'
     or pg_catalog.jsonb_typeof(v_old_lines) <> 'array'
     or not exists (
       select 1
       from pg_catalog.jsonb_array_elements(v_old_lines) line_item(value)
       where private.finance_accounting_line_is_human(line_item.value)
     ) then
    return new;
  end if;

  if pg_catalog.jsonb_typeof(v_new_lines) = 'array' then
    v_merged_lines := private.finance_merge_human_accounting_lines(
      v_old_lines,
      v_new_lines
    );
  elsif v_write_context = 'active_step' then
    v_merged_lines := v_old_lines;
  else
    -- A legitimate new-evidence stage (for example procurement actual
    -- receipts) may intentionally rebuild accounting lines. The old values
    -- remain available in the request version/audit trail.
    return new;
  end if;

  if v_merged_lines is distinct from v_new_lines then
    new.form_payload := pg_catalog.jsonb_set(
      coalesce(new.form_payload, '{}'::jsonb),
      '{accountingLines}',
      v_merged_lines,
      true
    ) || pg_catalog.jsonb_build_object(
      'accountingLinePolicy', 'human_override_authoritative_v1',
      'accountingLinesPreservedForReview', true,
      'accountingLinesPreservedAt', pg_catalog.now()
    );
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(v_merged_lines) line_item(value)
    where private.finance_accounting_line_is_human(line_item.value)
      and (
        coalesce((line_item.value ->> 'netAmount')::numeric, 0) < 0
        or coalesce((line_item.value ->> 'taxAmount')::numeric, 0) < 0
        or coalesce((line_item.value ->> 'grossAmount')::numeric, 0) < 0
        or coalesce((line_item.value ->> 'netAmount')::numeric, 0)
           + coalesce((line_item.value ->> 'taxAmount')::numeric, 0)
           <> coalesce((line_item.value ->> 'grossAmount')::numeric, 0)
        or coalesce(line_item.value ->> 'debitAccount', '') = ''
        or coalesce(line_item.value ->> 'creditAccount', '') = ''
      )
  ) then
    raise exception '人工覆核的會計明細金額或借貸科目不完整，已停止保存'
      using errcode = '23514';
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION private.upsert_cash_evidence_for_expense(p_request_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  er public.expense_requests%rowtype;
  m record;
  v_amount numeric;
  v_stage text;
  v_evidence_status text;
  v_expected_date date;
  v_posted boolean;
begin
  select * into er from public.expense_requests where id = p_request_id;
  if not found then
    return;
  end if;

  select * into m
  from private.finance_bank_match_for_target('expense_requests', er.id, er.no);

  v_amount := greatest(coalesce(er.actual_amount, er.estimated_amount, er.amount, 0), 0)
    + greatest(coalesce(er.bank_fee_amount, 0), 0);
  v_expected_date := coalesce(er.expected_pay_date, er.cash_posted_at::date, er.request_date, er.created_at::date, current_date);
  v_posted := coalesce(er.ledger_posted_at, er.posting_locked_at) is not null;

  if private.cash_document_is_void(er.status, null, er.voided_at) then
    v_stage := 'void';
    v_evidence_status := 'not_required';
  elsif m.bank_match_id is not null and v_posted then
    v_stage := 'posted';
    v_evidence_status := 'ok';
  elsif m.bank_match_id is not null then
    v_stage := 'pending_posting';
    v_evidence_status := 'posting_missing';
  elsif er.cash_posted_at is not null or v_posted or lower(coalesce(er.status, '')) in ('paid', 'completed', 'done', '已付款') then
    v_stage := case when v_posted then 'posted_without_bank_match' else 'pending_bank_match' end;
    v_evidence_status := case when v_posted then 'posted_without_bank_match' else 'missing_bank_evidence' end;
  else
    v_stage := 'pending_transfer';
    v_evidence_status := 'missing_bank_evidence';
  end if;

  insert into public.cash_movement_evidence_links (
    tenant_id,
    data_environment,
    direction,
    source_table,
    source_id,
    source_no,
    entity_id,
    department_code,
    amount,
    source_status,
    cash_stage,
    expected_bank_date,
    bank_transaction_id,
    bank_match_id,
    voucher_no,
    evidence_status,
    evidence,
    updated_at
  )
  values (
    coalesce(er.tenant_id, public.default_tenant_id()),
    coalesce(nullif(er.data_environment, ''), 'production'),
    'outflow',
    'expense_requests',
    er.id,
    er.no,
    er.entity_id,
    er.department_code,
    v_amount,
    er.status,
    v_stage,
    v_expected_date,
    m.bank_transaction_id,
    m.bank_match_id,
    er.voucher_id,
    v_evidence_status,
    jsonb_strip_nulls(jsonb_build_object(
      'repair_batch', 'bank_cash_evidence_safe_repair_20260617',
      'document_type', 'expense_request',
      'type', er.type,
      'type_label', er.type_label,
      'payee', er.payee,
      'bank_name', er.bank_name,
      'bank_branch', er.bank_branch,
      'bank_no', er.bank_no,
      'bank_fee_amount', er.bank_fee_amount,
      'cash_posted_at', er.cash_posted_at,
      'ledger_posted_at', er.ledger_posted_at,
      'posting_locked_at', er.posting_locked_at,
      'bank_match_method', m.match_method,
      'matched_amount', m.matched_amount,
      'matched_at', m.matched_at
    )),
    now()
  )
  on conflict (tenant_id, data_environment, source_table, source_id, direction) do update set
    source_no = excluded.source_no,
    entity_id = excluded.entity_id,
    department_code = excluded.department_code,
    amount = excluded.amount,
    source_status = excluded.source_status,
    cash_stage = excluded.cash_stage,
    expected_bank_date = excluded.expected_bank_date,
    bank_transaction_id = excluded.bank_transaction_id,
    bank_match_id = excluded.bank_match_id,
    voucher_no = excluded.voucher_no,
    evidence_status = excluded.evidence_status,
    evidence = excluded.evidence,
    updated_at = now();
end;
$function$;
