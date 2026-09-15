#!/usr/bin/env node
'use strict';
// Optional actual PostgreSQL concurrency proof. Uses no production credentials
// or real employee claims, and leaves application dependencies unchanged.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {performance}=require('node:perf_hooks');
(async()=>{
const root=path.resolve(__dirname,'..');
const configPath=process.env.FINANCE_SUMMARY_PG_CONFIG;
if(!configPath)throw Error('FINANCE_SUMMARY_PG_CONFIG must point to the disposable loopback PostgreSQL config; this optional native test does not claim a pass without a server');
const cfg=JSON.parse(fs.readFileSync(configPath,'utf8'));
assert.equal(cfg.host,'127.0.0.1','Concurrency proof must use a disposable loopback database');
const {Client}=require('pg');
const {createSummarySearchFixture,addSummarySearchDocument,fixtureIdentity}=require('./check_approval_history_summary.cjs');
const database='finance_summary_concurrency_'+process.pid+'_'+Date.now();
const bootstrap=new Client(cfg);await bootstrap.connect();await bootstrap.query('create database '+database);await bootstrap.end();
const a=new Client({...cfg,database}),b=new Client({...cfg,database}),observer=new Client({...cfg,database});
await Promise.all([a.connect(),b.connect(),observer.connect()]);
// Role names are cluster-wide; preserve the fictional fixture's unprivileged
// roles if another test database already created them. Never alter a real role.
const rolePrefix='create role anon;create role authenticated;create role service_role;';
const db={exec:sql=>a.query(sql.startsWith(rolePrefix)?sql.slice(rolePrefix.length):sql),query:(sql,params)=>a.query(sql,params)};
const evidence={scope:'Real loopback PostgreSQL, 3 independent connections, fictional schemas and identities; not Google or production proof',checks:[],sourceSha256:crypto.createHash('sha256').update(fs.readFileSync(root+'/supabase/migrations/20260915050313_finance_approval_history_summary_v1.sql')).digest('hex')};
async function pausedByGroupLock(pending,bpid){
 const deadline=performance.now()+2500;
 while(performance.now()<deadline){
  const r=await observer.query('select wait_event_type,wait_event from pg_stat_activity where pid=$1',[bpid]);
  if(r.rows[0]?.wait_event==='advisory'){evidence.checks.push({name:'contending statement waits on advisory group lock',pass:true});return;}
  await new Promise(resolve=>setTimeout(resolve,20));
 }
 await a.query('rollback');await pending;throw Error('No group advisory lock wait observed');
}
async function race(label,left,right,verify){
 await a.query('begin');await b.query('begin');await a.query(left);
 const pid=(await b.query('select pg_backend_pid() pid')).rows[0].pid;
 let blockedError;const pending=b.query(right).catch(e=>{blockedError=e;});
 await pausedByGroupLock(pending,pid);await a.query('commit');await pending;if(blockedError)throw blockedError;await b.query('commit');await verify();evidence.checks.push({name:label,pass:true});
}
async function group(key){return (await observer.query('select source_count,summary,search_text from private.finance_history_group_projection_v1 where group_key=$1',[key])).rows[0];}
try{
 for(const role of ['anon','authenticated','service_role'])await a.query(`do $role$ begin if not exists(select 1 from pg_roles where rolname='${role}') then create role ${role};end if;end;$role$;`);
const roles=(await a.query("select rolname,rolsuper,rolcreatedb,rolcreaterole,rolcanlogin,rolbypassrls from pg_roles where rolname=any($1) order by rolname",[['anon','authenticated','service_role']])).rows;
assert.equal(roles.length,3);for(const role of roles)assert(Object.entries(role).filter(([k])=>k!=='rolname').every(([,value])=>value===false));
 await createSummarySearchFixture(db);
 await addSummarySearchDocument(db,{table:'invoices',id:'RACE-A',batch:'RACE-GROUP',amount:100,total:100,description:'日照甲'});
 await addSummarySearchDocument(db,{table:'invoices',id:'RACE-B',batch:'RACE-GROUP',amount:200,total:200,description:'日照乙'});
 await race('same batch concurrent amount updates retain both committed values',"update public.invoices set amount=110,total=110 where id='RACE-A'","update public.invoices set amount=220,total=220 where id='RACE-B'",async()=>{const g=await group('RACE-GROUP');assert.equal(g.source_count,2);assert.equal(g.summary.amount,330);});
 const insert=(id,amount,text)=>`insert into public.invoices(id,no,tenant_id,data_environment,amount,total,batch_id,description,department_code) values('${id}','${id}','${fixtureIdentity.tenantId}','test',${amount},${amount},'RACE-INSERT','${text}','D1')`;
 await race('same batch concurrent inserts retain all source rows and search text',insert('INSERT-A',7,'併行甲'),insert('INSERT-B',9,'併行乙'),async()=>{const g=await group('RACE-INSERT');assert.equal(g.source_count,2);assert.equal(g.summary.amount,16);assert.match(g.search_text,/併行甲/);assert.match(g.search_text,/併行乙/);});
 await race('department rename and document update serialize without stale search name',"update public.finance_department_units set name='日照更新課' where code='D1'","update public.invoices set description='員工更新品項' where id='RACE-B'",async()=>{const g=await group('RACE-GROUP');assert.match(g.search_text,/日照更新課/);assert.match(g.search_text,/員工更新品項/);});
 await addSummarySearchDocument(db,{table:'invoices',id:'MOVE-A',batch:'MOVE-X',amount:5,total:5});
 await addSummarySearchDocument(db,{table:'invoices',id:'MOVE-B',batch:'MOVE-Y',amount:6,total:6});
 await race('opposite group moves acquire sorted locks without deadlock or stale old groups',"update public.invoices set batch_id='MOVE-Y' where id='MOVE-A'","update public.invoices set batch_id='MOVE-X' where id='MOVE-B'",async()=>{const x=await group('MOVE-X'),y=await group('MOVE-Y');assert.equal(x.source_count,1);assert.equal(x.summary.amount,6);assert.equal(y.source_count,1);assert.equal(y.summary.amount,5);});
 // Execute the actual public RPC under the authenticated role on an independent
 // connection with explicitly fictional fixture identity values.
 await observer.query("set role authenticated");await observer.query("select set_config('fixture.uid',$1,false),set_config('fixture.email',$2,false)",[fixtureIdentity.authUserId,fixtureIdentity.email]);
 const r=await observer.query("select public.finance_approval_history_summary_v1(50,0,'330','test') payload");
 assert.equal(r.rows[0].payload.total,1);assert.equal(r.rows[0].payload.items[0].summary.amount,330);evidence.checks.push({name:'authorized summary sees final aggregate through actual RPC',pass:true});
 const detail=await observer.query("select public.finance_approval_history_detail_v1('invoices:RACE-GROUP','test') payload");assert.equal(detail.rows[0].payload.item.source_count,2);assert.equal(detail.rows[0].payload.item.source_rows.length,2);evidence.checks.push({name:'authorized full detail contains complete batch',pass:true});
 assert.equal(crypto.createHash('sha256').update(fs.readFileSync(root+'/supabase/migrations/20260915050313_finance_approval_history_summary_v1.sql')).digest('hex'),evidence.sourceSha256,'Migration source must remain unchanged during native proof');evidence.ok=true;console.log(JSON.stringify(evidence,null,2));
} catch(error){evidence.ok=false;evidence.error={message:error.message,code:error.code,where:error.where};console.error(JSON.stringify(evidence,null,2));process.exitCode=1;}finally{await Promise.allSettled([a.query('rollback'),b.query('rollback')]);await Promise.all([a.end(),b.end(),observer.end()]);const evidenceFile=path.resolve(process.env.FINANCE_SUMMARY_CONCURRENCY_EVIDENCE||path.join(path.dirname(configPath),'native-concurrency-evidence.json'));fs.writeFileSync(evidenceFile,JSON.stringify(evidence,null,2));const cleanup=new Client(cfg);await cleanup.connect();await cleanup.query('drop database '+database);await cleanup.end();}

})().catch(error=>{console.error({message:error.message,code:error.code,where:error.where});process.exitCode=1;});
