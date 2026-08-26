-- Forward-only hardening for the already-published expense submit/resubmit RPCs.
-- The browser may request actors, but the published workflow and DB resolver are
-- the only authority for both route shape and assignee identity.
-- Do not add transaction-control or pipeline-incompatible statements here;
-- the pinned Supabase CLI owns the atomic migration + ledger transaction.
set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $preflight$
begin
  if to_regprocedure('public.finance_submit_expense_request(jsonb,uuid,text,jsonb)') is null
     or to_regprocedure('public.finance_resubmit_expense_request(text,jsonb,uuid,text,jsonb)') is null
     or to_regprocedure('public.finance_org_resolve_actor(text,text,text,text,text)') is null
     or to_regclass('private.finance_membership_org_versions_v1') is null then
    raise exception 'expense route authority prerequisites are missing';
  end if;
  if to_regprocedure('private.finance_expense_assert_authoritative_route_v2(uuid,text,text,text,numeric,jsonb,jsonb,jsonb,boolean)') is not null
     or to_regprocedure('private.finance_submit_expense_request_v1_unsafe(jsonb,uuid,text,jsonb)') is not null
     or to_regprocedure('private.finance_resubmit_expense_request_v1_unsafe(text,jsonb,uuid,text,jsonb)') is not null then
    raise exception 'expense route authority v2 is already installed';
  end if;
  if not exists (
    select 1
    from pg_catalog.pg_attribute attribute_row
    join pg_catalog.pg_attrdef default_row
      on default_row.adrelid = attribute_row.attrelid
     and default_row.adnum = attribute_row.attnum
    where attribute_row.attrelid = 'public.file_attachments'::pg_catalog.regclass
      and attribute_row.attname = 'path'
      and attribute_row.attnum > 0
      and not attribute_row.attisdropped
      and attribute_row.attgenerated = 's'
      and pg_catalog.format_type(attribute_row.atttypid, attribute_row.atttypmod) = 'text'
      and pg_catalog.pg_get_expr(default_row.adbin, default_row.adrelid) = 'storage_path'
  ) then
    raise exception 'v1 attachment compatibility alias is absent or not canonical; refusing an unsafe contract step';
  end if;
end;
$preflight$;

-- Keep the generated read-only alias after route hardening. The candidate uses
-- storage_path exclusively, while retaining this alias prevents a stale tab or
-- independently cached older client from failing on attachment metadata reads.
-- Because it is generated, it cannot become a second write authority.

