#!/usr/bin/env node
'use strict';
// Real candidate PL/pgSQL + reviewed production guard/helper bodies, in an
// in-memory PostgreSQL instance. Minimal anonymous supporting schema only;
// not a replay of every production trigger, not a production acceptance test.
const fs=require('fs'),path=require('path'),assert=require('assert');
const {PGlite}=require('@electric-sql/pglite');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const baseline=read('supabase/migrations/20260902054834_preserve_human_accounting_authority_v1.sql');
const f01=read('supabase/migrations/20260907154739_procurement_and_human_accounting_contract_v2.sql');
const f05=read('supabase/migrations/20260907154742_expense_accounting_correction_workflow_v1.sql');
const source=read('index.html'),clone=x=>JSON.parse(JSON.stringify(x));
const tenant='00000000-0000-0000-0000-000000000001';
const auths={accountant:'00000000-0000-0000-0000-000000000011',reviewer:'00000000-0000-0000-0000-000000000012',cashier:'00000000-0000-0000-0000-000000000013',other:'00000000-0000-0000-0000-000000000014'};
const state={user:{id:'accountant',name:'Anonymous accountant',role:'accountant'}};
function extract(name){const start=source.indexOf('function '+name+'(');assert(start>=0);let depth=0;for(let i=source.indexOf('{',start);i<source.length;i++){if(source[i]==='{')depth++;if(source[i]==='}'&&--depth===0)return source.slice(start,i+1);}throw Error(name);}
const helperNames=['accountingManualActorSnapshot','accountingManualFieldNames','accountingLineManualFields','accountingComparableValue','accountingChangedFields','preserveAccountingManualAuthority','markAccountingManualAuthority'];
const mark=new Function('num','cloneSettingValue','S',helperNames.map(extract).join('\n')+'\nreturn markAccountingManualAuthority;')(x=>Number(x||0),clone,state);
let passed=0,seq=0;const check=(label,value)=>{assert(value,label);passed++;};
const schema=`
create schema private;create schema auth;create schema extensions;create role anon;create role authenticated;create role service_role;
create function extensions.digest(bytea,text) returns bytea language sql immutable as $$select sha256($1)$$;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('audit.uid',true),'')::uuid$$;
create function auth.jwt() returns jsonb language sql stable as $$select jsonb_build_object('role','authenticated','email',current_setting('audit.uid',true)||'@invalid')$$;
create function public.current_tenant_id() returns uuid language sql stable as $$select '${tenant}'::uuid$$;
create function public.default_tenant_id() returns uuid language sql stable as $$select '${tenant}'::uuid$$;
create table public.finance_users(id text primary key,tenant_id uuid,auth_user_id uuid,name text,email text,role text,active boolean,created_at timestamptz default now());
create table public.employee_department_roles(tenant_id uuid,finance_user_id text,department_code text,role_key text,active boolean default true,can_approve boolean default true,effective_from date default current_date,effective_to date);
-- Existing organization-role projection interface, kept anonymous/minimal.
create function public.finance_org_role_members(text,text) returns table(finance_user_id text,can_approve bool) language sql stable as $$select r.finance_user_id,r.can_approve from public.employee_department_roles r where r.tenant_id=public.current_tenant_id() and r.role_key=$1 and r.active and ($2 is null or r.department_code=$2)$$;
create table public.expense_requests(id text primary key,no text,tenant_id uuid,data_environment text,applicant_id text,applicant text,entity_id text,department_code text,type text,type_label text,amount numeric,estimated_amount numeric,actual_amount numeric,files jsonb default '[]',actual_files jsonb default '[]',form_payload jsonb default '{}',steps jsonb,status text,step integer,ver integer,updated_at timestamptz,created_at timestamptz default now(),request_date date,payee text,bank_type text,bank_name text,bank_branch text,bank_no text,expected_pay_date date,bank_account text,fee_bearer text,bank_fee_amount numeric default 0,petty_mode text,debit_account text,debit_account_name text,credit_account text,credit_account_name text,cash_posted_at timestamptz,ledger_posted_at timestamptz,posting_locked_at timestamptz,voucher_id text,voided_at timestamptz);
create table public.bank_transactions(id text primary key,tenant_id uuid,data_environment text,entity_id text,amount numeric,match_status text,transaction_date date,reference_no text,updated_at timestamptz);
create table public.bank_reconciliation_matches(id text primary key,tenant_id uuid,data_environment text,bank_transaction_id text,match_type text,target_table text,target_id text,target_no text,matched_amount numeric,confidence numeric,match_method text,matched_by text,matched_at timestamptz,note text);
create table public.system_settings(tenant_id uuid,key text,value jsonb);
create table public.module_audit_logs(table_name text,row_id text,action text,actor_email text,before_data jsonb,after_data jsonb);
create table public.approval_step_actor_snapshots(tenant_id uuid,data_environment text,record_type text,record_id text,step_index int,resolved_user_id text,resolution_status text,resolved_active bool,raw_step jsonb);
create table public.approval_delegations(tenant_id uuid,delegator_finance_user_id text,delegatee_finance_user_id text,active bool,starts_at timestamptz,ends_at timestamptz,role_key text,scope_json jsonb);
create table public.cash_movement_evidence_links(tenant_id uuid,data_environment text,direction text,source_table text,source_id text,source_no text,entity_id text,department_code text,amount numeric,source_status text,cash_stage text,expected_bank_date date,bank_transaction_id text,bank_match_id text,voucher_no text,evidence_status text,evidence jsonb,updated_at timestamptz,unique(tenant_id,data_environment,source_table,source_id,direction));
create function private.finance_bank_match_for_target(text,text,text) returns table(bank_match_id text,bank_transaction_id text,match_method text,matched_amount numeric,matched_at timestamptz) language sql stable as $$select null::text,null::text,null::text,null::numeric,null::timestamptz$$;
create function private.cash_document_is_void(text,text,timestamptz) returns bool language sql immutable as $$select false$$;
create function private.finance_income_step_user_id(jsonb) returns text language sql immutable as $$select coalesce($1->>'uid','')$$;
create function private.finance_expense_optional_permission_allows(uuid,text,text,jsonb) returns boolean language sql as $$select coalesce(current_setting('audit.permission',true),'true')<>'false'$$;
create function public.can_read_expense_request(public.expense_requests) returns boolean language sql stable as $$select $1.tenant_id=public.current_tenant_id() and exists(select 1 from public.finance_users where tenant_id=$1.tenant_id and auth_user_id=auth.uid() and active)$$;
grant usage on schema public,auth to authenticated;grant select,update on public.expense_requests to authenticated;
alter table public.expense_requests enable row level security;
create policy tenant_fixture on public.expense_requests to authenticated using(tenant_id=public.current_tenant_id()) with check(tenant_id=public.current_tenant_id());
`;
const originalLine={id:'line_1',netAmount:1000,taxAmount:50,grossAmount:1050,debitAccount:'6205',debitAccountName:'文具用品',creditAccount:'1112',creditAccountName:'銀行存款'};
function patch(amount=1150){const next=mark(clone(originalLine),{...clone(originalLine),netAmount:amount,taxAmount:0,grossAmount:amount,debitAccount:'6221',debitAccountName:'勞務費'},'approval_detail_review');return {amount,debit_account:next.debitAccount,debit_account_name:next.debitAccountName,credit_account:next.creditAccount,credit_account_name:next.creditAccountName,accounting_lines:[next],accounting_line_policy:'human_override_authoritative_v1'};}
async function as(db,id){await db.exec('set session authorization postgres');await db.exec(`set audit.uid='${auths[id]}';set audit.permission='true';set session authorization authenticated`);const row=(await db.query('select session_user')).rows[0];assert.strictEqual(row.session_user,'authenticated');}
async function admin(db,sql,args){await db.exec('set session authorization postgres');return args?db.query(sql,args):db.exec(sql);}
async function createRequest(db,id,paid=true,extra={}){const r={id,no:id,tenant_id:tenant,data_environment:'test',applicant_id:'other',applicant:'Anonymous employee',entity_id:'entity',department_code:'D1',type:'payment_request',amount:1050,status:'pending_voucher',step:paid?2:1,ver:1,updated_at:'2026-09-07T00:00:00Z',bank_fee_amount:15,cash_posted_at:paid?'2026-09-01T00:00:00Z':null,form_payload:{accountingLines:[clone(originalLine)]},steps:[...(paid?[{rk:'cashier',uid:'cashier',a:'approved',t:'2026-09-01'}]:[]),{rk:'accountant_final',uid:'accountant',a:'',status:'pending_voucher'}],...extra};await admin(db,'insert into public.expense_requests select * from jsonb_populate_record(null::public.expense_requests,$1)',[JSON.stringify(r)]);return r;}
async function action(db,actor,request,act,version,opts={}){await as(db,actor);return (await db.query('select public.finance_expense_correction_action_v1($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) result',[request,act,opts.key||('operation_'+(++seq)),version,opts.reason||'驗收更正原因',JSON.stringify(opts.patch||{}),opts.reviewer||null,opts.id||null,opts.bank||null,opts.environment||'test'])).rows[0].result;}
async function deny(label,fn,codes=['42501','22023','23514','23503','23505','40001','55000','P0002']){let e;try{await fn();}catch(x){e=x;}check(label,e&&codes.includes(e.code));}
async function saved(db,id){await db.exec('set session authorization postgres');return (await db.query('select * from public.expense_requests where id=$1',[id])).rows[0];}
async function propose(db,id,amount=1150,reviewer='reviewer'){return action(db,'accountant',id,'propose',1,{patch:patch(amount),reviewer});}

