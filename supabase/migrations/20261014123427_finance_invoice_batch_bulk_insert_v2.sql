-- Preserve the exact live validation/authority contracts while replacing repeated work.
set local lock_timeout = '5s';
set local statement_timeout = '60s';
do $guard$
begin
  if (select md5(prosrc) from pg_proc where oid='public.finance_submit_invoice_batch(text,jsonb,text)'::regprocedure) is distinct from '9a5ffcb22087913916545381e28a7158'
     or (select md5(prosrc) from pg_proc where oid='public.finance_submit_bill_batch(text,jsonb,text)'::regprocedure) is distinct from 'cb5815484b3f90c0f4a73bf4461021d5'
     or (select md5(prosrc) from pg_proc where oid='private.finance_history_projection_source_trigger_v1()'::regprocedure) is distinct from 'dacedbff7dc0b1a6ea7a1361951cc6bd'
     or (select md5(prosrc) from pg_proc where oid='private.finance_refresh_invoice_batch_approval_notification_v1()'::regprocedure) is distinct from 'dda1bdef0235a592beddc380dec514f5'
     or (select md5(prosrc) from pg_proc where oid='private.finance_enqueue_current_approval_email()'::regprocedure) is distinct from 'ebae3a8045744a11bfa2892f04d80f2f'
     or not exists(select 1 from pg_trigger where tgrelid='public.invoices'::regclass and tgname='finance_history_projection_insert_v1' and tgenabled='O' and tgtype=4 and tgnewtable='new_source' and tgfoid='private.finance_history_projection_source_trigger_v1()'::regprocedure)
     or not exists(select 1 from pg_trigger where tgrelid='public.invoices'::regclass and tgname='trg_zz_invoices_refresh_batch_approval_notification_v1' and tgenabled='O' and tgtype=21 and tgfoid='private.finance_refresh_invoice_batch_approval_notification_v1()'::regprocedure)
     or to_regprocedure('private.finance_refresh_invoice_batch_approval_notification_statement_v2()') is not null
  then
    raise exception 'Invoice submission/notification source drifted; review before bulk repair' using errcode='55000';
  end if;
end;
$guard$;

CREATE OR REPLACE FUNCTION public.finance_submit_invoice_batch(p_idempotency_key text, p_items jsonb, p_data_environment text DEFAULT 'production'::text)
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
  v_tax numeric;
  v_total numeric;
  v_invoice_date date;
  v_identifier_type text;
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
  v_source_bill_id text;
