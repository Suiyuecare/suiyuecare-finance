'use strict';
// Actual health coordination, probes and HTML; only local reads/DOM/environment
// are fixtures. No credentials, real employee identity, or production requests.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
function extract(name){let at=source.indexOf('function '+name+'(');assert(at>=0,name);if(source.slice(at-6,at)==='async ')at-=6;const end=source.indexOf('\n',at);return source.slice(at,end).endsWith('}')?source.slice(at,end):source.slice(at,source.indexOf('\n}',end)+2);}
const pause=ms=>new Promise(r=>setTimeout(r,ms));
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};}
let checks=0;function pass(label){checks++;console.log('PASS '+label);}
function fixture(options={}){
 const nodes=Object.fromEntries(['health-sub','health-summary','health-body'].map(id=>[id,{innerHTML:'',textContent:''}]));
 const button={disabled:false,setAttribute(k,v){this[k]=v}};
 const c={Promise,Date,Set,Array,String,Object,Math,Error,Number,AbortController,setTimeout,clearTimeout,window:{},console,S:{user:{id:'fictional-finance-a',authUserId:'fictional-auth-a',email:'health@example.invalid',role:'ceo',rL:'執行長'},page:'health',demoLogin:false},CURRENT_PERMISSION_SNAPSHOT:{settings:'edit'},financeWorkspaceIdentityBlocked:false,SYSTEM_HEALTH_STATE:undefined,SYSTEM_HEALTH_READ_TIMEOUT_MS:options.timeout||12000,RL:{ceo:'執行長'},calls:[],events:[],alerts:[],active:{table:0,rpc:0},max:{table:0,rpc:0},nodes,button};
 function operation(kind,name,select){let signal;return{abortSignal(s){signal=s;return this},then(resolve,reject){const call={kind,name,select,signal,at:Date.now()};c.calls.push(call);c.active[kind]++;c.max[kind]=Math.max(c.max[kind],c.active[kind]);let response;try{response=options.transport&&options.transport(call,c)}catch(e){response=Promise.reject(e)}return Promise.resolve(response||{data:kind==='table'?[]:{missing_count:0}}).then(v=>{c.active[kind]--;call.finished=Date.now();return resolve(v)},e=>{c.active[kind]--;return reject(e)});}};}
 const client={from(name){let select;return{select(s){select=s;return this},limit(){return operation('table',name,select)}}},rpc(name){return operation('rpc',name)}};
 Object.assign(c,{getSb:()=>options.noClient?null:client,hasSupabase:()=>!options.noClient,currentTenantId:()=>c.tenant||'fictional-tenant',activeDataEnvironment:()=>c.env||'test',normalizedRoleKey:u=>u.role,currentRoleKey:()=>c.S.user?.role||'',canManageSettings:()=>['ceo','accountant'].includes(c.S.user?.role),el:id=>nodes[id],dataEnvLabel:()=>c.env||'test',num:v=>Number(v)||0,escAttr:v=>String(v).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])),attr:v=>String(v),alert:v=>c.alerts.push(v),document:{querySelectorAll:()=>[button]},isSchemaCacheMiss:msg=>/column|schema cache/i.test(msg||''),productizationReadinessRows:()=>[{status:'ok',label:'derived-readiness'}],productizationReadinessHtml:()=>'<div>derived-readiness</div>',opsRunbookHtml:()=>'<div>derived-runbook</div>',opsEventsHtml:()=>'<div>past-events</div>',localIdentityHealthChecks:()=>[{label:'local-identity',status:'ok',detail:'fictional'}],approvalHealthRecords:()=>[],workflowTemplateHealthRecords:()=>[],customizationSettingHealthRecords:()=>[],recordCustomizationHealthOpsEvent:()=>c.events.push({kind:'customization'}),recordOpsEvent:(kind,severity,title,detail)=>c.events.push({kind,severity,title,detail})});
 const names=['createSystemHealthState','systemHealthIdentity','clearSystemHealthRuntime','systemHealthStateForCurrentUser','systemHealthProbeRead','probeSystemHealthTable','probeSystemHealthRpc','healthStatusLabel','healthBadgeClass','healthErrorMessage','healthIsZeroishResult','healthBriefJson','healthCountByStatus','dashboardSystemState','healthSummaryHtml','healthSectionHtml','buildSystemHealth','scheduleSystemHealthPaint','runSystemHealth','withOperationTimeout'];
 vm.createContext(c);vm.runInContext(names.map(extract).join('\n'),c);
 c.clearSystemHealthRuntime(); // The boot hook is deliberately called before var initialization.
 c.SYSTEM_HEALTH_TABLE_CHECKS=Array.from({length:8},(_,i)=>({group:'tables',label:'table-'+i,table:'table-'+i,select:'id',required:true}));
 c.SYSTEM_HEALTH_RPC_CHECKS=Array.from({length:7},(_,i)=>({group:'rpcs',label:'rpc-'+i,name:'rpc-'+i,required:true}));
 return c;
}
async function main(){
 {
  const start=Date.now(),c=fixture({transport:q=>pause(q.name==='rpc-0'?3250:25).then(()=>({data:q.kind==='table'?[]:{missing_count:0}}))});
  const p=c.runSystemHealth();assert.equal(c.runSystemHealth(),p);await pause(180);
  assert(c.SYSTEM_HEALTH_STATE.running);assert(c.SYSTEM_HEALTH_STATE.completed>=14);assert.equal(c.events.length,0);assert.equal(c.SYSTEM_HEALTH_STATE.lastRun,'');assert(c.nodes['health-body'].innerHTML.includes('健檢進行中'));assert(c.nodes['health-summary'].innerHTML.includes('健檢進行中'));assert(c.nodes['health-summary'].innerHTML.includes('14 / 15'));assert(c.nodes['health-body'].innerHTML.includes('Data API 可讀'));assert(c.nodes['health-body'].innerHTML.includes('rpc-0'));assert(!c.nodes['health-body'].innerHTML.includes('derived-readiness'));assert(c.button.disabled);assert.equal(c.calls.length,15);assert.equal(c.max.table,4);assert.equal(c.max.rpc,3);assert(Math.abs(c.calls.find(q=>q.kind==='table').at-c.calls.find(q=>q.kind==='rpc').at)<50);pass('a real >3s RPC leaves 14 fast results visible; independent 4/3 lanes and exact-promise double-click deduplication');
  assert((await p).ok);assert(Date.now()-start>=3200);assert.equal(c.events.filter(e=>e.title==='系統健檢完成').length,1);assert.equal(c.SYSTEM_HEALTH_STATE.completed,15);assert(!c.SYSTEM_HEALTH_STATE.running);assert(!c.button.disabled);assert(c.SYSTEM_HEALTH_STATE.lastRun);pass('complete is recorded once only after every remote check settles; the slow RPC is not claimed accelerated');
  const last=c.SYSTEM_HEALTH_STATE.lastRun,next=c.runSystemHealth();assert.equal(c.SYSTEM_HEALTH_STATE.lastRun,last);assert(c.SYSTEM_HEALTH_STATE.rpcChecks.every(r=>r.status==='checking'));assert(c.SYSTEM_HEALTH_STATE.rpcChecks[0].detail.includes('上次結果：正常'));c.buildSystemHealth();assert(c.nodes['health-body'].innerHTML.includes('上次結果：正常'));c.clearSystemHealthRuntime();await next;pass('refresh retains labeled previous details without presenting pending checks as fresh successes');
 }
 {
  const d=deferred(),c=fixture({timeout:30,transport:q=>q.name==='rpc-0'?d.promise:null});assert((await c.runSystemHealth()).ok);assert.equal(c.SYSTEM_HEALTH_STATE.rpcChecks[0].status,'fail');assert(c.SYSTEM_HEALTH_STATE.rpcChecks[0].detail.includes('逾時'));assert(c.calls.find(q=>q.name==='rpc-0').signal.aborted);assert.equal(c.SYSTEM_HEALTH_STATE.completed,15);d.resolve({data:{missing_count:99}});await pause(0);assert.equal(c.SYSTEM_HEALTH_STATE.rpcChecks[0].status,'fail');pass('a timed-out required RPC is visibly failed, aborted and settled; late success cannot replace it');
 }
 for(const [label,change] of [['auth UUID',c=>c.S.user.authUserId='b'],['Finance ID',c=>c.S.user.id='b'],['tenant',c=>c.tenant='b'],['environment',c=>c.env='production'],['role',c=>c.S.user.role='accountant'],['permissions',c=>c.CURRENT_PERMISSION_SNAPSHOT={settings:'read'}],['identity lock',c=>c.financeWorkspaceIdentityBlocked=true]]){
  const d=deferred(),c=fixture({transport:()=>d.promise}),p=c.runSystemHealth();await pause(0);assert.equal(c.calls.length,7);change(c);c.buildSystemHealth();d.resolve({data:{missing_count:0}});assert((await p).stale);assert.equal(c.calls.length,7);assert.equal(c.events.length,0);assert.equal(c.SYSTEM_HEALTH_STATE.lastRun,'');assert.equal(c.SYSTEM_HEALTH_STATE.rpcChecks.length,0);pass(label+' change clears old results and prevents old queued reads/completion');
 }
 {
  const old=deferred(),fresh=deferred();let phase=0;const c=fixture({transport:()=>phase?fresh.promise:old.promise}),p=c.runSystemHealth();await pause(0);const controllers=c.calls.map(q=>q.signal);c.clearSystemHealthRuntime();assert(controllers.every(s=>s.aborted));phase=1;const newer=c.runSystemHealth();await pause(0);old.resolve({data:{missing_count:99}});assert((await p).stale);assert.equal(c.SYSTEM_HEALTH_STATE.promise,newer);assert(c.SYSTEM_HEALTH_STATE.running);fresh.resolve({data:{missing_count:0}});assert((await newer).ok);assert(c.SYSTEM_HEALTH_STATE.rpcChecks.every(r=>r.status==='ok'));pass('A → B → A/lock recovery uses generation invalidation; old cleanup cannot clear a newer same-identity run');
 }
 {
  const c=fixture({noClient:true});assert.equal((await c.runSystemHealth()).ok,false);assert.equal(c.calls.length,0);assert.equal(c.events.length,0);assert.equal(c.SYSTEM_HEALTH_STATE.lastRun,'');assert(c.SYSTEM_HEALTH_STATE.rpcChecks.every(r=>r.status==='skip'));assert(c.nodes['health-body'].innerHTML.includes('尚未完成遠端健檢'));assert(!c.nodes['health-body'].innerHTML.includes('derived-readiness'));pass('missing connection is explicit incomplete state, not a successful health run');
 }
 for(const change of [c=>c.S.user.authUserId='',c=>c.S.user.role='employee',c=>c.financeWorkspaceIdentityBlocked=true]){const c=fixture();change(c);assert((await c.runSystemHealth()).forbidden);assert.equal(c.calls.length,0);pass('unverified/unauthorized/blocked user cannot initiate any health read');}
 {
  const c=fixture({transport:q=>q.select==='modern'?{error:{message:'column missing'}}:{data:[]}}),item={table:'notifications',select:'modern',fallbackSelect:'old',required:true,submissionContractRequired:true};assert.equal((await c.probeSystemHealthTable(item)).status,'fail');assert.equal((await c.probeSystemHealthTable({...item,submissionContractRequired:false})).status,'warn');pass('legacy schema fallback preserves the mandatory submission contract failure');
 }
 {
  const c=fixture({timeout:5,transport:()=>pause(30).then(()=>({data:{missing_count:0}}))}),start=Date.now();assert.equal((await c.probeSystemHealthRpc({name:'submission-probe',required:true})).status,'ok');assert(Date.now()-start>=25);assert(!c.calls[0].signal);pass('existing standalone submission probes are not given the full-health timeout or scheduler');
 }
 {
  const c=fixture();c.workflowTemplateHealthRecords=()=>{throw Error('fixture local check failed')};assert.equal((await c.runSystemHealth()).ok,false);assert.equal(c.events.length,0);assert(c.SYSTEM_HEALTH_STATE.error.includes('fixture local check failed'));assert(c.SYSTEM_HEALTH_STATE.tableChecks.every(r=>r.status==='skip'));pass('synchronous preparation failure settles with explicit incomplete rows and no completion event');
 }
 assert(source.includes("if(blocked&&typeof clearSystemHealthRuntime==='function')clearSystemHealthRuntime();"));assert(extract('clearApprovalFastBootstrapState').includes('clearSystemHealthRuntime()'));pass('logout/bootstrap reset and identity-lock hooks clear the health epoch; hoisted pre-init clear is safe');
 {
  const c=fixture();c.SYSTEM_HEALTH_STATE.lastRun=new Date().toISOString();c.SYSTEM_HEALTH_STATE.tableChecks=[{status:'ok'}];assert.equal(c.dashboardSystemState().level,'ok');
  c.SYSTEM_HEALTH_STATE.running=true;assert.equal(c.dashboardSystemState().label,'系統待確認');assert(c.dashboardSystemState().running);
  c.SYSTEM_HEALTH_STATE.running=false;c.SYSTEM_HEALTH_STATE.error='incomplete';assert.equal(c.dashboardSystemState().level,'warn');
  c.SYSTEM_HEALTH_STATE.error='';c.SYSTEM_HEALTH_STATE.rpcChecks=[{status:'checking'}];assert.equal(c.dashboardSystemState().level,'warn');
  c.SYSTEM_HEALTH_STATE.rpcChecks=[{status:'fail'}];assert.equal(c.dashboardSystemState().level,'fail');pass('dashboard never reuses a prior green health result while refresh is pending or incomplete');
 }
 console.log('OK: '+checks+' system health progress checks');
}
main().catch(e=>{console.error(e);process.exitCode=1});