(async()=>{const db=new PGlite();try{
  await db.exec(schema);
  for(const [id,role] of [['accountant','accountant'],['reviewer','admin_director'],['cashier','ceo'],['other','employee']]){
    await db.query('insert into public.finance_users(id,tenant_id,auth_user_id,name,email,role,active) values($1,$2,$3,$1,$4,$5,true)',[id,tenant,auths[id],id+'@invalid',role]);
    await db.query('insert into public.employee_department_roles(tenant_id,finance_user_id,role_key) values($1,$2,$3)',[tenant,id,role]);
  }
  await db.query('insert into public.employee_department_roles(tenant_id,finance_user_id,department_code,role_key) values($1,$2,$3,$4)',[tenant,'cashier','A1000','cashier']);
  await db.exec("update public.employee_department_roles set department_code='A1000' where finance_user_id in ('reviewer','accountant')");
  await db.query('insert into public.system_settings values($1,$2,$3)',[tenant,'accounts',JSON.stringify([{c:'6205',n:'文具用品'},{c:'6221',n:'勞務費'},{c:'1112',n:'銀行存款'}])]);
  const functions=[...baseline.matchAll(/create or replace function private\.(finance_accounting_manual_fields|finance_accounting_line_is_human|finance_merge_human_accounting_line|finance_merge_human_accounting_lines)\([\s\S]*?\$function\$;/g)].map(x=>x[0]);assert.strictEqual(functions.length,4);
  await db.exec(functions.join('\n')+'\n'+read('scripts/fixtures/finance_procurement_guard_20260907.sql'));
  await db.exec(read('scripts/fixtures/finance_correction_dependencies_20260907.sql'));
  await db.exec('create trigger audit_direct_guard before update on public.expense_requests for each row execute function private.finance_expense_guard_direct_update();create trigger zz_human_preservation before update on public.expense_requests for each row execute function private.finance_preserve_human_accounting_authority()');
  await db.exec('begin;'+f01+'\ncommit;');await db.exec('begin;'+f05+'\ncommit;');
  await createRequest(db,'paid');
  await deny('Other employee cannot propose',()=>action(db,'other','paid','propose',1,{patch:patch(),reviewer:'reviewer'}));
  await deny('Proposer cannot self-assign review',()=>propose(db,'paid',1150,'accountant'));
  await deny('Stale request version rejected',()=>action(db,'accountant','paid','propose',0,{patch:patch(),reviewer:'reviewer'}));
  await deny('Cross-environment request rejected',()=>action(db,'accountant','paid','propose',1,{patch:patch(),reviewer:'reviewer',environment:'production'}));
  const wrong=patch();wrong.accounting_lines[0].manualOverrideBy.id='other';
  await deny('Forged human actor rejected',()=>action(db,'accountant','paid','propose',1,{patch:wrong,reviewer:'reviewer'}));
  const original=await saved(db,'paid'),proposedPatch=patch();
  const c=await action(db,'accountant','paid','propose',1,{patch:proposedPatch,reviewer:'reviewer',key:'stable_proposal_key'});
  check('Proposal does not change principal or accounting lines',JSON.stringify((await saved(db,'paid')).form_payload.accountingLines)===JSON.stringify(original.form_payload.accountingLines)&&(await saved(db,'paid')).amount==='1050');
  const replay=await action(db,'accountant','paid','propose',1,{patch:proposedPatch,reviewer:'reviewer',key:'stable_proposal_key'});
  check('Identical retry is idempotent',replay.idempotent_replay===true&&replay.correction_id===c.correction_id);
  await deny('Idempotency cannot authorize different content',()=>action(db,'accountant','paid','propose',1,{patch:patch(1200),reviewer:'reviewer',key:'stable_proposal_key'}));
  await deny('Self approval rejected',()=>action(db,'accountant','paid','approve',1,{id:c.correction_id}));
  await as(db,'accountant');await db.exec("set app.finance_expense_write_context='finalize'");
  await deny('Existing finalize marker cannot bypass pending correction',()=>db.query("update public.expense_requests set status='completed' where id='paid'"));
  await db.exec("set app.finance_expense_write_context=''");
  await admin(db,"update public.employee_department_roles set active=false where finance_user_id='reviewer'");
  await deny('Revoked reviewer cannot approve',()=>action(db,'reviewer','paid','approve',1,{id:c.correction_id}));
  await admin(db,"update public.employee_department_roles set active=true where finance_user_id='reviewer'");
  const approved=await action(db,'reviewer','paid','approve',1,{id:c.correction_id});
  check('Paid approval waits for real cash',approved.status==='pending_cash'&&(await saved(db,'paid')).amount==='1050');
  await deny('General employee cannot settle cash',()=>action(db,'other','paid','settle',2,{id:c.correction_id,bank:'bank'}));
  await deny('No real bank transaction cannot claim settlement',()=>action(db,'cashier','paid','settle',2,{id:c.correction_id,bank:'nonexistent'}));
  await admin(db,"insert into public.bank_transactions values('bank',$1,'test','entity',-100,'unmatched','2026-09-07','BANK-REAL-1',now()),('wrong-direction',$1,'test','entity',100,'unmatched','2026-09-07','BANK-WRONG',now()),('wrong-company',$1,'test','other',-100,'unmatched','2026-09-07','BANK-WRONG',now()),('old-bank',$1,'test','entity',-100,'unmatched','2026-08-01','BANK-OLD',now())",[tenant]);
  for(const bank of ['wrong-direction','wrong-company','old-bank'])await deny('Bank direction/entity/date validated',()=>action(db,'cashier','paid','settle',2,{id:c.correction_id,bank}));
  const settled=await action(db,'cashier','paid','settle',2,{id:c.correction_id,bank:'bank',key:'stable_settlement_key'});
  const after=await saved(db,'paid');
  check('Settlement applies corrected principal',settled.status==='applied'&&after.amount==='1150'&&after.status==='pending_voucher');
  check('Five manual fields survive proposal review and cash',after.form_payload.accountingLines[0].netAmount===1150&&after.form_payload.accountingLines[0].taxAmount===0&&after.form_payload.accountingLines[0].grossAmount===1150&&after.debit_account==='6221'&&after.credit_account==='1112');
  check('Frozen steps and original cash date remain unchanged',JSON.stringify(after.steps)===JSON.stringify(original.steps)&&new Date(after.cash_posted_at).getTime()===new Date(original.cash_posted_at).getTime());
  check('Original cash amount + signed real difference are separate',after.form_payload.cashAmount===1065&&after.form_payload.correctionCashEvents.length===1&&after.form_payload.correctionCashEvents[0].amount===-100);
  await db.query('select private.upsert_cash_evidence_for_expense($1)',['paid']);
  check('Cash evidence keeps original bank transfer amount',(await db.query("select amount from public.cash_movement_evidence_links where source_id='paid'")).rows[0].amount==='1065');
  await action(db,'cashier','paid','settle',2,{id:c.correction_id,bank:'bank',key:'stable_settlement_key'});
  await db.exec('set session authorization postgres');
  check('Retry does not duplicate cash or bank match',(await db.query("select count(*) n from public.bank_reconciliation_matches where bank_transaction_id='bank'")).rows[0].n===1);
  check('Transaction markers are restored',(await db.query("select current_setting('app.finance_expense_write_context',true) context,current_setting('app.finance_correction_write_id',true) marker")).rows[0].context==='');
  await as(db,'accountant');await db.exec("set app.finance_expense_write_context='active_step'");
  await deny('Cannot rewrite applied cash history with another RPC marker',()=>db.query("update public.expense_requests set form_payload=form_payload-'correctionCashEvents' where id='paid'"));await db.exec("set app.finance_expense_write_context=''");
  await createRequest(db,'unpaid',false);const un=await propose(db,'unpaid',950);const unApproved=await action(db,'reviewer','unpaid','approve',1,{id:un.correction_id});
  check('Unpaid correction applies after independent approval, without fake cash',unApproved.status==='applied'&&(await saved(db,'unpaid')).amount==='950'&&(await saved(db,'unpaid')).cash_posted_at===null);
  await createRequest(db,'refund');const re=await propose(db,'refund',950);await action(db,'reviewer','refund','approve',1,{id:re.correction_id});
  await admin(db,"insert into public.bank_transactions values('returned',$1,'test','entity',100,'unmatched','2026-09-07','ACTUAL-RETURN',now())",[tenant]);
  await action(db,'cashier','refund','settle',2,{id:re.correction_id,bank:'returned'});
  check('Lower paid expense requires actual incoming refund',(await saved(db,'refund')).form_payload.correctionCashEvents[0].amount===100);
  await createRequest(db,'reject');const rej=await propose(db,'reject');await action(db,'reviewer','reject','reject',1,{id:rej.correction_id});
  check('Rejection preserves approved principal',(await saved(db,'reject')).amount==='1050');
  await createRequest(db,'unassigned');const ua=await propose(db,'unassigned',1150,null);
  check('Missing reviewer leaves an unassigned pending proposal',ua.status==='pending_review');
  await deny('No fallback reviewer can approve unassigned proposal',()=>action(db,'cashier','unassigned','approve',1,{id:ua.correction_id}));
  await action(db,'accountant','unassigned','assign',1,{id:ua.correction_id,reviewer:'reviewer'});await action(db,'accountant','unassigned','cancel',2,{id:ua.correction_id});
  check('Proposer can cancel only before approval',(await saved(db,'unassigned')).form_payload.accountingCorrection.status==='cancelled');
  for(const type of ['advance_request','purchase_request','petty_cash_request','shareholder_transaction']){await createRequest(db,'special-'+type,true,{type});await deny('Special settlement contract not bypassed',()=>propose(db,'special-'+type));}
  await as(db,'other');await deny('Private correction table is inaccessible',()=>db.query('select * from private.expense_accounting_corrections_v1'));
  await db.exec('set session authorization postgres');check('Every successful operation has an immutable actor audit',(await db.query("select count(*) n from public.module_audit_logs where table_name='expense_accounting_corrections'")).rows[0].n>=12);
  console.log('PASS: '+passed+' F05 transactional PostgreSQL checks (anonymous isolated fixtures; no live writes)');
}finally{await db.close();}})().catch(e=>{console.error({message:e.message,code:e.code,detail:e.detail,where:e.where,stack:e.code?undefined:e.stack});process.exitCode=1;});
