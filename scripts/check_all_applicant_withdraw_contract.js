#!/usr/bin/env node
'use strict';

// Run the real browser eligibility and transaction handlers with fixture rows.
// The SQL assertions below guard invariants that require the adopted Finance
// database and are separately checked by the protected release canaries.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const migrationPath = path.join(root, 'supabase/migrations/20261005173534_applicant_withdraw_bill_invoice_v1.sql');
const migration = fs.existsSync(migrationPath) ? fs.readFileSync(migrationPath, 'utf8') : '';
const receivablesSql = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260910064324_finance_canonical_receivables_v1.sql'), 'utf8'
);
let passed = 0;

function check(name, condition) {
  if (!condition) throw new Error(`FAIL ${name}`);
  passed += 1;
  process.stdout.write(`PASS ${name}\n`);
}

function namedFunction(name) {
  const marker = `function ${name}(`;
  const markerStart = index.indexOf(marker);
  if (markerStart < 0) throw new Error(`Missing function ${name}`);
  const start = index.slice(Math.max(0, markerStart - 6), markerStart) === 'async '
    ? markerStart - 6 : markerStart;
  const open = index.indexOf('{', start);
  let depth = 0;
  let quote = '';
  let escape = false;
  for (let i = open; i < index.length; i += 1) {
    const char = index[i];
    if (quote) {
      if (escape) escape = false;
      else if (char === '\\') escape = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '{') depth += 1;
    if (char === '}' && --depth === 0) return index.slice(start, i + 1);
  }
  throw new Error(`Unterminated function ${name}`);
}

const fixtures = { bill: [], invoice: [] };
let hasConnection = true;
let safeBootstrap = true;
let reconcilePending = false;
let verified = true;
let frozen = true;
let sourceComplete = true;
const laborStates = new Map();
const notices = [];
const rpcCalls = [];
const reconciliation = [];
let rpcOutcome = 'success';
let clearActionCount = 0;
const context = {
  window: {}, console,
  S: { user: { id: 'applicant-1', authUserId: 'auth-1', email: 'applicant@suiyuecare.com' }, demoLogin: false, page: 'approvals' },
  BILLS: fixtures.bill, INVS: fixtures.invoice,
  remoteDataAuthUserId: 'auth-1',
  num: value => Number(value || 0),
  billGroupRows: () => fixtures.bill,
  invoiceGroupRows: () => fixtures.invoice,
  visibleInvoicesForCurrentUser: () => fixtures.invoice,
  activeStep: row => row.active === false ? null : { rk: 'accountant' },
  hasSupabase: () => hasConnection,
  approvalHardSafetyReady: () => safeBootstrap,
  approvalRowsHaveReconcilePending: () => reconcilePending,
  approvalSourceTableComplete: () => sourceComplete,
  approvalRowIsLocallyVerified: () => verified,
  rowTenantId: row => row.tenantId,
  currentTenantId: () => 'tenant-1',
  inActiveDataEnvironment: row => row.dataEnv === 'production',
  approvalFreezeExpectedSteps: () => frozen ? { expectedSteps: {} } : null,
  approvalRecordReconcilePending: () => reconcilePending,
  isReqOpen: request => /^pending_/.test(request.status),
  activeStepIndex: request => (request.steps || []).findIndex(step => !step.a),
  isTrueCeoReviewStep: step => step.rk === 'ceo',
  stepWorkflowKey: step => step.rk || '',
  currentUserIsNamed: () => false,
  laborElectronicCached: request => laborStates.get(request.id) || null,
  approvalValidatedExpectedSteps: () => ({ 'bill-1': { row_version: 3 } }),
  incomeActionContext: () => ({ key: 'stable-attempt-id' }),
  activeDataEnvironment: () => 'production',
  financeMutationRpcWithAmbiguousRetry: async (_rpc, args, expectedCount, _readback, _actionContext, _meta, invoke) => {
    if (rpcOutcome === 'unknown') {
      await invoke(); // The server may have committed before the response was lost.
      return { unknown: true, error: new Error('timeout') };
    }
    const response = await invoke();
    return { response: response || { data: { ok: true, count: expectedCount } } };
  },
  readbackApprovalStepMutation: () => true,
  getSb: () => ({ rpc: async (name, args) => {
    rpcCalls.push({ name, args });
    return { data: { ok: true, count: (args.p_bill_ids || args.p_invoice_ids || []).length } };
  } }),
  approvalContentVersionChangedError: () => false,
  isRpcMissing: () => false,
  friendlyErrorMessage: error => String(error && error.message || error),
  normalizeSettingValue: value => value,
  approvalSetReconcilePending: (kind, ids, pending) => reconciliation.push({ kind, ids, pending }),
  reloadBillsByIds: async () => { fixtures.bill.forEach(row => { row.approvalStatus = 'cancelled'; row.status = 'cancelled'; }); return true; },
  reloadInvoicesByIds: async () => { fixtures.invoice.forEach(row => { row.approvalStatus = 'cancelled'; row.status = 'cancelled'; }); return true; },
  refreshApprovalAfterCommittedAction: async () => true,
  clearIncomeActionContext: () => { clearActionCount += 1; },
  closeAppr: () => {}, buildAll: () => {}, buildApprovals: () => {},
  alert: value => notices.push(String(value)), confirm: () => true,
  escAttr: value => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
};
vm.createContext(context);
for (const name of [
  'incomeApplicantWithdrawAvailability', 'canWithdrawIncomeDocument',
  'incomeApplicantWithdrawButtonHtml', 'withdrawIncomeDocument',
  'requestIsMine', 'requestReachedCeoFunding', 'laborElectronicMarker',
  'laborElectronicUninvited', 'canWithdrawRequest', 'billIsMine', 'invoiceIsMine',
  'financeInlineJsString', 'invoiceStepApproved', 'invoiceAccountantInvoiceCompleted',
  'invoiceFlowReleasedToReceivable', 'invoiceIsReceivable',
  'invoiceNeedsReceivableFollowup', 'recvBaseInvoices',
  'billApprovalLabel', 'invApprovalLabel'
]) vm.runInContext(namedFunction(name), context);

