-- The original logout receipt fixes a cutoff for durable retries. Sessions
-- created at or after that instant belong to a later login and survive.
create function public.portal_revoke_google_sessions(
  google_subject text, verified_email text, created_before timestamptz
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare target uuid; candidates bigint; revoked bigint;
begin
  if google_subject is null or length(google_subject) not between 1 and 256
    or verified_email is null or verified_email <> lower(btrim(verified_email))
    or verified_email !~ '^[^[:space:]@]+@suiyuecare[.]com$'
    or created_before is null
    or created_before < clock_timestamp() - interval '31 days'
    or created_before > clock_timestamp() + interval '30 seconds' then
    raise exception 'PORTAL_LOGOUT_INVALID' using errcode = '42501';
  end if;
  execute 'select count(distinct u.id),min(u.id::text)::uuid from auth.users u join auth.identities i on i.user_id=u.id where i.provider=''google'' and coalesce(i.identity_data->>''sub'',i.provider_id)=$1 and u.email_confirmed_at is not null and coalesce((i.identity_data->>''email_verified'')::boolean,false) and lower(i.identity_data->>''email'')=$2'
    into candidates,target using google_subject,verified_email;
  if candidates > 1 then
    raise exception 'PORTAL_LOGOUT_IDENTITY_AMBIGUOUS' using errcode = '42501';
  end if;
  if candidates = 0 then return jsonb_build_object('revoked',true,'matched',false); end if;
  perform 1 from auth.users where id = target for update;
  execute 'delete from auth.sessions where user_id=$1 and created_at<$2'
    using target,created_before;
  get diagnostics revoked = row_count;
  return jsonb_build_object('revoked',true,'matched',true,'sessionCount',revoked);
end $$;
revoke all on function public.portal_revoke_google_sessions(text,text,timestamptz)
  from public,anon,authenticated;
grant execute on function public.portal_revoke_google_sessions(text,text,timestamptz)
  to service_role;
notify pgrst,'reload schema';
