#!/usr/bin/env node
'use strict';
// Executes real release SQL against isolated catalog fixtures. This checks DDL,
// source/ACL gates and rollback, not production business-data performance.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');
const guard=require('./finance_production_release_guard.js');
const root=path.resolve(__dirname,'..'),read=f=>fs.readFileSync(path.join(root,f),'utf8');
const sql=name=>path.join(root,'scripts/finance_completion_'+name+'.sql');
const phase=guard.RELEASE_PHASE_DATABASE_FINANCE_COMPLETION,versions=guard.FINANCE_COMPLETION_MIGRATIONS.join(',');
const prior=['20260825000000',...guard.REVIEWED_MIGRATION_CATALOG.filter(v=>v<guard.FINANCE_COMPLETION_MIGRATIONS[0])];
const baseline={count:1,lastVersion:prior[0],sha256:guard.ledgerSha256([prior[0]])};
const strip=s=>s.replace(/^\\set ON_ERROR_STOP on\r?\n/,'');
function signature(def){const m=def.match(/function\s+([\w.]+)\((.*?)\)\s*returns/is);assert(m);return m[1]+'('+m[2].split(',').map(x=>x.trim().replace(/\s+default\s+.*/i,'').split(/\s+/).slice(1).join(' ')).join(',')+')';}
async function fixture(db){
 await db.exec(`set check_function_bodies=off;create schema private;create schema auth;create schema storage;create schema extensions;create schema supabase_migrations;
 create role anon;create role authenticated;create role service_role;create table public.tenants(id uuid primary key);create table public.finance_users(id text primary key);
 create table public.ledger_entries(id uuid primary key);create table public.vouchers(id text primary key);create table public.file_attachments(id uuid primary key);create table storage.objects(id uuid primary key);
 create table supabase_migrations.schema_migrations(version text primary key,statements text[],name text,created_by text);
 create function auth.uid() returns uuid language sql stable as $$select null::uuid$$;`);
 for(const v of prior)await db.query('insert into supabase_migrations.schema_migrations values($1,null,$2,null)',[v,v==='20261010130000'?'finance_personal_invoice_batch_history_v1':'fixture_predecessor']);
 const captured=JSON.parse(read('scripts/fixtures/finance_cloud_submission_live_sources_20261011.json'));
 for(const row of [...captured.submit,...captured.limits]){
  await db.exec(row.definition);const sig=signature(row.definition),auth=sig.startsWith('public.'),service=auth&&!sig.includes('receipt_action');
  await db.exec('revoke all on function '+sig+' from public,anon,authenticated,service_role;'+(auth?'grant execute on function '+sig+' to authenticated;':'')+(service?'grant execute on function '+sig+' to service_role;':''));
 }
 for(const row of JSON.parse(read('scripts/fixtures/finance_completion_baseline_metadata_20261011.json')).items){
  await db.exec(row.definition);const sig=row.signature.startsWith('private.')?row.signature:'public.'+row.signature;
  await db.exec('revoke all on function '+sig+' from public,anon,authenticated,service_role;grant execute on function '+sig+' to authenticated,service_role;');
 }
}
async function createDatabase(){
 const configPath=process.env.FINANCE_NATIVE_PG_CONFIG;if(!configPath)return new PGlite();
 assert.equal(fs.statSync(configPath).mode&0o077,0,'native configuration must be private');
 const config=JSON.parse(fs.readFileSync(configPath));assert(['127.0.0.1','::1','localhost'].includes(config.host));assert.equal(config.database,'postgres');assert(!config.ssl);
 const {Client}=require('pg'),admin=new Client(config),name='completion_catalog_'+crypto.randomUUID().replaceAll('-','');
 await admin.connect();for(const role of ['anon','authenticated','service_role'])await admin.query(`do $$begin if not exists(select 1 from pg_roles where rolname='${role}') then create role ${role};end if;end$$;`);await admin.query('create database '+name);const client=new Client({...config,database:name});
 try{await client.connect();return {exec:s=>client.query(s.replace(/create role (?:anon|authenticated|service_role);/g,'')),query:(s,args)=>client.query(s,args),close:async()=>{await client.query('rollback').catch(()=>{});await client.end();await admin.query('drop database '+name);await admin.end();}};}
 catch(e){await client.end().catch(()=>{});await admin.query('drop database '+name);await admin.end();throw e;}
}
async function main(){
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'finance-completion-release-'));let db;
 const checks=[];const check=(name,fn)=>{fn();checks.push(name);};
 try{
  const dir=path.join(root,'supabase/migrations'),ledger=path.join(temp,'ledger.txt');fs.writeFileSync(ledger,prior.join('\n')+'\n');
  check('only exact reviewed five-version phase allowed',()=>{assert.equal(guard.releasePlan(phase,versions).releasePhase,phase);assert.throws(()=>guard.releasePlan(phase,guard.FINANCE_COMPLETION_MIGRATIONS[0]));});
  check('predecessors required and all-or-none installation',()=>{assert.equal(guard.classifyLedger(ledger,dir,phase,versions,baseline),'pending');fs.appendFileSync(ledger,guard.FINANCE_COMPLETION_MIGRATIONS[0]+'\n');assert.throws(()=>guard.classifyLedger(ledger,dir,phase,versions,baseline),/partially installed/);fs.writeFileSync(ledger,prior.join('\n')+'\n');});
  const batch=guard.readAuditBatch(dir,versions,phase);assert.equal(batch.length,5);
  for(const target of batch){const copy=path.join(temp,target.version);fs.mkdirSync(copy);for(const item of batch)fs.writeFileSync(path.join(copy,item.filename),item.source+(item===target?'\n-- corruption':''));assert.throws(()=>guard.readAuditBatch(copy,versions,phase),/sealed SHA256/);}checks.push('each migration source SHA rejects changes');
  const rehearsal=path.join(temp,'rehearsal.sql'),apply=path.join(temp,'apply.sql');
  guard.prepareBillBatchBulkRehearsal(dir,rehearsal,versions,ledger,sql('fingerprint'),sql('canary'),sql('preflight'),sql('postflight'),baseline,phase);
  guard.prepareAuditBatchApply(dir,apply,versions,ledger,sql('postflight'),baseline,phase);
  check('atomic apply repeats source gate after release lock',()=>{const s=fs.readFileSync(apply,'utf8');assert.match(s,/pg_advisory_xact_lock[\s\S]*FINANCE_COMPLETION_PREFLIGHT_OK[\s\S]*create table private.finance_month_snapshots_v1[\s\S]*FINANCE_COMPLETION_POSTFLIGHT_OK[\s\S]*commit;/);assert.equal((s.match(/insert into supabase_migrations\.schema_migrations\(version,statements,name,created_by\)/g)||[]).length,5);});
  const canary=read('scripts/finance_completion_canary.sql');assert.doesNotMatch(canary,/^\s*\\/m);assert.match(canary,/repeatable read read only/);
  const marker=path.join(temp,'canary.json'),result={canary:'readonly_finance_completion_v1',ok:true,rolled_back:true,authority_preserved:true};fs.writeFileSync(marker,JSON.stringify([{finance_completion_canary_result:result}]));assert.equal(guard.verifyReportsCanary(marker,'finance_completion'),true);fs.writeFileSync(marker,JSON.stringify([{finance_completion_canary_result:{...result,authority_preserved:false}}]));assert.throws(()=>guard.verifyReportsCanary(marker,'finance_completion'));checks.push('canary JSON requires rollback and unchanged authority');
  assert.throws(()=>guard.prepareBillBatchBulkRehearsal(dir,path.join(temp,'bad-rehearsal.sql'),versions,ledger,sql('fingerprint'),sql('canary'),sql('postflight'),sql('postflight'),baseline,phase),/exact sealed gates/);checks.push('rehearsal rejects swapped or unsealed gate paths');
  const gate=path.join(temp,'gate.sql');guard.preparePhaseQuery(sql('postflight'),gate,phase,versions);assert.match(fs.readFileSync(gate,'utf8'),/^begin read only;/);assert.throws(()=>guard.preparePhaseQuery(sql('preflight'),path.join(temp,'bad.sql'),phase,versions),/exact sealed postflight/);checks.push('postflight requires exact gate inside read-only transaction');
  // Real PostgreSQL engine parses/executes all catalog gates, real migrations,
  // transactions, ACLs and triggers. Business dependencies are deliberately
  // empty fixtures; behavioral tests are maintained separately by each module.
  db=await createDatabase();await fixture(db);
  await db.exec('begin read only;'+strip(fs.readFileSync(sql('preflight'),'utf8'))+'rollback;');checks.push('preflight executes against captured production function definitions');
  for(const [name,mutation] of [
   ['predecessor source body drift',"create or replace function public.finance_period_close_health(p_entity_id text default null,p_period text default null,p_data_environment text default 'production') returns jsonb language sql stable as $$select '{}'::jsonb$$"],
   ['predecessor anonymous authority drift',"grant execute on function public.finance_submit_bill_batch(text,jsonb,text) to anon"],
   ['predecessor ledger metadata drift',"update supabase_migrations.schema_migrations set name='unexpected' where version='20261010130000'"]
  ]){await db.exec('begin;'+mutation);await assert.rejects(()=>db.exec(strip(fs.readFileSync(sql('preflight'),'utf8'))),name);await db.exec('rollback');checks.push(name+' rejected before apply');}
  const fingerprint=strip(fs.readFileSync(sql('fingerprint'),'utf8')),before=(await db.query(fingerprint)).rows[0].fingerprint;
  await db.exec("begin;update supabase_migrations.schema_migrations set name='fingerprint_probe' where version='20261010130000';");assert.notEqual((await db.query(fingerprint)).rows[0].fingerprint,before);await db.exec('rollback');checks.push('rollback fingerprint covers migration-ledger source and metadata');
  await db.exec(fs.readFileSync(rehearsal,'utf8'));
  assert.equal((await db.query(fingerprint)).rows[0].fingerprint,before);
  assert.equal((await db.query('select count(*)::int n from supabase_migrations.schema_migrations')).rows[0].n,prior.length);
  checks.push('all five actual migrations and ledger entries roll back to identical schema fingerprint');
  // A mid-batch DDL failure must roll back previously created objects and ledger.
  await db.exec('begin;alter table storage.objects rename to objects_unavailable;');
  await assert.rejects(()=>db.exec(fs.readFileSync(apply,'utf8')),/objects|does not exist/);await db.exec('rollback');
  assert.equal((await db.query(fingerprint)).rows[0].fingerprint,before);assert.equal((await db.query('select count(*)::int n from supabase_migrations.schema_migrations')).rows[0].n,prior.length);
  checks.push('mid-batch dependency failure leaves no partial schema or migration ledger');
  await db.exec(fs.readFileSync(apply,'utf8'));await db.exec(fs.readFileSync(gate,'utf8'));await db.exec(canary);checks.push('actual atomic apply, exact postflight and metadata canary succeed');
  const postflightSource=fs.readFileSync(sql('postflight'),'utf8');
  const sealedSignatures=new Set([...postflightSource.matchAll(/\('(private\.[^']+\)|public\.[^']+\))','[a-f0-9]{32}',(?:true|false),'[isv]',array\[/g)].map(m=>m[1]));
  const catalogFunctions=(await db.query("select n.nspname||'.'||p.proname||'('||array_to_string(array(select format_type(t,null) from unnest(p.proargtypes) t),',')||')' signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('private','public')")).rows.map(r=>r.signature);
  assert.equal(sealedSignatures.size,61);assert.deepEqual([...sealedSignatures].sort(),catalogFunctions.sort());
  const sealedPrivateTables=(postflightSource.match(/\('private\.[^']+','[a-f0-9]{32}'\)/g)||[]).length,actualPrivateTables=(await db.query("select count(*)::int n from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relkind='r'")).rows[0].n;
  assert.equal(sealedPrivateTables,11);assert.equal(actualPrivateTables,sealedPrivateTables);const actualGuards=(await db.query("select count(*)::int n from pg_trigger where not tgisinternal")).rows[0].n;assert.equal(actualGuards,8);
  checks.push('all 61 actual functions, 11 private table definitions and 8 guards are sealed');

  const nativeHashes=JSON.parse(read('scripts/fixtures/finance_cloud_submission_live_sources_20261011.json')).limits.map(x=>x.signature);
  const hashes=(await db.query('select oid::regprocedure::text signature,md5(prosrc) hash from pg_proc where oid=any($1::regprocedure[]) order by 1',[nativeHashes])).rows;assert.equal(hashes.length,7);
  // Every class of important metadata corruption must fail closed.
  for(const [name,mutation]of [
   ['new RPC grant to anon',"grant execute on function public.finance_monthly_delivery_snapshot_v1(text,text,text) to anon"],
   ['private table grant',"grant select on private.finance_monthly_delivery_receipts_v1 to authenticated"],
   ['private table RLS disabled',"alter table private.finance_cloud_drafts_v1 disable row level security"],
   ['guard trigger disabled',"alter table public.ledger_entries disable trigger finance_asset_atomic_ledger_v1"],
   ['function timeout drift',"alter function public.finance_cloud_submission_commit_v1(uuid,bigint,text,text) set statement_timeout='5s'"],
   ['function body drift',"create or replace function public.finance_period_close_health(p_entity_id text default null,p_period text default null,p_data_environment text default 'production') returns jsonb language sql stable as $$select '{}'::jsonb$$"],
   ['new RPC owner drift',"alter function public.finance_operations_read_v1(text) owner to authenticated"],
   ['cash evidence helper definer drift',"alter function private.finance_monthly_cash_evidence_v1(uuid,text,text,text) security invoker"],
   ['private table column grant',"grant select(manifest_sha256) on private.finance_monthly_delivery_receipts_v1 to authenticated"],
   ['private table policy drift',"create policy unexpected on private.finance_cloud_drafts_v1 for select to authenticated using(true)"],
   ['migration ledger extra source slot',"update supabase_migrations.schema_migrations set statements=array_append(statements,'-- unexpected') where version='20261011133834'"],
   ['cash evidence helper private grant',"grant execute on function private.finance_monthly_cash_evidence_v1(uuid,text,text,text) to authenticated"],
   ['private table column drift',"alter table private.finance_operation_samples_v1 add column unexpected text"],
   ['private table constraint drift',"alter table private.finance_monthly_delivery_receipts_v1 drop constraint finance_monthly_delivery_receipts_v1_pkey"],
   ['private table index drift',"drop index private.finance_cloud_drafts_owner_v1"],
   ['trigger timing drift',"drop trigger finance_month_snapshot_immutable_v1 on private.finance_month_snapshots_v1;create trigger finance_month_snapshot_immutable_v1 after update or delete on private.finance_month_snapshots_v1 for each row execute function private.finance_month_immutable_v1()"],
   ['migration ledger source drift',"update supabase_migrations.schema_migrations set statements=array['-- changed'] where version='20261011133834'"],
   ['migration ledger creator drift',"update supabase_migrations.schema_migrations set created_by='manual' where version='20261011133834'"],
   ['migration ledger name drift',"update supabase_migrations.schema_migrations set name='unexpected' where version='20261011133834'"],
   ['migration ledger omission',"delete from supabase_migrations.schema_migrations where version='20261011133834'"]
  ]){await db.exec('begin;savepoint negative;'+mutation);await assert.rejects(()=>db.exec(strip(fs.readFileSync(sql('postflight'),'utf8'))),name);await db.exec('rollback');checks.push(name+' rejected');}
  await db.exec('begin;delete from supabase_migrations.schema_migrations where version=$$20261011135523$$');await assert.rejects(()=>db.exec(canary));await db.exec('rollback');checks.push('direct canary rejects incomplete migration ledger');
  fs.writeFileSync(ledger,[...prior,...guard.FINANCE_COMPLETION_MIGRATIONS].join('\n')+'\n');assert.equal(guard.classifyLedger(ledger,dir,phase,versions,baseline),'applied');assert.throws(()=>guard.verifyLedger('pre',ledger,dir,phase,versions,baseline));guard.verifyLedger('post',ledger,dir,phase,versions,baseline);checks.push('completed batch only permits recovery verification');
  const evidence={ok:true,sealedFunctions:61,sealedPrivateTables:11,sealedGuards:8,engine:(await db.query('show server_version')).rows[0].server_version,scope:'isolated PostgreSQL catalog fixtures plus all five actual migration bodies; no production rows or live writes',checks,downstreamHashes:hashes,migrations:batch.map(x=>({version:x.version,sha256:crypto.createHash('sha256').update(x.source).digest('hex')}))};
  if(process.env.FINANCE_COMPLETION_RELEASE_EVIDENCE)fs.writeFileSync(process.env.FINANCE_COMPLETION_RELEASE_EVIDENCE,JSON.stringify(evidence,null,2));
  console.log('PASS '+checks.length+' finance completion release batch checks');
 }finally{if(db)await db.close();fs.rmSync(temp,{recursive:true,force:true});}
}
if(require.main===module)main().catch(e=>{console.error(e.message,e.cause||'');process.exitCode=1;});
module.exports={fixture,main};
