import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {PGlite} from '@electric-sql/pglite';
import guard from './finance_production_release_guard.js';

// Actual protected renderer, executed by isolated PostgreSQL. This proves atomic
// release behavior; actual search correctness and browser timing have other gates.
const repo=fileURLToPath(new URL('..',import.meta.url));
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'finance-history-summary-release-'));
const migrationDir=path.join(dir,'migrations');fs.mkdirSync(migrationDir);
const phase=guard.RELEASE_PHASE_DATABASE_HISTORY_SUMMARY,batch=guard.HISTORY_SUMMARY_MIGRATIONS,versions=batch.join(',');
const prerequisites=['20260820000000',...guard.REVIEWED_MIGRATION_CATALOG.filter(v=>v<batch[0])];
const baseline={count:1,lastVersion:prerequisites[0],sha256:guard.ledgerSha256([prerequisites[0]])};
const write=(name,body)=>{const file=path.join(dir,name);fs.writeFileSync(file,body);return file;};
const ledger=write('ledger.txt','');const writeLedger=rows=>fs.writeFileSync(ledger,rows.join('\n')+'\n');
const source=`create table private.history_summary_release_projection(id integer primary key,summary text);
insert into private.history_summary_release_projection values(1,'indexed');
alter table private.history_summary_release_projection enable row level security;
revoke all on table private.history_summary_release_projection from public;
create or replace function public.history_summary_release_probe() returns integer language sql as $$select 1$$;
`;
for(const v of guard.REVIEWED_MIGRATION_CATALOG)write('migrations/'+v+'_fixture.sql',batch.includes(v)?source:'select 1;');
const posts=guard.REPORT_POSTFLIGHT_FILES.concat('finance_amount_search_postflight.sql',guard.REPORTING_INTEGRITY_POSTFLIGHT_FILES,guard.AUDIT_READINESS_POSTFLIGHT_FILES,guard.EMPLOYEE_RELIABILITY_POSTFLIGHT_FILES,guard.HISTORY_PERFORMANCE_POSTFLIGHT_FILES,guard.READ_LATENCY_POSTFLIGHT_FILES,guard.AR_MAPPING_POSTFLIGHT_FILES,guard.AUDIT_REMEDIATION_POSTFLIGHT_FILES,guard.APPROVAL_SEARCH_POSTFLIGHT_FILES,guard.HISTORY_SUMMARY_POSTFLIGHT_FILES);
assert.equal(posts.length,19);
// Historical summary apply/rehearsal stays at nineteen checks. Only the current
// frontend compatibility recovery includes the later invoice and HR contracts.
for(const name of [...guard.INVOICE_READ_SCOPE_POSTFLIGHT_FILES,...guard.HR_BRIDGE_POSTFLIGHT_FILES])write(name,'\\set ON_ERROR_STOP on\nselect 1;\n');
const postSources=posts.map((name,i)=>`\\set ON_ERROR_STOP on\n${i===0?"select set_config('finance.release_migration_versions', :'migration_versions', true);\n":''}do $post_${i}$ begin if public.history_summary_release_probe()<>1 then raise exception 'postflight before migration';end if;end;$post_${i}$;\n`);
posts.forEach((name,i)=>write(name,postSources[i]));
const arPost=path.join(dir,posts[5]),profilePost=path.join(dir,posts[6]);
const fingerprint=path.join(repo,'scripts/finance_statement_source_fingerprint.sql');
const fpSql=fs.readFileSync(fingerprint,'utf8').replace(/^\\set ON_ERROR_STOP on\n/,'');
const canaries=['dashboard','google','search','summary'].map(name=>write(name+'.sql',`-- Synthetic read-only ${name} contract
begin isolation level repeatable read read only;
-- FINANCE_AUTHENTICATED_CANARY_CORE_BEGIN
do $${name}_core$ begin if public.history_summary_release_probe()<>1 or not exists(select 1 from private.history_summary_release_projection where id=1) then raise exception 'canary before migration';end if;end;$${name}_core$;
-- FINANCE_AUTHENTICATED_CANARY_CORE_END
rollback;
-- FINANCE_AUTHENTICATED_CANARY_ROLLBACK_CHECK_BEGIN
do $${name}_rollback$ begin if public.history_summary_release_probe()<>0 or to_regclass('private.history_summary_release_projection') is not null then raise exception 'projection survived rehearsal';end if;end;$${name}_rollback$;
-- FINANCE_AUTHENTICATED_CANARY_ROLLBACK_CHECK_END
`));
let serial=0,checks=0;const check=()=>checks++;const output=label=>path.join(dir,`${serial++}-${label}.sql`);
const rehearsal=(paths=canaries)=>{const file=output('rehearsal');guard.prepareHistorySummaryRehearsal(migrationDir,file,versions,ledger,fingerprint,...paths,arPost,profilePost,baseline);return fs.readFileSync(file,'utf8');};
const apply=()=>{const file=output('apply');guard.prepareAuditBatchApply(migrationDir,file,versions,ledger,arPost,baseline,phase,profilePost);return fs.readFileSync(file,'utf8');};
const migrationFile=path.join(migrationDir,batch[0]+'_fixture.sql');
assert.equal(versions,'20260915050313');check();
for(const v of ['none','20260914091205','20260914091205,20260915050313',versions+',20260915050314']){assert.throws(()=>guard.releasePlan(phase,v));check();}
for(let prefix=0;prefix<=prerequisites.length;prefix++){
 writeLedger(prerequisites.slice(0,prefix));
 if(prefix===prerequisites.length){assert.equal(guard.classifyLedger(ledger,migrationDir,phase,versions,baseline),'pending');assert.deepEqual(guard.pendingHistorySummaryBatch(migrationDir,versions,ledger,baseline).map(x=>x.version),batch);}
 else{assert.throws(()=>rehearsal());assert.throws(()=>apply());}
 check();
}
// A migration cannot hide missing historical prerequisites, even if recorded.
for(const missing of prerequisites){writeLedger([...prerequisites.filter(v=>v!==missing),...batch]);assert.throws(()=>rehearsal());assert.throws(()=>apply());check();}
for(const rows of [[...prerequisites,'20260915050314'],[...prerequisites,...batch,'20260915050314'],[...prerequisites,batch[0],batch[0]],[...prerequisites].reverse()]){writeLedger(rows);assert.throws(()=>rehearsal());assert.throws(()=>apply());check();}
writeLedger(prerequisites);
assert.throws(()=>guard.classifyLedger(ledger,migrationDir,'frontend_compat','none',baseline),/history summary migration batch/);check();
fs.unlinkSync(migrationFile);assert.throws(()=>apply(),/migration file is missing/);fs.writeFileSync(migrationFile,source+'\ncommit;');assert.throws(()=>apply(),/transaction control/);fs.writeFileSync(migrationFile,source);check();
for(let slot=0;slot<4;slot++){const paths=canaries.slice();paths[slot]=null;assert.throws(()=>rehearsal(paths));check();}
const good=fs.readFileSync(canaries[3],'utf8');
for(const bad of [good.replace('read read only','read'),good.replace('rollback;','commit;'),'\\set ON_ERROR_STOP on\n'+good,good.replace('begin if',"begin perform set_config('request.jwt.claim.sub','fake',true); if"),good.replace('begin if','begin insert into public.invoices values(1); if'),good+'\n-- FINANCE_AUTHENTICATED_CANARY_CORE_BEGIN']){const file=write('unsafe.sql',bad);assert.throws(()=>rehearsal([...canaries.slice(0,3),file]));check();}
const db=new PGlite();
try{
 await db.exec('create schema private;create schema auth;create schema net;create schema supabase_migrations;create role authenticated;create table supabase_migrations.schema_migrations(version text primary key,statements text[],name text,created_by text);');
 for(const table of new Set([...fpSql.matchAll(/from ((?:public|private|auth)\.[a-z_0-9]+) r/g)].map(m=>m[1])))await db.exec(`create table ${table}(id integer);`);
 await db.exec('create function public.history_summary_release_probe() returns integer language sql as $$select 0$$;insert into public.application_accounting_lines values(1);');
 for(const v of prerequisites)await db.query('insert into supabase_migrations.schema_migrations(version) values($1)',[v]);
 const fp=async()=>(await db.query(fpSql)).rows[0].fingerprint,original=await fp();
 const sql=rehearsal();assert.equal((sql.match(/^rollback;$/gm)||[]).length,1);assert.match(sql,/pg_advisory_xact_lock[\s\S]+lock table supabase_migrations/);
 for(const name of posts){const at=sql.indexOf('-- Reviewed reports postflight: '+name);assert.ok(at>sql.indexOf(source.trimEnd())&&at<sql.indexOf('$dashboard_core$'));}
 await db.exec(sql);assert.equal(await fp(),original,'rehearsal restores new projection, function and ledger');check();
 const prerequisiteOutput=output('prerequisites');guard.prepareHistorySummaryPrerequisiteQuery(path.join(dir,posts[0]),prerequisiteOutput,migrationDir,versions,ledger,baseline);const prior=fs.readFileSync(prerequisiteOutput,'utf8');assert.equal((prior.match(/-- Reviewed reports postflight:/g)||[]).length,18);assert.ok(!prior.includes('finance_approval_history_summary_postflight.sql'));check();
 fs.writeFileSync(migrationFile,source+"do $fail$ begin raise exception 'intentional migration failure';end;$fail$;\n");
 for(const mode of [rehearsal,apply]){await assert.rejects(()=>db.exec(mode()),/intentional migration failure/);await db.exec('rollback');assert.equal(await fp(),original);check();}fs.writeFileSync(migrationFile,source);
 for(let i=0;i<posts.length;i++){
  write(posts[i],postSources[i]+"do $fail$ begin raise exception 'intentional postflight failure';end;$fail$;\n");
  for(const mode of [rehearsal,apply]){await assert.rejects(()=>db.exec(mode()),/intentional postflight failure/);await db.exec('rollback');assert.equal(await fp(),original,'postflight failure must roll back DDL, projection contents and ledger');check();}
  fs.unlinkSync(path.join(dir,posts[i]));assert.throws(()=>apply(),/ENOENT/);write(posts[i],postSources[i]);check();
 }
 for(let slot=0;slot<4;slot++)for(const section of ['core','rollback']){
  const label=['dashboard','google','search','summary'][slot],bad=write('fail-canary.sql',fs.readFileSync(canaries[slot],'utf8').replace(`end;$${label}_${section}$;`,`raise exception 'intentional ${section} failure';end;$${label}_${section}$;`)),paths=canaries.slice();paths[slot]=bad;
  await assert.rejects(()=>db.exec(rehearsal(paths)),/intentional .* failure/);await db.exec('rollback');assert.equal(await fp(),original);check();
 }
 const atomic=apply(),staleRehearsal=rehearsal();assert.equal((atomic.match(/^commit;$/gm)||[]).length,1);assert.equal((atomic.match(/insert into supabase_migrations.schema_migrations\(version/g)||[]).length,1);
 await db.query('insert into supabase_migrations.schema_migrations(version) values($1)',['20260915050314']);
 for(const raw of [atomic,staleRehearsal]){await assert.rejects(()=>db.exec(raw),/ledger changed/);await db.exec('rollback');check();}
 await db.query('delete from supabase_migrations.schema_migrations where version=$1',['20260915050314']);assert.equal(await fp(),original);
 await db.exec(atomic);const applied=await fp();assert.notEqual(applied,original);assert.deepEqual((await db.query('select statements from supabase_migrations.schema_migrations where version=$1',[batch[0]])).rows[0].statements,[source.trimEnd()]);check();
 await assert.rejects(()=>db.exec(atomic),/ledger changed/);await db.exec('rollback');assert.equal(await fp(),applied);check();
 writeLedger([...prerequisites,...batch]);assert.equal(guard.classifyLedger(ledger,migrationDir,phase,versions,baseline),'applied');assert.throws(()=>guard.classifyLedger(ledger,migrationDir,'frontend_compat','none',baseline),/invoice read scope migration batch/);assert.throws(()=>rehearsal(),/pending/);assert.throws(()=>apply(),/pending/);check();
 writeLedger([...prerequisites,...batch,...guard.INVOICE_READ_SCOPE_MIGRATIONS]);assert.throws(()=>guard.classifyLedger(ledger,migrationDir,'frontend_compat','none',baseline),/HR bridge migration batch/);writeLedger([...prerequisites,...batch,...guard.INVOICE_READ_SCOPE_MIGRATIONS,...guard.HR_BRIDGE_MIGRATIONS]);assert.equal(guard.classifyLedger(ledger,migrationDir,'frontend_compat','none',baseline),'compat');check();
 for(const p of [phase,'frontend_compat']){const file=output('recovery');guard.preparePhaseQuery(path.join(dir,posts[0]),file,p,p===phase?versions:'none');const raw=fs.readFileSync(file,'utf8');assert.match(raw,/^begin read only;/);assert.equal((raw.match(/-- Reviewed reports postflight:/g)||[]).length,p===phase?19:21);assert.equal(raw.includes('finance_invoice_select_initplan_postflight.sql'),p==='frontend_compat');assert.doesNotMatch(raw,/insert into supabase_migrations|create or replace function/);await db.exec(raw);assert.equal(await fp(),applied);check();}
 const marker='approval_history_summary_canary_result',result={canary:'readonly_approval_history_summary_v1',ok:true,rolled_back:true,participant_scope_preserved:true},json=write('marker.json','[]');
 for(const payload of [[{[marker]:result}],{rows:[{[marker]:JSON.stringify(result)}]},{results:[{rows:[{[marker]:result}]}]}]){fs.writeFileSync(json,JSON.stringify(payload));assert.equal(guard.verifyReportsCanary(json,'approval_history_summary'),true);check();}
 for(const payload of [[],[{[marker]:result},{[marker]:result}],...Object.keys(result).flatMap(k=>[{[marker]:{...result,[k]:false}},{[marker]:Object.fromEntries(Object.entries(result).filter(([key])=>key!==k))}]),{[marker]:{...result,extra:true}}]){fs.writeFileSync(json,JSON.stringify(payload));assert.throws(()=>guard.verifyReportsCanary(json,'approval_history_summary'));check();}
 fs.writeFileSync(json,JSON.stringify([{[marker]:result}]));assert.equal(spawnSync(process.execPath,[path.join(repo,'scripts/finance_production_release_guard.js'),'verify-reports-canary','--domain','approval_history_summary','--input',json]).status,0);fs.writeFileSync(json,'[]');assert.notEqual(spawnSync(process.execPath,[path.join(repo,'scripts/finance_production_release_guard.js'),'verify-reports-canary','--domain','approval_history_summary','--input',json]).status,0);check();
 // The operational migration, inherited/new postflights and read-only
 // canaries are rendered from sealed files without stripping SQL statements.
 writeLedger(prerequisites);
 const actualDir=path.join(repo,'supabase/migrations'),scripts=path.join(repo,'scripts');
 const actualOutput=output('actual-rehearsal');
 guard.prepareHistorySummaryRehearsal(actualDir,actualOutput,versions,ledger,path.join(scripts,'finance_approval_history_summary_fingerprint.sql'),...['finance_dashboard_scope_canary.sql','finance_google_projection_canary.sql','finance_approval_search_canary.sql','finance_approval_history_summary_canary.sql'].map(name=>path.join(scripts,name)),path.join(scripts,posts[5]),path.join(scripts,posts[6]),baseline);
 const actual=fs.readFileSync(actualOutput,'utf8');
 for(const version of batch){const file=guard.migrationFiles(actualDir).find(name=>name.startsWith(version+'_'));assert.ok(actual.includes(fs.readFileSync(path.join(actualDir,file),'utf8').trimEnd()),'full migration text survives sealed renderer');check();}
 for(const name of posts){assert.ok(actual.includes(fs.readFileSync(path.join(scripts,name),'utf8').replace(/^\\set ON_ERROR_STOP on\n/,'').replace(/:'migration_versions'/g,"'20260827052447'").trimEnd()),'full postflight text survives renderer: '+name);check();}
 const actualApply=output('actual-apply');guard.prepareAuditBatchApply(actualDir,actualApply,versions,ledger,path.join(scripts,posts[5]),baseline,phase,path.join(scripts,posts[6]));
 assert.equal((fs.readFileSync(actualApply,'utf8').match(/^commit;$/gm)||[]).length,1);check();
 console.log(`PASS history summary protected release: ${checks} atomic-state and sealed-source checks`);
}finally{await db.close();fs.rmSync(dir,{recursive:true,force:true});}
