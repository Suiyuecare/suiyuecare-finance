-- Minimal operational evidence. No business payload, names, email, file paths,
-- salaries or OAuth tokens are accepted by this interface.
set local lock_timeout='5s';
set local statement_timeout='90s';

create table private.finance_operation_samples_v1 (
 tenant_id uuid not null, data_environment text not null check(data_environment in('production','test')),
 event_id uuid not null, actor_id text not null, actor_role text not null,
 metric text not null check(metric in('bootstrap','list','search','upload','download','submission','sync')),
 duration_ms integer not null check(duration_ms between 0 and 3600000),
 outcome text not null check(outcome in('ok','error','timeout','aborted')),
 measured_at timestamptz not null, received_at timestamptz not null default clock_timestamp(),
 primary key(tenant_id,data_environment,event_id)
);
create index finance_operation_samples_window_v1 on private.finance_operation_samples_v1(tenant_id,data_environment,received_at,metric,actor_role);
create index finance_operation_samples_actor_rate_v1 on private.finance_operation_samples_v1(tenant_id,actor_id,received_at);
create table private.finance_operation_alerts_v1 (
 tenant_id uuid not null, data_environment text not null,
 bucket timestamptz not null, metric text not null, actor_role text not null,
 failure_count integer not null, sample_count integer not null, p95_ms integer,
 created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
 acknowledged_by text, acknowledged_at timestamptz,
 primary key(tenant_id,data_environment,bucket,metric,actor_role)
);
alter table private.finance_operation_samples_v1 enable row level security;
alter table private.finance_operation_samples_v1 force row level security;
alter table private.finance_operation_alerts_v1 enable row level security;
alter table private.finance_operation_alerts_v1 force row level security;
revoke all on private.finance_operation_samples_v1,private.finance_operation_alerts_v1 from public,anon,authenticated,service_role;

create function private.finance_operations_actor_v1(p_admin boolean default false,p_people boolean default false,p_write boolean default false) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare t uuid:=public.current_tenant_id();a text:=public.current_finance_user_id();r text:=public.current_finance_role(); cfg jsonb;level text;page text;
begin
 if auth.uid() is null or t is null or a is null or not exists(select 1 from public.finance_users u where u.tenant_id=t and u.id=a and u.active and u.auth_user_id=auth.uid() and u.google_link_status in('bound','pending_rebind')) then raise exception 'Verified active Finance identity required' using errcode='42501';end if;
 if p_admin then
  page:=case when p_people then 'users' else 'settings' end;
  if (p_people and r not in('ceo','admin_director','hr')) or (not p_people and r not in('ceo','admin_director')) then raise exception 'Operational administration is not authorized' using errcode='42501';end if;
  select value->r into cfg from public.system_settings where tenant_id=t and key='role_permissions';
  level:=case when page='users' and (cfg is null or cfg='null'::jsonb or (jsonb_typeof(cfg)='object' and not cfg ? page)) then 'edit' else private.finance_reporting_page_level_v1(t,r,page) end;
  if level='none' or (p_write and level not in('edit','delete')) then raise exception 'Operational administration page denied' using errcode='42501';end if;
  if to_regprocedure('public.membership_has_explicit_deny(uuid,text,jsonb)') is not null and public.membership_has_explicit_deny(public.membership_current_user_id(),case when p_people then 'member.role.manage' else 'finance.page.settings.view' end,jsonb_build_object('tenant_id',t)) then raise exception 'Operational administration explicitly denied' using errcode='42501';end if;
 end if;
 return jsonb_build_object('tenantId',t,'actorId',a,'role',r);
end $$;
revoke all on function private.finance_operations_actor_v1(boolean,boolean,boolean) from public,anon,authenticated,service_role;

