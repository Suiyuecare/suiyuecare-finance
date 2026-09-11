-- Read-only AR reconciliation. Existing invoice visibility and mutation RPCs
-- remain unchanged; complete ledger totals require complete reporting scope.
set local lock_timeout='5s';
set local statement_timeout='60s';

create function private.finance_ar_reconciliation_scope_v1(p_tenant uuid,p_environment text,p_as_of date,p_entity text,p_department text)
returns boolean language plpgsql stable security definer set search_path='' as $f$
declare a public.finance_users%rowtype; e text; dimensions record; found_company boolean:=false;
begin
 a:=private.finance_correction_actor_v1();
 if a.tenant_id is distinct from p_tenant or p_environment not in ('production','test') or p_as_of is null
  or coalesce(public.current_finance_role(),'') not in ('accountant','ceo','admin_director','external_audit','board') then return false;end if;
 -- Include the configured empty companies: no rows is not proof of authority.
 for e in
  select p_entity where nullif(p_entity,'all') is not null
  union
  select item->>'id' from public.system_settings s cross join lateral jsonb_array_elements(case when jsonb_typeof(s.value)='array' then s.value else '[]'::jsonb end) item
   where s.tenant_id=p_tenant and s.key='entities' and (p_entity is null or p_entity='all')
  union
  select l.entity_id from public.ledger_entries l where l.tenant_id=p_tenant and l.data_environment=p_environment and l.voided_at is null and l.entry_date<=p_as_of and l.account_code='1123'
   and (p_entity is null or p_entity='all' or l.entity_id=p_entity) and (p_department is null or l.department_code=p_department)
 loop
  if nullif(btrim(e),'') is null then return false;end if;
  begin perform private.finance_reporting_actor_v1(e,p_environment);
  exception when insufficient_privilege then return false;end;
  found_company:=true;
 end loop;
 if not found_company then return false;end if;
 if exists(select 1 from public.invoices i where i.tenant_id=p_tenant and i.data_environment=p_environment
  and (p_entity is null or p_entity='all' or i.entity_id=p_entity) and (p_department is null or i.department_code=p_department)
  and public.can_read_invoice(i) is distinct from true) then return false;end if;
 -- A company grant may still carry department restrictions. Check the exact
 -- ledger dimensions before exposing totals for unlinked invoice sources.
 for dimensions in select distinct l.entity_id,l.department_code from public.ledger_entries l
  where l.tenant_id=p_tenant and l.data_environment=p_environment and l.voided_at is null and l.entry_date<=p_as_of and l.account_code='1123'
   and (p_entity is null or p_entity='all' or l.entity_id=p_entity) and (p_department is null or l.department_code=p_department)
 loop
  if private.finance_expense_optional_permission_allows(p_tenant,a.id,'finance.request.view.all',jsonb_build_object(
    'entity_id',dimensions.entity_id,'entityId',dimensions.entity_id,'legal_entity_code',dimensions.entity_id,
    'department_code',dimensions.department_code,'departmentCode',dimensions.department_code,'data_environment',p_environment)) is distinct from true then return false;end if;
 end loop;
 return true;
end;
$f$;

