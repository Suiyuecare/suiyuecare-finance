'use strict';
// Exercise the shipped Realtime dispatcher with fictional, counted reads.
// No production credentials, network, or database writes are used.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
function extract(name){
  const match=new RegExp('^(?:async )?function '+name+'\\(','m').exec(source);
  assert(match,'shipped function '+name);
  return source.slice(match.index,source.indexOf('\n}',match.index)+2);
}
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function deferred(){let resolve;const promise=new Promise(r=>{resolve=r});return{promise,resolve};}
function fixture(options={}){
  const c={Date,Promise,JSON,Object,Array,String,Number,Math,Error,console:{warn(){}},
    S:{user:{id:'finance-a',authUserId:'auth-a',role:'accountant'},authEpoch:1,demoLogin:false,page:'dashboard'},
    CURRENT_PERMISSION_SNAPSHOT:{loaded:true,permissions:['read']},financeWorkspaceIdentityBlocked:false,
    REALTIME_SCOPED_REFRESHES:{},REALTIME_SCOPED_SOURCE_REVISIONS:{},REALTIME_SCOPED_REFRESH_ERRORS:{},
    REMOTE_BOOTSTRAP_LIMITS:{optional:1200},APPROVAL_FAST_BOOTSTRAP:{identity:'tenant-a|auth:auth-a',verified:true,tasksVerified:true,hydrated:true,summaryFingerprint:'same',verifiedSummaryFingerprint:'same'},
    remoteRefreshPromise:null,remoteRefreshIdentity:'',remoteRefreshReason:'',remoteRefreshQueued:false,remoteRefreshApprovalDirty:false,remoteRefreshApprovalInFlight:false,remoteRefreshApprovalRevision:0,remoteRefreshTimerResolve:null,syncTimer:null,
    realtimeChannel:null,systemSettingsRealtimeTimer:null,permissionRuntimeRealtimeTimer:null,permissionRuntimeRealtimePending:false,permissionRuntimeRefreshRunning:false,SYSTEM_SETTINGS_REALTIME_UPDATES:{},
    ARCHIVES:[{id:'archive-old'}],ANNUAL_REVIEWS:[{id:'review-old'}],BACKUP_EVENTS:[{id:'backup-old'}],SETTINGS_VERSIONS:[{id:'version-old'}],
    calls:[],readWidths:[],handlers:{},status:[],pending:[],built:0,broad:0,recovery:0,notificationState:{promise:null},draftState:{promise:null},draftOptions:[],lastSyncAt:'2026-10-02T00:00:00Z',lastSyncWarning:'',issues:[],retryTimers:[]};
  c.tenant='tenant-a';c.environment='production';
  c.setTimeout=(fn,ms)=>{if(ms>=15000){const timer={fn,ms,cancelled:false};c.retryTimers.push(timer);return timer;}return setTimeout(fn,Math.min(ms,2));};
  c.clearTimeout=timer=>{if(timer&&typeof timer==='object'&&'cancelled'in timer)timer.cancelled=true;else clearTimeout(timer);};
  c.transport=options.transport||((table)=>({data:[{id:table+'-new',tenant_id:c.tenant,data_environment:c.environment}],error:null}));
  const client={from(table){const q={table,select(){return this},order(){return this},limit(){return this},then(resolve,reject){c.calls.push(table);return Promise.resolve().then(()=>c.transport(table,c)).then(resolve,reject)}};return q;},channel(){return{on(_,filter,fn){c.handlers[filter.table]=fn;return this},subscribe(){return this}}},removeChannel:async()=>{}};
  Object.assign(c,{window:{},hasSupabase:()=>true,getSb:()=>client,currentTenantId:()=>c.tenant,activeDataEnvironment:()=>c.environment,
    statementDataIdentity:()=>[c.S.user&&c.S.user.authUserId,c.tenant,c.environment].join('|'),approvalFastBootstrapIdentity:()=>[c.tenant,'auth:'+(c.S.user&&c.S.user.authUserId)].join('|'),normalizedRoleKey:user=>user.role,
    dashboardFinancialSourceIdentity:()=>[c.S.user&&c.S.user.authUserId,c.S.user&&c.S.user.id,c.S.user&&c.S.user.role,c.tenant,c.environment,c.financeWorkspaceIdentityBlocked].join('|'),
    financeNotificationState:()=>c.notificationState,draftReadinessForCurrentUser:()=>c.draftState,
    loadFinanceNotifications:()=>{const pending=Promise.resolve(client.from('notifications').select('*')).then(result=>result.error?{error:result.error}:{data:result.data,error:null});c.notificationState.promise=pending;return pending.finally(()=>{if(c.notificationState.promise===pending)c.notificationState.promise=null})},
    loadCurrentUserDrafts:opts=>{c.draftOptions.push(opts);const pending=Promise.resolve(client.from('draft_requests').select('*')).then(result=>result.error?{error:result.error,complete:false}:{data:result.data,error:null,complete:true});c.draftState.promise=pending;return pending.finally(()=>{if(c.draftState.promise===pending)c.draftState.promise=null})},
    applyRemoteLimit:q=>q,queueFinanceBootstrapRead:(job,wide)=>{c.readWidths.push(wide);return job()},financeBootstrapRead:q=>Promise.resolve(q),inActiveDataEnvironment:row=>(row.data_environment||row.dataEnv||'production')===c.environment,
    mapComplianceArchive:row=>row,mapAnnualReview:row=>row,mapBackupEvent:row=>row,mapSettingVersion:row=>row,
    buildCompliance:()=>{c.built++},renderSettingVersions:()=>{c.built++},setTopSyncStatus:value=>c.status.push(value),syncStatusText:()=>c.syncWarningCount()?'部分資料未同步':'即時同步',
    recordRemoteReadIssue:(table,error)=>c.issues.push([table,String(error&&error.message||error)]),isTransientRemoteReadError:error=>/timeout/i.test(String(error&&error.message||error)),
    markApprovalRealtimeRowPending:(table,payload)=>c.pending.push([table,payload]),invalidateFinanceUsersDirectoryReadiness:()=>{c.identityInvalidations=(c.identityInvalidations||0)+1},setSubmissionIdentitySyncing:()=>{c.identityLocks=(c.identityLocks||0)+1},
    loadRemoteData:async()=>{c.broad++;c.calls.push('ledger_entries');return true},loadApprovalFastBootstrap:async()=>{c.recovery++;return{hydrated:true}},approvalMutationRuntimeReady:()=>true,
    initFilters:()=>{},buildAll:()=>{c.built++},buildApprovals:()=>{},approvalFastShouldHoldSkeleton:()=>false,clearRemoteRecovery:()=>{},scheduleRemoteRecovery:()=>{},approvalRenderLoadingStateIfAvailable:()=>{}});
  vm.createContext(c);
  vm.runInContext(['syncWarningCount','realtimeScopedRefreshKind','realtimeEventInCurrentScope','realtimeScopedRefreshIdentity','readRealtimeScopedSource','refreshRealtimeScopedSource','remoteDataReadIdentity','refreshRemoteData','startRealtime','stopRealtime'].map(extract).join('\n'),c);
  c.startRealtime();
  c.emit=(table,payload={new:{id:'event',tenant_id:c.tenant,data_environment:c.environment}})=>{assert(c.handlers[table],table);c.handlers[table](payload)};
  return c;
}
async function run(){
  let passed=0;const check=label=>{passed++;console.log('PASS '+label)};
  {
    const c={Date,String,Object,hasSupabase:()=>true,lastSyncAt:'2026-10-02T00:00:00Z',lastSyncWarning:'',
      REALTIME_SCOPED_REFRESH_ERRORS:{annual_reviews:'permission denied'},REALTIME_SCOPED_REFRESHES:{},
      remoteRecoveryTimer:null,remoteRecoveryAttempts:0,REMOTE_RECOVERY_MAX_ATTEMPTS:3,
      approvalMutationRuntimeReady:()=>true,remoteRefreshApprovalDirty:false,remoteRefreshApprovalInFlight:false};
    vm.createContext(c);
    vm.runInContext([extract('syncWarningCount'),extract('syncStatusText')].join('\n'),c);
    assert.match(c.syncStatusText(),/部分資料未同步/);
    assert.doesNotMatch(c.syncStatusText(),/背景補載中/);
    c.REALTIME_SCOPED_REFRESHES.annual_reviews={retryTimer:{}};
    assert.match(c.syncStatusText(),/背景補載中/);
    check('a permanent scoped failure never masquerades as an active background retry');
  }
  {
    const c=fixture();
    for(const table of ['notifications','draft_requests','compliance_archives','annual_reviews','backup_restore_events','system_setting_versions'])assert(c.realtimeScopedRefreshKind(table));
    for(const table of ['expense_requests','invoices','bills','ledger_entries','vouchers','finance_users','period_closes','payee_bank_accounts','finance_portal_roles'])assert.equal(c.realtimeScopedRefreshKind(table),'');
    check('only owner-scoped and non-authority optional tables use the narrow lane');
  }
  for(const table of ['notifications','draft_requests','compliance_archives','annual_reviews','backup_restore_events','system_setting_versions']){
    const c=fixture();c.emit(table);await pause(15);
    assert.deepEqual(c.calls,[table],table+' should read exactly one source');
    assert.equal(c.broad,0,table+' must not read the ledger or all 22 sources');
    assert.equal(c.pending.length,1);
    if(c.realtimeScopedRefreshKind(table)==='optional')assert.deepEqual(c.readWidths,[true],'optional reads share the single wide-read lane');
    if(table==='draft_requests')assert.equal(c.draftOptions[0].force,true);
    if(table==='compliance_archives')assert.equal(c.ARCHIVES[0].id,table+'-new');
    if(table==='annual_reviews')assert.equal(c.ANNUAL_REVIEWS[0].id,table+'-new');
    if(table==='backup_restore_events')assert.equal(c.BACKUP_EVENTS[0].id,table+'-new');
    if(table==='system_setting_versions')assert.equal(c.SETTINGS_VERSIONS[0].id,table+'-new');
    check(table+' event reads only its own source');
  }
  {
    const c=fixture();c.emit('notifications');c.emit('notifications');c.emit('notifications');await pause(15);
    assert.deepEqual(c.calls,['notifications']);assert.equal(c.broad,0);
    check('a Realtime burst coalesces to one notification read');
  }
  {
    const first=deferred();let reads=0;
    const c=fixture({transport:table=>table==='notifications'&&++reads===1?first.promise:{data:[],error:null}});
    c.emit('notifications');await pause(8);assert.equal(reads,1);
    c.emit('notifications');first.resolve({data:[],error:null});await pause(20);
    assert.equal(reads,2);assert.equal(c.broad,0);
    check('an event arriving during a read receives a fresh trailing read');
  }
  for(const table of ['notifications','draft_requests']){
    const old=deferred(),c=fixture();
    if(table==='notifications')c.notificationState.promise=old.promise;else c.draftState.promise=old.promise;
    c.emit(table);await pause(8);assert.equal(c.calls.length,0);
    old.resolve({data:[],error:null});await pause(15);
    assert.deepEqual(c.calls,[table]);assert.equal(c.broad,0);
    check(table+' waits for a pre-event read, then verifies a fresh result');
  }
  {
    const c=fixture();c.emit('notifications',{new:{id:'other',tenant_id:'tenant-b',data_environment:'production'}});
    c.emit('draft_requests',{new:{id:'test',tenant_id:'tenant-a',data_environment:'test'}});
    await pause(10);assert.equal(c.calls.length,0);
    check('known foreign tenant and environment changes cannot read or publish another scope');
  }
  {
    const c=fixture();c.S.user.role='employee';c.emit('backup_restore_events');await pause(10);
    assert.equal(c.calls.length,0);assert.equal(c.broad,0);
    check('staff without accounting access do not start protected optional reads');
  }
  {
    const held=deferred(),c=fixture({transport:table=>table==='annual_reviews'?held.promise:{data:[],error:null}});
    c.emit('annual_reviews');await pause(8);c.S.user.authUserId='auth-b';held.resolve({data:[{id:'old-private',tenant_id:'tenant-a',data_environment:'production'}],error:null});await pause(10);
    assert.equal(c.ANNUAL_REVIEWS[0].id,'review-old');assert.equal(c.broad,0);
    check('late old-account data is not published after an identity switch');
  }
  {
    let malformed=true;const c=fixture({transport:table=>table==='compliance_archives'&&malformed?{data:null,error:null}:{data:[],error:null}});
    c.emit('compliance_archives');await pause(12);
    assert.equal(c.ARCHIVES[0].id,'archive-old');assert(c.REALTIME_SCOPED_REFRESH_ERRORS.compliance_archives);assert.equal(c.broad,0);
    malformed=false;c.emit('compliance_archives');await pause(12);
    assert.equal(c.ARCHIVES.length,0);assert.equal(c.REALTIME_SCOPED_REFRESH_ERRORS.compliance_archives,undefined);
    check('failed read retains prior rows and warning; only confirmed empty clears them');
  }
  {
    let timedOut=true;const c=fixture({transport:table=>table==='backup_restore_events'&&timedOut?{data:null,error:{message:'statement timeout'}}:{data:[],error:null}});
    c.emit('backup_restore_events');await pause(12);
    assert.equal(c.BACKUP_EVENTS[0].id,'backup-old');assert.equal(c.retryTimers.length,1);assert.equal(c.broad,0);
    timedOut=false;c.retryTimers[0].fn();await pause(12);
    assert.deepEqual(c.calls,['backup_restore_events','backup_restore_events']);assert.equal(c.BACKUP_EVENTS.length,0);assert.equal(c.REALTIME_SCOPED_REFRESH_ERRORS.backup_restore_events,undefined);
    check('transient optional failure retries its own table without starting a full ledger read');
  }
  {
    const c=fixture();c.emit('finance_users');await pause(15);
    assert.equal(c.broad,1);assert.equal(c.identityInvalidations,1);assert.equal(c.identityLocks,1);assert(c.calls.includes('ledger_entries'));
    check('staff and permission changes retain the full identity-safety refresh');
  }
  {
    const c=fixture();c.emit('expense_requests');await pause(15);
    assert.equal(c.broad,1);assert.equal(c.recovery,1);assert.equal(c.pending.length,1);
    check('approval source changes retain exact membership re-verification');
  }
  for(const table of ['ledger_entries','vouchers','period_closes','payee_bank_accounts','finance_portal_roles']){
    const c=fixture();c.emit(table);await pause(15);
    assert.equal(c.broad,1);assert(c.calls.includes('ledger_entries'));
    check(table+' retains the full accounting or authorization refresh');
  }
  {
    const c=fixture();c.emit('notifications');await c.stopRealtime();await pause(10);
    assert.equal(c.calls.length,0);assert.equal(Object.keys(c.REALTIME_SCOPED_REFRESHES).length,0);
    check('logout or account switch cancels an unstarted scoped read');
  }
  console.log('OK: '+passed+' Realtime source-scoping checks passed');
}
module.exports={run};
if(require.main===module)run().catch(error=>{console.error(error);process.exitCode=1});
