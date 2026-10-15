-- Preserve all existing approval rules, locks, idempotency and per-row business triggers.
-- Collect validated changes, then refresh derived history once per affected group.
do $bill_approval_guard$
declare p pg_proc%rowtype;
begin
  select * into p from pg_proc where oid=to_regprocedure('public.finance_bill_act_active_step_v2(text[],text,text,text,jsonb,text,jsonb,text)');
  if p.oid is null or md5(p.prosrc) is distinct from 'b6f348ec65ffc8c951d963ab9fbafbe6'
     or pg_get_userbyid(p.proowner)<>'postgres' or not p.prosecdef
     or p.proconfig is distinct from array['search_path=""','lock_timeout=5s']::text[]
     or has_function_privilege('anon',p.oid,'EXECUTE')
     or not has_function_privilege('authenticated',p.oid,'EXECUTE')
     or not has_function_privilege('service_role',p.oid,'EXECUTE')
     or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE')
     or (select md5(prosrc) from pg_proc where oid=to_regprocedure('private.finance_history_projection_source_trigger_v1()')) is distinct from 'dacedbff7dc0b1a6ea7a1361951cc6bd'
     or not exists(select 1 from pg_trigger where tgrelid='public.bills'::regclass
       and tgname='finance_history_projection_update_v1' and tgenabled='O' and tgtype=16
       and tgnewtable='new_source' and tgoldtable='old_source'
       and tgfoid='private.finance_history_projection_source_trigger_v1()'::regprocedure)
  then raise exception 'Bill approval function/authority/history trigger drifted; review before release' using errcode='55000';end if;
end;
$bill_approval_guard$;

do $bill_attachment_guard$
declare p pg_proc%rowtype;
begin
  select * into p from pg_proc where oid=to_regprocedure('private.finance_claim_attachment_metadata_v2()');
  if p.oid is null or md5(p.prosrc) is distinct from '90d74f07ec5ac883060dec34b6cdadfe'
     or pg_get_userbyid(p.proowner)<>'postgres' or not p.prosecdef
     or p.proconfig is distinct from array['search_path=""']::text[]
     or has_function_privilege('anon',p.oid,'EXECUTE')
     or has_function_privilege('authenticated',p.oid,'EXECUTE')
     or not has_function_privilege('service_role',p.oid,'EXECUTE')
     or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE')
     or not exists(select 1 from pg_trigger where tgrelid='public.bills'::regclass
       and tgname='trg_claim_bill_attachments_v2' and tgenabled='O' and tgtype=21
       and tgfoid='private.finance_claim_attachment_metadata_v2()'::regprocedure)
  then raise exception 'Bill attachment authority/function/trigger drifted; review before release' using errcode='55000';end if;
end;
$bill_attachment_guard$;

