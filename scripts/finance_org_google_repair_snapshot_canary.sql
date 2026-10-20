-- Read-only organization publication checks; no staff identity is used.
begin isolation level repeatable read read only;
-- FINANCE_AUTHENTICATED_CANARY_CORE_BEGIN
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
do $org_repair_postflight$
declare
 tenant constant uuid:='00000000-0000-0000-0000-000000000001';
 old_hash constant text:='170272275c125f1bff6ad98845879c50f9c35e3575fcc467c430e9f2c580127c';
 target_hash constant text:='748cccf0bee435b941279f71f6541e097d74cebfe0ebb6e4217de512226a270a';
 assignment_hash constant text:='d3d16b11db0c7654127faf441a08a61fe52d805cdf98d38d993aaab9044f11af';
 incident_hash constant text:='5355822ab71ddf296920522b90951f3ccf58921d1eeca49df77745f3fc2f5a42';
 technical_actor constant text:='migration_finance_org_google_repair_snapshot_20261019';
 old_version private.finance_membership_org_versions_v1; repaired private.finance_membership_org_versions_v1; current_version private.finance_membership_org_versions_v1;
begin
 select * into old_version from private.finance_membership_org_versions_v1 where tenant_id=tenant and version_no=9;
 select * into repaired from private.finance_membership_org_versions_v1 where tenant_id=tenant and created_by_finance_user_id=technical_actor;
 select * into current_version from private.finance_membership_org_versions_v1 where tenant_id=tenant and status='published';
 if old_version.id is null or old_version.status<>'archived'
  or pg_catalog.encode(extensions.digest(old_version.snapshot::text,'sha256'),'hex')<>old_hash
  or pg_catalog.encode(extensions.digest(old_version.etag,'sha256'),'hex')<>'b5a01bd82a385eddadac78a98f8dabc3bc2dc3ccc7fc08a5a6082ebc403a59a1'
  or repaired.id is null or repaired.version_no<>10 or repaired.revision<>1
  or repaired.source_version_id is distinct from old_version.id or repaired.approved_by_finance_user_id is not null
  or repaired.status not in('published','archived') or repaired.validation_summary->>'ok' is distinct from 'true'
  or repaired.reason is distinct from '技術修復：同步已授權 Google 舊共用身分撤權，保留歷史與全部業務資料'
  or (select count(*) from private.finance_membership_org_versions_v1 where tenant_id=tenant and created_by_finance_user_id=technical_actor)<>1
  or current_version.id is null or current_version.source_runtime_revision is distinct from private.finance_org_runtime_revision_v2(tenant)
  or not coalesce((private.finance_membership_org_validate_v1(tenant,current_version.snapshot)->>'ok')::boolean,false) then
  raise exception 'Organization repair publication or current runtime verification failed' using errcode='55000';
 end if;
 if (select count(*) from pg_catalog.jsonb_array_elements(repaired.snapshot->'assignments') a
   where pg_catalog.encode(extensions.digest(a->>'id','sha256'),'hex')=assignment_hash
     and pg_catalog.encode(extensions.digest(a->>'finance_user_id','sha256'),'hex')=target_hash
     and pg_catalog.encode(extensions.digest(a->'metadata'->>'google_identity_repair_incident','sha256'),'hex')=incident_hash
     and a->'can_approve'='false'::jsonb)<>1 then
  raise exception 'Organization repaired snapshot lost reviewed revocation' using errcode='55000';
 end if;
end $org_repair_postflight$;
do $org_repair_preserved_delta$
declare
 tenant constant uuid:='00000000-0000-0000-0000-000000000001';
 old_hash constant text:='170272275c125f1bff6ad98845879c50f9c35e3575fcc467c430e9f2c580127c';
 target_hash constant text:='748cccf0bee435b941279f71f6541e097d74cebfe0ebb6e4217de512226a270a';
 assignment_hash constant text:='d3d16b11db0c7654127faf441a08a61fe52d805cdf98d38d993aaab9044f11af';
 incident_hash constant text:='5355822ab71ddf296920522b90951f3ccf58921d1eeca49df77745f3fc2f5a42';
 technical_actor constant text:='migration_finance_org_google_repair_snapshot_20261019';
 old_snapshot jsonb; repaired_snapshot jsonb; a jsonb; b jsonb;
