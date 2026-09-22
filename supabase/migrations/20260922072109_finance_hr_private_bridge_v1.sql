-- HR payroll bridge. No ordinary expense row or bank transfer is created here.
-- All mappings/readers require a separately verified, administrative provisioning record.
create schema finance_hr_private;
revoke all on schema finance_hr_private from public,anon,authenticated,service_role;
grant usage on schema finance_hr_private to authenticated,service_role;
create table finance_hr_private.finance_hr_routes (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null,
 source_employer_id uuid not null, source_applicant_id uuid not null,
 legal_entity_code text not null, version integer not null check(version>0),
 bank_actor text not null, account_actor text not null, cashier_actor text not null, voucher_actor text not null,
 verified_at timestamptz not null, verified_by text not null check(length(verified_by)>0),
 evidence_reference text not null check(length(evidence_reference)>0),
 effective_from timestamptz not null, effective_until timestamptz, active boolean not null default false,
 unique(source_employer_id,source_applicant_id,version)
);
create table finance_hr_private.finance_hr_salary_readers (
 tenant_id uuid not null, source_employer_id uuid not null, finance_user_id text not null,
 business_role text not null check(business_role in ('hr','accounting','ceo')),
 verified_at timestamptz not null, verified_by text not null, evidence_reference text not null,
 effective_from timestamptz not null, effective_until timestamptz, revoked_at timestamptz,
 primary key(tenant_id,source_employer_id,finance_user_id)
);
create table finance_hr_private.finance_hr_obligations (
 obligation_id uuid primary key, flow_id uuid not null unique, tenant_id uuid not null,
 source_employer_id uuid not null, original_hr_applicant_id uuid not null,
 source_revision integer not null, source_hash text not null, envelope_hash text not null,
 route_id uuid not null references finance_hr_private.finance_hr_routes(id), route_snapshot jsonb not null,
 legal_entity_code text not null, kind text not null check(kind in ('monthly','bonus')),
 period text not null, pay_date date not null, source_snapshot jsonb not null,
 total_net_cents bigint not null check(total_net_cents>0),
 version integer not null default 1, stage_index integer not null default 0 check(stage_index between 0 and 5),
 status text not null default 'awaiting_payment_validation' check(status in ('awaiting_payment_validation','pending_bank_upload','pending_account_check','pending_cashier','pending_applicant','pending_voucher','closed')),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table finance_hr_private.finance_hr_events (
 event_id uuid primary key default gen_random_uuid(), obligation_id uuid not null references finance_hr_private.finance_hr_obligations(obligation_id),
 finance_version integer not null, stage_index integer not null, action text not null,
 actor_system text not null check(actor_system in ('hr','finance','transport')), actor_id text not null, actor_name text not null,
 evidence jsonb not null default '{}', occurred_at timestamptz not null default now(), unique(obligation_id,finance_version)
);
create table finance_hr_private.finance_hr_requests (
 request_id uuid primary key, operation text not null, actor_id text not null,
 obligation_id uuid not null references finance_hr_private.finance_hr_obligations(obligation_id), payload_hash text not null,
 result jsonb not null, created_at timestamptz not null default now()
);
create table finance_hr_private.finance_hr_callback_outbox (
 event_id uuid primary key references finance_hr_private.finance_hr_events(event_id), obligation_id uuid not null,
 finance_version integer not null, payload jsonb not null, created_at timestamptz not null default now(),
 unique(obligation_id,finance_version)
);
create table finance_hr_private.finance_hr_callback_delivery (
 event_id uuid primary key references finance_hr_private.finance_hr_callback_outbox(event_id),
 lease_id uuid, lease_until timestamptz, attempts integer not null default 0,
 acknowledged_at timestamptz, last_error_code text
);
create table finance_hr_private.finance_hr_voucher_claims (
 voucher_id text primary key, obligation_id uuid not null unique references finance_hr_private.finance_hr_obligations(obligation_id)
);
create function finance_hr_private.finance_hr_immutable() returns trigger language plpgsql security invoker set search_path='' as $$
begin raise exception 'FINANCE_HR_IMMUTABLE' using errcode='42501'; end $$;
create function finance_hr_private.finance_hr_guard_source() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='DELETE' or (to_jsonb(new)-array['version','stage_index','status','updated_at']) is distinct from (to_jsonb(old)-array['version','stage_index','status','updated_at']) then raise exception 'FINANCE_HR_SOURCE_FROZEN' using errcode='42501'; end if;
 return new;
end $$;
create trigger source_frozen before update or delete on finance_hr_private.finance_hr_obligations for each row execute function finance_hr_private.finance_hr_guard_source();
create function finance_hr_private.finance_hr_guard_route() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='DELETE' or (to_jsonb(new)-array['active','effective_until']) is distinct from (to_jsonb(old)-array['active','effective_until']) then raise exception 'FINANCE_HR_ROUTE_FROZEN' using errcode='42501'; end if;
 return new;
end $$;
create trigger route_frozen before update or delete on finance_hr_private.finance_hr_routes for each row execute function finance_hr_private.finance_hr_guard_route();
do $$ declare t text; begin
 foreach t in array array['routes','salary_readers','obligations','events','requests','callback_outbox','callback_delivery','voucher_claims'] loop
  execute format('alter table finance_hr_private.finance_hr_%I enable row level security',t);
  execute format('alter table finance_hr_private.finance_hr_%I force row level security',t);
  execute format('revoke all on finance_hr_private.finance_hr_%I from public,anon,authenticated,service_role',t);
 end loop;
 foreach t in array array['events','requests','callback_outbox','voucher_claims'] loop
  execute format('create trigger immutable before update or delete on finance_hr_private.finance_hr_%I for each row execute function finance_hr_private.finance_hr_immutable()',t);
 end loop;
end $$;
create function finance_hr_private.finance_hr_hash(j jsonb) returns text language sql immutable security invoker set search_path='' as $$
 select encode(sha256(convert_to(j::text,'UTF8')),'hex')
$$;
create function finance_hr_private.finance_hr_reader(t uuid,e uuid,u text) returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from finance_hr_private.finance_hr_salary_readers r join public.finance_users f on f.id=r.finance_user_id and f.tenant_id=r.tenant_id where r.tenant_id=t and r.source_employer_id=e and r.finance_user_id=u and r.revoked_at is null and r.verified_at<=now() and r.effective_from<=now() and (r.effective_until is null or r.effective_until>now()) and f.active and f.auth_user_id is not null)
$$;
create function finance_hr_private.finance_hr_route_active(r finance_hr_private.finance_hr_routes) returns boolean language sql stable security invoker set search_path='' as $$
 select r.active and r.verified_at<=now() and r.effective_from<=now() and (r.effective_until is null or r.effective_until>now())
 and finance_hr_private.finance_hr_reader(r.tenant_id,r.source_employer_id,r.bank_actor)
 and finance_hr_private.finance_hr_reader(r.tenant_id,r.source_employer_id,r.account_actor)
 and finance_hr_private.finance_hr_reader(r.tenant_id,r.source_employer_id,r.cashier_actor)
 and finance_hr_private.finance_hr_reader(r.tenant_id,r.source_employer_id,r.voucher_actor)
