#!/usr/bin/env node
'use strict';

// Isolated, fictional-data rehearsal of the deployed Google identity triggers.
// This never connects to Supabase and never writes auth.identities in production.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

const root = path.resolve(__dirname, '..');
const cascade = require(path.join(root, 'scripts/fixtures/finance_statement_source_cascades_20260913.json'));
const authority = require(path.join(root, 'scripts/fixtures/portal_projection_authorities_20261012.json'));
const readAuthority = require(path.join(root, 'scripts/fixtures/finance_expense_read_actor_authorities_20261015.json'));
const trigger = name => {
  const entry = cascade.identity.catalog.triggers.find(item => item.function.includes(`FUNCTION public.${name}(`));
  assert(entry, `missing deployed trigger ${name}`);
  return entry.function;
};
const catalogFunction = signature => {
  const entry = authority.functions.find(item => item.signature === signature);
  assert(entry, `missing deployed function ${signature}`);
  return entry.definition;
};
const source = {
  before: trigger('finance_guard_google_identity_lifecycle_v2'),
  after: trigger('finance_complete_google_identity_trigger_v2'),
  financeGuard: trigger('finance_guard_google_link_control_v2'),
  signingGuard: trigger('finance_guard_finance_user_signing_lifecycle'),
  finalizer: catalogFunction('private.finance_complete_verified_google_account_link_v2(uuid,text,uuid)'),
  verifiedEmail: catalogFunction('finance_verified_google_email(uuid)'),
  frozenAssignee: `CREATE OR REPLACE FUNCTION public.finance_user_has_frozen_pending_assignee(p_tenant_id uuid, p_finance_user_id text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select exists (
    select 1
    from public.approval_step_actor_snapshots snapshot
    where snapshot.tenant_id = p_tenant_id
      and snapshot.resolved_user_id = p_finance_user_id
      and lower(coalesce(snapshot.workflow_status, '')) like 'pending%'
      and lower(coalesce(snapshot.step_status, ''))
          in ('', 'pending', 'waiting')
      and (
        (
          snapshot.record_type in ('expense_request', 'expense_requests')
          and exists (
            select 1
            from public.expense_requests source_request
            where source_request.tenant_id = snapshot.tenant_id
              and source_request.id = snapshot.record_id
              and lower(coalesce(source_request.status, ''))
                  like 'pending%'
          )
        )
        or (
          snapshot.record_type in ('invoice', 'invoices')
          and exists (
            select 1
            from public.invoices source_invoice
            where source_invoice.tenant_id = snapshot.tenant_id
              and source_invoice.id = snapshot.record_id
              and lower(coalesce(source_invoice.approval_status, ''))
                  like 'pending%'
          )
        )
        or (
          snapshot.record_type in ('bill', 'bills')
          and exists (
            select 1
            from public.bills source_bill
            where source_bill.tenant_id = snapshot.tenant_id
              and source_bill.id = snapshot.record_id
              and lower(coalesce(source_bill.approval_status, ''))
                  like 'pending%'
          )
        )
      )
  );
$function$
`,
  rewriteSteps: `CREATE OR REPLACE FUNCTION private.finance_user_offboarding_rewrite_steps(p_steps jsonb, p_departing_finance_user_id text, p_departing_email text, p_successor_finance_user_id text, p_successor_email text, p_operation_id text, p_actor_finance_user_id text, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_result jsonb := '[]'::jsonb;
  v_step jsonb;
  v_new_step jsonb;
  v_history jsonb;
begin
  if pg_catalog.jsonb_typeof(p_steps) <> 'array' then
    return p_steps;
  end if;

  for v_step in
    select source_step.step
    from pg_catalog.jsonb_array_elements(p_steps)
         with ordinality source_step(step, ord)
    order by source_step.ord
  loop
    v_new_step := v_step;
    if coalesce(v_step ->> 'a', '') = ''
       and (
         nullif(v_step ->> 'uid', '') = p_departing_finance_user_id
         or (
           nullif(v_step ->> 'uid', '') is null
           and nullif(v_step ->> 'email', '') is not null
           and lower(v_step ->> 'email') = lower(p_departing_email)
         )
       ) then
      v_history := case
        when pg_catalog.jsonb_typeof(v_step -> 'reassignmentHistory') = 'array'
          then v_step -> 'reassignmentHistory'
        else '[]'::jsonb
      end;
      v_new_step := pg_catalog.jsonb_set(
        pg_catalog.jsonb_set(
          v_step,
          '{uid}',
          pg_catalog.to_jsonb(p_successor_finance_user_id),
          true
        ),
        '{email}',
        pg_catalog.to_jsonb(p_successor_email),
        true
      );
      v_new_step := pg_catalog.jsonb_set(
        v_new_step,
        '{reassignmentHistory}',
        v_history || pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object(
            'operationId', p_operation_id,
            'fromUserId', p_departing_finance_user_id,
            'toUserId', p_successor_finance_user_id,
            'reason', p_reason,
            'byId', p_actor_finance_user_id,
            'at', pg_catalog.now()
          )
        ),
        true
      );
    end if;
    v_result := v_result || pg_catalog.jsonb_build_array(v_new_step);
  end loop;

  return v_result;
end;
$function$
`,
  sessionActive: `CREATE OR REPLACE FUNCTION public.finance_auth_session_active()
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare sid uuid;
begin
 begin sid:=nullif(auth.jwt()->>'session_id','')::uuid;exception when invalid_text_representation then return false;end;
 if sid is null or auth.uid() is null then return false;end if;
 return exists(select 1 from auth.sessions s where s.id=sid and s.user_id=auth.uid() and (s.not_after is null or s.not_after>statement_timestamp()));
end $function$
`,
};
const deployedMd5 = {
  before: 'bbeb874604fd7158534958c4b7509959',
  after: 'f639967860c3d42396436722ad6688c3',
  financeGuard: 'd4280a7ae9a66e30712f485252f8be1f',
  signingGuard: '2dfbc2d5e8783e2f8e2153182f883982',
  finalizer: 'c81f4feffd0c761bd5a80a9a51d136b4',
  verifiedEmail: 'be175f21a98a7bc2aeb3cdabb97a4ef3',
  frozenAssignee: '753b6a36ff6056a92d097d3e5df84685',
  rewriteSteps: 'c8e8224614dd0db855433abf8d2deea8',
  sessionActive: 'd2ca6446e8985414ad8272d551995973',
};
for (const [key, definition] of Object.entries(source)) {
  assert.equal(crypto.createHash('md5').update(definition).digest('hex'), deployedMd5[key], `${key} differs from read-only live catalog on 2026-10-15`);
}
for (const entry of readAuthority.functions) {
  assert.equal(crypto.createHash('md5').update(entry.definition).digest('hex'), entry.md5, `${entry.signature} catalog bytes changed`);
}
const readExpectedMd5 = {
  'current_finance_user()': '138acd5e90d5546d28de5874b83305ef',
  'current_tenant_id()': 'e1f507a2ad91ddb1ff770dc5eb20d780',
  'finance_current_verified_google_email_v2()': 'e4681e519d5235ebae85324a87dfbe22',
  'json_steps_include_current_user(jsonb)': '6f03c455e7d5bf6ac2be96bb49db4778',
  'can_read_expense_request(expense_requests)': '4ac0e7c684e8b8c408f9d7533128e04d',
  'finance_approval_tasks_for_current_user(text)': 'a99f1dd41923ab610c88095c8cf1ab89',
  'private.finance_expense_actor_can_act(uuid,expense_requests,integer,jsonb,text,text,text)': 'd43d260a2f967e1555f719db7694ae53',
};
for (const [signature, md5] of Object.entries(readExpectedMd5)) {
  assert.equal(readAuthority.functions.find(entry => entry.signature === signature)?.md5, md5, `${signature} differs from 2026-10-16 read-only live catalog`);
}
const readFunctionsInDependencyOrder = [
  'default_tenant_id()', 'current_tenant_id()', 'current_finance_user()',
  'current_finance_user_id()', 'current_finance_role()', 'current_finance_department()',
  'finance_current_verified_google_email_v2()', 'finance_legacy_name_matches_current_v1(text[])',
  'finance_identity_matches_current_v1(text[],text[],text[])',
  'json_steps_include_current_user(jsonb)', 'json_steps_role_matches(jsonb)',
  'finance_role_queue_scope_v1(text,text)', 'is_finance_accounting()',
  'can_read_expense_request(expense_requests)', 'private.finance_income_step_role(jsonb)',
  'private.finance_income_step_user_id(jsonb)',
  'private.finance_expense_actor_can_act(uuid,expense_requests,integer,jsonb,text,text,text)',
  'finance_approval_tasks_for_current_user(text)',
];
const readFunctionsSql = readFunctionsInDependencyOrder.map(signature => {
  const entry = readAuthority.functions.find(item => item.signature === signature);
  assert(entry, `missing read/actor authority ${signature}`);
  return `${entry.definition};`;
}).join('\n');

