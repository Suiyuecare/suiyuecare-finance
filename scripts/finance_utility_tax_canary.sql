\set ON_ERROR_STOP on
-- Authenticated utility-expense canary. Synthetic test rows only; the entire
-- transaction must be rolled back. Never finalize an operational request.
begin isolation level repeatable read;
set local lock_timeout='5s';
set local statement_timeout='120s';

-- FINANCE_AUTHENTICATED_CANARY_CORE_BEGIN
do $canary$
declare
  v_tenant constant uuid:='00000000-0000-0000-0000-000000000001';
  v_id constant text:='__finance_utility_tax_canary_20260909__';
  v_no constant text:='CANARY-UTILITY-TAX-20260909';
  v_voucher constant text:='V-CANARY-UTILITY-TAX-20260909';
  v_actor public.finance_users%rowtype;v_applicant public.finance_users%rowtype;
  v_bad jsonb;v_blocked boolean:=false;v_detail text;v_old jsonb;v_new jsonb;v_who jsonb;v_steps jsonb;v_done jsonb;v_entries jsonb;v_result jsonb;v_saved public.expense_requests%rowtype;
  v_at text:=to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_date text:=to_char(now() at time zone 'Asia/Taipei','MM/DD');
  v_old_claims text:=current_setting('request.jwt.claims',true);
  v_old_sub text:=current_setting('request.jwt.claim.sub',true);
  v_old_tenant text:=current_setting('app.current_tenant_id',true);
