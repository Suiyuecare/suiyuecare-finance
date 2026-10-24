'use strict';
// Actual index handlers and read scheduler; fictional transport, no employee session.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {fixture}=require('./check_dashboard_financial_sources.cjs');
const source=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
function extract(name){let start=source.indexOf('function '+name+'(');assert(start>=0,name);if(source.slice(start-6,start)==='async ')start-=6;const end=source.indexOf('\n',start);return source.slice(start,end).endsWith('}')?source.slice(start,end):source.slice(start,source.indexOf('\n}',end)+2);}
const pause=ms=>new Promise(r=>setTimeout(r,ms)),clone=x=>JSON.parse(JSON.stringify(x));let passed=0;
function check(label){passed++;console.log('PASS '+label);}
function deferredFixture(options={}){
 const c=fixture(options);Object.assign(c,{FINANCE_DEFERRED_DOCUMENT_SOURCES:{},sourceCompleteness:{},surfaces:[],canAccessPage:p=>c.forbiddenPage!==p,escAttr:String});
 c.S.user.role='section_chief';c.S.page='dashboard';c.S.demoLogin=false;
 c.setApprovalSourceCompleteness=(table,value)=>c.sourceCompleteness[table]=value;
 vm.runInContext(['financeInlineJsString','resetDeferredFinanceDocumentSources','financeDocumentSourcesForPage','financeDeferredDocumentState','financeDocumentSourceReady','financeDeferredDocumentResult','financeDeferredDocumentStatusHtml','financeDocumentRows','loadDeferredFinanceDocumentSource','ensureDeferredFinanceDocumentSources','approvalRemoteSourceResultComplete'].map(extract).join('\n'),c);
 c.refreshDeferredFinanceDocumentSurface=table=>c.surfaces.push(table);
 const retry=source.slice(source.indexOf('window.retryDeferredFinanceDocumentSource='),source.indexOf('\n};',source.indexOf('window.retryDeferredFinanceDocumentSource='))+3);vm.runInContext(retry,c);
 return c;
}
(async()=>{
 for(const role of ['employee','class','section_chief','department_head','hr']){
  const c=deferredFixture({transport:q=>['expense_requests','bills','invoices'].includes(q.table)?new Promise(()=>{}):null});c.S.user.role=role;
  const started=Date.now();assert.equal(await Promise.race([c.performRemoteDataLoad(),pause(500).then(()=>{throw Error('Employee startup waited for complete documents')})]),true);
  assert(!c.queries.some(q=>['expense_requests','bills','invoices'].includes(q.table)));assert(!c.statementDataCompleteness().complete);assert(!c.financeDocumentSourceReady('expense_requests'));assert.equal(c.financeDeferredDocumentResult('expense_requests').data,null);assert.equal(c.sourceCompleteness.expense_requests,false);check(role+' login avoids three blocked sources and preserves unknown completeness in '+(Date.now()-started)+'ms');
 }
 for(const role of ['accountant','ceo','admin_director','external_audit','board','shareholder']){
  const c=deferredFixture();c.S.user.role=role;assert.equal(await c.performRemoteDataLoad(),true);for(const table of ['expense_requests','bills','invoices'])assert(c.queries.some(q=>q.table===table));assert(c.statementDataCompleteness().complete);assert.equal(c.LEDGER[0].id,'new');check(role+' retains complete authoritative financial sources and verified ledger');
 }
 for(const [page,table] of [['expenses','expense_requests'],['bills','bills'],['invoices','invoices'],['recv','invoices']]){
  const c=deferredFixture();c.S.page=page;c.ensureDeferredFinanceDocumentSources(page);const read=c.financeDeferredDocumentState(table).promise;assert(read);assert.equal(await read.then(r=>!!r.error),false);assert.equal(c.queries.filter(q=>['expense_requests','bills','invoices'].includes(q.table)).length,1);assert(c.financeDocumentSourceReady(table));assert.equal(c.financeDeferredDocumentState(table).total,0);check(page+' reads only its own complete source and accepts verified empty total');
 }
 {
  let resolve;const blocked=new Promise(r=>resolve=r),c=deferredFixture({transport:q=>q.table==='expense_requests'?blocked:null});c.S.page='expenses';c.REQS=[{id:'known',ver:1,data_environment:'production'}];
  const a=c.loadDeferredFinanceDocumentSource(c.getSb(),'expense_requests'),b=c.loadDeferredFinanceDocumentSource(c.getSb(),'expense_requests',{force:true});assert.equal(a,b);for(let i=0;!c.queries.length&&i<30;i++)await pause(1);c.REQS[0].ver=3;resolve({data:[{id:'known',ver:2,data_environment:'production'}],count:1});await a;assert.equal(c.REQS[0].ver,3);assert(c.financeDocumentSourceReady('expense_requests'));assert.equal(c.queries.length,1);check('concurrent list reads share transport and preserve a confirmed edit made while pending');
 }
 {
  let failure=true;const c=deferredFixture({transport:q=>q.table==='bills'?Promise.resolve(failure?{data:null,error:{code:'57014',message:'statement timeout'}}:{data:[],count:0,error:null}):null});c.S.page='bills';c.BILLS=[{id:'known'}];await c.loadDeferredFinanceDocumentSource(c.getSb(),'bills');assert(!c.financeDocumentSourceReady('bills'));assert.equal(c.BILLS[0].id,'known');assert.match(c.financeDeferredDocumentStatusHtml('bills'),/重試讀取紀錄/);c.ensureDeferredFinanceDocumentSources('bills');assert.equal(c.queries.length,1,'painting a failed list must not retry');failure=false;await c.window.retryDeferredFinanceDocumentSource('bills');assert(c.financeDocumentSourceReady('bills'));assert.equal(c.BILLS.length,0);check('timeout retains known rows, stays incomplete, and requires an explicit successful retry');
 }
 for(const change of [c=>c.S.user.authUserId='other-auth',c=>c.S.user.id='other-person',c=>c.tenant='other-tenant',c=>c.environment='test',c=>c.S.user.role='employee',c=>c.CURRENT_PERMISSION_SNAPSHOT.permissions=['changed'],c=>c.financeWorkspaceIdentityBlocked=true,c=>c.resetDeferredFinanceDocumentSources()]){
  let resolve;const blocked=new Promise(r=>resolve=r),c=deferredFixture({transport:q=>q.table==='invoices'?blocked:null});c.S.page='invoices';c.INVS=[{id:'known'}];const read=c.loadDeferredFinanceDocumentSource(c.getSb(),'invoices');for(let i=0;!c.queries.length&&i<30;i++)await pause(1);change(c);resolve({data:[{id:'late-old'}],count:1});assert((await read).stale);assert.equal(c.INVS[0].id,'known');assert(!c.financeDeferredDocumentState('invoices').complete);
 }
 check('person, Auth UUID, tenant, environment, role, permission, lock and reset reject late source publication');
 {
  const c=deferredFixture();c.ensureDeferredFinanceDocumentSources('dashboard');c.ensureDeferredFinanceDocumentSources('newreq');c.ensureDeferredFinanceDocumentSources('approvals');assert.equal(c.queries.length,0);assert((await c.window.retryDeferredFinanceDocumentSource('invoices')).skipped);c.S.page='invoices';c.forbiddenPage='invoices';assert((await c.window.retryDeferredFinanceDocumentSource('invoices')).skipped);await assert.rejects(c.loadDeferredFinanceDocumentSource(c.getSb(),'auth.users'),/不支援/);assert.equal(c.queries.length,0);check('history, forms, unauthorized routes and unknown sources cannot start full reads');
 }
 {
  const c=deferredFixture();const unverified=c.financeDeferredDocumentResult('expense_requests');assert(!c.approvalRemoteSourceResultComplete(unverified,2500));c.financeDeferredDocumentState('expense_requests').complete=true;assert(c.approvalRemoteSourceResultComplete(c.financeDeferredDocumentResult('expense_requests'),2500));c.S.user.authUserId='other';assert(!c.approvalRemoteSourceResultComplete(unverified,2500));check('deferred metadata never certifies empty or another identity as complete');
 }
 {
  const c=deferredFixture();c.S.page='approvals';c.APPROVAL_FAST_BOOTSTRAP={status:'fallback',identity:c.approvalFastBootstrapIdentity()};c.ensureDeferredFinanceDocumentSources('approvals');await Promise.all(['expense_requests','bills','invoices'].map(t=>c.financeDeferredDocumentState(t).promise));assert.equal(c.queries.filter(q=>['expense_requests','bills','invoices'].includes(q.table)).length,3);assert.equal(c.APPROVAL_FAST_BOOTSTRAP.verified,undefined,'loading source data alone must not manufacture verified approval authority');check('summary fallback reads complete sources only on the approval page and keeps action authority unverified');
 }
 console.log('OK: '+passed+' deferred document startup checks passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
