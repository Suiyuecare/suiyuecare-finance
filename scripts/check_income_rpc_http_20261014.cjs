#!/usr/bin/env node
'use strict';
// Real loopback PostgREST + native PostgreSQL. No production URLs, employee
// credentials, document writes, or mocked business/authorization functions.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const http=require('node:http'),net=require('node:net'),{spawn}=require('node:child_process'),{Client}=require('pg');
const f=require('./fixtures/finance_invoice_batch_fixture_20261014.cjs');
const scope=require('./fixtures/finance_income_http_scope_20261014.json');
const output='/tmp/finance-income-rpc-http-20261014';fs.mkdirSync(output,{recursive:true});
const evidence={startedAt:new Date().toISOString(),transport:'real loopback PostgREST / native PostgreSQL / signed synthetic JWT',checks:[],measurements:[],productionEndToEndProven:false};
const configFile=process.env.FINANCE_NATIVE_PG_CONFIG,bin=process.env.FINANCE_POSTGREST_BIN;
assert(configFile&&bin,'FINANCE_NATIVE_PG_CONFIG and FINANCE_POSTGREST_BIN are required; no mock fallback');
assert.equal(fs.statSync(configFile).mode&0o077,0,'private config');
const config=JSON.parse(fs.readFileSync(configFile,'utf8'));assert(['127.0.0.1','localhost','::1'].includes(config.host),'Only loopback test database allowed');
const suffix=crypto.randomBytes(8).toString('hex'),database='finance_income_http_'+suffix,role='finance_http_'+suffix;
const rolePassword=crypto.randomBytes(32).toString('hex');
const secret=crypto.randomBytes(48).toString('hex'),q=s=>'"'+s.replaceAll('"','""')+'"';
const jwt=(sub=f.uid,session=f.sid,key=secret)=>{const h=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'),p=Buffer.from(JSON.stringify({sub,session_id:session,role:'authenticated',exp:Math.floor(Date.now()/1000)+600})).toString('base64url');return h+'.'+p+'.'+crypto.createHmac('sha256',key).update(h+'.'+p).digest('base64url');};
const port=()=>new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
const check=s=>evidence.checks.push(s),items=n=>Array.from({length:n},(_,i)=>f.item(i));
let admin,client,server,proxy,base,log='',configPath;
async function request(route,body,{token=jwt(),url=base}={}){const r=await fetch(url+route,{method:body===undefined?'GET':'POST',headers:{...(token?{Authorization:'Bearer '+token}:{}),'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(20000)});const text=await r.text();let data;try{data=JSON.parse(text);}catch{data=text;}return {status:r.status,data};}
const submit=(key,n,opts)=>request('/rpc/finance_submit_invoice_batch',{p_idempotency_key:key,p_items:Array.isArray(n)?n:items(n),p_data_environment:'production'},opts);
const billSubmit=(key,n,opts)=>request('/rpc/finance_submit_bill_batch',{p_idempotency_key:key,p_items:items(n).map((x,i)=>({...x,item:'虛構繳費項目',payer_name:'虛構繳費人 '+i,due_date:'2026-10-14'})),p_data_environment:'production'},opts);
const reconcile=(key,opts)=>request('/rpc/finance_income_reconcile_submission_v1',{p_document_type:'invoice',p_idempotency_key:key,p_data_environment:'production'},opts);
const success=r=>{assert.equal(r.status,200,JSON.stringify(r.data));assert.equal(r.data.ok,true,JSON.stringify(r.data));return r.data;};
const denied=r=>{assert([401,403].includes(r.status),JSON.stringify(r));};
(async()=>{
 try{
  admin=new Client(config);await admin.connect();await admin.query('create database '+q(database));
  client=new Client({...config,database});await client.connect();const db={query:(s,p)=>client.query(s,p),exec:s=>client.query(s)};
  evidence.fixture=await f.setup(db,{installMigration:true});
  const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'..',file))).digest('hex');evidence.sources={migrationSHA256:hash('supabase/migrations/20261014123427_finance_invoice_batch_bulk_insert_v2.sql'),catalogSHA256:hash('scripts/fixtures/finance_invoice_batch_live_catalog_20261014.json'),scopeSHA256:hash('scripts/fixtures/finance_income_http_scope_20261014.json')};
  for(const fn of [...scope.extraFunctions,scope.reconcile]){await client.query(fn.definition);await client.query('alter function '+fn.signature+' owner to '+q(fn.owner_name));await client.query('revoke all on function '+fn.signature+' from public,anon,authenticated,service_role');for(const a of fn.acl)await client.query('grant '+a.privilege+' on function '+fn.signature+' to '+(a.grantee==='PUBLIC'?'public':q(a.grantee))+(a.grantable?' with grant option':''));const hash=(await client.query('select md5(prosrc) hash from pg_proc where oid=$1::regprocedure',[fn.signature])).rows[0].hash;assert.equal(hash,fn.source_md5);}
  assert(scope.rls);await client.query('alter table public.invoices enable row level security');
  for(const g of scope.grants)await client.query('grant '+g.privilege+' on public.invoices to '+q(g.role));
  const commands={r:'select',a:'insert',w:'update',d:'delete','*':'all'};
  for(const p of scope.policies)await client.query('create policy '+q(p.name)+' on public.invoices as '+(p.permissive?'permissive':'restrictive')+' for '+commands[p.command]+' to '+p.roles.map(q).join(',')+(p.using?' using ('+p.using+')':'')+(p.check?' with check ('+p.check+')':''));
  await admin.query('create role '+q(role)+" login noinherit nosuperuser password '"+rolePassword+"'");await admin.query('grant authenticated,anon to '+q(role));
  const httpPort=await port();base='http://127.0.0.1:'+httpPort;
  configPath=path.join(output,'postgrest-'+suffix+'.conf');
  const uri=new URL('postgresql://127.0.0.1');uri.hostname=config.host;uri.port=String(config.port||5432);uri.username=role;uri.password=rolePassword;uri.pathname='/'+database;
  fs.writeFileSync(configPath,'db-uri = '+JSON.stringify(uri.href)+'\ndb-schemas = "public"\ndb-anon-role = "anon"\njwt-secret = '+JSON.stringify(secret)+'\nserver-host = "127.0.0.1"\nserver-port = '+httpPort+'\ndb-pool = 10\n',{mode:0o600});
  server=spawn(bin,[configPath],{env:process.env,stdio:['ignore','pipe','pipe']});server.stdout.on('data',b=>{log+=b});server.stderr.on('data',b=>{log+=b});server.on('error',e=>{log+=String(e)});
  let ready=false;for(let i=0;i<100;i++){if(server.exitCode!==null)throw Error('PostgREST exited '+log);try{const r=await fetch(base,{signal:AbortSignal.timeout(500)});if(r.ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}assert(ready,'PostgREST startup '+log);
  check('real PostgREST authenticator role, signed JWT, live invoice RLS and exact reconciliation function');
  for(const n of [1,95,190,500]){
   const started=performance.now(),r=success(await submit('http-capacity-'+n,n)),elapsedMs=performance.now()-started;
   assert.equal(r.count,n);assert.equal(r.rows.length,n);assert(elapsedMs<10000,'HTTP transaction acceptance ceiling 10 seconds');
   const read=await request('/invoices?submission_idempotency_key=eq.http-capacity-'+n+'&select=id,batch_id,total');assert.equal(read.status,200,JSON.stringify(read.data));assert.equal(read.data.length,n);assert.equal(read.data.reduce((s,x)=>s+Number(x.total),0),n*105);
   if(n>1){assert.equal(new Set(read.data.map(x=>x.batch_id)).size,1);const group=await client.query("select count(*)::int n from private.finance_history_group_projection_v1 where record_type='invoices' and group_key=$1",[r.batch_id]);assert.equal(group.rows[0].n,1);}
   evidence.measurements.push({count:n,elapsedMs});
  }
  check('1/95/190/500 invoices through real HTTP JWT/RPC/RLS; each batch one history group, exact totals and <10s');
  const bill=success(await billSubmit('http-bill-capacity-150',150));assert.equal(bill.count,150);assert.equal(new Set(bill.rows.map(x=>x.batch_id)).size,1);const billReplay=success(await billSubmit('http-bill-capacity-150',150));assert.equal(billReplay.idempotent_replay,true);assert.deepEqual(billReplay.rows,bill.rows);assert.equal((await client.query("select count(*)::int n from private.finance_history_group_projection_v1 where record_type='bills' and group_key=$1",[bill.batch_id])).rows[0].n,1);check('150 bills through real HTTP RPC and all bill triggers; one history group and replay returns original IDs');
  const concurrent=await Promise.all([1,2,3,4].map(()=>submit('http-concurrent-190',190)));const data=concurrent.map(success);assert.equal(data.filter(x=>!x.idempotent_replay).length,1);for(const x of data)assert.deepEqual(x.rows,data[0].rows);
  check('four concurrent HTTP requests produce one 190-row batch and identical replay IDs');
  // A real proxy consumes the entire backend response, then deliberately drops
  // the browser connection. The subsequent request must discover the commit.
  proxy=http.createServer(async(req,res)=>{try{const chunks=[];for await(const b of req)chunks.push(b);const upstream=await fetch(base+req.url,{method:'POST',headers:{Authorization:req.headers.authorization,'Content-Type':'application/json'},body:Buffer.concat(chunks)});await upstream.arrayBuffer();res.destroy();}catch{res.destroy();}});
  await new Promise(r=>proxy.listen(0,'127.0.0.1',r));let dropped=false;try{await submit('http-lost-response',95,{url:'http://127.0.0.1:'+proxy.address().port});}catch{dropped=true;}assert(dropped,'proxy must break response');
  const recovered=success(await reconcile('http-lost-response'));assert.equal(recovered.state,'committed');assert.equal(recovered.result.count,95);const replay=success(await submit('http-lost-response',95));assert.equal(replay.idempotent_replay,true);assert.deepEqual(replay.rows,recovered.result.rows);
  check('backend commit followed by dropped TCP response; reconciliation and retry return original batch');
  const invalid=await submit('http-invalid-last',[f.item(1),f.item(2,{total:'999'})]);assert.equal(invalid.status,400,JSON.stringify(invalid));assert.equal(invalid.data.code,'23514');assert.equal((await client.query("select count(*)::int n from public.invoices where submission_idempotency_key='http-invalid-last'")).rows[0].n,0);
  const canceled=success(await reconcile('http-invalid-last'));assert.equal(canceled.state,'confirmed_not_committed');assert((await submit('http-invalid-last',1)).status>=400,'canceled operation cannot be recreated');
  check('invalid last row leaves no partial documents; confirmed rollback reserves old key against delayed resend');
  denied(await submit('http-anonymous-1',1,{token:null}));denied(await submit('http-bad-signature',1,{token:jwt(f.uid,f.sid,'bad-secret')}));denied(await submit('http-wrong-session',1,{token:jwt(f.uid,crypto.randomUUID())}));denied(await billSubmit('http-bill-wrong-session',1,{token:jwt(f.uid,crypto.randomUUID())}));
  const cross=await submit('http-wrong-entity',[f.item(1,{entity_id:'FOREIGN'})]);assert(cross.status>=400);assert.equal((await client.query("select count(*)::int n from public.invoices where submission_idempotency_key='http-wrong-entity'")).rows[0].n,0);
  check('anonymous, forged JWT, invalid session and unauthorized entity cannot submit');
  // Second valid Google-linked employee in another company: real policy must
  // hide the first employee's rows and refuse reading their operation result.
  const otherUid=crypto.randomUUID(),otherSid=crypto.randomUUID();
  await client.query(`insert into auth.users(id,email) values($1,'other.fixture@suiyuecare.com');`,[otherUid]);
  await client.query(`insert into auth.identities(provider_id,user_id,provider,identity_data,created_at) values('fixture-other-google',$1,'google','{"email":"other.fixture@suiyuecare.com","email_verified":true}',now())`,[otherUid]);
  await client.query('insert into auth.sessions(id,user_id) values($1,$2)',[otherSid,otherUid]);
  await client.query(`insert into public.finance_users(id,name,email,role,tenant_id,auth_user_id,google_link_status,active,department_code) values('FICT-OTHER','另一虛構人員','other.fixture@suiyuecare.com','employee',$1,$2,'bound',true,'OTHER-D1')`,[f.otherTenant,otherUid]);
  await client.query(`insert into public.tenant_members(email,name,role,tenant_id,auth_user_id,finance_user_id,active) values('other.fixture@suiyuecare.com','另一虛構人員','employee',$1,$2,'FICT-OTHER',true)`,[f.otherTenant,otherUid]);
  const otherToken=jwt(otherUid,otherSid),hidden=await request('/invoices?select=id',undefined,{token:otherToken});assert.equal(hidden.status,200,JSON.stringify(hidden));assert.deepEqual(hidden.data,[]);
  const otherResult=await reconcile('http-lost-response',{token:otherToken});assert(otherResult.status>=400||otherResult.data.state!=='committed','foreign operation result never disclosed');
  await client.query('delete from auth.sessions where id=$1',[f.sid]);denied(await reconcile('http-lost-response'));denied(await submit('http-revoked-session',1));denied(await billSubmit('http-bill-revoked-session',1));
  check('separate valid company identity sees no invoices/results; deleted session blocks still-unexpired JWT');
  evidence.ok=true;evidence.finishedAt=new Date().toISOString();console.log(JSON.stringify({ok:true,checks:evidence.checks.length,measurements:evidence.measurements,output},null,2));
 }catch(e){evidence.ok=false;evidence.error={message:e.message,code:e.code,stack:e.stack};throw e;}
 finally{
  fs.writeFileSync(path.join(output,'evidence.json'),JSON.stringify(evidence,null,2));fs.writeFileSync(path.join(output,'postgrest.log'),log);
  if(configPath)fs.rmSync(configPath,{force:true});if(proxy)await new Promise(r=>proxy.close(r));
  if(server&&server.exitCode===null){server.kill('SIGTERM');await Promise.race([new Promise(r=>server.once('exit',r)),new Promise(r=>setTimeout(r,2000))]);if(server.exitCode===null)server.kill('SIGKILL');}
  if(client)await client.end();if(admin){await admin.query('drop database if exists '+q(database)+' with(force)');await admin.query('drop role if exists '+q(role));await admin.end();}
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
