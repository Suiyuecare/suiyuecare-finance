#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {Client}=require('pg');
const {run,item,id,tenant,uid}=require('./check_cloud_submission_v1.cjs');
const migrationFile=require('node:path').join(__dirname,'../supabase/migrations/20261011133833_finance_cloud_submission_v1.sql');
const migrationHash=crypto.createHash('sha256').update(fs.readFileSync(migrationFile)).digest('hex');
async function main(){
 const configPath=process.env.FINANCE_NATIVE_PG_CONFIG;
 assert(configPath,'FINANCE_NATIVE_PG_CONFIG must identify a disposable loopback server');
 assert.equal(fs.statSync(configPath).mode&0o077,0,'private configuration permissions');
 const config=JSON.parse(fs.readFileSync(configPath));
 assert(['127.0.0.1','::1','localhost'].includes(config.host));assert.equal(config.database,'postgres');assert(!config.ssl);
 const database='cloud_fixture_'+crypto.randomUUID().replaceAll('-',''),admin=new Client(config);let a,b,observer,created=false;
 const checks=[],timing=[];const check=(name,value)=>{assert(value,name);checks.push(name);};
 try{
  await admin.connect();await admin.query('create database '+database);created=true;
  for(const role of ['anon','authenticated','service_role'])await admin.query(`do $$begin if not exists(select 1 from pg_roles where rolname='${role}') then create role ${role};end if;end$$;`);
  [a,b,observer]=[0,1,2].map(()=>new Client({...config,database}));await Promise.all([a.connect(),b.connect(),observer.connect()]);
  await run({exec:sql=>a.query(sql.replace(/create role (?:anon|authenticated|service_role);/g,'')),query:(sql,args)=>a.query(sql,(args||[]).map(x=>x&&typeof x==='object'?JSON.stringify(x):x)),close:async()=>{}});
  const setIdentity=c=>c.query("select set_config('test.tenant',$1,false),set_config('test.uid',$2,false)",[tenant,uid]);await Promise.all([setIdentity(a),setIdentity(b)]);
  const rpc=async(c,name,args)=>(await c.query('select public.'+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') v',args.map(x=>x&&typeof x==='object'?JSON.stringify(x):x))).rows[0].v;
  const save=(c,n,items,kind='invoice',rev=0)=>rpc(c,'finance_cloud_draft_save_v1',[id(n),rev,kind,{title:'Isolated native fixture',items},[],'production']);
  const prepare=async(n,kind,count)=>{const items=Array.from({length:count},(_,i)=>item(n*10000+i,kind));await save(a,n,items,kind);await rpc(a,'finance_cloud_submission_begin_v1',[id(n),1,count,'production']);let d;for(let start=0;start<count;start+=100)d=await rpc(a,'finance_cloud_submission_stage_v1',[id(n),1,start,items.slice(start,start+100),'production']);return d;};
  const commit=(c,n,d)=>rpc(c,'finance_cloud_submission_commit_v1',[id(n),d.revision,d.stagedFingerprint,'production']);
  for(const [kind,count,n] of [['invoice',501,100],['bill',151,101],['invoice',2000,102],['bill',2000,103]]){
   const started=Date.now(),d=await prepare(n,kind,count),staged=Date.now(),result=await commit(a,n,d),finished=Date.now();
   check(kind+' '+count+' one explicit application batch',result.result.count===count&&new Set(result.result.rows.map(x=>x.batch_id)).size===1);
   timing.push({kind,count,stagingMs:staged-started,commitMs:finished-staged});
  }
  const waitLock=async()=>{const pid=(await b.query('select pg_backend_pid() p')).rows[0].p;return pid;};
  const pid=await waitLock();
  const observeLock=async()=>{const until=Date.now()+3000;while(Date.now()<until){const row=(await observer.query('select wait_event_type from pg_stat_activity where pid=$1',[pid])).rows[0];if(row?.wait_event_type==='Lock')return;await new Promise(r=>setTimeout(r,20));}throw Error('competing statement did not actually wait for lock');};
  let d=await prepare(104,'bill',151);await a.query('begin');await commit(a,104,d);
  const concurrent=commit(b,104,d);await observeLock();await a.query('commit');const replay=await concurrent;
  check('two physical sessions: commit waits and replays exactly one application',replay.idempotentReplay&&(await observer.query("select count(*)::int n from public.bills where submission_idempotency_key=$1",[d.operationKey])).rows[0].n===151);
  d=await prepare(105,'invoice',2);await a.query('begin');const reopened=await rpc(a,'finance_cloud_draft_reopen_v1',[id(105),1,'production']);
  const late=commit(b,105,d).then(x=>({value:x}),error=>({code:error.code}));await observeLock();await a.query('commit');check('reopen wins lock; late original commit rejected',(await late).code==='PT409'&&reopened.revision===2);
  await save(a,106,[item(999999)]);await a.query('begin');await save(a,106,[item(999998)],'invoice',1);
  const stale=save(b,106,[item(999997)],'invoice',1).then(x=>({value:x}),error=>({code:error.code}));await observeLock();await a.query('commit');check('two devices cannot overwrite a newer saved draft',(await stale).code==='PT409');
  const signatures=require('./fixtures/finance_cloud_submission_live_sources_20261011.json').limits.map(x=>x.signature);
  const hashes=(await a.query('select oid::regprocedure::text signature,md5(prosrc) hash from pg_proc where oid=any($1::regprocedure[]) order by 1',[signatures])).rows;
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(migrationFile)).digest('hex'),migrationHash,'migration must not change during test');
  const evidence={ok:true,scope:'Native PostgreSQL, isolated synthetic identities/dependencies and actual submission/migration SQL; not production full-trigger performance',postgres:(await a.query('show server_version')).rows[0].server_version,checks,timing,downstreamHashes:hashes,migrationSha256:migrationHash};
  if(process.env.FINANCE_CLOUD_NATIVE_EVIDENCE)fs.writeFileSync(process.env.FINANCE_CLOUD_NATIVE_EVIDENCE,JSON.stringify(evidence,null,2));
  console.log(JSON.stringify(evidence,null,2));
 }finally{
  await Promise.allSettled([a,b,observer].filter(Boolean).map(async c=>{await c.query('rollback').catch(()=>{});await c.end();}));
  if(created)await admin.query('drop database '+database);await admin.end();
 }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
