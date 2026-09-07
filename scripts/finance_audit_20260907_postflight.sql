\set ON_ERROR_STOP on

-- Read-only contract; valid inside the batch rehearsal before ledger insertion.
do $audit_identity_attendance$
declare signature text; oid_value oid; rec record;
begin
  foreach signature in array array[
    'public.hris_create_attendance_punch(uuid,text,text,numeric,numeric,text,text,text,text,boolean,text,text,text,integer,text)',
    'public.hris_list_attendance_punches(uuid,text,text,integer)',
    'public.hris_review_attendance_punch(uuid,text,text,uuid,text)'
  ] loop
    oid_value:=to_regprocedure(signature);
    if oid_value is null then raise exception 'Attendance wrapper is missing: %',signature;end if;
    select * into rec from pg_proc where oid=oid_value;
    if not rec.prosecdef or pg_get_userbyid(rec.proowner)<>'postgres'
      or not coalesce(rec.proconfig @> array['search_path=""'],false)
      or has_function_privilege('anon',oid_value,'EXECUTE')
      or not has_function_privilege('authenticated',oid_value,'EXECUTE')
      or not has_function_privilege('service_role',oid_value,'EXECUTE') then
      raise exception 'Attendance wrapper authority is invalid: %',signature;
    end if;
    oid_value:=to_regprocedure(replace(signature,'public.','private.'));
    if oid_value is null or has_function_privilege('anon',oid_value,'EXECUTE')
      or has_function_privilege('authenticated',oid_value,'EXECUTE')
      or has_function_privilege('service_role',oid_value,'EXECUTE') then
      raise exception 'Legacy attendance delegate is exposed';
    end if;
  end loop;
  if has_table_privilege('authenticated','public.attendance_punches','INSERT')
    or has_table_privilege('authenticated','public.attendance_punches','UPDATE')
    or has_table_privilege('authenticated','public.attendance_punches','DELETE')
    or has_table_privilege('authenticated','public.attendance_punches','TRUNCATE')
    or has_table_privilege('anon','public.attendance_punches','SELECT')
    or has_table_privilege('authenticated','public.punch_correction_requests','INSERT') then
    raise exception 'Raw attendance mutation remains exposed';
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='attendance_punches'
    and policyname='attendance_tenant_read_boundary_v1' and permissive='RESTRICTIVE') then
    raise exception 'Attendance restrictive read boundary is missing';
  end if;
  oid_value:=to_regprocedure('public.finance_repair_current_identity_runtime_v1()');
  if oid_value is null then raise exception 'Self identity repair is missing';end if;
  select * into rec from pg_proc where oid=oid_value;
  if rec.pronargs<>0 or not rec.prosecdef or pg_get_userbyid(rec.proowner)<>'postgres'
    or not coalesce(rec.proconfig @> array['search_path=""'],false)
    or has_function_privilege('anon',oid_value,'EXECUTE')
    or has_function_privilege('service_role',oid_value,'EXECUTE')
    or not has_function_privilege('authenticated',oid_value,'EXECUTE')
    or position('auth.uid()' in pg_get_functiondef(oid_value))=0 then
    raise exception 'Self identity repair authority is invalid';
  end if;
end;
$audit_identity_attendance$;

-- Organization and approval contracts are appended from their reviewed domain checks.

-- Read-only and repeatable after apply or inside the release rollback rehearsal.
-- No migration-ledger or temporary-table dependency.
do $postflight$
declare v record;
begin
 for v in select * from private.finance_membership_org_versions_v1 where status='published' loop
   if not coalesce((private.finance_membership_org_validate_v1(v.tenant_id,v.snapshot)->>'ok')::boolean,false) then raise exception 'Published organization validation failed';end if;
   if v.source_runtime_revision is distinct from private.finance_org_runtime_revision_v2(v.tenant_id) then raise exception 'Published runtime revision mismatch';end if;
 end loop;
 if exists(select 1 from private.finance_org_integrity_backup_v2 b join private.finance_membership_org_versions_v1 history_row on history_row.id=(b.payload->>'id')::uuid where b.kind='published_version' and (history_row.snapshot is distinct from b.payload->'snapshot' or history_row.status<>'archived')) then raise exception 'Historical published snapshot changed';end if;
 if has_function_privilege('authenticated','public.save_finance_org_chart_rows(jsonb)','EXECUTE') or has_function_privilege('anon','public.finance_save_org_chart_versioned_v2(jsonb,text,text)','EXECUTE') or has_function_privilege('anon','public.finance_org_chart_editor_state_v2()','EXECUTE') then raise exception 'Organization RPC privilege regression';end if;
 if private.finance_org_effective_now_v2('{"effective_to":"2020-01-02"}'::jsonb,'2026-09-07T00:00:00Z') or private.finance_org_effective_now_v2('{"effective_from":"2099-01-01"}'::jsonb,'2026-09-07T00:00:00Z') then raise exception 'Organization effective-period regression';end if;
 if to_regprocedure('public.finance_save_org_chart_versioned_v2(jsonb,text,text)') is null or to_regprocedure('private.finance_org_current_manager_v2(uuid,text,text,text)') is null then raise exception 'Versioned organization RPC missing';end if;
end;$postflight$;
