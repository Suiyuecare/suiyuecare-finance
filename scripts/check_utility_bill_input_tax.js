#!/usr/bin/env node
'use strict';

// Execute the shipped calculation/review functions with anonymous, in-memory
// rows. No network, session credentials, database writes or generated build.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = process.env.FINANCE_TEST_ROOT ? path.resolve(process.env.FINANCE_TEST_ROOT) : path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));

function functionSource(name) {
  const marker = 'function ' + name + '(';
  let start = source.indexOf(marker);
  const windowMarker = 'window.' + name + '=function(';
  const windowFunction = start < 0;
  if (windowFunction) start = source.indexOf(windowMarker);
  assert.ok(start >= 0, 'Missing production function: ' + name);
  const opening = source.indexOf('{', start);
  let depth = 0;
  for (let i = opening; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1).replace(windowMarker, marker);
  }
  throw new Error('Unclosed production function: ' + name);
}

const accounts = Object.fromEntries([
  ['6202', '水電瓦斯費'], ['6205', '辦公用品'], ['6221', '勞務費'],
  ['6207', '修繕費'], ['6299', '其他營業費用'], ['6233', '其他費用'],
  ['1111', '零用金'], ['1112', '銀行存款'], ['6290', '手續費']
].map(([c, n]) => [c, { c, n }]));
let dom = Object.create(null);
let postedView = null;
const runtime = {
  console, Math, Date, JSON, Set, Map,
  num: value => Number(value || 0), BUSINESS_TAX_RATE: 0.05,
  cloneSettingValue: clone,
  S: { user: { id: 'utility-reviewer', n: '匿名執行長', role: 'ceo' }, lazyRows: [] },
  document: { activeElement: null },
  el: id => dom[id] || null,
  accountByCode: code => accounts[String(code)] || null,
  acctName: code => (accounts[String(code)] || {}).n || String(code),
  expenseDebitAccounts: () => [accounts['6205']],
  postedAccountingView: () => postedView,
  // Account selection and invoice identity are unrelated boundaries. Tax,
  // amount calculation, aggregation, collection and audit are real functions.
  inferDebitAccountForLine: () => ({ code: '6202', name: '水電瓦斯費', reason: 'Anonymous account fixture' }),
  normalizeLazyInvoiceIdentity: () => ({ invoiceNo: '', buyerTaxId: '', sellerTaxId: '' }),
  todayIso: () => '2026-09-09', normDate: value => value,
  requestTypeLabel: () => '費用報銷',
  renderLazySheet() {}, applyLazySummary() {}, syncLazyBankFeeRow() {},
  alert(message) { throw new Error('Unexpected alert: ' + message); }
};
const functionNames = [
  'accountingUtilityBillDetected', 'accountingLaborFeeDetected',
  'accountingManualActorSnapshot', 'accountingManualFieldNames', 'accountingLineManualFields',
  'accountingLineFieldIsHuman', 'accountingComparableValue', 'accountingChangedFields',
  'preserveAccountingManualAuthority', 'markAccountingManualAuthority',
  'lazyHasValue', 'normalizeLazyTaxMode', 'lazyTaxMode', 'lazyAmountParts',
  'lazyNetAmount', 'lazyTaxAmount', 'lazyRowTotal', 'syncLazyAmountDraftDom',
  'applyLazyEditValue', 'finalizeLazyAccountingDrafts', 'invoiceRowsFromOcr',
  'expenseInvoiceReviewGroups', 'requestTaxAmount', 'requestGrossAmount', 'requestNetTaxSplit',
  'sourceRowsForAccounting', 'controlledCreditAccountForRequest', 'defaultCreditAccountForLine',
  'accountingLineCreditAccount', 'accountingLineIsSystemFee', 'principalAccountingLines',
  'requestLedgerPostedAt', 'requestPostingLocked',
  'normalizeAccountingLine', 'buildAccountingLines', 'collectAccountingLinesFromDom',
  'entriesFromAccountingLines', 'syncAccountingLineAmountInputs'
];
vm.createContext(runtime);
vm.runInContext(functionNames.map(functionSource).join('\n'), runtime, { filename: 'production-utility-functions.js' });

