'use strict';
// Reusable anonymous local PostgreSQL fixture. Actual reporting identity/page
// and optional Membership helpers are loaded from reviewed sources. Only their
// authenticated transport/current membership boundary is fictional.
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const migration=()=>read('supabase/migrations/20260911151054_finance_audit_readiness_v1.sql');
async function createAuditReadinessFixture(db,{install=false}={}){
 const tenant='00000000-0000-0000-0000-000000000001',other='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema private;
 create table public.finance_users(id text primary key,name text,email text,role text,tenant_id uuid,auth_user_id uuid,active boolean,google_link_status text);
 create table public.system_settings(tenant_id uuid,key text,value jsonb,primary key(tenant_id,key));
 create table public.finance_department_units(tenant_id uuid,id uuid,code text,active boolean,is_posting_unit boolean);
 create table public.finance_department_entity_scopes(tenant_id uuid,unit_id uuid,entity_code text,active boolean);
 create table public.invoices(id text primary key,tenant_id uuid,entity_id text,data_environment text,department_code text,invoice_date date,amount numeric,tax numeric,total numeric,description text,files jsonb,voided_at timestamptz);
 create table public.expense_requests(id text primary key,tenant_id uuid,entity_id text,data_environment text,department_code text,date date,amount numeric,form_payload jsonb,files jsonb,voided_at timestamptz);
 create table public.ledger_entries(id uuid default gen_random_uuid() primary key,tenant_id uuid,entity_id text,data_environment text,department_code text,entry_date date,debit numeric,credit numeric,account_code text,source_id text,voided_at timestamptz);
 create function public.default_tenant_id() returns uuid language sql stable as $$select '${tenant}'::uuid$$;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function public.current_tenant_id() returns uuid language sql stable as $$select nullif(current_setting('app.current_tenant_id',true),'')::uuid$$;
 create function public.current_finance_user_id() returns text language sql stable security definer as $$select id from public.finance_users where auth_user_id=auth.uid() and tenant_id=public.current_tenant_id() and active$$;
 create function public.current_finance_role() returns text language sql stable security definer as $$select role from public.finance_users where id=public.current_finance_user_id()$$;
 create function public.is_finance_admin() returns boolean language sql stable as $$select public.current_finance_role() in ('ceo','admin_director')$$;
 create function public.finance_user_is_approval_identity_ready(t uuid,u text) returns boolean language sql stable security definer as $$select exists(select 1 from public.finance_users where tenant_id=t and id=u and active and auth_user_id is not null and google_link_status='bound')$$;
 create function public.can_read_invoice(public.invoices) returns boolean language sql stable as $$select $1.tenant_id=public.current_tenant_id() and coalesce(current_setting('fixture.denied_row',true),'')<>$1.id and (public.current_finance_role() in ('accountant','ceo','admin_director') or current_setting('fixture.explicit_all_source_access',true)='true')$$;
 create function public.can_read_expense_request(public.expense_requests) returns boolean language sql stable as $$select $1.tenant_id=public.current_tenant_id() and coalesce(current_setting('fixture.denied_row',true),'')<>$1.id and (public.current_finance_role() in ('accountant','ceo','admin_director') or current_setting('fixture.explicit_all_source_access',true)='true')$$;
 create table public.membership_users(id uuid,tenant_id uuid,legacy_finance_user_id text,auth_user_id uuid,status text);
 create function public.membership_current_user_id() returns uuid language sql stable as $$select auth.uid()$$;
 create function public.membership_has_explicit_deny(uuid,text,jsonb) returns boolean language sql stable as $$select coalesce(current_setting('fixture.denied_entity',true),'')=$3->>'entity_id' or coalesce(current_setting('fixture.denied_department',true),'')=coalesce($3->>'department_code','__none__')$$;
 create function public.membership_can(uuid,text,jsonb) returns boolean language sql stable as $$select coalesce(current_setting('fixture.permission',true),'true')='true'$$;
 `);
 const helper=read('scripts/fixtures/finance_procurement_payment_helpers_20260908.sql');const start=helper.indexOf('CREATE OR REPLACE FUNCTION private.finance_expense_optional_permission_allows('),end=helper.indexOf('$function$;',start);if(start<0||end<start)throw Error('missing reviewed optional permission helper');await db.exec(helper.slice(start,end+'$function$;'.length));
 const ids={};let i=1;
 for(const role of ['accountant','ceo','admin_director','external_audit','board','employee']){
  const uid=`11111111-1111-1111-1111-${String(i++).padStart(12,'0')}`;ids[role]=uid;
  await db.query('insert into public.finance_users values($1,$1,$2,$1,$3,$4,true,\'bound\')',[role,role+'@example.invalid',tenant,uid]);
 }
 await db.query("insert into public.finance_users values('other-owner','Other','other@example.invalid','accountant',$1,'99999999-9999-9999-9999-999999999999',true,'bound')",[other]);
 await db.exec("insert into public.membership_users select auth_user_id,tenant_id,id,auth_user_id,'active' from public.finance_users");
 for(const t of [tenant,other])await db.query("insert into public.system_settings values($1,'entities',$2),($1,'accounts',$3)",[t,JSON.stringify([{id:'A'},{id:'B'},{id:'EMPTY'}]),JSON.stringify([{c:'1112'},{c:'1123'},{c:'4101'},{c:'6202'}])]);
 await db.query("insert into public.system_settings values($1,'role_permissions',$2)",[tenant,JSON.stringify({accountant:{reports:'edit',settings:'none'},ceo:{reports:'edit',settings:'edit'},admin_director:{reports:'edit',settings:'edit'},external_audit:{reports:'view'},board:{reports:'view'}})]);
 for(const [id,t,e,env,voided] of [['inv-a',tenant,'A','test',null],['inv-b',tenant,'B','test',null],['inv-prod',tenant,'A','production',null],['inv-other',other,'A','test',null],['inv-void',tenant,'A','test','2026-09-01']])await db.query("insert into public.invoices values($1,$2,$3,$4,'D1','2026-08-31',100,5,105,'Fictional','[]',$5)",[id,t,e,env,voided]);
 await db.query("insert into public.expense_requests values('req-a',$1,'A','test','D1','2026-08-31',210,'{\"accountingLines\":[{\"debitAccount\":\"6202\",\"grossAmount\":210}]}','[]',null)",[tenant]);
 await db.query("insert into public.ledger_entries(tenant_id,entity_id,data_environment,department_code,entry_date,debit,credit,account_code,source_id) values($1,'A','test','D1','2026-08-31',105,0,'1123','inv-a'),($1,'A','test','D1','2026-08-31',0,105,'4101','inv-a')",[tenant]);
 await db.exec(read('supabase/migrations/20260910064325_finance_reporting_profiles_v1.sql'));
 async function as(role='accountant',t=tenant){await db.exec('reset role');await db.query("select set_config('app.current_tenant_id',$1,false),set_config('request.jwt.claim.sub',$2,false)",[t,ids[role]||'']);await db.exec('set role authenticated');}
 async function admin(sql,args=[]){await db.exec('reset role');return args.length?db.query(sql,args):db.exec(sql);}
 const state=()=>db.query("select jsonb_build_object('cases',(select jsonb_agg(to_jsonb(r) order by period,revision) from private.finance_audit_cases_v1 r),'history',(select jsonb_agg(to_jsonb(r) order by period,revision) from private.finance_audit_case_revisions_v1 r),'ledger',(select jsonb_agg(to_jsonb(r) order by id) from public.ledger_entries r),'invoices',(select jsonb_agg(to_jsonb(r) order by id) from public.invoices r),'expenses',(select jsonb_agg(to_jsonb(r) order by id) from public.expense_requests r)) x").then(r=>JSON.stringify(r.rows[0].x));
 if(install)await db.exec(migration());
 return {db,tenant,other,ids,as,admin,state,migration,readSource:read};
}
module.exports={createAuditReadinessFixture,migration};
