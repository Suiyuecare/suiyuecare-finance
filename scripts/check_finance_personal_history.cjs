#!/usr/bin/env node
'use strict';
// Synthetic PGlite contract test. Installs the real predecessor projection and
// the real verified-identity matcher before the new history migration.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const { PGlite } = require('@electric-sql/pglite');
const { createSummarySearchFixture, addSummarySearchDocument, fixtureIdentity: who } = require('./check_approval_history_summary.cjs');
const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const migration = read('supabase/migrations/20261008055528_finance_personal_document_history_v1.sql');
const preflight = read('scripts/finance_personal_history_preflight.sql').replace(/^\\set[^\n]*\n/, '');
const postflight = read('scripts/finance_personal_history_postflight.sql').replace(/^\\set[^\n]*\n/, '');
const fingerprint = read('scripts/finance_personal_history_fingerprint.sql').replace(/^\\set[^\n]*\n/, '');
const canary = read('scripts/finance_personal_history_canary.sql');
const identityMigration = read('supabase/migrations/20260922133752_finance_document_identity_attachment_scope_v1.sql');
const identityStart = identityMigration.indexOf('create function public.finance_legacy_name_matches_current_v1');
const identityEnd = identityMigration.indexOf('revoke all on function public.finance_legacy_name_matches_current_v1', identityStart);
assert(identityStart >= 0 && identityEnd > identityStart, 'real identity matcher source must be present');