CREATE OR REPLACE FUNCTION public.finance_bill_act_active_step_v2(p_bill_ids text[], p_action text, p_idempotency_key text, p_comment text DEFAULT NULL::text, p_files jsonb DEFAULT '[]'::jsonb, p_add_sign_finance_user_id text DEFAULT NULL::text, p_expected_steps jsonb DEFAULT '{}'::jsonb, p_data_environment text DEFAULT 'production'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET lock_timeout TO '5s'
AS $function$
declare
  v_tenant_id uuid;
  v_actor public.finance_users%rowtype;
  v_target public.finance_users%rowtype;
  v_environment text := pg_catalog.lower(coalesce(p_data_environment, 'production'));
  v_action text := pg_catalog.lower(coalesce(p_action, ''));
  v_comment text := coalesce(pg_catalog.btrim(p_comment), '');
  v_digest text;
  v_cached jsonb;
  v_bill_id text;
  v_bill public.bills%rowtype;
  v_steps jsonb;
  v_step jsonb;
  v_expected_step jsonb;
  v_step_updated jsonb;
  v_active_index int;
  v_previous_index int;
  v_previous_step jsonb;
  v_role_key text;
  v_status jsonb;
  v_add_step jsonb;
  v_revision_step jsonb;
  v_prepared_rows jsonb := '[]'::jsonb;
  v_affected_count bigint;
  v_result_rows jsonb := '[]'::jsonb;
  v_result jsonb;
begin
  if auth.uid() is null then
    raise exception '請先登入後再處理繳費單簽核'
      using errcode = '42501';
  end if;
  if v_environment not in ('production', 'test') then
    raise exception '資料環境只允許 production 或 test'
      using errcode = '22023';
  end if;
  if v_action not in ('approve', 'return', 'reject', 'add_sign') then
    raise exception '簽核動作只允許 approve、return、reject 或 add_sign'
      using errcode = '22023';
  end if;
  if p_bill_ids is null
     or pg_catalog.cardinality(p_bill_ids) < 1
     or pg_catalog.cardinality(p_bill_ids) > 150 then
    raise exception '每次必須處理 1 到 150 張繳費單'
      using errcode = '22023';
  end if;
  if pg_catalog.cardinality(p_bill_ids) <> (
    select pg_catalog.count(distinct bill_id)
    from pg_catalog.unnest(p_bill_ids) bill_id
  ) then
    raise exception '同一次簽核不可包含重複的繳費單 ID'
      using errcode = '23505';
  end if;
  if pg_catalog.jsonb_typeof(coalesce(p_files, '[]'::jsonb)) <> 'array'
     or pg_catalog.jsonb_array_length(coalesce(p_files, '[]'::jsonb)) > 20 then
    raise exception '附件資料格式錯誤或超過 20 個'
      using errcode = '22023';
  end if;
  -- APPROVAL_V2_EXPECTED_ROW_VERSION_SHAPE
  if pg_catalog.jsonb_typeof(
       coalesce(p_expected_steps, '{}'::jsonb)
     ) <> 'object'
     or (
       select pg_catalog.count(*)
       from pg_catalog.jsonb_object_keys(
         coalesce(p_expected_steps, '{}'::jsonb)
       )
     ) <> pg_catalog.cardinality(p_bill_ids)
     or exists (
       select 1
       from pg_catalog.jsonb_object_keys(
         coalesce(p_expected_steps, '{}'::jsonb)
       ) expected_id
       where not (expected_id = any(p_bill_ids))
     )
     or exists (
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
      '繳費單預期資料版本不完整，請重新載入後再處理'
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
      '繳費單預期資料版本不完整，請重新載入後再處理'
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
      '繳費單預期資料版本超出允許範圍，請重新載入後再處理'
      using errcode = '40001';
  end if;

  if v_action in ('return', 'reject', 'add_sign') and v_comment = '' then
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
  end if;  v_digest := private.finance_income_request_digest(
    pg_catalog.jsonb_build_object(
      'operation', 'bill_action',
      'environment', v_environment,
      'bill_ids', pg_catalog.to_jsonb(p_bill_ids),
      'action', v_action,
      'comment', v_comment,
      'files', coalesce(p_files, '[]'::jsonb),
      'add_sign_finance_user_id', p_add_sign_finance_user_id,
      'expected_steps', coalesce(p_expected_steps, '{}'::jsonb)
    )
  );
  v_cached := private.finance_income_begin_operation(
    v_tenant_id,
    v_environment,
    'bill_action',
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


  -- APPROVAL_V2_BILL_MEMBERSHIP_TABLE_LOCK
  -- CONCURRENCY WARNING: this deliberately serializes bill v2 mutations
  -- across all tenants. Contention fails within lock_timeout=5s for retry.
  lock table public.bills in share row exclusive mode;


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


  -- BILL_BATCH_COMPLETE_SIBLINGS_GUARD_V1
  -- BILL_BATCH_SELECTED_IDS_SCOPE_GUARD_V1
  if (
    select pg_catalog.count(*)
    from public.bills selected_row
    where selected_row.tenant_id = v_tenant_id
      and selected_row.data_environment = v_environment
      and selected_row.id = any(p_bill_ids)
  ) <> pg_catalog.cardinality(p_bill_ids) then
    raise exception
      '部分繳費單不存在或不屬於目前租戶，請重新整理後再試'
      using errcode = '55000';
  end if;

  if exists (
    with selected_bill_rows as (
      select bill_row.id,
             nullif(pg_catalog.btrim(bill_row.batch_id), '') as batch_id
      from public.bills bill_row
      where bill_row.tenant_id = v_tenant_id
        and bill_row.data_environment = v_environment
        and bill_row.id = any(p_bill_ids)
    ),
    selected_batches as (
      select selected_bill.batch_id,
             pg_catalog.count(*) as selected_count
      from selected_bill_rows selected_bill
      where selected_bill.batch_id is not null
      group by selected_bill.batch_id
    )
    select 1
    from selected_batches selected_batch
    where selected_batch.selected_count <> (
      select pg_catalog.count(*)
      from public.bills sibling_row
      where sibling_row.tenant_id = v_tenant_id
        and sibling_row.data_environment = v_environment
        and nullif(pg_catalog.btrim(sibling_row.batch_id), '') =
            selected_batch.batch_id
    )
  ) then
    raise exception '同一批繳費單必須完整簽核，請重新整理後再試'
      using errcode = '55000';
  end if;

  for v_bill_id in
    select bill_id
    from pg_catalog.unnest(p_bill_ids) bill_id
    order by bill_id
  loop
    select bill_row.*
      into v_bill
    from public.bills bill_row
    where bill_row.tenant_id = v_tenant_id
      and bill_row.data_environment = v_environment
      and bill_row.id = v_bill_id
    for update;

    if not found then
      raise exception '繳費單不存在或不屬於目前租戶：%', v_bill_id
        using errcode = 'P0002';
    end if;
    -- APPROVAL_V2_LOCKED_ROW_VERSION_CAS
    v_expected_step := p_expected_steps -> v_bill_id;
    if v_bill.row_version is distinct from
         (v_expected_step ->> 'row_version')::bigint
       or coalesce(
            (v_expected_step ->> 'active_step_index')::int,
            -1
          ) <> private.finance_income_active_step_index(v_bill.steps)
       or coalesce(v_expected_step ->> 'role_key', '') <>
          coalesce(
            private.finance_income_step_role(
              v_bill.steps ->
              private.finance_income_active_step_index(v_bill.steps)
            ),
            ''
          )
       or coalesce(v_expected_step ->> 'finance_user_id', '') <>
          coalesce(
            private.finance_income_step_user_id(
              v_bill.steps ->
              private.finance_income_active_step_index(v_bill.steps)
            ),
            ''
          )
       or pg_catalog.lower(
            coalesce(v_expected_step ->> 'email', '')
          ) <> pg_catalog.lower(
            coalesce(
              v_bill.steps ->
                private.finance_income_active_step_index(v_bill.steps)
                ->> 'email',
              ''
            )
          )
       or coalesce(v_expected_step ->> 'approval_status', '') <>
          coalesce(v_bill.approval_status, '') then
      raise exception
        '繳費單內容或簽核關卡已被其他操作更新，請重新載入後再處理：%',
        v_bill_id
        using errcode = '40001';
    end if;

    if v_bill.voided_at is not null
       or v_bill.status in ('paid', 'void')
       or v_bill.approval_status in ('completed', 'rejected', 'cancelled') then
      raise exception '繳費單已結案，不能再執行簽核：%', v_bill_id
        using errcode = '55000';
    end if;

    v_steps := v_bill.steps;
    v_active_index := private.finance_income_active_step_index(v_steps);
    if v_active_index is null then
      raise exception '繳費單沒有待處理的簽核步驟：%', v_bill_id
        using errcode = '55000';
    end if;
    v_step := v_steps -> v_active_index;
    v_role_key := private.finance_income_step_role(v_step);

    if not private.finance_bill_actor_can_act(
      v_tenant_id,
      v_bill,
      v_active_index,
      v_step,
      v_actor.id,
      v_actor.email,
      v_actor.role
    ) then
      raise exception '您不是繳費單目前待簽步驟的有效處理人：%', v_bill_id
        using errcode = '42501';
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
        raise exception '繳費單目前沒有可退回的上一關：%', v_bill_id
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
        v_revision_step := pg_catalog.jsonb_build_object(
          'r', '申請人補件後重新送出',
          'rk', 'applicant_revision',
          'uid', v_bill.applicant_id,
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
    else
      v_status := private.finance_income_status_from_steps(v_steps);
    end if;

    -- Prepare only after this locked row passes every authority/version check.
    -- One statement below retains all row guards and refreshes each history group once.
    v_prepared_rows := v_prepared_rows || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'id', v_bill_id,
        'steps', v_steps,
        'approval_status', v_status ->> 'approval_status',
        'approval_step', (v_status ->> 'approval_step')::int
      )
    );

    v_result_rows := v_result_rows || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'id', v_bill_id,
        'no', v_bill.no,
        'action', v_action,
        'active_role_key', v_role_key,
        'approval_status', v_status ->> 'approval_status',
        'approval_step', (v_status ->> 'approval_step')::int
      )
    );
  end loop;

  -- BILL_APPROVAL_BULK_UPDATE_V1: all selected rows are already locked and validated.
  -- Do not disable triggers or split the transaction: late failures must undo all rows.
  update public.bills bill_row
     set steps = prepared.steps,
         approval_status = prepared.approval_status,
         approval_step = prepared.approval_step
    from pg_catalog.jsonb_to_recordset(v_prepared_rows) as prepared(
      id text, steps jsonb, approval_status text, approval_step integer
    )
   where bill_row.tenant_id = v_tenant_id
     and bill_row.data_environment = v_environment
     and bill_row.id = prepared.id;
  get diagnostics v_affected_count = row_count;
  if v_affected_count <> pg_catalog.cardinality(p_bill_ids) then
    raise exception '繳費單批次簽核筆數不符，整批未儲存，請重新整理後再試'
      using errcode = '40001';
  end if;

  v_result := pg_catalog.jsonb_build_object(
    'ok', true,
    'idempotent_replay', false,
    'document_type', 'bill',
    'action', v_action,
    'idempotency_key', p_idempotency_key,
    'count', pg_catalog.jsonb_array_length(v_result_rows),
    'rows', v_result_rows
  );
  perform private.finance_income_finish_operation(
    v_tenant_id,
    v_environment,
    'bill_action',
    p_idempotency_key,
    v_result
  );
  return v_result;
