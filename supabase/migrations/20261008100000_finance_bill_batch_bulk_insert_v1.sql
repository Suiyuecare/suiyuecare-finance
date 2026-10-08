-- Bulk bill insert keeps all per-row validation, numbering and business triggers,
-- but avoids repeated history-group rebuilds for every row in one batch.
-- Captured from the live 2026-10-08 function; fail closed on source drift.
do $guard$
begin
  if (
    select pg_catalog.md5(p.prosrc)
    from pg_catalog.pg_proc p
    where p.oid = 'public.finance_submit_bill_batch(text,jsonb,text)'::pg_catalog.regprocedure
  ) is distinct from '5ecf99368dc04b576651475c42199c8e' then
    raise exception 'Bill submit function drifted; review before bulk-insert repair'
      using errcode = '55000';
  end if;
  if (
    select pg_catalog.md5(p.prosrc)
    from pg_catalog.pg_proc p
    where p.oid = 'private.finance_history_projection_source_trigger_v1()'::pg_catalog.regprocedure
  ) is distinct from 'dacedbff7dc0b1a6ea7a1361951cc6bd' then
    raise exception 'History projection trigger function drifted; review bill batch repair'
      using errcode = '55000';
  end if;
  if not exists (
    select 1
    from pg_catalog.pg_trigger t
    where t.tgrelid = 'public.bills'::pg_catalog.regclass
      and t.tgname = 'finance_history_projection_insert_v1'
      and t.tgenabled = 'O'
      and t.tgnewtable = 'new_source'
      and t.tgtype = 4
      and t.tgfoid = 'private.finance_history_projection_source_trigger_v1()'::pg_catalog.regprocedure
  ) then
    raise exception 'Bill history statement trigger drifted'
      using errcode = '55000';
  end if;
end;
$guard$;

