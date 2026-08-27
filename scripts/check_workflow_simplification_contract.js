#!/usr/bin/env node
'use strict';

const fs=require('fs');
const path=require('path');
const root=path.resolve(__dirname,'..');
const index=fs.readFileSync(path.join(root,'index.html'),'utf8');
const engine=fs.readFileSync(path.join(root,'assets/engines/workflow-simplification-engine.js'),'utf8');
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
check('新增申請有摘要且不改原輸入節點',/workflow-newreq-summary/.test(engine)&&!/cloneNode|replaceWith/.test(engine));
check('九種申請表單共用同一摘要層',[
  'expense_reimbursement','payment_request','advance_request','petty_cash_request','travel_request',
  'purchase_request','refund_request','welfare_request','hr_expense_request'
].every(type=>engine.includes(type)));
check('放款申請摘要只讀取目前清單',/function expenseRows\(\)/.test(engine)&&/expenseSnapshot\(rows\)/.test(engine));
check('簽核批次列依勾選狀態改變層級',/workflow-bulk-empty/.test(engine)&&/workflow-bulk-active/.test(engine));
check('主管審核保留既有 action section',/approval-action-section/.test(engine)&&/workflow-detail-action/.test(engine));
check('引擎沒有網路或資料庫寫入',!/\bfetch\s*\(|\.rpc\s*\(|supabase|\.insert\s*\(|\.update\s*\(|\.delete\s*\(/i.test(engine));
check('引擎沒有呼叫既有送件或簽核 handler',!/submitNR\s*\(|apprApprove\s*\(|apprReject\s*\(|apprReturnPrevious\s*\(/.test(engine));
check('桌機新增申請為主內容加摘要側欄',/@media \(min-width:901px\)[\s\S]*grid-template-columns:minmax\(0,1fr\) 310px/.test(css));
check('手機摘要與 KPI 維持兩欄可讀',/@media \(max-width:760px\)/.test(css)&&/workflow-kpi-strip\{grid-template-columns:repeat\(2/.test(css));
check('專用簽核詳情在桌機也是滿版單欄',
  /#pg-detail #detail-body\{[\s\S]*?grid-template-columns:minmax\(0,1fr\)!important/.test(css)
    && /#pg-detail #detail-body>\.detail-full-row,[\s\S]*?grid-column:1\/-1!important;[\s\S]*?width:100%!important/.test(css));
check('主管檢核摘要置頂且不再停靠右側',
  /approval-detail[\s\S]*grid-template-columns:minmax\(0,1fr\);/.test(css)
    && />\.workflow-detail-decision\{[\s\S]*?grid-column:1;[\s\S]*?grid-row:auto;[\s\S]*?position:static;/.test(css));
check('專用詳情的簽核進度不建立內層捲軸',
  /#pg-detail #detail-body>\.detail-progress-card\{[\s\S]*?max-height:none!important;[\s\S]*?overflow:visible!important/.test(css)
    && /#pg-detail #detail-body \.detail-progress-scroll\{[\s\S]*?max-height:none!important;[\s\S]*?overflow:visible!important/.test(css));
check('手機主管審核維持單欄',/@media \(max-width:900px\)[\s\S]*approval-detail[\s\S]*display:block/.test(css));
check('手機專用詳情的檢核摘要不壓成直排文字',
  /supervisor-review-summary/.test(index)
    && /supervisor-review-summary\.is-full\{[\s\S]*?grid-template-columns:repeat\(2,minmax\(0,1fr\)\)!important/.test(css)
    && /supervisor-review-issues\.is-full\{[\s\S]*?grid-template-columns:minmax\(0,1fr\)!important/.test(css));
check('所有樣式受可逆 root class 限制',count(css,'.workflow-simplification-v1')>=25);

console.log(`RESULT ${passed} passed, ${failed} failed, ${passed+failed} total`);
if(failed)process.exitCode=1;
