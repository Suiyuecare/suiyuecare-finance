-- Module Finance month-end close hardening.
-- Apply after module_finance_production_schema.sql, compliance_and_drafts.sql,
-- accounting_rpc.sql, and rls_hardening.sql.
--
-- Goal:
--   Once a legal entity + YYYY-MM period is closed, posted accounting rows for
--   that period cannot be inserted, updated, or deleted directly. Corrections
--   must be posted in an open period through reversal / adjustment vouchers.

begin;

create table if not exists public.period_closes (
  id text primary key,
  entity_id text not null,
  period text not null,
  status text not null default 'closed',
  closed_by text,
  closed_at timestamptz not null default now(),
  note text,
  unique(entity_id, period)
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'period_closes_period_format'
      and conrelid = 'public.period_closes'::regclass
  ) then
    alter table public.period_closes
      add constraint period_closes_period_format
      check (period ~ '^[0-9]{4}-[0-9]{2}$');
  end if;
end;
$$;

create unique index if not exists idx_period_closes_entity_period
on public.period_closes(entity_id, period);

create or replace function public.accounting_period(p_date date)
returns text
language sql
stable
as $$
  select to_char(coalesce(p_date, current_date), 'YYYY-MM')
$$;

create or replace function public.is_period_closed(
  p_entity_id text,
  p_date date
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.period_closes pc
    where pc.entity_id = p_entity_id
      and pc.period = public.accounting_period(p_date)
      and pc.status = 'closed'
  )
$$;

create or replace function public.assert_period_open(
  p_entity_id text,
  p_date date,
  p_action text default 'post accounting entry'
)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_entity_id is null or p_date is null then
    return;
  end if;

  if public.is_period_closed(p_entity_id, p_date) then
    raise exception 'Accounting period % for entity % is closed; % is not allowed. Use a reversal or adjustment voucher in an open period.',
      public.accounting_period(p_date),
      p_entity_id,
      coalesce(p_action, 'posting');
  end if;
end;
$$;

create or replace function public.prevent_closed_ledger_mutation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  row_entity text;
  row_date date;
begin
  row_entity := coalesce(new.entity_id, old.entity_id);
  row_date := coalesce(new.entry_date, old.entry_date);

  if tg_op = 'INSERT' then
    perform public.assert_period_open(row_entity, row_date, 'insert ledger entry');
  elsif tg_op = 'UPDATE' then
    perform public.assert_period_open(coalesce(old.entity_id, row_entity), coalesce(old.entry_date, row_date), 'update ledger entry');
    perform public.assert_period_open(row_entity, row_date, 'update ledger entry');
  elsif tg_op = 'DELETE' then
    perform public.assert_period_open(row_entity, row_date, 'delete ledger entry');
  end if;

  return coalesce(new, old);
end;
$$;

create or replace function public.prevent_closed_voucher_mutation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  row_entity text;
  row_date date;
begin
  row_entity := coalesce(new.entity_id, old.entity_id);
  row_date := coalesce(new.voucher_date, old.voucher_date);

  if tg_op = 'INSERT' then
    perform public.assert_period_open(row_entity, row_date, 'insert voucher');
  elsif tg_op = 'UPDATE' then
    perform public.assert_period_open(coalesce(old.entity_id, row_entity), coalesce(old.voucher_date, row_date), 'update voucher');
    perform public.assert_period_open(row_entity, row_date, 'update voucher');
  elsif tg_op = 'DELETE' then
    perform public.assert_period_open(row_entity, row_date, 'delete voucher');
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_prevent_closed_ledger_mutation on public.ledger_entries;
create trigger trg_prevent_closed_ledger_mutation
before insert or update or delete on public.ledger_entries
for each row execute function public.prevent_closed_ledger_mutation();

drop trigger if exists trg_prevent_closed_voucher_mutation on public.vouchers;
create trigger trg_prevent_closed_voucher_mutation
before insert or update or delete on public.vouchers
for each row execute function public.prevent_closed_voucher_mutation();

