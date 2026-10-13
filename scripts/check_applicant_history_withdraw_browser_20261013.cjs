'use strict';
// Exercise the original app's personal-list, fresh detail, ownership/lifecycle
// guards, version pinning, withdrawal handler, transaction, and exact readback.
// Only provider auth/RPC/query transport uses fictional loopback fixtures.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const root=path.resolve(process.env.FINANCE_WITHDRAW_SOURCE_ROOT||path.resolve(__dirname,'..'));
const out=process.env.FINANCE_WITHDRAW_BROWSER_OUTPUT||'/tmp/finance-applicant-history-withdraw-browser-20261013';
const pw=require('playwright'),{applyBuildEnvironment}=require(path.join(root,'scripts/finance_build_environment'));
const source=fs.readFileSync(path.join(root,'index.html'),'utf8'),anchor='bootAuthGate();\n\n})();';
assert(source.includes(anchor),'actual app injection boundary');
const html=applyBuildEnvironment(source,{target:'local',supabaseUrl:'',supabaseAnonKey:''})
 .replace(anchor,'window.__withdrawQA={run:async function(code){return await eval(code)}};\n'+anchor)
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
 USERS=[{id:'qa-withdraw-owner',n:'虛構申請人',email:'withdraw@example.invalid',authUserId:'qa-withdraw-auth',role:'employee',rL:'一般組員',eid:'F1',dc:'D1',active:true}];
 ENTS=[{id:'F1',s:'虛構公司',full:'虛構公司股份有限公司',active:true}];DEPTS=[{c:'D1',n:'虛構部門',eid:'F1',entityCodes:['F1'],newFormEntityCodes:['F1'],lv:4,active:true,isPostingUnit:true}];
 REQS=[];BILLS=[];INVS=[];NOTIFS=[];VOUCHERS=[];ORG_CHART=[];
 S.demoLogin=true;setDataEnvironment(DATA_ENV_TEST);await doEnter(USERS[0]);await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
 S.demoLogin=false;S.user.authUserId='qa-withdraw-auth';S.user.tenantId=currentTenantId();financeWorkspaceIdentityBlocked=false;
 window.__qa={documents:[],calls:[],mutations:[],reads:[],audit:[],notices:[],dialogs:[],mode:'ready',laborStatus:'pending_invite',tab:'mine',kind:'req',type:'expense_reimbursement'};
 window.alert=function(value){window.__qa.notices.push(String(value));};window.confirm=function(value){window.__qa.dialogs.push(String(value));return true;};
 ['withdrawRequest','withdrawBill','withdrawInvoice'].forEach(function(name){var original=window[name];window[name]=function(){var result=original.apply(this,arguments);window.__qa.lastActionPromise=Promise.resolve(result);return result;};});
 var originalHistoryOpen=window.openApprovalHistoryWithdrawal;window.openApprovalHistoryWithdrawal=function(){var result=originalHistoryOpen.apply(this,arguments);window.__qa.lastOpenPromise=Promise.resolve(result);return result;};
 window.__qa.identity=function(){return{tenant_id:currentTenantId(),finance_user_id:S.user.id,auth_user_id:S.user.authUserId,data_environment:activeDataEnvironment()};};
 window.__qa.entry=function(){var q=window.__qa,first=q.documents[0],table=q.kind==='req'?'expense_requests':q.kind==='bill'?'bills':'invoices',count=q.documents.length;
  return{history_key:table+':'+first.id,record_type:table,kind:q.kind,record_id:first.id,record_no:count>1?'整批 虛構批次':first.no,batch_id:first.batch_id||'',batch_scope_key:q.kind==='bill'&&count>1?'bill-batch:'+('a'.repeat(32)):'',source_count:count,source_ids:q.documents.map(x=>x.id),personally_applied:!q.signer,personally_acted:!!q.signer,participation_label:q.signer?'本人已處理':'我申請的',last_participated_at:'2026-10-13T00:00:00Z',summary:{entity_id:'F1',entity_name:'虛構公司',department_code:'D1',department_name:'虛構部門',applicant:'虛構申請人',type_label:q.kind==='req'?requestTypeLabel(q.type):q.kind==='bill'?'申請繳費單':'開立發票',approval_status:first.approval_status||first.status,amount:q.documents.reduce((n,x)=>n+(q.kind==='inv'?x.total:x.amount),0),description:'虛構測試文件',request_date:'2026-10-13',source_count:count,has_attachments:false}};};
 function query(table){var ids=null,filters=[],offset=0,limit=Infinity;
  var operation={select:function(){return this;},in:function(field,value){if(field==='id')ids=value;else filters.push([field,value]);return this;},eq:function(field,value){filters.push([field,value]);return this;},order:function(){return this;},range:function(a,b){offset=a;limit=b-a+1;return this;},limit:function(n){limit=n;return this;},abortSignal:function(){return this;},maybeSingle:function(){return this;},then:function(resolve,reject){var q=window.__qa;var expectedTable=q.kind==='req'?'expense_requests':q.kind==='bill'?'bills':'invoices';var rows=table===expectedTable?q.documents.filter(function(row){return(!ids||ids.indexOf(row.id)>-1)&&filters.every(function(pair){return row[pair[0]]===pair[1];});}):[];
   if(!ids&&q.mode==='hidden-sibling')rows=rows.concat([Object.assign({},q.documents[0],{id:'qa-hidden-sibling',applicant_id:'qa-other-owner'})]);
   var count=rows.length;if(!ids&&q.mode==='count-mismatch')count++;if(!ids&&q.mode==='version-read-mismatch')rows=rows.map(function(row,i){return Object.assign({},row,{row_version:row.row_version+(i===0?1:0)});});
   q.reads.push({table:table,ids:ids,filters:filters,count:count});var response={data:JSON.parse(JSON.stringify(rows.slice(offset,offset+limit))),count:count,error:null};if(!ids&&q.mode==='delayed-batch-read')return new Promise(function(done){q.releaseBatchQuery=function(){done(response);};}).then(resolve,reject);if(!ids&&q.mode==='batch-read-timeout')return new Promise(function(){}).then(resolve,reject);return Promise.resolve(response).then(resolve,reject);}};return operation;
 }
 getSb=function(){return{from:query,auth:{getSession:async function(){return{data:{session:{user:{id:S.user.authUserId}}},error:null};},getUser:async function(){return{data:{user:{id:S.user.authUserId}},error:null};}},rpc:async function(name,args){var q=window.__qa;q.calls.push({name:name,args:JSON.parse(JSON.stringify(args||{}))});
  if(name==='finance_personal_document_summary_v1'){return{data:{ok:true,mode:'summary',projection_complete:true,identity:q.identity(),total:1,all_total:1,page:{limit:50,offset:0,has_more:false},items:[q.entry()]},error:null};}
  if(name==='finance_personal_document_detail_v1'){var e=q.entry();e.source_rows=JSON.parse(JSON.stringify(q.documents));e.participant_steps=[];
   if(q.mode==='partial-detail')e.source_rows.pop();if(q.mode==='foreign-tenant')e.source_rows[0].tenant_id='qa-other-tenant';if(q.mode==='foreign-environment')e.source_rows[0].data_environment='production';
   if(q.mode==='identity-during-detail'){S.user.authUserId='qa-switched-auth';}
   return{data:{ok:true,identity:q.identity(),item:e},error:null};}
  if(name==='finance_labor_request_status_v1'||name==='finance_labor_staff_for_request_v1')return{data:{status:q.laborStatus,statementId:q.laborStatus==='pending_invite'?null:'qa-statement',version:1,serviceLines:[]},error:null};
  if(name==='finance_approval_inbox_summary_for_current_user')return{data:{tenant_id:currentTenantId(),finance_user_id:S.user.id,counts:{total:0,pending:0,cashier:0},tasks:[],items:[],page:{bucket:'all',limit:50,offset:0,returned:0,has_more:false},generated_at:new Date().toISOString()},error:null};
  if(name==='finance_approval_tasks_for_current_user')return{data:[],error:null};
  if(['finance_bill_withdraw_applicant_v1','finance_invoice_withdraw_applicant_v1','finance_expense_act_active_step'].indexOf(name)>-1){
   assertWithdrawBoundary(name,args);q.mutations.push({name:name,args:JSON.parse(JSON.stringify(args))});
   if(q.mode==='server-conflict')return{data:null,error:{code:'55000',message:'內容已更新，請重新開啟確認'}};
   var selected=args.p_bill_ids||args.p_invoice_ids||args.p_request_ids;
   q.documents.forEach(function(row){if(selected.indexOf(row.id)>-1){row.status='cancelled';if(q.kind!=='req')row.approval_status='cancelled';row.row_version++;row.ver=(row.ver||1)+1;row.updated_at='2026-10-13T00:05:00Z';row.steps.push({rk:'applicant_withdraw',a:'cancelled',uid:S.user.id,comment:args.p_comment});q.audit.push({id:row.id,actorId:S.user.id,action:'withdraw',key:args.p_idempotency_key});}});
   return{data:{ok:true,count:selected.length},error:null};
  }
  return{data:[],error:null};
 }};};
 function assertWithdrawBoundary(name,args){var q=window.__qa,ids=args.p_bill_ids||args.p_invoice_ids||args.p_request_ids;
  if(name==='finance_expense_act_active_step'&&args.p_action!=='withdraw')throw new Error('Unexpected fictional mutation action');
  if(!Array.isArray(ids)||ids.length!==q.documents.length||new Set(ids).size!==ids.length||q.documents.some(x=>ids.indexOf(x.id)<0))throw new Error('Partial fictional withdrawal transaction');
  if(!args.p_idempotency_key||!args.p_expected_steps||args.p_data_environment!==activeDataEnvironment())throw new Error('Missing original transaction safeguards');
  q.documents.forEach(function(row){var expected=args.p_expected_steps[row.id];if(!expected||(q.kind==='req'?expected.ver!==row.ver:expected.row_version!==row.row_version))throw new Error('Missing frozen expected version');});
 }
 CURRENT_PERMISSION_SNAPSHOT={loaded:true,authUserId:"qa-withdraw-auth",permissions:[{permission_code:"finance.page.approvals.view",effect:"allow"},{permission_code:"finance.page.bills.view",effect:"deny"},{permission_code:"finance.page.invoices.view",effect:"deny"}]};hasSupabase=function(){return true;};AUTH_RUNTIME_STATE={event:'SIGNED_IN',sessionPresent:true};remoteDataAuthUserId=S.user.authUserId;
 approvalFastShouldHoldSkeleton=function(){return false;};
 window.__qa.seed=async function(kind,type,count,tab,options){var q=window.__qa;options=options||{};closeAppr();cancelApprovalHistoryDetail(true);APPROVAL_ROW_RUNTIME={};q.kind=kind;q.type=type;q.tab=tab;q.mode=options.mode||'ready';q.signer=!!options.signer;q.laborStatus=options.laborStatus||'pending_invite';q.calls=[];q.mutations=[];q.reads=[];q.audit=[];q.notices=[];q.dialogs=[];S.user.id='qa-withdraw-owner';S.user.authUserId='qa-withdraw-auth';S.user.role='employee';S.user.tenantId=currentTenantId();S.approvalReconcilePendingBySource={expense:{},bill:{},invoice:{}};S.incomeApprovalReconcileContext=null;S.incomeWithdrawBusy=false;S.withdrawBusy=false;INCOME_ACTION_RETRY_STATE={};
  q.documents=Array.from({length:count},function(_,i){var row={id:'QA-'+kind.toUpperCase()+'-'+(i+1),no:'QA-'+kind.toUpperCase()+'-NO-'+(i+1),batch_id:count>1?'QA-'+kind.toUpperCase()+'-BATCH':'',batch_count:kind==='bill'&&count>1?count:0,tenant_id:currentTenantId(),data_environment:activeDataEnvironment(),entity_id:'F1',department_code:'D1',applicant:'虛構申請人',applicant_id:options.owner||'qa-withdraw-owner',applicant_email:'withdraw@example.invalid',amount:100+i,total:100+i,tax:0,type:type==='labor'?'hr_expense_request':type,type_label:type==='labor'?'電子勞報':requestTypeLabel(type),description:'虛構測試文件',request_date:'2026-10-13',created_at:'2026-10-13T00:00:00Z',updated_at:'2026-10-13T00:00:00Z',status:kind==='req'?'pending_section_chief':'unpaid',approval_status:'pending_section_chief',approval_step:2,step:2,row_version:3,ver:3,steps:[{rk:'applicant_submit',a:'approved',uid:'qa-withdraw-owner'},{rk:'section_chief',a:null,uid:'qa-supervisor'},{rk:'ceo',a:null,uid:'qa-ceo'}],item:'虛構居家服務費',payer_name:'虛構繳費人'+(i+1),buyer:'虛構買受人'+(i+1),service_period:'2026-10',invoice_followup_status:'unreviewed',revenue_posting_state:'not_posted',form_payload:{}};
   if(type==='labor')row.form_payload={electronicLabor:{version:1,signerName:'虛構講師',period:'2026-10',totalGrossCents:10000,serviceLines:[]}};
   return Object.assign(row,options.patch||{});
  });REQS=[];BILLS=[];INVS=[];LABOR_DETAIL_CACHE={};LABOR_EPHEMERAL_IDENTITY='';
  primeApprovalFastBootstrap();approvalRowRuntimeCommitTrustedSummary([],'qa-authenticated-summary',[]);APPROVAL_FAST_BOOTSTRAP.tasksVerified=true;
  S.page='approvals';S.aT=tab;S.apprQuery='';S.apprPage=1;document.querySelectorAll('.pg').forEach(function(n){n.classList.toggle('on',n.id==='pg-approvals');});buildApprovals();await loadApprovalHistoryPage({force:true});return true;
 };
 return true;
})()`;
let browser,page;const evidence={source_sha256:crypto.createHash('sha256').update(source).digest('hex'),css_sha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'assets/styles/finance-core.css'))).digest('hex'),scope:'Fictional loopback auth/RPC/query only; original guards, UI, transaction and exact readback; no formal writes',cases:[]};
async function main(){fs.mkdirSync(out,{recursive:true});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const engines=(process.env.FINANCE_WITHDRAW_BROWSER_ENGINES||'chromium,webkit').split(',');const widths=(process.env.FINANCE_WITHDRAW_BROWSER_WIDTHS||'1440,390').split(',').map(Number);
 for(const engine of engines)for(const width of widths){
  browser=await pw[engine].launch({headless:true,...(engine==='chromium'&&process.env.FINANCE_BROWSER_CHANNEL?{channel:process.env.FINANCE_BROWSER_CHANNEL}:{})});page=await browser.newPage({viewport:{width,height:900}});const record={engine,width,checks:[]};evidence.cases.push(record);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const run=code=>page.evaluate(code=>window.__withdrawQA.run(code),code),check=(name,pass)=>{assert(pass,engine+' '+width+' '+name);record.checks.push(name);console.log('PASS '+engine+' '+width+' '+name);};
  const seed=async(kind,type,count,tab,options={})=>{await run('window.__qa.seed('+JSON.stringify(kind)+','+JSON.stringify(type)+','+count+','+JSON.stringify(tab)+','+JSON.stringify(options)+')');await page.locator('[data-history-key]').waitFor();};
  const open=async()=>{await page.locator('[data-history-withdraw]').click();await run('window.__qa.lastOpenPromise||true');await page.locator('#m-appr [data-applicant-withdraw]:visible, #pg-detail.on [data-applicant-withdraw]:visible').waitFor({state:'visible'});await run('APPROVAL_HISTORY_DETAIL_RUNTIME.promise||true');};
  const actualAction=async(kind)=>{const name=kind==='req'?'withdrawRequest':kind==='bill'?'withdrawBill':'withdrawInvoice';await run('window.'+name+'(window.__qa.documents[0].id)');};
  await page.goto('http://127.0.0.1:'+server.address().port,{waitUntil:'load'});await run(setup);
  const expenseTypes=await run('NR_TYPES.map(function(x){return x.id;}).concat(["shareholder_transaction","labor"])');
  for(const tab of ['mine','h'])for(const spec of expenseTypes.map(type=>({kind:'req',type,count:1})).concat(['bill','inv'].flatMap(kind=>[1,4,95].map(count=>({kind,type:kind,count}))))){
   await seed(spec.kind,spec.type,spec.count,tab);const label=tab+' '+spec.kind+' '+spec.type+' '+spec.count;
   check(label+' ordinary employee has reachable own withdrawal entry without management permission',await run('!canAccessPage("bills")&&!canAccessPage("invoices")&&!!el("appr-list").querySelector("[data-history-withdraw]")'));
   await open();if(spec.type==='labor')await run('loadLaborElectronicDetail(window.__qa.documents[0].id,true)');await page.locator('#m-appr [data-applicant-withdraw] button:not([disabled]):visible, #pg-detail.on [data-applicant-withdraw] button:not([disabled]):visible').waitFor({state:'visible'});
   if(spec.kind!=='req')check(label+' withdrawal focus stays in visible current detail, including after viewing labor',await run('!!document.activeElement&&el("appr-inner").querySelector("[data-applicant-withdraw]").contains(document.activeElement)'));
   check(label+' entry opens fresh complete detail and never mutates automatically',await run('window.__qa.mutations.length===0&&APPROVAL_HISTORY_MODAL_CONTEXT.ids.size==='+spec.count));
   check(label+' eligible detail permits own withdrawal and keeps other history actions blocked',await run('(window.__qa.kind==="req"?canWithdrawRequest(REQS[0]):incomeApplicantWithdrawAvailability(window.__qa.kind==="bill"?"bill":"invoice",window.__qa.kind==="bill"?BILLS[0]:INVS[0]).ok)&&!el("appr-inner").querySelector("[onclick*=apprApproveBill],[onclick*=apprRejectBill],[onclick*=apprApproveInv],[onclick*=saveIncomeEntityDept]")'));
   if(spec.kind!=='req'&&spec.count===4&&tab==='mine'){
    await run('(async function(){var id=window.__qa.documents[0].id;if(window.__qa.kind==="bill"){await apprApproveBill(id);await apprReturnPreviousBill(id);await apprRejectBill(id);}else{await apprApproveInv(id);await apprReturnPreviousInv(id);await apprRejectInv(id);}await saveEntityDeptOverride(window.__qa.kind==="bill"?"bill":"invoice",id);return true;})()');
    check(label+' direct approval, return, reject and entity edit remain denied from history',await run('window.__qa.calls.every(x=>!/^finance_(bill|invoice)_act_active_step/.test(x.name))&&window.__qa.mutations.length===0'));
   }
   if(spec.kind!=='req'&&spec.count>1){await run('(window.__qa.kind==="bill"?BILLS:INVS).push(Object.assign({},(window.__qa.kind==="bill"?BILLS:INVS)[0],{id:"qa-stale-cache-sibling",applicantId:"qa-other"}));true');check(label+' exact pinned batch excludes stale unrelated cached sibling',await run('(window.__qa.kind==="bill"?billGroupRows(BILLS[0]):invoiceGroupRows(INVS[0])).length==='+spec.count));}
   if(spec.kind==='bill'&&spec.count===95&&tab==='mine'){var focusedButton=page.locator('#m-appr [data-applicant-withdraw] button:not([disabled]):visible');await focusedButton.focus();await focusedButton.scrollIntoViewIfNeeded();await page.screenshot({path:path.join(out,engine+'-'+width+'-95-bill-withdraw-focused.png'),fullPage:false});}
   // Click the actual enabled action to exercise the public handler and transaction.
   const action=page.locator('#m-appr [data-applicant-withdraw] button:not([disabled]):visible, #pg-detail.on [data-applicant-withdraw] button:not([disabled]):visible');await action.click();await run('window.__qa.lastActionPromise||true');await page.waitForFunction(()=>window.__qa.mutations.length===1&&!window.__qa.documents.some(x=>x.status!=='cancelled'));await run('new Promise(r=>setTimeout(r,25))');
   check(label+' one transaction includes every original ID and retains source plus actor audit',await run('window.__qa.mutations.length===1&&window.__qa.audit.length==='+spec.count+'&&window.__qa.documents.length==='+spec.count+'&&window.__qa.documents.every(x=>x.status==="cancelled")&&window.__qa.audit.every(x=>x.actorId==="qa-withdraw-owner"&&x.key===window.__qa.mutations[0].args.p_idempotency_key)'));
   check(label+' actual exact readback retrieves all cancelled IDs',await run('window.__qa.reads.some(x=>Array.isArray(x.ids))&&['+(spec.kind==='req'?'REQS':spec.kind==='bill'?'BILLS':'INVS')+'][0].filter(x=>x.id!=="qa-stale-cache-sibling").every(x=>x.status==="cancelled")'));
  }
  for(const test of [
   {kind:'req',type:'purchase_request',patch:{status:'pending_cashier'}},
   {kind:'req',type:'refund_request',patch:{status:'pending_voucher'}},
   {kind:'req',type:'petty_cash_request',patch:{status:'paid'}},
   {kind:'req',type:'labor',laborStatus:'unknown'},
   {kind:'req',type:'labor',laborStatus:'invited'},
   {kind:'req',type:'labor',laborStatus:'signed'},
   {kind:'req',type:'labor',laborStatus:'accrued'},
   {kind:'bill',type:'bill',patch:{status:'paid',paid_at:'2026-10-13T00:00:00Z'}},
   {kind:'bill',type:'bill',patch:{linked_invoice_id:'qa-issued-invoice'}},
   {kind:'inv',type:'inv',patch:{revenue_posted:true}},
   {kind:'inv',type:'inv',patch:{approval_status:'pending_invoice_delivery',steps:[{rk:'accountant_invoice',a:'approved',uid:'qa-accountant'},{rk:'applicant_invoice_delivery',a:null,uid:'qa-withdraw-owner'}]}},
   {kind:'inv',type:'inv',patch:{receipt_files:[{name:'fictional.pdf',path:'fictional-only.pdf'}]}},
   {kind:'inv',type:'inv',patch:{receipt_submitted_at:'2026-10-13T00:00:00Z'}}
  ]){
   await seed(test.kind,test.type,test.kind==='req'?1:4,'mine',test);await open();if(test.type==='labor')await run('loadLaborElectronicDetail(window.__qa.documents[0].id,true)');
   await actualAction(test.kind);check(test.kind+' '+test.type+' '+(test.laborStatus||Object.keys(test.patch).join(','))+' forbidden lifecycle does not mutate',await run('window.__qa.mutations.length===0&&window.__qa.audit.length===0&&window.__qa.documents.every(x=>x.status!=="cancelled")'));
   if(test.kind!=='req')check('ineligible own income action explains disabled state',await run('!!el("appr-inner").querySelector("[data-applicant-withdraw] button[disabled][aria-disabled=true]")'));
  }
  for(const kind of ['req','bill','inv']){
   await seed(kind,kind==='req'?'refund_request':kind,kind==='req'?1:4,'h');await open();
   await run('(window.__qa.kind==="req"?REQS:window.__qa.kind==="bill"?BILLS:INVS)[0].'+(kind==='req'?'ver':'rowVersion')+'++;true');await actualAction(kind);
   check(kind+' changed full source fingerprint cannot use old modal proof',await run('window.__qa.mutations.length===0'));
   await seed(kind,kind==='req'?'purchase_request':kind,kind==='req'?1:4,'h');await open();await run('S.user.authUserId="qa-switched-auth";true');await actualAction(kind);
   check(kind+' changed auth identity cannot use stale modal proof',await run('window.__qa.mutations.length===0'));
   await seed(kind,kind==='req'?'payment_request':kind,kind==='req'?1:4,'h',{signer:true,owner:'qa-other-owner'});await page.locator('[data-history-open]').click();await page.locator('#m-appr').waitFor({state:'visible'});
   check(kind+' same displayed name/email and signer history never confers applicant withdrawal',await run('!el("appr-list").querySelector("[data-history-withdraw]")&&!el("appr-inner").querySelector("[data-applicant-withdraw]")'));
   await actualAction(kind);check(kind+' nonowner direct handler also denies mutation',await run('window.__qa.mutations.length===0'));
  }
  for(const kind of ['bill','inv'])for(const mode of ['partial-detail','foreign-tenant','foreign-environment','identity-during-detail','hidden-sibling','count-mismatch','version-read-mismatch']){
   await seed(kind,kind,4,'mine',{mode});await page.locator('[data-history-withdraw]').click();await run('APPROVAL_HISTORY_DETAIL_RUNTIME.promise||true');await actualAction(kind);
   check(kind+' '+mode+' fails closed without partial transaction or audit',await run('window.__qa.mutations.length===0&&window.__qa.audit.length===0'));
  }
  await seed('bill','bill',95,'mine',{mode:'delayed-batch-read',patch:{batch_count:0}});const detailStarted=Date.now();await open();
  check('slow full-batch verification does not block viewing fresh detail',Date.now()-detailStarted<2000&&await run('APPROVAL_HISTORY_MODAL_CONTEXT.withdrawalBatchChecking===true&&!!el("appr-inner").querySelector("[data-applicant-withdraw] button[disabled]")&&el("appr-inner").innerText.includes("95")'));
  await run('window.__qa.releaseBatchQuery();true');await page.locator('#m-appr [data-applicant-withdraw] button:not([disabled]):visible').waitFor({state:'visible'});
  check('background exact count verifies legacy batchCount 0 and enables only own withdrawal',await run('canWithdrawIncomeDocument("bill",BILLS[0])&&window.__qa.mutations.length===0&&!el("appr-inner").querySelector("[onclick*=apprApproveBill]")'));
  await seed('inv','inv',4,'mine',{mode:'delayed-batch-read'});await open();await run('S.user.authUserId="qa-switched-auth";window.__qa.releaseBatchQuery();true');await page.waitForTimeout(50);await actualAction('inv');
  check('late batch response after auth switch cannot reenable stale modal or mutate',await run('window.__qa.mutations.length===0&&approvalHistoryWithdrawalRows("inv",INVS[0])===null&&!!el("appr-inner").querySelector("[data-applicant-withdraw] button[disabled]")'));
  await seed('bill','bill',4,'mine',{mode:'batch-read-timeout'});await open();
  check('batch query timeout leaves original complete detail immediately usable',await run('APPROVAL_HISTORY_MODAL_CONTEXT.ids.size===4&&!!el("appr-inner").querySelector("[data-applicant-withdraw] button[disabled]")'));
  await page.waitForFunction(()=>window.__withdrawQA.run('APPROVAL_HISTORY_MODAL_CONTEXT&&APPROVAL_HISTORY_MODAL_CONTEXT.withdrawalBatchChecking===false'),{},{timeout:15000});await actualAction('bill');
  check('original 12-second batch query timeout fails closed and preserves every document',await run('window.__qa.mutations.length===0&&window.__qa.audit.length===0&&window.__qa.documents.length===4&&window.__qa.documents.every(x=>x.status==="unpaid")'));
  await seed('bill','bill',4,'mine',{patch:{batch_count:95}});await open();await actualAction('bill');check('4-row display scope cannot withdraw a declared 95-row durable batch',await run('window.__qa.mutations.length===0'));
  await seed('bill','bill',95,'mine',{patch:{batch_count:0}});await open();check('legacy absent batchCount is replaced by exact full sibling count verification',await run('canWithdrawIncomeDocument("bill",BILLS[0])&&window.__qa.reads.some(x=>!x.ids&&x.count===95)'));
  await seed('bill','bill',4,'mine');await open();await page.locator('#m-appr [data-applicant-withdraw] button:not([disabled]):visible').waitFor({state:'visible'});
  await run('Promise.all([withdrawBill(window.__qa.documents[0].id),withdrawBill(window.__qa.documents[0].id)])');
  check('concurrent repeat withdrawal invokes one stable full-batch transaction',await run('window.__qa.mutations.length===1&&window.__qa.audit.length===4'));
  await seed('inv','inv',4,'mine',{mode:'server-conflict'});await open();await actualAction('inv');check('atomic server conflict preserves every original row and audit; no optimistic cancel',await run('window.__qa.mutations.length===1&&window.__qa.audit.length===0&&window.__qa.documents.every(x=>x.status==="unpaid")&&INVS.every(x=>x.status==="unpaid")'));
  check('no page-wide overflow at '+width,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));check('no uncaught browser error',errors.length===0);
  await page.screenshot({path:path.join(out,engine+'-'+width+'-detail.png'),fullPage:false});await browser.close();browser=null;
 }
 fs.writeFileSync(path.join(out,'evidence.json'),JSON.stringify(evidence,null,2));console.log('APPLICANT_HISTORY_WITHDRAW_BROWSER_PASS '+evidence.cases.reduce((n,x)=>n+x.checks.length,0)+' '+out);
}
main().catch(async e=>{fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'failure.json'),JSON.stringify({error:e.message,evidence},null,2));if(page)try{fs.writeFileSync(path.join(out,'debug.json'),JSON.stringify(await page.evaluate(()=>window.__withdrawQA.run('({focus:document.activeElement.outerHTML,page:S.page,tab:S.aT,role:currentRoleKey(),bills:canAccessPage("bills"),invoices:canAccessPage("invoices"),ctx:APPROVAL_HISTORY_MODAL_CONTEXT,history:APPROVAL_HISTORY_RUNTIME,fast:APPROVAL_FAST_BOOTSTRAP,qa:window.__qa})')),null,2));await page.screenshot({path:path.join(out,'failure.png'),fullPage:false});fs.writeFileSync(path.join(out,'failure.html'),await page.content());}catch(_){}console.error(e);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();server.close();});
