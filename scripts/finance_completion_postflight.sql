\set ON_ERROR_STOP on
-- Exact final source, grants, tables and posting/storage guards; no business writes.
do $postflight$
declare r record; oid_value oid;
begin
  if auth.uid() is not null then raise exception 'Release must not impersonate an employee';end if;
  for r in select * from (values
    ('private.finance_asset_actor_v1(text,text,text,boolean)','fd76cd40718661aa2af629ddaf0bed57',true,'s',array['search_path=""']::text[],false,false),
    ('private.finance_asset_book_guard_v1()','31e33e2138f60125d64fded7147dad55',true,'v',array['search_path=""']::text[],false,false),
    ('private.finance_asset_plan_source_v1(private.finance_asset_register_v1,text)','f3933fa7d800a034631a2abc91421d97',true,'s',array['search_path=""']::text[],false,false),
    ('private.finance_asset_schedule_v1(jsonb)','a7528f24ae130af4105bc73f76eafc88',false,'i',array['search_path=""']::text[],false,false),
    ('private.finance_asset_validate_v1(uuid,text,text,jsonb,uuid)','5e76ac60aad2a2299610a15bdf6926be',true,'s',array['search_path=""']::text[],false,false),
    ('private.finance_cloud_actor_v1(text)','dbf1972316ff2c8f4c987293189dade9',false,'s',array['search_path=""']::text[],false,false),
    ('private.finance_cloud_assert_items_v1(jsonb)','348e933f18e7f60155e5cdfc1f356d7b',false,'i',array['search_path=""']::text[],false,false),
    ('private.finance_cloud_check_files_v1(jsonb,finance_users,text,text)','2a5ac7efb2036edc9297c0eb1661733e',false,'v',array['search_path=""']::text[],false,false),
    ('private.finance_cloud_has_unstored_file_v1(jsonb)','5c103f0d597488fe247a4f5770e0bcad',false,'i',array['search_path=""']::text[],false,false),
    ('private.finance_cloud_preserve_attachment_v1()','5bf6b6c87084b471b4a7f582a2358342',true,'v',array['search_path=""']::text[],false,false),
    ('private.finance_cloud_route_v1(jsonb)','53302b77a365501d47dc7d8de8b1bb94',false,'i',array['search_path=""']::text[],false,false),
    ('private.finance_cloud_snapshot_v1(private.finance_cloud_drafts_v1,boolean)','5bdf1e2f591c9829a9ec5394e71c6001',false,'s',array['search_path=""']::text[],false,false),
    ('private.finance_cloud_submit_bill_v1(text,jsonb,text)','06ed9c98435a2357a587da036b16a990',true,'v',array['search_path=""']::text[],false,false),
    ('private.finance_cloud_submit_invoice_v1(text,jsonb,text)','57e63dfb909ca57a8ac237db5272d210',true,'v',array['search_path=""']::text[],false,false),
    ('private.finance_income_assert_items(jsonb)','bb704f4c6116f4128ca4508008820ee7',false,'i',array['search_path=""']::text[],false,false),
    ('private.finance_income_assert_items_with_limit(jsonb,integer)','de7ac0aa9ca0a5a203966e5e107c119b',false,'i',array['search_path=""']::text[],false,false),
    ('private.finance_income_request_digest(jsonb)','88a17c6a074a774f24359ac583532f24',false,'i',array['search_path=""']::text[],false,false),
    ('private.finance_income_resubmit_revision_rows_v2(text,uuid,text,text,text,jsonb)','a1fb48b62999bb526db2ea92483db467',false,'v',array['search_path=""']::text[],false,false),
    ('private.finance_income_validate_scope(uuid,text,text)','3d170fc9a7d46f4538a85fa6aee7584f',false,'s',array['search_path=""']::text[],false,false),
    ('private.finance_income_withdraw_applicant_v1(text,text[],text,text,jsonb,text)','1752c69ab68622c1b2702512f29afbfa',false,'v',array['lock_timeout=5s','search_path=""']::text[],false,false),
    ('private.finance_month_immutable_v1()','6155ee89f1d283b86637b76e5ea676c0',false,'v',array['search_path=""']::text[],false,false),
    ('private.finance_month_source_before_assets_v1(text,text,text)','5e5b6f5559988613a9df26f478982d10',true,'s',array['search_path=""']::text[],false,false),
    ('private.finance_month_source_v1(text,text,text)','44efe411a3d1dd369161bd2ec3693901',true,'s',array['search_path=""']::text[],false,false),
    ('private.finance_monthly_cash_evidence_v1(uuid,text,text,text)','79734d8fcee34dc018af8c5b03380296',true,'s',array['search_path=""']::text[],false,false),
    ('private.finance_monthly_file_refs_v1(jsonb,boolean)','e6e23dab42f40efdb8d483ce7a143a26',false,'i',array['search_path=""']::text[],false,false),
    ('private.finance_monthly_labor_requirements_v1(text,text,text)','1cd58fc1169d1f0d945e0ec142edc8fd',true,'s',array['search_path=""']::text[],false,false),
    ('private.finance_operations_actor_v1(boolean,boolean,boolean)','97129efd946c8ff71daf4fecbe62671b',true,'s',array['search_path=""']::text[],false,false),
    ('public.finance_asset_prepare_plan_v1(uuid,text,bigint,bigint,uuid,text)','a890b0a7893165da6a616d505cade6f2',true,'v',array['search_path=""']::text[],true,false),
    ('public.finance_asset_review_plan_v1(uuid,bigint,text,boolean)','f6025f7f2999f3e6f60e1c2e3036a32b',true,'v',array['search_path=""']::text[],true,false),
    ('public.finance_asset_save_v1(uuid,text,jsonb,bigint,uuid,text,text)','3bc046a0c4bb0baef0df1096bca01e50',true,'v',array['search_path=""']::text[],true,false),
    ('public.finance_asset_sources_v1(text,text,integer,integer,text)','1f9727834b47d59366ad5670dd9db54b',true,'s',array['search_path=""']::text[],true,false),
    ('public.finance_asset_workspace_v1(text,text,text)','25c16a97b82907e928b3b55ec8ec58b7',true,'s',array['search_path=""']::text[],true,false),
    ('public.finance_bill_act_active_step_v2(text[],text,text,text,jsonb,text,jsonb,text)','d120d590078c424f77afb0862c9ae491',true,'v',array['lock_timeout=5s','search_path=""','statement_timeout=50s']::text[],true,true),
    ('public.finance_bill_withdraw_applicant_v1(text[],text,text,jsonb,text)','90aaf7714388f688354cc39a446dce07',true,'v',array['lock_timeout=5s','search_path=""','statement_timeout=50s']::text[],true,true),
    ('public.finance_cloud_draft_discard_v1(uuid,bigint,text)','dbfefaf65e2c5974f75766989a4fba23',true,'v',array['search_path=""']::text[],true,false),
    ('public.finance_cloud_draft_list_v1(text,timestamp with time zone,uuid,integer)','b8493cc7d36dfc8606621c96b866f7be',true,'s',array['search_path=""']::text[],true,false),
    ('public.finance_cloud_draft_read_v1(uuid,text)','5ba08233daaf81f5f975cec1af5f8688',true,'s',array['search_path=""']::text[],true,false),
    ('public.finance_cloud_draft_reopen_v1(uuid,bigint,text)','8730119518b70a3206e8e89f27cd8ddc',true,'v',array['search_path=""']::text[],true,false),
    ('public.finance_cloud_draft_save_v1(uuid,bigint,text,jsonb,jsonb,text)','59e0185354e0d0b20ab1000c0f02aed2',true,'v',array['search_path=""']::text[],true,false),
    ('public.finance_cloud_submission_begin_v1(uuid,bigint,integer,text)','95af7a3ad5bbc2aa8af44a629a1f6cf5',true,'v',array['search_path=""']::text[],true,false),
    ('public.finance_cloud_submission_commit_v1(uuid,bigint,text,text)','6c895e0a95377a7c7478358ac309e10f',true,'v',array['lock_timeout=5s','search_path=""','statement_timeout=50s']::text[],true,false),
    ('public.finance_cloud_submission_stage_v1(uuid,bigint,integer,jsonb,text)','3d62717d12ad5770cd1b2ba00a62dd14',true,'v',array['search_path=""']::text[],true,false),
    ('public.finance_identity_delivery_retry_v1(uuid,bigint)','874a2a0bf90523f6befc135b7b9fe93e',true,'v',array['search_path=""']::text[],true,false),
    ('public.finance_identity_delivery_status_v1(integer,timestamp with time zone)','90250fabdd534cdee3b1b9828bb47f42',true,'s',array['search_path=""']::text[],true,false),
    ('public.finance_invoice_act_active_step_v2(text[],text,text,text,jsonb,text,jsonb,jsonb,text)','ae243ddc66db3953809f5602422fcdb3',true,'v',array['search_path=""','statement_timeout=50s']::text[],true,true),
    ('public.finance_invoice_receipt_action_v2(text[],text,text,jsonb,text,jsonb,text,jsonb,date)','58002d8974c8300a58507ef8359eda34',true,'v',array['lock_timeout=5s','search_path=""','statement_timeout=50s']::text[],true,false),
    ('public.finance_invoice_withdraw_applicant_v1(text[],text,text,jsonb,text)','34df8634df4f9210553440daa0cca084',true,'v',array['lock_timeout=5s','search_path=""','statement_timeout=50s']::text[],true,true),
    ('public.finance_month_snapshot_prepare_v1(text,text,bigint,text,uuid,text,text)','3b8729ef8b3e545343567b892f935cdf',true,'v',array['search_path=""']::text[],true,false),
    ('public.finance_month_snapshot_read_v1(uuid)','cacd8acb55fc0ded530dd093c72200b5',true,'s',array['search_path=""']::text[],true,false),
    ('public.finance_month_snapshot_review_v1(uuid,text,text)','0116249491f6fbae3fdb5423ffb8d726',true,'v',array['search_path=""']::text[],true,false),
    ('public.finance_month_workspace_v1(text,text,text)','5554cfa9fcfffd8c64b1e0a75f4abaab',true,'s',array['search_path=""']::text[],true,false),
    ('public.finance_monthly_delivery_receipt_v1(text,text,uuid,text,text,text)','3f5007fffb31972e8b2f56a21e15b64f',true,'v',array['search_path=""']::text[],true,false),
    ('public.finance_monthly_delivery_snapshot_v1(text,text,text)','0d77d1448d7d4b6c3fb8fcadd6ec2ec7',true,'s',array['search_path=""']::text[],true,false),
    ('public.finance_operation_alert_ack_v1(text,timestamp with time zone,text,text)','210d41376dd4c825d3f28ce0c6982bd4',true,'v',array['search_path=""']::text[],true,false),
    ('public.finance_operation_samples_save_v1(text,jsonb)','8f38286f83fbef6d8a5c500fb107ca7d',true,'v',array['search_path=""']::text[],true,false),
    ('public.finance_operations_read_v1(text)','a5d5c10794181b0fb22d92fb00656a65',true,'s',array['search_path=""']::text[],true,false),
    ('public.finance_period_close_health(text,text,text)','226b97191edd08ae9d927b017c956e56',false,'s',array['search_path=""']::text[],true,false),
    ('public.finance_resubmit_bill_applicant_revision_v2(text,jsonb,text)','1589969c730218f89814090b655c7b41',true,'v',array['lock_timeout=5s','search_path=""','statement_timeout=50s']::text[],true,true),
    ('public.finance_resubmit_invoice_applicant_revision_v2(text,jsonb,text)','1b659d6fe639b0d0ad86aa15662acca0',true,'v',array['search_path=""','statement_timeout=50s']::text[],true,true),
    ('public.finance_submit_bill_batch(text,jsonb,text)','cb5815484b3f90c0f4a73bf4461021d5',true,'v',array['search_path=""']::text[],true,true),
    ('public.finance_submit_invoice_batch(text,jsonb,text)','9a5ffcb22087913916545381e28a7158',true,'v',array['search_path=""']::text[],true,true)
  ) expected(signature,source_md5,security_definer,volatility,settings,authenticated_execute,service_execute) loop
    oid_value:=pg_catalog.to_regprocedure(r.signature)::oid;
    if oid_value is null or not exists(select 1 from pg_catalog.pg_proc p where p.oid=oid_value
      and pg_catalog.pg_get_userbyid(p.proowner)='postgres'
      and pg_catalog.md5(p.prosrc)=r.source_md5 and p.prosecdef=r.security_definer and p.provolatile::text=r.volatility
      and array(select x from pg_catalog.unnest(coalesce(p.proconfig,'{}'::text[])) x order by x)=r.settings)
      or pg_catalog.has_function_privilege('anon',oid_value,'EXECUTE')
      or pg_catalog.has_function_privilege('authenticated',oid_value,'EXECUTE') is distinct from r.authenticated_execute
      or pg_catalog.has_function_privilege('service_role',oid_value,'EXECUTE') is distinct from r.service_execute
      or exists(select 1 from pg_catalog.pg_proc p cross join lateral pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a where p.oid=oid_value and a.privilege_type='EXECUTE' and a.grantee not in(p.proowner,case when r.authenticated_execute then (select oid from pg_catalog.pg_roles where rolname='authenticated') else p.proowner end,case when r.service_execute then (select oid from pg_catalog.pg_roles where rolname='service_role') else p.proowner end)) then
      raise exception 'Completion function source/authority/config drift: %',r.signature using errcode='55000';
    end if;
  end loop;
  for r in select * from (values
    ('20261011133831','finance_completion_core_v1','0f0ad5de4052185230f58e969893b5d9308d494eeb7db8416fb4e66d46a0596c'),
    ('20261011133833','finance_cloud_submission_v1','e9a36e6f4225935a8a617df14d8841e34b49742ab89d89c20492fa2f9ec30c09'),
    ('20261011133834','finance_monthly_delivery_v1','c434ec4dadb36ae207360980f70e2d36503f1fae69774d3feef9ad0a979f5102'),
    ('20261011134336','finance_operations_observability_v1','532492eccea31f1ad4e260871fbd99ac6256b2a9fb39aafc6e6c120e6f7f84c5'),
    ('20261011135523','finance_asset_amortization_v1','70f2aa058837a32f0407f6cac1ba1a03a1431b726c8e9b6f6128f97c1bab4d24')
  ) ledger(version,name,statement_sha256) loop
    if not exists(select 1 from supabase_migrations.schema_migrations m where m.version=r.version and m.name=r.name and m.created_by='github-actions'
      and pg_catalog.cardinality(m.statements)=1
      and pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(m.statements[1],'UTF8')),'hex')=r.statement_sha256) then
      raise exception 'Completion migration ledger source/metadata drift: %',r.version using errcode='55000';
    end if;
  end loop;
  oid_value:=pg_catalog.to_regclass('private.finance_month_snapshots_v1')::oid;
  if oid_value is null or not exists(select 1 from pg_catalog.pg_class c where c.oid=oid_value and c.relkind='r' and c.relrowsecurity and c.relforcerowsecurity=false and pg_catalog.pg_get_userbyid(c.relowner)='postgres')
    or exists(select 1 from pg_catalog.pg_class c cross join lateral pg_catalog.aclexplode(coalesce(c.relacl,pg_catalog.acldefault('r',c.relowner))) a where c.oid=oid_value and a.grantee<>c.relowner)
    or pg_catalog.has_table_privilege('anon',oid_value,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') or pg_catalog.has_table_privilege('authenticated',oid_value,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') or pg_catalog.has_table_privilege('service_role',oid_value,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    or exists(select 1 from pg_catalog.pg_attribute a cross join lateral pg_catalog.aclexplode(a.attacl) acl where a.attrelid=oid_value and acl.grantee<>(select relowner from pg_catalog.pg_class where oid=oid_value))
    or exists(select 1 from pg_catalog.pg_policy p where p.polrelid=oid_value) then raise exception 'Completion private table authority drift: private.finance_month_snapshots_v1';end if;
  oid_value:=pg_catalog.to_regclass('private.finance_month_snapshot_reviews_v1')::oid;
  if oid_value is null or not exists(select 1 from pg_catalog.pg_class c where c.oid=oid_value and c.relkind='r' and c.relrowsecurity and c.relforcerowsecurity=false and pg_catalog.pg_get_userbyid(c.relowner)='postgres')
    or exists(select 1 from pg_catalog.pg_class c cross join lateral pg_catalog.aclexplode(coalesce(c.relacl,pg_catalog.acldefault('r',c.relowner))) a where c.oid=oid_value and a.grantee<>c.relowner)
    or pg_catalog.has_table_privilege('anon',oid_value,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') or pg_catalog.has_table_privilege('authenticated',oid_value,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') or pg_catalog.has_table_privilege('service_role',oid_value,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    or exists(select 1 from pg_catalog.pg_attribute a cross join lateral pg_catalog.aclexplode(a.attacl) acl where a.attrelid=oid_value and acl.grantee<>(select relowner from pg_catalog.pg_class where oid=oid_value))
    or exists(select 1 from pg_catalog.pg_policy p where p.polrelid=oid_value) then raise exception 'Completion private table authority drift: private.finance_month_snapshot_reviews_v1';end if;
  oid_value:=pg_catalog.to_regclass('private.finance_cloud_drafts_v1')::oid;
  if oid_value is null or not exists(select 1 from pg_catalog.pg_class c where c.oid=oid_value and c.relkind='r' and c.relrowsecurity and c.relforcerowsecurity=false and pg_catalog.pg_get_userbyid(c.relowner)='postgres')
    or exists(select 1 from pg_catalog.pg_class c cross join lateral pg_catalog.aclexplode(coalesce(c.relacl,pg_catalog.acldefault('r',c.relowner))) a where c.oid=oid_value and a.grantee<>c.relowner)
    or pg_catalog.has_table_privilege('anon',oid_value,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') or pg_catalog.has_table_privilege('authenticated',oid_value,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') or pg_catalog.has_table_privilege('service_role',oid_value,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    or exists(select 1 from pg_catalog.pg_attribute a cross join lateral pg_catalog.aclexplode(a.attacl) acl where a.attrelid=oid_value and acl.grantee<>(select relowner from pg_catalog.pg_class where oid=oid_value))
    or exists(select 1 from pg_catalog.pg_policy p where p.polrelid=oid_value) then raise exception 'Completion private table authority drift: private.finance_cloud_drafts_v1';end if;
  oid_value:=pg_catalog.to_regclass('private.finance_cloud_draft_items_v1')::oid;
  if oid_value is null or not exists(select 1 from pg_catalog.pg_class c where c.oid=oid_value and c.relkind='r' and c.relrowsecurity and c.relforcerowsecurity=false and pg_catalog.pg_get_userbyid(c.relowner)='postgres')
    or exists(select 1 from pg_catalog.pg_class c cross join lateral pg_catalog.aclexplode(coalesce(c.relacl,pg_catalog.acldefault('r',c.relowner))) a where c.oid=oid_value and a.grantee<>c.relowner)
    or pg_catalog.has_table_privilege('anon',oid_value,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') or pg_catalog.has_table_privilege('authenticated',oid_value,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') or pg_catalog.has_table_privilege('service_role',oid_value,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    or exists(select 1 from pg_catalog.pg_attribute a cross join lateral pg_catalog.aclexplode(a.attacl) acl where a.attrelid=oid_value and acl.grantee<>(select relowner from pg_catalog.pg_class where oid=oid_value))
    or exists(select 1 from pg_catalog.pg_policy p where p.polrelid=oid_value) then raise exception 'Completion private table authority drift: private.finance_cloud_draft_items_v1';end if;
  oid_value:=pg_catalog.to_regclass('private.finance_monthly_delivery_receipts_v1')::oid;
  if oid_value is null or not exists(select 1 from pg_catalog.pg_class c where c.oid=oid_value and c.relkind='r' and c.relrowsecurity and c.relforcerowsecurity=true and pg_catalog.pg_get_userbyid(c.relowner)='postgres')
    or exists(select 1 from pg_catalog.pg_class c cross join lateral pg_catalog.aclexplode(coalesce(c.relacl,pg_catalog.acldefault('r',c.relowner))) a where c.oid=oid_value and a.grantee<>c.relowner)
    or pg_catalog.has_table_privilege('anon',oid_value,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') or pg_catalog.has_table_privilege('authenticated',oid_value,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') or pg_catalog.has_table_privilege('service_role',oid_value,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    or exists(select 1 from pg_catalog.pg_attribute a cross join lateral pg_catalog.aclexplode(a.attacl) acl where a.attrelid=oid_value and acl.grantee<>(select relowner from pg_catalog.pg_class where oid=oid_value))
    or exists(select 1 from pg_catalog.pg_policy p where p.polrelid=oid_value) then raise exception 'Completion private table authority drift: private.finance_monthly_delivery_receipts_v1';end if;
  oid_value:=pg_catalog.to_regclass('private.finance_operation_samples_v1')::oid;
  if oid_value is null or not exists(select 1 from pg_catalog.pg_class c where c.oid=oid_value and c.relkind='r' and c.relrowsecurity and c.relforcerowsecurity=true and pg_catalog.pg_get_userbyid(c.relowner)='postgres')
    or exists(select 1 from pg_catalog.pg_class c cross join lateral pg_catalog.aclexplode(coalesce(c.relacl,pg_catalog.acldefault('r',c.relowner))) a where c.oid=oid_value and a.grantee<>c.relowner)
    or pg_catalog.has_table_privilege('anon',oid_value,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') or pg_catalog.has_table_privilege('authenticated',oid_value,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') or pg_catalog.has_table_privilege('service_role',oid_value,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    or exists(select 1 from pg_catalog.pg_attribute a cross join lateral pg_catalog.aclexplode(a.attacl) acl where a.attrelid=oid_value and acl.grantee<>(select relowner from pg_catalog.pg_class where oid=oid_value))
    or exists(select 1 from pg_catalog.pg_policy p where p.polrelid=oid_value) then raise exception 'Completion private table authority drift: private.finance_operation_samples_v1';end if;
  oid_value:=pg_catalog.to_regclass('private.finance_operation_alerts_v1')::oid;
  if oid_value is null or not exists(select 1 from pg_catalog.pg_class c where c.oid=oid_value and c.relkind='r' and c.relrowsecurity and c.relforcerowsecurity=true and pg_catalog.pg_get_userbyid(c.relowner)='postgres')
    or exists(select 1 from pg_catalog.pg_class c cross join lateral pg_catalog.aclexplode(coalesce(c.relacl,pg_catalog.acldefault('r',c.relowner))) a where c.oid=oid_value and a.grantee<>c.relowner)
    or pg_catalog.has_table_privilege('anon',oid_value,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') or pg_catalog.has_table_privilege('authenticated',oid_value,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') or pg_catalog.has_table_privilege('service_role',oid_value,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    or exists(select 1 from pg_catalog.pg_attribute a cross join lateral pg_catalog.aclexplode(a.attacl) acl where a.attrelid=oid_value and acl.grantee<>(select relowner from pg_catalog.pg_class where oid=oid_value))
    or exists(select 1 from pg_catalog.pg_policy p where p.polrelid=oid_value) then raise exception 'Completion private table authority drift: private.finance_operation_alerts_v1';end if;
  oid_value:=pg_catalog.to_regclass('private.finance_asset_register_v1')::oid;
  if oid_value is null or not exists(select 1 from pg_catalog.pg_class c where c.oid=oid_value and c.relkind='r' and c.relrowsecurity and c.relforcerowsecurity=false and pg_catalog.pg_get_userbyid(c.relowner)='postgres')
    or exists(select 1 from pg_catalog.pg_class c cross join lateral pg_catalog.aclexplode(coalesce(c.relacl,pg_catalog.acldefault('r',c.relowner))) a where c.oid=oid_value and a.grantee<>c.relowner)
    or pg_catalog.has_table_privilege('anon',oid_value,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') or pg_catalog.has_table_privilege('authenticated',oid_value,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') or pg_catalog.has_table_privilege('service_role',oid_value,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    or exists(select 1 from pg_catalog.pg_attribute a cross join lateral pg_catalog.aclexplode(a.attacl) acl where a.attrelid=oid_value and acl.grantee<>(select relowner from pg_catalog.pg_class where oid=oid_value))
    or exists(select 1 from pg_catalog.pg_policy p where p.polrelid=oid_value) then raise exception 'Completion private table authority drift: private.finance_asset_register_v1';end if;
  oid_value:=pg_catalog.to_regclass('private.finance_asset_plans_v1')::oid;
  if oid_value is null or not exists(select 1 from pg_catalog.pg_class c where c.oid=oid_value and c.relkind='r' and c.relrowsecurity and c.relforcerowsecurity=false and pg_catalog.pg_get_userbyid(c.relowner)='postgres')
    or exists(select 1 from pg_catalog.pg_class c cross join lateral pg_catalog.aclexplode(coalesce(c.relacl,pg_catalog.acldefault('r',c.relowner))) a where c.oid=oid_value and a.grantee<>c.relowner)
    or pg_catalog.has_table_privilege('anon',oid_value,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') or pg_catalog.has_table_privilege('authenticated',oid_value,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') or pg_catalog.has_table_privilege('service_role',oid_value,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    or exists(select 1 from pg_catalog.pg_attribute a cross join lateral pg_catalog.aclexplode(a.attacl) acl where a.attrelid=oid_value and acl.grantee<>(select relowner from pg_catalog.pg_class where oid=oid_value))
    or exists(select 1 from pg_catalog.pg_policy p where p.polrelid=oid_value) then raise exception 'Completion private table authority drift: private.finance_asset_plans_v1';end if;
  oid_value:=pg_catalog.to_regclass('private.finance_asset_events_v1')::oid;
  if oid_value is null or not exists(select 1 from pg_catalog.pg_class c where c.oid=oid_value and c.relkind='r' and c.relrowsecurity and c.relforcerowsecurity=false and pg_catalog.pg_get_userbyid(c.relowner)='postgres')
    or exists(select 1 from pg_catalog.pg_class c cross join lateral pg_catalog.aclexplode(coalesce(c.relacl,pg_catalog.acldefault('r',c.relowner))) a where c.oid=oid_value and a.grantee<>c.relowner)
    or pg_catalog.has_table_privilege('anon',oid_value,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') or pg_catalog.has_table_privilege('authenticated',oid_value,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') or pg_catalog.has_table_privilege('service_role',oid_value,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    or exists(select 1 from pg_catalog.pg_attribute a cross join lateral pg_catalog.aclexplode(a.attacl) acl where a.attrelid=oid_value and acl.grantee<>(select relowner from pg_catalog.pg_class where oid=oid_value))
    or exists(select 1 from pg_catalog.pg_policy p where p.polrelid=oid_value) then raise exception 'Completion private table authority drift: private.finance_asset_events_v1';end if;
  oid_value:=pg_catalog.to_regclass('private.finance_asset_operations_v1')::oid;
  if oid_value is null or not exists(select 1 from pg_catalog.pg_class c where c.oid=oid_value and c.relkind='r' and c.relrowsecurity and c.relforcerowsecurity=false and pg_catalog.pg_get_userbyid(c.relowner)='postgres')
    or exists(select 1 from pg_catalog.pg_class c cross join lateral pg_catalog.aclexplode(coalesce(c.relacl,pg_catalog.acldefault('r',c.relowner))) a where c.oid=oid_value and a.grantee<>c.relowner)
    or pg_catalog.has_table_privilege('anon',oid_value,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') or pg_catalog.has_table_privilege('authenticated',oid_value,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') or pg_catalog.has_table_privilege('service_role',oid_value,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    or exists(select 1 from pg_catalog.pg_attribute a cross join lateral pg_catalog.aclexplode(a.attacl) acl where a.attrelid=oid_value and acl.grantee<>(select relowner from pg_catalog.pg_class where oid=oid_value))
    or exists(select 1 from pg_catalog.pg_policy p where p.polrelid=oid_value) then raise exception 'Completion private table authority drift: private.finance_asset_operations_v1';end if;
  -- Pin columns, constraints and indexes as well as RLS/ACL boundaries.
  -- PG18 catalogs NOT NULL twice; attnotnull above is the cross-version authority.
  for r in select * from (values
    ('private.finance_asset_events_v1','8aa3c1524075e2bb0a0e2939b4b419dd'),
    ('private.finance_asset_operations_v1','25300b8c57f3c38e83adc798682de507'),
    ('private.finance_asset_plans_v1','f46c518547ddb894ed8f5d6541a6877e'),
    ('private.finance_asset_register_v1','38a5d4f1a7a3e1fcd473967fece738b4'),
    ('private.finance_cloud_draft_items_v1','0054a26dd1f13255bf3bcbc47b642ef6'),
    ('private.finance_cloud_drafts_v1','dba00450ff227eb9723912466b05edee'),
    ('private.finance_month_snapshot_reviews_v1','53fd9481c057016d4cedb0fa2ff7d7f5'),
    ('private.finance_month_snapshots_v1','f0cd02eb07a53893b76e95db9a5f47c6'),
    ('private.finance_monthly_delivery_receipts_v1','4a43b76d48f7c7499d4d93cd7273056c'),
    ('private.finance_operation_alerts_v1','79ff13e45a173ff338fd105b84c960c1'),
    ('private.finance_operation_samples_v1','7931f48455ea981c03feaa79a234ca9b')
  ) expected_table(relation,definition_md5) loop
    oid_value:=pg_catalog.to_regclass(r.relation)::oid;
    if oid_value is null or pg_catalog.md5(pg_catalog.jsonb_build_object(
      'columns',(select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(a.attnum,a.attname,pg_catalog.format_type(a.atttypid,a.atttypmod),a.attnotnull,a.attidentity,a.attgenerated,pg_catalog.pg_get_expr(d.adbin,d.adrelid)) order by a.attnum)
        from pg_catalog.pg_attribute a left join pg_catalog.pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=oid_value and a.attnum>0 and not a.attisdropped),
      'constraints',(select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(c.conname,c.contype,c.convalidated,c.condeferrable,c.condeferred,pg_catalog.pg_get_constraintdef(c.oid)) order by c.conname) from pg_catalog.pg_constraint c where c.conrelid=oid_value and c.contype<>'n'),
      'indexes',(select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(c.relname,i.indisunique,i.indisvalid,i.indisready,pg_catalog.pg_get_indexdef(i.indexrelid)) order by c.relname) from pg_catalog.pg_index i join pg_catalog.pg_class c on c.oid=i.indexrelid where i.indrelid=oid_value))::text) is distinct from r.definition_md5 then
      raise exception 'Completion private table definition drift: %',r.relation using errcode='55000';
    end if;
  end loop;
  if not exists(select 1 from pg_catalog.pg_trigger where tgname='finance_month_snapshot_immutable_v1' and tgrelid=pg_catalog.to_regclass('private.finance_month_snapshots_v1') and tgfoid=pg_catalog.to_regprocedure('private.finance_month_immutable_v1()') and tgenabled='O' and tgtype=27 and tgnargs=0 and pg_catalog.octet_length(tgargs)=0 and tgqual is null and tgattr::text='' and tgconstraint=0 and not tgdeferrable and not tginitdeferred) then raise exception 'Completion guard trigger drift: finance_month_snapshot_immutable_v1';end if;
  if not exists(select 1 from pg_catalog.pg_trigger where tgname='finance_month_review_immutable_v1' and tgrelid=pg_catalog.to_regclass('private.finance_month_snapshot_reviews_v1') and tgfoid=pg_catalog.to_regprocedure('private.finance_month_immutable_v1()') and tgenabled='O' and tgtype=27 and tgnargs=0 and pg_catalog.octet_length(tgargs)=0 and tgqual is null and tgattr::text='' and tgconstraint=0 and not tgdeferrable and not tginitdeferred) then raise exception 'Completion guard trigger drift: finance_month_review_immutable_v1';end if;
  if not exists(select 1 from pg_catalog.pg_trigger where tgname='finance_cloud_preserve_storage_v1' and tgrelid=pg_catalog.to_regclass('storage.objects') and tgfoid=pg_catalog.to_regprocedure('private.finance_cloud_preserve_attachment_v1()') and tgenabled='O' and tgtype=27 and tgnargs=0 and pg_catalog.octet_length(tgargs)=0 and tgqual is null and tgattr::text='' and tgconstraint=0 and not tgdeferrable and not tginitdeferred) then raise exception 'Completion guard trigger drift: finance_cloud_preserve_storage_v1';end if;
  if not exists(select 1 from pg_catalog.pg_trigger where tgname='finance_cloud_preserve_metadata_v1' and tgrelid=pg_catalog.to_regclass('public.file_attachments') and tgfoid=pg_catalog.to_regprocedure('private.finance_cloud_preserve_attachment_v1()') and tgenabled='O' and tgtype=27 and tgnargs=0 and pg_catalog.octet_length(tgargs)=0 and tgqual is null and tgattr::text='' and tgconstraint=0 and not tgdeferrable and not tginitdeferred) then raise exception 'Completion guard trigger drift: finance_cloud_preserve_metadata_v1';end if;
  if not exists(select 1 from pg_catalog.pg_trigger where tgname='finance_asset_events_immutable_v1' and tgrelid=pg_catalog.to_regclass('private.finance_asset_events_v1') and tgfoid=pg_catalog.to_regprocedure('private.finance_month_immutable_v1()') and tgenabled='O' and tgtype=27 and tgnargs=0 and pg_catalog.octet_length(tgargs)=0 and tgqual is null and tgattr::text='' and tgconstraint=0 and not tgdeferrable and not tginitdeferred) then raise exception 'Completion guard trigger drift: finance_asset_events_immutable_v1';end if;
  if not exists(select 1 from pg_catalog.pg_trigger where tgname='finance_asset_operations_immutable_v1' and tgrelid=pg_catalog.to_regclass('private.finance_asset_operations_v1') and tgfoid=pg_catalog.to_regprocedure('private.finance_month_immutable_v1()') and tgenabled='O' and tgtype=27 and tgnargs=0 and pg_catalog.octet_length(tgargs)=0 and tgqual is null and tgattr::text='' and tgconstraint=0 and not tgdeferrable and not tginitdeferred) then raise exception 'Completion guard trigger drift: finance_asset_operations_immutable_v1';end if;
  if not exists(select 1 from pg_catalog.pg_trigger where tgname='finance_asset_atomic_voucher_v1' and tgrelid=pg_catalog.to_regclass('public.vouchers') and tgfoid=pg_catalog.to_regprocedure('private.finance_asset_book_guard_v1()') and tgenabled='O' and tgtype=31 and tgnargs=0 and pg_catalog.octet_length(tgargs)=0 and tgqual is null and tgattr::text='' and tgconstraint=0 and not tgdeferrable and not tginitdeferred) then raise exception 'Completion guard trigger drift: finance_asset_atomic_voucher_v1';end if;
  if not exists(select 1 from pg_catalog.pg_trigger where tgname='finance_asset_atomic_ledger_v1' and tgrelid=pg_catalog.to_regclass('public.ledger_entries') and tgfoid=pg_catalog.to_regprocedure('private.finance_asset_book_guard_v1()') and tgenabled='O' and tgtype=31 and tgnargs=0 and pg_catalog.octet_length(tgargs)=0 and tgqual is null and tgattr::text='' and tgconstraint=0 and not tgdeferrable and not tginitdeferred) then raise exception 'Completion guard trigger drift: finance_asset_atomic_ledger_v1';end if;
end;
$postflight$;
select 'FINANCE_COMPLETION_POSTFLIGHT_OK' as marker;
