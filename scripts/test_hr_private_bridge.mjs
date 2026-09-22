// Actual new SQL in an isolated PostgreSQL-compatible fixture. No real banking,
// Finance records, messages, Auth users, or production writes are performed.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import http from 'node:http';
const db = new PGlite();
const tenant=randomUUID(), otherTenant=randomUUID(), employer=randomUUID(), applicant=randomUUID();
const bank=randomUUID(), ceo=randomUUID(), outsider=randomUUID(), foreign=randomUUID();
let checks=0;
const eq=(a,b,message)=>{assert.deepEqual(a,b,message);checks++;};
async function reject(run,pattern){await assert.rejects(run,pattern);checks++;}
async function rpc(name,args={}){const keys=Object.keys(args);return (await db.query(`select public.${name}(${keys.map((k,i)=>`${k}=>$${i+1}`).join(',')}) as result`,Object.values(args))).rows[0].result;}
async function role(name,id=''){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec(`set role ${name}`);}
async function admin(q,args=[]){await role('postgres');return db.query(q,args);}
const evidence=(kind,total=true)=>({kind,reference:'SYNTHETIC-RECEIPT-001',sha256:'a'.repeat(64),...(total?{totalNetCents:123456}:{})});
try {
await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema private;grant usage on schema auth to authenticated,service_role;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table public.finance_users(id text primary key,tenant_id uuid,auth_user_id uuid,name text,active boolean);
 create table public.vouchers(id text primary key,tenant_id uuid,entity_id text,request_id text,posted boolean,posted_at timestamptz,voided_at timestamptz,data_environment text,total numeric);
 create function public.current_finance_user() returns public.finance_users language sql stable security definer set search_path='' as $$select f from public.finance_users f where f.auth_user_id=auth.uid() and active$$;
`);
await db.exec(await fs.readFile(new URL('../supabase/migrations/20260922072109_finance_hr_private_bridge_v1.sql',import.meta.url),'utf8'));
await db.query(`insert into public.finance_users values ('bank',$1,$2,'Accounting',true),('ceo',$1,$3,'CEO',true),('outsider',$1,$4,'Director',true),('foreign',$5,$6,'Other employer',true)`,[tenant,bank,ceo,outsider,otherTenant,foreign]);
await db.query(`insert into finance_hr_private.finance_hr_salary_readers(tenant_id,source_employer_id,finance_user_id,business_role,verified_at,verified_by,evidence_reference,effective_from) values($1,$2,'bank','accounting',now(),'fixture','SYNTHETIC',now()),($1,$2,'ceo','ceo',now(),'fixture','SYNTHETIC',now()),($3,$2,'foreign','accounting',now(),'fixture','SYNTHETIC',now())`,[tenant,employer,otherTenant]);
await db.query(`insert into finance_hr_private.finance_hr_routes(tenant_id,source_employer_id,source_applicant_id,legal_entity_code,version,bank_actor,account_actor,cashier_actor,voucher_actor,verified_at,verified_by,evidence_reference,effective_from,active) values($1,$2,$3,'E1',1,'bank','ceo','ceo','bank',now(),'fixture','SYNTHETIC',now(),true)`,[tenant,employer,applicant]);
const source={totalNetCents:123456,lines:[{employeeId:randomUUID(),kind:'addition',amountCents:123456}]};
const sourceHash=(await db.query('select finance_hr_private.finance_hr_hash($1::jsonb) h',[source])).rows[0].h;
const obligation=randomUUID(), intakeEvent=randomUUID();
const envelope={schemaVersion:1,obligationId:obligation,flowId:obligation,sourceEmployerId:employer,originalApplicantId:applicant,revision:1,sourceHash,source,payDate:'2026-10-15',period:'2026-09',kind:'monthly',amountMeaning:'calculated_net',paymentReady:false};
await role('authenticated',bank);
await reject(()=>rpc('finance_hr_intake',{p_event_id:intakeEvent,p_envelope:envelope}),/permission denied/);
await reject(()=>db.query('select * from finance_hr_private.finance_hr_obligations'),/permission denied/);
await role('service_role');
await reject(()=>rpc('finance_hr_intake',{p_event_id:randomUUID(),p_envelope:{...envelope,sourceHash:'0'.repeat(64)}}),/SOURCE_INVALID/);
eq((await rpc('finance_hr_intake',{p_event_id:intakeEvent,p_envelope:envelope})).status,'awaiting_payment_validation','no implicit bank payment');
eq((await rpc('finance_hr_intake',{p_event_id:intakeEvent,p_envelope:envelope})).replayed,true);
await reject(()=>rpc('finance_hr_intake',{p_event_id:intakeEvent,p_envelope:{...envelope,payDate:'2026-10-16'}}),/REPLAY_CONFLICT/);
await reject(()=>rpc('finance_hr_intake',{p_event_id:randomUUID(),p_envelope:{...envelope,payDate:'2026-10-16'}}),/OBLIGATION_CONFLICT/);
await role('authenticated',outsider);eq((await rpc('finance_hr_snapshot')).obligations,[]);
eq(await rpc('finance_hr_callback_authorize',{p_obligation_id:obligation}),false);
await role('authenticated',foreign);eq((await rpc('finance_hr_snapshot')).obligations,[]);
await role('authenticated',bank);eq((await rpc('finance_hr_snapshot')).obligations[0].totalNetCents,123456);
const command=(action,version,ev=evidence(action),id=randomUUID())=>rpc('finance_hr_command',{p_obligation_id:obligation,p_expected_version:version,p_request_id:id,p_action:action,p_evidence:ev});
await reject(()=>command('bank_disbursement',1),/ACTION_OUT_OF_ORDER/);
await reject(()=>command('bank_batch_validation',1,{}),/EVIDENCE_REQUIRED/);
await reject(()=>command('bank_batch_validation',1,{...evidence('bank_batch_validation'),totalNetCents:1}),/AMOUNT_MISMATCH/);
const req=randomUUID();const validated=await command('bank_batch_validation',1,evidence('bank_batch_validation'),req);eq(validated.obligation.financeVersion,2);
eq((await command('bank_batch_validation',1,evidence('bank_batch_validation'),req)).replayed,true);
await reject(()=>command('bank_upload',1),/VERSION_CONFLICT/);
await reject(()=>command('bank_upload',2,evidence('bank_upload'),req),/REPLAY_CONFLICT/);
eq((await command('bank_upload',2)).obligation.stageIndex,1);
await reject(()=>command('accounting_review',3),/NOT_ASSIGNEE/);
await role('authenticated',ceo);
eq((await command('accounting_review',3,evidence('accounting_review',false))).obligation.stageIndex,2);
eq((await command('bank_disbursement',4)).obligation.status,'pending_applicant','same CEO must complete each stage separately');
await reject(()=>command('applicant_confirmation',5,evidence('applicant_confirmation',false)),/NOT_ASSIGNEE/);
await reject(()=>rpc('finance_hr_applicant_confirm',{p_obligation_id:obligation,p_expected_version:5,p_request_id:randomUUID(),p_hr_actor_id:applicant,p_source_hash:sourceHash,p_evidence:evidence('applicant_confirmation',false)}),/permission denied/);
await role('service_role');
const confirmArgs={p_obligation_id:obligation,p_expected_version:5,p_request_id:randomUUID(),p_hr_actor_id:applicant,p_source_hash:sourceHash,p_evidence:evidence('applicant_confirmation',false)};
await reject(()=>rpc('finance_hr_applicant_confirm',{...confirmArgs,p_hr_actor_id:randomUUID()}),/APPLICANT_MISMATCH/);
eq((await rpc('finance_hr_applicant_confirm',confirmArgs)).status,'pending_voucher');
eq((await rpc('finance_hr_applicant_confirm',confirmArgs)).replayed,true);
await role('authenticated',bank);
await reject(()=>command('posted_voucher',6,{...evidence('posted_voucher',false),voucherId:'missing'}),/POSTED_VOUCHER_REQUIRED/);
await admin(`insert into public.vouchers values('wrong',$1,'E1','unrelated',true,now(),null,'production',1234.56),('valid',$1,'E1',$2,true,now(),null,'production',1234.56)`,[tenant,'hr:'+obligation]);
await role('authenticated',bank);
await reject(()=>command('posted_voucher',6,{...evidence('posted_voucher',false),voucherId:'wrong'}),/POSTED_VOUCHER_REQUIRED/);
eq((await command('posted_voucher',6,{...evidence('posted_voucher',false),voucherId:'valid'})).obligation.status,'closed');
await reject(()=>command('bank_disbursement',7),/NOT_ASSIGNEE/);
await admin(`update finance_hr_private.finance_hr_salary_readers set revoked_at=now() where finance_user_id='bank'`);
await role('authenticated',bank);eq((await rpc('finance_hr_snapshot')).obligations,[],'revocation removes confidential data immediately');
await reject(()=>command('bank_batch_validation',1,evidence('bank_batch_validation'),req),/FORBIDDEN/);
await role('service_role');
let delivered=0;
for(let version=1;version<=7;version++){
 const claims=await rpc('finance_hr_callback_claim',{p_obligation_id:obligation,p_limit:10});eq(claims.length,1);eq(claims[0].payload.financeVersion,version);
 eq((await rpc('finance_hr_callback_claim',{p_obligation_id:obligation,p_limit:10})).length,0,'lease excludes simultaneous sender');
 const text=JSON.stringify(claims[0].payload);assert(!text.includes('totalNetCents')&&!text.includes('lines')&&!text.includes('evidence'));checks++;
 await reject(()=>rpc('finance_hr_callback_ack',{p_event_id:claims[0].eventId,p_lease_id:randomUUID(),p_success:true}),/LEASE_LOST/);
 eq(await rpc('finance_hr_callback_ack',{p_event_id:claims[0].eventId,p_lease_id:claims[0].leaseId,p_success:true}),true);delivered++;
}
eq(delivered,7);eq((await rpc('finance_hr_callback_claim',{p_obligation_id:obligation})).length,0);
await reject(()=>db.query('select * from finance_hr_private.finance_hr_obligations'),/permission denied/);
await role('postgres');await reject(()=>db.query("update finance_hr_private.finance_hr_events set actor_name='forged'"),/IMMUTABLE/);
await reject(()=>db.query("update finance_hr_private.finance_hr_obligations set total_net_cents=1"),/SOURCE_FROZEN/);
await reject(()=>db.query("update finance_hr_private.finance_hr_routes set bank_actor='outsider'"),/ROUTE_FROZEN/);
eq((await db.query('select count(*)::int n from finance_hr_private.finance_hr_obligations')).rows[0].n,1,'replays never create a second obligation');
if(process.env.HR_BRIDGE_BROWSER==='1') {
 const {chromium}=await import('playwright');
 await admin("update finance_hr_private.finance_hr_salary_readers set revoked_at=null where finance_user_id='bank'");
 const browserObligation=randomUUID();await role('service_role');await rpc('finance_hr_intake',{p_event_id:randomUUID(),p_envelope:{...envelope,obligationId:browserObligation,flowId:browserObligation}});
 let activeActor=bank;
 const engine=await fs.readFile(new URL('../assets/engines/hr-bridge-engine.js',import.meta.url),'utf8');
 const css=await fs.readFile(new URL('../assets/styles/finance-core.css',import.meta.url),'utf8');
 const server=http.createServer(async(req,res)=>{try {
  if(req.method==='POST'&&req.url==='/rpc'){
   let raw='';for await(const chunk of req)raw+=chunk;const {name,args}=JSON.parse(raw);
   if(!['finance_hr_snapshot','finance_hr_command','finance_hr_callback_authorize'].includes(name))throw new Error('not allowed');
   await role('authenticated',activeActor);let data;try{data={data:await rpc(name,args),error:null}}catch(e){data={data:null,error:{message:e.message,code:e.code}}}
   res.setHeader('content-type','application/json');res.end(JSON.stringify(data));return;
  }
  if(req.url==='/engine.js'){res.setHeader('content-type','application/javascript');res.end(engine);return;}
  if(req.url==='/style.css'){res.setHeader('content-type','text/css');res.end(css);return;}
  res.setHeader('content-type','text/html');res.end(`<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><body style="display:block;padding:12px"><main id="bridge"></main><script src="/engine.js"></script><script>window.mount=(userId)=>FinanceHrBridge.mount(document.querySelector('#bridge'),{userId,isCurrent:()=>true,client:{rpc:async(name,args)=>(await fetch('/rpc',{method:'POST',body:JSON.stringify({name,args})})).json(),functions:{invoke:async()=>({data:{accepted:true,callbackPending:false}})}}});mount('bank');</script></html>`);
 }catch(e){res.statusCode=500;res.end('fixture failure')}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const card=page.locator('section.card').filter({hasText:browserObligation});
  await card.locator('form').waitFor({timeout:3000});
  for(const width of [1280,390,320]){await page.setViewportSize({width,height:900});eq(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`no overflow ${width}`);}
  async function submitUI(kind,amount){await card.locator('input[name="reference"]').fill('SYNTHETIC-BANK-001');if(amount!==undefined)await card.locator('input[name="amount"]').fill(amount);await card.locator('input[type="file"]').setInputFiles({name:'synthetic-evidence.pdf',mimeType:'application/pdf',buffer:Buffer.from('SYNTHETIC-NOT-A-REAL-BANK-RECEIPT')});await card.locator('form button').click();}
  await submitUI('bank_batch_validation','0.01');await page.getByText('佐證總額與人資核准實發總額不符，尚未送出。').waitFor();checks++;
  await submitUI('bank_batch_validation','1234.56');await card.getByText('會計上傳兆豐 · 預定發放 2026-10-15',{exact:true}).waitFor();checks++;
  await submitUI('bank_upload','1234.56');await card.getByText('會計項目檢核 · 預定發放 2026-10-15',{exact:true}).waitFor();eq(await card.locator('form').count(),0,'other actor cannot process');
  activeActor=ceo;await page.evaluate(()=>mount('ceo'));await card.locator('form').waitFor();await submitUI('accounting_review');await card.getByText('出納登錄放款結果 · 預定發放 2026-10-15',{exact:true}).waitFor();
  await submitUI('bank_disbursement','1234.56');await card.getByText('待原申請人確認 · 預定發放 2026-10-15',{exact:true}).waitFor();eq(await card.locator('form').count(),0);
  await role('service_role');await rpc('finance_hr_applicant_confirm',{p_obligation_id:browserObligation,p_expected_version:5,p_request_id:randomUUID(),p_hr_actor_id:applicant,p_source_hash:sourceHash,p_evidence:evidence('applicant_confirmation',false)});
  activeActor=bank;await page.evaluate(()=>mount('bank'));await card.getByText('建立付款傳票並結案 · 預定發放 2026-10-15',{exact:true}).waitFor();
  await page.screenshot({path:'/tmp/finance-hr-bridge-mobile.png',fullPage:true});
  await page.evaluate(()=>FinanceHrBridge.dispose());eq(await page.locator('section.card').count(),0,'dispose clears sensitive DOM');eq(errors,[]);
  console.log(JSON.stringify({browser:true,responsive:[1280,390,320],rpc:'real PGlite migration',bankTransport:'not invoked'}));
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
}
console.log(JSON.stringify({ok:true,checks,fixture:'PGlite actual migration',realPayments:false}));
}finally{await db.close();}
