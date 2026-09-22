-- Compute only the existing row-independent, verified accounting read authority
-- once in each canonical reader. Ordinary users retain can_read_invoice exactly.
-- Company reporting, department, bank, tenant and environment checks are intact.
-- No monetary formula, writer, identity helper, policy, grant or business row changes.
set local lock_timeout='5s';
set local statement_timeout='60s';

do $ar_verified_accounting_baseline$
declare expected record;proc record;
begin
 for expected in select * from (values
  ('public.can_read_invoice(public.invoices)','d761ec0bbd1544410ae52bd860ec78b6',false,'search_path=""'),
  ('public.current_finance_role()','21dee4f613511ba49f259a8371005e9d',false,'search_path=public'),
  ('public.current_finance_user()','5fc4f077185c7e351c730378e4d0eca4',true,'search_path=""'),
  ('public.current_finance_user_id()','14764ed0aa1758b0d159b8506b0f8c26',false,'search_path=public'),
  ('public.current_tenant_id()','7db91f7dbfb876063cd14610b2c310e4',true,'search_path=""'),
  ('public.finance_current_verified_google_email_v2()','9d9d0c836e527510ca3a76b569c95f82',true,'search_path=""'),
  ('public.finance_verified_google_email(uuid)','cc9904d39d410a933a2a31ccddc91038',true,'search_path=public, auth, pg_temp'),
  ('public.is_finance_accounting()','b615fdf7d194eab2ef2003874db09318',false,'search_path=public'),
  ('private.finance_correction_actor_v1()','e61d45d9aa0e001b0ae212678b0a196a',true,'search_path=""'),
  ('private.finance_receivables_payload_v1(date,text,text,text,boolean)','d9a4cde2bf54f8c447d9a3a22df226c6',true,'search_path=""'),
  ('private.finance_ar_reconciliation_scope_v1(uuid,text,date,text,text)','481d1d0b1ec6a302b2a44f5a22996ea9',true,'search_path=""')
 ) pins(signature,body_md5,is_definer,path_setting) loop
  select * into proc from pg_proc where oid=to_regprocedure(expected.signature);
  if proc.oid is null or md5(proc.prosrc)<>expected.body_md5 or proc.provolatile<>'s'
   or proc.prosecdef is distinct from expected.is_definer
   or proc.proconfig is distinct from array[expected.path_setting]::text[]
   or pg_get_userbyid(proc.proowner)<>'postgres' then
   raise exception 'AR reader identity/helper source or authority differs: %',expected.signature;
  end if;
  if expected.signature like 'private.%' and (
   has_function_privilege('anon',proc.oid,'EXECUTE') or has_function_privilege('authenticated',proc.oid,'EXECUTE')
   or has_function_privilege('service_role',proc.oid,'EXECUTE')
   or exists(select 1 from aclexplode(coalesce(proc.proacl,acldefault('f',proc.proowner))) acl where acl.grantee=0 and acl.privilege_type='EXECUTE')) then
   raise exception 'AR private reader is exposed: %',expected.signature;
  end if;
 end loop;
end;
$ar_verified_accounting_baseline$;

create or replace function private.finance_ar_reconciliation_scope_v1(p_tenant uuid,p_environment text,p_as_of date,p_entity text,p_department text)
returns boolean language plpgsql stable security definer set search_path='' as $f$
declare a public.finance_users%rowtype; e text; dimensions record; found_company boolean:=false;v_invoice_accounting boolean;
begin
 a:=private.finance_correction_actor_v1();
 if a.tenant_id is distinct from p_tenant or p_environment not in ('production','test') or p_as_of is null
  or coalesce(public.current_finance_role(),'') not in ('accountant','ceo','admin_director','external_audit','board') then return false;end if;
 v_invoice_accounting:=coalesce(nullif(public.current_finance_user_id(),'') is not null
  and nullif(public.finance_current_verified_google_email_v2(),'') is not null
  and a.tenant_id=public.current_tenant_id() and public.is_finance_accounting(),false);
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
  and (case when v_invoice_accounting then true else public.can_read_invoice(i) end) is distinct from true) then return false;end if;
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

