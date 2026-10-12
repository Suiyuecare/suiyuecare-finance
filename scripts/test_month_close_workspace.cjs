'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const { createAuditReadinessFixture } = require('./fixtures/finance_audit_readiness_fixture.cjs');
const root = path.resolve(__dirname, '..');
const sql = fs.readFileSync(path.join(root, 'supabase/migrations/20261011133831_finance_completion_core_v1.sql'), 'utf8');
async function main() {
 const db = new PGlite();
 const f = await createAuditReadinessFixture(db, { install: true });
 await db.exec(`
 create schema finance_hr_private;
 create table public.vouchers(id text primary key,tenant_id uuid,entity_id text,data_environment text,voucher_date date,created_at timestamptz);
 create table public.period_closes(id text primary key,tenant_id uuid,entity_id text,data_environment text,period text,status text,note text);
 create table public.accounting_period_close_records(tenant_id uuid,entity_id text,data_environment text,period_month text,status text);
 create table public.bank_statement_imports(id text primary key,tenant_id uuid,entity_id text,data_environment text,statement_period text,row_count integer);
 create table public.bank_transactions(id text primary key,tenant_id uuid,entity_id text,data_environment text,transaction_date date,amount numeric,match_status text);
 create table public.bank_reconciliation_matches(id text primary key,tenant_id uuid,data_environment text,bank_transaction_id text,matched_amount numeric,target_id text);
 create table public.finance_document_archives_v1(id uuid primary key,tenant_id uuid,entity_id text,period text,manifest jsonb,created_at timestamptz default now());
 create table private.finance_archive_verifications_v1(id uuid primary key,archive_id uuid,verified_at timestamptz);
 create table finance_hr_private.finance_hr_obligations(obligation_id uuid primary key,tenant_id uuid,source_employer_id uuid);
 create table finance_hr_private.finance_hr_postings(obligation_id uuid,tenant_id uuid,entity_id text);
 create table private.finance_payroll_accruals_v1(id uuid primary key,obligation_id uuid,tenant_id uuid,entity_id text,period text,status text);
 create function finance_hr_private.finance_hr_reader(uuid,uuid,text) returns boolean language sql stable as $$select coalesce(current_setting('fixture.salary_allowed',true),'true')<>'false'$$;
 create function public.current_finance_user() returns public.finance_users language sql stable security definer as $$select u from public.finance_users u where u.id=public.current_finance_user_id()$$;
 create function public.is_finance_accounting() returns boolean language sql stable as $$select public.current_finance_role() in('accountant','ceo','admin_director')$$;
 create table private.finance_period_close_events_v1(id uuid default gen_random_uuid(),tenant_id uuid,entity_id text,data_environment text,period text,status text,actor_id text,reason text,debit numeric,credit numeric,created_at timestamptz default now());
 grant usage on schema public,auth to authenticated;
 grant select on public.ledger_entries,public.vouchers,public.period_closes to authenticated;
 grant insert,update,delete on public.period_closes to authenticated;
 `);
 // Execute the production close/ledger lock guards and HR confidentiality guard,
 // not JavaScript imitations of their behavior.
 const controls = f.readSource('supabase/migrations/20260927152432_finance_audit_controls_v1.sql');
 function fn(source, name) { const start=source.indexOf('create or replace function '+name); assert(start>=0,name); const end=source.indexOf('end $$;',start); assert(end>start); return source.slice(start,end+7); }
 await db.exec(fn(controls,'private.finance_assert_period_open')+fn(controls,'private.finance_period_close_guard_v1')+fn(controls,'private.finance_ledger_period_guard_v1'));
 await db.exec(`create trigger close_guard before insert or update or delete on public.period_closes for each row execute function private.finance_period_close_guard_v1();
 create trigger ledger_guard before insert or update or delete on public.ledger_entries for each row execute function private.finance_ledger_period_guard_v1();`);
 await db.exec(fn(f.readSource('supabase/migrations/20260927153326_finance_payroll_accrual_v1.sql'),'finance_hr_private.finance_hr_accounting_scope'));
 await db.exec(sql);
 async function value(q, p=[]) { return (await db.query(q,p)).rows[0].x; }
 const workspace = (entity='A', env='test',period='2026-08')=>value('select public.finance_month_workspace_v1($1,$2,$3) x',[entity,period,env]);
 const health = (entity='A',env='test',period='2026-08')=>value('select public.finance_period_close_health($1,$2,$3) x',[entity,period,env]);
 async function denied(run, code='42501') { await assert.rejects(run, e=>e.code===code, 'expected SQLSTATE '+code); }
 await f.as('accountant');
 let w=await workspace(); assert.equal(w.profileConfigured,false); assert.equal(w.bank.status,'no_import_record'); assert.equal(w.archiveCount,0); assert.equal(w.ledgerSummary.debit,105);
 assert.equal((await health()).status,'missing_period_records');
 // Legacy close rows can neither satisfy nor override the real period lock.
 await f.admin("insert into public.accounting_period_close_records values($1,'A','test','2026-08','closed')",[f.tenant]);await f.as();assert.equal((await health()).ok,false);
 await db.query("insert into public.period_closes values('close-a',$1,'A','test','2026-08','closed','Fixture month close')",[f.tenant]);
 assert.equal((await health()).ok,true); assert.equal((await workspace()).periodCloses[0].status,'closed');
 await f.admin('select 1');
 await denied(()=>db.query("insert into public.ledger_entries(tenant_id,entity_id,data_environment,entry_date,debit,credit,account_code) values($1,'A','test','2026-08-31',0,0,'1112')",[f.tenant]),'23514');
 await f.as();await denied(()=>db.query("update public.period_closes set status='open',note='reopen' where id='close-a'"));
 await f.as('ceo');await db.query("update public.period_closes set status='open',note='CEO correction required' where id='close-a'");assert.equal((await health()).ok,false);assert.equal((await health()).status,'records_exist_pending_close');
 await denied(()=>db.query("delete from public.period_closes where id='close-a'"),'23514');
 assert.equal((await health('EMPTY')).status,'no_activity');assert.equal((await health('EMPTY')).ok,false);
 assert.equal((await health('A','production')).expected_period_count,0);
 await denied(()=>health('A','bad'),'22023');await denied(()=>health('A','test','2026-13'),'22023');
 await f.as('employee');await denied(()=>workspace());await denied(()=>health());
 await f.as('external_audit');await denied(()=>workspace());
 await f.as();await db.query("select set_config('fixture.denied_entity','B',false)");await denied(()=>workspace('B'));await db.query("select set_config('fixture.denied_entity','',false)");
 await db.query("select set_config('fixture.denied_department','D1',false)");await denied(()=>workspace());await db.query("select set_config('fixture.denied_department','',false)");
 await db.query("select set_config('fixture.denied_row','req-a',false)");await denied(()=>workspace());await db.query("select set_config('fixture.denied_row','',false)");
 await f.as('accountant',f.other);await denied(()=>workspace());await f.as();
 // Do not trust a stored matched status or matches in another environment.
 await f.admin("insert into public.bank_statement_imports values('imp',$1,'A','test','2026-08',1);",[f.tenant]);
 await f.admin("insert into public.bank_transactions values('tx',$1,'A','test','2026-08-30',-105,'matched')",[f.tenant]);
 await f.admin("insert into public.bank_reconciliation_matches values('wrong-env',$1,'production','tx',105,'source-1')",[f.tenant]);await f.as();
 w=await workspace();assert.equal(w.bank.unmatchedCount,1);assert.equal(w.bank.status,'needs_reconciliation');
 await f.admin("insert into public.bank_reconciliation_matches values('correct-env',$1,'test','tx',105,'source-1')",[f.tenant]);await f.as();
 w=await workspace();assert.equal(w.bank.unmatchedCount,0);assert.equal(w.bank.status,'matched_records');
 const op='33333333-3333-3333-3333-333333333333';
 const prepare=(record,revision=0,operation=op,reason='Fictional verification')=>value('select public.finance_month_snapshot_prepare_v1($1,$2,$3,$4,$5,$6,$7) x',['A','2026-08',revision,record.sourceFingerprint,operation,reason,'test']);
 const snapshot=await prepare(w);assert.equal(snapshot.revision,1);assert.equal((await prepare(w)).replayed,true);
 await denied(()=>prepare(w,0,op,'Changed body'),'23514');
 const read=()=>value('select public.finance_month_snapshot_read_v1($1) x',[snapshot.id]);
 const review=()=>value('select public.finance_month_snapshot_review_v1($1,$2,$3) x',[snapshot.id,w.sourceFingerprint,'Independent fixture review']);
 await denied(review);await f.as('ceo');assert.equal((await review()).review.reviewedBy,'ceo');assert.equal((await review()).review.reviewedBy,'ceo');
 const saved=await read();assert.equal(saved.source.ledger.length,2);assert.equal(saved.source.accountTotals.length,2);
 await f.admin("update public.bank_reconciliation_matches set target_id='source-2' where id='correct-env'");await f.as();assert.equal((await read()).isCurrent,false);
 await f.admin("update public.bank_reconciliation_matches set target_id='source-1' where id='correct-env'");await f.as();assert.equal((await read()).isCurrent,true);
 await f.as('employee');await denied(read);await f.as('accountant',f.other);await denied(read);
 await f.as();await denied(()=>db.query('select * from private.finance_month_snapshots_v1'));
 await f.admin('select 1');await denied(()=>db.query('update private.finance_month_snapshots_v1 set reason=$1 where id=$2',['mutate',snapshot.id]),'23514');await denied(()=>db.query('delete from private.finance_month_snapshot_reviews_v1 where snapshot_id=$1',[snapshot.id]),'23514');
 await f.admin("update public.bank_transactions set amount=-106 where id='tx'");await f.as('ceo');assert.equal((await read()).isCurrent,false);await denied(review,'40001');
 await f.as();await denied(()=>prepare(w,1,'44444444-4444-4444-4444-444444444444'),'40001');
 const fresh=await workspace();await denied(()=>prepare(fresh,0,'44444444-4444-4444-4444-444444444444'),'40001');
 const next=await prepare(fresh,1,'44444444-4444-4444-4444-444444444444');assert.equal(next.revision,2);
 // Pending salary may not leak amounts/counts and cannot be snapshotted without authority.
 await f.admin("insert into finance_hr_private.finance_hr_obligations values('55555555-5555-5555-5555-555555555555',$1,'66666666-6666-6666-6666-666666666666')",[f.tenant]);
 await f.admin("insert into private.finance_payroll_accruals_v1 values('77777777-7777-7777-7777-777777777777','55555555-5555-5555-5555-555555555555',$1,'A','2026-08','submitted')",[f.tenant]);await f.as();await db.query("select set_config('fixture.salary_allowed','false',false)");
 const restricted=await workspace('A','production');assert.deepEqual(restricted.payroll,{status:'requires_private_review'});
 await denied(()=>value('select public.finance_month_snapshot_prepare_v1($1,$2,$3,$4,$5,$6,$7) x',['A','2026-08',0,restricted.sourceFingerprint,'88888888-8888-8888-8888-888888888888','Fixture','production']));
 await f.admin("update private.finance_payroll_accruals_v1 set status='posted'");await f.as();await denied(()=>workspace('A','production'));
 await db.query("select set_config('fixture.salary_allowed','true',false)");const prod=await workspace('A','production');
 const prodSnap=await value('select public.finance_month_snapshot_prepare_v1($1,$2,$3,$4,$5,$6,$7) x',['A','2026-08',0,prod.sourceFingerprint,'88888888-8888-8888-8888-888888888888','Fixture production snapshot','production']);
 await f.admin("delete from private.finance_payroll_accruals_v1");await f.as();await db.query("select set_config('fixture.salary_allowed','false',false)");
 await denied(()=>value('select public.finance_month_snapshot_read_v1($1) x',[prodSnap.id]));
 await f.admin('select 1');await db.exec('set role anon');await denied(()=>workspace());
 await db.close();
 console.log('PASS month-close SQL: authority/tenant/company/department, real period source + close/reopen/locked posting, no-activity, bank actual matches, immutable snapshots, CAS/replay/independent review/stale source, salary privacy.');
 await browserUnit();
}
async function browserUnit(){
 const api=require('../assets/engines/month-close-workspace.js');let actor={id:'accountant'},calls=0,resolve;
 const raw={entityId:'A',period:'2026-08',environment:'test',sourceFingerprint:'abc',ledgerSummary:{count:0,debit:0,credit:0,balanced:true},bank:{status:'no_import_record',importCount:0,unmatchedCount:0},payroll:{status:'no_accrual_record'},periodCloses:[],canPrepare:true,profileConfigured:false,archiveCount:0,verifiedArchiveCount:0};
 const model=api.buildWorkspace(raw);assert.equal(model.recordedChecksComplete,false);assert.equal(model.rows.find(r=>r.key==='ledger').complete,false);assert.match(api.renderWorkspace(model),/尚無入帳紀錄/);assert.match(api.renderWorkspace(model),/沒有紀錄不代表當月沒有薪資/);
 assert(!api.renderWorkspace({...raw,period:'<img src=x onerror=alert(1)>'}).includes('<img'));
 api.installRuntime({user:()=>actor,environment:()=> 'test',rpc:()=>{calls++;return new Promise(r=>{resolve=r;});}});
 const pending=api.loadWorkspace({entityId:'A',period:'2026-08'});actor={id:'ceo'};resolve({data:raw});await assert.rejects(()=>pending,/身分或權限/);
 actor={id:'accountant'};const a=api.prepareSnapshot({entityId:'A',period:'2026-08'},raw,'test','99999999-9999-9999-9999-999999999999');const b=api.prepareSnapshot({entityId:'A',period:'2026-08'},raw,'test','99999999-9999-9999-9999-999999999999');assert.equal(a,b);await Promise.resolve();resolve({data:{revision:1}});await a;assert.equal(calls,2);
 console.log('PASS month-close JS: missing vs complete, escaped labels, identity race discard, duplicate-submit coalescing.');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
