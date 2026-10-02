#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

const migration = fs.readFileSync(path.join(__dirname, '..',
  'supabase/migrations/20261002130327_finance_income_reconcile_submission_v1.sql'), 'utf8');
const postflight = fs.readFileSync(path.join(__dirname,
  'finance_income_reconcile_postflight.sql'), 'utf8').replace(/^\\set[^\n]*\n/gm, '');
const canary = fs.readFileSync(path.join(__dirname,
  'finance_income_reconcile_canary.sql'), 'utf8').replace(/^\\set[^\n]*\n/gm, '');
const guardEnd = migration.indexOf('$guard$;');
assert(guardEnd > 0, 'production drift guard missing');
assert.match(migration.slice(0, guardEnd), /bbf7e2d060c8de355e5ff375f52a80e9/);
// The drift guard is checked against the live production helper separately.
// This isolated fixture exercises the unmodified DDL and function definitions.
const install = migration.slice(guardEnd + '$guard$;'.length);
const tenant = '11111111-1111-4111-8111-111111111111';
const userA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const userB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

async function one(db, type, key, env = 'production') {
  const rows = await db.query(
    'select public.finance_income_reconcile_submission_v1($1,$2,$3) result',
    [type, key, env]
  );
  return rows.rows[0].result;
}
async function expectCode(work, code) {
  await assert.rejects(work, error => error.code === code,
    `expected SQLSTATE ${code}`);
}
async function main() {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema auth; create schema private;
      create function auth.uid() returns uuid language sql stable as
        'select nullif(current_setting(''test.uid'', true), '''')::uuid';
      create table public.finance_users (
        id text primary key, tenant_id uuid not null, auth_user_id uuid not null,
        active boolean not null, created_at timestamptz not null default now()
      );
      create function public.current_tenant_id() returns uuid language sql stable as
        'select nullif(current_setting(''test.tenant'', true), '''')::uuid';
      create function public.current_finance_user() returns public.finance_users
        language sql stable as 'select fu from public.finance_users fu
          where fu.auth_user_id=auth.uid() and fu.tenant_id=public.current_tenant_id()
            and fu.active and current_setting(''test.session'',true)=''active''
          limit 1';
      create table private.finance_income_document_operations (
        tenant_id uuid not null, data_environment text not null,
        operation_type text not null, idempotency_key text not null,
        request_digest text not null, actor_finance_user_id text not null,
        operation_status text not null default 'in_progress', result jsonb,
        created_at timestamptz not null default now(), completed_at timestamptz,
        constraint finance_income_document_operations_pkey primary key
          (tenant_id, data_environment, operation_type, idempotency_key),
        constraint finance_income_document_operations_operation_status_check
          check (operation_status in ('in_progress','completed'))
      );
      create table public.invoices (
        tenant_id uuid not null, data_environment text not null,
        submission_idempotency_key text, submission_item_key text
      );
      create table public.bills (
        tenant_id uuid not null, data_environment text not null,
        submission_idempotency_key text, submission_item_key text
      );
      create function private.finance_income_request_digest(jsonb) returns text
        language sql immutable as 'select repeat(''a'',64)';
      insert into public.finance_users(id,tenant_id,auth_user_id,active)
      values ('actor-a','${tenant}','${userA}',true),
             ('actor-b','${tenant}','${userB}',true);
      select set_config('test.tenant','${tenant}',false);
      select set_config('test.uid','${userA}',false);
      select set_config('test.session','active',false);
    `);
    await db.exec(install);
    await db.exec(postflight);
    await db.exec("select set_config('test.uid','',false)");
    await db.exec(canary);
    await db.exec(`select set_config('test.uid','${userA}',false)`);
    const key = 'invoice-retry-0001';
    assert.equal((await one(db, 'invoice', key)).state, 'confirmed_not_committed');
    const tombstone = await db.query(`select operation_status from
      private.finance_income_document_operations where idempotency_key=$1`, [key]);
    assert.equal(tombstone.rows[0].operation_status, 'canceled');
    await expectCode(() => db.query(`select private.finance_income_begin_operation(
      $1::uuid,'production','invoice_submit',$2,repeat('b',64),'actor-a')`,
    [tenant, key]), '55000');
    assert.equal((await one(db, 'invoice', key)).state, 'confirmed_not_committed');

    const completedKey = 'invoice-committed-0002';
    const result = {ok:true, document_type:'invoice', idempotency_key:completedKey,
      rows:[{id:'document-1', item_key:'item-1'}]};
    await db.query(`insert into private.finance_income_document_operations
      (tenant_id,data_environment,operation_type,idempotency_key,request_digest,
      actor_finance_user_id,operation_status,result) values
      ($1,'production','invoice_submit',$2,repeat('b',64),'actor-a','completed',$3::jsonb)`,
    [tenant, completedKey, JSON.stringify(result)]);
    assert.deepEqual(await one(db, 'invoice', completedKey),
      {ok:true, state:'committed', result});
    await expectCode(() => db.query(`select private.finance_income_begin_operation(
      $1::uuid,'production','invoice_submit',$2,repeat('b',64),'actor-b')`,
    [tenant, completedKey]), '42501');

    const pendingKey = 'bill-in-progress-0003';
    await db.query(`insert into private.finance_income_document_operations
      (tenant_id,data_environment,operation_type,idempotency_key,request_digest,
      actor_finance_user_id) values
      ($1,'production','bill_submit',$2,repeat('b',64),'actor-a')`, [tenant,pendingKey]);
    assert.equal((await one(db, 'bill', pendingKey)).state, 'pending');
    const orphanKey = 'invoice-orphan-0004';
    await db.query(`insert into public.invoices values($1,'production',$2,'item-1')`,
      [tenant, orphanKey]);
    assert.equal((await one(db, 'invoice', orphanKey)).state, 'pending');
    assert.equal((await db.query(`select count(*)::int n from
      private.finance_income_document_operations where idempotency_key=$1`,
    [orphanKey])).rows[0].n, 0);

    await db.exec(`select set_config('test.uid','${userB}',false)`);
    await expectCode(() => one(db, 'invoice', completedKey), '42501');
    await db.exec(`select set_config('test.uid','${userA}',false);
      select set_config('test.tenant','22222222-2222-4222-8222-222222222222',false)`);
    await expectCode(() => one(db, 'invoice', completedKey), '42501');
    await db.exec(`select set_config('test.tenant','${tenant}',false)`);
    await db.exec(`select set_config('test.session','revoked',false)`);
    await expectCode(() => one(db, 'invoice', completedKey), '42501');
    await expectCode(() => one(db, 'invoice', 'invoice-revoked-0005'), '42501');
    assert.equal((await db.query(`select count(*)::int n from
      private.finance_income_document_operations where idempotency_key='invoice-revoked-0005'`)).rows[0].n, 0);
    await db.exec(`select set_config('test.session','active',false)`);
    assert.equal((await one(db, 'invoice', completedKey, 'test')).state,
      'confirmed_not_committed', 'test and production keys remain isolated');
    await db.exec('set role authenticated');
    assert.equal((await one(db, 'invoice', completedKey)).state, 'committed');
    await db.exec('reset role; set role anon');
    await expectCode(() => one(db, 'invoice', completedKey), '42501');
    await db.exec('reset role');
    await db.exec(`select set_config('test.uid','',false)`);
    await expectCode(() => one(db, 'invoice', 'invoice-auth-0005'), '42501');
    console.log('income reconciliation migration integration: PASS');
  } finally {
    await db.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
