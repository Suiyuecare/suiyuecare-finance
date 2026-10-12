-- Forward-only: no existing journals, reports or close states are changed.
set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- This is the same table used by finance_assert_period_open and its posting
-- guard. The retired accounting_period_close_records table is not authoritative.
create or replace function public.finance_period_close_health(
 p_entity_id text default null,p_period text default null,p_data_environment text default 'production'
) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare t uuid:=public.current_tenant_id(); expected_n bigint; record_n bigint; missing_n bigint; closed_n bigint; open_n bigint;
begin
 if auth.uid() is null or t is null or coalesce(public.current_finance_role(),'') not in('accountant','ceo','admin_director','external_audit','board') then raise exception '需要會計調閱權限才能檢查關帳狀態' using errcode='42501';end if;
 if p_data_environment is null or p_data_environment not in('production','test') or (p_period is not null and p_period!~'^[1-9][0-9]{3}-(0[1-9]|1[0-2])$') then raise exception '關帳檢查的環境或月份無效' using errcode='22023';end if;
 with expected as (
  select l.entity_id,to_char(l.entry_date,'YYYY-MM') period from public.ledger_entries l
   where l.tenant_id=t and coalesce(l.data_environment,'production')=p_data_environment and l.entry_date is not null
  union
  select v.entity_id,to_char(coalesce(v.voucher_date,v.created_at::date),'YYYY-MM') from public.vouchers v
   where v.tenant_id=t and coalesce(v.data_environment,'production')=p_data_environment and coalesce(v.voucher_date,v.created_at::date) is not null
 ), scoped as (
  select * from expected e where (p_entity_id is null or e.entity_id=p_entity_id) and(p_period is null or e.period=p_period)
 ), records as (
  select c.entity_id,c.period,bool_and(c.status='closed') closed from public.period_closes c
   where c.tenant_id=t and c.data_environment=p_data_environment and(p_entity_id is null or c.entity_id=p_entity_id) and(p_period is null or c.period=p_period)
   group by c.entity_id,c.period
 ) select count(*),count(r.entity_id),count(*) filter(where r.entity_id is null),count(*) filter(where r.closed is true),count(*) filter(where r.closed is false)
  into expected_n,record_n,missing_n,closed_n,open_n from scoped e left join records r on(r.entity_id,r.period)=(e.entity_id,e.period);
 return jsonb_build_object('ok',expected_n>0 and closed_n=expected_n,'status',case when expected_n=0 then 'no_activity' when missing_n>0 then 'missing_period_records' when open_n>0 then 'records_exist_pending_close' else 'closed' end,
  'source','period_closes','scope','visible_authorized_records','data_environment',p_data_environment,'entity_id',p_entity_id,'period',p_period,
  'expected_period_count',expected_n,'period_record_count',record_n,'missing_record_count',missing_n,'closed_count',closed_n,'open_pending_close_count',open_n);
end $$;
revoke all on function public.finance_period_close_health(text,text,text) from public,anon,service_role;
grant execute on function public.finance_period_close_health(text,text,text) to authenticated;

