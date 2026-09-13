-- Preserve the canonical AR mapping contract while replacing repeated OR/LATERAL
-- invoice scans with one scoped candidate set. No journal or invoice is changed.
set local lock_timeout='5s';
set local statement_timeout='60s';

do $ar_mapping_preflight$
declare p record;
begin
 select * into p from pg_proc where oid=to_regprocedure('private.finance_ar_ledger_v1(uuid,text,date,text)');
 if p.oid is null or md5(p.prosrc)<>'335b602173ee9eefc0f3b3de84019c8d'
  or not p.prosecdef or p.provolatile<>'s' or pg_get_userbyid(p.proowner)<>'postgres'
  or p.proconfig is distinct from array['search_path=""']::text[]
  or has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('authenticated',p.oid,'EXECUTE')
  or has_function_privilege('service_role',p.oid,'EXECUTE')
  or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE') then
  raise exception 'Canonical AR mapper predecessor or authority differs';
 end if;
 if not exists(select 1 from pg_constraint c join pg_attribute a on a.attrelid=c.conrelid and a.attnum=c.conkey[1]
  where c.conrelid='public.ledger_entries'::regclass and c.contype='p' and cardinality(c.conkey)=1 and a.attname='id') then
  raise exception 'Canonical AR mapping requires the existing ledger id primary key';
 end if;
end;
$ar_mapping_preflight$;

create or replace function private.finance_ar_ledger_v1(p_tenant uuid,p_environment text,p_as_of date,p_invoice_id text default null)
returns table(invoice_id text,entity_id text,department_code text,entry_date date,debit numeric,credit numeric,category text,source_ref text)
language sql stable security definer set search_path='' as $f$
 with ledger as materialized (
  select l.id,l.entity_id,l.department_code,l.entry_date,l.debit,l.credit,l.posting_key,
   l.reference_no,l.source_no,l.source_id,l.source_type,l.voucher_no
  from public.ledger_entries l
  where l.tenant_id=p_tenant and l.data_environment=p_environment and l.voided_at is null
   and l.account_code='1123' and l.entry_date<=p_as_of
 ), all_invoices as materialized (
  select i.id,i.no,i.entity_id from public.invoices i
  where i.tenant_id=p_tenant and i.data_environment=p_environment
 ), invoices as materialized (
  select i.* from all_invoices i where p_invoice_id is null or i.id=p_invoice_id
 ), events as materialized (
  select e.id,e.event_no,i.id invoice_id,i.entity_id
  from public.invoice_lifecycle_events e join invoices i on i.id=e.invoice_id
  where e.tenant_id=p_tenant and e.data_environment=p_environment
 ), legacy_ledger as materialized (
  select l.* from ledger l
  where (coalesce(l.source_type,'') in ('invoice','invoice_reversal','') and nullif(l.source_id,'') is null)
   or (coalesce(l.source_type,'') in ('invoice','invoice_reversal')
    and not exists(select 1 from all_invoices other_i where other_i.id=l.source_id))
 ), candidates as (
  select l.id ledger_id,i.id invoice_id,false lifecycle
  from ledger l join invoices i on i.id=l.source_id and i.entity_id is not distinct from l.entity_id
  where l.source_type in ('invoice','invoice_reversal')
  union all
  select l.id,i.id,false from legacy_ledger l join invoices i on i.no=l.source_no and i.entity_id is not distinct from l.entity_id
  union all
  select l.id,i.id,false from legacy_ledger l join invoices i on i.no=l.reference_no and i.entity_id is not distinct from l.entity_id
  union all
  select l.id,e.invoice_id,true from ledger l join events e on e.id=l.source_id and e.entity_id is not distinct from l.entity_id
  union all
  select l.id,e.invoice_id,true from ledger l join events e on e.event_no=l.source_no and e.entity_id is not distinct from l.entity_id
  union all
  select l.id,e.invoice_id,true from ledger l join events e on e.event_no=l.reference_no and e.entity_id is not distinct from l.entity_id
 ), matches as (
  select c.ledger_id,count(distinct c.invoice_id) n,min(c.invoice_id) invoice_id,bool_or(c.lifecycle) lifecycle
  from candidates c group by c.ledger_id
 )
 select case when x.n=1 then x.invoice_id end,l.entity_id,l.department_code,l.entry_date,
  coalesce(l.debit,0),coalesce(l.credit,0),
  case when x.lifecycle then 'allowance' when coalesce(l.posting_key,'') like '%:receipt:%' then 'receipt' else 'recognition' end,
  coalesce(nullif(l.reference_no,''),nullif(l.source_no,''),nullif(l.source_id,''),l.voucher_no)
 from ledger l left join matches x on x.ledger_id=l.id;
$f$;
alter function private.finance_ar_ledger_v1(uuid,text,date,text) owner to postgres;
revoke all on function private.finance_ar_ledger_v1(uuid,text,date,text) from public,anon,authenticated,service_role;

-- This helper is private. Its original caller-owned tenant/company/row checks,
-- public RPC ACL, historic recognition/receipt/refund writers remain untouched.
-- Repeatable read-only catalog and absent-identity checks.
do $finance_ar_mapping_postflight$
declare p record;spec record;denied boolean;
begin
 select * into p from pg_proc where oid=to_regprocedure('private.finance_ar_ledger_v1(uuid,text,date,text)');
 if p.oid is null or md5(p.prosrc)<>'328871795ff8787e301008540a1b4bee' or not p.prosecdef or p.provolatile<>'s'
  or pg_get_userbyid(p.proowner)<>'postgres' or p.proconfig is distinct from array['search_path=""']::text[]
  or has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('authenticated',p.oid,'EXECUTE')
  or has_function_privilege('service_role',p.oid,'EXECUTE')
  or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE') then
  raise exception 'Canonical AR mapper source/authority differs';
 end if;
 for spec in select * from (values
  ('private.finance_ar_invoice_v1(public.invoices,date,jsonb)','60d4707fabaf84287a521b2b58ac7324'),
  ('private.finance_receivables_payload_v1(date,text,text,text,boolean)','d9a4cde2bf54f8c447d9a3a22df226c6'),
  ('private.finance_ar_reconciliation_scope_v1(uuid,text,date,text,text)','481d1d0b1ec6a302b2a44f5a22996ea9'),
  ('private.finance_ar_reconciliation_v1(uuid,text,date,text,text,jsonb)','e9cb655eca0ebd5d4c7f72a66d13ce33'),
  ('public.finance_receivables_v1(date,text,text,text)','3919420d06b2c7818615f757fa759195'),
  ('public.finance_executive_dashboard_v3(date,date,date,date,date,text,text)','36e536eb3ccfc071a8541719022597f1')
 ) baseline(signature,source_md5) loop
  if not exists(select 1 from pg_proc where oid=to_regprocedure(spec.signature) and md5(prosrc)=spec.source_md5) then
   raise exception 'Canonical AR mapper caller or financial scope changed: %',spec.signature;
  end if;
 end loop;
 if auth.uid() is null then
  denied:=false;
  begin perform public.finance_receivables_v1(current_date,null,null,'test');
  exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'Canonical AR accepted absent identity';end if;
 end if;
end;
$finance_ar_mapping_postflight$;

notify pgrst,'reload schema';
