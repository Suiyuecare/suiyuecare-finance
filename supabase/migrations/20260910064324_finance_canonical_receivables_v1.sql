-- Canonical balances are a read model of immutable journals; no historical
-- invoice, voucher or ledger rows are rewritten or inferred from a status.
set local lock_timeout='5s';
set local statement_timeout='60s';

create table private.finance_ar_terms_v1(
 tenant_id uuid not null,data_environment text not null check(data_environment in ('production','test')),
 invoice_id text not null,version bigint not null default 1 check(version>0),metadata jsonb not null default '{}',
 updated_by text not null,updated_at timestamptz not null default now(),
 primary key(tenant_id,data_environment,invoice_id)
);
create table private.finance_ar_operations_v1(
 tenant_id uuid not null,data_environment text not null,actor_id text not null,operation_key text not null,
 operation_type text not null,digest text not null,response jsonb,invoice_id text,source_id text,writing_transaction text,created_at timestamptz not null default now(),
 primary key(tenant_id,data_environment,actor_id,operation_key)
);
create table private.finance_ar_receipts_v1(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,data_environment text not null,
 invoice_id text not null,amount numeric(18,2) not null check(amount>0),received_date date not null,
 status text not null check(status in ('pending','approved','returned')),
 files jsonb not null,submit_key text not null,submitted_by text not null,submitted_at timestamptz not null default now(),
 reviewed_by text,reviewed_at timestamptz,review_key text,note text not null default '',
 unique(tenant_id,data_environment,submitted_by,submit_key,invoice_id)
);
create unique index finance_ar_one_pending_v1 on private.finance_ar_receipts_v1(tenant_id,data_environment,invoice_id) where status='pending';
create index finance_ar_receipts_invoice_v1 on private.finance_ar_receipts_v1(tenant_id,data_environment,invoice_id,received_date);
create table private.finance_ar_refunds_v1(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,data_environment text not null,
 invoice_id text not null,lifecycle_event_id text not null,amount numeric(18,2) not null check(amount>0),
 refund_date date not null,voucher_id text not null,bank_transaction_id text,actor_id text not null,operation_key text not null,
 legacy_refunded_amount numeric not null default 0,legacy_refunded_at timestamptz,
 created_at timestamptz not null default now(),unique(tenant_id,data_environment,actor_id,operation_key)
);
create table private.finance_ar_audit_v1(
 id bigint generated always as identity primary key,tenant_id uuid not null,data_environment text not null,
 invoice_id text not null,actor_id text not null,action text not null,operation_key text not null,
 before_data jsonb,after_data jsonb,created_at timestamptz not null default now()
);
alter table private.finance_ar_terms_v1 enable row level security;
alter table private.finance_ar_operations_v1 enable row level security;
alter table private.finance_ar_receipts_v1 enable row level security;
alter table private.finance_ar_refunds_v1 enable row level security;
alter table private.finance_ar_audit_v1 enable row level security;
revoke all on private.finance_ar_terms_v1,private.finance_ar_operations_v1,private.finance_ar_receipts_v1,private.finance_ar_refunds_v1,private.finance_ar_audit_v1 from public,anon,authenticated,service_role;

alter table public.invoice_lifecycle_events add column ar_amount numeric(18,2),add column refund_payable_amount numeric(18,2);
alter table public.invoice_lifecycle_events add constraint finance_lifecycle_allocation_v1 check(
 (ar_amount is null and refund_payable_amount is null) or
 (ar_amount is not null and refund_payable_amount is not null and ar_amount>=0 and refund_payable_amount>=0 and ar_amount+refund_payable_amount=total));

create function private.finance_ar_write_allowed_v1(p_tenant uuid,p_environment text,p_invoice text)
returns boolean language sql stable security definer set search_path='' as $f$
 select exists(select 1 from private.finance_ar_operations_v1 o where o.tenant_id=p_tenant and o.data_environment=p_environment and o.invoice_id=p_invoice
 and o.actor_id=current_setting('app.finance_ar_actor',true) and o.operation_key=current_setting('app.finance_ar_operation',true)
 and o.operation_type in ('refund','lifecycle') and o.writing_transaction=pg_current_xact_id()::text);
$f$;
create function private.finance_ar_lifecycle_guard_v1()
returns trigger language plpgsql security definer set search_path='' as $f$
declare r public.invoice_lifecycle_events;
begin
 if tg_op='DELETE' then r:=old;else r:=new;end if;
 if (r.event_type in ('void','allowance','refund') and r.status in ('posted','refunded'))
  or (tg_op='UPDATE' and old.event_type in ('void','allowance','refund') and old.status in ('posted','refunded'))
  or coalesce(r.refund_amount,0)>0 or r.ar_amount is not null or r.refund_payable_amount is not null then
  if not private.finance_ar_write_allowed_v1(r.tenant_id,r.data_environment,r.invoice_id) then raise exception '正式折讓與退款資料必須使用原子交易，不能直接修改' using errcode='42501';end if;
 end if;
 if tg_op='DELETE' then return old;else return new;end if;
end;
$f$;
create function private.finance_ar_ledger_guard_v1()
returns trigger language plpgsql security definer set search_path='' as $f$
begin
 if coalesce(new.posting_key,'') like 'invoice_lifecycle:%' or coalesce(new.posting_key,'') like 'tenant:%:invoice_lifecycle:%' or coalesce(new.posting_key,'') like 'invoice_refund:%' then
  if not exists(select 1 from private.finance_ar_operations_v1 o join public.invoices i on i.tenant_id=o.tenant_id and i.data_environment=o.data_environment and i.id=o.invoice_id
   where o.tenant_id=new.tenant_id and o.data_environment=new.data_environment and o.source_id=new.source_id and i.entity_id is not distinct from new.entity_id
    and o.actor_id=current_setting('app.finance_ar_actor',true) and o.operation_key=current_setting('app.finance_ar_operation',true)
    and o.operation_type in ('refund','lifecycle') and o.writing_transaction=pg_current_xact_id()::text) then
   raise exception '折讓與退款分錄必須使用原子交易' using errcode='42501';end if;
 end if;
 return new;
end;
$f$;

-- A ledger row maps to an invoice only when tenant/environment/company and
-- source identity agree. Lifecycle IDs/no map through the original event.
-- Ambiguous numbers remain unmapped, never assigned with LIMIT 1.
create function private.finance_ar_ledger_v1(p_tenant uuid,p_environment text,p_as_of date,p_invoice_id text default null)
returns table(invoice_id text,entity_id text,department_code text,entry_date date,debit numeric,credit numeric,category text,source_ref text)
language sql stable security definer set search_path='' as $f$
 select case when x.n=1 then x.invoice_id end,l.entity_id,l.department_code,l.entry_date,
 coalesce(l.debit,0),coalesce(l.credit,0),
 case when x.lifecycle then 'allowance' when coalesce(l.posting_key,'') like '%:receipt:%' then 'receipt' else 'recognition' end,
 coalesce(nullif(l.reference_no,''),nullif(l.source_no,''),nullif(l.source_id,''),l.voucher_no)
 from public.ledger_entries l
 left join lateral (
  select count(distinct i.id) n,min(i.id) invoice_id,bool_or(e.id is not null) lifecycle
  from public.invoices i
  left join public.invoice_lifecycle_events e on e.tenant_id=i.tenant_id and e.data_environment=i.data_environment and e.invoice_id=i.id
   and (e.id=l.source_id or e.event_no=l.source_no or e.event_no=l.reference_no)
  where i.tenant_id=p_tenant and i.data_environment=p_environment and (p_invoice_id is null or i.id=p_invoice_id) and i.entity_id is not distinct from l.entity_id
   and ((l.source_id=i.id and l.source_type in ('invoice','invoice_reversal'))
    or (coalesce(l.source_type,'') in ('invoice','invoice_reversal','') and nullif(l.source_id,'') is null and (i.no=l.source_no or i.no=l.reference_no))
    or (coalesce(l.source_type,'') in ('invoice','invoice_reversal') and (i.no=l.source_no or i.no=l.reference_no)
      and not exists(select 1 from public.invoices other_i where other_i.tenant_id=p_tenant and other_i.data_environment=p_environment and other_i.id=l.source_id))
    or e.id is not null)
 ) x on true
 where l.tenant_id=p_tenant and l.data_environment=p_environment and l.voided_at is null
  and l.account_code='1123' and l.entry_date<=p_as_of;
$f$;

create function private.finance_ar_invoice_v1(p_invoice public.invoices,p_as_of date,p_ledger jsonb default null)
returns jsonb language plpgsql stable security definer set search_path='' as $f$
declare i public.invoices:=p_invoice;m jsonb:='{}';f public.collection_followups%rowtype;v_last public.receivable_followup_events%rowtype;
 v_due date;v_due_source text;v_terms_version bigint:=0;v_owner text;v_owner_name text;
 v_rec numeric:=0;v_received numeric:=0;v_allowance numeric:=0;v_balance numeric:=0;v_refs jsonb:='[]';v_count bigint:=0;
 v_payable numeric:=0;v_refunded numeric:=0;v_pending numeric:=0;v_pending_date date;v_days integer;v_bucket text;v_status text;v_original numeric;
