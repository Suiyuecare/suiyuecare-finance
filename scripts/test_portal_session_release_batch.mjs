// Actual protected atomic renderer + real migrations, isolated PostgreSQL only.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {PGlite} from '@electric-sql/pglite';
import guard from './finance_production_release_guard.js';
const db=new PGlite(),dir=await fs.mkdtemp(path.join(os.tmpdir(),'finance-session-batch-')),migrationDir=path.join(dir,'migrations');await fs.mkdir(migrationDir);
const phase=guard.RELEASE_PHASE_DATABASE_PORTAL_SESSION,versions=guard.PORTAL_SESSION_MIGRATIONS.join(','),baselineRows=['20260801000000'],baseline={count:1,lastVersion:baselineRows[0],sha256:guard.ledgerSha256(baselineRows)},prior=[...baselineRows,...guard.REVIEWED_MIGRATION_CATALOG.filter(v=>v<guard.PORTAL_SESSION_MIGRATIONS[0])].sort();let checks=0;
const eq=(a,b,m)=>{assert.deepEqual(a,b,m);checks++},reject=async(fn,p)=>{await assert.rejects(fn,p);checks++};
const write=async(name,source)=>{const f=path.join(dir,name);await fs.writeFile(f,source);return f};
try{
 const original=await fs.readFile(new URL('./test_portal_session_logout.mjs',import.meta.url),'utf8');const setup=original.slice(original.indexOf('await db.exec(`create role anon'),original.indexOf("await db.exec(await readFile(new URL('../supabase/migrations"));
 await new(Object.getPrototypeOf(async function(){}).constructor)('db','readFile','base',setup.replaceAll('import.meta.url','base'))(db,fs.readFile,import.meta.url);
 await db.exec("insert into auth.sessions values('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',null);");
 await db.exec('create schema supabase_migrations;create table supabase_migrations.schema_migrations(version text primary key,statements text[],name text,created_by text);');for(const version of prior)await db.query('insert into supabase_migrations.schema_migrations(version) values($1)',[version]);
 const ledger=await write('ledger.txt',prior.join('\n')+'\n');
 for(const version of guard.REVIEWED_MIGRATION_CATALOG){const files=await fs.readdir(new URL('../supabase/migrations',import.meta.url));const name=files.find(n=>n.startsWith(version+'_'));await write('migrations/'+name,guard.PORTAL_SESSION_MIGRATIONS.includes(version)?await fs.readFile(new URL('../supabase/migrations/'+name,import.meta.url),'utf8'):'select 1;\n')}
 const fingerprintSource=await fs.readFile(new URL('./finance_portal_session_fingerprint.sql',import.meta.url),'utf8');
 for(const table of new Set([...fingerprintSource.matchAll(/from ((?:public|private|auth|storage|finance_hr_private)\.[a-z_0-9]+) r/g)].map(m=>m[1]))){if(!(await db.query('select to_regclass($1) r',[table])).rows[0].r){await db.exec('create schema if not exists '+table.split('.')[0]);await db.exec('create table '+table+'(synthetic_id integer)')}}
 const fp=await write('fingerprint.sql',fingerprintSource),fpQuery=fingerprintSource.replace(/^\\set ON_ERROR_STOP on\r?\n/,''),readFingerprint=async()=>(await db.query(fpQuery)).rows[0].fingerprint,originalFingerprint=await readFingerprint();
 // Other domains are represented by independent read-only postflight probes:
 // actual authority semantics are separately covered by their regression suites.
 for(const name of (await fs.readdir(new URL('.',import.meta.url))).filter(n=>n.endsWith('_postflight.sql'))){await write(name,'\\set ON_ERROR_STOP on\n'+(name==='finance_production_db_postflight.sql'?"select :'migration_versions';\n":'select 1;\n'))}
 await write('finance_portal_session_logout_postflight.sql',await fs.readFile(new URL('./finance_portal_session_logout_postflight.sql',import.meta.url),'utf8'));
 await write('finance_production_human_accounting_canary.sql','\\set ON_ERROR_STOP on\nselect 1;\n');
 const canary=await write('canary.sql',`-- Synthetic catalog assertions, no employee identity.
begin isolation level repeatable read read only;
-- FINANCE_AUTHENTICATED_CANARY_CORE_BEGIN
do $new$ begin if (select md5(prosrc) from pg_proc where oid='public.current_finance_user()'::regprocedure)<>'6dae0e205f8268d0064c8c49990e5bd4' then raise exception 'new auth fence missing';end if;end $new$;
-- FINANCE_AUTHENTICATED_CANARY_CORE_END
rollback;
-- FINANCE_AUTHENTICATED_CANARY_ROLLBACK_CHECK_BEGIN
do $old$ begin if (select md5(prosrc) from pg_proc where oid='public.current_finance_user()'::regprocedure)<>'5fc4f077185c7e351c730378e4d0eca4' then raise exception 'old authority was not restored';end if;end $old$;
-- FINANCE_AUTHENTICATED_CANARY_ROLLBACK_CHECK_END
`);
 const receivables=path.join(dir,'finance_canonical_receivables_postflight.sql'),profiles=path.join(dir,'finance_reporting_profiles_postflight.sql');let serial=0;
 const rehearsal=async()=>{const out=path.join(dir,'rehearsal-'+serial++);guard.preparePortalSessionRehearsal(migrationDir,out,versions,ledger,fp,canary,receivables,profiles,baseline);return fs.readFile(out,'utf8')};
 const apply=async()=>{const out=path.join(dir,'apply-'+serial++);guard.prepareAuditBatchApply(migrationDir,out,versions,ledger,receivables,baseline,phase,profiles);return fs.readFile(out,'utf8')};
 await db.exec(await rehearsal());eq(await readFingerprint(),originalFingerprint,'real migrations and constraint rollback preserve business/catalog fingerprint');eq((await db.query('select count(*)::int n from supabase_migrations.schema_migrations')).rows[0].n,prior.length);
 const postfile=path.join(dir,'finance_hr_contractor_postflight.sql');await fs.writeFile(postfile,"\\set ON_ERROR_STOP on\ndo $fail$ begin raise exception 'intentional postflight failure';end $fail$;");await reject(async()=>db.exec(await apply()),/intentional postflight failure/);await db.exec('rollback');eq(await readFingerprint(),originalFingerprint);eq((await db.query('select count(*)::int n from supabase_migrations.schema_migrations')).rows[0].n,prior.length);
 await fs.writeFile(postfile,'\\set ON_ERROR_STOP on\nselect 1;\n');
 // The renderer refuses changed migration bytes before generating any SQL.
 const changed=(await fs.readdir(migrationDir)).find(n=>n.startsWith(guard.PORTAL_SESSION_MIGRATIONS[0]+'_')),changedPath=path.join(migrationDir,changed),sealed=await fs.readFile(changedPath,'utf8');await fs.writeFile(changedPath,sealed+'\n-- unreviewed modification');await reject(()=>apply(),/sealed SHA256/);await fs.writeFile(changedPath,sealed);
 // A concurrent ledger change between preparation and execution blocks all DDL.
 const pendingSql=await apply();await db.query("insert into supabase_migrations.schema_migrations(version) values('20990101000000')");await reject(()=>db.exec(pendingSql),/ledger changed after the reviewed release gate/);await db.exec('rollback');await db.exec("delete from supabase_migrations.schema_migrations where version='20990101000000'");eq(await readFingerprint(),originalFingerprint);
 await db.exec(await apply());eq((await db.query("select md5(prosrc) h from pg_proc where oid='public.current_finance_user()'::regprocedure")).rows[0].h,'6dae0e205f8268d0064c8c49990e5bd4');eq((await db.query('select version from supabase_migrations.schema_migrations where version=any($1) order by version',[guard.PORTAL_SESSION_MIGRATIONS])).rows.map(x=>x.version),guard.PORTAL_SESSION_MIGRATIONS);
 console.log(JSON.stringify({ok:true,checks,actualMigrationRollback:true,sourceSeal:true,atomicLedger:true,otherDomains:'independent probe postflights; own regression suites verify their authority'}));
}finally{await db.close();await fs.rm(dir,{recursive:true,force:true})}
