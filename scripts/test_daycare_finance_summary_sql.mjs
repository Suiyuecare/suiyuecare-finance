// Runs only in an in-memory PostgreSQL WASM fixture. Never reads env DB credentials.
// Set PGLITE_MODULE_PATH to an existing pinned PGlite dist/index.js to reuse a local runtime.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createSummaryHandler } from '../supabase/functions/daycare-store-finance-summary/core.mjs';
import { createFinanceRpc } from '../supabase/functions/daycare-store-finance-summary/adapter.mjs';

const modulePath = process.env.PGLITE_MODULE_PATH;
if (!modulePath) throw new Error('Set PGLITE_MODULE_PATH to an installed PGlite dist/index.js; no network database is used.');
const { PGlite } = await import(pathToFileURL(modulePath).href);
const db = new PGlite();
let checks = 0;
const tenant = '10000000-0000-4000-8000-000000000001', otherTenant = '10000000-0000-4000-8000-000000000002';
const org = '20000000-0000-4000-8000-000000000001', branch = '20000000-0000-4000-8000-000000000002';
const binding = '30000000-0000-4000-8000-000000000001';
const unit = '40000000-0000-4000-8000-000000000001';
const migration = await readFile(new URL('../supabase/migrations/20261008193000_daycare_store_finance_summary_v1.sql', import.meta.url), 'utf8');
await db.exec(`
 create role anon; create role authenticated; create role service_role bypassrls;
 create schema private; create table public.tenants(id uuid primary key);
 insert into public.tenants values ('${tenant}'), ('${otherTenant}');
 create table public.finance_department_units (
 tenant_id uuid not null, id uuid primary key, code text not null,
 primary_entity_code text not null, active boolean not null,
 is_posting_unit boolean not null, present_in_source boolean not null);
 create table public.finance_department_entity_scopes (
 tenant_id uuid not null, unit_id uuid not null, entity_code text not null,
 active boolean not null, present_in_source boolean not null);
 insert into public.finance_department_units values ('${tenant}','${unit}','J1101','E6',true,true,true);
 insert into public.finance_department_entity_scopes values ('${tenant}','${unit}','E6',true,true);
 create table public.ledger_entries (
 id bigint generated always as identity primary key, tenant_id uuid not null, data_environment text not null,
 entity_id text, department_code text, entry_date date not null, account_code text,
 debit numeric(14,2), credit numeric(14,2), voided_at timestamptz);
 alter table public.ledger_entries enable row level security;
 grant usage on schema public to anon, authenticated, service_role;
 grant select on public.ledger_entries to service_role;
 grant select on public.finance_department_units, public.finance_department_entity_scopes to service_role;
 begin; ${migration} commit;
 insert into private.finance_daycare_summary_bindings_v1 values (
 '${binding}','${tenant}','${org}','${branch}','E6','測試店','J1101',
 'department_direct_only','synthetic-review', '${org}', now() - interval '1 hour', now() + interval '1 day', '2026-07-01', true);
 insert into public.ledger_entries (tenant_id,data_environment,entity_id,department_code,entry_date,account_code,debit,credit) values
 ('${tenant}','production','E6','J1101','2026-09-01','4101',0,100.25),
 ('${tenant}','production','E6','J1101','2026-09-30','7101',0,20.00),
 ('${tenant}','production','E6','J1101','2026-09-02','4101',5.25,0),
 ('${tenant}','production','E6','C1100','2026-09-03','5101',30.50,0),
 ('${tenant}','production','E6','J1101','2026-09-03','6101',1.25,0),
 ('${tenant}','production','E6','J1101','2026-09-03','9101',3.00,0),
 ('${tenant}','production','E6','J1101','2026-09-03','6101',0,2.00),
 ('${tenant}','production','E6','J1101','2026-09-03','1112',100,0),
 ('${tenant}','production','E6',null,'2026-09-03','6101',888,0),
 ('${tenant}','production','E2','C1100','2026-09-01','4101',0,999),
 ('${tenant}','test','E6','J1101','2026-09-01','4101',0,999),
 ('${otherTenant}','production','E6','J1101','2026-09-01','4101',0,999),
 ('${tenant}','production','E6','J1101','2026-08-31','4101',0,999),
 ('${tenant}','production','E6','J1101','2026-10-01','4101',0,999);
`);
const sql = "select public.finance_daycare_store_summary_v1($1::uuid,$2::uuid,$3::uuid,$4::text) as result";
async function summary(month = '2026-09', organization = org, requestedBranch = branch, requestedBinding = binding) {
  await db.exec('set role service_role');
  try { return (await db.query(sql, [requestedBinding, organization, requestedBranch, month])).rows[0].result; }
  finally { await db.exec('reset role'); }
}
async function check(name, callback) { await callback(); checks++; console.log(`PASS ${name}`); }
try {
  await check('direct E6/J1101 month excludes C1100, unallocated costs, other tenant/env/entity and date', async () => {
    const result = await summary();
    assert.equal(result.income, '115.00'); assert.equal(result.expenses, '2.25'); assert.equal(result.entry_count, 7);
    assert.equal(result.binding_id, binding); assert.equal(result.entity_id, 'E6');
    assert.equal(result.department_code, 'J1101'); assert.equal(result.scope_basis, 'department_direct_only');
    assert.equal(result.organization_id, org); assert.equal(result.branch_id, branch);
    assert.equal(result.currency, 'TWD'); assert.equal(result.basis, 'finance_pnl_ledger'); assert.equal(result.month, '2026-09');
    assert.ok(result.generated_at);
    assert.deepEqual(Object.keys(result).sort(), ['basis','binding_id','branch_id','currency','department_code','entity_id','entity_name','entry_count','expenses','generated_at','income','month','organization_id','scope_basis','status']);
  });
  await check('covered empty month is zero, but months before verified coverage are unavailable', async () => {
    const r = await summary('2026-07'); assert.equal(r.income, '0.00'); assert.equal(r.expenses, '0.00'); assert.equal(r.entry_count, 0);
    assert.equal((await summary('2026-06')).error_code, 'FINANCE_SCOPE_NOT_VERIFIED');
  });
  await check('cross-organization/branch/binding rejected', async () => {
    for (const args of [['2026-09', branch], ['2026-09', org, org], ['2026-09', org, branch, org]]) {
      assert.equal((await summary(...args)).error_code, 'FINANCE_SCOPE_NOT_VERIFIED');
    }
  });
  await check('invalid month rejected', async () => {
    for (const month of ['2026-13', '2026-9', '1999-01', '2201-01', "2026-09';select 1"]) await assert.rejects(() => summary(month));
  });
  for (const role of ['anon','authenticated']) await check(`${role} cannot execute aggregate or read binding`, async () => {
    await db.exec(`set role ${role}`);
    try {
      await assert.rejects(() => db.query(sql, [binding, org, branch, '2026-09']), { code: '42501' });
      await assert.rejects(() => db.query('select * from private.finance_daycare_summary_bindings_v1'), { code: '42501' });
    } finally { await db.exec('reset role'); }
  });
  await check('service cannot modify binding or ledger through new grants', async () => {
    await db.exec('set role service_role');
    try {
      await assert.rejects(() => db.exec('update private.finance_daycare_summary_bindings_v1 set active=false'), { code: '42501' });
      await assert.rejects(() => db.exec('delete from public.ledger_entries'), { code: '42501' });
    } finally { await db.exec('reset role'); }
  });
  await check('disabled and expired/revoked binding blocked', async () => {
    await db.exec('update private.finance_daycare_summary_bindings_v1 set active=false');
    assert.equal((await summary()).error_code, 'FINANCE_SCOPE_NOT_VERIFIED');
    await db.exec("update private.finance_daycare_summary_bindings_v1 set active=true,valid_until=now()-interval '1 minute'");
    assert.equal((await summary()).error_code, 'FINANCE_SCOPE_NOT_VERIFIED');
    await db.exec("update private.finance_daycare_summary_bindings_v1 set valid_until=now()+interval '1 day'");
  });
  await check('inactive or mismatched canonical posting unit fails closed', async () => {
    await db.exec(`update public.finance_department_units set active=false where id='${unit}'`);
    assert.equal((await summary()).error_code, 'FINANCE_SCOPE_NOT_VERIFIED');
    await db.exec(`update public.finance_department_units set active=true where id='${unit}'`);
    await db.exec(`update public.finance_department_entity_scopes set entity_code='E2' where unit_id='${unit}'`);
    assert.equal((await summary()).error_code, 'FINANCE_SCOPE_NOT_VERIFIED');
    await db.exec(`update public.finance_department_entity_scopes set entity_code='E6' where unit_id='${unit}'`);
  });
  await check('same-department row without entity blocks rather than undercounts', async () => {
    await db.exec(`insert into public.ledger_entries (tenant_id,data_environment,entity_id,department_code,entry_date,account_code,debit,credit)
      values ('${tenant}','production',null,'J1101','2026-09-02','4101',0,25)`);
    assert.equal((await summary()).error_code, 'FINANCE_SCOPE_INCOMPLETE');
    await db.exec('delete from public.ledger_entries where entity_id is null');
  });
  await check('same-department row with another entity blocks instead of cross-company mixing', async () => {
    await db.exec(`insert into public.ledger_entries (tenant_id,data_environment,entity_id,department_code,entry_date,account_code,debit,credit)
      values ('${tenant}','production','E2','J1101','2026-09-02','4101',0,25)`);
    assert.equal((await summary()).error_code, 'FINANCE_SCOPE_INCOMPLETE');
    await db.exec("delete from public.ledger_entries where entity_id='E2' and department_code='J1101'");
  });
  await check('incomplete amount or account in direct department blocks false totals', async () => {
    await db.exec(`insert into public.ledger_entries (tenant_id,data_environment,entity_id,department_code,entry_date,account_code,debit,credit)
      values ('${tenant}','production','E6','J1101','2026-09-04',null,null,3)`);
    assert.equal((await summary()).error_code, 'FINANCE_SCOPE_INCOMPLETE');
    await db.exec("delete from public.ledger_entries where entry_date='2026-09-04' and department_code='J1101'");
  });
  await check('voided direct entries are excluded; reversals remain signed ledger entries', async () => {
    await db.exec("update public.ledger_entries set voided_at=now() where credit=100.25");
    assert.equal((await summary()).income, '14.75');
    await db.exec("update public.ledger_entries set voided_at=null where credit=100.25");
  });
  await check('Finance rowsFromMap account-group threshold is preserved, never applied per line', async () => {
    await db.exec(`insert into public.ledger_entries (tenant_id,data_environment,entity_id,department_code,entry_date,account_code,debit,credit) values
      ('${tenant}','production','E6','J1101','2026-11-01','4101',0,0.25),
      ('${tenant}','production','E6','J1101','2026-11-01','4101',0,0.25),
      ('${tenant}','production','E6','J1101','2026-11-01','4102',0,0.40),
      ('${tenant}','production','E6','J1101','2026-11-01','7101',0.41,0),
      ('${tenant}','production','E6','J1101','2026-11-01','6101',0.40,0),
      ('${tenant}','production','E6','J1101','2026-11-01','6102',0,0.41)`);
    const result = await summary('2026-11');
    assert.equal(result.income, '0.09'); assert.equal(result.expenses, '-0.41'); assert.equal(result.entry_count, 6);
  });
  await check('STABLE invoker function, no definer elevation, RLS enforced on binding', async () => {
    const r = (await db.query("select provolatile,prosecdef from pg_proc where oid='public.finance_daycare_store_summary_v1(uuid,uuid,uuid,text)'::regprocedure")).rows[0];
    assert.equal(r.provolatile, 's'); assert.equal(r.prosecdef, false);
    const t = (await db.query("select relrowsecurity,relforcerowsecurity from pg_class where oid='private.finance_daycare_summary_bindings_v1'::regclass")).rows[0];
    assert.equal(t.relrowsecurity, true); assert.equal(t.relforcerowsecurity, true);
  });
  await check('complete synthetic HTTP handler -> fixed REST adapter -> real SQL aggregate -> whitelisted response', async () => {
    const token = '1234567890abcdef'.repeat(4);
    const env = name => ({ FINANCE_DAYCARE_SUMMARY_TOKEN: token, FINANCE_DAYCARE_SUMMARY_BINDING_ID: binding,
      FINANCE_DAYCARE_SUMMARY_TOKEN_EXPIRES_AT: new Date(Date.now() + 86400000).toISOString(),
      SUPABASE_URL: 'https://aaaaaaaaaaaaaaaaaaaa.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-only' })[name];
    let calls = 0;
    const rpc = createFinanceRpc({ env, fetchImpl: async (url, options) => {
      assert.equal(url, 'https://aaaaaaaaaaaaaaaaaaaa.supabase.co/rest/v1/rpc/finance_daycare_store_summary_v1');
      calls++;
      const p = JSON.parse(options.body);
      return Response.json(await summary(p.p_month, p.p_organization_id, p.p_branch_id, p.p_binding_id));
    } });
    const handle = createSummaryHandler({ env, rpc });
    const response = await handle(new Request('https://aaaaaaaaaaaaaaaaaaaa.supabase.co/functions/v1/daycare-store-finance-summary', {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ request_id: binding, organization_id: org, branch_id: branch, month: '2026-09' }),
    }));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.request_id, binding); assert.equal(body.binding_id, binding);
    assert.equal(body.department_code, 'J1101'); assert.equal(body.scope_basis, 'department_direct_only');
    assert.equal(body.income, '115.00'); assert.equal(body.expenses, '2.25'); assert.equal(calls, 1);
  });
  console.log(`PASS ${checks} SQL scenarios (synthetic PGlite only, not live Supabase)`);
} finally { await db.close(); }
