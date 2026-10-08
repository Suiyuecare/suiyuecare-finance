#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

const migrationPath = path.join(__dirname, '..', 'supabase', 'migrations',
  '20261008100000_finance_bill_batch_bulk_insert_v1.sql');
const migration = fs.readFileSync(migrationPath, 'utf8');
const liveBeforeSql = fs.readFileSync(path.join(__dirname, 'fixtures',
  'finance_bill_batch_live_before_20261008.sql'), 'utf8');
const guardEnd = migration.indexOf('$guard$;');
assert(guardEnd > 0, 'live-function drift guard must be present');
assert.match(migration.slice(0, guardEnd), /5ecf99368dc04b576651475c42199c8e/);
assert.match(migration.slice(0, guardEnd), /dacedbff7dc0b1a6ea7a1361951cc6bd/);
assert.match(migration, /jsonb_populate_recordset\(/);
assert.equal((migration.match(/insert into public\.bills/g) || []).length, 1);
const installSql = migration.slice(guardEnd + '$guard$;'.length);

const tenant = '11111111-1111-4111-8111-111111111111';
const otherTenant = '22222222-2222-4222-8222-222222222222';
const userId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const keyFor = n => `bill-bulk-test-${String(n).padStart(4, '0')}`;
const item = (i, overrides = {}) => ({
  client_item_key: `row-${String(i).padStart(3, '0')}`,
  entity_id: 'entity-1', department_code: 'a100',
  item: `課程繳費 ${i}`, payer_name: `繳費人 ${i}`,
  amount: String(100 + i), due_date: '2026-10-20',
  method: '轉帳', note: `第 ${i} 筆`, service_period: '2026-10',
  steps: [{ assignedUserId: 'actor-a' }],
  ...overrides,
});

async function submit(db, key, items, env = 'production') {
  const result = await db.query(
    'select public.finance_submit_bill_batch($1,$2::jsonb,$3) result',
    [key, JSON.stringify(items), env]
  );
  return result.rows[0].result;
}

async function fixture(db, install = installSql) {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create schema private;
    create function auth.uid() returns uuid language sql stable as
      'select nullif(current_setting(''test.uid'', true), '''')::uuid';
    create function public.current_tenant_id() returns uuid language sql stable as
      'select nullif(current_setting(''test.tenant'', true), '''')::uuid';
    create table public.finance_users (
      id text primary key, tenant_id uuid not null, auth_user_id uuid not null,
      active boolean not null, created_at timestamptz default now(),
      name text not null, email text not null
    );
    insert into public.finance_users(id,tenant_id,auth_user_id,active,name,email)
    values('actor-a','${tenant}','${userId}',true,'測試員工','test@suiyuecare.com');
    create table private.finance_income_document_operations (
      tenant_id uuid not null, data_environment text not null,
      operation_type text not null, idempotency_key text not null,
      request_digest text not null, actor_finance_user_id text not null,
      operation_status text not null default 'in_progress', result jsonb,
      primary key(tenant_id,data_environment,operation_type,idempotency_key)
    );
    create table private.finance_income_document_sequences (
      tenant_id uuid not null, data_environment text not null,
      series text not null, period_key text not null, last_value bigint not null,
      primary key(tenant_id,data_environment,series,period_key)
    );
    create table public.bills (
      id text primary key, no text not null unique, item text not null,
      item_key text, entity_id text not null, entity_name text not null,
      amount numeric not null, due_date date not null, method text,
      note text, status text, applicant text, applicant_id text,
      applicant_email text, department_code text,
      approval_status text, approval_step int, steps jsonb,
      payer_name text, service_period text, invoice_followup_status text,
      data_environment text not null, batch_id text, tenant_id uuid not null,
      submission_idempotency_key text,
      submission_item_key text, submission_request_digest text,
      submission_actor_finance_user_id text,
      created_at timestamptz not null default now()
    );
    create table public.business_trigger_log (bill_id text primary key, bill_no text not null);
    create table public.history_statement_log (
      statement_no int generated always as identity primary key,
      row_count int not null, batch_id text, total numeric not null
    );
    create function public.business_bill_insert() returns trigger language plpgsql as $$
    begin
      insert into public.business_trigger_log values(new.id,new.no);
      return new;
    end $$;
    create trigger business_bill_insert after insert on public.bills
      for each row execute function public.business_bill_insert();
    create function public.business_bill_guard() returns trigger language plpgsql as $$
    begin
      if new.item='ROW_TRIGGER_FAIL' then
        raise exception 'business row rejected' using errcode='23514';
      end if;
      return new;
    end $$;
    create trigger business_bill_guard before insert on public.bills
      for each row execute function public.business_bill_guard();
    create function public.history_batch_insert() returns trigger language plpgsql as $$
    declare n int; b text; total_amount numeric;
    begin
      select count(*), min(batch_id), sum(amount)
      into n,b,total_amount from new_source;
      insert into public.history_statement_log(row_count,batch_id,total)
      values(n,b,total_amount);
      return null;
    end $$;
    create trigger finance_history_projection_insert_v1 after insert on public.bills
      referencing new table as new_source for each statement
      execute function public.history_batch_insert();
    create function private.finance_income_assert_items_with_limit(p_items jsonb,p_limit int)
      returns void language plpgsql as $$
    begin
      if jsonb_typeof(p_items) is distinct from 'array'
        or jsonb_array_length(p_items) not between 1 and p_limit then
        raise exception 'batch limit' using errcode='22023';
      end if;
      if exists(select 1 from jsonb_array_elements(p_items) x
                where x->>'client_item_key' is null) then
        raise exception 'missing key' using errcode='22023';
      end if;
      if (select count(*) from jsonb_array_elements(p_items)) is distinct from
         (select count(distinct x->>'client_item_key') from jsonb_array_elements(p_items) x) then
        raise exception 'duplicate key' using errcode='23505';
      end if;
    end $$;
    create function private.finance_income_request_digest(p jsonb)
      returns text language sql immutable as 'select md5(p::text)';
    create function private.finance_income_begin_operation(
      p_tenant uuid,p_environment text,p_operation text,p_key text,
      p_digest text,p_actor text) returns jsonb language plpgsql as $$
    declare o private.finance_income_document_operations%rowtype;
    begin
      insert into private.finance_income_document_operations
        (tenant_id,data_environment,operation_type,idempotency_key,
         request_digest,actor_finance_user_id)
      values(p_tenant,p_environment,p_operation,p_key,p_digest,p_actor)
      on conflict do nothing;
      select * into o from private.finance_income_document_operations
      where tenant_id=p_tenant and data_environment=p_environment
        and operation_type=p_operation and idempotency_key=p_key for update;
      if o.actor_finance_user_id is distinct from p_actor then
        raise exception 'wrong actor' using errcode='42501';
      end if;
      if o.request_digest is distinct from p_digest then
        raise exception 'different content' using errcode='23505';
      end if;
      return o.result;
    end $$;
    create function private.finance_income_finish_operation(
      p_tenant uuid,p_environment text,p_operation text,p_key text,p_result jsonb)
      returns void language plpgsql as $$
    begin
      update private.finance_income_document_operations
      set result=p_result,operation_status='completed'
      where tenant_id=p_tenant and data_environment=p_environment
        and operation_type=p_operation and idempotency_key=p_key;
      if not found then raise exception 'operation missing'; end if;
    end $$;
    create function private.finance_income_next_number(
      p_tenant uuid,p_environment text,p_series text,p_period text)
      returns bigint language plpgsql as $$
    declare n bigint;
    begin
      insert into private.finance_income_document_sequences as s
        (tenant_id,data_environment,series,period_key,last_value)
      values(p_tenant,p_environment,p_series,p_period,1)
      on conflict(tenant_id,data_environment,series,period_key)
      do update set last_value=s.last_value+1
      returning last_value into n;
      return n;
    end $$;
    create function private.finance_income_validate_scope(
      p_tenant uuid,p_entity text,p_department text)
      returns text language plpgsql as $$
    begin
      if p_tenant<>'${tenant}'::uuid or p_entity<>'entity-1'
        or p_department<>'A100' then
        raise exception 'scope denied' using errcode='42501';
      end if;
      return '測試法人';
    end $$;
    create function private.finance_income_validate_submission_steps(
      p_steps jsonb,p_actor text,p_tenant uuid)
      returns jsonb language plpgsql as $$
    begin
      if jsonb_typeof(p_steps) is distinct from 'array'
        or p_actor<>'actor-a' or p_tenant<>'${tenant}'::uuid then
        raise exception 'invalid route' using errcode='42501';
      end if;
      return jsonb_build_object('steps',p_steps,
        'approval_status','pending','approval_step',1);
    end $$;
    select set_config('test.tenant','${tenant}',false);
    select set_config('test.uid','${userId}',false);
  `);
  await db.exec(install);
  if (install === liveBeforeSql) {
    await db.exec(`alter function public.finance_submit_bill_batch(text,jsonb,text)
      owner to postgres;
      revoke all on function public.finance_submit_bill_batch(text,jsonb,text)
        from public, anon, authenticated, service_role;
      grant execute on function public.finance_submit_bill_batch(text,jsonb,text)
        to authenticated, service_role;`);
  }
  const installed = await db.query(`select md5(prosrc) source_md5,
      prosecdef security_definer,proconfig,
      pg_get_userbyid(proowner) owner_name
    from pg_proc where oid='public.finance_submit_bill_batch(text,jsonb,text)'::regprocedure`);
  assert.equal(installed.rows[0].source_md5,install===liveBeforeSql
    ? '5ecf99368dc04b576651475c42199c8e'
    : 'cb5815484b3f90c0f4a73bf4461021d5');
  assert.equal(installed.rows[0].security_definer,true);
  assert.equal(installed.rows[0].owner_name,'postgres');
  assert(installed.rows[0].proconfig.includes('search_path=""'));
  const grants = await db.query(`select
    has_function_privilege('anon',
      'public.finance_submit_bill_batch(text,jsonb,text)','EXECUTE') anon,
    has_function_privilege('authenticated',
      'public.finance_submit_bill_batch(text,jsonb,text)','EXECUTE') authenticated,
    has_function_privilege('service_role',
      'public.finance_submit_bill_batch(text,jsonb,text)','EXECUTE') service_role`);
  assert.deepEqual(grants.rows[0],
    {anon:false, authenticated:true, service_role:true});
}

async function expectCode(task, code) {
  await assert.rejects(task, error => error.code === code,
    `expected SQLSTATE ${code}`);
}

async function main() {
  const baselineDb = new PGlite();
  let baselineResult;
  let baselineRows;
  let baselineAcl;
  try {
    await fixture(baselineDb,liveBeforeSql);
    baselineAcl=(await baselineDb.query(`select proacl::text acl from pg_catalog.pg_proc
      where oid='public.finance_submit_bill_batch(text,jsonb,text)'::regprocedure`)).rows[0].acl;
    baselineResult = await submit(baselineDb,keyFor(1),
      [item(1),item(2,{amount:'250.75'}),item(3)]);
    baselineRows = (await baselineDb.query(`select no,item,item_key,amount,due_date,
      method,note,service_period,status,invoice_followup_status,
      data_environment,approval_status,approval_step,steps,applicant,
      applicant_id,applicant_email,tenant_id,batch_id,submission_item_key
      from public.bills order by no`)).rows;
    assert.equal((await baselineDb.query('select count(*)::int n from public.business_trigger_log')).rows[0].n,3);
    assert.equal((await baselineDb.query('select count(*)::int n from public.history_statement_log')).rows[0].n,3,
      'original function inserts one statement per bill');
    const baselineLarge=await submit(baselineDb,keyFor(4),
      Array.from({length:150},(_,i)=>item(i+100)));
    assert.equal(baselineLarge.count,150);
    assert.equal((await baselineDb.query('select count(*)::int n from public.business_trigger_log')).rows[0].n,153);
    assert.equal((await baselineDb.query('select count(*)::int n from public.history_statement_log')).rows[0].n,153,
      'original 150-item request rebuilds history 150 times');
  } finally {
    await baselineDb.close();
  }
  const db = new PGlite();
  try {
    await fixture(db);
    const newAcl=(await db.query(`select proacl::text acl from pg_catalog.pg_proc
      where oid='public.finance_submit_bill_batch(text,jsonb,text)'::regprocedure`)).rows[0].acl;
    assert.equal(newAcl,baselineAcl,'RPC grant list must match the production snapshot');
    const batch = [item(1), item(2, {amount:'250.75'}), item(3)];
    const result = await submit(db, keyFor(1), batch);
    assert.deepEqual(result,baselineResult,
      'new RPC response must equal the production function for the same batch');
    assert.equal(result.ok, true);
    assert.equal(result.document_type, 'bill');
    assert.equal(result.count, 3);
    assert.equal(result.rows.length, 3);
    assert.equal(result.idempotent_replay,false);
    assert.match(result.batch_id, /^BILLB-/);
    assert.deepEqual(result.rows.map(x => x.client_item_key),
      batch.map(x => x.client_item_key));
    assert.deepEqual(result.rows.map(x => x.no.slice(-6)),
      ['000001','000002','000003']);
    const business = await db.query('select count(*)::int n from public.business_trigger_log');
    assert.equal(business.rows[0].n, 3, 'business row trigger must still run for each bill');
    const statements = await db.query('select * from public.history_statement_log');
    assert.equal(statements.rows.length, 1,
      'history statement trigger must run only once for a batch');
    assert.equal(statements.rows[0].row_count, 3);
    assert.equal(Number(statements.rows[0].total), 454.75);
    assert.equal(statements.rows[0].batch_id, result.batch_id);
    const dbRows = await db.query(`select no,item,item_key,amount,due_date,method,note,
      service_period,status,invoice_followup_status,data_environment,
      approval_status,approval_step,steps,applicant,applicant_id,applicant_email,tenant_id,batch_id,
      submission_item_key from public.bills order by no`);
    assert.equal(dbRows.rows.length, 3);
    assert.deepEqual(dbRows.rows,baselineRows,
      'new persisted business fields must equal the production function');
    assert.deepEqual(dbRows.rows.map(x => x.item),batch.map(x => x.item));
    assert.deepEqual(dbRows.rows.map(x => x.submission_item_key),
      batch.map(x => x.client_item_key));
    assert.deepEqual(dbRows.rows.map(x => Number(x.amount)),[101,250.75,103]);
    assert(dbRows.rows.every((x,i) => x.item_key === null &&
      new Date(x.due_date).toISOString().slice(0,10) === '2026-10-20' && x.method === '轉帳' &&
      x.note === `第 ${i+1} 筆` && x.service_period === '2026-10' &&
      x.status === 'unpaid' && x.invoice_followup_status === 'unreviewed' &&
      x.data_environment === 'production'),
      JSON.stringify(dbRows.rows.map(x => ({item_key:x.item_key,due_date:x.due_date,
        method:x.method,note:x.note,service_period:x.service_period,
        status:x.status,invoice_followup_status:x.invoice_followup_status,
        data_environment:x.data_environment}))));
    assert(dbRows.rows.every(x => x.applicant_id === 'actor-a' &&
      x.applicant === '測試員工' && x.applicant_email === 'test@suiyuecare.com' &&
      x.tenant_id === tenant && x.batch_id === result.batch_id &&
      x.approval_status === 'pending' && x.approval_step === 1 &&
      x.steps.length === 1));
    const operation = await db.query(`select operation_status,result from
      private.finance_income_document_operations where idempotency_key=$1`,
    [keyFor(1)]);
    assert.equal(operation.rows.length,1);
    assert.equal(operation.rows[0].operation_status,'completed');
    assert.deepEqual(operation.rows[0].result,result,
      'durable operation receipt must contain the exact successful response');
    const replay = await submit(db,keyFor(1),batch);
    assert.equal(replay.idempotent_replay,true);
    assert.deepEqual(replay.rows,result.rows);
    assert.equal((await db.query('select count(*)::int n from public.bills')).rows[0].n,3);
    assert.equal((await db.query('select count(*)::int n from public.history_statement_log')).rows[0].n,1);
    await expectCode(() => submit(db,keyFor(1),[item(1,{amount:'999'})]),'23505');

    const invalid = [item(4),item(5,{amount:'bad'})];
    await expectCode(() => submit(db,keyFor(2),invalid),'22003');
    assert.equal((await db.query('select count(*)::int n from public.bills')).rows[0].n,3);
    assert.equal((await db.query(`select count(*)::int n from
      private.finance_income_document_operations where idempotency_key=$1`,[keyFor(2)])).rows[0].n,0,
    'invalid batch must not reserve a key or create bills');
    await expectCode(() => submit(db,keyFor(8),
      [item(7),item(8,{item:'ROW_TRIGGER_FAIL'})]),'23514');
    assert.equal((await db.query('select count(*)::int n from public.bills')).rows[0].n,3);
    assert.equal((await db.query('select count(*)::int n from public.business_trigger_log')).rows[0].n,3);
    assert.equal((await db.query('select count(*)::int n from public.history_statement_log')).rows[0].n,1);
    assert.equal((await db.query(`select count(*)::int n from
      private.finance_income_document_operations where idempotency_key=$1`,[keyFor(8)])).rows[0].n,0,
    'row trigger failure must roll back bills, business side effects and idempotency state');

    const single = await submit(db,keyFor(3),[item(6)],'test');
    assert.equal(single.batch_id,null);
    assert.match(single.rows[0].no,/^TEST-BILL-/);
    assert.equal((await db.query('select count(*)::int n from public.business_trigger_log')).rows[0].n,4);
    assert.equal((await db.query('select count(*)::int n from public.history_statement_log')).rows[0].n,2);

    const large = Array.from({length:150},(_,i) => item(i+100));
    const largeResult = await submit(db,keyFor(4),large);
    assert.equal(largeResult.count,150);
    assert.equal(largeResult.rows[0].no.slice(-6),'000004',
      'failed batches must not consume committed bill numbers');
    assert.equal(largeResult.batch_id.slice(-6),'000002',
      'failed batches must not consume committed batch numbers');
    assert.equal((await db.query(`select count(*)::int n from public.bills
      where batch_id=$1`,[largeResult.batch_id])).rows[0].n,150);
    assert.equal((await db.query('select count(*)::int n from public.business_trigger_log')).rows[0].n,154);
    const largeStatement = await db.query(`select row_count from public.history_statement_log
      order by statement_no desc limit 1`);
    assert.equal(largeStatement.rows[0].row_count,150);
    assert.equal((await db.query('select count(*)::int n from public.history_statement_log')).rows[0].n,3);
    const heavy = Array.from({length:150},(_,i) =>
      item(i+300,{note:`第 ${i} 筆 ${'資料'.repeat(700)}`}));
    const heavyBytes = Buffer.byteLength(JSON.stringify(heavy));
    const heavyStarted = Date.now();
    const heavyResult = await submit(db,keyFor(9),heavy);
    const heavyMs = Date.now()-heavyStarted;
    assert(heavyBytes > 600000 && heavyBytes < 800000,
      'large input should approximate reported batch size');
    assert.equal(heavyResult.count,150);
    assert.equal((await db.query('select count(*)::int n from public.history_statement_log')).rows[0].n,4);
    assert.equal((await db.query(`select row_count from public.history_statement_log
      order by statement_no desc limit 1`)).rows[0].row_count,150);
    await expectCode(() => submit(db,keyFor(5),[...large,item(999)]),'22023');
    await db.exec(`select set_config('test.uid','',false)`);
    await expectCode(() => submit(db,keyFor(6),[item(7)]),'42501');
    await db.exec(`select set_config('test.uid','${userId}',false);
      select set_config('test.tenant','${otherTenant}',false)`);
    await expectCode(() => submit(db,keyFor(7),[item(8)]),'42501');
    await db.exec(`select set_config('test.tenant','${tenant}',false); set role anon`);
    await expectCode(() => submit(db,keyFor(10),[item(9)]),'42501');
    await db.exec('reset role; set role authenticated');
    const authenticatedResult = await submit(db,keyFor(11),[item(10)]);
    assert.equal(authenticatedResult.count,1);
    await db.exec('reset role');
    console.log(`bill batch bulk insert: PASS (live RPC parity, row triggers, one statement refresh, atomicity, idempotency, 150 rows, tenant boundary; ${heavyBytes} input bytes in ${heavyMs} ms in PGlite)`);
  } finally {
    await db.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
