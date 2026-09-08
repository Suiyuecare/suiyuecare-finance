-- Production function catalog snapshot; no production rows or PII.
set check_function_bodies=off;
CREATE OR REPLACE FUNCTION private.finance_accounting_human_event_is_fresh_v2(p_old_line jsonb, p_new_line jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare
  v_old_history jsonb := coalesce(p_old_line -> 'manualOverrideHistory', '[]'::jsonb);
  v_new_history jsonb := coalesce(p_new_line -> 'manualOverrideHistory', '[]'::jsonb);
  v_old_count integer;
  v_new_count integer;
  v_event jsonb;
  v_offset integer;
  v_index integer;
  v_field text;
  v_changed integer := 0;
  v_fields constant text[] := array['netAmount','taxAmount','grossAmount','debitAccount','creditAccount'];
begin
  if not private.finance_accounting_line_is_human(p_new_line)
     or pg_catalog.jsonb_typeof(v_old_history) is distinct from 'array'
     or pg_catalog.jsonb_typeof(v_new_history) is distinct from 'array' then
    return false;
  end if;
  v_old_count := pg_catalog.jsonb_array_length(v_old_history);
  v_new_count := pg_catalog.jsonb_array_length(v_new_history);
  if not (v_new_count = v_old_count + 1 or (v_new_count = 50 and v_old_count >= 50)) then
    return false;
  end if;
  v_offset := v_old_count - (v_new_count - 1);
  if v_new_count > 1 then
    for v_index in 0..v_new_count - 2 loop
      if v_new_history -> v_index is distinct from v_old_history -> (v_offset + v_index) then
        return false;
      end if;
    end loop;
  end if;
  v_event := v_new_history -> (v_new_count - 1);
  if pg_catalog.jsonb_typeof(v_event) is distinct from 'object'
     or pg_catalog.jsonb_typeof(v_event -> 'changes') is distinct from 'object'
     or pg_catalog.jsonb_typeof(v_event -> 'actor') is distinct from 'object'
     or coalesce(v_event #>> '{actor,id}', '') = ''
     or coalesce(v_event ->> 'at', '') = ''
     or coalesce(v_event ->> 'source', '') = ''
     or (v_event -> 'actor') is distinct from (p_new_line -> 'manualOverrideBy')
     or (v_event -> 'at') is distinct from (p_new_line -> 'manualOverrideAt')
     or (v_event -> 'source') is distinct from (p_new_line -> 'manualOverrideSource') then
    return false;
  end if;
  if exists (
    select 1 from pg_catalog.jsonb_array_elements(v_old_history) old_event(value)
    where old_event.value = v_event
       or (coalesce(v_event ->> 'operationId', '') <> ''
           and old_event.value ->> 'operationId' = v_event ->> 'operationId')
  ) then
    return false;
  end if;
  -- New clients send the entire five-field before/after image. It binds a
  -- change to the exact current values even if an unrelated field also moved.
  if (v_event ? 'beforeValues') or (v_event ? 'afterValues') then
    if pg_catalog.jsonb_typeof(v_event -> 'beforeValues') is distinct from 'object'
       or pg_catalog.jsonb_typeof(v_event -> 'afterValues') is distinct from 'object' then
      return false;
    end if;
    foreach v_field in array v_fields loop
      if (v_event #> array['beforeValues',v_field]) is distinct from (p_old_line -> v_field)
         or (v_event #> array['afterValues',v_field]) is distinct from (p_new_line -> v_field) then
        return false;
      end if;
    end loop;
  end if;
  foreach v_field in array v_fields loop
    if (p_old_line -> v_field) is distinct from (p_new_line -> v_field) then
      v_changed := v_changed + 1;
      if not (v_field = any(private.finance_accounting_manual_fields(p_new_line)))
         or (v_event #> array['changes',v_field,'before']) is distinct from (p_old_line -> v_field)
         or (v_event #> array['changes',v_field,'after']) is distinct from (p_new_line -> v_field) then
        return false;
      end if;
    end if;
  end loop;
  for v_field in select pg_catalog.jsonb_object_keys(v_event -> 'changes') loop
    if not (v_field = any(v_fields))
       or not (v_field = any(private.finance_accounting_manual_fields(p_new_line)))
       or (v_event #> array['changes',v_field,'before']) is distinct from (p_old_line -> v_field)
       or (v_event #> array['changes',v_field,'after']) is distinct from (p_new_line -> v_field) then
      return false;
    end if;
  end loop;
  -- Selecting the current value explicitly is still a human confirmation; a
  -- metadata-only append with an empty changes object is not one.
  return v_changed > 0 or (v_event -> 'changes') <> '{}'::jsonb;
end;
$function$;

CREATE OR REPLACE FUNCTION private.finance_accounting_line_is_human(p_line jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select coalesce(
    (
      coalesce((p_line ->> 'manualOverride')::boolean, false)
      or coalesce(p_line ->> 'valueAuthority', '') = 'human'
    )
    and pg_catalog.cardinality(
      private.finance_accounting_manual_fields(p_line)
    ) > 0,
    false
  );
$function$;

CREATE OR REPLACE FUNCTION private.finance_accounting_manual_fields(p_line jsonb)
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select coalesce(
    pg_catalog.array_agg(field_name order by field_name),
    array[]::text[]
  )
  from (
    select distinct field_item.value as field_name
    from pg_catalog.jsonb_array_elements_text(
      case
        when pg_catalog.jsonb_typeof(p_line -> 'manualFields') = 'array'
          then p_line -> 'manualFields'
        else '[]'::jsonb
      end
    ) field_item(value)
    where field_item.value in (
      'netAmount',
      'taxAmount',
      'grossAmount',
      'debitAccount',
      'creditAccount'
    )
  ) valid_fields;
$function$;

CREATE OR REPLACE FUNCTION private.finance_advance_disbursement_truth_is_valid(p_request expense_requests)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_environment text;
  v_amount numeric;
  v_fee numeric;
  v_voucher_id text;
  v_posted_at timestamptz;
begin
  v_environment := pg_catalog.lower(coalesce(
    p_request.data_environment,
    'production'
  ));
  v_amount := coalesce(p_request.estimated_amount, p_request.amount);
  v_fee := greatest(
    coalesce(p_request.bank_fee_amount, 0::numeric),
    0::numeric
  );
  v_voucher_id := nullif(
    p_request.form_payload ->> 'advanceDisbursementVoucherId',
    ''
  );
  v_posted_at := nullif(
    p_request.form_payload ->> 'advanceDisbursementPostedAt',
    ''
  )::timestamptz;

  if p_request.tenant_id is null
     or p_request.type <> 'advance_request'
     or v_environment not in ('production', 'test')
     or v_amount is null
     or v_amount <= 0
     or p_request.cash_posted_at is null
     or v_voucher_id is null
     or v_posted_at is null
     or p_request.cash_posted_at is distinct from v_posted_at
     or nullif(
       p_request.form_payload ->> 'advanceDisbursementAmount',
       ''
     ) is null
     or pg_catalog.abs(
       (
         p_request.form_payload ->> 'advanceDisbursementAmount'
       )::numeric - v_amount
     ) > 0.01
     or nullif(
       p_request.form_payload ->> 'advanceDisbursementBankFee',
       ''
     ) is null
     or pg_catalog.abs(
       (
         p_request.form_payload ->> 'advanceDisbursementBankFee'
       )::numeric - v_fee
     ) > 0.01 then
    return false;
  end if;

  return exists (
    select 1
    from public.vouchers voucher_row
    where voucher_row.tenant_id = p_request.tenant_id
      and voucher_row.data_environment = v_environment
      and voucher_row.id = v_voucher_id
      and voucher_row.no = v_voucher_id
      and voucher_row.request_id = p_request.id
      and voucher_row.entity_id = p_request.entity_id
      and voucher_row.posted is true
      and voucher_row.posted_at is not distinct from v_posted_at
      and voucher_row.voided_at is null
      and voucher_row.no like 'ADV%'
      and pg_catalog.abs(
        coalesce(voucher_row.total, 0) - (v_amount + v_fee)
      ) <= 0.01
      and pg_catalog.jsonb_typeof(
        coalesce(voucher_row.entries, '[]'::jsonb)
      ) = 'array'
      and pg_catalog.jsonb_array_length(
        coalesce(voucher_row.entries, '[]'::jsonb)
      ) = (case when v_fee > 0 then 3 else 2 end)
      and (
        select pg_catalog.count(*)
        from pg_catalog.jsonb_array_elements(
          coalesce(voucher_row.entries, '[]'::jsonb)
        ) voucher_entry
        where voucher_entry ->> 't' = 'dr'
          and voucher_entry ->> 'ac' = '1191'
          and pg_catalog.abs(
            coalesce(
              nullif(voucher_entry ->> 'amt', '')::numeric,
              0
            ) - v_amount
          ) <= 0.01
      ) = 1
      and (
        select pg_catalog.count(*)
        from pg_catalog.jsonb_array_elements(
          coalesce(voucher_row.entries, '[]'::jsonb)
        ) voucher_entry
        where voucher_entry ->> 't' = 'cr'
          and voucher_entry ->> 'ac' = '1112'
          and pg_catalog.abs(
            coalesce(
              nullif(voucher_entry ->> 'amt', '')::numeric,
              0
            ) - (v_amount + v_fee)
          ) <= 0.01
      ) = 1
      and (
        select pg_catalog.count(*)
        from pg_catalog.jsonb_array_elements(
          coalesce(voucher_row.entries, '[]'::jsonb)
        ) voucher_entry
        where voucher_entry ->> 't' = 'dr'
          and voucher_entry ->> 'ac' = '6290'
          and pg_catalog.abs(
            coalesce(
              nullif(voucher_entry ->> 'amt', '')::numeric,
              0
            ) - v_fee
          ) <= 0.01
      ) = (case when v_fee > 0 then 1 else 0 end)
  ) and (
    select pg_catalog.count(*)
    from public.vouchers voucher_row
    where voucher_row.tenant_id = p_request.tenant_id
      and voucher_row.data_environment = v_environment
      and voucher_row.request_id = p_request.id
      and voucher_row.posted is true
      and voucher_row.voided_at is null
      and voucher_row.no like 'ADV%'
  ) = 1
  and exists (
    select 1
    from public.ledger_entries ledger_row
    where ledger_row.tenant_id = p_request.tenant_id
      and ledger_row.data_environment = v_environment
      and ledger_row.voucher_no = v_voucher_id
      and ledger_row.source_type = 'advance_disbursement'
      and ledger_row.source_id = p_request.id
      and ledger_row.reference_no = p_request.no
      and ledger_row.entity_id = p_request.entity_id
      and ledger_row.department_code is not distinct from
        p_request.department_code
      and ledger_row.posting_key like
        'tenant:' || p_request.tenant_id::text ||
          ':advance_disbursement:' || p_request.no || ':%'
      and ledger_row.voided_at is null
    group by ledger_row.voucher_no
    having pg_catalog.count(*) =
        (case when v_fee > 0 then 3 else 2 end)
      and pg_catalog.abs(
        coalesce(pg_catalog.sum(ledger_row.debit), 0) -
        coalesce(pg_catalog.sum(ledger_row.credit), 0)
      ) <= 0.01
      and pg_catalog.count(*) filter (
        where ledger_row.account_code = '1191'
          and pg_catalog.abs(ledger_row.debit - v_amount) <= 0.01
          and coalesce(ledger_row.credit, 0) = 0
      ) = 1
      and pg_catalog.count(*) filter (
        where ledger_row.account_code = '1112'
          and pg_catalog.abs(
            ledger_row.credit - (v_amount + v_fee)
          ) <= 0.01
          and coalesce(ledger_row.debit, 0) = 0
      ) = 1
      and pg_catalog.count(*) filter (
        where ledger_row.account_code = '6290'
          and pg_catalog.abs(ledger_row.debit - v_fee) <= 0.01
          and coalesce(ledger_row.credit, 0) = 0
      ) = (case when v_fee > 0 then 1 else 0 end)
  ) and (
    select pg_catalog.count(*)
    from public.ledger_entries ledger_row
    where ledger_row.tenant_id = p_request.tenant_id
      and ledger_row.data_environment = v_environment
      and ledger_row.voided_at is null
      and (
        (
          ledger_row.source_type = 'advance_disbursement'
          and (
            ledger_row.source_id = p_request.id
            or ledger_row.reference_no = p_request.no
          )
        )
        or ledger_row.voucher_no = v_voucher_id
      )
  ) = (case when v_fee > 0 then 3 else 2 end);
end;
$function$;

CREATE OR REPLACE FUNCTION private.finance_assert_period_open(p_tenant_id uuid, p_data_environment text, p_entity_id text, p_posting_date date, p_action text)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if p_tenant_id is null
     or nullif(p_data_environment, '') is null
     or nullif(p_entity_id, '') is null
     or p_posting_date is null then
    raise exception '帳務期間檢查缺少租戶、環境、法人或日期'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.period_closes close_row
    where close_row.tenant_id = p_tenant_id
      and close_row.data_environment = p_data_environment
      and close_row.entity_id = p_entity_id
      and close_row.period =
        pg_catalog.to_char(p_posting_date, 'YYYY-MM')
      and close_row.status = 'closed'
  ) then
    raise exception '法人 % 的 % 會計期間已關閉，禁止執行 %',
      p_entity_id,
      pg_catalog.to_char(p_posting_date, 'YYYY-MM'),
      coalesce(nullif(p_action, ''), '帳務入帳')
      using errcode = '23514';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION private.finance_assert_source_posting_actor(p_tenant_id uuid, p_entity_id text, p_department_code text, p_resource_type text, p_resource_id text, p_source_owner_finance_user_id text, p_allow_legacy_non_accounting boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_has_membership_users boolean :=
    pg_catalog.to_regclass('public.membership_users') is not null;
  v_has_membership_can boolean :=
    pg_catalog.to_regprocedure(
      'public.membership_can(uuid,text,jsonb)'
    ) is not null;
  v_has_membership_deny boolean :=
    pg_catalog.to_regprocedure(
      'public.membership_has_explicit_deny(uuid,text,jsonb)'
    ) is not null;
  v_finance_user public.finance_users%rowtype;
  v_membership_user_id uuid;
  v_context jsonb;
  v_denied boolean;
  v_allowed boolean;
begin
  if p_tenant_id is null
     or nullif(p_entity_id, '') is null
     or nullif(p_resource_type, '') is null
     or nullif(p_resource_id, '') is null then
    raise exception '帳務來源權限檢查缺少必要範圍'
      using errcode = '42501';
  end if;

  if not v_has_membership_users
     and not v_has_membership_can
     and not v_has_membership_deny then
    if not p_allow_legacy_non_accounting then
      perform public.assert_accounting_actor();
    end if;
    return;
  end if;

  if not (
    v_has_membership_users
    and v_has_membership_can
    and v_has_membership_deny
  ) then
    raise exception 'Membership 權限控制面只安裝了一部分，已停止帳務入帳'
      using errcode = '55000';
  end if;

  v_finance_user := public.current_finance_user();
  if v_finance_user.id is null
     or v_finance_user.tenant_id is distinct from p_tenant_id
     or v_finance_user.auth_user_id is distinct from auth.uid()
     or v_finance_user.active is not true then
    raise exception '目前 Google 身分沒有來源租戶的有效財務帳號'
      using errcode = '42501';
  end if;

  execute
    'select member_row.id
       from public.membership_users member_row
      where member_row.tenant_id = $1
        and member_row.legacy_finance_user_id = $2
        and member_row.auth_user_id = $3
        and member_row.status = ''active''
      limit 1'
    into v_membership_user_id
    using p_tenant_id, v_finance_user.id, auth.uid();

  if v_membership_user_id is null then
    raise exception '目前帳號未連結來源租戶的有效 Membership 成員'
      using errcode = '42501';
  end if;

  v_context := pg_catalog.jsonb_build_object(
    'company_id', p_entity_id,
    'entity_id', p_entity_id,
    'department_code', p_department_code,
    'resource_type', p_resource_type,
    'resource_id', p_resource_id,
    'actor_finance_user_id', v_finance_user.id,
    'assignee_finance_user_id', v_finance_user.id,
    'membership_user_id', v_membership_user_id
  ) || case
    when nullif(p_source_owner_finance_user_id, '') is not null
      then pg_catalog.jsonb_build_object(
        'owner_finance_user_id',
        p_source_owner_finance_user_id
      )
    else '{}'::jsonb
  end;

  execute
    'select
       public.membership_has_explicit_deny($1, $2, $3),
       public.membership_can($1, $2, $3)'
    into v_denied, v_allowed
    using
      v_membership_user_id,
      'finance.accounting.post',
      v_context;

  if coalesce(v_denied, false)
     or not coalesce(v_allowed, false) then
    raise exception '目前帳號沒有此法人與部門的帳務入帳權限'
      using errcode = '42501';
  end if;
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

CREATE OR REPLACE FUNCTION private.finance_merge_human_accounting_line(p_old_line jsonb, p_new_line jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare
  v_result jsonb := coalesce(p_new_line, '{}'::jsonb);
  v_old_fields text[] := private.finance_accounting_manual_fields(p_old_line);
  v_new_fields text[] := private.finance_accounting_manual_fields(p_new_line);
  v_union_fields text[];
  v_field text;
  v_old_history_length integer := pg_catalog.jsonb_array_length(
    case
      when pg_catalog.jsonb_typeof(p_old_line -> 'manualOverrideHistory') = 'array'
        then p_old_line -> 'manualOverrideHistory'
      else '[]'::jsonb
    end
  );
  v_new_history_length integer := pg_catalog.jsonb_array_length(
    case
      when pg_catalog.jsonb_typeof(p_new_line -> 'manualOverrideHistory') = 'array'
        then p_new_line -> 'manualOverrideHistory'
      else '[]'::jsonb
    end
  );
  v_new_has_fresh_human_audit boolean;
begin
  if not private.finance_accounting_line_is_human(p_old_line) then
    return v_result;
  end if;

  v_new_has_fresh_human_audit :=
    private.finance_accounting_human_event_is_fresh_v2(p_old_line, p_new_line);
  if not v_new_has_fresh_human_audit
     and private.finance_accounting_line_is_human(p_new_line)
     and exists (
       select 1 from pg_catalog.unnest(v_new_fields) changed_field(name)
       where (p_old_line -> changed_field.name) is distinct from (p_new_line -> changed_field.name)
     ) then
    raise exception '人工覆核版本已更新或修訂紀錄不完整；請保留目前輸入，重新載入最新版本後再套用修改'
      using errcode = '40001', detail = 'HUMAN_ACCOUNTING_REVISION_CONFLICT';
  end if;

  foreach v_field in array v_old_fields loop
    if not (
      v_field = any(v_new_fields)
      and (
        v_result -> v_field is not distinct from p_old_line -> v_field
        or v_new_has_fresh_human_audit
      )
    ) then
      v_result := pg_catalog.jsonb_set(
        v_result,
        array[v_field],
        coalesce(p_old_line -> v_field, 'null'::jsonb),
        true
      );
    end if;
  end loop;

  select pg_catalog.array_agg(field_name order by field_name)
    into v_union_fields
  from (
    select distinct field_name
    from pg_catalog.unnest(v_old_fields || v_new_fields) field_row(field_name)
    where field_name in (
      'netAmount',
      'taxAmount',
      'grossAmount',
      'debitAccount',
      'creditAccount'
    )
  ) union_rows;

  v_result := v_result || pg_catalog.jsonb_build_object(
    'manualOverride', true,
    'valueAuthority', 'human',
    'manualFields', pg_catalog.to_jsonb(coalesce(v_union_fields, v_old_fields)),
    'manualOverrideBy', case
      when v_new_has_fresh_human_audit then coalesce(p_new_line -> 'manualOverrideBy', '{}'::jsonb)
      else coalesce(p_old_line -> 'manualOverrideBy', '{}'::jsonb)
    end,
    'manualOverrideAt', case
      when v_new_has_fresh_human_audit then coalesce(p_new_line ->> 'manualOverrideAt', '')
      else coalesce(p_old_line ->> 'manualOverrideAt', '')
    end,
    'manualOverrideSource', case
      when v_new_has_fresh_human_audit then coalesce(p_new_line ->> 'manualOverrideSource', '')
      else coalesce(p_old_line ->> 'manualOverrideSource', '')
    end,
    'manualOverrideHistory', case
      when v_new_has_fresh_human_audit then
        coalesce(p_old_line -> 'manualOverrideHistory', '[]'::jsonb)
        || pg_catalog.jsonb_build_array(p_new_line -> 'manualOverrideHistory' -> -1)
      else coalesce(p_old_line -> 'manualOverrideHistory', '[]'::jsonb)
    end,
    'reviewedBy', case
      when v_new_has_fresh_human_audit then coalesce(p_new_line ->> 'reviewedBy', '')
      else coalesce(p_old_line ->> 'reviewedBy', '')
    end,
    'reviewedAt', case
      when v_new_has_fresh_human_audit then p_new_line -> 'reviewedAt'
      else p_old_line -> 'reviewedAt'
    end
  );

  return v_result;
end;
$function$;

CREATE OR REPLACE FUNCTION private.finance_merge_human_accounting_lines(p_old_lines jsonb, p_new_lines jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare
  v_result jsonb := '[]'::jsonb;
  v_new_line jsonb;
  v_old_line jsonb;
  v_ordinality bigint;
begin
  if pg_catalog.jsonb_typeof(p_old_lines) <> 'array' then
    return coalesce(p_new_lines, '[]'::jsonb);
  end if;
  if pg_catalog.jsonb_typeof(p_new_lines) <> 'array' then
    return p_old_lines;
  end if;

  for v_new_line, v_ordinality in
    select line_item.value, line_item.ordinality
    from pg_catalog.jsonb_array_elements(p_new_lines)
      with ordinality line_item(value, ordinality)
    order by line_item.ordinality
  loop
    select old_item.value
      into v_old_line
    from pg_catalog.jsonb_array_elements(p_old_lines)
      with ordinality old_item(value, ordinality)
    where (
      coalesce(v_new_line ->> 'id', '') <> ''
      and old_item.value ->> 'id' = v_new_line ->> 'id'
    ) or (
      coalesce(v_new_line ->> 'id', '') = ''
      and old_item.ordinality = v_ordinality
    )
    order by case
      when old_item.value ->> 'id' = v_new_line ->> 'id' then 0
      else 1
    end
    limit 1;

    v_result := v_result || pg_catalog.jsonb_build_array(
      case
        when v_old_line is null then v_new_line
        else private.finance_merge_human_accounting_line(v_old_line, v_new_line)
      end
    );
    v_old_line := null;
  end loop;

  -- A missing manually reviewed line must not disappear without a new audited
  -- human revision. Keep it at the end so the discrepancy remains visible.
  for v_old_line in
    select old_item.value
    from pg_catalog.jsonb_array_elements(p_old_lines)
      with ordinality old_item(value, ordinality)
    where private.finance_accounting_line_is_human(old_item.value)
      and not exists (
        select 1
        from pg_catalog.jsonb_array_elements(p_new_lines)
          with ordinality new_item(value, ordinality)
        where (
          coalesce(old_item.value ->> 'id', '') <> ''
          and new_item.value ->> 'id' = old_item.value ->> 'id'
        ) or (
          coalesce(old_item.value ->> 'id', '') = ''
          and new_item.ordinality = old_item.ordinality
        )
      )
    order by old_item.ordinality
  loop
    v_result := v_result || pg_catalog.jsonb_build_array(v_old_line);
  end loop;

  return v_result;
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

CREATE OR REPLACE FUNCTION private.finance_require_authenticated_tenant()
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tenant_id uuid;
  v_finance_user public.finance_users%rowtype;
begin
  if auth.uid() is null then
    raise exception '請先登入後再執行帳務作業'
      using errcode = '42501';
  end if;

  v_tenant_id := public.current_tenant_id();
  v_finance_user := public.current_finance_user();

  if v_tenant_id is null
     or v_finance_user.id is null
     or v_finance_user.tenant_id is distinct from v_tenant_id
     or v_finance_user.auth_user_id is distinct from auth.uid()
     or v_finance_user.active is not true then
    raise exception '目前 Google 登入身分沒有此租戶的有效財務帳號'
      using errcode = '42501';
  end if;

  return v_tenant_id;
end;
$function$;

CREATE OR REPLACE FUNCTION private.finance_sync_request_accounting_lines()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_lines jsonb := new.form_payload -> 'accountingLines';
  v_line jsonb;
  v_line_index integer;
  v_line_count integer := 0;
  v_old_lines jsonb := case
    when tg_op = 'UPDATE' then old.form_payload -> 'accountingLines'
    else null
  end;
begin
  if pg_catalog.jsonb_typeof(v_lines) = 'array' then
    v_line_count := pg_catalog.jsonb_array_length(v_lines);
    for v_line, v_line_index in
      select line_item.value, line_item.ordinality::integer
      from pg_catalog.jsonb_array_elements(v_lines)
        with ordinality line_item(value, ordinality)
      order by line_item.ordinality
    loop
      insert into public.application_accounting_lines (
        id,
        request_id,
        request_no,
        line_index,
        source,
        description,
        entity_id,
        department_code,
        gross_amount,
        net_amount,
        tax_amount,
        debit_account,
        debit_account_name,
        credit_account,
        credit_account_name,
        ai_reason,
        reviewed_by,
        reviewed_at,
        payload,
        data_environment
      ) values (
        new.id || '_' || v_line_index::text,
        new.id,
        new.no,
        v_line_index,
        coalesce(v_line ->> 'source', 'detail'),
        coalesce(v_line ->> 'description', ''),
        new.entity_id,
        coalesce(v_line ->> 'departmentCode', new.department_code),
        coalesce((v_line ->> 'grossAmount')::numeric, 0),
        coalesce((v_line ->> 'netAmount')::numeric, 0),
        coalesce((v_line ->> 'taxAmount')::numeric, 0),
        coalesce(v_line ->> 'debitAccount', ''),
        coalesce(v_line ->> 'debitAccountName', ''),
        coalesce(v_line ->> 'creditAccount', ''),
        coalesce(v_line ->> 'creditAccountName', ''),
        coalesce(v_line ->> 'aiReason', ''),
        coalesce(v_line ->> 'reviewedBy', ''),
        nullif(v_line ->> 'reviewedAt', '')::timestamptz,
        v_line,
        coalesce(new.data_environment, 'production')
      )
      on conflict (request_id, line_index) do update set
        request_no = excluded.request_no,
        source = excluded.source,
        description = excluded.description,
        entity_id = excluded.entity_id,
        department_code = excluded.department_code,
        gross_amount = excluded.gross_amount,
        net_amount = excluded.net_amount,
        tax_amount = excluded.tax_amount,
        debit_account = excluded.debit_account,
        debit_account_name = excluded.debit_account_name,
        credit_account = excluded.credit_account,
        credit_account_name = excluded.credit_account_name,
        ai_reason = excluded.ai_reason,
        reviewed_by = excluded.reviewed_by,
        reviewed_at = excluded.reviewed_at,
        payload = excluded.payload,
        data_environment = excluded.data_environment,
        updated_at = pg_catalog.now();
    end loop;
  end if;

  delete from public.application_accounting_lines accounting_line
  where accounting_line.request_id = new.id
    and accounting_line.line_index > v_line_count;

  if v_lines is distinct from v_old_lines
     and pg_catalog.jsonb_typeof(v_lines) = 'array'
     and exists (
       select 1
       from pg_catalog.jsonb_array_elements(v_lines) line_item(value)
       where private.finance_accounting_line_is_human(line_item.value)
     ) then
    insert into public.module_audit_logs (
      table_name,
      row_id,
      action,
      actor_email,
      before_data,
      after_data
    ) values (
      'application_accounting_lines',
      new.id,
      'HUMAN_ACCOUNTING_SYNC',
      auth.jwt() ->> 'email',
      v_old_lines,
      v_lines
    );
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION private.finance_tenant_account_name(p_tenant_id uuid, p_account_code text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select nullif(account_item ->> 'n', '')
  from public.system_settings setting_row
  cross join lateral pg_catalog.jsonb_array_elements(
    case
      when pg_catalog.jsonb_typeof(setting_row.value) = 'array'
        then setting_row.value
      else '[]'::jsonb
    end
  ) account_item
  where setting_row.tenant_id = p_tenant_id
    and setting_row.key = 'accounts'
    and account_item ->> 'c' = p_account_code
    and pg_catalog.lower(coalesce(
      nullif(account_item ->> 'on', ''),
      nullif(account_item ->> 'active', ''),
      'true'
    )) not in ('false', '0', 'no', 'off')
  limit 1
$function$;

CREATE OR REPLACE FUNCTION private.finance_tenant_entity_name(p_tenant_id uuid, p_entity_id text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(
    nullif(entity_item ->> 'full', ''),
    nullif(entity_item ->> 's', ''),
    nullif(entity_item ->> 'name', ''),
    p_entity_id
  )
  from public.system_settings setting_row
  cross join lateral pg_catalog.jsonb_array_elements(
    case
      when pg_catalog.jsonb_typeof(setting_row.value) = 'array'
        then setting_row.value
      else '[]'::jsonb
    end
  ) entity_item
  where setting_row.tenant_id = p_tenant_id
    and setting_row.key = 'entities'
    and coalesce(
      nullif(entity_item ->> 'id', ''),
      nullif(entity_item ->> 'eid', ''),
      nullif(entity_item ->> 'code', ''),
      nullif(entity_item ->> 'c', '')
    ) = p_entity_id
  limit 1
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
