#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const migration = fs.readFileSync(path.join(
  root,
  'supabase/migrations/20260901030000_final_accountant_self_post.sql'
), 'utf8');

assert.match(migration,
  /5ec7df359d84b46c7824f57b8d96dd1d1b0300c197f4d68e31ee22157450c0dd/,
  'migration must be pinned to the reviewed production helper source');
assert.match(migration,
  /p_expense\.status = 'pending_voucher'/,
  'self-post exception must require pending_voucher');
assert.match(migration,
  /v_role_key in \('accountant_final', 'accounting'\)/,
  'self-post exception must be limited to final accounting roles');
assert.match(migration,
  /p_step_index =\s*pg_catalog\.jsonb_array_length\(p_expense\.steps\) - 1/,
  'self-post exception must require the last frozen step');
assert.match(migration,
  /p_step = p_expense\.steps -> p_step_index/,
  'self-post exception must use the frozen request step');
assert.match(migration,
  /v_explicit_user_id = p_actor_finance_user_id/,
  'self-post exception must require an explicit frozen UID match');
assert.match(migration,
  /v_explicit_email = pg_catalog\.lower\([\s\S]*?p_actor_email/,
  'legacy frozen email assignment must still match the authenticated actor');
assert.match(migration,
  /and v_role_key not in \(\s*'applicant_revision',\s*'applicant_confirm'/,
  'the original self-approval guard must remain present');
assert.doesNotMatch(migration,
  /(?:insert\s+into|update|delete\s+from)\s+public\.(?:expense_requests|employee_department_roles|finance_users)/i,
  'migration must not rewrite requests, assignments, or user identities');
assert.doesNotMatch(migration,
  /^\s*(?:begin|commit|rollback)(?:\s+(?:work|transaction))?\s*;\s*$/im,
  'the pinned release runner owns transaction boundaries');

function selfPostException({ status, role, isLast, sameStep, uid, email, actorId, actorEmail }) {
  return status === 'pending_voucher'
    && ['accountant_final', 'accounting'].includes(role)
    && isLast
    && sameStep
    && ((uid && uid === actorId)
      || (!uid && email && email.toLowerCase() === actorEmail.toLowerCase()));
}

assert.equal(selfPostException({
  status: 'pending_voucher', role: 'accountant_final', isLast: true,
  sameStep: true, uid: 'u6', email: '', actorId: 'u6',
  actorEmail: 'suiyue.acct@suiyuecare.com'
}), true, 'explicitly frozen final accountant may post their own request');
assert.equal(selfPostException({
  status: 'pending_approval', role: 'accountant_final', isLast: true,
  sameStep: true, uid: 'u6', email: '', actorId: 'u6',
  actorEmail: 'suiyue.acct@suiyuecare.com'
}), false, 'ordinary approval remains protected');
assert.equal(selfPostException({
  status: 'pending_voucher', role: 'dept_manager', isLast: true,
  sameStep: true, uid: 'u6', email: '', actorId: 'u6',
  actorEmail: 'suiyue.acct@suiyuecare.com'
}), false, 'manager self-approval remains protected');
assert.equal(selfPostException({
  status: 'pending_voucher', role: 'accountant_final', isLast: true,
  sameStep: true, uid: 'u7', email: '', actorId: 'u6',
  actorEmail: 'suiyue.acct@suiyuecare.com'
}), false, 'a different frozen accountant may not be impersonated');
assert.equal(selfPostException({
  status: 'pending_voucher', role: 'accountant_final', isLast: false,
  sameStep: true, uid: 'u6', email: '', actorId: 'u6',
  actorEmail: 'suiyue.acct@suiyuecare.com'
}), false, 'non-final accounting steps remain protected');

process.stdout.write('Final-accountant self-post contract: 5 policy cases and migration guards passed.\n');
