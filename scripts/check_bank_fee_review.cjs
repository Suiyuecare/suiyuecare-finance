#!/usr/bin/env node
'use strict';
// Regression harness uses production functions, with fictional data only.
// Set FINANCE_TEST_ROOT when running this file outside scripts/.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert/strict');
const root = process.env.FINANCE_TEST_ROOT || path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
let count = 0;
const results = [];
function test(name, fn) {
  try { fn(); count++; results.push({ name, passed: true }); }
  catch (error) { process.stderr.write(`FAIL: ${name}\n${error.stack}\n`); process.exitCode = 1; results.push({ name, passed: false }); }
}
function extract(name) {
  const marker = 'function ' + name + '(';
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`Missing production function ${name}`);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`Unclosed production function ${name}`);
}
const form = {
  'nr-ent': { value: 'EXAMPLE_ENTITY' },
  'hr-bank-type': { value: 'other' },
  'hr-fee-bearer': { value: '己方支出' }
};
const context = vm.createContext({
  console,
  BANK_TRANSFER_FEES: { EXAMPLE_ENTITY: 15 },
  BANK_TRANSFER_FEE: 15,
  S: { nrType: 'hr_expense_request', hrRows: [] },
  financeFormEngine: () => null,
  financeReportEngine: () => null,
  entityOfDept: () => 'EXAMPLE_ENTITY',
  currentUserEntityId: () => 'EXAMPLE_ENTITY',
  el: id => form[id] || null,
  laborElectronicMarker: r => Boolean(r && r.__testElectronicLabor),
  withTenantColumn: (row, tenantId) => Object.assign(row, { tenant_id: tenantId || 'EXAMPLE_TENANT' }),
  activeDataEnvironment: () => 'test'
});
context.laborElectronicSelected = () => false;
Object.assign(context, {
  normalizeFiles: value => value || [], fromIsoDate: value => value || '',
  jsonArrayValue: value => value || [], rowDataEnvironment: () => 'test',
  rowTenantId: () => 'EXAMPLE_TENANT'
});
const names = [
  'num', 'fmt', 'escAttr', 'requestFeeBearer', 'isMegaBankRecipient',
  'requestFeeEntity', 'getBankTransferFee', 'requestStoredBankFeeAmount',
  'requestBankFeeAmount', 'requestCashPostedAt', 'requestLedgerPostedAt',
  'hrBankTypeValue', 'hrFeeBearerValue', 'hrTransferFeePerRow',
  'hrDigitsOnly', 'hrLooksLikeBankAccountValue', 'hrRowAmount',
  'hrRowIsMegaBank', 'hrTransferFeeForRow', 'hrTransferFeeRows',
  'hrHasNonMegaTransferRows', 'hrTransferFeeTotal', 'hrTotalWithTransferFee',
  'requestBankFeeReviewHtml', 'reqDbRow', 'mapReq', 'collectPaymentInfo'
];
vm.runInContext(names.map(extract).join('\n'), context, { filename: 'production-bank-fee-functions.js' });
const own = { eid: 'EXAMPLE_ENTITY', bankType: 'other', bankName: 'Example Bank', feeBearer: '己方支出', amt: 3600, type: 'payment_request' };
const counter = Object.assign({}, own, { feeBearer: '對方支出' });
const htmlOf = r => context.requestBankFeeReviewHtml(r);
const elementText = (html, attr) => {
  const match = html.match(new RegExp('<[^>]+\\b' + attr + '(?:=(?:"[^"]*"|\'[^\']*\'|[^ >]+))?[^>]*>([\\s\\S]*?)<\\/'));
  assert.ok(match, `Missing ${attr} element`);
  return match[1].replace(/<[^>]*>/g, '').trim();
};
const bankCases = [
  ['017 bank code', { bankName: '017' }, true],
  ['Chinese bank name', { bankName: '兆豐銀行' }, true],
  ['English bank name', { bankName: 'Mega International Commercial Bank' }, true],
  ['snake-case bank fields', { bank_name: '017 兆豐銀行' }, true],
  ['unrelated bank', { bankName: 'Example First Bank' }, false],
  ['Chinese negative bank name', { bankName: '非兆豐銀行' }, false],
  ['English negative bank name', { bankName: 'nonmega' }, false],
  ['no substring code match', { bankName: 'Example Bank 1017' }, false],
  ['explicit other beats misleading text', { bankType: 'other', bankName: '兆豐銀行' }, false],
  ['explicit mega beats generic label', { bankType: 'mega', bankName: 'Example Bank' }, true],
  ['snake explicit other beats text', { bank_type: 'other', bank_name: '017 兆豐銀行' }, false],
  ['snake explicit mega recognized', { bank_type: 'mega' }, true]
];
for (const [label, input, expected] of bankCases) test('bank classification: ' + label, () => assert.equal(context.isMegaBankRecipient(input), expected));