function row(id, options = {}) {
  return {
    id, applicantId: 'applicant-1', tenantId: 'tenant-1', dataEnv: 'production',
    approvalStatus: 'pending_accountant', approvalStep: 1,
    steps: [{ rk: 'accountant' }], status: 'unpaid', rowVersion: 3,
    invoiceFollowupStatus: 'unreviewed', revenuePostingState: 'not_posted',
    ...options
  };
}
function allow(kind, rows) {
  fixtures[kind] = rows;
  context[kind === 'bill' ? 'BILLS' : 'INVS'] = fixtures[kind];
  return context.canWithdrawIncomeDocument(kind, rows[0]);
}
function compiledButtonAction(html, callback, expectedId) {
  const raw = html.match(/onclick="([^"]+)"/);
  if (!raw) return false;
  const decoded = raw[1].replace(/&(amp|quot|lt|gt|#39);/g, (_, entity) => ({
    amp: '&', quot: '"', lt: '<', gt: '>', '#39': "'"
  })[entity]);
  try {
    const calls = [];
    const action = new Function('event', callback, decoded);
    action({ stopPropagation() {} }, id => calls.push(id));
    return calls.length === 1 && calls[0] === expectedId;
  } catch (_) {
    return false;
  }
}

check('single bill applicant may withdraw while approval is pending', allow('bill', [row('bill-1')]));
check('single invoice applicant may withdraw while approval is pending', allow('invoice', [row('invoice-1')]));
check('other account cannot withdraw a bill', !allow('bill', [row('bill-1', { applicantId: 'other' })]));
check('other account cannot withdraw an invoice', !allow('invoice', [row('invoice-1', { applicantId: 'other' })]));
check('an old matching email cannot override another bill applicant ID',
  !allow('bill', [row('bill-1', { applicantId: 'other', applicantEmail: 'applicant@suiyuecare.com' })]));
check('an old matching email cannot override another invoice applicant ID',
  !allow('invoice', [row('invoice-1', { applicantId: 'other', applicantEmail: 'applicant@suiyuecare.com' })]));
