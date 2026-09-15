#!/usr/bin/env node
'use strict';
// Real PostgreSQL baseline and new indexed-summary functions. Fictional only.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
const {createApprovalSearchFixture}=require('./check_approval_search_projection.cjs');
const root=path.resolve(__dirname,'..');
const migrationPath='supabase/migrations/20260915050313_finance_approval_history_summary_v1.sql';
const fixtureIdentity={tenantId:'00000000-0000-0000-0000-000000000001',otherTenantId:'00000000-0000-0000-0000-000000000002',authUserId:'00000000-0000-0000-0000-000000000011',financeUserId:'FICT-USER',email:'fiction@example.invalid'};
async function createSummarySearchFixture(db,options={}){
  await createApprovalSearchFixture(db,{install:true});
  await db.exec(`alter table public.expense_requests add column if not exists updated_at timestamptz,add column if not exists ver integer,add column if not exists steps jsonb;
    alter table public.bills add column if not exists updated_at timestamptz,add column if not exists row_version integer,add column if not exists steps jsonb;
    alter table public.invoices add column if not exists updated_at timestamptz,add column if not exists row_version integer,add column if not exists steps jsonb;
    insert into public.finance_department_units values('${fixtureIdentity.tenantId}','D1','測試日照課');`);
  if(options.install!==false)await db.exec(fs.readFileSync(path.join(root,migrationPath),'utf8'));
  return fixtureIdentity;
}
async function addSummarySearchDocument(db,options={}){
  const {table='expense_requests',id,amount=1250,batch=null,description='虛構日照服務',tenantId=fixtureIdentity.tenantId,environment='test',participant=true,acted=true,total=amount,department='D1',payload={},date='2026-09-15T00:00:00Z'}=options;
  if(!id||!['expense_requests','bills','invoices'].includes(table))throw Error('Explicit synthetic document id/table required');
  if(table==='expense_requests')await db.query('insert into public.expense_requests(id,no,tenant_id,data_environment,amount,description,department_code,form_payload,type,type_label,status,applicant,entity_id,request_date,created_at) values($1,$1,$2,$3,$4,$5,$6,$7,\'payment_request\',\'請款申請\',\'completed\',\'匿名申請人\',\'F1\',\'2026-09-15\',$8)',[id,tenantId,environment,amount,description,department,JSON.stringify(payload),date]);
  else if(table==='bills')await db.query('insert into public.bills(id,no,tenant_id,data_environment,amount,batch_id,item,department_code,status,approval_status,applicant,entity_id,created_at) values($1,$1,$2,$3,$4,$5,$6,$7,\'unpaid\',\'completed\',\'匿名申請人\',\'F1\',$8)',[id,tenantId,environment,amount,batch,description,department,date]);
  else await db.query('insert into public.invoices(id,no,tenant_id,data_environment,amount,tax,total,batch_id,buyer,description,department_code,status,approval_status,applicant,entity_id,created_at) values($1,$1,$2,$3,$4,0,$5,$6,\'匿名付款人\',$7,$8,\'unpaid\',\'completed\',\'匿名申請人\',\'F1\',$9)',[id,tenantId,environment,amount,total,batch,description,department,date]);
  await db.query(`insert into public.approval_step_actor_snapshots(tenant_id,data_environment,record_type,record_id,record_no,step_index,step_title,step_status,workflow_status,role_key,resolved_user_id,acted_by_user_id,acted_at_text,updated_at)
    values($1,$2,$3,$4,$4,0,'匿名覆核','approved','completed','accountant',$5,$6,$7::text,$7::timestamptz)`,[tenantId,environment,table,id,participant?fixtureIdentity.financeUserId:'OTHER-USER',participant&&acted?fixtureIdentity.financeUserId:null,date]);
  return id;
}
module.exports={createSummarySearchFixture,addSummarySearchDocument,fixtureIdentity,migrationPath};