CREATE OR REPLACE FUNCTION public.finance_submit_bill_batch(p_idempotency_key text, p_items jsonb, p_data_environment text DEFAULT 'production'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tenant_id uuid;
  v_actor public.finance_users%rowtype;
  v_environment text := pg_catalog.lower(coalesce(p_data_environment, 'production'));
  v_digest text;
  v_cached jsonb;
  v_item jsonb;
  v_item_index int;
  v_item_key text;
  v_entity_id text;
  v_entity_name text;
  v_department_code text;
  v_amount numeric;
  v_due_date date;
  v_route jsonb;
  v_steps jsonb;
  v_seq bigint;
  v_batch_seq bigint;
  v_period text := pg_catalog.to_char(current_date, 'YYYYMM');
  v_tenant_token text;
  v_id text;
  v_no text;
  v_batch_id text;
  v_prepared_rows jsonb := '[]'::jsonb;
  v_result_rows jsonb := '[]'::jsonb;
  v_result jsonb;
begin
  if auth.uid() is null then
    raise exception '請先登入後再送出繳費單'
      using errcode = '42501';
  end if;
  if v_environment not in ('production', 'test') then
    raise exception '資料環境只允許 production 或 test'
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

  perform private.finance_income_assert_items_with_limit(p_items, 150);
  v_digest := private.finance_income_request_digest(
    pg_catalog.jsonb_build_object(
      'operation', 'bill_submit',
      'environment', v_environment,
      'items', p_items
    )
  );
  v_cached := private.finance_income_begin_operation(
    v_tenant_id,
    v_environment,
    'bill_submit',
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

  v_tenant_token := pg_catalog.replace(
    pg_catalog.left(v_tenant_id::text, 8),
    '-',
    ''
  );

  if pg_catalog.jsonb_array_length(p_items) > 1 then
    v_batch_seq := private.finance_income_next_number(
      v_tenant_id,
      v_environment,
      'bill_batch',
      v_period
    );
    v_batch_id := case
      when v_environment = 'test' then 'TEST-BILLB-'
      else 'BILLB-'
    end || v_period || '-' ||
      pg_catalog.upper(v_tenant_token) || '-' ||
      pg_catalog.lpad(v_batch_seq::text, 6, '0');
  end if;

  for v_item, v_item_index in
    select item_value, ordinality::int
    from pg_catalog.jsonb_array_elements(p_items)
      with ordinality as item_rows(item_value, ordinality)
  loop
    v_item_key := v_item ->> 'client_item_key';
    v_entity_id := pg_catalog.btrim(coalesce(v_item ->> 'entity_id', ''));
    v_department_code := pg_catalog.upper(
      pg_catalog.btrim(coalesce(v_item ->> 'department_code', ''))
    );
    v_entity_name := private.finance_income_validate_scope(
      v_tenant_id,
      v_entity_id,
      v_department_code
    );

    if coalesce(pg_catalog.btrim(v_item ->> 'item'), '') = '' then
      raise exception '第 % 筆繳費單缺少項目名稱', v_item_index
        using errcode = '22023';
    end if;
    if coalesce(pg_catalog.btrim(v_item ->> 'payer_name'), '') = '' then
      raise exception '第 % 筆繳費單缺少繳費人名稱', v_item_index
        using errcode = '22023';
    end if;
    if coalesce(v_item ->> 'amount', '') !~
       '^[0-9]+([.][0-9]{1,2})?$' then
      raise exception '第 % 筆繳費單金額格式錯誤', v_item_index
        using errcode = '22003';
    end if;

    v_amount := (v_item ->> 'amount')::numeric;
    if v_amount <= 0 then
      raise exception '第 % 筆繳費單金額必須大於零', v_item_index
        using errcode = '23514';
    end if;
    v_due_date := coalesce(
      nullif(v_item ->> 'due_date', '')::date,
      current_date
    );

    v_route := private.finance_income_validate_submission_steps(
      v_item -> 'steps',
      v_actor.id,
      v_tenant_id
    );
    v_steps := v_route -> 'steps';

    v_seq := private.finance_income_next_number(
      v_tenant_id,
      v_environment,
      'bill',
      v_period
    );
    v_no := case
      when v_environment = 'test' then 'TEST-BILL-'
      else 'BILL-'
    end || v_period || '-' ||
      pg_catalog.upper(v_tenant_token) || '-' ||
      pg_catalog.lpad(v_seq::text, 6, '0');
    v_id := case
      when v_environment = 'test' then 'test_bill_'
      else 'bill_'
    end || v_period || '_' || v_tenant_token || '_' ||
      pg_catalog.lpad(v_seq::text, 6, '0');

    -- Keep per-item validation, route resolution and number allocation in order.
    -- Stage the already validated values so the history AFTER STATEMENT trigger
    -- sees the complete batch once; every BEFORE/AFTER ROW trigger still fires.
    v_prepared_rows := v_prepared_rows || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'id', v_id,
        'no', v_no,
        'item', pg_catalog.btrim(v_item ->> 'item'),
        'item_key', nullif(pg_catalog.btrim(v_item ->> 'item_key'), ''),
        'entity_id', v_entity_id,
        'entity_name', v_entity_name,
        'amount', v_amount,
        'due_date', v_due_date,
        'method', coalesce(nullif(pg_catalog.btrim(v_item ->> 'method'), ''), '繳費單'),
        'note', nullif(pg_catalog.btrim(v_item ->> 'note'), ''),
        'status', 'unpaid',
        'applicant', v_actor.name,
        'applicant_id', v_actor.id,
        'applicant_email', v_actor.email,
        'department_code', v_department_code,
        'approval_status', v_route ->> 'approval_status',
        'approval_step', (v_route ->> 'approval_step')::int,
        'steps', v_steps,
        'payer_name', pg_catalog.btrim(v_item ->> 'payer_name'),
        'service_period', nullif(pg_catalog.btrim(v_item ->> 'service_period'), ''),
        'invoice_followup_status', 'unreviewed',
        'data_environment', v_environment,
        'batch_id', v_batch_id,
        'tenant_id', v_tenant_id,
        'submission_idempotency_key', p_idempotency_key,
        'submission_item_key', v_item_key,
        'submission_request_digest', v_digest,
        'submission_actor_finance_user_id', v_actor.id
      )
    );

    v_result_rows := v_result_rows || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'client_item_key', v_item_key,
        'id', v_id,
        'no', v_no,
        'batch_id', v_batch_id,
        'approval_status', v_route ->> 'approval_status',
        'approval_step', (v_route ->> 'approval_step')::int
      )
    );
  end loop;
  -- A single INSERT preserves all row-level business triggers while invoking
  -- the history projection's AFTER STATEMENT batch refresh only once.
  insert into public.bills (
    id, no, item, item_key, entity_id, entity_name, amount, due_date,
    method, note, status, applicant, applicant_id, applicant_email,
    department_code, approval_status, approval_step, steps, payer_name,
    service_period, invoice_followup_status, data_environment, batch_id,
    tenant_id, submission_idempotency_key, submission_item_key,
    submission_request_digest, submission_actor_finance_user_id
  )
  select
    staged.id, staged.no, staged.item, staged.item_key,
    staged.entity_id, staged.entity_name, staged.amount, staged.due_date,
    staged.method, staged.note, staged.status, staged.applicant,
    staged.applicant_id, staged.applicant_email, staged.department_code,
    staged.approval_status, staged.approval_step, staged.steps,
    staged.payer_name, staged.service_period,
    staged.invoice_followup_status, staged.data_environment,
    staged.batch_id, staged.tenant_id,
    staged.submission_idempotency_key, staged.submission_item_key,
    staged.submission_request_digest,
    staged.submission_actor_finance_user_id
  from pg_catalog.jsonb_populate_recordset(
    null::public.bills, v_prepared_rows
  ) with ordinality as staged
  order by staged.ordinality;

  v_result := pg_catalog.jsonb_build_object(
    'ok', true,
    'idempotent_replay', false,
    'document_type', 'bill',
    'idempotency_key', p_idempotency_key,
    'batch_id', v_batch_id,
    'count', pg_catalog.jsonb_array_length(v_result_rows),
    'rows', v_result_rows
  );

  perform private.finance_income_finish_operation(
    v_tenant_id,
    v_environment,
    'bill_submit',
    p_idempotency_key,
    v_result
  );
  return v_result;
end;
$function$;

-- Existing callable roles and SECURITY DEFINER boundary are preserved.
alter function public.finance_submit_bill_batch(text,jsonb,text) owner to postgres;
revoke all on function public.finance_submit_bill_batch(text,jsonb,text)
  from public, anon, authenticated, service_role;
grant execute on function public.finance_submit_bill_batch(text,jsonb,text)
  to authenticated, service_role;
comment on function public.finance_submit_bill_batch(text,jsonb,text)
  is 'Validated and idempotent bill submission with one atomic bulk INSERT per batch.';
