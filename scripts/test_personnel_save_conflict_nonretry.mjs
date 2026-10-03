// Isolated PostgreSQL fixture for the adopted member function and the exact
// migration. This is not a replay of the production baseline.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

const memberMigration = await fs.readFile(new URL('../supabase/migrations/20260821143000_atomic_member_admin_v1.sql', import.meta.url), 'utf8');
const conflictMigration = await fs.readFile(new URL('../supabase/migrations/20261003042021_finance_personnel_save_conflict_nonretry_v1.sql', import.meta.url), 'utf8');
const conflictPostflight = await fs.readFile(new URL('./finance_personnel_save_conflict_postflight.sql', import.meta.url), 'utf8');
const originalMember = memberMigration.match(/create or replace function public\.finance_admin_upsert_member_atomic_v1\([\s\S]*?\$function\$;/i)?.[0];
assert.ok(originalMember, 'actual member function must be available for the fixture');
const memberFunction = originalMember.replace(
  'public.finance_admin_upsert_member_atomic_v1',
  'private.finance_admin_upsert_member_org_base_v1'
);
const googleFunction = `
create or replace function public.finance_admin_save_user_google_login_v2(
  p_finance_user_id text, p_requested_email text, p_expected_revision bigint
) returns jsonb language plpgsql security definer set search_path = '' as $function$
declare current_revision bigint;
begin
  select google_link_revision into current_revision from public.finance_users
  where id = p_finance_user_id for update;
  if p_expected_revision is distinct from current_revision then
    raise exception 'Google 登入綁定已由其他人更新。'
      using errcode = '40001';
  end if;
  update public.finance_users set pending_login_email = p_requested_email,
    google_link_revision = google_link_revision + 1
  where id = p_finance_user_id and google_link_revision = p_expected_revision;
  if not found then
    raise exception 'Google 登入綁定已由其他人更新。'
      using errcode = '40001';
  end if;
  return jsonb_build_object('ok', true);
end;
$function$;`;

const db = new PGlite();
const tenant = '11111111-1111-4111-8111-111111111111';
let checks = 0;
async function check(label, fn) {
  await fn();
  checks++;
  console.log(`PASS ${label}`);
}
async function query(sql, params = []) {
  return (await db.query(sql, params)).rows;
}
async function sqlstate(fn, expected, label) {
  await assert.rejects(fn, error => {
    assert.equal(error.code, expected, `${label}: SQLSTATE`);
    return true;
  });
}
const memberInput = (changes = {}) => ({
  id: 'staff', name: 'Staff', login_email: 'staff@suiyuecare.com',
  role: 'employee', entity_id: 'E1', department_code: 'D1', active: true,
  ...changes
});
const saveMember = (payload, revision) =>
  query('select private.finance_admin_upsert_member_org_base_v1($1,$2) result', [payload, revision]);

try {
  await db.exec(`
    create schema private; create schema auth; create schema extensions;
    create role anon; create role authenticated; create role service_role;
    create function extensions.digest(text,text) returns bytea language sql immutable
      as $$select sha256(convert_to($1,'UTF8'))$$;
    create function auth.uid() returns uuid language sql stable
      as $$select 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid$$;
    create function public.current_tenant_id() returns uuid language sql stable
      as $$select '${tenant}'::uuid$$;
    create function public.current_finance_user_id() returns text language sql stable
      as $$select 'admin'::text$$;
    create function public.current_finance_role() returns text language sql stable
      as $$select 'admin_director'::text$$;
    create table public.finance_department_units(
      id uuid primary key, tenant_id uuid, code text, active boolean, present_in_source boolean);
    create table public.finance_department_entity_scopes(
      tenant_id uuid, unit_id uuid, active boolean, entity_code text);
    create table public.finance_users(
      id text primary key, tenant_id uuid, name text, email text, role text,
      role_label text, entity_id text, department_code text, init text,
      active boolean, job_title text, extension text, org_contact_email text,
      org_status text, org_source text, org_source_updated_at timestamptz,
      google_link_status text, pending_login_email text,
      google_link_revision bigint default 0, google_link_status_detail text,
      member_revision bigint default 1, auth_user_id uuid);
    create function private.bump_member_revision() returns trigger language plpgsql as $$
      begin if new is distinct from old then new.member_revision := old.member_revision + 1; end if;
      return new; end;$$;
    create trigger bump_member_revision before update on public.finance_users
      for each row execute function private.bump_member_revision();
    create table public.employee_department_roles(
      tenant_id uuid, finance_user_id text, is_primary boolean, active boolean,
      department_code text, role_key text);
    create table private.finance_member_admin_events_v1(
      tenant_id uuid, finance_user_id text, action text, actor_finance_user_id text,
      actor_auth_user_id uuid, before_state jsonb, after_state jsonb);
    create table private.fixture_outbox(finance_user_id text, reason text);
    create function public.sync_finance_user_permission_runtime(p_user text,p_reason text)
    returns jsonb language plpgsql as $$begin
      insert into private.fixture_outbox values(p_user,p_reason);
      if current_setting('fixture.fail_runtime',true) = 'yes' then
        raise exception 'runtime rejected' using errcode = '55000';
      end if;
      return jsonb_build_object('ok',true);
    end;$$;
    insert into public.finance_department_units values
      ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','${tenant}','D1',true,true);
    insert into public.finance_department_entity_scopes values
      ('${tenant}','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',true,'E1');
    insert into public.finance_users(id,tenant_id,name,email,role,entity_id,department_code,active,member_revision)
      values('staff','${tenant}','Staff','staff@suiyuecare.com','employee','E1','D1',true,2);
    insert into public.employee_department_roles values('${tenant}','staff',true,true,'D1','employee');
    set check_function_bodies=off;
  `);
  await db.exec(memberFunction);
  await db.exec(googleFunction);
  await db.exec(`
    revoke all on function private.finance_admin_upsert_member_org_base_v1(jsonb,bigint) from public;
    revoke all on function public.finance_admin_save_user_google_login_v2(text,text,bigint)
      from public, anon, authenticated, service_role;
    grant execute on function public.finance_admin_save_user_google_login_v2(text,text,bigint)
      to authenticated, service_role;
    set check_function_bodies=on;
  `);

  const signatures = [
    ['private.finance_admin_upsert_member_org_base_v1(jsonb,bigint)', '72c2c2f437b26e8209603a371fff755ddfdd1b4d5db5a7fca29f2296b982bf6d'],
    ['public.finance_admin_save_user_google_login_v2(text,text,bigint)', '9898abc1966d39560c53f16fee8ccd92c4a04ed1b1f9a2aa6cda65c6b421cc2d']
  ];
  const fixtureSources = await query(`select case
      when oid = 'private.finance_admin_upsert_member_org_base_v1(jsonb,bigint)'::regprocedure
        then 'private.finance_admin_upsert_member_org_base_v1(jsonb,bigint)'
      else 'public.finance_admin_save_user_google_login_v2(text,text,bigint)'
    end signature,
    encode(extensions.digest(pg_get_functiondef(oid),'sha256'),'hex') hash,
    proowner, proacl, prosecdef, proconfig
    from pg_proc where oid in (
      'private.finance_admin_upsert_member_org_base_v1(jsonb,bigint)'::regprocedure,
      'public.finance_admin_save_user_google_login_v2(text,text,bigint)'::regprocedure)
    order by oid::regprocedure::text`);
  const fixtureHash = signature => fixtureSources.find(row => row.signature === signature)?.hash;
  let executableMigration = conflictMigration;
  let fixturePostflight = conflictPostflight.replace(/^\\set ON_ERROR_STOP on\s*/,'');
  for (const [signature, productionHash] of signatures) {
    assert.ok(fixtureHash(signature), `fixture function exists: ${signature}`);
    executableMigration = executableMigration.replace(productionHash, fixtureHash(signature));
    fixturePostflight = fixturePostflight.replace(productionHash, fixtureHash(signature));
  }
  await check('rollback rehearsal restores both original functions after PT409 verification', async () => {
    await db.exec('begin');
    try {
      await db.exec(executableMigration);
      await sqlstate(() => saveMember(memberInput(), 0), 'PT409', 'rehearsal conflict');
    } finally {
      await db.exec('rollback');
    }
    const after = await query(`select oid::regprocedure::text signature,
      encode(extensions.digest(pg_get_functiondef(oid),'sha256'),'hex') hash
      from pg_proc where oid in (
        'private.finance_admin_upsert_member_org_base_v1(jsonb,bigint)'::regprocedure,
        'public.finance_admin_save_user_google_login_v2(text,text,bigint)'::regprocedure)`);
    assert.deepEqual(after.map(row => row.hash).sort(), fixtureSources.map(row => row.hash).sort());
    await sqlstate(() => saveMember(memberInput(), 0), '40001', 'rollback restores original SQLSTATE');
  });
  await check('second function fingerprint failure rolls back first function replacement', async () => {
    const badSecondFingerprint = executableMigration.replace(fixtureHash(signatures[1][0]), '0'.repeat(64));
    await sqlstate(() => db.exec(badSecondFingerprint), 'P0001', 'second fingerprint');
    const after = await query(`select oid::regprocedure::text signature,
      encode(extensions.digest(pg_get_functiondef(oid),'sha256'),'hex') hash
      from pg_proc where oid in (
        'private.finance_admin_upsert_member_org_base_v1(jsonb,bigint)'::regprocedure,
        'public.finance_admin_save_user_google_login_v2(text,text,bigint)'::regprocedure)`);
    assert.deepEqual(after.map(row => row.hash).sort(), fixtureSources.map(row => row.hash).sort());
  });
  await db.exec(executableMigration);

  await check('read-only postflight verifies exact transformed source and grants', async () => {
    await db.exec(fixturePostflight);
  });

  await check('migration keeps function owner, grants, SECURITY DEFINER and search_path', async () => {
    const after = await query(`select case
        when oid = 'private.finance_admin_upsert_member_org_base_v1(jsonb,bigint)'::regprocedure
          then 'private.finance_admin_upsert_member_org_base_v1(jsonb,bigint)'
        else 'public.finance_admin_save_user_google_login_v2(text,text,bigint)'
      end signature,
      proowner, proacl, prosecdef, proconfig
      from pg_proc where oid in (
        'private.finance_admin_upsert_member_org_base_v1(jsonb,bigint)'::regprocedure,
        'public.finance_admin_save_user_google_login_v2(text,text,bigint)'::regprocedure)
      order by oid::regprocedure::text`);
    assert.deepEqual(after, fixtureSources.map(({hash, ...metadata}) => metadata));
  });
  await check('stale member edit returns nonretryable PT409 without a write', async () => {
    await sqlstate(() => saveMember(memberInput({name: 'Wrong'}), 0), 'PT409', 'stale member');
    assert.deepEqual((await query("select name,member_revision from public.finance_users where id='staff'"))[0],
      {name: 'Staff', member_revision: 2});
    assert.equal((await query('select count(*)::int count from private.finance_member_admin_events_v1'))[0].count, 0);
  });
  await check('new member with nonzero revision returns PT409 without a write', async () => {
    await sqlstate(() => saveMember(memberInput({id: null, login_email: 'new@suiyuecare.com'}), 5),
      'PT409', 'new member revision');
    assert.equal((await query('select count(*)::int count from public.finance_users'))[0].count, 1);
  });
  await check('matching member revision saves once and records its event and outbox', async () => {
    const result = (await saveMember(memberInput({name: 'Updated'}), 2))[0].result;
    assert.equal(result.ok, true);
    assert.equal(result.member.member_revision, 3);
    assert.equal((await query('select count(*)::int count from private.finance_member_admin_events_v1'))[0].count, 1);
    assert.equal((await query('select count(*)::int count from private.fixture_outbox'))[0].count, 1);
  });
  await check('late update conflict returns PT409 and rolls back side effects', async () => {
    await db.exec(`create function private.suppress_member_update() returns trigger language plpgsql
      as $$begin return null;end;$$;
      create trigger suppress_member_update before update on public.finance_users
      for each row execute function private.suppress_member_update();`);
    await sqlstate(() => saveMember(memberInput({name: 'Suppressed'}), 3), 'PT409', 'late update');
    await db.exec('drop trigger suppress_member_update on public.finance_users');
    assert.equal((await query("select name from public.finance_users where id='staff'"))[0].name, 'Updated');
    assert.equal((await query('select count(*)::int count from private.fixture_outbox'))[0].count, 1);
  });
  await check('runtime failure still rolls back member, event and outbox atomically', async () => {
    await query("select set_config('fixture.fail_runtime','yes',false)");
    await sqlstate(() => saveMember(memberInput({name: 'Rejected'}), 3), '55000', 'runtime failure');
    await query("select set_config('fixture.fail_runtime','no',false)");
    assert.deepEqual((await query("select name,member_revision from public.finance_users where id='staff'"))[0],
      {name: 'Updated', member_revision: 3});
    assert.equal((await query('select count(*)::int count from private.finance_member_admin_events_v1'))[0].count, 1);
    assert.equal((await query('select count(*)::int count from private.fixture_outbox'))[0].count, 1);
  });
  await check('Google binding stale revision returns PT409; valid revision still saves', async () => {
    await sqlstate(() => query("select public.finance_admin_save_user_google_login_v2('staff','new@suiyuecare.com',4)"),
      'PT409', 'Google stale revision');
    const result = await query("select public.finance_admin_save_user_google_login_v2('staff','new@suiyuecare.com',0) result");
    assert.equal(result[0].result.ok, true);
    assert.equal((await query("select pending_login_email from public.finance_users where id='staff'"))[0].pending_login_email,
      'new@suiyuecare.com');
  });
  await check('late Google binding update conflict also returns PT409', async () => {
    await db.exec(`create trigger suppress_google_update before update on public.finance_users
      for each row execute function private.suppress_member_update();`);
    await sqlstate(() => query("select public.finance_admin_save_user_google_login_v2('staff','later@suiyuecare.com',1)"),
      'PT409', 'late Google update');
    await db.exec('drop trigger suppress_google_update on public.finance_users');
    assert.equal((await query("select pending_login_email from public.finance_users where id='staff'"))[0].pending_login_email,
      'new@suiyuecare.com');
  });
  await check('source guard rejects a drifted function before changing either function', async () => {
    const before = await query(`select pg_get_functiondef('public.finance_admin_save_user_google_login_v2(text,text,bigint)'::regprocedure) definition`);
    await sqlstate(() => db.exec(executableMigration), 'P0001', 'source drift');
    const after = await query(`select pg_get_functiondef('public.finance_admin_save_user_google_login_v2(text,text,bigint)'::regprocedure) definition`);
    assert.deepEqual(after, before);
  });
  await check('read-only postflight rejects a changed grant', async () => {
    await db.exec('revoke execute on function public.finance_admin_save_user_google_login_v2(text,text,bigint) from service_role');
    try {
      await sqlstate(() => db.exec(fixturePostflight), 'P0001', 'postflight ACL drift');
    } finally {
      await db.exec('rollback');
      await db.exec('grant execute on function public.finance_admin_save_user_google_login_v2(text,text,bigint) to service_role');
    }
  });
  await check('read-only postflight rejects source drift', async () => {
    await db.exec(googleFunction.replaceAll("errcode = '40001'", "errcode = 'PT409'")
      .replace('Google 登入綁定已由其他人更新。', 'Google 登入資料已變更。'));
    try {
      await sqlstate(() => db.exec(fixturePostflight), 'P0001', 'postflight source drift');
    } finally {
      await db.exec('rollback');
    }
  });

  console.log(`Personnel save conflict migration: ${checks} isolated database checks passed.`);
} finally {
  await db.close();
}