end;
$function$;

-- Resolve the exact existing parent before its unchanged read authorization.
-- A scalar primary-key lookup prevents EXISTS from hashing permissions for all bills.
CREATE OR REPLACE FUNCTION private.finance_claim_attachment_metadata_v2()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_document jsonb := pg_catalog.to_jsonb(new);
  v_old_document jsonb := '{}'::jsonb;
  v_tenant_id uuid;
  v_record_type text;
  v_environment text;
  v_primary_identifier text;
  v_batch_identifier text;
  v_batch_display_no text;
  v_note jsonb;
  v_actor_finance_user_id text;
  v_actor_auth_user_id uuid;
begin
  if tg_op = 'UPDATE' then
    v_old_document := pg_catalog.to_jsonb(old);
  end if;

  v_tenant_id := nullif(v_document ->> 'tenant_id', '')::uuid;
  v_environment := coalesce(
    nullif(v_document ->> 'data_environment', ''),
    'production'
  );

  -- Staged metadata can only be promoted by the same verified signed-in user
  -- who uploaded the corresponding Storage object.  Document actor fields are
  -- deliberately not accepted as a substitute for the live OAuth identity.
  v_actor_auth_user_id := auth.uid();
  v_actor_finance_user_id := nullif(
    public.current_finance_user_id(),
    ''
  );

  case tg_table_name
    when 'expense_requests' then
      v_record_type := 'expense_requests';
      v_primary_identifier := coalesce(
        nullif(v_document ->> 'no', ''),
        nullif(v_document ->> 'id', '')
      );
    when 'invoices' then
      v_record_type := 'invoices';
      v_batch_identifier := nullif(v_document ->> 'batch_id', '');
      v_primary_identifier := coalesce(
        v_batch_identifier,
        nullif(v_document ->> 'no', ''),
        nullif(v_document ->> 'id', '')
      );
    when 'bills' then
      v_record_type := 'bills';
      v_batch_identifier := nullif(v_document ->> 'batch_id', '');
      begin
        v_note := coalesce(
          nullif(v_document ->> 'note', '')::jsonb,
          '{}'::jsonb
        );
      exception
        when invalid_text_representation then
          v_note := '{}'::jsonb;
      end;
      v_batch_display_no := coalesce(
        nullif(v_note ->> 'batchNo', ''),
        nullif(v_note ->> 'batch_no', '')
      );
      v_primary_identifier := coalesce(
        v_batch_display_no,
        v_batch_identifier,
        nullif(v_document ->> 'no', ''),
        nullif(v_document ->> 'id', '')
      );
    when 'vouchers' then
      v_record_type := 'vouchers';
      v_primary_identifier := coalesce(
        nullif(v_document ->> 'no', ''),
        nullif(v_document ->> 'id', ''),
        nullif(v_document ->> 'request_id', '')
      );
    else
      return new;
  end case;

  if v_tenant_id is null
     or v_primary_identifier is null then
    return new;
  end if;

  -- Exact path membership replaces provisional record-number equality.  Every
  -- other trust boundary remains mandatory, including the live OAuth actor and
  -- storage.objects.owner_id.  On UPDATE, only newly added paths are eligible;
  -- this prevents a harmless edit from mutating historical attachment rows.
  if v_actor_finance_user_id is not null
     and v_actor_auth_user_id is not null then
    with newly_claimed as (
    update public.file_attachments attachment
    set
      record_no = v_primary_identifier,
      attachment_state = 'claimed',
      claimed_at = coalesce(
        attachment.claimed_at,
        pg_catalog.clock_timestamp()
      ),
      claim_key = v_record_type || ':' || v_primary_identifier
    from storage.objects object_row,
         public.finance_users uploader
    where attachment.tenant_id = v_tenant_id
      and attachment.bucket_id = 'finance-attachments'
      and attachment.record_type = v_record_type
      and attachment.data_environment = v_environment
      and attachment.attachment_state = 'staged'
      and attachment.uploaded_by = v_actor_finance_user_id
      and private.finance_is_current_document_attachment_path_v3(
        attachment.storage_path,
        v_tenant_id,
        v_record_type,
        v_environment
      )
      and private.finance_json_contains_attachment_path_v2(
        v_document,
        attachment.storage_path
      )
      and (
        tg_op = 'INSERT'
        or not private.finance_json_contains_attachment_path_v2(
          v_old_document,
          attachment.storage_path
        )
      )
      and object_row.bucket_id = attachment.bucket_id
      and object_row.name = attachment.storage_path
      and object_row.owner_id = v_actor_auth_user_id::text
      and uploader.tenant_id = attachment.tenant_id
      and uploader.id = attachment.uploaded_by
      and uploader.auth_user_id = v_actor_auth_user_id
    returning attachment.*
    )
    insert into private.finance_legacy_attachment_links_v1(
      attachment_id,tenant_id,data_environment,record_type,original_record_no,storage_path,
      parent_kind,parent_key,source_reference_count,source_scope,source_fingerprint)
    select claimed.id,claimed.tenant_id,claimed.data_environment,claimed.record_type,
      claimed.record_no,claimed.storage_path,'id',v_document->>'id',1,jsonb_build_object('entity',v_document->>'entity_id','department',v_document->>'department_code','applicant',v_document->>'applicant_id','batch',v_document->>'batch_id'),
      md5(jsonb_build_object('path',claimed.storage_path,'parent',v_document->>'id')::text)
    from newly_claimed claimed
    on conflict(attachment_id,parent_key) do nothing;
  end if;

  if v_actor_finance_user_id is not null and v_actor_auth_user_id is not null then
    insert into private.finance_legacy_attachment_links_v1(
      attachment_id,tenant_id,data_environment,record_type,original_record_no,storage_path,
      parent_kind,parent_key,source_reference_count,source_scope,source_fingerprint)
    select attachment.id,attachment.tenant_id,attachment.data_environment,attachment.record_type,
      attachment.record_no,attachment.storage_path,'id',v_document->>'id',1,jsonb_build_object('entity',v_document->>'entity_id','department',v_document->>'department_code','applicant',v_document->>'applicant_id','batch',v_document->>'batch_id'),
      md5(jsonb_build_object('path',attachment.storage_path,'parent',v_document->>'id')::text)
    from public.file_attachments attachment join storage.objects object_row
      on object_row.bucket_id=attachment.bucket_id and object_row.name=attachment.storage_path
    where attachment.tenant_id=v_tenant_id and attachment.data_environment=v_environment
      and attachment.record_type=v_record_type and attachment.record_no=v_primary_identifier
      and attachment.attachment_state='claimed' and attachment.uploaded_by=v_actor_finance_user_id
      and object_row.owner_id=v_actor_auth_user_id::text
      and private.finance_json_contains_attachment_path_v2(v_document,attachment.storage_path)
      and (tg_op='INSERT' or not private.finance_json_contains_attachment_path_v2(v_old_document,attachment.storage_path))
      and public.can_read_finance_attachment(attachment)
      and exists(select 1 from private.finance_legacy_attachment_links_v1 original_link
        where original_link.attachment_id=attachment.id
          and original_link.tenant_id=v_tenant_id and original_link.record_type=v_record_type
          and original_link.data_environment=v_environment
          and case v_record_type
            when 'expense_requests' then exists(select 1 from public.expense_requests origin
              where origin.id=original_link.parent_key and origin.tenant_id=v_tenant_id
                and public.can_read_expense_request(origin))
            when 'invoices' then exists(select 1 from public.invoices origin
              where origin.id=original_link.parent_key and origin.tenant_id=v_tenant_id
                and public.can_read_invoice(origin))
            when 'bills' then coalesce((select public.can_read_bill(origin)
              from public.bills origin
              where origin.id=original_link.parent_key and origin.tenant_id=v_tenant_id),false)
            when 'vouchers' then public.is_finance_accounting()
            else false end
          and (original_link.parent_key=v_document->>'id'
            or (v_record_type in ('invoices','bills')
              and nullif(original_link.source_scope->>'batch','') is not null
              and original_link.source_scope=jsonb_build_object('entity',v_document->>'entity_id','department',v_document->>'department_code','applicant',v_document->>'applicant_id','batch',v_document->>'batch_id'))))
    on conflict(attachment_id,parent_key) do nothing;
  end if;

  -- INSERT is strict for every new-format Finance Storage reference.  UPDATE is
  -- strict only for paths absent from OLD, so a historical missing object does
  -- not block unrelated workflow or accounting changes.
  if exists (
    select 1
    from private.finance_attachment_paths_in_document_v2(v_document)
      referenced_path(storage_path)
    where private.finance_is_current_finance_attachment_path_v3(
      referenced_path.storage_path
    )
      and (
        tg_op = 'INSERT'
        or not private.finance_json_contains_attachment_path_v2(
          v_old_document,
          referenced_path.storage_path
        )
      )
      and not exists (
        select 1
        from public.file_attachments attachment
        join storage.objects object_row
          on object_row.bucket_id = attachment.bucket_id
         and object_row.name = attachment.storage_path
        join public.finance_users uploader
          on uploader.tenant_id = attachment.tenant_id
         and uploader.id = attachment.uploaded_by
         and uploader.auth_user_id::text = object_row.owner_id
        where attachment.tenant_id = v_tenant_id
          and attachment.bucket_id = 'finance-attachments'
          and attachment.storage_path = referenced_path.storage_path
          and attachment.record_type = v_record_type
          and attachment.record_no = v_primary_identifier
          and attachment.data_environment = v_environment
          and attachment.attachment_state = 'claimed'
          and attachment.claimed_at is not null
          and attachment.uploaded_by = v_actor_finance_user_id
          and uploader.auth_user_id = v_actor_auth_user_id
      )
  ) then
    raise exception
      '附件尚未依正式單號完成綁定，系統已取消本次寫入，請重新整理後再試'
      using errcode = '55000';
  end if;

  -- Evaluate the document's exact attachment paths once, then probe the unique
  -- storage_path index.  The former scan evaluated jsonb_path_exists for every
  -- claimed attachment in the tenant, timing out on large expense submissions.
  -- Keep the tenant, environment, bucket, state, old-document and legacy-link
  -- checks unchanged; this is a query-plan repair, not a permission bypass.
  if exists(
    select 1
    from private.finance_attachment_paths_in_document_v2(v_document)
      referenced_path(storage_path)
    join public.file_attachments attachment
      on attachment.storage_path = referenced_path.storage_path
    where attachment.tenant_id=v_tenant_id and attachment.data_environment=v_environment
      and attachment.bucket_id='finance-attachments' and attachment.attachment_state='claimed'
      and (tg_op='INSERT' or not private.finance_json_contains_attachment_path_v2(v_old_document,attachment.storage_path))
      and not exists(select 1 from private.finance_legacy_attachment_links_v1 l
        where l.attachment_id=attachment.id and l.record_type=v_record_type
          and l.parent_key=v_document->>'id' and l.tenant_id=v_tenant_id and l.data_environment=v_environment)
  ) then
    raise exception '附件尚未與本單據完成授權綁定，請重新上傳本人有權使用的附件' using errcode='42501';
  end if;
  return new;
end
$function$;
