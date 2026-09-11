'use strict';
const assert=require('node:assert/strict');
const engine=require('../assets/engines/management-report-engine.js');
const reviewed={status:'reviewed',reviewedBy:'accountant-fixture',reviewedAt:'2026-09-10T01:00:00Z',effectiveFrom:'2026-09-01',effectiveTo:null};
const rule={...reviewed,id:'shared',name:'共同費用',sourceDepartmentCode:'ADMIN',accountCodes:['6202'],basis:'headcount',targets:[{departmentCode:'A',weight:0.5},{departmentCode:'B',weight:0.5}]};
const profiles={F1:{costCenters:[{departmentCode:'ADMIN',kind:'shared'}],allocations:[rule],budgets:[{...reviewed,id:'rev',period:'2026-09',departmentCode:'A',accountCode:'4101',amount:200},{...reviewed,id:'exp',period:'2026-09',departmentCode:'A',accountCode:'6202',amount:60}]}};
const ledger=[{id:'rev',eid:'F1',dc:'A',ac:'4101',cr:100,date:'2026-09-30'},{id:'allowance',eid:'F1',dc:'A',ac:'4101',dr:20,date:'2026-09-30'},{id:'cost',eid:'F1',dc:'ADMIN',ac:'6202',dr:100.01,date:'2026-09-30'}];
let model=engine.build({profiles,ledger,start:'2026-09-01',end:'2026-09-30'});
assert.equal(model.rows.find(x=>x.departmentCode==='A').revenue,80);
assert.equal(model.rows.find(x=>x.departmentCode==='A').allocationIn,50.01);
assert.equal(model.rows.find(x=>x.departmentCode==='B').allocationIn,50);
assert.equal(model.rows.find(x=>x.departmentCode==='ADMIN').profitAfterAllocation,0);
assert.equal(model.allocationNet,0);
assert.equal(model.rows.find(x=>x.departmentCode==='A').budgetProfit,140);
assert.equal(model.rows.find(x=>x.departmentCode==='A').budgetVariance,-110.01);
assert.equal(model.rows.find(x=>x.departmentCode==='B').budgetVariance,null,'unknown budget is not zero');
assert.equal(engine.distribute(-100.01,rule.targets).reduce((s,r)=>s+Math.round(r.amount*100),0),-10001,'refund allocation conserves the signed amount in cents');
model=engine.build({profiles:{F1:{allocations:[rule,{...rule,id:'duplicate'}]}},ledger,start:'2026-09-01',end:'2026-09-30'});
assert.equal(model.allocationEntries.length,0);assert.ok(model.warnings.some(x=>x.code==='overlapping_allocation'));
assert.equal(engine.build({profiles:{F1:{allocations:[{...rule,status:'draft'}]}},ledger,start:'2026-09-01',end:'2026-09-30'}).allocationEntries.length,0,'draft rules do not alter management amounts');
const elimination={...reviewed,id:'intercompany',name:'往來核對',counterpartyEntityId:'F2',period:'2026-09',lines:[{entityId:'F1',departmentCode:'A',accountCode:'4101',debit:80,sourceRef:'INV-1'},{entityId:'F2',departmentCode:'B',accountCode:'6202',credit:80,sourceRef:'EXP-1'}]};
assert.equal(engine.eliminationLedger({profiles:{F1:{eliminations:[elimination]},F2:{}},start:'2026-09-01',end:'2026-09-30'}).rows.length,2);
assert.equal(engine.eliminationLedger({entityId:'F1',profiles:{F1:{eliminations:[elimination]},F2:{}},start:'2026-09-01',end:'2026-09-30'}).rows.length,0);
assert.equal(engine.eliminationLedger({profiles:{F1:{eliminations:[elimination]}},start:'2026-09-01',end:'2026-09-30'}).rows.length,0,'missing counterparty profile blocks elimination');
const costOnly=engine.build({profiles:{F1:{costCenters:[{departmentCode:'ADMIN',kind:'cost'}],budgets:[{...reviewed,id:'cost-budget',period:'2026-09',departmentCode:'ADMIN',accountCode:'6202',amount:120}]}},ledger:[{id:'expense',eid:'F1',dc:'ADMIN',ac:'6202',dr:100,date:'2026-09-20'}],start:'2026-09-01',end:'2026-09-30'}).rows[0];
assert.equal(costOnly.budgetComplete,true);assert.equal(costOnly.budgetVariance,20,'cost center expense budget does not require a fabricated revenue budget');assert.equal(costOnly.budgetVarianceBasis,'expense_after_allocation');
const missingSide=engine.build({profiles:{F1:{budgets:[{...reviewed,id:'sep-income',period:'2026-09',departmentCode:'A',accountCode:'4101',amount:100},{...reviewed,id:'oct-cost',period:'2026-10',departmentCode:'A',accountCode:'6202',amount:20}]}},ledger:[],start:'2026-09-01',end:'2026-10-31'}).rows[0];assert.equal(missingSide.budgetComplete,false,'a different side in each month is not a complete profit budget');assert.equal(missingSide.budgetVariance,null);
const duplicatePair=engine.eliminationLedger({profiles:{F1:{eliminations:[elimination]},F2:{eliminations:[{...elimination,counterpartyEntityId:'F1',lines:elimination.lines.map(l=>({...l,debit:l.debit?70:0,credit:l.credit?70:0}))}]}},start:'2026-09-01',end:'2026-09-30'});assert.equal(duplicatePair.rows.length,0,'conflicting mirror copy must not apply whichever sorts first');assert.equal(duplicatePair.applied.length,0);assert.equal(duplicatePair.warnings.filter(w=>w.code==='duplicate_elimination').length,1);
console.log('Management report engine: signed movements, rounding, draft/reviewed, overlap, budgets and elimination scope PASS');
let monthlyChecks=0;
function monthlyCheck(name,fn){fn();monthlyChecks++;console.log('PASS '+name);}
function budgetModel(change={},range={start:'2026-09-01',end:'2026-09-30'}){return engine.build({profiles:{F1:{costCenters:[{departmentCode:'A',kind:'cost'}],budgets:[{...reviewed,id:'monthly-budget',period:'2026-09',departmentCode:'A',accountCode:'6202',amount:300,...change}]}},ledger:[{id:'month-cost',eid:'F1',dc:'A',ac:'6202',dr:100,date:'2026-09-20'}],...range});}
monthlyCheck('full-month reviewed budget applies exactly, without daily proration',()=>{
 const m=budgetModel({effectiveFrom:'2026-08-15',effectiveTo:'2026-09-30'});assert.equal(m.rows[0].budgetExpense,300);assert.equal(m.rows[0].budgetVariance,200);assert.equal(m.warnings.length,0);
});
monthlyCheck('mid-month start, mid-month end and uncovered month warn instead of silently applying or dropping budgets',()=>{
 for(const change of [{effectiveFrom:'2026-09-15'},{effectiveTo:'2026-09-29'},{effectiveFrom:'2026-10-01'},{effectiveTo:'2026-08-31'}]){
  const m=budgetModel(change);assert.equal(m.rows[0].budgetExpense,null);assert.equal(m.rows[0].budgetVariance,null);assert.equal(m.warnings.length,1);assert.match(m.warnings[0].message,/2026-09.*未套用，需調整生效期間／另建核定月額/);
 }
});
monthlyCheck('leap-year February requires coverage through February 29',()=>{
 const range={start:'2024-02-01',end:'2024-02-29'},common={period:'2024-02',effectiveFrom:'2024-02-01'};
 assert.equal(budgetModel({...common,effectiveTo:'2024-02-28'},range).warnings.length,1);
 const valid=budgetModel({...common,effectiveTo:'2024-02-29'},range);assert.equal(valid.warnings.length,0);assert.equal(valid.rows[0].budgetExpense,300);
});
monthlyCheck('quarter coverage keeps valid monthly amounts and flags only incomplete target months',()=>{
 const budgets=['07','08','09'].map(m=>({...reviewed,id:'budget-'+m,period:'2026-'+m,departmentCode:'A',accountCode:'6202',amount:300,effectiveFrom:'2026-'+m+(m==='08'?'-15':'-01')}));
 const m=engine.build({profiles:{F1:{costCenters:[{departmentCode:'A',kind:'cost'}],budgets}},ledger:[],start:'2026-07-01',end:'2026-09-30'});assert.equal(m.rows[0].budgetExpense,600);assert.equal(m.rows[0].budgetComplete,false);assert.equal(m.rows[0].budgetVariance,null);assert.equal(m.warnings.length,1);assert.equal(m.warnings[0].period,'2026-08');
});
monthlyCheck('monthly elimination has the same full-month policy and one warning across its two passes',()=>{
 for(const change of [{effectiveFrom:'2026-09-15'},{effectiveTo:'2026-09-29'}]){
  const m=engine.eliminationLedger({profiles:{F1:{eliminations:[{...elimination,...change}]},F2:{}},start:'2026-09-01',end:'2026-09-30'});assert.equal(m.rows.length,0);assert.equal(m.applied.length,0);assert.equal(m.warnings.length,1);assert.match(m.warnings[0].message,/未套用，需調整生效期間／另建核定月額/);
 }
 assert.equal(engine.eliminationLedger({profiles:{F1:{eliminations:[{...elimination,effectiveTo:'2026-09-30'}]},F2:{}},start:'2026-09-01',end:'2026-09-30'}).rows.length,2);
});
monthlyCheck('same monthly rule ID across companies retains each company warning',()=>{
 const b={...reviewed,id:'same',period:'2026-09',departmentCode:'A',accountCode:'6202',amount:300,effectiveFrom:'2026-09-15'};
 const m=engine.build({profiles:{F1:{budgets:[b]},F2:{budgets:[b]}},ledger:[],start:'2026-09-01',end:'2026-09-30'});assert.equal(m.warnings.length,2);assert.deepEqual(m.warnings.map(w=>w.entityId),['F1','F2']);
});
monthlyCheck('daily allocations retain their actual transaction effective dates and never rewrite reviewed profiles',()=>{
 const p={F1:{allocations:[{...rule,effectiveFrom:'2026-09-15'}],budgets:[{...reviewed,id:'keep-reviewed',period:'2026-09',departmentCode:'A',accountCode:'6202',amount:300,effectiveFrom:'2026-09-15'}],eliminations:[{...elimination,effectiveTo:'2026-09-15'}]},F2:{}};const before=JSON.stringify(p);
 const m=engine.build({profiles:p,ledger:[{id:'before',eid:'F1',dc:'ADMIN',ac:'6202',dr:100,date:'2026-09-14'},{id:'after',eid:'F1',dc:'ADMIN',ac:'6202',dr:100,date:'2026-09-15'}],start:'2026-09-01',end:'2026-09-30'});assert.equal(m.allocationEntries.length,2);assert.ok(m.allocationEntries.every(e=>e.sourceId==='after'));assert.equal(m.allocationNet,0);engine.eliminationLedger({profiles:p,start:'2026-09-01',end:'2026-09-30'});assert.equal(JSON.stringify(p),before);
});
console.log('OK: '+monthlyChecks+' monthly policy behavior checks');
