#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
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
  let start = source.indexOf(marker);
  if (start < 0) throw new Error(`missing function ${name}`);
  if (source.slice(Math.max(0, start - 6), start) === 'async ') start -= 6;
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

function functionBlock(name, nextName) {
  const start = index.indexOf(`function ${name}(`);
  const end = nextName ? index.indexOf(`function ${nextName}(`, start + 1) : -1;
  return index.slice(start, end > start ? end : start + 12000);
}

const healthStart = index.indexOf('var SYSTEM_HEALTH_TABLE_CHECKS=[');
const healthEnd = index.indexOf('var SYSTEM_HEALTH_RPC_CHECKS=[', healthStart);
const health = index.slice(healthStart, healthEnd);
const notificationRow = (health.match(/\{[^{}]*table:'notifications'[^{}]*\}/) || [''])[0];
const attachmentRow = (health.match(/\{[^{}]*table:'file_attachments'[^{}]*\}/) || [''])[0];
const actorSnapshotRow = (health.match(/\{[^{}]*table:'approval_step_actor_snapshots'[^{}]*\}/) || [''])[0];

check('notifications probes canonical environment columns with a legacy fallback',
  /data_environment,tenant_id/.test(notificationRow)
    && /fallbackSelect:'id,type,title,read,request_id'/.test(notificationRow));
