#!/usr/bin/env node
'use strict';
// Exact production UI handler + actual PostgreSQL guard/assignment/audit helpers.
// All values below are anonymous fixtures. No remote connection or real payment.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { PGlite } = require('@electric-sql/pglite');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const fixtureTest = fs.readFileSync(path.join(__dirname, 'check_procurement_human_event_contract.js'), 'utf8');
const tenant = '00000000-0000-0000-0000-000000000001';
const authId = '00000000-0000-0000-0000-000000000002';
const accountantAuthId = '00000000-0000-0000-0000-000000000003';
const clone = value => JSON.parse(JSON.stringify(value));
const schema = new Function('tenant','authId','return `'+fixtureTest.split('const schemaSql = `')[1].split('`;')[0]+'`;')(tenant, authId);
function source(name) {
  const start = html.indexOf('function '+name+'('); assert(start >= 0, name);
  let depth = 0;
  for(let i=html.indexOf('{',start);i<html.length;i++) {
    if(html[i]==='{') depth++;
    else if(html[i]==='}' && --depth===0) return html.slice(start,i+1);
  }
  throw Error(name);
}
const handler = html.slice(html.indexOf('window.submitProcurementPaymentInfo=async function('),html.indexOf('window.submitProcurementActual=async function('));
const read = name => fs.readFileSync(path.join(root,name),'utf8');
function requestFixture() {
  const roles = ['applicant_submit','procurement_payment','direct_supervisor','dept_manager','accountant','cashier','applicant_confirm','procurement_receipt','accountant_final'];
  const owners = ['applicant','audit','manager','manager','accountant','cashier','applicant','audit','accountant'];
  const statuses = ['submitted','pending_procurement','pending_section_chief','pending_dept_manager','pending_accountant','pending_cashier','pending_applicant_confirm','pending_procurement','pending_voucher'];
  return {id:'fixture',no:'anonymous-purchase',tenant_id:tenant,data_environment:'production',applicant_id:'applicant',entity_id:'entity',department_code:'department',type:'purchase_request',amount:0,estimated_amount:null,actual_amount:null,actual_files:[],files:[],cash_posted_at:null,status:'pending_procurement',step:2,ver:1,updated_at:'2026-08-05T00:00:00Z',payee:'',bank_type:'',bank_name:'',bank_branch:'',bank_no:'',expected_pay_date:null,bank_account:'',fee_bearer:'',bank_fee_amount:0,
    // Same nine-step structure as the reported record, including an already
    // skipped duplicate manager and unchanged legacy route metadata.
    steps:roles.map((rk,i)=>({rk,uid:owners[i],a:[0,3].includes(i)?'approved':'',n:i===3?'系統自動跳關':'',t:'',c:'',r:rk,status:statuses[i],files:[],purpose:'anonymous',workflowRouteId:'legacy-route',workflowStepKey:rk,workflowActorKind:'role',workflowActorRef:rk,workflowActorTarget:'',workflowRouteName:'legacy',workflowTemplateId:'legacy-template',workflowTemplateName:'legacy',workflowAllowCrossEntity:true,workflowActorTargetUnitType:''})),
    form_payload:{accountingLines:[],accountingLinePolicy:'preserved-policy',applicantProfile:{id:'applicant'},purchaseEstimate:{stage:'purchase_request',createdAt:'2026-08-05T00:00:00Z',requestRows:[],requestAmount:0},requestPurpose:'unchanged',purchaseRows:[]}};
}
const today = () => new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Taipei',month:'2-digit',day:'2-digit'}).format(new Date());
async function runHandler(db, old, actor='audit', alter=null, bypassUi=false) {
  await db.exec('set session authorization postgres; delete from public.expense_requests');
  await db.query('insert into public.expense_requests select * from jsonb_populate_record(null::public.expense_requests,$1::jsonb)',[JSON.stringify(old)]);
  const state={REQS:[{id:old.id,no:old.no,type:old.type,amt:old.amount,estimatedAmt:old.estimated_amount,steps:clone(old.steps),status:old.status,step:old.step,formPayload:clone(old.form_payload)}],S:{user:{id:actor,n:actor==='audit'?'Audit':'Accountant'},demoLogin:false},window:{},Date,alerts:[],writes:0,error:null};
  Object.assign(state,{
    hasSupabase:()=>true, cloneSettingValue:clone, normalizeFiles:clone, todayShort:today,
    canActRequest:r=>bypassUi || r.steps.find(s=>!s.a).uid===actor,
    collectProcurementPaymentInfo:()=>({amount:4250,payee:'Anonymous supplier',bankType:'transfer',bankName:'Fixture bank',bankBranch:'Fixture branch',bankNo:'TEST-ONLY',expectedPayDate:new Date().toISOString().slice(0,10),feeBearer:'company',summary:'Anonymous account'}),
    approvalActionPayload:async()=>({comment:'fixture payment info',files:[],addUid:''}),uploadApprovalFiles:async p=>p,
    requestBankFeeAmount:()=>0,requestCashPostedAt:()=>'',fmt:String,
    accountingLineManualFields:()=>[],settingsWriteResultOk:r=>r&&r.ok===true,
    cleanupUploadedSupabaseAttachments:async()=>{},rememberPayeeBankAccount:async()=>{},buildAll:()=>{},openDetail:()=>{},
    alert:message=>state.alerts.push(message),recordApprovalWriteFailure:(_action,_row,result)=>{state.error=result.error;},
    dbUpdate:async(table,id,payload)=>{
      state.writes++; assert.equal(table,'expense_requests'); assert.equal(id,'fixture');
      if(alter)alter(payload);
      await db.exec(`set session authorization authenticated; set audit.uid='${actor==='audit'?authId:accountantAuthId}'`);
      assert.equal((await db.query('select session_user as who')).rows[0].who,'authenticated');
      try {
        const columns=Object.keys(payload);
        await db.query(`update public.expense_requests set (${columns.join(',')})=(select ${columns.join(',')} from jsonb_populate_record(null::public.expense_requests,$1::jsonb)) where id='fixture'`,[JSON.stringify(payload)]);
        return {ok:true};
      } catch(error){return {ok:false,error};}
      finally {await db.exec('set session authorization postgres');}
    }
  });
  const names=['allowLegacyClientFlowRepair','flowStatusValue','flowIsTerminal','autoAdvanceDuplicateDeptManagerSteps','activeStep','activeStepIndex','requestApprovalStepCompleted','approvedStepCount','requestWorkflowStepCount','syncRequestStatus','markRequestCashPosted','appendStepAction','approveActiveStep','invalidateAccountingLines'];
  vm.createContext(state); vm.runInContext(names.map(source).join('\n')+'\n'+handler,state);
  await state.window.submitProcurementPaymentInfo('fixture','proc');
  state.saved=(await db.query("select * from public.expense_requests where id='fixture'")).rows[0];
  return state;
}
(async()=>{
 const db=new PGlite();let passed=0;
 const check=(condition,label)=>{assert(condition,label);passed++;};
 try{
  await db.exec(schema+`
  alter table public.expense_requests add column no text, add column cash_posted_at timestamptz;
  insert into public.finance_users values('accountant','${tenant}','${accountantAuthId}','Accountant','accountant.invalid','accountant',true,now());
  create table public.employee_department_roles(tenant_id uuid,finance_user_id text,role_key text,active boolean,can_approve boolean,effective_from date,effective_to date,department_code text);
  create table public.approval_step_actor_snapshots(tenant_id uuid,data_environment text,record_type text,record_id text,step_index integer,resolved_user_id text,resolution_status text,resolved_active boolean,raw_step jsonb);
  create table public.approval_delegations(tenant_id uuid,delegator_finance_user_id text,delegatee_finance_user_id text,active boolean,starts_at timestamptz,ends_at timestamptz,role_key text,scope_json jsonb);
  `);
  // Replace the older harness's permissive doubles with the actual reviewed
  // production helper definitions. Optional Membership is absent in production.
  const baselineSql=read('supabase/migrations/20260902054834_preserve_human_accounting_authority_v1.sql');
  const baselineFunctions=[...baselineSql.matchAll(/create or replace function private\.(finance_accounting_manual_fields|finance_accounting_line_is_human|finance_merge_human_accounting_line)\([\s\S]*?\$function\$;/g)].map(m=>m[0]);
  assert.equal(baselineFunctions.length,3); await db.exec(baselineFunctions.join('\n'));
  await db.exec(read('scripts/fixtures/finance_procurement_payment_helpers_20260908.sql'));
  await db.exec(read('scripts/fixtures/finance_procurement_guard_20260907.sql'));
  await db.exec('create trigger audit_guard before update on public.expense_requests for each row execute function private.finance_expense_guard_direct_update()');
  const old=requestFixture();
  const before=await runHandler(db,old);
  check(before.error?.message==='採購資料送出只能更新本關資料並移除待重新覆核的舊會計明細','Old guard reproduces exact six production errors with real handler');
  check(before.saved.step===2&&before.saved.amount==='0'&&before.saved.ver===1,'Old failure leaves DB untouched');
  check(before.REQS[0].step===2&&before.REQS[0].amt===0,'Old failure restores UI');
  await db.exec(read('supabase/migrations/20260907154739_procurement_and_human_accounting_contract_v2.sql'));
  const after=await runHandler(db,old);
  if(after.error)throw after.error;
  check(after.writes===1&&after.saved.step===3&&after.saved.status==='pending_section_chief','Current handler submits once and moves only to direct supervisor');
  check(after.saved.ver===2&&Number(after.saved.amount)===4250&&Number(after.saved.estimated_amount)===4250,'Amount and approval commit together');
  check(after.saved.steps[1].n==='Audit'&&after.saved.steps[1].actionLog[0].byId==='audit','True actor-bound audit accepted');
  check(after.saved.steps.every((s,i)=>i===1||require('node:util').isDeepStrictEqual(s,old.steps[i])),'Other eight gates including automatic skip unchanged');
  check(after.saved.cash_posted_at===null,'Procurement submission never executes payment');
  const uiDenied=await runHandler(db,old,'accountant');
  check(uiDenied.writes===0&&uiDenied.alerts.length===1,'Accountant UI cannot act for assigned general affairs');
  const apiDenied=await runHandler(db,old,'accountant',null,true);
  check(apiDenied.error?.code==='42501'&&apiDenied.saved.ver===1,'Forged accountant direct request is rejected by actual actor helper');
  for(const [name,mutate] of [
    ['other step reassignment',p=>{p.steps[2].uid='audit';}],
    ['forged audit actor',p=>{p.steps[1].actionLog[0].byId='other';}],
    ['unrelated payload',p=>{p.form_payload.requestPurpose='changed';}],
    ['restored accounting lines',p=>{p.form_payload.accountingLines=[];}],
    ['preservation marker true',p=>{p.form_payload.accountingLinesPreservedForReview=true;}]
  ]){
    const denied=await runHandler(db,old,'audit',mutate);
    check(denied.error?.code==='42501'&&denied.saved.ver===1&&denied.saved.step===2,name+' remains forbidden and atomic');
  }
  console.log(`PASS: ${passed} procurement payment actual handler + PostgreSQL regressions (anonymous local fixtures, no production mutation)`);
 } finally{await db.close();}
})().catch(error=>{console.error({message:error.message,code:error.code,where:error.where});process.exitCode=1;});
