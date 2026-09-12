'use strict';
// Real reviewed actor/role/permission helpers and candidate RPC in PostgreSQL.
// The supporting schema and role projection are anonymous local fixtures.
const fs=require('fs'),assert=require('node:assert/strict'),{PGlite}=require('@electric-sql/pglite');
const {randomUUID}=require('crypto');
const migration=fs.readFileSync('supabase/migrations/20260912145849_finance_employee_payment_concerns_v1.sql','utf8');
const helpers=fs.readFileSync('supabase/migrations/20260907154742_expense_accounting_correction_workflow_v1.sql','utf8');
const tenant='00000000-0000-0000-0000-000000000001',otherTenant='00000000-0000-0000-0000-000000000002';
const ids={employee:randomUUID(),other:randomUUID(),cashier:randomUUID(),accountant:randomUUID(),legacy:randomUUID(),foreign:randomUUID()};
let checks=0;
const ok=(v,label)=>{assert(v,label);checks++;};
const db=new PGlite();
async function admin(sql,args){await db.exec('reset role');return args?db.query(sql,args):db.exec(sql);}
async function as(actor){await db.exec('reset role');await db.query("select set_config('test.uid',$1,false),set_config('test.tenant',$2,false),set_config('test.permission','true',false),set_config('test.read','true',false)",[ids[actor],actor==='foreign'?otherTenant:tenant]);await db.exec('set role authenticated');}
async function act(actor,id,action,version,key=randomUUID(),message='測試說明',env='test'){
 await as(actor);return (await db.query('select public.finance_payment_concern_action_v1($1,$2,$3,$4,$5,$6) data',[id,action,message,version,key,env])).rows[0].data;
}
async function read(actor,id=null,env='test'){await as(actor);return(await db.query('select public.finance_payment_concern_read_v1($1,$2) data',[id,env])).rows[0].data;}
async function deny(label,fn,code='42501'){await assert.rejects(fn,e=>e.code===code,label);checks++;}
(async()=>{try{
 await db.exec(`create schema private;create schema auth;create role anon;create role authenticated;create role service_role;
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid',true),'')::uuid $$;
 create function public.current_tenant_id() returns uuid language sql stable as $$select nullif(current_setting('test.tenant',true),'')::uuid$$;
 create table finance_users(id text primary key,tenant_id uuid,auth_user_id uuid,name text,role text,active bool);
 create table employee_department_roles(tenant_id uuid,finance_user_id text,department_code text,role_key text,active bool default true,can_approve bool default true,effective_from date default current_date,effective_to date);
 create function finance_org_role_members(text,text) returns table(finance_user_id text,can_approve bool) language sql stable as $$select r.finance_user_id,r.can_approve from public.employee_department_roles r where r.tenant_id=public.current_tenant_id() and r.role_key=$1 and r.active$$;
 create table expense_requests(id text primary key,no text,tenant_id uuid,data_environment text,applicant_id text,department_code text,entity_id text,cash_posted_at timestamptz,voided_at timestamptz,amount numeric,status text,steps jsonb,voucher_id text,ledger_posted_at timestamptz);
 create function public.can_read_expense_request(public.expense_requests) returns boolean language sql stable as $$select $1.tenant_id=public.current_tenant_id() and coalesce(current_setting('test.read',true),'true')<>'false'$$;
 create function private.finance_expense_optional_permission_allows(uuid,text,text,jsonb) returns boolean language sql stable as $$select coalesce(current_setting('test.permission',true),'true')<>'false'$$;
 grant usage on schema public,auth to authenticated;`);
 for(const [id,auth] of Object.entries(ids)){await db.query('insert into finance_users values($1,$2,$3,$1,$4,true)',[id,id==='foreign'?otherTenant:tenant,auth,['cashier','accountant'].includes(id)?id:id==='legacy'?'cashier':'employee']);}
 await db.query("insert into employee_department_roles(tenant_id,finance_user_id,role_key) values($1,'cashier','cashier'),($1,'accountant','accountant')",[tenant]);
 for(const n of ['actor','role','permission']){const re=new RegExp('create function private\\.finance_correction_'+n+'_v1\\([\\s\\S]*?\\$function\\$;');const m=helpers.match(re);assert(m,n);await db.exec(m[0]);}
 await db.exec('begin;'+migration+'commit;');
 await db.query("insert into expense_requests values('paid','TEST001',$1,'test','employee','D1','E1',now(),null,100,'completed','[]','V1',now()),('unpaid','TEST002',$1,'test','employee','D1','E1',null,null,100,'pending_cashier','[]',null,null),('void','TEST003',$1,'test','employee','D1','E1',now(),now(),100,'void','[]',null,null),('foreign','TEST004',$2,'test','foreign','D2','E2',now(),null,100,'completed','[]',null,null)",[tenant,otherTenant]);
 const original=JSON.stringify((await db.query('select * from expense_requests order by id')).rows);
 ok((await read('employee','paid')).canReport,'Owner can report after payment even when request closed');
 await deny('Other employee cannot see concern',()=>read('other','paid'));
 await deny('Unbound legacy role cannot handle',()=>read('legacy','paid'));
 await deny('Tenant boundary',()=>read('foreign','paid'));
 await deny('Environment boundary',()=>read('employee','paid','production'));
 await deny('Unpaid cannot report',()=>act('employee','unpaid','report',0));
 await deny('Voided cannot report',()=>act('employee','void','report',0));
 await deny('Blank message',()=>act('employee','paid','report',0,randomUUID(),' '),'22023');
 const key=randomUUID();const first=await act('employee','paid','report',0,key);
 ok(first.status==='open'&&first.version===1,'Report recorded separately');
 ok((await act('employee','paid','report',0,key)).idempotent===true,'Lost response exact retry returns original committed result');
 await deny('Same key different payload',()=>act('employee','paid','report',0,key,'different'),'22023');
 await deny('Stale client fails without replacing event',()=>act('employee','paid','report',0),'40001');
 await deny('Duplicate open report',()=>act('employee','paid','report',1),'55000');
 await deny('Owner cannot pretend cashier replied',()=>act('employee','paid','respond',1));
 await deny('Resolve must follow response',()=>act('employee','paid','resolve',1));
 ok((await read('cashier')).rows.length===1,'Cashier sees independent queue');
 ok((await read('other')).rows.length===0,'Other employee queue empty');
 await as('cashier');await db.exec("set test.permission='false'");await deny('Revoked permission cannot respond',()=>db.query('select finance_payment_concern_action_v1($1,$2,$3,$4,$5,$6)',['paid','respond','no',1,randomUUID(),'test']));
 await as('employee');await db.exec("set test.read='false'");await deny('Source read scope checked for owner',()=>db.query("select finance_payment_concern_read_v1('paid','test')"));
 await admin("update employee_department_roles set can_approve=false where finance_user_id='cashier'");await deny('EDR approval revocation',()=>act('cashier','paid','respond',1));
 await admin("update employee_department_roles set can_approve=true,effective_to=current_date-1 where finance_user_id='cashier'");await deny('Expired appointment',()=>act('cashier','paid','respond',1));
 await admin("update employee_department_roles set effective_to=null where finance_user_id='cashier'");
 ok((await act('cashier','paid','respond',1)).status==='responded','Authorized cashier responds');
 await deny('Cashier cannot confirm employee resolved',()=>act('cashier','paid','resolve',2));
 ok((await act('employee','paid','resolve',2)).status==='resolved','Owner confirms separate concern resolved');
 ok((await read('cashier')).rows.length===0,'Resolved concerns leave active queue');
 ok((await read('employee','paid')).rows[0].history.length===3,'Immutable actor event history remains readable');
 ok((await act('employee','paid','report',3)).status==='open','Owner may reopen concern without reopening payment');
 await as('employee');await deny('Authenticated direct concern update denied',()=>db.exec("update private.finance_payment_concerns_v1 set status='resolved'"));
 await db.exec('reset role;set role service_role');await deny('Service direct concern update denied',()=>db.exec("delete from private.finance_payment_concern_events_v1"));
 await db.exec('reset role;set role anon');await deny('Anonymous RPC denied',()=>db.exec("select finance_payment_concern_read_v1('paid','test')"));
 await admin("update finance_users set active=false where id='employee'");await deny('Inactive owner denied even on replay',()=>act('employee','paid','report',0,key));
 await admin("update finance_users set active=true where id='employee'");
 await admin("create function private.test_fail_event() returns trigger language plpgsql as $$begin raise exception 'injected event failure';end$$;create trigger test_fail before insert on private.finance_payment_concern_events_v1 for each row execute function private.test_fail_event();");
 await deny('Event failure rolls back entire response',()=>act('accountant','paid','respond',4),'P0001');
 ok((await read('employee','paid')).rows[0].version===4,'Failed action did not partially update concern');
 await admin('drop trigger test_fail on private.finance_payment_concern_events_v1');
 ok(JSON.stringify((await admin('select * from expense_requests order by id',[])).rows)===original,'All concerns leave payment, approval, voucher and ledger source unchanged');
 console.log(JSON.stringify({ok:true,checks,scope:'candidate SQL and reviewed authorization helpers; local fixtures only'}));
 }finally{await db.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
