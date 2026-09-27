\set ON_ERROR_STOP on
-- Catalog-only controls; no employee, journal, archive, or close mutations.
do $finance_audit_controls_20260927$
declare api text;r text;source text;table_name text;pin record;
begin
 if has_schema_privilege('anon','private','USAGE') or has_schema_privilege('authenticated','private','USAGE') then raise exception 'HR directory private namespace boundary changed';end if;
 for pin in select * from (values
  ('private.finance_archive_is_sealed_v1','4358150a7b6a3466f36bee197434c535'),
  ('private.finance_archive_path_allowed_v1','0e127d6f5ae77c3a72df7277a598f2a4'),
  ('private.finance_assert_period_open','a906b97b78869450a13898cb8e045cab'),
  ('private.finance_identity_reference_scope_v1','c498b0895a7648fed43d0af73cee8706'),
  ('private.finance_ledger_period_guard_v1','af802da588d42ee61db2e6641655b4ba'),
  ('private.finance_period_close_guard_v1','c7a85fc0e8d460e4787f1c9150356348'),
  ('public.finance_document_archives_v1','4c9b506397525579e13695dfabbe897e'),
  ('public.finance_reporting_profile_save_v1','b9495397ee61f735b0587c4a0c3dc3be'),
  ('public.finance_seal_document_archive_v1','f3d6088333c1bbf4158a87e7626bb96f'),
  ('public.finance_verify_document_archive_v1','e6c224227b1818ee5ce427641af8ce81')
 ) expected(name,body_md5) loop
  if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname||'.'||p.proname=pin.name and md5(p.prosrc)=pin.body_md5) then raise exception 'Audit controls differ from sealed reviewed function body: %',pin.name;end if;
 end loop;
 foreach table_name in array array['public.finance_document_archives_v1','private.finance_period_close_events_v1','private.finance_archive_verifications_v1','private.finance_reporting_rule_preparers_v1'] loop
  if to_regclass(table_name) is null or not exists(select 1 from pg_class where oid=to_regclass(table_name) and relrowsecurity) then raise exception 'Missing protected audit table: %',table_name;end if;
  foreach r in array array['anon','authenticated','service_role'] loop
   if has_table_privilege(r,table_name,'SELECT,INSERT,UPDATE,DELETE') then raise exception 'Direct audit table capability exposed: %, %',r,table_name;end if;
  end loop;
 end loop;
 foreach api in array array['public.finance_seal_document_archive_v1(text,text,jsonb)','public.finance_document_archives_v1(text,text)','public.finance_verify_document_archive_v1(uuid,integer)','public.finance_reporting_profile_save_v1(text,bigint,jsonb,text,text)'] loop
  if to_regprocedure(api) is null or not exists(select 1 from pg_proc where oid=to_regprocedure(api) and prosecdef and proconfig @> array['search_path=""']) then raise exception 'Audit RPC security contract missing: %',api;end if;
  if not has_function_privilege('authenticated',api,'EXECUTE') or has_function_privilege('anon',api,'EXECUTE') or has_function_privilege('service_role',api,'EXECUTE') then raise exception 'Audit RPC ACL incorrect: %',api;end if;
 end loop;
 foreach api in array array['private.finance_identity_reference_scope_v1()','private.finance_ledger_period_guard_v1()','private.finance_period_close_guard_v1()','public.finance_reporting_profile_save_pre_review_v1(text,bigint,jsonb,text,text)'] loop
  if to_regprocedure(api) is null or not exists(select 1 from pg_proc where oid=to_regprocedure(api) and prosecdef and proconfig @> array['search_path=""']) then raise exception 'Audit private security contract missing: %',api;end if;
  foreach r in array array['anon','authenticated','service_role'] loop if has_function_privilege(r,api,'EXECUTE') then raise exception 'Audit private bypass exposed: %, %',r,api;end if;end loop;
 end loop;
 if not exists(select 1 from pg_proc where oid='private.finance_assert_period_open(uuid,text,text,date,text)'::regprocedure and provolatile='v' and prosecdef and proconfig @> array['search_path=""']) then raise exception 'Period guard must be volatile and scoped';end if;
 source:=pg_get_functiondef('private.finance_assert_period_open(uuid,text,text,date,text)'::regprocedure);
 if position('pg_advisory_xact_lock' in source)=0 or position('finance_period|' in source)=0 or position('c.status=''closed''' in source)=0 then raise exception 'Period guard lost shared lock or closed-period check';end if;
 source:=pg_get_functiondef('private.finance_period_close_guard_v1()'::regprocedure);
 if position('pg_advisory_xact_lock' in source)=0 or position('finance_period|' in source)=0 or position('abs(dr-cr)>=0.005' in source)=0 or position('tg_op=''DELETE''' in source)=0 or position('finance_period_close_events_v1' in source)=0 then raise exception 'Period close lost lock, cent balance, delete guard, or audit';end if;
 if not exists(select 1 from pg_trigger where tgrelid='public.ledger_entries'::regclass and tgname='aa_finance_ledger_period_guard_v1' and tgenabled='O' and (tgtype & 2)=2 and (tgtype & 4)=4 and (tgtype & 8)=8 and (tgtype & 16)=16) then raise exception 'Ledger period BEFORE INSERT/UPDATE/DELETE guard missing';end if;
 if not exists(select 1 from pg_trigger where tgrelid='public.period_closes'::regclass and tgname='finance_period_close_guard_v1' and tgenabled='O' and (tgtype & 2)=2 and (tgtype & 4)=4 and (tgtype & 8)=8 and (tgtype & 16)=16) then raise exception 'Close BEFORE INSERT/UPDATE/DELETE guard missing';end if;
 foreach table_name in array array['finance_identity_links','finance_portal_roles','period_closes'] loop
  if not exists(select 1 from pg_policies where schemaname='public' and tablename=table_name and permissive='RESTRICTIVE' and cmd='ALL' and qual like '%current_tenant_id%' and with_check like '%current_tenant_id%') then raise exception 'Restrictive tenant boundary missing: %',table_name;end if;
 end loop;
 if (select count(*) from pg_constraint where conrelid='public.finance_identity_links'::regclass and conname in('finance_identity_user_tenant_v1','finance_identity_role_tenant_v1') and contype='f' and convalidated)<>2 then raise exception 'Identity tenant foreign keys missing';end if;
 if not exists(select 1 from storage.buckets where id='finance-audit-archives' and not public) then raise exception 'Archive bucket must remain private';end if;
 if (select count(*) from pg_policies where schemaname='storage' and tablename='objects' and policyname in('finance_archive_read_boundary_v1','finance_archive_write_boundary_v1','finance_archive_no_update_v1','finance_archive_no_delete_v1','finance_archive_no_anon_v1') and permissive='RESTRICTIVE')<>5 then raise exception 'Immutable archive storage boundaries missing';end if;
 source:=pg_get_functiondef('public.finance_reporting_profile_save_v1(text,bigint,jsonb,text,text)'::regprocedure);
 if position('finance_reporting_rule_preparers_v1' in source)=0 or position('preparer=actor' in source)=0 or position('finance_reporting_profile_save_pre_review_v1' in source)=0 then raise exception 'Second-person reporting review enforcement missing';end if;
end;
$finance_audit_controls_20260927$;
