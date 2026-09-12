\set ON_ERROR_STOP on
-- Pure catalog/semantic verification; no operational document is changed.
do $history_page_first_postflight$
declare p record; source text; marker text; denied boolean:=false;
begin
 select * into p from pg_proc where oid=to_regprocedure('public.finance_approval_participant_history_for_current_user(integer,integer,text,text)');
 if p.oid is null or md5(p.prosrc)<>'53f526628bded4241c3bbe61de6efcd3' or not p.prosecdef or p.provolatile<>'s'
  or pg_get_userbyid(p.proowner)<>'postgres' or p.proconfig is distinct from array['search_path=""']::text[]
  or not has_function_privilege('authenticated',p.oid,'EXECUTE') or not has_function_privilege('service_role',p.oid,'EXECUTE') or has_function_privilege('anon',p.oid,'EXECUTE')
  or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE') then raise exception 'History page-first implementation or authority drifted';end if;
 source:=p.prosrc;
 foreach marker in array array['public.finance_verified_google_email(v_auth_user_id)','v_member_count <> 1','snapshot.tenant_id = v_user.tenant_id','snapshot.data_environment = v_environment','snapshot.resolved_user_id = v_user.id',
  'candidate_groups as materialized','participant_groups as materialized','left join participant_groups participant_group','private.finance_history_document_search_v1(v_search','jsonb_build_array(group_amount)','limit v_limit offset v_offset'] loop
  if position(marker in source)=0 then raise exception 'History page-first contract absent: %',marker;end if;
 end loop;
 if auth.uid() is null then
  begin perform public.finance_approval_participant_history_for_current_user(1,0,null,'test');exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'History page-first accepted anonymous identity';end if;
 end if;
end;
$history_page_first_postflight$;
