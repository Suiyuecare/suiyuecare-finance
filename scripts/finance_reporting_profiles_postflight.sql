\set ON_ERROR_STOP on
-- Repeatable read-only catalog and invariant checks; no source/profile mutation.
do $finance_reporting_profiles_postflight$
declare proc_row record; r text; api text; required_names text[]:=array['finance_reporting_default_v1','finance_reporting_page_level_v1','finance_reporting_actor_v1','finance_reporting_shape_v1','finance_reporting_account_v1','finance_reporting_department_v1','finance_reporting_documents_scope_v1','finance_reporting_profile_scope_v1','finance_reporting_validate_v1','finance_reporting_revision_immutable_v1']; n integer; source text;
begin
 if to_regclass('public.finance_reporting_profiles') is null or to_regclass('private.finance_reporting_profile_revisions_v1') is null then raise exception 'Reporting profile tables unavailable';end if;
 select count(*) into n from pg_class where oid in ('public.finance_reporting_profiles'::regclass,'private.finance_reporting_profile_revisions_v1'::regclass) and relrowsecurity;
 if n<>2 then raise exception 'Reporting profile RLS unavailable';end if;
 foreach r in array array['anon','authenticated','service_role'] loop
  if has_table_privilege(r,'public.finance_reporting_profiles','SELECT,INSERT,UPDATE,DELETE') or has_table_privilege(r,'private.finance_reporting_profile_revisions_v1','SELECT,INSERT,UPDATE,DELETE') then raise exception 'Reporting direct-table privileges exposed to %',r;end if;
 end loop;
 foreach api in array array['public.finance_reporting_profile_read_v1(text,text)','public.finance_reporting_profile_save_v1(text,bigint,jsonb,text,text)','public.finance_reporting_profile_history_v1(text,text)'] loop
  if to_regprocedure(api) is null or not has_function_privilege('authenticated',api,'EXECUTE') or has_function_privilege('anon',api,'EXECUTE') or has_function_privilege('service_role',api,'EXECUTE') then raise exception 'Reporting RPC execute contract failed: %',api;end if;
  if not exists(select 1 from pg_proc where oid=to_regprocedure(api) and prosecdef and proconfig @> array['search_path=""']) then raise exception 'Reporting RPC security path failed: %',api;end if;
 end loop;
 select count(*) into n from pg_proc where pronamespace='private'::regnamespace and proname=any(required_names);
 if n<>cardinality(required_names) then raise exception 'Reporting private helper set incomplete';end if;
 for proc_row in select oid,proname,proconfig from pg_proc where pronamespace='private'::regnamespace and proname=any(required_names) loop
  if not proc_row.proconfig @> array['search_path=""'] then raise exception 'Unsafe reporting helper path: %',proc_row.proname;end if;
  foreach r in array array['anon','authenticated','service_role'] loop if has_function_privilege(r,proc_row.oid,'EXECUTE') then raise exception 'Reporting private helper exposed: %',proc_row.proname;end if;end loop;
 end loop;
 if not exists(select 1 from pg_trigger where tgrelid='private.finance_reporting_profile_revisions_v1'::regclass and tgname='finance_reporting_revision_immutable_v1' and tgenabled='O' and not tgisinternal) then raise exception 'Reporting immutable audit trigger missing';end if;
 source:=pg_get_functiondef('public.finance_reporting_profile_save_v1(text,bigint,jsonb,text,text)'::regprocedure);
 if position('pg_advisory_xact_lock' in source)=0 or position('rev<>p_expected_revision' in source)=0 or position('p_profile-''documents''-''tax''' in source)=0 or position('finance_reporting_profile_revisions_v1' in source)=0 then raise exception 'Reporting save CAS, narrow path authorization or audit contract missing';end if;
 if exists(select 1 from public.finance_reporting_profiles p left join private.finance_reporting_profile_revisions_v1 h using(tenant_id,data_environment,entity_id,revision) where h.revision is null or h.profile is distinct from p.profile or h.actor_id is distinct from p.updated_by) then raise exception 'Reporting current profile does not match its audited revision';end if;
 if exists(select 1 from public.finance_reporting_profiles p join lateral(select max(revision) revision from private.finance_reporting_profile_revisions_v1 where tenant_id=p.tenant_id and data_environment=p.data_environment and entity_id=p.entity_id) h on true where h.revision<>p.revision) then raise exception 'Reporting current revision is not latest audit revision';end if;
 perform private.finance_reporting_shape_v1('{"amount":null,"flag":false}'::jsonb,'{"amount":"amount","flag":"boolean"}');
 if private.finance_reporting_default_v1()->'tax' ? 'formType' then raise exception 'Reporting default may not guess company filing type';end if;
end;
$finance_reporting_profiles_postflight$;
