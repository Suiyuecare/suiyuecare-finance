import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {PGlite} from '@electric-sql/pglite';
import guard from './finance_production_release_guard.js';

// Actual protected renderer, executed by isolated PostgreSQL. This proves atomic
// release behavior; confidential HR business rules and browser behavior have other gates.
const repo=fileURLToPath(new URL('..',import.meta.url));
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'finance-hr-bridge-release-'));
const migrationDir=path.join(dir,'migrations');fs.mkdirSync(migrationDir);
const phase=guard.RELEASE_PHASE_DATABASE_HR_BRIDGE,batch=guard.HR_BRIDGE_MIGRATIONS,versions=batch.join(',');
const prerequisites=['20260820000000',...guard.REVIEWED_MIGRATION_CATALOG.filter(v=>v<batch[0])];
const baseline={count:1,lastVersion:prerequisites[0],sha256:guard.ledgerSha256([prerequisites[0]])};
const write=(name,body)=>{const file=path.join(dir,name);fs.writeFileSync(file,body);return file;};
const ledger=write('ledger.txt','');const writeLedger=rows=>fs.writeFileSync(ledger,rows.join('\n')+'\n');
const source=`alter policy invoice_scope_release_policy on public.invoices using ((select public.invoice_scope_release_actor()));
create table private.hr_bridge_release_projection(id integer primary key,summary text);
insert into private.hr_bridge_release_projection values(1,'indexed');
alter table private.hr_bridge_release_projection enable row level security;
revoke all on table private.hr_bridge_release_projection from public;
create or replace function public.hr_bridge_release_probe() returns integer language sql as $$select 1$$;
`;
const sources=[source,'create table private.hr_ar_release_dependency(id integer primary key);\n','alter table private.hr_bridge_release_projection add column voucher_posting integer not null default 2;\n'];
for(const v of guard.REVIEWED_MIGRATION_CATALOG)write('migrations/'+v+'_fixture.sql',batch.includes(v)?sources[batch.indexOf(v)]:'select 1;');
const posts=guard.REPORT_POSTFLIGHT_FILES.concat('finance_amount_search_postflight.sql',guard.REPORTING_INTEGRITY_POSTFLIGHT_FILES,guard.AUDIT_READINESS_POSTFLIGHT_FILES,guard.EMPLOYEE_RELIABILITY_POSTFLIGHT_FILES,guard.HISTORY_PERFORMANCE_POSTFLIGHT_FILES,guard.READ_LATENCY_POSTFLIGHT_FILES,guard.AR_MAPPING_POSTFLIGHT_FILES,guard.AUDIT_REMEDIATION_POSTFLIGHT_FILES,guard.APPROVAL_SEARCH_POSTFLIGHT_FILES,guard.HISTORY_SUMMARY_POSTFLIGHT_FILES,guard.INVOICE_READ_SCOPE_POSTFLIGHT_FILES,guard.AR_READ_SCOPE_POSTFLIGHT_FILES,guard.HR_BRIDGE_POSTFLIGHT_FILES);
assert.equal(posts.length,22);
const postSources=posts.map((name,i)=>`\\set ON_ERROR_STOP on\n${i===0?"select set_config('finance.release_migration_versions', :'migration_versions', true);\n":''}do $post_${i}$ begin if public.hr_bridge_release_probe()<>1 then raise exception 'postflight before migration';end if;end;$post_${i}$;\n`);
posts.forEach((name,i)=>write(name,postSources[i]));
const arPost=path.join(dir,posts[5]),profilePost=path.join(dir,posts[6]);
const fingerprint=path.join(repo,'scripts/finance_hr_bridge_fingerprint.sql');
const fpSql=fs.readFileSync(fingerprint,'utf8').replace(/^\\set ON_ERROR_STOP on\n/,'');
const canaries=['dashboard','google','search','summary','invoice','ar'].map(name=>write(name+'.sql',`-- Synthetic read-only ${name} contract
begin isolation level repeatable read read only;
-- FINANCE_AUTHENTICATED_CANARY_CORE_BEGIN
do $${name}_core$ begin if public.hr_bridge_release_probe()<>1 or not exists(select 1 from private.hr_bridge_release_projection where id=1) then raise exception 'canary before migration';end if;end;$${name}_core$;
-- FINANCE_AUTHENTICATED_CANARY_CORE_END
rollback;
-- FINANCE_AUTHENTICATED_CANARY_ROLLBACK_CHECK_BEGIN
do $${name}_rollback$ begin if public.hr_bridge_release_probe()<>0 or to_regclass('private.hr_bridge_release_projection') is not null then raise exception 'projection survived rehearsal';end if;end;$${name}_rollback$;
-- FINANCE_AUTHENTICATED_CANARY_ROLLBACK_CHECK_END
`));
let serial=0,checks=0;const check=()=>checks++;const output=label=>path.join(dir,`${serial++}-${label}.sql`);
const rehearsal=(paths=canaries)=>{const file=output('rehearsal');guard.prepareHrBridgeRehearsal(migrationDir,file,versions,ledger,fingerprint,...paths,arPost,profilePost,baseline);return fs.readFileSync(file,'utf8');};
const apply=()=>{const file=output('apply');guard.prepareAuditBatchApply(migrationDir,file,versions,ledger,arPost,baseline,phase,profilePost);return fs.readFileSync(file,'utf8');};
const migrationFile=path.join(migrationDir,batch[0]+'_fixture.sql');
assert.equal(versions,'20260922072109,20260922072737,20260922075604');check();
for(const v of ['none','20260914091205','20260915050313,20260915080928',versions+',20260915080929']){assert.throws(()=>guard.releasePlan(phase,v));check();}
for(let prefix=0;prefix<=prerequisites.length;prefix++){
 writeLedger(prerequisites.slice(0,prefix));
 if(prefix===prerequisites.length){assert.equal(guard.classifyLedger(ledger,migrationDir,phase,versions,baseline),'pending');assert.deepEqual(guard.pendingHrBridgeBatch(migrationDir,versions,ledger,baseline).map(x=>x.version),batch);}
 else{assert.throws(()=>rehearsal());assert.throws(()=>apply());}
 check();
}
// A migration cannot hide missing historical prerequisites, even if recorded.
for(const missing of prerequisites){writeLedger([...prerequisites.filter(v=>v!==missing),...batch]);assert.throws(()=>rehearsal());assert.throws(()=>apply());check();}
for(const rows of [[...prerequisites,'20260923000000'],[...prerequisites,...batch,'20260923000000'],[...prerequisites,batch[0],batch[0]],[...prerequisites].reverse()]){writeLedger(rows);assert.throws(()=>rehearsal());assert.throws(()=>apply());check();}
for(const subset of [[batch[0]],[batch[2]],[batch[0],batch[1]],[batch[1],batch[2]]]){writeLedger([...prerequisites,...subset]);assert.throws(()=>rehearsal(),/partial atomic migration batch/);assert.throws(()=>apply(),/partial atomic migration batch/);assert.throws(()=>guard.classifyLedger(ledger,migrationDir,guard.RELEASE_PHASE_DATABASE_AR_READ_SCOPE,guard.AR_READ_SCOPE_MIGRATIONS.join(','),baseline),/partial atomic migration batch/);assert.throws(()=>guard.classifyLedger(ledger,migrationDir,'frontend_compat','none',baseline),/complete (?:HR bridge|AR read scope)/);check();}
writeLedger(prerequisites);
assert.throws(()=>guard.classifyLedger(ledger,migrationDir,'frontend_compat','none',baseline),/AR read scope migration batch/);check();
fs.unlinkSync(migrationFile);assert.throws(()=>apply(),/migration file is missing/);fs.writeFileSync(migrationFile,source+'\ncommit;');assert.throws(()=>apply(),/transaction control/);fs.writeFileSync(migrationFile,source);check();
for(let slot=0;slot<6;slot++){const paths=canaries.slice();paths[slot]=null;assert.throws(()=>rehearsal(paths));check();}
const good=fs.readFileSync(canaries[5],'utf8');
for(const bad of [good.replace('read read only','read'),good.replace('rollback;','commit;'),'\\set ON_ERROR_STOP on\n'+good,good.replace('begin if',"begin perform set_config('request.jwt.claim.sub','fake',true); if"),good.replace('begin if','begin insert into public.invoices values(1); if'),good+'\n-- FINANCE_AUTHENTICATED_CANARY_CORE_BEGIN']){const file=write('unsafe.sql',bad);assert.throws(()=>rehearsal([...canaries.slice(0,5),file]));check();}
async function initialize(db){
 await db.exec('create schema private;create schema auth;create schema net;create schema supabase_migrations;create role authenticated;create table supabase_migrations.schema_migrations(version text primary key,statements text[],name text,created_by text);');
 for(const table of new Set([...fpSql.matchAll(/from ((?:public|private|auth)\.[a-z_0-9]+) r/g)].map(m=>m[1])))await db.exec(`create table ${table}(id integer);`);
 await db.exec('alter table public.invoices enable row level security;create function public.invoice_scope_release_actor() returns boolean language sql stable as $$select true$$;create policy invoice_scope_release_policy on public.invoices for select to authenticated using(public.invoice_scope_release_actor());create function public.hr_bridge_release_probe() returns integer language sql as $$select 0$$;insert into public.application_accounting_lines values(1);');
 for(const v of prerequisites)await db.query('insert into supabase_migrations.schema_migrations(version) values($1)',[v]);
}
const db=new PGlite();
try{
 await initialize(db);
 const fp=async()=>(await db.query(fpSql)).rows[0].fingerprint,original=await fp();
 // Policy definitions alone must participate in the inherited fingerprint;
 // checking only rows or function bodies would miss this migration entirely.
 await db.exec('begin;alter policy invoice_scope_release_policy on public.invoices using ((select public.invoice_scope_release_actor()));');assert.notEqual(await fp(),original);await db.exec('rollback');assert.equal(await fp(),original);check();
 const sql=rehearsal();assert.equal((sql.match(/^rollback;$/gm)||[]).length,1);assert.equal((sql.match(/insert into supabase_migrations.schema_migrations\(version/g)||[]).length,batch.length);assert.match(sql,/pg_advisory_xact_lock[\s\S]+lock table supabase_migrations/);
 for(const name of posts){const at=sql.indexOf('-- Reviewed reports postflight: '+name);assert.ok(at>sql.indexOf(source.trimEnd())&&at<sql.indexOf('$dashboard_core$'));}
 await db.exec(sql);assert.equal(await fp(),original,'rehearsal restores new projection, function and ledger');check();
 const prerequisiteOutput=output('prerequisites');guard.prepareHrBridgePrerequisiteQuery(path.join(dir,posts[0]),prerequisiteOutput,migrationDir,versions,ledger,baseline);const prior=fs.readFileSync(prerequisiteOutput,'utf8');assert.equal((prior.match(/-- Reviewed reports postflight:/g)||[]).length,20);assert.ok(!prior.includes('finance_hr_bridge_postflight.sql'));check();
 for(let slot=0;slot<batch.length;slot++){
  const file=path.join(migrationDir,batch[slot]+'_fixture.sql');
  fs.writeFileSync(file,sources[slot]+"do $fail$ begin raise exception 'intentional migration failure';end;$fail$;\n");
  for(const mode of [rehearsal,apply]){await assert.rejects(()=>db.exec(mode()),/intentional migration failure/);await db.exec('rollback');assert.equal(await fp(),original);check();}fs.writeFileSync(file,sources[slot]);
 }
 for(let i=0;i<posts.length;i++){
  write(posts[i],postSources[i]+"do $fail$ begin raise exception 'intentional postflight failure';end;$fail$;\n");
  for(const mode of [rehearsal,apply]){await assert.rejects(()=>db.exec(mode()),/intentional postflight failure/);await db.exec('rollback');assert.equal(await fp(),original,'postflight failure must roll back DDL, projection contents and ledger');check();}
  fs.unlinkSync(path.join(dir,posts[i]));assert.throws(()=>apply(),/ENOENT/);write(posts[i],postSources[i]);check();
 }
 for(let slot=0;slot<6;slot++)for(const section of ['core','rollback']){
  const label=['dashboard','google','search','summary','invoice','ar'][slot],bad=write('fail-canary.sql',fs.readFileSync(canaries[slot],'utf8').replace(`end;$${label}_${section}$;`,`raise exception 'intentional ${section} failure';end;$${label}_${section}$;`)),paths=canaries.slice();paths[slot]=bad;
  await assert.rejects(()=>db.exec(rehearsal(paths)),/intentional .* failure/);await db.exec('rollback');assert.equal(await fp(),original);check();
 }
 const atomic=apply(),staleRehearsal=rehearsal();assert.equal((atomic.match(/^commit;$/gm)||[]).length,1);assert.equal((atomic.match(/insert into supabase_migrations.schema_migrations\(version/g)||[]).length,batch.length);
 await db.query('insert into supabase_migrations.schema_migrations(version) values($1)',['20260923000000']);
 for(const raw of [atomic,staleRehearsal]){await assert.rejects(()=>db.exec(raw),/ledger changed/);await db.exec('rollback');check();}
 await db.query('delete from supabase_migrations.schema_migrations where version=$1',['20260923000000']);assert.equal(await fp(),original);
 await db.exec(atomic);const applied=await fp();assert.notEqual(applied,original);for(let slot=0;slot<batch.length;slot++)assert.deepEqual((await db.query('select statements from supabase_migrations.schema_migrations where version=$1',[batch[slot]])).rows[0].statements,[sources[slot].trimEnd()]);check();
 await assert.rejects(()=>db.exec(atomic),/ledger changed/);await db.exec('rollback');assert.equal(await fp(),applied);check();
 writeLedger([...prerequisites,...batch]);assert.equal(guard.classifyLedger(ledger,migrationDir,phase,versions,baseline),'applied');assert.equal(guard.classifyLedger(ledger,migrationDir,'frontend_compat','none',baseline),'compat');assert.throws(()=>rehearsal(),/pending/);assert.throws(()=>apply(),/pending/);check();
 for(const p of [phase,'frontend_compat']){const file=output('recovery');guard.preparePhaseQuery(path.join(dir,posts[0]),file,p,p===phase?versions:'none');const raw=fs.readFileSync(file,'utf8');assert.match(raw,/^begin read only;/);assert.equal((raw.match(/-- Reviewed reports postflight:/g)||[]).length,22);assert.doesNotMatch(raw,/insert into supabase_migrations|create or replace function/);await db.exec(raw);assert.equal(await fp(),applied);check();}
 const marker='invoice_select_initplan_canary_result',result={canary:'readonly_invoice_select_initplan_v1',ok:true,rolled_back:true,ordinary_scope_preserved:true},json=write('marker.json','[]');
 for(const payload of [[{[marker]:result}],{rows:[{[marker]:JSON.stringify(result)}]},{results:[{rows:[{[marker]:result}]}]}]){fs.writeFileSync(json,JSON.stringify(payload));assert.equal(guard.verifyReportsCanary(json,'invoice_read_scope'),true);check();}
 for(const payload of [[],[{[marker]:result},{[marker]:result}],...Object.keys(result).flatMap(k=>[{[marker]:{...result,[k]:false}},{[marker]:Object.fromEntries(Object.entries(result).filter(([key])=>key!==k))}]),{[marker]:{...result,extra:true}}]){fs.writeFileSync(json,JSON.stringify(payload));assert.throws(()=>guard.verifyReportsCanary(json,'invoice_read_scope'));check();}
 fs.writeFileSync(json,JSON.stringify([{[marker]:result}]));assert.equal(spawnSync(process.execPath,[path.join(repo,'scripts/finance_production_release_guard.js'),'verify-reports-canary','--domain','invoice_read_scope','--input',json]).status,0);fs.writeFileSync(json,'[]');assert.notEqual(spawnSync(process.execPath,[path.join(repo,'scripts/finance_production_release_guard.js'),'verify-reports-canary','--domain','invoice_read_scope','--input',json]).status,0);check();
 // The operational migration, inherited/new postflights and read-only
 // canaries are rendered from sealed files without stripping SQL statements.
 writeLedger(prerequisites);
 const actualDir=path.join(repo,'supabase/migrations'),scripts=path.join(repo,'scripts');
 const actualOutput=output('actual-rehearsal');
 guard.prepareHrBridgeRehearsal(actualDir,actualOutput,versions,ledger,path.join(scripts,'finance_hr_bridge_fingerprint.sql'),...['finance_dashboard_scope_canary.sql','finance_google_projection_canary.sql','finance_approval_search_canary.sql','finance_approval_history_summary_canary.sql','finance_invoice_select_initplan_canary.sql','finance_ar_verified_accounting_scope_canary.sql'].map(name=>path.join(scripts,name)),path.join(scripts,posts[5]),path.join(scripts,posts[6]),baseline);
 const actual=fs.readFileSync(actualOutput,'utf8');
 for(const version of batch){const file=guard.migrationFiles(actualDir).find(name=>name.startsWith(version+'_'));assert.ok(actual.includes(fs.readFileSync(path.join(actualDir,file),'utf8').trimEnd()),'full migration text survives sealed renderer');check();}
 for(const name of posts){assert.ok(actual.includes(fs.readFileSync(path.join(scripts,name),'utf8').replace(/^\\set ON_ERROR_STOP on\n/,'').replace(/:'migration_versions'/g,"'20260827052447'").trimEnd()),'full postflight text survives renderer: '+name);check();}
 const actualApply=output('actual-apply');guard.prepareAuditBatchApply(actualDir,actualApply,versions,ledger,path.join(scripts,posts[5]),baseline,phase,path.join(scripts,posts[6]));
 assert.equal((fs.readFileSync(actualApply,'utf8').match(/^commit;$/gm)||[]).length,1);check();
 // The AR task may already have completed independently. Its existing schema
 // and ledger must survive HR rehearsal; only the missing two HR versions apply.
 const arFirst=new PGlite();
 try{
  await initialize(arFirst);
  await arFirst.exec(sources[1]);
  await arFirst.query('insert into supabase_migrations.schema_migrations(version) values($1)',[batch[1]]);
  writeLedger([...prerequisites,batch[1]]);
  assert.equal(guard.classifyLedger(ledger,migrationDir,phase,versions,baseline),'pending');
  assert.deepEqual(guard.pendingHrBridgeBatch(migrationDir,versions,ledger,baseline).map(x=>x.version),[batch[0],batch[2]]);
  const before=(await arFirst.query(fpSql)).rows[0].fingerprint;
  const trial=rehearsal();assert.equal((trial.match(/insert into supabase_migrations.schema_migrations\(version/g)||[]).length,2);
  await arFirst.exec(trial);assert.equal((await arFirst.query(fpSql)).rows[0].fingerprint,before);check();
  const prerequisiteOutput=output('ar-installed-prerequisites');guard.prepareHrBridgePrerequisiteQuery(path.join(dir,posts[0]),prerequisiteOutput,migrationDir,versions,ledger,baseline);
  assert.equal((fs.readFileSync(prerequisiteOutput,'utf8').match(/-- Reviewed reports postflight:/g)||[]).length,21);check();
  await arFirst.exec(apply());
  assert.deepEqual((await arFirst.query('select version from supabase_migrations.schema_migrations where version=any($1::text[]) order by version',[batch])).rows.map(x=>x.version),batch);check();
 }finally{await arFirst.close();}
 console.log(`PASS HR bridge protected release: ${checks} atomic-state and sealed-source checks`);
}finally{await db.close();fs.rmSync(dir,{recursive:true,force:true});}
