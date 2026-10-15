// Execute the actual protected phase SQL against synthetic identities/documents only.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import guard from './finance_production_release_guard.js';
import fixture from './fixtures/finance_bill_approval_fixture_20261015.cjs';
import base from './fixtures/finance_invoice_batch_fixture_20261014.cjs';
import extra from './fixtures/finance_bill_approval_live_catalog_20261015.json' with {type:'json'};
const db=new PGlite({extensions:{pgcrypto}}),dir=await fs.mkdtemp(path.join(os.tmpdir(),'finance-bill-approval-release-'));
const root=path.resolve(import.meta.dirname,'..'),migrationDir=path.join(root,'supabase/migrations');
const phase=guard.RELEASE_PHASE_DATABASE_BILL_APPROVAL_BULK,version=guard.BILL_APPROVAL_BULK_MIGRATIONS.join(',');
const prior=['00000000000001',...guard.REVIEWED_MIGRATION_CATALOG.filter(v=>v<version)];
const baseline={count:1,lastVersion:prior[0],sha256:guard.ledgerSha256([prior[0]])};
const gate=name=>path.join(root,'scripts','finance_bill_approval_bulk_'+name+'.sql');
const readGate=async name=>(await fs.readFile(gate(name),'utf8')).replace(/^\\set ON_ERROR_STOP on\r?\n/,'');
let checks=0,serial=0;
const eq=(a,b,message)=>{assert.deepEqual(a,b,message);checks++;};
const rejects=async(fn,re)=>{await assert.rejects(fn,re);checks++;};
const identifier=s=>'"'+s.replaceAll('"','""')+'"';
const approvalSignature='public.finance_bill_act_active_step_v2(text[],text,text,text,jsonb,text,jsonb,text)';
const attachmentSignature='private.finance_claim_attachment_metadata_v2()';
const originalSources={
 [approvalSignature]:'b6f348ec65ffc8c951d963ab9fbafbe6',
 [attachmentSignature]:'90d74f07ec5ac883060dec34b6cdadfe'
};
const installedSources={
 [approvalSignature]:'435f663305bce08a8fe7a05fe4747d66',
 [attachmentSignature]:'630e313afc532a88be3690bb87b93251'
};
const helperDriftMutations=[
 'grant execute on function '+attachmentSignature+' to anon',
 'grant execute on function '+attachmentSignature+' to authenticated',
 'grant execute on function '+attachmentSignature+' to public',
 'revoke execute on function '+attachmentSignature+' from service_role',
 'alter function '+attachmentSignature+' owner to service_role',
 'alter function '+attachmentSignature+' security invoker',
 'alter function '+attachmentSignature+" set search_path to public",
 'create or replace function '+attachmentSignature+" returns trigger language plpgsql security definer set search_path to '' as $$begin return new; end$$"
];
try {
 await fixture.setup(db);
 // Include existing fictional bills, operation receipts, snapshots and history in rollback proof.
 const items=Array.from({length:3},(_,i)=>({...base.item(i),item:'虛構繳費驗收 '+i,payer_name:'虛構付款人 '+i,amount:'105',due_date:'2026-10-20'}));
 const batch=(await db.query('select public.finance_submit_bill_batch($1,$2::jsonb,$3) result',['bill-release-seed-20261015',JSON.stringify(items),'production'])).rows[0].result;
 eq(batch.count,3,'release fixture must contain existing fictional bills');
 await base.identity(db,{user:null});
 await db.exec('alter table supabase_migrations.schema_migrations add column statements text[], add column created_by text;');
 for(const v of prior)await db.query('insert into supabase_migrations.schema_migrations(version,name) values($1,$2)',[v,'synthetic_predecessor']);
 const ledger=path.join(dir,'ledger.txt');await fs.writeFile(ledger,prior.join('\n')+'\n');
 const fingerprint=async()=>(await db.query(await readGate('fingerprint'))).rows[0].fingerprint;
 const dataFingerprint=async()=>{
  const result={};
  for(const t of [...base.catalog.tables,...extra.tables])result[t.schema_name+'.'+t.name]=(await db.query('select md5(coalesce(string_agg(to_jsonb(r)::text,E\'\\n\' order by to_jsonb(r)::text),\'\')) hash from '+identifier(t.schema_name)+'.'+identifier(t.name)+' r')).rows[0].hash;
  return result;
 };
 const functionState=async()=>Object.fromEntries((await db.query(`select requested.signature,
   md5(prosrc) source_md5,pg_get_userbyid(proowner) owner_name,prosecdef security_definer,
   proconfig settings,proacl::text acl from unnest($1::text[]) requested(signature)
   join pg_proc on oid=to_regprocedure(requested.signature) order by requested.signature`,
   [[approvalSignature,attachmentSignature]])).rows.map(({signature,...metadata})=>[signature,metadata]));
 const original=await fingerprint(),originalData=await dataFingerprint(),originalFunctions=await functionState();
 eq(Object.fromEntries(Object.entries(originalFunctions).map(([signature,state])=>[signature,state.source_md5])),originalSources,
   'fixture must contain both exact production predecessor functions');
 for(const mutation of helperDriftMutations){
  await db.exec('begin;'+mutation+';');
  assert.notEqual(await fingerprint(),original,'rehearsal fingerprint includes attachment helper DDL and privileges');checks++;
  await rejects(async()=>db.exec(await readGate('preflight')),/drifted/);await db.exec('rollback');
  eq(await functionState(),originalFunctions,'preflight rejects attachment source/owner/settings/ACL drift without changing either function');
 }
 const render=async kind=>{
  const file=path.join(dir,kind+'-'+serial+++'.sql');
  if(kind==='rehearsal')guard.prepareBillApprovalBulkRehearsal(migrationDir,file,version,ledger,gate('fingerprint'),gate('canary'),gate('preflight'),gate('postflight'),baseline);
  else guard.prepareAuditBatchApply(migrationDir,file,version,ledger,gate('postflight'),baseline,phase);
  return fs.readFile(file,'utf8');
 };
 eq(guard.classifyLedger(ledger,migrationDir,phase,version,baseline),'pending');
 await db.exec(await readGate('preflight'));
 await db.exec(await render('rehearsal'));
 eq(await fingerprint(),original,'rehearsal restores exact functions, grants and triggers');
 eq(await functionState(),originalFunctions,'rehearsal restores both signing and attachment helper sources, owners, settings and ACLs');
 eq(await dataFingerprint(),originalData,'rehearsal never alters documents, receipts, identities, history or notifications');
 eq((await db.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1',[version])).rows[0].n,0);
 const apply=await render('apply');
 assert.match(apply,/begin;[\s\S]+pg_advisory_xact_lock[\s\S]+lock table supabase_migrations.schema_migrations[\s\S]+insert into supabase_migrations.schema_migrations[\s\S]+commit;/);checks++;
 // The exact sealed postflight must participate in the same atomic transaction as DDL and ledger.
 const failed=apply.replace("select 'FINANCE_BILL_APPROVAL_BULK_POSTFLIGHT_OK' as marker;",()=>"do $$begin raise exception 'synthetic_postflight_failure';end $$;");
 assert.notEqual(failed,apply);checks++;
 await rejects(()=>db.exec(failed),/synthetic_postflight_failure/);await db.exec('rollback');
 eq(await fingerprint(),original,'failed postflight restores signing and attachment helper metadata');
 eq(await functionState(),originalFunctions,'failed apply restores both previous function implementations and privileges');
 eq(await dataFingerprint(),originalData,'failed apply preserves existing synthetic records');
 eq((await db.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1',[version])).rows[0].n,0);
 await db.exec(apply);
 eq((await db.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1',[version])).rows[0].n,1);
 eq(await dataFingerprint(),originalData,'successful schema-only release cannot approve or modify an existing bill');
 assert.notEqual(await fingerprint(),original,'actual approval implementation changes');checks++;
 eq(await functionState(),Object.fromEntries(Object.entries(originalFunctions).map(([signature,state])=>[
   signature,{...state,source_md5:installedSources[signature]}
 ])),'atomic apply changes only the reviewed source of both functions and preserves authority');
 await db.exec(await readGate('postflight'));
 const canary=await db.exec(await readGate('canary')),result=path.join(dir,'canary.json');await fs.writeFile(result,JSON.stringify(canary));
 eq(guard.verifyReportsCanary(result,'bill_approval_bulk'),true,'actual SQL marker verifies against protected guard');
 await fs.writeFile(ledger,[...prior,version].join('\n')+'\n');
 eq(guard.classifyLedger(ledger,migrationDir,phase,version,baseline),'applied');
 await rejects(()=>db.exec(apply),/migration ledger changed/);await db.exec('rollback');
 const installed=await fingerprint();
 for(const mutation of [
  'grant execute on function '+approvalSignature+' to anon',
  'alter table public.bills disable trigger finance_history_projection_update_v1',
  ...helperDriftMutations
 ]){
  await db.exec('begin;'+mutation+';');
  await rejects(async()=>db.exec(await readGate('postflight')),/drifted/);await db.exec('rollback');
  eq(await fingerprint(),installed,'authority/history drift probes are rolled back');
 }
 console.log(JSON.stringify({verified:true,checks,phase,version,engine:'PGlite',atomicLedger:true,rollbackProven:true,twoFunctionRollbackProven:true,attachmentAuthorityDriftRejected:true,productionApprovalExecuted:false}));
} finally {await db.close();await fs.rm(dir,{recursive:true,force:true});}
