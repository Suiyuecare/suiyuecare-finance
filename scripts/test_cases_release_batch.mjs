import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {PGlite} from '@electric-sql/pglite';
import guard from './finance_production_release_guard.js';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'finance-cases-gate-'));
const versions=guard.CASE_MIGRATIONS.join(','),phase=guard.RELEASE_PHASE_DATABASE_CASES;
const legacy=['20260820000000',...guard.MIGRATION_CHAIN,...guard.REVIEWED_POST_BASELINE_MIGRATIONS,guard.MIGRATION_HUMAN_ACCOUNTING_AUTHORITY,...guard.AUDIT_MIGRATIONS];
const baseline={count:1,lastVersion:legacy[0],sha256:guard.ledgerSha256([legacy[0]])};
const ledger=path.join(dir,'ledger.txt');fs.writeFileSync(ledger,legacy.join('\n')+'\n');
const migrationDir=path.join(dir,'migrations');fs.mkdirSync(migrationDir);
for(const v of guard.REVIEWED_MIGRATION_CATALOG)fs.writeFileSync(path.join(migrationDir,v+'_test.sql'),v===versions?"create table public.cases_release_probe(id integer); update public.application_accounting_lines set id=2;":'select 1;');
const sql=(name,body)=>{const p=path.join(dir,name);fs.writeFileSync(p,body);return p;};
const postflight=sql('postflight.sql',"\\set ON_ERROR_STOP on\ndo $test$ begin if to_regclass('public.cases_release_probe') is null then raise exception 'case migration absent'; end if; if (select id from public.application_accounting_lines)<>2 then raise exception 'line update absent'; end if; end; $test$;");
const fingerprint=fileURLToPath(new URL('./finance_cases_20260908_fingerprint.sql',import.meta.url));
const fingerprintSql=fs.readFileSync(fingerprint,'utf8').replace(/^\\set ON_ERROR_STOP on\n/,'');
assert.match(fingerprintSql,/from public.application_accounting_lines r/);
const canary=sql('canary.sql',`-- Test-only authenticated contract
begin isolation level repeatable read;
-- FINANCE_AUTHENTICATED_CANARY_CORE_BEGIN
do $core$ begin if current_setting('audit.fixture_actor',true)<>'authenticated' then raise exception 'wrong test identity'; end if; end; $core$;
-- FINANCE_AUTHENTICATED_CANARY_CORE_END
-- FINANCE_AUTHENTICATED_CANARY_ROLLBACK_CHECK_BEGIN
do $rollback$ begin if exists(select 1 from public.application_accounting_lines where id<>1) then raise exception 'rehearsal residue'; end if; end; $rollback$;
-- FINANCE_AUTHENTICATED_CANARY_ROLLBACK_CHECK_END
rollback;
`);
const casesCanary=sql('case-canary.sql',`-- Test-only additional finalize canary
begin isolation level repeatable read;
-- FINANCE_AUTHENTICATED_CANARY_CORE_BEGIN
do $core$ begin if to_regclass('public.cases_release_probe') is null then raise exception 'missing migrated schema'; end if; insert into public.application_accounting_lines values(3); end; $core$;
-- FINANCE_AUTHENTICATED_CANARY_CORE_END
-- FINANCE_AUTHENTICATED_CANARY_ROLLBACK_CHECK_BEGIN
do $rollback$ begin if to_regclass('public.cases_release_probe') is not null then raise exception 'migration residue'; end if; end; $rollback$;
-- FINANCE_AUTHENTICATED_CANARY_ROLLBACK_CHECK_END
rollback;
`);
assert.equal(versions,'20260908065050');
assert.equal(guard.classifyLedger(ledger,migrationDir,phase,versions,baseline),'pending');
assert.throws(()=>guard.releasePlan(phase,guard.AUDIT_MIGRATIONS.join(',')),/must use/);
assert.throws(()=>guard.migrationPhase([...guard.AUDIT_MIGRATIONS,...guard.CASE_MIGRATIONS].join(',')),/no exact catalog/);
assert.throws(()=>guard.classifyLedger(ledger,migrationDir,'frontend_compat','none',baseline),/database cases migration batch/);
fs.writeFileSync(ledger,legacy.slice(0,-1).join('\n')+'\n');
assert.throws(()=>guard.classifyLedger(ledger,migrationDir,phase,versions,baseline),/complete reviewed authority chain and audit/);
fs.writeFileSync(ledger,legacy.join('\n')+'\n');
const db=new PGlite();
try{
 await db.exec("create schema private; create schema supabase_migrations; create table supabase_migrations.schema_migrations(version text primary key,statements text[],name text,created_by text); set audit.fixture_actor='authenticated';");
 for(const name of new Set([...fingerprintSql.matchAll(/from ((?:public|private)\.[a-z_0-9]+) r/g)].map(m=>m[1])))await db.exec(`create table ${name}(id integer);`);
 await db.exec('insert into public.application_accounting_lines values(1)');
 for(const v of legacy)await db.query('insert into supabase_migrations.schema_migrations(version) values ($1)',[v]);
 const original=(await db.query(fingerprintSql)).rows[0].fingerprint;
 await db.exec('update public.application_accounting_lines set id=9');
 assert.notEqual((await db.query(fingerprintSql)).rows[0].fingerprint,original,'Fingerprint detects accounting line drift');
 await db.exec('update public.application_accounting_lines set id=1');
 const rehearsal=path.join(dir,'rehearsal.sql');
 guard.prepareAuditBatchRehearsal(migrationDir,rehearsal,versions,fingerprint,canary,postflight,phase,casesCanary);
 const rendered=fs.readFileSync(rehearsal,'utf8');
 assert.equal((rendered.match(/^rollback;$/gm)||[]).length,1);
 assert.match(rendered,/postflight|line update absent/);
 assert.ok(rendered.includes('missing migrated schema'));
 await db.exec(rendered);
 assert.equal((await db.query(fingerprintSql)).rows[0].fingerprint,original,'Whole live-format fingerprint exactly restored');
 assert.throws(()=>guard.prepareAuditBatchRehearsal(migrationDir,path.join(dir,'no-canary.sql'),versions,fingerprint,canary,postflight,phase),/canary path is required/);
 const apply=path.join(dir,'apply.sql');guard.prepareAuditBatchApply(migrationDir,apply,versions,ledger,postflight,baseline,phase);
 const badPostflight=sql('bad-postflight.sql',"\\set ON_ERROR_STOP on\nselect 1/0;\n");
 const bad=path.join(dir,'bad.sql');guard.prepareAuditBatchApply(migrationDir,bad,versions,ledger,badPostflight,baseline,phase);
 await assert.rejects(()=>db.exec(fs.readFileSync(bad,'utf8')),/division by zero/);await db.exec('rollback');
 assert.equal((await db.query(fingerprintSql)).rows[0].fingerprint,original,'Failed postflight rolls back SQL, accounting data and ledger together');
 await db.exec(fs.readFileSync(apply,'utf8'));
 assert.equal((await db.query('select count(*)::int n from supabase_migrations.schema_migrations')).rows[0].n,legacy.length+1);
 await assert.rejects(()=>db.exec(fs.readFileSync(apply,'utf8')),/ledger changed/);await db.exec('rollback');
 fs.writeFileSync(ledger,[...legacy,...guard.CASE_MIGRATIONS].join('\n')+'\n');
 assert.equal(guard.classifyLedger(ledger,migrationDir,phase,versions,baseline),'applied');
 assert.equal(guard.classifyLedger(ledger,migrationDir,'frontend_compat','none',baseline),'compat');
 assert.throws(()=>guard.prepareAuditBatchApply(migrationDir,path.join(dir,'again.sql'),versions,ledger,postflight,baseline,phase),/must be pending/);
 const expectedCanary={canary:'authenticated_finalize_accounting_lines',ok:true,rolled_back:true,accounting_lines_consistent:true};
 const marker='finalize_accounting_canary_result';
 const row=value=>({[marker]:value});
 // Supabase CLI 2.111.0 db query --output json emits rows as a top-level
 // array; this was rejected before marker validation in release 34199215678.
 // Also retain the nested transport and jsonb-as-string shapes handled by the
 // established authenticated canary parser.
 const output=sql('canary.json','[]');
 const accepted=[
   [row(expectedCanary)],
   {rows:[row(expectedCanary)]},
   [{rows:[row(expectedCanary)]}],
   {results:[{rows:[row(expectedCanary)]}]},
   [row(JSON.stringify(expectedCanary))],
   {rows:[row(JSON.stringify(expectedCanary))]}
 ];
 for(const value of accepted){
   fs.writeFileSync(output,JSON.stringify(value));
   assert.equal(guard.verifyFinalizeCanary(output),true,'valid CLI transport '+JSON.stringify(value));
 }
 const rejected=[
   {}, [], null, false, true, 1, 'transport is not a row set',
   expectedCanary, [{authenticated_canary_result:expectedCanary}],
   [row(expectedCanary),row(expectedCanary)],
   {rows:[row(expectedCanary)],nested:{rows:[row(expectedCanary)]}},
   [row({...expectedCanary,nested:row(expectedCanary)})],
   [row(null)], [row(false)], [row([])], [row({})], [row('{malformed')],
   [row({...expectedCanary,canary:'authenticated_submit_return_resubmit'})],
   [row({...expectedCanary,ok:false})],
   [row({...expectedCanary,rolled_back:false})],
   [row({...expectedCanary,accounting_lines_consistent:false})],
   [row({...expectedCanary,ok:'true'})],
   [row({...expectedCanary,rolled_back:1})],
   [row({...expectedCanary,accounting_lines_consistent:'true'})],
   [row({...expectedCanary,unexpected:true})],
   ...Object.keys(expectedCanary).map(key=>[row(Object.fromEntries(Object.entries(expectedCanary).filter(([name])=>name!==key)))])
 ];
 for(const value of rejected){
   fs.writeFileSync(output,JSON.stringify(value));
   assert.throws(()=>guard.verifyFinalizeCanary(output),'invalid marker/result must fail: '+JSON.stringify(value));
 }
 for(const text of ['', '   ', '[', '{', 'not-json']){
   fs.writeFileSync(output,text);
   assert.throws(()=>guard.verifyFinalizeCanary(output),/not valid JSON/);
 }
 // The production CLI entrypoint must accept the same actual row shape and
 // return a nonzero exit for duplicated markers; unit-only coverage missed the
 // transport boundary during the original release.
 const guardPath=fileURLToPath(new URL('./finance_production_release_guard.js',import.meta.url));
 const {spawnSync}=await import('node:child_process');
 fs.writeFileSync(output,JSON.stringify([row(expectedCanary)]));
 let cli=spawnSync(process.execPath,[guardPath,'verify-finalize-canary','--input',output],{encoding:'utf8'});
 assert.equal(cli.status,0,cli.stderr);
 fs.writeFileSync(output,JSON.stringify([row(expectedCanary),row(expectedCanary)]));
 cli=spawnSync(process.execPath,[guardPath,'verify-finalize-canary','--input',output],{encoding:'utf8'});
 assert.notEqual(cli.status,0);assert.match(cli.stderr,/exactly one result/);
 console.log('PASS finalize canary parser: 6 valid CLI transports, '+rejected.length+' invalid marker/result shapes, 5 malformed inputs and CLI exit statuses');
 console.log('PASS cases release: exact one-migration phase, complete audit prerequisites, full accounting fingerprint rollback, both canary contracts, atomic SQL+ledger+postflight, stale ledger and reapply rejection');
}finally{await db.close();fs.rmSync(dir,{recursive:true});}
