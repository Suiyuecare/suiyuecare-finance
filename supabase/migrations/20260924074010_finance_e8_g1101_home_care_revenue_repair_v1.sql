-- Correct only the verified E8/G1101 home-care rule gap and the two approved
-- August sources. No cash, receipt, source amount, approval, or closed-period
-- override is introduced. Run within the protected release transaction.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- FINANCE_REVENUE_REPAIR_CORE_BEGIN
do $repair$
declare
  v_tenant constant uuid := '00000000-0000-0000-0000-000000000001';
  v_rule public.revenue_recognition_rules%rowtype;
  v_invoice public.invoices%rowtype;
  v_expected record;
  v_result jsonb;
  v_before jsonb;
  v_cash_before jsonb;
  v_cash_after jsonb;
  v_count integer;
begin
  -- Serialize this exact repair and preserve the existing Taipei rule.
  perform pg_advisory_xact_lock(hashtextextended('finance_e8_g1101_revenue_repair_v1', 0));
  -- Match the normal writer's invoice-before-ledger lock order.
  perform 1 from public.invoices
  where id in ('inv_202608_00000000_000272', 'inv_202608_00000000_000273')
  order by id for update;
  -- A legacy writer may not lock the invoice before inserting an unbound row.
  -- Briefly prevent such phantom inserts while the exact families are checked.
  lock table public.ledger_entries in share row exclusive mode;
  if not exists (
    select 1 from public.revenue_recognition_rules r
    where r.tenant_id = v_tenant and r.code = 'home_care_b1101'
      and r.data_environment = 'production' and r.active
      and r.entity_id is null and r.department_code is null
      and r.department_code_pattern = '^B1101$'
      and r.invoice_item_type = 'home_care'
      and r.revenue_account_code = '4101'
      and r.recognition_basis = 'invoice_issued'
  ) or private.finance_tenant_account_name(v_tenant, '4101') is null then
    raise exception 'E8/G1101 repair prerequisite changed: inspect the existing home-care rule and account'
      using errcode = '23514';
  end if;

  select count(*) into v_count from public.revenue_recognition_rules
  where tenant_id = v_tenant and code = 'home_care_e8_g1101';
  if v_count > 1 then
    raise exception 'E8/G1101 revenue rule is ambiguous' using errcode = '23514';
  end if;
  if v_count = 0 then
    insert into public.revenue_recognition_rules (
      tenant_id, data_environment, code, name, priority, entity_id,
      department_code, department_code_pattern, invoice_item_type,
      payer_type, funding_source, invoice_identifier_type, tax_rate,
      revenue_account_code, revenue_account_name, recognition_basis,
      rule_notes, active, effective_from, effective_to
    ) values (
      v_tenant, 'production', 'home_care_e8_g1101', '新北居家照顧服務收入',
      100, 'E8', 'G1101', '^G1101$', 'home_care', null, null, null, null,
      '4101', private.finance_tenant_account_name(v_tenant, '4101'),
      'invoice_issued', 'E8/G1101 居家服務費；依已核定分類及發票日認列應收與收入。',
      true, date '2026-08-01', null
    );
  end if;
  select * into strict v_rule from public.revenue_recognition_rules
  where tenant_id = v_tenant and code = 'home_care_e8_g1101' for update;
  if v_rule.data_environment is distinct from 'production'
     or v_rule.active is distinct from true
     or v_rule.entity_id is distinct from 'E8'
     or v_rule.department_code is distinct from 'G1101'
     or v_rule.department_code_pattern is distinct from '^G1101$'
     or v_rule.invoice_item_type is distinct from 'home_care'
     or v_rule.revenue_account_code is distinct from '4101'
     or v_rule.recognition_basis is distinct from 'invoice_issued'
     or v_rule.priority is distinct from 100
     or v_rule.effective_from is distinct from date '2026-08-01'
     or v_rule.effective_to is not null
     or v_rule.payer_type is not null or v_rule.funding_source is not null
     or v_rule.invoice_identifier_type is not null or v_rule.tax_rate is not null then
    raise exception 'E8/G1101 revenue rule differs from the reviewed configuration'
      using errcode = '23514';
  end if;

  for v_expected in select * from (values
    ('inv_202608_00000000_000272', 'INV-202608-00000000-000272', 58365::numeric,
      '4da7b508-890a-4ff2-b379-11c7fa32bbde'::uuid, '4606249d-d060-4eea-9ed5-8a093a3b59c6'::uuid),
    ('inv_202608_00000000_000273', 'INV-202608-00000000-000273', 988147::numeric,
      'ae3b994f-62f5-4a90-b5d7-75eb8fcd7300'::uuid, '04996722-ef85-4d80-8e20-a3387d514ebb'::uuid)
  ) x(id, no, total, bank_id, receipt_ar_id) order by id loop
    select * into v_invoice from public.invoices where id = v_expected.id for update;
    if not found then
      raise exception 'Reviewed invoice % is missing; no revenue repaired', v_expected.id
        using errcode = '23514';
    end if;
    if v_invoice.tenant_id is distinct from v_tenant
       or v_invoice.data_environment is distinct from 'production'
       or v_invoice.no is distinct from v_expected.no
       or v_invoice.entity_id is distinct from 'E8'
       or v_invoice.department_code is distinct from 'G1101'
       or v_invoice.invoice_date is distinct from date '2026-08-01'
       or v_invoice.invoice_item_type is distinct from 'home_care'
       or v_invoice.revenue_account_code is distinct from '4101'
       or v_invoice.total is distinct from v_expected.total
       or v_invoice.amount is distinct from v_expected.total
       or v_invoice.tax is distinct from 0::numeric
       or v_invoice.revenue_posting_version is distinct from 2
       or v_invoice.voided_at is not null
       or v_invoice.status is distinct from 'paid'
       or private.finance_invoice_fully_approved(v_invoice.steps) is distinct from true
       or exists (select 1 from jsonb_array_elements(
         case when jsonb_typeof(v_invoice.steps) = 'array' then v_invoice.steps else '[]'::jsonb end
       ) s where private.finance_step_is_negative_terminal(s)) then
      raise exception 'Reviewed invoice % changed; no revenue repaired', v_expected.no
        using errcode = '23514';
    end if;
    if coalesce(v_invoice.revenue_posted, false) then
      if v_invoice.revenue_posting_state is distinct from 'posted'
         or v_invoice.revenue_posted_at is null
         or v_invoice.revenue_rule_id is distinct from v_rule.id then
        raise exception 'Reviewed invoice % has conflicting posting state', v_expected.no
          using errcode = '23514';
      end if;
    elsif v_invoice.revenue_posted_at is not null
       or v_invoice.revenue_posting_state is distinct from 'pending_accounting_review'
       or not coalesce(v_invoice.revenue_rule_snapshot @> '{"source":"approval_income_category","invoiceItemType":"home_care","revenueAccountCode":"4101"}'::jsonb, false) then
      raise exception 'Reviewed invoice % no longer matches its approved income classification', v_expected.no
        using errcode = '23514';
    end if;

    -- Do not add recognition if an unbound legacy revenue/AR pair appeared
    -- after investigation. The only permitted legacy rows are the verified
    -- September receipt pair; their exact identities must still be present.
    if not exists (
      select 1 from public.ledger_entries l
      where l.tenant_id = v_tenant and l.data_environment = 'production'
        and l.reference_no = v_invoice.no
        and (l.source_type is distinct from 'invoice' or l.source_id is distinct from v_invoice.id)
      having count(*) = 2
        and count(*) filter (where l.id = v_expected.bank_id
          and l.entry_date = date '2026-09-07' and l.entity_id = 'E8'
          and l.department_code = 'G1101' and l.source_type is null and l.source_id is null
          and l.voided_at is null and l.account_code = '1112'
          and l.posting_key = 'invoice:' || v_expected.no || ':receipt:bank'
          and l.debit = v_expected.total and l.credit = 0) = 1
        and count(*) filter (where l.id = v_expected.receipt_ar_id
          and l.entry_date = date '2026-09-07' and l.entity_id = 'E8'
          and l.department_code = 'G1101' and l.source_type is null and l.source_id is null
          and l.voided_at is null and l.account_code = '1123'
          and l.posting_key = 'invoice:' || v_expected.no || ':receipt:ar'
          and l.credit = v_expected.total and l.debit = 0) = 1
    ) then
      raise exception 'Invoice % existing receipt/source ledger changed; inspect before revenue repair', v_expected.no
        using errcode = '23514';
    end if;

    -- Preserve all source/receipt fields outside the writer's bookkeeping fields.
    v_before := to_jsonb(v_invoice) - array[
      'revenue_rule_id','revenue_account_name','revenue_rule_snapshot',
      'revenue_posted','revenue_posted_at','posting_locked_at',
      'revenue_posting_state','revenue_posting_error','updated_at','row_version'
    ];
    select coalesce(jsonb_agg(to_jsonb(l) order by to_jsonb(l)::text), '[]'::jsonb)
      into v_cash_before from public.ledger_entries l
    where l.tenant_id = v_tenant and l.data_environment = 'production'
      and l.reference_no = v_invoice.no
      and (l.source_type is distinct from 'invoice' or l.source_id is distinct from v_invoice.id);

    -- This unmodified private writer retains full-approval, open-period, account,
    -- source-family consistency, and idempotency guards. Any failure rolls back
    -- BOTH invoices and the rule because the whole repair is one SQL statement.
    v_result := private.post_invoice_revenue_v2_internal(v_invoice.id, true);
    if v_result ->> 'ok' is distinct from 'true'
       or v_result ->> 'deferred' is distinct from 'false' then
      raise exception 'Invoice % was not posted by the existing writer', v_expected.no
        using errcode = '23514';
    end if;
    select * into strict v_invoice from public.invoices where id = v_expected.id;
    if (to_jsonb(v_invoice) - array[
      'revenue_rule_id','revenue_account_name','revenue_rule_snapshot',
      'revenue_posted','revenue_posted_at','posting_locked_at',
      'revenue_posting_state','revenue_posting_error','updated_at','row_version'
    ]) is distinct from v_before or v_invoice.revenue_rule_id is distinct from v_rule.id then
      raise exception 'Invoice % changed outside the reviewed revenue repair', v_expected.no
        using errcode = '23514';
    end if;
    select coalesce(jsonb_agg(to_jsonb(l) order by to_jsonb(l)::text), '[]'::jsonb)
      into v_cash_after from public.ledger_entries l
    where l.tenant_id = v_tenant and l.data_environment = 'production'
      and l.reference_no = v_invoice.no
      and (l.source_type is distinct from 'invoice' or l.source_id is distinct from v_invoice.id);
    if v_cash_after is distinct from v_cash_before then
      raise exception 'Invoice % receipt ledger changed; repair rolled back', v_expected.no
        using errcode = '23514';
    end if;
    if not exists (
      select 1 from public.ledger_entries l
      where l.tenant_id = v_tenant and l.data_environment = 'production'
        and l.source_type = 'invoice' and l.source_id = v_invoice.id
        and l.voided_at is null
      having count(*) = 2
        and count(*) filter (where l.entity_id = 'E8' and l.department_code = 'G1101'
          and l.entry_date = date '2026-08-01' and l.reference_no = v_expected.no
          and l.account_code = '1123' and l.debit = v_expected.total and l.credit = 0) = 1
        and count(*) filter (where l.entity_id = 'E8' and l.department_code = 'G1101'
          and l.entry_date = date '2026-08-01' and l.reference_no = v_expected.no
          and l.account_code = '4101' and l.credit = v_expected.total and l.debit = 0) = 1
    ) then
      raise exception 'Invoice % revenue ledger did not reconcile', v_expected.no
        using errcode = '23514';
    end if;
  end loop;
