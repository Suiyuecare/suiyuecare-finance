import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {PGlite} from '@electric-sql/pglite';
import guard from './finance_production_release_guard.js';

// These anonymous SQL fixtures test release orchestration and transport. The
// separate utility domain regression executes the real migration and canary.
// No connection to a hosted project or operational accounting row is made here.
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'finance-utility-gate-'));
const phase=guard.RELEASE_PHASE_DATABASE_UTILITY,versions=guard.UTILITY_MIGRATIONS.join(',');
const prerequisites=['20260820000000',...guard.MIGRATION_CHAIN,...guard.REVIEWED_POST_BASELINE_MIGRATIONS,guard.MIGRATION_HUMAN_ACCOUNTING_AUTHORITY,...guard.AUDIT_MIGRATIONS,...guard.CASE_MIGRATIONS];
const baseline={count:1,lastVersion:prerequisites[0],sha256:guard.ledgerSha256([prerequisites[0]])};
const ledger=path.join(dir,'ledger.txt'),migrationDir=path.join(dir,'migrations');
fs.mkdirSync(migrationDir);
const write=(name,body)=>{const p=path.join(dir,name);fs.writeFileSync(p,body);return p;};
const writeLedger=rows=>fs.writeFileSync(ledger,rows.join('\n')+'\n');
writeLedger(prerequisites);
const migration="create table public.utility_release_probe(id integer); update public.application_accounting_lines set id=2;";
for(const v of guard.REVIEWED_MIGRATION_CATALOG)fs.writeFileSync(path.join(migrationDir,v+'_test.sql'),v===versions?migration:'select 1;');
const postflight=write('postflight.sql',`\\set ON_ERROR_STOP on
do $postflight$ begin
  if to_regclass('public.utility_release_probe') is null then raise exception 'utility migration absent'; end if;
  if (select id from public.application_accounting_lines where id=2) is distinct from 2 then raise exception 'accounting line update absent'; end if;
end; $postflight$;
`);
const fingerprint=fileURLToPath(new URL('./finance_cases_20260908_fingerprint.sql',import.meta.url));
const fingerprintSql=fs.readFileSync(fingerprint,'utf8').replace(/^\\set ON_ERROR_STOP on\n/,'');
assert.match(fingerprintSql,/from public.application_accounting_lines r/);
const makeCanary=(name,id,psql=false,failingPart=null)=>write(name+'.sql',`${psql?'\\set ON_ERROR_STOP on\n':''}-- Anonymous ${name} transport contract
begin isolation level repeatable read;
-- FINANCE_AUTHENTICATED_CANARY_CORE_BEGIN
do $${name}_core$ begin
  execute 'set local role authenticated';
  if current_user <> 'authenticated' then raise exception 'wrong authenticated role'; end if;
  if not exists(select 1 from public.application_accounting_lines where id=2) then raise exception 'migration must precede canary'; end if;
  insert into public.application_accounting_lines values(${id});
  ${failingPart==='core'?"raise exception 'intentional "+name+" core failure';":''}
  execute 'reset role';
end; $${name}_core$;
-- FINANCE_AUTHENTICATED_CANARY_CORE_END
-- FINANCE_AUTHENTICATED_CANARY_ROLLBACK_CHECK_BEGIN
do $${name}_rollback$ begin
  if exists(select 1 from public.application_accounting_lines where id<>1) then raise exception '${name} data residue'; end if;
  if to_regclass('public.utility_release_probe') is not null then raise exception '${name} schema residue'; end if;
  ${failingPart==='rollback'?"raise exception 'intentional "+name+" rollback failure';":''}
end; $${name}_rollback$;
-- FINANCE_AUTHENTICATED_CANARY_ROLLBACK_CHECK_END
rollback;
`);
const auth=makeCanary('auth',10),cases=makeCanary('cases',11),utility=makeCanary('utility',12,true);
const renderRehearsal=(name,a=auth,c=cases,u=utility,p=postflight)=>{
  const output=path.join(dir,name+'.sql');
  guard.prepareAuditBatchRehearsal(migrationDir,output,versions,fingerprint,a,p,phase,c,u);
  return fs.readFileSync(output,'utf8');
};
const renderApply=(name,p=postflight)=>{
  const output=path.join(dir,name+'.sql');
  guard.prepareAuditBatchApply(migrationDir,output,versions,ledger,p,baseline,phase);
  return fs.readFileSync(output,'utf8');
};
assert.equal(versions,'20260909083825');
assert.equal(guard.classifyLedger(ledger,migrationDir,phase,versions,baseline),'pending');
for(const wrong of ['none',guard.CASE_MIGRATIONS.join(',')])assert.throws(()=>guard.releasePlan(phase,wrong),/must use/);
assert.throws(()=>guard.releasePlan(phase,[...guard.CASE_MIGRATIONS,...guard.UTILITY_MIGRATIONS].join(',')),/no exact catalog/);
assert.throws(()=>guard.classifyLedger(ledger,migrationDir,'frontend_compat','none',baseline),/utility tax migration batch/);
// Every prerequisite is mandatory, including each of the already deployed audit six.
for(const missing of prerequisites.slice(1)){
  writeLedger(prerequisites.filter(v=>v!==missing));
  assert.throws(()=>guard.classifyLedger(ledger,migrationDir,phase,versions,baseline),/complete reviewed authority chain, audit batch and database cases batch/);
}
writeLedger([...prerequisites,'20260910000000']);
assert.throws(()=>guard.classifyLedger(ledger,migrationDir,phase,versions,baseline),/unreviewed|unknown/);
writeLedger(prerequisites);
const duplicate=path.join(migrationDir,versions+'_duplicate.sql');fs.writeFileSync(duplicate,'select 1;');
assert.throws(()=>guard.classifyLedger(ledger,migrationDir,phase,versions,baseline),/duplicate/i);fs.unlinkSync(duplicate);
const sourcePath=path.join(migrationDir,versions+'_test.sql');fs.unlinkSync(sourcePath);
assert.throws(()=>guard.classifyLedger(ledger,migrationDir,phase,versions,baseline),/migration file is missing/);fs.writeFileSync(sourcePath,migration);
assert.throws(()=>renderRehearsal('missing-auth',null),/canary path is required/);
assert.throws(()=>renderRehearsal('missing-cases',auth,null),/canary path is required/);
assert.throws(()=>renderRehearsal('missing-utility',auth,cases,null),/canary path is required/);
const badDirective=write('bad-directive.sql',fs.readFileSync(utility,'utf8').replace('ON_ERROR_STOP on','ON_ERROR_STOP off'));
assert.throws(()=>renderRehearsal('rehearsal-bad-directive',auth,cases,badDirective),/fail-closed directive/);
const badCommit=write('bad-commit.sql',fs.readFileSync(utility,'utf8').replace(/^rollback;$/m,'commit;'));
assert.throws(()=>renderRehearsal('rehearsal-bad-commit',auth,cases,badCommit),/rollback-only/);

