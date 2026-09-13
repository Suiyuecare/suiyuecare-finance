-- Exact read-only authority definitions from production catalog, 2026-09-13.
-- No employee data or credentials; installed only into synthetic local tests.
set check_function_bodies = off;
CREATE OR REPLACE FUNCTION public.can_read_bill(p_bill bills)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select
    nullif(public.current_finance_user_id(), '') is not null
    and nullif(public.finance_current_verified_google_email_v2(), '') is not null
    and p_bill.tenant_id = public.current_tenant_id()
    and (
      public.is_finance_accounting()
      or public.is_bill_owner(p_bill)
      or public.json_steps_include_current_user(p_bill.steps)
      or public.json_steps_role_matches(p_bill.steps)
      or (
        public.current_finance_role() in ('section_chief', 'dept_manager')
        and p_bill.department_code = public.current_finance_department()
      )
    )
$function$;

CREATE OR REPLACE FUNCTION public.can_read_expense_request(p_request expense_requests)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select
    nullif(public.current_finance_user_id(), '') is not null
    and nullif(public.finance_current_verified_google_email_v2(), '') is not null
    and p_request.tenant_id = public.current_tenant_id()
    and (
      public.is_finance_accounting()
      or p_request.applicant = public.current_finance_user_name()
      or p_request.form_payload -> 'applicantProfile' ->> 'id' =
         public.current_finance_user_id()
      or lower(nullif(
           p_request.form_payload -> 'applicantProfile' ->> 'email',
           ''
         )) = public.finance_current_verified_google_email_v2()
      or public.json_steps_include_current_user(p_request.steps)
      or public.json_steps_role_matches(p_request.steps)
      or (
        public.current_finance_role() in ('section_chief', 'dept_manager')
        and p_request.department_code = public.current_finance_department()
      )
      or (
        public.current_finance_role() = 'hr'
        and p_request.type = 'welfare_request'
      )
      or (
        public.current_finance_role() = 'general_affairs'
        and p_request.type = 'purchase_request'
      )
    )
$function$;

CREATE OR REPLACE FUNCTION public.can_read_invoice(p_invoice invoices)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select
    nullif(public.current_finance_user_id(), '') is not null
    and nullif(public.finance_current_verified_google_email_v2(), '') is not null
    and p_invoice.tenant_id = public.current_tenant_id()
    and (
      public.is_finance_accounting()
      or p_invoice.applicant = public.current_finance_user_name()
      or p_invoice.applicant_id = public.current_finance_user_id()
      or public.json_steps_include_current_user(p_invoice.steps)
      or public.json_steps_role_matches(p_invoice.steps)
      or (
        public.current_finance_role() in ('section_chief', 'dept_manager')
        and p_invoice.department_code = public.current_finance_department()
      )
    )
$function$;

CREATE OR REPLACE FUNCTION public.current_finance_user()
 RETURNS finance_users
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_auth_user_id uuid := auth.uid();
  v_tenant_id uuid;
  v_verified_email text;
  v_user public.finance_users%rowtype;
begin
  if v_auth_user_id is null then
    return null;
  end if;

  v_verified_email := public.finance_verified_google_email(v_auth_user_id);
  if v_verified_email is null then
    return null;
  end if;

  v_tenant_id := public.current_tenant_id();
  if v_tenant_id is null then
    return null;
  end if;

  select fu.*
  into v_user
  from public.finance_users fu
  where fu.tenant_id = v_tenant_id
    and fu.active = true
    and fu.auth_user_id = v_auth_user_id
    and fu.google_link_status in ('bound', 'pending_rebind')
    and lower(pg_catalog.btrim(fu.email)) = v_verified_email
  order by fu.created_at asc, fu.id asc
  limit 1;

  return v_user;
end;
$function$;

CREATE OR REPLACE FUNCTION public.finance_current_verified_google_email_v2()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select lower(btrim(fu.email))
  from public.finance_users fu
  where fu.tenant_id = public.current_tenant_id()
    and fu.active = true
    and fu.auth_user_id = auth.uid()
    and fu.google_link_status in ('bound', 'pending_rebind')
    and public.finance_verified_google_email(auth.uid()) = lower(btrim(fu.email))
  order by fu.created_at asc, fu.id asc
  limit 1
$function$;

