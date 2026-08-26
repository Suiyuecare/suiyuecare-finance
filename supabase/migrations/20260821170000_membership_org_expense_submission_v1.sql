-- NON-RERUNNABLE: installs the two expense submission endpoints that the
-- versioned organization frontend calls. A repeated apply is rejected so a
-- changed live definition can never be silently overwritten.
begin;

do $preflight$
begin
  if to_regclass('private.finance_membership_org_versions_v1') is null then
    raise exception 'versioned organization runtime is not installed';
  end if;
  if to_regprocedure('public.finance_submit_expense_request(jsonb,uuid,text,jsonb)') is not null
     or to_regprocedure('public.finance_resubmit_expense_request(text,jsonb,uuid,text,jsonb)') is not null then
    raise exception 'membership organization expense submission endpoint already exists';
  end if;
  if to_regprocedure('private.finance_income_status_from_steps(jsonb)') is null
     or to_regprocedure('private.finance_income_active_step_index(jsonb)') is null
     or to_regprocedure('private.finance_expense_is_exact_step_transition(jsonb,jsonb,integer,text,text,text)') is null
     or to_regprocedure('private.finance_expense_new_files_are_owned(uuid,public.expense_requests,jsonb,jsonb,text)') is null then
    raise exception 'required guarded expense workflow helpers are missing';
  end if;
end;
$preflight$;

