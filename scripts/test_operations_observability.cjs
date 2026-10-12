'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');
const {createAuditReadinessFixture}=require('./fixtures/finance_audit_readiness_fixture.cjs');
const engine=require('../assets/engines/operations-workspace.js');
const migration=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261011134336_finance_operations_observability_v1.sql'),'utf8');
let cases=0;async function check(label,fn){await fn();cases++;process.stdout.write('PASS '+label+'\n');}
async function rejects(fn,code){await assert.rejects(fn,e=>e.code===code);}
(async()=>{
 const db=new PGlite();const f=await createAuditReadinessFixture(db);
 await f.admin(`create table private.finance_edoc_sync_outbox_v1(id uuid primary key,tenant_id uuid,aggregate_type text,aggregate_id text,source_revision bigint,status text,attempt_count integer,last_error_code text,last_http_status integer,delivered_at timestamptz,response_digest text,delivery_outcome text,created_at timestamptz,next_attempt_at timestamptz,locked_at timestamptz,locked_by text,updated_at timestamptz,retry_history jsonb default '[]');
 create table private.hr_directory_cursor(id boolean,revision bigint,acknowledged_revision bigint,last_acknowledged_at timestamptz,hr_review_checked_at timestamptz);
 insert into private.hr_directory_cursor values(true,42,41,now(),now());
 create table private.fixture_wakes(id integer generated always as identity);
 create function private.finance_wake_edoc_sync_worker_v1()returns void language sql as $$insert into private.fixture_wakes default values$$;`);
 await f.admin(migration);
 for(const role of ['hr','cashier','general_affairs','dept_manager','section_chief']){const uid=crypto.randomUUID();f.ids[role]=uid;await f.admin('insert into public.finance_users values($1,$1,$2,$1,$3,$4,true,\'bound\')',[role,role+'@example.invalid',f.tenant,uid]);}
 const sample=(metric='list',outcome='ok',durationMs=500)=>({eventId:crypto.randomUUID(),metric,durationMs,outcome,measuredAt:new Date().toISOString()});
 const rpc=async(name,args)=>{const placeholders=args.map((_,i)=>'$'+(i+1)).join(',');return (await db.query(`select public.${name}(${placeholders}) x`,args)).rows[0].x;};
 const save=rows=>rpc('finance_operation_samples_save_v1',['test',JSON.stringify(rows)]);
 await check('all active roles may record only minimal own samples',async()=>{for(const role of ['employee','section_chief','dept_manager','hr','cashier','general_affairs','accountant','ceo']){await f.as(role);assert.equal((await save([sample()])).inserted,1);}});
 await check('ordinary roles cannot read operational or person delivery data',async()=>{for(const role of ['employee','cashier','general_affairs','dept_manager','section_chief','accountant']){await f.as(role);await rejects(()=>rpc('finance_operations_read_v1',['test']),'42501');await rejects(()=>rpc('finance_identity_delivery_status_v1',[50,null]),'42501');}});
 await check('event replay is idempotent and conflicting content fails',async()=>{await f.as('employee');const s=sample();assert.equal((await save([s])).inserted,1);assert.equal((await save([s])).inserted,0);await rejects(()=>save([{...s,durationMs:900}]),'PT409');await rejects(()=>save([{...sample(),email:'leak@example.invalid'}]),'22023');});
 await check('private evidence inaccessible through direct tables',async()=>{await f.as('ceo');await rejects(()=>db.query('select * from private.finance_operation_samples_v1'),'42501');await rejects(()=>db.query('select * from private.finance_operation_alerts_v1'),'42501');});
 await check('failure alerts deduplicate and acknowledgement persists',async()=>{await f.as('employee');await save([sample('submission','timeout'),sample('submission','error'),sample('submission','timeout')]);await f.as('ceo');let r=await rpc('finance_operations_read_v1',['test']);let alerts=r.alerts.filter(x=>x.metric==='submission');assert.equal(alerts.length,1);assert.equal(alerts[0].failure_count,3);await rpc('finance_operation_alert_ack_v1',['test',alerts[0].bucket,'submission','employee']);await f.as('employee');await save([sample('submission','error')]);await f.as('ceo');r=await rpc('finance_operations_read_v1',['test']);alerts=r.alerts.filter(x=>x.metric==='submission');assert.equal(alerts.length,1);assert.equal(alerts[0].failure_count,4);assert.ok(alerts[0].acknowledged_at);});
 await check('p95 requires sufficient observations; environment isolates results',async()=>{await f.as('employee');await save(Array.from({length:20},()=>sample('search','ok',2100)));await f.as('ceo');const r=await rpc('finance_operations_read_v1',['test']);assert.equal(r.metrics.find(x=>x.metric==='search').p95_ms,2100);assert.equal(r.alerts.filter(x=>x.metric==='search').length,1);const prod=await rpc('finance_operations_read_v1',['production']);assert.deepEqual(prod.metrics,[]);});
 const event=crypto.randomUUID(),alien=crypto.randomUUID(),old=crypto.randomUUID();
 await f.admin("insert into private.finance_edoc_sync_outbox_v1(id,tenant_id,aggregate_type,aggregate_id,source_revision,status,attempt_count,created_at) values($1,$2,'member','stable-person',2,'failed',4,now()),($3,$4,'member','alien-person',1,'failed',2,now()),($5,$2,'member','stable-person',1,'failed',1,now())",[event,f.tenant,alien,f.other,old]);
 await check('identity status is tenant scoped and distinguishes target session evidence',async()=>{await f.as('hr');const r=await rpc('finance_identity_delivery_status_v1',[50,null]);assert.equal(r.events.length,2);assert.ok(!JSON.stringify(r).includes('alien-person'));assert.equal(r.sessionRevocationEvidence,'requires_target_session_check');assert.equal(r.hrTransport.scope,'project_transport_watermark');assert.equal(r.hrTransport.acknowledgedRevision,41);});
 await check('identity retry refuses other tenant, stale revision and older events',async()=>{await f.as('ceo');await rejects(()=>rpc('finance_identity_delivery_retry_v1',[alien,1]),'42501');await rejects(()=>rpc('finance_identity_delivery_retry_v1',[event,1]),'PT409');await rejects(()=>rpc('finance_identity_delivery_retry_v1',[old,1]),'PT409');const r=await rpc('finance_identity_delivery_retry_v1',[event,2]);assert.equal(r.status,'pending');assert.equal(r.targetAcknowledged,false);assert.equal((await f.admin('select count(*) n from private.fixture_wakes'))[0].rows[0].n,1);await rejects(()=>rpc('finance_identity_delivery_retry_v1',[event,2]),'PT409');});
 await check('disabled identities and explicit admin page denial fail closed',async()=>{await f.admin("update public.finance_users set active=false where id='hr'");await f.as('hr');await rejects(()=>rpc('finance_identity_delivery_status_v1',[50,null]),'42501');await f.admin("update public.system_settings set value=jsonb_set(value,'{ceo,settings}','\"none\"') where key='role_permissions' and tenant_id=$1",[f.tenant]);await f.as('ceo');await rejects(()=>rpc('finance_operations_read_v1',['test']),'42501');});
 await db.close();
 // Repeat with precise identity/data assertions; business return value stays intact.
 await check('observer preserves results, drops switched identities and retains failed sends',async()=>{let identity='one',now=100000,clock=0,calls=[],fail=true;const ob=engine.create({identity:()=>identity,environment:()=> 'test',now:()=>now,clock:()=>clock,rpc:async(n,args)=>{calls.push(args);if(fail)throw Error('offline');return {data:{ok:true,inserted:args.p_samples.length}};}});const result={email:'private@example.invalid'};assert.equal(await ob.measure('search',async()=>{clock=42;return result;}),result);assert.ok(!JSON.stringify(ob.pending()).includes('private'));await assert.rejects(()=>ob.flush(),/offline/);assert.equal(ob.pending().length,1);fail=false;await ob.flush();assert.equal(ob.pending().length,0);await assert.rejects(()=>ob.measure('submission',async()=>{clock=80;const e=Error('original');e.code='CLIENT_TIMEOUT';throw e;}),/original/);assert.equal(ob.pending()[0].outcome,'timeout');identity='two';assert.equal(ob.pending().length,0);await ob.measure('list',async()=>{identity='three';return 7;});assert.equal(ob.pending().length,0);ob.invalidate();});
 await check('UI timing record requires the captured identity and persists only minimal fields',async()=>{
  let identity='actor-private|auth-epoch1',calls=[];
  const ob=engine.create({identity:()=>identity,environment:()=> 'test',rpc:async(name,args)=>{calls.push({name,args});return {data:{ok:true,inserted:args.p_samples.length}};}});
  try{
   assert.equal(ob.record('search',123.6,'ok'),false);
   assert.equal(ob.record('search',123.6,'ok','other-actor'),false);
   for(const args of [[{metric:'search',query:'private query'},120,'ok',identity],['unknown',120,'ok',identity],['search','120','ok',identity],['search',NaN,'ok',identity],['search',Infinity,'ok',identity],['search',-1,'ok',identity],['search',120,{query:'private query'},identity],['search',120,'unknown',identity]])assert.equal(ob.record(...args),false);
   assert.equal(ob.pending().length,0);
   assert.equal(ob.record('search',123.6,'ok',identity,{query:'private query',filePath:'private/path',email:'private@example.invalid'}),true);
   const row=ob.pending()[0];assert.deepEqual(Object.keys(row).sort(),['durationMs','eventId','measuredAt','metric','outcome']);assert.equal(row.durationMs,124);assert.equal(row.metric,'search');assert.equal(row.outcome,'ok');
   assert(!JSON.stringify(row).includes('private'));
   const captured=identity;identity='actor-private|auth-epoch3';assert.equal(ob.record('search',130,'ok',captured),false);assert.equal(ob.pending().length,0);
   assert.equal(ob.record('search',150,'timeout',identity),true);await ob.flush();assert.equal(calls.length,1);assert.equal(calls[0].name,'finance_operation_samples_save_v1');assert.equal(calls[0].args.p_samples[0].outcome,'timeout');assert(!JSON.stringify(calls).includes('private'));
  }finally{ob.invalidate();}
 });
 await check('measure preserves explicit business failure values and typed timeout outcomes',async()=>{
  let clock=0;const ob=engine.create({identity:()=> 'typed-observer',environment:()=> 'test',clock:()=>clock,rpc:async()=>({data:{ok:true}})});
  try{
   const failed=[false,{ok:false},{error:{code:'CLIENT_TIMEOUT',message:'private query exceeded deadline'}}];
   for(const value of failed)assert.equal(await ob.measure('download',async()=>{clock+=10;return value;}),value);
   assert.deepEqual(ob.pending().map(row=>row.outcome),['error','error','timeout']);assert(!JSON.stringify(ob.pending()).includes('private query'));
   const failures=[
    [{code:'CLIENT_TIMEOUT'},'timeout'],[{code:'FINANCE_READ_TIMEOUT'},'timeout'],[{code:'FINANCE_RESULT_UNKNOWN',message:'Incomplete response'},'error'],[{code:'FINANCE_RESULT_UNKNOWN',message:'Read timed out'},'timeout'],[{code:'FINANCE_RESULT_UNKNOWN',timedOut:true,message:'Incomplete response'},'timeout'],[{code:'FINANCE_RESULT_UNKNOWN',cause:{code:'CLIENT_TIMEOUT'},message:'Incomplete response'},'timeout'],[{code:'PGRST003'},'timeout'],[{name:'TimeoutError'},'timeout'],[{status:504},'timeout'],
    [{code:'57014',message:'canceling statement due to statement timeout'},'timeout'],[{code:'57014',message:'canceling statement due to user request'},'aborted'],[{name:'AbortError'},'aborted'],[{code:'CLIENT_CANCELLED'},'aborted'],
    [{code:'CLOUD_RESULT_UNKNOWN',resultUnknown:true,message:'雲端回應逾時；原草稿已保留。'},'timeout'],[{code:'CLOUD_RESULT_UNKNOWN',message:'雲端回執不完整。'},'error'],[{code:'FINANCE_MUTATION_RESULT_UNKNOWN',cause:{code:'CLIENT_TIMEOUT'}},'timeout'],[{code:'42501',message:'Denied'},'error']
   ];
   for(const [fields,outcome] of failures){const original=Object.assign(new Error(fields.message||'original private error'),fields);await assert.rejects(()=>ob.measure('search',async()=>{clock+=10;throw original;}),error=>error===original);assert.equal(ob.pending().at(-1).outcome,outcome);assert.equal(engine.errorOutcome(original),outcome);}
  }finally{ob.invalidate();}
 });
 await check('missing telemetry crypto or clock cannot alter the original business result',async()=>{
  const vm=require('node:vm'),context={module:{exports:{}},crypto:{},setTimeout,clearTimeout};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../assets/engines/operations-workspace.js'),'utf8'),context);const isolated=context.module.exports;
  for(const clock of [()=>10,()=>{throw Error('clock unavailable');}]){
   const ob=isolated.create({identity:()=> 'actor',environment:()=> 'test',clock,rpc:async()=>({data:{ok:true}})});
   try{assert.equal(ob.record('search',10,'ok','actor'),false);const success={ok:true};assert.equal(await ob.measure('download',async()=>success),success);const original=Error('original business failure');await assert.rejects(()=>ob.measure('download',async()=>{throw original;}),error=>error===original);assert.equal(ob.pending().length,0);}finally{ob.invalidate();}
  }
 });
 await check('workspace facade records actual completed UI timings under the captured owner only',async()=>{
  let identity='facade-actor|epoch1',calls=[];
  try{
   engine.install({identity:()=>identity,environment:()=> 'test',rpc:async(name,args)=>{calls.push({name,args});return {data:{ok:true,inserted:args.p_samples.length}};}});
   assert.equal(engine.record('search',90,'ok'),false);assert.equal(engine.record('search',90,'ok',identity),true);await engine.flush();assert.equal(calls.length,1);assert.equal(calls[0].args.p_samples[0].durationMs,90);
   const old=identity;identity='facade-actor|epoch2';assert.equal(engine.record('search',99,'ok',old),false);await engine.flush();assert.equal(calls.length,1);
  }finally{engine.invalidate();}
 });
 await check('settings and people mutation permissions stay independent in UI and forged clicks',async()=>{
  const originalDocument=globalThis.document;let listener,allowed={ack:false,retry:false},calls=[];
  globalThis.document={addEventListener:(name,handler)=>{assert.equal(name,'click');listener=handler;}};
  const alert={bucket:'2026-10-12T00:00:00Z',metric:'submission',actor_role:'employee',failure_count:3,sample_count:3};
  const syncEvent={id:event,aggregate_type:'member',aggregate_id:'synthetic-person',source_revision:2,status:'failed',attempt_count:1};
  try{
   engine.install({identity:()=> 'fixture',environment:()=> 'test',canView:()=>true,canObserve:()=>true,canPeople:()=>true,canManage:action=>allowed[action]===true,rpc:async(name,args)=>{calls.push(name);return {data:name==='finance_operations_read_v1'?{ok:true,metrics:[],alerts:[alert]}:name==='finance_identity_delivery_status_v1'?{ok:true,events:[syncEvent],summary:{failed:1}}:{ok:true}};},paint:()=>{}});
   await engine.load();let html=engine.view();assert(!html.includes('data-fo-action="ack"')&&!html.includes('data-fo-action="retry"'));
   const fire=async(action)=>listener({target:{closest:()=>({dataset:{foAction:action,bucket:alert.bucket,metric:alert.metric,role:alert.actor_role,id:event,revision:'2'},disabled:false})}});
   calls=[];await fire('ack');await fire('retry');await fire('unknown');assert.deepEqual(calls,[]);
   allowed={ack:true,retry:false};html=engine.view();assert(html.includes('data-fo-action="ack"')&&!html.includes('data-fo-action="retry"'));await fire('ack');assert(calls.includes('finance_operation_alert_ack_v1'));calls=[];await fire('retry');assert.deepEqual(calls,[]);
   allowed={ack:false,retry:true};html=engine.view();assert(!html.includes('data-fo-action="ack"')&&html.includes('data-fo-action="retry"'));await fire('retry');assert(calls.includes('finance_identity_delivery_retry_v1'));calls=[];await fire('ack');assert.deepEqual(calls,[]);
  }finally{engine.invalidate();globalThis.document=originalDocument;}
 });
 process.stdout.write(JSON.stringify({ok:true,cases,scope:'isolated_sql_and_observer',realEmployeeLogin:false})+'\n');
})().catch(e=>{console.error(e);process.exitCode=1;});
