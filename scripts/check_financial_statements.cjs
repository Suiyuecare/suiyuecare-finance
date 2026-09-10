const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const engine=require('../assets/engines/financial-statements.js');
let checks=0;
function check(name,fn){fn();checks++;console.log('PASS '+name);}
let serial=0;
function tx(date,entries,extra={}){const ref='F-'+(++serial);return entries.map(([ac,dr,cr])=>({...extra,id:ref+'-'+ac,ref,voucherNo:ref,eid:extra.eid||'E1',dc:extra.dc||'D1',date,ac,an:ac,dr,cr}));}
const ready={ociReviewed:true,openingBalanceVerified:true,bankReconciled:true,taxReconciled:true,periodCloseReady:true};
const model=(ledger,extra={})=>engine.buildModel({ledger,entityId:'E1',period:'2026-09',completeness:{complete:true},checks:ready,...extra});
check('month/quarter/leap-year cutoff is independent of client timezone',()=>{
 const old=process.env.TZ;
 for(const tz of ['Asia/Taipei','UTC','America/Los_Angeles']){process.env.TZ=tz;assert.deepEqual(engine.periodBounds('2026-09'),{start:'2026-09-01',end:'2026-09-30'});assert.equal(engine.periodBounds('2026-Q3').end,'2026-09-30');assert.equal(engine.periodBounds('2024-02').end,'2024-02-29');}
 if(old==null)delete process.env.TZ;else process.env.TZ=old;
 assert.throws(()=>engine.periodBounds('2026-13'),/Invalid/);
});
check('comparison periods cross year and quarter boundaries',()=>{assert.equal(engine.previousPeriod('2026-01'),'2025-12');assert.equal(engine.previousPeriod('2026-Q1'),'2025-Q4');assert.equal(engine.previousPeriod('2026'),'2025');assert.equal(engine.previousPeriod('all'),null);});
check('last-day posted transaction appears in BS, PL and CF consistently',()=>{
 const m=model(tx('2026-09-30',[['1112',100,0],['4101',0,100]]));
 assert.equal(m.current.bs.assetTotal,100);assert.equal(m.current.bs.equityTotal,100);assert.equal(m.current.pl.netProfit,100);assert.equal(m.current.cf.end,100);assert.equal(m.current.trialBalance.ok,true);
});
check('unclosed profit is cumulative, with genuine comparison-period figures',()=>{
 const m=model(tx('2026-08-15',[['1112',100,0],['4101',0,100]]).concat(tx('2026-09-15',[['1112',50,0],['4101',0,50]])));
 assert.equal(m.current.bs.assetTotal,150);assert.equal(m.current.bs.equityTotal,150);assert.equal(m.current.bs.unclosedProfit,150);assert.equal(m.current.pl.netProfit,50);assert.equal(m.previous.pl.netProfit,100);assert.equal(m.changes.netProfit.amount,-50);assert.equal(m.current.cf.start,100);assert.equal(m.current.cf.end,150);
});
check('actual closing journals reduce residual profit without erasing period profit',()=>{
 const ledger=tx('2026-08-15',[['1112',100,0],['4101',0,100]]).concat(tx('2026-08-31',[['4101',100,0],['3440',0,100]],{sourceType:'period_close'}),tx('2026-09-15',[['1112',50,0],['4101',0,50]]));
 const m=model(ledger);assert.equal(m.current.bs.unclosedProfit,50);assert.equal(m.current.bs.equityTotal,150);assert.equal(m.previous.pl.netProfit,100);assert.equal(m.previous.bs.dynamicProfit,false);assert.equal(m.current.bs.balanceDifference,0);
});
check('partial closing keeps remaining profit and never invents a closing journal',()=>{
 const ledger=tx('2026-09-01',[['1112',100,0],['4101',0,100]]).concat(tx('2026-09-02',[['6204',20,0],['1112',0,20]]),tx('2026-09-30',[['4101',100,0],['3440',0,100]],{sourceType:'period_close'}));const original=JSON.stringify(ledger);
 const m=model(ledger);assert.equal(m.current.bs.unclosedProfit,-20);assert.equal(m.current.bs.equityTotal,80);assert.equal(m.current.pl.netProfit,80);assert.equal(JSON.stringify(ledger),original);
});
check('OCI gains/tax/reclassification remain separate from profit and balance with equity',()=>{
 const ledger=tx('2026-09-01',[['1112',100,0],['4101',0,100]]).concat(tx('2026-09-02',[['1510',20,0],['3510',0,20]]),tx('2026-09-03',[['9001',4,0],['2132',0,4]]));
 const mappings={'3510':{statementClass:'equity',ociCategory:'nonreclassifiable'},'9001':{statementClass:'incomeTax',ociCategory:'nonreclassifiable'}};
 const m=model(ledger,{accountMappings:mappings});assert.equal(m.current.pl.netProfit,100);assert.equal(m.current.pl.ociTotal,16);assert.equal(m.current.pl.comprehensiveIncome,116);assert.equal(m.current.bs.assetTotal,120);assert.equal(m.current.bs.liabTotal,4);assert.equal(m.current.bs.equityTotal,116);assert.equal(m.current.bs.balanceDifference,0);
});
check('unconfigured OCI is explicitly unreviewed, not silently approved as zero',()=>{const m=model([],{checks:{}});assert.equal(m.status,'draft');assert.equal(m.readyForReview,false);assert.equal(m.current.pl.ociConfigured,false);assert.ok(m.warnings.some(w=>w.code==='oci_review'));assert.ok(m.warnings.some(w=>w.code==='empty_ledger'));});
check('aggregate mappings stay isolated by legal entity for OCI, PL and cash classes',()=>{
 const rows=tx('2026-09-01',[['1510',20,0],['3510',0,20]],{eid:'E1'}).concat(tx('2026-09-01',[['1510',30,0],['3510',0,30]],{eid:'E2'}),tx('2026-09-02',[['1901',40,0],['1112',0,40]],{eid:'E1'}),tx('2026-09-02',[['1901',50,0],['1112',0,50]],{eid:'E2'}));
 const maps={E1:{3510:{statementClass:'equity',ociCategory:'reclassifiable'},1901:{cashFlowClass:'investing'}},E2:{3510:{statementClass:'otherIncome'},1901:{cashFlowClass:'operating'}}};
 const m=model(rows,{entityId:'all',accountMappingsByEntity:maps});assert.equal(m.current.pl.ociTotal,20);assert.equal(m.current.pl.netProfit,30);assert.equal(m.current.pl.comprehensiveIncome,50);assert.equal(m.current.cf.inv,-40);assert.equal(m.current.cf.opOut,-50);assert.equal(m.current.bs.balanceDifference,0);
 const absent=model(rows,{entityId:'all',accountMappings:{3510:{ociCategory:'nonreclassifiable'}},accountMappingsByEntity:{E1:maps.E1}});assert.equal(absent.current.pl.ociTotal,20);assert.equal(absent.current.pl.netProfit,0);assert.equal(absent.current.cf.unclassified,-50);
});
check('same account can have separate OCI categories in separate entities',()=>{
 const rows=tx('2026-09-01',[['1510',20,0],['3510',0,20]],{eid:'E1'}).concat(tx('2026-09-01',[['1510',30,0],['3510',0,30]],{eid:'E2'}));
 const m=model(rows,{entityId:'all',accountMappingsByEntity:{E1:{3510:{ociCategory:'reclassifiable'}},E2:{3510:{ociCategory:'nonreclassifiable'}}}});assert.equal(m.current.pl.ociRows.length,2);assert.equal(m.current.pl.ociReclassifiable,20);assert.equal(m.current.pl.ociNonreclassifiable,30);
});
check('ordinary maintenance is operating despite equipment words in description',()=>{
 const m=model(tx('2026-09-12',[['6204',50,0],['1112',0,50]],{desc:'設備固定資產維修費'}));assert.equal(m.current.cf.opOut,-50);assert.equal(m.current.cf.inv,0);assert.equal(m.current.cf.bookEnd,-50);
});
check('cash-to-cash transfers do not inflate customer and supplier flows',()=>{const m=model(tx('2026-09-12',[['111201',100,0],['111202',0,100]]));assert.equal(m.current.cf.opIn,0);assert.equal(m.current.cf.opOut,0);assert.equal(m.current.cf.internalTransfers[0].amount,100);assert.equal(m.current.cf.net,0);});
check('mixed balanced payment classifies by counterpart, preserving fees and asset cash',()=>{const m=model(tx('2026-09-12',[['1601',100,0],['6201',10,0],['1112',0,110]]));assert.equal(m.current.cf.inv,-100);assert.equal(m.current.cf.opOut,-10);assert.equal(m.current.cf.reconciliationDifference,0);});
check('mixed noncash financing cannot fabricate gross investing and financing cash',()=>{
 const m=model(tx('2026-09-12',[['1601',100,0],['2192',0,50],['1112',0,50]]));assert.equal(m.current.cf.inv,0);assert.equal(m.current.cf.fin,0);assert.equal(m.current.cf.unclassified,-50);assert.equal(m.current.cf.end,-50);assert.equal(m.current.cf.reconciliationDifference,0);assert.ok(m.warnings.some(w=>w.code==='unclassified_cash'));
});
check('explicit source override preserves both sides of an intercompany loan by entity',()=>{
 const rows=tx('2026-09-12',[['1130',100,0],['1112',0,100]],{eid:'E1'}).concat(tx('2026-09-12',[['1112',100,0],['2136',0,100]],{eid:'E2'}));
 const overrides={};overrides['E1|'+rows[0].ref]='investing';overrides['E2|'+rows[2].ref]='financing';
 assert.equal(model(rows,{cashFlowOverrides:overrides}).current.cf.inv,-100);assert.equal(model(rows,{entityId:'E2',cashFlowOverrides:overrides}).current.cf.fin,100);
});
check('unclassified/unbalanced cash remains visible and fully reconciles',()=>{const m=model(tx('2026-09-12',[['1112',100,0],['1130',0,100]]).concat(tx('2026-09-13',[['1112',40,0]])));assert.equal(m.current.cf.unclassified,140);assert.equal(m.current.cf.end,140);assert.equal(m.current.cf.bookEnd,140);assert.equal(m.current.trialBalance.ok,false);assert.ok(m.warnings.some(w=>w.code==='unclassified_cash'));});
check('explicit cash mapping is honored; noncash cannot hide actual cash movement',()=>{
 const rows=tx('2026-09-12',[['1901',100,0],['1112',0,100]]);assert.equal(model(rows,{accountMappings:{1901:{cashFlowClass:'investing'}}}).current.cf.inv,-100);assert.equal(model(rows,{accountMappings:{1901:{cashFlowClass:'noncash'}}}).current.cf.unclassified,-100);
});
check('unposted request events are separate and cannot fabricate cash or cross entity scope',()=>{
 const events=[{eid:'E1',ref:'REQ1',date:'2026-09-12',amount:-90},{eid:'E2',ref:'REQ2',date:'2026-09-12',amount:-900}];const m=model([],{cashEvents:events});assert.equal(m.current.cf.end,0);assert.equal(m.current.cf.unpostedCashAmount,-90);assert.equal(m.current.cf.unpostedCashEvents.length,1);
 const rows=tx('2026-09-12',[['6204',90,0],['1112',0,90]]).map(r=>({...r,ref:'REQ1'}));assert.equal(model(rows,{cashEvents:events}).current.cf.unpostedCashEvents.length,0);
});
check('department and PL net refunds/credit notes identically without clipping negatives',()=>{
 const rows=tx('2026-09-01',[['1112',100,0],['4101',0,100]]).concat(tx('2026-09-02',[['4101',20,0],['1112',0,20]]),tx('2026-09-03',[['6204',30,0],['1112',0,30]]),tx('2026-09-04',[['1112',10,0],['6204',0,10]]));const m=model(rows);assert.equal(m.current.pl.netProfit,60);assert.deepEqual([m.current.departments[0].income,m.current.departments[0].expense,m.current.departments[0].net],[80,20,60]);
});
check('all departments and isolated company/department scopes are retained',()=>{
 const rows=Array.from({length:12},(_,i)=>tx('2026-09-01',[['1112',10,0],['4101',0,10]],{dc:'D'+i})).flat().concat(tx('2026-09-01',[['1112',500,0],['4101',0,500]],{eid:'E2',dc:'D1'}));assert.equal(model(rows).current.departments.length,12);assert.equal(model(rows,{departmentCode:'D1'}).current.pl.netProfit,10);assert.equal(model(rows,{entityId:'all'}).current.pl.netProfit,620);assert.ok(model(rows,{entityId:'all'}).warnings.some(w=>w.code==='aggregate_scope'));
});
check('voided and invalid ledger rows cannot silently become reliable figures',()=>{
 const rows=tx('2026-09-01',[['1112',100,0],['4101',0,100]],{voidedAt:'2026-09-02'}).concat(tx('bad-date',[['1112',200,0],['4101',0,200]]));const m=model(rows);assert.equal(m.current.pl.netProfit,0);assert.ok(m.warnings.some(w=>w.code==='invalid_rows'));assert.equal(m.readyForReview,false);
});
check('decimal cents are retained; zero comparison does not invent a growth rate',()=>{const m=model(tx('2026-09-01',[['1112',0.25,0],['4101',0,0.25]]));assert.equal(m.current.pl.netProfit,0.25);assert.equal(m.changes.netProfit.percent,null);});
check('all export sheets retain comparison, cash opening/closing and draft notes',()=>{
 const m=model(tx('2026-08-01',[['1112',100,0],['4101',0,100]]).concat(tx('2026-09-01',[['1112',50,0],['4101',0,50]])));const sheets=engine.exportSheets(m);assert.equal(sheets.length,6);const cf=sheets.find(s=>s.name==='現金流量表');assert.deepEqual(cf.rows.find(r=>r[0]==='期初現金'),['期初現金',100,0,100]);assert.equal(sheets[1].rows.find(r=>r[0]==='綜合損益總額')[1],50);for(const s of sheets)assert.match(s.rows[0][0],/暫編/);
});
(async()=>{
 const rows=Array.from({length:6501},(_,i)=>({id:'r'+i}));let calls=[];
 const r=await engine.loadLedgerPages(async(a,b)=>{calls.push([a,b]);return {data:rows.slice(a,b+1),count:rows.length};});assert.equal(r.data.length,6501);assert.equal(r.completeness.complete,true);assert.equal(calls.length,7);checks++;console.log('PASS exact pagination reads more than the former 5000-row limit');
 for(const [name,fetch,options] of [
  ['missing total',async()=>({data:[],count:null}),{}],
  ['duplicate ID',async()=>({data:[{id:'same'},{id:'same'}],count:2}),{}],
  ['early truncated page',async()=>({data:[{id:'a'}],count:10}),{}],
  ['changing total',async(a)=>({data:[{id:String(a)}],count:a?3:2}),{pageSize:1}],
  ['read error',async()=>({error:new Error('read failed')}),{}],
  ['identity change',async()=>({data:[{id:'a'}],count:1}),{isCurrent:()=>false}],
  ['safety limit',async(a)=>({data:[{id:String(a)}],count:10}),{pageSize:1,maxPages:2}]
 ]){await assert.rejects(()=>engine.loadLedgerPages(fetch,options));checks++;console.log('PASS pagination rejects '+name);}
 console.log('OK: '+checks+' financial statement behavior checks');
})().catch(error=>{console.error(error);process.exitCode=1;});
