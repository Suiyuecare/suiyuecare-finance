// Synthetic PostgreSQL proof for a lost invoice-posting response. No live data.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

const db=new PGlite();
const tenantA='11111111-1111-4111-8111-111111111111';
const tenantB='22222222-2222-4222-8222-222222222222';
const authA='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const authB='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const authC='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
let checks=0;
const eq=(actual,expected,label)=>{assert.deepEqual(actual,expected,label);checks++;};
const deny=async(fn,label)=>{await assert.rejects(fn,/無權核對|permission denied/i,label);checks++;};

try{
 await db.exec(`
  create role anon;create role authenticated;create role service_role;
  create schema auth;grant usage on schema auth to anon,authenticated;
  create function auth.uid() returns uuid language sql stable as
   $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
  create table public.finance_users(id text primary key,tenant_id uuid,auth_user_id uuid,active boolean);
  create function public.current_finance_user_id() returns text language sql stable security definer set search_path='' as
   $$select id from public.finance_users where auth_user_id=auth.uid() and active is true$$;
  create function public.current_tenant_id() returns uuid language sql stable security definer set search_path='' as
   $$select tenant_id from public.finance_users where auth_user_id=auth.uid() and active is true$$;
  create table public.invoices(id text primary key,tenant_id uuid,data_environment text,no text,entity_id text,
   department_code text,total numeric,amount numeric,tax numeric,revenue_account_code text,revenue_posted boolean,
   revenue_posted_at timestamptz,revenue_posting_state text,revenue_posting_version integer,voided_at timestamptz,
   applicant_id text);
  create function public.can_read_invoice(p_invoice public.invoices) returns boolean language sql stable set search_path='' as
   $$select p_invoice.applicant_id=public.current_finance_user_id()$$;
  create table public.ledger_entries(id bigint generated always as identity primary key,tenant_id uuid,data_environment text,
   voided_at timestamptz,posting_key text,source_type text,source_id text,reference_no text,entity_id text,
   department_code text,account_code text,debit numeric,credit numeric);
  revoke all on public.ledger_entries from public,anon,authenticated;
  grant select on public.invoices to authenticated;
  insert into public.finance_users values
   ('applicant-A','${tenantA}','${authA}',true),
   ('applicant-B','${tenantB}','${authB}',true),
   ('other-A','${tenantA}','${authC}',true);
  insert into public.invoices values
   ('invoice-A','${tenantA}','production','INV-A','E1','D1',105,105,5,'4101',true,
    '2026-10-02T15:00:00Z','posted',2,null,'applicant-A');
 `);
 await db.exec(await fs.readFile(new URL('../supabase/migrations/20261002151725_finance_invoice_revenue_result_v1.sql',import.meta.url),'utf8'));
 await db.exec(`create schema supabase_migrations;
  create table supabase_migrations.schema_migrations(version text,name text);
  insert into supabase_migrations.schema_migrations values
   ('20261002151725','finance_invoice_revenue_result_v1');`);
 const postflight=(await fs.readFile(new URL('./finance_invoice_revenue_result_postflight.sql',import.meta.url),'utf8'))
  .replace(/^\\set ON_ERROR_STOP on\s*/,'');
 await db.exec(postflight);checks++;
 const login=async(user,role='authenticated')=>{
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user||'']);
  await db.exec(`set role ${role}`);
 };
 const asOwner=()=>login(authA);
 const asAdmin=()=>db.exec('reset role');
 const result=async(env='production')=>(await db.query('select public.finance_invoice_revenue_result_v1($1,$2) result',['invoice-A',env])).rows[0].result;
 const insertFamily=async(prefix,sourceId='invoice-A')=>{
  const rows=[['ar','1123',105,0],['income','4101',0,100],['output_tax','2134',0,5]];
  for(const [suffix,account,debit,credit] of rows)await db.query(`insert into public.ledger_entries
   (tenant_id,data_environment,posting_key,source_type,source_id,reference_no,entity_id,department_code,account_code,debit,credit)
   values($1,'production',$2,'invoice',$3,'INV-A','E1','D1',$4,$5,$6)`,[tenantA,prefix+':'+suffix,sourceId,account,debit,credit]);
 };
 const prefix=`tenant:${tenantA}:invoice:INV-A:revenue:v2`;
 await insertFamily(prefix);
 await asOwner();
 let r=await result();
 eq(r.confirmed,true,'complete source-bound, balanced journal confirms posting');
 eq(r.invoice_id,'invoice-A','readback is same invoice');
 eq(r.tenant_id,tenantA,'readback is same tenant');
 eq(r.data_environment,'production','readback is same environment');
 eq(r.posting_version,2,'readback carries writer posting version');
 await deny(()=>db.query('select * from public.ledger_entries'),'applicant has no direct ledger access');
 eq((await db.query("select prosecdef,provolatile from pg_proc where oid='public.finance_invoice_revenue_result_v1(text,text)'::regprocedure")).rows[0],
  {prosecdef:true,provolatile:'s'},'RPC is stable and definer-scoped');
 await result();await result();
 await asAdmin();
 eq((await db.query('select count(*)::int n from public.ledger_entries')).rows[0].n,3,'repeat readback never writes ledger');
 eq((await db.query("select revenue_posted,revenue_posting_state from public.invoices where id='invoice-A'")).rows[0],
  {revenue_posted:true,revenue_posting_state:'posted'},'repeat readback never writes invoice');

 await db.exec("delete from public.ledger_entries where posting_key like '%:output_tax'");
 await asOwner();eq((await result()).confirmed,false,'partial journal cannot confirm posting');
 await asAdmin();await db.query(`insert into public.ledger_entries
  (tenant_id,data_environment,posting_key,source_type,source_id,reference_no,entity_id,department_code,account_code,debit,credit)
  values($1,'production',$2,'invoice','invoice-A','INV-A','E1','D1','2134',0,5)`,[tenantA,prefix+':output_tax']);
 await db.exec("update public.ledger_entries set source_id='other-invoice' where posting_key like '%:income'");
 await asOwner();eq((await result()).confirmed,false,'matching amounts with wrong source cannot confirm');
 await asAdmin();await db.exec("update public.ledger_entries set source_id='invoice-A' where posting_key like '%:income'");
 await insertFamily('invoice:INV-A:revenue');
 await asOwner();eq((await result()).confirmed,false,'mixed complete posting families cannot confirm');
 await asAdmin();await db.exec('delete from public.ledger_entries');
 await insertFamily('invoice:INV-A:revenue');
 await asOwner();eq((await result()).confirmed,true,'complete historical posting key family remains supported');

 await asAdmin();await db.exec("update public.invoices set revenue_posted=false where id='invoice-A'");
 await asOwner();eq((await result()).confirmed,false,'journal alone without writer flags cannot confirm');
 await asAdmin();await db.exec("update public.invoices set revenue_posted=true,voided_at=now() where id='invoice-A'");
 await asOwner();eq((await result()).confirmed,false,'voided invoice cannot confirm');
 await asAdmin();await db.exec("update public.invoices set voided_at=null where id='invoice-A'");
 await login(authC);await deny(()=>result(),'same-tenant non-reader is denied');
 await login(authB);await deny(()=>result(),'cross-tenant actor is denied');
 await asOwner();await deny(()=>result('test'),'cross-environment readback is denied');
 await login('', 'anon');await deny(()=>result(),'anonymous actor cannot execute RPC');

 console.log(`invoice revenue SQL reconciliation: ${checks} checks passed`);
}finally{await db.close();}
