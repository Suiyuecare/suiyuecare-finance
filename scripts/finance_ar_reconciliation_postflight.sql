\set ON_ERROR_STOP on
-- Repeatable read-only catalog checks; no synthetic or operational writes.
do $finance_ar_reconciliation_postflight$
declare sig text;p record;denied boolean:=false;
begin
 foreach sig in array array['private.finance_ar_reconciliation_scope_v1(uuid,text,date,text,text)','private.finance_ar_reconciliation_v1(uuid,text,date,text,text,jsonb)'] loop
  select * into p from pg_proc where oid=to_regprocedure(sig);
  if p.oid is null or not p.prosecdef or p.provolatile<>'s' or pg_get_userbyid(p.proowner)<>'postgres' or p.proconfig is distinct from array['search_path=""']::text[]
   or has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('authenticated',p.oid,'EXECUTE') or has_function_privilege('service_role',p.oid,'EXECUTE')
   or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE') then raise exception 'AR reconciliation private authority differs: %',sig;end if;
 end loop;
 select * into p from pg_proc where oid=to_regprocedure('private.finance_ar_reconciliation_scope_v1(uuid,text,date,text,text)');
 if p.prosrc not like '%private.finance_correction_actor_v1()%'
  or p.prosrc not like '%private.finance_reporting_actor_v1(e,p_environment)%'
  or p.prosrc not like '%public.can_read_invoice(i) is distinct from true%'
  or p.prosrc not like '%private.finance_expense_optional_permission_allows(%' then raise exception 'AR reconciliation scope predicates missing';end if;
 select * into p from pg_proc where oid=to_regprocedure('private.finance_ar_reconciliation_v1(uuid,text,date,text,text,jsonb)');
 if p.prosrc not like '%''scope_unverified''%' or p.prosrc not like '%''unmappedDebitAmount''%' or p.prosrc not like '%''unmappedCreditAmount''%'
  or p.prosrc not like '%sum(l.debit) filter%' or p.prosrc not like '%sum(l.credit) filter%' or p.prosrc not like '%(l.debit<>0 or l.credit<>0)%'
  or p.prosrc not like '%''needsReview'',v_count>0 or v_difference<>0%' then raise exception 'AR reconciliation gross difference/null semantics missing';end if;
 select * into p from pg_proc where oid=to_regprocedure('private.finance_receivables_payload_v1(date,text,text,text,boolean)');
 if p.oid is null or not p.prosecdef or p.proconfig is distinct from array['search_path=""']::text[]
  or p.prosrc not like '%private.finance_ar_reconciliation_v1(a.tenant_id,p_data_environment,p_as_of,p_entity_id,p_department_code,v_items)%'
  or p.prosrc not like '%(p_dashboard or public.can_read_invoice(i))%' then raise exception 'Canonical AR reconciliation integration differs';end if;
 if auth.uid() is null then
  begin perform public.finance_receivables_v1(current_date,null,null,'test');exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'AR reconciliation accepted absent identity';end if;
 end if;
end;
$finance_ar_reconciliation_postflight$;