$$;
create function finance_hr_private.finance_hr_json(o finance_hr_private.finance_hr_obligations,amounts boolean) returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('obligationId',o.obligation_id,'flowId',o.flow_id,'sourceHash',o.source_hash,'sourceRevision',o.source_revision,'sourceEmployerId',o.source_employer_id,'originalApplicantId',o.original_hr_applicant_id,'legalEntityCode',o.legal_entity_code,'kind',o.kind,'period',o.period,'payDate',o.pay_date,'financeVersion',o.version,'stageIndex',o.stage_index,'status',o.status,'route',o.route_snapshot,'amountsVisible',amounts,'source',case when amounts then o.source_snapshot else null end,'totalNetCents',case when amounts then o.total_net_cents else null end,'events',coalesce((select jsonb_agg(jsonb_build_object('eventId',v.event_id,'financeVersion',v.finance_version,'stageIndex',v.stage_index,'action',v.action,'actor',jsonb_build_object('system',v.actor_system,'id',v.actor_id,'name',v.actor_name),'occurredAt',v.occurred_at,'evidence',case when amounts then v.evidence else null end) order by v.finance_version) from finance_hr_private.finance_hr_events v where v.obligation_id=o.obligation_id),'[]'::jsonb))
$$;
create function finance_hr_private.finance_hr_emit(o finance_hr_private.finance_hr_obligations,a text,actor_system text,actor_id text,actor_name text,evidence jsonb) returns void language plpgsql security invoker set search_path='' as $$
declare ev finance_hr_private.finance_hr_events; body jsonb; begin
 insert into finance_hr_private.finance_hr_events(obligation_id,finance_version,stage_index,action,actor_system,actor_id,actor_name,evidence) values(o.obligation_id,o.version,o.stage_index,a,actor_system,actor_id,actor_name,evidence) returning * into ev;
 body:=jsonb_build_object('schemaVersion',1,'eventId',ev.event_id,'obligationId',o.obligation_id,'flowId',o.flow_id,'sourceHash',o.source_hash,'sourceRevision',o.source_revision,'financeVersion',o.version,'stageIndex',o.stage_index,'status',o.status,'action',a,'actor',jsonb_build_object('system',actor_system,'id',actor_id,'name',actor_name),'occurredAt',ev.occurred_at);
 insert into finance_hr_private.finance_hr_callback_outbox(event_id,obligation_id,finance_version,payload) values(ev.event_id,o.obligation_id,o.version,body);
 insert into finance_hr_private.finance_hr_callback_delivery(event_id) values(ev.event_id);
