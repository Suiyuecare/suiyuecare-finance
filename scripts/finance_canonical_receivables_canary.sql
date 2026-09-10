-- Authenticated rollback-only AR canary; no Storage objects or real documents.
-- A release-owner fixture represents an already recognized 100 invoice with
-- an existing 40 receipt. All new lifecycle/refund actions use browser role.
begin isolation level repeatable read;
set local lock_timeout='5s';
set local statement_timeout='120s';
-- FINANCE_AUTHENTICATED_CANARY_CORE_BEGIN
do $canary$
declare
 v_tenant constant uuid:='00000000-0000-0000-0000-000000000001';
 v_id constant text:='__finance_ar_canary_20260910__';v_no constant text:='CANARY-AR-20260910';v_event_no constant text:='CANARY-AR-ALW-20260910';
 v_actor public.finance_users%rowtype;v_i public.invoices%rowtype;v_income text;v_income_name text;v_result jsonb;v_ar jsonb;v_event text;v_blocked boolean:=false;
 v_date date:=(clock_timestamp() at time zone 'Asia/Taipei')::date;v_steps jsonb;v_before jsonb;v_after jsonb;v_source_before jsonb;
 v_claims text:=current_setting('request.jwt.claims',true);v_sub text:=current_setting('request.jwt.claim.sub',true);v_tenant_setting text:=current_setting('app.current_tenant_id',true);
 v_old_op text:=current_setting('app.finance_receipt_operation',true);v_old_actor text:=current_setting('app.finance_receipt_actor',true);
