#!/usr/bin/env node
'use strict';
// Real history RPC before/after, isolated synthetic PostgreSQL data only.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const t='00000000-0000-0000-0000-000000000001',other='00000000-0000-0000-0000-000000000002',uid='00000000-0000-0000-0000-000000000011';
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
async function prepareApprovalHistoryCanaryFixture(db){
 await db.exec(`create or replace function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 alter table public.invoices add column entity_id text,add column entity_name text,add column department_code text,add column invoice_date date,add column status text,add column approval_status text,add column approval_step int,add column steps jsonb,add column invoice_identifier_type text;
 create table public.ledger_entries(source_id text);create table public.notification_delivery_events(request_id text,payload jsonb);`);
}
async function createApprovalHistoryFixture(db,options={}){
 await db.exec(schema);await db.exec(read('supabase/migrations/20260820052217_approval_participant_history_rpc.sql'));await db.exec(read('supabase/migrations/20260910083000_finance_history_amount_search.sql'));
 if(options.install!==false)await db.exec(read('supabase/migrations/20260912164807_finance_approval_history_page_first_v1.sql'));
 if(options.forCanary)await prepareApprovalHistoryCanaryFixture(db);
}
module.exports={createApprovalHistoryFixture,prepareApprovalHistoryCanaryFixture};

