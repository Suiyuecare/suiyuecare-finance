const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const engine=require('../assets/engines/financial-statements.js');
function extract(name){
 let start=source.indexOf('function '+name+'(');assert.ok(start>=0,name);
 if(source.slice(start-6,start)==='async ')start-=6;
 const lineEnd=source.indexOf('\n',start),first=source.slice(start,lineEnd);
 return first.endsWith('}')?first:source.slice(start,source.indexOf('\n}',lineEnd)+2);
}
let actor='actor1',environment='production',checks=0;
const profile={accountMappings:{},periodChecks:{'2026-09':{ociReviewed:true}}};
const context={Date,console,Promise,Number,Object,String,Array,Math,window:{FinanceFinancialStatements:engine,FinanceReportingWorkspace:{profileFor:()=>({profile})}},ENTS:[{id:'E1'},{id:'E2'}],LEDGER:[],REQS:[],AUDIT_LOGS:[],remoteLoadPromise:null,STATEMENT_SOURCE_STATE:{ledger:{complete:false},invoices:{complete:false},expense_requests:{complete:false}},LIABILITY_ACCOUNT_ALIASES:{AA1:true,AA2:true},approvalFastBootstrapIdentity:()=>actor,currentTenantId:()=> 'tenant1',activeDataEnvironment:()=>environment,inActiveDataEnvironment:r=>(r.dataEnv||'production')===environment,rowTenantId:r=>r.tenantId||'tenant1',todayMonth:()=> '2026-09',gD:dc=>({n:dc,eid:'E1'}),num:v=>Number(v)||0,requestCashPostedAt:r=>r.cashPostedAt||'',requestCashAmount:r=>r.amt,fromIsoDate:v=>String(v||'').slice(0,10),todaySlash:()=> '2026/09/10',withOperationTimeout:async p=>p,ensureRequestCashPostedFromCeo:()=>{throw Error('Reports must not infer/write cash posting state');},sourceByLedgerRef:ref=>({no:ref}),voucherByLedgerRef:ref=>({no:ref}),financeReportEngine:()=>null};
vm.createContext(context);
const names=['statementDataIdentity','statementDataCompleteness','loadStatementSourcePages','statementProfileFor','statementMappingsFor','statementScopedLedger','statementCashEvents','statementCashFlowOverrides','statementReportModel','statementExportSheets','statementProfitLoss','normDate','entityOfDept','reqEntity','ledgerEntity','inEntity','inPeriod','periodStart','periodEnd','ledgerRowsForEntity','ledgerRows','ledgerRowsToPeriodEnd','ledgerRowsBeforePeriod','ledgerRowsForDepartment','hasLedger','isRevAcct','isExpAcct','isAssetAcct','isLiabAcct','isEquityAcct','isCashAcct','acctLabel','addGroup','rowsFromMap','revenueRows','expenseRows','deptExpenseRows','deptRevenueRows','deptNetRows','financeSummary','balanceRows','requestByRef','companyLoanCashFlowKind','isDuplicateRequestCashLedger','requestCashEvents','cashFlow','ledgerTraceRows','statementCashBookBalance','ledgerAmountForKind','ledgerTotalsByKind','ledgerDepartmentComparisonRows','statementCsvCell','statementSheetsCsv'];
vm.runInContext(names.map(extract).join('\n'),context);
const run=text=>vm.runInContext(text,context),plain=v=>JSON.parse(JSON.stringify(v));
function check(name,fn){fn();checks++;console.log('PASS '+name);}
function rows(ref,date,amount,dc='D1'){return [{id:ref+'d',ref,voucherNo:ref,eid:'E1',dc,date,ac:'1112',dr:amount,cr:0},{id:ref+'c',ref,voucherNo:ref,eid:'E1',dc,date,ac:'4101',dr:0,cr:amount}];}
context.LEDGER=rows('prior','2026-08-15',100).concat(rows('current','2026-09-30',50));
check('actual legacy helpers use the common month-end/cumulative/CF calculations',()=>{
 const prior=process.env.TZ;process.env.TZ='Asia/Taipei';
 assert.equal(run("periodEnd('2026-09')"),'2026-09-30');assert.equal(run("balanceRows('E1','2026-09').assetTotal"),150);assert.equal(run("balanceRows('E1','2026-09').equityTotal"),150);assert.equal(run("financeSummary('E1','2026-09').net"),50);assert.equal(run("cashFlow('E1','2026-09').start"),100);assert.equal(run("cashFlow('E1','2026-09').end"),150);
 if(prior==null)delete process.env.TZ;else process.env.TZ=prior;
});
check('actual BS trace includes prior-period ledger evidence',()=>{assert.equal(run("ledgerTraceRows('asset','1112','E1','2026-09').length"),2);});
check('cash book never subtracts posted request ledger lines or mixes unposted forms',()=>{
 context.REQS=[{id:'request1',no:'current',eid:'E1',dc:'D1',cashPostedAt:'2026-09-30',amt:50},{id:'unposted',no:'unposted',eid:'E1',dc:'D1',cashPostedAt:'2026-09-30',amt:20}];
 assert.equal(run("isDuplicateRequestCashLedger(LEDGER[2])"),true);assert.equal(run("statementCashBookBalance('E1','2026-09')"),150);assert.equal(run("cashFlow('E1','2026-09').end"),150);assert.equal(run("cashFlow('E1','2026-09').unpostedCashAmount"),-20);context.REQS=[];
});
check('runtime explicitly scopes tenant, environment and department before modeling',()=>{
 context.LEDGER.push(...rows('other','2026-09-15',900,'D2').map(r=>({...r,tenantId:'tenant2'})),...rows('test','2026-09-15',700,'D2').map(r=>({...r,dataEnv:'test'})));
 assert.equal(run("statementReportModel('E1','2026-09',{departmentCode:'D1'}).current.pl.netProfit"),50);assert.equal(run("statementReportModel('E1','2026-09').current.pl.netProfit"),50);assert.equal(run("financeSummary('E1','2026-09').net"),50);assert.equal(run("balanceRows('E1','2026-09').assetTotal"),150);
});
check('runtime mappings affect OCI and model exports together',()=>{
 context.LEDGER=rows('sale','2026-09-15',100).concat([{eid:'E1',dc:'D1',date:'2026-09-15',ref:'oci',ac:'1510',dr:20,cr:0},{eid:'E1',dc:'D1',date:'2026-09-15',ref:'oci',ac:'3510',dr:0,cr:20}]);profile.accountMappings={3510:{statementClass:'equity',ociCategory:'nonreclassifiable'}};
 assert.equal(run("statementReportModel('E1','2026-09').current.pl.comprehensiveIncome"),120);assert.equal(run("statementExportSheets('E1','2026-09')[1].rows.find(r=>r[0]==='綜合損益總額')[1]"),120);profile.accountMappings={};
});
check('all-company runtime reads distinct entity profiles for legacy and new totals',()=>{
 const original=context.window.FinanceReportingWorkspace.profileFor;
 context.window.FinanceReportingWorkspace.profileFor=eid=>({profile:{accountMappings:eid==='E1'?{3510:{ociCategory:'reclassifiable'}}:{3510:{statementClass:'otherIncome'}}}});
 context.LEDGER=[{eid:'E1',date:'2026-09-15',ac:'1510',dr:20,cr:0},{eid:'E1',date:'2026-09-15',ac:'3510',dr:0,cr:20},{eid:'E2',date:'2026-09-15',ac:'1510',dr:30,cr:0},{eid:'E2',date:'2026-09-15',ac:'3510',dr:0,cr:30}];
 assert.equal(run("statementReportModel('all','2026-09').current.pl.ociTotal"),20);assert.equal(run("statementReportModel('all','2026-09').current.pl.netProfit"),30);assert.equal(run("financeSummary('all','2026-09').net"),30);assert.equal(run("balanceRows('all','2026-09').balanceDifference"),0);
 context.window.FinanceReportingWorkspace.profileFor=original;
});
check('legacy completeness cannot show success when source pagination is incomplete',()=>{
 const sandbox={window:{FinanceV4Engines:{register(){}}}};vm.createContext(sandbox);vm.runInContext(fs.readFileSync(path.join(__dirname,'../assets/engines/report-engine.js'),'utf8'),sandbox);
 const sources={bankAccounts:[{eid:'E1'}],bankTransactions:[{eid:'E1',date:'2026-09-01'}],bankStatementImports:[{eid:'E1',statementPeriod:'2026-09'}],periodCloses:[{eid:'E1',period:'2026-09',status:'closed'}],statementSources:{complete:false}};
 const report=sandbox.window.FinanceReportEngine;assert.ok(report.reportDataCompletenessSummary('E1','2026-09',sources).warnings.some(w=>w.includes('尚未完整載入')));sources.statementSources.complete=true;assert.equal(report.reportDataCompletenessSummary('E1','2026-09',sources).warnings.length,0);
});
check('actual department helper retains negative revenue/expense and every department',()=>{
 context.LEDGER=Array.from({length:12},(_,i)=>rows('sale'+i,'2026-09-15',100,'D'+i)).flat().concat([{date:'2026-09-15',eid:'E1',dc:'D1',ac:'4101',dr:20,cr:0}]);
 assert.equal(run('ledgerDepartmentComparisonRows(LEDGER).length'),12);assert.equal(run("ledgerDepartmentComparisonRows(LEDGER).find(r=>r.dc==='D1').income"),80);assert.equal(run("deptNetRows('E1','2026-09').find(r=>r.dc==='D1').v"),80);
});
check('CSV preserves real newlines/numeric negatives and neutralizes formula text',()=>{
 assert.equal(run('statementCsvCell(-20)'), '"-20"');assert.equal(run('statementCsvCell("=2+2")'),'"\'=2+2"');
 const csv=run("statementSheetsCsv([{name:'試算',rows:[['標題','金額'],['x',20]]}])");assert.equal(csv.split('\n').length,4);assert.equal(csv.includes('\\n'),false);
});
const dashboardNames=['dashboardBundleFromRemote','dashboardRemoteKey','dashboardTrendStart','dashShiftMonth','dashPeriodEnd','dashDateInRange','dashLedgerRows','dashLedgerRowsToEnd','dashMetricSeed','dashMetricAdd','dashMetricFinish','dashTotals','dashMetricDelta','dashMergeMetrics','dashEntityMetrics','dashDepartmentMetrics','dashboardReceivablesAsOf','dashDaysBetween','dashboardTrend','dashboardFinancialBundle','dashboardFinancialReadState','dashDeltaTone','dashPctText','dashDeltaCopy','dashKpiHtml','dashboardRenderKpis','dashboardRenderVerdict','dashboardRenderTrend','dashboardRenderDepartments'];
const nodes={};let online=true,records={E1:{loaded:true,revision:1},E2:{loaded:true,revision:1}};
Object.assign(context,{S:{demoLogin:false,dashDataVersion:1},INVS:[],DASH_REMOTE_AGGREGATES:{},DASH_FINANCIAL_CACHE:{key:'',value:null},hasSupabase:()=>online,gE:id=>({id,s:id,full:id}),fmt:v=>String(v),escAttr:v=>String(v==null?'':v),el:id=>nodes[id]||(nodes[id]={innerHTML:'',textContent:'',style:{}})});
vm.runInContext(dashboardNames.map(extract).join('\n'),context);
const dashboardProfiles={E1:{accountMappings:{3510:{statementClass:'equity',ociCategory:'reclassifiable'},6100:{statementClass:'revenue'},4101:{statementClass:'asset'}}},E2:{accountMappings:{3510:{statementClass:'otherIncome'}}}};
const originalProfile=context.window.FinanceReportingWorkspace.profileFor;
context.window.FinanceReportingWorkspace.profileFor=eid=>dashboardProfiles[eid];
context.window.FinanceReportingWorkspace.profileRecord=eid=>records[eid];
context.window.FinanceReportingWorkspace.warmProfiles=()=>{};
context.scope={mode:'range',eid:'all',from:'2026-09',to:'2026-09',start:'2026-09-01',end:'2026-09-30',prevFrom:'2026-08',prevTo:'2026-08',prevStart:'2026-08-01',prevEnd:'2026-08-31',months:['2026-09']};
context.LEDGER=rows('e1','2026-09-15',100).map(r=>({...r,ac:r.ac==='4101'?'6100':r.ac})).concat([
 {id:'refund',eid:'E1',dc:'D1',date:'2026-09-15',ac:'6100',dr:10,cr:0},
 {id:'oci',eid:'E1',dc:'D1',date:'2026-09-15',ac:'3510',dr:0,cr:20},
 {id:'asset',eid:'E1',dc:'D1',date:'2026-09-15',ac:'4101',dr:0,cr:500},
 {id:'closing',eid:'E1',dc:'D1',date:'2026-09-30',ac:'6100',dr:90,cr:0,sourceType:'period_close'},
 {id:'cost',eid:'E1',dc:'D1',date:'2026-09-15',ac:'6200',dr:25,cr:0},
 {id:'cost-refund',eid:'E1',dc:'D1',date:'2026-09-15',ac:'6200',dr:0,cr:5},
 {id:'e2-income',eid:'E2',dc:'D2',date:'2026-09-15',ac:'3510',dr:0,cr:30},
 {id:'e2-revenue',eid:'E2',dc:'D2',date:'2026-09-15',ac:'4101',dr:0,cr:40},
 {id:'previous',eid:'E1',dc:'D1',date:'2026-08-15',ac:'6100',dr:0,cr:50}
],rows('foreign','2026-09-15',900).map(r=>({...r,tenantId:'tenant2'})),rows('test','2026-09-15',800).map(r=>({...r,dataEnv:'test'})),rows('voided','2026-09-15',700).map(r=>({...r,voided_at:'2026-09-16'})));
context.STATEMENT_SOURCE_STATE.ledger={identity:run('statementDataIdentity()'),complete:true,status:'complete'};
check('dashboard uses distinct entity mappings and excludes OCI/closing while retaining refunds',()=>{
 const b=run('dashboardFinancialBundle(scope)');assert.equal(b.financialReady,true);assert.equal(b.summary.revenue,160);assert.equal(b.summary.expense,20);assert.equal(b.summary.net,140);assert.equal(b.previousSummary.net,50);
 assert.equal(b.summary.net,run("statementReportModel('all','2026-09').current.pl.netProfit"));assert.equal(b.companies.find(r=>r.eid==='E1').net,70);assert.equal(b.departments.find(r=>r.eid==='E2').net,70);assert.equal(b.trend[0].net,140);
});
check('dashboard ledger and cash flow exclude foreign tenants, test rows and voided entries',()=>{
 const b=run('dashboardFinancialBundle(scope)');assert.equal(b.rows.length,10);assert.equal(b.cashFlow.net,100);assert.equal(b.cashFlow.net,run("statementReportModel('all','2026-09').current.cf.net"));
});
check('raw RPC totals cannot replace mapped financial metrics but canonical AR remains authoritative',()=>{
 context.DASH_REMOTE_AGGREGATES[run('dashboardRemoteKey(scope)')]={summary:{revenue:9999,expense:8888,balanceDiff:0,missingSourceCount:0},previousSummary:{revenue:9999},companies:[{entityId:'E1',revenue:9999}],departments:[{entityId:'E1',departmentCode:'D1',revenue:9999}],trend:[{month:'2026-09',revenue:9999}],receivables:{total:321,count:2,buckets:[],items:[]},previousReceivables:{total:300,count:1},reconciliation:{revenue:{officialAmount:9999}},generatedAt:'2026-09-10'};
 const b=run('dashboardFinancialBundle(scope)');assert.equal(b.summary.net,140);assert.equal(b.previousSummary.net,50);assert.equal(b.companies.find(r=>r.eid==='E1').net,70);assert.equal(b.departments.find(r=>r.eid==='E2').net,70);assert.equal(b.trend[0].net,140);assert.equal(b.receivables.total,321);assert.equal(b.previousReceivables.total,300);assert.equal(b.reconciliation.revenue.officialAmount,9999);
});
check('profile changes invalidate cached dashboard classification even with unchanged ledger/RPC',()=>{
 dashboardProfiles.E1.accountMappings[3510]={statementClass:'otherIncome'};records.E1.revision=2;
 assert.equal(run('dashboardFinancialBundle(scope).summary.revenue'),180);assert.equal(run('dashboardFinancialBundle(scope).summary.net'),160);
 dashboardProfiles.E1.accountMappings[3510]={statementClass:'equity',ociCategory:'reclassifiable'};
 assert.equal(run('dashboardFinancialBundle(scope).summary.revenue'),160);
});
check('missing profile blocks financial totals without discarding confirmed canonical AR',()=>{
 records.E2={loaded:false,error:'profile unavailable'};const b=run('dashboardFinancialBundle(scope)');assert.equal(b.financialReady,false);assert.equal(b.companies.length,0);assert.equal(b.trend.length,0);assert.equal(b.cashFlow,null);assert.equal(b.receivables.total,321);assert.match(b.financialMessage,/讀取失敗/);
 context.bundle=b;run('dashboardRenderKpis(bundle);dashboardRenderVerdict(bundle);dashboardRenderTrend(bundle);dashboardRenderDepartments(bundle)');assert.match(nodes['dash-kpis'].innerHTML,/核對中/);assert.match(nodes['dash-kpis'].innerHTML,/321/);assert.equal(nodes['dash-verdict-title'].textContent,'財務資料核對中');assert.doesNotMatch(nodes['dash-trend-chart'].innerHTML,/沒有正式損益/);assert.match(nodes['dash-dept-body'].innerHTML,/讀取失敗/);records.E2={loaded:true,revision:1};
});
check('incomplete ledger and changed actor cannot reuse complete financial dashboard cache',()=>{
 context.STATEMENT_SOURCE_STATE.ledger.complete=false;assert.equal(run('dashboardFinancialBundle(scope).financialReady'),false);
 context.STATEMENT_SOURCE_STATE.ledger.complete=true;assert.equal(run('dashboardFinancialBundle(scope).financialReady'),true);
 actor='other-actor';assert.equal(run('dashboardFinancialBundle(scope).financialReady'),false);actor='actor1';
});
context.window.FinanceReportingWorkspace.profileFor=originalProfile;
context.STATEMENT_SOURCE_STATE.ledger={complete:false,status:'not_loaded'};
(async()=>{
 const data={ledger_entries:Array.from({length:6501},(_,i)=>({id:'l'+i,entry_date:'2026-09-01'})),invoices:Array.from({length:1001},(_,i)=>({id:'i'+i})),expense_requests:[{id:'r1'}]};let queries=[],failAfter=null;
 const client={from(table){const q={table,filters:[],select(columns,options){assert.equal(options.count,'exact');return q;},eq(k,v){q.filters.push([k,v]);return q;},order(k,o){assert.equal(k,'id');assert.equal(o.ascending,true);return q;},range(start,end){queries.push({table,start,end,filters:q.filters});if(failAfter!=null&&start>=failAfter)return Promise.resolve({error:new Error('second page failed')});return Promise.resolve({data:data[table].slice(start,end+1),count:data[table].length});}};return q;}};
 context.client=client;
 assert.equal(run('statementDataCompleteness().complete'),false);
 const ledgerResult=await run("loadStatementSourcePages(client,'ledger_entries')");assert.equal(ledgerResult.data.length,6501);assert.equal(run('statementDataCompleteness().tables.ledger.complete'),true);assert.equal(run('statementDataCompleteness().complete'),false);checks++;console.log('PASS real loader reads every ledger page with exact completeness state');
 await run("loadStatementSourcePages(client,'invoices')");await run("loadStatementSourcePages(client,'expense_requests')");assert.equal(run('statementDataCompleteness().complete'),true);for(const q of queries)assert.deepEqual(q.filters,[['tenant_id','tenant1'],['data_environment','production']]);checks++;console.log('PASS invoices/requests are paginated with explicit tenant/environment filters');
 failAfter=1000;const oldLedger=JSON.stringify(context.LEDGER);const failed=await run("loadStatementSourcePages(client,'ledger_entries')");assert.equal(failed.data,null);assert.equal(run('statementDataCompleteness().tables.ledger.status'),'error');assert.equal(run('statementDataCompleteness().complete'),false);assert.equal(JSON.stringify(context.LEDGER),oldLedger);checks++;console.log('PASS failed pagination cannot publish partial rows or certify stale data');
 actor='actor2';assert.equal(run('statementDataCompleteness().tables.invoices.complete'),false);assert.equal(run('statementDataCompleteness().tables.invoices.status'),'not_loaded');checks++;console.log('PASS identity changes invalidate all prior source completeness');
 failAfter=null;context.window.FinanceFinancialStatements=null;const missing=await run("loadStatementSourcePages(client,'ledger_entries')");assert.ok(missing.error);assert.equal(missing.data,null);context.window.FinanceFinancialStatements=engine;checks++;console.log('PASS missing engine never falls back to a silently capped financial read');
 console.log('OK: '+checks+' actual financial runtime behavior checks');
})().catch(error=>{console.error(error);process.exitCode=1;});
