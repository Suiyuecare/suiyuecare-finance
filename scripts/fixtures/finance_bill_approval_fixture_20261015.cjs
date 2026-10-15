'use strict';
const assert=require('node:assert/strict');
const f=require('./finance_invoice_batch_fixture_20261014.cjs');
const extra=require('./finance_bill_approval_live_catalog_20261015.json');
const literal=s=>"'"+s.replaceAll("'","''")+"'";
const q=s=>'\"'+s.replaceAll('\"','\"\"')+'\"';
const approverUid='cccccccc-cccc-4ccc-8ccc-cccccccccccc',approverSid='dddddddd-dddd-4ddd-8ddd-dddddddddddd',next='FICT-BILL-NEXT';
async function setup(db){
 const baseFixture=await f.setup(db);
 for(const t of extra.tables)await db.exec('create table '+q(t.schema_name)+'.'+q(t.name)+' ('+t.columns.map(c=>q(c.name)+' '+c.type+(c.identity?' generated '+(c.identity==='a'?'always':'by default')+' as identity':'')+(c.not_null?' not null':'')).join(',')+')');
 for(const t of extra.tables){const table=q(t.schema_name)+'.'+q(t.name);for(const c of t.columns)if(c.default&&!c.identity)await db.exec('alter table '+table+' alter column '+q(c.name)+' set default '+c.default);for(const c of t.constraints||[])if(c.type!=='f'&&c.type!=='t')await db.exec('alter table '+table+' add constraint '+q(c.name)+' '+c.definition);for(const idx of t.indexes||[])await db.exec(idx);}
 for(const t of extra.tables)for(const c of t.constraints||[])if(c.type==='f')await db.exec('alter table '+q(t.schema_name)+'.'+q(t.name)+' add constraint '+q(c.name)+' '+c.definition);
 // Extra tables are read-only authority lookups; no fictional delegations/roles are written.
 for(const fn of extra.functions){await db.exec('create schema if not exists '+q(fn.schema_name));await db.exec(fn.definition);for(const role of new Set([fn.owner_name,...(fn.acl||[]).map(a=>a.grantee)].filter(x=>x!=='PUBLIC')))await db.exec("do $$begin if not exists(select 1 from pg_roles where rolname="+literal(role)+") then create role "+q(role)+";end if;end$$;");await db.exec('alter function '+fn.signature+' owner to '+q(fn.owner_name));await db.exec('revoke all on function '+fn.signature+' from public,anon,authenticated,service_role');for(const a of fn.acl||[])await db.exec('grant '+a.privilege+' on function '+fn.signature+' to '+(a.grantee==='PUBLIC'?'public':q(a.grantee))+(a.grantable?' with grant option':''));assert.equal((await db.query('select md5(prosrc) hash from pg_proc where oid=$1::regprocedure',[fn.signature])).rows[0].hash,fn.source_md5);}
 await db.exec(`insert into auth.users(id,email) values('${approverUid}','bill.approver@suiyuecare.com');
 insert into auth.identities(provider_id,user_id,provider,identity_data,created_at) values('fixture-bill-approver-sub','${approverUid}','google','{"email":"bill.approver@suiyuecare.com","email_verified":true}',now());
 insert into auth.sessions(id,user_id) values('${approverSid}','${approverUid}');
 update public.finance_users set auth_user_id='${approverUid}',email='bill.approver@suiyuecare.com',google_link_status='bound' where id='${f.approver}';
 insert into public.tenant_members(email,name,role,tenant_id,auth_user_id,finance_user_id,active) values('bill.approver@suiyuecare.com','虛構簽核主管','dept_manager','${f.tenant}','${approverUid}','${f.approver}',true);
 insert into public.finance_users(id,name,email,role,tenant_id,active,department_code) values('${next}','虛構下一關會計','bill.next@suiyuecare.com','accountant','${f.tenant}',true,'FICT-D1');
 create table private.fixture_trigger_calls(label text);
 create function private.fixture_trigger_counter() returns trigger language plpgsql as $$begin insert into private.fixture_trigger_calls values(TG_ARGV[0]);return coalesce(new,old);end$$;
 create trigger fixture_bill_statement after update on public.bills for each statement execute function private.fixture_trigger_counter('bill_statement');
 create trigger fixture_history_group after insert or update on private.finance_history_group_projection_v1 for each row execute function private.fixture_trigger_counter('history_group');
 set statement_timeout='20s';set jit=off;`);
 return {...baseFixture,extraFunctions:extra.functions.length,extraTables:extra.tables.length};
}
module.exports={setup,approverUid,approverSid,next};
