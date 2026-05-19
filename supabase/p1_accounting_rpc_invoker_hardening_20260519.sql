-- P1 hardening: make public accounting RPCs run with caller privileges.
-- Keep EXECUTE granted to authenticated users because the single-page app calls
-- these RPCs directly, but require all data access to pass RLS and the existing
-- assert_accounting_actor() role guard.

begin;

alter function public.assert_accounting_actor() security invoker;
alter function public.finalize_expense_request(text, text, int, jsonb, numeric, numeric, text, text, text, jsonb, numeric, text, date, jsonb) security invoker;
alter function public.post_invoice_revenue(text) security invoker;
alter function public.post_invoice_cash_receipt(text, timestamptz, text, text) security invoker;

do $$
begin
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'next_voucher_no'
      and pg_get_function_identity_arguments(p.oid) = 'p_kind text, p_voucher_date date'
  ) then
    alter function public.next_voucher_no(text, date) security invoker;
  end if;
end;
$$;

revoke all on function public.assert_accounting_actor() from public, anon;
revoke all on function public.finalize_expense_request(text, text, int, jsonb, numeric, numeric, text, text, text, jsonb, numeric, text, date, jsonb) from public, anon;
revoke all on function public.post_invoice_revenue(text) from public, anon;
revoke all on function public.post_invoice_cash_receipt(text, timestamptz, text, text) from public, anon;

grant execute on function public.finalize_expense_request(text, text, int, jsonb, numeric, numeric, text, text, text, jsonb, numeric, text, date, jsonb) to authenticated;
grant execute on function public.post_invoice_revenue(text) to authenticated;
grant execute on function public.post_invoice_cash_receipt(text, timestamptz, text, text) to authenticated;
grant execute on function public.assert_accounting_actor() to authenticated;

do $$
begin
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'next_voucher_no'
      and pg_get_function_identity_arguments(p.oid) = 'p_kind text, p_voucher_date date'
  ) then
    revoke all on function public.next_voucher_no(text, date) from public, anon;
    grant execute on function public.next_voucher_no(text, date) to authenticated;
  end if;
end;
$$;

commit;
