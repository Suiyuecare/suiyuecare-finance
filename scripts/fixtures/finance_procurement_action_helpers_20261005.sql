-- Read-only production helper snapshots, 2026-10-05. No business data.
CREATE OR REPLACE FUNCTION private.finance_expense_new_files_are_owned(p_tenant_id uuid, p_expense expense_requests, p_old_files jsonb, p_new_files jsonb, p_actor_finance_user_id text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_old_files jsonb := case
    when pg_catalog.jsonb_typeof(p_old_files) = 'array'
      then p_old_files
    else '[]'::jsonb
  end;
  v_new_files jsonb := case
    when pg_catalog.jsonb_typeof(p_new_files) = 'array'
      then p_new_files
    else '[]'::jsonb
  end;
  v_old_length int;
  v_index int;
  v_file jsonb;
  v_path text;
begin
  v_old_length := pg_catalog.jsonb_array_length(v_old_files);
  if pg_catalog.jsonb_array_length(v_new_files) < v_old_length then
    return false;
  end if;

  if v_old_length > 0 then
    for v_index in 0..v_old_length - 1 loop
      if v_old_files -> v_index <> v_new_files -> v_index then
        return false;
      end if;
    end loop;
  end if;

  if pg_catalog.jsonb_array_length(v_new_files) = v_old_length then
    return true;
  end if;

  for v_index in
    v_old_length..pg_catalog.jsonb_array_length(v_new_files) - 1
  loop
    v_file := v_new_files -> v_index;
    v_path := coalesce(
      v_file ->> 'path',
      v_file ->> 'storagePath',
      v_file ->> 'storage_path',
      ''
    );

    if pg_catalog.jsonb_typeof(v_file) <> 'object'
       or coalesce(
         v_file ->> 'bucket',
         v_file ->> 'storage_bucket',
         ''
       ) <> 'finance-attachments'
       or v_path = ''
       or coalesce(
         v_file ->> 'dataEnv',
         v_file ->> 'data_environment',
         ''
       ) <> p_expense.data_environment
       or not exists (
         select 1
         from public.file_attachments attachment_row
         join storage.objects storage_object
           on storage_object.bucket_id = attachment_row.bucket_id
          and storage_object.name = attachment_row.storage_path
         where attachment_row.tenant_id = p_tenant_id
           and attachment_row.bucket_id = 'finance-attachments'
           and attachment_row.storage_path = v_path
           and attachment_row.record_type in (
             'expense_request',
             'expense_requests'
           )
           and attachment_row.record_no = p_expense.no
           and attachment_row.data_environment =
               p_expense.data_environment
           and attachment_row.uploaded_by =
               p_actor_finance_user_id
       ) then
      return false;
    end if;
  end loop;

  return true;
end;
$function$;

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

CREATE OR REPLACE FUNCTION private.finance_income_status_from_steps(p_steps jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare
  v_index int;
  v_step jsonb;
begin
  v_index := private.finance_income_active_step_index(p_steps);
  if v_index is null then
    return pg_catalog.jsonb_build_object(
      'approval_status', 'completed',
      'approval_step', greatest(
        pg_catalog.jsonb_array_length(coalesce(p_steps, '[]'::jsonb)),
        1
      )
    );
  end if;

  v_step := p_steps -> v_index;
  return pg_catalog.jsonb_build_object(
    'approval_status', coalesce(
      nullif(v_step ->> 'status', ''),
      'pending_approval'
    ),
    'approval_step', v_index + 1
  );
end;
$function$;
