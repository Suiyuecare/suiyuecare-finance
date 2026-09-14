-- Pure fictional JSON and catalog checks; no business rows, employee claims or writes.
begin isolation level repeatable read read only;
set local lock_timeout='5s';
set local statement_timeout='60s';
-- FINANCE_AUTHENTICATED_CANARY_CORE_BEGIN
do $google_projection_canary$
declare denied boolean;r text;
begin
 if nullif(current_setting('request.jwt.claim.sub',true),'') is not null
  or nullif(coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb->>'sub','') is not null then
  raise exception 'Google diagnostic proof must not assume an employee identity';end if;
 if private.finance_google_projection_email_mismatch_v3('organization_chart','[{"userId":"fixture-u60","userName":"同名","userEmail":"other@example.invalid"}]','fixture-u6','person@example.invalid')
  or private.finance_google_projection_email_mismatch_v3('pptx_organization_roster','{"executive":{"name":"同名","loginEmail":"other@example.invalid"}}','fixture-u6','person@example.invalid')
  or private.finance_google_projection_email_mismatch_v3('organization_chart','[{"userId":"fixture-u6","userEmail":" Person@Example.Invalid "}]','fixture-u6','person@example.invalid')
  or not private.finance_google_projection_email_mismatch_v3('organization_chart','[{"userId":"fixture-u6","userEmail":"wrong@example.invalid"},{"userId":"fixture-u5","userEmail":"person@example.invalid"}]','fixture-u6','person@example.invalid')
  or not private.finance_google_projection_email_mismatch_v3('organization_chart','[{"userId":"fixture-u6"}]','fixture-u6','person@example.invalid') then
  raise exception 'Google diagnostic exact ID/email pairing failed';end if;
 foreach r in array array['anon','authenticated','service_role'] loop
  execute format('set local role %I',r);
  denied:=false;
  begin perform private.finance_google_projection_email_mismatch_v3('organization_chart','[]','fixture-u6','person@example.invalid');
  exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'Private Google diagnostic accepted browser role';end if;
  execute 'reset role';
 end loop;
 execute 'set local role authenticated';
 denied:=false;
 begin perform public.finance_admin_google_account_link_status_v2('fixture-personnel-canary-does-not-exist');
 exception when invalid_authorization_specification or insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Google status RPC accepted absent actor';end if;
 execute 'reset role';
end;
$google_projection_canary$;
-- FINANCE_AUTHENTICATED_CANARY_CORE_END
rollback;
-- FINANCE_AUTHENTICATED_CANARY_ROLLBACK_CHECK_BEGIN
do $google_projection_rollback$
begin
 if current_user in ('anon','authenticated','service_role') or nullif(current_setting('request.jwt.claim.sub',true),'') is not null
  or nullif(coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb->>'sub','') is not null then
  raise exception 'Read-only Google diagnostic left an actor context';end if;
end;
$google_projection_rollback$;
-- FINANCE_AUTHENTICATED_CANARY_ROLLBACK_CHECK_END
select jsonb_build_object('canary','readonly_google_projection_v3','ok',true,'rolled_back',true,'identity_scope_preserved',true) as google_projection_canary_result;
