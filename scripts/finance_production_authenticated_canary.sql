-- This is an authenticated, rollback-only production database canary.
-- It exercises submit -> supervisor return -> applicant resubmit with verified
-- Google identities, but writes only data_environment=test rows and rolls the
-- entire transaction back. No notification delivery event may be enqueued.

begin isolation level repeatable read;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- FINANCE_AUTHENTICATED_CANARY_CORE_BEGIN
do $canary$
declare
  v_tenant_id constant uuid := '00000000-0000-0000-0000-000000000001';
  v_request_id constant text := '__finance_release_canary_u8__';
  v_request_no constant text := 'CANARY-ROLLBACK-U8';
  v_applicant_id constant text := 'u8';
  v_applicant_name constant text := '朱夏欣';
  v_applicant_email constant text := 'generalaffairs@suiyuecare.com';
  v_applicant_auth_user_id constant uuid := '0e8c95c0-3d7e-45da-a854-f845a1fd8f7d';
  v_supervisor_id constant text := 'u5';
  v_supervisor_name constant text := '劉巧涵';
  v_supervisor_email constant text := 'admin@suiyuecare.com';
  v_supervisor_auth_user_id constant uuid := 'a5bcabf2-06ab-4fe0-ac3e-a2124ed161b6';
  v_accountant_id constant text := 'u6';
  v_ceo_id constant text := 'u_entrepreneur';
  v_department_code constant text := 'J1101';
  v_entity_code constant text := 'E6';
  v_org_unit_id uuid;
  v_steps jsonb;
  v_actor_requests jsonb;
  v_form jsonb;
  v_result jsonb;
  v_action_result jsonb;
  v_state jsonb;
  v_expense public.expense_requests%rowtype;
  v_active_index integer;
  v_active_step jsonb;
  v_resubmitted_steps jsonb;
