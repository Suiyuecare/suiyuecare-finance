import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {PGlite} from '@electric-sql/pglite';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const require = createRequire(import.meta.url);
const scripts = new URL('.', import.meta.url);
const realActorFiles = fs.readdirSync(scripts).filter(name => /^finance_.*canary\.sql$/.test(name)).map(name => ({name, source: fs.readFileSync(new URL(name, scripts), 'utf8')})).filter(row => row.source.includes('v_canary_session_id'));
const pattern = /v_canary_session_id := null;\s*if pg_catalog\.to_regprocedure\('public\.finance_auth_session_active\(\)'\) is not null then[\s\S]*?end if;\s*end if;\s*perform\s+(?:pg_catalog\.)?set_config\(\s*'request.jwt.claims',\s*(?:pg_catalog\.)?jsonb_build_object\([\s\S]*?\)::text,\s*true\s*\);/g;
let checks = 0;
const pass = message => {checks++; console.log('PASS '+message);};
assert.equal(realActorFiles.length, 11);
const cases = realActorFiles.flatMap(({name, source}) => [...source.matchAll(pattern)].map(match => ({name, sql: match[0], subject: match[0].match(/using ([a-zA-Z_0-9.]+);/)[1]})));
assert.equal(cases.length, 24);
for (const {name, source} of realActorFiles) {
  assert.doesNotMatch(source, /(?:insert\s+into|update|delete\s+from)\s+auth\.sessions|lock\s+table\s+auth\.sessions|from\s+auth\.sessions[^;\n]*for\s+update/i, name+' may only read genuine sessions');
  for (const match of source.matchAll(/jsonb_build_object\(\s*'sub',[\s\S]*?\)::text/g)) assert.match(match[0], /'session_id',\s*v_canary_session_id/);
}
pass('all 24 genuine-actor claims include a session; no Auth session mutation or lock');

