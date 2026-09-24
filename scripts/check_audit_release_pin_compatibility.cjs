'use strict';
// Catalog compatibility only. Authorization behavior is covered by the actual
// document access suite; these cases prove historical gates select exactly the
// installed helper body rather than accepting both revisions indiscriminately.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const invoice=require('./check_invoice_select_initplan.cjs');
const ar=require('./check_ar_verified_accounting_scope.cjs');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const migration=read('supabase/migrations/20260922133752_finance_document_identity_attachment_scope_v1.sql');
const helper=migration.match(/CREATE OR REPLACE FUNCTION public\.can_read_invoice\(p_invoice invoices\)[\s\S]*?\$function\$;/i)?.[0];
assert.ok(helper,'exact new invoice helper exists in reviewed migration');
const version='20260922133752';let checks=0;
const block=(file,tag)=>{const source=read('scripts/'+file);const start=source.indexOf('do $'+tag+'$'),end=source.indexOf('$'+tag+'$;',start+tag.length+5);assert(start>=0&&end>start);return source.slice(start,end+tag.length+3);};
async function verify(db,sql){
 await db.exec(sql);checks++;
 await db.exec('begin;create schema if not exists supabase_migrations;create table if not exists supabase_migrations.schema_migrations(version text primary key);');
 try{
  await db.exec(sql);checks++;
  await db.query('insert into supabase_migrations.schema_migrations(version) values($1)',[version]);
  const reject=async()=>{await db.exec('savepoint pin_check');await assert.rejects(()=>db.exec(sql),/helper .*changed|helper source or authority differs/);await db.exec('rollback to savepoint pin_check');checks++;};
  await reject(); // A ledger claim cannot hide an old helper.
  await db.exec('set local check_function_bodies=off;'+helper);
  assert.equal((await db.query("select md5(prosrc) hash from pg_proc where oid='public.can_read_invoice(public.invoices)'::regprocedure")).rows[0].hash,'5ccbaefe4040cdb85ceb123d05aef6db');checks++;
  await db.exec(sql);checks++;
  await db.query('delete from supabase_migrations.schema_migrations where version=$1',[version]);await reject();
  await db.query('insert into supabase_migrations.schema_migrations(version) values($1)',[version]);
  await db.exec('create or replace function public.can_read_invoice(p_invoice public.invoices) returns boolean language sql stable set search_path=\'\' as $$select true$$;');await reject();
 }finally{await db.exec('rollback');}
 await db.exec(sql);checks++;
}
(async()=>{
 const inv=new PGlite();try{await invoice.createInvoiceSelectInitplanFixture(inv,{install:true});await verify(inv,block('finance_invoice_select_initplan_postflight.sql','invoice_select_postflight'));}finally{await inv.close();}
 const adb=new PGlite();try{await ar.createFixture(adb);await adb.exec(read(ar.migrationPath));for(const file of ['finance_ar_verified_accounting_scope_postflight.sql','finance_ar_verified_accounting_scope_canary.sql'])await verify(adb,block(file,'ar_verified_accounting_installed'));}finally{await adb.close();}
 console.log(`PASS audit release versioned helper pins: ${checks} isolated PostgreSQL checks; no production access`);
})().catch(error=>{console.error(error);process.exitCode=1;});