begin
 select metadata,version into m,v_terms_version from private.finance_ar_terms_v1 where tenant_id=i.tenant_id and data_environment=i.data_environment and invoice_id=i.id;
 m:=coalesce(m,'{}');v_terms_version:=coalesce(v_terms_version,0);
 if nullif(m->>'dueDate','') is not null then v_due:=(m->>'dueDate')::date;v_due_source:='manual';
 else
  select b.due_date into v_due from public.bills b where b.id=i.source_bill_id and b.tenant_id=i.tenant_id and b.data_environment=i.data_environment and b.entity_id is not distinct from i.entity_id;
  v_due_source:=case when v_due is null then 'unknown' else 'source_bill' end;
 end if;
 select * into f from public.collection_followups where tenant_id=i.tenant_id and data_environment=i.data_environment and source_table='invoices' and source_id=i.id order by updated_at desc,id limit 1;
 select * into v_last from public.receivable_followup_events where tenant_id=i.tenant_id and data_environment=i.data_environment and source_table='invoices' and source_id=i.id order by created_at desc,id limit 1;
 v_owner:=case when m?'ownerId' then m->>'ownerId' else f.owner_user_id end;
 select name into v_owner_name from public.finance_users where tenant_id=i.tenant_id and id=v_owner;
 select coalesce(sum(debit-credit) filter(where category='recognition'),0),coalesce(sum(credit-debit) filter(where category='receipt'),0),
  coalesce(sum(credit-debit) filter(where category='allowance'),0),coalesce(sum(debit-credit),0),count(*),
  coalesce(jsonb_agg(distinct source_ref) filter(where source_ref is not null),'[]')
 into v_rec,v_received,v_allowance,v_balance,v_count,v_refs
 from jsonb_to_recordset(coalesce(p_ledger,(select coalesce(jsonb_agg(to_jsonb(l)),'[]') from private.finance_ar_ledger_v1(i.tenant_id,i.data_environment,p_as_of,i.id) l where l.invoice_id=i.id))) as ar(invoice_id text,debit numeric,credit numeric,category text,source_ref text) where invoice_id=i.id;
 -- Refund installments retain the original legacy refund date/amount once;
 -- the latest pointer on the event must not erase historical as-of balances.
 select coalesce(sum(coalesce(e.refund_payable_amount,e.total)),0),coalesce(sum(case when n.n>0 then
  (case when n.legacy_at::date<=p_as_of then n.legacy_amount else 0 end)+n.as_of_new
  else case when (e.refunded_at at time zone 'Asia/Taipei')::date<=p_as_of then coalesce(e.refund_amount,0) else 0 end end),0)
 into v_payable,v_refunded from public.invoice_lifecycle_events e
 left join lateral(select count(*) n,max(r.legacy_refunded_amount) legacy_amount,max(r.legacy_refunded_at at time zone 'Asia/Taipei') legacy_at,
  coalesce(sum(r.amount) filter(where r.refund_date<=p_as_of),0) as_of_new from private.finance_ar_refunds_v1 r
  where r.tenant_id=i.tenant_id and r.data_environment=i.data_environment and r.lifecycle_event_id=e.id) n on true
 where e.tenant_id=i.tenant_id and e.data_environment=i.data_environment and e.invoice_id=i.id
  and e.event_type in ('void','allowance') and e.status<>'voided' and e.settlement_account_code='2131' and e.event_date<=p_as_of;
 select amount,received_date into v_pending,v_pending_date from private.finance_ar_receipts_v1 where tenant_id=i.tenant_id and data_environment=i.data_environment and invoice_id=i.id and status='pending';
 v_original:=coalesce(i.total,i.amount,0);v_pending:=coalesce(v_pending,case when i.status='pending_receipt_review' then greatest(0,case when v_rec>0 then v_balance else v_original-v_allowance end) else 0 end);
 v_days:=case when v_due is null then null else greatest(0,p_as_of-v_due) end;
 v_bucket:=case when v_balance<=0 then 'settled' when v_due is null then 'unknown' when v_days=0 then 'not_due' when v_days<=30 then 'd1' when v_days<=60 then 'd31' when v_days<=90 then 'd61' else 'd90' end;
 v_status:=case when v_count=0 then 'unrecognized' when v_balance<0 then 'credit' when v_balance=0 then 'settled' when v_received>0 then 'partial' else 'unpaid' end;
 return jsonb_build_object('invoiceId',i.id,'invoiceNo',i.no,'batchId',i.batch_id,'entityId',i.entity_id,'departmentCode',i.department_code,'buyer',i.buyer,'invoiceDate',i.invoice_date,
 'dueDate',v_due,'dueSource',v_due_source,'originalAmount',v_original,'recognizedAmount',v_rec,'arAllowanceAmount',v_allowance,'allowanceAmount',(select coalesce(sum(e.total),0) from public.invoice_lifecycle_events e where e.tenant_id=i.tenant_id and e.data_environment=i.data_environment and e.invoice_id=i.id and e.event_type in ('void','allowance') and e.status<>'voided' and e.event_date<=p_as_of),'receivedAmount',v_received,'outstandingAmount',v_balance,
 'unrecognizedAmount',case when v_count=0 and i.voided_at is null and i.status not in ('void','voided','cancelled','rejected') then v_original else 0 end,
 'refundPayable',greatest(0,v_payable-v_refunded),'refundedAmount',v_refunded,'pendingReceiptAmount',v_pending,'pendingReceiptDate',v_pending_date,'status',i.status,'balanceStatus',v_status,
 'rowVersion',i.row_version,'metadataVersion',v_terms_version,'agingBucket',v_bucket,'overdueDays',v_days,'ownerId',v_owner,'ownerName',coalesce(v_owner_name,f.owner_name),
 'lastContact',case when m?'lastContact' then m->>'lastContact' else coalesce(f.last_followup_at::text,v_last.created_at::text) end,
 'nextActionDate',case when m?'nextActionDate' then m->>'nextActionDate' else f.next_followup_at::text end,
 'notes',case when m?'notes' then m->>'notes' else coalesce(f.last_note,v_last.event_note) end,'sourceRefs',v_refs,
 'refundEvents',(select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'eventNo',e.event_no,'type',e.event_type,'date',e.event_date,'total',e.total,'refundPayableAmount',coalesce(e.refund_payable_amount,e.total),'refundAmount',coalesce(e.refund_amount,0),'remaining',greatest(0,coalesce(e.refund_payable_amount,e.total)-coalesce(e.refund_amount,0)),'voucherId',e.voucher_id,'voucherNo',e.voucher_no,'status',e.status) order by e.event_date,e.id),'[]') from public.invoice_lifecycle_events e where e.tenant_id=i.tenant_id and e.data_environment=i.data_environment and e.invoice_id=i.id and e.event_type in ('void','allowance') and e.settlement_account_code='2131' and e.status<>'voided'),
 'needsReconciliation',(i.status in ('paid','partial') and v_received=0) or v_balance<0);
end;
$f$;

create function private.finance_ar_bank_reconciliation_v1(p_tenant uuid,p_environment text,p_as_of date,p_entity text)
returns jsonb language plpgsql stable security definer set search_path='' as $f$
declare v_items jsonb;
begin
 if (public.is_finance_accounting() or public.is_finance_admin() or public.current_finance_role() in ('ceo','admin_director')) is distinct from true then
  return jsonb_build_object('bankVisible',false,'bankScope','company','unmatchedBankItems','[]'::jsonb,'unmatchedBankAmount',null,'unmatchedBankCount',null);
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'date',t.transaction_date,'entityId',t.entity_id,'amount',t.amount,'matchedAmount',m.amount,
  'remainingAmount',greatest(0,t.amount-m.amount),'matchStatus',t.match_status,'counterparty',t.counterparty,'referenceNo',t.reference_no,'description',t.description,
  'matchCount',m.n,'differenceFlag',m.amount>t.amount) order by t.transaction_date,t.id),'[]') into v_items
 from public.bank_transactions t join lateral(
  select coalesce(sum(matched_amount),0) amount,count(*) n from public.bank_reconciliation_matches m
  where m.tenant_id=p_tenant and m.data_environment=p_environment and m.bank_transaction_id=t.id
   and (coalesce(m.matched_at,m.created_at) at time zone 'Asia/Taipei')::date<=p_as_of
 ) m on true where t.tenant_id=p_tenant and t.data_environment=p_environment and t.amount>0 and t.match_status<>'ignored'
  and t.transaction_date<=p_as_of and (p_entity is null or p_entity='all' or t.entity_id=p_entity) and t.amount<>m.amount;
 return jsonb_build_object('bankVisible',true,'bankScope','company','unmatchedBankItems',v_items,'unmatchedBankCount',jsonb_array_length(v_items),
  'unmatchedBankAmount',(select coalesce(sum((x->>'remainingAmount')::numeric),0) from jsonb_array_elements(v_items) x));
end;
$f$;

