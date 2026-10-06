#!/usr/bin/env node
'use strict';
// Exercise the reviewed finalizer and its migrations in anonymous PGlite.
// No application server, credentials, network client, or operational DB is used.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const fixture = fs.readFileSync(path.join(__dirname, 'check_finalize_accounting_lines_atomic.js'), 'utf8');
const marker = "  const old=await create('baseline-drift')";
assert.equal(fixture.split(marker).length, 2, 'reviewed finalizer fixture setup anchor');
const setup = fixture.slice(0, fixture.indexOf(marker)).replace(/^#![^\n]*\n/, '');

const body = String.raw`
  const utilityMigration = read('supabase/migrations/20260909083825_finance_utility_gross_expense_guard_v1.sql');
  const purchaseMigrations = fs.readdirSync(path.join(root, 'supabase/migrations'))
    .filter(name => /^[0-9]{14}_purchase_final_amount.*\.sql$/.test(name));
  assert.equal(purchaseMigrations.length, 1, 'exactly one purchase final amount migration');
  const purchaseMigration = read('supabase/migrations/' + purchaseMigrations[0]);
  const finalizerOid = "public.finalize_expense_request(text,text,integer,jsonb,numeric,numeric,text,text,text,jsonb,numeric,text,date,jsonb)";
  const finalizerMetadata = async () => (await db.query(
    "select pg_get_userbyid(proowner) owner, prosecdef, proconfig, proacl from pg_proc where oid=$1::regprocedure",
    [finalizerOid]
  )).rows[0];
  const lineFor = amount => human(original, {
    grossAmount: amount, netAmount: amount, taxAmount: 0
  });
  const purchase = async (id, actualAmount, purchasePayloadAmount = actualAmount) => {
    const proof = {path: 'anonymous-receipt-' + id};
    return create(id, {
      type: 'purchase_request', amount: 1050, estimated_amount: 1050,
      actual_amount: actualAmount, actual_files: [proof],
      form_payload: {
        accountingLines: [clone(original)],
        purchaseActual: {actualAmount: purchasePayloadAmount, files: [proof], stage: 'procurement_actual_receipt'},
        procurementReceiptInfo: {actualAmount, fileCount: 1}
      }
    });
  };
  const post = (row, amount, finalizedAmount = amount) => {
    const line = lineFor(amount);
    return call(row, [line], {
      amount,
      payload: {purchaseFinalizedAmount: finalizedAmount, accountingLines: [line]}
    });
  };
  const assertRejectedWithoutWrites = async (label, row, amount, finalizedAmount = amount) => {
    const before = await state(row.id);
    const linesBefore = (await db.query(
      'select line_index,payload from public.application_accounting_lines where request_id=$1 order by line_index',
      [row.id]
    )).rows;
    let error;
    try { await post(row, amount, finalizedAmount); } catch (caught) { error = caught; }
    assert.equal(error && error.code, '23514', label + ': expected the final amount guard');
    assert.match(error.message, /採購申請.*實際金額/, label + ': expected the purchase amount diagnostic');
    const after = await state(row.id);
    assert.deepEqual(after, before, label + ': request row changed');
    assert.deepEqual((await db.query(
      'select line_index,payload from public.application_accounting_lines where request_id=$1 order by line_index',
      [row.id]
    )).rows, linesBefore, label + ': accounting lines changed');
    assert.equal((await db.query('select count(*)::int n from public.vouchers where request_id=$1', [row.id])).rows[0].n, 0, label + ': voucher created');
    assert.equal((await db.query('select count(*)::int n from public.ledger_entries where source_id=$1', [row.id])).rows[0].n, 0, label + ': ledger created');
    check(label + ' rejects with request, accounting lines, voucher and ledger untouched');
  };

  await db.exec('begin;' + migration + '\ncommit;');
  const correctionSource = read('supabase/migrations/20260907154742_expense_accounting_correction_workflow_v1.sql')
    .match(/create function private\.finance_correction_patch_v1\([\s\S]*?\$function\$;/)[0];
  await db.exec(correctionSource +
    'revoke all on function private.finance_correction_patch_v1(public.expense_requests,jsonb,text) from public,anon,authenticated,service_role');
  await db.exec('begin;' + utilityMigration + '\ncommit;');
  const metadataBefore = await finalizerMetadata();
  assert.equal(metadataBefore.owner, 'postgres');
  assert.equal(metadataBefore.prosecdef, true);
  assert.deepEqual(metadataBefore.proconfig, ['search_path=""']);

  // Prove the reviewed predecessor accepts the regression case. The new
  // migration must leave already posted records intact.
  const prior = await purchase('purchase-prior-one-cent', 945.50);
  const priorResult = await post(prior, 945.51);
  assert.equal(priorResult.ok, true);
  const priorSaved = await state(prior.id);
  assert.equal(Number(priorSaved.actual_amount), 945.51);
  check('reviewed predecessor reproduces one-cent principal drift');

  await db.exec('begin;' + purchaseMigration + '\ncommit;');
  assert.deepEqual(await finalizerMetadata(), metadataBefore, 'migration changed finalizer owner, security or execute ACL');
  assert.deepEqual(await state(prior.id), priorSaved, 'migration backfilled a historical posted request');
  check('migration preserves finalizer metadata and historical posted row');

  await assertRejectedWithoutWrites('one cent above stage-8 actual',
    await purchase('purchase-plus-cent', 945.50), 945.51);
  await assertRejectedWithoutWrites('one cent below stage-8 actual',
    await purchase('purchase-minus-cent', 945.50), 945.49);
  await assertRejectedWithoutWrites('final payload one cent above stage-8 actual',
    await purchase('purchase-payload-plus-cent', 945.50), 945.50, 945.51);
  await assertRejectedWithoutWrites('final payload one cent below stage-8 actual',
    await purchase('purchase-payload-minus-cent', 945.50), 945.50, 945.49);
  await assertRejectedWithoutWrites('saved GA payload one cent above actual column',
    await purchase('purchase-saved-payload-plus-cent', 945.50, 945.51), 945.50);
  await assertRejectedWithoutWrites('saved GA payload one cent below actual column',
    await purchase('purchase-saved-payload-minus-cent', 945.50, 945.49), 945.50);

  const exact = await purchase('purchase-exact-decimal', 945.50);
  const exactResult = await post(exact, 945.50);
  assert.equal(exactResult.ok, true);
  assert.equal(exactResult.idempotent, false);
  const exactSaved = await state(exact.id);
  assert.equal(exactSaved.status, 'completed');
  assert.equal(Number(exactSaved.amount), 945.50);
  assert.equal(Number(exactSaved.actual_amount), 945.50);
  assert.equal(Number(exactSaved.form_payload.purchaseFinalizedAmount), 945.50);
  const voucher = (await db.query('select total from public.vouchers where request_id=$1', [exact.id])).rows;
  assert.equal(voucher.length, 1);
  assert.equal(Number(voucher[0].total), 945.50);
  const ledger = (await db.query(
    'select count(*)::int n, sum(debit) debit, sum(credit) credit from public.ledger_entries where source_id=$1',
    [exact.id]
  )).rows[0];
  assert.equal(ledger.n, 2);
  assert.equal(Number(ledger.debit), 945.50);
  assert.equal(Number(ledger.credit), 945.50);
  check('exact 945.50 purchase posts one balanced voucher and ledger');
  const replay = await post(exact, 945.50);
  assert.equal(replay.idempotent, true);
  await admin('select 1');
  assert.equal((await db.query('select count(*)::int n from public.vouchers where request_id=$1', [exact.id])).rows[0].n, 1);
  check('exact purchase retry is idempotent');

  // This migration is scoped to purchases; the existing generic request
  // tolerance is verified separately rather than implicitly broadened.
  const ordinary = await create('ordinary-one-cent-unchanged', {type: 'payment_request'});
  const ordinaryLine = lineFor(1050.01);
  const ordinaryResult = await call(ordinary, [ordinaryLine], {
    amount: 1050.01, payload: {accountingLines: [ordinaryLine]}
  });
  assert.equal(ordinaryResult.ok, true);
  const ordinarySaved = await state(ordinary.id);
  assert.equal(ordinarySaved.status, 'completed');
  assert.equal(Number(ordinarySaved.amount), 1050.01);
  check('nonpurchase finalization retains its existing contract');

  console.log('OK: ' + tests + ' purchase final amount PGlite checks passed (' + purchaseMigrations[0] + ')');
} finally { await db.close(); }})().catch(error => {
  console.error({message: error.message, code: error.code, detail: error.detail, stack: error.stack});
  process.exitCode = 1;
});
`;

new Function('require', '__dirname', '__filename', setup + body)(require, __dirname, __filename);