create function private.finance_ar_reconciliation_v1(p_tenant uuid,p_environment text,p_as_of date,p_entity text,p_department text,p_items jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $f$
declare v_mapped numeric;v_net numeric;v_debit numeric;v_credit numeric;v_count bigint;v_difference numeric;
begin
 select coalesce(sum((x->>'outstandingAmount')::numeric),0) into v_mapped from jsonb_array_elements(p_items) x;
 if not private.finance_ar_reconciliation_scope_v1(p_tenant,p_environment,p_as_of,p_entity,p_department) then
  return jsonb_build_object('reconciliationVisible',false,'reconciliationStatus','scope_unverified','mappedLedgerNet',v_mapped,
   'ledgerNet',null,'unmappedLedgerNet',null,'unmappedDebitAmount',null,'unmappedCreditAmount',null,'unmappedEntryCount',null,'scopeDifference',null,'needsReview',null);
 end if;
 select coalesce(sum(l.debit-l.credit),0),
  coalesce(sum(l.debit) filter(where l.invoice_id is null or not exists(select 1 from jsonb_array_elements(p_items) x where x->>'invoiceId'=l.invoice_id)),0),
  coalesce(sum(l.credit) filter(where l.invoice_id is null or not exists(select 1 from jsonb_array_elements(p_items) x where x->>'invoiceId'=l.invoice_id)),0),
  count(*) filter(where (l.debit<>0 or l.credit<>0) and (l.invoice_id is null or not exists(select 1 from jsonb_array_elements(p_items) x where x->>'invoiceId'=l.invoice_id)))
 into v_net,v_debit,v_credit,v_count from private.finance_ar_ledger_v1(p_tenant,p_environment,p_as_of) l
 where (p_entity is null or p_entity='all' or l.entity_id=p_entity) and (p_department is null or l.department_code=p_department);
 v_difference:=v_net-v_mapped-(v_debit-v_credit);
 return jsonb_build_object('reconciliationVisible',true,'reconciliationStatus','complete','mappedLedgerNet',v_mapped,'ledgerNet',v_net,
  'unmappedLedgerNet',v_debit-v_credit,'unmappedDebitAmount',v_debit,'unmappedCreditAmount',v_credit,'unmappedEntryCount',v_count,
  'scopeDifference',v_difference,'needsReview',v_count>0 or v_difference<>0);
end;
$f$;

alter function private.finance_ar_reconciliation_scope_v1(uuid,text,date,text,text) owner to postgres;
alter function private.finance_ar_reconciliation_v1(uuid,text,date,text,text,jsonb) owner to postgres;
revoke all on function private.finance_ar_reconciliation_scope_v1(uuid,text,date,text,text),private.finance_ar_reconciliation_v1(uuid,text,date,text,text,jsonb) from public,anon,authenticated,service_role;

create or replace function private.finance_receivables_payload_v1(p_as_of date,p_entity_id text,p_department_code text,p_data_environment text,p_dashboard boolean default false)
returns jsonb language plpgsql stable security definer set search_path='' as $f$
declare a public.finance_users%rowtype;v_items jsonb;v_summary jsonb;v_buckets jsonb;v_ledger jsonb;v_ledger_map jsonb;v_financial boolean;
begin
 a:=private.finance_correction_actor_v1();
 if p_as_of is null or p_data_environment is null or p_data_environment not in ('production','test') then raise exception '請指定有效截止日期與資料環境' using errcode='22023';end if;
 v_financial:=coalesce(public.current_finance_role() in ('accountant','ceo','admin_director','external_audit','board'),false);
 if p_dashboard and not v_financial then raise exception '無權讀取財務儀表板' using errcode='42501';end if;
 select coalesce(jsonb_agg(to_jsonb(l)),'[]') into v_ledger from private.finance_ar_ledger_v1(a.tenant_id,p_data_environment,p_as_of) l;
 select coalesce(jsonb_object_agg(invoice_id,rows),'{}') into v_ledger_map from (select l->>'invoice_id' invoice_id,jsonb_agg(l) rows from jsonb_array_elements(v_ledger) l where l->>'invoice_id' is not null group by l->>'invoice_id') groups;
 select coalesce(jsonb_agg(private.finance_ar_invoice_v1(i,p_as_of,coalesce(v_ledger_map->i.id,'[]')) order by i.invoice_date,i.no,i.id),'[]') into v_items
 from public.invoices i where i.tenant_id=a.tenant_id and i.data_environment=p_data_environment
  and (p_entity_id is null or p_entity_id='all' or i.entity_id=p_entity_id)
  and (p_department_code is null or i.department_code=p_department_code)
  and (i.invoice_date is null or i.invoice_date<=p_as_of or exists(select 1 from jsonb_array_elements(v_ledger) l where l->>'invoice_id'=i.id)) and (p_dashboard or public.can_read_invoice(i));
 select jsonb_build_object('originalAmount',coalesce(sum((x->>'originalAmount')::numeric),0),'recognizedAmount',coalesce(sum((x->>'recognizedAmount')::numeric),0),
 'allowanceAmount',coalesce(sum((x->>'allowanceAmount')::numeric),0),'arAllowanceAmount',coalesce(sum((x->>'arAllowanceAmount')::numeric),0),'receivedAmount',coalesce(sum((x->>'receivedAmount')::numeric),0),
 'outstandingAmount',coalesce(sum(greatest(0,(x->>'outstandingAmount')::numeric)),0),'creditAmount',coalesce(sum(greatest(0,-(x->>'outstandingAmount')::numeric)),0),
 'unrecognizedAmount',coalesce(sum((x->>'unrecognizedAmount')::numeric),0),'pendingReceiptAmount',coalesce(sum((x->>'pendingReceiptAmount')::numeric),0),
 'refundPayable',coalesce(sum((x->>'refundPayable')::numeric),0),'refundedAmount',coalesce(sum((x->>'refundedAmount')::numeric),0),
 'overdueAmount',coalesce(sum(greatest(0,(x->>'outstandingAmount')::numeric)) filter(where (x->>'overdueDays')::int>0),0),
 'over90Amount',coalesce(sum(greatest(0,(x->>'outstandingAmount')::numeric)) filter(where (x->>'overdueDays')::int>90),0),
 'unknownDueAmount',coalesce(sum(greatest(0,(x->>'outstandingAmount')::numeric)) filter(where x->>'agingBucket'='unknown'),0))
 into v_summary from jsonb_array_elements(v_items) x;
 select jsonb_agg(jsonb_build_object('key',k,'label',label,'count',(select count(*) from jsonb_array_elements(v_items) x where x->>'agingBucket'=k),
 'total',(select coalesce(sum((x->>'outstandingAmount')::numeric),0) from jsonb_array_elements(v_items) x where x->>'agingBucket'=k)) order by ord)
 into v_buckets from (values(0,'unknown','到期日待確認'),(1,'not_due','未到期'),(2,'d1','逾期 1-30 天'),(3,'d31','逾期 31-60 天'),(4,'d61','逾期 61-90 天'),(5,'d90','逾期 90 天以上')) b(ord,k,label);
 return jsonb_build_object('version',1,'asOf',p_as_of,'complete',true,'totalCount',jsonb_array_length(v_items),'items',v_items,'summary',v_summary,'buckets',v_buckets,
 'reconciliation',private.finance_ar_reconciliation_v1(a.tenant_id,p_data_environment,p_as_of,p_entity_id,p_department_code,v_items)||private.finance_ar_bank_reconciliation_v1(a.tenant_id,p_data_environment,p_as_of,p_entity_id));
end;
$f$;


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
