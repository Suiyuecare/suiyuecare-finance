#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function section(start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert(from >= 0 && to > from, `Missing source section: ${start}`);
  return source.slice(from, to);
}

const node = { innerHTML: '' };
let cashier = null;
let identity = 'person-A';
let validations = 0;
let previewReads = 0;
const healthContext = {
  S: { nrType: 'petty_cash_request', demoLogin: false },
  ORG_ADMIN_RUNTIME: { employeeRolesConfirmed: false, employeeRolesIdentity: '', error: '' },
  NR_ROLE_PREVIEW_REQUEST: { identity: '', lastAttemptAt: 0 },
  window: {},
  Date,
  console,
  refreshApprovalOrgAdminRuntime: async () => { previewReads++; },
  el(id) {
    if (id === 'nr-route-health') return node;
    return { value: id === 'nr-dept' ? 'B1302' : '100' };
  },
  currentNewReqApplicantUser: () => ({ id: 'applicant', dc: 'B1302' }),
  workflowRequiresStep: () => true,
  cashierUser: () => cashier,
  financeStartupReadIdentity: () => identity,
  hasSupabase: () => true,
  currentNewReqFixedExpense: () => false,
  validateApprovalRoute() {
    validations++;
    return cashier ? { ok: true, errors: [] } : { ok: false, errors: ['系統找不到正式出納'] };
  },
  newReqApprovalStepsForHealth: () => [],
  escAttr: (value) => String(value),
  num: Number,
};
vm.createContext(healthContext);
vm.runInContext(
  section('function routeHealthPanelHtml(', 'function currentNewReqApplicantUser(')
    + section('function updateNRRouteHealth(', 'window.updateNRRouteHealth=updateNRRouteHealth;'),
  healthContext,
);

healthContext.updateNRRouteHealth();
assert.match(node.innerHTML, /正式簽核人確認中/);
assert.doesNotMatch(node.innerHTML, /暫時不能送出|前往組織圖/);
assert.equal(validations, 0, 'Unloaded secondary roles must not be diagnosed as missing');
assert.equal(previewReads, 1, 'Opening the form starts a formal role read');

cashier = { id: 'formal-cashier' };
healthContext.updateNRRouteHealth();
assert.match(node.innerHTML, /正式簽核人確認中/, 'An unverified cached cashier must not become a trusted preview');
assert.equal(previewReads, 1, 'Typing while the role read is pending must not fan out RPCs');
healthContext.ORG_ADMIN_RUNTIME.employeeRolesConfirmed = true;
healthContext.ORG_ADMIN_RUNTIME.employeeRolesIdentity = identity;
healthContext.updateNRRouteHealth();
assert.match(node.innerHTML, /可以送出/);

cashier = null;
healthContext.updateNRRouteHealth();
assert.match(node.innerHTML, /暫時不能送出.*正式出納/s);

identity = 'person-B';
healthContext.updateNRRouteHealth();
assert.match(node.innerHTML, /正式簽核人確認中/);
assert.doesNotMatch(node.innerHTML, /暫時不能送出/);

