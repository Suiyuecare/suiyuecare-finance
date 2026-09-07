#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert'),vm=require('vm');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
let count=0;const check=(name,value)=>{assert(value,name);count++;};
const index=read('index.html');
for(const match of index.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g))if(!/\bsrc\s*=|application\/ld\+json/.test(match[1]))new vm.Script(match[2]);
check('Every production inline script parses',true);
function receipt(extra={}){
 const calls=[],flags=[],rows=[{id:'one',status:'pending_receipt_review',total:105,rowVersion:2}],runtime={
  S:{user:{id:'ceo',authUserId:'auth-ceo'}},isIdentityBlocked:()=>false,currentTenantId:()=> 'tenant',activeDataEnvironment:()=> 'test',
  ensureSupabaseWriteReady:async()=>({ok:true}),getSb:()=>({rpc:async(name,args)=>{calls.push(JSON.parse(JSON.stringify(args)));return {data:{ok:true,count:1}};}}),
  expenseApplicantRevisionRpcErrorIsAmbiguous:e=>e.code==='NETWORK',reloadInvoicesByIds:async()=>true,
  approvalSetReconcilePending:(kind,ids,flag)=>flags.push(flag),setTopSyncStatus:()=>{},refreshApprovalAfterCommittedAction:async()=>{},...extra};
 const ctx={FinanceApprovalRuntime:runtime,crypto:{randomUUID:()=> 'stable-operation'}};ctx.window=ctx;vm.runInNewContext(read('assets/engines/receipt-transactions.js'),ctx);
 return {ctx,runtime,calls,rows,flags};
}
function notifications(data={},extra={}){
 const opened=[],readIds=[],alerts=[],queries=[];const runtime={isIdentityBlocked:()=>false,S:{user:{id:'user'},demoLogin:false},INVS:[],REQS:[],BILLS:[],NOTIFS:[{id:'notif',reqId:'one',recordType:'invoices',type:'receipt'}],
  approvalFastBootstrapIdentity:()=> 'auth',activeDataEnvironment:()=> 'test',currentTenantId:()=> 'tenant',
  mapInv:r=>({...r,mapped:'invoice'}),mapBill:r=>({...r,mapped:'bill'}),mapReq:r=>({...r,mapped:'request'}),
  markNotifRead:async id=>readIds.push(id),approvalRowsMarkVerified:()=>{},
  showReceiptTaskD:r=>opened.push(['receipt',r.id]),showInvApprD:r=>opened.push(['invoice',r.id]),showBillApprD:r=>opened.push(['bill',r.id]),openDetail:id=>opened.push(['request',id]),
  getSb:()=>({from:table=>{const filters={};return {select(){return this;},eq(key,value){filters[key]=value;return this;},async maybeSingle(){queries.push({table,filters});return {data:data[table]||null};}};}}),...extra};const ctx={FinanceApprovalRuntime:runtime,alert:text=>alerts.push(text)};ctx.window=ctx;
 vm.runInNewContext(read('assets/engines/notification-routing.js'),ctx);return {ctx,runtime,opened,readIds,alerts,queries};
}
async function rejects(name,fn,code){let e;try{await fn();}catch(error){e=error;}check(name,e&&(!code||e.code===code));}
(async()=>{
 const bridgeCtx={window:{},S:{user:{id:'actor'}},REQS:[],INVS:[],BILLS:[],NOTIFS:[],financeWorkspaceIdentityBlocked:false,currentTenantId:()=> 'tenant'};
 const bridgeStart=index.indexOf('function createFinanceApprovalRuntime(){'),bridgeEnd=index.indexOf('window.FinanceApprovalRuntime=createFinanceApprovalRuntime();',bridgeStart);
 assert(bridgeStart>=0&&bridgeEnd>bridgeStart);vm.runInNewContext(index.slice(bridgeStart,bridgeEnd),bridgeCtx);
 const bridge=bridgeCtx.createFinanceApprovalRuntime();bridgeCtx.INVS=[{id:'fresh'}];check('Actual closure facade getter follows a reassigned source list',bridge.INVS[0].id==='fresh');
 bridge.REQS=[{id:'engine-readback'}];check('Actual closure facade setter updates the source list',bridgeCtx.REQS[0].id==='engine-readback');
 check('Actual facade calls closure functions without blanket window exports',bridge.currentTenantId()==='tenant'&&bridgeCtx.window.currentTenantId===undefined);
 let fixture=receipt();check('Receipt engine fixture has only the explicit facade, no accidental global dependencies',!Object.hasOwn(fixture.ctx,'getSb')&&!Object.hasOwn(fixture.ctx,'S'));
 let before=JSON.stringify(fixture.rows),result=await fixture.ctx.financeReceiptAction(fixture.rows,'approve','note',[],{one:2});
 check('One RPC receives reviewed version and scope',fixture.calls.length===1&&fixture.calls[0].p_expected_versions.one===2&&fixture.calls[0].p_data_environment==='test');
 check('Success never fabricates local ledger/status',result.committed&&JSON.stringify(fixture.rows)===before);
 const attachments={window:{},console};attachments.window.window=attachments.window;
 vm.runInNewContext(read('assets/engines/finance-v4-engine-registry.js'),attachments);
 vm.runInNewContext(read('assets/engines/attachment-engine.js'),attachments);
 const proof={n:'proof.png',bucket:'finance-attachments',path:'anonymous/proof.png'};
 fixture=receipt({uniqueAttachments:attachments.window.FinanceAttachmentEngine.uniqueFiles});
 await fixture.ctx.financeReceiptAction(fixture.rows,'submit','note',[proof,proof],{one:2});
 check('Receipt dispatch deduplicates the reviewed proof with the actual attachment engine',fixture.calls[0].p_files.length===1&&fixture.calls[0].p_files[0].path===proof.path);
 fixture=receipt({uniqueAttachments:attachments.window.FinanceAttachmentEngine.uniqueFiles});
 await fixture.ctx.financeReceiptAction(fixture.rows,'submit','note',{one:[proof,proof]},{one:2});
 check('Per-invoice receipt proof map is also deduplicated before dispatch',fixture.calls[0].p_files.one.length===1);

 fixture=receipt({reloadInvoicesByIds:async()=>false});result=await fixture.ctx.financeReceiptAction(fixture.rows,'approve','note',[],{one:2});
 check('Committed write + failed readback remains committed',result.committed&&result.refreshRequired&&fixture.flags.includes(true));
 fixture=receipt({refreshApprovalAfterCommittedAction:async()=>{throw Error('render failed');}});result=await fixture.ctx.financeReceiptAction(fixture.rows,'approve','note',[],{one:2});
 check('Committed write + rendering failure never claims rollback',result.committed&&result.refreshRequired);
 const attempts=[];fixture=receipt({getSb:()=>({rpc:async(name,args)=>{attempts.push(args.p_idempotency_key);return attempts.length===1?{error:{code:'NETWORK'}}:{data:{ok:true,count:1}};}})});
 result=await fixture.ctx.financeReceiptAction(fixture.rows,'approve','note',[],{one:2});
 check('Ambiguous retry reuses exact operation key',result.committed&&attempts.length===2&&attempts[0]===attempts[1]);
 fixture=receipt({getSb:()=>({rpc:async()=>({error:{code:'NETWORK'}})})});
 await rejects('Repeated unknown outcome requires reconciliation',()=>fixture.ctx.financeReceiptAction(fixture.rows,'approve','note',[],{one:2}),'FINANCE_MUTATION_RESULT_UNKNOWN');
 check('Unknown result flags pending without optimistic mutations',fixture.flags.includes(true)&&fixture.rows[0].status==='pending_receipt_review');
 fixture=receipt({getSb:()=>({rpc:async()=>({data:{ok:true,count:0}})})});
 await rejects('Malformed response also preserves unknown state',()=>fixture.ctx.financeReceiptAction(fixture.rows,'approve','note',[],{one:2}),'FINANCE_MUTATION_RESULT_UNKNOWN');
 check('Malformed response requires reconciliation',fixture.flags.includes(true));
 fixture=receipt();fixture.runtime.getSb=()=>({rpc:async()=>{fixture.runtime.S.user.id='other';return {data:{ok:true,count:1}};}});
 await rejects('Account switch during RPC never pretends no commit',()=>fixture.ctx.financeReceiptAction(fixture.rows,'approve','note',[],{one:2}),'FINANCE_MUTATION_RESULT_UNKNOWN');
 fixture=receipt();fixture.runtime.getSb=()=>({rpc:async()=>{fixture.runtime.isIdentityBlocked=()=>true;return {data:{ok:true,count:1}};}});
 await rejects('Identity lock during RPC requires reconciliation, not unlocked success',()=>fixture.ctx.financeReceiptAction(fixture.rows,'approve','note',[],{one:2}),'FINANCE_MUTATION_RESULT_UNKNOWN');
 fixture=receipt();await rejects('Absent reviewed version blocks before dispatch',()=>fixture.ctx.financeReceiptAction(fixture.rows,'approve','note',[],{}));check('Absent version caused zero RPC',fixture.calls.length===0);
 fixture=receipt({refreshApprovalAfterCommittedAction:async()=>false});result=await fixture.ctx.financeReceiptAction(fixture.rows,'approve','note',[],{one:2});check('Incomplete authoritative refresh remains committed and pending',result.committed&&result.refreshRequired);
 fixture=receipt({getSb:()=>({rpc:async()=>({error:{code:'42501',message:'denied'}})})});await rejects('Definite server denial propagates as definite failure',()=>fixture.ctx.financeReceiptAction(fixture.rows,'approve','note',[],{one:2}),'42501');
 fixture=receipt({isIdentityBlocked:()=>true});await rejects('Identity lock blocks receipt before network',()=>fixture.ctx.financeReceiptAction(fixture.rows,'approve','note',[],{one:2}));check('Locked receipt causes zero dispatch',fixture.calls.length===0);
 let n=notifications({invoices:{id:'one'}});check('Invoice receipt notification opens receipt detail',await n.ctx.openFinanceNotification('notif')&&n.opened[0][0]==='receipt'&&n.readIds.length===1&&n.runtime.INVS[0].mapped==='invoice');
 check('Notification exact read requires tenant and environment',n.queries[0].filters.tenant_id==='tenant'&&n.queries[0].filters.data_environment==='test');
 n=notifications({invoices:{id:'one'}});n.runtime.NOTIFS[0].type='approval';await n.ctx.openFinanceNotification('notif');check('Invoice approval routes to invoice detail',n.opened[0][0]==='invoice');
 n=notifications({bills:{id:'one'}});n.runtime.NOTIFS[0]={id:'notif',reqId:'one',type:'approval'};await n.ctx.openFinanceNotification('notif');check('Legacy untyped bill resolves from exact source',n.opened[0][0]==='bill'&&n.queries.length===3);
 n=notifications({expense_requests:{id:'one'}});n.runtime.NOTIFS[0].recordType='expense_requests';await n.ctx.openFinanceNotification('notif');check('Expense routes to request detail',n.opened[0][0]==='request');
 n=notifications();check('Unavailable source leaves notification unread',!await n.ctx.openFinanceNotification('notif')&&n.readIds.length===0&&n.opened.length===0);
 n=notifications({invoices:{id:'one'},bills:{id:'one'}});n.runtime.NOTIFS[0]={id:'notif',reqId:'one',type:'approval'};await n.ctx.openFinanceNotification('notif');check('Ambiguous legacy source never guesses or consumes unread',n.readIds.length===0&&n.opened.length===0);
 n=notifications({invoices:{id:'one'}});let identityCalls=0;n.runtime.approvalFastBootstrapIdentity=()=>++identityCalls===1?'old':'new';await n.ctx.openFinanceNotification('notif');check('Account switch during source read does not open old document',n.readIds.length===0&&n.opened.length===0);
 n=notifications({invoices:{id:'one'}},{isIdentityBlocked:()=>true});check('Identity lock blocks notification without consuming unread',!await n.ctx.openFinanceNotification('notif')&&n.queries.length===0&&n.readIds.length===0);
 const start=index.indexOf('function notificationClickAttributes('),end=index.indexOf('\nwindow.markNotifRead=',start),elements={};
 const ctx={S:{nT:'all'},NOTIFS:[{id:`'\"><svg onload=evil()>`,title:'<img src=x onerror=evil()>',body:'<script>evil()</script>',time:'<svg onload=evil()>',type:'receipt'}],lastSyncAt:1,escAttr:v=>String(v||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),el:id=>elements[id]||(elements[id]={style:{}})};ctx.window=ctx;vm.runInNewContext(index.slice(start,end),ctx);ctx.renderNotifs();
 const html=elements['notif-list'].innerHTML;check('Production notification renderer escapes malicious contents and ID',!html.includes('<svg')&&!html.includes('<img')&&!html.includes('<script>')&&html.includes('data-notification-id="&#39;&quot;&gt;'));
 check('Notification handler is constant and keyboard accessible',html.includes('openFinanceNotification(this.dataset.notificationId)')&&html.includes('tabindex="0"'));
 const boundaries=index.slice(index.indexOf('function paidReturnBoundary('),index.indexOf('function paidReturnBoundaryHtml('));const rc={requestCashPostedAt:r=>r.paid,previousReturnableStepIndex:()=>0,activeStepIndex:()=>1,flowIsTerminal:()=>false};vm.runInNewContext(boundaries,rc);
 check('Paid cashier return button is blocked',!rc.canReturnPreviousStep({paid:true,steps:[{rk:'cashier'},{rk:'accountant_final'}]}));
 check('Unpaid cashier and noncash prior gates retain return',rc.canReturnPreviousStep({paid:false,steps:[{rk:'cashier'}]})&&rc.canReturnPreviousStep({paid:true,steps:[{rk:'accountant'}]}));
 check('Legacy CEO disbursement boundary is blocked',!rc.canReturnPreviousStep({paid:true,steps:[{rk:'ceo'},{rk:'accountant_final'}]}));
 const finalSource=index.slice(index.indexOf('window.doConfirmVoucher=async function('),index.indexOf('// ══ FIX 2：',index.indexOf('window.doConfirmVoucher=async function(')));
 const finalCalls={serial:0,upload:0,correction:0,draft:0},finalCtx={REQS:[{id:'expense',amt:100,type:'payment_request'}],POSTING_IN_FLIGHT:{},canActRequest:()=>true,requestPostingLocked:()=>false,requestLedgerRowsExist:()=>false,ensureOpenPostingPeriod:()=>true,todayIso:()=> '2026-09-08',cloneSettingValue:x=>JSON.parse(JSON.stringify(x)),purchaseReadyForFinalAccounting:()=>({ok:true}),pettyReadyForFinalAccounting:()=>({ok:true}),approvalActionPayload:async()=>({}),approvalActionPreflight:()=>true,hasVisibleAccountingInputs:()=>true,collectAccountingLinesFromDom:r=>{r.amt=120;},rememberAccountingReviewDraft:()=>finalCalls.draft++,expensePostingAmount:r=>r.amt,num:Number,startExpenseAccountingCorrection:async(original,work)=>{assert.strictEqual(original.amt,100);assert.strictEqual(work.amt,120);finalCalls.correction++;},nextVoucherNo:()=>{finalCalls.serial++;},uploadApprovalFiles:()=>{finalCalls.upload++;},alert:()=>{}};finalCtx.window=finalCtx;vm.runInNewContext(finalSource,finalCtx);await finalCtx.doConfirmVoucher('expense');
 check('Final amount edit opens independent correction before serial/upload',finalCalls.correction===1&&finalCalls.serial===0&&finalCalls.upload===0&&finalCtx.REQS[0].amt===100&&finalCalls.draft===1);
 finalCtx.approvalActionPayload=async()=>({addUid:'extra-reviewer'});await finalCtx.doConfirmVoucher('expense');check('Countersign cannot bypass paid-principal correction',finalCalls.correction===2&&finalCalls.serial===0&&finalCalls.upload===0);
 const snapshotSource=index.slice(index.indexOf("var RECEIPT_REVIEW_SNAPSHOTS="),index.indexOf('async function receiptGroupActionCore('));
 const sr={approvalFastBootstrapIdentity:()=> 'actor',activeDataEnvironment:()=> 'test',invoiceGroupKey:()=> 'group',invoiceGroupRows:row=>row.rows,receiptTaskCandidate:()=>true,approvalRowVersion:row=>row.rowVersion};vm.runInNewContext(snapshotSource,sr);
 const viewed={rows:[{id:'one',rowVersion:2},{id:'two',rowVersion:3}]};sr.captureReceiptReviewVersions(viewed,'modal');
 sr.captureReceiptReviewVersions({rows:[{id:'one',rowVersion:9},{id:'two',rowVersion:10}]});
 check('Background list render cannot replace reviewed modal versions',sr.receiptReviewedVersions(viewed,viewed.rows).one===2);
 check('Shrinking a batch cannot silently change operator intent',Object.keys(sr.receiptReviewedVersions(viewed,[viewed.rows[0]])).length===0);
 sr.approvalFastBootstrapIdentity=()=> 'other';check('Account switch invalidates receipt review snapshot',Object.keys(sr.receiptReviewedVersions(viewed,viewed.rows)).length===0);
 console.log('PASS: '+count+' actual frontend receipt/notif/paid-return behavior checks');
})().catch(error=>{console.error(error);process.exitCode=1;});
