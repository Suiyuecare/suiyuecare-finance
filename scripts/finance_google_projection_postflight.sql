\set ON_ERROR_STOP on
-- Catalog-only verification; compatible with an empty auth context.
do $google_projection_postflight$
declare p record;spec record;
begin
 for spec in select * from (values
  ('private.finance_google_projection_health_v2(uuid,text)','eed6ff8fa5e2f56d994fc9b25e1412ea',true,'s',false),
  ('private.finance_google_projection_email_mismatch_v3(text,jsonb,text,text)','75f17041bddc1cac87ffc08c18ca6e72',false,'i',false),
  ('public.finance_admin_google_account_link_status_v2(text)','d2d0ec07e44f8b02ffb337233aa152fd',true,'s',true)
 ) expected(signature,source_md5,definer,volatility,browser_access) loop
  select * into p from pg_proc where oid=to_regprocedure(spec.signature);
  if p.oid is null or md5(p.prosrc) is distinct from spec.source_md5
   or p.prosecdef is distinct from spec.definer or p.provolatile::text is distinct from spec.volatility
   or pg_get_userbyid(p.proowner)<>'postgres' or p.proconfig is distinct from array['search_path=""']::text[]
   or has_function_privilege('anon',p.oid,'EXECUTE')
   or has_function_privilege('authenticated',p.oid,'EXECUTE') is distinct from spec.browser_access
   or has_function_privilege('service_role',p.oid,'EXECUTE') is distinct from spec.browser_access
   or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE') then
   raise exception 'Google diagnostic source/authority differs: %',spec.signature;
  end if;
 end loop;
end;
$google_projection_postflight$;
