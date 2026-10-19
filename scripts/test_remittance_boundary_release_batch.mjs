// Rehearse namespace isolation and the separately reviewed org projection repair.
// The namespace migration and authority SQL are executed byte-for-byte. Org's
// exact production identity/snapshot literals are mapped only by its explicit
// fictional fixture adapter AFTER the release guard has verified original seals.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import boundary from './check_remittance_boundary_private.cjs';
import guard from './finance_production_release_guard.js';

const root=path.resolve(import.meta.dirname,'..'),directory=path.join(root,'supabase/migrations');
const phase=guard.RELEASE_PHASE_DATABASE_REMITTANCE_BOUNDARY,versions=guard.REMITTANCE_BOUNDARY_MIGRATIONS;
const dir=await fs.mkdtemp(path.join(os.tmpdir(),'finance-remittance-boundary-release-'));
let checks=0,serial=0;
const eq=(a,b,message)=>{assert.deepEqual(a,b,message);checks++;};
const rejects=async(fn,pattern,message)=>{await assert.rejects(fn,pattern,message);checks++;};
const sql=async file=>(await fs.readFile(path.join(root,'scripts',file),'utf8')).replace(/^\\set ON_ERROR_STOP on\r?\n/,'');
const gate=kind=>path.join(root,'scripts','finance_remittance_boundary_'+kind+'.sql');
const fingerprint=async db=>(await db.query(await sql('finance_remittance_boundary_fingerprint.sql'))).rows[0].fingerprint;
const dataFingerprint=async db=>(await db.query(`select md5(jsonb_build_array(
 (select jsonb_agg(to_jsonb(r) order by id) from public.expense_requests r),
 (select jsonb_agg(to_jsonb(r) order by id) from public.finance_users r),
 (select jsonb_agg(to_jsonb(r) order by request_id,row_key) from private.finance_mega_recipient_supplements_v1 r),
 (select jsonb_agg(to_jsonb(r) order by id) from private.finance_mega_recipient_events_v1 r))::text) fingerprint`)).rows[0].fingerprint;
