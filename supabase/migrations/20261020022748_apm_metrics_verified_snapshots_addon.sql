-- Additive APM revenue publication. Does not close a period, modify ledger rows,
-- grant salary access, create an expense, or infer a bank/tax result.
set local lock_timeout='5s';
set local statement_timeout='120s';
create schema finance_apm_private;
revoke all on schema finance_apm_private from public,anon,authenticated,service_role;
grant usage on schema finance_apm_private to authenticated,service_role;
create table finance_apm_private.metric_mappings (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,
 apm_company_id uuid not null,apm_department_id uuid not null,
 entity_id text not null,department_code text not null,account_codes text[] not null,
 reference text not null,created_by text not null,created_at timestamptz not null default clock_timestamp()
);
create table finance_apm_private.mapping_decisions (
 mapping_id uuid not null references finance_apm_private.metric_mappings(id),
 decision text not null check(decision in('verified','revoked')),actor_id text not null,
 reference text not null,created_at timestamptz not null default clock_timestamp(),primary key(mapping_id,decision)
);
create table finance_apm_private.metric_snapshots (
 id uuid primary key,mapping_id uuid not null references finance_apm_private.metric_mappings(id),
 year integer not null,quarter integer not null,preview_hash text not null,
 source_evidence jsonb not null,snapshot jsonb not null,approved_by text not null,
 approved_at timestamptz not null default clock_timestamp(),unique(mapping_id,year,quarter)
);
create table finance_apm_private.commands (
 tenant_id uuid not null,actor_id text not null,request_id uuid not null,
 payload_hash text not null,result jsonb not null,created_at timestamptz not null default clock_timestamp(),
 primary key(tenant_id,actor_id,request_id)
);
create index metric_mappings_scope on finance_apm_private.metric_mappings(apm_company_id,apm_department_id);
create index metric_snapshots_mapping on finance_apm_private.metric_snapshots(mapping_id);
create function finance_apm_private.immutable() returns trigger language plpgsql security invoker set search_path='' as $$
begin raise exception 'FINANCE_APM_IMMUTABLE' using errcode='42501';end $$;
do $$declare t text;begin
 foreach t in array array['metric_mappings','mapping_decisions','metric_snapshots','commands'] loop
  execute format('alter table finance_apm_private.%I enable row level security',t);
  execute format('alter table finance_apm_private.%I force row level security',t);
  execute format('revoke all on finance_apm_private.%I from public,anon,authenticated,service_role',t);
  execute format('create trigger immutable before update or delete on finance_apm_private.%I for each row execute function finance_apm_private.immutable()',t);
 end loop;