check('whole bill batch can withdraw when all rows belong to applicant', allow('bill', [row('bill-1', { batchCount: 2 }), row('bill-2', { batchCount: 2 })]));
check('incomplete bill batch cannot be withdrawn', !allow('bill', [row('bill-1', { batchCount: 2 })]));
check('mixed-owner bill batch cannot be withdrawn', !allow('bill', [row('bill-1', { batchCount: 2 }), row('bill-2', { batchCount: 2, applicantId: 'other' })]));
check('payment on one bill row blocks the entire batch', !allow('bill', [row('bill-1', { batchCount: 2 }), row('bill-2', { batchCount: 2, status: 'paid' })]));
check('invoice revenue posting blocks the entire batch', !allow('invoice', [row('invoice-1'), row('invoice-2', { revenuePosted: true })]));
check('deferred revenue posting still allows the original applicant to withdraw an unissued pending invoice',
  allow('invoice', [row('invoice-1', { revenuePostingState: 'deferred' })]));
check('deferred state does not override an actual invoice posting marker',
  !allow('invoice', [row('invoice-1', { revenuePostingState: 'deferred', revenuePostedAt: '2026-10-05T08:00:00Z' })])
    && !allow('invoice', [row('invoice-1', { revenuePostingState: 'deferred', revenuePosted: true })]));
check('invoice receipt evidence blocks withdrawal', !allow('invoice', [row('invoice-1', { receiptFiles: [{ path: 'proof.pdf' }] })]));
check('invoice pending receipt review blocks withdrawal', !allow('invoice', [row('invoice-1', { status: 'pending_receipt_review' })]));
check('issued invoice awaiting applicant delivery cannot be withdrawn', !allow('invoice', [row('invoice-1', {
  approvalStatus: 'pending_invoice_delivery', approvalStep: 2,
  steps: [{ rk: 'accountant_invoice', a: 'approved' }, { rk: 'applicant_invoice_delivery' }]
})]));
check('completed accountant invoice issue step blocks withdrawal even if later status is pending',
  !allow('invoice', [row('invoice-1', {
    approvalStatus: 'pending_accountant', approvalStep: 2,
    steps: [{ rk: 'accountant_invoice', a: 'approved' }, { rk: 'applicant_invoice_delivery' }]
  })]));
check('all invoice-issue roles and approved or auto decisions block withdrawal',
  ['accountant_invoice', 'invoice_issue', 'invoice_issuance'].every(role =>
    ['approved', 'auto'].every(action => !allow('invoice', [row('invoice-1', {
      approvalStatus: 'pending_accountant', approvalStep: 2,
      steps: [{ rk: role, a: action }, { rk: 'applicant_invoice_delivery' }]
    })]))));
check('completed bill approval cannot be withdrawn', !allow('bill', [row('bill-1', { approvalStatus: 'completed' })]));
check('completed invoice approval cannot be withdrawn', !allow('invoice', [row('invoice-1', { approvalStatus: 'completed' })]));
reconcilePending = true;
check('unknown previous transaction fails closed', !allow('bill', [row('bill-1')]));
reconcilePending = false;
verified = false;
sourceComplete = false;
check('unverified source row fails closed', !allow('bill', [row('bill-1')]));
verified = true;
sourceComplete = true;
frozen = false;
check('unconfirmed row version fails closed', !allow('invoice', [row('invoice-1')]));
frozen = true;
hasConnection = false;
check('disconnected mode fails closed', !allow('invoice', [row('invoice-1')]));
hasConnection = true;
safeBootstrap = false;
check('incomplete auth bootstrap fails closed', !allow('bill', [row('bill-1')]));
safeBootstrap = true;
check('eligible bill button is enabled and invokes bill withdrawal',
  allow('bill', [row('bill-1')]) && /onclick="[^"]*withdrawBill\(/.test(context.incomeApplicantWithdrawButtonHtml('bill', fixtures.bill[0], true)));
check('bill withdrawal button onclick is valid browser JavaScript after one HTML decode',
  compiledButtonAction(context.incomeApplicantWithdrawButtonHtml('bill', fixtures.bill[0], true), 'withdrawBill', 'bill-1'));
check('invoice withdrawal button onclick is valid browser JavaScript after one HTML decode',
  allow('invoice', [row('invoice-1')])
    && compiledButtonAction(context.incomeApplicantWithdrawButtonHtml('invoice', fixtures.invoice[0], false), 'withdrawInvoice', 'invoice-1'));
