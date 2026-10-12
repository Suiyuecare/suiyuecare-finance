\set ON_ERROR_STOP on
-- Metadata-only release preflight. No employee/business rows are read.
do $preflight$
declare r record; oid_value oid;
begin
  if auth.uid() is not null then raise exception 'Release must not impersonate an employee';end if;
  if not exists(select 1 from supabase_migrations.schema_migrations where version='20261010130000' and name='finance_personal_invoice_batch_history_v1')
    or exists(select 1 from supabase_migrations.schema_migrations where version in ('20261011133831','20261011133833','20261011133834','20261011134336','20261011135523')) then raise exception 'Completion migration ledger drift' using errcode='55000';end if;
  for r in select * from (values
    ('private.finance_income_assert_items(jsonb)','bb704f4c6116f4128ca4508008820ee7',false,'i',array['search_path=""']::text[],false,false),
    ('private.finance_income_assert_items_with_limit(jsonb,integer)','de7ac0aa9ca0a5a203966e5e107c119b',false,'i',array['search_path=""']::text[],false,false),
    ('private.finance_income_request_digest(jsonb)','88a17c6a074a774f24359ac583532f24',false,'i',array['search_path=""']::text[],false,false),
    ('private.finance_income_resubmit_revision_rows_v2(text,uuid,text,text,text,jsonb)','02e82f514ebff4a7dc445cde3738a7db',false,'v',array['search_path=""']::text[],false,false),
    ('private.finance_income_validate_scope(uuid,text,text)','3d170fc9a7d46f4538a85fa6aee7584f',false,'s',array['search_path=""']::text[],false,false),
    ('private.finance_income_withdraw_applicant_v1(text,text[],text,text,jsonb,text)','a9d73b87ed5c098c5d29100f2ea686cd',false,'v',array['lock_timeout=5s','search_path=""']::text[],false,false),
    ('public.finance_bill_act_active_step_v2(text[],text,text,text,jsonb,text,jsonb,text)','b6f348ec65ffc8c951d963ab9fbafbe6',true,'v',array['lock_timeout=5s','search_path=""']::text[],true,true),
    ('public.finance_bill_withdraw_applicant_v1(text[],text,text,jsonb,text)','90aaf7714388f688354cc39a446dce07',true,'v',array['lock_timeout=5s','search_path=""']::text[],true,true),
    ('public.finance_invoice_act_active_step_v2(text[],text,text,text,jsonb,text,jsonb,jsonb,text)','ad103c477833a5a1d94e7fced1913831',true,'v',array['search_path=""']::text[],true,true),
    ('public.finance_invoice_receipt_action_v2(text[],text,text,jsonb,text,jsonb,text,jsonb,date)','e208945d06131b74e296f136d6e9abd3',true,'v',array['lock_timeout=5s','search_path=""']::text[],true,false),
    ('public.finance_invoice_withdraw_applicant_v1(text[],text,text,jsonb,text)','34df8634df4f9210553440daa0cca084',true,'v',array['lock_timeout=5s','search_path=""']::text[],true,true),
    ('public.finance_period_close_health(text,text,text)','0f629fa0888b2b4afbc2e8154e270b24',false,'s',array['search_path=public, pg_temp']::text[],true,true),
    ('public.finance_resubmit_bill_applicant_revision_v2(text,jsonb,text)','0d8be74cf915d5498866136ad22c6ea3',true,'v',array['lock_timeout=5s','search_path=""']::text[],true,true),
    ('public.finance_resubmit_invoice_applicant_revision_v2(text,jsonb,text)','a82bd87571b5d382eb49ea5d32f04f9f',true,'v',array['search_path=""']::text[],true,true),
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

  if pg_catalog.to_regclass('private.finance_month_snapshots_v1') is not null then raise exception 'Unexpected existing completion table: private.finance_month_snapshots_v1';end if;
  if pg_catalog.to_regclass('private.finance_month_snapshot_reviews_v1') is not null then raise exception 'Unexpected existing completion table: private.finance_month_snapshot_reviews_v1';end if;
  if pg_catalog.to_regclass('private.finance_cloud_drafts_v1') is not null then raise exception 'Unexpected existing completion table: private.finance_cloud_drafts_v1';end if;
  if pg_catalog.to_regclass('private.finance_cloud_draft_items_v1') is not null then raise exception 'Unexpected existing completion table: private.finance_cloud_draft_items_v1';end if;
  if pg_catalog.to_regclass('private.finance_monthly_delivery_receipts_v1') is not null then raise exception 'Unexpected existing completion table: private.finance_monthly_delivery_receipts_v1';end if;
  if pg_catalog.to_regclass('private.finance_operation_samples_v1') is not null then raise exception 'Unexpected existing completion table: private.finance_operation_samples_v1';end if;
  if pg_catalog.to_regclass('private.finance_operation_alerts_v1') is not null then raise exception 'Unexpected existing completion table: private.finance_operation_alerts_v1';end if;
  if pg_catalog.to_regclass('private.finance_asset_register_v1') is not null then raise exception 'Unexpected existing completion table: private.finance_asset_register_v1';end if;
  if pg_catalog.to_regclass('private.finance_asset_plans_v1') is not null then raise exception 'Unexpected existing completion table: private.finance_asset_plans_v1';end if;
  if pg_catalog.to_regclass('private.finance_asset_events_v1') is not null then raise exception 'Unexpected existing completion table: private.finance_asset_events_v1';end if;
  if pg_catalog.to_regclass('private.finance_asset_operations_v1') is not null then raise exception 'Unexpected existing completion table: private.finance_asset_operations_v1';end if;
  if pg_catalog.to_regprocedure('private.finance_asset_actor_v1(text,text,text,boolean)') is not null then raise exception 'Unexpected existing completion function: private.finance_asset_actor_v1(text,text,text,boolean)';end if;
  if pg_catalog.to_regprocedure('private.finance_asset_book_guard_v1()') is not null then raise exception 'Unexpected existing completion function: private.finance_asset_book_guard_v1()';end if;
  if pg_catalog.to_regprocedure('private.finance_asset_plan_source_v1(private.finance_asset_register_v1,text)') is not null then raise exception 'Unexpected existing completion function: private.finance_asset_plan_source_v1(private.finance_asset_register_v1,text)';end if;
  if pg_catalog.to_regprocedure('private.finance_asset_schedule_v1(jsonb)') is not null then raise exception 'Unexpected existing completion function: private.finance_asset_schedule_v1(jsonb)';end if;
  if pg_catalog.to_regprocedure('private.finance_asset_validate_v1(uuid,text,text,jsonb,uuid)') is not null then raise exception 'Unexpected existing completion function: private.finance_asset_validate_v1(uuid,text,text,jsonb,uuid)';end if;
  if pg_catalog.to_regprocedure('private.finance_cloud_actor_v1(text)') is not null then raise exception 'Unexpected existing completion function: private.finance_cloud_actor_v1(text)';end if;
  if pg_catalog.to_regprocedure('private.finance_cloud_assert_items_v1(jsonb)') is not null then raise exception 'Unexpected existing completion function: private.finance_cloud_assert_items_v1(jsonb)';end if;
  if pg_catalog.to_regprocedure('private.finance_cloud_check_files_v1(jsonb,public.finance_users,text,text)') is not null then raise exception 'Unexpected existing completion function: private.finance_cloud_check_files_v1(jsonb,public.finance_users,text,text)';end if;
  if pg_catalog.to_regprocedure('private.finance_cloud_has_unstored_file_v1(jsonb)') is not null then raise exception 'Unexpected existing completion function: private.finance_cloud_has_unstored_file_v1(jsonb)';end if;
  if pg_catalog.to_regprocedure('private.finance_cloud_preserve_attachment_v1()') is not null then raise exception 'Unexpected existing completion function: private.finance_cloud_preserve_attachment_v1()';end if;
  if pg_catalog.to_regprocedure('private.finance_cloud_route_v1(jsonb)') is not null then raise exception 'Unexpected existing completion function: private.finance_cloud_route_v1(jsonb)';end if;
  if pg_catalog.to_regprocedure('private.finance_cloud_snapshot_v1(private.finance_cloud_drafts_v1,boolean)') is not null then raise exception 'Unexpected existing completion function: private.finance_cloud_snapshot_v1(private.finance_cloud_drafts_v1,boolean)';end if;
  if pg_catalog.to_regprocedure('private.finance_cloud_submit_bill_v1(text,jsonb,text)') is not null then raise exception 'Unexpected existing completion function: private.finance_cloud_submit_bill_v1(text,jsonb,text)';end if;
  if pg_catalog.to_regprocedure('private.finance_cloud_submit_invoice_v1(text,jsonb,text)') is not null then raise exception 'Unexpected existing completion function: private.finance_cloud_submit_invoice_v1(text,jsonb,text)';end if;
  if pg_catalog.to_regprocedure('private.finance_month_immutable_v1()') is not null then raise exception 'Unexpected existing completion function: private.finance_month_immutable_v1()';end if;
  if pg_catalog.to_regprocedure('private.finance_month_source_before_assets_v1(text,text,text)') is not null then raise exception 'Unexpected existing completion function: private.finance_month_source_before_assets_v1(text,text,text)';end if;
  if pg_catalog.to_regprocedure('private.finance_month_source_v1(text,text,text)') is not null then raise exception 'Unexpected existing completion function: private.finance_month_source_v1(text,text,text)';end if;
  if pg_catalog.to_regprocedure('private.finance_monthly_cash_evidence_v1(uuid,text,text,text)') is not null then raise exception 'Unexpected existing completion function: private.finance_monthly_cash_evidence_v1(uuid,text,text,text)';end if;
  if pg_catalog.to_regprocedure('private.finance_monthly_file_refs_v1(jsonb,boolean)') is not null then raise exception 'Unexpected existing completion function: private.finance_monthly_file_refs_v1(jsonb,boolean)';end if;
  if pg_catalog.to_regprocedure('private.finance_monthly_labor_requirements_v1(text,text,text)') is not null then raise exception 'Unexpected existing completion function: private.finance_monthly_labor_requirements_v1(text,text,text)';end if;
  if pg_catalog.to_regprocedure('private.finance_operations_actor_v1(boolean,boolean,boolean)') is not null then raise exception 'Unexpected existing completion function: private.finance_operations_actor_v1(boolean,boolean,boolean)';end if;
  if pg_catalog.to_regprocedure('public.finance_asset_prepare_plan_v1(uuid,text,bigint,bigint,uuid,text)') is not null then raise exception 'Unexpected existing completion function: public.finance_asset_prepare_plan_v1(uuid,text,bigint,bigint,uuid,text)';end if;
  if pg_catalog.to_regprocedure('public.finance_asset_review_plan_v1(uuid,bigint,text,boolean)') is not null then raise exception 'Unexpected existing completion function: public.finance_asset_review_plan_v1(uuid,bigint,text,boolean)';end if;
  if pg_catalog.to_regprocedure('public.finance_asset_save_v1(uuid,text,jsonb,bigint,uuid,text,text)') is not null then raise exception 'Unexpected existing completion function: public.finance_asset_save_v1(uuid,text,jsonb,bigint,uuid,text,text)';end if;
  if pg_catalog.to_regprocedure('public.finance_asset_sources_v1(text,text,integer,integer,text)') is not null then raise exception 'Unexpected existing completion function: public.finance_asset_sources_v1(text,text,integer,integer,text)';end if;
  if pg_catalog.to_regprocedure('public.finance_asset_workspace_v1(text,text,text)') is not null then raise exception 'Unexpected existing completion function: public.finance_asset_workspace_v1(text,text,text)';end if;
  if pg_catalog.to_regprocedure('public.finance_cloud_draft_discard_v1(uuid,bigint,text)') is not null then raise exception 'Unexpected existing completion function: public.finance_cloud_draft_discard_v1(uuid,bigint,text)';end if;
  if pg_catalog.to_regprocedure('public.finance_cloud_draft_list_v1(text,timestamptz,uuid,integer)') is not null then raise exception 'Unexpected existing completion function: public.finance_cloud_draft_list_v1(text,timestamptz,uuid,integer)';end if;
  if pg_catalog.to_regprocedure('public.finance_cloud_draft_read_v1(uuid,text)') is not null then raise exception 'Unexpected existing completion function: public.finance_cloud_draft_read_v1(uuid,text)';end if;
  if pg_catalog.to_regprocedure('public.finance_cloud_draft_reopen_v1(uuid,bigint,text)') is not null then raise exception 'Unexpected existing completion function: public.finance_cloud_draft_reopen_v1(uuid,bigint,text)';end if;
  if pg_catalog.to_regprocedure('public.finance_cloud_draft_save_v1(uuid,bigint,text,jsonb,jsonb,text)') is not null then raise exception 'Unexpected existing completion function: public.finance_cloud_draft_save_v1(uuid,bigint,text,jsonb,jsonb,text)';end if;
  if pg_catalog.to_regprocedure('public.finance_cloud_submission_begin_v1(uuid,bigint,integer,text)') is not null then raise exception 'Unexpected existing completion function: public.finance_cloud_submission_begin_v1(uuid,bigint,integer,text)';end if;
  if pg_catalog.to_regprocedure('public.finance_cloud_submission_commit_v1(uuid,bigint,text,text)') is not null then raise exception 'Unexpected existing completion function: public.finance_cloud_submission_commit_v1(uuid,bigint,text,text)';end if;
  if pg_catalog.to_regprocedure('public.finance_cloud_submission_stage_v1(uuid,bigint,integer,jsonb,text)') is not null then raise exception 'Unexpected existing completion function: public.finance_cloud_submission_stage_v1(uuid,bigint,integer,jsonb,text)';end if;
  if pg_catalog.to_regprocedure('public.finance_identity_delivery_retry_v1(uuid,bigint)') is not null then raise exception 'Unexpected existing completion function: public.finance_identity_delivery_retry_v1(uuid,bigint)';end if;
  if pg_catalog.to_regprocedure('public.finance_identity_delivery_status_v1(integer,timestamptz)') is not null then raise exception 'Unexpected existing completion function: public.finance_identity_delivery_status_v1(integer,timestamptz)';end if;
  if pg_catalog.to_regprocedure('public.finance_month_snapshot_prepare_v1(text,text,bigint,text,uuid,text,text)') is not null then raise exception 'Unexpected existing completion function: public.finance_month_snapshot_prepare_v1(text,text,bigint,text,uuid,text,text)';end if;
  if pg_catalog.to_regprocedure('public.finance_month_snapshot_read_v1(uuid)') is not null then raise exception 'Unexpected existing completion function: public.finance_month_snapshot_read_v1(uuid)';end if;
  if pg_catalog.to_regprocedure('public.finance_month_snapshot_review_v1(uuid,text,text)') is not null then raise exception 'Unexpected existing completion function: public.finance_month_snapshot_review_v1(uuid,text,text)';end if;
  if pg_catalog.to_regprocedure('public.finance_month_workspace_v1(text,text,text)') is not null then raise exception 'Unexpected existing completion function: public.finance_month_workspace_v1(text,text,text)';end if;
  if pg_catalog.to_regprocedure('public.finance_monthly_delivery_receipt_v1(text,text,uuid,text,text,text)') is not null then raise exception 'Unexpected existing completion function: public.finance_monthly_delivery_receipt_v1(text,text,uuid,text,text,text)';end if;
  if pg_catalog.to_regprocedure('public.finance_monthly_delivery_snapshot_v1(text,text,text)') is not null then raise exception 'Unexpected existing completion function: public.finance_monthly_delivery_snapshot_v1(text,text,text)';end if;
  if pg_catalog.to_regprocedure('public.finance_operation_alert_ack_v1(text,timestamptz,text,text)') is not null then raise exception 'Unexpected existing completion function: public.finance_operation_alert_ack_v1(text,timestamptz,text,text)';end if;
  if pg_catalog.to_regprocedure('public.finance_operation_samples_save_v1(text,jsonb)') is not null then raise exception 'Unexpected existing completion function: public.finance_operation_samples_save_v1(text,jsonb)';end if;
  if pg_catalog.to_regprocedure('public.finance_operations_read_v1(text)') is not null then raise exception 'Unexpected existing completion function: public.finance_operations_read_v1(text)';end if;
end;
$preflight$;
select 'FINANCE_COMPLETION_PREFLIGHT_OK' as marker;
