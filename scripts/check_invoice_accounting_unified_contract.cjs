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
  requestPostingLocked: () => context.postingLocked,
  shouldShowRequestAccountingLines: () => context.accountingAllowed,
  accountingLinesHtml: () => '<div>legacy accounting fallback</div>',
  postedAccountingView: () => context.postedView,
  postedVoucherEntriesHtml: () => '<div data-accounting-request="fictional-request">正式傳票借方 6207</div>',
  buildAccountingLines: () => context.fixtureLines,
  canEditAccountingLineAmounts: () => context.amountAllowed,
  canEditAccountingLineSubjects: () => context.subjectAllowed,
  accountingLineIsSystemFee: line => !!line.systemFee,
  accountingDebitReclassificationPlan: () => ({ ok: false }),
  accountingUtilityBillDetected: () => false,
  accountByCode: code => ({ c: code, n: `account ${code}` }),
  accountOptionsHtml: selected => `<option selected>${escapeHtml(selected)}</option>`,
  accountingLineAmountInput: (prefix, i, field, value) => `<input id="${prefix}-${field}-${i}" value="${value}">`,
  pettyIsInitial: () => false,
  canActRequest: () => context.activeCanAct,
  currentRoleKey: () => context.currentRole,
  requestLedgerRowsExist: () => context.ledgerExists,
  accountingReviewDraftHtml: () => '',
  fixtureLines: [], accountingAllowed: true, postedView: null,
  activeCanAct: false, currentRole: 'employee', postingLocked: false, ledgerExists: false,
  amountAllowed: true, subjectAllowed: true,
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
  assert.match(markup, /發票號碼<\/span><strong class="invoice-accounting-invoice-number">AB12345678<\/strong>/);
  assert.match(markup, /aria-label="複製發票號碼 AB12345678"/);
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
  assert.match(markup, /1 項暫配/);
  assert.equal((markup.match(/class="invoice-accounting-legacy"/g)||[]).length,1);

  context.fixtureLines = [line('', '品項甲', 100), line('', '品項乙', 200)];
  markup = context.expenseInvoiceAccountingReviewHtml(request([
    row('', '品項甲', 'CD12345678', '2026-10-01', 'legacy.pdf', 100),
    row('', '品項乙', 'CD12345678', '2026-10-01', 'legacy.pdf', 200),
  ]), true, '入帳科目', 'acct');
  assert.match(markup, /2 項暫配/);
  assert.equal((markup.match(/舊單依品名與金額配對，請逐項核對標示品項/g)||[]).length,1);
  assert.equal((markup.match(/class="invoice-accounting-legacy"/g)||[]).length,2);

  context.fixtureLines = [line('', '同名品項', 100), line('', '同名品項', 100)];
  markup = context.expenseInvoiceAccountingReviewHtml(request([
    row('', '同名品項', 'EF12345678', '2026-10-01', 'legacy.pdf', 100),
    row('', '同名品項', 'EF12345678', '2026-10-01', 'legacy.pdf', 100),
  ]), true, '入帳科目', 'acct');
  const sourceRows = markup.slice(0, markup.indexOf('class="invoice-accounting-group invoice-accounting-orphans"'));
  assert.match(sourceRows, /待會計核對品項與科目/);
  assert.doesNotMatch(sourceRows, /id="acct-dr-[01]"/);
  assert.match(markup, /無法可靠配對來源品項；不依列序號猜測/);
  assert.doesNotMatch(markup, /項暫配/);
});

