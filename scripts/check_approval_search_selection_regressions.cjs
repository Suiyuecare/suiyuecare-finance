'use strict';
// Execute the production functions against synthetic authorized rows. No remote
// transport, real employee identity, or business mutations are used.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const search=require('../assets/engines/document-search.js');
let checks=0;
function check(name,run){run();checks++;console.log('PASS '+name);}
function fn(name){const start=html.indexOf('function '+name+'(');assert(start>=0,name);const end=html.indexOf('\n}',start);assert(end>start,name);return html.slice(start,end+2);}
function handler(name){const start=html.indexOf('window.'+name+'=function(');assert(start>=0,name);const end=html.indexOf('\n};',start);return html.slice(start,end+3);}
function fixture(){
  const nodes={};
  const c={window:{FinanceDocumentSearch:search},console,APPROVAL_SEARCH_COMPOSING:false,
    S:{aT:'p',apprPage:1,apprQuery:'',apprSelected:{},apprItemMap:{},user:{id:'fixture'}},
    frozen:{},cleared:[],paint:0,alerts:[],INVS:[],BILLS:[],
    el:id=>nodes[id]||(nodes[id]={innerHTML:'',textContent:'',value:''}),
    document:{activeElement:null,querySelectorAll:()=>[],querySelector:()=>null},
    alert(message){c.alerts.push(message);},
    escAttr:value=>String(value==null?'':value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'),
    gD:code=>({c:code,n:'合成部門'}),gE:()=>({s:'合成法人',full:'合成法人'}),
    financeApprovalEngine:()=>null,
    billGroupRows:row=>[row],invoiceGroupRows:row=>[row],
    approvalRowAmount:item=>item.amount==null?Number(item.raw.amt||0):item.amount,
    requestReviewAmount:row=>Number(row.actualAmt||row.amt||0),
    approvalRowDept:item=>({code:item.raw.dc||'D1',name:'合成部門'}),
    approvalRowType:()=>({label:'申請單',cls:'b-blue'}),
    approvalRowStatus:()=>({label:'待處理',cls:'b-wait'}),
    approvalRowApplicant:item=>item.raw.app||item.raw.applicant||'合成員工',
    approvalRowFormNo:item=>item.raw.no,
    approvalRowApplyDate:()=> '2026/09/27',approvalRowExpectedPayDate:()=> '2026/09/28',
    approvalSortState:()=>({field:'formNo',dir:'asc'}),approvalSortValue:item=>item.raw.no,
    approvalFreezeBulkExpectedSteps(key,item){c.frozen[key]={id:item.raw.id};return true;},
    approvalClearBulkExpectedSteps(key){c.cleared.push(key||'*');if(key)delete c.frozen[key];else c.frozen={};},
    buildApprovals(){c.paint++;c.renderApprList(c.data||[]);},
    approvalDataLoadWarningHtml:()=>'',syncApprovalWaitTimer(){},
    approvalItemAvailability:()=>({ok:true}),approvalItemActionRows:item=>[item.raw],
    approvalItemRejected:()=>false,stepBelongsToUser:()=>false,activeStep:()=>({rk:'ceo'}),
    supervisorReviewIssues:()=>[],employeeRequestProgressHtml:()=>'',
    canWithdrawRequest:()=>false,approvalWaitCellHtml:()=>'',
    approvalTableHeaderHtml:()=>'<thead><tr><th>表單編號</th></tr></thead>',
    approvalShortDate:value=>value,fmt:value=>String(value),
    invoiceGroupKey:row=>'inv:'+row.id,billGroupKey:row=>'bill:'+row.id,
    billGroupCount:()=>1,invoiceGroupCount:()=>1,requestTypeLabel:()=> '申請單',draftTime:()=> '今天',
    billGroupItemSummary:row=>row.item||'',billGroupPayerSummary:row=>row.payer||'',
    requestIsRejected:()=>false,fromIsoDate:value=>value,
  };
  vm.createContext(c);
  for(const name of ['requestPurposeText','requestNoteText','fullWidthSlice','expenseRequestSummary','approvalRowSummary',
    'billGroupApprovalRows','invoiceGroupApprovalRows','financeDocumentMatchesQuery','requestSearchAmounts',
    'approvalSearchRowText','approvalSearchText','approvalMatchesQuery','approvalApplySearchSort',
    'approvalItemKey','selectedApprovalItems','approvalBulkBarHtml','refreshApprovalBulkCount',
    'resetApprovalPageSelection','reconcileApprovalPageSelection','approvalPagerHtml','syncApprovalSearchClear','renderApprList'])vm.runInContext(fn(name),c);
  for(const name of ['toggleApprovalSelection','toggleAllApprovalSelection','apprSearch','apprSort','apprPage'])vm.runInContext(handler(name),c);
  return c;
}
function row(id,description,amount=10){return{id,no:'REQ-'+String(id).padStart(3,'0'),desc:description,amt:amount,app:'合成員工',dc:'D1',eid:'E1',steps:[]};}
const c=fixture();
for(const kind of ['req','inv','recv','bill','draft'])for(const text of ['A&B 訂閱','「引號」 "報支"','<原件> > 付款'])check(kind+' searches original special characters',()=>{
  const r={...row(kind,text),title:text,item:text,buyer:text};
  assert.equal(c.approvalMatchesQuery({kind,raw:r},text),true);
});
check('Rendered summaries continue escaping HTML and do not execute description markup',()=>{
  const r=row('unsafe','<img src=x onerror="throw 1"> A&B');
  const summary=c.approvalRowSummary({kind:'req',raw:r});assert(!summary.includes('<img'));assert(summary.includes('&lt;img'));assert(summary.includes('&amp;'));
  assert.equal(c.approvalMatchesQuery({kind:'req',raw:r},'<img'),true);
});
check('Full purpose and notes remain searchable beyond the shortened display summary',()=>{
  const r={...row('long','短摘要'),formPayload:{requestPurpose:'長'.repeat(40)+'後段用途',requestNote:'備註 A&B'}};
  assert(!c.approvalRowSummary({kind:'req',raw:r}).includes('後段用途'));
  assert(c.approvalMatchesQuery({kind:'req',raw:r},'後段用途'));assert(c.approvalMatchesQuery({kind:'req',raw:r},'備註 A&B'));
});
for(const kind of ['inv','recv','bill'])check(kind+' indexes every authorized batch member without duplicates or outside siblings',()=>{
  const first={...row('one','第一張',700),buyer:'客戶甲',item:'第一項'},second={...row('two','第二張描述 A&B',550),buyer:'客戶乙',payer:'繳費人乙',item:'第二項',contractNo:'CONTRACT-B'};
  const outside={...row('outside','未授權描述',99999),buyer:'未授權客戶',batchId:'shared'};
  c.INVS=[first,second,outside];c.BILLS=[first,second,outside];
  // A resolver must not be consulted when the worklist supplies its allowed rows.
  c.billGroupRows=()=>{throw Error('unauthorized sibling lookup');};c.invoiceGroupRows=c.billGroupRows;
  const item={kind,raw:first,rows:[first,second],amount:1250};
  for(const query of ['第二張描述','客戶乙','REQ-two','CONTRACT-B','A&B','550.00','NT$1,250'])assert(c.approvalMatchesQuery(item,query),query);
  assert(!c.approvalMatchesQuery(item,'未授權描述'));assert(!c.approvalMatchesQuery(item,'99999.00'));
  c.S.apprQuery='第二張描述';assert.equal(c.approvalApplySearchSort([item]).length,1);assert.equal(item.amount,1250);
});
for(const tab of ['p','cashier'])check(tab+' keeps displayed selection equal to executable current-page IDs',()=>{
  const f=fixture();f.S.aT=tab;f.data=Array.from({length:51},(_,index)=>({kind:'req',raw:row(index+1,'測試單據')}));
  f.buildApprovals();f.window.toggleApprovalSelection('req:1',true);
  assert.equal(f.el('appr-bulk-count').textContent,'已選 1 筆');assert.equal(f.selectedApprovalItems()[0].raw.id,1);
  f.window.apprPage(2);assert.equal(f.el('appr-bulk-count').textContent,'已選 0 筆');assert.equal(Object.keys(f.frozen).length,0);
  f.window.toggleApprovalSelection('req:51',true);
  assert.equal(f.selectedApprovalItems().length,1);assert.equal(f.selectedApprovalItems()[0].raw.id,51);
  assert.equal(f.el('appr-bulk-count').textContent,'已選 1 筆');assert.match(f.approvalBulkBarHtml(f.data),/已選 1 筆/);
  f.window.apprPage(1);assert.equal(f.selectedApprovalItems().length,0);assert.equal(f.el('appr-bulk-count').textContent,'已選 0 筆');
});
for(const change of ['search','sort','empty refresh'])check(change+' clears hidden selections and frozen versions before bulk execution',()=>{
  const f=fixture();f.data=[{kind:'req',raw:row('a','第一張')},{kind:'req',raw:row('b','第二張')}];f.buildApprovals();f.window.toggleAllApprovalSelection(true);
  assert.equal(f.selectedApprovalItems().length,2);
  if(change==='search')f.window.apprSearch('第二張');
  if(change==='sort')f.window.apprSort('amount');
  if(change==='empty refresh'){f.data=[];f.buildApprovals();}
  assert.equal(f.selectedApprovalItems().length,0);assert.equal(Object.keys(f.S.apprSelected).length,0);assert.equal(Object.keys(f.frozen).length,0);assert.equal(f.el('appr-bulk-count').textContent,'已選 0 筆');
});
check('Same-page refresh retains visible choices and removes disappeared rows',()=>{
  const f=fixture();f.data=[{kind:'req',raw:row('a','第一張')},{kind:'req',raw:row('b','第二張')}];f.buildApprovals();f.window.toggleAllApprovalSelection(true);
  f.data=f.data.slice(1);f.buildApprovals();assert.equal(f.selectedApprovalItems().length,1);assert.equal(f.selectedApprovalItems()[0].raw.id,'b');assert.deepEqual(Object.keys(f.S.apprSelected),['req:b']);assert.equal(f.el('appr-bulk-count').textContent,'已選 1 筆');assert(!f.frozen['req:a']);assert(f.frozen['req:b']);
});
check('Same-page authorization or availability loss removes the old choice and frozen version',()=>{
  for(const unavailable of ['read','action']){
    const f=fixture();f.data=[{kind:'req',raw:row('a','第一張')}];f.buildApprovals();f.window.toggleAllApprovalSelection(true);
    if(unavailable==='read')f.approvalItemAvailability=()=>({ok:false});
    else f.approvalItemActionRows=()=>[];
    f.reconcileApprovalPageSelection(f.data);assert.equal(f.selectedApprovalItems().length,0);assert.equal(Object.keys(f.frozen).length,0);assert.equal(f.el('appr-bulk-count').textContent,'已選 0 筆');
  }
});
console.log(JSON.stringify({ok:true,checks,scope:'Real production functions with fictional authorized records and DOM stubs; no live identities or writes.'}));
