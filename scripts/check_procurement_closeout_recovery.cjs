#!/usr/bin/env node
'use strict';
// Execute the shipped UI functions against anonymous in-memory records. No
// network, credentials, production data, or generated files are used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));
let passed = 0;

function source(name, assigned = false) {
  const marker = assigned ? 'window.' + name + '=' : null;
  const match = assigned ? { index: html.indexOf(marker) }
    : new RegExp('^(?:async )?function ' + name + '\\(', 'm').exec(html);
  assert(match && match.index >= 0, 'Production function exists: ' + name);
  const start = match.index;
  // Let the JS parser identify the end, including braces in strings/comments.
  for (let end = html.indexOf('}', start); end >= 0; end = html.indexOf('}', end + 1)) {
    const candidate = html.slice(start, end + 1);
    try { new vm.Script(candidate); return candidate + ';'; } catch (_) {}
  }
  throw Error('Could not extract ' + name);
}
function load(c, names, assigned = []) {
  vm.runInContext(names.map(name => source(name)).concat(assigned.map(name => source(name, true))).join('\n'), c);
}
const proof = { n: 'anonymous-invoice.pdf', mime: 'application/pdf', bucket: 'finance-attachments', path: 'production/expense_requests/anonymous-purchase/invoice.pdf' };
const spreadsheet = { n: 'expense-detail.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', bucket: 'finance-attachments', path: 'production/expense_requests/anonymous-purchase/details.xlsx' };
function row(role = 'procurement_receipt') {
  return { id: 'fixture', no: 'anonymous-purchase', type: 'purchase_request', status: role === 'accountant_final' ? 'pending_voucher' : 'pending_procurement',
    amt: 12500, estimatedAmt: 12500, actualAmt: 0, actualFiles: [], files: [], step: role === 'accountant_final' ? 9 : 8,
    steps: [{ rk: 'procurement_payment', a: 'approved', uid: 'ga', n: 'General Affairs', actionLog: [{ action: '簽核通過', byId: 'ga' }], files: [clone(proof), clone(spreadsheet)] },
      { rk: role, a: '', uid: role === 'accountant_final' ? 'accountant' : 'ga', files: [] }],
    formPayload: { purchaseActual: { actualAmount: 0, files: [], stage: 'pending_actual_receipt' }, accountingLines: [{ accountCode: 'existing' }] } };
}
function context(request = row()) {
  const engines = {};
  const c = { window: { FinanceV4Engines: { register: (key, api) => { engines[key] = api; }, get: key => engines[key] } }, console, Date, Number, Math, JSON, Promise, Error, Set, Map, URL,
    S: { user: { id: 'ga', n: 'General Affairs' }, demoLogin: false, aT: 'p' }, REQS: [request],
    alerts: [], payloads: 0, uploads: 0, transactions: [], writes: [], opened: [], nodes: {}, POSTING_IN_FLIGHT: {} };
  Object.assign(c, {
    cloneSettingValue: clone, num: value => { const n = Number(String(value == null ? '' : value).replace(/,/g, '')); return Number.isFinite(n) ? n : 0; },
    attachmentEngineOptions: () => ({}), activeStep: r => r.steps.find(s => !s.a), canActRequest: () => true,
    approvalStepWasReopenedByReturn: s => !!s.returnedAt, laborElectronicMarker: () => null,
    canReturnPreviousStep: () => true, requireApprovalRecordsActionAvailability: () => true,
    approvalRecordsActionAvailability: (_table, rows) => ({ ok: true, rows }), approvalActionValidation: () => ({ ok: true }),
    approvalRowsHaveReconcilePending: () => false, hasSupabase: () => true,
    alert: message => c.alerts.push(String(message)), el: id => c.nodes[id] || null,
    openDetail: id => c.opened.push(id), showApprD: id => c.opened.push(id), closeAppr: () => {}, buildAll: () => {},
    approvalActionPayload: async () => { c.payloads++; return { comment: 'Explicit evidence confirmation', files: [], addUid: '' }; },
    approvalActionPreflight: () => true, uploadApprovalFiles: async p => { c.uploads += p.files.length; return p; },
    expenseApprovalPreparation: r => ({ work: clone(r), patches: {} }),
    expenseActiveStepTransaction: async (rows, action) => { c.transactions.push({ ids: rows.map(r => r.id), action }); return { available: true, ok: true, count: rows.length }; },
    canEditRequestAccountingLines: () => true,
    recordApprovalWriteFailure: () => { throw Error('Unexpected approval write'); },
    getSb: () => { throw Error('Unexpected generic RPC access'); }, fmt: String, attr: String,
    withProcurementSubmissionLock: (_id, fn) => fn(), loadProcurementSubmissionPending: () => null,
    membershipOrgDraftUuid: () => 'anonymous-operation-id',
    invalidateAccountingLines: r => { r.formPayload.accountingLines = []; r.formPayload.accountingInvalidatedReason = 'actual evidence changed'; },
    approveActiveStep: (r, action, comment, files) => { const s = c.activeStep(r); s.a = action; s.files = clone(files); s.actionLog = [{ action, byId: 'ga', comment }]; r.step = 9; r.status = 'pending_voucher'; },
    persistProcurementSubmission: async (id, kind, work, before, values, uploaded) => {
      c.writes.push({ id, kind, work: clone(work), before: clone(before), values: clone(values), uploaded: clone(uploaded) });
      return true;
    },
    newlyUploadedAttachmentResults: files => files.filter(f => f.__uploadCreatedThisAttempt), cleanupApprovalFilesAfterDefiniteFailure: async () => {},
    expensePostingIdentity: () => 'fixture-identity', expenseTransactionIdentityCurrent: () => true,
    loadExpensePostingPending: () => null, requestPostingLocked: () => false, requestLedgerRowsExist: () => false,
    ensureOpenPostingPeriod: () => true, todayIso: () => '2026-10-05',
    pettyReadyForFinalAccounting: () => ({ ok: true }),
    selectedApprovalItems: () => c.items || [{ kind: 'req', raw: request }],
    prompt: message => /姓名|Email/.test(message) ? 'reviewer' : 'reviewed',
    findBulkCountersignUser: () => ({ id: 'reviewer' }), approvalApplicantIds: () => [], approvalItemSourceRows: item => [item.raw],
    approvalRowFormNo: item => item.raw.no, approvalItemKey: item => item.raw.id,
    approvalClearBulkExpectedSteps: () => {}, buildInvoices: () => {}, buildRecv: () => {}, buildDash: () => {}, buildReports: () => {}, buildApprovals: () => {}
  });
  vm.createContext(c);
  vm.runInContext(fs.readFileSync(path.join(root, 'assets/engines/attachment-engine.js'), 'utf8'), c);
  load(c, ['financeAttachmentEngine', 'normalizeFileMeta', 'normalizeFiles', 'uniqueAttachments', 'attachmentStoragePath', 'attachmentIsReceiptEvidence', 'escAttr',
    'purchaseActualAmount', 'purchaseEstimatedAmount', 'purchaseFinalAmount', 'expensePostingAmount', 'purchaseHasFinalEvidence', 'purchaseReadyForFinalAccounting',
    'procurementRequiresDedicatedAction', 'procurementDedicatedActionMessage', 'procurementReusableEvidence', 'procurementExistingEvidenceHtml', 'collectProcurementExistingEvidence', 'purchaseFinalRecoveryHtml',
    'isRestrictedReturnedMiddleStep', 'expenseStepAllowsAccountingPatch', 'shouldCollectAccountingLines', 'canBulkApproveWithoutAccountingLineCollection']);
  return c;
}
function check(label, condition = true) { assert(condition, label); passed++; console.log('PASS ' + label); }