begin
  if auth.uid() is null then
    raise exception '請先登入後再送出發票'
      using errcode = '42501';
  end if;
  if v_environment not in ('production', 'test') then
    raise exception '資料環境只允許 production 或 test'
      using errcode = '22023';
  end if;

  v_tenant_id := public.current_tenant_id();
  -- Reuse the canonical portal boundary: live session, verified Google
  -- identity, active employee and tenant must all agree before any write/replay.
  v_actor := public.current_finance_user();
  if v_actor.id is null or v_actor.tenant_id is distinct from v_tenant_id then
    raise exception '目前登入帳號沒有此租戶的有效財務人員身分'
      using errcode = '42501';
  end if;

  perform private.finance_income_assert_items_with_limit(p_items, 500);
  v_digest := private.finance_income_request_digest(
    pg_catalog.jsonb_build_object(
      'operation', 'invoice_submit',
      'environment', v_environment,
      'items', p_items
    )
  );
  v_cached := private.finance_income_begin_operation(
    v_tenant_id,
    v_environment,
    'invoice_submit',
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
      'invoice_batch',
      v_period
    );
    v_batch_id := case
      when v_environment = 'test' then 'TEST-INVB-'
      else 'INVB-'
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

    if coalesce(pg_catalog.btrim(v_item ->> 'buyer'), '') = '' then
      raise exception '第 % 筆發票缺少買受人', v_item_index
        using errcode = '22023';
    end if;
    if coalesce(v_item ->> 'amount', '') !~
       '^[0-9]+([.][0-9]{1,2})?$'
       or coalesce(v_item ->> 'tax', '') !~
       '^[0-9]+([.][0-9]{1,2})?$'
       or coalesce(v_item ->> 'total', '') !~
       '^[0-9]+([.][0-9]{1,2})?$' then
      raise exception '第 % 筆發票金額格式錯誤', v_item_index
        using errcode = '22003';
    end if;

    v_amount := (v_item ->> 'amount')::numeric;
    v_tax := (v_item ->> 'tax')::numeric;
    v_total := (v_item ->> 'total')::numeric;
    if pg_catalog.abs(v_total - (v_amount + v_tax)) > 0.01 then
      raise exception '第 % 筆發票未稅金額加稅額不等於含稅總額', v_item_index
        using errcode = '23514';
    end if;

    v_invoice_date := coalesce(
      nullif(v_item ->> 'invoice_date', '')::date,
      current_date
    );
    v_identifier_type := public.normalize_invoice_identifier_type(
      coalesce(v_item ->> 'invoice_identifier_type', '電子發票')
    );
    if v_identifier_type not in (
      '電子發票',
      '統一編號',
      '電子發票（載具）',
      '領據'
    ) then
      raise exception '第 % 筆發票開立方式不支援', v_item_index
        using errcode = '23514';
    end if;

    v_route := private.finance_income_validate_submission_steps(
      v_item -> 'steps',
      v_actor.id,
      v_tenant_id
    );
    v_steps := v_route -> 'steps';
    v_source_bill_id := nullif(v_item ->> 'source_bill_id', '');

    if v_source_bill_id is not null and not exists (
      select 1
      from public.bills source_bill
      where source_bill.id = v_source_bill_id
        and source_bill.tenant_id = v_tenant_id
        and source_bill.data_environment = v_environment
    ) then
      raise exception '第 % 筆發票來源繳費單不存在或跨租戶', v_item_index
        using errcode = '23503';
    end if;

    v_seq := private.finance_income_next_number(
      v_tenant_id,
      v_environment,
      'invoice',
      v_period
    );
    v_no := case
      when v_environment = 'test' then 'TEST-INV-'
      else 'INV-'
    end || v_period || '-' ||
      pg_catalog.upper(v_tenant_token) || '-' ||
      pg_catalog.lpad(v_seq::text, 6, '0');
    v_id := case
      when v_environment = 'test' then 'test_inv_'
      else 'inv_'
    end || v_period || '_' || v_tenant_token || '_' ||
      pg_catalog.lpad(v_seq::text, 6, '0');

    -- Preserve every validated value and the allocation order; write once below.
    v_prepared_rows := v_prepared_rows || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'id', v_id,
        'no', v_no,
        'entity_id', v_entity_id,
        'entity_name', v_entity_name,
        'buyer', pg_catalog.btrim(v_item ->> 'buyer'),
        'amount', v_amount,
        'tax', v_tax,
        'total', v_total,
        'invoice_date', v_invoice_date,
        'status', 'unpaid',
        'description', nullif(pg_catalog.btrim(v_item ->> 'description'), ''),
        'department_code', v_department_code,
        'tax_id', nullif(pg_catalog.btrim(v_item ->> 'tax_id'), ''),
        'applicant', v_actor.name,
        'applicant_id', v_actor.id,
        'batch_id', v_batch_id,
        'approval_status', v_route ->> 'approval_status',
        'approval_step', (v_route ->> 'approval_step')::int,
        'steps', v_steps,
        'receipt_files', '[]'::jsonb,
        'data_environment', v_environment,
        'invoice_identifier_type', v_identifier_type,
        'invoice_item_type', nullif(pg_catalog.btrim(v_item ->> 'invoice_item_type'), ''),
        'payer_type', nullif(pg_catalog.btrim(v_item ->> 'payer_type'), ''),
        'funding_source', nullif(pg_catalog.btrim(v_item ->> 'funding_source'), ''),
        'service_period', nullif(pg_catalog.btrim(v_item ->> 'service_period'), ''),
        'contract_no', nullif(pg_catalog.btrim(v_item ->> 'contract_no'), ''),
        'source_bill_id', v_source_bill_id,
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

  -- All row-level guards and business triggers still run for every invoice.
  -- The statement history projection sees the complete batch exactly once.
  insert into public.invoices (
    id, no, entity_id, entity_name, buyer, amount, tax, total, invoice_date, status, description, department_code, tax_id, applicant, applicant_id, batch_id, approval_status, approval_step, steps, receipt_files, data_environment, invoice_identifier_type, invoice_item_type, payer_type, funding_source, service_period, contract_no, source_bill_id, tenant_id, submission_idempotency_key, submission_item_key, submission_request_digest, submission_actor_finance_user_id
  )
  select
    staged.id, staged.no, staged.entity_id, staged.entity_name, staged.buyer, staged.amount, staged.tax, staged.total, staged.invoice_date, staged.status, staged.description, staged.department_code, staged.tax_id, staged.applicant, staged.applicant_id, staged.batch_id, staged.approval_status, staged.approval_step, staged.steps, staged.receipt_files, staged.data_environment, staged.invoice_identifier_type, staged.invoice_item_type, staged.payer_type, staged.funding_source, staged.service_period, staged.contract_no, staged.source_bill_id, staged.tenant_id, staged.submission_idempotency_key, staged.submission_item_key, staged.submission_request_digest, staged.submission_actor_finance_user_id
  from pg_catalog.jsonb_populate_recordset(null::public.invoices, v_prepared_rows)
    with ordinality as staged
  order by staged.ordinality;

  v_result := pg_catalog.jsonb_build_object(
    'ok', true,
    'idempotent_replay', false,
    'document_type', 'invoice',
    'idempotency_key', p_idempotency_key,
    'batch_id', v_batch_id,
    'count', pg_catalog.jsonb_array_length(v_result_rows),
    'rows', v_result_rows
  );

  perform private.finance_income_finish_operation(
    v_tenant_id,
    v_environment,
    'invoice_submit',
    p_idempotency_key,
    v_result
  );
  return v_result;
