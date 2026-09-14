CREATE OR REPLACE FUNCTION private.finance_google_projection_health_v2(p_tenant_id uuid, p_finance_user_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_finance public.finance_users%rowtype;
  v_verified_email text;
  v_current_auth_identity_count integer;
  v_pending_auth_identity_count integer;
  v_employee_count integer;
  v_employee_email_mismatch_count integer;
  v_portal_active_count integer;
  v_portal_exact_count integer;
  v_portal_stale_active_count integer;
  v_tenant_member_exact_count integer;
  v_identity_link_exact_count integer;
  v_edr_email_mismatch_count integer;
  v_org_email_mismatch_count integer;
  v_ok boolean;
begin
  select fu.*
  into v_finance
  from public.finance_users fu
  where fu.tenant_id = p_tenant_id
    and fu.id = p_finance_user_id;

  if v_finance.id is null then
    return jsonb_build_object(
      'ok', false,
      'missing_finance_user', true
    );
  end if;

  v_verified_email := public.finance_verified_google_email(v_finance.auth_user_id);

  select count(*)::integer
  into v_current_auth_identity_count
  from auth.identities identity
  join auth.users auth_user on auth_user.id = identity.user_id
  where identity.provider = 'google'
    and lower(coalesce(identity.identity_data ->> 'email_verified', 'false')) in ('true', '1')
    and lower(btrim(coalesce(identity.identity_data ->> 'email', ''))) = lower(btrim(v_finance.email))
    -- GOOGLE_WORKSPACE_PRIMARY_EMAIL_RENAME_V1: current identity email is authoritative.
    and auth_user.deleted_at is null;

  select count(*)::integer
  into v_pending_auth_identity_count
  from auth.identities identity
  join auth.users auth_user on auth_user.id = identity.user_id
  where v_finance.pending_login_email is not null
    and identity.provider = 'google'
    and lower(coalesce(identity.identity_data ->> 'email_verified', 'false')) in ('true', '1')
    and lower(btrim(coalesce(identity.identity_data ->> 'email', ''))) = lower(btrim(v_finance.pending_login_email))
    -- GOOGLE_WORKSPACE_PRIMARY_EMAIL_RENAME_V1: pending identity email is authoritative.
    and auth_user.deleted_at is null;

  select
    count(*)::integer,
    count(*) filter (
      where lower(btrim(coalesce(e.email, ''))) <> lower(btrim(v_finance.email))
    )::integer
  into v_employee_count, v_employee_email_mismatch_count
  from public.employees e
  where e.employee_no = v_finance.id
     or e.metadata ->> 'finance_user_id' = v_finance.id;

  select
    count(*) filter (where u.status = 'active')::integer,
    count(*) filter (
      where u.status = 'active'
        and lower(btrim(u.email)) = lower(btrim(v_finance.email))
        and u.auth_user_id is not distinct from v_finance.auth_user_id
    )::integer,
    count(*) filter (
      where u.status = 'active'
        and (
          lower(btrim(u.email)) <> lower(btrim(v_finance.email))
          or u.auth_user_id is distinct from v_finance.auth_user_id
        )
    )::integer
  into v_portal_active_count, v_portal_exact_count, v_portal_stale_active_count
  from public.users u
  join public.employees e on e.id = u.employee_id
  where e.employee_no = v_finance.id
     or e.metadata ->> 'finance_user_id' = v_finance.id;

  select count(*)::integer
  into v_tenant_member_exact_count
  from public.tenant_members tm
  where tm.tenant_id = v_finance.tenant_id
    and tm.finance_user_id = v_finance.id
    and tm.active = true
    and tm.auth_user_id is not distinct from v_finance.auth_user_id
    and lower(btrim(tm.email)) = lower(btrim(v_finance.email));

  select count(*)::integer
  into v_identity_link_exact_count
  from public.finance_identity_links fil
  where fil.tenant_id = v_finance.tenant_id
    and fil.finance_user_id = v_finance.id
    and fil.active = true
    and fil.logging_user_id is not distinct from v_finance.auth_user_id::text
    and lower(btrim(fil.logging_email)) = lower(btrim(v_finance.email))
    and lower(btrim(fil.finance_email)) = lower(btrim(v_finance.email));

  select count(*)::integer
  into v_edr_email_mismatch_count
  from public.employee_department_roles edr
  where edr.tenant_id = v_finance.tenant_id
    and edr.finance_user_id = v_finance.id
    and edr.active = true
    and (
      lower(btrim(coalesce(edr.metadata ->> 'contact_email', ''))) <> lower(btrim(v_finance.email))
      or lower(btrim(coalesce(edr.metadata -> 'source_payload' ->> 'userEmail', ''))) <> lower(btrim(v_finance.email))
    );

  select count(*)::integer
  into v_org_email_mismatch_count
  from public.system_settings ss
  where ss.tenant_id = v_finance.tenant_id
    and ss.key in ('organization_chart', 'pptx_organization_roster')
    and (
      ss.value::text like '%' || v_finance.id || '%'
      or position(v_finance.name in ss.value::text) > 0
    )
    and position(v_finance.email in ss.value::text) = 0;

  v_ok := v_employee_count >= 1
    and v_employee_email_mismatch_count = 0
    and v_portal_active_count = 1
    and v_portal_exact_count = 1
    and v_portal_stale_active_count = 0
    and v_edr_email_mismatch_count = 0
    and v_org_email_mismatch_count = 0
    and case
      when v_finance.google_link_status = 'bound' then
        v_finance.auth_user_id is not null
        and v_verified_email = lower(btrim(v_finance.email))
        and v_current_auth_identity_count = 1
        and v_tenant_member_exact_count = 1
        and v_identity_link_exact_count = 1
      when v_finance.google_link_status = 'pending_first_login' then
        v_finance.auth_user_id is null
        and v_tenant_member_exact_count = 0
        and v_identity_link_exact_count = 0
      when v_finance.google_link_status in ('pending_rebind', 'conflict', 'blocked') then
        true
      else false
    end;

  return jsonb_build_object(
    'ok', v_ok,
    'finance_user_id', v_finance.id,
    'status', v_finance.google_link_status,
    'current_login_email', v_finance.email,
    'pending_login_email', v_finance.pending_login_email,
    'auth_user_id', v_finance.auth_user_id,
    'verified_google_email', v_verified_email,
    'current_auth_identity_count', v_current_auth_identity_count,
    'pending_auth_identity_count', v_pending_auth_identity_count,
    'employee_count', v_employee_count,
    'employee_email_mismatch_count', v_employee_email_mismatch_count,
    'active_portal_user_count', v_portal_active_count,
    'exact_portal_user_count', v_portal_exact_count,
    'stale_active_portal_user_count', v_portal_stale_active_count,
    'tenant_member_exact_count', v_tenant_member_exact_count,
    'identity_link_exact_count', v_identity_link_exact_count,
    'edr_email_mismatch_count', v_edr_email_mismatch_count,
    'organization_projection_mismatch_count', v_org_email_mismatch_count
  );
end;
$function$
