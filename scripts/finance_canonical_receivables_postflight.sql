\set ON_ERROR_STOP on
-- Repeatable catalog/ACL and anonymous-denial postflight; no operational DML.
do $finance_ar_postflight$
declare v_name text;v_oid oid;v_rejected boolean;v_json jsonb;
begin
 foreach v_name in array array['private.finance_ar_terms_v1','private.finance_ar_operations_v1','private.finance_ar_receipts_v1','private.finance_ar_refunds_v1','private.finance_ar_audit_v1'] loop
  v_oid:=to_regclass(v_name);
  if v_oid is null or not exists(select 1 from pg_class where oid=v_oid and relrowsecurity)
   or has_table_privilege('anon',v_oid,'SELECT,INSERT,UPDATE,DELETE') or has_table_privilege('authenticated',v_oid,'SELECT,INSERT,UPDATE,DELETE')
   or has_table_privilege('service_role',v_oid,'SELECT,INSERT,UPDATE,DELETE') then raise exception 'AR private table/RLS/ACL differs: %',v_name;end if;
 end loop;
 foreach v_name in array array[
  'private.finance_ar_ledger_v1(uuid,text,date,text)','private.finance_ar_invoice_v1(public.invoices,date,jsonb)',
  'private.finance_receivables_payload_v1(date,text,text,text,boolean)','private.finance_ar_bank_reconciliation_v1(uuid,text,date,text)',
  'private.finance_ar_write_allowed_v1(uuid,text,text)','private.finance_ar_lifecycle_guard_v1()','private.finance_ar_ledger_guard_v1()'] loop
  v_oid:=to_regprocedure(v_name);
  if v_oid is null or not exists(select 1 from pg_proc where oid=v_oid and prosecdef and proconfig @> array['search_path=""'])
   or has_function_privilege('anon',v_oid,'EXECUTE') or has_function_privilege('authenticated',v_oid,'EXECUTE') or has_function_privilege('service_role',v_oid,'EXECUTE') then raise exception 'AR private helper ACL/search_path differs: %',v_name;end if;
 end loop;
 foreach v_name in array array[
  'public.finance_receivables_v1(date,text,text,text)','public.finance_update_receivable_terms_v1(text,jsonb,bigint,text,text)',
  'public.finance_set_invoice_due_date_v1(text,date,bigint,text,text,text)',
  'public.finance_invoice_receipt_action_v2(text[],text,text,jsonb,text,jsonb,text,jsonb,date)',
  'public.refund_invoice_receipt_v2(text,numeric,text,date,text,text,numeric)',
  'public.finance_invoice_receipt_action_v1(text[],text,text,jsonb,text,jsonb,text)',
  'public.post_invoice_lifecycle_voucher(text,text,text,text,numeric,numeric,numeric,date)'] loop
  v_oid:=to_regprocedure(v_name);
  if v_oid is null or not exists(select 1 from pg_proc where oid=v_oid and prosecdef and proconfig @> array['search_path=""'])
   or has_function_privilege('anon',v_oid,'EXECUTE') or not has_function_privilege('authenticated',v_oid,'EXECUTE') or has_function_privilege('service_role',v_oid,'EXECUTE') then raise exception 'AR public RPC ACL/search_path differs: %',v_name;end if;
 end loop;
 if not exists(select 1 from pg_proc where oid='public.finance_invoice_receipt_action_v1(text[],text,text,jsonb,text,jsonb,text)'::regprocedure and prosrc like '%finance_invoice_receipt_action_v2(%')
  or not exists(select 1 from pg_proc where oid='public.refund_invoice_receipt(text,numeric,text,date,text)'::regprocedure and prosrc like '%REFUND_IDEMPOTENCY_REQUIRED%')
  or not exists(select 1 from pg_proc where oid='private.finance_receipt_guard_v1()'::regprocedure and prosrc like '%''partial''%') then raise exception 'AR legacy compatibility or partial guard differs';end if;
 if not exists(select 1 from pg_trigger where tgrelid='public.invoice_lifecycle_events'::regclass and tgname='trg_finance_ar_lifecycle_guard_v1' and tgenabled='O' and tgfoid='private.finance_ar_lifecycle_guard_v1()'::regprocedure)
  or not exists(select 1 from pg_trigger where tgrelid='public.ledger_entries'::regclass and tgname='trg_finance_ar_ledger_guard_v1' and tgenabled='O' and tgfoid='private.finance_ar_ledger_guard_v1()'::regprocedure)
  or not exists(select 1 from pg_constraint where conrelid='public.invoice_lifecycle_events'::regclass and conname='finance_lifecycle_allocation_v1' and convalidated) then raise exception 'AR monetary capability/allocation guards absent';end if;
 if not exists(select 1 from pg_proc where oid='public.finance_executive_dashboard_v3(date,date,date,date,date,text,text)'::regprocedure
  and prosrc like '%private.finance_receivables_payload_v1(%' and prosrc not like '%invoice_date + 30%') then raise exception 'Dashboard must use canonical AR and actual due dates';end if;
 -- Empty auth context must fail before reading data or inserting an operation.
 if auth.uid() is null then
  v_rejected:=false;
  begin perform public.finance_receivables_v1(current_date,null,null,'test');exception when insufficient_privilege then v_rejected:=true;end;
  if not v_rejected then raise exception 'AR read accepted absent identity';end if;
  v_rejected:=false;
  begin perform public.finance_invoice_receipt_action_v2(array['__ar_postflight__'],'submit','ar-postflight-no-auth','{"__ar_postflight__":1}','postflight','[]','test','{"__ar_postflight__":1}',current_date);exception when insufficient_privilege then v_rejected:=true;end;
  if not v_rejected then raise exception 'AR receipt accepted absent identity';end if;
  v_rejected:=false;
  begin perform public.refund_invoice_receipt_v2('__ar_postflight__',1,'postflight',current_date,null,'ar-postflight-refund',0);exception when insufficient_privilege then v_rejected:=true;end;
  if not v_rejected then raise exception 'AR refund accepted absent identity';end if;
 end if;
end;
$finance_ar_postflight$;
