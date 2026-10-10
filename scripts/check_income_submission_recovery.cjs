#!/usr/bin/env node
'use strict';
// Actual UI callers and transaction adapter; fictional durable RPC transport
// simulates a COMMIT followed by a lost response, reconciliation, and reloads.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
function fn(name){const match=new RegExp('^(?:async )?function '+name+'\\(','m').exec(html);assert(match,name);return html.slice(match.index,html.indexOf('\n}',match.index)+2);}
const clone=x=>JSON.parse(JSON.stringify(x));let checks=0;function check(name,condition){assert(condition,name);checks++;}
function fixture(shared={}){
 const storage=shared.storage||new Map(),durable=shared.durable||new Map(),server=shared.server||new Map(),canceled=shared.canceled||new Set(),calls=shared.calls||[],lockQueues=shared.lockQueues||new Map(),hooks={};
 const state={lost:0,statementTimeouts:0,deny:false,hang:false,hangBeforeCommit:false,reconcileState:'',reconcileError:null,reconcileResult:null,reconciliations:0,reconcileRequests:[],storageOk:true,durableOk:true,uploads:0,uploadFiles:[],cleanup:0,notifications:0,reads:0,events:[],alerts:[],navTabs:[],hooks};
 const user={id:'fictional-A',n:'Fictional A',email:'a@example.invalid',role:'accountant',dc:'FICT-D'};
 const fields={'inv-buyer':'Fictional buyer','inv-amt':'100','inv-identifier-type':'電子發票','inv-desc':'Fictional service','inv-tax':'5','inv-ent':'FICT-E','inv-date':'2026-09-22','bill-reason':'Fictional reason','bill-dept':'FICT-D','b-ent2':'FICT-E','b-ent':'FICT-E','b-month':'2026-09'};
 const nodes=Object.fromEntries(Object.entries(fields).map(([key,value])=>[key,{value,style:{},classList:{remove(){}}}]));
 nodes['batch-pw']={style:{}};nodes['batch-dz']={classList:{remove(){}}};
 const c={S:{user,demoLogin:false,invOcrFile:null,bUploadFiles:[],bUploadPendingFiles:[],bRows:[{buyer:'Fictional buyer',total:105,amt:100,rate:5,itemType:'home_care',identifierType:'電子發票',desc:'Service'}]},INVOICE_BATCH_MAX_ITEMS:500,BILL_BATCH_MAX_ITEMS:150,BATCH_INVOICE_READ_GENERATION:0,USERS:[user],INVS:[],BILLS:[],BILL_ROWS:[{payer:'Fictional payer',item:'Service',amt:100,period:'2026-09'}],INCOME_SUBMISSION_RETRY_STATE:{},POSTING_IN_FLIGHT:{},BILL_CONFIRMED_SUBMISSION:null,FINANCE_DRAFT_IDENTITY_EPOCH:0,financeAuthIdentityEpoch:0,CURRENT_PERMISSION_SNAPSHOT:{},financeLogoutInProgress:false,financeGoogleAccountSwitchInProgress:false,financeWorkspaceIdentityBlocked:false,
  currentFinanceAuthUserId:()=> 'auth-'+c.S.user.id,currentTenantId:()=> 'fictional-tenant',activeDataEnvironment:()=> 'test',hasSupabase:()=>true,
  sessionGetItem:key=>storage.get(key),sessionSetItem:(key,value)=>{if(!state.storageOk)return false;storage.set(key,value);return true;},sessionRemoveItem:key=>storage.delete(key),safeGetItem:key=>durable.get(key)||null,safeJsonSet:(key,value)=>{if(!state.durableOk)return false;durable.set(key,JSON.stringify(value));return true;},safeRemoveItem:key=>durable.delete(key),crypto:require('node:crypto').webcrypto,
  navigator:{locks:{request:(name,options,callback)=>{
    assert.equal(options.mode,'exclusive');
    const previous=lockQueues.get(name)||Promise.resolve();
    let release;const held=new Promise(resolve=>release=resolve);
    const tail=previous.then(()=>held);lockQueues.set(name,tail);
    return previous.then(async()=>{try{return await callback({name,mode:'exclusive'});}finally{release();if(lockQueues.get(name)===tail)lockQueues.delete(name);}});
  }}},
  guardSubmissionIdentityDirectory:async()=>{if(hooks.directory)await hooks.directory();return true;},el:key=>nodes[key],document:{getElementById:key=>nodes[key]},invoiceReasonMeta:()=>({reason:'Fictional reason'}),invoiceIdentifierType:value=>value||'電子發票',invoiceItemTypeByKey:k=>({k}),invoiceItemTypeFromText:()=> 'home_care',selectedInvoiceApplicant:()=>({user:c.S.user,name:c.S.user.n,dc:'FICT-D'}),requiredMissingItems:(_type,items)=>items.filter(x=>!x.value&&['buyer','total'].includes(x.key)).map(x=>x.label),formFieldLabel:(_a,_b,value)=>value,invoiceIdentifierRequiresCode:()=>false,requireIncomeEntityDepartment:()=>true,entityTrackById:()=> 'AA',invoiceRateValue:value=>Number(value)/100,
  applicantSubmitStep:u=>({rk:'applicant_submit',uid:u.id,a:'approved'}),buildInvoiceApprovalSteps:()=>[{rk:'accountant',uid:'C',a:'',status:'pending_accountant'}],buildBillApprovalSteps:()=>[{rk:'accountant',uid:'C',a:'',status:'pending_accountant'}],
  prepareApprovalRouteForSubmit:async(_u,_a,_dc,_opts,steps)=>{if(hooks.route)await hooks.route();return {ok:true,steps};},p1SubmissionPreflight:async()=>{if(hooks.preflight)await hooks.preflight();return {ok:true};},gE:()=>({s:'Fictional entity',full:'Fictional entity'}),gD:()=>({n:'Fictional dept'}),
  invoiceInitialStepFiles:async(raw,_rows,ctx)=>{state.uploads++;state.uploadFiles.push(Array.from(raw||[]));if(hooks.upload)await hooks.upload();return[{n:'發票明細_'+ctx.recordNo+'.xls',size:100,mime:'application/vnd.ms-excel',kind:'invoice_excel',path:'fictional/'+ctx.recordNo}];},normalizeFiles:x=>x,invoiceSuggestedRevenueAccount:()=> '4101',invoiceDescriptionWithReason:d=>d,invoiceEmployeeDescription:r=>r.desc,invoiceDbRow:x=>x,billDbRow:x=>x,settingsWriteResultOk:r=>r&&r.ok,
  cleanupUploadedSupabaseAttachments:async()=>state.cleanup++,recordInvoiceWriteFailure:()=>false,recordBillWriteFailure:()=>false,applyMembershipOrgActorsToSteps:()=>{},saveLocalAppStateSoon:()=>{},notifyInvoiceReceivable:async()=>{state.notifications++;if(hooks.notify)await hooks.notify();},notifyBatchInvoiceReceivable:async()=>{state.notifications++;if(hooks.notify)await hooks.notify();},
  loadRowsByIdsForApprovalFallback:async(_client,_table,ids)=>{state.reads++;if(hooks.reload)await hooks.reload();const rows=Array.from(server.values()).flatMap(x=>x.data.rows).filter(r=>ids.includes(r.id)).map(row=>({...row,tenant_id:'fictional-tenant',data_environment:'test'}));rows.approvalLoadComplete=true;return rows;},mapInv:x=>x,mapBill:x=>x,approvalRowsMarkVerified:()=>{},approvalRowsMarkUnavailable:()=>{},
  renderInvTable:()=>{},renderBatchInvTable:()=>{},visibleInvoicesForCurrentUser:()=>c.INVS,markIncomeDocClean:()=>{},buildRecv:()=>{},buildApprovals:()=>{},buildDash:()=>{},buildInvoices:()=>{},renderBatchTable:()=>{},renderBillEntryTable:()=>{},buildBills:()=>{},renderNotifs:()=>{},renderBillList:()=>{},openApprovalTab:tab=>{state.navTabs.push(tab);c.S.page='approvals';c.S.aT=tab;},defaultInvoiceBatchRow:()=>({}),defaultBillRow:()=>({}),
  syncBatchRowsFromDom:()=>{},syncBillRowsFromDom:()=>{},invoiceBatchOverflowMessage:()=>'',billBatchOverflowMessage:()=>'',billBatchLimitError:()=>'',formFieldRequired:()=>false,invoiceBatchValidationError:()=>'',invoiceAmountsFromTotal:(total,rate,amt)=>({total,amount:amt,tax:total-amt}),invoiceGroupNo:r=>r.batchId||r.no,billItemKey:k=>k,
  num:value=>Number(value)||0,cloneApprovalStepsForRecord:clone,cloneSettingValue:clone,todayIso:()=> '2026-09-22',todaySlash:()=> '2026/09/22',todayMonth:()=> '2026-09',stableSnapshotValue:x=>x,normalizeSettingValue:x=>x,isRpcMissing:()=>false,expenseApplicantRevisionRpcErrorIsAmbiguous:e=>['NETWORK','CLIENT_TIMEOUT'].includes(e.code)||/fetch/.test(e.message||''),
  Math,Date,JSON,Error,Promise,Set,console:{warn(){},error:console.error},alert:value=>state.alerts.push(value),setTimeout:(cb,ms)=>setTimeout(cb,Math.min(ms,shared.timeoutMs||15)),clearTimeout};
 c.window=c;
 const transport={async rpc(name,args){
   if(name==='finance_income_reconcile_submission_v1'){
    state.reconciliations++;state.reconcileRequests.push(clone(args));state.events.push('reconcile');if(hooks.reconcile)await hooks.reconcile();
    if(state.reconcileError)return {error:state.reconcileError};
    if(state.reconcileState)return {data:{ok:true,state:state.reconcileState,result:state.reconcileResult}};
    const found=server.get(args.p_idempotency_key);
    if(found)return {data:{ok:true,state:'committed',result:clone(found.data)}};
    canceled.add(args.p_idempotency_key);return {data:{ok:true,state:'confirmed_not_committed'}};
   }
   const frozen=clone(args);calls.push(frozen);state.events.push('rpc');if(hooks.rpc)await hooks.rpc();if(state.deny)return {error:{code:'42501',message:'Fictional denied'}};
   if(state.statementTimeouts>0){state.statementTimeouts--;return {error:{code:'57014',message:'canceling statement due to statement timeout'}};}
   if(canceled.has(args.p_idempotency_key))return {error:{code:'P0001',message:'Original operation key is canceled'}};
   if(state.hangBeforeCommit)return new Promise(()=>{});
   const key=args.p_idempotency_key;if(server.has(key)){assert.equal(server.get(key).payload,JSON.stringify(args),'same key binds same immutable request');}else server.set(key,{payload:JSON.stringify(args),data:{ok:true,rows:args.p_items.map((item,index)=>({client_item_key:item.client_item_key,id:'saved-'+server.size+'-'+index,no:'INV-'+server.size+'-'+index,batch_id:args.p_items.length>1?'saved-batch':'',approval_status:'pending_accountant',approval_step:2}))}});
   if(shared.sqlCommit){const result=await shared.sqlCommit(args,server.get(key).data);server.get(key).data=result;}
   if(state.hang)return new Promise(()=>{});if(state.lost>0){state.lost--;return {error:{code:'NETWORK',message:'Failed to fetch after commit'}};}return {data:clone(server.get(key).data)};
  }};
 c.getSb=()=>transport;vm.createContext(c);
 ['expenseSubmissionOperationIdentity','withOperationTimeout','supabaseAuthErrorInfo','incomeSubmissionRpcItem','incomeFileSignature','incomeFieldValues','incomeDirtySnapshot','batchInvoiceSourceFiles'].forEach(name=>vm.runInContext(fn(name),c));
 c.withAbortableOperationTimeout=(pending,label,ms)=>c.withOperationTimeout(pending,label,ms);
 const start=html.indexOf('var INCOME_SUBMISSION_PENDING={}'),end=html.indexOf('\nasync function insertMembershipOrgSubmittedRecord',start);assert(start>=0&&end>start);vm.runInContext(html.slice(start,end),c);
 ['authoritativeBillSubmissionNumbers','showConfirmedBillSubmission'].forEach(name=>vm.runInContext(fn(name),c));
 ['reloadInvoicesByIds','reloadBillsByIds','insertMembershipOrgSubmittedRecord','insertMembershipOrgSubmittedBatch','issueInvCore','issueBatchCore','submitBillCore'].forEach(name=>vm.runInContext(fn(name),c));
 for(const name of ['issueInv','issueBatch','submitBill']){const start=html.indexOf('window.'+name+'=async function(){'),end=html.indexOf('\n};',start)+3;assert(start>=0);vm.runInContext(html.slice(start,end),c);}
 return {c,state,storage,durable,server,canceled,calls,nodes,shared:{storage,durable,server,canceled,calls,lockQueues},switchIdentity(){c.S.user={id:'fictional-B',n:'Fictional B',email:'b@example.invalid',role:'employee'};c.FINANCE_DRAFT_IDENTITY_EPOCH++;c.INVS=[];c.BILLS=[];}};
}
(async()=>{
 for(const [caller,type,total] of [['issueInv','invoice',1],['issueBatch','invoice',1],['submitBill','bill',1]]){
  let f=fixture();if(caller==='issueBatch'){f.c.S.bRows.push({...f.c.S.bRows[0],buyer:'Second buyer'});}
  const expected=caller==='issueBatch'?2:total;f.state.lost=1;await f.c[caller]();
  check(caller+': lost response reconciles committed result without replay',f.server.size===1&&f.calls.length===1&&f.state.events.join(',')==='rpc,reconcile');
  check(caller+': actual caller confirms all rows and clears durable attempt',(type==='bill'?f.c.BILLS:f.c.INVS).length===expected&&!f.c.loadIncomeSubmissionPending(type));
  if(type==='bill')check('Bill confirmation uses the server number and opens My Applications',f.state.alerts.some(text=>text.includes(f.c.BILLS[0].no)&&text.includes('正式單號'))&&f.state.navTabs.includes('mine')&&f.c.S.apprQuery===f.c.BILLS[0].no);
  check(caller+': no regenerated attachment or cleanup on recovery',f.state.uploads===(type==='bill'?0:1)&&f.state.cleanup===0);
  f=fixture();f.state.statementTimeouts=1;await f.c[caller]();
  check(caller+': first direct 57014 is a confirmed rollback',f.calls.length===1&&f.state.reconciliations===0&&f.server.size===0&&!f.c.loadIncomeSubmissionPending(type)&&f.state.cleanup===(type==='bill'?0:1));
  f.state.statementTimeouts=0;await f.c[caller]();
  check(caller+': later corrected send gets a fresh key',f.server.size===1&&f.calls[0].p_idempotency_key!==f.calls[1].p_idempotency_key);
  f=fixture();f.state.lost=1;f.state.reconcileError={code:'NETWORK',message:'Fictional offline'};await f.c[caller]();
  check(caller+': failed reconciliation retains original transaction',!!f.c.loadIncomeSubmissionPending(type)&&f.server.size===1&&f.calls.length===1&&f.state.cleanup===0&&Object.keys(f.c.POSTING_IN_FLIGHT).length===0);
  const original=JSON.stringify(f.calls[0]);f.nodes['inv-buyer'].value='Edited after unknown';f.c.S.bRows[0].buyer='Edited after unknown';f.c.BILL_ROWS[0].payer='Edited after unknown';
  f.state.reconcileError=null;await f.c[caller]();
  check(caller+': repeated click confirms original without sending edits',f.server.size===1&&f.calls.length===1&&JSON.stringify(f.calls[0])===original&&f.state.uploads===(type==='bill'?0:1));
  check(caller+': edited input remains intact while prior operation is recovered',f.nodes['inv-buyer'].value==='Edited after unknown'&&f.c.S.bRows[0].buyer==='Edited after unknown'&&f.c.BILL_ROWS[0].payer==='Edited after unknown');
  f=fixture();f.state.lost=1;f.state.reconcileError={code:'NETWORK',message:'Fictional offline'};await f.c[caller]();const pendingKey=f.calls[0].p_idempotency_key;
  await f.c[caller]();
  check(caller+': repeated failed confirmation never replays the original document',f.calls.length===1&&f.calls[0].p_idempotency_key===pendingKey&&!!f.c.loadIncomeSubmissionPending(type)&&f.state.cleanup===0);
  f.state.reconcileError=null;await f.c[caller]();
  check(caller+': later recovery reads the committed result without duplicate rows',f.server.size===1&&!f.c.loadIncomeSubmissionPending(type)&&f.calls.length===1);
  if(type==='bill')check('Bill recovery shows its original authoritative number and opens My Applications',f.state.alerts.some(text=>text.includes(f.c.BILLS[0].no)&&text.includes('正式單號'))&&f.state.navTabs.includes('mine'));
  f=fixture();f.state.lost=1;f.state.reconcileError={code:'NETWORK',message:'Fictional offline'};await f.c[caller]();const refreshed=fixture(f.shared);await refreshed.c[caller]();
  check(caller+': page refresh recovers persisted key/files without another upload',refreshed.server.size===1&&refreshed.calls.length===1&&refreshed.state.uploads===0&&!refreshed.c.loadIncomeSubmissionPending(type));
  check(caller+': restored unchanged original form clears after confirmed recovery',caller==='issueInv'?refreshed.nodes['inv-buyer'].value==='':caller==='issueBatch'?!refreshed.c.S.bRows[0].buyer:!refreshed.c.BILL_ROWS[0].payer);
  const afterRecoverCalls=refreshed.calls.length;await refreshed.c[caller]();check(caller+': next Send without new data does not recreate the old transaction',refreshed.calls.length===afterRecoverCalls);
  f=fixture();if(caller==='issueBatch')f.c.S.bRows.push({...f.c.S.bRows[0],buyer:'Second buyer'});f.state.lost=1;f.state.reconcileError={code:'NETWORK',message:'Fictional offline'};await f.c[caller]();const marker=f.c.incomeSubmissionRecoveryMarker(type);
  check(caller+': durable closed-tab marker contains only exact operation and item keys',!!marker&&marker.itemKeys.length===expected&&!JSON.stringify(marker).includes('Fictional buyer')&&!JSON.stringify(marker).includes('Fictional payer')&&!JSON.stringify(marker).includes('fictional/'));
  const closed=fixture({...f.shared,storage:new Map()});closed.state.reconcileState='pending';await closed.c[caller]();
  check(caller+': closed tab preserves marker while server reports pending',closed.calls.length===1&&closed.server.size===1&&!!closed.c.incomeSubmissionRecoveryMarker(type)&&closed.state.uploads===0&&closed.state.alerts.some(text=>text.includes('仍在處理')));
  closed.state.reconcileState='';await closed.c[caller]();
  check(caller+': closed tab confirms original committed rows without replay or duplicate',closed.calls.length===1&&closed.server.size===1&&(type==='bill'?closed.c.BILLS:closed.c.INVS).length===expected&&!closed.c.incomeSubmissionRecoveryMarker(type)&&closed.state.uploads===0);
  check(caller+': closed-tab reconciliation uses the exact type, key and environment',closed.state.reconcileRequests.every(args=>args.p_document_type===type&&args.p_idempotency_key===marker.operationKey&&args.p_data_environment==='test'));
  f=fixture();f.state.hangBeforeCommit=true;f.state.reconcileState='pending';await f.c[caller]();const sameTabKey=f.calls[0].p_idempotency_key;
  f.state.hangBeforeCommit=false;f.state.reconcileState='';await f.c[caller]();
  check(caller+': same-tab confirmed rollback keeps the form and permits a fresh send',f.canceled.has(sameTabKey)&&!f.c.loadIncomeSubmissionPending(type)&&f.calls.length===1&&f.nodes['inv-buyer'].value==='Fictional buyer'&&f.c.S.bRows[0].buyer==='Fictional buyer'&&f.c.BILL_ROWS[0].payer==='Fictional payer');
  f=fixture();f.state.hangBeforeCommit=true;f.state.reconcileState='pending';await f.c[caller]();const canceledKey=f.calls[0].p_idempotency_key;
  const closedRolledBack=fixture({...f.shared,storage:new Map()});await closedRolledBack.c[caller]();
  check(caller+': closed tab unlocks only after server seals absent key',closedRolledBack.server.size===0&&closedRolledBack.canceled.has(canceledKey)&&!closedRolledBack.c.incomeSubmissionRecoveryMarker(type)&&closedRolledBack.calls.length===1);
  const late=await closedRolledBack.c.getSb().rpc(caller==='submitBill'?'finance_submit_bill_batch':'finance_submit_invoice_batch',f.calls[0]);
  check(caller+': sealed key rejects a late original request',late.error&&late.error.code==='P0001'&&closedRolledBack.server.size===0);
  await closedRolledBack.c[caller]();
  check(caller+': after sealed rollback a new send receives a fresh key',closedRolledBack.server.size===1&&closedRolledBack.calls.at(-1).p_idempotency_key!==canceledKey);
  f=fixture();f.state.lost=1;f.state.reconcileError={code:'NETWORK',message:'Fictional offline'};await f.c[caller]();f.switchIdentity();
  check(caller+': original marker is invisible to a different signed-in account',f.c.incomeSubmissionRecoveryMarker(type)===null);
  f=fixture();f.state.lost=1;f.state.reconcileError={code:'NETWORK',message:'Fictional offline'};await f.c[caller]();f.state.reconcileError=null;f.state.hooks.reconcile=async()=>f.switchIdentity();await f.c.recoverPendingIncomeSubmission(type);
  check(caller+': identity change during reconciliation cannot clear the original marker',f.c.INVS.length===0&&f.c.BILLS.length===0&&f.durable.size===1&&f.calls.length===1);
  for(const stage of ['directory','route','preflight',...(type==='invoice'?['upload']:[]),'rpc']){
   f=fixture();f.state.hooks[stage]=async()=>f.switchIdentity();const staleOutcome=await f.c[caller]();
   check(caller+': '+stage+' stale caller returns false to suppress success feedback',staleOutcome===false);
   check(caller+': identity switch at '+stage+' discards old result',f.c.INVS.length===0&&f.c.BILLS.length===0&&f.nodes['inv-buyer'].value==='Fictional buyer'&&f.c.BILL_ROWS[0].payer==='Fictional payer'&&f.state.notifications===0);
   check(caller+': identity switch at '+stage+' never sends subsequent request',stage==='rpc'?f.calls.length===1:f.calls.length===0);
  }
  for(const epoch of ['FINANCE_DRAFT_IDENTITY_EPOCH','financeAuthIdentityEpoch']){f=fixture();f.state.hooks.rpc=async()=>{f.c[epoch]+=2;};await f.c[caller]();check(caller+': A-B-A '+epoch+' discards old response',f.c.INVS.length===0&&f.c.BILLS.length===0&&!!f.c.loadIncomeSubmissionPending(type));}
  for(const gate of ['financeLogoutInProgress','financeGoogleAccountSwitchInProgress']){f=fixture();f.c[gate]=true;await f.c[caller]();check(caller+': '+gate+' blocks dispatch',f.calls.length===0);}
 }
 {
  const f=fixture(),c=f.c;
  f.nodes['bill-list']={innerHTML:''};
  c.BILLS=[{id:'saved-bill',no:'BILL-2026-1234',createdAt:'2026-10-08T04:30:00Z',item:'居家服務費',payer:'虛構繳費人',period:'2026/10',amt:100,status:'unpaid',approvalStatus:'pending_accountant',applicantId:c.S.user.id}];
  Object.assign(c,{visibleBillsForCurrentUser:()=>c.BILLS,billApprovalCompleted:()=>false,requestIsRejected:()=>false,billApprovalLabel:()=> '待簽核',billIsMine:b=>b.applicantId===c.S.user.id,fmt:value=>'NT$'+value,escAttr:value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'),incomeManagementSearchState:()=>({bill:''}),incomeApplicantWithdrawButtonHtml:()=>''});
  ['billCardCreatedAt','renderBillList'].forEach(name=>vm.runInContext(fn(name),c));
  const openStart=html.indexOf('window.openPersonalBillByNumber=function(no){'),openEnd=html.indexOf('\n};',openStart)+3;vm.runInContext(html.slice(openStart,openEnd),c);
  c.renderBillList();
  check('Bill card shows its number, creation date and exact My Applications search link',f.nodes['bill-list'].innerHTML.includes('BILL-2026-1234')&&f.nodes['bill-list'].innerHTML.includes('2026')&&f.nodes['bill-list'].innerHTML.includes('在我的申請查這張'));
  c.openPersonalBillByNumber('BILL-2026-1234');
  check('Bill card location searches the authoritative number in My Applications',c.S.apprQuery==='BILL-2026-1234'&&f.state.navTabs.at(-1)==='mine');
 }
 {
  const f=fixture();
  check('Malformed bill success response cannot claim an official number',f.c.showConfirmedBillSubmission({data:{rows:[{id:'saved-bill',no:''}]}},1,'')===false&&f.c.BILL_CONFIRMED_SUBMISSION===null&&f.state.alerts.some(text=>text.includes('正式單號未能完整核對')));
 }
 let f=fixture();f.state.lost=1;f.state.reconcileError={code:'NETWORK',message:'Fictional offline'};await f.c.issueInv();f.state.reconcileError=null;f.state.hooks.reload=async()=>f.switchIdentity();await f.c.issueInv();check('Confirmed invoice refresh discards result after identity switch without cache merge',f.c.INVS.length===0&&f.nodes['inv-buyer'].value==='Fictional buyer');
 f=fixture();f.state.lost=1;f.state.reconcileError={code:'NETWORK',message:'Fictional offline'};await f.c.submitBill();f.state.reconcileError=null;f.state.hooks.reload=async()=>{f.c.financeAuthIdentityEpoch+=2;};await f.c.submitBill();check('Confirmed bill refresh discards A-B-A response before cache merge or form reset',f.c.BILLS.length===0&&f.c.BILL_ROWS[0].payer==='Fictional payer');
 f=fixture();f.state.hooks.rpc=async()=>{f.c.CURRENT_PERMISSION_SNAPSHOT={restricted:true};};await f.c.issueInv();check('Permission change during submission prevents old result UI',f.c.INVS.length===0&&f.state.notifications===0);
 f=fixture();f.state.hooks.rpc=async()=>{f.nodes['inv-buyer'].value='New draft while sending';};await f.c.issueInv();check('Changed form during initial acknowledged submission is preserved',f.nodes['inv-buyer'].value==='New draft while sending'&&f.c.INVS.length===1);
 f=fixture();f.state.storageOk=false;await f.c.issueInv();check('Storage failure blocks dispatch and permits cleanup of uncommitted attachment',f.calls.length===0&&f.server.size===0&&f.state.cleanup===1);
 f=fixture();f.state.durableOk=false;await f.c.issueInv();check('Unavailable persistent receipt blocks formal dispatch before any RPC',f.calls.length===0&&f.server.size===0&&f.state.cleanup===1);
 f=fixture();f.durable.set(f.c.incomeSubmissionRecoveryMarkerKey('invoice'),'{broken');await assert.rejects(()=>f.c.issueInv(),/前次送件識別碼/);check('Corrupt closed-tab marker fails closed before any new RPC',f.calls.length===0&&f.server.size===0);
 f=fixture();f.storage.set(f.c.incomeSubmissionStorageKey('invoice'),'{broken');await assert.rejects(()=>f.c.issueInv(),/原送單記錄/);check('Corrupt recovery record fails closed, unlocks button and dispatches nothing',f.calls.length===0&&Object.keys(f.c.POSTING_IN_FLIGHT).length===0);
 f=fixture();f.state.deny=true;await f.c.issueInv();check('First definitive rejection clears pending and cleans only unclaimed upload',f.calls.length===1&&f.server.size===0&&!f.c.loadIncomeSubmissionPending('invoice')&&f.state.cleanup===1);
 f.state.deny=false;await f.c.issueInv();check('Correction after definitive rejection is a new valid operation',f.server.size===1&&f.calls[0].p_idempotency_key!==f.calls[1].p_idempotency_key);
 f=fixture();f.state.lost=1;await f.c.issueInv();check('Authoritative reconciliation resolves a lost committed response',f.server.size===1&&f.c.INVS.length===1&&!f.c.loadIncomeSubmissionPending('invoice')&&f.state.reconciliations===1);
 f=fixture();f.state.lost=1;f.state.reconcileError={code:'42501',message:'Fictional permission check unavailable'};await f.c.issueInv();check('Unknown then reconciliation error retains original key and attachments',f.server.size===1&&!!f.c.loadIncomeSubmissionPending('invoice')&&f.state.cleanup===0);
 f=fixture();f.state.lost=1;f.state.reconcileError={code:'NETWORK',message:'Fictional offline'};await f.c.issueInv();f.state.reconcileError=null;f.state.reconcileState='committed';f.state.reconcileResult={ok:true,rows:[{client_item_key:'wrong-item',id:'wrong-id',no:'INV-WRONG'}]};await f.c.recoverPendingIncomeSubmission('invoice');
 check('Mismatched cached result keeps blocker, form and attachment metadata',!!f.c.loadIncomeSubmissionPending('invoice')&&!!f.c.incomeSubmissionRecoveryMarker('invoice')&&f.nodes['inv-buyer'].value==='Fictional buyer'&&f.state.cleanup===0&&f.calls.length===1);
 f=fixture();f.state.lost=1;f.state.reconcileError={code:'NETWORK',message:'Fictional offline'};await f.c.issueInv();f.state.reconcileError=null;f.state.hooks.reload=async()=>new Promise(()=>{});await f.c.recoverPendingIncomeSubmission('invoice');
 check('Confirmed COMMIT clears blocker even when 12-second list refresh times out',!f.c.loadIncomeSubmissionPending('invoice')&&!f.c.incomeSubmissionRecoveryMarker('invoice')&&f.calls.length===1&&f.state.alerts.some(text=>text.includes('列表資料暫時未同步')));
 f=fixture();f.state.hangBeforeCommit=true;f.state.reconcileState='pending';const started=Date.now();await f.c.issueInv();check('Never-resolving transport releases actual UI lock with recoverable state',Date.now()-started<1000&&Object.keys(f.c.POSTING_IN_FLIGHT).length===0&&!!f.c.loadIncomeSubmissionPending('invoice'));
 f.state.hangBeforeCommit=false;f.state.reconcileState='';await f.c.issueInv();check('Confirmation after deadline safely seals a never-started operation',f.server.size===0&&f.canceled.has(f.calls[0].p_idempotency_key)&&!f.c.loadIncomeSubmissionPending('invoice'));
 f=fixture();f.state.hang=true;await f.c.issueInv();check('Timed-out transport after COMMIT confirms original without another submit',f.server.size===1&&f.calls.length===1&&f.c.INVS.length===1&&!f.c.loadIncomeSubmissionPending('invoice'));
 f=fixture();f.state.hooks.notify=async()=>new Promise(()=>{});await f.c.issueInv();check('Committed submission does not keep UI locked for hung notification',f.c.INVS.length===1&&!f.c.loadIncomeSubmissionPending('invoice')&&Object.keys(f.c.POSTING_IN_FLIGHT).length===0);
 f=fixture();f.c.S.bRows=Array.from({length:33},(_,index)=>({...f.c.S.bRows[0],buyer:'Fictional buyer '+(index+1)}));f.state.lost=1;await f.c.issueBatch();
 check('33-item invoice batch reconciles under one frozen operation key',f.calls.length===1&&f.calls[0].p_items.length===33&&f.state.reconciliations===1&&f.server.size===1&&f.c.INVS.length===33&&!f.c.loadIncomeSubmissionPending('invoice')&&f.state.uploads===1&&f.state.cleanup===0);
 f=fixture();f.c.S.bRows.push({...f.c.S.bRows[0],buyer:'',desc:'Second invoice is incomplete'});
 await f.c.issueBatch();
 check('partially filled second invoice blocks the whole application before upload and RPC',f.calls.length===0&&f.state.uploads===0&&f.server.size===0&&f.c.S.bRows.length===2&&f.state.alerts.some(message=>message.includes('第 2 列')&&message.includes('不會被略過')));
 f=fixture();f.c.BATCH_INVOICE_READ_GENERATION=4;f.c.S.bUploadAnalyzingGeneration=4;
 await f.c.issueBatch();
 check('An active multi-file import cannot submit before its rows have joined the application',f.calls.length===0&&f.state.uploads===0&&f.server.size===0&&f.state.alerts.some(message=>message.includes('仍在匯入')));
 f=fixture();f.c.S.bRows=Array.from({length:151},(_,index)=>({...f.c.S.bRows[0],buyer:'Fictional buyer '+(index+1)}));f.state.lost=1;f.state.reconcileError={code:'NETWORK',message:'Fictional offline'};await f.c.issueBatch();
 const largeMarker=f.c.incomeSubmissionRecoveryMarker('invoice');
 check('151-invoice ambiguous result retains all item keys under one durable application marker',f.calls.length===1&&f.calls[0].p_items.length===151&&!!largeMarker&&largeMarker.itemKeys.length===151&&f.server.size===1);
 const largeReload=fixture({...f.shared,storage:new Map()});await largeReload.c.issueBatch();
 check('151-invoice closed-tab recovery confirms original batch without a duplicate submission',largeReload.calls.length===1&&largeReload.server.size===1&&largeReload.c.INVS.length===151&&!largeReload.c.incomeSubmissionRecoveryMarker('invoice')&&largeReload.state.uploads===0);
 f=fixture();
 const sourceA={name:'first.csv',type:'text/csv'},sourceB={name:'second.csv',type:'text/csv'};
 f.c.S.bUploadFiles=[sourceA,sourceB];f.c.S.bRows.push({...f.c.S.bRows[0],buyer:'Second source buyer'});
 await f.c.issueBatch();
 check('One reason with two source files submits one batch and uploads both originals',f.calls.length===1&&f.calls[0].p_items.length===2&&f.server.size===1&&f.state.uploads===1&&f.state.uploadFiles[0].length===2&&f.state.uploadFiles[0][0]===sourceA&&f.state.uploadFiles[0][1]===sourceB);
 f=fixture();f.c.INVOICE_BATCH_MAX_ITEMS=500;vm.runInContext(fn('invoiceBatchOverflowMessage'),f.c);
 f.c.S.bRows=Array.from({length:501},(_,index)=>({...f.c.S.bRows[0],buyer:'Fictional buyer '+(index+1)}));
 await f.c.issueBatch();
 check('501-row application fails closed before uploading or calling the submit RPC',f.calls.length===0&&f.state.uploads===0&&f.server.size===0&&f.c.S.bRows.length===501&&f.state.alerts.some(text=>text.includes('請勿拆')));
  f=fixture();f.c.S.bRows=Array.from({length:33},(_,index)=>({...f.c.S.bRows[0],buyer:'Fictional buyer '+(index+1)}));f.state.statementTimeouts=1;await f.c.issueBatch();
  check('33-item invoice batch with direct 57014 does not auto-repeat the doomed RPC',f.calls.length===1&&f.calls[0].p_items.length===33&&f.server.size===0&&!f.c.loadIncomeSubmissionPending('invoice')&&f.state.cleanup===1);
  for(const type of ['invoice','bill']){
   const first=fixture(),second=fixture({...first.shared,storage:new Map()});
   const record=()=>({id:type+'-cross-tab-'+Math.random().toString(36).slice(2),no:'CROSS-TAB',eid:'FICT-E',dc:'FICT-D',amt:100,tax:5,total:105,buyer:'Fictional buyer',item:'Fictional service',payer:'Fictional payer',date:'2026-09-22',steps:[{rk:'applicant_submit',uid:'fictional-A',a:'approved'}]});
   let resume;const held=new Promise(resolve=>resume=resolve);
   first.state.hooks.rpc=()=>held;first.state.lost=1;first.state.reconcileError={code:'NETWORK',message:'Fictional offline'};
   const original=first.c.submitIncomeDocumentTransaction(type,[record()]);
   await new Promise(resolve=>setImmediate(resolve));
   check(type+': first tab dispatches one reserved key',first.calls.length===1&&!!first.c.incomeSubmissionRecoveryMarker(type));
   const competing=await second.c.submitIncomeDocumentTransaction(type,[record()]);
   check(type+': second tab cannot reserve a different key while first is in flight',competing.unknown===true&&first.calls.length===1&&first.server.size===0);
   resume();const lost=await original;
   check(type+': lost response keeps one durable key after competing tab',lost.unknown===true&&first.server.size===1&&first.calls.length===1&&!!first.c.incomeSubmissionRecoveryMarker(type));
   const closed=fixture({...first.shared,storage:new Map()});await closed.c.recoverPendingIncomeSubmission(type);
   check(type+': closed tab confirms exactly one committed batch without replay',closed.server.size===1&&closed.calls.length===1&&!closed.c.incomeSubmissionRecoveryMarker(type));
  }
  f=fixture();f.c.navigator.locks=null;await f.c.issueInv();
  check('Browser without cross-tab locks fails closed before invoice RPC',f.calls.length===0&&f.server.size===0&&!f.c.incomeSubmissionRecoveryMarker('invoice')&&f.state.cleanup===1);
  f=fixture();f.c.navigator.locks.request=()=>Promise.reject(new Error('Lock manager unavailable'));await f.c.submitBill();
  check('Lock acquisition failure fails closed before bill RPC',f.calls.length===0&&f.server.size===0&&!f.c.incomeSubmissionRecoveryMarker('bill'));
  // The real database idempotency implementation also receives the actual
 // caller's frozen RPC arguments. Organization/permission routing remains in
 // the separate existing SQL/persona suites; this fixture does not stub commit.
 const {PGlite}=require('@electric-sql/pglite'),db=new PGlite();
 try{
  await db.exec(`create schema private;create table private.finance_income_document_operations(tenant_id uuid,data_environment text,operation_type text,idempotency_key text,request_digest text,actor_finance_user_id text,operation_status text default 'in_progress',result jsonb,completed_at timestamptz,primary key(tenant_id,data_environment,operation_type,idempotency_key));create table private.fictional_documents(operation_key text,item_key text,primary key(operation_key,item_key));`);
  const sql=fs.readFileSync(path.join(__dirname,'fixtures/finance_expense_revision_operations_20260912.sql'),'utf8');
  for(const name of ['finance_income_begin_operation','finance_income_finish_operation']){const start=sql.indexOf('CREATE OR REPLACE FUNCTION private.'+name+'(');assert(start>=0);await db.exec(sql.slice(start,sql.indexOf('$function$;',start)+11));}
  const tenant='00000000-0000-0000-0000-000000000001';
  const sqlCommit=async(args,result)=>{
   await db.exec('begin');try{
    const scope=[tenant,args.p_data_environment,'fictional_income_submit',args.p_idempotency_key];
    const cached=(await db.query('select private.finance_income_begin_operation($1,$2,$3,$4,$5,$6) result',[...scope,JSON.stringify(args),'fictional-A'])).rows[0].result;
    if(!cached){for(const item of args.p_items)await db.query('insert into private.fictional_documents values($1,$2)',[args.p_idempotency_key,item.client_item_key]);await db.query('select private.finance_income_finish_operation($1,$2,$3,$4,$5)',[...scope,JSON.stringify(result)]);}
    await db.exec('commit');return cached||result;
   }catch(error){await db.exec('rollback');throw error;}
  };
  for(const [caller,expectedDocuments] of [['issueInv',1],['issueBatch',1],['submitBill',1],['issueBatch',33]]){
   const sqlFixture=fixture({sqlCommit,timeoutMs:2000});
   if(expectedDocuments===33)sqlFixture.c.S.bRows=Array.from({length:33},(_,index)=>({...sqlFixture.c.S.bRows[0],buyer:'Fictional buyer '+(index+1)}));
   sqlFixture.state.lost=1;await sqlFixture.c[caller]();
   const key=sqlFixture.calls[0].p_idempotency_key;
   const tally=(await db.query("select (select count(*)::int from private.fictional_documents where operation_key=$1) documents,(select count(*)::int from private.finance_income_document_operations where idempotency_key=$1 and operation_status='completed') operations",[key])).rows[0];
   check(caller+' '+expectedDocuments+': actual PostgreSQL operation helper commits once before lost response reconciliation',sqlFixture.calls.length===1&&tally.documents===expectedDocuments&&tally.operations===1);
  }
 }finally{await db.close();}
 console.log('PASS: '+checks+' income submission caller/recovery checks');
})().catch(error=>{console.error(error);process.exitCode=1;});