begin
  if exists (
    select 1
    from public.expense_requests expense_row
    where expense_row.tenant_id = v_tenant_id
      and expense_row.id = v_request_id
  ) then
    raise exception 'Authenticated release canary id already exists; refusing to overwrite data';
  end if;

  if not public.finance_user_is_approval_identity_ready(v_tenant_id, v_applicant_id)
     or not public.finance_user_is_approval_identity_ready(v_tenant_id, v_supervisor_id)
     or not public.finance_user_is_approval_identity_ready(v_tenant_id, v_accountant_id)
     or not public.finance_user_is_approval_identity_ready(v_tenant_id, v_ceo_id) then
    raise exception 'Authenticated release canary identities are not ready';
  end if;

  select unit_row.value ->> 'id'
    into v_org_unit_id
  from private.finance_membership_org_versions_v1 version_row
  cross join lateral pg_catalog.jsonb_array_elements(version_row.snapshot -> 'units') unit_row(value)
  where version_row.tenant_id = v_tenant_id
    and version_row.status = 'published'
    and (version_row.effective_at is null or version_row.effective_at <= pg_catalog.now())
    and unit_row.value ->> 'code' = v_department_code
    and coalesce((unit_row.value ->> 'active')::boolean, false)
    and coalesce((unit_row.value ->> 'is_posting_unit')::boolean, false)
    and coalesce(unit_row.value -> 'entity_codes', '[]'::jsonb) ? v_entity_code
  order by version_row.published_at desc nulls last, version_row.updated_at desc
  limit 1;

  if v_org_unit_id is null then
    raise exception 'Authenticated release canary posting unit is unavailable';
  end if;

  v_steps := pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object(
      'a', 'approved', 'c', '發布前回滾測試送件', 'n', v_applicant_name,
      'r', '申請人送件', 't', pg_catalog.to_char(current_date, 'YYYY/MM/DD'),
      'rk', 'applicant_submit', 'uid', v_applicant_id, 'status', 'submitted'
    ),
    pg_catalog.jsonb_build_object(
      'a', '', 'c', '', 'n', '', 'r', '申請人主管', 't', '',
      'rk', 'direct_supervisor', 'uid', v_supervisor_id,
      'files', '[]'::jsonb, 'status', 'pending_section_chief'
    ),
    pg_catalog.jsonb_build_object(
      'a', 'approved',
      'c', '申請人上一層級主管與申請人部門主任為同一位；系統自動跳過重複簽核。',
      'n', '系統自動跳關', 'r', '申請人部門主任', 't', '',
      'rk', 'dept_manager', 'uid', v_supervisor_id,
      'files', '[]'::jsonb, 'status', 'pending_dept_manager',
      'autoSkip', true, 'autoSkipReason', 'same_direct_supervisor_and_dept_manager'
    ),
    pg_catalog.jsonb_build_object(
      'a', '', 'c', '', 'n', '', 'r', '行政部門主任', 't', '',
      'rk', 'admin_director', 'uid', v_supervisor_id,
      'files', '[]'::jsonb, 'status', 'pending_admin_director'
    ),
    pg_catalog.jsonb_build_object(
      'a', '', 'c', '', 'n', '', 'r', '會計', 't', '',
      'rk', 'accountant', 'uid', v_accountant_id,
      'files', '[]'::jsonb, 'status', 'pending_accountant'
    ),
    pg_catalog.jsonb_build_object(
      'a', '', 'c', '', 'n', '', 'r', '執行長檢視會計科目', 't', '',
      'rk', 'ceo', 'uid', v_ceo_id,
      'files', '[]'::jsonb, 'status', 'pending_ceo'
    ),
    pg_catalog.jsonb_build_object(
      'a', '', 'c', '', 'n', '', 'r', '出納放款', 't', '',
      'rk', 'cashier', 'uid', v_applicant_id,
      'files', '[]'::jsonb, 'status', 'pending_cashier'
    ),
    pg_catalog.jsonb_build_object(
      'a', '', 'c', '', 'n', '', 'r', '申請人確認', 't', '',
      'rk', 'applicant_confirm', 'uid', v_applicant_id,
      'files', '[]'::jsonb, 'status', 'pending_applicant_confirm'
    ),
    pg_catalog.jsonb_build_object(
      'a', '', 'c', '', 'n', '', 'r', '會計確認入帳', 't', '',
      'rk', 'accountant_final', 'uid', v_accountant_id,
      'files', '[]'::jsonb, 'status', 'pending_voucher'
    )
  );

  v_actor_requests := pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object('step_key', 'direct_supervisor', 'finance_user_id', v_supervisor_id),
    pg_catalog.jsonb_build_object('step_key', 'admin_director', 'finance_user_id', v_supervisor_id),
    pg_catalog.jsonb_build_object('step_key', 'accountant', 'finance_user_id', v_accountant_id),
    pg_catalog.jsonb_build_object('step_key', 'ceo', 'finance_user_id', v_ceo_id),
    pg_catalog.jsonb_build_object('step_key', 'cashier', 'finance_user_id', v_applicant_id),
    pg_catalog.jsonb_build_object('step_key', 'applicant_confirm', 'finance_user_id', v_applicant_id),
    pg_catalog.jsonb_build_object('step_key', 'accountant_final', 'finance_user_id', v_accountant_id)
  );

  perform pg_catalog.set_config('request.jwt.claim.sub', v_applicant_auth_user_id::text, true);
  perform pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object(
      'sub', v_applicant_auth_user_id,
      'role', 'authenticated',
      'email', v_applicant_email
    )::text,
    true
  );
  perform pg_catalog.set_config('app.current_tenant_id', v_tenant_id::text, true);

  if public.current_tenant_id() is distinct from v_tenant_id
     or (public.current_finance_user()).id is distinct from v_applicant_id
     or pg_catalog.lower((public.current_finance_user()).email) is distinct from v_applicant_email then
    raise exception 'Authenticated release canary applicant identity did not resolve exactly';
  end if;

  v_form := pg_catalog.jsonb_build_object(
    'id', v_request_id,
    'no', v_request_no,
    'entity_id', v_entity_code,
    'department_code', v_department_code,
    'applicant', v_applicant_name,
    'applicant_id', v_applicant_id,
    'applicant_email', v_applicant_email,
    'type', 'payment_request',
    'type_label', '付款申請',
    'amount', 100,
    'description', '正式發布前身分與送件回滾測試',
    'status', 'pending_section_chief',
    'step', 2,
    'request_date', current_date,
    'files', '[]'::jsonb,
    'actual_files', '[]'::jsonb,
    'steps', v_steps,
    'form_payload', pg_catalog.jsonb_build_object('is_fixed_expense', false),
    'data_environment', 'test'
  );

  -- Run the public endpoint under the same database role used by a signed-in
  -- browser. The surrounding release connection remains the session owner so
  -- it can inspect the result and roll the entire canary back afterward.
  execute 'set local role authenticated';
  if current_user <> 'authenticated' then
    raise exception 'Authenticated release canary could not assume the browser database role';
  end if;
  v_result := public.finance_submit_expense_request(
    v_form,
    v_org_unit_id,
    v_entity_code,
    v_actor_requests
  );
  execute 'reset role';
  if coalesce((v_result ->> 'ok')::boolean, false) is not true
     or v_result ->> 'form_id' is distinct from v_request_id then
    raise exception 'Authenticated release canary submit did not return the expected result';
  end if;

  select expense_row.* into strict v_expense
  from public.expense_requests expense_row
  where expense_row.tenant_id = v_tenant_id
    and expense_row.id = v_request_id
    and expense_row.data_environment = 'test';

  perform pg_catalog.set_config('request.jwt.claim.sub', v_supervisor_auth_user_id::text, true);
  perform pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object(
      'sub', v_supervisor_auth_user_id,
      'role', 'authenticated',
      'email', v_supervisor_email
    )::text,
    true
  );

  if (public.current_finance_user()).id is distinct from v_supervisor_id then
    raise exception 'Authenticated release canary supervisor identity did not resolve exactly';
  end if;

  execute 'set local role authenticated';
  if current_user <> 'authenticated' then
    raise exception 'Authenticated release canary could not assume the supervisor database role';
  end if;
  v_action_result := public.finance_expense_act_active_step(
    array[v_request_id],
    'return',
    'finance-release-canary-return',
    '正式發布回滾測試退回',
    '[]'::jsonb,
    null,
    pg_catalog.jsonb_build_object(
      v_request_id,
      pg_catalog.jsonb_build_object(
        'active_step_index', 1,
        'role_key', 'direct_supervisor',
        'finance_user_id', v_supervisor_id,
        'email', '',
        'status', v_expense.status,
        'step', v_expense.step,
        'ver', v_expense.ver,
        'updated_at', v_expense.updated_at
      )
    ),
    '{}'::jsonb,
    'test'
  );
  execute 'reset role';
  if coalesce((v_action_result ->> 'ok')::boolean, false) is not true then
    raise exception 'Authenticated release canary supervisor return failed';
  end if;

  perform pg_catalog.set_config('request.jwt.claim.sub', v_applicant_auth_user_id::text, true);
  perform pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object(
      'sub', v_applicant_auth_user_id,
      'role', 'authenticated',
      'email', v_applicant_email
    )::text,
    true
  );

  select expense_row.* into strict v_expense
  from public.expense_requests expense_row
  where expense_row.tenant_id = v_tenant_id
    and expense_row.id = v_request_id
    and expense_row.data_environment = 'test'
  for update;

  v_active_index := private.finance_income_active_step_index(v_expense.steps);
  v_active_step := v_expense.steps -> v_active_index;
  if v_active_index is distinct from 1
     or private.finance_income_step_role(v_active_step) <> 'applicant_revision'
     or v_active_step ->> 'uid' is distinct from v_applicant_id then
    raise exception 'Authenticated release canary did not create the applicant revision step';
  end if;

  v_active_step := private.finance_income_append_step_action(
    v_active_step,
    v_applicant_id,
    v_applicant_name,
    '簽核通過',
    '正式發布回滾測試重送',
    '[]'::jsonb
  ) || pg_catalog.jsonb_build_object(
    'a', 'approved',
    'n', v_applicant_name,
    't', pg_catalog.to_char(current_date, 'MM/DD')
  );
  v_resubmitted_steps := pg_catalog.jsonb_set(
    v_expense.steps,
    array[v_active_index::text],
    v_active_step,
    false
  );
  v_state := pg_catalog.jsonb_build_object(
    'status', private.finance_income_status_from_steps(v_resubmitted_steps) ->> 'approval_status',
    'step', (private.finance_income_status_from_steps(v_resubmitted_steps) ->> 'approval_step')::integer,
    'steps', v_resubmitted_steps,
    'form_payload', v_expense.form_payload,
    'actual_files', v_expense.actual_files
  );

  execute 'set local role authenticated';
  if current_user <> 'authenticated' then
    raise exception 'Authenticated release canary could not assume the applicant resubmit database role';
  end if;
  v_result := public.finance_resubmit_expense_request(
    v_request_id,
    v_state,
    v_org_unit_id,
    v_entity_code,
    v_actor_requests
  );
  execute 'reset role';
  if coalesce((v_result ->> 'ok')::boolean, false) is not true
     or v_result ->> 'form_id' is distinct from v_request_id then
    raise exception 'Authenticated release canary resubmit did not return the expected result';
  end if;

  select expense_row.* into strict v_expense
  from public.expense_requests expense_row
  where expense_row.tenant_id = v_tenant_id
    and expense_row.id = v_request_id
    and expense_row.data_environment = 'test';

  if private.finance_income_step_role(
       v_expense.steps -> private.finance_income_active_step_index(v_expense.steps)
     ) <> 'direct_supervisor'
     or v_expense.status <> 'pending_section_chief' then
    raise exception 'Authenticated release canary resubmit did not restore the supervisor route';
  end if;

  if exists (
    select 1
    from public.notification_delivery_events event_row
    where event_row.tenant_id = v_tenant_id
      and (
        event_row.request_id = v_request_no
        or event_row.payload ->> 'source_id' = v_request_id
      )
  ) then
    raise exception 'Authenticated release canary unexpectedly enqueued a notification';
  end if;
