CREATE OR REPLACE FUNCTION public.finance_admin_google_account_link_status_v2(p_finance_user_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor_id text := public.current_finance_user_id();
  v_actor_role text := public.current_finance_role();
  v_tenant_id uuid := public.current_tenant_id();
  v_finance public.finance_users%rowtype;
  v_health jsonb;
  v_finance_conflict_count integer;
  v_auth_identity_count integer;
begin
  if v_actor_id is null then
    raise exception '請先使用公司 Google 帳號登入。'
      using errcode = '28000';
  end if;

  select fu.*
  into v_finance
  from public.finance_users fu
  where fu.tenant_id = v_tenant_id
    and fu.id = p_finance_user_id;

  if v_finance.id is null then
    raise exception '找不到目前租戶的人員帳號。'
      using errcode = 'P0002';
  end if;

  if v_actor_id <> v_finance.id
     and v_actor_role not in ('ceo', 'admin_director', 'hr') then
    raise exception '您沒有權限查看其他人員的 Google 帳號狀態。'
      using errcode = '42501';
  end if;

  select count(*)::integer
  into v_finance_conflict_count
  from public.finance_users other
  where other.id <> v_finance.id
    and other.active = true
    and (
      lower(btrim(other.email)) in (
        lower(btrim(v_finance.email)),
        lower(btrim(coalesce(v_finance.pending_login_email, v_finance.email)))
      )
      or lower(btrim(coalesce(other.pending_login_email, ''))) in (
        lower(btrim(v_finance.email)),
        lower(btrim(coalesce(v_finance.pending_login_email, v_finance.email)))
      )
    );

  select count(distinct identity.user_id)::integer
  into v_auth_identity_count
  from auth.identities identity
  join auth.users auth_user on auth_user.id = identity.user_id
  where identity.provider = 'google'
    and lower(coalesce(identity.identity_data ->> 'email_verified', 'false')) in ('true', '1')
    and lower(btrim(coalesce(identity.identity_data ->> 'email', ''))) =
        lower(btrim(coalesce(v_finance.pending_login_email, v_finance.email)))
    -- GOOGLE_WORKSPACE_PRIMARY_EMAIL_RENAME_V1: count the verified Google identity, not a stale Auth email.
    and auth_user.deleted_at is null;

  v_health := private.finance_google_projection_health_v2(
    v_finance.tenant_id,
    v_finance.id
  );

  return jsonb_build_object(
    'ok', true,
    'finance_user_id', v_finance.id,
    'status', v_finance.google_link_status,
    'status_label', case v_finance.google_link_status
      when 'pending_first_login' then '等待首次 Google 登入'
      when 'pending_rebind' then '等待新 Google 帳號換綁'
      when 'bound' then '已可使用 Google 登入'
      when 'conflict' then 'Google 帳號衝突'
      else '帳號暫時無法連結'
    end,
    'status_detail', v_finance.google_link_status_detail,
    'current_login_email', v_finance.email,
    'pending_login_email', v_finance.pending_login_email,
    'revision', v_finance.google_link_revision,
    'auth_user_id', v_finance.auth_user_id,
    'google_login_verified_at', v_finance.google_login_verified_at,
    'old_login_still_active',
      v_finance.auth_user_id is not null
      and v_finance.google_link_status in ('bound', 'pending_rebind'),
    'finance_conflict_count', v_finance_conflict_count,
    'verified_google_identity_count', v_auth_identity_count,
    'has_conflict', v_finance_conflict_count > 0 or v_auth_identity_count > 1,
    'projection_health', v_health,
    'next_action', case v_finance.google_link_status
      when 'pending_first_login' then '請本人使用目前設定的公司 Google 主帳號登入一次。'
      when 'pending_rebind' then '原帳號仍可使用；請本人改用新公司 Google 主帳號登入一次。'
      when 'bound' then '不需其他處理。'
      when 'conflict' then '請檢查是否有重複人員或重複 Auth 身分。'
      else '請確認人員帳號為啟用狀態，並重新檢查投影。'
    end
  );
end;
$function$
