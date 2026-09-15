'use strict';
// Real source functions; anonymous local reads and DOM peripherals only. Query
// concurrency, complete source membership and render work are asserted directly.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const search=require('../assets/engines/document-search.js');
function fn(name,windowFn=false){let start=html.indexOf(windowFn?'window.'+name+'=':'function '+name+'(');assert(start>=0,name);if(!windowFn&&html.slice(start-6,start)==='async ')start-=6;const eol=html.indexOf('\n',start);return html.slice(start,eol).endsWith(windowFn?'};':'}')?html.slice(start,eol):html.slice(start,html.indexOf(windowFn?'\n};':'\n}',eol)+(windowFn?3:2));}
const clone=x=>JSON.parse(JSON.stringify(x)),delay=ms=>new Promise(r=>setTimeout(r,ms));
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};}
let checks=0;function pass(name){checks++;console.log('PASS '+name);}
function fixture(){
 const c={Date,Promise,Object,Array,String,Number,Math,Set,Map,Error,JSON,console:{warn(){}},setTimeout,clearTimeout,S:{user:{id:'owner-a',email:'a@example.invalid',n:'匿名本人'},demoLogin:false,aT:'p'},REQS:[],INVS:[],BILLS:[],VOUCHERS:[],APPROVAL_HISTORY_MODAL_CONTEXT:null,APPROVAL_FAST_BOOTSTRAP:{summaryItems:[]},queries:[],issues:[],active:0,max:0,nodes:{},window:{FinanceDocumentSearch:search}};
 Object.assign(c,{recordRemoteReadIssue:(label,error)=>c.issues.push({label,error}),approvalFastSummarySourceIds:(items,table)=>items.filter(x=>x.source_table===table).flatMap(x=>x.source_ids),withOperationTimeout:q=>q,
  num:x=>Number(x)||0,normDate:x=>String(x||'').replaceAll('/','-'),normalizeFiles:x=>x||[],invoiceIsReceivable:x=>!!x.receivable,approvalReceiptItemCandidate:x=>!!x.receiptCandidate,
  currentFinanceAuthUserId:()=>c.S.user&&c.S.user.auth||'auth-a',currentTenantId:()=>c.tenant||'tenant-a',activeDataEnvironment:()=>c.env||'production',fmt:n=>String(n),voucherBadgeClass:()=>'',voucherKind:()=> '一般傳票',
  el(id){return c.nodes[id]||(c.nodes[id]={value:'',innerHTML:'',textContent:'',before(){},setAttribute(name,value){this[name]=value;}})}
 });
 c.transport=()=>null;
 c.client={from(table){const q={table,filters:[],select(){return q},in(key,ids){q.ids=ids;return q},eq(key,value){q.filters.push([key,value]);return q},limit(limit){q.limitValue=limit;return q},then(resolve,reject){c.queries.push(q);c.active++;c.max=Math.max(c.max,c.active);let result;try{result=c.transport(q,c);}catch(e){result=Promise.reject(e);}return Promise.resolve(result||{data:(q.ids||[]).map(id=>({id}))}).then(value=>{c.active--;return resolve(value)},error=>{c.active--;return reject(error)});}};return q}};
 vm.createContext(c);
 const names=['remoteRowKey','mergeRemoteRowsByKey','uniqueRemoteStrings','runRemoteJobsWithConcurrency','safeRemoteRows','loadRowsByIdsForApprovalFallback','loadRowsForCurrentApplicant','approvalFallbackSourceIds','approvalFastMergeSummaryIdsIntoFallback','remoteRowsMissingIds','loadRemoteApprovalFallbackData','approvalHistoryItemsFromPayload','approvalHistoryValidatePage','approvalHistoryExactGroupRows','renderApprovalHistorySummaries','invoiceBatchFallbackKey','invoiceGroupKey','invoiceGroupRows','uniqueInvoiceGroups','billCreatedBucket','billGroupKey','billGroupRows','billGroupLeader','uniqueBillGroups','approvalGroupRowsIndex','approvalAllItems','financeDocumentMatchesQuery','voucherListPage','voucherPagerHtml'];
 vm.runInContext(names.map(x=>fn(x)).join('\n'),c);
 return c;
}
async function run(){
 {
  const c=fixture(),pending=[];c.transport=q=>new Promise(resolve=>pending.push({q,resolve}));
  const tasks=['expense_requests','bills','invoices'].map((table,i)=>({source_table:table,source_id:'row-'+i}));
  const result=c.loadRemoteApprovalFallbackData(c.client,{}, {tasks});await delay(0);assert.equal(pending.length,2);assert.equal(c.max,2);assert.deepEqual(pending.map(x=>x.q.table),['expense_requests','bills']);
  pending[0].resolve({data:[{id:'row-0'}]});await delay(0);assert.equal(pending.length,3);assert.equal(pending[2].q.table,'invoices');
  pending[1].resolve({data:[{id:'row-1'}]});pending[2].resolve({data:[{id:'row-2'}]});const out=await result;assert.equal(out.requests.length+out.bills.length+out.invoices.length,3);assert.equal(c.max,2);
  pass('three independent source reads take two waves, with two actual query slots and all three rows preserved');
 }
 {
  const c=fixture();c.transport=q=>delay(1).then(()=>({data:q.ids.map(id=>({id}))}));
  const tasks=['expense_requests','bills','invoices'].flatMap(table=>Array.from({length:85},(_,i)=>({source_table:table,source_id:table+'-'+i})));
  const out=await c.loadRemoteApprovalFallbackData(c.client,{requests:[{id:'cached'}]}, {tasks});assert.equal(c.queries.length,9);assert.equal(c.max,2);assert(c.queries.every(q=>q.ids.length<=40&&q.limitValue===q.ids.length+5));
  assert.equal(out.requests.length,86);assert.equal(out.bills.length,85);assert.equal(out.invoices.length,85);assert.equal(out.requests[0].id,'cached');
  assert.deepEqual(clone(out.bills.map(r=>r.id)),Array.from({length:85},(_,i)=>'bills-'+i));
  pass('nine chunks across three sources share the same two slots and retain every cached/requested row in order');
 }
 {
  const c=fixture();c.transport=q=>delay(1).then(()=>q.ids?{data:q.ids.map(id=>({id}))}:{data:[{id:q.table+'-'+q.filters[0][0]}]});
  const task={source_table:'expense_requests',source_id:'exact'};const work=c.loadRemoteApprovalFallbackData(c.client,{}, {tasks:[task],requestsTimedOut:true,billsTimedOut:true,invoicesTimedOut:true});c.S.user={id:'other',email:'other@example.invalid',n:'另一人'};
  const out=await work;assert.equal(c.max,2);assert.equal(c.queries.filter(q=>!q.ids).length,8);assert(c.queries.filter(q=>!q.ids).every(q=>['owner-a','a@example.invalid','匿名本人'].includes(q.filters[0][1])));assert.equal(out.requests.length,4);assert.equal(out.bills.length,3);assert.equal(out.invoices.length,2);
  pass('legacy applicant fallback shares the budget and uses the captured original owner rather than a changed account');
 }
 for(const failure of ['response','reject']){
  const c=fixture();c.transport=q=>q.table==='bills'?(failure==='response'?{error:Error('read rejected')}:Promise.reject(Error('read rejected'))):{data:q.ids.map(id=>({id}))};
  const tasks=['expense_requests','bills','invoices'].map(table=>({source_table:table,source_id:table}));const out=await c.loadRemoteApprovalFallbackData(c.client,{bills:[{id:'retained'}]}, {tasks});
  assert.equal(out.requests.length,1);assert.equal(out.invoices.length,1);assert.deepEqual(clone(out.bills.map(r=>r.id)),['retained']);assert(c.issues.length);assert.equal(c.active,0);
  pass('failed '+failure+' releases query slots, records the failure and never discards successful sources or manufactures a missing row');
 }
 {
  const c=fixture();const out=await c.loadRemoteApprovalFallbackData(c.client,{requests:[{id:'keep'}]}, {tasks:[]});assert.equal(out.used,false);assert.equal(c.queries.length,0);assert.equal(out.requests[0].id,'keep');
  const huge=await c.loadRowsByIdsForApprovalFallback(c.client,'bills',Array.from({length:2501},(_,i)=>String(i)));assert.equal(huge.approvalLoadComplete,false);assert.equal(c.queries.length,0);
  pass('no unnecessary source read and the existing 2500-ID safety cap remains fail-closed');
 }
 {
  const c=fixture();c.REQS=Array.from({length:5000},(_,i)=>({id:'cached-'+i}));c.INVS=[{id:'old-invoice'}];c.BILLS=[{id:'old-bill'}];
  const before=clone([c.REQS,c.BILLS,c.INVS]);let calls=0;c.mergeRemoteRowsByKey=()=>{calls++;throw Error('summary must not merge document cache')};c.mapReq=c.mapBill=c.mapInv=()=>{throw Error('summary must not map partial documents')};
  const entries=Array.from({length:50},(_,i)=>({record_type:['expense_requests','bills','invoices'][i%3],record_id:'new-'+i,history_key:'h-'+i,summary:{source_count:103,amount:1250,has_attachments:true},personally_acted:i%2===0}));
  const out=c.approvalHistoryItemsFromPayload({items:entries});assert.equal(calls,0);assert.equal(out.length,50);assert(out.every(x=>x.historySummary&&!('raw' in x)&&!('rows' in x)&&x.summary.source_count===103));assert.deepEqual(clone(out.map(x=>x.recordId)),entries.map(x=>x.record_id));assert.deepEqual(clone([c.REQS,c.BILLS,c.INVS]),before);
  pass('fifty summaries preserve complete batch counts and page order with zero source mapping, zero cache scans/merges and all cached documents unchanged');
 }
 {
  const c=fixture();c.REQS=[{id:'keep'}];c.BILLS=[{id:'bill'}];c.INVS=[{id:'invoice'}];const before=clone([c.REQS,c.BILLS,c.INVS]);
  const payload={mode:'summary',total:2,all_total:2,page:{limit:50,offset:0,has_more:false},items:[{kind:'req',record_type:'expense_requests',record_id:'new',history_key:'expense_requests:new',summary:{source_count:1,amount:0,has_attachments:false}},{kind:'bill',record_type:'bills',record_id:'bad',history_key:'bills:bad',summary:{source_count:2,amount:'malformed',has_attachments:false}}]};
  assert.throws(()=>{c.approvalHistoryValidatePage(payload,1,'');c.approvalHistoryItemsFromPayload(payload);},/摘要不完整/);assert.deepEqual(clone([c.REQS,c.BILLS,c.INVS]),before);
  pass('late malformed summary fails real page validation before any partial result or source cache is applied');
 }
 {
  const c=fixture();c.REQS=[{id:'duplicate',value:'old',formPayload:{manualOverride:true},rowVersion:7}];const before=clone(c.REQS);
  const items=c.approvalHistoryItemsFromPayload({items:[{record_type:'expense_requests',record_id:'duplicate',history_key:'first',summary:{description:'first'}},{record_type:'expense_requests',record_id:'duplicate',history_key:'last',summary:{description:'last'}}]});assert.deepEqual(clone(c.REQS),before);assert.deepEqual(clone(items.map(x=>x.summary.description)),['first','last']);assert(items.every(x=>!('raw' in x)));
  pass('overlapping summary record IDs never replace authoritative document values, manual accounting or content versions');
 }
 {
  const c=fixture();c.REQS=[{id:'r'}];c.INVS=[{id:'i1',batchId:'b',steps:[]},{id:'i2',batchId:'b',receivable:true,receiptCandidate:true,steps:[{a:'approved'}]},{id:'solo',receivable:true,receiptCandidate:true,steps:[]}];
  c.BILLS=[{id:'late',batchId:'batch',createdAt:'2026-09-13T02:00:00Z',steps:[{}]},{id:'leader',batchId:'batch',createdAt:'2026-09-13T01:00:00Z',steps:[]},{id:'solo',steps:[{}]}];
  const legacy=()=>c.REQS.map(raw=>({kind:'req',raw})).concat(c.uniqueInvoiceGroups(c.INVS,i=>!c.invoiceIsReceivable(i)||(i.steps||[]).some(s=>s.a)).map(raw=>({kind:'inv',raw,rows:c.invoiceGroupRows(raw)})),c.uniqueInvoiceGroups(c.INVS,i=>c.approvalReceiptItemCandidate(i)).map(raw=>({kind:'recv',raw,rows:c.invoiceGroupRows(raw)})),c.uniqueBillGroups(c.BILLS,b=>(b.steps||[]).length).map(raw=>({kind:'bill',raw,rows:c.billGroupRows(raw)})));
  assert.deepEqual(clone(c.approvalAllItems()),clone(legacy()));const first=c.approvalAllItems();c.BILLS[0].batchId='changed';c.INVS.push({id:'new-batch-member',batchId:'b',steps:[]});assert.deepEqual(clone(c.approvalAllItems()),clone(legacy()));assert.equal(first.find(x=>x.kind==='inv').rows.length,2);
  pass('render-local indexing preserves invoice/receipt/bill leaders and membership, and immediately reflects in-place mutations without stale cache');
 }
 {
  const c=fixture();c.BILLS=Array.from({length:2500},(_,i)=>({id:'b'+i,createdAt:'2026-09-13T01:00:00Z',applicantId:'a',eid:'E',dc:'D',note:'group-'+i,steps:[{}]}));let keyCalls=0;const key=c.billGroupKey;c.billGroupKey=b=>{keyCalls++;return key(b)};
  const start=performance.now(),items=c.approvalAllItems();assert.equal(items.length,2500);assert(keyCalls<=10000);pass('2500 bill groups use linear key work ('+keyCalls+' keys; '+(performance.now()-start).toFixed(1)+'ms), not repeated full-array scans');
 }
 for(const status of ['ready','loading','error']){
  const c=fixture(),items=status==='ready'?[{kind:'req',historySummary:true,historyKey:'history',recordId:'history',recordNo:'HISTORY-001',summary:{source_count:1,amount:0,has_attachments:false}}]:[];c.S.aT='h';let rendered=null;
  const render=c.renderApprovalHistorySummaries;
  Object.assign(c,{document:{createElement:()=>({})},RL:{employee:'員工'},setApprovalTabVisual(){},canReviseAccountingDetails:()=>false,currentRoleKey:()=> 'employee',loadDrafts(){throw Error('unrelated draft scan')},expenseRevisionRecoveryHtml:()=>'',approvalFastShouldHoldSkeleton:()=>false,approvalHistoryRuntimeForCurrentUser:()=>({status,items,total:items.length,allTotal:1,page:1,updatedAt:status==='ready'?'verified':''}),approvalHistoryStatusHtml:()=>status,renderApprovalHistorySummaries:runtime=>{rendered=runtime.items;render(runtime)},approvalAllItems:()=>{throw Error('unrelated full worklist traversal')},escAttr:x=>String(x||''),approvalShortDate:x=>x||'—',draftTime:x=>x,approvalTableHeaderHtml:()=>'<thead><tr><th>明細</th></tr></thead>',approvalPagerHtml:()=>'',syncApprovalWaitTimer(){}});
  vm.runInContext(fn('buildApprovals'),c);c.buildApprovals();assert.equal(rendered,items);assert.equal(c.nodes['history-appr-cnt'].textContent,status==='ready'?'1':'—');assert.equal(c.nodes['approval-bulk-slot'].innerHTML,'');assert.equal(c.nodes['appr-list']['data-history-status'],status);if(status==='ready')assert(c.nodes['appr-list'].innerHTML.includes('HISTORY-001'));if(status==='error')assert(c.nodes['appr-list'].innerHTML.includes('不能當成 0 筆'));
  pass('actual history '+status+' renderer bypasses unrelated lists while preserving unknown counts and read-only summary page');
 }
 {
  const c=fixture(),rows=Array.from({length:123},(_,i)=>({id:'v'+i,no:'ANON-'+i,date:i%2?'2026/04/01':'2026/05/01',eid:i%2?'B':'A',desc:'虛構傳票',total:i+1,entries:[{amt:i===122?1250.25:i+1}]}));const original=clone(rows);let ids=[];
  for(let page=1;page<=3;page++){const result=c.voucherListPage(rows,{page});assert.equal(result.total,123);assert.equal(result.pages,3);assert(result.rows.length<=50);ids.push(...result.rows.map(r=>r.id))}
  assert.deepEqual(ids,rows.map(r=>r.id));assert.deepEqual(rows,original);assert.equal(c.voucherListPage(rows,{page:999}).page,3);assert.equal(c.voucherListPage([],{}).total,0);
  assert.equal(c.voucherListPage(rows,{query:'1,250.25'}).rows[0].id,'v122');assert.equal(c.voucherListPage(rows,{entity:'B',month:'04'}).total,61);assert.equal(c.voucherListPage(rows,{page:Infinity}).page,1);
  pass('voucher pages preserve source order and all 123 records; full-data amount/entity/month search reaches records beyond page one');
 }
 {
  const c=fixture();c.VOUCHERS=Array.from({length:102},(_,i)=>({id:'v'+i,no:'N'+i,date:'2026/05/01',eid:'A',total:i+1,entries:[],posted:true}));
  vm.runInContext(fn('renderVouchers',true)+'\n'+fn('setVoucherPage',true),c);c.renderVouchers=c.window.renderVouchers;
  c.renderVouchers();assert.equal((c.nodes['voucher-list'].innerHTML.match(/class="voucher-card /g)||[]).length,50);c.window.setVoucherPage(3);assert.equal(c.S.voucherPage,3);assert.equal((c.nodes['voucher-list'].innerHTML.match(/class="voucher-card /g)||[]).length,2);
  c.nodes['v-q'].value='N100';c.renderVouchers();assert.equal(c.S.voucherPage,1);assert(c.nodes['voucher-list'].innerHTML.includes('N100'));assert(c.nodes['voucher-list'].innerHTML.includes('已載入符合 1 筆'));
  c.nodes['v-q'].value='';c.renderVouchers();c.window.setVoucherPage(3);c.S.user.auth='auth-b';c.renderVouchers();assert.equal(c.S.voucherPage,1);assert.equal(c.VOUCHERS.length,102);
  pass('actual voucher renderer limits DOM to 50, resets page on search/scope changes and retains full data for detail/export');
 }
 console.log('OK: '+checks+' approval/list performance checks');
}
run().catch(error=>{console.error(error);process.exitCode=1});
