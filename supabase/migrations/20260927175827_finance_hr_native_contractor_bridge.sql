-- Native external-service settlement. No employee/bonus alias, no tax identifiers.
set local lock_timeout='5s';
set local statement_timeout='120s';
do $baseline$ begin
 if (select md5(prosrc) from pg_proc where oid='finance_hr_private.finance_hr_intake(uuid,jsonb)'::regprocedure)<>'e7466441abfafdb5079e3a7e163f7a3b' then raise exception 'FINANCE_HR_CONTRACTOR_REQUIRES_REVIEWED_INTAKE';end if;
end $baseline$;
alter table finance_hr_private.finance_hr_obligations drop constraint finance_hr_obligations_kind_check;
alter table finance_hr_private.finance_hr_obligations add constraint finance_hr_obligations_kind_check check(kind in ('monthly','bonus','contractor'));
create or replace function finance_hr_private.finance_hr_intake(p_event_id uuid,p_envelope jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare o finance_hr_private.finance_hr_obligations; r finance_hr_private.finance_hr_routes; h text; id uuid; existing finance_hr_private.finance_hr_requests; actors jsonb; total bigint; item jsonb; source_total bigint:=0; source_rows jsonb;
begin
 if p_event_id is null or jsonb_typeof(p_envelope) is distinct from 'object' or octet_length(p_envelope::text)>1048576 then raise exception 'FINANCE_HR_INVALID_ENVELOPE'; end if;
 h:=finance_hr_private.finance_hr_hash(p_envelope); id:=(p_envelope->>'obligationId')::uuid;
 if id is null or (p_envelope->>'flowId')::uuid is null or (p_envelope->>'originalApplicantId')::uuid is null or (p_envelope->>'sourceEmployerId')::uuid is null or p_envelope->>'schemaVersion' is distinct from '1' or coalesce(p_envelope->>'kind','') not in ('monthly','bonus','contractor') or coalesce(p_envelope->>'revision','') !~ '^[1-9][0-9]{0,8}$' or coalesce(p_envelope->>'period','') !~ '^\d{4}-(0[1-9]|1[0-2])$' or coalesce(p_envelope->>'payDate','') !~ '^\d{4}-\d{2}-\d{2}$' or p_envelope->>'amountMeaning' is distinct from 'calculated_net' or jsonb_typeof(p_envelope->'source') is distinct from 'object' or p_envelope->>'sourceHash' is distinct from finance_hr_private.finance_hr_hash(p_envelope->'source') then raise exception 'FINANCE_HR_SOURCE_INVALID'; end if;
 if coalesce(p_envelope->'source'->>'totalNetCents','') !~ '^[1-9][0-9]{0,13}$' then raise exception 'FINANCE_HR_NET_AMOUNT_REQUIRED'; end if;
 total:=(p_envelope->'source'->>'totalNetCents')::bigint;
 if p_envelope->>'kind'='contractor' then
  if exists(select 1 from jsonb_object_keys(p_envelope->'source') k where k<>all(array['recipients','totalNetCents','settlementId','serviceId','taxRunId','ruleYear','ruleRevision']))
   or coalesce(p_envelope->'source'->>'settlementId','') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
   or coalesce(p_envelope->'source'->>'serviceId','') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
   or coalesce(p_envelope->'source'->>'taxRunId','') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
   or coalesce(p_envelope->'source'->>'ruleYear','') !~ '^(19|20|21)[0-9]{2}$'
   or coalesce(p_envelope->'source'->>'ruleRevision','') !~ '^[1-9][0-9]{0,8}$' then raise exception 'FINANCE_HR_CONTRACTOR_SOURCE_INVALID';end if;
 end if;
 source_rows:=case p_envelope->>'kind' when 'monthly' then p_envelope->'source'->'lines' when 'bonus' then p_envelope->'source'->'employees' else p_envelope->'source'->'recipients' end;
 if jsonb_typeof(source_rows) is distinct from 'array' or jsonb_array_length(source_rows) not between 1 and 500 then raise exception 'FINANCE_HR_SOURCE_LINES_REQUIRED'; end if;
 for item in select * from jsonb_array_elements(source_rows) loop
  if jsonb_typeof(item) is distinct from 'object' or (p_envelope->>'kind'<>'contractor' and coalesce(item->>'employeeId','') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') then raise exception 'FINANCE_HR_SOURCE_LINE_INVALID'; end if;
  if p_envelope->>'kind'='monthly' then
   if coalesce(item->>'kind','') not in ('addition','deduction') or coalesce(item->>'amountCents','') !~ '^[0-9]{1,14}$' then raise exception 'FINANCE_HR_SOURCE_LINE_INVALID'; end if;
   source_total:=source_total+(case when item->>'kind'='addition' then 1 else -1 end)*(item->>'amountCents')::bigint;
  elsif p_envelope->>'kind'='bonus' then
   if coalesce(item->>'netCents','') !~ '^[0-9]{1,14}$' or coalesce(item->>'grossCents','') !~ '^[0-9]{1,14}$' or coalesce(item->>'deductionsCents','') !~ '^[0-9]{1,14}$' or (item->>'netCents')::bigint<>(item->>'grossCents')::bigint-(item->>'deductionsCents')::bigint then raise exception 'FINANCE_HR_SOURCE_LINE_INVALID'; end if;
   source_total:=source_total+(item->>'netCents')::bigint;
  else
   if exists(select 1 from jsonb_object_keys(item) k where k<>all(array['contractorId','payeeName','incomeCode','grossCents','withholdingCents','supplementaryCents','netCents','settlementId','taxRunId']))
    or coalesce(item->>'contractorId','') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    or length(btrim(coalesce(item->>'payeeName',''))) not between 1 and 200
    or coalesce(item->>'incomeCode','') not in ('50','9A','9B')
    or item->>'settlementId' is distinct from p_envelope->'source'->>'settlementId'
    or item->>'taxRunId' is distinct from p_envelope->'source'->>'taxRunId'
    or coalesce(item->>'grossCents','') !~ '^[0-9]{1,14}$'
    or coalesce(item->>'withholdingCents','') !~ '^[0-9]{1,14}$'
    or coalesce(item->>'supplementaryCents','') !~ '^[0-9]{1,14}$'
    or coalesce(item->>'netCents','') !~ '^[0-9]{1,14}$'
    then raise exception 'FINANCE_HR_CONTRACTOR_LINE_INVALID';end if;
   if (item->>'netCents')::bigint<>(item->>'grossCents')::bigint-(item->>'withholdingCents')::bigint-(item->>'supplementaryCents')::bigint then raise exception 'FINANCE_HR_CONTRACTOR_LINE_INVALID';end if;
   source_total:=source_total+(item->>'netCents')::bigint;
  end if;
 end loop;
 if source_total<>total then raise exception 'FINANCE_HR_SOURCE_TOTAL_MISMATCH'; end if;
 if p_envelope->>'kind'='monthly' and exists(select 1 from jsonb_array_elements(source_rows) x group by x->>'employeeId' having sum((case when x->>'kind'='addition' then 1 else -1 end)*(x->>'amountCents')::bigint)<0) then raise exception 'FINANCE_HR_SOURCE_NEGATIVE_NET'; end if;
 if p_envelope->>'kind'='bonus' and exists(select 1 from jsonb_array_elements(source_rows) x group by x->>'employeeId' having count(*)>1) then raise exception 'FINANCE_HR_SOURCE_DUPLICATE_EMPLOYEE'; end if;
 if p_envelope->>'kind'='contractor' and exists(select 1 from jsonb_array_elements(source_rows) x group by (x->>'contractorId')::uuid having count(*)>1) then raise exception 'FINANCE_HR_SOURCE_DUPLICATE_CONTRACTOR';end if;
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
revoke all on function finance_hr_private.finance_hr_intake(uuid,jsonb) from public,anon,authenticated;
grant execute on function finance_hr_private.finance_hr_intake(uuid,jsonb) to service_role;
notify pgrst,'reload schema';