async function testEarlyRoleRead() {
  let resolveRoles;
  let resolveHealth;
  let routeRefreshes = 0;
  let currentIdentity = 'person-A';
  const runtime = {
    ORG_ADMIN_RUNTIME: { employeeRoles: [], departmentHealth: null, departmentHealthError: '', available: null },
    ORG_ADMIN_READ_STATE: null,
    S: { demoLogin: false },
    financeStartupReadIdentity: () => currentIdentity,
    getSb: () => client,
    readOrgAdminRuntimeRpc(_client, name) {
      if (name === 'finance_org_employee_role_list') {
        return new Promise((resolve) => { resolveRoles = resolve; });
      }
      return Promise.resolve({ data: [], fallback: false });
    },
    fallbackOrgAdminDepartments: () => [],
    fallbackOrgAdminPositions: () => [],
    fallbackOrgAdminEmployeeRoles: () => [],
    withOperationTimeout: (promise) => promise,
    normalizeOrgAdminList: (rows) => rows || [],
    normalizeOrgAdminHealth: (row) => row,
    normalizeFrontOfficePermissionRuntimeHealth: (row) => row,
    verifyDepartmentRuntimeHealth: async () => {},
    renderOrgAdminRuntimeStatus: () => {},
    updateNRRouteHealth: () => { routeRefreshes++; },
    isRpcMissing: () => false,
    console,
    Date,
  };
  const client = {
    rpc(name) {
      if (name === 'finance_front_office_permission_runtime_health') {
        return new Promise((resolve) => { resolveHealth = resolve; });
      }
      return Promise.resolve({ data: {} });
    },
  };
  vm.createContext(runtime);
  vm.runInContext(
    section('async function performApprovalOrgAdminRuntimeRead(', 'async function syncFrontOfficePermissionRuntime('),
    runtime,
  );

  const state = { identity: currentIdentity, lastSuccessAt: 0 };
  runtime.ORG_ADMIN_READ_STATE = state;
  let finished = false;
  const read = runtime.performApprovalOrgAdminRuntimeRead(client, 'test', state).then((result) => {
    finished = true;
    return result;
  });
  resolveRoles({ data: [{ role_key: 'cashier', finance_user_id: 'formal-cashier' }], fallback: false });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(runtime.ORG_ADMIN_RUNTIME.employeeRolesConfirmed, true);
  assert.equal(runtime.ORG_ADMIN_RUNTIME.employeeRoles[0].role_key, 'cashier');
  assert.equal(routeRefreshes, 1, 'Role preview should refresh before unrelated health RPC finishes');
  assert.equal(finished, false);
  resolveHealth({ data: {} });
  assert.equal((await read).ok, true);
  assert.equal(routeRefreshes, 2);

  runtime.ORG_ADMIN_RUNTIME = { employeeRoles: [], available: null };
  const staleState = { identity: currentIdentity, lastSuccessAt: 0 };
  runtime.ORG_ADMIN_READ_STATE = staleState;
  const staleRead = runtime.performApprovalOrgAdminRuntimeRead(client, 'test', staleState);
  currentIdentity = 'person-B';
  resolveRoles({ data: [{ role_key: 'cashier', finance_user_id: 'old-person' }], fallback: false });
  resolveHealth({ data: {} });
  assert.equal((await staleRead).stale, true);
  assert.equal(runtime.ORG_ADMIN_RUNTIME.employeeRoles.length, 0, 'Old identity must not replace new role data');
}

testEarlyRoleRead().then(() => {
  const gateSource = section('window.submitNR=async function(){', '  if(S.nrSubmitting)return;')
    .replace('window.submitNR=async function(){', 'async function testPendingGate(){')
    + '  return "continue";\n}';
  let pendingState = 'deterministic_failure';
  let pendingVisible = true;
  const recoveryOptions = [];
  const gateContext = {
    POSTING_IN_FLIGHT: {},
    S: { nrSubmissionConfirmationPending: true },
    loadExpenseRevisionPending: () => null,
    loadExpenseSubmissionPending: () => pendingVisible ? ({ requestId: 'prior-attempt' }) : null,
    reconcilePendingExpenseSubmission: async (options) => { recoveryOptions.push(options); return { state: pendingState }; },
    refreshExpenseSubmissionRecoveryActions: () => {},
    alert: () => {},
  };
  vm.createContext(gateContext);
  vm.runInContext(gateSource, gateContext);
  return gateContext.testPendingGate().then(async (outcome) => {
    assert.equal(outcome, undefined, 'A failed confirmation must retain the durable attempt and block a fresh request');
    assert.equal(recoveryOptions[0].retainAttachmentsOnFailure, true);
    assert.equal(recoveryOptions[0].requireDirectoryForRetry, true);
    pendingState = 'committed';
    assert.equal(await gateContext.testPendingGate(), undefined, 'Confirmed committed prior attempt must stop duplicate creation');
    pendingState = 'unknown';
    assert.equal(await gateContext.testPendingGate(), undefined, 'Unknown outcome must remain blocked');
    pendingVisible = false;
    assert.equal(await gateContext.testPendingGate(), 'continue', 'Only a cleared owner-scoped pending marker permits a fresh request');
  });
}).then(() => {
  console.log('PASS: formal cashier preview and submission recovery keep authorized sends available without duplicate attempts');
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
