#!/usr/bin/env node
// Isolated synthetic rehearsal. Production reviewed hashes are never replaced
// in shipped SQL; fixtureSql maps only explicitly listed fixture constants.
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require('@electric-sql/pglite'),{pgcrypto}=require('@electric-sql/pglite/contrib/pgcrypto');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const historical=require('./check_remittance_history_private.cjs');
export const migration=fs.readFileSync(path.join(root,'supabase/migrations/20261019063700_finance_org_google_repair_snapshot_v1.sql'),'utf8');
const original=fs.readFileSync(path.join(root,'supabase/migrations/20260907154759_finance_org_integrity_v2.sql'),'utf8');
const v1=fs.readFileSync(path.join(root,'supabase/migrations/20260821150000_versioned_org_designer_v1.sql'),'utf8');
const literal=v=>"'"+String(v).replaceAll("'","''")+"'";
const strip=sql=>sql.replace(/^\\set[^\n]*\n/gm,'');
const helper=name=>{const re=new RegExp('create or replace function '+name.replaceAll('.','\\.')+'\\([\\s\\S]*?\\$(fn|function)\\$;','i');const match=original.match(re)||v1.match(re);assert(match,'Actual helper missing '+name);return match[0];};
const hashes={tenant:'00000000-0000-0000-0000-000000000001',snapshot:'170272275c125f1bff6ad98845879c50f9c35e3575fcc467c430e9f2c580127c',etag:'b5a01bd82a385eddadac78a98f8dabc3bc2dc3ccc7fc08a5a6082ebc403a59a1',person:'748cccf0bee435b941279f71f6541e097d74cebfe0ebb6e4217de512226a270a',assignment:'d3d16b11db0c7654127faf441a08a61fe52d805cdf98d38d993aaab9044f11af',incident:'5355822ab71ddf296920522b90951f3ccf58921d1eeca49df77745f3fc2f5a42',frozen:'753b6a36ff6056a92d097d3e5df84685'};
export const fixture={tenant:historical.fixture.tenant,person:'FICT-ORG-REVOKED',assignment:'FICT-ORG-REVOKED-PRIMARY',incident:'FICT-GOOGLE-REPAIR'};
export async function fingerprint(db){return (await db.query(`select jsonb_build_object('people',(select md5(coalesce(jsonb_agg(to_jsonb(x) order by id),'[]')::text) from public.finance_users x),'roles',(select md5(coalesce(jsonb_agg(to_jsonb(x) order by id),'[]')::text) from public.employee_department_roles x),'settings',(select md5(coalesce(jsonb_agg(to_jsonb(x) order by id),'[]')::text) from public.system_settings x),'expenses',(select md5(coalesce(jsonb_agg(to_jsonb(x) order by id),'[]')::text) from public.expense_requests x)) v`)).rows[0].v;}
export async function setup(db,{installMigration=false,reuseExisting=false}={}){
 if(!reuseExisting)await historical.setup(db);await db.exec('reset role;set search_path=public;set check_function_bodies=off;set session_replication_role=replica');
 await db.exec(`create table if not exists public.departments(id uuid primary key default gen_random_uuid(),company_id uuid,code text,name text,status text default 'active',deleted_at timestamptz);
 create table if not exists public.finance_department_entity_scopes(tenant_id uuid,unit_id uuid,entity_code text,active boolean);
 create table if not exists public.employee_department_roles(id text primary key,tenant_id uuid,finance_user_id text,department_code text,role_key text,is_primary boolean,active boolean,effective_from date,effective_to date,updated_at timestamptz,metadata jsonb default '{}',direct_supervisor_finance_user_id text,is_department_manager boolean default false,is_department_director boolean default false,can_approve boolean default false);
 create table private.finance_membership_org_versions_v1(id uuid primary key default gen_random_uuid(),tenant_id uuid,version_no bigint,status text,title text,reason text,snapshot jsonb,revision bigint default 1,etag text,validation_summary jsonb,impact_summary jsonb,source_version_id uuid,effective_at timestamptz,created_by_finance_user_id text,submitted_by_finance_user_id text,submitted_at timestamptz,approved_by_finance_user_id text,published_at timestamptz,created_at timestamptz default now(),updated_at timestamptz,source_runtime_revision text);
 create unique index fixture_org_one_published on private.finance_membership_org_versions_v1(tenant_id) where status='published';
 create table private.fixture_org_outbox(id uuid primary key,version_no bigint);
 create function private.fixture_org_outbox_enqueue() returns trigger language plpgsql as $$begin if new.status='published' then insert into private.fixture_org_outbox values(new.id,new.version_no) on conflict do nothing;end if;return new;end$$;
 create trigger finance_membership_org_versions_edoc_v2 after insert or update of status,etag on private.finance_membership_org_versions_v1 for each row execute function private.fixture_org_outbox_enqueue();
 -- Only outbound publishing side effect is a local isolated outbox.
 `);
 const oldRepairTest=fs.readFileSync(path.join(root,'scripts/check_taipei2_google_identity_repair_20261015.cjs'),'utf8');const frozenSource=oldRepairTest.match(/frozenAssignee: `([\s\S]*?)`/)[1];await db.exec(frozenSource+";revoke all on function public.finance_user_has_frozen_pending_assignee(uuid,text) from public,anon,authenticated,service_role;grant execute on function public.finance_user_has_frozen_pending_assignee(uuid,text) to service_role;");
 for(const name of ['private.finance_org_effective_now_v2','private.finance_membership_org_seed_snapshot_v1','private.finance_membership_org_departments_v1','private.finance_membership_org_validate_v1','private.finance_membership_org_etag_v1','private.finance_org_runtime_revision_v2','private.finance_org_snapshot_from_runtime_v2','private.finance_org_publish_runtime_v2']){
  await db.exec(helper(name));const args=name.endsWith('effective_now_v2')?'jsonb,timestamptz':name.endsWith('publish_runtime_v2')?'uuid,text,text':name.endsWith('validate_v1')||name.endsWith('departments_v1')?'uuid,jsonb':name.endsWith('etag_v1')?'jsonb,bigint':'uuid';await db.exec(`revoke all on function ${name}(${args}) from public,anon,authenticated,service_role`);
 }
 // Isolated signer projection boundary, no production definition is changed.
 await db.exec("create function public.finance_org_signer_is_runtime_ready(uuid,text) returns boolean language sql stable as $$select coalesce((select active and google_link_status='bound' from public.finance_users where tenant_id=$1 and id=$2),false)$$");
 // Department validation remains real when present in the history catalog.
 if(!(await db.query("select to_regprocedure('public.finance_assert_department_settings(jsonb,uuid)') v")).rows[0].v)await db.exec("create function public.finance_assert_department_settings(jsonb,uuid) returns void language plpgsql as $$begin if jsonb_typeof($1)<>'array' then raise exception 'invalid departments';end if;end$$");
 await db.query("insert into public.finance_users(id,tenant_id,name,email,role,active,org_status,auth_user_id,google_link_status,department_code,entity_id) values($1,$2,'Fictional retired system identity','org.fixture@example.invalid','employee',true,'system_account',null,'blocked','FICT-D1','FICT-E1')",[fixture.person,fixture.tenant]);
 await db.query("insert into public.employee_department_roles(id,tenant_id,finance_user_id,department_code,role_key,is_primary,active,effective_from,updated_at,metadata,can_approve) select case when id=$2 then $3 else 'FICT-ORG-'||id end,tenant_id,id,'FICT-D1',role,true,true,'2020-01-01',now(),'{}',id=$2 from public.finance_users where tenant_id=$1",[fixture.tenant,fixture.person,fixture.assignment]);
 await db.query(`insert into private.finance_membership_org_versions_v1(tenant_id,version_no,status,snapshot,etag,validation_summary,source_runtime_revision,created_by_finance_user_id,published_at,effective_at) select $1,9,'published',s,private.finance_membership_org_etag_v1(s,1),private.finance_membership_org_validate_v1($1,s),private.finance_org_runtime_revision_v2($1),'fixture_previous_technical_actor',now()-interval '7 days',now()-interval '7 days' from(select private.finance_membership_org_seed_snapshot_v1($1) s)x`,[fixture.tenant]);
 await db.query("update public.employee_department_roles set can_approve=false,metadata=jsonb_build_object('google_identity_repair_incident',$1::text,'contact_email','fixture@example.invalid','source_payload','{}'::jsonb,'google_login_projection_synced_at','2026-10-15T14:41:05Z') where id=$2",[fixture.incident,fixture.assignment]);
 const digest=async value=>(await db.query("select encode(extensions.digest($1::text,'sha256'),'hex') v",[value])).rows[0].v;
 const baseline=(await db.query("select encode(extensions.digest(snapshot::text,'sha256'),'hex') snapshot,encode(extensions.digest(etag,'sha256'),'hex') etag from private.finance_membership_org_versions_v1 where tenant_id=$1 and version_no=9",[fixture.tenant])).rows[0];
 const replacement={tenant:fixture.tenant,...baseline,person:await digest(fixture.person),assignment:await digest(fixture.assignment),incident:await digest(fixture.incident)};await db.exec("set search_path=''");
 replacement.frozen=(await db.query("select md5(pg_get_functiondef('public.finance_user_has_frozen_pending_assignee(uuid,text)'::regprocedure)) v")).rows[0].v;
 const fixtureSource=sql=>{let text=strip(sql);for(const [key,value] of Object.entries(hashes))text=text.replaceAll(value,replacement[key]);return text;};
 const md5=s=>crypto.createHash('md5').update(s).digest('hex');const originalReceipt=md5(migration.trim()),fixtureReceipt=md5(fixtureSource(migration).trim());
 const fixtureSql=sql=>fixtureSource(sql).replaceAll(originalReceipt,fixtureReceipt);
 await db.exec('alter table supabase_migrations.schema_migrations add column if not exists statements text[]');
 await db.exec('set session_replication_role=origin;set search_path=public');
 if(installMigration){await db.exec('begin;'+fixtureSql(migration));await seal(db,fixtureSql);await db.exec('commit');}
 return {fixture,fixtureSql,migration,hashReplacements:replacement};
}
export async function seal(db,fixtureSql){await db.query("insert into supabase_migrations.schema_migrations(version,name,statements) values('20261019063700','finance_org_google_repair_snapshot_v1',$1::text[])",[[fixtureSql(migration).trim()]]);}
export async function run(db,ctx){const checks=[];const verify=(label,v)=>{assert(v,label);checks.push(label)};const sql=name=>ctx.fixtureSql(fs.readFileSync(path.join(root,`scripts/finance_org_google_repair_snapshot_${name}.sql`),'utf8'));
 await db.exec('begin read only;'+sql('preflight')+'rollback;');verify('Readonly reviewed-state preflight passes synthetic known repair',true);
 const before=await fingerprint(db),old=(await db.query("select to_jsonb(v) v from private.finance_membership_org_versions_v1 v where version_no=9")).rows[0].v;
 const reject=async(label,edit)=>{await db.exec('begin');try{await db.exec(edit);await assert.rejects(db.exec(ctx.fixtureSql(migration)),/Organization repair|Organization repaired/);checks.push(label);}finally{await db.exec('rollback');}};
 await reject('Unrelated approval grant rejected',"update public.employee_department_roles set can_approve=true where id<>"+literal(fixture.assignment));
 await reject('Unrelated department move rejected',"update public.employee_department_roles set department_code='OTHER' where id="+literal(fixture.assignment));
 await reject('Unreviewed target metadata rejected',"update public.employee_department_roles set metadata=metadata||'{\"authority_override\":true}' where id="+literal(fixture.assignment));
 await reject('Missing repair incident rejected',"update public.employee_department_roles set metadata=metadata-'google_identity_repair_incident' where id="+literal(fixture.assignment));
 await reject('Identity reactivation rejected',"set session_replication_role=replica;update public.finance_users set google_link_status='bound' where id="+literal(fixture.person)+";set session_replication_role=origin");
 await reject('Unrelated source assignment addition rejected',"insert into public.employee_department_roles select 'FICT-UNREVIEWED',tenant_id,finance_user_id,department_code,role_key,false,active,effective_from,effective_to,updated_at,metadata,direct_supervisor_finance_user_id,is_department_manager,is_department_director,can_approve from public.employee_department_roles limit 1");
 await reject('Pending work cannot remain on revoked identity',"set session_replication_role=replica;update public.expense_requests set steps='[{\"uid\":\""+fixture.person+"\",\"a\":\"\"}]' where id='FICT-MEGA-1';insert into public.approval_step_actor_snapshots(tenant_id,record_type,record_id,step_index,resolved_user_id,workflow_status,step_status) values('"+fixture.tenant+"','expense_requests','FICT-MEGA-1',99,'"+fixture.person+"','pending_applicant_confirm','pending');set session_replication_role=origin");
 await reject('Published baseline tampering rejected',"update private.finance_membership_org_versions_v1 set snapshot=jsonb_set(snapshot,'{schema_version}','99') where version_no=9");
 await reject('Publisher client privilege drift rejected',"grant execute on function private.finance_org_publish_runtime_v2(uuid,text,text) to authenticated");
 await db.exec('begin;'+ctx.fixtureSql(migration));await seal(db,ctx.fixtureSql);await db.exec(sql('postflight')+'rollback;');verify('Migration plus postflight rehearsal rolls back',JSON.stringify(await fingerprint(db))===JSON.stringify(before));verify('Rollback restores original publication only',(await db.query("select count(*)::int n from private.finance_membership_org_versions_v1")).rows[0].n===1);
 await db.exec('begin;'+ctx.fixtureSql(migration));await seal(db,ctx.fixtureSql);await db.exec('commit;');verify('Governed sources and financial requests stay byte-equivalent',JSON.stringify(await fingerprint(db))===JSON.stringify(before));
 const rows=(await db.query('select to_jsonb(v) v from private.finance_membership_org_versions_v1 v order by version_no')).rows.map(r=>r.v);const archived={...rows[0]};delete archived.status;delete archived.updated_at;delete old.status;delete old.updated_at;verify('Historical record only archives and updates timestamp',JSON.stringify(archived)===JSON.stringify(old));verify('Technical actor is recorded, never a CEO approval',rows[1].created_by_finance_user_id==='migration_finance_org_google_repair_snapshot_20261019'&&rows[1].approved_by_finance_user_id===null);verify('New snapshot links to historical source',rows[1].source_version_id===rows[0].id&&rows[1].version_no===10);
 verify('Existing outbox emits new version once',(await db.query('select count(*)::int n from private.fixture_org_outbox where version_no=10')).rows[0].n===1);
 await db.exec('begin read only;'+sql('postflight')+'rollback;');await db.exec(sql('canary'));verify('Repeatable postflight and read-only canary pass',true);
 await assert.rejects(db.exec('begin;'+ctx.fixtureSql(migration)+'commit;'),/reviewed published baseline/);await db.exec('rollback');verify('Replay cannot create a second repair version',true);
 await db.exec('begin;update private.finance_membership_org_versions_v1 set source_runtime_revision=\'bad\' where status=\'published\'');await assert.rejects(db.exec(sql('postflight')),/verification failed/);await db.exec('rollback');verify('Postflight still rejects real runtime drift',true);
 await db.exec("begin;update private.finance_membership_org_versions_v1 set snapshot=jsonb_set(snapshot,'{assignments,0,metadata,unreviewed}', 'true') where version_no=10");await assert.rejects(db.exec(sql('postflight')),/unrelated changes/);await db.exec('rollback');verify('Postflight rejects unrelated repaired snapshot tampering',true);
 for(const [label,edit] of [
 ['missing receipt',"delete from supabase_migrations.schema_migrations where version='20261019063700'"],
 ['empty source',"update supabase_migrations.schema_migrations set statements=array[''] where version='20261019063700'"],
 ['wrong name',"update supabase_migrations.schema_migrations set name='wrong' where version='20261019063700'"],
 ['wrong source',"update supabase_migrations.schema_migrations set statements=array['wrong'] where version='20261019063700'"],
 ['duplicate receipt',"alter table supabase_migrations.schema_migrations drop constraint schema_migrations_pkey;insert into supabase_migrations.schema_migrations select * from supabase_migrations.schema_migrations where version='20261019063700'"]]){await db.exec('begin;'+edit);await assert.rejects(db.exec(sql('postflight')),/sealed ledger/);await db.exec('rollback');checks.push('Postflight rejects '+label);}
 return {checks:checks.length,passed:checks,productionDataUsed:false,productionChanged:false};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){const db=new PGlite({extensions:{pgcrypto}});try{const ctx=await setup(db);console.log(JSON.stringify(await run(db,ctx),null,2));}catch(e){console.error(e.message,e.code,e.where);process.exitCode=1;}finally{await db.close();}}
