'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const tenant = '00000000-0000-0000-0000-000000000001';
const otherTenant = '00000000-0000-0000-0000-000000000002';
const sources = ['expense_requests', 'bills', 'invoices'];
const migrationPath = 'supabase/migrations/20260913042629_finance_statement_source_page_v1.sql';
const migration = () => fs.readFileSync(path.join(root, migrationPath), 'utf8');
async function createStatementSourceFixture(db, { install = true, seed = true } = {}) {
  await db.exec(`
    create role authenticated; create role anon; create role service_role;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    create table auth.users(id uuid primary key);
    create table auth.identities(id uuid primary key default gen_random_uuid(), user_id uuid, provider text, identity_data jsonb, created_at timestamptz default now());
    create table public.tenants(id uuid primary key, slug text);
    create table public.tenant_members(id uuid primary key default gen_random_uuid(),tenant_id uuid,auth_user_id uuid,email text,active boolean,created_at timestamptz default now());
    create table public.finance_users(id text primary key,tenant_id uuid,auth_user_id uuid,email text,name text,role text,department_code text,active boolean default true,google_link_status text default 'bound',created_at timestamptz default now());
    insert into public.tenants values('${tenant}','suiyuecare'),('${otherTenant}','fictional-other');
  `);
  for (const source of sources) await db.exec(`
    create table public.${source} (
      id text primary key, tenant_id uuid, data_environment text default 'production',
      applicant text, applicant_id text, applicant_email text, department_code text,
      type text, steps jsonb default '[]', form_payload jsonb default '{}',
      amount numeric, files jsonb default '[]', created_at timestamptz default now()
    );
  `);
  await db.exec(fs.readFileSync(path.join(root, 'scripts/fixtures/finance_statement_source_authority_20260913.sql'), 'utf8'));
  for (const [source, helper] of [['expense_requests','can_read_expense_request'],['bills','can_read_bill'],['invoices','can_read_invoice']]) await db.exec(`
    alter table public.${source} enable row level security;
    create policy ${source}_select_fixture on public.${source} for select to authenticated
      using (tenant_id = public.current_tenant_id() and public.${helper}(${source}.*));
    grant select on public.${source} to authenticated;
  `);
  await db.exec(`grant usage on schema public,auth to authenticated; grant execute on all functions in schema public,auth to authenticated;`);
  const roles = ['employee','accountant','ceo','admin_director','dept_manager','section_chief','hr','general_affairs','external_audit','board','inactive','unverified'];
  const actors = {};
  for (const [i, role] of roles.entries()) {
    const uid = `10000000-0000-0000-0000-${String(i + 1).padStart(12, '0')}`;
    const actor = actors[role] = { id: 'fictional-' + role, uid, name: 'Fictional ' + role, email: 'fixture-' + role + '@suiyuecare.com' };
    await db.query('insert into auth.users values($1)', [uid]);
    await db.query(`insert into auth.identities(user_id,provider,identity_data) values($1,'google',$2)`, [uid, JSON.stringify({ email: actor.email, email_verified: role !== 'unverified' })]);
    await db.query('insert into public.finance_users(id,tenant_id,auth_user_id,email,name,role,department_code,active) values($1,$2,$3,$4,$5,$6,$7,$8)', [actor.id, tenant, uid, actor.email, actor.name, role, 'D1', role !== 'inactive']);
    await db.query('insert into public.tenant_members(tenant_id,auth_user_id,email,active) values($1,$2,$3,true)', [tenant, uid, actor.email]);
  }
  if (seed) {
    const employee = actors.employee;
    const records = [
      ['01-own', { applicant: employee.name, applicant_id: employee.id, applicant_email: employee.email, form_payload: { applicantProfile: { id: employee.id, email: employee.email }, originalAmount: 12.5 }, amount: '12.50', files: [{ name: 'anonymous.pdf', path: 'fictional/path.pdf' }] }],
      ['02-other', { applicant: 'Other fictional person', applicant_id: 'other-person', department_code: 'D2' }],
      ['03-department', { department_code: 'D1' }],
      ['04-participant', { steps: [{ uid: employee.id, status: 'approved' }] }],
      ['05-role', { steps: [{ roleKey: 'external_audit' }] }],
      ['06-action', { steps: [{ actionLog: [{ actorFinanceUserId: employee.id, status: 'approved' }] }] }],
      ['07-welfare', { type: 'welfare_request' }],
      ['08-purchase', { type: 'purchase_request' }],
      ['09-email', { applicant_email: employee.email, form_payload: { applicantProfile: { email: employee.email } } }],
      ['10-test', { data_environment: 'test', applicant_id: employee.id, form_payload: { applicantProfile: { id: employee.id } } }],
      ['11-other-tenant', { tenant_id: otherTenant, applicant_id: employee.id, form_payload: { applicantProfile: { id: employee.id } } }],
      ['12-action-impostor', { steps: [{ actions: [{ actorFinanceUserId: 'not-employee', name: employee.name }] }] }]
    ];
    for (const source of sources) for (const [id, patch] of records) {
      const row = { id, tenant_id: tenant, data_environment: 'production', ...patch };
      const keys = Object.keys(row);
      await db.query(`insert into public.${source}(${keys.join(',')}) values(${keys.map((_, i) => '$' + (i + 1)).join(',')})`, keys.map(k => row[k] && typeof row[k] === 'object' ? JSON.stringify(row[k]) : row[k]));
    }
  }
  if (install) await db.exec(migration());
  return { actors, tenant, otherTenant };
}
async function asActor(db, actor, work, requestedTenant = '') {
  await db.exec('begin');
  try {
    await db.query(`select set_config('request.jwt.claim.sub',$1,true),set_config('app.current_tenant_id',$2,true)`, [actor ? actor.uid : '', requestedTenant]);
    await db.exec('set local role authenticated');
    return await work();
  } finally { await db.exec('rollback'); }
}
module.exports = { createStatementSourceFixture, asActor, tenant, otherTenant, sources, migration, migrationPath };