const core=s=>s.slice(s.indexOf('-- FINANCE_AUTHENTICATED_CANARY_CORE_BEGIN')+'-- FINANCE_AUTHENTICATED_CANARY_CORE_BEGIN'.length,s.indexOf('-- FINANCE_AUTHENTICATED_CANARY_CORE_END'));
const legacyFiles=['finance_mega_remittance_postflight.sql','finance_mega_remittance_canary.sql','finance_remittance_history_postflight.sql','finance_remittance_history_canary.sql'];
async function namespaceChecks(){
 const db=new PGlite({extensions:{pgcrypto}});
 try{
  await boundary.setup(db,{installMigration:false});await db.exec("reset role;select set_config('request.jwt.claim.sub','',false),set_config('request.jwt.claims','{}',false)");
  const before=await fingerprint(db),beforeData=await dataFingerprint(db);
  await db.exec(await sql('finance_remittance_boundary_preflight.sql'));checks++;
  for(const mutation of [
   "update supabase_migrations.schema_migrations set name='changed' where version='20261018074245'",
   "update supabase_migrations.schema_migrations set statements=array['changed'] where version='20261019032213'",
   'grant execute on function private.finance_mega_snapshot_v1(public.expense_requests) to authenticated',
   'alter function public.finance_remittance_export_snapshot_v1(text,text) security definer'
  ]){await db.exec('begin;'+mutation+';');await rejects(()=>db.exec(boundary.migration),/drift|sealed ledger missing or differs/);await db.exec('rollback;');}
  eq(await fingerprint(db),before,'Rejected prerequisites leave original namespace and all functions unchanged');
  await db.exec('begin;'+boundary.migration);await boundary.record(db,boundary.version,boundary.name,boundary.migration);await db.exec(await sql('finance_remittance_boundary_postflight.sql'));await db.exec(core(await sql('finance_remittance_boundary_canary.sql')));await db.exec('rollback;');
  eq(await fingerprint(db),before,'Namespace rehearsal exactly restores schema and function privileges');eq(await dataFingerprint(db),beforeData,'Namespace rehearsal cannot modify business or private recipient records');
  await db.exec('begin;'+boundary.migration);await boundary.record(db,boundary.version,boundary.name,boundary.migration);await rejects(()=>db.exec("do $$begin raise exception 'synthetic_namespace_postflight_failure';end$$;"),/synthetic_namespace_postflight_failure/);await db.exec('rollback;');eq(await fingerprint(db),before,'Postflight failure rolls back all four wrappers and private schema ACL');
  await db.exec('begin;'+boundary.migration);await boundary.record(db,boundary.version,boundary.name,boundary.migration);await db.exec(await sql('finance_remittance_boundary_postflight.sql'));await db.exec('commit;');
  eq(await dataFingerprint(db),beforeData,'Applied namespace repair changes no business data');
  for(const file of ['finance_remittance_boundary_canary.sql',...legacyFiles]){await db.exec(await sql(file));checks++;}
  const gates=[await sql('finance_remittance_boundary_postflight.sql'),core(await sql('finance_remittance_boundary_canary.sql')),...await Promise.all(legacyFiles.map(async file=>file.includes('canary')?core(await sql(file)):sql(file)))];
  const mutations=[
   "delete from supabase_migrations.schema_migrations where version='20261019063423'",
   "update supabase_migrations.schema_migrations set name='wrong' where version='20261019063423'",
   "update supabase_migrations.schema_migrations set statements=array['wrong'] where version='20261019063423'",
   "alter table supabase_migrations.schema_migrations drop constraint schema_migrations_pkey;insert into supabase_migrations.schema_migrations select * from supabase_migrations.schema_migrations where version='20261019063423'",
   'grant usage on schema private to authenticated',
   'grant usage on schema private to anon',
   'alter function public.finance_mega_remittance_snapshot_v1(text,text) security invoker',
   'grant execute on function private.finance_mega_remittance_snapshot_v1(text,text) to authenticated',
   'grant execute on function public.finance_mega_remittance_snapshot_v1(text,text) to anon',
   'revoke execute on function public.finance_mega_remittance_snapshot_v1(text,text) from authenticated',
   'alter function public.finance_mega_remittance_snapshot_v1(text,text) set search_path=public'
  ];
  for(const mutation of mutations)for(const source of gates){await db.exec('begin;'+mutation+';');await rejects(()=>db.exec(source),/drift|sealed|boundary|authority/i,'Exact new and predecessor gates reject mutated source/ledger/ACL');await db.exec('rollback;');}
  // History-only objects are additionally guarded by the history and new gates.
  for(const mutation of [
   'alter function public.finance_remittance_export_snapshot_v1(text,text) security invoker',
   'grant execute on function private.finance_remittance_export_snapshot_v1(text,text) to authenticated',
   'grant execute on function private.finance_remittance_export_supplement_save_v1(text,text,text,jsonb) to authenticated',
   'grant execute on function public.finance_remittance_export_supplement_save_v1(text,text,text,jsonb) to service_role'
  ])for(const source of [gates[0],gates[1],gates[4],gates[5]]){await db.exec('begin;'+mutation+';');await rejects(()=>db.exec(source),/drift|authority/);await db.exec('rollback;');}
  await db.exec("delete from pg_catalog.pg_constraint where contype='n' and conrelid in ('private.finance_mega_recipient_events_v1'::regclass,'private.finance_mega_recipient_supplements_v1'::regclass)");await db.exec(await sql('finance_remittance_boundary_postflight.sql'));checks++;
  eq(await dataFingerprint(db),beforeData,'All authority mutation tests are rolled back without financial changes');
 }finally{await db.close();}
}
async function compositeChecks(){
 const org=await import('./test_org_google_repair_snapshot.mjs');
 const db=new PGlite({extensions:{pgcrypto}});
 try{
  await boundary.setup(db,{installMigration:false});await db.exec('reset role');
  const orgFixture=await org.setup(db,{installMigration:false,reuseExisting:true});
  const fixtureSql=orgFixture.fixtureSql;
  assert.equal(typeof fixtureSql,'function','Org fixture explicitly enumerates only reviewed synthetic literal substitutions');checks++;
  await db.exec("reset role;select set_config('request.jwt.claim.sub','',false),set_config('request.jwt.claims','{}',false)");
  const prior=['00000000000001',...guard.REVIEWED_MIGRATION_CATALOG.filter(v=>v<versions[0])];
  const baseline={count:1,lastVersion:prior[0],sha256:guard.ledgerSha256([prior[0]])};
  for(const v of prior)await db.query('insert into supabase_migrations.schema_migrations(version,name) values($1,$2) on conflict(version) do nothing',[v,'synthetic_prior_catalog']);
  const ledger=path.join(dir,'ledger.txt');await fs.writeFile(ledger,prior.join('\n')+'\n');
  eq(guard.classifyLedger(ledger,directory,phase,versions.join(','),baseline),'pending');
  const render=async kind=>{
   const output=path.join(dir,kind+'-'+serial+++'.sql');
   if(kind==='rehearsal')guard.prepareRemittanceBoundaryRehearsal(directory,output,versions.join(','),ledger,gate('fingerprint'),gate('canary'),gate('preflight'),gate('postflight'),baseline);
   else guard.prepareAuditBatchApply(directory,output,versions.join(','),ledger,gate('postflight'),baseline,phase);
   const rendered=await fs.readFile(output,'utf8');
   for(const marker of ['Remittance boundary','Organization repair'])assert.match(rendered,new RegExp(marker));checks++;
   // Original immutable sources were verified by the release guard; only org
   // fixture IDs/snapshot hashes are substituted for execution in this DB.
   return fixtureSql(rendered);
  };
  const before=await fingerprint(db),beforeData=await dataFingerprint(db),orgBefore=(await db.query(fixtureSql(await sql('finance_org_google_repair_snapshot_fingerprint.sql')))).rows[0].fingerprint;
  await db.exec(await render('rehearsal'));
  eq(await fingerprint(db),before,'Composite rehearsal restores exact remittance namespace');
  eq((await db.query(fixtureSql(await sql('finance_org_google_repair_snapshot_fingerprint.sql')))).rows[0].fingerprint,orgBefore,'Composite rehearsal restores exact org versions/events');
  eq(await dataFingerprint(db),beforeData,'Composite rehearsal leaves requests/users/recipients unchanged');
  const apply=await render('apply');assert.match(apply,/begin;[\s\S]+pg_advisory_xact_lock[\s\S]+lock table supabase_migrations.schema_migrations[\s\S]+commit;/);checks++;
  await rejects(()=>db.exec(apply.replace("select 'FINANCE_ORG_GOOGLE_REPAIR_SNAPSHOT_POSTFLIGHT_OK' as marker;",()=>"do $$begin raise exception 'synthetic_composite_postflight_failure';end$$;")),/synthetic_composite_postflight_failure/);await db.exec('rollback;');
  eq(await fingerprint(db),before,'Org postflight failure rolls back earlier namespace mutation');eq((await db.query(fixtureSql(await sql('finance_org_google_repair_snapshot_fingerprint.sql')))).rows[0].fingerprint,orgBefore,'Org postflight failure rolls back later publication');
  eq((await db.query('select count(*)::int n from supabase_migrations.schema_migrations where version=any($1::text[])',[versions])).rows[0].n,0,'Failed composite release creates neither ledger receipt');
  await db.exec(apply);await db.exec(await sql('finance_remittance_boundary_postflight.sql'));await db.exec(fixtureSql(await sql('finance_org_google_repair_snapshot_postflight.sql')));checks++;
  eq(await dataFingerprint(db),beforeData,'Successful composite release does not modify financial requests or identities');
  const canary=path.join(dir,'canary.json');await fs.writeFile(canary,JSON.stringify(await db.exec(await sql('finance_remittance_boundary_canary.sql'))));eq(guard.verifyReportsCanary(canary,'remittance_boundary'),true,'Canary domain and rolled-back no-identity flags are enforced');
  await fs.writeFile(ledger,[...prior,...versions].join('\n')+'\n');eq(guard.classifyLedger(ledger,directory,phase,versions.join(','),baseline),'applied');
  await rejects(()=>db.exec(apply),/migration ledger changed/);await db.exec('rollback;');
 }finally{await db.close();}
}
try{await namespaceChecks();console.log(JSON.stringify({namespaceReleaseChecks:checks,productionDataUsed:false}));await compositeChecks();console.log(JSON.stringify({verified:true,checks,phase,versions,atomicLedger:true,rollbackProven:true,businessRecordsUnchanged:true,productionSessionUsed:false,orgSyntheticLiteralMapping:true}));}finally{await fs.rm(dir,{recursive:true,force:true});}
