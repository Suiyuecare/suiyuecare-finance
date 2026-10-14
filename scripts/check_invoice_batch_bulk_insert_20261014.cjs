#!/usr/bin/env node
'use strict';
// Complete live invoice trigger/dependency catalog with fictional data.
// Outbound notification wake is the only substituted business boundary.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{performance}=require('node:perf_hooks');
const {Client}=require('pg'),{PGlite}=require('@electric-sql/pglite'),{pgcrypto}=require('@electric-sql/pglite/contrib/pgcrypto');
const f=require('./fixtures/finance_invoice_batch_fixture_20261014.cjs');
const root=path.join(__dirname,'..'),read=n=>fs.readFileSync(path.join(root,n),'utf8');
const strip=s=>s.replace(/^\\set ON_ERROR_STOP on\r?\n/,'');
const migration=read('supabase/migrations/20261014123427_finance_invoice_batch_bulk_insert_v2.sql');
const configPath=process.env.FINANCE_NATIVE_PG_CONFIG;
if(process.env.FINANCE_INVOICE_NATIVE_REQUIRED==='1'&&!configPath)throw Error('Native invoice capacity proof is required');
let config=null;
if(configPath){
 assert.equal(fs.statSync(configPath).mode&0o077,0,'Private native PostgreSQL config must be mode 0600');
 config=JSON.parse(fs.readFileSync(configPath,'utf8'));
 assert(['127.0.0.1','::1','localhost'].includes(config.host),'Only loopback disposable PostgreSQL is allowed');
}
const output=process.env.FINANCE_INVOICE_BATCH_BULK_OUTPUT||('/tmp/finance-invoice-batch-bulk-20261014'+(config?'':'-pglite'));
fs.mkdirSync(output,{recursive:true});
const evidence={startedAt:new Date().toISOString(),engine:config?'native PostgreSQL':'PGlite',scope:'isolated DB, synthetic Google identity and documents, exact live RPC/internal triggers; external worker wake replaced by counter',checks:[],measurements:[],productionEndToEndProven:false};
const check=s=>evidence.checks.push(s),count=async(db,t)=>Number((await db.query('select count(*) n from '+t)).rows[0].n);
const key=f.keyFor,items=n=>Array.from({length:n},(_,i)=>f.item(i));
const billItems=n=>items(n).map((x,i)=>({...x,item:'虛構繳費項目 '+i,payer_name:x.buyer,amount:'105',due_date:'2026-10-20'}));
const submitBill=async(k,n)=>(await db.query('select public.finance_submit_bill_batch($1,$2::jsonb,$3) result',[k,JSON.stringify(billItems(n)),'production'])).rows[0].result;
const expect=async(fn,code)=>{let e;try{await fn();}catch(x){e=x;}assert(e,'expected rejection '+code);assert.equal(e.code,code,e.message);};
const name='finance_invoice_capacity_'+crypto.randomUUID().replaceAll('-','');
let admin,client,db,pglite;const warnings=[];
async function stats(){
 const rows=await db.query("select label,count(*)::int n from private.fixture_trigger_calls group by label order by label");return Object.fromEntries(rows.rows.map(r=>[r.label,r.n]));
}
async function resetCounters(){await db.exec('truncate private.fixture_trigger_calls');}
async function verify(r,n){
 assert.equal(r.count,n);assert.equal(r.rows.length,n);assert.equal(new Set(r.rows.map(x=>x.id)).size,n);
 const ids=r.rows.map(x=>x.id);
 for(const [table,column,multiplier]of [
 ['public.invoices','id',1],['private.finance_history_source_projection_v1','source_id',1],
 ['public.collection_followups','source_id',1],['public.invoice_revenue_rule_assignments','invoice_id',1],
 ['public.cash_movement_evidence_links','source_id',1],['public.income_document_closure_cases','source_id',1],
 ['public.approval_step_actor_snapshots','record_id',2]]){
  const actual=Number((await db.query('select count(*) n from '+table+' where '+column+'=any($1::text[])',[ids])).rows[0].n);
  assert.equal(actual,n*multiplier,'Complete business side effects '+table);
 }
 if(n>1){
  const g=(await db.query("select * from private.finance_history_group_projection_v1 where record_type='invoices' and group_key=$1",[r.batch_id])).rows;
  assert.equal(g.length,1,'one approval/history mother group');
  const e=(await db.query("select * from public.notification_delivery_events where payload->>'source_group_id'=$1",[r.batch_id])).rows;
  assert.equal(e.length,1,'one notification for entire batch');
  assert.equal(Number(e[0].payload.batch_count),n);assert.equal(Number(e[0].payload.batch_total),n*105);
  assert.equal(e[0].payload.source_id,r.rows[0].id,'first-invoice deep link preserved');
 }
}
(async()=>{
 try{
  if(config){admin=new Client(config);await admin.connect();await admin.query('create database '+name);client=new Client({...config,database:name});await client.connect();client.on('notice',n=>{if(n.severity==='WARNING')warnings.push(n.message);});db={query:(s,p)=>client.query(s,p),exec:s=>client.query(s)};}
  else {pglite=new PGlite({extensions:{pgcrypto}});db=pglite;}
  evidence.fixture=await f.setup(db);
  evidence.sources={migrationSHA256:crypto.createHash('sha256').update(migration).digest('hex'),catalogSHA256:crypto.createHash('sha256').update(read('scripts/fixtures/finance_invoice_batch_live_catalog_20261014.json')).digest('hex')};
  await db.exec(`create table private.fixture_trigger_calls(label text);
  create function private.fixture_trigger_counter() returns trigger language plpgsql as $$begin insert into private.fixture_trigger_calls values(TG_ARGV[0]);return coalesce(new,old);end$$;
  create trigger fixture_invoice_statement after insert on public.invoices for each statement execute function private.fixture_trigger_counter('invoice_statement');
  create trigger fixture_history_group after insert or update on private.finance_history_group_projection_v1 for each row execute function private.fixture_trigger_counter('history_group');
  create trigger fixture_notification_update after update on public.notification_delivery_events for each row execute function private.fixture_trigger_counter('notification_update');
  set statement_timeout='20s'; set jit=off;
  `);
  // Pre-change baseline and repaired output use the same sequence/key/content.
  const fingerprint=async()=>(await db.query(strip(read('scripts/finance_invoice_batch_bulk_fingerprint.sql')))).rows[0].fingerprint;
  const before=await fingerprint();
  await db.exec('begin');await db.exec(migration);await db.exec('rollback');
  assert.equal(await fingerprint(),before);check('migration rollback preserves source, ACLs, triggers, indexes, identities and business data');
  await db.exec('begin');await resetCounters();
  const t0=performance.now(),baseline=await f.submit(db,key(1),items(95));
  const baselineStats=await stats();evidence.measurements.push({stage:'baseline',count:95,elapsedMs:performance.now()-t0,triggerCalls:baselineStats});
  assert.equal(baselineStats.invoice_statement,95);assert.equal(baselineStats.history_group,95);
  await verify(baseline,95);await db.exec('rollback');
  await db.exec('begin');await db.exec(migration);
  await db.exec("insert into supabase_migrations.schema_migrations values('20261014123427','finance_invoice_batch_bulk_insert_v2')");
  await db.exec(strip(read('scripts/finance_invoice_batch_bulk_postflight.sql')));await db.exec('commit');
  check('actual migration installs with exact postflight authority and trigger checks');
  await resetCounters();const t1=performance.now(),repaired=await f.submit(db,key(1),items(95));
  assert.deepEqual(repaired,baseline);await verify(repaired,95);
  const repairedStats=await stats();
  assert.equal(repairedStats.invoice_statement,1);assert.equal(repairedStats.history_group,1);
  // One update binds the event ID; one statement update sets final batch totals.
  assert.equal(repairedStats.notification_update,1);
  evidence.measurements.push({stage:'repaired-parity',count:95,elapsedMs:performance.now()-t1,triggerCalls:repairedStats});
  check('95-row response parity; 95 history rebuilds become one; notification refresh once');
  const beforeReplay=await fingerprint();
  const replay=await f.submit(db,key(1),items(95));assert.equal(replay.idempotent_replay,true);assert.deepEqual(replay.rows,repaired.rows);
  assert.equal(await fingerprint(),beforeReplay);check('replay returns original IDs without writes or duplicate posting');
  await expect(()=>f.submit(db,key(1),[f.item(0,{total:'106',amount:'101'})]),'23505');
  const beforeInvalid=await fingerprint();
  for(const [payload,code]of [
   [[f.item(1),f.item(2,{buyer:''})],'22023'],
   [[f.item(1),f.item(2,{total:'999'})],'23514'],
   [[f.item(1),f.item(2,{department_code:'FOREIGN'})],'23514'],
   [[f.item(1),f.item(2,{source_bill_id:'FOREIGN-SOURCE'})],'23503'],
   [[f.item(1),f.item(1)],'23505'],
   [items(501),'22023']
  ])await expect(()=>f.submit(db,key(2),payload),code);
  assert.equal(await fingerprint(),beforeInvalid);check('invalid final item, money, department, source, duplicate key and >500 all roll back without consuming numbers');
  // Force a late row-trigger failure; earlier rows and all derived state roll back.
  await db.exec("create function private.fixture_fail_last() returns trigger language plpgsql as $$begin if new.buyer='FAIL-LAST' then raise exception 'injected guard failure' using errcode='23514';end if;return new;end$$; create trigger zz_fixture_fail_last before insert on public.invoices for each row execute function private.fixture_fail_last()");
  const beforeLate=await fingerprint();await expect(()=>f.submit(db,key(3),[f.item(1),f.item(2,{buyer:'FAIL-LAST'})]),'23514');
  assert.equal(await fingerprint(),beforeLate);await db.exec('drop trigger zz_fixture_fail_last on public.invoices');check('late row-trigger failure atomically rolls back original and derived records');
  if(config){
   await db.exec("create function private.fixture_timeout_row() returns trigger language plpgsql as $$begin if new.buyer='TIMEOUT-LAST' then perform pg_sleep(0.1);end if;return new;end$$;create trigger zz_fixture_timeout before insert on public.invoices for each row execute function private.fixture_timeout_row()");
   const timeoutBefore=await fingerprint();await db.exec("set statement_timeout='25ms'");
   await expect(()=>f.submit(db,key(30),[f.item(1),f.item(2,{buyer:'TIMEOUT-LAST'})]),'57014');
   await db.exec("set statement_timeout='20s'");assert.equal(await fingerprint(),timeoutBefore);
   await db.exec('drop trigger zz_fixture_timeout on public.invoices');
   const retry=await f.submit(db,key(30),[f.item(1),f.item(2,{buyer:'TIMEOUT-LAST'})]);await verify(retry,2);
   check('actual database statement timeout rolls back the whole batch; same-key retry creates exactly one complete batch');
  }
  const updateBatch=await f.submit(db,key(31),items(3));await resetCounters();
  await db.query('update public.invoices set amount=101,total=106 where batch_id=$1',[updateBatch.batch_id]);
  const updatedEvent=(await db.query("select payload from public.notification_delivery_events where payload->>'source_group_id'=$1",[updateBatch.batch_id])).rows[0].payload;
  assert.equal(Number(updatedEvent.batch_total),318);assert.equal(updatedEvent.source_id,updateBatch.rows[0].id);
  assert.equal((await stats()).notification_update,1);
  await db.query("update public.notification_delivery_events set status='sent' where payload->>'source_group_id'=$1",[updateBatch.batch_id]);
  await db.query('update public.invoices set amount=102,total=107 where batch_id=$1',[updateBatch.batch_id]);
  const sentEvent=(await db.query("select payload from public.notification_delivery_events where payload->>'source_group_id'=$1",[updateBatch.batch_id])).rows[0].payload;
  assert.deepEqual(sentEvent,updatedEvent);check('multirow amount update refreshes pending summary once, retains original link and never changes a sent event');
  // Existing rows are created through the same real repaired RPC and trigger graph.
  for(let n=0;n<4;n++)await f.submit(db,key(100+n),items(500));
  for(const n of [1,33,95,190,500]){
   for(let repeat=0;repeat<3;repeat++){
    await resetCounters();const started=performance.now();const r=await f.submit(db,key(1000+n*10+repeat),items(n));const elapsedMs=performance.now()-started;
    await verify(r,n);const calls=await stats();assert.equal(calls.invoice_statement,1);assert.equal(calls.history_group,1);
    evidence.measurements.push({stage:'capacity',count:n,repeat,elapsedMs,triggerCalls:calls});
    if(config)assert(elapsedMs<10000,'Native invoice batch exceeds 10s acceptance ceiling: '+n+' '+elapsedMs);
   }
  }
  check('1/33/95/190/500 full-trigger batches, 3 runs each after 2000 history invoices, <10s native transaction ceiling');
  await f.identity(db,{user:null});await expect(()=>f.submit(db,key(4),items(1)),'42501');
  await f.identity(db,{tenantId:f.otherTenant});await expect(()=>f.submit(db,key(4),items(1)),'42501');
  await f.identity(db);await db.exec('set role anon');await expect(()=>f.submit(db,key(4),items(1)),'42501');await db.exec('reset role');
  await db.exec("update public.finance_users set active=false where id='"+f.actor+"'");
  await expect(()=>f.submit(db,key(4),items(1)),'42501');await db.exec("update public.finance_users set active=true where id='"+f.actor+"'");
  check('anonymous, cross-tenant and inactive applicant denied with real identity/authorization functions');
  await db.exec('set role authenticated');const authenticated=await f.submit(db,key(5),items(1));await db.exec('reset role');await verify(authenticated,1);
  check('authenticated role can submit through actual security-definer boundary');
  for(const n of [1,95,150]){
   const bill=await submitBill('bill-capacity-'+n,n);assert.equal(bill.count,n);
   assert.equal(Number((await db.query('select count(*) n from public.bills where submission_idempotency_key=$1',['bill-capacity-'+n])).rows[0].n),n);
   if(n>1)assert.equal(Number((await db.query("select count(*) n from private.finance_history_group_projection_v1 where record_type='bills' and group_key=$1",[bill.batch_id])).rows[0].n),1);
   const replayBill=await submitBill('bill-capacity-'+n,n);assert(replayBill.idempotent_replay);assert.deepEqual(replayBill.rows,bill.rows);
  }
  const deniedBoth=async()=>{
   await expect(()=>f.submit(db,key(9400),items(1)),'42501');
   await expect(()=>submitBill('bill-denied-session',1),'42501');
  };
  await f.identity(db,{session:crypto.randomUUID()});await deniedBoth();await f.identity(db);
  await db.query('delete from auth.sessions where id=$1',[f.sid]);await deniedBoth();
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)',[f.sid,f.uid]);
  await db.query("update public.finance_users set google_link_status='blocked' where id=$1",[f.actor]);await deniedBoth();
  await db.query("update public.finance_users set google_link_status='pending_rebind',pending_login_email='new.fixture@suiyuecare.com' where id=$1",[f.actor]);
  await db.query("update auth.identities set identity_data=jsonb_build_object('email','new.fixture@suiyuecare.com','email_verified',true) where user_id=$1",[f.uid]);await deniedBoth();
  await db.query("update auth.identities set identity_data=jsonb_build_object('email','invoice.fixture@suiyuecare.com','email_verified',true) where user_id=$1",[f.uid]);
  await db.query("update public.finance_users set google_link_status='bound',pending_login_email=null where id=$1",[f.actor]);
  check('bill 1/95/150 real-trigger submit/replay; both RPCs reject nonexistent/deleted session, blocked Google link and pending-rebind identity mismatch');
  if(config){
   const clients=await Promise.all([1,2,3,4].map(async()=>{const c=new Client({...config,database:name});await c.connect();await f.identity({query:(s,p)=>c.query(s,p)});return c;}));
   try{
    const reps=await Promise.all(clients.map(c=>f.submit({query:(s,p)=>c.query(s,p)},key(9000),items(190))));
    assert.equal(reps.filter(r=>!r.idempotent_replay).length,1);assert(reps.every(r=>JSON.stringify(r.rows)===JSON.stringify(reps[0].rows)));
    await verify(reps[0],190);check('four simultaneous identical requests commit one batch with identical replay IDs');
    const parallel=await Promise.all(clients.map((c,i)=>f.submit({query:(s,p)=>c.query(s,p)},key(9100+i),items(95))));
    assert.equal(new Set(parallel.flatMap(r=>r.rows.map(x=>x.id))).size,380);for(const r of parallel)await verify(r,95);
    check('four concurrent independent batches preserve number uniqueness and complete batch summaries');
   }finally{await Promise.all(clients.map(c=>c.end()));}
  }else check('concurrency not proven in PGlite; native-required CI runs real concurrent sessions');
  await f.identity(db,{user:null});await db.exec(strip(read('scripts/finance_invoice_batch_bulk_canary.sql')));await f.identity(db);
  check('read-only post-install live canary SQL runs without employee impersonation or formal mutation');
  assert.deepEqual(warnings,[],'No silently skipped business triggers');
  evidence.ok=true;evidence.finishedAt=new Date().toISOString();fs.writeFileSync(path.join(output,'evidence.json'),JSON.stringify(evidence,null,2));
  console.log(JSON.stringify({ok:true,engine:evidence.engine,checks:evidence.checks.length,measurements:evidence.measurements,output},null,2));
 }catch(e){evidence.ok=false;evidence.error={message:e.message,code:e.code,stack:e.stack};fs.writeFileSync(path.join(output,'evidence.json'),JSON.stringify(evidence,null,2));throw e;}
 finally{if(client)await client.end();if(admin){await admin.query('drop database if exists '+name+' with(force)');await admin.end();}if(pglite)await pglite.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

