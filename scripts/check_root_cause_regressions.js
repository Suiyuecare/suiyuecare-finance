#!/usr/bin/env node
'use strict';

/**
 * Source-level regressions for the recurring login/submission incident.
 * Runs before build so a known-bad source can never become a Vercel artifact.
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const index = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const membershipMigration = fs.readFileSync(
  path.join(ROOT, 'supabase/migrations/20260821170000_membership_org_expense_submission_v1.sql'),
  'utf8'
);
let passed = 0;
let failed = 0;

function check(label, condition, detail = '') {
  if (condition) {
    passed += 1;
    process.stdout.write(`PASS ${label}\n`);
  } else {
    failed += 1;
    process.stderr.write(`FAIL ${label}${detail ? `: ${detail}` : ''}\n`);
  }
}

function section(startMarker, endMarker) {
  const start = index.indexOf(startMarker);
  const end = index.indexOf(endMarker, start + startMarker.length);
  return start > -1 && end > start ? index.slice(start, end) : '';
}

const healthTables = section('var SYSTEM_HEALTH_TABLE_CHECKS=[', 'var SYSTEM_HEALTH_RPC_CHECKS=[');
const submissionTables = section('function p1TableChecksForSubmit', 'function p1AdvisoryRpcKey');
const actorSeverity = section('function stepActorProblemSeverity', 'function approvalHealthRecords');
const preflight = section('async function p1SubmissionPreflight', 'function reportHealthIntroHtml');
const operational = section('function p1OperationalDiagnosticRow', 'var SUBMISSION_PREFLIGHT_TIMEOUT_MS');
const guardedSubmit = section('async function insertMembershipOrgSubmittedRecord', 'async function insertMembershipOrgSubmittedBatch');

check('Finance user bootstrap reads auth_user_id from the database',
  /FINANCE_USER_SAFE_COLUMNS='[^']*auth_user_id/.test(index));
check('notification health has a legacy-column fallback during the migration window',
  /table:'notifications'[^\n]+fallbackSelect:'id,type,title,read,request_id'/.test(healthTables));
check('notification schema mismatch is a deterministic write blocker',
  /table:'notifications'[^\n]+submissionContractRequired:true/.test(healthTables)
    && /var forced=\{required:true\}/.test(submissionTables)
    && !/label===['"]通知資料表['"]&&\/data_environment\|schema\|grant\|column\//.test(operational)
    && /item&&item\.submissionContractRequired[\s\S]*?submissionAdvisory:false/.test(preflight));
check('attachment health uses storage_path and never the nonexistent path column',
  /table:'file_attachments'[^\n]+select:'[^']*storage_path/.test(healthTables)
    && !/table:'file_attachments'[^\n]+select:'[^']*(?:^|,)path(?:,|')/.test(healthTables));
check('attachment metadata diagnostics are advisory rather than a false send blocker',
  /k===['"]file_attachments['"]\?\{required:false/.test(submissionTables)
    && /附件歸檔 metadata/.test(operational));
check('a stale embedded Auth field is a warning, not a false route failure',
  /簽核人未綁 Auth[^\n]+return['"]warn['"]/.test(actorSeverity));
check('submission still requires a live authenticated session',
  preflight.includes('await ensureSupabaseWriteReady(label)')
    && preflight.includes("label:'正式登入檢查',status:'fail'"));
check('transient read-only health probes degrade to an advisory',
  preflight.includes('p1SubmissionAdvisoryItem')
    && preflight.includes('p1BlockingRows(rows)'));
check('expense submission uses the guarded database transaction',
  guardedSubmit.includes("expense:'finance_submit_expense_request'")
    && guardedSubmit.includes('p_actor_requests:engine.actorRequestsFromSteps(record.steps)')
    && !/dbInsert\(table,row\)/.test(guardedSubmit.slice(guardedSubmit.indexOf("var fn={expense:"))));
check('guarded transaction derives the authenticated Finance identity',
  /v_actor := public\.current_finance_user\(\)/.test(membershipMigration)
    && /finance_user_is_approval_identity_ready\(v_tenant_id, v_actor\.id\)/.test(membershipMigration));
check('guarded transaction rejects a genuinely unbound approval actor',
  /jsonb_array_elements\(v_request\.steps\)[\s\S]*?assignee\.id = workflow_step ->> 'uid'[\s\S]*?finance_user_is_approval_identity_ready\(v_tenant_id, assignee\.id\)/.test(membershipMigration)
    && /簽核流程仍有未綁定或無效的正式簽核人/.test(membershipMigration));
check('guarded transaction inserts the request exactly once',
  (membershipMigration.match(/insert into public\.expense_requests/g) || []).length === 1);
check('Google login can explicitly switch away from a stale browser account',
  index.includes('window.switchFinanceGoogleAccount=async function()')
    && index.includes("signOut({scope:'local'})")
    && index.includes("prompt:'select_account'"));
check('company login authority is taken from verified Google identity, not editable metadata',
  index.includes('function authUserHasVerifiedGoogleIdentity')
    && index.includes('function supabaseAuthUserPreferredEmail')
    && !section('function authUserHasVerifiedGoogleIdentity', 'function supabaseAuthUserPreferredEmail').includes('metadataVerified'));

process.stdout.write(`\nRoot-cause regressions: ${passed}/${passed + failed} passed.\n`);
if (failed) process.exit(1);