create table private.finance_month_snapshots_v1(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,entity_id text not null,
 data_environment text not null check(data_environment in('production','test')),period text not null check(period~'^[1-9][0-9]{3}-(0[1-9]|1[0-2])$'),
 revision bigint not null check(revision>0),source_fingerprint text not null,source_data jsonb not null,
 operation_id uuid not null,request_hash text not null,prepared_by text not null,prepared_auth_id uuid not null,
 reason text not null check(length(btrim(reason)) between 1 and 2000),prepared_at timestamptz not null default clock_timestamp(),
 unique(tenant_id,data_environment,entity_id,period,revision),unique(tenant_id,operation_id)
);
create table private.finance_month_snapshot_reviews_v1(
 snapshot_id uuid primary key references private.finance_month_snapshots_v1(id),reviewed_by text not null,reviewed_auth_id uuid not null,
 reason text not null check(length(btrim(reason)) between 1 and 2000),reviewed_at timestamptz not null default clock_timestamp()
);
alter table private.finance_month_snapshots_v1 enable row level security;
alter table private.finance_month_snapshot_reviews_v1 enable row level security;
revoke all on private.finance_month_snapshots_v1,private.finance_month_snapshot_reviews_v1 from public,anon,authenticated,service_role;
create function private.finance_month_immutable_v1() returns trigger language plpgsql set search_path='' as $$
begin raise exception '月結快照與覆核紀錄不可改寫或刪除，請建立新版本' using errcode='23514';end $$;
create trigger finance_month_snapshot_immutable_v1 before update or delete on private.finance_month_snapshots_v1 for each row execute function private.finance_month_immutable_v1();
create trigger finance_month_review_immutable_v1 before update or delete on private.finance_month_snapshot_reviews_v1 for each row execute function private.finance_month_immutable_v1();

