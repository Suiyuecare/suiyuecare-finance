'use strict';
// Browser checks serve a transient offline build with test hooks. Hooks are
// injected only in this server response; no production source exposes them.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const assert=require('node:assert/strict');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const {applyBuildEnvironment}=require('./finance_build_environment');
const run=promisify(execFile),root=path.resolve(__dirname,'..');
const session='finance-approval-runtime-'+process.pid;
let html=applyBuildEnvironment(fs.readFileSync(path.join(root,'index.html'),'utf8'),{target:'local',supabaseUrl:'',supabaseAnonKey:''});
html=html.replace('bootAuthGate();\n\n})();',`window.__financeApprovalTest={run:async function(code){return await eval(code);}};\nbootAuthGate();\n\n})();`);
assert.ok(html.includes('window.__financeApprovalTest='));
// This UI fixture is completely offline; optional export/Auth CDN libraries are not needed.
html=html.replace(/<script\b[^>]*src=["']https?:[^>]*><\/script>/gi,'');
const server=http.createServer((req,res)=>{
  const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);
  if(!file.startsWith(root+path.sep)&&file!==root){res.writeHead(403);res.end();return;}
  if(file===root||file===path.join(root,'index.html')){res.setHeader('content-type','text/html');res.end(html);return;}
  if(!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}
  res.setHeader('content-type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'application/octet-stream');res.end(fs.readFileSync(file));
});
async function browser(...args){return (await run('agent-browser',['--session',session,...args],{maxBuffer:8*1024*1024})).stdout;}
async function scoped(code){
  const expression='(async()=>JSON.stringify(await window.__financeApprovalTest.run('+JSON.stringify(code)+')))()';
  const raw=await browser('eval','--base64',Buffer.from(expression).toString('base64'));
  let parsed=JSON.parse(raw);if(typeof parsed==='string')parsed=JSON.parse(parsed);return parsed;
}
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 await browser('open','http://127.0.0.1:'+server.address().port+'/');await browser('wait','--load','networkidle');
 assert.equal((await browser('errors')).trim(),'','actual shipped engines initialize without script errors');
 const facade=await scoped(`(function(){return {facade:!!window.FinanceApprovalRuntime,methods:['financeReceiptAction','openExpenseAccountingCorrections','openFinanceNotification'].every(function(k){return typeof window[k]==='function';}),unexported:['currentTenantId','getSb','REQS','INVS','NOTIFS','mapInv'].every(function(k){return window[k]===undefined;})};})()`);
 assert.deepEqual(facade,{facade:true,methods:true,unexported:true});
 await scoped(`(async()=>{
   window.__fixtureNetwork=[];window.fetch=function(input){window.__fixtureNetwork.push(String(input));return Promise.reject(new Error('Unexpected network in offline fixture'));};
   quickLogin('accountant');S.user.n='匿名會計';S.user.email='fixture@example.invalid';S.user.authUserId='10000000-0000-0000-0000-000000000099';await new Promise(function(resolve){requestAnimationFrame(resolve);});
   REQS=[mapReq({id:'ui-expense-fixture',no:'UI-EXP-001',type:'expense_reimbursement',entity_id:S.user.eid,department_code:S.user.dc,applicant:'匿名申請人',applicant_id:'anonymous-employee',amount:1050,description:'匿名畫面驗收費用',status:'pending',step:3,ver:1,form_payload:{accountingCorrection:{status:'pending_review'}},steps:[{rk:'applicant_submit',uid:'anonymous-employee',n:'匿名申請人',a:'approved'},{rk:'cashier',uid:'anonymous-cashier',n:'匿名出納',a:'approved'},{rk:'accountant_final',uid:S.user.id,n:'匿名會計',a:''}],cash_posted_at:'2026-09-07T00:00:00Z',data_environment:'test',tenant_id:currentTenantId()})];
   INVS=[mapInv({id:'ui-invoice-fixture',no:'UI-INV-001',entity_id:S.user.eid,department_code:S.user.dc,buyer:'匿名買受人',amount:1000,tax:50,total:1050,status:'pending_receipt_review',approval_status:'completed',row_version:1,steps:[],receipt_files:[],data_environment:'test',tenant_id:currentTenantId()})];
   window.__fixtureRpc=[];window.__fixtureUpdates=[];
   window.__fixtureRead={ok:true,reviewers:[{id:'reviewer-anonymous',name:'匿名獨立覆核主管'}],rows:[{id:'correction-fixture',requestId:'ui-expense-fixture',requestNo:'UI-EXP-001',status:'pending_review',originalAmount:1050,proposedAmount:1100,proposerId:S.user.id,reviewerId:'reviewer-anonymous',cashierId:'cashier-anonymous',reason:'匿名驗收金額更正',version:1,canReview:false,canSettle:false,canCancel:true,patch:{accounting_lines:[{description:'匿名明細',netAmount:1050,taxAmount:50,grossAmount:1100,debitAccount:'6200',creditAccount:'1112'}]},history:[]}]};
   getSb=function(){return {rpc:async function(name,args){window.__fixtureRpc.push({name:name,args:args});if(name==='finance_expense_correction_read_v1')return {data:window.__fixtureRead};if(name==='finance_invoice_receipt_action_v1')return {data:{ok:true,count:1}};return {data:[]};}};};
   dbUpdate=async function(table,id,patch){window.__fixtureUpdates.push({table:table,id:id,patch:patch});return {ok:true};};
   openDetail('ui-expense-fixture');
 })()`);
 await browser('set','viewport','390','844');await browser('wait','100');
 assert.equal(await scoped("document.documentElement.scrollWidth>innerWidth"),false,'390px detail stays within viewport');
 await browser('screenshot','/tmp/finance-approval-detail-390.png');
 await scoped("S.demoLogin=false;hasSupabase=function(){return true;};");
 await browser('eval',"document.querySelector('[data-correction-request]').click()");await browser('wait','100');
 const correction=await scoped(`(function(){var d=document.querySelector('dialog[data-finance-approval-dialog]');return {open:!!(d&&d.open),content:d&&d.textContent.includes('匿名驗收金額更正'),viewport:!d||d.getBoundingClientRect().right<=innerWidth,overflow:document.documentElement.scrollWidth>innerWidth,feedback:d&&d.querySelector('[data-feedback]').textContent,touchTargets:d&&Array.from(d.querySelectorAll('button')).every(function(b){return b.getBoundingClientRect().height>=44;})};})()`);
 assert.deepEqual(correction,{open:true,content:true,viewport:true,overflow:false,feedback:'',touchTargets:true});
 await browser('screenshot','/tmp/finance-approval-correction-390.png');
 await browser('eval',"document.querySelector('dialog [data-close]').click()");
 // Real typed notification renderer/click, real closure array reassignment and detail opener.
 await scoped(`(async()=>{S.demoLogin=true;hasSupabase=function(){return false;};NOTIFS=[{id:'ui-receipt-notif',reqId:'ui-invoice-fixture',recordType:'invoices',type:'receipt',title:'匿名收款待辦',body:'檢查收款原單跳轉',read:false,time:'剛剛'}];await guardedNav('notif',null);renderNotifs();})()`);
 await browser('screenshot','/tmp/finance-approval-notification-390.png');
 await browser('eval',"document.querySelector('#notif-list [data-notification-id]').click()");await browser('wait','100');
 const notification=await scoped(`(function(){return {receipt:el('appr-inner').textContent.includes('收款待辦'),buyer:el('appr-inner').textContent.includes('匿名買受人'),modal:el('m-appr').style.display,read:NOTIFS[0].read,sameRows:FinanceApprovalRuntime.INVS===INVS,overflow:document.documentElement.scrollWidth>innerWidth};})()`);
 assert.deepEqual(notification,{receipt:true,buyer:true,modal:'flex',read:true,sameRows:true,overflow:false});
 await browser('screenshot','/tmp/finance-approval-receipt-390.png');
 await scoped("closeAppr();");
 const receipt=await scoped(`(async()=>{S.demoLogin=false;hasSupabase=function(){return true;};ensureSupabaseWriteReady=async function(){return {ok:true};};reloadInvoicesByIds=async function(){return true;};refreshApprovalAfterCommittedAction=async function(){return true;};var before=JSON.stringify(INVS);var result=await financeReceiptAction([INVS[0]],'approve','匿名測試',[],{'ui-invoice-fixture':1});return {committed:result.committed,rpc:window.__fixtureRpc.at(-1).name,sameRows:before===JSON.stringify(INVS)};})()`);
 assert.deepEqual(receipt,{committed:true,rpc:'finance_invoice_receipt_action_v1',sameRows:true});
 // Native modal is suspended on identity lock so it cannot cover reauthentication.
 await scoped("(async()=>{await openExpenseAccountingCorrections('ui-expense-fixture');document.querySelector('dialog [data-reason]').value='保留本機更正理由';})()");
 const suspended=await scoped(`(function(){var d=document.querySelector('dialog[data-finance-approval-dialog]');setFinanceWorkspaceIdentityBlocked(true);return {open:d.open,text:d.querySelector('[data-reason]').value,blocked:FinanceApprovalRuntime.isIdentityBlocked()};})()`);
 assert.deepEqual(suspended,{open:false,text:'保留本機更正理由',blocked:true});
 const lockedReopen=await scoped(`(async()=>{try{await openExpenseAccountingCorrections('ui-expense-fixture');return false;}catch(error){return !document.querySelector('dialog[data-finance-approval-dialog]').open;}})()`);
 assert.equal(lockedReopen,true,'locked identity cannot reopen a native top-layer dialog');
 const resumed=await scoped(`(function(){setFinanceWorkspaceIdentityBlocked(false);var d=document.querySelector('dialog[data-finance-approval-dialog]');return {open:d.open,text:d.querySelector('[data-reason]').value};})()`);
 assert.deepEqual(resumed,{open:true,text:'保留本機更正理由'});
 assert.equal((await browser('errors')).trim(),'','all actual UI actions complete without JavaScript errors');
 assert.deepEqual(await scoped('window.__fixtureNetwork'),[],'offline UI tests never dispatch a network request');
 console.log('PASS actual offline browser: narrow facade, closure list replacement, correction detail/read, typed receipt notification click, receipt RPC fixture, 390px layout and native-dialog identity lock');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{await browser('close').catch(()=>{});await new Promise(resolve=>server.close(resolve));});