create function public.finance_submit_expense_request(
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
  v_version_id uuid;
  v_version_no bigint;
  v_unit jsonb;
  v_sanitized_form jsonb;
  v_request public.expense_requests%rowtype;
  v_inserted public.expense_requests%rowtype;
  v_derived jsonb;
  v_first_step jsonb;
  v_actor_snapshots jsonb;
begin
  if auth.uid() is null then
    raise exception '請先登入後再送出申請' using errcode = '42501';
  end if;
  if pg_catalog.jsonb_typeof(coalesce(p_form, 'null'::jsonb)) <> 'object'
     or pg_catalog.jsonb_typeof(coalesce(p_actor_requests, 'null'::jsonb)) <> 'array'
     or pg_catalog.jsonb_array_length(coalesce(p_actor_requests, '[]'::jsonb)) > 50 then
    raise exception '申請資料或簽核人資料格式不正確' using errcode = '22023';
  end if;

  v_tenant_id := public.current_tenant_id();
  v_actor := public.current_finance_user();
  if v_tenant_id is null or v_actor.id is null
     or v_actor.tenant_id is distinct from v_tenant_id
     or v_actor.active is not true
     or not public.finance_user_is_approval_identity_ready(v_tenant_id, v_actor.id) then
    raise exception '目前登入帳號尚未完成正式財務身分綁定' using errcode = '42501';
  end if;

  select version_row.id, version_row.version_no,
         unit_row.value
    into v_version_id, v_version_no, v_unit
  from private.finance_membership_org_versions_v1 version_row
  cross join lateral pg_catalog.jsonb_array_elements(version_row.snapshot -> 'units') unit_row(value)
  where version_row.tenant_id = v_tenant_id
    and version_row.status = 'published'
    and (version_row.effective_at is null or version_row.effective_at <= pg_catalog.now())
    and unit_row.value ->> 'id' = p_org_unit_id::text
  order by version_row.published_at desc nulls last, version_row.updated_at desc
  limit 1;

  if v_unit is null
     or coalesce((v_unit ->> 'active')::boolean, false) is not true
     or coalesce((v_unit ->> 'is_posting_unit')::boolean, false) is not true then
    raise exception '所選單位不是目前正式組織中的可送單單位' using errcode = '55000';
  end if;

  v_sanitized_form := p_form || pg_catalog.jsonb_build_object(
    'tenant_id', v_tenant_id,
    'data_environment', pg_catalog.lower(coalesce(p_form ->> 'data_environment', 'production')),
    'created_at', pg_catalog.now(),
    'updated_at', pg_catalog.now(),
    'ver', 1,
    'files', coalesce(p_form -> 'files', '[]'::jsonb),
    'actual_files', coalesce(p_form -> 'actual_files', '[]'::jsonb),
    'steps', coalesce(p_form -> 'steps', '[]'::jsonb),
    'form_payload', coalesce(p_form -> 'form_payload', '{}'::jsonb),
    'bank_fee_amount', coalesce(p_form -> 'bank_fee_amount', '0'::jsonb),
    'voucher_id', null,
    'cash_posted_at', null,
    'ledger_posted_at', null,
    'posting_locked_at', null,
    'voided_at', null
  );
  select populated.* into v_request
  from pg_catalog.jsonb_populate_record(null::public.expense_requests, v_sanitized_form) populated;

  if coalesce(pg_catalog.btrim(v_request.id), '') = ''
     or coalesce(pg_catalog.btrim(v_request.no), '') = ''
     or coalesce(pg_catalog.btrim(v_request.type), '') = ''
     or coalesce(pg_catalog.btrim(v_request.description), '') = ''
     or coalesce(v_request.amount, 0) < 0
     or coalesce(v_request.amount, 0) > 1000000000000 then
    raise exception '申請單識別、類型、說明或金額不完整' using errcode = '22023';
  end if;
  if v_request.applicant_id is distinct from v_actor.id
     or pg_catalog.lower(coalesce(pg_catalog.btrim(v_request.applicant_email), ''))
          is distinct from pg_catalog.lower(pg_catalog.btrim(v_actor.email))
     or coalesce(pg_catalog.btrim(v_request.applicant), '')
          is distinct from pg_catalog.btrim(v_actor.name) then
    raise exception '申請人資料必須與目前登入身分完全一致' using errcode = '42501';
  end if;
  if coalesce(pg_catalog.btrim(v_request.department_code), '')
       is distinct from coalesce(v_unit ->> 'code', '')
     or coalesce(pg_catalog.btrim(v_request.entity_id), '')
       is distinct from coalesce(pg_catalog.btrim(p_legal_entity_code), '')
     or not coalesce(v_unit -> 'entity_codes', '[]'::jsonb) ? v_request.entity_id then
    raise exception '申請單的公司或部門不在目前正式組織的可用範圍' using errcode = '42501';
  end if;
  if p_form ? 'tenant_id'
     and nullif(pg_catalog.btrim(p_form ->> 'tenant_id'), '')::uuid is distinct from v_tenant_id then
    raise exception '申請單租戶與目前登入租戶不一致' using errcode = '42501';
  end if;

  if v_request.data_environment not in ('production', 'test')
     or pg_catalog.jsonb_typeof(v_request.steps) <> 'array'
     or pg_catalog.jsonb_array_length(v_request.steps) < 2
     or pg_catalog.jsonb_array_length(v_request.steps) > 50
     or pg_catalog.jsonb_typeof(v_request.files) <> 'array'
     or pg_catalog.jsonb_typeof(v_request.actual_files) <> 'array'
     or pg_catalog.jsonb_typeof(v_request.form_payload) <> 'object' then
    raise exception '申請單環境、關卡或附件格式不正確' using errcode = '22023';
  end if;

  v_first_step := v_request.steps -> 0;
  if private.finance_income_step_role(v_first_step) <> 'applicant_submit'
     or coalesce(v_first_step ->> 'uid', '') <> v_actor.id
     or coalesce(v_first_step ->> 'a', '') <> 'approved' then
    raise exception '送單必須由目前申請人完成第一關送出' using errcode = '42501';
  end if;
  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(v_request.steps) workflow_step
    where coalesce(workflow_step ->> 'a', '') not in ('approved', 'cancelled', 'rejected')
      and (
        coalesce(pg_catalog.btrim(workflow_step ->> 'uid'), '') = ''
        or not exists (
          select 1 from public.finance_users assignee
          where assignee.tenant_id = v_tenant_id
            and assignee.id = workflow_step ->> 'uid'
            and assignee.active is true
            and public.finance_user_is_approval_identity_ready(v_tenant_id, assignee.id)
        )
      )
  ) then
    raise exception '簽核流程仍有未綁定或無效的正式簽核人' using errcode = '55000';
  end if;

  v_derived := private.finance_income_status_from_steps(v_request.steps);
  if coalesce(v_derived ->> 'approval_status', '') in ('', 'completed')
     or v_request.status is distinct from v_derived ->> 'approval_status'
     or v_request.step is distinct from (v_derived ->> 'approval_step')::integer then
    raise exception '申請單狀態與第一個待簽關卡不一致' using errcode = '23514';
  end if;

  insert into public.expense_requests
  select (v_request).*
  returning * into v_inserted;

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
           'step_key', private.finance_income_step_role(workflow_step),
           'assignee_finance_user_id', workflow_step ->> 'uid',
           'resolved_org_unit_id', p_org_unit_id,
           'resolved_org_unit_code', v_unit ->> 'code',
           'duplicate_assignee', false
         )), '[]'::jsonb)
    into v_actor_snapshots
  from pg_catalog.jsonb_array_elements(v_inserted.steps) workflow_step
  where coalesce(workflow_step ->> 'a', '') not in ('approved', 'cancelled', 'rejected');

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'form_id', v_inserted.id,
    'form_no', v_inserted.no,
    'row', pg_catalog.to_jsonb(v_inserted),
    'approval_runtime', pg_catalog.jsonb_build_object(
      'ok', true,
      'runtime', 'embedded_expense_steps_v1'
    ),
    'context', pg_catalog.jsonb_build_object(
      'org_version_id', v_version_id,
      'org_version_no', v_version_no,
      'org_unit_id', p_org_unit_id,
      'org_unit_code', v_unit ->> 'code',
      'legal_entity_code', v_request.entity_id,
      'actor_snapshots', v_actor_snapshots
    )
  );
