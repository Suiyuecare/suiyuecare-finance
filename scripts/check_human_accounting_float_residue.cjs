#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');

const root = path.resolve(__dirname, '..');
const baseline = fs.readFileSync(path.join(root, 'supabase/migrations/20260902054834_preserve_human_accounting_authority_v1.sql'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20261002035707_finance_human_accounting_float_residue_20261002.sql'), 'utf8');
const helperNames = [
  'finance_accounting_manual_fields',
  'finance_accounting_line_is_human',
  'finance_merge_human_accounting_line',
  'finance_merge_human_accounting_lines'
];
const helperSql = helperNames.map(name => {
  const match = baseline.match(new RegExp('create or replace function private\\.' + name + '\\([\\s\\S]*?\\$function\\$;', 'i'));
  assert.ok(match, 'reviewed helper exists: ' + name);
  return match[0];
}).join('\n');

const human = (id, net, tax, gross, more = {}) => ({
  id, netAmount: net, taxAmount: tax, grossAmount: gross,
  debitAccount: '6217', creditAccount: '1112',
  manualOverride: true, valueAuthority: 'human',
  manualFields: ['netAmount', 'taxAmount', 'grossAmount', 'debitAccount', 'creditAccount'],
  manualOverrideBy: { id: 'reviewer' },
  manualOverrideHistory: [{ at: '2026-10-01T00:00:00Z', changes: {} }],
  ...more
});

async function expectRejected(db, id, line, reason) {
  let error;
  try {
    await db.query('update public.expense_requests set form_payload = $2::jsonb where id = $1',
      [id, JSON.stringify({ accountingLines: [line] })]);
  } catch (caught) {
    error = caught;
  }
  assert.equal(error?.code, '23514', reason);
}

(async () => {
  const db = new PGlite();
  try {
    await db.exec('create schema private; create table public.expense_requests (id text primary key, form_payload jsonb not null);');
    await db.exec(helperSql);
    // Reproduce the original trigger's exact failure before installing the fix.
    const oldGuard = baseline.match(/create or replace function private\.finance_preserve_human_accounting_authority\(\)[\s\S]*?\$function\$;/i)?.[0];
    assert.ok(oldGuard, 'reviewed original trigger source exists');
    await db.exec(oldGuard);
    await db.exec('create trigger trg_zz_finance_preserve_human_accounting_authority before update on public.expense_requests for each row execute function private.finance_preserve_human_accounting_authority();');
    const legacy = human('line_legacy', 12.1, 0.30000000000000004, 12.4);
    const legacyJson = JSON.stringify({ accountingLines: [legacy] });
    await db.query('insert into public.expense_requests(id, form_payload) values ($1, $2::jsonb)', ['legacy', legacyJson]);
    await expectRejected(db, 'legacy', legacy, 'old guard rejects historical IEEE-754 tail');

    await db.exec(migration);
    const source = (await db.query("select prosrc, prosecdef, proconfig from pg_catalog.pg_proc where oid='private.finance_preserve_human_accounting_authority()'::regprocedure")).rows[0];
    assert.equal(source.prosecdef, true, 'SECURITY DEFINER remains unchanged');
    assert.deepEqual(source.proconfig, ['search_path=""'], 'search_path remains sealed');
    assert.match(source.prosrc, /pg_catalog\.abs\([\s\S]*?\) > 0\.000000001::numeric/);
    assert.equal(crypto.createHash('sha256').update(source.prosrc).digest('hex'),
      'df04143e1b9f7454539968191cd8fe8387127c15ffcd1169f7dfdbb70a1ab9b1',
      'postflight pins exact PL/pgSQL source');
    assert.equal(crypto.createHash('md5').update(source.prosrc).digest('hex'),
      '5063469c0ca7c63b29996ff615121c40',
      'built-in PostgreSQL md5 postflight pins exact PL/pgSQL source');

    // Simulate approval RPC replacing the body with an AI-computed suggestion.
    // The original human amount, accounts and review history must be retained.
    const machine = { ...legacy, netAmount: 500, taxAmount: 0, debitAccount: '9999',
      manualOverride: false, valueAuthority: 'system', manualFields: [] };
    await db.query('update public.expense_requests set form_payload=$2::jsonb where id=$1',
      ['legacy', JSON.stringify({ accountingLines: [machine] })]);
    const saved = (await db.query("select form_payload from public.expense_requests where id='legacy'")).rows[0].form_payload;
    assert.deepEqual(saved.accountingLines[0].netAmount, legacy.netAmount);
    assert.deepEqual(saved.accountingLines[0].taxAmount, legacy.taxAmount);
    assert.deepEqual(saved.accountingLines[0].grossAmount, legacy.grossAmount);
    assert.deepEqual(saved.accountingLines[0].debitAccount, legacy.debitAccount);
    assert.deepEqual(saved.accountingLines[0].creditAccount, legacy.creditAccount);
    assert.deepEqual(saved.accountingLines[0].manualOverrideHistory, legacy.manualOverrideHistory);

    // Fictional serialized tails in both directions also pass. These are
    // intentionally unrelated to any production request or financial amount.
    const residues = [
      [25.4, 1.5999999999999979, 27],
      [3.141, 0.8590000000000002, 4],
      [88.88, 0.11999999999999744, 89]
    ];
    for (let i = 0; i < residues.length; i++) {
      const line = human('line_' + i, ...residues[i]);
      const requestId = 'tail_' + i;
      await db.query('insert into public.expense_requests(id, form_payload) values ($1, $2::jsonb)',
        [requestId, JSON.stringify({ accountingLines: [line] })]);
      await db.query('update public.expense_requests set form_payload=form_payload where id=$1', [requestId]);
    }

    for (const [label, line] of [
      ['cent-level mismatch', human('bad_cent', 100, 5, 105.01)],
      ['one-bilionth-plus mismatch', human('bad_threshold', 100, 5.000000002, 105)],
      ['negative amount', human('bad_negative', -1, 2, 1)],
      ['missing debit account', human('bad_debit', 100, 5, 105, { debitAccount: '' })],
      ['missing credit account', human('bad_credit', 100, 5, 105, { creditAccount: '' })]
    ]) {
      await db.query('insert into public.expense_requests(id, form_payload) values ($1, $2::jsonb)',
        [label, JSON.stringify({ accountingLines: [line] })]);
      await expectRejected(db, label, line, label + ' stays blocked');
    }

    // The trigger remains in place and no fixture request is rewritten by migration.
    const trigger = (await db.query("select tgenabled from pg_catalog.pg_trigger where tgname='trg_zz_finance_preserve_human_accounting_authority'")).rows[0];
    assert.equal(trigger.tgenabled, 'O');
    const canary = fs.readFileSync(path.join(root, 'scripts/finance_human_accounting_float_canary.sql'), 'utf8')
      .replace(/^\\set ON_ERROR_STOP on\r?\n/, '');
    await db.exec(canary);
    console.log('OK: human accounting floating-residue trigger preserves authority and rejects material mismatches');
  } finally {
    await db.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
