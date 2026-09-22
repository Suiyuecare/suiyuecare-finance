'use strict';
// Synthetic transport/DOM. Executes the actual host loading, rendering and export guards.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),{createRequire}=require('node:module');
const basePath=path.join(__dirname,'check_dashboard_financial_sources.cjs');
const seed={require:createRequire(basePath),__dirname,console,setTimeout,clearTimeout,AbortController};
vm.runInNewContext(fs.readFileSync(basePath,'utf8').split('async function run(){')[0]+'\nglobalThis.testApi={fixture,extract};',seed);
const {fixture,extract}=seed.testApi,source=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
function exported(name){const start=source.indexOf('window.'+name+'=');assert(start>=0,name);return source.slice(start,source.indexOf('\n};',start)+3);}
const helperNames=['financeAccountingReadReady','financeAccountingReadMessage','requireFinanceAccountingRead','paintFinanceAccountingUnavailable','rejectFinanceAccountingRead'];
function scoped(options={}){
 const c=fixture(options),nodes=new Map(),alerts=[];
 Object.assign(c,{FINANCE_ACCOUNTING_DENIED_IDENTITY:'',WeakMap,POSTED_ACCOUNTING_VIEWS:new WeakMap(),hasSupabase:()=>true,alerts,alert:t=>alerts.push(t),escAttr:String,el:id=>{if(!nodes.has(id))nodes.set(id,{innerHTML:'STALE-SALARY',textContent:'old',style:{display:'flex'},open:true,close(){this.open=false;},getContext:()=>null});return nodes.get(id);}});
 c.window.FinanceReportingWorkspace={invalidate(){c.reportingInvalidated=true;}};c.window.FinanceAuditWorkspace={invalidate(){c.auditInvalidated=true;}};
 vm.runInContext(helperNames.map(extract).join('\n'),c);c.nodes=nodes;return c;
}
let passed=0;async function test(label,run){await run();passed++;console.log('PASS '+label);}
(async()=>{
 await test('actual 42501 core read clears cached salary rows and dialogs and keeps completeness false',async()=>{
  const c=scoped({transport:q=>q.table==='ledger_entries'?Promise.resolve({data:null,error:{code:'42501',message:'FINANCE_HR_COMPLETE_REPORT_AUTHORIZATION_REQUIRED'}}):null});
  c.VOUCHERS=[{id:'old-salary-voucher'}];c.S.ledgerInvestorRows=[{id:'old-salary-line'}];c.S.restorePackage={data:{ledger:['old']}};
  const result=await c.loadDashboardFinancialSources(true);assert.equal(result.ok,false);assert.equal(c.LEDGER.length,0);assert.equal(c.VOUCHERS.length,0);assert.equal(c.S.ledgerInvestorRows.length,0);assert.equal(c.S.restorePackage,null);assert.equal(c.financeAccountingReadReady(),false);assert.equal(c.statementDataCompleteness().tables.ledger.complete,false);assert(c.reportingInvalidated&&c.auditInvalidated);
  for(const id of ['m-voucher-body','finance-report-dialog','finance-audit-dialog'])assert.equal(c.el(id).innerHTML,'');
 });
 await test('real broad reload throws on denied vouchers instead of preserving loaded arrays',async()=>{
  const c=scoped({transport:q=>q.table==='vouchers'?Promise.resolve({data:null,error:{code:'42501',message:'denied'}}):null});c.VOUCHERS=[{id:'old'}];
  await assert.rejects(c.performRemoteDataLoad(),e=>e.code==='42501');assert.equal(c.LEDGER.length,0);assert.equal(c.VOUCHERS.length,0);assert.equal(c.financeAccountingReadReady(),false);
 });
 await test('a complete successful broad reload is required to release the denied latch',async()=>{
  let denied=true;const c=scoped({transport:q=>denied&&q.table==='vouchers'?Promise.resolve({data:null,error:{code:'42501',message:'denied'}}):null});
  await assert.rejects(c.performRemoteDataLoad());denied=false;await c.loadDashboardFinancialSources(true);assert.equal(c.financeAccountingReadReady(),false,'ledger alone must not release a denied voucher scope');assert.equal(await c.performRemoteDataLoad(),true);assert.equal(c.financeAccountingReadReady(),true);assert.equal(c.FINANCE_ACCOUNTING_DENIED_IDENTITY,'');
 });
 await test('timeout does not masquerade as a permissions revocation and incomplete data stays blocked',async()=>{
  const c=scoped();assert.equal(c.rejectFinanceAccountingRead({code:'CLIENT_TIMEOUT',message:'timeout'}),false);assert.equal(c.LEDGER.length,1);assert.equal(c.financeAccountingReadReady(),false);
 });
 await test('ledger, vouchers, compliance and account usage show unverified state rather than cached numbers or false zeros',async()=>{
  const c=scoped();c.FINANCE_ACCOUNTING_DENIED_IDENTITY=c.statementDataIdentity();
  vm.runInContext([extract('renderLedger'),exported('renderVouchers'),exported('buildCompliance'),extract('renderAccountingControlCenter'),extract('accountUsageMap'),extract('accountUsageSummary')].join('\n'),c);
  c.renderLedger();c.window.renderVouchers();c.window.buildCompliance();c.renderAccountingControlCenter('A','2026-09');
  for(const id of ['ldg-kpis','ldg-tbody','voucher-stats','voucher-list','comp-kpis','accounting-control-center']){assert.match(c.el(id).innerHTML,/授權尚未取得/);assert(!c.el(id).innerHTML.includes('STALE-SALARY'));}
  const usage=c.accountUsageSummary({},{});assert.equal(usage.total,null);assert.equal(usage.used,true);assert.match(usage.main,/尚未核對/);assert.equal(c.el('l-count').textContent,'尚未核對');
 });
 const actions=['exportAuditLogs','openReportTraceModal','openReportVoucherModal','openStatementLedgerDept','showVoucherById','openLedgerEntryModal','exportAccountingControlCSV','downloadBackupPackage','closeAccountingPeriod','createAdjustmentVoucher','archivePeriodDocuments','exportAnnualPackage','approveAnnualReview','exportLedger','exportReports','exportVoucherCSV','exportInvoiceStatementBridge'];
 for(const name of actions)await test(name+' refuses before any download, modal or write',async()=>{
  const c=scoped();c.FINANCE_ACCOUNTING_DENIED_IDENTITY=c.statementDataIdentity();vm.runInContext(exported(name),c);await c.window[name]('fixture');assert.equal(c.alerts.length,1);assert.match(c.alerts[0],/授權尚未取得/);
 });
 await test('direct backup construction rejects incomplete cached data',()=>{const c=scoped();vm.runInContext(extract('buildBackupPackage'),c);assert.throws(()=>c.buildBackupPackage(),/完整帳務資料尚未核對/);});
 await test('forced aggregate denial removes the previous successful amount cache',async()=>{
  const c=scoped();Object.assign(c,{DASH_REMOTE_IDENTITY:'same',DASH_REMOTE_AGGREGATES:{key:{summary:{balanceDiff:987654321}}},DASH_REMOTE_ERRORS:{},DASH_REMOTE_PENDING:{},DASH_REMOTE_EPOCH:0,DASH_REMOTE_SEQUENCE:0,DASH_REMOTE_TIMEOUT_MS:1000,DASH_FINANCIAL_CACHE:{},dashboardRemoteIdentity:()=> 'same',dashboardRemoteKey:()=> 'key',dashboardScope:()=>({eid:'all'}),isFinance:()=>true,clearDashboardRemoteReads(){this.DASH_REMOTE_AGGREGATES={};},dashboardTrendStart:()=> '2026-01-01',getSb:()=>({rpc:async()=>({error:{code:'42501',message:'denied'}})})});
  vm.runInContext(extract('ensureRemoteDashboardAggregate'),c);let reads=0;c.getSb=()=>({rpc:async()=>{reads++;return {error:{code:'42501',message:'denied'}};}});c.invalidateDashboardFinancialCache=()=>{c.DASH_REMOTE_AGGREGATES={};c.DASH_REMOTE_ERRORS={};};c.buildDash=()=>{c.ensureRemoteDashboardAggregate({eid:'all'});};c.S.page='dashboard';await c.ensureRemoteDashboardAggregate({eid:'all'},{force:true});await new Promise(r=>setTimeout(r,0));assert.equal(reads,1,'denial repaint must not retry forever');assert.equal(c.DASH_REMOTE_AGGREGATES.key,undefined);assert.equal(c.financeAccountingReadReady(),false);
 });
 console.log(JSON.stringify({ok:true,total:passed,transport:'synthetic; actual index functions; no cloud writes'}));
})().catch(error=>{console.error(error);process.exitCode=1;});
