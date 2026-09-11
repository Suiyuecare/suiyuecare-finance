-- Synthetic test-only source/profile changes; always rolled back. No posting,
-- payment or delivery RPC is invoked. Run with the sealed batch fingerprint.
begin isolation level repeatable read;
set local lock_timeout='5s';
set local statement_timeout='120s';
-- FINANCE_AUTHENTICATED_CANARY_CORE_BEGIN
do $tax_source_integrity_canary$
declare
 t constant uuid:='00000000-0000-0000-0000-000000000001';
 marker constant text:='__finance_tax_source_integrity_canary_20260911__';
 actor public.finance_users%rowtype;entity text;dept text;selector jsonb;result jsonb;before jsonb;patch jsonb;binding jsonb;fresh_binding jsonb;rev bigint;denied boolean;fixture_before jsonb;
 old_claims text:=current_setting('request.jwt.claims',true);old_sub text:=current_setting('request.jwt.claim.sub',true);old_tenant text:=current_setting('app.current_tenant_id',true);
begin
 if exists(select 1 from public.invoices where id=marker) or exists(select 1 from private.finance_reporting_profile_revisions_v1 where reason=marker) then raise exception 'Tax source canary already exists';end if;
 select u.* into actor from public.finance_users u where u.tenant_id=t and u.active and u.role='accountant'
  and public.finance_user_is_approval_identity_ready(t,u.id) and private.finance_reporting_page_level_v1(t,u.role,'reports') in ('edit','delete') order by u.id limit 1;
 select s.entity_code,d.code into entity,dept from public.finance_department_units d join public.finance_department_entity_scopes s on s.tenant_id=d.tenant_id and s.unit_id=d.id and s.active
  where d.tenant_id=t and d.active and d.is_posting_unit and d.present_in_source is true
   and private.finance_department_allows_new_form(d.tenant_id,d.code,s.entity_code) order by s.entity_code,d.code limit 1;
 if actor.id is null or entity is null then raise exception 'Tax source canary lacks verified accountant/company department';end if;
 perform set_config('app.current_tenant_id',t::text,true);perform set_config('request.jwt.claim.sub',actor.auth_user_id::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',actor.auth_user_id,'role','authenticated','email',actor.email)::text,true);
 insert into public.invoices(id,no,tenant_id,data_environment,entity_id,entity_name,department_code,invoice_date,buyer,description,amount,tax,total,status,approval_status,approval_step,steps,invoice_identifier_type)
 values(marker,marker,t,'test',entity,'Rollback-only fixture',dept,date '2099-09-11','Tax source canary','Tax source canary',105,0,105,'unpaid','draft',1,'[]','領據');
 selector:=jsonb_build_array(jsonb_build_object('key','invoice:'||marker,'sourceType','invoice','sourceId',marker));
 select to_jsonb(i) into fixture_before from public.invoices i where id=marker;
 execute 'set local role authenticated';
 if current_user<>'authenticated' or public.current_finance_user_id() is distinct from actor.id then raise exception 'Tax source canary browser identity failed';end if;
 before:=public.finance_reporting_profile_read_v1(entity,'test');rev:=(before->>'revision')::bigint;patch:=before->'profile';
 result:=public.finance_reporting_tax_sources_v1(entity,selector,'test');binding:=result#>array['sources','invoice:'||marker,'binding'];
 if result#>>array['sources','invoice:'||marker,'available'] is distinct from 'true' or binding->>'fingerprint'!~'^[a-f0-9]{64}$' then raise exception 'Tax source binding unavailable';end if;
 patch:=jsonb_set(patch,'{documents}',(patch->'documents')||jsonb_build_object('invoice:'||marker,jsonb_build_object('sourceType','invoice','sourceId',marker,'number',marker,'date','2099-09-11','formatCode','36','taxClass','out_of_scope','originalNetAmount',105,'originalTaxAmount',0,'grossAmount',105,'classificationReason',marker,'evidenceReference',marker,'sourceBinding',binding)));
 result:=public.finance_reporting_profile_save_v1(entity,rev,patch,marker,'test');
 if result->'profile' is distinct from patch or (result->>'revision')::bigint<>rev+1 then raise exception 'Tax source bound classification save differs';end if;
 execute 'reset role';
 if (select to_jsonb(i) from public.invoices i where id=marker) is distinct from fixture_before then raise exception 'Tax classification save modified its source';end if;
 -- Simulate another editor replacing this synthetic certificate after review.
 update public.invoices set description='Replaced tax canary certificate',amount=210,total=210 where id=marker;
 execute 'set local role authenticated';
 patch:=jsonb_set(patch,array['documents','invoice:'||marker,'classificationReason'],to_jsonb(marker||' stale attempt'));
 denied:=false;begin perform public.finance_reporting_profile_save_v1(entity,rev+1,patch,marker,'test');exception when serialization_failure then denied:=true;end;
 if not denied or (public.finance_reporting_profile_read_v1(entity,'test')->>'revision')::bigint<>rev+1 then raise exception 'Stale source save was accepted or changed the profile revision';end if;
 result:=public.finance_reporting_tax_sources_v1(entity,selector,'test');fresh_binding:=result#>array['sources','invoice:'||marker,'binding'];
 if fresh_binding=binding then raise exception 'Replaced source retained its binding';end if;
 patch:=jsonb_set(patch,array['documents','invoice:'||marker,'sourceBinding'],fresh_binding);
 patch:=jsonb_set(patch,array['documents','invoice:'||marker,'originalNetAmount'],'210');patch:=jsonb_set(patch,array['documents','invoice:'||marker,'grossAmount'],'210');
 result:=public.finance_reporting_profile_save_v1(entity,rev+1,patch,marker,'test');
 if (result->>'revision')::bigint<>rev+2 then raise exception 'Fresh reviewed source was not saved';end if;
 denied:=false;begin result:=public.finance_reporting_tax_sources_v1(entity,selector,'production');if result#>>array['sources','invoice:'||marker,'available']='false' then denied:=true;end if;
 exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Tax source crossed data environments';end if;
 execute 'reset role';
 if (select count(*) from private.finance_reporting_profile_revisions_v1 where tenant_id=t and data_environment='test' and entity_id=entity and reason=marker)<>2 then raise exception 'Tax source canary audit history mismatch';end if;
 if exists(select 1 from public.ledger_entries where source_id=marker) or exists(select 1 from public.notification_delivery_events where request_id=marker or payload->>'source_id'=marker) then raise exception 'Tax source canary unexpectedly posted or delivered';end if;
 perform set_config('request.jwt.claim.sub','',true);perform set_config('request.jwt.claims','{}',true);execute 'set local role authenticated';
 denied:=false;begin perform public.finance_reporting_tax_sources_v1(entity,selector,'test');exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Tax source accepted absent browser identity';end if;execute 'reset role';
 perform set_config('request.jwt.claims',coalesce(old_claims,''),true);perform set_config('request.jwt.claim.sub',coalesce(old_sub,''),true);perform set_config('app.current_tenant_id',coalesce(old_tenant,''),true);
end;
$tax_source_integrity_canary$;
-- FINANCE_AUTHENTICATED_CANARY_CORE_END
rollback;
-- FINANCE_AUTHENTICATED_CANARY_ROLLBACK_CHECK_BEGIN
do $tax_source_integrity_rollback$
begin
 if exists(select 1 from public.invoices where id='__finance_tax_source_integrity_canary_20260911__')
  or exists(select 1 from private.finance_reporting_profile_revisions_v1 where reason='__finance_tax_source_integrity_canary_20260911__')
  or exists(select 1 from public.finance_reporting_profiles where profile->'documents' ? 'invoice:__finance_tax_source_integrity_canary_20260911__') then raise exception 'Tax source canary rollback left data';end if;
end;
$tax_source_integrity_rollback$;
-- FINANCE_AUTHENTICATED_CANARY_ROLLBACK_CHECK_END
select jsonb_build_object('canary','authenticated_tax_source_integrity_v1','ok',true,'rolled_back',true,'source_binding_preserved',true) as tax_source_integrity_canary_result;
