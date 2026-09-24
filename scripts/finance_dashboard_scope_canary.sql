-- Read-only release proof: no account creation, employee claims, or source writes.
-- A pinned installed aggregate query is compared with independently scoped totals.
begin isolation level repeatable read read only;
set local lock_timeout='5s';
set local statement_timeout='60s';
-- FINANCE_AUTHENTICATED_CANARY_CORE_BEGIN
do $dashboard_scope_canary$
declare revenue_repair_installed boolean:=false;hr_bridge_installed boolean:=false;ar_scope_installed boolean:=false;p record;v_source text;v_query text;t uuid;env text;company text;result jsonb;expected record;denied boolean;
 d date:=(statement_timestamp() at time zone 'Asia/Taipei')::date;
 first_day date:=date_trunc('month',d)::date;
 previous_day date:=date_trunc('month',d)::date-1;
 previous_first date:=(date_trunc('month',d)-interval '1 month')::date;
begin
 if to_regclass('supabase_migrations.schema_migrations') is not null then
  execute $hr_ledger$select count(*)=3 from supabase_migrations.schema_migrations where version in ('20260922072109','20260922072737','20260922075604')$hr_ledger$ into hr_bridge_installed;
  execute $ar_ledger$select exists(select 1 from supabase_migrations.schema_migrations where version='20260922072737')$ar_ledger$ into ar_scope_installed;
  execute $revenue_ledger$select exists(select 1 from supabase_migrations.schema_migrations where version='20260924074010')$revenue_ledger$ into revenue_repair_installed;
 end if;
 if revenue_repair_installed and not hr_bridge_installed then raise exception 'Revenue repair requires the complete reviewed HR bridge';end if;
 if auth.uid() is not null then raise exception 'Dashboard proof must not assume an employee identity';end if;
 select * into p from pg_proc where oid=to_regprocedure('public.finance_executive_dashboard_v2(date,date,date,date,date,text,text)');
 if p.oid is null or md5(p.prosrc)<>(case when revenue_repair_installed then 'cec3d2e9b694c30e189aca9b1f2431a0' when hr_bridge_installed then '7734154b2b22e212c5dc0774cd4f7a06' else '84043dbdd33bd3e4152f61727e25b202' end) or not p.prosecdef or p.provolatile<>'s'
  or pg_get_userbyid(p.proowner)<>'postgres' or p.proconfig is distinct from array['search_path=""']::text[]
  or has_function_privilege('anon',p.oid,'EXECUTE') or not has_function_privilege('authenticated',p.oid,'EXECUTE')
  or not has_function_privilege('service_role',p.oid,'EXECUTE')
  or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE') then raise exception 'Dashboard read-only proof source/authority mismatch';end if;
 -- Dynamic execution is limited to this exact reviewed SELECT body by the hash
 -- above. No untrusted text or runtime input can add statements or identifiers.
 v_source:=p.prosrc;
 v_query:=substring(v_source from position(E'  with\n  invoice_base as materialized (' in v_source));
 if v_query='' or position(') into v_result;' in v_query)=0 then raise exception 'Dashboard aggregate query anchor missing';end if;
 v_query:=split_part(v_query,') into v_result;',1)||')';
 v_query:=replace(replace(replace(v_query,'v_actor.tenant_id','$1::uuid'),'v_environment','$2::text'),'v_entity','$3::text');
 v_query:=replace(replace(replace(replace(replace(v_query,'p_previous_start','$6::date'),'p_previous_end','$7::date'),'p_trend_start','$8::date'),'p_start','$4::date'),'p_end','$5::date');
 for t in select distinct tenant_id from (
   select tenant_id from public.ledger_entries union select tenant_id from public.invoices union select tenant_id from public.expense_requests
   union select '00000000-0000-0000-0000-000000000001'::uuid
  ) tenants where tenant_id is not null loop
  foreach env in array array['production','test'] loop
   for company in select null::text union select min(entity_id) from public.ledger_entries where tenant_id=t and coalesce(data_environment,'production')=env loop
    execute v_query into result using t,env,company,first_day,d,previous_first,previous_day,previous_first;
    select
     (select count(*) from public.ledger_entries l where l.tenant_id=t and coalesce(l.data_environment,'production')=env and l.voided_at is null and (company is null or l.entity_id=company)) ledger_rows,
     (select count(*) from public.invoices i where i.tenant_id=t and coalesce(i.data_environment,'production')=env and i.voided_at is null and (company is null or i.entity_id=company)) invoice_rows,
     (select count(*) from public.expense_requests r where r.tenant_id=t and coalesce(r.data_environment,'production')=env and r.voided_at is null and (company is null or r.entity_id=company)) expense_rows,
     coalesce(sum(case when left(l.account_code,1) in ('4','7') then l.credit-l.debit else 0 end) filter(where l.entry_date between first_day and d),0) revenue,
     coalesce(sum(case when left(l.account_code,1) in ('5','6','9') then l.debit-l.credit else 0 end) filter(where l.entry_date between first_day and d),0) expense,
     coalesce(sum(case when left(l.account_code,1) in ('4','7') then l.credit-l.debit else 0 end) filter(where l.entry_date between previous_first and previous_day),0) previous_revenue
    into expected from public.ledger_entries l where l.tenant_id=t and coalesce(l.data_environment,'production')=env and l.voided_at is null and (company is null or l.entity_id=company);
    if (result->'rowCounts'->>'ledger_rows')::bigint is distinct from expected.ledger_rows
     or (result->'rowCounts'->>'invoice_rows')::bigint is distinct from expected.invoice_rows
     or (result->'rowCounts'->>'expense_rows')::bigint is distinct from expected.expense_rows
     or (result->'summary'->>'revenue')::numeric is distinct from expected.revenue
     or (result->'summary'->>'expense')::numeric is distinct from expected.expense
     or (result->'previousSummary'->>'revenue')::numeric is distinct from expected.previous_revenue
     or (result->'reconciliation'->'revenue'->>'officialAmount')::numeric is distinct from expected.revenue
     or (result->'reconciliation'->'expense'->>'officialAmount')::numeric is distinct from expected.expense then
      raise exception 'Dashboard aggregate differs from independent tenant/company totals';
    end if;
   end loop;
  end loop;
 end loop;
 execute 'set local role anon';denied:=false;
 begin perform public.finance_executive_dashboard_v2(d,d,d,d,d,null,'test');exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Anonymous dashboard access accepted';end if;
 execute 'reset role';execute 'set local role authenticated';denied:=false;
 begin perform public.finance_executive_dashboard_v2(d,d,d,d,d,null,'test');exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Dashboard accepted absent verified actor';end if;
 execute 'reset role';
end;
$dashboard_scope_canary$;
-- FINANCE_AUTHENTICATED_CANARY_CORE_END
rollback;
-- FINANCE_AUTHENTICATED_CANARY_ROLLBACK_CHECK_BEGIN
do $dashboard_scope_rollback$
begin
 if current_user in ('anon','authenticated') or auth.uid() is not null then raise exception 'Dashboard proof left an employee context';end if;
end;
$dashboard_scope_rollback$;
-- FINANCE_AUTHENTICATED_CANARY_ROLLBACK_CHECK_END
select jsonb_build_object('canary','readonly_dashboard_scope_v1','ok',true,'rolled_back',true,'scope_preserved',true) as dashboard_scope_canary_result;
