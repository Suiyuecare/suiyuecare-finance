// Runs only against an explicitly selected local disposable PostgreSQL server.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {Client} from 'pg';
const host=process.env.FINANCE_HR_TEST_PG_HOST??'127.0.0.1';
if(!['127.0.0.1','localhost','::1'].includes(host))throw new Error('Synthetic tests require a loopback PostgreSQL server');
const config={host,port:Number(process.env.FINANCE_HR_TEST_PG_PORT??55439),user:process.env.FINANCE_HR_TEST_PG_USER??'hr_test',database:'postgres',connectionTimeoutMillis:3000};
const name='finance_hr_bridge_'+randomUUID().replaceAll('-','');
const admin=new Client(config);await admin.connect();let a,b,c;
try {
 await admin.query(`create database ${name}`);
 a=new Client({...config,database:name});b=new Client({...config,database:name});c=new Client({...config,database:name});await Promise.all([a.connect(),b.connect(),c.connect()]);
 const testSource=await fs.readFile(new URL('./test_hr_private_bridge.mjs',import.meta.url),'utf8');
 const bootstrap=testSource.match(/await db.exec\(`(create role anon;[\s\S]*?)`\);/)[1].replace(/create role (anon|authenticated|service_role);/g,'');
 await a.query(bootstrap);
 await a.query(await fs.readFile(new URL('../supabase/migrations/20260922072109_finance_hr_private_bridge_v1.sql',import.meta.url),'utf8'));
 const tenant=randomUUID(),employer=randomUUID(),applicant=randomUUID(),actor=randomUUID(),obligation=randomUUID(),event=randomUUID();
 await a.query("insert into public.finance_users values('accountant',$1,$2,'Synthetic accounting',true)",[tenant,actor]);
 await a.query("insert into finance_hr_private.finance_hr_salary_readers(tenant_id,source_employer_id,finance_user_id,business_role,verified_at,verified_by,evidence_reference,effective_from) values($1,$2,'accountant','accounting',now(),'synthetic','SYNTHETIC',now())",[tenant,employer]);
 await a.query("insert into finance_hr_private.finance_hr_routes(tenant_id,source_employer_id,source_applicant_id,legal_entity_code,version,bank_actor,account_actor,cashier_actor,voucher_actor,verified_at,verified_by,evidence_reference,effective_from,active) values($1,$2,$3,'E1',1,'accountant','accountant','accountant','accountant',now(),'synthetic','SYNTHETIC',now(),true)",[tenant,employer,applicant]);
 const source={totalNetCents:10000,lines:[{employeeId:randomUUID(),kind:'addition',amountCents:10000}]};
 const hash=(await a.query('select finance_hr_private.finance_hr_hash($1::jsonb) h',[source])).rows[0].h;
 const envelope={schemaVersion:1,obligationId:obligation,flowId:obligation,sourceEmployerId:employer,originalApplicantId:applicant,revision:1,sourceHash:hash,source,payDate:'2026-10-15',period:'2026-09',kind:'monthly',amountMeaning:'calculated_net',paymentReady:false};
 const intake=client=>client.query('select public.finance_hr_intake($1,$2) r',[event,envelope]);
 await a.query('begin;set local role service_role');await b.query('begin;set local role service_role');
 await intake(a);const duplicate=intake(b);
 const bpid=(await c.query("select pid from pg_stat_activity where datname=$1 and query like 'select public.finance_hr_intake%' and wait_event_type='Lock'",[name])).rows;
 // Allow the second network connection to reach its advisory lock without a timer.
 let locked=bpid.length>0;for(let i=0;!locked&&i<100;i++)locked=(await c.query("select exists(select 1 from pg_stat_activity where datname=$1 and query like 'select public.finance_hr_intake%' and wait_event_type='Lock') x",[name])).rows[0].x;
 assert.equal(locked,true,'concurrent intake really waits on the shared obligation lock');
 await a.query('commit');assert.equal((await duplicate).rows[0].r.replayed,true);await b.query('commit');
 assert.equal((await c.query('select count(*)::int n from finance_hr_private.finance_hr_obligations')).rows[0].n,1);
 async function actorTransaction(client){await client.query('begin;set local role authenticated');await client.query("select set_config('request.jwt.claim.sub',$1,true)",[actor]);}
 await actorTransaction(a);await actorTransaction(b);
 const ev={kind:'bank_batch_validation',reference:'SYNTHETIC',sha256:'a'.repeat(64),totalNetCents:10000};
 const command=client=>client.query("select public.finance_hr_command($1,1,$2,'bank_batch_validation',$3) r",[obligation,randomUUID(),ev]);
 await command(a);const contender=command(b).then(()=>({ok:true}),error=>({code:error.code,message:error.message}));
 locked=false;for(let i=0;!locked&&i<100;i++)locked=(await c.query("select exists(select 1 from pg_stat_activity where datname=$1 and query like 'select public.finance_hr_command%' and wait_event_type='Lock') x",[name])).rows[0].x;
 assert.equal(locked,true,'concurrent approval truly blocks');await a.query('commit');const failed=await contender;assert.equal(failed.code,'40001');assert.match(failed.message,/VERSION_CONFLICT/);await b.query('rollback');
 assert.equal((await c.query('select version from finance_hr_private.finance_hr_obligations')).rows[0].version,2);
 assert.equal((await c.query('select count(*)::int n from finance_hr_private.finance_hr_events')).rows[0].n,2);
 await a.query('begin;set local role service_role');await b.query('begin;set local role service_role');
 assert.equal((await a.query('select public.finance_hr_callback_claim($1,10) r',[obligation])).rows[0].r.length,1);
 assert.equal((await b.query('select public.finance_hr_callback_claim($1,10) r',[obligation])).rows[0].r.length,0,'SKIP LOCKED does not claim a second sender or later version');
 await a.query('commit');await b.query('commit');
 console.log(JSON.stringify({ok:true,postgres:(await c.query('show server_version')).rows[0].server_version,intakeReplay:true,approvalCas:true,callbackLease:true,realPayments:false}));
}finally{
 await Promise.allSettled([a,b,c].filter(Boolean).map(async client=>{await client.query('rollback').catch(()=>{});await client.end();}));
 await admin.query(`drop database if exists ${name}`);await admin.end();
}
