-- An ambiguous network result must never create a second invoice/bill batch.
-- A canceled operation row is a durable tombstone. Its unique key serializes
-- reconciliation with an uncommitted submit transaction: reconciliation waits
-- for that transaction and reports its committed result, or wins the key after
-- rollback and prevents a late copy of the original request from committing.
do $guard$
begin
  if (
    select pg_catalog.md5(p.prosrc)
    from pg_catalog.pg_proc p
    where p.oid = 'private.finance_income_begin_operation(uuid,text,text,text,text,text)'::pg_catalog.regprocedure
  ) is distinct from 'bbf7e2d060c8de355e5ff375f52a80e9' then
    raise exception 'Income operation helper has drifted; review before installing reconciliation'
      using errcode = '55000';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_constraint c
    where c.conrelid = 'private.finance_income_document_operations'::pg_catalog.regclass
      and c.conname = 'finance_income_document_operations_operation_status_check'
      and pg_catalog.pg_get_constraintdef(c.oid) like '%in_progress%'
      and pg_catalog.pg_get_constraintdef(c.oid) like '%completed%'
  ) then
    raise exception 'Income operation status contract has drifted'
      using errcode = '55000';
  end if;
end;
$guard$;

alter table private.finance_income_document_operations
  drop constraint finance_income_document_operations_operation_status_check;
alter table private.finance_income_document_operations
  add constraint finance_income_document_operations_operation_status_check
  check (operation_status in ('in_progress', 'completed', 'canceled'));

create or replace function private.finance_income_begin_operation(
  p_tenant_id uuid,
  p_data_environment text,
  p_operation_type text,
  p_idempotency_key text,
  p_request_digest text,
  p_actor_finance_user_id text
) returns jsonb
language plpgsql
set search_path to ''
as $function$
declare
  v_operation private.finance_income_document_operations%rowtype;
begin
  if coalesce(p_idempotency_key, '') !~
    '^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$' then
    raise exception
      '冪等鍵格式錯誤：請使用 8 到 200 字元的英數、句點、底線、冒號或連字號'
      using errcode = '22023';
  end if;

  insert into private.finance_income_document_operations (
    tenant_id, data_environment, operation_type, idempotency_key,
    request_digest, actor_finance_user_id
  )
  values (
    p_tenant_id, p_data_environment, p_operation_type, p_idempotency_key,
    p_request_digest, p_actor_finance_user_id
  )
  on conflict (tenant_id, data_environment, operation_type, idempotency_key)
  do nothing;

  select operation_row.*
    into v_operation
  from private.finance_income_document_operations operation_row
  where operation_row.tenant_id = p_tenant_id
    and operation_row.data_environment = p_data_environment
    and operation_row.operation_type = p_operation_type
    and operation_row.idempotency_key = p_idempotency_key
  for update;

  if not found then
    raise exception '無法鎖定表單操作紀錄'
      using errcode = '55000';
  end if;

  -- Do not expose a prior actor's result or allow a canceled request to race
  -- in after reconciliation has proved that no submit transaction committed.
  if v_operation.actor_finance_user_id is distinct from p_actor_finance_user_id then
    raise exception '此冪等鍵屬於另一位使用者'
      using errcode = '42501';
  end if;
  if v_operation.operation_status = 'canceled' then
    raise exception '此送件識別碼已確認未成立；請用保留的表單重新送件'
      using errcode = '55000';
  end if;
  if v_operation.request_digest is distinct from p_request_digest then
    raise exception '相同冪等鍵已使用於不同內容，請產生新的冪等鍵'
      using errcode = '23505';
  end if;
  if v_operation.operation_status = 'completed' then
    return v_operation.result;
  end if;
  if v_operation.operation_status <> 'in_progress' then
    raise exception '表單操作紀錄狀態異常'
      using errcode = '55000';
  end if;
  return null;
end;
$function$;

create or replace function public.finance_income_reconcile_submission_v1(
  p_document_type text,
  p_idempotency_key text,
  p_data_environment text default 'production'
) returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_document_type text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_document_type, '')));
  v_environment text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_data_environment, 'production')));
  v_operation_type text;
  v_tenant_id uuid;
  v_actor public.finance_users%rowtype;
  v_operation private.finance_income_document_operations%rowtype;
  v_cancel_digest text;
