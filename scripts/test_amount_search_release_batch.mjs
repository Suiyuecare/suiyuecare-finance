import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {PGlite} from '@electric-sql/pglite';
import guard from './finance_production_release_guard.js';

// The real release renderer executes against anonymous PostgreSQL. The domain
// suite separately executes the actual history RPC, authenticated fixtures and
// canary; no production credentials or business records are used here.
const repo=fileURLToPath(new URL('..',import.meta.url));
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'finance-amount-search-release-'));
const migrationDir=path.join(dir,'migrations');fs.mkdirSync(migrationDir);
const phase=guard.RELEASE_PHASE_DATABASE_AMOUNT_SEARCH,versions=guard.AMOUNT_SEARCH_MIGRATIONS.join(',');
const prerequisites=['20260820000000',...guard.MIGRATION_CHAIN,...guard.REVIEWED_POST_BASELINE_MIGRATIONS,guard.MIGRATION_HUMAN_ACCOUNTING_AUTHORITY,...guard.AUDIT_MIGRATIONS,...guard.CASE_MIGRATIONS,...guard.UTILITY_MIGRATIONS,...guard.REPORT_MIGRATIONS];
const baseline={count:1,lastVersion:prerequisites[0],sha256:guard.ledgerSha256([prerequisites[0]])};
const write=(name,body)=>{const file=path.join(dir,name);fs.writeFileSync(file,body);return file;};
const ledger=write('ledger.txt',prerequisites.join('\n')+'\n'),writeLedger=rows=>fs.writeFileSync(ledger,rows.join('\n')+'\n');
const source='create function public.amount_search_release_probe() returns boolean language sql as $$select true$$;\nupdate public.application_accounting_lines set id=2;';
for(const version of guard.REVIEWED_MIGRATION_CATALOG)fs.writeFileSync(path.join(migrationDir,version+'_fixture.sql'),guard.AMOUNT_SEARCH_MIGRATIONS.includes(version)?source:'select 1;');
const postflights=guard.REPORT_POSTFLIGHT_FILES.concat('finance_amount_search_postflight.sql');
const postSources=postflights.map((name,i)=>`\\set ON_ERROR_STOP on\n${i===0?"select set_config('finance.release_migration_versions', :'migration_versions', true);\n":''}do $post_${i}$ begin if to_regprocedure('public.amount_search_release_probe()') is null or (select id from public.application_accounting_lines)<>2 then raise exception 'postflight must run after migration';end if;end;$post_${i}$;\n`);
postflights.forEach((name,i)=>write(name,postSources[i]));
const arPost=path.join(dir,'finance_canonical_receivables_postflight.sql'),profilePost=path.join(dir,'finance_reporting_profiles_postflight.sql');
const fingerprint=path.join(repo,'scripts/finance_amount_search_fingerprint.sql'),fpSql=fs.readFileSync(fingerprint,'utf8').replace(/^\\set ON_ERROR_STOP on\n/,'');
function canary(name,id,failure=''){
 return write(name+'.sql',`-- Anonymous ${name} authenticated release fixture
begin isolation level repeatable read;
-- FINANCE_AUTHENTICATED_CANARY_CORE_BEGIN
do $${name}_core$ begin
 execute 'set local role authenticated';
 if current_user<>'authenticated' or not public.amount_search_release_probe() then raise exception 'wrong role or missing migration';end if;
 insert into public.approval_step_actor_snapshots values(${id});
 insert into public.invoices values(${id});
 ${failure==='core'?"raise exception 'intentional canary core failure';":''}
 execute 'reset role';
end;$${name}_core$;
-- FINANCE_AUTHENTICATED_CANARY_CORE_END
rollback;
-- FINANCE_AUTHENTICATED_CANARY_ROLLBACK_CHECK_BEGIN
do $${name}_rollback$ begin
 if exists(select 1 from public.approval_step_actor_snapshots where id<>1) or exists(select 1 from public.invoices) or to_regprocedure('public.amount_search_release_probe()') is not null then raise exception 'canary rollback residue';end if;
 ${failure==='rollback'?"raise exception 'intentional canary rollback failure';":''}
end;$${name}_rollback$;
-- FINANCE_AUTHENTICATED_CANARY_ROLLBACK_CHECK_END
`);
}
const canaries=['auth','finalize','utility','ar','profiles','amount'].map((name,i)=>canary(name,10+i));
const rehearsal=(name,paths=canaries)=>{const output=path.join(dir,name+'.sql');guard.prepareAuditBatchRehearsal(migrationDir,output,versions,fingerprint,paths[0],arPost,phase,paths[1],paths[2],paths.slice(3,5),profilePost,paths[5]);return fs.readFileSync(output,'utf8');};
const apply=name=>{const output=path.join(dir,name+'.sql');guard.prepareAuditBatchApply(migrationDir,output,versions,ledger,arPost,baseline,phase,profilePost);return fs.readFileSync(output,'utf8');};
let checks=0;const check=()=>checks++;
assert.equal(versions,'20260910083000');
assert.equal(guard.classifyLedger(ledger,migrationDir,phase,versions,baseline),'pending');
assert.throws(()=>guard.classifyLedger(ledger,migrationDir,'frontend_compat','none',baseline),/amount search migration/);
for(const version of prerequisites.slice(1)){writeLedger(prerequisites.filter(v=>v!==version));assert.throws(()=>guard.classifyLedger(ledger,migrationDir,phase,versions,baseline),/complete reviewed/);check();}writeLedger(prerequisites);
for(const value of ['none',guard.REPORT_MIGRATIONS.join(','),versions+',20260910083001']){assert.throws(()=>guard.releasePlan(phase,value));check();}
writeLedger([...prerequisites,'20260910083001']);assert.throws(()=>guard.classifyLedger(ledger,migrationDir,phase,versions,baseline),/unreviewed/);writeLedger(prerequisites);check();
for(let slot=0;slot<6;slot++){const paths=canaries.slice();paths[slot]=null;assert.throws(()=>rehearsal('missing_canary_'+slot,paths));check();}
const db=new PGlite();
try{
 await db.exec('create schema private;create schema supabase_migrations;create role authenticated;create table supabase_migrations.schema_migrations(version text primary key,statements text[],name text,created_by text);');
 for(const table of new Set([...fpSql.matchAll(/from ((?:public|private)\.[a-z_0-9]+) r/g)].map(m=>m[1])))await db.exec(`create table ${table}(id integer);`);
 const affected=['public.invoice_revenue_rule_assignments','public.income_document_closure_cases','public.approval_admin_director_bottleneck_cases','private.approval_notification_assignment_state'];
 for(const table of affected)await db.exec(`create table ${table}(id integer);insert into ${table} values(1);`);
 await db.exec('create table public.approval_step_actor_snapshots(id integer);insert into public.approval_step_actor_snapshots values(1);insert into public.application_accounting_lines values(1);grant usage on schema public to authenticated;grant select,insert on public.approval_step_actor_snapshots,public.invoices to authenticated;');
 for(const version of prerequisites)await db.query('insert into supabase_migrations.schema_migrations(version) values($1)',[version]);
 const fp=async()=>(await db.query(fpSql)).rows[0].fingerprint,original=await fp();
 for(const table of ['public.approval_step_actor_snapshots',...affected]){await db.exec(`begin;update ${table} set id=2;`);assert.notEqual(await fp(),original,'equal-count edits must change full fingerprint: '+table);await db.exec('rollback');assert.equal(await fp(),original);check();}
 const sql=rehearsal('rehearsal');assert.equal((sql.match(/^rollback;$/gm)||[]).length,1);
 for(const name of postflights){const at=sql.indexOf('-- Reviewed reports postflight: '+name);assert.ok(at>sql.indexOf(source)&&at<sql.indexOf('$auth_core$'),name);}
 for(const name of ['auth','finalize','utility','ar','profiles','amount']){assert.ok(sql.indexOf('$'+name+'_core$')<sql.indexOf('rollback to savepoint'));assert.ok(sql.indexOf('$'+name+'_rollback$')>sql.indexOf('rollback to savepoint'));}
 await db.exec(sql);assert.equal(await fp(),original);check();
 for(let slot=0;slot<6;slot++)for(const failure of ['core','rollback']){const paths=canaries.slice();paths[slot]=canary('failure_'+slot+'_'+failure,30+slot,failure);await assert.rejects(()=>db.exec(rehearsal('rendered_failure_'+slot+'_'+failure,paths)),/intentional/);await db.exec('rollback');assert.equal(await fp(),original);check();}
 for(let i=0;i<postflights.length;i++){
  write(postflights[i],postSources[i]+"do $bad_contract$ begin raise exception 'postflight rejected';end;$bad_contract$;\n");
  for(const mode of ['rehearsal','apply']){await assert.rejects(()=>db.exec(mode==='rehearsal'?rehearsal('bad_post_rehearsal_'+i):apply('bad_post_apply_'+i)),/postflight rejected/);await db.exec('rollback');assert.equal(await fp(),original);assert.equal((await db.query('select count(*)::int as count from supabase_migrations.schema_migrations where version=$1',[versions])).rows[0].count,0);check();}
  write(postflights[i],postSources[i]);
 }
 for(let i=0;i<postflights.length;i++){fs.unlinkSync(path.join(dir,postflights[i]));assert.throws(()=>apply('missing_post_'+i),/ENOENT/);write(postflights[i],postSources[i]);check();}
 write(postflights[7],postSources[7]+'commit;\n');assert.throws(()=>apply('transaction_control'),/transaction control/);write(postflights[7],postSources[7]);check();
 const atomic=apply('apply');assert.match(atomic,/pg_advisory_xact_lock[\s\S]+lock table supabase_migrations\.schema_migrations/);assert.equal((atomic.match(/^commit;$/gm)||[]).length,1);for(const name of postflights)assert.ok(atomic.indexOf('-- Reviewed reports postflight: '+name)>atomic.indexOf("'20260910083000',array["));
 await db.query('insert into supabase_migrations.schema_migrations(version) values($1)',['20260910083001']);await assert.rejects(()=>db.exec(atomic),/ledger changed/);await db.exec('rollback');await db.query('delete from supabase_migrations.schema_migrations where version=$1',['20260910083001']);assert.equal(await fp(),original);check();
 await db.exec(atomic);assert.deepEqual((await db.query('select statements from supabase_migrations.schema_migrations where version=$1',[versions])).rows[0].statements,[source]);const applied=await fp();
 await assert.rejects(()=>db.exec(atomic),/ledger changed/);await db.exec('rollback');assert.equal(await fp(),applied);writeLedger([...prerequisites,...guard.AMOUNT_SEARCH_MIGRATIONS]);assert.equal(guard.classifyLedger(ledger,migrationDir,phase,versions,baseline),'applied');assert.equal(guard.classifyLedger(ledger,migrationDir,'frontend_compat','none',baseline),'compat');assert.throws(()=>apply('reapply'),/pending/);check();
 for(const p of [phase,'frontend_compat']){const out=path.join(dir,p+'_recovery.sql');guard.preparePhaseQuery(path.join(dir,postflights[0]),out,p,p===phase?versions:'none');const raw=fs.readFileSync(out,'utf8');assert.match(raw,/^begin read only;/);for(const name of postflights)assert.ok(raw.includes('-- Reviewed reports postflight: '+name));await db.exec(raw);assert.equal(await fp(),applied);check();}
 const result={canary:'authenticated_amount_search_v1',ok:true,rolled_back:true,participant_scope_preserved:true},marker=value=>({amount_search_canary_result:value}),out=write('canary.json','[]');
 for(const value of [[marker(result)],{boundary:'safe fixture',rows:[marker(result)],warning:'untrusted'},[marker(JSON.stringify(result))],{results:[{rows:[marker(result)]}]}]){fs.writeFileSync(out,JSON.stringify(value));assert.equal(guard.verifyAmountSearchCanary(out),true);check();}
 const invalid=[[],{},null,result,[marker(result),marker(result)],{rows:[marker(result)],nested:marker(result)},[marker({...result,nested:marker(result)})],[marker({...result,extra:true})],[marker('{bad')],[marker(null)],...Object.keys(result).map(k=>[marker(Object.fromEntries(Object.entries(result).filter(([name])=>name!==k)))]),...Object.keys(result).flatMap(k=>[false,'true',1,null].map(v=>[marker({...result,[k]:v})]))];
 for(const value of invalid){fs.writeFileSync(out,JSON.stringify(value));assert.throws(()=>guard.verifyAmountSearchCanary(out));check();}for(const text of ['','bad','[']){fs.writeFileSync(out,text);assert.throws(()=>guard.verifyAmountSearchCanary(out),/not valid JSON/);check();}
 for(const [value,expected] of [[[marker(result)],0],[[marker({...result,rolled_back:false})],1]]){fs.writeFileSync(out,JSON.stringify(value));const cli=spawnSync(process.execPath,[path.join(repo,'scripts/finance_production_release_guard.js'),'verify-amount-search-canary','--input',out],{encoding:'utf8'});assert.equal(cli.status,expected,cli.stderr);check();}
 const actualCanaries=['finance_production_authenticated_canary.sql','finance_finalize_accounting_lines_canary.sql','finance_utility_tax_canary.sql','finance_canonical_receivables_canary.sql','finance_reporting_profiles_canary.sql','finance_amount_search_canary.sql'];
 for(const name of actualCanaries){const raw=fs.readFileSync(path.join(repo,'scripts',name),'utf8');assert.doesNotMatch(raw,/^\s*\\/m);assert.equal((raw.match(/^rollback;$/gm)||[]).length,1);assert.doesNotMatch(raw,/^\s*commit;/im);check();}
 const actual=path.join(dir,'actual.sql'),args=['prepare-amount-search-rehearsal','--migration-dir',path.join(repo,'supabase/migrations'),'--output',actual,'--migration-versions',versions,'--fingerprint',fingerprint,'--receivables-postflight',path.join(repo,'scripts',postflights[5]),'--profiles-postflight',path.join(repo,'scripts',postflights[6])];
 ['authenticated-canary','case-canary','utility-canary','receivables-canary','profiles-canary','amount-search-canary'].forEach((key,i)=>args.push('--'+key,path.join(repo,'scripts',actualCanaries[i])));
 const cli=spawnSync(process.execPath,[path.join(repo,'scripts/finance_production_release_guard.js'),...args],{encoding:'utf8'});assert.equal(cli.status,0,cli.stderr);const rendered=fs.readFileSync(actual,'utf8');assert.doesNotMatch(rendered,/^\s*\\/m);
 const migration=guard.migrationFiles(path.join(repo,'supabase/migrations')).find(name=>name.startsWith(versions+'_'));assert.ok(rendered.includes(fs.readFileSync(path.join(repo,'supabase/migrations',migration),'utf8').trimEnd()));
 for(const name of postflights)assert.ok(rendered.includes(fs.readFileSync(path.join(repo,'scripts',name),'utf8').replace(/^\\set ON_ERROR_STOP on\n/,'').replace(/:'migration_versions'/g,"'20260827052447'").trimEnd()),name+' exact postflight body');check();
 console.log('PASS amount search release: '+checks+' exact phase/prerequisites, six canaries, eight pre-COMMIT contracts, full rollback fingerprint and strict CLI checks');
}finally{await db.close();fs.rmSync(dir,{recursive:true,force:true});}
