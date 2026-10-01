#!/usr/bin/env node
'use strict';

const fs=require('fs');
const path=require('path');
const vm=require('vm');
const root=path.resolve(__dirname,'..');
const index=fs.readFileSync(path.join(root,'index.html'),'utf8');
const engine=fs.readFileSync(path.join(root,'assets/engines/workflow-simplification-engine.js'),'utf8');
const mobileEngine=fs.readFileSync(path.join(root,'assets/engines/mobile-ux-engine.js'),'utf8');
const css=fs.readFileSync(path.join(root,'assets/styles/workflow-simplification.css'),'utf8');
let passed=0;
let failed=0;
function check(label,condition,detail){
  if(condition){passed++;console.log('PASS',label);return;}
  failed++;console.error('FAIL',label,detail||'');
}
function count(source,needle){return source.split(needle).length-1;}

check('簡化樣式只載入一次',count(index,'assets/styles/workflow-simplification.css')===1);
check('簡化引擎只載入一次',count(index,'assets/engines/workflow-simplification-engine.js')===1);
check('新層可以停用與重新啟用',/financeWorkflowSimplificationEnable=enable/.test(engine)&&/financeWorkflowSimplificationDisable=disable/.test(engine));
check('新增申請移除重複送出摘要且不改原輸入節點',
  /obsoleteSummary=byId\('workflow-newreq-summary'\)/.test(engine)
  &&/if\(obsoleteSummary\)obsoleteSummary\.remove\(\)/.test(engine)
  &&!/generated\([^\n]*workflow-newreq-summary/.test(engine)
  &&!/cloneNode|replaceWith/.test(engine));
check('九種申請表單仍共用同一滿版簡化層',[
  'expense_reimbursement','payment_request','advance_request','petty_cash_request','travel_request',
  'purchase_request','refund_request','welfare_request','hr_expense_request'
].every(type=>engine.includes(type)));
check('放款申請摘要只讀取目前清單',/function expenseRows\(\)/.test(engine)&&/expenseSnapshot\(rows\)/.test(engine));
check('簽核批次列依勾選狀態改變層級',/workflow-bulk-empty/.test(engine)&&/workflow-bulk-active/.test(engine));
check('主管審核保留既有 action section',/approval-action-section/.test(engine)&&/workflow-detail-action/.test(engine));
check('引擎沒有網路或資料庫寫入',!/\bfetch\s*\(|\.rpc\s*\(|supabase|\.insert\s*\(|\.update\s*\(|\.delete\s*\(/i.test(engine));
check('引擎沒有呼叫既有送件或簽核 handler',!/submitNR\s*\(|apprApprove\s*\(|apprReject\s*\(|apprReturnPrevious\s*\(/.test(engine));
check('桌機新增申請改為單欄滿版且不再保留 310px 摘要側欄',/#nr-main-grid\{[\s\S]*?grid-template-columns:minmax\(0,1fr\)!important;/.test(css)&&!/grid-template-columns:minmax\(0,1fr\) 310px/.test(css));
check('手機 KPI 維持兩欄可讀',/@media \(max-width:760px\)/.test(css)&&/workflow-kpi-strip\{grid-template-columns:repeat\(2/.test(css));
check('專用簽核詳情在桌機也是滿版單欄',
  /#pg-detail #detail-body\{[\s\S]*?grid-template-columns:minmax\(0,1fr\)!important/.test(css)
    && /#pg-detail #detail-body>\.detail-full-row,[\s\S]*?grid-column:1\/-1!important;[\s\S]*?width:100%!important/.test(css));
check('主管審核桌機改為滿版且主管摘要置頂',
  /#m-appr>\.modal\[role="dialog"\]\{\s*width:calc\(100vw - 28px\)!important;\s*max-width:none!important;/.test(css)
    && /#appr-inner\[data-workflow-simplified="approval-detail"\]\{\s*align-items:stretch;\s*display:flex;\s*flex-direction:column;\s*gap:12px;/.test(css)
    && /#appr-inner\[data-workflow-simplified="approval-detail"\]>\*\{\s*flex:0 0 auto;\s*min-width:0;\s*width:100%;/.test(css)
    && />\.workflow-detail-decision\{\s*grid-column:1\/-1;\s*grid-row:auto;\s*position:static;\s*top:auto;/.test(css)
    && /\.supervisor-review-summary\{\s*grid-template-columns:1\.25fr repeat\(3,minmax\(0,1fr\)\)!important;/.test(css)
    && /\.supervisor-review-issues\{\s*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)!important;/.test(css));
check('專用詳情的簽核進度不建立內層捲軸',
  /#pg-detail #detail-body>\.detail-progress-card\{[\s\S]*?max-height:none!important;[\s\S]*?overflow:visible!important/.test(css)
    && /#pg-detail #detail-body \.detail-progress-scroll\{[\s\S]*?max-height:none!important;[\s\S]*?overflow:visible!important/.test(css));
check('手機主管審核維持單欄',/@media \(max-width:900px\)[\s\S]*approval-detail[\s\S]*display:block/.test(css));
check('手機專用詳情的檢核摘要不壓成直排文字',
  /supervisor-review-summary/.test(index)
    && /supervisor-review-summary\.is-full\{[\s\S]*?grid-template-columns:repeat\(2,minmax\(0,1fr\)\)!important/.test(css)
    && /supervisor-review-issues\.is-full\{[\s\S]*?grid-template-columns:minmax\(0,1fr\)!important/.test(css));
check('所有樣式受可逆 root class 限制',count(css,'.workflow-simplification-v1')>=25);

// Exercise the real observer callback: unrelated updates must not schedule a full-table scan.
const animationFrames=[];
let mutationCallback=null;
const rootClasses=new Set();
const documentStub={
  readyState:'complete',
  body:{nodeType:1},
  documentElement:{
    nodeType:1,
    classList:{
      add(name){rootClasses.add(name);},
      remove(name){rootClasses.delete(name);},
      contains(name){return rootClasses.has(name);}
    }
  },
  getElementById(){return null;}
};
const windowStub={};
vm.runInNewContext(engine,{
  document:documentStub,
  window:windowStub,
  requestAnimationFrame(callback){animationFrames.push(callback);},
  MutationObserver:class {
    constructor(callback){mutationCallback=callback;}
    observe(){}
  }
});
check('簡化引擎初次載入排入一次全頁更新',animationFrames.length===1);
animationFrames.shift()();
const outsideNode={nodeType:1,id:'notification-list',closest(){return null;}};
mutationCallback([{target:outsideNode,addedNodes:[]}]);
check('通知等無關 DOM 更新不觸發清單重掃',animationFrames.length===0);
mutationCallback([{target:documentStub.body,addedNodes:[outsideNode]}]);
check('插入到 body 的通知不觸發全頁重掃',animationFrames.length===0);
mutationCallback([{target:documentStub.body,addedNodes:[{nodeType:1,id:'pg-expenses'}]}]);
check('替換工作頁根節點仍觸發更新',animationFrames.length===1);
animationFrames.shift()();
const expenseNode={nodeType:1,id:'exp-tbody',closest(selector){return selector==='#pg-expenses'?this:null;}};
mutationCallback([{target:expenseNode,addedNodes:[]},{target:expenseNode,addedNodes:[]}]);
check('同幀放款清單變動只排一次更新',animationFrames.length===1);
animationFrames.shift()();
windowStub.financeWorkflowSimplificationRefresh();
check('既有手動刷新仍可完整更新',animationFrames.length===1);

const mobileNavSource=mobileEngine.slice(
  mobileEngine.indexOf('var MOBILE_ROLE_PRIMARY_NAV_LIMIT='),
  mobileEngine.indexOf('function primaryIcon(')
);
function mobilePrimaryPages(role,allowed){
  const buttons=allowed.map(page=>({
    getAttribute(name){return name==='onclick'?"nav('"+page+"')":null;},
    hasAttribute(){return false;},
    hidden:false,
    style:{display:''}
  }));
  return vm.runInNewContext('(function(){'+mobileNavSource+'return primaryPages();})()',{
    document:{querySelectorAll(selector){return selector==='#sidebar nav .ni'?buttons:[];}},
    window:{financeCurrentRoleKey(){return role;},S:{user:{role}}}
  });
}
check('執行長手機捷徑優先保留儀表板簽核報表收款',
  JSON.stringify(mobilePrimaryPages('ceo',['dashboard','newreq','approvals','invoices','recv','reports']))
  ===JSON.stringify(['dashboard','approvals','reports','recv']));
check('出納手機捷徑以實際授權頁補滿且不顯示未授權繳費單',
  JSON.stringify(mobilePrimaryPages('cashier',['dashboard','newreq','approvals','recv']))
  ===JSON.stringify(['approvals','recv','dashboard','newreq']));
check('員工手機捷徑優先新增申請與本人清單',
  JSON.stringify(mobilePrimaryPages('employee',['dashboard','newreq','approvals','expenses']))
  ===JSON.stringify(['newreq','approvals','expenses','dashboard']));
check('Membership 職務代碼會轉成對應財務任務捷徑',
  JSON.stringify(mobilePrimaryPages('accounting-chief',['dashboard','approvals','vouchers','reports']))
  ===JSON.stringify(['dashboard','approvals','vouchers','reports']));
check('未知職務只使用已授權頁且不顯示空按鈕',
  JSON.stringify(mobilePrimaryPages('custom-unit',['newreq','reports']))
  ===JSON.stringify(['newreq','reports']));

console.log(`RESULT ${passed} passed, ${failed} failed, ${passed+failed} total`);
if(failed)process.exitCode=1;
