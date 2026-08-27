#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const dataEngine = fs.readFileSync(path.join(root, 'assets/engines/data-engine.js'), 'utf8');
const migration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260821170000_membership_org_expense_submission_v1.sql'),
  'utf8'
);

let passed = 0;
const checks = [];

function check(name, predicate) {
  const ok = Boolean(predicate);
  checks.push({ name, ok });
  if (ok) passed += 1;
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'} ${name}\n`);
}

function extractNamedFunction(source, name) {
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`missing function ${name}`);
  const open = source.indexOf('{', start);
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`unterminated function ${name}`);
}

const director = {
  id: 'u5',
  email: 'admin@suiyuecare.com',
  n: '劉巧涵',
  role: 'admin_director',
  dc: 'A1100',
  eid: 'E4',
  active: true,
  authUserId: 'auth-director'
};
const accountant = {
  id: 'u6',
  email: 'suiyue.acct@suiyuecare.com',
  n: '劉巧涵',
  role: 'accountant',
  dc: 'A1101',
  eid: 'E4',
  active: true,
  authUserId: 'auth-accountant'
};
const nodes = {
  'nr-app-id': { value: director.id },
  'inv-app-sel': { value: accountant.id },
  'inv-dept': { value: director.dc }
};
const sandbox = {
  USERS: [accountant, director],
  S: { user: director },
  el(id) { return nodes[id] || null; },
  isExpenseApplicantRevisionMode() { return false; },
  escAttr(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  },
  console
};
vm.createContext(sandbox);
[
  'financeUserByStableIdentity',
  'financeUserByUniqueLegacyName',
  'financeUserForStoredApplicant',
  'currentNewReqApplicantUser',
  'expenseSubmissionIdentityError',
  'currentUserIsNamed',
  'selectedInvoiceApplicant',
  'expenseOwnerFieldsHtml'
].forEach((name) => vm.runInContext(extractNamedFunction(index, name), sandbox));

check('stable Finance user lookup resolves the director by exact id',
  sandbox.financeUserByStableIdentity(director.id) === director);
check('stable Finance user lookup resolves the director by exact email',
  sandbox.financeUserByStableIdentity(director.email) === director);
check('a duplicated legacy display name is never accepted as an identity',
  sandbox.financeUserByUniqueLegacyName('劉巧涵') === null);
check('expense applicant resolves the logged-in director even when the accountant is first',
  sandbox.currentNewReqApplicantUser() === director);

nodes['nr-app-id'].value = accountant.id;
check('tampering the hidden applicant id fails closed',
  sandbox.currentNewReqApplicantUser() === null);
nodes['nr-app-id'].value = director.id;

const correctSteps = [{ rk: 'applicant_submit', uid: director.id, a: 'approved' }, { rk: 'department_manager', uid: 'manager-1', a: '' }];
check('an exact logged-in applicant and first step pass preflight',
  sandbox.expenseSubmissionIdentityError(director, director.n, correctSteps) === '');
check('the same-name accountant cannot be substituted for the director',
  /帳號與目前登入者不一致/.test(sandbox.expenseSubmissionIdentityError(accountant, accountant.n, correctSteps)));
check('a first step assigned to the other same-name account is rejected',
  /第一關/.test(sandbox.expenseSubmissionIdentityError(director, director.n, [{ rk: 'applicant_submit', uid: accountant.id, a: 'approved' }])));
check('legacy name-only ownership fails closed when two active users share the name',
  sandbox.currentUserIsNamed('劉巧涵') === false);
check('invoice applicant selection also prefers the authenticated user over a stale field',
  sandbox.selectedInvoiceApplicant('inv').user === director);

const ownerHtml = sandbox.expenseOwnerFieldsHtml('', '', '', director.n);
check('expense form renders a readonly applicant plus stable hidden id',
  /id="nr-app" readonly/.test(ownerHtml)
    && /id="nr-app-id" value="u5"/.test(ownerHtml)
    && !/nr-app-sel/.test(ownerHtml));

const submitStart = index.indexOf('window.submitNR=async function(){');
const submitEnd = index.indexOf('// ══ 放款申請 ══', submitStart);
const submit = index.slice(submitStart, submitEnd);
const firstIdentity = submit.indexOf('var appUser=currentNewReqApplicantUser();');
const finalIdentity = submit.indexOf('var finalIdentityError=expenseSubmissionIdentityError');
const nextNumber = submit.indexOf('nextExpenseRequestNo(');
const upload = submit.indexOf('uploadPreparedAttachmentSet(no)');
check('identity is checked before number allocation and any attachment upload',
  firstIdentity > -1 && finalIdentity > firstIdentity && nextNumber > finalIdentity && upload > nextNumber);
check('expense submission no longer resolves applicant by display name',
  !/USERS\.find\(function\(u\)\{return u\.n===appName;\}/.test(submit));
check('applicant id and email are persisted from the resolved authenticated user',
  /applicantId:appUser\.id/.test(submit) && /applicantEmail:appUser\.email/.test(submit));
const smokeHookStart = index.indexOf('window.__financeSetSubmissionRouteSmokeOverride=');
const prepareRouteStart = index.indexOf('async function prepareApprovalRouteForSubmit', smokeHookStart);
const prepareRouteEnd = index.indexOf('function approvalRuntimeSourceTableForRecord', prepareRouteStart);
const smokeHook = index.slice(smokeHookStart, prepareRouteEnd);
check('browser route override is localhost-only, demo-only, and consumed once',
  smokeHookStart > -1
    && /!isLocalRuntime\(\)\|\|!S\.demoLogin/.test(smokeHook)
    && /isLocalRuntime\(\)&&S\.demoLogin&&SUBMISSION_ROUTE_SMOKE_OVERRIDE/.test(smokeHook)
    && /SUBMISSION_ROUTE_SMOKE_OVERRIDE=null;/.test(smokeHook));
check('backend independently requires exact id, email, name, and applicant first step',
  /v_request\.applicant_id is distinct from v_actor\.id/.test(migration)
    && /v_request\.applicant_email/.test(migration)
    && /v_request\.applicant/.test(migration)
    && /finance_income_step_role\(v_first_step\) <> 'applicant_submit'/.test(migration)
    && /v_first_step ->> 'uid'.*v_actor\.id/s.test(migration));
check('permission error explains an applicant-login mismatch before generic RLS copy',
  dataEngine.indexOf('申請人資料必須與目前登入身分完全一致') > -1
    && dataEngine.indexOf('申請人資料必須與目前登入身分完全一致') < dataEngine.indexOf("lower.indexOf('row-level security')"));
const registeredDataEngines = {};
const dataWindow = {
  FinanceV4Engines: {
    register(name, engine) { registeredDataEngines[name] = engine; }
  },
  console
};
dataWindow.window = dataWindow;
vm.runInNewContext(dataEngine, { window: dataWindow, console }, { filename: 'data-engine.js' });
const authorityCopy = dataWindow.FinanceDataEngine.friendlyErrorMessage({
  code: '42501',
  message: '第 7 關 cashier 不是正式組織指定的簽核人'
}, { action: '送出申請' });
check('正式簽核人不一致會顯示可行動原因，不會被泛用權限訊息蓋掉',
  /簽核人與正式組織設定不一致/.test(authorityCopy)
    && /第 7 關 cashier/.test(authorityCopy)
    && !/目前帳號沒有權限/.test(authorityCopy));

if (passed !== checks.length) {
  process.stderr.write(`\n${passed}/${checks.length} checks passed\n`);
  process.exit(1);
}
process.stdout.write(`\n${passed}/${checks.length} checks passed\n`);
