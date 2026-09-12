set local lock_timeout='5s';
set local statement_timeout='60s';

-- A concern is a separate conversation. It never confirms, reverses, repeats,
-- or unlocks a payment, approval or ledger posting.
create table private.finance_payment_concerns_v1 (
 tenant_id uuid not null, data_environment text not null check(data_environment in ('production','test')),
 request_id text not null references public.expense_requests(id) on delete restrict,
 request_no text not null, reporter_id text not null, version integer not null check(version>0),
 status text not null check(status in ('open','responded','resolved')),
 reason text not null, response text not null default '', responder_id text,
 created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
 primary key(tenant_id,data_environment,request_id)
);
create table private.finance_payment_concern_events_v1 (
 tenant_id uuid not null, data_environment text not null, request_id text not null,
 actor_id text not null, actor_name text not null, operation_id uuid not null,
 action text not null check(action in ('report','respond','resolve')), message text not null,
 version integer not null, digest text not null, response jsonb not null,
 created_at timestamptz not null default clock_timestamp(),
 primary key(tenant_id,data_environment,actor_id,operation_id),
 unique(tenant_id,data_environment,request_id,version),
 foreign key(tenant_id,data_environment,request_id) references private.finance_payment_concerns_v1 on delete restrict
);
alter table private.finance_payment_concerns_v1 enable row level security;
alter table private.finance_payment_concern_events_v1 enable row level security;
revoke all on private.finance_payment_concerns_v1,private.finance_payment_concern_events_v1 from public,anon,authenticated,service_role;

create function private.finance_payment_concern_handler_v1(r public.expense_requests,a public.finance_users)
returns boolean language sql stable security definer set search_path='' as $$
 select r.tenant_id=a.tenant_id and public.can_read_expense_request(r) is true
  and private.finance_correction_role_v1(a.tenant_id,a.id,r.department_code,array['cashier','accountant','accountant_final']) is true
  and private.finance_correction_permission_v1(r,a.id,'finance.approval.approve') is true
$$;

create function public.finance_payment_concern_read_v1(p_request_id text default null,p_data_environment text default 'production')
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare a public.finance_users:=private.finance_correction_actor_v1();request_row public.expense_requests;result jsonb;reportable boolean:=false;
begin
 if p_data_environment is null or p_data_environment not in ('production','test') then raise exception '資料環境不正確' using errcode='22023';end if;
 if p_request_id is not null then
  select * into request_row from public.expense_requests where id=p_request_id and tenant_id=a.tenant_id and data_environment=p_data_environment;
  if not found or public.can_read_expense_request(request_row) is distinct from true
    or (request_row.applicant_id is distinct from a.id and private.finance_payment_concern_handler_v1(request_row,a) is distinct from true) then
   raise exception '無權讀取此申請的收款疑義' using errcode='42501';end if;
  reportable:=request_row.applicant_id=a.id and request_row.cash_posted_at is not null and request_row.voided_at is null;
 end if;
 select coalesce(jsonb_agg(x.data order by x.updated_at desc),'[]') into result from (
  select c.updated_at,jsonb_build_object('requestId',c.request_id,'requestNo',c.request_no,'version',c.version,'status',c.status,
   'reason',c.reason,'response',c.response,'createdAt',c.created_at,'updatedAt',c.updated_at,
   'canReport',r.applicant_id=a.id and r.cash_posted_at is not null and r.voided_at is null and c.status='resolved',
   'canRespond',c.status in ('open','responded') and private.finance_payment_concern_handler_v1(r,a),
   'canResolve',c.status='responded' and r.applicant_id=a.id,
   'history',(select coalesce(jsonb_agg(jsonb_build_object('action',ev.action,'message',ev.message,'actorName',ev.actor_name,'at',ev.created_at) order by ev.version),'[]')
    from private.finance_payment_concern_events_v1 ev where ev.tenant_id=c.tenant_id and ev.data_environment=c.data_environment and ev.request_id=c.request_id)) data
  from private.finance_payment_concerns_v1 c join public.expense_requests r on r.id=c.request_id and r.tenant_id=c.tenant_id and r.data_environment=c.data_environment
  where c.tenant_id=a.tenant_id and c.data_environment=p_data_environment and (p_request_id is null or c.request_id=p_request_id)
   and (p_request_id is not null or c.status<>'resolved') and public.can_read_expense_request(r) is true
   and (r.applicant_id=a.id or private.finance_payment_concern_handler_v1(r,a))
  order by c.updated_at desc limit 100
 ) x;
 return jsonb_build_object('ok',true,'rows',result,'canReport',reportable,'limit',100);
end $$;

create function public.finance_payment_concern_action_v1(p_request_id text,p_action text,p_message text,p_expected_version integer,p_operation_id uuid,p_data_environment text default 'production')
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare a public.finance_users:=private.finance_correction_actor_v1();r public.expense_requests;c private.finance_payment_concerns_v1;
 ev private.finance_payment_concern_events_v1;d text;next_status text;v integer;result jsonb;
