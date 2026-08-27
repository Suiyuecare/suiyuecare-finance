-- Forward-only correction for the v2 expense route authority contract.
-- v3 re-resolves every department-manager auto-skip from the published
-- organization and makes an ambiguous submit retry idempotent only for the
-- same authenticated applicant, request id, submission attempt, and payload.
-- The pinned release guard owns the migration + ledger transaction.
set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $preflight$
declare
  v_oid oid;
  v_definition text;
  v_source_sha256 text;
  v_definition_sha256 text;
begin
  if to_regprocedure('private.finance_expense_assert_authoritative_route_v2(uuid,text,text,text,numeric,jsonb,jsonb,jsonb,boolean)') is null
     or to_regprocedure('private.finance_submit_expense_request_v1_unsafe(jsonb,uuid,text,jsonb)') is null
     or to_regprocedure('private.finance_resubmit_expense_request_v1_unsafe(text,jsonb,uuid,text,jsonb)') is null
     or to_regprocedure('public.finance_submit_expense_request(jsonb,uuid,text,jsonb)') is null
     or to_regprocedure('public.finance_resubmit_expense_request(text,jsonb,uuid,text,jsonb)') is null
     or to_regprocedure('public.finance_expense_resubmit_applicant_revision(text,text,text,integer,timestamptz,integer,text,jsonb,jsonb,text)') is null
     or to_regprocedure('public.claim_approval_notification_delivery_events(integer,text,integer)') is null
     or to_regprocedure('public.finance_org_resolve_actor(text,text,text,text,text)') is null
     or to_regclass('private.approval_notification_assignment_state') is null
     or to_regprocedure('extensions.digest(bytea,text)') is null then
    raise exception 'expense route authority v3 prerequisites are missing';
  end if;
  if to_regprocedure('private.finance_expense_assert_authoritative_route_v3(uuid,text,text,text,numeric,jsonb,jsonb,jsonb,boolean)') is not null
     or to_regprocedure('private.finance_expense_assert_dept_manager_autoskip_v3(uuid,text,text,jsonb,boolean)') is not null
     or to_regprocedure('private.finance_expense_assert_applicant_revision_future_route_v3(uuid,text,text,text,numeric,jsonb,jsonb,integer)') is not null
     or to_regprocedure('private.finance_expense_submission_payload_sha256_v3(jsonb,uuid,text)') is not null
     or to_regprocedure('private.finance_expense_idempotent_replay_result_v3(public.expense_requests)') is not null
     or to_regprocedure('private.finance_expense_resubmit_applicant_revision_v1_unsafe(text,text,text,integer,timestamptz,integer,text,jsonb,jsonb,text)') is not null then
    raise exception 'expense route authority v3 is already installed';
  end if;

  -- This service-only notification worker was deployed as SECURITY INVOKER,
  -- but its reviewed body reads a private assignment-state table that is and
  -- must remain postgres-only.  Pin the exact production body, signature,
  -- owner, search path and ACL before changing only the execution context.
  select pg_catalog.encode(
           extensions.digest(proc_row.prosrc::bytea, 'sha256'),
           'hex'
         ),
         pg_catalog.encode(
           extensions.digest(
             pg_catalog.convert_to(
               pg_catalog.pg_get_functiondef(proc_row.oid),
               'UTF8'
             ),
             'sha256'
           ),
           'hex'
         )
    into v_source_sha256, v_definition_sha256
  from pg_catalog.pg_proc proc_row
  where proc_row.oid =
    'public.claim_approval_notification_delivery_events(integer,text,integer)'::regprocedure::oid;
  if v_source_sha256 is distinct from
       '5f70ec460e9dcc611419097e28084d1916b0ca2bf908e25d35a4aa55d8f437a0'
     or v_definition_sha256 is distinct from
       '718831e956151360ff813565c91808c4390b160c83bd72554de71ad8259e5d06'
     or not exists (
       select 1
       from pg_catalog.pg_proc proc_row
       where proc_row.oid =
         'public.claim_approval_notification_delivery_events(integer,text,integer)'::regprocedure::oid
         and pg_catalog.pg_get_userbyid(proc_row.proowner) = 'postgres'
         and not proc_row.prosecdef
         and proc_row.proconfig =
           array['search_path=pg_catalog, public']::text[]
         and proc_row.proacl::text =
           '{postgres=X/postgres,service_role=X/postgres}'
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
     ) then
    raise exception 'approval notification claim worker is not the reviewed invoker baseline';
  end if;
  if not exists (
       select 1
       from pg_catalog.pg_class relation_row
       where relation_row.oid =
         'private.approval_notification_assignment_state'::regclass
         and relation_row.relkind = 'r'
         and pg_catalog.pg_get_userbyid(relation_row.relowner) = 'postgres'
         and relation_row.relacl::text =
           '{postgres=arwdDxtm/postgres}'
         and not relation_row.relrowsecurity
         and not relation_row.relforcerowsecurity
     )
     or pg_catalog.has_table_privilege(
       'service_role',
       'private.approval_notification_assignment_state',
       'SELECT'
     )
     or pg_catalog.has_table_privilege(
       'authenticated',
       'private.approval_notification_assignment_state',
       'SELECT'
     )
     or pg_catalog.has_table_privilege(
       'anon',
       'private.approval_notification_assignment_state',
       'SELECT'
     ) then
    raise exception 'private approval notification assignment-state ACL drifted';
  end if;

  foreach v_oid in array array[
    'public.finance_submit_expense_request(jsonb,uuid,text,jsonb)'::regprocedure::oid,
    'public.finance_resubmit_expense_request(text,jsonb,uuid,text,jsonb)'::regprocedure::oid,
    'public.finance_expense_resubmit_applicant_revision(text,text,text,integer,timestamptz,integer,text,jsonb,jsonb,text)'::regprocedure::oid
  ] loop
    if not exists (
      select 1 from pg_catalog.pg_proc
      where oid = v_oid
        and pg_catalog.pg_get_userbyid(proowner) = 'postgres'
        and prosecdef
        and proconfig = array['search_path=""']::text[]
    )
       or pg_catalog.has_function_privilege('public', v_oid, 'EXECUTE')
       or pg_catalog.has_function_privilege('anon', v_oid, 'EXECUTE')
       or not pg_catalog.has_function_privilege('authenticated', v_oid, 'EXECUTE')
       or not pg_catalog.has_function_privilege('service_role', v_oid, 'EXECUTE') then
      raise exception 'expense route authority v3 public wrapper preflight ACL failed';
    end if;
  end loop;
  select pg_catalog.encode(
           extensions.digest(proc_row.prosrc::bytea, 'sha256'),
           'hex'
         )
    into v_source_sha256
  from pg_catalog.pg_proc proc_row
  where proc_row.oid =
    'public.finance_expense_resubmit_applicant_revision(text,text,text,integer,timestamptz,integer,text,jsonb,jsonb,text)'::regprocedure::oid;
  if v_source_sha256 is distinct from
       '012297096ad81638aae4fc26e9fe23a2009e576a5bff5a67ae3166eff9cac17e' then
    raise exception 'actual applicant-revision RPC is not the reviewed production baseline';
  end if;
  select pg_catalog.encode(
           extensions.digest(
             pg_catalog.convert_to(
               pg_catalog.pg_get_functiondef(proc_row.oid),
               'UTF8'
             ),
             'sha256'
           ),
           'hex'
         )
    into v_definition_sha256
  from pg_catalog.pg_proc proc_row
  where proc_row.oid =
    'public.finance_expense_resubmit_applicant_revision(text,text,text,integer,timestamptz,integer,text,jsonb,jsonb,text)'::regprocedure::oid;
  if v_definition_sha256 is distinct from
       'e9a1cc1fa6a5679f615950886427b5f7c31081c323a319f8f75be8068dfb2bbb' then
    raise exception 'actual applicant-revision RPC signature/defaults/return contract drifted';
  end if;
  foreach v_oid in array array[
    'private.finance_expense_assert_authoritative_route_v2(uuid,text,text,text,numeric,jsonb,jsonb,jsonb,boolean)'::regprocedure::oid,
    'private.finance_submit_expense_request_v1_unsafe(jsonb,uuid,text,jsonb)'::regprocedure::oid,
    'private.finance_resubmit_expense_request_v1_unsafe(text,jsonb,uuid,text,jsonb)'::regprocedure::oid
  ] loop
    if not exists (
      select 1 from pg_catalog.pg_proc
      where oid = v_oid
        and pg_catalog.pg_get_userbyid(proowner) = 'postgres'
        and prosecdef
        and proconfig = array['search_path=""']::text[]
    )
       or pg_catalog.has_function_privilege('public', v_oid, 'EXECUTE')
       or pg_catalog.has_function_privilege('anon', v_oid, 'EXECUTE')
       or pg_catalog.has_function_privilege('authenticated', v_oid, 'EXECUTE')
       or pg_catalog.has_function_privilege('service_role', v_oid, 'EXECUTE') then
      raise exception 'expense route authority v3 private v2 baseline ACL failed';
    end if;
  end loop;
  v_definition := pg_catalog.pg_get_functiondef(
    'public.finance_submit_expense_request(jsonb,uuid,text,jsonb)'::regprocedure
  );
  if v_definition not ilike '%private.finance_expense_assert_authoritative_route_v2%'
     or v_definition not ilike '%private.finance_submit_expense_request_v1_unsafe%' then
    raise exception 'public submit wrapper is not the reviewed v2 baseline';
  end if;
  v_definition := pg_catalog.pg_get_functiondef(
    'public.finance_resubmit_expense_request(text,jsonb,uuid,text,jsonb)'::regprocedure
  );
  if v_definition not ilike '%private.finance_expense_assert_authoritative_route_v2%'
     or v_definition not ilike '%private.finance_resubmit_expense_request_v1_unsafe%' then
    raise exception 'public resubmit wrapper is not the reviewed v2 baseline';
  end if;
