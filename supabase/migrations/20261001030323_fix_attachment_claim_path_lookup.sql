-- Preserve the existing attachment ownership and legacy-link guards while
-- driving the final claimed-attachment check from paths in the new document.
-- This avoids JSON path evaluation across every claimed attachment in a tenant.
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
            when 'bills' then exists(select 1 from public.bills origin
              where origin.id=original_link.parent_key and origin.tenant_id=v_tenant_id
                and public.can_read_bill(origin))
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

-- Reassert the pre-existing private trigger privilege boundary.
ALTER FUNCTION private.finance_claim_attachment_metadata_v2() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.finance_claim_attachment_metadata_v2() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.finance_claim_attachment_metadata_v2() TO service_role;