create function private.finance_receivables_payload_v1(p_as_of date,p_entity_id text,p_department_code text,p_data_environment text,p_dashboard boolean default false)
returns jsonb language plpgsql stable security definer set search_path='' as $f$
declare a public.finance_users%rowtype;v_items jsonb;v_summary jsonb;v_buckets jsonb;v_mapped numeric;v_ledger jsonb;v_ledger_map jsonb;v_unmapped numeric:=0;v_financial boolean;
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
 select coalesce(sum((x->>'outstandingAmount')::numeric),0) into v_mapped from jsonb_array_elements(v_items) x;
 if p_dashboard then
  select coalesce(sum(debit-credit),0) into v_unmapped from private.finance_ar_ledger_v1(a.tenant_id,p_data_environment,p_as_of)
   where invoice_id is null and (p_entity_id is null or p_entity_id='all' or entity_id=p_entity_id) and (p_department_code is null or department_code=p_department_code);
 end if;
 return jsonb_build_object('version',1,'asOf',p_as_of,'complete',true,'totalCount',jsonb_array_length(v_items),'items',v_items,'summary',v_summary,'buckets',v_buckets,
 'reconciliation',jsonb_build_object('mappedLedgerNet',v_mapped,'unmappedLedgerNet',case when p_dashboard then v_unmapped else null end,'ledgerNet',case when p_dashboard then v_mapped+v_unmapped else null end,'needsReview',v_unmapped<>0)||private.finance_ar_bank_reconciliation_v1(a.tenant_id,p_data_environment,p_as_of,p_entity_id));
end;
$f$;
create function public.finance_receivables_v1(p_as_of date,p_entity_id text default null,p_department_code text default null,p_data_environment text default 'production')
returns jsonb language sql stable security definer set search_path='' as $f$
 select private.finance_receivables_payload_v1(p_as_of,p_entity_id,p_department_code,p_data_environment,false);
$f$;

create function public.finance_update_receivable_terms_v1(p_invoice_id text,p_patch jsonb,p_expected_version bigint,p_idempotency_key text,p_data_environment text default 'production')
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='5s' as $f$
declare a public.finance_users%rowtype;i public.invoices%rowtype;t private.finance_ar_terms_v1%rowtype;v_old jsonb;v_new jsonb;v_digest text;v_saved text;v_cached jsonb;v_response jsonb;v_key text;
begin
 a:=private.finance_correction_actor_v1();
 if not private.finance_correction_role_v1(a.tenant_id,a.id,null,array['accountant','admin_director','ceo']) then raise exception '僅有效財務管理人員可更新應收追蹤' using errcode='42501';end if;
 if p_data_environment is null or p_data_environment not in ('production','test') or p_expected_version is null or p_expected_version<0
  or jsonb_typeof(p_patch) is distinct from 'object' or coalesce(p_idempotency_key,'') !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$'
  or length(btrim(coalesce(p_patch->>'reason',''))) not between 1 and 500
  or exists(select 1 from jsonb_object_keys(p_patch) k where k not in ('dueDate','ownerId','lastContact','nextActionDate','notes','reason'))
  or length(coalesce(p_patch->>'notes',''))>2000 then raise exception '追蹤內容、原因或操作識別碼格式不正確' using errcode='22023';end if;
 foreach v_key in array array['dueDate','ownerId','lastContact','nextActionDate','notes','reason'] loop
  if p_patch?v_key and jsonb_typeof(p_patch->v_key) not in ('string','null') then raise exception '追蹤欄位須為文字或空值' using errcode='22023';end if;
 end loop;
 if nullif(p_patch->>'dueDate','') is not null then perform (p_patch->>'dueDate')::date;end if;
 if nullif(p_patch->>'nextActionDate','') is not null then perform (p_patch->>'nextActionDate')::date;end if;
 if nullif(p_patch->>'lastContact','') is not null then perform (p_patch->>'lastContact')::timestamptz;end if;
 if nullif(p_patch->>'ownerId','') is not null and not exists(select 1 from public.finance_users u where u.tenant_id=a.tenant_id and u.id=p_patch->>'ownerId' and u.active is true and u.auth_user_id is not null) then raise exception '追蹤負責人須為本租戶有效人員' using errcode='42501';end if;
 select * into i from public.invoices where tenant_id=a.tenant_id and data_environment=p_data_environment and id=p_invoice_id for update;
 if not found or public.can_read_invoice(i) is distinct from true then raise exception '無權讀取此發票' using errcode='42501';end if;
 v_digest:=encode(sha256(jsonb_build_object('invoice',p_invoice_id,'patch',p_patch,'version',p_expected_version)::text::bytea),'hex');
 insert into private.finance_ar_operations_v1(tenant_id,data_environment,actor_id,operation_key,operation_type,digest) values(a.tenant_id,p_data_environment,a.id,p_idempotency_key,'terms',v_digest) on conflict do nothing;
 select digest,response into v_saved,v_cached from private.finance_ar_operations_v1 where tenant_id=a.tenant_id and data_environment=p_data_environment and actor_id=a.id and operation_key=p_idempotency_key and operation_type='terms' for update;
 if v_saved is distinct from v_digest then raise exception '操作識別碼已用於不同內容' using errcode='23505';end if;
 if v_cached is not null then return v_cached||'{"idempotent_replay":true}'::jsonb;end if;
 select * into t from private.finance_ar_terms_v1 where tenant_id=a.tenant_id and data_environment=p_data_environment and invoice_id=i.id for update;
 if coalesce(t.version,0)<>p_expected_version then raise exception '追蹤資料已更新，請重新讀取' using errcode='40001';end if;
 v_old:=coalesce(t.metadata,'{}');v_new:=v_old||(p_patch-'reason');
 insert into private.finance_ar_terms_v1(tenant_id,data_environment,invoice_id,version,metadata,updated_by) values(a.tenant_id,p_data_environment,i.id,p_expected_version+1,v_new,a.id)
 on conflict(tenant_id,data_environment,invoice_id) do update set version=excluded.version,metadata=excluded.metadata,updated_by=excluded.updated_by,updated_at=clock_timestamp();
 insert into private.finance_ar_audit_v1(tenant_id,data_environment,invoice_id,actor_id,action,operation_key,before_data,after_data)
 values(a.tenant_id,p_data_environment,i.id,a.id,'terms',p_idempotency_key,v_old,jsonb_build_object('metadata',v_new,'reason',p_patch->>'reason','version',p_expected_version+1));
 v_response:=jsonb_build_object('ok',true,'invoiceId',i.id,'metadataVersion',p_expected_version+1,'idempotent_replay',false);
 update private.finance_ar_operations_v1 set response=v_response where tenant_id=a.tenant_id and data_environment=p_data_environment and actor_id=a.id and operation_key=p_idempotency_key;
 return v_response;
end;
$f$;
create function public.finance_set_invoice_due_date_v1(p_invoice_id text,p_due_date date,p_expected_version bigint,p_reason text,p_idempotency_key text,p_data_environment text default 'production')
returns jsonb language sql security definer set search_path='' as $f$
 select public.finance_update_receivable_terms_v1(p_invoice_id,jsonb_build_object('dueDate',p_due_date,'reason',p_reason),p_expected_version,p_idempotency_key,p_data_environment);
$f$;

create function public.finance_invoice_receipt_action_v2(p_invoice_ids text[],p_action text,p_idempotency_key text,p_expected_versions jsonb,
 p_note text default '',p_files jsonb default '[]',p_data_environment text default 'production',p_amounts jsonb default null,p_received_date date default null)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='5s' as $f$
declare a public.finance_users%rowtype;i public.invoices%rowtype;r private.finance_ar_receipts_v1%rowtype;v_id text;v_digest text;v_cached jsonb;v_saved text;
 v_result jsonb;v_rows jsonb:='[]';v_steps jsonb;v_files jsonb;v_now timestamptz:=clock_timestamp();v_today date:=(clock_timestamp() at time zone 'Asia/Taipei')::date;
 v_date date;v_ar jsonb;v_amount numeric;v_collectible numeric;v_received numeric;v_amount_map jsonb:='{}';v_date_map jsonb:='{}';v_event uuid;v_final_balance numeric;
 v_prev_key text:=coalesce(current_setting('app.finance_receipt_operation',true),'');v_prev_actor text:=coalesce(current_setting('app.finance_receipt_actor',true),'');
