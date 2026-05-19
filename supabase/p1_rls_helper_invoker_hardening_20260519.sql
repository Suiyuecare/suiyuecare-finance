-- P1 security hardening applied on 2026-05-19.
-- RLS helper functions are SECURITY INVOKER so authenticated users do not get
-- exposed SECURITY DEFINER helper RPCs. Accounting posting RPCs remain
-- SECURITY DEFINER because they must perform atomic writes, but each function
-- keeps an internal accounting-role assertion.

begin;

alter function public.current_finance_user() security invoker;
alter function public.current_finance_user_id() security invoker;
alter function public.current_finance_user_name() security invoker;
alter function public.current_finance_role() security invoker;
alter function public.current_finance_department() security invoker;
alter function public.current_finance_entity() security invoker;
alter function public.is_finance_admin() security invoker;
alter function public.is_finance_accounting() security invoker;
alter function public.is_finance_hr() security invoker;
alter function public.is_finance_general_affairs() security invoker;
alter function public.json_steps_include_current_user(jsonb) security invoker;
alter function public.json_steps_role_matches(jsonb) security invoker;
alter function public.can_read_expense_request(expense_requests) security invoker;
alter function public.can_update_expense_request(expense_requests) security invoker;
alter function public.can_read_invoice(invoices) security invoker;
alter function public.can_update_invoice(invoices) security invoker;
alter function public.can_read_notification(notifications) security invoker;

grant execute on function public.current_finance_user() to authenticated;
grant execute on function public.current_finance_user_id() to authenticated;
grant execute on function public.current_finance_user_name() to authenticated;
grant execute on function public.current_finance_role() to authenticated;
grant execute on function public.current_finance_department() to authenticated;
grant execute on function public.current_finance_entity() to authenticated;
grant execute on function public.is_finance_admin() to authenticated;
grant execute on function public.is_finance_accounting() to authenticated;
grant execute on function public.is_finance_hr() to authenticated;
grant execute on function public.is_finance_general_affairs() to authenticated;
grant execute on function public.json_steps_include_current_user(jsonb) to authenticated;
grant execute on function public.json_steps_role_matches(jsonb) to authenticated;
grant execute on function public.can_read_expense_request(expense_requests) to authenticated;
grant execute on function public.can_update_expense_request(expense_requests) to authenticated;
grant execute on function public.can_read_invoice(invoices) to authenticated;
grant execute on function public.can_update_invoice(invoices) to authenticated;
grant execute on function public.can_read_notification(notifications) to authenticated;

commit;