end;
$function$;

create function public.finance_resubmit_expense_request(
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
  v_version_id uuid;
  v_version_no bigint;
  v_unit jsonb;
  v_active_index integer;
  v_active_step jsonb;
  v_new_steps jsonb;
  v_new_status jsonb;
  v_new_actual_files jsonb;
  v_new_payload jsonb;
  v_previous_context text;
  v_row_count integer;
begin
  if auth.uid() is null then
    raise exception '請先登入後再重新送出' using errcode = '42501';
  end if;
  if coalesce(pg_catalog.btrim(p_form_id), '') = ''
     or pg_catalog.jsonb_typeof(coalesce(p_form_state, 'null'::jsonb)) <> 'object'
     or pg_catalog.jsonb_typeof(coalesce(p_actor_requests, 'null'::jsonb)) <> 'array'
     or exists (
       select 1 from pg_catalog.jsonb_object_keys(p_form_state) state_key
       where state_key not in (
         'status','step','steps','debit_account','debit_account_name',
         'credit_account','credit_account_name','form_payload','cash_posted_at',
         'ledger_posted_at','posting_locked_at','voucher_id','actual_files'
       )
     ) then
    raise exception '重新送出資料格式不正確或包含不允許的欄位' using errcode = '22023';
  end if;

  v_tenant_id := public.current_tenant_id();
  v_actor := public.current_finance_user();
  if v_tenant_id is null or v_actor.id is null
     or not public.finance_user_is_approval_identity_ready(v_tenant_id, v_actor.id) then
    raise exception '目前登入帳號尚未完成正式財務身分綁定' using errcode = '42501';
  end if;

  select expense_row.* into v_expense
  from public.expense_requests expense_row
  where expense_row.tenant_id = v_tenant_id
    and expense_row.id = p_form_id
  for update;
  if not found then
    raise exception '找不到這張待重新送出的申請單' using errcode = 'P0002';
  end if;
  if v_expense.applicant_id is distinct from v_actor.id then
    raise exception '只有原申請人本人可以重新送出' using errcode = '42501';
  end if;

  select version_row.id, version_row.version_no, unit_row.value
    into v_version_id, v_version_no, v_unit
  from private.finance_membership_org_versions_v1 version_row
  cross join lateral pg_catalog.jsonb_array_elements(version_row.snapshot -> 'units') unit_row(value)
  where version_row.tenant_id = v_tenant_id
    and version_row.status = 'published'
    and unit_row.value ->> 'id' = p_org_unit_id::text
  order by version_row.published_at desc nulls last, version_row.updated_at desc
  limit 1;
  if v_unit is null
     or coalesce((v_unit ->> 'active')::boolean, false) is not true
     or coalesce((v_unit ->> 'is_posting_unit')::boolean, false) is not true
     or v_expense.department_code is distinct from v_unit ->> 'code'
     or v_expense.entity_id is distinct from pg_catalog.btrim(p_legal_entity_code)
     or not coalesce(v_unit -> 'entity_codes', '[]'::jsonb) ? v_expense.entity_id then
    raise exception '原申請單的公司或部門已不在目前正式組織範圍' using errcode = '55000';
  end if;

  v_active_index := private.finance_income_active_step_index(v_expense.steps);
  if v_active_index is null then
    raise exception '已完成的申請單不可重新送出' using errcode = '55000';
  end if;
  v_active_step := v_expense.steps -> v_active_index;
  v_new_steps := p_form_state -> 'steps';
  v_new_actual_files := coalesce(p_form_state -> 'actual_files', v_expense.actual_files, '[]'::jsonb);
  v_new_payload := coalesce(p_form_state -> 'form_payload', v_expense.form_payload, '{}'::jsonb);
  if private.finance_income_step_role(v_active_step) <> 'applicant_revision'
     or coalesce(v_active_step ->> 'uid', '') <> v_actor.id
     or pg_catalog.jsonb_typeof(v_new_steps) <> 'array'
     or pg_catalog.jsonb_typeof(v_new_actual_files) <> 'array'
     or pg_catalog.jsonb_typeof(v_new_payload) <> 'object'
     or not private.finance_expense_is_exact_step_transition(
       v_expense.steps, v_new_steps, v_active_index, 'approved', v_actor.id, v_actor.name
     )
     or not private.finance_expense_new_files_are_owned(
       v_tenant_id, v_expense, v_expense.actual_files, v_new_actual_files, v_actor.id
     ) then
    raise exception '目前不是可由原申請人安全重送的補件關卡' using errcode = '55000';
  end if;

  v_new_status := private.finance_income_status_from_steps(v_new_steps);
  if coalesce(v_new_status ->> 'approval_status', '') in ('', 'completed')
     or p_form_state ->> 'status' is distinct from v_new_status ->> 'approval_status'
     or coalesce(p_form_state ->> 'step', '') !~ '^[0-9]+$'
     or (p_form_state ->> 'step')::integer is distinct from (v_new_status ->> 'approval_step')::integer
     or coalesce(p_form_state ->> 'debit_account', '') is distinct from coalesce(v_expense.debit_account, '')
     or coalesce(p_form_state ->> 'debit_account_name', '') is distinct from coalesce(v_expense.debit_account_name, '')
     or coalesce(p_form_state ->> 'credit_account', '') is distinct from coalesce(v_expense.credit_account, '')
     or coalesce(p_form_state ->> 'credit_account_name', '') is distinct from coalesce(v_expense.credit_account_name, '')
     or nullif(p_form_state ->> 'cash_posted_at', '')::timestamptz is distinct from v_expense.cash_posted_at
     or nullif(p_form_state ->> 'ledger_posted_at', '')::timestamptz is distinct from v_expense.ledger_posted_at
     or nullif(p_form_state ->> 'posting_locked_at', '')::timestamptz is distinct from v_expense.posting_locked_at
     or coalesce(p_form_state ->> 'voucher_id', '') is distinct from coalesce(v_expense.voucher_id, '') then
    raise exception '重新送出的狀態、會計或入帳欄位不一致' using errcode = '23514';
  end if;

  v_previous_context := coalesce(pg_catalog.current_setting('app.finance_expense_write_context', true), '');
  perform pg_catalog.set_config('app.finance_expense_write_context', 'org_resubmit', true);
  update public.expense_requests
  set status = v_new_status ->> 'approval_status',
      step = (v_new_status ->> 'approval_step')::integer,
      steps = v_new_steps,
      form_payload = v_new_payload,
      actual_files = v_new_actual_files,
      ver = coalesce(ver, 1) + 1,
      updated_at = pg_catalog.now()
  where tenant_id = v_tenant_id and id = v_expense.id;
  get diagnostics v_row_count = row_count;
  perform pg_catalog.set_config('app.finance_expense_write_context', v_previous_context, true);
  if v_row_count <> 1 then
    raise exception '重新送出時資料寫入失敗' using errcode = '55000';
  end if;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'form_id', v_expense.id,
    'approval_runtime', pg_catalog.jsonb_build_object('ok', true, 'runtime', 'embedded_expense_steps_v1'),
    'context', pg_catalog.jsonb_build_object(
      'org_version_id', v_version_id,
      'org_version_no', v_version_no,
      'org_unit_id', p_org_unit_id,
      'org_unit_code', v_unit ->> 'code',
      'legal_entity_code', v_expense.entity_id
    )
  );