begin
 a:=private.finance_correction_actor_v1();
 if p_action is null or p_action not in ('submit','approve','return') or p_data_environment is null or p_data_environment not in ('production','test')
  or p_invoice_ids is null or cardinality(p_invoice_ids) not between 1 and 150
  or cardinality(p_invoice_ids)<>(select count(distinct x) from unnest(p_invoice_ids) x)
  or coalesce(p_idempotency_key,'') !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$'
  or length(coalesce(p_note,''))>2000 or (p_action='return' and length(btrim(coalesce(p_note,'')))<3)
  or jsonb_typeof(p_expected_versions) is distinct from 'object' then raise exception '收款操作、原因、版本或識別碼格式不正確' using errcode='22023';end if;
 if (select count(*) from jsonb_object_keys(p_expected_versions))<>cardinality(p_invoice_ids)
  or exists(select 1 from unnest(p_invoice_ids) id where coalesce(p_expected_versions->>id,'') !~ '^[1-9][0-9]{0,18}$') then raise exception '收款資料版本不完整，請重新開啟核對' using errcode='40001';end if;
 if p_action<>'submit' and (p_amounts is not null or p_received_date is not null) then raise exception '覆核不得更改已送出的收款金額或日期，請退回後重新提交' using errcode='22023';end if;
 if p_amounts is not null and (jsonb_typeof(p_amounts) is distinct from 'object') then raise exception '本次收款金額格式不正確' using errcode='22023';end if;
 if p_amounts is not null and ((select count(*) from jsonb_object_keys(p_amounts))<>cardinality(p_invoice_ids)
  or exists(select 1 from unnest(p_invoice_ids) id where coalesce(p_amounts->>id,'') !~ '^[0-9]{1,16}(\.[0-9]{1,2})?$' or jsonb_typeof(p_amounts->id) is distinct from 'number')) then raise exception '請逐張指定最多兩位小數的本次實收金額' using errcode='22023';end if;
 if not private.finance_correction_role_v1(a.tenant_id,a.id,null,array[case when p_action='submit' then 'accountant' else 'ceo' end]) then raise exception '收款證明只能由正式會計提交，收款確認與退回只能由有效執行長執行' using errcode='42501';end if;
 -- Preserve the exact v1 digest for old callers and completed operations.
 v_result:=jsonb_build_object('ids',p_invoice_ids,'action',p_action,'versions',p_expected_versions,'note',coalesce(p_note,''),'files',p_files);
 if p_amounts is not null or p_received_date is not null then v_result:=v_result||jsonb_build_object('amounts',p_amounts,'receivedDate',p_received_date);end if;
 v_digest:=encode(sha256(v_result::text::bytea),'hex');
 insert into private.finance_receipt_operations_v1(tenant_id,data_environment,actor_id,operation_key,digest,invoice_ids)
 values(a.tenant_id,p_data_environment,a.id,p_idempotency_key,v_digest,p_invoice_ids) on conflict do nothing;
 select digest,response into v_saved,v_cached from private.finance_receipt_operations_v1 where tenant_id=a.tenant_id and data_environment=p_data_environment and actor_id=a.id and operation_key=p_idempotency_key for update;
 if v_saved is distinct from v_digest then raise exception '相同操作識別碼不可使用不同收款內容' using errcode='23505';end if;
 if v_cached is not null then return v_cached||jsonb_build_object('idempotent_replay',true);end if;
 update private.finance_receipt_operations_v1 set writing_transaction=pg_current_xact_id()::text where tenant_id=a.tenant_id and data_environment=p_data_environment and actor_id=a.id and operation_key=p_idempotency_key;
 perform set_config('app.finance_receipt_operation',p_idempotency_key,true);perform set_config('app.finance_receipt_actor',a.id,true);
 for v_id in select id from unnest(p_invoice_ids) id order by id loop
  select * into i from public.invoices where tenant_id=a.tenant_id and data_environment=p_data_environment and id=v_id for update;
  if not found or public.can_read_invoice(i) is distinct from true then raise exception '無權讀取此租戶／環境的發票' using errcode='42501';end if;
  if i.row_version is distinct from (p_expected_versions->>v_id)::bigint then raise exception '收款內容已更新，請重新開啟核對' using errcode='40001';end if;
  if i.voided_at is not null or i.approval_status in ('rejected','cancelled','voided') or i.status in ('paid','void','voided','cancelled','rejected')
   or not private.finance_receipt_route_ready_v1(i.steps)
   or (p_action='submit' and i.status not in ('unpaid','partial'))
   or (p_action<>'submit' and i.status is distinct from 'pending_receipt_review') then raise exception '發票不在此收款關卡，整批未更新' using errcode='55000';end if;
  v_files:=case when jsonb_typeof(p_files)='object' then p_files->i.id else p_files end;
  if p_action='submit' and not private.finance_receipt_files_valid_v1(i,v_files,a.id) then raise exception '收款證明須為本人上傳、屬於此單或批次且原檔存在的正式附件' using errcode='42501';end if;
  if p_action='approve' and (i.receipt_submitted_at is null or not private.finance_receipt_files_valid_v1(i,i.receipt_files)) then raise exception '未有完整正式收款證明，不能確認入帳' using errcode='23514';end if;
  select * into r from private.finance_ar_receipts_v1 where tenant_id=a.tenant_id and data_environment=p_data_environment and invoice_id=i.id and status='pending' for update;
  v_ar:=private.finance_ar_invoice_v1(i,v_today);
  v_received:=(v_ar->>'receivedAmount')::numeric;
  v_collectible:=case when (v_ar->>'recognizedAmount')::numeric>0 then (v_ar->>'outstandingAmount')::numeric else coalesce(i.total,i.amount,0)-(v_ar->>'arAllowanceAmount')::numeric-v_received end;
  if p_action='submit' then
   if r.id is not null then raise exception '此發票已有待確認收款' using errcode='55000';end if;
   if (i.status='partial' or i.cash_receipt_posted_at is not null) and v_received<=0 then raise exception '舊收款狀態缺少可核對分錄，請先核對原帳，不可推算實收' using errcode='23514';end if;
   v_amount:=coalesce((p_amounts->>i.id)::numeric,v_collectible);v_date:=coalesce(p_received_date,v_today);
  else v_amount:=coalesce(r.amount,coalesce(i.total,i.amount,0));v_date:=coalesce(r.received_date,v_today);
  end if;
  if p_action<>'return' then
   if v_amount<=0 or v_amount<>round(v_amount,2) or v_amount>v_collectible then raise exception '本次實收金額必須大於零且不可超過正式剩餘應收' using errcode='23514';end if;
   if p_action='approve' and r.id is null and v_amount<>v_collectible then raise exception '舊覆核金額與現行餘額不同，請退回重新核對' using errcode='23514';end if;
   if v_date>v_today or (i.invoice_date is not null and v_date<i.invoice_date) then raise exception '收款日期不可晚於今天或早於發票日期' using errcode='22023';end if;
  end if;
  if p_action='approve' then perform private.finance_assert_period_open(a.tenant_id,p_data_environment,i.entity_id,v_date,'發票收款入帳');end if;
  v_amount_map:=v_amount_map||jsonb_build_object(i.id,v_amount);v_date_map:=v_date_map||jsonb_build_object(i.id,v_date);
 end loop;
 for v_id in select id from unnest(p_invoice_ids) id order by id loop
  select * into i from public.invoices where tenant_id=a.tenant_id and data_environment=p_data_environment and id=v_id;
  select * into r from private.finance_ar_receipts_v1 where tenant_id=a.tenant_id and data_environment=p_data_environment and invoice_id=i.id and status='pending';
  v_amount:=(v_amount_map->>i.id)::numeric;v_date:=(v_date_map->>i.id)::date;
  if p_action='submit' then
   v_files:=case when jsonb_typeof(p_files)='object' then p_files->i.id else p_files end;
   insert into private.finance_ar_receipts_v1(tenant_id,data_environment,invoice_id,amount,received_date,status,files,submit_key,submitted_by,note)
    values(a.tenant_id,p_data_environment,i.id,v_amount,v_date,'pending',v_files,p_idempotency_key,a.id,coalesce(p_note,'')) returning id into v_event;
   update public.invoices set status='pending_receipt_review',receipt_files=v_files,receipt_submitted_at=v_now,receipt_submitted_by=a.name,receipt_note=coalesce(p_note,''),updated_at=v_now where id=i.id;
  elsif p_action='return' then
   v_ar:=private.finance_ar_invoice_v1(i,v_today);
   update private.finance_ar_receipts_v1 set status='returned',reviewed_by=a.id,reviewed_at=v_now,review_key=p_idempotency_key where id=r.id;
   update public.invoices set status=case when (v_ar->>'receivedAmount')::numeric>0 then 'partial' else 'unpaid' end,receipt_reviewed_at=v_now,receipt_reviewed_by=a.name,receipt_review_note=p_note,updated_at=v_now where id=i.id;
   v_event:=r.id;
  else
   if r.id is null then
    insert into private.finance_ar_receipts_v1(tenant_id,data_environment,invoice_id,amount,received_date,status,files,submit_key,submitted_by,note)
    values(a.tenant_id,p_data_environment,i.id,v_amount,v_date,'pending',i.receipt_files,'legacy-review:'||p_idempotency_key,a.id,'舊版完整證明覆核') returning * into r;
   end if;
   v_event:=r.id;
   select jsonb_agg(case when s->>'rk'='applicant_invoice_delivery' and coalesce(s->>'a','')='' then
    private.finance_income_append_step_action(s,a.id,a.name,'執行長確認收款後完成交付','已檢查正式收款證明','[]')||jsonb_build_object('a','approved','autoSkip',true,'autoSkipReason','receipt_confirmed_by_ceo') else s end order by ord) into v_steps
    from jsonb_array_elements(i.steps) with ordinality t(s,ord);
   -- Preserve the existing revenue writer's final-approval contract. This
   -- intermediate state is inside the same transaction and never observable.
   update public.invoices set status='paid',steps=v_steps,approval_status='completed',approval_step=jsonb_array_length(v_steps),updated_at=v_now where id=i.id;
   v_result:=private.finance_receipt_revenue_ready_v1(i.id);
   if v_result->>'ok' is distinct from 'true' or coalesce((v_result->>'deferred')::boolean,false) then raise exception '收入認列尚未完成，收款整批未入帳' using errcode='23514';end if;
   select * into i from public.invoices where id=v_id;
   v_ar:=private.finance_ar_invoice_v1(i,v_today);v_collectible:=(v_ar->>'outstandingAmount')::numeric;
   if v_amount>v_collectible then raise exception '收入認列後的正式應收不足，收款整批未入帳' using errcode='23514';end if;
   insert into public.ledger_entries(entry_date,description,entity_id,department_code,debit,credit,account_code,account_name,reference_no,posting_key,source_type,source_id,source_no,tenant_id,data_environment)
   values(v_date,'發票分次收款 — '||coalesce(i.buyer,''),i.entity_id,i.department_code,v_amount,0,'1112','銀行存款',i.no,'tenant:'||a.tenant_id::text||':env:'||p_data_environment||':invoice:'||i.id||':receipt:'||v_event::text||':bank','invoice',i.id,i.no,a.tenant_id,p_data_environment),
    (v_date,'沖轉應收帳款 — '||coalesce(i.buyer,''),i.entity_id,i.department_code,0,v_amount,'1123','應收帳款',i.no,'tenant:'||a.tenant_id::text||':env:'||p_data_environment||':invoice:'||i.id||':receipt:'||v_event::text||':ar','invoice',i.id,i.no,a.tenant_id,p_data_environment);
   v_final_balance:=v_collectible-v_amount;
   update private.finance_ar_receipts_v1 set status='approved',reviewed_by=a.id,reviewed_at=v_now,review_key=p_idempotency_key where id=v_event;
   update public.invoices set status=case when v_final_balance=0 then 'paid' else 'partial' end,
    paid_at=case when v_final_balance=0 then (v_date::timestamp at time zone 'Asia/Taipei') else null end,
    cash_receipt_posted_at=coalesce(cash_receipt_posted_at,v_now),receipt_reviewed_at=v_now,receipt_reviewed_by=a.name,receipt_review_note=coalesce(p_note,''),updated_at=v_now where id=i.id;
  end if;
  insert into public.module_audit_logs(table_name,row_id,action,actor_email,before_data,after_data)
   values('invoice_receipt',i.id,upper(p_action),a.email,jsonb_build_object('status',i.status,'row_version',i.row_version,'receipt_files',i.receipt_files),jsonb_build_object('actorId',a.id,'note',p_note,'at',v_now,'operationKey',p_idempotency_key,'receiptId',v_event,'amount',v_amount,'receivedDate',v_date));
  insert into private.finance_ar_audit_v1(tenant_id,data_environment,invoice_id,actor_id,action,operation_key,before_data,after_data)
   values(a.tenant_id,p_data_environment,i.id,a.id,'receipt_'||p_action,p_idempotency_key,jsonb_build_object('rowVersion',p_expected_versions->i.id),jsonb_build_object('receiptId',v_event,'amount',v_amount,'receivedDate',v_date));
  v_rows:=v_rows||jsonb_build_array(jsonb_build_object('id',i.id,'action',p_action,'receiptId',v_event,'amount',v_amount,'receivedDate',v_date));
 end loop;
 v_result:=jsonb_build_object('ok',true,'count',cardinality(p_invoice_ids),'rows',v_rows,'idempotent_replay',false);
 update private.finance_receipt_operations_v1 set response=v_result,writing_transaction=null where tenant_id=a.tenant_id and data_environment=p_data_environment and actor_id=a.id and operation_key=p_idempotency_key;
 perform set_config('app.finance_receipt_operation',v_prev_key,true);perform set_config('app.finance_receipt_actor',v_prev_actor,true);
 return v_result;
