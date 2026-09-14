-- R-01/R-02: scoped dashboard source reconciliation; no financial writes.
set local lock_timeout='5s';
set local statement_timeout='60s';
do $preflight$ begin
 if not exists(select 1 from pg_proc where oid=to_regprocedure('public.finance_executive_dashboard_v2(date,date,date,date,date,text,text)') and md5(prosrc)='8de3ece274d222fdf7d7a02949d6475b' and prosecdef and provolatile='s' and pg_get_userbyid(proowner)='postgres') then raise exception 'Dashboard predecessor source/authority mismatch';end if;
end $preflight$;

CREATE OR REPLACE FUNCTION public.finance_executive_dashboard_v2(p_start date, p_end date, p_previous_start date, p_previous_end date, p_trend_start date, p_entity_id text DEFAULT NULL::text, p_data_environment text DEFAULT 'production'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_role text;
  v_actor public.finance_users%rowtype;
  v_company text;
  v_dimension record;
  v_accounting boolean;
  v_entity text := nullif(nullif(trim(coalesce(p_entity_id, '')), ''), 'all');
  v_environment text := coalesce(nullif(trim(p_data_environment), ''), 'production');
  v_result jsonb;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  v_actor := private.finance_correction_actor_v1();
  if nullif(public.finance_current_verified_google_email_v2(), '') is null then
    raise exception 'verified Finance identity required' using errcode='42501';
  end if;
  v_role := coalesce(public.current_finance_role(), '');
  if v_role not in ('accountant', 'ceo', 'admin_director', 'external_audit', 'board') then
    raise exception 'finance dashboard access denied' using errcode = '42501';
  end if;

  if p_start is null or p_end is null or p_previous_start is null or p_previous_end is null or p_trend_start is null
     or p_start > p_end or p_previous_start > p_previous_end or p_trend_start > p_end then
    raise exception 'invalid dashboard period' using errcode = '22023';
  end if;

  if p_end - p_trend_start > 3660 then
    raise exception 'dashboard period exceeds 10 years' using errcode = '22023';
  end if;

  if v_environment not in ('production','test') then
    raise exception 'invalid dashboard environment' using errcode='22023';
  end if;
  -- Complete totals require complete company and department authority. Reuse
  -- the configured reporting policy; never infer access from an empty company.
  for v_company in
    select v_entity where v_entity is not null
    union
    select item->>'id' from public.system_settings st
      cross join lateral jsonb_array_elements(case when jsonb_typeof(st.value)='array' then st.value else '[]'::jsonb end) item
      where st.tenant_id=v_actor.tenant_id and st.key='entities' and v_entity is null
    union
    select l.entity_id from public.ledger_entries l where l.tenant_id=v_actor.tenant_id
      and coalesce(l.data_environment,'production')=v_environment and l.voided_at is null and (v_entity is null or l.entity_id=v_entity)
    union
    select i.entity_id from public.invoices i where i.tenant_id=v_actor.tenant_id
      and coalesce(i.data_environment,'production')=v_environment and (v_entity is null or i.entity_id=v_entity)
    union
    select r.entity_id from public.expense_requests r where r.tenant_id=v_actor.tenant_id
      and coalesce(r.data_environment,'production')=v_environment and r.voided_at is null and (v_entity is null or r.entity_id=v_entity)
  loop
    if nullif(btrim(v_company),'') is null then raise exception 'dashboard company scope is unresolved' using errcode='42501';end if;
    perform private.finance_reporting_actor_v1(v_company,v_environment);
  end loop;
  if v_entity is null and not exists(select 1 from public.system_settings st
    cross join lateral jsonb_array_elements(case when jsonb_typeof(st.value)='array' then st.value else '[]'::jsonb end) item
    where st.tenant_id=v_actor.tenant_id and st.key='entities' and nullif(item->>'id','') is not null) then
    raise exception 'dashboard company scope is unavailable' using errcode='42501';
  end if;
  for v_dimension in
    select l.entity_id,l.department_code from public.ledger_entries l where l.tenant_id=v_actor.tenant_id
      and coalesce(l.data_environment,'production')=v_environment and l.voided_at is null and (v_entity is null or l.entity_id=v_entity)
    union
    select i.entity_id,i.department_code from public.invoices i where i.tenant_id=v_actor.tenant_id
      and coalesce(i.data_environment,'production')=v_environment and (v_entity is null or i.entity_id=v_entity)
    union
    select r.entity_id,r.department_code from public.expense_requests r where r.tenant_id=v_actor.tenant_id
      and coalesce(r.data_environment,'production')=v_environment and r.voided_at is null and (v_entity is null or r.entity_id=v_entity)
  loop
    if private.finance_expense_optional_permission_allows(v_actor.tenant_id,v_actor.id,'finance.request.view.all',jsonb_build_object(
      'entity_id',v_dimension.entity_id,'entityId',v_dimension.entity_id,'legal_entity_code',v_dimension.entity_id,
      'department_code',v_dimension.department_code,'departmentCode',v_dimension.department_code,'data_environment',v_environment)) is distinct from true then
      raise exception 'dashboard department scope is not authorized' using errcode='42501';
    end if;
  end loop;
  -- These three roles satisfy the accounting arm of both deployed read guards.
  -- Identity, tenant, report and dimension restrictions above still apply.
  v_accounting := coalesce(public.is_finance_accounting(),false);
  if not v_accounting and (
    exists(select 1 from public.invoices i where i.tenant_id=v_actor.tenant_id and coalesce(i.data_environment,'production')=v_environment
      and (v_entity is null or i.entity_id=v_entity) and public.can_read_invoice(i) is distinct from true)
    or exists(select 1 from public.expense_requests r where r.tenant_id=v_actor.tenant_id and coalesce(r.data_environment,'production')=v_environment
      and r.voided_at is null and (v_entity is null or r.entity_id=v_entity) and public.can_read_expense_request(r) is distinct from true)
  ) then raise exception 'dashboard source scope is not fully authorized' using errcode='42501';end if;

  with
  invoice_base as materialized (
    select i.* from public.invoices i where i.tenant_id=v_actor.tenant_id
      and coalesce(i.data_environment,'production')=v_environment and i.voided_at is null
      and (v_entity is null or i.entity_id=v_entity)
  ),
  expense_base as materialized (
    select r.* from public.expense_requests r where r.tenant_id=v_actor.tenant_id
      and coalesce(r.data_environment,'production')=v_environment and r.voided_at is null
      and (v_entity is null or r.entity_id=v_entity)
  ),
  ledger_base as materialized (
    select l.*,
           coalesce(
             nullif(l.source_id, ''),
             nullif(l.source_no, ''),
             nullif(l.reference_no, ''),
             nullif(l.voucher_no, ''),
             nullif(l.posting_key, ''),
             l.id::text
           ) as source_key
    from public.ledger_entries l
    where l.tenant_id = v_actor.tenant_id
      and coalesce(l.data_environment, 'production') = v_environment
      and l.voided_at is null
      and (v_entity is null or l.entity_id = v_entity)
  ),
  current_ledger as materialized (
    select * from ledger_base where entry_date between p_start and p_end
  ),
  previous_ledger as materialized (
    select * from ledger_base where entry_date between p_previous_start and p_previous_end
  ),
  current_summary as (
    select
      coalesce(sum(case when left(account_code, 1) in ('4', '7') then credit - debit else 0 end), 0) as revenue,
      coalesce(sum(case when left(account_code, 1) in ('5', '6', '9') then debit - credit else 0 end), 0) as expense,
      count(*) as ledger_rows
    from current_ledger
  ),
  previous_summary as (
    select
      coalesce(sum(case when left(account_code, 1) in ('4', '7') then credit - debit else 0 end), 0) as revenue,
      coalesce(sum(case when left(account_code, 1) in ('5', '6', '9') then debit - credit else 0 end), 0) as expense,
      count(*) as ledger_rows
    from previous_ledger
  ),
  company_keys as (
    select entity_id from current_ledger
    union
    select entity_id from previous_ledger
  ),
  company_current as (
    select entity_id,
           sum(case when left(account_code, 1) in ('4', '7') then credit - debit else 0 end) as revenue,
           sum(case when left(account_code, 1) in ('5', '6', '9') then debit - credit else 0 end) as expense,
           count(*) as ledger_rows
    from current_ledger group by entity_id
  ),
  company_previous as (
    select entity_id,
           sum(case when left(account_code, 1) in ('4', '7') then credit - debit else 0 end) as revenue,
           sum(case when left(account_code, 1) in ('5', '6', '9') then debit - credit else 0 end) as expense,
           count(*) as ledger_rows
    from previous_ledger group by entity_id
  ),
  department_keys as (
    select entity_id, coalesce(nullif(department_code, ''), '未指定') as department_code from current_ledger
    union
    select entity_id, coalesce(nullif(department_code, ''), '未指定') as department_code from previous_ledger
  ),
  department_current as (
    select entity_id, coalesce(nullif(department_code, ''), '未指定') as department_code,
           sum(case when left(account_code, 1) in ('4', '7') then credit - debit else 0 end) as revenue,
           sum(case when left(account_code, 1) in ('5', '6', '9') then debit - credit else 0 end) as expense,
           count(*) as ledger_rows
    from current_ledger group by entity_id, coalesce(nullif(department_code, ''), '未指定')
  ),
  department_previous as (
    select entity_id, coalesce(nullif(department_code, ''), '未指定') as department_code,
           sum(case when left(account_code, 1) in ('4', '7') then credit - debit else 0 end) as revenue,
           sum(case when left(account_code, 1) in ('5', '6', '9') then debit - credit else 0 end) as expense,
           count(*) as ledger_rows
    from previous_ledger group by entity_id, coalesce(nullif(department_code, ''), '未指定')
  ),
  trend_months as (
    select d::date as month_start, (d + interval '1 month - 1 day')::date as month_end
    from generate_series(date_trunc('month', p_trend_start)::date, date_trunc('month', p_end)::date, interval '1 month') d
  ),
  trend_rows as (
    select m.month_start,
           coalesce(sum(case when left(l.account_code, 1) in ('4', '7') then l.credit - l.debit else 0 end), 0) as revenue,
           coalesce(sum(case when left(l.account_code, 1) in ('5', '6', '9') then l.debit - l.credit else 0 end), 0) as expense,
           count(l.id) as ledger_rows
    from trend_months m
    left join ledger_base l on l.entry_date between m.month_start and m.month_end
    group by m.month_start
  ),
  ar_groups as (
    select source_key,
           max(entity_id) as entity_id,
           max(nullif(source_id, '')) as source_id,
           max(nullif(source_no, '')) as source_no,
           max(nullif(reference_no, '')) as reference_no,
           sum(debit - credit) as balance,
           count(*) as ledger_rows
    from ledger_base
    where entry_date <= p_end and account_code = '1123'
    group by source_key, entity_id
    having sum(debit - credit) > 0.4
  ),
  ar_items as (
    select a.*,
           i.id as invoice_id,
           i.no as invoice_no,
           i.buyer,
           i.invoice_date,
           case when i.invoice_date is null then null else i.invoice_date + 30 end as due_date,
           case when i.invoice_date is null then 0 else greatest(0, p_end - (i.invoice_date + 30)) end as overdue_days
    from ar_groups a
    left join lateral (
      select i.*
      from invoice_base i
      where coalesce(i.data_environment, 'production') = v_environment
        and i.voided_at is null
        and i.entity_id is not distinct from a.entity_id
        and (i.id = a.source_id or i.no = a.source_no or i.no = a.reference_no or i.no = a.source_key)
      order by case when i.id = a.source_id then 1 when i.no = a.source_no then 2 else 3 end
      limit 1
    ) i on true
  ),
  ar_previous_groups as (
    select source_key, sum(debit - credit) as balance
    from ledger_base
    where entry_date <= p_previous_end and account_code = '1123'
    group by source_key, entity_id
    having sum(debit - credit) > 0.4
  ),
  expense_forms as materialized (
    select r.*,
           coalesce(nullif(r.actual_amount, 0), nullif(r.estimated_amount, 0), r.amount, 0) as form_amount
    from expense_base r
    where coalesce(r.data_environment, 'production') = v_environment
      and r.voided_at is null
      and (v_entity is null or r.entity_id = v_entity)
      and r.request_date between p_start and p_end
  ),
  expense_form_posting as (
    select r.id,
           count(l.id) as ledger_rows,
           min(l.entry_date) as first_entry_date,
           max(l.entry_date) as last_entry_date,
           coalesce(sum(case when left(l.account_code, 1) in ('5', '6', '9') then l.debit - l.credit else 0 end), 0) as expense_amount,
           coalesce(sum(case when l.account_code = '1144' then l.debit - l.credit else 0 end), 0) as input_tax
    from expense_forms r
    left join ledger_base l
      on l.entity_id is not distinct from r.entity_id
        and (l.source_id = r.id or l.source_no = r.no or l.reference_no = r.no
         or l.voucher_no = r.voucher_id or l.source_id = r.voucher_id)
    where r.status = 'completed'
    group by r.id
  ),
  current_expense_sources as (
    select source_key,
           max(entry_date) as entry_date,
           max(entity_id) as entity_id,
           max(nullif(source_type, '')) as source_type,
           max(nullif(source_id, '')) as source_id,
           max(nullif(source_no, '')) as source_no,
           max(nullif(reference_no, '')) as reference_no,
           max(nullif(voucher_no, '')) as voucher_no,
           sum(case when left(account_code, 1) in ('5', '6', '9') then debit - credit else 0 end) as expense_amount
    from current_ledger
    group by source_key, entity_id
    having abs(sum(case when left(account_code, 1) in ('5', '6', '9') then debit - credit else 0 end)) > 0.4
  ),
  current_expense_linked as (
    select s.*,
           r.id as request_id, r.no as request_no, r.request_date, r.status as request_status,
           coalesce(nullif(r.actual_amount, 0), nullif(r.estimated_amount, 0), r.amount, 0) as request_amount,
           case
             when s.source_type in ('accounting_adjustment', 'adjustment_voucher') then 'adjustment'
             when r.id is null then 'unlinked'
             when r.request_date < p_start then 'prior_form'
             when r.request_date > p_end then 'future_form'
             else 'current_form'
           end as bridge_class
    from current_expense_sources s
    left join lateral (
      select r.*
      from expense_base r
      where coalesce(r.data_environment, 'production') = v_environment
        and r.voided_at is null
        and r.entity_id is not distinct from s.entity_id
        and (r.id = s.source_id or r.no = s.source_no or r.no = s.reference_no
             or r.voucher_id = s.voucher_no or r.voucher_id = s.source_id)
      order by case when r.id = s.source_id then 1 when r.no = s.source_no then 2 when r.no = s.reference_no then 3 else 4 end
      limit 1
    ) r on true
  ),
  invoice_forms as materialized (
    select i.*,
           coalesce(i.amount, 0) as net_amount,
           coalesce(i.total, i.amount, 0) as gross_amount
    from invoice_base i
    where coalesce(i.data_environment, 'production') = v_environment
      and i.voided_at is null
      and (v_entity is null or i.entity_id = v_entity)
      and i.invoice_date between p_start and p_end
  ),
  invoice_form_posting as (
    select i.id,
           count(l.id) as ledger_rows,
           min(l.entry_date) as first_entry_date,
           max(l.entry_date) as last_entry_date,
           coalesce(sum(case when left(l.account_code, 1) in ('4', '7') then l.credit - l.debit else 0 end), 0) as revenue_amount
    from invoice_forms i
    left join ledger_base l on l.entity_id is not distinct from i.entity_id and (l.source_id = i.id or l.source_no = i.no or l.reference_no = i.no)
    where i.approval_status in ('completed', 'delivered')
    group by i.id
  ),
  current_revenue_sources as (
    select source_key,
           max(entry_date) as entry_date,
           max(entity_id) as entity_id,
           max(nullif(source_type, '')) as source_type,
           max(nullif(source_id, '')) as source_id,
           max(nullif(source_no, '')) as source_no,
           max(nullif(reference_no, '')) as reference_no,
           sum(case when left(account_code, 1) in ('4', '7') then credit - debit else 0 end) as revenue_amount
    from current_ledger
    group by source_key, entity_id
    having abs(sum(case when left(account_code, 1) in ('4', '7') then credit - debit else 0 end)) > 0.4
  ),
  current_revenue_linked as (
    select s.*,
           i.id as invoice_id, i.no as invoice_no, i.invoice_date, i.approval_status,
           coalesce(i.amount, 0) as invoice_net, coalesce(i.total, i.amount, 0) as invoice_gross,
           case
             when s.source_type in ('invoice_reversal', 'accounting_adjustment', 'adjustment_voucher') then 'adjustment'
             when i.id is null then 'unlinked'
             when i.invoice_date < p_start then 'prior_form'
             when i.invoice_date > p_end then 'future_form'
             else 'current_form'
           end as bridge_class
    from current_revenue_sources s
    left join lateral (
      select i.*
      from invoice_base i
      where coalesce(i.data_environment, 'production') = v_environment
        and i.voided_at is null
        and i.entity_id is not distinct from s.entity_id
        and (i.id = s.source_id or i.no = s.source_no or i.no = s.reference_no)
      order by case when i.id = s.source_id then 1 when i.no = s.source_no then 2 else 3 end
      limit 1
    ) i on true
  ),
  row_counts as (
    select
      (select count(*) from ledger_base where coalesce(data_environment, 'production') = v_environment and voided_at is null and (v_entity is null or entity_id = v_entity)) as ledger_rows,
      (select count(*) from expense_base where coalesce(data_environment, 'production') = v_environment and voided_at is null and (v_entity is null or entity_id = v_entity)) as expense_rows,
      (select count(*) from invoice_base where coalesce(data_environment, 'production') = v_environment and voided_at is null and (v_entity is null or entity_id = v_entity)) as invoice_rows
  )
  select jsonb_build_object(
    'version', 2,
    'generatedAt', statement_timestamp(),
    'environment', v_environment,
    'entityId', coalesce(v_entity, 'all'),
    'period', jsonb_build_object('start', p_start, 'end', p_end, 'previousStart', p_previous_start, 'previousEnd', p_previous_end, 'trendStart', p_trend_start),
    'summary', (
      select jsonb_build_object('revenue', revenue, 'expense', expense, 'net', revenue - expense, 'ledgerRows', ledger_rows)
      from current_summary
    ),
    'previousSummary', (
      select jsonb_build_object('revenue', revenue, 'expense', expense, 'net', revenue - expense, 'ledgerRows', ledger_rows)
      from previous_summary
    ),
    'companies', coalesce((
      select jsonb_agg(jsonb_build_object(
        'entityId', k.entity_id,
        'revenue', coalesce(c.revenue, 0), 'expense', coalesce(c.expense, 0),
        'net', coalesce(c.revenue, 0) - coalesce(c.expense, 0),
        'previousRevenue', coalesce(p.revenue, 0), 'previousExpense', coalesce(p.expense, 0),
        'previousNet', coalesce(p.revenue, 0) - coalesce(p.expense, 0),
        'ledgerRows', coalesce(c.ledger_rows, 0)
      ) order by k.entity_id)
      from company_keys k
      left join company_current c using (entity_id)
      left join company_previous p using (entity_id)
    ), '[]'::jsonb),
    'departments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'entityId', k.entity_id, 'departmentCode', k.department_code,
        'revenue', coalesce(c.revenue, 0), 'expense', coalesce(c.expense, 0),
        'net', coalesce(c.revenue, 0) - coalesce(c.expense, 0),
        'previousRevenue', coalesce(p.revenue, 0), 'previousExpense', coalesce(p.expense, 0),
        'previousNet', coalesce(p.revenue, 0) - coalesce(p.expense, 0),
        'ledgerRows', coalesce(c.ledger_rows, 0)
      ) order by k.entity_id, k.department_code)
      from department_keys k
      left join department_current c using (entity_id, department_code)
      left join department_previous p using (entity_id, department_code)
    ), '[]'::jsonb),
    'trend', coalesce((
      select jsonb_agg(jsonb_build_object(
        'month', to_char(month_start, 'YYYY-MM'), 'revenue', revenue, 'expense', expense,
        'net', revenue - expense, 'ledgerRows', ledger_rows
      ) order by month_start)
      from trend_rows
    ), '[]'::jsonb),
    'receivables', jsonb_build_object(
      'total', coalesce((select sum(balance) from ar_items), 0),
      'count', (select count(*) from ar_items),
      'overdueTotal', coalesce((select sum(balance) from ar_items where overdue_days > 0), 0),
      'over90Total', coalesce((select sum(balance) from ar_items where overdue_days > 90), 0),
      'unknownDue', (select count(*) from ar_items where due_date is null),
      'buckets', jsonb_build_array(
        jsonb_build_object('key', 'not_due', 'label', '未到期', 'count', (select count(*) from ar_items where overdue_days <= 0), 'total', coalesce((select sum(balance) from ar_items where overdue_days <= 0), 0)),
        jsonb_build_object('key', 'd1', 'label', '逾期 1-30 天', 'count', (select count(*) from ar_items where overdue_days between 1 and 30), 'total', coalesce((select sum(balance) from ar_items where overdue_days between 1 and 30), 0)),
        jsonb_build_object('key', 'd31', 'label', '逾期 31-60 天', 'count', (select count(*) from ar_items where overdue_days between 31 and 60), 'total', coalesce((select sum(balance) from ar_items where overdue_days between 31 and 60), 0)),
        jsonb_build_object('key', 'd61', 'label', '逾期 61-90 天', 'count', (select count(*) from ar_items where overdue_days between 61 and 90), 'total', coalesce((select sum(balance) from ar_items where overdue_days between 61 and 90), 0)),
        jsonb_build_object('key', 'd90', 'label', '逾期 90 天以上', 'count', (select count(*) from ar_items where overdue_days > 90), 'total', coalesce((select sum(balance) from ar_items where overdue_days > 90), 0))
      ),
      'items', coalesce((
        select jsonb_agg(jsonb_build_object(
          'key', source_key, 'balance', balance, 'invoiceId', invoice_id, 'invoiceNo', invoice_no,
          'buyer', coalesce(buyer, '來源待確認'), 'invoiceDate', invoice_date, 'due', due_date,
          'overdueDays', overdue_days, 'entityId', entity_id
        ) order by balance desc)
        from (select * from ar_items order by balance desc limit 5) top_ar
      ), '[]'::jsonb)
    ),
    'previousReceivables', jsonb_build_object(
      'total', coalesce((select sum(balance) from ar_previous_groups), 0),
      'count', (select count(*) from ar_previous_groups)
    ),
    'reconciliation', jsonb_build_object(
      'expense', jsonb_build_object(
        'formCount', (select count(*) from expense_forms where status not in ('cancelled', 'rejected')),
        'formAmount', coalesce((select sum(form_amount) from expense_forms where status not in ('cancelled', 'rejected')), 0),
        'completedCount', (select count(*) from expense_forms where status = 'completed'),
        'completedAmount', coalesce((select sum(form_amount) from expense_forms where status = 'completed'), 0),
        'pendingCount', (select count(*) from expense_forms where status like 'pending_%'),
        'pendingAmount', coalesce((select sum(form_amount) from expense_forms where status like 'pending_%'), 0),
        'excludedCount', (select count(*) from expense_forms where status in ('cancelled', 'rejected')),
        'excludedAmount', coalesce((select sum(form_amount) from expense_forms where status in ('cancelled', 'rejected')), 0),
        'completedPnlAmount', coalesce((select sum(p.expense_amount) from expense_forms f join expense_form_posting p using (id) where f.status = 'completed'), 0),
        'completedInputTax', coalesce((select sum(p.input_tax) from expense_forms f join expense_form_posting p using (id) where f.status = 'completed'), 0),
        'completedNonPnlAmount', coalesce((select sum(f.form_amount - p.expense_amount - p.input_tax) from expense_forms f join expense_form_posting p using (id) where f.status = 'completed'), 0),
        'completedNoLedgerCount', (select count(*) from expense_forms f join expense_form_posting p using (id) where f.status = 'completed' and p.ledger_rows = 0),
        'completedNoLedgerAmount', coalesce((select sum(f.form_amount) from expense_forms f join expense_form_posting p using (id) where f.status = 'completed' and p.ledger_rows = 0), 0),
        'postedAfterPeriodCount', (select count(*) from expense_forms f join expense_form_posting p using (id) where f.status = 'completed' and p.first_entry_date > p_end),
        'postedAfterPeriodAmount', coalesce((select sum(f.form_amount) from expense_forms f join expense_form_posting p using (id) where f.status = 'completed' and p.first_entry_date > p_end), 0),
        'officialAmount', (select expense from current_summary),
        'officialCurrentForms', coalesce((select sum(expense_amount) from current_expense_linked where bridge_class = 'current_form'), 0),
        'officialPriorForms', coalesce((select sum(expense_amount) from current_expense_linked where bridge_class = 'prior_form'), 0),
        'officialFutureForms', coalesce((select sum(expense_amount) from current_expense_linked where bridge_class = 'future_form'), 0),
        'officialAdjustments', coalesce((select sum(expense_amount) from current_expense_linked where bridge_class = 'adjustment'), 0),
        'officialUnlinked', coalesce((select sum(expense_amount) from current_expense_linked where bridge_class = 'unlinked'), 0),
        'unlinkedSourceCount', (select count(*) from current_expense_linked where bridge_class = 'unlinked'),
        'unlinkedSourceAbsoluteAmount', coalesce((select sum(abs(expense_amount)) from current_expense_linked where bridge_class = 'unlinked'), 0),
        'futureFormCount', (select count(*) from current_expense_linked where bridge_class = 'future_form'),
        'exceptions', coalesce((
          select jsonb_agg(jsonb_build_object(
            'class', bridge_class, 'amount', expense_amount, 'entryDate', entry_date,
            'sourceNo', coalesce(request_no, source_no, reference_no, source_key),
            'formDate', request_date, 'formStatus', request_status
          ) order by abs(expense_amount) desc)
          from (select * from current_expense_linked where bridge_class <> 'current_form' order by abs(expense_amount) desc limit 8) x
        ), '[]'::jsonb)
      ),
      'revenue', jsonb_build_object(
        'formCount', (select count(*) from invoice_forms where approval_status <> 'rejected'),
        'formNetAmount', coalesce((select sum(net_amount) from invoice_forms where approval_status <> 'rejected'), 0),
        'formGrossAmount', coalesce((select sum(gross_amount) from invoice_forms where approval_status <> 'rejected'), 0),
        'eligibleCount', (select count(*) from invoice_forms where approval_status in ('completed', 'delivered')),
        'eligibleNetAmount', coalesce((select sum(net_amount) from invoice_forms where approval_status in ('completed', 'delivered')), 0),
        'eligibleGrossAmount', coalesce((select sum(gross_amount) from invoice_forms where approval_status in ('completed', 'delivered')), 0),
        'pendingCount', (select count(*) from invoice_forms where approval_status not in ('completed', 'delivered', 'rejected')),
        'pendingNetAmount', coalesce((select sum(net_amount) from invoice_forms where approval_status not in ('completed', 'delivered', 'rejected')), 0),
        'rejectedCount', (select count(*) from invoice_forms where approval_status = 'rejected'),
        'rejectedNetAmount', coalesce((select sum(net_amount) from invoice_forms where approval_status = 'rejected'), 0),
        'eligibleNoLedgerCount', (select count(*) from invoice_forms f join invoice_form_posting p using (id) where f.approval_status in ('completed', 'delivered') and p.ledger_rows = 0),
        'eligibleNoLedgerAmount', coalesce((select sum(f.net_amount) from invoice_forms f join invoice_form_posting p using (id) where f.approval_status in ('completed', 'delivered') and p.ledger_rows = 0), 0),
        'officialAmount', (select revenue from current_summary),
        'officialCurrentForms', coalesce((select sum(revenue_amount) from current_revenue_linked where bridge_class = 'current_form'), 0),
        'officialPriorForms', coalesce((select sum(revenue_amount) from current_revenue_linked where bridge_class = 'prior_form'), 0),
        'officialFutureForms', coalesce((select sum(revenue_amount) from current_revenue_linked where bridge_class = 'future_form'), 0),
        'officialAdjustments', coalesce((select sum(revenue_amount) from current_revenue_linked where bridge_class = 'adjustment'), 0),
        'officialUnlinked', coalesce((select sum(revenue_amount) from current_revenue_linked where bridge_class = 'unlinked'), 0),
        'unlinkedSourceCount', (select count(*) from current_revenue_linked where bridge_class = 'unlinked'),
        'unlinkedSourceAbsoluteAmount', coalesce((select sum(abs(revenue_amount)) from current_revenue_linked where bridge_class = 'unlinked'), 0),
        'futureFormCount', (select count(*) from current_revenue_linked where bridge_class = 'future_form'),
        'exceptions', coalesce((
          select jsonb_agg(jsonb_build_object(
            'class', bridge_class, 'amount', revenue_amount, 'entryDate', entry_date,
            'sourceNo', coalesce(invoice_no, source_no, reference_no, source_key),
            'formDate', invoice_date, 'formStatus', approval_status
          ) order by abs(revenue_amount) desc)
          from (select * from current_revenue_linked where bridge_class <> 'current_form' order by abs(revenue_amount) desc limit 8) x
        ), '[]'::jsonb)
      )
    ),
    'rowCounts', (select to_jsonb(row_counts) from row_counts),
    'latestLedgerAt', (select max(created_at) from ledger_base)
  ) into v_result;

  return v_result;
