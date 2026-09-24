-- Apply only to Finance udtlppnrugmtzhigdsxo. Source metadata-only outbox; no auth/role/salary export.
create table private.hr_directory_cursor(id boolean primary key default true check(id),revision bigint not null default 1,effective_org_version bigint not null default 0,acknowledged_revision bigint not null default 0,last_acknowledged_at timestamptz,hr_review_checked_at timestamptz,hr_summary jsonb);
insert into private.hr_directory_cursor(id)values(true);
create table private.hr_directory_outbox(revision bigint primary key,source_table text not null,source_key text,operation text not null,created_at timestamptz not null default now());
alter table private.hr_directory_cursor enable row level security;alter table private.hr_directory_cursor force row level security;
alter table private.hr_directory_outbox enable row level security;alter table private.hr_directory_outbox force row level security;
revoke all on private.hr_directory_cursor,private.hr_directory_outbox from public,anon,authenticated,service_role;
create function private.hr_directory_changed()returns trigger language plpgsql security definer set search_path=''as $$declare v bigint;d jsonb;begin
 d:=case when tg_op='DELETE'then to_jsonb(old)else to_jsonb(new)end;
 update private.hr_directory_cursor set revision=revision+1 where id returning revision into v;
 insert into private.hr_directory_outbox(revision,source_table,source_key,operation)values(v,tg_table_name,d->>'id',tg_op);
 return case when tg_op='DELETE'then old else new end;
