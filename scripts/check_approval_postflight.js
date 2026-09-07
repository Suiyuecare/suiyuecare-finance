#!/usr/bin/env node
'use strict';
// Rehearse the exact three approval migrations together against the anonymous
// PostgreSQL fixtures used by the behavioral tests. Verify read-only postflight
// both inside the transaction and after commit, with an explicit rollback pass.
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert');
const {PGlite}=require('@electric-sql/pglite');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const tenant='00000000-0000-0000-0000-000000000001';
function schema(file){const match=read(file).match(/const schema=`([\s\S]*?)`;/);assert(match);return vm.runInNewContext('`'+match[1]+'`',{tenant});}
const additions=schema('scripts/check_receipt_atomic_workflow.js').split('\n').filter(line=>
 /^create table (public\.(invoices|file_attachments|ledger_entries|notifications|bills)|storage\.objects)\(/.test(line)||
 /^create function (public\.can_read_invoice|private\.(finance_assert_period_open|finance_income_append_step_action|post_invoice_revenue_v2_internal|fixture_invoice_version|fixture_claim))\(/.test(line)||
 /^create trigger (zz_fixture_invoice_version|fixture_claim) /.test(line)).join('\n');
const baseline=read('supabase/migrations/20260902054834_preserve_human_accounting_authority_v1.sql');
const helpers=[...baseline.matchAll(/create or replace function private\.(finance_accounting_manual_fields|finance_accounting_line_is_human|finance_merge_human_accounting_line|finance_merge_human_accounting_lines)\([\s\S]*?\$function\$;/g)].map(x=>x[0]).join('\n');
const batch=['20260907154739_procurement_and_human_accounting_contract_v2.sql','20260907154742_expense_accounting_correction_workflow_v1.sql','20260907154743_receipt_ceo_atomic_v1.sql'].map(file=>read('supabase/migrations/'+file)).join('\n');
const postflight=read('scripts/finance_approval_audit_postflight.sql');
(async()=>{const db=new PGlite();try{
 await db.exec(schema('scripts/check_expense_accounting_corrections.js')+'\ncreate schema storage;\n'+additions+'\n'+helpers+'\n'+read('scripts/fixtures/finance_procurement_guard_20260907.sql')+';\n'+read('scripts/fixtures/finance_correction_dependencies_20260907.sql'));
 const original=(await db.query("select prosrc from pg_proc where oid='private.finance_expense_guard_direct_update()'::regprocedure")).rows[0].prosrc;
 await db.exec('begin;'+batch+'\n'+postflight+'\n'+postflight+'\nrollback;');
 const after=(await db.query("select prosrc from pg_proc where oid='private.finance_expense_guard_direct_update()'::regprocedure")).rows[0].prosrc;assert.strictEqual(after,original);
 assert((await db.query("select to_regclass('private.finance_receipt_operations_v1') is null and to_regclass('private.expense_accounting_corrections_v1') is null and not exists(select 1 from information_schema.columns where table_schema='public' and table_name='notifications' and column_name='record_type') ok")).rows[0].ok);
 await db.exec('begin;'+batch+'\n'+postflight+'\ncommit;');await db.exec(postflight);
 console.log('PASS: exact 3 approval migrations + repeatable postflight; rollback restores guard, tables and notification schema; commit postflight passes (isolated PostgreSQL)');
 }finally{await db.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
