-- Read-only capture 2026-09-24; preserves production approval helper semantics.
CREATE OR REPLACE FUNCTION private.finance_step_is_approved(p_step jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
  select
    coalesce(p_step ->> 'a', '') in ('approved', 'AUTO')
    or coalesce(p_step ->> 'status', '') in ('approved', 'auto_approved', 'skipped')
    or lower(coalesce(p_step ->> 'auto', 'false')) in ('true', 't', '1', 'yes', 'y')
    or lower(coalesce(p_step ->> 'autoSkip', 'false')) in ('true', 't', '1', 'yes', 'y')
    or lower(coalesce(p_step ->> 'autoMerged', 'false')) in ('true', 't', '1', 'yes', 'y')
    or lower(coalesce(p_step ->> 'skipped', 'false')) in ('true', 't', '1', 'yes', 'y')
$function$;

CREATE OR REPLACE FUNCTION private.finance_step_is_negative_terminal(p_step jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
  select
    coalesce(p_step ->> 'a', '') in ('rejected', 'rejected_all', 'cancelled')
    or coalesce(p_step ->> 'status', '') in ('rejected', 'cancelled')
$function$;

CREATE OR REPLACE FUNCTION private.finance_step_role_key(p_step jsonb)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
  select coalesce(
    nullif(p_step ->> 'rk', ''),
    nullif(p_step ->> 'roleKey', ''),
    nullif(p_step ->> 'role', ''),
    nullif(p_step ->> 'key', ''),
    ''
  )
$function$;

CREATE OR REPLACE FUNCTION private.finance_invoice_fully_approved(p_steps jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
  with steps as (
    select value as step
    from jsonb_array_elements(
      case
        when jsonb_typeof(coalesce(p_steps, '[]'::jsonb)) = 'array'
          then coalesce(p_steps, '[]'::jsonb)
        else '[]'::jsonb
      end
    )
  )
  select
    exists (select 1 from steps)
    and exists (
      select 1 from steps
      where private.finance_step_role_key(step) = 'applicant_invoice_delivery'
        and private.finance_step_is_approved(step)
    )
    and not exists (
      select 1 from steps
      where not private.finance_step_is_approved(step)
        and not private.finance_step_is_negative_terminal(step)
    )
$function$;