end;
$function$
;
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
  -- Reuse the canonical portal boundary: live session, verified Google
  -- identity, active employee and tenant must all agree before any write/replay.
  v_actor := public.current_finance_user();
  if v_actor.id is null or v_actor.tenant_id is distinct from v_tenant_id then
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
$function$
;

CREATE OR REPLACE FUNCTION private.finance_refresh_invoice_batch_approval_notification_statement_v2()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_batch_id text;
  v_groups jsonb;
  v_group jsonb;
  v_invoice_count bigint;
  v_total_count bigint;
  v_gross_total numeric;
  v_gross_display text;
begin
  if tg_table_schema <> 'public' or tg_table_name <> 'invoices' or tg_level <> 'STATEMENT' then
    raise exception 'Invalid invoice batch notification statement trigger' using errcode='42501';
  end if;
  if tg_op = 'INSERT' then
    select coalesce(jsonb_agg(distinct jsonb_build_object(
      'tenant_id', n.tenant_id, 'data_environment', n.data_environment,
      'batch_id', nullif(btrim(n.batch_id), ''))), '[]'::jsonb)
    into v_groups from invoice_batch_new n;
  elsif tg_op = 'UPDATE' then
    select coalesce(jsonb_agg(distinct jsonb_build_object(
      'tenant_id', changed.tenant_id, 'data_environment', changed.data_environment,
      'batch_id', nullif(btrim(changed.batch_id), ''))), '[]'::jsonb)
    into v_groups
    from (
      select n.tenant_id,n.data_environment,n.batch_id
      from invoice_batch_new n join invoice_batch_old o on n.id=o.id
      where row(n.tenant_id,n.data_environment,n.status,n.approval_status,n.approval_step,n.steps,n.batch_id,n.amount,n.tax,n.total)
        is distinct from row(o.tenant_id,o.data_environment,o.status,o.approval_status,o.approval_step,o.steps,o.batch_id,o.amount,o.tax,o.total)
      union
      select o.tenant_id,o.data_environment,o.batch_id
      from invoice_batch_old o join invoice_batch_new n on n.id=o.id
      where row(n.tenant_id,n.data_environment,n.status,n.approval_status,n.approval_step,n.steps,n.batch_id,n.amount,n.tax,n.total)
        is distinct from row(o.tenant_id,o.data_environment,o.status,o.approval_status,o.approval_step,o.steps,o.batch_id,o.amount,o.tax,o.total)
    ) changed;
  else
    raise exception 'Unsupported invoice batch notification operation' using errcode='42501';
  end if;
  for v_group in select value from jsonb_array_elements(v_groups)
    order by value->>'tenant_id', value->>'data_environment', value->>'batch_id'
  loop
    v_batch_id := v_group->>'batch_id';
    if v_batch_id is null or v_group->>'data_environment' <> 'production' then continue; end if;
  -- This scope is identical to the enqueue trigger's tenant/environment/group
  -- identity. Never total a sibling from another tenant or environment.
  select pg_catalog.count(*), pg_catalog.count(i.total), pg_catalog.sum(i.total)
  into v_invoice_count, v_total_count, v_gross_total
  from public.invoices i
  where i.tenant_id = (v_group->>'tenant_id')::uuid
    and i.data_environment = v_group->>'data_environment'
    and i.batch_id = v_batch_id;

  -- The canonical submit RPC validates every gross total. An incomplete
  -- legacy row must never be presented as a confirmed gross batch amount.
  if v_invoice_count < 2 or v_total_count <> v_invoice_count then
    continue;
  end if;

  v_gross_display := pg_catalog.regexp_replace(
    pg_catalog.to_char(v_gross_total, 'FM999,999,999,999,999,999,990.00'),
    '[.]00$', ''
  );

  update public.notification_delivery_events e
  set title = '待您簽核｜開立發票 ' || v_invoice_count::text || ' 張・NT$'
      || v_gross_display || '｜'
      || coalesce(nullif(e.payload ->> 'approval_role_label', ''), '簽核人'),
      body = coalesce(nullif(e.payload ->> 'recipient_name', ''), '同仁')
      || '您好，您已收到一批開立發票簽核待辦，共 ' || v_invoice_count::text
      || ' 張，含稅總額 NT$' || v_gross_display || '。批次編號：' || v_batch_id
      || '。目前關卡為「'
      || coalesce(nullif(e.payload ->> 'approval_role_label', ''), '簽核人')
      || '」。請登入歲悅財務系統檢視並簽核整批，以利流程進入下一關。',
      payload = e.payload || pg_catalog.jsonb_build_object(
        'batch_count', v_invoice_count,
        'batch_total', v_gross_total::text,
        'amount', v_gross_total::text,
        'amount_kind', 'gross_batch_total'
      )
  from private.approval_notification_assignment_state s
  where s.tenant_id = (v_group->>'tenant_id')::uuid
    and s.data_environment = v_group->>'data_environment'
    and s.source_table = 'invoices'
    and s.source_group_id = v_batch_id
    and s.notification_event_id = e.id
    and e.tenant_id = (v_group->>'tenant_id')::uuid
    and e.data_environment = v_group->>'data_environment'
    and e.event_type = 'approval_task_assigned'
    and e.status = 'pending'
    and e.payload ->> 'source_table' = 'invoices'
    and e.payload ->> 'source_group_id' = v_batch_id
    and e.payload ->> 'source_id' = s.source_record_id
    and e.payload ->> 'source_no' = e.request_id
    and e.payload ->> 'recipient_finance_user_id' = s.recipient_finance_user_id;

  end loop;
  return null;