end$$;
revoke all on function private.hr_directory_changed()from public,anon,authenticated,service_role;
create trigger hr_directory_changed after insert or update or delete on public.finance_users for each row execute function private.hr_directory_changed();
create trigger hr_directory_changed after insert or update or delete on public.companies for each row execute function private.hr_directory_changed();
create trigger hr_directory_changed after insert or update or delete on public.employees for each row execute function private.hr_directory_changed();
create trigger hr_directory_changed after insert or update or delete on public.finance_department_units for each row execute function private.hr_directory_changed();
create trigger hr_directory_changed after insert or update or delete on private.finance_membership_org_versions_v1 for each row execute function private.hr_directory_changed();
create function private.hr_directory_export(command text,payload jsonb)returns jsonb language plpgsql security definer set search_path=''as $$
declare c private.hr_directory_cursor;org jsonb;summary jsonb;effective_version bigint;checked_at timestamptz;
begin
 if coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb->>'role'is distinct from'service_role'then raise exception'FINANCE_HR_DIRECTORY_FORBIDDEN'using errcode='42501';end if;
 if jsonb_typeof(payload)is distinct from'object'or octet_length(payload::text)>65536 or exists(select 1 from jsonb_object_keys(payload)x where x<>all(array['afterRevision','revision','summary']))then raise exception'FINANCE_HR_DIRECTORY_INVALID_INPUT';end if;
 select * into c from private.hr_directory_cursor where id for update;
 if command='ack'then
  if coalesce(payload->>'revision','')!~'^[1-9][0-9]{0,14}$'or(payload->>'revision')::bigint>c.revision then raise exception'FINANCE_HR_DIRECTORY_REVISION';end if;
  summary:=payload->'summary';
  if jsonb_typeof(summary)is distinct from'object'or(select count(*)from jsonb_object_keys(summary))<>5 or exists(select 1 from jsonb_object_keys(summary)x where x<>all(array['linkedPeople','linkedEmployments','pendingPeople','changedLinks','checkedAt']))then raise exception'FINANCE_HR_DIRECTORY_INVALID_INPUT';end if;
  if exists(select 1 from jsonb_each(summary)x where x.key<>'checkedAt'and(x.value::text!~'^[0-9]{1,8}$'))then raise exception'FINANCE_HR_DIRECTORY_INVALID_INPUT';end if;
  if coalesce(summary->>'checkedAt','')!~'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$'then raise exception'FINANCE_HR_DIRECTORY_INVALID_INPUT';end if;
  checked_at:=(summary->>'checkedAt')::timestamptz;if not isfinite(checked_at)or checked_at>now()+interval'5 minutes'then raise exception'FINANCE_HR_DIRECTORY_INVALID_INPUT';end if;
  if(payload->>'revision')::bigint<c.acknowledged_revision or checked_at<c.hr_review_checked_at then return jsonb_build_object('ok',true,'ignored',true);end if;
  update private.hr_directory_cursor set acknowledged_revision=greatest(acknowledged_revision,(payload->>'revision')::bigint),last_acknowledged_at=now(),hr_review_checked_at=checked_at,hr_summary=summary where id;
  return jsonb_build_object('ok',true);
 end if;
 if command<>'snapshot'then raise exception'FINANCE_HR_DIRECTORY_INVALID_COMMAND';end if;
 select coalesce(max(version_no),0)into effective_version from private.finance_membership_org_versions_v1 where status='published'and effective_at<=now();
 if effective_version<>c.effective_org_version then
  update private.hr_directory_cursor set revision=revision+1,effective_org_version=effective_version where id returning * into c;
  insert into private.hr_directory_outbox(revision,source_table,source_key,operation)values(c.revision,'finance_membership_org_versions_v1',effective_version::text,'EFFECTIVE');
 end if;
 if coalesce(payload->>'afterRevision','0')!~'^[0-9]{1,15}$'then raise exception'FINANCE_HR_DIRECTORY_INVALID_INPUT';end if;
 if (payload->>'afterRevision')::bigint=c.revision then return jsonb_build_object('unchanged',true,'revision',c.revision);end if;
 select jsonb_build_object('version',v.version_no,'effectiveAt',v.effective_at,'publishedAt',v.published_at,
  'units',coalesce((select jsonb_agg(jsonb_build_object('id',x->>'id','code',x->>'code','name',x->>'name','parentId',x->>'parent_org_unit_id','kind',x->>'unit_type','entityCodes',x->'entity_codes','active',x->'active')order by x->>'id')from jsonb_array_elements(v.snapshot->'units')x),'[]'::jsonb),
  'assignments',coalesce((select jsonb_agg(jsonb_build_object('id',x->>'id','personSourceId',x->>'finance_user_id','unitId',x->>'org_unit_id','unitCode',x->>'org_unit_code','positionCode',x->>'position_code','assignmentKind',x->>'assignment_kind','effectiveFrom',x->>'effective_from','effectiveTo',x->>'effective_to','active',x->'active')order by x->>'id')from jsonb_array_elements(v.snapshot->'assignments')x),'[]'::jsonb))into org
 from private.finance_membership_org_versions_v1 v where v.status='published'and v.effective_at<=now()order by v.version_no desc limit 1;
 return jsonb_build_object('schemaVersion',1,'sourceProject','udtlppnrugmtzhigdsxo','revision',c.revision,'generatedAt',now(),
 'companies',coalesce((select jsonb_agg(jsonb_build_object('id',id,'code',code,'name',name,'legalName',legal_name,'taxId',case when tax_id~'^[0-9]{8}$'then tax_id end,'taxIdStatus',case when tax_id is null or tax_id=''then'missing'when tax_id~'^[0-9]{8}$'then'format_only'else'invalid'end,'status',status,'deletedAt',deleted_at)order by id)from public.companies),'[]'::jsonb),
 'people',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'code',shared_identity_employee_no,'entityCode',entity_id,'departmentCode',department_code,'jobTitle',job_title,'active',coalesce(active,false),'category',case when org_status='system_account'then'system_account'when org_status='duplicate_retired'then'duplicate_retired'else'person'end)order by id)from public.finance_users),'[]'::jsonb),
 'projections',coalesce((select jsonb_agg(jsonb_build_object('id',id,'personSourceId',metadata->>'finance_user_id','companyId',company_id,'employeeNo',employee_no,'name',full_name,'hireDate',hire_date,'terminationDate',termination_date,'sourceStatus',employment_status,'deletedAt',deleted_at)order by id)from public.employees),'[]'::jsonb),
 'departments',coalesce((select jsonb_agg(jsonb_build_object('id',tenant_id::text||':'||id,'tenantId',tenant_id,'code',code,'name',name,'parentId',parent_unit_id,'entityCode',primary_entity_code,'active',active,'kind',unit_type)order by tenant_id,id)from public.finance_department_units),'[]'::jsonb),'organization',org);
end$$;
create function public.finance_hr_directory_transport(command text,payload jsonb)returns jsonb language sql security invoker set search_path=''as $$select private.hr_directory_export(command,payload)$$;
revoke all on function private.hr_directory_export(text,jsonb),public.finance_hr_directory_transport(text,jsonb)from public,anon,authenticated,service_role;
grant usage on schema private to service_role;
grant execute on function private.hr_directory_export(text,jsonb),public.finance_hr_directory_transport(text,jsonb)to service_role;
notify pgrst,'reload schema';
