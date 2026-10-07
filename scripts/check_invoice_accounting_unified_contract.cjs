#!/usr/bin/env node
/* Regression contract for the unified invoice/accounting review. Fictional data only. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function sourceBetween(start, end) {
  const a = html.indexOf(start);
  const b = html.indexOf(end, a + start.length);
  assert(a >= 0 && b > a, `Cannot find source boundaries: ${start} / ${end}`);
  return html.slice(a, b);
}
function load(context, start, end) {
  vm.runInContext(sourceBetween(start, end), context, { filename: 'index.html' });
}
function check(label, fn) {
  fn();
  console.log(`PASS ${label}`);
}
const number = value => Number(value) || 0;
const escapeHtml = value => String(value == null ? '' : value)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const context = vm.createContext({
  window: {}, console, Promise,
  num: number, normDate: value => String(value || ''), escAttr: escapeHtml,
  fmt: value => `NT$${number(value).toLocaleString('en-US')}`,
  lazyAmountParts: row => ({ net: number(row.netAmount), tax: number(row.taxAmount), gross: number(row.grossAmount) }),
  requestPostingLocked: () => false,
  shouldShowRequestAccountingLines: () => context.accountingAllowed,
  accountingLinesHtml: () => '<div>legacy accounting fallback</div>',
  postedAccountingView: () => context.postedView,
  postedVoucherEntriesHtml: () => '<div data-accounting-request="fictional-request">正式傳票借方 6207</div>',
  buildAccountingLines: () => context.fixtureLines,
  canEditAccountingLineAmounts: () => true,
  canEditAccountingLineSubjects: () => true,
  accountingLineIsSystemFee: line => !!line.systemFee,
  accountingDebitReclassificationPlan: () => ({ ok: false }),
  accountingUtilityBillDetected: () => false,
  accountByCode: code => ({ c: code, n: `account ${code}` }),
  accountOptionsHtml: selected => `<option selected>${escapeHtml(selected)}</option>`,
  accountingLineAmountInput: (prefix, i, field, value) => `<input id="${prefix}-${field}-${i}" value="${value}">`,
  pettyIsInitial: () => false,
  canActRequest: () => false,
  requestLedgerRowsExist: () => false,
  accountingReviewDraftHtml: () => '',
  fixtureLines: [], accountingAllowed: true, postedView: null,
});
load(context, 'function expenseInvoiceReviewGroups(', 'window.toggleExpenseInvoiceDetailRow=');
load(context, 'function expenseInvoiceAccountingReviewHtml(', 'function collectAccountingLinesFromDom(');

const row = (id, item, no, date, file, grossAmount, note = '') => ({
  id, item, no, date, file, applicantItemNote: note,
  netAmount: grossAmount, taxAmount: 0, grossAmount,
});
const line = (sourceItemId, description, grossAmount) => ({
  id: `line_${sourceItemId || description}`, sourceItemId, description,
  netAmount: grossAmount, taxAmount: 0, grossAmount,
  debitAccount: '6205', creditAccount: '1112',
});
const request = lazyRows => ({ id: 'fictional-request', type: 'expense_request', formPayload: { lazyRows } });

check('Same invoice/date/source groups multiple items; changed date or file stays distinct', () => {
  const groups = context.expenseInvoiceReviewGroups(request([
    row('a1', '教材甲', 'AB12345678', '2026-10-01', 'one.pdf', 100),
    row('a2', '教材乙', 'AB12345678', '2026-10-01', 'one.pdf', 200),
    row('a3', '教材丙', 'AB12345678', '2026-10-02', 'one.pdf', 300),
    row('a4', '教材丁', 'AB12345678', '2026-10-01', 'other.pdf', 400),
  ]));
  assert.equal(groups.length, 3);
  assert.equal(groups[0].items.length, 2);
  assert.equal(groups[0].total, 300);
  assert.equal(groups[1].date, '2026-10-02');
  assert.equal(groups[2].file, 'other.pdf');
  const markup = context.expenseInvoiceAccountingReviewHtml(request([
    { ...row('b1', '用品甲', 'AB12345678', '2026-10-01', 'one.pdf', 100), sellerTaxId: '11111111', buyerTaxId: '22222222' },
    { ...row('b2', '用品乙', 'AB12345678', '2026-10-01', 'other.pdf', 200), sellerTaxId: '33333333' },
  ]), false, '檢核', 'acct');
  assert.match(markup, /來源 one\.pdf · 賣方統編 11111111 · 買方統編 22222222/);
  assert.match(markup, /來源 other\.pdf · 賣方統編 33333333 · 買方統編 未填/);
  assert.match(markup, /<summary>來源與統編<\/summary>/);
  assert.match(markup, /買方統編<\/dt><dd>22222222/);
  const buyerConflict = context.expenseInvoiceReviewGroups(request([
    { ...row('b3', '用品丙', 'AB12345678', '2026-10-01', 'one.pdf', 100), sellerTaxId: '11111111', buyerTaxId: '22222222' },
    { ...row('b4', '用品丁', 'AB12345678', '2026-10-01', 'one.pdf', 100), sellerTaxId: '11111111', buyerTaxId: '44444444' },
  ]));
  assert.equal(buyerConflict.length, 2, 'conflicting buyer IDs must not silently merge');
});

check('Accounting inputs follow durable item IDs, not accounting array order', () => {
  context.fixtureLines = [line('a2', '教材乙', 200), line('a1', '教材甲', 100)];
  const markup = context.expenseInvoiceAccountingReviewHtml(request([
    row('a1', '教材甲', 'AB12345678', '2026-10-01', 'one.pdf', 100),
    row('a2', '教材乙', 'AB12345678', '2026-10-01', 'one.pdf', 200),
  ]), true, '入帳科目', 'acct');
  const first = markup.slice(markup.indexOf('data-source-item-id="a1"'), markup.indexOf('data-source-item-id="a2"'));
  const second = markup.slice(markup.indexOf('data-source-item-id="a2"'));
  assert.match(first, /id="acct-dr-1"/);
  assert.doesNotMatch(first, /id="acct-dr-0"/);
  assert.match(second, /id="acct-dr-0"/);
  assert.match(markup, /data-accounting-request="fictional-request"/);
  assert.match(markup, /發票 AB12345678/);
  assert.match(markup, /發票日期 2026-10-01/);
  assert.doesNotMatch(markup, /發票核對表/);
});

check('Unique historical lines can match exactly; ambiguous legacy lines remain separate', () => {
  context.fixtureLines = [line('', '單一品項', 100)];
  let markup = context.expenseInvoiceAccountingReviewHtml(request([
    row('', '單一品項', 'CD12345678', '2026-10-01', 'legacy.pdf', 100),
  ]), true, '入帳科目', 'acct');
  assert.match(markup, /id="acct-dr-0"/);
  assert.doesNotMatch(markup, /invoice-accounting-orphans/);

  context.fixtureLines = [line('', '同名品項', 100), line('', '同名品項', 100)];
  markup = context.expenseInvoiceAccountingReviewHtml(request([
    row('', '同名品項', 'EF12345678', '2026-10-01', 'legacy.pdf', 100),
    row('', '同名品項', 'EF12345678', '2026-10-01', 'legacy.pdf', 100),
  ]), true, '入帳科目', 'acct');
  const sourceRows = markup.slice(0, markup.indexOf('class="invoice-accounting-group invoice-accounting-orphans"'));
  assert.match(sourceRows, /待會計核對品項與科目/);
  assert.doesNotMatch(sourceRows, /id="acct-dr-[01]"/);
  assert.match(markup, /無法可靠配對來源品項；不依列序號猜測/);
});

check('Applicant remarks are escaped and do not reveal accounting controls without permission', () => {
  context.accountingAllowed = false;
  const markup = context.expenseInvoiceAccountingReviewHtml(request([
    row('a1', '用品', 'GH12345678', '2026-10-01', 'one.pdf', 100, '<img src=x onerror=alert(1)>'),
  ]), true, '入帳科目', 'acct');
  assert.match(markup, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(markup, /<img src=x/);
  assert.doesNotMatch(markup, /id="acct-dr-0"/);
  assert.match(markup, /invoice-accounting-no-ledger/);
  context.accountingAllowed = true;
});

check('Unreconciled posted item lines warn and expose voucher entries without claiming verification', () => {
  context.fixtureLines = [line('a1', '錯誤舊科目', 100)];
  context.postedView = { status: 'ready', key: 'posted-key', voucher: { no: 'V-001' }, lines: null };
  const markup = context.expenseInvoiceAccountingReviewHtml(request([
    row('a1', '用品', 'GH12345678', '2026-10-01', 'one.pdf', 100),
  ]), false, '正式入帳會計明細', 'acct');
  assert.match(markup, /逐項覆核明細無法與傳票完整對照/);
  assert.match(markup, /role="alert"/);
  assert.match(markup, /正式傳票借方 6207/);
  assert.doesNotMatch(markup, /正式傳票 V-001 已核對/);
  assert.doesNotMatch(markup, /錯誤舊科目/);
  assert.doesNotMatch(markup, /<details class="invoice-accounting-voucher">/);
  context.postedView = null;
});

check('Verified posted item lines stay read-only and keep the voucher available', () => {
  context.postedView = { status: 'ready', key: 'posted-key', voucher: { no: 'V-002' }, lines: [line('a1', '用品', 100)] };
  const markup = context.expenseInvoiceAccountingReviewHtml(request([
    row('a1', '用品', 'GH12345678', '2026-10-01', 'one.pdf', 100),
  ]), true, '正式入帳會計明細', 'acct');
  assert.match(markup, /正式傳票 V-002 已核對/);
  assert.match(markup, /<details class="invoice-accounting-voucher">/);
  assert.match(markup, /acct-dr/);
  assert.doesNotMatch(markup, /<select id="acct-dr-0"/);
  assert.doesNotMatch(markup, /逐項覆核明細無法與傳票完整對照/);
  context.postedView = null;
});

const normalizeContext = vm.createContext({
  num: number,
  accountByCode: code => code ? { c: code, n: `account ${code}` } : null,
  expenseDebitAccounts: () => [{ c: '6233', n: 'other' }],
  accountingLaborFeeDetected: () => false,
  accountingUtilityBillDetected: () => false,
  requestPostingLocked: () => false,
  accountingLineCreditAccount: entry => ({ c: entry.creditAccount, n: 'bank' }),
  accountingLineIsSystemFee: entry => !!entry.systemFee,
  cloneSettingValue: value => JSON.parse(JSON.stringify(value)),
});
load(normalizeContext, 'function accountingManualFieldNames(', 'function accountingDecimalAmount(');
load(normalizeContext, 'function accountingDecimalAmount(', 'function accountingComparableValue(');
load(normalizeContext, 'function preserveAccountingManualAuthority(', 'function markAccountingManualAuthority(');
load(normalizeContext, 'function normalizeAccountingLine(', 'function accountingLineAmountInput(');
check('Normalization preserves source IDs and a human-selected account', () => {
  const normalized = normalizeContext.normalizeAccountingLine({
    id: 'manual-line', sourceItemId: 'a1', description: '用品',
    grossAmount: 100, netAmount: 100, taxAmount: 0,
    debitAccount: '6205', creditAccount: '1112',
    manualOverride: true, valueAuthority: 'human', manualFields: ['debitAccount'],
    manualOverrideHistory: [{ source: 'accountant' }],
  }, { type: 'expense_request', dc: 'A100' }, 0);
  assert.equal(normalized.id, 'manual-line');
  assert.equal(normalized.sourceItemId, 'a1');
  assert.equal(normalized.debitAccount, '6205');
  assert.equal(normalized.valueAuthority, 'human');
  assert.equal(normalized.manualFields.join(','), 'debitAccount');
  assert.equal(normalized.manualOverrideHistory.length, 1);
});

const inferenceContext = vm.createContext({});
load(inferenceContext, 'function accountingLineItemText(', 'function accountingLineOcrFallbackText(');
load(inferenceContext, 'function accountingLaborFeeDetected(', 'function rowHasInvoice(');
check('Applicant remarks never change accounting classification or labor-fee detection', () => {
  const plain = { item: '教材' };
  const noted = { ...plain, applicantItemNote: '講師勞務報酬；發票；設備投資' };
  assert.equal(inferenceContext.accountingLineItemText(plain, {}), inferenceContext.accountingLineItemText(noted, {}));
  assert.equal(inferenceContext.accountingLaborFeeDetected(plain), false);
  assert.equal(inferenceContext.accountingLaborFeeDetected(noted), false);
});

const exportContext = vm.createContext({
  S: { lazyRows: [row('x', '用品', 'IJ12345678', '2026-10-01', 'receipt.pdf', 100, '=SUM(1,2) <script>')] },
  todayIso: () => '2026-10-08',
  lazyTaxMode: () => 'exempt',
  lazyNetAmount: entry => entry.netAmount,
  lazyTaxAmount: entry => entry.taxAmount,
  lazyRowTotal: entry => entry.grossAmount,
  num: number, encodeURIComponent, Date,
});
load(exportContext, 'function csvCell(', 'async function sha256Text(');
load(exportContext, 'function lazyCsvAttachment(', 'function lazyDetailExcelAttachment(');
load(exportContext, 'function lazyDetailExcelAttachment(', 'function loadImageForPdf(');
check('CSV and Excel include applicant remark and protect spreadsheet/HTML content', () => {
  const csv = decodeURIComponent(exportContext.lazyCsvAttachment().url.split(',').slice(1).join(','));
  assert.match(csv, /品項備註/);
  assert.match(csv, /"'=SUM\(1,2\) <script>"/);
  const excel = decodeURIComponent(exportContext.lazyDetailExcelAttachment({ no: 'fictional' }).url.split(',').slice(1).join(','));
  assert.match(excel, /品項備註/);
  assert.match(excel, /'=SUM\(1,2\) &lt;script&gt;/);
  assert.doesNotMatch(excel, /<script>/);
});
