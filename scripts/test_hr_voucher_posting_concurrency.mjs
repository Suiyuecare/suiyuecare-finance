// Real concurrent sessions against an isolated loopback-only disposable database.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {Client} from 'pg';
const host=process.env.FINANCE_HR_TEST_PG_HOST??'127.0.0.1';if(!['127.0.0.1','localhost','::1'].includes(host))throw Error('loopback required');
const config={host,port:Number(process.env.FINANCE_HR_TEST_PG_PORT??55439),user:process.env.FINANCE_HR_TEST_PG_USER??'hr_test',database:'postgres'};
const name='finance_hr_post_'+randomUUID().replaceAll('-',''),admin=new Client(config);await admin.connect();let a,b,c;
try{
await admin.query(`create database ${name}`);[a,b,c]=[1,2,3].map(()=>new Client({...config,database:name}));await Promise.all([a.connect(),b.connect(),c.connect()]);
const source=await fs.readFile(new URL('./test_hr_voucher_posting.mjs',import.meta.url),'utf8');await a.query(source.match(/await db.exec\(`(create role anon;[\s\S]*?)`\);/)[1].replace(/create role (anon|authenticated|service_role);/g,''));
for(const f of JSON.parse(await fs.readFile(new URL('./fixtures/finance_hr_voucher_baseline_20260922.json',import.meta.url),'utf8')))await a.query(f.definition);
for(const file of ['20260922072109_finance_hr_private_bridge_v1.sql','20260922075604_finance_hr_voucher_posting_v1.sql'])await a.query(await fs.readFile(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));
await a.query('grant select,insert on public.ledger_entries to authenticated');
const tenant=randomUUID(),employer=randomUUID(),applicant=randomUUID(),actor=randomUUID(),obligation=randomUUID();
await a.query("insert into public.finance_users values('accountant',$1,$2,'Synthetic',true,'accountant')",[tenant,actor]);await a.query("insert into public.system_settings values($1,'accounts','[{\"c\":\"2134\",\"n\":\"應付薪資\"},{\"c\":\"1112\",\"n\":\"銀行存款\"}]')",[tenant]);
await a.query("insert into finance_hr_private.finance_hr_salary_readers(tenant_id,source_employer_id,finance_user_id,business_role,verified_at,verified_by,evidence_reference,effective_from) values($1,$2,'accountant','accounting',now(),'fixture','SYNTHETIC',now())",[tenant,employer]);
await a.query("insert into finance_hr_private.finance_hr_routes(tenant_id,source_employer_id,source_applicant_id,legal_entity_code,version,bank_actor,account_actor,cashier_actor,voucher_actor,verified_at,verified_by,evidence_reference,effective_from,active) values($1,$2,$3,'E1',1,'accountant','accountant','accountant','accountant',now(),'fixture','SYNTHETIC',now(),true)",[tenant,employer,applicant]);
const data={totalNetCents:10000,lines:[{employeeId:randomUUID(),kind:'addition',amountCents:10000}]};const hash=(await a.query('select finance_hr_private.finance_hr_hash($1) h',[data])).rows[0].h;
await a.query('set role service_role');await a.query('select public.finance_hr_intake($1,$2)',[randomUUID(),{schemaVersion:1,obligationId:obligation,flowId:obligation,sourceEmployerId:employer,originalApplicantId:applicant,revision:1,sourceHash:hash,source:data,payDate:'2026-10-15',period:'2026-09',kind:'monthly',amountMeaning:'calculated_net'}]);
await a.query("reset role;set role authenticated");await a.query("select set_config('request.jwt.claim.sub',$1,false)",[actor]);
const ev=kind=>({kind,reference:'SYNTHETIC',sha256:'a'.repeat(64),...(['bank_batch_validation','bank_upload','bank_disbursement'].includes(kind)?{totalNetCents:10000}:{})});
for(const [version,action] of [[1,'bank_batch_validation'],[2,'bank_upload'],[3,'accounting_review'],[4,'bank_disbursement']])await a.query('select public.finance_hr_command($1,$2,$3,$4,$5)',[obligation,version,randomUUID(),action,ev(action)]);
await a.query('reset role;set role service_role');await a.query('select public.finance_hr_applicant_confirm($1,5,$2,$3,$4,$5)',[obligation,randomUUID(),applicant,hash,ev('applicant_confirmation')]);await a.query('reset role');
const request=randomUUID(),entries=[{t:'dr',ac:'2134',amt:100},{t:'cr',ac:'1112',amt:100}];
async function start(client){await client.query('begin;set local role authenticated');await client.query("select set_config('request.jwt.claim.sub',$1,true)",[actor]);}
const post=(client,id)=>client.query("select public.finance_hr_post_voucher($1,6,$2,'2026-10-15',$3,$4) r",[obligation,id,JSON.stringify(entries),ev('posted_voucher')]);
await start(a);await start(b);await start(c);const first=(await post(a,request)).rows[0].r;
const duplicate=post(b,request);const competing=post(c,randomUUID()).then(()=>({ok:true}),e=>({code:e.code}));
let locked=false;for(let i=0;!locked&&i<100;i++)locked=(await admin.query("select count(*)>=2 x from pg_stat_activity where datname=$1 and wait_event_type='Lock'",[name])).rows[0].x;assert.equal(locked,true,'both duplicate and competing post are genuinely blocked');
// Even inside the same transaction, the posting capability cannot add arbitrary ledger rows.
await a.query('savepoint extra');await assert.rejects(()=>a.query("insert into public.ledger_entries(entry_date,description,entity_id,department_code,debit,credit,account_code,account_name,reference_no,posting_key,source_type,source_id,source_no,voucher_no,data_environment,tenant_id) select entry_date,description,entity_id,department_code,debit,credit,account_code,account_name,reference_no,posting_key||':extra',source_type,source_id,source_no,voucher_no,data_environment,tenant_id from public.ledger_entries where voucher_no=$1 limit 1",[first.voucherId]),/ATOMIC_POSTING_REQUIRED/);await a.query('rollback to savepoint extra');
await a.query('commit');assert.equal((await duplicate).rows[0].r.replayed,true);await b.query('commit');assert.equal((await competing).code,'40001');await c.query('rollback');
assert.equal((await c.query('select count(*)::int n from public.vouchers')).rows[0].n,1);assert.equal((await c.query('select count(*)::int n from public.ledger_entries')).rows[0].n,2);assert.equal((await c.query('select count(*)::int n from finance_hr_private.finance_hr_callback_outbox where finance_version=7')).rows[0].n,1);
console.log(JSON.stringify({ok:true,postgres:(await c.query('show server_version')).rows[0].server_version,sameRequestReplay:true,competingRequestCas:true,oneVoucher:true,twoLedgerRows:true,oneClosingCallback:true}));
}finally{await Promise.allSettled([a,b,c].filter(Boolean).map(async x=>{await x.query('rollback').catch(()=>{});await x.end()}));await admin.query(`drop database if exists ${name}`);await admin.end()}