const TENANT = '10000000-0000-4000-8000-000000000001';
const SUBJECT = '20000000-0000-4000-8000-000000000001';
const OTHER_SUBJECT = '20000000-0000-4000-8000-000000000002';
const MISMATCH_SUBJECT = '20000000-0000-4000-8000-000000000003';
const SESSION = '40000000-0000-4000-8000-000000000001';
const NEW_SESSION = '40000000-0000-4000-8000-000000000002';
const OTHER_SESSION = '40000000-0000-4000-8000-000000000003';
const MISMATCH_SESSION = '40000000-0000-4000-8000-000000000004';
const OLD = 'fictional_old_system';
const TARGET = 'fictional_new_person';
const OTHER = 'fictional_different_google_subject';
const MISMATCH = 'fictional_mismatched_google_email';
const OLD_EMAIL = 'fixture.old-system@suiyuecare.com';
const TARGET_EMAIL = 'fixture.new-person@suiyuecare.com';
const OTHER_EMAIL = 'fixture.other-subject@suiyuecare.com';
const MISMATCH_FINANCE_EMAIL = 'fixture.mismatch-finance@suiyuecare.com';
const MISMATCH_GOOGLE_EMAIL = 'fixture.mismatch-provider@suiyuecare.com';

const schema = `
create schema auth; create schema private;
create table auth.users(id uuid primary key, email text, deleted_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid not null,not_after timestamptz);
create table auth.fixture_claims(user_id uuid not null,session_id uuid not null);
create function auth.uid() returns uuid language sql stable as $$select user_id from auth.fixture_claims limit 1$$;
create function auth.jwt() returns jsonb language sql stable as $$select jsonb_build_object('session_id',session_id) from auth.fixture_claims limit 1$$;
create table auth.identities(id uuid primary key, user_id uuid not null, provider text not null, identity_data jsonb not null, created_at timestamptz default now());
create table public.tenants(id uuid primary key,slug text not null);
create table public.finance_users(
  id text primary key, tenant_id uuid not null, name text, email text not null,
  auth_user_id uuid, active boolean not null, org_status text, role text,
  entity_id text,department_code text,
  google_link_status text, pending_login_email text, google_link_revision bigint not null default 0,
  google_link_requested_at timestamptz, google_link_requested_by uuid,
  google_link_status_detail text, google_last_linked_at timestamptz,
  google_login_verified_at timestamptz, logging_identity_id text,
  created_at timestamptz default now()
);
create unique index finance_user_auth_uuid on public.finance_users(auth_user_id) where auth_user_id is not null;
create table private.finance_google_link_mutation_authorizations_v2(
  id uuid primary key default gen_random_uuid(), backend_pid int not null, transaction_id bigint not null,
  tenant_id uuid not null, finance_user_id text not null, action text not null,
  old_email text not null, new_email text not null, old_auth_user_id uuid,
  new_auth_user_id uuid, target_revision bigint not null, created_at timestamptz default clock_timestamp()
);
create table public.tenant_members(id uuid primary key default gen_random_uuid(),tenant_id uuid not null,finance_user_id text unique,auth_user_id uuid unique,email text,active boolean,created_at timestamptz default now());
create table public.users(finance_user_id text primary key, auth_user_id uuid unique, email text, active boolean);
create table public.employee_department_roles(id text primary key,tenant_id uuid not null,finance_user_id text not null,can_approve boolean not null,active boolean not null,role_key text,department_code text,direct_supervisor_finance_user_id text,approval_delegate_finance_user_id text,effective_from date default current_date,effective_to date,metadata jsonb default '{}'::jsonb,updated_at timestamptz default now(),created_at timestamptz default now(),is_primary boolean default true);
create table public.approval_step_actor_snapshots(tenant_id uuid,record_type text,record_id text,resolved_user_id text,workflow_status text,step_status text,data_environment text,step_index integer,resolution_status text,resolved_active boolean,raw_step jsonb);
create table public.expense_requests(id text primary key,no text,tenant_id uuid,status text,steps jsonb,applicant_id text,applicant_email text,applicant text,form_payload jsonb default '{}'::jsonb,department_code text,entity_id text,type text,data_environment text,cash_posted_at timestamptz,created_at timestamptz default now());
create table public.invoices(id text,tenant_id uuid,approval_status text,batch_id text,no text,applicant_id text,department_code text,entity_id text,status text,steps jsonb,created_at timestamptz,data_environment text);
create table public.bills(id text,tenant_id uuid,approval_status text,batch_id text,no text,applicant_id text,applicant_email text,department_code text,entity_id text,status text,steps jsonb,created_at timestamptz,data_environment text);
create table public.approval_delegations(tenant_id uuid,delegator_finance_user_id text,delegatee_finance_user_id text,active boolean,starts_at timestamptz,ends_at timestamptz,role_key text,scope_json jsonb);
create table public.fixture_approval_history(id text primary key, actual_actor_finance_user_id text not null, actual_actor_email text not null, action text not null);
insert into public.tenants values('${TENANT}','suiyuecare');
insert into auth.users values
  ('${SUBJECT}','${OLD_EMAIL}',null),
  ('${OTHER_SUBJECT}','${OTHER_EMAIL}',null),
  ('${MISMATCH_SUBJECT}','${MISMATCH_FINANCE_EMAIL}',null);
insert into auth.sessions values('${SESSION}','${SUBJECT}',now()+interval '1 day'),('${OTHER_SESSION}','${OTHER_SUBJECT}',now()+interval '1 day'),('${MISMATCH_SESSION}','${MISMATCH_SUBJECT}',now()+interval '1 day');
insert into auth.fixture_claims values('${SUBJECT}','${SESSION}');
insert into auth.identities(id,user_id,provider,identity_data) values
  ('30000000-0000-4000-8000-000000000001','${SUBJECT}','google','{"email":"${OLD_EMAIL}","email_verified":true}'),
  ('30000000-0000-4000-8000-000000000002','${OTHER_SUBJECT}','google','{"email":"${OTHER_EMAIL}","email_verified":true}'),
  ('30000000-0000-4000-8000-000000000003','${MISMATCH_SUBJECT}','google','{"email":"${MISMATCH_GOOGLE_EMAIL}","email_verified":true}');
insert into public.finance_users(id,tenant_id,name,email,auth_user_id,active,org_status,role,entity_id,department_code,google_link_status,google_link_revision) values
  ('${OLD}','${TENANT}','Fictional old system','${OLD_EMAIL}','${SUBJECT}',true,'system_account','employee','E5','B1101','bound',0),
  ('${TARGET}','${TENANT}','Fictional new person','${TARGET_EMAIL}',null,true,'active','employee','E5','B1101','pending_first_login',2),
  ('${OTHER}','${TENANT}','Fictional different Google account','${OTHER_EMAIL}','${OTHER_SUBJECT}',true,'active','employee','E5','B1102','bound',1),
  ('${MISMATCH}','${TENANT}','Fictional mismatched Google email','${MISMATCH_FINANCE_EMAIL}','${MISMATCH_SUBJECT}',true,'active','employee','E5','B1103','bound',1);
insert into public.employee_department_roles(id,tenant_id,finance_user_id,can_approve,active,role_key,department_code) values
  ('old-primary','${TENANT}','${OLD}',true,true,'employee','B1101'),
  ('target-primary','${TENANT}','${TARGET}',false,true,'employee','B1101'),
  ('other-primary','${TENANT}','${OTHER}',false,true,'employee','B1102'),
  ('mismatch-primary','${TENANT}','${MISMATCH}',false,true,'employee','B1103');
insert into public.tenant_members(tenant_id,finance_user_id,auth_user_id,email,active) select tenant_id,id,auth_user_id,email,true from public.finance_users where auth_user_id is not null;
insert into public.users select id,auth_user_id,email,true from public.finance_users where auth_user_id is not null;
insert into public.expense_requests(id,no,tenant_id,status,steps,applicant_id,applicant_email,applicant,department_code,entity_id,type,data_environment)
values('fictional_request','fixture-20260603001','${TENANT}','pending_applicant_confirm',jsonb_build_array(jsonb_build_object('uid','${OLD}','email','${OLD_EMAIL}','rk','applicant_confirm','a','')),'${OLD}','${OLD_EMAIL}','Fictional original applicant','B1101','E5','general_expense','production');
insert into public.expense_requests(id,no,tenant_id,status,steps,applicant_id,applicant_email,applicant,department_code,entity_id,type,data_environment)
values('fictional_mismatch_request','fixture-wrong-email','${TENANT}','pending_applicant_confirm',jsonb_build_array(jsonb_build_object('uid','${MISMATCH}','email','${MISMATCH_FINANCE_EMAIL}','rk','applicant_confirm','a','')),'${MISMATCH}','${MISMATCH_FINANCE_EMAIL}','Fictional mismatched identity','B1103','E5','general_expense','production');
insert into public.approval_step_actor_snapshots(tenant_id,record_type,record_id,resolved_user_id,workflow_status,step_status,data_environment,step_index,resolution_status,resolved_active,raw_step)
select '${TENANT}','expense_requests','fictional_request','${OLD}','pending_applicant_confirm','pending','production',1,'resolved',true,steps->0 from public.expense_requests where id='fictional_request';
insert into public.fixture_approval_history values('fictional_completed_step','${OLD}','${OLD_EMAIL}','approved');

-- These dependencies are deliberately narrow local substitutes. The five
-- deployed guard/finalizer definitions below are not modified or mocked.
create function private.finance_google_normalized_email_v2(text) returns text language sql immutable as $$select lower(btrim(coalesce($1,'')))$$;
create function private.finance_google_authorize_mutation_v2(uuid,text,text,text,text,uuid,uuid,bigint,uuid)
returns uuid language plpgsql as $$declare v_id uuid:=gen_random_uuid();begin
 insert into private.finance_google_link_mutation_authorizations_v2(id,backend_pid,transaction_id,tenant_id,finance_user_id,action,old_email,new_email,old_auth_user_id,new_auth_user_id,target_revision)
 values(v_id,pg_backend_pid(),txid_current(),$1,$2,$3,lower(btrim($4)),lower(btrim($5)),$6,$7,$8);
 return v_id;
end$$;
create function private.finance_sync_google_link_projections_v2(uuid,text,uuid,text,text)
returns jsonb language plpgsql as $$begin
 update public.tenant_members set auth_user_id=$3,email=$5,active=true where finance_user_id=$2;
 if not found then insert into public.tenant_members(tenant_id,finance_user_id,auth_user_id,email,active) values($1,$2,$3,$5,true); end if;
 update public.users set auth_user_id=$3,email=$5,active=true where finance_user_id=$2;
 if not found then insert into public.users values($2,$3,$5,true); end if;
 return jsonb_build_object('ok',true);
end$$;
create function public.finance_activate_verified_google_org_user(uuid,text,uuid)
returns void language plpgsql as $$begin
 if not exists(select 1 from public.employee_department_roles where finance_user_id=$2 and active) then
   raise exception 'fixture organization authority absent';
 end if;
end$$;
create function private.finance_google_projection_health_v2(uuid,text)
returns jsonb language sql as $$select jsonb_build_object('ok',exists(
 select 1 from public.finance_users f join public.tenant_members tm on tm.finance_user_id=f.id
 join public.users u on u.finance_user_id=f.id
 where f.tenant_id=$1 and f.id=$2 and f.auth_user_id=tm.auth_user_id
 and f.auth_user_id=u.auth_user_id and f.email=tm.email and f.email=u.email and tm.active and u.active
))$$;
create function private.finance_google_write_diagnostic_v2(uuid,text,uuid,text,text,text,text,text,uuid,jsonb,uuid)
returns uuid language sql as $$select gen_random_uuid()$$;
${source.verifiedEmail};
${source.frozenAssignee};
${source.rewriteSteps};
${source.sessionActive};
${source.financeGuard};
create trigger trg_finance_01_google_link_control_v2 before insert or update of email,auth_user_id,google_link_status,pending_login_email,google_link_revision,google_link_requested_at,google_link_requested_by,google_link_status_detail,google_last_linked_at on public.finance_users for each row execute function public.finance_guard_google_link_control_v2();
${source.signingGuard};
create trigger trg_finance_guard_finance_user_signing_update before update of active,auth_user_id,email on public.finance_users for each row execute function public.finance_guard_finance_user_signing_lifecycle();
${source.finalizer};
${source.before};
${source.after};
create trigger trg_finance_00_guard_google_identity_lifecycle_v2 before delete or update of provider,identity_data on auth.identities for each row execute function public.finance_guard_google_identity_lifecycle_v2();
create trigger trg_finance_00_complete_google_account_link_v2 after insert or delete or update of provider,identity_data on auth.identities for each row execute function public.finance_complete_google_identity_trigger_v2();
${readFunctionsSql}
`;

