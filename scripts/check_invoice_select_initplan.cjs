'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const {createStatementSourceFixture,asActor,tenant,otherTenant}=require('./fixtures/finance_statement_source_fixture.cjs');
const root=path.resolve(__dirname,'..');
const migrationPath='supabase/migrations/20260915080928_finance_invoice_select_accounting_initplan_v1.sql';
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const migration=()=>read(migrationPath);
const postflight=()=>read('scripts/finance_invoice_select_initplan_postflight.sql').replace(/^\\set ON_ERROR_STOP on\r?\n/,'');
const canary=()=>read('scripts/finance_invoice_select_initplan_canary.sql');
let checks=0;
const equal=(a,b,label)=>{assert.deepEqual(a,b,label);checks++;};
const check=(a,label)=>{assert.ok(a,label);checks++;};
async function rejects(fn,code,label){await assert.rejects(fn,e=>e.code===code,label);checks++;}
async function createFixture(db){
 const fixture=await createStatementSourceFixture(db);
 await db.exec(`alter policy invoices_select_fixture on public.invoices rename to invoices_select_scoped;
  alter table public.invoices force row level security;
  grant all on public.invoices to authenticated,anon,service_role;
  create policy unchanged_invoice_insert on public.invoices for insert to authenticated with check(false);
  create policy unchanged_invoice_update on public.invoices for update to authenticated using(false) with check(false);
  create policy unchanged_invoice_delete on public.invoices for delete to authenticated using(false);`);
 await db.query(`insert into public.invoices(id,tenant_id,data_environment,department_code,applicant_id,steps)
  values ('13-null-fields',$1,'production',null,null,null),('14-null-environment',$1,null,null,null,'[]'),('15-null-tenant',null,'production',null,null,'[]')`,[tenant]);
 const actor={id:'fictional-foreign-accountant',uid:'10000000-0000-0000-0000-000000000099',email:'fixture-foreign@suiyuecare.com',name:'Fictional foreign accountant'};
 await db.query('insert into auth.users values($1)',[actor.uid]);
 await db.query(`insert into auth.identities(user_id,provider,identity_data) values($1,'google',$2)`,[actor.uid,JSON.stringify({email:actor.email,email_verified:true})]);
 await db.query(`insert into public.finance_users(id,tenant_id,auth_user_id,email,name,role,department_code) values($1,$2,$3,$4,$5,'accountant','D2')`,[actor.id,otherTenant,actor.uid,actor.email,actor.name]);
 await db.query(`insert into public.tenant_members(tenant_id,auth_user_id,email,active) values($1,$2,$3,true)`,[otherTenant,actor.uid,actor.email]);
 fixture.actors.foreign=actor;return fixture;
}
async function catalog(db){
 return (await db.query(`select jsonb_build_object(
  'functions',(select jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'source',p.prosrc,'owner',p.proowner,'acl',p.proacl,'config',p.proconfig,'definer',p.prosecdef,'volatility',p.provolatile) order by p.oid) from pg_proc p where p.pronamespace in('public'::regnamespace,'auth'::regnamespace)),
  'relations',(select jsonb_agg(jsonb_build_object('name',c.relname,'owner',c.relowner,'acl',c.relacl,'rls',c.relrowsecurity,'force',c.relforcerowsecurity) order by c.oid) from pg_class c where c.relnamespace in('public'::regnamespace,'auth'::regnamespace)),
  'other_policies',(select jsonb_agg(to_jsonb(p) order by oid) from pg_policy p where polname<>'invoices_select_scoped'),
  'roles',(select jsonb_agg(to_jsonb(r) order by oid) from pg_roles r)) as value`)).rows[0].value;
}
async function policy(db){return (await db.query(`select pg_get_expr(polqual,polrelid) as expression,polcmd,polroles,polpermissive,polwithcheck from pg_policy where polrelid='public.invoices'::regclass and polname='invoices_select_scoped'`)).rows[0];}
async function dataFingerprint(db){
 const parts=[];for(const table of ['public.invoices','public.expense_requests','public.bills','public.finance_users','public.tenant_members','auth.users','auth.identities'])parts.push((await db.query(`select md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' order by to_jsonb(t)::text),'')) as hash from ${table} t`)).rows[0].hash);return parts;
}
async function snapshot(db,test){
 await db.exec('begin');
 try{
  if(test.setup)await test.setup(db,test.actor);
  await db.query(`select set_config('request.jwt.claim.sub',$1,true),set_config('app.current_tenant_id',$2,true)`,[test.actor?.uid||'',test.requestedTenant||'']);
  await db.exec('set local role authenticated');
  const direct=(await db.query('select to_jsonb(i) as row from public.invoices i order by id')).rows.map(r=>r.row);
  const pages={};
  for(const environment of ['production','test']){
   await db.exec('savepoint source_read');
   try{
    let total=null,offset=0,more=true;const rows=[];
    while(more){
     const page=(await db.query('select public.finance_statement_source_page_v1($1,$2,3,$3) as value',['invoices',environment,offset])).rows[0].value;
     if(total===null)total=page.total;assert.equal(page.total,total);assert.equal(page.offset,offset);assert.equal(page.limit,3);
     rows.push(...page.rows);more=page.hasMore;offset+=3;assert(offset<100,'small equivalence fixture stays bounded');
    }
    pages[environment]={total,rows};
   }catch(error){await db.exec('rollback to savepoint source_read');if(error.code!=='42501')throw error;pages[environment]={denied:'42501'};}
  }
  return{direct,pages};
 }finally{await db.exec('rollback');}
}
function cases(actors){
 const result=Object.entries(actors).map(([name,actor])=>({name,actor}));
 result.push({name:'missing-auth',actor:null},{name:'foreign-tenant-request',actor:actors.ceo,requestedTenant:otherTenant},{name:'foreign-actor-main-tenant-request',actor:actors.foreign,requestedTenant:tenant});
 const changes=[
  ['disabled-finance-user',`update public.finance_users set active=false where auth_user_id=$1`,false],
  ['unbound-finance-user',`update public.finance_users set google_link_status='unbound' where auth_user_id=$1`,false],
  ['missing-google-identity',`delete from auth.identities where user_id=$1`,false],
  ['non-google-provider',`update auth.identities set provider='email' where user_id=$1`,false],
  ['unverified-google',`update auth.identities set identity_data=jsonb_set(identity_data,'{email_verified}','false') where user_id=$1`,false],
  ['google-foreign-domain',`update auth.identities set identity_data=jsonb_set(identity_data,'{email}','"fixture@example.invalid"') where user_id=$1`,false],
  ['google-finance-email-mismatch',`update auth.identities set identity_data=jsonb_set(identity_data,'{email}','"different@suiyuecare.com"') where user_id=$1`,false],
  ['missing-auth-user',`delete from auth.users where id=$1`,false],
  ['disabled-membership-and-finance-user',`update public.tenant_members set active=false where auth_user_id=$1;update public.finance_users set active=false where auth_user_id=$1`,false],
  // The current server intentionally falls back to a valid active finance
  // binding if the membership row is missing/inactive. Preserve that behavior.
  ['disabled-membership-valid-finance-fallback',`update public.tenant_members set active=false where auth_user_id=$1`,true],
  ['missing-membership-valid-finance-fallback',`delete from public.tenant_members where auth_user_id=$1`,true],
  ['pending-rebind-valid-google',`update public.finance_users set google_link_status='pending_rebind' where auth_user_id=$1`,true],
  ['verified-google-1',`update auth.identities set identity_data=jsonb_set(identity_data,'{email_verified}','"1"') where user_id=$1`,true]
 ];
 for(const role of ['ceo','admin_director','accountant'])for(const [name,sql,allowed] of changes)result.push({name:role+'/'+name,actor:actors[role],expectedAllowed:allowed,setup:async(db,actor)=>{for(const statement of sql.split(';'))await db.query(statement,[actor.uid]);}});
 return result;
}
function walk(plan){return[plan,...(plan.Plans||[]).flatMap(walk)];}
async function explain(db,actor){
 return asActor(db,actor,async()=>{
  const query=`with visible as materialized(select i.* from public.invoices i where tenant_id=$1 and data_environment='production'),page as(select * from visible order by id limit 1000)
   select (select jsonb_agg(to_jsonb(page) order by page.id) from page),(select count(*) from visible)`;
  return (await db.query('explain (analyze,verbose,buffers,format json) '+query,[tenant])).rows[0]['QUERY PLAN'][0];
 });
}
async function inTransaction(db,work){await db.exec('begin');try{return await work();}finally{await db.exec('rollback');}}
async function bulkFingerprint(db,actor,{old=false}={}){
 return inTransaction(db,async()=>{
  if(old)await db.exec(`alter policy invoices_select_scoped on public.invoices using (tenant_id=public.current_tenant_id() and public.can_read_invoice(invoices.*))`);
  await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('app.current_tenant_id','',true)",[actor.uid]);
  await db.exec('set local role authenticated');
  return (await db.query("select count(*)::integer as count,md5(string_agg(to_jsonb(i)::text,E'\\n' order by id)) as content_hash from public.invoices i where data_environment='production'")).rows[0];
 });
}
async function main({db=new PGlite()}={}){
 try{
  const {actors}=await createFixture(db),matrix=cases(actors),beforeCatalog=await catalog(db),beforeData=await dataFingerprint(db),oldPolicy=await policy(db),oracle=new Map();
  for(const test of matrix){const actual=await snapshot(db,test);oracle.set(test.name,actual);if(test.expectedAllowed!==undefined)equal(actual.direct.length>0,test.expectedAllowed,test.name+': actual identity prerequisite expectation');}
  equal(oracle.get('employee').direct.map(r=>r.id),['01-own','04-participant','06-action','10-test'],'ordinary invoice applicant/participant exact independent expectation');
  equal(oracle.get('ceo').pages.production.total,11,'accounting source count includes real NULL-field row');
  equal(oracle.get('ceo').direct.filter(r=>r.data_environment===null).map(r=>r.id),['14-null-environment'],'direct RLS retains old NULL environment semantics; RPC remains explicit');
  equal(oracle.get('foreign').direct.map(r=>r.id),['11-other-tenant'],'foreign valid identity only sees its own tenant');
  for(const name of ['inactive','unverified','missing-auth','foreign-tenant-request','foreign-actor-main-tenant-request'])equal(oracle.get(name).direct,[],name+': denied by the actual original authority');
  await db.exec('begin');await db.exec(migration());await db.exec('rollback');
  equal(await policy(db),oldPolicy,'migration rehearsal rollback restores exact old SELECT policy');equal(await catalog(db),beforeCatalog,'rehearsal rollback preserves all functions/grants/roles/policies');equal(await dataFingerprint(db),beforeData,'rehearsal rollback preserves all source and identity rows');
  for(const [label,mutation] of [
   ['missing policy','drop policy invoices_select_scoped on public.invoices'],
   ['changed old predicate','alter policy invoices_select_scoped on public.invoices using(true)'],
   ['missing old predicate','drop policy invoices_select_scoped on public.invoices;create policy invoices_select_scoped on public.invoices for select to authenticated'],
   ['extra select policy','create policy unexpected_select on public.invoices for select to authenticated using(true)'],
   ['different grantees','alter policy invoices_select_scoped on public.invoices to authenticated,anon'],
   ['disabled forced RLS','alter table public.invoices no force row level security'],
   ['disabled RLS','alter table public.invoices disable row level security'],
   ['changed identity function',`create or replace function public.is_finance_accounting() returns boolean language sql stable as $$select true$$`],
   ['definer source RPC','alter function public.finance_statement_source_page_v1(text,text,integer,integer) security definer']
  ])await inTransaction(db,async()=>{await db.exec(mutation);await rejects(()=>db.exec(migration()),'P0001',label+': pre-mutation guard refuses unsupported baseline');});
  await db.exec(migration());await db.exec(postflight());
  const canaryBefore={catalog:await catalog(db),data:await dataFingerprint(db),policy:await policy(db)};
  const canaryResults=await db.exec(canary());
  equal(canaryResults.at(-1).rows[0].invoice_select_initplan_canary_result,{canary:'readonly_invoice_select_initplan_v1',ok:true,rolled_back:true,ordinary_scope_preserved:true},'actual read-only canary succeeds without an employee identity');
  equal({catalog:await catalog(db),data:await dataFingerprint(db),policy:await policy(db)},canaryBefore,'complete canary transaction and rollback leave all policy/source/auth catalog unchanged');
  await db.exec('set search_path=pg_catalog');
  try{const restricted=await db.exec(canary());equal(restricted.at(-1).rows[0].invoice_select_initplan_canary_result.ok,true,'canary also verifies sealed policy when public is absent from caller search_path');}
  finally{await db.exec('reset search_path');}
  equal(await catalog(db),beforeCatalog,'installed optimization changes no existing function body/ACL, role, relation privilege or other policy');equal(await dataFingerprint(db),beforeData,'installed optimization changes no business/authentication data');
  for(const test of matrix)equal(await snapshot(db,test),oracle.get(test.name),test.name+': every source byte/count/page equals original predicate');
  for(const [label,mutation] of [
   ['unconditional allow','alter policy invoices_select_scoped on public.invoices using(true)'],
   ['missing optimized predicate','drop policy invoices_select_scoped on public.invoices;create policy invoices_select_scoped on public.invoices for select to authenticated'],
   ['narrowed predicate','alter policy invoices_select_scoped on public.invoices using(false)'],
   ['anonymous policy access','alter policy invoices_select_scoped on public.invoices to authenticated,anon'],
   ['added select bypass','create policy additional_read on public.invoices for select to authenticated using(true)'],
   ['forced RLS lost','alter table public.invoices no force row level security'],
   ['ordinary helper changed',`create or replace function public.can_read_invoice(p_invoice public.invoices) returns boolean language sql stable as $$select true$$`],
   ['anonymous source grant','grant execute on function public.finance_statement_source_page_v1(text,text,integer,integer) to anon'],
   ['service source grant','grant execute on function public.finance_statement_source_page_v1(text,text,integer,integer) to service_role']
  ])await inTransaction(db,async()=>{await db.exec(mutation);await rejects(()=>db.exec(postflight()),'P0001',label+': independent postflight fails closed');});
  await inTransaction(db,async()=>{await rejects(()=>db.exec(migration()),'P0001','duplicate application must use installed-prefix release handling');});
  for(const role of ['anon','service_role'])await inTransaction(db,async()=>{await db.exec('set local role '+role);if(role==='anon')equal((await db.query('select id from public.invoices')).rows,[],'anon: unchanged table ACL still has no RLS-visible rows');await rejects(()=>db.query("select public.finance_statement_source_page_v1('invoices','production',3,0)"),'42501',role+': source RPC remains unavailable');});
  await db.query(`insert into public.invoices(id,tenant_id,data_environment,amount,files) select 'bulk-'||lpad(n::text,4,'0'),$1,'production',n,jsonb_build_array(jsonb_build_object('description',repeat('虛構測試附件內容',300))) from generate_series(1,1003)n`,[tenant]);
  const plans=[];
  for(const role of ['ceo','admin_director','accountant']){
   const plan=await explain(db,actors[role]),nodes=walk(plan.Plan),initializers=nodes.filter(n=>n['Parent Relationship']==='InitPlan'&&n['Node Type']==='Result'&&(n.Output||[]).some(x=>/current_tenant_id\(|is_finance_accounting\(|finance_current_verified_google_email_v2\(/.test(x)));
   equal(initializers.length,3,role+': actual EXPLAIN exposes exactly three identity InitPlans');check(initializers.every(n=>n['Actual Loops']===1),role+': identity InitPlans execute once despite >1000 rows');
   check(nodes.some(n=>n['Relation Name']==='invoices'&&n['Actual Rows']>=1000),role+': plan really scans large actual-authority fixture');
   const original=await bulkFingerprint(db,actors[role],{old:true}),optimized=await bulkFingerprint(db,actors[role]);
   equal(optimized,original,role+': all bulk rows and complete content match execution under the exact original policy');
   equal(optimized.count,1014,role+': independent bulk count includes all 1003 extra rows and 11 original production rows');
   plans.push({role,rows:nodes.find(n=>n['Relation Name']==='invoices')['Actual Rows'],initializerLoops:initializers.map(n=>n['Actual Loops']),executionMs:plan['Execution Time']});
  }
  await db.exec(postflight());checks++;
  console.log(JSON.stringify({ok:true,checks,equivalenceCases:matrix.length,plans,authority:'Actual deployed identity and invoice authorization function bodies; fictional Google identities, finance users and tenant memberships',productionWrites:0}));
 }finally{await db.close();}
}
async function createInvoiceSelectInitplanFixture(db,{install=false}={}){
 const fixture=await createFixture(db);if(install)await db.exec(migration());return fixture;
}
module.exports={main,createFixture,createInvoiceSelectInitplanFixture,snapshot,cases,migrationPath,migration,postflight,canary,explain,bulkFingerprint};
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1;});