begin
  if to_regprocedure('private.finance_assert_utility_posting_v1(public.expense_requests,jsonb,jsonb)') is null then
    raise exception 'Utility tax canary requires the new atomic persistence helper';end if;
  if exists(select 1 from public.expense_requests where id=v_id or no=v_no)
    or exists(select 1 from public.vouchers where id=v_voucher or no=v_voucher or request_id=v_id)
    or exists(select 1 from public.application_accounting_lines where request_id=v_id)
    or exists(select 1 from public.ledger_entries where source_id=v_id or reference_no=v_no or voucher_no=v_voucher) then
    raise exception 'Utility tax canary identifiers already exist; refusing to overwrite';end if;
  select u.* into v_actor from public.finance_users u join auth.users au on au.id=u.auth_user_id
  where u.tenant_id=v_tenant and u.active is true and au.email_confirmed_at is not null
    and coalesce(au.is_anonymous,false)=false
    and exists(select 1 from auth.identities i where i.user_id=au.id and i.provider='google')
    and public.finance_user_is_approval_identity_ready(v_tenant,u.id)
    and exists(select 1 from public.employee_department_roles r where r.tenant_id=v_tenant and r.finance_user_id=u.id
      and r.role_key in ('accountant','accountant_final') and r.can_approve is true
      and private.finance_org_effective_now_v2(to_jsonb(r)||coalesce(r.metadata->'org_effective_period','{}')))
  order by u.id limit 1;
  if v_actor.id is null then raise exception 'Utility tax canary has no verified active accountant';end if;
  select u.* into v_applicant from public.finance_users u where u.tenant_id=v_tenant and u.active is true and u.id<>v_actor.id
    and public.finance_user_is_approval_identity_ready(v_tenant,u.id) order by u.id limit 1;
  if v_applicant.id is null then raise exception 'Utility tax canary has no separate active applicant';end if;
  if not exists(select 1 from public.finance_department_units u join public.finance_department_entity_scopes s
    on s.tenant_id=u.tenant_id and s.unit_id=u.id
    where u.tenant_id=v_tenant and u.code='J1101' and u.active and u.present_in_source and u.is_posting_unit and s.active and s.entity_code='E6') then
    raise exception 'Utility tax canary posting scope is unavailable';end if;
  perform set_config('request.jwt.claim.sub',v_actor.auth_user_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_actor.auth_user_id,'role','authenticated','email',v_actor.email)::text,true);
  perform set_config('app.current_tenant_id',v_tenant::text,true);
  v_old:=jsonb_build_object('id','line_1','source','detail','description','水費11508',
    'grossAmount',100,'netAmount',100,'taxAmount',0,'debitAccount','6299',
    'debitAccountName',private.finance_tenant_account_name(v_tenant,'6299'),
    'creditAccount','1112','creditAccountName',private.finance_tenant_account_name(v_tenant,'1112'),
    'departmentCode','J1101','systemFee',false,'locked',false);
  if v_old->>'debitAccountName' is null or v_old->>'creditAccountName' is null
    or private.finance_tenant_account_name(v_tenant,'6202') is null then raise exception 'Utility tax canary account catalog is unavailable';end if;
  v_who:=jsonb_build_object('id',v_actor.id,'name',v_actor.name,'role',v_actor.role);
  v_new:=v_old||jsonb_build_object('debitAccount','6202','debitAccountName',private.finance_tenant_account_name(v_tenant,'6202'),
    'manualOverride',true,'valueAuthority','human','manualFields',jsonb_build_array('debitAccount'),
    'manualOverrideBy',v_who,'manualOverrideAt',v_at,'manualOverrideSource','approval_modal_review',
    'manualOverrideHistory',jsonb_build_array(jsonb_build_object('at',v_at,'actor',v_who,'source','approval_modal_review',
      'changes',jsonb_build_object('debitAccount',jsonb_build_object('before','6299','after','6202')))),
    'reviewedBy',v_actor.name,'reviewedAt',v_at);
  v_steps:=jsonb_build_array(jsonb_build_object('rk','applicant_submit','uid',v_applicant.id,'a','approved','n',v_applicant.name,'t',v_date,'c','Synthetic rollback-only fixture','files','[]'::jsonb),
    jsonb_build_object('rk','accountant_final','uid',v_actor.id,'a','','n','','t','','c','','files','[]'::jsonb,'status','pending_voucher'));
  -- The release owner seeds only a synthetic final-gate fixture. All posting
  -- authorization, frozen-step validation and mutations use the browser role.
  insert into public.expense_requests(id,no,tenant_id,data_environment,entity_id,department_code,applicant_id,applicant,applicant_email,
    type,type_label,amount,description,status,step,ver,request_date,debit_account,debit_account_name,credit_account,credit_account_name,
    bank_fee_amount,files,actual_files,steps,form_payload)
  values(v_id,v_no,v_tenant,'test','E6','J1101',v_applicant.id,v_applicant.name,v_applicant.email,
    'payment_request','Rollback canary',100,'水費11508','pending_voucher',2,1,current_date,
    '6299',v_old->>'debitAccountName','1112',v_old->>'creditAccountName',0,'[]','[]',v_steps,
    jsonb_build_object('accountingLines',jsonb_build_array(v_old),'canaryProtected','unchanged'));
  v_done:=jsonb_set(v_steps,'{1}',v_steps->1||jsonb_build_object('a','approved','n',v_actor.name,'t',v_date,
    'c','簽核通過（'||v_actor.name||'，'||v_date||'）',
    'actionLog',jsonb_build_array(jsonb_build_object('action','簽核通過','by',v_actor.name,'byId',v_actor.id,'at',v_at,'comment',''))));
  v_entries:=jsonb_build_array(jsonb_build_object('t','dr','ac','6202','amt',100),jsonb_build_object('t','cr','ac','1112','amt',100));
  execute 'set local role authenticated';
  if current_user<>'authenticated' or (public.current_finance_user()).id is distinct from v_actor.id
    or public.current_tenant_id() is distinct from v_tenant then raise exception 'Utility tax canary browser identity did not resolve exactly';end if;
  -- A real authenticated caller must not post a balanced utility tax split.
  -- The negative attempt runs in a PL/pgSQL subtransaction and must leave the
  -- pending request, voucher, ledger and human audit completely untouched.
  v_bad:=v_new||jsonb_build_object('netAmount',95,'taxAmount',5,
    'manualFields',jsonb_build_array('debitAccount','netAmount','taxAmount'),
    'manualOverrideHistory',jsonb_build_array(jsonb_build_object('at',v_at,'actor',v_who,'source','approval_modal_review',
      'changes',jsonb_build_object('debitAccount',jsonb_build_object('before','6299','after','6202'),
        'netAmount',jsonb_build_object('before',100,'after',95),'taxAmount',jsonb_build_object('before',0,'after',5)))));
  begin
    perform public.finalize_expense_request(v_id,'completed',2,v_done,100,0,v_voucher,v_voucher,'ignored',
      jsonb_build_array(jsonb_build_object('t','dr','ac','6202','amt',95),jsonb_build_object('t','dr','ac','1144','amt',5),jsonb_build_object('t','cr','ac','1112','amt',100)),
      100,'Rollback-only rejected utility split',current_date,jsonb_build_object('accountingLines',jsonb_build_array(v_bad)));
  exception when check_violation then
    get stacked diagnostics v_detail=pg_exception_detail;
    if v_detail not in ('UTILITY_GROSS_EXPENSE_REVIEW_REQUIRED','UTILITY_INPUT_TAX_POSTING_REJECTED') then raise;end if;
    v_blocked:=true;
  end;
  execute 'reset role';
  if not v_blocked or not exists(select 1 from public.expense_requests where id=v_id and status='pending_voucher'
      and form_payload->'accountingLines'=jsonb_build_array(v_old))
    or exists(select 1 from public.vouchers where request_id=v_id)
    or exists(select 1 from public.ledger_entries where source_id=v_id)
    or exists(select 1 from public.module_audit_logs where row_id=v_id and action='HUMAN_ACCOUNTING_SYNC') then
    raise exception 'Utility tax canary rejection was not atomic';end if;
  execute 'set local role authenticated';
  v_result:=public.finalize_expense_request(v_id,'completed',2,v_done,100,0,v_voucher,v_voucher,'ignored',v_entries,100,'Rollback-only canary',current_date,
    jsonb_build_object('accountingLines',jsonb_build_array(v_new),'cashAmount',999,'accountingCorrection',jsonb_build_object('status','applied')));
  execute 'reset role';
  select * into v_saved from public.expense_requests where id=v_id and tenant_id=v_tenant and data_environment='test';
  if v_result->>'ok'<>'true' or v_result->>'idempotent'<>'false' or v_saved.status<>'completed'
    or v_saved.debit_account<>'6202' or v_saved.credit_account<>'1112'
    or v_saved.form_payload->'accountingLines' is distinct from jsonb_build_array(v_new)
    or v_saved.form_payload->>'canaryProtected'<>'unchanged' or v_saved.form_payload ? 'cashAmount' or v_saved.form_payload ? 'accountingCorrection'
    or (select count(*) from public.application_accounting_lines where request_id=v_id and data_environment='test' and debit_account='6202' and net_amount=100 and payload=v_new)<>1
    or (select count(*) from public.module_audit_logs where row_id=v_id and table_name='application_accounting_lines' and action='HUMAN_ACCOUNTING_SYNC')<>1
    or (select count(*) from public.vouchers where id=v_voucher and tenant_id=v_tenant and data_environment='test' and posted and voided_at is null)<>1
    or (select count(*) from public.ledger_entries where tenant_id=v_tenant and data_environment='test' and source_id=v_id and voucher_no=v_voucher and voided_at is null)<>2
    or not exists(select 1 from public.ledger_entries where tenant_id=v_tenant and data_environment='test' and source_id=v_id and voucher_no=v_voucher and account_code='6202' and debit=100 and credit=0 and voided_at is null)
    or not exists(select 1 from public.ledger_entries where tenant_id=v_tenant and data_environment='test' and source_id=v_id and voucher_no=v_voucher and account_code='1112' and debit=0 and credit=100 and voided_at is null) then
    raise exception 'Utility tax canary source, human audit, normalized lines or ledger differ';end if;
  if exists(select 1 from public.ledger_entries where source_id=v_id and account_code='1144')
    or exists(select 1 from public.vouchers v cross join lateral jsonb_array_elements(v.entries) e where v.request_id=v_id and e->>'ac'='1144')
    or exists(select 1 from public.application_accounting_lines where request_id=v_id and (tax_amount<>0 or net_amount<>gross_amount)) then
    raise exception 'Utility tax canary unexpectedly created input tax';end if;
  if exists(select 1 from public.notification_delivery_events where request_id=v_no or payload->>'source_id'=v_id) then
    raise exception 'Final accounting test fixture unexpectedly enqueued a notification';end if;
  perform set_config('request.jwt.claims',coalesce(v_old_claims,''),true);
  perform set_config('request.jwt.claim.sub',coalesce(v_old_sub,''),true);
  perform set_config('app.current_tenant_id',coalesce(v_old_tenant,''),true);
