-- Authenticated, rollback-only reporting-profile canary. Only report preparation
-- data in the test environment is changed; operational sources/ledger are never written.
begin isolation level repeatable read;
set local lock_timeout='5s';
set local statement_timeout='120s';

-- FINANCE_AUTHENTICATED_CANARY_CORE_BEGIN
do $reporting_profiles_canary$
declare
 v_tenant constant uuid:='00000000-0000-0000-0000-000000000001';
 v_reason constant text:='__finance_reporting_profiles_canary_20260910__';
 v_period constant text:='2099-11-01/2099-12-31';
 v_manager public.finance_users%rowtype;v_accountant public.finance_users%rowtype;
 v_entity text;v_before jsonb;v_result jsonb;v_patch jsonb;v_revision bigint;v_denied boolean;
 v_old_claims text:=current_setting('request.jwt.claims',true);v_old_sub text:=current_setting('request.jwt.claim.sub',true);v_old_tenant text:=current_setting('app.current_tenant_id',true);
begin
 if exists(select 1 from private.finance_reporting_profile_revisions_v1 where reason=v_reason)
  or exists(select 1 from public.finance_reporting_profiles where profile#>>array['tax','periods',v_period,'priorCarryforwardTax']='123456.78') then raise exception 'Reporting canary marker already exists; refusing to overwrite';end if;
 select u.* into v_manager from public.finance_users u where u.tenant_id=v_tenant and u.active and u.role in ('ceo','admin_director')
  and public.finance_user_is_approval_identity_ready(v_tenant,u.id)
  and private.finance_reporting_page_level_v1(v_tenant,u.role,'reports')<>'none'
  and private.finance_reporting_page_level_v1(v_tenant,u.role,'settings') in ('edit','delete') order by u.id limit 1;
 select u.* into v_accountant from public.finance_users u where u.tenant_id=v_tenant and u.active and u.role='accountant'
  and public.finance_user_is_approval_identity_ready(v_tenant,u.id)
  and private.finance_reporting_page_level_v1(v_tenant,u.role,'reports') in ('edit','delete') order by u.id limit 1;
 if v_manager.id is null or v_accountant.id is null then raise exception 'Reporting canary lacks verified authorized manager/accountant';end if;
 select e->>'id' into v_entity from public.system_settings s cross join lateral jsonb_array_elements(case when jsonb_typeof(s.value)='array' then s.value else '[]'::jsonb end) e
 where s.tenant_id=v_tenant and s.key='entities' and nullif(e->>'id','') is not null and e->>'id'<>'all' order by e->>'id' limit 1;
 if v_entity is null then raise exception 'Reporting canary has no current company';end if;
 perform set_config('app.current_tenant_id',v_tenant::text,true);
 perform set_config('request.jwt.claim.sub',v_manager.auth_user_id::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',v_manager.auth_user_id,'role','authenticated','email',v_manager.email)::text,true);
 execute 'set local role authenticated';
 if current_user<>'authenticated' or public.current_finance_user_id() is distinct from v_manager.id then raise exception 'Reporting manager browser identity did not resolve exactly';end if;
 v_before:=public.finance_reporting_profile_read_v1(v_entity,'test');v_revision:=(v_before->>'revision')::bigint;
 if v_before->>'canEdit'<>'true' then raise exception 'Reporting manager settings capability is unavailable';end if;
 if coalesce(v_before#>array['profile','tax','periods'],'{}'::jsonb) ? v_period then raise exception 'Reporting canary period already configured';end if;
 v_patch:=jsonb_set(v_before->'profile',array['tax','periods'],coalesce(v_before#>array['profile','tax','periods'],'{}'::jsonb)||jsonb_build_object(v_period,jsonb_build_object('priorCarryforwardTax',123456.78)));
 v_result:=public.finance_reporting_profile_save_v1(v_entity,v_revision,v_patch,v_reason,'test');
 if (v_result->>'revision')::bigint<>v_revision+1 or v_result->'profile' is distinct from v_patch then raise exception 'Reporting manager profile was not persisted exactly';end if;
 v_denied:=false;begin perform public.finance_reporting_profile_save_v1(v_entity,v_revision,v_patch,v_reason,'test');exception when serialization_failure then v_denied:=true;end;
 if not v_denied then raise exception 'Reporting stale revision was accepted';end if;
 execute 'reset role';
 perform set_config('request.jwt.claim.sub',v_accountant.auth_user_id::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',v_accountant.auth_user_id,'role','authenticated','email',v_accountant.email)::text,true);
 execute 'set local role authenticated';
 if current_user<>'authenticated' or public.current_finance_user_id() is distinct from v_accountant.id then raise exception 'Reporting accountant browser identity did not resolve exactly';end if;
 v_result:=public.finance_reporting_profile_read_v1(v_entity,'test');
 if v_result->>'canEdit'<>'false' or v_result->>'canEditWorkpaper'<>'true' then raise exception 'Reporting accountant capability separation failed';end if;
 v_denied:=false;begin perform public.finance_reporting_profile_save_v1(v_entity,v_revision+1,jsonb_set(v_patch,array['tax','formType'],to_jsonb(case when v_patch#>>'{tax,formType}'='401' then '403' else '401' end)),v_reason,'test');exception when insufficient_privilege then v_denied:=true;end;
 if not v_denied then raise exception 'Reporting accountant changed company settings';end if;
 v_denied:=false;begin perform public.finance_reporting_profile_save_v1(v_entity,v_revision+1,jsonb_set(v_patch,array['documents'],(v_patch->'documents')||jsonb_build_object('__canary_missing_source__',jsonb_build_object('sourceType','invoice','sourceId','__canary_missing_source__','classificationReason',v_reason))),v_reason,'test');exception when insufficient_privilege then v_denied:=true;end;
 if not v_denied then raise exception 'Reporting nonexistent/foreign document source was accepted';end if;
 v_patch:=jsonb_set(v_patch,array['tax','periods',v_period,'refundLimitConfirmedTax'],'0'::jsonb);
 v_result:=public.finance_reporting_profile_save_v1(v_entity,v_revision+1,v_patch,v_reason,'test');
 if (v_result->>'revision')::bigint<>v_revision+2 or v_result->'profile' is distinct from v_patch then raise exception 'Reporting accountant allowed workpaper save differs';end if;
 v_denied:=false;begin execute 'select 1 from public.finance_reporting_profiles limit 1';exception when insufficient_privilege then v_denied:=true;end;
 if not v_denied then raise exception 'Reporting profile table is directly exposed';end if;
 execute 'reset role';
 if (select count(*) from private.finance_reporting_profile_revisions_v1 where tenant_id=v_tenant and data_environment='test' and entity_id=v_entity and reason=v_reason)<>2
  or not exists(select 1 from public.finance_reporting_profiles where tenant_id=v_tenant and data_environment='test' and entity_id=v_entity and revision=v_revision+2 and profile=v_patch and updated_by=v_accountant.id) then raise exception 'Reporting profile/audit atomic consistency failed';end if;
 perform set_config('request.jwt.claims',coalesce(v_old_claims,''),true);perform set_config('request.jwt.claim.sub',coalesce(v_old_sub,''),true);perform set_config('app.current_tenant_id',coalesce(v_old_tenant,''),true);
end;
$reporting_profiles_canary$;
-- FINANCE_AUTHENTICATED_CANARY_CORE_END

rollback;

-- FINANCE_AUTHENTICATED_CANARY_ROLLBACK_CHECK_BEGIN
do $reporting_profiles_rollback$
begin
 if exists(select 1 from private.finance_reporting_profile_revisions_v1 where reason='__finance_reporting_profiles_canary_20260910__')
  or exists(select 1 from public.finance_reporting_profiles where profile#>>array['tax','periods','2099-11-01/2099-12-31','priorCarryforwardTax']='123456.78') then raise exception 'Reporting canary rollback left profile or audit data behind';end if;
end;
$reporting_profiles_rollback$;
-- FINANCE_AUTHENTICATED_CANARY_ROLLBACK_CHECK_END

select jsonb_build_object('canary','authenticated_reporting_profiles_v1','ok',true,'rolled_back',true,'profile_authority_preserved',true) as reporting_profiles_canary_result;