async function row(db, sql) { return (await db.query(sql)).rows[0]; }
async function rename(db, email) {
  return db.query('update auth.identities set identity_data=jsonb_set(identity_data,\'{email}\',to_jsonb($1::text)) where user_id=$2', [email, SUBJECT]);
}
async function assertRejected(promise, code, fragment) {
  try { await promise; assert.fail(`expected SQLSTATE ${code}`); }
  catch (error) {
    assert.equal(error.code, code, error.message);
    assert.match(error.message, fragment);
  }
}
async function unbindOld(db, expected) {
  const update = `update public.finance_users set auth_user_id=null,logging_identity_id=null,google_link_status='blocked',google_link_revision=1,google_link_status_detail='Fictional system profile retained without login' where id='${OLD}';`;
  await db.exec('begin;');
  try {
    await db.exec(`select private.finance_google_authorize_mutation_v2('${TENANT}','${OLD}','migration_repair','${OLD_EMAIL}','${OLD_EMAIL}','${SUBJECT}',null,1,null);`);
    if (expected) {
      await assertRejected(db.exec(update), '23514', expected);
      await db.exec('rollback;');
      return;
    }
    await db.exec(update);
    await db.exec(`delete from private.finance_google_link_mutation_authorizations_v2 where finance_user_id='${OLD}';`);
    await db.exec(`update public.tenant_members set auth_user_id=null,active=false where finance_user_id='${OLD}'; update public.users set auth_user_id=null,active=false where finance_user_id='${OLD}';`);
    await db.exec(`delete from auth.sessions where user_id='${SUBJECT}';`);
    await db.exec('commit;');
  } catch (error) {
    await db.exec('rollback;').catch(() => {});
    throw error;
  }
}