end;
$preflight$;

-- The body is fully schema-qualified and its source hash is pinned above.
-- SECURITY DEFINER is therefore a narrow bridge for the service-only worker;
-- the private table itself remains inaccessible to every API role.
alter function public.claim_approval_notification_delivery_events(
  integer,text,integer
) security definer;
alter function public.claim_approval_notification_delivery_events(
  integer,text,integer
) set search_path = '';
revoke all on function public.claim_approval_notification_delivery_events(
  integer,text,integer
) from public, anon, authenticated;
grant execute on function public.claim_approval_notification_delivery_events(
  integer,text,integer
) to postgres, service_role;

-- Exercise the real service_role call while forcing any claimed row back in a
-- PL/pgSQL subtransaction.  A permission failure is not caught and aborts the
-- migration; the synthetic exception only rolls back a successful probe.
set local role service_role;
do $notification_claim_worker_canary$
begin
  begin
    perform 1
    from public.claim_approval_notification_delivery_events(
      1,
      'finance_release_v3_rollback_probe',
      900
    );
    raise exception 'rollback successful notification claim probe'
      using errcode = 'ZX001';
  exception
    when sqlstate 'ZX001' then null;
  end;
end;
$notification_claim_worker_canary$;
reset role;

create function private.finance_expense_submission_payload_sha256_v3(
  p_form jsonb,
  p_org_unit_id uuid,
  p_legal_entity_code text
) returns text
language plpgsql
immutable
set search_path = ''
as $function$
declare
  v_payload jsonb;
  v_normalized jsonb;
begin
  if pg_catalog.jsonb_typeof(coalesce(p_form, 'null'::jsonb)) <> 'object'
     or p_org_unit_id is null
     or coalesce(pg_catalog.btrim(p_legal_entity_code), '') = '' then
    raise exception '送件冪等契約資料格式不正確' using errcode = '22023';
  end if;
  v_payload := coalesce(p_form -> 'form_payload', '{}'::jsonb)
    - '_submissionPayloadSha256V3';
  v_normalized := (p_form
    - 'created_at' - 'updated_at' - 'ver'
    - 'voucher_id' - 'cash_posted_at' - 'ledger_posted_at'
    - 'posting_locked_at' - 'voided_at')
    || pg_catalog.jsonb_build_object('form_payload', v_payload);
  return pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        v_normalized::text || E'\n' || p_org_unit_id::text || E'\n'
          || pg_catalog.btrim(p_legal_entity_code),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
end;
$function$;

create function private.finance_expense_idempotent_replay_result_v3(
  p_expense public.expense_requests
) returns jsonb
language sql
stable
set search_path = ''
as $function$
  select pg_catalog.jsonb_build_object(
    'ok', true,
    'form_id', p_expense.id,
    'form_no', p_expense.no,
    'row', pg_catalog.to_jsonb(p_expense),
    'approval_runtime', pg_catalog.jsonb_build_object(
      'ok', true,
      'runtime', 'expense_route_authority_v3',
      'idempotent_replay', true
    ),
    'context', pg_catalog.jsonb_build_object(
      'idempotent_replay', true,
      'submission_attempt_id', coalesce(
        p_expense.form_payload ->> 'submissionAttemptId',
        p_expense.form_payload ->> 'submission_attempt_id'
      )
    ),
    'idempotent_replay', true
  );
$function$;