const db=new PGlite();
try{
  await db.exec('create schema private; create schema supabase_migrations; create role authenticated; create table supabase_migrations.schema_migrations(version text primary key,statements text[],name text,created_by text);');
  for(const table of new Set([...fingerprintSql.matchAll(/from ((?:public|private)\.[a-z_0-9]+) r/g)].map(m=>m[1])))await db.exec(`create table ${table}(id integer);`);
  await db.exec('insert into public.application_accounting_lines values(1); grant usage on schema public to authenticated; grant select,insert on public.application_accounting_lines to authenticated;');
  for(const v of prerequisites)await db.query('insert into supabase_migrations.schema_migrations(version) values($1)',[v]);
  const getFingerprint=async()=>(await db.query(fingerprintSql)).rows[0].fingerprint;
  const original=await getFingerprint();
  await db.exec('update public.application_accounting_lines set id=9');
  assert.notEqual(await getFingerprint(),original,'Fingerprint detects normalized accounting data changes');
  await db.exec('update public.application_accounting_lines set id=1');
  const rehearsal=renderRehearsal('rehearsal');
  assert.equal((rehearsal.match(/^rollback;$/gm)||[]).length,1,'Exactly one outer rollback');
  for(const name of ['auth','cases','utility']){
    assert.ok(rehearsal.indexOf('$'+name+'_core$')<rehearsal.indexOf('rollback to savepoint'));
    assert.ok(rehearsal.indexOf('$'+name+'_rollback$')>rehearsal.indexOf('rollback to savepoint'));
  }
  await db.exec(rehearsal);
  assert.equal(await getFingerprint(),original,'Successful rehearsal rolls back all schema, application lines, ledger and canary rows');
  for(const [slot,name,id] of [[0,'auth_fail',20],[1,'cases_fail',21],[2,'utility_fail',22]]){
    for(const failAt of ['core','rollback']){
      const paths=[auth,cases,utility];paths[slot]=makeCanary(name+'_'+failAt,id,slot===2,failAt);
      const failure=renderRehearsal(name+'_'+failAt+'_rendered',...paths);
      await assert.rejects(()=>db.exec(failure),/intentional .* failure/);await db.exec('rollback');
      assert.equal(await getFingerprint(),original,'Every canary failure must rollback the entire phase: '+name+' '+failAt);
    }
  }
  const badPostflight=write('bad-postflight.sql','\\set ON_ERROR_STOP on\nselect 1/0;\n');
  await assert.rejects(()=>db.exec(renderRehearsal('bad-rehearsal-postflight',auth,cases,utility,badPostflight)),/division by zero/);await db.exec('rollback');
  assert.equal(await getFingerprint(),original);
  const failedApply=renderApply('failed-apply',badPostflight);
  await assert.rejects(()=>db.exec(failedApply),/division by zero/);await db.exec('rollback');
  assert.equal(await getFingerprint(),original,'Failed apply postflight rolls back DDL, accounting update and migration ledger together');
  const apply=renderApply('apply');
  assert.match(apply,/pg_advisory_xact_lock[\s\S]+lock table supabase_migrations\.schema_migrations[\s\S]+formal migration ledger changed/);
  assert.match(apply,/create table public\.utility_release_probe[\s\S]+insert into supabase_migrations\.schema_migrations[\s\S]+\$postflight\$[\s\S]+commit;/);
  await db.query('insert into supabase_migrations.schema_migrations(version) values($1)',['20260910000000']);
  await assert.rejects(()=>db.exec(apply),/ledger changed/);await db.exec('rollback');
  await db.query('delete from supabase_migrations.schema_migrations where version=$1',['20260910000000']);
  assert.equal(await getFingerprint(),original,'Stale ledger is rejected before any migration work');
  await db.exec(apply);
  assert.equal((await db.query('select id from public.application_accounting_lines')).rows[0].id,2);
  const newLedger=(await db.query('select version,statements from supabase_migrations.schema_migrations where version=$1',[versions])).rows;
  assert.equal(newLedger.length,1);assert.deepEqual(newLedger[0].statements,[migration]);
  const appliedFingerprint=await getFingerprint();
  await assert.rejects(()=>db.exec(apply),/ledger changed/);await db.exec('rollback');
  assert.equal(await getFingerprint(),appliedFingerprint,'Reexecuting a generated apply payload cannot mutate applied data');
  writeLedger([...prerequisites,...guard.UTILITY_MIGRATIONS]);
  assert.equal(guard.classifyLedger(ledger,migrationDir,phase,versions,baseline),'applied');
  assert.equal(guard.classifyLedger(ledger,migrationDir,'frontend_compat','none',baseline),'compat');
  assert.throws(()=>renderApply('reapply'),/must be pending/);

  const marker='utility_tax_canary_result';
  const expected={canary:'authenticated_utility_tax_v1',ok:true,rolled_back:true,utility_input_tax_absent:true};
  const row=value=>({[marker]:value}),output=write('canary.json','[]');
  // A read-only pinned 2.111.0 probe on 2026-09-08 confirmed the boundary/rows
  // wrapper. Row arrays and stringified jsonb remain supported CLI transports.
  const accepted=[
    [row(expected)],{boundary:'probe',rows:[row(expected)],warning:'untrusted result'},
    {rows:[row(expected)]},[{rows:[row(expected)]}],{results:[{rows:[row(expected)]}]},
    [row(JSON.stringify(expected))],{boundary:'probe',rows:[row(JSON.stringify(expected))]}
  ];
  for(const value of accepted){fs.writeFileSync(output,JSON.stringify(value));assert.equal(guard.verifyUtilityCanary(output),true);}
  const rejected=[
    {},[],null,false,true,1,'no row set',expected,[{finalize_accounting_canary_result:expected}],
    [row(expected),row(expected)],{rows:[row(expected)],nested:{rows:[row(expected)]}},
    [row({...expected,nested:row(expected)})],[row(null)],[row(false)],[row([])],[row({})],[row('{malformed')],
    [row({...expected,canary:'authenticated_finalize_accounting_lines'})],
    ...['ok','rolled_back','utility_input_tax_absent'].flatMap(key=>[false,'true',1,null].map(value=>[row({...expected,[key]:value})])),
    [row({...expected,unexpected:true})],
    ...Object.keys(expected).map(key=>[row(Object.fromEntries(Object.entries(expected).filter(([name])=>name!==key)))])
  ];
  for(const value of rejected){fs.writeFileSync(output,JSON.stringify(value));assert.throws(()=>guard.verifyUtilityCanary(output),'Rejected unsafe output '+JSON.stringify(value));}
  for(const value of ['',' ','[','{','not-json']){fs.writeFileSync(output,value);assert.throws(()=>guard.verifyUtilityCanary(output),/not valid JSON/);}
  const guardPath=fileURLToPath(new URL('./finance_production_release_guard.js',import.meta.url));
  for(const [value,pass] of [[accepted[1],true],[accepted[0],true],[rejected[9],false]]){
    fs.writeFileSync(output,JSON.stringify(value));
    const cli=spawnSync(process.execPath,[guardPath,'verify-utility-canary','--input',output],{encoding:'utf8'});
    assert.equal(cli.status===0,pass,cli.stderr);
  }
  fs.writeFileSync(output,'[]');
  assert.throws(()=>guard.verifyCandidate(output,output,'a'.repeat(40),'https://immutable-fixture.vercel.app'),/must contain a JSON object/,'General manifest input remains object-only');
  // Render the actual repository files through the production CLI interface as
  // well. This verifies file/directive/marker compatibility without executing
  // production SQL; the domain suite owns execution of those SQL contracts.
  const repo=fileURLToPath(new URL('..',import.meta.url));
  // These three files also run directly through `supabase db query --file`,
  // outside the rehearsal renderer. The CLI sends SQL to PostgreSQL and does
  // not interpret psql metacommands (release 34332884768 failed on \set).
  const assertStandaloneCanary=source=>{
    assert.doesNotMatch(source,/^\s*\\/m,'Standalone canaries must be pure SQL without psql metacommands');
    assert.match(source,/^begin isolation level repeatable read;$/m);
    assert.equal((source.match(/^rollback;$/gm)||[]).length,1,'Standalone canaries retain exactly one outer rollback');
    assert.doesNotMatch(source,/^\s*commit\s*;/im);
    for(const section of ['CORE','ROLLBACK_CHECK']){
      const start='-- FINANCE_AUTHENTICATED_CANARY_'+section+'_BEGIN';
      const end='-- FINANCE_AUTHENTICATED_CANARY_'+section+'_END';
      assert.equal(source.split(start).length,2);assert.equal(source.split(end).length,2);
      assert.ok(source.indexOf(start)<source.indexOf(end),'Canary sections remain ordered');
    }
  };
  const standaloneCanaries=['finance_production_authenticated_canary.sql','finance_finalize_accounting_lines_canary.sql','finance_utility_tax_canary.sql'];
  for(const filename of standaloneCanaries){
    const raw=fs.readFileSync(path.join(repo,'scripts',filename),'utf8');
    assertStandaloneCanary(raw);
    assert.throws(()=>assertStandaloneCanary('\\set ON_ERROR_STOP on\n'+raw),/pure SQL without psql metacommands/,'The previously failing standalone transport must be rejected: '+filename);
    for(const metacommand of ['\\i unsafe.sql','\\echo unsafe','\\set ON_ERROR_STOP off']){
      assert.throws(()=>assertStandaloneCanary(raw+'\n  '+metacommand+'\n'),/pure SQL without psql metacommands/);
    }
  }
  const actualRehearsal=path.join(dir,'actual-rehearsal.sql');
  const renderedCli=spawnSync(process.execPath,[guardPath,'prepare-utility-rehearsal',
    '--migration-dir',path.join(repo,'supabase/migrations'),'--output',actualRehearsal,
    '--migration-versions',versions,'--fingerprint',fingerprint,
    '--authenticated-canary',path.join(repo,'scripts/finance_production_authenticated_canary.sql'),
    '--case-canary',path.join(repo,'scripts/finance_finalize_accounting_lines_canary.sql'),
    '--utility-canary',path.join(repo,'scripts/finance_utility_tax_canary.sql'),
    '--utility-postflight',path.join(repo,'scripts/finance_utility_tax_postflight.sql')],{encoding:'utf8'});
  assert.equal(renderedCli.status,0,renderedCli.stderr);
  const actualSql=fs.readFileSync(actualRehearsal,'utf8');
  assert.ok(actualSql.includes(fs.readFileSync(path.join(repo,'supabase/migrations/'+versions+'_finance_utility_gross_expense_guard_v1.sql'),'utf8').trimEnd()),'Rendered rehearsal includes the exact migration');
  assert.doesNotMatch(actualSql,/^\\set/m,'PSQL directives are stripped only for the generated CLI batch');
  assert.match(actualSql,/__finance_utility_tax_canary_20260909__/);
  assert.match(actualSql,/rollback to savepoint finance_release_migration;[\s\S]+Utility tax canary rollback left fixture data behind/);
  console.log('PASS utility release: exact version, all '+(prerequisites.length-1)+' prerequisites, frontend prerequisite, three authenticated canaries, full fingerprint rollback, six canary failures, atomic apply, stale ledger and reapply rejection');
  console.log('PASS utility canary parser: '+accepted.length+' CLI transports, '+rejected.length+' unsafe shapes, five malformed inputs, CLI exit statuses and object-only manifests');
  console.log('PASS utility CLI renderer accepts the actual migration, postflight and three canary files; real SQL domain execution remains a separate gate');
  console.log('PASS three standalone canaries are pure SQL with intact rollback/markers; the failed psql transport and other metacommands are rejected');
}finally{await db.close();fs.rmSync(dir,{recursive:true});}