begin
  if auth.uid() is null then
    raise exception '請先登入後再確認送件結果' using errcode = '42501';
  end if;
  if v_document_type not in ('invoice', 'bill') then
    raise exception '只能確認發票或繳費單送件結果' using errcode = '22023';
  end if;
  if v_environment not in ('production', 'test') then
    raise exception '資料環境只允許 production 或 test' using errcode = '22023';
  end if;
  if coalesce(p_idempotency_key, '') !~
    '^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$' then
    raise exception '送件識別碼格式錯誤' using errcode = '22023';
  end if;
  v_operation_type := v_document_type || '_submit';
  v_tenant_id := public.current_tenant_id();
  -- Reuse the portal identity boundary: it verifies the live Auth session,
  -- Google identity link and tenant. An unexpired JWT after logout is not
  -- sufficient to read a prior result or reserve a canceled operation key.
  v_actor := public.current_finance_user();
  if v_actor.id is null or v_actor.tenant_id is distinct from v_tenant_id then
    raise exception '目前登入帳號沒有此租戶的有效財務人員登入身分'
      using errcode = '42501';
  end if;

  -- A legacy inconsistency with document rows but no operation must stay
  -- unresolved for an administrator; it must never be declared rolled back.
  if v_document_type = 'invoice' and exists (
    select 1 from public.invoices document_row
    where document_row.tenant_id = v_tenant_id
      and document_row.data_environment = v_environment
      and document_row.submission_idempotency_key = p_idempotency_key
      and document_row.submission_item_key is not null
  ) then
    if not exists (
      select 1 from private.finance_income_document_operations operation_row
      where operation_row.tenant_id = v_tenant_id
        and operation_row.data_environment = v_environment
        and operation_row.operation_type = v_operation_type
        and operation_row.idempotency_key = p_idempotency_key
    ) then
      return pg_catalog.jsonb_build_object('ok', true, 'state', 'pending');
    end if;
  elsif v_document_type = 'bill' and exists (
    select 1 from public.bills document_row
    where document_row.tenant_id = v_tenant_id
      and document_row.data_environment = v_environment
      and document_row.submission_idempotency_key = p_idempotency_key
      and document_row.submission_item_key is not null
  ) then
    if not exists (
      select 1 from private.finance_income_document_operations operation_row
      where operation_row.tenant_id = v_tenant_id
        and operation_row.data_environment = v_environment
        and operation_row.operation_type = v_operation_type
        and operation_row.idempotency_key = p_idempotency_key
    ) then
      return pg_catalog.jsonb_build_object('ok', true, 'state', 'pending');
    end if;
  end if;

  v_cancel_digest := private.finance_income_request_digest(
    pg_catalog.jsonb_build_object(
      'operation', v_operation_type, 'environment', v_environment,
      'canceled_key', p_idempotency_key
    )
  );
  insert into private.finance_income_document_operations (
    tenant_id, data_environment, operation_type, idempotency_key,
    request_digest, actor_finance_user_id, operation_status, completed_at
  )
  values (
    v_tenant_id, v_environment, v_operation_type, p_idempotency_key,
    v_cancel_digest, v_actor.id, 'canceled', pg_catalog.now()
  )
  on conflict (tenant_id, data_environment, operation_type, idempotency_key)
  do nothing;

  select operation_row.*
    into v_operation
  from private.finance_income_document_operations operation_row
  where operation_row.tenant_id = v_tenant_id
    and operation_row.data_environment = v_environment
    and operation_row.operation_type = v_operation_type
    and operation_row.idempotency_key = p_idempotency_key
  for update;
  if not found then
    raise exception '無法鎖定送件操作紀錄' using errcode = '55000';
  end if;
  if v_operation.actor_finance_user_id is distinct from v_actor.id then
    raise exception '此送件識別碼屬於另一位使用者' using errcode = '42501';
  end if;

  if v_operation.operation_status = 'completed'
    and pg_catalog.jsonb_typeof(v_operation.result) = 'object'
    and v_operation.result ->> 'ok' = 'true'
    and v_operation.result ->> 'document_type' = v_document_type
    and v_operation.result ->> 'idempotency_key' = p_idempotency_key
    and pg_catalog.jsonb_typeof(v_operation.result -> 'rows') = 'array' then
    return pg_catalog.jsonb_build_object(
      'ok', true, 'state', 'committed', 'result', v_operation.result
    );
  end if;
  if v_operation.operation_status = 'canceled' then
    return pg_catalog.jsonb_build_object('ok', true, 'state', 'confirmed_not_committed');
  end if;
  return pg_catalog.jsonb_build_object('ok', true, 'state', 'pending');
end;
$function$;

alter function private.finance_income_begin_operation(uuid,text,text,text,text,text) owner to postgres;
alter function public.finance_income_reconcile_submission_v1(text,text,text) owner to postgres;
revoke all on function public.finance_income_reconcile_submission_v1(text,text,text)
  from public, anon, authenticated, service_role;
grant execute on function public.finance_income_reconcile_submission_v1(text,text,text)
  to authenticated;
comment on function public.finance_income_reconcile_submission_v1(text,text,text)
  is 'Owner-scoped, serialized confirmation of an ambiguous invoice or bill submission; canceled tombstones forbid a late original request.';
