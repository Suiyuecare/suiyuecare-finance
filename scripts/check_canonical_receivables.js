#!/usr/bin/env node
'use strict';
// Candidate SQL executes in isolated PostgreSQL with fictional identities.
// Existing revenue writer, receipt actor/role/proof guards are real source;
// fixture auth/permission/period/storage interfaces replace external services.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const migration=read('supabase/migrations/20260910064324_finance_canonical_receivables_v1.sql');
const tenant='00000000-0000-0000-0000-000000000001',other='00000000-0000-0000-0000-000000000002';
const auth={accountant:'00000000-0000-0000-0000-000000000011',ceo:'00000000-0000-0000-0000-000000000012',director:'00000000-0000-0000-0000-000000000013',employee:'00000000-0000-0000-0000-000000000014'};
const schema=vm.runInNewContext('`'+read('scripts/check_receipt_atomic_workflow.js').match(/const schema=`([\s\S]*?)`;/)[1]+'`',{tenant});
const extensions=read('scripts/check_receipt_revenue_compatibility.js').match(/const extensions=`([\s\S]*?)`;/)[1];
const correction=read('supabase/migrations/20260907154742_expense_accounting_correction_workflow_v1.sql');
function helper(n){const a=correction.indexOf('create function private.'+n+'(');assert(a>=0);return correction.slice(a,correction.indexOf('$function$;',a)+11);}
let n=0,key=0,today,prior;function check(label,value){assert(value,label);console.log('PASS '+label);n++;}
async function admin(db,sql,args){await db.exec('set session authorization postgres');return args?db.query(sql,args):db.exec(sql);}
async function as(db,actor){await db.exec("set session authorization postgres;select set_config('audit.uid','"+(auth[actor]||'')+"',false);set session authorization authenticated");}
async function deny(label,fn){let error;try{await fn();}catch(e){error=e;}assert(error&&['42501','22023','23514','23505','40001','55000','22007','22008'].includes(error.code),label+': '+(error?.code+' '+error?.message));check(label,true);}
async function saved(db,id){await admin(db,'select 1');return(await db.query('select * from public.invoices where id=$1',[id])).rows[0];}
async function fingerprint(db){await admin(db,'select 1');return JSON.stringify((await db.query(`select jsonb_build_object('invoices',(select jsonb_agg(to_jsonb(i) order by id) from public.invoices i),'ledger',(select jsonb_agg(to_jsonb(l) order by posting_key) from public.ledger_entries l),'events',(select jsonb_agg(to_jsonb(e) order by id) from public.invoice_lifecycle_events e),'receipts',(select jsonb_agg(to_jsonb(r) order by id) from private.finance_ar_receipts_v1 r),'refunds',(select jsonb_agg(to_jsonb(r) order by id) from private.finance_ar_refunds_v1 r),'vouchers',(select jsonb_agg(to_jsonb(v) order by id) from public.vouchers v)) x`)).rows[0].x);}
async function make(db,id,total=100,opts={}){
 const i={id,no:id,tenant_id:tenant,data_environment:'test',entity_id:'FICT-CO',entity_name:'虛構公司',department_code:'FICT-D',invoice_date:prior,status:'unpaid',approval_status:'pending_delivery',approval_step:3,steps:[{rk:'applicant_submit',a:'approved'},{rk:'accountant_invoice',a:'approved'},{rk:'applicant_invoice_delivery',a:''}],amount:total,total,tax:0,buyer:'虛構客戶',row_version:1,receipt_files:[],revenue_posted:true,revenue_posted_at:new Date().toISOString(),revenue_posting_state:'posted',revenue_posting_version:2,revenue_account_code:'4111',...opts};
 await admin(db,'insert into public.invoices select * from jsonb_populate_record(null::public.invoices,$1)',[JSON.stringify(i)]);
 if(opts.revenue_posted!==false){for(const [suffix,ac,dr,cr] of [['ar','1123',total,0],['income','4111',0,total]])await db.query(`insert into public.ledger_entries(entry_date,entity_id,department_code,debit,credit,account_code,account_name,reference_no,posting_key,source_type,source_id,source_no,tenant_id,data_environment) values($1,$2,$3,$4,$5,$6,'虛構科目',$7,$8,'invoice',$7,$7,$9,$10)`,[i.invoice_date,i.entity_id,i.department_code,dr,cr,ac,id,'invoice:'+id+':revenue:'+suffix,i.tenant_id,i.data_environment]);}
 const files=[{bucket:'finance-attachments',path:'fictional/'+id}];await db.query("insert into public.file_attachments(tenant_id,data_environment,bucket_id,storage_path,record_type,record_no,uploaded_by,file_kind,attachment_state) values($1,'test','finance-attachments',$2,'invoices',$3,'accountant','receipt_proof','staged')",[tenant,files[0].path,id]);await db.query("insert into storage.objects values('finance-attachments',$1,$2)",[files[0].path,auth.accountant]);return files;
}
async function receipt(db,actor,ids,action,opts={}){const versions={};for(const id of ids)versions[id]=(await saved(db,id)).row_version;await as(db,actor);return(await db.query('select public.finance_invoice_receipt_action_v2($1,$2,$3,$4,$5,$6,$7,$8,$9) x',[ids,action,opts.key||'fict-operation-'+(++key),JSON.stringify(opts.versions||versions),opts.note||'虛構驗證備註',JSON.stringify(opts.files||[]),opts.env||'test',opts.amounts?JSON.stringify(opts.amounts):null,opts.date||null])).rows[0].x;}
async function ar(db,id,date=today){await as(db,'accountant');const p=(await db.query("select public.finance_receivables_v1($1,null,null,'test') x",[date])).rows[0].x;return id?p.items.find(x=>x.invoiceId===id):p;}
async function allowance(db,id,amount,no,date=today){await as(db,'accountant');return(await db.query("select public.post_invoice_lifecycle_voucher($1,'allowance',$2,'虛構折讓',$3,0,$3,$4) x",[id,no,amount,date])).rows[0].x;}
async function refund(db,event,amount,expected,opts={}){await as(db,opts.actor||'accountant');return(await db.query('select public.refund_invoice_receipt_v2($1,$2,$3,$4,$5,$6,$7) x',[event,amount,opts.reason||'虛構分次退款',opts.date||today,opts.bank||null,opts.key||'fict-refund-'+(++key),expected])).rows[0].x;}
(async()=>{const db=new PGlite();try{
 await db.exec(schema+extensions+helper('finance_correction_role_v1')+helper('finance_correction_actor_v1'));
 await db.exec(read('scripts/fixtures/finance_receivables_schema_20260910.sql'));
 await db.exec('create unique index fixture_lifecycle_posting on public.ledger_entries(data_environment,posting_key) where posting_key is not null');
 await db.exec(read('scripts/fixtures/finance_invoice_revenue_posting_20260908.sql'));
 await db.exec('begin;'+read('supabase/migrations/20260907154743_receipt_ceo_atomic_v1.sql')+'\ncommit;');
 // Fixture period gate is controllable; the production gate is exercised by
 // the protected canary and remains the same dependency in the real RPC.
 await db.exec("create or replace function private.finance_assert_period_open(uuid,text,text,date,text) returns void language plpgsql as $$begin if current_setting('audit.closed',true)='true' then raise exception 'fixture closed period' using errcode='23514';end if;end;$$;");
 for(const [id,role]of[['accountant','accountant'],['ceo','ceo'],['director','admin_director'],['employee','employee']]){await db.query('insert into public.finance_users values($1,$2,$3,$1,$4,$5,true)',[id,tenant,auth[id],id+'@invalid',role]);await db.query('insert into public.employee_department_roles values($1,$2,$3,true,true,current_date-1,null)',[tenant,id,role]);}
 const dates=(await db.query("select (now() at time zone 'Asia/Taipei')::date::text today,((now() at time zone 'Asia/Taipei')::date-2)::text prior")).rows[0];({today,prior}=dates);
 await db.exec('begin;'+migration+'\nrollback;');check('migration rehearsal fully rolls back new tables/RPC',(await db.query("select to_regclass('private.finance_ar_receipts_v1') is null and to_regprocedure('public.finance_receivables_v1(date,text,text,text)') is null ok")).rows[0].ok);
 await db.exec('begin;'+migration+'\ncommit;');
 check('all new private tables use RLS and deny direct authenticated access',(await db.query("select bool_and(c.relrowsecurity and not has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE')) ok from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relname in ('finance_ar_terms_v1','finance_ar_operations_v1','finance_ar_receipts_v1','finance_ar_refunds_v1','finance_ar_audit_v1')")).rows[0].ok);
 const f=await make(db,'FICT-100');check('canonical original 100',(await ar(db,'FICT-100')).outstandingAmount===100);
 const al=await allowance(db,'FICT-100',20,'FICT-ALW-20',prior);let x=await ar(db,'FICT-100');check('actual allowance writer 100 minus 20 = 80 with original immutable',x.outstandingAmount===80&&x.allowanceAmount===20&&Number((await saved(db,'FICT-100')).total)===100);
 check('unknown due date has independent bucket',x.dueDate===null&&x.agingBucket==='unknown'&&x.overdueDays===null);
 await as(db,'accountant');let d=(await db.query("select public.finance_set_invoice_due_date_v1('FICT-100',$1,0,'虛構到期日','fict-due-0001','test') x",[prior])).rows[0].x;check('save due date uses metadata version',d.metadataVersion===1&&(await ar(db,'FICT-100')).agingBucket==='d1');
 await as(db,'accountant');check('metadata idempotent retry',(await db.query("select public.finance_set_invoice_due_date_v1('FICT-100',$1,0,'虛構到期日','fict-due-0001','test') x",[prior])).rows[0].x.idempotent_replay);
 await deny('stale metadata version rejected',()=>db.query("select public.finance_set_invoice_due_date_v1('FICT-100',$1,0,'虛構','fict-due-0002','test')",[today]));
 await as(db,'employee');await deny('employee metadata mutation denied',()=>db.query("select public.finance_set_invoice_due_date_v1('FICT-100',$1,1,'虛構','fict-due-0003','test')",[today]));
 const before=await fingerprint(db);await deny('over-receipt after allowance rejected',()=>receipt(db,'accountant',['FICT-100'],'submit',{files:f,amounts:{'FICT-100':100}}));check('rejected receipt has no mutation',before===await fingerprint(db));
 for(const actor of ['employee','director','ceo'])await deny(actor+' cannot submit receipt',()=>receipt(db,actor,['FICT-100'],'submit',{files:f,amounts:{'FICT-100':40}}));
 await receipt(db,'accountant',['FICT-100'],'submit',{files:f,amounts:{'FICT-100':40},date:prior});x=await ar(db,'FICT-100');check('pending amount/date persisted for review',x.pendingReceiptAmount===40&&x.pendingReceiptDate===prior&&x.outstandingAmount===80);
 await deny('accountant cannot approve',()=>receipt(db,'accountant',['FICT-100'],'approve'));
 const approveVersions={'FICT-100':(await saved(db,'FICT-100')).row_version};const result=await receipt(db,'ceo',['FICT-100'],'approve',{key:'fict-approve-0001'});x=await ar(db,'FICT-100');check('first partial receipt 40 leaves 40 and audit evidence',result.ok&&x.receivedAmount===40&&x.outstandingAmount===40&&x.status==='partial');
 check('approval retry replays without another posting',(await receipt(db,'ceo',['FICT-100'],'approve',{key:'fict-approve-0001',versions:approveVersions})).idempotent_replay);
 await as(db,'ceo');await deny('direct partial status reopening denied',()=>db.exec("update public.invoices set status='unpaid' where id='FICT-100'"));
 await receipt(db,'accountant',['FICT-100'],'submit',{files:f,amounts:{'FICT-100':40},date:today});await receipt(db,'ceo',['FICT-100'],'approve');x=await ar(db,'FICT-100');check('second partial receipt settles only remaining 40',x.receivedAmount===80&&x.outstandingAmount===0&&x.status==='paid');
 x=await ar(db,'FICT-100',prior);check('historical as-of balance ignores later receipt and current paid status',x.receivedAmount===40&&x.outstandingAmount===40);
 const fa=await make(db,'FICT-BATCH-A',100,{batch_id:'FICT-BATCH'});await make(db,'FICT-BATCH-B',200,{batch_id:'FICT-BATCH'});await receipt(db,'accountant',['FICT-BATCH-A'],'submit',{files:fa});await receipt(db,'ceo',['FICT-BATCH-A'],'approve');const batch=(await ar(db)).items.filter(x=>x.batchId==='FICT-BATCH');check('100+200 batch paid 100 has exact remaining 200',batch.reduce((n,x)=>n+x.outstandingAmount,0)===200);
 const fr=await make(db,'FICT-REFUND',100);await receipt(db,'accountant',['FICT-REFUND'],'submit',{files:fr,date:prior});await receipt(db,'ceo',['FICT-REFUND'],'approve');const ra=await allowance(db,'FICT-REFUND',100,'FICT-REFUND-ALW',prior);const event=ra.event_id;
 await deny('employee cannot refund',()=>refund(db,event,40,0,{actor:'employee'}));
 const rr=await refund(db,event,40,0,{date:prior,key:'fict-refund-fixed-1'});check('first refund 40 leaves payable 60',rr.remaining_refund_amount===60&&(await ar(db,'FICT-REFUND')).refundPayable===60);
 check('refund retry is idempotent',(await refund(db,event,40,0,{date:prior,key:'fict-refund-fixed-1'})).idempotent_replay);
 await deny('changed refund payload cannot reuse key',()=>refund(db,event,41,0,{date:prior,key:'fict-refund-fixed-1'}));
 await refund(db,event,60,40);x=await ar(db,'FICT-REFUND');check('second refund 60 completes 100 without recreating AR',x.refundedAmount===100&&x.refundPayable===0&&x.outstandingAmount===0);
 x=await ar(db,'FICT-REFUND',prior);check('refund as-of preserves first installment',x.refundedAmount===40&&x.refundPayable===60);
 await deny('over-refund rejected',()=>refund(db,event,1,100));

 // Partial receipt + full allowance must settle AR first, only paid cash is refundable.
 const fspl=await make(db,'FICT-SPLIT',100);await receipt(db,'accountant',['FICT-SPLIT'],'submit',{files:fspl,amounts:{'FICT-SPLIT':40}});await receipt(db,'ceo',['FICT-SPLIT'],'approve');
 const split=await allowance(db,'FICT-SPLIT',100,'FICT-SPLIT-ALW');x=await ar(db,'FICT-SPLIT');check('received40 allowance100 splits AR60/refund40',split.ar_amount===60&&split.refund_payable_amount===40&&x.outstandingAmount===0&&x.refundPayable===40&&x.allowanceAmount===100&&x.arAllowanceAmount===60);
 await refund(db,split.event_id,10,0);await refund(db,split.event_id,30,10);x=await ar(db,'FICT-SPLIT');check('split refund10+30 preserves AR0 and paid40',x.outstandingAmount===0&&x.refundedAmount===40&&x.receivedAmount===40);
 await deny('split refund cannot exceed paid40',()=>refund(db,split.event_id,1,40));
 const stable=await fingerprint(db);await deny('no extra allowance after full100 adjustment',()=>allowance(db,'FICT-SPLIT',1,'FICT-SPLIT-EXCESS'));check('excess allowance preserves full journals and events',stable===await fingerprint(db));
 const fback=await make(db,'FICT-BACKDATE',100);await receipt(db,'accountant',['FICT-BACKDATE'],'submit',{files:fback,date:today});await receipt(db,'ceo',['FICT-BACKDATE'],'approve');
 const fpBack=await fingerprint(db);await deny('backdated allowance cannot allocate from later received cash',()=>allowance(db,'FICT-BACKDATE',50,'FICT-BACKDATE-ALW',prior));check('backdated rejection preserves original journals and events',fpBack===await fingerprint(db));
 check('current-date allowance remains available after backdated rejection',(await allowance(db,'FICT-BACKDATE',50,'FICT-BACKDATE-ALW',today)).refund_payable_amount===50);
 // A real late PostgreSQL trigger fails the second row after first-row writes.
 const lfa=await make(db,'FICT-LATE-A'),lfb=await make(db,'FICT-LATE-B');await receipt(db,'accountant',['FICT-LATE-A','FICT-LATE-B'],'submit',{files:{'FICT-LATE-A':lfa,'FICT-LATE-B':lfb}});
 await admin(db,"create function private.fixture_late_receipt_fail() returns trigger language plpgsql as $$begin if new.source_id='FICT-LATE-B' and new.posting_key like '%:receipt:%' and current_setting('audit.late_fail',true)='true' then raise exception 'fixture late failure' using errcode='23514';end if;return new;end;$$;create trigger fixture_late_receipt_fail after insert on public.ledger_entries for each row execute function private.fixture_late_receipt_fail();set audit.late_fail='true';");
 const fpLate=await fingerprint(db);await deny('second invoice late trigger rejects entire batch',()=>receipt(db,'ceo',['FICT-LATE-A','FICT-LATE-B'],'approve',{key:'fict-late-fixed-key'}));check('late failure fingerprint leaves both sources, receipts, vouchers, events, ledger unchanged',fpLate===await fingerprint(db));
 check('failed operation key has no cached success',(await db.query("select count(*)::int n from private.finance_receipt_operations_v1 where operation_key='fict-late-fixed-key'")).rows[0].n===0);
 await admin(db,"set audit.late_fail='false'");check('same operation key safely retries after rollback',(await receipt(db,'ceo',['FICT-LATE-A','FICT-LATE-B'],'approve',{key:'fict-late-fixed-key'})).ok);
 const fclosed=await make(db,'FICT-CLOSED');await receipt(db,'accountant',['FICT-CLOSED'],'submit',{files:fclosed});await admin(db,"set audit.closed='true'");const fpClosed=await fingerprint(db);await deny('closed receipt period rejected atomically',()=>receipt(db,'ceo',['FICT-CLOSED'],'approve'));check('closed period fingerprint unchanged',fpClosed===await fingerprint(db));await admin(db,"set audit.closed='false'");
 // Source bill dates and old follow-up amounts are distinct facts.
 await make(db,'FICT-BILL-DUE',100,{source_bill_id:'FICT-BILL'});await admin(db,"insert into public.bills(id,tenant_id,data_environment,entity_id,due_date) values('FICT-BILL',$1,'test','FICT-CO',$2)",[tenant,prior]);
 await db.query("insert into public.collection_followups(source_table,source_id,tenant_id,data_environment,owner_user_id,owner_name,last_note,outstanding_amount) values('invoices','FICT-BILL-DUE',$1,'test','employee','虛構追蹤人','虛構追蹤備註',999)",[tenant]);
 x=await ar(db,'FICT-BILL-DUE');check('source bill due date and existing follow-up metadata are used, stale follow-up amount ignored',x.dueSource==='source_bill'&&x.dueDate===prior&&x.ownerId==='employee'&&x.notes==='虛構追蹤備註'&&x.outstandingAmount===100);
 await admin(db,"update public.bills set tenant_id=$1 where id='FICT-BILL'",[other]);check('cross-tenant bill cannot supply due date',(await ar(db,'FICT-BILL-DUE')).dueSource==='unknown');
 // Bank matching must compare amounts, not just the presence of a match.
 await admin(db,"insert into public.bank_transactions(id,tenant_id,data_environment,entity_id,transaction_date,amount,match_status) values('FICT-BANK',$1,'test','FICT-CO',$2,100,'matched'),('FICT-BANK-OTHER',$3,'test','FICT-CO',$2,900,'unmatched')",[tenant,prior,other]);
 await db.query("insert into public.bank_reconciliation_matches(id,tenant_id,data_environment,bank_transaction_id,match_type,target_table,target_id,matched_amount,matched_at) values('FICT-MATCH',$1,'test','FICT-BANK','invoice','invoices','FICT-BILL-DUE',40,$2)",[tenant,prior]);
 let bank=(await ar(db)).reconciliation;check('partial bank match40 on100 still lists remaining60',bank.unmatchedBankCount===1&&bank.unmatchedBankAmount===60&&bank.unmatchedBankItems[0].remainingAmount===60);
 await as(db,'employee');check('employee does not gain bank read permission',(await db.query("select public.finance_receivables_v1($1,null,null,'test') x",[today])).rows[0].x.reconciliation.bankVisible===false);
 // Optional bank matching is part of the same installment transaction.
 const fb=await make(db,'FICT-BANK-REFUND');await receipt(db,'accountant',['FICT-BANK-REFUND'],'submit',{files:fb});await receipt(db,'ceo',['FICT-BANK-REFUND'],'approve');const be=await allowance(db,'FICT-BANK-REFUND',100,'FICT-BANK-REFUND-ALW');
 await admin(db,"insert into public.bank_transactions(id,tenant_id,data_environment,entity_id,transaction_date,amount,match_status) values('FICT-REFUND-OUT',$1,'test','FICT-CO',$2,-100,'unmatched'),('FICT-REFUND-OTHER',$3,'test','FICT-CO',$2,-100,'unmatched')",[tenant,today,other]);
 await deny('refund rejects another tenant bank outflow',()=>refund(db,be.event_id,40,0,{bank:'FICT-REFUND-OTHER'}));
 await refund(db,be.event_id,40,0,{bank:'FICT-REFUND-OUT'});await admin(db,'select 1');let bankRefund=(await db.query("select match_status,(select sum(matched_amount) from public.bank_reconciliation_matches where bank_transaction_id='FICT-REFUND-OUT') matched from public.bank_transactions where id='FICT-REFUND-OUT'")).rows[0];check('partial refund40 matches bank40 and keeps remaining outflow open',bankRefund.match_status==='manual_review'&&Number(bankRefund.matched)===40);
 await refund(db,be.event_id,60,40,{bank:'FICT-REFUND-OUT'});await admin(db,'select 1');check('second refund60 settles exactly the bank100 once',(await db.query("select match_status='matched' and (select sum(matched_amount) from public.bank_reconciliation_matches where bank_transaction_id='FICT-REFUND-OUT')=100 ok from public.bank_transactions where id='FICT-REFUND-OUT'")).rows[0].ok);
 // Pending legacy v1 reviews remain usable only at the reviewed full amount.
 const fv1=await make(db,'FICT-V1');await as(db,'accountant');const oldArgs=[['FICT-V1'],'submit','fict-v1-stable-key',JSON.stringify({'FICT-V1':1}),'虛構驗證',JSON.stringify(fv1),'test'];let oldResult=(await db.query('select public.finance_invoice_receipt_action_v1($1,$2,$3,$4,$5,$6,$7) x',oldArgs)).rows[0].x;
 check('legacy v1 signature submits remaining balance',oldResult.ok&&oldResult.rows[0].amount===100);
 check('legacy v1 exact digest retries',(await db.query('select public.finance_invoice_receipt_action_v1($1,$2,$3,$4,$5,$6,$7) x',oldArgs)).rows[0].x.idempotent_replay);
 await admin(db,"delete from private.finance_ar_receipts_v1 where invoice_id='FICT-V1'");await receipt(db,'ceo',['FICT-V1'],'approve');check('legacy pending proof with no new event is compatible',(await ar(db,'FICT-V1')).outstandingAmount===0);
 // Signed as-of source grouping must also power the real dashboard function.
 await as(db,'accountant');const dash=(await db.query("select public.finance_executive_dashboard_v3($1,$2,$1,$1,$1,null,'test') x",[prior,today])).rows[0].x;
 const canonical=await ar(db);check('dashboard AR totals use the canonical query',dash.receivables.total===canonical.summary.outstandingAmount&&dash.receivables.buckets.some(x=>x.key==='unknown'));
 await admin(db,"set audit.can_read='false'");await as(db,'accountant');check('read scope filters unauthorized invoices',(await db.query("select public.finance_receivables_v1($1,null,null,'test') x",[today])).rows[0].x.items.length===0);await admin(db,"set audit.can_read='true'");
 await as(db,'none');await deny('anonymous Finance identity cannot read',()=>db.query("select public.finance_receivables_v1($1,null,null,'test')",[today]));

 await as(db,'accountant');await deny('REST cannot rewrite posted allocation',()=>db.query('update public.invoice_lifecycle_events set refund_payable_amount=999,ar_amount=0 where id=$1',[split.event_id]));
 await deny('REST cannot reset already refunded amount',()=>db.query('update public.invoice_lifecycle_events set refund_amount=0 where id=$1',[split.event_id]));
 await deny('old unkeyed refund endpoint explicitly requires upgrade',()=>db.query('select public.refund_invoice_receipt($1,1,\'old call\')',[split.event_id]));
 await as(db,'ceo');await deny('caller GUC alone cannot forge refund source capability',()=>db.exec("set app.finance_ar_actor='accountant';set app.finance_ar_operation='ar-forged';insert into public.ledger_entries(tenant_id,data_environment,entity_id,source_id,posting_key) values('"+tenant+"','test','FICT-CO','fake','invoice_refund:forged')"));
 // Run the exact committed postflight with no authenticated context.
 await admin(db,"set audit.uid='';set request.jwt.claim.sub='';set request.jwt.claims='{}'");await db.exec(read('scripts/finance_canonical_receivables_postflight.sql').replace(/^\\set ON_ERROR_STOP on\r?\n/,''));check('exact postflight runs in empty auth context',true);
 // Execute the exact SQL canary using structural Auth/org fixtures. This
 // tests its queries and rollback, not a real person's OAuth or live storage.
 await db.exec(`
 create table auth.users(id uuid,email_confirmed_at timestamptz,is_anonymous boolean default false);
 create table auth.identities(user_id uuid,provider text);
 insert into auth.users select auth_user_id,now(),false from public.finance_users;
 insert into auth.identities select auth_user_id,'google' from public.finance_users;
 create or replace function auth.uid() returns uuid language sql stable as $$select coalesce(nullif(current_setting('audit.uid',true),''),nullif(current_setting('request.jwt.claim.sub',true),''))::uuid$$;
 create function public.finance_user_is_approval_identity_ready(uuid,text) returns boolean language sql stable as $$select exists(select 1 from public.finance_users where tenant_id=$1 and id=$2 and active and auth_user_id is not null)$$;
 create function public.current_finance_user() returns public.finance_users language sql stable security definer as $$select * from public.finance_users where auth_user_id=auth.uid()$$;
 alter table public.employee_department_roles add column metadata jsonb default '{}';
 create function private.finance_org_effective_now_v2(jsonb) returns boolean language sql stable as $$select ($1->>'active')::boolean and ($1->>'effective_from')::date<=current_date and (nullif($1->>'effective_to','') is null or ($1->>'effective_to')::date>=current_date)$$;
 create table public.finance_department_units(id uuid,tenant_id uuid,code text,active boolean,present_in_source boolean,is_posting_unit boolean);
 create table public.finance_department_entity_scopes(tenant_id uuid,unit_id uuid,active boolean,entity_code text);
 insert into public.finance_department_units values('00000000-0000-0000-0000-000000000044','${tenant}','J1101',true,true,true);
 insert into public.finance_department_entity_scopes values('${tenant}','00000000-0000-0000-0000-000000000044',true,'E6');
 alter table public.invoices add column applicant text;
 create table public.notification_delivery_events(request_id text,payload jsonb);
 insert into public.revenue_recognition_rules(id,tenant_id,active,effective_from,priority,revenue_account_code) values('00000000-0000-0000-0000-000000000055','${tenant}',true,'2020-01-01',1,'4111');
 `);
 const preCanary=await fingerprint(db);const canary=await db.exec(read('scripts/finance_canonical_receivables_canary.sql'));
 check('exact authenticated SQL canary passes split/refund/authority checks',canary.some(r=>r.rows?.some(x=>x.canonical_receivables_canary_result?.receivables_consistent===true)));
 check('exact SQL canary fully restores preexisting source/ledger/event fingerprint',preCanary===await fingerprint(db));
 console.log('Canonical receivables: '+n+' checks passed. No production connections or writes.');
 }finally{await db.close();}})().catch(e=>{console.error({message:e.message,code:e.code,where:e.where,position:e.position,queryExcerpt:e.query&&e.position?e.query.slice(Math.max(0,Number(e.position)-120),Number(e.position)+120):undefined});process.exitCode=1;});
