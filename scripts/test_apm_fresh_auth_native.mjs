import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {createNativeDatabase,waitForAdvisory} from './apm-native-test-runtime.mjs';
const db=await createNativeDatabase();
const file=new URL('./test_apm_finance_workbench.mjs',import.meta.url);
let source=await readFile(file,'utf8');
source=source.replace(/^import .*;\n/gm,'').replace('const db=new PGlite();','').replaceAll('import.meta.url',JSON.stringify(file.href));
source=source.replaceAll('/FORBIDDEN/','/FORBIDDEN|AUTHORITY_CHANGED/');
source=source.replace('create table auth.sessions(user_id uuid primary key,active boolean);',()=>"create table auth.sessions(user_id uuid primary key,active boolean,id uuid default gen_random_uuid(),not_after timestamptz); create function auth.jwt() returns jsonb language sql stable as $$select jsonb_build_object('session_id',(select id from auth.sessions where user_id=auth.uid()))$$;");
source=source.replace("insert into auth.sessions values($1,true)","insert into auth.sessions(user_id,active) values($1,true)");
source=source.replace("'20261020021355_apm_finance_workbench_ui.sql']","'20261020021355_apm_finance_workbench_ui.sql','20261020024107_apm_fresh_command_authorization.sql']");
source=source.replace(' console.log(JSON.stringify({checks,failed:0,scope:', ' await concurrency({tenant,accountant,ceo,company,department,employer,proposal,base});\n console.log(JSON.stringify({checks,failed:0,scope:');
async function concurrency(c){
 const blocker=await db.connectPeer(),observer=await db.connectPeer();let cases=0;
 const role=async user=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user]);await db.exec('set role authenticated');};
 await db.exec('reset role');await db.query('update auth.sessions set active=true');await db.query("insert into finance_hr_private.readers values($1,$2,'ceo')",[c.tenant,c.employer]);
 const waitRevoke=async({user,key,seed,sql,args,revoke,restore,count})=>{
  await role(user);const before=await observer.query(count);await blocker.query('begin');await blocker.query('select pg_advisory_xact_lock(hashtextextended($1,$2))',[key,seed]);
  let failure;const running=db.query(sql,args).then(()=>{failure=new Error('Unauthorized mutation unexpectedly succeeded');},error=>{failure=error;});
  await waitForAdvisory(observer,db.backendPid);await blocker.query(revoke);await blocker.query('commit');await running;
  assert.match(failure?.message??'',/AUTHORITY_CHANGED|FORBIDDEN|DEPARTMENT_OUTSIDE_SCOPE/);assert.deepEqual((await observer.query(count)).rows,before.rows,'all writes from denied command roll back');
  await observer.query(restore);cases++;
 };
 for(const revoked of ['actor','scope']){
  const requestId=randomUUID(),p={entityId:'E1',requestId,...c.base,apmDepartmentId:randomUUID()};
  await waitRevoke({user:c.accountant,key:c.tenant+'acc'+requestId,seed:831,sql:'select public.finance_apm_metrics_command($1,$2)',args:['mapping.propose',p],
   revoke:revoked==='actor'?"update public.finance_users set active=false where id='acc'":"update public.finance_department_units set active=false where code='D1'",
   restore:revoked==='actor'?"update public.finance_users set active=true where id='acc'":"update public.finance_department_units set active=true where code='D1'",
   count:'select (select count(*) from finance_apm_private.metric_mappings) mappings,(select count(*) from finance_apm_private.commands) commands'});
 }
 await db.exec('reset role');for(const month of ['04','05','06'])await db.query("insert into public.period_closes(tenant_id,entity_id,data_environment,period,status)values($1,'E1','production',$2,'closed')",[c.tenant,'2026-'+month]);
 await db.query("insert into public.ledger_entries(tenant_id,entity_id,data_environment,department_code,account_code,entry_date,debit,credit)values($1,'E1','production','D1','4110','2026-05-15',0,1000)",[c.tenant]);
 await role(c.accountant);const preview=(await db.query('select public.finance_apm_metrics_command($1,$2) value',['snapshot.preview',{entityId:'E1',requestId:randomUUID(),mappingId:c.proposal.mappingId,year:2026,quarter:2}])).rows[0].value;
 for(const revoked of ['actor','previewer']){
  const p={entityId:'E1',requestId:randomUUID(),mappingId:c.proposal.mappingId,year:2026,quarter:2,previewHash:preview.previewHash};
  await waitRevoke({user:c.ceo,key:'finance_period|'+c.tenant+'|production|E1|2026-04',seed:0,sql:'select public.finance_apm_metrics_command($1,$2)',args:['snapshot.approve',p],
   revoke:revoked==='actor'?"update public.finance_users set role='employee' where id='ceo'":"update public.finance_users set active=false where id='acc'",
   restore:revoked==='actor'?"update public.finance_users set role='ceo' where id='ceo'":"update public.finance_users set active=true where id='acc'",
   count:'select (select count(*) from finance_apm_private.metric_snapshots) snapshots,(select count(*) from finance_apm_private.commands) commands'});
 }
 await db.exec('reset role');const obligation=randomUUID();
 await db.query("insert into finance_hr_private.finance_hr_obligations(obligation_id,flow_id,tenant_id,source_employer_id,source_hash,legal_entity_code,total_net_cents,kind,period,pay_date,status)values($1,$2,$3,$4,$5,'E1',100000,'bonus','2026-Q3','2026-10-25','closed')",[obligation,randomUUID(),c.tenant,c.employer,'a'.repeat(64)]);
 await db.query("insert into public.vouchers values('wait-original','W1',$1,'E1','production',true,now(),null,null,1000),('wait-reverse','W2',$1,'E1','production',true,now(),null,'W1',1000)",[c.tenant]);
 await db.query("insert into finance_hr_private.finance_hr_voucher_claims values('wait-original',$1)",[obligation]);await db.query("insert into finance_hr_private.finance_hr_events values($1,'bank_disbursement','finance')",[obligation]);
 await db.query("insert into public.ledger_entries(tenant_id,entity_id,data_environment,department_code,account_code,debit,credit,voucher_no)values($1,'E1','production','D1','5110',1000,0,'W1'),($1,'E1','production','D1','1100',0,1000,'W1'),($1,'E1','production','D1','5110',0,1000,'W2'),($1,'E1','production','D1','1100',1000,0,'W2')",[c.tenant]);
 await role(c.accountant);const proposal=(await db.query('select public.finance_apm_correction_command($1,$2) value',['propose',{requestId:randomUUID(),reference:'SYNTHETIC lock-wait correction',obligationId:obligation,correctionBatchId:randomUUID(),originalBatchId:randomUUID(),correctionSourceHash:'b'.repeat(64),reversalVoucherId:'wait-reverse',refund:{status:'settled',amountCents:100000,reference:'SYNTHETIC settled refund proof',sha256:'c'.repeat(64)}}])).rows[0].value;
 for(const revoked of ['actor','reader','session','session_expiry']){
  const p={requestId:randomUUID(),reference:'SYNTHETIC lock-wait independent review',proposalId:proposal.proposalId};
  await waitRevoke({user:c.ceo,key:obligation,seed:617,sql:'select public.finance_apm_correction_command($1,$2)',args:['verify',p],
   revoke:revoked==='actor'?"update public.finance_users set active=false where id='ceo'":revoked==='reader'?"delete from finance_hr_private.readers where actor_id='ceo'":revoked==='session'?`update auth.sessions set active=false where user_id='${c.ceo}'`:`update auth.sessions set not_after=clock_timestamp() where user_id='${c.ceo}'`,
   restore:revoked==='actor'?"update public.finance_users set active=true where id='ceo'":revoked==='reader'?`insert into finance_hr_private.readers values('${c.tenant}','${c.employer}','ceo')`:`update auth.sessions set active=true,not_after=null where user_id='${c.ceo}'`,
   count:'select (select count(*) from finance_apm_private.correction_receipts) receipts,(select count(*) from finance_apm_private.commands) commands'});
 }
 console.log(JSON.stringify({nativeConcurrentRevocations:cases,failed:0,isolation:'read committed',assertion:'real advisory wait; concurrent committed revocation; zero mutation or replay receipt'}));
}
try {await new (Object.getPrototypeOf(async function(){}).constructor)('db','assert','readFile','randomUUID','concurrency',source)(db,assert,readFile,randomUUID,concurrency);}catch(error){await db.close().catch(()=>{});throw error;}