test('stored fee absent is distinguishable from zero', () => assert.equal(context.requestStoredBankFeeAmount(own), null));
test('stored camel zero is retained', () => assert.equal(context.requestStoredBankFeeAmount({ bankFeeAmount: 0 }), 0));
test('stored snake zero is retained', () => assert.equal(context.requestStoredBankFeeAmount({ bank_fee_amount: 0 }), 0));
test('stored numeric string is usable', () => assert.equal(context.requestStoredBankFeeAmount({ bank_fee_amount: '30' }), 30));
test('null stored amount remains unknown', () => assert.equal(context.requestStoredBankFeeAmount({ bankFeeAmount: null, bank_fee_amount: null }), null));
test('empty stored amount remains unknown', () => assert.equal(context.requestStoredBankFeeAmount({ bankFeeAmount: '' }), null));
test('new own-party ordinary transfer derives entity fee', () => assert.equal(context.requestBankFeeAmount(own), 15));
test('new counterparty transfer has no company fee', () => assert.equal(context.requestBankFeeAmount(counter), 0));
test('new mega transfer has zero fee', () => assert.equal(context.requestBankFeeAmount(Object.assign({}, own, { bankType: 'mega' })), 0));
test('negative Mega label does not erase own-party transfer fee', () => assert.equal(context.requestBankFeeAmount(Object.assign({}, own, { bankType: '', bankName: '非兆豐銀行' })), 15));
test('stored zero is not recalculated after settings increase', () => {
  context.BANK_TRANSFER_FEES.EXAMPLE_ENTITY = 25;
  assert.equal(context.requestBankFeeAmount(Object.assign({}, own, { bankFeeAmount: 0 })), 0);
  assert.equal(context.requestBankFeeAmount(Object.assign({}, own, { bank_fee_amount: 0 })), 0);
  context.BANK_TRANSFER_FEES.EXAMPLE_ENTITY = 15;
});
test('stored multi-transfer amount is not replaced by current per-row fee', () => assert.equal(context.requestBankFeeAmount(Object.assign({}, own, { type: 'hr_expense_request', bankName: '非兆豐銀行', bankFeeAmount: 30 })), 30));
test('inconsistent mega label cannot silently erase persisted positive fee', () => assert.equal(context.requestBankFeeAmount(Object.assign({}, own, { bankType: 'mega', bankFeeAmount: 30 })), 30));
test('inconsistent counterparty label cannot silently erase persisted positive fee', () => assert.equal(context.requestBankFeeAmount(Object.assign({}, counter, { bankFeeAmount: 30 })), 30));
test('legacy bank text keeps own-party choice', () => assert.equal(context.requestFeeBearer({ bank_account: 'Example Bank / 手續費 己方支出' }), '己方支出'));

