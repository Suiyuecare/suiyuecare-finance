\set ON_ERROR_STOP on
-- No employee identity or synthetic financial write: catalog assertions only.
do $contractor_postflight$ declare f record;r text;begin
 if not exists(select 1 from pg_constraint where conrelid='finance_hr_private.finance_hr_obligations'::regclass and conname='finance_hr_obligations_kind_check' and position('contractor' in pg_get_constraintdef(oid))>0) then raise exception 'Native contractor kind missing';end if;
 select * into f from pg_proc where oid='finance_hr_private.finance_hr_intake(uuid,jsonb)'::regprocedure;
 if md5(f.prosrc)<>'10ac04b3e8a6b0d48ce06cdc75333ade' or f.prosecdef is distinct from true or f.proconfig is distinct from array['search_path=""']::text[] then raise exception 'Native contractor intake seal differs';end if;
 foreach r in array array['anon','authenticated'] loop
  if has_function_privilege(r,'public.finance_hr_intake(uuid,jsonb)','execute') or has_function_privilege(r,f.oid,'execute') then raise exception 'Native contractor intake grants client authority';end if;
  if has_table_privilege(r,'finance_hr_private.finance_hr_obligations','SELECT,INSERT,UPDATE,DELETE') then raise exception 'Native contractor private source exposed';end if;
 end loop;
 if not has_function_privilege('service_role','public.finance_hr_intake(uuid,jsonb)','execute') then raise exception 'Native contractor transport missing';end if;
 if to_regclass('private.finance_payroll_accruals_v1') is not null and (select md5(prosrc) from pg_proc where oid='finance_hr_private.finance_hr_post_voucher(uuid,integer,uuid,date,jsonb,jsonb)'::regprocedure)<>'01682ebe60f7774a0874404a4c13af18' then raise exception 'Native contractor posting lost accrued-payable guard';end if;
end $contractor_postflight$;
