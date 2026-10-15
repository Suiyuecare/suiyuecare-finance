'use strict';
// Fictional browser rehearsal of the original index.html worklist and detail.
// No real Google session, real employee, live request, or confirmation click.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const pw=require('playwright');
const root=path.resolve(__dirname,'..');
const out=process.env.FINANCE_APPLICANT_CONFIRM_BROWSER_OUTPUT||'/tmp/finance-taipei2-applicant-confirm-browser-20261015';
const {applyBuildEnvironment}=require(path.join(root,'scripts/finance_build_environment'));
const source=fs.readFileSync(path.join(root,'index.html'),'utf8');
const anchor='bootAuthGate();\n\n})();';
assert(source.includes(anchor),'original app injection boundary');
const html=applyBuildEnvironment(source,{target:'local',supabaseUrl:'',supabaseAnonKey:''})
 .replace(anchor,'window.__applicantQA={run:async function(code){return await eval(code)}};\n'+anchor)
 .replace(/<script\b[^>]*src=["']https?:[^>]*><\/script>/gi,'');
const server=http.createServer((req,res)=>{
 const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);
 if(file!==root&&!file.startsWith(root+path.sep)){res.writeHead(403);return res.end();}
 res.setHeader('Content-Security-Policy',"connect-src 'none'; form-action 'none'; img-src 'self' data: blob:; font-src 'self' data:");
 if(file===root||file===path.join(root,'index.html')){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(html);}
 if(!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);return res.end();}
 res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'application/octet-stream');res.end(fs.readFileSync(file));
});
const setup=`(async()=>{
 USERS=[
  {id:'qa-old-shared',n:'虛構原申請帳號',email:'old-shared@example.invalid',authUserId:'qa-google-old',role:'employee',rL:'一般組員',eid:'F1',dc:'D1',active:true,init:'原'},
  {id:'qa-personal-successor',n:'虛構新接手人',email:'successor@example.invalid',authUserId:'qa-google-successor',role:'employee',rL:'一般組員',eid:'F1',dc:'D1',active:true,init:'接'},
  {id:'qa-unrelated-employee',n:'虛構其他員工',email:'other@example.invalid',authUserId:'qa-google-other',role:'employee',rL:'一般組員',eid:'F1',dc:'D1',active:true,init:'他'}
 ];
 ENTS=[{id:'F1',s:'虛構法人',full:'虛構法人股份有限公司',active:true}];
 DEPTS=[{c:'D1',n:'虛構居服課',eid:'F1',entityCodes:['F1'],newFormEntityCodes:['F1'],lv:4,active:true,isPostingUnit:true}];
 REQS=[];BILLS=[];INVS=[];NOTIFS=[];VOUCHERS=[];ORG_CHART=[];
 S.demoLogin=true;setDataEnvironment(DATA_ENV_TEST);await doEnter(USERS[1]);
 await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
 S.demoLogin=false;financeWorkspaceIdentityBlocked=false;
 window.__qa={calls:[],attemptedWrites:[],notices:[]};
 window.alert=function(v){window.__qa.notices.push(String(v));};
 getSb=function(){return{rpc:async function(name){window.__qa.calls.push(name);if(/(act_active_step|post|approve|confirm|update|insert|delete)/i.test(name))window.__qa.attemptedWrites.push(name);return{data:[],error:null};},from:function(table){return{select:function(){return this;},eq:function(){return this;},in:function(){return this;},order:function(){return this;},limit:function(){return this;},then:function(resolve,reject){window.__qa.calls.push('read:'+table);return Promise.resolve({data:[],error:null}).then(resolve,reject);}}},auth:{getSession:async function(){return{data:{session:null},error:null};}}};};
 hasSupabase=function(){return true;};
 AUTH_RUNTIME_STATE={event:'SIGNED_IN',sessionPresent:true};
 window.__qa.seed=function(which,legacy,variant){
  closeAppr();var actor=USERS.find(function(u){return u.id===which;});if(!actor)throw Error('unknown fictional actor');
  S.user=actor;S.user.tenantId=currentTenantId();S.demoLogin=false;financeWorkspaceIdentityBlocked=false;setTopSyncStatus('虛構測試資料');
  CURRENT_PERMISSION_SNAPSHOT={loaded:true,authUserId:actor.authUserId,permissions:[
   {permission_code:'finance.page.approvals.view',effect:'allow'},
   {permission_code:'finance.page.accounting.view',effect:'deny'},
   {permission_code:'finance.action.post_ledger',effect:'deny'}]};
  S.approvalReconcilePendingBySource={expense:{},bill:{},invoice:{}};
  REQS=[{id:'QA-APPLICANT-1',no:'QA-20261015001',eid:'F1',dc:'D1',app:'虛構原申請帳號',applicant:'虛構原申請帳號',applicantId:'qa-old-shared',applicantEmail:'old-shared@example.invalid',type:'expense_reimbursement',tL:'一般費用申請',amount:100,amt:100,status:'pending_applicant_confirm',step:7,ver:2,date:'2026-10-15',requestDate:'2026-10-15',description:'虛構費用',desc:'虛構費用',formPayload:{},files:[],actualFiles:[],steps:[
   {rk:'applicant_submit',uid:'qa-old-shared',a:'approved',status:'submitted',r:'申請人送件'},
   {rk:'direct_supervisor',uid:'qa-manager',a:'approved',status:'pending_direct_supervisor',r:'主管審核'},
   {rk:'dept_manager',uid:'qa-manager',a:'approved',status:'pending_dept_manager',r:'部門主管'},
   {rk:'admin_director',uid:'qa-admin',a:'approved',status:'pending_admin_director',r:'行政主任'},
   {rk:'accountant',uid:'qa-accountant',a:'approved',status:'pending_accountant',r:'會計'},
   {rk:'cashier',uid:'qa-cashier',a:'approved',status:'pending_cashier',r:'出納'},
   Object.assign({rk:'applicant_confirm',a:'',status:'pending_applicant_confirm',r:'申請人確認：確認已撥款'},legacy?{}:{uid:'qa-personal-successor',email:'successor@example.invalid',reassignmentHistory:[{fromUserId:'qa-old-shared',toUserId:'qa-personal-successor',byId:null}]}),
   {rk:'accountant_final',uid:'qa-accountant',a:'',status:'pending_voucher',r:'會計入帳'}
  ]}];
  var applicantStep=REQS[0].steps[6];
  if(variant==='uid-email-conflict')applicantStep.email='old-shared@example.invalid';
  if(variant==='missing-uid-owner-email'){applicantStep.uid='qa-nonexistent';applicantStep.email='old-shared@example.invalid';}
  BILLS=[];INVS=[];
  var fingerprint='qa-trusted-summary:'+which;
  var tasks=[{task_id:'qa-task-1',source_table:'expense_requests',source_id:'QA-APPLICANT-1',task_status:'pending',task_order:7,role_key:'applicant_confirm'}];
  var summary=[{source_table:'expense_requests',source_ids:['QA-APPLICANT-1'],representative_source_id:'QA-APPLICANT-1',source_no:'QA-20261015001',row_count:1,task_ids:['qa-task-1']}];
  APPROVAL_ROW_RUNTIME={};
  APPROVAL_FAST_BOOTSTRAP=Object.assign({},APPROVAL_FAST_BOOTSTRAP,{status:'ready',identity:approvalFastBootstrapIdentity(),verified:true,tasksVerified:true,hydrated:true,readOnly:false,canAct:true,verifiedSummaryFingerprint:fingerprint,summaryFingerprint:fingerprint,summaryItems:summary});
  approvalRowRuntimeCommitTrustedSummary(summary,fingerprint,tasks);
  approvalRowMarkVerified('expense_requests',REQS[0],fingerprint,['QA-APPLICANT-1']);
  S.page='approvals';S.aT='p';S.apprQuery='';S.apprPage=1;S.apprSelected={};
  document.querySelectorAll('.pg').forEach(function(n){n.classList.toggle('on',n.id==='pg-approvals');});
  buildApprovals();return{hardReady:approvalHardSafetyReady(),rowVerified:approvalRowIsLocallyVerified('expense_requests',REQS[0]),canAct:canActRequest(REQS[0]),pendingRows:el('appr-list').querySelectorAll('[data-appr-key]').length};
 };
 return true;
})()`;
async function main(){fs.mkdirSync(out,{recursive:true});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const evidence={source_sha256:crypto.createHash('sha256').update(source).digest('hex'),scope:'Original Finance index UI/role/verified-row logic with fictional identity and request; intercepted transport; no real Google session or formal writes',cases:[]};
 for(const engine of ['chromium','webkit'])for(const width of [1440,390]){
  const browser=await pw[engine].launch({headless:true});let page;
  try{page=await browser.newPage({viewport:{width,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
   const run=code=>page.evaluate(code=>window.__applicantQA.run(code),code);
   await page.goto('http://127.0.0.1:'+server.address().port,{waitUntil:'load'});await run(setup);
   const record={engine,width,checks:[]};evidence.cases.push(record);
   const check=(name,pass)=>{assert(pass,engine+' '+width+' '+name);record.checks.push(name);console.log('PASS '+engine+' '+width+' '+name);};
   let state=await run('window.__qa.seed("qa-personal-successor")');
   check('trusted fictional row is actionable for explicit successor',state.hardReady&&state.rowVerified&&state.canAct&&state.pendingRows===1);
   check('worklist visibly names fictional successor and pending applicant confirmation',await run('el("top-info").textContent.includes("虛構新接手人")&&el("appr-list").innerText.includes("待申請人確認")'));
   await page.screenshot({path:path.join(out,engine+'-'+width+'-successor-worklist.png'),fullPage:false});
   await page.locator('#appr-list [data-appr-key]').click();await page.locator('#m-appr').waitFor({state:'visible'});
   check('real worklist opens applicant confirmation detail',await run('el("appr-inner").innerText.includes("QA-20261015001")&&el("appr-inner").innerText.includes("申請人確認")&&!!el("appr-inner").querySelector("button[onclick*=doConfirmPay]")'));
   check('employee has no accounting posting action',await run('!canReviseAccountingDetails()&&!canEditRequestAccountingLines(REQS[0])&&!el("appr-inner").querySelector("button[onclick*=doConfirmVoucher]")'));
   check('opening detail made no mutation',await run('window.__qa.attemptedWrites.length===0'));
   await page.screenshot({path:path.join(out,engine+'-'+width+'-successor-detail.png'),fullPage:false});
   await page.locator('#appr-inner button[onclick*=doConfirmPay]').scrollIntoViewIfNeeded();
   await page.screenshot({path:path.join(out,engine+'-'+width+'-successor-action-visible.png'),fullPage:false});
   state=await run('window.__qa.seed("qa-unrelated-employee")');
   check('unrelated employee cannot see or act on task',state.hardReady&&state.rowVerified&&!state.canAct&&state.pendingRows===0);
   state=await run('window.__qa.seed("qa-old-shared")');
   check('original applicant retains history identity but cannot act on reassigned task',state.hardReady&&state.rowVerified&&!state.canAct&&state.pendingRows===0&&await run('requestIsMine(REQS[0])&&!stepBelongsToUser(activeStep(REQS[0]),REQS[0])'));
   state=await run('window.__qa.seed("qa-old-shared",false,"uid-email-conflict")');
   check('original applicant email cannot override a different explicit UID',state.hardReady&&state.rowVerified&&!state.canAct&&state.pendingRows===0);
   state=await run('window.__qa.seed("qa-personal-successor",false,"uid-email-conflict")');
   check('conflicting UID and email fail closed for assigned successor',state.hardReady&&state.rowVerified&&!state.canAct&&state.pendingRows===0);
   state=await run('window.__qa.seed("qa-old-shared",false,"missing-uid-owner-email")');
   check('original applicant cannot claim nonexistent explicit UID via email',state.hardReady&&state.rowVerified&&!state.canAct&&state.pendingRows===0);
   state=await run('window.__qa.seed("qa-old-shared",true)');
   check('legacy unassigned applicant task still belongs to original applicant',state.hardReady&&state.rowVerified&&state.canAct&&state.pendingRows===1);
   state=await run('window.__qa.seed("qa-personal-successor",true)');
   check('legacy unassigned applicant task does not belong to successor',state.hardReady&&state.rowVerified&&!state.canAct&&state.pendingRows===0);
   const revision=await run(`(function(){
     var row=REQS[0],step=activeStep(row);step.rk='applicant_revision';
     step.uid='qa-personal-successor';step.email='successor@example.invalid';S.user=USERS[1];
     var successor=financeCurrentUserCanActStep(row,step);
     step.uid='qa-old-shared';step.email='old-shared@example.invalid';S.user=USERS[0];
     var original=financeCurrentUserCanActStep(row,step);
     delete step.uid;delete step.email;
     var legacy=financeCurrentUserCanActStep(row,step);
     return{successor:successor,original:original,legacy:legacy};
   })()`);
   check('expense revision rejects explicit successor who is not original applicant',revision.successor===false);
   check('expense revision accepts explicit original applicant',revision.original===true);
   check('expense revision preserves legacy unassigned owner fallback',revision.legacy===true);
   check('no write in negative identity case',await run('window.__qa.attemptedWrites.length===0'));
   check('no uncaught browser error',errors.length===0);
  }finally{await browser.close();}
 }
 fs.writeFileSync(path.join(out,'evidence.json'),JSON.stringify(evidence,null,2));
 console.log('TAIPEI2_APPLICANT_CONFIRM_BROWSER_PASS '+evidence.cases.reduce((n,c)=>n+c.checks.length,0)+' '+out);
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>server.close());
