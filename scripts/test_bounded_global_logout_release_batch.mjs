// Actual sealed migration, rehearsal/apply renderer and read-only gates. Local synthetic PostgreSQL only.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {PGlite} from '@electric-sql/pglite';
import guard from './finance_production_release_guard.js';
const db=new PGlite(),dir=await fs.mkdtemp(path.join(os.tmpdir(),'finance-bounded-release-'));
const root=path.resolve(import.meta.dirname,'..'),migrationDir=path.join(root,'supabase/migrations');
const phase=guard.RELEASE_PHASE_DATABASE_BOUNDED_LOGOUT,versions=guard.BOUNDED_LOGOUT_MIGRATIONS.join(',');
const prior=['00000000000001',...guard.REVIEWED_MIGRATION_CATALOG.filter(v=>v<versions)];
const baseline={count:1,lastVersion:prior[0],sha256:guard.ledgerSha256([prior[0]])};
let checks=0,serial=0;const eq=(a,b,m)=>{assert.deepEqual(a,b,m);checks++};
const rejects=async(fn,re)=>{await assert.rejects(fn,re);checks++};
const gate=name=>path.join(root,'scripts','finance_bounded_global_logout_'+name+'.sql');
const readGate=async name=>(await fs.readFile(gate(name),'utf8')).replace(/^\\set ON_ERROR_STOP on\r?\n/,'');
try {
 const original=await fs.readFile(path.join(root,'scripts/test_portal_session_logout.mjs'),'utf8');
 const setup=original.slice(original.indexOf('await db.exec(`create role anon'),original.indexOf("await db.exec(await readFile(new URL('../supabase/migrations"));
 await new(Object.getPrototypeOf(async function(){}).constructor)('db','readFile','base',setup.replaceAll('import.meta.url','base'))(db,fs.readFile,new URL('./test_portal_session_logout.mjs',import.meta.url));
 await db.exec(await fs.readFile(path.join(migrationDir,'20260927180201_finance_portal_session_logout.sql'),'utf8'));
 await db.exec('alter table auth.sessions add column created_at timestamptz default now();');
 await db.exec('create schema supabase_migrations;create table supabase_migrations.schema_migrations(version text primary key,statements text[],name text,created_by text);');
 for(const version of prior)await db.query('insert into supabase_migrations.schema_migrations(version,name) values($1,$2)',[version,version==='20260927180201'?'finance_portal_session_logout':'synthetic_prior_catalog']);
 const fpSource=await fs.readFile(gate('fingerprint'),'utf8');
 for(const table of new Set([...fpSource.matchAll(/from ((?:public|private|auth|storage|finance_hr_private)\.[a-z_0-9]+) r/g)].map(m=>m[1]))){
  if(!(await db.query('select to_regclass($1) r',[table])).rows[0].r){await db.exec('create schema if not exists '+table.split('.')[0]);await db.exec('create table '+table+'(synthetic_id integer)');}
 }
 const ledger=path.join(dir,'ledger.txt');await fs.writeFile(ledger,prior.join('\n')+'\n');
 const fingerprint=async()=>(await db.query(await readGate('fingerprint'))).rows[0].fingerprint;
 const initial=await fingerprint();
 const render=async kind=>{const out=path.join(dir,kind+'-'+serial+++'.sql');if(kind==='rehearsal')guard.prepareBoundedGlobalLogoutRehearsal(migrationDir,out,versions,ledger,gate('fingerprint'),gate('canary'),gate('preflight'),gate('postflight'),baseline);else guard.prepareAuditBatchApply(migrationDir,out,versions,ledger,gate('postflight'),baseline,phase);return fs.readFile(out,'utf8');};
 eq(guard.classifyLedger(ledger,migrationDir,phase,versions,baseline),'pending');
 await db.exec(await readGate('preflight'));
 await db.exec(await render('rehearsal'));
 eq(await fingerprint(),initial,'rollback must preserve source/grants/ledger/auth data');
 eq((await db.query("select to_regclass('logout_private.module_receipts') r")).rows[0].r,null);
 const apply=await render('apply');assert.match(apply,/begin;[\s\S]+pg_advisory_xact_lock[\s\S]+lock table supabase_migrations.schema_migrations[\s\S]+insert into supabase_migrations.schema_migrations[\s\S]+commit;/);checks++;
 // A failed sealed postflight rolls back both DDL and migration receipt.
 await rejects(()=>db.exec(apply.replace("select 'FINANCE_BOUNDED_LOGOUT_POSTFLIGHT_OK' as marker;",()=>"do $$begin raise exception 'synthetic_postflight_failure';end $$;")),/synthetic_postflight_failure/);await db.exec('rollback');
 eq((await db.query("select to_regclass('logout_private.module_receipts') r")).rows[0].r,null);
 eq(await fingerprint(),initial,'failed atomic apply cannot leave ledger or session change');
 await db.exec(apply);
 eq((await db.query("select count(*)::int n from supabase_migrations.schema_migrations where version=$1",[versions])).rows[0].n,1);
 await db.exec(await readGate('postflight'));
 const actual=await db.exec(await readGate('canary'));const result=path.join(dir,'canary.json');await fs.writeFile(result,JSON.stringify(actual));eq(guard.verifyReportsCanary(result,'bounded_global_logout'),true,'actual SQL marker must match release contract');
 await fs.writeFile(ledger,[...prior,versions].join('\n')+'\n');eq(guard.classifyLedger(ledger,migrationDir,phase,versions,baseline),'applied');
 await rejects(()=>db.exec(apply),/migration ledger changed/);await db.exec('rollback');
 const changed=await fingerprint();await db.exec('begin;grant execute on function public.portal_revoke_google_sessions_v2(uuid,text,text,timestamptz,timestamptz) to authenticated;');
 await rejects(async()=>db.exec((await fs.readFile(gate('postflight'),'utf8')).replace(/^\\set ON_ERROR_STOP on\r?\n/,'')),/authority\/source drift/);await db.exec('rollback');eq(await fingerprint(),changed,'tampered authority probe rolled back');
 await db.exec('begin;alter table logout_private.module_receipts disable row level security;');await rejects(async()=>db.exec((await fs.readFile(gate('postflight'),'utf8')).replace(/^\\set ON_ERROR_STOP on\r?\n/,'')),/private receipt authority drift/);await db.exec('rollback');
 console.log(JSON.stringify({verified:true,checks,phase,version:versions,realSessionsRevoked:false,atomicLedger:true,rollbackProven:true}));
} finally {await db.close();await fs.rm(dir,{recursive:true,force:true});}
