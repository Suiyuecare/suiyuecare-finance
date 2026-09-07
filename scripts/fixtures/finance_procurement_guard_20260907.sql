CREATE OR REPLACE FUNCTION private.finance_expense_guard_direct_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tenant_id uuid;
  v_actor public.finance_users%rowtype;
  v_active_index int;
  v_active_step jsonb;
  v_role_key text;
  v_derived_status jsonb;
  v_permission_context jsonb;
  v_allowed_columns text[];
  v_allowed_payload_keys text[];
  v_reserved_payload_key text;
  v_write_context text := coalesce(
    pg_catalog.current_setting(
      'app.finance_expense_write_context',
      true
    ),
    ''
  );
begin
  if session_user in (
    'postgres',
    'supabase_admin'
  )
     or coalesce(auth.jwt() ->> 'role', '') = 'service_role' then
    return new;
  end if;

  -- A transaction-local marker is set only inside guarded database RPCs.
  -- PostgREST does not expose pg_catalog.set_config as a public endpoint.
  if v_write_context in (
    'active_step',
    'finalize',
    'advance_disbursement',
    'shareholder_posting',
    'org_resubmit',
    'offboarding_transfer'
  ) then
    return new;
  end if;

  if old.tenant_id is distinct from new.tenant_id
     or old.id is distinct from new.id
     or old.data_environment is distinct from new.data_environment
     or old.applicant_id is distinct from new.applicant_id
     or old.entity_id is distinct from new.entity_id
     or old.department_code is distinct from new.department_code
     or old.type is distinct from new.type then
    raise exception '申請單識別、租戶或歸屬資料不可直接變更'
      using errcode = '42501';
  end if;

  -- Default deny: only a timestamp-only update bypasses workflow validation.
  -- Future columns are protected automatically instead of silently falling
  -- through an outdated protected-column list.
  if (
    pg_catalog.to_jsonb(new) - array['updated_at']::text[]
  ) = (
    pg_catalog.to_jsonb(old) - array['updated_at']::text[]
  ) then
    return new;
  end if;

  if auth.uid() is null then
    raise exception '申請單關卡與會計欄位只能透過受控功能修改'
      using errcode = '42501';
  end if;

  v_tenant_id := public.current_tenant_id();
  if old.tenant_id <> v_tenant_id then
    raise exception '不可修改其他租戶的申請單'
      using errcode = '42501';
  end if;

  select finance_user.*
    into v_actor
  from public.finance_users finance_user
  where finance_user.tenant_id = v_tenant_id
    and finance_user.auth_user_id = auth.uid()
    and finance_user.active is true
  order by finance_user.created_at, finance_user.id
  limit 1;

  if not found then
    raise exception '目前登入帳號沒有有效財務人員身分'
      using errcode = '42501';
  end if;

  v_active_index :=
    private.finance_income_active_step_index(old.steps);
  if v_active_index is null then
    raise exception '已完成的申請單不可直接變更'
      using errcode = '55000';
  end if;

  v_active_step := old.steps -> v_active_index;
  v_role_key := private.finance_income_step_role(v_active_step);

  -- The legacy applicant-revision fallback is intentionally narrow: it can
  -- approve only its own frozen applicant_revision step and update submitted
  -- form/evidence payload.  It cannot change accounting/cash/identity fields.
  if v_role_key = 'applicant_revision'
     and v_actor.id = old.applicant_id
     and private.finance_expense_is_exact_step_transition(
       old.steps,
       new.steps,
       v_active_index,
       'approved',
       v_actor.id,
       v_actor.name
     )
     and private.finance_expense_new_files_are_owned(
       v_tenant_id,
       old,
       v_active_step -> 'files',
       new.steps -> v_active_index -> 'files',
       v_actor.id
     )
     and private.finance_expense_new_files_are_owned(
       v_tenant_id,
       old,
       old.actual_files,
       new.actual_files,
       v_actor.id
     ) then
    v_derived_status :=
      private.finance_income_status_from_steps(new.steps);
    if new.status <> v_derived_status ->> 'approval_status'
       or new.step <> (v_derived_status ->> 'approval_step')::int then
      raise exception '補件重送的下一關狀態不一致'
        using errcode = '23514';
    end if;
    if v_derived_status ->> 'approval_status' = 'completed' then
      raise exception
        '補件重送不得直接完成申請；請改走交易式最終簽核或入帳功能'
        using errcode = '55000';
    end if;

    v_allowed_columns := array[
      'status',
      'step',
      'steps',
      'form_payload',
      'actual_files',
      'ver',
      'updated_at'
    ];
    if (pg_catalog.to_jsonb(new) - v_allowed_columns) <>
       (pg_catalog.to_jsonb(old) - v_allowed_columns) then
      raise exception '補件重送不得改寫會計、金流或歸屬欄位'
        using errcode = '42501';
    end if;

    for v_reserved_payload_key in
      select payload_key
      from (
        select pg_catalog.jsonb_object_keys(
          coalesce(old.form_payload, '{}'::jsonb)
        ) as payload_key
        union
        select pg_catalog.jsonb_object_keys(
          coalesce(new.form_payload, '{}'::jsonb)
        )
      ) reserved_candidate
      where reserved_candidate.payload_key ~* (
        '^(advanceDisbursement|advanceOriginalAmount|' ||
        'advanceAccounting|shareholderPosted|' ||
        'shareholderVoucher|ledger|posting|cashPosted|' ||
        'voucher(Id|No)|accounting(Line|Approved|Posted|Locked)|' ||
        'flowStopped|cancelled)'
      )
    loop
      if (
           coalesce(old.form_payload, '{}'::jsonb) ?
             v_reserved_payload_key
         ) is distinct from (
           coalesce(new.form_payload, '{}'::jsonb) ?
             v_reserved_payload_key
         )
         or (
           coalesce(old.form_payload, '{}'::jsonb) ->
             v_reserved_payload_key
         ) is distinct from (
           coalesce(new.form_payload, '{}'::jsonb) ->
             v_reserved_payload_key
         ) then
        raise exception
          '補件重送不得新增、刪除或修改系統入帳與稽核欄位：%',
          v_reserved_payload_key
          using errcode = '42501';
      end if;
    end loop;

    new.ver := coalesce(old.ver, 1) + 1;
    new.updated_at := pg_catalog.now();
    return new;
  end if;

  -- Procurement payment/receipt are field-submit gates rather than general
  -- approvals.  Preserve them only as exact single-step transitions with
  -- explicit assignee + current Membership permission.
  if v_role_key in (
       'procurement_payment',
       'procurement_receipt',
       'procurement_review'
     )
     and private.finance_expense_actor_can_act(
       v_tenant_id,
       old,
       v_active_index,
       v_active_step,
       v_actor.id,
       v_actor.email,
       v_actor.role
     )
     and private.finance_expense_is_exact_step_transition(
       old.steps,
       new.steps,
       v_active_index,
       'approved',
       v_actor.id,
       v_actor.name
     )
     and private.finance_expense_new_files_are_owned(
       v_tenant_id,
       old,
       v_active_step -> 'files',
       new.steps -> v_active_index -> 'files',
       v_actor.id
     )
     and private.finance_expense_new_files_are_owned(
       v_tenant_id,
       old,
       old.actual_files,
       new.actual_files,
       v_actor.id
     )
     and private.finance_expense_new_files_are_owned(
       v_tenant_id,
       old,
       old.files,
       new.files,
       v_actor.id
     ) then
    v_derived_status :=
      private.finance_income_status_from_steps(new.steps);
    if new.status <> v_derived_status ->> 'approval_status'
       or new.step <> (v_derived_status ->> 'approval_step')::int then
      raise exception '採購資料送出的下一關狀態不一致'
        using errcode = '23514';
    end if;
    if v_derived_status ->> 'approval_status' = 'completed' then
      raise exception
        '申請單流程缺少最後會計入帳關卡，已停止完成；請先修正簽核路線後再處理'
        using errcode = '55000';
    end if;

    v_permission_context := pg_catalog.jsonb_build_object(
      'assignee_finance_user_id', v_actor.id,
      'owner_finance_user_id', old.applicant_id,
      'department_code', old.department_code,
      'company_id', old.entity_id,
      'entity_id', old.entity_id,
      'resource_type', 'expense_request',
      'resource_id', old.id,
      'workflow_step_key', v_role_key
    );
    if not private.finance_expense_optional_permission_allows(
      v_tenant_id,
      v_actor.id,
      'finance.approval.approve',
      v_permission_context
    ) then
      raise exception '目前人員權限不允許送出採購簽核'
        using errcode = '42501';
    end if;

    if v_role_key = 'procurement_payment' then
      v_allowed_columns := array[
        'amount',
        'estimated_amount',
        'payee',
        'bank_type',
        'bank_name',
        'bank_branch',
        'bank_no',
        'expected_pay_date',
        'bank_account',
        'fee_bearer',
        'bank_fee_amount',
        'status',
        'step',
        'steps',
        'form_payload',
        'ver',
        'updated_at'
      ];
      v_allowed_payload_keys := array[
        'purchaseEstimate',
        'procurementPaymentInfo',
        'accountingLines',
        'accountingLinesNeedReview',
        'accountingLinesInvalidatedAt',
        'accountingLinesInvalidatedReason'
      ];
    else
      v_allowed_columns := array[
        'amount',
        'estimated_amount',
        'actual_amount',
        'actual_files',
        'files',
        'status',
        'step',
        'steps',
        'form_payload',
        'ver',
        'updated_at'
      ];
      v_allowed_payload_keys := array[
        'purchaseActual',
        'procurementReceiptInfo',
        'accountingLines',
        'accountingLinesNeedReview',
        'accountingLinesInvalidatedAt',
        'accountingLinesInvalidatedReason'
      ];
    end if;

    if (pg_catalog.to_jsonb(new) - v_allowed_columns) <>
       (pg_catalog.to_jsonb(old) - v_allowed_columns) then
      raise exception '採購資料送出包含不允許的欄位'
        using errcode = '42501';
    end if;

    if (
         coalesce(new.form_payload, '{}'::jsonb)
         - v_allowed_payload_keys
       ) <> (
         coalesce(old.form_payload, '{}'::jsonb)
         - v_allowed_payload_keys
       )
       or coalesce(new.form_payload, '{}'::jsonb) ?
          'accountingLines'
       or coalesce(
         (new.form_payload ->> 'accountingLinesNeedReview')::boolean,
         false
       ) is not true
       or coalesce(
         pg_catalog.btrim(
           new.form_payload ->> 'accountingLinesInvalidatedReason'
         ),
         ''
       ) = '' then
      raise exception
        '採購資料送出只能更新本關資料並移除待重新覆核的舊會計明細'
        using errcode = '42501';
    end if;

    if v_role_key = 'procurement_payment' then
      if pg_catalog.jsonb_typeof(
           new.form_payload -> 'purchaseEstimate'
         ) <> 'object'
         or pg_catalog.jsonb_typeof(
           new.form_payload -> 'procurementPaymentInfo'
         ) <> 'object'
         or coalesce(new.amount, -1) <= 0
         or coalesce(new.estimated_amount, -1) <= 0
         or new.amount is distinct from new.estimated_amount
         or coalesce(
           (new.form_payload #>>
             '{procurementPaymentInfo,amount}')::numeric,
           -1
         ) <> coalesce(new.estimated_amount, new.amount, -1)
         or coalesce(
           new.form_payload #>>
             '{procurementPaymentInfo,payee}',
           ''
         ) <> coalesce(new.payee, '')
         or coalesce(
           new.form_payload #>>
             '{procurementPaymentInfo,bankType}',
           ''
         ) <> coalesce(new.bank_type, '')
         or coalesce(
           new.form_payload #>>
             '{procurementPaymentInfo,bankName}',
           ''
         ) <> coalesce(new.bank_name, '')
         or coalesce(
           new.form_payload #>>
             '{procurementPaymentInfo,bankBranch}',
           ''
         ) <> coalesce(new.bank_branch, '')
         or coalesce(
           new.form_payload #>>
             '{procurementPaymentInfo,bankNo}',
           ''
         ) <> coalesce(new.bank_no, '')
         or coalesce(
           new.form_payload #>>
             '{procurementPaymentInfo,expectedPayDate}',
           ''
         ) <> pg_catalog.replace(
           coalesce(new.expected_pay_date::text, ''),
           '/',
           '-'
         )
         or coalesce(
           new.form_payload #>>
             '{procurementPaymentInfo,feeBearer}',
           ''
         ) <> coalesce(new.fee_bearer, '')
         or coalesce(
           new.form_payload #>>
             '{procurementPaymentInfo,summary}',
           ''
         ) <> coalesce(new.bank_account, '')
         or coalesce(new.bank_fee_amount, 0) < 0
         or coalesce(
           new.form_payload #>>
             '{purchaseEstimate,stage}',
           ''
         ) <> 'procurement_estimate'
         or coalesce(
           new.form_payload #>>
             '{procurementPaymentInfo,filledBy}',
           ''
         ) <> v_actor.name then
        raise exception '總務付款資料與申請單欄位或目前處理人不一致'
          using errcode = '23514';
      end if;
    elsif pg_catalog.jsonb_typeof(
            new.form_payload -> 'purchaseActual'
          ) <> 'object'
          or pg_catalog.jsonb_typeof(
            new.form_payload -> 'procurementReceiptInfo'
          ) <> 'object'
          or coalesce(
            (new.form_payload #>>
              '{purchaseActual,actualAmount}')::numeric,
            -1
          ) <> coalesce(new.actual_amount, -1)
          or coalesce(new.actual_amount, -1) <= 0
          or new.amount is distinct from old.amount
          or new.estimated_amount is distinct from coalesce(
            old.estimated_amount,
            old.amount
          )
          or pg_catalog.jsonb_array_length(
            coalesce(new.actual_files, '[]'::jsonb)
          ) <= pg_catalog.jsonb_array_length(
            coalesce(old.actual_files, '[]'::jsonb)
          )
          or coalesce(
            new.form_payload #>>
              '{purchaseActual,submittedBy}',
            ''
          ) <> v_actor.name
          or coalesce(
            new.form_payload #>>
              '{purchaseActual,stage}',
            ''
          ) <> 'procurement_actual_receipt'
          or coalesce(
            (new.form_payload #>>
              '{procurementReceiptInfo,actualAmount}')::numeric,
            -1
          ) <> coalesce(new.actual_amount, -1)
          or coalesce(
            new.form_payload #>>
              '{procurementReceiptInfo,submittedBy}',
            ''
          ) <> v_actor.name
          or coalesce(
            (new.form_payload #>>
              '{procurementReceiptInfo,fileCount}')::int,
            -1
          ) <> (
            pg_catalog.jsonb_array_length(
              coalesce(new.actual_files, '[]'::jsonb)
            ) - pg_catalog.jsonb_array_length(
              coalesce(old.actual_files, '[]'::jsonb)
            )
          )
          or coalesce(
            new.form_payload -> 'purchaseActual' -> 'files',
            '[]'::jsonb
          ) <> coalesce(new.actual_files, '[]'::jsonb) then
      raise exception '採購憑據資料與實際金額、附件或目前處理人不一致'
        using errcode = '23514';
    end if;

    new.ver := coalesce(old.ver, 1) + 1;
    new.updated_at := pg_catalog.now();
    return new;
  end if;

  raise exception
    '正式申請單的簽核與會計欄位只能透過交易式功能修改'
    using errcode = '42501';
end;
$function$

