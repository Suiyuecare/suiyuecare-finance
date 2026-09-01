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
  v_xu_request_id constant text := '__finance_release_canary_xu_jingwen__';
  v_xu_request_no constant text := 'CANARY-ROLLBACK-XU-JINGWEN';
  v_xu_applicant_id constant text := 'u_1779419399401';
  v_xu_applicant_name constant text := '徐靖雯';
  v_xu_applicant_email constant text := 'project_hsu@suiyuecare.com';
  v_xu_auth_user_id constant uuid := 'f7e30d6a-c693-4cc7-bd16-49b57fbdd6c5';
  v_xu_department_code constant text := 'B1302';
  v_xu_entity_code constant text := 'E5';
  v_org_unit_id uuid;
  v_xu_org_unit_id uuid;
  v_steps jsonb;
  v_actor_requests jsonb;
  v_revision_payload jsonb;
  v_revision_patch jsonb;
  v_form jsonb;
  v_stale_form jsonb;
  v_result jsonb;
  v_replay_result jsonb;
  v_action_result jsonb;
  v_expense public.expense_requests%rowtype;
  v_forged_expense public.expense_requests%rowtype;
  v_active_index integer;
  v_active_step jsonb;
  v_forged_direct_resolution jsonb;
  v_forged_manager_resolution jsonb;
  v_forged_direct_uid text;
  v_forged_manager_uid text;
  v_forged_steps jsonb;
  v_history_probe_steps jsonb;
  v_history_guard_result jsonb;
  v_forged_manager_self_skip_rejected boolean := false;
  v_forged_future_actor_rejected boolean := false;
  v_legacy_manager_marker_fresh_rejected boolean := false;
  v_stale_page_rejected boolean := false;
  v_forged_future_index integer;
  v_previous_write_context text;
  v_shareholder_guard_result jsonb;
  v_claim_worker_is_definer boolean;
  v_claim_worker_source_sha256 text;
  v_claim_probe_count integer;
  v_xu_steps jsonb;
  v_xu_actor_requests jsonb;
  v_xu_form jsonb;
  v_xu_stale_form jsonb;
  v_xu_result jsonb;
  v_xu_direct_resolution jsonb;
  v_xu_manager_resolution jsonb;
  v_xu_direct_uid text;
  v_xu_manager_uid text;
  v_xu_stale_page_rejected boolean := false;
