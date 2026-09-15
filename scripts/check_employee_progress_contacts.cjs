'use strict';
const fs=require('fs'),assert=require('node:assert/strict');
const source=fs.readFileSync('index.html','utf8');
function extract(name){const a=source.indexOf('function '+name+'(');assert(a>=0);let n=0;for(let i=source.indexOf('{',a);i<source.length;i++){if(source[i]==='{')n++;else if(source[i]==='}'&&!--n)return source.slice(a,i+1);}throw Error(name);}
const state={aT:'mine'};
const esc=s=>String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
let checks=0;
const same=(actual,expected)=>{assert.deepEqual(actual,expected);checks++;};
const has=(value,pattern)=>{assert.match(value,pattern);checks++;};
const lacks=(value,pattern)=>{assert.doesNotMatch(value,pattern);checks++;};
// Use the actual status, terminal, active-step and group adapters. Only the
// unrelated legacy-repair switch, attachment normalizer and backing row stores
// are fictional; no production transport or permission operation is invoked.
const functions=['flowStatusValue','flowIsTerminal','autoAdvanceDuplicateDeptManagerSteps','activeStep','stepTitle','requestIsRejected','billGroupApprovalRows','invoiceGroupApprovalRows','billApprovalCompleted','billApprovalLabel','invoiceCashPostedAt','invoiceStepApproved','invoiceApplicantDeliveryConfirmed','invoiceAccountantInvoiceCompleted','invoiceHasReceivableActivity','invoiceFlowReleasedToReceivable','invoiceIsReceivable','invApprovalLabel','receiptStatusLabel','employeeApplicationStage','employeeRequestProgressHtml'];
const labelSource=source.match(/^var SL=.+;$/m);assert(labelSource);
const api=new Function('S','escAttr','allowLegacyClientFlowRepair','financeApprovalEngine','normalizeFiles','billGroupRows','invoiceGroupRows',labelSource[0]+'\n'+functions.map(extract).join('\n')+';return {stage:employeeApplicationStage,progress:employeeRequestProgressHtml};')(
  state,esc,()=>false,()=>null,files=>Array.isArray(files)?files:[],row=>row.fixtureRows||[row],row=>row.fixtureRows||[row]
);
const step=(rk,status,r)=>({rk,status,r,a:'',uid:'fictional-owner'});
const pending=(kind,rk='accountant',status='pending_accountant',title='會計審核')=>({kind,raw:{id:'fictional-'+kind,status:kind==='req'?status:'unpaid',...(kind==='req'?{}:{approvalStatus:status}),steps:[step(rk,status,title)]}});
const expectStage=(item,expected)=>{const before=JSON.stringify(item);same(api.stage(item),expected);same(JSON.stringify(item),before);};
for(const tab of ['mine','p','cashier']){
  state.aT=tab;
  for(const kind of ['req','bill','inv','recv']){
    const item=kind==='recv'?{kind,raw:{status:'partial',approvalStatus:'completed',steps:[]}}:pending(kind);
    const html=api.progress(item,{cls:'b-ok',label:'錯誤的代表列標籤'});
    same(html,'<div class="employee-progress"><span class="badge b-ok">'+(kind==='recv'?'部分收款':'待會計')+'</span></div>');
    lacks(html,/<small|查看處理紀錄|目前：|待處理：|等待簽核|錯誤的代表列標籤/);
  }
  same(api.progress({kind:'draft',raw:{}},{cls:'b-gray',label:'暫存'}),'');
}
for(const tab of ['h','drafts','rejected']){state.aT=tab;same(api.progress(pending('req')),'');}
state.aT='mine';
for(const kind of ['req','bill','inv']){
  const revision=pending(kind,'applicant_revision','pending_applicant_confirm','申請人補件後重新送出');
  expectStage(revision,{label:'待申請人補件',cls:'b-ok'});
  for(const [status,label,cls]of [['cancelled','已抽單取消','b-gray'],['rejected','被駁回','b-rej'],['closed','已結案','b-gray'],['voided','已作廢','b-gray']]){
    const stopped=JSON.parse(JSON.stringify(revision));if(kind==='req')stopped.raw.status=status;else stopped.raw.approvalStatus=status;
    expectStage(stopped,{label,cls});
    lacks(api.progress(stopped),/待申請人補件/);
  }
}
expectStage({kind:'req',raw:{status:'completed',steps:[step('applicant_revision','pending_applicant_confirm','補件')]}},{label:'已完成',cls:'b-ok'});
// The current active step, not a former stored pending label, names the stage.
const moved=pending('req','cashier','pending_cashier','出納放款');moved.raw.status='pending_accountant';
expectStage(moved,{label:'待出納放款',cls:'b-ok'});
expectStage(pending('req','accountant_final','pending_voucher','會計入帳'),{label:'待會計入帳',cls:'b-ok'});
expectStage(pending('inv','applicant_invoice_delivery','pending_invoice_delivery','舊標題'),{label:'申請人交付發票確認',cls:'b-ok'});
expectStage({kind:'inv',raw:{approvalStatus:'completed',status:'unpaid',steps:[]}},{label:'待交付確認',cls:'b-ok'});
expectStage({kind:'inv',raw:{approvalStatus:'delivered',status:'unpaid',steps:[]}},{label:'已交付待收款',cls:'b-ok'});
expectStage({kind:'recv',raw:{approvalStatus:'completed',status:'unpaid',steps:[]}},{label:'待會計查帳',cls:'b-ok'});
expectStage({kind:'recv',raw:{approvalStatus:'completed',status:'pending_receipt_review',steps:[]}},{label:'待執行長確認',cls:'b-ok'});
const billDone={id:'bill-first',approvalStatus:'completed',status:'unpaid',steps:[]},billPending=pending('bill').raw;
expectStage({kind:'bill',raw:billDone,rows:[billDone,billPending]},{label:'已核准 1 張／待會計 1 張',cls:'b-ok'});
expectStage({kind:'bill',raw:billDone,rows:[billPending,billDone]},{label:'待會計 1 張／已核准 1 張',cls:'b-ok'});
const invDone={id:'inv-first',approvalStatus:'delivered',status:'unpaid',steps:[]},invPending=pending('inv').raw;
expectStage({kind:'inv',raw:invDone,rows:[invDone,invPending]},{label:'已交付待收款 1 張／待會計 1 張',cls:'b-ok'});
const paid={id:'recv-first',approvalStatus:'completed',status:'paid'},review={id:'recv-next',approvalStatus:'completed',status:'pending_receipt_review'};
expectStage({kind:'recv',raw:paid,rows:[paid,review]},{label:'已收款入帳 1 張／待執行長確認 1 張',cls:'b-ok'});
// Explicit item.rows owns the displayed group; a backing store's extra sibling
// must not contaminate its progress. Fallback remains available when absent.
expectStage({kind:'bill',raw:{...billDone,fixtureRows:[billDone,billPending]},rows:[billPending]},{label:'待會計',cls:'b-ok'});
expectStage({kind:'bill',raw:{...billDone,fixtureRows:[billDone,billPending]}},{label:'已核准 1 張／待會計 1 張',cls:'b-ok'});
expectStage({kind:'inv',raw:{...invDone,fixtureRows:[invDone,invPending]},rows:[invPending]},{label:'待會計',cls:'b-ok'});
expectStage({kind:'recv',raw:{...paid,fixtureRows:[paid,review]},rows:[review]},{label:'待執行長確認',cls:'b-ok'});
expectStage({kind:'bill',raw:billPending,rows:Array.from({length:103},(_,n)=>({...billPending,id:'bill-'+n}))},{label:'待會計',cls:'b-ok'});
expectStage({kind:'bill',raw:billDone,rows:[billDone,{...billPending,approvalStatus:'rejected'}]},{label:'已核准 1 張／被駁回 1 張',cls:'b-rej'});
expectStage({kind:'bill',raw:billDone,rows:[billDone,{...billPending,approvalStatus:'cancelled'}]},{label:'已核准 1 張／已抽單取消 1 張',cls:'b-gray'});
expectStage({kind:'req',raw:{steps:[]}},{label:'待確認流程',cls:'b-gray'});
expectStage({kind:'bill',raw:{steps:[]}},{label:'待確認流程',cls:'b-gray'});
const custom=pending('req','assigned_user','custom_status','<img src=x>');
lacks(api.progress(custom),/<img/);has(api.progress(custom),/&lt;img src=x>/);
lacks(api.progress(pending('req')),/<small|查看處理紀錄|目前：|待處理：/);
const contact=new Function('escAttr',extract('orgContactInfoHtml')+';return orgContactInfoHtml;')(esc);
assert.match(contact({contactEmail:'work@example.invalid',email:'login@example.invalid'},false),/聯絡信箱：work@example.invalid/);
assert.doesNotMatch(contact({contactEmail:'work@example.invalid',email:'login@example.invalid'},false),/login@example.invalid/);
assert.match(contact({contactEmail:'work@example.invalid',email:'login@example.invalid'},true),/登入信箱：login@example.invalid/);
assert.match(contact({email:'login@example.invalid'},false),/聯絡信箱：尚未設定/);
assert.doesNotMatch(contact({contactEmail:'<img src=x>'},false),/<img/);
console.log('PASS '+(checks+5)+' actual stage/group/terminal/contact rendering checks');