end;
$f$;
create or replace function public.finance_invoice_receipt_action_v1(p_invoice_ids text[],p_action text,p_idempotency_key text,p_expected_versions jsonb,p_note text default '',p_files jsonb default '[]',p_data_environment text default 'production')
returns jsonb language sql security definer set search_path='' set lock_timeout='5s' as $f$
 select public.finance_invoice_receipt_action_v2(p_invoice_ids,p_action,p_idempotency_key,p_expected_versions,p_note,p_files,p_data_environment,null,null);
$f$;

create function public.refund_invoice_receipt_v2(p_lifecycle_event_id text,p_refund_amount numeric,p_reason text,p_refund_date date,p_bank_transaction_id text,p_idempotency_key text,p_expected_refund_amount numeric)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='5s' as $f$
declare a public.finance_users%rowtype;i public.invoices%rowtype;e public.invoice_lifecycle_events%rowtype;t public.bank_transactions%rowtype;
 v_digest text;v_saved text;v_cached jsonb;v_result jsonb;v_entries jsonb;v_no text;v_event text;v_id uuid:=gen_random_uuid();v_used numeric;v_before numeric;v_total numeric;
 v_legacy numeric;v_legacy_at timestamptz;v_env text;v_old_op text:=coalesce(current_setting('app.finance_ar_operation',true),'');v_old_actor text:=coalesce(current_setting('app.finance_ar_actor',true),'');
