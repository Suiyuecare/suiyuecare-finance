#!/usr/bin/env node
'use strict';
// Execute real approval SQL and all invoice business triggers in a disposable DB.
// Only network notification wake is replaced; no production connection is accepted.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{performance}=require('node:perf_hooks');
const {Client}=require('pg'),{PGlite}=require('@electric-sql/pglite'),{pgcrypto}=require('@electric-sql/pglite/contrib/pgcrypto');
const f=require('./fixtures/finance_invoice_approval_fixture_20261021.cjs');
const root=path.join(__dirname,'..'),migration=fs.readFileSync(path.join(root,'supabase/migrations/20261021050618_finance_invoice_approval_bulk_v1.sql'),'utf8');
const signature='public.finance_invoice_act_active_step_v2(text[],text,text,text,jsonb,text,jsonb,jsonb,text)';
const configPath=process.env.FINANCE_NATIVE_PG_CONFIG;
if(process.env.FINANCE_INVOICE_APPROVAL_NATIVE_REQUIRED==='1'&&!configPath)throw Error('Native invoice approval capacity/concurrency proof is required');
let config=null;if(configPath){assert.equal(fs.statSync(configPath).mode&0o077,0,'Native config must be private');config=JSON.parse(fs.readFileSync(configPath,'utf8'));assert(['127.0.0.1','::1','localhost'].includes(config.host),'Only loopback disposable PostgreSQL allowed');}
const output=process.env.FINANCE_INVOICE_APPROVAL_BULK_OUTPUT||('/tmp/finance-invoice-approval-bulk-20261021'+(config?'':'-pglite'));fs.mkdirSync(output,{recursive:true});
const evidence={startedAt:new Date().toISOString(),engine:config?'native PostgreSQL':'PGlite',databaseHost:config?config.host:'in-memory',productionConnection:false,scope:'fictional identities and requests; actual approval SQL and complete trigger graph; external worker wake replaced by counter',checks:[],measurements:[],productionEndToEndProven:false};
const name='finance_invoice_approval_'+crypto.randomUUID().replaceAll('-','');let admin,client,db,pglite;const warnings=[];
const check=x=>evidence.checks.push(x),q=s=>'"'+s.replaceAll('"','""')+'"';
const tables=[...f.base.catalog.tables,...require('./fixtures/finance_bill_approval_live_catalog_20261015.json').tables];
const expect=async(fn,code)=>{let e;try{await fn();}catch(x){e=x;}assert(e,'Expected rejection '+code);assert.equal(e.code,code,e.message);};
const setupConnection=async d=>{await d.query("set statement_timeout='8s'");await d.query('set jit=off');};
async function fingerprint(){const hashes=[];for(const t of tables){const r=await db.query('select md5(coalesce(string_agg(md5(to_jsonb(r)::text),\',\' order by to_jsonb(r)::text),\'\')) hash from '+q(t.schema_name)+'.'+q(t.name)+' r');hashes.push(t.schema_name+'.'+t.name+':'+r.rows[0].hash);}return crypto.createHash('sha256').update(hashes.join('\n')).digest('hex');}
async function schemaFingerprint(){return(await db.query("select md5(jsonb_build_object('functions',(select jsonb_agg(jsonb_build_object('name',p.oid::regprocedure::text,'body',p.prosrc,'acl',p.proacl::text,'owner',p.proowner,'definer',p.prosecdef,'config',p.proconfig) order by p.oid::regprocedure::text) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','private','finance_hr_private','finance_attachment_private')),'triggers',(select jsonb_agg(pg_get_triggerdef(t.oid) order by t.tgname) from pg_trigger t where t.tgrelid='public.invoices'::regclass and not t.tgisinternal))::text) hash")).rows[0].hash;}
async function counters(){return Object.fromEntries((await db.query('select label,count(*)::int n from private.fixture_trigger_calls group by label')).rows.map(r=>[r.label,r.n]));}
async function resetCounters(){await db.exec('truncate private.fixture_trigger_calls');}
async function verify(batch,result,n,{action='approve',dense=false}={}){
 assert.equal(result.ok,true);assert.equal(result.count,n);assert.equal(result.rows.length,n);assert.equal(new Set(result.rows.map(r=>r.id)).size,n);
 const ids=batch.rows.map(r=>r.id),rows=(await db.query('select id,steps,approval_status,approval_step,row_version from public.invoices where id=any($1::text[]) order by id',[ids])).rows;
 for(const r of rows){assert.equal(Number(r.row_version),2);assert.equal(r.steps[1].actionLog.length,1);assert.equal(r.steps[1].actionLog[0].byId,f.base.approver);if(action==='approve'){assert.equal(r.steps[1].a,'approved');assert.equal(r.approval_status,'pending_accountant');assert.equal(r.approval_step,3);}}
 for(const [table,col] of [['private.finance_history_source_projection_v1','source_id'],['public.collection_followups','source_id'],['public.cash_movement_evidence_links','source_id'],['public.income_document_closure_cases','source_id'],['public.invoice_revenue_rule_assignments','invoice_id']])assert.equal(Number((await db.query('select count(*) n from '+table+' where '+col+'=any($1::text[])',[ids])).rows[0].n),n,table);
 assert.equal(Number((await db.query('select count(*) n from public.approval_step_actor_snapshots where record_id=any($1::text[])',[ids])).rows[0].n),n*((dense?8:3)+(action==='add_sign'||action==='return'?1:0)));
 const g=(await db.query("select source_count from private.finance_history_group_projection_v1 where record_type='invoices' and group_key=$1",[batch.batch_id||ids[0]])).rows;assert.equal(g.length,1);assert.equal(Number(g[0].source_count),n);
 if(action==='approve'){
  const events=(await db.query("select payload from public.notification_delivery_events where payload->>'source_group_id'=$1 and payload->>'recipient_finance_user_id'=$2",[batch.batch_id||ids[0],f.bill.next])).rows;assert.equal(events.length,1,'One next-assignee notification per batch');
  assert(ids.includes(events[0].payload.source_id));assert.equal(Number(events[0].payload.assignment_generation),2);
  if(n>1){assert.equal(Number(events[0].payload.batch_count),n);assert.equal(Number(events[0].payload.batch_total),105*n);}
 }
 return rows;
}
(async()=>{
 try{
  if(config){admin=new Client(config);await admin.connect();await admin.query('create database '+name);client=new Client({...config,database:name});await client.connect();client.on('notice',n=>{if(n.severity==='WARNING')warnings.push(n.message);});db={query:(s,p)=>client.query(s,p),exec:s=>client.query(s)};}
  else {pglite=new PGlite({extensions:{pgcrypto}});db=pglite;}
  evidence.fixture=await f.setup(db);evidence.migrationSHA256=crypto.createHash('sha256').update(migration).digest('hex');
  const initialSchema=await schemaFingerprint(),initialData=await fingerprint();
  await db.exec('begin');await db.exec(migration);await db.exec('rollback');assert.equal(await schemaFingerprint(),initialSchema);assert.equal(await fingerprint(),initialData);check('Migration rollback preserves all function bodies/ACLs/triggers and business data');
  // Baseline and repaired calls share one transaction timestamp and exact rows.
  // A longer local baseline timeout measures the old defect only. Repaired native
  // capacity below is always executed under the unchanged production8s ceiling.
  await db.exec("set statement_timeout='120s';begin");const parity=await f.seed(db,95,'invoice-approval-parity-seed');const exp=await f.expected(db,parity.rows.map(r=>r.id));
  await db.exec('savepoint before_action');await resetCounters();let at=performance.now();const before=await f.act(db,parity,'invoice-approval-parity-act','approve',{expected:exp});const beforeRows=await verify(parity,before,95),beforeCalls=await counters();
  evidence.measurements.push({stage:'old-approval',count:95,elapsedMs:performance.now()-at,calls:beforeCalls});assert.equal(beforeCalls.invoice_statement,95);assert.equal(beforeCalls.history_group,95);assert.equal(beforeCalls.notification_update,95);
  await db.exec('rollback to before_action');await db.exec(migration);await resetCounters();at=performance.now();const after=await f.act(db,parity,'invoice-approval-parity-act','approve',{expected:exp});const afterRows=await verify(parity,after,95),afterCalls=await counters();
  assert.deepEqual(after,before);assert.deepEqual(afterRows,beforeRows);assert.equal(afterCalls.invoice_statement,1);assert.equal(afterCalls.history_group,1);assert.equal(afterCalls.notification_update,1);
  evidence.measurements.push({stage:'repaired-parity',count:95,elapsedMs:performance.now()-at,calls:afterCalls});await db.exec('rollback');await setupConnection(db);check('95 invoice approval response/steps/versions parity;95 history and notification refreshes become1 each');
  await db.exec(migration);const installed=(await db.query('select md5(prosrc) hash,proacl::text acl,proconfig,prosecdef,pg_get_userbyid(proowner) owner from pg_proc where oid=$1::regprocedure',[signature])).rows[0];assert.equal(installed.hash,'b8f16d4644a5bfbe367a97c671937001');assert.equal(installed.owner,'postgres');assert.equal(installed.prosecdef,true);assert.deepEqual(installed.proconfig,['search_path=""']);evidence.installedFunction=installed;
  check('Existing public API signature, security definer owner, ACL and empty search_path retained');
  // Warm the real projections with existing documents before measured approvals.
  for(let i=0;i<4;i++)await f.seed(db,500,'invoice-approval-existing-'+i);
  for(const n of [1,33,95,190,500])for(let repeat=0;repeat<(config?3:1);repeat++){
   const batch=await f.seed(db,n,'invoice-approval-capacity-'+n+'-'+repeat,{dense:true});await resetCounters();at=performance.now();const result=await f.act(db,batch,'invoice-approval-capacity-act-'+n+'-'+repeat),elapsedMs=performance.now()-at;
   await verify(batch,result,n,{dense:true});const calls=await counters();assert.equal(calls.invoice_statement,1);assert.equal(calls.history_group,1);if(n>1)assert.equal(calls.notification_update,1);
   evidence.measurements.push({stage:'capacity',count:n,repeat,elapsedMs,calls});if(config)assert(elapsedMs<4000,'Approval exceeds native4s acceptance budget: '+n+' '+elapsedMs);
  }
  check('1/33/95/190/500 complete SQL approvals with8-step dense histories and2000existing rows; native requires<4s under8s statement_timeout');
  const replay=await f.seed(db,3,'invoice-approval-replay-seed'),replayExpected=await f.expected(db,replay.rows.map(r=>r.id));const first=await f.act(db,replay,'invoice-approval-replay-act','approve',{expected:replayExpected});const replayFingerprint=await fingerprint();const again=await f.act(db,replay,'invoice-approval-replay-act','approve',{expected:replayExpected});assert.equal(again.idempotent_replay,true);assert.deepEqual(again.rows,first.rows);assert.equal(await fingerprint(),replayFingerprint);await expect(()=>f.act(db,replay,'invoice-approval-replay-act','approve',{expected:replayExpected,comment:'different intent'}),'23505');assert.equal(await fingerprint(),replayFingerprint);check('Same-key replay returns original rows without extra writes; changed intent rejected');
  const invalid=await f.seed(db,3,'invoice-approval-invalid-seed'),ids=invalid.rows.map(r=>r.id),validExpected=await f.expected(db,ids);
  const rejects=async(options,code)=>{const before=await fingerprint();await expect(()=>f.act(db,invalid,'invoice-approval-invalid-act','approve',options),code);assert.equal(await fingerprint(),before);};
  const missing={...validExpected};delete missing[ids[2]];await rejects({expected:missing},'40001');
  for(const patch of [{row_version:2},{row_version:'1'},{active_step_index:99},{role_key:'wrong'},{finance_user_id:'not-assigned'},{approval_status:'wrong'}])await rejects({expected:{...validExpected,[ids[2]]:{...validExpected[ids[2]],...patch}}},'40001');
  await rejects({ids:[ids[0],ids[0]]},'23505');await rejects({patches:{[ids[2]]:{amount:100}}},'42501');
  await f.base.identity(db,{user:null});await rejects({},'42501');await f.base.identity(db,{user:f.bill.approverUid,session:f.bill.approverSid,tenantId:f.base.otherTenant});await rejects({},'42501');
  await f.base.identity(db);await rejects({},'42501');await f.approver(db);await db.exec('set role anon');await expect(()=>f.act(db,invalid,'invoice-anon-act','approve',{expected:validExpected}),'42501');await db.exec('reset role');
  await db.query('update public.finance_users set active=false where id=$1',[f.base.approver]);await rejects({},'42501');await db.query('update public.finance_users set active=true where id=$1',[f.base.approver]);
  check('Missing/stale/malformed version or step, duplicate IDs, forbidden patches, anonymous/cross-tenant/applicant/inactive actor all denied without writes');
  // Failure in the last row happens after prior row triggers, but rolls back all.
  await db.exec("create function private.fixture_invoice_fail_last() returns trigger language plpgsql as $$begin if new.description='FAIL-LAST' then raise exception 'injected last-row failure' using errcode='23514';end if;return new;end$$");
  await db.query("update public.invoices set description='FAIL-LAST' where id=$1",[ids[2]]);await db.exec('create trigger zz_fixture_invoice_fail_last before update on public.invoices for each row execute function private.fixture_invoice_fail_last()');const lateBefore=await fingerprint();await expect(()=>f.act(db,invalid,'invoice-last-row-failure'),'23514');assert.equal(await fingerprint(),lateBefore);await db.exec('drop trigger zz_fixture_invoice_fail_last on public.invoices');
  const retry=await f.act(db,invalid,'invoice-last-row-failure');assert.equal(retry.count,3);check('Late row-trigger failure rolls back invoices, projections, notifications and operation receipt; same-key retry succeeds once');
  for(const action of ['return','reject','add_sign']){const b=await f.seed(db,3,'invoice-action-seed-'+action);const r=await f.act(db,b,'invoice-action-'+action,action,{addSign:action==='add_sign'?f.bill.next:null});await verify(b,r,3,{action});}
  check('Return/reject/add_sign still update each complete batch with original step/audit semantics');
  const attached=await f.seed(db,95,'invoice-shared-attachment-seed'),attachmentPath=f.base.tenant+'/invoices/production/2026/10/FICT-E1/FICT-D1/provisional/approval/fixture.pdf';
  await db.exec("insert into storage.buckets(id,name) values('finance-attachments','finance-attachments') on conflict do nothing");
  await db.query("insert into storage.objects(bucket_id,name,owner_id) values('finance-attachments',$1,$2)",[attachmentPath,f.bill.approverUid]);
  await db.query("insert into public.file_attachments(storage_path,record_type,record_no,file_kind,file_name,uploaded_by,tenant_id) values($1,'invoices','provisional','approval','fixture.pdf',$2,$3)",[attachmentPath,f.base.approver,f.base.tenant]);
  at=performance.now();const attachedResult=await f.act(db,attached,'invoice-shared-attachment-act','approve',{files:[{path:attachmentPath,name:'fixture.pdf'}]}),attachmentMs=performance.now()-at;await verify(attached,attachedResult,95);
  assert.equal(Number((await db.query('select count(*) n from private.finance_legacy_attachment_links_v1 where storage_path=$1',[attachmentPath])).rows[0].n),95);
  evidence.measurements.push({stage:'shared-attachment',count:95,elapsedMs:attachmentMs});if(config)assert(attachmentMs<4000,'Shared attachment approval exceeds native4s budget');
  check('95 invoice rows share one uploaded approval attachment with95 authorized links and original source checks');
  // One permitted accounting patch updates every allowlisted column atomically.
  const patched=await f.seed(db,2,'invoice-patch-seed');await db.query("update public.finance_users set role='accountant' where id=$1",[f.base.approver]);
  const patch={description:'虛構會計修訂',amount:200,tax:10,total:210,invoice_item_type:'training',revenue_account_code:'4100',revenue_account_name:'虛構課程收入',revenue_rule_snapshot:{source:'fixture'}};
  await f.act(db,patched,'invoice-patch-act','approve',{patches:{[patched.rows[0].id]:patch}});const actual=(await db.query('select description,amount,tax,total,invoice_item_type,revenue_account_code,revenue_account_name,revenue_rule_snapshot from public.invoices where id=$1',[patched.rows[0].id])).rows[0];for(const k of Object.keys(patch))assert.deepEqual(['amount','tax','total'].includes(k)?Number(actual[k]):actual[k],patch[k]);
  await db.query("update public.finance_users set role='dept_manager' where id=$1",[f.base.approver]);check('Authorized patch preserves all8 accounting fields and unpatched sibling values');
  if(config){
   const timeout=await f.seed(db,3,'invoice-timeout-seed');await db.exec("create function private.fixture_invoice_timeout() returns trigger language plpgsql as $$begin perform pg_sleep(0.03);return new;end$$;create trigger zz_fixture_invoice_timeout before update on public.invoices for each row execute function private.fixture_invoice_timeout()");const before=await fingerprint();await db.exec("set statement_timeout='50ms'");await expect(()=>f.act(db,timeout,'invoice-timeout-act'),'57014');await setupConnection(db);assert.equal(await fingerprint(),before);await db.exec('drop trigger zz_fixture_invoice_timeout on public.invoices');await f.act(db,timeout,'invoice-timeout-act');check('Real statement timeout rolls back all data and same-key retry completes once');
   const concurrent=await f.seed(db,95,'invoice-concurrent-seed'),exp=await f.expected(db,concurrent.rows.map(r=>r.id));const clients=await Promise.all([1,2,3,4].map(async()=>{const c=new Client({...config,database:name});await c.connect();await setupConnection(c);await f.approver(c);return c;}));
   try{const results=await Promise.all(clients.map(c=>f.act(c,concurrent,'invoice-concurrent-same-key','approve',{expected:exp})));assert.equal(results.filter(r=>!r.idempotent_replay).length,1);assert(results.every(r=>JSON.stringify(r.rows)===JSON.stringify(results[0].rows)));await verify(concurrent,results[0],95);
    const race=await f.seed(db,95,'invoice-race-seed'),raceExp=await f.expected(db,race.rows.map(r=>r.id));const raced=await Promise.allSettled(clients.slice(0,2).map((c,i)=>f.act(c,race,'invoice-race-key-'+i,'approve',{expected:raceExp})));assert.equal(raced.filter(r=>r.status==='fulfilled').length,1);assert.equal(raced.find(r=>r.status==='rejected').reason.code,'40001');
    check('Four simultaneous same-key calls commit one batch; different-key race allows one winner and rejects stale CAS');
   }finally{await Promise.all(clients.map(c=>c.end()));}
  }else check('PGlite is functional proof only: native performance, timeout and simultaneous sessions require FINANCE_NATIVE_PG_CONFIG');
  assert.deepEqual(warnings,[],'No silently skipped business triggers');evidence.ok=true;evidence.finishedAt=new Date().toISOString();fs.writeFileSync(path.join(output,'evidence.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify({ok:true,engine:evidence.engine,checks:evidence.checks.length,measurements:evidence.measurements,output},null,2));
 }catch(e){evidence.ok=false;evidence.error={message:e.message,code:e.code,stack:e.stack};fs.writeFileSync(path.join(output,'evidence.json'),JSON.stringify(evidence,null,2));throw e;}
 finally{if(client)await client.end();if(admin){await admin.query('drop database if exists '+name+' with(force)');await admin.end();}if(pglite)await pglite.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
