import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {PGlite} from '@electric-sql/pglite';
import guard from './finance_production_release_guard.js';

// Local anonymous PostgreSQL only. Exercise the actual release renderer against
// each supported installed suffix; no claims or production connections are used.
const repo=fileURLToPath(new URL('..',import.meta.url));
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'finance-approval-search-release-'));
const migrationDir=path.join(dir,'migrations');fs.mkdirSync(migrationDir);
const phase=guard.RELEASE_PHASE_DATABASE_APPROVAL_SEARCH,batch=guard.APPROVAL_SEARCH_BATCH,versions=batch.join(',');
const prerequisites=['20260820000000',...guard.REVIEWED_MIGRATION_CATALOG.filter(v=>v<batch[0])];
const baseline={count:1,lastVersion:prerequisites[0],sha256:guard.ledgerSha256([prerequisites[0]])};
const write=(name,body)=>{const p=path.join(dir,name);fs.writeFileSync(p,body);return p;};
const ledger=write('ledger.txt','');const writeLedger=rows=>fs.writeFileSync(ledger,rows.join('\n')+'\n');
const sources=batch.map((v,i)=>`create or replace function public.approval_search_release_probe_${i}() returns integer language sql as $$select 1$$;\n${i===0?'update public.application_accounting_lines set id=2;':''}`);
for(const v of guard.REVIEWED_MIGRATION_CATALOG)fs.writeFileSync(path.join(migrationDir,v+'_fixture.sql'),batch.includes(v)?sources[batch.indexOf(v)]:'select 1;');
const posts=guard.REPORT_POSTFLIGHT_FILES.concat('finance_amount_search_postflight.sql',guard.REPORTING_INTEGRITY_POSTFLIGHT_FILES,guard.AUDIT_READINESS_POSTFLIGHT_FILES,guard.EMPLOYEE_RELIABILITY_POSTFLIGHT_FILES,guard.HISTORY_PERFORMANCE_POSTFLIGHT_FILES,guard.READ_LATENCY_POSTFLIGHT_FILES,guard.AR_MAPPING_POSTFLIGHT_FILES,guard.AUDIT_REMEDIATION_POSTFLIGHT_FILES,guard.APPROVAL_SEARCH_POSTFLIGHT_FILES);
assert.equal(posts.length,18);
const postSources=posts.map((name,i)=>`\\set ON_ERROR_STOP on\n${i===0?"select set_config('finance.release_migration_versions', :'migration_versions', true);\n":''}do $post_${i}$ begin if public.approval_search_release_probe_2()<>1 then raise exception 'postflight before final migration';end if;end;$post_${i}$;\n`);
posts.forEach((name,i)=>write(name,postSources[i]));
const arPost=path.join(dir,posts[5]),profilePost=path.join(dir,posts[6]);
const fingerprint=path.join(repo,'scripts/finance_statement_source_fingerprint.sql');
const fpSql=fs.readFileSync(fingerprint,'utf8').replace(/^\\set ON_ERROR_STOP on\n/,'');
const canaries=['dashboard','google','search'].map(name=>write(name+'.sql',`-- Synthetic read-only ${name} proof
begin isolation level repeatable read read only;
-- FINANCE_AUTHENTICATED_CANARY_CORE_BEGIN
do $${name}_core$ begin if public.approval_search_release_probe_2()<>1 then raise exception 'canary before final migration';end if;end;$${name}_core$;
-- FINANCE_AUTHENTICATED_CANARY_CORE_END
rollback;
-- FINANCE_AUTHENTICATED_CANARY_ROLLBACK_CHECK_BEGIN
do $${name}_rollback$ begin if public.approval_search_release_probe_2()<>0 then raise exception 'search DDL survived rehearsal';end if;end;$${name}_rollback$;
-- FINANCE_AUTHENTICATED_CANARY_ROLLBACK_CHECK_END
`));
let serial=0,checks=0;const check=()=>checks++;
const output=label=>path.join(dir,`${serial++}-${label}.sql`);
const rehearsal=(paths=canaries)=>{const p=output('rehearsal');guard.prepareApprovalSearchRehearsal(migrationDir,p,versions,ledger,fingerprint,...paths,arPost,profilePost,baseline);return fs.readFileSync(p,'utf8');};
const apply=()=>{const p=output('apply');guard.prepareAuditBatchApply(migrationDir,p,versions,ledger,arPost,baseline,phase,profilePost);return fs.readFileSync(p,'utf8');};
assert.equal(versions,'20260914001246,20260914001252,20260914091205');check();
for(const input of ['none',batch.slice(0,2).join(','),batch.slice(2).join(','),batch.slice().reverse().join(','),versions+',20260914091206']){assert.throws(()=>guard.releasePlan(phase,input));check();}
for(const suffix of [[],batch.slice(0,2),batch]){writeLedger([...prerequisites,...suffix]);assert.equal(guard.classifyLedger(ledger,migrationDir,phase,versions,baseline),suffix.length===3?'applied':'pending');if(suffix.length<3){assert.deepEqual(guard.pendingApprovalSearchBatch(migrationDir,versions,ledger,baseline).map(x=>x.version),batch.slice(suffix.length));assert.throws(()=>guard.classifyLedger(ledger,migrationDir,'frontend_compat','none',baseline));}else{assert.throws(()=>guard.classifyLedger(ledger,migrationDir,'frontend_compat','none',baseline),/history summary migration batch/);assert.throws(()=>rehearsal(),/pending/);assert.throws(()=>apply(),/pending/);}check();}
for(const suffix of [[batch[0]],[batch[1]],[batch[2]],[batch[0],batch[2]],[batch[1],batch[2]]]){writeLedger([...prerequisites,...suffix]);assert.throws(()=>rehearsal(),/partially installed|without its complete/);assert.throws(()=>apply(),/partially installed|without its complete/);check();}
for(const v of prerequisites.slice(1)){writeLedger(prerequisites.filter(x=>x!==v));assert.throws(()=>rehearsal(),/every reviewed prerequisite/);check();}
writeLedger([...prerequisites,'20260914091206']);assert.throws(()=>apply(),/unreviewed/);writeLedger(prerequisites);check();
for(let slot=0;slot<3;slot++){const paths=canaries.slice();paths[slot]=null;assert.throws(()=>rehearsal(paths));check();}
const good=fs.readFileSync(canaries[2],'utf8');
for(const bad of [good.replace('read read only','read'),good.replace('rollback;','commit;'),'\\set ON_ERROR_STOP on\n'+good,good.replace('begin if','begin perform set_config(\'request.jwt.claim.sub\',\'fake\',true); if'),good.replace('begin if','begin insert into public.invoices values(1); if'),good+'\n-- FINANCE_AUTHENTICATED_CANARY_CORE_BEGIN']){const p=write('unsafe.sql',bad);assert.throws(()=>rehearsal([canaries[0],canaries[1],p]));check();}
for(let i=0;i<3;i++){const p=path.join(migrationDir,batch[i]+'_fixture.sql'),raw=fs.readFileSync(p,'utf8');fs.unlinkSync(p);assert.throws(()=>apply(),/migration file is missing/);fs.writeFileSync(p,raw+'\ncommit;');assert.throws(()=>apply(),/transaction control/);fs.writeFileSync(p,raw);check();}

