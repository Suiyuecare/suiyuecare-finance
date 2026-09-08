#!/usr/bin/env node
'use strict';
// Real production finalizer, human-authority functions, workflow validators,
// period and attachment guards on anonymous PostgreSQL fixtures. Membership
// permission evaluation/current identity are narrow fixture interfaces here;
// the release canary exercises their actual production implementations.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {PGlite}=require(process.env.FINANCE_PGLITE_MODULE||'@electric-sql/pglite');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8'),clone=x=>structuredClone(x);
const tenant='00000000-0000-0000-0000-000000000001',otherTenant='00000000-0000-0000-0000-000000000002';
const actorId='accountant',actorName='Anonymous accountant',auth='00000000-0000-0000-0000-000000000011';
const migration=read('supabase/migrations/20260908065050_finance_finalize_accounting_lines_atomic_v1.sql');
const original={id:'line_1',description:'Anonymous item',source:'detail',grossAmount:1050,netAmount:1000,taxAmount:50,
  debitAccount:'6299',debitAccountName:'Other expense',creditAccount:'1112',creditAccountName:'Bank',departmentCode:'D1',systemFee:false,locked:false};
let tests=0,sequence=0;const check=(name,value=true)=>{assert(value,name);tests++;process.stdout.write('PASS '+name+'\n');};
const db=new PGlite();
const schema=`
create schema private;create schema auth;create schema storage;
create role anon;create role authenticated;create role service_role;
set check_function_bodies=off;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.auth',true),'')::uuid$$;
create function auth.jwt() returns jsonb language sql stable as $$select jsonb_build_object('role','authenticated','email','anonymous@invalid')$$;
create table public.finance_users(id text primary key,tenant_id uuid,auth_user_id uuid,name text,email text,role text,active boolean);
create function public.current_tenant_id() returns uuid language sql stable as $$select nullif(current_setting('test.tenant',true),'')::uuid$$;
create function public.current_finance_user() returns public.finance_users language sql stable security definer set search_path='' as $$select u from public.finance_users u where u.auth_user_id=auth.uid() and u.tenant_id=public.current_tenant_id() and u.active$$;
create function public.current_finance_user_name() returns text language sql stable as $$select (public.current_finance_user()).name$$;
create table public.expense_requests(id text primary key,no text,tenant_id uuid,data_environment text,applicant_id text,applicant text,entity_id text,department_code text,type text,type_label text,description text,amount numeric,estimated_amount numeric,actual_amount numeric,files jsonb default '[]',actual_files jsonb default '[]',form_payload jsonb default '{}',steps jsonb,status text,step integer,ver integer,updated_at timestamptz,created_at timestamptz default now(),request_date date,bank_fee_amount numeric default 0,petty_mode text,debit_account text,debit_account_name text,credit_account text,credit_account_name text,cash_posted_at timestamptz,ledger_posted_at timestamptz,posting_locked_at timestamptz,voucher_id text,voided_at timestamptz);
create table public.application_accounting_lines(id text primary key,request_id text,request_no text,line_index integer,source text,description text,entity_id text,department_code text,gross_amount numeric,net_amount numeric,tax_amount numeric,debit_account text,debit_account_name text,credit_account text,credit_account_name text,ai_reason text,reviewed_by text,reviewed_at timestamptz,payload jsonb,data_environment text,created_at timestamptz default now(),updated_at timestamptz default now(),unique(request_id,line_index));
create table public.module_audit_logs(table_name text,row_id text,action text,actor_email text,before_data jsonb,after_data jsonb);
create table public.vouchers(id text primary key,no text unique,request_id text,entity_id text,entity_name text,voucher_date date,description text,entries jsonb,total numeric,creator text,posted boolean,posted_at timestamptz,posting_locked_at timestamptz,data_environment text,tenant_id uuid,voided_at timestamptz,adjustment_type text,adjusts_voucher_no text);
create table public.ledger_entries(id uuid primary key default gen_random_uuid(),entry_date date,description text,entity_id text,department_code text,debit numeric,credit numeric,account_code text,account_name text,reference_no text,posting_key text unique,source_type text,source_id text,source_no text,voucher_no text,data_environment text,tenant_id uuid,voided_at timestamptz);
create table public.system_settings(tenant_id uuid,key text,value jsonb);
create table public.period_closes(tenant_id uuid,data_environment text,entity_id text,period text,status text);
create table public.employee_department_roles(tenant_id uuid,finance_user_id text,department_code text,role_key text,active boolean,can_approve boolean,effective_from date,effective_to date);
create table public.approval_step_actor_snapshots(tenant_id uuid,data_environment text,record_type text,record_id text,step_index integer,resolved_user_id text,resolution_status text,resolved_active boolean,raw_step jsonb);
create table public.approval_delegations(tenant_id uuid,delegator_finance_user_id text,delegatee_finance_user_id text,active boolean,starts_at timestamptz,ends_at timestamptz,role_key text,scope_json jsonb);
create table public.file_attachments(tenant_id uuid,bucket_id text,storage_path text,record_type text,record_no text,data_environment text,uploaded_by text);
create table storage.objects(bucket_id text,name text);
create table public.membership_users(id uuid,tenant_id uuid,legacy_finance_user_id text,auth_user_id uuid,status text);
create table private.fixture_permissions(member_id uuid,post boolean,subjects boolean);
create function public.membership_can(uuid,text,jsonb) returns boolean language sql stable security definer as $$select coalesce((select post from private.fixture_permissions where member_id=$1),false)$$;
create function public.membership_has_explicit_deny(uuid,text,jsonb) returns boolean language sql stable as $$select false$$;
create function private.finance_expense_optional_permission_allows(uuid,text,text,jsonb) returns boolean language sql stable security definer as $$select coalesce((select p.subjects from private.fixture_permissions p join public.membership_users m on m.id=p.member_id where m.tenant_id=$1 and m.legacy_finance_user_id=$2),false)$$;
grant usage on schema public,auth to authenticated;
grant select on public.expense_requests to authenticated;
`;
async function admin(sql,args){await db.exec('set session authorization postgres');return args?db.query(sql,args):db.exec(sql);}
async function as(id=actorId){await db.exec('set session authorization postgres');const uid=id==='other'?'00000000-0000-0000-0000-000000000012':auth;
  await db.query("select set_config('test.auth',$1,false),set_config('test.tenant',$2,false)",[id==='anonymous'?'':uid,tenant]);await db.exec('set session authorization authenticated');}
