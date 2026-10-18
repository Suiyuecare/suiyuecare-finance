#!/usr/bin/env node
'use strict';
// Actual Finance identity/read helpers and the new SQL; synthetic data only.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite'),{pgcrypto}=require('@electric-sql/pglite/contrib/pgcrypto');
const fixture=require('./fixtures/finance_invoice_batch_fixture_20261014.cjs');
const extra=require('./fixtures/finance_bill_approval_live_catalog_20261015.json');
const migration=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261018074245_finance_mega_remittance_private_v1.sql'),'utf8');
let db;const checks=[];
const check=(name,condition)=>{assert(condition,name);checks.push(name);};
async function reject(fn,code,label){await assert.rejects(fn,e=>e.code===code,label);checks.push(label);}
async function admin(sql,values=[]){await db.exec('reset role');const result=await db.query(sql,values);await db.exec('set role authenticated');return result;}
async function mutate(sql,values=[]){await db.exec('reset role;set session_replication_role=replica');await db.query(sql,values);await db.exec('set session_replication_role=origin;set role authenticated');}
async function snap(id='FICT-MEGA-1',env='production'){return(await db.query('select public.finance_mega_remittance_snapshot_v1($1,$2) result',[id,env])).rows[0].result;}
async function save(digest,rows,id='FICT-MEGA-1'){return(await db.query('select public.finance_mega_remittance_supplement_save_v1($1,$2,$3,$4::jsonb) result',[id,'production',digest,JSON.stringify(rows)])).rows[0].result;}
async function role(role){await mutate('update public.finance_users set role=$1,entity_id=$2 where id=$3',[role,'FICT-E1',fixture.actor]);await mutate('update public.tenant_members set role=$1 where finance_user_id=$2',[role,fixture.actor]);}
const cashSteps=[{rk:'ceo',uid:'FICT-CEO',a:'approved'},{rk:'cashier',uid:fixture.actor,a:''}];
const hrRows=[{'銀行代號':'812','銀行帳號':'00012345678901','金額':100},{'銀行代號':'017','銀行帳號':'00012345678902','金額':200}];
async function setup(database,{installMigration=true}={}){db=database;
 await fixture.setup(db);for(const fn of extra.functions.filter(f=>/^finance_income_(active_step_index|step_role|step_user_id)$/.test(f.name)))await db.exec(fn.definition);
 if(installMigration)await db.exec(migration);await db.exec('set session_replication_role=replica');
 await db.query("insert into public.expense_requests(id,no,tenant_id,entity_id,department_code,applicant_id,type,status,step,ver,amount,payee,bank_name,bank_no,bank_type,steps,form_payload) values($1,$1,$2,'FICT-E1','FICT-D1',$3,'hr_expense_request','pending_cashier',1,3,300,'','','','mega',$4::jsonb,$5::jsonb)",['FICT-MEGA-1',fixture.tenant,fixture.actor,JSON.stringify(cashSteps),JSON.stringify({paymentType:'bank',hrItem:'salary_50',hrInfo:{rows:hrRows,paymentTotal:300}})]);
 await db.query("insert into public.expense_requests(id,no,tenant_id,entity_id,department_code,applicant_id,type,status,step,ver,amount,payee,bank_name,bank_no,bank_type,steps,form_payload) values($1,$1,$2,'FICT-E1','FICT-D1',$3,'payment_request','pending_cashier',1,2,100,'虛構廠商','017 兆豐銀行','00098765432100','mega',$4::jsonb,$5::jsonb)",['FICT-MEGA-PAY',fixture.tenant,fixture.actor,JSON.stringify(cashSteps),JSON.stringify({paymentType:'bank'})]);
 await db.exec('set session_replication_role=origin;set role authenticated');return {fixture,sourceHelpers:3};}