check('Duplicate legacy rows offer deliberate binding to active accounting reviewers', () => {
  const legacyRequest = request([
    row('', '同名品項', 'EF12345678', '2026-10-01', 'legacy.pdf', 100),
    row('', '同名品項', 'EF12345678', '2026-10-01', 'legacy.pdf', 100),
    row('', '不同金額', 'EF12345678', '2026-10-01', 'legacy.pdf', 300),
  ]);
  const first = { ...line('', '同名品項', 100), id: 'legacy-line-one' };
  const second = { ...line('', '同名品項', 100), id: 'legacy-line-two' };
  context.fixtureLines = [first, second, { ...line('', '不同金額', 400), id: 'wrong-amount' },
    { ...line('', '同名品項', 100), id: 'system-fee', systemFee: true }];
  legacyRequest.formPayload.accountingLines = context.fixtureLines;
  const bindButtons = markup => (markup.match(/onclick="bindLegacyInvoiceAccountingItem\(this\)"/g) || []).length;
  const render = () => context.expenseInvoiceAccountingReviewHtml(legacyRequest, true, '入帳科目', 'acct');
  try {
    context.activeCanAct = true;
    for (const role of ['accountant', 'ceo', 'admin_director']) {
      context.currentRole = role;
      const markup = render();
      const sourceRows = markup.slice(0, markup.indexOf('class="invoice-accounting-group invoice-accounting-orphans"'));
      assert.equal(bindButtons(sourceRows), 2, `${role} should see one control for each ambiguous source row`);
      const controls = sourceRows.match(/<details class="invoice-accounting-bind"[\s\S]*?<\/details>/g) || [];
      assert.equal(controls.length, 2);
      for (const control of controls) {
        assert.match(control, /<option value="legacy-line-one">/);
        assert.match(control, /<option value="legacy-line-two">/);
        assert.doesNotMatch(control, /wrong-amount|system-fee/,
          'only unbound, non-system lines with the same item and amounts are candidates');
      }
      assert.doesNotMatch(sourceRows, /id="acct-dr-[01]"/, 'ambiguous rows must stay unbound until a person selects a line');
      assert.match(markup, /無法可靠配對來源品項；不依列序號猜測/);
      assert.doesNotMatch(markup, /項暫配/);
    }

    context.currentRole = 'employee';
    assert.equal(bindButtons(render()), 0, 'an employee must not receive the bind action');
    context.currentRole = 'accountant';
    context.subjectAllowed = false;
    assert.equal(bindButtons(render()), 0, 'amount editing alone must not offer source binding');
    context.subjectAllowed = true;
    context.amountAllowed = false;
    assert.equal(bindButtons(render()), 2, 'subject permission alone is sufficient for source binding');
    context.amountAllowed = true;
    delete legacyRequest.formPayload.accountingLines;
    assert.equal(bindButtons(render()), 0, 'synthesized lines without a persisted array must not offer binding');
    legacyRequest.formPayload.accountingLines = context.fixtureLines;
    assert.equal(bindButtons(context.expenseInvoiceAccountingReviewHtml(legacyRequest, false, '入帳科目', 'acct')), 0,
      'a read-only review must not receive the bind action');
    context.accountingAllowed = false;
    assert.equal(bindButtons(render()), 0, 'a person without accounting access must not receive the bind action');
    context.accountingAllowed = true;
    context.amountAllowed = true;
    context.subjectAllowed = true;
    context.activeCanAct = false;
    assert.equal(bindButtons(render()), 0, 'an inactive approval step must not receive the bind action');
    context.activeCanAct = true;
    context.postingLocked = true;
    assert.equal(bindButtons(render()), 0, 'a locked request must not receive the bind action');
    context.postingLocked = false;
    context.ledgerExists = true;
    assert.equal(bindButtons(render()), 0, 'a request with ledger rows must not receive the bind action');
    context.ledgerExists = false;
    context.postedView = { status: 'ready', key: 'posted-key', voucher: { no: 'V-003' }, lines: [first, second] };
    assert.equal(bindButtons(render()), 0, 'posted accounting is read-only');
  } finally {
    context.currentRole = 'employee';
    context.activeCanAct = false;
    context.accountingAllowed = true;
    context.amountAllowed = true;
    context.subjectAllowed = true;
    context.postingLocked = false;
    context.ledgerExists = false;
    context.postedView = null;
  }
});

