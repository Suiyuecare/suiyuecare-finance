'use strict';
// Anonymous in-memory schema only. Actual reviewed revision SQL is unchanged;
// identity and future organization route are narrow fixture interfaces.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
module.exports=async function createFixture(root=path.resolve(__dirname,'../..')){
  const read=p=>fs.readFileSync(path.join(root,p),'utf8');
  const fixture=read('scripts/check_finalize_accounting_lines_atomic.js');
  const marker="  const old=await create('baseline-drift')";assert.equal(fixture.split(marker).length,2);
  let prefix=fixture.slice(0,fixture.indexOf(marker)).replace(/^#![^\n]*\n/,'');
  prefix=prefix.replace('(async()=>{try{','return (async()=>{try{');
  const f=await new Function('require','__dirname','__filename',prefix+`return {db,admin,as,state,create,tenant,actorId,actorName,auth};}catch(e){await db.close();throw e;}})();`)(require,path.join(root,'scripts'),path.join(root,'scripts/check_finalize_accounting_lines_atomic.js'));
  const {db,admin,tenant,actorId}=f;
  try{
    await admin(`create schema extensions;create function extensions.digest(bytea,text) returns bytea language sql immutable as $$select case when $2='sha256' then pg_catalog.sha256($1) else null end$$;
      alter table public.finance_users add column created_at timestamptz default now();
      alter table public.expense_requests add column payee text,add column bank_type text,add column bank_name text,add column bank_branch text,add column bank_no text,add column expected_pay_date date,add column bank_account text,add column fee_bearer text;
      create table private.finance_income_document_operations(tenant_id uuid not null,data_environment text not null,operation_type text not null,idempotency_key text not null,request_digest text not null,actor_finance_user_id text not null,operation_status text not null default 'in_progress',result jsonb,created_at timestamptz not null default now(),completed_at timestamptz,primary key(tenant_id,data_environment,operation_type,idempotency_key));
      create function private.finance_expense_assert_applicant_revision_future_route_v3(uuid,text,text,text,numeric,jsonb,jsonb,integer) returns jsonb language plpgsql as $$begin
      if $1<>'${tenant}' or $2<>'${actorId}' or $3 not in ('payment_request','hr_expense_request','purchase_request') or $4<>'D1' or $8<>1 or jsonb_array_length($7)<>5 or $7->2->>'rk'<>'accountant' or $7->2->>'uid'<>'other' then raise exception 'Fixed anonymous route scope mismatch' using errcode='42501';end if;return $7;end$$;`);
    await admin(read('scripts/fixtures/finance_expense_revision_operations_20260912.sql'));
    const deps=read('scripts/fixtures/finance_correction_dependencies_20260907.sql');
    for(const name of ['finance_income_active_step_index','finance_income_step_role','finance_income_status_from_steps']){
      const m=deps.match(new RegExp('CREATE OR REPLACE FUNCTION private\\.'+name+'\\([\\s\\S]*?\\$function\\$;'));assert(m,name);await admin(m[0]);
    }
    await admin(read('scripts/fixtures/finance_expense_revision_runtime_20260912.sql'));
    const args='text,text,text,integer,timestamptz,integer,text,jsonb,jsonb,text';
    await admin(`revoke all on all functions in schema private from public,anon,authenticated,service_role;
      revoke all on function public.finance_expense_resubmit_applicant_revision(${args}) from public,anon,authenticated,service_role;
      grant execute on function public.finance_expense_resubmit_applicant_revision(${args}) to authenticated,service_role;`);
    await admin('insert into public.system_settings values($1,$2,$3)',[tenant,'bank_transfer_fees',JSON.stringify({E1:15})]);
    f.read=read;return f;
  }catch(e){await db.close();throw e;}
};