check('file attachment health uses storage_path and never the removed path column',
  /storage_path/.test(attachmentRow) && !/(^|,)path(,|')/.test(attachmentRow.replace(/storage_path/g, '')));
check('approval actor snapshot health uses raw_actor_user_id',
  /raw_actor_user_id/.test(actorSnapshotRow) && !/(^|,)raw_user_id(,|')/.test(actorSnapshotRow));

const canonicalDirectory = functionBlock('fetchCanonicalFinanceUsersDirectory', 'syncRemoteFinanceUsersDirectory');
check('canonical finance user directory is fully paginated with an exact-count consistency check',
  /count:'exact'/.test(canonicalDirectory)
    && /\.range\(from,from\+pageSize-1\)/.test(canonicalDirectory)
    && /rows\.length!==expectedCount/.test(canonicalDirectory)
    && !/\.limit\(REMOTE_BOOTSTRAP_LIMITS\.users\)/.test(canonicalDirectory));

const submitStart = index.indexOf('window.submitNR=async function(){');
const submitEnd = index.indexOf('// ══ 放款申請 ══', submitStart);
const submit = index.slice(submitStart, submitEnd);
check('expense quick-submit synchronizes the canonical directory before applicant identity checks',
  submit.indexOf("guardSubmissionIdentityDirectory('費用申請')") > -1
    && submit.indexOf("guardSubmissionIdentityDirectory('費用申請')") < submit.indexOf('var appUser=currentNewReqApplicantUser();'));

const incomeAndShareholderGuards = [
  ['issueInvCore', '開立發票'],
  ['issueBatchCore', '批次開立發票'],
  ['submitBillCore', '申請繳費單'],
  ['submitShareholderApprovalRequest', '公司往來簽核單']
].every(([fn, label]) => new RegExp(`function ${fn}\\([^)]*\\)\\{[\\s\\S]{0,500}guardSubmissionIdentityDirectory\\('${label}'\\)`).test(index));
check('invoice, batch invoice, bill, and shareholder submissions use the same identity gate', incomeAndShareholderGuards);

const prepare = functionBlock('prepareApprovalRouteForSubmit', 'approvalRuntimeSourceTableForRecord');
check('route preparation waits for the canonical directory and rebuilds stale bootstrap steps',
  prepare.indexOf('ensureSubmissionIdentityDirectoryReady') > -1
    && prepare.indexOf('ensureSubmissionIdentityDirectoryReady') < prepare.indexOf('var validation=')
    && prepare.indexOf('rebuildApprovalRouteStepsFromCanonicalDirectory') < prepare.indexOf('var validation='));

const preflight = functionBlock('p1SubmissionPreflight', 'reportHealthIntroHtml');
const productionGate = preflight.indexOf('var directoryReady=await ensureSubmissionIdentityDirectoryReady(label);');
const productionRouteCheck = preflight.indexOf('rows=rows.concat(p1RouteChecks(label,opts.steps||[]));', productionGate);
check('production preflight cannot judge route Auth before canonical sync completes',
  productionGate > -1 && productionRouteCheck > productionGate);

const realtime = functionBlock('startRealtime', 'stopRealtime');
check('a live finance_users change invalidates the verified directory before refreshing',
  realtime.indexOf("if(table==='finance_users')") > -1
    && realtime.indexOf('invalidateFinanceUsersDirectoryReadiness') > realtime.indexOf("if(table==='finance_users')")
    && realtime.indexOf('invalidateFinanceUsersDirectoryReadiness') < realtime.indexOf('refreshRemoteData(table)'));

const formalWrite = functionBlock('insertMembershipOrgSubmittedRecord', 'insertMembershipOrgSubmittedBatch');
const formalBatchWrite = functionBlock('insertMembershipOrgSubmittedBatch', 'membershipOrgHeadForUnit');
check('formal writes fail closed instead of falling back to direct table inserts',
  /正式組織與交易式送單尚未載入/.test(formalWrite)
    && !/settingsInsert=await dbInsert/.test(formalWrite)
    && /正式組織與交易式批次送單尚未載入/.test(formalBatchWrite)
    && !/settingsWrites=await Promise\.all\(rows\.map\(function\(row\)\{return dbInsert/.test(formalBatchWrite));

const applicant = {
  id: 'u8', n: '朱夏欣', email: 'generalaffairs@suiyuecare.com', role: 'general_affairs',
  active: true, authUserId: 'auth-general-affairs'
};
const canonicalActors = [
  applicant,
  { id: 'u3', n: '部門主管', email: 'manager@suiyuecare.com', role: 'dept_manager', active: true, authUserId: 'auth-manager' },
  { id: 'u5', n: '劉巧涵', email: 'admin@suiyuecare.com', role: 'admin_director', active: true, authUserId: 'auth-director' },
  { id: 'u6', n: '會計', email: 'suiyue.acct@suiyuecare.com', role: 'accountant', active: true, authUserId: 'auth-accountant' },
  { id: 'u_entrepreneur', n: '執行長', email: 'entrepreneur@suiyuecare.com', role: 'ceo', active: true, authUserId: 'auth-ceo' }
];
const bootstrapActors = canonicalActors.map((user) => ({ ...user, authUserId: '' }));
const sandbox = {
  S: { user: { ...applicant } },
  USERS: bootstrapActors,
  financeUsersDirectoryPromise: null,
  financeUsersDirectoryPromiseAuthUserId: '',
  financeUsersDirectoryPromiseRevision: -1,
  financeUsersDirectoryRevision: 0,
  financeUsersDirectoryAuthUserId: '',
  financeUsersDirectoryReadyAt: '',
  financeUsersDirectoryLastError: '',
  FINANCE_USER_SAFE_COLUMNS: 'id,name,email,role,department_code,active,auth_user_id',
  REMOTE_BOOTSTRAP_LIMITS: { users: 500 },
  hasSupabase() { return true; },
  getSb() {
    return {
      from() {
        const builder = {
          select() { return builder; },
          order() { return builder; },
          limit() { return builder; },
          range() { return builder; },
          then(resolve) { return Promise.resolve({ data: canonicalActors, error: null, count: canonicalActors.length }).then(resolve); }
        };
        return builder;
      }
    };
  },
  withOperationTimeout(promise) { return Promise.resolve(promise); },
  mapUser(user) { return { ...user }; },
  setSubmissionIdentitySyncing() {},
  userById(id) { return sandbox.USERS.find((user) => user.id === id) || null; },
  stepTitle(step) { return step.r || step.rk || ''; },
  console,
  Promise,
  Date
};
vm.createContext(sandbox);
[
  'currentFinanceAuthUserId',
  'financeUsersDirectoryReadyForCurrentAuth',
  'fetchCanonicalFinanceUsersDirectory',
  'syncRemoteFinanceUsersDirectory',
  'stepActorProblem',
  'stepActorProblemSeverity',
  'p1RouteChecks'
].forEach((name) => vm.runInContext(extractNamedFunction(index, name), sandbox));

const fourRoleSteps = [
  { rk: 'applicant_submit', uid: applicant.id, r: '申請人送件' },
  { rk: 'dept_manager', uid: 'u3', r: '部門主管' },
  { rk: 'admin_director', uid: 'u5', r: '行政部門主任' },
  { rk: 'accountant', uid: 'u6', r: '會計' },
  { rk: 'ceo', uid: 'u_entrepreneur', r: '執行長' }
];

(async () => {
  const bootstrapRows = sandbox.p1RouteChecks('費用申請', fourRoleSteps);
  check('an unverified embedded bootstrap directory cannot create a blocking missing-Auth result',
    bootstrapRows.filter((row) => row.status === 'warn').length === 4
      && !bootstrapRows.some((row) => row.status === 'fail'));

  await sandbox.syncRemoteFinanceUsersDirectory();
  const canonicalRows = sandbox.p1RouteChecks('費用申請', fourRoleSteps);
  check('朱夏欣 quick-submit with four DB-bound actors is not falsely blocked',
    sandbox.financeUsersDirectoryReadyForCurrentAuth() === true
      && canonicalRows.length === 1
      && canonicalRows[0].status === 'ok');

  sandbox.USERS = sandbox.USERS.map((user) => user.id === 'u6' ? { ...user, authUserId: '' } : user);
  const trulyUnboundRows = sandbox.p1RouteChecks('費用申請', fourRoleSteps);
  check('a genuinely unbound actor from the canonical directory fails preflight',
    trulyUnboundRows.some((row) => row.status === 'fail' && /簽核人未綁 Auth/.test(row.detail)));

  if (passed !== checks.length) {
    process.stderr.write(`\n${passed}/${checks.length} checks passed\n`);
    process.exit(1);
  }
  process.stdout.write(`\n${passed}/${checks.length} checks passed\n`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
