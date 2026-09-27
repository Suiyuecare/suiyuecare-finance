-- Contractor gross, withholding and supplementary contributions: preserve reviewed accounting authority, period locks, and the
-- separately installed payroll-accrual no-double-expense guard verbatim.
set local lock_timeout='5s';
set local statement_timeout='120s';
do $caption$ declare definition text;bodyhash text;needle text:=E'case when o.kind=''bonus'' then '' 獎金'' else '' 薪資'' end';begin
 select md5(prosrc) into bodyhash from pg_proc where oid='finance_hr_private.finance_hr_post_voucher(uuid,integer,uuid,date,jsonb,jsonb)'::regprocedure;
 if bodyhash is null or bodyhash not in ('574bf7be65ce8c6684c4458359152fbd','9456cbe480d95c56bd665d589fbaf6da') then raise exception 'FINANCE_HR_CONTRACTOR_REQUIRES_REVIEWED_POSTING';end if;
 definition:=pg_get_functiondef('finance_hr_private.finance_hr_post_voucher(uuid,integer,uuid,date,jsonb,jsonb)'::regprocedure);
 if position(needle in definition)=0 then raise exception 'FINANCE_HR_CONTRACTOR_CAPTION_ANCHOR_MISSING';end if;
 definition:=replace(definition,needle,E'case o.kind when ''bonus'' then '' 獎金'' when ''contractor'' then '' 外聘服務費'' else '' 薪資'' end');
 -- Preserve salary/bonus entries and their accrual clearance guard. Contractor
 -- account purposes are explicitly selected by the authorized final accountant;
 -- all codes still resolve from this tenant's active chart, never defaulted.
 definition:=replace(definition,
  E'array[''t'',''ac'',''amt'']',
  E'(case when o.kind=''contractor'' then array[''t'',''ac'',''amt'',''purpose''] else array[''t'',''ac'',''amt''] end)');
 definition:=replace(definition,
  E'''dept'','''',''amt'',amount)',
  E'''dept'','''',''amt'',amount)||(case when o.kind=''contractor'' then jsonb_build_object(''purpose'',entry->>''purpose'') else ''{}''::jsonb end)');
 if position(E' if dr<>cr or dr<>o.total_net_cents/100.0 then' in definition)=0 then raise exception 'FINANCE_HR_CONTRACTOR_GROSS_ANCHOR_MISSING';end if;
 definition:=replace(definition,
  E' if dr<>cr or dr<>o.total_net_cents/100.0 then raise exception ''FINANCE_HR_ENTRIES_UNBALANCED_OR_AMOUNT_MISMATCH'';end if;',
  $gross_guard$
 if o.kind='contractor' then
  if exists(select 1 from jsonb_array_elements(p_entries) x where coalesce(x->>'purpose','') not in('expense','net','withholding','supplementary') or (x->>'t'='dr') is distinct from (x->>'purpose'='expense'))
   or dr<>cr or dr is distinct from (select sum((x->>'grossCents')::numeric)/100 from jsonb_array_elements(o.source_snapshot->'recipients') x)
   or (select coalesce(sum((x->>'amt')::numeric),0) from jsonb_array_elements(p_entries) x where x->>'purpose'='net') is distinct from o.total_net_cents/100.0
   or (select coalesce(sum((x->>'amt')::numeric),0) from jsonb_array_elements(p_entries) x where x->>'purpose'='withholding') is distinct from (select sum((x->>'withholdingCents')::numeric)/100 from jsonb_array_elements(o.source_snapshot->'recipients') x)
   or (select coalesce(sum((x->>'amt')::numeric),0) from jsonb_array_elements(p_entries) x where x->>'purpose'='supplementary') is distinct from (select sum((x->>'supplementaryCents')::numeric)/100 from jsonb_array_elements(o.source_snapshot->'recipients') x)
  then raise exception 'FINANCE_HR_CONTRACTOR_GROSS_TAX_NET_REQUIRED' using errcode='23514';end if;
 else
  if dr<>cr or dr<>o.total_net_cents/100.0 then raise exception 'FINANCE_HR_ENTRIES_UNBALANCED_OR_AMOUNT_MISMATCH';end if;
 end if;
 $gross_guard$);
 execute definition;
end $caption$;
notify pgrst,'reload schema';
-- Contractor obligations must not enter the salary-specific gross accrual
-- engine; its monthly/bonus source guard has no contractor tax accounting rule.
do $salary_scope$ declare definition text;needle text:=E'  or o.obligation_id is null or o.tenant_id is distinct from a.tenant_id';begin
 if to_regprocedure('private.finance_payroll_actor_v1(uuid,boolean)') is not null then
  if (select md5(prosrc) from pg_proc where oid='private.finance_payroll_actor_v1(uuid,boolean)'::regprocedure)<>'ec87b7b049655fd858da8b71998e1f37' then raise exception 'FINANCE_HR_CONTRACTOR_REQUIRES_REVIEWED_ACCRUAL_ACTOR';end if;
  definition:=pg_get_functiondef('private.finance_payroll_actor_v1(uuid,boolean)'::regprocedure);
  if position(needle in definition)=0 then raise exception 'FINANCE_HR_CONTRACTOR_ACCRUAL_SCOPE_ANCHOR_MISSING';end if;
  definition:=replace(definition,needle,needle||E'\n  or coalesce(o.kind,'''') not in(''monthly'',''bonus'')');
  execute definition;
 end if;
end $salary_scope$;
-- Final callback accepts only the atomically created journal. Contractor's
-- immutable gross journal total differs from its bank payment net amount.
do $contractor_close$ declare definition text;needle text:='and total=o.total_net_cents/100.0 for key share';begin
 if (select md5(prosrc) from pg_proc where oid='finance_hr_private.finance_hr_command(uuid,integer,uuid,text,jsonb)'::regprocedure)<>'a9c61777902878da2d20dffbdbcb031c' then raise exception 'FINANCE_HR_CONTRACTOR_REQUIRES_REVIEWED_COMMAND';end if;
 definition:=pg_get_functiondef('finance_hr_private.finance_hr_command(uuid,integer,uuid,text,jsonb)'::regprocedure);
 if position(needle in definition)=0 then raise exception 'FINANCE_HR_CONTRACTOR_CLOSE_ANCHOR_MISSING';end if;
 definition:=replace(definition,needle,'and total=(case when o.kind=''contractor'' then (select sum((contractor_rec.value->>''grossCents'')::numeric)/100 from jsonb_array_elements(o.source_snapshot->''recipients'') contractor_rec(value)) else o.total_net_cents/100.0 end) for key share');
 execute definition;
end $contractor_close$;
notify pgrst,'reload schema';
