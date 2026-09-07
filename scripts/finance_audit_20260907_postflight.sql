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

-- Repeatable, read-only postflight: catalog inspection and pure JSON functions.
-- Safe before COMMIT of the exact release batch or after it. No business row,
-- ledger, notification, storage object or transaction capability is written.
do $approval_postflight$
declare
 v_signature text;v_oid oid;v_role text;v_source text;v_history jsonb;v_old jsonb;v_new jsonb;v_event jsonb;v_result jsonb;v_conflict boolean:=false;v_blocked boolean:=false;
begin
 foreach v_signature in array array[
  'public.finance_invoice_receipt_action_v1(text[],text,text,jsonb,text,jsonb,text)',
  'public.finance_expense_correction_action_v1(text,text,text,integer,text,jsonb,text,uuid,text,text)',
  'public.finance_expense_correction_read_v1(text,text)'
 ] loop
  v_oid:=to_regprocedure(v_signature);
  if v_oid is null or not has_function_privilege('authenticated',v_oid,'EXECUTE') then raise exception 'Approval RPC missing or authenticated ACL absent: %',v_signature;end if;
  foreach v_role in array array['anon','service_role'] loop
   if has_function_privilege(v_role,v_oid,'EXECUTE') then raise exception 'Approval RPC over-granted to %: %',v_role,v_signature;end if;
  end loop;
  if not exists(select 1 from pg_proc where oid=v_oid and prosecdef and 'search_path=""'=any(proconfig)) then raise exception 'Approval RPC definer/search_path contract failed: %',v_signature;end if;
 end loop;
 foreach v_signature in array array[
  'private.finance_receipt_write_allowed_v1(uuid,text,text)','private.finance_receipt_guard_v1()',
  'private.finance_receipt_ledger_guard_v1()','private.finance_receipt_files_valid_v1(public.invoices,jsonb,text)',
  'private.finance_receipt_route_ready_v1(jsonb)','private.finance_accounting_human_event_is_fresh_v2(jsonb,jsonb)',
  'private.finance_correction_role_v1(uuid,text,text,text[])','private.finance_correction_actor_v1()',
  'private.finance_expense_correction_guard_v1()'
 ] loop
  v_oid:=to_regprocedure(v_signature);if v_oid is null then raise exception 'Private approval helper absent: %',v_signature;end if;
  foreach v_role in array array['anon','authenticated','service_role'] loop
   if has_function_privilege(v_role,v_oid,'EXECUTE') then raise exception 'Private helper over-granted: % to %',v_signature,v_role;end if;
  end loop;
 end loop;
 foreach v_signature in array array['private.finance_receipt_operations_v1','private.expense_accounting_corrections_v1','private.expense_correction_operations_v1'] loop
  if not exists(select 1 from pg_class where oid=to_regclass(v_signature) and relrowsecurity) then raise exception 'Private approval storage must have RLS: %',v_signature;end if;
  foreach v_role in array array['anon','authenticated','service_role'] loop
   if has_table_privilege(v_role,v_signature,'SELECT,INSERT,UPDATE,DELETE') then raise exception 'Private approval storage over-granted: % to %',v_signature,v_role;end if;
  end loop;
 end loop;
 if not exists(select 1 from pg_trigger where tgrelid='public.invoices'::regclass and tgname='trg_finance_receipt_guard_v1' and tgfoid='private.finance_receipt_guard_v1()'::regprocedure and tgenabled='O' and tgtype=31)
 or not exists(select 1 from pg_trigger where tgrelid='public.ledger_entries'::regclass and tgname='trg_finance_receipt_ledger_guard_v1' and tgfoid='private.finance_receipt_ledger_guard_v1()'::regprocedure and tgenabled='O' and tgtype=7)
 or not exists(select 1 from pg_trigger where tgrelid='public.expense_requests'::regclass and tgname='trg_finance_expense_correction_guard_v1' and tgfoid='private.finance_expense_correction_guard_v1()'::regprocedure and tgenabled='O' and tgtype=19) then
  raise exception 'Approval/receipt mutation guard trigger missing, disabled or wrong event';
 end if;
 select prosrc into v_source from pg_proc where oid='private.finance_receipt_write_allowed_v1(uuid,text,text)'::regprocedure;
 if position('writing_transaction=pg_current_xact_id()::text' in v_source)=0 or position('p_id=any(o.invoice_ids)' in v_source)=0 then raise exception 'Receipt capability must bind current transaction and exact source IDs';end if;
 select prosrc into v_source from pg_proc where oid='public.finance_invoice_receipt_action_v1(text[],text,text,jsonb,text,jsonb,text)'::regprocedure;
 if position('p_expected_versions->>v_id' in v_source)=0 or position('for update' in v_source)=0 or position('post_invoice_revenue_v2_internal(i.id,true)' in v_source)=0 then raise exception 'Receipt CAS/locking/revenue contract absent';end if;
 select prosrc into v_source from pg_proc where oid='private.finance_expense_guard_direct_update()'::regprocedure;
 if (length(v_source)-length(replace(v_source,E'        ''accountingLines'',\n        ''accountingLinesPreservedForReview'',','')))/length(E'        ''accountingLines'',\n        ''accountingLinesPreservedForReview'',')<>2 then raise exception 'Both exact procurement payload whitelists must include preservation marker';end if;
 if not private.finance_receipt_route_ready_v1('[{"rk":"accountant_invoice","a":"approved"},{"rk":"applicant_invoice_delivery","a":""}]')
  or private.finance_receipt_route_ready_v1('[{"rk":"accountant_invoice","a":""}]')
  or private.finance_receipt_route_ready_v1('[{"rk":"accountant_invoice","a":"approved"},{"rk":"ceo","a":""}]') then raise exception 'Receipt prerequisite route pure check failed';end if;
 -- The old signature must reject safely even without a browser identity; do
 -- not call its predecessor against any real invoice for rehearsal.
 begin
  perform public.post_invoice_cash_receipt('__approval_postflight_nonexistent__');
 exception when sqlstate '55000' then v_blocked:=true;end;
 if not v_blocked then raise exception 'Legacy receipt entrypoint did not require upgraded atomic flow';end if;
 select jsonb_agg(jsonb_build_object('operationId','saved-'||n,'at','saved-'||n) order by n) into v_history from generate_series(1,50) n;
 v_old:=jsonb_build_object('id','pure-line','netAmount',100,'taxAmount',0,'grossAmount',100,'debitAccount','6205','creditAccount','1112',
  'manualOverride',true,'valueAuthority','human','manualFields',jsonb_build_array('netAmount','taxAmount','grossAmount','debitAccount','creditAccount'),
  'manualOverrideHistory',v_history,'manualOverrideBy',jsonb_build_object('id','pure-actor'),'manualOverrideAt','old','manualOverrideSource','saved');
 v_event:=jsonb_build_object('operationId','fresh-51','at','new','source','postflight','actor',jsonb_build_object('id','pure-actor'),
  'changes',jsonb_build_object('netAmount',jsonb_build_object('before',100,'after',120),'grossAmount',jsonb_build_object('before',100,'after',120)));
 v_new:=v_old||jsonb_build_object('netAmount',120,'grossAmount',120,'manualOverrideAt','new','manualOverrideSource','postflight',
  'manualOverrideHistory',(v_history-0)||jsonb_build_array(v_event));
 v_result:=private.finance_merge_human_accounting_line(v_old,v_new);
 if (v_result->>'grossAmount')::numeric<>120 or jsonb_array_length(v_result->'manualOverrideHistory')<>51 then raise exception 'Rolling 50-event human change was lost';end if;
 begin
  perform private.finance_merge_human_accounting_line(v_old,v_new||jsonb_build_object('manualOverrideHistory',v_history));
 exception when serialization_failure then v_conflict:=true;end;
 if not v_conflict then raise exception 'Changed human values without fresh event were not rejected';end if;
 if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='notifications' and column_name='record_type' and data_type='text') then raise exception 'Typed notification source missing';end if;
end;
$approval_postflight$;