end;
$canary$;
-- FINANCE_AUTHENTICATED_CANARY_CORE_END

rollback;

-- FINANCE_AUTHENTICATED_CANARY_ROLLBACK_CHECK_BEGIN
do $rollback_check$
begin
  if exists (
    select 1
    from public.expense_requests expense_row
    where expense_row.id = '__finance_release_canary_u8__'
  ) then
    raise exception 'Authenticated release canary rollback left a request row behind';
  end if;
  if exists (
    select 1
    from public.notification_delivery_events event_row
    where event_row.request_id = 'CANARY-ROLLBACK-U8'
       or event_row.payload ->> 'source_id' = '__finance_release_canary_u8__'
  ) then
    raise exception 'Authenticated release canary rollback left a notification behind';
  end if;
  if exists (
    select 1
    from public.cash_movement_evidence_links evidence_row
    where evidence_row.tenant_id = '00000000-0000-0000-0000-000000000001'::uuid
      and evidence_row.data_environment = 'test'
      and evidence_row.source_table = 'expense_requests'
      and (
        evidence_row.source_id = '__finance_release_canary_u8__'
        or evidence_row.source_no = 'CANARY-ROLLBACK-U8'
      )
  ) then
    raise exception 'Authenticated release canary rollback left cash evidence behind';
  end if;
  if exists (
    select 1
    from public.approval_step_actor_snapshots snapshot_row
    where snapshot_row.tenant_id = '00000000-0000-0000-0000-000000000001'::uuid
      and snapshot_row.data_environment = 'test'
      and snapshot_row.record_type = 'expense_requests'
      and (
        snapshot_row.record_id = '__finance_release_canary_u8__'
        or snapshot_row.record_no = 'CANARY-ROLLBACK-U8'
      )
  ) then
    raise exception 'Authenticated release canary rollback left approval snapshots behind';
  end if;
  if exists (
    select 1
    from private.finance_income_document_operations operation_row
    where operation_row.tenant_id = '00000000-0000-0000-0000-000000000001'::uuid
      and operation_row.data_environment = 'test'
      and operation_row.operation_type = 'expense_action'
      and operation_row.idempotency_key = 'finance-release-canary-return'
  ) then
    raise exception 'Authenticated release canary rollback left its idempotency record behind';
  end if;
end;
$rollback_check$;
-- FINANCE_AUTHENTICATED_CANARY_ROLLBACK_CHECK_END

select pg_catalog.jsonb_build_object(
  'ok', true,
  'canary', 'authenticated_submit_return_resubmit',
  'rolled_back', true,
  'notifications_enqueued', false
) as authenticated_canary_result;
