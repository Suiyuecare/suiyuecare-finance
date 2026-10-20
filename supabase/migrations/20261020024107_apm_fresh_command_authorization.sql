-- Final VOLATILE authorization runs after every lock/delegated command. A failure
-- aborts the entire statement, including its evidence, receipt and replay rows.
-- Never edit the already-published F1-F4 functions or broaden their grants.
set local lock_timeout='5s';
set local statement_timeout='120s';
create function finance_apm_private.fresh_session() returns boolean
language plpgsql volatile security invoker set search_path='' as $$
declare sid uuid;begin
 begin sid:=nullif(auth.jwt()->>'session_id','')::uuid;exception when invalid_text_representation then return false;end;
 if sid is null or auth.uid() is null or not public.finance_auth_session_active() then return false;end if;
 return exists(select 1 from auth.sessions s where s.id=sid and s.user_id=auth.uid() and(s.not_after is null or s.not_after>clock_timestamp()));
end $$;
create function finance_apm_private.fresh_actor(entity text) returns jsonb
language plpgsql volatile security invoker set search_path='' as $$
declare a public.finance_users; scope jsonb;
begin
 if not finance_apm_private.fresh_session() then raise exception 'FINANCE_APM_AUTHORITY_CHANGED' using errcode='42501';end if;
 a:=public.current_finance_user();
 if auth.uid() is null or a.id is null or a.auth_user_id is distinct from auth.uid() or a.active is distinct from true or a.role not in('accountant','ceo') then raise exception 'FINANCE_APM_AUTHORITY_CHANGED' using errcode='42501';end if;
 scope:=private.finance_reporting_actor_v1(entity,'production');
 if scope->>'actorId' is distinct from a.id or scope->>'tenantId' is distinct from a.tenant_id::text or (scope->>'canEditWorkpaper')::boolean is distinct from true then raise exception 'FINANCE_APM_AUTHORITY_CHANGED' using errcode='42501';end if;
 return scope||jsonb_build_object('role',a.role);
end $$;
alter function finance_apm_private.command(text,jsonb) rename to command_before_fresh_authorization;
create function finance_apm_private.command(cmd text,p jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare before_actor jsonb;after_actor jsonb;result jsonb;m finance_apm_private.metric_mappings;c text;
begin
 before_actor:=finance_apm_private.fresh_actor(p->>'entityId');
 result:=finance_apm_private.command_before_fresh_authorization(cmd,p);
 -- Separate SQL commands inside a VOLATILE function obtain a fresh snapshot;
 -- this must not be replaced by a STABLE helper or a cached pre-lock record.
 after_actor:=finance_apm_private.fresh_actor(p->>'entityId');
 if after_actor->>'actorId' is distinct from before_actor->>'actorId' or after_actor->>'tenantId' is distinct from before_actor->>'tenantId' then raise exception 'FINANCE_APM_AUTHORITY_CHANGED' using errcode='42501';end if;
 if cmd in('mapping.verify','mapping.revoke') and after_actor->>'role'<>'ceo' then raise exception 'FINANCE_APM_AUTHORITY_CHANGED' using errcode='42501';end if;
 if cmd<>'list' then
  select * into m from finance_apm_private.metric_mappings where id=coalesce(nullif(p->>'mappingId',''),result->>'mappingId')::uuid and tenant_id=(after_actor->>'tenantId')::uuid and entity_id=p->>'entityId';
  if m.id is null then raise exception 'FINANCE_APM_AUTHORITY_CHANGED' using errcode='42501';end if;
  perform private.finance_reporting_department_v1(m.tenant_id,m.entity_id,m.department_code);
  foreach c in array m.account_codes loop perform private.finance_reporting_account_v1(m.tenant_id,c);end loop;
  if cmd in('mapping.verify','snapshot.preview','snapshot.approve') and not finance_apm_private.active(m) then raise exception 'FINANCE_APM_AUTHORITY_CHANGED' using errcode='42501';end if;
  if cmd='snapshot.approve' and not exists(
   select 1 from finance_apm_private.commands x join public.finance_users f on f.tenant_id=x.tenant_id and f.id=x.actor_id
   where x.tenant_id=m.tenant_id and x.actor_id<>after_actor->>'actorId' and f.active and f.role in('accountant','ceo') and f.auth_user_id is not null
    and x.result->>'previewHash'=p->>'previewHash' and x.result->'evidence'->>'mappingId'=m.id::text
    and x.result->'evidence'->>'year'=p->>'year' and x.result->'evidence'->>'quarter'=p->>'quarter'
  ) then raise exception 'FINANCE_APM_AUTHORITY_CHANGED' using errcode='42501';end if;
 end if;
 return result;
end $$;
alter function finance_apm_private.correction_command(text,jsonb) rename to correction_command_before_fresh_authorization;
create function finance_apm_private.correction_command(cmd text,p jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare before_actor public.finance_users;after_actor public.finance_users;result jsonb;o finance_hr_private.finance_hr_obligations;proposal finance_apm_private.correction_proposals;
begin
 before_actor:=public.current_finance_user();
 result:=finance_apm_private.correction_command_before_fresh_authorization(cmd,p);
 if not finance_apm_private.fresh_session() then raise exception 'FINANCE_APM_AUTHORITY_CHANGED' using errcode='42501';end if;
 after_actor:=public.current_finance_user();
 if auth.uid() is null or after_actor.id is null or after_actor.auth_user_id is distinct from auth.uid() or after_actor.active is distinct from true or after_actor.role not in('accountant','ceo') or after_actor.id is distinct from before_actor.id or after_actor.tenant_id is distinct from before_actor.tenant_id then raise exception 'FINANCE_APM_AUTHORITY_CHANGED' using errcode='42501';end if;
 if cmd='list' then
  if exists(select 1 from jsonb_array_elements(result->'proposals')x join finance_hr_private.finance_hr_obligations f on f.obligation_id=(x->>'obligation_id')::uuid where not finance_hr_private.finance_hr_reader(f.tenant_id,f.source_employer_id,after_actor.id)) then raise exception 'FINANCE_APM_AUTHORITY_CHANGED' using errcode='42501';end if;
 else
  if cmd='verify' then
   select * into proposal from finance_apm_private.correction_proposals where id=(p->>'proposalId')::uuid;
   select * into o from finance_hr_private.finance_hr_obligations where obligation_id=proposal.obligation_id;
  else select * into o from finance_hr_private.finance_hr_obligations where obligation_id=(p->>'obligationId')::uuid;end if;
  if o.obligation_id is null or o.tenant_id is distinct from after_actor.tenant_id or not finance_hr_private.finance_hr_reader(o.tenant_id,o.source_employer_id,after_actor.id) then raise exception 'FINANCE_APM_AUTHORITY_CHANGED' using errcode='42501';end if;
 end if;
 return result;
end $$;
revoke all on function finance_apm_private.fresh_session(),finance_apm_private.fresh_actor(text),finance_apm_private.command_before_fresh_authorization(text,jsonb),finance_apm_private.correction_command_before_fresh_authorization(text,jsonb),finance_apm_private.command(text,jsonb),finance_apm_private.correction_command(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function finance_apm_private.command(text,jsonb),finance_apm_private.correction_command(text,jsonb) to authenticated;
