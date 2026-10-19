// Rehearse the exact historical-export release on fictional PostgreSQL data.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import fixture from './check_remittance_history_private.cjs';
import guard from './finance_production_release_guard.js';

const root=path.resolve(import.meta.dirname,'..'),directory=path.join(root,'supabase/migrations');
const phase=guard.RELEASE_PHASE_DATABASE_REMITTANCE_HISTORY,version=guard.REMITTANCE_HISTORY_MIGRATIONS.join(',');
const prior=['00000000000001',...guard.REVIEWED_MIGRATION_CATALOG.filter(v=>v<version)];
const baseline={count:1,lastVersion:prior[0],sha256:guard.ledgerSha256([prior[0]])};
const dir=await fs.mkdtemp(path.join(os.tmpdir(),'finance-remittance-history-release-'));
const db=new PGlite({extensions:{pgcrypto}});let checks=0,serial=0;
const eq=(a,b,message)=>{assert.deepEqual(a,b,message);checks++;};
const rejects=async(fn,pattern)=>{await assert.rejects(fn,pattern);checks++;};
const gate=name=>path.join(root,'scripts','finance_remittance_history_'+name+'.sql');
const sql=async name=>(await fs.readFile(gate(name),'utf8')).replace(/^\\set ON_ERROR_STOP on\r?\n/,'');
try{
  await fixture.setup(db,{installMigration:false});
  await db.exec(`reset role;select set_config('request.jwt.claim.sub','',false);select set_config('request.jwt.claims','{}',false);
    alter table supabase_migrations.schema_migrations add column statements text[],add column created_by text;
    delete from supabase_migrations.schema_migrations;`);
  for(const v of prior)await db.query('insert into supabase_migrations.schema_migrations(version,name) values($1,$2)',[v,'synthetic_prior_catalog']);
  await db.query('update supabase_migrations.schema_migrations set name=$1,statements=$2 where version=$3',[
    'finance_mega_remittance_private_v1',[(await fs.readFile(path.join(directory,'20261018074245_finance_mega_remittance_private_v1.sql'),'utf8')).trim()],'20261018074245']);
  const ledger=path.join(dir,'ledger.txt');await fs.writeFile(ledger,prior.join('\n')+'\n');
  const fingerprint=async()=>(await db.query(await sql('fingerprint'))).rows[0].fingerprint;
  const dataFingerprint=async()=>(await db.query(`select md5(jsonb_build_array(
    (select jsonb_agg(to_jsonb(r) order by id) from public.expense_requests r),
    (select jsonb_agg(to_jsonb(r) order by id) from public.finance_users r),
    (select jsonb_agg(to_jsonb(r) order by request_id,row_key) from private.finance_mega_recipient_supplements_v1 r),
    (select jsonb_agg(to_jsonb(r) order by id) from private.finance_mega_recipient_events_v1 r))::text) as fingerprint`)).rows[0].fingerprint;
  const render=async kind=>{
    const output=path.join(dir,kind+'-'+serial+++'.sql');
    if(kind==='rehearsal')guard.prepareRemittanceHistoryRehearsal(directory,output,version,ledger,gate('fingerprint'),gate('canary'),gate('preflight'),gate('postflight'),baseline);
    else guard.prepareAuditBatchApply(directory,output,version,ledger,gate('postflight'),baseline,phase);
    return fs.readFile(output,'utf8');
  };
  eq(guard.classifyLedger(ledger,directory,phase,version,baseline),'pending');
  const before=await fingerprint(),beforeData=await dataFingerprint();
  await db.exec(await sql('preflight'));checks++;
  for(const mutation of [
    'alter table private.expense_accounting_corrections_v1 rename to correction_prerequisite_absent',
    'alter table private.expense_accounting_corrections_v1 alter column tenant_id type text using tenant_id::text'
  ]){
    await db.exec('begin;'+mutation+';');
    await rejects(async()=>db.exec(await sql('preflight')),/correction prerequisite drift/);await db.exec('rollback;');
  }
  await db.exec(await render('rehearsal'));
  eq(await fingerprint(),before,'rehearsal restores all authority metadata');
  eq(await dataFingerprint(),beforeData,'rehearsal preserves business and private recipient records');
  const apply=await render('apply');
  assert.match(apply,/begin;[\s\S]+pg_advisory_xact_lock[\s\S]+lock table supabase_migrations.schema_migrations[\s\S]+insert into supabase_migrations.schema_migrations[\s\S]+commit;/);checks++;
  await rejects(()=>db.exec(apply.replace("select 'FINANCE_REMITTANCE_HISTORY_POSTFLIGHT_OK' as marker;",()=>"do $$begin raise exception 'synthetic_history_postflight_failure';end$$;")),/synthetic_history_postflight_failure/);
  await db.exec('rollback;');
  eq(await fingerprint(),before,'failed migration restores all functions and grants');
  eq((await db.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1',[version])).rows[0].n,0,'failed migration creates no ledger receipt');
  await db.exec(apply);await db.exec(await sql('postflight'));checks++;
  eq(await dataFingerprint(),beforeData,'history availability changes no approval, amount, payment or employee');
  const canary=path.join(dir,'canary.json');await fs.writeFile(canary,JSON.stringify(await db.exec(await sql('canary'))));
  eq(guard.verifyReportsCanary(canary,'remittance_history'),true);
  // Production PG17 keeps NOT NULL in pg_attribute; PG18 adds contype=n rows.
  await db.exec("delete from pg_catalog.pg_constraint where contype='n' and conrelid in ('private.finance_mega_recipient_events_v1'::regclass,'private.finance_mega_recipient_supplements_v1'::regclass)");
  await db.exec(await sql('postflight'));checks++;
  await fs.writeFile(ledger,[...prior,version].join('\n')+'\n');
  eq(guard.classifyLedger(ledger,directory,phase,version,baseline),'applied');
  await rejects(()=>db.exec(apply),/migration ledger changed/);await db.exec('rollback;');
  for(const mutation of [
    'grant execute on function public.finance_remittance_export_snapshot_v1(text,text) to anon',
    'grant execute on function public.finance_remittance_export_supplement_save_v1(text,text,text,jsonb) to service_role',
    'revoke execute on function public.finance_remittance_export_snapshot_v1(text,text) from authenticated',
    'grant select on private.finance_mega_recipient_supplements_v1 to authenticated',
    'alter table private.finance_mega_recipient_supplements_v1 no force row level security'
  ]){
    await db.exec('begin;'+mutation+';');
    await rejects(async()=>db.exec(await sql('postflight')),/drift/);await db.exec('rollback;');
  }
  await db.exec("begin;update supabase_migrations.schema_migrations set statements=array['tampered'] where version='20261019032213';");
  await rejects(async()=>db.exec(await sql('postflight')),/sealed ledger missing or differs/);await db.exec('rollback;');
  console.log(JSON.stringify({verified:true,checks,phase,version,atomicLedger:true,rollbackProven:true,businessRecordsUnchanged:true,productionSessionUsed:false}));
}finally{await db.close();await fs.rm(dir,{recursive:true,force:true});}
