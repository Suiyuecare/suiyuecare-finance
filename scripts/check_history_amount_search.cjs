#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
const search=require('../assets/engines/document-search.js');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const t='00000000-0000-0000-0000-000000000001',other='00000000-0000-0000-0000-000000000002',uid='00000000-0000-0000-0000-000000000011';
const migration=read('supabase/migrations/20260910083000_finance_history_amount_search.sql');
const schema=`create role anon;create role authenticated;create role service_role;create schema private;create schema auth;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('fixture.uid',true),'')::uuid$$;
create function public.finance_verified_google_email(uuid) returns text language sql stable as $$select case when $1='${uid}' then nullif(current_setting('fixture.email',true),'') end$$;
create table public.finance_users(id text,tenant_id uuid,auth_user_id uuid,email text,active boolean);
create table public.tenant_members(tenant_id uuid,finance_user_id text,auth_user_id uuid,active boolean);
create table public.expense_requests(id text primary key,no text,tenant_id uuid,data_environment text default 'test',amount numeric,estimated_amount numeric,actual_amount numeric,bank_fee_amount numeric,description text,form_payload jsonb default '{}');
create table public.bills(id text primary key,no text,tenant_id uuid,data_environment text default 'test',amount numeric,batch_id text,item text);
create table public.invoices(id text primary key,no text,tenant_id uuid,data_environment text default 'test',amount numeric,tax numeric,total numeric,batch_id text,buyer text,description text);
create table public.approval_step_actor_snapshots(id uuid default gen_random_uuid(),tenant_id uuid,data_environment text default 'test',record_type text,record_id text,record_no text,step_index int,step_title text,step_status text,workflow_status text,role_key text,raw_actor_user_id text,raw_actor_email text,resolved_user_id text,resolved_email text,acted_by_user_id text,acted_by_name text,acted_at_text text,updated_at timestamptz default now());
insert into public.finance_users values('FICT-USER','${t}','${uid}','fiction@example.invalid',true),('OTHER-USER','${other}',null,'other@example.invalid',true);
insert into public.tenant_members values('${t}','FICT-USER','${uid}',true);
select set_config('fixture.uid','${uid}',false),set_config('fixture.email','fiction@example.invalid',false);
`;
let n=0;function check(label,value=true){assert(value,label);console.log('PASS '+label);n++;}
async function failure(fn,code){let e;try{await fn();}catch(err){e=err;}assert.equal(e&&e.code,code);}
(async()=>{const db=new PGlite();try{
 await db.exec(schema);await db.exec(read('supabase/migrations/20260820052217_approval_participant_history_rpc.sql'));
 async function add(table,id,amount,{batch=null,tenant=t,env='test',participant=true,desc='燈塔虛構資料',total=amount}={}){
  if(table==='expense_requests')await db.query('insert into public.expense_requests(id,no,tenant_id,data_environment,amount,description) values($1,$1,$2,$3,$4,$5)',[id,tenant,env,amount,desc]);
  else if(table==='bills')await db.query('insert into public.bills(id,no,tenant_id,data_environment,amount,batch_id,item) values($1,$1,$2,$3,$4,$5,$6)',[id,tenant,env,amount,batch,desc]);
  else await db.query('insert into public.invoices(id,no,tenant_id,data_environment,amount,tax,total,batch_id,buyer,description) values($1,$1,$2,$3,$4,0,$5,$6,$7,$7)',[id,tenant,env,amount,total,batch,desc]);
  await db.query('insert into public.approval_step_actor_snapshots(tenant_id,data_environment,record_type,record_id,step_index,resolved_user_id,acted_by_user_id,acted_at_text) values($1,$2,$3,$4,0,$5,$6,$7)',[tenant,env,table,id,participant?'FICT-USER':'OTHER-USER',participant?'FICT-USER':null,'2026-09-10T00:00:00Z']);
 }
 await add('expense_requests','FICT-A',1250);await add('expense_requests','FICT-Z',12500);await add('expense_requests','FICT-D',12.5);await add('expense_requests','FICT-E',12.001);await add('expense_requests','FICT-N',-12.5);
 await add('invoices','FICT-IA',1000,{batch:'FICT-IBATCH'});await add('invoices','FICT-IB',250,{batch:'FICT-IBATCH'});await add('bills','FICT-BA',1000,{batch:'FICT-BBATCH'});await add('bills','FICT-BB',250,{batch:'FICT-BBATCH'});
 await add('expense_requests','FICT-SECRET',1250,{participant:false});await add('expense_requests','FICT-TENANT',1250,{tenant:other});await add('expense_requests','FICT-PROD',1250,{env:'production'});
 const call=async(q=null,limit=50,offset=0,env='test')=>(await db.query('select public.finance_approval_participant_history_for_current_user($1,$2,$3,$4) x',[limit,offset,q,env])).rows[0].x;
 const before=await call();const beforeDefinition=(await db.query("select pg_get_functiondef('public.finance_approval_participant_history_for_current_user(integer,integer,text,text)'::regprocedure) d")).rows[0].d;
 check('baseline formatted amount misses while naked digits can match', (await call('NT$1,250')).total===0&&(await call('1250')).total===2);
 await db.exec('begin;'+migration+'\nrollback;');const rehearsed=(await db.query("select to_regprocedure('private.finance_history_document_search_v1(text,text,jsonb)') is null absent,pg_get_functiondef('public.finance_approval_participant_history_for_current_user(integer,integer,text,text)'::regprocedure) d")).rows[0];check('rehearsal rolls back helpers and restores exact RPC body',rehearsed.absent&&rehearsed.d===beforeDefinition);
 await db.exec('begin;'+migration+'\ncommit;');
 const after=await call();check('empty query preserves original complete authorized payload and ordering',JSON.stringify(after)===JSON.stringify(before));
 for(const q of ['1250','1,250','NT$1,250','NT$ 1,250','TWD 1,250元','ＮＴ＄１，２５０']){const x=await call(q);check('formatted integer query '+q+' finds scalar and both complete batch totals',x.total===4&&x.items.some(i=>i.batch_id==='FICT-IBATCH'&&i.source_rows.length===2)&&x.items.some(i=>i.batch_id==='FICT-BBATCH'&&i.source_rows.length===2));}
 check('individual bill/invoice member amounts also find their batch',(await call('1000')).total===2);
 check('multiple words and spaced currency use token AND across description and amount',(await call('燈塔 NT$ 1,250')).total===4&&(await call('不存在 NT$ 1,250')).total===0);
 check('decimal trailing zeros compare exact amount, not 12500 prefix',(await call('1250.00')).total===3&&(await call('12.50')).total===1&&(await call('12.00')).total===0);
 check('minus sign is preserved including Unicode minus',(await call('−12.50')).total===1&&(await call('－１２．５０')).total===1);
 check('SQL wildcard characters stay literal',(await call('FICT%')).total===0&&(await call('FICT_A')).total===0);
 const page=await call('1250',1,1);check('filtering precedes limit and offset, totals and has_more remain truthful',page.total===4&&page.items.length===1&&page.page.offset===1&&page.page.has_more===true);
 check('query cannot leak nonparticipant or other tenant/environment rows',!(await call('1250')).items.some(x=>['FICT-SECRET','FICT-TENANT','FICT-PROD'].includes(x.record_id)));
 await failure(()=>call('x'.repeat(121)),'22023');await failure(()=>call('',51),'22023');await failure(()=>call('',50,-1),'22023');check('original query and page bounds remain enforced');
 await db.exec("set fixture.email='wrong@example.invalid'");await failure(()=>call('1250'),'42501');await db.exec("set fixture.email='';");await failure(()=>call('1250'),'42501');await db.exec("set fixture.email='fiction@example.invalid';set fixture.uid='';");await failure(()=>call('1250'),'42501');await db.exec("set fixture.uid='"+uid+"';update public.tenant_members set active=false");await failure(()=>call('1250'),'42501');await db.exec('update public.tenant_members set active=true');check('mismatched or unverified Google, anonymous and inactive membership are denied');
 const matrix=[['NT$ 1,250元','燈塔',[1250]],['１２，５００','',[12500]],['12.00','',[1250]],['12.50','',[12.5]],['12.50','',[1250]],['-12.50','',[12.5]],['−12.50','',[-12.5]],['1,25','',[125]],['1250','',[12500]],['燈塔 TWD 1,250','燈塔中心',[1250]],[' missing 1250','燈塔',[1250]],['0','',[null,false,'',0]],['0','',[null,false,'']],['%','normal',[]],['_','normal',[]],['123','AB-123',[]],['12.50','文字12.50',[]],['1,250 12.50','',[1250,12.5]],['TWD 12.00','',[12]],['０００１２．５０００','',[12.5]],['12.50','-12.50',[]],['12.50','112.50',[]],['12.50','12.5000',[]],['-12.50','-12.50',[]],['12.50','嵌套數值12.501',[]]];
 for(const [query,text,amounts]of matrix){const actual=(await db.query('select private.finance_history_document_search_v1($1,$2,$3) m',[query,text,JSON.stringify(amounts)])).rows[0].m;assert.equal(actual,search.matches(query,{texts:[text],amounts}),JSON.stringify({query,text,amounts}));}check('shared JS and PostgreSQL normalization/token matrix agrees across '+matrix.length+' cases');
 check('original RPC ACL retained and new helpers private',(await db.query("select has_function_privilege('authenticated','public.finance_approval_participant_history_for_current_user(integer,integer,text,text)','EXECUTE') and has_function_privilege('service_role','public.finance_approval_participant_history_for_current_user(integer,integer,text,text)','EXECUTE') and not has_function_privilege('anon','public.finance_approval_participant_history_for_current_user(integer,integer,text,text)','EXECUTE') and not has_function_privilege('authenticated','private.finance_history_document_search_v1(text,text,jsonb)','EXECUTE') ok")).rows[0].ok);
 // Execute the actual postflight and rollback canary (no live services).
 await db.exec("set fixture.uid='';");await db.exec(read('scripts/finance_amount_search_postflight.sql').replace(/^\\set ON_ERROR_STOP on\r?\n/,''));check('exact amount-search postflight passes with empty auth');
 await db.exec(`create or replace function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 alter table public.invoices add column entity_id text,add column entity_name text,add column department_code text,add column invoice_date date,add column status text,add column approval_status text,add column approval_step int,add column steps jsonb,add column invoice_identifier_type text;
 create table public.ledger_entries(source_id text);create table public.notification_delivery_events(request_id text,payload jsonb);`);
 const rowFingerprint=async()=>JSON.stringify((await db.query("select jsonb_build_object('invoices',(select jsonb_agg(to_jsonb(i) order by id) from public.invoices i),'snapshots',(select jsonb_agg(to_jsonb(s) order by id) from public.approval_step_actor_snapshots s)) f")).rows[0].f);
 const beforeCanary=await rowFingerprint(),canary=await db.exec(read('scripts/finance_amount_search_canary.sql'));check('exact authenticated canary verifies scalar/batch/decimal/paging/participant scope',canary.some(x=>x.rows?.some(row=>row.amount_search_canary_result?.participant_scope_preserved===true)));check('canary rollback preserves complete source and snapshot fingerprint',beforeCanary===await rowFingerprint());
 console.log('History amount search: '+n+' checks passed; only local fictional fixtures.');
 }finally{await db.close();}})().catch(e=>{console.error({message:e.message,code:e.code,where:e.where,position:e.position});process.exitCode=1;});