-- Source is built in one statement snapshot. Complete-company and HR authority
-- are checked before any totals are exposed. No client-supplied report is trusted.
create function private.finance_month_source_v1(e text,p text,env text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare a jsonb; t uuid; baseline jsonb; start_date date; end_date date; profile jsonb; profile_revision bigint;
 ledger jsonb; totals jsonb; bank jsonb; close_rows jsonb; archives jsonb; payroll jsonb; payroll_authority jsonb; checks jsonb; source jsonb;
 bank_digest text; payroll_digest text; pending_private boolean; n bigint; dr numeric; cr numeric;
begin
 a:=private.finance_reporting_actor_v1(e,env);t:=(a->>'tenantId')::uuid;
 -- Do not widen board/auditor bank or payroll access through the new workspace.
 if public.current_finance_role() not in('accountant','ceo','admin_director') then raise exception '月結作業需會計作業權限' using errcode='42501';end if;
 if p is null or p!~'^[1-9][0-9]{3}-(0[1-9]|1[0-2])$' then raise exception '月結月份須為 YYYY-MM' using errcode='22023';end if;
 baseline:=private.finance_audit_source_v1(t,e,env);
 perform finance_hr_private.finance_hr_accounting_scope(t,e,env);
 start_date:=to_date(p||'-01','YYYY-MM-DD');end_date:=(start_date+interval '1 month')::date;
 select r.profile,r.revision into profile,profile_revision from public.finance_reporting_profiles r where r.tenant_id=t and r.entity_id=e and r.data_environment=env;
 checks:=coalesce(profile->'periodChecks'->p,'{}');
 -- Cumulative posted ledger supports balance-sheet reconstruction; month totals
 -- are separate. Source hashes also cover future/voided source changes.
 select coalesce(jsonb_agg(to_jsonb(l) order by l.entry_date,l.id),'[]') into ledger from public.ledger_entries l
  where l.tenant_id=t and l.entity_id=e and coalesce(l.data_environment,'production')=env and l.voided_at is null and l.entry_date<end_date;
 select count(*),coalesce(sum(l.debit),0),coalesce(sum(l.credit),0) into n,dr,cr from public.ledger_entries l
  where l.tenant_id=t and l.entity_id=e and coalesce(l.data_environment,'production')=env and l.voided_at is null and l.entry_date>=start_date and l.entry_date<end_date;
 select coalesce(jsonb_agg(to_jsonb(q) order by q.account_code),'[]') into totals from(
  select l.account_code,sum(coalesce(l.debit,0)) debit,sum(coalesce(l.credit,0)) credit from public.ledger_entries l
  where l.tenant_id=t and l.entity_id=e and coalesce(l.data_environment,'production')=env and l.voided_at is null and l.entry_date>=start_date and l.entry_date<end_date group by l.account_code) q;
 with tx as materialized(
  select b.*,greatest(0,abs(coalesce(b.amount,0))-coalesce((select sum(abs(m.matched_amount)) from public.bank_reconciliation_matches m where m.tenant_id=t and m.data_environment=env and m.bank_transaction_id=b.id),0)) remaining
  from public.bank_transactions b where b.tenant_id=t and b.entity_id=e and b.data_environment=env and b.transaction_date>=start_date and b.transaction_date<end_date
 ), imports as materialized(select i.* from public.bank_statement_imports i where i.tenant_id=t and i.entity_id=e and i.data_environment=env and i.statement_period=p)
 select jsonb_build_object('transactionCount',(select count(*) from tx),'importCount',(select count(*) from imports),
   'unmatchedCount',(select count(*) from tx where remaining>=0.005),'unmatchedAmount',(select coalesce(sum(remaining),0) from tx),
   'ignoredCount',(select count(*) from tx where match_status='ignored'),
   'status',case when not exists(select 1 from imports) then 'no_import_record' when exists(select 1 from tx where remaining>=0.005) then 'needs_reconciliation' when not exists(select 1 from tx) then 'empty_statement_requires_review' else 'matched_records' end),
  encode(sha256(convert_to(jsonb_build_object('transactions',(select coalesce(jsonb_agg(to_jsonb(tx) order by id),'[]') from tx),
   'matches',(select coalesce(jsonb_agg(to_jsonb(m) order by m.id),'[]') from public.bank_reconciliation_matches m join tx on tx.id=m.bank_transaction_id where m.tenant_id=t and m.data_environment=env),
   'imports',(select coalesce(jsonb_agg(to_jsonb(imports) order by id),'[]') from imports))::text,'UTF8')),'hex') into bank,bank_digest;
 select coalesce(jsonb_agg(to_jsonb(c) order by c.id),'[]') into close_rows from public.period_closes c where c.tenant_id=t and c.entity_id=e and c.data_environment=env and c.period=p;
 if env='production' then
  select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'createdAt',d.created_at,'manifest',d.manifest,'verifications',coalesce((select jsonb_agg(to_jsonb(v) order by v.verified_at,v.id) from private.finance_archive_verifications_v1 v where v.archive_id=d.id),'[]')) order by d.created_at,d.id),'[]') into archives
   from public.finance_document_archives_v1 d where d.tenant_id=t and d.entity_id=e and d.period=p;
  select exists(select 1 from private.finance_payroll_accruals_v1 r join finance_hr_private.finance_hr_obligations o on o.obligation_id=r.obligation_id
   where r.tenant_id=t and r.entity_id=e and r.period=p and finance_hr_private.finance_hr_reader(o.tenant_id,o.source_employer_id,a->>'actorId') is distinct from true) into pending_private;
  if pending_private then
   -- Even an existence/count of private pending salary items is not disclosed.
   payroll:='{"status":"requires_private_review"}';payroll_digest:='restricted';
  else
   select jsonb_build_object('status',case when count(*)=0 then 'no_accrual_record' when count(*) filter(where r.status<>'posted')>0 then 'pending_review' else 'posted_records' end,
    'recordCount',count(*),'postedCount',count(*) filter(where r.status='posted')),
    encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]')::text,'UTF8')),'hex') into payroll,payroll_digest
    from private.finance_payroll_accruals_v1 r where r.tenant_id=t and r.entity_id=e and r.period=p;
  end if;
  -- Retain the original salary authority dimensions, so subsequent deletion of
  -- source records cannot let a revoked reader access historical salary ledger.
  select coalesce(jsonb_agg(x.source_employer_id order by x.source_employer_id),'[]') into payroll_authority from(
   select o.source_employer_id from finance_hr_private.finance_hr_postings hp join finance_hr_private.finance_hr_obligations o using(obligation_id) where hp.tenant_id=t and hp.entity_id=e
   union select o.source_employer_id from private.finance_payroll_accruals_v1 r join finance_hr_private.finance_hr_obligations o on o.obligation_id=r.obligation_id where r.tenant_id=t and r.entity_id=e and (r.status='posted' or r.period=p)
  ) x;
 else archives:='[]';payroll:='{"status":"not_applicable_test_environment"}';payroll_digest:='test';payroll_authority:='[]';end if;
 source:=jsonb_build_object('schemaVersion',1,'tenantId',t,'entityId',e,'period',p,'environment',env,
  'baselineFingerprint',baseline->'fingerprint','profile',profile,'profileRevision',profile_revision,'periodChecks',checks,
  'ledger',ledger,'accountTotals',totals,'ledgerSummary',jsonb_build_object('count',n,'debit',dr,'credit',cr,'balanced',abs(dr-cr)<0.005),
  'bank',bank,'bankFingerprint',bank_digest,'periodCloses',close_rows,'archives',archives,'payroll',payroll,'payrollFingerprint',payroll_digest,'payrollAuthority',payroll_authority,
  'reportStatus','internal_source_snapshot');
 if octet_length(source::text)>16777216 then raise exception '月結來源超過16MB，請聯絡管理員安排分批封存' using errcode='54000';end if;
 return source||jsonb_build_object('sourceFingerprint',encode(sha256(convert_to(source::text,'UTF8')),'hex'));
