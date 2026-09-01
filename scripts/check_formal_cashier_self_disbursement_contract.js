#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const migration = fs.readFileSync(path.join(
  root,
  'supabase/migrations/20260901081807_allow_formal_cashier_self_disbursement.sql'
), 'utf8');

assert.match(migration,
  /36c621ce91d061a58b56453321980a19e75d4bc0f521ad1340641e70c2c59938/,
  'migration must be pinned to the reviewed production helper source');
assert.match(migration, /p_expense\.status = 'pending_cashier'/,
  'exception must require pending_cashier');
assert.match(migration, /p_expense\.cash_posted_at is null/,
  'exception must reject a repeated disbursement');
assert.match(migration, /v_role_key = 'cashier'/,
  'exception must be limited to the cashier step');
assert.match(migration, /v_explicit_user_id = p_actor_finance_user_id/,
  'the frozen cashier UID must match the current actor');
assert.match(migration, /cashier_role\.role_key = 'cashier'/,
  'actor must have the formal cashier role');
assert.match(migration, /cashier_role\.active is true/,
  'formal cashier assignment must be active');
assert.match(migration, /cashier_role\.can_approve is true/,
  'formal cashier assignment must retain approval authority');
assert.doesNotMatch(migration,
  /(?:insert\s+into|update|delete\s+from)\s+public\.(?:expense_requests|employee_department_roles|finance_users)/i,
  'migration must not rewrite requests, role assignments, or identities');

function formalCashierSelfDisbursement(input) {
  return input.status === 'pending_cashier'
    && input.cashPostedAt == null
    && input.role === 'cashier'
    && input.sameFrozenStep
    && Boolean(input.uid)
    && input.uid === input.actorId
    && input.formalRole === 'cashier'
    && input.active
    && input.canApprove
    && input.effective;
}

const valid = {
  status: 'pending_cashier', cashPostedAt: null, role: 'cashier',
  sameFrozenStep: true, uid: 'u_entrepreneur', actorId: 'u_entrepreneur',
  formalRole: 'cashier', active: true, canApprove: true, effective: true
};
assert.equal(formalCashierSelfDisbursement(valid), true,
  'formal cashier may disburse their own explicitly assigned request');
assert.equal(formalCashierSelfDisbursement({...valid, role: 'ceo'}), false,
  'CEO self-approval remains forbidden');
assert.equal(formalCashierSelfDisbursement({...valid, formalRole: 'ceo'}), false,
  'primary CEO role alone cannot impersonate the cashier');
assert.equal(formalCashierSelfDisbursement({...valid, uid: 'u8'}), false,
  'a different frozen cashier cannot be impersonated');
assert.equal(formalCashierSelfDisbursement({...valid, cashPostedAt: '2026-09-01T00:00:00Z'}), false,
  'an already posted disbursement cannot be repeated');
assert.equal(formalCashierSelfDisbursement({...valid, active: false}), false,
  'a revoked cashier assignment cannot act');
assert.equal(formalCashierSelfDisbursement({...valid, canApprove: false}), false,
  'a non-approving cashier assignment cannot act');

process.stdout.write('Formal-cashier self-disbursement contract: 7 policy cases and migration guards passed.\n');