const db = new PGlite();
const uid = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const older = '33333333-3333-4333-8333-333333333333';
const current = '44444444-4444-4444-8444-444444444444';
const foreign = '55555555-5555-4555-8555-555555555555';
const expired = '66666666-6666-4666-8666-666666666666';
try {
  await db.exec(`create schema auth;create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;create function auth.uid() returns uuid language sql stable as $$select nullif(auth.jwt()->>'sub','')::uuid$$;`);
  const run = async ({sql, subject}) => {
    const scalar = !subject.includes('.');
    const declaration = scalar ? `${subject} uuid := '${uid}';` : `${subject.split('.')[0]} record;`;
    // Claims retain the actual source block; only synthetic fixture variables
    // replace its separate verified employee object in this isolated database.
    const fill = scalar ? '' : `select '${uid}'::uuid auth_user_id,'fixture@example.invalid'::text email into ${subject.split('.')[0]};`;
    let source = sql;
    for (const email of ['v_applicant_email', 'v_supervisor_email', 'v_xu_applicant_email']) source = source.replaceAll(email, "'fixture@example.invalid'");
    await db.exec('begin');
    try {
      await db.exec(`do $case$ declare v_canary_session_id uuid;${declaration} begin ${fill}${source} end;$case$;`);
      const claims = (await db.query("select auth.jwt() claims")).rows[0].claims;
      if (claims.session_id) assert.equal((await db.query('select public.finance_auth_session_active() active')).rows[0].active, true);
      await db.exec('rollback');
      return claims;
    } catch (error) {await db.exec('rollback'); throw error;}
  };
  for (const item of cases) assert.equal((await run(item)).session_id, null);
  pass('actual 24 blocks remain compatible with legacy phases without session helper/table');
  await db.exec('create table auth.sessions(id uuid primary key,user_id uuid,not_after timestamptz,created_at timestamptz,updated_at timestamptz);');
  const migration = fs.readFileSync(new URL('../supabase/migrations/20260927180201_finance_portal_session_logout.sql', import.meta.url), 'utf8');
  const sessionHelper = migration.slice(migration.indexOf('create function public.finance_auth_session_active()'), migration.indexOf('revoke all on function public.finance_auth_session_active()'));
  await db.exec(sessionHelper);
  await db.query(`insert into auth.sessions values($1,$2,null,now()-interval '1 hour',now()),($3,$2,now()+interval '1 hour',now(),now()),($4,$5,null,now()+interval '1 day',now()),($6,$2,now()-interval '1 second',now()+interval '2 days',now())`, [older, uid, current, foreign, other, expired]);
  const fingerprint = async () => (await db.query('select jsonb_agg(to_jsonb(s) order by id) rows from auth.sessions s')).rows[0].rows;
  const before = await fingerprint();
  await db.exec(`create table public.finance_users(id text,tenant_id uuid,active boolean,auth_user_id uuid);insert into public.finance_users values('first-no-session','${uid}',true,'77777777-7777-4777-8777-777777777777'),('next-active','${uid}',true,'${uid}'),('foreign-tenant','${other}',true,'${other}');`);
  for (const {name, source} of realActorFiles.filter(row => row.name !== 'finance_production_authenticated_canary.sql')) {
    const map = source.match(/if pg_catalog\.to_regprocedure\('public\.finance_auth_session_active\(\)'\) is not null then\s*execute 'select coalesce\(array_agg\(distinct s.user_id\)[\s\S]*?end if;/)?.[0];
    assert.ok(map, name+' candidate map must be scoped to tenant and active sessions');
    const tenantName = map.match(/using ([a-z_]+);/)[1];
    assert.match(source, /where \(v_canary_active_session_users is null or u\.auth_user_id=any\(v_canary_active_session_users\)\) and u\.tenant_id=/);
    await db.exec(`do $map$ declare ${tenantName} uuid := '${uid}';v_canary_active_session_users uuid[];picked text;begin ${map} select u.id into picked from public.finance_users u where (v_canary_active_session_users is null or u.auth_user_id=any(v_canary_active_session_users)) and u.tenant_id=${tenantName} and u.active order by u.id limit 1;if picked is distinct from 'next-active' then raise exception 'Candidate did not skip expired/missing/foreign tenant session';end if;end;$map$;`);
  }
  assert.deepEqual(await fingerprint(), before);
  pass('all 10 dynamic candidate maps skip missing-session first candidate and exclude foreign tenant without changing sessions');
  for (const item of cases) {
    const claims = await run(item);
    assert.equal(claims.session_id, current, item.name+' chooses latest unexpired session of exact UID');
    assert.equal(claims.sub, uid);
  }
  assert.deepEqual(await fingerprint(), before);
  pass('actual 24 blocks select exact UID latest active session; helper authorizes and table remains identical');
  await db.query('delete from auth.sessions where id=$1', [current]);
  for (const item of cases) assert.equal((await run(item)).session_id, older);
  pass('revoked latest session is never reused; existing older active session selected');
  await db.query('delete from auth.sessions where id=$1', [older]);
  for (const item of cases) await assert.rejects(() => run(item), /requires an existing active session/);
  assert.equal((await db.query('select count(*)::int n from auth.sessions')).rows[0].n, 2);
  pass('missing/expired actor sessions fail closed for all blocks; foreign sessions cannot substitute');
} finally {await db.close();}

const synthetic = new PGlite();
try {
  const {createStatementSourceCanaryFixture} = require('./check_statement_source_canary.cjs');
  await createStatementSourceCanaryFixture(synthetic);
  await synthetic.exec(`create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id),not_after timestamptz,created_at timestamptz,updated_at timestamptz);create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;`);
  const source = fs.readFileSync(new URL('finance_statement_source_canary.sql', scripts), 'utf8');
  const migration = fs.readFileSync(new URL('../supabase/migrations/20260927180201_finance_portal_session_logout.sql', import.meta.url), 'utf8');
  await synthetic.exec(migration.slice(migration.indexOf('create function public.finance_auth_session_active()'), migration.indexOf('revoke all on function public.finance_auth_session_active()')));
  // Preserve the real fixture identity implementation and enforce the actual
  // new helper around it; no mocked success or guard bypass is introduced.
  await synthetic.exec(`alter function public.current_finance_user() rename to fixture_legacy_current_finance_user;create function public.current_finance_user() returns public.finance_users language sql stable security definer set search_path='' as $$select public.fixture_legacy_current_finance_user() where public.finance_auth_session_active()$$;`);
  await synthetic.exec(source);
  assert.equal((await synthetic.query('select count(*)::int n from auth.sessions')).rows[0].n, 0);
  assert.equal((await synthetic.query('select count(*)::int n from auth.users')).rows[0].n, 0);
  pass('complete real statement canary passes new session fence with isolated synthetic session, then fully rolls back');
  const noSession = source.replace(/execute 'insert into auth\.sessions\([^\n]+\n\s*using sid,uid;/, 'null;');
  await assert.rejects(() => synthetic.exec(noSession), /Synthetic employee did not resolve/);
  await synthetic.exec('rollback');
  assert.equal((await synthetic.query('select count(*)::int n from auth.sessions')).rows[0].n, 0);
  pass('synthetic statement canary fails without matching fixture session; failure also rolls back');
} finally {await synthetic.close();}

// Validate every actual final SQL result against the release parser. This is
// output-contract coverage only; the protected workflow still executes each
// complete canary, including its role, rollback and business assertions.
const outputDb = new PGlite();
const outputDir = fs.mkdtempSync(join(tmpdir(), 'finance-canary-output-contracts-'));
try {
  const guard = require('./finance_production_release_guard.js');
  const guardSource = fs.readFileSync(new URL('finance_production_release_guard.js', scripts), 'utf8');
  const domains = new Map([...guardSource.matchAll(/(\w+):\{marker:'[^']+',result:\{canary:'([^']+)'/g)].map(match => [match[2], match[1]]));
  let verified = 0;
  for (const name of fs.readdirSync(scripts).filter(name => /^finance_.*canary\.sql$/.test(name))) {
    // The separate human-accounting gate does not use these release parsers.
    if (name === 'finance_production_human_accounting_canary.sql') continue;
    const source = fs.readFileSync(new URL(name, scripts), 'utf8');
    const select = source.match(/(?:^|\n)(select\s+(?:pg_catalog\.)?jsonb_build_object\([\s\S]*?\)\s+as\s+\w+\s*;)\s*$/i)?.[1];
    assert.ok(select, name+' final output must be explicitly verified');
    const file = join(outputDir, name+'.json');
    fs.writeFileSync(file, JSON.stringify(await outputDb.exec(select)));
    if (name === 'finance_production_authenticated_canary.sql') guard.verifyAuthenticatedCanary(file);
    else if (name === 'finance_finalize_accounting_lines_canary.sql') guard.verifyFinalizeCanary(file);
    else if (name === 'finance_utility_tax_canary.sql') guard.verifyUtilityCanary(file);
    else {
      const canary = select.match(/'canary'\s*,\s*'([^']+)'/)?.[1];
      assert.ok(domains.has(canary), name+' must have a protected report domain');
      guard.verifyReportsCanary(file, domains.get(canary));
    }
    verified++;
  }
  assert.equal(verified, 27, 'every protected authenticated/report/finalize/utility final SQL result is covered');
  pass('all 27 actual final SQL result shapes satisfy their unchanged protected release parsers');
} finally {fs.rmSync(outputDir,{recursive:true,force:true});await outputDb.close();}
console.log(`OK: ${checks} canary active-session checks`);
