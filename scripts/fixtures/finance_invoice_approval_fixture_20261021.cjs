'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const base=require('./finance_invoice_batch_fixture_20261014.cjs');
const bill=require('./finance_bill_approval_fixture_20261015.cjs');
const extra=require('./finance_invoice_approval_live_catalog_20261021.json');
const root=path.join(__dirname,'../..');
async function setup(db){
 const metadata=await bill.setup(db);
 // Install already released fixes; all existing invoice row triggers stay enabled.
 await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20261014123427_finance_invoice_batch_bulk_insert_v2.sql'),'utf8'));
 await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20261015060930_finance_bill_approval_bulk_v1.sql'),'utf8'));
 for(const fn of extra.functions){
  await db.exec(fn.definition);
  await db.exec('revoke all on function '+fn.signature+' from public,anon,authenticated,service_role');
  for(const grant of fn.acl)await db.exec('grant execute on function '+fn.signature+' to '+grant.grantee);
  assert.equal((await db.query('select md5(prosrc) hash from pg_proc where oid=$1::regprocedure',[fn.signature])).rows[0].hash,fn.source_md5);
 }
 await db.exec("create trigger fixture_invoice_statement after update on public.invoices for each statement execute function private.fixture_trigger_counter('invoice_statement'); create trigger fixture_notification_update after update on public.notification_delivery_events for each row execute function private.fixture_trigger_counter('notification_update'); set statement_timeout='8s'; set jit=off");
 return {...metadata,invoiceApprovalFunctions:extra.functions.length,networkSubstitution:'private.finance_wake_notification_worker only'};
}
async function approver(db){return base.identity(db,{user:bill.approverUid,session:bill.approverSid});}
async function seed(db,n,key,{dense=false}={}){
 await base.identity(db);
 const items=Array.from({length:n},(_,i)=>({...base.item(i),description:'虛構發票簽核容量測試 '+i,steps:[
  ...base.item(i).steps.map(s=>({...s,...(dense?{c:'虛構既有核對紀錄與來源憑據備註。'.repeat(45)}:{})})),
  {rk:'accountant',uid:bill.next,a:'',r:'會計',status:'pending_accountant'},
  ...(dense?Array.from({length:5},(_,j)=>({rk:'assigned_user',uid:bill.next,a:'',r:'後續核對 '+j,status:'pending_countersign',c:'虛構簽核紀錄及附件資訊。'.repeat(45)})):[])
 ]}));
 const batch=await base.submit(db,key,items);await approver(db);return batch;
}
async function expected(db,ids){
 const rows=(await db.query('select id,row_version,approval_status,steps,private.finance_income_active_step_index(steps) i from public.invoices where id=any($1::text[])',[ids])).rows;
 return Object.fromEntries(rows.map(r=>{const s=r.steps[r.i];return [r.id,{row_version:Number(r.row_version),active_step_index:r.i,role_key:s.rk,finance_user_id:s.uid,email:s.email||'',approval_status:r.approval_status}];}));
}
async function act(db,batch,key,action='approve',options={}){
 const ids=options.ids||batch.rows.map(r=>r.id),exp=options.expected||await expected(db,ids);
 return (await db.query('select public.finance_invoice_act_active_step_v2($1::text[],$2,$3,$4,$5::jsonb,$6,$7::jsonb,$8::jsonb,$9) result',[
  ids,action,key,options.comment===undefined?'虛構核對完成':options.comment,JSON.stringify(options.files||[]),options.addSign||null,JSON.stringify(exp),JSON.stringify(options.patches||{}),options.environment||'production'
 ])).rows[0].result;
}
module.exports={setup,seed,expected,act,approver,base,bill,extra};
