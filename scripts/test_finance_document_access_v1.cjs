'use strict';
// Actual SQL, actual Google identity helpers and authenticated RLS; fictional data only.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
const {createStatementSourceFixture,asActor}=require('./fixtures/finance_statement_source_fixture.cjs');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const baseline=JSON.parse(read('scripts/fixtures/finance_document_access_baseline_20260922.json'));
const migration=read('supabase/migrations/20260922133752_finance_document_identity_attachment_scope_v1.sql');
const db=new PGlite();let checks=0;const eq=(actual,expected,msg)=>{assert.deepEqual(actual,expected,msg);checks++;};
const fn=(source,name)=>{const m=source.match(new RegExp('create (?:or replace )?function '+name.replaceAll('.','\\.')+'\\([\\s\\S]*?\\$(?:function|fn)?\\$;','i'));assert(m,name);return m[0];};
(async()=>{
const f=await createStatementSourceFixture(db,{install:false,seed:false});
await db.exec(`create schema private;create schema storage;create schema finance_hr_private;
grant usage on schema storage,finance_hr_private to authenticated;
alter table finance_users add org_source text default 'fictional_seed',add entity_id text default 'E1';
create table system_settings(tenant_id uuid,key text,value jsonb);
create table employee_department_roles(tenant_id uuid,finance_user_id text,department_code text,active boolean,can_approve boolean,effective_from date,effective_to date);
create table vouchers(id text primary key,no text,request_id text,entity_id text,tenant_id uuid,data_environment text);
create table file_attachments(id uuid primary key,bucket_id text,tenant_id uuid,attachment_state text,uploaded_by text,storage_path text,record_type text,record_no text,data_environment text default 'production',claim_key text);
create function storage.foldername(text) returns text[] language sql immutable as $$select (string_to_array($1,'/'))[1:array_length(string_to_array($1,'/'),1)-1]$$;
create table storage.objects(id uuid,bucket_id text,name text,owner_id text);
create table finance_hr_private.finance_hr_postings(tenant_id uuid,obligation_id uuid,voucher_id text,entity_id text);
create table finance_hr_private.finance_hr_obligations(obligation_id uuid,tenant_id uuid,source_employer_id uuid);
create table finance_hr_private.finance_hr_salary_readers(tenant_id uuid,source_employer_id uuid,finance_user_id text,revoked_at timestamptz,verified_at timestamptz,effective_from timestamptz,effective_until timestamptz);
create function public.finance_user_has_verified_google_identity(uuid,text) returns boolean language plpgsql as $$begin raise exception 'unexpected non-fixture organization source';end$$;
`);
for(const t of ['expense_requests','invoices','bills'])await db.exec(`alter table ${t} add no text,add batch_id text,add status text default 'returned',add note text,add entity_id text default 'E1';`);
await db.exec('set check_function_bodies=off');
await db.exec("alter table expense_requests add actual_files jsonb default '[]';alter table invoices add receipt_files jsonb default '[]';");
const writeScope=JSON.parse(read('scripts/fixtures/finance_attachment_write_scope_20260922.json'));
await db.exec("alter table file_attachments add staged_at timestamptz,add claimed_at timestamptz;");
for(const b of writeScope.functions)await db.exec(b.definition);
for(const b of baseline)await db.exec(b.definition);
// Actual HR reader, complete company scope and attachment restrictions, not stubs.
const hr1=read('supabase/migrations/20260922072109_finance_hr_private_bridge_v1.sql'),hr2=read('supabase/migrations/20260922075604_finance_hr_voucher_posting_v1.sql');
for(const [source,name] of [[hr1,'finance_hr_private.finance_hr_reader'],[hr2,'finance_hr_private.finance_hr_accounting_scope'],[hr2,'public.finance_hr_accounting_scope'],[hr2,'finance_hr_private.finance_hr_attachment_scope'],[hr2,'public.finance_hr_attachment_scope']])await db.exec(fn(source,name));
await db.exec(`revoke all on all functions in schema finance_hr_private from public;grant execute on function finance_hr_private.finance_hr_attachment_scope(uuid,text,text,text),finance_hr_private.finance_hr_accounting_scope(uuid,text,text) to authenticated;
alter table file_attachments enable row level security;alter table storage.objects enable row level security;alter table vouchers enable row level security;
grant select on file_attachments,storage.objects,vouchers to authenticated;
create policy file_attachments_select_verified_tenant_v2 on file_attachments for select to authenticated using(public.can_read_finance_attachment(file_attachments.*));
create policy finance_attachments_select_verified_tenant_metadata_v2 on storage.objects for select to authenticated using(bucket_id='finance-attachments' and nullif(current_finance_user_id(),'') is not null and nullif(finance_current_verified_google_email_v2(),'') is not null and exists(select 1 from file_attachments attachment where attachment.bucket_id=objects.bucket_id and attachment.storage_path=objects.name and attachment.tenant_id=current_tenant_id() and can_read_finance_attachment(attachment.*)));
grant insert,delete on file_attachments to authenticated;
create policy file_attachments_insert_verified_google_v2 on file_attachments for insert to authenticated with check(finance_can_insert_attachment_metadata_v2(file_attachments.*));
create policy file_attachments_delete_verified_uploader_cleanup_v2 on file_attachments for delete to authenticated using(tenant_id=current_tenant_id() and nullif(current_finance_user_id(),'') is not null and nullif(finance_current_verified_google_email_v2(),'') is not null and uploaded_by=current_finance_user_id() and attachment_state='staged');
create policy hr_salary_attachment_scope on file_attachments as restrictive for select to authenticated using(public.finance_hr_attachment_scope(tenant_id,record_type,record_no,data_environment));
create policy vouchers_read on vouchers for select to authenticated using(tenant_id=current_tenant_id() and is_finance_accounting());
create policy hr_salary_complete_scope on vouchers as restrictive for select to authenticated using(public.finance_hr_accounting_scope(tenant_id,entity_id,data_environment));`);
// Original authority is sealed; fixture preserves production function ACLs.
for(const b of baseline){const sig=b.schema+'.'+b.name+'('+b.args.split(',').filter(Boolean).map(x=>x.trim().split(' ').slice(1).join(' ')).join(',')+')';await db.exec(`revoke all on function ${sig} from public,anon,authenticated,service_role;`);if(b.proacl.includes('authenticated='))await db.exec(`grant execute on function ${sig} to authenticated`);if(b.proacl.includes('service_role='))await db.exec(`grant execute on function ${sig} to service_role`);}
await db.exec(fn(read('supabase/migrations/20260907154759_finance_org_integrity_v2.sql'),'private.finance_org_effective_now_v2'));
// Legacy snapshot precedes migration; later client JSON edits must not add links.
await db.query("insert into invoices(id,tenant_id,applicant_id,batch_id,receipt_files) values('legacy-a',$1,$2,'old-batch',$3),('legacy-b',$1,$2,'old-batch',$3)",[f.tenant,f.actors.employee.id,[{storagePath:'synthetic/13.pdf'}]]);
await db.query("insert into expense_requests(id,tenant_id,applicant_id,form_payload) values('legacy-expense',$1,$2,$3)",[f.tenant,f.actors.employee.id,{attachments:[{storage_path:'synthetic/14.pdf'}]}]);
for(const [i,type] of [[13,'invoices'],[14,'expense_requests']]){
 const id='20000000-0000-0000-0000-'+String(i).padStart(12,'0');await db.query("insert into file_attachments(id,bucket_id,tenant_id,attachment_state,uploaded_by,storage_path,record_type,record_no,data_environment) values($1,'finance-attachments',$2,'claimed','other-person',$3,$4,'legacy-missing-key','production')",[id,f.tenant,'synthetic/'+i+'.pdf',type]);await db.query("insert into storage.objects(id,bucket_id,name) values($1,'finance-attachments',$2)",[id,'synthetic/'+i+'.pdf']);
}

for(const b of JSON.parse(read('scripts/fixtures/finance_attachment_claim_dependencies_20260922.json')))await db.exec(b.definition);
const employee=f.actors.employee;
await db.query('insert into finance_users(id,tenant_id,name,email,active) values($1,$2,$3,$4,true)',['other-person',f.tenant,employee.name,'other@example.invalid']);
const rows=[
 ['own',{applicant_id:employee.id}],
 ['canonical-conflict',{applicant_id:employee.id,form_payload:{applicantProfile:{id:'other-person'}}}],
 ['impostor-name',{applicant_id:'other-person',applicant:employee.name,applicant_email:employee.email,form_payload:{applicantProfile:{id:'other-person',email:employee.email}}}],
 ['profile-conflict',{applicant_id:'other-person',form_payload:{applicantProfile:{id:employee.id}}}],
 ['step-id',{steps:[{uid:employee.id,n:'Old name'}]}],
 ['step-impostor',{steps:[{uid:'other-person',n:employee.name,email:employee.email}]}],
 ['step-label',{steps:[{uid:'other-person',r:employee.name+' approval'}]}],
 ['action-id',{steps:[{uid:'other-person',actions:[{actorId:employee.id,name:'Old name'}]}]}],
 ['action-impostor',{steps:[{uid:'other-person',actions:[{actorId:'other-person',name:employee.name}]}]}],
 ['role-explicit',{steps:[{uid:'other-person',rk:'dept_manager'}]}],
 ['role-queue',{steps:[{rk:'external_audit'}]}],
 ['department-queue',{steps:[{rk:'dept_manager'}]}],
 ['department-own',{department_code:'D1',steps:[{rk:'dept_manager'}]}],
 ['legacy-ambiguous',{applicant:employee.name}],
 ['foreign',{tenant_id:f.otherTenant,applicant_id:employee.id}],
 ['email-legacy',{applicant_email:employee.email,form_payload:{applicantProfile:{email:employee.email}}}],
 ['malformed',{steps:{uid:employee.id}}]
];
for(const table of ['expense_requests','bills','invoices'])for(const [id,patch]of rows){const row={id,tenant_id:f.tenant,department_code:'D2',no:id+'-NO',...patch};const keys=Object.keys(row);await db.query(`insert into ${table}(${keys.join(',')}) values(${keys.map((_,i)=>'$'+(i+1))})`,keys.map(k=>typeof row[k]==='object'?JSON.stringify(row[k]):row[k]));}
async function attachment(id,recordType,recordNo,{owner='other-person',tenant=f.tenant,state='claimed',environment='production'}={}){const uuid='20000000-0000-0000-0000-'+String(id).padStart(12,'0'),storagePath='synthetic/'+id+'.pdf';await db.query('insert into file_attachments(id,bucket_id,tenant_id,attachment_state,uploaded_by,storage_path,record_type,record_no,data_environment) values($1,$2,$3,$4,$5,$6,$7,$8,$9)',[uuid,'finance-attachments',tenant,state,owner,storagePath,recordType,recordNo,environment]);await db.query('insert into storage.objects(id,bucket_id,name) values($1,$2,$3)',[uuid,'finance-attachments',storagePath]);return storagePath;}
await attachment(1,'invoices','impostor-name');await attachment(2,'invoices','own');await attachment(3,'expense_requests','own-NO');await attachment(4,'invoices','own',{tenant:f.otherTenant});await attachment(5,'invoices','own',{environment:'test'});await attachment(6,'storage_orphans','orphan');await attachment(7,'draft_requests','draft',{state:'staged',owner:employee.id});await attachment(8,'draft_requests','draft',{state:'staged'});await attachment(9,'invoices','missing');
await db.query("update invoices set batch_id='BATCH' where id='own'");await attachment(10,'invoices','BATCH');await db.query("update bills set note='{"+'"batchNo":"BATCH-DISPLAY"'+"}' where id='own'");await attachment(11,'bills','BATCH-DISPLAY');


await attachment(15,'invoices','legacy-denied');await db.query("update invoices set receipt_files=$1 where id='impostor-name'",[[{path:'synthetic/15.pdf'}]]);
await db.query("insert into invoices(id,no,batch_id,tenant_id,applicant_id,department_code,entity_id) values('collision-a','COL-A','COLLISION',$1,'other-person','D2','E1'),('collision-b','COL-B','COLLISION',$1,'other-person','D2','E2')",[f.tenant]);await attachment(16,'invoices','COLLISION');
await db.exec('set check_function_bodies=on');await db.exec('begin;\n'+migration+'\ncommit;');
async function ids(table,actor=employee){return asActor(db,actor,async()=>(await db.query(`select id from ${table} order by id`)).rows.map(x=>x.id));}
for(const table of ['expense_requests','bills','invoices'])eq(await ids(table),['action-id','canonical-conflict',...(table==='invoices'?[]:['email-legacy']),'own','step-id',...(table==='invoices'?['legacy-a','legacy-b']:table==='expense_requests'?['legacy-expense']:[])].sort(),table+' denies same names, explicit different IDs and cross tenant');
for(const table of ['expense_requests','bills','invoices']){const visible=await ids(table,f.actors.dept_manager);eq(visible.includes('role-explicit'),false,'same role explicit other assignee denied');eq(visible.includes('department-queue'),false,'role queue outside department denied');eq(visible.includes('department-own'),true,'own department retained');eq((await ids(table,f.actors.external_audit)).includes('role-queue'),false,'unassigned shared queue outside department denied');}
for(const role of ['employee','external_audit','general_affairs']){
 for(const [id,entity] of [['queue-local-'+role,'E1'],['queue-foreign-'+role,'E2']])await db.query("insert into invoices(id,tenant_id,department_code,entity_id,steps) values($1,$2,'D1',$3,$4)",[id,f.tenant,entity,[{rk:role}]]);
 const visible=await ids('invoices',f.actors[role]);eq(visible.includes('queue-local-'+role),true,'local unassigned role queue');eq(visible.includes('queue-foreign-'+role),false,'same department unassigned role does not cross company');
}
for(const actor of [f.actors.inactive,f.actors.unverified])eq(await ids('expense_requests',actor),[],'inactive or unverified fail closed');
await asActor(db,f.actors.external_audit,async()=>{
 const by=f.actors.external_audit.name;
 eq((await db.query('select public.json_steps_include_current_user($1) v',[[{uid:'other-person',a:'approved',by}]])).rows[0].v,true,'unique historical actual actor preserved separately from assignee');
 eq((await db.query('select public.json_steps_include_current_user($1) v',[[{uid:'other-person',a:'pending',by}]])).rows[0].v,false,'pending actor-name hints do not grant history');
 eq((await db.query('select public.json_steps_include_current_user($1) v',[[{uid:'other-person',a:'approved',byId:'other-person',by}]])).rows[0].v,false,'explicit actual actor ID overrides historical actor label');
});
await db.exec("update finance_users set name='Unique Legacy' where id='fictional-employee'");
for(const table of ['expense_requests','bills','invoices'])await db.query(`insert into ${table}(id,tenant_id,applicant) values('legacy-unique',$1,'Unique Legacy')`,[f.tenant]);
for(const table of ['expense_requests','bills','invoices'])eq((await ids(table)).includes('legacy-unique'),true,'unique legacy owner preserved');
await db.query("insert into finance_users(id,tenant_id,name,active) values('inactive-namesake',$1,'Unique Legacy',false)",[f.tenant]);
eq((await ids('bills')).includes('legacy-unique'),false,'inactive namesake cannot be reassigned by name');
// Direct write helpers narrow authority without replacing workflow mutation guards.
await asActor(db,employee,async()=>{for(const table of ['expense_requests','invoices','bills'])eq((await db.query(`select public.can_update_${table==='expense_requests'?'expense_request':table==='invoices'?'invoice':'bill'}(jsonb_populate_record(null::${table},$1)) v`,[JSON.stringify({tenant_id:f.tenant,applicant_id:'other-person',applicant:employee.name,status:'returned',steps:[{uid:'other-person',rk:'employee'}]})])).rows[0].v,false,'write helper no name/role bypass');});
async function paths(actor,table){return asActor(db,actor,async()=>(await db.query(`select ${table==='file_attachments'?'storage_path':'name'} path from ${table} order by 1`)).rows.map(x=>x.path));}
eq((await db.query("select count(*)::int n from private.finance_legacy_attachment_links_v1 where attachment_id='20000000-0000-0000-0000-000000000016'")).rows[0].n,0,'same batch text across companies is ambiguous and not sealed');
const expected=[2,3,7,10,11,13,14].map(i=>'synthetic/'+i+'.pdf').sort();eq(await paths(employee,'file_attachments'),expected,'parent scopes metadata');eq(await paths(employee,'storage.objects'),expected,'parent scopes Storage with no recursion');
for(const role of ['inactive','unverified'])eq(await paths(f.actors[role],'storage.objects'),[],'bad identity no storage');
// Existing metadata INSERT policy accepts only staged, own Storage objects.
// Claimed rows cannot be re-keyed or forged by an authenticated caller.
const safePath=f.tenant+'/invoices/production/2026/09/22/fixture/own/proof.pdf';
await db.query("insert into storage.objects(id,bucket_id,name,owner_id) values(gen_random_uuid(),'finance-attachments',$1,$2)",[safePath,employee.uid]);
await asActor(db,employee,async()=>{
 await db.query("insert into file_attachments(id,bucket_id,tenant_id,attachment_state,uploaded_by,storage_path,record_type,record_no,data_environment,staged_at) values(gen_random_uuid(),'finance-attachments',$1,'staged',$2,$3,'invoices','own','production',now())",[f.tenant,employee.id,safePath]);checks++;
});
await assert.rejects(()=>asActor(db,employee,()=>db.query("update file_attachments set record_no='own' where storage_path='synthetic/1.pdf'")),/permission denied/);checks++;
await assert.rejects(()=>asActor(db,employee,()=>db.query("insert into file_attachments(id,bucket_id,tenant_id,attachment_state,uploaded_by,storage_path,record_type,record_no,data_environment,staged_at) values(gen_random_uuid(),'finance-attachments',$1,'claimed',$2,$3,'invoices','own','production',now())",[f.tenant,employee.id,safePath])),/row-level security/);checks++;
await asActor(db,employee,async()=>eq((await db.query("delete from file_attachments where storage_path='synthetic/2.pdf' returning id")).rows.length,0,'claimed attachments cannot be deleted'));
for(const [table,helper] of [['expense_requests','expense_request'],['invoices','invoice'],['bills','bill']])await db.exec(`grant update on ${table} to authenticated;create policy write_fixture on ${table} for update to authenticated using(tenant_id=current_tenant_id() and public.can_update_${helper}(${table}.*)) with check(tenant_id=current_tenant_id() and public.can_read_${helper}(${table}.*));`);
// Adversarial applicant edits: copying a victim path cannot create a sealed link,
// and cannot bypass an unreadable canonical parent.
await asActor(db,employee,async()=>{eq((await db.query("update invoices set receipt_files=$1 where id='own' returning id",[[{path:'synthetic/1.pdf'},{path:'synthetic/15.pdf'}]])).rows.length,1,'owner can update their own parent through authenticated RLS');eq((await db.query("select count(*)::int n from storage.objects where name in('synthetic/1.pdf','synthetic/15.pdf')")).rows[0].n,0,'forged paths rejected in same caller transaction');});
eq((await paths(employee,'storage.objects')).includes('synthetic/1.pdf'),false,'forged path does not override canonical victim parent');
eq((await paths(employee,'storage.objects')).includes('synthetic/15.pdf'),false,'forged path does not create missing legacy authorization');
await db.exec("update invoices set receipt_files='[]' where id in('legacy-a','legacy-b')");
eq((await paths(employee,'storage.objects')).includes('synthetic/13.pdf'),true,'sealed authorized historical batch survives later archival edits');
await assert.rejects(()=>asActor(db,employee,()=>db.exec('insert into private.finance_legacy_attachment_links_v1(attachment_id) values(gen_random_uuid())')),/permission denied/);checks++;
await assert.rejects(()=>db.exec("update private.finance_legacy_attachment_links_v1 set parent_key='own'"),/immutable/);checks++;
await asActor(db,employee,async()=>{
 eq((await db.query("update invoices set batch_id='impostor-name' where id='own' returning id")).rows.length,1,'owned invoice alias edit is permitted by base fixture');
 eq((await db.query("select count(*)::int n from storage.objects where name='synthetic/1.pdf'")).rows[0].n,0,'changing batch alias cannot steal a claimed attachment');
 eq((await db.query("update bills set note='{\"batchNo\":\"impostor-name\"}' where id='own' returning id")).rows.length,1,'owned bill note edit');
 eq((await db.query("select count(*)::int n from storage.objects where name='synthetic/1.pdf'")).rows[0].n,0,'bill note alias cannot change parent association');
});
// Exercise the real promotion trigger with actual Google identity and Storage
// ownership: caller-selected temporary upload record numbers become canonical.
for(const table of ['expense_requests','invoices','bills','vouchers'])await db.exec(`create trigger attachment_claim after insert or update on ${table} for each row execute function private.finance_claim_attachment_metadata_v2()`);
await db.exec("grant insert on invoices to authenticated;create policy insert_owner on invoices for insert to authenticated with check(applicant_id=current_finance_user_id() and tenant_id=current_tenant_id())");
let serial=30;
async function upload(actor,type='invoices'){
 const n=serial++,id='40000000-0000-0000-0000-'+String(n).padStart(12,'0'),path=f.tenant+'/'+type+'/production/2026/09/22/fixture/TEMP-'+n+'/upload/proof.pdf';
 await db.query("insert into storage.objects(id,bucket_id,name,owner_id) values($1,'finance-attachments',$2,$3)",[id,path,actor.uid]);
 return {id,path,no:'TEMP-'+n};
}
async function stage(u,actor){await db.query("insert into file_attachments(id,bucket_id,tenant_id,attachment_state,uploaded_by,storage_path,record_type,record_no,data_environment,staged_at) values($1,'finance-attachments',$2,'staged',$3,$4,'invoices',$5,'production',now())",[u.id,f.tenant,actor.id,u.path,u.no]);}
const mine=await upload(employee);
await asActor(db,employee,async()=>{
 await stage(mine,employee);
 await db.query("insert into invoices(id,no,batch_id,tenant_id,applicant_id,entity_id,department_code,receipt_files) values('claim-a','CLAIM-A','FRESH-BATCH',$1,$2,'E1','D1',$3)",[f.tenant,employee.id,[{path:mine.path}]]);
 let state=(await db.query('select attachment_state,record_no from file_attachments where id=$1',[mine.id])).rows[0];eq(state,{attachment_state:'claimed',record_no:'FRESH-BATCH'},'temporary upload id safely promoted to actual batch');
 eq((await db.query('select count(*)::int n from storage.objects where name=$1',[mine.path])).rows[0].n,1,'newly claimed proof accessible');
 await db.query("insert into invoices(id,no,batch_id,tenant_id,applicant_id,entity_id,department_code,receipt_files) values('claim-b','CLAIM-B','FRESH-BATCH',$1,$2,'E1','D1',$3)",[f.tenant,employee.id,[{path:mine.path}]]);
 eq((await db.query("select count(*)::int n from finance_attachment_private.parent_links_v1($1,'invoices','FRESH-BATCH',$2,'production')",[mine.id,mine.path])).rows[0].n,2,'one proof binds both legitimate batch internal IDs');
 await db.exec('savepoint wrong_scope');await assert.rejects(()=>db.query("insert into invoices(id,no,batch_id,tenant_id,applicant_id,entity_id,department_code,receipt_files) values('claim-cross','CLAIM-CROSS','FRESH-BATCH',$1,$2,'E2','D2',$3)",[f.tenant,employee.id,[{path:mine.path}]]),/授权|授權綁定/);checks++;await db.exec('rollback to savepoint wrong_scope');
 await db.exec('savepoint victim');await assert.rejects(()=>db.query("update invoices set receipt_files=$1 where id='own'",[[{path:'synthetic/1.pdf'}]]),/授權綁定/);checks++;await db.exec('rollback to savepoint victim');
});
const accountantUpload=await upload(f.actors.accountant);
await asActor(db,f.actors.accountant,async()=>{
 await stage(accountantUpload,f.actors.accountant);
 await db.query("update invoices set receipt_files=$1 where id='impostor-name'",[[{path:accountantUpload.path}]]);
 eq((await db.query('select attachment_state from file_attachments where id=$1',[accountantUpload.id])).rows[0].attachment_state,'claimed','accountant may upload proof for another applicant');
});
const foreignUpload=await upload(f.actors.accountant);
await asActor(db,f.actors.accountant,async()=>{await stage(foreignUpload,f.actors.accountant);});
// It was rolled back, so seed an owned staged row without borrowing any session.
await db.query("insert into file_attachments(id,bucket_id,tenant_id,attachment_state,uploaded_by,storage_path,record_type,record_no,data_environment,staged_at) values($1,'finance-attachments',$2,'staged',$3,$4,'invoices',$5,'production',now())",[foreignUpload.id,f.tenant,f.actors.accountant.id,foreignUpload.path,foreignUpload.no]);
await assert.rejects(()=>asActor(db,employee,()=>db.query("update invoices set receipt_files=$1 where id='own'",[[{path:foreignUpload.path}]])),/附件尚未依正式單號完成綁定/);checks++;
// Real HR restrictive guard: accounting privilege alone is insufficient.
const obligation='30000000-0000-0000-0000-000000000001',employer='30000000-0000-0000-0000-000000000002';
await db.query("insert into vouchers values('HRV-1','HRV-1','hr:1','E1',$1,'production')",[f.tenant]);await db.query("insert into finance_hr_private.finance_hr_postings values($1,$2,'HRV-1','E1')",[f.tenant,obligation]);await db.query('insert into finance_hr_private.finance_hr_obligations values($1,$2,$3)',[obligation,f.tenant,employer]);await db.query("insert into finance_hr_private.finance_hr_salary_readers values($1,$2,$3,null,now(),now(),null)",[f.tenant,employer,f.actors.accountant.id]);await attachment(12,'vouchers','HRV-1');
await db.query("insert into private.finance_legacy_attachment_links_v1(attachment_id,tenant_id,data_environment,record_type,original_record_no,storage_path,parent_kind,parent_key,source_reference_count,source_scope,source_fingerprint) values('20000000-0000-0000-0000-000000000012',$1,'production','vouchers','HRV-1','synthetic/12.pdf','id','HRV-1',1,'{}','fixture')",[f.tenant]);
await assert.rejects(()=>paths(f.actors.admin_director,'file_attachments'),/COMPLETE_REPORT_AUTHORIZATION_REQUIRED/);checks++;
await assert.rejects(()=>paths(f.actors.admin_director,'storage.objects'),/COMPLETE_REPORT_AUTHORIZATION_REQUIRED/);checks++;
eq((await paths(f.actors.accountant,'storage.objects')).includes('synthetic/12.pdf'),true,'verified HR accountant reads salary attachment');
await db.exec('begin');await assert.rejects(()=>db.exec("update invoices set id='renamed-archive' where id='legacy-a'"),/內部識別碼不可修改/);checks++;await db.exec('rollback');
await db.exec('begin');await db.exec("delete from invoices where id='legacy-a'");await assert.rejects(()=>db.query("insert into invoices(id,tenant_id,applicant_id) values('legacy-a',$1,$2)",[f.tenant,employee.id]),/識別碼不可重複使用/);checks++;await db.exec('rollback');
await db.query("insert into invoices(id,tenant_id,applicant_id) values('legacy-a',$1,$2) on conflict(id) do update set no=invoices.no",[f.tenant,employee.id]);checks++;
// ORG-01: capability in D2 must not authorize a disallowed D1 appointment.
for(const id of ['permanent','acting']){await db.query("insert into finance_users(id,tenant_id,name,active,auth_user_id,org_source) values($1,$2,$1,true,$3,'fictional_seed')",[id,f.tenant,f.actors.dept_manager.uid]);await db.query("insert into employee_department_roles values($1,$2,'D2',true,true,null,null)",[f.tenant,id]);}
const units=[{id:'dept',code:'D1',name:'Department',unit_type:'department',active:true,entity_scope_mode:'explicit',entity_codes:['E1']},{id:'child',code:'D1A',name:'Section',unit_type:'section',parent_org_unit_id:'dept',active:true}];
const assignments=[{org_unit_id:'dept',finance_user_id:'permanent',head_kind:'permanent',active:true,can_approve:false},{org_unit_id:'dept',finance_user_id:'acting',head_kind:'acting',active:true,can_approve:true}];
async function project(a=assignments){return(await db.query('select private.finance_membership_org_departments_v1($1,$2) v',[f.tenant,{units,assignments:a}])).rows[0].v;}
let projection=await project();eq(projection.find(x=>x.c==='D1').managerId,'acting','secondary capability cannot bypass target can_approve=false');eq(projection.find(x=>x.c==='D1A').directorId,'acting','parent director checks target appointment');
projection=await project(assignments.map(x=>({...x,can_approve:false})));eq(projection.every(x=>!x.managerId&&!x.directorId),true,'no authorized head stays unassigned');
projection=await project(assignments.map(x=>({...x,can_approve:true})));eq(projection.find(x=>x.c==='D1').managerId,'permanent','authorized permanent precedence preserved');
projection=await project(assignments.map(x=>({...x,effective_from:'2099-01-01'})));eq(projection.every(x=>!x.managerId&&!x.directorId),true,'future appointments denied');
const pins=(await db.query("select n.nspname||'.'||p.proname name,pg_get_function_identity_arguments(p.oid) args,md5(p.prosrc) body_md5,p.prosecdef definer,p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where (n.nspname='public' and (p.proname in ('finance_legacy_name_matches_current_v1','finance_identity_matches_current_v1','finance_bill_attachment_batch_no_v1','finance_role_queue_scope_v1','finance_legacy_attachment_parent_v1','finance_attachment_paths_v1','can_read_expense_request','can_read_invoice','can_read_bill','can_update_expense_request','can_update_invoice','is_bill_owner','json_steps_include_current_user','json_steps_role_matches','can_read_finance_attachment'))) or n.nspname='finance_attachment_private' or (n.nspname='private' and p.proname in('finance_membership_org_departments_v1','finance_legacy_attachment_links_immutable_v1','finance_claim_attachment_metadata_v2','finance_attachment_source_identity_v1')) order by 1")).rows;
fs.writeFileSync('/tmp/finance-document-access-pins.json',JSON.stringify(pins,null,2));
/*POSTFLIGHT_START*/const postflight=read('scripts/finance_audit_security_postflight.sql').replace(/^\\set ON_ERROR_STOP on\r?\n/,'');
await db.exec(postflight);checks++;
await db.exec(read('scripts/finance_audit_security_canary.sql'));checks++;
await db.exec('begin');await db.exec("create or replace function public.json_steps_role_matches(steps jsonb) returns boolean language sql stable set search_path='' as $$select true$$");await assert.rejects(()=>db.exec(postflight),/differs from sealed source/);checks++;await db.exec('rollback');
await db.exec('begin');await db.exec('drop policy hr_salary_attachment_scope on file_attachments');await assert.rejects(()=>db.exec(postflight),/Attachment policy differs/);checks++;await db.exec('rollback');
await db.exec('begin');await db.exec('grant update on file_attachments to authenticated');await assert.rejects(()=>db.exec(postflight),/metadata is mutable/);checks++;await db.exec('rollback');
await db.exec('begin');await db.exec('drop index private.finance_attachment_source_identity_lookup_v1');await assert.rejects(()=>db.exec(postflight),/lookup index changed/);checks++;await db.exec('rollback');
await db.exec('begin');await db.exec('grant create on schema finance_attachment_private to authenticated');await assert.rejects(()=>db.exec(postflight),/permits object creation/);checks++;await db.exec('rollback');
/*POSTFLIGHT_END*/console.log('Finance document access: '+checks+' actual SQL/RLS checks passed; fictional identities only.');await db.close();
})().catch(async e=>{console.error(e);await db.close();process.exitCode=1});
