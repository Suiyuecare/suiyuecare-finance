const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const engine = require('../assets/engines/audit-readiness-engine.js');
const financial = require('../assets/engines/financial-statements.js');
let checks = 0, serial = 0;
function test(name, fn) { fn(); checks++; console.log('PASS ' + name); }
function transaction(date, entries, extra = {}) {
  const voucher = 'V-' + (++serial);
  return entries.map(([ac, dr, cr], i) => ({id:voucher+'-'+i, eid:'E1', date, dc:'D1', ac, an:ac, dr, cr, voucherNo:voucher,
    sourceType:'expense_request', sourceId:'R-'+voucher, postingKey:voucher+':'+i, ref:'REQ-'+voucher, ...extra}));
}
function ar(items = [], extra = {}) {
  const mapped = items.reduce((sum, row) => sum + (row.outstandingAmount || 0), 0);
  return {entityId:'E1', asOf:'2026-09-30', complete:true, totalCount:items.length, items,
    reconciliation:{reconciliationVisible:true,reconciliationStatus:'complete',mappedLedgerNet:mapped,ledgerNet:mapped,unmappedLedgerNet:0,unmappedDebitAmount:0,unmappedCreditAmount:0,scopeDifference:0,unmappedEntryCount:0}, ...extra};
}
function readyCase(items = {}) { return {revision:2,sourceFingerprint:'server-fingerprint-current',sourceCounts:{ledger:2,invoices:0,expense_requests:0},caseData:{schemaVersion:1,engagementType:'both',items}}; }
function input(ledger = transaction('2026-09-12', [['1112',100,0],['4101',0,100]]), extra = {}) {
  const profile = extra.profile || {}, period = extra.period || '2026-09', entityId = extra.entityId || 'E1';
  const full = count => ({complete:true,status:'complete',rowCount:count,total:count});
  const statementModel = financial.buildModel({entityId,period,ledger,accountMappings:profile.accountMappings || {},completeness:{complete:true},checks:{ociReviewed:true},comparisonPeriod:null});
  return {entityId,period,ledger,profile,statementModel,completeness:{tables:{ledger:full(ledger.length),invoices:full(0),expense_requests:full(0)}},receivables:ar(),auditCase:readyCase(),today:'2026-10-05',...extra};
}
function model(ledger, extra) { return engine.buildModel(input(ledger, extra)); }
function control(m, id) { return m.controls.find(c => c.id === id); }
function reviewed(extra = {}) { return {ownerId:'ACCOUNTANT',dueDate:'2026-09-15',evidenceReference:'vault://workpaper/1',notes:'已取得底稿',sourceLinks:[],applicability:'applicable',status:'reviewed',preparedBy:'ACCOUNTANT',preparedAt:'2026-09-20T01:00:00Z',reviewedBy:'REVIEWER',reviewedAt:'2026-09-21T01:00:00Z',reviewedFingerprint:'server-fingerprint-current',...extra}; }

