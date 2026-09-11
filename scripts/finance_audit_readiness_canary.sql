-- Synthetic internal preparation only; no source business record is changed.
begin isolation level repeatable read;
set local lock_timeout='5s';
set local statement_timeout='120s';
-- FINANCE_AUTHENTICATED_CANARY_CORE_BEGIN
do $audit_readiness_canary$
<<audit_readiness_canary>>
declare
 t uuid:=public.default_tenant_id();e text;period constant text:='2099-Q4';reason constant text:='__finance_audit_readiness_canary_20260911__';
 preparer public.finance_users%rowtype;reviewer public.finance_users%rowtype;reader public.finance_users%rowtype;
 before jsonb;r jsonb;p jsonb;hist jsonb;denied boolean;production_before jsonb;
 old_claims text:=current_setting('request.jwt.claims',true);old_sub text:=current_setting('request.jwt.claim.sub',true);old_tenant text:=current_setting('app.current_tenant_id',true);
begin
 select * into preparer from public.finance_users u where u.tenant_id=t and u.active and u.role='accountant' and public.finance_user_is_approval_identity_ready(t,u.id)
  and private.finance_reporting_page_level_v1(t,u.role,'reports') in ('edit','delete') order by u.id limit 1;
 select * into reviewer from public.finance_users u where u.tenant_id=t and u.active and u.role in ('ceo','admin_director') and public.finance_user_is_approval_identity_ready(t,u.id)
  and private.finance_reporting_page_level_v1(t,u.role,'reports')<>'none' and private.finance_reporting_page_level_v1(t,u.role,'settings') in ('edit','delete') order by u.id limit 1;
 select * into reader from public.finance_users u where u.tenant_id=t and u.active and u.role not in ('accountant','ceo','admin_director','external_audit','board') and public.finance_user_is_approval_identity_ready(t,u.id) order by u.id limit 1;
 if preparer.id is null or reviewer.id is null or reader.id is null or preparer.id=reviewer.id then raise exception 'Audit canary requires verified preparer, independent reviewer and ordinary reader';end if;
 select v->>'id' into e from public.system_settings s cross join lateral jsonb_array_elements(case when jsonb_typeof(s.value)='array' then s.value else '[]'::jsonb end) v where s.tenant_id=t and s.key='entities' and nullif(v->>'id','') is not null and v->>'id'<>'all' order by v->>'id' limit 1;
 if e is null or exists(select 1 from private.finance_audit_cases_v1 where tenant_id=t and data_environment='test' and entity_id=e and finance_audit_cases_v1.period=audit_readiness_canary.period)
  or exists(select 1 from private.finance_audit_case_revisions_v1 where finance_audit_case_revisions_v1.reason=audit_readiness_canary.reason) then raise exception 'Audit canary scope missing or synthetic key already exists';end if;
 perform set_config('app.current_tenant_id',t::text,true);perform set_config('request.jwt.claim.sub',preparer.auth_user_id::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',preparer.auth_user_id,'role','authenticated','email',preparer.email)::text,true);
 execute 'set local role authenticated';
 if current_user<>'authenticated' or public.current_finance_user_id() is distinct from preparer.id then raise exception 'Audit preparer browser identity mismatch';end if;
 before:=public.finance_audit_case_read_v1(e,period,'test');production_before:=public.finance_audit_case_read_v1(e,period,'production');
 if before->>'canEdit' is distinct from 'true' or (before->>'revision')::bigint<>0 then raise exception 'Audit canary preparer authority unavailable';end if;
 p:=jsonb_set(before->'caseData','{items,A01}',(before#>'{caseData,items,A01}')||jsonb_build_object('status','provided','applicability','applicable','evidenceReference',reason,'ownerId',preparer.id,'preparedBy','forged','reviewedBy','forged'));
 r:=public.finance_audit_case_save_v1(e,period,0,before->>'sourceFingerprint',p,reason,'test');
 if (r->>'revision')::bigint<>1 or r#>>'{caseData,items,A01,preparedBy}'<>preparer.id or r#>'{caseData,items,A01,reviewedBy}'<>'null'::jsonb then raise exception 'Audit preparation actor/history authority differs';end if;
 denied:=false;begin perform public.finance_audit_case_save_v1(e,period,0,before->>'sourceFingerprint',p,reason,'test');exception when serialization_failure then denied:=true;end;
 if not denied then raise exception 'Audit stale case revision accepted';end if;
 denied:=false;begin perform public.finance_audit_case_save_v1(e,period,1,repeat('0',64),p,reason,'test');exception when serialization_failure then denied:=true;end;
 if not denied then raise exception 'Audit stale source fingerprint accepted';end if;
 p:=jsonb_set(r->'caseData','{items,A01,status}','"reviewed"');
 denied:=false;begin perform public.finance_audit_case_save_v1(e,period,1,r->>'sourceFingerprint',p,reason,'test');exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Audit self-review accepted';end if;
 denied:=false;begin perform public.finance_audit_case_read_v1('__audit_unscoped_company__',period,'test');exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Audit unknown-company disclosure accepted';end if;
 execute 'reset role';
 perform set_config('request.jwt.claim.sub',reviewer.auth_user_id::text,true);perform set_config('request.jwt.claims',jsonb_build_object('sub',reviewer.auth_user_id,'role','authenticated','email',reviewer.email)::text,true);
 execute 'set local role authenticated';
 if public.current_finance_user_id() is distinct from reviewer.id then raise exception 'Audit reviewer browser identity mismatch';end if;
 r:=public.finance_audit_case_save_v1(e,period,1,r->>'sourceFingerprint',p,reason,'test');
 if (r->>'revision')::bigint<>2 or r#>>'{caseData,items,A01,reviewedBy}'<>reviewer.id or r#>>'{caseData,items,A01,reviewedFingerprint}'<>r->>'sourceFingerprint' then raise exception 'Audit independent review metadata missing';end if;
 hist:=public.finance_audit_case_history_v1(e,period,'test');
 if jsonb_array_length(hist->'rows')<>2 or hist#>>'{rows,0,actorId}'<>reviewer.id or hist#>>'{rows,1,actorId}'<>preparer.id then raise exception 'Audit immutable two-actor history differs';end if;
 denied:=false;begin execute 'select 1 from private.finance_audit_cases_v1';exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Audit table directly exposed';end if;
 execute 'reset role';
 perform set_config('request.jwt.claim.sub',reader.auth_user_id::text,true);perform set_config('request.jwt.claims',jsonb_build_object('sub',reader.auth_user_id,'role','authenticated','email',reader.email)::text,true);
 execute 'set local role authenticated';denied:=false;
 begin perform public.finance_audit_case_read_v1(e,period,'test');exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Audit employee disclosed company workpapers';end if;
 execute 'reset role';
 perform set_config('request.jwt.claim.sub',preparer.auth_user_id::text,true);perform set_config('request.jwt.claims',jsonb_build_object('sub',preparer.auth_user_id,'role','authenticated','email',preparer.email)::text,true);
 execute 'set local role authenticated';
 if public.finance_audit_case_read_v1(e,period,'production') is distinct from production_before then raise exception 'Audit test fixture modified production case/source response';end if;
 execute 'reset role';
 if (select count(*) from private.finance_audit_case_revisions_v1 where finance_audit_case_revisions_v1.reason=audit_readiness_canary.reason)<>2 then raise exception 'Audit case/revision transaction mismatch';end if;
 perform set_config('request.jwt.claims',coalesce(old_claims,''),true);perform set_config('request.jwt.claim.sub',coalesce(old_sub,''),true);perform set_config('app.current_tenant_id',coalesce(old_tenant,''),true);
end;
$audit_readiness_canary$;
-- FINANCE_AUTHENTICATED_CANARY_CORE_END
rollback;
-- FINANCE_AUTHENTICATED_CANARY_ROLLBACK_CHECK_BEGIN
do $audit_readiness_rollback$
declare residual boolean;
begin
 -- These relations disappear during first-installation rehearsal rollback.
 if to_regclass('private.finance_audit_cases_v1') is not null then
  execute $q$select exists(select 1 from private.finance_audit_cases_v1 where case_data#>>'{items,A01,evidenceReference}'='__finance_audit_readiness_canary_20260911__')$q$ into residual;
  if residual then raise exception 'Audit canary rollback left case data';end if;
 end if;
 if to_regclass('private.finance_audit_case_revisions_v1') is not null then
  execute $q$select exists(select 1 from private.finance_audit_case_revisions_v1 where reason='__finance_audit_readiness_canary_20260911__')$q$ into residual;
  if residual then raise exception 'Audit canary rollback left immutable revisions';end if;
 end if;
end;
$audit_readiness_rollback$;
-- FINANCE_AUTHENTICATED_CANARY_ROLLBACK_CHECK_END
select jsonb_build_object('canary','authenticated_audit_readiness_v1','ok',true,'rolled_back',true,'audit_scope_preserved',true) as audit_readiness_canary_result;