async function state(id){await admin('select 1');return (await db.query('select to_jsonb(r) r from public.expense_requests r where id=$1',[id])).rows[0].r;}
async function create(id,extra={}){const r={id,no:id,tenant_id:tenant,data_environment:'test',applicant_id:'applicant',applicant:'Anonymous applicant',entity_id:'E1',department_code:'D1',type:'payment_request',amount:1050,bank_fee_amount:0,status:'pending_voucher',step:2,ver:1,
  debit_account:'6299',debit_account_name:'Other expense',credit_account:'1112',credit_account_name:'Bank',
  form_payload:{accountingLines:[clone(original)],originalProtected:'retained'},
  steps:[{rk:'cashier',uid:'cashier',a:'approved',n:'Anonymous cashier',t:'09/01',files:[]},{rk:'accountant_final',uid:actorId,a:'',n:'',t:'',c:'',files:[],status:'pending_voucher'}],...extra};
  await admin('insert into public.expense_requests select * from jsonb_populate_record(null::public.expense_requests,$1)',[JSON.stringify(r)]);return r;}
function human(old,changes={},actor=actorId){const next={...clone(old),...changes},at=new Date().toISOString(),who={id:actor,name:actorName,role:'accountant'},fields=Object.keys(changes).filter(k=>['netAmount','taxAmount','grossAmount','debitAccount','creditAccount'].includes(k)),event={at,actor:who,source:'approval_modal_review',changes:{}};
  for(const k of fields)event.changes[k]={before:old[k],after:next[k]};return {...next,manualOverride:true,valueAuthority:'human',manualFields:[...new Set([...(old.manualFields||[]),...fields])],manualOverrideBy:who,manualOverrideAt:at,manualOverrideSource:event.source,manualOverrideHistory:[...(old.manualOverrideHistory||[]),event],reviewedBy:actorName,reviewedAt:at};}
