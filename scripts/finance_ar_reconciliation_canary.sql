-- Rollback-only synthetic journals. Authenticated operations are read-only.
begin isolation level repeatable read;
set local lock_timeout='5s';
set local statement_timeout='120s';
-- FINANCE_AUTHENTICATED_CANARY_CORE_BEGIN
do $ar_reconciliation_canary$
declare
 t constant uuid:='00000000-0000-0000-0000-000000000001';prefix constant text:='__finance_ar_reconcile_canary_20260911__';
 a public.finance_users%rowtype;employee public.finance_users%rowtype;b jsonb;r jsonb;production_before jsonb;production_after jsonb;
 d date:=(statement_timestamp() at time zone 'Asia/Taipei')::date;
 old_claims text:=current_setting('request.jwt.claims',true);old_sub text:=current_setting('request.jwt.claim.sub',true);old_tenant text:=current_setting('app.current_tenant_id',true);
begin
 if exists(select 1 from public.invoices where left(id,length(prefix))=prefix or left(no,length(prefix))=prefix)
  or exists(select 1 from public.ledger_entries where left(coalesce(source_id,''),length(prefix))=prefix or left(coalesce(posting_key,''),length(prefix))=prefix) then raise exception 'AR reconciliation canary identifiers already exist';end if;
 select * into a from public.finance_users u where u.tenant_id=t and u.active and u.role='accountant' and public.finance_user_is_approval_identity_ready(t,u.id) order by u.id limit 1;
 select * into employee from public.finance_users u where u.tenant_id=t and u.active and u.role not in ('accountant','ceo','admin_director','external_audit','board') and public.finance_user_is_approval_identity_ready(t,u.id) order by u.id limit 1;
 if a.id is null or employee.id is null then raise exception 'AR reconciliation canary requires verified accountant and non-financial member';end if;
 perform set_config('app.current_tenant_id',t::text,true);perform set_config('request.jwt.claim.sub',a.auth_user_id::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',a.auth_user_id,'role','authenticated','email',a.email)::text,true);
 execute 'set local role authenticated';
 if current_user<>'authenticated' then raise exception 'AR reconciliation canary must use browser role';end if;
 b:=public.finance_receivables_v1(d,'E6','J1101','test')->'reconciliation';
 production_before:=public.finance_receivables_v1(d,'E6','J1101','production');
 if b->>'reconciliationVisible' is distinct from 'true' then raise exception 'AR reconciliation accountant lacks complete fixture scope';end if;
 execute 'reset role';
 insert into public.invoices(id,no,tenant_id,data_environment,entity_id,entity_name,department_code,invoice_date,buyer,description,amount,tax,total,status,approval_status,approval_step,steps,invoice_identifier_type)
 values(prefix||'invoice',prefix||'invoice',t,'test','E6','Rollback-only fixture','J1101',d,'Synthetic AR reconciliation','Synthetic AR reconciliation',100,0,100,'unpaid','draft',1,'[]','領據');
 insert into public.ledger_entries(tenant_id,data_environment,entry_date,entity_id,department_code,debit,credit,account_code,account_name,reference_no,posting_key,source_type,source_id,source_no)
 select t,'test',d,'E6','J1101',dr,cr,ac,private.finance_tenant_account_name(t,ac),prefix||suffix,prefix||suffix||':'||ac,
  case when suffix='invoice' then 'invoice' else 'adjustment' end,prefix||suffix,prefix||suffix
 from (values('invoice','1123',100::numeric,0::numeric),('invoice','1112',0,100),('unmatched-debit','1123',70,0),('unmatched-debit','1112',0,70),('unmatched-credit','1123',0,70),('unmatched-credit','1112',70,0),('unmatched-same-row','1123',70,70)) x(suffix,ac,dr,cr);
 execute 'set local role authenticated';
 r:=public.finance_receivables_v1(d,'E6','J1101','test')->'reconciliation';
 if r->>'reconciliationVisible' is distinct from 'true' or (r->>'ledgerNet')::numeric<>(b->>'ledgerNet')::numeric+100
  or (r->>'mappedLedgerNet')::numeric<>(b->>'mappedLedgerNet')::numeric+100
  or (r->>'unmappedDebitAmount')::numeric<>(b->>'unmappedDebitAmount')::numeric+140
  or (r->>'unmappedCreditAmount')::numeric<>(b->>'unmappedCreditAmount')::numeric+140
  or (r->>'unmappedEntryCount')::bigint<>(b->>'unmappedEntryCount')::bigint+3
  or r->>'needsReview' is distinct from 'true' then raise exception 'AR reconciliation lost signed unlinked journal evidence';end if;
 production_after:=public.finance_receivables_v1(d,'E6','J1101','production');
 if production_after is distinct from production_before then raise exception 'AR reconciliation test fixture crossed production scope';end if;
 r:=public.finance_receivables_v1(d,prefix||'unauthorized-company',null,'test')->'reconciliation';
 if r->>'reconciliationVisible' is distinct from 'false' or r->'ledgerNet'<>'null'::jsonb or r->'needsReview'<>'null'::jsonb then raise exception 'AR reconciliation exposed unverified company scope';end if;
 execute 'reset role';
 perform set_config('request.jwt.claim.sub',employee.auth_user_id::text,true);perform set_config('request.jwt.claims',jsonb_build_object('sub',employee.auth_user_id,'role','authenticated','email',employee.email)::text,true);
 execute 'set local role authenticated';
 r:=public.finance_receivables_v1(d,'E6','J1101','test')->'reconciliation';
 if r->>'reconciliationVisible' is distinct from 'false' or r->'ledgerNet'<>'null'::jsonb or r->'unmappedDebitAmount'<>'null'::jsonb or r->'unmappedCreditAmount'<>'null'::jsonb or r->'needsReview'<>'null'::jsonb then raise exception 'AR reconciliation exposed complete totals to partial reader';end if;
 execute 'reset role';
 if exists(select 1 from public.notification_delivery_events where left(coalesce(request_id,''),length(prefix))=prefix or left(coalesce(payload->>'source_id',''),length(prefix))=prefix) then raise exception 'AR reconciliation fixture unexpectedly notified';end if;
 perform set_config('request.jwt.claims',coalesce(old_claims,''),true);perform set_config('request.jwt.claim.sub',coalesce(old_sub,''),true);perform set_config('app.current_tenant_id',coalesce(old_tenant,''),true);
end;
$ar_reconciliation_canary$;
-- FINANCE_AUTHENTICATED_CANARY_CORE_END
rollback;
-- FINANCE_AUTHENTICATED_CANARY_ROLLBACK_CHECK_BEGIN
do $ar_reconciliation_rollback$
begin
 if exists(select 1 from public.invoices where left(id,length('__finance_ar_reconcile_canary_20260911__'))='__finance_ar_reconcile_canary_20260911__')
  or exists(select 1 from public.ledger_entries where left(coalesce(source_id,''),length('__finance_ar_reconcile_canary_20260911__'))='__finance_ar_reconcile_canary_20260911__') then raise exception 'AR reconciliation canary rollback left fixtures';end if;
end;
$ar_reconciliation_rollback$;
-- FINANCE_AUTHENTICATED_CANARY_ROLLBACK_CHECK_END
select jsonb_build_object('canary','authenticated_ar_reconciliation_v1','ok',true,'rolled_back',true,'scope_preserved',true) as ar_reconciliation_canary_result;
