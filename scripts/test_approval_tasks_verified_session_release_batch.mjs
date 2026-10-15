// Exercise the sealed protected-release SQL locally. No production connection.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {PGlite} from '@electric-sql/pglite';
import guard from './finance_production_release_guard.js';

const root=path.resolve(import.meta.dirname,'..');
const migrations=path.join(root,'supabase/migrations');
const phase=guard.RELEASE_PHASE_DATABASE_APPROVAL_TASKS_VERIFIED_SESSION;
const versions=guard.APPROVAL_TASKS_VERIFIED_SESSION_MIGRATIONS.join(',');
const prior=['00000000000001',...guard.REVIEWED_MIGRATION_CATALOG.filter(version=>version<versions)];
const baseline={count:1,lastVersion:prior[0],sha256:guard.ledgerSha256([prior[0]])};
const dir=await fs.mkdtemp(path.join(os.tmpdir(),'finance-approval-tasks-release-'));
const db=new PGlite();let checks=0,serial=0;
const eq=(a,b,message)=>{assert.deepEqual(a,b,message);checks++;};
const rejects=async(fn,pattern)=>{await assert.rejects(fn,pattern);checks++;};
const gate=name=>path.join(root,'scripts','finance_approval_tasks_verified_session_'+name+'.sql');
const sql=async name=>(await fs.readFile(gate(name),'utf8')).replace(/^\\set ON_ERROR_STOP on\r?\n/,'');
try {
  // Reuse the fictional schema and exact catalog definitions from the identity
  // regression. Do not execute its scenario or import production repair data.
  const fixturePath=path.join(root,'scripts/check_taipei2_google_identity_repair_20261015.cjs');
  const fixtureSource=await fs.readFile(fixturePath,'utf8');
  const setup=fixtureSource.slice(0,fixtureSource.indexOf('async function main()')).replace(/^#![^\n]*\n/,'');
  const {schema}=new Function('require','__dirname',setup+'\nreturn {schema};')(createRequire(fixturePath),path.dirname(fixturePath));
  await db.exec('create role anon;create role authenticated;create role service_role;');
  await db.exec(schema);
  await db.exec(`
    grant usage on schema auth to authenticated;
    grant select on auth.fixture_claims to authenticated;
    delete from auth.fixture_claims;
    revoke all on function public.finance_approval_tasks_for_current_user(text),public.current_finance_user(),public.finance_auth_session_active() from public,anon,authenticated,service_role;
    grant execute on function public.finance_approval_tasks_for_current_user(text),public.current_finance_user() to authenticated,service_role;
    grant execute on function public.finance_auth_session_active() to authenticated;
    create schema supabase_migrations;
    create table supabase_migrations.schema_migrations(version text primary key,statements text[],name text,created_by text);
  `);
  for(const version of prior)await db.query('insert into supabase_migrations.schema_migrations(version,name) values($1,$2)',[version,'synthetic_prior_catalog']);
  const ledger=path.join(dir,'ledger.txt');await fs.writeFile(ledger,prior.join('\n')+'\n');
  const fingerprint=async()=>(await db.query(await sql('fingerprint'))).rows[0].fingerprint;
  const dataFingerprint=async()=>(await db.query(`select md5(jsonb_build_array(
    (select jsonb_agg(to_jsonb(r) order by id) from public.expense_requests r),
    (select jsonb_agg(to_jsonb(r) order by id) from public.finance_users r),
    (select jsonb_agg(to_jsonb(r) order by id) from auth.identities r))::text) as fingerprint`)).rows[0].fingerprint;
  const render=async kind=>{
    const out=path.join(dir,kind+'-'+serial+++'.sql');
    if(kind==='rehearsal')guard.prepareApprovalTasksVerifiedSessionRehearsal(migrations,out,versions,ledger,gate('fingerprint'),gate('canary'),gate('preflight'),gate('postflight'),baseline);
    else guard.prepareAuditBatchApply(migrations,out,versions,ledger,gate('postflight'),baseline,phase);
    return fs.readFile(out,'utf8');
  };
  eq(guard.classifyLedger(ledger,migrations,phase,versions,baseline),'pending');
  const before=await fingerprint(),beforeData=await dataFingerprint();
  await db.exec(await sql('preflight'));
  await db.exec(await render('rehearsal'));
  eq(await fingerprint(),before,'rehearsal restores exact function metadata');
  eq(await dataFingerprint(),beforeData,'rehearsal preserves fictional employees and documents');
  const apply=await render('apply');
  assert.match(apply,/begin;[\s\S]+pg_advisory_xact_lock[\s\S]+lock table supabase_migrations.schema_migrations[\s\S]+insert into supabase_migrations.schema_migrations[\s\S]+commit;/);checks++;
  await rejects(()=>db.exec(apply.replace("select 'FINANCE_APPROVAL_TASKS_VERIFIED_SESSION_POSTFLIGHT_OK' as marker;",()=>"do $$begin raise exception 'synthetic_postflight_failure';end$$;")),/synthetic_postflight_failure/);
  await db.exec('rollback;');
  eq(await fingerprint(),before,'failed apply restores function metadata');
  eq((await db.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1',[versions])).rows[0].n,0,'failed apply does not leave migration receipt');
  await db.exec(apply);
  await db.exec(await sql('postflight'));
  eq(await dataFingerprint(),beforeData,'successful DDL changes no business or identity data');
  const canaryResults=await db.exec(await sql('canary'));
  const resultPath=path.join(dir,'canary.json');await fs.writeFile(resultPath,JSON.stringify(canaryResults));
  eq(guard.verifyReportsCanary(resultPath,'approval_tasks_verified_session'),true);
  await fs.writeFile(ledger,[...prior,versions].join('\n')+'\n');
  eq(guard.classifyLedger(ledger,migrations,phase,versions,baseline),'applied');
  await rejects(()=>db.exec(apply),/migration ledger changed/);await db.exec('rollback;');
  await db.exec('begin;grant execute on function public.finance_approval_tasks_for_current_user(text) to anon;');
  await rejects(async()=>db.exec(await sql('postflight')),/authority\/source drift/);await db.exec('rollback;');
  await db.exec("begin;update supabase_migrations.schema_migrations set statements=array['tampered'] where version='20261015172658';");
  await rejects(async()=>db.exec(await sql('postflight')),/sealed ledger missing or differs/);await db.exec('rollback;');
  const workflow=await fs.readFile(path.join(root,'.github/workflows/finance-production-release.yml'),'utf8');
  const promoteIf=workflow.slice(workflow.indexOf('\n  promote:\n')).split('\n').find(line=>line.includes('if:'));
  assert(promoteIf&&!promoteIf.includes(phase),'verified-session phase must promote the tested frontend');checks++;
  assert(workflow.includes('promotion-approval-tasks-verified-session-canary.json'),'promotion must recheck the new database contract');checks++;
  assert(!workflow.includes('scripts/finance_taipei2_google_identity_repair_20261015.sql'),'production data repair must never enter a public release bundle');checks++;
  console.log(JSON.stringify({verified:true,checks,phase,version:versions,atomicLedger:true,rollbackProven:true,productionSessionUsed:false,businessActionPerformed:false}));
} finally {await db.close();await fs.rm(dir,{recursive:true,force:true});}