async function setup(db,suffix){
 await db.exec('create schema private;create schema auth;create schema net;create schema supabase_migrations;create role authenticated;create table supabase_migrations.schema_migrations(version text primary key,statements text[],name text,created_by text);');
 for(const table of new Set([...fpSql.matchAll(/from ((?:public|private|auth)\.[a-z_0-9]+) r/g)].map(m=>m[1])))await db.exec(`create table ${table}(id integer);`);
 for(let i=0;i<3;i++)await db.exec(`create function public.approval_search_release_probe_${i}() returns integer language sql as $$select 0$$;`);
 await db.exec('insert into public.application_accounting_lines values(1);');
 for(const v of [...prerequisites,...suffix])await db.query('insert into supabase_migrations.schema_migrations(version) values($1)',[v]);
 for(const v of suffix)await db.exec(sources[batch.indexOf(v)]);
 writeLedger([...prerequisites,...suffix]);
}
try{
 for(const suffix of [[],batch.slice(0,2)]){
  const db=new PGlite();
  try{
   await setup(db,suffix);const fp=async()=>(await db.query(fpSql)).rows[0].fingerprint,original=await fp();
   await db.exec('begin;create function private.approval_search_fingerprint_probe(text) returns text language sql as $$select $1$$;');
   const helperCreated=await fp();assert.notEqual(helperCreated,original,'new private helper definition is fingerprinted');
   await db.exec('revoke all on function private.approval_search_fingerprint_probe(text) from public;');
   const helperAcl=await fp();assert.notEqual(helperAcl,helperCreated,'private helper ACL is fingerprinted');
   await db.exec('create or replace function private.approval_search_fingerprint_probe(text) returns text language sql as $$select lower($1)$$;');assert.notEqual(await fp(),helperAcl,'replacement normalization body is fingerprinted');
   await db.exec('rollback');assert.equal(await fp(),original);check();
   const sql=rehearsal();assert.equal((sql.match(/^rollback;$/gm)||[]).length,1);assert.match(sql,/pg_advisory_xact_lock[\s\S]+lock table supabase_migrations/);
   for(const [i,source] of sources.entries())assert.equal(sql.includes(source),i>=suffix.length,'only missing suffix is rehearsed');
   for(const name of posts){const at=sql.indexOf('-- Reviewed reports postflight: '+name);assert.ok(at>sql.indexOf(sources[2])&&at<sql.indexOf('$dashboard_core$'));}
   for(const name of ['dashboard','google','search'])assert.ok(sql.indexOf(`$${name}_core$`)<sql.indexOf('rollback to savepoint')&&sql.indexOf(`$${name}_rollback$`)>sql.indexOf('rollback to savepoint'));
   await db.exec(sql);assert.equal(await fp(),original,'rehearsal restores all functions, ledger and business data');check();
   // The previous phase is selected from the ledger, never guessed from an input flag.
   const pp=output('prerequisite');guard.prepareApprovalSearchPrerequisiteQuery(path.join(dir,posts[0]),pp,migrationDir,versions,ledger,baseline);const prior=fs.readFileSync(pp,'utf8');assert.equal((prior.match(/-- Reviewed reports postflight:/g)||[]).length,suffix.length===2?17:15);assert.ok(!prior.includes('finance_approval_search_postflight.sql'));check();
   for(let i=suffix.length;i<3;i++){
    const p=path.join(migrationDir,batch[i]+'_fixture.sql');fs.writeFileSync(p,sources[i]+"\ndo $ddl_fail$ begin raise exception 'intentional DDL failure';end;$ddl_fail$;");
    for(const mode of [rehearsal,apply]){await assert.rejects(()=>db.exec(mode()),/intentional DDL failure/);await db.exec('rollback');assert.equal(await fp(),original);check();}
    fs.writeFileSync(p,sources[i]);
   }
   for(let i=0;i<posts.length;i++){
    write(posts[i],postSources[i]+"do $post_fail$ begin raise exception 'intentional postflight failure';end;$post_fail$;\n");
    for(const mode of [rehearsal,apply]){await assert.rejects(()=>db.exec(mode()),/intentional postflight failure/);await db.exec('rollback');assert.equal(await fp(),original,'failed postflight rolls back complete pending suffix and ledger');check();}
    write(posts[i],postSources[i]);fs.unlinkSync(path.join(dir,posts[i]));assert.throws(()=>apply(),/ENOENT/);write(posts[i],postSources[i]);check();
   }
   for(let slot=0;slot<3;slot++)for(const section of ['core','rollback']){
    const bad=write('fail-canary.sql',fs.readFileSync(canaries[slot],'utf8').replace(`end;$${['dashboard','google','search'][slot]}_${section}$;`,`raise exception 'intentional ${section} failure';end;$${['dashboard','google','search'][slot]}_${section}$;`));const paths=canaries.slice();paths[slot]=bad;
    await assert.rejects(()=>db.exec(rehearsal(paths)),/intentional .* failure/);await db.exec('rollback');assert.equal(await fp(),original);check();
   }
   const atomic=apply();assert.equal((atomic.match(/^commit;$/gm)||[]).length,1);assert.equal((atomic.match(/insert into supabase_migrations.schema_migrations\(version/g)||[]).length,3-suffix.length);
   const staleRehearsal=rehearsal();await db.query('insert into supabase_migrations.schema_migrations(version) values($1)',['20260914091206']);
   for(const raw of [atomic,staleRehearsal]){await assert.rejects(()=>db.exec(raw),/ledger changed/);await db.exec('rollback');check();}await db.query('delete from supabase_migrations.schema_migrations where version=$1',['20260914091206']);assert.equal(await fp(),original);
   await db.exec(atomic);const applied=await fp();assert.notEqual(applied,original);
   for(const v of batch.slice(suffix.length)){assert.deepEqual((await db.query('select statements from supabase_migrations.schema_migrations where version=$1',[v])).rows[0].statements,[sources[batch.indexOf(v)].trimEnd()]);check();}
   assert.equal((await db.query('select count(*)::int count from supabase_migrations.schema_migrations where version=any($1)',[batch])).rows[0].count,3);
   await assert.rejects(()=>db.exec(atomic),/ledger changed/);await db.exec('rollback');assert.equal(await fp(),applied);writeLedger([...prerequisites,...batch]);assert.throws(()=>apply(),/pending/);assert.throws(()=>rehearsal(),/pending/);check();
   for(const p of [phase]){const file=output('recovery');guard.preparePhaseQuery(path.join(dir,posts[0]),file,p,p===phase?versions:'none');const raw=fs.readFileSync(file,'utf8');assert.match(raw,/^begin read only;/);assert.equal((raw.match(/-- Reviewed reports postflight:/g)||[]).length,18);assert.doesNotMatch(raw,/insert into supabase_migrations|create or replace function/);await db.exec(raw);assert.equal(await fp(),applied);check();}
  }finally{await db.close();}
 }
 const marker='approval_search_canary_result',result={canary:'readonly_approval_search_v1',ok:true,rolled_back:true,participant_scope_preserved:true},json=write('marker.json','[]');
 for(const payload of [[{[marker]:result}],{rows:[{[marker]:JSON.stringify(result)}]},{results:[{rows:[{[marker]:result}]}]}]){fs.writeFileSync(json,JSON.stringify(payload));assert.equal(guard.verifyReportsCanary(json,'approval_search'),true);check();}
 for(const payload of [[],[{[marker]:result},{[marker]:result}],...Object.keys(result).flatMap(k=>[{[marker]:{...result,[k]:false}},{[marker]:Object.fromEntries(Object.entries(result).filter(([key])=>key!==k))}]),{[marker]:{...result,extra:true}}]){fs.writeFileSync(json,JSON.stringify(payload));assert.throws(()=>guard.verifyReportsCanary(json,'approval_search'));check();}
 for(const raw of ['{','null','[',JSON.stringify({[marker]:'invalid json'})]){fs.writeFileSync(json,raw);assert.throws(()=>guard.verifyReportsCanary(json,'approval_search'));check();}
 fs.writeFileSync(json,JSON.stringify([{[marker]:result}]));assert.equal(spawnSync(process.execPath,[path.join(repo,'scripts/finance_production_release_guard.js'),'verify-reports-canary','--domain','approval_search','--input',json]).status,0);fs.writeFileSync(json,'[]');assert.notEqual(spawnSync(process.execPath,[path.join(repo,'scripts/finance_production_release_guard.js'),'verify-reports-canary','--domain','approval_search','--input',json]).status,0);check();
 console.log(`PASS approval search synthetic release states: ${checks} checks`);
 // All actual SQL is rendered byte-for-byte (except the one reviewed psql directive).
 writeLedger(prerequisites);const actual=output('actual');guard.prepareApprovalSearchRehearsal(path.join(repo,'supabase/migrations'),actual,versions,ledger,fingerprint,...['finance_dashboard_scope_canary.sql','finance_google_projection_canary.sql','finance_approval_search_canary.sql'].map(n=>path.join(repo,'scripts',n)),path.join(repo,'scripts',posts[5]),path.join(repo,'scripts',posts[6]),baseline);const raw=fs.readFileSync(actual,'utf8');
 for(const v of batch){const file=guard.migrationFiles(path.join(repo,'supabase/migrations')).find(x=>x.startsWith(v+'_'));assert.ok(raw.includes(fs.readFileSync(path.join(repo,'supabase/migrations',file),'utf8').trimEnd()));check();}
 for(const n of posts){assert.ok(raw.includes(fs.readFileSync(path.join(repo,'scripts',n),'utf8').replace(/^\\set ON_ERROR_STOP on\n/,'').replace(/:'migration_versions'/g,"'20260827052447'").trimEnd()),n);check();}
 // Compose actual prior dashboard, Google and history definitions over the
 // canonical accounting fixture. Execute all three real migrations/canaries
 // together as well as the legitimate search-only suffix.
 const {createApprovalSearchFixture}=await import('./check_approval_search_projection.cjs');
 const {createDashboardScopeFixture}=await import('./check_dashboard_scope_integrity.cjs');
 const {createGoogleProjectionFixture}=await import('./check_google_projection_identity.cjs');
 for(const installedSuffix of [[],batch.slice(0,2)]){
 const real=new PGlite(),googleCatalog=new PGlite(),searchCatalog=new PGlite(),realDir=path.join(dir,'actual-search-'+installedSuffix.length);fs.mkdirSync(realDir);
 try{
  const f=await createDashboardScopeFixture(real,{install:false});
  await createGoogleProjectionFixture(googleCatalog,{install:false});
  await createApprovalSearchFixture(searchCatalog,{install:false});
  for(const catalog of [googleCatalog,searchCatalog]){
   const columns=(await catalog.query("select table_schema,table_name,column_name,udt_name from information_schema.columns where table_schema in ('public','auth') order by table_schema,table_name,ordinal_position")).rows;
   for(const c of columns){const table=c.table_schema+'.'+c.table_name;if(!(await real.query('select to_regclass($1) present',[table])).rows[0].present)await real.exec(`create table ${table}()`);await real.exec(`alter table ${table} add column if not exists ${c.column_name} ${c.udt_name}`);}
  }
  const copyFunction=async(catalog,signature,publicRpc=false)=>{await real.exec((await catalog.query('select pg_get_functiondef($1::regprocedure) def',[signature])).rows[0].def);await real.exec(`alter function ${signature} owner to postgres;revoke all on function ${signature} from public,anon,authenticated,service_role;${publicRpc?`grant execute on function ${signature} to authenticated,service_role;`:''}`);};
  for(const signature of ['public.finance_verified_google_email(uuid)','private.finance_google_projection_health_v2(uuid,text)','public.finance_admin_google_account_link_status_v2(text)'])await copyFunction(googleCatalog,signature,signature.startsWith('public.finance_admin_'));
  const historyFunctions=(await searchCatalog.query("select p.oid::regprocedure::text signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname like 'finance_history_%' order by p.oid")).rows;
  for(const row of historyFunctions)await copyFunction(searchCatalog,row.signature);
  await copyFunction(searchCatalog,'public.finance_approval_participant_history_for_current_user(integer,integer,text,text)',true);
  await f.admin(real,"set audit.uid=''");
  await real.exec("create schema if not exists net;create schema supabase_migrations;create table supabase_migrations.schema_migrations(version text primary key,statements text[],name text,created_by text);");
  for(const version of installedSuffix){const filename=guard.migrationFiles(path.join(repo,'supabase/migrations')).find(name=>name.startsWith(version+'_'));await real.exec(fs.readFileSync(path.join(repo,'supabase/migrations',filename),'utf8'));}

  for(const table of new Set([...fpSql.matchAll(/from ((?:public|private|auth)\.[a-z_0-9]+) r/g)].map(m=>m[1])))if(!(await real.query('select to_regclass($1) name',[table])).rows[0].name)await real.exec(`create table ${table}(id integer);`);
  await real.exec("insert into public.expense_requests(id,no,tenant_id,data_environment,amount,description,department_code,form_payload) values('RELEASE-SYNTHETIC-1','RELEASE-SYNTHETIC-1','00000000-0000-0000-0000-000000000001','test',1250,'虛構搜尋驗收','D1','{\"purpose\":\"匿名測試\"}');insert into public.finance_department_units values('00000000-0000-0000-0000-000000000001','D1','虛構照顧課');");
  for(const v of [...prerequisites,...installedSuffix])await real.query('insert into supabase_migrations.schema_migrations(version) values($1)',[v]);
  const realLedger=path.join(realDir,'ledger.txt');fs.writeFileSync(realLedger,[...prerequisites,...installedSuffix].join('\n')+'\n');
  const actualPostNames=[...guard.AUDIT_REMEDIATION_POSTFLIGHT_FILES,'finance_ar_mapping_postflight.sql','finance_ar_reconciliation_postflight.sql','finance_canonical_receivables_postflight.sql','finance_amount_search_postflight.sql','finance_approval_history_postflight.sql','finance_approval_search_postflight.sql'];
  for(const [i,name] of posts.entries())fs.writeFileSync(path.join(realDir,name),actualPostNames.includes(name)?fs.readFileSync(path.join(repo,'scripts',name),'utf8'):`\\set ON_ERROR_STOP on\n${i===0?"select set_config('finance.release_migration_versions', :'migration_versions', true);":"select 1;"}\n`);
  const realCanaries=['finance_dashboard_scope_canary.sql','finance_google_projection_canary.sql','finance_approval_search_canary.sql'].map(name=>path.join(repo,'scripts',name));
  const realAr=path.join(realDir,posts[5]),realProfile=path.join(realDir,posts[6]),realFp=async()=>(await real.query(fpSql)).rows[0].fingerprint;
  const realBefore=await realFp(),realRehearsal=path.join(realDir,'rehearsal.sql');
  guard.prepareApprovalSearchRehearsal(path.join(repo,'supabase/migrations'),realRehearsal,versions,realLedger,fingerprint,...realCanaries,realAr,realProfile,baseline);
  await real.exec(fs.readFileSync(realRehearsal,'utf8'));assert.equal(await realFp(),realBefore,'actual search helpers/RPC/ACL and source rows restored');check();
  const realPost=path.join(realDir,'finance_approval_search_postflight.sql'),goodPost=fs.readFileSync(realPost,'utf8');
  fs.writeFileSync(realPost,goodPost+"\ndo $reject_actual_search$ begin raise exception 'actual search contract rejection';end;$reject_actual_search$;\n");
  const rejected=path.join(realDir,'reject.sql');guard.prepareAuditBatchApply(path.join(repo,'supabase/migrations'),rejected,versions,realLedger,realAr,baseline,phase,realProfile);
  await assert.rejects(()=>real.exec(fs.readFileSync(rejected,'utf8')),/actual search contract rejection/);await real.exec('rollback');assert.equal(await realFp(),realBefore);check();fs.writeFileSync(realPost,goodPost);
  const realApply=path.join(realDir,'apply.sql');guard.prepareAuditBatchApply(path.join(repo,'supabase/migrations'),realApply,versions,realLedger,realAr,baseline,phase,realProfile);
  await real.exec(fs.readFileSync(realApply,'utf8'));const realApplied=await realFp();assert.notEqual(realApplied,realBefore);
  assert.equal((await real.query('select count(*)::int count from supabase_migrations.schema_migrations where version=any($1)',[batch])).rows[0].count,3);check();
  await assert.rejects(()=>real.exec(fs.readFileSync(realApply,'utf8')),/ledger changed/);await real.exec('rollback');assert.equal(await realFp(),realApplied);check();
  const standalone=await real.exec(fs.readFileSync(realCanaries[2],'utf8'));assert.equal(await realFp(),realApplied);const resultFile=path.join(realDir,'canary.json');fs.writeFileSync(resultFile,JSON.stringify(standalone));guard.verifyReportsCanary(resultFile,'approval_search');check();
  fs.writeFileSync(realLedger,[...prerequisites,...batch].join('\n')+'\n');assert.throws(()=>guard.prepareAuditBatchApply(path.join(repo,'supabase/migrations'),path.join(realDir,'repeat.sql'),versions,realLedger,realAr,baseline,phase,realProfile),/pending/);check();
  for(const p of [phase]){const file=path.join(realDir,p+'.sql');guard.preparePhaseQuery(path.join(realDir,posts[0]),file,p,p===phase?versions:'none');await real.exec(fs.readFileSync(file,'utf8'));assert.equal(await realFp(),realApplied);check();}
 }finally{await real.close();await googleCatalog.close();await searchCatalog.close();}
 }
 console.log(`PASS approval search release batch: ${checks} checks (three-version and one-version atomic suffix, 18 postflights, 3 read-only canaries, rollback, stale-ledger rejection, read-only recovery)`);
}catch(error){
 console.error(`FAIL approval search release batch: ${error.code||'ASSERT'} ${error.message}`);
 if(error.where)console.error(String(error.where).slice(0,500));
 process.exitCode=1;
}finally{fs.rmSync(dir,{recursive:true,force:true});}
