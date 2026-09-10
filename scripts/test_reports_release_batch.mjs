import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {PGlite} from '@electric-sql/pglite';
import guard from './finance_production_release_guard.js';

// Anonymous PostgreSQL tests of the real release renderer and fingerprint.
// Domain suites separately execute the actual migrations and canaries.
const repo=fileURLToPath(new URL('..',import.meta.url));
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'finance-reports-gate-'));
const phase=guard.RELEASE_PHASE_DATABASE_REPORTS,versions=guard.REPORT_MIGRATIONS.join(',');
const prerequisites=['20260820000000',...guard.MIGRATION_CHAIN,...guard.REVIEWED_POST_BASELINE_MIGRATIONS,guard.MIGRATION_HUMAN_ACCOUNTING_AUTHORITY,...guard.AUDIT_MIGRATIONS,...guard.CASE_MIGRATIONS,...guard.UTILITY_MIGRATIONS];
const baseline={count:1,lastVersion:prerequisites[0],sha256:guard.ledgerSha256([prerequisites[0]])};
const ledger=path.join(dir,'ledger.txt'),migrationDir=path.join(dir,'migrations');fs.mkdirSync(migrationDir);
const write=(name,body)=>{const p=path.join(dir,name);fs.writeFileSync(p,body);return p;};
const writeLedger=rows=>fs.writeFileSync(ledger,rows.join('\n')+'\n');writeLedger(prerequisites);
const sources=["create table public.ar_release_probe(id integer); update public.application_accounting_lines set id=2;","create table public.profile_release_probe(id integer); update public.application_accounting_lines set id=3;"];
for(const v of guard.REVIEWED_MIGRATION_CATALOG)fs.writeFileSync(path.join(migrationDir,v+'_test.sql'),guard.REPORT_MIGRATIONS.includes(v)?sources[guard.REPORT_MIGRATIONS.indexOf(v)]:'select 1;');
const postflight=write('ar-postflight.sql',`\\set ON_ERROR_STOP on
do $ar_postflight$ begin
 if to_regclass('public.ar_release_probe') is null or to_regclass('public.profile_release_probe') is null then raise exception 'both migrations required'; end if;
 if (select id from public.application_accounting_lines) is distinct from 3 then raise exception 'ordered migrations required'; end if;
end; $ar_postflight$;
`);
const profilesPostflight=write('profiles-postflight.sql','\\set ON_ERROR_STOP on\ndo $profile_postflight$ begin if to_regclass(\'public.profile_release_probe\') is null then raise exception \'profile absent\'; end if; end; $profile_postflight$;\n');
const fingerprint=path.join(repo,'scripts/finance_reports_20260910_fingerprint.sql');
const fingerprintSql=fs.readFileSync(fingerprint,'utf8').replace(/^\\set ON_ERROR_STOP on\n/,'');
const makeCanary=(name,id,failAt=null,extraCore='')=>write(name+'.sql',`-- Anonymous ${name} release contract
begin isolation level repeatable read;
-- FINANCE_AUTHENTICATED_CANARY_CORE_BEGIN
do $${name}_core$ begin
 execute 'set local role authenticated';
 if current_user <> 'authenticated' then raise exception 'wrong role'; end if;
 if not exists(select 1 from public.application_accounting_lines where id=3) then raise exception 'migrations absent'; end if;
 insert into public.application_accounting_lines values(${id});
 ${extraCore}
 ${failAt==='core'?"raise exception 'intentional core failure';":''}
 execute 'reset role';
end; $${name}_core$;
-- FINANCE_AUTHENTICATED_CANARY_CORE_END
-- FINANCE_AUTHENTICATED_CANARY_ROLLBACK_CHECK_BEGIN
do $${name}_rollback$ begin
 if exists(select 1 from public.application_accounting_lines where id<>1) then raise exception 'row residue'; end if;
 if to_regclass('public.ar_release_probe') is not null or to_regclass('public.profile_release_probe') is not null then raise exception 'schema residue'; end if;
 ${failAt==='rollback'?"raise exception 'intentional rollback failure';":''}
end; $${name}_rollback$;
-- FINANCE_AUTHENTICATED_CANARY_ROLLBACK_CHECK_END
rollback;
`);
const canaries=['auth','cases','utility','receivables','profiles'].map((name,i)=>makeCanary(name,10+i));
const actualSection=(file,section)=>fs.readFileSync(path.join(repo,'scripts',file),'utf8').split('-- FINANCE_AUTHENTICATED_CANARY_'+section+'_BEGIN')[1].split('-- FINANCE_AUTHENTICATED_CANARY_'+section+'_END')[0].trim();
const arRollback=actualSection('finance_canonical_receivables_canary.sql','ROLLBACK_CHECK'),profileRollback=actualSection('finance_reporting_profiles_canary.sql','ROLLBACK_CHECK');
const withRollback=(file,rollback,name)=>{const raw=fs.readFileSync(file,'utf8'),start=raw.indexOf('-- FINANCE_AUTHENTICATED_CANARY_ROLLBACK_CHECK_BEGIN'),end=raw.indexOf('-- FINANCE_AUTHENTICATED_CANARY_ROLLBACK_CHECK_END');return write(name+'.sql',raw.slice(0,start)+'-- FINANCE_AUTHENTICATED_CANARY_ROLLBACK_CHECK_BEGIN\n'+rollback+'\n'+raw.slice(end));};
const renderRehearsal=(name,paths=canaries,ar=postflight,profile=profilesPostflight)=>{const p=path.join(dir,name+'.sql');guard.prepareAuditBatchRehearsal(migrationDir,p,versions,fingerprint,paths[0],ar,phase,paths[1],paths[2],paths.slice(3),profile);return fs.readFileSync(p,'utf8');};
const renderApply=(name,ar=postflight,profile=profilesPostflight)=>{const p=path.join(dir,name+'.sql');guard.prepareAuditBatchApply(migrationDir,p,versions,ledger,ar,baseline,phase,profile);return fs.readFileSync(p,'utf8');};
assert.equal(versions,'20260910064324,20260910064325');
assert.equal(guard.classifyLedger(ledger,migrationDir,phase,versions,baseline),'pending');
for(const wrong of ['none',guard.UTILITY_MIGRATIONS.join(','),...guard.REPORT_MIGRATIONS,guard.REPORT_MIGRATIONS.slice().reverse().join(',')])assert.throws(()=>guard.releasePlan(phase,wrong));
assert.throws(()=>guard.classifyLedger(ledger,migrationDir,'frontend_compat','none',baseline),/financial reports migration batch/);
for(const missing of prerequisites.slice(1)){writeLedger(prerequisites.filter(v=>v!==missing));assert.throws(()=>guard.classifyLedger(ledger,migrationDir,phase,versions,baseline),/complete reviewed/);}
for(const partial of guard.REPORT_MIGRATIONS){writeLedger([...prerequisites,partial]);assert.throws(()=>guard.classifyLedger(ledger,migrationDir,phase,versions,baseline),/partially installed/);}
writeLedger([...prerequisites,'20260910070000']);assert.throws(()=>guard.classifyLedger(ledger,migrationDir,phase,versions,baseline),/unreviewed/);writeLedger(prerequisites);
for(let i=0;i<5;i++){const missing=canaries.slice();missing[i]=null;assert.throws(()=>renderRehearsal('missing-'+i,missing));}
assert.throws(()=>renderRehearsal('one-domain',canaries.slice(0,4)),/both authenticated/);
const db=new PGlite();let checks=0;
try{
 await db.exec('create schema private; create schema supabase_migrations; create role authenticated; create table supabase_migrations.schema_migrations(version text primary key,statements text[],name text,created_by text);');
 for(const table of new Set([...fingerprintSql.matchAll(/from ((?:public|private)\.[a-z_0-9]+) r/g)].map(m=>m[1])))await db.exec(`create table ${table}(id integer);`);
 await db.exec('insert into public.application_accounting_lines values(1); grant usage on schema public to authenticated; grant select,insert on public.application_accounting_lines to authenticated;');
 for(const v of prerequisites)await db.query('insert into supabase_migrations.schema_migrations(version) values($1)',[v]);
 const fp=async()=>(await db.query(fingerprintSql)).rows[0].fingerprint;
 const original=await fp();
 // Exercise the actual guarded dynamic reads with every new/adjacent table,
 // including equal-count edits. Pre-migration absence must also be stable.
 const relations=[...fingerprintSql.slice(fingerprintSql.indexOf('report_relations(schema_name'),fingerprintSql.indexOf('), report_data_parts')).matchAll(/\('(public|private)','([a-z_0-9]+)'\)/g)].map(m=>m[1]+'.'+m[2]);assert.equal(relations.length,14);
 for(const relation of relations){await db.exec('begin');await db.exec(`create table ${relation}(id integer); insert into ${relation} values(1);`);const before=await fp();await db.exec(`update ${relation} set id=2`);assert.notEqual(await fp(),before,relation+' equal-count edit must alter fingerprint');await db.exec('rollback');assert.equal(await fp(),original);checks++;}
 // First installation: execute the actual domain cleanup blocks after all seven
 // new tables disappear. The older fixtures only exercised synthetic cleanup.
 const fresh=new PGlite();
 const newRelations=[['private.finance_ar_terms_v1','invoice_id text'],['private.finance_ar_receipts_v1','invoice_id text'],['private.finance_ar_refunds_v1','invoice_id text'],['private.finance_ar_audit_v1','invoice_id text'],['private.finance_ar_operations_v1','invoice_id text,operation_key text'],['private.finance_reporting_profile_revisions_v1','reason text'],['public.finance_reporting_profiles','profile jsonb']];
 const oldLeaks=[
  "insert into public.invoices(id) values('__finance_ar_canary_20260910__');",
  "insert into public.invoices(no) values('CANARY-AR-20260910');",
  "insert into public.ledger_entries(source_id) values('__finance_ar_canary_20260910__');",
  "insert into public.ledger_entries(reference_no) values('CANARY-AR-ALW-20260910');",
  "insert into public.vouchers(request_id) values('__finance_ar_canary_20260910__');",
  "insert into public.invoice_lifecycle_events(invoice_id) values('__finance_ar_canary_20260910__');",
  "insert into private.finance_receipt_operations_v1(invoice_ids) values(array['__finance_ar_canary_20260910__']);"
 ];
 const newLeaks=newRelations.map(([table],i)=>i<5?`insert into ${table}(invoice_id) values('__finance_ar_canary_20260910__');`:i===5?`insert into ${table}(reason) values('__finance_reporting_profiles_canary_20260910__');`:`insert into ${table}(profile) values('{"tax":{"periods":{"2099-11-01/2099-12-31":{"priorCarryforwardTax":"123456.78"}}}}');`);
 const createNew=(entries)=>entries.map(([table,columns])=>`create table ${table}(${columns}); grant select,insert on ${table} to authenticated;`).join('\n');
 try{
  await fresh.exec('create schema private; create schema supabase_migrations; create role authenticated; create table supabase_migrations.schema_migrations(version text primary key,statements text[],name text,created_by text);');
  for(const table of new Set([...fingerprintSql.matchAll(/from ((?:public|private)\.[a-z_0-9]+) r/g)].map(m=>m[1])))await fresh.exec(`create table ${table}(id ${table==='public.invoices'?'text':'integer'});`);
  await fresh.exec(`alter table public.invoices add column no text;alter table public.ledger_entries add column source_id text,add column reference_no text;alter table public.vouchers add column request_id text;create table public.invoice_lifecycle_events(invoice_id text);create table private.finance_receipt_operations_v1(invoice_ids text[]);insert into public.application_accounting_lines values(1);grant usage on schema public,private to authenticated;grant select,insert on public.application_accounting_lines,public.invoices,public.ledger_entries,public.vouchers,public.invoice_lifecycle_events,private.finance_receipt_operations_v1 to authenticated;`);
  for(const v of prerequisites)await fresh.query('insert into supabase_migrations.schema_migrations(version) values($1)',[v]);
  const freshFp=async()=>(await fresh.query(fingerprintSql)).rows[0].fingerprint,initial=await freshFp();
  for(const [table] of newRelations)assert.equal((await fresh.query('select to_regclass($1) as relation',[table])).rows[0].relation,null);
  // This is the exact production failure: unguarded original AR and profile
  // cleanup both reference relations absent before initial installation.
  for(const rollback of [arRollback,profileRollback]){await assert.rejects(()=>fresh.exec(rollback),e=>e.code==='42P01');assert.equal(await freshFp(),initial);checks++;}
  for(let i=0;i<2;i++)fs.writeFileSync(path.join(migrationDir,guard.REPORT_MIGRATIONS[i]+'_test.sql'),sources[i]+'\n'+createNew(i===0?newRelations.slice(0,5):newRelations.slice(5)));
  const freshCanaries=canaries.slice();
  freshCanaries[3]=withRollback(makeCanary('fresh_ar',41,null,oldLeaks.concat(newLeaks.slice(0,5)).join('\n')),arRollback,'fresh_ar_original_cleanup');
  freshCanaries[4]=withRollback(makeCanary('fresh_profile',42,null,newLeaks.slice(5).join('\n')),profileRollback,'fresh_profile_original_cleanup');
  const freshSql=renderRehearsal('fresh_install',freshCanaries);
  assert.equal((freshSql.match(/if to_regclass\('(?:private\.finance_ar_|private\.finance_reporting_profile_|public\.finance_reporting_profiles)/g)||[]).length,7);
  await fresh.exec(freshSql);assert.equal(await freshFp(),initial);
  for(const [table] of newRelations)assert.equal((await fresh.query('select to_regclass($1) as relation',[table])).rows[0].relation,null);
  checks++;
  const extractDo=(sql,tag)=>sql.slice(sql.indexOf('do '+tag),sql.indexOf(tag+';',sql.indexOf('do '+tag))+tag.length+1);
  const cleanAr=extractDo(freshSql,'$rollback_check$'),cleanProfile=extractDo(freshSql,'$reporting_profiles_rollback$');
  assert.ok(cleanAr&&cleanProfile);
  // Existing source/capability checks cannot be skipped just because every new
  // table is absent. Each original predicate independently rejects residue.
  for(const leak of oldLeaks){await fresh.exec('begin;'+leak);await assert.rejects(()=>fresh.exec(cleanAr),/rollback left fixture data/);await fresh.exec('rollback');assert.equal(await freshFp(),initial);checks++;}
  // In applied/partial-schema fixtures, dynamic checks still reject each new
  // relation's marker, including operation-key-only capability residue.
  for(let i=0;i<newRelations.length;i++){await fresh.exec('begin;'+createNew([newRelations[i]])+newLeaks[i]);await assert.rejects(()=>fresh.exec(i<5?cleanAr:cleanProfile),/rollback left/);await fresh.exec('rollback');assert.equal(await freshFp(),initial);checks++;}
  await fresh.exec("begin;"+createNew([newRelations[4]])+"insert into private.finance_ar_operations_v1(operation_key) values('canary-ar-orphan-20260910');");await assert.rejects(()=>fresh.exec(cleanAr),/rollback left/);await fresh.exec('rollback');assert.equal(await freshFp(),initial);checks++;
  // A non-sentinel source change after migration rollback must still fail the
  // unchanged complete data fingerprint, independently of the leak checks.
  const changed=freshSql.replace('create temporary table finance_release_fingerprint_after',"insert into public.ledger_entries(source_id) values('unexpected-source-change');\ncreate temporary table finance_release_fingerprint_after");await assert.rejects(()=>fresh.exec(changed),/changed the reviewed database fingerprint/);await fresh.exec('rollback');assert.equal(await freshFp(),initial);checks++;
  const failing=freshCanaries.slice();failing[4]=makeCanary('fresh_failure',43,'core');await assert.rejects(()=>fresh.exec(renderRehearsal('fresh_core_failure',failing)),/intentional core failure/);await fresh.exec('rollback');assert.equal(await freshFp(),initial);checks++;
  const drift=freshCanaries.slice();drift[3]=withRollback(freshCanaries[3],arRollback.replace("invoice_id='__finance_ar_canary_20260910__')\n  or exists(select 1 from private.finance_ar_receipts_v1", "invoice_id='changed-marker')\n  or exists(select 1 from private.finance_ar_receipts_v1"),'changed_cleanup_predicate');assert.throws(()=>renderRehearsal('changed_cleanup',drift),/changed its reviewed predicate/);checks++;
 }finally{for(let i=0;i<2;i++)fs.writeFileSync(path.join(migrationDir,guard.REPORT_MIGRATIONS[i]+'_test.sql'),sources[i]);await fresh.close();}
 const rehearsal=renderRehearsal('rehearsal');assert.equal((rehearsal.match(/^rollback;$/gm)||[]).length,1);
 for(const name of ['auth','cases','utility','receivables','profiles']){assert.ok(rehearsal.indexOf('$'+name+'_core$')<rehearsal.indexOf('rollback to savepoint'));assert.ok(rehearsal.indexOf('$'+name+'_rollback$')>rehearsal.indexOf('rollback to savepoint'));}
 await db.exec(rehearsal);assert.equal(await fp(),original);checks++;
 for(let slot=0;slot<5;slot++)for(const failAt of ['core','rollback']){const paths=canaries.slice();paths[slot]=makeCanary('failure_'+slot+'_'+failAt,30+slot,failAt);await assert.rejects(()=>db.exec(renderRehearsal('fail_'+slot+'_'+failAt,paths)),/intentional/);await db.exec('rollback');assert.equal(await fp(),original);checks++;}
 const badPost=write('bad-postflight.sql','\\set ON_ERROR_STOP on\nselect 1/0;\n');
 for(const slot of ['ar','profile']){await assert.rejects(()=>db.exec(renderApply('bad_apply_'+slot,slot==='ar'?badPost:postflight,slot==='profile'?badPost:profilesPostflight)),/division by zero/);await db.exec('rollback');assert.equal(await fp(),original);checks++;}
 const second=path.join(migrationDir,guard.REPORT_MIGRATIONS[1]+'_test.sql');fs.writeFileSync(second,sources[1]+' select 1/0;');await assert.rejects(()=>db.exec(renderApply('bad_second_migration')),/division by zero/);await db.exec('rollback');assert.equal(await fp(),original);fs.writeFileSync(second,sources[1]);checks++;
 const apply=renderApply('apply');assert.match(apply,/pg_advisory_xact_lock[\s\S]+lock table supabase_migrations\.schema_migrations/);assert.ok(apply.indexOf(sources[0])<apply.indexOf(sources[1]));
 await db.query('insert into supabase_migrations.schema_migrations(version) values($1)',['20260910070000']);await assert.rejects(()=>db.exec(apply),/ledger changed/);await db.exec('rollback');await db.query('delete from supabase_migrations.schema_migrations where version=$1',['20260910070000']);assert.equal(await fp(),original);checks++;
 await db.exec(apply);assert.equal((await db.query('select id from public.application_accounting_lines')).rows[0].id,3);
 for(let i=0;i<2;i++){const r=(await db.query('select statements from supabase_migrations.schema_migrations where version=$1',[guard.REPORT_MIGRATIONS[i]])).rows[0];assert.deepEqual(r.statements,[sources[i]]);}
 const applied=await fp();await assert.rejects(()=>db.exec(apply),/ledger changed/);await db.exec('rollback');assert.equal(await fp(),applied);writeLedger([...prerequisites,...guard.REPORT_MIGRATIONS]);assert.equal(guard.classifyLedger(ledger,migrationDir,phase,versions,baseline),'applied');assert.equal(guard.classifyLedger(ledger,migrationDir,'frontend_compat','none',baseline),'compat');assert.throws(()=>renderApply('reapply'),/pending/);checks++;
 for(const [domain,marker,expected] of [['receivables','canonical_receivables_canary_result',{canary:'authenticated_canonical_receivables_v1',ok:true,rolled_back:true,receivables_consistent:true}],['profiles','reporting_profiles_canary_result',{canary:'authenticated_reporting_profiles_v1',ok:true,rolled_back:true,profile_authority_preserved:true}]]){
  const out=write(domain+'.json','[]'),row=value=>({[marker]:value});
  const accepted=[[row(expected)],{boundary:'probe',rows:[row(expected)],warning:'untrusted'},[row(JSON.stringify(expected))],{results:[{rows:[row(expected)]}]}];
  for(const v of accepted){fs.writeFileSync(out,JSON.stringify(v));assert.equal(guard.verifyReportsCanary(out,domain),true);checks++;}
  const bad=[{},[],null,expected,[row(expected),row(expected)],{rows:[row(expected)],nested:row(expected)},[row({...expected,nested:row(expected)})],[row('{invalid')],[row({})],[row(null)],[row({...expected,unexpected:true})],...Object.keys(expected).map(k=>[row(Object.fromEntries(Object.entries(expected).filter(([name])=>name!==k)))]),...Object.keys(expected).flatMap(k=>[false,'true',1,null].map(value=>[row({...expected,[k]:value})]))];
  for(const v of bad){fs.writeFileSync(out,JSON.stringify(v));assert.throws(()=>guard.verifyReportsCanary(out,domain));checks++;}
  for(const v of ['','[','bad-json']){fs.writeFileSync(out,v);assert.throws(()=>guard.verifyReportsCanary(out,domain),/not valid JSON/);checks++;}
  for(const [value,pass] of [[accepted[0],true],[accepted[1],true],[bad[4],false]]){fs.writeFileSync(out,JSON.stringify(value));const cli=spawnSync(process.execPath,[path.join(repo,'scripts/finance_production_release_guard.js'),'verify-reports-canary','--domain',domain,'--input',out],{encoding:'utf8'});assert.equal(cli.status===0,pass,cli.stderr);checks++;}
 }
 assert.throws(()=>guard.verifyReportsCanary(ledger,'utility'),/domain must/);
 const files=['finance_production_authenticated_canary.sql','finance_finalize_accounting_lines_canary.sql','finance_utility_tax_canary.sql','finance_canonical_receivables_canary.sql','finance_reporting_profiles_canary.sql'];
 for(const file of files){const raw=fs.readFileSync(path.join(repo,'scripts',file),'utf8');assert.doesNotMatch(raw,/^\s*\\/m);assert.equal((raw.match(/^rollback;$/gm)||[]).length,1);assert.doesNotMatch(raw,/^\s*commit\s*;/im);for(const section of ['CORE','ROLLBACK_CHECK'])for(const bound of ['BEGIN','END'])assert.equal(raw.split('-- FINANCE_AUTHENTICATED_CANARY_'+section+'_'+bound).length,2);checks++;}
 const actual=path.join(dir,'actual-rehearsal.sql');const cli=spawnSync(process.execPath,[path.join(repo,'scripts/finance_production_release_guard.js'),'prepare-reports-rehearsal','--migration-dir',path.join(repo,'supabase/migrations'),'--output',actual,'--migration-versions',versions,'--fingerprint',fingerprint,'--authenticated-canary',path.join(repo,'scripts',files[0]),'--case-canary',path.join(repo,'scripts',files[1]),'--utility-canary',path.join(repo,'scripts',files[2]),'--receivables-canary',path.join(repo,'scripts',files[3]),'--profiles-canary',path.join(repo,'scripts',files[4]),'--receivables-postflight',path.join(repo,'scripts/finance_canonical_receivables_postflight.sql'),'--profiles-postflight',path.join(repo,'scripts/finance_reporting_profiles_postflight.sql')],{encoding:'utf8'});assert.equal(cli.status,0,cli.stderr);const sql=fs.readFileSync(actual,'utf8');assert.doesNotMatch(sql,/^\s*\\/m);for(const v of guard.REPORT_MIGRATIONS){const filename=guard.migrationFiles(path.join(repo,'supabase/migrations')).find(name=>name.startsWith(v+'_'));assert.ok(sql.includes(fs.readFileSync(path.join(repo,'supabase/migrations',filename),'utf8').trimEnd()));}checks++;
 console.log('PASS reports release batch: '+checks+' SQL rollback/fingerprint, atomic apply, strict transport and actual source rendering checks');
}finally{await db.close();fs.rmSync(dir,{recursive:true,force:true});}