const rows = [
  { '銀行別': 'Example Bank A', '銀行代號': '004', '金額': '1200' },
  { '銀行別': '非兆豐銀行', '銀行代號': '008', '金額': '2400' },
  { '銀行別': '兆豐銀行', '銀行代號': '017', '金額': '500' },
  { '銀行別': 'Example Bank A', '銀行代號': '004', '金額': '0' }
];
for (const [label, row, expected] of [
  ['branch code', { '銀行代號': '0171234' }, true],
  ['normalized branch code', { '銀行代號': '017-1234' }, true],
  ['bank code alias', { bank_code: '0171234' }, true],
  ['bank name alias', { bank_name: 'Mega Bank' }, true],
  ['negative alias overrides inferred code', { bank_code: '017', bank_name: '非兆豐銀行' }, false],
  ['account number is not bank code', { '銀行別': 'Example Bank', '銀行帳號': '017 1234567' }, false]
]) test('HR bank source parity: ' + label, () => assert.equal(context.hrRowIsMegaBank(row), expected));
test('HR fee applies once to each positive non-Mega row', () => assert.equal(context.hrTransferFeeRows(rows), 2));
test('HR mixed-bank fee total is sum of eligible rows', () => assert.equal(context.hrTransferFeeTotal(rows), 30));
test('HR transfer total adds fee once', () => assert.equal(context.hrTotalWithTransferFee(rows), 4130));
test('HR zero amount row has zero fee', () => assert.equal(context.hrTransferFeeForRow(rows[3]), 0));
test('HR counterparty choice removes only company fee', () => {
  form['hr-fee-bearer'].value = '對方支出';
  assert.equal(context.hrTransferFeeTotal(rows), 0);
  assert.equal(context.hrTotalWithTransferFee(rows), 4100);
  form['hr-fee-bearer'].value = '己方支出';
});
test('HR counterparty retains positive non-Mega row count required by resubmission', () => {
  form['hr-fee-bearer'].value = '對方支出';
  try { assert.equal(context.hrTransferFeeRows(rows), 2); }
  finally { form['hr-fee-bearer'].value = '己方支出'; }
});
test('HR zero configured fee retains eligible row count without mislabeling payer', () => {
  context.BANK_TRANSFER_FEES.EXAMPLE_ENTITY = 0;
  context.S.hrRows = rows;
  try {
    assert.equal(context.hrTransferFeeRows(rows), 2);
    assert.equal(context.hrTransferFeeTotal(rows), 0);
    const payment = context.collectPaymentInfo();
    assert.equal(payment.feeBearer, '己方支出');
    assert.equal(payment.bankFeeAmount, 0);
    assert.match(payment.summary, /手續費己方支出/);
    assert.doesNotMatch(payment.summary, /對方吸收/);
  } finally {
    context.BANK_TRANSFER_FEES.EXAMPLE_ENTITY = 15;
    context.S.hrRows = [];
  }
});

