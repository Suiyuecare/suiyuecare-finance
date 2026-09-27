do $$begin
 if md5(pg_get_functiondef('public.current_finance_user()'::regprocedure)) <> '9e8c163a86fbdd5d51db53d183ca65b6'
 or md5(pg_get_functiondef('public.finance_current_verified_google_email_v2()'::regprocedure)) <> 'd29cac8c780159085e80f9b23a9350fa' then raise exception 'FINANCE_AUTH_GUARD_BASELINE_CHANGED';end if;
end $$;
create function public.finance_auth_session_active() returns boolean language plpgsql stable security definer set search_path='' as $$
declare sid uuid;
begin
 begin sid:=nullif(auth.jwt()->>'session_id','')::uuid;exception when invalid_text_representation then return false;end;
 if sid is null or auth.uid() is null then return false;end if;
 return exists(select 1 from auth.sessions s where s.id=sid and s.user_id=auth.uid() and (s.not_after is null or s.not_after>statement_timestamp()));
end $$;
revoke all on function public.finance_auth_session_active() from public,anon,service_role;
grant execute on function public.finance_auth_session_active() to authenticated;
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
  if v_auth_user_id is null or not public.finance_auth_session_active() then
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
  where public.finance_auth_session_active() and fu.tenant_id = public.current_tenant_id()
    and fu.active = true
    and fu.auth_user_id = auth.uid()
    and fu.google_link_status in ('bound', 'pending_rebind')
    and public.finance_verified_google_email(auth.uid()) = lower(btrim(fu.email))
  order by fu.created_at asc, fu.id asc
  limit 1
$function$;


create function public.portal_session_status() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor public.finance_users%rowtype:=public.current_finance_user();
begin
 if actor.id is null then raise exception 'FINANCE_AUTH_SESSION_REVOKED' using errcode='42501';end if;
 return jsonb_build_object('active',true,'userId',auth.uid());
end $$;
revoke all on function public.portal_session_status() from public,anon,service_role;
grant execute on function public.portal_session_status() to authenticated;
create function public.portal_revoke_google_sessions(google_subject text,verified_email text) returns jsonb language plpgsql security definer set search_path='' as $$
declare target uuid; candidates bigint; revoked bigint;
begin
 if length(google_subject)<1 or length(google_subject)>256 or verified_email<>lower(btrim(verified_email)) or verified_email !~ '^[^[:space:]@]+@suiyuecare[.]com$' then raise exception 'PORTAL_LOGOUT_INVALID' using errcode='42501';end if;
 execute 'select count(distinct u.id),min(u.id::text)::uuid from auth.users u join auth.identities i on i.user_id=u.id where i.provider=''google'' and coalesce(i.identity_data->>''sub'',i.provider_id)=$1 and u.email_confirmed_at is not null and coalesce((i.identity_data->>''email_verified'')::boolean,false) and lower(i.identity_data->>''email'')=$2' into candidates,target using google_subject,verified_email;
 if candidates>1 then raise exception 'PORTAL_LOGOUT_IDENTITY_AMBIGUOUS' using errcode='42501';end if;
 if candidates=0 then return jsonb_build_object('revoked',true,'matched',false);end if;
 perform 1 from auth.users where id=target for update;
 execute 'delete from auth.sessions where user_id=$1' using target;get diagnostics revoked=row_count;
 return jsonb_build_object('revoked',true,'matched',true);
end $$;
revoke all on function public.portal_revoke_google_sessions(text,text) from public,anon,authenticated;
grant execute on function public.portal_revoke_google_sessions(text,text) to service_role;
notify pgrst,'reload schema';