let passed = 0;
const failures = [];
function check(label, run) {
  try { run(); passed++; process.stdout.write('PASS: ' + label + '\n'); }
  catch (error) { failures.push(label + ': ' + error.message); process.stderr.write('FAIL: ' + label + ': ' + error.message + '\n'); }
}
function amounts(actual, net, tax, gross) {
  assert.deepEqual([actual.net ?? actual.netAmount, actual.tax ?? actual.taxAmount, actual.gross ?? actual.grossAmount], [net, tax, gross]);
}
function row(item, gross = 1050) {
  const net = Math.round(gross / 1.05);
  return { item, qty: 1, unitPrice: gross, grossAmount: gross, total: gross,
    netAmount: net, taxAmount: gross - net, taxMode: 'gross_inclusive', date: '2026/09/09', file: 'anonymous-bill.png' };
}
function request(lines, lazyRows) {
  return { id: 'anonymous-utility', no: 'ANON-UTILITY-001', type: 'expense_reimbursement',
    eid: 'anonymous-entity', dc: 'anonymous-department', amt: 1050, cr: '1112', crN: '銀行存款',
    desc: '水費、電費及其他費用混合申請', formPayload: lines ? { accountingLines: clone(lines) } : { lazyRows: clone(lazyRows || []) } };
}
function accountingLine(item, human = false) {
  const line = { ...row(item), id: 'line_1', description: item, source: 'expense_detail',
    debitAccount: '6202', debitAccountName: '水電瓦斯費', creditAccount: '1112', creditAccountName: '銀行存款' };
  delete line.item;
  if (human) Object.assign(line, { manualOverride: true, valueAuthority: 'human',
    manualFields: ['netAmount', 'taxAmount', 'grossAmount'], manualOverrideBy: { id: 'earlier-reviewer' },
    manualOverrideAt: '2026-09-08T00:00:00Z', manualOverrideSource: 'earlier_review',
    manualOverrideHistory: [{ operationId: 'earlier-operation', at: '2026-09-08T00:00:00Z', source: 'earlier_review', changes: {} }] });
  return line;
}
function reviewedInputs(net, tax, gross, prefix = 'detail-acct-line') {
  dom = Object.create(null);
  for (const [field, value] of Object.entries({ net, tax, gross, dr: '6202', cr: '1112' })) dom[prefix + '-' + field + '-0'] = { value: String(value) };
}

for (const title of ['水費', '九月水費單', '臺灣電力公司電費通知單', '水電費', '電 費 單']) {
  check('utility description recognized: ' + title, () => assert.equal(runtime.accountingUtilityBillDetected({ item: title }), true));
}
for (const title of ['瓦斯費', '郵電費', '電信費', '電話費', '水電工程', '水費管線修繕', '電費設備維修',
  '水電安裝', '水電材料', '水電設備', '電費補助', '電費補貼', '飲水機', '電腦', '台電', '自來水管']) {
  check('non-utility is not zero-tax by keyword/account: ' + title, () => assert.equal(runtime.accountingUtilityBillDetected({ item: title, debitAccount: '6202', debitAccountName: '水電瓦斯費' }), false));
}
check('6202 and an AI water suggestion alone do not classify a bill', () => assert.equal(runtime.accountingUtilityBillDetected({ debitAccount: '6202', accountingSubjectSuggestion: '水費', reason: '水費' }), false));
check('the first actual item wins over another water description', () => assert.equal(runtime.accountingUtilityBillDetected({ item: '文具用品', description: '水費' }), false));
check('whitespace-only item falls back to description', () => assert.equal(runtime.accountingUtilityBillDetected({ item: '  ', description: '水費單' }), true));
check('label and itemName are supported row identifiers', () => { assert.equal(runtime.accountingUtilityBillDetected({ label: '水費' }), true); assert.equal(runtime.accountingUtilityBillDetected({ itemName: '電費' }), true); });

