'use strict';
// Execute the real statement engine and workspace export adapter using anonymous
// two-department/two-company journals. No financial service or records are used.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const engine=require('../assets/engines/financial-statements.js'),management=require('../assets/engines/management-report-engine.js');
const source=fs.readFileSync(path.join(__dirname,'../assets/engines/reporting-workspace.js'),'utf8'),anchor='  global.FinanceReportingWorkspace=api;';assert.equal(source.split(anchor).length,2);
const elements={'rpt-ent':{value:'A'},'rpt-month':{value:'2026-09'}},ledger=[];let serial=0;
function pair(eid,dc,date,dr,cr,amount){const id='fixture-'+(++serial);ledger.push({id:id+'d',ref:id,eid,dc,date,ac:dr,dr:amount,cr:0},{id:id+'c',ref:id,eid,dc,date,ac:cr,dr:0,cr:amount});}
pair('A','ADMIN','2026-08-01','1112','3111',1000);pair('A','CARE','2026-09-02','1123','4101',100);pair('A','CARE','2026-09-03','1112','1123',40);pair('A','CARE','2026-09-04','6204','1112',50);pair('A','ADMIN','2026-09-05','6202','1112',100.01);pair('B','CARE','2026-09-01','1112','4101',9000);
const profile={schemaVersion:1,tax:{},accountMappings:{},costCenters:[],budgets:[],allocations:[],eliminations:[],periodChecks:{},documents:{}},calls=[];
const context={console,Map,Set,Intl,document:{getElementById:id=>elements[id],addEventListener(){}},FinanceManagementReportEngine:management};context.window=context;
vm.runInNewContext(source.replace(anchor,'  global.__exportTest={currentSheets,exportWorkbook};\n'+anchor),context);
const runtime={tenant:()=> 'fixture',environment:()=> 'test',user:()=>({id:'manager',authUserId:'fixture-auth'}),role:()=> 'ceo',identityBlocked:()=>false,permissionIdentity:()=> 'allow',today:()=> '2026-09-30',state:()=>({page:'reports'}),entities:()=>[{id:'A',full:'公司甲'},{id:'B',full:'公司乙'}],departments:()=>[{c:'ADMIN',eid:'A',n:'行政部'},{c:'CARE',eid:'A',n:'照護部'}],accounts:()=>[],ledger:()=>ledger,invoices:()=>[],requests:()=>[],completeness:()=>({complete:true,tables:{invoices:{complete:true},expense_requests:{complete:true}}}),statementModel:(eid,period,options)=>engine.buildModel({ledger,entityId:eid,period,completeness:{complete:true},...options}),rpc:async()=>({data:{ok:true,profile,revision:1,canEdit:true,canEditWorkpaper:true}})};
runtime.exportSheets=(eid,period,options)=>{calls.push({eid,period,options});return engine.exportSheets(runtime.statementModel(eid,period,options));};
const api=context.FinanceReportingWorkspace;api.install(runtime);
const value=(sheets,name,label)=>sheets.find(s=>s.name===name).rows.find(r=>r[0]===label)[1];
(async()=>{await api.loadProfile('A');await api.loadProfile('B');api.state.tab='bs';const company=context.__exportTest.currentSheets();api.state.tab='pl';api.state.department='CARE';const selected=context.__exportTest.currentSheets();
assert.equal(value(company,'資產負債表','資產合計'),949.99);assert.equal(value(selected,'資產負債表','資產合計'),949.99);assert.equal(value(company,'現金流量表','期末現金'),889.99);assert.equal(value(selected,'現金流量表','期末現金'),889.99);
assert.equal(value(selected,'綜合損益表','本期損益'),-50.01);assert.equal(value(selected,'部門綜合損益表','本期損益'),50);assert.deepEqual(JSON.parse(JSON.stringify(selected.find(s=>s.name==='部門綜合損益表').rows[0])),['部門損益分析','照護部','CARE']);
for(const name of ['資產負債表','綜合損益表','現金流量表','試算平衡'])assert.deepEqual(selected.find(s=>s.name===name),company.find(s=>s.name===name));
assert.equal(calls.at(-2).options.departmentCode,undefined);assert.equal(calls.at(-1).options.departmentCode,'CARE');
api.state.comparison='year_ago';context.__exportTest.currentSheets();assert(calls.slice(-2).every(c=>c.options.comparisonPeriod==='2025-09'));
let file;context.XLSX={utils:{book_new:()=>({}),aoa_to_sheet:rows=>({rows}),book_append_sheet(){}},writeFile:(_wb,name)=>file=name};context.__exportTest.exportWorkbook();assert.match(file,/公司甲_2026-09_含照護部損益/);
api.state.department='all';const all=context.__exportTest.currentSheets();assert(!all.some(s=>s.name==='部門綜合損益表'));context.__exportTest.exportWorkbook();assert(!file.includes('含照護部'));
console.log('PASS department export: company BS/PL/CF remain complete, separate labeled department P&L, comparison and filename scope, no company leakage');
})().catch(error=>{console.error(error);process.exitCode=1;});