end $$;

create function public.finance_month_workspace_v1(p_entity_id text,p_period text,p_data_environment text default 'production') returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare s jsonb; a jsonb; latest jsonb;
begin
 s:=private.finance_month_source_v1(p_entity_id,p_period,p_data_environment);a:=private.finance_reporting_actor_v1(p_entity_id,p_data_environment);
 select jsonb_build_object('id',r.id,'revision',r.revision,'sourceFingerprint',r.source_fingerprint,'preparedBy',r.prepared_by,'preparedAt',r.prepared_at,'reason',r.reason,
  'reviewedBy',v.reviewed_by,'reviewedAt',v.reviewed_at,'reviewReason',v.reason,'isCurrent',r.source_fingerprint=s->>'sourceFingerprint',
  'canReview',(a->>'canEditWorkpaper')::boolean and r.prepared_auth_id<>auth.uid() and r.prepared_by<>a->>'actorId' and v.snapshot_id is null and r.source_fingerprint=s->>'sourceFingerprint') into latest
 from private.finance_month_snapshots_v1 r left join private.finance_month_snapshot_reviews_v1 v on v.snapshot_id=r.id
 where r.tenant_id=(a->>'tenantId')::uuid and r.entity_id=p_entity_id and r.data_environment=p_data_environment and r.period=p_period order by r.revision desc limit 1;
 return (s-'ledger'-'profile'-'archives'-'payrollFingerprint'-'bankFingerprint'-'baselineFingerprint'-'payrollAuthority'-'assetRegister'-'assetPlans')||jsonb_build_object(
  'profileConfigured',s->'profile' is not null and s->'profile'<>'null'::jsonb and s#>>'{profile,accountingFramework}' in('eas','ifrs'),
  'archiveCount',jsonb_array_length(s->'archives'),'verifiedArchiveCount',(select count(*) from jsonb_array_elements(s->'archives') x where jsonb_array_length(x->'verifications')>0),
  'latestSnapshot',latest,'canPrepare',(a->>'canEditWorkpaper')::boolean);
end $$;

