#!/usr/bin/env node
'use strict';
// Actual canonical AR readers and deployed Google/tenant/row authority, with
// entirely fictional local identities and financial rows. No network transport.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {performance}=require('node:perf_hooks');
const {PGlite}=require('@electric-sql/pglite');
const {createArMappingFixture}=require('./check_ar_mapping_performance.cjs');
const {cases:identityCases}=require('./check_invoice_select_initplan.cjs');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const migrationPath='supabase/migrations/20260922072737_finance_ar_verified_accounting_scope_v1.sql';
const targets=['private.finance_receivables_payload_v1(date,text,text,text,boolean)','private.finance_ar_reconciliation_scope_v1(uuid,text,date,text,text)'];
let checks=0;const check=(value,label)=>{assert.ok(value,label);checks++;};
const equal=(actual,expected,label)=>{assert.deepEqual(actual,expected,label);checks++;};

async function createFixture(db){
 const f=await createArMappingFixture(db,{seed:false});
 await db.exec('alter table public.invoices add column applicant text;');
 // Execute the unchanged real financial writers before switching the local
 // fixture transport to the full deployed Google identity implementation.
 const partial=await f.make(db,'AR-PARTIAL',100,{applicant_id:'employee'});
 await f.allowance(db,'AR-PARTIAL',20,'AR-PARTIAL-ALLOW',f.prior);
 await f.receipt(db,'accountant',['AR-PARTIAL'],'submit',{files:partial,amounts:{'AR-PARTIAL':40},date:f.prior});
 await f.receipt(db,'ceo',['AR-PARTIAL'],'approve');
 const refund=await f.make(db,'AR-REFUND',100,{department_code:'OTHER'});
 await f.receipt(db,'accountant',['AR-REFUND'],'submit',{files:refund,amounts:{'AR-REFUND':100},date:f.prior});
 await f.receipt(db,'ceo',['AR-REFUND'],'approve');
 const event=await f.allowance(db,'AR-REFUND',20,'AR-REFUND-ALLOW',f.prior);
 await f.refund(db,event.event_id,4,0,{date:f.today});
 const pending=await f.make(db,'AR-PENDING',80);
 await f.receipt(db,'accountant',['AR-PENDING'],'submit',{files:pending,amounts:{'AR-PENDING':25},date:f.today});
 await f.make(db,'AR-UNRECOGNIZED',45,{revenue_posted:false});
 await f.make(db,'AR-AUDITOR',35,{steps:[{roleKey:'external_audit'}],revenue_posted:false});
 await f.make(db,'AR-BOARD',55,{steps:[{roleKey:'board'}],revenue_posted:false});
 await f.make(db,'AR-PARTICIPANT',65,{steps:[{uid:'employee',a:'approved'}],revenue_posted:false});
 await f.make(db,'AR-ACTION',75,{steps:[{actionLog:[{actorFinanceUserId:'employee',status:'approved'}]}],revenue_posted:false});
 await f.make(db,'AR-FUTURE',90,{invoice_date:'2099-01-01',revenue_posted:false});
 await f.make(db,'AR-OTHER-COMPANY',110,{entity_id:'FICT-OTHER'});
 await f.make(db,'AR-PRODUCTION',120,{data_environment:'production'});
 await f.make(db,'AR-FOREIGN',130,{tenant_id:f.other});
 await f.make(db,'AR-NULL-TENANT',140,{tenant_id:null,revenue_posted:false});
 await f.make(db,'AR-NULL-FIELDS',15,{department_code:null,steps:null});
 await f.admin(db,"set audit.uid=''");
 await db.query(`insert into public.ledger_entries(tenant_id,data_environment,entry_date,entity_id,department_code,account_code,debit,credit,source_type,source_id,posting_key)
  values($1,'test',$2,'FICT-CO','FICT-D','1123',17,17,'adjustment','unlinked','AR-unlinked')`,[f.tenant,f.prior]);
 await db.query(`insert into private.finance_ar_terms_v1(tenant_id,data_environment,invoice_id,metadata,version,updated_by)
  values($1,'test','AR-PARTIAL',$2,3,'accountant')`,[f.tenant,JSON.stringify({dueDate:f.prior,ownerId:'employee',notes:'Fictional collection note'})]);
 await db.query(`insert into public.bank_transactions(id,tenant_id,data_environment,entity_id,transaction_date,amount,match_status)
  values('AR-BANK',$1,'test','FICT-CO',$2,40,'unmatched')`,[f.tenant,f.prior]);
 await db.query(`insert into public.bank_reconciliation_matches(tenant_id,data_environment,bank_transaction_id,target_table,target_id,matched_amount,matched_at,created_at)
  values($1,'test','AR-BANK','invoices','AR-PARTIAL',15,$2::date,$2::date)`,[f.tenant,f.prior]);
 await db.exec(`
  create table auth.users(id uuid primary key);
  create table auth.identities(id uuid primary key default gen_random_uuid(),user_id uuid,provider text,identity_data jsonb,created_at timestamptz default now());
  create table public.tenants(id uuid primary key,slug text);
  create table public.tenant_members(id uuid primary key default gen_random_uuid(),tenant_id uuid,auth_user_id uuid,email text,active boolean,created_at timestamptz default now());
  alter table public.finance_users add column department_code text default 'FICT-D',add column created_at timestamptz default now();
  create or replace function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 `);
 await db.query('insert into public.tenants values($1,\'suiyuecare\'),($2,\'fictional-other\')',[f.tenant,f.other]);
 const actors={};
 for(const [n,role]of ['employee','accountant','ceo','admin_director','dept_manager','section_chief','hr','general_affairs','external_audit','board','inactive','unverified','foreign'].entries()){
  const id=role==='admin_director'?'director':role,existing=(await db.query('select auth_user_id from public.finance_users where id=$1',[id])).rows[0];
  const a=actors[role]={id,uid:existing?.auth_user_id||`10000000-0000-0000-0000-${String(n+1).padStart(12,'0')}`,email:`ar-${role}@suiyuecare.com`,name:`Fictional ${role}`};
  const tenant=role==='foreign'?f.other:f.tenant;
  await db.query('insert into auth.users values($1)',[a.uid]);
  await db.query("insert into auth.identities(user_id,provider,identity_data) values($1,'google',$2)",[a.uid,JSON.stringify({email:a.email,email_verified:role!=='unverified'})]);
  await db.query(`insert into public.finance_users(id,tenant_id,auth_user_id,name,email,role,active,google_link_status,department_code) values($1,$2,$3,$4,$5,$6,$7,'bound','FICT-D')
   on conflict(id) do update set name=excluded.name,email=excluded.email,role=excluded.role,active=excluded.active`,[id,tenant,a.uid,a.name,a.email,role==='foreign'?'accountant':role,role!=='inactive']);
  await db.query('insert into public.tenant_members(tenant_id,auth_user_id,email,active) values($1,$2,$3,true)',[tenant,a.uid,a.email]);
 }
 await db.exec(read('scripts/fixtures/finance_statement_source_authority_20260913.sql'));
 // The older writer fixture copied this real function body without its final
 // deployment REVOKE. Restore the production private-helper ACL, not the guard.
 await db.exec('revoke all on function private.finance_correction_actor_v1() from public,anon,authenticated,service_role;');
 await db.query("update public.system_settings set value=$1 where tenant_id=$2 and key='role_permissions'",[JSON.stringify(Object.fromEntries(['accountant','ceo','admin_director','external_audit','board'].map(r=>[r,{reports:'edit'}]))),f.tenant]);
 await db.query("insert into public.system_settings(tenant_id,key,value) values($1,'entities',$2),($1,'role_permissions',$3)",[f.other,JSON.stringify([{id:'FICT-CO'}]),JSON.stringify({accountant:{reports:'edit'}})]);
 await db.exec(`create table public.membership_users(id uuid,tenant_id uuid,legacy_finance_user_id text,auth_user_id uuid,status text);
  insert into public.membership_users select auth_user_id,tenant_id,id,auth_user_id,'active' from public.finance_users;
  create function public.membership_current_user_id() returns uuid language sql stable as $$select auth.uid()$$;
  create function public.membership_has_explicit_deny(uuid,text,jsonb) returns boolean language sql stable as $$select coalesce(current_setting('audit.denied_entity',true),'')=$3->>'entity_id' or coalesce(current_setting('audit.denied_department',true),'')=coalesce($3->>'department_code','__none__')$$;
  create function public.membership_can(uuid,text,jsonb) returns boolean language sql stable as $$select coalesce(current_setting('audit.member_allow',true),'true')='true'$$;`);
 // A transaction-local custom GUC leaves an empty setting after its first
 // rollback. Give the fictional membership transport an explicit baseline.
 await db.exec("set audit.member_allow='true';set audit.denied_entity='';set audit.denied_department='';");
 return {...f,actors};
}
async function transaction(db,work){await db.exec('begin');try{return await work();}finally{await db.exec('rollback');}}
async function setActor(db,actor,requestedTenant=''){
 await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('app.current_tenant_id',$2,true)",[actor?.uid||'',requestedTenant]);
 await db.exec('set local role authenticated');
}
async function snapshot(db,f,test){return transaction(db,async()=>{
 if(test.setup)await test.setup(db,test.actor);
 await setActor(db,test.actor,test.requestedTenant||'');
 const values=[];
 for(const [entity,department,date,environment]of test.scopes||[[null,null,f.today,'test'],['FICT-CO','FICT-D',f.today,'test'],[null,null,f.prior,'test'],[null,null,f.today,'production']]){
  await db.exec('savepoint ar_read');
  try{values.push((await db.query(test.dashboard?'select public.finance_executive_dashboard_v3($1,$1,$1,$1,$1,$2,$3) result':'select public.finance_receivables_v1($1,$2,$3,$4) result',test.dashboard?[date,entity,environment]:[date,entity,department,environment])).rows[0].result);}
  catch(error){await db.exec('rollback to savepoint ar_read');if(!['42501','22023'].includes(error.code))throw error;values.push({denied:error.code});}
 }
 return values;
});}
async function catalog(db){return(await db.query(`select jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'owner',p.proowner,'acl',p.proacl,'config',p.proconfig,'definer',p.prosecdef,'volatile',p.provolatile,'source',case when p.oid=any($1::regprocedure[]) then null else p.prosrc end) order by p.oid) result from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private','auth')`,[targets])).rows[0].result;}
async function sourceFingerprint(db){const parts=[];for(const table of ['public.invoices','public.ledger_entries','public.invoice_lifecycle_events','private.finance_ar_receipts_v1','private.finance_ar_refunds_v1','private.finance_ar_terms_v1','public.bank_transactions','public.bank_reconciliation_matches','public.finance_users','auth.users','auth.identities','public.membership_users'])parts.push((await db.query(`select md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' order by to_jsonb(t)::text),'')) hash from ${table} t`)).rows[0].hash);return parts;}
async function readers(db){return(await db.query('select pg_get_functiondef(signature::regprocedure) definition from unnest($1::text[]) signature',[targets])).rows.map(r=>r.definition).join(';\n')+';';}
async function run({db=new PGlite()}={}){
 try{
  const f=await createFixture(db),matrix=identityCases(f.actors),before=new Map(),oldReaders=await readers(db),beforeCatalog=await catalog(db),beforeData=await sourceFingerprint(db);
  for(const [name,setup,scopes]of [
   ['reports-disabled',db=>db.exec("update public.system_settings set value=jsonb_set(value,'{ceo,reports}','\"none\"') where key='role_permissions'" )],
   ['denied-company',db=>db.exec("set local audit.denied_entity='FICT-OTHER'")],
   ['denied-department',db=>db.exec("set local audit.denied_department='OTHER'")],
   ['membership-revoked',db=>db.exec("set local audit.member_allow='false'")],
   ['membership-wrong-link',db=>db.exec("update public.membership_users set legacy_finance_user_id='wrong' where legacy_finance_user_id='ceo'")],
   ['unknown-company',null,[['UNKNOWN',null,f.today,'test']]],
   ['empty-company',null,[['EMPTY',null,f.today,'test']]],
   ['null-cutoff',null,[[null,null,null,'test']]],
   ['bad-environment',null,[[null,null,f.today,'bad']]]
  ])matrix.push({name,actor:f.actors.ceo,setup,scopes});
  for(const role of ['ceo','accountant','admin_director','external_audit','board','employee'])matrix.push({name:'dashboard/'+role,actor:f.actors[role],dashboard:true,scopes:[['FICT-CO',null,f.today,'test']]});
  for(const test of matrix)before.set(test.name,await snapshot(db,f,test));
  const ceo=before.get('ceo')[0],partial=ceo.items.find(x=>x.invoiceId==='AR-PARTIAL'),refund=ceo.items.find(x=>x.invoiceId==='AR-REFUND');
  equal([partial.recognizedAmount,partial.arAllowanceAmount,partial.receivedAmount,partial.outstandingAmount],[100,20,40,40],'actual writers create recognized less allowance less partial receipt');
  equal([refund.refundedAmount,refund.refundPayable],[4,16],'actual partial refund preserves remaining payable');
  equal(ceo.items.find(x=>x.invoiceId==='AR-PENDING').pendingReceiptAmount,25,'pending receipt is not treated as posted cash');
  equal(ceo.reconciliation.unmappedDebitAmount,17,'gross unlinked debit retained');equal(ceo.reconciliation.unmappedCreditAmount,17,'gross unlinked credit retained');
  check(ceo.reconciliation.needsReview,'offsetting unlinked entries still require review');
  equal(ceo.reconciliation.unmatchedBankAmount,25,'bank remaining equals amount less dated matches');
  for(const role of ['external_audit','board','employee','dept_manager','section_chief'])check(before.get(role)[0].totalCount<ceo.totalCount,role+' retains its original row restrictions');
  for(const name of ['missing-auth','inactive','unverified','foreign-tenant-request'])equal(before.get(name)[0],{denied:'42501'},name+' actually denied by the deployed identity functions');
  check(before.get('foreign')[0].items.every(i=>i.invoiceId==='AR-FOREIGN'),'foreign valid identity only receives its own tenant');
  for(const name of ['reports-disabled','denied-company','denied-department','membership-revoked','membership-wrong-link'])equal(before.get(name)[0].reconciliation.reconciliationVisible,false,name+' hides complete ledger totals');
  const migration=read(migrationPath);check(migration.trim().length>100,'candidate migration exists');
  await transaction(db,()=>db.exec(migration));equal(await readers(db),oldReaders,'migration rehearsal rolls back both complete readers');equal(await sourceFingerprint(db),beforeData,'rehearsal leaves all identity and financial rows intact');
  await db.exec(migration);
  equal(await catalog(db),beforeCatalog,'only two reader bodies change; all other functions, ACLs, owners, volatility and search paths retained');
  for(const test of matrix)equal(await snapshot(db,f,test),before.get(test.name),test.name+': every response item, total, amount, cutoff, receipt, refund and scope flag matches original');
  equal(await sourceFingerprint(db),beforeData,'migration and read-only role matrix leave source and identity bytes unchanged');
  await db.exec(read('scripts/finance_ar_verified_accounting_scope_postflight.sql').replace(/^\\set ON_ERROR_STOP on\r?\n/,''));checks++;
  const canary=await db.exec(read('scripts/finance_ar_verified_accounting_scope_canary.sql'));
  equal(canary.at(-1).rows[0].ar_verified_accounting_scope_canary_result,{canary:'readonly_ar_verified_accounting_scope_v1',ok:true,rolled_back:true,ordinary_scope_preserved:true},'exact protected canary proves anonymous and private-role boundaries');
  equal(await sourceFingerprint(db),beforeData,'exact canary leaves all financial and identity data unchanged');
  for(const role of ['anon','service_role'])await transaction(db,async()=>{await db.exec('set local role '+role);await assert.rejects(()=>db.query("select public.finance_receivables_v1(current_date,null,null,'test')"),e=>e.code==='42501');checks++;});
  // Scale the exact public reader, not a simplified mapper, to > 1000 invoices.
  await db.query(`insert into public.invoices(id,no,tenant_id,data_environment,entity_id,department_code,invoice_date,total,amount,tax,status,approval_status,steps)
   select 'AR-BULK-'||n,'AR-BULK-'||n,$1,'test','FICT-CO','FICT-D',$2,100,100,0,'unpaid','draft','[]' from generate_series(1,1000)n`,[f.tenant,f.prior]);
  await db.query(`insert into public.ledger_entries(tenant_id,data_environment,entry_date,entity_id,department_code,account_code,debit,credit,source_type,source_id,reference_no,posting_key)
   select $1,'test',$2,'FICT-CO','FICT-D','1123',100,0,'invoice','AR-BULK-'||n,'AR-BULK-'||n,'AR-bulk-'||n from generate_series(1,1000)n`,[f.tenant,f.prior]);
  const candidateReaders=await readers(db),perf=[];
  for(const role of ['ceo','accountant','admin_director']){
   const old=await transaction(db,async()=>{await db.exec(oldReaders);await setActor(db,f.actors[role]);const start=performance.now();const result=(await db.query('select public.finance_receivables_v1($1,null,null,\'test\') result',[f.today])).rows[0].result;return{result,ms:performance.now()-start};});
   const samples=[];let current;
   for(let n=0;n<3;n++)await transaction(db,async()=>{await setActor(db,f.actors[role]);const start=performance.now();current=(await db.query('select public.finance_receivables_v1($1,null,null,\'test\') result',[f.today])).rows[0].result;samples.push(performance.now()-start);});
   equal(current,old.result,role+': all >1000 rows and complete financial payload match original reader');
   check(current.totalCount>1000,role+': production-scale dataset really read');
   check(Math.max(...samples)<3000,role+': every complete local optimized RPC is below 3 seconds');
   perf.push({role,rows:current.totalCount,originalMs:old.ms,candidateMs:samples});
  }
  equal(await readers(db),candidateReaders,'timed old-reader oracle is rolled back');
  // Instrument only a separate local transaction after byte-equivalence has
  // passed: the unchanged row authorization body still executes underneath.
  const authority=(await db.query("select pg_get_functiondef('public.can_read_invoice(public.invoices)'::regprocedure) definition")).rows[0].definition;
  const instrumentation=authority.replace('FUNCTION public.can_read_invoice(', 'FUNCTION private.fixture_original_can_read_invoice(')+`;\n
   create or replace function public.can_read_invoice(p_invoice public.invoices) returns boolean language plpgsql stable set search_path='' as $count$
   begin perform set_config('audit.invoice_read_calls',(coalesce(nullif(current_setting('audit.invoice_read_calls',true),''),'0')::int+1)::text,true);
    return private.fixture_original_can_read_invoice(p_invoice);end;$count$;`;
  const calls=[];
  for(const role of ['ceo','accountant','admin_director','employee','external_audit','board']){
   const counts={role};
   for(const variant of ['original','candidate'])counts[variant]=await transaction(db,async()=>{
    if(variant==='original')await db.exec(oldReaders);
    else await db.exec(candidateReaders.replaceAll(' v_invoice_accounting:='," perform set_config('audit.cached_accounting_calls',(coalesce(nullif(current_setting('audit.cached_accounting_calls',true),''),'0')::int+1)::text,true);\n v_invoice_accounting:="));
    await db.exec(instrumentation);await db.exec("set local audit.invoice_read_calls='0';set local audit.cached_accounting_calls='0'");await setActor(db,f.actors[role]);
    await db.query('select public.finance_receivables_v1($1,null,null,\'test\')',[f.today]);
    if(variant==='candidate')counts.cachedPredicateEvaluations=Number((await db.query("select current_setting('audit.cached_accounting_calls',true) n")).rows[0].n);
    return Number((await db.query("select current_setting('audit.invoice_read_calls',true) n")).rows[0].n);
   });
   equal(counts.cachedPredicateEvaluations,role==='employee'?1:2,role+': cached predicate executes once per eligible reader, independent of invoice count');
   if(['ceo','accountant','admin_director'].includes(role)){check(counts.original>2000,role+': original RPC repeats row authority in both scans');equal(counts.candidate,0,role+': verified accounting predicate is cached outside invoice scans');}
   else equal(counts.candidate,counts.original,role+': restricted users execute the full original per-row authority');
   calls.push(counts);
  }
  equal(await readers(db),candidateReaders,'local instrumentation restores exact candidate readers');
  const result={ok:true,checks,equivalenceCases:matrix.length,performance:perf,rowAuthorizationCalls:calls,authority:'Actual deployed Google identity, tenant and can_read_invoice definitions; fictional local users and records',productionWrites:0};
  console.log(JSON.stringify(result));return result;
 }finally{await db.close();}
}
module.exports={run,createFixture,snapshot,migrationPath};
if(require.main===module)run().catch(error=>{console.error(error);process.exitCode=1;});