check('ineligible invoice button explains why it is disabled',
  !allow('invoice', [row('invoice-1', { revenuePosted: true })])
    && /disabled aria-disabled="true"/.test(context.incomeApplicantWithdrawButtonHtml('invoice', fixtures.invoice[0], true)));

function expense(type, options = {}) {
  return {
    id: `request-${type}`, type, applicantId: 'applicant-1',
    tenantId: 'tenant-1', dataEnv: 'production', status: 'pending_supervisor',
    steps: [{ rk: 'supervisor' }, { rk: 'ceo' }], ...options
  };
}
const standardExpenseTypes = [
  'expense_reimbursement', 'payment_request', 'advance_request',
  'petty_cash_request', 'travel_request', 'purchase_request',
  'refund_request', 'welfare_request', 'hr_expense_request',
  'shareholder_transaction'
];
check('all ten expense and shareholder application types remain applicant-withdrawable before funding',
  standardExpenseTypes.every(type => context.canWithdrawRequest(expense(type))));
check('other employee cannot withdraw an expense request even if the display name matches',
  !context.canWithdrawRequest(expense('purchase_request', { applicantId: 'other', app: '申請人' })));
check('an old matching email cannot override another expense applicant ID',
  !context.canWithdrawRequest(expense('purchase_request', { applicantId: 'other', applicantEmail: 'applicant@suiyuecare.com' })));
check('expense request is not withdrawable at or after cashier funding',
  !context.canWithdrawRequest(expense('purchase_request', { status: 'pending_cashier' }))
    && !context.canWithdrawRequest(expense('purchase_request', {
      steps: [{ rk: 'supervisor', a: 'approved' }, { rk: 'ceo' }]
    })));
const laborMarker = { version: 1, signerName: '講師' };
const labor = expense('hr_expense_request', {
  id: 'request-labor', formPayload: { electronicLabor: laborMarker }
});
laborStates.set(labor.id, { loaded: true, data: { status: 'pending_invite', statementId: null } });
check('electronic labor applicant may withdraw only before lecturer invitation',
  context.canWithdrawRequest(labor));
laborStates.set(labor.id, { loaded: true, data: { status: 'invited', statementId: 'statement-1' } });
check('invited lecturer or existing statement blocks applicant withdrawal',
  !context.canWithdrawRequest(labor));
laborStates.set(labor.id, { loaded: true, data: { status: 'pending_invite', statementId: 'statement-1' } });
check('statement creation blocks withdrawal even when status still says pending invite',
  !context.canWithdrawRequest(labor));
laborStates.delete(labor.id);
check('unknown electronic labor state fails closed until verified',
  !context.canWithdrawRequest(labor));

