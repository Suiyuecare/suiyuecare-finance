// Synthetic PostgreSQL fixture only. Never connects to Supabase or live people.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
const db=new PGlite();let checks=0;
const tenant=randomUUID(),accountant=randomUUID(),ceo=randomUUID(),director=randomUUID(),
 employee=randomUUID(),manager=randomUUID(),cashier=randomUUID(),hr=randomUUID(),generalAffairs=randomUUID();
const eq=(a,b,m)=>{assert.deepEqual(a,b,m);checks++};
const reject=async(fn,re)=>{await assert.rejects(fn,re);checks++};
async function role(name,id=''){
 await db.exec('reset role');
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);
 await db.query("select set_config('request.jwt.claim.role',$1,false)",[name]);
 await db.exec(`set role ${name}`);
}
async function rpc(name,args={}){
 const sql=`select public.${name}(${Object.keys(args).map((k,i)=>`${k}=>$${i+1}`).join(',')}) r`;
 return(await db.query(sql,Object.values(args))).rows[0].r;
}
try{
 await db.exec(`
 create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create schema private;create schema storage;
 grant usage on schema auth to authenticated,service_role;
 create function auth.uid() returns uuid language sql stable as
  $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function auth.role() returns text language sql stable as
  $$select nullif(current_setting('request.jwt.claim.role',true),'')$$;
 create table public.finance_users(id text primary key,tenant_id uuid,auth_user_id uuid,name text,active boolean,role text);
 create function public.current_finance_user() returns public.finance_users language sql stable security definer set search_path='' as
  $$select f from public.finance_users f where f.auth_user_id=auth.uid() and f.active$$;
 create function public.current_finance_role() returns text language sql stable as
  $$select (public.current_finance_user()).role$$;
 create function private.finance_reporting_actor_v1(p_entity text,p_environment text) returns jsonb language plpgsql stable security definer set search_path='' as
  $$declare a public.finance_users:=public.current_finance_user();begin
   if a.id is null or p_entity<>'E1' or p_environment<>'production' then raise exception 'SYNTHETIC_SCOPE_DENIED' using errcode='42501';end if;
   return jsonb_build_object('tenantId',a.tenant_id,'actorId',a.id);end$$;
 create function private.finance_expense_optional_permission_allows(uuid,text,text,jsonb) returns boolean language sql stable as
  $$select current_setting('test.permission_denied',true) is distinct from 'yes'$$;
 create table public.system_settings(tenant_id uuid,key text,value jsonb);
 create table public.expense_requests(id text primary key,no text,tenant_id uuid,data_environment text,
  entity_id text,department_code text,applicant_id text,type text,amount numeric,status text,step int,steps jsonb,
  form_payload jsonb,voucher_id text,cash_posted_at timestamptz,ledger_posted_at timestamptz,
  posting_locked_at timestamptz,created_at timestamptz default clock_timestamp());
 create table public.vouchers(id text primary key,no text unique,request_id text,entity_id text,entity_name text,
  voucher_date date,description text,entries jsonb,total numeric,creator text,posted boolean,posted_at timestamptz,
  posting_locked_at timestamptz,data_environment text,tenant_id uuid,adjusts_voucher_no text,adjustment_type text);
 create table public.ledger_entries(id bigint generated always as identity primary key,entry_date date,description text,
  entity_id text,department_code text,debit numeric,credit numeric,account_code text,account_name text,
  reference_no text,posting_key text unique,source_type text,source_id text,source_no text,voucher_no text,
  data_environment text,tenant_id uuid);
 create table public.period_closes(tenant_id uuid,data_environment text,entity_id text,period text,status text);
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);
 create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text,metadata jsonb,user_metadata jsonb,
  unique(bucket_id,name));
 alter table storage.objects enable row level security;
 create policy legacy_auth_storage on storage.objects for all to authenticated using(true) with check(true);
 create policy legacy_anon_storage on storage.objects for all to anon using(true) with check(true);
 grant select on storage.objects to authenticated,anon;
 create function private.finance_tenant_account_name(p_tenant uuid,p_code text) returns text
 language sql stable security definer set search_path='' as
 $$select x->>'n' from public.system_settings s cross join lateral jsonb_array_elements(s.value) x
   where s.tenant_id=p_tenant and s.key='accounts' and x->>'c'=p_code and x->>'on'='true' limit 1$$;
 create function private.finance_next_voucher_no_for_tenant(uuid,text,date,text) returns text
 language plpgsql security definer set search_path='' as
 $$begin return $2||to_char($3,'YYYYMM')||'-'||lpad(nextval('public.synthetic_serial')::text,5,'0');end$$;
 create sequence public.synthetic_serial;
 create function private.finance_assert_period_open(p_tenant uuid,p_environment text,p_entity text,p_date date,p_action text)
 returns void language plpgsql security definer set search_path='' as $$begin
  if exists(select 1 from public.period_closes c where c.tenant_id=p_tenant and c.data_environment=p_environment
   and c.entity_id=p_entity and c.period=to_char(p_date,'YYYY-MM') and c.status='closed') then
   raise exception 'SYNTHETIC_PERIOD_CLOSED' using errcode='23514';end if;end$$;
 grant usage on schema storage to authenticated,anon,service_role;
 grant select,insert,update on storage.objects to service_role;
 grant select,insert,update on public.expense_requests,public.vouchers,public.ledger_entries to authenticated;
 grant usage on sequence public.ledger_entries_id_seq to authenticated;
 `);
 await db.exec(await fs.readFile(new URL('../supabase/migrations/20260928090000_finance_external_labor_v1.sql',import.meta.url),'utf8'));
 const alice={id:randomUUID(),courseRef:'A-1',courseType:'講課',description:'八月課程 A',serviceDate:'2026-09-15',departmentCode:'D1',grossCents:1500000};
 const bob={id:randomUUID(),courseRef:'B-1',courseType:'研習',description:'八月課程 B',serviceDate:'2026-09-16',departmentCode:'D2',grossCents:1600000};
 const marker={version:1,status:'pending_invite',signerName:'測試講師',inviteEmail:'lecturer@example.invalid',period:'2026-09',
  serviceLines:[alice,bob],totalGrossCents:3100000,plannedPaymentDates:['2026-09-15','2026-09-16','2026-09-17']};
 const steps=[{rk:'applicant',a:'approved'},{rk:'dept_manager',uid:'manager',a:'approved'},{rk:'accountant',a:''},
  {rk:'ceo',a:''},{rk:'cashier',a:''},{rk:'accountant_final',a:''}];
 await db.query(`insert into public.finance_users values
  ('accountant',$1,$2,'Accounting',true,'accountant'),('ceo',$1,$3,'CEO',true,'ceo'),
  ('director',$1,$4,'Director',true,'admin_director'),
  ('employee',$1,$5,'Employee',true,'employee'),('manager',$1,$6,'Manager',true,'dept_manager'),
  ('cashier',$1,$7,'Cashier',true,'cashier'),
  ('hr',$1,$8,'HR',true,'hr'),('general_affairs',$1,$9,'General Affairs',true,'general_affairs')`,
  [tenant,accountant,ceo,director,employee,manager,cashier,hr,generalAffairs]);
 await db.query(`insert into public.system_settings values
  ($1,'entities','[{"id":"E1","full":"測試法人"}]'),
  ($1,'departments','[{"c":"D1","eid":"E1","active":true},{"c":"D2","eid":"E1","active":true}]'),
  ($1,'accounts','[{"c":"6221","n":"勞務費","on":true},{"c":"5113","n":"講師成本","on":true},
    {"c":"2131","n":"應付費用","on":true},{"c":"1112","n":"銀行","on":true},
    {"c":"21953","n":"代扣稅","on":true},{"c":"21955","n":"補充保費","on":true}]')`,[tenant]);
 await db.query(`insert into public.expense_requests(id,no,tenant_id,data_environment,entity_id,department_code,applicant_id,type,amount,status,step,steps,form_payload)
  values('SYNTHETIC-REQ','SYNTHETIC-NO',$1,'production','E1','D1','employee','hr_expense_request',31000,'pending_accountant',2,$2,$3)`,
  [tenant,JSON.stringify(steps),JSON.stringify({electronicLabor:marker})]);
 const hash=createHash('sha256').update('synthetic-token').digest('hex');
 const invite={p_request_id:'SYNTHETIC-REQ',p_entity_id:'E1',p_invite_email:'lecturer@example.invalid',
  p_token_hash:hash,p_expires_at:new Date(Date.now()+14*86400000).toISOString(),p_lines:[alice,bob]};
 await role('authenticated',employee);
 await reject(()=>rpc('finance_labor_create_invite_v1',invite),/FORBIDDEN/);
 await role('authenticated',ceo);
 await reject(()=>rpc('finance_labor_create_invite_v1',invite),/ACCOUNTANT_ONLY/);
 await role('postgres');await db.query(`update public.expense_requests set status='pending_dept_manager',
  steps=jsonb_set(steps,'{1,a}','""'::jsonb) where id='SYNTHETIC-REQ'`);
 await role('authenticated',accountant);
 await reject(()=>rpc('finance_labor_create_invite_v1',invite),/ACCOUNTING_STAGE/);
 await role('postgres');await db.query(`update public.expense_requests set status='pending_accountant',
  steps=jsonb_set(steps,'{1,a}','"approved"'::jsonb) where id='SYNTHETIC-REQ'`);
 await role('authenticated',accountant);
 const created=await rpc('finance_labor_create_invite_v1',invite);
 eq(created.status,'invited','one signed document covers two service lines');
 eq(created.serviceLines.length,2);
 await reject(()=>db.query(`update public.expense_requests set status='pending_ceo',
  steps=jsonb_set(steps,'{2,a}','"approved"'::jsonb) where id='SYNTHETIC-REQ'`),/SIGNED_ACCOUNTING_REVIEW_REQUIRED/);
 await role('authenticated',employee);eq((await rpc('finance_labor_request_status_v1',
  {p_request_id:'SYNTHETIC-REQ'})).status,'invited');
 await reject(()=>rpc('finance_labor_staff_get_v1',{p_statement_id:created.statementId}),/FORBIDDEN/);
 await role('authenticated',manager);eq((await rpc('finance_labor_request_status_v1',
  {p_request_id:'SYNTHETIC-REQ'})).status,'invited');
 await reject(()=>rpc('finance_labor_staff_pay_v1',{p_statement_id:created.statementId,
  p_expected_version:1,p_request_key:randomUUID(),p_paid_on:'2026-09-15',
  p_bank_ref:'SYNTHETIC-DENIED',p_allocations:[],p_evidence:{}}),/FORBIDDEN/);
 // HR and general affairs may see only the status of a request naming them as
 // an approval participant; neither role obtains accounting detail or actions.
 await role('postgres');
 await db.query(`insert into public.expense_requests(id,no,tenant_id,data_environment,entity_id,
  department_code,applicant_id,type,amount,status,step,steps,form_payload)
  values('SYNTHETIC-ROLE-STATUS','SYNTHETIC-ROLE-STATUS',$1,'production','E1',
   'D1','employee','hr_expense_request',31000,'pending_accountant',2,$2,$3)`,
  [tenant,JSON.stringify([{rk:'hr',uid:'hr',a:'approved'},
   {rk:'general_affairs',uid:'general_affairs',a:'approved'}]),
   JSON.stringify({electronicLabor:{...marker,plannedPaymentDates:['2026-10-15']}})]);
 for(const [userId,authId] of [['hr',hr],['general_affairs',generalAffairs]]){
  await role('authenticated',authId);
  const visible=await rpc('finance_labor_request_status_v1',{p_request_id:'SYNTHETIC-ROLE-STATUS'});
  eq(visible.status,'pending_invite',`${userId} sees assigned low-sensitivity status`);
  eq(Object.hasOwn(visible,'signerName')||Object.hasOwn(visible,'inviteEmail'),false,
   `${userId} cannot read lecturer identity from status`);
  await reject(()=>rpc('finance_labor_request_status_v1',{p_request_id:'SYNTHETIC-REQ'}),/FORBIDDEN/);
  await reject(()=>rpc('finance_labor_staff_for_request_v1',{p_request_id:'SYNTHETIC-ROLE-STATUS'}),/FORBIDDEN/);
  await reject(()=>rpc('finance_labor_staff_list_v1',{p_entity_id:'E1',p_period:'2026-09',
   p_status:null,p_limit:10,p_cursor:null}),/FORBIDDEN/);
  await reject(()=>rpc('finance_labor_create_invite_v1',invite),/FORBIDDEN/);
 }
 await role('authenticated',accountant);
 await reject(()=>rpc('finance_labor_create_invite_v1',{...invite,p_token_hash:'f'.repeat(64)}),/USE_ROTATE/);
 await reject(()=>db.query("update public.expense_requests set amount=1 where id='SYNTHETIC-REQ'"),/IMMUTABLE/);
 await reject(()=>db.query("insert into public.vouchers(id,request_id) values('FORGED','SYNTHETIC-REQ')"),/LEGACY_VOUCHER_BLOCKED/);
 await role('anon');await reject(()=>rpc('finance_labor_guest_lookup_v1',{p_token_hash:hash}),/permission denied/);
 await role('postgres');await db.query("update public.expense_requests set status='cancelled' where id='SYNTHETIC-REQ'");
 await role('service_role');await reject(()=>rpc('finance_labor_guest_lookup_v1',{p_token_hash:hash}),/PARENT_REQUEST_NOT_ACTIVE/);
 await role('postgres');await db.query("update public.expense_requests set status='pending_accountant' where id='SYNTHETIC-REQ'");
 await role('service_role');
 const looked=await rpc('finance_labor_guest_lookup_v1',{p_token_hash:hash});
 eq(looked.entityName,'測試法人');eq(JSON.stringify(looked).includes('idNumber'),false);
 const uploadIds={};
 for(const [key,kind] of [['identityFront','identity_front'],['identityBack','identity_back'],
   ['bankProof','bank_proof'],['signature','signature']]){
  const authz=await rpc('finance_labor_guest_upload_authorize_v1',{p_token_hash:hash,p_expected_version:1,
   p_kind:kind,p_file_name:'synthetic.png',p_mime:'image/png',p_size_bytes:100});
  const fileHash=createHash('sha256').update(kind).digest('hex');
  await db.query(`insert into storage.objects(bucket_id,name,metadata,user_metadata)
   values('finance-external-labor',$1,$2,$3)`,
   [authz.path,JSON.stringify({size:100}),JSON.stringify({sha256:fileHash})]);
  await rpc('finance_labor_guest_file_commit_v1',{p_token_hash:hash,p_upload_id:authz.uploadId,
   p_path:authz.path,p_kind:kind,p_sha256:fileHash,p_size_bytes:100,p_mime:'image/png'});
  uploadIds[key]={uploadId:authz.uploadId,path:authz.path,sha256:fileHash};
 }
 for(let n=0;n<4;n++)await rpc('finance_labor_guest_upload_authorize_v1',{
  p_token_hash:hash,p_expected_version:1,p_kind:'identity_front',p_file_name:'retry.png',
  p_mime:'image/png',p_size_bytes:100});
 await reject(()=>rpc('finance_labor_guest_upload_authorize_v1',{
  p_token_hash:hash,p_expected_version:1,p_kind:'identity_front',p_file_name:'sixth.png',
  p_mime:'image/png',p_size_bytes:100}),/UPLOAD_QUOTA_EXCEEDED/);
 const profile={fullName:'測試講師',idNumber:'SYNTHETIC',phone:'000000000',address:'SYNTHETIC',
  bankCode:'000',bankName:'測試銀行',branchName:'測試分行',accountNumber:'000000',accountHolder:'測試講師'};
 const submitId=randomUUID();
 const signed=await rpc('finance_labor_guest_submit_v1',{p_token_hash:hash,p_expected_version:1,
  p_submit_id:submitId,p_profile:profile,p_uploads:uploadIds,p_consent_version:'labor-v1'});
 eq(signed.status,'signed_pending_archive');
 eq(createHash('sha256').update(signed.signedSnapshotText).digest('hex'),signed.snapshotHash);
 eq((await rpc('finance_labor_guest_submit_v1',{p_token_hash:hash,p_expected_version:1,
  p_submit_id:submitId,p_profile:profile,p_uploads:uploadIds,p_consent_version:'labor-v1'})).replayed,true);
 await reject(()=>rpc('finance_labor_guest_submit_v1',{p_token_hash:hash,p_expected_version:1,
  p_submit_id:submitId,p_profile:{...profile,phone:'different'},p_uploads:uploadIds,
  p_consent_version:'labor-v1'}),/REPLAY_CONFLICT/);
 await role('postgres');await db.query(`update private.finance_labor_invites_v1 set expires_at=now()-interval '1 day'
  where statement_id=$1`,[created.statementId]);await role('service_role');
 eq((await rpc('finance_labor_guest_lookup_v1',{p_token_hash:hash})).signedSnapshotText,
  signed.signedSnapshotText,'pending archive can recover after link expiry');
 await role('authenticated',employee);
 await reject(()=>rpc('finance_labor_staff_archive_repair_v1',{p_statement_id:created.statementId}),/FORBIDDEN/);
 await role('authenticated',cashier);
 await reject(()=>rpc('finance_labor_staff_archive_repair_v1',{p_statement_id:created.statementId}),/FORBIDDEN/);
 await role('authenticated',accountant);
 eq((await rpc('finance_labor_staff_archive_repair_v1',{p_statement_id:created.statementId})).signedSnapshotText,
  signed.signedSnapshotText,'accountant can recover old pending signed original');
 await role('service_role');
 await db.query(`insert into storage.objects(bucket_id,name,metadata,user_metadata)
  values('finance-external-labor',$1,$2,$3)`,
  [signed.archivePath,JSON.stringify({size:Buffer.byteLength(signed.signedSnapshotText)}),
   JSON.stringify({sha256:signed.snapshotHash})]);
 const committed=await rpc('finance_labor_guest_archive_commit_v1',{p_statement_id:created.statementId,
  p_snapshot_hash:signed.snapshotHash,p_path:signed.archivePath,p_file_sha256:signed.snapshotHash});
 eq(committed.status,'signed');
 await reject(()=>rpc('finance_labor_guest_submit_v1',{p_token_hash:hash,p_expected_version:1,
  p_submit_id:submitId,p_profile:profile,p_uploads:uploadIds,p_consent_version:'labor-v1'}),/REPLAY_FORBIDDEN/);
 await reject(()=>rpc('finance_labor_guest_lookup_v1',{p_token_hash:hash}),/NOT_AVAILABLE/);
 await role('authenticated',accountant);
 eq((await rpc('finance_labor_staff_archive_repair_v1',{p_statement_id:created.statementId})).status,'signed');
 const decisions=[{serviceLineId:alice.id,incomeCategory:'50',expenseAccount:'6221',classificationBasis:'合約授課與課程佐證已覆核'},
  {serviceLineId:bob.id,incomeCategory:'9B',expenseAccount:'5113',classificationBasis:'技術服務內容經人工判定'}];
 await role('postgres');await db.query("update public.expense_requests set status='rejected' where id='SYNTHETIC-REQ'");
 await role('authenticated',accountant);
 await reject(()=>rpc('finance_labor_staff_review_v1',{p_statement_id:created.statementId,p_expected_version:3,
  p_request_key:randomUUID(),p_line_decisions:decisions,p_reason:'來源已駁回不得覆核'}),/SIGNED_ARCHIVE/);
 await role('postgres');await db.query("update public.expense_requests set status='pending_accountant' where id='SYNTHETIC-REQ'");
 await role('authenticated',accountant);
 const review=await rpc('finance_labor_staff_review_v1',{p_statement_id:created.statementId,p_expected_version:3,
  p_request_key:randomUUID(),p_line_decisions:decisions,p_reason:'課程及所得性質已核對'});
 eq(review.status,'reviewed');
 await role('authenticated',ceo);
 await reject(()=>rpc('finance_labor_staff_accrue_v1',{p_statement_id:created.statementId,p_expected_version:4,
  p_request_key:randomUUID(),p_reason:'核對主管簽核仍未結束'}),/MANAGER_APPROVAL/);
 await role('postgres');await db.query(`update public.expense_requests set status='pending_cashier',
  steps=jsonb_set(jsonb_set(steps,'{2,a}','"approved"'::jsonb),'{3,a}','"approved"'::jsonb)
  where id='SYNTHETIC-REQ'`);await role('authenticated',accountant);
 await reject(()=>rpc('finance_labor_staff_accrue_v1',{p_statement_id:created.statementId,p_expected_version:4,
  p_request_key:randomUUID(),p_reason:'已核對主管簽核'}),/INDEPENDENT/);
 await role('authenticated',ceo);
 await role('postgres');await reject(()=>db.query(
  "update public.expense_requests set status='rejected' where id='SYNTHETIC-REQ'"),/LEGACY_CASHIER_ROUTE_BLOCKED/);
 await role('authenticated',ceo);
 await reject(()=>db.query("update public.expense_requests set status='pending_applicant_confirm' where id='SYNTHETIC-REQ'"),
  /LEGACY_CASHIER_ROUTE_BLOCKED/);
 await role('postgres');await db.query(`insert into public.period_closes values($1,'production','E1','2026-09','closed')`,
  [tenant]);await role('authenticated',ceo);
 await reject(()=>rpc('finance_labor_staff_accrue_v1',{p_statement_id:created.statementId,p_expected_version:4,
  p_request_key:randomUUID(),p_reason:'核對主管簽核並應計'}),/PERIOD_CLOSED/);
 await role('postgres');await db.query(`delete from public.period_closes where period='2026-09'`);
 await role('authenticated',ceo);
 const accrued=await rpc('finance_labor_staff_accrue_v1',{p_statement_id:created.statementId,p_expected_version:4,
  p_request_key:randomUUID(),p_reason:'已核對主管簽核'});
 eq(accrued.status,'accrued');eq(accrued.accrualVoucherNos.length,2);
 eq((await db.query("select status from public.expense_requests where id='SYNTHETIC-REQ'")).rows[0].status,
  'pending_external_labor_settlement');
 await reject(()=>db.query("update public.expense_requests set status='completed' where id='SYNTHETIC-REQ'"),
  /SETTLEMENT_ONLY_COMPLETION/);
 eq(Number((await db.query("select sum(debit)::text n from public.ledger_entries where source_type='external_labor' and account_code like '6%' or account_code='5113'")).rows[0].n),31000);
 await role('authenticated',accountant);
 await role('authenticated',cashier);
 await reject(()=>rpc('finance_labor_staff_pay_v1',{p_statement_id:created.statementId,
  p_expected_version:5,p_request_key:randomUUID(),p_paid_on:'2026-09-15',
  p_bank_ref:'SYNTHETIC-DENIED',p_allocations:[],p_evidence:{}}),/FORBIDDEN/);
 await role('authenticated',accountant);
 await role('postgres');await reject(()=>db.query(
  "update public.expense_requests set status='cancelled' where id='SYNTHETIC-REQ'"),/SETTLEMENT_ONLY_COMPLETION/);
 await role('authenticated',accountant);
 const evidenceAuth=await rpc('finance_labor_staff_evidence_authorize_v1',{p_statement_id:created.statementId,
  p_file_name:'bank.pdf',p_mime:'application/pdf',p_size_bytes:100});
 const evidencePath=evidenceAuth.path;
 const evidenceHash='b'.repeat(64);
 await role('service_role');
 await db.query(`insert into storage.objects(bucket_id,name,metadata,user_metadata)
  values('finance-external-labor',$1,$2,$3)`,
  [evidencePath,JSON.stringify({size:100}),JSON.stringify({sha256:evidenceHash})]);
 await role('authenticated',accountant);
 const paidOn='2026-09-15',bankRef='SYNTHETIC-BANK-001';
 const paymentArgs={p_statement_id:created.statementId,p_expected_version:5,
  p_request_key:randomUUID(),p_paid_on:paidOn,p_bank_ref:bankRef,
  p_allocations:[{serviceLineId:alice.id,grossCents:1000000,incomeTaxCents:100000,nhiCents:0}],
  p_evidence:{verifiedBankReference:bankRef,bankStatementPath:evidencePath,bankStatementSha256:evidenceHash,
   taxBasis:'人工覆核年度扣繳類別',nhiBasis:'人工覆核補充保費規則'}};
 await role('postgres');await db.exec('alter table public.expense_requests disable trigger finance_labor_request_guard_v1');
 await db.query("update public.expense_requests set status='rejected' where id='SYNTHETIC-REQ'");
 await db.exec('alter table public.expense_requests enable trigger finance_labor_request_guard_v1');
 await role('authenticated',accountant);
 await reject(()=>rpc('finance_labor_staff_evidence_authorize_v1',{p_statement_id:created.statementId,
  p_file_name:'blocked.pdf',p_mime:'application/pdf',p_size_bytes:100}),/AUTHORIZATION_DENIED/);
 await reject(()=>rpc('finance_labor_staff_pay_v1',paymentArgs),/PARENT_REQUEST_NOT_ACTIVE/);
 await role('postgres');await db.exec('alter table public.expense_requests disable trigger finance_labor_request_guard_v1');
 await db.query("update public.expense_requests set status='pending_external_labor_settlement' where id='SYNTHETIC-REQ'");
 await db.exec('alter table public.expense_requests enable trigger finance_labor_request_guard_v1');
 await role('authenticated',accountant);
 const payment=await rpc('finance_labor_staff_pay_v1',paymentArgs);
 eq(payment.status,'partially_paid');eq(payment.totalPaidGrossCents,1000000);
 eq((await rpc('finance_labor_staff_pay_v1',paymentArgs)).replayed,true,'same request key never rebooks');
 await reject(()=>rpc('finance_labor_staff_pay_v1',{...paymentArgs,
  p_allocations:[{serviceLineId:alice.id,grossCents:900000,incomeTaxCents:100000,nhiCents:0}]}),/REPLAY_CONFLICT/);
 eq((await db.query("select count(*)::int n from public.ledger_entries where voucher_no=$1",[payment.voucherNo])).rows[0].n,3);
 eq((await db.query("select distinct source_no from public.ledger_entries where voucher_no=$1",[payment.voucherNo])).rows[0].source_no,
  'SYNTHETIC-NO','ledger traces to parent request number');
 await reject(()=>rpc('finance_labor_staff_pay_v1',{p_statement_id:created.statementId,p_expected_version:6,
  p_request_key:randomUUID(),p_paid_on:paidOn,p_bank_ref:'SYNTHETIC-BANK-002',
  p_allocations:[{serviceLineId:alice.id,grossCents:600000,incomeTaxCents:0,nhiCents:0}],
  p_evidence:{verifiedBankReference:'SYNTHETIC-BANK-002',bankStatementPath:evidencePath,
   bankStatementSha256:evidenceHash,taxBasis:'人工覆核年度扣繳類別',nhiBasis:'人工覆核補充保費規則'}}),/EXCEEDS_OUTSTANDING/);
 await reject(()=>rpc('finance_labor_staff_pay_v1',{p_statement_id:created.statementId,p_expected_version:6,
  p_request_key:randomUUID(),p_paid_on:paidOn,p_bank_ref:bankRef,
  p_allocations:[{serviceLineId:alice.id,grossCents:10000,incomeTaxCents:0,nhiCents:0}],
  p_evidence:{verifiedBankReference:bankRef,bankStatementPath:evidencePath,
   bankStatementSha256:evidenceHash,taxBasis:'人工覆核年度扣繳類別',
   nhiBasis:'人工覆核補充保費規則'}}),/ALREADY_POSTED/);
 const page=await rpc('finance_labor_export_page_v1',{p_entity_id:'E1',p_paid_from:'2026-09-01',
  p_paid_to:'2026-10-01',p_limit:1,p_cursor:null});
 eq(page.items.length,1);eq(page.items[0].archive.sha256,signed.snapshotHash);
 const roster=await rpc('finance_labor_month_roster_v1',{p_entity_id:'E1',p_payment_from:'2026-09-01',
  p_payment_to:'2026-10-01',p_limit:50,p_cursor:null});
 eq(roster.items[0].incompleteReason,'partial_payment');
 eq(roster.items[0].archive.sha256,signed.snapshotHash,'month packet can include unpaid signed original');
 async function finish(ref,paidOn,allocation,version){
  return rpc('finance_labor_staff_pay_v1',{p_statement_id:created.statementId,p_expected_version:version,
   p_request_key:randomUUID(),p_paid_on:paidOn,p_bank_ref:ref,
   p_allocations:[allocation],p_evidence:{verifiedBankReference:ref,
    bankStatementPath:evidencePath,bankStatementSha256:evidenceHash,
    taxBasis:'人工覆核年度扣繳類別',nhiBasis:'人工覆核補充保費規則'}});
 }
 eq((await finish('SYNTHETIC-BANK-002','2026-09-16',
  {serviceLineId:alice.id,grossCents:500000,incomeTaxCents:0,nhiCents:0},6)).status,'partially_paid');
 eq((await finish('SYNTHETIC-BANK-003','2026-09-17',
  {serviceLineId:bob.id,grossCents:1600000,incomeTaxCents:0,nhiCents:0},7)).status,'paid');
 eq((await db.query("select status from public.expense_requests where id='SYNTHETIC-REQ'")).rows[0].status,'completed');
 eq(Number((await db.query("select sum(debit)::text n from public.ledger_entries where account_code in('6221','5113')")).rows[0].n),
  31000,'three payments never duplicate gross expense');
 const page2=await rpc('finance_labor_export_page_v1',{p_entity_id:'E1',p_paid_from:'2026-09-01',
  p_paid_to:'2026-10-01',p_limit:1,p_cursor:{paidOn:page.items[0].paidAt,paymentId:page.items[0].paymentId},p_as_of:page.asOf});
 eq(page2.items.length,0,'asOf cannot leak later payments into earlier export snapshot');
 await role('postgres');
 await db.query(`insert into public.expense_requests(id,no,tenant_id,data_environment,entity_id,department_code,
  applicant_id,type,amount,status,step,steps,form_payload)
  values('SYNTHETIC-UNINVITED-1','UNINVITED-1',$1,'production','E1','D1','employee',
   'hr_expense_request',31000,'pending_accountant',2,$2,$3),
   ('SYNTHETIC-UNINVITED-2','UNINVITED-2',$1,'production','E1','D1','employee',
   'hr_expense_request',31000,'pending_accountant',2,$2,$3)`,
  [tenant,JSON.stringify(steps),JSON.stringify({electronicLabor:marker})]);
 await role('authenticated',accountant);
 const missing1=await rpc('finance_labor_uninvited_roster_v1',{p_entity_id:'E1',
  p_payment_from:'2026-09-01',p_payment_to:'2026-10-01',p_limit:1,p_cursor:null});
 eq(missing1.items.length,1);eq(missing1.items[0].statementId,null);
 eq(missing1.items[0].incompleteReason,'invitation_pending');
 eq(missing1.nextCursor,'SYNTHETIC-UNINVITED-1');
 const missing2=await rpc('finance_labor_uninvited_roster_v1',{p_entity_id:'E1',
  p_payment_from:'2026-09-01',p_payment_to:'2026-10-01',p_limit:1,
  p_cursor:missing1.nextCursor,p_as_of:missing1.asOf});
 eq(missing2.items[0].requestId,'SYNTHETIC-UNINVITED-2');eq(missing2.nextCursor,null);
 await reject(()=>rpc('finance_labor_create_invite_v1',{...invite,
  p_request_id:'SYNTHETIC-UNINVITED-1',p_token_hash:'c'.repeat(64)}),/duplicate key/);
 const badLine={...alice,id:randomUUID(),serviceDate:'2026-10-01',grossCents:3100000};
 const invalidMarker={...marker,signerName:'另一位測試講師',inviteEmail:'other@example.invalid',
  serviceLines:[badLine]};
 await role('postgres');await db.query(`insert into public.expense_requests(id,no,tenant_id,data_environment,
  entity_id,department_code,applicant_id,type,amount,status,step,steps,form_payload)
  values('SYNTHETIC-OUT-OF-PERIOD','OUT-OF-PERIOD',$1,'production','E1','D1','employee',
   'hr_expense_request',31000,'pending_accountant',2,$2,$3)`,
  [tenant,JSON.stringify(steps),JSON.stringify({electronicLabor:invalidMarker})]);
 await role('authenticated',accountant);
 await reject(()=>rpc('finance_labor_create_invite_v1',{...invite,
  p_request_id:'SYNTHETIC-OUT-OF-PERIOD',p_invite_email:'other@example.invalid',
  p_token_hash:'d'.repeat(64),p_lines:[badLine]}),/SERVICE_LINE_INVALID/);
 await role('anon');await reject(()=>rpc('finance_labor_export_page_v1',{p_entity_id:'E1',p_paid_from:'2026-09-01',
  p_paid_to:'2026-10-01',p_limit:1,p_cursor:null}),/permission denied/);
 await reject(()=>rpc('finance_labor_uninvited_roster_v1',{p_entity_id:'E1',p_payment_from:'2026-09-01',
  p_payment_to:'2026-10-01',p_limit:1,p_cursor:null}),/permission denied/);
 await role('postgres');
 await db.exec((await fs.readFile(new URL('./finance_external_labor_postflight.sql',import.meta.url),'utf8'))
  .replace(/^\\set[^\n]*\n/m,''));checks++;
 const canary=await db.exec(await fs.readFile(new URL('./finance_external_labor_canary.sql',import.meta.url),'utf8'));
 eq(canary.at(-1).rows[0].finance_external_labor_canary_result,{canary:'readonly_external_labor_v1',
  ok:true,rolled_back:true,privacy_preserved:true,legacy_finalization_blocked:true,posting_sealed:true});
 console.log(JSON.stringify({ok:true,checks,scope:'synthetic PostgreSQL',grossAccrual:31000,
  payment:'partial actual bank settlement',privacy:'guest no prior profile'}));
}finally{await db.close()}
