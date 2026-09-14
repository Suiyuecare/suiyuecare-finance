-- Production catalog read predicates; only fixture authentication transport is synthetic.
CREATE OR REPLACE FUNCTION public.current_finance_department()
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select (public.current_finance_user()).department_code
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