create function public.finance_month_snapshot_prepare_v1(p_entity_id text,p_period text,p_expected_revision bigint,p_expected_fingerprint text,p_operation_id uuid,p_reason text,p_data_environment text default 'production') returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare a jsonb; s jsonb; t uuid; rev bigint; reqhash text; r private.finance_month_snapshots_v1;
begin
 a:=private.finance_reporting_actor_v1(p_entity_id,p_data_environment);t:=(a->>'tenantId')::uuid;
 if coalesce((a->>'canEditWorkpaper')::boolean,false) is not true then raise exception '未授權建立月結快照' using errcode='42501';end if;
 if p_operation_id is null or p_expected_revision is null or p_expected_revision<0 or length(coalesce(btrim(p_reason),'')) not between 1 and 2000 then raise exception '需填寫快照原因、版本及操作識別碼' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('finance_month_operation|'||t::text||'|'||p_operation_id::text,0));
 perform pg_advisory_xact_lock(hashtextextended('finance_month|'||t::text||'|'||p_data_environment||'|'||p_entity_id||'|'||p_period,0));
 reqhash:=encode(sha256(convert_to(jsonb_build_array(p_entity_id,p_period,p_data_environment,p_expected_revision,p_expected_fingerprint,p_reason,a->>'actorId',auth.uid())::text,'UTF8')),'hex');
 s:=private.finance_month_source_v1(p_entity_id,p_period,p_data_environment);
 select * into r from private.finance_month_snapshots_v1 where tenant_id=t and operation_id=p_operation_id;
 if found then
  if r.request_hash is distinct from reqhash then raise exception '操作識別碼不能用於不同快照' using errcode='23514';end if;
  return jsonb_build_object('id',r.id,'revision',r.revision,'replayed',true,'sourceFingerprint',r.source_fingerprint);
 end if;
 select coalesce(max(revision),0) into rev from private.finance_month_snapshots_v1 where tenant_id=t and entity_id=p_entity_id and data_environment=p_data_environment and period=p_period;
 if rev<>p_expected_revision or s->>'sourceFingerprint' is distinct from p_expected_fingerprint then raise exception '月結來源或快照版本已更新，請重新載入再建立' using errcode='40001';end if;
 if s#>>'{payroll,status}'='requires_private_review' then raise exception '請取得完整薪資調閱權限後建立月結快照' using errcode='42501';end if;
 insert into private.finance_month_snapshots_v1(tenant_id,entity_id,data_environment,period,revision,source_fingerprint,source_data,operation_id,request_hash,prepared_by,prepared_auth_id,reason)
  values(t,p_entity_id,p_data_environment,p_period,rev+1,p_expected_fingerprint,s,p_operation_id,reqhash,a->>'actorId',auth.uid(),p_reason) returning * into r;
 return jsonb_build_object('id',r.id,'revision',r.revision,'replayed',false,'sourceFingerprint',r.source_fingerprint);
end $$;

