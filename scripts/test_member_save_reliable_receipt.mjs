// Isolated PostgreSQL exercise of the reviewed public wrapper and the new
// receipt migration. The fixture base writer is synthetic; production source
// fingerprints in the migration prevent applying it to a different baseline.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

const orgSql = await fs.readFile(new URL('../supabase/migrations/20260821150000_versioned_org_designer_v1.sql', import.meta.url), 'utf8');
const wrapperSql = await fs.readFile(new URL('../supabase/migrations/20260907154759_finance_org_integrity_v2.sql', import.meta.url), 'utf8');
const migration = await fs.readFile(new URL('../supabase/migrations/20261003044426_finance_member_save_reliable_receipt_v1.sql', import.meta.url), 'utf8');
const postflight = await fs.readFile(new URL('./finance_member_save_reliable_receipt_postflight.sql', import.meta.url), 'utf8');
const extract = (source, name) => {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = source.match(new RegExp(`create or replace function ${escaped}\\([\\s\\S]*?\\$(?:function|fn)\\$;`, 'i'));
  assert.ok(match, `missing real function ${name}`);
  return match[0];
};
const actorFunction = extract(orgSql, 'private.finance_membership_org_actor_v1');
const atomicWrapper = extract(wrapperSql, 'public.finance_admin_upsert_member_atomic_v1');
const baseFunction = `
create or replace function private.finance_admin_upsert_member_org_base_v1(
  p_member jsonb, p_expected_revision bigint
) returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_tenant uuid := public.current_tenant_id();
  v_actor_role text := public.current_finance_role();
  v_user public.finance_users%rowtype;
  v_id text := nullif(p_member ->> 'id','');
begin
  if auth.uid() is null or v_actor_role not in ('ceo','admin_director','hr') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_actor_role = 'hr' and p_member ->> 'role' in ('ceo','accountant') then
    raise exception 'HR cannot assign finance control' using errcode = '42501';
  end if;
  if v_id is not null then
    select * into v_user from public.finance_users
      where tenant_id = v_tenant and id = v_id for update;
    if not found then raise exception 'member missing' using errcode = 'P0002'; end if;
    if p_expected_revision is distinct from v_user.member_revision then
      raise exception 'member changed' using errcode = 'PT409';
    end if;
    if v_actor_role = 'hr' and v_user.role in ('ceo','accountant') then
      raise exception 'HR cannot edit finance control' using errcode = '42501';
    end if;
    update public.finance_users set name = p_member ->> 'name',
      role = p_member ->> 'role', member_revision = member_revision + 1
      where tenant_id = v_tenant and id = v_id and member_revision = p_expected_revision
      returning * into v_user;
    if not found then raise exception 'member changed' using errcode = 'PT409'; end if;
  else
    if coalesce(p_expected_revision,0) <> 0 then
      raise exception 'new member revision must be zero' using errcode = 'PT409';
    end if;
    insert into public.finance_users(id,tenant_id,name,email,role,active,member_revision)
      values('u_' || replace(gen_random_uuid()::text,'-',''),v_tenant,
        p_member ->> 'name',p_member ->> 'login_email',p_member ->> 'role',true,1)
      returning * into v_user;
  end if;
  insert into private.fixture_outbox(member_id) values(v_user.id);
  return jsonb_build_object('ok',true,'atomic',true,'member',to_jsonb(v_user));
end;
$function$;`;

const db = new PGlite();
const tenant = '11111111-1111-4111-8111-111111111111';
const adminAuth = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const hrAuth = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const otherAuth = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const request = '11111111-aaaa-4aaa-8aaa-111111111111';
let checks = 0;
const run = async (name, fn) => { await fn(); checks++; console.log(`PASS ${name}`); };
const rows = async (sql, params = []) => (await db.query(sql, params)).rows;
const one = async (sql, params = []) => (await rows(sql, params))[0];
const asActor = async (authId, userId = 'admin') => {
  await db.query("select set_config('fixture.auth',$1,false),set_config('fixture.user',$2,false),set_config('fixture.tenant',$3,false)",
    [authId, userId, tenant]);
};
const save = async (member, revision, id = request) =>
  (await one('select public.finance_admin_upsert_member_reliable_v1($1,$2,$3) result',
    [member, revision, id])).result;