check('136 water bill remains 136 expense with zero tax', () => amounts(runtime.lazyAmountParts(row('水費', 136)), 136, 0, 136));
check('1050 electricity bill uses total, never adds another five percent', () => amounts(runtime.lazyAmountParts(row('電費')), 1050, 0, 1050));
check('water net-only row does not have five percent added', () => amounts(runtime.lazyAmountParts({ item: '水費', netAmount: 136, taxMode: 'net_exclusive' }), 136, 0, 136));
check('water with only net and stated tax preserves their original billed total', () => amounts(runtime.lazyAmountParts({ item: '水費', netAmount: 130, taxAmount: 6, taxMode: 'net_exclusive' }), 136, 0, 136));
check('explicit zero gross does not resurrect a stale total field', () => amounts(runtime.lazyAmountParts({ item: '水費', grossAmount: 0, total: 136, netAmount: 130, taxAmount: 6 }), 0, 0, 0));
check('manual form amounts still follow fixed utility zero-tax policy', () => amounts(runtime.lazyAmountParts({ ...row('電費'), manualOverride: true, valueAuthority: 'human', manualFields: ['netAmount', 'taxAmount', 'grossAmount'] }), 1050, 0, 1050));
check('ordinary invoice and gas on 6202 retain their tax', () => {
  for (const name of ['文具用品', '瓦斯費', '水電工程', '飲水機', '電腦']) amounts(runtime.lazyAmountParts({ ...row(name), debitAccount: '6202' }), 1000, 50, 1050);
});

for (const [field, value, expected] of [['taxAmount', 99, 1050], ['grossAmount', 136, 136], ['netAmount', 136, 136], ['qty', 2, 2100], ['unitPrice', 136, 136], ['taxMode', 'net_exclusive', 1050]]) {
  check('utility form edit ' + field + ' keeps zero tax and correct total', () => {
    runtime.S.lazyRows = [row('電費')];
    runtime.applyLazyEditValue(0, field, value, true, false);
    amounts(runtime.S.lazyRows[0], expected, 0, expected);
    assert.equal(runtime.S.lazyRows[0].total, expected);
  });
}
check('renaming an ordinary row to water normalizes every edit entry point', () => {
  runtime.S.lazyRows = [row('文具用品')];
  runtime.applyLazyEditValue(0, 'item', '水費', true, false);
  amounts(runtime.S.lazyRows[0], 1050, 0, 1050);
});
check('touching unchanged quantity on an old OCR row never drops the original tax from the bill', () => {
  runtime.S.lazyRows = [{ ...row('水費', 136), unitPrice: 130 }];
  runtime.applyLazyEditValue(0, 'qty', 1, true, false);
  amounts(runtime.S.lazyRows[0], 136, 0, 136);
});
check('old OCR net-price quantity edit uses the billed gross unit price', () => {
  runtime.S.lazyRows = [{ ...row('水費', 136), unitPrice: 130 }];
  runtime.applyLazyEditValue(0, 'qty', 2, true, false);
  amounts(runtime.S.lazyRows[0], 272, 0, 272);
});
check('explicit zero bill input remains zero after the next normalization', () => {
  runtime.S.lazyRows = [row('水費', 136)];
  runtime.applyLazyEditValue(0, 'grossAmount', 0, true, false);
  amounts(runtime.S.lazyRows[0], 0, 0, 0);
  amounts(runtime.lazyAmountParts(runtime.S.lazyRows[0]), 0, 0, 0);
});
check('in-focus utility draft flush keeps zero tax and an auditable edit', () => {
  runtime.S.lazyRows = [row('電費')];
  runtime.applyLazyEditValue(0, 'grossAmount', 136, false, false);
  runtime.finalizeLazyAccountingDrafts();
  const saved = runtime.S.lazyRows[0];
  amounts(saved, 136, 0, 136);
  assert.ok(saved.manualOverrideHistory.length > 0);
  assert.equal(saved.manualOverrideBy.id, 'utility-reviewer');
});