end;
$function$
;

alter function public.finance_submit_invoice_batch(text,jsonb,text) owner to postgres;
revoke all on function public.finance_submit_invoice_batch(text,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function public.finance_submit_invoice_batch(text,jsonb,text) to authenticated,service_role;
alter function private.finance_refresh_invoice_batch_approval_notification_statement_v2() owner to postgres;
revoke all on function private.finance_refresh_invoice_batch_approval_notification_statement_v2() from public,anon,authenticated,service_role;

-- Every row-level authorization/business trigger remains installed. Only the
-- derived notification summary moves to statement scope, after row enqueue.
drop trigger trg_zz_invoices_refresh_batch_approval_notification_v1 on public.invoices;
create trigger trg_zz_invoices_refresh_batch_approval_notification_insert_v2
after insert on public.invoices referencing new table as invoice_batch_new
for each statement execute function private.finance_refresh_invoice_batch_approval_notification_statement_v2();
create trigger trg_zz_invoices_refresh_batch_approval_notification_update_v2
after update on public.invoices referencing old table as invoice_batch_old new table as invoice_batch_new
for each statement execute function private.finance_refresh_invoice_batch_approval_notification_statement_v2();
create index invoices_tenant_environment_batch_v2_idx
on public.invoices(tenant_id,data_environment,batch_id) where batch_id is not null;
comment on function public.finance_submit_invoice_batch(text,jsonb,text)
is 'Validated idempotent invoice batch, one atomic INSERT; row guards preserved, history and pending notification summaries refreshed once per statement.';
comment on function private.finance_refresh_invoice_batch_approval_notification_statement_v2()
is 'Refresh unsent approval batch totals after all row enqueue events; tenant/environment identity and original direct link preserved.';


alter function public.finance_submit_bill_batch(text,jsonb,text) owner to postgres;
revoke all on function public.finance_submit_bill_batch(text,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function public.finance_submit_bill_batch(text,jsonb,text) to authenticated,service_role;
