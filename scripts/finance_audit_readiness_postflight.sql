\set ON_ERROR_STOP on
-- Read-only schema/authority checks. This does not certify financial statements.
do $finance_audit_readiness_postflight$
declare sig text;p record;rel text;denied boolean:=false;sample jsonb;
begin
 foreach sig in array array['private.finance_audit_period_v1(text)','private.finance_audit_item_default_v1()','private.finance_audit_case_default_v1()','private.finance_audit_source_v1(uuid,text,text)','private.finance_audit_links_v1(uuid,text,text,jsonb)','private.finance_audit_validate_v1(uuid,text,text,jsonb,jsonb,text,text)','private.finance_audit_revision_immutable_v1()','public.finance_audit_case_read_v1(text,text,text)','public.finance_audit_case_save_v1(text,text,bigint,text,jsonb,text,text)','public.finance_audit_case_history_v1(text,text,text)'] loop
  select * into p from pg_proc where oid=to_regprocedure(sig);
  if p.oid is null or pg_get_userbyid(p.proowner)<>'postgres' or p.proconfig is distinct from array['search_path=""']::text[]
   or has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('service_role',p.oid,'EXECUTE')
   or has_function_privilege('authenticated',p.oid,'EXECUTE') is distinct from (left(sig,7)='public.')
   or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE') then raise exception 'Audit readiness RPC ACL/path differs: %',sig;end if;
  if left(sig,7)='public.' and (not p.prosecdef or position('private.finance_reporting_actor_v1' in p.prosrc)=0) then raise exception 'Audit readiness verified reporting scope missing';end if;
 end loop;
 foreach rel in array array['private.finance_audit_cases_v1','private.finance_audit_case_revisions_v1'] loop
  if not exists(select 1 from pg_class where oid=to_regclass(rel) and relrowsecurity)
   or has_table_privilege('anon',rel,'SELECT,INSERT,UPDATE,DELETE') or has_table_privilege('authenticated',rel,'SELECT,INSERT,UPDATE,DELETE') or has_table_privilege('service_role',rel,'SELECT,INSERT,UPDATE,DELETE') then raise exception 'Audit readiness table directly exposed';end if;
 end loop;
 if not exists(select 1 from pg_trigger where tgrelid=to_regclass('private.finance_audit_case_revisions_v1') and tgname='finance_audit_revision_immutable_v1' and tgenabled='O' and tgfoid=to_regprocedure('private.finance_audit_revision_immutable_v1()')) then raise exception 'Audit revision immutability missing';end if;
 select * into p from pg_proc where oid=to_regprocedure('public.finance_audit_case_save_v1(text,text,bigint,text,jsonb,text,text)');
 if not p.prosecdef or p.provolatile<>'v' or p.prosrc not like '%canEditWorkpaper%' or p.prosrc not like '%pg_advisory_xact_lock%' or p.prosrc not like '%for update%'
  or p.prosrc not like '%rev<>p_expected_revision%' or p.prosrc not like '%is distinct from p_expected_source_fingerprint%'
  or p.prosrc not like '%insert into private.finance_audit_case_revisions_v1%' then raise exception 'Audit atomic source/revision/write authority missing';end if;
 select * into p from pg_proc where oid=to_regprocedure('private.finance_audit_source_v1(uuid,text,text)');
 if not p.prosecdef or p.provolatile<>'s' or p.prosrc not like '%public.can_read_invoice(i) is true%' or p.prosrc not like '%public.can_read_expense_request(r) is true%'
  or p.prosrc not like '%private.finance_expense_optional_permission_allows%' or p.prosrc not like '%public.finance_reporting_profiles%' or p.prosrc not like '%sha256%'
  or p.prosrc not like '%coalesce(l.data_environment,''production'')=env%' then raise exception 'Audit source scope/digest differs';end if;
 select * into p from pg_proc where oid=to_regprocedure('private.finance_audit_validate_v1(uuid,text,text,jsonb,jsonb,text,text)');
 if p.prosrc not like '%prev->>''preparedBy''=actor%' or p.prosrc not like '%content_changed%' or p.prosrc not like '%''reviewedFingerprint'',fingerprint%' or p.prosrc not like '%private.finance_audit_links_v1%' or p.prosrc not like '%if row->>''applicability''=''unknown'' then raise exception%' then raise exception 'Audit reviewer/source-link authority missing';end if;
 sample:=private.finance_audit_case_default_v1();if (select count(*) from jsonb_object_keys(sample->'items'))<>12 or sample#>>'{items,A01,status}'<>'pending' or sample#>>'{items,A12,applicability}'<>'unknown' then raise exception 'Audit checklist default contract differs';end if;
 perform private.finance_audit_period_v1('2026');perform private.finance_audit_period_v1('2026-09');perform private.finance_audit_period_v1('2026-Q4');
 begin perform private.finance_audit_period_v1('2026-13');exception when invalid_parameter_value then denied:=true;end;
 if not denied then raise exception 'Audit invalid period accepted';end if;
 if auth.uid() is null then
  denied:=false;begin perform public.finance_audit_case_read_v1('A','2026','test');exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'Audit accepted missing authenticated identity';end if;
 end if;
end;
$finance_audit_readiness_postflight$;
