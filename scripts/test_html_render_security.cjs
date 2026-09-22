const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
function between(start,end){const a=source.indexOf(start);assert.ok(a>=0,start);const b=source.indexOf(end,a+start.length);assert.ok(b>a,end);return source.slice(a,b);}
const nodes={};const context={loadExpenseRevisionPending:()=>null,loadExpensePostingPending:()=>null,window:{},S:{page:'list',user:null},REQS:[],SCSS:{completed:'done'},SL:{completed:'完成'},TCSS:{payment_request:'type'},el:id=>nodes[id]||(nodes[id]={innerHTML:''}),normalizeFileMeta:f=>f,fileExt:()=>'',normalizeRequestTerminalState(){},ensureRequestCashierStep(){},nav(){},gD:()=>({n:'單位'}),gE:()=>({s:'公司'}),activeStep:()=>null,isRestrictedReturnedMiddleStep:()=>false,approvalActionFields:()=>'',approvalApplicantIds:()=>[],canActRequest:()=>false,canWithdrawRequest:()=>false,requestBankFeeAmount:()=>0,isMegaBankRecipient:()=>false,requestFeeBearer:()=>'',fmt:String,approvalTimelineWithRuntimeLogs:()=>({html:'',slotId:''}),expenseInvoiceReviewHtml:()=>'',accountingLinesTitleForRequest:()=>'',shouldShowRequestAccountingLines:()=>false,isFinance:()=>true,entityDeptEditorHtml:()=>'',purchaseAmountCompareHtml:()=>'',advanceTwoEventHtml:()=>'',pettyAccountingHtml:()=>'',approvalTimelineRows:()=>[],approvalTimelineProgressText:()=>'',hydrateApprovalRuntimeLogsForRecord(){},paidReturnBoundaryHtml:()=>''};
vm.createContext(context);
vm.runInContext(between('function requestCashPostedAt(', 'function ledgerPostingKey('),context);
vm.runInContext(between('function escAttr(', 'function normalizeFileMeta('),context);
vm.runInContext(between('function fileChipDownloadHtml(', 'var STEP_DOWNLOADS='),context);
vm.runInContext(between('function expenseRevisionRecoveryHtml(', 'function expenseRevisionReplyMatches('),context);
vm.runInContext(between('function expensePostingRecoveryHtml(', 'function expensePostingResultValid('),context);
vm.runInContext(between('window.openDetail=function(', 'window.doApprove='),context);
const attack='<img src=x onerror="globalThis.injected=true">';
context.REQS.push({id:'r1',type:'payment_request',status:'completed',amt:100,files:[],steps:[],no:'R1',dc:'D1',eid:'E1',desc:attack,app:attack,payee:attack,bankName:attack,bankBranch:attack,bankNo:attack,bankAcc:attack,expectedPayDate:attack,date:attack,drN:attack,crN:attack});
context.window.openDetail('r1');
for(const id of ['detail-hd','detail-body']){assert.ok(!nodes[id].innerHTML.includes('<img'),id);assert.ok(nodes[id].innerHTML.includes('&lt;img'),id);}
context.REQS[0].status='pending_voucher';
context.window.openDetail('r1');
assert.ok(!nodes['detail-body'].innerHTML.includes('<img'),'pending accounting subjects remain escaped');
assert.ok(nodes['detail-body'].innerHTML.includes('&lt;img'),'pending detail still renders escaped data');
const maliciousId="x');globalThis.injected=true;//";
const chip=context.fileChipDownloadHtml({n:attack,t:attack,path:'safe'},maliciousId,2);
assert.ok(!chip.includes('<img'));assert.ok(chip.includes('&lt;img'));
const handler=chip.match(/onclick="([^"]+)"/)[1].replace(/&quot;/g,'"').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
let downloaded;vm.runInNewContext(handler,{event:{stopPropagation(){}},downloadAttachment:(id,index)=>downloaded={id,index}});
assert.deepEqual(downloaded,{id:maliciousId,index:2});
context.loadExpensePostingPending=()=>({args:{p_voucher_id:'fixture'}});
const recovery=context.expensePostingRecoveryHtml({id:maliciousId});
const recoveryHandler=recovery.match(/onclick="([^"]+)"/)[1].replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
let retried;const recoveryContext={doConfirmVoucher:id=>{retried=id;}};vm.runInNewContext(recoveryHandler,recoveryContext);
assert.equal(retried,maliciousId);assert.equal(recoveryContext.injected,undefined,'recovery action cannot execute an injected request ID');
assert.ok(!source.includes("'+r.desc+'"));
console.log('PASS actual request detail and attachment rendering: description, applicant, bank details, filenames, extension and JavaScript argument injection');
// Voucher text originates from employee descriptions and imported accounting
// labels. It must remain text in both the work list and detail dialog.
Object.assign(context,{VOUCHERS:[{id:maliciousId,no:attack,date:attack,desc:attack,creator:attack,entS:attack,eid:'E1',posted:true,entries:[{t:'dr',ac:attack,an:attack,amt:1}],total:1}],ENTS:[{id:'E1',s:attack}],currentFinanceAuthUserId:()=> 'fixture-auth',currentTenantId:()=> 'fixture-tenant',activeDataEnvironment:()=> 'production',voucherBadgeClass:()=> 'b-ok',voucherKind:()=> '付款傳票',document:{getElementById:id=>{const n=context.el(id);n.style=n.style||{};return n;}},requestPrimaryFilesHtml:()=>'',refreshSearchableSelect(){}});
context.window.FinanceDocumentSearch=require('../assets/engines/document-search.js');
vm.runInContext(between('function financeDocumentMatchesQuery(', 'function requestSearchAmounts('),context);
vm.runInContext(between('function voucherMonthKey(', 'window.setVoucherPage='),context);
vm.runInContext(between('window.renderVouchers=function(', 'function reportVoucherRows('),context);
context.window.renderVouchers();
assert.ok(!nodes['voucher-list'].innerHTML.includes('<img'),'voucher list cannot create stored HTML');assert.ok(nodes['voucher-list'].innerHTML.includes('&lt;img'),'voucher list keeps literal text');
const voucherHandler=nodes['voucher-list'].innerHTML.match(/onclick="([^"]+)"/)[1].replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
let selected;const voucherClickContext={showVoucherById:id=>{selected=id;}};vm.runInNewContext(voucherHandler,voucherClickContext);assert.equal(selected,maliciousId);assert.equal(voucherClickContext.injected,undefined);
context.window.showVoucherById(maliciousId);assert.ok(!nodes['m-voucher-body'].innerHTML.includes('<img'));assert.ok(nodes['m-voucher-body'].innerHTML.includes('&lt;img'));
console.log('PASS actual voucher list/detail: stored HTML stays literal and quoted IDs cannot inject click actions');
