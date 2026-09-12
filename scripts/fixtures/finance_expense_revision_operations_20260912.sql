-- Catalog-only read-only snapshot, 2026-09-12. No identities or business rows.
CREATE OR REPLACE FUNCTION private.finance_income_append_step_action(p_step jsonb, p_actor_finance_user_id text, p_actor_name text, p_action_label text, p_comment text, p_files jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_comment text := coalesce(pg_catalog.btrim(p_comment), '');
  v_note text;
  v_existing_comment text := coalesce(p_step ->> 'c', '');
  v_action_log jsonb;
  v_files jsonb;
begin
  if pg_catalog.jsonb_typeof(coalesce(p_files, '[]'::jsonb)) <> 'array' then
    raise exception '附件資料必須是 JSON 陣列'
      using errcode = '22023';
  end if;

  if pg_catalog.jsonb_array_length(coalesce(p_files, '[]'::jsonb)) > 20 then
    raise exception '單次簽核附件最多 20 個'
      using errcode = '22023';
  end if;

  v_note := p_action_label || '（' || p_actor_name || '，' ||
    pg_catalog.to_char(current_date, 'MM/DD') || '）' ||
    case when v_comment <> '' then '：' || v_comment else '' end;

  v_action_log :=
    case
      when pg_catalog.jsonb_typeof(p_step -> 'actionLog') = 'array'
        then p_step -> 'actionLog'
      else '[]'::jsonb
    end
    || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'action', p_action_label,
        'by', p_actor_name,
        'byId', p_actor_finance_user_id,
        'at', pg_catalog.now(),
        'comment', v_comment
      )
    );

  v_files :=
    case
      when pg_catalog.jsonb_typeof(p_step -> 'files') = 'array'
        then p_step -> 'files'
      else '[]'::jsonb
    end
    || coalesce(p_files, '[]'::jsonb);

  return p_step || pg_catalog.jsonb_build_object(
    'n', p_actor_name,
    't', pg_catalog.to_char(current_date, 'MM/DD'),
    'c', case
      when v_existing_comment = '' then v_note
      else v_existing_comment || pg_catalog.chr(10) || v_note
    end,
    'files', v_files,
    'actionLog', v_action_log
  );
end;
$function$;

CREATE OR REPLACE FUNCTION private.finance_income_begin_operation(p_tenant_id uuid, p_data_environment text, p_operation_type text, p_idempotency_key text, p_request_digest text, p_actor_finance_user_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
    tenant_id,
    data_environment,
    operation_type,
    idempotency_key,
    request_digest,
    actor_finance_user_id
  )
  values (
    p_tenant_id,
    p_data_environment,
    p_operation_type,
    p_idempotency_key,
    p_request_digest,
    p_actor_finance_user_id
  )
  on conflict (
    tenant_id,
    data_environment,
    operation_type,
    idempotency_key
  )
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

  if v_operation.request_digest is distinct from p_request_digest then
    raise exception '相同冪等鍵已使用於不同內容，請產生新的冪等鍵'
      using errcode = '23505';
  end if;

  if v_operation.actor_finance_user_id is distinct from p_actor_finance_user_id then
    raise exception '此冪等鍵屬於另一位使用者'
      using errcode = '42501';
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

CREATE OR REPLACE FUNCTION private.finance_income_finish_operation(p_tenant_id uuid, p_data_environment text, p_operation_type text, p_idempotency_key text, p_result jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  update private.finance_income_document_operations operation_row
     set operation_status = 'completed',
         result = p_result,
         completed_at = pg_catalog.now()
   where operation_row.tenant_id = p_tenant_id
     and operation_row.data_environment = p_data_environment
     and operation_row.operation_type = p_operation_type
     and operation_row.idempotency_key = p_idempotency_key
     and operation_row.operation_status = 'in_progress';

  if not found then
    raise exception '表單操作紀錄完成狀態寫入失敗'
      using errcode = '55000';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION private.finance_income_request_digest(p_payload jsonb)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE STRICT
 SET search_path TO ''
AS $function$
  select pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(p_payload::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  )
$function$;