end;
$repair$;
-- FINANCE_REVENUE_REPAIR_CORE_END

-- A collection entry does not prove that its invoice revenue was recognized.
-- Keep the existing HR/auth scope and only count actual income-account rows.
do $income_detector$
declare
  v_proc regprocedure := 'public.finance_executive_dashboard_v2(date,date,date,date,date,text,text)'::regprocedure;
  v_definition text;
  v_hash text;
  v_old text := E'invoice_form_posting as (\n    select i.id,\n           count(l.id) as ledger_rows,';
  v_new text := E'invoice_form_posting as (\n    select i.id,\n           count(l.id) filter (where left(l.account_code, 1) in (''4'', ''7'')) as ledger_rows,';
begin
  select md5(prosrc), pg_get_functiondef(oid) into v_hash, v_definition from pg_proc where oid=v_proc;
  if v_hash='cec3d2e9b694c30e189aca9b1f2431a0' then return; end if;
  if v_hash is distinct from '7734154b2b22e212c5dc0774cd4f7a06'
     or strpos(v_definition,v_old)=0 then
    raise exception 'Revenue reconciliation predecessor changed; review before applying';
  end if;
  execute replace(v_definition,v_old,v_new);
  if not exists(select 1 from pg_proc where oid=v_proc
      and md5(prosrc)='cec3d2e9b694c30e189aca9b1f2431a0'
      and prosecdef and provolatile='s' and pg_get_userbyid(proowner)='postgres'
      and proconfig=array['search_path=""']::text[])
     or has_function_privilege('anon',v_proc,'EXECUTE')
     or not has_function_privilege('authenticated',v_proc,'EXECUTE') then
    raise exception 'Revenue reconciliation source or authority mismatch';
  end if;
end;
$income_detector$;
