-- Read-only release check. Run against the accounting project after applying
-- 20261005173534_applicant_withdraw_bill_invoice_v1.sql.
do $postflight$
declare
  v_bill_oid oid := pg_catalog.to_regprocedure(
    'public.finance_bill_withdraw_applicant_v1(text[],text,text,jsonb,text)'
  );
  v_invoice_oid oid := pg_catalog.to_regprocedure(
    'public.finance_invoice_withdraw_applicant_v1(text[],text,text,jsonb,text)'
  );
  v_helper_oid oid := pg_catalog.to_regprocedure(
    'private.finance_income_withdraw_applicant_v1(text,text[],text,text,jsonb,text)'
  );
  v_trigger_oid oid := pg_catalog.to_regprocedure(
    'private.finance_guard_labor_request_withdraw_v1()'
  );
  v_oid oid;
  v_proc pg_catalog.pg_proc%rowtype;
begin
  if v_bill_oid is null or v_invoice_oid is null
     or v_helper_oid is null or v_trigger_oid is null then
    raise exception 'Applicant withdrawal functions are incomplete';
  end if;
  foreach v_oid in array array[v_bill_oid, v_invoice_oid] loop
    select * into v_proc from pg_catalog.pg_proc where oid = v_oid;
    if not v_proc.prosecdef
       or v_proc.proconfig is null
       or not ('search_path=""' = any(v_proc.proconfig))
       or not pg_catalog.has_function_privilege('authenticated', v_oid, 'EXECUTE')
       or pg_catalog.has_function_privilege('anon', v_oid, 'EXECUTE') then
      raise exception 'Applicant withdrawal wrapper ACL or search path differs: %', v_oid::pg_catalog.regprocedure;
    end if;
  end loop;
  if pg_catalog.has_function_privilege('authenticated', v_helper_oid, 'EXECUTE')
     or pg_catalog.has_function_privilege('anon', v_helper_oid, 'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated', v_trigger_oid, 'EXECUTE')
     or pg_catalog.has_function_privilege('anon', v_trigger_oid, 'EXECUTE') then
    raise exception 'Private applicant withdrawal helper is exposed';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_trigger t
    where t.tgrelid = 'public.expense_requests'::pg_catalog.regclass
      and t.tgname = 'finance_guard_labor_request_withdraw_v1'
      and t.tgfoid = v_trigger_oid
      and t.tgenabled = 'O'
  ) then
    raise exception 'Electronic-labor cancellation guard is absent';
  end if;

  if exists (
    select 1 from public.bills b
    where b.approval_status = 'cancelled'
      and exists (
        select 1 from pg_catalog.jsonb_array_elements(b.steps) s
        where s ->> 'a' = 'cancelled'
          and nullif(s ->> 'cancelledById', '') is not null
      )
      and (
        b.status is distinct from 'cancelled' or b.paid_at is not null
        or b.voided_at is not null or b.linked_invoice_id is not null
        or b.invoice_followup_status <> 'unreviewed'
        or exists (
          select 1 from public.invoices i
          where i.tenant_id = b.tenant_id
            and i.data_environment = b.data_environment
            and i.source_bill_id = b.id
        )
        or not exists (
          select 1 from public.collection_followups f
          where f.tenant_id = b.tenant_id
            and f.data_environment = b.data_environment
            and f.source_table = 'bills' and f.source_id = b.id
            and f.outstanding_amount = 0
            and f.payment_status = 'voided'
            and f.followup_status = 'void'
        )
        or not exists (
          select 1 from public.cash_movement_evidence_links c
          where c.tenant_id = b.tenant_id
            and c.data_environment = b.data_environment
            and c.source_table = 'bills' and c.source_id = b.id
            and c.cash_stage = 'void'
        )
        or not exists (
          select 1 from public.income_document_closure_cases closure_row
          where closure_row.tenant_id = b.tenant_id
            and closure_row.data_environment = b.data_environment
            and closure_row.source_table = 'bills' and closure_row.source_id = b.id
            and closure_row.closure_status = 'closed_void'
        )
      )
  ) then
    raise exception 'An applicant-withdrawn bill has a financial or linked-document side effect';
  end if;
  if exists (
    select 1 from public.invoices i
    where i.approval_status = 'cancelled'
      and exists (
        select 1 from pg_catalog.jsonb_array_elements(i.steps) s
        where s ->> 'a' = 'cancelled'
          and nullif(s ->> 'cancelledById', '') is not null
      )
      and (
        i.status is distinct from 'cancelled' or i.paid_at is not null
        or i.voided_at is not null or i.posting_locked_at is not null
        or i.revenue_posted or i.revenue_posted_at is not null
        or i.cash_receipt_posted_at is not null
        or i.receipt_submitted_at is not null
        or i.receipt_reviewed_at is not null
        or i.receipt_files <> '[]'::jsonb
        or i.source_bill_id is not null
        or exists (
          select 1 from public.invoice_lifecycle_events e
          where e.tenant_id = i.tenant_id
            and e.data_environment = i.data_environment
            and e.invoice_id = i.id
        )
        or not exists (
          select 1 from public.collection_followups f
          where f.tenant_id = i.tenant_id
            and f.data_environment = i.data_environment
            and f.source_table = 'invoices' and f.source_id = i.id
            and f.outstanding_amount = 0
            and f.payment_status = 'voided'
            and f.followup_status = 'void'
        )
        or not exists (
          select 1 from public.cash_movement_evidence_links c
          where c.tenant_id = i.tenant_id
            and c.data_environment = i.data_environment
            and c.source_table = 'invoices' and c.source_id = i.id
            and c.cash_stage = 'void'
        )
        or not exists (
          select 1 from public.income_document_closure_cases closure_row
          where closure_row.tenant_id = i.tenant_id
            and closure_row.data_environment = i.data_environment
            and closure_row.source_table = 'invoices' and closure_row.source_id = i.id
            and closure_row.closure_status = 'closed_void'
        )
      )
  ) then
    raise exception 'An applicant-withdrawn invoice has a posting, receipt, or linked-document side effect';
  end if;
end;
$postflight$;