function entries(lines,r){const e=[];for(const line of lines){if(line.netAmount)e.push({t:'dr',ac:line.debitAccount,amt:line.netAmount});if(line.taxAmount)e.push({t:'dr',ac:'1144',amt:line.taxAmount});}
  if(r.type==='petty_cash_request'){e.push({t:'cr',ac:'1111',amt:r.amount},{t:'dr',ac:'1111',amt:r.amount},{t:'cr',ac:'1112',amt:r.amount+(r.bank_fee_amount||0)});}else{for(const line of lines)e.push({t:'cr',ac:line.creditAccount,amt:line.grossAmount});if(r.bank_fee_amount)e.find(x=>x.t==='cr').amt+=r.bank_fee_amount;}
  if(r.bank_fee_amount)e.push({t:'dr',ac:'6290',amt:r.bank_fee_amount});return e;}
async function call(r,lines,opts={}){await as(opts.actor);const at=new Date().toISOString(),date=(await db.query("select to_char(now() at time zone 'Asia/Taipei','MM/DD') d")).rows[0].d,steps=clone(r.steps),last=steps.at(-1);
  last.a='approved';last.n=actorName;last.t=date;last.c='簽核通過（'+actorName+'，'+date+'）';last.actionLog=[...(last.actionLog||[]),{action:'簽核通過',by:actorName,byId:actorId,at,comment:''}];
  const es=opts.entries||entries(lines,r),total=es.filter(e=>e.t==='dr').reduce((s,e)=>s+e.amt,0),vid=opts.voucher||'V_'+r.id;
  return (await db.query('select public.finalize_expense_request($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) result',
    [r.id,'completed',steps.length,JSON.stringify(opts.steps||steps),opts.amount??r.amount,opts.fee??r.bank_fee_amount,vid,vid,'ignored',JSON.stringify(es),total,'Anonymous test',opts.date||at.slice(0,10),JSON.stringify(opts.payload||{accountingLines:lines})])).rows[0].result;}