async function main() {
  const db = new PGlite();
  try {
    await db.exec(schema);
    await assertRejected(rename(db, TARGET_EMAIL), '42501', /Google 主信箱尚未由人員管理核准換綁/);
    assert.equal((await row(db, `select identity_data->>'email' as email from auth.identities where user_id='${SUBJECT}'`)).email, OLD_EMAIL);
    assert.equal((await row(db, `select google_link_status as status from public.finance_users where id='${TARGET}'`)).status, 'pending_first_login');
    assert.equal((await row(db, 'select public.finance_auth_session_active() as active')).active, true);

    // The deployed signing guard rejects an authorized unlink while a frozen
    // pending step still belongs to the old system member.
    await unbindOld(db, /Reassign frozen pending approval steps/);
    assert.equal((await row(db, `select auth_user_id::text as auth from public.finance_users where id='${OLD}'`)).auth, SUBJECT);

    // Use the deployed rewrite helper for the one pending step. The completed
    // audit event is separate and stays attributed to its actual old actor.
    await db.exec(`update public.expense_requests set steps=private.finance_user_offboarding_rewrite_steps(steps,'${OLD}','${OLD_EMAIL}','${TARGET}','${TARGET_EMAIL}','fictional_operation','fictional_authorized_admin','Fictional authorized pending-step transfer') where id='fictional_request';`);
    await db.exec(`update public.approval_step_actor_snapshots set resolved_user_id='${TARGET}',raw_step=(select steps->0 from public.expense_requests where id='fictional_request') where record_id='fictional_request' and resolved_user_id='${OLD}';`);
    const transferred = await row(db, `select steps->0->>'uid' as assignee,steps->0->'reassignmentHistory'->0->>'fromUserId' as previous from public.expense_requests where id='fictional_request'`);
    assert.deepEqual(transferred, { assignee: TARGET, previous: OLD });
    assert.equal((await row(db, `select public.finance_user_has_frozen_pending_assignee('${TENANT}','${TARGET}') as pending`)).pending, true);
    await unbindOld(db, /Disable approval capability and reassign routes/);
    await db.exec(`update public.employee_department_roles set can_approve=false where finance_user_id='${OLD}';`);
    await assertRejected(db.exec(`update public.finance_users set auth_user_id=null,google_link_status='blocked',google_link_revision=1 where id='${OLD}';`), '42501', /V2 transactional contract/);
    await unbindOld(db);
    assert.equal((await row(db, 'select public.finance_auth_session_active() as active')).active, false);
    assert.equal((await row(db, `select actual_actor_finance_user_id as actor from public.fixture_approval_history where id='fictional_completed_step'`)).actor, OLD);
    assert.equal((await row(db, `select count(*)::int n from public.employee_department_roles where finance_user_id='${OLD}' and active and can_approve`)).n, 0);

    // Different Google subject/account may never acquire this subject by an
    // email-only rename. AFTER finalizer must abort the whole identity update.
    await assertRejected(rename(db, OTHER_EMAIL), '23514', /Google 主信箱換綁未完整完成/);
    assert.equal((await row(db, `select identity_data->>'email' as email from auth.identities where user_id='${SUBJECT}'`)).email, OLD_EMAIL);
    await rename(db, TARGET_EMAIL);
    const target = await row(db, `select auth_user_id::text as auth,google_link_status as status,google_link_revision::int as revision,role from public.finance_users where id='${TARGET}'`);
    assert.deepEqual(target, { auth: SUBJECT, status: 'bound', revision: 3, role: 'employee' });
    assert.equal((await row(db, `select auth_user_id::text as auth from public.tenant_members where finance_user_id='${TARGET}'`)).auth, SUBJECT);
    assert.equal((await row(db, `select auth_user_id::text as auth from public.users where finance_user_id='${TARGET}'`)).auth, SUBJECT);
    assert.equal((await row(db, `select can_approve from public.employee_department_roles where finance_user_id='${TARGET}'`)).can_approve, false);
    assert.deepEqual(await row(db, `select active,org_status,auth_user_id,google_link_status as status from public.finance_users where id='${OLD}'`), { active: true, org_status: 'system_account', auth_user_id: null, status: 'blocked' });
    assert.equal((await row(db, `select actual_actor_finance_user_id as actor from public.fixture_approval_history where id='fictional_completed_step'`)).actor, OLD);
    const other = await row(db, `select f.auth_user_id::text as auth,i.identity_data->>'email' as email from public.finance_users f join auth.identities i on i.user_id=f.auth_user_id where f.id='${OTHER}'`);
    assert.deepEqual(other, { auth: OTHER_SUBJECT, email: OTHER_EMAIL });

    // Read/action acceptance uses the deployed runtime predicates, with a new
    // fictional session issued only after the provider identity has changed.
    assert.equal((await row(db, 'select (public.current_finance_user()).id as id')).id, null);
    const barePendingSql = "select source_no,assignee_finance_user_id from public.finance_approval_tasks_for_current_user('pending')";
    assert.deepEqual((await db.query(barePendingSql)).rows, [
      { source_no: 'fixture-20260603001', assignee_finance_user_id: TARGET },
    ], 'predecessor RPC exposed pending task to a revoked session');

    // A valid session paired with a finance row whose email disagrees with
    // the verified Google identity must also be denied by the bare RPC.
    await db.exec(`update auth.fixture_claims set user_id='${MISMATCH_SUBJECT}',session_id='${MISMATCH_SESSION}';`);
    assert.equal((await row(db, 'select public.finance_auth_session_active() as active')).active, true);
    assert.equal((await row(db, 'select (public.current_finance_user()).id as id')).id, null);
    assert.deepEqual((await db.query(barePendingSql)).rows, [
      { source_no: 'fixture-wrong-email', assignee_finance_user_id: MISMATCH },
    ], 'predecessor RPC trusted auth.uid even when verified Google email disagreed');

    await db.exec(`update auth.fixture_claims set user_id='${SUBJECT}',session_id='${SESSION}';`);
    const migrationPath = path.join(root, 'supabase/migrations/20261015172658_finance_approval_tasks_verified_session_v1.sql');
    await db.exec('begin;');
    await db.exec(fs.readFileSync(migrationPath, 'utf8'));
    await db.exec('commit;');
    assert.deepEqual((await db.query(barePendingSql)).rows, [], 'revoked session must see no task after migration');

    await db.exec(`update auth.fixture_claims set user_id='${MISMATCH_SUBJECT}',session_id='${MISMATCH_SESSION}';`);
    assert.deepEqual((await db.query(barePendingSql)).rows, [], 'wrong verified Google email must see no task after migration');
    await db.exec(`update auth.fixture_claims set user_id='${SUBJECT}',session_id='${SESSION}';`);

    await db.exec(`insert into auth.sessions values('${NEW_SESSION}','${SUBJECT}',now()+interval '1 day'); update auth.fixture_claims set session_id='${NEW_SESSION}';`);
    assert.equal((await row(db, 'select (public.current_finance_user()).id as id')).id, TARGET);
    assert.equal((await row(db, 'select public.finance_current_verified_google_email_v2() as email')).email, TARGET_EMAIL);
    assert.deepEqual((await db.query(barePendingSql)).rows, [
      { source_no: 'fixture-20260603001', assignee_finance_user_id: TARGET },
    ], 'fresh session with verified Google email retains assigned task');
    const visibleRequest = await row(db, `select e.no,e.status from public.expense_requests e where e.no='fixture-20260603001' and public.can_read_expense_request(e)`);
    assert.deepEqual(visibleRequest, { no: 'fixture-20260603001', status: 'pending_applicant_confirm' });
    const activeStep = `select private.finance_expense_actor_can_act(e.tenant_id,e,0,e.steps->0,(public.current_finance_user()).id,public.finance_current_verified_google_email_v2(),(public.current_finance_user()).role) as allowed from public.expense_requests e where e.id='fictional_request'`;
    assert.equal((await row(db, activeStep)).allowed, true);

    // A separate, verified fictional Google account cannot see or act on the
    // target's explicitly assigned applicant-confirm step.
    await db.exec(`update auth.fixture_claims set user_id='${OTHER_SUBJECT}',session_id='${OTHER_SESSION}';`);
    assert.equal((await row(db, 'select (public.current_finance_user()).id as id')).id, OTHER);
    assert.deepEqual((await db.query(barePendingSql)).rows, []);
    assert.equal((await row(db, `select count(*)::int n from public.expense_requests e where e.no='fixture-20260603001' and public.can_read_expense_request(e)`)).n, 0);
    assert.equal((await row(db, activeStep)).allowed, false);
    await db.exec(`update auth.fixture_claims set user_id='${SUBJECT}',session_id='${SESSION}';`);
    assert.equal((await row(db, 'select (public.current_finance_user()).id as id')).id, null);
    assert.deepEqual((await db.query(barePendingSql)).rows, []);
    assert.equal((await row(db, `select count(*)::int n from public.expense_requests e where e.no='fixture-20260603001' and public.can_read_expense_request(e)`)).n, 0);
    assert.equal((await row(db, activeStep)).allowed, false);
    await db.exec('delete from auth.fixture_claims;');
    assert.equal((await row(db, 'select auth.uid() as id')).id, null);
    assert.deepEqual((await db.query(barePendingSql)).rows, [], 'bare RPC without an authenticated subject must return no task');
    console.log('PASS isolated PGlite: deployed guards/finalizer plus direct task RPC regression; fresh verified session can read/act, revoked, unrelated and wrong-email sessions cannot');
    console.log('LIMITATION fixture uses fictional claims, local projection/org/authorization dependencies, and a modeled expense row; no production OAuth callback, RLS transport, UI rendering, payment, or employee login was exercised');
  } finally { await db.close(); }
}
main().catch(error => { console.error(error.code, error.message, error.query?.slice(Number(error.position) - 120, Number(error.position) + 120)); process.exitCode = 1; });