CREATE OR REPLACE FUNCTION public.finance_verified_google_email(p_auth_user_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
  select lower(btrim(identity.identity_data ->> 'email'))
  from auth.identities identity
  join auth.users auth_user
    on auth_user.id = identity.user_id
  where identity.user_id = p_auth_user_id
    and identity.provider = 'google'
    and lower(coalesce(
      identity.identity_data ->> 'email_verified',
      'false'
    )) in ('true', '1')
    and coalesce(btrim(identity.identity_data ->> 'email'), '') <> ''
    and lower(split_part(
      btrim(identity.identity_data ->> 'email'),
      '@',
      2
    )) = 'suiyuecare.com'
    -- GOOGLE_WORKSPACE_PRIMARY_EMAIL_RENAME_V1: the verified Google identity email is authoritative.
  order by identity.created_at asc, identity.id asc
  limit 1;
$function$;

CREATE OR REPLACE FUNCTION public.current_finance_department()
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select (public.current_finance_user()).department_code
$function$;

CREATE OR REPLACE FUNCTION public.current_finance_role()
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select (public.current_finance_user()).role
$function$;

CREATE OR REPLACE FUNCTION public.current_finance_user_id()
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select (public.current_finance_user()).id
$function$;

CREATE OR REPLACE FUNCTION public.current_finance_user_name()
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select (public.current_finance_user()).name
$function$;

CREATE OR REPLACE FUNCTION public.default_tenant_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select id from public.tenants where slug = 'suiyuecare' limit 1
$function$;

CREATE OR REPLACE FUNCTION public.finance_has_active_membership(p_tenant_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select auth.uid() is not null
    and exists (
      select 1
      from public.finance_users membership
      where membership.tenant_id = p_tenant_id
        and membership.auth_user_id = auth.uid()
        and membership.active = true
    );
$function$;

CREATE OR REPLACE FUNCTION public.is_bill_owner(p_bill bills)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select
    nullif(public.current_finance_user_id(), '') is not null
    and nullif(public.finance_current_verified_google_email_v2(), '') is not null
    and p_bill.tenant_id = public.current_tenant_id()
    and (
      p_bill.applicant = public.current_finance_user_name()
      or p_bill.applicant_id = public.current_finance_user_id()
      or lower(nullif(p_bill.applicant_email, '')) =
         public.finance_current_verified_google_email_v2()
    )
$function$;

CREATE OR REPLACE FUNCTION public.is_finance_accounting()
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select coalesce(public.current_finance_role() in ('ceo','admin_director','accountant'), false)
$function$;

CREATE OR REPLACE FUNCTION public.json_steps_include_current_user(steps jsonb)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  with caller as (
    select
      nullif(public.current_finance_user_id(), '') as viewer_id,
      nullif(public.finance_current_verified_google_email_v2(), '') as viewer_email,
      nullif(public.current_finance_user_name(), '') as viewer_name
  ),
  step_rows as (
    select step_value as step
    from pg_catalog.jsonb_array_elements(
      case
        when pg_catalog.jsonb_typeof(steps) = 'array' then steps
        else '[]'::jsonb
      end
    ) as step_values(step_value)
  ),
  action_rows as (
    select action_value as action
    from step_rows
    cross join lateral pg_catalog.jsonb_array_elements(
      (
        case
          when pg_catalog.jsonb_typeof(step -> 'actionLog') = 'array'
            then step -> 'actionLog'
          else '[]'::jsonb
        end
      ) || (
        case
          when pg_catalog.jsonb_typeof(step -> 'action_log') = 'array'
            then step -> 'action_log'
          else '[]'::jsonb
        end
      ) || (
        case
          when pg_catalog.jsonb_typeof(step -> 'actions') = 'array'
            then step -> 'actions'
          else '[]'::jsonb
        end
      )
    ) as action_values(action_value)
  )
  select
    caller.viewer_id is not null
    and caller.viewer_email is not null
    and (
      exists (
        select 1
        from step_rows
        where caller.viewer_id = any (array[
          step ->> 'uid', step ->> 'userId', step ->> 'user_id',
          step ->> 'approverId', step ->> 'approver_id',
          step ->> 'actorId', step ->> 'actor_id',
          step ->> 'financeUserId', step ->> 'finance_user_id',
          step ->> 'byId', step ->> 'by_id'
        ])
        or caller.viewer_email = any (array[
          lower(nullif(step ->> 'email', '')),
          lower(nullif(step ->> 'userEmail', '')),
          lower(nullif(step ->> 'user_email', '')),
          lower(nullif(step ->> 'approverEmail', '')),
          lower(nullif(step ->> 'approver_email', '')),
          lower(nullif(step ->> 'actorEmail', '')),
          lower(nullif(step ->> 'actor_email', '')),
          lower(nullif(step ->> 'byEmail', '')),
          lower(nullif(step ->> 'by_email', ''))
        ])
        or (
          caller.viewer_name is not null
          and (
            step ->> 'n' = caller.viewer_name
            or step ->> 'name' = caller.viewer_name
            or step ->> 'approver' = caller.viewer_name
            or step ->> 'approverName' = caller.viewer_name
            or step ->> 'approver_name' = caller.viewer_name
            or step ->> 'actor' = caller.viewer_name
            or step ->> 'actorName' = caller.viewer_name
            or step ->> 'actor_name' = caller.viewer_name
            or step ->> 'by' = caller.viewer_name
            or coalesce(step ->> 'r', '') like '%' || caller.viewer_name || '%'
            or coalesce(step ->> 'label', '') like '%' || caller.viewer_name || '%'
            or coalesce(step ->> 'title', '') like '%' || caller.viewer_name || '%'
          )
        )
      )
      or exists (
        select 1
        from action_rows
        where case
          when coalesce(
            nullif(action ->> 'byId', ''),
            nullif(action ->> 'by_id', ''),
            nullif(action ->> 'actorFinanceUserId', ''),
            nullif(action ->> 'actor_finance_user_id', ''),
            nullif(action ->> 'actorId', ''),
            nullif(action ->> 'actor_id', ''),
            nullif(action ->> 'financeUserId', ''),
            nullif(action ->> 'finance_user_id', ''),
            nullif(action ->> 'userId', ''),
            nullif(action ->> 'user_id', '')
          ) is not null then caller.viewer_id = any (array[
            action ->> 'byId', action ->> 'by_id',
            action ->> 'actorFinanceUserId', action ->> 'actor_finance_user_id',
            action ->> 'actorId', action ->> 'actor_id',
            action ->> 'financeUserId', action ->> 'finance_user_id',
            action ->> 'userId', action ->> 'user_id'
          ])
          when coalesce(
            nullif(action ->> 'byEmail', ''),
            nullif(action ->> 'by_email', ''),
            nullif(action ->> 'actorEmail', ''),
            nullif(action ->> 'actor_email', ''),
            nullif(action ->> 'userEmail', ''),
            nullif(action ->> 'user_email', ''),
            nullif(action ->> 'email', '')
          ) is not null then caller.viewer_email = any (array[
            lower(nullif(action ->> 'byEmail', '')),
            lower(nullif(action ->> 'by_email', '')),
            lower(nullif(action ->> 'actorEmail', '')),
            lower(nullif(action ->> 'actor_email', '')),
            lower(nullif(action ->> 'userEmail', '')),
            lower(nullif(action ->> 'user_email', '')),
            lower(nullif(action ->> 'email', ''))
          ])
          else caller.viewer_name is not null and (
            action ->> 'by' = caller.viewer_name
            or action ->> 'actor' = caller.viewer_name
            or action ->> 'actorName' = caller.viewer_name
            or action ->> 'actor_name' = caller.viewer_name
            or action ->> 'reviewer' = caller.viewer_name
            or action ->> 'reviewerName' = caller.viewer_name
            or action ->> 'reviewer_name' = caller.viewer_name
            or action ->> 'name' = caller.viewer_name
          )
        end
      )
    )
  from caller
$function$;

CREATE OR REPLACE FUNCTION public.json_steps_role_matches(steps jsonb)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from jsonb_array_elements(coalesce(steps, '[]'::jsonb)) s
    where s ->> 'rk' = public.current_finance_role()
       or s ->> 'role' = public.current_finance_role()
       or s ->> 'approver_role' = public.current_finance_role()
       or s ->> 'approverRole' = public.current_finance_role()
       or s ->> 'role_key' = public.current_finance_role()
       or s ->> 'roleKey' = public.current_finance_role()
       or s ->> 'key' = public.current_finance_role()
  )
$function$;

CREATE OR REPLACE FUNCTION public.current_tenant_id()
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_auth_user_id uuid := auth.uid();
  v_requested_tenant_id uuid := nullif(
    pg_catalog.current_setting('app.current_tenant_id', true),
    ''
  )::uuid;
  v_verified_email text;
  v_tenant_id uuid;
begin
  if v_auth_user_id is null then
    return coalesce(v_requested_tenant_id, public.default_tenant_id());
  end if;

  v_verified_email := public.finance_verified_google_email(v_auth_user_id);
  if v_verified_email is null then
    return null;
  end if;

  select tm.tenant_id
  into v_tenant_id
  from public.tenant_members tm
  where tm.active = true
    and tm.auth_user_id = v_auth_user_id
    and lower(pg_catalog.btrim(tm.email)) = v_verified_email
    and (
      v_requested_tenant_id is null
      or tm.tenant_id = v_requested_tenant_id
    )
  order by
    case when tm.tenant_id = v_requested_tenant_id then 0 else 1 end,
    case when tm.tenant_id = public.default_tenant_id() then 0 else 1 end,
    tm.created_at asc,
    tm.id asc
  limit 1;

  if v_tenant_id is not null then
    return v_tenant_id;
  end if;

  select fu.tenant_id
  into v_tenant_id
  from public.finance_users fu
  where fu.active = true
    and fu.auth_user_id = v_auth_user_id
    and fu.google_link_status in ('bound', 'pending_rebind')
    and lower(pg_catalog.btrim(fu.email)) = v_verified_email
    and (
      v_requested_tenant_id is null
      or fu.tenant_id = v_requested_tenant_id
    )
  order by
    case when fu.tenant_id = v_requested_tenant_id then 0 else 1 end,
    case when fu.tenant_id = public.default_tenant_id() then 0 else 1 end,
    fu.created_at asc,
    fu.id asc
  limit 1;

  return v_tenant_id;
end;
$function$;
set check_function_bodies = on;