const state = async (fn, code, detail) => {
  await assert.rejects(fn, error => {
    assert.equal(error.code, code);
    if (detail) assert.equal(error.detail, detail);
    return true;
  });
};
const member = (changes = {}) => ({
  id: 'staff', name: 'New Name', login_email: 'staff@suiyuecare.com',
  role: 'employee', ...changes
});
const uuid = number => `22222222-aaaa-4aaa-8aaa-${String(number).padStart(12, '0')}`;

try {
  await db.exec(`
    create schema private; create schema auth; create schema extensions;
    create role anon; create role authenticated; create role service_role;
    create function extensions.digest(text,text) returns bytea language sql immutable
      as $$select sha256(convert_to($1,'UTF8'))$$;
    create function auth.uid() returns uuid language sql stable
      as $$select nullif(current_setting('fixture.auth',true),'')::uuid$$;
    create function public.current_tenant_id() returns uuid language sql stable
      as $$select nullif(current_setting('fixture.tenant',true),'')::uuid$$;
    create function public.current_finance_user_id() returns text language sql stable
      as $$select nullif(current_setting('fixture.user',true),'')$$;
    create table public.finance_users(
      id text primary key, tenant_id uuid, auth_user_id uuid, name text,
      email text, role text, active boolean, member_revision bigint);
    create function public.current_finance_role() returns text language sql stable
      as $$select role from public.finance_users where tenant_id=public.current_tenant_id()
        and id=public.current_finance_user_id()$$;
    create function public.is_finance_admin() returns boolean language sql stable
      as $$select public.current_finance_role() in ('ceo','admin_director')$$;
    create table private.fixture_outbox(member_id text);
    create function private.finance_org_publish_runtime_v2(uuid,text,text)
    returns jsonb language plpgsql as $$begin
      if current_setting('fixture.fail_org',true)='yes' then
        raise exception 'org projection failed' using errcode='55000';
      end if;
      return jsonb_build_object('org_version_id','fixture-org');
    end;$$;
    create function private.finance_org_runtime_revision_v2(uuid)
    returns text language sql as $$select 'fixture-rev'::text$$;
    insert into public.finance_users values
      ('admin','${tenant}','${adminAuth}','Admin','admin@suiyuecare.com','admin_director',true,1),
      ('hr','${tenant}','${hrAuth}','HR','hr@suiyuecare.com','hr',true,1),
      ('staff','${tenant}',null,'Staff','staff@suiyuecare.com','employee',true,4);
    set check_function_bodies=off;
  `);
  await db.exec(actorFunction);
  await db.exec(baseFunction);
  await db.exec(atomicWrapper);
  await db.exec(`
    revoke all on function public.finance_admin_upsert_member_atomic_v1(jsonb,bigint)
      from public,anon,authenticated,service_role;
    grant execute on function public.finance_admin_upsert_member_atomic_v1(jsonb,bigint)
      to authenticated,service_role;
    set check_function_bodies=on;
  `);
  const sourceBefore = await rows(`select p.oid::regprocedure::text signature,
    encode(extensions.digest(pg_get_functiondef(p.oid),'sha256'),'hex') hash
    from pg_proc p where p.oid in (
      'public.finance_admin_upsert_member_atomic_v1(jsonb,bigint)'::regprocedure,
      'private.finance_admin_upsert_member_org_base_v1(jsonb,bigint)'::regprocedure,
      'private.finance_membership_org_actor_v1(boolean,boolean)'::regprocedure)`);
  const hash = name => sourceBefore.find(item => item.signature.includes(name))?.hash;
  let fixtureMigration = migration
    .replace('6679fa1fd91141a94d91923ed266940ba4ece0eb1d0fba29d9a737e1a43e816b',
      hash('finance_admin_upsert_member_atomic_v1'))
    .replace('4bdf93b7d07c2a38e9c01089fb45fc8e4661044976043b9651f4184ed817354c',
      hash('finance_admin_upsert_member_org_base_v1'))
    .replace('6a1cc3b287fa47be2efd15cee1939626e15ea8bf01a59dcf88f6de423cf07c3e',
      hash('finance_membership_org_actor_v1'));
  assert.notEqual(fixtureMigration, migration);
  const fixturePostflight = postflight.replace(/^\\set ON_ERROR_STOP on\s*/, '')
    .replace('6679fa1fd91141a94d91923ed266940ba4ece0eb1d0fba29d9a737e1a43e816b',
      hash('finance_admin_upsert_member_atomic_v1'))
    .replace('4bdf93b7d07c2a38e9c01089fb45fc8e4661044976043b9651f4184ed817354c',
      hash('finance_admin_upsert_member_org_base_v1'))
    .replace('6a1cc3b287fa47be2efd15cee1939626e15ea8bf01a59dcf88f6de423cf07c3e',
      hash('finance_membership_org_actor_v1'));
  await run('migration transaction rehearsal leaves no receipt artifacts after rollback', async () => {
    await db.exec('begin');
    try {
      await db.exec(fixtureMigration);
      await db.exec(fixturePostflight);
    } finally {
      await db.exec('rollback');
    }
    const absent = await one(`select to_regclass('private.finance_member_save_receipts_v1') is null
      and to_regprocedure('public.finance_admin_upsert_member_reliable_v1(jsonb,bigint,uuid)') is null ok`);
    assert.equal(absent.ok, true);
  });
  await db.exec(fixtureMigration);
  await asActor(adminAuth);

  await run('read-only postflight verifies source, ACL, RLS and composite key', async () => {
    await db.exec(fixturePostflight);
  });

  await run('first edit writes one member, org result, outbox and receipt', async () => {
    const result = await save(member(), 4);
    assert.equal(result.ok, true);
    assert.equal(result.atomic, true);
    assert.equal(result.member.member_revision, 5);
    assert.equal(result.org_version_id, 'fixture-org');
    assert.equal((await one('select count(*)::int n from private.fixture_outbox')).n, 1);
    assert.equal((await one('select count(*)::int n from private.finance_member_save_receipts_v1')).n, 1);
  });
  await run('same request replays exact atomic result without another write', async () => {
    const original = (await one('select result from private.finance_member_save_receipts_v1')).result;
    const replay = await save(member(), 4);
    assert.deepEqual(replay, {...original, replayed: true});
    assert.equal((await one("select member_revision from public.finance_users where id='staff'")).member_revision, 5);
    assert.equal((await one('select count(*)::int n from private.fixture_outbox')).n, 1);
  });
  // PGlite uses one backend session. This proves duplicate calls serialize to
  // one write here; MEMBER_REQUEST_PENDING needs a separate-session canary.
  await run('two serialized same-key calls return one write and one replay', async () => {
    const requestId = uuid(2);
    const payload = member({name: 'Concurrent'});
    const results = await Promise.all([save(payload, 5, requestId), save(payload, 5, requestId)]);
    assert.equal(results.filter(item => item.replayed === true).length, 1);
    assert.equal((await one("select member_revision from public.finance_users where id='staff'")).member_revision, 6);
    assert.equal((await one('select count(*)::int n from private.fixture_outbox')).n, 2);
  });
  await run('same UUID with changed payload or revision returns PT409 without a write', async () => {
    await state(() => save(member({name: 'Different'}), 4), 'PT409', 'MEMBER_REQUEST_PAYLOAD_MISMATCH');
    await state(() => save(member(), 5), 'PT409', 'MEMBER_REQUEST_PAYLOAD_MISMATCH');
    assert.equal((await one('select count(*)::int n from private.fixture_outbox')).n, 2);
  });
  await run('stale revision on a new request writes no receipt or member', async () => {
    await state(() => save(member({name: 'Stale'}), 4, uuid(3)), 'PT409');
    assert.equal((await one("select member_revision from public.finance_users where id='staff'")).member_revision, 6);
    assert.equal((await one('select count(*)::int n from private.finance_member_save_receipts_v1')).n, 2);
  });
  await run('new member request replays its generated ID instead of creating twice', async () => {
    const requestId = uuid(4);
    const payload = member({id: null, name: 'New Member', login_email: 'new@suiyuecare.com'});
    const first = await save(payload, 0, requestId);
    const replay = await save(payload, 0, requestId);
    assert.equal(replay.member.id, first.member.id);
    assert.equal(replay.replayed, true);
    assert.equal((await one("select count(*)::int n from public.finance_users where email='new@suiyuecare.com'")).n, 1);
  });
  await run('org projection failure rolls back member, outbox and receipt', async () => {
    await db.query("select set_config('fixture.fail_org','yes',false)");
    const before = await one("select member_revision,name from public.finance_users where id='staff'");
    const outboxBefore = (await one('select count(*)::int n from private.fixture_outbox')).n;
    const receiptBefore = (await one('select count(*)::int n from private.finance_member_save_receipts_v1')).n;
    await state(() => save(member({name: 'Rolled Back'}), 6, uuid(5)), '55000');
    await db.query("select set_config('fixture.fail_org','no',false)");
    assert.deepEqual(await one("select member_revision,name from public.finance_users where id='staff'"), before);
    assert.equal((await one('select count(*)::int n from private.fixture_outbox')).n, outboxBefore);
    assert.equal((await one('select count(*)::int n from private.finance_member_save_receipts_v1')).n, receiptBefore);
  });
  await run('revoked or remapped actor cannot replay an old receipt', async () => {
    await db.exec("update public.finance_users set role='employee' where id='admin'");
    await state(() => save(member(), 4), '42501');
    await db.exec("update public.finance_users set role='hr' where id='admin'");
    await state(() => save(member(), 4), '42501');
    await db.exec("update public.finance_users set role='admin_director' where id='admin'");
    await db.query("update public.finance_users set auth_user_id=$1 where id='admin'", [otherAuth]);
    await state(() => save(member(), 4), '42501');
    await db.query("update public.finance_users set auth_user_id=$1 where id='admin'", [adminAuth]);
  });
  await run('HR cannot request, edit or replay finance-control member data', async () => {
    await asActor(hrAuth, 'hr');
    await state(() => save(member({role: 'accountant'}), 6, uuid(6)), '42501');
    const hrRequest = uuid(7);
    const hrPayload = member({name: 'HR Edited'});
    await save(hrPayload, 6, hrRequest);
    await db.exec("update public.finance_users set role='accountant' where id='staff'");
    await state(() => save(hrPayload, 6, hrRequest), '42501');
    await state(() => save(member({name: 'HR Blocked'}), 7, uuid(8)), '42501');
  });
  await run('receipt table is private, RLS enabled and original wrapper source unchanged', async () => {
    const metadata = await one(`select c.relrowsecurity,p.prosecdef,p.proconfig,p.proacl::text acl
      from pg_class c cross join pg_proc p
      where c.oid='private.finance_member_save_receipts_v1'::regclass
        and p.oid='public.finance_admin_upsert_member_reliable_v1(jsonb,bigint,uuid)'::regprocedure`);
    assert.equal(metadata.relrowsecurity, true);
    assert.equal(metadata.prosecdef, true);
    assert.deepEqual(metadata.proconfig, ['search_path=""']);
    assert.equal(metadata.acl, '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}');
    const sourceAfter = await rows(`select p.oid::regprocedure::text signature,
      encode(extensions.digest(pg_get_functiondef(p.oid),'sha256'),'hex') hash
      from pg_proc p where p.oid in (
        'public.finance_admin_upsert_member_atomic_v1(jsonb,bigint)'::regprocedure,
        'private.finance_admin_upsert_member_org_base_v1(jsonb,bigint)'::regprocedure,
        'private.finance_membership_org_actor_v1(boolean,boolean)'::regprocedure)`);
    assert.deepEqual(sourceAfter, sourceBefore);
    await db.exec('set role authenticated');
    try { await state(() => rows('select * from private.finance_member_save_receipts_v1'), '42501'); }
    finally { await db.exec('reset role'); }
  });

  console.log(`Reliable personnel receipt: ${checks} isolated database checks passed.`);
} finally {
  await db.close();
}
