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
  'private.finance_receipt_route_ready_v1(jsonb)','private.finance_receipt_revenue_ready_v1(text)','private.finance_accounting_human_event_is_fresh_v2(jsonb,jsonb)',
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
 if position('p_expected_versions->>v_id' in v_source)=0 or position('for update' in v_source)=0 or position('finance_receipt_revenue_ready_v1(i.id)' in v_source)=0 then raise exception 'Receipt CAS/locking/revenue contract absent';end if;
 select prosrc into v_source from pg_proc where oid='private.finance_receipt_revenue_ready_v1(text)'::regprocedure;
 if position('post_invoice_revenue_v2_internal(i.id,true)' in v_source)=0 or position('v_matches<>1' in v_source)=0 or position('l.source_id=i.id' in v_source)=0 or position('l.voided_at is null' in v_source)=0 or position('finance_assert_period_open' in v_source)>0 then raise exception 'Existing receipt revenue must verify a complete source-bound family without old-period posting';end if;
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