end $$;
create function finance_hr_private.finance_hr_intake(p_event_id uuid,p_envelope jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare o finance_hr_private.finance_hr_obligations; r finance_hr_private.finance_hr_routes; h text; id uuid; existing finance_hr_private.finance_hr_requests; actors jsonb; total bigint; item jsonb; source_total bigint:=0; source_rows jsonb;
begin
 if p_event_id is null or jsonb_typeof(p_envelope) is distinct from 'object' or octet_length(p_envelope::text)>1048576 then raise exception 'FINANCE_HR_INVALID_ENVELOPE'; end if;
 h:=finance_hr_private.finance_hr_hash(p_envelope); id:=(p_envelope->>'obligationId')::uuid;
 if id is null or (p_envelope->>'flowId')::uuid is null or (p_envelope->>'originalApplicantId')::uuid is null or (p_envelope->>'sourceEmployerId')::uuid is null or p_envelope->>'schemaVersion' is distinct from '1' or coalesce(p_envelope->>'kind','') not in ('monthly','bonus') or coalesce(p_envelope->>'revision','') !~ '^[1-9][0-9]{0,8}$' or coalesce(p_envelope->>'period','') !~ '^\d{4}-(0[1-9]|1[0-2])$' or coalesce(p_envelope->>'payDate','') !~ '^\d{4}-\d{2}-\d{2}$' or p_envelope->>'amountMeaning' is distinct from 'calculated_net' or jsonb_typeof(p_envelope->'source') is distinct from 'object' or p_envelope->>'sourceHash' is distinct from finance_hr_private.finance_hr_hash(p_envelope->'source') then raise exception 'FINANCE_HR_SOURCE_INVALID'; end if;
 if coalesce(p_envelope->'source'->>'totalNetCents','') !~ '^[1-9][0-9]{0,13}$' then raise exception 'FINANCE_HR_NET_AMOUNT_REQUIRED'; end if;
 total:=(p_envelope->'source'->>'totalNetCents')::bigint;
 source_rows:=case when p_envelope->>'kind'='monthly' then p_envelope->'source'->'lines' else p_envelope->'source'->'employees' end;
 if jsonb_typeof(source_rows) is distinct from 'array' or jsonb_array_length(source_rows) not between 1 and 500 then raise exception 'FINANCE_HR_SOURCE_LINES_REQUIRED'; end if;
 for item in select * from jsonb_array_elements(source_rows) loop
  if jsonb_typeof(item) is distinct from 'object' or coalesce(item->>'employeeId','') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then raise exception 'FINANCE_HR_SOURCE_LINE_INVALID'; end if;
  if p_envelope->>'kind'='monthly' then
   if coalesce(item->>'kind','') not in ('addition','deduction') or coalesce(item->>'amountCents','') !~ '^[0-9]{1,14}$' then raise exception 'FINANCE_HR_SOURCE_LINE_INVALID'; end if;
   source_total:=source_total+(case when item->>'kind'='addition' then 1 else -1 end)*(item->>'amountCents')::bigint;
  else
   if coalesce(item->>'netCents','') !~ '^[0-9]{1,14}$' or coalesce(item->>'grossCents','') !~ '^[0-9]{1,14}$' or coalesce(item->>'deductionsCents','') !~ '^[0-9]{1,14}$' or (item->>'netCents')::bigint<>(item->>'grossCents')::bigint-(item->>'deductionsCents')::bigint then raise exception 'FINANCE_HR_SOURCE_LINE_INVALID'; end if;
   source_total:=source_total+(item->>'netCents')::bigint;
  end if;
 end loop;
 if source_total<>total then raise exception 'FINANCE_HR_SOURCE_TOTAL_MISMATCH'; end if;
 if p_envelope->>'kind'='monthly' and exists(select 1 from jsonb_array_elements(source_rows) x group by x->>'employeeId' having sum((case when x->>'kind'='addition' then 1 else -1 end)*(x->>'amountCents')::bigint)<0) then raise exception 'FINANCE_HR_SOURCE_NEGATIVE_NET'; end if;
 if p_envelope->>'kind'='bonus' and exists(select 1 from jsonb_array_elements(source_rows) x group by x->>'employeeId' having count(*)>1) then raise exception 'FINANCE_HR_SOURCE_DUPLICATE_EMPLOYEE'; end if;
 perform pg_advisory_xact_lock(hashtextextended(id::text,617));
 select * into existing from finance_hr_private.finance_hr_requests where request_id=p_event_id;
 if found then if existing.operation<>'intake' or existing.obligation_id<>id or existing.payload_hash<>h then raise exception 'FINANCE_HR_REPLAY_CONFLICT'; end if; return existing.result||jsonb_build_object('replayed',true); end if;
 select * into o from finance_hr_private.finance_hr_obligations where obligation_id=id;
 if found then
  if o.envelope_hash<>h then raise exception 'FINANCE_HR_OBLIGATION_CONFLICT'; end if;
  return jsonb_build_object('ok',true,'replayed',true,'obligationId',id,'financeVersion',o.version,'status',o.status);
 end if;
 if (select count(*) from finance_hr_private.finance_hr_routes x where x.source_employer_id=(p_envelope->>'sourceEmployerId')::uuid and x.source_applicant_id=(p_envelope->>'originalApplicantId')::uuid and finance_hr_private.finance_hr_route_active(x))<>1 then raise exception 'FINANCE_HR_ROUTE_UNVERIFIED'; end if;
 select * into r from finance_hr_private.finance_hr_routes x where x.source_employer_id=(p_envelope->>'sourceEmployerId')::uuid and x.source_applicant_id=(p_envelope->>'originalApplicantId')::uuid and finance_hr_private.finance_hr_route_active(x);
 actors:=jsonb_build_array(jsonb_build_object('key','mega_upload','actorId',r.bank_actor),jsonb_build_object('key','account_check','actorId',r.account_actor),jsonb_build_object('key','cashier','actorId',r.cashier_actor),jsonb_build_object('key','applicant','actorSystem','hr','actorId',r.source_applicant_id),jsonb_build_object('key','voucher','actorId',r.voucher_actor));
 insert into finance_hr_private.finance_hr_obligations(obligation_id,flow_id,tenant_id,source_employer_id,original_hr_applicant_id,source_revision,source_hash,envelope_hash,route_id,route_snapshot,legal_entity_code,kind,period,pay_date,source_snapshot,total_net_cents) values(id,(p_envelope->>'flowId')::uuid,r.tenant_id,r.source_employer_id,r.source_applicant_id,(p_envelope->>'revision')::integer,p_envelope->>'sourceHash',h,r.id,actors,r.legal_entity_code,p_envelope->>'kind',p_envelope->>'period',(p_envelope->>'payDate')::date,p_envelope->'source',total) returning * into o;
 perform finance_hr_private.finance_hr_emit(o,'received','transport','hr-finance-bridge','人資系統傳送服務','{}');
 insert into finance_hr_private.finance_hr_requests(request_id,operation,actor_id,obligation_id,payload_hash,result) values(p_event_id,'intake','hr-finance-bridge',id,h,jsonb_build_object('ok',true,'obligationId',id,'financeVersion',1,'status',o.status));
 return jsonb_build_object('ok',true,'replayed',false,'obligationId',id,'financeVersion',1,'status',o.status);
end $$;
create function finance_hr_private.finance_hr_snapshot() returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.finance_users; begin
 a:=public.current_finance_user();
 if auth.uid() is null or a.id is null or a.auth_user_id is distinct from auth.uid() or not a.active then raise exception 'FINANCE_HR_FORBIDDEN' using errcode='42501'; end if;
 if (select count(*) from finance_hr_private.finance_hr_obligations o where o.tenant_id=a.tenant_id and finance_hr_private.finance_hr_reader(o.tenant_id,o.source_employer_id,a.id))>500 then raise exception 'FINANCE_HR_RESULT_LIMIT'; end if;
 return jsonb_build_object('obligations',coalesce((select jsonb_agg(finance_hr_private.finance_hr_json(o,true) order by o.updated_at desc,o.obligation_id) from finance_hr_private.finance_hr_obligations o where o.tenant_id=a.tenant_id and finance_hr_private.finance_hr_reader(o.tenant_id,o.source_employer_id,a.id)),'[]'::jsonb));
end $$;
create function finance_hr_private.finance_hr_evidence(e jsonb,k text) returns void language plpgsql immutable security invoker set search_path='' as $$
begin
 if jsonb_typeof(e) is distinct from 'object' or octet_length(e::text)>8192 or e->>'kind' is distinct from k or length(btrim(coalesce(e->>'reference',''))) not between 1 and 200 or coalesce(e->>'sha256','') !~ '^[0-9a-f]{64}$' or exists(select 1 from jsonb_object_keys(e) x where x<>all(array['kind','reference','sha256','totalNetCents','voucherId'])) then raise exception 'FINANCE_HR_EVIDENCE_REQUIRED'; end if;
end $$;
create function finance_hr_private.finance_hr_command(p_obligation_id uuid,p_expected_version integer,p_request_id uuid,p_action text,p_evidence jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.finance_users; o finance_hr_private.finance_hr_obligations; r finance_hr_private.finance_hr_routes; existing finance_hr_private.finance_hr_requests; h text; k text; next_status text; v public.vouchers;
begin
 a:=public.current_finance_user();
 if auth.uid() is null or a.id is null or a.auth_user_id is distinct from auth.uid() or not a.active then raise exception 'FINANCE_HR_FORBIDDEN' using errcode='42501'; end if;
 if p_request_id is null or p_action is null or p_expected_version is null then raise exception 'FINANCE_HR_INVALID_COMMAND'; end if;
 h:=finance_hr_private.finance_hr_hash(jsonb_build_object('id',p_obligation_id,'version',p_expected_version,'action',p_action,'evidence',p_evidence));
 perform pg_advisory_xact_lock(hashtextextended(p_obligation_id::text,617));
 select * into o from finance_hr_private.finance_hr_obligations where obligation_id=p_obligation_id for update;
 if o.obligation_id is null or o.tenant_id<>a.tenant_id or not finance_hr_private.finance_hr_reader(o.tenant_id,o.source_employer_id,a.id) then raise exception 'FINANCE_HR_FORBIDDEN' using errcode='42501'; end if;
 select * into r from finance_hr_private.finance_hr_routes where id=o.route_id;
 if not finance_hr_private.finance_hr_route_active(r) then raise exception 'FINANCE_HR_ROUTE_UNVERIFIED'; end if;
 select * into existing from finance_hr_private.finance_hr_requests where request_id=p_request_id;
 if found then if existing.operation<>'command' or existing.actor_id<>a.id or existing.obligation_id<>o.obligation_id or existing.payload_hash<>h then raise exception 'FINANCE_HR_REPLAY_CONFLICT'; end if; return existing.result||jsonb_build_object('replayed',true); end if;
 if o.version<>p_expected_version then raise exception 'FINANCE_HR_VERSION_CONFLICT' using errcode='40001'; end if;
 if o.stage_index not in (0,1,2,4) or o.route_snapshot->o.stage_index->>'actorId' is distinct from a.id then raise exception 'FINANCE_HR_NOT_ASSIGNEE' using errcode='42501'; end if;
 k:=case o.status when 'awaiting_payment_validation' then 'bank_batch_validation' when 'pending_bank_upload' then 'bank_upload' when 'pending_account_check' then 'accounting_review' when 'pending_cashier' then 'bank_disbursement' when 'pending_voucher' then 'posted_voucher' end;
 if p_action is distinct from k then raise exception 'FINANCE_HR_ACTION_OUT_OF_ORDER'; end if;
 perform finance_hr_private.finance_hr_evidence(p_evidence,k);
 if k in ('bank_batch_validation','bank_upload','bank_disbursement') and p_evidence->>'totalNetCents' is distinct from o.total_net_cents::text then raise exception 'FINANCE_HR_AMOUNT_MISMATCH'; end if;
 if k='posted_voucher' then
  select * into v from public.vouchers where id=p_evidence->>'voucherId' and tenant_id=o.tenant_id and entity_id=o.legal_entity_code and request_id='hr:'||o.obligation_id::text and posted is true and posted_at is not null and voided_at is null and data_environment='production' and total=o.total_net_cents/100.0 for key share;
  if v.id is null then raise exception 'FINANCE_HR_POSTED_VOUCHER_REQUIRED'; end if;
  insert into finance_hr_private.finance_hr_voucher_claims(voucher_id,obligation_id) values(v.id,o.obligation_id);
 end if;
 next_status:=case k when 'bank_batch_validation' then 'pending_bank_upload' when 'bank_upload' then 'pending_account_check' when 'accounting_review' then 'pending_cashier' when 'bank_disbursement' then 'pending_applicant' when 'posted_voucher' then 'closed' end;
 update finance_hr_private.finance_hr_obligations set version=version+1,stage_index=stage_index+case when k='bank_batch_validation' then 0 else 1 end,status=next_status,updated_at=clock_timestamp() where obligation_id=o.obligation_id returning * into o;
 perform finance_hr_private.finance_hr_emit(o,k,'finance',a.id,a.name,p_evidence);
 insert into finance_hr_private.finance_hr_requests(request_id,operation,actor_id,obligation_id,payload_hash,result) values(p_request_id,'command',a.id,o.obligation_id,h,jsonb_build_object('ok',true,'obligation',finance_hr_private.finance_hr_json(o,true)));
 return jsonb_build_object('ok',true,'obligation',finance_hr_private.finance_hr_json(o,true),'replayed',false);
end $$;
create function finance_hr_private.finance_hr_applicant_confirm(p_obligation_id uuid,p_expected_version integer,p_request_id uuid,p_hr_actor_id uuid,p_source_hash text,p_evidence jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare o finance_hr_private.finance_hr_obligations; h text; existing finance_hr_private.finance_hr_requests; begin
 if p_request_id is null or p_hr_actor_id is null or p_expected_version is null then raise exception 'FINANCE_HR_INVALID_COMMAND'; end if;
 h:=finance_hr_private.finance_hr_hash(jsonb_build_object('id',p_obligation_id,'version',p_expected_version,'actor',p_hr_actor_id,'sourceHash',p_source_hash,'evidence',p_evidence));
 perform pg_advisory_xact_lock(hashtextextended(p_obligation_id::text,617));
 select * into o from finance_hr_private.finance_hr_obligations where obligation_id=p_obligation_id for update;
 if o.obligation_id is null or o.original_hr_applicant_id<>p_hr_actor_id or o.source_hash is distinct from p_source_hash then raise exception 'FINANCE_HR_APPLICANT_MISMATCH' using errcode='42501'; end if;
 select * into existing from finance_hr_private.finance_hr_requests where request_id=p_request_id;
 if found then if existing.operation<>'applicant_confirm' or existing.actor_id<>p_hr_actor_id::text or existing.obligation_id<>o.obligation_id or existing.payload_hash<>h then raise exception 'FINANCE_HR_REPLAY_CONFLICT'; end if; return existing.result||jsonb_build_object('replayed',true); end if;
 if o.version<>p_expected_version then raise exception 'FINANCE_HR_VERSION_CONFLICT' using errcode='40001'; end if;
 if o.stage_index<>3 or o.status<>'pending_applicant' then raise exception 'FINANCE_HR_ACTION_OUT_OF_ORDER'; end if;
 perform finance_hr_private.finance_hr_evidence(p_evidence,'applicant_confirmation');
 update finance_hr_private.finance_hr_obligations set stage_index=4,status='pending_voucher',version=version+1,updated_at=clock_timestamp() where obligation_id=o.obligation_id returning * into o;
 perform finance_hr_private.finance_hr_emit(o,'applicant_confirmation','hr',p_hr_actor_id::text,'原人資申請人',p_evidence);
 insert into finance_hr_private.finance_hr_requests(request_id,operation,actor_id,obligation_id,payload_hash,result) values(p_request_id,'applicant_confirm',p_hr_actor_id::text,o.obligation_id,h,jsonb_build_object('ok',true,'obligationId',o.obligation_id,'financeVersion',o.version,'status',o.status));
 return jsonb_build_object('ok',true,'obligationId',o.obligation_id,'financeVersion',o.version,'status',o.status,'replayed',false);
end $$;
create function finance_hr_private.finance_hr_callback_claim(p_obligation_id uuid,p_limit integer default 10) returns jsonb language plpgsql security definer set search_path='' as $$
declare row record; token uuid; result jsonb:='[]'; begin
 if p_obligation_id is null or p_limit is null or p_limit not between 1 and 10 then raise exception 'FINANCE_HR_INVALID_LIMIT'; end if;
 for row in select d.event_id,b.payload from finance_hr_private.finance_hr_callback_delivery d join finance_hr_private.finance_hr_callback_outbox b using(event_id) where b.obligation_id=p_obligation_id and d.acknowledged_at is null and (d.lease_until is null or d.lease_until<now()) and not exists(select 1 from finance_hr_private.finance_hr_callback_outbox prior join finance_hr_private.finance_hr_callback_delivery pd using(event_id) where prior.obligation_id=b.obligation_id and prior.finance_version<b.finance_version and pd.acknowledged_at is null) order by b.created_at,b.event_id limit p_limit for update of d skip locked loop
  token:=gen_random_uuid(); update finance_hr_private.finance_hr_callback_delivery set lease_id=token,lease_until=now()+interval '2 minutes',attempts=attempts+1 where event_id=row.event_id;
  result:=result||jsonb_build_array(jsonb_build_object('eventId',row.event_id,'leaseId',token,'payload',row.payload));
 end loop;
 return result;
end $$;
create function finance_hr_private.finance_hr_callback_ack(p_event_id uuid,p_lease_id uuid,p_success boolean,p_error_code text default null) returns boolean language plpgsql security definer set search_path='' as $$
begin
 if p_success is null or (p_error_code is not null and p_error_code !~ '^[A-Z0-9_]{1,80}$') then raise exception 'FINANCE_HR_INVALID_ACK'; end if;
 update finance_hr_private.finance_hr_callback_delivery set acknowledged_at=case when p_success then now() else null end,lease_id=null,lease_until=case when p_success then null else now()+interval '1 minute' end,last_error_code=case when p_success then null else p_error_code end where event_id=p_event_id and lease_id=p_lease_id and lease_until>now() and acknowledged_at is null;
 if not found then raise exception 'FINANCE_HR_LEASE_LOST'; end if; return true;
end $$;
create function public.finance_hr_intake(p_event_id uuid,p_envelope jsonb) returns jsonb language sql security invoker set search_path='' as $$ select finance_hr_private.finance_hr_intake(p_event_id,p_envelope) $$;
create function public.finance_hr_snapshot() returns jsonb language sql security invoker set search_path='' as $$ select finance_hr_private.finance_hr_snapshot() $$;
create function public.finance_hr_command(p_obligation_id uuid,p_expected_version integer,p_request_id uuid,p_action text,p_evidence jsonb) returns jsonb language sql security invoker set search_path='' as $$ select finance_hr_private.finance_hr_command(p_obligation_id,p_expected_version,p_request_id,p_action,p_evidence) $$;
create function public.finance_hr_applicant_confirm(p_obligation_id uuid,p_expected_version integer,p_request_id uuid,p_hr_actor_id uuid,p_source_hash text,p_evidence jsonb) returns jsonb language sql security invoker set search_path='' as $$ select finance_hr_private.finance_hr_applicant_confirm(p_obligation_id,p_expected_version,p_request_id,p_hr_actor_id,p_source_hash,p_evidence) $$;
create function public.finance_hr_callback_claim(p_obligation_id uuid,p_limit integer default 10) returns jsonb language sql security invoker set search_path='' as $$ select finance_hr_private.finance_hr_callback_claim(p_obligation_id,p_limit) $$;
create function public.finance_hr_callback_ack(p_event_id uuid,p_lease_id uuid,p_success boolean,p_error_code text default null) returns boolean language sql security invoker set search_path='' as $$ select finance_hr_private.finance_hr_callback_ack(p_event_id,p_lease_id,p_success,p_error_code) $$;
create function finance_hr_private.finance_hr_callback_authorize(p_obligation_id uuid) returns boolean language plpgsql stable security definer set search_path='' as $$
declare a public.finance_users; begin
 a:=public.current_finance_user();
 return auth.uid() is not null and a.id is not null and a.auth_user_id=auth.uid() and a.active and exists(select 1 from finance_hr_private.finance_hr_obligations o where o.obligation_id=p_obligation_id and o.tenant_id=a.tenant_id and finance_hr_private.finance_hr_reader(o.tenant_id,o.source_employer_id,a.id));
end $$;
create function public.finance_hr_callback_authorize(p_obligation_id uuid) returns boolean language sql security invoker set search_path='' as $$ select finance_hr_private.finance_hr_callback_authorize(p_obligation_id) $$;
do $$ declare f record; begin
 for f in select p.oid::regprocedure as signature,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','finance_hr_private') and p.proname like 'finance_hr_%' loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
  if f.proname in ('finance_hr_snapshot','finance_hr_command','finance_hr_callback_authorize') then execute format('grant execute on function %s to authenticated',f.signature);
  elsif f.proname in ('finance_hr_intake','finance_hr_applicant_confirm','finance_hr_callback_claim','finance_hr_callback_ack') then execute format('grant execute on function %s to service_role',f.signature); end if;
 end loop;
end $$;
comment on table finance_hr_private.finance_hr_obligations is 'Private HR settlement obligations. Intake is not bank upload or payment. Bank transitions record an identified human and evidence; no bank API is invoked. Posted voucher linkage is verified against the Finance ledger.';
