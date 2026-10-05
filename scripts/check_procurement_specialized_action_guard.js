#!/usr/bin/env node
'use strict';
// Offline executable PostgreSQL regression. Executes reviewed production RPC,
// direct-update trigger, file ownership and audit helpers. Directory/permission
// and operation-journal dependencies use explicit fixture doubles; this does not
// claim a full production schema, browser, or live-role integration test.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const migration = read('supabase/migrations/20261005035438_procurement_specialized_action_guard_v1.sql');
const snapshot = read('scripts/fixtures/finance_procurement_specialized_action_20261005.sql');
const helpers = read('scripts/fixtures/finance_procurement_action_helpers_20261005.sql');
const previousHelpers = read('scripts/fixtures/finance_procurement_payment_helpers_20260908.sql');
function extract(sql, name) {
  const start = sql.indexOf('CREATE OR REPLACE FUNCTION private.' + name + '(');
  assert(start >= 0, name);
  const end = sql.indexOf('$function$;', sql.indexOf('AS $function$', start));
  assert(end > start, name + ' end');
  return sql.slice(start, end + '$function$;'.length);
}
const tenant = '00000000-0000-0000-0000-000000000001';
const actorAuth = '00000000-0000-0000-0000-000000000002';
const time = '2026-10-05T00:00:00.000Z';
const signature = 'public.finance_expense_act_active_step(text[],text,text,text,jsonb,text,jsonb,jsonb,text)';
let passed = 0;
const check = (name, predicate = true) => { assert(predicate, name); passed++; console.log('ok ' + passed + ' - ' + name); };
const json = JSON.stringify;
const copy = value => JSON.parse(JSON.stringify(value));
const db = new PGlite();
const schema = `
create schema private; create schema auth; create schema extensions; create schema storage;
create role anon; create role authenticated; create role service_role;
create function extensions.digest(bytea,text) returns bytea language sql immutable as
 $$ select case when $2='sha256' then pg_catalog.sha256($1) else null end $$;
create table public.finance_users(id text,tenant_id uuid,auth_user_id uuid,name text,email text,role text,active boolean,created_at timestamptz);
insert into public.finance_users values
 ('audit','${tenant}','${actorAuth}','Audit','audit@example.invalid','general_affairs',true,now()),
 ('target','${tenant}','00000000-0000-0000-0000-000000000003','Target','target@example.invalid','manager',true,now());
create table public.expense_requests(
 id text primary key,no text,tenant_id uuid,data_environment text,applicant_id text,entity_id text,department_code text,type text,
 amount numeric,estimated_amount numeric,actual_amount numeric,actual_files jsonb,files jsonb,steps jsonb,form_payload jsonb,
 status text,step integer,ver integer,updated_at timestamptz,payee text,bank_type text,bank_name text,bank_branch text,
 bank_no text,expected_pay_date date,bank_account text,fee_bearer text,bank_fee_amount numeric,
 debit_account text,debit_account_name text,credit_account text,credit_account_name text,
 posting_locked_at timestamptz,voided_at timestamptz,ledger_posted_at timestamptz,voucher_id text,cash_posted_at timestamptz);
create table public.system_settings(tenant_id uuid,key text,value jsonb);
create table public.file_attachments(tenant_id uuid,bucket_id text,storage_path text,record_type text,record_no text,data_environment text,uploaded_by text,file_name text,file_type text);
create table storage.objects(bucket_id text,name text);
create table private.test_operations(key text primary key,digest text,result jsonb);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('audit.uid',true),'')::uuid $$;
create function auth.jwt() returns jsonb language sql stable as $$ select '{"role":"authenticated"}'::jsonb $$;
create function public.current_tenant_id() returns uuid language sql stable as $$ select '${tenant}'::uuid $$;
-- Authorization fixture doubles are deliberately deny-capable, scoped to exact assignee.
create function private.finance_expense_actor_can_act(uuid,public.expense_requests,integer,jsonb,text,text,text) returns boolean language sql as
 $$ select $2.tenant_id=$1 and $4->>'uid'=$5 and coalesce($4->>'a','')='' $$;
create function private.finance_expense_optional_permission_allows(uuid,text,text,jsonb) returns boolean language sql as
 $$ select coalesce(current_setting('audit.permission',true),'true')<>'false' $$;
create function private.finance_income_request_digest(jsonb) returns text language sql immutable as $$ select md5($1::text) $$;
create function private.finance_income_begin_operation(uuid,text,text,text,text,text) returns jsonb language plpgsql as $$
 declare r private.test_operations%rowtype; begin
 select * into r from private.test_operations where key=$4;
 if found then
   if r.digest<>$5 then raise exception 'conflicting operation' using errcode='23505'; end if;
   return r.result;
 end if;
 insert into private.test_operations values($4,$5,null); return null;
 end $$;
create function private.finance_income_finish_operation(uuid,text,text,text,jsonb) returns void language sql as
 $$ update private.test_operations set result=$5 where key=$4 $$;
grant usage on schema public,auth to authenticated;
grant select,update on public.expense_requests to authenticated;
alter table public.expense_requests enable row level security;
create policy test_tenant on public.expense_requests to authenticated using(tenant_id=public.current_tenant_id());
`;
function record(id, role = 'procurement_receipt', extras = {}) {
  return { id, no: id, tenant_id: tenant, data_environment: 'test', applicant_id: 'applicant',
    entity_id: 'entity', department_code: 'department', type: 'purchase_request', amount: 100,
    estimated_amount: 100, actual_amount: null, actual_files: [], files: [], form_payload: {},
    status: 'pending_procurement', step: 2, ver: 1, updated_at: time,
    steps: [
      { rk: 'manager', uid: 'prior', a: 'approved', n: 'Prior', files: [], status: 'pending_approval' },
      { rk: role, uid: 'audit', a: '', n: '', files: [], status: 'pending_procurement' },
      { rk: 'accountant_final', uid: 'accountant', a: '', n: '', files: [], status: 'pending_voucher' },
    ], ...extras };
}
async function insert(r) {
  await db.query(`insert into public.expense_requests select * from jsonb_populate_record(null::public.expense_requests,$1::jsonb)`, [json(r)]);
}
async function get(id) { return (await db.query('select to_jsonb(r) as r from public.expense_requests r where id=$1', [id])).rows[0].r; }
async function expected(ids) {
  const result = {};
  for (const id of ids) {
    const r = await get(id), index = r.steps.findIndex(s => !s.a), s = r.steps[index];
    result[id] = { active_step_index: index, role_key: s.rk, finance_user_id: s.uid,
      email: s.email || '', status: r.status, step: r.step, ver: r.ver, updated_at: r.updated_at };
  }
  return result;
}
let operation = 0;
async function call(ids, action, options = {}) {
  const exp = options.expected || await expected(ids);
  // session_user must be authenticated: postgres would bypass the real trigger.
  await db.exec('set session authorization authenticated');
  try {
    return (await db.query('select public.finance_expense_act_active_step($1::text[],$2,$3,$4,$5::jsonb,$6,$7::jsonb,$8::jsonb,$9) as result',
      [ids, action, options.key || 'operation-' + (++operation), 'fixture comment', json(options.files || []),
        action === 'add_sign' ? 'target' : null, json(exp), '{}', options.environment || 'test'])).rows[0].result;
  } finally { await db.exec('set session authorization postgres'); }
}
async function denied(name, task, code, detail) {
  let error;
  try { await task(); } catch (e) { error = e; }
  assert(error, name + ' must reject');
  assert.equal(error.code, code, name + ': ' + error.message);
  if (detail) assert.equal(error.detail, detail);
  check(name);
}
async function metadata() {
  return (await db.query(`select proacl::text as acl,prosecdef,proconfig,pg_get_userbyid(proowner) as owner from pg_proc where oid=$1::regprocedure`, [signature])).rows[0];
}
async function migrate() {
  await db.exec('begin');
  try { await db.exec(migration); await db.exec('commit'); }
  catch (e) { await db.exec('rollback'); throw e; }
}
const file = id => ({ bucket: 'finance-attachments', path: 'receipts/' + id + '.pdf', dataEnv: 'test', name: 'receipt.pdf' });
async function register(id, f, owner = 'audit', options = {}) {
  await db.query(`insert into public.file_attachments values($1,'finance-attachments',$2,'expense_requests',$3,$4,$5,'receipt.pdf','application/pdf')`,
    [options.tenant || tenant, f.path, options.no || id, options.environment || 'test', owner]);
  if (!options.missingStorage) await db.query('insert into storage.objects values($1,$2)', ['finance-attachments', f.path]);
}
async function directReceipt(id, f, change = {}) {
  const r = await get(id), next = copy(r);
  // Construct the exact audit shape via the production append helper.
  const amended = (await db.query(`select private.finance_income_append_step_action($1::jsonb,'audit','Audit','簽核通過','', $2::jsonb) as s`, [json(r.steps[1]), json([f])])).rows[0].s;
  next.steps[1] = { ...amended, a: 'approved' };
  next.status = 'pending_voucher'; next.step = 3; next.actual_amount = 100;
  next.actual_files = [...r.actual_files, f];
  next.form_payload = { ...r.form_payload, accountingLinesNeedReview: true,
    accountingLinesInvalidatedReason: '總務確認實際憑據，待会計覆核',
    purchaseActual: { actualAmount: 100, submittedBy: 'Audit', stage: 'procurement_actual_receipt', files: next.actual_files },
    procurementReceiptInfo: { actualAmount: 100, submittedBy: 'Audit', fileCount: 1 } };
  Object.assign(next, change);
  await db.exec('set session authorization authenticated');
  try {
    await db.query(`update public.expense_requests set steps=$2::jsonb,status=$3,step=$4,actual_amount=$5,actual_files=$6::jsonb,form_payload=$7::jsonb where id=$1`,
      [id,json(next.steps),next.status,next.step,next.actual_amount,json(next.actual_files),json(next.form_payload)]);
  } finally { await db.exec('set session authorization postgres'); }
}
async function main() {
  await db.exec(schema);
  for (const name of ['finance_income_active_step_index','finance_income_step_role','finance_income_step_user_id','finance_expense_action_log_is_valid','finance_expense_is_exact_step_transition']) {
    await db.exec(extract(previousHelpers, name));
  }
  await db.exec(helpers); await db.exec(snapshot);
  await db.exec(`revoke all on function ${signature} from public; grant execute on function ${signature} to authenticated;
    create trigger expense_guard before update on public.expense_requests for each row execute function private.finance_expense_guard_direct_update();`);
  await db.query("select set_config('audit.uid',$1,false)", [actorAuth]);

  for (const action of ['approve', 'add_sign']) {
    const id = 'before-' + action;
    await insert(record(id));
    const result = await call([id], action), row = await get(id);
    check('baseline reproduces ' + action + ' bypass without actual receipt', result.ok && row.steps[1].a === 'approved' && row.actual_amount === null && row.actual_files.length === 0);
  }
  const security = await metadata();
  const guardBefore = (await db.query("select prosrc from pg_proc where oid='private.finance_expense_guard_direct_update()'::regprocedure")).rows[0].prosrc;
  await migrate();
  assert.deepEqual(await metadata(), security);
  check('migration preserves owner, ACL, security definer and empty search_path');
  check('specialized direct-update guard unchanged', guardBefore === (await db.query("select prosrc from pg_proc where oid='private.finance_expense_guard_direct_update()'::regprocedure")).rows[0].prosrc);

  for (const role of ['procurement_payment', 'procurement_receipt', 'procurement_review']) {
    for (const action of ['approve', 'add_sign']) {
      const id = role + '-' + action; await insert(record(id, role)); const before = await get(id);
      const key = 'blocked-' + id;
      await denied(role + ' rejects generic ' + action, () => call([id], action, { key }), '55000', 'PROCUREMENT_SPECIALIZED_SUBMISSION_REQUIRED');
      assert.deepEqual(await get(id), before);
      check(role + '/' + action + ' leaves all data and operation journal unchanged', (await db.query('select count(*)::int as n from private.test_operations where key=$1',[key])).rows[0].n === 0);
    }
    for (const action of ['return', 'reject']) {
      const id = role + '-' + action; await insert(record(id, role));
      const result = await call([id], action), row = await get(id);
      check(role + ' preserves ' + action, result.ok && (action === 'return' ? !row.steps[0].a && row.step === 1 : row.status === 'rejected'));
    }
  }
  const readyFile = file('ready-receipt');
  await insert(record('ready-receipt','procurement_receipt',{ actual_amount:100, actual_files:[readyFile] }));
  await register('ready-receipt',readyFile);
  await denied('existing receipt fields do not enable generic approval of a dedicated gate',
    () => call(['ready-receipt'],'approve',{files:[readyFile]}), '55000', 'PROCUREMENT_SPECIALIZED_SUBMISSION_REQUIRED');
  await insert(record('withdraw','procurement_payment',{applicant_id:'audit'}));
  check('eligible applicant withdrawal remains available', (await call(['withdraw'],'withdraw')).ok && (await get('withdraw')).status==='cancelled');
  await insert(record('normal', 'manager')); check('ordinary purchase approval remains available', (await call(['normal'], 'approve')).ok);
  await insert(record('other-type','procurement_receipt',{type:'payment_request'}));
  check('new guard is scoped only to purchase_request', (await call(['other-type'],'approve')).ok);
  await insert(record('normal-countersign','manager'));
  check('ordinary countersign remains available', (await call(['normal-countersign'],'add_sign')).ok);
  await insert(record('a-bulk-normal','manager')); await insert(record('z-bulk-procurement'));
  const bulkBefore = await get('a-bulk-normal');
  await denied('mixed batch is rejected atomically', () => call(['a-bulk-normal','z-bulk-procurement'],'approve'), '55000', 'PROCUREMENT_SPECIALIZED_SUBMISSION_REQUIRED');
  assert.deepEqual(await get('a-bulk-normal'), bulkBefore); check('earlier normal batch row rolled back');

  await insert(record('stale')); const stale = await expected(['stale']); stale.stale.ver = 0;
  await denied('stale version still rejects before special-gate validation', () => call(['stale'],'approve',{expected:stale}), '40001');
  await db.query("select set_config('audit.uid','',false)");
  await denied('anonymous actor remains denied', () => call(['stale'],'approve'), '42501');
  await db.query("select set_config('audit.uid',$1,false)",[actorAuth]);
  await db.exec("update public.finance_users set active=false where id='audit'");
  await denied('disabled actor remains denied', () => call(['stale'],'approve'), '42501');
  await db.exec("update public.finance_users set active=true where id='audit'");
  await insert(record('other-tenant','procurement_receipt',{tenant_id:'00000000-0000-0000-0000-000000000009'}));
  await denied('cross tenant remains denied', () => call(['other-tenant'],'approve'), 'P0002');
  await denied('cross environment remains denied', () => call(['stale'],'approve',{environment:'production'}), 'P0002');
  await db.query("select set_config('audit.permission','false',false)");
  await denied('explicit approval denial remains effective', () => call(['stale'],'approve'), '42501');
  await db.query("select set_config('audit.permission','true',false)");
  const wrong = record('wrong-assignee'); wrong.steps[1].uid='another'; await insert(wrong);
  await denied('wrong assignee remains denied', () => call(['wrong-assignee'],'approve'), '42501');
  await insert(record('cash-posted','procurement_receipt',{cash_posted_at:time}));
  await denied('existing post-disbursement rejection restriction remains', () => call(['cash-posted'],'reject'), '55000');

  const reused = file('reuse'), r = record('reuse'); r.steps[0].files=[reused]; await insert(r); await register('reuse',reused);
  await directReceipt('reuse',reused);
  check('specialized receipt accepts current actor existing payment attachment without new upload', (await get('reuse')).actual_files[0].path === reused.path && (await get('reuse')).status === 'pending_voucher');
  for (const mode of ['foreign-owner','foreign-record','foreign-tenant','foreign-environment','missing-storage']) {
    const f=file(mode); await insert(record(mode));
    const options = mode==='foreign-record'?{no:'different-request'}:mode==='foreign-tenant'?{tenant:'00000000-0000-0000-0000-000000000009'}:mode==='foreign-environment'?{environment:'production'}:mode==='missing-storage'?{missingStorage:true}:{};
    await register(mode,f,mode==='foreign-owner'?'different-actor':'audit',options);
    await denied('specialized receipt refuses ' + mode, () => directReceipt(mode,f), '42501');
    check(mode + ' did not advance workflow', (await get(mode)).status==='pending_procurement');
  }
  const missingAmount = file('missing-amount'); await insert(record('missing-amount')); await register('missing-amount',missingAmount);
  await denied('specialized receipt still requires actual amount', () => directReceipt('missing-amount',missingAmount,{actual_amount:null}), '23514');
  const missingFile = file('missing-file'); await insert(record('missing-file')); await register('missing-file',missingFile);
  await denied('specialized receipt still requires appended actual evidence', () => directReceipt('missing-file',missingFile,{actual_files:[]}), '23514');

  const postflight = await db.exec(read('scripts/sql/procurement_specialized_action_postflight.sql'));
  check('read-only postflight matches reviewed RPC source and unchanged trigger', postflight[0].rows[0].matches_reviewed_patch && postflight[1].rows[0].direct_update_guard_unchanged);
  await denied('migration refuses unexpected source / repeated patch instead of fuzzy replacement', migrate, 'P0001');
  console.log(JSON.stringify({ ok: true, assertions: passed, mode: 'offline PGlite; synthetic identities; no production writes' }));
}
main().catch(error => { console.error(error); process.exitCode=1; }).finally(() => db.close());