check('Manual binding uses raw lazyRows positions after a filtered system-fee row', () => {
  const originalRows = [
    { ...row('fee', '系統手續費', '', '', '', 10), systemFee: true },
    row('', '重複用品', 'MN12345678', '2026-10-01', 'legacy.pdf', 100),
    row('', '重複用品', 'MN12345678', '2026-10-01', 'legacy.pdf', 100),
  ];
  const legacyRequest = request(originalRows);
  context.fixtureLines = [
    { ...line('', '重複用品', 100), id: 'line-after-fee-1' },
    { ...line('', '重複用品', 100), id: 'line-after-fee-2' },
  ];
  legacyRequest.formPayload.accountingLines = context.fixtureLines;
  try {
    context.currentRole = 'accountant';
    context.activeCanAct = true;
    const groups = context.expenseInvoiceReviewGroups(legacyRequest);
    assert.deepEqual(Array.from(groups[0].items, item => item.idx), [2, 3]);
    const markup = context.expenseInvoiceAccountingReviewHtml(legacyRequest, true, '入帳科目', 'acct');
    const sourceIndexes = Array.from(markup.matchAll(/data-source-index="(\d+)"/g), match => Number(match[1]));
    assert.deepEqual(sourceIndexes, [2, 3], 'the handler must receive the original array positions');
  } finally {
    context.currentRole = 'employee';
    context.activeCanAct = false;
  }
});

check('Binding version increment preserves exact-row approval verification for the active step', () => {
  const before = {
    ...request([row('', '重複用品', 'MN12345678', '2026-10-01', 'legacy.pdf', 100)]),
    status: 'pending_ceo', step: 1, ver: 7,
    steps: [{ rk: 'ceo', uid: 'ceo-reviewer', a: '' }],
  };
  const after = {
    ...before, ver: 8,
    formPayload: { ...before.formPayload,
      lazyRows: [{ ...before.formPayload.lazyRows[0], id: 'stable-source-1' }],
      accountingLines: [{ ...line('stable-source-1', '重複用品', 100), id: 'chosen-line' }],
    },
  };
  const runtime = { trustedFingerprint: 'verified-summary', pending: {}, unavailable: {}, verified: {} };
  const approvalContext = vm.createContext({
    S: { demoLogin: false }, hasSupabase: () => true,
    activeStep: record => record.steps.find(step => !step.a) || null,
    activeStepIndex: record => record.steps.findIndex(step => !step.a),
    approvalRowRuntimeForCurrentUser: () => runtime,
    approvalRowRuntimeKey: (table, id) => `${table}:${id}`,
    REQS: [before], mapReq: raw => raw,
  });
  load(approvalContext, 'function approvalRowCurrentStepFingerprint(', 'function approvalRowMarkVerified(');
  load(approvalContext, 'function approvalRowIsLocallyVerified(', 'function approvalRowAvailability(');
  load(approvalContext, 'function mergeCommittedExpenseRequest(', 'function expenseSubmissionOperationIdentity(');
  const key = `expense_requests:${before.id}`;
  runtime.verified[key] = {
    stepFingerprint: approvalContext.approvalRowCurrentStepFingerprint(before),
    summaryFingerprint: runtime.trustedFingerprint, groupIds: [before.id],
  };
  assert.equal(approvalContext.approvalRowCurrentStepFingerprint(after), runtime.verified[key].stepFingerprint,
    'binding changes payload and version without changing the verified active step');
  approvalContext.mergeCommittedExpenseRequest(after);
  assert.equal(approvalContext.approvalRowIsLocallyVerified('expense_requests', approvalContext.REQS[0]), true,
    'the re-read record remains actionable after version increments');
  assert.equal(approvalContext.approvalRowIsLocallyVerified('expense_requests', { ...after, status: 'pending_voucher' }), false,
    'a real workflow transition still invalidates the exact-row verification');
});

