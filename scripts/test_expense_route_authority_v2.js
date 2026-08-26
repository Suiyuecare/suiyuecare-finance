#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const deployedV1Path = path.join(root, 'supabase/migrations/20260821170000_membership_org_expense_submission_v1.sql');
const v2Path = path.join(root, 'supabase/migrations/20260826155840_expense_route_authority_v2.sql');
const v1 = fs.readFileSync(deployedV1Path, 'utf8');
const sql = fs.readFileSync(v2Path, 'utf8');
let passed = 0;
let failed = 0;

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function check(name, predicate) {
  const ok = Boolean(predicate);
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'} ${name}\n`);
  if (ok) passed += 1;
  else failed += 1;
}

const SELF_PENDING_ALLOWED = new Set([
  'accountant_final', 'accountant_invoice',
  'procurement_payment', 'procurement_receipt',
  'applicant_confirm', 'applicant_invoice_delivery',
  'cashier',
]);
const SELF_SKIP_NAME = '系統自動跳關';
const SELF_SKIP_COMMENT = '系統依正式角色解析結果自動跳過：此關簽核人與申請人相同。';

// Small executable model of the security invariant. Actor requests may describe
// a pending step, but only the canonical resolver result can authorize its UID.
function validateRoute({ expected, actual, actorRequests, readyUsers, allowHistory, applicantId = 'applicant-a' }) {
  if (!expected.length || expected.length !== actual.length) return false;
  for (let index = 0; index < expected.length; index += 1) {
    const canonical = expected[index];
    const submitted = actual[index];
    if (!canonical.uid || canonical.key !== submitted.key || canonical.uid !== submitted.uid) return false;
    if (!readyUsers.has(canonical.uid)) return false;
    const canonicalSelfSkip = canonical.uid === applicantId && !SELF_PENDING_ALLOWED.has(canonical.key);
    if (canonicalSelfSkip
      && (submitted.action !== 'approved'
        || submitted.autoSkip !== true
        || submitted.autoSkipReason !== 'canonical_actor_is_applicant'
        || submitted.name !== SELF_SKIP_NAME
        || submitted.comment !== SELF_SKIP_COMMENT)) return false;
    if (!canonicalSelfSkip && submitted.autoSkipReason === 'canonical_actor_is_applicant') return false;
    if (!allowHistory && submitted.action && !canonicalSelfSkip
      && !(canonical.key === 'dept_manager' && submitted.autoSkip)) return false;
    if (!submitted.action) {
      const requests = actorRequests.filter((request) => request.step_key === canonical.key);
      if (requests.length !== 1) return false;
      if (requests[0].finance_user_id && requests[0].finance_user_id !== canonical.uid) return false;
    }
  }
  return actorRequests.every((request) => actual.some((step) => !step.action && step.key === request.step_key));
}

function isExactResubmitTransition(oldSteps, newSteps, activeIndex) {
  if (oldSteps.length !== newSteps.length) return false;
  return oldSteps.every((oldStep, index) => {
    if (index !== activeIndex) return JSON.stringify(oldStep) === JSON.stringify(newSteps[index]);
    const expected = { ...oldStep, action: 'approved' };
    return JSON.stringify(expected) === JSON.stringify(newSteps[index]);
  });
}

const canonical = [
  { key: 'direct_supervisor', uid: 'supervisor-dept-a' },
  { key: 'dept_manager', uid: 'manager-dept-a' },
  { key: 'accountant', uid: 'accountant-global' },
  { key: 'ceo', uid: 'ceo-global' },
];
const requests = canonical.map(({ key }) => ({ step_key: key }));
const ready = new Set(canonical.map(({ uid }) => uid));

check('already-published v1 migration remains byte-for-byte at the audited baseline',
  sha256(v1) === 'eb0cc4ec6cc2515e77224604ebd07f42da2e774b01c39497fc012f5f4e502431');
check('v2 preserves both public PostgREST signatures',
  /create function public\.finance_submit_expense_request\([\s\S]*?p_actor_requests jsonb default '\[\]'::jsonb[\s\S]*?\) returns jsonb/.test(sql)
    && /create function public\.finance_resubmit_expense_request\([\s\S]*?p_actor_requests jsonb default '\[\]'::jsonb[\s\S]*?\) returns jsonb/.test(sql));
check('v2 bounds production locks and execution time',
  /set local lock_timeout = '5s';\s*set local statement_timeout = '120s';/.test(sql)
    && !/^\s*(?:begin|commit|rollback)(?:\s+(?:work|transaction))?\s*;\s*$/im.test(sql)
    && !/^\s*(?:(?:create(?:\s+unique)?\s+index|drop\s+index)\s+concurrently\b|reindex\b[^;]*\bconcurrently\b|vacuum\b|alter\s+system\b|cluster\b)/im.test(sql));
