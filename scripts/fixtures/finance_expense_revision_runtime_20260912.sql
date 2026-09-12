-- Read-only catalog snapshot 2026-09-12; no business rows or credentials.
-- Used only by offline fixture tests; this is not a migration.
-- public.finance_expense_resubmit_applicant_revision
CREATE OR REPLACE FUNCTION public.finance_expense_resubmit_applicant_revision(p_request_id text, p_action text, p_idempotency_key text, p_expected_ver integer, p_expected_updated_at timestamp with time zone, p_expected_active_step_index integer, p_comment text DEFAULT NULL::text, p_form_patch jsonb DEFAULT '{}'::jsonb, p_step_files jsonb DEFAULT '[]'::jsonb, p_data_environment text DEFAULT 'production'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tenant_id uuid;
  v_actor public.finance_users%rowtype;
  v_expense public.expense_requests%rowtype;
  v_environment text := pg_catalog.lower(coalesce(
    p_data_environment, 'production'
  ));
  v_action text := pg_catalog.lower(coalesce(p_action, ''));
  v_active_index integer;
  v_active_step jsonb;
  v_payload jsonb;
  v_amount numeric;
  v_future_route jsonb;
begin
  -- Cancel and all cached/stale retry cases remain owned by the reviewed
  -- delegate.  Only a first, exact resubmit transition is route-gated here.
  if auth.uid() is not null
     and v_action = 'resubmit'
     and v_environment in ('production', 'test') then
    v_tenant_id := public.current_tenant_id();
    select finance_user.*
      into v_actor
    from public.finance_users finance_user
    where finance_user.tenant_id = v_tenant_id
      and finance_user.auth_user_id = auth.uid()
      and finance_user.active
    order by finance_user.created_at, finance_user.id
    limit 1;

    if found then
      select expense_row.*
        into v_expense
      from public.expense_requests expense_row
      where expense_row.tenant_id = v_tenant_id
        and expense_row.data_environment = v_environment
        and expense_row.id = p_request_id
      for update;

      if found
         and v_expense.applicant_id = v_actor.id
         and v_expense.status = 'pending_applicant_confirm'
         and coalesce(v_expense.ver, 1) = p_expected_ver
         and v_expense.updated_at is not distinct from p_expected_updated_at
         and pg_catalog.jsonb_typeof(coalesce(p_form_patch, 'null'::jsonb)) = 'object'
         and pg_catalog.jsonb_typeof(
               coalesce(p_form_patch -> 'form_payload', '{}'::jsonb)
             ) = 'object' then
        v_active_index := private.finance_income_active_step_index(
          v_expense.steps
        );
        if v_active_index = p_expected_active_step_index then
          v_active_step := v_expense.steps -> v_active_index;
          if private.finance_income_step_role(v_active_step) = 'applicant_revision'
             and coalesce(v_active_step ->> 'uid', '') = v_actor.id
             and coalesce(v_active_step ->> 'a', '') = '' then
            v_payload := coalesce(v_expense.form_payload, '{}'::jsonb)
              || coalesce(p_form_patch -> 'form_payload', '{}'::jsonb);
            begin
              -- Parse the patched value with the same numeric cast accepted by
              -- the delegate (including scientific notation).  Invalid/missing
              -- values are left to the delegate's canonical validation and can
              -- never be route-checked against the old amount.
              v_amount := nullif(p_form_patch ->> 'amount', '')::numeric;
              if v_amount is not null then
                v_future_route :=
                  private.finance_expense_assert_applicant_revision_future_route_v3(
                    v_tenant_id,
                    v_actor.id,
                    v_expense.type,
                    v_expense.department_code,
                    v_amount,
                    v_payload,
                    v_expense.steps,
                    v_active_index
                  );
              end if;
            exception
              when invalid_text_representation or numeric_value_out_of_range then
                null;
            end;
          end if;
        end if;
      end if;
    end if;
  end if;

  return private.finance_expense_resubmit_applicant_revision_v1_unsafe(
    p_request_id,
    p_action,
    p_idempotency_key,
    p_expected_ver,
    p_expected_updated_at,
    p_expected_active_step_index,
    p_comment,
    p_form_patch,
    p_step_files,
    p_data_environment
  );
end;
$function$
;

-- private.finance_expense_resubmit_applicant_revision_v1_unsafe
CREATE OR REPLACE FUNCTION private.finance_expense_resubmit_applicant_revision_v1_unsafe(p_request_id text, p_action text, p_idempotency_key text, p_expected_ver integer, p_expected_updated_at timestamp with time zone, p_expected_active_step_index integer, p_comment text DEFAULT NULL::text, p_form_patch jsonb DEFAULT '{}'::jsonb, p_step_files jsonb DEFAULT '[]'::jsonb, p_data_environment text DEFAULT 'production'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tenant_id uuid;
  v_actor public.finance_users%rowtype;
  v_expense public.expense_requests%rowtype;
  v_environment text := pg_catalog.lower(
    coalesce(p_data_environment, 'production')
  );
  v_action text := pg_catalog.lower(coalesce(p_action, ''));
  v_comment text := coalesce(pg_catalog.btrim(p_comment), '');
  v_active_index integer;
  v_step jsonb;
  v_step_updated jsonb;
  v_steps jsonb;
  v_status jsonb;
  v_payload_patch jsonb := coalesce(
    p_form_patch -> 'form_payload',
    '{}'::jsonb
  );
  v_form_payload jsonb;
  v_files jsonb;
  v_files_delta jsonb;
  v_passbook_files jsonb;
  v_passbook_files_delta jsonb;
  v_amount numeric;
  v_request_date date;
  v_expected_pay_date date;
  v_bank_fee_amount numeric;
  v_configured_bank_fee numeric;
  v_system_fee_row_count integer;
  v_system_fee_row_total numeric;
  v_hr_fee_row_count integer;
  v_hr_info_transfer_fee numeric;
  v_hr_info_fee_rows integer;
  v_hr_info_fee_per_row numeric;
  v_hr_info_payment_total numeric;
  v_hr_info_cash_total numeric;
  v_detail_total numeric;
  v_is_fixed boolean;
  v_routing_policy jsonb;
  v_role_threshold numeric;
  v_after_audit jsonb;
  v_row_count integer;
  v_digest text;
  v_cached jsonb;
  v_result jsonb;
  v_updated_at timestamptz;
  v_previous_write_context text;
  v_payload_key text;
  v_payload_value jsonb;
begin
  if auth.uid() is null then
    raise exception '請先登入後再處理退回補件'
      using errcode = '42501';
  end if;

  if v_environment not in ('production', 'test') then
    raise exception '資料環境只允許 production 或 test'
      using errcode = '22023';
  end if;

  if v_action not in ('resubmit', 'cancel') then
    raise exception '退回補件動作只允許 resubmit 或 cancel'
      using errcode = '22023';
  end if;

  if coalesce(pg_catalog.btrim(p_request_id), '') = ''
     or coalesce(pg_catalog.btrim(p_idempotency_key), '') = '' then
    raise exception '申請單與操作識別不可空白'
      using errcode = '22023';
  end if;

  if pg_catalog.length(v_comment) > 2000
     or pg_catalog.octet_length(coalesce(p_form_patch, '{}'::jsonb)::text)
          > 2097152 then
    raise exception '補件原因或表單內容過長，請縮短文字或減少明細後再試'
      using errcode = '22023';
  end if;

  if p_expected_ver is null
     or p_expected_updated_at is null
     or p_expected_active_step_index is null then
    raise exception '缺少補件版本資料，請重新整理後再試'
      using errcode = '40001';
  end if;

  if pg_catalog.jsonb_typeof(coalesce(p_form_patch, '{}'::jsonb)) <> 'object'
     or pg_catalog.jsonb_typeof(v_payload_patch) <> 'object'
     or exists (
       select 1
       from pg_catalog.jsonb_object_keys(
         coalesce(p_form_patch, '{}'::jsonb)
       ) patch_key
       where patch_key not in (
         'amount',
         'description',
         'payee',
         'bank_type',
         'bank_name',
         'bank_branch',
         'bank_no',
         'expected_pay_date',
         'bank_account',
         'fee_bearer',
         'request_date',
         'files',
         'petty_mode',
         'form_payload'
       )
     ) then
    raise exception '補件內容包含不允許修改的欄位'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_object_keys(v_payload_patch) payload_key
    where payload_key not in (
      'requestPurpose',
      'requestNote',
      'receiptType',
      'paymentType',
      'isFixedExpense',
      'is_fixed_expense',
      'lazyRows',
      'refundRows',
      'purchaseRows',
      'hrRows',
      'hrItem',
      'pettyMode',
      'passbookFiles',
      'travelInfo',
      'refundInfo',
      'purchaseInfo',
      'hrInfo'
    )
  ) then
    raise exception '補件表單包含系統或會計保留欄位'
      using errcode = '22023';
  end if;

  if pg_catalog.jsonb_typeof(coalesce(p_step_files, '[]'::jsonb)) <> 'array'
     or pg_catalog.jsonb_array_length(
       coalesce(p_step_files, '[]'::jsonb)
     ) > 20 then
    raise exception '補件關卡附件格式錯誤或超過 20 個'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from (
      values
        ('lazyRows', 'array', 500),
        ('refundRows', 'array', 200),
        ('purchaseRows', 'array', 200),
        ('hrRows', 'array', 500),
        ('passbookFiles', 'array', 20),
        ('travelInfo', 'object', null::integer),
        ('refundInfo', 'object', null::integer),
        ('purchaseInfo', 'object', null::integer),
        ('hrInfo', 'object', null::integer)
    ) as payload_rule(payload_key, expected_type, max_items)
    where v_payload_patch ? payload_rule.payload_key
      and v_payload_patch -> payload_rule.payload_key <> 'null'::jsonb
      and (
        pg_catalog.jsonb_typeof(
          v_payload_patch -> payload_rule.payload_key
        ) <> payload_rule.expected_type
        or case
          when payload_rule.expected_type = 'array'
           and pg_catalog.jsonb_typeof(
             v_payload_patch -> payload_rule.payload_key
           ) = 'array'
          then pg_catalog.jsonb_array_length(
            v_payload_patch -> payload_rule.payload_key
          ) > payload_rule.max_items
          else false
        end
      )
  ) then
    raise exception '補件明細格式錯誤或筆數超過上限'
      using errcode = '22023';
  end if;

  if v_action = 'cancel' and v_comment = '' then
    raise exception '不通過並結束申請時必須填寫原因'
      using errcode = '22023';
  end if;

  if v_action = 'cancel'
     and coalesce(p_form_patch, '{}'::jsonb) <> '{}'::jsonb then
    raise exception '結束申請不可同時修改原申請內容'
      using errcode = '22023';
  end if;

  v_tenant_id := public.current_tenant_id();

  select finance_user.*
    into v_actor
  from public.finance_users finance_user
  where finance_user.tenant_id = v_tenant_id
    and finance_user.auth_user_id = auth.uid()
    and finance_user.active is true
  order by finance_user.created_at, finance_user.id
  limit 1;

  if not found then
    raise exception '目前登入帳號沒有此租戶的有效財務人員身分'
      using errcode = '42501';
  end if;

  v_digest := private.finance_income_request_digest(
    pg_catalog.jsonb_build_object(
      'operation', 'expense_applicant_revision',
      'environment', v_environment,
      'request_id', p_request_id,
      'action', v_action,
      'expected_ver', p_expected_ver,
      'expected_updated_at', p_expected_updated_at,
      'expected_active_step_index', p_expected_active_step_index,
      'comment', v_comment,
      'form_patch', coalesce(p_form_patch, '{}'::jsonb),
      'step_files', coalesce(p_step_files, '[]'::jsonb)
    )
  );

  v_cached := private.finance_income_begin_operation(
    v_tenant_id,
    v_environment,
    'expense_applicant_revision',
    p_idempotency_key,
    v_digest,
    v_actor.id
  );

  if v_cached is not null then
    return v_cached || pg_catalog.jsonb_build_object(
      'idempotent_replay', true
    );
  end if;

  select expense_row.*
    into v_expense
  from public.expense_requests expense_row
  where expense_row.tenant_id = v_tenant_id
    and expense_row.data_environment = v_environment
    and expense_row.id = p_request_id
  for update;

  if not found then
    raise exception '找不到這張待補件申請單'
      using errcode = 'P0002';
  end if;

  if v_expense.applicant_id is distinct from v_actor.id then
    raise exception '只有原申請人本人可以修改並重新送出'
      using errcode = '42501';
  end if;

  if v_expense.type is null
     or v_expense.type not in (
       'expense_reimbursement',
       'payment_request',
       'advance_request',
       'petty_cash_request',
       'travel_request',
       'purchase_request',
       'refund_request',
       'welfare_request',
       'hr_expense_request'
     ) then
    raise exception '這張單的申請類型不在補件可編輯範圍'
      using errcode = '55000';
  end if;

  if v_expense.cash_posted_at is not null
     or v_expense.ledger_posted_at is not null
     or v_expense.posting_locked_at is not null
     or v_expense.voided_at is not null
     or coalesce(v_expense.voucher_id, '') <> '' then
    raise exception '這張單已撥款、入帳、鎖定或作廢，不能直接補件或結束申請'
      using errcode = '55000';
  end if;

  v_active_index := private.finance_income_active_step_index(
    v_expense.steps
  );

  if v_active_index is null
     or v_active_index <> p_expected_active_step_index
     or coalesce(v_expense.ver, 1) <> p_expected_ver
     or v_expense.updated_at is distinct from p_expected_updated_at then
    raise exception '這張單已被其他操作更新，請重新整理後再修改'
      using errcode = '40001';
  end if;

  v_step := v_expense.steps -> v_active_index;
  if private.finance_income_step_role(v_step) <> 'applicant_revision'
     or coalesce(v_step ->> 'uid', '') <> v_actor.id
     or v_expense.status is distinct from 'pending_applicant_confirm' then
    raise exception '目前不是申請人退回補件關卡'
      using errcode = '55000';
  end if;

  if not private.finance_expense_new_files_are_owned(
    v_tenant_id,
    v_expense,
    '[]'::jsonb,
    coalesce(p_step_files, '[]'::jsonb),
    v_actor.id
  ) then
    raise exception '補件關卡附件不屬於目前申請人或這張單'
      using errcode = '42501';
  end if;

  v_steps := v_expense.steps;

  if v_action = 'cancel' then
    if exists (
      select 1
      from pg_catalog.jsonb_array_elements(v_steps) workflow_step
      where private.finance_income_step_role(workflow_step) in (
        'ceo',
        'cashier'
      )
        and coalesce(workflow_step ->> 'a', '') = 'approved'
    ) then
      raise exception '這張單已經執行長或出納核准，不可直接結束；請改走退回或會計沖銷流程'
        using errcode = '55000';
    end if;

    v_step_updated := private.finance_income_append_step_action(
      v_step,
      v_actor.id,
      v_actor.name,
      '不通過並結束申請',
      v_comment,
      p_step_files
    ) || pg_catalog.jsonb_build_object(
      'a', 'cancelled',
      'n', v_actor.name,
      't', pg_catalog.to_char(
        pg_catalog.timezone('Asia/Taipei', pg_catalog.now()),
        'YYYY/MM/DD'
      )
    );

    v_steps := pg_catalog.jsonb_set(
      v_steps,
      array[v_active_index::text],
      v_step_updated,
      false
    );
    v_form_payload := coalesce(v_expense.form_payload, '{}'::jsonb)
      || pg_catalog.jsonb_build_object(
        'cancelledAt', pg_catalog.now(),
        'cancelledBy', v_actor.name,
        'cancelReason', v_comment
      );
    v_updated_at := pg_catalog.now();
    v_previous_write_context := coalesce(
      pg_catalog.current_setting(
        'app.finance_expense_write_context',
        true
      ),
      ''
    );
    perform pg_catalog.set_config(
      'app.finance_expense_write_context',
      'org_resubmit',
      true
    );

    update public.expense_requests
    set status = 'cancelled',
        step = v_active_index + 1,
        steps = v_steps,
        form_payload = v_form_payload,
        ver = coalesce(ver, 1) + 1,
        updated_at = v_updated_at
    where tenant_id = v_tenant_id
      and id = v_expense.id;
    get diagnostics v_row_count = row_count;
    perform pg_catalog.set_config(
      'app.finance_expense_write_context',
      v_previous_write_context,
      true
    );
    if v_row_count <> 1 then
      raise exception '結束補件申請時資料寫入失敗'
        using errcode = '55000';
    end if;
  else
    if not (
      p_form_patch ?& array[
        'amount',
        'description',
        'payee',
        'bank_type',
        'bank_name',
        'bank_branch',
        'bank_no',
        'expected_pay_date',
        'bank_account',
        'fee_bearer',
        'request_date',
        'files',
        'petty_mode',
        'form_payload'
      ]
    ) then
      raise exception '補件重送資料不完整，請重新整理後再填一次'
        using errcode = '22023';
    end if;

    if not (
      v_payload_patch ?& array[
        'requestPurpose',
        'requestNote',
        'receiptType',
        'paymentType',
        'isFixedExpense',
        'is_fixed_expense',
        'lazyRows',
        'refundRows',
        'purchaseRows',
        'hrRows',
        'hrItem',
        'pettyMode',
        'passbookFiles',
        'travelInfo',
        'refundInfo',
        'purchaseInfo',
        'hrInfo'
      ]
    )
       or pg_catalog.jsonb_typeof(v_payload_patch -> 'lazyRows') <> 'array'
       or pg_catalog.jsonb_typeof(v_payload_patch -> 'refundRows') <> 'array'
       or pg_catalog.jsonb_typeof(v_payload_patch -> 'purchaseRows') <> 'array'
       or pg_catalog.jsonb_typeof(v_payload_patch -> 'hrRows') <> 'array'
       or pg_catalog.jsonb_typeof(v_payload_patch -> 'passbookFiles') <> 'array'
       or pg_catalog.jsonb_typeof(v_payload_patch -> 'isFixedExpense')
            <> 'boolean'
       or pg_catalog.jsonb_typeof(v_payload_patch -> 'is_fixed_expense')
            <> 'boolean' then
      raise exception '補件表單缺少完整明細或支出性質資料'
        using errcode = '22023';
    end if;

    begin
      v_is_fixed := (v_payload_patch ->> 'isFixedExpense')::boolean;
    exception
      when invalid_text_representation then
        raise exception '支出性質格式不正確，請重新整理後再試'
          using errcode = '22023';
    end;

    if v_is_fixed is distinct from
         (v_payload_patch ->> 'is_fixed_expense')::boolean then
      raise exception '支出性質的相容欄位不一致，請重新整理後再試'
        using errcode = '22023';
    end if;

    begin
      v_amount := nullif(p_form_patch ->> 'amount', '')::numeric;
      v_request_date := nullif(
        p_form_patch ->> 'request_date',
        ''
      )::date;
      v_expected_pay_date := nullif(
        p_form_patch ->> 'expected_pay_date',
        ''
      )::date;
    exception
      when invalid_text_representation
        or datetime_field_overflow
        or numeric_value_out_of_range then
        raise exception '補件的金額或日期格式不正確，請重新填寫'
          using errcode = '22023';
    end;
    v_files_delta := p_form_patch -> 'files';
    v_passbook_files_delta := v_payload_patch -> 'passbookFiles';
    v_files := case
      when pg_catalog.jsonb_typeof(v_expense.files) = 'array'
        then v_expense.files
      else '[]'::jsonb
    end;
    v_passbook_files := case
      when pg_catalog.jsonb_typeof(
             v_expense.form_payload -> 'passbookFiles'
           ) = 'array'
        then v_expense.form_payload -> 'passbookFiles'
      else '[]'::jsonb
    end;

    if v_amount is null
       or (v_expense.type <> 'purchase_request' and v_amount <= 0)
       or (v_expense.type = 'purchase_request' and v_amount < 0)
       or v_amount > 1000000000000
       or v_amount <> pg_catalog.round(v_amount, 2)
       or p_form_patch ->> 'description' is null
       or pg_catalog.length(
            pg_catalog.btrim(p_form_patch ->> 'description')
          ) < 5
       or pg_catalog.length(p_form_patch ->> 'description') > 10000
       or v_request_date is null
       or v_request_date < date '2000-01-01'
       or v_request_date > date '2100-12-31'
       or v_expected_pay_date < date '2000-01-01'
       or v_expected_pay_date > date '2100-12-31'
       or pg_catalog.length(coalesce(p_form_patch ->> 'payee', '')) > 500
       or pg_catalog.length(coalesce(p_form_patch ->> 'bank_name', '')) > 500
       or pg_catalog.length(coalesce(p_form_patch ->> 'bank_branch', '')) > 500
       or pg_catalog.length(coalesce(p_form_patch ->> 'bank_no', '')) > 100
       or pg_catalog.length(coalesce(p_form_patch ->> 'bank_account', '')) > 2000
       or pg_catalog.jsonb_typeof(v_files_delta) <> 'array'
       or pg_catalog.jsonb_array_length(v_files_delta) > 20
       or pg_catalog.jsonb_array_length(v_files)
            + pg_catalog.jsonb_array_length(v_files_delta) > 100
       or pg_catalog.jsonb_typeof(v_passbook_files_delta) <> 'array'
       or pg_catalog.jsonb_array_length(v_passbook_files_delta) > 5
       or pg_catalog.jsonb_array_length(v_passbook_files)
            + pg_catalog.jsonb_array_length(v_passbook_files_delta) > 20 then
      raise exception '補件內容的金額、日期、文字或附件格式不正確'
        using errcode = '22023';
    end if;

    if coalesce(p_form_patch ->> 'bank_type', '') not in (
         '',
         'mega',
         'other'
       )
       or coalesce(p_form_patch ->> 'fee_bearer', '') not in (
         '',
         '己方支出',
         '對方支出'
       ) then
      raise exception '匯款銀行類別或手續費負擔方式不正確'
        using errcode = '22023';
    end if;

    if v_expense.type = 'petty_cash_request'
       and (
         nullif(pg_catalog.btrim(p_form_patch ->> 'petty_mode'), '')
         is distinct from nullif(
           pg_catalog.btrim(v_expense.petty_mode),
           ''
         )
         or nullif(pg_catalog.btrim(v_payload_patch ->> 'pettyMode'), '')
         is distinct from nullif(
           pg_catalog.btrim(v_expense.form_payload ->> 'pettyMode'),
           ''
         )
       ) then
      raise exception '零用金初次／一般申請模式涉及既有會計狀態，退回補件時不可切換'
        using errcode = '42501';
    end if;

    if v_expense.type not in ('purchase_request', 'hr_expense_request')
       and (
         coalesce(pg_catalog.btrim(p_form_patch ->> 'payee'), '') = ''
         or coalesce(pg_catalog.btrim(p_form_patch ->> 'bank_name'), '') = ''
         or coalesce(pg_catalog.btrim(p_form_patch ->> 'bank_branch'), '') = ''
         or coalesce(pg_catalog.btrim(p_form_patch ->> 'bank_no'), '') = ''
         or v_expected_pay_date is null
       ) then
      raise exception '請完整填寫收款人、銀行、分行、帳號與預計匯款日'
        using errcode = '22023';
    end if;

    -- Bank fees are accounting/cash facts, not client-editable values. Read
    -- the current tenant setting and derive the fee from the locked entity,
    -- bank, fee bearer, and (for HR) each transfer row.
    v_configured_bank_fee := null;
    select case
      when coalesce(setting_row.value ->> v_expense.entity_id, '')
             ~ '^[0-9]+([.][0-9]{1,2})?$'
        then (setting_row.value ->> v_expense.entity_id)::numeric
      else null
    end
      into v_configured_bank_fee
    from public.system_settings setting_row
    where setting_row.tenant_id = v_tenant_id
      and setting_row.key = 'bank_transfer_fees'
    limit 1;

    if v_configured_bank_fee is null
       or v_configured_bank_fee < 0
       or v_configured_bank_fee > 1000000
       or v_configured_bank_fee <>
            pg_catalog.round(v_configured_bank_fee, 2) then
      raise exception '此法人的銀行轉帳手續費尚未正確設定，請先由管理者修正'
        using errcode = '55000';
    end if;

    if v_expense.type = 'hr_expense_request' then
      if pg_catalog.jsonb_typeof(v_payload_patch -> 'hrInfo') <>
           'object'
         or coalesce(
              v_payload_patch -> 'hrInfo' ->> 'transferFeeBearer',
              ''
            ) <> coalesce(p_form_patch ->> 'fee_bearer', '') then
        raise exception '人事費用的手續費負擔方式與匯款明細不一致'
          using errcode = '22023';
      end if;

      select pg_catalog.count(*)::integer
        into v_hr_fee_row_count
      from pg_catalog.jsonb_array_elements(
        v_payload_patch -> 'hrRows'
      ) detail_row
      where case
        when coalesce(
               nullif(detail_row ->> '匯款金額', ''),
               nullif(detail_row ->> '金額', ''),
               nullif(detail_row ->> '轉帳金額', ''),
               '0'
             ) ~ '^[0-9]+([.][0-9]{1,2})?$'
          then coalesce(
                 nullif(detail_row ->> '匯款金額', ''),
                 nullif(detail_row ->> '金額', ''),
                 nullif(detail_row ->> '轉帳金額', ''),
                 '0'
               )::numeric > 0
        else false
      end
        and not (
          pg_catalog.regexp_replace(
            coalesce(
              detail_row ->> '銀行代號',
              detail_row ->> 'bank_code',
              ''
            ),
            '[^0-9]',
            '',
            'g'
          ) like '017%'
          or pg_catalog.concat_ws(
               ' ',
               detail_row ->> '銀行別',
               detail_row ->> '銀行',
               detail_row ->> 'bank_name'
             ) like '%兆豐%'
          or (
            pg_catalog.btrim(pg_catalog.concat_ws(
              '',
              detail_row ->> '銀行代號',
              detail_row ->> 'bank_code',
              detail_row ->> '銀行別',
              detail_row ->> '銀行',
              detail_row ->> 'bank_name'
            )) = ''
            and coalesce(p_form_patch ->> 'bank_type', '') = 'mega'
          )
        );

      v_bank_fee_amount := case
        when coalesce(p_form_patch ->> 'fee_bearer', '') = '己方支出'
          then v_hr_fee_row_count * v_configured_bank_fee
        else 0
      end;

      begin
        v_hr_info_transfer_fee := nullif(
          v_payload_patch -> 'hrInfo' ->> 'transferFeeTotal',
          ''
        )::numeric;
        v_hr_info_fee_rows := nullif(
          v_payload_patch -> 'hrInfo' ->> 'transferFeeRows',
          ''
        )::integer;
        v_hr_info_fee_per_row := nullif(
          v_payload_patch -> 'hrInfo' ->> 'transferFeePerRow',
          ''
        )::numeric;
        v_hr_info_payment_total := nullif(
          v_payload_patch -> 'hrInfo' ->> 'paymentTotal',
          ''
        )::numeric;
        v_hr_info_cash_total := nullif(
          v_payload_patch -> 'hrInfo' ->> 'cashTotal',
          ''
        )::numeric;
      exception
        when invalid_text_representation
          or numeric_value_out_of_range then
          raise exception '人事費用的匯款與手續費合計格式不正確'
            using errcode = '22023';
      end;

      if v_hr_info_transfer_fee is null
         or v_hr_info_fee_rows is null
         or v_hr_info_fee_per_row is null
         or v_hr_info_payment_total is null
         or v_hr_info_cash_total is null
         or v_hr_info_fee_rows <> v_hr_fee_row_count
         or pg_catalog.abs(
              v_hr_info_fee_per_row - case
                when coalesce(p_form_patch ->> 'fee_bearer', '') =
                       '己方支出'
                  then v_configured_bank_fee
                else 0
              end
            ) > 0.01
         or pg_catalog.abs(
              v_hr_info_transfer_fee - v_bank_fee_amount
            ) > 0.01
         or pg_catalog.abs(v_hr_info_payment_total - v_amount) > 0.01
         or pg_catalog.abs(
              v_hr_info_cash_total - (v_amount + v_bank_fee_amount)
            ) > 0.01 then
        raise exception '人事費用的匯款金額、手續費或撥款總額不一致'
          using errcode = '23514';
      end if;
    else
      v_bank_fee_amount := case
        when v_expense.type = 'purchase_request'
          or coalesce(p_form_patch ->> 'fee_bearer', '') <>
               '己方支出'
          or coalesce(p_form_patch ->> 'bank_type', '') = 'mega'
          or coalesce(p_form_patch ->> 'bank_name', '') like '%兆豐%'
          or coalesce(p_form_patch ->> 'bank_name', '') ~
               '(^|[^0-9])017([^0-9]|$)'
          then 0
        else v_configured_bank_fee
      end;
    end if;

    if v_bank_fee_amount < 0
       or v_bank_fee_amount > 1000000
       or v_bank_fee_amount <> pg_catalog.round(v_bank_fee_amount, 2) then
      raise exception '系統推導的銀行轉帳手續費不合法'
        using errcode = '23514';
    end if;

    if v_expense.type in (
         'expense_reimbursement',
         'payment_request',
         'advance_request',
         'petty_cash_request',
         'welfare_request'
       ) then
      select
        pg_catalog.count(*)::integer,
        coalesce(pg_catalog.sum(
          case
            when coalesce(
                   detail_row ->> 'total',
                   detail_row ->> 'grossAmount',
                   ''
                 ) ~ '^[0-9]+([.][0-9]{1,2})?$'
              then coalesce(
                     detail_row ->> 'total',
                     detail_row ->> 'grossAmount'
                   )::numeric
            else 0
          end
        ), 0)
        into v_system_fee_row_count, v_system_fee_row_total
      from pg_catalog.jsonb_array_elements(
        v_payload_patch -> 'lazyRows'
      ) detail_row
      where pg_catalog.lower(
              coalesce(detail_row ->> 'systemFee', 'false')
            ) = 'true';

      if (v_bank_fee_amount = 0 and v_system_fee_row_count <> 0)
         or (
           v_bank_fee_amount > 0
           and (
             v_system_fee_row_count <> 1
             or pg_catalog.abs(
                  v_system_fee_row_total - v_bank_fee_amount
                ) > 0.01
           )
         ) then
        raise exception '銀行手續費明細必須由系統依銀行與法人設定產生，不可自行改寫'
          using errcode = '23514';
      end if;

      if exists (
        select 1
        from pg_catalog.jsonb_array_elements(
          v_payload_patch -> 'lazyRows'
        ) detail_row
        where pg_catalog.lower(
                coalesce(detail_row ->> 'systemFee', 'false')
              ) = 'true'
          and (
            coalesce(detail_row ->> 'item', '') <>
              '銀行手續費（己方支出，免憑證）'
            or coalesce(detail_row ->> 'file', '') <> '免憑證'
            or coalesce(detail_row ->> 'taxMode', '') <> 'exempt'
            or coalesce(detail_row ->> 'qty', '') !~ '^1([.]0+)?$'
            or coalesce(detail_row ->> 'netAmount', '') !~
                 '^[0-9]+([.][0-9]{1,2})?$'
            or coalesce(detail_row ->> 'taxAmount', '') !~
                 '^0([.]0+)?$'
            or case
              when coalesce(detail_row ->> 'netAmount', '') ~
                     '^[0-9]+([.][0-9]{1,2})?$'
                then pg_catalog.abs(
                       (detail_row ->> 'netAmount')::numeric
                         - v_bank_fee_amount
                     ) > 0.01
              else true
            end
          )
      ) then
        raise exception '銀行手續費列的品項、金額或免憑證標記不可手動改寫'
          using errcode = '23514';
      end if;
    end if;

    if v_expense.type in (
         'expense_reimbursement',
         'payment_request',
         'advance_request',
         'petty_cash_request',
         'welfare_request'
       )
       and pg_catalog.jsonb_array_length(
         v_payload_patch -> 'lazyRows'
       ) > 0 then
      select coalesce(pg_catalog.sum(
        case
          when pg_catalog.lower(
                 coalesce(detail_row ->> 'systemFee', 'false')
               ) = 'true'
          then 0
          when coalesce(
            detail_row ->> 'total',
            detail_row ->> 'grossAmount',
            ''
          ) ~ '^-?[0-9]+([.][0-9]+)?$'
          then coalesce(
            detail_row ->> 'total',
            detail_row ->> 'grossAmount'
          )::numeric
          else 0
        end
      ), 0)
        into v_detail_total
      from pg_catalog.jsonb_array_elements(
        v_payload_patch -> 'lazyRows'
      ) detail_row;

      if pg_catalog.abs(v_detail_total - v_amount) > 0.5 then
        raise exception '申請金額與即時明細合計不一致，請先回填總額後再送出'
          using errcode = '23514';
      end if;
    elsif v_expense.type = 'travel_request' then
      if pg_catalog.jsonb_typeof(v_payload_patch -> 'travelInfo')
           <> 'object'
         or pg_catalog.jsonb_typeof(
           v_payload_patch -> 'travelInfo' -> 'rows'
         ) <> 'array'
         or pg_catalog.jsonb_array_length(
           v_payload_patch -> 'travelInfo' -> 'rows'
         ) > 200 then
        raise exception '差旅補件明細格式錯誤或超過 200 筆'
          using errcode = '22023';
      end if;

      select coalesce(pg_catalog.sum(
        case
          when coalesce(detail_row ->> 'amount', '')
            ~ '^-?[0-9]+([.][0-9]+)?$'
          then (detail_row ->> 'amount')::numeric
          else 0
        end
      ), 0)
        into v_detail_total
      from pg_catalog.jsonb_array_elements(
        v_payload_patch -> 'travelInfo' -> 'rows'
      ) detail_row;

      if pg_catalog.abs(v_detail_total - v_amount) > 0.5 then
        raise exception '差旅申請金額與費用明細合計不一致'
          using errcode = '23514';
      end if;
    elsif v_expense.type = 'refund_request' then
      select coalesce(pg_catalog.sum(
        case
          when coalesce(detail_row ->> 'refundAmount', '')
            ~ '^-?[0-9]+([.][0-9]+)?$'
          then (detail_row ->> 'refundAmount')::numeric
          when coalesce(detail_row ->> 'receivedAmount', '')
                 ~ '^-?[0-9]+([.][0-9]+)?$'
           and coalesce(detail_row ->> 'receivableAmount', '')
                 ~ '^-?[0-9]+([.][0-9]+)?$'
          then greatest(
            (detail_row ->> 'receivedAmount')::numeric
              - (detail_row ->> 'receivableAmount')::numeric,
            0
          )
          else 0
        end
      ), 0)
        into v_detail_total
      from pg_catalog.jsonb_array_elements(
        v_payload_patch -> 'refundRows'
      ) detail_row;

      if pg_catalog.abs(v_detail_total - v_amount) > 0.5 then
        raise exception '退費申請金額與退費明細合計不一致'
          using errcode = '23514';
      end if;
    elsif v_expense.type = 'hr_expense_request' then
      select coalesce(pg_catalog.sum(
        case
          when coalesce(
            detail_row ->> '匯款金額',
            detail_row ->> '金額',
            detail_row ->> '轉帳金額',
            ''
          ) ~ '^-?[0-9]+([.][0-9]+)?$'
          then coalesce(
            detail_row ->> '匯款金額',
            detail_row ->> '金額',
            detail_row ->> '轉帳金額'
          )::numeric
          else 0
        end
      ), 0)
        into v_detail_total
      from pg_catalog.jsonb_array_elements(
        v_payload_patch -> 'hrRows'
      ) detail_row;

      if pg_catalog.abs(v_detail_total - v_amount) > 0.5 then
        raise exception '人事費用申請金額與匯款明細合計不一致'
          using errcode = '23514';
      end if;
    end if;

    select coalesce(setting_row.value, '{}'::jsonb)
      into v_routing_policy
    from public.system_settings setting_row
    where setting_row.tenant_id = v_tenant_id
      and setting_row.key = 'approval_routing_policy'
    limit 1;
    v_routing_policy := coalesce(v_routing_policy, '{}'::jsonb);

    v_role_threshold := coalesce(
      nullif(
        v_routing_policy -> 'admin_director' ->>
          case
            when v_is_fixed then 'fixed_min_amount'
            else 'standard_min_amount'
          end,
        ''
      )::numeric,
      10
    );
    if v_expense.type <> 'purchase_request'
       and v_amount >= v_role_threshold
       and not exists (
         select 1
         from pg_catalog.jsonb_array_elements(v_expense.steps) route_step
         where private.finance_income_step_role(route_step) = 'admin_director'
       ) then
      raise exception '修改後金額需要新增行政部門主任關卡；為避免繞過簽核，請由管理者重建流程後再送出'
        using errcode = '55000';
    end if;

    v_role_threshold := coalesce(
      nullif(
        v_routing_policy -> 'ceo' ->>
          case
            when v_is_fixed then 'fixed_min_amount'
            else 'standard_min_amount'
          end,
        ''
      )::numeric,
      10
    );
    if v_amount >= v_role_threshold
       and not exists (
         select 1
         from pg_catalog.jsonb_array_elements(v_expense.steps) route_step
         where private.finance_income_step_role(route_step) = 'ceo'
       ) then
      raise exception '修改後金額需要新增執行長關卡；為避免繞過簽核，請由管理者重建流程後再送出'
        using errcode = '55000';
    end if;

    if not private.finance_expense_new_files_are_owned(
      v_tenant_id,
      v_expense,
      '[]'::jsonb,
      v_files_delta,
      v_actor.id
    ) then
      raise exception '申請附件不屬於目前申請人或這張單'
        using errcode = '42501';
    end if;

    if not private.finance_expense_new_files_are_owned(
      v_tenant_id,
      v_expense,
      '[]'::jsonb,
      v_passbook_files_delta,
      v_actor.id
    ) then
      raise exception '存摺附件不屬於目前申請人或這張單'
        using errcode = '42501';
    end if;

    -- The browser submits only newly uploaded evidence. Existing evidence is
    -- copied from the locked source row and appended server-side, so legacy
    -- metadata can never be reserialized, replaced, reordered, or deleted.
    v_files := v_files || v_files_delta;
    v_passbook_files := v_passbook_files || v_passbook_files_delta;

    v_form_payload := coalesce(v_expense.form_payload, '{}'::jsonb);
    for v_payload_key, v_payload_value in
      select payload.key, payload.value
      from pg_catalog.jsonb_each(v_payload_patch) payload
    loop
      v_form_payload := pg_catalog.jsonb_set(
        v_form_payload,
        array[v_payload_key],
        v_payload_value,
        true
      );
    end loop;

    v_form_payload := pg_catalog.jsonb_set(
      v_form_payload,
      '{passbookFiles}',
      v_passbook_files,
      true
    );

    v_form_payload := (
      v_form_payload
      - 'accountingLines'
      - 'flowStoppedAt'
      - 'flowStoppedReason'
      - 'flowStoppedBy'
      - 'flowStoppedComment'
    ) || pg_catalog.jsonb_build_object(
      'expenseEntity', v_expense.entity_id,
      'expenseDepartment', v_expense.department_code,
      'dataEnvironment', v_expense.data_environment,
      'accountingLinesNeedReview', true,
      'accountingLinesInvalidatedAt', pg_catalog.now(),
      'accountingLinesInvalidatedReason',
        '申請人依退回意見修改原申請內容，會計科目需重新覆核。'
    );

    if v_expense.type = 'purchase_request' then
      v_form_payload := pg_catalog.jsonb_set(
        v_form_payload,
        '{purchaseEstimate}',
        coalesce(v_form_payload -> 'purchaseEstimate', '{}'::jsonb)
          || pg_catalog.jsonb_build_object(
            'requestAmount', v_amount,
            'requestRows', coalesce(
              v_payload_patch -> 'purchaseInfo' -> 'rows',
              v_payload_patch -> 'purchaseRows',
              '[]'::jsonb
            )
          ),
        true
      );
    elsif v_expense.type = 'advance_request' then
      v_form_payload := pg_catalog.jsonb_set(
        v_form_payload,
        '{advanceOriginalAmount}',
        pg_catalog.to_jsonb(v_amount),
        true
      );
    elsif v_expense.type = 'petty_cash_request' then
      v_form_payload := pg_catalog.jsonb_set(
        v_form_payload,
        '{pettyCashAmount}',
        pg_catalog.to_jsonb(v_amount),
        true
      );
    end if;

    v_step_updated := private.finance_income_append_step_action(
      v_step,
      v_actor.id,
      v_actor.name,
      '補件完成並重新送出',
      case
        when v_comment = '' then '已依退回意見修正原申請內容'
        else v_comment
      end,
      p_step_files
    ) || pg_catalog.jsonb_build_object(
      'a', 'approved',
      'n', v_actor.name,
      't', pg_catalog.to_char(
        pg_catalog.timezone('Asia/Taipei', pg_catalog.now()),
        'YYYY/MM/DD'
      )
    );

    v_steps := pg_catalog.jsonb_set(
      v_steps,
      array[v_active_index::text],
      v_step_updated,
      false
    );
    v_status := private.finance_income_status_from_steps(v_steps);

    if coalesce(v_status ->> 'approval_status', '') = 'completed' then
      raise exception '補件重送後缺少下一位簽核人，請先由管理者修正流程'
        using errcode = '55000';
    end if;

    v_updated_at := pg_catalog.now();
    v_previous_write_context := coalesce(
      pg_catalog.current_setting(
        'app.finance_expense_write_context',
        true
      ),
      ''
    );
    perform pg_catalog.set_config(
      'app.finance_expense_write_context',
      'org_resubmit',
      true
    );

    update public.expense_requests
    set amount = v_amount,
        estimated_amount = case
          when type in ('purchase_request', 'advance_request') then v_amount
          else estimated_amount
        end,
        description = pg_catalog.btrim(p_form_patch ->> 'description'),
        payee = nullif(pg_catalog.btrim(p_form_patch ->> 'payee'), ''),
        bank_type = nullif(pg_catalog.btrim(p_form_patch ->> 'bank_type'), ''),
        bank_name = nullif(pg_catalog.btrim(p_form_patch ->> 'bank_name'), ''),
        bank_branch = nullif(pg_catalog.btrim(p_form_patch ->> 'bank_branch'), ''),
        bank_no = nullif(pg_catalog.btrim(p_form_patch ->> 'bank_no'), ''),
        expected_pay_date = v_expected_pay_date,
        bank_account = nullif(
          pg_catalog.btrim(p_form_patch ->> 'bank_account'),
          ''
        ),
        fee_bearer = nullif(
          pg_catalog.btrim(p_form_patch ->> 'fee_bearer'),
          ''
        ),
        bank_fee_amount = v_bank_fee_amount,
        request_date = v_request_date,
        files = v_files,
        petty_mode = nullif(
          pg_catalog.btrim(p_form_patch ->> 'petty_mode'),
          ''
        ),
        form_payload = v_form_payload,
        status = v_status ->> 'approval_status',
        step = (v_status ->> 'approval_step')::integer,
        steps = v_steps,
        ver = coalesce(ver, 1) + 1,
        updated_at = v_updated_at
    where tenant_id = v_tenant_id
      and id = v_expense.id;
    get diagnostics v_row_count = row_count;
    perform pg_catalog.set_config(
      'app.finance_expense_write_context',
      v_previous_write_context,
      true
    );
    if v_row_count <> 1 then
      raise exception '補件重送時資料寫入失敗'
        using errcode = '55000';
    end if;
  end if;

  select pg_catalog.to_jsonb(expense_row)
    into v_after_audit
  from public.expense_requests expense_row
  where expense_row.tenant_id = v_tenant_id
    and expense_row.data_environment = v_environment
    and expense_row.id = v_expense.id;

  if v_after_audit is null then
    raise exception '補件完成後無法讀回正式申請資料'
      using errcode = '55000';
  end if;

  insert into public.module_audit_logs(
    table_name,
    row_id,
    action,
    actor_email,
    before_data,
    after_data
  ) values (
    'expense_requests',
    v_expense.id,
    case
      when v_action = 'cancel'
        then 'APPLICANT_REVISION_CANCEL'
      else 'APPLICANT_REVISION_RESUBMIT'
    end,
    v_actor.email,
    pg_catalog.to_jsonb(v_expense) || pg_catalog.jsonb_build_object(
      '_idempotency_key', p_idempotency_key,
      '_revision_actor_id', v_actor.id
    ),
    v_after_audit || pg_catalog.jsonb_build_object(
      '_idempotency_key', p_idempotency_key,
      '_revision_actor_id', v_actor.id
    )
  );

  v_result := pg_catalog.jsonb_build_object(
    'ok', true,
    'idempotent_replay', false,
    'document_type', 'expense',
    'action', v_action,
    'id', v_expense.id,
    'no', v_expense.no,
    'status', case
      when v_action = 'cancel' then 'cancelled'
      else v_status ->> 'approval_status'
    end,
    'step', case
      when v_action = 'cancel' then v_active_index + 1
      else (v_status ->> 'approval_step')::integer
    end,
    'ver', coalesce(v_expense.ver, 1) + 1,
    'updated_at', v_updated_at
  );

  perform private.finance_income_finish_operation(
    v_tenant_id,
    v_environment,
    'expense_applicant_revision',
    p_idempotency_key,
    v_result
  );

  return v_result;
end;
$function$
;