create function public.finance_operation_samples_save_v1(p_data_environment text,p_samples jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor jsonb:=private.finance_operations_actor_v1(); t uuid:=(actor->>'tenantId')::uuid;a text:=actor->>'actorId';s jsonb; eid uuid;measured timestamptz;duration integer;inserted integer:=0;count_today integer; prior private.finance_operation_samples_v1;v_bucket timestamptz;
begin
 if p_data_environment is null or p_data_environment not in('production','test') or jsonb_typeof(p_samples) is distinct from 'array' or jsonb_array_length(p_samples)>50 then raise exception 'Invalid operational sample batch' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('finance_metrics|'||t::text||'|'||a,0));
 select count(*) into count_today from private.finance_operation_samples_v1 where tenant_id=t and actor_id=a and received_at>=clock_timestamp()-interval '1 day';
 for s in select value from jsonb_array_elements(p_samples) loop
  if jsonb_typeof(s) is distinct from 'object' or (select count(*) from jsonb_object_keys(s))<>5 or exists(select 1 from jsonb_object_keys(s) k where k<>all(array['eventId','metric','durationMs','outcome','measuredAt'])) or s->>'metric' not in('bootstrap','list','search','upload','download','submission','sync') or s->>'outcome' not in('ok','error','timeout','aborted') or coalesce(s->>'durationMs','') !~ '^[0-9]{1,7}$' or jsonb_typeof(s->'durationMs')<>'number' then raise exception 'Invalid minimal operational sample' using errcode='22023';end if;
  begin eid:=(s->>'eventId')::uuid;measured:=(s->>'measuredAt')::timestamptz;duration:=(s->>'durationMs')::integer;exception when others then raise exception 'Invalid operational sample scalar' using errcode='22023';end;
  if eid is null or measured is null or not isfinite(measured) or measured<clock_timestamp()-interval '7 days' or measured>clock_timestamp()+interval '5 minutes' or duration>3600000 then raise exception 'Operational sample out of range' using errcode='22023';end if;
  select * into prior from private.finance_operation_samples_v1 where tenant_id=t and data_environment=p_data_environment and event_id=eid;
  if found then
   if prior.actor_id<>a or prior.metric<>s->>'metric' or prior.duration_ms<>duration or prior.outcome<>s->>'outcome' or prior.measured_at<>measured then raise exception 'Operational event replay conflict' using errcode='PT409';end if;
   continue;
  end if;
  if count_today>=200 then raise exception 'Operational samples rate limit reached' using errcode='54000';end if;
  insert into private.finance_operation_samples_v1 values(t,p_data_environment,eid,a,actor->>'role',s->>'metric',duration,s->>'outcome',measured,clock_timestamp());inserted:=inserted+1;count_today:=count_today+1;
 end loop;
 v_bucket:=date_trunc('hour',clock_timestamp())+make_interval(mins=>15*floor(extract(minute from clock_timestamp())/15)::integer);
 insert into private.finance_operation_alerts_v1(tenant_id,data_environment,bucket,metric,actor_role,failure_count,sample_count,p95_ms)
 select t,p_data_environment,v_bucket,metric,actor_role,count(*) filter(where outcome in('error','timeout')),count(*),percentile_disc(0.95) within group(order by duration_ms) filter(where outcome='ok')
 from private.finance_operation_samples_v1 where tenant_id=t and data_environment=p_data_environment and received_at>=v_bucket group by metric,actor_role
 having count(*) filter(where outcome in('error','timeout'))>=3 or (count(*) filter(where outcome='ok')>=20 and percentile_disc(0.95) within group(order by duration_ms) filter(where outcome='ok')>case when metric='search' then 2000 when metric in('bootstrap','list') then 3000 else 120000 end)
 on conflict(tenant_id,data_environment,bucket,metric,actor_role) do update set failure_count=excluded.failure_count,sample_count=excluded.sample_count,p95_ms=excluded.p95_ms,updated_at=clock_timestamp();
 -- Bounded private diagnostic retention; business audit logs are unaffected.
 delete from private.finance_operation_samples_v1 where tenant_id=t and received_at<clock_timestamp()-interval '30 days';
 return jsonb_build_object('ok',true,'inserted',inserted);
end $$;

