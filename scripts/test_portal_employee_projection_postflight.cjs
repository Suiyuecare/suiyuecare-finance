#!/usr/bin/env node
'use strict';
// Actual shipped postflight predicate, isolated synthetic tables/claims only.
// Native execution refuses remote databases and uses a fresh disposable database.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
const root=path.resolve(__dirname,'..'),sourcePath=path.join(root,'scripts/finance_production_db_postflight.sql');
const source=fs.readFileSync(sourcePath,'utf8'),sourceSha256=crypto.createHash('sha256').update(source).digest('hex');
const begin='-- FINANCE_PORTAL_IDENTITY_CURRENT_V1_BEGIN',end='-- FINANCE_PORTAL_IDENTITY_CURRENT_V1_END';
assert.equal(source.split(begin).length,2);assert.equal(source.split(end).length,2);
const body=source.split(begin)[1].split(end)[0].trim(),guard='do $identity_guard$\n'+body+'\n$identity_guard$;';
assert.match(body,/20260828015718/,'historical repair ledger remains required');
assert.doesNotMatch(body.replace(/--[^\n]*/g,'').replace(/'(?:[^']|'')*'/g,"'literal'"),/\b(?:insert|update|delete|alter|create|drop|truncate|execute|call|copy)\b/i,'the identity gate must be read-only');
const T='00000000-0000-0000-0000-000000000001',F='u_1785138353548',A='c50e9e4f-0b63-44e9-b445-9dd5fe7d9f2e',P='b1f0c6bd-3e22-45c0-b6f4-81d7ebd3d369',E1='cfde5d8e-df81-4539-bc90-013f018333df',E8='d114b583-824e-42c9-9d4e-5ab3cf17ac65',EMP='6c101aa3-b91d-4590-ae7a-5df070af2793',OLD='73c0ce88-c0f7-4276-ba0e-938cea9d53ce',D1='11111111-1111-4111-8111-111111111111',D8='88888888-8888-4888-8888-888888888888',OTHER='22222222-2222-4222-8222-222222222222';
const fixture=`
 create schema auth;create schema private;create schema supabase_migrations;
 create table supabase_migrations.schema_migrations(version text,name text);
 insert into supabase_migrations.schema_migrations values('20260828015718','repair_admin_ntpc_portal_employee_link_20260828');
 create table auth.users(id uuid,email text,email_confirmed_at timestamptz);
 create table auth.identities(user_id uuid,provider text,identity_data jsonb);
 create table public.finance_users(id text,tenant_id uuid,name text,email text,role text,entity_id text,department_code text,active boolean,org_status text,auth_user_id uuid,google_link_status text,google_login_verified_at timestamptz,pending_login_email text,member_revision bigint);
 create table public.companies(id uuid,code text,status text,deleted_at timestamptz);
 create table public.departments(id uuid,company_id uuid,code text,status text,deleted_at timestamptz);
 create table public.employee_department_roles(id text,tenant_id uuid,finance_user_id text,department_id uuid,department_code text,role_key text,is_primary boolean,active boolean,effective_from date,effective_to date);
 create table public.employees(id uuid,company_id uuid,employee_no text,full_name text,email text,employment_status text,metadata jsonb,primary_department_id uuid,deleted_at timestamptz);
 create table public.users(id uuid,auth_user_id uuid,company_id uuid,employee_id uuid,email text,status text,deleted_at timestamptz);
 create table public.tenant_members(tenant_id uuid,finance_user_id text,active boolean);
 create table public.finance_identity_links(tenant_id uuid,finance_user_id text,active boolean);
 create table private.finance_member_admin_events_v1(id uuid,tenant_id uuid,finance_user_id text,action text,actor_finance_user_id text,actor_auth_user_id uuid,after_state jsonb);
 insert into auth.users values('${A}','admin.ntpc@suiyuecare.com',now());
 insert into auth.identities values('${A}','google','{"email":"admin.ntpc@suiyuecare.com","email_verified":true}');
 insert into public.finance_users values('${F}','${T}','虛構已核准人員','admin.ntpc@suiyuecare.com','employee','E1','A1104',true,'active','${A}','bound',now(),null,2);
 insert into public.companies values('${E1}','E1','active',null),('${E8}','E8','active',null);
 insert into public.departments values('${D1}','${E1}','A1104','active',null),('${D8}','${E8}','B1100','active',null);
 insert into public.employee_department_roles values('current-primary','${T}','${F}','${D1}','A1104','employee',true,true,'2026-01-01',null);
 insert into public.employees values('${EMP}','${E1}','${F}','虛構已核准人員','admin.ntpc@suiyuecare.com','active','{"finance_user_id":"${F}"}','${D1}',null),('${OLD}','${E8}','${F}','虛構已核准人員','admin.ntpc@suiyuecare.com','active','{"finance_user_id":"${F}"}','${D8}',null);
 insert into public.users values('${P}','${A}','${E1}','${EMP}','admin.ntpc@suiyuecare.com','active',null);
 insert into private.finance_member_admin_events_v1 values('${OTHER}','${T}','${F}','update','fixture-authorized-ceo','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',jsonb_build_object('name','虛構已核准人員','login_email','admin.ntpc@suiyuecare.com','role','employee','entity_id','E1','department_code','A1104','active',true,'member_revision',2,'google_link_status','bound'));
`;
// Update the independently stored authorized after_state in tests representing
// legitimate atomic admin operations. Negative tests deliberately omit it.
const auditSync=`update private.finance_member_admin_events_v1 a set after_state=a.after_state||jsonb_build_object('name',f.name,'role',f.role,'entity_id',f.entity_id,'department_code',f.department_code,'active',f.active,'member_revision',f.member_revision,'google_link_status',f.google_link_status) from public.finance_users f where a.finance_user_id=f.id and a.tenant_id=f.tenant_id;`;
const pending=`update public.finance_users set auth_user_id=null,google_login_verified_at=null,google_link_status='pending_first_login';update public.users set auth_user_id=null;`+auditSync;
const offboard=`update public.finance_users set active=false,org_status='inactive';update public.users set status='disabled',deleted_at=now();update public.employees set employment_status='terminated',deleted_at=now() where company_id='${E1}';update public.employee_department_roles set active=false;`+auditSync;
const cases=[
 ['reviewed formal identifier mapping and revision2 authority','',true],
 ['active historical employee in another company has no Portal authority','',true],
 ['authorized company and department move uses new canonical employee',`update public.finance_users set entity_id='E8',department_code='B1100',member_revision=3;update public.employee_department_roles set department_id='${D8}',department_code='B1100';update public.users set company_id='${E8}',employee_id='${OLD}';`+auditSync,true],
 ['authorized renamed person preserves stable identity',`update public.finance_users set name='虛構新姓名',member_revision=3;update public.employees set full_name='虛構新姓名';`+auditSync,true],
 ['verified primary-email change does not rewrite old personnel audit',`update public.finance_users set email='approved.rename@suiyuecare.com';update auth.users set email='approved.rename@suiyuecare.com';update auth.identities set identity_data=jsonb_build_object('email','approved.rename@suiyuecare.com','email_verified',true);update public.users set email='approved.rename@suiyuecare.com';update public.employees set email='approved.rename@suiyuecare.com';`,true],
 ['authorized unbound first-login projection remains visible',pending,true],
 ['authorized first login with no employee or Portal projection yet',pending+`delete from public.users;delete from public.employees where company_id='${E1}';`,true],
 ['pending rebind preserves the current verified identity only',`update public.finance_users set google_link_status='pending_rebind',pending_login_email='pending.target@suiyuecare.com';`+auditSync,true],
 ['authorized offboarding retains zero active access projections',offboard,true],
 ['foreign company violates current Finance authority',`update public.users set company_id='${E8}',employee_id='${OLD}';`,false,/linkage/],
 ['wrong canonical employee number',`update public.employees set employee_no='another-person' where id='${EMP}';`,false,/canonical employee/],
 ['wrong employee stable-ID metadata',`update public.employees set metadata='{"finance_user_id":"another-person"}' where id='${EMP}';`,false,/canonical employee/],
 ['missing linked employee',`update public.users set employee_id='${OTHER}';`,false,/linkage/],
 ['duplicate active Portal through historical employee',`insert into public.users values('${OTHER}','${OTHER}','${E8}','${OLD}','other@suiyuecare.com','active',null);`,false,/duplicated/],
 ['duplicate current-company employee metadata',`insert into public.employees values('${OTHER}','${E1}','other-number','虛構已核准人員','other@suiyuecare.com','active','{"finance_user_id":"${F}"}','${D1}',null);`,false,/employee is duplicated/],
 ['Portal Auth mismatch',`update public.users set auth_user_id='${OTHER}';`,false,/linkage/],
 ['Auth primary email mismatch',`update auth.users set email='wrong@suiyuecare.com';`,false,/verified Google identity/],
 ['unverified Google identity',`update auth.identities set identity_data=jsonb_build_object('email','admin.ntpc@suiyuecare.com','email_verified',false);`,false,/verified Google identity/],
 ['missing Google provider',`update auth.identities set provider='email';`,false,/verified Google identity/],
 ['missing authorized personnel source',`delete from private.finance_member_admin_events_v1;`,false,/authorized source/],
 ['stale audit revision',`update private.finance_member_admin_events_v1 set after_state=after_state||'{"member_revision":1}';`,false,/authorized source/],
 ['coherent but unauthorized department change',`update public.finance_users set department_code='NEW';update public.departments set code='NEW' where id='${D1}';update public.employee_department_roles set department_code='NEW';`,false,/authorized source/],
 ['primary department belongs to a foreign company',`update public.departments set company_id='${E8}' where id='${D1}';`,false,/company\/department/],
 ['two current primary assignments',`insert into public.employee_department_roles select 'second-primary',tenant_id,finance_user_id,department_id,department_code,role_key,is_primary,active,effective_from,effective_to from public.employee_department_roles;`,false,/primary department/],
 ['unauthorized offboarding lacks matching revision',`update public.finance_users set active=false,org_status='inactive';`,false,/authorized source/],
 ['offboard still has active Portal',offboard+`update public.users set status='active',deleted_at=null;`,false,/offboarded/],
 ['offboard still has active Finance membership',offboard+`insert into public.tenant_members values('${T}','${F}',true);`,false,/offboarded/],
 ['pending first-login retains old Auth',pending+`update public.finance_users set auth_user_id='${A}';`,false,/pending first login/],
 ['pending first-login Portal prematurely bound',pending+`update public.users set auth_user_id='${A}';`,false,/pending first login/],
 ['pending first-login old Finance identity link',pending+`insert into public.finance_identity_links values('${T}','${F}',true);`,false,/pending first login/],
 ['pending first-login lacks explicit pending audit',pending+`update private.finance_member_admin_events_v1 set after_state=after_state||'{"google_link_status":"bound"}';`,false,/pending first login/],
 ['pending rebind target receives premature Portal access',`update public.finance_users set google_link_status='pending_rebind',pending_login_email='pending.target@suiyuecare.com';insert into public.users values('${OTHER}','${OTHER}','${E8}','${OTHER}','pending.target@suiyuecare.com','active',null);`+auditSync,false,/pending target/],
 ['pending rebind target equals current verified email',`update public.finance_users set google_link_status='pending_rebind',pending_login_email=email;`+auditSync,false,/pending target/],
 ['offboard retains active current-company employee',offboard+`update public.employees set employment_status='active',deleted_at=null where id='${EMP}';`,false,/offboarded/],
 ['missing binding state',`update public.finance_users set google_link_status=null;`,false,/verified binding/],
 ['blocked binding state',`update public.finance_users set google_link_status='blocked';`,false,/verified binding/],
 ['bound identity retained uncompleted target',`update public.finance_users set pending_login_email='pending.target@suiyuecare.com';`,false,/inconsistent pending target/],
 ['foreign corporate identity is rejected',`update public.finance_users set email='external@example.invalid';`,false,/unavailable/],
 ['foreign pending corporate target is rejected',`update public.finance_users set google_link_status='pending_rebind',pending_login_email='external@example.invalid';`+auditSync,false,/pending target/],
 ['pending target is reserved by another active Finance person',`update public.finance_users set google_link_status='pending_rebind',pending_login_email='pending.target@suiyuecare.com';insert into public.finance_users(id,tenant_id,email,active) values('other-person','${T}','pending.target@suiyuecare.com',true);`+auditSync,false,/pending target/],
 ['Taipei effective date while session uses America/Adak',`set local timezone='America/Adak';update public.employee_department_roles set effective_from=(current_timestamp at time zone 'Asia/Taipei')::date,effective_to=(current_timestamp at time zone 'Asia/Taipei')::date;`,true],
 ['Taipei effective date while session uses Pacific/Kiritimati',`set local timezone='Pacific/Kiritimati';update public.employee_department_roles set effective_from=(current_timestamp at time zone 'Asia/Taipei')::date,effective_to=(current_timestamp at time zone 'Asia/Taipei')::date;`,true],
 ['Taipei effective date while session uses Etc/GMT+12',`set local timezone='Etc/GMT+12';update public.employee_department_roles set effective_from=(current_timestamp at time zone 'Asia/Taipei')::date,effective_to=(current_timestamp at time zone 'Asia/Taipei')::date;`,true],
 ['expired Taipei authority is refused even if session date is yesterday',`set local timezone='America/Adak';update public.employee_department_roles set effective_to=(current_timestamp at time zone 'Asia/Taipei')::date-1;`,false,/primary department/],
 ['future Taipei authority is refused even if session date is tomorrow',`set local timezone='Pacific/Kiritimati';update public.employee_department_roles set effective_from=(current_timestamp at time zone 'Asia/Taipei')::date+1;`,false,/primary department/],
 ['private authority audit cannot grant public write access',`grant insert on private.finance_member_admin_events_v1 to public;`,false,/unauthorized mutation/],
 ['missing original reviewed repair ledger',`delete from supabase_migrations.schema_migrations;`,false,/repair is absent/]
];
const evidence={scope:'Actual source postflight predicate and synthetic claims/roles; no production mutation or employee Google login',sourceSha256,runs:[]};
async function run(db,label){
 await db.exec(fixture);const results=[];
 const stateQuery=`select md5(jsonb_build_object('finance',(select jsonb_agg(to_jsonb(f)) from public.finance_users f),'portal',(select jsonb_agg(to_jsonb(u)) from public.users u),'employees',(select jsonb_agg(to_jsonb(e)) from public.employees e),'authority',(select jsonb_agg(to_jsonb(r)) from public.employee_department_roles r),'events',(select jsonb_agg(to_jsonb(a)) from private.finance_member_admin_events_v1 a))::text) fingerprint`;
 const fullPostflight=source.replace(/^\\set ON_ERROR_STOP on\r?\n/,'').replace(/select pg_catalog\.set_config\('finance\.release_migration_versions', :'migration_versions', false\);/,"select pg_catalog.set_config('finance.release_migration_versions','none',true);");
 await db.exec('begin read only;');await assert.rejects(()=>db.exec(fullPostflight),/v1 baseline is absent/,'full outer postflight including nested identity block must compile');await db.exec('rollback');
 await db.exec('begin read only;'+guard+'rollback;');
 for(const [name,change,allowed,error]of cases){
  await db.exec('begin;'+change);
  try{const timezoneContext=(await db.query("select current_date::text sessionDate,((current_timestamp at time zone 'Asia/Taipei')::date)::text taipeiDate,current_setting('timezone') timezone")).rows[0];if(allowed){const before=(await db.query(stateQuery)).rows[0].fingerprint;await db.exec(guard);assert.equal((await db.query(stateQuery)).rows[0].fingerprint,before,'guard writes no source rows');}else await assert.rejects(()=>db.exec(guard),error||/Portal|repair/);results.push({name,pass:true,timezoneContext});}
  finally{await db.exec('rollback');}
 }
 assert.equal(crypto.createHash('sha256').update(fs.readFileSync(sourcePath)).digest('hex'),sourceSha256,'postflight source must not change during execution');
 const timezoneEvidence=(await db.query("select current_date session_date,(current_timestamp at time zone 'Asia/Taipei')::date taipei_date,current_setting('timezone') timezone")).rows[0];
 evidence.runs.push({fullPostflightCompiled:true,businessTimezone:'Asia/Taipei',timezoneEvidence,engine:label,version:(await db.query('show server_version')).rows[0].server_version,checks:results});
 console.log('PASS '+label+' '+results.length+' Portal projection postflight checks');
}
async function main(){
 const pglite=new PGlite();try{await run(pglite,'PGlite');}finally{await pglite.close();}
 const configPath=process.env.FINANCE_NATIVE_PG_CONFIG;
 if(configPath){
  assert.equal(fs.statSync(configPath).mode&0o077,0,'native configuration must be owner-only');
  const config=JSON.parse(fs.readFileSync(configPath));assert(['127.0.0.1','::1','localhost'].includes(config.host));assert.equal(config.database,'postgres');assert(!config.ssl);assert(Number.isInteger(config.port)&&config.port>0&&config.port<65536);
  const {Client}=require('pg'),admin=new Client(config),name='portal_postflight_'+crypto.randomUUID().replaceAll('-','');let client,created=false;
  await admin.connect();try{await admin.query('create database '+name);created=true;client=new Client({...config,database:name});await client.connect();await run({exec:s=>client.query(s),query:(s,a)=>client.query(s,a)},'Native PostgreSQL');}finally{if(client){await client.query('rollback').catch(()=>{});await client.end();}if(created)await admin.query('drop database '+name);await admin.end();}
 }
 if(process.env.FINANCE_PORTAL_PROJECTION_EVIDENCE)fs.writeFileSync(process.env.FINANCE_PORTAL_PROJECTION_EVIDENCE,JSON.stringify(evidence,null,2)+'\n');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