create function private.finance_expense_assert_dept_manager_autoskip_v3(
  p_tenant_id uuid,
  p_applicant_finance_user_id text,
  p_department_code text,
  p_steps jsonb,
  p_allow_history boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_direct_count integer;
  v_manager_count integer;
  v_direct_actual jsonb;
  v_manager_actual jsonb;
  v_direct_resolution jsonb;
  v_manager_resolution jsonb;
  v_candidate jsonb;
  v_direct_uid text;
  v_manager_uid text;
  v_submitted_direct_uid text;
  v_submitted_manager_uid text;
  v_is_auto_skip boolean;
  v_reason text;
  v_name text;
  v_comment text;
  v_time text;
  v_has_skip_residue boolean;
  v_has_valid_history_time boolean := false;
  v_is_applicant_skip boolean;
  v_is_same_actor_skip boolean;
begin
  if p_tenant_id is null
     or nullif(pg_catalog.btrim(p_applicant_finance_user_id), '') is null
     or nullif(pg_catalog.btrim(p_department_code), '') is null
     or pg_catalog.jsonb_typeof(coalesce(p_steps, 'null'::jsonb)) <> 'array' then
    raise exception 'dept_manager 自動跳關驗證資料格式不正確'
      using errcode = '22023';
  end if;

  select pg_catalog.count(*)::integer,
         pg_catalog.min(step_row.value::text)::jsonb
    into v_manager_count, v_manager_actual
  from pg_catalog.jsonb_array_elements(p_steps) step_row(value)
  where private.finance_income_step_role(step_row.value) = 'dept_manager';
  if v_manager_count = 0 then
    -- Some valid v2-authoritative templates (for example shareholder_standard)
    -- intentionally have no department-manager stage. They have nothing for
    -- this focused auto-skip guard to revalidate.
    return pg_catalog.jsonb_build_object(
      'dept_manager_step_present', false,
      'auto_skip_validated', false
    );
  elsif v_manager_count <> 1 then
    raise exception '正式路由最多只能有一個 dept_manager 關卡'
      using errcode = '42501';
  end if;

  v_is_auto_skip := coalesce((v_manager_actual ->> 'autoSkip')::boolean, false);
  v_reason := coalesce(v_manager_actual ->> 'autoSkipReason', '');
  v_name := coalesce(v_manager_actual ->> 'n', '');
  v_comment := coalesce(v_manager_actual ->> 'c', '');
  v_time := coalesce(v_manager_actual ->> 't', '');
  v_has_skip_residue := v_reason <> ''
    or v_manager_actual ? 'autoSkipAudit'
    or v_manager_actual ? 'auto_skip_audit'
    or v_name = '系統自動跳關'
    or v_comment in (
      '系統依正式角色解析結果自動跳過：此關簽核人與申請人相同。',
      '申請人上一層級主管與申請人部門主任為同一位；前一關簽核通過時，系統會同步通過本關並直接送往下一關。',
      '申請人上一層級主管與部門主管為同一位；前一關簽核通過時，系統會同步通過本關並直接送往下一關。',
      '申請人上一層級主管與申請人部門主任為同一位；前一關已核准，系統自動同步通過本關。'
    );
  if not v_is_auto_skip and v_has_skip_residue then
    raise exception 'dept_manager 的 autoSkip=false 仍殘留自動跳關稽核欄位'
      using errcode = '42501';
  end if;
  if not v_is_auto_skip then
    -- v2 has already validated an ordinary manager route. v3 only narrows the
    -- vulnerable client-authored manager auto-skip path.
    return pg_catalog.jsonb_build_object(
      'dept_manager_step_present', true,
      'auto_skip_validated', false
    );
  end if;

  select pg_catalog.count(*)::integer,
         pg_catalog.min(step_row.value::text)::jsonb
    into v_direct_count, v_direct_actual
  from pg_catalog.jsonb_array_elements(p_steps) step_row(value)
  where private.finance_income_step_role(step_row.value) = 'direct_supervisor';
  if v_direct_count <> 1 then
    raise exception 'dept_manager 自動跳關必須恰有一個 direct_supervisor 關卡'
      using errcode = '42501';
  end if;

  -- Resolve both actors again from the published organization. No UID or
  -- snapshot emitted by the client or by v2 is authoritative in this guard.
  v_direct_resolution := public.finance_org_resolve_actor(
    'direct_supervisor',
    p_applicant_finance_user_id,
    p_department_code,
    'direct_supervisor',
    null
  );
  if coalesce((v_direct_resolution ->> 'ok')::boolean, false)
     and pg_catalog.jsonb_array_length(
           coalesce(v_direct_resolution -> 'candidates', '[]'::jsonb)
         ) > 0 then
    v_candidate := v_direct_resolution -> 'candidates' -> 0;
    v_direct_uid := coalesce(
      nullif(v_candidate ->> 'effective_finance_user_id', ''),
      nullif(v_candidate ->> 'finance_user_id', '')
    );
  elsif pg_catalog.jsonb_array_length(
          coalesce(v_direct_resolution -> 'candidates', '[]'::jsonb)
        ) = 0
    and exists (
    select 1
    from public.employee_department_roles role_row
    where role_row.tenant_id = p_tenant_id
      and role_row.finance_user_id = p_applicant_finance_user_id
      and role_row.department_code = p_department_code
      and role_row.active
      and coalesce(role_row.can_approve, true)
      and role_row.role_key = 'ceo'
  ) then
    v_direct_uid := p_applicant_finance_user_id;
  else
    raise exception '正式組織找不到 direct_supervisor 關卡的有效簽核人'
      using errcode = '55000';
  end if;

  v_manager_resolution := public.finance_org_resolve_actor(
    'dept_manager',
    p_applicant_finance_user_id,
    p_department_code,
    'dept_manager',
    null
  );
  if coalesce((v_manager_resolution ->> 'ok')::boolean, false)
     and pg_catalog.jsonb_array_length(
           coalesce(v_manager_resolution -> 'candidates', '[]'::jsonb)
         ) = 1 then
    v_candidate := v_manager_resolution -> 'candidates' -> 0;
    v_manager_uid := coalesce(
      nullif(v_candidate ->> 'effective_finance_user_id', ''),
      nullif(v_candidate ->> 'finance_user_id', '')
    );
  elsif pg_catalog.jsonb_array_length(
          coalesce(v_manager_resolution -> 'candidates', '[]'::jsonb)
        ) > 1 then
    raise exception '正式組織解析出多位 dept_manager，已停止送件'
      using errcode = '55000';
  elsif pg_catalog.jsonb_array_length(
          coalesce(v_manager_resolution -> 'candidates', '[]'::jsonb)
        ) = 0
    and exists (
    select 1
    from public.employee_department_roles role_row
    where role_row.tenant_id = p_tenant_id
      and role_row.finance_user_id = p_applicant_finance_user_id
      and role_row.department_code = p_department_code
      and role_row.active
      and coalesce(role_row.can_approve, true)
      and role_row.role_key = 'ceo'
  ) then
    v_manager_uid := p_applicant_finance_user_id;
  else
    raise exception '正式組織找不到 dept_manager 關卡的唯一有效簽核人'
      using errcode = '55000';
  end if;

  v_submitted_direct_uid := nullif(pg_catalog.btrim(v_direct_actual ->> 'uid'), '');
  v_submitted_manager_uid := nullif(pg_catalog.btrim(v_manager_actual ->> 'uid'), '');
  if v_direct_uid is null
     or v_submitted_direct_uid is distinct from v_direct_uid
     or not public.finance_user_is_approval_identity_ready(
       p_tenant_id, v_direct_uid
     ) then
    raise exception 'direct_supervisor 不是正式組織指定的簽核人'
      using errcode = '42501';
  end if;
  if v_manager_uid is null
     or v_submitted_manager_uid is distinct from v_manager_uid
     or not public.finance_user_is_approval_identity_ready(
       p_tenant_id, v_manager_uid
     ) then
    raise exception 'dept_manager 不是該部門唯一的正式主管'
      using errcode = '42501';
  end if;
  perform 1
  from public.finance_users user_row
  where user_row.tenant_id = p_tenant_id
    and user_row.id in (v_direct_uid, v_manager_uid)
    and user_row.active
  group by user_row.tenant_id
  having pg_catalog.count(distinct user_row.id) =
    case when v_direct_uid = v_manager_uid then 1 else 2 end;
  if not found then
    raise exception '正式直屬主管或部門主管已停用'
      using errcode = '55000';
  end if;

  if v_time <> '' then
    begin
      perform v_time::pg_catalog.timestamptz;
      v_has_valid_history_time := true;
    exception when others then
      v_has_valid_history_time := false;
    end;
  end if;

  v_is_applicant_skip := v_manager_uid = p_applicant_finance_user_id
    and coalesce(v_manager_actual ->> 'a', '') = 'approved'
    and v_reason = 'canonical_actor_is_applicant'
    and v_name = '系統自動跳關'
    and v_time = ''
    and v_comment =
      '系統依正式角色解析結果自動跳過：此關簽核人與申請人相同。';

  v_is_same_actor_skip := v_direct_uid = v_manager_uid
    and coalesce(v_manager_actual ->> 'a', '') = 'approved'
    and v_name = '系統自動跳關'
    and (
      (
        v_reason = 'same_direct_supervisor_and_dept_manager'
        and v_comment in (
          '申請人上一層級主管與申請人部門主任為同一位；前一關簽核通過時，系統會同步通過本關並直接送往下一關。',
          '申請人上一層級主管與部門主管為同一位；前一關簽核通過時，系統會同步通過本關並直接送往下一關。'
        )
        and (
          (not p_allow_history and v_time = '' and v_comment =
            '申請人上一層級主管與申請人部門主任為同一位；前一關簽核通過時，系統會同步通過本關並直接送往下一關。')
          or (p_allow_history and (v_time = '' or v_has_valid_history_time))
        )
      )
      or (
        p_allow_history
        and v_reason = 'same_direct_supervisor_and_dept_manager_runtime'
        and v_comment =
          '申請人上一層級主管與申請人部門主任為同一位；前一關已核准，系統自動同步通過本關。'
        and v_has_valid_history_time
      )
    );

  if v_manager_uid = p_applicant_finance_user_id then
    if not v_is_applicant_skip then
      raise exception 'dept_manager 申請人自動跳關標記不完整或不是正式部門主管'
        using errcode = '42501';
    end if;
  elsif not v_is_same_actor_skip then
    raise exception 'dept_manager 只有在正式直屬主管與正式部門主管為同一人且稽核標記正確時才能自動跳關'
      using errcode = '42501';
  end if;

  return pg_catalog.jsonb_build_object(
    'direct_supervisor_finance_user_id', v_direct_uid,
    'dept_manager_finance_user_id', v_manager_uid,
    'auto_skip_validated', true
  );
end;
$function$;

create function private.finance_expense_assert_authoritative_route_v3(
  p_tenant_id uuid,
  p_applicant_finance_user_id text,
  p_request_type text,
  p_department_code text,
  p_amount numeric,
  p_form_payload jsonb,
  p_steps jsonb,
  p_actor_requests jsonb,
  p_allow_history boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_route jsonb;
  v_manager_guard jsonb;
begin
  v_route := private.finance_expense_assert_authoritative_route_v2(
    p_tenant_id,
    p_applicant_finance_user_id,
    p_request_type,
    p_department_code,
    p_amount,
    p_form_payload,
    p_steps,
    p_actor_requests,
    p_allow_history
  );

  v_manager_guard := private.finance_expense_assert_dept_manager_autoskip_v3(
    p_tenant_id,
    p_applicant_finance_user_id,
    p_department_code,
    p_steps,
    p_allow_history
  );

  return v_route || pg_catalog.jsonb_build_object(
    'runtime', 'expense_route_authority_v3',
    'dept_manager_authority', v_manager_guard
  );
end;
$function$;

-- Applicant revision is an in-place edit of a locked, already-audited route.
-- Completed prefix steps are immutable history and must not be re-assigned when
-- today's organization changes.  The remaining template suffix, however, must
-- still match today's published template and every not-yet-executed actor must
-- resolve uniquely from today's formal organization.
create function private.finance_expense_assert_applicant_revision_future_route_v3(
  p_tenant_id uuid,
  p_applicant_finance_user_id text,
  p_request_type text,
  p_department_code text,
  p_amount numeric,
  p_form_payload jsonb,
  p_steps jsonb,
  p_active_index integer
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_templates jsonb;
  v_policy jsonb;
  v_template jsonb;
  v_template_count integer;
  v_expected_steps jsonb := '[]'::jsonb;
  v_expected_step jsonb;
  v_actual_step jsonb;
  v_active_step jsonb;
  v_resolution jsonb;
  v_direct_resolution jsonb;
  v_candidate jsonb;
  v_key text;
  v_actual_key text;
  v_kind text;
  v_role_key text;
  v_actor_ref text;
  v_expected_uid text;
  v_actual_uid text;
  v_direct_uid text;
  v_threshold numeric;
  v_fixed boolean;
  v_required boolean;
  v_insert_index integer;
  v_expected_index integer := 0;
  v_actual_index integer;
  v_historical_key_count integer;
  v_historical_anchor_index integer;
  v_candidate_count integer;
  v_validated_count integer := 0;
  v_is_auto_skip boolean;
  v_is_operational_self boolean;
begin
  if p_tenant_id is null
     or nullif(pg_catalog.btrim(p_applicant_finance_user_id), '') is null
     or nullif(pg_catalog.btrim(p_request_type), '') is null
     or nullif(pg_catalog.btrim(p_department_code), '') is null
     or pg_catalog.jsonb_typeof(coalesce(p_form_payload, 'null'::jsonb)) <> 'object'
     or pg_catalog.jsonb_typeof(coalesce(p_steps, 'null'::jsonb)) <> 'array'
     or p_active_index is null
     or p_active_index < 0
     or p_active_index >= pg_catalog.jsonb_array_length(p_steps) then
    raise exception '補件未來路由驗證資料格式不正確'
      using errcode = '22023';
  end if;

  v_active_step := p_steps -> p_active_index;
  if private.finance_income_step_role(v_active_step) <> 'applicant_revision'
     or coalesce(v_active_step ->> 'uid', '') <> p_applicant_finance_user_id
     or coalesce(v_active_step ->> 'a', '') <> '' then
    raise exception '目前不是原申請人可處理的補件關卡'
      using errcode = '42501';
  end if;

  select setting_row.value into v_templates
  from public.system_settings setting_row
  where setting_row.tenant_id = p_tenant_id
    and setting_row.key = 'workflow_templates'
  for share;
  select setting_row.value into v_policy
  from public.system_settings setting_row
  where setting_row.tenant_id = p_tenant_id
    and setting_row.key = 'approval_routing_policy'
  for share;
  if pg_catalog.jsonb_typeof(v_templates) <> 'array'
     or pg_catalog.jsonb_typeof(v_policy) <> 'object' then
    raise exception '正式簽核流程或金額門檻尚未完成設定'
      using errcode = '55000';
  end if;

  select pg_catalog.count(*)::integer,
         pg_catalog.min(template_row.value::text)::jsonb
    into v_template_count, v_template
  from pg_catalog.jsonb_array_elements(v_templates) template_row(value)
  where coalesce((template_row.value ->> 'enabled')::boolean, true)
    and coalesce(template_row.value -> 'appliesTo', '[]'::jsonb) ? p_request_type
    and pg_catalog.jsonb_typeof(template_row.value -> 'steps') = 'array';
  if v_template_count <> 1 then
    raise exception '補件單據類型 % 必須恰好對應一個正式流程，目前為 % 個',
      p_request_type, v_template_count
      using errcode = '55000';
  end if;
  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(
      coalesce(v_template -> 'conditionalRoutes', '[]'::jsonb)
    ) route_row(value)
    where coalesce((route_row.value ->> 'enabled')::boolean, true)
  ) then
    raise exception '正式流程含尚未發布的伺服器端條件路線，補件已停止'
      using errcode = '55000';
  end if;

  for v_expected_step in
    select step_row.value
    from pg_catalog.jsonb_array_elements(v_template -> 'steps')
      with ordinality step_row(value, ordinality)
    where coalesce((step_row.value ->> 'required')::boolean, true)
    order by step_row.ordinality
  loop
    v_key := pg_catalog.lower(pg_catalog.btrim(coalesce(
      v_expected_step ->> 'key',
      v_expected_step ->> 'rk',
      v_expected_step ->> 'role',
      ''
    )));
    if v_key = '' then
      raise exception '正式補件流程含未命名關卡' using errcode = '55000';
    end if;
    v_expected_steps := v_expected_steps || pg_catalog.jsonb_build_array(
      v_expected_step || pg_catalog.jsonb_build_object('key', v_key)
    );
  end loop;

  v_fixed := pg_catalog.lower(coalesce(
    p_form_payload ->> 'is_fixed_expense',
    p_form_payload ->> 'isFixedExpense',
    'false'
  )) in ('true', '1', 'yes', '是');
  foreach v_key in array array['admin_director', 'ceo'] loop
    v_threshold := coalesce(
      case when v_fixed
        then nullif(v_policy #>> array[v_key, 'fixed_min_amount'], '')::numeric
        else nullif(v_policy #>> array[v_key, 'standard_min_amount'], '')::numeric
      end,
      case when v_fixed
        then nullif(v_policy #>> array[v_key, 'fixed_expense_min_amount'], '')::numeric
        else nullif(v_policy #>> array[v_key, 'min_amount'], '')::numeric
      end,
      10
    );
    v_required := coalesce(p_amount, 0) >= v_threshold;
    if not v_required then
      select coalesce(
               pg_catalog.jsonb_agg(step_row.value order by step_row.ordinality),
               '[]'::jsonb
             )
        into v_expected_steps
      from pg_catalog.jsonb_array_elements(v_expected_steps)
        with ordinality step_row(value, ordinality)
      where pg_catalog.lower(coalesce(step_row.value ->> 'key', '')) <> v_key;
    elsif not exists (
      select 1
      from pg_catalog.jsonb_array_elements(v_expected_steps) step_row(value)
      where pg_catalog.lower(coalesce(step_row.value ->> 'key', '')) = v_key
    ) then
      select coalesce(
               pg_catalog.min(step_row.ordinality)::integer - 1,
               pg_catalog.jsonb_array_length(v_expected_steps)
             )
        into v_insert_index
      from pg_catalog.jsonb_array_elements(v_expected_steps)
        with ordinality step_row(value, ordinality)
      where (v_key = 'admin_director'
             and pg_catalog.lower(coalesce(step_row.value ->> 'key', '')) in (
               'accountant', 'accountant_final', 'accountant_invoice',
               'ceo', 'cashier', 'applicant_confirm',
               'applicant_invoice_delivery'
             ))
         or (v_key = 'ceo'
             and pg_catalog.lower(coalesce(step_row.value ->> 'key', '')) in (
               'cashier', 'accountant_invoice', 'applicant_confirm',
               'applicant_invoice_delivery', 'procurement_receipt',
               'accountant_final'
             ));
      v_expected_steps := pg_catalog.jsonb_insert(
        v_expected_steps,
        array[v_insert_index::text],
        pg_catalog.jsonb_build_object('key', v_key),
        false
      );
    end if;
  end loop;

  if pg_catalog.jsonb_array_length(v_expected_steps) = 0 then
    raise exception '正式補件流程不可為空' using errcode = '55000';
  end if;

  for v_actual_step, v_actual_index in
    select step_row.value, (step_row.ordinality - 1)::integer
    from pg_catalog.jsonb_array_elements(p_steps)
      with ordinality step_row(value, ordinality)
    order by step_row.ordinality
  loop
    v_actual_key := private.finance_income_step_role(v_actual_step);

    if v_actual_key = 'assigned_user' then
      if v_actual_index > p_active_index then
        v_actual_uid := nullif(pg_catalog.btrim(v_actual_step ->> 'uid'), '');
        if coalesce(v_actual_step ->> 'a', '') <> ''
           or coalesce((v_actual_step ->> 'autoSkip')::boolean, false)
           or coalesce(v_actual_step ->> 'autoSkipReason', '') <> ''
           or v_actual_step ? 'autoSkipAudit'
           or v_actual_step ? 'auto_skip_audit'
           or coalesce(v_actual_step ->> 'n', '') = '系統自動跳關'
           or coalesce(v_actual_step ->> 'c', '') in (
             '系統依正式角色解析結果自動跳過：此關簽核人與申請人相同。',
             '申請人上一層級主管與申請人部門主任為同一位；前一關簽核通過時，系統會同步通過本關並直接送往下一關。',
             '申請人上一層級主管與部門主管為同一位；前一關簽核通過時，系統會同步通過本關並直接送往下一關。',
             '申請人上一層級主管與申請人部門主任為同一位；前一關已核准，系統自動同步通過本關。'
           )
           or v_actual_uid is null
           or not public.finance_user_is_approval_identity_ready(
             p_tenant_id, v_actual_uid
           )
           or not exists (
             select 1 from public.finance_users user_row
             where user_row.tenant_id = p_tenant_id
               and user_row.id = v_actual_uid
               and user_row.active
           ) then
          raise exception '補件後的加簽關卡簽核人無效或已被預先處理'
            using errcode = '42501';
        end if;
        v_validated_count := v_validated_count + 1;
      elsif v_actual_index < p_active_index
            and coalesce(v_actual_step ->> 'a', '') = '' then
        raise exception '補件歷史中仍有未完成的加簽關卡'
          using errcode = '55000';
      end if;
      continue;
    end if;

    if v_actual_key in ('applicant_submit', 'applicant_revision') then
      if v_actual_index > p_active_index then
        raise exception '補件未來路由不可預先夾帶新的申請人關卡'
          using errcode = '42501';
      elsif v_actual_index < p_active_index
            and (coalesce(v_actual_step ->> 'uid', '') <> p_applicant_finance_user_id
                 or coalesce(v_actual_step ->> 'a', '') = '') then
        raise exception '補件申請人歷史關卡不完整或已被改派'
          using errcode = '42501';
      end if;
      continue;
    end if;

    if v_actual_index < p_active_index then
      if coalesce(v_actual_step ->> 'a', '') = '' then
        raise exception '補件歷史前綴仍有未完成關卡，請由管理者重建'
          using errcode = '55000';
      end if;

      -- Historical actors and amount-controlled roles are immutable.  Locate
      -- the future suffix only from the last completed role that still exists
      -- exactly once in today's effective template.  A removed historical
      -- role is ignored; no completed UID is re-resolved or compared.
      select pg_catalog.count(*)::integer,
             pg_catalog.min((step_row.ordinality - 1)::integer)
        into v_historical_key_count, v_historical_anchor_index
      from pg_catalog.jsonb_array_elements(v_expected_steps)
        with ordinality step_row(value, ordinality)
      where pg_catalog.lower(coalesce(step_row.value ->> 'key', '')) =
            v_actual_key;
      if v_historical_key_count > 1 then
        raise exception '目前正式流程的歷史定位關卡 % 重複，請由管理者重建',
          v_actual_key using errcode = '55000';
      elsif v_historical_key_count = 1 then
        v_expected_index := pg_catalog.greatest(
          v_expected_index,
          v_historical_anchor_index + 1
        );
      end if;
      continue;
    end if;
    if v_actual_index = p_active_index then
      raise exception '補件 active 關卡不可同時是正式模板關卡'
        using errcode = '55000';
    end if;

    if v_expected_index >= pg_catalog.jsonb_array_length(v_expected_steps) then
      raise exception '既有補件路由比目前正式流程多出 % 關，請由管理者重建',
        v_actual_key using errcode = '55000';
    end if;
    v_expected_step := v_expected_steps -> v_expected_index;
    v_key := pg_catalog.lower(coalesce(v_expected_step ->> 'key', ''));
    if v_actual_key is distinct from v_key then
      raise exception '既有補件路由無法對齊目前正式流程：預期 %，實際為 %，請由管理者重建',
        v_key, v_actual_key using errcode = '55000';
    end if;
    v_expected_index := v_expected_index + 1;

    v_expected_uid := null;
    v_direct_uid := null;
    v_actual_uid := nullif(pg_catalog.btrim(v_actual_step ->> 'uid'), '');
    v_kind := nullif(pg_catalog.lower(pg_catalog.btrim(coalesce(
      v_expected_step ->> 'actorKind',
      v_expected_step ->> 'actor_kind',
      ''
    ))), '');
    if v_kind is null then
      v_kind := case
        when v_key in ('applicant_confirm', 'applicant_invoice_delivery')
          then 'applicant'
        when v_key = 'dept_manager' then 'dept_manager'
        when v_key in ('accountant_final', 'accountant_invoice') then 'accountant'
        when v_key in ('procurement_payment', 'procurement_receipt', 'general_affairs')
          then 'general_affairs'
        when v_key in ('direct_supervisor', 'admin_director', 'accountant', 'ceo', 'cashier')
          then v_key
        else 'finance_role'
      end;
    end if;
    v_role_key := nullif(pg_catalog.lower(pg_catalog.btrim(coalesce(
      v_expected_step ->> 'roleKey',
      v_expected_step ->> 'role_key',
      ''
    ))), '');
    if v_role_key is null then
      v_role_key := case
        when v_key in ('accountant_final', 'accountant_invoice') then 'accountant'
        when v_key in ('procurement_payment', 'procurement_receipt') then 'general_affairs'
        else v_key
      end;
    end if;
    v_actor_ref := nullif(pg_catalog.btrim(coalesce(
      v_expected_step ->> 'actorRef',
      v_expected_step ->> 'actor_ref',
      v_expected_step ->> 'actorId',
      v_expected_step ->> 'actor_id',
      ''
    )), '');
    if v_kind = 'fixed_user' and v_actor_ref is null then
      raise exception '正式流程的 fixed_user 關卡 % 缺少模板 actor_ref', v_key
        using errcode = '55000';
    end if;

    if v_kind = 'applicant'
       or v_key in ('applicant_confirm', 'applicant_invoice_delivery') then
      v_expected_uid := p_applicant_finance_user_id;
    else
      v_resolution := public.finance_org_resolve_actor(
        v_kind,
        p_applicant_finance_user_id,
        p_department_code,
        v_role_key,
        case when v_kind = 'fixed_user' then v_actor_ref else null end
      );
      v_candidate_count := pg_catalog.jsonb_array_length(
        coalesce(v_resolution -> 'candidates', '[]'::jsonb)
      );
      if coalesce((v_resolution ->> 'ok')::boolean, false)
         and v_candidate_count = 1 then
        v_candidate := v_resolution -> 'candidates' -> 0;
        v_expected_uid := coalesce(
          nullif(v_candidate ->> 'effective_finance_user_id', ''),
          nullif(v_candidate ->> 'finance_user_id', '')
        );
      elsif v_candidate_count = 0
            and v_key in ('direct_supervisor', 'dept_manager')
            and exists (
              select 1
              from public.employee_department_roles role_row
              where role_row.tenant_id = p_tenant_id
                and role_row.finance_user_id = p_applicant_finance_user_id
                and role_row.department_code = p_department_code
                and role_row.active
                and coalesce(role_row.can_approve, true)
                and role_row.role_key = 'ceo'
            ) then
        v_expected_uid := p_applicant_finance_user_id;
      else
        raise exception '補件後的 % 關卡正式簽核人缺少或不唯一，請由管理者重建',
          v_key using errcode = '55000';
      end if;
    end if;

    if v_expected_uid is null
       or v_actual_uid is distinct from v_expected_uid
       or not public.finance_user_is_approval_identity_ready(
         p_tenant_id, v_expected_uid
       )
       or not exists (
         select 1 from public.finance_users user_row
         where user_row.tenant_id = p_tenant_id
           and user_row.id = v_expected_uid
           and user_row.active
       ) then
      raise exception '補件後的 % 關卡不是目前正式組織指定的簽核人', v_key
        using errcode = '42501';
    end if;

    v_is_auto_skip := coalesce((v_actual_step ->> 'autoSkip')::boolean, false);
    v_is_operational_self := v_key in (
      'accountant_final', 'accountant_invoice',
      'procurement_payment', 'procurement_receipt',
      'applicant_confirm', 'applicant_invoice_delivery', 'cashier'
    );
    if not v_is_auto_skip
       and (coalesce(v_actual_step ->> 'autoSkipReason', '') <> ''
            or v_actual_step ? 'autoSkipAudit'
            or v_actual_step ? 'auto_skip_audit'
            or coalesce(v_actual_step ->> 'n', '') = '系統自動跳關'
            or coalesce(v_actual_step ->> 'c', '') in (
              '系統依正式角色解析結果自動跳過：此關簽核人與申請人相同。',
              '申請人上一層級主管與申請人部門主任為同一位；前一關簽核通過時，系統會同步通過本關並直接送往下一關。',
              '申請人上一層級主管與部門主管為同一位；前一關簽核通過時，系統會同步通過本關並直接送往下一關。',
              '申請人上一層級主管與申請人部門主任為同一位；前一關已核准，系統自動同步通過本關。'
            )) then
      raise exception '補件後的 % 關卡殘留不一致的自動跳關稽核欄位', v_key
        using errcode = '42501';
    end if;
    if coalesce(v_actual_step ->> 'a', '') = '' then
      if v_is_auto_skip then
        raise exception '補件後的 % 自動跳關不得保持待簽狀態', v_key
          using errcode = '42501';
      elsif v_expected_uid = p_applicant_finance_user_id
         and not v_is_operational_self then
        raise exception '補件後的 % 關卡不可等待申請人自行核准', v_key
          using errcode = '42501';
      end if;
    elsif not v_is_auto_skip then
      raise exception '補件後的未來關卡 % 已被預先處理', v_key
        using errcode = '42501';
    elsif v_is_operational_self then
      raise exception '補件後的作業關卡 % 必須由指定人實際處理，不得自動跳過', v_key
        using errcode = '42501';
    elsif v_expected_uid = p_applicant_finance_user_id then
      if coalesce(v_actual_step ->> 'a', '') <> 'approved'
         or coalesce(v_actual_step ->> 'autoSkipReason', '') <>
              'canonical_actor_is_applicant'
         or coalesce(v_actual_step ->> 'n', '') <> '系統自動跳關'
         or coalesce(v_actual_step ->> 't', '') <> ''
         or coalesce(v_actual_step ->> 'c', '') <>
              '系統依正式角色解析結果自動跳過：此關簽核人與申請人相同。' then
        raise exception '補件後的 % 申請人自動跳關標記不完整', v_key
          using errcode = '42501';
      end if;
    elsif v_key = 'dept_manager' then
      v_direct_resolution := public.finance_org_resolve_actor(
        'direct_supervisor',
        p_applicant_finance_user_id,
        p_department_code,
        'direct_supervisor',
        null
      );
      if coalesce((v_direct_resolution ->> 'ok')::boolean, false)
         and pg_catalog.jsonb_array_length(
           coalesce(v_direct_resolution -> 'candidates', '[]'::jsonb)
         ) = 1 then
        v_candidate := v_direct_resolution -> 'candidates' -> 0;
        v_direct_uid := coalesce(
          nullif(v_candidate ->> 'effective_finance_user_id', ''),
          nullif(v_candidate ->> 'finance_user_id', '')
        );
      elsif pg_catalog.jsonb_array_length(
              coalesce(v_direct_resolution -> 'candidates', '[]'::jsonb)
            ) = 0
            and exists (
              select 1
              from public.employee_department_roles role_row
              where role_row.tenant_id = p_tenant_id
                and role_row.finance_user_id = p_applicant_finance_user_id
                and role_row.department_code = p_department_code
                and role_row.active
                and coalesce(role_row.can_approve, true)
                and role_row.role_key = 'ceo'
            ) then
        v_direct_uid := p_applicant_finance_user_id;
      else
        raise exception '補件後無法唯一解析目前直屬主管，請由管理者重建'
          using errcode = '55000';
      end if;
      if v_direct_uid is distinct from v_expected_uid
         or coalesce(v_actual_step ->> 'a', '') <> 'approved'
         or coalesce(v_actual_step ->> 'autoSkipReason', '') <>
              'same_direct_supervisor_and_dept_manager'
         or coalesce(v_actual_step ->> 'n', '') <> '系統自動跳關'
         or coalesce(v_actual_step ->> 't', '') <> ''
         or coalesce(v_actual_step ->> 'c', '') <>
              '申請人上一層級主管與申請人部門主任為同一位；前一關簽核通過時，系統會同步通過本關並直接送往下一關。' then
        raise exception '補件後的 dept_manager 不符合目前主管重複關卡自動跳關規則'
          using errcode = '42501';
      end if;
    else
      raise exception '補件後的未來關卡 % 不得預先自動跳關', v_key
        using errcode = '42501';
    end if;
    v_validated_count := v_validated_count + 1;
  end loop;

  if v_expected_index <> pg_catalog.jsonb_array_length(v_expected_steps) then
    raise exception '既有補件路由缺少目前正式流程的必要關卡，請由管理者重建'
      using errcode = '55000';
  end if;
  if v_validated_count = 0 then
    raise exception '補件重送後缺少可執行的下一關，請由管理者重建'
      using errcode = '55000';
  end if;

  return pg_catalog.jsonb_build_object(
    'runtime', 'expense_applicant_revision_future_route_v3',
    'historical_prefix_preserved', true,
    'future_steps_validated', v_validated_count,
    'template_steps', pg_catalog.jsonb_array_length(v_expected_steps)
  );
end;
$function$;

create or replace function public.finance_submit_expense_request(
  p_form jsonb,
  p_org_unit_id uuid,
  p_legal_entity_code text,
  p_actor_requests jsonb default '[]'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_tenant_id uuid;
  v_actor public.finance_users%rowtype;
  v_existing public.expense_requests%rowtype;
  v_route jsonb;
  v_form jsonb;
  v_payload jsonb;
  v_attempt_id text;
  v_camel_attempt_id text;
  v_snake_attempt_id text;
  v_payload_sha256 text;
  v_existing_attempt_id text;
  v_existing_payload_sha256 text;
  v_result jsonb;
begin
  if auth.uid() is null then
    raise exception '請先登入後再送出申請' using errcode = '42501';
  end if;
  if pg_catalog.jsonb_typeof(coalesce(p_form, 'null'::jsonb)) <> 'object'
     or pg_catalog.jsonb_typeof(coalesce(p_form -> 'form_payload', '{}'::jsonb)) <> 'object' then
    raise exception '申請資料或送件識別格式不正確' using errcode = '22023';
  end if;

  v_tenant_id := public.current_tenant_id();
  v_actor := public.current_finance_user();
  if v_actor.id is null
     or v_actor.tenant_id is distinct from v_tenant_id
     or p_form ->> 'applicant_id' is distinct from v_actor.id then
    raise exception '申請人必須是目前登入身分' using errcode = '42501';
  end if;

  v_payload := coalesce(p_form -> 'form_payload', '{}'::jsonb);
  v_camel_attempt_id := nullif(pg_catalog.btrim(v_payload ->> 'submissionAttemptId'), '');
  v_snake_attempt_id := nullif(pg_catalog.btrim(v_payload ->> 'submission_attempt_id'), '');
  if v_camel_attempt_id is not null
     and v_snake_attempt_id is not null
     and v_camel_attempt_id is distinct from v_snake_attempt_id then
    raise exception '送件識別碼欄位互相衝突' using errcode = '22023';
  end if;
  v_attempt_id := coalesce(v_camel_attempt_id, v_snake_attempt_id);
  if v_attempt_id is null then
    raise exception '頁面版本已過期，請重新整理後再送出'
      using errcode = '55000';
  end if;
  v_form := p_form;
  if v_attempt_id is not null then
    if pg_catalog.char_length(v_attempt_id) < 16
       or pg_catalog.char_length(v_attempt_id) > 200
       or v_attempt_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$' then
      raise exception 'submissionAttemptId 格式不正確'
        using errcode = '22023';
    end if;
    if coalesce(pg_catalog.btrim(p_form ->> 'id'), '') = '' then
      raise exception '啟用送件重試保護時必須包含穩定的申請單識別碼'
        using errcode = '22023';
    end if;

    v_payload_sha256 := private.finance_expense_submission_payload_sha256_v3(
      p_form, p_org_unit_id, p_legal_entity_code
    );

    select expense_row.*
      into v_existing
    from public.expense_requests expense_row
    where expense_row.tenant_id = v_tenant_id
      and expense_row.id = p_form ->> 'id'
    for key share;
    if found then
      v_existing_attempt_id := coalesce(
        nullif(pg_catalog.btrim(v_existing.form_payload ->> 'submissionAttemptId'), ''),
        nullif(pg_catalog.btrim(v_existing.form_payload ->> 'submission_attempt_id'), '')
      );
      v_existing_payload_sha256 := nullif(
        pg_catalog.btrim(v_existing.form_payload ->> '_submissionPayloadSha256V3'),
        ''
      );
      if v_existing.applicant_id = v_actor.id
         and v_existing_attempt_id = v_attempt_id
         and v_existing_payload_sha256 = v_payload_sha256 then
        return private.finance_expense_idempotent_replay_result_v3(v_existing);
      end if;
      raise exception '相同申請單識別碼已屬於另一個送件內容或送件嘗試'
        using errcode = '23505';
    end if;

    v_payload := v_payload || pg_catalog.jsonb_build_object(
      'submissionAttemptId', v_attempt_id,
      '_submissionPayloadSha256V3', v_payload_sha256
    );
    v_form := pg_catalog.jsonb_set(p_form, '{form_payload}', v_payload, true);
  end if;

  v_route := private.finance_expense_assert_authoritative_route_v3(
    v_tenant_id,
    v_actor.id,
    v_form ->> 'type',
    v_form ->> 'department_code',
    nullif(v_form ->> 'amount', '')::numeric,
    v_payload,
    v_form -> 'steps',
    p_actor_requests,
    false
  );

  begin
    v_result := private.finance_submit_expense_request_v1_unsafe(
      v_form, p_org_unit_id, p_legal_entity_code, p_actor_requests
    );
  exception when unique_violation then
    select expense_row.*
      into v_existing
    from public.expense_requests expense_row
    where expense_row.tenant_id = v_tenant_id
      and expense_row.id = p_form ->> 'id'
    for key share;
    if not found then
      raise;
    end if;
    v_existing_attempt_id := coalesce(
      nullif(pg_catalog.btrim(v_existing.form_payload ->> 'submissionAttemptId'), ''),
      nullif(pg_catalog.btrim(v_existing.form_payload ->> 'submission_attempt_id'), '')
    );
    v_existing_payload_sha256 := nullif(
      pg_catalog.btrim(v_existing.form_payload ->> '_submissionPayloadSha256V3'),
      ''
    );
    if v_existing.applicant_id = v_actor.id
       and v_existing_attempt_id = v_attempt_id
       and v_existing_payload_sha256 = v_payload_sha256 then
      return private.finance_expense_idempotent_replay_result_v3(v_existing);
    end if;
    raise;
  end;

  return v_result || pg_catalog.jsonb_build_object(
    'idempotent_replay', false,
    'approval_runtime', coalesce(v_result -> 'approval_runtime', '{}'::jsonb)
      || pg_catalog.jsonb_build_object('runtime', 'expense_route_authority_v3')
  );
end;
$function$;

create or replace function public.finance_resubmit_expense_request(
  p_form_id text,
  p_form_state jsonb,
  p_org_unit_id uuid,
  p_legal_entity_code text,
  p_actor_requests jsonb default '[]'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_tenant_id uuid;
  v_actor public.finance_users%rowtype;
  v_expense public.expense_requests%rowtype;
  v_active_index integer;
  v_active_step jsonb;
  v_route jsonb;
  v_state jsonb;
  v_payload jsonb;
begin
  if auth.uid() is null then
    raise exception '請先登入後再重新送出' using errcode = '42501';
  end if;
  v_tenant_id := public.current_tenant_id();
  v_actor := public.current_finance_user();
  select expense_row.* into v_expense
  from public.expense_requests expense_row
  where expense_row.tenant_id = v_tenant_id and expense_row.id = p_form_id
  for update;
  if not found then
    raise exception '找不到這張待重新送出的申請單' using errcode = 'P0002';
  end if;
  if v_actor.id is null or v_expense.applicant_id is distinct from v_actor.id then
    raise exception '只有原申請人本人可以重新送出' using errcode = '42501';
  end if;
  v_active_index := private.finance_income_active_step_index(v_expense.steps);
  if v_active_index is null then
    raise exception '已完成的申請單不可重新送出' using errcode = '55000';
  end if;
  v_active_step := v_expense.steps -> v_active_index;
  if private.finance_income_step_role(v_active_step) <> 'applicant_revision'
     or coalesce(v_active_step ->> 'uid', '') <> v_actor.id
     or not private.finance_expense_is_exact_step_transition(
       v_expense.steps,
       p_form_state -> 'steps',
       v_active_index,
       'approved',
       v_actor.id,
       v_actor.name
     ) then
    raise exception '補件重送不得增刪、改派或預先處理其他關卡'
      using errcode = '42501';
  end if;

  v_payload := coalesce(
    p_form_state -> 'form_payload',
    v_expense.form_payload,
    '{}'::jsonb
  );
  if v_expense.form_payload ? 'submissionAttemptId' then
    v_payload := v_payload || pg_catalog.jsonb_build_object(
      'submissionAttemptId', v_expense.form_payload ->> 'submissionAttemptId'
    );
  elsif v_expense.form_payload ? 'submission_attempt_id' then
    v_payload := v_payload || pg_catalog.jsonb_build_object(
      'submission_attempt_id', v_expense.form_payload ->> 'submission_attempt_id'
    );
  end if;
  if v_expense.form_payload ? '_submissionPayloadSha256V3' then
    v_payload := v_payload || pg_catalog.jsonb_build_object(
      '_submissionPayloadSha256V3',
      v_expense.form_payload ->> '_submissionPayloadSha256V3'
    );
  end if;
  v_state := pg_catalog.jsonb_set(p_form_state, '{form_payload}', v_payload, true);

  v_route := private.finance_expense_assert_authoritative_route_v3(
    v_tenant_id,
    v_actor.id,
    v_expense.type,
    v_expense.department_code,
    v_expense.amount,
    v_payload,
    v_state -> 'steps',
    p_actor_requests,
    true
  );
  return private.finance_resubmit_expense_request_v1_unsafe(
    p_form_id, v_state, p_org_unit_id, p_legal_entity_code, p_actor_requests
  );
end;
$function$;

-- The browser applicant-revision flow uses this ten-argument RPC.  Preserve
-- its reviewed business rules and operation cache byte-for-byte as a private
-- delegate; the new public surface adds only the future-route authority gate.
alter function public.finance_expense_resubmit_applicant_revision(
  text,text,text,integer,timestamptz,integer,text,jsonb,jsonb,text
) set schema private;
alter function private.finance_expense_resubmit_applicant_revision(
  text,text,text,integer,timestamptz,integer,text,jsonb,jsonb,text
) rename to finance_expense_resubmit_applicant_revision_v1_unsafe;
revoke all on function private.finance_expense_resubmit_applicant_revision_v1_unsafe(
  text,text,text,integer,timestamptz,integer,text,jsonb,jsonb,text
) from public, anon, authenticated, service_role;

create function public.finance_expense_resubmit_applicant_revision(
  p_request_id text,
  p_action text,
  p_idempotency_key text,
  p_expected_ver integer,
  p_expected_updated_at timestamptz,
  p_expected_active_step_index integer,
  p_comment text default null,
  p_form_patch jsonb default '{}'::jsonb,
  p_step_files jsonb default '[]'::jsonb,
  p_data_environment text default 'production'
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_tenant_id uuid;
  v_actor public.finance_users%rowtype;
  v_expense public.expense_requests%rowtype;
  v_environment text := pg_catalog.lower(coalesce(
    p_data_environment, 'production'
  ));
  v_action text := pg_catalog.lower(coalesce(p_action, ''));
  v_active_index integer;
  v_active_step jsonb;
  v_payload jsonb;
  v_amount numeric;
  v_future_route jsonb;
begin
  -- Cancel and all cached/stale retry cases remain owned by the reviewed
  -- delegate.  Only a first, exact resubmit transition is route-gated here.
  if auth.uid() is not null
     and v_action = 'resubmit'
     and v_environment in ('production', 'test') then
    v_tenant_id := public.current_tenant_id();
    select finance_user.*
      into v_actor
    from public.finance_users finance_user
    where finance_user.tenant_id = v_tenant_id
      and finance_user.auth_user_id = auth.uid()
      and finance_user.active
    order by finance_user.created_at, finance_user.id
    limit 1;

    if found then
      select expense_row.*
        into v_expense
      from public.expense_requests expense_row
      where expense_row.tenant_id = v_tenant_id
        and expense_row.data_environment = v_environment
        and expense_row.id = p_request_id
      for update;

      if found
         and v_expense.applicant_id = v_actor.id
         and v_expense.status = 'pending_applicant_confirm'
         and coalesce(v_expense.ver, 1) = p_expected_ver
         and v_expense.updated_at is not distinct from p_expected_updated_at
         and pg_catalog.jsonb_typeof(coalesce(p_form_patch, 'null'::jsonb)) = 'object'
         and pg_catalog.jsonb_typeof(
               coalesce(p_form_patch -> 'form_payload', '{}'::jsonb)
             ) = 'object' then
        v_active_index := private.finance_income_active_step_index(
          v_expense.steps
        );
        if v_active_index = p_expected_active_step_index then
          v_active_step := v_expense.steps -> v_active_index;
          if private.finance_income_step_role(v_active_step) = 'applicant_revision'
             and coalesce(v_active_step ->> 'uid', '') = v_actor.id
             and coalesce(v_active_step ->> 'a', '') = '' then
            v_payload := coalesce(v_expense.form_payload, '{}'::jsonb)
              || coalesce(p_form_patch -> 'form_payload', '{}'::jsonb);
            begin
              -- Parse the patched value with the same numeric cast accepted by
              -- the delegate (including scientific notation).  Invalid/missing
              -- values are left to the delegate's canonical validation and can
              -- never be route-checked against the old amount.
              v_amount := nullif(p_form_patch ->> 'amount', '')::numeric;
              if v_amount is not null then
                v_future_route :=
                  private.finance_expense_assert_applicant_revision_future_route_v3(
                    v_tenant_id,
                    v_actor.id,
                    v_expense.type,
                    v_expense.department_code,
                    v_amount,
                    v_payload,
                    v_expense.steps,
                    v_active_index
                  );
              end if;
            exception
              when invalid_text_representation or numeric_value_out_of_range then
                null;
            end;
          end if;
        end if;
      end if;
    end if;
  end if;

  return private.finance_expense_resubmit_applicant_revision_v1_unsafe(
    p_request_id,
    p_action,
    p_idempotency_key,
    p_expected_ver,
    p_expected_updated_at,
    p_expected_active_step_index,
    p_comment,
    p_form_patch,
    p_step_files,
    p_data_environment
  );
end;
$function$;

alter function private.finance_expense_submission_payload_sha256_v3(jsonb,uuid,text) owner to postgres;
alter function private.finance_expense_idempotent_replay_result_v3(public.expense_requests) owner to postgres;
alter function private.finance_expense_assert_dept_manager_autoskip_v3(uuid,text,text,jsonb,boolean) owner to postgres;
alter function private.finance_expense_assert_authoritative_route_v3(uuid,text,text,text,numeric,jsonb,jsonb,jsonb,boolean) owner to postgres;
alter function private.finance_expense_assert_applicant_revision_future_route_v3(uuid,text,text,text,numeric,jsonb,jsonb,integer) owner to postgres;
alter function private.finance_expense_resubmit_applicant_revision_v1_unsafe(text,text,text,integer,timestamptz,integer,text,jsonb,jsonb,text) owner to postgres;
alter function public.finance_submit_expense_request(jsonb,uuid,text,jsonb) owner to postgres;
alter function public.finance_resubmit_expense_request(text,jsonb,uuid,text,jsonb) owner to postgres;
alter function public.finance_expense_resubmit_applicant_revision(text,text,text,integer,timestamptz,integer,text,jsonb,jsonb,text) owner to postgres;
revoke all on function private.finance_expense_submission_payload_sha256_v3(jsonb,uuid,text) from public, anon, authenticated, service_role;
revoke all on function private.finance_expense_idempotent_replay_result_v3(public.expense_requests) from public, anon, authenticated, service_role;
revoke all on function private.finance_expense_assert_dept_manager_autoskip_v3(uuid,text,text,jsonb,boolean) from public, anon, authenticated, service_role;
revoke all on function private.finance_expense_assert_authoritative_route_v3(uuid,text,text,text,numeric,jsonb,jsonb,jsonb,boolean) from public, anon, authenticated, service_role;
revoke all on function private.finance_expense_assert_applicant_revision_future_route_v3(uuid,text,text,text,numeric,jsonb,jsonb,integer) from public, anon, authenticated, service_role;
revoke all on function private.finance_expense_resubmit_applicant_revision_v1_unsafe(text,text,text,integer,timestamptz,integer,text,jsonb,jsonb,text) from public, anon, authenticated, service_role;
revoke all on function public.finance_submit_expense_request(jsonb,uuid,text,jsonb) from public, anon, authenticated, service_role;
revoke all on function public.finance_resubmit_expense_request(text,jsonb,uuid,text,jsonb) from public, anon, authenticated, service_role;
revoke all on function public.finance_expense_resubmit_applicant_revision(text,text,text,integer,timestamptz,integer,text,jsonb,jsonb,text) from public, anon, authenticated, service_role;
grant execute on function public.finance_submit_expense_request(jsonb,uuid,text,jsonb) to authenticated, service_role;
grant execute on function public.finance_resubmit_expense_request(text,jsonb,uuid,text,jsonb) to authenticated, service_role;
grant execute on function public.finance_expense_resubmit_applicant_revision(text,text,text,integer,timestamptz,integer,text,jsonb,jsonb,text) to authenticated, service_role;

do $postflight$
declare
  v_oid oid;
  v_definition text;
  v_source_sha256 text;
begin
  select pg_catalog.encode(
           extensions.digest(proc_row.prosrc::bytea, 'sha256'),
           'hex'
         )
    into v_source_sha256
  from pg_catalog.pg_proc proc_row
  where proc_row.oid =
    'public.claim_approval_notification_delivery_events(integer,text,integer)'::regprocedure::oid;
  if v_source_sha256 is distinct from
       '5f70ec460e9dcc611419097e28084d1916b0ca2bf908e25d35a4aa55d8f437a0'
     or not exists (
       select 1
       from pg_catalog.pg_proc proc_row
       where proc_row.oid =
         'public.claim_approval_notification_delivery_events(integer,text,integer)'::regprocedure::oid
         and pg_catalog.pg_get_userbyid(proc_row.proowner) = 'postgres'
         and proc_row.prosecdef
         and proc_row.proconfig = array['search_path=""']::text[]
         and proc_row.proacl::text =
           '{postgres=X/postgres,service_role=X/postgres}'
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
     ) then
    raise exception 'approval notification claim worker privilege repair failed';
  end if;
  if not exists (
       select 1
       from pg_catalog.pg_class relation_row
       where relation_row.oid =
         'private.approval_notification_assignment_state'::regclass
         and pg_catalog.pg_get_userbyid(relation_row.relowner) = 'postgres'
         and relation_row.relacl::text =
           '{postgres=arwdDxtm/postgres}'
     )
     or pg_catalog.has_table_privilege(
       'service_role',
       'private.approval_notification_assignment_state',
       'SELECT'
     ) then
    raise exception 'private approval notification assignment-state table was exposed';
  end if;

  foreach v_oid in array array[
    'public.finance_submit_expense_request(jsonb,uuid,text,jsonb)'::regprocedure::oid,
    'public.finance_resubmit_expense_request(text,jsonb,uuid,text,jsonb)'::regprocedure::oid,
    'public.finance_expense_resubmit_applicant_revision(text,text,text,integer,timestamptz,integer,text,jsonb,jsonb,text)'::regprocedure::oid
  ] loop
    if not exists (
      select 1 from pg_catalog.pg_proc
      where oid = v_oid
        and pg_catalog.pg_get_userbyid(proowner) = 'postgres'
        and prosecdef
        and proconfig = array['search_path=""']::text[]
    )
       or pg_catalog.has_function_privilege('public', v_oid, 'EXECUTE')
       or pg_catalog.has_function_privilege('anon', v_oid, 'EXECUTE')
       or not pg_catalog.has_function_privilege('authenticated', v_oid, 'EXECUTE')
       or not pg_catalog.has_function_privilege('service_role', v_oid, 'EXECUTE') then
      raise exception 'expense route authority v3 public wrapper ACL postflight failed';
    end if;
  end loop;

  foreach v_oid in array array[
    'private.finance_expense_submission_payload_sha256_v3(jsonb,uuid,text)'::regprocedure::oid,
    'private.finance_expense_idempotent_replay_result_v3(public.expense_requests)'::regprocedure::oid
  ] loop
    if not exists (
      select 1 from pg_catalog.pg_proc
      where oid = v_oid
        and pg_catalog.pg_get_userbyid(proowner) = 'postgres'
        and proconfig = array['search_path=""']::text[]
    )
       or pg_catalog.has_function_privilege('public', v_oid, 'EXECUTE')
       or pg_catalog.has_function_privilege('anon', v_oid, 'EXECUTE')
       or pg_catalog.has_function_privilege('authenticated', v_oid, 'EXECUTE')
       or pg_catalog.has_function_privilege('service_role', v_oid, 'EXECUTE') then
      raise exception 'expense route authority v3 private ACL postflight failed';
    end if;
  end loop;

  foreach v_oid in array array[
    'private.finance_expense_assert_dept_manager_autoskip_v3(uuid,text,text,jsonb,boolean)'::regprocedure::oid,
    'private.finance_expense_assert_authoritative_route_v3(uuid,text,text,text,numeric,jsonb,jsonb,jsonb,boolean)'::regprocedure::oid,
    'private.finance_expense_assert_applicant_revision_future_route_v3(uuid,text,text,text,numeric,jsonb,jsonb,integer)'::regprocedure::oid,
    'private.finance_expense_assert_authoritative_route_v2(uuid,text,text,text,numeric,jsonb,jsonb,jsonb,boolean)'::regprocedure::oid,
    'private.finance_submit_expense_request_v1_unsafe(jsonb,uuid,text,jsonb)'::regprocedure::oid,
    'private.finance_resubmit_expense_request_v1_unsafe(text,jsonb,uuid,text,jsonb)'::regprocedure::oid,
    'private.finance_expense_resubmit_applicant_revision_v1_unsafe(text,text,text,integer,timestamptz,integer,text,jsonb,jsonb,text)'::regprocedure::oid
  ] loop
    if not exists (
      select 1 from pg_catalog.pg_proc
      where oid = v_oid
        and pg_catalog.pg_get_userbyid(proowner) = 'postgres'
        and prosecdef
        and proconfig = array['search_path=""']::text[]
    )
       or pg_catalog.has_function_privilege('public', v_oid, 'EXECUTE')
       or pg_catalog.has_function_privilege('anon', v_oid, 'EXECUTE')
       or pg_catalog.has_function_privilege('authenticated', v_oid, 'EXECUTE')
       or pg_catalog.has_function_privilege('service_role', v_oid, 'EXECUTE') then
      raise exception 'expense route authority v3 security-definer private ACL postflight failed';
    end if;
  end loop;

  v_definition := pg_catalog.pg_get_functiondef(
    'private.finance_expense_assert_dept_manager_autoskip_v3(uuid,text,text,jsonb,boolean)'::regprocedure
  );
  if v_definition not ilike '%finance_org_resolve_actor(%''direct_supervisor''%'
     or v_definition not ilike '%finance_org_resolve_actor(%''dept_manager''%'
     or v_definition not ilike '%if v_manager_count = 0 then%'
     or v_definition not ilike '%dept_manager_step_present%'
     or v_definition not ilike '%v_manager_resolution -> ''candidates''% = 1%'
     or v_definition not ilike '%v_submitted_direct_uid is distinct from v_direct_uid%'
     or v_definition not ilike '%v_submitted_manager_uid is distinct from v_manager_uid%'
     or v_definition not ilike '%role_row.department_code = p_department_code%'
     or v_definition not ilike '%same_direct_supervisor_and_dept_manager_runtime%'
     or v_definition not ilike '%申請人上一層級主管與部門主管為同一位%'
     or v_definition not ilike '%autoSkipAudit%'
     or v_definition not ilike '%not p_allow_history%'
     or v_definition not ilike '%errcode = ''42501''%' then
    raise exception 'expense route authority v3 manager guard semantic postflight failed';
  end if;
  v_definition := pg_catalog.pg_get_functiondef(
    'private.finance_expense_assert_authoritative_route_v3(uuid,text,text,text,numeric,jsonb,jsonb,jsonb,boolean)'::regprocedure
  );
  if v_definition not ilike '%private.finance_expense_assert_authoritative_route_v2%'
     or v_definition not ilike '%private.finance_expense_assert_dept_manager_autoskip_v3%' then
    raise exception 'expense route authority v3 composition postflight failed';
  end if;
  v_definition := pg_catalog.pg_get_functiondef(
    'public.finance_submit_expense_request(jsonb,uuid,text,jsonb)'::regprocedure
  );
  if v_definition not ilike '%private.finance_expense_assert_authoritative_route_v3%'
     or v_definition not ilike '%submissionAttemptId%'
     or v_definition not ilike '%idempotent_replay%'
     or v_definition not ilike '%if v_attempt_id is null then%'
     or v_definition not ilike '%頁面版本已過期，請重新整理後再送出%'
     or v_definition not ilike '%private.finance_submit_expense_request_v1_unsafe%'
     or v_definition not ilike '%auth.uid()%' then
    raise exception 'expense route authority v3 submit wrapper postflight failed';
  end if;
  v_definition := pg_catalog.pg_get_functiondef(
    'public.finance_resubmit_expense_request(text,jsonb,uuid,text,jsonb)'::regprocedure
  );
  if v_definition not ilike '%private.finance_expense_assert_authoritative_route_v3%'
     or v_definition not ilike '%_submissionPayloadSha256V3%'
     or v_definition not ilike '%for update%'
     or v_definition not ilike '%auth.uid()%' then
    raise exception 'expense route authority v3 resubmit wrapper postflight failed';
  end if;
  v_definition := pg_catalog.pg_get_functiondef(
    'private.finance_expense_assert_applicant_revision_future_route_v3(uuid,text,text,text,numeric,jsonb,jsonb,integer)'::regprocedure
  );
  if v_definition not ilike '%workflow_templates%'
     or v_definition not ilike '%approval_routing_policy%'
     or v_definition not ilike '%historical_prefix_preserved%'
     or v_definition not ilike '%into v_historical_key_count, v_historical_anchor_index%'
     or v_definition not ilike '%if v_historical_key_count > 1 then%'
     or v_definition not ilike '%v_expected_index := pg_catalog.greatest(%'
     or v_definition not ilike '%v_historical_anchor_index + 1%'
     or v_definition not ilike '%fixed_user%'
     or v_definition not ilike '%case when v_kind = ''fixed_user'' then v_actor_ref else null end%'
     or v_definition not ilike '%v_actual_index < p_active_index%'
     or v_definition not ilike '%v_actual_index > p_active_index%'
     or v_definition not ilike '%future_steps_validated%'
     or v_definition not ilike '%same_direct_supervisor_and_dept_manager%'
     or v_definition not ilike '%finance_user_is_approval_identity_ready%' then
    raise exception 'applicant-revision future-route guard semantic postflight failed';
  end if;
  v_definition := pg_catalog.pg_get_functiondef(
    'public.finance_expense_resubmit_applicant_revision(text,text,text,integer,timestamptz,integer,text,jsonb,jsonb,text)'::regprocedure
  );
  if v_definition not ilike '%p_comment text default null::text%'
     or v_definition not ilike '%p_form_patch jsonb default ''{}''::jsonb%'
     or v_definition not ilike '%p_step_files jsonb default ''[]''::jsonb%'
     or v_definition not ilike '%p_data_environment text default ''production''::text%'
     or v_definition not ilike '%pending_applicant_confirm%'
     or v_definition not ilike '%p_expected_active_step_index%'
     or v_definition not ilike '%private.finance_expense_assert_applicant_revision_future_route_v3%'
     or v_definition not ilike '%private.finance_expense_resubmit_applicant_revision_v1_unsafe%'
     or v_definition not ilike '%for update%' then
    raise exception 'actual applicant-revision public wrapper semantic postflight failed';
  end if;
  select pg_catalog.encode(
           extensions.digest(proc_row.prosrc::bytea, 'sha256'),
           'hex'
         )
    into v_source_sha256
  from pg_catalog.pg_proc proc_row
  where proc_row.oid =
    'private.finance_expense_resubmit_applicant_revision_v1_unsafe(text,text,text,integer,timestamptz,integer,text,jsonb,jsonb,text)'::regprocedure::oid;
  if v_source_sha256 is distinct from
       '012297096ad81638aae4fc26e9fe23a2009e576a5bff5a67ae3166eff9cac17e' then
    raise exception 'private applicant-revision delegate source changed during wrapping';
  end if;
end;
$postflight$;

notify pgrst, 'reload schema';
