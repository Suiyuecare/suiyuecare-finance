-- Human-facing candidates only; no ledger/payment/identity provisioning writes.
set local lock_timeout='5s';
set local statement_timeout='120s';

alter function finance_apm_private.command(text,jsonb) rename to command_before_workbench;
create function finance_apm_private.command(cmd text,p jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare a jsonb;t uuid;u text;m finance_apm_private.metric_mappings;c text;begin
 -- Reauthorize before every replay. Old receipts do not restore revoked access.
 a:=finance_apm_private.actor(p->>'entityId');t:=(a->>'tenantId')::uuid;u:=a->>'actorId';
 if cmd='mapping.propose' then
  perform private.finance_reporting_department_v1(t,p->>'entityId',p->>'departmentCode');
  if jsonb_typeof(p->'accountCodes')='array' then
   for c in select jsonb_array_elements_text(p->'accountCodes') loop perform private.finance_reporting_account_v1(t,c);end loop;
  end if;
 elsif cmd in('mapping.verify','snapshot.preview','snapshot.approve') then
  select * into m from finance_apm_private.metric_mappings where id=(p->>'mappingId')::uuid and tenant_id=t and entity_id=p->>'entityId';
  if m.id is null then raise exception 'FINANCE_APM_FORBIDDEN' using errcode='42501';end if;
  perform private.finance_reporting_department_v1(t,m.entity_id,m.department_code);
  foreach c in array m.account_codes loop perform private.finance_reporting_account_v1(t,c);end loop;
  if cmd='snapshot.approve' and not exists(
   select 1 from finance_apm_private.commands x join public.finance_users f on f.tenant_id=x.tenant_id and f.id=x.actor_id
   where x.tenant_id=t and x.actor_id<>u and f.active and f.role in('accountant','ceo') and f.auth_user_id is not null
    and x.result->>'previewHash'=p->>'previewHash' and x.result->'evidence'->>'mappingId'=m.id::text
    and x.result->'evidence'->>'year'=p->>'year' and x.result->'evidence'->>'quarter'=p->>'quarter'
  ) then raise exception 'FINANCE_APM_INDEPENDENT_REVIEW_REQUIRED' using errcode='42501';end if;
 end if;
 return finance_apm_private.command_before_workbench(cmd,p);
end $$;

create function finance_apm_private.workbench(entity text default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.finance_users;authz jsonb;t uuid;e jsonb;entities jsonb:='[]';departments jsonb:='[]';accounts jsonb:='[]';
 mappings jsonb:='[]';periods jsonb:='[]';previews jsonb:='[]';snapshots jsonb:='[]';obligations jsonb:='[]';proposals jsonb:='[]';
 o finance_hr_private.finance_hr_obligations;v public.vouchers;original public.vouchers;reversals jsonb;ev jsonb;paid boolean;begin
 if not public.finance_auth_session_active() then raise exception 'FINANCE_APM_FORBIDDEN' using errcode='42501';end if;
 a:=public.current_finance_user();t:=a.tenant_id;
 if auth.uid() is null or a.auth_user_id is distinct from auth.uid() or not a.active or a.role not in('accountant','ceo') then raise exception 'FINANCE_APM_FORBIDDEN' using errcode='42501';end if;
 for e in select x from public.system_settings s cross join lateral jsonb_array_elements(case when jsonb_typeof(s.value)='array' then s.value else '[]' end) x where s.tenant_id=t and s.key='entities' loop
  if e->>'active'='false' then continue;end if;
  begin authz:=finance_apm_private.actor(e->>'id');exception when insufficient_privilege then continue;end;
  entities:=entities||jsonb_build_array(jsonb_build_object('id',e->>'id','name',coalesce(e->>'full',e->>'n',e->>'s',e->>'id')));
 end loop;
 if jsonb_array_length(entities)>100 then raise exception 'FINANCE_APM_WORKBENCH_LIMIT';end if;
 if entity is not null then
  authz:=finance_apm_private.actor(entity);
  if not exists(select 1 from jsonb_array_elements(entities) x where x->>'id'=entity) then raise exception 'FINANCE_APM_FORBIDDEN' using errcode='42501';end if;
  select coalesce(jsonb_agg(jsonb_build_object('code',d->>'c','name',coalesce(d->>'n',d->>'name',d->>'c')) order by d->>'c'),'[]') into departments
   from public.system_settings s cross join lateral jsonb_array_elements(case when jsonb_typeof(s.value)='array' then s.value else '[]' end) d
   where s.tenant_id=t and s.key='departments' and exists(select 1 from public.finance_department_units u join public.finance_department_entity_scopes scope on scope.tenant_id=u.tenant_id and scope.unit_id=u.id and scope.active where u.tenant_id=t and u.active and u.is_posting_unit and u.code=d->>'c' and scope.entity_code=entity);
  select coalesce(jsonb_agg(jsonb_build_object('code',coalesce(d->>'c',d->>'code'),'name',coalesce(d->>'n',d->>'name',d->>'c',d->>'code')) order by coalesce(d->>'c',d->>'code')),'[]') into accounts
   from public.system_settings s cross join lateral jsonb_array_elements(case when jsonb_typeof(s.value)='array' then s.value else '[]' end) d
   where s.tenant_id=t and s.key='accounts' and coalesce(d->>'c',d->>'code')~'^4[0-9A-Za-z_-]{0,19}$' and d->>'active' is distinct from 'false';
  select coalesce(jsonb_agg(to_jsonb(m)||jsonb_build_object('active',finance_apm_private.active(m),'proposerName',(select f.name from public.finance_users f where f.tenant_id=t and f.id=m.created_by),
    'decisions',coalesce((select jsonb_agg(jsonb_build_object('decision',d.decision,'actorName',f.name,'at',d.created_at,'reference',d.reference)) from finance_apm_private.mapping_decisions d left join public.finance_users f on f.tenant_id=t and f.id=d.actor_id where d.mapping_id=m.id),'[]')) order by m.created_at desc),'[]') into mappings from finance_apm_private.metric_mappings m where m.tenant_id=t and m.entity_id=entity;
  select coalesce(jsonb_agg(jsonb_build_object('year',y,'quarter',q) order by y desc,q desc),'[]') into periods from (
   select substring(period,1,4)::integer y,((substring(period,6,2)::integer-1)/3+1) q
   from public.period_closes where tenant_id=t and entity_id=entity and data_environment='production' and status='closed' and period~'^[0-9]{4}-(0[1-9]|1[0-2])$'
   group by 1,2 having count(distinct period)=3 and (make_date(substring(min(period),1,4)::integer,((substring(min(period),6,2)::integer-1)/3)*3+1,1)+interval '3 months')::date<=current_date
  ) complete;
  select coalesce(jsonb_agg(jsonb_build_object('id',x.request_id,'actorId',x.actor_id,'actorName',f.name,'createdAt',x.created_at,'previewHash',x.result->'previewHash','evidence',x.result->'evidence') order by x.created_at desc),'[]') into previews
   from finance_apm_private.commands x join finance_apm_private.metric_mappings m on m.id::text=x.result->'evidence'->>'mappingId' join public.finance_users f on f.id=x.actor_id and f.tenant_id=t
   where x.tenant_id=t and m.tenant_id=t and m.entity_id=entity and x.result ? 'previewHash' and f.active and f.role in('accountant','ceo') and finance_apm_private.active(m)
    and not exists(select 1 from finance_apm_private.metric_snapshots s where s.mapping_id=m.id and s.year::text=x.result->'evidence'->>'year' and s.quarter::text=x.result->'evidence'->>'quarter');
  select coalesce(jsonb_agg(jsonb_build_object('snapshot',s.snapshot,'approvedAt',s.approved_at,'approvedBy',(select f.name from public.finance_users f where f.tenant_id=t and f.id=s.approved_by),'mappingId',m.id) order by s.approved_at desc),'[]') into snapshots
   from finance_apm_private.metric_snapshots s join finance_apm_private.metric_mappings m on m.id=s.mapping_id where m.tenant_id=t and m.entity_id=entity;
  if (select count(*) from finance_hr_private.finance_hr_obligations x where x.tenant_id=t and x.legal_entity_code=entity and x.kind='bonus' and finance_hr_private.finance_hr_reader(t,x.source_employer_id,a.id))>200 then raise exception 'FINANCE_APM_WORKBENCH_LIMIT';end if;
  for o in select * from finance_hr_private.finance_hr_obligations x where x.tenant_id=t and x.legal_entity_code=entity and x.kind='bonus' and finance_hr_private.finance_hr_reader(t,x.source_employer_id,a.id) order by x.created_at desc loop
   select x.* into original from public.vouchers x join finance_hr_private.finance_hr_voucher_claims c on c.voucher_id=x.id where c.obligation_id=o.obligation_id;
   paid:=exists(select 1 from finance_hr_private.finance_hr_events x where x.obligation_id=o.obligation_id and x.action='bank_disbursement' and x.actor_system='finance');reversals:='[]';
   if paid and original.id is not null then
    for v in select * from public.vouchers x where x.tenant_id=t and x.entity_id=entity and x.data_environment='production' and x.adjusts_voucher_no=original.no and x.posted and x.voided_at is null
     and not exists(select 1 from finance_apm_private.correction_proposals c where c.reversal_voucher_id=x.id) order by x.no loop
     begin ev:=finance_apm_private.correction_evidence(o,v.id);exception when sqlstate 'P0001' then continue;end;
     reversals:=reversals||jsonb_build_array(jsonb_build_object('id',v.id,'number',v.no,'total',v.total));
    end loop;
   end if;
   obligations:=obligations||jsonb_build_array(jsonb_build_object('id',o.obligation_id,'flowId',o.flow_id,'period',o.period,'payDate',o.pay_date,'status',o.status,'paid',paid,'totalNetCents',o.total_net_cents,'originalVoucherNumber',original.no,'reversals',reversals));
  end loop;
  select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'obligationId',p.obligation_id,'period',ob.period,'proposerId',p.proposed_by,'proposerName',(select f.name from public.finance_users f where f.tenant_id=t and f.id=p.proposed_by),'createdAt',p.created_at,'reference',p.reference,'refund',p.refund,'originalBatchId',p.original_batch_id,'correctionBatchId',p.correction_batch_id,'correctionSourceHash',p.correction_source_hash,'reversalVoucherNumber',voucher.no,'receipt',r.receipt,'verifierName',(select f.name from public.finance_users f where f.tenant_id=t and f.id=r.verified_by)) order by p.created_at desc),'[]') into proposals
   from finance_apm_private.correction_proposals p join finance_hr_private.finance_hr_obligations ob on ob.obligation_id=p.obligation_id join public.vouchers voucher on voucher.id=p.reversal_voucher_id left join finance_apm_private.correction_receipts r on r.proposal_id=p.id
   where p.tenant_id=t and ob.legal_entity_code=entity and finance_hr_private.finance_hr_reader(t,ob.source_employer_id,a.id);
 end if;
 if jsonb_array_length(mappings)>200 or jsonb_array_length(previews)>500 or jsonb_array_length(snapshots)>500 or jsonb_array_length(proposals)>200 then raise exception 'FINANCE_APM_WORKBENCH_LIMIT';end if;
 return jsonb_build_object('actor',jsonb_build_object('id',a.id,'name',a.name,'role',a.role),'entityId',entity,'entities',entities,'departments',departments,'accounts',accounts,'mappings',mappings,'periods',periods,'previews',previews,'snapshots',snapshots,'obligations',obligations,'corrections',proposals);
end $$;
create function public.finance_apm_workbench(entity_id text default null) returns jsonb language sql security invoker set search_path='' as $$select finance_apm_private.workbench(entity_id)$$;
revoke all on function finance_apm_private.command_before_workbench(text,jsonb),finance_apm_private.command(text,jsonb),finance_apm_private.workbench(text),public.finance_apm_workbench(text) from public,anon,authenticated,service_role;
grant execute on function finance_apm_private.command(text,jsonb),finance_apm_private.workbench(text),public.finance_apm_workbench(text) to authenticated;
