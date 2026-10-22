// Execute the actual protected phase SQL against synthetic identities/documents only.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import guard from './finance_production_release_guard.js';
import fixture from './fixtures/finance_invoice_approval_fixture_20261021.cjs';
import apm from './fixtures/finance_apm_adoption_fixture_20261022.cjs';
import base from './fixtures/finance_invoice_batch_fixture_20261014.cjs';
import extra from './fixtures/finance_bill_approval_live_catalog_20261015.json' with {type:'json'};
const db=new PGlite({extensions:{pgcrypto}}),dir=await fs.mkdtemp(path.join(os.tmpdir(),'finance-bill-approval-release-'));
const root=path.resolve(import.meta.dirname,'..'),migrationDir=path.join(root,'supabase/migrations');
const phase=guard.RELEASE_PHASE_DATABASE_INVOICE_APPROVAL_BULK,version=guard.INVOICE_APPROVAL_BULK_MIGRATIONS.join(',');
const prior=['00000000000001',...guard.REVIEWED_MIGRATION_CATALOG.filter(v=>v<version)];
const baseline={count:1,lastVersion:prior[0],sha256:guard.ledgerSha256([prior[0]])};
const gate=name=>path.join(root,'scripts','finance_invoice_approval_bulk_'+name+'.sql');
const readGate=async name=>(await fs.readFile(gate(name),'utf8')).replace(/^\\set ON_ERROR_STOP on\r?\n/,'');
let checks=0,serial=0;
const eq=(a,b,message)=>{assert.deepEqual(a,b,message);checks++;};
const rejects=async(fn,re)=>{await assert.rejects(fn,re);checks++;};
const identifier=s=>'"'+s.replaceAll('"','""')+'"';
const approvalSignature='public.finance_invoice_act_active_step_v2(text[],text,text,text,jsonb,text,jsonb,jsonb,text)';
const actorSignature='private.finance_invoice_actor_can_act(uuid,public.invoices,integer,jsonb,text,text,text)';
const originalSources={
 [approvalSignature]:'ad103c477833a5a1d94e7fced1913831',
 [actorSignature]:'675ec0629eff80846200ad3e54e6d5d0'
};
const installedSources={
 [approvalSignature]:'b8f16d4644a5bfbe367a97c671937001',
 [actorSignature]:'675ec0629eff80846200ad3e54e6d5d0'
};
const authorityDriftMutations=[
 'grant execute on function '+actorSignature+' to public',
 'grant execute on function '+actorSignature+' to anon',
 'grant execute on function '+actorSignature+' to authenticated',
 'grant execute on function '+actorSignature+' to service_role',
 'alter function '+actorSignature+' owner to service_role',
 'alter function '+actorSignature+' security definer',
 'alter function '+actorSignature+" set search_path to public",
 'grant execute on function '+approvalSignature+' to anon',
 'grant execute on function '+approvalSignature+' to public',
 'revoke execute on function '+approvalSignature+' from authenticated',
 'revoke execute on function '+approvalSignature+' from service_role',
 'alter function '+approvalSignature+' owner to service_role',
 'alter function '+approvalSignature+' security invoker',
 'alter function '+approvalSignature+" set search_path to public",
 'alter table public.invoices disable trigger finance_history_projection_update_v1',
 'alter table public.invoices disable trigger trg_zz_invoices_refresh_batch_approval_notification_update_v2'
];
try {
 await fixture.setup(db);
 await apm.setupAdoptedApm(db);
 const batch=await fixture.seed(db,3,'invoice-release-seed-20261021');
 eq(batch.count,3,'release fixture must contain existing fictional invoices');
 await base.identity(db,{user:null});
 await db.exec('alter table supabase_migrations.schema_migrations add column statements text[], add column created_by text;');
 for(const v of prior)await db.query('insert into supabase_migrations.schema_migrations(version,name) values($1,$2)',[v,'synthetic_predecessor']);
 await apm.seedLedger(db);
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
   [[approvalSignature,actorSignature]])).rows.map(({signature,...metadata})=>[signature,metadata]));
 const original=await fingerprint(),originalData=await dataFingerprint(),originalFunctions=await functionState();
 eq(Object.fromEntries(Object.entries(originalFunctions).map(([signature,state])=>[signature,state.source_md5])),originalSources,
   'fixture must contain exact approval and actor predecessor functions');
 for(const mutation of authorityDriftMutations){
  await db.exec('begin;'+mutation+';');
  assert.notEqual(await fingerprint(),original,'rehearsal fingerprint includes approval authority DDL and privileges');checks++;
  await rejects(async()=>db.exec(await readGate('preflight')),/drifted/);await db.exec('rollback');
  eq(await functionState(),originalFunctions,'preflight rejects approval source/owner/settings/ACL drift without changing either function');
 }
 const render=async kind=>{
  const file=path.join(dir,kind+'-'+serial+++'.sql');
  if(kind==='rehearsal')guard.prepareInvoiceApprovalBulkRehearsal(migrationDir,file,version,ledger,gate('fingerprint'),gate('canary'),gate('preflight'),gate('postflight'),baseline);
  else guard.prepareAuditBatchApply(migrationDir,file,version,ledger,gate('postflight'),baseline,phase);
  return fs.readFile(file,'utf8');
 };
 eq(guard.classifyLedger(ledger,migrationDir,phase,version,baseline),'pending');
 await db.exec(await readGate('preflight'));
 await db.exec(await render('rehearsal'));
 eq(await fingerprint(),original,'rehearsal restores exact functions, grants and triggers');
 eq(await functionState(),originalFunctions,'rehearsal restores signing and actor helper sources, owners, settings and ACLs');
 eq(await dataFingerprint(),originalData,'rehearsal never alters documents, receipts, identities, history or notifications');
 eq((await db.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1',[version])).rows[0].n,0);
 const adoptionMarker="select 'FINANCE_APM_ADOPTION_POSTFLIGHT_OK'::text as result;";
 const adoptionState=async()=>{
  const postflight=(await fs.readFile(path.join(root,'scripts/finance_apm_adoption_postflight.sql'),'utf8')).replace(/^\\set ON_ERROR_STOP on\r?\n/,'');
  await db.exec(postflight);
  return (await db.query('select version,name,statements from supabase_migrations.schema_migrations where version=any($1::text[]) order by version',[guard.ADOPTED_APM_MIGRATIONS])).rows;
 };
 const adoptedBefore=await adoptionState();
 const apply=await render('apply');
 eq(apply.split(adoptionMarker).length-1,2,'adoption authority is checked before mutation and after mutation inside the atomic apply');
 for(const mutation of [
  "update supabase_migrations.schema_migrations set statements=array['different'] where version='20261020022748'",
  'grant execute on function public.finance_apm_metrics_command(text,jsonb) to anon',
  'alter table public.vouchers disable trigger apm_receipt_voucher_guard',
  'alter table public.ledger_entries disable trigger apm_receipt_ledger_guard'
 ]){
  // Emulate drift after the external readonly gate but before the actual transaction.
  const drifted=apply.replace("do $finance_audit_ledger_guard$",mutation+";\ndo $finance_audit_ledger_guard$");
  await rejects(()=>db.exec(drifted),/APM adoption .* drifted/);await db.exec('rollback');
  eq(await functionState(),originalFunctions,'adoption drift rejects invoice DDL before any commit');
  eq(await dataFingerprint(),originalData,'adoption rejection leaves documents and accounting untouched');
  eq(await adoptionState(),adoptedBefore,'failed adoption check restores the exact prior ledger');
 }
 const afterDdlDrift=apply.replace("select 'FINANCE_INVOICE_APPROVAL_BULK_POSTFLIGHT_OK' as marker;",()=>"alter table public.vouchers disable trigger apm_receipt_voucher_guard;");
 await rejects(()=>db.exec(afterDdlDrift),/APM adoption trigger drifted/);await db.exec('rollback');
 eq(await functionState(),originalFunctions,'post-mutation adoption drift rolls back DDL and new ledger');
 eq(await adoptionState(),adoptedBefore,'post-mutation adoption drift restores adopted receipts guard');

 assert.match(apply,/begin;[\s\S]+pg_advisory_xact_lock[\s\S]+lock table supabase_migrations.schema_migrations[\s\S]+insert into supabase_migrations.schema_migrations[\s\S]+commit;/);checks++;
 // The exact sealed postflight must participate in the same atomic transaction as DDL and ledger.
 const failed=apply.replace("select 'FINANCE_INVOICE_APPROVAL_BULK_POSTFLIGHT_OK' as marker;",()=>"do $$begin raise exception 'synthetic_postflight_failure';end $$;");
 assert.notEqual(failed,apply);checks++;
 await rejects(()=>db.exec(failed),/synthetic_postflight_failure/);await db.exec('rollback');
 eq(await fingerprint(),original,'failed postflight restores signing and actor helper metadata');
 eq(await functionState(),originalFunctions,'failed apply restores previous approval and actor implementations and privileges');
 eq(await dataFingerprint(),originalData,'failed apply preserves existing synthetic records');
 eq((await db.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1',[version])).rows[0].n,0);
 await db.exec(apply);
 eq((await db.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1',[version])).rows[0].n,1);
 eq(await dataFingerprint(),originalData,'successful schema-only release cannot approve or modify an existing invoice');
 assert.notEqual(await fingerprint(),original,'actual approval implementation changes');checks++;
 eq(await functionState(),Object.fromEntries(Object.entries(originalFunctions).map(([signature,state])=>[
   signature,{...state,source_md5:installedSources[signature]}
 ])),'atomic apply changes only the reviewed approval source and preserves authority');
 await db.exec(await readGate('postflight'));
 const canary=await db.exec(await readGate('canary')),result=path.join(dir,'canary.json');await fs.writeFile(result,JSON.stringify(canary));
 eq(guard.verifyReportsCanary(result,'invoice_approval_bulk'),true,'actual SQL marker verifies against protected guard');
 await fs.writeFile(ledger,[...prior,version].join('\n')+'\n');
 eq(guard.classifyLedger(ledger,migrationDir,phase,version,baseline),'applied');
 await rejects(()=>db.exec(apply),/migration ledger changed/);await db.exec('rollback');
 const installed=await fingerprint();
 for(const mutation of [
  'grant execute on function '+approvalSignature+' to anon',
  'alter table public.invoices disable trigger finance_history_projection_update_v1',
  ...authorityDriftMutations
 ]){
  await db.exec('begin;'+mutation+';');
  await rejects(async()=>db.exec(await readGate('postflight')),/drifted/);await db.exec('rollback');
  eq(await fingerprint(),installed,'authority/history drift probes are rolled back');
 }
 console.log(JSON.stringify({verified:true,checks,phase,version,engine:'PGlite',atomicLedger:true,rollbackProven:true,authorityRollbackProven:true,triggerDriftRejected:true,productionApprovalExecuted:false}));
} finally {await db.close();await fs.rm(dir,{recursive:true,force:true});}
