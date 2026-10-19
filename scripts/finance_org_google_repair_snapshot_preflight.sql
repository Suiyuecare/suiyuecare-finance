\set ON_ERROR_STOP on
-- Read-only, exact reviewed pre-repair state.
do $org_repair_authority$
declare x record; p pg_catalog.pg_proc%rowtype;
begin
 perform pg_catalog.set_config('search_path','',true);
 for x in select * from (values
  ('private.finance_org_runtime_revision_v2(uuid)','fd678114c56e560cfad77642236d020f','{postgres=X/postgres}'),
  ('private.finance_org_snapshot_from_runtime_v2(uuid)','3b5b89d0481e531af43cb4847504b678','{postgres=X/postgres}'),
  ('private.finance_org_publish_runtime_v2(uuid,text,text)','c82e75b9e0e2d134f59df0f212380e49','{postgres=X/postgres}'),
  ('private.finance_membership_org_seed_snapshot_v1(uuid)','674f27114543e35a1002c6bd41f51534','{postgres=X/postgres}'),
  ('private.finance_membership_org_validate_v1(uuid,jsonb)','12c14949b01752fd1eb78146f19e44ec','{postgres=X/postgres}'),
  ('private.finance_membership_org_etag_v1(jsonb,bigint)','6c5402972367b9adccd99478b84b4016','{postgres=X/postgres}'),
  ('public.finance_user_has_frozen_pending_assignee(uuid,text)','753b6a36ff6056a92d097d3e5df84685','{postgres=X/postgres,service_role=X/postgres}')
 ) as expected(signature,definition_md5,acl) loop
  select * into p from pg_catalog.pg_proc where oid=pg_catalog.to_regprocedure(x.signature);
  if p.oid is null or pg_catalog.md5(pg_catalog.pg_get_functiondef(p.oid)) is distinct from x.definition_md5
    or pg_catalog.pg_get_userbyid(p.proowner)<>'postgres' or not p.prosecdef
    or p.proconfig is distinct from (case when x.signature='public.finance_user_has_frozen_pending_assignee(uuid,text)' then array['search_path=public, pg_temp']::text[] else array['search_path=""']::text[] end) or p.proacl::text is distinct from x.acl then
   raise exception 'Organization repair authority drift: %',x.signature using errcode='55000';
  end if;
 end loop;
end $org_repair_authority$;
do $org_repair_preflight$
declare
 tenant constant uuid:='00000000-0000-0000-0000-000000000001';
 old_hash constant text:='170272275c125f1bff6ad98845879c50f9c35e3575fcc467c430e9f2c580127c';
 target_hash constant text:='748cccf0bee435b941279f71f6541e097d74cebfe0ebb6e4217de512226a270a';
 assignment_hash constant text:='d3d16b11db0c7654127faf441a08a61fe52d805cdf98d38d993aaab9044f11af';
 incident_hash constant text:='5355822ab71ddf296920522b90951f3ccf58921d1eeca49df77745f3fc2f5a42';
 technical_actor constant text:='migration_finance_org_google_repair_snapshot_20261019';
 v private.finance_membership_org_versions_v1; person public.finance_users; runtime jsonb; old_assignment jsonb; current_assignment jsonb;
begin
 select * into v from private.finance_membership_org_versions_v1 where tenant_id=tenant and status='published';
 if v.id is null or v.version_no<>9 or v.status<>'published'
   or pg_catalog.encode(extensions.digest(v.snapshot::text,'sha256'),'hex')<>old_hash
   or pg_catalog.encode(extensions.digest(v.etag,'sha256'),'hex')<>'b5a01bd82a385eddadac78a98f8dabc3bc2dc3ccc7fc08a5a6082ebc403a59a1'
   or (select count(*) from private.finance_membership_org_versions_v1 where tenant_id=tenant and status='published')<>1 then
  raise exception 'Organization repair reviewed published baseline changed' using errcode='55000';
 end if;
 runtime:=private.finance_org_snapshot_from_runtime_v2(tenant);
 if not coalesce((private.finance_membership_org_validate_v1(tenant,v.snapshot)->>'ok')::boolean,false)
   or not coalesce((private.finance_membership_org_validate_v1(tenant,runtime)->>'ok')::boolean,false)
   or (v.snapshot-'assignments') is distinct from (runtime-'assignments') then
  raise exception 'Organization repair changed hierarchy or invalid snapshot' using errcode='55000';
 end if;
 select a into old_assignment from pg_catalog.jsonb_array_elements(v.snapshot->'assignments') a
 where pg_catalog.encode(extensions.digest(a->>'id','sha256'),'hex')=assignment_hash;
 select a into current_assignment from pg_catalog.jsonb_array_elements(runtime->'assignments') a
 where pg_catalog.encode(extensions.digest(a->>'id','sha256'),'hex')=assignment_hash;
 if old_assignment is null or current_assignment is null
   or old_assignment->'can_approve' is distinct from 'true'::jsonb
   or current_assignment->'can_approve' is distinct from 'false'::jsonb
   or pg_catalog.encode(extensions.digest(current_assignment->>'finance_user_id','sha256'),'hex')<>target_hash
   or pg_catalog.encode(extensions.digest(current_assignment->'metadata'->>'google_identity_repair_incident','sha256'),'hex') is distinct from incident_hash
   or (old_assignment-'metadata'-'can_approve') is distinct from (current_assignment-'metadata'-'can_approve')
   or ((old_assignment->'metadata')-array['contact_email','source_payload','google_identity_repair_incident','google_login_projection_synced_at'])
      is distinct from ((current_assignment->'metadata')-array['contact_email','source_payload','google_identity_repair_incident','google_login_projection_synced_at']) then
  raise exception 'Organization repair is not the reviewed Google revocation' using errcode='55000';
 end if;
 -- Full equality of every other assignment: no additions, removals, rank,
 -- department, dates, delegation or approval-capability change may pass.
 if (select pg_catalog.jsonb_agg(a order by a::text) from pg_catalog.jsonb_array_elements(v.snapshot->'assignments') a where a->>'id'<>old_assignment->>'id')
   is distinct from (select pg_catalog.jsonb_agg(a order by a::text) from pg_catalog.jsonb_array_elements(runtime->'assignments') a where a->>'id'<>current_assignment->>'id')
   or (select count(*) from pg_catalog.jsonb_array_elements(v.snapshot->'assignments') a where a->>'id'=old_assignment->>'id')<>1
   or (select count(*) from pg_catalog.jsonb_array_elements(runtime->'assignments') a where a->>'id'=current_assignment->>'id')<>1 then
  raise exception 'Organization repair includes unrelated assignment changes' using errcode='55000';
 end if;
 select * into person from public.finance_users where tenant_id=tenant and id=current_assignment->>'finance_user_id';
 if person.id is null or person.role is distinct from 'employee' or person.active is distinct from true
   or person.org_status is distinct from 'system_account' or person.auth_user_id is not null
   or person.google_link_status is distinct from 'blocked'
   or exists(select 1 from public.employee_department_roles r where r.tenant_id=tenant and r.finance_user_id=person.id and r.active and r.can_approve)
   or public.finance_user_has_frozen_pending_assignee(tenant,person.id) then
  raise exception 'Organization repair revoked identity is no longer safely detached' using errcode='55000';
 end if;
end $org_repair_preflight$;
select 'FINANCE_ORG_GOOGLE_REPAIR_SNAPSHOT_PREFLIGHT_OK' as marker;
