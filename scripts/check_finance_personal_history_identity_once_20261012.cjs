#!/usr/bin/env node
// Actual source-pinned identity/history functions. All identities/documents are fictional.
// PGlite parity is always available; native proof is compulsory when explicitly required.
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{performance}=require('node:perf_hooks'),crypto=require('node:crypto');
const repo=path.resolve(__dirname,'..');
const os=require('node:os');
const {PGlite}=require(path.join(repo,'node_modules/@electric-sql/pglite'));
const output=process.env.FINANCE_HISTORY_IDENTITY_ONCE_OUTPUT?path.resolve(process.env.FINANCE_HISTORY_IDENTITY_ONCE_OUTPUT):fs.mkdtempSync(path.join(os.tmpdir(),'finance-history-identity-once-'));
fs.mkdirSync(output,{recursive:true});
const {Client}=require(path.join(repo,'node_modules/pg'));
const {createSummarySearchFixture}=require(path.join(repo,'scripts/check_approval_history_summary.cjs'));
const defs=JSON.parse(fs.readFileSync(path.join(repo,'scripts/fixtures/finance_history_identity_authorities_20261012.json'),'utf8'));
const def=n=>defs.find(d=>d.signature.startsWith(n+'(')).definition;
const read=p=>fs.readFileSync(path.join(repo,p),'utf8');
const nativePath=process.env.FINANCE_HISTORY_NATIVE_PG_CONFIG||process.env.FINANCE_NATIVE_PG_CONFIG;
if(process.env.FINANCE_HISTORY_NATIVE_REQUIRED==='1'&&!nativePath)throw Error('Native history identity-once proof is required, but no private PostgreSQL config was supplied');
const config=nativePath?JSON.parse(fs.readFileSync(path.resolve(nativePath),'utf8')):null;
if(config&&!['127.0.0.1','::1','localhost'].includes(config.host))throw Error('History identity-once fixtures may only connect to loopback disposable PostgreSQL');
const name='finance_history_bench_'+crypto.randomUUID().replaceAll('-','');
const tenant='00000000-0000-0000-0000-000000000001',uid='00000000-0000-0000-0000-000000000011',sid='00000000-0000-0000-0000-000000000021';
const evidence={scope:'Disposable native PostgreSQL database, fictional people and documents only; official identity function definitions retrieved read-only, no formal DML',database:name,startedAt:new Date().toISOString(),measurements:[],checks:[]};
const migration=read('supabase/migrations/20261012112652_finance_personal_history_identity_once_v1.sql');
const optimized=migration.match(/CREATE OR REPLACE FUNCTION private\.finance_personal_document_authorized_v1[\s\S]*?\$function\$;/)[0];
const sha256=value=>crypto.createHash('sha256').update(value).digest('hex');
evidence.sources={
  migrationSHA256:sha256(migration),
  authorityFixtureSHA256:sha256(read('scripts/fixtures/finance_history_identity_authorities_20261012.json')),
  testSHA256:sha256(fs.readFileSync(__filename)),
  postflightSHA256:sha256(read('scripts/finance_personal_history_identity_once_postflight.sql'))
};
let admin,client,pglite;
const check=(name)=>evidence.checks.push(name);
(async()=>{
 try{
  let db;
  if(config){
    admin=new Client(config);await admin.connect();
    for(const role of ['anon','authenticated','service_role']){
      assert((await admin.query('select 1 from pg_roles where rolname=$1',[role])).rowCount,'Native fixture role must already exist in the explicitly configured test service: '+role);
    }
    await admin.query('create database '+name);
    client=new Client({...config,database:name});await client.connect();
    db={query:(sql,args)=>client.query(sql,args),exec:async sql=>client.query(sql.replace(/create role (anon|authenticated|service_role);/g,''))};
  }else{pglite=new PGlite();db=pglite;}
  evidence.engine=config?'native PostgreSQL':'PGlite';
  await createSummarySearchFixture(db);
  await db.exec(`alter table public.finance_users add column name text,add column role text default 'employee',add column google_link_status text default 'bound',add column created_at timestamptz default now();
    alter table public.tenant_members add column id uuid default gen_random_uuid(),add column email text,add column created_at timestamptz default now();
    create table public.system_settings(tenant_id uuid,key text,value jsonb);
    create table auth.users(id uuid primary key);
    create table auth.identities(id uuid primary key default gen_random_uuid(),user_id uuid,provider text,identity_data jsonb,created_at timestamptz default now());
    create table auth.sessions(id uuid primary key,user_id uuid,not_after timestamptz);
    create function auth.jwt() returns jsonb language sql stable as $$select jsonb_build_object('session_id',nullif(current_setting('fixture.sid',true),''))$$;
    create function public.default_tenant_id() returns uuid language sql stable as $$select '${tenant}'::uuid$$;
    alter table public.expense_requests add column applicant_id text,add column applicant_email text;
    alter table public.bills add column applicant_id text,add column applicant_email text;
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
      ('20261010130000','finance_personal_invoice_batch_history_v1');
  `);
  await db.exec(read('scripts/fixtures/finance_procurement_payment_helpers_20260908.sql').match(/CREATE OR REPLACE FUNCTION private\.finance_expense_optional_permission_allows\([\s\S]*?\$function\$;/)[0]);
  for(const n of ['finance_verified_google_email','finance_auth_session_active','current_tenant_id','current_finance_user','current_finance_user_id','finance_current_verified_google_email_v2','finance_legacy_name_matches_current_v1','finance_identity_matches_current_v1','private.finance_personal_history_page_allows_v1','private.finance_history_actor_v1','private.finance_personal_document_authorized_v1','finance_personal_document_summary_v1','finance_personal_document_detail_v1'])await db.exec(def(n));
  for(const signature of defs.filter(d=>/finance_personal_document_|finance_history_actor_v1|finance_personal_history_page_allows_v1/.test(d.signature)).map(d=>d.signature)){
    await db.exec('revoke all on function '+signature+' from public,anon,authenticated,service_role;');
    if(signature.startsWith('finance_personal_document_summary_v1')||signature.startsWith('finance_personal_document_detail_v1'))await db.exec('grant execute on function '+signature+' to authenticated;');
  }
  const strip=sql=>sql.replace(/^\\set ON_ERROR_STOP on\r?\n/,'');
  const fingerprintSql=strip(read('scripts/finance_personal_history_identity_once_fingerprint.sql'));
  const fingerprint=async()=>(await db.query(fingerprintSql)).rows[0].fingerprint;
  const beforeFingerprint=await fingerprint();
  await db.exec('begin;');await db.exec(migration);await db.exec('rollback;');
  assert.equal(await fingerprint(),beforeFingerprint);check('actual source migration rollback preserves functions, owners, ACLs, identities and every business/projection row');
  await db.exec(`insert into public.expense_requests(id,no,tenant_id,data_environment,amount,description,department_code,form_payload,applicant_id,applicant,created_at)
    select 'R-'||lpad(n::text,5,'0'),'HIST-'||lpad(n::text,5,'0'),'${tenant}','test',1250,'虛構日照 自費紀錄','D1',jsonb_build_object('note',repeat('x',1000)),'FICT-USER','虛構查詢員','2026-09-15'::timestamptz from generate_series(1,700)n;
    insert into public.bills(id,no,tenant_id,data_environment,amount,item,department_code,applicant_id,applicant,created_at)
    select 'B-'||lpad(n::text,5,'0'),'BILL-'||lpad(n::text,5,'0'),'${tenant}','test',500,'虛構日照費用','D1','FICT-USER','虛構查詢員','2026-09-15'::timestamptz from generate_series(1,450)n;
    insert into public.invoices(id,no,tenant_id,data_environment,amount,tax,total,batch_id,buyer,description,department_code,applicant_id,applicant,created_at)
    select 'I-'||lpad(n::text,5,'0'),'INV-'||lpad(n::text,5,'0'),'${tenant}','test',1250,0,1250,case when n<=31 then 'CPR-FICTIONAL-31' end,'虛構付款者','虛構自費 課程','D1','FICT-USER','虛構查詢員','2026-09-15'::timestamptz from generate_series(1,1050)n;
    insert into public.approval_step_actor_snapshots(tenant_id,data_environment,record_type,record_id,record_no,step_index,step_title,step_status,workflow_status,role_key,resolved_user_id,acted_by_user_id,acted_at_text)
    select tenant_id,data_environment,'expense_requests',id,no,n,'虛構覆核','approved','completed','accountant',case when n=0 then 'FICT-USER' else 'OTHER-USER' end,case when n=0 then 'FICT-USER' else 'OTHER-USER' end,'2026-09-16T00:00:00Z' from public.expense_requests cross join generate_series(0,7)n;
    insert into public.approval_step_actor_snapshots(tenant_id,data_environment,record_type,record_id,record_no,step_index,step_title,step_status,workflow_status,role_key,resolved_user_id,acted_by_user_id,acted_at_text)
    select tenant_id,data_environment,'bills',id,no,n,'虛構覆核','approved','completed','accountant','FICT-USER','FICT-USER','2026-09-16T00:00:00Z' from public.bills cross join generate_series(0,7)n;
    insert into public.approval_step_actor_snapshots(tenant_id,data_environment,record_type,record_id,record_no,step_index,step_title,step_status,workflow_status,role_key,resolved_user_id,acted_by_user_id,acted_at_text)
    select tenant_id,data_environment,'invoices',id,no,n,'虛構覆核','approved','completed','accountant','FICT-USER','FICT-USER','2026-09-16T00:00:00Z' from public.invoices cross join generate_series(0,7)n;
    create index on public.approval_step_actor_snapshots(tenant_id,data_environment,resolved_user_id,updated_at desc);
    create index on public.approval_step_actor_snapshots(tenant_id,data_environment,acted_by_user_id,updated_at desc);
    analyze;
    set statement_timeout='30s';set jit=off;set work_mem='4MB';
  `);
  evidence.nativeVersion=(await db.query('select version() v')).rows[0].v;
  evidence.fixtureCounts=(await db.query("select (select count(*) from private.finance_history_source_projection_v1) sources,(select count(*) from public.approval_step_actor_snapshots) snapshots")).rows[0];
  const query=async(search=null,scope='all',offset=0)=>(await db.query('select public.finance_personal_document_summary_v1($1,50,$2,$3,\'test\') p',[scope,offset,search])).rows[0].p;
  const probes=[null,'日照','HIST-00700','1250','日照 1250','不存在的紀錄'];
  const expected=new Map();
  for(const p of probes){const start=performance.now();expected.set(p,await query(p));evidence.measurements.push({stage:'before',query:p,elapsedMs:performance.now()-start});console.log('BEFORE',JSON.stringify(evidence.measurements.at(-1)));}
  assert.equal(expected.get(null).total,2170,'31 invoice group reduces30 rows');check('all complete sources, 31-row invoice group and independent total');
  const beforeScopeMine=await query(null,'mine'),beforePage=await query(null,'all',100);
  // Execute the exact source-sealed release rehearsal, rather than certifying
  // only a separate local BEGIN/ROLLBACK that production does not use.
  const guard=require('./finance_production_release_guard.js');
  const prior=['20260825103034',...guard.REVIEWED_MIGRATION_CATALOG.filter(v=>v<'20261012112652')];
  const baselineLedger={count:1,lastVersion:prior[0],sha256:guard.ledgerSha256([prior[0]])};
  for(const version of prior)await db.query("insert into supabase_migrations.schema_migrations(version,name) values($1,'fictional_prerequisite') on conflict(version) do nothing",[version]);
  const ledgerFile=path.join(output,'synthetic-ledger.txt');fs.writeFileSync(ledgerFile,prior.join('\n')+'\n');
  const rehearsalFile=path.join(output,'protected-rehearsal.sql');
  guard.preparePersonalHistoryIdentityOnceRehearsal(path.join(repo,'supabase/migrations'),rehearsalFile,'20261012112652',ledgerFile,
    path.join(repo,'scripts/finance_personal_history_identity_once_fingerprint.sql'),
    path.join(repo,'scripts/finance_personal_history_identity_once_canary.sql'),
    path.join(repo,'scripts/finance_personal_history_identity_once_preflight.sql'),
    path.join(repo,'scripts/finance_personal_history_identity_once_postflight.sql'),baselineLedger);
  const populatedFingerprint=await fingerprint();
  await db.exec("select set_config('fixture.uid','',false)");
  await db.exec(fs.readFileSync(rehearsalFile,'utf8'));
  await db.exec("select set_config('fixture.uid','"+uid+"',false)");
  assert.equal(await fingerprint(),populatedFingerprint);check('exact protected rollback rehearsal preserves populated source/projection/identity/authority fingerprints and ledger');
  await db.exec('begin;');await db.exec(migration);
  await db.exec("insert into supabase_migrations.schema_migrations(version,name) values('20261012112652','finance_personal_history_identity_once_v1');");
  await db.exec(strip(read('scripts/finance_personal_history_identity_once_postflight.sql')));
  await db.exec(strip(read('scripts/finance_personal_history_postflight.sql')));
  await db.exec('commit;');check('actual migration and version-aware postflight install atomically with unchanged public summary/detail authority');
  for(const p of probes){const start=performance.now();const actual=await query(p);evidence.measurements.push({stage:'after',query:p,elapsedMs:performance.now()-start});assert.deepEqual(actual,expected.get(p),'full summary payload parity '+p);check('full payload parity '+p);console.log('AFTER',JSON.stringify(evidence.measurements.at(-1)));}
  assert.deepEqual(await query(null,'mine'),beforeScopeMine);assert.deepEqual(await query(null,'all',100),beforePage);check('scope and later-page exact parity');
  const plan=(await db.query("explain (analyze,buffers,format json) select count(*) from private.finance_personal_document_authorized_v1((select fu from public.finance_users fu where id='FICT-USER'),'test',null,null)")).rows[0]['QUERY PLAN'];
  evidence.optimizedPlan=plan;
  const baseline=def('private.finance_personal_document_authorized_v1');
  const expandedBody=sql=>sql.match(/AS \$function\$([\s\S]*?)\$function\$/)[1]
    .replaceAll('p_user.tenant_id',`'${tenant}'::uuid`).replaceAll('p_user.auth_user_id',`'${uid}'::uuid`)
    .replaceAll('p_user.id',"'FICT-USER'::text").replaceAll('p_user.email',"'history.fixture@suiyuecare.com'::text")
    .replaceAll('p_environment',"'test'::text").replaceAll('p_record_type','null::text').replaceAll('p_record_id','null::text');
  evidence.expandedPlans={};
  for(const [kind,sql] of [['baseline',baseline],['optimized',optimized]])evidence.expandedPlans[kind]=(await db.query('explain(analyze,buffers,format json) '+expandedBody(sql))).rows[0]['QUERY PLAN'];
  fs.writeFileSync(path.join(output,'expanded-plans.json'),JSON.stringify(evidence.expandedPlans,null,2));
  await db.exec(`insert into public.expense_requests(id,no,tenant_id,data_environment,amount,description,department_code,form_payload,applicant_id,applicant_email,applicant,created_at)
    values
    ('CASE-ID-PRIORITY','CASE-ID-PRIORITY','${tenant}','test',2,'ID priority','D1','{}','FICT-USER','other@example.invalid','其他姓名',now()),
    ('CASE-ID-REJECT','CASE-ID-REJECT','${tenant}','test',2,'ID rejects valid email','D1','{}','OTHER-USER','history.fixture@suiyuecare.com','虛構查詢員',now()),
    ('CASE-EMAIL','CASE-EMAIL','${tenant}','test',2,'Email fallback','D1','{}','  ',' History.Fixture@Suiyuecare.Com ','其他姓名',now()),
    ('CASE-PAYLOAD-ID','CASE-PAYLOAD-ID','${tenant}','test',2,'Payload ID','D1','{"applicantProfile":{"id":"FICT-USER"}}',null,'other@example.invalid','其他姓名',now()),
    ('CASE-PAYLOAD-ID-REJECT','CASE-PAYLOAD-ID-REJECT','${tenant}','test',2,'Payload wrong ID','D1','{"applicantProfile":{"id":"OTHER-USER","email":"history.fixture@suiyuecare.com","name":"虛構查詢員"}}',null,null,null,now()),
    ('CASE-PAYLOAD-EMAIL','CASE-PAYLOAD-EMAIL','${tenant}','test',2,'Two email alternatives','D1','{"applicantProfile":{"email":"history.fixture@suiyuecare.com"}}',null,'other@example.invalid',null,now()),
    ('CASE-LEGACY-NAME','CASE-LEGACY-NAME','${tenant}','test',2,'Unique legacy name','D1','{}',null,null,' 虛構查詢員 ',now()),
    ('CASE-ASSIGNED','CASE-ASSIGNED','${tenant}','test',2,'Assigned only','D1','{}','OTHER-USER','other@example.invalid','其他姓名',now()),
    ('CASE-ACTED','CASE-ACTED','${tenant}','test',2,'Actually acted','D1','{}','OTHER-USER','other@example.invalid','其他姓名',now()),
    ('CASE-RAW-EMAIL','CASE-RAW-EMAIL','${tenant}','test',2,'Raw email acted','D1','{}','OTHER-USER','other@example.invalid','其他姓名',now()),
    ('CASE-AUTOSKIP','CASE-AUTOSKIP','${tenant}','test',2,'Automatic skip','D1','{}','OTHER-USER','other@example.invalid','其他姓名',now()),
    ('CASE-APPLICANT-STEP','CASE-APPLICANT-STEP','${tenant}','test',2,'Applicant step not signed action','D1','{}','OTHER-USER','other@example.invalid','其他姓名',now());
    insert into public.approval_step_actor_snapshots(tenant_id,data_environment,record_type,record_id,record_no,step_index,step_status,role_key,resolved_user_id,acted_by_user_id,raw_actor_email,acted_at_text,raw_step)
    values
    ('${tenant}','test','expense_requests','CASE-ASSIGNED','CASE-ASSIGNED',0,'pending','accountant','FICT-USER',null,null,null,'{}'),
    ('${tenant}','test','expense_requests','CASE-ACTED','CASE-ACTED',0,'returned','accountant','OTHER-USER','FICT-USER',null,'2026-10-01','{}'),
    ('${tenant}','test','expense_requests','CASE-RAW-EMAIL','CASE-RAW-EMAIL',0,'approved','accountant','OTHER-USER',null,'history.fixture@suiyuecare.com','2026-10-01','{}'),
    ('${tenant}','test','expense_requests','CASE-AUTOSKIP','CASE-AUTOSKIP',0,'approved','accountant','FICT-USER','FICT-USER',null,'2026-10-01','{"autoSkip":true}'),
    ('${tenant}','test','expense_requests','CASE-APPLICANT-STEP','CASE-APPLICANT-STEP',0,'approved','applicant_submit','FICT-USER','FICT-USER',null,'2026-10-01','{}');
    insert into public.invoices(id,no,tenant_id,data_environment,amount,total,batch_id,description,department_code,applicant_id,applicant,created_at)
    values('CASE-BATCH-SECRET','CASE-BATCH-SECRET','${tenant}','test',999999,999999,'CPR-FICTIONAL-31','不應看到的同批發票','D1','OTHER-USER','其他姓名',now()),
      ('CASE-BATCH-FOREIGN','CASE-BATCH-FOREIGN','00000000-0000-0000-0000-000000000002','test',999999,999999,'CPR-FICTIONAL-31','外租戶同批','D1','FICT-USER','虛構查詢員',now()),
      ('CASE-BATCH-ENV','CASE-BATCH-ENV','${tenant}','production',999999,999999,'CPR-FICTIONAL-31','正式環境同批','D1','FICT-USER','虛構查詢員',now());
  `);
  await db.exec(baseline);const expectedCases=await query('CASE-');const expectedBatch=await query('CPR-FICTIONAL-31');
  await db.exec(optimized);assert.deepEqual(await query('CASE-'),expectedCases);assert.deepEqual(await query('CPR-FICTIONAL-31'),expectedBatch);check('ID, email, payload fallback, unique names, actual action, assigned-only, autoSkip and applicant steps full payload parity');
  assert.deepEqual(expectedCases.items.map(x=>x.record_id).sort(),['CASE-ID-PRIORITY','CASE-EMAIL','CASE-PAYLOAD-ID','CASE-PAYLOAD-EMAIL','CASE-LEGACY-NAME','CASE-ACTED','CASE-RAW-EMAIL'].sort());check('seven independently enumerated accepted sources; conflicting strong identity and merely assigned denied');
  assert.equal(expectedBatch.items[0].source_count,31);assert.equal(expectedBatch.items[0].summary.amount,38750);assert(!JSON.stringify(expectedBatch).includes('CASE-BATCH-'));check('ineligible same-batch, cross-tenant and cross-environment rows remain absent from count, amount and source_ids');
  const matrix=[];let matrixNo=0;
  const currentName='虛構查詢員',currentEmail='history.fixture@suiyuecare.com',currentId='FICT-USER';
  const primaryIds=[null,'','  ',currentId,' '+currentId+' ','OTHER-USER',currentId.toLowerCase()];
  const profileIds=[null,'',currentId,' '+currentId+' ','OTHER-USER',currentId.toLowerCase()];
  const emailInputs=[null,'','   ',currentEmail,' History.Fixture@SuiyueCare.Com ','wrong@example.invalid'];
  const nameInputs=[null,'','   ',currentName,' '+currentName+' ','不同人'];
  const trim=x=>x==null?null:String(x).trim(),nonempty=x=>trim(x)||null;
  for(const primary of primaryIds)for(const profile of profileIds){const chosen=nonempty(primary)||nonempty(profile);matrix.push({category:'IDs primary/profile priority',primaryId:primary,profileId:profile,primaryEmail:currentEmail,profileEmail:currentEmail,primaryName:currentName,profileName:currentName,expected:chosen?chosen===currentId:true});}
  for(const primary of emailInputs)for(const profile of emailInputs){const chosenEmails=[primary,profile].map(nonempty).filter(Boolean).map(x=>x.toLowerCase());matrix.push({category:'Two email alternatives',primaryId:null,profileId:null,primaryEmail:primary,profileEmail:profile,primaryName:currentName,profileName:null,expected:chosenEmails.length?chosenEmails.includes(currentEmail):true});}
  for(const primary of nameInputs)for(const profile of nameInputs){matrix.push({category:'Two legacy name alternatives',primaryId:null,profileId:null,primaryEmail:null,profileEmail:null,primaryName:primary,profileName:profile,expected:[primary,profile].map(nonempty).filter(Boolean).includes(currentName)});}
  for(const c of matrix){c.recordId='CASE-MATRIX-'+String(++matrixNo).padStart(3,'0');await db.query(`insert into public.expense_requests(id,no,tenant_id,data_environment,amount,description,department_code,form_payload,applicant_id,applicant_email,applicant,created_at)
    values($1,$1,$2,'test',2,'虛構身份矩陣','D1',$3,$4,$5,$6,'2026-09-01')`,[c.recordId,tenant,JSON.stringify({applicantProfile:{id:c.profileId,email:c.profileEmail,name:c.profileName}}),c.primaryId,c.primaryEmail,c.primaryName]);}
  await db.exec(baseline);const matrixBaseline=[];const matrixExpectedIds=matrix.filter(c=>c.expected).map(c=>c.recordId).sort();
  for(let offset=0;offset<matrixExpectedIds.length;offset+=50)matrixBaseline.push(await query('CASE-MATRIX-','all',offset));
  await db.exec(optimized);const matrixActualIds=[];
  for(let n=0;n<matrixBaseline.length;n++){const actual=await query('CASE-MATRIX-','all',n*50);assert.deepEqual(actual,matrixBaseline[n],'identity matrix full-payload page '+n);matrixActualIds.push(...actual.items.map(x=>x.record_id));}
  assert.deepEqual(matrixActualIds.sort(),matrixExpectedIds);assert.equal(matrixBaseline[0].total,matrixExpectedIds.length);evidence.identityMatrix={caseCount:matrix.length,acceptedCount:matrixExpectedIds.length,pageCount:matrixBaseline.length,cases:matrix};check('114 individually enumerated double ID, double email, double legacy-name null/blank/duplicate/conflict/case/trim cases: independently expected membership and entire paginated payload parity');
  await db.exec(`insert into public.finance_users(id,tenant_id,email,active,name) values('FICT-DUP','${tenant}','duplicate@example.invalid',false,'虛構查詢員');`);
  await db.exec(baseline);const ambiguous=await query('CASE-LEGACY-NAME');await db.exec(optimized);assert.deepEqual(await query('CASE-LEGACY-NAME'),ambiguous);assert.equal(ambiguous.total,0);check('legacy name ambiguity includes inactive same-name row exactly as baseline');
  const denyScenarios=[['revoked session',`update auth.sessions set not_after=now()-interval '1 second' where id='${sid}'`,`update auth.sessions set not_after=null where id='${sid}'`],['inactive tenant member',"update public.tenant_members set active=false where finance_user_id='FICT-USER'","update public.tenant_members set active=true where finance_user_id='FICT-USER'"],['Google identity unverified',"update auth.identities set identity_data=jsonb_set(identity_data,'{email_verified}','false')","update auth.identities set identity_data=jsonb_set(identity_data,'{email_verified}','true')"],['inactive Finance user',"update public.finance_users set active=false where id='FICT-USER'","update public.finance_users set active=true where id='FICT-USER'"],['page grant denied',`insert into public.system_settings values('${tenant}','role_permissions','{"employee":{"approvals":false}}')`,"delete from public.system_settings where key='role_permissions'"]];
  denyScenarios.push(
    ['anonymous identity',"select set_config('fixture.uid','',false)","select set_config('fixture.uid','"+uid+"',false)"],
    ['absent session identity',"select set_config('fixture.sid','',false)","select set_config('fixture.sid','"+sid+"',false)"],
    ['malformed session identity',"select set_config('fixture.sid','not-a-uuid',false)","select set_config('fixture.sid','"+sid+"',false)"],
    ['unbound Google Finance account',"update public.finance_users set google_link_status='pending_first_login' where id='FICT-USER'","update public.finance_users set google_link_status='bound' where id='FICT-USER'"],
    ['mismatched verified Google email',"update auth.identities set identity_data=jsonb_set(identity_data,'{email}','\"wrong@suiyuecare.com\"')","update auth.identities set identity_data=jsonb_set(identity_data,'{email}','\"history.fixture@suiyuecare.com\"')"],
    ['unapproved Google email domain',"update auth.identities set identity_data=jsonb_set(identity_data,'{email}','\"history.fixture@example.invalid\"')","update auth.identities set identity_data=jsonb_set(identity_data,'{email}','\"history.fixture@suiyuecare.com\"')"],
    ['disabled Finance product module',"insert into public.system_settings values('"+tenant+"','product_modules','[{\"id\":\"finance-core\",\"enabled\":false}]')","delete from public.system_settings where key='product_modules'"]
  );
  evidence.permissionNegativeCases=denyScenarios.map(([label])=>label);
  for(const [label,mutate,restore] of denyScenarios){await db.exec(mutate);await db.exec(baseline);await assert.rejects(()=>query(),e=>e.code==='42501',label+' baseline');await db.exec(optimized);await assert.rejects(()=>query(),e=>e.code==='42501',label+' optimized');await db.exec(restore);check(label+' rejects in both baseline and optimized');}
  fs.writeFileSync(path.join(output,'authorized-plan.json'),JSON.stringify(plan,null,2));
  await db.exec("select set_config('fixture.uid','',false)");
  await db.exec(read('scripts/finance_personal_history_identity_once_canary.sql'));check('exact rollback-only metadata/anonymous-denial canary returns safely without staff impersonation');
  evidence.finishedAt=new Date().toISOString();evidence.passed=true;
 }catch(e){evidence.passed=false;evidence.error={message:e.message,code:e.code,stack:e.stack};console.error(evidence.error);process.exitCode=1;}
 finally{if(client)await client.end();if(pglite)await pglite.close();if(admin){await admin.query('drop database if exists '+name+' with(force)');await admin.end();}fs.writeFileSync(path.join(output,'evidence.json'),JSON.stringify(evidence,null,2));console.log('EVIDENCE',JSON.stringify({passed:evidence.passed,checks:evidence.checks.length,path:path.join(output,'evidence.json')}));}
})();