create or replace function private.finance_receivables_payload_v1(p_as_of date,p_entity_id text,p_department_code text,p_data_environment text,p_dashboard boolean default false)
returns jsonb language plpgsql stable security definer set search_path='' as $f$
declare a public.finance_users%rowtype;v_items jsonb;v_summary jsonb;v_buckets jsonb;v_ledger jsonb;v_ledger_map jsonb;v_financial boolean;v_invoice_accounting boolean;
begin
 a:=private.finance_correction_actor_v1();
 if p_as_of is null or p_data_environment is null or p_data_environment not in ('production','test') then raise exception '請指定有效截止日期與資料環境' using errcode='22023';end if;
 v_financial:=coalesce(public.current_finance_role() in ('accountant','ceo','admin_director','external_audit','board'),false);
 if p_dashboard and not v_financial then raise exception '無權讀取財務儀表板' using errcode='42501';end if;
 v_invoice_accounting:=coalesce(nullif(public.current_finance_user_id(),'') is not null
  and nullif(public.finance_current_verified_google_email_v2(),'') is not null
  and a.tenant_id=public.current_tenant_id() and public.is_finance_accounting(),false);
 select coalesce(jsonb_agg(to_jsonb(l)),'[]') into v_ledger from private.finance_ar_ledger_v1(a.tenant_id,p_data_environment,p_as_of) l;
 select coalesce(jsonb_object_agg(invoice_id,rows),'{}') into v_ledger_map from (select l->>'invoice_id' invoice_id,jsonb_agg(l) rows from jsonb_array_elements(v_ledger) l where l->>'invoice_id' is not null group by l->>'invoice_id') groups;
 select coalesce(jsonb_agg(private.finance_ar_invoice_v1(i,p_as_of,coalesce(v_ledger_map->i.id,'[]')) order by i.invoice_date,i.no,i.id),'[]') into v_items
 from public.invoices i where i.tenant_id=a.tenant_id and i.data_environment=p_data_environment
  and (p_entity_id is null or p_entity_id='all' or i.entity_id=p_entity_id)
  and (p_department_code is null or i.department_code=p_department_code)
  and (i.invoice_date is null or i.invoice_date<=p_as_of or exists(select 1 from jsonb_array_elements(v_ledger) l where l->>'invoice_id'=i.id)) and (p_dashboard or case when v_invoice_accounting then true else public.can_read_invoice(i) end);
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

do $ar_verified_accounting_installed$
declare expected record;proc record;
begin
 for expected in select * from (values
  ('public.can_read_invoice(public.invoices)','d761ec0bbd1544410ae52bd860ec78b6',false,'search_path=""'),
  ('public.current_finance_role()','21dee4f613511ba49f259a8371005e9d',false,'search_path=public'),
  ('public.current_finance_user()','5fc4f077185c7e351c730378e4d0eca4',true,'search_path=""'),
  ('public.current_finance_user_id()','14764ed0aa1758b0d159b8506b0f8c26',false,'search_path=public'),
  ('public.current_tenant_id()','7db91f7dbfb876063cd14610b2c310e4',true,'search_path=""'),
  ('public.finance_current_verified_google_email_v2()','9d9d0c836e527510ca3a76b569c95f82',true,'search_path=""'),
  ('public.finance_verified_google_email(uuid)','cc9904d39d410a933a2a31ccddc91038',true,'search_path=public, auth, pg_temp'),
  ('public.is_finance_accounting()','b615fdf7d194eab2ef2003874db09318',false,'search_path=public'),
  ('private.finance_correction_actor_v1()','e61d45d9aa0e001b0ae212678b0a196a',true,'search_path=""'),
  ('private.finance_receivables_payload_v1(date,text,text,text,boolean)','710c8fa2ca2736f58c13847be1861b6b',true,'search_path=""'),
  ('private.finance_ar_reconciliation_scope_v1(uuid,text,date,text,text)','edaf8ff23d45c773419606e543e4632e',true,'search_path=""')
 ) pins(signature,body_md5,is_definer,path_setting) loop
  select * into proc from pg_proc where oid=to_regprocedure(expected.signature);
  if proc.oid is null or md5(proc.prosrc)<>expected.body_md5 or proc.provolatile<>'s'
   or proc.prosecdef is distinct from expected.is_definer
   or proc.proconfig is distinct from array[expected.path_setting]::text[]
   or pg_get_userbyid(proc.proowner)<>'postgres' then
   raise exception 'AR reader identity/helper source or authority differs: %',expected.signature;
  end if;
  if expected.signature like 'private.%' and (
   has_function_privilege('anon',proc.oid,'EXECUTE') or has_function_privilege('authenticated',proc.oid,'EXECUTE')
   or has_function_privilege('service_role',proc.oid,'EXECUTE')
   or exists(select 1 from aclexplode(coalesce(proc.proacl,acldefault('f',proc.proowner))) acl where acl.grantee=0 and acl.privilege_type='EXECUTE')) then
   raise exception 'AR private reader is exposed: %',expected.signature;
  end if;
 end loop;
end;
$ar_verified_accounting_installed$;
do $ar_verified_accounting_public_boundary$
declare p record;denied boolean:=false;
begin
 select * into p from pg_proc where oid=to_regprocedure('public.finance_receivables_v1(date,text,text,text)');
 if p.oid is null or md5(p.prosrc)<>'3919420d06b2c7818615f757fa759195'
  or not p.prosecdef or p.provolatile<>'s' or pg_get_userbyid(p.proowner)<>'postgres'
  or p.proconfig is distinct from array['search_path=""']::text[]
  or has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('service_role',p.oid,'EXECUTE')
  or not has_function_privilege('authenticated',p.oid,'EXECUTE')
  or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl where acl.grantee=0 and acl.privilege_type='EXECUTE') then
  raise exception 'AR public read boundary differs';
 end if;
 if auth.uid() is null then
  begin perform public.finance_receivables_v1(current_date,null,null,'production');
  exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'AR read accepted absent verified identity';end if;
 end if;
end;
$ar_verified_accounting_public_boundary$;

notify pgrst, 'reload schema';
