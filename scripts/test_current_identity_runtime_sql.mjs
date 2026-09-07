// Runs the actual new migration inside isolated PGlite fixtures. This is not
// a production Supabase/Auth/RLS end-to-end acceptance test.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const migration = fs.readFileSync(fileURLToPath(new URL('../supabase/migrations/20260907154758_finance_current_identity_runtime_repair_v1.sql', import.meta.url)), 'utf8');
const db = new PGlite();
const actorA = '10000000-0000-0000-0000-000000000001';
const actorB = '10000000-0000-0000-0000-000000000002';
const tenantA = '20000000-0000-0000-0000-000000000001';
const tenantB = '20000000-0000-0000-0000-000000000002';
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create table public.fixture_auth_users(id uuid primary key,email text,verified boolean,disabled boolean default false);
  create table public.finance_users(id text primary key,tenant_id uuid,auth_user_id uuid,email text,name text,
    role text,role_label text,entity_id text,department_code text,active boolean,google_link_status text);
  create table public.companies(id uuid primary key,code text,tax_id text,status text default 'active',deleted_at timestamptz);
  create table public.departments(id uuid primary key,company_id uuid,code text,status text default 'active',deleted_at timestamptz);
  create table public.system_settings(tenant_id uuid,key text,value jsonb);
  create table public.tenant_members(id uuid primary key default gen_random_uuid(),tenant_id uuid,auth_user_id uuid,
    finance_user_id text,email text,name text,role text,role_label text,entity_id text,department_code text,active boolean,updated_at timestamptz);
  create unique index member_finance_active on public.tenant_members(tenant_id,finance_user_id) where active=true;
  create unique index member_auth_active on public.tenant_members(tenant_id,auth_user_id) where active=true;
  create unique index member_email_active on public.tenant_members(tenant_id,lower(email)) where active=true;
  create table public.employee_department_roles(id text primary key,tenant_id uuid,finance_user_id text,department_id uuid,
    department_code text,role_key text,role_type text,relation_type text,is_primary boolean,effective_from date,effective_to date,
    active boolean,is_department_manager boolean,is_department_director boolean,can_approve boolean,
    direct_supervisor_finance_user_id text,approval_delegate_finance_user_id text,permissions_override jsonb,metadata jsonb,created_at timestamptz,updated_at timestamptz);
  create unique index primary_active on public.employee_department_roles(tenant_id,finance_user_id) where active=true and is_primary=true;
  create table public.module_audit_logs(table_name text,row_id text,action text,actor_email text,before_data jsonb,after_data jsonb);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
  create function public.finance_verified_google_email(p_id uuid) returns text language sql stable security definer set search_path='' as $$
    select lower(btrim(email)) from public.fixture_auth_users where id=p_id and verified and not disabled and email like '%@suiyuecare.com' $$;
  create function public.current_tenant_id() returns uuid language sql stable as $$
    select nullif(current_setting('app.current_tenant_id',true),'')::uuid $$;
  create function public.current_finance_user() returns public.finance_users language sql stable security definer set search_path='' as $$
    select fu from public.finance_users fu where fu.tenant_id=public.current_tenant_id()
      and fu.auth_user_id=auth.uid() and fu.active and fu.google_link_status in ('bound','pending_rebind')
      and lower(btrim(fu.email))=public.finance_verified_google_email(auth.uid()) $$;
  create function public.finance_stable_setting_id(prefix text,value text) returns text language sql immutable as $$ select prefix || '_' || value $$;
  insert into public.companies(id,code,tax_id) values('30000000-0000-0000-0000-000000000001','E1','12345678');
  insert into public.departments(id,company_id,code) values('40000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','A1000');
