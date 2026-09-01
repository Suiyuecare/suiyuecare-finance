-- Permit the formally assigned cashier to disburse a request that they also
-- submitted, but only when the frozen active step explicitly names that same
-- Finance user. This is not a general self-approval exception: manager,
-- director, CEO and accounting approval gates remain protected.
--
-- The patch is pinned to the exact reviewed production helper so unexpected
-- source, owner, search_path, or ACL drift fails closed.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $migration$
declare
  v_oid oid :=
    'private.finance_expense_actor_can_act(uuid,public.expense_requests,integer,jsonb,text,text,text)'::regprocedure::oid;
  v_definition text;
  v_source text;
  v_expected_source text;
  v_actual_source text;
  v_old_guard constant text := $old$  -- Owning a request never grants access to a manager/accounting gate.
  -- Final voucher posting is the only exception: the request must already be
  -- pending its last accounting step and the frozen assignee must be the
  -- applicant who is currently acting. Earlier approval steps remain
  -- protected by finalize_expense_request and cannot be changed here.
  if p_actor_finance_user_id = p_expense.applicant_id
     and v_role_key not in (
       'applicant_revision',
       'applicant_confirm'
     )
     and not (
       p_expense.status = 'pending_voucher'
       and v_role_key in ('accountant_final', 'accounting')
       and pg_catalog.jsonb_typeof(p_expense.steps) = 'array'
       and p_step_index =
         pg_catalog.jsonb_array_length(p_expense.steps) - 1
       and p_step = p_expense.steps -> p_step_index
       and (
         (
           v_explicit_user_id <> ''
           and v_explicit_user_id = p_actor_finance_user_id
         )
         or (
           v_explicit_user_id = ''
           and v_explicit_email <> ''
           and v_explicit_email = pg_catalog.lower(
             coalesce(p_actor_email, '')
           )
         )
       )
     ) then
    return false;
  end if;$old$;
  v_new_guard constant text := $new$  -- Owning a request never grants access to a manager/accounting gate.
  -- Two operational completion gates may be performed by the applicant only
  -- when the frozen step explicitly names them: the final accounting post,
  -- and a cashier disbursement by a currently active formal cashier. Ordinary
  -- manager, director, CEO, or accounting approvals remain self-protected.
  if p_actor_finance_user_id = p_expense.applicant_id
     and v_role_key not in (
       'applicant_revision',
       'applicant_confirm'
     )
     and not (
       p_expense.status = 'pending_voucher'
       and v_role_key in ('accountant_final', 'accounting')
       and pg_catalog.jsonb_typeof(p_expense.steps) = 'array'
       and p_step_index =
         pg_catalog.jsonb_array_length(p_expense.steps) - 1
       and p_step = p_expense.steps -> p_step_index
       and (
         (
           v_explicit_user_id <> ''
           and v_explicit_user_id = p_actor_finance_user_id
         )
         or (
           v_explicit_user_id = ''
           and v_explicit_email <> ''
           and v_explicit_email = pg_catalog.lower(
             coalesce(p_actor_email, '')
           )
         )
       )
     )
     and not (
       p_expense.status = 'pending_cashier'
       and p_expense.cash_posted_at is null
       and v_role_key = 'cashier'
       and pg_catalog.jsonb_typeof(p_expense.steps) = 'array'
       and p_step = p_expense.steps -> p_step_index
       and v_explicit_user_id <> ''
       and v_explicit_user_id = p_actor_finance_user_id
       and exists (
         select 1
         from public.employee_department_roles cashier_role
         where cashier_role.tenant_id = p_tenant_id
           and cashier_role.finance_user_id = p_actor_finance_user_id
           and cashier_role.role_key = 'cashier'
           and cashier_role.active is true
           and cashier_role.can_approve is true
           and cashier_role.effective_from <= current_date
           and (
             cashier_role.effective_to is null
             or cashier_role.effective_to >= current_date
           )
       )
     ) then
    return false;
  end if;$new$;
begin
  select pg_catalog.pg_get_functiondef(proc_row.oid), proc_row.prosrc
    into v_definition, v_source
  from pg_catalog.pg_proc proc_row
  where proc_row.oid = v_oid
    and pg_catalog.pg_get_userbyid(proc_row.proowner) = 'postgres'
    and not proc_row.prosecdef
    and proc_row.proconfig = array['search_path=""']::text[]
    and not pg_catalog.has_function_privilege('public', proc_row.oid, 'EXECUTE')
    and not pg_catalog.has_function_privilege('anon', proc_row.oid, 'EXECUTE')
    and not pg_catalog.has_function_privilege('authenticated', proc_row.oid, 'EXECUTE')
    and not pg_catalog.has_function_privilege('service_role', proc_row.oid, 'EXECUTE');

  if v_definition is null or v_source is null then
    raise exception
      'finance_expense_actor_can_act owner, security, search_path or ACL baseline drifted';
  end if;
  if extensions.digest(v_source::bytea, 'sha256') <>
       pg_catalog.decode(
         '36c621ce91d061a58b56453321980a19e75d4bc0f521ad1340641e70c2c59938',
         'hex'
       ) then
    raise exception
      'finance_expense_actor_can_act source is not the reviewed production baseline';
  end if;
  if (
       pg_catalog.length(v_source) - pg_catalog.length(
         pg_catalog.replace(v_source, v_old_guard, '')
       )
     ) / pg_catalog.length(v_old_guard) <> 1 then
    raise exception
      'finance_expense_actor_can_act self-actor guard anchor is missing or duplicated';
  end if;

  v_expected_source := pg_catalog.replace(v_source, v_old_guard, v_new_guard);
  v_definition := pg_catalog.replace(v_definition, v_old_guard, v_new_guard);
  execute v_definition;

  select proc_row.prosrc
    into v_actual_source
  from pg_catalog.pg_proc proc_row
  where proc_row.oid = v_oid
    and pg_catalog.pg_get_userbyid(proc_row.proowner) = 'postgres'
    and not proc_row.prosecdef
    and proc_row.proconfig = array['search_path=""']::text[]
    and not pg_catalog.has_function_privilege('public', proc_row.oid, 'EXECUTE')
    and not pg_catalog.has_function_privilege('anon', proc_row.oid, 'EXECUTE')
    and not pg_catalog.has_function_privilege('authenticated', proc_row.oid, 'EXECUTE')
    and not pg_catalog.has_function_privilege('service_role', proc_row.oid, 'EXECUTE');

  if extensions.digest(v_actual_source::bytea, 'sha256') <>
       extensions.digest(v_expected_source::bytea, 'sha256') then
    raise exception
      'finance_expense_actor_can_act postflight source differs from the reviewed patch';
  end if;
  if pg_catalog.strpos(
       v_actual_source,
       'a cashier disbursement by a currently active formal cashier'
     ) = 0
     or pg_catalog.strpos(
       v_actual_source,
       'p_expense.status = ''pending_cashier'''
     ) = 0
     or pg_catalog.strpos(
       v_actual_source,
       'cashier_role.role_key = ''cashier'''
     ) = 0
     or pg_catalog.strpos(
       v_actual_source,
       'cashier_role.can_approve is true'
     ) = 0 then
    raise exception
      'finance_expense_actor_can_act did not install the narrow formal-cashier exception';
  end if;
end;
$migration$;

comment on function private.finance_expense_actor_can_act(
  uuid,
  public.expense_requests,
  integer,
  jsonb,
  text,
  text,
  text
) is
  'Validates the frozen expense step actor. Self-approval stays forbidden except for an explicitly frozen final accounting post or a pending cashier disbursement by the active formal cashier.';

notify pgrst, 'reload schema';
