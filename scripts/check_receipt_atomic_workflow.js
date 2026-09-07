#!/usr/bin/env node
'use strict';
// Execute candidate PL/pgSQL in isolated PostgreSQL (PGlite), with anonymous
// schema fixtures. Includes AFTER-trigger failure injection and rollback. It
// does not claim to replay every production RLS policy/trigger or post live cash.
const fs=require('fs'),path=require('path'),assert=require('assert'),vm=require('vm');
const {PGlite}=require('@electric-sql/pglite');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const sql=read('supabase/migrations/20260907154743_receipt_ceo_atomic_v1.sql'),correction=read('supabase/migrations/20260907154742_expense_accounting_correction_workflow_v1.sql');
const tenant='00000000-0000-0000-0000-000000000001',otherTenant='00000000-0000-0000-0000-000000000002';
const auth={accountant:'00000000-0000-0000-0000-000000000011',ceo:'00000000-0000-0000-0000-000000000012',director:'00000000-0000-0000-0000-000000000013',employee:'00000000-0000-0000-0000-000000000014'};
let count=0,seq=0;const check=(label,value)=>{assert(value,label);count++;};
const schema=`
create schema private;create schema auth;create schema storage;create role anon;create role authenticated;create role service_role;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('audit.uid',true),'')::uuid$$;
create function public.current_tenant_id() returns uuid language sql stable as $$select '${tenant}'::uuid$$;
create function public.default_tenant_id() returns uuid language sql stable as $$select '${tenant}'::uuid$$;
create table public.finance_users(id text primary key,tenant_id uuid,auth_user_id uuid,name text,email text,role text,active boolean);
create table public.employee_department_roles(tenant_id uuid,finance_user_id text,role_key text,active boolean,can_approve boolean,effective_from date,effective_to date);
create function public.finance_org_role_members(text,text) returns table(finance_user_id text,can_approve boolean) language sql as $$select finance_user_id,can_approve from public.employee_department_roles where role_key=$1 and active$$;
create table public.invoices(id text primary key,no text,tenant_id uuid,data_environment text,entity_id text,department_code text,batch_id text,status text,approval_status text,approval_step integer,steps jsonb,total numeric,amount numeric,tax numeric,buyer text,paid_at timestamptz,receipt_files jsonb default '[]',receipt_submitted_at timestamptz,receipt_submitted_by text,receipt_note text,receipt_reviewed_at timestamptz,receipt_reviewed_by text,receipt_review_note text,cash_receipt_posted_at timestamptz,voided_at timestamptz,updated_at timestamptz,row_version bigint default 1,revenue_posted boolean default false);
create table public.file_attachments(tenant_id uuid,data_environment text,bucket_id text,storage_path text,record_type text,record_no text,uploaded_by text,file_kind text,attachment_state text,claimed_at timestamptz);
create table storage.objects(bucket_id text,name text,owner_id text);
create table public.ledger_entries(entry_date date,description text,entity_id text,department_code text,debit numeric,credit numeric,account_code text,account_name text,reference_no text,posting_key text unique,source_type text,source_id text,source_no text,tenant_id uuid,data_environment text);
create table public.module_audit_logs(table_name text,row_id text,action text,actor_email text,before_data jsonb,after_data jsonb);
create table public.notifications(id text,tenant_id uuid,data_environment text,request_id text);
create table public.expense_requests(id text,tenant_id uuid,data_environment text);
create table public.bills(id text,tenant_id uuid,data_environment text);
create function public.can_read_invoice(public.invoices) returns boolean language sql stable as $$select $1.tenant_id=public.current_tenant_id() and coalesce(current_setting('audit.can_read',true),'true')<>'false'$$;
create function private.finance_assert_period_open(uuid,text,text,date,text) returns void language plpgsql as $$begin if current_setting('audit.closed',true)='true' then raise exception 'fixture closed period' using errcode='23514';end if;end;$$;
create function private.finance_income_append_step_action(jsonb,text,text,text,text,jsonb) returns jsonb language sql as $$select $1||jsonb_build_object('n',$3,'actionLog',jsonb_build_array(jsonb_build_object('byId',$2,'comment',$5)))$$;
create function private.post_invoice_revenue_v2_internal(text,boolean) returns jsonb language plpgsql as $$begin if current_setting('audit.revenue_fail',true)=$1 then raise exception 'fixture revenue failure' using errcode='23514';end if;update public.invoices set revenue_posted=true where id=$1;return '{"ok":true,"deferred":false}'::jsonb;end;$$;
create function private.fixture_invoice_version() returns trigger language plpgsql as $$begin new.row_version:=old.row_version+1;return new;end;$$;
create trigger zz_fixture_invoice_version before update on public.invoices for each row execute function private.fixture_invoice_version();
-- Fixture for the reviewed production AFTER attachment-claim interface; the
-- production trigger also checks v3 path format and live Storage owner_id.
create function private.fixture_claim() returns trigger language plpgsql as $$begin update public.file_attachments a set attachment_state='claimed',claimed_at=now(),record_no=coalesce(nullif(new.batch_id,''),new.no) where exists(select 1 from jsonb_array_elements(new.receipt_files) f where coalesce(f->>'path',f->>'storagePath')=a.storage_path) and a.tenant_id=new.tenant_id and a.data_environment=new.data_environment and a.uploaded_by=(select id from public.finance_users where auth_user_id=auth.uid());return new;end;$$;
create trigger fixture_claim after update on public.invoices for each row execute function private.fixture_claim();
grant usage on schema public,auth to authenticated;grant select,insert,update,delete on public.invoices,public.ledger_entries to authenticated;
alter table public.invoices enable row level security;
create policy fixture_tenant on public.invoices to authenticated using(tenant_id=public.current_tenant_id()) with check(tenant_id=public.current_tenant_id());
`;
function helper(name){const start=correction.indexOf('create function private.'+name+'(');assert(start>=0);return correction.slice(start,correction.indexOf('$function$;',start)+11);}
async function admin(db,sql,args){await db.exec('set session authorization postgres');return args?db.query(sql,args):db.exec(sql);}
async function as(db,actor){await db.exec(`set session authorization postgres;set audit.uid='${auth[actor]||''}';set session authorization authenticated;`);}
async function fixture(db,id,extra={}){const row={id,no:id,tenant_id:tenant,data_environment:'test',entity_id:'entity',department_code:'D',status:'unpaid',approval_status:'pending_delivery',approval_step:3,steps:[{rk:'applicant_submit',a:'approved'},{rk:'accountant_invoice',a:'approved'},{rk:'applicant_invoice_delivery',a:''}],amount:100,total:105,tax:5,buyer:'Anonymous',...extra};await admin(db,'insert into public.invoices select * from jsonb_populate_record(null::public.invoices,$1)',[JSON.stringify({...row,row_version:1,receipt_files:row.receipt_files||[]})]);return row;}
async function proof(db,id,extra={}){const attachment={tenant_id:tenant,data_environment:'test',bucket_id:'finance-attachments',storage_path:'anonymous/'+id,record_type:'invoices',record_no:id,uploaded_by:'accountant',file_kind:'receipt_proof',attachment_state:'staged',...extra};await admin(db,'insert into public.file_attachments select * from jsonb_populate_record(null::public.file_attachments,$1)',[JSON.stringify(attachment)]);await db.query('insert into storage.objects values($1,$2,$3)',[attachment.bucket_id,attachment.storage_path,auth[attachment.uploaded_by]||'wrong-owner']);return [{path:attachment.storage_path,bucket:attachment.bucket_id}];}
async function call(db,actor,ids,action,versions,opts={}){await as(db,actor);return (await db.query('select public.finance_invoice_receipt_action_v1($1,$2,$3,$4,$5,$6,$7) result',[ids,action,opts.key||'operation_'+(++seq),JSON.stringify(versions),opts.note||'匿名驗收備註',JSON.stringify(opts.files||[]),opts.environment||'test'])).rows[0].result;}
async function deny(label,fn,codes=['42501','22023','23514','23505','40001','55000']){let e;try{await fn();}catch(error){e=error;}if(!e||!codes.includes(e.code))throw new Error(label+': '+(e?e.code+' '+e.message:'unexpected success'));count++;}
async function row(db,id){await admin(db,'select 1');return (await db.query('select * from public.invoices where id=$1',[id])).rows[0];}
async function ledgerCount(db){await admin(db,'select 1');return Number((await db.query('select count(*) n from public.ledger_entries')).rows[0].n);}
(async()=>{const db=new PGlite();try{
 await db.exec(schema+helper('finance_correction_role_v1')+helper('finance_correction_actor_v1'));
 for(const [id,role] of [['accountant','accountant'],['ceo','ceo'],['director','admin_director'],['employee','employee']]){
  await db.query('insert into public.finance_users values($1,$2,$3,$1,$4,$5,true)',[id,tenant,auth[id],id+'@invalid',role]);
  await db.query('insert into public.employee_department_roles values($1,$2,$3,true,true,current_date-1,null)',[tenant,id,role]);
 }
 // Rehearsal must prove all candidate DDL can be rolled back, not leave tables.
 await db.exec('begin;'+sql+'\nrollback;');
 check('Rollback rehearsal removes new RPC and operation table',(await db.query("select to_regprocedure('public.finance_invoice_receipt_action_v1(text[],text,text,jsonb,text,jsonb,text)') is null and to_regclass('private.finance_receipt_operations_v1') is null ok")).rows[0].ok);
 await db.exec('begin;'+sql+'\ncommit;');
 check('New receipt RPC ACL only authenticated',(await db.query("select has_function_privilege('authenticated','public.finance_invoice_receipt_action_v1(text[],text,text,jsonb,text,jsonb,text)','EXECUTE') and not has_function_privilege('anon','public.finance_invoice_receipt_action_v1(text[],text,text,jsonb,text,jsonb,text)','EXECUTE') and not has_function_privilege('service_role','public.finance_invoice_receipt_action_v1(text[],text,text,jsonb,text,jsonb,text)','EXECUTE') ok")).rows[0].ok);
 await fixture(db,'one');const files=await proof(db,'one');
 for(const actor of ['employee','director','ceo'])await deny(actor+' cannot submit proof',()=>call(db,actor,['one'],'submit',{one:1},{files}));
 for(const actor of ['employee','director','accountant'])await deny(actor+' cannot approve receipt',()=>call(db,actor,['one'],'approve',{one:1}));
 await deny('Unauthenticated actor denied',()=>call(db,'none',['one'],'submit',{one:1},{files}));
 await deny('Wrong environment denied',()=>call(db,'accountant',['one'],'submit',{one:1},{files,environment:'production'}));
 await deny('Duplicate physical proof rejected',()=>call(db,'accountant',['one'],'submit',{one:1},{files:files.concat(files)}));
 await deny('Missing receipt proof denied',()=>call(db,'accountant',['one'],'submit',{one:1}));
 await deny('Wrong content version denied',()=>call(db,'accountant',['one'],'submit',{one:2},{files}));
 await deny('Missing content version denied',()=>call(db,'accountant',['one'],'submit',{}, {files}));
 await deny('Duplicate batch IDs denied',()=>call(db,'accountant',['one','one'],'submit',{one:1},{files}));
 await deny('Malformed extra version denied',()=>call(db,'accountant',['one'],'submit',{one:1,other:1},{files}));
 await admin(db,"update public.employee_department_roles set effective_to=current_date-1 where finance_user_id='accountant'");
 await deny('Expired role cannot submit',()=>call(db,'accountant',['one'],'submit',{one:1},{files}));
 await admin(db,"update public.employee_department_roles set effective_to=null where finance_user_id='accountant';update public.finance_users set active=false where id='accountant'");
 await deny('Inactive account cannot submit',()=>call(db,'accountant',['one'],'submit',{one:1},{files}));
 await admin(db,"update public.finance_users set active=true where id='accountant';set audit.can_read='false'");
 await deny('Read permission denied',()=>call(db,'accountant',['one'],'submit',{one:1},{files}));
 await admin(db,"set audit.can_read='true';update storage.objects set owner_id='wrong' where name='anonymous/one'");
 await deny('Storage owner mismatch denied',()=>call(db,'accountant',['one'],'submit',{one:1},{files}));
 await admin(db,'update storage.objects set owner_id=$1 where name=$2',[auth.accountant,'anonymous/one']);
 const good=await call(db,'accountant',['one'],'submit',{one:1},{files,key:'stable_receipt_submit'});
 check('Proof and pending status committed together',good.ok&&(await row(db,'one')).status==='pending_receipt_review');
 check('Same submit retry replays original result',(await call(db,'accountant',['one'],'submit',{one:1},{files,key:'stable_receipt_submit'})).idempotent_replay);
 await deny('Same key with different payload rejected',()=>call(db,'accountant',['one'],'submit',{one:1},{files,key:'stable_receipt_submit',note:'changed'}));
 await as(db,'ceo');await deny('Direct REST approval denied',()=>db.exec("update public.invoices set status='paid',paid_at=now() where id='one'"));
 await as(db,'accountant');await deny('Direct proof replacement denied',()=>db.exec("update public.invoices set receipt_files='[]' where id='one'"));
 await deny('Pending reviewed principal is immutable',()=>db.exec("update public.invoices set total=999 where id='one'"));
 await deny('Pending invoice cannot be deleted',()=>db.exec("delete from public.invoices where id='one'"));
 await deny('Insert cannot forge paid',()=>db.query('insert into public.invoices(id,tenant_id,data_environment,status) values($1,$2,$3,$4)',['forged',tenant,'test','paid']));
 await deny('Public legacy receipt RPC is safe blocked',()=>db.query('select public.post_invoice_cash_receipt($1)', ['one']));
 await deny('Direct receipt ledger bypass denied',()=>db.query("insert into public.ledger_entries(tenant_id,data_environment,source_id,posting_key) values($1,'test','one','invoice:one:receipt:bank')",[tenant]));
 await admin(db,"set app.finance_receipt_operation='forged_key';set app.finance_receipt_actor='ceo'");
 await as(db,'ceo');await deny('Caller GUC cannot forge private capability',()=>db.exec("update public.invoices set status='paid' where id='one'"));
 await admin(db,"set audit.closed='true'");await deny('Closed period rejects whole posting',()=>call(db,'ceo',['one'],'approve',{one:2}));
 check('Closed period leaves no ledger or paid status',(await ledgerCount(db))===0&&(await row(db,'one')).status==='pending_receipt_review');
 await admin(db,"set audit.closed='false'");
 const approved=await call(db,'ceo',['one'],'approve',{one:2},{key:'stable_receipt_approve'}),paid=await row(db,'one');
 check('CEO approval writes cash pair and final source atomically',approved.ok&&paid.status==='paid'&&paid.cash_receipt_posted_at&&paid.steps[2].a==='approved'&&await ledgerCount(db)===2);
 const replay=await call(db,'ceo',['one'],'approve',{one:2},{key:'stable_receipt_approve'});check('Approved retry creates no duplicate ledger',replay.idempotent_replay&&await ledgerCount(db)===2);
 await deny('Fresh key cannot post already paid again',()=>call(db,'ceo',['one'],'approve',{one:Number(paid.row_version)}));
 await as(db,'ceo');await deny('Paid invoice approval chain cannot reopen',()=>db.exec("update public.invoices set approval_status='pending_approval' where id='one'"));
 await as(db,'ceo');await deny('Paid invoice cannot reopen unpaid',()=>db.exec("update public.invoices set status='unpaid' where id='one'"));
 // Real transaction late failure: first row writes status+ledger before the
 // second row's injected revenue failure. PostgreSQL must undo all of it.
 for(const id of ['batch_a','batch_b']){await fixture(db,id,{batch_id:'batch_pair'});}
 const batchFiles=await proof(db,'batch_a',{record_no:'整批 pair'});
 await call(db,'accountant',['batch_a','batch_b'],'submit',{batch_a:1,batch_b:1},{files:batchFiles});
 await admin(db,"set audit.revenue_fail='batch_b'");
 await deny('Late second-row posting failure aborts whole batch',()=>call(db,'ceo',['batch_a','batch_b'],'approve',{batch_a:2,batch_b:2},{key:'atomic_late_failure'}));
 check('Late failure leaves both statuses and proof versions unchanged',(await row(db,'batch_a')).status==='pending_receipt_review'&&(await row(db,'batch_a')).row_version===2&&(await row(db,'batch_b')).row_version===2&&await ledgerCount(db)===2);
 check('Failed operation has no cached success',(await db.query("select count(*) n from private.finance_receipt_operations_v1 where operation_key='atomic_late_failure'")).rows[0].n===0);
 await admin(db,"set audit.revenue_fail=''");
 await deny('A stale second row cannot partially return first',()=>call(db,'ceo',['batch_a','batch_b'],'return',{batch_a:2,batch_b:3}));
 check('Stale batch return is all-or-nothing',(await row(db,'batch_a')).status==='pending_receipt_review');
 const returned=await call(db,'ceo',['batch_a','batch_b'],'return',{batch_a:2,batch_b:2});
 check('CEO returns entire batch with reason and old proof retained',returned.count===2&&(await row(db,'batch_a')).status==='unpaid'&&(await row(db,'batch_b')).receipt_files.length===1);
 // Legacy grouped rows without a canonical batch use independent attachment
 // bindings, still commit via one RPC with a per-invoice proof map.
 for(const id of ['legacy_a','legacy_b'])await fixture(db,id);
 const mapFiles={legacy_a:await proof(db,'legacy_a'),legacy_b:await proof(db,'legacy_b')};
 check('Legacy grouped proof mapping commits atomically',(await call(db,'accountant',['legacy_a','legacy_b'],'submit',{legacy_a:1,legacy_b:1},{files:mapFiles})).count===2);
 await fixture(db,'incomplete',{steps:[{rk:'accountant_invoice',a:''}]});
 await deny('Missing accountant approval denied',async()=>call(db,'accountant',['incomplete'],'submit',{incomplete:1},{files:await proof(db,'incomplete')}));
 await fixture(db,'tenant_other',{tenant_id:otherTenant});
 await deny('Cross-tenant source denied',()=>call(db,'accountant',['tenant_other'],'submit',{tenant_other:1},{files}));
 await fixture(db,'env_same',{no:'one',data_environment:'production'});const envFiles=await proof(db,'env_same',{record_no:'one',data_environment:'production'});
 await call(db,'accountant',['env_same'],'submit',{env_same:1},{files:envFiles,environment:'production'});
 check('Same invoice number in another environment posts without collision',(await call(db,'ceo',['env_same'],'approve',{env_same:2},{environment:'production'})).ok&&await ledgerCount(db)===4);
 await fixture(db,'stranger_file');const strangerFile=await proof(db,'stranger_file',{uploaded_by:'employee'});
 await deny('Another uploader proof cannot be claimed',()=>call(db,'accountant',['stranger_file'],'submit',{stranger_file:1},{files:strangerFile}));
 console.log('PASS: '+count+' receipt PostgreSQL authorization/atomicity/rollback checks (isolated fixtures; no live writes)');
 }finally{await db.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
