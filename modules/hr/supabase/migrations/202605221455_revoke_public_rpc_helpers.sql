-- Lock down helper RPC functions after live schema sync.
-- These helpers are used by RLS policies and must not be callable by anon/public.

revoke execute on function public.current_employee_id() from public, anon;
revoke execute on function public.current_role_key() from public, anon;
revoke execute on function public.can_manage_payroll() from public, anon;
revoke execute on function public.can_manage_licenses() from public, anon;
revoke execute on function public.can_manage_training() from public, anon;
revoke execute on function public.can_manage_assessment_exports() from public, anon;
revoke execute on function public.can_manage_retention() from public, anon;
revoke execute on function public.can_manage_announcements() from public, anon;
revoke execute on function public.can_view_analytics() from public, anon;
revoke execute on function public.can_manage_excel_imports() from public, anon;
revoke execute on function public.can_manage_system_settings() from public, anon;
revoke execute on function public.can_manage_employee_data() from public, anon;
revoke execute on function public.can_view_security_logs() from public, anon;
revoke execute on function public.initialize_payslip_password(uuid, text) from public, anon;
revoke execute on function public.verify_payslip_password(uuid, text) from public, anon;
revoke execute on function public.set_payslip_password(uuid, text, text) from public, anon;

grant execute on function public.current_employee_id() to authenticated;
grant execute on function public.current_role_key() to authenticated;
grant execute on function public.can_manage_payroll() to authenticated;
grant execute on function public.can_manage_licenses() to authenticated;
grant execute on function public.can_manage_training() to authenticated;
grant execute on function public.can_manage_assessment_exports() to authenticated;
grant execute on function public.can_manage_retention() to authenticated;
grant execute on function public.can_manage_announcements() to authenticated;
grant execute on function public.can_view_analytics() to authenticated;
grant execute on function public.can_manage_excel_imports() to authenticated;
grant execute on function public.can_manage_system_settings() to authenticated;
grant execute on function public.can_manage_employee_data() to authenticated;
grant execute on function public.can_view_security_logs() to authenticated;
grant execute on function public.initialize_payslip_password(uuid, text) to authenticated;
grant execute on function public.verify_payslip_password(uuid, text) to authenticated;
grant execute on function public.set_payslip_password(uuid, text, text) to authenticated;
