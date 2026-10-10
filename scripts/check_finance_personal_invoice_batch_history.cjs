#!/usr/bin/env node
'use strict';
// Synthetic PostgreSQL contract: batch grouping must never broaden history access.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const { createSummarySearchFixture, addSummarySearchDocument, fixtureIdentity: who } = require('./check_approval_history_summary.cjs');
const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const baseMigration = read('supabase/migrations/20261008055528_finance_personal_document_history_v1.sql');
const permissionMigration = read('supabase/migrations/20261008090000_finance_personal_history_permission_guard_v1.sql');
const migration = read('supabase/migrations/20261010130000_finance_personal_invoice_batch_history_v1.sql');
const identityMigration = read('supabase/migrations/20260922133752_finance_document_identity_attachment_scope_v1.sql');
const identityStart = identityMigration.indexOf('create function public.finance_legacy_name_matches_current_v1');
const identityEnd = identityMigration.indexOf('revoke all on function public.finance_legacy_name_matches_current_v1', identityStart);
const helperFixture = read('scripts/fixtures/finance_procurement_payment_helpers_20260908.sql')
  .match(/CREATE OR REPLACE FUNCTION private\.finance_expense_optional_permission_allows\([\s\S]*?\$function\$;/)[0];

async function main() {
  const db = new PGlite();
  let checks = 0;
  const check = message => { checks++; console.log('PASS ' + message); };
  const summary = async (scope='all', limit=50, offset=0, search=null, env='test') =>
    (await db.query('select public.finance_personal_document_summary_v1($1,$2,$3,$4,$5) result',
      [scope, limit, offset, search, env])).rows[0].result;
  const detail = async (key, env='test') =>
    (await db.query('select public.finance_personal_document_detail_v1($1,$2) result',
      [key, env])).rows[0].result;
  const add = async (table, id, options={}) => addSummarySearchDocument(db,
    { table, id, description: id+' 虛構發票', ...options });
  const ids = item => item.source_ids.slice().sort();
  try {
    await createSummarySearchFixture(db);
    await db.exec(`
      alter table public.finance_users add column name text, add column role text default 'employee';
      create table public.system_settings(tenant_id uuid not null,key text not null,value jsonb not null,primary key(tenant_id,key));
      alter table public.expense_requests add column applicant_id text,add column applicant_email text;
      alter table public.bills add column applicant_id text,add column applicant_email text;
      alter table public.invoices add column applicant_id text;
      alter table public.approval_step_actor_snapshots add column raw_step jsonb;
      update public.finance_users set name='虛構本人' where id='FICT-USER';
      create function public.current_finance_user_id() returns text language sql stable as
        $$select id from public.finance_users where auth_user_id=auth.uid() and active=true limit 1$$;
      create function public.current_tenant_id() returns uuid language sql stable as
        $$select tenant_id from public.finance_users where auth_user_id=auth.uid() and active=true limit 1$$;
      create function public.finance_current_verified_google_email_v2() returns text language sql stable as
        $$select public.finance_verified_google_email(auth.uid())$$;
      create schema supabase_migrations;
      create table supabase_migrations.schema_migrations(version text primary key,statements text[],name text,created_by text);
      insert into supabase_migrations.schema_migrations(version,name) values
        ('20260915050313','finance_approval_history_summary_v1'),
        ('20260922133752','finance_document_identity_attachment_scope_v1');
    `);
    await db.exec(identityMigration.slice(identityStart, identityEnd));
    await db.exec(baseMigration);
    await db.exec(`insert into supabase_migrations.schema_migrations(version,name)
      values ('20261008055528','finance_personal_document_history_v1');`);
    await db.exec(helperFixture);
    await db.exec(permissionMigration);
    await db.exec(`insert into supabase_migrations.schema_migrations(version,name)
      values ('20261008090000','finance_personal_history_permission_guard_v1');`);
    const sourceHashes = () => db.query(`select
      md5((select prosrc from pg_proc where oid='public.finance_personal_document_summary_v1(text,integer,integer,text,text)'::regprocedure)) summary,
      md5((select prosrc from pg_proc where oid='public.finance_personal_document_detail_v1(text,text)'::regprocedure)) detail`);
    console.log('BEFORE_PROSRC '+JSON.stringify((await sourceHashes()).rows[0]));

    for (let n=1; n<=18; n++) {
      const id='CPR-'+String(n).padStart(2,'0');
      await add('invoices', id, {batch:'CPR-BATCH',amount:100+n,total:100+n,
        description: n===18 ? 'CPR 最後一張可搜尋' : 'CPR 同批發票'});
      await db.query('update public.invoices set applicant_id=$1 where id=$2',['FICT-USER',id]);
    }
    for (let n=1; n<=13; n++) {
      const id='DEMENTIA-'+String(n).padStart(2,'0');
      await add('invoices', id, {batch:'DEMENTIA-BATCH',amount:200+n,total:200+n,
        description:'失智同批發票'});
      await db.query('update public.invoices set applicant_id=$1 where id=$2',['FICT-USER',id]);
    }
    await add('invoices','CPR-SECRET',{batch:'CPR-BATCH',amount:99999,total:99999,
      description:'禁止查詢之秘密發票',participant:false});
    await add('invoices','CPR-FOREIGN',{batch:'CPR-BATCH',amount:99999,total:99999,
      tenantId:who.otherTenantId,description:'其他租戶秘密發票',participant:false});
    await add('invoices','CPR-PROD',{batch:'CPR-BATCH',amount:99999,total:99999,
      environment:'production',description:'正式環境秘密發票',participant:false});
    await add('invoices','I-SINGLE',{amount:77,total:77});
    await add('bills','B-SINGLE',{batch:'CPR-BATCH',amount:5});
    await add('expense_requests','R-SINGLE',{amount:7});

    const before = await summary('mine');
    assert.equal(before.items.filter(row => row.record_type==='invoices').length,31);
    await db.exec('begin;'+migration+'rollback;');
    assert.equal((await summary('mine')).items.filter(row => row.record_type==='invoices').length,31);
    check('migration rehearsal rolls back without changing personal history');
    await db.exec(migration);
    await db.exec(`insert into supabase_migrations.schema_migrations(version,name)
      values ('20261010130000','finance_personal_invoice_batch_history_v1');`);
    console.log('AFTER_PROSRC '+JSON.stringify((await sourceHashes()).rows[0]));

    const all = await summary('all');
    const mine = await summary('mine');
    assert.equal(all.total,5);
    assert.equal(all.all_total,5);
    assert.equal(mine.total,2);
    assert.equal(mine.all_total,2);
    assert.equal(all.items.length,5);
    assert.equal(mine.items.length,2);
    const cpr = all.items.find(row => row.record_type==='invoices' && row.batch_id==='CPR-BATCH');
    const dementia = all.items.find(row => row.record_type==='invoices' && row.batch_id==='DEMENTIA-BATCH');
    assert.equal(cpr.source_count,18);
    assert.equal(dementia.source_count,13);
    assert.equal(cpr.summary.amount,18*100+171);
    assert.equal(dementia.summary.amount,13*200+91);
    assert.equal(cpr.summary.source_count,18);
    assert.equal(cpr.history_key,'invoices:CPR-01');
    assert.equal(cpr.source_ids.length,18);
    assert(!ids(cpr).includes('CPR-SECRET'));
    assert(!ids(cpr).includes('CPR-FOREIGN'));
    assert(!ids(cpr).includes('CPR-PROD'));
    check('18+13 invoice rows become two exact authorized groups with full amounts');
    assert.equal(all.items.find(row => row.record_id==='I-SINGLE').source_count,1);
    assert.equal(all.items.find(row => row.record_id==='B-SINGLE').source_count,1);
    assert.equal(all.items.find(row => row.record_id==='R-SINGLE').source_count,1);
    check('single invoices, bills, and expense requests retain one-row behavior');
    assert.equal((await summary('all',50,0,'最後一張可搜尋')).total,1);
    assert.equal((await summary('all',50,0,'秘密發票')).total,0);
    assert.equal((await summary('all',1,0)).items.length,1);
    assert.equal((await summary('all',1,4)).items.length,1);
    assert.equal((await summary('all',1,5)).items.length,0);
    check('group search and pagination see authorized members only');

    const cprDetail = (await detail(cpr.history_key)).item;
    assert.equal(cprDetail.source_rows.length,18);
    assert.equal(cprDetail.source_count,18);
    assert.equal(cprDetail.summary.amount,cpr.summary.amount);
    assert.deepEqual(ids(cprDetail),ids(cpr));
    assert(!JSON.stringify(cprDetail).includes('CPR-SECRET'));
    assert(!JSON.stringify(cprDetail).includes('CPR-FOREIGN'));
    assert(!JSON.stringify(cprDetail).includes('CPR-PROD'));
    await assert.rejects(() => detail('invoices:CPR-SECRET'), error => error.code==='42501');
    check('detail freshly authorizes all 18 members and denies hidden sibling');

    await db.exec("update public.invoices set applicant_id=null where id='CPR-18';"+
      "update public.approval_step_actor_snapshots set acted_by_user_id=null,resolved_user_id='OTHER-USER' where record_id='CPR-18';");
    const reduced = await summary('mine');
    assert.equal(reduced.items.find(row => row.record_type==='invoices' && row.batch_id==='CPR-BATCH').source_count,17);
    assert.equal((await detail(cpr.history_key)).item.source_count,17);
    check('revoked source participation disappears from list and detail immediately');
    await db.exec("update public.finance_users set active=false where id='FICT-USER';");
    await assert.rejects(() => summary('mine'), error => error.code==='42501');
    await assert.rejects(() => detail(cpr.history_key), error => error.code==='42501');
    check('disabled user cannot read grouped history');

    console.log('INVOICE_BATCH_PERSONAL_HISTORY_CHECKS='+checks);
  } finally { await db.close(); }
}
main().catch(error => { console.error(error); process.exitCode=1; });
