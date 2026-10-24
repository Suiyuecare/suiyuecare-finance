// Actual sealed portal handoff migration, rehearsal/apply renderer and read-only
// gates, then the consume/finalize behavior. Local synthetic PostgreSQL only.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {PGlite} from '@electric-sql/pglite';
import guard from './finance_production_release_guard.js';
const db=new PGlite(),dir=await fs.mkdtemp(path.join(os.tmpdir(),'finance-portal-handoff-release-'));
const root=path.resolve(import.meta.dirname,'..'),migrationDir=path.join(root,'supabase/migrations');
const phase=guard.RELEASE_PHASE_DATABASE_PORTAL_HANDOFF,versions=guard.PORTAL_HANDOFF_MIGRATIONS.join(',');
const prior=['00000000000001',...guard.REVIEWED_MIGRATION_CATALOG.filter(v=>v<versions).sort()];
const baseline={count:1,lastVersion:prior[0],sha256:guard.ledgerSha256([prior[0]])};
let checks=0,serial=0;const eq=(a,b,m)=>{assert.deepEqual(a,b,m);checks++};
const rejects=async(fn,re)=>{await assert.rejects(fn,re);checks++};
const gate=name=>path.join(root,'scripts','finance_portal_handoff_'+name+'.sql');
const readGate=async name=>(await fs.readFile(gate(name),'utf8')).replace(/^\\set ON_ERROR_STOP on\r?\n/,'');
const member=crypto.randomUUID(),inactive=crypto.randomUUID(),unbound=crypto.randomUUID(),tenant=crypto.randomUUID();
const asService=async(sql,params=[])=>{await db.exec('begin;set local role service_role;');try{const r=await db.query(sql,params);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}};
const consume=claims=>asService('select public.finance_portal_handoff_consume($1::jsonb) v',[JSON.stringify(claims)]).then(r=>r.rows[0].v);
const finalize=payload=>asService('select public.finance_portal_handoff_finalize($1::jsonb) v',[JSON.stringify(payload)]).then(r=>r.rows[0].v);
const nowSeconds=async()=>Number((await db.query('select floor(extract(epoch from clock_timestamp()))::bigint n')).rows[0].n);
const claims=async(overrides={})=>{const iat=await nowSeconds();return{aud:'accounting',source:'logging-portal',email:'qa@suiyuecare.com',googleSubject:'synthetic-sub',jti:crypto.randomUUID(),iat,exp:iat+60,...overrides};};
try {
 // Reuse the existing synthetic Auth/Finance fixture, then the sealed predecessors.
 const original=await fs.readFile(path.join(root,'scripts/test_portal_session_logout.mjs'),'utf8');
 const setup=original.slice(original.indexOf('await db.exec(`create role anon'),original.indexOf("await db.exec(await readFile(new URL('../supabase/migrations"));
 await new(Object.getPrototypeOf(async function(){}).constructor)('db','readFile','base',setup.replaceAll('import.meta.url','base'))(db,fs.readFile,new URL('./test_portal_session_logout.mjs',import.meta.url));
 await db.exec(await fs.readFile(path.join(migrationDir,'20260927180201_finance_portal_session_logout.sql'),'utf8'));
 await db.exec('alter table auth.sessions add column created_at timestamptz default now();');
 await db.exec(await fs.readFile(path.join(migrationDir,'20261014123017_finance_bounded_global_logout.sql'),'utf8'));
 for(const[id,email,subject,active,link]of[[member,'qa@suiyuecare.com','synthetic-sub',true,'bound'],[inactive,'inactive@suiyuecare.com','inactive-sub',false,'bound'],[unbound,'unbound@suiyuecare.com','unbound-sub',true,'unbound']]){
  await db.query('insert into auth.users values($1,$2,now())',[id,email]);
  await db.query("insert into auth.identities values($1,$2,'google',$3,$4,now())",[crypto.randomUUID(),id,subject,{sub:subject,email,email_verified:true}]);
  await db.query('insert into finance_users(id,name,email,tenant_id,active,auth_user_id,google_link_status) values($1,$2,$3,$4,$5,$6,$7)',[email,'Synthetic',email,tenant,active,id,link]);
 }
 await db.exec('create schema supabase_migrations;create table supabase_migrations.schema_migrations(version text primary key,statements text[],name text,created_by text);');
 for(const version of prior)await db.query('insert into supabase_migrations.schema_migrations(version,name) values($1,$2)',[version,version==='20261014123017'?'finance_bounded_global_logout':'synthetic_prior_catalog']);
 const ledger=path.join(dir,'ledger.txt');await fs.writeFile(ledger,prior.join('\n')+'\n');
 const fingerprint=async()=>(await db.query(await readGate('fingerprint'))).rows[0].fingerprint;
 const initial=await fingerprint();
 const render=async kind=>{const out=path.join(dir,kind+'-'+serial+++'.sql');if(kind==='rehearsal')guard.preparePortalHandoffRehearsal(migrationDir,out,versions,ledger,gate('fingerprint'),gate('canary'),gate('preflight'),gate('postflight'),baseline);else guard.prepareAuditBatchApply(migrationDir,out,versions,ledger,gate('postflight'),baseline,phase);return fs.readFile(out,'utf8');};
 eq(guard.classifyLedger(ledger,migrationDir,phase,versions,baseline),'pending');

 // Missing prerequisite stops the preflight.
 await db.exec("begin;delete from supabase_migrations.schema_migrations where version='20261014123017';");
 await rejects(async()=>db.exec(await readGate('preflight')),/prerequisite is missing/);await db.exec('rollback');
 await db.exec(await readGate('preflight'));
 await db.exec(await render('rehearsal'));
 eq(await fingerprint(),initial,'rollback must preserve source, grants, ledger and Auth data');
 eq((await db.query("select to_regclass('portal_handoff_private.consumed') r")).rows[0].r,null);
 const apply=await render('apply');assert.match(apply,/begin;[\s\S]+pg_advisory_xact_lock[\s\S]+lock table supabase_migrations.schema_migrations[\s\S]+insert into supabase_migrations.schema_migrations[\s\S]+commit;/);checks++;
 await rejects(()=>db.exec(apply.replace("select 'FINANCE_PORTAL_HANDOFF_POSTFLIGHT_OK' as marker;",()=>"do $$begin raise exception 'synthetic_postflight_failure';end $$;")),/synthetic_postflight_failure/);await db.exec('rollback');
 eq((await db.query("select to_regclass('portal_handoff_private.consumed') r")).rows[0].r,null);
 eq(await fingerprint(),initial,'failed atomic apply leaves no schema, ledger or session change');
 await db.exec(apply);
 eq((await db.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1',[versions])).rows[0].n,1);
 await db.exec(await readGate('postflight'));
 const actual=await db.exec(await readGate('canary'));const result=path.join(dir,'canary.json');await fs.writeFile(result,JSON.stringify(actual));
 eq(guard.verifyReportsCanary(result,'portal_handoff'),true,'actual SQL marker must match release contract');
 await fs.writeFile(ledger,[...prior,versions].join('\n')+'\n');eq(guard.classifyLedger(ledger,migrationDir,phase,versions,baseline),'applied');
 await rejects(()=>db.exec(apply),/migration ledger changed/);await db.exec('rollback');

 // Behavior: exact identity, single use, no provisioning, logout fence.
 const good=await claims();
 eq(await consume(good),{userId:member,authEmail:'qa@suiyuecare.com'});
 eq(await finalize({jti:good.jti,userId:member}),true);
 await rejects(()=>consume(good),/FINANCE_PORTAL_HANDOFF_REPLAY/);
 eq(await finalize({jti:good.jti,userId:inactive}),false,'finalize is bound to the consumed user');
 eq(await finalize({jti:'not-a-uuid',userId:member}),false);
 for(const [label,overrides,error] of [
  ['wrong audience',{aud:'hr'},/INVALID/],['wrong source',{source:'other'},/INVALID/],
  ['long lived',async c=>({exp:c.iat+61}),/INVALID/],['expired',async c=>({iat:c.iat-120,exp:c.iat-60}),/INVALID/],
  ['future',async c=>({iat:c.iat+30,exp:c.iat+60}),/INVALID/],['foreign domain',{email:'qa@example.com'},/INVALID/],
  ['bad jti',{jti:'x'},/INVALID/],['wrong Google subject',{googleSubject:'other-sub'},/FORBIDDEN/],
  ['email of another member',{email:'unbound@suiyuecare.com'},/FORBIDDEN/],
  ['inactive member',{email:'inactive@suiyuecare.com',googleSubject:'inactive-sub'},/FORBIDDEN/],
  ['unbound member',{email:'unbound@suiyuecare.com',googleSubject:'unbound-sub'},/FORBIDDEN/],
  ['unknown person',{email:'nobody@suiyuecare.com',googleSubject:'nobody-sub'},/FORBIDDEN/]
 ]){
  const base=await claims();const patch=typeof overrides==='function'?await overrides(base):overrides;
  await rejects(()=>consume({...base,...patch}),error);
 }
 eq((await db.query('select count(*)::int n from auth.users')).rows[0].n,3,'no Auth account is provisioned');
 // A logout at or after the assertion second rejects it; a later assertion passes.
 const beforeLogout=await claims();
 await asService("select public.portal_revoke_google_sessions_v2($1,'synthetic-sub','qa@suiyuecare.com',clock_timestamp(),clock_timestamp()+interval '10 minutes')",[crypto.randomUUID()]);
 await rejects(()=>consume(beforeLogout),/FINANCE_PORTAL_HANDOFF_REVOKED/);
 eq(await finalize({jti:good.jti,userId:member}),false,'a logout during the exchange closes the consumed receipt');
 await db.exec("update logout_private.module_receipts set revoke_before=revoke_before-interval '2 seconds'");
 const afterLogout=await claims();
 eq((await consume(afterLogout)).userId,member,'a fresh assertion after logout succeeds');
 await db.exec("update finance_users set active=false where auth_user_id='"+member+"'");
 eq(await finalize({jti:afterLogout.jti,userId:member}),false,'membership removed during exchange is caught');
 await db.exec("update finance_users set active=true where auth_user_id='"+member+"'");

 // Browser roles can never reach the receipts or RPCs.
 for(const role of ['authenticated','anon']){
  for(const sql of ["select public.finance_portal_handoff_consume('{}'::jsonb)","select public.finance_portal_handoff_finalize('{}'::jsonb)","select * from portal_handoff_private.consumed"]){
   await db.exec('begin;set local role '+role+';');await rejects(()=>db.query(sql),/permission denied/);await db.exec('rollback');
  }
 }
 const installed=await fingerprint();
 for(const [drift,re] of [
  ['grant execute on function public.finance_portal_handoff_consume(jsonb) to authenticated',/authority\/source drift/],
  ['alter table portal_handoff_private.consumed disable row level security',/private receipt authority drift/],
  ['grant usage on schema portal_handoff_private to authenticated',/private receipt authority drift/],
  ["update supabase_migrations.schema_migrations set statements=array['tampered'] where version='20261024210000'",/sealed ledger/]
 ]){
  await db.exec('begin;'+drift+';');await rejects(async()=>db.exec(await readGate('postflight')),re);await db.exec('rollback');
  eq(await fingerprint(),installed,'postflight drift probe rolled back');
 }
 console.log(JSON.stringify({verified:true,checks,phase,version:versions,engine:'PGlite',atomicLedger:true,rollbackProven:true,accountsProvisioned:false,productionDataTouched:false}));
} finally {await db.close();await fs.rm(dir,{recursive:true,force:true});}
