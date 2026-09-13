'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const { createStatementSourceFixture, migration } = require('./fixtures/finance_statement_source_fixture.cjs');
const catalog = require('./fixtures/finance_statement_source_cascades_20260913.json');
const canary = () => fs.readFileSync(path.join(root, 'scripts/finance_statement_source_canary.sql'), 'utf8');
const quote = s => '"' + s.replace(/"/g, '""') + '"';
const relation = s => s.split('.').map(quote).join('.');
async function createStatementSourceCanaryFixture(db, { install = true } = {}) {
  await createStatementSourceFixture(db, { install: false, seed: false });
  // Remove the base test's synthetic role matrix before installing live insert
  // guards: the new canary must itself provision its own identity end to end.
  await db.exec(`delete from public.tenant_members;delete from public.finance_users;delete from auth.identities;delete from auth.users;create schema private;create schema net;create schema vault;create sequence net.http_request_queue_id_seq;create type net.http_method as enum ('GET','POST','DELETE');`);
  const blocks = [catalog.identity.catalog, catalog.projections.catalog, catalog.sources.catalog];
  for (const table of [...new Set(blocks.flatMap(b => b.columns.map(c => c.table)))]) await db.exec(`create table if not exists ${relation(table)} ();`);
  for (const c of blocks.flatMap(b => b.columns)) {
    const existing = await db.query('select 1 from information_schema.columns where table_schema=$1 and table_name=$2 and column_name=$3', [...c.table.split('.'), c.column]);
    if (!existing.rows.length) await db.exec(`alter table ${relation(c.table)} add column ${quote(c.column)} ${c.type}${c.default ? ' default ' + c.default : ''};`);
    if (c.default) await db.exec(`alter table ${relation(c.table)} alter column ${quote(c.column)} set default ${c.default};`);
  }
  await db.exec(`
    update public.tenants set name='Fictional base tenant' where name is null;
    create table public.branches(id uuid primary key,company_id uuid,deleted_at timestamptz,created_at timestamptz default now());
    create table public.departments(id uuid primary key,company_id uuid,code text,deleted_at timestamptz,created_at timestamptz default now());
    create table public.positions(id uuid primary key,company_id uuid,code text,deleted_at timestamptz,created_at timestamptz default now());
    create table public.roles(id uuid primary key,company_id uuid,key text,created_at timestamptz default now());
    create table public.finance_portal_roles(id text primary key);
    create table public.employee_department_roles(id uuid primary key default gen_random_uuid(),tenant_id uuid,finance_user_id text,active boolean,metadata jsonb,updated_at timestamptz);
    create table public.system_settings(id uuid primary key default gen_random_uuid(),tenant_id uuid,key text,value jsonb,setting_value jsonb,settings jsonb,updated_at timestamptz,updated_by text);
    create table public.finance_department_units(id uuid primary key,tenant_id uuid,code text,active boolean,present_in_source boolean,is_posting_unit boolean);
    create table public.finance_department_entity_scopes(id uuid primary key,tenant_id uuid,unit_id uuid,entity_code text,active boolean);
    create table public.ledger_entries(id text primary key,source_id text);
    create table public.notification_delivery_events(id text primary key,request_id text,payload jsonb);
    create table public.approval_step_actor_snapshots(id text primary key,record_id text);
    create table public.invoice_revenue_rule_assignments(id text primary key,invoice_id text);
    create table public.income_document_closure_cases(id text primary key,source_id text);
    create table vault.decrypted_secrets(name text,decrypted_secret text,created_at timestamptz default now());
    -- Only the transport extension is simulated. Business/identity/wake bodies
    -- below are verbatim catalog definitions and normal triggers stay active.
    create function net.http_post(url text,body jsonb default '{}',params jsonb default '{}',headers jsonb default '{}',timeout_milliseconds int default 2000) returns bigint language plpgsql as $$
    declare result bigint;begin
     insert into net.http_request_queue(method,url,headers,body,timeout_milliseconds) values('POST',url,headers,convert_to(body::text,'UTF8'),timeout_milliseconds) returning id into result;return result;
    end;$$;
    insert into vault.decrypted_secrets(name,decrypted_secret) values
     ('finance_edoc_sync_worker_url','https://synthetic-canary.supabase.co/functions/v1/sync-finance-members-to-edoc'),
     ('finance_edoc_sync_worker_secret','SYNTHETIC-LOCAL-ONLY-SECRET-0000000000000000'),
     ('finance_notification_worker_anon_key','SYNTHETIC-LOCAL-ONLY-PUBLISHABLE-KEY');
  `);
  for (const c of blocks.flatMap(b => b.columns)) if (c.notnull || c.null === 'NO') await db.exec(`alter table ${relation(c.table)} alter column ${quote(c.column)} set not null;`);
  // Install catalog checks, foreign keys and uniqueness. Base fixtures already
  // own the five primary keys below; retain them instead of duplicating.
  const primary = new Set(['auth.users','auth.identities','public.tenants','public.tenant_members','public.finance_users','public.invoices','public.bills','public.expense_requests']);
  let constraintIndex = 0;
  for (const c of blocks.flatMap(b => b.constraints).sort((a,b)=>Number(/^FOREIGN KEY/.test(a.definition))-Number(/^FOREIGN KEY/.test(b.definition)))) {
    const table = c.table.includes('.') ? c.table : 'public.' + c.table;
    if (/^PRIMARY KEY/.test(c.definition) && primary.has(table)) continue;
    await db.exec(`alter table ${relation(table)} add constraint fixture_catalog_${++constraintIndex} ${c.definition};`);
  }
  await db.exec(`
    create unique index fixture_tenant_email on public.tenant_members(tenant_id,lower(email)) where active=true;
    create unique index fixture_tenant_person on public.tenant_members(tenant_id,finance_user_id) where finance_user_id is not null and active=true;
    create unique index fixture_identity_active on public.finance_identity_links(finance_user_id) where active=true;
    insert into public.companies(id,code,name) values('20000000-0000-0000-0000-000000000001','E1','Fictional fixture company');
    insert into public.finance_department_units values('20000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','D1',true,true,true);
    insert into public.finance_department_entity_scopes values('20000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','E1',true);
    insert into public.system_settings(tenant_id,key,value) values('00000000-0000-0000-0000-000000000001','departments','[{"c":"D1","active":true,"isPostingUnit":true,"historicalOnly":false,"newFormEntityCodes":["E1"]}]');
    set check_function_bodies=off;
  `);
  await db.exec(fs.readFileSync(path.join(__dirname, 'fixtures/finance_statement_source_projection_helpers_20260913.sql'), 'utf8'));
  const functions = [...blocks.slice(0,2).flatMap(b => b.triggers.map(t => t.function)), ...catalog.identity.cascades.flatMap(c => c.helpers.map(h => h.definition)), ...catalog.projections.catalog.helpers.map(h => h.definition), ...catalog.sources.catalog.wake.map(h => h.definition)];
  for (const definition of new Set(functions)) await db.exec(definition.trim().replace(/;?$/, ';'));
  for (const t of blocks.slice(0,2).flatMap(b => b.triggers)) await db.exec(t.trigger.trim().replace(/;?$/, ';'));
  // Exact source insert guards needed by the canary are installed as well.
  // Rich source reconciliation projections are covered by the full release
  // fingerprint and live rehearsal, not simulated as success in this fixture.
  const selected = new Set(['private.finance_guard_form_department_scope_row','private.finance_bump_approval_row_version','public.normalize_invoice_identifier_type_trigger','private.finance_assert_pending_step_assignees_active']);
  for (const t of catalog.sources.catalog.triggers) if (t.table === 'invoices' && [...selected].some(name => t.function.startsWith('CREATE OR REPLACE FUNCTION '+name+'('))) {
    await db.exec(t.function.trim().replace(/;?$/, ';'));await db.exec(t.trigger.trim().replace(/;?$/, ';'));
  }
  await db.exec('set check_function_bodies=on;');
  if (install) await db.exec(migration());
  return { canary: canary(), catalog };
}
async function run() {
 const { PGlite } = require(process.env.FINANCE_PGLITE_MODULE || '@electric-sql/pglite');
 const notices=[];const db=new PGlite({onNotice:n=>notices.push(n)});let checks=0;
 const pass = (label) => {checks++;console.log('PASS '+label);};
 try {
  await createStatementSourceCanaryFixture(db);
  const source=canary();assert(!/^\s*\\/m.test(source));assert(!/disable\s+trigger|session_replication_role|finance\.edoc_sync_wake_queued.*set_config/i.test(source));pass('pure SQL, no trigger bypass, no real employee selection');
  await db.exec(source);pass('exact canary runs real Auth → Google → Finance → HR → identity → eDoc triggers and real RLS RPC, then rolls back');
  assert.equal(notices.filter(x=>x.severity==='WARNING').length,0);pass('normal cascade and queue transport produce no swallowed dependency warning');
  const core=source.split('-- FINANCE_AUTHENTICATED_CANARY_CORE_BEGIN')[1].split('-- FINANCE_AUTHENTICATED_CANARY_CORE_END')[0];
  await db.exec('begin');await db.exec(core);
  assert.equal((await db.query('select count(*)::int as n from net.http_request_queue')).rows[0].n,1);pass('valid synthetic vault configuration invokes true wake helper and queues exactly one transactional HTTP request');
  assert.equal((await db.query('select count(*)::int as n from private.finance_edoc_sync_outbox_v1')).rows[0].n,1);pass('normal member outbox is present before rollback');
  assert.equal((await db.query('select count(*)::int as n from public.finance_users')).rows[0].n,1);pass('only the canary-created fictional employee exists; no role matrix actor borrowed');
  await db.exec('rollback');
  for (const table of ['auth.users','auth.identities','public.finance_users','public.employees','public.users','public.tenant_members','public.finance_identity_links','private.finance_edoc_member_state_v1','private.finance_edoc_sync_outbox_v1','net.http_request_queue','public.invoices']) {
   assert.equal((await db.query(`select count(*)::int as n from ${table}`)).rows[0].n,0);pass(table+' synthetic rows fully roll back');
  }
  const before=(await db.query('select last_value from net.http_request_queue_id_seq')).rows[0].last_value;
  await db.exec(source);assert((await db.query('select last_value from net.http_request_queue_id_seq')).rows[0].last_value>before);pass('repeat run succeeds; sequence gaps are expected PostgreSQL allocation, not retained queue data');
  await db.exec("insert into auth.users(id,email) values('d9130426-2900-4000-8000-000000000001','collision@example.invalid')");
  await assert.rejects(db.exec(source),/identifiers already exist/);await db.exec('rollback');pass('pre-existing synthetic identifier fails closed before any insert');
  await db.exec("delete from auth.users where id='d9130426-2900-4000-8000-000000000001'");
  await db.exec("insert into private.finance_edoc_member_state_v1(tenant_id,finance_user_id,source_revision,finance_member_revision) values('00000000-0000-0000-0000-000000000001','__statement_source_employee_20260913__',9,9)");
  await assert.rejects(db.exec(source),/identifiers already exist/);await db.exec('rollback');pass('orphan eDoc projection collision also rejects before overwriting it');
  assert.equal((await db.query("select source_revision from private.finance_edoc_member_state_v1 where finance_user_id='__statement_source_employee_20260913__'")).rows[0].source_revision,9);
  await db.exec("delete from private.finance_edoc_member_state_v1 where finance_user_id='__statement_source_employee_20260913__'");
  const definition=(await db.query("select pg_get_functiondef('public.finance_statement_source_page_v1(text,text,integer,integer)'::regprocedure) as sql")).rows[0].sql;
  for (const [label,bad] of [
   ['SECURITY DEFINER bypass exposing unassigned source',definition.replace('SECURITY INVOKER','SECURITY DEFINER').replace('LANGUAGE plpgsql\n STABLE','LANGUAGE plpgsql\n STABLE SECURITY DEFINER')],
   ['truncated source payload',definition.replace("'rows', v_rows","'rows', '[]'::jsonb")],
   ['incorrect page offset',definition.replace("'offset', p_offset","'offset', 0")]
  ]) {
   assert.notEqual(bad,definition);await db.exec('begin');await db.exec(bad);
   await assert.rejects(db.exec(core),/Statement source/);await db.exec('rollback');pass('canary rejects '+label);
  }
  await db.exec('begin;drop trigger trg_finance_sync_current_user_to_hr_v2 on public.finance_users;');
  await assert.rejects(db.exec(core),/projections did not run/);await db.exec('rollback');pass('canary rejects missing normal HR projection trigger');
  await db.exec(source);pass('exact canary still succeeds after all negative fixtures roll back');
  console.log(`OK: ${checks} statement synthetic canary checks`);
 } finally {await db.close();}
}
module.exports={createStatementSourceCanaryFixture};
if(require.main===module)run().catch(e=>{console.error(e);process.exitCode=1;});
