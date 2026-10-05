-- Isolated PGlite fixture for 20261005173534_applicant_withdraw_bill_invoice_v1.sql.
-- All identifiers and people below are fictional.
create role anon;
create role authenticated;
create role service_role;
create schema auth;
create schema private;

create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create function public.current_tenant_id() returns uuid language sql stable as $$
  select '11111111-1111-4111-8111-111111111111'::uuid
$$;

create table public.finance_users (
  id text primary key, name text not null, email text not null,
  role text not null, active boolean not null default true,
  tenant_id uuid not null, auth_user_id uuid,
  created_at timestamptz not null default now()
);
create table public.expense_requests (
  id text primary key, tenant_id uuid not null,
  data_environment text not null default 'production',
  status text not null
);
create table private.finance_labor_statements_v1 (
  request_id text primary key, tenant_id uuid not null,
  data_environment text not null default 'production'
);
create table public.bills (
  id text primary key, tenant_id uuid not null,
  data_environment text not null default 'production',
  no text, applicant_id text not null, batch_id text,
  status text not null default 'unpaid',
  approval_status text not null default 'pending_section_chief',
  approval_step integer not null default 2,
  steps jsonb not null,
  row_version bigint not null default 1,
  paid_at timestamptz, voided_at timestamptz,
  linked_invoice_id text,
  invoice_followup_status text not null default 'unreviewed'
);
create table public.invoices (
  id text primary key, tenant_id uuid not null,
  data_environment text not null default 'production',
  no text, applicant_id text not null, batch_id text,
  status text not null default 'unpaid',
  approval_status text not null default 'pending_section_chief',
  approval_step integer not null default 2,
  steps jsonb not null,
  row_version bigint not null default 1,
  paid_at timestamptz, voided_at timestamptz,
  linked_invoice_id text, source_bill_id text,
  posting_locked_at timestamptz, revenue_posted_at timestamptz,
  revenue_posted boolean not null default false,
  revenue_posting_state text not null default 'not_posted',
  cash_receipt_posted_at timestamptz,
  receipt_submitted_at timestamptz, receipt_reviewed_at timestamptz,
  receipt_files jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);
create table public.invoice_lifecycle_events (
  id text primary key, tenant_id uuid not null,
  data_environment text not null,
  invoice_id text not null
);
create table public.collection_followups (
  tenant_id uuid not null, data_environment text not null,
  source_table text not null, source_id text not null,
  outstanding_amount numeric not null,
  payment_status text not null, followup_status text not null,
  primary key (tenant_id,data_environment,source_table,source_id)
);
create table public.income_document_closure_cases (
  tenant_id uuid not null, data_environment text not null,
  source_table text not null, source_id text not null,
  closure_status text not null,
  primary key (tenant_id,data_environment,source_table,source_id)
);
create table public.cash_movement_evidence_links (
  tenant_id uuid not null, data_environment text not null,
  source_table text not null, source_id text not null,
  cash_stage text not null,
  primary key (tenant_id,data_environment,source_table,source_id)
);

-- Projection fixtures model the production upserts separately. B9 raises
-- during cash sync; I9 silently skips it, exercising both rollback paths.
create function private.fixture_sync_income_projection_v1(
  p_kind text,p_id text,p_projection text
) returns void language plpgsql as $$
declare v_status text;v_tenant uuid;v_environment text;
begin
 if p_kind='bill' then
  select status,tenant_id,data_environment into v_status,v_tenant,v_environment
  from public.bills where id=p_id;
 else
  select status,tenant_id,data_environment into v_status,v_tenant,v_environment
  from public.invoices where id=p_id;
 end if;
 if p_id='B9' and p_projection='cash' then
  raise exception 'simulated projection failure' using errcode='55000';
 end if;
 if p_id='I9' and p_projection='cash' then return;end if;
 if p_projection='collection' then
  insert into public.collection_followups
   (tenant_id,data_environment,source_table,source_id,
    outstanding_amount,payment_status,followup_status)
  values(v_tenant,v_environment,p_kind||'s',p_id,
   case when v_status='cancelled' then 0 else 100 end,
   case when v_status='cancelled' then 'voided' else 'unpaid' end,
   case when v_status='cancelled' then 'void' else 'open' end)
  on conflict(tenant_id,data_environment,source_table,source_id)
  do update set outstanding_amount=excluded.outstanding_amount,
   payment_status=excluded.payment_status,
   followup_status=excluded.followup_status;
 elsif p_projection='closure' then
  insert into public.income_document_closure_cases
   (tenant_id,data_environment,source_table,source_id,closure_status)
  values(v_tenant,v_environment,p_kind||'s',p_id,
   case when v_status='cancelled' then 'closed_void' else 'receivable_open' end)
  on conflict(tenant_id,data_environment,source_table,source_id)
  do update set closure_status=excluded.closure_status;
 elsif p_projection='cash' then
  insert into public.cash_movement_evidence_links
   (tenant_id,data_environment,source_table,source_id,cash_stage)
  values(v_tenant,v_environment,p_kind||'s',p_id,
   case when v_status='cancelled' then 'void' else 'pending_receipt' end)
  on conflict(tenant_id,data_environment,source_table,source_id)
  do update set cash_stage=excluded.cash_stage;
 end if;
