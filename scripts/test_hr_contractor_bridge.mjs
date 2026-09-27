// Synthetic browser -> real SQL posting -> ledger -> callback. No live data/banking.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import http from 'node:http';
const db=new PGlite();let checks=0;
const eq=(a,b,msg)=>{assert.deepEqual(a,b,msg);checks++};
const reject=async(fn,pattern)=>{await assert.rejects(fn,pattern);checks++};
const tenant=randomUUID(),employer=randomUUID(),applicant=randomUUID(),accountant=randomUUID(),director=randomUUID(),ceo=randomUUID();
async function role(name,id=''){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec(`set role ${name}`);}
async function rpc(name,args={}){return(await db.query(`select public.${name}(${Object.keys(args).map((k,i)=>`${k}=>$${i+1}`).join(',')}) r`,Object.values(args))).rows[0].r;}
const ev=k=>({kind:k,reference:'SYNTHETIC',sha256:'a'.repeat(64),...(['bank_batch_validation','bank_upload','bank_disbursement'].includes(k)?{totalNetCents:123456}:{})});
try {
await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema private;grant usage on schema auth to authenticated,service_role;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create table public.finance_users(id text primary key,tenant_id uuid,auth_user_id uuid,name text,active boolean,role text);
create function public.current_finance_user() returns public.finance_users language sql stable security definer set search_path='' as $$select f from public.finance_users f where auth_user_id=auth.uid() and active$$;
create function public.current_finance_user_id() returns text language sql stable as $$select (public.current_finance_user()).id$$;
create function public.current_tenant_id() returns uuid language sql stable as $$select (public.current_finance_user()).tenant_id$$;
create function public.current_finance_user_name() returns text language sql stable as $$select (public.current_finance_user()).name$$;
create function private.finance_require_authenticated_tenant() returns uuid language sql stable as $$select public.current_tenant_id()$$;
create function public.current_finance_role() returns text language sql stable as $$select (public.current_finance_user()).role$$;
create function public.finance_current_verified_google_email_v2() returns text language sql stable as $$select case when auth.uid() is not null then 'synthetic@example.invalid' end$$;
create function public.is_finance_accounting() returns boolean language sql stable as $$select public.current_finance_role() in('accountant','ceo','admin_director')$$;
create function private.finance_expense_optional_permission_allows(uuid,text,text,jsonb) returns boolean language sql stable as $$select current_setting('test.membership_denied',true) is distinct from 'yes'$$;
create table public.system_settings(tenant_id uuid,key text,value jsonb);
create table public.period_closes(tenant_id uuid,data_environment text,entity_id text,period text,status text);
create table public.voucher_serials(tenant_id uuid,data_environment text,kind text,year integer,last_no integer,updated_at timestamptz,unique(data_environment,kind,year));
create table public.vouchers(id text primary key,no text,request_id text,entity_id text,entity_name text,voucher_date date,description text,entries jsonb,total numeric,creator text,posted boolean,posted_at timestamptz,posting_locked_at timestamptz,voided_at timestamptz,data_environment text,tenant_id uuid,adjusts_voucher_no text,adjustment_type text,created_at timestamptz default now());
create table public.ledger_entries(id uuid primary key default gen_random_uuid(),entry_date date,description text,entity_id text,department_code text,debit numeric,credit numeric,account_code text,account_name text,reference_no text,posting_key text unique,source_type text,source_id text,source_no text,voucher_no text,data_environment text,tenant_id uuid,voided_at timestamptz);
create unique index existing_ledger_key on public.ledger_entries(data_environment,posting_key) where posting_key is not null;
create table public.file_attachments(tenant_id uuid,record_type text,record_no text,data_environment text,bucket_id text,storage_path text);
create table public.cash_movement_evidence_links(tenant_id uuid,entity_id text,data_environment text,amount numeric);
create table public.finance_ledger_source_chains(tenant_id uuid,entity_id text,data_environment text,amount numeric);
create table public.accounting_posting_locks(tenant_id uuid,entity_id text,data_environment text,amount numeric);
create table public.cash_flow_bank_support_cases(tenant_id uuid,entity_id text,data_environment text,amount numeric);
`);
const baseline=JSON.parse(await fs.readFile(new URL('./fixtures/finance_hr_voucher_baseline_20260922.json',import.meta.url),'utf8'));
for(const f of baseline)await db.exec(f.definition);
await db.exec(`create trigger immutable before update or delete on public.vouchers for each row execute function public.prevent_posted_voucher_mutation();create trigger immutable before update or delete on public.ledger_entries for each row execute function public.prevent_posted_ledger_mutation();
do $$declare t text;begin foreach t in array array['vouchers','ledger_entries','file_attachments','cash_movement_evidence_links','finance_ledger_source_chains','accounting_posting_locks','cash_flow_bank_support_cases'] loop execute format('alter table public.%I enable row level security',t);execute format('grant select,insert,update,delete on public.%I to authenticated',t);execute format('create policy existing_accounting on public.%I for all to authenticated using(true) with check(true)',t);end loop;end $$;`);
for(const migration of ['20260922072109_finance_hr_private_bridge_v1.sql','20260922075604_finance_hr_voucher_posting_v1.sql','20260927175827_finance_hr_native_contractor_bridge.sql','20260927180005_finance_hr_contractor_settlement_caption.sql'])await db.exec(await fs.readFile(new URL('../supabase/migrations/'+migration,import.meta.url),'utf8'));
eq((await db.query("select position('v_invoice_accounting' in prosrc)>0 preserved from pg_proc where oid='private.finance_ar_reconciliation_scope_v1(uuid,text,date,text,text)'::regprocedure")).rows[0].preserved,true,'preserve merged verified accounting optimization');
await db.query(`insert into public.finance_users values ('accountant',$1,$2,'Accounting',true,'accountant'),('director',$1,$3,'Director',true,'admin_director'),('ceo',$1,$4,'CEO',true,'ceo')`,[tenant,accountant,director,ceo]);
await db.query(`insert into public.system_settings values($1,'accounts','[{"c":"2134","n":"應付薪資","on":true},{"c":"6111","n":"合成服務費","on":true},{"c":"2151","n":"合成代扣所得稅","on":true},{"c":"2152","n":"合成代扣補充保費","on":true},{"c":"1112","n":"銀行存款","on":true},{"c":"1144","n":"進項稅額","on":true},{"c":"9999","n":"停用科目","on":false}]')`,[tenant]);
await db.query(`insert into finance_hr_private.finance_hr_salary_readers(tenant_id,source_employer_id,finance_user_id,business_role,verified_at,verified_by,evidence_reference,effective_from) values($1,$2,'accountant','accounting',now(),'fixture','SYNTHETIC',now()),($1,$2,'ceo','ceo',now(),'fixture','SYNTHETIC',now())`,[tenant,employer]);
await db.query(`insert into finance_hr_private.finance_hr_routes(tenant_id,source_employer_id,source_applicant_id,legal_entity_code,version,bank_actor,account_actor,cashier_actor,voucher_actor,verified_at,verified_by,evidence_reference,effective_from,active) values($1,$2,$3,'E1',1,'accountant','ceo','ceo','accountant',now(),'fixture','SYNTHETIC',now(),true)`,[tenant,employer,applicant]);
const contractor=randomUUID(),settlementId=randomUUID(),serviceId=randomUUID(),taxRunId=randomUUID();
const recipient={contractorId:contractor,payeeName:'合成講師 <未發布>',incomeCode:'9B',grossCents:150000,withholdingCents:15000,supplementaryCents:11544,netCents:123456,settlementId,taxRunId};
const source={recipients:[recipient],totalNetCents:123456,settlementId,serviceId,taxRunId,ruleYear:2026,ruleRevision:1};
async function envelope(src=source,kind='contractor',id=randomUUID()){
 await role('postgres');const sourceHash=(await db.query('select finance_hr_private.finance_hr_hash($1) h',[src])).rows[0].h;
 return {schemaVersion:1,kind,obligationId:id,flowId:id,sourceEmployerId:employer,originalApplicantId:applicant,revision:1,sourceHash,source:src,period:'2026-09',payDate:'2026-10-15',amountMeaning:'calculated_net',paymentReady:false};
}
async function intake(e,event=randomUUID()){await role('service_role');return rpc('finance_hr_intake',{p_event_id:event,p_envelope:e});}
async function invalid(src,pattern=/CONTRACTOR_(LINE|SOURCE)_INVALID/){const e=await envelope(src);await reject(()=>intake(e),pattern);}
// envelope() computes its hash as owner, so make authorization call after preparation.
const valid=await envelope(),eventId=randomUUID();await role('authenticated',accountant);await reject(()=>rpc('finance_hr_intake',{p_event_id:eventId,p_envelope:valid}),/permission denied/);
await invalid({...source,employees:[{employeeId:contractor,netCents:123456}]});
await invalid({...source,recipients:[{...recipient,employeeId:contractor}]});
await invalid({...source,recipients:[{...recipient,contractorId:null}]});
await invalid({...source,recipients:[{...recipient,incomeCode:'unsupported'}]});
await invalid({...source,recipients:[{...recipient,payeeName:'x'.repeat(201)}]});
await invalid({...source,recipients:[{...recipient,payeeName:'  '}]});
await invalid({...source,recipients:[{...recipient,taxIdentifier:'PRIVATE-NOT-FINANCE'}]});
await invalid({...source,recipients:[{...recipient,taxRunId:randomUUID()}]});
await invalid({...source,recipients:[{...recipient,settlementId:randomUUID()}]});
for(const key of ['grossCents','withholdingCents','supplementaryCents','netCents']){
 await invalid({...source,recipients:[{...recipient,[key]:null}]});
 await invalid({...source,recipients:[{...recipient,[key]:1.5}]});
}
await invalid({...source,recipients:[{...recipient,netCents:123455}]});
await invalid({...source,recipients:[{...recipient,withholdingCents:150001}]});
await invalid({...source,recipients:[recipient,{...recipient,contractorId:contractor.toUpperCase()}],totalNetCents:246912},/DUPLICATE_CONTRACTOR/);
await invalid({...source,totalNetCents:123457},/TOTAL_MISMATCH/);
await invalid({...source,recipients:Array.from({length:501},()=>({...recipient,contractorId:randomUUID()}))},/SOURCE_LINES_REQUIRED/);
await invalid({...source,ruleRevision:0});await invalid({...source,ruleYear:null});
const invalidHash={...valid,sourceHash:'0'.repeat(64)};await reject(()=>intake(invalidHash),/SOURCE_INVALID/);
const missingRoute={...valid,originalApplicantId:randomUUID()};await reject(()=>intake(missingRoute),/ROUTE_UNVERIFIED/);
eq((await intake(valid,eventId)).status,'awaiting_payment_validation');eq((await intake(valid,eventId)).replayed,true);
eq((await intake(valid,randomUUID())).replayed,true,'lost acknowledgment with fresh transport event retains obligation');
await reject(()=>intake({...valid,payDate:'2026-10-16'},eventId),/REPLAY_CONFLICT/);
await reject(()=>intake({...valid,payDate:'2026-10-16'}),/OBLIGATION_CONFLICT/);
await role('authenticated',director);eq((await rpc('finance_hr_snapshot')).obligations,[]);await reject(()=>rpc('finance_hr_voucher_options',{p_obligation_id:valid.obligationId}),/FORBIDDEN/);
await role('authenticated',accountant);const saved=(await rpc('finance_hr_snapshot')).obligations[0];eq(saved.kind,'contractor');eq(saved.source,source);eq(saved.totalNetCents,123456);
await reject(()=>db.query('select * from finance_hr_private.finance_hr_obligations'),/permission denied/);
const command=(action,version,user,evidence=ev(action),request=randomUUID())=>role('authenticated',user).then(()=>rpc('finance_hr_command',{p_obligation_id:valid.obligationId,p_expected_version:version,p_request_id:request,p_action:action,p_evidence:evidence}));
await reject(()=>command('bank_disbursement',1,accountant),/ACTION_OUT_OF_ORDER/);
await reject(()=>command('bank_batch_validation',1,accountant,{...ev('bank_batch_validation'),totalNetCents:150000}),/AMOUNT_MISMATCH/);
let browserFirst=false;
if(process.env.HR_BRIDGE_BROWSER==='1'){
 const engine=await fs.readFile(new URL('../assets/engines/hr-bridge-engine.js',import.meta.url),'utf8'),css=await fs.readFile(new URL('../assets/styles/finance-core.css',import.meta.url),'utf8');
 const server=http.createServer(async(req,res)=>{try{
  if(req.method==='POST'){let raw='';for await(const c of req)raw+=c;const {name,args}=JSON.parse(raw);if(!['finance_hr_snapshot','finance_hr_command','finance_hr_callback_authorize'].includes(name))throw Error('unexpected RPC');await role('authenticated',accountant);let data;try{data={data:await rpc(name,args),error:null}}catch(e){data={data:null,error:{message:e.message,code:e.code}}}res.setHeader('content-type','application/json');res.end(JSON.stringify(data));return}
  if(req.url==='/engine.js'){res.setHeader('content-type','application/javascript');res.end(engine);return}if(req.url==='/style.css'){res.setHeader('content-type','text/css');res.end(css);return}
  res.setHeader('content-type','text/html');res.end('<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><body style="display:block;padding:12px;height:auto;overflow:auto"><main id="bridge"></main><script src="/engine.js"></script><script>FinanceHrBridge.mount(document.querySelector("#bridge"),{userId:"accountant",isCurrent:()=>true,client:{rpc:async(name,args)=>(await fetch("/rpc",{method:"POST",body:JSON.stringify({name,args})})).json(),functions:{invoke:async()=>({data:{accepted:true,callbackPending:false}})}}});</script></html>');
 }catch{res.statusCode=500;res.end('isolated fixture error')}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const {chromium}=await import('playwright');const browser=await chromium.launch();try{
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(`http://127.0.0.1:${server.address().port}`);
  const card=page.locator('section.card').filter({hasText:valid.obligationId});await card.locator('form').waitFor();eq(await card.locator('h2').innerText(),'2026-09 外聘服務結算 · E1');
  for(const width of [1280,768,390,320]){await page.setViewportSize({width,height:960});eq(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'no overflow '+width)}
  await card.locator('input[name=reference]').fill('SYNTHETIC-CONTRACTOR-BANK-001');await card.locator('input[name=amount]').fill('1500');await card.locator('input[type=file]').setInputFiles({name:'synthetic.pdf',mimeType:'application/pdf',buffer:Buffer.from('synthetic contractor evidence')});await card.locator('button[type=submit]').click();await page.getByText('佐證總額與人資核准實發總額不符，尚未送出。').waitFor();checks++;
  await card.locator('input[name=amount]').fill('1234.56');await card.locator('button[type=submit]').click();await card.getByText('會計上傳兆豐 · 預定發放 2026-10-15',{exact:true}).waitFor();checks++;browserFirst=true;
  await fs.mkdir('outputs/readiness-release',{recursive:true});await page.screenshot({path:'outputs/readiness-release/contractor-finance-mobile.png',fullPage:true});eq(errors,[]);
 }finally{await browser.close();await new Promise(r=>server.close(r))}
}
if(!browserFirst)await command('bank_batch_validation',1,accountant);
await command('bank_upload',2,accountant);await reject(()=>command('accounting_review',3,accountant,ev('accounting_review')),/NOT_ASSIGNEE/);
await command('accounting_review',3,ceo);await command('bank_disbursement',4,ceo);
await role('service_role');const confirm={p_obligation_id:valid.obligationId,p_expected_version:5,p_request_id:randomUUID(),p_hr_actor_id:applicant,p_source_hash:valid.sourceHash,p_evidence:ev('applicant_confirmation')};await reject(()=>rpc('finance_hr_applicant_confirm',{...confirm,p_hr_actor_id:randomUUID()}),/APPLICANT_MISMATCH/);eq((await rpc('finance_hr_applicant_confirm',confirm)).status,'pending_voucher');eq((await rpc('finance_hr_applicant_confirm',confirm)).replayed,true);
await role('authenticated',accountant);let posting={p_obligation_id:valid.obligationId,p_expected_version:6,p_request_id:randomUUID(),p_voucher_date:'2026-10-14',p_entries:[{t:'dr',ac:'6111',amt:1500,purpose:'expense'},{t:'cr',ac:'1112',amt:1234.56,purpose:'net'},{t:'cr',ac:'2151',amt:150,purpose:'withholding'},{t:'cr',ac:'2152',amt:115.44,purpose:'supplementary'}],p_evidence:ev('posted_voucher')};
await reject(()=>rpc('finance_hr_post_voucher',{...posting,p_entries:[{t:'dr',ac:'2134',amt:1500},{t:'cr',ac:'1112',amt:1500}]}),/CONTRACTOR_GROSS_TAX_NET_REQUIRED/);
await reject(()=>rpc('finance_hr_post_voucher',{...posting,p_entries:[{t:'dr',ac:'6111',amt:1234.56,purpose:'expense'},{t:'cr',ac:'1112',amt:1234.56,purpose:'net'}]}),/CONTRACTOR_GROSS_TAX_NET_REQUIRED/);
await reject(()=>rpc('finance_hr_post_voucher',{...posting,p_entries:posting.p_entries.map(e=>e.purpose==='supplementary'?{...e,purpose:'withholding'}:e)}),/CONTRACTOR_GROSS_TAX_NET_REQUIRED/);
if(process.env.HR_BRIDGE_BROWSER==='1'){
 const engine=await fs.readFile(new URL('../assets/engines/hr-bridge-engine.js',import.meta.url),'utf8');let actualPosting;
 const server=http.createServer(async(req,res)=>{try{
  if(req.method==='POST'){let raw='';for await(const chunk of req)raw+=chunk;const {name,args}=JSON.parse(raw);if(!['finance_hr_snapshot','finance_hr_post_voucher','finance_hr_voucher_options','finance_hr_callback_authorize'].includes(name))throw Error('unexpected RPC');await role('authenticated',accountant);let response;try{if(name==='finance_hr_post_voucher')actualPosting=args;response={data:await rpc(name,args),error:null}}catch(e){response={data:null,error:{message:e.message,code:e.code}}}res.setHeader('content-type','application/json');res.end(JSON.stringify(response));return;}
  if(req.url==='/engine.js'){res.setHeader('content-type','application/javascript');res.end(engine);return;}
  res.setHeader('content-type','text/html');res.end('<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0;padding:8px"><main id="app"></main><script src="/engine.js"></script><script>FinanceHrBridge.mount(document.querySelector("#app"),{userId:"accountant",isCurrent:()=>true,client:{rpc:async(name,args)=>(await fetch("/rpc",{method:"POST",body:JSON.stringify({name,args})})).json(),functions:{invoke:async()=>({data:{accepted:true}})}}})</script></html>');
 }catch{res.statusCode=500;res.end('isolated fixture failure')}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const {chromium}=await import('playwright');const browser=await chromium.launch();
 try{const page=await browser.newPage({viewport:{width:390,height:844}});await page.goto(`http://127.0.0.1:${server.address().port}`);const form=page.locator('form[data-voucher]');await form.waitFor();eq(await form.locator('[data-entry]').count(),4);await form.getByText('代扣所得稅負債',{exact:true}).waitFor();
  for(const[purpose,account]of[['expense','6111'],['net','1112'],['withholding','2151'],['supplementary','2152']])await form.locator('[data-purpose="'+purpose+'"] [data-entry-account]').selectOption(account);
  eq(await form.locator('[data-purpose="expense"] [data-entry-amount]').inputValue(),'1500');eq(await form.locator('[data-purpose="expense"] [data-entry-amount]').evaluate(el=>el.readOnly),true);
  await form.locator('[name="voucherDate"]').fill('2026-10-14');await form.locator('[name="reference"]').fill('SYNTHETIC GROSS JOURNAL');await form.locator('[name="evidence"]').setInputFiles({name:'synthetic.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4 Synthetic isolated fixture')});await form.locator('[name="reviewed"]').check();await form.getByRole('button',{name:'建立傳票、入帳並結案',exact:true}).click();await page.getByText('已入帳結案',{exact:false}).first().waitFor();
  eq(actualPosting.p_entries.map(e=>e.purpose),['expense','net','withholding','supplementary']);eq(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);await page.screenshot({path:'outputs/readiness-release/contractor-gross-journal-mobile.png',fullPage:true});posting=actualPosting;
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}await role('authenticated',accountant);
}
const posted=await rpc('finance_hr_post_voucher',posting);eq(posted.obligation.status,'closed');eq(posted.obligation.financeVersion,7);eq((await rpc('finance_hr_post_voucher',posting)).replayed,true);
await role('postgres');const voucher=(await db.query('select * from public.vouchers where id=$1',[posted.voucherId])).rows[0];eq(voucher.description,'人資核准付款結算 2026-09 外聘服務費');eq(Number(voucher.total),1500);eq(JSON.stringify(voucher).includes(contractor),false,'books have no individual recipient identity');eq((await db.query('select count(*)::int n,sum(debit-credit)::text balance from public.ledger_entries where source_id=$1',[valid.obligationId])).rows[0],{n:4,balance:'0.00'});
await reject(()=>db.query('update finance_hr_private.finance_hr_obligations set total_net_cents=150000 where obligation_id=$1',[valid.obligationId]),/SOURCE_FROZEN/);
await reject(()=>db.query("insert into public.vouchers(id,request_id,tenant_id) values('FORGED',$1,$2)",['hr:'+valid.obligationId,tenant]),/ATOMIC_POSTING_REQUIRED/);
await role('service_role');for(let version=1;version<=7;version++){
 const claims=await rpc('finance_hr_callback_claim',{p_obligation_id:valid.obligationId,p_limit:1});eq(claims.length,1);eq(claims[0].payload.financeVersion,version);eq((await rpc('finance_hr_callback_claim',{p_obligation_id:valid.obligationId,p_limit:1})).length,0);eq(JSON.stringify(claims[0].payload).includes('recipients'),false);eq(JSON.stringify(claims[0].payload).includes('payeeName'),false);await reject(()=>rpc('finance_hr_callback_ack',{p_event_id:claims[0].eventId,p_lease_id:randomUUID(),p_success:true}),/LEASE_LOST/);await rpc('finance_hr_callback_ack',{p_event_id:claims[0].eventId,p_lease_id:claims[0].leaseId,p_success:true});
}
eq((await rpc('finance_hr_callback_claim',{p_obligation_id:valid.obligationId})).length,0);
// Genuine monthly/bonus still take their own original source formats and receipts.
for(const [kind,src] of [['monthly',{totalNetCents:10000,lines:[{employeeId:randomUUID(),kind:'addition',amountCents:12000},{employeeId:randomUUID(),kind:'addition',amountCents:0}]}],['bonus',{totalNetCents:10000,employees:[{employeeId:randomUUID(),grossCents:12000,deductionsCents:2000,netCents:10000}]}]]){
 if(kind==='monthly'){src.lines=[{employeeId:contractor,kind:'addition',amountCents:12000},{employeeId:contractor,kind:'deduction',amountCents:2000}]}
 const e=await envelope(src,kind);eq((await intake(e)).status,'awaiting_payment_validation');await role('authenticated',accountant);eq((await rpc('finance_hr_snapshot')).obligations.find(x=>x.obligationId===e.obligationId).kind,kind);
}
// Current permission is required even for replay/read after valid completion.
await role('postgres');await db.query("update finance_hr_private.finance_hr_salary_readers set revoked_at=now() where finance_user_id='accountant'");await role('authenticated',accountant);eq((await rpc('finance_hr_snapshot')).obligations,[]);await reject(()=>rpc('finance_hr_post_voucher',posting),/FORBIDDEN/);await reject(()=>rpc('finance_hr_voucher_options',{p_obligation_id:valid.obligationId}),/FORBIDDEN/);
console.log(JSON.stringify({postingSeal:(await db.query("select md5(prosrc) h from pg_proc where oid='finance_hr_private.finance_hr_post_voucher(uuid,integer,uuid,date,jsonb,jsonb)'::regprocedure")).rows[0].h,ok:true,checks,kind:'contractor',callbacks:7,posting:'real immutable gross expense and net bank plus tax liability ledger',bank:'synthetic evidence only',browser:browserFirst}));
}finally{await db.close()}
