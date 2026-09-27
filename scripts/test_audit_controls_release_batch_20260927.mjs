// Execute the protected two-migration renderer. Fictional schema/business data only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import guard from './finance_production_release_guard.js';
import {PGlite} from '@electric-sql/pglite';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'finance-controls-atomic-')),migrationDir=path.join(dir,'migrations');fs.mkdirSync(migrationDir);
const db=new PGlite(),phase=guard.RELEASE_PHASE_DATABASE_AUDIT_CONTROLS_20260927,batch=guard.AUDIT_CONTROLS_20260927_MIGRATIONS,versions=batch.join(',');let checks=0;
const prior=['20260801000000',...guard.REVIEWED_MIGRATION_CATALOG.filter(v=>v<batch[0])].sort(),baseline={count:1,lastVersion:prior[0],sha256:guard.ledgerSha256([prior[0]])};
const write=(name,source)=>{const p=path.join(dir,name);fs.writeFileSync(p,source);return p;},ledger=write('ledger.txt',prior.join('\n')+'\n');
const one="create table public.finance_document_archives_v1(id integer);update public.synthetic_business set amount=amount+1;";
const two="create table private.finance_payroll_accruals_v1(id integer);update public.synthetic_business set amount=amount+100;";
for(const v of guard.REVIEWED_MIGRATION_CATALOG)fs.writeFileSync(path.join(migrationDir,v+'_fixture.sql'),v===batch[0]?one:v===batch[1]?two:'select 1;');
const checkSql="do $fixture_post$ begin if to_regclass('public.finance_document_archives_v1') is null or to_regclass('private.finance_payroll_accruals_v1') is null or (select amount from public.synthetic_business)<>102 then raise exception 'postflight must run after both migrations';end if;end;$fixture_post$;";
const repoScripts=new URL('./',import.meta.url);
// Stubs model inherited contracts, whose own sealed SQL suites remain required.
for(const name of new Set([...fs.readdirSync(repoScripts).filter(n=>n.endsWith('_postflight.sql')||n==='finance_production_human_accounting_canary.sql'),'finance_payroll_accrual_v1_postflight.sql']))write(name,'\\set ON_ERROR_STOP on\n'+(name==='finance_production_db_postflight.sql'?"select :'migration_versions';\n":'')+checkSql);
const receivables=path.join(dir,'finance_canonical_receivables_postflight.sql'),profiles=path.join(dir,'finance_reporting_profiles_postflight.sql');
const fingerprint=write('fingerprint.sql',"\\set ON_ERROR_STOP on\nwith parts as (select coalesce(to_regclass('public.finance_document_archives_v1')::text,'absent')||'/'||coalesce(to_regclass('private.finance_payroll_accruals_v1')::text,'absent')||'/'||(select amount::text from public.synthetic_business)||'/'||(select string_agg(version,',' order by version) from supabase_migrations.schema_migrations) as value) select md5(value) fingerprint from parts;\n");
const canary=write('canary.sql',`-- Synthetic atomic renderer canary
begin isolation level repeatable read read only;
-- FINANCE_AUTHENTICATED_CANARY_CORE_BEGIN
${checkSql}
-- FINANCE_AUTHENTICATED_CANARY_CORE_END
rollback;
-- FINANCE_AUTHENTICATED_CANARY_ROLLBACK_CHECK_BEGIN
do $fixture_rollback$ begin if (select amount from public.synthetic_business)<>1 then raise exception 'business write survived rollback';end if;end;$fixture_rollback$;
-- FINANCE_AUTHENTICATED_CANARY_ROLLBACK_CHECK_END
`);
let n=0;const output=name=>path.join(dir,(++n)+'-'+name+'.sql');
const rehearsal=()=>{const p=output('rehearsal');guard.prepareAuditControls20260927Rehearsal(migrationDir,p,versions,ledger,fingerprint,canary,receivables,profiles,baseline);return fs.readFileSync(p,'utf8');};
const apply=()=>{const p=output('apply');guard.prepareAuditBatchApply(migrationDir,p,versions,ledger,receivables,baseline,phase,profiles);return fs.readFileSync(p,'utf8');};
try{
 await db.exec('create schema private;create schema supabase_migrations;create table supabase_migrations.schema_migrations(version text primary key,statements text[],name text,created_by text);create table public.synthetic_business(amount integer);insert into public.synthetic_business values(1);');
 for(const version of prior)await db.query('insert into supabase_migrations.schema_migrations(version) values($1)',[version]);
 const fpSql=fs.readFileSync(fingerprint,'utf8').replace(/^\\set ON_ERROR_STOP on\n/,''),fp=async()=>(await db.query(fpSql)).rows[0].fingerprint,before=await fp();
 await db.exec(rehearsal());assert.equal(await fp(),before,'successful rehearsal must restore schema/business/ledger');checks++;
 // An independent ledger change is refused before either migration runs.
 const stale=rehearsal();await db.exec("insert into supabase_migrations.schema_migrations(version) values('20260928000000')");const staleBefore=await fp();
 await assert.rejects(()=>db.exec(stale),/ledger changed before rollback rehearsal/);await db.exec('rollback');assert.equal(await fp(),staleBefore);checks++;
 await db.exec("delete from supabase_migrations.schema_migrations where version='20260928000000'");
 const second=path.join(migrationDir,batch[1]+'_fixture.sql');fs.writeFileSync(second,two+"do $$begin raise exception 'synthetic second migration failure';end$$;");
 await assert.rejects(()=>db.exec(apply()),/synthetic second migration failure/);await db.exec('rollback');assert.equal(await fp(),before,'second migration failure reverts first migration and first ledger row');checks++;
 fs.writeFileSync(second,two);
 const final=path.join(dir,'finance_payroll_accrual_v1_postflight.sql'),good=fs.readFileSync(final,'utf8');fs.writeFileSync(final,good+"do $$begin raise exception 'synthetic final postflight failure';end$$;");
 await assert.rejects(()=>db.exec(apply()),/synthetic final postflight failure/);await db.exec('rollback');assert.equal(await fp(),before,'last postflight failure reverts both migrations, business writes, and ledger rows');checks++;
 fs.writeFileSync(final,good);
 const appliedSql=apply();await db.exec(appliedSql);assert.equal((await db.query('select amount from public.synthetic_business')).rows[0].amount,102);checks++;
 assert.equal((await db.query('select count(*)::int n from supabase_migrations.schema_migrations where version=any($1)',[batch])).rows[0].n,2);checks++;
 const applied=await fp();await assert.rejects(()=>db.exec(appliedSql),/ledger changed after the reviewed release gate/);await db.exec('rollback');assert.equal(await fp(),applied);checks++;
 fs.writeFileSync(ledger,[...prior,...batch].join('\n')+'\n');assert.equal(guard.classifyLedger(ledger,migrationDir,phase,versions,baseline),'applied');assert.throws(rehearsal,/pending/);assert.throws(apply,/pending/);checks++;
 console.log(JSON.stringify({ok:true,checks,twoMigrationAtomicity:true,businessFingerprintRollback:true,lastPostflightFailureRollback:true,staleLedgerRejectsBeforeDDL:true,reapplyRejected:true,syntheticOnly:true}));
}finally{await db.close();fs.rmSync(dir,{recursive:true,force:true});}
