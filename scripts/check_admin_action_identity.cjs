'use strict';
// Real dispatcher, permission-sync and both organization readers. Only RPC
// transport, output normalizers and rendering are fictional. No auth/DB writes.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),source=fs.readFileSync(path.join(root,'index.html'),'utf8');
function extract(name,isWindow=false){let start=source.indexOf(isWindow?'window.'+name+'=':'function '+name+'(');assert(start>=0,name);if(!isWindow&&source.slice(start-6,start)==='async ')start-=6;for(let i=source.indexOf('{',start);i<source.length;i++){if(source[i]!=='}')continue;const code=source.slice(start,i+1)+(isWindow?';':'');try{new vm.Script(code);return code;}catch{}}throw Error(name);}
const clone=x=>JSON.parse(JSON.stringify(x)),tick=()=>new Promise(resolve=>setImmediate(resolve));let passed=0;
function fixture({stage='chart',failure=false}={}){
 const c={S:{user:{id:'manager-a',authUserId:'auth-a',role:'ceo'},demoLogin:false},tenant:'tenant-a',environment:'test',financeWorkspaceIdentityBlocked:false,financeAuthIdentityEpoch:1,financeUsersDirectoryRevision:0,CURRENT_PERMISSION_SNAPSHOT:{revision:1},ROLE_PERMISSIONS:{ceo:{users:'manage'}},FINANCE_ADMIN_ACTIONS_PENDING:{},ORG_CHART:[{userId:'original'}],ORG_CHART_PERSISTED:[{userId:'original'}],ORG_CHART_REVISION:'original',ORG_CHART_DIRTY:false,ORG_CHART_CONFLICT:false,ORG_CHART_CANONICAL_RUNTIME_LOADED:false,SYSTEM_SETTINGS:{organization_chart:[{userId:'original'}]},ORG_ADMIN_RUNTIME:{available:null},ORG_ADMIN_READ_STATE:{sequence:0},USERS:[],DEPTS:[],RL:{},calls:[],events:[],alerts:[],renders:0,console:{warn(){}},Promise,Error,Date,JSON,setTimeout,clearTimeout};
 let resolve,reject;const held=new Promise((r,j)=>{resolve=r;reject=j;});
 const client={rpc:async name=>{c.calls.push(name);if((stage==='sync'&&name==='sync_finance_user_permission_runtime')||(stage==='chart'&&name==='finance_org_chart_editor_state_v2')||(stage==='runtime'&&name==='finance_org_department_list'))return held;if(name==='finance_org_chart_editor_state_v2')return{data:{revision:'old-manager-revision',rows:[{userId:'old-manager-row'}]}};return{data:name.endsWith('_list')?[]:{ok:true}};}};
 Object.assign(c,{getSb:()=>client,currentFinanceAuthUserId:()=>c.S.user&&c.S.user.authUserId||'',normalizedRoleKey:u=>u.role,currentTenantId:()=>c.tenant,activeDataEnvironment:()=>c.environment,canManageUsers:()=>c.S.user.role==='ceo'&&c.CURRENT_PERMISSION_SNAPSHOT.denied!==true,canAccessPage:()=>false,canManageSettings:()=>false,alert:x=>c.alerts.push(x),isRpcMissing:e=>e&&e.code==='PGRST202',num:x=>Number(x||0),normalizeSettingValue:x=>x,normalizeOrgChartRuntimeRows:x=>x,cloneSettingValue:clone,recordOpsEvent:(...a)=>c.events.push(a),recordOpsEventDedup:(...a)=>c.events.push(a),normalizeOrgAdminList:x=>x,normalizeOrgAdminHealth:x=>x,normalizeFrontOfficePermissionRuntimeHealth:x=>x,normalizeDepartmentRuntimeHealth:x=>x,renderOrgAdminRuntimeStatus:()=>c.renders++,fallbackOrgAdminDepartments:()=>[],fallbackOrgAdminPositions:()=>[],fallbackOrgAdminEmployeeRoles:()=>[],verifyDepartmentRuntimeHealth:async()=>({ok:true})});
 c.window=c;vm.createContext(c);
 for(const name of ['withOperationTimeout','financeStartupReadIdentity','refreshOrgChartRowsFromRuntime','readOrgAdminRuntimeRpc','performApprovalOrgAdminRuntimeRead','refreshApprovalOrgAdminRuntime','syncFrontOfficePermissionRuntime'])vm.runInContext(extract(name),c);
 vm.runInContext(extract('financeAdminAction',true),c);
 c.release=()=>resolve(failure?{error:{code:'PGRST202',message:'old actor-only error'}}:stage==='chart'?{data:{revision:'old-manager-revision',rows:[{userId:'old-manager-row'}]}}:{data:stage==='runtime'?[]:{ok:true}});c.reject=()=>reject(Error('old transport-only error'));
 c.wait=async()=>{for(let i=0;i<20;i++){await tick();if(c.calls.includes(stage==='sync'?'sync_finance_user_permission_runtime':stage==='chart'?'finance_org_chart_editor_state_v2':'finance_org_department_list'))return;}throw Error('held RPC never started');};return c;
}
function visibleState(c){return clone({chart:c.ORG_CHART,persisted:c.ORG_CHART_PERSISTED,revision:c.ORG_CHART_REVISION,dirty:c.ORG_CHART_DIRTY,conflict:c.ORG_CHART_CONFLICT,loaded:c.ORG_CHART_CANONICAL_RUNTIME_LOADED,settings:c.SYSTEM_SETTINGS,runtime:c.ORG_ADMIN_RUNTIME,events:c.events,alerts:c.alerts,renders:c.renders});}
const changes={
 'account and tenant switch':c=>{c.S.user={id:'manager-b',authUserId:'auth-b',role:'ceo'};c.tenant='tenant-b';},
 'Finance ID change':c=>{c.S.user.id='other';},
 'role revocation':c=>{c.S.user.role='employee';},
 'permission revision':c=>{c.CURRENT_PERMISSION_SNAPSHOT={revision:2,denied:true};},
 'configured permission change':c=>{c.ROLE_PERMISSIONS.ceo.users='none';},
 'environment change':c=>{c.environment='production';},
 'identity lock':c=>{c.financeWorkspaceIdentityBlocked=true;},
 'same account reauthentication epoch':c=>{c.financeAuthIdentityEpoch+=2;},
};
(async()=>{
 for(const [label,change] of Object.entries(changes))for(const stage of ['sync','chart','runtime']){
  const c=fixture({stage});const pending=c.financeAdminAction('permissions');await c.wait();change(c);const before=visibleState(c);c.release();const result=await pending;
  assert.equal(result.ok,false,label+'/'+stage);assert.equal(result.stale,true,label+'/'+stage);assert.deepEqual(visibleState(c),before,label+'/'+stage+' must not publish/log/alert old response');passed++;console.log('PASS '+label+' while '+stage+' pending');
 }
 for(const stage of ['sync','chart','runtime'])for(const mode of ['error','throw']){
  const c=fixture({stage,failure:true});const pending=c.financeAdminAction('permissions');await c.wait();c.financeAuthIdentityEpoch+=2;const before=visibleState(c);mode==='error'?c.release():c.reject();await pending;assert.deepEqual(visibleState(c),before);passed++;console.log('PASS old '+stage+' '+mode+' cannot reset cache or alert after same-owner reauthentication');
 }
 {
  const c=fixture();const first=c.financeAdminAction('permissions'),second=c.financeAdminAction('permissions');await c.wait();assert.equal(c.calls.filter(n=>n==='sync_finance_user_permission_runtime').length,1);c.release();assert((await first).ok&&(await second).ok);assert.equal(c.ORG_CHART[0].userId,'old-manager-row');assert(c.ORG_ADMIN_RUNTIME.available);assert.equal(c.alerts.length,1);assert.equal(c.calls.length,8);assert.equal(Object.keys(c.FINANCE_ADMIN_ACTIONS_PENDING).length,0);passed++;console.log('PASS same-identity double click shares one mutation and complete real refresh chain');
 }
 for(const denied of ['employee','permission','lock']){
  const c=fixture();if(denied==='employee')c.S.user.role='employee';if(denied==='permission')c.CURRENT_PERMISSION_SNAPSHOT.denied=true;if(denied==='lock')c.financeWorkspaceIdentityBlocked=true;assert((await c.financeAdminAction('permissions')).denied);assert.equal(c.calls.length,0);passed++;console.log('PASS '+denied+' denied before any RPC');
 }
 {
  const c=fixture({stage:'sync',failure:true});const pending=c.financeAdminAction('permissions');await c.wait();c.release();assert.equal((await pending).ok,false);assert.equal(c.alerts.length,1);assert.equal(c.calls.length,1);assert.equal(c.ORG_CHART_REVISION,'original');passed++;console.log('PASS current identity receives real failure and no success refresh');
 }
 {
  const c=fixture();const pending=c.financeAdminAction('permissions');c.financeAuthIdentityEpoch++;c.release();assert((await pending).stale);assert.equal(c.calls.length,0);passed++;console.log('PASS reauthentication before queued dispatch starts no mutation');
 }
 console.log('Admin action identity: '+passed+' checks PASS');
})().catch(error=>{console.error(error);process.exitCode=1;});
