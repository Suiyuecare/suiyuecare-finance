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
const permissionMigration = read('supabase/migrations/20261008090000_finance_personal_history_permission_guard_v1.sql');
const permissionPreflight = read('scripts/finance_personal_history_permission_preflight.sql').replace(/^\\set[^\n]*\n/, '');
const permissionPostflight = read('scripts/finance_personal_history_permission_postflight.sql').replace(/^\\set[^\n]*\n/, '');
const compatHistoryPostflight = read('scripts/finance_approval_history_summary_permission_postflight.sql').replace(/^\\set[^\n]*\n/, '');
const compatOldestPostflight = read('scripts/finance_approval_history_permission_postflight.sql').replace(/^\\set[^\n]*\n/, '');
const compatAmountPostflight = read('scripts/finance_amount_search_permission_postflight.sql').replace(/^\\set[^\n]*\n/, '');
const compatSearchPostflight = read('scripts/finance_approval_search_permission_postflight.sql').replace(/^\\set[^\n]*\n/, '');
const permissionCanary = read('scripts/finance_personal_history_permission_canary.sql');
const compatSearchCanary = read('scripts/finance_approval_search_permission_canary.sql');
const permissionFingerprint = read('scripts/finance_personal_history_permission_fingerprint.sql').replace(/^\\set[^\n]*\n/, '');
const helperFixture = read('scripts/fixtures/finance_procurement_payment_helpers_20260908.sql')
  .match(/CREATE OR REPLACE FUNCTION private\.finance_expense_optional_permission_allows\([\s\S]*?\$function\$;/)[0];
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
  const legacySummary = async (env = 'test') =>
    (await db.query('select public.finance_approval_history_summary_v1($1,$2,$3,$4) result',
      [50, 0, null, env])).rows[0].result;
  const legacyDetail = async (key, env = 'test') =>
    (await db.query('select public.finance_approval_history_detail_v1($1,$2) result',
      [key, env])).rows[0].result;
  const legacyFull = async (env = 'test') =>
    (await db.query('select public.finance_approval_participant_history_for_current_user($1,$2,$3,$4) result',
      [50, 0, null, env])).rows[0].result;
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
      alter table public.finance_users add column name text, add column role text default 'employee';
      create table public.system_settings(
        tenant_id uuid not null, key text not null, value jsonb not null,
        primary key(tenant_id,key));
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

    const grouped = (await legacyDetail('bills:SAME-BATCH')).item;
    assert(grouped.source_rows.some(row => row.id === 'B-SIGN'));
    assert(grouped.source_rows.some(row => row.id === 'B-SECRET'));
    check('fictional baseline proves old grouped detail exposes a same-batch sibling');
    const fullGroup = (await legacyFull()).items.find(row => row.history_key === 'bills:SAME-BATCH');
    assert(fullGroup.source_rows.some(row => row.id === 'B-SECRET'));
    check('fictional baseline proves oldest full-history RPC also expands a sibling batch');

    // Install the actual trusted Finance/Membership helper. Production has no
    // optional Membership objects today, so legacy role_permissions must still
    // deny the page independently of the helper's all-absent fallback.
    await db.exec(helperFixture);
    const permissionBefore = (await db.query(permissionFingerprint)).rows[0].fingerprint;
    await db.exec(permissionPreflight);
    check('permission preflight requires applied personal history and trusted Membership helper');
    await db.exec('begin; savepoint permission_migration; ' + permissionMigration +
      `insert into supabase_migrations.schema_migrations(version,name) values
      ('20261008090000','finance_personal_history_permission_guard_v1');` +
      permissionPostflight + 'rollback to savepoint permission_migration; commit;');
    assert.equal((await db.query(permissionFingerprint)).rows[0].fingerprint, permissionBefore);
    check('permission migration and ledger roll back to an exact fingerprint');
    await db.exec(permissionMigration);
    await db.exec(`insert into supabase_migrations.schema_migrations(version,name) values
      ('20261008090000','finance_personal_history_permission_guard_v1');`);
    await db.exec(permissionPostflight);
    await db.exec(postflight);
    await db.exec(compatOldestPostflight);
    await db.exec(compatAmountPostflight);
    await db.exec(compatSearchPostflight);
    await db.exec(compatHistoryPostflight);
    check('new and existing postflights preserve personal RPC grants and source scope');

    const legacyAcl = (await db.query(`select
      has_function_privilege('authenticated',
        'public.finance_approval_history_summary_v1(integer,integer,text,text)','EXECUTE') summary_user,
      has_function_privilege('authenticated',
        'public.finance_approval_history_detail_v1(text,text)','EXECUTE') detail_user,
      has_function_privilege('authenticated',
        'public.finance_approval_participant_history_for_current_user(integer,integer,text,text)','EXECUTE') full_user,
      has_function_privilege('service_role',
        'public.finance_approval_history_summary_v1(integer,integer,text,text)','EXECUTE') summary_service,
      has_function_privilege('service_role',
        'public.finance_approval_history_detail_v1(text,text)','EXECUTE') detail_service,
      has_function_privilege('service_role',
        'public.finance_approval_participant_history_for_current_user(integer,integer,text,text)','EXECUTE') full_service,
      has_function_privilege('anon',
        'public.finance_approval_history_summary_v1(integer,integer,text,text)','EXECUTE') summary_anon,
      has_function_privilege('anon',
        'public.finance_approval_history_detail_v1(text,text)','EXECUTE') detail_anon,
      has_function_privilege('anon',
        'public.finance_approval_participant_history_for_current_user(integer,integer,text,text)','EXECUTE') full_anon`)).rows[0];
    assert(Object.values(legacyAcl).every(value => value === false));
    await db.exec('set role authenticated');
    await expectDenied(() => legacySummary(), 'authenticated direct legacy summary EXECUTE is revoked');
    await expectDenied(() => legacyDetail('bills:SAME-BATCH'), 'authenticated direct legacy grouped detail EXECUTE is revoked');
    await expectDenied(() => legacyFull(), 'authenticated direct oldest full-history EXECUTE is revoked');
    await db.exec('reset role');
    await db.exec('set role service_role');
    await expectDenied(() => legacySummary(), 'service-role direct legacy summary EXECUTE is revoked');
    await expectDenied(() => legacyDetail('bills:SAME-BATCH'), 'service-role direct legacy grouped detail EXECUTE is revoked');
    await expectDenied(() => legacyFull(), 'service-role direct oldest full-history EXECUTE is revoked');
    await db.exec('reset role');

    const setRoles = async value => db.query(`insert into public.system_settings(tenant_id,key,value)
      values($1,'role_permissions',$2::jsonb) on conflict(tenant_id,key)
      do update set value=excluded.value`, [who.tenantId, JSON.stringify(value)]);
    const setModules = async value => db.query(`insert into public.system_settings(tenant_id,key,value)
      values($1,'product_modules',$2::jsonb) on conflict(tenant_id,key)
      do update set value=excluded.value`, [who.tenantId, JSON.stringify(value)]);
    assert.equal((await summary('mine')).ok, true);
    assert.equal((await detail('bills:B-SIGN')).ok, true);
    check('legacy default employee role permits personal history when Membership is absent');
    await setModules([{id:'finance-core',enabled:false,status:'ready'}]);
    await expectDenied(() => summary('mine'), 'disabled finance-core module denies summary');
    await expectDenied(() => detail('bills:B-SIGN'), 'disabled finance-core module denies detail');
    await setModules([{id:'finance-core',enabled:true,status:'disabled'}]);
    await expectDenied(() => summary('mine'), 'disabled finance-core status denies summary');
    await expectDenied(() => detail('bills:B-SIGN'), 'disabled finance-core status denies detail');
    await setModules([{id:'finance-core',enabled:true,status:'ready'}]);
    await setRoles({employee:{approvals:'none'}});
    await expectDenied(() => summary('mine'), 'legacy object permission denial blocks summary');
    await expectDenied(() => detail('bills:B-SIGN'), 'legacy object permission denial blocks direct detail');
    await expectDenied(() => legacySummary(), 'legacy actor also rejects denied approvals summary');
    await expectDenied(() => legacyDetail('bills:SAME-BATCH'), 'legacy actor also rejects denied grouped detail');
    await setRoles({employee:['dashboard']});
    await expectDenied(() => summary('mine'), 'legacy array allowlist without approvals denies summary');
    await expectDenied(() => detail('bills:B-SIGN'), 'legacy array allowlist without approvals denies detail');
    await setRoles({employee:{approvals:0}});
    await expectDenied(() => summary('mine'), 'legacy numeric zero denies summary');
    await expectDenied(() => detail('bills:B-SIGN'), 'legacy numeric zero denies detail');
    await setRoles({employee:{approvals:0.5}});
    await expectDenied(() => summary('mine'), 'fractional numeric permission never grants summary');
    await expectDenied(() => detail('bills:B-SIGN'), 'fractional numeric permission never grants detail');
    await setRoles({employee:{approvals:1}});
    assert.equal((await summary('mine')).ok, true);
    assert.equal((await detail('bills:B-SIGN')).ok, true);
    check('legacy numeric view grants both RPCs');
    await setRoles({employee:{approvals:3.5}});
    assert.equal((await summary('mine')).ok, true);
    assert.equal((await detail('bills:B-SIGN')).ok, true);
    check('numeric permission above three clamps to delete and permits reads');
    await setRoles({employee:{approvals:'view'}});
    assert.equal((await summary('mine')).ok, true);
    assert.equal((await detail('bills:B-SIGN')).ok, true);
    check('legacy string view grants both RPCs');
    await db.exec("update public.finance_users set role='external_audit' where id='FICT-USER'");
    await expectDenied(() => summary('mine'), 'legacy external audit default excludes approvals summary');
    await expectDenied(() => detail('bills:B-SIGN'), 'legacy external audit default excludes approvals detail');
    await db.exec("update public.finance_users set role='employee' where id='FICT-USER'");

    await db.exec(`
      create table public.membership_users(
        id uuid primary key,tenant_id uuid,legacy_finance_user_id text,
        auth_user_id uuid,status text);
      create table public.membership_permission_fixture(member_id uuid,code text,effect text);
      insert into public.membership_users values(
        '00000000-0000-0000-0000-000000000099',
        '${who.tenantId}','FICT-USER','${who.authUserId}','active');
      create function public.membership_current_user_id() returns uuid
        language sql stable as $$select id from public.membership_users
          where auth_user_id=auth.uid() limit 1$$;
      create function public.membership_can(uuid,text,jsonb) returns boolean
        language sql stable as $$select exists(select 1 from public.membership_permission_fixture
          where member_id=$1 and code=$2 and effect='allow')$$;
      create function public.membership_has_explicit_deny(uuid,text,jsonb) returns boolean
        language sql stable as $$select exists(select 1 from public.membership_permission_fixture
          where member_id=$1 and code=$2 and effect='deny')$$;
      insert into public.membership_permission_fixture values(
        '00000000-0000-0000-0000-000000000099','finance.page.approvals.view','allow');
    `);
    assert.equal((await summary('mine')).ok, true);
    assert.equal((await detail('bills:B-SIGN')).ok, true);
    check('complete Membership plane with bound current allow grants both RPCs');
    await db.exec(`insert into public.membership_permission_fixture values(
      '00000000-0000-0000-0000-000000000099','finance.page.approvals.view','deny');`);
    await expectDenied(() => summary('mine'), 'explicit Membership deny wins over allow for summary');
    await expectDenied(() => detail('bills:B-SIGN'), 'explicit Membership deny wins over allow for detail');
    await expectDenied(() => legacySummary(), 'legacy actor rejects explicit Membership deny');
    await expectDenied(() => legacyDetail('bills:SAME-BATCH'), 'legacy grouped actor rejects explicit Membership deny');
    await db.exec("delete from public.membership_permission_fixture where effect='deny';");
    await db.exec("delete from public.membership_permission_fixture where effect='allow';");
    await expectDenied(() => summary('mine'), 'revoked Membership allow denies summary');
    await expectDenied(() => detail('bills:B-SIGN'), 'revoked Membership allow denies detail');
    await expectDenied(() => legacySummary(), 'legacy actor rejects revoked Membership grant');
    await expectDenied(() => legacyDetail('bills:SAME-BATCH'), 'legacy grouped actor rejects revoked Membership grant');
    await db.exec(`insert into public.membership_permission_fixture values(
      '00000000-0000-0000-0000-000000000099','finance.page.approvals.view','allow');
      update public.membership_users set legacy_finance_user_id='OTHER-USER';`);
    await expectDenied(() => summary('mine'), 'unbound Membership finance identity denies summary');
    await expectDenied(() => detail('bills:B-SIGN'), 'unbound Membership finance identity denies detail');
    await db.exec("update public.membership_users set legacy_finance_user_id='FICT-USER';");

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
    const permissionCanaryRows = await db.exec(permissionCanary);
    assert.deepEqual(permissionCanaryRows.at(-1).rows[0].personal_history_permission_canary_result, {
      canary:'readonly_personal_history_permission_v1',ok:true,rolled_back:true,
      permission_guard_preserved:true
    });
    check('permission canary verifies both guarded RPCs without production identity');
    const compatSearchRows = await db.exec(compatSearchCanary);
    assert.deepEqual(compatSearchRows.at(-1).rows[0].approval_search_canary_result, {
      canary:'readonly_approval_search_v1',ok:true,rolled_back:true,participant_scope_preserved:true
    });
    check('frontend-compatible search canary preserves semantics and checks retired RPC ACL');

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