begin
 a:=private.finance_correction_actor_v1();
 if not private.finance_correction_role_v1(a.tenant_id,a.id,null,array['accountant','admin_director','ceo']) then raise exception '僅有效會計、行政部門主任或執行長可登錄退款' using errcode='42501';end if;
 if p_refund_amount is null or p_refund_amount<=0 or p_refund_amount::text in ('NaN','Infinity','-Infinity') or p_refund_amount<>round(p_refund_amount,2)
  or p_expected_refund_amount is null or p_expected_refund_amount<0 or p_expected_refund_amount::text in ('NaN','Infinity','-Infinity')
  or p_refund_date is null or p_refund_date>(clock_timestamp() at time zone 'Asia/Taipei')::date
  or length(btrim(coalesce(p_reason,''))) not between 1 and 2000
  or coalesce(p_idempotency_key,'') !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$' then raise exception '退款金額、日期、原因、版本或操作識別碼格式不正確' using errcode='22023';end if;
 select * into e from public.invoice_lifecycle_events where id=p_lifecycle_event_id and tenant_id=a.tenant_id;
 if not found then raise exception '無權讀取退款事件' using errcode='42501';end if;
 v_env:=e.data_environment;
 if v_env not in ('production','test') then raise exception '退款環境不正確' using errcode='22023';end if;
 select * into i from public.invoices where id=e.invoice_id and tenant_id=a.tenant_id and data_environment=v_env for update;
 if not found or public.can_read_invoice(i) is distinct from true then raise exception '無權讀取此退款來源發票' using errcode='42501';end if;
 select * into e from public.invoice_lifecycle_events where id=p_lifecycle_event_id and tenant_id=a.tenant_id and data_environment=v_env for update;
 v_digest:=encode(sha256(jsonb_build_object('event',e.id,'amount',p_refund_amount,'reason',p_reason,'date',p_refund_date,'bank',p_bank_transaction_id,'expected',p_expected_refund_amount)::text::bytea),'hex');
 insert into private.finance_ar_operations_v1(tenant_id,data_environment,actor_id,operation_key,operation_type,digest) values(a.tenant_id,v_env,a.id,p_idempotency_key,'refund',v_digest) on conflict do nothing;
 select digest,response into v_saved,v_cached from private.finance_ar_operations_v1 where tenant_id=a.tenant_id and data_environment=v_env and actor_id=a.id and operation_key=p_idempotency_key and operation_type='refund' for update;
 if v_saved is distinct from v_digest then raise exception '操作識別碼已用於不同退款內容' using errcode='23505';end if;
 if v_cached is not null then return v_cached||'{"idempotent_replay":true}'::jsonb;end if;
 v_before:=coalesce(e.refund_amount,0);v_total:=v_before+p_refund_amount;
 if e.event_type not in ('void','allowance') or e.settlement_account_code is distinct from '2131' or e.status not in ('posted','refunded')
  or v_before<0 or v_total>coalesce(e.refund_payable_amount,e.total) or p_refund_date<e.event_date then raise exception '退款必須屬於已入帳應付退款且不可超過剩餘金額' using errcode='23514';end if;
 if v_before<>p_expected_refund_amount then raise exception '退款累計金額已更新，請重新讀取' using errcode='40001';end if;
 perform private.finance_assert_period_open(a.tenant_id,v_env,i.entity_id,p_refund_date,'發票退款');
 if nullif(p_bank_transaction_id,'') is not null then
  select * into t from public.bank_transactions where id=p_bank_transaction_id and tenant_id=a.tenant_id and data_environment=v_env and entity_id=i.entity_id for update;
  if not found or t.amount>=0 or t.match_status='ignored' then raise exception '退款銀行交易須為本公司有效支出' using errcode='42501';end if;
  select coalesce(sum(greatest(0,matched_amount)),0) into v_used from public.bank_reconciliation_matches where tenant_id=a.tenant_id and data_environment=v_env and bank_transaction_id=t.id;
  if v_used+p_refund_amount>abs(t.amount) then raise exception '銀行交易可分攤餘額不足' using errcode='23514';end if;
 end if;
 select legacy_refunded_amount,legacy_refunded_at into v_legacy,v_legacy_at from private.finance_ar_refunds_v1 where tenant_id=a.tenant_id and data_environment=v_env and lifecycle_event_id=e.id order by created_at,id limit 1;
 if not found then v_legacy:=v_before;v_legacy_at:=e.refunded_at;end if;
 v_no:=public.next_voucher_no('IVRFND',p_refund_date,v_env);v_event:='refund_'||v_id::text;
 update private.finance_ar_operations_v1 set invoice_id=i.id,source_id=v_event,writing_transaction=pg_current_xact_id()::text where tenant_id=a.tenant_id and data_environment=v_env and actor_id=a.id and operation_key=p_idempotency_key;
 perform set_config('app.finance_ar_operation',p_idempotency_key,true);perform set_config('app.finance_ar_actor',a.id,true);
 v_entries:=jsonb_build_array(jsonb_build_object('t','dr','ac','2131','an','應付費用','dept',i.department_code,'amt',p_refund_amount),jsonb_build_object('t','cr','ac','1112','an','銀行存款','dept',i.department_code,'amt',p_refund_amount));
 insert into public.vouchers(id,no,request_id,entity_id,entity_name,voucher_date,description,entries,total,creator,posted,posted_at,posting_locked_at,adjusts_voucher_no,adjustment_type,data_environment,tenant_id)
 values(v_no,v_no,i.id,i.entity_id,i.entity_name,p_refund_date,'發票分次退款 — '||e.event_no||' — '||p_reason,v_entries,p_refund_amount,a.name,true,clock_timestamp(),clock_timestamp(),e.voucher_no,'adjustment',v_env,a.tenant_id);
 insert into public.ledger_entries(entry_date,description,entity_id,department_code,debit,credit,account_code,account_name,reference_no,posting_key,source_type,source_id,source_no,voucher_no,data_environment,tenant_id)
 values(p_refund_date,'發票分次退款沖轉應付 — '||e.event_no,i.entity_id,i.department_code,p_refund_amount,0,'2131','應付費用',v_event,'invoice_refund:'||v_id::text||':payable','invoice_lifecycle_refund',v_event,v_event,v_no,v_env,a.tenant_id),
 (p_refund_date,'發票分次退款付款 — '||e.event_no,i.entity_id,i.department_code,0,p_refund_amount,'1112','銀行存款',v_event,'invoice_refund:'||v_id::text||':bank','invoice_lifecycle_refund',v_event,v_event,v_no,v_env,a.tenant_id);
 insert into public.invoice_lifecycle_events(id,data_environment,invoice_id,invoice_no,event_type,event_no,event_date,reason,amount,tax,total,settlement_account_code,settlement_account_name,voucher_id,voucher_no,status,refund_amount,refund_voucher_id,refund_voucher_no,refund_bank_transaction_id,refunded_at,created_by,tenant_id)
 values(v_event,v_env,i.id,i.no,'refund',v_event,p_refund_date,p_reason,p_refund_amount,0,p_refund_amount,'2131','應付費用',v_no,v_no,'refunded',p_refund_amount,v_no,v_no,nullif(p_bank_transaction_id,''),p_refund_date::timestamp at time zone 'Asia/Taipei',a.name,a.tenant_id);
 insert into private.finance_ar_refunds_v1(id,tenant_id,data_environment,invoice_id,lifecycle_event_id,amount,refund_date,voucher_id,bank_transaction_id,actor_id,operation_key,legacy_refunded_amount,legacy_refunded_at)
 values(v_id,a.tenant_id,v_env,i.id,e.id,p_refund_amount,p_refund_date,v_no,nullif(p_bank_transaction_id,''),a.id,p_idempotency_key,v_legacy,v_legacy_at);
 update public.invoice_lifecycle_events set status=case when v_total=coalesce(e.refund_payable_amount,e.total) then 'refunded' else 'posted' end,refund_amount=v_total,refund_voucher_id=v_no,refund_voucher_no=v_no,
 refund_bank_transaction_id=nullif(p_bank_transaction_id,''),refunded_at=p_refund_date::timestamp at time zone 'Asia/Taipei',updated_at=clock_timestamp() where id=e.id;
 if t.id is not null then
  insert into public.bank_reconciliation_matches(id,tenant_id,data_environment,bank_transaction_id,match_type,target_table,target_id,target_no,matched_amount,confidence,match_method,matched_by,matched_at,note)
  values('refund_'||v_id::text,a.tenant_id,v_env,t.id,'manual','vouchers',v_no,v_no,p_refund_amount,1,'manual',a.name,clock_timestamp(),p_reason);
  update public.bank_transactions set match_status=case when v_used+p_refund_amount=abs(t.amount) then 'matched' else 'manual_review' end,updated_at=clock_timestamp() where id=t.id;
 end if;
 insert into private.finance_ar_audit_v1(tenant_id,data_environment,invoice_id,actor_id,action,operation_key,before_data,after_data)
 values(a.tenant_id,v_env,i.id,a.id,'refund',p_idempotency_key,jsonb_build_object('eventId',e.id,'refundAmount',v_before),jsonb_build_object('refundId',v_id,'amount',p_refund_amount,'refundAmount',v_total,'date',p_refund_date,'voucherNo',v_no,'reason',p_reason));
 v_result:=jsonb_build_object('ok',true,'invoice_id',i.id,'lifecycle_event_id',e.id,'refund_id',v_id,'refund_amount',p_refund_amount,'cumulative_refund_amount',v_total,'remaining_refund_amount',coalesce(e.refund_payable_amount,e.total)-v_total,'voucher_id',v_no,'voucher_no',v_no,'idempotent_replay',false);
 update private.finance_ar_operations_v1 set response=v_result,writing_transaction=null where tenant_id=a.tenant_id and data_environment=v_env and actor_id=a.id and operation_key=p_idempotency_key;
 perform set_config('app.finance_ar_operation',v_old_op,true);perform set_config('app.finance_ar_actor',v_old_actor,true);
 return v_result;
end;
$f$;
create or replace function public.refund_invoice_receipt(p_lifecycle_event_id text,p_refund_amount numeric,p_reason text,p_refund_date date default current_date,p_bank_transaction_id text default null)
returns jsonb language plpgsql set search_path='' as $f$
begin raise exception '退款已更新為可分次且避免重複的流程，請重新載入頁面後使用新版退款；本次尚未入帳' using errcode='55000',detail='REFUND_IDEMPOTENCY_REQUIRED';end;
$f$;

create or replace function private.finance_receipt_guard_v1()
returns trigger language plpgsql security definer set search_path='' as $f$
begin
 if tg_op='DELETE' then
  if old.status in ('paid','pending_receipt_review','partial') or old.cash_receipt_posted_at is not null then
   raise exception '已有收款證明或入帳的發票不可刪除，請循更正／沖銷程序' using errcode='42501';
  end if;
  return old;
 end if;
 if tg_op='INSERT' then
  if new.status in ('paid','pending_receipt_review','partial') or new.paid_at is not null
   or coalesce(new.receipt_files,'[]'::jsonb)<>'[]'::jsonb or new.receipt_submitted_at is not null
   or nullif(new.receipt_submitted_by,'') is not null or nullif(new.receipt_note,'') is not null
   or new.receipt_reviewed_at is not null or nullif(new.receipt_reviewed_by,'') is not null
   or nullif(new.receipt_review_note,'') is not null or new.cash_receipt_posted_at is not null then
   raise exception '新發票必須由正常申請及收款覆核流程建立，不可預先標記收款' using errcode='42501';
  end if;
  return new;
 end if;
 if new.status is distinct from old.status and (new.status in ('paid','pending_receipt_review','partial') or old.status in ('pending_receipt_review','paid','partial'))
  or (old.status in ('paid','partial') and (new.steps is distinct from old.steps or new.approval_status is distinct from old.approval_status or new.approval_step is distinct from old.approval_step))
  or (old.status in ('pending_receipt_review','paid','partial') and (new.amount is distinct from old.amount
   or new.total is distinct from old.total or new.tax is distinct from old.tax or new.entity_id is distinct from old.entity_id
   or new.department_code is distinct from old.department_code or new.no is distinct from old.no or new.batch_id is distinct from old.batch_id))
  or new.paid_at is distinct from old.paid_at
  or new.receipt_files is distinct from old.receipt_files
  or new.receipt_submitted_at is distinct from old.receipt_submitted_at
  or new.receipt_submitted_by is distinct from old.receipt_submitted_by
  or new.receipt_note is distinct from old.receipt_note
  or new.receipt_reviewed_at is distinct from old.receipt_reviewed_at
  or new.receipt_reviewed_by is distinct from old.receipt_reviewed_by
  or new.receipt_review_note is distinct from old.receipt_review_note
  or new.cash_receipt_posted_at is distinct from old.cash_receipt_posted_at then
   if not private.finance_receipt_write_allowed_v1(new.tenant_id,new.data_environment,new.id) then
    raise exception '收款資料必須使用會計送證明／執行長覆核交易，請更新頁面後再處理' using errcode='42501',detail='RECEIPT_ATOMIC_ACTION_REQUIRED';
   end if;
 end if;
 return new;
end;
$f$;