check('actual OCR mapper converts a water bill to total expense', () => {
  const parsed = runtime.invoiceRowsFromOcr({ invoice: { description: '水費單', amount_excluding_tax: 130, tax_amount: 6, total_amount: 136, items: [] } }, 'anonymous-water.png');
  amounts(parsed[0], 136, 0, 136);
});
check('actual OCR mapper preserves mixed non-utility item tax', () => {
  const parsed = runtime.invoiceRowsFromOcr({ invoice: { description: '水費及文具', items: [
    { item_name: '電費', quantity: 1, unit_price: 1000, total_amount: 1050 },
    { item_name: '文具用品', quantity: 1, unit_price: 1000, total_amount: 1050 }
  ] } }, 'anonymous-mixed.png');
  amounts(parsed[0], 1050, 0, 1050);
  amounts(parsed[1], 1000, 50, 1050);
});
check('OCR two-unit water bill keeps the exact total and gross unit price', () => {
  const parsed = runtime.invoiceRowsFromOcr({ invoice: { amount_excluding_tax: 130, tax_amount: 6, total_amount: 136,
    items: [{ item_name: '水費', quantity: 2, unit_price: 65, total_amount: 136 }] } }, 'anonymous-water.png');
  amounts(parsed[0], 136, 0, 136);
  assert.equal(parsed[0].unitPrice, 68);
  runtime.S.lazyRows = parsed;
  runtime.applyLazyEditValue(0, 'qty', 3, true, false);
  amounts(runtime.S.lazyRows[0], 204, 0, 204);
});
check('form DOM enforces zero-tax readonly and restores ordinary invoice editing', () => {
  const input = value => ({ value: String(value), attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } });
  dom = { 'lazy-net-0': input(130), 'lazy-tax-0': input(6), 'lazy-gross-0': input(136),
    'lazy-mode-0': input('gross_inclusive'), 'lazy-utility-note-0': { hidden: true } };
  runtime.syncLazyAmountDraftDom(0, { ...row('水費', 136), netAmount: 136, taxAmount: 0 });
  assert.equal(dom['lazy-tax-0'].readOnly, true);
  assert.equal(dom['lazy-mode-0'].disabled, true);
  assert.equal(dom['lazy-utility-note-0'].hidden, false);
  assert.equal(Number(dom['lazy-tax-0'].value), 0);
  runtime.syncLazyAmountDraftDom(0, row('文具用品'));
  assert.equal(dom['lazy-tax-0'].readOnly, false);
  assert.equal(dom['lazy-mode-0'].disabled, false);
  assert.equal(dom['lazy-utility-note-0'].hidden, true);
  assert.equal(Number(dom['lazy-tax-0'].value), 50);
  dom = Object.create(null);
});
check('CEO amount input handler preserves the bill and zeroes even a forged positive tax input', () => {
  reviewedInputs(1000, 99, 1050);
  dom['detail-acct-line-gross-0'].dataset = { utilityBill: 'true' };
  runtime.syncAccountingLineAmountInputs('detail-acct-line', 0, 'taxAmount');
  amounts({ net: Number(dom['detail-acct-line-net-0'].value), tax: Number(dom['detail-acct-line-tax-0'].value), gross: Number(dom['detail-acct-line-gross-0'].value) }, 1050, 0, 1050);
  dom['detail-acct-line-net-0'].value = '136';
  runtime.syncAccountingLineAmountInputs('detail-acct-line', 0, 'netAmount');
  amounts({ net: Number(dom['detail-acct-line-net-0'].value), tax: Number(dom['detail-acct-line-tax-0'].value), gross: Number(dom['detail-acct-line-gross-0'].value) }, 136, 0, 136);
  dom = Object.create(null);
});
check('CEO invoice review never resurrects old positive tax after computed zero', () => {
  const water = { ...row('水費', 136), taxMode: 'exempt' };
  const groups = runtime.expenseInvoiceReviewGroups(request(null, [water, { ...row('文具用品'), file: 'anonymous-stationery.png' }]));
  amounts({ net: groups[0].net, tax: groups[0].tax, gross: groups[0].total }, 136, 0, 136);
  amounts({ net: groups[1].net, tax: groups[1].tax, gross: groups[1].total }, 1000, 50, 1050);
});
check('changing utility back to ordinary then editing net and tax preserves both inputs', () => {
  runtime.S.lazyRows=[row('文具用品')];
  runtime.applyLazyEditValue(0,'item','電費',true,false);
  runtime.applyLazyEditValue(0,'item','文具用品',true,false);
  runtime.applyLazyEditValue(0,'netAmount',1000,true,false);
  runtime.applyLazyEditValue(0,'taxAmount',50,true,false);
  amounts(runtime.S.lazyRows[0],1000,50,1050);
});
check('zero utility gross does not resurrect stale amounts in grouped review or accounting lines', () => {
  const zero={...row('水費',136),grossAmount:0};
  const groups=runtime.expenseInvoiceReviewGroups(request(null,[zero]));
  amounts({net:groups[0].net,tax:groups[0].tax,gross:groups[0].total},0,0,0);
  assert.equal(runtime.buildAccountingLines(request(null,[zero])).length,0);
});
check('historical human source row waits for a new review before changing its audit-authoritative amounts', () => {
  const old=accountingLine('電費',true);old.item=old.description;
  const r=request(null,[old]);
  const built=runtime.buildAccountingLines(r)[0];
  amounts(built,1000,50,1050);
  reviewedInputs(1050,0,1050);
  const saved=runtime.collectAccountingLinesFromDom(r,'detail-acct-line')[0];
  amounts(saved,1050,0,1050);
  assert.equal(saved.manualOverrideHistory.length,2);
  assert.equal(saved.manualOverrideHistory[1].changes.taxAmount.before,50);
});
check('posted original receipt review and tax summary preserve historical source tax without mutation', () => {
  const old=row('水費',136),r={...request(null,[old]),status:'completed',voucherId:'posted-water'};
  const before=JSON.stringify(r);
  const groups=runtime.expenseInvoiceReviewGroups(r);
  amounts({net:groups[0].net,tax:groups[0].tax,gross:groups[0].total},130,6,136);
  assert.equal(runtime.requestTaxAmount(r),6);
  assert.equal(JSON.stringify(r),before);
});
check('advance work copy marked completed uses freshly reviewed tax for new posting, not historical source tax', () => {
  const line={...accountingLine('水費',true),grossAmount:136,netAmount:136,taxAmount:0};
  const r={...request([line]),type:'advance_request',status:'completed',ledgerPostedAt:'2026-09-09'};
  r.formPayload.lazyRows=[row('水費',136)];
  amounts(runtime.requestNetTaxSplit(r,136,true),136,0,136);
  assert.equal(runtime.requestTaxAmount(r),6,'historical receipt display still has original tax');
  delete r.formPayload.accountingLines;
  amounts(runtime.requestNetTaxSplit(r,136,true),136,0,136);
});
check('posting tax split refuses unresolved human utility amounts even on a completed work copy', () => {
  const r={...request([accountingLine('水費',true)]),status:'completed'};
  assert.throws(()=>runtime.requestNetTaxSplit(r,1050,true),/覆核/);
});
check('request tax summary includes only the non-utility line', () => assert.equal(runtime.requestTaxAmount(request(null, [row('水費', 136), row('文具用品')])), 50));
check('new accounting line conversion shares the zero-tax calculation', () => {
  const lines = runtime.buildAccountingLines(request(null, [row('水費', 136), row('文具用品')]));
  amounts(lines[0], 136, 0, 136);
  amounts(lines[1], 1000, 50, 1050);
});
check('non-human historical accounting suggestion normalizes utility tax', () => amounts(runtime.normalizeAccountingLine(accountingLine('電費'), request(), 0), 1050, 0, 1050));
check('historic human-reviewed tax remains intact until a new explicit review', () => {
  const old = accountingLine('電費', true), before = JSON.stringify(old);
  const normalized = runtime.normalizeAccountingLine(old, request(), 0);
  amounts(normalized, 1000, 50, 1050);
  assert.equal(normalized.manualOverrideHistory.length, 1);
  assert.equal(JSON.stringify(old), before);
});
for (const role of ['ceo', 'accountant']) {
  check(role + ' collection zeroes utility tax with a new human audit event', () => {
    runtime.S.user = { id: 'utility-' + role, n: '匿名覆核者', role };
    const old = accountingLine('電費', true), r = request([old]);
    reviewedInputs(1000, 50, 1050);
    const saved = runtime.collectAccountingLinesFromDom(r, 'detail-acct-line')[0];
    amounts(saved, 1050, 0, 1050);
    assert.equal(r.amt, 1050);
    assert.equal(saved.manualOverrideHistory.length, 2);
    assert.deepEqual(clone(saved.manualOverrideHistory[0]), old.manualOverrideHistory[0]);
    const event = saved.manualOverrideHistory[1];
    assert.equal(event.changes.taxAmount.before, 50);
    assert.equal(event.changes.taxAmount.after, 0);
    assert.equal(event.changes.netAmount.before, 1000);
    assert.equal(event.changes.netAmount.after, 1050);
    assert.equal(event.actor.id, 'utility-' + role);
    assert.ok(event.operationId && event.at);
    const entries = runtime.entriesFromAccountingLines(r, 1050, 0);
    assert.ok(!entries.some(entry => entry.ac === '1144'));
    assert.equal(entries.filter(entry => entry.t === 'dr').reduce((sum, entry) => sum + entry.amt, 0), 1050);
    assert.equal(entries.filter(entry => entry.t === 'cr').reduce((sum, entry) => sum + entry.amt, 0), 1050);
  });
}
check('unreviewed historical human utility positive tax blocks posting', () => {
  const r = request([accountingLine('電費', true)]), before = JSON.stringify(r);
  assert.throws(() => runtime.entriesFromAccountingLines(r, 1050, 0), /水費|電費|水電|覆核/);
  assert.equal(JSON.stringify(r), before);
});
check('mixed review preserves ordinary manually reviewed invoice tax', () => {
  const old = accountingLine('文具用品', true), r = request([old]);
  reviewedInputs(1000, 50, 1050);
  const saved = runtime.collectAccountingLinesFromDom(r, 'detail-acct-line')[0];
  amounts(saved, 1000, 50, 1050);
  const entries = runtime.entriesFromAccountingLines(r, 1050, 0);
  assert.equal(entries.find(entry => entry.ac === '1144').amt, 50);
});
check('posted accounting view is authoritative and is not retroactively changed', () => {
  const old = accountingLine('水費', true), r = { ...request([old]), status: 'completed' };
  postedView = { status: 'ready', lines: [clone(old)] };
  const before = JSON.stringify(postedView);
  try { amounts(runtime.buildAccountingLines(r)[0], 1000, 50, 1050); assert.equal(JSON.stringify(postedView), before); }
  finally { postedView = null; }
});
for (const locked of [{ status: 'completed' }, { voucherId: 'anonymous-posted-voucher' }, { ledgerPostedAt: '2026-09-08' }, { postingLockedAt: '2026-09-08' }]) {
  check('posted/locked historical values remain unchanged: ' + Object.keys(locked)[0], () => {
    const r = { ...request([accountingLine('水費')]), ...locked };
    const normalized = runtime.normalizeAccountingLine(r.formPayload.accountingLines[0], r, 0);
    amounts(normalized, 1000, 50, 1050);
    const entries = runtime.entriesFromAccountingLines(r, 1050, 0);
    assert.equal(entries.find(entry => entry.ac === '1144').amt, 50);
  });
}

if (failures.length) throw new Error(failures.length + ' utility bill checks failed:\n' + failures.join('\n'));
process.stdout.write('OK: ' + passed + ' utility bill input-tax checks passed\n');
