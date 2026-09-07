#!/usr/bin/env node
'use strict';
// Anonymous PostgreSQL fixtures + the UNMODIFIED live revenue writer captured
// on 2026-09-08. Test the original-period failure and full receipt transaction;
// never connect to production or post an operational document.
const fs=require('fs'),path=require('path'),assert=require('assert'),vm=require('vm');
const {PGlite}=require('@electric-sql/pglite');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const tenant='00000000-0000-0000-0000-000000000001',auth={accountant:'00000000-0000-0000-0000-000000000011',ceo:'00000000-0000-0000-0000-000000000012'};
const schemaMatch=read('scripts/check_receipt_atomic_workflow.js').match(/const schema=`([\s\S]*?)`;/);assert(schemaMatch);
const schema=vm.runInNewContext('`'+schemaMatch[1]+'`',{tenant});
const correction=read('supabase/migrations/20260907154742_expense_accounting_correction_workflow_v1.sql');
function helper(name){const start=correction.indexOf('create function private.'+name+'(');assert(start>=0);return correction.slice(start,correction.indexOf('$function$;',start)+11);}
const extensions=`
alter table public.invoices add column invoice_item_type text,add column invoice_identifier_type text,add column payer_type text,add column funding_source text,add column description text,add column revenue_rule_id uuid,add column revenue_account_name text,add column revenue_rule_snapshot jsonb,add column posting_locked_at timestamptz,add column revenue_posting_error text;
create table public.revenue_recognition_rules(id uuid,tenant_id uuid,active boolean,effective_from date,effective_to date,entity_id text,department_code text,department_code_pattern text,invoice_item_type text,payer_type text,funding_source text,invoice_identifier_type text,tax_rate numeric,priority integer,created_at timestamptz,code text,name text,recognition_basis text,revenue_account_code text);
create table private.fixture_period_checks(invoice_date date,action text);
create function private.finance_require_authenticated_tenant() returns uuid language plpgsql as $$begin if auth.uid() is null then raise exception 'missing actor' using errcode='42501';end if;return public.current_tenant_id();end;$$;
create function public.legacy_invoice_item_type(text,text,text) returns text language sql as $$select 'other'::text$$;
create function private.finance_tenant_account_name(uuid,text) returns text language sql as $$select case when $1=public.current_tenant_id() and $2 in ('1123','1112','2134','4111') then 'Anonymous account' else null end$$;
create function private.finance_invoice_fully_approved(jsonb) returns boolean language sql as $$select jsonb_array_length($1)>0 and not exists(select 1 from jsonb_array_elements($1) s where coalesce(s->>'a','')<>'approved')$$;
-- Fail prior periods while allowing this month's cash. This preserves the
-- real helper's call order and exposes the exact compatibility defect.
create or replace function private.finance_assert_period_open(uuid,text,text,date,text) returns void language plpgsql as $$begin insert into private.fixture_period_checks values($4,$5);if $4<date_trunc('month',statement_timestamp() at time zone 'Asia/Taipei')::date then raise exception 'fixture prior accounting period is closed' using errcode='23514';end if;end;$$;
`;
let checks=0,seq=0;function check(label,value){assert(value,label);checks++;}
async function admin(db,sql,args){await db.exec('set session authorization postgres');return args?db.query(sql,args):db.exec(sql);}
async function as(db,actor){await db.exec(`set session authorization postgres;set audit.uid='${auth[actor]}';set session authorization authenticated`);}
async function deny(label,fn){let error;try{await fn();}catch(e){error=e;}assert(error&&['23514','55000'].includes(error.code),label+': '+(error&&error.message));checks++;}
async function action(db,actor,id,act,version,files=[]){await as(db,actor);return (await db.query('select public.finance_invoice_receipt_action_v1($1,$2,$3,$4,$5,$6,$7) result',[[id],act,'revenue_compat_'+(++seq),JSON.stringify({[id]:version}),'匿名相容性測試',JSON.stringify(files),'test'])).rows[0].result;}
async function saved(db,id){await admin(db,'select 1');return (await db.query('select * from public.invoices where id=$1',[id])).rows[0];}
async function make(db,id,family,mutate){
 await admin(db,'select 1');const now=(await db.query("select (statement_timestamp() at time zone 'Asia/Taipei')::date::text today,(date_trunc('month',statement_timestamp() at time zone 'Asia/Taipei')-interval '1 month')::date::text prior")).rows[0];
 const i={id,no:'NO-'+id,tenant_id:tenant,data_environment:'test',entity_id:'entity',department_code:'D',status:'unpaid',approval_status:'completed',approval_step:2,steps:[{rk:'applicant_submit',a:'approved'},{rk:'accountant_invoice',a:'approved'}],amount:100,total:105,tax:5,buyer:'Anonymous',receipt_files:[],row_version:1,invoice_date:family?now.prior:now.today,revenue_posted:!!family,revenue_posted_at:family?now.prior+'T00:00:00Z':null,revenue_posting_state:family?'posted':null,revenue_posting_version:2,revenue_account_code:family?'4111':null,invoice_item_type:'other'};
 if(mutate)mutate(i);await admin(db,'insert into public.invoices select * from jsonb_populate_record(null::public.invoices,$1)',[JSON.stringify(i)]);
 if(family){const prefix=(family==='tenant'?'tenant:'+tenant+':':'')+'invoice:'+i.no+':revenue'+(family==='legacy'?'':':v2');
  await db.query(`insert into public.ledger_entries(entry_date,entity_id,department_code,debit,credit,account_code,account_name,reference_no,posting_key,source_type,source_id,source_no,tenant_id,data_environment) values
   ($1,'entity','D',105,0,'1123','AR',$2,$3||':ar','invoice',$4,$2,$5,'test'),
   ($1,'entity','D',0,100,'4111','Income',$2,$3||':income','invoice',$4,$2,$5,'test'),
   ($1,'entity','D',0,5,'2134','Tax',$2,$3||':output_tax','invoice',$4,$2,$5,'test')`,[i.invoice_date,i.no,prefix,id,tenant]);
 }
 const file={path:'anonymous/'+id,bucket:'finance-attachments'};
 await admin(db,"insert into public.file_attachments(tenant_id,data_environment,bucket_id,storage_path,record_type,record_no,uploaded_by,file_kind,attachment_state) values($1,'test','finance-attachments',$2,'invoices',$3,'accountant','receipt_proof','staged')",[tenant,file.path,i.no]);
 await db.query("insert into storage.objects values('finance-attachments',$1,$2)",[file.path,auth.accountant]);
 return {i,files:[file]};
}
async function sourceLedger(db,id){await admin(db,'select 1');return (await db.query("select posting_key,debit,credit,account_code from public.ledger_entries where source_id=$1 order by posting_key",[id])).rows;}
(async()=>{const db=new PGlite();try{
 await db.exec(schema+helper('finance_correction_role_v1')+helper('finance_correction_actor_v1')+extensions);
 await db.exec(read('scripts/fixtures/finance_invoice_revenue_posting_20260908.sql'));
 await db.exec('begin;'+read('supabase/migrations/20260907154743_receipt_ceo_atomic_v1.sql')+'\ncommit;');
 for(const id of ['accountant','ceo']){await db.query('insert into public.finance_users values($1,$2,$3,$1,$4,$1,true)',[id,tenant,auth[id],id+'@invalid']);await db.query('insert into public.employee_department_roles values($1,$2,$2,true,true,current_date-1,null)',[tenant,id]);}
 await db.query("insert into public.revenue_recognition_rules(id,tenant_id,active,effective_from,invoice_item_type,priority,created_at,code,name,recognition_basis,revenue_account_code) values('00000000-0000-0000-0000-000000000055',$1,true,'2020-01-01','other',1,now(),'anonymous-rule','Anonymous rule','accrual','4111')",[tenant]);
 const baseline=await make(db,'baseline','tenant');await as(db,'ceo');
 // Calling the captured real function reproduces the defect before the new
 // receipt-specific validator, despite a complete preexisting revenue ledger.
 await admin(db,"set audit.uid='"+auth.ceo+"'");
 await deny('Captured live helper reproduces old-period/idempotency blocker',()=>db.query('select private.post_invoice_revenue_v2_internal($1,true)',['baseline']));
 for(const family of ['tenant','versioned','legacy']){
  const id='valid-'+family,f=await make(db,id,family),before=await sourceLedger(db,id);
  await action(db,'accountant',id,'submit',1,f.files);const inv=await saved(db,id);
  const checksBefore=Number((await db.query('select count(*) n from private.fixture_period_checks')).rows[0].n);
  const result=await action(db,'ceo',id,'approve',Number(inv.row_version));const after=await saved(db,id),ledger=await sourceLedger(db,id);
  check(family+' old closed-period revenue can be received in current period',result.ok&&after.status==='paid'&&ledger.length===5);
  check(family+' original revenue ledger unchanged',JSON.stringify(ledger.filter(row=>row.posting_key.includes(':revenue:')))===JSON.stringify(before));
  const dates=(await db.query('select * from private.fixture_period_checks offset $1',[checksBefore])).rows;
  check(family+' receipt checks only current cash period',dates.length===1&&dates[0].action==='發票收款入帳');
 }
 for(const family of ['tenant','versioned','legacy']){
  const id='taxfree-'+family,f=await make(db,id,family);
  await admin(db,"update public.invoices set tax=0,amount=105 where id=$1",[id]);
  await admin(db,"update public.ledger_entries set credit=105 where source_id=$1 and account_code='4111'",[id]);await db.query("delete from public.ledger_entries where source_id=$1 and account_code='2134'",[id]);
  await action(db,'accountant',id,'submit',Number((await saved(db,id)).row_version),f.files);await action(db,'ceo',id,'approve',Number((await saved(db,id)).row_version));
  check(family+' two-entry zero-tax historical revenue remains receivable',(await saved(db,id)).status==='paid'&&(await sourceLedger(db,id)).length===4);
 }
 const fresh=await make(db,'fresh',null);await action(db,'accountant','fresh','submit',1,fresh.files);await action(db,'ceo','fresh','approve',2);
 const freshRow=await saved(db,'fresh');check('Unrecognized current-period source executes full real revenue writer',freshRow.revenue_posted&&freshRow.revenue_posting_state==='posted'&&freshRow.revenue_rule_id==='00000000-0000-0000-0000-000000000055'&&(await sourceLedger(db,'fresh')).length===5);
 const closed=await make(db,'closed-unrecognized',null,i=>{i.invoice_date='2025-01-01';});await action(db,'accountant','closed-unrecognized','submit',1,closed.files);
 await deny('Unrecognized old closed-period revenue still rejects',()=>action(db,'ceo','closed-unrecognized','approve',2));
 check('Closed-period failure rolls back cash/status entirely',(await saved(db,'closed-unrecognized')).status==='pending_receipt_review'&&(await sourceLedger(db,'closed-unrecognized')).length===0);
 for(const bad of ['amount','mixed','duplicate','source','department','environment','voided','flags']){
  const id='bad-'+bad,f=await make(db,id,'legacy');
  if(bad==='amount')await admin(db,"update public.ledger_entries set debit=104 where source_id=$1 and account_code='1123'",[id]);
  if(bad==='mixed')await admin(db,"update public.ledger_entries set posting_key=replace(posting_key,':revenue:',':revenue:v2:') where source_id=$1 and account_code='1123'",[id]);
  if(bad==='duplicate')await admin(db,"insert into public.ledger_entries select entry_date,description,entity_id,department_code,debit,credit,account_code,account_name,reference_no,replace(posting_key,':revenue:',':revenue:v2:'),source_type,source_id,source_no,tenant_id,data_environment,voided_at from public.ledger_entries where source_id=$1",[id]);
  if(bad==='source')await admin(db,"update public.ledger_entries set source_id='wrong-source' where source_id=$1 and account_code='1123'",[id]);
  if(bad==='department')await admin(db,"update public.ledger_entries set department_code='other' where source_id=$1 and account_code='1123'",[id]);
  if(bad==='environment')await admin(db,"update public.ledger_entries set data_environment='production' where source_id=$1 and account_code='1123'",[id]);
  if(bad==='voided')await admin(db,"update public.ledger_entries set voided_at=now() where source_id=$1 and account_code='1123'",[id]);
  if(bad==='flags')await admin(db,"update public.invoices set revenue_posted_at=null where id=$1",[id]);
  await action(db,'accountant',id,'submit',Number((await saved(db,id)).row_version),f.files);const version=Number((await saved(db,id)).row_version);
  await deny('Invalid '+bad+' legacy recognition rejected',()=>action(db,'ceo',id,'approve',version));
  check('Invalid '+bad+' does not post cash or claim paid',(await saved(db,id)).status==='pending_receipt_review'&&!(await sourceLedger(db,id)).some(row=>row.posting_key.includes(':receipt:')));
 }
 console.log('PASS: '+checks+' receipt revenue compatibility checks with unmodified live posting helper (isolated PostgreSQL)');
 }finally{await db.close();}
})().catch(error=>{console.error({message:error.message,code:error.code,where:error.where,detail:error.detail,stack:error.code?undefined:error.stack});process.exitCode=1;});