check('v2 retains the exact generated read-only attachment compatibility alias',
  /attribute_row\.attname = 'path'[\s\S]*attribute_row\.attgenerated = 's'[\s\S]*pg_catalog\.pg_get_expr\(default_row\.adbin, default_row\.adrelid\) = 'storage_path'/.test(sql)
    && /attachment compatibility postflight failed: storage_path and its generated read-only path alias must remain canonical/.test(sql)
    && !/alter table public\.file_attachments drop column path;/.test(sql));
check('v2 derives each assignee from the database resolver and compares the submitted UID',
  /public\.finance_org_resolve_actor\(v_kind, p_applicant_finance_user_id, p_department_code, v_role_key, null\)/.test(sql)
    && /v_actual_uid is distinct from v_expected_uid/.test(sql));
check('top-level missing-superior fallback is restricted to a formal CEO in the same department',
  /v_key in \('direct_supervisor','dept_manager'\)[\s\S]*role_row\.department_code = p_department_code[\s\S]*role_row\.role_key = 'ceo'[\s\S]*v_kind := 'top_level_self'/.test(sql));
check('published organization, workflow template, and routing policy are locked as authority',
  /finance_membership_org_versions_v1[\s\S]*status = 'published'[\s\S]*effective_at is null[\s\S]*for share/.test(sql)
    && /key = 'workflow_templates'[\s\S]*for share/.test(sql)
    && /key = 'approval_routing_policy'[\s\S]*for share/.test(sql));
check('actor requests are checked only after the canonical assignee is resolved',
  sql.indexOf('v_resolution := public.finance_org_resolve_actor') < sql.indexOf("v_actor_request ->> 'finance_user_id'"));
check('unsafe v1 implementations are private and not executable by API roles',
  /set schema private/.test(sql)
    && /rename to finance_submit_expense_request_v1_unsafe/.test(sql)
    && /rename to finance_resubmit_expense_request_v1_unsafe/.test(sql)
    && /revoke all on function private\.finance_submit_expense_request_v1_unsafe[\s\S]*authenticated, service_role/.test(sql));