async function deny(label,fn,codes=['42501','22023','23514','23503','23505','40001','55000','P0002']){let e;try{await fn();}catch(x){e=x;}assert(e&&codes.includes(e.code),label+': '+(e&&e.message));check(label);}
async function assertUntouched(r){const saved=await state(r.id);assert.deepEqual(saved.form_payload,r.form_payload);assert.equal(saved.status,'pending_voucher');assert.equal((await db.query('select count(*)::int n from public.vouchers where request_id=$1',[r.id])).rows[0].n,0);assert.equal((await db.query('select count(*)::int n from public.ledger_entries where source_id=$1',[r.id])).rows[0].n,0);}
(async()=>{try{
  await db.exec(schema);await db.exec(read('scripts/fixtures/finance_finalize_dependencies_20260908.sql'));
  await db.exec('create trigger trg_zz_finance_preserve_human_accounting_authority before update on public.expense_requests for each row execute function private.finance_preserve_human_accounting_authority();create trigger trg_zz_finance_sync_request_accounting_lines after insert or update of form_payload on public.expense_requests for each row execute function private.finance_sync_request_accounting_lines()');
  await db.exec(read('scripts/fixtures/finance_finalize_expense_baseline_20260908.sql'));
  await db.exec("revoke all on function public.finalize_expense_request(text,text,integer,jsonb,numeric,numeric,text,text,text,jsonb,numeric,text,date,jsonb) from public;grant execute on function public.finalize_expense_request(text,text,integer,jsonb,numeric,numeric,text,text,text,jsonb,numeric,text,date,jsonb) to authenticated");
  await db.query('insert into public.finance_users values($1,$2,$3,$4,$5,$6,true),($7,$2,$8,$7,$9,$10,true)',[actorId,tenant,auth,actorName,'accountant@invalid','accountant','other','00000000-0000-0000-0000-000000000012','other@invalid','employee']);
  await db.query("insert into public.membership_users values($1,$2,$3,$1,'active'),($4,$2,'other',$4,'active')",[auth,tenant,actorId,'00000000-0000-0000-0000-000000000012']);
  await db.query('insert into private.fixture_permissions values($1,true,true),($2,false,false)',[auth,'00000000-0000-0000-0000-000000000012']);
  await db.query('insert into public.system_settings values($1,$2,$3)',[tenant,'accounts',JSON.stringify([['6299','Other expense'],['6207','Repairs'],['1144','Input tax'],['1111','Petty cash'],['1112','Bank'],['1191','Advance'],['6290','Bank fee']].map(([c,n])=>({c,n,on:true})))]);
  await db.query('insert into public.system_settings values($1,$2,$3)',[tenant,'entities',JSON.stringify([{id:'E1',full:'Anonymous company'}])]);
  const old=await create('baseline-drift'),reviewed=human(original,{debitAccount:'6207',debitAccountName:'Repairs',netAmount:1050,taxAmount:0});
  await call(old,[reviewed]);const oldSaved=await state(old.id);check('Real old finalizer reproduces successful ledger with stale source lines',oldSaved.form_payload.accountingLines[0].debitAccount==='6299'&&(await db.query("select count(*)::int n from public.ledger_entries where source_id=$1 and account_code='6207'",[old.id])).rows[0].n===1);
  const beforeAcl=(await db.query("select proacl from pg_proc where oid='public.finalize_expense_request(text,text,integer,jsonb,numeric,numeric,text,text,text,jsonb,numeric,text,date,jsonb)'::regprocedure")).rows[0].proacl;
  await db.exec('begin;'+migration+'\ncommit;');check('Migration preserves existing finalizer execute ACL',JSON.stringify((await db.query("select proacl from pg_proc where oid='public.finalize_expense_request(text,text,integer,jsonb,numeric,numeric,text,text,text,jsonb,numeric,text,date,jsonb)'::regprocedure")).rows[0].proacl)===JSON.stringify(beforeAcl));
  for(const type of ['payment_request','expense_reimbursement','purchase_request','hr_expense_request','petty_cash_request']){
    const r=await create('saved-'+type,{type,bank_fee_amount:15,...(type==='purchase_request'?{actual_amount:1050,actual_files:[{path:'receipt'},{path:'proof'}]}:{})}),line=clone(reviewed);await call(r,[line],{payload:{purchaseFinalizedAmount:1050,accountingLines:[line],cashAmount:999,applicantProfile:{id:'forged'},accountingCorrection:{status:'applied'}}});
    const saved=await state(r.id),app=(await db.query('select payload from public.application_accounting_lines where request_id=$1',[r.id])).rows[0].payload;
    check(type+' stores final source, normalized rows, header and human audit atomically',saved.form_payload.accountingLines[0].debitAccount==='6207'&&saved.debit_account==='6207'&&saved.debit_account_name==='Repairs'&&saved.form_payload.accountingLines[0].netAmount===1050&&JSON.stringify(app)===JSON.stringify(saved.form_payload.accountingLines[0])&&(await db.query("select count(*)::int n from public.module_audit_logs where row_id=$1 and action='HUMAN_ACCOUNTING_SYNC'",[r.id])).rows[0].n===1);
    check(type+' ignores unapproved payload keys',saved.form_payload.cashAmount===undefined&&saved.form_payload.applicantProfile===undefined&&saved.form_payload.accountingCorrection===undefined&&saved.form_payload.originalProtected==='retained');
    const retry=await call(r,[original]);check(type+' posted retry is idempotent and cannot overwrite accounting',retry.idempotent===true&&(await state(r.id)).form_payload.accountingLines[0].debitAccount==='6207');
  }
  const cases=[
    ['anonymous caller',{}, {actor:'anonymous'}],['non-accountant employee',{}, {actor:'other'}],
    ['locked principal changed',{}, {amount:1150}],['fee changed',{}, {fee:100}],
    ['balanced voucher subject differs',{}, {entries:[{t:'dr',ac:'6299',amt:1050},{t:'cr',ac:'1112',amt:1050}]}],
    ['nonexistent subject',{}, {lines:[{...reviewed,debitAccount:'missing'}]}],
    ['forged human actor',{}, {lines:[human(original,{debitAccount:'6207'},'other')]}],
    ['changed human value without new audit',{}, {lines:[{...original,debitAccount:'6207'}]}],
    ['duplicate line IDs',{}, {lines:[{...reviewed,grossAmount:525,netAmount:525},{...reviewed,grossAmount:525,netAmount:525}]}],
    ['invalid negative net',{}, {lines:[{...reviewed,netAmount:-1}]}],
    ['locked system fee as principal',{}, {lines:[{...reviewed,systemFee:true}]}],
    ['cleared line array',{}, {lines:[]}],['wrong source tenant',{tenant_id:otherTenant},{}]
  ];
  for(const [label,extra,opts] of cases){const r=await create('reject-'+(++sequence),extra),lines=opts.lines||[reviewed];await deny(label,()=>call(r,lines,opts));await assertUntouched(r);}
  const subject=await create('subject-denied');await admin('update private.fixture_permissions set subjects=false where member_id=$1',[auth]);await deny('Current subject edit deny enforced',()=>call(subject,[reviewed]));await assertUntouched(subject);await admin('update private.fixture_permissions set subjects=true where member_id=$1',[auth]);
  const frozen=await create('frozen');const badSteps=clone(frozen.steps);badSteps[0].uid='other';await deny('Cannot rewrite historical approvals',()=>call(frozen,[reviewed],{steps:badSteps}));await assertUntouched(frozen);
  const stale=await create('stale-human',{form_payload:{accountingLines:[reviewed]}});const staleNext={...clone(reviewed),debitAccount:'6299'};await deny('Saved human accounting cannot be replaced by stale revision',()=>call(stale,[staleNext]));await assertUntouched(stale);
  const next=human(reviewed,{debitAccount:'6299',debitAccountName:'Other expense'});await call(stale,[next]);check('Fresh human revision preserves full previous history',(await state(stale.id)).form_payload.accountingLines[0].manualOverrideHistory.length===2);
  const unchanged=await create('unchanged');await call(unchanged,[original]);check('Unchanged AI suggestion can still be explicitly finalized',(await state(unchanged.id)).status==='completed');
  const closed=await create('closed');await admin("insert into public.period_closes values($1,'test','E1','2026-09','closed')",[tenant]);await deny('Existing closed-period guard still denies',()=>call(closed,[reviewed],{date:'2026-09-08'}));await assertUntouched(closed);await admin('delete from public.period_closes');
  const conflict=await create('voucher-conflict');await admin("insert into public.vouchers(id,no,request_id) values('V_conflict','V_conflict','unrelated')");await deny('Voucher insert failure rolls back request and normalized lines',()=>call(conflict,[reviewed],{voucher:'V_conflict'}));await assertUntouched(conflict);
  const ledger=await create('ledger-conflict');await admin("insert into public.ledger_entries(posting_key) values($1)",['tenant:'+tenant+':expense:'+ledger.no+':1:6207:dr']);await deny('Ledger insert failure rolls back voucher, lines and audit',()=>call(ledger,[reviewed]));await assertUntouched(ledger);check('Failed ledger insert leaves no manual sync audit',(await db.query('select count(*)::int n from public.module_audit_logs where row_id=$1',[ledger.id])).rows[0].n===0);
  const initial=await create('initial-funding',{type:'petty_cash_request',petty_mode:'initial',debit_account:'1111',debit_account_name:'Petty cash'});await call(initial,[original],{entries:[{t:'dr',ac:'1111',amt:1050},{t:'cr',ac:'1112',amt:1050}]});check('Initial petty funding retains its existing asset-only contract',(await state(initial.id)).status==='completed');
  for(const actual of [900,1000,1100]){
    const id='advance-'+actual,advanceNo='ADV_'+id,at=new Date().toISOString(),advanceEntries=[{t:'dr',ac:'1191',an:'Advance',dept:'D1',amt:1000},{t:'cr',ac:'1112',an:'Bank',dept:'D1',amt:1000}];
    const r=await create(id,{type:'advance_request',amount:1000,estimated_amount:1000,actual_amount:actual,cash_posted_at:at,actual_files:[{path:'receipt'},{path:'proof'}],form_payload:{accountingLines:[original],advanceDisbursementVoucherId:advanceNo,advanceDisbursementPostedAt:at,advanceDisbursementAmount:1000,advanceDisbursementBankFee:0}});
    await admin('insert into public.vouchers(id,no,request_id,entity_id,entries,total,posted,posted_at,tenant_id,data_environment) values($1,$1,$2,$3,$4,1000,true,$5,$6,$7)',[advanceNo,id,'E1',JSON.stringify(advanceEntries),at,tenant,'test']);
    for(const [i,e] of advanceEntries.entries())await db.query('insert into public.ledger_entries(tenant_id,data_environment,voucher_no,source_type,source_id,reference_no,entity_id,department_code,posting_key,account_code,account_name,debit,credit) values($1,$2,$3,$4,$5,$5,$6,$7,$8,$9,$10,$11,$12)',[tenant,'test',advanceNo,'advance_disbursement',id,'E1','D1','tenant:'+tenant+':advance_disbursement:'+id+':'+(i+1),e.ac,e.an,e.t==='dr'?e.amt:0,e.t==='cr'?e.amt:0]);
    const es=[{t:'dr',ac:'6207',amt:actual},{t:'cr',ac:'1191',amt:1000}];if(actual<1000)es.push({t:'dr',ac:'1112',amt:1000-actual});if(actual>1000)es.push({t:'cr',ac:'1112',amt:actual-1000});
    await call(r,[original],{amount:actual,entries:es,payload:{advanceFinalAmount:actual,advanceOriginalAmount:1000,advanceSettlementConfirmed:true,accountingLines:[original]}});
    check('Advance settlement '+actual+' retains verified original-disbursement and difference contract',(await state(id)).form_payload.advanceFinalAmount===actual);
  }
  // The deployed amount-correction trigger remains authoritative even after
  // finalizer validation. No test permission marker bypasses its private row.
  await admin('create table private.expense_accounting_corrections_v1(id uuid,tenant_id uuid,data_environment text,request_id text,status text,writing_transaction text)');
  const correctionGuard=read('supabase/migrations/20260907154742_expense_accounting_correction_workflow_v1.sql').match(/create function private\.finance_expense_correction_guard_v1\(\)[\s\S]*?\$function\$;/)[0];
  await db.exec(correctionGuard+'create trigger trg_finance_expense_correction_guard_v1 before update on public.expense_requests for each row execute function private.finance_expense_correction_guard_v1()');
  const pending=await create('pending-correction');await admin("insert into private.expense_accounting_corrections_v1 values(gen_random_uuid(),$1,'test',$2,'pending_review',null)",[tenant,pending.id]);
  await deny('Deployed pending correction still blocks finalization',()=>call(pending,[reviewed]));await assertUntouched(pending);
  // Execute the original audit postflight's pure human-history contract after
  // applying this migration; it shares the same unmodified merge functions.
  await admin('select 1');const audit=read('scripts/finance_approval_audit_postflight.sql'),start=audit.indexOf(" select jsonb_agg(jsonb_build_object('operationId','saved-'"),end=audit.indexOf(" if not exists(select 1 from information_schema.columns",start);
  assert(start>0&&end>start);await db.exec('do $$ declare v_history jsonb;v_old jsonb;v_event jsonb;v_new jsonb;v_result jsonb;v_conflict boolean:=false;begin\n'+audit.slice(start,end)+'\nend;$$;');check('Deployed audit 50-event append and stale-revision contracts remain valid');
  await db.exec(read('scripts/finance_finalize_accounting_lines_postflight.sql').replace(/^\\set ON_ERROR_STOP on\s*/,''));check('Repeatable readonly final-accounting postflight passes');
  // Run the actual release canary text against anonymous identity/org fixtures.
  // The candidate SQL, role switch, finalizer and rollback checks are unmodified.
  await db.exec(`create table auth.users(id uuid,email_confirmed_at timestamptz,is_anonymous boolean);create table auth.identities(user_id uuid,provider text);
    create table public.finance_department_units(id uuid,tenant_id uuid,code text,active boolean,present_in_source boolean,is_posting_unit boolean);
    create table public.finance_department_entity_scopes(tenant_id uuid,unit_id uuid,entity_code text,active boolean);
    alter table public.employee_department_roles add column metadata jsonb;
    alter table public.expense_requests add column applicant_email text;
    create table public.notification_delivery_events(request_id text,payload jsonb);
    create table public.cash_movement_evidence_links(source_id text,source_no text);
    create function public.finance_user_is_approval_identity_ready(uuid,text) returns boolean language sql stable as $$select exists(select 1 from public.finance_users where tenant_id=$1 and id=$2 and active and auth_user_id is not null)$$;
    create function private.finance_org_effective_now_v2(jsonb) returns boolean language sql stable as $$select ($1->>'active')::boolean and ($1->>'effective_from')::date<=current_date and (($1->>'effective_to') is null or ($1->>'effective_to')::date>=current_date)$$;
    create or replace function auth.uid() returns uuid language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('test.auth',true),''))::uuid$$;
    create or replace function public.current_tenant_id() returns uuid language sql stable as $$select coalesce(nullif(current_setting('app.current_tenant_id',true),''),nullif(current_setting('test.tenant',true),''))::uuid$$;`);
  await db.query('insert into auth.users values($1,now(),false);',[auth]);await db.query("insert into auth.identities values($1,'google')",[auth]);
  await db.query("insert into public.employee_department_roles values($1,$2,'D1','accountant',true,true,current_date,null,'{}')",[tenant,actorId]);
  await db.query("insert into public.finance_department_units values($1,$2,'J1101',true,true,true)",[auth,tenant]);await db.query("insert into public.finance_department_entity_scopes values($1,$2,'E6',true)",[tenant,auth]);
  const canary=read('scripts/finance_finalize_accounting_lines_canary.sql'),out=await db.exec(canary);assert.deepEqual(out.at(-1).rows[0].finalize_accounting_canary_result,{canary:'authenticated_finalize_accounting_lines',ok:true,rolled_back:true,accounting_lines_consistent:true});check('Actual authenticated release canary executes and rolls back every fixture row');
  check('Historical posted request was not backfilled',(await state(old.id)).form_payload.accountingLines[0].debitAccount==='6299');
  await as();await deny('Private helper not directly callable',()=>db.query("select private.finance_finalize_accounting_patch_v1(null,'{}','[]',1,'accountant')"));
  console.log('OK: '+tests+' final accounting atomic persistence checks passed');
}finally{await db.close();}})().catch(e=>{console.error({message:e.message,code:e.code,where:e.where,detail:e.detail});process.exitCode=1;});