create function public.finance_month_snapshot_read_v1(p_snapshot_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare r private.finance_month_snapshots_v1; a jsonb; s jsonb; v jsonb; d text;
begin
 select * into r from private.finance_month_snapshots_v1 where id=p_snapshot_id and tenant_id=public.current_tenant_id();
 if not found then raise exception '月結快照不存在或無權調閱' using errcode='42501';end if;
 a:=private.finance_reporting_actor_v1(r.entity_id,r.data_environment);s:=private.finance_month_source_v1(r.entity_id,r.period,r.data_environment);
 -- Historical departments remain protected even if their current rows were deleted.
 for d in select distinct x->>'department_code' from jsonb_array_elements(r.source_data->'ledger') x loop
  if private.finance_expense_optional_permission_allows(r.tenant_id,a->>'actorId','finance.request.view.all',jsonb_build_object('entity_id',r.entity_id,'entityId',r.entity_id,'legal_entity_code',r.entity_id,'department_code',d,'departmentCode',d,'data_environment',r.data_environment)) is distinct from true then raise exception '月結快照含有未授權部門' using errcode='42501';end if;
 end loop;
 for d in select distinct x#>>'{data,departmentCode}' from jsonb_array_elements(coalesce(r.source_data->'assetRegister','[]')) x loop
  if private.finance_expense_optional_permission_allows(r.tenant_id,a->>'actorId','finance.request.view.all',jsonb_build_object('entity_id',r.entity_id,'entityId',r.entity_id,'legal_entity_code',r.entity_id,'department_code',d,'departmentCode',d,'data_environment',r.data_environment)) is distinct from true then raise exception '月結快照含有未授權資產部門' using errcode='42501';end if;
 end loop;
 if s#>>'{payroll,status}'='requires_private_review' or exists(select 1 from jsonb_array_elements_text(coalesce(r.source_data->'payrollAuthority','[]')) x(employer) where finance_hr_private.finance_hr_reader(r.tenant_id,x.employer::uuid,a->>'actorId') is distinct from true) then raise exception '月結快照需完整薪資調閱權限' using errcode='42501';end if;
 select jsonb_build_object('reviewedBy',reviewed_by,'reviewedAt',reviewed_at,'reason',reason) into v from private.finance_month_snapshot_reviews_v1 where snapshot_id=r.id;
 return jsonb_build_object('id',r.id,'revision',r.revision,'source',r.source_data,'preparedBy',r.prepared_by,'preparedAt',r.prepared_at,'reason',r.reason,'review',v,'isCurrent',r.source_fingerprint=s->>'sourceFingerprint','reportStatus','internal_source_snapshot');
end $$;

create function public.finance_month_snapshot_review_v1(p_snapshot_id uuid,p_expected_fingerprint text,p_reason text) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare r private.finance_month_snapshots_v1;a jsonb;s jsonb;v private.finance_month_snapshot_reviews_v1;rev bigint;
begin
 select * into r from private.finance_month_snapshots_v1 where id=p_snapshot_id and tenant_id=public.current_tenant_id();
 if not found then raise exception '月結快照不存在或無權覆核' using errcode='42501';end if;
 a:=private.finance_reporting_actor_v1(r.entity_id,r.data_environment);
 if coalesce((a->>'canEditWorkpaper')::boolean,false) is not true or r.prepared_by=a->>'actorId' or r.prepared_auth_id=auth.uid() then raise exception '月結覆核須由不同的授權人員執行' using errcode='42501';end if;
 if length(coalesce(btrim(p_reason),'')) not between 1 and 2000 then raise exception '請填寫月結覆核說明' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('finance_month|'||r.tenant_id::text||'|'||r.data_environment||'|'||r.entity_id||'|'||r.period,0));
 s:=public.finance_month_snapshot_read_v1(r.id);
 select max(revision) into rev from private.finance_month_snapshots_v1 where tenant_id=r.tenant_id and entity_id=r.entity_id and data_environment=r.data_environment and period=r.period;
 if r.revision<>rev or s->>'isCurrent'<>'true' or r.source_fingerprint is distinct from p_expected_fingerprint then raise exception '月結來源已變動或不是最新快照，請重新建立後覆核' using errcode='40001';end if;
 select * into v from private.finance_month_snapshot_reviews_v1 where snapshot_id=r.id;
 if found then
  if v.reviewed_auth_id<>auth.uid() or v.reason is distinct from p_reason then raise exception '此快照已覆核，不能改寫' using errcode='23514';end if;
 else insert into private.finance_month_snapshot_reviews_v1(snapshot_id,reviewed_by,reviewed_auth_id,reason) values(r.id,a->>'actorId',auth.uid(),p_reason);end if;
 return public.finance_month_snapshot_read_v1(r.id);
end $$;

revoke all on function private.finance_month_immutable_v1(),private.finance_month_source_v1(text,text,text) from public,anon,authenticated,service_role;
revoke all on function public.finance_month_workspace_v1(text,text,text),public.finance_month_snapshot_prepare_v1(text,text,bigint,text,uuid,text,text),public.finance_month_snapshot_read_v1(uuid),public.finance_month_snapshot_review_v1(uuid,text,text) from public,anon,service_role;
grant execute on function public.finance_month_workspace_v1(text,text,text),public.finance_month_snapshot_prepare_v1(text,text,bigint,text,uuid,text,text),public.finance_month_snapshot_read_v1(uuid),public.finance_month_snapshot_review_v1(uuid,text,text) to authenticated;
