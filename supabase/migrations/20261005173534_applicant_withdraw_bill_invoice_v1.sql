-- Applicant withdrawal for the two income application sources. The existing
-- expense_requests RPC already supports withdraw; preserve its transaction
-- semantics and stop electronic-labor withdrawals after an external statement
-- has been created (that statement has its own invite/signature lifecycle).
-- No business row or attachment is deleted by these functions.
set local lock_timeout = '5s';
set local statement_timeout = '120s';

create or replace function private.finance_guard_labor_request_withdraw_v1()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if old.status is distinct from 'cancelled'
     and new.status = 'cancelled'
     and exists (
       select 1
       from private.finance_labor_statements_v1 statement_row
       where statement_row.request_id = old.id
         and statement_row.tenant_id = old.tenant_id
         and statement_row.data_environment = old.data_environment
     ) then
    raise exception
      '電子勞務報酬單已建立邀請或簽署資料，不能直接抽單；請聯絡會計處理撤銷與相關資料'
      using errcode = '55000';
  end if;
  return new;
end;
$function$;

revoke all on function private.finance_guard_labor_request_withdraw_v1()
  from public, anon, authenticated, service_role;

create trigger finance_guard_labor_request_withdraw_v1
before update of status on public.expense_requests
for each row
execute function private.finance_guard_labor_request_withdraw_v1();

-- This helper is reached only from the two explicitly granted public wrappers.
-- Its invoker is the wrapper owner, while auth.uid() still identifies the
-- authenticated human. The operation row and table locks serialize retries,
-- concurrent approvals, and batch membership changes in one transaction.
create or replace function private.finance_income_withdraw_applicant_v1(
  p_document_type text,
  p_document_ids text[],
  p_idempotency_key text,
  p_comment text,
  p_expected_steps jsonb,
  p_data_environment text
) returns jsonb
language plpgsql
security invoker
set search_path to ''
set lock_timeout to '5s'
as $function$
declare
  v_kind text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_document_type, '')));
  v_environment text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_data_environment, 'production')));
  v_comment text := pg_catalog.btrim(coalesce(p_comment, ''));
  v_tenant_id uuid;
  v_actor public.finance_users%rowtype;
  v_operation_type text;
  v_max_items integer;
  v_digest text;
  v_cached jsonb;
  v_id text;
  v_document jsonb;
  v_expected jsonb;
  v_steps jsonb;
  v_step jsonb;
  v_active_index integer;
  v_step_role text;
  v_step_updated jsonb;
  v_result_rows jsonb := '[]'::jsonb;
  v_result jsonb;
  v_next_version bigint;
