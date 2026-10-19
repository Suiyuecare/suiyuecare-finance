#!/usr/bin/env node
'use strict';
// Replay the exact deployed authority helpers and sealed migrations using only
// fictional requests. This is a namespace repair, never a payment operation.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite'),{pgcrypto}=require('@electric-sql/pglite/contrib/pgcrypto');
const history=require('./check_remittance_history_private.cjs'),mega=require('./check_mega_remittance_private.cjs');
const fixture=history.fixture,root=path.resolve(__dirname,'..');
const version='20261019063423',name='finance_remittance_namespace_boundary_v1';
const migration=fs.readFileSync(path.join(root,'supabase/migrations',version+'_'+name+'.sql'),'utf8');
const pins=[
 ['finance_mega_remittance_snapshot_v1(text,text)','58332e61aec57e7a0ba3cc989720481a','d2627b572ab40abe5c8fcd9890b92ada'],
 ['finance_mega_remittance_supplement_save_v1(text,text,text,jsonb)','1807e06238e4a34ae76fc95c5c51aaa9','557b7b8638fdcadb3e4a859de539449b'],
 ['finance_remittance_export_snapshot_v1(text,text)','c29403a2d6ed7da04ae7536460f8fd36','129656b574f598fe297945bb8fe15b22'],
 ['finance_remittance_export_supplement_save_v1(text,text,text,jsonb)','f387ad820b04cc0f33d1794c1629805c','f4cbfd740fa8e50737814835795c8eb9']
];
const gate=kind=>fs.readFileSync(path.join(__dirname,'finance_remittance_boundary_'+kind+'.sql'),'utf8').replace(/^\\set ON_ERROR_STOP on\r?\n/,'');
async function record(db,v,n,sql){await db.query('insert into supabase_migrations.schema_migrations(version,name,statements) values($1,$2,$3)',[v,n,[sql.trimEnd()]]);}
async function setup(db,{installMigration=true}={}){
 await history.setup(db);await db.exec('reset role;alter table supabase_migrations.schema_migrations add column statements text[],add column created_by text;');
 for(const [v,n] of [['20261018074245','finance_mega_remittance_private_v1'],['20261019032213','finance_remittance_export_history_v1']])await record(db,v,n,fs.readFileSync(path.join(root,'supabase/migrations',v+'_'+n+'.sql'),'utf8'));
 if(installMigration){await db.exec(migration);await record(db,version,name,migration);}
 await db.exec('set role authenticated');return{fixture};
}
async function run(db){
 let checks=0;const check=(condition,message)=>{assert(condition,message);checks++;};
 const eq=(a,b,message)=>{assert.deepEqual(a,b,message);checks++;};
 const deny=async(fn,code,message)=>{await assert.rejects(fn,e=>e.code===code,message);checks++;};
 const snapshot=async(historyApi=true,id='FICT-MEGA-1',env='production')=>(await db.query('select public.'+(historyApi?'finance_remittance_export_snapshot_v1':'finance_mega_remittance_snapshot_v1')+'($1,$2) result',[id,env])).rows[0].result;
 const save=async(historyApi,id,digest,rows)=>(await db.query('select public.'+(historyApi?'finance_remittance_export_supplement_save_v1':'finance_mega_remittance_supplement_save_v1')+'($1,$2,$3,$4::jsonb) result',[id,'production',digest,JSON.stringify(rows)])).rows[0].result;
 async function admin(sql,args=[]){await db.exec('reset role');try{return await db.query(sql,args);}finally{await db.exec('set role authenticated');}}
 async function mutate(sql,args=[]){await db.exec('reset role;set session_replication_role=replica');try{return await db.query(sql,args);}finally{await db.exec('set session_replication_role=origin;set role authenticated');}}
 async function actor(role){await mutate("update public.finance_users set role=$1,entity_id='FICT-E1',active=true where id=$2",[role,fixture.actor]);await mutate('update public.tenant_members set role=$1,active=true where finance_user_id=$2',[role,fixture.actor]);}
 async function rollbackCase(sql,args,fn){await db.exec('begin');try{await mutate(sql,args);await fn();}finally{await db.exec('rollback;set role authenticated');}}
 const financialFingerprint=async()=>(await admin("select md5(jsonb_agg(to_jsonb(r) order by id)::text) hash from public.expense_requests r")).rows[0].hash;
 const beforeBusiness=await financialFingerprint();
 let h=await snapshot();check(h.exportPurpose==='historical'&&h.stage==='pending_applicant_confirm'&&h.historicalPrincipal===300&&h.historicalBankFeeAmount===30,'Authorized historical view keeps actual status, principal, and separate fee');
 let p=await snapshot(false,'FICT-MEGA-PAY');check(p.ok&&p.request.status==='pending_cashier'&&p.request.amount===100,'Original pending cashier snapshot remains available');
 let current=await snapshot(true,'FICT-MEGA-PAY');check(current.exportPurpose==='payment'&&current.sourceDigest===p.sourceDigest,'New pending API retains old version/digest contract');
 h=await save(true,'FICT-MEGA-1',h.sourceDigest,[{rowKey:'hr:1',name:'虛構收款甲',bankCode:'8121234'},{rowKey:'hr:2',name:'虛構收款乙',bankCode:'017'}]);
 check(h.supplements.length===2&&h.exportPurpose==='historical','Historical public supplement API remains authorized and separate');
 p=await save(false,'FICT-MEGA-PAY',p.sourceDigest,[{rowKey:'payment:1',bankCode:'017'}]);check(p.ok&&p.supplements.length===1,'Original public supplement save remains available');
 current=await snapshot(true,'FICT-MEGA-PAY');current=await save(true,'FICT-MEGA-PAY',current.sourceDigest,[{rowKey:'payment:1',bankCode:'017'}]);check(current.exportPurpose==='payment','New pending supplement API still delegates to existing validation');
 eq(await financialFingerprint(),beforeBusiness,'Reads and private supplements do not alter any request, amount, approval, posting, or account');
 await deny(()=>save(true,'FICT-MEGA-1','stale',[{rowKey:'hr:1',name:'虛構錯誤'}]),'40001','Historical stale digest is rejected');
 await deny(()=>save(true,'FICT-MEGA-1',h.sourceDigest,[{rowKey:'hr:1',account:'999',amount:1}]),'22023','Historical supplement cannot change account or amount');
 await deny(()=>save(false,'FICT-MEGA-PAY',p.sourceDigest,[{rowKey:'payment:1',account:'999'}]),'22023','Pending supplement cannot change account');
 for(const [signature] of pins){
  const result=(await admin("select pg_catalog.has_function_privilege('authenticated',$1,'EXECUTE') public_execute,pg_catalog.has_function_privilege('authenticated',$2,'EXECUTE') private_execute,pg_catalog.has_function_privilege('anon',$1,'EXECUTE') anon_execute,pg_catalog.has_function_privilege('service_role',$1,'EXECUTE') service_execute",['public.'+signature,'private.'+signature])).rows[0];
  eq(result,{public_execute:true,private_execute:false,anon_execute:false,service_execute:false},signature+' is exposed only through its public guard');
  const args=signature.includes('save')?"('FICT-MEGA-1','production','stale','[]'::jsonb)":"('FICT-MEGA-1','production')";
  await deny(()=>db.query('select private.'+signature.split('(')[0]+args),'42501','Authenticated direct private entry is denied '+signature);
 }
 const isolation=(await admin("select has_schema_privilege('anon','private','USAGE') anon,has_schema_privilege('authenticated','private','USAGE') authenticated")).rows[0];eq(isolation,{anon:false,authenticated:false},'Established HR/payroll namespace checks pass again');
 for(const sql of ['select * from private.finance_mega_recipient_supplements_v1','select * from private.finance_mega_recipient_events_v1'])await deny(()=>db.query(sql),'42501','Private table stays inaccessible');
 await actor('employee');for(const old of [true,false])await deny(()=>snapshot(old,old?'FICT-MEGA-1':'FICT-MEGA-PAY'),'42501','Applicant without bank role cannot use definer wrapper');
 await actor('ceo');h=await snapshot();check(h.eligible&&!h.canSupplement,'CEO retains read-only historical access');await deny(()=>save(true,'FICT-MEGA-1',h.sourceDigest,[{rowKey:'hr:1',name:'不可修改'}]),'42501','CEO cannot gain private identity editing');
 await actor('cashier');check((await snapshot()).eligible,'Assigned historical cashier can read');
 await rollbackCase("update public.expense_requests set steps=jsonb_set(steps,'{2,uid}','\"OTHER\"') where id='FICT-MEGA-1'",[],()=>deny(()=>snapshot(),'42501','Other cashier cannot read historical bank data'));
 check((await snapshot(false,'FICT-MEGA-PAY')).ok,'Assigned pending cashier can still read');
 await rollbackCase("update public.expense_requests set steps=jsonb_set(steps,'{1,uid}','\"OTHER\"') where id='FICT-MEGA-PAY'",[],()=>deny(()=>snapshot(false,'FICT-MEGA-PAY'),'42501','Other cashier cannot read pending bank data'));
 await actor('hr');check((await snapshot()).canSupplement,'Same entity HR can supplement historical payroll');
 await rollbackCase("update public.finance_users set entity_id='FICT-OTHER' where id=$1",[fixture.actor],()=>deny(()=>snapshot(),'42501','HR cross-entity read remains denied'));
 await actor('accountant');
 await deny(()=>snapshot(true,'FICT-MEGA-1','test'),'42501','Cross-environment read stays denied');
 for(const [sql,args,label] of [
  ["update public.expense_requests set tenant_id=$1 where id='FICT-MEGA-1'",[fixture.otherTenant],'Cross-tenant read stays denied'],
  ['update public.finance_users set active=false where id=$1',[fixture.actor],'Inactive user stays denied'],
  ['delete from auth.sessions where id=$1',[fixture.sid],'Deleted Google session stays denied'],
  ["update auth.sessions set not_after=now()-interval '1 minute' where id=$1",[fixture.sid],'Expired Google session stays denied'],
  ["update auth.identities set identity_data=jsonb_set(identity_data,'{email_verified}','false') where user_id=$1",[fixture.uid],'Unverified Google identity stays denied']
 ])await rollbackCase(sql,args,()=>deny(()=>snapshot(),'42501',label));
 for(const role of ['anon','service_role']){await db.exec('reset role;set role '+role);for(const api of [true,false])await deny(()=>snapshot(api,api?'FICT-MEGA-1':'FICT-MEGA-PAY'),'42501',role+' cannot execute public guarded API');}
 for(const api of [true,false]){await db.exec('reset role;set role authenticated;begin');await db.query("select set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claims','{}',true)");await deny(()=>snapshot(api,api?'FICT-MEGA-1':'FICT-MEGA-PAY'),'42501','Absent JWT remains denied');await db.exec('rollback;set role authenticated');}
 await rollbackCase("update public.expense_requests set status='pending_ceo' where id='FICT-MEGA-PAY'",[],()=>deny(()=>snapshot(false,'FICT-MEGA-PAY'),'55000','Original pending workflow guard is not bypassed'));
 await deny(()=>snapshot(false,'FICT-MEGA-1'),'55000','Paid historical request cannot use current-payment API');
 eq(await financialFingerprint(),beforeBusiness,'All denied cases and rolled-back fixture changes leave financial records unchanged');
 await db.exec('reset role');await db.exec(gate('postflight'));checks++;
 return {checks,productionDataUsed:false,bankTransferExecuted:false};
}
async function main(){
 const db=new PGlite({extensions:{pgcrypto}});let checks=0;
 try{
  await setup(db,{installMigration:false});await db.exec('reset role;set search_path=\'\';grant usage on schema private to service_role;');
  const defs=async()=>(await db.query("select n.nspname||'.'||p.proname signature,md5(pg_get_functiondef(p.oid)) definition,md5(prosrc) source,proacl::text acl from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('private','public') and (p.proname like 'finance_mega_%' or p.proname like 'finance_remittance_export_%') order by 1")).rows;
  const old=await defs();for(const [sig,hash] of pins){assert.equal(old.find(r=>r.signature==='public.'+sig.split('(')[0]).definition,hash);checks++;}
  await db.exec('set role authenticated');const before=(await db.query("select public.finance_remittance_export_snapshot_v1('FICT-MEGA-1','production') result")).rows[0].result;
  await db.exec('reset role');await db.exec(gate('preflight'));await db.exec(migration);await record(db,version,name,migration);checks++;
  const after=await defs();for(const previous of old){const current=after.find(r=>r.signature===previous.signature);assert.equal(current.source,previous.source,'Every function body remains identical');checks++;if(previous.signature.startsWith('public.')){const pin=pins.find(([sig])=>previous.signature==='public.'+sig.split('(')[0]);assert.equal(current.definition,pin[2]);assert.equal(current.acl,previous.acl);checks+=2;}else {assert.equal(current.definition,previous.definition);checks++;}}
  assert.equal((await db.query("select has_schema_privilege('service_role','private','USAGE') allowed")).rows[0].allowed,true,'Existing service_role schema privilege is unchanged');checks++;
  await db.exec('set role authenticated');const unchanged=(await db.query("select public.finance_remittance_export_snapshot_v1('FICT-MEGA-1','production') result")).rows[0].result;assert.deepEqual(unchanged,before,'Exact authorized source response is unchanged by wrapper repair');checks++;
  const result=await run(db);console.log(JSON.stringify({...result,checks:checks+result.checks,exactBodyProvenance:true,predecessorReplay:true}));
 }finally{await db.close();}
 // Run the existing complete pending-only suite after the repair too. The
 // independent instance keeps its original synthetic pending payroll fixture.
 const pending=new PGlite({extensions:{pgcrypto}});
 try{await mega.setup(pending);await pending.exec('reset role;create table private.expense_accounting_corrections_v1(tenant_id uuid not null,data_environment text not null,request_id text not null,status text not null);');await pending.exec(history.migration);await pending.exec('alter table supabase_migrations.schema_migrations add column statements text[],add column created_by text;');for(const [v,n,sql] of [['20261018074245','finance_mega_remittance_private_v1',mega.migration],['20261019032213','finance_remittance_export_history_v1',history.migration]])await record(pending,v,n,sql);await pending.exec(migration);const result=await mega.run(pending);console.log(JSON.stringify({postRepairExistingMegaChecks:result.checks,productionDataUsed:false,bankTransferExecuted:false}));}finally{await pending.close();}
}
module.exports={setup,run,migration,fixture,record,version,name,gate,pins};
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1;});
