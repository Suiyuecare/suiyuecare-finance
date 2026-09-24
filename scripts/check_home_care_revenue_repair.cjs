#!/usr/bin/env node
'use strict';
// Isolated PostgreSQL only. The real live writer and approval helpers run with
// anonymous fixtures; no production connection or cash posting is performed.
const fs=require('fs'),path=require('path'),assert=require('assert'),vm=require('vm');
const {PGlite}=require('@electric-sql/pglite');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const tenant='00000000-0000-0000-0000-000000000001';
const migrationFile=read('supabase/migrations/20260924074010_finance_e8_g1101_home_care_revenue_repair_v1.sql');
const migration=migrationFile.split('-- FINANCE_REVENUE_REPAIR_CORE_BEGIN')[1].split('-- FINANCE_REVENUE_REPAIR_CORE_END')[0];
const match=read('scripts/check_receipt_atomic_workflow.js').match(/const schema=`([\s\S]*?)`;/);assert(match);
const schema=vm.runInNewContext('`'+match[1]+'`',{tenant});
let count=0;function check(label,value){assert(value,label);count++;}
const ids=['inv_202608_00000000_000272','inv_202608_00000000_000273'];
const cashIds=[['4da7b508-890a-4ff2-b379-11c7fa32bbde','4606249d-d060-4eea-9ed5-8a093a3b59c6'],['ae3b994f-62f5-4a90-b5d7-75eb8fcd7300','04996722-ef85-4d80-8e20-a3387d514ebb']];
const extension=`
alter table public.ledger_entries add column id uuid default gen_random_uuid();
alter table public.invoices add column invoice_item_type text,add column invoice_identifier_type text,add column payer_type text,add column funding_source text,add column description text,add column revenue_rule_id uuid,add column revenue_account_name text,add column revenue_rule_snapshot jsonb,add column posting_locked_at timestamptz,add column revenue_posting_error text;
create table public.revenue_recognition_rules(id uuid primary key default gen_random_uuid(),tenant_id uuid,active boolean,effective_from date,effective_to date,entity_id text,department_code text,department_code_pattern text,invoice_item_type text,payer_type text,funding_source text,invoice_identifier_type text,tax_rate numeric,priority integer,created_at timestamptz default now(),updated_at timestamptz default now(),code text,name text,recognition_basis text,revenue_account_code text,revenue_account_name text,data_environment text,rule_notes text,unique(tenant_id,code));
create function private.finance_require_authenticated_tenant() returns uuid language sql as $$select public.current_tenant_id()$$;
create function public.legacy_invoice_item_type(text,text,text) returns text language sql as $$select 'other'::text$$;
create function private.finance_tenant_account_name(uuid,text) returns text language sql as $$select case when $1=public.current_tenant_id() and $2 in ('1123','1112','2134','4101') then 'Anonymous account' else null end$$;
`;
async function seed(db){
 await db.exec(schema+extension);
 await db.exec(read('scripts/fixtures/finance_invoice_approval_helpers_20260924.sql'));
 await db.exec(read('scripts/fixtures/finance_invoice_revenue_posting_20260908.sql'));
 await db.exec(`insert into public.revenue_recognition_rules(tenant_id,code,name,active,effective_from,priority,department_code_pattern,invoice_item_type,recognition_basis,revenue_account_code,revenue_account_name,data_environment) values('${tenant}','home_care_b1101','Anonymous original rule',true,'2000-01-01',100,'^B1101$','home_care','invoice_issued','4101','Anonymous account','production')`);
 for(let n=0;n<ids.length;n++){
  const i={id:ids[n],no:ids[n].toUpperCase().replaceAll('_','-'),tenant_id:tenant,data_environment:'production',entity_id:'E8',department_code:'G1101',invoice_date:'2026-08-01',invoice_item_type:'home_care',revenue_account_code:'4101',amount:[58365,988147][n],total:[58365,988147][n],tax:0,status:'paid',approval_status:'completed',steps:[{rk:'applicant_submit',a:'approved'},{rk:'accountant_invoice',a:'approved'},{rk:'applicant_invoice_delivery',a:'approved'}],revenue_posted:false,revenue_posted_at:null,revenue_posting_state:'pending_accounting_review',revenue_posting_error:'missing tenant revenue rule',revenue_posting_version:2,revenue_rule_snapshot:{source:'approval_income_category',invoiceItemType:'home_care',revenueAccountCode:'4101'},receipt_files:[{path:'anonymous/proof'}],paid_at:'2026-09-07T00:00:00Z',cash_receipt_posted_at:'2026-09-07T00:00:00Z',row_version:1};
  await db.query('insert into public.invoices select * from jsonb_populate_record(null::public.invoices,$1)',[JSON.stringify(i)]);
  await db.query(`insert into public.ledger_entries(id,entry_date,entity_id,department_code,debit,credit,account_code,reference_no,posting_key,tenant_id,data_environment) values($4,'2026-09-07','E8','G1101',$1,0,'1112',$2,'invoice:'||$2||':receipt:bank',$3,'production'),($5,'2026-09-07','E8','G1101',0,$1,'1123',$2,'invoice:'||$2||':receipt:ar',$3,'production')`,[i.total,i.no,tenant,...cashIds[n]]);
 }
}
async function fingerprint(db){return JSON.stringify((await db.query(`select jsonb_build_object('rules',(select jsonb_agg(to_jsonb(r) order by code) from public.revenue_recognition_rules r),'invoices',(select jsonb_agg(to_jsonb(i) order by id) from public.invoices i),'ledger',(select jsonb_agg(to_jsonb(l) order by posting_key) from public.ledger_entries l)) state`)).rows[0].state);}
async function apply(db){await db.exec('begin');try{await db.exec(migration);await db.exec('commit');}catch(e){await db.exec('rollback');throw e;}}
async function denied(db,label){const before=await fingerprint(db);let error;try{await apply(db);}catch(e){error=e;}check(label+' fails safely',!!error);check(label+' rolls back all invoice, ledger and rule changes',await fingerprint(db)===before);}
async function main(){const db=new PGlite();try{
 await seed(db);const before=await fingerprint(db);
 let priorError;try{await db.query('select private.post_invoice_revenue_v2_internal($1,true)',[ids[0]]);}catch(e){priorError=e;}
 check('Reproduces missing tenant rule with the real revenue writer',priorError&&/收入認列規則/.test(priorError.message));
 check('Failed baseline recognition leaves original cash/source unchanged',await fingerprint(db)===before);
 await db.exec('begin');await db.exec(migration);await db.exec('rollback');
 check('Whole candidate rehearsal is fully reversible',await fingerprint(db)===before);
 const ruleBefore=(await db.query("select to_jsonb(r) v from public.revenue_recognition_rules r where code='home_care_b1101'")).rows[0].v;
 const cashBefore=(await db.query("select jsonb_agg(to_jsonb(l) order by posting_key) v from public.ledger_entries l")).rows[0].v;
  await apply(db);
 await db.exec(read('scripts/finance_revenue_repair_postflight.sql').replace(/^\\set[^\n]*\n/gm,''));
 const canaryResult=await db.exec(read('scripts/finance_revenue_repair_canary.sql'));
 check('Read-only canary confirms exact repair and preserved cash',canaryResult.some(r=>r.rows&&r.rows.some(row=>row.revenue_repair_canary_result?.canary==='readonly_revenue_repair_v1'&&row.revenue_repair_canary_result.cash_preserved)));
 const sums=(await db.query("select count(*) n,sum(debit) dr,sum(credit) cr,sum(credit) filter(where account_code='4101') income from public.ledger_entries where source_type='invoice'")).rows[0];
 check('Exactly four balanced revenue/AR rows add 1,046,512 of August income',Number(sums.n)===4&&Number(sums.dr)===1046512&&Number(sums.cr)===1046512&&Number(sums.income)===1046512);
 check('Revenue booked to August, correct entity and department',(await db.query("select bool_and(entry_date='2026-08-01' and entity_id='E8' and department_code='G1101') ok from public.ledger_entries where source_type='invoice'")).rows[0].ok);
 check('September receipt and cash rows remain byte-for-byte unchanged',JSON.stringify((await db.query("select jsonb_agg(to_jsonb(l) order by posting_key) v from public.ledger_entries l where source_type is null")).rows[0].v)===JSON.stringify(cashBefore));
 check('Taipei home-care rule unchanged',JSON.stringify((await db.query("select to_jsonb(r) v from public.revenue_recognition_rules r where code='home_care_b1101'")).rows[0].v)===JSON.stringify(ruleBefore));
 check('Both source statuses retain paid and proof',(await db.query("select count(*) n from public.invoices where status='paid' and revenue_posted and revenue_posting_state='posted' and jsonb_array_length(receipt_files)=1 and cash_receipt_posted_at='2026-09-07T00:00:00Z'")).rows[0].n===2);
  const posted=await fingerprint(db);await apply(db);check('Retry is idempotent across rules, source versions and ledger',await fingerprint(db)===posted);
 await db.exec("update public.ledger_entries set debit=988146 where id='"+cashIds[1][0]+"'");
 let badCanary;try{await db.exec(read('scripts/finance_revenue_repair_canary.sql'));}catch(e){badCanary=e;await db.exec('rollback');}
 check('Read-only canary rejects changed original cash',!!badCanary);
 }finally{await db.close();}
 for(const [label,sql] of [
  ['Closed August period',"set audit.closed='true'"],
  ['Second invoice amount changed',`update public.invoices set total=988148 where id='${ids[1]}'`],
  ['Second invoice account changed',`update public.invoices set revenue_account_code='4111' where id='${ids[1]}'`],
  ['Second invoice approval missing',`update public.invoices set steps='[{"rk":"applicant_invoice_delivery","a":""}]' where id='${ids[1]}'`],
  ['Negative terminal must never count as approved repair',`update public.invoices set steps='[{"rk":"accountant_invoice","a":"rejected"},{"rk":"applicant_invoice_delivery","a":"approved"}]' where id='${ids[1]}'`],
  ['Second invoice tenant changed',`update public.invoices set tenant_id='00000000-0000-0000-0000-000000000002' where id='${ids[1]}'`],
  ['Second invoice environment changed',`update public.invoices set data_environment='test' where id='${ids[1]}'`],
  ['Second invoice missing',`delete from public.invoices where id='${ids[1]}'`],
  ['Source accounting selection absent',`update public.invoices set revenue_rule_snapshot='{}' where id='${ids[1]}'`],
  ['Conflicting partial revenue exists',`insert into public.ledger_entries(tenant_id,data_environment,source_type,source_id,reference_no,posting_key,account_code,debit,credit) values('${tenant}','production','invoice','${ids[1]}','INV-202608-00000000-000273','tenant:${tenant}:invoice:INV-202608-00000000-000273:revenue:v2:ar','1123',988147,0)`],
  ['Wrong competing home-care rule',`insert into public.revenue_recognition_rules(tenant_id,code,active,effective_from,priority,entity_id,department_code,invoice_item_type,recognition_basis,revenue_account_code,data_environment) values('${tenant}','wrong-competing-rule',true,'2000-01-01',1,'E8','G1101','home_care','invoice_issued','4101','production')`],
  ['Existing same-name rule is overbroad',`insert into public.revenue_recognition_rules(tenant_id,code,active,effective_from,priority,invoice_item_type,recognition_basis,revenue_account_code,data_environment) values('${tenant}','home_care_e8_g1101',true,'2000-01-01',100,'home_care','invoice_issued','4101','production')`],
  ['Unbound legacy revenue already exists',`insert into public.ledger_entries(tenant_id,data_environment,reference_no,posting_key,account_code,debit,credit) values('${tenant}','production','INV-202608-00000000-000273','legacy:already-revenue','4101',0,988147)`],
  ['Unbound extra receivable already exists',`insert into public.ledger_entries(tenant_id,data_environment,reference_no,posting_key,account_code,debit,credit) values('${tenant}','production','INV-202608-00000000-000273','legacy:already-ar','1123',988147,0)`],
  ['Existing cash amount changed',`update public.ledger_entries set debit=988146 where id='${cashIds[1][0]}'`],
  ['Existing cash date changed',`update public.ledger_entries set entry_date='2026-09-08' where id='${cashIds[1][0]}'`],
  ['Late trigger changes receipt proof',`create function private.fixture_bad_receipt() returns trigger language plpgsql as $$begin if new.id='${ids[1]}' and new.revenue_posted then new.receipt_files:='[]';end if;return new;end;$$;create trigger bad_receipt before update on public.invoices for each row execute function private.fixture_bad_receipt()`]
 ]){const db=new PGlite();try{await seed(db);await db.exec(sql);await denied(db,label);}finally{await db.close();}}
 console.log(`PASS: ${count} exact-source home-care revenue repair checks with the live PostgreSQL writer`);
}
module.exports={seed,fingerprint,ids,cashIds};
if(require.main===module)main().catch(e=>{console.error({message:e.message,code:e.code,where:e.where,stack:e.code?undefined:e.stack});process.exitCode=1;});