end $$;
create function finance_apm_private.canonical(j jsonb) returns text language plpgsql immutable security invoker set search_path='' as $$
declare v text;begin
 case jsonb_typeof(j)
 when 'object' then select '{'||coalesce(string_agg(to_jsonb(key)::text||':'||finance_apm_private.canonical(value),',' order by key collate "C"),'')||'}' into v from jsonb_each(j);
 when 'array' then select '['||coalesce(string_agg(finance_apm_private.canonical(value),',' order by n),'')||']' into v from jsonb_array_elements(j) with ordinality a(value,n);
 when 'number' then v:=trim_scale((j#>>'{}')::numeric)::text;
 else v:=j::text;end case;return v;end $$;
create function finance_apm_private.hash(j jsonb) returns text language sql immutable security invoker set search_path='' as $$
 select encode(sha256(convert_to(finance_apm_private.canonical(j),'UTF8')),'hex')
$$;
create function finance_apm_private.active(m finance_apm_private.metric_mappings) returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from finance_apm_private.mapping_decisions d where d.mapping_id=m.id and d.decision='verified')
 and not exists(select 1 from finance_apm_private.mapping_decisions d where d.mapping_id=m.id and d.decision='revoked')
$$;
create function finance_apm_private.actor(entity text) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare a jsonb;begin
 if not public.finance_auth_session_active() then raise exception 'FINANCE_APM_FORBIDDEN' using errcode='42501';end if;
 a:=private.finance_reporting_actor_v1(entity,'production');
 if public.current_finance_role() not in('accountant','ceo') or (a->>'canEditWorkpaper')::boolean is distinct from true then raise exception 'FINANCE_APM_FORBIDDEN' using errcode='42501';end if;
 return a;end $$;
create function finance_apm_private.evidence(m finance_apm_private.metric_mappings,y integer,q integer) returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare first_day date;last_day date;closes jsonb;ledger jsonb;total numeric;begin
 if y not between 2000 and 2200 or q not between 1 and 4 then raise exception 'FINANCE_APM_PERIOD_INVALID';end if;
 first_day:=make_date(y,(q-1)*3+1,1);last_day:=(first_day+interval '3 months')::date;
 if last_day>current_date then raise exception 'FINANCE_APM_PERIOD_NOT_ENDED';end if;
 if not finance_apm_private.active(m) then raise exception 'FINANCE_APM_MAPPING_UNVERIFIED';end if;
 select jsonb_agg(to_jsonb(c) order by c.period) into closes from public.period_closes c
 where c.tenant_id=m.tenant_id and c.entity_id=m.entity_id and c.data_environment='production'
 and c.period between to_char(first_day,'YYYY-MM') and to_char(last_day-1,'YYYY-MM') and c.status='closed';
 if jsonb_array_length(coalesce(closes,'[]'))<>3 or (select count(distinct c->>'period') from jsonb_array_elements(coalesce(closes,'[]')) c)<>3 then raise exception 'FINANCE_APM_CLOSED_QUARTER_REQUIRED';end if;
 select coalesce(jsonb_agg(to_jsonb(l) order by l.id),'[]'),coalesce(sum(l.credit-l.debit),0) into ledger,total
 from public.ledger_entries l where l.tenant_id=m.tenant_id and l.entity_id=m.entity_id and l.data_environment='production'
 and l.department_code=m.department_code and l.account_code=any(m.account_codes)
 and l.entry_date>=first_day and l.entry_date<last_day and l.voided_at is null
 and coalesce(l.source_type,'') not in('period_close','closing_entry','year_end_close');
 if total<0 or total>999999999999 or total<>round(total,4) then raise exception 'FINANCE_APM_REVENUE_RANGE';end if;
 return jsonb_build_object('mappingId',m.id,'year',y,'quarter',q,'startDate',first_day,'endDate',last_day-1,'value',total,
  'closeHash',finance_apm_private.hash(closes),'ledgerHash',finance_apm_private.hash(ledger),'ledgerCount',jsonb_array_length(ledger),'accountCodes',m.account_codes);
end $$;
create function finance_apm_private.command(cmd text,p jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare a jsonb;t uuid;u text;rid uuid;h text;old finance_apm_private.commands;m finance_apm_private.metric_mappings;
 result jsonb;ev jsonb;snap jsonb;sid uuid;y integer;q integer;i integer;codes text[];
begin
 if jsonb_typeof(p) is distinct from 'object' or octet_length(p::text)>65536 or cmd<>all(array['mapping.propose','mapping.verify','mapping.revoke','snapshot.preview','snapshot.approve','list']) then raise exception 'FINANCE_APM_INPUT_INVALID';end if;
 if exists(select 1 from jsonb_object_keys(p) k where k<>all(array['requestId','entityId','mappingId','apmCompanyId','apmDepartmentId','departmentCode','accountCodes','reference','year','quarter','previewHash'])) then raise exception 'FINANCE_APM_INPUT_INVALID';end if;
 a:=finance_apm_private.actor(p->>'entityId');t:=(a->>'tenantId')::uuid;u:=a->>'actorId';
 if cmd='list' then
  return jsonb_build_object('mappings',coalesce((select jsonb_agg(to_jsonb(x)||jsonb_build_object('verified',finance_apm_private.active(x))) from finance_apm_private.metric_mappings x where x.tenant_id=t and x.entity_id=p->>'entityId'),'[]'));
 end if;
 rid:=(p->>'requestId')::uuid;if rid is null then raise exception 'FINANCE_APM_REQUEST_REQUIRED';end if;
 h:=finance_apm_private.hash(jsonb_build_object('command',cmd,'payload',p));
 perform pg_advisory_xact_lock(hashtextextended(t::text||u||rid::text,831));
 select * into old from finance_apm_private.commands where tenant_id=t and actor_id=u and request_id=rid;
 if old.request_id is not null then if old.payload_hash<>h then raise exception 'FINANCE_APM_REPLAY_CONFLICT';end if;return old.result;end if;
 if cmd='mapping.propose' then
  if jsonb_typeof(p->'accountCodes') is distinct from 'array' or jsonb_array_length(p->'accountCodes') not between 1 and 50
   or exists(select 1 from jsonb_array_elements(p->'accountCodes') x where jsonb_typeof(x)<>'string' or (x#>>'{}')!~'^4[0-9A-Za-z_-]{0,19}$') then raise exception 'FINANCE_APM_REVENUE_ACCOUNTS_REQUIRED';end if;
  select array_agg(distinct x order by x) into codes from jsonb_array_elements_text(p->'accountCodes') x;
  if cardinality(codes)<>jsonb_array_length(p->'accountCodes') or length(btrim(coalesce(p->>'reference',''))) not between 10 and 1000
   or (p->>'apmCompanyId')::uuid is null or (p->>'apmDepartmentId')::uuid is null then raise exception 'FINANCE_APM_MAPPING_INVALID';end if;
  if not exists(select 1 from public.system_settings s cross join lateral jsonb_array_elements(case when jsonb_typeof(s.value)='array' then s.value else '[]' end) d
   where s.tenant_id=t and s.key='departments' and d->>'c'=p->>'departmentCode') then raise exception 'FINANCE_APM_DEPARTMENT_UNVERIFIED';end if;
  insert into finance_apm_private.metric_mappings(tenant_id,apm_company_id,apm_department_id,entity_id,department_code,account_codes,reference,created_by)
   values(t,(p->>'apmCompanyId')::uuid,(p->>'apmDepartmentId')::uuid,p->>'entityId',p->>'departmentCode',codes,btrim(p->>'reference'),u) returning * into m;
  result:=jsonb_build_object('mappingId',m.id,'status','pending_verification');
 else
  select * into m from finance_apm_private.metric_mappings where id=(p->>'mappingId')::uuid and tenant_id=t and entity_id=p->>'entityId';
  if m.id is null then raise exception 'FINANCE_APM_FORBIDDEN' using errcode='42501';end if;
  perform pg_advisory_xact_lock(hashtextextended(m.apm_company_id::text||m.apm_department_id::text,832));
  if cmd in('mapping.verify','mapping.revoke') then
   if public.current_finance_role()<>'ceo' or (cmd='mapping.verify' and m.created_by=u) then raise exception 'FINANCE_APM_INDEPENDENT_REVIEW_REQUIRED' using errcode='42501';end if;
   if length(btrim(coalesce(p->>'reference',''))) not between 10 and 1000 then raise exception 'FINANCE_APM_REFERENCE_REQUIRED';end if;
   if cmd='mapping.verify' and exists(select 1 from finance_apm_private.metric_mappings x where x.apm_company_id=m.apm_company_id and x.apm_department_id=m.apm_department_id and x.id<>m.id and finance_apm_private.active(x)) then raise exception 'FINANCE_APM_MAPPING_CONFLICT';end if;
   insert into finance_apm_private.mapping_decisions(mapping_id,decision,actor_id,reference) values(m.id,case cmd when 'mapping.verify' then 'verified' else 'revoked' end,u,btrim(p->>'reference'));
   result:=jsonb_build_object('mappingId',m.id,'status',case cmd when 'mapping.verify' then 'verified' else 'revoked' end);
  else
   y:=(p->>'year')::integer;q:=(p->>'quarter')::integer;
   if y is null or q is null then raise exception 'FINANCE_APM_PERIOD_INVALID';end if;
   -- Same lock domain and order as canonical ledger/period-close writes.
   for i in 0..2 loop perform pg_advisory_xact_lock(hashtextextended('finance_period|'||t::text||'|production|'||m.entity_id||'|'||to_char(make_date(y,(q-1)*3+1,1)+make_interval(months=>i),'YYYY-MM'),0));end loop;
   ev:=finance_apm_private.evidence(m,y,q);h:=finance_apm_private.hash(ev);
   if cmd='snapshot.preview' then result:=jsonb_build_object('previewHash',h,'evidence',ev);
   else
    if p->>'previewHash' is distinct from h then raise exception 'FINANCE_APM_SOURCE_CHANGED' using errcode='40001';end if;
    if exists(select 1 from finance_apm_private.metric_snapshots where mapping_id=m.id and year=y and quarter=q) then raise exception 'FINANCE_APM_SNAPSHOT_EXISTS';end if;
    sid:=gen_random_uuid();snap:=jsonb_build_object('snapshotId',sid,'metricKey','quarterly_closed_revenue_twd','value',ev->'value','currency','TWD',
     'scope',jsonb_build_object('kind','department','companyId',m.apm_company_id,'departmentId',m.apm_department_id),
     'period',jsonb_build_object('year',y,'quarter',q,'startDate',ev->'startDate','endDate',ev->'endDate'),'closedAt',clock_timestamp());
    snap:=snap||jsonb_build_object('hash',finance_apm_private.hash(snap));
    insert into finance_apm_private.metric_snapshots(id,mapping_id,year,quarter,preview_hash,source_evidence,snapshot,approved_by) values(sid,m.id,y,q,h,ev,snap,u);
    result:=jsonb_build_object('status','approved','snapshot',snap);
   end if;
  end if;
 end if;
 -- Recompute command hash: the preview hash is a different domain.
 insert into finance_apm_private.commands values(t,u,rid,finance_apm_private.hash(jsonb_build_object('command',cmd,'payload',p)),result,clock_timestamp());
 return result;
end $$;
create function finance_apm_private.export_snapshots() returns jsonb language plpgsql security definer set search_path='' as $$
declare s finance_apm_private.metric_snapshots;m finance_apm_private.metric_mappings;ev jsonb;result jsonb:='[]';begin
 if (select count(*) from finance_apm_private.metric_snapshots)>500 then raise exception 'FINANCE_APM_EXPORT_LIMIT';end if;
 for s in select * from finance_apm_private.metric_snapshots order by approved_at,id loop
  select * into m from finance_apm_private.metric_mappings where id=s.mapping_id;
  if not finance_apm_private.active(m) then continue;end if;
  begin ev:=finance_apm_private.evidence(m,s.year,s.quarter);exception when sqlstate 'P0001' then continue;end;
  if finance_apm_private.hash(ev)=s.preview_hash then result:=result||jsonb_build_array(s.snapshot);end if;
 end loop;
 return jsonb_build_object('generatedAt',clock_timestamp(),'snapshots',result);
end $$;
create function public.finance_apm_metrics_command(command text,payload jsonb) returns jsonb language sql security invoker set search_path='' as $$select finance_apm_private.command(command,payload)$$;
create function public.finance_apm_metrics_export() returns jsonb language sql security invoker set search_path='' as $$select finance_apm_private.export_snapshots()$$;
revoke all on all functions in schema finance_apm_private from public,anon,authenticated,service_role;
revoke all on function public.finance_apm_metrics_command(text,jsonb),public.finance_apm_metrics_export() from public,anon,authenticated,service_role;
grant execute on function finance_apm_private.command(text,jsonb),public.finance_apm_metrics_command(text,jsonb) to authenticated;
grant execute on function finance_apm_private.export_snapshots(),public.finance_apm_metrics_export() to service_role;
comment on schema finance_apm_private is 'Verified APM revenue projection only. No ledger, payroll, expense, bank, salary authorization or tax-filing mutation.';