begin
  if auth.uid() is null then
    raise exception '請先登入後再抽單' using errcode = '42501';
  end if;
  if v_kind not in ('bill', 'invoice') then
    raise exception '只能抽回繳費單或發票申請' using errcode = '22023';
  end if;
  if v_environment not in ('production', 'test') then
    raise exception '資料環境只允許 production 或 test' using errcode = '22023';
  end if;
  if v_comment = '' or pg_catalog.char_length(v_comment) > 2000 then
    raise exception '請填寫 1 到 2000 字的抽單原因' using errcode = '22023';
  end if;
  if v_kind = 'bill' then
    v_max_items := 150;
  else
    v_max_items := 500;
  end if;
  if p_document_ids is null
     or pg_catalog.cardinality(p_document_ids) < 1
     or pg_catalog.cardinality(p_document_ids) > v_max_items
     or exists (
       select 1 from pg_catalog.unnest(p_document_ids) item(id)
       where pg_catalog.btrim(coalesce(item.id, '')) = ''
     )
     or pg_catalog.cardinality(p_document_ids) <> (
       select pg_catalog.count(distinct item.id)
       from pg_catalog.unnest(p_document_ids) item(id)
     ) then
    raise exception '抽單筆數或單據識別碼錯誤' using errcode = '22023';
  end if;
  if pg_catalog.jsonb_typeof(p_expected_steps) <> 'object'
     or (select pg_catalog.count(*)
         from pg_catalog.jsonb_object_keys(p_expected_steps)) <>
        pg_catalog.cardinality(p_document_ids)
     or exists (
       select 1
       from pg_catalog.jsonb_object_keys(p_expected_steps) expected_id(id)
       where not (expected_id.id = any(p_document_ids))
     )
     or exists (
       select 1
       from pg_catalog.jsonb_each(p_expected_steps) expected_row(id, value)
       where pg_catalog.jsonb_typeof(expected_row.value) <> 'object'
          or pg_catalog.jsonb_typeof(expected_row.value -> 'row_version') <> 'number'
          or pg_catalog.jsonb_typeof(expected_row.value -> 'active_step_index') <> 'number'
          or coalesce(expected_row.value ->> 'row_version', '') !~ '^[1-9][0-9]{0,18}$'
          or coalesce(expected_row.value ->> 'active_step_index', '') !~ '^(0|[1-9][0-9]{0,9})$'
     ) then
    raise exception '抽單預期資料版本不完整，請重新載入後再處理'
      using errcode = '40001';
  end if;
  if exists (
    select 1
    from pg_catalog.jsonb_each(p_expected_steps) expected_row(id, value)
    where (expected_row.value ->> 'row_version')::numeric >
            9223372036854775807::numeric
       or (expected_row.value ->> 'active_step_index')::numeric >
            2147483647::numeric
  ) then
    raise exception '抽單預期資料版本超出允許範圍，請重新載入後再處理'
      using errcode = '40001';
  end if;

  v_tenant_id := public.current_tenant_id();
  select finance_user.* into v_actor
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

  v_operation_type := v_kind || '_action';
  v_digest := private.finance_income_request_digest(
    pg_catalog.jsonb_build_object(
      'operation', v_operation_type,
      'environment', v_environment,
      'document_ids', pg_catalog.to_jsonb(p_document_ids),
      'action', 'withdraw',
      'comment', v_comment,
      'expected_steps', p_expected_steps
    )
  );
  v_cached := private.finance_income_begin_operation(
    v_tenant_id, v_environment, v_operation_type,
    p_idempotency_key, v_digest, v_actor.id
  );
  if v_cached is not null then
    return v_cached || pg_catalog.jsonb_build_object('idempotent_replay', true);
  end if;

  if v_kind = 'bill' then
    -- Same complete-sibling guarantee as the current bill approval RPC.
    lock table public.bills in share row exclusive mode;
    if (
      select pg_catalog.count(*) from public.bills bill_row
      where bill_row.tenant_id = v_tenant_id
        and bill_row.data_environment = v_environment
        and bill_row.id = any(p_document_ids)
    ) <> pg_catalog.cardinality(p_document_ids) then
      raise exception '部分繳費單不存在或不屬於目前租戶，請重新整理後再試'
        using errcode = '55000';
    end if;
    if exists (
      with selected as (
        select nullif(pg_catalog.btrim(bill_row.batch_id), '') as batch_id,
               pg_catalog.count(*) as selected_count
        from public.bills bill_row
        where bill_row.tenant_id = v_tenant_id
          and bill_row.data_environment = v_environment
          and bill_row.id = any(p_document_ids)
          and nullif(pg_catalog.btrim(bill_row.batch_id), '') is not null
        group by nullif(pg_catalog.btrim(bill_row.batch_id), '')
      )
      select 1 from selected s
      where s.selected_count <> (
        select pg_catalog.count(*) from public.bills sibling
        where sibling.tenant_id = v_tenant_id
          and sibling.data_environment = v_environment
          and nullif(pg_catalog.btrim(sibling.batch_id), '') = s.batch_id
      )
    ) then
      raise exception '同一批繳費單必須完整抽單，請重新整理後再試'
        using errcode = '55000';
    end if;
  else
    lock table public.invoices in share row exclusive mode;
    if (
      select pg_catalog.count(*) from public.invoices invoice_row
      where invoice_row.tenant_id = v_tenant_id
        and invoice_row.data_environment = v_environment
        and invoice_row.id = any(p_document_ids)
    ) <> pg_catalog.cardinality(p_document_ids) then
      raise exception '部分發票申請不存在或不屬於目前租戶，請重新整理後再試'
        using errcode = '55000';
    end if;
    if exists (
      with selected as (
        select nullif(pg_catalog.btrim(invoice_row.batch_id), '') as batch_id,
               pg_catalog.count(*) as selected_count
        from public.invoices invoice_row
        where invoice_row.tenant_id = v_tenant_id
          and invoice_row.data_environment = v_environment
          and invoice_row.id = any(p_document_ids)
          and nullif(pg_catalog.btrim(invoice_row.batch_id), '') is not null
        group by nullif(pg_catalog.btrim(invoice_row.batch_id), '')
      )
      select 1 from selected s
      where s.selected_count <> (
        select pg_catalog.count(*) from public.invoices sibling
        where sibling.tenant_id = v_tenant_id
          and sibling.data_environment = v_environment
          and nullif(pg_catalog.btrim(sibling.batch_id), '') = s.batch_id
      )
    ) then
      raise exception '同一批發票申請必須完整抽單，請重新整理後再試'
        using errcode = '55000';
    end if;
  end if;

  for v_id in
    select item.id from pg_catalog.unnest(p_document_ids) item(id)
    order by item.id
  loop
    if v_kind = 'bill' then
      select pg_catalog.to_jsonb(bill_row) into v_document
      from public.bills bill_row
      where bill_row.tenant_id = v_tenant_id
        and bill_row.data_environment = v_environment
        and bill_row.id = v_id
      for update;
    else
      select pg_catalog.to_jsonb(invoice_row) into v_document
      from public.invoices invoice_row
      where invoice_row.tenant_id = v_tenant_id
        and invoice_row.data_environment = v_environment
        and invoice_row.id = v_id
      for update;
    end if;
    if v_document is null then
      raise exception '單據不存在或不屬於目前租戶：%', v_id
        using errcode = 'P0002';
    end if;
    if coalesce(v_document ->> 'applicant_id', '') <> v_actor.id then
      raise exception '只有原申請人可以抽單：%', v_id
        using errcode = '42501';
    end if;
    v_expected := p_expected_steps -> v_id;
    v_steps := coalesce(v_document -> 'steps', '[]'::jsonb);
    if pg_catalog.jsonb_typeof(v_steps) <> 'array' then
      raise exception '單據簽核步驟格式錯誤：%', v_id
        using errcode = '22023';
    end if;
    v_active_index := private.finance_income_active_step_index(v_steps);
    if v_active_index is null
       or coalesce(v_document ->> 'approval_status', '') not like 'pending%'
       or coalesce(v_document ->> 'approval_step', '') <> (v_active_index + 1)::text then
      raise exception '單據已結案或沒有待處理關卡，不能抽單：%', v_id
        using errcode = '55000';
    end if;
    v_step := v_steps -> v_active_index;
    v_step_role := private.finance_income_step_role(v_step);
    if (v_document ->> 'row_version')::bigint is distinct from
         (v_expected ->> 'row_version')::bigint
       or v_active_index is distinct from
         (v_expected ->> 'active_step_index')::integer
       or coalesce(v_step_role, '') <>
          coalesce(v_expected ->> 'role_key', '')
       or coalesce(private.finance_income_step_user_id(v_step), '') <>
          coalesce(v_expected ->> 'finance_user_id', '')
       or pg_catalog.lower(coalesce(v_step ->> 'email', '')) <>
          pg_catalog.lower(coalesce(v_expected ->> 'email', ''))
       or coalesce(v_document ->> 'approval_status', '') <>
          coalesce(v_expected ->> 'approval_status', '') then
      raise exception '單據內容或關卡已更新，請重新載入後再抽單：%', v_id
        using errcode = '40001';
    end if;

    if v_kind = 'bill' then
      if coalesce(v_document ->> 'status', '') <> 'unpaid'
         or nullif(v_document ->> 'paid_at', '') is not null
         or nullif(v_document ->> 'voided_at', '') is not null
         or nullif(v_document ->> 'linked_invoice_id', '') is not null
         or coalesce(v_document ->> 'invoice_followup_status', 'unreviewed') <> 'unreviewed'
         or exists (
           select 1 from public.invoices invoice_row
           where invoice_row.tenant_id = v_tenant_id
             and invoice_row.data_environment = v_environment
             and invoice_row.source_bill_id = v_id
         ) then
        raise exception '繳費單已收款、連結發票或進入後續處理，不能直接抽單：%', v_id
          using errcode = '55000';
      end if;
    else
      -- accountant_invoice approval is the issue step. A document waiting for
      -- applicant delivery has already been issued even if posting flags have
      -- not yet caught up; it needs an invoice void/credit workflow instead.
      if coalesce(v_document ->> 'approval_status', '') = 'pending_invoice_delivery'
         or exists (
           select 1
           from pg_catalog.jsonb_array_elements(v_steps) issue_step
           where private.finance_income_step_role(issue_step) in (
             'accountant_invoice', 'invoice_issue', 'invoice_issuance'
           )
             and pg_catalog.lower(coalesce(issue_step ->> 'a', '')) in (
               'approved', 'auto'
             )
         )
         or coalesce(v_document ->> 'status', '') <> 'unpaid'
         or nullif(v_document ->> 'paid_at', '') is not null
         or nullif(v_document ->> 'voided_at', '') is not null
         or nullif(v_document ->> 'posting_locked_at', '') is not null
         or nullif(v_document ->> 'revenue_posted_at', '') is not null
         or coalesce((v_document ->> 'revenue_posted')::boolean, false)
         -- `deferred` means the revenue posting was postponed, not completed.
         -- Actual posting markers and lifecycle events above/below still block.
         or coalesce(v_document ->> 'revenue_posting_state', 'not_posted')
              not in ('not_posted', 'deferred')
         or nullif(v_document ->> 'cash_receipt_posted_at', '') is not null
         or nullif(v_document ->> 'receipt_submitted_at', '') is not null
         or nullif(v_document ->> 'receipt_reviewed_at', '') is not null
         or coalesce(v_document -> 'receipt_files', '[]'::jsonb) <> '[]'::jsonb
         or nullif(v_document ->> 'source_bill_id', '') is not null
         or exists (
           select 1 from public.invoice_lifecycle_events event_row
           where event_row.tenant_id = v_tenant_id
             and event_row.data_environment = v_environment
             and event_row.invoice_id = v_id
         ) then
        raise exception '發票已開立、收款、入帳或連結其他單據，不能直接抽單：%', v_id
          using errcode = '55000';
      end if;
    end if;

    v_step_updated := private.finance_income_append_step_action(
      v_step, v_actor.id, v_actor.name,
      '申請人自行抽單', v_comment, '[]'::jsonb
    ) || pg_catalog.jsonb_build_object(
      'a', 'cancelled',
      'cancelledAt', pg_catalog.now(),
      'cancelledById', v_actor.id,
      'cancelReason', v_comment
    );
    v_steps := pg_catalog.jsonb_set(
      v_steps, array[v_active_index::text], v_step_updated, false
    );

    if v_kind = 'bill' then
      update public.bills bill_row
      set steps = v_steps,
          status = 'cancelled',
          approval_status = 'cancelled',
          approval_step = v_active_index + 1
      where bill_row.tenant_id = v_tenant_id
        and bill_row.data_environment = v_environment
        and bill_row.id = v_id
        and bill_row.row_version = (v_document ->> 'row_version')::bigint
      returning bill_row.row_version into v_next_version;
    else
      update public.invoices invoice_row
      set steps = v_steps,
          status = 'cancelled',
          approval_status = 'cancelled',
          approval_step = v_active_index + 1,
          updated_at = pg_catalog.now()
      where invoice_row.tenant_id = v_tenant_id
        and invoice_row.data_environment = v_environment
        and invoice_row.id = v_id
        and invoice_row.row_version = (v_document ->> 'row_version')::bigint
      returning invoice_row.row_version into v_next_version;
    end if;
    if not found then
      raise exception '抽單時資料版本已變更，整批未寫入：%', v_id
        using errcode = '40001';
    end if;
    -- Existing synchronization triggers log warnings and swallow exceptions.
    -- Run the three financial projections directly so a failed projection
    -- rolls back the source cancellation and every sibling in this batch.
    if v_kind = 'bill' then
      perform private.upsert_bill_collection_followup(v_id);
      perform private.upsert_bill_income_closure(v_id);
      perform private.upsert_cash_evidence_for_bill(v_id);
    else
      perform private.upsert_invoice_collection_followup(v_id);
      perform private.upsert_invoice_income_closure(v_id);
      perform private.upsert_cash_evidence_for_invoice(v_id);
    end if;
    if not exists (
      select 1 from public.collection_followups followup_row
      where followup_row.tenant_id = v_tenant_id
        and followup_row.data_environment = v_environment
        and followup_row.source_table = v_kind || 's'
        and followup_row.source_id = v_id
        and followup_row.outstanding_amount = 0
        and followup_row.payment_status = 'voided'
        and followup_row.followup_status = 'void'
    ) or not exists (
      select 1 from public.income_document_closure_cases closure_row
      where closure_row.tenant_id = v_tenant_id
        and closure_row.data_environment = v_environment
        and closure_row.source_table = v_kind || 's'
        and closure_row.source_id = v_id
        and closure_row.closure_status = 'closed_void'
    ) or not exists (
      select 1 from public.cash_movement_evidence_links cash_row
      where cash_row.tenant_id = v_tenant_id
        and cash_row.data_environment = v_environment
        and cash_row.source_table = v_kind || 's'
        and cash_row.source_id = v_id
        and cash_row.cash_stage = 'void'
    ) then
      raise exception '抽單後應收、現金或結案資料未同步，整批已回復：%', v_id
        using errcode = '55000';
    end if;
    v_result_rows := v_result_rows || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'id', v_id,
        'no', v_document ->> 'no',
        'action', 'withdraw',
        'status', 'cancelled',
        'approval_status', 'cancelled',
        'approval_step', v_active_index + 1,
        'row_version', v_next_version
      )
    );
  end loop;

  v_result := pg_catalog.jsonb_build_object(
    'ok', true,
    'idempotent_replay', false,
    'document_type', v_kind,
    'action', 'withdraw',
    'idempotency_key', p_idempotency_key,
    'count', pg_catalog.jsonb_array_length(v_result_rows),
    'rows', v_result_rows
  );
  perform private.finance_income_finish_operation(
    v_tenant_id, v_environment, v_operation_type,
    p_idempotency_key, v_result
  );
  return v_result;