create function private.finance_expense_assert_authoritative_route_v2(
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
  v_org_version_id uuid;
  v_templates jsonb;
  v_policy jsonb;
  v_template jsonb;
  v_template_count integer;
  v_expected_steps jsonb := '[]'::jsonb;
  v_actual_steps jsonb := '[]'::jsonb;
  v_step jsonb;
  v_actual jsonb;
  v_resolution jsonb;
  v_candidate jsonb;
  v_actor_request jsonb;
  v_key text;
  v_actual_key text;
  v_kind text;
  v_role_key text;
  v_expected_uid text;
  v_actual_uid text;
  v_threshold numeric;
  v_fixed boolean;
  v_required boolean;
  v_index integer;
  v_insert_index integer;
  v_request_count integer;
  v_self_pending_allowed boolean;
  v_is_canonical_self_skip boolean;
  v_snapshots jsonb := '[]'::jsonb;
begin
  if p_tenant_id is null
     or nullif(pg_catalog.btrim(p_applicant_finance_user_id), '') is null
     or nullif(pg_catalog.btrim(p_request_type), '') is null
     or pg_catalog.jsonb_typeof(coalesce(p_form_payload, 'null'::jsonb)) <> 'object'
     or pg_catalog.jsonb_typeof(coalesce(p_steps, 'null'::jsonb)) <> 'array'
     or pg_catalog.jsonb_typeof(coalesce(p_actor_requests, 'null'::jsonb)) <> 'array' then
    raise exception '正式簽核路由驗證資料格式不正確' using errcode = '22023';
  end if;

  select version_row.id
    into v_org_version_id
  from private.finance_membership_org_versions_v1 version_row
  where version_row.tenant_id = p_tenant_id
    and version_row.status = 'published'
    and (version_row.effective_at is null or version_row.effective_at <= pg_catalog.now())
  order by version_row.published_at desc nulls last, version_row.updated_at desc
  limit 1
  for share;
  if v_org_version_id is null then
    raise exception '目前沒有可作為簽核權威的正式組織版本' using errcode = '55000';
  end if;

  select setting_row.value into v_templates
  from public.system_settings setting_row
  where setting_row.tenant_id = p_tenant_id and setting_row.key = 'workflow_templates'
  for share;
  select setting_row.value into v_policy
  from public.system_settings setting_row
  where setting_row.tenant_id = p_tenant_id and setting_row.key = 'approval_routing_policy'
  for share;
  if pg_catalog.jsonb_typeof(v_templates) <> 'array'
     or pg_catalog.jsonb_typeof(v_policy) <> 'object' then
    raise exception '正式簽核流程或金額門檻尚未完成設定' using errcode = '55000';
  end if;

  select pg_catalog.count(*)::integer, pg_catalog.min(template_row.value::text)::jsonb
    into v_template_count, v_template
  from pg_catalog.jsonb_array_elements(v_templates) template_row(value)
  where coalesce((template_row.value ->> 'enabled')::boolean, true)
    and coalesce(template_row.value -> 'appliesTo', '[]'::jsonb) ? p_request_type
    and pg_catalog.jsonb_typeof(template_row.value -> 'steps') = 'array';
  if v_template_count <> 1 then
    raise exception '單據類型 % 必須恰好對應一個正式簽核流程，目前為 % 個', p_request_type, v_template_count
      using errcode = '55000';
  end if;
  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(coalesce(v_template -> 'conditionalRoutes', '[]'::jsonb)) route_row(value)
    where coalesce((route_row.value ->> 'enabled')::boolean, true)
  ) then
    raise exception '正式流程含條件路線，但伺服器端條件編譯器尚未發布；為避免錯送已停止送件'
      using errcode = '55000';
  end if;

  for v_step in
    select step_row.value
    from pg_catalog.jsonb_array_elements(v_template -> 'steps') with ordinality step_row(value, ordinality)
    where coalesce((step_row.value ->> 'required')::boolean, true)
    order by step_row.ordinality
  loop
    v_key := pg_catalog.lower(pg_catalog.btrim(coalesce(v_step ->> 'key', v_step ->> 'rk', v_step ->> 'role', '')));
    if v_key = '' then
      raise exception '正式簽核流程含未命名關卡' using errcode = '55000';
    end if;
    v_expected_steps := v_expected_steps || pg_catalog.jsonb_build_array(v_step || pg_catalog.jsonb_build_object('key', v_key));
  end loop;

  v_fixed := pg_catalog.lower(coalesce(p_form_payload ->> 'is_fixed_expense', p_form_payload ->> 'isFixedExpense', 'false')) in ('true','1','yes','是');
  foreach v_key in array array['admin_director','ceo'] loop
    v_threshold := coalesce(
      case when v_fixed then nullif(v_policy #>> array[v_key,'fixed_min_amount'], '')::numeric
           else nullif(v_policy #>> array[v_key,'standard_min_amount'], '')::numeric end,
      case when v_fixed then nullif(v_policy #>> array[v_key,'fixed_expense_min_amount'], '')::numeric
           else nullif(v_policy #>> array[v_key,'min_amount'], '')::numeric end,
      10
    );
    v_required := coalesce(p_amount, 0) >= v_threshold;
    if not v_required then
      select coalesce(pg_catalog.jsonb_agg(step_row.value order by step_row.ordinality), '[]'::jsonb)
        into v_expected_steps
      from pg_catalog.jsonb_array_elements(v_expected_steps) with ordinality step_row(value, ordinality)
      where pg_catalog.lower(coalesce(step_row.value ->> 'key', '')) <> v_key;
    elsif not exists (
      select 1 from pg_catalog.jsonb_array_elements(v_expected_steps) step_row(value)
      where pg_catalog.lower(coalesce(step_row.value ->> 'key', '')) = v_key
    ) then
      select coalesce(pg_catalog.min(step_row.ordinality)::integer - 1, pg_catalog.jsonb_array_length(v_expected_steps))
        into v_insert_index
      from pg_catalog.jsonb_array_elements(v_expected_steps) with ordinality step_row(value, ordinality)
      where (v_key = 'admin_director' and pg_catalog.lower(coalesce(step_row.value ->> 'key', '')) in ('accountant','accountant_final','accountant_invoice','ceo','cashier','applicant_confirm','applicant_invoice_delivery'))
         or (v_key = 'ceo' and pg_catalog.lower(coalesce(step_row.value ->> 'key', '')) in ('cashier','accountant_invoice','applicant_confirm','applicant_invoice_delivery','procurement_receipt','accountant_final'));
      v_expected_steps := pg_catalog.jsonb_insert(v_expected_steps, array[v_insert_index::text], pg_catalog.jsonb_build_object('key', v_key), false);
    end if;
  end loop;

  if not p_allow_history and exists (
    select 1 from pg_catalog.jsonb_array_elements(p_steps) step_row(value)
    where private.finance_income_step_role(step_row.value) in ('applicant_revision','assigned_user')
  ) then
    raise exception '新送件不可夾帶補件或加簽歷史關卡' using errcode = '42501';
  end if;
  if p_allow_history and exists (
    select 1 from pg_catalog.jsonb_array_elements(p_steps) step_row(value)
    where private.finance_income_step_role(step_row.value) = 'applicant_revision'
      and coalesce(step_row.value ->> 'uid', '') <> p_applicant_finance_user_id
  ) then
    raise exception '補件關卡不得改派給其他人' using errcode = '42501';
  end if;

  select coalesce(pg_catalog.jsonb_agg(step_row.value order by step_row.ordinality), '[]'::jsonb)
    into v_actual_steps
  from pg_catalog.jsonb_array_elements(p_steps) with ordinality step_row(value, ordinality)
  where private.finance_income_step_role(step_row.value) not in ('applicant_submit','applicant_revision','assigned_user');
  if pg_catalog.jsonb_array_length(v_expected_steps) = 0 then
    raise exception '正式簽核流程不可為空' using errcode = '55000';
  end if;
  if pg_catalog.jsonb_array_length(v_actual_steps) <> pg_catalog.jsonb_array_length(v_expected_steps) then
    raise exception '簽核關卡數量與正式流程不一致' using errcode = '42501';
  end if;

  for v_index in 0..pg_catalog.jsonb_array_length(v_expected_steps) - 1 loop
    v_step := v_expected_steps -> v_index;
    v_actual := v_actual_steps -> v_index;
    v_key := pg_catalog.lower(coalesce(v_step ->> 'key', ''));
    v_actual_key := private.finance_income_step_role(v_actual);
    if v_actual_key <> v_key then
      raise exception '第 % 關應為 %，不可改成 %', v_index + 2, v_key, v_actual_key using errcode = '42501';
    end if;

    v_actual_uid := nullif(pg_catalog.btrim(v_actual ->> 'uid'), '');
    if v_key in ('applicant_confirm','applicant_invoice_delivery') then
      v_expected_uid := p_applicant_finance_user_id;
      v_kind := 'applicant';
      v_role_key := v_key;
    elsif v_key = 'dept_manager'
       and coalesce((v_actual ->> 'autoSkip')::boolean, false)
       and coalesce(v_actual ->> 'uid', '') = p_applicant_finance_user_id
       and exists (
         select 1 from public.employee_department_roles role_row
         where role_row.tenant_id = p_tenant_id
           and role_row.finance_user_id = p_applicant_finance_user_id
           and role_row.active and coalesce(role_row.can_approve, true)
           and (role_row.is_department_manager or role_row.role_key in ('dept_manager','department_manager'))
       ) then
      v_expected_uid := p_applicant_finance_user_id;
      v_kind := 'department_manager';
      v_role_key := 'dept_manager';
    else
      v_kind := case
        when v_key = 'dept_manager' then 'dept_manager'
        when v_key in ('accountant_final','accountant_invoice') then 'accountant'
        when v_key in ('procurement_payment','procurement_receipt','general_affairs') then 'general_affairs'
        when v_key in ('direct_supervisor','admin_director','accountant','ceo','cashier') then v_key
        else 'finance_role'
      end;
      v_role_key := case
        when v_key in ('accountant_final','accountant_invoice') then 'accountant'
        when v_key in ('procurement_payment','procurement_receipt') then 'general_affairs'
        else v_key
      end;
      v_resolution := public.finance_org_resolve_actor(v_kind, p_applicant_finance_user_id, p_department_code, v_role_key, null);
      if coalesce((v_resolution ->> 'ok')::boolean, false) is not true
         or pg_catalog.jsonb_array_length(coalesce(v_resolution -> 'candidates', '[]'::jsonb)) = 0 then
        -- A formally assigned top-level CEO has no superior or department
        -- manager above the company root. Only that exact, same-department
        -- canonical case becomes an audited self-route skip; all other missing
        -- organization assignments remain fail-closed.
        if v_key in ('direct_supervisor','dept_manager')
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
          v_kind := 'top_level_self';
          v_role_key := 'ceo';
        else
          raise exception '正式組織找不到 % 關卡的有效簽核人', v_key using errcode = '55000';
        end if;
      else
        v_candidate := v_resolution -> 'candidates' -> 0;
        v_expected_uid := coalesce(nullif(v_candidate ->> 'effective_finance_user_id', ''), nullif(v_candidate ->> 'finance_user_id', ''));
      end if;
    end if;

    if v_expected_uid is null
       or v_actual_uid is distinct from v_expected_uid
       or not public.finance_user_is_approval_identity_ready(p_tenant_id, v_expected_uid) then
      raise exception '第 % 關 % 不是正式組織指定的簽核人', v_index + 2, v_key using errcode = '42501';
    end if;
    perform 1 from public.finance_users user_row
    where user_row.tenant_id = p_tenant_id and user_row.id = v_expected_uid and user_row.active
    for key share;
    if not found then
      raise exception '第 % 關 % 的正式簽核人已停用', v_index + 2, v_key using errcode = '55000';
    end if;

    -- Operational/terminal tasks are work performed by the named actor and may
    -- legitimately remain pending when that actor is also the applicant. Review
    -- roles may never become a self-approval: the step must remain in the audit
    -- trail as an exact, machine-approved self-route skip.
    v_self_pending_allowed := v_key in (
      'accountant_final', 'accountant_invoice',
      'procurement_payment', 'procurement_receipt',
      'applicant_confirm', 'applicant_invoice_delivery',
      'cashier'
    );
    v_is_canonical_self_skip := v_expected_uid = p_applicant_finance_user_id
      and not v_self_pending_allowed;
    if v_is_canonical_self_skip then
      if coalesce(v_actual ->> 'a', '') <> 'approved'
         or coalesce((v_actual ->> 'autoSkip')::boolean, false) is not true
         or coalesce(v_actual ->> 'autoSkipReason', '') <> 'canonical_actor_is_applicant'
         or coalesce(v_actual ->> 'n', '') <> '系統自動跳關'
         or coalesce(v_actual ->> 'c', '') <> '系統依正式角色解析結果自動跳過：此關簽核人與申請人相同。' then
        raise exception '% 關卡的正式簽核人即為申請人；必須保留可稽核的系統自動跳關，不可自行核准或等待本人簽核', v_key
          using errcode = '42501';
      end if;
    elsif coalesce(v_actual ->> 'autoSkipReason', '') = 'canonical_actor_is_applicant' then
      raise exception '% 關卡不得偽造申請人自我路由跳關紀錄', v_key using errcode = '42501';
    end if;

    if not p_allow_history
       and coalesce(v_actual ->> 'a', '') <> ''
       and not v_is_canonical_self_skip
       and not (v_key = 'dept_manager' and coalesce((v_actual ->> 'autoSkip')::boolean, false)) then
      raise exception '新送件不可預先核准 % 關卡', v_key using errcode = '42501';
    end if;

    if coalesce(v_actual ->> 'a', '') = '' then
      select pg_catalog.count(*)::integer, pg_catalog.min(request_row.value::text)::jsonb
        into v_request_count, v_actor_request
      from pg_catalog.jsonb_array_elements(p_actor_requests) request_row(value)
      where pg_catalog.lower(coalesce(request_row.value ->> 'step_key', '')) = v_key;
      if v_request_count <> 1
         or (nullif(v_actor_request ->> 'finance_user_id', '') is not null
             and v_actor_request ->> 'finance_user_id' <> v_expected_uid) then
        raise exception '% 關卡的簽核人請求與正式解析結果不一致', v_key using errcode = '42501';
      end if;
    end if;

    v_snapshots := v_snapshots || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'step_key', v_key,
      'assignee_finance_user_id', v_expected_uid,
      'resolver_actor_kind', v_kind,
      'resolver_role_key', v_role_key,
      'self_route_mode', case
        when v_is_canonical_self_skip then 'audited_auto_skip'
        when v_expected_uid = p_applicant_finance_user_id then 'pending_operational_task'
        else 'independent_actor'
      end,
      'org_version_id', v_org_version_id
    ));
  end loop;

  if exists (
    select 1 from pg_catalog.jsonb_array_elements(p_actor_requests) request_row(value)
    where pg_catalog.lower(coalesce(request_row.value ->> 'step_key', '')) not in (
      select private.finance_income_step_role(step_row.value)
      from pg_catalog.jsonb_array_elements(p_steps) step_row(value)
      where coalesce(step_row.value ->> 'a', '') = ''
    )
  ) then
    raise exception '簽核人請求含有正式待簽流程以外的關卡' using errcode = '42501';
  end if;

  return pg_catalog.jsonb_build_object('ok', true, 'org_version_id', v_org_version_id, 'actor_snapshots', v_snapshots);
end;
$function$;

alter function public.finance_submit_expense_request(jsonb,uuid,text,jsonb) set schema private;
alter function private.finance_submit_expense_request(jsonb,uuid,text,jsonb) rename to finance_submit_expense_request_v1_unsafe;
alter function public.finance_resubmit_expense_request(text,jsonb,uuid,text,jsonb) set schema private;
alter function private.finance_resubmit_expense_request(text,jsonb,uuid,text,jsonb) rename to finance_resubmit_expense_request_v1_unsafe;
revoke all on function private.finance_submit_expense_request_v1_unsafe(jsonb,uuid,text,jsonb) from public, anon, authenticated, service_role;
revoke all on function private.finance_resubmit_expense_request_v1_unsafe(text,jsonb,uuid,text,jsonb) from public, anon, authenticated, service_role;

create function public.finance_submit_expense_request(
  p_form jsonb, p_org_unit_id uuid, p_legal_entity_code text,
  p_actor_requests jsonb default '[]'::jsonb
) returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare
  v_tenant_id uuid;
  v_actor public.finance_users%rowtype;
  v_route jsonb;
begin
  if auth.uid() is null then raise exception '請先登入後再送出申請' using errcode = '42501'; end if;
  v_tenant_id := public.current_tenant_id();
  v_actor := public.current_finance_user();
  if v_actor.id is null or v_actor.tenant_id is distinct from v_tenant_id
     or p_form ->> 'applicant_id' is distinct from v_actor.id then
    raise exception '申請人必須是目前登入身分' using errcode = '42501';
  end if;
  v_route := private.finance_expense_assert_authoritative_route_v2(
    v_tenant_id, v_actor.id, p_form ->> 'type', p_form ->> 'department_code',
    nullif(p_form ->> 'amount', '')::numeric, coalesce(p_form -> 'form_payload', '{}'::jsonb),
    p_form -> 'steps', p_actor_requests, false
  );
  return private.finance_submit_expense_request_v1_unsafe(p_form, p_org_unit_id, p_legal_entity_code, p_actor_requests);
end;
$function$;

create function public.finance_resubmit_expense_request(
  p_form_id text, p_form_state jsonb, p_org_unit_id uuid, p_legal_entity_code text,
  p_actor_requests jsonb default '[]'::jsonb
) returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare
  v_tenant_id uuid;
  v_actor public.finance_users%rowtype;
  v_expense public.expense_requests%rowtype;
  v_active_index integer;
  v_active_step jsonb;
  v_route jsonb;
begin
  if auth.uid() is null then raise exception '請先登入後再重新送出' using errcode = '42501'; end if;
  v_tenant_id := public.current_tenant_id();
  v_actor := public.current_finance_user();
  select expense_row.* into v_expense
  from public.expense_requests expense_row
  where expense_row.tenant_id = v_tenant_id and expense_row.id = p_form_id
  for update;
  if not found then raise exception '找不到這張待重新送出的申請單' using errcode = 'P0002'; end if;
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
       v_expense.steps, p_form_state -> 'steps', v_active_index, 'approved', v_actor.id, v_actor.name
     ) then
    raise exception '補件重送不得增刪、改派或預先處理其他關卡' using errcode = '42501';
  end if;
  v_route := private.finance_expense_assert_authoritative_route_v2(
    v_tenant_id, v_actor.id, v_expense.type, v_expense.department_code, v_expense.amount,
    coalesce(p_form_state -> 'form_payload', v_expense.form_payload, '{}'::jsonb),
    p_form_state -> 'steps', p_actor_requests, true
  );
  return private.finance_resubmit_expense_request_v1_unsafe(p_form_id, p_form_state, p_org_unit_id, p_legal_entity_code, p_actor_requests);
end;
$function$;

alter function private.finance_expense_assert_authoritative_route_v2(uuid,text,text,text,numeric,jsonb,jsonb,jsonb,boolean) owner to postgres;
alter function private.finance_submit_expense_request_v1_unsafe(jsonb,uuid,text,jsonb) owner to postgres;
alter function private.finance_resubmit_expense_request_v1_unsafe(text,jsonb,uuid,text,jsonb) owner to postgres;
alter function public.finance_submit_expense_request(jsonb,uuid,text,jsonb) owner to postgres;
alter function public.finance_resubmit_expense_request(text,jsonb,uuid,text,jsonb) owner to postgres;
revoke all on function private.finance_expense_assert_authoritative_route_v2(uuid,text,text,text,numeric,jsonb,jsonb,jsonb,boolean) from public, anon, authenticated, service_role;
revoke all on function public.finance_submit_expense_request(jsonb,uuid,text,jsonb) from public, anon, authenticated, service_role;
revoke all on function public.finance_resubmit_expense_request(text,jsonb,uuid,text,jsonb) from public, anon, authenticated, service_role;
grant execute on function public.finance_submit_expense_request(jsonb,uuid,text,jsonb) to authenticated, service_role;
grant execute on function public.finance_resubmit_expense_request(text,jsonb,uuid,text,jsonb) to authenticated, service_role;

do $postflight$
begin
  if exists (
    select 1 from pg_catalog.pg_proc proc_row
    join pg_catalog.pg_namespace namespace_row on namespace_row.oid = proc_row.pronamespace
    where namespace_row.nspname = 'public'
      and proc_row.proname in ('finance_submit_expense_request','finance_resubmit_expense_request')
      and (proc_row.prosecdef is not true
        or proc_row.proconfig is distinct from array['search_path=""']::text[]
        or pg_catalog.has_function_privilege('anon', proc_row.oid, 'EXECUTE')
        or pg_catalog.has_function_privilege('public', proc_row.oid, 'EXECUTE')
        or not pg_catalog.has_function_privilege('authenticated', proc_row.oid, 'EXECUTE'))
  ) or pg_catalog.has_function_privilege('authenticated', 'private.finance_submit_expense_request_v1_unsafe(jsonb,uuid,text,jsonb)', 'EXECUTE') then
    raise exception 'expense route authority ACL/security postflight failed';
  end if;
  if not exists (
       select 1
       from pg_catalog.pg_attribute attribute_row
       where attribute_row.attrelid = 'public.file_attachments'::pg_catalog.regclass
         and attribute_row.attname = 'storage_path'
         and attribute_row.attnum > 0
         and not attribute_row.attisdropped
     )
     or not exists (
       select 1
       from pg_catalog.pg_attribute attribute_row
       join pg_catalog.pg_attrdef default_row
         on default_row.adrelid = attribute_row.attrelid
        and default_row.adnum = attribute_row.attnum
       where attribute_row.attrelid = 'public.file_attachments'::pg_catalog.regclass
         and attribute_row.attname = 'path'
         and attribute_row.attnum > 0
         and not attribute_row.attisdropped
         and attribute_row.attgenerated = 's'
         and pg_catalog.format_type(attribute_row.atttypid, attribute_row.atttypmod) = 'text'
         and pg_catalog.pg_get_expr(default_row.adbin, default_row.adrelid) = 'storage_path'
     ) then
    raise exception 'attachment compatibility postflight failed: storage_path and its generated read-only path alias must remain canonical';
  end if;
end;
$postflight$;

notify pgrst, 'reload schema';