test('ten system controls and twelve PBC items never create a certification success flag', () => {
  const m = model(); assert.equal(m.controls.length,10); assert.equal(m.items.length,12);
  assert.equal(m.summary.system.total,10); assert.equal(m.summary.internalReview.pending,12);
  assert.equal(m.readyForCertification,undefined); assert.equal(m.equityRollforward.formalStatement,false);
  assert.match(m.disclaimer,/不代表會計師已查核/);
});
test('complete exact-count ordinary balanced ledger passes arithmetic controls', () => {
  const m = model(); for (const id of ['C01','C02','C03','C04','C05','C06','C07','C08','C09','C10']) assert.equal(control(m,id).status,'pass',id);
  const cash = m.trialBalance.find(r => r.accountCode === '1112'); assert.deepEqual([cash.openingDebit,cash.periodDebit,cash.periodCredit,cash.closingDebit],[0,100,0,100]);
});
test('missing ledger is unknown and does not synthesize empty complete balances', () => {
  const m = engine.buildModel({entityId:'E1',period:'2026-09',today:'2026-10-01'});
  for (const id of ['C01','C02','C05','C06','C08','C09']) assert.equal(control(m,id).status,'unknown');
  assert.equal(m.equityRollforward.closingEquity,null); assert.equal(control(m,'C08').amount,null);
});
test('complete flag without exact counts does not approve source population', () => {
  const i = input(); i.completeness.tables.ledger = {complete:true,status:'complete'};
  const m = engine.buildModel(i); assert.equal(control(m,'C01').status,'unknown'); assert.equal(control(m,'C02').status,'unknown');
  assert.equal(m.trialBalance[0].closingBalance,null); assert.equal(m.trialBalance[0].observedClosingBalance,100);
});
test('loaded count must equal both declared exact total and actual input size', () => {
  for (const metadata of [{total:3,rowCount:2},{total:3,rowCount:3},{total:null,rowCount:2},{total:0,rowCount:0}]) {
    const i = input(); i.completeness.tables.ledger = {...metadata,complete:true,status:'complete'};
    assert.equal(control(engine.buildModel(i),'C01').status,'unknown');
  }
});
test('error/loading/unknown or mismatched source entity cannot retain stale completeness', () => {
  for (const patch of [{status:'error'},{status:'loading'},{status:'unknown'},{entityId:'E2'}]) {
    const i = input(); Object.assign(i.completeness.tables.ledger,patch);
    assert.equal(control(engine.buildModel(i),'C01').status,'unknown');
  }
});
test('missing invoice or request counts keep overall source unknown while ledger arithmetic remains available', () => {
  const i = input(); delete i.completeness.tables.invoices.total;
  const m = engine.buildModel(i); assert.equal(control(m,'C01').status,'unknown'); assert.equal(control(m,'C02').status,'pass');
});
test('scoped input can prove its count separately from a full tenant table count', () => {
  const i = input(); i.completeness.tables.ledger = {complete:true,status:'complete',total:500,rowCount:500,scopedRowCount:i.ledger.length};
  assert.equal(control(engine.buildModel(i),'C01').status,'pass');
  i.completeness.tables.ledger.scopedRowCount--; assert.equal(control(engine.buildModel(i),'C01').status,'unknown');
});
test('an exactly empty population cannot establish verified BS, CF or voucher balances', () => {
  const m = model([]); assert.equal(control(m,'C01').status,'pass');
  for (const id of ['C02','C05','C06']) assert.equal(control(m,id).status,'unknown');
  assert.equal(m.equityRollforward.openingEquity,null);
});
test('foreign company rows are excluded from calculations, candidate IDs and every export', () => {
  const rows = transaction('2026-09-12',[['1112',10,0],['4101',0,10]]).concat(transaction('2026-09-12',[['1112',999,0],['4101',0,999]],{eid:'SECRET-ENTITY',sourceId:'SECRET-SOURCE',desc:'SECRET-MEMO'}));
  const m = model(rows); assert.equal(m.ledger.length,2); assert.equal(m.equityRollforward.closingEquity,10);
  assert.ok(!JSON.stringify(engine.workbookSheets(m)).includes('SECRET')); assert.ok(m.warnings.some(w => /其他法人/.test(w)));
});
test('all-company and invalid-period scopes remain unknown without leaking ledger', () => {
  const base = input(); for (const patch of [{entityId:'all'},{entityId:''},{period:'all'},{period:'2026-13'},{period:''}]) {
    const m = engine.buildModel({...base,...patch}); assert.equal(m.ledger.length,0); assert.equal(control(m,'C01').status,'unknown');
  }
});
test('opposite voucher imbalances do not cancel to a false pass', () => {
  const rows = transaction('2026-09-12',[['1112',100,0]]).concat(transaction('2026-09-12',[['4101',0,100]]));
  const m = model(rows); assert.equal(m.equityRollforward.difference,0); assert.equal(control(m,'C02').status,'issue'); assert.equal(control(m,'C02').sourceIds.length,2);
});
test('observed unbalanced partial pages stay unknown rather than declaring a complete voucher error', () => {
  const i = input(transaction('2026-09-12',[['1112',100,0]])); i.completeness.tables.ledger.complete=false;
  const m = engine.buildModel(i); assert.equal(control(m,'C02').status,'unknown'); assert.equal(control(m,'C02').sourceIds.length,1);
});
test('one row with debit and credit 70 is allowed; netting does not remove source trace', () => {
  const rows = transaction('2026-09-12',[['1123',70,70]]), m = model(rows);
  assert.equal(control(m,'C02').status,'pass'); assert.equal(control(m,'C04').status,'pass');
  const tb=m.trialBalance[0]; assert.equal(tb.periodDebit,70); assert.equal(tb.periodCredit,70); assert.equal(tb.closingBalance,0); assert.equal(m.ledger.length,1);
});
test('missing voucher identity cannot be replaced by coincident source IDs to claim voucher balance', () => {
  const rows=transaction('2026-09-12',[['1112',100,0],['4101',0,100]],{voucherNo:''});
  const m=model(rows); assert.equal(control(m,'C02').status,'unknown'); assert.equal(control(m,'C03').status,'issue');
});
test('duplicate line IDs and posting keys are detected even if totals remain balanced', () => {
  const rows=transaction('2026-09-12',[['1112',100,0],['4101',0,100]]); const m=model(rows.concat(rows.map(r=>({...r}))));
  assert.equal(control(m,'C03').status,'issue'); assert.equal(control(m,'C05').status,'unknown'); assert.ok(m.trialBalance.every(r=>r.closingBalance===null));
});
test('same source and amount with distinct journal keys is not automatically a duplicate', () => {
  const rows=transaction('2026-09-12',[['1112',100,0],['4101',0,100]],{sourceId:'SHARED'}).concat(transaction('2026-09-13',[['1112',100,0],['4101',0,100]],{sourceId:'SHARED'}));
  assert.equal(control(model(rows),'C03').status,'pass');
});
test('missing typed source identity remains an actionable row-level issue', () => {
  const rows=transaction('2026-09-12',[['1112',100,0],['4101',0,100]],{sourceType:''}); const m=model(rows);
  assert.equal(control(m,'C03').status,'issue'); assert.equal(control(m,'C03').sourceIds.length,2);
});
test('NULL/blank/boolean/NaN/infinity/fractional-cent/negative amounts are never normalized into trusted zero', () => {
  for(const bad of [null,undefined,'',' ',true,'abc',NaN,Infinity,0.001,-10]) {
    const rows=transaction('2026-09-12',[['1112',bad,0],['4101',0,10]]); const m=model(rows);
    assert.equal(control(m,'C04').status,'issue',String(bad)); assert.equal(control(m,'C05').status,'unknown'); assert.equal(m.equityRollforward.closingEquity,null);
  }
});
test('exact cent numeric strings are supported without losing cents', () => {
  const m=model(transaction('2026-09-12',[['1112','0.25','0'],['4101','0','0.25']]));
  assert.equal(control(m,'C04').status,'pass'); assert.equal(m.trialBalance[0].periodDebit,0.25);
});
test('negative normal account balances are legitimate and remain signed', () => {
  const rows=transaction('2026-09-12',[['1112',10,0],['6204',0,10]]); const m=model(rows);
  assert.equal(control(m,'C04').status,'pass'); assert.equal(m.trialBalance.find(r=>r.accountCode==='6204').closingBalance,-10);
});
test('invalid calendar date is retained as an issue and prevents reliable balances', () => {
  const m=model(transaction('2026-02-30',[['1112',10,0],['4101',0,10]])); assert.equal(control(m,'C04').status,'issue'); assert.equal(m.ledger.length,2);
});
test('Taipei timestamp midnight and year cutoff are deterministic across host zones', () => {
  const rows=transaction('2025-12-31T16:30:00Z',[['1112',10,0],['4101',0,10]]);
  const old=process.env.TZ; try { for (const tz of ['UTC','Asia/Taipei','America/Los_Angeles']) {process.env.TZ=tz; const m=model(rows,{period:'2026-01'});assert.equal(m.ledger[0].date,'2026-01-01');assert.equal(m.trialBalance[0].openingBalance,0);assert.equal(m.trialBalance[0].periodDebit,10);} } finally {if(old===undefined)delete process.env.TZ;else process.env.TZ=old;}
});
test('cross-year trial balance uses complete cumulative opening rather than prior-month PL', () => {
  const rows=transaction('2025-11-01',[['1112',100,0],['4101',0,100]]).concat(transaction('2026-01-15',[['1112',20,0],['4101',0,20]])); const m=model(rows,{period:'2026-01'});
  const cash=m.trialBalance.find(r=>r.accountCode==='1112');assert.deepEqual([cash.openingBalance,cash.periodDebit,cash.closingBalance],[100,20,120]);assert.equal(m.equityRollforward.openingEquity,100);
});
test('future postings and voids are excluded from totals but voided period evidence remains in trace', () => {
  const rows=transaction('2026-09-12',[['1112',10,0],['4101',0,10]]).concat(transaction('2026-10-01',[['1112',99,0],['4101',0,99]]),transaction('2026-09-13',[['1112',50,0],['4101',0,50]],{voidedAt:'2026-09-14'}));
  const m=model(rows);assert.equal(m.ledger.length,4);assert.equal(m.trialBalance.find(r=>r.accountCode==='1112').closingBalance,10);
});
test('report from another company or department does not satisfy company BS/CF controls', () => {
  for (const patch of [{entityId:'E2'},{period:'2026-08'},{departmentCode:'D1'}]) {
    const i=input();Object.assign(i.statementModel,patch);const m=engine.buildModel(i);assert.equal(control(m,'C05').status,'unknown');assert.equal(control(m,'C06').status,'unknown');
  }
});
test('stale but internally balanced statement is detected against the input ledger', () => {
  const i=input(); i.statementModel.current.bs.assetTotal=90;i.statementModel.current.bs.equityTotal=90;
  assert.equal(control(engine.buildModel(i),'C05').status,'issue');
});
test('cash book/start/net/end must all reconcile, not just trust supplied difference zero', () => {
  for(const key of ['start','net','end','bookEnd']) {const i=input();i.statementModel.current.cf[key]+=1;assert.equal(control(engine.buildModel(i),'C06').status,'issue',key);}
});
test('unclassified cash or pending form events require review without fabricating cash', () => {
  const i=input();i.statementModel.current.cf.unpostedCashEvents=[{sourceId:'R2',amount:20}];
  assert.equal(control(engine.buildModel(i),'C06').status,'review');assert.equal(engine.buildModel(i).trialBalance[0].closingBalance,100);
});
test('unknown accounts and absent department are actionable while historic inactive accounts are not rejected', () => {
  assert.equal(control(model(transaction('2026-09-12',[['1112',10,0],['8800',0,10]])),'C07').status,'issue');
  assert.equal(control(model(transaction('2026-09-12',[['1112',10,0],['4101',0,10]],{dc:''})),'C07').status,'issue');
  const m=model(undefined,{profile:{accountMappings:{4101:{active:false,statementClass:'revenue'}}}});assert.equal(control(m,'C07').status,'pass');
});
test('company custom account mapping drives equity profit classifications', () => {
  const m=model(transaction('2026-09-12',[['1112',45,0],['3999',0,45]]),{profile:{accountMappings:{3999:{statementClass:'revenue'}}}});
  assert.equal(m.equityRollforward.currentProfit,45);assert.equal(m.equityRollforward.otherEquityMovement,0);assert.equal(control(m,'C05').status,'pass');
});
test('AR complete must include exact scope, cutoff, count and valid unique invoice items', () => {
  for(const patch of [{complete:false},{entityId:'E2'},{asOf:'2026-09-29'},{totalCount:null},{totalCount:1},{departmentCode:'D1'}]) {
    const m=model(undefined,{receivables:ar([],{...patch})});assert.equal(control(m,'C08').status,'unknown');assert.equal(control(m,'C09').status,'unknown');
  }
  for(const items of [[{invoiceId:'I1',outstandingAmount:null}],[{invoiceId:'I1',outstandingAmount:1},{invoiceId:'I1',outstandingAmount:1}]]) assert.equal(control(model(undefined,{receivables:ar(items)}),'C08').status,'unknown');
});
test('AR denied reconciliation preserves NULLs instead of showing zero difference', () => {
  const snapshot=ar();snapshot.reconciliation={reconciliationVisible:false,reconciliationStatus:'scope_unverified',ledgerNet:null};
  const m=model(undefined,{receivables:snapshot});assert.equal(control(m,'C08').status,'unknown');assert.equal(control(m,'C08').amount,null);
});
test('unmapped AR gross 70/70 is an issue even with zero net balance and zero scope difference', () => {
  const snapshot=ar();Object.assign(snapshot.reconciliation,{unmappedDebitAmount:70,unmappedCreditAmount:70,unmappedEntryCount:1});
  const m=model(undefined,{receivables:snapshot});assert.equal(control(m,'C08').status,'issue');assert.equal(control(m,'C08').amount,0);
});
test('AR mapped totals and arithmetic identities are checked independently of supplied flags', () => {
  const snapshot=ar([{invoiceId:'I1',outstandingAmount:100,dueDate:'2026-10-01'}]);snapshot.reconciliation.mappedLedgerNet=90;
  assert.equal(control(model(undefined,{receivables:snapshot}),'C08').status,'issue');
});
test('unknown due dates remain unknown, positive amounts are not offset by customer credit balances', () => {
  const snapshot=ar([{invoiceId:'I1',outstandingAmount:100,dueDate:null},{invoiceId:'I2',outstandingAmount:-100,dueDate:null}]);
  const c=control(model(undefined,{receivables:snapshot}),'C09');assert.equal(c.status,'unknown');assert.equal(c.amount,100);assert.deepEqual(c.sourceIds,['I1']);
});
test('aging uses period cutoff rather than current date, overdue implies review not write-off', () => {
  const snapshot=ar([{invoiceId:'I1',outstandingAmount:100,dueDate:'2026-10-01'}]);assert.equal(control(model(undefined,{receivables:snapshot,today:'2026-12-01'}),'C09').status,'pass');
  snapshot.items[0].dueDate='2026-09-29';assert.equal(control(model(undefined,{receivables:snapshot}),'C09').status,'review');
});
test('manual end-period candidates are complete, typed risk flags, not audit sampling conclusions', () => {
  const rows=Array.from({length:90},()=>transaction('2026-09-30',[['1112',1,0],['4101',0,1]],{sourceType:'adjustment_voucher'})).flat();
  const m=model(rows);assert.equal(m.samplingCandidates.length,180);assert.equal(control(m,'C10').status,'review');assert.equal(m.samplingCandidates[0].reasons.length,2);
  assert.match(m.samplingNote,/非會計師審計抽樣/);assert.equal(m.ledger.length,180);
});
test('ordinary descriptions are not used to accuse control override or create manual candidates', () => {
  const m=model(transaction('2026-09-30',[['1112',10,0],['4101',0,10]],{desc:'manual 調整 不實 測試'}));assert.equal(m.samplingCandidates.length,0);
});
test('internal reviewed PBC remains separate from system exceptions and requires exact current fingerprint', () => {
  const m=model(undefined,{auditCase:readyCase({A01:reviewed(),A02:reviewed({reviewedFingerprint:'old'}),A03:reviewed({reviewedFingerprint:''})})});
  assert.equal(m.items[0].effectiveStatus,'reviewed');assert.equal(m.items[1].effectiveStatus,'stale');assert.equal(m.items[2].effectiveStatus,'stale');
  assert.equal(m.summary.internalReview.reviewed,1);assert.equal(m.summary.internalReview.stale,2);assert.equal(m.summary.system.pass,10);
});
test('absence of source fingerprint invalidates previous internal review without deleting saved history', () => {
  const auditCase=readyCase({A01:reviewed()});auditCase.sourceFingerprint='';const m=model(undefined,{auditCase});
  assert.equal(m.items[0].effectiveStatus,'stale');assert.equal(m.items[0].reviewedBy,'REVIEWER');assert.equal(m.items[0].reviewedFingerprint,'server-fingerprint-current');
});
test('review without named preparer/reviewer, evidence or known applicability is not accepted', () => {
  for(const patch of [{preparedBy:''},{reviewedAt:''},{evidenceReference:'',notes:'mere claim'},{evidenceReference:'   '},{applicability:'unknown'}]) {
    const m=model(undefined,{auditCase:readyCase({A01:reviewed(patch)})});assert.equal(m.items[0].effectiveStatus,'stale');
  }
});
test('not applicable requires evidence, an explicit rationale and named review rather than auto completion', () => {
  const m=model(undefined,{auditCase:readyCase({A01:reviewed({applicability:'not_applicable',evidenceReference:'vault://scope-review',notes:'本案無存貨，依業務範圍確認'})})});
  assert.equal(m.items[0].effectiveStatus,'reviewed');assert.equal(m.items[0].applicability,'not_applicable');
  const bad=model(undefined,{auditCase:readyCase({A01:reviewed({applicability:'not_applicable',evidenceReference:'',notes:''})})});assert.equal(bad.items[0].effectiveStatus,'stale');
  const reasonOnly=model(undefined,{auditCase:readyCase({A01:reviewed({applicability:'not_applicable',evidenceReference:'',notes:'說明不是證據索引'})})});assert.equal(reasonOnly.items[0].effectiveStatus,'stale');
});
test('preparer cannot supply the separate reviewer signature', () => {
  const m=model(undefined,{auditCase:readyCase({A01:reviewed({reviewedBy:'ACCOUNTANT'})})});assert.equal(m.items[0].effectiveStatus,'stale');
});
test('unknown source with no observed exceptions leaves issue counts unknown instead of zero', () => {
  const m=engine.buildModel({entityId:'E1',period:'2026-09'});for(const id of ['C03','C04','C07','C10'])assert.equal(control(m,id).count,null);
});
test('provided files do not imply reviewer completion; missing prepared stamp falls back to pending', () => {
  const good=reviewed({status:'provided',reviewedBy:'',reviewedAt:''}),bad=reviewed({status:'provided',preparedAt:''});
  const m=model(undefined,{auditCase:readyCase({A01:good,A02:bad})});assert.equal(m.items[0].effectiveStatus,'provided');assert.equal(m.items[1].effectiveStatus,'pending');assert.equal(m.items[0].overdue,true);
});
test('capital changes remain unclassified equity workpaper movements, not a completed fourth statement', () => {
  const m=model(transaction('2026-09-12',[['1112',80,0],['3101',0,80]]));const e=m.equityRollforward;
  assert.equal(e.otherEquityMovement,80);assert.equal(e.closingEquity,80);assert.equal(e.difference,0);assert.equal(e.status,'review');assert.equal(e.formalStatement,false);assert.equal(e.unclassifiedMovementCount,1);
});
test('closing transfer is not double counted with current net profit', () => {
  const rows=transaction('2026-09-12',[['1112',100,0],['4101',0,100]]).concat(transaction('2026-09-30',[['4101',100,0],['3440',0,100]],{sourceType:'period_close'}));
  const e=model(rows).equityRollforward;assert.equal(e.currentProfit,100);assert.equal(e.postedEquityMovement,100);assert.equal(e.otherEquityMovement,0);assert.equal(e.closingEntryNetEffect,0);assert.equal(e.expectedClosingEquity,100);assert.equal(e.difference,0);
});
test('prior-year unclosed earnings can close this period without inflating current equity movement', () => {
  const rows=transaction('2025-12-15',[['1112',100,0],['4101',0,100]]).concat(transaction('2026-01-15',[['1112',50,0],['4101',0,50]]),transaction('2026-01-31',[['4101',100,0],['3440',0,100]],{sourceType:'period_close'}));
  const e=model(rows,{period:'2026-01'}).equityRollforward;assert.deepEqual([e.openingEquity,e.currentProfit,e.closingEquity,e.difference],[100,50,150,0]);
});
test('OCI already booked in equity and OCI tax are counted once, separate from net profit', () => {
  const rows=transaction('2026-09-01',[['1112',100,0],['4101',0,100]]).concat(transaction('2026-09-02',[['1510',20,0],['3510',0,20]]),transaction('2026-09-03',[['9001',4,0],['2132',0,4]]));
  const profile={accountMappings:{3510:{statementClass:'equity',ociCategory:'nonreclassifiable'},9001:{statementClass:'incomeTax',ociCategory:'nonreclassifiable'}}};
  const e=model(rows,{profile}).equityRollforward;assert.deepEqual([e.currentProfit,e.currentOci,e.postedEquityMovement,e.otherEquityMovement,e.closingEquity,e.difference],[100,16,20,0,116,0]);
});
test('unclassified equity-related accounts produce unknown, never an invented zero fourth statement', () => {
  const e=model(transaction('2026-09-12',[['1112',10,0],['8800',0,10]])).equityRollforward;assert.equal(e.status,'unknown');assert.equal(e.closingEquity,null);
});
test('large cents sums cannot overflow into a financial pass', () => {
  const rows=transaction('2026-09-12',[['1112',50000000000000,0],['1112',50000000000000,0],['4101',0,50000000000000],['4101',0,50000000000000]]);
  const m=model(rows);assert.equal(control(m,'C02').status,'unknown');assert.equal(m.trialBalance[0].periodDebit,null);assert.equal(m.equityRollforward.closingEquity,null);
});
test('workbook includes complete source IDs, ten controls, twelve PBCs and both review identities', () => {
  const m=model(undefined,{auditCase:readyCase({A01:reviewed()})}),sheets=engine.workbookSheets(m);
  assert.equal(sheets.length,7);for(const s of sheets){assert.ok(s.rows.some(r=>r[0]==='來源指紋'&&r[1]==='server-fingerprint-current'));assert.ok(s.rows.some(r=>r[0]==='用途與限制'));}
  const pbc=sheets.find(s=>s.name==='索資與內部覆核');assert.equal(pbc.rows.filter(r=>/^A\d\d$/.test(r[0])).length,12);assert.ok(pbc.rows.some(r=>r.includes('REVIEWER')));
  const trace=sheets.find(s=>s.name==='分類帳來源索引');for(const l of m.ledger)assert.ok(trace.rows.some(r=>r[0]===l.id&&r.includes(l.postingKey)));
  assert.equal(sheets.find(s=>s.name==='系統核對').rows.filter(r=>/^C\d\d$/.test(r[0])).length,10);
});
test('engine and exports do not mutate caller ledger, profile or saved PBC history', () => {
  const i=input(undefined,{auditCase:readyCase({A01:reviewed()})});const before=JSON.stringify(i);const m=engine.buildModel(i);engine.workbookSheets(m);assert.equal(JSON.stringify(i),before);
});
test('browser IIFE exports the same pure API and missing financial dependency stays unknown', () => {
  const source=fs.readFileSync(require.resolve('../assets/engines/audit-readiness-engine.js'),'utf8'),scope={window:{FinanceFinancialStatements:financial}};vm.runInNewContext(source,scope);
  assert.equal(scope.window.FinanceAuditReadinessEngine.buildModel(input()).controls.length,10);
  const empty={window:{}};vm.runInNewContext(source,empty);const m=empty.window.FinanceAuditReadinessEngine.buildModel(input());assert.equal(control(m,'C05').status,'unknown');
});
console.log('Audit readiness engine: '+checks+' checks passed.');
