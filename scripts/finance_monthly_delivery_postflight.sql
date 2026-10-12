-- Read-only release postflight; no employee impersonation or data mutation.
select jsonb_build_object(
 'snapshot_exists',to_regprocedure('public.finance_monthly_delivery_snapshot_v1(text,text,text)') is not null,
 'receipt_exists',to_regprocedure('public.finance_monthly_delivery_receipt_v1(text,text,uuid,text,text,text)') is not null,
 'snapshot_security_definer',(select prosecdef from pg_proc where oid=to_regprocedure('public.finance_monthly_delivery_snapshot_v1(text,text,text)')),
 'snapshot_anon_denied',not has_function_privilege('anon','public.finance_monthly_delivery_snapshot_v1(text,text,text)','execute'),
 'receipt_anon_denied',not has_function_privilege('anon','public.finance_monthly_delivery_receipt_v1(text,text,uuid,text,text,text)','execute'),
 'receipt_table_no_select',not has_table_privilege('authenticated','private.finance_monthly_delivery_receipts_v1','select'),
 'receipt_table_no_write',not has_table_privilege('authenticated','private.finance_monthly_delivery_receipts_v1','insert,update,delete'),
 'receipt_table_force_rls',(select relrowsecurity and relforcerowsecurity from pg_class where oid='private.finance_monthly_delivery_receipts_v1'::regclass),
 'private_labor_requirements_denied',not has_function_privilege('authenticated','private.finance_monthly_labor_requirements_v1(text,text,text)','execute')
) as monthly_delivery_contract;