(async () => {
  for (const role of ['procurement_payment', 'procurement_receipt', 'procurement_review']) {
    const r = row(role), c = context(r);
    check(role + ' requires its dedicated form', c.procurementRequiresDedicatedAction(r));
    r.steps[1].returnedAt = '2026-10-04T01:00:00Z';
    check(role + ' retains its dedicated form after return', !c.isRestrictedReturnedMiddleStep(r));
    for (const handler of ['doApprove', 'apprApprove']) {
      const d = context(clone(r)); load(d, [], [handler]); await d.window[handler](r.id);
      check(handler + ' blocks ' + role + ' before file collection or upload', d.payloads === 0 && d.uploads === 0 && d.transactions.length === 0 && d.alerts.length > 0);
    }
    for (const action of ['approve', 'countersign']) {
      const d = context(clone(r)); load(d, ['bulkRunSelected']); await d.bulkRunSelected(action);
      check('Bulk ' + action + ' skips ' + role + ' without dispatch', d.transactions.length === 0 && d.uploads === 0 && d.REQS[0].steps[1].a === '' && d.alerts.some(x => /採購|總務/.test(x)));
    }
    for (const action of ['approve', 'add_sign']) {
      const d = context(clone(r)); load(d, ['expenseActiveStepTransaction']);
      const result = await d.expenseActiveStepTransaction(d.REQS, action, 'reason', [], action === 'add_sign' ? 'reviewer' : '', {});
      check('Central generic transaction refuses ' + action + ' at ' + role, result.available === true && result.ok === false && /採購|總務/.test(result.error.message));
    }
  }
  {
    const r = row('dept_manager'), c = context(r); r.type = 'payment_request'; r.steps[1].returnedAt = '2026-10-04';
    check('Non-procurement returned middle step remains restricted', c.isRestrictedReturnedMiddleStep(r) && !c.procurementRequiresDedicatedAction(r));
    load(c, [], ['doApprove']); await c.window.doApprove(r.id);
    check('Ordinary approval still reaches the generic transaction', c.transactions.length === 1);
  }
  {
    const r = row(), other = row('dept_manager'), c = context(r); other.id = 'other-request'; other.no = 'ordinary-payment'; other.type = 'payment_request';
    c.items = [{ kind: 'req', raw: r }, { kind: 'req', raw: other }];
    load(c, ['bulkRunSelected']); await c.bulkRunSelected('approve');
    check('Mixed bulk selection still sends only eligible ordinary approvals', c.transactions.length === 1 && c.transactions[0].ids.length === 1 && c.transactions[0].ids[0] === other.id && r.steps[1].a === '');
  }
  {
    const r = row(), c = context(r);
    r.files = [clone(proof), { n: 'name-only.pdf' }, { n: 'signed-only.pdf', url: 'https://example.invalid/signed.pdf?token=fixture' }];
    r.actualFiles = [{ name: 'duplicate.pdf', storage_path: proof.path, uploadedBy: 'ga' }];
    r.steps[0].files.push({ name: 'receipt.png', type: 'image/png', storagePath: 'production/expense_requests/anonymous-purchase/receipt.png' });
    const evidence = c.procurementReusableEvidence(r);
    check('Reusable evidence deduplicates persisted paths across eligible historical locations', evidence.length === 2 && new Set(evidence.map(f => f.path)).size === 2);
    check('Reusable evidence normalizes legacy storage_path/storagePath metadata', evidence.every(f => f.path && f.bucket));
    const markup = c.procurementExistingEvidenceHtml(r, 'proc');
    check('Existing evidence requires explicit unchecked selection', markup.includes('proc-reuse-files') && /type=["']checkbox/.test(markup) && !/\schecked(?:[\s=>])/.test(markup));
    check('Missing selection never auto-promotes historical attachments', c.collectProcurementExistingEvidence(r, 'proc').length === 0);
    // Simulate only the checked DOM nodes. The implementation must resolve
    // their indices against the current eligible evidence, not trust raw paths.
    c.nodes['proc-reuse-files'] = { querySelectorAll: () => [{ value: '0', dataset: { index: '0', procurementEvidenceIndex: '0' }, getAttribute: name => /index/.test(name) ? '0' : null }] };
    const selected = c.collectProcurementExistingEvidence(r, 'proc');
    check('Explicit selection returns only the selected persisted evidence', selected.length === 1 && selected[0].path === evidence[0].path);
    c.nodes['proc-reuse-files'] = { querySelectorAll: () => [{ value: '999', dataset: { index: '999', procurementEvidenceIndex: '999' }, getAttribute: () => '999' }] };
    check('Out-of-range selection cannot fabricate evidence', c.collectProcurementExistingEvidence(r, 'proc').length === 0);
    for (const index of ['-1', '00', '0.1', 'NaN', '0 OR 1']) {
      c.nodes['proc-reuse-files'] = { querySelectorAll: () => [{ getAttribute: () => index }] };
      assert.equal(c.collectProcurementExistingEvidence(r, 'proc').length, 0, 'Invalid selection index: ' + index);
    }
    check('Malformed evidence indices are refused');
    c.nodes['proc-reuse-files'] = { querySelectorAll: () => [{ getAttribute: () => '0' }, { getAttribute: () => '0' }] };
    check('Duplicate checkbox indices do not double-count proof', c.collectProcurementExistingEvidence(r, 'proc').length === 1);
    c.S.user = { id: 'other', n: 'Other Employee' };
    check('Another actor is not offered the prior GA evidence', c.procurementReusableEvidence(r).length === 0);
  }
  {
    const r = row(), c = context(r); r.steps[0].files = [];
    r.files = [{ ...clone(proof), uploaded_by: 'ga' }];
    check('Explicit raw uploader metadata survives candidate normalization', c.procurementReusableEvidence(r).length === 1);
  }
  for (const actual of ['', '0', '-1', 'Infinity', 'NaN']) {
    const r = row(), c = context(r); c.nodes['proc-actual-amt'] = { value: actual };
    load(c, [], ['submitProcurementActual']); await c.window.submitProcurementActual(r.id, 'proc');
    check('Invalid explicit actual amount ' + JSON.stringify(actual) + ' does not collect/upload/write', c.payloads === 0 && c.uploads === 0 && c.writes.length === 0 && c.alerts.length > 0);
    check('Invalid amount never falls back to the estimate', r.actualAmt === 0 && r.amt === 12500 && r.steps[1].a === '');
  }
  {
    const r = row(), before = clone(r), c = context(r); c.nodes['proc-actual-amt'] = { value: '11350' };
    load(c, [], ['submitProcurementActual']); await c.window.submitProcurementActual(r.id, 'proc');
    check('Historical attachments alone do not count without explicit selection', c.writes.length === 0 && c.alerts.length > 0);
    assert.deepEqual(r, before); check('Failed evidence preflight leaves the original request untouched');
  }
  {
    const r = row(), before = clone(r), c = context(r); c.nodes['proc-actual-amt'] = { value: '11350' };
    c.approvalActionPayload = async () => ({ comment: 'spreadsheet only', files: [clone(spreadsheet)], addUid: '' });
    load(c, [], ['submitProcurementActual']); await c.window.submitProcurementActual(r.id, 'proc');
    check('A spreadsheet alone does not trigger upload or qualify as receipt evidence', c.writes.length === 0 && c.uploads === 0 && c.alerts.length > 0);
    assert.deepEqual(r, before);
  }
  {
    const r = row(), c = context(r); c.nodes['proc-actual-amt'] = { value: '11350' };
    c.approvalActionPayload = async () => ({ comment: 'new receipt', files: [clone(proof)], addUid: '' });
    load(c, [], ['submitProcurementActual']); await c.window.submitProcurementActual(r.id, 'proc');
    check('New receipt upload remains available without selecting an old file', c.writes.length === 1 && c.uploads === 1 && c.writes[0].values.actual_amount === 11350);
  }
  {
    const r = row(), c = context(r); c.nodes['proc-actual-amt'] = { value: '11350' };
    c.approvalActionPayload = async () => ({ comment: 'cannot combine', files: [clone(proof)], addUid: 'reviewer' });
    load(c, [], ['submitProcurementActual']); await c.window.submitProcurementActual(r.id, 'proc');
    check('Dedicated receipt submission still refuses simultaneous countersign', c.writes.length === 0 && c.uploads === 0 && c.alerts.some(x => /加簽/.test(x)));
  }
  {
    const r = row(), before = clone(r), c = context(r), cleaned = [], received = [];
    const fresh = [
      { n: 'new-receipt.pdf', mime: 'application/pdf', path: 'production/expense_requests/anonymous-purchase/new.pdf' },
      { n: 'new-photo.png', mime: 'image/png', path: 'production/expense_requests/anonymous-purchase/new.png' }
    ];
    let failSecond = true;
    c.nodes['proc-actual-amt'] = { value: '11350' };
    c.nodes['proc-reuse-files'] = { querySelectorAll: () => [{ getAttribute: () => '0' }] };
    Object.assign(c, {
      PROCUREMENT_SUBMISSION_RUNNING: {}, ATTACHMENT_RESUMABLE_THRESHOLD_BYTES: 10000000,
      ATTACHMENT_LARGE_UPLOAD_TIMEOUT_MS: 30000, ATTACHMENT_UPLOAD_TIMEOUT_MS: 10000,
      approvalActionPayload: async () => ({ comment: 'old plus new evidence', files: clone(fresh), addUid: '' }),
      attachmentArchiveContext: () => ({ recordDate: '2026-10-05', entityId: 'fixture-entity', departmentCode: 'fixture-department' }),
      preflightAttachmentsForSupabase: async files => files,
      uploadAttachmentWithTrackedTimeout: async file => {
        received.push(file.path);
        if (failSecond && file.path === fresh[1].path) throw Error('anonymous upload failure');
        const uploaded = { ...file };
        Object.defineProperty(uploaded, '__uploadCreatedThisAttempt', { value: true });
        return uploaded;
      },
      cleanupUploadedSupabaseAttachments: async groups => { cleaned.push(...groups.flat().map(f => f.path)); },
      formatStorageUploadError: error => error.message,
      attachmentUploadError: (message, details) => Object.assign(Error(message), details)
    });
    load(c, ['withProcurementSubmissionLock', 'uploadAttachmentsToSupabase', 'uploadApprovalFiles'], ['submitProcurementActual']);
    await assert.rejects(c.window.submitProcurementActual(r.id, 'proc'), /anonymous upload failure/);
    check('Partial upload failure cannot save or approve even when old proof is selected', c.writes.length === 0 && c.transactions.length === 0);
    assert.deepEqual(r, before);
    check('Upload failure leaves the source unchanged and releases its submission lock', !c.PROCUREMENT_SUBMISSION_RUNNING[r.id]);
    check('Partial failure cleans only the new object, never existing evidence', cleaned.length === 1 && cleaned[0] === fresh[0].path && !cleaned.includes(proof.path));
    check('Selected old evidence never enters the uploader', received.length === 2 && !received.includes(proof.path));
    failSecond = false;
    await c.window.submitProcurementActual(r.id, 'proc');
    const saved = c.writes[0]; assert(saved, c.alerts.join('\n'));
    check('Mixed existing and new evidence can be retried after upload failure', c.writes.length === 1 && saved.values.actual_files.length === 3 && saved.values.form_payload.procurementReceiptInfo.fileCount === 3);
    check('Mixed receipt payload contains exactly the selected old proof and new uploads', new Set(saved.values.actual_files.map(f => f.path)).size === 3 && saved.values.actual_files.some(f => f.path === proof.path));
  }
  {
    const r = row(), before = clone(r), c = context(r); c.nodes['proc-actual-amt'] = { value: '11350' };
    c.nodes['proc-reuse-files'] = { querySelectorAll: () => [{ value: '0', dataset: { index: '0', procurementEvidenceIndex: '0' }, getAttribute: name => /index/.test(name) ? '0' : null }] };
    const persist = c.persistProcurementSubmission;
    c.persistProcurementSubmission = async (...args) => { assert.deepEqual(r, before, 'REQS must not be mutated before durable persistence'); return persist(...args); };
    load(c, [], ['submitProcurementActual']); await c.window.submitProcurementActual(r.id, 'proc');
    assert.equal(c.writes.length, 1, c.alerts.join('\n')); const sent = c.writes[0];
    check('Selected historical invoice can be reused without uploading again', c.uploads === 0 && sent.values.actual_files.some(f => f.path === proof.path));
    check('Actual amount is explicit and preserves original estimate/payment', sent.values.actual_amount === 11350 && sent.values.estimated_amount === 12500 && sent.values.amount === 12500);
    check('Both final-evidence payloads agree with the canonical amount', sent.values.form_payload.purchaseActual.actualAmount === 11350 && sent.values.form_payload.procurementReceiptInfo.actualAmount === 11350);
    check('Actual submission uses the dedicated transaction and records GA approval', sent.kind === 'actual' && sent.values.steps[1].a === 'approved' && c.transactions.length === 0);
    check('Receipt correction invalidates old accounting before final review', sent.values.form_payload.accountingLines.length === 0);
  }
  for (const data of [
    { actualAmt: 0, actualFiles: [clone(proof)] },
    { actualAmt: 11350, actualFiles: [] }
  ]) {
    const r = Object.assign(row('accountant_final'), data), c = context(r); const before = clone(r);
    load(c, [], ['doConfirmVoucher']); await c.window.doConfirmVoucher(r.id);
    check('Final accounting stops missing ' + (data.actualAmt ? 'explicit final evidence' : 'explicit actual amount') + ' before uploads/approval/dispatch', c.payloads === 0 && c.uploads === 0 && c.transactions.length === 0 && c.writes.length === 0 && c.alerts.length > 0);
    assert.deepEqual(r, before); check('Rejected closeout does not change source or retain a posting lock', !c.POSTING_IN_FLIGHT['request-ledger:' + r.id]);
  }
  {
    const r = row('accountant_final'), c = context(r);
    check('Requested/payment amount and filenames never supply final actual amount', c.purchaseFinalAmount(r) === 0 && c.expensePostingAmount(r) === 0 && !c.purchaseReadyForFinalAccounting(r).ok);
    r.actualAmt = 11350; r.actualFiles = [clone(proof)];
    check('Explicit actual amount plus formally bound evidence passes final readiness', c.purchaseReadyForFinalAccounting(r).ok);
    r.actualFiles = [];
    check('Earlier step files do not silently become final proof', !c.purchaseHasFinalEvidence(r));
    const recovery = c.purchaseFinalRecoveryHtml(r);
    check('Final accountant receives an explicit return-to-GA recovery explanation', /退回上一關/.test(recovery) && /最終實際金額/.test(recovery) && /既有憑據/.test(recovery));
    r.actualFiles = [clone(proof)];
    check('Ready purchases do not display an obsolete recovery warning', c.purchaseFinalRecoveryHtml(r) === '');
    const raw = { type: 'purchase_request', actual_amount: 11350, actual_files: [clone(proof)], form_payload: {} };
    check('Final readiness also accepts normalized database field aliases', c.purchaseReadyForFinalAccounting(raw).ok);
  }
  console.log('\nProcurement closeout recovery: ' + passed + ' checks passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
