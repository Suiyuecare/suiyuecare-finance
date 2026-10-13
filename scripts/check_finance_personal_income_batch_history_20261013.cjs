#!/usr/bin/env node
'use strict';
// Actual public RPCs and current identity-once helper in disposable PostgreSQL.
// Fictional people/documents only. No business writers or formal sessions.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');
const {Client}=require('pg');
const {createSummarySearchFixture,addSummarySearchDocument,fixtureIdentity:who}=require('./check_approval_history_summary.cjs');
const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const migrationPath='supabase/migrations/20261013091838_finance_personal_income_batch_history_v1.sql';
const migration=read(migrationPath);
const identityMigration=read('supabase/migrations/20261012112652_finance_personal_history_identity_once_v1.sql');
const strip=sql=>sql.replace(/^\\set ON_ERROR_STOP on\r?\n/,'');
const nativePath=process.env.FINANCE_HISTORY_NATIVE_PG_CONFIG||process.env.FINANCE_NATIVE_PG_CONFIG;
if(process.env.FINANCE_HISTORY_NATIVE_REQUIRED==='1'&&!nativePath)
  throw Error('Native income batch history proof is required, but no private PostgreSQL config was supplied');
const nativeConfig=nativePath?JSON.parse(fs.readFileSync(path.resolve(nativePath),'utf8')):null;
if(nativeConfig&&!['127.0.0.1','::1','localhost'].includes(nativeConfig.host))
  throw Error('Income batch history fixtures may only connect to loopback disposable PostgreSQL');