check('correct canonical submit route succeeds', validateRoute({
  expected: canonical, actual: canonical, actorRequests: requests, readyUsers: ready, allowHistory: false,
}));
check('an arbitrary active UID cannot replace the canonical supervisor', !validateRoute({
  expected: canonical,
  actual: [{ key: 'direct_supervisor', uid: 'unrelated-active-user' }, ...canonical.slice(1)],
  actorRequests: requests,
  readyUsers: new Set([...ready, 'unrelated-active-user']),
  allowHistory: false,
}));
check('an active manager from another department cannot replace the canonical manager', !validateRoute({
  expected: canonical,
  actual: [canonical[0], { key: 'dept_manager', uid: 'manager-dept-b' }, ...canonical.slice(2)],
  actorRequests: requests,
  readyUsers: new Set([...ready, 'manager-dept-b']),
  allowHistory: false,
}));
check('a missing canonical role fails closed', !validateRoute({
  expected: canonical.map((step) => step.key === 'accountant' ? { ...step, uid: null } : step),
  actual: canonical,
  actorRequests: requests,
  readyUsers: ready,
  allowHistory: false,
}));
check('an actor request cannot override the canonical UID', !validateRoute({
  expected: canonical,
  actual: canonical,
  actorRequests: requests.map((request) => request.step_key === 'ceo'
    ? { ...request, finance_user_id: 'unrelated-active-user' }
    : request),
  readyUsers: new Set([...ready, 'unrelated-active-user']),
  allowHistory: false,
}));
check('a canonical self-review must be an exact audited auto-skip', validateRoute({
  expected: [
    { key: 'admin_director', uid: 'u5' },
    { key: 'accountant', uid: 'u6' },
    { key: 'applicant_confirm', uid: 'u5' },
  ],
  actual: [
    { key: 'admin_director', uid: 'u5', action: 'approved', autoSkip: true, autoSkipReason: 'canonical_actor_is_applicant', name: SELF_SKIP_NAME, comment: SELF_SKIP_COMMENT },
    { key: 'accountant', uid: 'u6' },
    { key: 'applicant_confirm', uid: 'u5' },
  ],
  actorRequests: [{ step_key: 'accountant' }, { step_key: 'applicant_confirm' }],
  readyUsers: new Set(['u5', 'u6']),
  allowHistory: false,
  applicantId: 'u5',
}));
check('Liu admin persona cannot remain pending at her own admin review', !validateRoute({
  expected: [{ key: 'admin_director', uid: 'u5' }, { key: 'accountant', uid: 'u6' }],
  actual: [{ key: 'admin_director', uid: 'u5' }, { key: 'accountant', uid: 'u6' }],
  actorRequests: [{ step_key: 'admin_director' }, { step_key: 'accountant' }],
  readyUsers: new Set(['u5', 'u6']),
  allowHistory: false,
  applicantId: 'u5',
}));
check('self-review auto-skip requires the exact audit name and comment', !validateRoute({
  expected: [{ key: 'admin_director', uid: 'u5' }],
  actual: [{
    key: 'admin_director', uid: 'u5', action: 'approved', autoSkip: true,
    autoSkipReason: 'canonical_actor_is_applicant', name: SELF_SKIP_NAME, comment: 'client supplied text',
  }],
  actorRequests: [],
  readyUsers: new Set(['u5']),
  allowHistory: false,
  applicantId: 'u5',
}));
check('Liu admin persona cannot delete her required review step', !validateRoute({
  expected: [{ key: 'admin_director', uid: 'u5' }, { key: 'accountant', uid: 'u6' }],
  actual: [{ key: 'accountant', uid: 'u6' }],
  actorRequests: [{ step_key: 'accountant' }],
  readyUsers: new Set(['u5', 'u6']),
  allowHistory: false,
  applicantId: 'u5',
}));
check('accountant persona auto-skips accountant review but retains final accounting work', validateRoute({
  expected: [{ key: 'accountant', uid: 'u6' }, { key: 'accountant_final', uid: 'u6' }],
  actual: [
    { key: 'accountant', uid: 'u6', action: 'approved', autoSkip: true, autoSkipReason: 'canonical_actor_is_applicant', name: SELF_SKIP_NAME, comment: SELF_SKIP_COMMENT },
    { key: 'accountant_final', uid: 'u6' },
  ],
  actorRequests: [{ step_key: 'accountant_final' }],
  readyUsers: new Set(['u6']),
  allowHistory: false,
  applicantId: 'u6',
}));
check('CEO persona audits missing-superior and CEO self reviews but retains operational tasks', validateRoute({
  expected: [
    { key: 'direct_supervisor', uid: 'u_entrepreneur' },
    { key: 'dept_manager', uid: 'u_entrepreneur' },
    { key: 'ceo', uid: 'u_entrepreneur' },
    { key: 'cashier', uid: 'u8' },
    { key: 'applicant_confirm', uid: 'u_entrepreneur' },
  ],
  actual: [
    { key: 'direct_supervisor', uid: 'u_entrepreneur', action: 'approved', autoSkip: true, autoSkipReason: 'canonical_actor_is_applicant', name: SELF_SKIP_NAME, comment: SELF_SKIP_COMMENT },
    { key: 'dept_manager', uid: 'u_entrepreneur', action: 'approved', autoSkip: true, autoSkipReason: 'canonical_actor_is_applicant', name: SELF_SKIP_NAME, comment: SELF_SKIP_COMMENT },
    { key: 'ceo', uid: 'u_entrepreneur', action: 'approved', autoSkip: true, autoSkipReason: 'canonical_actor_is_applicant', name: SELF_SKIP_NAME, comment: SELF_SKIP_COMMENT },
    { key: 'cashier', uid: 'u8' },
    { key: 'applicant_confirm', uid: 'u_entrepreneur' },
  ],
  actorRequests: [{ step_key: 'cashier' }, { step_key: 'applicant_confirm' }],
  readyUsers: new Set(['u_entrepreneur', 'u8']),
  allowHistory: false,
  applicantId: 'u_entrepreneur',
}));
check('a non-self actor cannot forge the canonical self-skip audit reason', !validateRoute({
  expected: [{ key: 'admin_director', uid: 'u5' }],
  actual: [{ key: 'admin_director', uid: 'u5', action: 'approved', autoSkip: true, autoSkipReason: 'canonical_actor_is_applicant' }],
  actorRequests: [],
  readyUsers: new Set(['u5']),
  allowHistory: false,
  applicantId: 'applicant-a',
}));
check('correct canonical resubmit route succeeds with history allowed', validateRoute({
  expected: canonical,
  actual: canonical.map((step, index) => index === 0 ? { ...step, action: 'approved' } : step),
  actorRequests: requests.slice(1),
  readyUsers: ready,
  allowHistory: true,
}));
const previousResubmitSteps = [
  { key: 'direct_supervisor', uid: 'supervisor-dept-a', action: 'approved' },
  { key: 'applicant_revision', uid: 'applicant-a', action: '' },
  { key: 'accountant', uid: 'accountant-global', action: '' },
];
check('resubmit wrapper enforces the database exact-transition guard before routing',
  /finance_expense_is_exact_step_transition\([\s\S]*?v_expense\.steps, p_form_state -> 'steps'/.test(sql));
check('resubmit cannot inject an assigned-user step', !isExactResubmitTransition(
  previousResubmitSteps,
  [
    previousResubmitSteps[0],
    { ...previousResubmitSteps[1], action: 'approved' },
    { key: 'assigned_user', uid: 'unrelated-active-user', action: '' },
    previousResubmitSteps[2],
  ],
  1,
));
check('resubmit cannot tamper with a later pending assignee', !validateRoute({
  expected: canonical,
  actual: canonical.map((step, index) => index === 0
    ? { ...step, action: 'approved' }
    : index === 1 ? { ...step, uid: 'manager-dept-b' } : step),
  actorRequests: requests.slice(1),
  readyUsers: new Set([...ready, 'manager-dept-b']),
  allowHistory: true,
}));

process.stdout.write(`\nExpense route authority v2: ${passed}/${passed + failed} passed.\n`);
if (failed) process.exit(1);
