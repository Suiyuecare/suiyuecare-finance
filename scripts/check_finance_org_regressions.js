#!/usr/bin/env node
'use strict';
// Executes the migration's real functions against isolated anonymous fixtures.
// This is not a replay of the adopted production baseline or production acceptance.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),vm=require('node:vm');
const {PGlite}=require(process.env.FINANCE_PGLITE_MODULE||'@electric-sql/pglite');
const root=path.resolve(__dirname,'..');
const migration=fs.readFileSync(path.join(root,'supabase/migrations/20260907154759_finance_org_integrity_v2.sql'),'utf8');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const tenant='10000000-0000-0000-0000-000000000001';
const tenant2='20000000-0000-0000-0000-000000000001';
const db=new PGlite();
let tests=0;
async function check(name,fn){await fn();tests++;console.log('PASS '+name);}
async function value(sql,args=[]){return (await db.query(sql,args)).rows[0].v;}
async function actor(id,role,authId='30000000-0000-0000-0000-000000000001'){
  await db.query("select set_config('test.actor',$1,false),set_config('test.role',$2,false),set_config('test.auth',$3,false),set_config('test.tenant',$4,false)",[id,role,authId,tenant]);
}
function functionSql(name){
  const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const pattern=new RegExp('create or replace function '+escaped+'\\([\\s\\S]*?\\$'+'(fn|function)'+'\\$;','i');
  const match=migration.match(pattern);assert(match,'Missing actual function '+name);return match[0];
}
(async()=>{
await db.exec(`
create schema private; create schema auth; create schema extensions;
create role anon;create role authenticated;create role service_role;
set check_function_bodies=off;
set timezone='UTC';
create function extensions.digest(text,text) returns bytea language sql immutable as $$select sha256(convert_to($1,'UTF8'))$$;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.auth',true),'')::uuid$$;
create function public.current_tenant_id() returns uuid language sql stable as $$select nullif(current_setting('test.tenant',true),'')::uuid$$;
create function public.current_finance_user_id() returns text language sql stable as $$select nullif(current_setting('test.actor',true),'')$$;
create function public.current_finance_role() returns text language sql stable as $$select nullif(current_setting('test.role',true),'')$$;
create table public.tenants(id uuid primary key);
create table public.finance_users(id text primary key,tenant_id uuid,name text,role text,active boolean default true,
 department_code text default 'D1',entity_id text default 'E1',member_revision bigint default 1,org_status text,ready boolean default true);
create table public.employee_department_roles(id text primary key,tenant_id uuid,finance_user_id text,department_code text,
 role_key text,is_primary boolean,active boolean,effective_from date,effective_to date,updated_at timestamptz,metadata jsonb,
 direct_supervisor_finance_user_id text,is_department_manager boolean default false,is_department_director boolean default false,can_approve boolean default false);
create table public.finance_identity_links(id text);
create table public.system_settings(tenant_id uuid,key text,value jsonb,version bigint default 1);
create table public.departments(code text,deleted_at timestamptz);
create table private.finance_membership_org_versions_v1(id uuid primary key default gen_random_uuid(),tenant_id uuid,version_no bigint,status text,
 title text,reason text,snapshot jsonb,revision bigint default 1,etag text,validation_summary jsonb,impact_summary jsonb,
 source_version_id uuid,effective_at timestamptz,created_by_finance_user_id text,submitted_by_finance_user_id text,submitted_at timestamptz,
 approved_by_finance_user_id text,published_at timestamptz,created_at timestamptz default now(),updated_at timestamptz);
create unique index one_published on private.finance_membership_org_versions_v1(tenant_id) where status='published';
create table private.fixture_outbox(tenant_id uuid,version_no bigint,unique(tenant_id,version_no));
create function private.fixture_outbox_enqueue() returns trigger language plpgsql as $$
begin if new.status='published' then insert into private.fixture_outbox values(new.tenant_id,new.version_no) on conflict do nothing;end if;return new;end;$$;
create trigger finance_membership_org_versions_edoc_v2 after insert or update of status,etag on private.finance_membership_org_versions_v1 for each row execute function private.fixture_outbox_enqueue();
create function private.finance_membership_org_etag_v1(jsonb,bigint) returns text language sql as $$select md5($1::text||$2::text)$$;
create function public.finance_org_chart_rows_for_tenant(uuid) returns jsonb language sql as $$select coalesce(jsonb_agg(to_jsonb(r)),'[]') from public.employee_department_roles r where tenant_id=$1 and is_primary$$;
create function public.finance_org_signer_is_runtime_ready(uuid,text) returns boolean language sql stable as $$select coalesce((select active and ready from public.finance_users where tenant_id=$1 and id=$2),false)$$;
create function private.finance_membership_org_departments_v1(uuid,jsonb) returns jsonb language sql stable as $$select '[]'::jsonb$$;
create function public.finance_assert_department_settings(jsonb,uuid) returns void language plpgsql as $$begin return;end;$$;
create function public.save_finance_org_chart_rows(jsonb) returns jsonb language sql as $$select '{}'::jsonb$$;
create function public.finance_admin_upsert_member_atomic_v1(p_member jsonb,p_expected_revision bigint default null) returns jsonb language plpgsql security definer as $$
declare v_id text:=coalesce(p_member->>'id','new-person');begin
 insert into public.finance_users(id,tenant_id,name,role,active,member_revision)
 values(v_id,public.current_tenant_id(),p_member->>'name',p_member->>'role',true,1)
 on conflict(id) do update set name=excluded.name,role=excluded.role,member_revision=finance_users.member_revision+1;
 insert into public.employee_department_roles(id,tenant_id,finance_user_id,department_code,role_key,is_primary,active,effective_from)
 values('primary-'||v_id,public.current_tenant_id(),v_id,'D1',p_member->>'role',true,true,'2020-01-01') on conflict(id) do nothing;
 return jsonb_build_object('ok',true,'atomic',true,'member',(select to_jsonb(u) from public.finance_users u where id=v_id));end;$$;
create function public.finance_save_org_chart_atomic(p_rows jsonb,p_summary text default '') returns jsonb language plpgsql as $$
begin update public.employee_department_roles set updated_at=clock_timestamp() where tenant_id=public.current_tenant_id() and is_primary;
return jsonb_build_object('ok',true,'rows',p_rows);end;$$;
create function public.finance_user_offboarding_execute(p_departing_finance_user_id text,p_successor_finance_user_id text,p_reason text,p_expected_revision text) returns jsonb language sql as $$select '{"ok":true}'::jsonb$$;
create function public.finance_admin_save_user_google_login_v2(p_finance_user_id text,p_requested_email text,p_expected_revision bigint) returns jsonb language sql as $$select '{"ok":true}'::jsonb$$;
`);

await db.exec(`
alter table public.finance_users add column email text default 'fixture@suiyuecare.com',add column role_label text,add column org_source text,add column org_source_updated_at timestamptz;
alter table public.departments add column id uuid default gen_random_uuid(),add column created_at timestamptz default now();
alter table public.employee_department_roles add column department_id uuid,add column position_id uuid,add column role_type text,
 add column relation_type text,add column approval_delegate_finance_user_id text,add column permissions_override jsonb,add column created_at timestamptz default now();
create table public.tenant_members(tenant_id uuid,finance_user_id text,department_code text,entity_id text,updated_at timestamptz,active boolean);
create function private.finance_membership_org_actor_v1(boolean,boolean) returns jsonb language plpgsql as $$
begin
 if auth.uid() is null or public.current_finance_role() not in ('hr','admin_director','ceo') then raise exception 'not allowed' using errcode='42501';end if;
 if $2 and public.current_finance_role()<>'ceo' then raise exception 'CEO required' using errcode='42501';end if;
 return jsonb_build_object('tenant_id',public.current_tenant_id(),'finance_user_id',public.current_finance_user_id(),'role',public.current_finance_role());
end;$$;
create function public.finance_jsonb_pick_text(jsonb,text[]) returns text language sql immutable as $$select $1->>key from unnest($2) key where nullif($1->>key,'') is not null limit 1$$;
create function public.finance_jsonb_pick_bool(jsonb,text[],boolean) returns boolean language sql immutable as $$select coalesce(($1->>(select key from unnest($2) key where $1 ? key limit 1))::boolean,$3)$$;
create function public.finance_stable_setting_id(text,text) returns text language sql immutable as $$select $1||'_'||$2$$;
create function public.is_finance_admin() returns boolean language sql stable as $$select public.current_finance_role() in ('ceo','admin_director','hr')$$;
create function public.finance_publish_department_settings_atomic(jsonb,bigint) returns jsonb language sql as $$select '{"ok":true}'::jsonb$$;
`);
// The adopted live prerequisite hashes are independently verified; fixtures do not fake them.
await db.exec(migration.replace(/do \$preflight\$[\s\S]*?\$preflight\$;/,'').replace(/do \$resolver_preflight\$[\s\S]*?\$resolver_preflight\$;/,''));
await db.exec(`
create or replace function private.finance_membership_org_seed_snapshot_v1(p_tenant_id uuid)
returns jsonb language sql stable as $$
select jsonb_build_object('schema_version',2,'units',
 '[{"id":"share","code":"GOV_SHAREHOLDERS","name":"Share","unit_type":"shareholders","active":true},
   {"id":"board","code":"GOV_BOARD","name":"Board","unit_type":"board","active":true,"parent_org_unit_id":"share"},
   {"id":"exec","code":"GOV_EXECUTIVE","name":"Exec","unit_type":"executive","active":true,"parent_org_unit_id":"board"},
   {"id":"dept-seed","code":"D1","name":"Dept","unit_type":"department","active":true,"parent_org_unit_id":"exec","entity_scope_mode":"explicit","entity_codes":["E1","E2"],"is_posting_unit":true}]'::jsonb,
 'assignments',(select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'finance_user_id',r.finance_user_id,'org_unit_id','dept-seed',
 'position_code','MEMBER','assignment_kind',case when r.is_primary then 'primary' else 'secondary' end,
 'active',r.active,'role_key',r.role_key,'effective_from',r.effective_from,'effective_to',r.effective_to)),'[]'::jsonb)
 from public.employee_department_roles r join public.finance_users u on u.id=r.finance_user_id and u.tenant_id=r.tenant_id
 where r.tenant_id=p_tenant_id and r.active and u.active),
 'reporting_overrides','[]'::jsonb);
$$;
insert into public.tenants values ('${tenant}'),('${tenant2}');
insert into public.finance_users(id,tenant_id,name,role) values
 ('staff','${tenant}','Staff','employee'),('hr','${tenant}','HR','hr'),('boss','${tenant}','Boss','admin_director'),
 ('ceo','${tenant}','CEO','ceo'),('old-boss','${tenant}','Expired','dept_manager'),('deputy','${tenant}','Deputy','dept_manager');
insert into public.employee_department_roles(id,tenant_id,finance_user_id,department_code,role_key,is_primary,active,effective_from)
select 'primary-'||id,tenant_id,id,'D1',role,true,true,'2020-01-01' from public.finance_users;
insert into public.employee_department_roles(id,tenant_id,finance_user_id,department_code,role_key,is_primary,active,effective_from,metadata,can_approve) values('cashier-control','${tenant}','ceo','D1','cashier',false,true,'2020-01-01','{}',true);
insert into public.system_settings values('${tenant}','entities','[{"id":"E1"},{"id":"E2"}]',1);insert into public.departments(code) values('D1');
`);
await actor('staff','employee');
await check('Taipei date-only end is inclusive and timestamp end is exclusive',async()=>{
 const row={active:true,effective_from:'2026-01-01',effective_to:'2026-01-01'};
 assert.equal(await value('select private.finance_org_effective_now_v2($1,$2) v',[row,'2025-12-31T15:59:59Z']),false);
 assert.equal(await value('select private.finance_org_effective_now_v2($1,$2) v',[row,'2026-01-01T15:59:59Z']),true);
 assert.equal(await value('select private.finance_org_effective_now_v2($1,$2) v',[row,'2026-01-01T16:00:00Z']),false);
 assert.equal(await value('select private.finance_org_effective_now_v2($1,$2) v',[{active:true,effective_to:'2026-01-01T12:00:00Z'},'2026-01-01T12:00:00Z']),false);
 assert.equal(await value('select private.finance_org_effective_now_v2($1) v',[{effective_from:'invalid'}]),false);
});
const dated={units:[{id:'D',active:true}],assignments:[{id:'old',finance_user_id:'old-boss',org_unit_id:'D',head_kind:'permanent',active:true,can_approve:true,effective_to:'2020-01-02'},{id:'dep',finance_user_id:'deputy',org_unit_id:'D',head_kind:'acting',active:true,can_approve:true}],reporting_overrides:[{finance_user_id:'staff',supervisor_finance_user_id:'old-boss',active:true,effective_from:'2099-01-01'}]};
await check('future and expired overrides do not select stale supervisors',async()=>{
 assert.equal(await value('select private.finance_membership_org_supervisor_v1($1,$2,$3) v',[dated,'staff','D']),'deputy');
 const s=structuredClone(dated);s.reporting_overrides[0]={...s.reporting_overrides[0],effective_from:'2020-01-01',effective_to:'2020-01-02'};
 assert.equal(await value('select private.finance_membership_org_supervisor_v1($1,$2,$3) v',[s,'staff','D']),'deputy');
 s.assignments.pop();await assert.rejects(value('select private.finance_membership_org_supervisor_v1($1,$2,$3) v',[s,'staff','D']),/已到期/);
});
await actor('boss','admin_director');
await check('reconciliation publishes a new snapshot without changing any runtime role',async()=>{
 const before=await value('select jsonb_agg(to_jsonb(r) order by id) v from public.employee_department_roles r');
 const r=await value('select private.finance_org_publish_runtime_v2($1,$2,$3) v',[tenant,'boss','Fixture reconciliation']);assert.ok(r.org_version_id);
 assert.deepEqual(await value('select jsonb_agg(to_jsonb(r) order by id) v from public.employee_department_roles r'),before);
 assert.equal(await value("select count(*)::int v from private.finance_membership_org_versions_v1 where status='published'"),1);
});
await check('canonical merge preserves designed hierarchy, scopes, identity and control roles',async()=>{
 await db.exec('begin');
 const snapshot=await value("select snapshot v from private.finance_membership_org_versions_v1 where status='published'");
 const d=structuredClone(snapshot);d.units=d.units.map(u=>u.code==='D1'?{...u,id:'designed-dept',parent_org_unit_id:'division-designed',entity_scope_mode:'explicit',entity_codes:['E1','E2']}:u);
 d.units.push({id:'division-designed',code:'DV',name:'Designed Division',unit_type:'division',parent_org_unit_id:'exec',active:true});
 d.assignments=d.assignments.map(a=>({...a,org_unit_id:a.org_unit_id==='dept-seed'?'designed-dept':a.org_unit_id}));
 d.assignments.push({id:'governance-explicit',finance_user_id:'ceo',org_unit_id:'exec',assignment_kind:'secondary',position_code:'GENERAL_MANAGER',head_kind:'permanent',can_approve:true,active:true});
 await db.query("update private.finance_membership_org_versions_v1 set snapshot=$1 where status='published'",[d]);
 const merged=await value('select private.finance_org_snapshot_from_runtime_v2($1) v',[tenant]);
 assert.equal(merged.units.find(u=>u.code==='D1').id,'designed-dept');assert.equal(merged.units.find(u=>u.code==='D1').parent_org_unit_id,'division-designed');
 assert.ok(merged.assignments.some(a=>a.role_key==='cashier'&&a.finance_user_id==='ceo'));
 assert.equal(merged.assignments.find(a=>a.id==='governance-explicit').position_code,'GENERAL_MANAGER');
 await db.exec('rollback');
});
await check('publication preserves independent financial roles byte-for-byte',async()=>{
 const snapshot=await value('select private.finance_org_snapshot_from_runtime_v2($1) v',[tenant]);
 const before=await value("select to_jsonb(r) v from public.employee_department_roles r where id='cashier-control'");
 const r=await value("select private.finance_membership_org_publish_projection_v1($1,$2,'40000000-0000-0000-0000-000000000001') v",[tenant,snapshot]);assert.equal(r.ok,true);
 assert.deepEqual(await value("select to_jsonb(r) v from public.employee_department_roles r where id='cashier-control'"),before);
});
await check('full-table supervisor edits enforce optimistic revision and reject legacy saves',async()=>{
 const revision=await value('select private.finance_org_runtime_revision_v2($1) v',[tenant]);
 const out=await value('select public.finance_save_org_chart_versioned_v2($1,$2,$3) v',[[{userId:'staff',supervisorId:'boss'}],revision,'Fixture edit']);assert.ok(out.org_revision);
 await assert.rejects(value('select public.finance_save_org_chart_versioned_v2($1,$2,$3) v',[[{userId:'staff',supervisorId:'ceo'}],revision,'Stale edit']),/其他人變更/);
 await assert.rejects(value("select public.finance_save_org_chart_atomic('[]','old') v"),/版本保護/);
});
await check('member editor keeps existing HR privileges and updates canonical snapshot atomically',async()=>{
 await actor('hr','hr');const before=await value("select count(*)::int v from private.finance_membership_org_versions_v1");
 const result=await value('select public.finance_admin_upsert_member_atomic_v1($1,1) v',[{id:'staff',name:'Updated Staff',role:'employee'}]);assert.equal(result.ok,true);
 assert.equal(await value("select count(*)::int v from private.finance_membership_org_versions_v1"),before+1);
 await actor('staff','employee');await assert.rejects(value('select public.finance_admin_upsert_member_atomic_v1($1,2) v',[{id:'staff',name:'No',role:'ceo'}]),/not allowed/);
});
await check('inconsistent member publication rolls back the preceding member mutation',async()=>{
 await actor('boss','admin_director');await db.exec('begin');
 await db.query("insert into public.finance_users(id,tenant_id,name,role) values('missing-primary',$1,'Missing','employee')",[tenant]);
 await assert.rejects(value('select public.finance_admin_upsert_member_atomic_v1($1,2) v',[{id:'staff',name:'Must rollback',role:'employee'}]),/一致性檢查/);
 await db.exec('rollback');assert.equal(await value("select name v from public.finance_users where id='staff'"),'Updated Staff');
});
function code(start,end){const i=html.indexOf(start),j=html.indexOf(end,i+start.length);assert(i>=0&&j>i);return html.slice(i,j);}
function ctx(extra){const c={Date,Array,Number,Error,console,...extra};c.window=c;return vm.createContext(c);}
await check('save errors stop draft submit and validation; successful save permits submit',async()=>{
 const calls=[];let fail=true;
 const c=ctx({MEMBERSHIP_ORG_DRAFT:{version:{id:'draft',etag:'etag'},snapshot:{newData:true},dirty:true},getSb:()=>({rpc:async(name)=>{calls.push(name);return name==='membership_org_save_draft'&&fail?{error:{message:'stale'}}:{data:{ok:true,version:{id:'draft'},snapshot:{newData:true},validation:{errors:[],warnings:[]}}};}}),alert:()=>{},confirm:()=>true,friendlyErrorMessage:e=>e.message,renderMembershipOrgManager:()=>{},setTopSyncStatus:()=>{}});
 vm.runInContext(code('window.saveMembershipOrgDraft=','window.publishMembershipOrgDraft='),c);
 await c.submitMembershipOrgDraft();assert.deepEqual(calls,['membership_org_save_draft']);calls.length=0;
 await c.validateMembershipOrgDraft();assert.deepEqual(calls,['membership_org_save_draft']);calls.length=0;fail=false;
 await c.submitMembershipOrgDraft();assert.deepEqual(calls,['membership_org_save_draft','membership_org_submit_draft']);
});
await check('unit name edits preserve multi-company, inherited and group scopes',async()=>{
 for(const mode of ['explicit','inherit','all']){
 const unit={id:'unit',name:'Before',unit_type:'department',parent_org_unit_id:'parent',entity_scope_mode:mode,entity_codes:['E1','E2'],is_posting_unit:true};
 const fields={'org-unit-edit-id':{value:'unit'},'org-unit-edit-name':{value:'After'},'org-unit-edit-type':{value:'department'},'org-unit-edit-parent':{value:'parent'},'org-unit-edit-scope':{value:mode},'org-unit-edit-entity':{value:'E1',selectedOptions:[{value:'E1'},{value:'E2'}]},'org-unit-edit-code':{value:'D1'},'org-unit-edit-head':{value:'boss'},'org-unit-edit-members':{selectedOptions:[{value:'boss'}]},'org-unit-edit-posting':{checked:true}};
 const c=ctx({el:id=>fields[id],MEMBERSHIP_ORG_DRAFT:{snapshot:{units:[unit]}},cloneSettingValue:x=>structuredClone(x),membershipOrgDraftUnit:()=>unit,membershipOrgApplyUnitPeople:()=>{},closeModal:()=>{},renderMembershipOrgManager:()=>{}});
 vm.runInContext(code('window.saveMembershipOrgUnitEditor=','window.membershipOrgAddChild='),c);await c.saveMembershipOrgUnitEditor();assert.deepEqual(Array.from(unit.entity_codes),['E1','E2']);assert.equal(unit.entity_scope_mode,mode);
 }
});
await check('failed graph load is visible; inline scripts remain syntactically valid',async()=>{
 const c=ctx({MEMBERSHIP_ORG_RUNTIME:{available:false,error:'permission denied'},MEMBERSHIP_ORG_DRAFT:{},membershipOrgRuntimeGraph:()=>null,escAttr:String});
 vm.runInContext(code('function membershipOrgStatusHtml(){','function membershipOrgPeopleOptions('),c);assert.match(c.membershipOrgStatusHtml(),/讀取失敗/);assert.doesNotMatch(c.membershipOrgStatusHtml(),/status ok/);
 for(const m of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))if(m[1].trim())new vm.Script(m[1]);
});
await check('new actor resolution uses dated organization rather than stale context supervisor',async()=>{
 await db.exec(`
 create function public.finance_approval_runtime_require_user() returns text language sql stable as $$select public.current_finance_user_id()$$;
 create function public.finance_org_user_context(text) returns jsonb language sql stable as $$select '{"ok":true,"department":{"code":"D1"},"approval_chain":{"direct_supervisor_finance_user_id":"old-boss","department_director_finance_user_id":"old-boss"}}'::jsonb$$;
 create table public.approval_delegations(tenant_id uuid,active boolean,delegator_finance_user_id text,delegatee_finance_user_id text,starts_at timestamptz,ends_at timestamptz,role_key text);
 `);
 await actor('staff','employee');await db.exec('begin');
 const snap={...structuredClone(dated),units:[{id:'D',code:'D1',name:'Dept',unit_type:'department',active:true,entity_scope_mode:'explicit',entity_codes:['E1']}],assignments:[...dated.assignments,{id:'staff-primary',finance_user_id:'staff',org_unit_id:'D',assignment_kind:'primary',active:true}]};
 await db.query("update private.finance_membership_org_versions_v1 set snapshot=$1 where status='published'",[snap]);
 const result=await value("select public.finance_org_resolve_actor('direct_supervisor','staff','D1',null,null) v");
 assert.equal(result.candidates[0].finance_user_id,'deputy');assert.equal(result.applicant_context.approval_chain.direct_supervisor_finance_user_id,'deputy');
 await db.exec('rollback');
});
await check('actual runtime seed preserves all company scopes and financial secondary roles',async()=>{
 await db.exec(`
 create table public.finance_department_units(id uuid,tenant_id uuid,code text,name text,unit_type text,parent_unit_id uuid,sort_order int,is_posting_unit boolean,primary_entity_code text,active boolean,metadata jsonb,level int,present_in_source boolean);
 create table public.finance_department_entity_scopes(tenant_id uuid,unit_id uuid,entity_code text,active boolean);
 create table public.companies(id uuid,name text,tax_id text);
 alter table public.departments add column company_id uuid,add column name text,add column status text;
 insert into public.finance_department_units values('40000000-0000-0000-0000-000000000002','${tenant}','D1','Shared Department','department',null,1,true,'E1',true,'{}',3,true);
 insert into public.finance_department_entity_scopes values('${tenant}','40000000-0000-0000-0000-000000000002','E1',true),('${tenant}','40000000-0000-0000-0000-000000000002','E2',true);
 `);
 await db.exec(functionSql('private.finance_membership_org_seed_snapshot_v1'));
 const seed=await value('select private.finance_membership_org_seed_snapshot_v1($1) v',[tenant]);
 assert.deepEqual(seed.units.find(u=>u.code==='D1').entity_codes,['E1','E2']);
 assert.equal(seed.assignments.find(a=>a.id==='cashier-control').role_key,'cashier');
 const again=await value('select private.finance_membership_org_seed_snapshot_v1($1) v',[tenant]);
 assert.equal(seed.units.find(u=>u.code==='GOV_EXECUTIVE').id,again.units.find(u=>u.code==='GOV_EXECUTIVE').id);
});
await check('engine uses the same Taipei end-date boundary and retains reporting exceptions',async()=>{
 const c=ctx({FinanceV4Engines:{register(){}}});vm.runInContext(fs.readFileSync(path.join(root,'assets/engines/organization-engine.js'),'utf8'),c);
 const engine=c.FinanceOrganizationEngine;
 assert.equal(engine.isEffectiveAt({effectiveTo:'2026-01-01'},Date.parse('2026-01-01T15:59:59Z')),true);
 assert.equal(engine.isEffectiveAt({effectiveTo:'2026-01-01'},Date.parse('2026-01-01T16:00:00Z')),false);
 assert.equal(engine.snapshotFromGraph({units:[],assignments:[],reporting_overrides:[{id:'preserve'}]}).reporting_overrides[0].id,'preserve');
});
await check('background refresh cannot attach a new revision to unsaved old supervisor edits',async()=>{
 const c=ctx({S:{demoLogin:false},ORG_CHART:[{userId:'staff',supervisorId:'new-local'}],ORG_CHART_PERSISTED:[{userId:'staff',supervisorId:'old'}],ORG_CHART_REVISION:'base',ORG_CHART_DIRTY:true,ORG_CHART_CONFLICT:false,normalizeOrgChartRuntimeRows:x=>x,SYSTEM_SETTINGS:{},cloneSettingValue:x=>structuredClone(x),isRpcMissing:()=>false});
 vm.runInContext(code('async function refreshOrgChartRowsFromRuntime(','async function refreshWorkflowEngineObservability('),c);
 const result=await c.refreshOrgChartRowsFromRuntime({rpc:async()=>({data:{revision:'remote-new',rows:[{userId:'staff',supervisorId:'remote'}]}})},'system_settings_realtime');
 assert.equal(result.conflict,true);assert.equal(c.ORG_CHART_REVISION,'base');assert.equal(c.ORG_CHART[0].supervisorId,'new-local');
});

await check('dated supervisor exceptions survive runtime reconciliation and explicit changes supersede them',async()=>{
 await actor('boss','admin_director');await db.exec('begin');
 const exception={id:'dated-override',finance_user_id:'staff',supervisor_finance_user_id:'old-boss',effective_from:'2020-01-01',effective_to:'2020-01-02',active:true};
 await db.query("update public.employee_department_roles set direct_supervisor_finance_user_id='boss',metadata=coalesce(metadata,'{}')||jsonb_build_object('org_projected_supervisor_id','boss','org_reporting_overrides',$1::jsonb) where finance_user_id='staff' and is_primary",[[exception]]);
 let seed=await value('select private.finance_membership_org_seed_snapshot_v1($1) v',[tenant]);
 assert.equal(seed.reporting_overrides.find(o=>o.finance_user_id==='staff').effective_to,'2020-01-02');
 await value("select public.save_finance_org_chart_rows($1) v",[[{userId:'staff',supervisorId:'ceo'}]]);
 seed=await value('select private.finance_membership_org_seed_snapshot_v1($1) v',[tenant]);assert.equal(seed.reporting_overrides.find(o=>o.finance_user_id==='staff').supervisor_finance_user_id,'ceo');
 await db.exec('rollback');
});

console.log('Finance organization regressions: '+tests+' behavior checks passed (isolated PostgreSQL fixtures and actual frontend functions).');
await db.close();
})().catch(async(error)=>{console.error(error);await db.close();process.exitCode=1;});