test('review summary has stable semantic wrapper and explicit own-party label', () => {
  const html = htmlOf(Object.assign({}, own, { bankFeeAmount: 15 }));
  assert.match(html, /class=["'][^"']*accounting-bank-fee-review/);
  assert.match(elementText(html, 'data-fee-bearer'), /己方支出/);
  assert.match(elementText(html, 'data-fee-amount'), /15/);
});
test('counterparty and zero remain visible rather than hidden', () => {
  const html = htmlOf(Object.assign({}, counter, { bankFeeAmount: 0 }));
  assert.match(elementText(html, 'data-fee-bearer'), /對方支出/);
  assert.match(elementText(html, 'data-fee-amount'), /0/);
});
test('unknown persisted amount is not presented as confirmed computed fee', () => {
  assert.match(elementText(htmlOf(own), 'data-fee-amount'), /尚未確認/);
});
test('missing fee payer is visibly unresolved', () => {
  assert.match(elementText(htmlOf({ bankFeeAmount: 0 }), 'data-fee-bearer'), /未填.*待確認/);
});
test('persisted amount and HR original snapshot mismatch requires review', () => {
  const html = htmlOf(Object.assign({}, own, { type: 'hr_expense_request', bankFeeAmount: 0, formPayload: { hrInfo: { transferFeeTotal: 30 } } }));
  assert.match(html, /原申請試算/);
  assert.match(html, /與已存金額不一致/);
  assert.match(html, /核對/);
  assert.match(elementText(html, 'data-fee-amount'), /0/);
});
test('persisted positive fee conflicting with mega label is flagged', () => {
  const html = htmlOf(Object.assign({}, own, { bankType: 'mega', bankFeeAmount: 30 }));
  assert.match(html, /核對|不一致/);
  assert.match(elementText(html, 'data-fee-amount'), /30/);
});
test('persisted positive fee conflicting with counterparty payer is flagged', () => {
  const html = htmlOf(Object.assign({}, counter, { bankFeeAmount: 30 }));
  assert.match(html, /核對|不一致/);
  assert.match(elementText(html, 'data-fee-amount'), /30/);
});
test('review summary escapes untrusted payer text', () => {
  const html = htmlOf(Object.assign({}, own, { feeBearer: '<img src=x onerror="alert(1)">', bankFeeAmount: 15 }));
  assert.ok(!html.includes('<img'));
  assert.ok(!html.includes('onerror="alert(1)"'));
});
test('advance final review discloses no duplicate fee addition', () => {
  const html = htmlOf(Object.assign({}, own, { bankFeeAmount: 15, type: 'advance_request', cashPostedAt: '2026-01-02T00:00:00Z' }));
  assert.match(html, /最後核銷不重複加計/);
});
test('electronic labor review directs fee to payment workflow', () => {
  const html = htmlOf(Object.assign({}, own, { __testElectronicLabor: true }));
  assert.match(html, /付款流程/);
});

test('serialization preserves explicit zero and payer', () => {
  const row = context.reqDbRow(Object.assign({}, own, { id: 'example_request', no: 'EXAMPLE-1', bankFeeAmount: 0, files: [], steps: [], date: '2026/01/02' }));
  assert.equal(row.bank_fee_amount, 0);
  assert.equal(row.fee_bearer, '己方支出');
});
test('serialization preserves stored HR total despite non-Mega label', () => {
  const row = context.reqDbRow(Object.assign({}, own, { id: 'example_hr_request', no: 'EXAMPLE-HR', bankName: '非兆豐銀行', bankFeeAmount: 30, type: 'hr_expense_request', files: [], steps: [] }));
  assert.equal(row.bank_fee_amount, 30);
});
test('review rendering does not mutate persisted request or form snapshot', () => {
  const request = Object.assign({}, own, { bankFeeAmount: 0, formPayload: { hrInfo: { transferFeeTotal: 30 } } });
  const before = JSON.stringify(request);
  htmlOf(request);
  assert.equal(JSON.stringify(request), before);
});
test('API mapping preserves an unknown fee instead of confirming current settings', () => {
  const mapped = context.mapReq({ id: 'example-unconfirmed', type: 'payment_request',
    entity_id: 'EXAMPLE_ENTITY', bank_type: 'other', fee_bearer: '己方支出', amount: 3600 });
  assert.equal(mapped.bankFeeAmount, null);
  assert.match(elementText(htmlOf(mapped), 'data-fee-amount'), /尚未確認/);
});
test('API mapping retains confirmed zero and multi-transfer fees', () => {
  for (const amount of [0, 30]) {
    const mapped = context.mapReq({ id: 'example-saved', type: 'hr_expense_request',
      bank_name: '非兆豐銀行', bank_type: 'other', fee_bearer: '己方支出', bank_fee_amount: amount });
    assert.equal(mapped.bankFeeAmount, amount);
  }
});
process.stdout.write(JSON.stringify({ suite: 'bank-fee-review', passed: count, failed: results.filter(x => !x.passed).length, checks: results }, null, 2) + '\n');
