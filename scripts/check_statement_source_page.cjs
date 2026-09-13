'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const { createStatementSourceFixture, asActor, tenant, otherTenant, sources, migration } = require('./fixtures/finance_statement_source_fixture.cjs');
let checks = 0;
const check = (condition, message) => { assert.ok(condition, message); checks++; };
const equal = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
async function rejects(fn, code, message) { await assert.rejects(fn, e => e.code === code, message); checks++; }
async function page(db, source, limit = 1000, offset = 0, environment = 'production') {
  return (await db.query('select public.finance_statement_source_page_v1($1,$2,$3,$4) as result', [source, environment, limit, offset])).rows[0].result;
}
async function main() {
  const db = new PGlite();
  const { actors } = await createStatementSourceFixture(db);
  const expected = {
    employee: ['01-own','04-participant','06-action','09-email'],
    accountant: ['01-own','02-other','03-department','04-participant','05-role','06-action','07-welfare','08-purchase','09-email','12-action-impostor'],
    dept_manager: ['03-department'], section_chief: ['03-department'],
    hr: ['07-welfare'], general_affairs: ['08-purchase'], external_audit: ['05-role'], board: []
  };
  expected.ceo = expected.admin_director = expected.accountant;
  for (const role of Object.keys(expected)) for (const source of sources) {
    await asActor(db, actors[role], async () => {
      const wanted = expected[role].filter(id => !(role === 'employee' && id === '09-email' && source === 'invoices') && !(source !== 'expense_requests' && ['07-welfare','08-purchase'].includes(id) && ['hr','general_affairs'].includes(role)));
      const direct = (await db.query(`select to_jsonb(s) as row from public.${source} s where tenant_id=$1 and data_environment='production' order by id`, [tenant])).rows.map(r => r.row);
      equal(direct.map(r => r.id), wanted, `${role}/${source}: actual existing RLS matches the intended synthetic authority matrix`);
      const first = await page(db, source, 2);
      equal(first.rows, direct.slice(0, 2), `${role}/${source}: page preserves every source column, payload and file metadata`);
      equal({ total: first.total, tenant: first.tenantId, environment: first.dataEnvironment, more: first.hasMore }, { total: direct.length, tenant, environment: 'production', more: direct.length > 2 }, `${role}/${source}: exact authorized count and server scope`);
      const all = [...first.rows];
      for (let offset = 2; offset < direct.length; offset += 2) {
        const next = await page(db, source, 2, offset);
        equal(next.total, direct.length, `${role}/${source}: later page count unchanged`);
        all.push(...next.rows);
      }
      equal(all, direct, `${role}/${source}: complete stable pages, no duplicate or omitted rows`);
      const beyond = await page(db, source, 2, 100);
      equal([beyond.total, beyond.rows, beyond.hasMore], [direct.length, [], false], `${role}/${source}: empty page retains exact count`);
    });
  }
  for (const source of sources) await asActor(db, actors.employee, async () => {
    const result = await page(db, source, 1000, 0, 'test');
    equal(result.rows.map(r => r.id), ['10-test'], source + ': test environment never includes production or other tenant');
  });
  for (const [label, actor] of [['anonymous', null], ['inactive', actors.inactive], ['unverified', actors.unverified]]) {
    await rejects(() => asActor(db, actor, () => page(db, 'invoices')), '42501', label + ' has no paging authority');
  }
  await rejects(() => asActor(db, actors.accountant, () => page(db, 'invoices'), otherTenant), '42501', 'requesting a non-member tenant cannot widen scope');
  for (const args of [[null,'production',10,0],['finance_users','production',10,0],["invoices;select 1",'production',10,0],['invoices',null,10,0],['invoices','all',10,0],['invoices','production',0,0],['invoices','production',1001,0],['invoices','production',10,-1],['invoices','production',null,0],['invoices','production',10,null]]) {
    await rejects(() => asActor(db, actors.employee, () => db.query('select public.finance_statement_source_page_v1($1,$2,$3,$4)', args)), '22023', 'invalid source/environment/pagination fails closed');
  }
  const meta = (await db.query(`select p.prosecdef,p.provolatile,p.proconfig,r.rolname as owner,
    has_function_privilege('authenticated',p.oid,'execute') as browser,
    has_function_privilege('anon',p.oid,'execute') as anonymous,
    has_function_privilege('service_role',p.oid,'execute') as service
    from pg_proc p join pg_roles r on r.oid=p.proowner where p.oid='public.finance_statement_source_page_v1(text,text,integer,integer)'::regprocedure`)).rows[0];
  equal(meta, { prosecdef:false, provolatile:'s', proconfig:['search_path=""'], owner:'postgres', browser:true, anonymous:false, service:false }, 'catalog: invoker, stable, fixed search_path and explicit browser-only ACL');
  const postflight = fs.readFileSync(path.join(__dirname,'finance_statement_source_postflight.sql'),'utf8').replace(/^\\set ON_ERROR_STOP on\n/,'');
  await db.exec('begin read only');
  await db.exec(postflight);
  await db.exec('rollback');
  checks++;
  await db.exec('begin;alter function public.finance_statement_source_page_v1(text,text,integer,integer) security definer');
  await rejects(() => db.exec(postflight), 'P0001', 'postflight rejects privilege escalation');
  await db.exec('rollback');
  await db.exec('begin;grant execute on function public.finance_statement_source_page_v1(text,text,integer,integer) to anon');
  await rejects(() => db.exec(postflight), 'P0001', 'postflight rejects accidentally public API');
  await db.exec('rollback');
  await db.exec('begin;alter table public.invoices disable row level security');
  await rejects(() => db.exec(postflight), 'P0001', 'postflight rejects disabled source RLS');
  await db.exec('rollback');
  for (const role of ['anon','service_role']) {
    await db.exec(`begin;set local role ${role}`);
    try { await rejects(() => page(db, 'invoices'), '42501', role + ' cannot execute this browser RPC'); } finally { await db.exec('rollback'); }
  }
  // More than one maximum-sized page. All rows still pass actual production
  // identity and invoice RLS helpers; this is not a fake always-true permission.
  await db.query(`insert into public.invoices(id,tenant_id,data_environment,amount)
    select 'bulk-'||lpad(n::text,4,'0'),$1,'test',n/100.0 from generate_series(1,1005) n`, [tenant]);
  await asActor(db, actors.accountant, async () => {
    const a = await page(db, 'invoices', 1000, 0, 'test'), b = await page(db, 'invoices', 1000, 1000, 'test');
    equal([a.total,a.rows.length,a.hasMore,b.total,b.rows.length,b.hasMore], [1006,1000,true,1006,6,false], 'maximum page boundary: accurate total and final page');
    equal(new Set([...a.rows,...b.rows].map(r => r.id)).size, 1006, 'full scan across pages is complete and unique');
  });
  // Prove work eliminated without changing any production authorization helper.
  // A separate RLS table counts visibility evaluations through a sequence;
  // the source RPC uses the same existing policy in old and new reads.
  await db.exec(`create sequence public.visibility_probe;
    create function public.statement_test_probe() returns boolean language plpgsql volatile as $$begin perform nextval('public.visibility_probe');return true;end$$;
    grant usage,select,update on sequence public.visibility_probe to authenticated;
    alter policy invoices_select_fixture on public.invoices using (tenant_id=public.current_tenant_id() and public.can_read_invoice(invoices.*) and public.statement_test_probe());`);
  await asActor(db, actors.accountant, async () => {
    await db.query(`select setval('public.visibility_probe',1,false)`);
    const old = (await db.query(`with old_page as (select * from public.invoices where tenant_id=$1 and data_environment='test' order by id limit 1000)
      select (select count(*) from public.invoices where tenant_id=$1 and data_environment='test') as total,(select jsonb_agg(to_jsonb(p)) from old_page p) as rows`, [tenant])).rows[0];
    const oldWork = Number((await db.query(`select last_value from public.visibility_probe`)).rows[0].last_value);
    await db.query(`select setval('public.visibility_probe',1,false)`);
    const result = await page(db, 'invoices', 1000, 0, 'test');
    const newWork = Number((await db.query(`select last_value from public.visibility_probe`)).rows[0].last_value);
    equal([result.total,result.rows.map(r => r.id)], [Number(old.total),old.rows.map(r => r.id)], 'materialization changes no visible result or total');
    check(oldWork >= 2006 && newWork === 1006 && newWork < oldWork, `one visibility evaluation per candidate: old=${oldWork}, new=${newWork}`);
  });
  await db.close();
  const rollbackDb = new PGlite();
  await createStatementSourceFixture(rollbackDb, { install:false,seed:false });
  const fingerprint = async () => (await rollbackDb.query(`select md5(string_agg(x::text,'' order by x::text)) as hash from (
    select jsonb_build_object('definition',pg_get_functiondef(p.oid)) as x from pg_proc p where p.pronamespace in ('public'::regnamespace,'auth'::regnamespace)
    union all select to_jsonb(p) from pg_policy p) data`)).rows[0].hash;
  const before = await fingerprint();
  await rollbackDb.exec('begin'); await rollbackDb.exec(migration()); await rollbackDb.exec('rollback');
  equal((await rollbackDb.query(`select to_regprocedure('public.finance_statement_source_page_v1(text,text,integer,integer)') as fn`)).rows[0].fn, null, 'migration rollback removes new function');
  equal(await fingerprint(), before, 'migration rollback leaves every old function and policy unchanged');
  await rollbackDb.close();
  console.log(JSON.stringify({ok:true,checks,authority:'Actual catalog identity + three existing SELECT RLS helper definitions; fictional actors only',productionWrites:0}));
}
if (require.main === module) main().catch(e => { console.error(e);process.exitCode=1; });
module.exports = { main };