async function runActions() {
  allow('bill', [row('bill-1', { batchCount: 2 }), row('bill-2', { batchCount: 2 })]);
  await context.withdrawIncomeDocument('bill', 'bill-1');
  check('bill withdrawal sends exactly one RPC with every batch id',
    rpcCalls.length === 1 && rpcCalls[0].name === 'finance_bill_withdraw_applicant_v1'
      && JSON.stringify(rpcCalls[0].args.p_bill_ids) === JSON.stringify(['bill-1', 'bill-2']));
  check('bill withdrawal sends stable idempotency key and expected versions',
    rpcCalls[0].args.p_idempotency_key === 'stable-attempt-id'
      && rpcCalls[0].args.p_expected_steps['bill-1'].row_version === 3);
  check('successful bill withdrawal clears recovery context only after readback',
    clearActionCount === 1 && fixtures.bill.every(item => item.approvalStatus === 'cancelled' && item.status === 'cancelled'));

  rpcCalls.length = 0;
  allow('invoice', [row('invoice-1'), row('invoice-2')]);
  await context.withdrawIncomeDocument('invoice', 'invoice-1');
  check('invoice withdrawal sends one RPC with every batch id',
    rpcCalls.length === 1 && rpcCalls[0].name === 'finance_invoice_withdraw_applicant_v1'
      && JSON.stringify(rpcCalls[0].args.p_invoice_ids) === JSON.stringify(['invoice-1', 'invoice-2']));
  check('confirmed cancelled bill and invoice display cancellation labels',
    context.billApprovalLabel(fixtures.bill[0]) === '已抽單取消'
      && context.invApprovalLabel(fixtures.invoice[0]) === '已抽單取消');
  check('cancelled invoice is absent from receivable tracking even if stale receipt evidence remains',
    !context.invoiceIsReceivable({ ...fixtures.invoice[0], receiptFiles: [{ path: 'stale.pdf' }] })
      && context.recvBaseInvoices().length === 0);

  rpcCalls.length = 0;
  rpcOutcome = 'unknown';
  const clearsBefore = clearActionCount;
  allow('bill', [row('bill-1')]);
  await context.withdrawIncomeDocument('bill', 'bill-1');
  check('ambiguous result does not submit a second withdrawal or clear recovery identity',
    rpcCalls.length === 1 && clearActionCount === clearsBefore && notices.at(-1) === 'timeout');

  const listRenderer = namedFunction('renderApprList');
  check('applicant-only list and detail views expose both income withdrawal actions',
    /S\.aT==='mine'[\s\S]*incomeApplicantWithdrawButtonHtml\(kind==='bill'\?'bill':'invoice',r,false\)/.test(listRenderer)
      && /incomeApplicantWithdrawButtonHtml\('bill',b,true\)/.test(namedFunction('showBillApprD'))
      && /incomeApplicantWithdrawButtonHtml\('invoice',i,true\)/.test(namedFunction('showInvApprD'))
      && /window\.withdrawBill=function/.test(index)
      && /window\.withdrawInvoice=function/.test(index));
  check('expense and labor withdrawal is shown in mine and request detail views',
    /S\.aT==='mine'[\s\S]*canWithdrawRequest\(r\)[\s\S]*withdrawRequest\(/.test(listRenderer)
      && /window\.openDetail=function[\s\S]*canWithdrawRequest\(r\)[\s\S]*withdrawRequest\(/.test(index));

  check('new withdrawal migration is nonempty and defines both authenticated RPCs',
    migration.length > 2000
      && /function public\.finance_bill_withdraw_applicant_v1\(/i.test(migration)
      && /function public\.finance_invoice_withdraw_applicant_v1\(/i.test(migration));
  check('SQL checks stable applicant identity and expected row versions',
    /applicant_id/i.test(migration) && /row_version/i.test(migration)
      && /p_expected_steps/i.test(migration));
  check('SQL requires complete batch scope and protects posted or paid documents',
    /batch_id/i.test(migration) && /paid_at|paid/i.test(migration)
      && /revenue_posted|revenue_posted_at/i.test(migration)
      && /posting_locked_at/i.test(migration));
  check('SQL also rejects an issued invoice before applicant delivery',
    /pending_invoice_delivery/.test(migration)
      && /'accountant_invoice'/.test(migration)
      && /'invoice_issue'/.test(migration));
  check('SQL treats deferred revenue as unposted but still checks actual posting markers',
    /revenue_posting_state[\s\S]{0,120}not in\s*\('not_posted',\s*'deferred'\)/i.test(migration)
      && /revenue_posted_at/i.test(migration)
      && /revenue_posted'\)::boolean/i.test(migration));
  check('SQL uses a durable idempotency record and preserves cancelled rows',
    /finance_income_begin_operation/i.test(migration)
      && /finance_income_finish_operation/i.test(migration)
      && /approval_status\s*=\s*'cancelled'/i.test(migration)
      && /update\s+public\.bills[\s\S]*?status\s*=\s*'cancelled'/i.test(migration)
      && /update\s+public\.invoices[\s\S]*?status\s*=\s*'cancelled'/i.test(migration)
      && !/delete\s+from\s+public\.(?:bills|invoices)/i.test(migration));
  check('canonical receivables SQL excludes cancelled invoices from unrecognized AR and collection mutations',
    /i\.status\s+not\s+in\s*\('void','voided','cancelled','rejected'\)/i.test(receivablesSql)
      && /i\.approval_status\s+in\s*\('rejected','cancelled','voided'\)/i.test(receivablesSql));
  check('electronic labor guard rejects cancellation after statement creation',
    /finance_labor_statements_v1/i.test(migration)
      && /cancelled/i.test(migration));
  process.stdout.write(`OK ${passed} applicant withdrawal checks passed\n`);
}
runActions().catch(error => { console.error(error); process.exitCode = 1; });