end $$;
create function private.upsert_bill_collection_followup(text)
returns void language sql as $$
 select private.fixture_sync_income_projection_v1('bill',$1,'collection')$$;
create function private.upsert_invoice_collection_followup(text)
returns void language sql as $$
 select private.fixture_sync_income_projection_v1('invoice',$1,'collection')$$;
create function private.upsert_bill_income_closure(text)
returns void language sql as $$
 select private.fixture_sync_income_projection_v1('bill',$1,'closure')$$;
create function private.upsert_invoice_income_closure(text)
returns void language sql as $$
 select private.fixture_sync_income_projection_v1('invoice',$1,'closure')$$;
create function private.upsert_cash_evidence_for_bill(text)
returns void language sql as $$
 select private.fixture_sync_income_projection_v1('bill',$1,'cash')$$;
create function private.upsert_cash_evidence_for_invoice(text)
returns void language sql as $$
 select private.fixture_sync_income_projection_v1('invoice',$1,'cash')$$;

create table private.finance_income_document_operations (
  tenant_id uuid not null, data_environment text not null,
  operation_type text not null, idempotency_key text not null,
  request_digest text not null, actor_finance_user_id text not null,
  operation_status text not null default 'in_progress',
  result jsonb, completed_at timestamptz,
  primary key(tenant_id,data_environment,operation_type,idempotency_key)
);
create function private.finance_income_request_digest(p_payload jsonb)
returns text language sql immutable as $$select md5(p_payload::text)$$;
create function private.finance_income_begin_operation(
  p_tenant_id uuid,p_data_environment text,p_operation_type text,
  p_idempotency_key text,p_request_digest text,p_actor_finance_user_id text
) returns jsonb language plpgsql as $$
declare v_operation private.finance_income_document_operations%rowtype;
begin
 if coalesce(p_idempotency_key,'') !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$' then
  raise exception 'bad key' using errcode='22023';end if;
 insert into private.finance_income_document_operations(
  tenant_id,data_environment,operation_type,idempotency_key,
  request_digest,actor_finance_user_id)
 values(p_tenant_id,p_data_environment,p_operation_type,p_idempotency_key,
  p_request_digest,p_actor_finance_user_id)
 on conflict do nothing;
 select * into v_operation from private.finance_income_document_operations
 where tenant_id=p_tenant_id and data_environment=p_data_environment
  and operation_type=p_operation_type and idempotency_key=p_idempotency_key
 for update;
 if v_operation.actor_finance_user_id is distinct from p_actor_finance_user_id then
  raise exception 'wrong actor' using errcode='42501';end if;
 if v_operation.request_digest is distinct from p_request_digest then
  raise exception 'same key with different payload' using errcode='23505';end if;
 if v_operation.operation_status='completed' then return v_operation.result;end if;
 return null;
end $$;
create function private.finance_income_finish_operation(
  p_tenant_id uuid,p_data_environment text,p_operation_type text,
  p_idempotency_key text,p_result jsonb
) returns void language plpgsql as $$
begin
 update private.finance_income_document_operations
 set operation_status='completed',result=p_result,completed_at=now()
 where tenant_id=p_tenant_id and data_environment=p_data_environment
  and operation_type=p_operation_type and idempotency_key=p_idempotency_key
  and operation_status='in_progress';
 if not found then raise exception 'operation not finished';end if;
end $$;
create function private.finance_income_active_step_index(p_steps jsonb)
returns integer language sql immutable as $$
 select (s.ordinality-1)::integer
 from jsonb_array_elements(coalesce(p_steps,'[]'::jsonb)) with ordinality s(value,ordinality)
 where coalesce(s.value->>'a','')='' order by s.ordinality limit 1
