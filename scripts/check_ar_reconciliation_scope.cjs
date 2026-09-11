#!/usr/bin/env node
'use strict';
// Real canonical SQL, new reconciliation SQL and existing reporting/optional
// permission helpers; only auth and Membership transport are fictional local
// boundaries. No network or production writes.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{PGlite}=require('@electric-sql/pglite');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const existing=read('scripts/check_canonical_receivables.js');
const fixtureHead=existing.slice(existing.indexOf("'use strict';"),existing.indexOf('(async()=>'));
const fixtureSetup=existing.slice(existing.indexOf(' await db.exec(schema'),existing.indexOf(" check('all new private tables"));
const buildFixture=new Function('require','__dirname',fixtureHead+'\nreturn async function(){const db=new PGlite();'+fixtureSetup+'return {db,make,ar,as,admin,fingerprint,tenant,other,today,prior};};')(require,__dirname);
function functionSql(source,start,end){const a=source.indexOf(start);assert(a>=0,start);const b=source.indexOf(end,a);assert(b>a);return source.slice(a,b+end.length);}
const migration=read('supabase/migrations/20260911135457_finance_ar_reconciliation_scope_v1.sql');
let checks=0;function check(label,value){assert.ok(value,label);checks++;console.log('PASS '+label);}
(async()=>{const f=await buildFixture(),{db,make,ar,as,admin,tenant,other,today,prior}=f;try{
 await db.exec(`alter table public.finance_users add column google_link_status text default 'bound';
 create table public.system_settings(tenant_id uuid,key text,value jsonb,primary key(tenant_id,key));
 create function public.current_finance_user_id() returns text language sql stable security definer as $$select id from public.finance_users where auth_user_id=auth.uid() and active$$;
 create or replace function public.is_finance_admin() returns boolean language sql stable as $$select public.current_finance_role() in ('ceo','admin_director')$$;
 create or replace function public.can_read_invoice(public.invoices) returns boolean language sql stable as $$select $1.tenant_id=public.current_tenant_id() and coalesce(current_setting('audit.denied_invoice',true),'')<>$1.id$$;
 create or replace function auth.uid() returns uuid language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('audit.uid',true),''))::uuid$$;
 create function public.finance_user_is_approval_identity_ready(t uuid,u text) returns boolean language sql stable security definer as $$select exists(select 1 from public.finance_users where tenant_id=t and id=u and active and auth_user_id is not null and google_link_status='bound')$$;
 create table public.notification_delivery_events(request_id text,payload jsonb);`);
 const profile=read('supabase/migrations/20260910064325_finance_reporting_profiles_v1.sql');
 await db.exec(functionSql(profile,'create function private.finance_reporting_page_level_v1(','end $$;')+functionSql(profile,'create function private.finance_reporting_actor_v1(','end $$;'));
 await db.exec(functionSql(read('scripts/fixtures/finance_procurement_payment_helpers_20260908.sql'),'CREATE OR REPLACE FUNCTION private.finance_expense_optional_permission_allows(','$function$;'));
 await db.query("insert into public.system_settings values($1,'entities',$2)",[tenant,JSON.stringify([{id:'FICT-CO'},{id:'FICT-OTHER'},{id:'EMPTY'},{id:'E6'}])]);
 await db.query("insert into public.system_settings values($1,'role_permissions',$2)",[tenant,JSON.stringify({accountant:{reports:'edit'},ceo:{reports:'edit'},admin_director:{reports:'edit'}})]);
 async function readAr(entity='FICT-CO',dept=null,date=today,env='test'){await as(db,'accountant');return(await db.query('select public.finance_receivables_v1($1,$2,$3,$4) x',[date,entity,dept,env])).rows[0].x;}
 async function journal(id,amount,opts={}){await admin(db,'select 1');for(const [ac,dr,cr] of [['1123',Math.max(amount,0),Math.max(-amount,0)],['1112',Math.max(-amount,0),Math.max(amount,0)]])await db.query(`insert into public.ledger_entries(tenant_id,data_environment,entry_date,entity_id,department_code,debit,credit,account_code,account_name,reference_no,posting_key,source_type,source_id,source_no,voided_at) values($1,$2,$3,$4,$5,$6,$7,$8,'Fictional',$9,$10,'adjustment',$9,$9,$11)`,[opts.tenant||tenant,opts.env||'test',opts.date||today,opts.entity||'FICT-CO',opts.department||'FICT-D',dr,cr,ac,id,id+':'+ac,opts.voided?new Date().toISOString():null]);}
 await make(db,'FICT-MAPPED',100);await journal('FICT-UNMATCHED-DEBIT',70);await journal('FICT-UNMATCHED-CREDIT',-70);
 const before=(await readAr()).reconciliation;check('old production reader reproduces hidden zero-net differences',before.needsReview===false&&before.unmappedLedgerNet===null);
 await admin(db,'select 1');await db.exec('begin;'+migration+'\nrollback;');check('new migration rehearses and rolls back helpers',(await db.query("select to_regprocedure('private.finance_ar_reconciliation_v1(uuid,text,date,text,text,jsonb)') is null x")).rows[0].x);
 await db.exec('begin;'+migration+'\ncommit;');
 let r=(await readAr()).reconciliation;check('equal debit/credit differences remain visible without changing net',r.reconciliationVisible===true&&r.ledgerNet===100&&r.mappedLedgerNet===100&&r.unmappedDebitAmount===70&&r.unmappedCreditAmount===70&&r.unmappedLedgerNet===0&&r.unmappedEntryCount===2&&r.needsReview===true);
 // Production has no constraint forbidding both sides on one ledger row. A
 // net-zero row must not erase the gross evidence or its review warning.
 for(const [debit,credit,label] of [[70,70,'same-row equal debit and credit retain both gross amounts and review warning'],[90,50,'same-row unequal debit and credit retain gross amounts rather than their residual'],[0,0,'same-row zero debit and credit do not create a false review warning']]){
  await admin(db,'begin');
  for(const [ac,dr,cr] of [['1123',debit,credit],['1112',credit,debit]])await db.query(`insert into public.ledger_entries(tenant_id,data_environment,entry_date,entity_id,department_code,debit,credit,account_code,posting_key,source_type,source_id) values($1,'test',$2,'FICT-CO','FICT-SAME-ROW',$3,$4,$5,$6,'adjustment','FICT-SAME-ROW')`,[tenant,today,dr,cr,ac,'FICT-SAME-ROW:'+ac]);
  r=(await readAr('FICT-CO','FICT-SAME-ROW')).reconciliation;
  check(label,r.reconciliationVisible===true&&r.ledgerNet===debit-credit&&r.mappedLedgerNet===0&&r.unmappedDebitAmount===debit&&r.unmappedCreditAmount===credit&&r.unmappedLedgerNet===debit-credit&&r.unmappedEntryCount===(debit||credit?1:0)&&r.needsReview===Boolean(debit||credit));
  await admin(db,'rollback');
 }
 await journal('FICT-OTHER-DEPT',50,{department:'OTHER'});await journal('FICT-OTHER-CO',60,{entity:'FICT-OTHER'});await journal('FICT-OTHER-ENV',80,{env:'production'});await journal('FICT-OTHER-TENANT',90,{tenant:other});await journal('FICT-FUTURE',100,{date:'2099-01-01'});await journal('FICT-VOID',110,{voided:true});
 r=(await readAr('FICT-CO','FICT-D')).reconciliation;check('company department tenant environment cutoff and void bounds preserved',r.unmappedDebitAmount===70&&r.unmappedCreditAmount===70&&r.ledgerNet===100&&r.unmappedEntryCount===2);
 r=(await readAr('FICT-OTHER')).reconciliation;check('selected second authorized company has independent totals',r.ledgerNet===60&&r.mappedLedgerNet===0&&r.unmappedDebitAmount===60);
 r=(await readAr('EMPTY')).reconciliation;check('verified empty company is explicit complete zero',r.reconciliationVisible&&r.ledgerNet===0&&r.unmappedDebitAmount===0&&r.unmappedCreditAmount===0&&r.needsReview===false);
 r=(await readAr('NOT-IN-CATALOG')).reconciliation;check('unknown company is not reported as confirmed zero',r.reconciliationVisible===false&&r.ledgerNet===null&&r.unmappedDebitAmount===null&&r.needsReview===null);
 await as(db,'employee');r=(await db.query("select public.finance_receivables_v1($1,'FICT-CO',null,'test') x",[today])).rows[0].x.reconciliation;check('ordinary employee cannot see complete company ledger even when invoice is visible',r.reconciliationVisible===false&&r.ledgerNet===null&&r.unmappedDebitAmount===null&&r.unmappedCreditAmount===null&&r.needsReview===null);
 await admin(db,"set audit.denied_invoice='FICT-MAPPED'");r=(await readAr()).reconciliation;check('one unreadable invoice prevents complete ledger disclosure',r.reconciliationVisible===false&&r.ledgerNet===null&&r.needsReview===null);await admin(db,"set audit.denied_invoice=''");
 await admin(db,`update public.system_settings set value=jsonb_set(value,'{accountant,reports}','"none"') where key='role_permissions'`);r=(await readAr()).reconciliation;check('configured reports deny masks reconciliation',r.reconciliationVisible===false&&r.ledgerNet===null);await admin(db,`update public.system_settings set value=jsonb_set(value,'{accountant,reports}','"edit"') where key='role_permissions'`);
 // Install a complete fictional Membership service. The production optional
 // permission helper above must enforce linkage, explicit denies and grants.
 await admin(db,`create table public.membership_users(id uuid,tenant_id uuid,legacy_finance_user_id text,auth_user_id uuid,status text);
 insert into public.membership_users select auth_user_id,tenant_id,id,auth_user_id,'active' from public.finance_users;
 create function public.membership_current_user_id() returns uuid language sql stable as $$select auth.uid()$$;
 create function public.membership_has_explicit_deny(uuid,text,jsonb) returns boolean language sql stable as $$select coalesce(current_setting('audit.denied_entity',true),'')=$3->>'entity_id' or coalesce(current_setting('audit.denied_department',true),'')=coalesce($3->>'department_code','__none__')$$;
 create function public.membership_can(uuid,text,jsonb) returns boolean language sql stable as $$select coalesce(current_setting('audit.member_allow',true),'true')='true'$$;`);
 await admin(db,"set audit.denied_entity='FICT-OTHER'");r=(await readAr()).reconciliation;check('grant for selected company remains available with another company denied',r.reconciliationVisible===true);r=(await readAr('FICT-OTHER')).reconciliation;check('explicitly denied company never exposes ledger totals',r.reconciliationVisible===false&&r.ledgerNet===null);r=(await readAr(null)).reconciliation;check('all-company request masks totals when one company is unauthorized',r.reconciliationVisible===false&&r.needsReview===null);await admin(db,"set audit.denied_entity=''");
 await admin(db,"set audit.denied_department='OTHER'");r=(await readAr()).reconciliation;check('department-restricted grants cannot expose full company unmatched totals',r.reconciliationVisible===false);r=(await readAr('FICT-CO','FICT-D')).reconciliation;check('fully authorized department may still reconcile',r.reconciliationVisible===true&&r.ledgerNet===100);await admin(db,"set audit.denied_department=''");
 await admin(db,"set audit.member_allow='false'");r=(await readAr()).reconciliation;check('revoked Membership grant cannot fall back to accountant role',r.reconciliationVisible===false);await admin(db,"set audit.member_allow='true'");
 await admin(db,"update public.membership_users set legacy_finance_user_id='wrong' where legacy_finance_user_id='accountant'");r=(await readAr()).reconciliation;check('incorrect Membership identity linkage fails closed',r.reconciliationVisible===false);await admin(db,"update public.membership_users set legacy_finance_user_id='accountant' where legacy_finance_user_id='wrong'");
 await as(db,'none');let denied=false;try{await db.query("select public.finance_receivables_v1($1,null,null,'test')",[today]);}catch(e){denied=e.code==='42501';}check('anonymous RPC remains denied',denied);
 await admin(db,'select 1');for(const file of ['scripts/finance_canonical_receivables_postflight.sql','scripts/finance_ar_reconciliation_postflight.sql'])await db.exec(read(file).replace(/^\\set ON_ERROR_STOP on\r?\n/,''));check('old and new readonly postflight both pass unchanged',true);
 const fingerprint=()=>db.query("select jsonb_build_object('invoices',(select jsonb_agg(to_jsonb(i) order by id) from public.invoices i),'ledger',(select jsonb_agg(to_jsonb(l) order by posting_key) from public.ledger_entries l)) x").then(r=>JSON.stringify(r.rows[0].x));
 const saved=await fingerprint();const output=await db.exec(read('scripts/finance_ar_reconciliation_canary.sql'));check('exact authenticated canary verifies real RPC scope and signed differences',output.some(r=>r.rows?.some(x=>x.ar_reconciliation_canary_result?.scope_preserved===true)));check('canary rollback preserves source invoices and journals',await fingerprint()===saved);
 await admin(db,`create table auth.users(id uuid,email_confirmed_at timestamptz,is_anonymous boolean default false);
 create table auth.identities(user_id uuid,provider text);insert into auth.users select auth_user_id,now(),false from public.finance_users;insert into auth.identities select auth_user_id,'google' from public.finance_users;
 create function public.current_finance_user() returns public.finance_users language sql stable security definer as $$select * from public.finance_users where auth_user_id=auth.uid()$$;
 alter table public.employee_department_roles add column metadata jsonb default '{}';
 create function private.finance_org_effective_now_v2(jsonb) returns boolean language sql stable as $$select ($1->>'active')::boolean and ($1->>'effective_from')::date<=current_date and (nullif($1->>'effective_to','') is null or ($1->>'effective_to')::date>=current_date)$$;
 create table public.finance_department_units(id uuid,tenant_id uuid,code text,active boolean,present_in_source boolean,is_posting_unit boolean);
 create table public.finance_department_entity_scopes(tenant_id uuid,unit_id uuid,active boolean,entity_code text);
 insert into public.finance_department_units values('00000000-0000-0000-0000-000000000044','${tenant}','J1101',true,true,true);
 insert into public.finance_department_entity_scopes values('${tenant}','00000000-0000-0000-0000-000000000044',true,'E6');
 alter table public.invoices add column applicant text;
 insert into public.revenue_recognition_rules(id,tenant_id,active,effective_from,priority,revenue_account_code) values('00000000-0000-0000-0000-000000000055','${tenant}',true,'2020-01-01',1,'4111');`);
 const beforeLegacy=await f.fingerprint(db),legacy=await db.exec(read('scripts/finance_canonical_receivables_canary.sql'));check('unchanged canonical receipt/refund canary remains compatible with new response',legacy.some(r=>r.rows?.some(x=>x.canonical_receivables_canary_result?.receivables_consistent)));check('legacy canary preserves all source monetary fingerprints',await f.fingerprint(db)===beforeLegacy);
 console.log('AR reconciliation: '+checks+' checks passed. Local fixtures only.');
 }finally{await db.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
