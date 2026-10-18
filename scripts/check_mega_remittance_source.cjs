'use strict';

// Synthetic payment data only. Never use employee names, payroll or bank data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const api = require('../assets/engines/mega-remittance-source.js');
let count = 0;
function test(label, run) { run(); count++; }
function copy(value) { return JSON.parse(JSON.stringify(value)); }
function payment(overrides = {}) {
  return Object.assign({
    id: 'synthetic-request-1', no: 'TEST-001', type: 'payment_request',
    eid: 'synthetic-entity', dc: 'TEST', status: 'pending_cashier', ver: 3,
    amt: 1250, expectedPayDate: '2026/10/20', payee: '測試戶甲',
    bankType: 'mega', bankName: '兆豐銀行', bankNo: '00000001234567',
    bankFeeAmount: 30, feeBearer: 'company',
    steps: [{rk: 'supervisor', a: 'approved', uid: 'synthetic-reviewer'}, {rk: 'ceo', a: 'AUTO'}, {rk: 'cashier'}, {rk: 'applicant'}],
    formPayload: {paymentType: 'bank'}
  }, overrides);
}
function hr(rows, overrides = {}) {
  return payment(Object.assign({type: 'hr_expense_request', amt: 1250, payee: '整批人事費用匯款', bankNo: '',
    formPayload: {paymentType: 'bank', hrItem: 'salary_50', hrInfo: {rows: rows || [{姓名: '測試員工甲', 金額: 1250, 銀行代號: '017', 銀行帳號: '00000001234567'}], paymentTotal: 1250}}
  }, overrides));
}
function refund(rows, overrides = {}) {
  return payment(Object.assign({type: 'refund_request', amt: 1250,
    formPayload: {paymentType: 'bank', refundInfo: {rows: rows || [{method: '銀行轉帳', accountName: '測試退費戶', accountNo: '00000001234567', bankName: '017 兆豐銀行', refundAmount: 1250}]}}
  }, overrides));
}
function bad(result, code, field, rowKey) {
  assert.equal(result.ok, false, 'must block export');
  assert(result.issues.some(p => p.code === code && (!field || p.field === field) && (!rowKey || p.rowKey === rowKey)), 'missing expected issue ' + code);
  assert.equal(result.snapshotText, null, 'invalid data cannot produce a valid snapshot');
}
function success(result) { assert.equal(result.ok, true, JSON.stringify(result.issues)); assert.equal(result.eligible, true); return result; }

