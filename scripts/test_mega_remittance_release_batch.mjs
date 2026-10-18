// Executes the protected release SQL on a fictional PGlite database only.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import privateFixture from './check_mega_remittance_private.cjs';
import guard from './finance_production_release_guard.js';

const root=path.resolve(import.meta.dirname,'..'),migrations=path.join(root,'supabase/migrations');
const phase=guard.RELEASE_PHASE_DATABASE_MEGA_REMITTANCE,versions=guard.MEGA_REMITTANCE_MIGRATIONS.join(',');
const prior=['00000000000001',...guard.REVIEWED_MIGRATION_CATALOG.filter(version=>version<versions)];
const baseline={count:1,lastVersion:prior[0],sha256:guard.ledgerSha256([prior[0]])};
const dir=await fs.mkdtemp(path.join(os.tmpdir(),'finance-mega-release-'));
const db=new PGlite({extensions:{pgcrypto}});let checks=0,serial=0;
const eq=(a,b,message)=>{assert.deepEqual(a,b,message);checks++;};
const rejects=async(fn,pattern)=>{await assert.rejects(fn,pattern);checks++;};
const gate=name=>path.join(root,'scripts','finance_mega_remittance_'+name+'.sql');
const sql=async name=>(await fs.readFile(gate(name),'utf8')).replace(/^\\set ON_ERROR_STOP on\r?\n/,'');
try {
  await privateFixture.setup(db,{installMigration:false});
  await db.exec(`reset role;select set_config('request.jwt.claim.sub','',false);select set_config('request.jwt.claims','{}',false);
    alter table supabase_migrations.schema_migrations add column statements text[],add column created_by text;
    delete from supabase_migrations.schema_migrations;`);
  for(const version of prior)await db.query('insert into supabase_migrations.schema_migrations(version,name) values($1,$2)',[version,'synthetic_prior_catalog']);
  const ledger=path.join(dir,'ledger.txt');await fs.writeFile(ledger,prior.join('\n')+'\n');
  const fingerprint=async()=>(await db.query(await sql('fingerprint'))).rows[0].fingerprint;
  const dataFingerprint=async()=>(await db.query(`select md5(jsonb_build_array(
    (select jsonb_agg(to_jsonb(r) order by id) from public.expense_requests r),
    (select jsonb_agg(to_jsonb(r) order by id) from public.finance_users r))::text) as fingerprint`)).rows[0].fingerprint;
  const render=async kind=>{
    const out=path.join(dir,kind+'-'+serial+++'.sql');
    if(kind==='rehearsal')guard.prepareMegaRemittanceRehearsal(migrations,out,versions,ledger,gate('fingerprint'),gate('canary'),gate('preflight'),gate('postflight'),baseline);
    else guard.prepareAuditBatchApply(migrations,out,versions,ledger,gate('postflight'),baseline,phase);
    return fs.readFile(out,'utf8');
  };
  eq(guard.classifyLedger(ledger,migrations,phase,versions,baseline),'pending');
  const before=await fingerprint(),beforeData=await dataFingerprint();
  await db.exec(await sql('preflight'));
  await db.exec(await render('rehearsal'));
  eq(await fingerprint(),before,'rollback rehearsal restores new and existing authority metadata');
  eq(await dataFingerprint(),beforeData,'rehearsal does not alter any synthetic request or employee');
  eq((await db.query("select to_regclass('private.finance_mega_recipient_supplements_v1') as t")).rows[0].t,null,'new private tables roll back');
  const apply=await render('apply');
  assert.match(apply,/begin;[\s\S]+pg_advisory_xact_lock[\s\S]+lock table supabase_migrations.schema_migrations[\s\S]+insert into supabase_migrations.schema_migrations[\s\S]+commit;/);checks++;
  await rejects(()=>db.exec(apply.replace("select 'FINANCE_MEGA_REMITTANCE_POSTFLIGHT_OK' as marker;",()=>"do $$begin raise exception 'synthetic_postflight_failure';end$$;")),/synthetic_postflight_failure/);
  await db.exec('rollback;');
  eq(await fingerprint(),before,'failed apply rolls back private schema and function grants');
  eq((await db.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1',[versions])).rows[0].n,0,'failed apply leaves no migration receipt');
  await db.exec(apply);await db.exec(await sql('postflight'));
  eq(await dataFingerprint(),beforeData,'successful migration changes no employee or approved request');
  const resultPath=path.join(dir,'canary.json');await fs.writeFile(resultPath,JSON.stringify(await db.exec(await sql('canary'))));
  eq(guard.verifyReportsCanary(resultPath,'mega_remittance'),true);
  // PG18/PGlite adds contype=n rows that production PG17 does not have. Remove
  // those rows only in this disposable fictional DB and run the actual gates.
  // pg_attribute.attnotnull remains intact, as on PG17; no live DB is involved.
  const notNullShape=async()=>(await db.query(`select jsonb_agg(jsonb_build_array(c.relname,a.attname,a.attnotnull) order by c.relname,a.attnum) as shape
    from pg_catalog.pg_attribute a join pg_catalog.pg_class c on c.oid=a.attrelid
    where c.oid in ('private.finance_mega_recipient_events_v1'::regclass,'private.finance_mega_recipient_supplements_v1'::regclass)
      and a.attnum>0 and not a.attisdropped`)).rows[0].shape;
  const originalNotNullShape=await notNullShape();
  const removed=await db.query(`delete from pg_catalog.pg_constraint where contype='n'
    and conrelid in ('private.finance_mega_recipient_events_v1'::regclass,'private.finance_mega_recipient_supplements_v1'::regclass) returning oid`);
  assert(removed.rows.length>0,'the PG17 fixture must actually remove PG18 NOT NULL catalog rows');checks++;
  eq(await notNullShape(),originalNotNullShape,'PG17 fixture retains every attnotnull flag');
  await db.exec(await sql('postflight'));checks++;
  await fs.writeFile(resultPath,JSON.stringify(await db.exec(await sql('canary'))));
  eq(guard.verifyReportsCanary(resultPath,'mega_remittance'),true,'actual read-only canary accepts the PG17 catalog shape');
  await db.exec("begin;update pg_catalog.pg_attribute set attnotnull=false where attrelid='private.finance_mega_recipient_events_v1'::regclass and attname='actor_id';");
  await rejects(async()=>db.exec(await sql('postflight')),/Mega remittance private table authority\/shape drift/);await db.exec('rollback;');
  eq(await notNullShape(),originalNotNullShape,'failed PG17 NOT NULL drift check is rolled back');
  await fs.writeFile(ledger,[...prior,versions].join('\n')+'\n');eq(guard.classifyLedger(ledger,migrations,phase,versions,baseline),'applied');
  await rejects(()=>db.exec(apply),/migration ledger changed/);await db.exec('rollback;');
  for(const mutation of [
    'grant select on private.finance_mega_recipient_supplements_v1 to authenticated',
    'grant select(payee_name) on private.finance_mega_recipient_supplements_v1 to authenticated',
    'alter table private.finance_mega_recipient_supplements_v1 drop constraint finance_mega_recipient_supplements_v1_pkey',
    'alter table private.finance_mega_recipient_supplements_v1 no force row level security',
    'grant execute on function private.finance_mega_snapshot_v1(public.expense_requests) to anon',
    'grant execute on function public.finance_mega_remittance_snapshot_v1(text,text) to service_role',
    'revoke execute on function public.finance_mega_remittance_snapshot_v1(text,text) from authenticated',
    'alter table private.finance_mega_recipient_events_v1 disable trigger mega_recipient_event_immutable'
  ]){
    await db.exec('begin;'+mutation+';');await rejects(async()=>db.exec(await sql('postflight')),/Mega remittance .*drift/);await db.exec('rollback;');
  }
  await db.exec("begin;update supabase_migrations.schema_migrations set statements=array['tampered'] where version='20261018074245';");
  await rejects(async()=>db.exec(await sql('postflight')),/sealed ledger missing or differs/);await db.exec('rollback;');
  const workflow=await fs.readFile(path.join(root,'.github/workflows/finance-production-release.yml'),'utf8');
  assert(workflow.includes('promotion-mega-remittance-canary.json'),'promotion verifies the private-data contract again');checks++;
  assert(workflow.includes('prepare-mega-remittance-rehearsal'),'protected apply must rehearse rollback first');checks++;
  const promoteIf=workflow.slice(workflow.indexOf('\n  promote:\n')).split('\n').find(line=>line.includes('if:'));
  assert(promoteIf&&!promoteIf.includes(phase),'the fixed database phase also promotes its tested frontend');checks++;
  console.log(JSON.stringify({verified:true,checks,phase,version:versions,atomicLedger:true,rollbackProven:true,productionSessionUsed:false,businessActionPerformed:false}));
} finally {await db.close();await fs.rm(dir,{recursive:true,force:true});}
