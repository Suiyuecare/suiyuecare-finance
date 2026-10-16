// Exercise the sealed protected-release SQL locally. No production connection.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import createFixture from './fixtures/finance_bank_fee_classification_fixture.cjs';
import guard from './finance_production_release_guard.js';

const root=path.resolve(import.meta.dirname,'..');
const migrations=path.join(root,'supabase/migrations');
const phase=guard.RELEASE_PHASE_DATABASE_BANK_FEE_CLASSIFICATION;
const versions=guard.BANK_FEE_CLASSIFICATION_MIGRATIONS.join(',');
const prior=['00000000000001',...guard.REVIEWED_MIGRATION_CATALOG.filter(version=>version<versions)];
const baseline={count:1,lastVersion:prior[0],sha256:guard.ledgerSha256([prior[0]])};
const dir=await fs.mkdtemp(path.join(os.tmpdir(),'finance-bank-fee-release-'));
const fixture=await createFixture(root),{db,create}=fixture;let checks=0,serial=0;
const eq=(a,b,message)=>{assert.deepEqual(a,b,message);checks++;};
const rejects=async(fn,pattern)=>{await assert.rejects(fn,pattern);checks++;};
const gate=name=>path.join(root,'scripts','finance_bank_fee_classification_'+name+'.sql');
const sql=async name=>(await fs.readFile(gate(name),'utf8')).replace(/^\\set ON_ERROR_STOP on\r?\n/,'');
try {
  // Exact reviewed revision SQL on a fictional schema. No live employee or request is loaded.
  await create('anonymous-existing-document',{bank_fee_amount:0,bank_type:'other',bank_name:'非兆豐銀行',fee_bearer:'己方支出'});
  await db.exec(`
    select set_config('test.auth','',false);
    create schema supabase_migrations;
    create table supabase_migrations.schema_migrations(version text primary key,statements text[],name text,created_by text);
  `);
  for(const version of prior)await db.query('insert into supabase_migrations.schema_migrations(version,name) values($1,$2)',[version,'synthetic_prior_catalog']);
  const ledger=path.join(dir,'ledger.txt');await fs.writeFile(ledger,prior.join('\n')+'\n');
  const fingerprint=async()=>(await db.query(await sql('fingerprint'))).rows[0].fingerprint;
  const dataFingerprint=async()=>(await db.query(`select md5(jsonb_build_array(
    (select jsonb_agg(to_jsonb(r) order by id) from public.expense_requests r),
    (select jsonb_agg(to_jsonb(r) order by id) from public.finance_users r),
    (select jsonb_agg(to_jsonb(r) order by id) from public.vouchers r),
    (select jsonb_agg(to_jsonb(r) order by id) from public.ledger_entries r))::text) as fingerprint`)).rows[0].fingerprint;
  const render=async kind=>{
    const out=path.join(dir,kind+'-'+serial+++'.sql');
    if(kind==='rehearsal')guard.prepareBankFeeClassificationRehearsal(migrations,out,versions,ledger,gate('fingerprint'),gate('canary'),gate('preflight'),gate('postflight'),baseline);
    else guard.prepareAuditBatchApply(migrations,out,versions,ledger,gate('postflight'),baseline,phase);
    return fs.readFile(out,'utf8');
  };
  eq(guard.classifyLedger(ledger,migrations,phase,versions,baseline),'pending');
  const before=await fingerprint(),beforeData=await dataFingerprint();
  await db.exec(await sql('preflight'));
  await db.exec(await render('rehearsal'));
  eq(await fingerprint(),before,'rehearsal restores exact function metadata');
  eq(await dataFingerprint(),beforeData,'rehearsal preserves fictional employees and documents');
  const apply=await render('apply');
  assert.match(apply,/begin;[\s\S]+pg_advisory_xact_lock[\s\S]+lock table supabase_migrations.schema_migrations[\s\S]+insert into supabase_migrations.schema_migrations[\s\S]+commit;/);checks++;
  await rejects(()=>db.exec(apply.replace("select 'FINANCE_BANK_FEE_CLASSIFICATION_POSTFLIGHT_OK' as marker;",()=>"do $$begin raise exception 'synthetic_postflight_failure';end$$;")),/synthetic_postflight_failure/);
  await db.exec('rollback;');
  eq(await fingerprint(),before,'failed apply restores function metadata');
  eq((await db.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1',[versions])).rows[0].n,0,'failed apply does not leave migration receipt');
  await db.exec(apply);
  await db.exec(await sql('postflight'));
  eq(await dataFingerprint(),beforeData,'successful DDL changes no business or employee data');
  const canaryResults=await db.exec(await sql('canary'));
  const resultPath=path.join(dir,'canary.json');await fs.writeFile(resultPath,JSON.stringify(canaryResults));
  eq(guard.verifyReportsCanary(resultPath,'bank_fee_classification'),true);
  await fs.writeFile(ledger,[...prior,versions].join('\n')+'\n');
  eq(guard.classifyLedger(ledger,migrations,phase,versions,baseline),'applied');
  await rejects(()=>db.exec(apply),/migration ledger changed/);await db.exec('rollback;');
  await db.exec('begin;grant execute on function private.finance_expense_resubmit_applicant_revision_v1_unsafe(text,text,text,integer,timestamptz,integer,text,jsonb,jsonb,text) to anon;');
  await rejects(async()=>db.exec(await sql('postflight')),/authority\/source drift/);await db.exec('rollback;');
  await db.exec('begin;create role unexpected_fee_reader;grant execute on function private.finance_expense_resubmit_applicant_revision_v1_unsafe(text,text,text,integer,timestamptz,integer,text,jsonb,jsonb,text) to unexpected_fee_reader;');
  await rejects(async()=>db.exec(await sql('postflight')),/authority\/source drift/);await db.exec('rollback;');
  await db.exec('begin;revoke execute on function public.finance_expense_resubmit_applicant_revision(text,text,text,integer,timestamptz,integer,text,jsonb,jsonb,text) from authenticated;');
  await rejects(async()=>db.exec(await sql('postflight')),/authority\/source drift/);await db.exec('rollback;');
  await db.exec("begin;update supabase_migrations.schema_migrations set statements=array['tampered'] where version='20261016043221';");
  await rejects(async()=>db.exec(await sql('postflight')),/sealed ledger missing or differs/);await db.exec('rollback;');
  const workflow=await fs.readFile(path.join(root,'.github/workflows/finance-production-release.yml'),'utf8');
  const promoteIf=workflow.slice(workflow.indexOf('\n  promote:\n')).split('\n').find(line=>line.includes('if:'));
  assert(promoteIf&&!promoteIf.includes(phase),'bank-fee phase must promote the tested frontend');checks++;
  assert(workflow.includes('promotion-bank-fee-classification-canary.json'),'promotion must recheck the new database contract');checks++;
  assert(!workflow.includes('finance-fee-revision-live-metadata'),'private live catalog exports must never enter a public release bundle');checks++;
  console.log(JSON.stringify({verified:true,checks,phase,version:versions,atomicLedger:true,rollbackProven:true,productionSessionUsed:false,businessActionPerformed:false}));
} finally {await db.close();await fs.rm(dir,{recursive:true,force:true});}
