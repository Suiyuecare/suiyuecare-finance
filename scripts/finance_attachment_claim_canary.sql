\set ON_ERROR_STOP on
-- Rollback-only, read-only equivalence probe for all three supported JSON path
-- spellings. It uses two existing attachment paths without revealing them.
begin isolation level repeatable read;
set transaction read only;
set local statement_timeout = '10s';
set local lock_timeout = '3s';

-- FINANCE_AUTHENTICATED_CANARY_CORE_BEGIN
do $canary$
declare
  v_first_path text;
  v_second_path text;
  v_missing_path constant text :=
    'expense_requests/production/__attachment_claim_canary_missing__';
  v_document jsonb;
  v_old_document jsonb;
  v_candidate text;
  v_old_match boolean;
  v_new_match boolean;
  v_path_count integer;
begin
  select attachment.storage_path
    into v_first_path
  from public.file_attachments attachment
  where attachment.tenant_id =
      '00000000-0000-0000-0000-000000000001'::uuid
    and attachment.attachment_state = 'claimed'
    and attachment.bucket_id = 'finance-attachments'
  order by attachment.id
  limit 1;

  select attachment.storage_path
    into v_second_path
  from public.file_attachments attachment
  where attachment.tenant_id =
      '00000000-0000-0000-0000-000000000001'::uuid
    and attachment.attachment_state = 'claimed'
    and attachment.bucket_id = 'finance-attachments'
    and attachment.storage_path <> v_first_path
  order by attachment.id
  limit 1;

  if v_first_path is null or v_second_path is null then
    raise exception 'attachment claim canary requires two claimed paths';
  end if;

  v_document := pg_catalog.jsonb_build_object(
    'files', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('path', v_first_path),
      pg_catalog.jsonb_build_object(
        'nested',
        pg_catalog.jsonb_build_object('storagePath', v_second_path)
      ),
      pg_catalog.jsonb_build_object('storage_path', v_missing_path),
      pg_catalog.jsonb_build_object('path', v_first_path)
    )
  );
  v_old_document := pg_catalog.jsonb_build_object(
    'files', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('path', v_first_path)
    )
  );

  select count(*) into v_path_count
  from private.finance_attachment_paths_in_document_v2(v_document);
  if v_path_count <> 3 then
    raise exception 'attachment claim path extraction changed';
  end if;

  foreach v_candidate in array array[
    v_first_path,
    v_second_path,
    v_missing_path,
    'expense_requests/production/__attachment_claim_canary_unreferenced__'
  ] loop
    v_old_match := private.finance_json_contains_attachment_path_v2(
      v_document, v_candidate
    );
    select exists (
      select 1
      from private.finance_attachment_paths_in_document_v2(v_document)
        referenced_path(storage_path)
      where referenced_path.storage_path = v_candidate
    ) into v_new_match;
    if v_old_match is distinct from v_new_match then
      raise exception 'attachment claim path-membership equivalence failed';
    end if;
  end loop;

  if not private.finance_json_contains_attachment_path_v2(
       v_old_document, v_first_path
     )
     or private.finance_json_contains_attachment_path_v2(
       v_old_document, v_second_path
     ) then
    raise exception 'attachment claim old-document exclusion changed';
  end if;

  -- A removed or missing link must remain unauthorized; the migration changes
  -- only the candidate path lookup, not the legacy-link predicate.
  if not exists (
    select 1
    from private.finance_attachment_paths_in_document_v2(v_document)
      referenced_path(storage_path)
    join public.file_attachments attachment
      on attachment.storage_path = referenced_path.storage_path
    where attachment.storage_path = v_first_path
      and attachment.tenant_id =
        '00000000-0000-0000-0000-000000000001'::uuid
      and attachment.attachment_state = 'claimed'
      and attachment.bucket_id = 'finance-attachments'
  ) then
    raise exception 'attachment claim indexed path join found no claimed row';
  end if;
end;
$canary$;
-- FINANCE_AUTHENTICATED_CANARY_CORE_END

rollback;
-- FINANCE_AUTHENTICATED_CANARY_ROLLBACK_CHECK_BEGIN
do $attachment_claim_rollback$
begin
  if current_user in ('anon', 'authenticated', 'service_role')
     or auth.uid() is not null then
    raise exception 'attachment claim canary left a browser role or user context';
  end if;
end;
$attachment_claim_rollback$;
-- FINANCE_AUTHENTICATED_CANARY_ROLLBACK_CHECK_END
select
  'FINANCE_ATTACHMENT_CLAIM_CANARY_ROLLED_BACK' as marker,
  pg_catalog.jsonb_build_object(
    'canary', 'finance_attachment_claim',
    'ok', true,
    'rolled_back', true,
    'read_only', true
  ) as attachment_claim_canary_result;
