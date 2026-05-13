-- Module Finance atomic accounting RPCs.
-- Apply after module_finance_production_schema.sql and rls_hardening.sql.
--
-- Purpose:
--   1. Finalize an expense request, create voucher, and post ledger entries in one DB transaction.
--   2. Recognize invoice revenue exactly once.
--   3. Post invoice cash receipt exactly once.

begin;

alter table public.ledger_entries add column if not exists posting_key text;

create unique index if not exists idx_ledger_entries_posting_key
on public.ledger_entries(posting_key);

create or replace function public.assert_accounting_actor()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_finance_accounting() then
    raise exception 'Only accounting, admin director, or CEO can post accounting entries';
  end if;
end;
$$;

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
  p_voucher_date date default current_date,
  p_form_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
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

  if req.voucher_id is not null or req.status = 'completed' then
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
      status = coalesce(p_status, 'completed'),
      step = coalesce(p_step, 8),
      steps = coalesce(p_steps, req.steps),
      voucher_id = p_voucher_id,
      bank_fee_amount = coalesce(p_bank_fee_amount, 0),
      form_payload = coalesce(p_form_payload, req.form_payload),
      updated_at = now()
  where id = p_request_id;

  insert into public.vouchers (
    id, no, request_id, entity_id, entity_name, voucher_date, description, entries, total, creator, posted
  )
  values (
    p_voucher_id,
    p_voucher_no,
    p_request_id,
    req.entity_id,
    coalesce(p_entity_name, nullif(req.entity_id, '')),
    coalesce(p_voucher_date, current_date),
    p_voucher_description,
    coalesce(p_voucher_entries, '[]'::jsonb),
    coalesce(p_voucher_total, p_amount + coalesce(p_bank_fee_amount, 0)),
    coalesce(public.current_finance_user_name(), 'system'),
    true
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
      entry_date, description, entity_id, department_code, debit, credit, account_code, account_name, reference_no, posting_key
    )
    values (
      coalesce(p_voucher_date, current_date),
      entry_desc,
      req.entity_id,
      entry_dept,
      entry_debit,
      entry_credit,
      entry_account,
      entry_name,
      req.no,
      entry_key
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
security definer
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

  if inv.revenue_posted then
    return jsonb_build_object('ok', true, 'idempotent', true, 'invoice_id', inv.id);
  end if;

  post_date := coalesce(inv.invoice_date, current_date);
  post_amount := coalesce(inv.total, inv.amount, 0);
  post_entity := inv.entity_id;
  post_dept := inv.department_code;

  if post_amount <= 0 then
    raise exception 'Invalid invoice revenue amount';
  end if;

  insert into public.ledger_entries (
    entry_date, description, entity_id, department_code, debit, credit, account_code, account_name, reference_no, posting_key
  )
  values
    (post_date, '發票開立應收 — ' || coalesce(inv.buyer, ''), post_entity, post_dept, post_amount, 0, '1123', '應收帳款', inv.no, 'invoice:' || inv.no || ':revenue:ar'),
    (post_date, '發票收入 — ' || coalesce(inv.buyer, ''), post_entity, post_dept, 0, post_amount, '4100', '已開立發票收入', inv.no, 'invoice:' || inv.no || ':revenue:income')
  on conflict (posting_key) do nothing;

  update public.invoices
  set revenue_posted = true,
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
security definer
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

  if inv.status = 'paid' and inv.paid_at is not null and exists (
    select 1
    from public.ledger_entries
    where posting_key = 'invoice:' || inv.no || ':receipt:bank'
  ) then
    return jsonb_build_object('ok', true, 'idempotent', true, 'invoice_id', inv.id);
  end if;

  post_date := coalesce(p_paid_at, now())::date;
  post_amount := coalesce(inv.total, inv.amount, 0);
  post_entity := inv.entity_id;
  post_dept := inv.department_code;

  if post_amount <= 0 then
    raise exception 'Invalid invoice receipt amount';
  end if;

  insert into public.ledger_entries (
    entry_date, description, entity_id, department_code, debit, credit, account_code, account_name, reference_no, posting_key
  )
  values
    (post_date, '發票收款入帳 — ' || coalesce(inv.buyer, ''), post_entity, post_dept, post_amount, 0, '1112', '銀行存款', inv.no, 'invoice:' || inv.no || ':receipt:bank'),
    (post_date, '沖轉應收帳款 — ' || coalesce(inv.buyer, ''), post_entity, post_dept, 0, post_amount, '1123', '應收帳款', inv.no, 'invoice:' || inv.no || ':receipt:ar')
  on conflict (posting_key) do nothing;

  update public.invoices
  set status = 'paid',
      paid_at = coalesce(p_paid_at, now()),
      receipt_reviewed_at = coalesce(p_paid_at, now()),
      receipt_reviewed_by = coalesce(p_reviewed_by, public.current_finance_user_name()),
      receipt_review_note = p_review_note,
      updated_at = now()
  where id = inv.id;

  return jsonb_build_object('ok', true, 'idempotent', false, 'invoice_id', inv.id);
end;
$$;

revoke all on function public.assert_accounting_actor() from public, anon;
revoke all on function public.finalize_expense_request(text,text,int,jsonb,numeric,numeric,text,text,text,jsonb,numeric,text,date,jsonb) from public, anon;
revoke all on function public.post_invoice_revenue(text) from public, anon;
revoke all on function public.post_invoice_cash_receipt(text,timestamptz,text,text) from public, anon;

grant execute on function public.finalize_expense_request(text,text,int,jsonb,numeric,numeric,text,text,text,jsonb,numeric,text,date,jsonb) to authenticated;
grant execute on function public.post_invoice_revenue(text) to authenticated;
grant execute on function public.post_invoice_cash_receipt(text,timestamptz,text,text) to authenticated;

commit;