end;
$function$;

revoke all on function private.finance_income_withdraw_applicant_v1(
  text,text[],text,text,jsonb,text
) from public, anon, authenticated, service_role;

create or replace function public.finance_bill_withdraw_applicant_v1(
  p_bill_ids text[],
  p_idempotency_key text,
  p_comment text,
  p_expected_steps jsonb,
  p_data_environment text default 'production'
) returns jsonb
language plpgsql
security definer
set search_path to ''
set lock_timeout to '5s'
as $function$
begin
  return private.finance_income_withdraw_applicant_v1(
    'bill', p_bill_ids, p_idempotency_key, p_comment,
    p_expected_steps, p_data_environment
  );
end;
$function$;

create or replace function public.finance_invoice_withdraw_applicant_v1(
  p_invoice_ids text[],
  p_idempotency_key text,
  p_comment text,
  p_expected_steps jsonb,
  p_data_environment text default 'production'
) returns jsonb
language plpgsql
security definer
set search_path to ''
set lock_timeout to '5s'
as $function$
begin
  return private.finance_income_withdraw_applicant_v1(
    'invoice', p_invoice_ids, p_idempotency_key, p_comment,
    p_expected_steps, p_data_environment
  );
end;
$function$;

revoke all on function public.finance_bill_withdraw_applicant_v1(
  text[],text,text,jsonb,text
) from public, anon, authenticated;
revoke all on function public.finance_invoice_withdraw_applicant_v1(
  text[],text,text,jsonb,text
) from public, anon, authenticated;
grant execute on function public.finance_bill_withdraw_applicant_v1(
  text[],text,text,jsonb,text
) to authenticated, service_role;
grant execute on function public.finance_invoice_withdraw_applicant_v1(
  text[],text,text,jsonb,text
) to authenticated, service_role;

comment on function public.finance_bill_withdraw_applicant_v1(
  text[],text,text,jsonb,text
) is '原申請人整批抽回未結案繳費單；保留簽核稽核紀錄與冪等操作紀錄';
comment on function public.finance_invoice_withdraw_applicant_v1(
  text[],text,text,jsonb,text
) is '原申請人整批抽回未開立或入帳的發票申請；保留簽核稽核紀錄與冪等操作紀錄';