async function runTests(){
 const db=new PGlite();let checks=0;
 const check=(n,ok=true)=>{assert(ok,n);checks++;console.log('PASS '+n);};
 const read=p=>fs.readFileSync(path.join(root,p),'utf8');
 const summary=async(q=null,limit=50,offset=0,env='test')=>(await db.query('select public.finance_approval_history_summary_v1($1,$2,$3,$4) p',[limit,offset,q,env])).rows[0].p;
 const old=async(q=null,limit=50,offset=0,env='test')=>(await db.query('select public.finance_approval_participant_history_for_current_user($1,$2,$3,$4) p',[limit,offset,q,env])).rows[0].p;
 const detail=async(k,env='test')=>(await db.query('select public.finance_approval_history_detail_v1($1,$2) p',[k,env])).rows[0].p;
 const ids=p=>p.items.map(x=>x.record_id).sort();
 const fp=async()=>(await db.query(`select jsonb_build_object('source',(select md5(coalesce(jsonb_agg(to_jsonb(s) order by tenant_id,data_environment,record_type,source_id)::text,'')) from private.finance_history_source_projection_v1 s),'groups',(select md5(coalesce(jsonb_agg(to_jsonb(s) order by tenant_id,data_environment,record_type,group_key)::text,'')) from private.finance_history_group_projection_v1 s)) f`)).rows[0].f;
 try{
  await createSummarySearchFixture(db,{install:false});
  await addSummarySearchDocument(db,{id:'R-DAY',description:'日照 九月自費服務',payload:{requestPurpose:'接送長者',accountingLines:[{item:'交通費',grossAmount:88.75}],attachments:[{name:'自費附件.pdf',url:'https://example.invalid/URLSECRET',content:'SECRET'.repeat(20000)}],metadata:{note:'METASECRET',amount:91919}},amount:1250});
  await addSummarySearchDocument(db,{id:'R-DEC',description:'手續費',amount:12.5});
  await addSummarySearchDocument(db,{id:'R-NEG',description:'退款',amount:-12.5});
  await addSummarySearchDocument(db,{id:'R-ZERO',description:'零元',amount:0});
  await addSummarySearchDocument(db,{id:'R-NULL',description:'待核對',amount:null});
  await addSummarySearchDocument(db,{id:'R-ASSIGNED',description:'曾指派',amount:34,acted:false});
  await addSummarySearchDocument(db,{id:'R-NO',description:'未參與的保密單',participant:false});
  await addSummarySearchDocument(db,{id:'R-OTHER',tenantId:fixtureIdentity.otherTenantId,description:'外租戶保密單'});
  await addSummarySearchDocument(db,{id:'R-PROD',environment:'production',description:'正式環境保密單'});
  await addSummarySearchDocument(db,{table:'invoices',id:'I-A',batch:'I-BATCH',description:'日照甲',amount:1000,total:1050});
  await addSummarySearchDocument(db,{table:'invoices',id:'I-B',batch:'I-BATCH',description:'自費乙',amount:200,total:200,participant:false});
  await addSummarySearchDocument(db,{table:'invoices',id:'I-FOREIGN',batch:'I-BATCH',tenantId:fixtureIdentity.otherTenantId,description:'外租戶同批',amount:99999});
  await addSummarySearchDocument(db,{table:'bills',id:'B-A',batch:'B-BATCH',description:'帳單甲',amount:1000});
  await addSummarySearchDocument(db,{table:'bills',id:'B-B',batch:'B-BATCH',description:'帳單乙',amount:250,participant:false});
  await addSummarySearchDocument(db,{table:'invoices',id:'I-ZERO',batch:null,description:'金額零',amount:1000,total:0});
  await db.query("update public.expense_requests set description='',form_payload=$1 where id='R-NULL'",[JSON.stringify({purpose:'用途不可消失'})]);
  for(const [n,text] of [['LEADING','-00012.50'],['PLUS','+00012.500'],['SMALL','-000.500'],['RAW','a"b a\\b 😀 ＣＡＲＥ 123ABC']])await addSummarySearchDocument(db,{id:'R-'+n,amount:71.23,description:text});
  const unchanged=(await db.query("select md5(pg_get_functiondef('public.finance_approval_participant_history_for_current_user(integer,integer,text,text)'::regprocedure)) h")).rows[0].h;
  const migration=read(migrationPath);
  await db.exec('begin;'+migration+'\nrollback;');
  assert.equal((await db.query("select to_regclass('private.finance_history_source_projection_v1') s,to_regclass('private.finance_history_group_projection_v1') g")).rows[0].s,null);check('first-install rollback removes projection schema/backfill without touching prior functions');
  await db.exec('begin;'+migration+'\ncommit;');
  assert.equal((await db.query("select md5(pg_get_functiondef('public.finance_approval_participant_history_for_current_user(integer,integer,text,text)'::regprocedure)) h")).rows[0].h,unchanged);check('deployed full-history RPC remains byte-for-byte compatible');
  const queries=[null,'日照','自費','日照 自費','交通費 88.75','自費附件.pdf','METASECRET','URLSECRET','接送長者','測試日照課','1250','1,250','NT$ 1,250.00','１２５０元','12.50','12.5','-12.50','−12.50','+00012.500','00012.50','0.5','-0.50','0','0.00','12.00','1,25','1.250','+1250','12','23','71.23','R-DAY','a"b','a\\b','😀','care','123ABC','用途不可消失','不存在的搜尋字','金額零','曾指派'];
  for(const q of queries){const a=await old(q),b=await summary(q);assert.equal(b.total,a.total,q);assert.equal(b.all_total,a.all_total,q);assert.deepEqual(b.items.map(i=>i.history_key),a.items.map(i=>i.history_key),q);check('real old/new authorization and result ordering parity '+JSON.stringify(q));}
  assert.deepEqual(ids(await summary('日照 自費')),['I-A','R-DAY']);check('independent expected IDs include cross-row batch terms, not just representative');
  assert.deepEqual(ids(await summary('1250')),['B-A','I-A','R-DAY']);check('independent gross batch-sum matches do not use invoice net amounts');
  assert.deepEqual(ids(await summary('交通費 88.75')),['R-DAY']);check('independent nested business amount and purpose matches');
  assert.equal((await summary('R-NO')).total,0);assert.equal((await summary('R-OTHER')).total,0);assert.equal((await summary('R-PROD')).total,0);check('no unrelated participant, tenant or environment leakage');
  for(const q of ['R-DAY','I-A','B-A','R-ASSIGNED']){const a=(await old(q)).items[0],b=(await detail(a.history_key)).item;for(const k of ['record_type','record_id','batch_id','record_no','last_participated_at','personally_acted','participation_label','participant_steps','source_rows'])assert.deepEqual(b[k],a[k],q+':'+k);assert.equal(b.source_count,a.source_rows.length);check('fresh exact full-group detail contract '+q);}
  await assert.rejects(()=>detail('expense_requests:R-NO'),e=>e.code==='42501');await assert.rejects(()=>detail('invoices:I-FOREIGN'),e=>e.code==='42501');check('known identifiers cannot bypass participant authorization for detail');
  const sr=(await summary('R-ASSIGNED')).items[0];assert.equal(sr.personally_acted,false);assert.equal(sr.participation_label,'曾列入流程');check('assignment is never relabelled as actual approval');
  assert.equal((await summary('R-NULL')).items[0].summary.amount,null);assert.equal((await summary('I-ZERO')).items[0].summary.amount,0);check('unknown and explicit zero remain distinct');
  assert.equal((await summary('R-NULL')).items[0].summary.description,'用途不可消失');check('blank legacy description falls back to actual purpose');
  const compact=JSON.stringify(await summary());assert(!compact.includes('source_rows')&&!compact.includes('participant_steps')&&!compact.includes('SECRET'));check('summary cannot carry full sources, attachment body, or internal metadata');
  await db.exec(`insert into public.finance_department_units values('${fixtureIdentity.tenantId}','LONG','萬華日間照顧課')`);
  await addSummarySearchDocument(db,{id:'R-ALIAS',description:'一般服務',department:'LONG',amount:73});
  assert(!ids(await old('日照')).includes('R-ALIAS'));assert(ids(await summary('日照')).includes('R-ALIAS'));assert.equal((await summary('R-ALIAS')).items[0].summary.department_name,'萬華日間照顧課');check('intentional limited department alias finds 日照 without altering actual department display');
  await db.exec("update public.finance_department_units set name='居家照護課' where code='LONG'");assert(!ids(await summary('日照')).includes('R-ALIAS'));check('department rename removes the obsolete 日照 alias in the same transaction');
  await db.exec(`insert into public.expense_requests(id,no,tenant_id,data_environment,amount,description,type,type_label,status,applicant,entity_id,department_code)
   select 'PAGE-'||lpad(n::text,3,'0'),'PAGE-'||lpad(n::text,3,'0'),'${fixtureIdentity.tenantId}','test',42,'跨頁 獨立母體','payment_request','請款申請','completed','匿名','F1','D1' from generate_series(1,123)n;
   insert into public.approval_step_actor_snapshots(tenant_id,data_environment,record_type,record_id,step_index,resolved_user_id,acted_by_user_id,acted_at_text)
   select tenant_id,data_environment,'expense_requests',id,0,'FICT-USER','FICT-USER','2026-09-15T02:00:00Z' from public.expense_requests where id like 'PAGE-%';`);
  let keys=[];for(let off=0;off<123;off+=50){const p=await summary('跨頁',50,off);assert.equal(p.total,123);keys.push(...p.items.map(x=>x.record_id));assert.equal(p.page.has_more,off+50<123);}assert.deepEqual(keys.sort(),Array.from({length:123},(_,n)=>'PAGE-'+String(n+1).padStart(3,'0')));check('all 123 independently enumerated records remain reachable without duplicate/cutoff');
  assert.equal((await summary('跨頁',50,1000)).total,123);check('out-of-range retains verified count without fake empty corpus');
  const before=await fp();await db.exec('begin');await db.exec("update public.expense_requests set description='回滾標記' where id='R-DAY'");assert.equal((await summary('回滾標記')).total,1);await db.exec('rollback');assert.deepEqual(await fp(),before);check('source change and projection roll back atomically');
  await db.exec("update public.invoices set batch_id='NEW-BATCH',description='搬移後單據' where id='I-B'");assert.equal((await summary('I-A')).items[0].summary.source_count,1);assert.equal((await summary('搬移後單據')).total,0);check('batch move removes old sibling/search/sum and does not grant new group visibility');
  await db.exec("update public.invoices set batch_id='I-BATCH' where id='I-B'");assert.equal((await detail('invoices:I-BATCH')).item.source_count,2);check('batch reassignment restores current complete detail');
  await db.exec("update public.finance_department_units set name='新版接送課' where code='D1'");assert.equal((await summary('測試日照課')).total,0);assert((await summary('新版接送課')).total>0);check('organization rename updates search and bounded summary in the same transaction');
  await db.exec("update public.finance_users set active=false where id='FICT-USER'");await assert.rejects(()=>summary(),e=>e.code==='42501');await assert.rejects(()=>detail('invoices:I-BATCH'),e=>e.code==='42501');await db.exec("update public.finance_users set active=true where id='FICT-USER'");check('current membership/identity authority is never cached in projections');
  await db.exec("set fixture.uid=''");await assert.rejects(()=>summary(),e=>e.code==='42501');await db.exec(`set fixture.uid='${fixtureIdentity.authUserId}';set fixture.email='wrong@example.invalid'`);await assert.rejects(()=>detail('invoices:I-BATCH'),e=>e.code==='42501');await db.exec("set fixture.email='fiction@example.invalid'");check('anonymous and mismatched verified Google identities are denied');
  await db.exec('set role authenticated');await assert.rejects(()=>db.query('select * from private.finance_history_group_projection_v1'),e=>e.code==='42501');assert((await summary()).total>0);await db.exec('reset role');check('real authenticated role can call checked RPC but cannot read private index');
  for(const x of [[null,0,0],[null,51,0],[null,50,-1],[null,50,0,'foreign'],['x'.repeat(121)]]){await assert.rejects(()=>summary(...x),e=>e.code==='22023');}check('input page/environment/query boundaries remain explicit');
  const dataBefore=(await db.query("select md5(jsonb_agg(to_jsonb(r) order by id)::text) f from public.expense_requests r")).rows[0].f;
  await db.exec("begin;delete from private.finance_history_group_projection_v1 where group_key='R-DAY'");await assert.rejects(()=>summary(),e=>e.code==='55000');await db.exec('rollback');check('missing projection cannot silently certify incomplete history');
  assert.equal((await db.query("select md5(jsonb_agg(to_jsonb(r) order by id)::text) f from public.expense_requests r")).rows[0].f,dataBefore);check('read-only summary/detail and completeness failures do not change source documents');
  // Count actual group refreshes in a temporary local wrapper, not a regex test.
  await db.exec(`alter function private.finance_history_refresh_group_v1(uuid,text,text,text) rename to fixture_real_refresh;
   create table public.fixture_refreshes(k text);
   create function private.finance_history_refresh_group_v1(t uuid,e text,r text,k text) returns void language plpgsql as $$begin insert into public.fixture_refreshes values(k);perform private.fixture_real_refresh(t,e,r,k);end$$;`);
  let start=performance.now();await db.exec(`insert into public.invoices(id,no,tenant_id,data_environment,amount,total,batch_id,buyer,description,department_code)
    select 'BULK-'||n,'BULK-'||n,'${fixtureIdentity.tenantId}','test',10,10,'103-MEMBERS','匿名','大量日照完整資料','D1' from generate_series(1,103)n;`);const insertMs=performance.now()-start;
  assert.equal((await db.query("select count(*) n from public.fixture_refreshes where k='103-MEMBERS'")).rows[0].n,1);check('one statement inserts 103 batch rows with one group refresh');
  await db.exec(`insert into public.approval_step_actor_snapshots(tenant_id,data_environment,record_type,record_id,step_index,resolved_user_id,acted_at_text) values('${fixtureIdentity.tenantId}','test','invoices','BULK-1',0,'FICT-USER','2026-09-15T03:00:00Z')`);
  assert.equal((await detail('invoices:103-MEMBERS')).item.source_count,103);assert.equal((await summary('103-MEMBERS')).items[0].summary.amount,1030);check('detail has all 103 members and list amount matches complete batch');
  await db.exec('truncate public.fixture_refreshes');start=performance.now();await db.exec("update public.invoices set amount=20,total=20 where batch_id='103-MEMBERS'");const updateMs=performance.now()-start;
  assert.equal((await db.query('select count(*) n from public.fixture_refreshes')).rows[0].n,1);assert.equal((await summary('103-MEMBERS')).items[0].summary.amount,2060);check('one 103-row amount update refreshes once and retains current sum');
  await db.exec('truncate public.fixture_refreshes');await db.exec("update public.invoices set total=total,row_version=coalesce(row_version,0)+1 where batch_id='103-MEMBERS'");assert.equal((await db.query('select count(*) n from public.fixture_refreshes')).rows[0].n,0);check('unchanged business fields and version-only updates do not recompute groups');
  console.log('BATCH_WRITE '+JSON.stringify({rows:103,insertMs,updateMs,note:'Isolated PGlite; not two-session or production measurement'}));
  await db.exec('drop function private.finance_history_refresh_group_v1(uuid,text,text,text);alter function private.fixture_real_refresh(uuid,text,text,text) rename to finance_history_refresh_group_v1;drop table public.fixture_refreshes');
  const startRead=performance.now(),small=await summary('日照');const readMs=performance.now()-startRead;assert(Buffer.byteLength(JSON.stringify(small))<=200000);console.log('READ '+JSON.stringify({readMs,bytes:Buffer.byteLength(JSON.stringify(small)),total:small.total}));
  check('actual summary excludes heavy payload and remains below 200KB');

  await db.exec(`insert into public.expense_requests(id,no,tenant_id,data_environment,amount,description,type,type_label,status,applicant,entity_id,department_code)
   select 'UNICODE-'||n,'U-'||n,'${fixtureIdentity.tenantId}','test',43,'完整摘要測試'||repeat('漢',1000)||'末段仍可查找',repeat('類',100),repeat('稱',100),repeat('態',100),repeat('名',150),repeat('司',120),repeat('部',90) from generate_series(1,50)n;
   insert into public.approval_step_actor_snapshots(tenant_id,data_environment,record_type,record_id,step_index,resolved_user_id,acted_at_text)
   select tenant_id,data_environment,'expense_requests',id,0,'FICT-USER','2026-09-15T04:00:00Z' from public.expense_requests where id like 'UNICODE-%';`);
  const unicode=await summary('末段仍可查找');assert.equal(unicode.total,50);assert.equal(unicode.items.length,50);assert(Buffer.byteLength(JSON.stringify(unicode))<=200000);assert(unicode.items.every(i=>!i.summary.description.includes('末段仍可查找')));check('50 Unicode-heavy bounded summaries fit 200KB while full undisplayed purpose stays searchable');
  await db.exec("set fixture.uid=''");
  const postflight=read('scripts/finance_approval_history_summary_postflight.sql').replace(/^\\set ON_ERROR_STOP on\r?\n/,'');
  await db.exec(postflight);check('exact new read-only function/ACL/transition/coverage postflight passes');
  await db.exec('begin;drop trigger finance_history_projection_update_v1 on public.invoices;create trigger finance_history_projection_update_v1 after insert on public.invoices referencing new table as new_source for each statement execute function private.finance_history_projection_source_trigger_v1()');
  await assert.rejects(()=>db.exec(postflight),e=>e.code==='P0001');await db.exec('rollback');check('postflight rejects three-enabled-triggers illusion with missing actual UPDATE transition');
  const beforeCanary=await fp(),canary=await db.exec(read('scripts/finance_approval_history_summary_canary.sql'));
  assert.deepEqual(canary.flatMap(r=>r.rows||[]).find(r=>r.approval_history_summary_canary_result).approval_history_summary_canary_result,{canary:'readonly_approval_history_summary_v1',ok:true,rolled_back:true,participant_scope_preserved:true});assert.deepEqual(await fp(),beforeCanary);check('exact readonly canary runs without identity and preserves full projection row fingerprints');
  for(const file of ['finance_amount_search_postflight.sql','finance_approval_history_postflight.sql','finance_approval_search_postflight.sql'])await db.exec(read('scripts/'+file).replace(/^\\set ON_ERROR_STOP on\r?\n/,''));check('all three inherited history/amount/search postflights still pass');
  console.log('History summary: '+checks+' actual PostgreSQL checks passed.');
 }finally{await db.close();}
}

if(require.main===module)runTests().catch(e=>{console.error({message:e.message,code:e.code,where:e.where,stack:e.stack});process.exitCode=1;});
