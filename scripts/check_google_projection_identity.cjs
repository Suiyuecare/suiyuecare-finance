const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const root=path.join(__dirname,'..'),migration=fs.readFileSync(path.join(root,'supabase/migrations/20260914001252_finance_google_projection_identity_v3.sql'),'utf8');
const tenant='10000000-0000-0000-0000-000000000001',actor='20000000-0000-0000-0000-000000000001';
async function createGoogleProjectionFixture(db,{install=false}={}){
 await db.exec(`create schema private;create schema auth;create role anon;create role authenticated;create role service_role;
 create table public.finance_users(id text,tenant_id uuid,auth_user_id uuid,email text,name text,pending_login_email text,google_link_status text);
 create table auth.users(id uuid,deleted_at timestamptz);create table auth.identities(user_id uuid,provider text,identity_data jsonb);
 create table public.employees(id uuid,employee_no text,metadata jsonb,email text);
 create table public.users(employee_id uuid,status text,email text,auth_user_id uuid);
 create table public.tenant_members(tenant_id uuid,finance_user_id text,active boolean,auth_user_id uuid,email text);
 create table public.finance_identity_links(tenant_id uuid,finance_user_id text,active boolean,logging_user_id text,logging_email text,finance_email text);
 create table public.employee_department_roles(tenant_id uuid,finance_user_id text,active boolean,metadata jsonb);
 create table public.system_settings(tenant_id uuid,key text,value jsonb);
 create function public.finance_verified_google_email(uuid) returns text language sql stable set search_path='' as $$select lower(btrim(identity_data->>'email')) from auth.identities where user_id=$1 and provider='google' and identity_data->>'email_verified'='true'$$;
 insert into public.finance_users values('u6','${tenant}','${actor}','person@example.invalid','同名員工',null,'bound');
 insert into auth.users values('${actor}',null);insert into auth.identities values('${actor}','google','{"email":"person@example.invalid","email_verified":true}');
 insert into public.employees values('${actor}','u6','{}','person@example.invalid');insert into public.users values('${actor}','active','person@example.invalid','${actor}');
 insert into public.tenant_members values('${tenant}','u6',true,'${actor}','person@example.invalid');
 insert into public.finance_identity_links values('${tenant}','u6',true,'${actor}','person@example.invalid','person@example.invalid');
 insert into public.employee_department_roles values('${tenant}','u6',true,'{"contact_email":"person@example.invalid","source_payload":{"userEmail":"person@example.invalid"}}');
 insert into public.system_settings values('${tenant}','organization_chart','[]'),('${tenant}','pptx_organization_roster','{}');`);
 await db.exec(fs.readFileSync(path.join(__dirname,'fixtures/finance_google_projection_health_v2.sql'),'utf8'));
 await db.exec(`alter table public.finance_users add column active boolean default true, add column google_link_status_detail text, add column google_link_revision bigint, add column google_login_verified_at timestamptz;
 create function public.current_finance_user_id() returns text language sql stable as $$ select null::text $$;
 create function public.current_finance_role() returns text language sql stable as $$ select null::text $$;
 create function public.current_tenant_id() returns uuid language sql stable as $$ select null::uuid $$;`);
 await db.exec(fs.readFileSync(path.join(__dirname,'fixtures/finance_admin_google_account_link_status_v2.sql'),'utf8'));
 await db.exec('revoke all on function public.finance_admin_google_account_link_status_v2(text) from public,anon; grant execute on function public.finance_admin_google_account_link_status_v2(text) to authenticated,service_role;');
 await db.exec('revoke all on function private.finance_google_projection_health_v2(uuid,text) from public,anon,authenticated,service_role;');
 if(install)await db.exec('begin;'+migration+'commit;');
 return{tenant,actor,migration};
}
module.exports={createGoogleProjectionFixture};
if(require.main===module)(async()=>{
 const db=new PGlite();let n=0;const pass=s=>{n++;console.log('PASS '+s);};
 const health=async()=> (await db.query('select private.finance_google_projection_health_v2($1,$2) v',[tenant,'u6'])).rows[0].v;
 const set=async(key,value)=>db.query('update public.system_settings set value=$1::jsonb where key=$2',[JSON.stringify(value),key]);
 const fp=async()=> (await db.query(`select md5(string_agg(v::text,'' order by v::text)) hash from (select jsonb_build_object('t',tableoid::regclass::text,'r',to_jsonb(t)) v from public.finance_users t union all select jsonb_build_object('t',tableoid::regclass::text,'r',to_jsonb(t)) from public.system_settings t union all select jsonb_build_object('t',tableoid::regclass::text,'r',to_jsonb(t)) from auth.identities t) allrows`)).rows[0].hash;
 try{
  await createGoogleProjectionFixture(db);
  await set('pptx_organization_roster',{branches:[{units:[{people:[{name:'同名員工',loginEmail:'someone-else@example.invalid'}]}]}]});
  assert.equal((await health()).organization_projection_mismatch_count,1);pass('actual previous function reproduces same-name PPT false alarm');
  const before=await fp();await db.exec('begin;'+migration);assert.equal((await health()).ok,true);await db.exec('rollback');assert.equal(await fp(),before);assert.equal((await health()).organization_projection_mismatch_count,1);pass('rehearsal changes the diagnostic only and rollback restores old behavior/data');
  await db.exec('begin;'+migration+'commit;');assert.equal(await fp(),before);assert.equal((await health()).ok,true);pass('migration fixes same-name false positive without any account or settings writes');
  for(const [name,rows,want] of [
   ['exact own row',[{userId:'u6',userEmail:' Person@Example.Invalid '}],0],
   ['same name distinct ID',[{userId:'u5',userName:'同名員工',userEmail:'other@example.invalid'}],0],
   ['ID prefix',[{userId:'u60',userEmail:'wrong@example.invalid'}],0],
   ['own wrong email cannot hide behind another row',[{userId:'u6',userEmail:'wrong@example.invalid'},{userId:'u5',userEmail:'person@example.invalid'}],1],
   ['own missing email',[{userId:'u6'}],1],
   ['own object email',[{userId:'u6',userEmail:{text:'person@example.invalid'}}],1],
   ['literal substring in notes',[{userId:'u5',userName:'u6',note:'person@example.invalid'}],0],
   ['supervisor exact pair',[{userId:'u5',userEmail:'person@example.invalid',supervisorId:'u6',supervisorEmail:'wrong@example.invalid'}],1],
   ['delegate exact pair',[{userId:'u5',delegateId:'u6',delegateEmail:'wrong@example.invalid'}],1]
  ]){await set('organization_chart',rows);assert.equal((await health()).organization_projection_mismatch_count,want,name);pass(name);}
  await set('organization_chart',[]);
  for(const [name,row,want] of [['stable PPT ID correct',{financeUserId:'u6',loginEmail:'person@example.invalid'},0],['stable PPT ID wrong',{financeUserId:'u6',loginEmail:'wrong@example.invalid'},1],['PPT contact email is not login identity',{userId:'u6',loginEmail:'person@example.invalid',contactEmail:'office@example.invalid'},0],['unidentified PPT is presentation only',{name:'同名員工',loginEmail:'other@example.invalid'},0]]){await set('pptx_organization_roster',{executive:row});assert.equal((await health()).organization_projection_mismatch_count,want);pass(name);}
  await db.query("insert into public.system_settings values('10000000-0000-0000-0000-000000000002','organization_chart',$1::jsonb)",[JSON.stringify([{userId:'u6',userEmail:'wrong@example.invalid'}])]);assert.equal((await health()).ok,true);pass('other tenant projection is not considered');
  for(const sql of ["update public.tenant_members set auth_user_id=null","update auth.identities set identity_data='{}'","update public.users set email='wrong@example.invalid'","update public.employee_department_roles set metadata='{}'"]){await db.exec('begin;'+sql);assert.equal((await health()).ok,false);await db.exec('rollback');pass('existing binding guard retained: '+sql.split(' set')[0]);}
  for(const role of ['anon','authenticated','service_role']){await db.exec('set role '+role);await assert.rejects(db.query("select private.finance_google_projection_email_mismatch_v3('organization_chart','[]','u6','x')"),e=>e.code==='42501');await db.exec('reset role');pass(role+' cannot call private diagnostic helper');}
  const hashes=(await db.query("select proname,md5(prosrc) hash from pg_proc where pronamespace='private'::regnamespace order by proname")).rows;console.log(JSON.stringify({hashes}));
  await db.exec(fs.readFileSync(path.join(__dirname,'finance_google_projection_postflight.sql'),'utf8').replace(/^\\set ON_ERROR_STOP on\r?\n/,''));
  await db.exec(fs.readFileSync(path.join(__dirname,'finance_google_projection_canary.sql'),'utf8'));
  pass('actual read-only postflight and canary files execute');
  const postflight=fs.readFileSync(path.join(__dirname,'finance_google_projection_postflight.sql'),'utf8').replace(/^\\set ON_ERROR_STOP on\r?\n/,'');
  for(const sql of [
   'grant execute on function private.finance_google_projection_email_mismatch_v3(text,jsonb,text,text) to authenticated',
   'grant execute on function private.finance_google_projection_health_v2(uuid,text) to public',
   'alter function private.finance_google_projection_email_mismatch_v3(text,jsonb,text,text) security definer',
   "alter function private.finance_google_projection_health_v2(uuid,text) set search_path='public'",
   'alter function public.finance_admin_google_account_link_status_v2(text) security invoker'
  ]){await db.exec('begin;'+sql);await assert.rejects(db.exec(postflight),/Google diagnostic source\/authority differs/);await db.exec('rollback');pass('postflight rejects '+sql.split(' on function')[0].split(' function')[0]);}
  await db.exec('begin;');await assert.rejects(db.exec(migration),/reviewed baseline/);await db.exec('rollback');await db.exec(postflight);pass('applied migration refuses a second application and failed transaction leaves guarded source intact');
  console.log(`${n} Google projection SQL checks passed`);
 }finally{await db.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
