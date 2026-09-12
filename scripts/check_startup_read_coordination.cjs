'use strict';
// True index handlers with fictional RPC transport. No database or auth session.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),source=fs.readFileSync(path.join(root,'index.html'),'utf8');
function extract(name,src=source){const m=new RegExp('^(?:async )?function '+name+'\\(','m').exec(src);assert(m,name);return src.slice(m.index,src.indexOf('\n}',m.index)+2);}
const clone=x=>JSON.parse(JSON.stringify(x)),pause=ms=>new Promise(r=>setTimeout(r,ms));let passed=0;
function check(label){passed++;console.log('PASS '+label);}
function fixture(options={}){
 const c={S:{user:{id:'employee',authUserId:'auth-a',role:'employee',email:'fixture@example.invalid',dc:'D1',eid:'E1'},demoLogin:false},USERS:[],DEPTS:[],RL:{employee:'組員'},ORG_ADMIN_RUNTIME:{available:null},ORG_ADMIN_READ_STATE:{identity:'',sequence:0,promise:null,lastSuccessAt:0},ACCOUNT_RUNTIME_ASSURANCE_STATE:{},ACCOUNT_RUNTIME_ASSURANCE_SEQUENCE:0,CURRENT_PERMISSION_SNAPSHOT:{loaded:true,authUserId:'auth-a'},ROLE_PERMISSIONS:{employee:{dashboard:'read'}},financeUsersDirectoryRevision:0,financeWorkspaceIdentityBlocked:false,calls:[],active:0,maxActive:0,repairs:0,events:[],console:{warn(){}},Date,JSON,Math,Promise,Error,setTimeout,clearTimeout};
 const client={rpc:async(name)=>{c.calls.push(name);c.active++;c.maxActive=Math.max(c.maxActive,c.active);try{if(options.transport)return await options.transport(name,c);await pause(5);if(name==='finance_org_employee_role_list')return{data:[{finance_user_id:'employee',role_key:'employee',department_code:'D1'}]};if(name==='finance_org_department_list'||name==='finance_org_position_list')return{data:[]};return{data:{ok:true}};}finally{c.active--;}}};
 Object.assign(c,{window:{},currentFinanceAuthUserId:()=>c.S.user&&c.S.user.authUserId||'',normalizedRoleKey:u=>u.role,currentTenantId:()=>c.tenant||'tenant-a',activeDataEnvironment:()=>c.env||'test',getSb:()=>client,hasSupabase:()=>true,normalizeSettingValue:x=>x,
  normalizeOrgAdminList:x=>x,normalizeOrgAdminHealth:x=>x,normalizeFrontOfficePermissionRuntimeHealth:x=>x,normalizeDepartmentRuntimeHealth:x=>x,renderOrgAdminRuntimeStatus:()=>{},isRpcMissing:()=>false,
  fallbackOrgAdminDepartments:()=>[],fallbackOrgAdminPositions:()=>[],fallbackOrgAdminEmployeeRoles:()=>[],recordOpsEvent:(...args)=>c.events.push(args),recordOpsEventDedup:()=>{},uniqueRemoteStrings:x=>[...new Set(x)],remoteReadIssueText:e=>e.message,friendlyErrorMessage:e=>e.message,
  financeUserRuntimeReadiness:()=>({ok:!options.repair||c.repairs>0,warnings:[]}),repairCurrentFinanceIdentityRuntime:async()=>{c.repairs++;return{ok:true}},alert:()=>{}
 });
 vm.createContext(c);vm.runInContext(['withOperationTimeout','financeStartupReadIdentity','readOrgAdminRuntimeRpc','performApprovalOrgAdminRuntimeRead','refreshApprovalOrgAdminRuntime','verifyDepartmentRuntimeHealth','runCurrentUserRuntimeAssurance'].map(n=>extract(n)).join('\n'),c);
 if(options.timeout){const original=c.withOperationTimeout;c.withOperationTimeout=(p,label)=>original(p,label,options.timeout);}
 return c;
}
(async()=>{
 {
  const c=fixture();const [a,b]=await Promise.all([c.refreshApprovalOrgAdminRuntime(null,'load_remote_data_deferred'),c.runCurrentUserRuntimeAssurance()]);assert(a.ok&&b.ok);assert.equal(c.calls.length,6);assert.equal(c.repairs,0);check('concurrent background and own-account checks use six RPCs once, with no unnecessary repair');
  await c.refreshApprovalOrgAdminRuntime(null,'load_remote_data_deferred');assert.equal(c.calls.length,6);check('automatic recent diagnostic read is reused for the same complete identity');
  await c.refreshApprovalOrgAdminRuntime(null,'manual_admin_refresh');assert.equal(c.calls.length,12);check('manual refresh always reads fresh authority, even within the warmup window');
  c.ORG_ADMIN_READ_STATE.lastSuccessAt=Date.now()-31000;await c.refreshApprovalOrgAdminRuntime(null,'load_remote_data_deferred');assert.equal(c.calls.length,18);check('expired automatic read is revalidated');
 }
 {
  const c=fixture({repair:true});await c.runCurrentUserRuntimeAssurance();assert.equal(c.repairs,1);assert.equal(c.calls.length,12);assert(c.ACCOUNT_RUNTIME_ASSURANCE_STATE.ok);check('an actual self repair always forces a second complete six-RPC verification');
 }
 for(const change of [c=>c.S.user.authUserId='auth-b',c=>c.S.user.id='other',c=>c.tenant='tenant-b',c=>c.env='production',c=>c.S.user.role='accountant',c=>c.ROLE_PERMISSIONS.employee.dashboard='none',c=>c.financeUsersDirectoryRevision++,c=>c.CURRENT_PERMISSION_SNAPSHOT.permissions=['changed']]){
  const c=fixture();await c.refreshApprovalOrgAdminRuntime(null,'load_remote_data_deferred');change(c);await c.refreshApprovalOrgAdminRuntime(null,'load_remote_data_deferred');assert.equal(c.calls.length,12);
 }
 check('UUID, Finance ID, tenant, environment, role, permissions and directory revisions cannot share cached diagnostics');
 {
  const d=fixture({timeout:10,transport:()=>new Promise(()=>{})});const waiting=d.runCurrentUserRuntimeAssurance();await pause(1);d.S.user.authUserId='changed';const result=await waiting;assert(result.stale);assert.equal(d.repairs,0);assert.equal(d.ORG_ADMIN_RUNTIME.available,null);assert.equal(d.ACCOUNT_RUNTIME_ASSURANCE_STATE.running,false);check('identity change during a timed-out diagnostic cannot repair or publish old account data');
 }
 {
  const c=fixture({timeout:10,transport:()=>new Promise(()=>{})});const result=await c.refreshApprovalOrgAdminRuntime(null,'load_remote_data_deferred');assert.equal(result.ok,false);assert(c.ORG_ADMIN_RUNTIME.error);assert.notEqual(c.ORG_ADMIN_RUNTIME.available,true);assert.equal(c.ORG_ADMIN_READ_STATE.lastSuccessAt,0);assert.equal(c.ORG_ADMIN_READ_STATE.promise,null);check('diagnostic timeout is bounded, explicitly unverified and retryable, never a valid empty result');
 }
 {
  const waves=[];const c=fixture({transport:(name)=>new Promise(resolve=>waves.push({name,resolve}))});const old=c.refreshApprovalOrgAdminRuntime(null,'load_remote_data_deferred');await pause(0);const next=c.refreshApprovalOrgAdminRuntime(null,'manual_publish_refresh');await pause(0);waves.splice(4).forEach(x=>x.resolve({data:[]}));await pause(0);waves.splice(4).forEach(x=>x.resolve({data:{ok:true}}));await pause(0);waves.splice(4).forEach(x=>x.resolve({data:{ok:true}}));await next;const current=clone(c.ORG_ADMIN_RUNTIME);waves.splice(0).forEach(x=>x.resolve({data:[{name:'old'}]}));assert((await old).stale);assert.deepEqual(clone(c.ORG_ADMIN_RUNTIME),current);check('a late pre-refresh generation cannot overwrite the newer manual result');
 }
 for(const late of ['success','failure']){
  const c=fixture();const pending=[];c.refreshApprovalOrgAdminRuntime=async()=>({ok:true});c.repairCurrentFinanceIdentityRuntime=()=>new Promise((resolve,reject)=>pending.push({resolve,reject}));
  const old=c.runCurrentUserRuntimeAssurance({force:true});await pause(0);const newer=c.runCurrentUserRuntimeAssurance({force:true});await pause(0);assert.equal(pending.length,2);
  pending[1].resolve({ok:false,message:'newest verification warning'});await newer;const latest=clone(c.ACCOUNT_RUNTIME_ASSURANCE_STATE);assert(latest.warnings.includes('newest verification warning'));
  if(late==='success')pending[0].resolve({ok:true});else pending[0].reject(Error('old delayed failure'));
  assert((await old).stale);assert.deepEqual(clone(c.ACCOUNT_RUNTIME_ASSURANCE_STATE),latest);check('same-identity force retry ignores older '+late+' without overwriting new assurance state');
 }
 {
  const c=fixture({transport:async name=>name==='finance_org_department_list'?{error:{code:'PGRST202',message:'fixture missing RPC'}}:{data:name==='finance_org_employee_role_list'||name==='finance_org_position_list'?[]:{ok:true}}});c.isRpcMissing=e=>e.code==='PGRST202';
  const result=await c.refreshApprovalOrgAdminRuntime(null,'load_remote_data_deferred');assert(result.ok);assert.equal(c.ORG_ADMIN_READ_STATE.lastSuccessAt,0);await c.refreshApprovalOrgAdminRuntime(null,'load_remote_data_deferred');assert.equal(c.calls.length,12);check('a compatibility fallback is never cached as fresh authoritative diagnostics');
 }
 // The broad loader uses only this notification result's error field. A reused
 // result carries already-mapped display rows and must not be remapped downstream.
 {
  let calls=0;const c={S:{demoLogin:false},state:{identity:'identity',status:'ready',lastSuccessAt:new Date().toISOString(),rows:[{id:'n1',title:'最近通知',read:false}],count:1,promise:null},currentFinanceAuthUserId:()=> 'auth',financeNotificationState(){return this.state;},Date,Promise};
  c.financeNotificationState=()=>c.state;vm.createContext(c);vm.runInContext(extract('loadFinanceNotifications'),c);const r=await c.loadFinanceNotifications({reuseFresh:true});assert(r.reused&&r.count===1&&r.data[0].id==='n1');assert.equal(calls,0);check('broad warmup reuses only a recent successful notification snapshot');
 }
 {
  const c={Promise,Number,Math,Array,REMOTE_BOOTSTRAP_CONCURRENCY:2};vm.createContext(c);vm.runInContext(['runRemoteJobsWithConcurrency','runFinanceBootstrapReadJobs'].map(n=>extract(n)).join('\n'),c);
  let active=0,wide=0,max=0,maxWide=0;const small=[0,5,7,8,16,18];
  const jobs=Array.from({length:22},(_,i)=>async()=>{active++;if(!small.includes(i))wide++;max=Math.max(max,active);maxWide=Math.max(maxWide,wide);await pause(3);active--;if(!small.includes(i))wide--;return{index:i};});
  const result=await c.runFinanceBootstrapReadJobs(jobs,true);assert.deepEqual(clone(result),Array.from({length:22},(_,i)=>({index:i})));assert.equal(max,2);assert.equal(maxWide,1);check('all 22 bootstrap reads retain result positions, with at most two total and one wide financial read');
  const bad=jobs.slice();bad[7]=async()=>{throw Error('config denied')};await assert.rejects(c.runFinanceBootstrapReadJobs(bad,true),/config denied/);check('a rejected prerequisite cannot be converted into a successful empty bootstrap result');
 }
 console.log('OK: '+passed+' startup coordination checks passed');
})().catch(e=>{console.error(e);process.exitCode=1});
