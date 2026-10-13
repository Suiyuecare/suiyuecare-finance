#!/usr/bin/env node
'use strict';
// Exact forward SQL, isolated PostgreSQL/PGlite, fictional identities only.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');
const {Client}=require('pg');
const {createSummarySearchFixture,addSummarySearchDocument,fixtureIdentity:who}=require('./check_approval_history_summary.cjs');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const defs=JSON.parse(read('scripts/fixtures/finance_history_identity_authorities_20261012.json'));
const def=n=>defs.find(d=>d.signature.startsWith(n+'(')).definition;
const migration=read('supabase/migrations/20261013091000_finance_personal_bill_batch_history_v1.sql');
const guard=require('./finance_production_release_guard');
const configPath=process.env.FINANCE_HISTORY_NATIVE_PG_CONFIG||process.env.FINANCE_NATIVE_PG_CONFIG;
const config=configPath?JSON.parse(fs.readFileSync(configPath,'utf8')):null;
if(config&&!['127.0.0.1','::1','localhost'].includes(config.host))throw Error('Only disposable loopback PostgreSQL is allowed');
if(process.env.FINANCE_HISTORY_NATIVE_REQUIRED==='1'&&!config)throw Error('Native PostgreSQL proof requires an explicit disposable loopback config');
let admin,client,pglite;const database='bill_history_'+crypto.randomUUID().replaceAll('-','');
async function main(){
 let checks=0;const check=name=>{checks++;console.log('PASS '+name);};
 try{
  let db;
  if(config){admin=new Client(config);await admin.connect();await admin.query('create database '+database);client=new Client({...config,database});await client.connect();
   db={query:(sql,args)=>client.query(sql,args),exec:sql=>client.query(sql.replace(/create role (anon|authenticated|service_role);/g,''))};
  }else{pglite=new PGlite();db=pglite;}
  await createSummarySearchFixture(db);
  const tenant=who.tenantId,uid=who.authUserId,sid='00000000-0000-0000-0000-000000000021';
  await db.exec(`alter table public.finance_users add column name text,add column role text default 'employee',add column google_link_status text default 'bound',add column created_at timestamptz default now();
   alter table public.tenant_members add column id uuid default gen_random_uuid(),add column email text,add column created_at timestamptz default now();
   create table public.system_settings(tenant_id uuid,key text,value jsonb);
   create table auth.users(id uuid primary key);
   create table auth.identities(id uuid primary key default gen_random_uuid(),user_id uuid,provider text,identity_data jsonb,created_at timestamptz default now());
   create table auth.sessions(id uuid primary key,user_id uuid,not_after timestamptz);
   create function auth.jwt() returns jsonb language sql stable as $$select jsonb_build_object('session_id',nullif(current_setting('fixture.sid',true),''))$$;
   create function public.default_tenant_id() returns uuid language sql stable as $$select '${tenant}'::uuid$$;
   alter table public.expense_requests add column applicant_id text,add column applicant_email text;
   alter table public.bills add column applicant_id text,add column applicant_email text,add column approval_step integer;
   alter table public.invoices add column applicant_id text;
   alter table public.approval_step_actor_snapshots add column raw_step jsonb;
   update public.finance_users set name='虛構查詢員',email='history.fixture@suiyuecare.com' where id='FICT-USER';
   update public.tenant_members set email='history.fixture@suiyuecare.com';
   insert into auth.users values('${uid}');
   insert into auth.identities(user_id,provider,identity_data) values('${uid}','google','{"email":"history.fixture@suiyuecare.com","email_verified":true}');
   insert into auth.sessions values('${sid}','${uid}',null);
   select set_config('fixture.sid','${sid}',false);
   create schema supabase_migrations;
   create table supabase_migrations.schema_migrations(version text primary key,name text,statements text[],created_by text);
   insert into supabase_migrations.schema_migrations(version,name) values
    ('20261008055528','finance_personal_document_history_v1'),
    ('20261008090000','finance_personal_history_permission_guard_v1'),
    ('20261010130000','finance_personal_invoice_batch_history_v1');`);
  await db.exec(read('scripts/fixtures/finance_procurement_payment_helpers_20260908.sql').match(/CREATE OR REPLACE FUNCTION private\.finance_expense_optional_permission_allows\([\s\S]*?\$function\$;/)[0]);
  for(const n of ['finance_verified_google_email','finance_auth_session_active','current_tenant_id','current_finance_user','current_finance_user_id','finance_current_verified_google_email_v2','finance_legacy_name_matches_current_v1','finance_identity_matches_current_v1','private.finance_personal_history_page_allows_v1','private.finance_history_actor_v1','private.finance_personal_document_authorized_v1','finance_personal_document_summary_v1','finance_personal_document_detail_v1'])await db.exec(def(n));
  for(const d of defs.filter(d=>/finance_personal_document_|finance_history_actor_v1|finance_personal_history_page_allows_v1/.test(d.signature))){
   await db.exec('revoke all on function '+d.signature+' from public,anon,authenticated,service_role;');
   if(d.signature.startsWith('finance_personal_document_summary_v1')||d.signature.startsWith('finance_personal_document_detail_v1'))await db.exec('grant execute on function '+d.signature+' to authenticated;');
  }
  await db.exec(read('supabase/migrations/20261012112652_finance_personal_history_identity_once_v1.sql'));
  await db.exec("insert into supabase_migrations.schema_migrations(version,name) values('20261012112652','finance_personal_history_identity_once_v1')");
  const summary=async(scope='mine',search=null,limit=50,offset=0)=>(await db.query('select public.finance_personal_document_summary_v1($1,$2,$3,$4,\'test\') p',[scope,limit,offset,search])).rows[0].p;
  const detail=async key=>(await db.query('select public.finance_personal_document_detail_v1($1,\'test\') p',[key])).rows[0].p.item;
  const add=async(id,options={})=>{
   await addSummarySearchDocument(db,{table:'bills',id,batch:'BILL-FICTIONAL-BATCH',description:'虛構繳費單 '+id,amount:1,...options});
   if(options.owned!==false)await db.query('update public.bills set applicant_id=\'FICT-USER\' where id=$1',[id]);
   await db.query("update public.bills set approval_status='pending_section_chief',approval_step=2,steps='[{\"rk\":\"applicant_submit\",\"a\":\"approved\"},{\"rk\":\"section_chief\",\"uid\":\"FICT-SUPERVISOR\",\"a\":null}]' where id=$1",[id]);
  };
  for(const [index,amount] of [2204,4206,6934,1729].entries())await add('BILL-CHILD-'+(index+1),{amount});
  await add('BILL-SECRET',{amount:99999,owned:false,participant:false});
  await add('BILL-FOREIGN',{amount:99999,tenantId:who.otherTenantId});
  await add('BILL-PROD',{amount:99999,environment:'production'});
  await add('BILL-SINGLE',{amount:50,batch:null});
  await add('BILL-OTHER-COMPANY');await db.exec("update public.bills set entity_id='F2' where id='BILL-OTHER-COMPANY'");
  await add('BILL-OTHER-DEPT');await db.exec("update public.bills set department_code='D2' where id='BILL-OTHER-DEPT'");
  await add('BILL-OTHER-STATE');await db.exec("update public.bills set approval_status='rejected' where id='BILL-OTHER-STATE'");
  await add('BILL-OTHER-STEP');await db.exec("update public.bills set approval_step=3 where id='BILL-OTHER-STEP'");
  await add('BILL-OTHER-WORKFLOW');await db.exec("update public.bills set steps='[{\"rk\":\"ceo\",\"uid\":\"FICT-CEO\"}]' where id='BILL-OTHER-WORKFLOW'");
  for(let n=1;n<=18;n++){await addSummarySearchDocument(db,{table:'invoices',id:'INV-'+n,batch:'INV-FICTIONAL',amount:100,total:100});await db.query('update public.invoices set applicant_id=\'FICT-USER\' where id=$1',['INV-'+n]);}
  const before=await summary(),oldInvoice=before.items.find(x=>x.record_type==='invoices');
  assert.equal(before.items.filter(x=>x.record_type==='bills').length,10);check('reproduces ten flat bill rows including the four actual-shaped children before fix');
  const fingerprint=async()=>(await db.query("select md5(jsonb_build_object('bills',(select jsonb_agg(to_jsonb(b) order by id) from public.bills b),'snapshots',(select jsonb_agg(to_jsonb(s) order by record_type,record_id,step_index) from public.approval_step_actor_snapshots s),'projection',(select jsonb_agg(to_jsonb(p) order by record_type,source_id) from private.finance_history_source_projection_v1 p))::text) f")).rows[0].f;
  const strip=sql=>sql.replace(/^\\set ON_ERROR_STOP on\n/,'');
  await db.exec(strip(read('scripts/finance_personal_bill_batch_history_preflight.sql')));
  const base='20260825103034',target='20261013091000',phase=guard.RELEASE_PHASE_DATABASE_PERSONAL_BILL_BATCH_HISTORY;
  const baseline={count:1,lastVersion:base,sha256:guard.ledgerSha256([base])};
  for(const version of [base,...guard.REVIEWED_MIGRATION_CATALOG.filter(v=>v<target)])await db.query('insert into supabase_migrations.schema_migrations(version,name) values($1,\'fictional_predecessor\') on conflict(version) do nothing',[version]);
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'bill-history-release-')),ledger=path.join(temp,'ledger.txt');
  fs.writeFileSync(ledger,(await db.query('select version from supabase_migrations.schema_migrations order by version')).rows.map(x=>x.version).join('\n')+'\n');
  const paths=name=>path.join(root,'scripts/finance_personal_bill_batch_history_'+name+'.sql');
  const rehearsal=path.join(temp,'rehearsal.sql'),apply=path.join(temp,'apply.sql');
  guard.preparePersonalBillBatchHistoryRehearsal(path.join(root,'supabase/migrations'),rehearsal,target,ledger,paths('fingerprint'),paths('canary'),paths('preflight'),paths('postflight'),baseline);
  const original=await fingerprint();await db.exec("set fixture.uid=''");await db.exec(fs.readFileSync(rehearsal,'utf8'));await db.exec(`set fixture.uid='${uid}'`);assert.equal(await fingerprint(),original);assert.deepEqual(await summary(),before);check('actual protected phase rehearsal rolls back SQL, canonical ledger, functions, ACLs and every business/projection row');
  guard.prepareAuditBatchApply(path.join(root,'supabase/migrations'),apply,target,ledger,paths('postflight'),baseline,phase);
  await db.exec(fs.readFileSync(apply,'utf8'));assert.equal(await fingerprint(),original);check('actual protected apply atomically installs read model and canonical ledger without changing business/projection rows');
  const installed=(await db.query('select name,statements,created_by from supabase_migrations.schema_migrations where version=$1',[target])).rows[0];assert.equal(installed.name,'finance_personal_bill_batch_history_v1');assert.deepEqual(installed.statements,[migration.trimEnd()]);assert.equal(installed.created_by,'github-actions');check('canonical ledger stores exactly the reviewed full SQL, name and workflow actor in the same transaction');
  fs.writeFileSync(ledger,(await db.query('select version from supabase_migrations.schema_migrations order by version')).rows.map(x=>x.version).join('\n')+'\n');
  assert.throws(()=>guard.prepareAuditBatchApply(path.join(root,'supabase/migrations'),path.join(temp,'reapply.sql'),target,ledger,paths('postflight'),baseline,phase),/must be pending, found applied/);check('already applied phase cannot duplicate helper, migration or canonical ledger');
  await db.exec(strip(read('scripts/finance_personal_bill_batch_history_postflight.sql')));check('postflight seals actual new function bodies and read-only ACLs; original identity authority stays exact');
  const mine=await summary(),group=mine.items.find(x=>x.source_count===4&&x.record_type==='bills');
  assert(group);assert.equal(group.summary.amount,15073);assert.equal(group.summary.source_count,4);assert.deepEqual(group.source_ids,['BILL-CHILD-1','BILL-CHILD-2','BILL-CHILD-3','BILL-CHILD-4']);assert.match(group.batch_scope_key,/^bill-batch:[0-9a-f]{32}$/);assert.equal(mine.items.filter(x=>x.record_type==='bills').length,7);check('four true same-scope children become one bill summary totaling 15073 with all original child IDs');
  for(const id of ['BILL-OTHER-COMPANY','BILL-OTHER-DEPT','BILL-OTHER-STATE','BILL-OTHER-STEP','BILL-OTHER-WORKFLOW','BILL-SINGLE'])assert.equal(mine.items.find(x=>x.record_id===id).source_count,1);check('company, department, state, step, workflow and no-batch rows remain independent despite matching batch IDs');
  assert.deepEqual(mine.items.find(x=>x.record_type==='invoices'),oldInvoice);check('invoice batch summary remains byte-for-byte identical');
  const d=await detail(group.history_key);assert.deepEqual(d.source_ids,group.source_ids);assert.equal(d.source_rows.length,4);assert.equal(d.summary.amount,15073);assert.equal(d.batch_scope_key,group.batch_scope_key);check('detail re-authorizes and returns exactly the same four children, amount and scope');
  await db.exec("update public.bills set batch_id='  BILL-FICTIONAL-BATCH  ' where id='BILL-CHILD-4'");
  assert.equal((await detail(group.history_key)).source_count,4);assert.equal((await summary()).items.find(x=>x.record_id==='BILL-CHILD-1').batch_scope_key,group.batch_scope_key);check('bill batch whitespace uses the same trimmed key in summary, detail and original raw rows');
  await add('BILL-LEGACY-1',{owned:false});await add('BILL-LEGACY-2',{owned:false});
  await db.exec("update public.bills set applicant_id=' ',applicant_email=' ',applicant=case id when 'BILL-LEGACY-1' then '虛構甲' else '虛構乙' end where id in('BILL-LEGACY-1','BILL-LEGACY-2')");
  const legacy=(await summary('all')).items.filter(x=>x.record_id.startsWith('BILL-LEGACY-'));assert.equal(legacy.length,2);assert(legacy.every(x=>x.source_count===1));assert.equal((await detail('bills:BILL-LEGACY-1')).source_count,1);check('legacy bills without ID or email remain row-isolated even with a true same batch and authorized actual participation');
  for(const id of ['BILL-SECRET','BILL-FOREIGN','BILL-PROD']){assert(!JSON.stringify(mine).includes(id));await assert.rejects(()=>detail('bills:'+id),e=>e.code==='42501');}check('unrelated same-batch, cross-tenant and production sources cannot leak through grouped summary/detail');
  for(const q of ['BILL-CHILD-4','15073','15,073']){const found=await summary('mine',q);assert.equal(found.total,1);assert.equal(found.items[0].source_count,4);}check('search for a final child number or batch sum finds the complete group before pagination');
  assert.equal((await summary('mine',null,1,0)).items.length,1);assert.equal((await summary('mine',null,1,mine.total)).items.length,0);check('pagination counts logical groups, not individual children');
  const otherDetail=await detail('bills:BILL-OTHER-WORKFLOW');assert.equal(otherDetail.source_count,1);assert.deepEqual(otherDetail.source_ids,['BILL-OTHER-WORKFLOW']);check('opening another same-batch workflow cannot append the four standard children');
  await db.exec("update public.bills set applicant_id='OTHER-USER' where id='BILL-CHILD-4';update public.approval_step_actor_snapshots set acted_by_user_id=null,resolved_user_id='OTHER-USER' where record_id='BILL-CHILD-4'");
  assert.equal((await detail(group.history_key)).source_count,3);check('revoked child disappears on fresh detail instead of authorizing siblings by batch');
  await db.exec("update public.finance_users set active=false where id='FICT-USER'");await assert.rejects(()=>summary(),e=>e.code==='42501');await assert.rejects(()=>detail(group.history_key),e=>e.code==='42501');check('disabled identity cannot access grouped personal documents');
  console.log('BILL_BATCH_PERSONAL_HISTORY_CHECKS='+checks+' ENGINE='+(config?'native PostgreSQL':'PGlite'));
 }finally{if(client){await client.end();await admin.query('drop database '+database);}if(admin)await admin.end();if(pglite)await pglite.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