`);
// The release runner owns the surrounding transaction for the whole batch.
await db.exec('begin;\n' + migration + '\ncommit;');
async function login(actor = actorA, tenant = tenantA, role = 'authenticated') {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('app.current_tenant_id',$2,false)", [actor, tenant]);
  await db.exec(`set role ${role}`);
}
async function seed() {
  await db.exec('reset role; truncate public.fixture_auth_users,public.finance_users,public.tenant_members,public.employee_department_roles,public.module_audit_logs,public.system_settings;');
  await db.query(`insert into public.system_settings values($1,'entities','[{"id":"E1","taxId":"12345678"}]')`, [tenantA]);
  await db.query('insert into public.fixture_auth_users(id,email,verified) values($1,$2,true),($3,$4,true)', [actorA, 'a@suiyuecare.com', actorB, 'b@suiyuecare.com']);
  await db.query(`insert into public.finance_users values
    ('employee-a',$1,$2,'a@suiyuecare.com','Employee A','employee','員工','E1','A1000',true,'bound'),
    ('employee-b',$3,$4,'b@suiyuecare.com','Employee B','employee','員工','E1','A1000',true,'bound')`, [tenantA, actorA, tenantB, actorB]);
  await login();
}
async function invoke() { return (await db.query('select public.finance_repair_current_identity_runtime_v1() result')).rows[0].result; }
async function sql(query, args = []) { await db.exec('reset role'); return (await db.query(query, args)).rows; }
async function denied(label, run = invoke) {
  await assert.rejects(run, error => error.code === '42501', label);
  assert.equal((await sql('select count(*)::integer n from public.employee_department_roles'))[0].n, 0, `${label}: no assignment side effects`);
}
try {
  await seed();
  const repaired = await invoke();
  assert.equal(repaired.ok, true); assert.equal(repaired.tenant_members_created, 1); assert.equal(repaired.employee_roles_created, 1);
  const [role] = await sql('select * from public.employee_department_roles');
  assert.equal(role.finance_user_id, 'employee-a'); assert.equal(role.tenant_id, tenantA);
  assert.equal(role.can_approve, false); assert.equal(role.is_department_manager, false); assert.equal(role.is_department_director, false);
  assert.equal(role.direct_supervisor_finance_user_id, null); assert.equal(role.approval_delegate_finance_user_id, null);
  assert.deepEqual(role.permissions_override, {});
  const [audit] = await sql('select * from public.module_audit_logs');
  assert.equal(audit.action, 'SELF_IDENTITY_RUNTIME_REPAIR'); assert.equal(audit.before_data.actor_auth_user_id, actorA);
  await login(); const again = await invoke();
  assert.equal(again.tenant_members_created, 0); assert.equal(again.employee_roles_created, 0);
  assert.equal((await sql('select count(*)::integer n from public.module_audit_logs'))[0].n, 1, 'idempotent repair audit');
  console.log('PASS SQL A03: missing own projections repaired idempotently, audited, no manager/approval/delegate grants');

  await seed(); await login(''); await denied('missing auth');
  await seed(); await login('10000000-0000-0000-0000-000000000099'); await denied('unknown auth');
  await seed(); await login(actorA, tenantB); await denied('cross tenant');
  await seed(); await sql("update public.finance_users set active=false where id='employee-a'"); await login(); await denied('inactive Finance user');
  await seed(); await sql('update public.fixture_auth_users set disabled=true where id=$1', [actorA]); await login(); await denied('disabled auth identity');
  await seed(); await sql('update public.fixture_auth_users set verified=false where id=$1', [actorA]); await login(); await denied('unverified Google identity');
  await seed(); await sql("update public.finance_users set auth_user_id=$1 where id='employee-a'", [actorB]); await login(); await denied('UUID binding mismatch');
  await seed(); await login(actorA, tenantA, 'anon'); await denied('anonymous role has no execute grant');
  await seed(); await login(actorA, tenantA, 'service_role'); await denied('service role has no execute grant');
  console.log('PASS SQL A03: missing/wrong UUID, cross tenant, disabled/unverified identities and anonymous/service invocation denied');

  await seed();
  await sql(`insert into public.tenant_members(tenant_id,auth_user_id,finance_user_id,email,active) values($1,$2,'employee-a','a@suiyuecare.com',false)`, [tenantA, actorA]);
  await login(); assert.equal((await invoke()).requires_management_review, true, 'revoked membership requires management');
  assert.equal((await sql('select active from public.tenant_members'))[0].active, false);
  await seed();
  await sql(`insert into public.tenant_members(tenant_id,auth_user_id,finance_user_id,email,active) values($1,$2,'other-person','a@suiyuecare.com',true)`, [tenantA, actorB]);
  await login(); assert.equal((await invoke()).requires_management_review, true, 'membership collision requires management');
  await seed();
  await sql(`insert into public.employee_department_roles(id,tenant_id,finance_user_id,is_primary,active,can_approve) values('revoked',$1,'employee-a',true,false,false)`, [tenantA]);
  await login(); const revoked = await invoke();
  assert.equal(revoked.ok, false); assert.equal(revoked.requires_management_review, true);
  assert.equal((await sql('select active from public.employee_department_roles'))[0].active, false);
  await seed(); await sql("update public.finance_users set role='ceo' where id='employee-a'"); await login();
  const privileged = await invoke(); assert.equal(privileged.requires_management_review, true);
  assert.equal((await sql('select count(*)::integer n from public.employee_department_roles'))[0].n, 0);
  console.log('PASS SQL A03: revoked rows and privileged missing assignments require authorized review; no self-reactivation');
  await seed(); await sql('delete from public.system_settings'); await login();
  assert.equal((await invoke()).requires_management_review, true, 'no approved company mapping must not guess by code');
  assert.equal((await sql('select count(*)::integer n from public.employee_department_roles'))[0].n, 0);
  await seed(); await sql('update public.system_settings set tenant_id=$1', [tenantB]); await login();
  assert.equal((await invoke()).requires_management_review, true, 'other tenant same company code is not own mapping');
  await seed();
  await sql(`insert into public.companies(id,code,tax_id) values('30000000-0000-0000-0000-000000000099','E1','12345678')`);
  await login(); assert.equal((await invoke()).requires_management_review, true, 'duplicate company mapping is not arbitrarily chosen');
  await sql("delete from public.companies where id='30000000-0000-0000-0000-000000000099'");
  await seed();
  await sql(`insert into public.departments(id,company_id,code) values('40000000-0000-0000-0000-000000000099','30000000-0000-0000-0000-000000000001','A1000')`);
  await login(); assert.equal((await invoke()).requires_management_review, true, 'duplicate department mapping is not arbitrarily chosen');
  console.log('PASS SQL A03: missing/cross-tenant legal entity mapping and duplicate companies/departments fail closed');
  await sql("delete from public.departments where id='40000000-0000-0000-0000-000000000099'");
  for (const assignment of [
    {role:'employee',department:'A1000',from:'current_date + 1',to:'null'},
    {role:'employee',department:'A1000',from:'current_date - 10',to:'current_date - 1'},
    {role:'ceo',department:'A1000',from:'current_date',to:'null'},
    {role:'employee',department:'OTHER',from:'current_date',to:'null'}
  ]) {
    await seed();
    await sql(`insert into public.employee_department_roles(id,tenant_id,finance_user_id,is_primary,active,role_key,department_code,effective_from,effective_to,can_approve,direct_supervisor_finance_user_id)
      values('admin-owned',$1,'employee-a',true,true,$2,$3,${assignment.from},${assignment.to},true,'existing-supervisor')`,[tenantA,assignment.role,assignment.department]);
    const before=await sql('select * from public.employee_department_roles');
    await login();assert.equal((await invoke()).requires_management_review,true);
    assert.deepEqual(await sql('select * from public.employee_department_roles'),before,'future/expired/mismatched assignment is retained exactly');
  }
  await seed();
  await sql(`insert into public.tenant_members(tenant_id,auth_user_id,finance_user_id,email,active,role,entity_id,department_code)
    values($1,$2,'employee-a','a@suiyuecare.com',true,'ceo','E1','A1000')`,[tenantA,actorA]);
  const existingMembership=await sql('select * from public.tenant_members');
  await login();assert.equal((await invoke()).requires_management_review,true);
  assert.deepEqual(await sql('select * from public.tenant_members'),existingMembership,'self repair cannot overwrite an existing membership role');
  console.log('PASS SQL A03: future/expired roles, changed department/role and administrator-owned supervisor fields are never rewritten by self repair');

} finally { await db.close(); }
