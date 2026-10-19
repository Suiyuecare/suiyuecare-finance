#!/usr/bin/env node
'use strict';
// Real deployed identity/read/Mega helpers; only fictional requests are used.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite'),{pgcrypto}=require('@electric-sql/pglite/contrib/pgcrypto');
const base=require('./check_mega_remittance_private.cjs');
const source=require('../assets/engines/mega-remittance-source.js'),adapter=require('../assets/engines/mega-remittance-adapter.js');
const migration=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261019032213_finance_remittance_export_history_v1.sql'),'utf8');
const fixture=base.fixture;
let db,originalMegaDefinitions;const checks=[];
const check=(label,value)=>{assert(value,label);checks.push(label)};
async function rejected(fn,code,label){await assert.rejects(fn,e=>e.code===code,label);checks.push(label)}
async function mutate(sql,args=[]){await db.exec('reset role;set session_replication_role=replica');try{return await db.query(sql,args)}finally{await db.exec('set session_replication_role=origin;set role authenticated')}}
async function actor(role='accountant'){await mutate("update public.finance_users set role=$1,active=true,entity_id='FICT-E1' where id=$2",[role,fixture.actor]);await mutate('update public.tenant_members set role=$1,active=true where finance_user_id=$2',[role,fixture.actor]);}
const submitted='2026-10-01T01:00:00Z',paid='2026-10-03T02:00:00Z';
const steps=()=>[{rk:'applicant_submit',uid:fixture.actor,a:'approved'},{rk:'ceo',uid:'FICT-CEO',a:'approved'},{rk:'cashier',uid:fixture.actor,a:'approved'},{rk:'applicant_confirm',uid:fixture.actor,a:''}];
const hrRows=[{'銀行代號':'812','銀行帳號':'00000001234567','金額':100},{'銀行代號':'017','銀行帳號':'00000007654321','金額':200}];
const payload=()=>({paymentType:'bank',_submissionPayloadSha256V3:'a'.repeat(64),cashAmount:330,hrItem:'salary_50',hrInfo:{rows:hrRows,paymentTotal:300}});
async function reset(){
 await actor();await mutate("update public.expense_requests set tenant_id=$1,data_environment='production',entity_id='FICT-E1',applicant_id=$2,type='hr_expense_request',status='pending_applicant_confirm',created_at=$3,cash_posted_at=$4,request_date='2026-09-01',updated_at=$3,amount=300,actual_amount=null,estimated_amount=null,bank_fee_amount=30,fee_bearer='己方支出',bank_name='017 兆豐銀行',bank_type='mega',bank_no='00000000987654',payee='虛構廠商',expected_pay_date='2026-10-03',steps=$5::jsonb,form_payload=$6::jsonb,ver=3,voucher_id=null,ledger_posted_at=null,posting_locked_at=null,voided_at=null where id='FICT-MEGA-1'",[fixture.tenant,fixture.actor,submitted,paid,JSON.stringify(steps()),JSON.stringify(payload())]);
 await mutate("delete from private.expense_accounting_corrections_v1 where request_id='FICT-MEGA-1'");
}
async function snap(id='FICT-MEGA-1',env='production'){return(await db.query('select public.finance_remittance_export_snapshot_v1($1,$2) result',[id,env])).rows[0].result;}
async function save(digest,rows){return(await db.query('select public.finance_remittance_export_supplement_save_v1($1,$2,$3,$4::jsonb) result',['FICT-MEGA-1','production',digest,JSON.stringify(rows)])).rows[0].result;}
async function unavailable(label,reason){const s=await snap();check(label,s.ok&&s.exportPurpose==='unavailable'&&!s.eligible&&!s.canSupplement&&!('request' in s)&&!('supplements' in s)&&(!reason||s.reason===reason));return s;}
async function setup(database,{installMigration=true}={}){db=database;await base.setup(db);await db.exec('reset role');
 // This release reads only correction existence/status, not its mutation engine.
 // Reproduce precisely those production column types for isolated fixture rows.
 await db.exec("create table private.expense_accounting_corrections_v1(tenant_id uuid not null,data_environment text not null,request_id text not null,status text not null);revoke all on private.expense_accounting_corrections_v1 from public,anon,authenticated,service_role;");
 const old=(await db.query("select n.nspname||'.'||p.proname name,md5(pg_get_functiondef(p.oid)) hash from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname like 'finance_mega_%' order by 1")).rows;originalMegaDefinitions=old;
 if(installMigration)await db.exec(migration);await db.exec('set role authenticated');await reset();return {fixture,old};
}
async function run(database){db=database;checks.length=0;await reset();
 let s=await snap();check('Paid historical row retains actual workflow status and authoritative submission metadata',s.ok&&s.exportPurpose==='historical'&&s.stage==='pending_applicant_confirm'&&s.request.status==='pending_applicant_confirm'&&s.submissionSource==='server_created_at'&&Date.parse(s.submittedAt)===Date.parse(submitted)&&s.historyCutoff==='2026-09-30T16:00:00Z');
 check('Historical principal excludes saved own-side bank fee',s.historicalPrincipal===300&&s.historicalCashAmount===330&&s.historicalBankFeeAmount===30&&s.canSupplement);
 await rejected(()=>db.query('select public.finance_mega_remittance_snapshot_v1($1,$2)',['FICT-MEGA-1','production']),'55000','Original pending-only API still rejects paid history');
 const before=JSON.stringify(s.request),digest=s.sourceDigest;
 s=await save(digest,[{rowKey:'hr:1',name:'虛構收款甲',bankCode:'8121234'},{rowKey:'hr:2',name:'虛構收款乙',bankCode:'017'}]);
 check('Historical supplement stores private identities without changing approved source or payment status',s.exportPurpose==='historical'&&s.supplements.length===2&&JSON.stringify(s.request)===before&&s.sourceDigest!==digest);
 let adapted=adapter.adapt(s,source);check('Actual SQL snapshot passes browser adapter/source as historical net payroll without changing real status',adapted.ok&&adapted.eligible&&adapted.exportPurpose==='historical'&&adapted.stage==='pending_applicant_confirm'&&adapted.mode==='payroll'&&adapted.expectedTotal===300&&adapted.issues.length===0&&adapted.rows.map(r=>r.amount).join(',')==='100,200');
 await rejected(()=>save(digest,[{rowKey:'hr:1',name:'過期名稱'}]),'40001','Stale historical digest cannot overwrite another supplement');
 await rejected(()=>save(s.sourceDigest,[{rowKey:'hr:1',amount:1,account:'999'}]),'22023','Historical supplement cannot edit amount or bank account');
 await rejected(()=>save(s.sourceDigest,[{rowKey:'hr:1',bankCode:'0041234'}]),'22023','Historical original bank prefix cannot change');
 await rejected(()=>save(s.sourceDigest,[{rowKey:'hr:1',name:'暫時名稱'},{rowKey:'hr:2',bankCode:'0041234'}]),'22023','Historical multirow invalid save rolls back atomically');
 check('Atomic failure leaves same supplement digest',(await snap()).sourceDigest===s.sourceDigest);
 await mutate("update public.expense_requests set form_payload=jsonb_set(form_payload,'{hrInfo,rows,0,銀行帳號}','\"00000009999999\"'),ver=ver+1 where id='FICT-MEGA-1'");
 check('Changed source account/version invalidates historical private mapping',(await snap()).supplements.length===0);
 await reset();await mutate("update public.expense_requests set created_at='2026-09-30T15:59:59.999Z',request_date='2026-10-16' where id='FICT-MEGA-1'");await unavailable('Request date cannot move pre-cutoff submission into historical scope','before_history_cutoff');
 await mutate("update public.expense_requests set created_at='2026-09-30T16:00:00Z',request_date='2026-09-01' where id='FICT-MEGA-1'");s=await snap();check('Taipei October 1 midnight is inclusive regardless of request date',s.exportPurpose==='historical');adapted=adapter.adapt(s,source);check('Browser recognizes exact Taipei cutoff from authoritative SQL metadata',adapted.exportPurpose==='historical'&&adapted.eligible&&adapted.stage==='pending_applicant_confirm');
 await reset();await mutate("update public.expense_requests set form_payload=form_payload-'_submissionPayloadSha256V3' where id='FICT-MEGA-1'");await unavailable('Missing formal submission marker fails closed','submission_evidence_missing');
 await reset();await mutate("update public.expense_requests set steps=jsonb_set(steps,'{0,a}','\"\"') where id='FICT-MEGA-1'");await unavailable('Missing approved applicant step fails closed','submission_evidence_missing');
 await reset();await mutate("update public.expense_requests set steps=jsonb_set(steps,'{0,uid}','\"OTHER\"') where id='FICT-MEGA-1'");await unavailable('Different applicant step identity fails closed','submission_evidence_missing');
 for(const status of ['cancelled','rejected','voided','draft']){await reset();await mutate('update public.expense_requests set status=$1 where id=$2',[status,'FICT-MEGA-1']);await unavailable(status+' is not a historical export');}
 await reset();await mutate("update public.expense_requests set voided_at=now() where id='FICT-MEGA-1'");await unavailable('Voided cash source is not a reference payment');
 await reset();await mutate("update public.expense_requests set cash_posted_at=null where id='FICT-MEGA-1'");await unavailable('Cashier approval without posting evidence cannot claim payment','payment_evidence_incomplete');
 for(const action of ['','AUTO','rejected']){await reset();await mutate('update public.expense_requests set steps=jsonb_set(steps,\'{2,a}\',to_jsonb($1::text)) where id=$2',[action,'FICT-MEGA-1']);await unavailable('Cashier '+(action||'pending')+' is not an actual paid approval');}
 await reset();await mutate("update public.expense_requests set steps=jsonb_set(steps,'{1,a}','\"\"') where id='FICT-MEGA-1'");await unavailable('Unapproved prior supervisor prevents historical export','cashier_evidence_incomplete');
 await reset();await mutate("update public.expense_requests set steps=jsonb_set(steps,'{1,a}','\"AUTO\"') where id='FICT-MEGA-1'");check('Prior legitimate AUTO step does not substitute the required human cashier approval',(await snap()).exportPurpose==='historical');
 await reset();await mutate("update public.expense_requests set cash_posted_at='2026-09-01T00:00:00Z' where id='FICT-MEGA-1'");await unavailable('Payment cannot precede formal submission','payment_timestamp_invalid');
 await reset();await mutate("update public.expense_requests set cash_posted_at=now()+interval '1 day' where id='FICT-MEGA-1'");await unavailable('Future posting timestamp is not completed payment','payment_timestamp_invalid');
 await reset();await mutate("update public.expense_requests set steps=steps||'[ {\"rk\":\"cashier\",\"a\":\"approved\",\"uid\":\"OTHER\"}]'::jsonb where id='FICT-MEGA-1'");await unavailable('Multiple cash events require separate review','cashier_evidence_missing');
 await reset();await rejected(()=>mutate("update public.expense_requests set bank_fee_amount=null where id='FICT-MEGA-1'"),'23502','Original schema itself rejects missing saved fee');
 await reset();await rejected(()=>mutate("update public.expense_requests set bank_fee_amount=-1 where id='FICT-MEGA-1'"),'23514','Original schema rejects negative bank fee');
 for(const mutation of ["form_payload=form_payload-'cashAmount'","bank_fee_amount=0.5"]){await reset();await mutate('update public.expense_requests set '+mutation+" where id='FICT-MEGA-1'");await unavailable('Missing or invalid saved cash/fee evidence is not guessed','historical_amount_incomplete');}
 await reset();await mutate("update public.expense_requests set amount=301 where id='FICT-MEGA-1'");await unavailable('Changed current amount cannot become original paid principal','historical_amount_mismatch');
 for(const key of ['correctionCashEvents','accountingCorrection']){await reset();await mutate('update public.expense_requests set form_payload=jsonb_set(form_payload,ARRAY[$1],$2::jsonb) where id=$3',[key,key==='correctionCashEvents'?'[{"delta":1}]':'{"status":"applied"}','FICT-MEGA-1']);await unavailable('Nonempty '+key+' requires correction review','accounting_correction_requires_review');}
 await reset();await mutate("insert into private.expense_accounting_corrections_v1 values($1,'production','FICT-MEGA-1','pending_review')",[fixture.tenant]);await unavailable('Authoritative pending correction blocks even without copied payload marker','accounting_correction_requires_review');
 await reset();await mutate("update public.expense_requests set status='pending_ceo',cash_posted_at=null,steps=jsonb_set(jsonb_set(steps,'{1,a}','\"\"'),'{2,a}','\"\"'),form_payload=form_payload-'cashAmount' where id='FICT-MEGA-1'");s=await snap();check('Pre-cashier request returns metadata-only waiting without private recipient data',s.exportPurpose==='waiting'&&!s.eligible&&!s.canSupplement&&!s.request&&!s.supplements);
 adapted=adapter.adapt(s,source);check('Actual waiting SQL response maps to UI without private rows or supplemental editors',adapted.ok&&adapted.exportPurpose==='waiting'&&!adapted.eligible&&!adapted.canSupplement&&adapted.rows.length===0&&adapted.supplementRows.length===0);
 await rejected(()=>save(s.sourceDigest,[{rowKey:'hr:1',name:'不能提前補'}]),'55000','Pre-cashier supplement save cannot bypass stage');
 await reset();await mutate("update public.expense_requests set status='pending_cashier',cash_posted_at=null,steps=jsonb_set(steps,'{2,a}','\"\"'),form_payload=form_payload-'cashAmount',created_at='2026-09-01T00:00:00Z' where id='FICT-MEGA-1'");s=await snap();check('Current pending cashier preserves original v1 eligibility regardless of history cutoff',s.exportPurpose==='payment'&&s.eligible&&s.stage==='pending_cashier');
 s=await save(s.sourceDigest,[{rowKey:'hr:1',name:'虛構現在付款',bankCode:'8121234'}]);check('Pending supplement delegates to unmodified v1 and returns payment purpose',s.exportPurpose==='payment'&&s.supplements[0].name==='虛構現在付款');
 await mutate("update public.expense_requests set steps=jsonb_set(steps,'{1,a}','\"\"') where id='FICT-MEGA-1'");await rejected(()=>snap(),'55000','Pending branch retains all prior-approval checks');
 for(const type of ['purchase_request','advance_request']){
  await reset();const fp={paymentType:'bank',_submissionPayloadSha256V3:'a'.repeat(64),cashAmount:330};if(type==='advance_request')fp.advanceOriginalAmount=300;
  await mutate('update public.expense_requests set type=$1,amount=250,actual_amount=250,estimated_amount=300,form_payload=$2::jsonb where id=$3',[type,JSON.stringify(fp),'FICT-MEGA-1']);s=await snap();check(type+' uses original disbursement rather than lower settlement total',s.exportPurpose==='historical'&&s.historicalPrincipal===300);
  adapted=adapter.adapt(s,source);check(type+' real SQL and browser agree on original paid principal',adapted.eligible&&adapted.issues.length===0&&adapted.rows.length===1&&adapted.rows[0].amount===300&&adapted.expectedTotal===300);
  s=await save(s.sourceDigest,[{rowKey:'payment:1',bankCode:'017'}]);check(type+' private routing supplement keeps original disbursement and saved request unchanged',s.request.amount===250&&s.request.estimated_amount===300&&s.supplements[0].rowKey==='payment:1');
  await mutate("update public.expense_requests set estimated_amount=null,form_payload=form_payload-'advanceOriginalAmount' where id='FICT-MEGA-1'");await unavailable(type+' missing original amount cannot fall back to later actual amount','historical_amount_incomplete');
 }
 await reset();const refund={paymentType:'bank',_submissionPayloadSha256V3:'a'.repeat(64),cashAmount:330,refundInfo:{rows:[{method:'cash',refundAmount:30},{method:'bank',refundAmount:270,accountName:'虛構退款人',accountNo:'00000001234567',bankName:'017 兆豐銀行'}]}};
 await mutate("update public.expense_requests set type='refund_request',form_payload=$1::jsonb where id='FICT-MEGA-1'",[JSON.stringify(refund)]);s=await snap();adapted=adapter.adapt(s,source);
 check('Historical mixed refund SQL/source excludes cash without changing bank row identity or amount',adapted.eligible&&adapted.issues.length===0&&adapted.rows.length===1&&adapted.rows[0].amount===270&&adapted.expectedTotal===270&&adapted.excludedRows.length===1&&source.resolve(s.request,{exportPurpose:s.exportPurpose,submittedAt:s.submittedAt,submissionSource:s.submissionSource,historyCutoff:s.historyCutoff}).sourceRowKeys[0]==='refund:2');
 await rejected(()=>save(s.sourceDigest,[{rowKey:'refund:1',bankCode:'017'}]),'22023','Historical cash refund cannot acquire bank supplements');
 await rejected(()=>save(s.sourceDigest,[{rowKey:'refund:2',name:'另一個人'}]),'22023','Historical original refund payee cannot be overwritten');
 await reset();await actor('employee');await rejected(()=>snap(),'42501','Applicant alone cannot obtain bank identities');
 await actor('ceo');s=await snap();check('CEO historical read remains readonly',s.eligible&&!s.canSupplement);await rejected(()=>save(s.sourceDigest,[{rowKey:'hr:1',name:'不可更名'}]),'42501','CEO cannot edit historical supplemental identity');
 await actor('cashier');check('Original assigned cashier may read historical copy',(await snap()).eligible);await mutate("update public.expense_requests set steps=jsonb_set(steps,'{2,uid}','\"OTHER\"') where id='FICT-MEGA-1'");await rejected(()=>snap(),'42501','Unassigned cashier cannot read historical identities');
 await reset();await actor('hr');check('Same entity HR reader may supplement payroll',(await snap()).canSupplement);await mutate("update public.finance_users set entity_id='FICT-OTHER' where id=$1",[fixture.actor]);await rejected(()=>snap(),'42501','HR cross-entity supplement is forbidden');
 await reset();await rejected(()=>snap('FICT-MEGA-1','test'),'42501','Historical query cannot cross environment');await mutate('update public.expense_requests set tenant_id=$1 where id=$2',[fixture.otherTenant,'FICT-MEGA-1']);await rejected(()=>snap(),'42501','Historical query cannot cross tenant');
 await reset();await mutate('update public.finance_users set active=false where id=$1',[fixture.actor]);await rejected(()=>snap(),'42501','Inactive identity cannot access historical bank data');
 await reset();await rejected(()=>db.query('select private.finance_remittance_export_snapshot_for_row_v1(e) from public.expense_requests e limit 1'),'42501','Internal historical helper cannot bypass scope guard');
 await db.exec('reset role;set role anon');await rejected(()=>snap(),'42501','Anonymous caller cannot execute export RPC');await db.exec('reset role;set role authenticated');
 const definitions=(await db.query("select n.nspname||'.'||p.proname name,md5(pg_get_functiondef(p.oid)) hash from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname like 'finance_mega_%' order by 1")).rows;assert.deepEqual(definitions,originalMegaDefinitions);check('All original Mega function definitions and contracts remain byte-identical',true);
 return {checks:checks.length,labels:[...checks]};
}
module.exports={setup,run,migration,fixture};
if(require.main===module)(async()=>{const instance=new PGlite({extensions:{pgcrypto}});await instance.waitReady;await setup(instance);const result=await run(instance);console.log('PASS '+result.checks+' historical remittance private SQL checks');await instance.close();})().catch(e=>{console.error(e);process.exitCode=1});