const authorities=JSON.parse(read('scripts/fixtures/finance_history_identity_authorities_20261012.json'));
const output=process.argv[2]?path.resolve(process.argv[2]):fs.mkdtempSync(path.join(os.tmpdir(),'finance-income-batch-sql-'));
const uid=who.authUserId,sid='00000000-0000-0000-0000-000000000021',email='history.fixture@suiyuecare.com';
const databaseName='finance_income_batch_'+crypto.randomUUID().replaceAll('-','');
const evidence={scope:'Disposable local PostgreSQL, actual source-pinned RPCs/identity authority, fictional records only',migration:migrationPath,checks:[]};
const check=name=>{evidence.checks.push(name);console.log('PASS '+name);};
const sortedIds=item=>item.source_ids.slice().sort();
const counts=item=>{
  const value=item.summary.approval_status_counts;
  assert.equal(typeof value,'object');assert(value&&!Array.isArray(value));
  assert(Object.keys(value).length>0);
  assert(Object.values(value).every(n=>Number.isSafeInteger(n)&&n>0));
  assert.equal(Object.values(value).reduce((a,b)=>a+b,0),item.source_count);
  assert.equal(item.summary.approval_status,Object.keys(value).length===1?Object.keys(value)[0]:'mixed');
  return value;
};
async function main(){
 let admin,client,pglite,db,createdDatabase=false;
 const summary=async(scope='all',limit=50,offset=0,search=null,env='test')=>(await db.query(
   'select public.finance_personal_document_summary_v1($1,$2,$3,$4,$5) result',[scope,limit,offset,search,env])).rows[0].result;
 const detail=async(key,env='test')=>(await db.query(
   'select public.finance_personal_document_detail_v1($1,$2) result',[key,env])).rows[0].result;
 const authority=async()=>(await db.query(`select n.nspname||'.'||p.proname as name,
   md5(p.prosrc) as source_md5,p.proowner,p.proacl,p.proconfig,p.provolatile,p.prosecdef
   from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where p.oid in (
     'private.finance_personal_document_authorized_v1(public.finance_users,text,text,text)'::regprocedure,
     'private.finance_history_actor_v1()'::regprocedure,
     'private.finance_personal_history_page_allows_v1(public.finance_users)'::regprocedure,
     'public.finance_personal_document_summary_v1(text,integer,integer,text,text)'::regprocedure,
     'public.finance_personal_document_detail_v1(text,text)'::regprocedure)
   order by name`)).rows;
 const businessFingerprint=async()=>(await db.query(`select md5(jsonb_build_object(
   'users',(select jsonb_agg(to_jsonb(x) order by id) from public.finance_users x),
   'identities',(select jsonb_agg(to_jsonb(x) order by id) from auth.identities x),
   'sessions',(select jsonb_agg(to_jsonb(x) order by id) from auth.sessions x),
   'members',(select jsonb_agg(to_jsonb(x) order by auth_user_id,tenant_id) from public.tenant_members x),
   'expenses',(select jsonb_agg(to_jsonb(x) order by id) from public.expense_requests x),
   'bills',(select jsonb_agg(to_jsonb(x) order by id) from public.bills x),
   'invoices',(select jsonb_agg(to_jsonb(x) order by id) from public.invoices x),
   'snapshots',(select jsonb_agg(to_jsonb(x) order by tenant_id,data_environment,record_type,record_id,step_index) from public.approval_step_actor_snapshots x),
   'projection',(select jsonb_agg(to_jsonb(x) order by tenant_id,data_environment,record_type,source_id) from private.finance_history_source_projection_v1 x),
   'groups',(select jsonb_agg(to_jsonb(x) order by tenant_id,data_environment,record_type,group_key) from private.finance_history_group_projection_v1 x)
 )::text) fingerprint`)).rows[0].fingerprint;
 const add=async(table,id,options={})=>addSummarySearchDocument(db,{table,id,description:'同一事由 愛無限課程',...options});
 const applyToSelf=async(table,id)=>db.query('update public.'+table+' set applicant_id=$1 where id=$2',['FICT-USER',id]);
 const denied=async(name,sql,call)=>{
   await db.exec('begin;');
   try{await db.exec(sql);await assert.rejects(call,e=>e.code==='42501');}
   finally{await db.exec('rollback;');}
   check(name);
 };
 try{
 if(nativeConfig){
   admin=new Client(nativeConfig);await admin.connect();
   for(const role of ['anon','authenticated','service_role'])
     assert((await admin.query('select 1 from pg_roles where rolname=$1',[role])).rowCount,
       'Native fixture role must already exist in the explicitly configured test service: '+role);
   await admin.query('create database '+databaseName);createdDatabase=true;
   client=new Client({...nativeConfig,database:databaseName});await client.connect();
   db={query:(sql,args)=>client.query(sql,args),
     exec:sql=>client.query(sql.replace(/create role (anon|authenticated|service_role);/g,''))};
   evidence.engine='native PostgreSQL';
 }else{pglite=new PGlite();db=pglite;evidence.engine='PGlite';}
  await createSummarySearchFixture(db);
  await db.exec(`
    alter table public.finance_users add column name text,add column role text default 'employee',
      add column google_link_status text default 'bound',add column created_at timestamptz default now();
    alter table public.tenant_members add column id uuid default gen_random_uuid(),add column email text,
      add column created_at timestamptz default now();
    create table public.system_settings(tenant_id uuid,key text,value jsonb);
    create table auth.users(id uuid primary key);
    create table auth.identities(id uuid primary key default gen_random_uuid(),user_id uuid,
      provider text,identity_data jsonb,created_at timestamptz default now());
    create table auth.sessions(id uuid primary key,user_id uuid,not_after timestamptz);
    create function auth.jwt() returns jsonb language sql stable as
      $$select jsonb_build_object('session_id',nullif(current_setting('fixture.sid',true),''))$$;
    create function public.default_tenant_id() returns uuid language sql stable as
      $$select '${who.tenantId}'::uuid$$;
    alter table public.expense_requests add column applicant_id text,add column applicant_email text;
    alter table public.bills add column applicant_id text,add column applicant_email text;
    alter table public.invoices add column applicant_id text;
    alter table public.approval_step_actor_snapshots add column raw_step jsonb;
    update public.finance_users set name='虛構本人',email='${email}' where id='FICT-USER';
    update public.tenant_members set email='${email}';
    insert into auth.users values('${uid}');
    insert into auth.identities(user_id,provider,identity_data)
      values('${uid}','google','{"email":"${email}","email_verified":true}');
    insert into auth.sessions values('${sid}','${uid}',null);
    select set_config('fixture.sid','${sid}',false);
    create schema supabase_migrations;
    create table supabase_migrations.schema_migrations(version text primary key,name text,statements text[],created_by text);
    insert into supabase_migrations.schema_migrations(version,name) values
      ('20261008055528','finance_personal_document_history_v1'),
      ('20261008090000','finance_personal_history_permission_guard_v1'),
      ('20261010130000','finance_personal_invoice_batch_history_v1');
  `);
  await db.exec(read('scripts/fixtures/finance_procurement_payment_helpers_20260908.sql')
    .match(/CREATE OR REPLACE FUNCTION private\.finance_expense_optional_permission_allows\([\s\S]*?\$function\$;/)[0]);
  for(const name of ['finance_verified_google_email','finance_auth_session_active','current_tenant_id',
    'current_finance_user','current_finance_user_id','finance_current_verified_google_email_v2',
    'finance_legacy_name_matches_current_v1','finance_identity_matches_current_v1',
    'private.finance_personal_history_page_allows_v1','private.finance_history_actor_v1',
    'private.finance_personal_document_authorized_v1','finance_personal_document_summary_v1',
    'finance_personal_document_detail_v1']){
    const row=authorities.find(x=>x.signature.startsWith(name+'('));assert(row,'source-pinned authority '+name);
    await db.exec(row.definition);
  }
  for(const signature of authorities.filter(x=>/finance_personal_document_|finance_history_actor_v1|finance_personal_history_page_allows_v1/.test(x.signature)).map(x=>x.signature)){
    await db.exec('revoke all on function '+signature+' from public,anon,authenticated,service_role;');
    if(signature.startsWith('finance_personal_document_summary_v1')||signature.startsWith('finance_personal_document_detail_v1'))
      await db.exec('grant execute on function '+signature+' to authenticated;');
  }
  await db.exec('begin;'+identityMigration+"\ninsert into supabase_migrations.schema_migrations(version,name) values('20261012112652','finance_personal_history_identity_once_v1');commit;");
  const beforeAuthority=await authority();
  assert.equal(beforeAuthority.find(x=>x.name==='private.finance_personal_document_authorized_v1').source_md5,'1db71550a2ec13ece520e25abb211e09');
  await db.exec(strip(read('scripts/finance_personal_history_identity_once_postflight.sql')));
  await db.exec(strip(read('scripts/finance_personal_history_postflight.sql')));
  await db.exec(strip(read('scripts/finance_personal_income_batch_history_preflight.sql')));
  check('exact current identity-once migration and source/ACL baseline installed');

  for(let n=1;n<=4;n++){
    await add('bills','B-A-'+n,{batch:'BILLB-FICTION-4',amount:n*10,participant:false,
      description:n===4?'愛無限 最後一位繳費者':'同一事由 愛無限課程'});
    await applyToSelf('bills','B-A-'+n);
  }
  await db.exec("update public.bills set approval_status='completed' where id='B-A-1';"+
    "update public.bills set approval_status='pending_section_chief' where id in ('B-A-2','B-A-3');"+
    "update public.bills set approval_status='rejected' where id='B-A-4';");
  for(const id of ['B-B-1','B-B-2'])await add('bills',id,{batch:'BILLB-OTHER-SUBMISSION',amount:8});
  for(const id of ['I-A-1','I-A-2']){await add('invoices',id,{batch:'BILLB-FICTION-4',amount:50,total:52});await applyToSelf('invoices',id);}
  await db.exec("update public.invoices set approval_status='pending_accountant_invoice' where id='I-A-2'");
  await add('bills','B-SECRET',{batch:'BILLB-FICTION-4',participant:false,amount:99999,description:'SECRET-UNAUTHORIZED'});
  await add('bills','B-FOREIGN',{batch:'BILLB-FICTION-4',tenantId:who.otherTenantId,amount:99999,description:'SECRET-FOREIGN'});
  await add('bills','B-PRODUCTION',{batch:'BILLB-FICTION-4',environment:'production',amount:99999,description:'SECRET-OTHER-ENV'});
  await add('bills','B-ASSIGNED',{batch:'BILLB-FICTION-4',acted:false,amount:99999,description:'SECRET-ASSIGNED-ONLY'});
  await add('bills','B-SINGLE',{amount:7});
  await add('bills','B-NULL',{amount:null,batch:'NULL-AMOUNT'});
  await add('bills','B-ZERO',{amount:0,batch:'ZERO-AMOUNT'});
  await add('bills','B-FALLBACK',{amount:3});
  await db.exec("update public.bills set approval_status='  ',status='unpaid' where id='B-FALLBACK';"+
    "update public.bills set approval_status=null,status=null where id='B-NULL';");
  await add('invoices','I-SINGLE',{amount:6,total:6});
  await add('expense_requests','R-SINGLE',{amount:5});

  const before=await summary('mine');
  assert.equal(before.items.filter(x=>x.record_type==='bills'&&x.batch_id==='BILLB-FICTION-4').length,4);
  assert.equal((await detail('bills:B-A-1')).item.source_count,1);
  check('reproduced old failure: one bill submission is four personal list rows and singleton detail');
  const beforeRows=await businessFingerprint();
  const phaseFingerprint=async()=>(await db.query(strip(read('scripts/finance_personal_income_batch_history_fingerprint.sql')))).rows[0].fingerprint;
  const beforePhaseFingerprint=await phaseFingerprint();
  await db.exec('begin;'+migration+'\nrollback;');
  assert.deepEqual(await authority(),beforeAuthority);assert.equal(await businessFingerprint(),beforeRows);
  assert.equal(await phaseFingerprint(),beforePhaseFingerprint);
  assert.deepEqual(await summary('mine'),before);
  check('populated migration rehearsal rolls back every function/ACL and leaves all business/projection/identity rows unchanged');
  for(const [name,sql] of [
    ['missing identity-once ledger',"delete from supabase_migrations.schema_migrations where version='20261012112652'"],
    ['public RPC source drift',authorities.find(x=>x.signature.startsWith('finance_personal_document_summary_v1(')).definition.replace('return v_result;',"return '{}'::jsonb;")],
    ['private helper leaked execute',"grant execute on function private.finance_personal_document_authorized_v1(public.finance_users,text,text,text) to authenticated"],
    ['service role gained public RPC',"grant execute on function public.finance_personal_document_summary_v1(text,integer,integer,text,text) to service_role"],
    ['unsafe search path',"alter function public.finance_personal_document_summary_v1(text,integer,integer,text,text) set search_path='public'"],
    ['already recorded target',"insert into supabase_migrations.schema_migrations(version,name) values('20261013091838','finance_personal_income_batch_history_v1')"]
  ]){
    await db.exec('begin;');
    try{await db.exec(sql);await assert.rejects(()=>db.exec(migration),e=>e.code==='55000');}
    finally{await db.exec('rollback;');}
    assert.deepEqual(await authority(),beforeAuthority);
    check('preflight rejects '+name+' without installing partial changes');
  }
  await db.exec('begin;'+migration+'\ncommit;');
  assert.equal(await businessFingerprint(),beforeRows);
  const afterAuthority=await authority();
  for(const row of beforeAuthority){
    const after=afterAuthority.find(x=>x.name===row.name);
    assert.deepEqual({...after,source_md5:row.source_md5},row);
    if(row.name.startsWith('private.'))assert.equal(after.source_md5,row.source_md5);
  }
  check('only two public RPC bodies change; private identity-once/page/actor helpers, all ACLs and business rows remain identical');
  await assert.rejects(()=>db.exec(strip(read('scripts/finance_personal_history_identity_once_postflight.sql'))),e=>e.code==='55000');
  await assert.rejects(()=>db.exec(strip(read('scripts/finance_personal_history_postflight.sql'))),e=>e.code==='P0001');
  await assert.rejects(()=>db.exec(strip(read('scripts/finance_personal_income_batch_history_postflight.sql'))),e=>e.code==='55000');
  check('old and new postflights reject new public bodies unless the exact new migration ledger is recorded');
  await db.exec("insert into supabase_migrations.schema_migrations(version,name) values('20261013091838','finance_personal_income_batch_history_v1');");
  await db.exec(strip(read('scripts/finance_personal_income_batch_history_postflight.sql')));
  await db.exec(strip(read('scripts/finance_personal_history_identity_once_postflight.sql')));
  await db.exec(strip(read('scripts/finance_personal_history_postflight.sql')));
  check('new phase and version-aware prior postflights accept only exact new bodies while retaining identity/ACL/projection checks');
  const beforeCanary=await phaseFingerprint();
  await db.exec("select set_config('fixture.uid','',false)");
  const canaryResults=await db.exec(read('scripts/finance_personal_income_batch_history_canary.sql'));
  await db.exec("select set_config('fixture.uid','"+uid+"',false)");
  assert.equal(await phaseFingerprint(),beforeCanary);
  const results=Array.isArray(canaryResults)?canaryResults:[canaryResults];
  const canary=results.flatMap(x=>x.rows||[]).find(x=>x.personal_income_batch_history_canary_result);
  assert(canary,'actual canary result returned');
  assert.deepEqual(canary.personal_income_batch_history_canary_result,{
    canary:'readonly_personal_income_batch_history_v1',ok:true,rolled_back:true,
    identity_scope_preserved:true,permission_guard_preserved:true,live_latency_proven:false});
  check('actual read-only metadata/anonymous canary rolls back, preserves fingerprints and reports the protected release marker');

  const all=await summary(),mine=await summary('mine');
  const batch=mine.items.find(x=>x.record_type==='bills'&&x.batch_id==='BILLB-FICTION-4');
  assert(batch);assert.equal(mine.items.filter(x=>x.record_type==='bills'&&x.batch_id==='BILLB-FICTION-4').length,1);
  assert.equal(batch.source_count,4);assert.equal(batch.summary.amount,100);
  assert.deepEqual(sortedIds(batch),['B-A-1','B-A-2','B-A-3','B-A-4']);
  assert.equal(batch.record_no,'整批繳費單 BILLB-FICTION-4');
  assert.equal(batch.personally_applied,true);assert.equal(batch.participation_label,'我申請的');
  check('four durable bill siblings become one authorized application with exact total and IDs');
  assert.equal(all.items.find(x=>x.batch_id==='BILLB-OTHER-SUBMISSION').source_count,2);
  assert(!mine.items.some(x=>x.batch_id==='BILLB-OTHER-SUBMISSION'));
  assert.equal(all.items.filter(x=>x.batch_id==='BILLB-FICTION-4').length,2);
  const inv=all.items.find(x=>x.record_type==='invoices'&&x.batch_id==='BILLB-FICTION-4');
  assert.equal(inv.source_count,2);assert.equal(inv.summary.amount,104);
  check('same reason/time and same batch text across record types never merge independent submissions or bills with invoices');
  assert.deepEqual(counts(batch),{completed:1,pending_section_chief:2,rejected:1});
  for(const item of all.items)counts(item);
  assert.equal(counts(all.items.find(x=>x.record_id==='B-FALLBACK')).unpaid,1);
  assert.equal(counts(all.items.find(x=>x.record_id==='B-NULL')).unknown,1);
  assert.equal(all.items.find(x=>x.record_id==='B-NULL').summary.amount,null);
  assert.equal(all.items.find(x=>x.record_id==='B-ZERO').summary.amount,0);
  assert.equal(all.items.find(x=>x.record_id==='B-SINGLE').source_count,1);
  assert.equal(all.items.find(x=>x.record_id==='I-SINGLE').source_count,1);
  assert.equal(all.items.find(x=>x.record_id==='R-SINGLE').source_count,1);
  check('mixed stage counts sum exactly to every authorized source; single stage, status fallback, unknown, null and zero are truthful');
  const opened=(await detail(batch.history_key)).item;
  assert.deepEqual(sortedIds(opened),sortedIds(batch));assert.equal(opened.source_rows.length,4);
  assert.equal(opened.summary.amount,100);assert.deepEqual(counts(opened),counts(batch));
  assert.equal(opened.record_no,batch.record_no);
  assert(!JSON.stringify(opened).includes('SECRET-'));
  for(const forbidden of ['B-SECRET','B-FOREIGN','B-PRODUCTION','B-ASSIGNED'])
    await assert.rejects(()=>detail('bills:'+forbidden),e=>e.code==='42501');
  assert.equal((await summary('all',50,0,'SECRET-')).total,0);
  check('fresh batch detail excludes unauthorized/assigned-only/cross-tenant/cross-environment siblings and rejects their anchors');
  assert.deepEqual(counts(inv),{completed:1,pending_accountant_invoice:1});
  for(const item of all.items){
    const full=(await detail(item.history_key)).item;
    assert.deepEqual(counts(full),counts(item));
    assert.deepEqual(sortedIds(full),sortedIds(item));
    assert.equal(full.summary.amount,item.summary.amount);
  }
  check('all bill/invoice/expense details match list source IDs, amounts and stage counts, including mixed invoices and unknown states');
  const searched=await summary('mine',50,0,'最後一位繳費者');
  assert.equal(searched.total,1);assert.equal(searched.items[0].source_count,4);
  assert.equal(searched.items[0].summary.amount,100);
  assert.equal((await summary('mine',50,0,'愛無限 100')).total,1);
  assert.equal((await summary('mine',50,0,'B-A-4')).items[0].source_count,4);
  check('searching any member or batch total returns the full authorized group before pagination');

  await add('bills','B-MIX-1',{batch:'MIXED-APPLICANT-PARTICIPANT',amount:12,participant:false});
  await applyToSelf('bills','B-MIX-1');
  await add('bills','B-MIX-2',{batch:'MIXED-APPLICANT-PARTICIPANT',amount:13});
  const mixedMine=(await summary('mine')).items.find(x=>x.batch_id==='MIXED-APPLICANT-PARTICIPANT');
  assert.equal(mixedMine.source_count,2);assert.equal(mixedMine.summary.amount,25);
  assert.deepEqual(sortedIds((await detail(mixedMine.history_key)).item),sortedIds(mixedMine));
  assert.deepEqual(sortedIds((await summary()).items.find(x=>x.batch_id===mixedMine.batch_id)),sortedIds(mixedMine));
  check('mine filtering after per-source authorization preserves complete authorized applicant/actual-participant group membership');

  for(let n=1;n<=55;n++)await add('bills','PAGE-'+String(n).padStart(2,'0'),{amount:n,participant:false});
  for(let n=1;n<=55;n++)await applyToSelf('bills','PAGE-'+String(n).padStart(2,'0'));
  const page1=await summary('all'),page2=await summary('all',50,50);
  assert.equal(page1.items.length,50);assert.equal(page1.page.has_more,true);
  assert.equal(page2.items.length,page1.total-50);assert.equal(page2.page.has_more,false);
  const combined=page1.items.concat(page2.items);
  assert.equal(new Set(combined.map(x=>x.history_key)).size,page1.total);
  assert.equal(combined.filter(x=>x.record_type==='bills'&&x.batch_id==='BILLB-FICTION-4').length,1);
  assert.equal(combined.find(x=>x.record_type==='bills'&&x.batch_id==='BILLB-FICTION-4').source_count,4);
  check('more than fifty groups paginate with no split batch, duplicate group, hidden cutoff or count drift');
  await db.exec('begin;delete from private.finance_history_source_projection_v1 where record_type=\'bills\' and source_id=\'B-A-4\';');
  try{
    await db.exec('savepoint missing_projection;');
    await assert.rejects(()=>summary(),e=>e.code==='55000');
    await db.exec('rollback to savepoint missing_projection;');
    await assert.rejects(()=>detail(batch.history_key),e=>e.code==='55000');
  }
  finally{await db.exec('rollback;');}
  check('missing authorized source projection fails closed in list and full detail');
  await db.exec("update public.bills set applicant_id='OTHER-USER' where id='B-A-4'");
  const reduced=(await summary('mine')).items.find(x=>x.record_type==='bills'&&x.batch_id==='BILLB-FICTION-4');
  assert.equal(reduced.source_count,3);assert.equal(reduced.summary.amount,60);
  assert.deepEqual(counts(reduced),{completed:1,pending_section_chief:2});
  const reducedDetail=(await detail(batch.history_key)).item;
  assert.deepEqual(sortedIds(reducedDetail),sortedIds(reduced));assert.deepEqual(counts(reducedDetail),counts(reduced));
  check('revoked source ownership disappears immediately from both counts/detail and cannot survive old summary membership');

  await db.exec('set role authenticated');
  try{assert((await summary()).total>0);assert.equal((await detail(batch.history_key)).item.source_count,3);
    await assert.rejects(()=>db.query('select * from private.finance_history_source_projection_v1'),e=>e.code==='42501');}
  finally{await db.exec('reset role');}
  check('real authenticated database role may use guarded grouped RPCs but cannot directly read private projections');
  for(const role of ['anon','service_role']){
    await db.exec('set role '+role);
    try{await assert.rejects(()=>summary(),e=>e.code==='42501');await assert.rejects(()=>detail(batch.history_key),e=>e.code==='42501');}
    finally{await db.exec('reset role');}
    check(role+' cannot execute the public grouped history RPCs');
  }
  await denied('disabled Finance user cannot read grouped list',"update public.finance_users set active=false where id='FICT-USER'",()=>summary());
  await denied('disabled Finance user cannot open grouped detail',"update public.finance_users set active=false where id='FICT-USER'",()=>detail(batch.history_key));
  await denied('expired session is freshly denied',"update auth.sessions set not_after='2020-01-01'",()=>summary());
  await denied('unverified Google identity is denied',"update auth.identities set identity_data=identity_data||'{\"email_verified\":false}'::jsonb",()=>detail(batch.history_key));
  await denied('anonymous identity is denied',"select set_config('fixture.uid','',false)",()=>summary());
  await denied('inactive tenant member cannot query grouped records',"update public.tenant_members set active=false",()=>summary());
  await denied('module disable denies history list',`insert into public.system_settings values('${who.tenantId}','product_modules','[{"id":"finance-core","enabled":false}]')`,()=>summary());
  await denied('explicit approvals page denial protects grouped detail',`insert into public.system_settings values('${who.tenantId}','role_permissions','{"employee":{"approvals":false}}')`,()=>detail(batch.history_key));
  assert(migration.includes("record_type in ('bills','invoices')"));
  assert(!/CREATE OR REPLACE FUNCTION private\./i.test(migration));
  evidence.authority=afterAuthority;
  evidence.sha256=crypto.createHash('sha256').update(migration).digest('hex');
  evidence.completedAt=new Date().toISOString();
  console.log('INCOME_BATCH_PERSONAL_HISTORY_CHECKS='+evidence.checks.length);
 } finally{
   if(client)await client.end();
   if(admin){try{if(createdDatabase)await admin.query('drop database if exists '+databaseName);}finally{await admin.end();}}
   if(pglite)await pglite.close();
   fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'evidence.json'),JSON.stringify(evidence,null,2));
 }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