async function run(database){db=database;checks.length=0;await role('accountant');
 let s=await snap();check('Verified accountant can read saved eligible source',s.ok&&s.canSupplement&&s.sourceVersion===3&&s.request.amount===300&&s.supplements.length===0&&/^[0-9a-f]{64}$/.test(s.sourceDigest));
 const originalPayload=JSON.stringify(s.request.form_payload),digest=s.sourceDigest;
 s=await save(digest,[{rowKey:'hr:1',name:'虛構收款甲',bankCode:'8121234'},{rowKey:'hr:2',name:'虛構收款乙',bankCode:'017'}]);
 check('Private names and bank branch are returned separately',s.supplements.length===2&&s.supplements[0].name==='虛構收款甲'&&s.supplements[0].bankCode==='8121234');
 check('Approved payload/account/amount are unchanged',JSON.stringify(s.request.form_payload)===originalPayload&&s.request.amount===300&&s.sourceVersion===3);
 check('Supplement change updates opaque digest',s.sourceDigest!==digest);
 await reject(()=>save(digest,[{rowKey:'hr:1',name:'舊畫面覆寫'}]),'40001','Concurrent stale save rejects without overwriting');
 await reject(()=>save(s.sourceDigest,[{rowKey:'hr:1',bankCode:'0041234'}]),'22023','Original bank prefix cannot change');
 await reject(()=>save(s.sourceDigest,[{rowKey:'hr:1',account:'999',amount:1}]),'22023','Approved account and amount cannot be sent as supplemental edits');
 await reject(()=>save(s.sourceDigest,[{rowKey:'hr:1',bankCode:8121234}]),'22023','Bank code must remain text');
 await reject(()=>save(s.sourceDigest,[{rowKey:'hr:99',name:'虛構錯列'}]),'22023','No new recipient row can be appended');
 await reject(()=>save(s.sourceDigest,[{rowKey:'hr:1',name:'虛構甲'},{rowKey:'hr:1',name:'虛構乙'}]),'22023','Duplicate row keys reject entire save');
 let before=(await admin('select count(*)::int n from private.finance_mega_recipient_events_v1')).rows[0].n;
 await reject(()=>save(s.sourceDigest,[{rowKey:'hr:1',name:'暫時值'},{rowKey:'hr:2',bankCode:'0041234'}]),'22023','Mixed valid/invalid supplements roll back as one transaction');
 check('Failed batch leaves values and events unchanged',(await snap()).sourceDigest===s.sourceDigest&&(await admin('select count(*)::int n from private.finance_mega_recipient_events_v1')).rows[0].n===before);
 await reject(()=>db.query('select * from private.finance_mega_recipient_supplements_v1'),'42501','Authenticated cannot read private table directly');
 await reject(()=>db.query('select private.finance_mega_snapshot_v1(e) from public.expense_requests e limit 1'),'42501','Authenticated cannot bypass guard via internal snapshot helper');
 await role('employee');await reject(()=>snap(),'42501','Original applicant without bank role cannot read supplemental identities');
 await role('ceo');s=await snap();check('CEO can read but cannot change bank-only identities',s.ok&&!s.canSupplement);await reject(()=>save(s.sourceDigest,[{rowKey:'hr:1',name:'虛構更名'}]),'42501','CEO supplemental save denied');
 await role('cashier');s=await snap();check('Current assigned cashier can read',s.ok&&!s.canSupplement);
 await mutate("update public.expense_requests set steps=jsonb_set(steps,'{1,uid}','\"FICT-OTHER-CASHIER\"') where id='FICT-MEGA-1'");await reject(()=>snap(),'42501','Other cashier cannot read file identities');
 await role('accountant');await mutate('update public.expense_requests set steps=$1::jsonb where id=$2',[JSON.stringify(cashSteps),'FICT-MEGA-1']);
 s=await snap();check('Exact unchanged source still has its matching supplemental mapping',s.supplements.length===2); // restoring the exact saved source restores the matching mapping
 await mutate("update public.expense_requests set form_payload=jsonb_set(form_payload,'{hrInfo,rows,0,銀行帳號}','\"00000000000099\"'),ver=ver+1 where id='FICT-MEGA-1'");
 s=await snap();check('Changed approved account cannot inherit old recipient name',s.supplements.length===0&&s.sourceVersion===4);
 await mutate("update public.expense_requests set form_payload=jsonb_set(form_payload,'{hrInfo,rows,0,銀行代號}','812') where id='FICT-MEGA-1'");s=await snap();await reject(()=>save(s.sourceDigest,[{rowKey:'hr:1',bankCode:'8121234'}]),'22023','Numeric source bank code cannot silently become text');
 await mutate("update public.expense_requests set form_payload=jsonb_set(form_payload,'{hrInfo,rows,0,銀行代號}','\"812\"') where id='FICT-MEGA-1'");s=await snap();
 const newDigest=s.sourceDigest;await save(newDigest,[{rowKey:'hr:1',name:'虛構新戶名',bankCode:'8121234'}]);
 await mutate("update public.expense_requests set amount=301,ver=ver+1 where id='FICT-MEGA-1'");check('Amount/version change invalidates supplements',(await snap()).supplements.length===0);
 await mutate("update public.expense_requests set status='pending_ceo' where id='FICT-MEGA-1'");await reject(()=>snap(),'55000','Cannot generate before cashier stage');
 await mutate("update public.expense_requests set status='pending_cashier',cash_posted_at=now() where id='FICT-MEGA-1'");await reject(()=>snap(),'55000','Already paid source cannot be exported again');
 await mutate("update public.expense_requests set cash_posted_at=null,steps=jsonb_set(steps,'{0,a}','\"\"') where id='FICT-MEGA-1'");await reject(()=>snap(),'55000','Previous approval remains pending blocks file readiness');
 await mutate('update public.expense_requests set steps=$1::jsonb where id=$2',[JSON.stringify(cashSteps),'FICT-MEGA-1']);
 await reject(()=>snap('FICT-MEGA-1','test'),'42501','Cross environment request is rejected');
 await mutate('update public.expense_requests set tenant_id=$1 where id=$2',[fixture.otherTenant,'FICT-MEGA-1']);await reject(()=>snap(),'42501','Cross tenant request is rejected');
 await mutate('update public.expense_requests set tenant_id=$1 where id=$2',[fixture.tenant,'FICT-MEGA-1']);
 await role('hr');check('Explicit authorized HR reader in same entity can supplement',(await snap()).canSupplement);
 await mutate("update public.finance_users set entity_id='FICT-OTHER' where id=$1",[fixture.actor]);await reject(()=>snap(),'42501','HR outside entity scope is denied');
 await role('accountant');s=await snap('FICT-MEGA-PAY');await reject(()=>save(s.sourceDigest,[{rowKey:'payment:1',name:'另一人'}],'FICT-MEGA-PAY'),'22023','Already approved payee name cannot change');
 await reject(()=>save(s.sourceDigest,[{rowKey:'payment:1',bankCode:'004'}],'FICT-MEGA-PAY'),'22023','Explicit bank label constrains supplementary code');
 await mutate("update public.expense_requests set bank_name='非兆豐銀行',bank_type='other' where id='FICT-MEGA-PAY'");s=await snap('FICT-MEGA-PAY');
 await reject(()=>save(s.sourceDigest,[{rowKey:'payment:1',bankCode:'017'}],'FICT-MEGA-PAY'),'22023','Negative Mega bank label never becomes Mega bank code');
 s=await save(s.sourceDigest,[{rowKey:'payment:1',bankCode:'812'}],'FICT-MEGA-PAY');check('Negative bank label permits explicit matching other-bank code',s.supplements[0].bankCode==='812');
 await mutate("update public.expense_requests set bank_name='非台灣銀行',bank_type='other' where id='FICT-MEGA-PAY'");s=await snap('FICT-MEGA-PAY');s=await save(s.sourceDigest,[{rowKey:'payment:1',bankCode:'812'}],'FICT-MEGA-PAY');check('Negative name is not guessed from a substring',s.supplements[0].bankCode==='812');
 await mutate("update public.expense_requests set bank_name='812 台新銀行',bank_type='mega' where id='FICT-MEGA-PAY'");s=await snap('FICT-MEGA-PAY');await reject(()=>save(s.sourceDigest,[{rowKey:'payment:1',bankCode:'812'}],'FICT-MEGA-PAY'),'22023','Explicit other-bank code and Mega type conflict blocks supplemental override');
 await mutate("update public.expense_requests set bank_name='017 兆豐',bank_type='other' where id='FICT-MEGA-PAY'");s=await snap('FICT-MEGA-PAY');await reject(()=>save(s.sourceDigest,[{rowKey:'payment:1',bankCode:'017'}],'FICT-MEGA-PAY'),'22023','Explicit Mega code and other-bank type conflict is rejected');
 await mutate("update public.expense_requests set voucher_id='FICT-VOUCHER' where id='FICT-MEGA-PAY'");await reject(()=>snap('FICT-MEGA-PAY'),'55000','Existing voucher link prevents re-export');
 await mutate("update public.expense_requests set voucher_id=null,type='unknown_request' where id='FICT-MEGA-PAY'");await reject(()=>snap('FICT-MEGA-PAY'),'55000','Unknown transaction type cannot create a bank file');
 await mutate("update public.expense_requests set type='payment_request',bank_name='017 兆豐',bank_type='mega',steps=jsonb_set(steps,'{0,a}','\"rejected\"') where id='FICT-MEGA-PAY'");await reject(()=>snap('FICT-MEGA-PAY'),'55000','Rejected prior approval blocks preparation despite stale cashier status');
 await mutate('update public.expense_requests set steps=$1::jsonb where id=$2',[JSON.stringify(cashSteps),'FICT-MEGA-PAY']);
 for(const flag of [{electronicLabor:true},{hrInfo:{digital:true}},{hrItem:'labor_electronic'}]){await mutate('update public.expense_requests set form_payload=$1::jsonb where id=$2',[JSON.stringify({paymentType:'bank',...flag}),'FICT-MEGA-PAY']);await reject(()=>snap('FICT-MEGA-PAY'),'55000','Electronic labor markers stay on separate payment flow '+Object.keys(flag)[0]);}
 await mutate("update public.expense_requests set form_payload='{}' where id='FICT-MEGA-PAY'");await reject(()=>snap('FICT-MEGA-PAY'),'55000','Missing payment method cannot be assumed to be bank transfer');
 await mutate("update public.expense_requests set form_payload='{\"paymentType\":\"cash\"}' where id='FICT-MEGA-PAY'");await reject(()=>snap('FICT-MEGA-PAY'),'55000','Cash transaction cannot produce transfer file');
 await mutate("update public.finance_users set active=false where id=$1",[fixture.actor]);await reject(()=>snap(),'42501','Revoked employee authorization is rechecked');
 await mutate("update public.finance_users set active=true where id=$1",[fixture.actor]);
 await db.exec('reset role;set role anon');await reject(()=>snap(),'42501','Anonymous users cannot call bank-file RPC');
 await db.exec('reset role;set role service_role');await reject(()=>snap(),'42501','Transport service cannot bypass bank-file caller identity');
 await db.exec('reset role');
 await reject(()=>db.query('delete from private.finance_mega_recipient_events_v1'),'55000','Supplement change audit cannot be deleted');
 const rls=(await db.query("select relrowsecurity,relforcerowsecurity from pg_class where oid='private.finance_mega_recipient_supplements_v1'::regclass")).rows[0];check('Private supplement table forces RLS',rls.relrowsecurity&&rls.relforcerowsecurity);
 return {checks:checks.length,passed:checks.slice(),productionDataUsed:false,bankTransferExecuted:false};
}
module.exports={setup,run,migration,fixture};
if(require.main===module)(async()=>{const database=new PGlite({extensions:{pgcrypto}});try{await setup(database);console.log(JSON.stringify(await run(database),null,2));}finally{await database.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
