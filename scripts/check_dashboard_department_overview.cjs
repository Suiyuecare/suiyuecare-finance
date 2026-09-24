'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
function extract(name){
 const start=source.indexOf('function '+name+'(');assert(start>=0,name);
 const end=source.indexOf('\n',start),first=source.slice(start,end);
 return first.endsWith('}')?first:source.slice(start,source.indexOf('\n}',end)+2);
}
const nodes={},context={S:{dashMonth:'2026-08',dashPeriodMode:'month',dashDeptSort:'risk',dashDeptDir:'asc'},ENTS:[{id:'E1',s:'公司一',full:'公司一',color:'#ea880c'},{id:'E2',s:'公司二',full:'公司二',color:'#2a9040'}],Date,Math,Number,String,Object,Array,
 todayMonth:()=> '2026-09',num:v=>Number(v)||0,fmt:v=>'NT$'+Number(v).toLocaleString('en-US'),
 escAttr:v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
 gD:dc=>({n:dc==='D4'?'照護收入課':dc}),ledgerEntity:r=>r.eid,
 ledgerAmountForKind:(r,kind)=>kind==='income'&&r.ac==='4101'?r.cr-r.dr:kind==='expense'&&r.ac==='6200'?r.dr-r.cr:0,
 el:id=>nodes[id]||(nodes[id]={innerHTML:'',textContent:'',style:{},attributes:{},setAttribute(k,v){this.attributes[k]=v;}}),
 window:{FinanceReportingWorkspace:{profileFor:()=>({})}},dashMarkSort(){},dashTableChange:()=>'<span>比較</span>',buildDash(){},DASH_COMPANY_COLOR_FALLBACKS:['#888888']};
context.gE=id=>context.ENTS.find(e=>e.id===id)||{};
vm.createContext(context);
const run=code=>vm.runInContext(code,context);
const functions=['dashValidMonth','ensureDashboardState','dashMetricSeed','dashMetricAdd','dashMetricFinish','dashMetricDelta','dashMergeMetrics','dashDepartmentMetrics','dashSortRows','dashSafeCompanyColor','dashDepartmentGroups','dashDepartmentCenterKind','dashMarginText','dashMobileMetricRow','dashboardRenderDepartments'];
run(functions.map(extract).join('\n'));
run(source.split('\n').find(line=>line.startsWith('window.resetDashPeriod=function')));
let checks=0;
function check(name,fn){fn();checks++;console.log('PASS '+name);}
context.rows=[
 {eid:'E1',dc:'D1',ac:'6200',dr:100,cr:0},{eid:'E1',dc:'D2',ac:'6200',dr:200,cr:0},{eid:'E1',dc:'D3',ac:'6200',dr:300,cr:0},
 {eid:'E1',dc:'D4',ac:'4101',dr:0,cr:1200},{eid:'E2',dc:'D4',ac:'4101',dr:0,cr:300},{eid:'E2',dc:'D4',ac:'6200',dr:50,cr:0}
];
run('ensureDashboardState();bundle={financialReady:true,departments:dashDepartmentMetrics(rows,[])}');
check('the complete overview includes the revenue department after three loss departments',()=>{
 const groups=run('dashDepartmentGroups(bundle.departments)');assert.equal(context.S.dashDeptExpanded,true);
 assert.equal(groups[0].rows.length,4);assert.equal(groups[0].visibleRows.length,4);assert.equal(groups[0].visibleRows[3].dc,'D4');
 assert.equal(groups[0].revenue,1200);assert.equal(groups[0].expense,600);assert.equal(groups[0].net,600);
 assert.equal(groups[1].revenue,300);assert.equal(groups[1].expense,50);assert.equal(groups[1].net,250);
});
check('desktop and mobile show all departments and the same three company totals',()=>{
 run('dashboardRenderDepartments(bundle)');
 assert.equal((nodes['dash-dept-body'].innerHTML.match(/class="dash-department-row"/g)||[]).length,5);
 assert.equal((nodes['dash-dept-mobile'].innerHTML.match(/<details /g)||[]).length,5);
 for(const id of ['dash-dept-body','dash-dept-mobile']){
  const html=nodes[id].innerHTML;assert.match(html,/收入 <b class="income">NT\$1,200<\/b>/);assert.match(html,/支出 <b class="expense">NT\$600<\/b>/);assert.match(html,/淨利 <b class="profit">NT\$600<\/b>/);
  assert.match(html,/4 \/ 4 個部門/);assert.match(html,/全部部門小計/);
 }
 assert.equal(nodes['dash-dept-count'].textContent,'顯示 5 / 5 個部門 · 2 間公司');
 assert.equal(nodes['dash-dept-toggle'].attributes['aria-expanded'],'true');
});
check('explicit collapse labels the hidden department without changing company totals',()=>{
 context.S.dashDeptExpanded=false;run('ensureDashboardState();dashboardRenderDepartments(bundle)');
 assert.equal(context.S.dashDeptExpanded,false);assert.equal((nodes['dash-dept-body'].innerHTML.match(/class="dash-department-row"/g)||[]).length,4);
 assert.match(nodes['dash-dept-body'].innerHTML,/顯示 3 \/ 4 個部門/);assert.match(nodes['dash-dept-mobile'].innerHTML,/3 \/ 4 個部門/);
 assert.match(nodes['dash-dept-body'].innerHTML,/收入 <b class="income">NT\$1,200<\/b>/);
 assert.equal(nodes['dash-dept-count'].textContent,'顯示 4 / 5 個部門 · 2 間公司');
 assert.equal(nodes['dash-dept-toggle'].textContent,'顯示全部（5 個部門）');assert.equal(nodes['dash-dept-toggle'].attributes['aria-expanded'],'false');
});
check('reset returns to a complete department overview',()=>{
 run('window.resetDashPeriod();dashboardRenderDepartments(bundle)');assert.equal(context.S.dashDeptExpanded,true);
 assert.equal((nodes['dash-dept-body'].innerHTML.match(/class="dash-department-row"/g)||[]).length,5);
});
console.log('PASS dashboard department overview: '+checks+' checks');