create or replace function public.finance_executive_dashboard_v3(p_start date,p_end date,p_previous_start date,p_previous_end date,p_trend_start date,p_entity_id text default null,p_data_environment text default 'production')
returns jsonb language plpgsql stable security definer set search_path='' as $f$
declare a public.finance_users%rowtype;v_entity text:=nullif(nullif(btrim(coalesce(p_entity_id,'')),''),'all');v_environment text:=coalesce(nullif(btrim(p_data_environment),''),'production');
 v_payload jsonb;v_ar jsonb;v_prev_ar jsonb;v_summary jsonb;
begin
 a:=private.finance_correction_actor_v1();
 if coalesce(public.current_finance_role(),'') not in ('accountant','ceo','admin_director','external_audit','board') then raise exception 'finance dashboard access denied' using errcode='42501';end if;
 v_payload:=public.finance_executive_dashboard_v2(p_start,p_end,p_previous_start,p_previous_end,p_trend_start,v_entity,v_environment);
 select jsonb_build_object('revenue',coalesce(sum(case when left(l.account_code,1) in ('4','7') then l.credit-l.debit else 0 end),0),
 'expense',coalesce(sum(case when left(l.account_code,1) in ('5','6','9') then l.debit-l.credit else 0 end),0),
 'net',coalesce(sum(case when left(l.account_code,1) in ('4','7') then l.credit-l.debit when left(l.account_code,1) in ('5','6','9') then l.credit-l.debit else 0 end),0),
 'ledgerRows',count(*),'balanceDiff',coalesce(sum(l.debit-l.credit),0),
 'missingSourceCount',count(*) filter(where coalesce(nullif(l.reference_no,''),nullif(l.source_no,''),nullif(l.source_id,''),nullif(l.voucher_no,''),nullif(l.posting_key,'')) is null)) into v_summary
 from public.ledger_entries l where l.tenant_id=a.tenant_id and l.data_environment=v_environment and l.voided_at is null and (v_entity is null or l.entity_id=v_entity) and l.entry_date between p_start and p_end;
 v_ar:=private.finance_receivables_payload_v1(p_end,v_entity,null,v_environment,true);
 v_prev_ar:=private.finance_receivables_payload_v1(p_previous_end,v_entity,null,v_environment,true);
 v_payload:=jsonb_set(jsonb_set(v_payload,'{version}','3'),'{summary}',v_summary);
 v_payload:=jsonb_set(v_payload,'{receivables}',jsonb_build_object(
  'total',(v_ar->'summary'->>'outstandingAmount')::numeric,
  'count',(select count(*) from jsonb_array_elements(v_ar->'items') x where (x->>'outstandingAmount')::numeric>0),
  'overdueTotal',(v_ar->'summary'->>'overdueAmount')::numeric,'over90Total',(v_ar->'summary'->>'over90Amount')::numeric,
  'unknownDue',(select count(*) from jsonb_array_elements(v_ar->'items') x where x->>'agingBucket'='unknown'),
  'buckets',v_ar->'buckets','reconciliation',v_ar->'reconciliation','complete',true,
  'items',(select coalesce(jsonb_agg(x||jsonb_build_object('key',x->>'invoiceNo','balance',(x->>'outstandingAmount')::numeric,'due',x->'dueDate')),'[]')
   from jsonb_array_elements(v_ar->'items') x where (x->>'outstandingAmount')::numeric>0)),true);
 v_payload:=jsonb_set(v_payload,'{previousReceivables}',jsonb_build_object('total',(v_prev_ar->'summary'->>'outstandingAmount')::numeric,
  'count',(select count(*) from jsonb_array_elements(v_prev_ar->'items') x where (x->>'outstandingAmount')::numeric>0)),true);
 return v_payload;
end;
$f$;

revoke all on function private.finance_ar_ledger_v1(uuid,text,date,text),private.finance_ar_invoice_v1(public.invoices,date,jsonb),private.finance_receivables_payload_v1(date,text,text,text,boolean) from public,anon,authenticated,service_role;
revoke all on function public.finance_receivables_v1(date,text,text,text),public.finance_update_receivable_terms_v1(text,jsonb,bigint,text,text),public.finance_set_invoice_due_date_v1(text,date,bigint,text,text,text),public.finance_invoice_receipt_action_v2(text[],text,text,jsonb,text,jsonb,text,jsonb,date),public.refund_invoice_receipt_v2(text,numeric,text,date,text,text,numeric) from public,anon,service_role;
grant execute on function public.finance_receivables_v1(date,text,text,text),public.finance_update_receivable_terms_v1(text,jsonb,bigint,text,text),public.finance_set_invoice_due_date_v1(text,date,bigint,text,text,text),public.finance_invoice_receipt_action_v2(text[],text,text,jsonb,text,jsonb,text,jsonb,date),public.refund_invoice_receipt_v2(text,numeric,text,date,text,text,numeric) to authenticated;
revoke all on function public.refund_invoice_receipt(text,numeric,text,date,text) from public,anon,service_role;
grant execute on function public.refund_invoice_receipt(text,numeric,text,date,text) to authenticated;
notify pgrst,'reload schema';

revoke all on function private.finance_ar_bank_reconciliation_v1(uuid,text,date,text) from public,anon,authenticated,service_role;

-- Future lifecycle events may settle both unpaid receivable and a refund
-- payable. Null columns on historical events retain their original meaning.
create or replace function public.post_invoice_lifecycle_voucher(p_invoice_id text,p_event_type text,p_event_no text,p_reason text,p_amount numeric,p_tax numeric,p_total numeric,p_event_date date default current_date)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='5s' as $f$
declare a public.finance_users%rowtype;i public.invoices%rowtype;e public.invoice_lifecycle_events%rowtype;
 v_type text:=lower(coalesce(p_event_type,''));v_total numeric;v_tax numeric;v_net numeric;v_ar numeric;v_refund numeric;v_prior numeric;v_date date:=coalesce(p_event_date,current_date);
 v_old_op text:=coalesce(current_setting('app.finance_ar_operation',true),'');v_old_actor text:=coalesce(current_setting('app.finance_ar_actor',true),'');
 v_balance jsonb;v_entries jsonb;v_entry jsonb;v_no text;v_event_no text;v_event_id text;v_idx integer:=0;v_key text;v_result jsonb;
 v_prev_key text:=coalesce(current_setting('app.finance_receipt_operation',true),'');v_prev_actor text:=coalesce(current_setting('app.finance_receipt_actor',true),'');
