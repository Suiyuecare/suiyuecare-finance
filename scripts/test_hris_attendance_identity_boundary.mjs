// Isolated PostgreSQL fixture. Never contacts production or represents real staff acceptance.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
const root=fileURLToPath(new URL('../',import.meta.url));
const db=new PGlite();
const id=n=>'00000000-0000-0000-0000-'+String(n).padStart(12,'0');
let checks=0;
const check=async(name,run)=>{await run();checks++;console.log('PASS',name);};
const denied=async(sql,code='42501')=>{await assert.rejects(db.query(sql),e=>e.code===code);};
async function as(n,role='authenticated',tenant=50){
  await db.exec('set session authorization postgres; reset role');
  await db.query("select set_config('fixture.uid',$1,false),set_config('fixture.role',$2,false),set_config('fixture.tenant',$3,false)",[n?id(n):'',role,id(tenant)]);
  await db.exec('set session authorization '+role);
}
const create=(user=1,status='pending')=>`select public.hris_create_attendance_punch('${id(user)}','user${user}@fixture.invalid','clock_in',null,null,null,null,null,null,true,'fixture',null,null,null,'${status}')`;
const list=(user=1,role='employee')=>`select * from public.hris_list_attendance_punches('${id(user)}','user${user}@fixture.invalid','${role}',200)`;
const review=(user,punch,status='approved',role='ceo')=>`select public.hris_review_attendance_punch('${id(user)}','user${user}@fixture.invalid','${role}','${punch}','${status}')`;
try{
await db.exec(`
create schema auth;create schema private;
create role anon;create role authenticated;create role service_role;
create function auth.uid() returns uuid language sql as $$select nullif(current_setting('fixture.uid',true),'')::uuid$$;
create function auth.jwt() returns jsonb language sql as $$select jsonb_build_object('role',current_setting('fixture.role',true))$$;
create function public.current_tenant_id() returns uuid language sql as $$select nullif(current_setting('fixture.tenant',true),'')::uuid$$;
create table public.companies(id uuid primary key,code text,tax_id text,deleted_at timestamptz);
insert into public.companies values('${id(40)}','E1','12345678',null),('${id(41)}','E2','87654321',null);
create table public.system_settings(tenant_id uuid,key text,value jsonb);
insert into public.system_settings values('${id(50)}','entities','[{"id":"E1","taxId":"12345678"},{"id":"E2","taxId":"87654321"}]'),
 ('${id(51)}','entities','[{"id":"E1","taxId":"12345678"}]');
create table public.users(id uuid primary key,auth_user_id uuid,email text,status text,deleted_at timestamptz,company_id uuid,employee_id uuid);
create table public.finance_users(id text primary key,auth_user_id uuid,email text,active boolean,tenant_id uuid,role text,entity_id text,google_link_status text default 'bound');
create table public.fixture_auth(id uuid primary key,email text,verified boolean default true);
create function public.finance_verified_google_email(p_id uuid) returns text language sql stable security definer set search_path='' as $$select email from public.fixture_auth where id=p_id and verified$$;
create function public.current_finance_user() returns public.finance_users language sql stable security definer set search_path='' as $$
 select f from public.finance_users f where f.auth_user_id=auth.uid() and f.active and f.tenant_id=public.current_tenant_id()
 and f.google_link_status in ('bound','pending_rebind') and f.email=public.finance_verified_google_email(auth.uid())$$;
create table public.attendance_punches(id uuid primary key default gen_random_uuid(),company_id uuid,user_id uuid,employee_id uuid,
 punched_at timestamptz default now(),punch_type text not null,latitude numeric,longitude numeric,address text,device_info text,wifi_ssid text,
 ip_address text,is_abnormal boolean not null,abnormal_reason text,rule_name text,passed_rule text,distance_meters integer,review_status text not null,
 reviewed_by uuid,reviewed_at timestamptz,review_note text,deleted_at timestamptz,updated_at timestamptz);
create table public.punch_correction_requests(id uuid primary key default gen_random_uuid());
create table public.module_audit_logs(table_name text,row_id text,action text,actor_email text,before_data jsonb,after_data jsonb);
alter table public.attendance_punches enable row level security;
alter table public.punch_correction_requests enable row level security;
create policy original_own_all on public.attendance_punches to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
-- Model the live permissive global HR predicate. The new restrictive policy
-- must independently scope it, not merely protect its own RPC.
create policy legacy_global_hr_read on public.attendance_punches for select to authenticated using((public.current_finance_user()).role in ('hr','admin_director','ceo'));
grant usage on schema public,auth to anon,authenticated,service_role;
grant all on public.attendance_punches,public.punch_correction_requests to anon,authenticated,service_role;
`);
for(let n=1;n<=4;n++){
 await db.query('insert into public.users values($1,$1,$2,$3,null,$4,$1)',[id(n),`user${n}@fixture.invalid`,'active',id(n===4?41:40)]);
 await db.query('insert into public.finance_users values($1,$2,$3,true,$4,$5,$6,\'bound\')',['finance-'+n,id(n),`user${n}@fixture.invalid`,id(50),n===2||n===3?'ceo':'employee',n===4?'E2':'E1']);
 await db.query('insert into public.fixture_auth(id,email) values($1,$2)',[id(n),`user${n}@fixture.invalid`]);
}
await db.exec(fs.readFileSync(root+'scripts/fixtures/hris_attendance_live_baseline_20260907.sql','utf8'));
const migration=fs.readFileSync(root+'supabase/migrations/20260907154404_finance_audit_attendance_security_v1.sql','utf8');
await check('release runner can roll back the entire candidate and its ACL changes',async()=>{
 await db.exec('begin');await db.exec(migration);
 await denied("do $$begin raise exception 'postflight failed' using errcode='P0001';end$$",'P0001');
 await db.exec('rollback');
 assert.equal((await db.query("select to_regprocedure('private.hris_verified_attendance_actor_v1(uuid,text)') is null absent,has_table_privilege('authenticated','attendance_punches','UPDATE') old_acl")).rows[0].absent,true);
 assert.equal((await db.query("select has_table_privilege('authenticated','attendance_punches','UPDATE') old_acl")).rows[0].old_acl,true);
});
await db.exec('begin');await db.exec(migration);await db.exec('commit');
await as(null,'anon');
await check('anonymous RPC denied',()=>denied(create()));
await check('anonymous table reading denied',()=>denied('select * from attendance_punches'));
await as(1);
await check('employee cannot impersonate another employee',()=>denied(create(2)));
await check('new punch cannot be client-approved',()=>denied(create(1,'approved')));
await check('new punch cannot be client-rejected',()=>denied(create(1,'rejected')));
await check('NULL punch type rejected explicitly',()=>denied(create().replace("'clock_in'",'null'),'22023'));
await check('self punch derives owner and audit from verified identity',async()=>{await db.query(create());});
let punch=(await db.query(list())).rows[0].id;
await check('client role cannot expose other staff punches',async()=>{assert.equal((await db.query(list(1,'ceo'))).rows.length,1);});
await check('employee cannot review by forging CEO role',()=>denied(review(1,punch)));
await check('direct UPDATE including approval/timestamp is denied',()=>denied(`update attendance_punches set review_status='approved',punched_at=now()-interval '1 day' where id='${punch}'`));
await check('TRUNCATE is denied despite legacy RLS policy',()=>denied('truncate attendance_punches'));
await check('direct correction insertion cannot bypass approval',()=>denied('insert into punch_correction_requests default values'));
await as(4);await db.query(create(4));const other=(await db.query(list(4))).rows[0].id;
await as(2);await db.query(create(2));const own=(await db.query(list(2))).rows.find(r=>r.user_id===id(2)).id;
await check('CEO cannot approve own punch',()=>denied(review(2,own)));
await check('reviewer cannot approve another company punch',()=>denied(review(2,other)));
await check('NULL review result rejected explicitly',()=>denied(review(2,punch).replace("'approved'",'null'),'22023'));
await check('reviewer can approve a pending employee punch',()=>db.query(review(2,punch)));
await check('identical same-reviewer replay is idempotent',()=>db.query(review(2,punch)));
await check('review cannot overwrite an already approved result',()=>denied(review(2,punch,'rejected'),'40001'));
await as(3);
await check('second reviewer cannot overwrite first reviewer',()=>denied(review(3,punch),'40001'));
await as(1);
await check('forged role still restricts result to self after other rows exist',async()=>{assert.equal((await db.query(list(1,'ceo'))).rows.length,1);});
await db.exec('set session authorization postgres; reset role');
await check('creation and review audit retained, replay does not duplicate',async()=>{assert.equal((await db.query("select count(*)::int n from module_audit_logs where action='ATTENDANCE_REVIEW'")).rows[0].n,1);});
await db.exec("update finance_users set active=false where id='finance-1'");await as(1);
await check('disabled Finance identity denied',()=>denied(create()));
await db.exec('set session authorization postgres; reset role');await db.exec("update finance_users set active=true,tenant_id='"+id(51)+"' where id='finance-1'");await as(1);
await check('cross-tenant Finance identity denied',()=>denied(create()));
await db.exec('set session authorization postgres; reset role');await db.exec("update finance_users set tenant_id='"+id(50)+"' where id='finance-1'");
await as(null,'service_role');
await check('trusted server caller remains signature compatible',()=>db.query(create()));
await check('trusted server cannot self-approve new punch',()=>denied(create(1,'approved')));
await db.exec('set session authorization postgres; reset role');
await check('legacy private RPC cannot be invoked by browser role',async()=>{const r=await db.query("select has_function_privilege('authenticated','private.hris_create_attendance_punch(uuid,text,text,numeric,numeric,text,text,text,text,boolean,text,text,text,integer,text)','execute') allowed");assert.equal(r.rows[0].allowed,false);});
console.log(`Attendance identity boundary: ${checks} passed; HR caller production acceptance not run.`);
}catch(error){console.error('FAILED',error.code||'',error.message);process.exitCode=1;}finally{await db.close();}
