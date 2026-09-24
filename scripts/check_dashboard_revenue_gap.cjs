'use strict';
// Execute the real scoped dashboard and migration detector against fictional
// invoices. No production connection, identity, or monetary writes are used.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
const {createDashboardScopeFixture}=require('./check_dashboard_scope_integrity.cjs');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const migration=read('supabase/migrations/20260924074010_finance_e8_g1101_home_care_revenue_repair_v1.sql');
const detector=migration.slice(migration.indexOf('do $income_detector$'));
const signature='public.finance_executive_dashboard_v2(date,date,date,date,date,text,text)';
async function createRevenueGapFixture(db){
 const f=await createDashboardScopeFixture(db);
 await f.admin(db,'create schema finance_hr_private');
 // Install the production HR hook and its real test-environment behavior.
 const hr=read('supabase/migrations/20260922075604_finance_hr_voucher_posting_v1.sql');
 const begin=hr.indexOf('create function finance_hr_private.finance_hr_accounting_scope(');
 await db.exec(hr.slice(begin,hr.indexOf('end $$;',begin)+7));
 const def=(await db.query('select pg_get_functiondef($1::regprocedure) definition',[signature])).rows[0].definition;
 const hook="  perform finance_hr_private.finance_hr_accounting_scope((public.current_finance_user()).tenant_id,nullif(nullif(btrim(p_entity_id),''),'all'),p_data_environment);\n";
 await db.exec(def.replace('begin\n','begin\n'+hook+'\n'));
 assert.equal((await db.query('select md5(prosrc) hash from pg_proc where oid=$1::regprocedure',[signature])).rows[0].hash,'7734154b2b22e212c5dc0774cd4f7a06');
 return f;
}
async function run(){const db=new PGlite();let checks=0;const check=(name,value)=>{assert.ok(value,name);checks++;console.log('PASS '+name);};try{
 const f=await createRevenueGapFixture(db);
 await f.make(db,'CASH-ONLY',100,{invoice_date:'2026-09-02',approval_status:'completed',revenue_posted:false});
 await f.admin(db,`insert into public.ledger_entries(tenant_id,data_environment,entry_date,entity_id,department_code,account_code,debit,credit,reference_no,posting_key) values
 ('${f.tenant}','test','2026-09-05','FICT-CO','FICT-D','1112',100,0,'CASH-ONLY','cash:bank'),
 ('${f.tenant}','test','2026-09-05','FICT-CO','FICT-D','1123',0,100,'CASH-ONLY','cash:ar');`);
 let result=await f.dashboard();
 check('reproduce cash-only entry masking missing income',result.reconciliation.revenue.eligibleNoLedgerCount===0&&result.summary.revenue===0);
 const before=await f.fingerprint(db);
 await f.admin(db,'begin;'+detector+'\nrollback;');
 check('detector rehearsal rolls back function source',(await db.query('select md5(prosrc) hash from pg_proc where oid=$1::regprocedure',[signature])).rows[0].hash==='7734154b2b22e212c5dc0774cd4f7a06');
 await db.exec('begin;'+detector+'\ncommit;');
 result=await f.dashboard();
 check('cash-only completed invoice remains visible as missing revenue',result.reconciliation.revenue.eligibleNoLedgerCount===1&&Number(result.reconciliation.revenue.eligibleNoLedgerAmount)===100);
 check('missing revenue is not silently added to income',Number(result.summary.revenue)===0);
 check('detector preserves all financial facts',await f.fingerprint(db)===before);
 await f.admin(db,'begin;'+detector+'\ncommit;');
 check('detector can be reapplied safely',(await db.query('select md5(prosrc) hash from pg_proc where oid=$1::regprocedure',[signature])).rows[0].hash==='cec3d2e9b694c30e189aca9b1f2431a0');
 await f.make(db,'RECOGNIZED',200,{invoice_date:'2026-09-02',approval_status:'delivered'});
 await f.make(db,'PENDING',300,{invoice_date:'2026-09-02',approval_status:'pending_invoice_delivery',revenue_posted:false});
 await f.make(db,'FOREIGN',900,{invoice_date:'2026-09-02',approval_status:'completed',revenue_posted:false,tenant_id:f.other});
 result=await f.dashboard();
 check('posted revenue is counted once without hiding cash-only gap',Number(result.summary.revenue)===200&&result.reconciliation.revenue.eligibleNoLedgerCount===1);
 check('unfinished workflows remain separate from posting failures',result.reconciliation.revenue.pendingCount===1&&Number(result.reconciliation.revenue.pendingNetAmount)===300);
 check('foreign tenant cannot inflate income or missing count',Number(result.reconciliation.revenue.formNetAmount)===600);
 let error;try{await f.dashboard({actor:'employee'});}catch(e){error=e;}
 check('existing role denial survives detector change',error&&error.code==='42501');
 await f.admin(db,'select 1');
 check('anonymous execution remains revoked',!(await db.query('select has_function_privilege(\'anon\',$1::regprocedure,\'EXECUTE\') allowed',[signature])).rows[0].allowed);
 await db.exec('begin;');
 const def=(await db.query('select pg_get_functiondef($1::regprocedure) definition',[signature])).rows[0].definition;
 await db.exec(def.replace('declare\n','declare\n  -- unreviewed drift\n'));
 await assert.rejects(db.exec(detector),/predecessor changed/);await db.exec('rollback;');
 check('unreviewed function drift is refused',true);
 console.log('OK: '+checks+' revenue gap checks');
 }finally{await db.close();}}
module.exports={createRevenueGapFixture,detector};
if(require.main===module)run().catch(e=>{console.error(e);process.exitCode=1});
