-- Read-only authoritative monthly sources and append-only download receipts.
-- A download receipt is not an archive, tax filing, or database backup.
set local lock_timeout='5s';
set local statement_timeout='120s';

create table private.finance_monthly_delivery_receipts_v1 (
 id uuid primary key, tenant_id uuid not null, data_environment text not null,
 entity_id text not null, period text not null, actor_id text not null,
 source_fingerprint text not null, manifest jsonb not null, manifest_sha256 text not null,
 created_at timestamptz not null default clock_timestamp(),
 check(data_environment in ('production','test')),
 check(period ~ '^[1-9][0-9]{3}-(0[1-9]|1[0-2])$'),
 check(source_fingerprint ~ '^[a-f0-9]{64}$' and manifest_sha256 ~ '^[a-f0-9]{64}$')
);
alter table private.finance_monthly_delivery_receipts_v1 enable row level security;
alter table private.finance_monthly_delivery_receipts_v1 force row level security;
revoke all on private.finance_monthly_delivery_receipts_v1 from public,anon,authenticated,service_role;


-- Build required labor artifacts from the same paginated, authorized sources as
-- the existing labor export. Neither client counts nor missing=[] are authority.
create function private.finance_monthly_labor_requirements_v1(e text,p text,env text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare d date:=(p||'-01')::date; until_date date:=(d+interval '1 month')::date;
 observed timestamptz:=statement_timestamp(); data jsonb; cursor_value jsonb; items jsonb; all_rows jsonb:='[]';
 requirements jsonb:='[]'; missing jsonb:='[]'; item jsonb; signed_row jsonb; sid text;k text;prefix text;
begin
 if env='test' then return jsonb_build_object('requiredFiles','[]'::jsonb,'missing','[]'::jsonb,'fingerprint',repeat('0',64));end if;
 foreach k in array array['payments','planned','uninvited'] loop
  cursor_value:=null;items:='[]';
  loop
   if k='payments' then data:=private.finance_labor_export_page_v1(e,d,until_date,100,cursor_value,observed);
   elsif k='planned' then data:=private.finance_labor_month_roster_v1(e,d,until_date,100,(cursor_value#>>'{}')::uuid,observed);
   else data:=private.finance_labor_uninvited_roster_v1(e,d,until_date,100,cursor_value#>>'{}',observed);end if;
   items:=items||(data->'items');cursor_value:=nullif(data->'nextCursor','null'::jsonb);
   if jsonb_array_length(items)>25000 then raise exception '月交勞報來源超過安全上限' using errcode='54000';end if;
   exit when cursor_value is null;
  end loop;
  all_rows:=all_rows||jsonb_build_array(jsonb_build_object('kind',k,'items',items));
  for item in select value from jsonb_array_elements(items) loop
   if nullif(item->>'incompleteReason','') is not null then missing:=missing||jsonb_build_array(jsonb_build_object('category','labor','sourceId',coalesce(item->>'statementId',item->>'requestId'),'reason',item->>'incompleteReason'));end if;
   if k='payments' then
    prefix:='labor/payment_evidence/'||(item->>'paymentId')||'.';
    if coalesce(item->'paymentEvidence'->>'bankStatementSha256','') !~ '^[a-f0-9]{64}$' then missing:=missing||jsonb_build_array(jsonb_build_object('category','labor','sourceId',item->>'paymentId','reason','missing_bank_statement_hash'));
    else requirements:=requirements||jsonb_build_array(jsonb_build_object('prefix',prefix,'sha256',item->'paymentEvidence'->>'bankStatementSha256'));end if;
   end if;
  end loop;
 end loop;
 for sid in select distinct x->>'statementId' from jsonb_array_elements(all_rows) b cross join lateral jsonb_array_elements(b->'items') x
  where x->>'statementId' is not null and (b->>'kind'='payments' or (b->>'kind'='planned' and x->>'status' in('signed','reviewed','accrued','partially_paid','paid'))) loop
  select jsonb_build_object('hash',s.snapshot_hash,'archiveHash',s.archive_hash,'snapshot',s.snapshot_text::jsonb) into signed_row
   from private.finance_labor_statements_v1 s where s.id::text=sid and s.entity_id=e and s.tenant_id=(public.current_finance_user()).tenant_id;
  if signed_row->>'hash' is null or signed_row->>'hash' is distinct from signed_row->>'archiveHash' then
   missing:=missing||jsonb_build_array(jsonb_build_object('category','labor','sourceId',sid,'reason','signed_archive_not_verified'));continue;end if;
  requirements:=requirements||jsonb_build_array(jsonb_build_object('path','labor/signed/'||sid||'.json','sha256',signed_row->>'hash'),jsonb_build_object('path','labor/forms/'||sid||'.pdf'));
  foreach k in array array['signature','identityFront','identityBack','bankProof'] loop
   if coalesce(signed_row->'snapshot'->'uploads'->k->>'sha256','') !~ '^[a-f0-9]{64}$' then
    missing:=missing||jsonb_build_array(jsonb_build_object('category','labor','sourceId',sid,'reason','missing_'||k||'_hash'));continue;end if;
   if k='signature' then requirements:=requirements||jsonb_build_array(jsonb_build_object('path','labor/signatures/'||sid||'.png','sha256',signed_row->'snapshot'->'uploads'->k->>'sha256'));
   else prefix:='labor/private_proofs/'||sid||'/'||case k when 'identityFront' then 'identity_front' when 'identityBack' then 'identity_back' else 'bank_proof' end||'.';
    requirements:=requirements||jsonb_build_array(jsonb_build_object('prefix',prefix,'sha256',signed_row->'snapshot'->'uploads'->k->>'sha256'));end if;
  end loop;
 end loop;
 return jsonb_build_object('requiredFiles',requirements,'missing',missing,'fingerprint',encode(sha256(convert_to((all_rows||jsonb_build_array(requirements,missing))::text,'UTF8')),'hex'));
end $$;
revoke all on function private.finance_monthly_labor_requirements_v1(text,text,text) from public,anon,authenticated,service_role;

-- Recursive walk also detects legacy name-only attachment arrays. URL-only
-- references remain missing until indexed and authorized; no arbitrary fetch.
create function private.finance_monthly_file_refs_v1(v jsonb,in_files boolean default false)
 returns table(path text,unresolved boolean) language plpgsql immutable set search_path='' as $$
declare key text;child jsonb;ref text;
begin
 if jsonb_typeof(v)='array' then
  for child in select value from jsonb_array_elements(v) loop return query select * from private.finance_monthly_file_refs_v1(child,in_files);end loop;
 elsif jsonb_typeof(v)='object' then
  ref:=coalesce(nullif(v->>'storage_path',''),nullif(v->>'storagePath',''),nullif(v->>'path',''));
  if ref is not null then path:=ref;unresolved:=ref ~ '^(https?:|blob:|data:)';return next;
  elsif (in_files or v?'url') and (v?'name' or v?'n' or v?'file_name') then path:=null;unresolved:=true;return next;end if;
  for key,child in select * from jsonb_each(v) loop
   if jsonb_typeof(child) in('array','object') then return query select * from private.finance_monthly_file_refs_v1(child,key ~* '(files?|attachments?|receipts?|evidence|proofs?)$');end if;
  end loop;
 end if;
end $$;
revoke all on function private.finance_monthly_file_refs_v1(jsonb,boolean) from public,anon,authenticated,service_role;

-- Report source documents are month-scoped for delivery, but cash-flow
-- classification must cover every exported ledger row, including comparison
-- periods and the receiving side of a company loan. Return only classifications
-- keyed by the already-authorized ledger reference, never another company's
-- source request, name, bank information, or document contents.
create function private.finance_monthly_cash_evidence_v1(t uuid,e text,p text,env text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare d date:=(p||'-01')::date; lo text:=(d-interval '1 month')::date::text; hi text:=(d+interval '1 month')::date::text;
 overrides jsonb:='{}'; events jsonb:='[]'; r record; raw jsonb;fp jsonb;event jsonb; original jsonb; posted text;dt text;voucher text;event_id text;amount jsonb;kind text;matches integer;
begin
 -- A unique, immutable ledger linkage is necessary. A repeated reference with
 -- different source requests must not silently select an arbitrary loan type.
 for r in
  with links as (
   select distinct l.reference_no ref,qsrc.id,
    case when coalesce(qsrc.form_payload->'shareholderTxn'->>'eid',qsrc.entity_id)=e
     then case when qsrc.form_payload->'shareholderTxn'->>'type' in('company_loan_repay','intercompany_loan_repay','intercompany_repay') then 'financing' else 'investing' end
     else case when qsrc.form_payload->'shareholderTxn'->>'type' in('company_loan_repay','intercompany_loan_repay','intercompany_repay') then 'investing' else 'financing' end end cash_class
   from public.ledger_entries l join public.expense_requests qsrc on qsrc.tenant_id=l.tenant_id
    and coalesce(qsrc.data_environment,'production')=coalesce(l.data_environment,'production')
    and (l.source_id=qsrc.id or (nullif(l.source_id,'') is null and l.reference_no=qsrc.no))
   where l.tenant_id=t and l.entity_id=e and coalesce(l.data_environment,'production')=env and l.entry_date<hi::date
    and nullif(l.reference_no,'') is not null and l.voided_at is null
    and qsrc.form_payload->'shareholderTxn'->>'type' in('company_loan_out','company_loan_repay','intercompany_loan_out','intercompany_loan_repay','intercompany_loan','intercompany_repay')
    and (coalesce(qsrc.form_payload->'shareholderTxn'->>'eid',qsrc.entity_id)=e or qsrc.form_payload->'shareholderTxn'->>'targetEid'=e)
  ) select ref,min(cash_class) cash_class,count(*) n from links group by ref order by ref
 loop
  if r.n<>1 then raise exception '月交公司借貸來源無法唯一核對' using errcode='22023';end if;
  overrides:=overrides||jsonb_build_object(e||'|'||r.ref,r.cash_class);
 end loop;
 -- Minimal same-company events cover both the current and comparison month,
 -- including requests originating earlier and cash movements with no ledger
 -- yet. No amount is filled from estimates or mutable fee configuration.
 for r in select q.*,public.can_read_expense_request(q) may_read from public.expense_requests q
  where q.tenant_id=t and q.entity_id=e and coalesce(q.data_environment,'production')=env
   and coalesce(q.cash_posted_at::text,q.form_payload->>'cashPostedAt','')<>''
  order by q.id
 loop
  raw:=to_jsonb(r);fp:=coalesce(r.form_payload,'{}');posted:=coalesce(raw->>'cash_posted_at',fp->>'cashPostedAt');kind:=case when coalesce(raw->>'debit_account','')~'^(15|16)' then 'inv' else 'op' end;
  voucher:=case when raw->>'type'='advance_request' then coalesce(fp->>'advanceDisbursementVoucherId','') else coalesce(raw->>'voucher_id','') end;
  dt:=replace(left(posted,10),'/','-');
  if dt!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or (dt>=lo and dt<hi) then
   if r.may_read is distinct from true then raise exception '月交現金事件來源未取得完整調閱權限' using errcode='42501';end if;
   amount:=case when coalesce(fp->>'cashAmount','')~'^-?[0-9]+([.][0-9]+)?$' then to_jsonb(-(fp->>'cashAmount')::numeric) else 'null'::jsonb end;
   events:=events||jsonb_build_array(jsonb_build_object('eventId','expense:'||r.id||':disbursement','eventType','disbursement','eid',e,'dc',raw->>'department_code','sourceId',r.id,'sourceTypes',jsonb_build_array(case when raw->>'type'='advance_request' then 'advance_disbursement' else 'expense_request' end),'voucherNo',voucher,'date',dt,'amount',amount,'kind',kind,'ref',r.no));
  end if;
  if jsonb_typeof(fp->'correctionCashEvents')='array' then
   for original in select value from jsonb_array_elements(fp->'correctionCashEvents') loop
    dt:=replace(left(original->>'date',10),'/','-');
    if dt is null or dt!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or (dt>=lo and dt<hi) then
     if r.may_read is distinct from true then raise exception '月交現金事件來源未取得完整調閱權限' using errcode='42501';end if;
     select count(*) into matches from jsonb_array_elements(fp->'correctionCashEvents') x where x->>'correctionId'=original->>'correctionId' and replace(left(x->>'date',10),'/','-')=dt and x->'amount'=original->'amount';
     event_id:=case when matches=1 and nullif(original->>'correctionId','') is not null and nullif(original->>'bankTransactionId','') is not null then 'expense:'||r.id||':correction:'||(original->>'correctionId')||':'||(original->>'bankTransactionId') else '' end;
     events:=events||jsonb_build_array(jsonb_build_object('eventId',event_id,'eventType','correction','eid',e,'dc',raw->>'department_code','sourceId',r.id,'sourceTypes',jsonb_build_array('expense_request'),'voucherNo',coalesce(raw->>'voucher_id',''),'date',dt,'amount',original->'amount','kind',kind,'ref',r.no,'correctionId',original->>'correctionId','bankTransactionId',case when matches=1 then original->>'bankTransactionId' else '' end));
    end if;
   end loop;
  end if;
  if raw->>'type'='advance_request' and fp->>'advanceSettlementConfirmed'='true' and nullif(fp->>'advanceFinalSettledAt','') is not null and coalesce(fp->>'advanceSettlementDifference','')~'^-?[0-9]+([.][0-9]+)?$' and (case when coalesce(fp->>'advanceSettlementDifference','')~'^-?[0-9]+([.][0-9]+)?$' then (fp->>'advanceSettlementDifference')::numeric<>0 else false end) then
   dt:=replace(left(fp->>'advanceFinalSettledAt',10),'/','-');
   if dt!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or (dt>=lo and dt<hi) then
    if r.may_read is distinct from true then raise exception '月交現金事件來源未取得完整調閱權限' using errcode='42501';end if;
    events:=events||jsonb_build_array(jsonb_build_object('eventId','expense:'||r.id||':settlement','eventType','settlement','eid',e,'dc',raw->>'department_code','sourceId',r.id,'sourceTypes',jsonb_build_array('expense_request'),'voucherNo',coalesce(fp->>'advanceFinalVoucherId',raw->>'voucher_id',''),'date',dt,'amount',-(fp->>'advanceSettlementDifference')::numeric,'kind','op','ref',r.no));
   end if;
  end if;
  if jsonb_array_length(events)>25000 then raise exception '月交現金事件超過安全上限' using errcode='54000';end if;
 end loop;
 return jsonb_build_object('events',events,'overrides',overrides);
end $$;
revoke all on function private.finance_monthly_cash_evidence_v1(uuid,text,text,text) from public,anon,authenticated,service_role;

create function public.finance_monthly_delivery_snapshot_v1(p_entity_id text,p_period text,
 p_data_environment text default 'production') returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare a jsonb:=private.finance_reporting_actor_v1(p_entity_id,p_data_environment);
 t uuid:=(a->>'tenantId')::uuid; d date; e date; result jsonb; source jsonb; rows jsonb; k text; labor jsonb; requirements jsonb; missing jsonb:='[]'; item jsonb; file_record record;
begin
 -- The existing electronic labor export permits accountants only; this package
 -- includes that same sensitive information and must not broaden access.
 if public.current_finance_role() is distinct from 'accountant' then
  raise exception '月交資料僅供正式會計帳號匯出' using errcode='42501';end if;
 if p_period is null or p_period!~'^[1-9][0-9]{3}-(0[1-9]|1[0-2])$' then
  raise exception '請選擇單一法人與月份' using errcode='22023';end if;
 d:=(p_period||'-01')::date;e:=(d+interval '1 month')::date;
 source:=private.finance_audit_source_v1(t,p_entity_id,p_data_environment);
 perform finance_hr_private.finance_hr_accounting_scope(t,p_entity_id,p_data_environment);
 -- Include the complete company ledger through month-end so opening balances
 -- cannot silently become zero. Raw records retain accounting dates/statuses.
 select jsonb_build_object(
  'ledger',coalesce((select jsonb_agg(to_jsonb(l) order by l.entry_date,l.id)
   from public.ledger_entries l where l.tenant_id=t and l.entity_id=p_entity_id
    and coalesce(l.data_environment,'production')=p_data_environment and l.entry_date<e),'[]'::jsonb),
  'vouchers',coalesce((select jsonb_agg(to_jsonb(v) order by v.voucher_date,v.id)
   from public.vouchers v where v.tenant_id=t and v.entity_id=p_entity_id
    and coalesce(v.data_environment,'production')=p_data_environment and v.voucher_date>=d and v.voucher_date<e),'[]'::jsonb),
  'expense_requests',coalesce((select jsonb_agg(to_jsonb(r) order by r.id)
   from public.expense_requests r where r.tenant_id=t and r.entity_id=p_entity_id
    and coalesce(r.data_environment,'production')=p_data_environment and public.can_read_expense_request(r)
    and (r.request_date>=d and r.request_date<e or exists(select 1 from public.ledger_entries l
     where l.tenant_id=t and l.entity_id=p_entity_id and coalesce(l.data_environment,'production')=p_data_environment
      and l.entry_date>=d and l.entry_date<e and l.source_id=r.id))),'[]'::jsonb),
  'invoices',coalesce((select jsonb_agg(to_jsonb(i) order by i.id)
   from public.invoices i where i.tenant_id=t and i.entity_id=p_entity_id
    and coalesce(i.data_environment,'production')=p_data_environment and public.can_read_invoice(i)
    and (coalesce(to_jsonb(i)->>'invoice_date',to_jsonb(i)->>'issue_date',to_jsonb(i)->>'created_at','') like p_period||'%'
     or exists(select 1 from public.ledger_entries l where l.tenant_id=t and l.entity_id=p_entity_id
      and coalesce(l.data_environment,'production')=p_data_environment and l.entry_date>=d and l.entry_date<e and l.source_id=i.id))),'[]'::jsonb),
  'profile',coalesce((select to_jsonb(p) from public.finance_reporting_profiles p
   where p.tenant_id=t and p.entity_id=p_entity_id and p.data_environment=p_data_environment),'null'::jsonb)
 ) into rows;
 select rows||jsonb_build_object('attachments',coalesce(jsonb_agg(to_jsonb(f) order by f.id),'[]'::jsonb)) into rows
 from public.file_attachments f where f.tenant_id=t and f.entity_id=p_entity_id
  and coalesce(f.data_environment,'production')=p_data_environment
  and (f.record_date>=d and f.record_date<e or exists(
   select 1 from jsonb_array_elements((rows->'expense_requests')||(rows->'invoices')||(rows->'vouchers')) r
   where f.record_no=coalesce(r->>'no',r->>'id') or to_jsonb(f)->>'record_id'=r->>'id') or exists(
   select 1 from private.finance_monthly_file_refs_v1(rows) refs where refs.path=f.storage_path and not refs.unresolved));
 if exists(select 1 from public.file_attachments f where f.id::text in
  (select x->>'id' from jsonb_array_elements(rows->'attachments') x)
  and public.can_read_finance_attachment(f) is distinct from true) then
  raise exception '月交附件有來源未取得調閱權限，未匯出部分資料' using errcode='42501';end if;
 -- Draft/manual vouchers may not have ledger lines yet; enforce their own
 -- department scope in addition to complete-company audit/HR scope.
 if exists(select 1 from jsonb_array_elements(rows->'vouchers') v
  where private.finance_expense_optional_permission_allows(t,public.current_finance_user_id(),'finance.request.view.all',
   jsonb_build_object('entity_id',p_entity_id,'entityId',p_entity_id,'department_code',v->>'department_code','departmentCode',v->>'department_code','data_environment',p_data_environment)) is distinct from true) then
  raise exception '月交傳票未取得完整調閱權限' using errcode='42501';end if;
 labor:=private.finance_monthly_labor_requirements_v1(p_entity_id,p_period,p_data_environment);
 missing:=labor->'missing';requirements:=labor->'requiredFiles';
 for file_record in select value as f,ordinality as n from jsonb_array_elements(rows->'attachments') with ordinality loop
  requirements:=requirements||jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('path','originals/'||lpad(file_record.n::text,5,'0')||'_'||(file_record.f->>'id'),'sizeBytes',file_record.f->'file_size','sha256',coalesce(file_record.f->>'sha256',file_record.f->>'content_hash'))));
 end loop;
 for file_record in select distinct refs.path,refs.unresolved from private.finance_monthly_file_refs_v1((rows->'expense_requests')||(rows->'invoices')||(rows->'vouchers')) refs
  where refs.unresolved or not exists(select 1 from jsonb_array_elements(rows->'attachments') att where att->>'storage_path'=refs.path) loop
  missing:=missing||jsonb_build_array(jsonb_build_object('category','attachment','sourceId','','reason','unindexed_or_legacy_attachment','path',case when file_record.unresolved then null else file_record.path end));
 end loop;
 foreach k in array array['openingBalanceVerified','bankReconciled','taxReconciled','periodCloseReady'] loop
  if rows->'profile'->'profile'->'periodChecks'->p_period->>k is distinct from 'true' then missing:=missing||jsonb_build_array(jsonb_build_object('category','reports','sourceId',k,'reason','required_period_check_not_confirmed'));end if;
 end loop;
 foreach k in array array['ledger','vouchers','expense_requests','invoices','attachments'] loop
  if jsonb_array_length(rows->k)>25000 then raise exception '月交來源超過安全上限，尚未產生部分交付包' using errcode='54000';end if;
 end loop;
 result:=jsonb_build_object('version',1,'tenantId',t,'actorId',a->>'actorId','entityId',p_entity_id,
  'period',p_period,'dataEnvironment',p_data_environment,'rows',rows,'cashEvidence',private.finance_monthly_cash_evidence_v1(t,p_entity_id,p_period,p_data_environment),'requiredFiles',requirements,'missing',missing,'laborFingerprint',labor->>'fingerprint','auditSourceFingerprint',source->>'fingerprint',
  'counts',(select jsonb_object_agg(x.name,jsonb_array_length(rows->x.name)) from unnest(array['ledger','vouchers','expense_requests','invoices','attachments']) x(name)));
 return result||jsonb_build_object('ok',true,'observedAt',statement_timestamp(),
  'sourceFingerprint',encode(sha256(convert_to(result::text,'UTF8')),'hex'));
end $$;

create function public.finance_monthly_delivery_receipt_v1(p_entity_id text,p_period text,
 p_request_id uuid,p_source_fingerprint text,p_manifest_text text,p_data_environment text default 'production') returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare s jsonb;m jsonb;f jsonb;required_file jsonb;required_missing jsonb;hash text;old private.finance_monthly_delivery_receipts_v1;paths text[]:='{}';
begin
 s:=public.finance_monthly_delivery_snapshot_v1(p_entity_id,p_period,p_data_environment);
 if p_request_id is null or octet_length(p_manifest_text)>2097152 then raise exception '月交清單格式不正確' using errcode='22023';end if;
 m:=p_manifest_text::jsonb;hash:=encode(sha256(convert_to(p_manifest_text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended('monthly-delivery:'||p_request_id::text,0));
 select * into old from private.finance_monthly_delivery_receipts_v1 where id=p_request_id;
 if found then
  if old.tenant_id<>(s->>'tenantId')::uuid or old.actor_id<>s->>'actorId' or old.manifest_sha256<>hash then
   raise exception '月交識別碼已用於不同內容或身分' using errcode='42501';end if;
  return jsonb_build_object('ok',true,'id',old.id,'manifestSha256',hash,'replayed',true);
 end if;
 if s->>'sourceFingerprint' is distinct from p_source_fingerprint then raise exception '來源已變更，請重新整理交付包' using errcode='40001';end if;
 if m->>'kind' is distinct from 'finance-monthly-delivery' or m->>'version' is distinct from '1'
  or m->>'entityId' is distinct from p_entity_id or m->>'period' is distinct from p_period
  or m->>'dataEnvironment' is distinct from p_data_environment or m->>'tenantId' is distinct from s->>'tenantId'
  or m->>'sourceFingerprint' is distinct from p_source_fingerprint
  or m->'sourceCounts' is distinct from s->'counts'
  or jsonb_typeof(m->'missing') is distinct from 'array' or jsonb_typeof(m->'files') is distinct from 'array'
  or jsonb_array_length(m->'files') not between 1 and 2000
  or m->>'complete' is distinct from (jsonb_array_length(m->'missing')=0)::text then
  raise exception '月交清單或完整性標示不一致' using errcode='22023';end if;
 for f in select value from jsonb_array_elements(m->'files') loop
  if coalesce(f->>'path','')!~'^[A-Za-z0-9_./-]+$' or (f->>'path') like '%..%'
   or left(f->>'path',1)='/' or coalesce(f->>'sha256','')!~'^[a-f0-9]{64}$'
   or coalesce(f->>'sizeBytes','')!~'^[0-9]{1,9}$' or (f->>'path')=any(paths) then
   raise exception '月交檔案清單格式不正確' using errcode='22023';end if;
  paths:=array_append(paths,f->>'path');
 end loop;
 if not 'reports/financial-statements.csv'=any(paths) or not 'accounting/vouchers.json'=any(paths)
  or not 'accounting/ledger.json'=any(paths) or not 'accounting/sources.json'=any(paths) or not 'originals/index.json'=any(paths)
  or not 'labor/manifest.json'=any(paths) or not 'labor/register.csv'=any(paths) or not 'missing.csv'=any(paths) then
  raise exception '月交清單缺少必要檔案' using errcode='22023';end if;
 for required_missing in select value from jsonb_array_elements(s->'missing') loop
  if m->>'complete'='true' or not exists(select 1 from jsonb_array_elements(m->'missing') x
   where x->>'category'=required_missing->>'category' and x->>'reason'=required_missing->>'reason' and x->>'sourceId' is not distinct from required_missing->>'sourceId') then
   raise exception '月交包未列出伺服器已確認的待補事項' using errcode='22023';end if;
 end loop;
 for required_file in select value from jsonb_array_elements(s->'requiredFiles') loop
  if not exists(select 1 from jsonb_array_elements(m->'files') x where
   (x->>'path'=required_file->>'path' or (required_file?'prefix' and starts_with(x->>'path',required_file->>'prefix') and substring(x->>'path' from length(required_file->>'prefix')+1) in('pdf','png','jpg','jpeg')))
   and (not(required_file?'sha256') or x->>'sha256'=required_file->>'sha256')
   and (not(required_file?'sizeBytes') or x->>'sizeBytes'=required_file->>'sizeBytes')) then
   if m->>'complete'='true' or not exists(select 1 from jsonb_array_elements(m->'missing') x where x->>'category'='required_file' and x->>'sourceId'=coalesce(required_file->>'path',required_file->>'prefix')) then
    raise exception '月交包缺少必要原件或其內容雜湊不符' using errcode='22023';end if;
  end if;
 end loop;
 insert into private.finance_monthly_delivery_receipts_v1 values(p_request_id,(s->>'tenantId')::uuid,
  p_data_environment,p_entity_id,p_period,s->>'actorId',p_source_fingerprint,m,hash,clock_timestamp());
 return jsonb_build_object('ok',true,'id',p_request_id,'manifestSha256',hash,'replayed',false);
end $$;
revoke all on function public.finance_monthly_delivery_snapshot_v1(text,text,text),
 public.finance_monthly_delivery_receipt_v1(text,text,uuid,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.finance_monthly_delivery_snapshot_v1(text,text,text),
 public.finance_monthly_delivery_receipt_v1(text,text,uuid,text,text,text) to authenticated;
