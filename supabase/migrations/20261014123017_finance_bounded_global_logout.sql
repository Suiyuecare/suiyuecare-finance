begin;
-- Service-only, immutable logout operation; retries never widen the time boundary.
create schema if not exists logout_private;
revoke all on schema logout_private from public, anon, authenticated;
create table logout_private.module_receipts (
 operation_id uuid primary key,
 google_subject text not null,
 verified_email text not null,
 revoke_before timestamptz not null,
 expires_at timestamptz not null,
 result jsonb,
 created_at timestamptz not null default statement_timestamp()
);
alter table logout_private.module_receipts enable row level security;
alter table logout_private.module_receipts force row level security;
revoke all on logout_private.module_receipts from public, anon, authenticated, service_role;
create function public.portal_revoke_google_sessions_v2(operation_id uuid, google_subject text, verified_email text, revoke_before timestamptz, operation_expires_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $body$
declare receipt logout_private.module_receipts; target uuid; candidates bigint; revoked bigint; answer jsonb;
begin
 if operation_id is null or google_subject is null or length(google_subject)<1 or length(google_subject)>256 or verified_email is null or verified_email<>lower(btrim(verified_email)) or verified_email !~ '^[^[:space:]@]+@suiyuecare[.]com$'
 or revoke_before is null or revoke_before>statement_timestamp()+interval '5 seconds' or revoke_before<statement_timestamp()-interval '15 minutes'
 or operation_expires_at is null or operation_expires_at<=statement_timestamp() or operation_expires_at<=revoke_before or operation_expires_at>revoke_before+interval '15 minutes' then
 raise exception 'PORTAL_LOGOUT_INVALID' using errcode='42501'; end if;
 insert into logout_private.module_receipts values(operation_id,google_subject,verified_email,revoke_before,operation_expires_at,null,statement_timestamp()) on conflict do nothing;
 select * into receipt from logout_private.module_receipts r where r.operation_id=portal_revoke_google_sessions_v2.operation_id for update;
 if receipt.google_subject<>google_subject or receipt.verified_email<>verified_email or receipt.revoke_before<>revoke_before or receipt.expires_at<>operation_expires_at then raise exception 'PORTAL_LOGOUT_OPERATION_MISMATCH' using errcode='42501';end if;
 if receipt.result is not null then return receipt.result;end if;
 select count(distinct u.id),min(u.id::text)::uuid into candidates,target from auth.users u join auth.identities i on i.user_id=u.id
 where i.provider='google' and coalesce(i.identity_data->>'sub',i.provider_id)=google_subject and u.email_confirmed_at is not null
 and coalesce((i.identity_data->>'email_verified')::boolean,false) and lower(i.identity_data->>'email')=verified_email;
 if candidates>1 then raise exception 'PORTAL_LOGOUT_IDENTITY_AMBIGUOUS' using errcode='42501';end if;
 if candidates=1 then
 perform 1 from auth.users where id=target for update;
 -- __MODULE_HANDOFF_FENCE__
 delete from auth.sessions s where s.user_id=target and coalesce(nullif(to_jsonb(s)->>'created_at','')::timestamptz,'-infinity'::timestamptz)<=revoke_before;
 get diagnostics revoked=row_count;
 end if;
 answer:=jsonb_build_object('revoked',true,'operationId',operation_id,'cutoff',revoke_before);
 update logout_private.module_receipts r set result=answer where r.operation_id=portal_revoke_google_sessions_v2.operation_id;
 return answer;
end $body$;
revoke all on function public.portal_revoke_google_sessions_v2(uuid,text,text,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.portal_revoke_google_sessions_v2(uuid,text,text,timestamptz,timestamptz) to service_role;
notify pgrst,'reload schema';
commit;