end;
$function$;

alter function public.finance_submit_expense_request(jsonb,uuid,text,jsonb) owner to postgres;
alter function public.finance_resubmit_expense_request(text,jsonb,uuid,text,jsonb) owner to postgres;

revoke all on function public.finance_submit_expense_request(jsonb,uuid,text,jsonb) from public, anon, authenticated, service_role;
revoke all on function public.finance_resubmit_expense_request(text,jsonb,uuid,text,jsonb) from public, anon, authenticated, service_role;
grant execute on function public.finance_submit_expense_request(jsonb,uuid,text,jsonb) to authenticated, service_role;
grant execute on function public.finance_resubmit_expense_request(text,jsonb,uuid,text,jsonb) to authenticated, service_role;

do $postflight$
declare
  v_count integer;
begin
  select pg_catalog.count(*)::integer into v_count
  from pg_catalog.pg_proc proc_row
  join pg_catalog.pg_namespace namespace_row on namespace_row.oid = proc_row.pronamespace
  where namespace_row.nspname = 'public'
    and proc_row.proname in ('finance_submit_expense_request','finance_resubmit_expense_request');
  if v_count <> 2 then
    raise exception 'expected exactly two membership organization expense endpoints, found %', v_count;
  end if;
  if exists (
    select 1
    from pg_catalog.pg_proc proc_row
    join pg_catalog.pg_namespace namespace_row on namespace_row.oid = proc_row.pronamespace
    where namespace_row.nspname = 'public'
      and proc_row.proname in ('finance_submit_expense_request','finance_resubmit_expense_request')
      and (
        proc_row.prosecdef is not true
        or proc_row.proconfig is distinct from array['search_path=""']::text[]
        or pg_catalog.pg_get_userbyid(proc_row.proowner) <> 'postgres'
        or pg_catalog.has_function_privilege('anon', proc_row.oid, 'EXECUTE')
        or pg_catalog.has_function_privilege('public', proc_row.oid, 'EXECUTE')
        or not pg_catalog.has_function_privilege('authenticated', proc_row.oid, 'EXECUTE')
        or not pg_catalog.has_function_privilege('service_role', proc_row.oid, 'EXECUTE')
      )
  ) then
    raise exception 'expense endpoint owner, security, search_path, or ACL postflight failed';
  end if;
end;
$postflight$;

notify pgrst, 'reload schema';
commit;
