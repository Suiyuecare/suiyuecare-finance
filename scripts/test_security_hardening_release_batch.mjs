// Execute the actual protected security hardening phase SQL on the live-catalog
// fixture. Synthetic rows only; no production identity, document or file.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import guard from './finance_production_release_guard.js';
import fixture from './fixtures/finance_invoice_approval_fixture_20261021.cjs';
import apm from './fixtures/finance_apm_adoption_fixture_20261022.cjs';
import base from './fixtures/finance_invoice_batch_fixture_20261014.cjs';
const db=new PGlite({extensions:{pgcrypto}}),dir=await fs.mkdtemp(path.join(os.tmpdir(),'finance-security-hardening-release-'));
const root=path.resolve(import.meta.dirname,'..'),migrationDir=path.join(root,'supabase/migrations');
const phase=guard.RELEASE_PHASE_DATABASE_SECURITY_HARDENING,version=guard.SECURITY_HARDENING_MIGRATIONS.join(',');
const prior=['00000000000001',...guard.REVIEWED_MIGRATION_CATALOG.filter(v=>v<version).sort()];
const baseline={count:1,lastVersion:prior[0],sha256:guard.ledgerSha256([prior[0]])};
const gate=name=>path.join(root,'scripts','finance_security_hardening_'+name+'.sql');
const readGate=async name=>(await fs.readFile(gate(name),'utf8')).replace(/^\\set ON_ERROR_STOP on\r?\n/,'');
const migration=await fs.readFile(path.join(migrationDir,'20261024100000_finance_security_hardening_v1.sql'),'utf8');
let checks=0,serial=0;
const eq=(a,b,message)=>{assert.deepEqual(a,b,message);checks++;};
const ok=(value,message)=>{assert.ok(value,message);checks++;};
const rejects=async(fn,re)=>{await assert.rejects(fn,re);checks++;};
const asRole=async(role,sql)=>{await db.exec('begin;set local role '+role+';');try{return await db.query(sql);}finally{await db.exec('rollback');}};
try {
 await fixture.setup(db);
 await apm.setupAdoptedApm(db);
 await base.identity(db,{user:null});
 await db.exec('alter table supabase_migrations.schema_migrations add column statements text[], add column created_by text;');
 for(const v of prior)await db.query('insert into supabase_migrations.schema_migrations(version,name) values($1,$2)',[v,'synthetic_predecessor']);
 await apm.seedLedger(db);
 const ledger=path.join(dir,'ledger.txt');await fs.writeFile(ledger,prior.join('\n')+'\n');

 // Production-equivalent exposure from the legacy scripts: Supabase default
 // browser grants, a column grant, owner-rights environment views and the
 // folder-wide Storage read rule beside the verified parent-scoped one.
 await db.exec(`
  grant select,insert,update,delete,truncate on table public.ledger_entries,public.vouchers to anon,authenticated,service_role;
  grant update (description) on table public.ledger_entries to authenticated;
  alter table public.ledger_entries enable row level security;
  create policy fixture_books_all on public.ledger_entries for all to authenticated using (true) with check (true);
  create policy fixture_salary_scope on public.ledger_entries as restrictive for select to authenticated using (coalesce(account_code,'')<>'6110');
  create view public.finance_production_ledger_entries as select * from public.ledger_entries where data_environment='production';
  create view public.finance_test_ledger_entries as select * from public.ledger_entries where data_environment='test';
  grant select on public.finance_production_ledger_entries,public.finance_test_ledger_entries to anon,authenticated;
  insert into public.ledger_entries(id,entry_date,description,debit,credit,account_code,entity_id,data_environment,tenant_id)
   values(gen_random_uuid(),'2026-10-01','虛構薪資',100,0,'6110','FICT-E1','production','${base.tenant}'),
         (gen_random_uuid(),'2026-10-01','虛構費用',50,0,'6210','FICT-E1','production','${base.tenant}');
  alter table storage.objects enable row level security;
  grant usage on schema storage to authenticated;
  grant select on storage.objects to authenticated;
  create policy finance_attachments_select_verified_tenant_metadata_v2 on storage.objects for select to authenticated
   using (bucket_id='finance-attachments' and owner_id=auth.uid()::text);
  create policy "finance attachment read scoped" on storage.objects for select to authenticated
   using (bucket_id='finance-attachments' and split_part(name,'/',1) in ('expense_requests','invoices','draft_requests','vouchers'));
  insert into storage.buckets(id,name) select 'finance-attachments','finance-attachments' where not exists(select 1 from storage.buckets where id='finance-attachments');
  insert into storage.objects(id,bucket_id,name,owner_id) values(gen_random_uuid(),'finance-attachments','expense_requests/production/2026/10/other.pdf','someone-else');
  create table public.payee_bank_accounts(id text primary key,name text,bank_no text);
  alter table public.payee_bank_accounts enable row level security;alter table public.payee_bank_accounts force row level security;
  grant select,insert,update on public.payee_bank_accounts to authenticated;
  create policy payee_bank_accounts_select_active_finance_user on public.payee_bank_accounts for select to authenticated using (true);
  create policy payee_bank_accounts_insert_active_finance_user on public.payee_bank_accounts for insert to authenticated with check (true);
  create policy payee_bank_accounts_update_active_finance_user on public.payee_bank_accounts for update to authenticated using (true) with check (true);
  insert into public.payee_bank_accounts values('payee-1','虛構廠商','000-111');
  create table public.draft_requests(id text primary key,owner_id text,owner_email text,payload jsonb);
  alter table public.draft_requests enable row level security;alter table public.draft_requests force row level security;
  grant select,insert,update,delete on public.draft_requests to authenticated;
  create policy draft_requests_insert_own on public.draft_requests for insert to authenticated with check (lower(owner_email)=lower(auth.jwt()->>'email') or owner_id=public.current_finance_user_id());
  create policy draft_requests_update_own on public.draft_requests for update to authenticated using (lower(owner_email)=lower(auth.jwt()->>'email') or owner_id=public.current_finance_user_id()) with check (lower(owner_email)=lower(auth.jwt()->>'email') or owner_id=public.current_finance_user_id());
  create policy draft_requests_select_own on public.draft_requests for select to authenticated using (true);
  insert into public.draft_requests values('legacy-draft','','invoice.fixture@suiyuecare.com','{}');`);
 const withIdentity=async(user,email,sql)=>{
  await db.exec('begin;');
  try{
   await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)",[user||'',JSON.stringify({sub:user,session_id:base.sid,role:'authenticated',email})]);
   await db.exec('set local role authenticated;');
   return await db.query(sql);
  }finally{await db.exec('rollback');}
 };
 const staffId=(await withIdentity(base.uid,'invoice.fixture@suiyuecare.com','select public.current_finance_user_id() id')).rows[0].id;
 assert.ok(staffId,'fixture staff resolves to a verified Finance identity');checks++;
 eq((await withIdentity('99999999-9999-4999-8999-999999999999','invoice.fixture@suiyuecare.com',"select count(*)::int n from public.payee_bank_accounts")).rows[0].n,1,
   'before: a token whose email merely matches staff reads shared payee bank accounts');
 await withIdentity(base.uid,'attacker@example.invalid',"insert into public.draft_requests values('planted','someone-else','attacker@example.invalid','{}')");checks++;

 eq((await asRole('anon',"select count(*)::int n from public.finance_production_ledger_entries where account_code='6110'")).rows[0].n,1,
   'before: anonymous callers read salary rows through the owner-rights view');
 eq((await asRole('authenticated',"select count(*)::int n from storage.objects")).rows[0].n,1,
   'before: any signed-in user reads another person\'s attachment through the folder rule');
 await db.exec('begin;set local role authenticated;');
 await db.exec("update public.ledger_entries set debit=99999 where account_code='6210'");
 await db.exec('rollback');checks++;

 const fingerprint=async()=>(await db.query(await readGate('fingerprint'))).rows[0].fingerprint;
 const dataFingerprint=async()=>(await db.query("select md5(coalesce(string_agg(to_jsonb(l)::text,E'\\n' order by l.id),'')) h from public.ledger_entries l")).rows[0].h
   +'/'+(await db.query("select md5(coalesce(string_agg(to_jsonb(v)::text,E'\\n' order by v.id),'')) h from public.vouchers v")).rows[0].h
   +'/'+(await db.query("select md5(coalesce(string_agg(to_jsonb(o)::text,E'\\n' order by o.id),'')) h from storage.objects o")).rows[0].h;
 const original=await fingerprint(),originalData=await dataFingerprint();

 // A caller-rights writer would break once browser writes are revoked; both the
 // read-only preflight and the migration itself stop before any change.
 for(const definition of [
  "create function public.fixture_invoker_writer() returns void language sql as $$insert into public.ledger_entries(id,data_environment) values(gen_random_uuid(),'production')$$; grant execute on function public.fixture_invoker_writer() to authenticated",
  "create function private.fixture_invoker_trigger() returns trigger language plpgsql as $$begin update public.vouchers set description=description where false;return new;end$$",
  "create function finance_hr_private.fixture_invoker_writer() returns void language plpgsql as $$begin delete from vouchers where false;end$$; grant execute on function finance_hr_private.fixture_invoker_writer() to authenticated"
 ]){
  await db.exec('begin;'+definition+';');
  await rejects(async()=>db.exec(await readGate('preflight')),/Caller-rights routine writes ledger_entries or vouchers/);
  await db.exec('rollback;begin;'+definition+';');
  await rejects(()=>db.exec(migration),/Caller-rights routine writes ledger_entries or vouchers/);
  await db.exec('rollback');
  eq(await fingerprint(),original,'caller-rights writer stops the phase without changing privileges or policies');
 }
 await db.exec('begin;drop policy finance_attachments_select_verified_tenant_metadata_v2 on storage.objects;');
 await rejects(async()=>db.exec(await readGate('preflight')),/Verified attachment read policy is missing/);
 await db.exec('rollback;begin;drop policy finance_attachments_select_verified_tenant_metadata_v2 on storage.objects;');
 await rejects(()=>db.exec(migration),/Verified attachment read policy is missing/);
 await db.exec('rollback');
 eq(await fingerprint(),original,'missing verified attachment policy stops the phase unchanged');

 const render=async kind=>{
  const file=path.join(dir,kind+'-'+serial+++'.sql');
  if(kind==='rehearsal')guard.prepareSecurityHardeningRehearsal(migrationDir,file,version,ledger,gate('fingerprint'),gate('canary'),gate('preflight'),gate('postflight'),baseline);
  else guard.prepareAuditBatchApply(migrationDir,file,version,ledger,gate('postflight'),baseline,phase);
  return fs.readFile(file,'utf8');
 };
 eq(guard.classifyLedger(ledger,migrationDir,phase,version,baseline),'pending');
 await db.exec(await readGate('preflight'));
 await db.exec(await render('rehearsal'));
 eq(await fingerprint(),original,'rehearsal restores exact grants, view options and Storage policies');
 eq(await dataFingerprint(),originalData,'rehearsal never changes books or files');
 eq((await db.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1',[version])).rows[0].n,0);

 const apply=await render('apply');
 assert.match(apply,/begin;[\s\S]+pg_advisory_xact_lock[\s\S]+lock table supabase_migrations.schema_migrations[\s\S]+insert into supabase_migrations.schema_migrations[\s\S]+commit;/);checks++;
 eq(apply.split("select 'FINANCE_APM_ADOPTION_POSTFLIGHT_OK'::text as result;").length-1,2,'APM adoption is verified before and after the atomic change');
 const failed=apply.replace("select 'FINANCE_SECURITY_HARDENING_POSTFLIGHT_OK' as marker;",()=>"do $$begin raise exception 'synthetic_postflight_failure';end $$;");
 assert.notEqual(failed,apply);checks++;
 await rejects(()=>db.exec(failed),/synthetic_postflight_failure/);await db.exec('rollback');
 eq(await fingerprint(),original,'failed postflight restores every privilege and policy');
 eq((await db.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1',[version])).rows[0].n,0);

 await db.exec(apply);
 eq((await db.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1',[version])).rows[0].n,1);
 eq(await dataFingerprint(),originalData,'successful release changes no ledger, voucher or file row');
 assert.notEqual(await fingerprint(),original);checks++;
 await db.exec(await readGate('postflight'));
 const canary=await db.exec(await readGate('canary')),result=path.join(dir,'canary.json');await fs.writeFile(result,JSON.stringify(canary));
 eq(guard.verifyReportsCanary(result,'security_hardening'),true,'actual canary marker verifies against the protected guard');

 for(const role of ['authenticated','anon']){
  for(const sql of ["insert into public.ledger_entries(id,data_environment) values(gen_random_uuid(),'production')",
    "update public.ledger_entries set debit=99999","update public.ledger_entries set description='x'",
    "delete from public.ledger_entries","insert into public.vouchers(id,data_environment) values('v-x','production')",
    "update public.vouchers set total=1","delete from public.vouchers"]){
   await rejects(()=>asRole(role,sql),/permission denied/);
  }
 }
 eq((await asRole('authenticated',"select count(*)::int n from public.ledger_entries")).rows[0].n,1,'authenticated reads remain, still under the salary scope');
 eq((await asRole('authenticated',"select count(*)::int n from public.finance_production_ledger_entries")).rows[0].n,1,'environment view now applies the caller ledger RLS');
 await rejects(()=>asRole('anon',"select * from public.finance_production_ledger_entries"),/permission denied/);
 eq((await asRole('authenticated',"select count(*)::int n from storage.objects")).rows[0].n,0,'another person\'s attachment is no longer readable through the folder rule');
 ok((await db.query("select has_table_privilege('postgres','public.ledger_entries','INSERT') p")).rows[0].p,'definer posting RPC owner keeps write access');
 const unverified='99999999-9999-4999-8999-999999999999';
 await rejects(()=>withIdentity(unverified,'invoice.fixture@suiyuecare.com',"update public.payee_bank_accounts set bank_no='999-attacker'").then(r=>{if(r.affectedRows===0)throw new Error('row-level security hid every payee row');return r;}),/row-level security|permission denied/);
 eq((await withIdentity(unverified,'invoice.fixture@suiyuecare.com',"select count(*)::int n from public.payee_bank_accounts")).rows[0].n,0,'unverified email-matching token no longer reads payee bank accounts');
 await rejects(()=>withIdentity(unverified,'invoice.fixture@suiyuecare.com',"insert into public.payee_bank_accounts values('payee-x','x','x')"),/row-level security/);
 eq((await withIdentity(base.uid,'invoice.fixture@suiyuecare.com',"select count(*)::int n from public.payee_bank_accounts")).rows[0].n,1,'verified staff still read shared payee accounts');
 await withIdentity(base.uid,'invoice.fixture@suiyuecare.com',"insert into public.payee_bank_accounts values('payee-2','虛構廠商二','000-222')");checks++;
 await rejects(()=>withIdentity(base.uid,'attacker@example.invalid',"insert into public.draft_requests values('planted-2','someone-else','attacker@example.invalid','{}')"),/row-level security/);
 await withIdentity(base.uid,'invoice.fixture@suiyuecare.com',"insert into public.draft_requests values('own-draft','"+staffId+"','invoice.fixture@suiyuecare.com','{}')");checks++;
 await rejects(()=>withIdentity(base.uid,'invoice.fixture@suiyuecare.com',"update public.draft_requests set owner_id='someone-else' where id='legacy-draft'"),/row-level security/);
 await withIdentity(base.uid,'invoice.fixture@suiyuecare.com',"update public.draft_requests set owner_id='"+staffId+"' where id='legacy-draft'");checks++;

 await fs.writeFile(ledger,[...prior,version].join('\n')+'\n');
 eq(guard.classifyLedger(ledger,migrationDir,phase,version,baseline),'applied');
 await rejects(()=>db.exec(apply),/migration ledger changed/);await db.exec('rollback');
 const installed=await fingerprint();
 for(const drift of [
  'grant insert on public.ledger_entries to authenticated','grant update (description) on public.vouchers to anon',
  'grant delete on public.vouchers to authenticated','alter view public.finance_test_ledger_entries reset (security_invoker)',
  'grant select on public.finance_production_ledger_entries to anon',
  `create policy "finance attachment read scoped" on storage.objects for select to authenticated using (true)`,
  'revoke select on public.ledger_entries from authenticated',
  'drop policy payee_bank_accounts_verified_identity_v1 on public.payee_bank_accounts',
  'alter policy draft_requests_update_caller_owner_v1 on public.draft_requests with check (true)'
 ]){
  await db.exec('begin;'+drift+';');
  await rejects(async()=>db.exec(await readGate('postflight')),/Browser role can still write|Environment ledger view|Legacy folder-wide|reads of the books|verified Finance identity|another owner/);
  await db.exec('rollback');
  eq(await fingerprint(),installed,'postflight drift probes are rolled back');
 }
 console.log(JSON.stringify({verified:true,checks,phase,version,engine:'PGlite',atomicLedger:true,rollbackProven:true,callerRightsWriterRejected:true,productionDataTouched:false}));
} finally {await db.close();await fs.rm(dir,{recursive:true,force:true});}
