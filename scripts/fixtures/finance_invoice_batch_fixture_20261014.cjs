'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const catalog=JSON.parse(fs.readFileSync(path.join(__dirname,'finance_invoice_batch_live_catalog_20261014.json'),'utf8'));
const tenant='11111111-1111-4111-8111-111111111111',otherTenant='22222222-2222-4222-8222-222222222222';
const uid='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',sid='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const actor='FICT-INVOICE-APPLICANT',approver='FICT-INVOICE-APPROVER';
const q=s=>'"'+s.replaceAll('"','""')+'"';
const literal=s=>"'"+s.replaceAll("'","''")+"'";
const keyFor=n=>'invoice-capacity-'+String(n).padStart(8,'0');
const item=(i,extra={})=>({
 client_item_key:'row-'+String(i).padStart(5,'0'), entity_id:'FICT-E1',department_code:'FICT-D1',
 buyer:'虛構買受人 '+i,amount:'100',tax:'5',total:'105',invoice_date:'2026-10-14',
 invoice_identifier_type:'電子發票',invoice_item_type:'training',description:'虛構批次容量驗收 '+i,
 steps:[{rk:'applicant_submit',uid:actor,a:'approved',n:'虛構申請人'},
 {rk:'dept_manager',uid:approver,a:'',r:'部門主管',status:'pending_supervisor'}],...extra
});
async function setup(db,{installMigration=false}={}){
 await db.exec("set check_function_bodies=off; create schema if not exists auth; create schema if not exists private; create schema if not exists finance_hr_private; create schema if not exists storage; create schema if not exists extensions; create extension if not exists pgcrypto with schema extensions;");
 for(const role of ['anon','authenticated','service_role'])await db.exec("do $$begin if not exists(select 1 from pg_roles where rolname='"+role+"') then create role "+role+";end if;end$$;");
 for(const e of catalog.enums)await db.exec('create type '+q(e.schema_name)+'.'+q(e.name)+' as enum ('+e.labels.map(literal).join(',')+')');
 for(const t of catalog.tables){
  const columns=t.columns.map(c=>q(c.name)+' '+c.type+(c.identity?" generated "+(c.identity==='a'?'always':'by default')+" as identity":'')+(c.generated?' generated always as ('+c.default+') stored':'')+(c.not_null?' not null':''));
  await db.exec('create table '+q(t.schema_name)+'.'+q(t.name)+' ('+columns.join(',')+')');
 }
 for(const f of catalog.functions){
  await db.exec(f.definition);
  for(const a of f.acl||[])if(a.grantee!=='PUBLIC')await db.exec("do $$begin if not exists(select 1 from pg_roles where rolname="+literal(a.grantee)+") then create role "+q(a.grantee)+";end if;end$$;");
  if(f.owner_name!=='postgres')await db.exec('alter function '+f.signature+' owner to '+q(f.owner_name));
  await db.exec('revoke all on function '+f.signature+' from public,anon,authenticated,service_role');
  for(const a of f.acl||[])await db.exec('grant '+a.privilege+' on function '+f.signature+' to '+(a.grantee==='PUBLIC'?'public':q(a.grantee))+(a.grantable?' with grant option':''));
 }
 for(const t of catalog.tables){
  const table=q(t.schema_name)+'.'+q(t.name);
  for(const c of t.columns)if(c.default&&!c.identity&&!c.generated)await db.exec('alter table '+table+' alter column '+q(c.name)+' set default '+c.default);
  for(const c of t.constraints||[])if(c.type!=='f')await db.exec('alter table '+table+' add constraint '+q(c.name)+' '+c.definition);
  for(const idx of t.indexes||[])await db.exec(idx);
 }
 for(const t of catalog.tables)for(const c of t.constraints||[])if(c.type==='f')await db.exec('alter table '+q(t.schema_name)+'.'+q(t.name)+' add constraint '+q(c.name)+' '+c.definition);
 // The sole substituted boundary is outbound worker wake. All authorization,
 // data constraints, row triggers, and derived projections are exact live SQL.
 await db.exec("create table private.fixture_notification_wakes(id bigint generated always as identity); create or replace function private.finance_wake_notification_worker() returns bigint language plpgsql security definer set search_path='' as $$declare n bigint;begin insert into private.fixture_notification_wakes default values returning id into n;return n;end$$;");
 // Synthetic seed uses actual Google identities, sessions and tenant membership.
 await db.exec(`insert into public.tenants(id,slug,name) values ('${tenant}','suiyuecare','虛構公司'),('${otherTenant}','fixture-b','外部虛構公司');
 insert into auth.users(id,email) values ('${uid}','invoice.fixture@suiyuecare.com');
 insert into auth.identities(provider_id,user_id,provider,identity_data,created_at) values ('fixture-google-sub','${uid}','google','{"email":"invoice.fixture@suiyuecare.com","email_verified":true}',now());
 insert into auth.sessions(id,user_id) values ('${sid}','${uid}');
 insert into public.finance_users(id,name,email,role,tenant_id,auth_user_id,google_link_status,active,department_code)
 values ('${actor}','虛構申請人','invoice.fixture@suiyuecare.com','employee','${tenant}','${uid}','bound',true,'FICT-D1'),
 ('${approver}','虛構主管','invoice.approver@suiyuecare.com','dept_manager','${tenant}',null,'pending_first_login',true,'FICT-D1');
 insert into public.tenant_members(email,name,role,tenant_id,auth_user_id,finance_user_id,active)
 values ('invoice.fixture@suiyuecare.com','虛構申請人','employee','${tenant}','${uid}','${actor}',true);
 insert into public.system_settings(key,value,tenant_id) values
 ('entities','[{"id":"FICT-E1","full":"虛構法人"}]','${tenant}'),
 ('departments','[{"c":"FICT-D1","n":"虛構部門","active":true,"isPostingUnit":true,"newFormEntityCodes":["FICT-E1"]}]','${tenant}');
 insert into public.finance_department_units(tenant_id,code,name,level,unit_type,primary_entity_code,source_setting_version,source_hash)
 values ('${tenant}','FICT-D1','虛構部門',3,'department','FICT-E1',1,'fixture');
 create schema supabase_migrations;
 create table supabase_migrations.schema_migrations(version text primary key,name text);
 `);
 for(const t of catalog.triggers)await db.exec(t.definition);
 await db.exec("revoke all on function public.finance_submit_invoice_batch(text,jsonb,text) from public,anon,authenticated,service_role; grant execute on function public.finance_submit_invoice_batch(text,jsonb,text) to authenticated,service_role; grant usage on schema public,auth to authenticated,anon,service_role;");
 await identity(db);
 for(const f of catalog.functions){
  if(f.name==='finance_wake_notification_worker')continue;
  const result=await db.query('select md5(prosrc) hash from pg_proc where oid=$1::regprocedure',[f.signature]);
  assert.equal(result.rows[0].hash,f.source_md5,'Unmodified live internal authority '+f.signature);
 }
 if(installMigration)await db.exec(fs.readFileSync(path.join(__dirname,'../../supabase/migrations/20261014123427_finance_invoice_batch_bulk_insert_v2.sql'),'utf8'));
 return {catalogFunctions:catalog.functions.length,catalogTables:catalog.tables.length,catalogTriggers:catalog.triggers.length,externalSubstitution:'private.finance_wake_notification_worker only'};
}
async function identity(db,{user=uid,session=sid,tenantId=tenant}={}){
 await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false),set_config('app.current_tenant_id',$3,false)",
 [user||'',JSON.stringify({sub:user,session_id:session,role:'authenticated'}),tenantId]);
}
async function submit(db,key,items,env='production'){
 return (await db.query('select public.finance_submit_invoice_batch($1,$2::jsonb,$3) result',[key,JSON.stringify(items),env])).rows[0].result;
}
module.exports={setup,identity,submit,item,keyFor,tenant,otherTenant,uid,sid,actor,approver,catalog};