begin
 a:=private.finance_correction_actor_v1();
 if not private.finance_correction_role_v1(a.tenant_id,a.id,null,array['accountant','admin_director','ceo']) then raise exception '僅有效財務管理人員可作廢或折讓' using errcode='42501';end if;
 select * into i from public.invoices where id=p_invoice_id and tenant_id=a.tenant_id for update;
 if not found or public.can_read_invoice(i) is distinct from true then raise exception '無權讀取原發票' using errcode='42501';end if;
 if v_type not in ('void','allowance') or length(btrim(coalesce(p_reason,''))) not between 1 and 2000 or v_date>(clock_timestamp() at time zone 'Asia/Taipei')::date or v_date<i.invoice_date then raise exception '折讓／作廢類型、日期或原因不正確' using errcode='22023';end if;
 v_total:=case when v_type='void' then coalesce(i.total,i.amount,0) else p_total end;
 v_tax:=case when v_type='void' then coalesce(i.tax,0) else coalesce(p_tax,0) end;
 v_net:=case when v_type='void' then v_total-v_tax else coalesce(p_amount,v_total-v_tax) end;
 if v_total is null or v_total<=0 or v_total::text in ('NaN','Infinity','-Infinity') or v_total<>round(v_total,2)
  or v_tax<0 or v_net<0 or v_tax<>round(v_tax,2) or v_net<>round(v_net,2) or v_net+v_tax<>v_total then raise exception '折讓含稅金額與未稅／稅額不一致' using errcode='23514';end if;
 v_event_no:=coalesce(nullif(p_event_no,''),upper(v_type)||'-'||i.no);
 if length(v_event_no)>200 then raise exception '事件號過長' using errcode='22023';end if;
 select * into e from public.invoice_lifecycle_events where tenant_id=a.tenant_id and data_environment=i.data_environment and event_no=v_event_no;
 if found then
  if e.invoice_id=i.id and e.event_type=v_type and e.total=v_total and e.tax=v_tax and e.amount=v_net and e.reason=p_reason and e.event_date=v_date and e.status in ('posted','refunded') then
   return jsonb_build_object('ok',true,'event_id',e.id,'event_no',e.event_no,'voucher_id',e.voucher_id,'voucher_no',e.voucher_no,'settlement_account_code',e.settlement_account_code,'total',e.total,'ar_amount',e.ar_amount,'refund_payable_amount',e.refund_payable_amount,'idempotent_replay',true);
  end if;
  raise exception '同一事件號不可重複用於不同內容' using errcode='23505';
 end if;
 if i.voided_at is not null or i.status in ('void','voided','cancelled','rejected') then raise exception '原發票已作廢或取消' using errcode='55000';end if;
 if exists(select 1 from private.finance_ar_receipts_v1 where tenant_id=a.tenant_id and data_environment=i.data_environment and invoice_id=i.id and status='pending') or i.status='pending_receipt_review' then raise exception '尚有收款待覆核，請先完成或退回後再折讓／作廢' using errcode='55000';end if;
 -- A backdated allocation must not use later cash receipts or rewrite their
 -- historical meaning. Existing later journals are immutable; reject instead.
 if exists(select 1 from private.finance_ar_ledger_v1(a.tenant_id,i.data_environment,(clock_timestamp() at time zone 'Asia/Taipei')::date,i.id) l where l.invoice_id=i.id and l.entry_date>v_date)
  or exists(select 1 from public.invoice_lifecycle_events later_event where later_event.tenant_id=a.tenant_id and later_event.data_environment=i.data_environment and later_event.invoice_id=i.id and later_event.status<>'voided' and later_event.event_date>v_date) then
  raise exception '此日期後已有收款或折讓／退款紀錄，請使用可核對的新日期，不可回溯改變既有帳務' using errcode='22023';
 end if;
 perform private.finance_assert_period_open(a.tenant_id,i.data_environment,i.entity_id,v_date,'發票作廢／折讓');
 v_result:=private.finance_receipt_revenue_ready_v1(i.id);
 if v_result->>'ok' is distinct from 'true' or coalesce((v_result->>'deferred')::boolean,false) then raise exception '原收入尚未完整入帳，不可建立沖銷' using errcode='23514';end if;
 select coalesce(sum(total),0) into v_prior from public.invoice_lifecycle_events where tenant_id=a.tenant_id and data_environment=i.data_environment and invoice_id=i.id and event_type in ('void','allowance') and status<>'voided';
 if v_prior+v_total>coalesce(i.total,i.amount,0) then raise exception '累計作廢／折讓不可超過原發票' using errcode='23514';end if;
 v_balance:=private.finance_ar_invoice_v1(i,(clock_timestamp() at time zone 'Asia/Taipei')::date);
 if (v_balance->>'outstandingAmount')::numeric<0 then raise exception '原應收已出現貸方餘額，請先核對原帳' using errcode='23514';end if;
 v_ar:=least(v_total,greatest(0,(v_balance->>'outstandingAmount')::numeric));v_refund:=v_total-v_ar;
 if v_refund>greatest(0,(v_balance->>'receivedAmount')::numeric-(select coalesce(sum(coalesce(refund_payable_amount,case when settlement_account_code='2131' then total else 0 end)),0) from public.invoice_lifecycle_events where tenant_id=a.tenant_id and data_environment=i.data_environment and invoice_id=i.id and event_type in ('void','allowance') and status<>'voided')) then raise exception '折讓退款金額超過已核對實收，請先核對原帳' using errcode='23514';end if;
 v_no:=public.next_voucher_no(case when v_type='void' then 'IVVOID' else 'IVALW' end,v_date,i.data_environment);
 v_event_id:='ile_'||md5(a.tenant_id::text||':'||i.data_environment||':'||v_event_no);
 v_key:='lifecycle:'||md5(v_event_id);
 insert into private.finance_ar_operations_v1(tenant_id,data_environment,actor_id,operation_key,operation_type,digest,invoice_id,source_id,writing_transaction) values(a.tenant_id,i.data_environment,a.id,v_key,'lifecycle',v_event_id,i.id,v_event_id,pg_current_xact_id()::text);
 perform set_config('app.finance_ar_operation',v_key,true);perform set_config('app.finance_ar_actor',a.id,true);
 v_entries:=jsonb_build_array(jsonb_build_object('t','dr','ac','4198','an','銷貨退回及折讓','dept',i.department_code,'amt',v_net));
 if v_tax>0 then v_entries:=v_entries||jsonb_build_array(jsonb_build_object('t','dr','ac','2134','an','銷項稅額','dept',i.department_code,'amt',v_tax));end if;
 if v_ar>0 then v_entries:=v_entries||jsonb_build_array(jsonb_build_object('t','cr','ac','1123','an','應收帳款','dept',i.department_code,'amt',v_ar));end if;
 if v_refund>0 then v_entries:=v_entries||jsonb_build_array(jsonb_build_object('t','cr','ac','2131','an','應付費用','dept',i.department_code,'amt',v_refund));end if;
 insert into public.vouchers(id,no,request_id,entity_id,entity_name,voucher_date,description,entries,total,creator,posted,posted_at,posting_locked_at,adjusts_voucher_no,adjustment_type,data_environment,tenant_id)
 values(v_no,v_no,i.id,i.entity_id,i.entity_name,v_date,'發票作廢／折讓 — '||i.no||' — '||p_reason,v_entries,v_total,a.name,true,clock_timestamp(),clock_timestamp(),i.no,'adjustment',i.data_environment,a.tenant_id);
 for v_entry in select value from jsonb_array_elements(v_entries) loop
  v_idx:=v_idx+1;
  insert into public.ledger_entries(entry_date,description,entity_id,department_code,debit,credit,account_code,account_name,reference_no,posting_key,source_type,source_id,source_no,voucher_no,data_environment,tenant_id)
  values(v_date,'發票作廢／折讓 — '||i.no,i.entity_id,i.department_code,case when v_entry->>'t'='dr' then (v_entry->>'amt')::numeric else 0 end,case when v_entry->>'t'='cr' then (v_entry->>'amt')::numeric else 0 end,v_entry->>'ac',v_entry->>'an',v_event_no,'tenant:'||a.tenant_id::text||':invoice_lifecycle:'||v_event_id||':'||v_idx,v_type||'_invoice',v_event_id,v_event_no,v_no,i.data_environment,a.tenant_id);
 end loop;
 insert into public.invoice_lifecycle_events(id,tenant_id,data_environment,invoice_id,invoice_no,event_type,event_no,event_date,reason,amount,tax,total,settlement_account_code,settlement_account_name,voucher_id,voucher_no,status,created_by,ar_amount,refund_payable_amount)
 values(v_event_id,a.tenant_id,i.data_environment,i.id,i.no,v_type,v_event_no,v_date,p_reason,v_net,v_tax,v_total,case when v_refund>0 then '2131' else '1123' end,case when v_refund>0 then '應付費用' else '應收帳款' end,v_no,v_no,'posted',a.name,v_ar,v_refund);
 if v_type='void' then
  -- Only this authorized lifecycle transaction may transition a paid source.
  v_key:='lifecycle:'||md5(v_event_id);
  insert into private.finance_receipt_operations_v1(tenant_id,data_environment,actor_id,operation_key,digest,invoice_ids,writing_transaction)
  values(a.tenant_id,i.data_environment,a.id,v_key,v_event_id,array[i.id],pg_current_xact_id()::text);
  perform set_config('app.finance_receipt_operation',v_key,true);perform set_config('app.finance_receipt_actor',a.id,true);
  update public.invoices set status='voided',voided_at=clock_timestamp() where id=i.id;
  update private.finance_receipt_operations_v1 set writing_transaction=null,response='{"ok":true}' where tenant_id=a.tenant_id and data_environment=i.data_environment and actor_id=a.id and operation_key=v_key;
  perform set_config('app.finance_receipt_operation',v_prev_key,true);perform set_config('app.finance_receipt_actor',v_prev_actor,true);
 end if;
 insert into private.finance_ar_audit_v1(tenant_id,data_environment,invoice_id,actor_id,action,operation_key,before_data,after_data)
 values(a.tenant_id,i.data_environment,i.id,a.id,v_type,v_event_no,v_balance,jsonb_build_object('eventId',v_event_id,'total',v_total,'arAmount',v_ar,'refundPayableAmount',v_refund,'reason',p_reason));
 update private.finance_ar_operations_v1 set response='{"ok":true}',writing_transaction=null where tenant_id=a.tenant_id and data_environment=i.data_environment and actor_id=a.id and operation_key=v_key;
 perform set_config('app.finance_ar_operation',v_old_op,true);perform set_config('app.finance_ar_actor',v_old_actor,true);
 return jsonb_build_object('ok',true,'event_id',v_event_id,'event_no',v_event_no,'voucher_id',v_no,'voucher_no',v_no,'settlement_account_code',case when v_refund>0 then '2131' else '1123' end,'total',v_total,'ar_amount',v_ar,'refund_payable_amount',v_refund,'idempotent_replay',false);
end;
$f$;
revoke all on function public.post_invoice_lifecycle_voucher(text,text,text,text,numeric,numeric,numeric,date) from public,anon,service_role;
grant execute on function public.post_invoice_lifecycle_voucher(text,text,text,text,numeric,numeric,numeric,date) to authenticated;

create trigger trg_finance_ar_lifecycle_guard_v1 before insert or update or delete on public.invoice_lifecycle_events for each row execute function private.finance_ar_lifecycle_guard_v1();
create trigger trg_finance_ar_ledger_guard_v1 before insert on public.ledger_entries for each row execute function private.finance_ar_ledger_guard_v1();
revoke all on function private.finance_ar_write_allowed_v1(uuid,text,text),private.finance_ar_lifecycle_guard_v1(),private.finance_ar_ledger_guard_v1() from public,anon,authenticated,service_role;
revoke all on function public.finance_executive_dashboard_v3(date,date,date,date,date,text,text) from public,anon,service_role;
grant execute on function public.finance_executive_dashboard_v3(date,date,date,date,date,text,text) to authenticated;
