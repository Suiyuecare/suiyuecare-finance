'use strict';
// Exercise the shipped cross-account read latches without credentials or writes.
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const source=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
function extract(name){
  const match=new RegExp('^(?:async )?function '+name+'\\(','m').exec(source);
  assert(match,'shipped function '+name);
  return source.slice(match.index,source.indexOf('\n}',match.index)+2);
}
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject};}
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(predicate){for(let i=0;i<100;i++){if(predicate())return;await pause(2)}assert.fail('expected request did not start');}
function fixture(){
  const c={Date,Promise,JSON,Object,String,Number,Error,setTimeout:(fn,ms)=>setTimeout(fn,ms>=750?2:ms),clearTimeout,
    console:{warn(){}},S:{user:{id:'employee-a',authUserId:'auth-a',role:'accountant'},demoLogin:false},
    financeAuthIdentityEpoch:1,financeWorkspaceIdentityBlocked:false,
    remoteLoadPromise:null,remoteLoadIdentity:'',remoteRefreshPromise:null,remoteRefreshIdentity:'',remoteRefreshReason:'',remoteRefreshQueued:false,
    remoteRefreshApprovalDirty:false,remoteRefreshApprovalInFlight:false,remoteRefreshApprovalRevision:0,remoteRefreshTimerResolve:null,syncTimer:null,
    APPROVAL_FAST_BOOTSTRAP:{identity:'tenant|auth:auth-a',verified:true,tasksVerified:true,hydrated:true,summaryFingerprint:'same',verifiedSummaryFingerprint:'same'},
    calls:[],statuses:[],builds:0,invalidations:0};
  Object.assign(c,{hasSupabase:()=>true,realtimeScopedRefreshKind:()=>'',
    dashboardFinancialSourceIdentity:()=>JSON.stringify([c.S.user.authUserId,c.S.user.id,c.S.user.role,c.financeWorkspaceIdentityBlocked]),
    approvalFastBootstrapIdentity:()=>`tenant|auth:${c.S.user.authUserId}`,
    invalidateDashboardFinancialCache:()=>c.invalidations++,setTopSyncStatus:text=>c.statuses.push(text),
    approvalMutationRuntimeReady:()=>true,initFilters:()=>{},buildAll:()=>{c.builds++},
    approvalFastShouldHoldSkeleton:()=>false,buildApprovals:()=>{},syncStatusText:()=>'',
    scheduleRemoteRecovery:()=>{},clearRemoteRecovery:()=>{},approvalRenderLoadingStateIfAvailable:()=>{},
    loadApprovalFastBootstrap:async()=>({hydrated:true})});
  vm.createContext(c);
  vm.runInContext(['remoteDataReadIdentity','loadRemoteData','refreshRemoteData'].map(extract).join('\n'),c);
  return c;
}
async function run(){
  let passed=0;const check=label=>{passed++;console.log('PASS '+label)};
  {
    const c=fixture(),old=deferred(),newer=deferred();
    c.performRemoteDataLoad=()=>{const owner=c.S.user.authUserId;c.calls.push(owner);return owner==='auth-a'?old.promise:newer.promise};
    const oldResult=c.loadRemoteData({preserveDashboardAggregate:true});
    c.S.user={id:'employee-b',authUserId:'auth-b',role:'accountant'};
    const newResult=c.loadRemoteData({preserveDashboardAggregate:true});
    assert.deepEqual(c.calls,['auth-a','auth-b'],'new account must start without joining old read');
    const newPending=c.remoteLoadPromise;
    old.resolve(false);assert.equal(await oldResult,false);
    assert.equal(c.remoteLoadPromise,newPending,'old cleanup must not detach new read');
    assert.match(c.remoteLoadIdentity,/auth-b/);
    newer.resolve(true);assert.equal(await newResult,true);
    assert.equal(c.remoteLoadPromise,null);assert.equal(c.remoteLoadIdentity,'');
    check('new account begins its own broad read immediately; old completion cannot clear its latch');
  }
  {
    const c=fixture(),old=deferred(),newer=deferred();
    c.performRemoteDataLoad=()=>{const owner=c.S.user.authUserId;c.calls.push(owner);return owner==='auth-a'?old.promise:newer.promise};
    const oldResult=c.loadRemoteData({preserveDashboardAggregate:true});
    c.financeAuthIdentityEpoch=2;c.S.user.role='ceo';
    const newResult=c.loadRemoteData({preserveDashboardAggregate:true});
    assert.deepEqual(c.calls,['auth-a','auth-a'],'a new auth/role epoch requires a fresh authority read');
    c.financeWorkspaceIdentityBlocked=true;
    assert.equal(await c.loadRemoteData({preserveDashboardAggregate:true}),false,'locked workspace must not reuse either request');
    old.resolve(false);newer.resolve(true);await Promise.all([oldResult,newResult]);
    check('token/role changes invalidate shared reads and identity lock refuses reuse');
  }
  {
    const c=fixture(),old=deferred(),newer=deferred();
    c.loadRemoteData=()=>{const owner=c.S.user.authUserId;c.calls.push(owner);return owner==='auth-a'?old.promise:newer.promise};
    const oldRun=c.refreshRemoteData('ledger_entries');
    await until(()=>c.calls.includes('auth-a'));
    c.S.user={id:'employee-b',authUserId:'auth-b',role:'accountant'};
    c.APPROVAL_FAST_BOOTSTRAP.identity='tenant|auth:auth-b';
    const newRun=c.refreshRemoteData('ledger_entries');
    await until(()=>c.calls.includes('auth-b'));
    const newPending=c.remoteRefreshPromise;
    old.reject(new Error('old account timed out'));
    assert.equal(await oldRun,false);
    assert.equal(c.remoteRefreshPromise,newPending,'old cleanup must not clear new refresh');
    assert(!c.statuses.includes('同步失敗，請重新整理'),'old failure must not repaint new account status');
    newer.resolve(true);assert.equal(await newRun,true);
    assert.equal(c.remoteRefreshPromise,null);
    check('new account refresh bypasses old 20-second read and ignores its late failure');
  }
  {
    const c=fixture();
    c.loadRemoteData=async()=>{c.calls.push(c.S.user.authUserId);return true};
    const oldRun=c.refreshRemoteData('ledger_entries');
    c.S.user={id:'employee-b',authUserId:'auth-b',role:'accountant'};
    c.APPROVAL_FAST_BOOTSTRAP.identity='tenant|auth:auth-b';
    const newRun=c.refreshRemoteData('ledger_entries');
    const [oldResult,newResult]=await Promise.all([oldRun,newRun]);
    assert.equal(oldResult,false,'retired old refresh cannot claim the new read');
    assert.equal(newResult,true,'new account owns its refresh result');
    assert.deepEqual(c.calls,['auth-b'],'retired debounce must not start old-account I/O');
    check('account switch during debounce cancels the queued old request');
  }
  console.log(`OK: ${passed} account-switch latency and identity checks passed`);
}
if(require.main===module)run().catch(error=>{console.error(error);process.exitCode=1});