async function run() {
  const db = new PGlite();
  let checks = 0;
  const check = label => { checks++; console.log('PASS ' + label); };
  const summary = async (scope = 'all', limit = 50, offset = 0, search = null, env = 'test') =>
    (await db.query('select public.finance_personal_document_summary_v1($1,$2,$3,$4,$5) result',
      [scope, limit, offset, search, env])).rows[0].result;
  const detail = async (key, env = 'test') =>
    (await db.query('select public.finance_personal_document_detail_v1($1,$2) result',
      [key, env])).rows[0].result;
  const ids = result => result.items.map(row => row.record_id).sort();
  const expectDenied = async (operation, label) => {
    await assert.rejects(operation, error => error.code === '42501', label);
    check(label);
  };
  const add = async (table, id, options = {}) => addSummarySearchDocument(db, {
    table, id, description: id + ' 虛構照護繳費單', ...options
  });
  const step = async (id, values) => {
    const columns = Object.keys(values);
    await db.query('update public.approval_step_actor_snapshots set ' +
      columns.map((key, n) => key + '=$' + (n + 1)).join(',') +
      ' where record_id=$' + (columns.length + 1), [...Object.values(values), id]);
  };
  try {
    await createSummarySearchFixture(db);
    await db.exec(`
      alter table public.finance_users add column name text;
      alter table public.expense_requests add column applicant_id text,
        add column applicant_email text;
      alter table public.bills add column applicant_id text,
        add column applicant_email text;
      alter table public.invoices add column applicant_id text;
      alter table public.approval_step_actor_snapshots add column raw_step jsonb;
      update public.finance_users set name='虛構本人' where id='FICT-USER';
      create function public.current_finance_user_id() returns text
        language sql stable as $$select id from public.finance_users
          where auth_user_id=auth.uid() and active=true limit 1$$;
      create function public.current_tenant_id() returns uuid
        language sql stable as $$select tenant_id from public.finance_users
          where auth_user_id=auth.uid() and active=true limit 1$$;
      create function public.finance_current_verified_google_email_v2() returns text
        language sql stable as $$select public.finance_verified_google_email(auth.uid())$$;
      create schema supabase_migrations;
      create table supabase_migrations.schema_migrations(
        version text primary key, statements text[], name text, created_by text);
      insert into supabase_migrations.schema_migrations(version,name) values
        ('20260915050313','finance_approval_history_summary_v1'),
        ('20260922133752','finance_document_identity_attachment_scope_v1');
    `);
    await db.exec(identityMigration.slice(identityStart, identityEnd));

    await add('expense_requests', 'R-OWNER');
    await db.exec("delete from public.approval_step_actor_snapshots where record_id='R-OWNER';" +
      "update public.expense_requests set applicant_id='FICT-USER',applicant_email='wrong@example.invalid' where id='R-OWNER';");
    await add('bills', 'B-OWNER');
    await db.exec("delete from public.approval_step_actor_snapshots where record_id='B-OWNER';" +
      "update public.bills set applicant_email='fiction@example.invalid' where id='B-OWNER';");
    await add('invoices', 'I-OWNER');
    await db.exec("delete from public.approval_step_actor_snapshots where record_id='I-OWNER';" +
      "update public.invoices set applicant_id='FICT-USER' where id='I-OWNER';");
    await add('expense_requests', 'R-OLDID');
    await db.exec("delete from public.approval_step_actor_snapshots where record_id='R-OLDID';" +
      "update public.expense_requests set applicant_id='FORMER-ID',applicant_email='fiction@example.invalid',applicant='虛構本人' where id='R-OLDID';");
    await add('expense_requests', 'R-SIGN');
    await add('expense_requests', 'R-LEGACY');
    await step('R-LEGACY', {
      acted_by_user_id: null, raw_actor_user_id: 'FICT-USER', acted_at_text: null,
      step_status: 'approved', raw_step: null
    });
    await add('expense_requests', 'R-AUTOSKIP');
    await step('R-AUTOSKIP', {
      acted_by_user_id: null, raw_actor_user_id: 'FICT-USER', acted_at_text: null,
      step_status: 'approved', raw_step: JSON.stringify({ autoSkip: true })
    });
    await add('expense_requests', 'R-PENDING');
    await step('R-PENDING', {
      acted_by_user_id: null, raw_actor_user_id: 'FICT-USER', acted_at_text: null,
      step_status: null, raw_step: null
    });
    await add('expense_requests', 'R-PROXY');
    await step('R-PROXY', {
      acted_by_user_id: 'OTHER-USER', raw_actor_user_id: 'FICT-USER',
      step_status: 'approved', raw_step: null
    });
    await add('expense_requests', 'R-CANCEL');
    await step('R-CANCEL', {
      acted_by_user_id: null, raw_actor_user_id: 'FICT-USER',
      step_status: 'cancelled', raw_step: null
    });
    await add('bills', 'B-SIGN', { batch: 'SAME-BATCH' });
    await add('bills', 'B-SECRET', { batch: 'SAME-BATCH', participant: false });
    await add('expense_requests', 'R-FOREIGN', {
      tenantId: who.otherTenantId, participant: false
    });
    await db.exec("update public.expense_requests set applicant_id='FICT-USER' where id='R-FOREIGN';");
    await add('expense_requests', 'R-PROD', { environment: 'production', participant: false });
    await db.exec("update public.expense_requests set applicant_id='FICT-USER' where id='R-PROD';");
    await add('expense_requests', 'R-DUPNAME');
    await db.exec("delete from public.approval_step_actor_snapshots where record_id='R-DUPNAME';" +
      "update public.expense_requests set applicant='虛構本人' where id='R-DUPNAME';" +
      `insert into public.finance_users(id,tenant_id,auth_user_id,email,active,name)
       values('SAME-NAME','${who.tenantId}',null,'namesake@example.invalid',true,'虛構本人');`);

    const before = (await db.query(fingerprint)).rows[0].fingerprint;
    await db.exec(preflight);
    check('preflight validates predecessor identity, projection and migration state');
    await db.exec('begin; savepoint history_migration; ' + migration +
      `insert into supabase_migrations.schema_migrations(version,name) values
      ('20261008055528','finance_personal_document_history_v1');` +
      postflight + 'rollback to savepoint history_migration; commit;');
    assert.equal((await db.query(fingerprint)).rows[0].fingerprint, before);
    assert.equal((await db.query("select to_regprocedure('public.finance_personal_document_summary_v1(text,integer,integer,text,text)') x")).rows[0].x, null);
    check('transaction/savepoint rehearsal rolls back migration, ledger and data exactly');
    await db.exec(migration);
    await db.exec(`insert into supabase_migrations.schema_migrations(version,name)
      values ('20261008055528','finance_personal_document_history_v1');`);
    await db.exec(postflight);
    check('postflight validates owner, grants, auto-skip, key, tenant and environment predicates');

    const all = await summary();
    const mine = await summary('mine');
    assert.equal(all.ok, true);
    assert.equal(all.mode, 'summary');
    assert.equal(all.projection_complete, true);
    assert.equal(all.total, all.all_total);
    assert.deepEqual(ids(mine), ['B-OWNER', 'I-OWNER', 'R-OWNER']);
    assert(ids(all).includes('R-SIGN') && ids(all).includes('R-LEGACY') &&
      ids(all).includes('R-CANCEL') && ids(all).includes('B-SIGN'));
    for (const id of ['R-OLDID','R-AUTOSKIP','R-PENDING','R-PROXY',
      'R-DUPNAME','B-SECRET','R-FOREIGN','R-PROD']) assert(!ids(all).includes(id), id);
    check('mine is owner-only; all includes actual signers but excludes wrong ID, assigned, auto-skip, proxy, namesake, tenant and environment');
    assert.equal(all.items.find(item => item.record_id === 'R-SIGN').participation_label, '本人已處理');
    assert.equal(all.items.find(item => item.record_id === 'R-OWNER').participation_label, '我申請的');
    assert(all.items.every(item => item.source_count === 1 && item.summary.source_count === 1));
    check('labels and per-source summary counts are accurate');
    const bill = (await detail('bills:B-SIGN')).item;
    assert.equal(bill.source_rows.length, 1);
    assert.equal(bill.source_rows[0].id, 'B-SIGN');
    assert.equal(bill.batch_id, 'SAME-BATCH');
    assert.equal(bill.participant_steps.length, 1);
    assert.equal(bill.participant_steps[0].personally_acted, true);
    await expectDenied(() => detail('bills:B-SECRET'), 'same-batch sibling detail is denied');
    await expectDenied(() => detail('bills:DOES-NOT-EXIST'), 'absent detail has same denial code');
    check('single-row detail never expands a shared batch');
    assert.deepEqual(ids(await summary('all', 50, 0, 'R-SIGN')), ['R-SIGN']);
    assert.equal((await summary('all', 50, 0, 'B-SECRET')).total, 0);
    check('search uses authorized source projections, never sibling group text');
    await assert.rejects(() => summary('all', 51), error => error.code === '22023');
    await assert.rejects(() => summary('assigned'), error => error.code === '22023');
    check('scope and page bounds reject invalid input');
    await db.exec("set fixture.uid='';");
    await expectDenied(() => summary(), 'anonymous summary is denied');
    await expectDenied(() => detail('bills:B-SIGN'), 'anonymous detail is denied');
    await db.exec(`set fixture.uid='${who.authUserId}'; set fixture.email='wrong@example.invalid';`);
    await expectDenied(() => summary(), 'unverified email mismatch is denied');
    await db.exec("set fixture.email='fiction@example.invalid';");

    await db.exec(`insert into public.expense_requests(
      id,no,tenant_id,data_environment,amount,description,department_code,
      form_payload,type,type_label,status,applicant,applicant_id,created_at)
      select 'PAGE-'||lpad(n::text,5,'0'),'PAGE-'||lpad(n::text,5,'0'),
      '${who.tenantId}','test',42,'跨頁虛構申請','D1','{}'::jsonb,
      'payment_request','請款申請','completed','虛構本人','FICT-USER',
      '2026-09-15T00:00:00Z'::timestamptz from generate_series(1,65) n;`);
    const page0 = await summary('mine',50,0);
    const page1 = await summary('mine',50,50);
    assert.equal(page0.total, 68);
    assert.equal(page0.all_total, 68);
    assert.equal(page0.items.length, 50);
    assert.equal(page1.items.length, 18);
    assert.equal(new Set([...page0.items,...page1.items].map(item => item.history_key)).size, 68);
    assert.equal(page0.page.has_more, true);
    assert.equal(page1.page.has_more, false);
    check('exact pagination reaches every applicant-owned row beyond first 50');
    await db.exec("delete from private.finance_history_source_projection_v1 where record_type='bills' and source_id='B-OWNER';");
    await assert.rejects(() => summary('mine'), error => error.code === '55000');
    await assert.rejects(() => detail('bills:B-OWNER'), error => error.code === '55000');
    check('incomplete projection fails closed for list and detail');
    await db.exec("update public.bills set item=item||' repaired' where id='B-OWNER';");
    assert.equal((await summary('mine')).projection_complete, true);
    check('source trigger repairs projection before history resumes');

    // Read-only canary runs with no auth identity; its result is the release
    // guard's exact JSON marker and must leave the transaction closed.
    await db.exec("set fixture.uid='';");
    const canaryRows = await db.exec(canary);
    const canaryResult = canaryRows.at(-1).rows[0].personal_history_canary_result;
    assert.deepEqual(canaryResult, {
      canary:'readonly_personal_history_v1',ok:true,rolled_back:true,
      identity_scope_preserved:true
    });
    check('read-only canary rejects absent identity and reports rollback marker');

    if (process.env.FINANCE_PERSONAL_HISTORY_PERF === '1') {
      await db.exec(`set fixture.uid='${who.authUserId}'; set fixture.email='fiction@example.invalid';`);
      const start = performance.now();
      await db.exec(`insert into public.expense_requests(
      id,no,tenant_id,data_environment,amount,description,department_code,
      form_payload,type,type_label,status,applicant,applicant_id,created_at)
      select 'PERF-'||lpad(n::text,5,'0'),'PERF-'||lpad(n::text,5,'0'),
      '${who.tenantId}','test',42,'效能虛構申請','D1','{}'::jsonb,
      'payment_request','請款申請','completed','虛構本人','FICT-USER',
      '2026-09-15T00:00:00Z'::timestamptz from generate_series(1,10000) n;`);
      const insertMs = performance.now() - start;
      const queryStart = performance.now();
      const bulk = await summary('mine',50,9950);
      const queryMs = performance.now() - queryStart;
      assert.equal(bulk.total, 10068);
      assert.equal(bulk.items.length, 50);
      console.log('BENCH ' + JSON.stringify({
        environment:'local PGlite synthetic, 10000 additional owner documents',
        insertMs:Math.round(insertMs),queryMs:Math.round(queryMs),total:bulk.total
      }));
      check('10k+ synthetic documents remain countable and paginated without a bootstrap cutoff');
    }
    console.log('PERSONAL_HISTORY_CHECKS=' + checks);
  } finally { await db.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
