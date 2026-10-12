#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {PGlite}=require('@electric-sql/pglite');
const root=path.resolve(__dirname,'..');
const migration=fs.readFileSync(path.join(root,'supabase/migrations/20261011133833_finance_cloud_submission_v1.sql'),'utf8');
const sources=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/finance_cloud_submission_live_sources_20261011.json'),'utf8'));
const billFixtureSource=fs.readFileSync(path.join(__dirname,'check_bill_batch_bulk_insert_20261008.cjs'),'utf8');
const billFixture=new Function('require','__dirname',billFixtureSource.replace(/^#![^\n]*\n/,'').slice(0,billFixtureSource.replace(/^#![^\n]*\n/,'').indexOf('\nasync function main()'))+'\nreturn fixture;')(require,__dirname);
const tenant='11111111-1111-4111-8111-111111111111',uid='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
let checks=0;
function ok(value,label){assert(value,label);checks++;}
async function code(work,expected){await assert.rejects(work,e=>e.code===expected,expected);checks++;}
function id(n){return `11111111-1111-4111-8111-${String(n).padStart(12,'0')}`;}
function item(n,kind='invoice',changes={}){return {client_item_key:'cloud-item-'+n,entity_id:'entity-1',department_code:'A100',amount:'100.25',steps:[{rk:'applicant_submit',uid:'actor-a',a:'approved',files:[]},{rk:'accountant'}],...(kind==='invoice'?{buyer:'Fictional '+n,tax:'5.00',total:'105.25',invoice_date:'2026-10-11',invoice_identifier_type:'電子發票'}:{item:'Service '+n,payer_name:'Fictional '+n,due_date:'2026-10-20'}),...changes};}
async function fixture(db){
  await billFixture(db);
  await db.exec(`create table public.tenants(id uuid primary key);insert into public.tenants values('${tenant}');
    alter table public.finance_users add column role text default 'employee';
    create function public.current_finance_user() returns public.finance_users language sql stable as $$
      select u from public.finance_users u where u.tenant_id=public.current_tenant_id() and u.auth_user_id=auth.uid() and u.active
        and coalesce(current_setting('test.revoked',true),'')<>'true' limit 1 $$;
    create schema storage;create table storage.objects(bucket_id text,name text,owner_id text,metadata jsonb,primary key(bucket_id,name));
    create table public.file_attachments(tenant_id uuid,data_environment text,record_type text,uploaded_by text,bucket_id text,storage_path text);
    create table private.finance_ar_receipts_v1(id uuid);
    create function public.normalize_invoice_identifier_type(text) returns text language sql immutable as 'select $1';
    create function private.finance_json_contains_attachment_path_v2(p jsonb,v text) returns boolean language sql immutable as $$select position(v in p::text)>0$$;
  `);
  const inv=sources.submit.find(x=>x.signature==='finance_submit_invoice_batch(text,jsonb,text)').definition;
  const columns=inv.match(/insert into public\.invoices\s*\(([\s\S]*?)\)\s*values/)[1].split(',').map(x=>x.trim());
  const types={id:'text primary key',no:'text unique',tenant_id:'uuid',amount:'numeric',tax:'numeric',total:'numeric',approval_step:'int',invoice_date:'date',steps:'jsonb',receipt_files:'jsonb'};
  await db.exec('create table public.invoices('+columns.map(c=>c+' '+(types[c]||'text')).join(',')+');');
  await db.exec(`create function public.invoice_guard() returns trigger language plpgsql as $$begin
    if new.buyer='FINAL_FAIL' then raise exception 'final row rejected' using errcode='23514';end if;return new;end$$;
    create trigger invoice_guard before insert on public.invoices for each row execute function public.invoice_guard();`);
  // Real captured current RPC bodies, including source hashes and capacities.
  await db.exec('drop function private.finance_income_assert_items_with_limit(jsonb,integer)');
  await db.exec(sources.submit.find(x=>x.signature==='private.finance_income_assert_items_with_limit(jsonb,integer)').definition);
  await db.exec('drop function private.finance_income_validate_submission_steps(jsonb,text,uuid)');
  await db.exec(require('./fixtures/finance_cloud_submission_step_validator_20261011.json').definition);
  await db.exec(inv);
  for(const row of sources.limits)await db.exec(row.definition);
  const withdrawal=fs.readFileSync(path.join(root,'supabase/migrations/20261005173534_applicant_withdraw_bill_invoice_v1.sql'),'utf8');
  await db.exec(withdrawal.slice(withdrawal.indexOf('create or replace function public.finance_bill_withdraw_applicant_v1('),withdrawal.indexOf('revoke all on function public.finance_bill_withdraw_applicant_v1(')));
  await db.exec('begin;'+migration+'commit;');
  const postflight=(await db.query(fs.readFileSync(path.join(__dirname,'finance_cloud_submission_postflight.sql'),'utf8'))).rows;
  assert(postflight.length>15&&postflight.every(row=>row.ok),'all readonly postflight assertions pass');
}
async function run(dbOverride){
 const db=dbOverride||new PGlite();const query=async(sql,args)=>(await db.query(sql,args)).rows[0].v;
 const rpc=async(name,args)=>query('select public.'+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') v',args);
 const save=(n,items,kind='invoice',revision=0,files=[])=>rpc('finance_cloud_draft_save_v1',[id(n),revision,kind,{title:'Fictional application',items},files,'production']);
 const read=n=>rpc('finance_cloud_draft_read_v1',[id(n),'production']);
 const begin=(n,count,rev=1)=>rpc('finance_cloud_submission_begin_v1',[id(n),rev,count,'production']);
 const stage=(n,items,start=0,rev=1)=>rpc('finance_cloud_submission_stage_v1',[id(n),rev,start,items,'production']);
 const commit=(n,d,rev=1)=>rpc('finance_cloud_submission_commit_v1',[id(n),rev,d.stagedFingerprint,'production']);
 const count=table=>query('select count(*)::int v from '+table,[]);
 try{
  await fixture(db);let items=[item(1),item(2)],d=await save(1,items);
  ok(d.revision===1&&d.state==='draft','saved');
  const replay=await save(1,items);ok(replay.revision===1&&replay.idempotentReplay,'lost-save replay');
  const list=await rpc('finance_cloud_draft_list_v1',['production',null,null,50]);ok(list.rows.length===1&&!list.rows[0].payload,'owner list minimal');
  await code(()=>save(1,[item(3)],'invoice',0),'PT409');
  await db.exec(`insert into public.finance_users(id,tenant_id,auth_user_id,active,name,email) values('actor-b','${tenant}','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',true,'Synthetic second actor','second@example.invalid')`);
  await db.exec(`select set_config('test.uid','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',false)`);
  await code(()=>read(1),'42501');await code(()=>save(1,items),'42501');
  await db.exec(`select set_config('test.uid','${uid}',false);select set_config('test.tenant','22222222-2222-4222-8222-222222222222',false)`);
  await code(()=>read(1),'42501');
  await db.exec(`select set_config('test.tenant','${tenant}',false);select set_config('test.revoked','true',false)`);
  await code(()=>read(1),'42501');await db.exec(`select set_config('test.revoked','false',false)`);
  await code(()=>rpc('finance_cloud_draft_read_v1',[id(1),'test']),'42501');
  await begin(1,2);await code(()=>stage(1,[item(9)]),'PT409');
  await code(()=>stage(1,null),'22023');
  d=await stage(1,[items[0]]);ok(d.stagedCount===1&&d.state==='staging','first chunk');
  await code(()=>commit(1,d),'PT409');d=await stage(1,[items[0]]);ok(d.stagedCount===1,'same chunk no duplicate');
  d=await stage(1,[items[1]],1);ok(d.state==='ready'&&d.stagedCount===2,'complete ready');
  d=await commit(1,d);ok(d.state==='committed'&&d.result.count===2,'published all rows');
  ok(await count('public.invoices')===2,'official count');
  const again=await commit(1,d);ok(again.idempotentReplay&&await count('public.invoices')===2,'commit replay once');
  await code(()=>rpc('finance_cloud_draft_discard_v1',[id(1),1,'production']),'55000');
  await code(()=>rpc('finance_cloud_draft_reopen_v1',[id(1),1,'production']),'55000');
  const large=Array.from({length:501},(_,i)=>item(1000+i));await save(2,large);await begin(2,large.length);
  for(let i=0;i<large.length;i+=100)d=await stage(2,large.slice(i,i+100),i);
  d=await commit(2,d);ok(d.result.count===501&&new Set(d.result.rows.map(x=>x.batch_id)).size===1,'501 invoice one group');
  const bills=Array.from({length:151},(_,i)=>item(2000+i,'bill'));await save(3,bills,'bill');await begin(3,bills.length);
  for(let i=0;i<bills.length;i+=100)d=await stage(3,bills.slice(i,i+100),i);
  d=await commit(3,d);ok(d.result.count===151&&new Set(d.result.rows.map(x=>x.batch_id)).size===1,'151 bills one group');
  const bad=[item(3000),item(3001,'invoice',{buyer:'FINAL_FAIL'})];await save(4,bad);await begin(4,2);d=await stage(4,bad);
  const before=await count('public.invoices');await code(()=>commit(4,d),'23514');ok(await count('public.invoices')===before&&(await read(4)).state==='ready','failure rolls back all official data retains staging');
  d=await rpc('finance_cloud_draft_reopen_v1',[id(4),1,'production']);ok(d.revision===2&&d.state==='draft'&&d.stagedCount===0,'reopen original to correct');
  const fixed=[item(3000),item(3001)];d=await save(4,fixed,'invoice',2);await begin(4,2,3);d=await stage(4,fixed,0,3);d=await commit(4,d,3);ok(d.state==='committed','corrected draft publishes');
  const duplicated=[item(4000),item(4000)];await save(5,duplicated);await begin(5,2);await code(()=>stage(5,duplicated),'23505');ok((await read(5)).stagedCount===0,'duplicate chunk entirely rejected');
  const mixed=[item(4100),item(4101,'invoice',{department_code:'FORBIDDEN'})];await save(6,mixed);await begin(6,2);await code(()=>stage(6,mixed),'42501');ok((await read(6)).stagedCount===0,'scope rejected atomic chunk');
  const routes=[item(4400),item(4401,'invoice',{steps:[{rk:'applicant_submit',uid:'actor-a',a:'approved'},{rk:'cashier'}]})];
  await save(10,routes);await begin(10,2);await code(()=>stage(10,routes),'23514');ok((await read(10)).stagedCount===0,'different approval routes rejected as one transaction');
  const attachmentsDiffer=[item(4500),item(4501,'invoice',{steps:[{rk:'applicant_submit',uid:'actor-a',a:'approved',files:[{name:'per-row-file.pdf'}]},{rk:'accountant'}]})];
  await save(11,attachmentsDiffer);await begin(11,2);ok((await stage(11,attachmentsDiffer)).state==='ready','per-row attachment metadata does not split identical approval route');
  await save(7,[item(4200)]);await code(()=>begin(7,2001),'22023');await code(()=>begin(7,2),'23514');
  await code(()=>save(8,[item(4300)],'invoice',0,[{bucket:'finance-attachments',path:'guessed'}]),'42501');
  await code(()=>save(8,[item(4300)],'invoice',0,[{bucket:'finance-attachments',path:'guessed',url:'data:secret'}]),'22023');
  await code(()=>rpc('finance_cloud_draft_save_v1',[id(8),0,'invoice',{ui:{source:{preview:'blob:device-only'}},items:[item(4300)]},[],'production']),'22023');
  await db.exec(`insert into storage.objects values('finance-attachments','saved-file','${uid}','{"size":123}');insert into public.file_attachments values('${tenant}','production','invoice','actor-a','finance-attachments','saved-file');`);
  // Actual metadata uses plural record_type, matching the production uploader.
  await db.exec(`update public.file_attachments set record_type='invoices'`);
  const files=[{bucket:'finance-attachments',path:'saved-file',name:'proof.pdf'}];await save(8,[item(4300)],'invoice',0,files);
  await code(()=>db.exec("delete from storage.objects where name='saved-file'"),'23514');
  await code(()=>db.exec("update storage.objects set metadata='{\"size\":456}' where name='saved-file'"),'23514');
  await code(()=>db.exec("delete from public.file_attachments where storage_path='saved-file'"),'23514');
  await code(()=>db.exec("update public.file_attachments set storage_path='different-file' where storage_path='saved-file'"),'23514');
  await db.exec("update public.file_attachments set storage_path=storage_path where storage_path='saved-file'");ok(true,'unchanged ownership metadata updates allowed');
  ok((await read(8)).files[0].path==='saved-file','new device restores uploaded reference');
  await begin(8,1);d=await stage(8,[item(4300)]);await code(()=>commit(8,d),'23514');
  await rpc('finance_cloud_draft_discard_v1',[id(8),1,'production']);await db.exec("delete from storage.objects where name='saved-file';delete from public.file_attachments where storage_path='saved-file';");ok(true,'discard permits orphan cleanup');
  const biggest=Array.from({length:2000},(_,i)=>item(5000+i,'bill'));await save(9,biggest,'bill');await begin(9,2000);
  for(let i=0;i<biggest.length;i+=100)d=await stage(9,biggest.slice(i,i+100),i);
  const started=Date.now();d=await commit(9,d);ok(d.result.count===2000,'2000 bill fixture capacity');console.log((dbOverride?'Native':'PGlite')+' 2000 bill commit ms',Date.now()-started);
  const page=await rpc('finance_cloud_draft_list_v1',['production',null,null,2]);
  const next=await rpc('finance_cloud_draft_list_v1',['production',page.nextCursor.updatedAt,page.nextCursor.id,2]);
  ok(next.rows.length===2&&!next.rows.some(r=>page.rows.some(p=>p.id===r.id)),'cursor pages do not repeat drafts');
  await db.exec('set role anon');await code(()=>read(1),'42501');await db.exec('reset role;set role authenticated');
  ok((await read(1)).state==='committed','authenticated private RPC scope');await code(()=>db.query('select * from private.finance_cloud_drafts_v1'),'42501');await db.exec('reset role');
  for(const row of sources.limits){const hash=await query('select md5(prosrc) v from pg_proc where oid=$1::regprocedure',[row.signature]);ok(hash!==row.hash,'downstream capacity transformed '+row.signature);}
  const privateGrant=await query("select has_function_privilege('authenticated','private.finance_cloud_submit_invoice_v1(text,jsonb,text)','EXECUTE') v",[]);ok(!privateGrant,'private large submit not externally callable');
  console.log('PASS cloud submission SQL '+checks+' checks (real submission bodies; synthetic dependency fixture; not production capacity proof)');
 }finally{await db.close();}
}
module.exports={fixture,item,id,tenant,uid,run};
if(require.main===module)run().catch(e=>{console.error(e);process.exitCode=1;});