test('ordinary principal excludes company fee and preserves leading zeroes', () => {
  const out = success(api.resolve(payment()));
  assert.equal(out.mode, 'bulk'); assert.equal(out.expectedTotal, 1250);
  assert.deepEqual(out.rows, [{name: '測試戶甲', identityNo: '', bankCode: '017', account: '00000001234567', amount: 1250}]);
  assert.deepEqual(out.sourceRowKeys, ['payment:1']); assert.equal(out.context.bankFeeAmount, 30);
});
test('raw snake_case DB record supported without mapReq coercion', () => {
  const r = payment();
  Object.assign(r, {entity_id: r.eid, department_code: r.dc, amount: '1250.00', expected_pay_date: '2026-10-20', bank_type: r.bankType, bank_name: r.bankName, bank_no: r.bankNo, form_payload: r.formPayload});
  ['eid','dc','amt','expectedPayDate','bankType','bankName','bankNo','formPayload'].forEach(k => delete r[k]);
  const out = success(api.resolve(r)); assert.equal(out.rows[0].account, '00000001234567'); assert.equal(out.rows[0].amount, 1250);
});
test('no person/account guessing from applicant or bank summary', () => {
  const out = api.resolve(payment({payee: '', bankNo: '', name: '申請人不是收款人', bankAcc: '銀行 / 分行 / 00000001'}));
  bad(out, 'text_required', 'name', 'payment:1'); bad(out, 'text_required', 'account', 'payment:1');
});
test('missing fields remain available for private row correction UI', () => {
  const out = api.resolve(payment({payee: ''})); bad(out, 'text_required', 'name');
  assert.equal(out.rows.length, 1); assert.equal(out.sourceRowKeys[0], 'payment:1');
});
for (const type of ['invoice_request','billing_request','bill_request','invoice_issue','shareholder_request','unknown']) {
  test('unsupported financial type blocked: ' + type, () => bad(api.resolve(payment({type})), 'transaction_not_supported'));
}
for (const status of ['pending_ceo','approved','completed','paid','voided','draft','rejected','withdrawn']) {
  test('only pending cashier stage: ' + status, () => bad(api.resolve(payment({status})), 'not_pending_cashier'));
}
for (const field of ['cashPostedAt','cash_posted_at','ledgerPostedAt','ledger_posted_at','postingLockedAt','posting_locked_at','voucherId','voucher_id','voidedAt','voided_at','paidAt','paid_at']) {
  test('already processed marker blocked: ' + field, () => bad(api.resolve(payment({[field]: 'synthetic-marker'})), 'already_paid_or_locked'));
}
test('payment marker in payload also blocked', () => bad(api.resolve(payment({formPayload: {paymentType:'bank', cashPostedAt:'2026-10-20'}})), 'already_paid_or_locked'));
test('digital labor separate flow blocked', () => { const r=hr(); r.formPayload.hrInfo.digital=true; bad(api.resolve(r),'electronic_labor_separate_flow'); });
test('electronic labor request marker blocked', () => { const r=hr(); r.formPayload.electronicLabor={version:1}; bad(api.resolve(r),'electronic_labor_separate_flow'); });
test('electronic labor HR item blocked', () => { const r=hr(); r.formPayload.hrItem='labor_electronic'; bad(api.resolve(r),'electronic_labor_separate_flow'); });
test('cash payment does not generate bank file', () => bad(api.resolve(payment({formPayload:{paymentType:'cash'}})), 'payment_method_not_bank'));
test('unspecified payment method cannot become bank transfer by default', () => bad(api.resolve(payment({formPayload:{}})), 'payment_method_not_bank'));
test('explicit approved transfer aliases agree with backend', () => {for(const paymentType of ['bank','transfer','匯款','銀行轉帳'])success(api.resolve(payment({formPayload:{paymentType}})));});
test('missing malformed or sparse workflow blocked', () => {
  for (const steps of [undefined, [], [null], [[]], new Array(1)]) bad(api.resolve(payment({steps})), 'workflow_missing');
});
test('active step is first unfinished step, not untrusted step index', () => {
  const r=payment({step:99,steps:[{rk:'ceo'},{rk:'cashier'}]});bad(api.resolve(r),'cashier_step_not_active');
});
test('every prior step must have completed approval', () => bad(api.resolve(payment({steps:[{rk:'ceo',a:'rejected'},{rk:'cashier'}]})), 'prior_step_not_approved'));
test('no active step is not eligible', () => bad(api.resolve(payment({steps:[{rk:'cashier',a:'approved'}]})), 'cashier_step_not_active'));
test('future timestamp is never guessed as pay date', () => {
  for (const value of ['', '2026-02-30', '2026-2-01', '2026-10-20T00:00:00Z', 20261020]) bad(api.resolve(payment({expectedPayDate:value})), 'payment_date_missing');
});
test('formal source ID and entity required', () => {
  bad(api.resolve(payment({id:''})), 'request_id_missing'); bad(api.resolve(payment({eid:''})), 'entity_missing');
});
test('approved zero is not replaced by another positive amount', () => bad(api.resolve(payment({amt:0,amount:1250})), 'amount_invalid', 'principalAmount'));
for (const value of ['', 0, -1, NaN, Infinity, false, '1e3', ' 1250', '1,250', '1250.50', '0.00']) {
  test('invalid principal never rounded/fallback: ' + String(value), () => bad(api.resolve(payment({amt:value})), 'amount_invalid'));
}
test('purchase uses approved initial procurement amount before closeout', () => {
  const out=success(api.resolve(payment({type:'purchase_request',estimatedAmt:1250,actualAmt:1900,amt:1900})));assert.equal(out.expectedTotal,1250);
});
test('purchase uses exact signed procurement amount if primary estimate absent', () => {
  const r=payment({type:'purchase_request',actualAmt:1900,formPayload:{paymentType:'bank',procurementPaymentInfo:{amount:1250}}});
  assert.equal(success(api.resolve(r)).expectedTotal,1250);
});
test('zero estimate does not fall through to amount or procurement amount', () => {
  const r=payment({type:'purchase_request',estimatedAmt:0,formPayload:{paymentType:'bank',procurementPaymentInfo:{amount:1250}}});bad(api.resolve(r),'amount_invalid');
});
test('advance uses funding estimate instead of later settlement amount', () => {
  assert.equal(success(api.resolve(payment({type:'advance_request',estimatedAmt:1250,amt:1800,actualAmt:1800}))).expectedTotal,1250);
});
test('salary and bonus choose payroll schema', () => {
  for (const item of ['salary_50','bonus']) {const r=hr();r.formPayload.hrItem=item;assert.equal(success(api.resolve(r)).mode,'payroll');}
});
test('non-payroll HR payment chooses bulk schema', () => {
  for (const item of ['labor_fee_9a','labor_fee_9b','labor_insurance','health_insurance','labor_pension','supplemental_premium','severance_termination','hr_other']) {
    const r=hr();r.formPayload.hrItem=item;assert.equal(success(api.resolve(r)).mode,'bulk');
  }
});
test('unknown or conflicting HR item rejected', () => {
  for(const value of ['', 'unknown']) {const r=hr();r.formPayload.hrItem=value;bad(api.resolve(r),'hr_item_missing');}
  const r=hr();r.formPayload.hrInfo.item={id:'bonus'};bad(api.resolve(r),'hr_item_conflict');
});
test('HR item may come from authoritative hrInfo.item', () => {
  const r=hr();delete r.formPayload.hrItem;r.formPayload.hrInfo.item={id:'salary_50'};assert.equal(success(api.resolve(r)).mode,'payroll');
});
test('HR net transfer amount excludes fees and gross salary', () => {
  const r=hr([{姓名:'測試員工乙',給付總額:1600,匯款金額:1250,銀行:'017 兆豐銀行',帳號:'00000123456789'}]);
  Object.assign(r.formPayload.hrInfo,{cashTotal:1280,transferFeeTotal:30});assert.equal(success(api.resolve(r)).rows[0].amount,1250);
});
test('HR missing net amount never uses salary gross', () => bad(api.resolve(hr([{姓名:'測試員工乙',給付總額:1250,銀行代號:'017',帳號:'00000123456789'}])), 'amount_invalid','amount','hr:1'));
test('HR zero net remains zero and is blocked', () => bad(api.resolve(hr([{姓名:'測試員工乙',金額:0,匯款金額:1250,銀行代號:'017',帳號:'00000123456789'}])), 'amount_invalid','amount','hr:1'));
test('HR privacy rows require real private name supplement', () => {
  const r=hr([{序位:1,銀行別:'兆豐銀行',銀行代號:'017',銀行帳號:'00000001234567',金額:1250,備註:'10月薪資'}]);
  bad(api.resolve(r),'name_or_identity_required','name','hr:1');
  const out=success(api.resolve(r,{supplements:[{rowKey:'hr:1',name:'測試員工丙'}]}));assert.equal(out.rows[0].name,'測試員工丙');
});
test('identity alone accepted by payroll bank template', () => {
  const r=hr([{存款人身份證號:'A000000000',銀行代號:'017',銀行帳號:'00000001234567',金額:1250}]);assert.equal(success(api.resolve(r)).rows[0].identityNo,'A000000000');
});
test('exact 7 digit bank branch preserved', () => {
  const r=hr([{姓名:'測試員工丁',金額:1250,銀行代號:'0040123',銀行帳號:'00000001234567'}]);assert.equal(success(api.resolve(r)).rows[0].bankCode,'0040123');
});
test('non-Mega payroll needs exact branch code', () => {
  const r=hr([{姓名:'測試員工丁',金額:1250,銀行代號:'004',銀行帳號:'00000001234567'}]);bad(api.resolve(r),'bank_code_invalid');
  r.formPayload.hrInfo.rows[0].分行代號='0123';assert.equal(success(api.resolve(r)).rows[0].bankCode,'0040123');
});
test('branch numbers are not padded or inferred from branch names', () => {
  const r=hr([{姓名:'測試員工丁',金額:1250,銀行代號:'004',分行名稱:'測試分行',分行代號:123,銀行帳號:'00000001234567'}]);bad(api.resolve(r),'branch_code_invalid');
});
test('numeric bank/account identifiers are not repaired after zero loss', () => {
  bad(api.resolve(hr([{姓名:'測試員工丁',金額:1250,銀行代號:17,銀行帳號:'00000001234567'}])), 'text_type_required','bankCode');
  bad(api.resolve(hr([{姓名:'測試員工丁',金額:1250,銀行代號:'017',銀行帳號:1234567}])), 'text_type_required','account');
});
test('no guessed bank code from human bank/branch name', () => bad(api.resolve(payment({bankType:'other',bankName:'測試銀行',bankBranch:'第一分行'})), 'text_required','bankCode'));
test('one explicit bank code in name is accepted', () => assert.equal(success(api.resolve(payment({bankType:'other',bankName:'004 測試銀行'}))).rows[0].bankCode,'004'));
test('ambiguous bank codes are not chosen arbitrarily', () => bad(api.resolve(payment({bankType:'other',bankName:'004 或 005'})), 'text_required','bankCode'));
test('bank type disagreement blocks rather than overrides', () => {
  bad(api.resolve(payment({bankType:'mega',bankName:'004 測試銀行'})), 'bank_type_conflict');
  bad(api.resolve(payment({bankType:'other',bankName:'017 兆豐銀行'})), 'bank_type_conflict');
});
test('refund all bank rows resolve individually', () => {
  const rows=[{method:'銀行轉帳',accountName:'測試甲',accountNo:'000001',bankName:'017 兆豐銀行',refundAmount:600},{method:'bank',accountName:'測試乙',accountNo:'000002',bankName:'004 測試銀行',refundAmount:650}];
  const out=success(api.resolve(refund(rows)));assert.equal(out.rows.length,2);assert.equal(out.expectedTotal,1250);assert.deepEqual(out.sourceRowKeys,['refund:1','refund:2']);
});
test('mixed cash refunds explicitly excluded without relabelling row keys', () => {
  const rows=[{method:'現金',refundAmount:600},{method:'銀行轉帳',accountName:'測試乙',accountNo:'000002',bankName:'004 測試銀行',refundAmount:650}];
  const out=success(api.resolve(refund(rows)));assert.equal(out.expectedTotal,650);assert.deepEqual(out.sourceRowKeys,['refund:2']);assert.equal(out.summary.approvedPrincipal,1250);assert.equal(out.summary.cashPrincipal,600);assert.equal(out.excludedRows[0].rowKey,'refund:1');
});
test('no blank bank file for cash-only refund', () => bad(api.resolve(refund([{method:'現金',refundAmount:1250}])), 'no_bank_rows'));
test('refund method must be explicit', () => {const r=refund();delete r.formPayload.refundInfo.rows[0].method;bad(api.resolve(r),'refund_method_missing','method','refund:1');});
test('refund missing approved amount is not recomputed from received difference', () => {
  const r=refund();const row=r.formPayload.refundInfo.rows[0];delete row.refundAmount;Object.assign(row,{received:2000,receivable:750});bad(api.resolve(r),'amount_invalid','amount','refund:1');
});
test('refund zero is not replaced by source received total', () => {const r=refund();r.formPayload.refundInfo.rows[0].refundAmount=0;bad(api.resolve(r),'amount_invalid');});
test('refund engine issues mapped to original source indices after cash removal', () => {
  const rows=[{method:'現金',refundAmount:600},{method:'銀行轉帳',accountName:'測試乙',accountNo:'',bankName:'004 測試銀行',refundAmount:650}];
  const out=api.resolve(refund(rows));bad(out,'text_required','account','refund:2');assert.equal(out.issues.find(p=>p.field==='account').row,2);
});
test('bank and cash principals reconcile with entire approved refund', () => {
  const r=refund([{method:'現金',refundAmount:600},{method:'銀行轉帳',accountName:'測試乙',accountNo:'000002',bankName:'004 測試銀行',refundAmount:649}]);bad(api.resolve(r),'principal_mismatch');
});
test('declared HR total is independently reconciled', () => {const r=hr();r.formPayload.hrInfo.paymentTotal=1280;bad(api.resolve(r),'hr_total_mismatch');});
test('authoritative empty arrays never fall back to stale duplicated rows', () => {
  const h=hr();h.formPayload.hrRows=copy(h.formPayload.hrInfo.rows);h.formPayload.hrInfo.rows=[];bad(api.resolve(h),'source_rows_missing');
  const r=refund();r.formPayload.refundRows=copy(r.formPayload.refundInfo.rows);r.formPayload.refundInfo.rows=[];bad(api.resolve(r),'source_rows_missing');
});
test('legacy rows accepted only when authoritative array absent', () => {
  const h=hr();h.formPayload.hrRows=h.formPayload.hrInfo.rows;delete h.formPayload.hrInfo.rows;success(api.resolve(h));
  const r=refund();r.formPayload.refundRows=r.formPayload.refundInfo.rows;delete r.formPayload.refundInfo.rows;success(api.resolve(r));
});
test('missing array blocks use of HR/refund aggregate placeholders', () => {
  const h=hr();delete h.formPayload.hrInfo.rows;bad(api.resolve(h),'source_rows_missing');
  const r=refund();delete r.formPayload.refundInfo.rows;bad(api.resolve(r),'source_rows_missing');
});
test('malformed or sparse source rows block all output', () => {
  for(const rows of [[null],[[]],new Array(1)])bad(api.resolve(hr(rows)),'source_row_invalid');
});
test('private bank supplement can expand exact matching known bank to branch', () => {
  const r=hr([{姓名:'測試員工丁',金額:1250,銀行代號:'004',銀行帳號:'00000001234567'}]);
  assert.equal(success(api.resolve(r,{supplements:[{rowKey:'hr:1',bankCode:'0040123'}]})).rows[0].bankCode,'0040123');
});
test('supplement must not overwrite existing holder or bank', () => {
  bad(api.resolve(payment(),{supplements:[{rowKey:'payment:1',name:'其他測試戶'}]}),'supplement_name_conflict');
  bad(api.resolve(payment(),{supplements:[{rowKey:'payment:1',bankCode:'0040123'}]}),'supplement_bank_conflict');
});
test('identical private supplements are harmless', () => success(api.resolve(payment(),{supplements:[{rowKey:'payment:1',name:'測試戶甲',bankCode:'017'}]})));
test('supplements cannot alter principal or approved account', () => {
  const out=success(api.resolve(payment(),{supplements:[{rowKey:'payment:1',amount:999,account:'999999',identityNo:'OTHER'}]}));assert.equal(out.rows[0].amount,1250);assert.equal(out.rows[0].account,'00000001234567');assert.equal(out.rows[0].identityNo,'');
});
test('invalid duplicate or foreign supplements block', () => {
  for(const supplements of [{},[null],new Array(1),[{rowKey:'hr:1'}],[{rowKey:'payment:0'}],[{rowKey:'payment:2'}],[{rowKey:'payment:1'},{rowKey:'payment:1'}]]) {
    const out=api.resolve(payment(),{supplements});assert.equal(out.ok,false);assert(out.issues.some(p=>p.field==='supplements'));
  }
});
test('cash refund supplement is never transferred to another bank row', () => {
  const r=refund([{method:'現金',refundAmount:600},{method:'銀行轉帳',accountName:'測試乙',accountNo:'000002',bankName:'004 測試銀行',refundAmount:650}]);
  bad(api.resolve(r,{supplements:[{rowKey:'refund:1',name:'測試甲'}]}),'cash_row_supplement');
});
test('valid snapshot has no exposed plaintext sourceVersion or sourceDigest', () => {
  const out=success(api.resolve(payment()));assert(!Object.hasOwn(out,'sourceVersion'));assert(!Object.hasOwn(out,'sourceDigest'));assert.equal(typeof out.snapshotText,'string');
});
test('canonical snapshot stable across object key insertion order', () => {
  const a=payment();const b=Object.fromEntries(Object.entries(copy(a)).reverse());assert.equal(success(api.resolve(a)).snapshotText,success(api.resolve(b)).snapshotText);
});
test('changed bank data or request context invalidates snapshot', () => {
  const base=success(api.resolve(payment())).snapshotText;
  for(const changes of [{bankNo:'00000001234568'},{payee:'測試戶乙'},{bankName:'0171234 兆豐銀行'},{amt:1300},{expectedPayDate:'2026/10/21'},{eid:'synthetic-other-entity'},{bankFeeAmount:0},{feeBearer:'recipient'},{ver:4},{updatedAt:'2026-10-20'}]) {
    assert.notEqual(success(api.resolve(payment(changes))).snapshotText,base);
  }
  const r=payment();r.steps[0].uid='synthetic-other-reviewer';assert.notEqual(success(api.resolve(r)).snapshotText,base);
});
test('source objects and supplements never mutated', () => {
  const r=payment();const opts={supplements:[{rowKey:'payment:1',name:'測試戶甲'}]};const before=JSON.stringify({r,opts});success(api.resolve(r,opts));assert.equal(JSON.stringify({r,opts}),before);
});
test('formula-like holder stays literal source text', () => {
  assert.equal(success(api.resolve(payment({payee:'=1+1'}))).rows[0].name,'=1+1');
});
test('browser UMD works with bank engine global', () => {
  const root=path.join(__dirname,'../assets/engines/');const context=vm.createContext({window:{}});
  vm.runInContext(fs.readFileSync(root+'mega-remittance-engine.js','utf8'),context);
  vm.runInContext(fs.readFileSync(root+'mega-remittance-source.js','utf8'),context);
  assert.equal(context.window.FinanceMegaRemittanceSource.resolve(payment()).ok,true);
});
test('browser missing bank engine fails closed', () => {
  const context=vm.createContext({window:{}});vm.runInContext(fs.readFileSync(path.join(__dirname,'../assets/engines/mega-remittance-source.js'),'utf8'),context);
  bad(context.window.FinanceMegaRemittanceSource.resolve(payment()),'bank_engine_missing');
});

console.log('Mega remittance source: '+count+' behavioral checks passed (synthetic data only).');