begin
 select snapshot into old_snapshot from private.finance_membership_org_versions_v1 where tenant_id=tenant and version_no=9;
 select snapshot into repaired_snapshot from private.finance_membership_org_versions_v1 where tenant_id=tenant and created_by_finance_user_id=technical_actor;
 select x into a from pg_catalog.jsonb_array_elements(old_snapshot->'assignments') x where pg_catalog.encode(extensions.digest(x->>'id','sha256'),'hex')=assignment_hash;
 select x into b from pg_catalog.jsonb_array_elements(repaired_snapshot->'assignments') x where pg_catalog.encode(extensions.digest(x->>'id','sha256'),'hex')=assignment_hash;
 if (old_snapshot-'assignments') is distinct from (repaired_snapshot-'assignments')
  or (a-'metadata'-'can_approve') is distinct from (b-'metadata'-'can_approve')
  or ((a->'metadata')-array['contact_email','source_payload','google_identity_repair_incident','google_login_projection_synced_at'])
    is distinct from ((b->'metadata')-array['contact_email','source_payload','google_identity_repair_incident','google_login_projection_synced_at'])
  or (select pg_catalog.jsonb_agg(x order by x::text) from pg_catalog.jsonb_array_elements(old_snapshot->'assignments') x where x->>'id'<>a->>'id')
    is distinct from (select pg_catalog.jsonb_agg(x order by x::text) from pg_catalog.jsonb_array_elements(repaired_snapshot->'assignments') x where x->>'id'<>b->>'id') then
  raise exception 'Organization repair published snapshot contains unrelated changes' using errcode='55000';
 end if;
end $org_repair_preserved_delta$;
do $org_repair_ledger$
begin
 if (select count(*) from supabase_migrations.schema_migrations where version='20261019063700')<>1
  or not exists(select 1 from supabase_migrations.schema_migrations where version='20261019063700'
    and name='finance_org_google_repair_snapshot_v1'
    and pg_catalog.md5(pg_catalog.array_to_string(statements,''))='3a069b62efa9a80216ac0b5bb52d05f7') then
  raise exception 'Organization repair sealed ledger missing or differs' using errcode='55000';
 end if;
end $org_repair_ledger$;
do $org_repair_no_client_write$
begin
 if pg_catalog.has_function_privilege('authenticated','private.finance_org_publish_runtime_v2(uuid,text,text)','EXECUTE')
  or pg_catalog.has_function_privilege('anon','private.finance_org_publish_runtime_v2(uuid,text,text)','EXECUTE')
  or pg_catalog.has_function_privilege('service_role','private.finance_org_publish_runtime_v2(uuid,text,text)','EXECUTE') then
  raise exception 'Organization publication helper exposed to client' using errcode='42501';
 end if;
end $org_repair_no_client_write$;
-- FINANCE_AUTHENTICATED_CANARY_CORE_END
rollback;
-- FINANCE_AUTHENTICATED_CANARY_ROLLBACK_CHECK_BEGIN
do $org_repair_rollback$
begin if pg_catalog.current_setting('transaction_read_only')='on' then raise exception 'Organization canary remains open';end if;end $org_repair_rollback$;
-- FINANCE_AUTHENTICATED_CANARY_ROLLBACK_CHECK_END
select 'FINANCE_ORG_GOOGLE_REPAIR_SNAPSHOT_CANARY_ROLLED_BACK' as marker,
 pg_catalog.jsonb_build_object('canary','readonly_org_google_repair_snapshot_v1','ok',true,'rolled_back',true,'staff_identity_used',false,'business_mutation_performed',false) as org_google_repair_snapshot_canary_result;
