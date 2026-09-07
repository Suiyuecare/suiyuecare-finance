CREATE OR REPLACE FUNCTION private.post_invoice_revenue_v2_internal(p_invoice_id text, p_require_complete boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tenant_id uuid;
  v_environment text;
  v_invoice public.invoices%rowtype;
  v_rule public.revenue_recognition_rules%rowtype;
  v_post_date date;
  v_post_amount numeric;
  v_output_tax numeric;
  v_revenue_amount numeric;
  v_revenue_rule jsonb;
  v_item_type text;
  v_tax_rate numeric;
  v_version integer;
  v_receivable_account_name text;
  v_revenue_account_name text;
  v_output_tax_account_name text;
begin
  if auth.uid() is not null then
    v_tenant_id := private.finance_require_authenticated_tenant();

    select invoice_row.data_environment
      into v_environment
    from public.invoices invoice_row
    where invoice_row.tenant_id = v_tenant_id
      and invoice_row.id = p_invoice_id;
  else
    -- Trigger/system execution has no browser actor.  The private function is
    -- not executable by API roles, so tenant and environment may be derived
    -- only from the globally identified source row in this branch.
    select
      invoice_row.tenant_id,
      invoice_row.data_environment
      into v_tenant_id, v_environment
    from public.invoices invoice_row
    where invoice_row.id = p_invoice_id;
  end if;

  if not found or v_tenant_id is null then
    raise exception '找不到可入帳的發票：%', p_invoice_id
      using errcode = 'P0002';
  end if;

  select invoice_row.*
    into v_invoice
  from public.invoices invoice_row
  where invoice_row.tenant_id = v_tenant_id
    and invoice_row.data_environment = v_environment
    and invoice_row.id = p_invoice_id
  for update;

  if not found then
    raise exception '發票的租戶或資料環境已變更，請重新整理：%',
      p_invoice_id
      using errcode = '40001';
  end if;

  v_environment :=
    pg_catalog.lower(coalesce(v_environment, 'production'));
  if v_environment not in ('production', 'test') then
    raise exception '發票資料環境不正確：%', v_invoice.no
      using errcode = '23514';
  end if;
  if v_invoice.voided_at is not null then
    raise exception '已作廢的發票不可認列收入：%', v_invoice.no
      using errcode = '23514';
  end if;

  if p_require_complete
     and not private.finance_invoice_fully_approved(v_invoice.steps) then
    update public.invoices invoice_row
       set revenue_posting_state = 'deferred',
           revenue_posting_error = null,
           updated_at = pg_catalog.now()
     where invoice_row.tenant_id = v_tenant_id
       and invoice_row.data_environment = v_environment
       and invoice_row.id = v_invoice.id
       and coalesce(invoice_row.revenue_posting_state, '') <> 'posted';

    return pg_catalog.jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'deferred', true,
      'invoice_id', v_invoice.id,
      'message', 'approval_incomplete_revenue_deferred'
    );
  end if;

  v_version := greatest(
    2::integer,
    coalesce(v_invoice.revenue_posting_version, 2::integer)
  );
  v_post_date := coalesce(v_invoice.invoice_date, current_date);
  v_post_amount := coalesce(v_invoice.total, v_invoice.amount, 0);
  if v_post_amount <= 0 then
    raise exception '發票收入認列金額必須大於零：%', v_invoice.no
      using errcode = '23514';
  end if;
  v_output_tax := least(
    v_post_amount,
    greatest(
      0::numeric,
      coalesce(v_invoice.tax, 0::numeric)
    )
  );
  v_revenue_amount := v_post_amount - v_output_tax;
  if v_revenue_amount <= 0 then
    raise exception '發票未稅收入金額必須大於零：%', v_invoice.no
      using errcode = '23514';
  end if;

  perform private.finance_assert_period_open(
    v_tenant_id,
    v_environment,
    v_invoice.entity_id,
    v_post_date,
    '發票收入認列'
  );

  if coalesce(v_invoice.revenue_posted, false)
     or v_invoice.revenue_posted_at is not null
     or coalesce(v_invoice.revenue_posting_state, '') = 'posted' then
    if coalesce(v_invoice.revenue_posted, false) is not true
       or v_invoice.revenue_posted_at is null
       or coalesce(v_invoice.revenue_posting_state, '') <> 'posted'
       or not exists (
         select 1
         from public.ledger_entries ledger_row
         where ledger_row.tenant_id = v_tenant_id
           and ledger_row.data_environment = v_environment
           and ledger_row.source_type = 'invoice'
           and ledger_row.source_id = v_invoice.id
           and ledger_row.reference_no = v_invoice.no
           and ledger_row.entity_id = v_invoice.entity_id
           and ledger_row.department_code is not distinct from
             v_invoice.department_code
           and ledger_row.voided_at is null
           and ledger_row.posting_key in (
             'tenant:' || v_tenant_id::text || ':invoice:' ||
               v_invoice.no || ':revenue:v' ||
               v_version || ':ar',
             'tenant:' || v_tenant_id::text || ':invoice:' ||
               v_invoice.no || ':revenue:v' ||
               v_version || ':income',
             'tenant:' || v_tenant_id::text || ':invoice:' ||
               v_invoice.no || ':revenue:v' ||
               v_version || ':output_tax'
           )
         having pg_catalog.count(*) =
             case when v_output_tax > 0 then 3 else 2 end
           and pg_catalog.count(*) filter (
             where ledger_row.posting_key =
               'tenant:' || v_tenant_id::text || ':invoice:' ||
                 v_invoice.no || ':revenue:v' ||
               v_version || ':ar'
               and ledger_row.account_code = '1123'
               and pg_catalog.abs(
                 coalesce(ledger_row.debit, 0) - v_post_amount
               ) <= 0.01
               and coalesce(ledger_row.credit, 0) = 0
           ) = 1
           and pg_catalog.count(*) filter (
             where ledger_row.posting_key =
               'tenant:' || v_tenant_id::text || ':invoice:' ||
                 v_invoice.no || ':revenue:v' ||
               v_version || ':income'
               and ledger_row.account_code =
                 v_invoice.revenue_account_code
               and pg_catalog.abs(
                 coalesce(ledger_row.credit, 0) - v_revenue_amount
               ) <= 0.01
               and coalesce(ledger_row.debit, 0) = 0
           ) = 1
           and (
             (
               v_output_tax = 0
               and pg_catalog.count(*) filter (
                 where ledger_row.account_code = '2134'
               ) = 0
             )
             or pg_catalog.count(*) filter (
               where ledger_row.posting_key =
                 'tenant:' || v_tenant_id::text || ':invoice:' ||
                   v_invoice.no || ':revenue:v' ||
                 v_version || ':output_tax'
                 and ledger_row.account_code = '2134'
                 and pg_catalog.abs(
                   coalesce(ledger_row.credit, 0) - v_output_tax
                 ) <= 0.01
                 and coalesce(ledger_row.debit, 0) = 0
             ) = 1
           )
           and pg_catalog.abs(
             coalesce(pg_catalog.sum(ledger_row.debit), 0) -
             coalesce(pg_catalog.sum(ledger_row.credit), 0)
           ) <= 0.01
       ) then
      raise exception '發票 % 的收入認列標記與分類帳不一致，已停止重試',
        v_invoice.no
        using errcode = '23514';
    end if;

    return pg_catalog.jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'deferred', false,
      'invoice_id', v_invoice.id
    );
  end if;

  v_tax_rate := case
    when coalesce(v_invoice.total, 0) > coalesce(v_invoice.tax, 0)
      then pg_catalog.round(
        coalesce(v_invoice.tax, 0) /
          nullif(v_invoice.total - coalesce(v_invoice.tax, 0), 0),
        4
      )
    else null
  end;
  v_item_type := coalesce(
    nullif(v_invoice.invoice_item_type, ''),
    public.legacy_invoice_item_type(
      v_invoice.description,
      v_invoice.buyer,
      v_invoice.department_code
    )
  );

  select rule_row.*
    into v_rule
  from public.revenue_recognition_rules rule_row
  where rule_row.tenant_id = v_tenant_id
    and rule_row.active is true
    and v_post_date between rule_row.effective_from
      and coalesce(rule_row.effective_to, date '9999-12-31')
    and (
      rule_row.entity_id is null
      or rule_row.entity_id = v_invoice.entity_id
    )
    and (
      rule_row.department_code is null
      or rule_row.department_code = v_invoice.department_code
    )
    and (
      rule_row.department_code_pattern is null
      or coalesce(v_invoice.department_code, '') ~
        rule_row.department_code_pattern
    )
    and (
      rule_row.invoice_item_type is null
      or rule_row.invoice_item_type = v_item_type
    )
    and (
      rule_row.payer_type is null
      or rule_row.payer_type =
        coalesce(v_invoice.payer_type, rule_row.payer_type)
    )
    and (
      rule_row.funding_source is null
      or rule_row.funding_source =
        coalesce(v_invoice.funding_source, rule_row.funding_source)
    )
    and (
      rule_row.invoice_identifier_type is null
      or rule_row.invoice_identifier_type = v_invoice.invoice_identifier_type
    )
    and (
      rule_row.tax_rate is null
      or v_tax_rate is null
      or pg_catalog.abs(rule_row.tax_rate - v_tax_rate) < 0.0001
    )
  order by
    rule_row.priority,
    case when rule_row.entity_id is not null then 0 else 1 end,
    case
      when rule_row.department_code is not null
        or rule_row.department_code_pattern is not null
        then 0
      else 1
    end,
    case when rule_row.invoice_item_type is not null then 0 else 1 end,
    rule_row.created_at
  limit 1;

  if v_rule.id is null then
    raise exception '發票 % 找不到目前租戶可用的收入認列規則',
      v_invoice.no
      using errcode = '23514';
  end if;

  v_receivable_account_name :=
    private.finance_tenant_account_name(v_tenant_id, '1123');
  v_revenue_account_name :=
    private.finance_tenant_account_name(
      v_tenant_id,
      v_rule.revenue_account_code
    );
  v_output_tax_account_name :=
    private.finance_tenant_account_name(v_tenant_id, '2134');
  if v_receivable_account_name is null
     or v_revenue_account_name is null
     or (
       v_output_tax > 0
       and v_output_tax_account_name is null
     ) then
    raise exception '發票 % 的應收、收入或銷項稅額科目不存在或已停用',
      v_invoice.no
      using errcode = '23503';
  end if;

  v_revenue_rule := pg_catalog.jsonb_build_object(
    'ok', true,
    'rule_id', v_rule.id,
    'rule_code', v_rule.code,
    'invoice_item_type', v_item_type,
    'recognition_basis', v_rule.recognition_basis,
    'revenue_account_code', v_rule.revenue_account_code,
    'revenue_account_name', v_revenue_account_name
  );

  if exists (
    select 1
    from public.ledger_entries ledger_row
    where ledger_row.tenant_id = v_tenant_id
      and ledger_row.data_environment = v_environment
      and ledger_row.posting_key in (
        'tenant:' || v_tenant_id::text || ':invoice:' ||
          v_invoice.no || ':revenue:v' ||
          v_version || ':ar',
        'tenant:' || v_tenant_id::text || ':invoice:' ||
          v_invoice.no || ':revenue:v' ||
          v_version || ':income',
        'tenant:' || v_tenant_id::text || ':invoice:' ||
          v_invoice.no || ':revenue:v' ||
          v_version || ':output_tax'
      )
      and ledger_row.voided_at is null
  ) then
    raise exception '發票 % 已存在部分收入分錄但未完成狀態，請人工查明',
      v_invoice.no
      using errcode = '23505';
  end if;

  insert into public.ledger_entries (
    entry_date,
    description,
    entity_id,
    department_code,
    debit,
    credit,
    account_code,
    account_name,
    reference_no,
    posting_key,
    source_type,
    source_id,
    source_no,
    data_environment,
    tenant_id
  )
  select *
  from (
    values
      (
        v_post_date,
        '發票開立應收 — ' || coalesce(v_invoice.buyer, ''),
        v_invoice.entity_id,
        v_invoice.department_code,
        v_post_amount,
        0::numeric,
        '1123',
        v_receivable_account_name,
        v_invoice.no,
        'tenant:' || v_tenant_id::text || ':invoice:' ||
          v_invoice.no || ':revenue:v' ||
          v_version || ':ar',
        'invoice',
        v_invoice.id::text,
        v_invoice.no,
        v_environment,
        v_tenant_id
      ),
      (
        v_post_date,
        '發票收入 — ' || coalesce(v_invoice.buyer, '') || ' — ' ||
          coalesce(v_rule.code, ''),
        v_invoice.entity_id,
        v_invoice.department_code,
        0::numeric,
        v_revenue_amount,
        v_rule.revenue_account_code,
        v_revenue_account_name,
        v_invoice.no,
        'tenant:' || v_tenant_id::text || ':invoice:' ||
          v_invoice.no || ':revenue:v' ||
          v_version || ':income',
        'invoice',
        v_invoice.id::text,
        v_invoice.no,
        v_environment,
        v_tenant_id
      ),
      (
        v_post_date,
        '發票銷項稅額 — ' || coalesce(v_invoice.buyer, ''),
        v_invoice.entity_id,
        v_invoice.department_code,
        0::numeric,
        v_output_tax,
        '2134',
        v_output_tax_account_name,
        v_invoice.no,
        'tenant:' || v_tenant_id::text || ':invoice:' ||
          v_invoice.no || ':revenue:v' ||
          v_version || ':output_tax',
        'invoice',
        v_invoice.id::text,
        v_invoice.no,
        v_environment,
        v_tenant_id
      )
  ) posting_row(
    entry_date,
    description,
    entity_id,
    department_code,
    debit,
    credit,
    account_code,
    account_name,
    reference_no,
    posting_key,
    source_type,
    source_id,
    source_no,
    data_environment,
    tenant_id
  )
  where posting_row.debit <> 0 or posting_row.credit <> 0;

  update public.invoices invoice_row
     set invoice_item_type = coalesce(
           nullif(invoice_row.invoice_item_type, ''),
           v_item_type
         ),
         revenue_rule_id = v_rule.id,
         revenue_account_code = v_rule.revenue_account_code,
         revenue_account_name = v_revenue_account_name,
         revenue_rule_snapshot = pg_catalog.jsonb_build_object(
           'rule_id', v_rule.id,
           'code', v_rule.code,
           'name', v_rule.name,
           'priority', v_rule.priority,
           'invoice_item_type', v_item_type,
           'payer_type', v_invoice.payer_type,
           'funding_source', v_invoice.funding_source,
           'recognition_basis', v_rule.recognition_basis,
           'revenue_account_code', v_rule.revenue_account_code,
           'revenue_account_name', v_revenue_account_name,
           'resolved_at', pg_catalog.now()
         ),
         revenue_posted = true,
         revenue_posted_at = pg_catalog.now(),
         posting_locked_at = coalesce(
           invoice_row.posting_locked_at,
           pg_catalog.now()
         ),
         revenue_posting_state = 'posted',
         revenue_posting_version = v_version,
         revenue_posting_error = null,
         updated_at = pg_catalog.now()
   where invoice_row.tenant_id = v_tenant_id
     and invoice_row.data_environment = v_environment
     and invoice_row.id = v_invoice.id;

  if not found then
    raise exception '發票收入入帳後狀態寫回失敗：%', v_invoice.no
      using errcode = '55000';
  end if;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'deferred', false,
    'invoice_id', v_invoice.id,
    'posting_version', v_version,
    'revenue_rule', v_revenue_rule
  );
end;
$function$
