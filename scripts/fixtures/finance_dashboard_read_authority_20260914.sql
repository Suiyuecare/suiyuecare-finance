-- Production catalog-only read helpers captured 2026-09-14. No operational data.
CREATE OR REPLACE FUNCTION public.is_finance_accounting()
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select coalesce(public.current_finance_role() in ('ceo','admin_director','accountant'), false)
$function$;

CREATE OR REPLACE FUNCTION public.can_read_expense_request(p_request expense_requests)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select
    nullif(public.current_finance_user_id(), '') is not null
    and nullif(public.finance_current_verified_google_email_v2(), '') is not null
    and p_request.tenant_id = public.current_tenant_id()
    and (
      public.is_finance_accounting()
      or p_request.applicant = public.current_finance_user_name()
      or p_request.form_payload -> 'applicantProfile' ->> 'id' =
         public.current_finance_user_id()
      or lower(nullif(
           p_request.form_payload -> 'applicantProfile' ->> 'email',
           ''
         )) = public.finance_current_verified_google_email_v2()
      or public.json_steps_include_current_user(p_request.steps)
      or public.json_steps_role_matches(p_request.steps)
      or (
        public.current_finance_role() in ('section_chief', 'dept_manager')
        and p_request.department_code = public.current_finance_department()
      )
      or (
        public.current_finance_role() = 'hr'
        and p_request.type = 'welfare_request'
      )
      or (
        public.current_finance_role() = 'general_affairs'
        and p_request.type = 'purchase_request'
      )
    )
$function$;

CREATE OR REPLACE FUNCTION public.can_read_invoice(p_invoice invoices)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select
    nullif(public.current_finance_user_id(), '') is not null
    and nullif(public.finance_current_verified_google_email_v2(), '') is not null
    and p_invoice.tenant_id = public.current_tenant_id()
    and (
      public.is_finance_accounting()
      or p_invoice.applicant = public.current_finance_user_name()
      or p_invoice.applicant_id = public.current_finance_user_id()
      or public.json_steps_include_current_user(p_invoice.steps)
      or public.json_steps_role_matches(p_invoice.steps)
      or (
        public.current_finance_role() in ('section_chief', 'dept_manager')
        and p_invoice.department_code = public.current_finance_department()
      )
    )
$function$;
