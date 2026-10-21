'use strict';
// Shipped transaction handlers and post-commit coordinator; fictional transports
// only. A confirmed write is independent of unrelated pending-list hydration.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
function source(name){
  let start=html.indexOf('function '+name+'(');assert(start>=0,name);
  if(html.slice(start-6,start)==='async ')start-=6;
  for(let i=html.indexOf('{',start);i<html.length;i++)if(html[i]==='}'){
    const candidate=html.slice(start,i+1);try{new vm.Script(candidate);return candidate;}catch(_){}
  }
  throw Error('Cannot extract '+name);
}
const clone=value=>JSON.parse(JSON.stringify(value));
let checks=0;function check(label){checks++;console.log('PASS '+label);}
function fixture(options={}){
  const trace={rpc:[],reads:0,refreshes:0,pending:[],cleared:[],statuses:[],followups:[],failures:[],unavailable:[],marks:[],feedbackMessages:[]};
  const row={id:'fictional-row',type:'payment_request',status:'pending_ceo',approvalStatus:'pending_ceo',rowVersion:7,steps:[{rk:'ceo',uid:'fictional-ceo'}]};
  const c={console:{warn(){}},Date,Promise,Object,Array,String,Number,Math,Set,Map,JSON,Error,setTimeout,clearTimeout,
    S:{user:{id:'fictional-ceo'},demoLogin:false,page:'approvals'},REQS:[row],BILLS:[row],INVS:[row],identity:'fixture-identity',
    num:Number,cloneSettingValue:clone,normalizeSettingValue:value=>value,normalizeFiles:value=>value,
    incomeSubmissionIdentity:()=>c.identity,incomeSubmissionIdentityCurrent:value=>value===c.identity,
    withOperationTimeout:async promise=>promise,hasSupabase:()=>true,activeDataEnvironment:()=> 'test',
    activeStep:r=>r.steps[0],procurementRequiresDedicatedAction:()=>false,canActRequest:()=>true,canActBill:()=>true,
    approvalActionValidation:()=>({ok:true}),approvalRecordsActionAvailability:(_,rows)=>({ok:true,rows}),
    approvalRowsHaveReconcilePending:()=>false,billBatchLimitError:()=>null,billGroupRows:()=>c.BILLS,
    approvalValidatedExpectedSteps:(_,expected)=>expected,expenseExpectedStepPayload:rows=>Object.fromEntries(rows.map(r=>[r.id,{row_version:r.rowVersion}])),
    incomeActionContext:()=>({key:'frozen-operation'}),isRpcMissing:()=>false,approvalContentVersionChangedError:()=>false,
    cleanupApprovalFilesAfterDefiniteFailure:async()=>{},invoiceBatchActionRows:()=>c.INVS,
    getSb:()=>({rpc:async(name,args)=>{trace.rpc.push({name,args:clone(args)});if(options.rpcError)return{error:options.rpcError};if(options.switchAt==='rpc')c.identity='new-identity';return{data:{ok:true,count:1}};}}),
    financeMutationRpcWithAmbiguousRetry:async(_name,_args,_count,_readback,_context,_meta,call)=>options.unknown?{unknown:true,error:Error('result unknown')}:{response:await call()},
    approvalExpectedStepChanged:()=>options.changed!==false,
    approvalRowsMarkPending:(...args)=>trace.marks.push(args),
    approvalSetReconcilePending:(kind,ids,pending)=>trace.pending.push({kind,ids:clone(ids),pending}),
    clearIncomeActionContext:context=>trace.cleared.push(context.key),
    setTopSyncStatus:message=>trace.statuses.push(message),
    refreshApprovalAfterCommittedAction:async(reason,table,ids,opts)=>{
      trace.refreshes++;trace.lastRefresh={reason,table,ids:clone(ids),options:clone(opts)};
      if(options.switchAt==='refresh')c.identity='new-identity';
      if(options.refreshThrow)throw Error('fictional list render failure');
      return options.listReady===true;
    },
    invoiceNeedsReceivableFollowup:()=>false,canAttemptInvoiceRevenuePosting:()=>false,
    persistAccountingLinesRemote:async()=>({ok:true}),
    ACTION_FEEDBACK_ACTIVE:0,ACTION_FEEDBACK_ALERTED:false,
    showActionFeedback(){},hideActionFeedback(){},completeActionFeedback:(title,body,duration)=>{trace.followups.push(title);trace.feedbackMessages.push({title,body,duration});},failActionFeedback:title=>trace.failures.push(title)
  };
  async function read(){
    trace.reads++;
    if(options.switchAt==='read')c.identity='new-identity';
    if(options.readThrow)throw Error('fictional exact read timeout');
    return options.readReady!==false;
  }
  c.reloadRequestsByIds=read;c.reloadBillsByIds=read;c.reloadInvoicesByIds=read;
  vm.createContext(c);
  vm.runInContext(['approvalStepMutationReadbackMatches','readbackApprovalStepMutation','reportCommittedApprovalFollowup','committedApprovalSyncNotice','committedApprovalFeedbackMessage','publishCommittedApprovalFeedback','completeCommittedApprovalUi','finishCommittedApprovalAction','expenseActiveStepTransaction','billActiveStepTransaction','invoiceActiveStepTransaction','withActionFeedback'].map(source).join('\n'),c);
  function act(kind){
    const expected={'fictional-row':{row_version:7}};
    if(kind==='expense')return c.expenseActiveStepTransaction([row],'approve','',[],'',{});
    if(kind==='bill')return c.billActiveStepTransaction(row,'approve','',[],'',expected);
    return c.invoiceActiveStepTransaction(row,'approve','',[],'',{},expected,[row]);
  }
  return{c,row,trace,act};
}
async function run(){
  for(const kind of ['expense','bill','invoice']){
    let f=fixture(),result=await f.act(kind);
    assert(result.ok&&result.committed&&!result.refreshRequired&&result.listRefreshPending);
    assert.equal(f.trace.rpc.length,1);assert.equal(f.trace.reads,1);
    assert.equal(f.trace.lastRefresh.options.affectedReadbackConfirmed,true);
    assert.equal(f.trace.pending.at(-1).pending,false);
    assert(f.trace.statuses.at(-1).includes('簽核已完成'));
    check(kind+' acknowledged + exact read succeeds even if an unrelated batch is still loading');

    f=fixture({refreshThrow:true});
    result=await f.c.withActionFeedback('正在簽核',()=>f.act(kind),'簽核已完成');
    assert(result.committed&&!result.refreshRequired&&result.listRefreshPending);
    assert.deepEqual(f.trace.failures,[]);assert.deepEqual(f.trace.followups,['簽核已完成']);
    check(kind+' post-commit list/render exception cannot produce a failed-write banner');

    f=fixture({readThrow:true});result=await f.act(kind);
    assert(result.committed&&result.refreshRequired&&result.listRefreshPending);
    assert.equal(f.trace.rpc.length,1);assert.equal(f.trace.pending.at(-1).pending,false);
    assert.equal(f.trace.marks.length,1);assert.equal(f.trace.cleared.length,1);
    check(kind+' exact-read timeout retains confirmed result and row authority guard, without a second mutation');

    f=fixture({readReady:false,listReady:true});result=await f.act(kind);
    assert(result.committed&&result.refreshRequired);assert.equal(f.trace.reads,2);
    assert.equal(f.trace.pending.at(-1).pending,false);assert.equal(f.trace.marks.length,1);
    check(kind+' a complete pending list cannot substitute for the completed row exact readback');

    for(const switchAt of ['rpc','read','refresh']){
      f=fixture({switchAt});result=await f.act(kind);
      assert(result.committed&&result.identityChanged&&result.refreshRequired);
      assert.equal(f.trace.statuses.length,0);
      if(switchAt==='rpc'){assert.equal(f.trace.marks.length,0);assert.equal(f.trace.refreshes,0);assert.equal(f.trace.reads,0);}
      if(switchAt==='read'){assert.equal(f.trace.pending.length,1);assert.equal(f.trace.refreshes,0);}
      check(kind+' identity change during '+switchAt+' never updates new-user success/recovery UI');
    }

    f=fixture({unknown:true});result=await f.act(kind);
    assert(!result.ok&&result.unknown&&!result.committed);assert.equal(f.trace.reads,0);assert.equal(f.trace.refreshes,0);
    check(kind+' unknown RPC outcome never enters the committed-success path');

    f=fixture({rpcError:{code:'42501',message:'denied'}});result=await f.act(kind);
    assert(!result.ok&&!result.committed);assert.equal(f.trace.reads,0);assert.equal(f.trace.refreshes,0);
    check(kind+' definite server refusal is still a real failure');
  }
  {
    const f=fixture();f.c.invoiceNeedsReceivableFollowup=()=>f.trace.reads>0;
    f.c.notifyInvoiceReceivable=async()=>{throw Error('notification transport failed')};
    const result=await f.act('invoice');assert(result.committed&&!result.refreshRequired);
    assert(result.postCommitWarnings.includes('收款通知待同步'));
    assert(f.trace.statuses.at(-1).includes('收款通知待同步'));assert.equal(f.trace.rpc.length,1);
    check('invoice notification exception is a follow-up warning, never an approval failure');
  }
  for(const failure of ['false','throw']){
    const f=fixture();f.c.canAttemptInvoiceRevenuePosting=()=>true;
    f.c.postInvoiceRevenue=async()=>{if(failure==='throw')throw Error('posting failed');return false};
    const result=await f.act('invoice');assert(result.committed);
    assert(result.postCommitWarnings.includes('發票收入入帳待會計核對'));
    assert(!f.trace.statuses.some(text=>text.includes('已入帳')));
    check('real revenue posting '+failure+' remains pending accounting review, never claimed posted');
  }
  {
    const f=fixture();f.c.persistAccountingLinesRemote=async()=>{throw Error('line sync failed')};
    const result=await f.c.expenseActiveStepTransaction([f.row],'approve','',[],'',{'fictional-row':{}});
    assert(result.committed&&result.postCommitWarnings.includes('後續資料同步待確認'));
    check('expense accounting-line follow-up failure cannot invalidate the atomic approval receipt');
  }
  // Exercise the real whole-list refresh boundary as well: leave action
  // authority pending, but do not declare a confirmed source unreadable.
  {
    const f=fixture();Object.assign(f.c,{
      clearFinanceMegaRemittance(){},approvalFastBootstrapIdentity:()=>f.c.identity,
      invalidateDashboardFinancialCache(){},uniqueRemoteStrings:ids=>[...new Set(ids)],
      approvalRowsMarkPending:(...args)=>f.trace.marks.push(args),
      approvalRowsMarkUnavailable:(...args)=>f.trace.unavailable.push(args),
      remoteRefreshApprovalRevision:0,remoteRefreshApprovalDirty:false,remoteRefreshApprovalInFlight:false,
      approvalFastBootstrapRunIdentity:'',approvalFastBootstrapRunPromise:null,
      requestApprovalFastBootstrap:async()=>({hydrated:false}),approvalMutationRuntimeReady:()=>true,
      APPROVAL_FAST_BOOTSTRAP:{},buildApprovals(){},scheduleRemoteRecovery(){},syncStatusText:()=>''
    });
    vm.runInContext(source('refreshApprovalAfterCommittedAction'),f.c);
    assert.equal(await f.c.refreshApprovalAfterCommittedAction('fixture','invoices',['fictional-row'],{affectedReadbackConfirmed:true}),false);
    assert.equal(f.trace.marks.length,0);assert.equal(f.trace.unavailable.length,0);
    assert(f.c.APPROVAL_FAST_BOOTSTRAP.error.includes('簽核已完成'));
    check('confirmed row keeps the original pending authority guard without a false unavailable mark');
  }
  for(const kind of ['expense','bill','invoice']){
    const f=fixture();let reconcile=true,followups=0;
    f.c.approvalSetReconcilePending=(_kind,_ids,value)=>{reconcile=value;};
    const read=async()=>{f.trace.reads++;return f.trace.reads>1;};
    f.c.reloadRequestsByIds=read;f.c.reloadBillsByIds=read;f.c.reloadInvoicesByIds=read;
    f.c.refreshApprovalAfterCommittedAction=async()=>{assert.equal(reconcile,false,'same actor next step must not be gated by the previous UNKNOWN flag');return true;};
    f.c.canAttemptInvoiceRevenuePosting=()=>true;f.c.postInvoiceRevenue=async()=>{followups++;return true;};
    f.c.persistAccountingLinesRemote=async()=>{followups++;return {ok:true};};
    const result=kind==='expense'?await f.c.expenseActiveStepTransaction([f.row],'approve','',[],'',{'fictional-row':{}}):await f.act(kind);
    assert(result.committed&&!result.refreshRequired);assert.equal(f.trace.reads,2);
    if(kind!=='bill')assert.equal(followups,1);
    check(kind+' same-actor next-step recovery is not self-blocked and runs business follow-up once after the second exact read');
  }
  {
    const f=fixture();let diagnostic=0,recovery=0;
    f.c.recordOpsEventDedup=()=>{diagnostic++;throw Error('diagnostic renderer unavailable');};
    f.c.setTopSyncStatus=()=>{throw Error('status renderer unavailable');};
    f.c.scheduleRemoteRecovery=()=>{recovery++;};
    const result=await f.act('bill');assert(result.committed);assert(diagnostic>0&&recovery>0);
    assert.equal(await f.c.completeCommittedApprovalUi(result,()=>{throw Error('detail rendering unavailable');}),true);
    assert.equal(f.trace.rpc.length,1);
    check('diagnostic and status rendering failures never change a confirmed receipt or retry the write');
  }
  {
    const f=fixture();f.c.window=f.c;
    Object.assign(f.c,{procurementRequiresDedicatedAction:()=>false,laborElectronicMarker:()=>false,isRestrictedReturnedMiddleStep:()=>false,
      approvalActionPayload:async()=>({comment:'',files:[],addUid:''}),approvalActionPreflight:()=>true,uploadApprovalFiles:async p=>p,
      expenseApprovalPreparation:()=>({patches:{}}),buildAll:()=>{throw Error('actual caller render failure');},openDetail(){},alert(){},recordApprovalWriteFailure(){},
      scheduleRemoteRecovery:()=>f.trace.followups.push('read-only-recovery')});
    const start=html.indexOf('window.doApprove=async function('),end=html.indexOf('\n};',start)+3;
    vm.runInContext(html.slice(start,end),f.c);
    await f.c.withActionFeedback('正在簽核',()=>f.c.doApprove(f.row.id),'簽核已完成');
    assert.equal(f.trace.rpc.length,1);assert.deepEqual(f.trace.failures,[]);
    assert(f.trace.statuses.at(-1).includes('後續畫面或通知尚待同步'));assert(f.trace.followups.includes('read-only-recovery'));
    check('real expense UI caller under withActionFeedback cannot turn a post-commit render exception into 處理失敗');
    await assert.rejects(f.c.completeCommittedApprovalUi({ok:false,unknown:true},()=>{throw Error('not committed');}),/not committed/);
    check('UI safety helper does not swallow an unknown or rejected transaction error');
  }
  for(const kind of ['expense','invoice']){
    const f=fixture();f.c.window=f.c;let renders=0;
    Object.assign(f.c,{canActInvoice:()=>true,requireApprovalRecordsActionAvailability:()=>true,canReturnPreviousStep:()=>true,confirmReturnPreviousAction:()=>true,
      el:()=>({value:'fictional return reason'}),readStepFiles:async()=>[],uploadAttachmentsToSupabase:async files=>files,todayIso:()=> '2026-10-21',
      saveLocalAppState(){},pushNotification(){},notifDbRow:row=>row,stepTitle:()=> 'fictional step',
      dbInsert:async()=>{f.c.identity='new-identity';return{ok:true};},buildAll:()=>renders++,renderNotifs:()=>renders++,openDetail:()=>renders++,closeAppr:()=>renders++,buildInvoices:()=>renders++,buildApprovals:()=>renders++,
      alert:()=>renders++,rejectApprovalHistoryIncomeWrite:()=>false,approvalModalExpectedSteps:()=>({'fictional-row':{row_version:7}})});
    let result;
    if(kind==='expense'){
      vm.runInContext(source('returnPreviousRequestWithFields'),f.c);
      result=await f.c.returnPreviousRequestWithFields(f.row.id,'note','files',false);
    }else{
      vm.runInContext(source('returnInvoiceGroupCore'),f.c);
      const start=html.indexOf('window.apprReturnPreviousInv=async function('),end=html.indexOf('\n};',start)+3;
      vm.runInContext(html.slice(start,end),f.c);result=await f.c.apprReturnPreviousInv(f.row.id);
    }
    assert.equal(result,false);assert.equal(renders,0);assert.equal(f.trace.rpc.length,1);
    check(kind+' identity switch during a post-commit notification never renders, closes, or alerts the new account');
  }
  for(const name of ['approveBillGroupCore','returnBillGroupCore','rejectBillGroupCore','approveInvoiceGroupCore','returnInvoiceGroupCore','rejectInvoiceGroupCore']){
    const f=fixture(),receipt={};
    f.c.billActiveStepTransaction=f.c.invoiceActiveStepTransaction=async()=>({available:true,ok:false,unknown:true,identityChanged:true});
    f.c.recordBillWriteFailure=f.c.recordInvoiceWriteFailure=()=>{throw Error('old actor failure must not render');};
    vm.runInContext(source(name),f.c);
    const args=name.startsWith('approve')?(name.includes('Invoice')?[f.row,'',[],'',{},null,null,receipt]:[f.row,'',[],'',null,receipt]):(name.includes('Invoice')?[f.row,'',[],null,null,receipt]:[f.row,'',[],null,receipt]);
    assert.equal(await f.c[name](...args),0);assert(receipt.identityChanged&&!receipt.committed);
    check(name+' propagates RPC identity cancellation to the outer caller without claiming success');
  }
  {
    const f=fixture(),receipt=await f.act('expense');
    for(const value of [true,false,undefined]){
      const before=f.trace.feedbackMessages.length;
      const result=await f.c.withActionFeedback('loading',context=>f.c.completeCommittedApprovalUi(receipt,()=>value,context),'approved');
      assert.equal(result,value,'preserve original boolean/undefined API');
      if(value===false)assert.equal(f.trace.feedbackMessages.length,before);
      else {assert(f.trace.feedbackMessages.at(-1).body.includes('其他待辦清單仍在同步'));assert.equal(f.trace.feedbackMessages.at(-1).duration,6500);}
    }
    check('per-action receipt supplies visible warning while preserving true/false/undefined caller contracts');
    await f.c.withActionFeedback('loading',context=>f.c.completeCommittedApprovalUi({...receipt,postCommitWarnings:['發票收入入帳待會計核對']},()=>{f.c.ACTION_FEEDBACK_ALERTED=true;return true;},context),'approved');
    assert(f.trace.feedbackMessages.at(-1).body.includes('發票收入入帳待會計核對'));
    check('existing batch-result dialog cannot suppress a confirmed receipt business warning');
    const ready=Object.assign({},receipt,{refreshRequired:false,listRefreshPending:false,postCommitWarnings:[]});
    await f.c.withActionFeedback('loading',context=>f.c.completeCommittedApprovalUi(ready,()=>true,context),'approved');
    assert.equal(f.trace.feedbackMessages.at(-1).body,'資料已建立或更新完成。');
    check('normal confirmed action keeps the original success feedback without a warning');
    let release;const pending=new Promise(resolve=>{release=resolve;});
    const first=f.c.withActionFeedback('first',async context=>{await pending;return f.c.completeCommittedApprovalUi({...ready,postCommitWarnings:['first-only']},()=>true,context);},'first');
    const second=f.c.withActionFeedback('second',context=>f.c.completeCommittedApprovalUi({...ready,postCommitWarnings:['second-only']},()=>true,context),'second');
    assert.equal(await second,true);release();assert.equal(await first,true);
    assert(f.trace.feedbackMessages.at(-1).body.includes('first-only'));assert(!f.trace.feedbackMessages.at(-1).body.includes('second-only'));
    check('overlapping actions never share receipt warnings through a global flag');
    const before=f.trace.feedbackMessages.length;
    const changed=await f.c.withActionFeedback('loading',context=>{context.committedReceipt=ready;f.c.identity='another-user';return true;},'approved');
    assert.equal(changed,false);assert.equal(f.trace.feedbackMessages.length,before);
    check('shared feedback rechecks receipt identity immediately before showing completion');
  }
  for(const second of ['unknown','denied','ready']){
    const f=fixture(),rows=[{...f.row,id:'fictional-first'},{...f.row,id:'fictional-second'}];
    let calls=0;const alerts=[];
    Object.assign(f.c,{selectedApprovalItems:()=>rows.map(raw=>({kind:'inv',raw})),prompt:()=>'',
      approvalItemKey:item=>item.raw.id,approvalRowFormNo:item=>item.raw.id,
      approvalItemActionRows:item=>[item.raw],canActInvoice:()=>true,
      approvalBulkExpectedSteps:()=>({fictional:true}),approvalClearBulkExpectedSteps(){},
      buildInvoices(){},buildRecv(){},buildDash(){},buildReports(){},buildApprovals(){},closeAppr(){},
      alert:text=>{alerts.push(text);f.c.ACTION_FEEDBACK_ALERTED=true;},
      recordInvoiceWriteFailure:()=>{f.c.ACTION_FEEDBACK_ALERTED=true;},
      invoiceActiveStepTransaction:async()=>{
        calls++;
        if(calls===2&&second!=='ready')return{available:true,ok:false,unknown:second==='unknown',error:Error(second)};
        return{available:true,ok:true,committed:true,count:1,identity:f.c.identity,kind:'invoice',operationKey:'fictional-'+calls,
          refreshRequired:calls===1,listRefreshPending:calls===1,postCommitWarnings:[]};
      }});
    vm.runInContext([source('approveInvoiceGroupCore'),source('bulkRunSelected')].join('\n'),f.c);
    await f.c.withActionFeedback('loading',context=>f.c.bulkRunSelected('approve',context),'整批通過完成');
    assert.equal(calls,2);assert.deepEqual(f.trace.failures,[]);
    const message=f.trace.feedbackMessages.at(-1);
    assert.equal(message.title,second==='ready'?'已處理 2 筆':'已處理 1 筆，略過 1 筆');
    assert(message.body.includes('此單最新畫面尚待同步'));
    assert(!message.title.includes('整批通過完成'));
    if(second==='unknown')assert(message.body.includes('1 項結果待確認，請勿重複送出'));
    if(second==='denied')assert(message.body.includes('1 項未完成'));
    assert(alerts.at(-1).includes(second==='ready'?'已處理 2 筆':'已處理 1 筆，略過 1 筆'));
    check('actual bulk caller retains first-batch pending sync and exact partial outcome when second is '+second);
  }
  {
    const f=fixture(),receipt=await f.act('expense');
    f.c.completeActionFeedback=()=>{throw Error('feedback renderer failed');};
    const result=await f.c.withActionFeedback('loading',context=>f.c.completeCommittedApprovalUi(receipt,()=>true,context),'approved');
    assert.equal(result,true);assert.deepEqual(f.trace.failures,[]);
    assert(f.trace.statuses.at(-1).includes('完成提示尚待同步'));
    check('final shared feedback renderer exception cannot turn a positive receipt into failed approval');
  }
  for(const oldOutcome of ['false','throw']){
    const f=fixture();let resume,hides=0;
    f.c.hideActionFeedback=()=>hides++;
    const wait=new Promise(resolve=>{resume=resolve;});
    const oldAction=f.c.withActionFeedback('old actor',async()=>{await wait;if(oldOutcome==='throw')throw Error('old actor error');return false;},'old done');
    f.c.identity='new-actor';
    await assert.rejects(f.c.withActionFeedback('new actor',()=>{throw Error('new account refusal');},'new done','new failure'),/new account refusal/);
    assert.deepEqual(f.trace.failures,['new failure']);resume();assert.equal(await oldAction,false);
    assert.equal(hides,0);assert.deepEqual(f.trace.failures,['new failure']);assert.equal(f.c.ACTION_FEEDBACK_ACTIVE,0);
    check('stale actor '+oldOutcome+' cannot dismiss or replace the new account error feedback');
  }
  console.log('OK: '+checks+' committed approval feedback checks; no live data or bank operations');
}
run().catch(error=>{console.error(error);process.exitCode=1;});
