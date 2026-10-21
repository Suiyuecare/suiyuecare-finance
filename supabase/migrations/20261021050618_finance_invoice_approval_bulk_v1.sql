-- Preserve the existing API, row locks, authority, CAS, idempotency and all business triggers.
-- Prepare validated rows, then write once so batch summaries refresh once per statement.
do $invoice_approval_guard$
declare p pg_proc%rowtype;
begin
  select * into p from pg_proc where oid=to_regprocedure('public.finance_invoice_act_active_step_v2(text[],text,text,text,jsonb,text,jsonb,jsonb,text)');
  if p.oid is null or md5(p.prosrc) is distinct from 'ad103c477833a5a1d94e7fced1913831'
     or pg_get_userbyid(p.proowner)<>'postgres' or not p.prosecdef
     or p.proconfig is distinct from array['search_path=""']::text[]
     or has_function_privilege('anon',p.oid,'EXECUTE')
     or not has_function_privilege('authenticated',p.oid,'EXECUTE')
     or not has_function_privilege('service_role',p.oid,'EXECUTE')
     or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE')
     or not exists(select 1 from pg_proc helper
       where helper.oid=to_regprocedure('private.finance_invoice_actor_can_act(uuid,public.invoices,integer,jsonb,text,text,text)')
         and md5(helper.prosrc)='675ec0629eff80846200ad3e54e6d5d0'
         and pg_get_userbyid(helper.proowner)='postgres' and not helper.prosecdef
         and helper.proconfig=array['search_path=""']::text[]
         and not has_function_privilege('anon',helper.oid,'EXECUTE')
         and not has_function_privilege('authenticated',helper.oid,'EXECUTE')
         and not has_function_privilege('service_role',helper.oid,'EXECUTE')
         and not exists(select 1 from aclexplode(coalesce(helper.proacl,acldefault('f',helper.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE'))
     or (select md5(prosrc) from pg_proc where oid=to_regprocedure('private.finance_history_projection_source_trigger_v1()')) is distinct from 'dacedbff7dc0b1a6ea7a1361951cc6bd'
     or (select md5(prosrc) from pg_proc where oid=to_regprocedure('private.finance_refresh_invoice_batch_approval_notification_statement_v2()')) is distinct from 'b72cc4fb038e98fb9517ca2398a40dcc'
     or not exists(select 1 from pg_trigger where tgrelid='public.invoices'::regclass
       and tgname='finance_history_projection_update_v1' and tgenabled='O' and tgtype=16
       and tgnewtable='new_source' and tgoldtable='old_source'
       and tgfoid='private.finance_history_projection_source_trigger_v1()'::regprocedure)
     or not exists(select 1 from pg_trigger where tgrelid='public.invoices'::regclass
       and tgname='trg_zz_invoices_refresh_batch_approval_notification_update_v2' and tgenabled='O' and tgtype=16
       and tgnewtable='invoice_batch_new' and tgoldtable='invoice_batch_old'
       and tgfoid='private.finance_refresh_invoice_batch_approval_notification_statement_v2()'::regprocedure)
  then raise exception 'Invoice approval function/authority/batch trigger drifted; review before release' using errcode='55000';end if;
end;
$invoice_approval_guard$;

CREATE OR REPLACE FUNCTION public.finance_invoice_act_active_step_v2(p_invoice_ids text[], p_action text, p_idempotency_key text, p_comment text DEFAULT NULL::text, p_files jsonb DEFAULT '[]'::jsonb, p_add_sign_finance_user_id text DEFAULT NULL::text, p_expected_steps jsonb DEFAULT '{}'::jsonb, p_patches jsonb DEFAULT '{}'::jsonb, p_data_environment text DEFAULT 'production'::text)
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
  v_invoice_id text;
  v_invoice public.invoices%rowtype;
  v_steps jsonb;
  v_step jsonb;
  v_expected_step jsonb;
  v_patch jsonb;
  v_step_updated jsonb;
  v_active_index int;
  v_previous_index int;
  v_previous_step jsonb;
  v_role_key text;
  v_status jsonb;
  v_add_step jsonb;
  v_revision_step jsonb;
  v_patch_amount numeric;
  v_patch_tax numeric;
  v_patch_total numeric;
  v_prepared_rows jsonb[] := '{}'::jsonb[];
  v_affected_count bigint;
  v_result_rows jsonb := '[]'::jsonb;
  v_result jsonb;
begin
  if auth.uid() is null then
    raise exception '請先登入後再處理發票簽核'
      using errcode = '42501';
  end if;

  if v_environment not in ('production', 'test') then
    raise exception '資料環境只允許 production 或 test'
      using errcode = '22023';
  end if;

  if v_action not in ('approve', 'return', 'reject', 'add_sign') then
    raise exception
      '簽核動作只允許 approve、return、reject 或 add_sign'
      using errcode = '22023';
  end if;

  if p_invoice_ids is null
     or pg_catalog.cardinality(p_invoice_ids) < 1
     or pg_catalog.cardinality(p_invoice_ids) > 500 then
    raise exception '每次必須處理 1 到 500 張發票'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from pg_catalog.unnest(p_invoice_ids) invoice_id
    where coalesce(pg_catalog.btrim(invoice_id), '') = ''
  ) then
    raise exception '發票 ID 不可為空白'
      using errcode = '22023';
  end if;

  if pg_catalog.cardinality(p_invoice_ids) <> (
    select pg_catalog.count(distinct invoice_id)
    from pg_catalog.unnest(p_invoice_ids) invoice_id
  ) then
    raise exception '同一次簽核不可包含重複的發票 ID'
      using errcode = '23505';
  end if;

  if pg_catalog.jsonb_typeof(coalesce(p_files, '[]'::jsonb)) <>
       'array'
     or pg_catalog.jsonb_array_length(
       coalesce(p_files, '[]'::jsonb)
     ) > 20 then
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
     ) <> pg_catalog.cardinality(p_invoice_ids)
     or exists (
       select 1
       from pg_catalog.jsonb_object_keys(
         coalesce(p_expected_steps, '{}'::jsonb)
       ) as expected_invoice(expected_invoice_id)
       where not (expected_invoice.expected_invoice_id = any(p_invoice_ids))
     ) then
    raise exception '發票預期關卡資料不完整，請重新整理後再處理'
      using errcode = '40001';
  end if;

  -- APPROVAL_V2_EXPECTED_ROW_VERSION_SHAPE
  if exists (
    select 1
    from pg_catalog.jsonb_each(
      coalesce(p_expected_steps, '{}'::jsonb)
    ) expected_row(expected_id, expected_value)
    where pg_catalog.jsonb_typeof(expected_row.expected_value) <> 'object'
       or pg_catalog.jsonb_typeof(
            expected_row.expected_value -> 'row_version'
          ) <> 'number'
       or pg_catalog.jsonb_typeof(
            expected_row.expected_value -> 'active_step_index'
          ) <> 'number'
  ) then
    raise exception
      '發票預期資料版本不完整，請重新載入後再處理'
      using errcode = '40001';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_each(
      coalesce(p_expected_steps, '{}'::jsonb)
    ) expected_row(expected_id, expected_value)
    where coalesce(
            expected_row.expected_value ->> 'row_version',
            ''
          ) !~ '^[1-9][0-9]{0,18}$'
       or coalesce(
            expected_row.expected_value ->> 'active_step_index',
            ''
          ) !~ '^(0|[1-9][0-9]{0,9})$'
  ) then
    raise exception
      '發票預期資料版本不完整，請重新載入後再處理'
      using errcode = '40001';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_each(
      coalesce(p_expected_steps, '{}'::jsonb)
    ) expected_row(expected_id, expected_value)
    where (expected_row.expected_value ->> 'row_version')::numeric >
            9223372036854775807::numeric
       or (expected_row.expected_value ->> 'active_step_index')::numeric >
            2147483647::numeric
  ) then
    raise exception
      '發票預期資料版本超出允許範圍，請重新載入後再處理'
      using errcode = '40001';
  end if;

  if pg_catalog.jsonb_typeof(coalesce(p_patches, '{}'::jsonb)) <>
       'object'
     or exists (
       select 1
       from pg_catalog.jsonb_object_keys(
         coalesce(p_patches, '{}'::jsonb)
       ) as patch_invoice(patch_invoice_id)
       where not (patch_invoice.patch_invoice_id = any(p_invoice_ids))
     ) then
    raise exception '發票核准修訂資料格式錯誤'
      using errcode = '22023';
  end if;

  if v_action in ('return', 'reject', 'add_sign')
     and v_comment = '' then
    raise exception '退回、不通過或加簽必須填寫原因'
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
  v_digest := private.finance_income_request_digest(
    pg_catalog.jsonb_build_object(
      'operation', 'invoice_action',
      'environment', v_environment,
      'invoice_ids', pg_catalog.to_jsonb(p_invoice_ids),
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
    'invoice_action',
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


  if v_action = 'add_sign' then
    select finance_user.*
      into v_target
    from public.finance_users finance_user
    where finance_user.tenant_id = v_tenant_id
      and finance_user.id = p_add_sign_finance_user_id
      and finance_user.active is true
    limit 1;

    if not found then
      raise exception '指定的加簽人不存在、已停用或不屬於目前租戶'
        using errcode = '23503';
    end if;

    if v_target.id = v_actor.id then
      raise exception '不可加簽自己'
        using errcode = '22023';
    end if;
  end if;

  for v_invoice_id in
    select invoice_id
    from pg_catalog.unnest(p_invoice_ids) invoice_id
    order by invoice_id
  loop
    select invoice_row.*
      into v_invoice
    from public.invoices invoice_row
    where invoice_row.tenant_id = v_tenant_id
      and invoice_row.data_environment = v_environment
      and invoice_row.id = v_invoice_id
    for update;

    if not found then
      raise exception '發票不存在或不屬於目前租戶：%', v_invoice_id
        using errcode = 'P0002';
    end if;

    -- APPROVAL_V2_LOCKED_ROW_VERSION_CAS
    v_expected_step := p_expected_steps -> v_invoice_id;
    if v_invoice.row_version is distinct from
       (v_expected_step ->> 'row_version')::bigint then
      raise exception
        '發票內容已被其他操作更新，請重新載入後再處理：%',
        v_invoice_id
        using errcode = '40001';
    end if;

    if v_invoice.posting_locked_at is not null
       or v_invoice.voided_at is not null
       or v_invoice.revenue_posted is true
       or v_invoice.status in ('paid', 'void')
       or v_invoice.approval_status in (
         'completed',
         'delivered',
         'rejected',
         'cancelled'
       ) then
      raise exception '發票已結案、作廢或入帳，不能再執行簽核：%',
        v_invoice_id
        using errcode = '55000';
    end if;

    v_steps := coalesce(v_invoice.steps, '[]'::jsonb);
    if pg_catalog.jsonb_typeof(v_steps) <> 'array' then
      raise exception '發票簽核步驟格式錯誤：%', v_invoice_id
        using errcode = '22023';
    end if;

    v_active_index :=
      private.finance_income_active_step_index(v_steps);
    if v_active_index is null then
      raise exception '發票沒有待處理的簽核步驟：%', v_invoice_id
        using errcode = '55000';
    end if;

    v_step := v_steps -> v_active_index;
    v_role_key := private.finance_income_step_role(v_step);
    v_expected_step := p_expected_steps -> v_invoice_id;

    if pg_catalog.jsonb_typeof(v_expected_step) <> 'object'
       or coalesce((v_expected_step ->> 'active_step_index')::int, -1)
            <> v_active_index
       or coalesce(v_expected_step ->> 'role_key', '')
            <> coalesce(v_role_key, '')
       or coalesce(v_expected_step ->> 'finance_user_id', '')
            <> coalesce(private.finance_income_step_user_id(v_step), '')
       or pg_catalog.lower(
            coalesce(v_expected_step ->> 'email', '')
          ) <> pg_catalog.lower(coalesce(v_step ->> 'email', ''))
       or coalesce(v_expected_step ->> 'approval_status', '')
            <> coalesce(v_invoice.approval_status, '') then
      raise exception
        '發票簽核關卡已被其他操作更新，請重新整理後再處理：%',
        v_invoice_id
        using errcode = '40001';
    end if;

    if v_role_key = 'applicant_revision' then
      raise exception
        '發票目前為申請人補件，請使用補件完成並重新送出功能：%',
        v_invoice_id
        using errcode = '55000';
    end if;

    if not private.finance_invoice_actor_can_act(
      v_tenant_id,
      v_invoice,
      v_active_index,
      v_step,
      v_actor.id,
      v_actor.email,
      v_actor.role
    ) then
      raise exception '您不是發票目前待簽步驟的有效處理人：%',
        v_invoice_id
        using errcode = '42501';
    end if;

    v_patch := coalesce(p_patches -> v_invoice_id, '{}'::jsonb);
    if pg_catalog.jsonb_typeof(v_patch) <> 'object'
       or exists (
         select 1
         from pg_catalog.jsonb_object_keys(v_patch) as patch_field(patch_key)
         where patch_field.patch_key not in (
           'description',
           'amount',
           'tax',
           'total',
           'invoice_item_type',
           'revenue_account_code',
           'revenue_account_name',
           'revenue_rule_snapshot'
         )
       ) then
      raise exception '發票核准修訂包含不允許的欄位：%', v_invoice_id
        using errcode = '22023';
    end if;

    if v_patch <> '{}'::jsonb then
      if v_action not in ('approve', 'add_sign')
         or v_actor.role not in ('accountant', 'admin_director', 'ceo') then
        raise exception '目前角色或動作不可修訂發票會計明細：%',
          v_invoice_id
          using errcode = '42501';
      end if;

      if not (
        v_patch ?& array[
          'description',
          'amount',
          'tax',
          'total',
          'invoice_item_type',
          'revenue_account_code',
          'revenue_account_name',
          'revenue_rule_snapshot'
        ]
      ) then
        raise exception '發票核准修訂欄位不完整：%', v_invoice_id
          using errcode = '22023';
      end if;

      v_patch_amount := (v_patch ->> 'amount')::numeric;
      v_patch_tax := (v_patch ->> 'tax')::numeric;
      v_patch_total := (v_patch ->> 'total')::numeric;

      if v_patch_amount < 0
         or v_patch_tax < 0
         or v_patch_total < 0
         or pg_catalog.abs(
           (v_patch_amount + v_patch_tax) - v_patch_total
         ) > 0.01
         or pg_catalog.length(v_patch ->> 'description') > 2000
         or coalesce(pg_catalog.btrim(v_patch ->> 'invoice_item_type'), '') = ''
         or coalesce(
           pg_catalog.btrim(v_patch ->> 'revenue_account_code'),
           ''
         ) !~ '^[0-9]{4,8}$'
         or coalesce(
           pg_catalog.btrim(v_patch ->> 'revenue_account_name'),
           ''
         ) = ''
         or pg_catalog.jsonb_typeof(
           v_patch -> 'revenue_rule_snapshot'
         ) <> 'object' then
        raise exception '發票核准修訂的金額或收入科目格式錯誤：%',
          v_invoice_id
          using errcode = '22023';
      end if;
    end if;

    if v_action in ('approve', 'add_sign') then
      v_step_updated := private.finance_income_append_step_action(
        v_step,
        v_actor.id,
        v_actor.name,
        case
          when v_action = 'add_sign' then '簽核通過並加簽'
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
    elsif v_action = 'reject' then
      v_step_updated := private.finance_income_append_step_action(
        v_step,
        v_actor.id,
        v_actor.name,
        '不通過',
        v_comment,
        p_files
      ) || pg_catalog.jsonb_build_object('a', 'rejected');

      v_steps := pg_catalog.jsonb_set(
        v_steps,
        array[v_active_index::text],
        v_step_updated,
        false
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
        raise exception '發票目前沒有可退回的上一關：%',
          v_invoice_id
          using errcode = '55000';
      end if;

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
        if coalesce(v_invoice.applicant_id, '') = '' then
          raise exception '發票缺少原申請人，無法建立補件關卡：%',
            v_invoice_id
            using errcode = '55000';
        end if;

        v_revision_step := pg_catalog.jsonb_build_object(
          'r', '申請人補件後重新送出',
          'rk', 'applicant_revision',
          'uid', v_invoice.applicant_id,
          'n', '',
          'a', '',
          't', '',
          'c', '',
          'files', '[]'::jsonb,
          'status', 'pending_invoice_applicant'
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
    else
      v_status := private.finance_income_status_from_steps(v_steps);

      -- The legacy invoice UI distinguishes a fully approved invoice whose
      -- applicant-delivery step has completed from a generic completed flow.
      if v_status ->> 'approval_status' = 'completed'
         and exists (
           select 1
           from pg_catalog.jsonb_array_elements(v_steps) completed_step
           where private.finance_income_step_role(completed_step) =
             'applicant_invoice_delivery'
             and pg_catalog.lower(
               coalesce(completed_step ->> 'a', '')
             ) in ('approved', 'auto')
         ) then
        v_status := pg_catalog.jsonb_set(
          v_status,
          '{approval_status}',
          '"delivered"'::jsonb,
          false
        );
      end if;
    end if;

    -- Validate every locked row before the one atomic write below.
    v_prepared_rows := pg_catalog.array_append(v_prepared_rows,
      pg_catalog.jsonb_build_object(
        'id', v_invoice_id,
        'steps', v_steps,
        'approval_status', v_status ->> 'approval_status',
        'approval_step', (v_status ->> 'approval_step')::int,
        'description', case when v_patch <> '{}'::jsonb then v_patch ->> 'description' else v_invoice.description end,
        'amount', case when v_patch <> '{}'::jsonb then v_patch_amount else v_invoice.amount end,
        'tax', case when v_patch <> '{}'::jsonb then v_patch_tax else v_invoice.tax end,
        'total', case when v_patch <> '{}'::jsonb then v_patch_total else v_invoice.total end,
        'invoice_item_type', case when v_patch <> '{}'::jsonb then v_patch ->> 'invoice_item_type' else v_invoice.invoice_item_type end,
        'revenue_account_code', case when v_patch <> '{}'::jsonb then v_patch ->> 'revenue_account_code' else v_invoice.revenue_account_code end,
        'revenue_account_name', case when v_patch <> '{}'::jsonb then v_patch ->> 'revenue_account_name' else v_invoice.revenue_account_name end,
        'revenue_rule_snapshot', case when v_patch <> '{}'::jsonb then v_patch -> 'revenue_rule_snapshot' else v_invoice.revenue_rule_snapshot end
      )
    );

    v_result_rows := v_result_rows ||
      pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'id', v_invoice_id,
          'no', v_invoice.no,
          'batch_id', v_invoice.batch_id,
          'action', v_action,
          'active_role_key', v_role_key,
          'approval_status', v_status ->> 'approval_status',
          'approval_step',
            (v_status ->> 'approval_step')::int
        )
      );
  end loop;

  -- INVOICE_APPROVAL_BULK_UPDATE_V1: all rows remain locked, authorized and version-checked.
  -- Keep every row/statement trigger and the all-or-nothing transaction intact.
  update public.invoices invoice_row
     set steps = prepared.steps,
         approval_status = prepared.approval_status,
         approval_step = prepared.approval_step,
         description = prepared.description,
         amount = prepared.amount,
         tax = prepared.tax,
         total = prepared.total,
         invoice_item_type = prepared.invoice_item_type,
         revenue_account_code = prepared.revenue_account_code,
         revenue_account_name = prepared.revenue_account_name,
         revenue_rule_snapshot = prepared.revenue_rule_snapshot,
         updated_at = pg_catalog.now()
    from pg_catalog.jsonb_to_recordset(pg_catalog.to_jsonb(v_prepared_rows)) as prepared(
      id text, steps jsonb, approval_status text, approval_step integer,
      description text, amount numeric, tax numeric, total numeric, invoice_item_type text, revenue_account_code text, revenue_account_name text, revenue_rule_snapshot jsonb
    )
   where invoice_row.tenant_id = v_tenant_id
     and invoice_row.data_environment = v_environment
     and invoice_row.id = prepared.id;
  get diagnostics v_affected_count = row_count;
  if v_affected_count <> pg_catalog.cardinality(p_invoice_ids) then
    raise exception '發票批次簽核筆數不符，整批未儲存，請重新整理後再試'
      using errcode = '40001';
  end if;

  v_result := pg_catalog.jsonb_build_object(
    'ok', true,
    'idempotent_replay', false,
    'document_type', 'invoice',
    'action', v_action,
    'idempotency_key', p_idempotency_key,
    'count', pg_catalog.jsonb_array_length(v_result_rows),
    'rows', v_result_rows
  );

  perform private.finance_income_finish_operation(
    v_tenant_id,
    v_environment,
    'invoice_action',
    p_idempotency_key,
    v_result
  );

  return v_result;
end;
$function$;
