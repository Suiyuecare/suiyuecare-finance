#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const deployedV1Path = path.join(root, 'supabase/migrations/20260821170000_membership_org_expense_submission_v1.sql');
const v2Path = path.join(root, 'supabase/migrations/20260826155840_expense_route_authority_v2.sql');
const v3Path = path.join(root, 'supabase/migrations/20260827052447_expense_route_authority_v3.sql');
const v1 = fs.readFileSync(deployedV1Path, 'utf8');
const sql = fs.readFileSync(v2Path, 'utf8');
const v3 = fs.readFileSync(v3Path, 'utf8');
const dbPostflight = fs.readFileSync(
  path.join(root, 'scripts/finance_production_db_postflight.sql'),
  'utf8',
);
const dbPreflight = fs.readFileSync(
  path.join(root, 'scripts/finance_production_db_preflight.sql'),
  'utf8',
);
const staleAttemptBranch = v3.match(/if v_attempt_id is null then([\s\S]*?)end if;/)?.[1] || '';
const futureRouteGuard = v3.match(/create function private\.finance_expense_assert_applicant_revision_future_route_v3\([\s\S]*?\$function\$;/)?.[0] || '';
const managerAutoSkipGuard = v3.match(/create function private\.finance_expense_assert_dept_manager_autoskip_v3\([\s\S]*?\$function\$;/)?.[0] || '';
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
const SAME_MANAGER_SKIP_COMMENT = '申請人上一層級主管與申請人部門主任為同一位；前一關簽核通過時，系統會同步通過本關並直接送往下一關。';
const SAME_MANAGER_SKIP_LEGACY_COMMENT = '申請人上一層級主管與部門主管為同一位；前一關簽核通過時，系統會同步通過本關並直接送往下一關。';
const SAME_MANAGER_SKIP_RUNTIME_COMMENT = '申請人上一層級主管與申請人部門主任為同一位；前一關已核准，系統自動同步通過本關。';

function validHistoryTime(value) {
  return typeof value === 'string' && value.length > 0 && !Number.isNaN(Date.parse(value));
}

function validateManagerAutoSkip({ applicantId, directSupervisorId, managerId, submitted, allowHistory = false }) {
  if (!managerId || submitted.uid !== managerId || submitted.action !== 'approved'
      || submitted.autoSkip !== true || submitted.name !== SELF_SKIP_NAME
      || typeof submitted.time !== 'string') return false;
  if (managerId === applicantId) {
    return submitted.autoSkipReason === 'canonical_actor_is_applicant'
      && submitted.comment === SELF_SKIP_COMMENT
      && submitted.time === '';
  }
  if (directSupervisorId !== managerId) return false;
  if (!allowHistory) {
    return submitted.autoSkipReason === 'same_direct_supervisor_and_dept_manager'
      && submitted.comment === SAME_MANAGER_SKIP_COMMENT
      && submitted.time === '';
  }
  const initialHistory = submitted.autoSkipReason === 'same_direct_supervisor_and_dept_manager'
    && [SAME_MANAGER_SKIP_COMMENT, SAME_MANAGER_SKIP_LEGACY_COMMENT].includes(submitted.comment)
    && (submitted.time === '' || validHistoryTime(submitted.time));
  const runtimeHistory = submitted.autoSkipReason === 'same_direct_supervisor_and_dept_manager_runtime'
    && submitted.comment === SAME_MANAGER_SKIP_RUNTIME_COMMENT
    && validHistoryTime(submitted.time);
  return initialHistory || runtimeHistory;
}

function validateFocusedManagerGuard({ applicantId, steps, canonicalDirectId, canonicalManagerId, allowHistory = false }) {
  const managers = steps.filter((step) => step.key === 'dept_manager');
  if (managers.length === 0) return true;
  if (managers.length !== 1) return false;
  const manager = managers[0];
  const residue = Boolean(manager.autoSkipReason || manager.autoSkipAudit || manager.auto_skip_audit
    || manager.name === SELF_SKIP_NAME
    || [SELF_SKIP_COMMENT, SAME_MANAGER_SKIP_COMMENT, SAME_MANAGER_SKIP_LEGACY_COMMENT,
      SAME_MANAGER_SKIP_RUNTIME_COMMENT].includes(manager.comment));
  if (manager.autoSkip !== true) return !residue;
  const supervisors = steps.filter((step) => step.key === 'direct_supervisor');
  if (supervisors.length !== 1 || supervisors[0].uid !== canonicalDirectId) return false;
  return validateManagerAutoSkip({
    applicantId,
    directSupervisorId: canonicalDirectId,
    managerId: canonicalManagerId,
    submitted: manager,
    allowHistory,
  });
}

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

function validateApplicantRevisionFutureRoute({ expected, steps, activeIndex, readyUsers }) {
  const active = steps[activeIndex];
  if (!active || active.key !== 'applicant_revision' || active.action !== '') return false;
  let cursor = 0;
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    if (step.key === 'assigned_user') {
      if (index < activeIndex && !step.action) return false;
      if (index > activeIndex && (step.action || step.autoSkip || step.autoSkipReason
        || step.autoSkipAudit || step.auto_skip_audit || !readyUsers.has(step.uid))) return false;
      continue;
    }
    if (step.key === 'applicant_submit' || step.key === 'applicant_revision') {
      if (index > activeIndex || (index < activeIndex && !step.action)) return false;
      continue;
    }
    if (index < activeIndex) {
      if (!step.action) return false;
      const matches = expected
        .map((candidate, candidateIndex) => candidate.key === step.key ? candidateIndex : -1)
        .filter((candidateIndex) => candidateIndex >= 0);
      if (matches.length > 1) return false;
      if (matches.length === 1) cursor = Math.max(cursor, matches[0] + 1);
      continue;
    }
    if (index === activeIndex || cursor >= expected.length) return false;
    const canonical = expected[cursor];
    if (canonical.key !== step.key || canonical.uid !== step.uid
      || !readyUsers.has(canonical.uid) || step.action || step.autoSkip
      || step.autoSkipReason || step.autoSkipAudit || step.auto_skip_audit) return false;
    cursor += 1;
  }
  return cursor === expected.length;
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
check('v3 is a separate forward-only migration with bounded execution',
  /set local lock_timeout = '5s';\s*set local statement_timeout = '120s';/.test(v3)
    && !/^\s*(?:begin|commit|rollback)(?:\s+(?:work|transaction))?\s*;\s*$/im.test(v3)
    && /finance_expense_assert_authoritative_route_v3/.test(v3));
check('v3 narrowly repairs the service-only notification claim worker without exposing its private table',
  v3.includes('5f70ec460e9dcc611419097e28084d1916b0ca2bf908e25d35a4aa55d8f437a0')
    && v3.includes('718831e956151360ff813565c91808c4390b160c83bd72554de71ad8259e5d06')
    && /alter function public\.claim_approval_notification_delivery_events\([\s\S]*?\) security definer;/.test(v3)
    && /alter function public\.claim_approval_notification_delivery_events\([\s\S]*?\) set search_path = '';/m.test(v3)
    && /revoke all on function public\.claim_approval_notification_delivery_events\([\s\S]*?\) from public, anon, authenticated;/.test(v3)
    && /grant execute on function public\.claim_approval_notification_delivery_events\([\s\S]*?\) to postgres, service_role;/.test(v3)
    && v3.includes("proc_row.proacl::text =\n           '{postgres=X/postgres,service_role=X/postgres}'")
    && v3.includes("relation_row.relacl::text =\n           '{postgres=arwdDxtm/postgres}'")
    && v3.includes("using errcode = 'ZX001'")
    && !/grant\s+(?:select|all)[\s\S]*?on\s+(?:table\s+)?private\.approval_notification_assignment_state[\s\S]*?to\s+service_role/i.test(v3));
check('v3 independently re-resolves direct supervisor and a unique department manager for an auto-skip',
  /finance_org_resolve_actor\(\s*'direct_supervisor',\s*p_applicant_finance_user_id,\s*p_department_code,\s*'direct_supervisor'/.test(v3)
    && /finance_org_resolve_actor\(\s*'dept_manager',\s*p_applicant_finance_user_id,\s*p_department_code,\s*'dept_manager'/.test(v3)
    && /jsonb_array_length\([\s\S]*?v_manager_resolution -> 'candidates'[\s\S]*?\) = 1/.test(v3)
    && /v_submitted_direct_uid is distinct from v_direct_uid/.test(v3)
    && /v_submitted_manager_uid is distinct from v_manager_uid/.test(v3)
    && !/v_route -> 'actor_snapshots'/.test(v3));
check('v3 manager semantic release gates tolerate formatted resolver calls without weakening role literals',
  /finance_org_resolve_actor\(\s*'direct_supervisor'/i.test(managerAutoSkipGuard)
    && /finance_org_resolve_actor\(\s*'dept_manager'/i.test(managerAutoSkipGuard)
    && !/finance_org_resolve_actor\(\s*'direct_supervisor'/i.test(
      managerAutoSkipGuard.replace(
        /(finance_org_resolve_actor\(\s*)'direct_supervisor'/i,
        "$1'forged_supervisor'",
      ),
    )
    && !/finance_org_resolve_actor\(\s*'dept_manager'/i.test(
      managerAutoSkipGuard.replace(
        /(finance_org_resolve_actor\(\s*)'dept_manager'/i,
        "$1'forged_manager'",
      ),
    )
    && [v3, dbPreflight, dbPostflight].every((body) => (
      body.includes("v_definition !~* $resolver$finance_org_resolve_actor\\(\\s*'direct_supervisor'$resolver$")
      && body.includes("v_definition !~* $resolver$finance_org_resolve_actor\\(\\s*'dept_manager'$resolver$")
      && !body.includes("finance_org_resolve_actor(''direct_supervisor''")
      && !body.includes("finance_org_resolve_actor(''dept_manager''")
    )));
check('v3 focused guard is a no-op for a valid shareholder route without a manager stage',
  /if v_manager_count = 0 then[\s\S]*?'dept_manager_step_present', false[\s\S]*?'auto_skip_validated', false/.test(v3)
    && v3.indexOf('if v_manager_count = 0 then') < v3.indexOf('into v_direct_count, v_direct_actual')
    && validateFocusedManagerGuard({
      applicantId: 'shareholder-applicant',
      canonicalDirectId: null,
      canonicalManagerId: null,
      steps: [
        { key: 'admin_director', uid: 'u5' },
        { key: 'accountant', uid: 'u6' },
        { key: 'ceo', uid: 'u_entrepreneur' },
      ],
    }));
check('v3 always re-resolves a department-manager auto-skip for the exact department',
  /finance_org_resolve_actor\(\s*'dept_manager',\s*p_applicant_finance_user_id,\s*p_department_code,\s*'dept_manager'/.test(v3)
    && /role_row\.department_code = p_department_code/.test(v3)
    && /v_submitted_manager_uid is distinct from v_manager_uid/.test(v3));
check('v3 accepts only reviewed fresh and history manager auto-skip audit contracts',
  v3.includes('canonical_actor_is_applicant')
    && v3.includes('same_direct_supervisor_and_dept_manager')
    && v3.includes('same_direct_supervisor_and_dept_manager_runtime')
    && v3.includes(SELF_SKIP_COMMENT)
    && v3.includes(SAME_MANAGER_SKIP_COMMENT)
    && v3.includes(SAME_MANAGER_SKIP_LEGACY_COMMENT)
    && v3.includes(SAME_MANAGER_SKIP_RUNTIME_COMMENT)
    && /v_direct_uid = v_manager_uid/.test(v3));
check('v3 public submit wrapper rejects stale tabs and supports exact replay only with a stable attempt',
  /submissionAttemptId/.test(v3)
    && /submission_attempt_id/.test(v3)
    && /finance_expense_submission_payload_sha256_v3/.test(v3)
    && /finance_expense_idempotent_replay_result_v3/.test(v3)
    && staleAttemptBranch.includes('頁面版本已過期，請重新整理後再送出')
    && staleAttemptBranch.includes("errcode = '55000'")
    && !staleAttemptBranch.includes('finance_submit_expense_request_v1_unsafe')
    && !staleAttemptBranch.includes('return')
    && /exception when unique_violation/.test(v3)
    && /v_existing_payload_sha256 = v_payload_sha256/.test(v3));
check('v3 preserves replay metadata through applicant resubmission',
  /v_expense\.form_payload \? '_submissionPayloadSha256V3'/.test(v3)
    && /jsonb_set\(p_form_state, '\{form_payload\}', v_payload, true\)/.test(v3));
check('v3 guards the actual ten-argument applicant-revision RPC without copying its business implementation',
  /alter function public\.finance_expense_resubmit_applicant_revision\([\s\S]*?set schema private/.test(v3)
    && /rename to finance_expense_resubmit_applicant_revision_v1_unsafe/.test(v3)
    && /create function public\.finance_expense_resubmit_applicant_revision\([\s\S]*?p_form_patch jsonb default '\{\}'::jsonb[\s\S]*?p_step_files jsonb default '\[\]'::jsonb/.test(v3)
    && /private\.finance_expense_assert_applicant_revision_future_route_v3/.test(v3)
    && /return private\.finance_expense_resubmit_applicant_revision_v1_unsafe/.test(v3));
check('v3 applicant-revision guard resolves only future actors and pins fixed users to template actor_ref',
  /v_actual_index < p_active_index[\s\S]*?historical_prefix_preserved/.test(v3)
    && /v_expected_step ->> 'actorRef'[\s\S]*?v_expected_step ->> 'actor_ref'/.test(v3)
    && /case when v_kind = 'fixed_user' then v_actor_ref else null end/.test(v3)
    && /v_actual_uid is distinct from v_expected_uid/.test(v3));
check('v3 preserves completed history and anchors only the current future suffix',
  futureRouteGuard.includes('into v_historical_key_count, v_historical_anchor_index')
    && futureRouteGuard.includes('v_expected_index := greatest(')
    && !futureRouteGuard.includes('pg_catalog.greatest(')
    && futureRouteGuard.includes('v_historical_anchor_index + 1')
    && futureRouteGuard.indexOf('if v_actual_index < p_active_index then')
      < futureRouteGuard.indexOf('if v_expected_index >= pg_catalog.jsonb_array_length(v_expected_steps)')
    && validateApplicantRevisionFutureRoute({
      expected: [
        { key: 'direct_supervisor', uid: 'new-direct' },
        { key: 'dept_manager', uid: 'new-manager' },
        { key: 'accountant', uid: 'current-accountant' },
        { key: 'cashier', uid: 'current-cashier' },
      ],
      steps: [
        { key: 'direct_supervisor', uid: 'historical-direct', action: 'approved' },
        { key: 'dept_manager', uid: 'historical-manager', action: 'approved' },
        { key: 'admin_director', uid: 'historical-admin', action: 'approved' },
        { key: 'applicant_revision', uid: 'applicant-a', action: '' },
        { key: 'accountant', uid: 'current-accountant', action: '' },
        { key: 'cashier', uid: 'current-cashier', action: '' },
      ],
      activeIndex: 3,
      readyUsers: new Set(['current-accountant', 'current-cashier']),
    }));
check('v3 immutable-history model still rejects a forged future assignee',
  !validateApplicantRevisionFutureRoute({
    expected: [
      { key: 'direct_supervisor', uid: 'new-direct' },
      { key: 'dept_manager', uid: 'new-manager' },
      { key: 'accountant', uid: 'current-accountant' },
      { key: 'cashier', uid: 'current-cashier' },
    ],
    steps: [
      { key: 'direct_supervisor', uid: 'historical-direct', action: 'approved' },
      { key: 'dept_manager', uid: 'historical-manager', action: 'approved' },
      { key: 'applicant_revision', uid: 'applicant-a', action: '' },
      { key: 'accountant', uid: 'forged-accountant', action: '' },
      { key: 'cashier', uid: 'current-cashier', action: '' },
    ],
    activeIndex: 2,
    readyUsers: new Set(['current-accountant', 'current-cashier', 'forged-accountant']),
  }));
check('v3 immutable-history anchor never moves backward when the current template reordered completed roles',
  validateApplicantRevisionFutureRoute({
    expected: [
      { key: 'dept_manager', uid: 'new-manager' },
      { key: 'direct_supervisor', uid: 'new-direct' },
      { key: 'accountant', uid: 'current-accountant' },
    ],
    steps: [
      { key: 'direct_supervisor', uid: 'historical-direct', action: 'approved' },
      { key: 'dept_manager', uid: 'historical-manager', action: 'approved' },
      { key: 'applicant_revision', uid: 'applicant-a', action: '' },
      { key: 'accountant', uid: 'current-accountant', action: '' },
    ],
    activeIndex: 2,
    readyUsers: new Set(['current-accountant']),
  }));
check('v3 future pending and operational steps cannot retain any auto-skip residue',
  /補件後的 % 關卡殘留不一致的自動跳關稽核欄位/.test(v3)
    && /補件後的 % 自動跳關不得保持待簽狀態/.test(v3)
    && /補件後的作業關卡 % 必須由指定人實際處理，不得自動跳過/.test(v3)
    && /v_actual_step \? 'autoSkipAudit'/.test(v3)
    && /v_actual_step \? 'auto_skip_audit'/.test(v3));

check('canonical applicant manager self-skip succeeds only with exact audit data',
  validateManagerAutoSkip({
    applicantId: 'applicant-a', directSupervisorId: 'supervisor-a', managerId: 'applicant-a',
    submitted: { uid: 'applicant-a', action: 'approved', autoSkip: true,
      autoSkipReason: 'canonical_actor_is_applicant', name: SELF_SKIP_NAME,
      time: '', comment: SELF_SKIP_COMMENT },
  }));
check('manager role in another department cannot authorize applicant self-skip',
  !validateManagerAutoSkip({
    applicantId: 'applicant-a', directSupervisorId: 'supervisor-a', managerId: 'manager-dept-a',
    submitted: { uid: 'applicant-a', action: 'approved', autoSkip: true,
      autoSkipReason: 'canonical_actor_is_applicant', name: SELF_SKIP_NAME,
      time: '', comment: SELF_SKIP_COMMENT },
  }));
check('duplicate manager succeeds only when canonical direct supervisor and manager match',
  validateManagerAutoSkip({
    applicantId: 'applicant-a', directSupervisorId: 'manager-dept-a', managerId: 'manager-dept-a',
    submitted: { uid: 'manager-dept-a', action: 'approved', autoSkip: true,
      autoSkipReason: 'same_direct_supervisor_and_dept_manager', name: SELF_SKIP_NAME,
      time: '', comment: SAME_MANAGER_SKIP_COMMENT },
  })
    && !validateManagerAutoSkip({
      applicantId: 'applicant-a', directSupervisorId: 'supervisor-a', managerId: 'manager-dept-a',
      submitted: { uid: 'manager-dept-a', action: 'approved', autoSkip: true,
        autoSkipReason: 'same_direct_supervisor_and_dept_manager', name: SELF_SKIP_NAME,
        time: '', comment: SAME_MANAGER_SKIP_COMMENT },
    }));
check('duplicate manager rejects unreviewed client-authored audit text',
  !validateManagerAutoSkip({
    applicantId: 'applicant-a', directSupervisorId: 'manager-dept-a', managerId: 'manager-dept-a',
    submitted: { uid: 'manager-dept-a', action: 'approved', autoSkip: true,
      autoSkipReason: 'same_direct_supervisor_and_dept_manager', name: SELF_SKIP_NAME,
      time: '', comment: '系統自動跳過重複簽核。' },
  }));
check('active applicant-revision history accepts the exact legacy duplicate-manager marker',
  validateManagerAutoSkip({
    applicantId: 'applicant-a', directSupervisorId: 'manager-dept-a', managerId: 'manager-dept-a',
    allowHistory: true,
    submitted: { uid: 'manager-dept-a', action: 'approved', autoSkip: true,
      autoSkipReason: 'same_direct_supervisor_and_dept_manager', name: SELF_SKIP_NAME,
      time: '', comment: SAME_MANAGER_SKIP_LEGACY_COMMENT },
  })
    && !validateManagerAutoSkip({
      applicantId: 'applicant-a', directSupervisorId: 'manager-dept-a', managerId: 'manager-dept-a',
      allowHistory: false,
      submitted: { uid: 'manager-dept-a', action: 'approved', autoSkip: true,
        autoSkipReason: 'same_direct_supervisor_and_dept_manager', name: SELF_SKIP_NAME,
        time: '', comment: SAME_MANAGER_SKIP_LEGACY_COMMENT },
    }));
check('history accepts exact runtime synchronization only with a valid nonempty time',
  validateManagerAutoSkip({
    applicantId: 'applicant-a', directSupervisorId: 'manager-dept-a', managerId: 'manager-dept-a',
    allowHistory: true,
    submitted: { uid: 'manager-dept-a', action: 'approved', autoSkip: true,
      autoSkipReason: 'same_direct_supervisor_and_dept_manager_runtime', name: SELF_SKIP_NAME,
      time: '2026-08-27T01:02:03Z', comment: SAME_MANAGER_SKIP_RUNTIME_COMMENT },
  })
    && !validateManagerAutoSkip({
      applicantId: 'applicant-a', directSupervisorId: 'manager-dept-a', managerId: 'manager-dept-a',
      allowHistory: true,
      submitted: { uid: 'manager-dept-a', action: 'approved', autoSkip: true,
        autoSkipReason: 'same_direct_supervisor_and_dept_manager_runtime', name: SELF_SKIP_NAME,
        time: '', comment: SAME_MANAGER_SKIP_RUNTIME_COMMENT },
    }));
check('autoSkip=false cannot retain reason or audit residue',
  /not v_is_auto_skip and v_has_skip_residue/.test(v3)
    && /v_manager_actual \? 'autoSkipAudit'/.test(v3)
    && /v_manager_actual \? 'auto_skip_audit'/.test(v3)
    && !validateManagerAutoSkip({
      applicantId: 'applicant-a', directSupervisorId: 'manager-dept-a', managerId: 'manager-dept-a',
      allowHistory: true,
      submitted: { uid: 'manager-dept-a', action: 'approved', autoSkip: false,
        autoSkipReason: 'same_direct_supervisor_and_dept_manager', name: SELF_SKIP_NAME,
        time: '', comment: SAME_MANAGER_SKIP_COMMENT, autoSkipAudit: {} },
    }));
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
check('CEO cannot replace the canonical cashier u8', !validateRoute({
  expected: [{ key: 'ceo', uid: 'u_entrepreneur' }, { key: 'cashier', uid: 'u8' }],
  actual: [{ key: 'ceo', uid: 'u_entrepreneur' }, { key: 'cashier', uid: 'u_entrepreneur' }],
  actorRequests: [{ step_key: 'ceo' }, { step_key: 'cashier' }],
  readyUsers: new Set(['u_entrepreneur', 'u8']),
  allowHistory: false,
  applicantId: 'applicant-a',
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

process.stdout.write(`\nExpense route authority v2/v3: ${passed}/${passed + failed} passed.\n`);
if (failed) process.exit(1);
