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
const authorityPaths=['supabase/migrations/20260821143000_atomic_member_admin_v1.sql','supabase/migrations/20260907154759_finance_org_integrity_v2.sql','scripts/fixtures/portal_projection_authorities_20261012.json'];
const authoritySources=authorityPaths.map(p=>({path:p,bytes:fs.readFileSync(path.join(root,p),'utf8')}));
const authorityProof=authoritySources.map(({path,bytes})=>({path,sha256:crypto.createHash('sha256').update(bytes).digest('hex')}));
const [memberSource,orgSource,catalogSource]=authoritySources.map(x=>x.bytes),catalog=JSON.parse(catalogSource);
const actualFunction=sig=>{const f=catalog.functions.find(f=>f.signature===sig);assert(f,'actual catalog function '+sig);return f.definition;};
const googleSource=actualFunction('private.finance_complete_verified_google_account_link_v2(uuid,text,uuid)'),offboardSource=actualFunction('finance_user_offboarding_execute(text,text,text,text)');
const one=(s,re,label)=>{const m=s.match(re);assert(m,'actual source section '+label);return m[0];};
// Execute original mutation statements plus the real row-revision trigger. The
// dependency projections/claims below are synthetic; this is not full OAuth or
// end-to-end org/offboarding workflow acceptance.
const triggerSource=one(memberSource,/create or replace function private\.finance_bump_member_revision_v1\(\)[\s\S]*?\$function\$;/i,'member revision function');
const eventWriter=one(memberSource,/  insert into private\.finance_member_admin_events_v1 \([\s\S]*?\n  \);/,'immutable member event writer');
const googleWriter=one(googleSource,/    update public\.finance_users fu\n[\s\S]*?and fu\.google_link_revision = v_finance\.google_link_revision;/,'Google finalizer Finance writer');
const projectionFunction=one(orgSource,/CREATE OR REPLACE FUNCTION private\.finance_membership_org_publish_projection_v1\([\s\S]*?\$function\$;/,'organization projection function');
const projectionOffset=projectionFunction.indexOf('  update public.finance_users user_row'),projectionStart=projectionFunction.lastIndexOf('  with units as (',projectionOffset),projectionEnd=projectionFunction.indexOf(';',projectionOffset);
assert(projectionStart>0&&projectionEnd>projectionOffset);const orgWriter=projectionFunction.slice(projectionStart,projectionEnd+1);
const publishFunction=one(orgSource,/CREATE OR REPLACE FUNCTION public\.membership_org_publish_draft\([\s\S]*?\$function\$;/,'organization publish function');
const publishWriter=one(publishFunction,/  update private\.finance_membership_org_versions_v1 version_row\n[\s\S]*?returning \* into v_version;/,'published version writer');
const offboardWriter=one(offboardSource,/  update public\.finance_users finance_user\n[\s\S]*?and finance_user\.active is true;/,'offboarding Finance writer');
const offboardEventWriter=one(offboardSource,/  insert into private\.finance_user_offboarding_operations \([\s\S]*?\n  \);/,'completed offboarding event writer');
const snapshot=code=>JSON.stringify({units:[{id:'fixture-unit',code,active:true,unit_type:'section'}],assignments:[{id:'current-primary',finance_user_id:F,org_unit_id:'fixture-unit',assignment_kind:'primary',active:true,role_key:'employee'}]});
const fixture=`
 create schema auth;create schema private;create schema supabase_migrations;
 create table supabase_migrations.schema_migrations(version text,name text);
 insert into supabase_migrations.schema_migrations values('20260828015718','repair_admin_ntpc_portal_employee_link_20260828');
 create table auth.users(id uuid,email text,email_confirmed_at timestamptz,deleted_at timestamptz);
 create table auth.identities(user_id uuid,provider text,identity_data jsonb);
 create table public.finance_users(id text,tenant_id uuid,name text,email text,role text,entity_id text,department_code text,active boolean,org_status text,auth_user_id uuid,google_link_status text,google_login_verified_at timestamptz,pending_login_email text,member_revision bigint,org_source text,org_source_updated_at timestamptz,logging_identity_id text,google_link_revision bigint default 1,google_link_status_detail text,google_last_linked_at timestamptz,org_contact_email text,job_title text,extension text);
 create table public.companies(id uuid,code text,status text,deleted_at timestamptz);
 create table public.departments(id uuid,company_id uuid,code text,status text,deleted_at timestamptz);
 create table public.employee_department_roles(id text,tenant_id uuid,finance_user_id text,department_id uuid,department_code text,role_key text,is_primary boolean,active boolean,effective_from date,effective_to date);
 create table public.employees(id uuid,company_id uuid,employee_no text,full_name text,email text,employment_status text,metadata jsonb,primary_department_id uuid,deleted_at timestamptz);
 create table public.users(id uuid,auth_user_id uuid,company_id uuid,employee_id uuid,email text,status text,deleted_at timestamptz);
 create table public.tenant_members(tenant_id uuid,finance_user_id text,active boolean);
 create table public.finance_identity_links(tenant_id uuid,finance_user_id text,active boolean);
 create table private.finance_member_admin_events_v1(id uuid default gen_random_uuid(),tenant_id uuid,finance_user_id text,action text,actor_finance_user_id text,actor_auth_user_id uuid,before_state jsonb,after_state jsonb,created_at timestamptz default clock_timestamp());
 create table private.finance_membership_org_versions_v1(id uuid,tenant_id uuid,version_no bigint,status text,snapshot jsonb,published_at timestamptz,effective_at timestamptz,created_by_finance_user_id text,approved_by_finance_user_id text,validation_summary jsonb,source_runtime_revision text,updated_at timestamptz);
 create table private.finance_user_offboarding_operations(id text,tenant_id uuid,departing_finance_user_id text,successor_finance_user_id text,actor_finance_user_id text,reason text,preview_revision text,result jsonb,created_at timestamptz default clock_timestamp());
 insert into auth.users values('${A}','admin.ntpc@suiyuecare.com',now(),null);
 insert into auth.identities values('${A}','google','{"email":"admin.ntpc@suiyuecare.com","email_verified":true}');
 insert into public.finance_users(id,tenant_id,name,email,role,entity_id,department_code,active,org_status,auth_user_id,google_link_status,google_login_verified_at,pending_login_email,member_revision) values('${F}','${T}','虛構已核准人員','admin.ntpc@suiyuecare.com','employee','E1','A1104',true,'active','${A}','bound',now(),null,2);
 insert into public.companies values('${E1}','E1','active',null),('${E8}','E8','active',null);
 insert into public.departments values('${D1}','${E1}','A1104','active',null),('${D8}','${E8}','B1100','active',null);
 insert into public.employee_department_roles values('current-primary','${T}','${F}','${D1}','A1104','employee',true,true,'2026-01-01',null);
 insert into public.employees values('${EMP}','${E1}','${F}','虛構已核准人員','admin.ntpc@suiyuecare.com','active','{"finance_user_id":"${F}"}','${D1}',null),('${OLD}','${E8}','${F}','虛構已核准人員','admin.ntpc@suiyuecare.com','active','{"finance_user_id":"${F}"}','${D8}',null);
 insert into public.users values('${P}','${A}','${E1}','${EMP}','admin.ntpc@suiyuecare.com','active',null);
 insert into private.finance_member_admin_events_v1 values('${OTHER}','${T}','${F}','update','fixture-authorized-ceo','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','{}',jsonb_build_object('name','虛構已核准人員','login_email','admin.ntpc@suiyuecare.com','role','employee','entity_id','E1','department_code','A1104','active',true,'member_revision',2,'google_link_status','bound'),now()-interval '2 days');
 insert into private.finance_membership_org_versions_v1 values('${OTHER}','${T}',8,'published','${snapshot('A1104')}',now()-interval '1 day',now()-interval '1 day','fixture-authorized-ceo',null,'{"ok":true}',null,null);
 ${triggerSource}
 create trigger finance_users_member_revision_v1 before insert or update on public.finance_users for each row execute function private.finance_bump_member_revision_v1();
 create function private.finance_org_runtime_revision_v2(uuid) returns text language sql as $$select 'fixture-revision'::text$$;
`;
// New events are emitted by the original member API INSERT, not by modifying
// prior history. Exact query extraction fails closed when writer source drifts.
const adminEvent=()=>`do $admin_writer$ declare v_tenant_id uuid:='${T}';v_finance_user_id text:='${F}';v_action text:='update';v_actor_id text:='fixture-authorized-ceo';v_actor_auth_user_id uuid:='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';v_before jsonb:='{}';v_after public.finance_users%rowtype;begin select * into v_after from public.finance_users where id=v_finance_user_id;${eventWriter}end;$admin_writer$;`;
const publishedOrg=code=>`do $org_writer$ declare p_tenant_id uuid:='${T}';p_snapshot jsonb:='${snapshot(code)}';v_departments jsonb:='[{"c":"${code}","eid":"E1"}]';v_version private.finance_membership_org_versions_v1%rowtype;v_actor jsonb:='{"finance_user_id":"fixture-authorized-ceo"}';v_validation jsonb:='{"ok":true}';begin select * into v_version from private.finance_membership_org_versions_v1 where status='published';update private.finance_membership_org_versions_v1 set snapshot=p_snapshot where id=v_version.id;${orgWriter}${publishWriter}end;$org_writer$;`;
const googleBind=email=>`do $google_writer$ declare v_finance public.finance_users%rowtype;v_google_email text:='${email}';p_auth_user_id uuid:='${A}';v_target_revision bigint;begin select * into v_finance from public.finance_users where id='${F}';v_target_revision:=v_finance.google_link_revision+1;${googleWriter}end;$google_writer$;update auth.identities set identity_data=jsonb_build_object('email','${email}','email_verified',true);update public.users set auth_user_id='${A}',email='${email}';update public.employees set email='${email}';`;
const pending=`update public.finance_users set auth_user_id=null,google_login_verified_at=null,google_link_status='pending_first_login';update public.users set auth_user_id=null;`+adminEvent();
const offboardProjection=`update public.users set status='disabled',deleted_at=now();update public.employees set employment_status='terminated',deleted_at=now() where company_id='${E1}';update public.employee_department_roles set active=false;`;
const offboard=`update public.finance_users set active=false,org_status='inactive';`+adminEvent()+offboardProjection;
const actualOffboard=`do $offboard_writer$ declare v_actor public.finance_users%rowtype;p_departing_finance_user_id text:='${F}';p_successor_finance_user_id text:=null;v_operation_id text:='off_fixture';v_reason text:='虛構已核准離職';p_expected_revision text:='fixture-preview';v_result jsonb:='{"ok":true,"deactivated":true,"operation_id":"off_fixture"}';begin v_actor.id:='fixture-authorized-ceo';v_actor.tenant_id:='${T}';${offboardWriter}${offboardEventWriter}end;$offboard_writer$;`+offboardProjection;
const pendingRebind=`update public.finance_users set google_link_status='pending_rebind',pending_login_email='pending.target@suiyuecare.com';`+adminEvent();
const cases=[
 ['reviewed formal mapping and latest revision2 authority','',true],
 ['active historical employee in another company has no Portal authority','',true],
 ['actual org projection and publish writer bump revision with no new member event',publishedOrg('A1104'),true],
 ['actual org projection legally changes primary department',`update public.departments set code='NEW' where id='${D1}';update public.employee_department_roles set department_code='NEW';`+publishedOrg('NEW'),true],
 ['actual Google finalizer Finance writer bumps revision and does not rewrite personnel audit',googleBind('admin.ntpc@suiyuecare.com'),true],
 ['verified provider primary-email rename permits old auth.users email',googleBind('approved.rename@suiyuecare.com'),true],
 ['actual first-bind writer finalizes pending first-login after a separate admin event',pending+googleBind('admin.ntpc@suiyuecare.com'),true],
 ['actual verified rebind writer consumes pending target',pendingRebind+googleBind('pending.target@suiyuecare.com'),true],
 ['actual offboarding writer uses its separate completed operation authority',actualOffboard,true],
 ['authorized company and department move uses canonical current employee',`update public.finance_users set entity_id='E8',department_code='B1100';update public.employee_department_roles set department_id='${D8}',department_code='B1100';update public.users set company_id='${E8}',employee_id='${OLD}';`+adminEvent(),true],
 ['authorized renamed person emits new latest event',`update public.finance_users set name='虛構新姓名';update public.employees set full_name='虛構新姓名';`+adminEvent(),true],
 ['authorized unbound first-login projection remains visible',pending,true],
 ['authorized first login has no employee or Portal projection yet',pending+`delete from public.users;delete from public.employees where company_id='${E1}';`,true],
 ['pending rebind preserves current verified identity only',pendingRebind,true],
 ['authorized inactive member has zero active access projections',offboard,true],
 ['foreign company violates current Finance authority',`update public.users set company_id='${E8}',employee_id='${OLD}';`,false,/linkage/],
 ['wrong canonical employee number',`update public.employees set employee_no='another-person' where id='${EMP}';`,false,/canonical employee/],
 ['wrong employee stable-ID metadata',`update public.employees set metadata='{"finance_user_id":"another-person"}' where id='${EMP}';`,false,/canonical employee/],
 ['missing linked employee',`update public.users set employee_id='${OTHER}';`,false,/linkage/],
 ['duplicate active Portal through historical employee',`insert into public.users values('${OTHER}','${OTHER}','${E8}','${OLD}','other@suiyuecare.com','active',null);`,false,/duplicated/],
 ['duplicate current-company employee metadata',`insert into public.employees values('${OTHER}','${E1}','other-number','虛構已核准人員','other@suiyuecare.com','active','{"finance_user_id":"${F}"}','${D1}',null);`,false,/employee is duplicated/],
 ['Portal Auth mismatch',`update public.users set auth_user_id='${OTHER}';`,false,/linkage/],
 ['verified Google provider primary email mismatch',`update auth.identities set identity_data='{"email":"wrong@suiyuecare.com","email_verified":true}';`,false,/verified Google identity/],
 ['unverified Google identity',`update auth.identities set identity_data='{"email":"admin.ntpc@suiyuecare.com","email_verified":false}';`,false,/verified Google identity/],
 ['missing Google provider',`update auth.identities set provider='email';`,false,/verified Google identity/],
 ['deleted current Auth',`update auth.users set deleted_at=now();`,false,/verified Google identity/],
 ['duplicate verified Google primary identity',`insert into auth.users values('${OTHER}','admin.ntpc@suiyuecare.com',now(),null);insert into auth.identities values('${OTHER}','google','{"email":"admin.ntpc@suiyuecare.com","email_verified":true}');`,false,/verified Google identity/],
 ['missing personnel source',`delete from private.finance_member_admin_events_v1;`,false,/authorized source/],
 ['audit revision exceeds current row',`update private.finance_member_admin_events_v1 set after_state=after_state||'{"member_revision":999}';`,false,/authorized source/],
 ['an older matching event cannot hide a newer different name',`insert into private.finance_member_admin_events_v1 select gen_random_uuid(),tenant_id,finance_user_id,action,actor_finance_user_id,actor_auth_user_id,before_state,after_state||'{"name":"虛構最新異動"}',clock_timestamp() from private.finance_member_admin_events_v1;`,false,/authorized source/],
 ['an older matching event cannot hide a newer wrong role',`insert into private.finance_member_admin_events_v1 select gen_random_uuid(),tenant_id,finance_user_id,action,actor_finance_user_id,actor_auth_user_id,before_state,after_state||'{"role":"accountant"}',clock_timestamp() from private.finance_member_admin_events_v1;`,false,/authorized source/],
 ['metadata row revision does not imply unauthorized personnel business changes',`update public.finance_users set google_link_status_detail='fixture projection repaired';`,true],
 ['coherent but unauthorized department change',`update public.finance_users set department_code='NEW';update public.departments set code='NEW' where id='${D1}';update public.employee_department_roles set department_code='NEW';`,false,/published organization authority/],
 ['archived matching organization cannot authorize new department',`update public.finance_users set department_code='NEW';update public.departments set code='NEW' where id='${D1}';update public.employee_department_roles set department_code='NEW';update private.finance_membership_org_versions_v1 set status='archived';`,false,/published organization authority/],
 ['duplicate published organization versions',`insert into private.finance_membership_org_versions_v1 select '${D8}',tenant_id,9,status,snapshot,published_at,effective_at,created_by_finance_user_id,approved_by_finance_user_id,validation_summary,source_runtime_revision,updated_at from private.finance_membership_org_versions_v1;`,false,/published organization authority/],
 ['unvalidated published organization',`update private.finance_membership_org_versions_v1 set validation_summary='{"ok":false}';`,false,/published organization authority/],
 ['future organization publication',`update private.finance_membership_org_versions_v1 set effective_at=now()+interval '1 day';`,false,/published organization authority/],
 ['published primary assignment inactive',`update private.finance_membership_org_versions_v1 set snapshot=jsonb_set(snapshot,'{assignments,0,active}','false');`,false,/published organization authority/],
 ['published current primary duplicates',`update private.finance_membership_org_versions_v1 set snapshot=jsonb_set(snapshot,'{assignments}',(snapshot->'assignments')||(snapshot->'assignments'));`,false,/published organization authority/],
 ['department move cannot reuse an older organization snapshot',`update public.finance_users set department_code='NEW';update public.departments set code='NEW' where id='${D1}';update public.employee_department_roles set department_code='NEW';update private.finance_membership_org_versions_v1 set snapshot='${snapshot('NEW')}',published_at=now()-interval '3 days';`,false,/authorized source/],
 ['primary department belongs to foreign company',`update public.departments set company_id='${E8}' where id='${D1}';`,false,/company\/department/],
 ['two current primary assignments',`insert into public.employee_department_roles select 'second-primary',tenant_id,finance_user_id,department_id,department_code,role_key,is_primary,active,effective_from,effective_to from public.employee_department_roles;`,false,/primary department/],
 ['unauthorized offboarding lacks event',`update public.finance_users set active=false,org_status='inactive';`,false,/authorized source/],
 ['failed offboarding operation cannot authorize inactive state',actualOffboard+`update private.finance_user_offboarding_operations set result=result||'{"ok":false}';`,false,/authorized source/],
 ['historical offboarding cannot override newer active member event',actualOffboard+`update private.finance_user_offboarding_operations set created_at=now()-interval '3 days';`,false,/authorized source/],
 ['offboard still has active Portal',offboard+`update public.users set status='active',deleted_at=null;`,false,/offboarded/],
 ['offboard still has active Finance membership',offboard+`insert into public.tenant_members values('${T}','${F}',true);`,false,/offboarded/],
 ['pending first-login retains old Auth',pending+`update public.finance_users set auth_user_id='${A}';`,false,/pending first login/],
 ['pending first-login Portal prematurely bound',pending+`update public.users set auth_user_id='${A}';`,false,/pending first login/],
 ['pending first-login old Finance identity link',pending+`insert into public.finance_identity_links values('${T}','${F}',true);`,false,/pending first login/],
 ['pending first-login latest audit is not explicit pending',pending+`update private.finance_member_admin_events_v1 set after_state=after_state||'{"google_link_status":"bound"}' where created_at=(select max(created_at) from private.finance_member_admin_events_v1);`,false,/pending first login/],
 ['pending rebind target premature Portal access',pendingRebind+`insert into public.users values('${OTHER}','${OTHER}','${E8}','${OTHER}','pending.target@suiyuecare.com','active',null);`,false,/pending target/],
 ['pending rebind target equals current email',`update public.finance_users set google_link_status='pending_rebind',pending_login_email=email;`+adminEvent(),false,/pending target/],
 ['offboard retains active current-company employee',offboard+`update public.employees set employment_status='active',deleted_at=null where id='${EMP}';`,false,/offboarded/],
 ['missing binding state',`update public.finance_users set google_link_status=null;`,false,/verified binding/],
 ['blocked binding state',`update public.finance_users set google_link_status='blocked';`,false,/verified binding/],
 ['bound identity retained pending target',`update public.finance_users set pending_login_email='pending.target@suiyuecare.com';`,false,/inconsistent pending target/],
 ['foreign corporate identity rejected',`update public.finance_users set email='external@example.invalid';`,false,/unavailable/],
 ['foreign pending corporate target rejected',`update public.finance_users set google_link_status='pending_rebind',pending_login_email='external@example.invalid';`+adminEvent(),false,/pending target/],
 ['pending target reserved by other active person',pendingRebind+`insert into public.finance_users(id,tenant_id,email,active) values('other-person','${T}','pending.target@suiyuecare.com',true);`,false,/pending target/],
 ['Taipei effective date under America/Adak',`set local timezone='America/Adak';update public.employee_department_roles set effective_from=(current_timestamp at time zone 'Asia/Taipei')::date,effective_to=(current_timestamp at time zone 'Asia/Taipei')::date;`,true],
 ['Taipei effective date under Pacific/Kiritimati',`set local timezone='Pacific/Kiritimati';update public.employee_department_roles set effective_from=(current_timestamp at time zone 'Asia/Taipei')::date,effective_to=(current_timestamp at time zone 'Asia/Taipei')::date;`,true],
 ['Taipei effective date under Etc/GMT+12',`set local timezone='Etc/GMT+12';update public.employee_department_roles set effective_from=(current_timestamp at time zone 'Asia/Taipei')::date,effective_to=(current_timestamp at time zone 'Asia/Taipei')::date;`,true],
 ['expired Taipei authority refused',`set local timezone='America/Adak';update public.employee_department_roles set effective_to=(current_timestamp at time zone 'Asia/Taipei')::date-1;`,false,/primary department/],
 ['future Taipei authority refused',`set local timezone='Pacific/Kiritimati';update public.employee_department_roles set effective_from=(current_timestamp at time zone 'Asia/Taipei')::date+1;`,false,/primary department/],
 ['private member audit public write denied',`grant insert on private.finance_member_admin_events_v1 to public;`,false,/unauthorized mutation/],
 ['private organization audit public write denied',`grant update on private.finance_membership_org_versions_v1 to public;`,false,/unauthorized mutation/],
 ['private offboarding audit public write denied',`grant insert on private.finance_user_offboarding_operations to public;`,false,/unauthorized mutation/],
 ['private member audit column write denied',`grant update(after_state) on private.finance_member_admin_events_v1 to public;`,false,/unauthorized column mutation/],
 ['private organization snapshot column write denied',`grant update(snapshot) on private.finance_membership_org_versions_v1 to public;`,false,/unauthorized column mutation/],
 ['private offboarding result column write denied',`grant update(result) on private.finance_user_offboarding_operations to public;`,false,/unauthorized column mutation/],
 ['missing historical repair ledger',`delete from supabase_migrations.schema_migrations;`,false,/repair is absent/]
];
const evidence={scope:'Actual source postflight predicate and synthetic claims/roles; no production mutation or employee Google login',sourceSha256,authoritySources:authorityProof,runs:[]};
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
 for(const item of authorityProof)assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root,item.path))).digest('hex'),item.sha256,'authority source must remain unchanged');
 console.log('PASS '+label+' '+results.length+' Portal projection postflight checks');
}
async function main(){
 const pglite=new PGlite();try{await run(pglite,'PGlite');}finally{await pglite.close();}
 const configPath=process.env.FINANCE_NATIVE_PG_CONFIG;
 if(configPath){
  assert.equal(fs.statSync(configPath).mode&0o077,0,'native configuration must be owner-only');
  const config=JSON.parse(fs.readFileSync(configPath));assert(['127.0.0.1','::1','localhost'].includes(config.host));assert.equal(config.database,'postgres');assert(!config.ssl);assert(Number.isInteger(config.port)&&config.port>0&&config.port<65536);assert.notEqual(config.port,5432,'refuse the default PostgreSQL service port');
  const {Client}=require('pg'),admin=new Client(config),name='portal_postflight_'+crypto.randomUUID().replaceAll('-','');let client,created=false;
  await admin.connect();try{await admin.query('create database '+name);created=true;client=new Client({...config,database:name});await client.connect();await run({exec:s=>client.query(s),query:(s,a)=>client.query(s,a)},'Native PostgreSQL');}finally{if(client){await client.query('rollback').catch(()=>{});await client.end();}if(created)await admin.query('drop database '+name);await admin.end();}
 }
 if(process.env.FINANCE_PORTAL_PROJECTION_EVIDENCE)fs.writeFileSync(process.env.FINANCE_PORTAL_PROJECTION_EVIDENCE,JSON.stringify(evidence,null,2)+'\n');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