begin
  if exists (
    select 1
    from public.expense_requests expense_row
    where expense_row.tenant_id = v_tenant_id
      and expense_row.id = v_request_id
  ) then
    raise exception 'Authenticated release canary id already exists; refusing to overwrite data';
  end if;
  if exists (
    select 1
    from public.expense_requests expense_row
    where expense_row.tenant_id = v_tenant_id
      and expense_row.id in (
        v_xu_request_id,
        '__finance_release_canary_xu_stale_tab__'
      )
  ) then
    raise exception '徐靖雯 authenticated release canary id already exists; refusing to overwrite data';
  end if;

  if pg_catalog.to_regprocedure(
       'public.claim_approval_notification_delivery_events(integer,text,integer)'
     ) is null
     or pg_catalog.to_regclass(
       'private.approval_notification_assignment_state'
     ) is null then
    raise exception 'Authenticated release canary notification worker prerequisites are missing';
  end if;
  select proc_row.prosecdef,
         pg_catalog.encode(
           extensions.digest(proc_row.prosrc::bytea, 'sha256'),
           'hex'
         )
    into v_claim_worker_is_definer, v_claim_worker_source_sha256
  from pg_catalog.pg_proc proc_row
  where proc_row.oid =
    'public.claim_approval_notification_delivery_events(integer,text,integer)'::regprocedure::oid;
  if v_claim_worker_source_sha256 is distinct from
       '5f70ec460e9dcc611419097e28084d1916b0ca2bf908e25d35a4aa55d8f437a0'
     or not exists (
       select 1
       from pg_catalog.pg_proc proc_row
       where proc_row.oid =
         'public.claim_approval_notification_delivery_events(integer,text,integer)'::regprocedure::oid
         and pg_catalog.pg_get_userbyid(proc_row.proowner) = 'postgres'
         and proc_row.proacl::text =
           '{postgres=X/postgres,service_role=X/postgres}'
         and (
           (
             proc_row.prosecdef
             and proc_row.proconfig = array['search_path=""']::text[]
           )
           or (
             not proc_row.prosecdef
             and proc_row.proconfig =
               array['search_path=pg_catalog, public']::text[]
           )
         )
     )
     or pg_catalog.has_function_privilege(
       'public',
       'public.claim_approval_notification_delivery_events(integer,text,integer)'::regprocedure,
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'anon',
       'public.claim_approval_notification_delivery_events(integer,text,integer)'::regprocedure,
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'authenticated',
       'public.claim_approval_notification_delivery_events(integer,text,integer)'::regprocedure,
       'EXECUTE'
     )
     or not pg_catalog.has_function_privilege(
       'service_role',
       'public.claim_approval_notification_delivery_events(integer,text,integer)'::regprocedure,
       'EXECUTE'
     )
     or pg_catalog.has_table_privilege(
       'service_role',
       'private.approval_notification_assignment_state',
       'SELECT'
     ) then
    raise exception 'Authenticated release canary notification worker contract drifted';
  end if;
  -- Before v3, the reviewed invoker baseline is accepted so the pre-mutation
  -- canary can run. During rehearsal and after v3, exercise the real
  -- service_role worker call; the enclosing canary transaction rolls any
  -- claimed row back.
  if v_claim_worker_is_definer then
    execute 'set local role service_role';
    if current_user <> 'service_role' then
      raise exception 'Authenticated release canary could not assume notification worker role';
    end if;
    select pg_catalog.count(*)::integer
      into v_claim_probe_count
    from public.claim_approval_notification_delivery_events(
      1,
      'finance_release_authenticated_rollback_probe',
      900
    );
    execute 'reset role';
    if v_claim_probe_count not between 0 and 1 then
      raise exception 'Authenticated release canary notification worker returned an invalid claim count';
    end if;
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
      'c', '申請人上一層級主管與申請人部門主任為同一位；前一關簽核通過時，系統會同步通過本關並直接送往下一關。',
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
      'rk', 'cashier', 'uid', v_ceo_id,
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
    pg_catalog.jsonb_build_object('step_key', 'cashier', 'finance_user_id', v_ceo_id),
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

  v_revision_payload := pg_catalog.jsonb_build_object(
    'requestPurpose', '正式發布前身分與送件回滾測試',
    'requestNote', '正式發布前身分與送件回滾測試',
    'receiptType', '免憑證',
    'paymentType', '銀行轉帳',
    'isFixedExpense', false,
    'is_fixed_expense', false,
    'lazyRows', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'item', '正式發布回滾測試',
        'qty', 1,
        'unitPrice', 100,
        'netAmount', 100,
        'taxAmount', 0,
        'grossAmount', 100,
        'total', 100,
        'taxMode', 'exempt',
        'systemFee', false
      )
    ),
    'refundRows', '[]'::jsonb,
    'purchaseRows', '[]'::jsonb,
    'hrRows', '[]'::jsonb,
    'hrItem', '',
    'pettyMode', '',
    'passbookFiles', '[]'::jsonb,
    'travelInfo', '{}'::jsonb,
    'refundInfo', '{}'::jsonb,
    'purchaseInfo', '{}'::jsonb,
    'hrInfo', '{}'::jsonb
  );

  v_revision_patch := pg_catalog.jsonb_build_object(
    'amount', 100,
    'description', '正式發布前身分與送件回滾測試',
    'payee', '正式發布回滾測試收款人',
    'bank_type', 'mega',
    'bank_name', '兆豐銀行',
    'bank_branch', '正式發布回滾測試分行',
    'bank_no', '0170000000',
    'expected_pay_date', (current_date + 7)::text,
    'bank_account', '000000000000',
    'fee_bearer', '己方支出',
    'request_date', current_date::text,
    'files', '[]'::jsonb,
    'petty_mode', '',
    'form_payload', v_revision_payload
  );

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
    'payee', '正式發布回滾測試收款人',
    'bank_type', 'mega',
    'bank_name', '兆豐銀行',
    'bank_branch', '正式發布回滾測試分行',
    'bank_no', '0170000000',
    'expected_pay_date', current_date + 7,
    'bank_account', '000000000000',
    'fee_bearer', '己方支出',
    'status', 'pending_section_chief',
    'step', 2,
    'request_date', current_date,
    'files', '[]'::jsonb,
    'actual_files', '[]'::jsonb,
    'steps', v_steps,
    'form_payload', v_revision_payload || pg_catalog.jsonb_build_object(
      'submissionAttemptId', 'finance-release-canary-attempt-u8'
    ),
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

  -- The same canary runs immediately before and after each migration. Exercise
  -- the v3 retry contract only while v3 is installed, so the v2 pre-migration
  -- canary remains a valid compatibility proof.
  if pg_catalog.to_regprocedure(
       'private.finance_expense_assert_authoritative_route_v3(uuid,text,text,text,numeric,jsonb,jsonb,jsonb,boolean)'
     ) is not null then
    -- A tab opened before the v3 client contract is unsafe to retry after an
    -- ambiguous timeout.  The database must fail it closed before writing.
    v_stale_form := pg_catalog.jsonb_set(
      pg_catalog.jsonb_set(
        v_form #- '{form_payload,submissionAttemptId}',
        '{id}',
        pg_catalog.to_jsonb('__finance_release_canary_stale_tab__'::text),
        false
      ),
      '{no}',
      pg_catalog.to_jsonb('CANARY-STALE-TAB'::text),
      false
    );
    begin
      execute 'set local role authenticated';
      perform public.finance_submit_expense_request(
        v_stale_form,
        v_org_unit_id,
        v_entity_code,
        v_actor_requests
      );
      execute 'reset role';
      raise exception 'Authenticated release canary accepted a stale tab without submissionAttemptId';
    exception when sqlstate '55000' then
      execute 'reset role';
      v_stale_page_rejected := true;
    end;
    if not v_stale_page_rejected
       or exists (
         select 1 from public.expense_requests expense_row
         where expense_row.tenant_id=v_tenant_id
           and expense_row.id='__finance_release_canary_stale_tab__'
       ) then
      raise exception 'Authenticated release canary stale-tab rejection did not fail closed';
    end if;

    -- shareholder_standard is a valid v2-authoritative route with no
    -- direct_supervisor or dept_manager. The focused v3 guard must be a no-op,
    -- not a new template requirement.
    v_shareholder_guard_result := private.finance_expense_assert_dept_manager_autoskip_v3(
      v_tenant_id,
      v_applicant_id,
      v_department_code,
      pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('rk', 'admin_director', 'uid', v_supervisor_id),
        pg_catalog.jsonb_build_object('rk', 'accountant', 'uid', v_accountant_id),
        pg_catalog.jsonb_build_object('rk', 'ceo', 'uid', v_ceo_id)
      ),
      false
    );
    if coalesce((v_shareholder_guard_result ->> 'dept_manager_step_present')::boolean, true)
       or coalesce((v_shareholder_guard_result ->> 'auto_skip_validated')::boolean, true) then
      raise exception 'Authenticated release canary blocked shareholder_standard without a manager stage';
    end if;

    execute 'set local role authenticated';
    v_replay_result := public.finance_submit_expense_request(
      v_form,
      v_org_unit_id,
      v_entity_code,
      v_actor_requests
    );
    execute 'reset role';
    if coalesce((v_replay_result ->> 'ok')::boolean, false) is not true
       or coalesce((v_replay_result ->> 'idempotent_replay')::boolean, false) is not true
       or v_replay_result ->> 'form_id' is distinct from v_request_id
       or (select pg_catalog.count(*) from public.expense_requests expense_row
           where expense_row.tenant_id = v_tenant_id
             and expense_row.id = v_request_id) <> 1 then
      raise exception 'Authenticated release canary idempotent replay failed';
    end if;

    begin
      execute 'set local role authenticated';
      perform public.finance_submit_expense_request(
        pg_catalog.jsonb_set(v_form, '{description}', '"changed retry payload"'::jsonb, false),
        v_org_unit_id,
        v_entity_code,
        v_actor_requests
      );
      execute 'reset role';
      raise exception 'Authenticated release canary accepted a changed payload for the same attempt';
    exception when unique_violation then
      execute 'reset role';
    end;

    begin
      execute 'set local role authenticated';
      perform public.finance_submit_expense_request(
        pg_catalog.jsonb_set(
          v_form,
          '{form_payload,submissionAttemptId}',
          '"finance-release-canary-other-attempt"'::jsonb,
          false
        ),
        v_org_unit_id,
        v_entity_code,
        v_actor_requests
      );
      execute 'reset role';
      raise exception 'Authenticated release canary accepted another attempt for the same request id';
    exception when unique_violation then
      execute 'reset role';
    end;

    -- A real active applicant-revision row still carries this exact legacy
    -- duplicate-manager comment. History must remain resubmittable, while the
    -- same legacy marker is forbidden on a fresh submission.
    perform private.finance_expense_assert_dept_manager_autoskip_v3(
      v_tenant_id,
      v_applicant_id,
      v_department_code,
      pg_catalog.jsonb_set(
        v_steps,
        '{2,c}',
        pg_catalog.to_jsonb(
          '申請人上一層級主管與部門主管為同一位；前一關簽核通過時，系統會同步通過本關並直接送往下一關。'::text
        ),
        false
      ),
      true
    );
    begin
      perform private.finance_expense_assert_dept_manager_autoskip_v3(
        v_tenant_id,
        v_applicant_id,
        v_department_code,
        pg_catalog.jsonb_set(
          v_steps,
          '{2,c}',
          pg_catalog.to_jsonb(
            '申請人上一層級主管與部門主管為同一位；前一關簽核通過時，系統會同步通過本關並直接送往下一關。'::text
          ),
          false
        ),
        false
      );
    exception when sqlstate '42501' then
      v_legacy_manager_marker_fresh_rejected := true;
    end;
    if not v_legacy_manager_marker_fresh_rejected then
      raise exception 'Authenticated release canary accepted the legacy manager marker on a fresh submission';
    end if;

    -- Regression for the v2 cross-department manager-role bypass: u5 has a
    -- manager role elsewhere, but may not self-skip A1100 unless A1100's
    -- published canonical manager is actually u5. The focused v3 guard must
    -- reject the forged submitted manager UID with SQLSTATE 42501.
    perform pg_catalog.set_config(
      'request.jwt.claim.sub', v_supervisor_auth_user_id::text, true
    );
    perform pg_catalog.set_config(
      'request.jwt.claims',
      pg_catalog.jsonb_build_object(
        'sub', v_supervisor_auth_user_id,
        'role', 'authenticated',
        'email', v_supervisor_email
      )::text,
      true
    );
    if (public.current_finance_user()).id is distinct from 'u5' then
      raise exception 'Authenticated release canary u5 identity did not resolve exactly';
    end if;
    v_forged_direct_resolution := public.finance_org_resolve_actor(
      'direct_supervisor', 'u5', 'A1100', 'direct_supervisor', null
    );
    v_forged_manager_resolution := public.finance_org_resolve_actor(
      'dept_manager', 'u5', 'A1100', 'dept_manager', null
    );
    if coalesce((v_forged_direct_resolution ->> 'ok')::boolean, false) is not true
       or pg_catalog.jsonb_array_length(
            coalesce(v_forged_direct_resolution -> 'candidates', '[]'::jsonb)
          ) = 0
       or coalesce((v_forged_manager_resolution ->> 'ok')::boolean, false) is not true
       or pg_catalog.jsonb_array_length(
            coalesce(v_forged_manager_resolution -> 'candidates', '[]'::jsonb)
          ) <> 1 then
      raise exception 'Authenticated release canary u5/A1100 authority fixture is unavailable';
    end if;
    v_forged_direct_uid := coalesce(
      nullif(v_forged_direct_resolution -> 'candidates' -> 0 ->> 'effective_finance_user_id', ''),
      nullif(v_forged_direct_resolution -> 'candidates' -> 0 ->> 'finance_user_id', '')
    );
    v_forged_manager_uid := coalesce(
      nullif(v_forged_manager_resolution -> 'candidates' -> 0 ->> 'effective_finance_user_id', ''),
      nullif(v_forged_manager_resolution -> 'candidates' -> 0 ->> 'finance_user_id', '')
    );
    if v_forged_direct_uid is null
       or v_forged_manager_uid is null
       or v_forged_manager_uid = 'u5'
       or not public.finance_user_is_approval_identity_ready(
         v_tenant_id, v_forged_direct_uid
       )
       or not public.finance_user_is_approval_identity_ready(
         v_tenant_id, v_forged_manager_uid
       ) then
      raise exception 'Authenticated release canary u5/A1100 no longer represents a forged manager self-skip';
    end if;
    v_forged_steps := pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'rk', 'direct_supervisor', 'uid', v_forged_direct_uid,
        'a', '', 'c', '', 'n', '', 't', ''
      ),
      pg_catalog.jsonb_build_object(
        'rk', 'dept_manager', 'uid', 'u5',
        'a', 'approved', 'autoSkip', true,
        'autoSkipReason', 'canonical_actor_is_applicant',
        'n', '系統自動跳關', 't', '',
        'c', '系統依正式角色解析結果自動跳過：此關簽核人與申請人相同。'
      )
    );
    begin
      perform private.finance_expense_assert_dept_manager_autoskip_v3(
        v_tenant_id, 'u5', 'A1100', v_forged_steps, false
      );
    exception when sqlstate '42501' then
      v_forged_manager_self_skip_rejected := true;
    end;
    if not v_forged_manager_self_skip_rejected then
      raise exception 'Authenticated release canary accepted forged u5/A1100 manager self-skip';
    end if;
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

  -- Prove the real 10-argument browser RPC rejects a forged future assignee.
  -- The BEGIN/EXCEPTION block is a subtransaction, so the fixture mutation is
  -- guaranteed to roll back before the positive path below.
  if pg_catalog.to_regprocedure(
       'private.finance_expense_assert_applicant_revision_future_route_v3(uuid,text,text,text,numeric,jsonb,jsonb,integer)'
     ) is not null then
    -- Completed history is immutable: organization changes must not re-resolve
    -- its actor UIDs, and amount-controlled admin/CEO roles that are no longer
    -- required must not invalidate the current, still-pending canonical suffix.
    v_history_probe_steps := pg_catalog.jsonb_build_array(
      v_steps -> 0,
      pg_catalog.jsonb_set(
        pg_catalog.jsonb_set(v_steps -> 1, '{a}', '"approved"'::jsonb, false),
        '{uid}', pg_catalog.to_jsonb(v_accountant_id), false
      ),
      pg_catalog.jsonb_set(v_steps -> 2, '{uid}', pg_catalog.to_jsonb(v_accountant_id), false),
      pg_catalog.jsonb_set(
        pg_catalog.jsonb_set(v_steps -> 3, '{a}', '"approved"'::jsonb, false),
        '{uid}', pg_catalog.to_jsonb(v_accountant_id), false
      ),
      v_active_step,
      v_steps -> 4,
      v_steps -> 6,
      v_steps -> 7,
      v_steps -> 8
    );
    v_history_guard_result := private.finance_expense_assert_applicant_revision_future_route_v3(
      v_tenant_id,
      v_applicant_id,
      'payment_request',
      v_department_code,
      0,
      v_revision_payload,
      v_history_probe_steps,
      4
    );
    if coalesce((v_history_guard_result ->> 'historical_prefix_preserved')::boolean, false)
         is not true
       or coalesce((v_history_guard_result ->> 'future_steps_validated')::integer, 0) <> 4 then
      raise exception 'Authenticated release canary revalidated immutable completed history';
    end if;

    select (step_row.ordinality - 1)::integer
      into v_forged_future_index
    from pg_catalog.jsonb_array_elements(v_expense.steps)
      with ordinality step_row(value, ordinality)
    where private.finance_income_step_role(step_row.value)='accountant'
      and coalesce(step_row.value ->> 'a', '')=''
    order by step_row.ordinality
    limit 1;
    if v_forged_future_index is null then
      raise exception 'Authenticated release canary future-accountant fixture is unavailable';
    end if;
    begin
      v_previous_write_context := coalesce(
        pg_catalog.current_setting('app.finance_expense_write_context', true),
        ''
      );
      perform pg_catalog.set_config(
        'app.finance_expense_write_context', 'org_resubmit', true
      );
      update public.expense_requests expense_row
      set steps=pg_catalog.jsonb_set(
        expense_row.steps,
        array[v_forged_future_index::text, 'uid'],
        pg_catalog.to_jsonb(v_supervisor_id),
        false
      )
      where expense_row.tenant_id=v_tenant_id
        and expense_row.data_environment='test'
        and expense_row.id=v_request_id;
      perform pg_catalog.set_config(
        'app.finance_expense_write_context', v_previous_write_context, true
      );
      select expense_row.* into strict v_forged_expense
      from public.expense_requests expense_row
      where expense_row.tenant_id=v_tenant_id
        and expense_row.data_environment='test'
        and expense_row.id=v_request_id;
      execute 'set local role authenticated';
      perform public.finance_expense_resubmit_applicant_revision(
        v_request_id,
        'resubmit',
        'finance-release-canary-revision-forged-future',
        v_forged_expense.ver,
        v_forged_expense.updated_at,
        v_active_index,
        '正式發布回滾測試偽造未來簽核人',
        v_revision_patch,
        '[]'::jsonb,
        'test'
      );
      execute 'reset role';
      raise exception 'Authenticated release canary accepted a forged future assignee through the actual RPC';
    exception when sqlstate '42501' then
      v_forged_future_actor_rejected := true;
    end;
    if not v_forged_future_actor_rejected then
      raise exception 'Authenticated release canary actual RPC did not reject the forged future assignee';
    end if;
    select expense_row.* into strict v_expense
    from public.expense_requests expense_row
    where expense_row.tenant_id=v_tenant_id
      and expense_row.data_environment='test'
      and expense_row.id=v_request_id;
  end if;

  execute 'set local role authenticated';
  if current_user <> 'authenticated' then
    raise exception 'Authenticated release canary could not assume the applicant resubmit database role';
  end if;
  v_result := public.finance_expense_resubmit_applicant_revision(
    v_request_id,
    'resubmit',
    'finance-release-canary-revision-resubmit',
    v_expense.ver,
    v_expense.updated_at,
    v_active_index,
    '正式發布回滾測試重送',
    v_revision_patch,
    '[]'::jsonb,
    'test'
  );
  execute 'reset role';
  if coalesce((v_result ->> 'ok')::boolean, false) is not true
     or v_result ->> 'id' is distinct from v_request_id then
    raise exception 'Authenticated release canary resubmit did not return the expected result';
  end if;

  -- The same key and payload must replay through the original business
  -- operation cache even though the row is no longer at applicant_revision.
  execute 'set local role authenticated';
  v_replay_result := public.finance_expense_resubmit_applicant_revision(
    v_request_id,
    'resubmit',
    'finance-release-canary-revision-resubmit',
    v_expense.ver,
    v_expense.updated_at,
    v_active_index,
    '正式發布回滾測試重送',
    v_revision_patch,
    '[]'::jsonb,
    'test'
  );
  execute 'reset role';
  if coalesce((v_replay_result ->> 'ok')::boolean, false) is not true
     or coalesce((v_replay_result ->> 'idempotent_replay')::boolean, false) is not true
     or v_replay_result ->> 'id' is distinct from v_request_id then
    raise exception 'Authenticated release canary actual applicant-revision replay failed';
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

  -- Exact 徐靖雯 production identity proof: resolve B1302/E5 authority under
  -- her authenticated UUID, reject a stale pre-v3 tab, then create a complete
  -- rollback-only request through the same public submit endpoint.
  perform pg_catalog.set_config('request.jwt.claim.sub', v_xu_auth_user_id::text, true);
  perform pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object(
      'sub', v_xu_auth_user_id,
      'role', 'authenticated',
      'email', v_xu_applicant_email
    )::text,
    true
  );
  if (public.current_finance_user()).id is distinct from v_xu_applicant_id
     or (public.current_finance_user()).department_code is distinct from v_xu_department_code
     or (public.current_finance_user()).entity_id is distinct from v_xu_entity_code then
    raise exception '徐靖雯 authenticated release canary identity did not resolve exactly';
  end if;
  v_xu_direct_resolution := public.finance_org_resolve_actor(
    'direct_supervisor', v_xu_applicant_id, v_xu_department_code,
    'direct_supervisor', null
  );
  v_xu_manager_resolution := public.finance_org_resolve_actor(
    'dept_manager', v_xu_applicant_id, v_xu_department_code,
    'dept_manager', null
  );
  if coalesce((v_xu_direct_resolution ->> 'ok')::boolean, false) is not true
     or pg_catalog.jsonb_array_length(
          coalesce(v_xu_direct_resolution -> 'candidates', '[]'::jsonb)
        ) <> 1
     or coalesce((v_xu_manager_resolution ->> 'ok')::boolean, false) is not true
     or pg_catalog.jsonb_array_length(
          coalesce(v_xu_manager_resolution -> 'candidates', '[]'::jsonb)
        ) <> 1 then
    raise exception '徐靖雯 B1302 route actors are missing or ambiguous';
  end if;
  v_xu_direct_uid := coalesce(
    nullif(v_xu_direct_resolution -> 'candidates' -> 0 ->> 'effective_finance_user_id', ''),
    nullif(v_xu_direct_resolution -> 'candidates' -> 0 ->> 'finance_user_id', '')
  );
  v_xu_manager_uid := coalesce(
    nullif(v_xu_manager_resolution -> 'candidates' -> 0 ->> 'effective_finance_user_id', ''),
    nullif(v_xu_manager_resolution -> 'candidates' -> 0 ->> 'finance_user_id', '')
  );
  if v_xu_direct_uid is null
     or v_xu_manager_uid is null
     or v_xu_direct_uid is distinct from v_xu_manager_uid
     or not public.finance_user_is_approval_identity_ready(v_tenant_id, v_xu_direct_uid) then
    raise exception '徐靖雯 B1302 duplicate-manager authority fixture drifted';
  end if;

  select unit_row.value ->> 'id'
    into v_xu_org_unit_id
  from private.finance_membership_org_versions_v1 version_row
  cross join lateral pg_catalog.jsonb_array_elements(version_row.snapshot -> 'units') unit_row(value)
  where version_row.tenant_id = v_tenant_id
    and version_row.status = 'published'
    and (version_row.effective_at is null or version_row.effective_at <= pg_catalog.now())
    and unit_row.value ->> 'code' = v_xu_department_code
    and coalesce((unit_row.value ->> 'active')::boolean, false)
    and coalesce((unit_row.value ->> 'is_posting_unit')::boolean, false)
    and coalesce(unit_row.value -> 'entity_codes', '[]'::jsonb) ? v_xu_entity_code
  order by version_row.published_at desc nulls last, version_row.updated_at desc
  limit 1;
  if v_xu_org_unit_id is null then
    raise exception '徐靖雯 B1302 posting unit is unavailable';
  end if;

  v_xu_steps := pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object(
      'a', 'approved', 'c', '徐靖雯發布前回滾測試送件', 'n', v_xu_applicant_name,
      'r', '申請人送件', 't', pg_catalog.to_char(current_date, 'YYYY/MM/DD'),
      'rk', 'applicant_submit', 'uid', v_xu_applicant_id, 'status', 'submitted'
    ),
    pg_catalog.jsonb_build_object(
      'a', '', 'c', '', 'n', '', 'r', '申請人主管', 't', '',
      'rk', 'direct_supervisor', 'uid', v_xu_direct_uid,
      'files', '[]'::jsonb, 'status', 'pending_section_chief'
    ),
    pg_catalog.jsonb_build_object(
      'a', 'approved',
      'c', '申請人上一層級主管與申請人部門主任為同一位；前一關簽核通過時，系統會同步通過本關並直接送往下一關。',
      'n', '系統自動跳關', 'r', '申請人部門主任', 't', '',
      'rk', 'dept_manager', 'uid', v_xu_manager_uid,
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
      'rk', 'cashier', 'uid', v_ceo_id,
      'files', '[]'::jsonb, 'status', 'pending_cashier'
    ),
    pg_catalog.jsonb_build_object(
      'a', '', 'c', '', 'n', '', 'r', '申請人確認', 't', '',
      'rk', 'applicant_confirm', 'uid', v_xu_applicant_id,
      'files', '[]'::jsonb, 'status', 'pending_applicant_confirm'
    ),
    pg_catalog.jsonb_build_object(
      'a', '', 'c', '', 'n', '', 'r', '會計確認入帳', 't', '',
      'rk', 'accountant_final', 'uid', v_accountant_id,
      'files', '[]'::jsonb, 'status', 'pending_voucher'
    )
  );
  v_xu_actor_requests := pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object('step_key', 'direct_supervisor', 'finance_user_id', v_xu_direct_uid),
    pg_catalog.jsonb_build_object('step_key', 'admin_director', 'finance_user_id', v_supervisor_id),
    pg_catalog.jsonb_build_object('step_key', 'accountant', 'finance_user_id', v_accountant_id),
    pg_catalog.jsonb_build_object('step_key', 'ceo', 'finance_user_id', v_ceo_id),
    pg_catalog.jsonb_build_object('step_key', 'cashier', 'finance_user_id', v_ceo_id),
    pg_catalog.jsonb_build_object('step_key', 'applicant_confirm', 'finance_user_id', v_xu_applicant_id),
    pg_catalog.jsonb_build_object('step_key', 'accountant_final', 'finance_user_id', v_accountant_id)
  );
  v_xu_form := pg_catalog.jsonb_build_object(
    'id', v_xu_request_id, 'no', v_xu_request_no,
    'entity_id', v_xu_entity_code, 'department_code', v_xu_department_code,
    'applicant', v_xu_applicant_name, 'applicant_id', v_xu_applicant_id,
    'applicant_email', v_xu_applicant_email,
    'type', 'payment_request', 'type_label', '付款申請',
    'amount', 100, 'description', '徐靖雯正式發布前身分與送件回滾測試',
    'payee', '徐靖雯發布回滾測試收款人',
    'bank_type', 'mega', 'bank_name', '兆豐銀行',
    'bank_branch', '正式發布回滾測試分行', 'bank_no', '0170000000',
    'expected_pay_date', current_date + 7, 'bank_account', '000000000000',
    'fee_bearer', '己方支出', 'status', 'pending_section_chief', 'step', 2,
    'request_date', current_date, 'files', '[]'::jsonb,
    'actual_files', '[]'::jsonb, 'steps', v_xu_steps,
    'form_payload', v_revision_payload || pg_catalog.jsonb_build_object(
      'submissionAttemptId', 'finance-release-canary-attempt-xu-jingwen'
    ),
    'data_environment', 'test'
  );
  if pg_catalog.to_regprocedure(
       'private.finance_expense_assert_authoritative_route_v3(uuid,text,text,text,numeric,jsonb,jsonb,jsonb,boolean)'
     ) is not null then
    v_xu_stale_form := pg_catalog.jsonb_set(
      pg_catalog.jsonb_set(
        v_xu_form #- '{form_payload,submissionAttemptId}', '{id}',
        pg_catalog.to_jsonb('__finance_release_canary_xu_stale_tab__'::text), false
      ),
      '{no}', pg_catalog.to_jsonb('CANARY-XU-STALE-TAB'::text), false
    );
    begin
      execute 'set local role authenticated';
      perform public.finance_submit_expense_request(
        v_xu_stale_form, v_xu_org_unit_id, v_xu_entity_code,
        v_xu_actor_requests
      );
      execute 'reset role';
      raise exception '徐靖雯 stale-tab canary was accepted without submissionAttemptId';
    exception when sqlstate '55000' then
      execute 'reset role';
      v_xu_stale_page_rejected := true;
    end;
    if not v_xu_stale_page_rejected then
      raise exception '徐靖雯 stale-tab canary did not fail closed';
    end if;
  end if;
  execute 'set local role authenticated';
  v_xu_result := public.finance_submit_expense_request(
    v_xu_form, v_xu_org_unit_id, v_xu_entity_code, v_xu_actor_requests
  );
  execute 'reset role';
  if coalesce((v_xu_result ->> 'ok')::boolean, false) is not true
     or v_xu_result ->> 'form_id' is distinct from v_xu_request_id
     or not exists (
       select 1 from public.expense_requests expense_row
       where expense_row.tenant_id=v_tenant_id
         and expense_row.data_environment='test'
         and expense_row.id=v_xu_request_id
         and expense_row.applicant_id=v_xu_applicant_id
         and expense_row.department_code=v_xu_department_code
         and expense_row.entity_id=v_xu_entity_code
     ) then
    raise exception '徐靖雯 authenticated public submit canary failed';
  end if;

  if exists (
    select 1
    from public.notification_delivery_events event_row
    where event_row.tenant_id = v_tenant_id
      and (
        event_row.request_id in (v_request_no, v_xu_request_no)
        or event_row.payload ->> 'source_id' in (v_request_id, v_xu_request_id)
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
    where expense_row.id in (
      '__finance_release_canary_u8__',
      '__finance_release_canary_stale_tab__',
      '__finance_release_canary_xu_jingwen__',
      '__finance_release_canary_xu_stale_tab__'
    )
  ) then
    raise exception 'Authenticated release canary rollback left a request row behind';
  end if;
  if exists (
    select 1
    from public.notification_delivery_events event_row
    where event_row.request_id in (
            'CANARY-ROLLBACK-U8',
            'CANARY-ROLLBACK-XU-JINGWEN'
          )
       or event_row.payload ->> 'source_id' in (
            '__finance_release_canary_u8__',
            '__finance_release_canary_xu_jingwen__'
          )
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
        evidence_row.source_id in (
          '__finance_release_canary_u8__',
          '__finance_release_canary_xu_jingwen__'
        )
        or evidence_row.source_no in (
          'CANARY-ROLLBACK-U8',
          'CANARY-ROLLBACK-XU-JINGWEN'
        )
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
        snapshot_row.record_id in (
          '__finance_release_canary_u8__',
          '__finance_release_canary_xu_jingwen__'
        )
        or snapshot_row.record_no in (
          'CANARY-ROLLBACK-U8',
          'CANARY-ROLLBACK-XU-JINGWEN'
        )
      )
  ) then
    raise exception 'Authenticated release canary rollback left approval snapshots behind';
  end if;
  if exists (
    select 1
    from private.finance_income_document_operations operation_row
    where operation_row.tenant_id = '00000000-0000-0000-0000-000000000001'::uuid
      and operation_row.data_environment = 'test'
      and (
        (
          operation_row.operation_type = 'expense_action'
          and operation_row.idempotency_key = 'finance-release-canary-return'
        )
        or (
          operation_row.operation_type = 'expense_applicant_revision'
          and operation_row.idempotency_key in (
            'finance-release-canary-revision-forged-future',
            'finance-release-canary-revision-resubmit'
          )
        )
      )
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
  'notifications_enqueued', false,
  'notification_worker_contract_verified', true
) as authenticated_canary_result;