end;
$canary$;
-- FINANCE_AUTHENTICATED_CANARY_CORE_END

rollback;

-- FINANCE_AUTHENTICATED_CANARY_ROLLBACK_CHECK_BEGIN
do $rollback_check$
declare v_id constant text:='__finance_utility_tax_canary_20260909__';v_no constant text:='CANARY-UTILITY-TAX-20260909';v_voucher constant text:='V-CANARY-UTILITY-TAX-20260909';
begin
  if exists(select 1 from public.expense_requests where id=v_id or no=v_no)
    or exists(select 1 from public.application_accounting_lines where request_id=v_id)
    or exists(select 1 from public.vouchers where request_id=v_id or id=v_voucher)
    or exists(select 1 from public.ledger_entries where source_id=v_id or voucher_no=v_voucher or reference_no=v_no)
    or exists(select 1 from public.module_audit_logs where row_id=v_id)
    or exists(select 1 from public.approval_step_actor_snapshots where record_id=v_id)
    or exists(select 1 from public.cash_movement_evidence_links where source_id=v_id or source_no=v_no)
    or exists(select 1 from public.notification_delivery_events where request_id=v_no or payload->>'source_id'=v_id) then
    raise exception 'Utility tax canary rollback left fixture data behind';end if;
end;
$rollback_check$;
-- FINANCE_AUTHENTICATED_CANARY_ROLLBACK_CHECK_END

select jsonb_build_object('canary','authenticated_utility_tax_v1','ok',true,'rolled_back',true,'utility_input_tax_absent',true) as utility_tax_canary_result;
