// Local-only PostgreSQL 17 fixture. No Supabase connection or production URL.
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {Client} from 'pg';
export async function createNativeDatabase(){
 const runtime=process.env.PG_TOOLS_PATH;if(!runtime)throw new Error('PG_TOOLS_PATH is required for opt-in native tests');
 const run=mkdtempSync(join(tmpdir(),'apm-auth-native-')),data=join(run,'data'),socket=join(run,'socket');mkdirSync(socket);
 const execute=(name,args)=>{const r=spawnSync(join(runtime,name),args,{encoding:'utf8'});assert.equal(r.status,0,r.stderr||r.stdout);};
 execute('initdb',['-D',data,'-U','postgres','--no-locale','-E','UTF8','-A','trust']);
 execute('pg_ctl',['-D',data,'-l',join(run,'server.log'),'-w','start','-o',`-h '' -k '${socket}' -p 55439`]);
 const peers=[];const connect=async()=>{const c=new Client({host:socket,port:55439,user:'postgres',database:'postgres'});await c.connect();peers.push(c);return c;};
 const client=await connect();const backendPid=(await client.query('select pg_backend_pid() pid')).rows[0].pid;
 console.log(JSON.stringify({nativeVersion:(await client.query('select version() v')).rows[0].v,run}));
 return {exec:sql=>client.query(sql),query:(sql,args)=>client.query(sql,args),connectPeer:connect,backendPid,
 close:async()=>{await Promise.all(peers.map(c=>c.end()));execute('pg_ctl',['-D',data,'-w','stop','-m','fast']);}};
}
export async function waitForAdvisory(observer,pid){
 const deadline=Date.now()+10000;
 while(Date.now()<deadline){const r=await observer.query("select wait_event_type,wait_event from pg_stat_activity where pid=$1",[pid]);if(r.rows[0]?.wait_event_type==='Lock'&&r.rows[0]?.wait_event==='advisory')return;await new Promise(resolve=>setTimeout(resolve,20));}
 throw new Error('Worker never reached the expected real advisory-lock wait');
}
