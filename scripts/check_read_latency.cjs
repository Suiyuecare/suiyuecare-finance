'use strict';
// Real read/paint functions with anonymous, explicitly controlled transports.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),{performance}=require('node:perf_hooks');
const {fixture}=require('./check_dashboard_financial_sources.cjs');
const source=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
function extract(name){const m=new RegExp('^(?:async )?function '+name+'\\(','m').exec(source);assert(m,name);return source.slice(m.index,source.indexOf('\n}',m.index)+2);}
const pause=ms=>new Promise(r=>setTimeout(r,ms));let passed=0;function check(s){passed++;console.log('PASS '+s);}
(async()=>{
 for(const [table,key,page] of [['vouchers','VOUCHERS','vouchers'],['expense_requests','REQS','expenses'],['bills','BILLS','bills'],['invoices','INVS','invoices']]){
  let finish;const tail=new Promise(r=>finish=r),c=fixture({transport:q=>q.table===table?Promise.resolve({data:[{id:'visible',data_environment:'production'}],count:1}):q.table==='bank_transactions'?tail:null});c.S.page=page;
  const broad=c.performRemoteDataLoad();for(let i=0;c[key].length===0&&i<100;i++)await pause(1);
  assert.equal(c[key][0].id,'visible');assert.equal(c.lastSyncAt,'');
  if(table==='vouchers')c.VOUCHERS=[{id:'newer-after-user-action'}];else c[key][0].updatedPurpose='newer-user-edit';
  finish({data:[],count:0});assert.equal(await broad,true);
  if(table==='vouchers')assert.equal(c.VOUCHERS[0].id,'newer-after-user-action');else assert.equal(c[key][0].updatedPurpose,'newer-user-edit');
  check(table+' publishes before unrelated bank read; final broad completion cannot replay an older voucher result');
 }
 {
  let finish;const read=new Promise(r=>finish=r),c=fixture({transport:q=>q.table==='vouchers'?read:null});c.S.page='vouchers';const broad=c.performRemoteDataLoad();await pause(1);c.S.user.authUserId='other';finish({data:[{id:'wrong-identity'}],count:1});await broad;assert.equal(c.VOUCHERS.length,0);check('early publication rejects an identity change');
 }
 for(const [table,key] of [['expense_requests','REQS'],['bills','BILLS'],['invoices','INVS'],['vouchers','VOUCHERS']]){
  for(const mode of ['edit','insert','delete','unchanged-cache']){
   let resolve,hit=false;const pending=new Promise(r=>resolve=r),c=fixture({transport:q=>q.table===table?(hit=true,pending):null});
   c[key]=mode==='insert'?[]:[{id:'same',ver:1,desc:'cached',data_environment:'production'}];
   const broad=c.performRemoteDataLoad();for(let i=0;!hit&&i<100;i++)await pause(1);assert(hit);
   if(mode==='edit')c[key][0].ver=3;
   if(mode==='insert')c[key]=[{id:'same',ver:3,desc:'new confirmed row',data_environment:'production'}];
   if(mode==='delete')c[key]=[];
   resolve({data:[{id:'same',ver:2,desc:'read snapshot',data_environment:'production'}],count:1});assert.equal(await broad,true);
   if(mode==='delete')assert.equal(c[key].length,0);else assert.equal(c[key][0].ver,mode==='unchanged-cache'?2:3);
   check(table+' pending read preserves '+mode+' without retaining unchanged stale cache');
  }
 }
 for(const [table,key,field] of [['expense_requests','REQS','requests'],['bills','BILLS','bills'],['invoices','INVS','invoices']]){
  let resolve,hit=false;const pending=new Promise(r=>resolve=r),c=fixture({transport:q=>q.table===table?Promise.resolve({data:[{id:'same',ver:1}],count:1}):null,fallback:async rows=>{hit=true;await pending;return rows}});const broad=c.performRemoteDataLoad();for(let i=0;!hit&&i<100;i++)await pause(1);assert(hit);assert.equal(c[key].length,1);c[key]=[];resolve();await broad;assert.equal(c[key].length,0);check(table+' deletion during fallback cannot resurrect an early-published row');
 }
 for(const mutate of [c=>c.S.user.role='employee',c=>c.environment='test',c=>c.financeWorkspaceIdentityBlocked=true,c=>c.CURRENT_PERMISSION_SNAPSHOT.permissions=['revoked']]){
  let resolve,hit=false;const d=new Promise(r=>resolve=r),c=fixture({transport:q=>q.table==='vouchers'?(hit=true,d):null});const broad=c.performRemoteDataLoad();for(let i=0;!hit&&i<100;i++)await pause(1);assert(hit);mutate(c);resolve({data:[{id:'late-unauthorized'}],count:1});assert.equal(await broad,false);assert.equal(c.VOUCHERS.length,0);check('scope, role, workspace lock or permission changes reject a late early-source publication');
 }
 {
  const c=fixture(),starts=[];const jobs=Array.from({length:22},(_,i)=>async()=>{starts.push(i);return i;});const result=await c.runFinanceBootstrapReadJobs(jobs,true,4);assert.equal(starts.find(i=>![0,5,7,8,16,18].includes(i)),4);assert.deepEqual(Array.from(result),jobs.map((_,i)=>i));check('visible source is first in the wide lane without changing result positions');
 }
 {
  const c={window:{},FINANCE_DOCUMENT_LIBRARY_READS:{},Promise,Error,setTimeout,clearTimeout,scripts:[]};c.document={head:{appendChild(s){c.scripts.push(s)}},createElement(){return {dataset:{},remove(){this.removed=true}}}};vm.createContext(c);vm.runInContext(extract('ensureFinanceDocumentLibrary'),c);
  const a=c.ensureFinanceDocumentLibrary('xlsx'),b=c.ensureFinanceDocumentLibrary('xlsx');assert.equal(a,b);assert.equal(c.scripts.length,1);c.window.XLSX={read(){},utils:{}};c.scripts[0].onload();await a;await c.ensureFinanceDocumentLibrary('xlsx');assert.equal(c.scripts.length,1);check('concurrent document operations share one load; ready library needs no network');
  const fail=c.ensureFinanceDocumentLibrary('pdf');c.scripts[1].onerror();await assert.rejects(fail,/原始資料仍保留/);assert.equal(c.scripts[1].removed,true);const retry=c.ensureFinanceDocumentLibrary('pdf');c.window.PDFLib={PDFDocument:{}};c.scripts[2].onload();await retry;check('failed document library cleans up and supports an explicit retry');
  await assert.rejects(c.ensureFinanceDocumentLibrary('arbitrary'),/不支援/);assert.equal(c.scripts.length,3);check('document loader accepts only pinned allowlisted libraries');
 }
 {
  let read=false;const c={Promise,Error,window:{},ensureFinanceDocumentLibrary:async()=>{throw Error('network')},FileReader:function(){read=true}};vm.createContext(c);vm.runInContext(extract('readSpreadsheetRows'),c);await assert.rejects(c.readSpreadsheetRows({name:'report.xlsx'}),/network/);assert.equal(read,false);check('Excel library failure cannot parse binary XLSX as text or discard the original file');
 }
 {
  const c={S:{page:'vouchers'},calls:[],document:{},el:id=>({id})};for(const name of ['normalizeRequestFlows','updateApprovalTodoBadge','renderFinanceNotificationBadge','updateRecvSidebarBadge','updateModuleTodoBadge','syncMobileNavSelect','startSearchableSelectObserver','startMobileEnhancer','buildDash','buildExp','buildApprovals','buildNotifs','buildUsers','buildOrgChart','buildSettings','buildCompliance','buildReports','renderLedger','renderAccounts','buildShareholderCapital','buildInvoices','buildBills','buildRecv','renderVouchers','buildSystemHealth'])c[name]=()=>c.calls.push(name);c.financeNotificationView=()=>({});c.enhanceLongSelects=c.enhanceMobileTables=root=>assert.equal(root.id,'pg-vouchers');vm.createContext(c);vm.runInContext(extract('buildAll'),c);c.buildAll();assert(c.calls.includes('renderVouchers'));for(const name of ['buildDash','buildExp','buildApprovals','buildNotifs','buildUsers'])assert(!c.calls.includes(name));assert(c.calls.includes('updateApprovalTodoBadge'));check('source refresh renders only the active workspace while keeping navigation counts updated');
 }
 {
  const started=performance.now();let arrived;const c=fixture({transport:q=>q.table==='vouchers'?new Promise(r=>setTimeout(()=>{arrived=performance.now()-started;r({data:[{id:'v'}],count:1})},20)):q.table==='bank_transactions'?new Promise(r=>setTimeout(()=>r({data:[],count:0}),3400)):null});c.S.page='vouchers';const broad=c.performRemoteDataLoad();while(!c.VOUCHERS.length)await pause(1);const usable=performance.now()-started;assert(usable<3000);await broad;console.log('TIMING '+JSON.stringify({scope:'Controlled 20ms voucher + unrelated 3400ms bank transport; actual source loader',voucherResponseMs:arrived,usableMs:usable,broadMs:performance.now()-started}));check('visible voucher no longer inherits the unrelated 3.4-second bank delay');
 }
 {
  const c=fixture();let rpcCalls=0,restCalls=0,payload={ok:true,source:'bills',tenantId:'tenant-a',dataEnvironment:'production',limit:1000,offset:0,total:1,rows:[{id:'b',tenant_id:'tenant-a',data_environment:'production'}],hasMore:false};
  c.isRpcMissing=e=>e.code==='PGRST202';const client={rpc:async()=>{rpcCalls++;return {data:payload}},from(){restCalls++;throw Error('unexpected fallback')}};
  assert.equal((await c.loadFinanceDocumentSourcePage(client,'bills','tenant-a','production',0,999)).count,1);assert.equal(restCalls,0);check('single-pass source page keeps an exact count and validated tenant/environment');
  for(const change of [{tenantId:'other'},{dataEnvironment:'test'},{total:null},{hasMore:true},{offset:1},{rows:[{id:'x',tenant_id:'other',data_environment:'production'}]}]){const old=payload;payload={...old,...change};await assert.rejects(c.loadFinanceDocumentSourcePage(client,'bills','tenant-a','production',0,999));payload=old;}
  assert.equal(restCalls,0);check('malformed RPC scope or count never falls back to a broad read');
  client.rpc=async()=>({error:{code:'42501',message:'denied'}});assert.equal((await c.loadFinanceDocumentSourcePage(client,'bills','tenant-a','production',0,999)).error.code,'42501');assert.equal(restCalls,0);check('permission denial remains denied with no fallback');
  client.rpc=async()=>({error:{code:'PGRST202',message:'function not deployed'}});let q;q={select:()=>q,eq:()=>q,order:()=>q,range:()=>q,then:r=>Promise.resolve({data:[],count:0}).then(r)};client.from=()=>{restCalls++;return q};assert.equal((await c.loadFinanceDocumentSourcePage(client,'bills','tenant-a','production',0,999)).count,0);assert.equal(restCalls,1);check('only missing-RPC compatibility uses the existing scoped exact-count query');
 }
 console.log('OK: '+passed+' read latency checks');
})().catch(e=>{console.error(e);process.exitCode=1});
