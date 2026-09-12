-- Verified browser-role payment concern round trip. Synthetic test request only.
-- No operational request, payment, approval or ledger is changed; rollback only.
begin isolation level repeatable read;
set local lock_timeout='5s';
set local statement_timeout='120s';
-- FINANCE_AUTHENTICATED_CANARY_CORE_BEGIN
do $employee_reliability_canary$
declare
 t uuid:=public.default_tenant_id();v_id constant text:='__finance_employee_reliability_20260912__';v_no constant text:='CANARY-EMPLOYEE-RELIABILITY-20260912';
 owner public.finance_users%rowtype;handler public.finance_users%rowtype;candidate public.finance_users%rowtype;probe public.expense_requests%rowtype;r jsonb;before jsonb;denied boolean;op uuid:=gen_random_uuid();
 old_claims text:=current_setting('request.jwt.claims',true);old_sub text:=current_setting('request.jwt.claim.sub',true);old_tenant text:=current_setting('app.current_tenant_id',true);
begin
 if exists(select 1 from public.expense_requests e where e.id=v_id or e.no=v_no) or exists(select 1 from private.finance_payment_concerns_v1 c where c.request_id=v_id) then raise exception 'Employee canary synthetic identifiers already exist';end if;
 -- Resolve candidates against the actual source read/handler predicates, not
 -- an assumed company-wide grant or an employment department alone.
 perform set_config('app.current_tenant_id',t::text,true);
 probe:=jsonb_populate_record(null::public.expense_requests,jsonb_build_object('id',v_id,'no',v_no,'tenant_id',t,'data_environment','test','entity_id','E6','department_code','J1101','type','payment_request','status','completed','amount',100,'cash_posted_at',now(),'steps','[]'::jsonb,'form_payload','{}'::jsonb));
 for candidate in select u.* from public.finance_users u where u.tenant_id=t and u.active and u.role='employee' and public.finance_user_is_approval_identity_ready(t,u.id) order by u.id loop
  perform set_config('request.jwt.claim.sub',candidate.auth_user_id::text,true);perform set_config('request.jwt.claims',jsonb_build_object('sub',candidate.auth_user_id,'role','authenticated','email',candidate.email)::text,true);
  probe.applicant_id:=candidate.id;probe.applicant:=candidate.name;probe.applicant_email:=candidate.email;
  if public.can_read_expense_request(probe) is true then owner:=candidate;exit;end if;
 end loop;
 for candidate in select u.* from public.finance_users u where u.tenant_id=t and u.active and u.role='accountant' and u.id<>owner.id and public.finance_user_is_approval_identity_ready(t,u.id) order by u.id loop
  perform set_config('request.jwt.claim.sub',candidate.auth_user_id::text,true);perform set_config('request.jwt.claims',jsonb_build_object('sub',candidate.auth_user_id,'role','authenticated','email',candidate.email)::text,true);
  if private.finance_payment_concern_handler_v1(probe,candidate) is true then handler:=candidate;exit;end if;
 end loop;
 if owner.id is null or handler.id is null or owner.id=handler.id then raise exception 'Employee canary requires distinct verified owner and handler authorized for its source';end if;
 if not exists(select 1 from public.finance_department_units u join public.finance_department_entity_scopes s on s.tenant_id=u.tenant_id and s.unit_id=u.id where u.tenant_id=t and u.code='J1101' and u.active and u.present_in_source and u.is_posting_unit and s.active and s.entity_code='E6') then raise exception 'Employee canary posting scope unavailable';end if;
 perform set_config('app.current_tenant_id',t::text,true);perform set_config('request.jwt.claim.sub',owner.auth_user_id::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',owner.auth_user_id,'role','authenticated','email',owner.email)::text,true);
 -- Seed a closed test source using the same reviewed shape as the finalizer
 -- canary. Normal insert triggers remain enabled; every step is completed.
 insert into public.expense_requests(id,no,tenant_id,data_environment,entity_id,department_code,applicant_id,applicant,applicant_email,type,type_label,amount,description,status,step,ver,request_date,bank_fee_amount,files,actual_files,steps,form_payload,cash_posted_at)
 values(v_id,v_no,t,'test','E6','J1101',owner.id,owner.name,owner.email,'payment_request','Rollback canary',100,'Employee concern rollback-only fixture','completed',1,1,current_date,0,'[]','[]',jsonb_build_array(jsonb_build_object('rk','applicant_submit','uid',owner.id,'a','approved','n',owner.name,'t',to_char(current_date,'MM/DD'),'c','Synthetic rollback-only fixture','files','[]'::jsonb)),'{}',now());
 select to_jsonb(e) into before from public.expense_requests e where e.id=v_id;
 execute 'set local role authenticated';
 if current_user<>'authenticated' or auth.uid() is distinct from owner.auth_user_id or public.current_tenant_id() is distinct from t then raise exception 'Employee canary identity did not resolve';end if;
 r:=public.finance_payment_concern_read_v1(v_id,'test');if r->>'canReport' is distinct from 'true' then raise exception 'Employee owner cannot report closed paid source';end if;
 r:=public.finance_payment_concern_action_v1(v_id,'report','Synthetic receipt concern',0,op,'test');if r->>'status' is distinct from 'open' or r->>'version' is distinct from '1' then raise exception 'Employee report did not create independent concern';end if;
 r:=public.finance_payment_concern_action_v1(v_id,'report','Synthetic receipt concern',0,op,'test');if r->>'idempotent' is distinct from 'true' then raise exception 'Employee exact retry not idempotent';end if;
 denied:=false;begin perform public.finance_payment_concern_action_v1(v_id,'report','Different input',0,op,'test');exception when invalid_parameter_value then denied:=true;end;if not denied then raise exception 'Employee operation reuse changed payload';end if;
 denied:=false;begin perform public.finance_payment_concern_action_v1(v_id,'report','Stale report',0,gen_random_uuid(),'test');exception when serialization_failure then denied:=true;end;if not denied then raise exception 'Employee stale version accepted';end if;
 denied:=false;begin perform public.finance_payment_concern_action_v1(v_id,'respond','Owner cannot impersonate accountant',1,gen_random_uuid(),'test');exception when insufficient_privilege then denied:=true;end;if not denied then raise exception 'Employee escalated to payment handler';end if;
 denied:=false;begin perform public.finance_payment_concern_read_v1(v_id,'production');exception when insufficient_privilege then denied:=true;end;if not denied then raise exception 'Employee concern crossed data environment';end if;
 denied:=false;begin execute 'select 1 from private.finance_payment_concerns_v1';exception when insufficient_privilege then denied:=true;end;if not denied then raise exception 'Employee direct concern table exposed';end if;
 execute 'reset role';perform set_config('request.jwt.claim.sub',handler.auth_user_id::text,true);perform set_config('request.jwt.claims',jsonb_build_object('sub',handler.auth_user_id,'role','authenticated','email',handler.email)::text,true);
 execute 'set local role authenticated';
 r:=public.finance_payment_concern_action_v1(v_id,'respond','Synthetic verified accountant response',1,gen_random_uuid(),'test');if r->>'status' is distinct from 'responded' or r->>'version' is distinct from '2' then raise exception 'Authorized concern handler did not respond';end if;
 denied:=false;begin perform public.finance_payment_concern_action_v1(v_id,'resolve','Handler cannot confirm for owner',2,gen_random_uuid(),'test');exception when insufficient_privilege then denied:=true;end;if not denied then raise exception 'Handler resolved on behalf of employee';end if;
 execute 'reset role';perform set_config('request.jwt.claim.sub',owner.auth_user_id::text,true);perform set_config('request.jwt.claims',jsonb_build_object('sub',owner.auth_user_id,'role','authenticated','email',owner.email)::text,true);
 execute 'set local role authenticated';
 r:=public.finance_payment_concern_action_v1(v_id,'resolve','Synthetic owner confirms concern resolved',2,gen_random_uuid(),'test');if r->>'status' is distinct from 'resolved' or r->>'version' is distinct from '3' then raise exception 'Employee resolution failed';end if;
 r:=public.finance_payment_concern_read_v1(v_id,'test');if jsonb_array_length(r#>'{rows,0,history}') is distinct from 3 then raise exception 'Employee event history not retained';end if;
 execute 'reset role';
 if (select to_jsonb(e) from public.expense_requests e where e.id=v_id) is distinct from before
  or exists(select 1 from public.vouchers v where v.request_id=v_id) or exists(select 1 from public.ledger_entries l where l.source_id=v_id)
  or exists(select 1 from public.notification_delivery_events n where n.request_id=v_no or n.payload->>'source_id'=v_id) then raise exception 'Concern changed source/payment/ledger or enqueued delivery';end if;
 execute 'set local role anon';denied:=false;begin perform public.finance_payment_concern_read_v1(v_id,'test');exception when insufficient_privilege then denied:=true;end;if not denied then raise exception 'Anonymous concern access accepted';end if;execute 'reset role';
 perform set_config('request.jwt.claims',coalesce(old_claims,''),true);perform set_config('request.jwt.claim.sub',coalesce(old_sub,''),true);perform set_config('app.current_tenant_id',coalesce(old_tenant,''),true);
end;
$employee_reliability_canary$;
-- FINANCE_AUTHENTICATED_CANARY_CORE_END
rollback;
-- FINANCE_AUTHENTICATED_CANARY_ROLLBACK_CHECK_BEGIN
do $employee_reliability_rollback$
declare residual boolean;v_id constant text:='__finance_employee_reliability_20260912__';v_no constant text:='CANARY-EMPLOYEE-RELIABILITY-20260912';
begin
 if exists(select 1 from public.expense_requests e where e.id=v_id or e.no=v_no)
  or exists(select 1 from public.application_accounting_lines a where a.request_id=v_id)
  or exists(select 1 from public.vouchers v where v.request_id=v_id)
  or exists(select 1 from public.ledger_entries l where l.source_id=v_id)
  or exists(select 1 from public.module_audit_logs a where a.row_id=v_id)
  or exists(select 1 from public.approval_step_actor_snapshots a where a.record_id=v_id)
  or exists(select 1 from public.cash_movement_evidence_links e where e.source_id=v_id or e.source_no=v_no)
  or exists(select 1 from public.notification_delivery_events n where n.request_id=v_no or n.payload->>'source_id'=v_id) then raise exception 'Employee canary rollback left source data';end if;
 if to_regclass('private.finance_payment_concerns_v1') is not null then execute $q$select exists(select 1 from private.finance_payment_concerns_v1 where request_id='__finance_employee_reliability_20260912__')$q$ into residual;if residual then raise exception 'Employee canary rollback left concern';end if;end if;
 if to_regclass('private.finance_payment_concern_events_v1') is not null then execute $q$select exists(select 1 from private.finance_payment_concern_events_v1 where request_id='__finance_employee_reliability_20260912__')$q$ into residual;if residual then raise exception 'Employee canary rollback left history';end if;end if;
end;
$employee_reliability_rollback$;
-- FINANCE_AUTHENTICATED_CANARY_ROLLBACK_CHECK_END
select jsonb_build_object('canary','authenticated_employee_reliability_v1','ok',true,'rolled_back',true,'payment_authority_preserved',true) as employee_reliability_canary_result;
