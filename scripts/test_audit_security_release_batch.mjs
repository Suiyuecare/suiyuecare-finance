import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {PGlite} from '@electric-sql/pglite';
import guard from './finance_production_release_guard.js';

// Execute the real protected SQL renderer against isolated PostgreSQL. No remote
// credentials or production business writes; the security semantics have a separate gate.
const repo=fileURLToPath(new URL('..',import.meta.url)),dir=fs.mkdtempSync(path.join(os.tmpdir(),'finance-audit-security-release-'));
const migrationDir=path.join(dir,'migrations');fs.mkdirSync(migrationDir);
const phase=guard.RELEASE_PHASE_DATABASE_AUDIT_SECURITY,batch=guard.AUDIT_SECURITY_MIGRATIONS,versions=batch.join(',');
const prerequisites=['20260820000000',...guard.REVIEWED_MIGRATION_CATALOG.filter(v=>v<batch[0])];
const baseline={count:1,lastVersion:prerequisites[0],sha256:guard.ledgerSha256([prerequisites[0]])};
const write=(name,body)=>{const file=path.join(dir,name);fs.writeFileSync(file,body);return file;};
const ledger=write('ledger.txt',''),writeLedger=rows=>fs.writeFileSync(ledger,rows.join('\n')+'\n');
const source=`alter policy attachment_scope_release_policy on storage.objects using ((select public.audit_security_release_actor()));
create table private.finance_legacy_attachment_links_v1(id integer primary key,summary text);
insert into private.finance_legacy_attachment_links_v1 values(1,'scoped');
alter table private.finance_legacy_attachment_links_v1 enable row level security;
revoke all on table private.finance_legacy_attachment_links_v1 from public;
create schema finance_attachment_private;
revoke all on schema finance_attachment_private from public;
create function finance_attachment_private.parent_links_v1() returns integer language sql stable as $$select 1$$;
revoke all on function finance_attachment_private.parent_links_v1() from public;
create index legacy_links_release_idx on private.finance_legacy_attachment_links_v1 (id) where id>0;
create or replace function public.audit_security_release_probe() returns integer language sql as $$select 1$$;
`;
for(const v of guard.REVIEWED_MIGRATION_CATALOG)write('migrations/'+v+'_fixture.sql',batch.includes(v)?source:'select 1;');
const posts=guard.REPORT_POSTFLIGHT_FILES.concat('finance_amount_search_postflight.sql',guard.REPORTING_INTEGRITY_POSTFLIGHT_FILES,guard.AUDIT_READINESS_POSTFLIGHT_FILES,guard.EMPLOYEE_RELIABILITY_POSTFLIGHT_FILES,guard.HISTORY_PERFORMANCE_POSTFLIGHT_FILES,guard.READ_LATENCY_POSTFLIGHT_FILES,guard.AR_MAPPING_POSTFLIGHT_FILES,guard.AUDIT_REMEDIATION_POSTFLIGHT_FILES,guard.APPROVAL_SEARCH_POSTFLIGHT_FILES,guard.HISTORY_SUMMARY_POSTFLIGHT_FILES,guard.INVOICE_READ_SCOPE_POSTFLIGHT_FILES,guard.AR_READ_SCOPE_POSTFLIGHT_FILES,guard.HR_BRIDGE_POSTFLIGHT_FILES,guard.AUDIT_SECURITY_POSTFLIGHT_FILES);
assert.equal(posts.length,24);
const postSources=posts.map((name,i)=>`\\set ON_ERROR_STOP on\n${i===0?"select set_config('finance.release_migration_versions', :'migration_versions', true);\n":''}do $post_${i}$ begin if public.audit_security_release_probe()<>1 then raise exception 'postflight before migration';end if;end;$post_${i}$;\n`);
posts.forEach((name,i)=>write(name,postSources[i]));
const arPost=path.join(dir,posts[5]),profilePost=path.join(dir,posts[6]);
const fingerprint=path.join(repo,'scripts/finance_audit_security_fingerprint.sql'),fpSql=fs.readFileSync(fingerprint,'utf8').replace(/^\\set ON_ERROR_STOP on\n/,'');
const labels=['dashboard','google','search','summary','invoice','ar','security'];
const canaries=labels.map(name=>write(name+'.sql',`-- Synthetic readonly ${name} contract
begin isolation level repeatable read read only;
-- FINANCE_AUTHENTICATED_CANARY_CORE_BEGIN
do $${name}_core$ begin if public.audit_security_release_probe()<>1 or not exists(select 1 from private.finance_legacy_attachment_links_v1 where id=1) then raise exception 'canary before migration';end if;end;$${name}_core$;
-- FINANCE_AUTHENTICATED_CANARY_CORE_END
rollback;
-- FINANCE_AUTHENTICATED_CANARY_ROLLBACK_CHECK_BEGIN
do $${name}_rollback$ begin if public.audit_security_release_probe()<>0 or to_regclass('private.finance_legacy_attachment_links_v1') is not null then raise exception 'projection survived rehearsal';end if;end;$${name}_rollback$;
-- FINANCE_AUTHENTICATED_CANARY_ROLLBACK_CHECK_END
`));
let serial=0,checks=0;const check=()=>checks++,output=label=>path.join(dir,`${serial++}-${label}.sql`);
const rehearsal=(paths=canaries)=>{const file=output('rehearsal');guard.prepareAuditSecurityRehearsal(migrationDir,file,versions,ledger,fingerprint,...paths,arPost,profilePost,baseline);return fs.readFileSync(file,'utf8');};
const apply=()=>{const file=output('apply');guard.prepareAuditBatchApply(migrationDir,file,versions,ledger,arPost,baseline,phase,profilePost);return fs.readFileSync(file,'utf8');};
const migrationFile=path.join(migrationDir,batch[0]+'_fixture.sql');
assert.equal(versions,'20260922133752');check();
for(const v of ['none','20260922075604','20260922072737',versions+',20260923000000']){assert.throws(()=>guard.releasePlan(phase,v));check();}
for(let prefix=0;prefix<=prerequisites.length;prefix++){
 writeLedger(prerequisites.slice(0,prefix));
 if(prefix===prerequisites.length){assert.equal(guard.classifyLedger(ledger,migrationDir,phase,versions,baseline),'pending');assert.deepEqual(guard.pendingAuditSecurityBatch(migrationDir,versions,ledger,baseline).map(x=>x.version),batch);}
 else{assert.throws(()=>rehearsal());assert.throws(()=>apply());}check();
}
for(const missing of prerequisites){writeLedger([...prerequisites.filter(v=>v!==missing),...batch]);assert.throws(()=>rehearsal());assert.throws(()=>apply());check();}
for(const rows of [[...prerequisites,'20260923000000'],[...prerequisites,...batch,'20260923000000'],[...prerequisites,batch[0],batch[0]],[...prerequisites].reverse()]){writeLedger(rows);assert.throws(()=>rehearsal());assert.throws(()=>apply());check();}
writeLedger(prerequisites);assert.throws(()=>guard.classifyLedger(ledger,migrationDir,'frontend_compat','none',baseline),/audit security migration batch/);check();
fs.unlinkSync(migrationFile);assert.throws(()=>apply(),/migration file is missing/);fs.writeFileSync(migrationFile,source+'\ncommit;');assert.throws(()=>apply(),/transaction control/);fs.writeFileSync(migrationFile,source);check();
for(let slot=0;slot<7;slot++){const paths=canaries.slice();paths[slot]=null;assert.throws(()=>rehearsal(paths));check();}
const good=fs.readFileSync(canaries[6],'utf8');
for(const bad of [good.replace('read read only','read'),good.replace('rollback;','commit;'),'\\set ON_ERROR_STOP on\n'+good,good.replace('begin if',"begin perform set_config('request.jwt.claim.sub','fake',true); if"),good.replace('begin if','begin insert into storage.objects values(1); if'),good+'\n-- FINANCE_AUTHENTICATED_CANARY_CORE_BEGIN']){const file=write('unsafe.sql',bad);assert.throws(()=>rehearsal([...canaries.slice(0,6),file]));check();}
const db=new PGlite();
try{
 await db.exec('create schema private;create schema auth;create schema net;create schema storage;create schema supabase_migrations;create role authenticated;create table supabase_migrations.schema_migrations(version text primary key,statements text[],name text,created_by text);');
 for(const table of new Set([...fpSql.matchAll(/from ((?:public|private|auth)\.[a-z_0-9]+) r/g)].map(m=>m[1])))await db.exec(`create table ${table}(id integer);`);
 await db.exec('create table public.file_attachments(id integer);create table storage.objects(id integer);alter table storage.objects enable row level security;create function public.audit_security_release_actor() returns boolean language sql stable as $$select true$$;create policy attachment_scope_release_policy on storage.objects for select to authenticated using(public.audit_security_release_actor());create function public.audit_security_release_probe() returns integer language sql as $$select 0$$;insert into public.application_accounting_lines values(1);');
 for(const v of prerequisites)await db.query('insert into supabase_migrations.schema_migrations(version) values($1)',[v]);
 const fp=async()=>(await db.query(fpSql)).rows[0].fingerprint,original=await fp();
 for(const sql of ['alter policy attachment_scope_release_policy on storage.objects using ((select public.audit_security_release_actor()))','grant select on storage.objects to authenticated','insert into storage.objects values(7)','insert into public.file_attachments values(7)']){await db.exec('begin;'+sql);assert.notEqual(await fp(),original,'storage policies, privileges and metadata participate in rollback fingerprint');await db.exec('rollback');assert.equal(await fp(),original);check();}
 const sql=rehearsal();assert.equal((sql.match(/^rollback;$/gm)||[]).length,1);assert.equal((sql.match(/insert into supabase_migrations.schema_migrations\(version/g)||[]).length,1);assert.match(sql,/pg_advisory_xact_lock[\s\S]+lock table supabase_migrations/);
 for(const name of posts){const at=sql.indexOf('-- Reviewed reports postflight: '+name);assert.ok(at>sql.indexOf(source.trimEnd())&&at<sql.indexOf('$dashboard_core$'));}
 await db.exec(sql);assert.equal(await fp(),original);check();
 const preOut=output('prerequisites');guard.prepareAuditSecurityPrerequisiteQuery(path.join(dir,posts[0]),preOut,migrationDir,versions,ledger,baseline);const prior=fs.readFileSync(preOut,'utf8');assert.equal((prior.match(/-- Reviewed reports postflight:/g)||[]).length,23);assert.ok(prior.includes('finance_hr_bridge_postflight.sql'));assert.ok(prior.includes('finance_hr_directory_export_postflight.sql'));assert.ok(!prior.includes('finance_audit_security_postflight.sql'));check();
 fs.writeFileSync(migrationFile,source+"do $fail$ begin raise exception 'intentional migration failure';end;$fail$;\n");
 for(const mode of [rehearsal,apply]){await assert.rejects(()=>db.exec(mode()),/intentional migration failure/);await db.exec('rollback');assert.equal(await fp(),original);check();}fs.writeFileSync(migrationFile,source);
 for(let i=0;i<posts.length;i++){
  write(posts[i],postSources[i]+"do $fail$ begin raise exception 'intentional postflight failure';end;$fail$;\n");
  for(const mode of [rehearsal,apply]){await assert.rejects(()=>db.exec(mode()),/intentional postflight failure/);await db.exec('rollback');assert.equal(await fp(),original);check();}
  fs.unlinkSync(path.join(dir,posts[i]));assert.throws(()=>apply(),/ENOENT/);write(posts[i],postSources[i]);check();
 }
 for(let slot=0;slot<7;slot++)for(const section of ['core','rollback']){
  const label=labels[slot],bad=write('fail-canary.sql',fs.readFileSync(canaries[slot],'utf8').replace(`end;$${label}_${section}$;`,`raise exception 'intentional ${section} failure';end;$${label}_${section}$;`)),paths=canaries.slice();paths[slot]=bad;
  await assert.rejects(()=>db.exec(rehearsal(paths)),/intentional .* failure/);await db.exec('rollback');assert.equal(await fp(),original);check();
 }
 const atomic=apply(),stale=rehearsal();assert.equal((atomic.match(/^commit;$/gm)||[]).length,1);
 await db.query('insert into supabase_migrations.schema_migrations(version) values($1)',['20260923000000']);
 for(const raw of [atomic,stale]){await assert.rejects(()=>db.exec(raw),/ledger changed/);await db.exec('rollback');check();}
 await db.query('delete from supabase_migrations.schema_migrations where version=$1',['20260923000000']);assert.equal(await fp(),original);
 await db.exec(atomic);const applied=await fp();assert.notEqual(applied,original);await db.exec("begin;update private.finance_legacy_attachment_links_v1 set summary='changed' where id=1;");assert.notEqual(await fp(),applied,'immutable legacy link contents are fingerprinted, not only schema');await db.exec('rollback');assert.equal(await fp(),applied);check();assert.deepEqual((await db.query('select statements from supabase_migrations.schema_migrations where version=$1',[batch[0]])).rows[0].statements,[source.trimEnd()]);check();
 for(const mutation of ["grant usage on schema finance_attachment_private to authenticated","grant execute on function finance_attachment_private.parent_links_v1() to authenticated","create or replace function finance_attachment_private.parent_links_v1() returns integer language sql stable as $$select 2$$","drop index private.legacy_links_release_idx;create index legacy_links_release_idx on private.finance_legacy_attachment_links_v1(id) where id>=0","drop index private.legacy_links_release_idx;create index legacy_links_release_idx on private.finance_legacy_attachment_links_v1((id+1)) where id>0"]){await db.exec('begin;'+mutation);assert.notEqual(await fp(),applied,'schema ACL, helper definition/ACL and same-name index predicate/expression changes must change fingerprint');await db.exec('rollback');assert.equal(await fp(),applied);check();}
 await assert.rejects(()=>db.exec(atomic),/ledger changed/);await db.exec('rollback');assert.equal(await fp(),applied);check();
 writeLedger([...prerequisites,...batch,...guard.HR_DIRECTORY_EXPORT_MIGRATIONS]);assert.equal(guard.classifyLedger(ledger,migrationDir,phase,versions,baseline),'applied');assert.equal(guard.classifyLedger(ledger,migrationDir,'frontend_compat','none',baseline),'compat');assert.throws(()=>rehearsal(),/pending/);assert.throws(()=>apply(),/pending/);check();
 for(const p of [phase,'frontend_compat']){const file=output('recovery');guard.preparePhaseQuery(path.join(dir,posts[0]),file,p,p===phase?versions:'none');const raw=fs.readFileSync(file,'utf8');assert.match(raw,/^begin read only;/);assert.equal((raw.match(/-- Reviewed reports postflight:/g)||[]).length,24);assert.doesNotMatch(raw,/insert into supabase_migrations|create or replace function/);await db.exec(raw);assert.equal(await fp(),applied);check();}
 const marker='audit_security_canary_result',result={canary:'readonly_audit_security_v1',ok:true,rolled_back:true,identity_scope_preserved:true,attachment_scope_preserved:true},json=write('marker.json','[]');
 for(const payload of [[{[marker]:result}],{rows:[{[marker]:JSON.stringify(result)}]},{results:[{rows:[{[marker]:result}]}]}]){fs.writeFileSync(json,JSON.stringify(payload));assert.equal(guard.verifyReportsCanary(json,'audit_security'),true);check();}
 for(const payload of [[],[{[marker]:result},{[marker]:result}],...Object.keys(result).flatMap(k=>[{[marker]:{...result,[k]:false}},{[marker]:Object.fromEntries(Object.entries(result).filter(([key])=>key!==k))}]),{[marker]:{...result,extra:true}}]){fs.writeFileSync(json,JSON.stringify(payload));assert.throws(()=>guard.verifyReportsCanary(json,'audit_security'));check();}
 fs.writeFileSync(json,JSON.stringify([{[marker]:result}]));assert.equal(spawnSync(process.execPath,[path.join(repo,'scripts/finance_production_release_guard.js'),'verify-reports-canary','--domain','audit_security','--input',json]).status,0);fs.writeFileSync(json,'[]');assert.notEqual(spawnSync(process.execPath,[path.join(repo,'scripts/finance_production_release_guard.js'),'verify-reports-canary','--domain','audit_security','--input',json]).status,0);check();
 // Every sealed migration/postflight and all seven marked canary proof blocks survive rendering.
 writeLedger(prerequisites);const actualDir=path.join(repo,'supabase/migrations'),scripts=path.join(repo,'scripts'),actualOut=output('actual-rehearsal');
 guard.prepareAuditSecurityRehearsal(actualDir,actualOut,versions,ledger,fingerprint,...['finance_dashboard_scope_canary.sql','finance_google_projection_canary.sql','finance_approval_search_canary.sql','finance_approval_history_summary_canary.sql','finance_invoice_select_initplan_canary.sql','finance_ar_verified_accounting_scope_canary.sql','finance_audit_security_canary.sql'].map(name=>path.join(scripts,name)),path.join(scripts,posts[5]),path.join(scripts,posts[6]),baseline);
 const actual=fs.readFileSync(actualOut,'utf8');
 for(const name of ['finance_dashboard_scope_canary.sql','finance_google_projection_canary.sql','finance_approval_search_canary.sql','finance_approval_history_summary_canary.sql','finance_invoice_select_initplan_canary.sql','finance_ar_verified_accounting_scope_canary.sql','finance_audit_security_canary.sql']){const raw=fs.readFileSync(path.join(scripts,name),'utf8');for(const part of ['CORE','ROLLBACK_CHECK']){const start='-- FINANCE_AUTHENTICATED_CANARY_'+part+'_BEGIN',end='-- FINANCE_AUTHENTICATED_CANARY_'+part+'_END',proof=raw.slice(raw.indexOf(start)+start.length,raw.indexOf(end)).trim();assert.ok(actual.includes(proof),name+' '+part+' proof is preserved verbatim');check();}}
 for(const version of batch){const file=guard.migrationFiles(actualDir).find(name=>name.startsWith(version+'_'));assert.ok(actual.includes(fs.readFileSync(path.join(actualDir,file),'utf8').trimEnd()));check();}
 for(const name of posts){assert.ok(actual.includes(fs.readFileSync(path.join(scripts,name),'utf8').replace(/^\\set ON_ERROR_STOP on\n/,'').replace(/:'migration_versions'/g,"'20260827052447'").trimEnd()),name);check();}
 const actualApply=output('actual-apply');guard.prepareAuditBatchApply(actualDir,actualApply,versions,ledger,path.join(scripts,posts[5]),baseline,phase,path.join(scripts,posts[6]));assert.equal((fs.readFileSync(actualApply,'utf8').match(/^commit;$/gm)||[]).length,1);check();
 console.log(`PASS audit security protected release: ${checks} atomic-state and sealed-source checks`);
}finally{await db.close();fs.rmSync(dir,{recursive:true,force:true});}
