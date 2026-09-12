'use strict';
// Anonymous transport/schema; actual reviewed correction authority and new RPC.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const root=path.resolve(__dirname,'../..');
const migration=()=>fs.readFileSync(path.join(root,'supabase/migrations/20260912145849_finance_employee_payment_concerns_v1.sql'),'utf8');
async function createEmployeePaymentConcernsFixture(db,{install=false}={}){
const tenant='00000000-0000-0000-0000-000000000001',otherTenant='00000000-0000-0000-0000-000000000002';
const ids={employee:randomUUID(),other:randomUUID(),cashier:randomUUID(),accountant:randomUUID(),legacy:randomUUID(),foreign:randomUUID()};
const helpers=fs.readFileSync(path.join(root,'supabase/migrations/20260907154742_expense_accounting_correction_workflow_v1.sql'),'utf8');
 await db.exec(`create schema private;create schema auth;create role anon;create role authenticated;create role service_role;
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 create function public.current_tenant_id() returns uuid language sql stable as $$select nullif(current_setting('app.current_tenant_id',true),'')::uuid$$;
 create table finance_users(id text primary key,tenant_id uuid,auth_user_id uuid,name text,role text,active bool,email text);
 create function public.default_tenant_id() returns uuid language sql stable as $$select '00000000-0000-0000-0000-000000000001'::uuid$$;
 create function public.finance_user_is_approval_identity_ready(t uuid,u text) returns boolean language sql stable security definer as $$select exists(select 1 from finance_users where id=u and tenant_id=t and active and auth_user_id is not null)$$;
 create table employee_department_roles(tenant_id uuid,finance_user_id text,department_code text,role_key text,active bool default true,can_approve bool default true,effective_from date default current_date,effective_to date);
 create function finance_org_role_members(text,text) returns table(finance_user_id text,can_approve bool) language sql stable as $$select r.finance_user_id,r.can_approve from public.employee_department_roles r where r.tenant_id=public.current_tenant_id() and r.role_key=$1 and r.active$$;
 create table expense_requests(id text primary key,no text,tenant_id uuid,data_environment text,applicant_id text,department_code text,entity_id text,cash_posted_at timestamptz,voided_at timestamptz,amount numeric,status text,steps jsonb,voucher_id text,ledger_posted_at timestamptz);
 create function public.can_read_expense_request(public.expense_requests) returns boolean language sql stable as $$select $1.tenant_id=public.current_tenant_id() and coalesce(current_setting('test.read',true),'true')<>'false'$$;
 create function private.finance_expense_optional_permission_allows(uuid,text,text,jsonb) returns boolean language sql stable as $$select coalesce(current_setting('test.permission',true),'true')<>'false'$$;
 grant usage on schema public,auth to authenticated;`);
 for(const [id,auth] of Object.entries(ids)){await db.query("insert into finance_users values($1,$2,$3,$1,$4,true,$1||'@example.invalid')",[id,id==='foreign'?otherTenant:tenant,auth,['cashier','accountant'].includes(id)?id:id==='legacy'?'cashier':'employee']);}
 await db.query("insert into employee_department_roles(tenant_id,finance_user_id,role_key) values($1,'cashier','cashier'),($1,'accountant','accountant')",[tenant]);
 for(const n of ['actor','role','permission']){const re=new RegExp('create function private\\.finance_correction_'+n+'_v1\\([\\s\\S]*?\\$function\\$;');const m=helpers.match(re);assert(m,n);await db.exec(m[0]);}
 if(install)await db.exec('begin;'+migration()+'commit;');
 await db.query("insert into expense_requests values('paid','TEST001',$1,'test','employee','D1','E1',now(),null,100,'completed','[]','V1',now()),('unpaid','TEST002',$1,'test','employee','D1','E1',null,null,100,'pending_cashier','[]',null,null),('void','TEST003',$1,'test','employee','D1','E1',now(),now(),100,'void','[]',null,null),('foreign','TEST004',$2,'test','foreign','D2','E2',now(),null,100,'completed','[]',null,null)",[tenant,otherTenant]);
 await db.exec(`alter table expense_requests add column applicant text,add column applicant_email text,add column type text,add column type_label text,add column description text,add column step integer,add column ver integer,add column request_date date,add column bank_fee_amount numeric,add column files jsonb,add column actual_files jsonb,add column form_payload jsonb;
 create table public.finance_department_units(tenant_id uuid,id uuid,code text,active boolean,present_in_source boolean,is_posting_unit boolean);
 create table public.finance_department_entity_scopes(tenant_id uuid,unit_id uuid,entity_code text,active boolean);
 insert into public.finance_department_units values('${tenant}','11111111-1111-1111-1111-111111111111','J1101',true,true,true);
 insert into public.finance_department_entity_scopes values('${tenant}','11111111-1111-1111-1111-111111111111','E6',true);
 create table public.vouchers(id text primary key,request_id text);
 create table public.ledger_entries(id uuid primary key default gen_random_uuid(),source_id text);
 create table public.notification_delivery_events(id text,request_id text,payload jsonb);
 create table public.module_audit_logs(id text,row_id text);
 create table public.approval_step_actor_snapshots(id text,record_id text);
 create table public.application_accounting_lines(id text,request_id text);
 create table public.cash_movement_evidence_links(id text,source_id text,source_no text);`);
return {tenant,otherTenant,ids,migration};
}
module.exports={createEmployeePaymentConcernsFixture,migration};