create function public.finance_operations_read_v1(p_data_environment text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor jsonb:=private.finance_operations_actor_v1(true,false);t uuid:=(actor->>'tenantId')::uuid;metrics jsonb;alerts jsonb;
begin
 if p_data_environment is null or p_data_environment not in('production','test') then raise exception 'Invalid environment' using errcode='22023';end if;
 select coalesce(jsonb_agg(to_jsonb(x) order by metric,actor_role),'[]'::jsonb) into metrics from(select metric,actor_role,count(*) sample_count,count(*) filter(where outcome='ok') success_count,count(*) filter(where outcome='error') error_count,count(*) filter(where outcome='timeout') timeout_count,percentile_disc(0.95) within group(order by duration_ms) filter(where outcome='ok') p95_ms from private.finance_operation_samples_v1 where tenant_id=t and data_environment=p_data_environment and received_at>=now()-interval '1 day' group by metric,actor_role)x;
 select coalesce(jsonb_agg(to_jsonb(x) order by bucket desc,metric),'[]'::jsonb) into alerts from(select bucket,metric,actor_role,failure_count,sample_count,p95_ms,acknowledged_at from private.finance_operation_alerts_v1 where tenant_id=t and data_environment=p_data_environment and bucket>=now()-interval '7 days' order by bucket desc limit 100)x;
 return jsonb_build_object('ok',true,'metrics',metrics,'alerts',alerts,'windowHours',24,'generatedAt',clock_timestamp(),'evidence','observed_client_operations');
end $$;

create function public.finance_operation_alert_ack_v1(p_data_environment text,p_bucket timestamptz,p_metric text,p_actor_role text) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor jsonb:=private.finance_operations_actor_v1(true,false,true);n integer;
begin
 update private.finance_operation_alerts_v1 set acknowledged_by=actor->>'actorId',acknowledged_at=coalesce(acknowledged_at,clock_timestamp()) where tenant_id=(actor->>'tenantId')::uuid and data_environment=p_data_environment and bucket=p_bucket and metric=p_metric and actor_role=p_actor_role;
 get diagnostics n=row_count;if n<>1 then raise exception 'Alert not found in current scope' using errcode='42501';end if;return jsonb_build_object('ok',true);
end $$;

create function public.finance_identity_delivery_status_v1(p_limit integer default 50,p_before timestamptz default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor jsonb:=private.finance_operations_actor_v1(true,true);t uuid:=(actor->>'tenantId')::uuid;events jsonb;summary jsonb;hr jsonb;
begin
 if p_limit is null or p_limit<1 or p_limit>100 then raise exception 'Invalid identity status page size' using errcode='22023';end if;
 select coalesce(jsonb_agg(to_jsonb(x) order by created_at desc,id),'[]'::jsonb) into events from(select id,aggregate_type,aggregate_id,source_revision,status,attempt_count,last_error_code,last_http_status,delivered_at,response_digest,delivery_outcome,created_at from private.finance_edoc_sync_outbox_v1 where tenant_id=t and (p_before is null or created_at<p_before) order by created_at desc,id limit p_limit)x;
 select jsonb_build_object('pending',count(*) filter(where status in('pending','processing')),'failed',count(*) filter(where status in('failed','dead')),'delivered',count(*) filter(where status='delivered'),'oldestPendingAt',min(created_at) filter(where status in('pending','processing','failed','dead'))) into summary from private.finance_edoc_sync_outbox_v1 where tenant_id=t;
 -- The existing HR cursor is project-wide. Show its transport watermark only;
 -- never leak another tenant's people/counts or label it a per-person receipt.
 select jsonb_build_object('sourceRevision',revision,'acknowledgedRevision',acknowledged_revision,'lastAcknowledgedAt',last_acknowledged_at,'reviewCheckedAt',hr_review_checked_at,'scope','project_transport_watermark') into hr from private.hr_directory_cursor where id;
 return jsonb_build_object('ok',true,'events',events,'summary',summary,'hrTransport',hr,'sessionRevocationEvidence','requires_target_session_check');
end $$;

create function public.finance_identity_delivery_retry_v1(p_event_id uuid,p_expected_revision bigint) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor jsonb:=private.finance_operations_actor_v1(true,true,true);event private.finance_edoc_sync_outbox_v1;n integer;
begin
 select * into event from private.finance_edoc_sync_outbox_v1 where id=p_event_id and tenant_id=(actor->>'tenantId')::uuid for update;
 if not found then raise exception 'Identity event outside current tenant' using errcode='42501';end if;
 if p_expected_revision is distinct from event.source_revision or event.status not in('failed','dead') or exists(select 1 from private.finance_edoc_sync_outbox_v1 newer where newer.tenant_id=event.tenant_id and newer.aggregate_type=event.aggregate_type and newer.aggregate_id=event.aggregate_id and newer.source_revision>event.source_revision) then raise exception 'Only the latest failed identity event may be retried' using errcode='PT409';end if;
 update private.finance_edoc_sync_outbox_v1 set status='pending',attempt_count=0,next_attempt_at=clock_timestamp(),locked_at=null,locked_by=null,last_error_code=null,updated_at=clock_timestamp(),retry_history=retry_history||jsonb_build_array(jsonb_build_object('at',clock_timestamp(),'actorId',actor->>'actorId','reason','administrator_retry','previousAttemptCount',event.attempt_count)) where id=p_event_id;
 perform private.finance_wake_edoc_sync_worker_v1();
 return jsonb_build_object('ok',true,'eventId',p_event_id,'sourceRevision',event.source_revision,'status','pending','targetAcknowledged',false);
end $$;

revoke all on function public.finance_operation_samples_save_v1(text,jsonb),public.finance_operations_read_v1(text),public.finance_operation_alert_ack_v1(text,timestamptz,text,text),public.finance_identity_delivery_status_v1(integer,timestamptz),public.finance_identity_delivery_retry_v1(uuid,bigint) from public,anon,authenticated,service_role;
grant execute on function public.finance_operation_samples_save_v1(text,jsonb),public.finance_operations_read_v1(text),public.finance_operation_alert_ack_v1(text,timestamptz,text,text),public.finance_identity_delivery_status_v1(integer,timestamptz),public.finance_identity_delivery_retry_v1(uuid,bigint) to authenticated;
alter function private.finance_operations_actor_v1(boolean,boolean,boolean) owner to postgres;
alter function public.finance_operation_samples_save_v1(text,jsonb) owner to postgres;
alter function public.finance_operations_read_v1(text) owner to postgres;
alter function public.finance_operation_alert_ack_v1(text,timestamptz,text,text) owner to postgres;
alter function public.finance_identity_delivery_status_v1(integer,timestamptz) owner to postgres;
alter function public.finance_identity_delivery_retry_v1(uuid,bigint) owner to postgres;
notify pgrst,'reload schema';
