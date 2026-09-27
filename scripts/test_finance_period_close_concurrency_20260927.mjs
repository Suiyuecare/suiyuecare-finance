// Real sessions, real migration, isolated synthetic database. Refuse remote hosts.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {Client} from 'pg';
const configPath=process.env.FINANCE_NATIVE_PG_CONFIG;
assert.ok(configPath,'FINANCE_NATIVE_PG_CONFIG private file is required');
const mode=(await fs.stat(configPath)).mode&0o777;assert.equal(mode&0o077,0,'PG config must be owner-only');
const config=JSON.parse(await fs.readFile(configPath,'utf8'));
assert.ok(['localhost','127.0.0.1','::1'].includes(config.host),'only a disposable loopback PostgreSQL is allowed');
assert.equal(config.database,'postgres','admin database must be the disposable postgres service');
assert.equal(config.ssl,undefined,'TLS/remote proxy configuration is forbidden');
const name='finance_period_'+randomUUID().replaceAll('-',''),admin=new Client(config);let a,b,observer;let created=false;
const T='11111111-1111-4111-8111-111111111111',OTHER='22222222-2222-4222-8222-222222222222',UID='33333333-3333-4333-8333-333333333333',ARCH='44444444-4444-4444-8444-444444444444';
await admin.connect();
try{
 await admin.query(`create database ${name}`);created=true;
 [a,b,observer]=['posting','closing','observer'].map(s=>new Client({...config,database:name,application_name:'finance-period-fixture-'+s}));
 await Promise.all([a.connect(),b.connect(),observer.connect()]);
 const fixtureSource=await fs.readFile(new URL('./check_finance_audit_controls_20260927.mjs',import.meta.url),'utf8');
 const template=fixtureSource.match(/const fixture=`([\s\S]*?)`;\ntry\{/);assert.ok(template,'reviewed controls synthetic fixture must be present');
 const ids={T,OTHER,UID,ARCH};const fixture=template[1].replace(/\$\{(T|OTHER|UID|ARCH)\}/g,(_,key)=>ids[key]).replace(/create role (anon|authenticated|service_role);/g,'');
 assert.ok(!fixture.includes('${'),'all synthetic fixture interpolation must be reviewed');
 for(const role of ['anon','authenticated','service_role'])await admin.query(`do $$begin if not exists(select 1 from pg_roles where rolname='${role}') then create role ${role};end if;end$$;`);
 await a.query(fixture);
 await a.query(await fs.readFile(new URL('../supabase/migrations/20260927152432_finance_audit_controls_v1.sql',import.meta.url),'utf8'));
 const start=async client=>{await client.query("begin;set local statement_timeout='8s';set local lock_timeout='6s';set local role authenticated");await client.query("select set_config('fixture.actor','A',true),set_config('fixture.role','ceo',true),set_config('fixture.tenant',$1,true),set_config('fixture.auth',$2,true)",[T,UID]);};
 const pid=(await b.query('select pg_backend_pid() pid')).rows[0].pid;
 const waitLock=async()=>{const deadline=Date.now()+3000;while(Date.now()<deadline){if((await observer.query("select wait_event_type='Lock' as locked from pg_stat_activity where pid=$1",[pid])).rows[0]?.locked)return;await new Promise(resolve=>setTimeout(resolve,20));}throw Error('competing session must actually wait on the shared advisory lock');};
 // Posting commits first: close must wait, then see the newly committed imbalance.
 await start(a);await a.query("insert into public.ledger_entries values('first-post',$1,'F1','production','2026-08-01',100,0)",[T]);
 await start(b);const closing=b.query("insert into public.period_closes values('first-close',$1,'F1','production','2026-08','closed')",[T]).then(()=>({ok:true}),e=>({code:e.code,message:e.message}));
 await waitLock();await a.query('commit');const rejectedClose=await closing;assert.equal(rejectedClose.code,'23514');assert.match(rejectedClose.message,/借貸不平/);await b.query('rollback');
 assert.equal((await observer.query('select count(*)::int n from public.period_closes')).rows[0].n,0,'imbalance must never be closed');
 // Closing commits first: a posting queued behind the lock must see closure and fail.
 await a.query("delete from public.ledger_entries where id='first-post'");
 await start(a);await a.query("insert into public.period_closes values('second-close',$1,'F1','production','2026-08','closed')",[T]);
 await start(b);const posting=b.query("insert into public.ledger_entries values('second-post',$1,'F1','production','2026-08-01',1,1)",[T]).then(()=>({ok:true}),e=>({code:e.code,message:e.message}));
 await waitLock();await a.query('commit');const rejectedPost=await posting;assert.equal(rejectedPost.code,'23514');assert.match(rejectedPost.message,/期間已關閉/);await b.query('rollback');
 assert.equal((await observer.query('select count(*)::int n from public.ledger_entries')).rows[0].n,0,'late posting must not leak a row');
 assert.equal((await observer.query("select count(*)::int n from public.period_closes where status='closed'")).rows[0].n,1);
 assert.equal((await observer.query('select count(*)::int n from private.finance_period_close_events_v1')).rows[0].n,1,'only the committed close is audited');
 console.log(JSON.stringify({ok:true,postgres:(await observer.query('show server_version')).rows[0].server_version,postingFirstWaitsAndBalances:true,closingFirstWaitsAndRejectsPosting:true,noPartialBusinessWrites:true,syntheticOnly:true}));
}finally{
 await Promise.allSettled([a,b,observer].filter(Boolean).map(async c=>{await c.query('rollback').catch(()=>{});await c.end();}));
 if(created)await admin.query(`drop database if exists ${name}`);await admin.end();
}