-- Patch the atomic RPCs as a second line of defense so the error appears before
-- partial business-state changes are attempted inside the transaction.
create or replace function public.finalize_expense_request(
  p_request_id text,
  p_status text,
  p_step int,
  p_steps jsonb,
  p_amount numeric,
  p_bank_fee_amount numeric,
  p_voucher_id text,
  p_voucher_no text,
  p_entity_name text,
  p_voucher_entries jsonb,
  p_voucher_total numeric,
  p_voucher_description text,
  p_voucher_date date,
  p_form_payload jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  req public.expense_requests%rowtype;
  entry jsonb;
  entry_idx int := 0;
  entry_type text;
  entry_account text;
  entry_name text;
  entry_dept text;
  entry_amount numeric;
  entry_debit numeric;
  entry_credit numeric;
  entry_desc text;
  entry_key text;
  post_date date;
begin
  perform public.assert_accounting_actor();

  select *
  into req
  from public.expense_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'Expense request not found: %', p_request_id;
  end if;

  post_date := coalesce(p_voucher_date, current_date);
  perform public.assert_period_open(req.entity_id, post_date, 'finalize expense request');

  if req.voided_at is not null then
    raise exception 'Voided expense request cannot be posted: %', p_request_id;
  end if;

  if req.voucher_id is not null or req.ledger_posted_at is not null or req.posting_locked_at is not null or req.status = 'completed' then
    return jsonb_build_object('ok', true, 'idempotent', true, 'voucher_id', req.voucher_id);
  end if;

  if p_amount is null or p_amount < 0 then
    raise exception 'Invalid posting amount';
  end if;

  if p_voucher_id is null or p_voucher_no is null then
    raise exception 'Voucher id/no is required';
  end if;

  update public.expense_requests
  set amount = p_amount,
      estimated_amount = coalesce(
        nullif(p_form_payload ->> 'advanceOriginalAmount', '')::numeric,
        nullif(p_form_payload ->> 'purchaseEstimateAmount', '')::numeric,
        estimated_amount
      ),
      actual_amount = coalesce(
        nullif(p_form_payload ->> 'advanceFinalAmount', '')::numeric,
        nullif(p_form_payload ->> 'purchaseFinalizedAmount', '')::numeric,
        actual_amount
      ),
      status = coalesce(p_status, 'completed'),
      step = coalesce(p_step, 8),
      steps = coalesce(p_steps, req.steps),
      voucher_id = p_voucher_id,
      bank_fee_amount = coalesce(p_bank_fee_amount, 0),
      form_payload = coalesce(p_form_payload, req.form_payload)
        || jsonb_build_object('ledgerPostedAt', now(), 'postingLockedAt', now()),
      ledger_posted_at = now(),
      posting_locked_at = now(),
      updated_at = now()
  where id = p_request_id;

  insert into public.vouchers (
    id, no, request_id, entity_id, entity_name, voucher_date, description, entries, total, creator, posted, posted_at, posting_locked_at
  )
  values (
    p_voucher_id,
    p_voucher_no,
    p_request_id,
    req.entity_id,
    coalesce(p_entity_name, nullif(req.entity_id, '')),
    post_date,
    p_voucher_description,
    coalesce(p_voucher_entries, '[]'::jsonb),
    coalesce(p_voucher_total, p_amount + coalesce(p_bank_fee_amount, 0)),
    coalesce(public.current_finance_user_name(), 'system'),
    true,
    now(),
    now()
  )
  on conflict (id) do nothing;

  for entry in select * from jsonb_array_elements(coalesce(p_voucher_entries, '[]'::jsonb))
  loop
    entry_idx := entry_idx + 1;
    entry_type := entry ->> 't';
    entry_account := entry ->> 'ac';
    entry_name := entry ->> 'an';
    entry_dept := coalesce(entry ->> 'dept', req.department_code);
    entry_amount := coalesce((entry ->> 'amt')::numeric, 0);
    entry_debit := case when entry_type = 'dr' then entry_amount else 0 end;
    entry_credit := case when entry_type = 'cr' then entry_amount else 0 end;
    entry_desc := case
      when entry_account = '6290' then coalesce(req.type_label, '申請') || ' 銀行手續費'
      when entry_type = 'cr' then coalesce(req.type_label, '申請') || ' 付款'
      else coalesce(req.type_label, '申請') || ' — ' || coalesce(req.applicant, '')
    end;
    entry_key := 'expense:' || req.no || ':' || entry_idx || ':' || entry_account || ':' || entry_type;

    insert into public.ledger_entries (
      entry_date, description, entity_id, department_code, debit, credit, account_code, account_name, reference_no, posting_key, source_type, source_id, source_no, voucher_no
    )
    values (
      post_date,
      entry_desc,
      req.entity_id,
      entry_dept,
      entry_debit,
      entry_credit,
      entry_account,
      entry_name,
      req.no,
      entry_key,
      'expense_request',
      req.id::text,
      req.no,
      p_voucher_no
    )
    on conflict (posting_key) do nothing;
  end loop;

  return jsonb_build_object('ok', true, 'idempotent', false, 'voucher_id', p_voucher_id);
end;
$$;

create or replace function public.post_invoice_revenue(
  p_invoice_id text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  inv public.invoices%rowtype;
  post_date date;
  post_amount numeric;
  post_entity text;
  post_dept text;
begin
  perform public.assert_accounting_actor();

  select *
  into inv
  from public.invoices
  where id = p_invoice_id
  for update;

  if not found then
    raise exception 'Invoice not found: %', p_invoice_id;
  end if;

  post_date := coalesce(inv.invoice_date, current_date);
  post_entity := inv.entity_id;
  perform public.assert_period_open(post_entity, post_date, 'recognize invoice revenue');

  if inv.voided_at is not null then
    raise exception 'Voided invoice cannot be posted: %', p_invoice_id;
  end if;

  if inv.revenue_posted or inv.revenue_posted_at is not null then
    return jsonb_build_object('ok', true, 'idempotent', true, 'invoice_id', inv.id);
  end if;

  post_amount := coalesce(inv.total, inv.amount, 0);
  post_dept := inv.department_code;

  if post_amount <= 0 then
    raise exception 'Invalid invoice revenue amount';
  end if;

  insert into public.ledger_entries (
    entry_date, description, entity_id, department_code, debit, credit, account_code, account_name, reference_no, posting_key, source_type, source_id, source_no
  )
  values
    (post_date, '發票開立應收 — ' || coalesce(inv.buyer, ''), post_entity, post_dept, post_amount, 0, '1123', '應收帳款', inv.no, 'invoice:' || inv.no || ':revenue:ar', 'invoice', inv.id::text, inv.no),
    (post_date, '發票收入 — ' || coalesce(inv.buyer, ''), post_entity, post_dept, 0, post_amount, '4100', '已開立發票收入', inv.no, 'invoice:' || inv.no || ':revenue:income', 'invoice', inv.id::text, inv.no)
  on conflict (posting_key) do nothing;

  update public.invoices
  set revenue_posted = true,
      revenue_posted_at = now(),
      posting_locked_at = coalesce(posting_locked_at, now()),
      updated_at = now()
  where id = inv.id;

  return jsonb_build_object('ok', true, 'idempotent', false, 'invoice_id', inv.id);
end;
$$;

create or replace function public.post_invoice_cash_receipt(
  p_invoice_id text,
  p_paid_at timestamptz default now(),
  p_reviewed_by text default null,
  p_review_note text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  inv public.invoices%rowtype;
  post_date date;
  post_amount numeric;
  post_entity text;
  post_dept text;
begin
  perform public.assert_accounting_actor();

  select *
  into inv
  from public.invoices
  where id = p_invoice_id
  for update;

  if not found then
    raise exception 'Invoice not found: %', p_invoice_id;
  end if;

  post_date := coalesce(p_paid_at, now())::date;
  post_entity := inv.entity_id;
  perform public.assert_period_open(post_entity, post_date, 'post invoice cash receipt');

  if inv.voided_at is not null then
    raise exception 'Voided invoice cannot receive cash: %', p_invoice_id;
  end if;

  if inv.cash_receipt_posted_at is not null or (inv.status = 'paid' and inv.paid_at is not null and exists (
    select 1
    from public.ledger_entries
    where posting_key = 'invoice:' || inv.no || ':receipt:bank'
  )) then
    return jsonb_build_object('ok', true, 'idempotent', true, 'invoice_id', inv.id);
  end if;

  post_amount := coalesce(inv.total, inv.amount, 0);
  post_dept := inv.department_code;

  if post_amount <= 0 then
    raise exception 'Invalid invoice receipt amount';
  end if;

  insert into public.ledger_entries (
    entry_date, description, entity_id, department_code, debit, credit, account_code, account_name, reference_no, posting_key, source_type, source_id, source_no
  )
  values
    (post_date, '發票收款入帳 — ' || coalesce(inv.buyer, ''), post_entity, post_dept, post_amount, 0, '1112', '銀行存款', inv.no, 'invoice:' || inv.no || ':receipt:bank', 'invoice', inv.id::text, inv.no),
    (post_date, '沖轉應收帳款 — ' || coalesce(inv.buyer, ''), post_entity, post_dept, 0, post_amount, '1123', '應收帳款', inv.no, 'invoice:' || inv.no || ':receipt:ar', 'invoice', inv.id::text, inv.no)
  on conflict (posting_key) do nothing;

  update public.invoices
  set status = 'paid',
      paid_at = coalesce(p_paid_at, now()),
      receipt_reviewed_at = coalesce(p_paid_at, now()),
      receipt_reviewed_by = coalesce(p_reviewed_by, public.current_finance_user_name()),
      receipt_review_note = p_review_note,
      cash_receipt_posted_at = now(),
      posting_locked_at = coalesce(posting_locked_at, now()),
      updated_at = now()
  where id = inv.id;

  return jsonb_build_object('ok', true, 'idempotent', false, 'invoice_id', inv.id);
end;
$$;

revoke all on function public.accounting_period(date) from public, anon;
revoke all on function public.is_period_closed(text,date) from public, anon;
revoke all on function public.assert_period_open(text,date,text) from public, anon;
revoke all on function public.prevent_closed_ledger_mutation() from public, anon;
revoke all on function public.prevent_closed_voucher_mutation() from public, anon;

grant execute on function public.is_period_closed(text,date) to authenticated;
grant execute on function public.assert_period_open(text,date,text) to authenticated;

commit;
