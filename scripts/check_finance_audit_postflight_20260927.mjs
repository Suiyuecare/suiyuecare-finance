// Real migration and real catalog postflight against a wholly fictional database.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
const db=new PGlite(),ids={T:'11111111-1111-4111-8111-111111111111',OTHER:'22222222-2222-4222-8222-222222222222',UID:'33333333-3333-4333-8333-333333333333',ARCH:'44444444-4444-4444-8444-444444444444'};
try{
 const fixture=(await fs.readFile(new URL('./check_finance_audit_controls_20260927.mjs',import.meta.url),'utf8')).match(/const fixture=`([\s\S]*?)`;\ntry\{/);assert.ok(fixture);
 await db.exec(fixture[1].replace(/\$\{(T|OTHER|UID|ARCH)\}/g,(_,key)=>ids[key]));
 await db.exec(await fs.readFile(new URL('../supabase/migrations/20260927152432_finance_audit_controls_v1.sql',import.meta.url),'utf8'));
 const postflight=(await fs.readFile(new URL('./finance_audit_controls_20260927_postflight.sql',import.meta.url),'utf8')).replace(/^\\set ON_ERROR_STOP on\n/,'');
 await db.exec(postflight);
 await db.exec('begin;drop trigger aa_finance_ledger_period_guard_v1 on public.ledger_entries;');
 await assert.rejects(()=>db.exec(postflight),/Ledger period BEFORE INSERT\/UPDATE\/DELETE guard missing/);await db.exec('rollback');
 await db.exec('begin;grant execute on function public.finance_reporting_profile_save_pre_review_v1(text,bigint,jsonb,text,text) to authenticated;');
 await assert.rejects(()=>db.exec(postflight),/Audit private bypass exposed/);await db.exec('rollback');
 await db.exec("begin;create or replace function private.finance_archive_is_sealed_v1(p_id text) returns boolean language sql stable security definer set search_path='' as $$select false$$;");
 await assert.rejects(()=>db.exec(postflight),/sealed reviewed function body/);await db.exec('rollback');
 await db.exec(postflight);
 console.log(JSON.stringify({ok:true,checks:5,realMigration:true,catalogPins:true,missingLedgerTriggerRejected:true,reviewBypassRejected:true,tamperedBodyRejected:true}));
}finally{await db.close();}
