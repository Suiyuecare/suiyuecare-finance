'use strict';
// Actual index closure and shipped engines. The transient localhost response adds
// only an eval bridge, fictional read-only transport, and a controlled clock.
// A .localhost loopback hostname exercises remote-persistence policy without
// overriding isLocalRuntime/requireRemotePersistence or reaching an external host.
// Mutation races inject an already-confirmed fictional result into the real
// notifyDraftMutation callback; this is not a save/delete or real-account E2E.
// All writes are rejected. Expected operational diagnostics are separately
// recorded as blocked attempts; business mutation attempts still fail the suite.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const crypto=require('node:crypto'),assert=require('node:assert/strict');
const {execFile}=require('node:child_process'),{promisify}=require('node:util');
const run=promisify(execFile),root=path.resolve(__dirname,'..');
const out=path.resolve(process.argv[2]||'/tmp/finance-draft-readiness-browser-20260913');
const session='draft-readiness-'+process.pid,bin=process.env.AGENT_BROWSER_BIN||'agent-browser';
assert(out!==root&&!out.startsWith(root+path.sep),'evidence must be outside the repository');
const source=fs.readFileSync(path.join(root,'index.html'),'utf8');
const engineFiles=fs.readdirSync(path.join(root,'assets/engines')).filter(x=>x.endsWith('.js')).sort();
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const engineHashes=Object.fromEntries(engineFiles.map(x=>[x,hash(fs.readFileSync(path.join(root,'assets/engines',x)))]));
const styleFiles=fs.readdirSync(path.join(root,'assets/styles')).filter(x=>x.endsWith('.css')).sort();
const styleHashes=Object.fromEntries(styleFiles.map(x=>[x,hash(fs.readFileSync(path.join(root,'assets/styles',x)))]));
const {applyBuildEnvironment}=require('./finance_build_environment');
const anchor='bootAuthGate();\n\n})();';assert(source.includes(anchor));
const html=applyBuildEnvironment(source,{target:'local',supabaseUrl:'',supabaseAnonKey:''})
  .replace(anchor,'window.__draftQA={run:async function(code){return await eval(code)}};\n'+anchor)
  .replace(/<script\b[^>]*src=["']https?:[^>]*><\/script>/gi,'')
  .replace('<head>','<head><meta http-equiv="Content-Security-Policy" content="connect-src \'self\'; form-action \'none\'; img-src \'self\' data: blob:">');
const server=http.createServer((req,res)=>{
  const p=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);
  if(p!==root&&!p.startsWith(root+path.sep)){res.writeHead(403);return res.end();}
  if(p===root||p===path.join(root,'index.html')){res.setHeader('content-type','text/html; charset=utf-8');return res.end(html);}
  if(!fs.existsSync(p)||!fs.statSync(p).isFile()){res.writeHead(404);return res.end();}
  res.setHeader('content-type',p.endsWith('.js')?'text/javascript':p.endsWith('.css')?'text/css':'application/octet-stream');
  res.end(fs.readFileSync(p));
});
const b=async(...args)=>(await run(bin,['--session',session,...args],{maxBuffer:12e6,timeout:45000})).stdout;
async function scope(code){
  let value=JSON.parse(await b('eval','--base64',Buffer.from('(async()=>JSON.stringify(await window.__draftQA.run('+JSON.stringify(code)+')))()').toString('base64')));
  return typeof value==='string'?JSON.parse(value):value;
}
async function until(condition,attempts=150){return scope('(async function(){for(var i=0;i<'+attempts+';i++){if('+condition+')return true;await new Promise(r=>setTimeout(r,20));}return false;})()');}
const evidence={scope:'Local real draft loader, actual approval/expense-page renderers and mutation callback; fictional read-only transport. No production login, API or writes. Deadlines accelerated only by fixture clock.',sourceHash:hash(source),engineHashes,styleHashes,checks:[],screens:[]};
function check(label,ok){assert(ok,label);evidence.checks.push(label);console.log('PASS '+label);}
const setup=`(function(mode){
USERS=[{id:'qa-employee',n:'許晴川',email:'employee@example.invalid',authUserId:'10000000-0000-0000-0000-000000000001',role:'employee',rL:'員工',eid:'F1',dc:'D1',active:true}];
ENTS=[{id:'F1',s:'星河照護',full:'星河照護股份有限公司',active:true}];
DEPTS=[{c:'D1',n:'行政課',eid:'F1',entityCodes:['F1'],newFormEntityCodes:['F1'],lv:3,active:true,isPostingUnit:true}];
REQS=[];INVS=[];BILLS=[];NOTIFS=[];VOUCHERS=[];LEDGER=[];DRAFTS=[];ORG_CHART=[];
quickLogin('employee');S.user.authUserId=USERS[0].authUserId;S.demoLogin=false;FINANCE_BUILD_TARGET='production';S.aT='drafts';
window.__mode=mode;window.__reads=[];window.__writes=[];window.__blockedDiagnostics=[];window.__late=[];window.__aborts=[];window.__alerts=[];window.__broadDone=false;window.__started=performance.now();
// Keep real source-page and applicant-fallback deadline paths; accelerate only the offline clock.
var nativeTimer=window.setTimeout;window.setTimeout=function(fn,ms){return nativeTimer(fn,ms===8000?200:ms===12000?500:ms===15000?700:ms===20000?1000:ms===120000?1600:ms)};
window.fetch=function(){throw Error('External network is disabled in this offline fixture')};window.alert=function(message){window.__alerts.push(String(message))};
var tenant=currentTenantId(),environment=activeDataEnvironment();
function row(id,title){return{id:id,owner_id:'qa-employee',owner_email:'employee@example.invalid',owner_name:'許晴川',tenant_id:tenant,data_environment:environment,application_type:'expense_reimbursement',title:title,amount:1050,applicant:'許晴川',updated_at:'2026-09-13T02:00:00Z',files:[{name:'虛構發票.pdf',type:'application/pdf',size:320,path:'fixture-private/draft/'+id+'/receipt.pdf',storagePath:'fixture-private/draft/'+id+'/receipt.pdf',bucket:'finance-attachments',kind:'draft_file'}],payload:{type:'expense_reimbursement',rec:'invoice',pay:'bank',step:3,lazyMode:true,state:{fields:{'nr-app':'許晴川','nr-app-id':'qa-employee','nr-dept':'D1','nr-ent':'F1','nr-date':'2026-09-13','nr-amt':'1050','nr-desc-purpose':'虛構文具採購','nr-desc':'這是離線測試草稿'},lazyRows:[{item:'文具用品',desc:'虛構文具',qty:1,unitPrice:1050,amount:1050,tax:50,receiptType:'invoice',receiptNo:'AA00000001'}]}}};}
window.__draftRows=[row('fixture-draft-one','虛構文具採購草稿'),row('fixture-draft-two','虛構第二份草稿')];
var data={finance_users:[{id:'qa-employee',name:'許晴川',email:'employee@example.invalid',auth_user_id:S.user.authUserId,tenant_id:tenant,role:'employee',department_code:'D1',entity_id:'F1',active:true}],system_settings:[],expense_requests:[],invoices:[],bills:[],notifications:[],vouchers:[]};
function transport(name,args,payload){
 var entry={name:name,args:args,started:performance.now()-window.__started};window.__reads.push(entry);
 var requestedMode=window.__mode;
 return{abortSignal:function(signal){signal.addEventListener('abort',function(){window.__aborts.push(name)});return this;},then:function(resolve,reject){
   var promise;
   if(name==='draft_requests'&&(requestedMode==='draft-hang'||requestedMode==='late'))promise=new Promise(function(r){window.__late.push({resolve:r,payload:payload,name:name})});
   else if(requestedMode==='source-hang'&&['expense_requests','bills','invoices'].indexOf(name==='finance_statement_source_page_v1'?args.p_source:name)>-1)promise=new Promise(function(){});
   else promise=new Promise(function(r){nativeTimer(function(){r(name==='draft_requests'&&requestedMode==='error'?{error:{code:'57014',message:'虛構測試：草稿同步逾時'}}:payload)},15)});
   return promise.then(function(value){entry.ended=performance.now()-window.__started;return value}).then(resolve,reject);
 }};
}
getSb=function(){return{
 from:function(table){
   var start=0,end=999,filters=[],q={
     select:function(columns,options){q.columns=columns;q.count=options&&options.count;return q},
     eq:function(key,value){filters.push({kind:'eq',key:key,value:value});return q},
     in:function(key,value){filters.push({kind:'in',key:key,value:value});return q},
     or:function(value){filters.push({kind:'or',value:value});return q},
     order:function(key,options){return q},limit:function(n){end=n-1;return q},range:function(a,z){start=a;end=z;return q},
     abortSignal:function(signal){q.signal=signal;return q},
     then:function(resolve,reject){
       var rows=table==='draft_requests'?(window.__mode==='empty'?[]:window.__draftRows):(data[table]||[]);
       rows=rows.filter(function(row){return filters.every(function(f){if(f.kind==='eq')return row[f.key]===f.value;if(f.kind==='in')return f.value.indexOf(row[f.key])>-1;return true})});
       var op=transport(table,{filters:filters,range:[start,end],count:q.count},{data:JSON.parse(JSON.stringify(rows.slice(start,end+1))),count:rows.length,error:null});
       if(q.signal)op.abortSignal(q.signal);return op.then(resolve,reject);
     }
   };
   ['insert','upsert','update','delete'].forEach(function(method){q[method]=function(payload){
     var diagnosticKeys=['id','action','target','detail','actor_name','actor_role','created_at','tenant_id'];
     var diagnostic=table==='compliance_audit_logs'&&method==='insert'&&payload&&!Array.isArray(payload)&&typeof payload==='object'&&String(payload.id||'').indexOf('aud_ops_')===0&&String(payload.action||'').indexOf('維運事件：')===0&&payload.tenant_id===tenant&&Object.keys(payload).every(function(key){return diagnosticKeys.indexOf(key)>-1});
     if(diagnostic)window.__blockedDiagnostics.push({table:table,method:method,action:payload.action,blocked:true});
     else window.__writes.push({table:table,method:method});
     throw Error('Offline read-only fixture refuses '+method);
   }});
   return q;
 },
 rpc:function(name,args){
   args=args||{};
   if(name==='finance_statement_source_page_v1'){
     if(['expense_requests','bills','invoices'].indexOf(args.p_source)<0||args.p_data_environment!==environment||!Number.isInteger(args.p_limit)||args.p_limit<1||args.p_limit>1000||!Number.isInteger(args.p_offset)||args.p_offset<0)throw Error('Offline source-page fixture refuses an invalid scope');
     var rows=(data[args.p_source]||[]).filter(function(row){return row.tenant_id===tenant&&row.data_environment===environment}).sort(function(a,b){return a.id.localeCompare(b.id)}),page=rows.slice(args.p_offset,args.p_offset+args.p_limit);
     return transport(name,args,{data:{ok:true,source:args.p_source,tenantId:tenant,dataEnvironment:environment,rows:JSON.parse(JSON.stringify(page)),total:rows.length,limit:args.p_limit,offset:args.p_offset,hasMore:args.p_offset+page.length<rows.length},error:null});
   }
   return transport(name,args,{error:{code:'42501',message:'Offline fixture only authorizes direct draft and bootstrap reads'}});
 },
 auth:{getSession:async function(){return{data:{session:null},error:null}}}
 }};
hasSupabase=function(){return true};
return true;
})`;
async function open(mode,page){
  await b('open','http://finance-draft-qa.localhost:'+server.address().port);
  await b('set','viewport','1440','1000');
  await scope(setup+'('+JSON.stringify(mode)+')');
  if(page!==false)await scope('nav('+JSON.stringify(page||'approvals')+',null);true');
}
async function screenshot(label,width){
  await b('set','viewport',String(width),width===390?'844':'1000');
  check(label+' '+width+' has no document overflow',!(await scope('document.documentElement.scrollWidth>innerWidth+1')));
  await b('screenshot',path.join(out,label+'-'+width+'.png'));evidence.screens.push(label+'-'+width+'.png');
}
async function noErrors(label){check(label+' has no unhandled browser errors',(await b('errors')).trim()==='');check(label+' made no business mutation attempts',await scope('window.__writes.length===0'));}
function ready(){return 'draftReadinessForCurrentUser().status==="ready"&&draftReadinessForCurrentUser().complete===true';}
(async()=>{
fs.mkdirSync(out,{recursive:true});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
await open('source-hang',false);
await scope('(function(){window.__broad=performRemoteDataLoad().then(function(r){window.__broadDone=true;return r},function(error){window.__broadDone=true;window.__broadError=error.message;return null});nav("approvals",null);return true})()');
check('drafts become ready while broad source reads are still pending',await until(ready()+'&&!window.__broadDone&&window.__reads.some(x=>["expense_requests","bills","invoices"].includes(x.name==="finance_statement_source_page_v1"?x.args.p_source:x.name)&&!x.ended)'));
check('new source-page RPC is genuinely pending with the original tenant/environment page contract',await scope('window.__reads.some(x=>x.name==="finance_statement_source_page_v1"&&["expense_requests","bills","invoices"].includes(x.args.p_source)&&x.args.p_data_environment===activeDataEnvironment()&&x.args.p_limit===1000&&x.args.p_offset===0&&!x.ended)&&!window.__broadDone'));
check('real draft renderer displays confirmed count and attachment summary',await scope('draftReadinessForCurrentUser().total===2&&el("draft-appr-cnt").textContent==="2"&&el("appr-list").innerText.includes("虛構文具採購草稿")&&el("appr-list").innerText.includes("附件 1 個")'));
// Assert same-flight dedup while the first broad read is still pending; a later
// explicit recovery sync is allowed to refresh already-complete draft data.
check('one direct draft read is shared across bootstrap and draft page',await scope('window.__reads.filter(x=>x.name==="draft_requests").length===1'));
evidence.cold=await scope('({readyMs:performance.now()-window.__started,broadDone:window.__broadDone,reads:window.__reads})');
await screenshot('ready',1440);await screenshot('ready',390);
check('broad timeout cannot revoke independently ready drafts',await until('window.__broadDone&&'+ready(),300));
await scope('buildAll();true');
check('broad repaint preserves the ready draft count',await scope('el("draft-appr-cnt").textContent==="2"&&el("appr-list").innerText.includes("虛構文具採購草稿")'));
evidence.blockedDiagnostics=await scope('window.__blockedDiagnostics');
check('operational diagnostic attempts remain explicitly blocked',evidence.blockedDiagnostics.every(x=>x.table==='compliance_audit_logs'&&x.method==='insert'&&x.blocked===true));
await noErrors('cold draft readiness');
await open('draft-hang');
check('initial draft load is unknown and never a verified zero',await scope('draftReadinessForCurrentUser().total===null&&el("draft-appr-cnt").textContent==="—"&&!el("appr-list").innerText.includes("目前沒有暫存表單")'));
check('hung draft read settles as an explicit error',await until('draftReadinessForCurrentUser().status==="error"'));
check('failed draft read has a retry and does not claim empty',await scope('el("draft-appr-cnt").textContent==="—"&&!el("appr-list").innerText.includes("目前沒有暫存表單")&&document.querySelector("[onclick*=retryMyDrafts]")!==null'));
await screenshot('failed',1440);await screenshot('failed',390);
const size=await scope('(function(){var buttons=Array.from(document.querySelectorAll("[onclick*=retryMyDrafts]"));var node=buttons.find(x=>x.getClientRects().length&&x.getBoundingClientRect().width>0);window.__retry=node;var r=node.getBoundingClientRect();return{w:r.width,h:r.height}})()');
check('mobile draft retry has a 44px target',size.w>=44&&size.h>=44);
const failedReads=await scope('window.__reads.filter(x=>x.name==="draft_requests").length');
await scope('buildAll();buildApprovals();renderDrafts();true');
check('background paints do not retry failed drafts automatically',await scope('window.__reads.filter(x=>x.name==="draft_requests").length==='+failedReads));
await scope('window.__mode="ok";Array.from(document.querySelectorAll("[onclick*=retryMyDrafts]")).find(x=>x.getClientRects().length&&x.getBoundingClientRect().width>0).setAttribute("data-draft-qa-retry","true");true');
await b('click','[data-draft-qa-retry="true"]');
check('explicit retry button restores confirmed draft data',await until(ready()+'&&draftReadinessForCurrentUser().total===2'));
await screenshot('recovered',390);
await noErrors('draft timeout and retry');
await open('draft-hang','expenses');
check('expense page draft card stays unknown before draft read succeeds',await scope('el("draft-count").textContent.includes("—")&&!el("draft-list").innerText.includes("目前沒有暫存表單")'));
check('expense page draft card has its own failed state',await until('draftReadinessForCurrentUser().status==="error"&&el("draft-list").querySelector("[onclick*=retryMyDrafts]")'));
await screenshot('expense-card-failed',390);
const expenseRetry=await scope('(function(){var r=el("draft-list").querySelector("[onclick*=retryMyDrafts]").getBoundingClientRect();return{w:r.width,h:r.height}})()');
evidence.expenseRetry=expenseRetry;check('expense page mobile draft retry has a 44px target',expenseRetry.w>=44&&expenseRetry.h>=44);await noErrors('expense page draft card');
await open('empty');
check('only a complete successful empty read renders zero and no drafts',await until(ready()+'&&draftReadinessForCurrentUser().total===0&&el("draft-appr-cnt").textContent==="0"&&el("appr-list").innerText.includes("目前沒有暫存表單")'));
await screenshot('verified-empty',390);await noErrors('verified empty drafts');
await open('ok');check('attachment fixture loaded',await until(ready()));
await scope('openDraft("fixture-draft-one");true');
check('opening a real draft preserves stored private attachment path',await until('S.nrDraftId==="fixture-draft-one"&&S.nrFiles.length===1&&S.nrFiles[0].path==="fixture-private/draft/fixture-draft-one/receipt.pdf"&&el("nr-flist").innerText.includes("虛構發票.pdf")'));
await scope('(function(){window.__mode="late";window.__pendingSave=loadCurrentUserDrafts({force:true});return true})()');
check('stale pre-save read is in flight',await until('window.__late.length===1'));
await scope('(async function(){var original=DRAFTS.find(x=>x.id==="fixture-draft-one"),saved=Object.assign({},original,{title:"已確認保存的新標題",updatedAt:"2026-09-13T03:00:00Z"});notifyDraftMutation(saved,saved.id,draftReadinessForCurrentUser().identity);window.__late.splice(0).forEach(x=>x.resolve(x.payload));await window.__pendingSave;return true})()');
check('late pre-save response cannot overwrite confirmed title or files',await scope('DRAFTS.find(x=>x.id==="fixture-draft-one").title==="已確認保存的新標題"&&DRAFTS.find(x=>x.id==="fixture-draft-one").files[0].path==="fixture-private/draft/fixture-draft-one/receipt.pdf"&&S.nrFiles[0].path==="fixture-private/draft/fixture-draft-one/receipt.pdf"'));
await scope('(function(){window.__pendingDelete=loadCurrentUserDrafts({force:true});return true})()');
check('stale pre-delete read is in flight',await until('window.__late.length===1'));
await scope('(async function(){notifyDraftMutation(null,"fixture-draft-two",draftReadinessForCurrentUser().identity);window.__late.splice(0).forEach(x=>x.resolve(x.payload));await window.__pendingDelete;return true})()');
check('late pre-delete response cannot resurrect a confirmed deletion',await scope('!DRAFTS.some(x=>x.id==="fixture-draft-two")&&DRAFTS.find(x=>x.id==="fixture-draft-one").title==="已確認保存的新標題"'));
await noErrors('confirmed mutation races and attachment restore');
await open('late');check('old identity read is pending',await until('window.__late.length===1'));
await scope('(async function(){window.__oldIdentity=draftReadinessForCurrentUser().identity;window.__oldPromise=draftReadinessForCurrentUser().promise;S.user=Object.assign({},S.user,{id:"qa-other",authUserId:"10000000-0000-0000-0000-000000000009",email:"other@example.invalid",n:"第二位虛構員工"});setFinanceWorkspaceIdentityBlocked(true);draftReadinessForCurrentUser();window.__late.splice(0).forEach(x=>x.resolve(x.payload));await window.__oldPromise;return true})()');
check('prior identity late response cannot populate a new identity draft list',await scope('DRAFTS.length===0&&draftReadinessForCurrentUser().total===null&&draftReadinessForCurrentUser().rows.length===0&&el("main-wrap").inert===true&&el("main-wrap").style.visibility==="hidden"'));
await scope('notifyDraftMutation({id:"foreign-confirmed",ownerId:"qa-employee",ownerEmail:"employee@example.invalid",title:"前帳號私有草稿"},"foreign-confirmed",window.__oldIdentity);true');
check('prior identity confirmed mutation callback is rejected',await scope('!DRAFTS.some(x=>x.id==="foreign-confirmed")'));
await noErrors('draft identity race');
evidence.ok=true;evidence.errors=(await b('errors')).trim();
assert.equal(hash(fs.readFileSync(path.join(root,'index.html'))),evidence.sourceHash,'source changed during evidence run; repeat exact source');
for(const file of engineFiles)assert.equal(hash(fs.readFileSync(path.join(root,'assets/engines',file))),engineHashes[file],'engine changed during evidence run: '+file);
for(const file of styleFiles)assert.equal(hash(fs.readFileSync(path.join(root,'assets/styles',file))),styleHashes[file],'stylesheet changed during evidence run: '+file);
fs.writeFileSync(path.join(out,'evidence.json'),JSON.stringify(evidence,null,2));
if(fs.existsSync(path.join(out,'failure.json')))fs.unlinkSync(path.join(out,'failure.json'));
console.log('PASS draft readiness browser: '+out);
})().catch(async error=>{
 console.error(error);fs.mkdirSync(out,{recursive:true});let debug;
 try{debug=await scope('({mode:window.__mode,reads:window.__reads,writes:window.__writes,blockedDiagnostics:window.__blockedDiagnostics,alerts:window.__alerts,state:typeof draftReadinessForCurrentUser==="function"?draftReadinessForCurrentUser():null,text:document.body.innerText,files:S.nrFiles})');}catch(_){}
 fs.writeFileSync(path.join(out,'failure.json'),JSON.stringify({error:error.message,evidence,debug},null,2));process.exitCode=1;
}).finally(async()=>{await b('close').catch(()=>{});server.close();});