$$;
create function private.finance_income_step_role(p_step jsonb)
returns text language sql immutable as $$select p_step->>'rk'$$;
create function private.finance_income_step_user_id(p_step jsonb)
returns text language sql immutable as $$select p_step->>'uid'$$;
create function private.finance_income_append_step_action(
 p_step jsonb,p_actor_finance_user_id text,p_actor_name text,
 p_action_label text,p_comment text,p_files jsonb
) returns jsonb language sql stable as $$
 select p_step || jsonb_build_object(
  'n',p_actor_name,'c',p_comment,
  'actionLog',coalesce(p_step->'actionLog','[]'::jsonb)||
   jsonb_build_array(jsonb_build_object('action',p_action_label,
    'by',p_actor_name,'byId',p_actor_finance_user_id,'comment',p_comment,'at',now()))
 )
$$;
create function private.fixture_bump_row_version() returns trigger
language plpgsql as $$begin new.row_version:=old.row_version+1;return new;end$$;
create trigger bill_version before update on public.bills
for each row execute function private.fixture_bump_row_version();
create trigger invoice_version before update on public.invoices
for each row execute function private.fixture_bump_row_version();

insert into public.finance_users(id,name,email,role,tenant_id,auth_user_id)
values
 ('F1','甲申請人','applicant@example.invalid','staff',public.current_tenant_id(),
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
 ('F2','乙簽核人','approver@example.invalid','section_chief',public.current_tenant_id(),
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
select set_config('request.jwt.claim.sub',
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',false);

-- One approved submission step and one open current step.
insert into public.bills(id,tenant_id,no,applicant_id,batch_id,steps)
select id,public.current_tenant_id(),id,'F1',batch,
 '[{"rk":"applicant_submit","uid":"F1","a":"approved","status":"submitted"},
   {"rk":"section_chief","uid":"F2","email":"","a":"","status":"pending_section_chief"},
   {"rk":"accountant","uid":"F2","a":"","status":"pending_accountant"}]'::jsonb
from (values ('B1','BATCH1'),('B2','BATCH1'),('B3','BATCH2'),
             ('B4','BATCH2'),('B5',null),('B6',null),('B7',null),
             ('B8','BATCH3'),('B9','BATCH3')) v(id,batch);
update public.bills set paid_at=now() where id='B5';
update public.bills set paid_at=now() where id='B4';
insert into public.invoices(id,tenant_id,no,applicant_id,batch_id,steps)
select id,public.current_tenant_id(),id,'F1',batch,
 '[{"rk":"applicant_submit","uid":"F1","a":"approved","status":"submitted"},
   {"rk":"section_chief","uid":"F2","email":"","a":"","status":"pending_section_chief"},
   {"rk":"accountant","uid":"F2","a":"","status":"pending_accountant"}]'::jsonb
from (values ('I1','IBATCH1'),('I2','IBATCH1'),('I3',null),
             ('I4',null),('I5',null),('I6',null),('I7',null),
             ('I8',null),('I9',null)) v(id,batch);
update public.invoices set revenue_posted=true where id='I3';
update public.invoices set revenue_posting_state='deferred' where id in ('I6','I7');
update public.invoices set revenue_posted_at=now() where id='I7';
update public.invoices set revenue_posting_state='posted' where id='I8';
insert into public.expense_requests(id,tenant_id,status)
values('E1',public.current_tenant_id(),'pending_accountant');
insert into private.finance_labor_statements_v1(request_id,tenant_id)
values('E1',public.current_tenant_id());

create function private.fixture_expected_v1(p_kind text,p_ids text[])
returns jsonb language plpgsql as $$
declare v_result jsonb;
begin
 if p_kind='bill' then
  select jsonb_object_agg(b.id,jsonb_build_object(
   'row_version',b.row_version,'active_step_index',1,
   'role_key','section_chief','finance_user_id','F2',
   'email','','approval_status',b.approval_status)) into v_result
  from public.bills b where b.id=any(p_ids);
 else
  select jsonb_object_agg(i.id,jsonb_build_object(
   'row_version',i.row_version,'active_step_index',1,
   'role_key','section_chief','finance_user_id','F2',
   'email','','approval_status',i.approval_status)) into v_result
  from public.invoices i where i.id=any(p_ids);
 end if;
 return v_result;
end $$;