begin
 if exists(select 1 from public.invoices where id=v_id or no=v_no) or exists(select 1 from public.invoice_lifecycle_events where invoice_id=v_id or event_no=v_event_no)
  or exists(select 1 from public.ledger_entries where source_id=v_id or reference_no=v_no) or exists(select 1 from public.vouchers where request_id=v_id)
  or exists(select 1 from private.finance_ar_terms_v1 where invoice_id=v_id) then raise exception 'AR canary identifiers already exist; refusing to overwrite';end if;
 perform set_config('app.current_tenant_id',v_tenant::text,true);
 select u.* into v_actor from public.finance_users u join auth.users au on au.id=u.auth_user_id
 where u.tenant_id=v_tenant and u.active is true and au.email_confirmed_at is not null and coalesce(au.is_anonymous,false)=false
  and exists(select 1 from auth.identities g where g.user_id=au.id and g.provider='google')
  and public.finance_user_is_approval_identity_ready(v_tenant,u.id)
  and exists(select 1 from public.employee_department_roles r where r.tenant_id=v_tenant and r.finance_user_id=u.id and r.role_key='accountant' and r.can_approve is true
   and private.finance_org_effective_now_v2(to_jsonb(r)||coalesce(r.metadata->'org_effective_period','{}'))) order by u.id limit 1;
 if v_actor.id is null then raise exception 'AR canary needs a verified active accountant';end if;
 if not exists(select 1 from public.finance_department_units u join public.finance_department_entity_scopes s on s.tenant_id=u.tenant_id and s.unit_id=u.id where u.tenant_id=v_tenant and u.code='J1101' and u.active and u.present_in_source and u.is_posting_unit and s.active and s.entity_code='E6') then raise exception 'AR canary posting scope unavailable';end if;
 select r.revenue_account_code into v_income from public.revenue_recognition_rules r where r.tenant_id=v_tenant and r.active and r.effective_from<=v_date and (r.effective_to is null or r.effective_to>=v_date)
  and (r.entity_id is null or r.entity_id='E6') and (r.department_code is null or r.department_code='J1101') and private.finance_tenant_account_name(v_tenant,r.revenue_account_code) is not null order by r.priority,r.id limit 1;
 if v_income is null then raise exception 'AR canary income account unavailable';end if;
 v_income_name:=private.finance_tenant_account_name(v_tenant,v_income);
 perform set_config('request.jwt.claim.sub',v_actor.auth_user_id::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',v_actor.auth_user_id,'role','authenticated','email',v_actor.email)::text,true);
 v_steps:=jsonb_build_array(jsonb_build_object('rk','applicant_submit','uid',v_actor.id,'a','approved','n',v_actor.name),jsonb_build_object('rk','accountant_invoice','uid',v_actor.id,'a','approved','n',v_actor.name),jsonb_build_object('rk','applicant_invoice_delivery','uid',v_actor.id,'a',''));
 insert into public.invoices(id,no,tenant_id,data_environment,entity_id,entity_name,department_code,invoice_date,buyer,amount,tax,total,status,approval_status,approval_step,steps,applicant,applicant_id,invoice_identifier_type,
 revenue_posted,revenue_posted_at,revenue_posting_state,revenue_posting_version,revenue_account_code,revenue_account_name)
 values(v_id,v_no,v_tenant,'test','E6','Rollback-only fixture','J1101',v_date,'Synthetic AR canary',100,0,100,'unpaid','pending_delivery',3,v_steps,v_actor.name,v_actor.id,'領據',true,clock_timestamp(),'posted',2,v_income,v_income_name);
 insert into public.ledger_entries(tenant_id,data_environment,entry_date,entity_id,department_code,debit,credit,account_code,account_name,reference_no,posting_key,source_type,source_id,source_no)
 values(v_tenant,'test',v_date,'E6','J1101',100,0,'1123',private.finance_tenant_account_name(v_tenant,'1123'),v_no,'invoice:'||v_no||':revenue:ar','invoice',v_id,v_no),
 (v_tenant,'test',v_date,'E6','J1101',0,100,v_income,v_income_name,v_no,'invoice:'||v_no||':revenue:income','invoice',v_id,v_no);
 -- An explicit transaction-bound capability only seeds the preexisting receipt.
 insert into private.finance_receipt_operations_v1(tenant_id,data_environment,actor_id,operation_key,digest,invoice_ids,writing_transaction)
 values(v_tenant,'test',v_actor.id,'canary-ar-seed-20260910','synthetic-history',array[v_id],pg_current_xact_id()::text);
 perform set_config('app.finance_receipt_operation','canary-ar-seed-20260910',true);perform set_config('app.finance_receipt_actor',v_actor.id,true);
 insert into public.ledger_entries(tenant_id,data_environment,entry_date,entity_id,department_code,debit,credit,account_code,account_name,reference_no,posting_key,source_type,source_id,source_no)
 values(v_tenant,'test',v_date,'E6','J1101',40,0,'1112',private.finance_tenant_account_name(v_tenant,'1112'),v_no,'invoice:'||v_no||':receipt:bank','invoice',v_id,v_no),
 (v_tenant,'test',v_date,'E6','J1101',0,40,'1123',private.finance_tenant_account_name(v_tenant,'1123'),v_no,'invoice:'||v_no||':receipt:ar','invoice',v_id,v_no);
 update private.finance_receipt_operations_v1 set writing_transaction=null where tenant_id=v_tenant and actor_id=v_actor.id and operation_key='canary-ar-seed-20260910';
 perform set_config('app.finance_receipt_operation',coalesce(v_old_op,''),true);perform set_config('app.finance_receipt_actor',coalesce(v_old_actor,''),true);
 select jsonb_agg(to_jsonb(l) order by posting_key) into v_source_before from public.ledger_entries l where source_id=v_id;
 execute 'set local role authenticated';
 if current_user<>'authenticated' or (public.current_finance_user()).id is distinct from v_actor.id then raise exception 'AR browser identity did not resolve exactly';end if;
 v_result:=public.finance_receivables_v1(v_date,'E6','J1101','test');select x into v_ar from jsonb_array_elements(v_result->'items') x where x->>'invoiceId'=v_id;
 if (v_ar->>'outstandingAmount')::numeric<>60 or (v_ar->>'receivedAmount')::numeric<>40 or v_ar->>'agingBucket'<>'unknown' then raise exception 'AR initial canonical balance/date differs';end if;
 -- Accountant must not gain CEO approval authority, even in this canary.
 begin perform public.finance_invoice_receipt_action_v2(array[v_id],'approve','canary-ar-deny-20260910',jsonb_build_object(v_id,1),'Canary denied','[]','test',null,null);
 exception when insufficient_privilege then v_blocked:=true;end;
 if not v_blocked then raise exception 'AR accountant acquired CEO receipt authority';end if;
 v_result:=public.post_invoice_lifecycle_voucher(v_id,'allowance',v_event_no,'Rollback-only allowance',100,0,100,v_date);v_event:=v_result->>'event_id';
 if (v_result->>'ar_amount')::numeric<>60 or (v_result->>'refund_payable_amount')::numeric<>40 then raise exception 'AR lifecycle split differs';end if;
 v_result:=public.refund_invoice_receipt_v2(v_event,10,'Rollback-only refund',v_date,null,'canary-ar-refund-1-20260910',0);
 if (v_result->>'remaining_refund_amount')::numeric<>30 then raise exception 'AR first refund remainder differs';end if;
 v_result:=public.refund_invoice_receipt_v2(v_event,10,'Rollback-only refund',v_date,null,'canary-ar-refund-1-20260910',0);
 if v_result->>'idempotent_replay'<>'true' then raise exception 'AR refund replay not recognized';end if;
 v_result:=public.refund_invoice_receipt_v2(v_event,30,'Rollback-only refund',v_date,null,'canary-ar-refund-2-20260910',10);
 if (v_result->>'remaining_refund_amount')::numeric<>0 then raise exception 'AR second refund differs';end if;
 v_blocked:=false;
 begin perform public.refund_invoice_receipt_v2(v_event,1,'Rollback-only invalid refund',v_date,null,'canary-ar-refund-bad-20260910',40);exception when check_violation then v_blocked:=true;end;
 if not v_blocked then raise exception 'AR over-refund accepted';end if;
 v_result:=public.finance_receivables_v1(v_date,'E6','J1101','test');select x into v_ar from jsonb_array_elements(v_result->'items') x where x->>'invoiceId'=v_id;
 if (v_ar->>'outstandingAmount')::numeric<>0 or (v_ar->>'refundPayable')::numeric<>0 or (v_ar->>'refundedAmount')::numeric<>40 then raise exception 'AR final canonical balance differs';end if;
 execute 'reset role';
 select jsonb_agg(to_jsonb(l) order by posting_key) into v_after from public.ledger_entries l where source_id=v_id;
 if v_after is distinct from v_source_before then raise exception 'AR canary rewrote original posted source journals';end if;
 if (select sum(l.debit-l.credit) from public.ledger_entries l where l.tenant_id=v_tenant and l.data_environment='test' and (l.source_id=v_id or l.source_id in(select id from public.invoice_lifecycle_events where invoice_id=v_id)))<>0 then raise exception 'AR canary journals unbalanced';end if;
 if exists(select 1 from private.finance_ar_operations_v1 where invoice_id=v_id and writing_transaction is not null)
  or exists(select 1 from public.notification_delivery_events where request_id in (v_id,v_no) or payload->>'source_id'=v_id) then raise exception 'AR capability leaked or notification enqueued';end if;
 perform set_config('request.jwt.claims',coalesce(v_claims,''),true);perform set_config('request.jwt.claim.sub',coalesce(v_sub,''),true);perform set_config('app.current_tenant_id',coalesce(v_tenant_setting,''),true);
end;
$canary$;
-- FINANCE_AUTHENTICATED_CANARY_CORE_END
rollback;
-- FINANCE_AUTHENTICATED_CANARY_ROLLBACK_CHECK_BEGIN
do $rollback_check$
begin
 if exists(select 1 from public.invoices where id='__finance_ar_canary_20260910__' or no='CANARY-AR-20260910')
  or exists(select 1 from public.ledger_entries where source_id='__finance_ar_canary_20260910__' or reference_no in ('CANARY-AR-20260910','CANARY-AR-ALW-20260910'))
  or exists(select 1 from public.vouchers where request_id='__finance_ar_canary_20260910__')
  or exists(select 1 from public.invoice_lifecycle_events where invoice_id='__finance_ar_canary_20260910__')
  or exists(select 1 from private.finance_ar_terms_v1 where invoice_id='__finance_ar_canary_20260910__')
  or exists(select 1 from private.finance_ar_receipts_v1 where invoice_id='__finance_ar_canary_20260910__')
  or exists(select 1 from private.finance_ar_refunds_v1 where invoice_id='__finance_ar_canary_20260910__')
  or exists(select 1 from private.finance_ar_audit_v1 where invoice_id='__finance_ar_canary_20260910__')
  or exists(select 1 from private.finance_ar_operations_v1 where invoice_id='__finance_ar_canary_20260910__' or operation_key like 'canary-ar-%20260910')
  or exists(select 1 from private.finance_receipt_operations_v1 where '__finance_ar_canary_20260910__'=any(invoice_ids)) then raise exception 'AR canary rollback left fixture data';end if;
end;
$rollback_check$;
-- FINANCE_AUTHENTICATED_CANARY_ROLLBACK_CHECK_END
select jsonb_build_object('canary','authenticated_canonical_receivables_v1','ok',true,'rolled_back',true,'receivables_consistent',true) as canonical_receivables_canary_result;
