-- Read-only production pg_get_functiondef snapshot 2026-10-05; no employee data.
CREATE OR REPLACE FUNCTION public.finance_expense_act_active_step(p_request_ids text[], p_action text, p_idempotency_key text, p_comment text DEFAULT NULL::text, p_files jsonb DEFAULT '[]'::jsonb, p_add_sign_finance_user_id text DEFAULT NULL::text, p_expected_steps jsonb DEFAULT '{}'::jsonb, p_patches jsonb DEFAULT '{}'::jsonb, p_data_environment text DEFAULT 'production'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tenant_id uuid;
  v_actor public.finance_users%rowtype;
  v_target public.finance_users%rowtype;
  v_environment text :=
    pg_catalog.lower(coalesce(p_data_environment, 'production'));
  v_action text := pg_catalog.lower(coalesce(p_action, ''));
  v_comment text := coalesce(pg_catalog.btrim(p_comment), '');
  v_digest text;
  v_cached jsonb;
  v_request_id text;
  v_expense public.expense_requests%rowtype;
  v_steps jsonb;
  v_step jsonb;
  v_expected_step jsonb;
  v_patch jsonb;
  v_step_updated jsonb;
  v_active_index int;
  v_previous_index int;
  v_previous_step jsonb;
  v_role_key text;
  v_permission_context jsonb;
  v_status jsonb;
  v_add_step jsonb;
  v_revision_step jsonb;
  v_form_payload jsonb;
  v_actual_files jsonb;
  v_patch_amount numeric;
  v_patch_lines jsonb;
  v_patch_debit text;
  v_patch_credit text;
  v_is_advance_disbursement_gate boolean := false;
  v_advance_posting jsonb;
  v_advance_posted_at timestamptz;
  v_advance_voucher_id text;
  v_advance_amount numeric;
  v_shareholder_posting jsonb;
  v_shareholder_posted_at timestamptz;
  v_shareholder_voucher_id text;
  v_shareholder_voucher_ids jsonb;
  v_cash_posted_at timestamptz;
  v_updated_at timestamptz;
  v_next_ver int;
  v_row_count int;
  v_previous_write_context text;
  v_result_rows jsonb := '[]'::jsonb;
  v_result jsonb;
begin
  if auth.uid() is null then
    raise exception '請先登入後再處理申請單簽核'
      using errcode = '42501';
  end if;

  if v_environment not in ('production', 'test') then
    raise exception '資料環境只允許 production 或 test'
      using errcode = '22023';
  end if;

  if v_action not in (
       'approve',
       'return',
       'reject',
       'add_sign',
       'withdraw'
     ) then
    raise exception
      '簽核動作只允許 approve、return、reject、add_sign 或 withdraw'
      using errcode = '22023';
  end if;

  if p_request_ids is null
     or pg_catalog.cardinality(p_request_ids) < 1
     or pg_catalog.cardinality(p_request_ids) > 100 then
    raise exception '每次必須處理 1 到 100 張申請單'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from pg_catalog.unnest(p_request_ids) request_id
    where coalesce(pg_catalog.btrim(request_id), '') = ''
  ) then
    raise exception '申請單 ID 不可為空白'
      using errcode = '22023';
  end if;

  if pg_catalog.cardinality(p_request_ids) <> (
    select pg_catalog.count(distinct request_id)
    from pg_catalog.unnest(p_request_ids) request_id
  ) then
    raise exception '同一次簽核不可包含重複的申請單 ID'
      using errcode = '23505';
  end if;

  if pg_catalog.jsonb_typeof(coalesce(p_files, '[]'::jsonb)) <>
       'array'
     or pg_catalog.jsonb_array_length(
       coalesce(p_files, '[]'::jsonb)
     ) > 20
     or exists (
       select 1
       from pg_catalog.jsonb_array_elements(
         coalesce(p_files, '[]'::jsonb)
       ) file_item
       where pg_catalog.jsonb_typeof(file_item) <> 'object'
          or coalesce(
               file_item ->> 'bucket',
               file_item ->> 'storage_bucket',
               ''
             ) <> 'finance-attachments'
          or coalesce(
               file_item ->> 'path',
               file_item ->> 'storagePath',
               file_item ->> 'storage_path',
               ''
             ) !~ '^[A-Za-z0-9._/-]{3,255}[A-Za-z0-9._/-]{0,255}[A-Za-z0-9._/-]{0,255}[A-Za-z0-9._/-]{0,135}$'
          or coalesce(
               file_item ->> 'path',
               file_item ->> 'storagePath',
               file_item ->> 'storage_path',
               ''
             ) ~ '(^|/)[.][.]?(/|$)'
          or coalesce(
               file_item ->> 'dataEnv',
               file_item ->> 'data_environment',
               ''
             ) <> v_environment
     ) then
    raise exception '附件資料格式錯誤或超過 20 個'
      using errcode = '22023';
  end if;

  if pg_catalog.jsonb_typeof(coalesce(p_expected_steps, '{}'::jsonb)) <>
       'object'
     or (
       select pg_catalog.count(*)
       from pg_catalog.jsonb_object_keys(
         coalesce(p_expected_steps, '{}'::jsonb)
       )
     ) <> pg_catalog.cardinality(p_request_ids)
     or exists (
       select 1
       from pg_catalog.jsonb_object_keys(
         coalesce(p_expected_steps, '{}'::jsonb)
       ) as expected_request(expected_request_id)
       where not (
         expected_request.expected_request_id = any(p_request_ids)
       )
     ) then
    raise exception '申請單預期關卡資料不完整，請重新整理後再處理'
      using errcode = '40001';
  end if;

  if pg_catalog.jsonb_typeof(coalesce(p_patches, '{}'::jsonb)) <>
       'object'
     or exists (
       select 1
       from pg_catalog.jsonb_object_keys(
         coalesce(p_patches, '{}'::jsonb)
       ) as patch_request(patch_request_id)
       where not (
         patch_request.patch_request_id = any(p_request_ids)
       )
     ) then
    raise exception '申請單核准修訂資料格式錯誤'
      using errcode = '22023';
  end if;

  if v_action in ('return', 'reject', 'add_sign', 'withdraw')
     and v_comment = '' then
    raise exception '退回、不通過、加簽或抽單必須填寫原因'
      using errcode = '22023';
  end if;

  if v_action = 'add_sign'
     and coalesce(p_add_sign_finance_user_id, '') = '' then
    raise exception '加簽必須指定人員'
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

  if v_action = 'add_sign' then
    select finance_user.*
      into v_target
    from public.finance_users finance_user
    where finance_user.tenant_id = v_tenant_id
      and finance_user.id = p_add_sign_finance_user_id
      and finance_user.active is true
      and finance_user.auth_user_id is not null
    limit 1;

    if not found then
      raise exception
        '指定的加簽人不存在、已停用、尚未完成 Google 登入或不屬於目前租戶'
        using errcode = '23503';
    end if;

    if v_target.id = v_actor.id then
      raise exception '不可加簽自己'
        using errcode = '22023';
    end if;
  end if;

  v_digest := private.finance_income_request_digest(
    pg_catalog.jsonb_build_object(
      'operation', 'expense_action',
      'environment', v_environment,
      'request_ids', pg_catalog.to_jsonb(p_request_ids),
      'action', v_action,
      'comment', v_comment,
      'files', coalesce(p_files, '[]'::jsonb),
      'add_sign_finance_user_id', p_add_sign_finance_user_id,
      'expected_steps', coalesce(p_expected_steps, '{}'::jsonb),
      'patches', coalesce(p_patches, '{}'::jsonb)
    )
  );

  v_cached := private.finance_income_begin_operation(
    v_tenant_id,
    v_environment,
    'expense_action',
    p_idempotency_key,
    v_digest,
    v_actor.id
  );

  if v_cached is not null then
    return v_cached || pg_catalog.jsonb_build_object(
      'idempotent_replay',
      true
    );
  end if;

  for v_request_id in
    select request_id
    from pg_catalog.unnest(p_request_ids) request_id
    order by request_id
  loop
    select expense_row.*
      into v_expense
    from public.expense_requests expense_row
    where expense_row.tenant_id = v_tenant_id
      and expense_row.data_environment = v_environment
      and expense_row.id = v_request_id
    for update;

    if not found then
      raise exception '申請單不存在或不屬於目前租戶：%',
        v_request_id
        using errcode = 'P0002';
    end if;

    if v_expense.posting_locked_at is not null
       or v_expense.voided_at is not null
       or v_expense.ledger_posted_at is not null
       or coalesce(v_expense.voucher_id, '') <> ''
       or v_expense.status in (
         'completed',
         'paid',
         'settled',
         'closed',
         'rejected',
         'cancelled'
       ) then
      raise exception '申請單已結案、作廢或入帳，不能再執行簽核：%',
        v_request_id
        using errcode = '55000';
    end if;

    v_steps := coalesce(v_expense.steps, '[]'::jsonb);
    if pg_catalog.jsonb_typeof(v_steps) <> 'array' then
      raise exception '申請單簽核步驟格式錯誤：%', v_request_id
        using errcode = '22023';
    end if;

    v_active_index :=
      private.finance_income_active_step_index(v_steps);
    if v_active_index is null then
      raise exception '申請單沒有待處理的簽核步驟：%', v_request_id
        using errcode = '55000';
    end if;

    v_step := v_steps -> v_active_index;
    v_role_key := private.finance_income_step_role(v_step);
    v_is_advance_disbursement_gate :=
      coalesce(v_expense.type, '') = 'advance_request'
      and (
        v_role_key = 'cashier'
        or (
          v_role_key = 'ceo'
          and not exists (
            select 1
            from pg_catalog.jsonb_array_elements(v_steps)
              workflow_step
            where private.finance_income_step_role(workflow_step) =
                  'cashier'
          )
        )
      );
    v_expected_step := p_expected_steps -> v_request_id;

    if pg_catalog.jsonb_typeof(v_expected_step) <> 'object'
       or coalesce(
            (v_expected_step ->> 'active_step_index')::int,
            -1
          ) <> v_active_index
       or coalesce(v_expected_step ->> 'role_key', '')
            <> coalesce(v_role_key, '')
       or coalesce(v_expected_step ->> 'finance_user_id', '')
            <> coalesce(
              private.finance_income_step_user_id(v_step),
              ''
            )
       or pg_catalog.lower(
            coalesce(v_expected_step ->> 'email', '')
          ) <> pg_catalog.lower(coalesce(v_step ->> 'email', ''))
       or coalesce(v_expected_step ->> 'status', '')
            <> coalesce(v_expense.status, '')
       or coalesce((v_expected_step ->> 'step')::int, -1)
            <> coalesce(v_expense.step, -1)
       or coalesce((v_expected_step ->> 'ver')::int, -1)
            <> coalesce(v_expense.ver, 1)
       or nullif(v_expected_step ->> 'updated_at', '')::timestamptz
            is distinct from v_expense.updated_at then
      raise exception
        '申請單簽核關卡已被其他操作更新，請重新整理後再處理：%',
        v_request_id
        using errcode = '40001';
    end if;

    if not private.finance_expense_new_files_are_owned(
      v_tenant_id,
      v_expense,
      '[]'::jsonb,
      coalesce(p_files, '[]'::jsonb),
      v_actor.id
    ) then
      raise exception
        '簽核附件不屬於目前租戶、申請單或處理人：%',
        v_request_id
        using errcode = '42501';
    end if;

    if v_role_key = 'applicant_revision'
       and v_action <> 'withdraw' then
      raise exception
        '申請單目前為申請人補件，請使用補件完成並重新送出功能：%',
        v_request_id
        using errcode = '55000';
    end if;

    if v_expense.status = 'pending_voucher'
       and v_action = 'approve' then
      raise exception
        '最終憑據確認必須使用交易式入帳功能：%',
        v_request_id
        using errcode = '55000';
    end if;

    if v_action = 'reject'
       and (
         v_expense.status in (
           'pending_applicant_confirm',
           'pending_voucher'
         )
         or v_expense.cash_posted_at is not null
       ) then
      raise exception
        '款項已撥付或已進入收據／入帳階段，不可直接不通過；請使用退回補件或會計沖銷流程：%',
        v_request_id
        using errcode = '55000';
    end if;

    if v_action = 'add_sign'
       and v_target.id = v_expense.applicant_id then
      raise exception '不可將原申請人設為加簽人：%',
        v_request_id
        using errcode = '22023';
    end if;
    if v_action = 'add_sign'
       and v_is_advance_disbursement_gate then
      raise exception
        '預支出納撥款關卡不可同時核准並加簽；請先完成加簽安排，再單獨核准撥款：%',
        v_request_id
        using errcode = '55000';
    end if;

    if v_action = 'withdraw' then
      if v_actor.id <> v_expense.applicant_id
         or v_expense.cash_posted_at is not null
         or v_expense.ledger_posted_at is not null
         or v_expense.posting_locked_at is not null
         or coalesce(v_expense.voucher_id, '') <> ''
         or exists (
           select 1
           from pg_catalog.jsonb_array_elements(v_steps)
             workflow_step
           where private.finance_income_step_role(workflow_step) in (
             'ceo',
             'cashier'
           )
             and coalesce(workflow_step ->> 'a', '') = 'approved'
         ) then
        raise exception
          '只有原申請人可在款項撥付前抽單：%',
          v_request_id
          using errcode = '42501';
      end if;
    elsif not private.finance_expense_actor_can_act(
        v_tenant_id,
        v_expense,
        v_active_index,
        v_step,
        v_actor.id,
        v_actor.email,
        v_actor.role
      ) then
        raise exception '您不是申請單目前待簽步驟的有效處理人：%',
          v_request_id
          using errcode = '42501';
    end if;

    v_permission_context := pg_catalog.jsonb_build_object(
      'assignee_finance_user_id', v_actor.id,
      'owner_finance_user_id', v_expense.applicant_id,
      'department_code', v_expense.department_code,
      'company_id', v_expense.entity_id,
      'entity_id', v_expense.entity_id,
      'resource_type', 'expense_request',
      'resource_id', v_expense.id,
      'workflow_step_key', v_role_key
    );

    if v_action = 'withdraw' then
      if not private.finance_expense_optional_permission_allows(
        v_tenant_id,
        v_actor.id,
        'finance.request.withdraw',
        v_permission_context
      ) then
        raise exception '目前人員權限不允許抽單'
          using errcode = '42501';
      end if;
    elsif v_role_key not in (
      'applicant_confirm',
      'applicant_revision'
    ) then
      if not private.finance_expense_optional_permission_allows(
        v_tenant_id,
        v_actor.id,
        case
          when v_action in ('return', 'reject')
            then 'finance.approval.reject'
          else 'finance.approval.approve'
        end,
        v_permission_context
      ) then
        raise exception '目前人員權限不允許執行此簽核動作'
          using errcode = '42501';
      end if;

      if v_action = 'add_sign' then
        if not private.finance_expense_optional_permission_allows(
          v_tenant_id,
          v_actor.id,
          'finance.approval.add_sign',
          v_permission_context
        ) then
          raise exception '目前人員權限不允許新增加簽'
            using errcode = '42501';
        end if;
      end if;
    end if;

    v_patch := coalesce(p_patches -> v_request_id, '{}'::jsonb);
    if pg_catalog.jsonb_typeof(v_patch) <> 'object'
       or exists (
         select 1
         from pg_catalog.jsonb_object_keys(v_patch)
           as patch_field(patch_key)
         where patch_field.patch_key not in (
           'amount',
           'debit_account',
           'debit_account_name',
           'credit_account',
           'credit_account_name',
           'accounting_lines',
           'accounting_line_policy'
         )
       ) then
      raise exception '申請單核准修訂包含不允許的欄位：%',
        v_request_id
        using errcode = '22023';
    end if;

    v_shareholder_posting := null;
    v_advance_posting := null;

    if v_patch <> '{}'::jsonb then
      if v_action not in ('approve', 'add_sign')
         or v_role_key not in (
           'accountant',
           'accountant_final',
           'admin_director',
           'ceo'
         ) then
        raise exception '目前角色或動作不可修訂申請單會計明細：%',
          v_request_id
          using errcode = '42501';
      end if;

      if not private.finance_expense_optional_permission_allows(
        v_tenant_id,
        v_actor.id,
        'finance.accounting.subject.edit',
        v_permission_context
      ) then
        raise exception '目前人員權限不允許修改會計科目'
          using errcode = '42501';
      end if;

      if not (
        v_patch ?& array[
          'amount',
          'debit_account',
          'debit_account_name',
          'credit_account',
          'credit_account_name',
          'accounting_lines',
          'accounting_line_policy'
        ]
      ) then
        raise exception '申請單核准修訂欄位不完整：%',
          v_request_id
          using errcode = '22023';
      end if;

      v_patch_amount := (v_patch ->> 'amount')::numeric;
      v_patch_debit :=
        pg_catalog.btrim(v_patch ->> 'debit_account');
      v_patch_credit :=
        pg_catalog.btrim(v_patch ->> 'credit_account');
      v_patch_lines := v_patch -> 'accounting_lines';

      if v_patch_amount < 0
         or coalesce(v_patch_debit, '') !~ '^[A-Za-z0-9._-]{2,20}$'
         or coalesce(v_patch_credit, '') !~ '^[A-Za-z0-9._-]{2,20}$'
         or coalesce(
           pg_catalog.btrim(v_patch ->> 'debit_account_name'),
           ''
         ) = ''
         or coalesce(
           pg_catalog.btrim(v_patch ->> 'credit_account_name'),
           ''
         ) = ''
         or pg_catalog.length(
           v_patch ->> 'accounting_line_policy'
         ) > 100
         or pg_catalog.jsonb_typeof(v_patch_lines) <> 'array'
         or pg_catalog.jsonb_array_length(v_patch_lines) < 1
         or pg_catalog.jsonb_array_length(v_patch_lines) > 200 then
        raise exception '申請單核准修訂的金額或科目格式錯誤：%',
          v_request_id
          using errcode = '22023';
      end if;

      if exists (
        select 1
        from pg_catalog.jsonb_array_elements(v_patch_lines) line_item
        where pg_catalog.jsonb_typeof(line_item) <> 'object'
           or coalesce(line_item ->> 'grossAmount', '') !~
                '^[0-9]+([.][0-9]{1,4})?$'
           or coalesce(line_item ->> 'netAmount', '') !~
                '^[0-9]+([.][0-9]{1,4})?$'
           or coalesce(line_item ->> 'taxAmount', '') !~
                '^[0-9]+([.][0-9]{1,4})?$'
           or pg_catalog.abs(
                (line_item ->> 'grossAmount')::numeric
                - (
                  (line_item ->> 'netAmount')::numeric
                  + (line_item ->> 'taxAmount')::numeric
                )
              ) > 0.01
           or coalesce(line_item ->> 'debitAccount', '') !~
                '^[A-Za-z0-9._-]{2,20}$'
           or coalesce(line_item ->> 'creditAccount', '') !~
                '^[A-Za-z0-9._-]{2,20}$'
           or coalesce(
                pg_catalog.btrim(
                  line_item ->> 'debitAccountName'
                ),
                ''
              ) = ''
           or coalesce(
                pg_catalog.btrim(
                  line_item ->> 'creditAccountName'
                ),
                ''
              ) = ''
      ) then
        raise exception '申請單會計明細列格式或借貸金額錯誤：%',
          v_request_id
          using errcode = '22023';
      end if;

      if pg_catalog.abs(
        (
          select coalesce(
            pg_catalog.sum(
              (line_item ->> 'grossAmount')::numeric
            ),
            0
          )
          from pg_catalog.jsonb_array_elements(v_patch_lines)
            line_item
        ) - v_patch_amount
      ) > 0.01 then
        raise exception '申請單會計明細總額與申請金額不一致：%',
          v_request_id
          using errcode = '23514';
      end if;

      if exists (
        select 1
        from (
          select
            v_patch_debit as account_code,
            pg_catalog.btrim(
              v_patch ->> 'debit_account_name'
            ) as account_name
          union
          select
            v_patch_credit,
            pg_catalog.btrim(
              v_patch ->> 'credit_account_name'
            )
          union
          select
            line_item ->> 'debitAccount',
            pg_catalog.btrim(
              line_item ->> 'debitAccountName'
            )
          from pg_catalog.jsonb_array_elements(v_patch_lines)
            line_item
          union
          select
            line_item ->> 'creditAccount',
            pg_catalog.btrim(
              line_item ->> 'creditAccountName'
            )
          from pg_catalog.jsonb_array_elements(v_patch_lines)
            line_item
        ) requested_account
        where not exists (
          select 1
          from public.system_settings setting_row
          cross join lateral pg_catalog.jsonb_array_elements(
            case
              when pg_catalog.jsonb_typeof(setting_row.value) =
                   'array'
                then setting_row.value
              else '[]'::jsonb
            end
          ) configured_account
          where setting_row.tenant_id = v_tenant_id
            and setting_row.key = 'accounts'
            and configured_account ->> 'c' =
                requested_account.account_code
            and pg_catalog.btrim(
              configured_account ->> 'n'
            ) = requested_account.account_name
            and coalesce(
              (configured_account ->> 'on')::boolean,
              true
            )
        )
      ) then
        raise exception '申請單核准修訂包含不存在、已停用或名稱不一致的會計科目：%',
          v_request_id
          using errcode = '23503';
      end if;
    end if;

    v_form_payload := coalesce(v_expense.form_payload, '{}'::jsonb);
    v_actual_files := case
      when pg_catalog.jsonb_typeof(v_expense.actual_files) = 'array'
        then v_expense.actual_files
      else '[]'::jsonb
    end;
    v_cash_posted_at := v_expense.cash_posted_at;

    if v_expense.type = 'advance_request'
       and v_role_key = 'applicant_confirm'
       and v_action in ('approve', 'add_sign') then
      if pg_catalog.jsonb_array_length(
           coalesce(p_files, '[]'::jsonb)
         ) < 2
         or exists (
           select 1
           from pg_catalog.jsonb_array_elements(p_files) file_item
           where not exists (
             select 1
             from public.file_attachments attachment_row
             join storage.objects storage_object
               on storage_object.bucket_id =
                    attachment_row.bucket_id
              and storage_object.name =
                    attachment_row.storage_path
             where attachment_row.tenant_id = v_tenant_id
               and attachment_row.bucket_id =
                   'finance-attachments'
               and attachment_row.storage_path = coalesce(
                 file_item ->> 'path',
                 file_item ->> 'storagePath',
                 file_item ->> 'storage_path'
               )
               and attachment_row.record_type =
                   'expense_requests'
               and attachment_row.record_no = v_expense.no
               and attachment_row.data_environment =
                   v_environment
               and attachment_row.uploaded_by = v_actor.id
           )
         )
         or not exists (
           select 1
           from pg_catalog.jsonb_array_elements(p_files) file_item
           join public.file_attachments attachment_row
             on attachment_row.tenant_id = v_tenant_id
            and attachment_row.bucket_id = 'finance-attachments'
            and attachment_row.storage_path = coalesce(
              file_item ->> 'path',
              file_item ->> 'storagePath',
              file_item ->> 'storage_path'
            )
            and attachment_row.record_type = 'expense_requests'
            and attachment_row.record_no = v_expense.no
            and attachment_row.data_environment = v_environment
            and attachment_row.uploaded_by = v_actor.id
           where pg_catalog.lower(
             coalesce(attachment_row.file_name, '') || ' ' ||
             coalesce(attachment_row.file_type, '')
           ) ~ '(pdf|image|jpg|jpeg|png|heic|webp)'
         )
         or not exists (
           select 1
           from pg_catalog.jsonb_array_elements(p_files) file_item
           join public.file_attachments attachment_row
             on attachment_row.tenant_id = v_tenant_id
            and attachment_row.bucket_id = 'finance-attachments'
            and attachment_row.storage_path = coalesce(
              file_item ->> 'path',
              file_item ->> 'storagePath',
              file_item ->> 'storage_path'
            )
            and attachment_row.record_type = 'expense_requests'
            and attachment_row.record_no = v_expense.no
            and attachment_row.data_environment = v_environment
            and attachment_row.uploaded_by = v_actor.id
           where pg_catalog.lower(
             coalesce(attachment_row.file_name, '') || ' ' ||
             coalesce(attachment_row.file_type, '')
           ) ~ '(xls|xlsx|csv|spreadsheet|excel)'
         ) then
        raise exception
          '預支申請確認必須同時附最後憑據與 Excel/CSV 明細：%',
          v_request_id
          using errcode = '22023';
      end if;

      v_actual_files :=
        v_actual_files || coalesce(p_files, '[]'::jsonb);
      v_form_payload := v_form_payload ||
        pg_catalog.jsonb_build_object(
          'advanceFinalFiles',
          v_actual_files,
          'advanceFinalEvidenceSubmittedAt',
          pg_catalog.now(),
          'advanceFinalEvidenceSubmittedBy',
          v_actor.name
        );
    end if;

    if v_patch <> '{}'::jsonb then
      v_form_payload :=
        (
          v_form_payload
          - 'accountingLinesNeedReview'
          - 'accountingLinesInvalidatedAt'
          - 'accountingLinesInvalidatedReason'
        )
        || pg_catalog.jsonb_build_object(
          'accountingLines', v_patch_lines,
          'accountingLinePolicy',
            v_patch ->> 'accounting_line_policy'
        );
    end if;

    if v_action = 'withdraw' then
      v_step_updated := private.finance_income_append_step_action(
        v_step,
        v_actor.id,
        v_actor.name,
        '申請人自行抽單',
        v_comment,
        p_files
      ) || pg_catalog.jsonb_build_object('a', 'cancelled');

      v_steps := pg_catalog.jsonb_set(
        v_steps,
        array[v_active_index::text],
        v_step_updated,
        false
      );
      v_form_payload := v_form_payload ||
        pg_catalog.jsonb_build_object(
          'cancelledAt', pg_catalog.now(),
          'cancelledBy', v_actor.name,
          'cancelReason', v_comment
        );
    elsif v_action in ('approve', 'add_sign') then
      -- A final-voucher countersign is inserted before the final accounting
      -- gate and does not approve that gate.  After the countersign completes,
      -- the request returns to pending_voucher and finalize_expense_request.
      if v_action = 'add_sign'
         and v_expense.status = 'pending_voucher' then
        v_step_updated := private.finance_income_append_step_action(
          v_step,
          v_actor.id,
          v_actor.name,
          '送出加簽（保留最終入帳關）',
          v_comment,
          p_files
        ) - 'n' - 't';

        v_steps := pg_catalog.jsonb_set(
          v_steps,
          array[v_active_index::text],
          v_step_updated,
          false
        );

        v_add_step := pg_catalog.jsonb_build_object(
          'r', '加簽：' || v_target.name,
          'rk', 'assigned_user',
          'uid', v_target.id,
          'n', '',
          'a', '',
          't', '',
          'c', '加簽原因：' || v_comment,
          'files', '[]'::jsonb,
          'status', 'pending_countersign',
          'requestedBy', v_actor.name
        );

        v_steps := pg_catalog.jsonb_insert(
          v_steps,
          array[v_active_index::text],
          v_add_step,
          false
        );
      else
        v_step_updated := private.finance_income_append_step_action(
          v_step,
          v_actor.id,
          v_actor.name,
          case
            when v_action = 'add_sign'
              then '簽核通過並加簽'
            else '簽核通過'
          end,
          v_comment,
          p_files
        ) || pg_catalog.jsonb_build_object('a', 'approved');

        v_steps := pg_catalog.jsonb_set(
          v_steps,
          array[v_active_index::text],
          v_step_updated,
          false
        );

        if v_action = 'add_sign' then
          v_add_step := pg_catalog.jsonb_build_object(
            'r', '加簽：' || v_target.name,
            'rk', 'assigned_user',
            'uid', v_target.id,
            'n', '',
            'a', '',
            't', '',
            'c', '加簽原因：' || v_comment,
            'files', '[]'::jsonb,
            'status', 'pending_countersign',
            'requestedBy', v_actor.name
          );

          v_steps := pg_catalog.jsonb_insert(
            v_steps,
            array[v_active_index::text],
            v_add_step,
            true
          );
        end if;

        if v_role_key = 'cashier'
           or (
             v_role_key = 'ceo'
             and not exists (
               select 1
               from pg_catalog.jsonb_array_elements(v_steps)
                 workflow_step
               where private.finance_income_step_role(workflow_step) =
                     'cashier'
             )
           ) then
          v_cash_posted_at :=
            coalesce(v_cash_posted_at, pg_catalog.now());
          v_form_payload := v_form_payload ||
            pg_catalog.jsonb_build_object(
              'cashPostedAt', v_cash_posted_at,
              'cashPostedBy', v_actor.name,
              'cashPostedRole',
                case
                  when v_role_key = 'cashier' then 'cashier'
                  else 'legacy_ceo'
                end,
              'cashPostingRule',
                case
                  when v_role_key = 'cashier'
                    then 'cash_flow_posts_after_cashier_disbursement'
                  else 'legacy_cash_flow_posts_after_ceo_approval'
                end,
              'cashAmount',
                coalesce(
                  v_expense.estimated_amount,
                  v_expense.amount,
                  0
                ) + greatest(
                  coalesce(v_expense.bank_fee_amount, 0),
                  0
                )
            );
        end if;
      end if;
    elsif v_action = 'reject' then
      v_step_updated := private.finance_income_append_step_action(
        v_step,
        v_actor.id,
        v_actor.name,
        '不通過',
        v_comment,
        p_files
      ) || pg_catalog.jsonb_build_object(
        'a',
        'rejected_all'
      );

      v_steps := pg_catalog.jsonb_set(
        v_steps,
        array[v_active_index::text],
        v_step_updated,
        false
      );

      v_form_payload := v_form_payload ||
        pg_catalog.jsonb_build_object(
          'flowStoppedAt', pg_catalog.now(),
          'flowStoppedReason', 'rejected_all',
          'flowStoppedBy', v_actor.name,
          'flowStoppedComment', v_comment
        );
    else
      v_previous_index := v_active_index - 1;
      while v_previous_index >= 0 loop
        v_previous_step := v_steps -> v_previous_index;
        exit when pg_catalog.lower(
          coalesce(v_previous_step ->> 'autoSkip', 'false')
        ) <> 'true';
        v_previous_index := v_previous_index - 1;
      end loop;

      if v_previous_index < 0 then
        raise exception '申請單目前沒有可退回的上一關：%',
          v_request_id
          using errcode = '55000';
      end if;

      v_previous_step := v_steps -> v_previous_index;
      if v_cash_posted_at is not null
         and (
           private.finance_income_step_role(v_previous_step) =
             'cashier'
           or (
             private.finance_income_step_role(v_previous_step) =
               'ceo'
             and not exists (
               select 1
               from pg_catalog.jsonb_array_elements(v_steps)
                 workflow_step
               where private.finance_income_step_role(workflow_step) =
                     'cashier'
             )
           )
         ) then
        raise exception
          '款項已撥付，不可退回並重新開啟出納關卡；如需追回或更正款項，請使用會計沖銷流程：%',
          v_request_id
          using errcode = '55000';
      end if;

      v_form_payload :=
        (v_form_payload - 'accountingLines')
        || pg_catalog.jsonb_build_object(
          'accountingLinesNeedReview', true,
          'accountingLinesInvalidatedAt', pg_catalog.now(),
          'accountingLinesInvalidatedReason',
            '簽核退回上一關，內容或附件可能異動，會計科目需重新覆核。'
        );

      v_step_updated := private.finance_income_append_step_action(
        v_step,
        v_actor.id,
        v_actor.name,
        '退回上一關',
        v_comment,
        p_files
      );

      v_steps := pg_catalog.jsonb_set(
        v_steps,
        array[v_active_index::text],
        v_step_updated,
        false
      );
      v_previous_step := v_steps -> v_previous_index;

      if private.finance_income_step_role(v_previous_step) =
         'applicant_submit' then
        if coalesce(v_expense.applicant_id, '') = '' then
          raise exception '申請單缺少原申請人，無法建立補件關卡：%',
            v_request_id
            using errcode = '55000';
        end if;

        v_revision_step := pg_catalog.jsonb_build_object(
          'r', '申請人補件後重新送出',
          'rk', 'applicant_revision',
          'uid', v_expense.applicant_id,
          'n', '',
          'a', '',
          't', '',
          'c', '',
          'files', '[]'::jsonb,
          'status', 'pending_applicant_confirm'
        );

        v_revision_step := private.finance_income_append_step_action(
          v_revision_step,
          v_actor.id,
          v_actor.name,
          '退回上一關',
          v_comment,
          p_files
        ) - 'n' - 't';

        v_steps := pg_catalog.jsonb_insert(
          v_steps,
          array[v_active_index::text],
          v_revision_step,
          false
        );
      else
        v_previous_step := private.finance_income_append_step_action(
          v_previous_step - 'a' - 'n' - 't',
          v_actor.id,
          v_actor.name,
          '退回上一關',
          v_comment,
          p_files
        ) - 'a' - 'n' - 't';

        v_steps := pg_catalog.jsonb_set(
          v_steps,
          array[v_previous_index::text],
          v_previous_step,
          false
        );
      end if;
    end if;

    if v_action = 'reject' then
      v_status := pg_catalog.jsonb_build_object(
        'approval_status', 'rejected',
        'approval_step', v_active_index + 1
      );
    elsif v_action = 'withdraw' then
      v_status := pg_catalog.jsonb_build_object(
        'approval_status', 'cancelled',
        'approval_step', v_active_index + 1
      );
    else
      v_status := private.finance_income_status_from_steps(v_steps);
    end if;

    if v_action in ('approve', 'add_sign')
       and v_status ->> 'approval_status' = 'completed'
       and coalesce(v_expense.type, '') <>
           'shareholder_transaction' then
      raise exception
        '申請單流程缺少最後會計入帳關卡，已停止完成；請先修正簽核路線後再處理：%',
        v_request_id
        using errcode = '55000';
    end if;

    -- Scope the trigger bypass to this single controlled UPDATE.  Restoring
    -- immediately prevents a caller-owned transaction from piggybacking a
    -- later direct UPDATE on the RPC's transaction-local marker.
    v_previous_write_context := coalesce(
      pg_catalog.current_setting(
        'app.finance_expense_write_context',
        true
      ),
      ''
    );
    perform pg_catalog.set_config(
      'app.finance_expense_write_context',
      'active_step',
      true
    );

    update public.expense_requests expense_row
       set steps = v_steps,
           status = v_status ->> 'approval_status',
           step = (v_status ->> 'approval_step')::int,
           ver = coalesce(v_expense.ver, 1) + 1,
           amount = case
             when v_patch <> '{}'::jsonb then v_patch_amount
             else v_expense.amount
           end,
           debit_account = case
             when v_patch <> '{}'::jsonb then v_patch_debit
             else v_expense.debit_account
           end,
           debit_account_name = case
             when v_patch <> '{}'::jsonb
               then v_patch ->> 'debit_account_name'
             else v_expense.debit_account_name
           end,
           credit_account = case
             when v_patch <> '{}'::jsonb then v_patch_credit
             else v_expense.credit_account
           end,
           credit_account_name = case
             when v_patch <> '{}'::jsonb
               then v_patch ->> 'credit_account_name'
             else v_expense.credit_account_name
           end,
           form_payload = v_form_payload,
           actual_files = v_actual_files,
           cash_posted_at = v_cash_posted_at,
           updated_at = pg_catalog.now()
     where expense_row.tenant_id = v_tenant_id
       and expense_row.data_environment = v_environment
       and expense_row.id = v_request_id
     returning expense_row.updated_at, expense_row.ver
       into v_updated_at, v_next_ver;

    get diagnostics v_row_count = row_count;
    perform pg_catalog.set_config(
      'app.finance_expense_write_context',
      v_previous_write_context,
      true
    );

    if v_row_count <> 1 then
      raise exception '申請單簽核狀態寫入失敗：%',
        v_request_id
        using errcode = '55000';
    end if;

    if v_action = 'approve'
       and v_is_advance_disbursement_gate then
      if pg_catalog.to_regprocedure(
           'private.finance_post_advance_disbursement_internal(uuid,text,timestamp with time zone,text)'
         ) is null then
        raise exception
          '預支撥款原子入帳功能尚未上線，已停止核准；請套用第 131 列資料庫更新'
          using errcode = '55000';
      end if;

      execute
        'select private.finance_post_advance_disbursement_internal(
           $1, $2, $3, $4
         )'
        into v_advance_posting
        using
          v_tenant_id,
          v_request_id,
          pg_catalog.now(),
          v_actor.name;

      v_advance_voucher_id :=
        nullif(v_advance_posting ->> 'voucher_id', '');
      v_advance_posted_at :=
        nullif(
          v_advance_posting ->> 'posted_at',
          ''
        )::timestamptz;
      v_advance_amount :=
        nullif(v_advance_posting ->> 'amount', '')::numeric;
      if coalesce(
           (v_advance_posting ->> 'ok')::boolean,
           false
         ) is not true
         or v_advance_voucher_id is null
         or v_advance_posted_at is null
         or v_advance_amount is null
         or v_advance_amount <= 0
         or v_advance_amount <> coalesce(
           v_expense.estimated_amount,
           case
             when v_patch <> '{}'::jsonb then v_patch_amount
             else v_expense.amount
           end
         ) then
        raise exception
          '預支撥款入帳未回傳與鎖定申請一致的憑證或金額，已取消本次核准'
          using errcode = '55000';
      end if;

      v_previous_write_context := coalesce(
        pg_catalog.current_setting(
          'app.finance_expense_write_context',
          true
        ),
        ''
      );
      perform pg_catalog.set_config(
        'app.finance_expense_write_context',
        'active_step',
        true
      );

      update public.expense_requests expense_row
         set cash_posted_at = v_advance_posted_at,
             estimated_amount = v_advance_amount,
             form_payload = coalesce(
               expense_row.form_payload,
               '{}'::jsonb
             ) || pg_catalog.jsonb_build_object(
               'advanceOriginalAmount',
                 v_advance_amount,
               'advanceDisbursementAmount',
                 v_advance_amount,
               'advanceDisbursementBankFee',
                 greatest(
                   coalesce(v_expense.bank_fee_amount, 0),
                   0
                 ),
               'advanceDisbursementPostedAt',
                 v_advance_posted_at,
               'advanceDisbursementVoucherId',
                 v_advance_voucher_id,
               'advanceAccountingStage',
                 'disbursed_as_temporary_payment'
             ),
             ver = v_next_ver + 1,
             updated_at = pg_catalog.now()
       where expense_row.tenant_id = v_tenant_id
         and expense_row.data_environment = v_environment
         and expense_row.id = v_request_id
         and expense_row.type = 'advance_request'
         and expense_row.ver = v_next_ver
         and expense_row.cash_posted_at is not null
         and expense_row.ledger_posted_at is null
         and expense_row.posting_locked_at is null
         and coalesce(expense_row.voucher_id, '') = ''
       returning expense_row.updated_at, expense_row.ver
         into v_updated_at, v_next_ver;

      get diagnostics v_row_count = row_count;
      perform pg_catalog.set_config(
        'app.finance_expense_write_context',
        v_previous_write_context,
        true
      );

      if v_row_count <> 1 then
        raise exception
          '預支撥款入帳結果寫回失敗，已取消本次核准'
          using errcode = '55000';
      end if;
    end if;

    if v_status ->> 'approval_status' = 'completed'
       and coalesce(v_expense.type, '') =
           'shareholder_transaction' then
      if pg_catalog.to_regprocedure(
           'private.finance_post_shareholder_transaction_internal(uuid,text,timestamp with time zone,text)'
         ) is null then
        raise exception
          '股東或跨法人交易原子入帳功能尚未上線，已停止完成；請套用第 131 列資料庫更新'
          using errcode = '55000';
      end if;

      execute
        'select private.finance_post_shareholder_transaction_internal(
           $1, $2, $3, $4
         )'
        into v_shareholder_posting
        using
          v_tenant_id,
          v_request_id,
          pg_catalog.now(),
          v_actor.name;

      v_shareholder_voucher_id :=
        nullif(v_shareholder_posting ->> 'voucher_id', '');
      v_shareholder_voucher_ids := coalesce(
        v_shareholder_posting -> 'voucher_ids',
        '[]'::jsonb
      );
      v_shareholder_posted_at :=
        nullif(
          v_shareholder_posting ->> 'posted_at',
          ''
        )::timestamptz;
      if coalesce(
           (v_shareholder_posting ->> 'ok')::boolean,
           false
         ) is not true
         or v_shareholder_voucher_id is null
         or pg_catalog.jsonb_typeof(v_shareholder_voucher_ids) <>
            'array'
         or pg_catalog.jsonb_array_length(
           v_shareholder_voucher_ids
         ) < 1
         or v_shareholder_posted_at is null then
        raise exception
          '股東或跨法人交易入帳未回傳完整憑證，已取消本次核准'
          using errcode = '55000';
      end if;

      v_previous_write_context := coalesce(
        pg_catalog.current_setting(
          'app.finance_expense_write_context',
          true
        ),
        ''
      );
      perform pg_catalog.set_config(
        'app.finance_expense_write_context',
        'active_step',
        true
      );

      update public.expense_requests expense_row
         set voucher_id = v_shareholder_voucher_id,
             ledger_posted_at = v_shareholder_posted_at,
             posting_locked_at = v_shareholder_posted_at,
             form_payload = coalesce(
               expense_row.form_payload,
               '{}'::jsonb
             ) || pg_catalog.jsonb_build_object(
               'shareholderPostedAt',
                 v_shareholder_posted_at,
               'shareholderPostedBy',
                 v_actor.name,
               'shareholderVoucherIds',
                 v_shareholder_voucher_ids
             ),
             ver = v_next_ver + 1,
             updated_at = pg_catalog.now()
       where expense_row.tenant_id = v_tenant_id
         and expense_row.data_environment = v_environment
         and expense_row.id = v_request_id
         and expense_row.type = 'shareholder_transaction'
         and expense_row.status = 'completed'
         and expense_row.ver = v_next_ver
         and expense_row.ledger_posted_at is null
         and expense_row.posting_locked_at is null
         and coalesce(expense_row.voucher_id, '') = ''
       returning expense_row.updated_at, expense_row.ver
         into v_updated_at, v_next_ver;

      get diagnostics v_row_count = row_count;
      perform pg_catalog.set_config(
        'app.finance_expense_write_context',
        v_previous_write_context,
        true
      );

      if v_row_count <> 1 then
        raise exception
          '股東或跨法人交易入帳結果寫回失敗，已取消本次核准'
          using errcode = '55000';
      end if;
    end if;

    v_result_rows := v_result_rows ||
      pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'id', v_request_id,
          'no', v_expense.no,
          'action', v_action,
          'active_role_key', v_role_key,
          'status', v_status ->> 'approval_status',
          'step', (v_status ->> 'approval_step')::int,
          'ver', v_next_ver,
          'updated_at', v_updated_at,
          'advance_disbursement', v_advance_posting,
          'posting', v_shareholder_posting
        )
      );
  end loop;

  v_result := pg_catalog.jsonb_build_object(
    'ok', true,
    'idempotent_replay', false,
    'document_type', 'expense',
    'action', v_action,
    'idempotency_key', p_idempotency_key,
    'count', pg_catalog.jsonb_array_length(v_result_rows),
    'rows', v_result_rows
  );

  perform private.finance_income_finish_operation(
    v_tenant_id,
    v_environment,
    'expense_action',
    p_idempotency_key,
    v_result
  );

  return v_result;
end;
$function$;

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
        'accountingLinesPreservedForReview',
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
        'accountingLinesPreservedForReview',
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
       or (
         (
           coalesce(old.form_payload, '{}'::jsonb) ? 'accountingLinesPreservedForReview'
           or coalesce(new.form_payload, '{}'::jsonb) ? 'accountingLinesPreservedForReview'
         )
         and (new.form_payload -> 'accountingLinesPreservedForReview')
           is distinct from 'false'::jsonb
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
$function$;
