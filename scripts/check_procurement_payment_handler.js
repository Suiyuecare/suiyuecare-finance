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
const handler = html.slice(html.indexOf('var PROCUREMENT_SUBMISSION_PENDING_PREFIX='),html.indexOf('window.apprApproveInv=async function('));
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
  const storage=new Map(),session=new Map();
  const state={REQS:[{id:old.id,no:old.no,type:old.type,amt:old.amount,estimatedAmt:old.estimated_amount,steps:clone(old.steps),status:old.status,step:old.step,formPayload:clone(old.form_payload)}],S:{user:{id:actor,n:actor==='audit'?'Audit':'Accountant'},demoLogin:false},window:{},Date,alerts:[],writes:0,error:null,storage};
  Object.assign(state,{
    hasSupabase:()=>true, cloneSettingValue:clone, normalizeFiles:clone, todayShort:today,
    expenseSubmissionOperationIdentity:()=>JSON.stringify([tenant,'production',actor]),
    financeInlineJsString:value=>JSON.stringify(String(value)).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;'),
    safeGetItem:key=>storage.get(key)||null,safeSetItem:(key,value)=>{storage.set(key,value);return true;},safeRemoveItem:key=>{storage.delete(key);return true;},
    sessionGetItem:key=>session.get(key)||null,sessionSetItem:(key,value)=>{session.set(key,value);return true;},sessionRemoveItem:key=>session.delete(key),
    membershipOrgDraftUuid:()=> '11111111-1111-4111-8111-111111111111',withOperationTimeout:promise=>promise,
    newlyUploadedAttachmentResults:files=>files.filter(file=>file.__uploadCreatedThisAttempt),cleanupApprovalFilesAfterDefiniteFailure:async()=>{},
    expenseApplicantRevisionRpcErrorIsAmbiguous:error=>/fetch|network|timeout/i.test(String(error&&error.message||'')),
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
      state.sentPayload=clone(payload);
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
function faultFixture(kind, shared, newTab=false) {
  const payment=kind==='payment';
  if(!shared){
    const first={id:'fixture',no:'anonymous-purchase',type:'purchase_request',status:'pending_procurement',step:payment?2:8,
      amount:payment?0:100,estimated_amount:payment?0:100,actual_amount:null,actual_files:[],files:[],
      steps:[{rk:payment?'procurement_payment':'procurement_receipt',a:''},{rk:payment?'direct_supervisor':'accountant_final',a:''}],form_payload:{}};
    shared={storage:new Map(),session:new Map(),row:first,mode:'lost_committed',commits:0,calls:0,reads:0,operationCounter:0,latePayload:null,readOffline:false};
  }
  if(newTab)shared.session=new Map();
  const state={REQS:[],S:{user:{id:'audit',n:'Audit'},detailRid:'fixture'},window:{},Date,console,alerts:[],uploads:0,cleanups:0,failures:0,shared};
  const mapped=raw=>({id:raw.id,no:raw.no,type:raw.type,status:raw.status,step:raw.step,amt:raw.amount,estimatedAmt:raw.estimated_amount,
    actualAmt:raw.actual_amount,actualFiles:clone(raw.actual_files||[]),files:clone(raw.files||[]),steps:clone(raw.steps),formPayload:clone(raw.form_payload||{})});
  state.REQS=[mapped(shared.row)];
  shared.commit=values=>{
    if(shared.row.step!==(payment?2:8))return false;
    shared.row=Object.assign({},shared.row,clone(values),{form_payload:clone(values.form_payload),steps:clone(values.steps)});
    shared.commits++;return true;
  };
  Object.assign(state,{
    expenseSubmissionOperationIdentity:()=>JSON.stringify([tenant,'production','audit']),
    safeGetItem:key=>shared.storage.get(key)||null,safeSetItem:(key,value)=>{shared.storage.set(key,value);return true;},safeRemoveItem:key=>{shared.storage.delete(key);return true;},
    sessionGetItem:key=>shared.session.get(key)||null,sessionSetItem:(key,value)=>{shared.session.set(key,value);return true;},sessionRemoveItem:key=>shared.session.delete(key),
    currentTenantId:()=>tenant,activeDataEnvironment:()=> 'production',
    membershipOrgDraftUuid:()=>`operation-${++shared.operationCounter}`,
    withOperationTimeout:promise=>promise,withAbortableOperationTimeout:query=>Promise.resolve(query),
    getSb:()=>({from:()=>{const query={select(){return query},eq(){return query},limit(){return query},then(resolve,reject){shared.reads++;return Promise.resolve(shared.readOffline?{error:{message:'offline'},data:null}:{error:null,data:[clone(shared.row)]}).then(resolve,reject)}};return query}}),
    mapReq:mapped,mergeCommittedExpenseRequest:raw=>{const result=mapped(raw);state.REQS[0]=result;return result;},
    activeStep:r=>r.steps.find(step=>!step.a),canActRequest:()=>true,cloneSettingValue:clone,normalizeFiles:clone,
    collectProcurementPaymentInfo:()=>({amount:100,payee:'Anonymous supplier',bankType:'transfer',bankName:'Fixture bank',bankBranch:'Fixture branch',bankNo:'TEST-ONLY',expectedPayDate:'2026-10-02',feeBearer:'company',summary:'Anonymous account'}),
    approvalActionPayload:async()=>({comment:'fixture',files:[{path:'staged-proof',__uploadCreatedThisAttempt:true}],addUid:''}),
    uploadApprovalFiles:async p=>{state.uploads++;return p;},el:()=>({value:'80'}),num:Number,purchaseEstimatedAmount:r=>r.estimatedAmt,
    requestBankFeeAmount:()=>0,invalidateAccountingLines:()=>{},fmt:String,
    escAttr:String,attr:String,financeInlineJsString:value=>JSON.stringify(String(value)).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;'),
    approveActiveStep:r=>{r.steps[0].a='approved';r.step=payment?3:9;r.status=payment?'pending_section_chief':'pending_voucher';},
    rememberPayeeBankAccount:async()=>{},buildAll:()=>{},openDetail:()=>{},
    newlyUploadedAttachmentResults:files=>files.filter(file=>file.__uploadCreatedThisAttempt),
    cleanupApprovalFilesAfterDefiniteFailure:async files=>{state.cleanups+=files.length;},
    recordApprovalWriteFailure:()=>{state.failures++;},alert:message=>state.alerts.push(message),
    expenseApplicantRevisionRpcErrorIsAmbiguous:error=>/fetch|network|timeout/i.test(String(error&&error.message||'')),
    dbUpdate:async (_table,_id,values)=>{
      shared.calls++;
      if(shared.mode==='definite')return{ok:false,error:{code:'42501',message:'denied'}};
      if(shared.mode==='lost_uncommitted'){shared.latePayload=clone(values);return{ok:false,error:{message:'Failed to fetch'}};}
      if(shared.mode==='retry_after_late'||shared.mode==='new_after_late'){
        shared.commit(shared.latePayload);
        return{ok:false,error:{code:'42501',message:'stale step'}};
      }
      if(shared.mode==='retry_wins')return shared.commit(values)?{ok:true}:{ok:false,error:{code:'42501',message:'stale step'}};
      if(shared.mode==='lost_committed'){shared.commit(values);return{ok:false,error:{message:'Failed to fetch'}};}
      if(shared.mode==='lost_generic'){shared.commit(values);return{ok:false,error:{message:'Unexpected response'}};}
      throw new Error('unexpected mode');
    }
  });
  vm.createContext(state);vm.runInContext(handler,state);
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
  await db.exec(`set session authorization authenticated; set audit.uid='${authId}'`);
  try{
    const columns=Object.keys(after.sentPayload);
    await db.query(`update public.expense_requests set (${columns.join(',')})=(select ${columns.join(',')} from jsonb_populate_record(null::public.expense_requests,$1::jsonb)) where id='fixture'`,[JSON.stringify(after.sentPayload)]);
  }finally{await db.exec('set session authorization postgres');}
  const afterReplay=(await db.query("select * from public.expense_requests where id='fixture'")).rows[0];
  check(afterReplay.ver===2&&afterReplay.step===3&&JSON.stringify(afterReplay.steps)===JSON.stringify(after.saved.steps),
    'Real PostgreSQL guard treats an exact late replay as a no-op without a second step or audit event');
  const competing=clone(after.sentPayload);competing.form_payload.procurementPaymentInfo.operationId='different-attempt';
  await db.exec(`set session authorization authenticated; set audit.uid='${authId}'`);
  try{
    const columns=Object.keys(competing);
    await assert.rejects(db.query(`update public.expense_requests set (${columns.join(',')})=(select ${columns.join(',')} from jsonb_populate_record(null::public.expense_requests,$1::jsonb)) where id='fixture'`,[JSON.stringify(competing)]),error=>error.code==='42501');
  }finally{await db.exec('set session authorization postgres');}
  const afterCompeting=(await db.query("select * from public.expense_requests where id='fixture'")).rows[0];
  check(afterCompeting.ver===2&&afterCompeting.form_payload.procurementPaymentInfo.operationId===after.sentPayload.form_payload.procurementPaymentInfo.operationId,
    'Real PostgreSQL guard rejects a competing operation after the step advances');
  await db.exec('set session authorization postgres; delete from public.expense_requests');
  await db.query('insert into public.expense_requests select * from jsonb_populate_record(null::public.expense_requests,$1::jsonb)',[JSON.stringify(old)]);
  const winningOtherTab=clone(after.sentPayload);winningOtherTab.form_payload.procurementPaymentInfo.operationId='other-tab-wins';
  await db.exec(`set session authorization authenticated; set audit.uid='${authId}'`);
  try{
    const columns=Object.keys(winningOtherTab);
    await db.query(`update public.expense_requests set (${columns.join(',')})=(select ${columns.join(',')} from jsonb_populate_record(null::public.expense_requests,$1::jsonb)) where id='fixture'`,[JSON.stringify(winningOtherTab)]);
    await assert.rejects(db.query(`update public.expense_requests set (${columns.join(',')})=(select ${columns.join(',')} from jsonb_populate_record(null::public.expense_requests,$1::jsonb)) where id='fixture'`,[JSON.stringify(after.sentPayload)]),error=>error.code==='42501');
  }finally{await db.exec('set session authorization postgres');}
  const afterRace=(await db.query("select * from public.expense_requests where id='fixture'")).rows[0];
  check(afterRace.ver===2&&afterRace.step===3&&afterRace.form_payload.procurementPaymentInfo.operationId==='other-tab-wins',
    'Real PostgreSQL guard preserves another tab winning between old-step read and frozen retry');
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
  for(const kind of ['payment','actual']){
    const caller=kind==='payment'?'submitProcurementPaymentInfo':'submitProcurementActual';
    let f=faultFixture(kind);
    await f.window[caller]('fixture','proc');
    check(f.shared.commits===1&&f.REQS[0].step===(kind==='payment'?3:9)&&f.shared.storage.size===0&&f.shared.session.size===0&&f.cleanups===0&&f.failures===0,
      kind+' commit then lost response adopts exact operation and never cleans referenced proof');
    f=faultFixture(kind);f.shared.mode='lost_generic';
    await f.window[caller]('fixture','proc');
    check(f.shared.commits===1&&f.shared.storage.size===0&&f.cleanups===0&&f.failures===0,
      kind+' generic transport failure also reconciles before any cleanup');

    f=faultFixture(kind);f.shared.mode='definite';
    await f.window[caller]('fixture','proc');
    check(f.shared.commits===0&&f.REQS[0].step===(kind==='payment'?2:8)&&f.shared.storage.size===0&&f.cleanups===1&&f.failures===1,
      kind+' definitive database rejection restores old step and cleans only fresh proof');

    f=faultFixture(kind);f.shared.mode='lost_uncommitted';
    await f.window[caller]('fixture','proc');
    check(f.shared.commits===0&&f.shared.storage.size===1&&f.shared.session.size===1&&f.cleanups===0&&f.REQS[0].step===(kind==='payment'?2:8),
      kind+' uncertain uncommitted result retains durable marker and proof');
    check(f.procurementSubmissionRecoveryHtml(f.REQS[0]).includes('確認或重試原送件')&&f.procurementSubmissionRecoveryHtml(f.REQS[0]).includes('重新填寫同一關'),
      kind+' detail exposes both original-result confirmation and same-step re-entry');
    await f.window[caller]('fixture','proc');
    check(f.shared.calls===1&&f.uploads===1&&f.shared.storage.size===1,kind+' repeat click is blocked before another upload');
    let reloaded=faultFixture(kind,f.shared);reloaded.shared.mode='retry_after_late';
    await reloaded.window.confirmPendingProcurementSubmission('fixture');
    check(reloaded.shared.commits===1&&reloaded.shared.calls===2&&reloaded.uploads===0&&reloaded.cleanups===0&&reloaded.shared.storage.size===0,
      kind+' reload retries frozen payload; late original wins and exact operation is adopted');

    f=faultFixture(kind);f.shared.mode='lost_uncommitted';
    await f.window[caller]('fixture','proc');
    f.shared.mode='retry_wins';
    await f.window.confirmPendingProcurementSubmission('fixture');
    const lateAccepted=f.shared.commit(f.shared.latePayload);
    check(f.shared.commits===1&&!lateAccepted&&f.shared.storage.size===0&&f.cleanups===0,
      kind+' frozen retry wins; late original cannot advance the step twice');

    f=faultFixture(kind);f.shared.mode='lost_uncommitted';
    await f.window[caller]('fixture','proc');
    const originalOperation=f.shared.latePayload.form_payload[kind==='payment'?'procurementPaymentInfo':'procurementReceiptInfo'].operationId;
    const closed=faultFixture(kind,f.shared,true);closed.shared.mode='new_after_late';
    await closed.window.confirmPendingProcurementSubmission('fixture');
    check(closed.shared.storage.size===1&&closed.shared.session.size===0&&closed.uploads===0,
      kind+' closed tab keeps blocker and requires re-entry without frozen private payload');
    await closed.window.resumeProcurementSubmissionFromOriginalStep('fixture');
    await closed.window[caller]('fixture','proc');
    check(closed.shared.commits===1&&closed.shared.row.form_payload[kind==='payment'?'procurementPaymentInfo':'procurementReceiptInfo'].operationId===originalOperation&&closed.shared.storage.size===0&&closed.cleanups===0,
      kind+' same-form re-entry recognizes late original after tab closure');
  }
  console.log(`PASS: ${passed} procurement payment/actual handlers, ambiguous recovery, and PostgreSQL regressions (anonymous local fixtures, no production mutation)`);
 } finally{await db.close();}
})().catch(error=>{console.error({message:error.message,code:error.code,where:error.where});process.exitCode=1;});