end;
$function$;

alter function public.finance_executive_dashboard_v2(date,date,date,date,date,text,text) owner to postgres;
revoke all on function public.finance_executive_dashboard_v2(date,date,date,date,date,text,text) from public,anon;
grant execute on function public.finance_executive_dashboard_v2(date,date,date,date,date,text,text) to authenticated,service_role;

do $finance_dashboard_scope_postflight$
declare p record;denied boolean:=false;
begin
 select * into p from pg_proc where oid=to_regprocedure('public.finance_executive_dashboard_v2(date,date,date,date,date,text,text)');
 if p.oid is null or md5(p.prosrc)<>'84043dbdd33bd3e4152f61727e25b202' or not p.prosecdef or p.provolatile<>'s' or pg_get_userbyid(p.proowner)<>'postgres'
  or p.proconfig is distinct from array['search_path=""']::text[] or has_function_privilege('anon',p.oid,'EXECUTE')
  or not has_function_privilege('authenticated',p.oid,'EXECUTE') or not has_function_privilege('service_role',p.oid,'EXECUTE')
  or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE') then raise exception 'Dashboard scoped source/authority mismatch';end if;
 if not exists(select 1 from pg_proc where oid=to_regprocedure('public.finance_executive_dashboard_v3(date,date,date,date,date,text,text)') and md5(prosrc)='36e536eb3ccfc071a8541719022597f1') then raise exception 'Canonical dashboard financial calculation changed';end if;
 if auth.uid() is null then
  begin perform public.finance_executive_dashboard_v2(current_date,current_date,current_date,current_date,current_date,null,'test');exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'Dashboard accepted absent identity';end if;
 end if;
end;
$finance_dashboard_scope_postflight$;

notify pgrst, 'reload schema';
