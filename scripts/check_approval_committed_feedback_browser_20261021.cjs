#!/usr/bin/env node
'use strict';
// Actual index.html, approval handler, transaction/retry coordinator and shared
// status/feedback DOM. Fictional authority and transport boundaries only;
// no production credentials, data, outgoing API calls or financial operations.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),pw=require('playwright'),{applyBuildEnvironment}=require('./finance_build_environment');
const out=path.resolve(process.argv[2]||'/tmp/finance-approval-committed-feedback-browser-20261021');
const source=fs.readFileSync(path.join(root,'index.html'),'utf8'),anchor='bootAuthGate();\n\n})();';assert(source.includes(anchor));
const html=applyBuildEnvironment(source,{target:'local',supabaseUrl:'',supabaseAnonKey:''})
 .replace(anchor,'window.__committedQA={run:async function(code){return await eval(code)}};\n'+anchor)
 .replace(/<script\b[^>]*src=["']https?:[^>]*><\/script>/gi,'');
const server=http.createServer((req,res)=>{
 const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);
 if(file!==root&&!file.startsWith(root+path.sep)){res.writeHead(403);return res.end();}
 res.setHeader('Content-Security-Policy',"connect-src 'none'; form-action 'none'");
 if(file===root||file===path.join(root,'index.html')){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(html);}
 if(!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);return res.end();}
 res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'application/octet-stream');res.end(fs.readFileSync(file));
});
const setup=`(async function(){
 USERS=[{id:'qa-actor',n:'虛構驗收人',email:'qa@example.invalid',authUserId:'qa-auth',role:'ceo',rL:'執行長',eid:'QA',dc:'QA-D',active:true}];
 ENTS=[{id:'QA',s:'虛構公司',full:'虛構測試公司',active:true}];DEPTS=[{c:'QA-D',n:'虛構部門',eid:'QA',entityCodes:['QA'],lv:4,active:true,isPostingUnit:true}];
 REQS=[];INVS=[];BILLS=[];NOTIFS=[];VOUCHERS=[];ORG_CHART=[];LEDGER=[];S.demoLogin=true;setDataEnvironment(DATA_ENV_TEST);await doEnter(USERS[0]);await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
 S.demoLogin=false;S.user.authUserId='qa-auth';S.user.tenantId=currentTenantId();financeWorkspaceIdentityBlocked=false;
 window.__qa={mode:'partial',rpc:[],reads:0,recovery:0,diagnostics:[],alerts:[],renders:0,statuses:[],failures:[],results:[]};
 var originalStatus=setTopSyncStatus,originalFailure=failActionFeedback;
 setTopSyncStatus=function(message){__qa.statuses.push(message);originalStatus(message);};
 failActionFeedback=function(title,body){__qa.failures.push({title:title,body:body});originalFailure(title,body);};
 window.alert=function(message){ACTION_FEEDBACK_ALERTED=true;hideActionFeedback();__qa.alerts.push(String(message));};
 hasSupabase=function(){return true;};getSb=function(){return{rpc:async function(name,args){
   __qa.rpc.push({name:name,key:args.p_idempotency_key});
   if(__qa.mode==='unknown')return{error:{message:'Failed to fetch',code:'CLIENT_TIMEOUT'}};
   if(__qa.mode==='denied')return{error:{message:'fixture authorization refused',code:'42501'}};
   if(__qa.mode==='identity-rpc')S.user=Object.assign({},S.user,{id:'qa-new-actor',authUserId:'qa-new-auth'});
   return{data:{ok:true,count:1}};
 }};};
 // Approval authorization itself has separate negative VM/SQL tests. Here the
 // trusted fixture permits one fictional row and exercises the real write path.
 canActRequest=function(){return true;};approvalRecordsActionAvailability=function(table,rows){return{ok:true,rows:rows};};requireApprovalRecordsActionAvailability=function(){return true;};
 procurementRequiresDedicatedAction=function(){return false;};laborElectronicMarker=function(){return false;};isRestrictedReturnedMiddleStep=function(){return false;};
 approvalActionPayload=async function(){return{comment:'',files:[],addUid:''};};approvalActionPreflight=function(){return true;};uploadApprovalFiles=async function(p){return p;};expenseApprovalPreparation=function(){return{patches:{}};};
 reloadRequestsByIds=async function(){__qa.reads++;if(__qa.mode==='unknown')return false;REQS[0].steps[0].a='approved';REQS[0].rowVersion++;REQS[0].status='pending_cashier';return true;};
 requestApprovalFastBootstrap=async function(){return{hydrated:__qa.mode==='normal'};};approvalMutationRuntimeReady=function(){return true;};
 scheduleRemoteRecovery=function(){__qa.recovery++;};recordOpsEventDedup=function(type,severity,title,detail,meta){__qa.diagnostics.push({type:type,meta:meta});};recordOpsEvent=function(){};financeSubmissionDiagnostic=function(){};
 buildApprovals=function(){};buildAll=function(){__qa.renders++;if(__qa.mode==='render')throw Error('fictional post-commit render error');};openDetail=function(){};
 recordApprovalWriteFailure=function(label,row,result){__qa.failures.push({code:result.error.code,label:label});window.alert(result.error.message);};
 reloadInvoicesByIds=async function(){__qa.reads++;INVS[0].steps[0].a='approved';INVS[0].rowVersion++;INVS[0].approvalStatus='completed';return true;};invoiceNeedsReceivableFollowup=function(){return false;};canAttemptInvoiceRevenuePosting=function(){return true;};postInvoiceRevenue=async function(){return false;};
 var button=document.createElement('button');button.id='qa-run-approval';button.className='btn-primary';button.textContent='驗收：確認此單簽核';button.onclick=function(){__qa.action=__qa.mode==='detail'?window.doApprove('qa-document'):__qa.mode==='revenue'?withActionFeedback('正在核准發票',async function(context){var receipt=await invoiceActiveStepTransaction(INVS[0],'approve','',[],'',{},invoiceExpectedStepPayload(INVS),INVS);return completeCommittedApprovalUi(receipt,function(){},context);},'發票已核准'):window.apprApprove('qa-document');};el('pg-dashboard').prepend(button);
 window.__qaReset=function(mode){hideActionFeedback();__qa.mode=mode;__qa.rpc=[];__qa.reads=0;__qa.recovery=0;__qa.diagnostics=[];__qa.alerts=[];__qa.renders=0;__qa.statuses=[];__qa.failures=[];
  S.user=USERS[0];S.user.authUserId='qa-auth';S.user.tenantId=currentTenantId();S.incomeApprovalReconcileContext=null;S.approvalReconcilePendingBySource={expense:{},bill:{},invoice:{}};
  REQS=[{id:'qa-document',no:'QA-ONLY-001',type:'payment_request',eid:'QA',dc:'QA-D',uid:'qa-applicant',amt:1250,rowVersion:7,status:'pending_ceo',step:1,steps:[{rk:'ceo',uid:'qa-actor',a:'',status:'pending_ceo'},{rk:'cashier',uid:'qa-actor',a:'',status:'pending_cashier'}],formPayload:{}}];
  INVS=[Object.assign({},REQS[0],{id:'qa-invoice',approvalStatus:'pending_ceo',total:1250})];
  return true;
 };
 return __qaReset('partial');
})()`;
let browser;const evidence={scope:'Local actual index/handler/transaction/feedback DOM; fictional authorization/read/RPC transports; no live data',sourceSha256:crypto.createHash('sha256').update(source).digest('hex'),cases:[]};
(async()=>{
 fs.mkdirSync(out,{recursive:true});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
 for(const engine of ['chromium','webkit'])for(const width of [1440,390]){
  browser=await pw[engine].launch({headless:true});const page=await browser.newPage({viewport:{width,height:900}}),errors=[],record={engine,width,checks:[]};evidence.cases.push(record);
  await page.route('**/*',route=>new URL(route.request().url()).origin===origin&&['GET','HEAD'].includes(route.request().method())?route.continue():route.abort());
  page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.dismiss());
  const run=code=>page.evaluate(code=>window.__committedQA.run(code),code),check=(label,value)=>{assert(value,engine+' '+width+' '+label);record.checks.push(label);console.log('PASS '+engine+' '+width+' '+label);};
  await page.goto(origin);await page.waitForFunction(()=>window.__committedQA);await run(setup);
  for(const mode of ['normal','partial','detail','render','revenue','unknown','denied','identity-rpc']){
   await run('__qaReset('+JSON.stringify(mode)+')');await page.locator('#qa-run-approval').click();await run('__qa.action');
   const actual=await run('({rpc:__qa.rpc,reads:__qa.reads,recovery:__qa.recovery,alerts:__qa.alerts,failures:__qa.failures,statuses:__qa.statuses,renders:__qa.renders,diagnostics:__qa.diagnostics,feedback:el("action-feedback")?el("action-feedback").textContent:"",failed:el("action-feedback")?el("action-feedback").classList.contains("fail"):false,unknown:!!S.incomeApprovalReconcileContext,locks:Object.keys(APPROVAL_ACTION_IN_FLIGHT).length})');
   if(mode==='normal'){
    check('normal successful approval retains original success feedback without invented warning',actual.rpc.length===1&&actual.failed===false&&actual.failures.length===0&&actual.feedback.includes('已核准')&&!actual.feedback.includes('待同步'));
   }else if(mode==='partial'||mode==='detail'||mode==='render'||mode==='revenue'){
    check(mode+' one acknowledged mutation never reports failed write',actual.rpc.length===1&&!actual.failed&&actual.failures.length===0&&actual.alerts.length===0);
    check(mode+' persistent truthful sync notice and read-only recovery',actual.statuses.some(x=>x.includes(mode==='render'?'後續畫面或通知尚待同步':mode==='revenue'?'發票收入入帳待會計核對':'其他待辦清單仍在同步'))&&actual.recovery>0);
    check(mode+' diagnostic records operation key and phase without document payload',actual.diagnostics.some(x=>x.meta.operationKey===actual.rpc[0].key&&x.meta.stage)&&!JSON.stringify(actual.diagnostics).includes('QA-ONLY-001'));
    check(mode+' shared feedback visibly states warning, never claims revenue posted',actual.feedback.includes('簽核已完成')&&actual.feedback.includes(mode==='revenue'?'發票收入入帳待會計核對':mode==='render'?'後續畫面或通知尚待同步':'其他待辦清單仍在同步')&&!actual.feedback.includes('已入帳'));
    const geometry=await page.locator('#action-feedback .action-feedback-card').boundingBox();check(mode+' visible feedback fits narrow viewport',!!geometry&&geometry.x>=-1&&geometry.x+geometry.width<=width+1);
    await page.screenshot({path:path.join(out,engine+'-'+width+'-'+mode+'.png')});
   }else if(mode==='unknown'){
    check('unknown keeps original key on retry and never claims confirmed',actual.rpc.length===2&&actual.rpc[0].key===actual.rpc[1].key&&actual.unknown&&actual.failures.some(x=>x.code==='FINANCE_MUTATION_RESULT_UNKNOWN')&&!actual.statuses.some(x=>x.includes('簽核已完成')));
   }else if(mode==='denied'){
    check('authorization refusal is still failure, no retry',actual.rpc.length===1&&actual.failures.some(x=>x.code==='42501')&&!actual.statuses.some(x=>x.includes('簽核已完成')));
   }else{
    check('identity change after dispatch never renders or alerts old result',actual.rpc.length===1&&actual.reads===0&&actual.renders===0&&actual.alerts.length===0&&actual.statuses.length===0&&actual.failures.length===0);
   }
   check(mode+' action lock always released',actual.locks===0);
  }
  check('no uncaught browser errors',errors.length===0);await browser.close();browser=null;
 }
 fs.writeFileSync(path.join(out,'evidence.json'),JSON.stringify(evidence,null,2));console.log('Approval committed feedback browser PASS '+out);
})().catch(error=>{fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'failure.json'),JSON.stringify({error:error.message,evidence},null,2));console.error(error);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();server.close();});