check('Unnumbered source keeps the missing number visible without a copy action', () => {
  context.fixtureLines = [];
  const markup = context.expenseInvoiceAccountingReviewHtml(request([
    row('no-number', '無號碼品項', '', '2026-10-01', 'receipt.pdf', 100),
  ]), false, '入帳科目', 'acct');
  assert.match(markup, /發票號碼<\/span><strong class="invoice-accounting-invoice-number">未填<\/strong>/);
  assert.doesNotMatch(markup, /class="invoice-accounting-copy"/);
  assert.match(markup, /invoice-accounting-note-empty/);
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

async function checkBinding(label, fn) {
  await fn();
  console.log(`PASS ${label}`);
}
function bindingFixture() {
  const rows = [1, 2, 3].map(() => row('', '重複用品', 'KL12345678', '2026-10-01', 'legacy.pdf', 100));
  const accountingLines = [1, 2, 3].map(i => ({ ...line('', '重複用品', 100), id: `legacy-${i}` }));
  const original = { ...request(rows), ver: 7, formPayload: { lazyRows: rows, accountingLines } };
  const persistedRows = rows.map((source, index) => index === 0 ? { ...source, id: 'stable-source-1' } : source);
  const persistedLines = accountingLines.map((accountingLine, index) => index === 0
    ? { ...accountingLine, sourceItemId: 'stable-source-1' } : accountingLine);
  const persisted = { ...original, ver: 8, formPayload: { lazyRows: persistedRows, accountingLines: persistedLines } };
  const picker = {
    select: { value: 'legacy-1' }, status: { textContent: '' },
    querySelector(selector) { return selector === 'select' ? this.select : this.status; },
  };
  const review = {
    isConnected: true, outerHTML: '',
    querySelector(selector) { return selector === '.chd .cht' ? { textContent: '入帳科目' } : null; },
  };
  const button = {
    dataset: { requestId: original.id, sourceIndex: '1', prefix: 'acct' },
    isConnected: true, disabled: false,
    closest(selector) { return selector === '.invoice-accounting-bind' ? picker
      : selector === '.invoice-accounting-review' ? review : { dataset: {} }; },
    setAttribute(name, value) { this[name] = value; },
    removeAttribute(name) { delete this[name]; },
  };
  const calls = { rpc: [], reads: [], merged: [], rerenders: [], reopened: [] };
  const bindContext = vm.createContext({
    window: {}, document: { querySelectorAll: () => [] }, REQS: [original],
    HUMAN_ACCOUNTING_DRAFTS: {}, sessionStorage: { setItem() {} },
    currentRoleKey: () => bindContext.role,
    canActRequest: () => bindContext.activeCanAct,
    canEditAccountingLineSubjects: () => bindContext.subjectAllowed,
    canEditRequestAccountingLines: () => bindContext.subjectAllowed,
    requestPostingLocked: () => bindContext.postingLocked,
    requestLedgerRowsExist: () => bindContext.ledgerExists,
    isRestrictedReturnedMiddleStep: () => false,
    buildAccountingLines: record => record.formPayload.accountingLines,
    expensePostingIdentity: () => 'actor-session',
    expenseTransactionIdentityCurrent: () => true,
    captureAccountingReviewDraftForElement: () => {},
    accountingReviewDraft: () => null,
    withOperationTimeout: promise => promise,
    activeDataEnvironment: () => 'test',
    currentTenantId: () => 'fictional-tenant',
    mapReq: raw => raw,
    mergeCommittedExpenseRequest: raw => calls.merged.push(raw),
    expenseInvoiceAccountingReviewHtml: (record, editable, title, prefix) => {
      calls.rerenders.push({ record, editable, title, prefix });
      return `<section data-refreshed-source="${record.formPayload.lazyRows[0].id}"></section>`;
    },
    showApprD: record => calls.reopened.push(record),
    openDetail: rid => calls.reopened.push(rid),
    getSb: () => ({
      rpc(name, args) { calls.rpc.push({ name, args }); return Promise.resolve({ data: {}, error: null }); },
      from(table) {
        calls.reads.push(table);
        return { select() { return this; }, eq() { return this; }, limit() {
          return Promise.resolve({ data: [bindContext.latest], error: null });
        } };
      },
    }),
    role: 'accountant', activeCanAct: true, subjectAllowed: true,
    postingLocked: false, ledgerExists: false, latest: persisted,
  });
  load(bindContext, 'var INVOICE_ACCOUNTING_BIND_RUNNING=', 'function collectAccountingLinesFromDom(');
  return { original, persisted, picker, review, button, calls, bindContext };
}

(async () => {
  await checkBinding('Manual binding sends an explicit line choice and confirms persisted source IDs on reload', async () => {
    const fixture = bindingFixture();
    assert.equal(await fixture.bindContext.window.bindLegacyInvoiceAccountingItem(fixture.button), true);
    assert.equal(fixture.calls.rpc.length, 1);
    assert.equal(fixture.calls.rpc[0].name, 'finance_bind_expense_invoice_item_v1');
    assert.equal(fixture.calls.rpc[0].args.p_request_id, fixture.original.id);
    assert.equal(fixture.calls.rpc[0].args.p_expected_ver, 7);
    assert.equal(fixture.calls.rpc[0].args.p_source_index, 1);
    assert.equal(fixture.calls.rpc[0].args.p_accounting_line_id, 'legacy-1');
    assert.equal(fixture.calls.reads[0], 'expense_requests');
    assert.equal(fixture.calls.merged.length, 1);
    assert.equal(fixture.calls.rerenders.length, 1);
    assert.equal(fixture.calls.rerenders[0].record, fixture.persisted);
    assert.equal(fixture.calls.rerenders[0].editable, true, 'the re-read approval card stays editable');
    assert.equal(fixture.review.outerHTML, '<section data-refreshed-source="stable-source-1"></section>');
    assert.equal(fixture.calls.reopened.length, 0, 'manual binding must preserve the rest of the approval form');
    assert.equal(fixture.persisted.formPayload.lazyRows[0].id,
      fixture.persisted.formPayload.accountingLines[0].sourceItemId);
    context.fixtureLines = fixture.persisted.formPayload.accountingLines;
    const refreshed = context.expenseInvoiceAccountingReviewHtml(fixture.persisted, true, '入帳科目', 'acct');
    const linkedRow = refreshed.slice(refreshed.indexOf('data-source-item-id="stable-source-1"'),
      refreshed.indexOf('data-source-item-id=""'));
    assert.match(linkedRow, /id="acct-dr-0"/, 'saved link keeps the accounting controls in the selected source row');
  });

  await checkBinding('Denied or unconfirmed manual binding never claims a saved match', async () => {
    for (const setup of [
      fixture => { fixture.bindContext.role = 'employee'; },
      fixture => { fixture.bindContext.activeCanAct = false; },
      fixture => { fixture.bindContext.subjectAllowed = false; },
      fixture => { fixture.bindContext.postingLocked = true; },
      fixture => { fixture.bindContext.ledgerExists = true; },
    ]) {
      const fixture = bindingFixture();
      setup(fixture);
      assert.equal(await fixture.bindContext.window.bindLegacyInvoiceAccountingItem(fixture.button), false);
      assert.equal(fixture.calls.rpc.length, 0);
      assert.equal(fixture.calls.merged.length, 0);
    }
    const unsaved = bindingFixture();
    delete unsaved.original.formPayload.accountingLines;
    assert.equal(await unsaved.bindContext.window.bindLegacyInvoiceAccountingItem(unsaved.button), false);
    assert.equal(unsaved.calls.rpc.length, 0, 'a synthesized line must never be sent to the binding RPC');
    const stale = bindingFixture();
    stale.bindContext.latest = stale.original;
    assert.equal(await stale.bindContext.window.bindLegacyInvoiceAccountingItem(stale.button), false);
    assert.equal(stale.calls.rpc.length, 1);
    assert.equal(stale.calls.merged.length, 0);
    assert.match(stale.picker.status.textContent, /尚未確認配對完成/);
  });
})().catch(error => { console.error(error); process.exitCode = 1; });