begin
 if p_data_environment is null or p_data_environment not in ('production','test') or p_action is null or p_action not in ('report','respond','resolve')
  or p_operation_id is null or p_expected_version is null or p_expected_version<0 or length(btrim(coalesce(p_message,''))) not between 1 and 2000 then
  raise exception '請填寫1至2000字的說明，並重新讀取目前版本' using errcode='22023';end if;
 -- Serialize each actor operation as well as the request; exact retries return
 -- their first committed response, and a reused key with other input is denied.
 perform pg_advisory_xact_lock(hashtextextended(a.tenant_id::text||p_data_environment||a.id||p_operation_id::text,0));
 select * into r from public.expense_requests where id=p_request_id and tenant_id=a.tenant_id and data_environment=p_data_environment for update;
 if not found or public.can_read_expense_request(r) is distinct from true
  or (r.applicant_id is distinct from a.id and private.finance_payment_concern_handler_v1(r,a) is distinct from true) then
  raise exception '無權處理此申請的收款疑義' using errcode='42501';end if;
 d:=encode(sha256(convert_to(jsonb_build_array(p_request_id,p_action,btrim(p_message),p_expected_version)::text,'UTF8')),'hex');
 select * into ev from private.finance_payment_concern_events_v1 where tenant_id=a.tenant_id and data_environment=p_data_environment and actor_id=a.id and operation_id=p_operation_id;
 if found then
  if ev.digest<>d then raise exception '重試內容與原回報不同，請重新讀取' using errcode='22023';end if;
  return ev.response||'{"idempotent":true}'::jsonb;
 end if;
 select * into c from private.finance_payment_concerns_v1 where tenant_id=a.tenant_id and data_environment=p_data_environment and request_id=p_request_id for update;
 v:=coalesce(c.version,0);
 if v<>p_expected_version then raise exception '收款疑義已更新，請重新讀取後確認' using errcode='40001';end if;
 if p_action='report' then
  if r.applicant_id is distinct from a.id or r.cash_posted_at is null or r.voided_at is not null then raise exception '只有原申請人可回報已有付款紀錄的單據' using errcode='42501';end if;
  if c.status in ('open','responded') then raise exception '這張單已回報，請查看出納回覆' using errcode='55000';end if;
  next_status:='open';
 elsif p_action='respond' then
  if private.finance_payment_concern_handler_v1(r,a) is distinct from true or c.status is null or c.status not in ('open','responded') then
   raise exception '只有有權限的出納或會計可以回覆待處理疑義' using errcode='42501';end if;
  next_status:='responded';
 else
  if r.applicant_id is distinct from a.id or c.status is distinct from 'responded' then raise exception '請先取得出納回覆，再由原申請人確認疑義已解決' using errcode='42501';end if;
  next_status:='resolved';
 end if;
 insert into private.finance_payment_concerns_v1(tenant_id,data_environment,request_id,request_no,reporter_id,version,status,reason,response,responder_id)
 values(a.tenant_id,p_data_environment,p_request_id,r.no,a.id,v+1,next_status,btrim(p_message),'',null)
 on conflict(tenant_id,data_environment,request_id) do update set version=v+1,status=next_status,
  reason=case when p_action='report' then btrim(p_message) else finance_payment_concerns_v1.reason end,
  response=case when p_action='respond' then btrim(p_message) when p_action='report' then '' else finance_payment_concerns_v1.response end,
  responder_id=case when p_action='respond' then a.id when p_action='report' then null else finance_payment_concerns_v1.responder_id end,updated_at=clock_timestamp();
 result:=jsonb_build_object('ok',true,'requestId',p_request_id,'version',v+1,'status',next_status);
 insert into private.finance_payment_concern_events_v1(tenant_id,data_environment,request_id,actor_id,actor_name,operation_id,action,message,version,digest,response)
 values(a.tenant_id,p_data_environment,p_request_id,a.id,a.name,p_operation_id,p_action,btrim(p_message),v+1,d,result);
 return result;
end $$;
revoke all on function private.finance_payment_concern_handler_v1(public.expense_requests,public.finance_users) from public,anon,authenticated,service_role;
revoke all on function public.finance_payment_concern_read_v1(text,text),public.finance_payment_concern_action_v1(text,text,text,integer,uuid,text) from public,anon,service_role;
grant execute on function public.finance_payment_concern_read_v1(text,text),public.finance_payment_concern_action_v1(text,text,text,integer,uuid,text) to authenticated;
alter function private.finance_payment_concern_handler_v1(public.expense_requests,public.finance_users) owner to postgres;
alter function public.finance_payment_concern_read_v1(text,text) owner to postgres;
alter function public.finance_payment_concern_action_v1(text,text,text,integer,uuid,text) owner to postgres;
-- Applied only on commit; rollback rehearsal does not expose candidate RPCs.
notify pgrst, 'reload schema';