let checks=0;function check(label,ok=true){assert(ok,label);checks++;console.log('PASS '+label);}
if(require.main===module)(async()=>{const db=new PGlite();try{
 await createApprovalHistoryFixture(db,{install:false});
 async function add(table,id,amount,{batch=null,tenant=t,env='test',participant=true,desc='燈塔虛構資料',total=amount}={}){
  if(table==='expense_requests')await db.query('insert into public.expense_requests(id,no,tenant_id,data_environment,amount,description) values($1,$1,$2,$3,$4,$5)',[id,tenant,env,amount,desc]);
  else if(table==='bills')await db.query('insert into public.bills(id,no,tenant_id,data_environment,amount,batch_id,item) values($1,$1,$2,$3,$4,$5,$6)',[id,tenant,env,amount,batch,desc]);
  else await db.query('insert into public.invoices(id,no,tenant_id,data_environment,amount,tax,total,batch_id,buyer,description) values($1,$1,$2,$3,$4,0,$5,$6,$7,$7)',[id,tenant,env,amount,total,batch,desc]);
  await db.query('insert into public.approval_step_actor_snapshots(tenant_id,data_environment,record_type,record_id,step_index,resolved_user_id,acted_by_user_id,acted_at_text) values($1,$2,$3,$4,0,$5,$6,$7)',[tenant,env,table,id,participant?'FICT-USER':'OTHER-USER',participant?'FICT-USER':null,'2026-09-10T00:00:00Z']);
 }

 await add('expense_requests','A',1250);await add('invoices','IA',1000,{batch:'BATCH-I'});await add('invoices','IB',250,{batch:'BATCH-I',participant:false});await add('bills','BA',1000,{batch:'BATCH-B'});await add('bills','BB',250,{batch:'BATCH-B',participant:false});await add('expense_requests','D',12.5);await add('expense_requests','SECRET',1250,{participant:false});await add('expense_requests','OTHER',1250,{tenant:other});await add('expense_requests','PROD',1250,{env:'production'});
 await db.exec(`insert into public.expense_requests(id,no,tenant_id,amount,description,form_payload) select 'PAGE-'||lpad(n::text,5,'0'),'PAGE-'||lpad(n::text,5,'0'),'${t}',42,'Anonymous performance fixture',jsonb_build_object('note',repeat('x',19000)) from generate_series(1,550) n;
 insert into public.approval_step_actor_snapshots(tenant_id,record_type,record_id,step_index,resolved_user_id,acted_by_user_id,acted_at_text) select tenant_id,'expense_requests',id,0,'FICT-USER',case when id='PAGE-00001' then null else 'FICT-USER' end,'2026-09-12T00:00:00Z' from public.expense_requests where id like 'PAGE-%';
 alter table public.finance_users add column department_code text default 'OLD';alter table public.expense_requests add column department_code text default 'OLD';`);
 const call=async(q=null,limit=50,offset=0,env='test')=>(await db.query('select public.finance_approval_participant_history_for_current_user($1,$2,$3,$4) x',[limit,offset,q,env])).rows[0].x;
 const probes=[[null,50,0],[null,50,50],[null,50,550],[null,50,1000],['燈塔 NT$ 1,250',50,0],['1250',1,1],['1000',50,0],['12.50',50,0],['12.00',50,0],['SECRET',50,0],['燈塔',50,0],['0',50,0]];
 const expected=[];for(const p of probes)expected.push(await call(...p));
 const beforeDefinition=(await db.query("select pg_get_functiondef('public.finance_approval_participant_history_for_current_user(integer,integer,text,text)'::regprocedure) d")).rows[0].d;
 await call();const beforeStart=performance.now();await call();const beforeMs=performance.now()-beforeStart;
 const migration=read('supabase/migrations/20260912164807_finance_approval_history_page_first_v1.sql');await db.exec('begin;'+migration+'\nrollback;');
 check('rollback rehearsal restores exact original function',beforeDefinition===(await db.query("select pg_get_functiondef('public.finance_approval_participant_history_for_current_user(integer,integer,text,text)'::regprocedure) d")).rows[0].d);
 await db.exec('begin;'+migration+'\ncommit;');
 for(let n=0;n<probes.length;n++){assert.deepEqual(await call(...probes[n]),expected[n]);check('old/new complete payload parity '+JSON.stringify(probes[n]));}
 await call();const afterStart=performance.now();await call();const afterMs=performance.now()-afterStart;
 console.log('BENCH '+JSON.stringify({groups:expected[0].total,beforeMs,afterMs,speedup:beforeMs/afterMs,environment:'local PGlite, synthetic 550 documents with 19KB payload, same full page'}));
 check('warm empty-query avoids repeated all-history hydration/join',afterMs<beforeMs*.6);
 let keys=[];const total=(await call()).total;for(let offset=0;offset<total;offset+=50){const p=await call(null,50,offset);assert.equal(p.total,total);assert.equal(p.page.has_more,offset+50<total);keys.push(...p.items.map(x=>x.history_key));}
 check('complete authorized history is reachable without duplicates or a local-row cutoff',keys.length===total&&new Set(keys).size===total&&total===554);
 const batch=await call('1000');check('batch siblings lacking their own participant snapshot remain complete',batch.items.length===2&&batch.items.every(x=>x.source_rows.length===2));
 const assigned=(await call('PAGE-00001')).items[0];check('assigned-only is retained but never labelled personally acted',assigned.personally_acted!==true&&assigned.participation_label==='曾列入流程');
 const prior=await call('PAGE-00002');await db.exec("update public.finance_users set department_code='NEW' where id='FICT-USER';update public.expense_requests set department_code='OLD-ARCHIVED' where id='PAGE-00002'");const moved=await call('PAGE-00002');check('changing current department does not erase actual historical participation',moved.total===1&&moved.items[0].personally_acted&&moved.items[0].history_key===prior.items[0].history_key);
 check('unassigned, foreign tenant and wrong environment remain excluded',(await call('SECRET')).total===0&&(await call('OTHER')).total===0&&(await call('PROD')).total===0);
 for(const q of ["set fixture.uid=''","set fixture.uid='${uid}';set fixture.email='wrong@example.invalid'","set fixture.email='fiction@example.invalid';update public.tenant_members set active=false"]){await db.exec(q.replace('${uid}',uid));await assert.rejects(()=>call(),e=>e.code==='42501');}check('anonymous, wrong Google binding and inactive membership are still denied');
 await db.exec("set fixture.uid='';set fixture.email='fiction@example.invalid';update public.tenant_members set active=true");
 for(const file of ['finance_amount_search_postflight.sql','finance_approval_history_postflight.sql'])await db.exec(read('scripts/'+file).replace(/^\\set ON_ERROR_STOP on\r?\n/,''));check('previous amount-search and new exact authority postflight both pass');
 await prepareApprovalHistoryCanaryFixture(db);
 const fp=async()=>JSON.stringify((await db.query("select jsonb_build_object('i',(select jsonb_agg(to_jsonb(i) order by id) from public.invoices i),'s',(select jsonb_agg(to_jsonb(s) order by id) from public.approval_step_actor_snapshots s)) f")).rows[0].f),beforeCanary=await fp();
 const result=await db.exec(read('scripts/finance_approval_history_canary.sql'));check('exact authenticated canary covers all pages, batch/search, unassigned denial and no identity',result.some(x=>x.rows?.some(r=>r.approval_history_canary_result?.history_scope_preserved===true)));check('canary rollback leaves exact source and snapshot fingerprint',beforeCanary===await fp());
 console.log('History page-first: '+checks+' actual PostgreSQL checks passed.');
}finally{await db.close();}})().catch(e=>{console.error({message:e.message,code:e.code,where:e.where,stack:e.stack});process.exitCode=1});
