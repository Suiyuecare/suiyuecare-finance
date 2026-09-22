\set ON_ERROR_STOP on
-- Read-only sealed HR bridge catalog checks. No identities or obligations are provisioned.
do $finance_hr_bridge_postflight$
declare expected record;fn record;t text;role_name text;rpc_name text;allowed boolean;seen integer:=0;
begin
 if not has_schema_privilege('authenticated','finance_hr_private','usage') or not has_schema_privilege('service_role','finance_hr_private','usage') or has_schema_privilege('anon','finance_hr_private','usage') then raise exception 'HR bridge private schema access changed';end if;
 foreach role_name in array array['anon','authenticated','service_role'] loop
  if has_schema_privilege(role_name,'finance_hr_private','create') then raise exception 'HR private schema permits object creation: %',role_name;end if;
 end loop;
 foreach t in array array['routes','salary_readers','obligations','events','requests','callback_outbox','callback_delivery','voucher_claims','postings'] loop
  if not exists(select 1 from pg_class where oid=to_regclass('finance_hr_private.finance_hr_'||t) and relrowsecurity and relforcerowsecurity and relkind='r') then raise exception 'HR bridge forced RLS missing: %',t;end if;
  foreach role_name in array array['anon','authenticated','service_role'] loop
   if has_table_privilege(role_name,'finance_hr_private.finance_hr_'||t,'select,insert,update,delete,truncate,references,trigger') then raise exception 'HR bridge direct table access: % / %',role_name,t;end if;
  end loop;
 end loop;
 if (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='finance_hr_private' and c.relkind='r')<>9 then raise exception 'HR bridge unexpected private relation';end if;
 for expected in select * from (values
  ('finance_hr_private.finance_hr_immutable','84e49e5665adbaa56802b06aebf3b93e',false),
  ('finance_hr_private.finance_hr_guard_source','e345efc23936b0896572886febbeadb4',false),
  ('finance_hr_private.finance_hr_guard_route','bd18d2f7e44bfc5153a40c0dc328b1a3',false),
  ('finance_hr_private.finance_hr_hash','b516000f95bd11a0e947a373c2668cc7',false),
  ('finance_hr_private.finance_hr_reader','1ddd3a163428b46d60b151021ee35392',false),
  ('finance_hr_private.finance_hr_route_active','11aa719bab4a1a0432eb750b03a3435f',false),
  ('finance_hr_private.finance_hr_json','31b55b6c30858b8352175d63f362521f',false),
  ('finance_hr_private.finance_hr_emit','850f1b1e1dde02da9b2943672cede41e',false),
  ('finance_hr_private.finance_hr_intake','e7466441abfafdb5079e3a7e163f7a3b',true),
  ('finance_hr_private.finance_hr_snapshot','db29f28ce29ad3e923d3b18420b4432b',true),
  ('finance_hr_private.finance_hr_evidence','8678a81338f11bdc33730f0f9408a83c',false),
  ('finance_hr_private.finance_hr_command','a9c61777902878da2d20dffbdbcb031c',true),
  ('finance_hr_private.finance_hr_applicant_confirm','152445ceb1bbf506a13d71cdc8957ba5',true),
  ('finance_hr_private.finance_hr_callback_claim','aabebcf224bb1a1540bf30f392b4b203',true),
  ('finance_hr_private.finance_hr_callback_ack','24bb86fd555914171710d6de34acf988',true),
  ('public.finance_hr_intake','1b80cad3521013cc3ae613ec6fa43922',false),
  ('public.finance_hr_snapshot','f4a546912a5daf5ea7342cd9f5163997',false),
  ('public.finance_hr_command','c4bf89844af9d577e126e4e53b8a8ddd',false),
  ('public.finance_hr_applicant_confirm','4c1474d59abefe3bf846fe878ae519d9',false),
  ('public.finance_hr_callback_claim','d2e7acf0c48562a76cc4a41ecdf2ba46',false),
  ('public.finance_hr_callback_ack','4e795ca3a93853cebea70aa614784132',false),
  ('finance_hr_private.finance_hr_callback_authorize','828ee7a2f6aad1e3742491a06476ecf8',true),
  ('public.finance_hr_callback_authorize','43054e87683dad0ac401764e8f350caf',false),
  ('finance_hr_private.finance_hr_accounting_scope','fde27da332acff3bb30054ad6caf50a8',true),
  ('public.finance_hr_accounting_scope','23ac15569baf985c4f9546c674afcb2c',false),
  ('finance_hr_private.finance_hr_guard_book_insert','873afdfa552872e12c2d59c5683b964e',true),
  ('finance_hr_private.finance_hr_voucher_options','fa725fffedfbf4be65dc9708b98ea1cc',true),
  ('public.finance_hr_voucher_options','806c35dcce86fe07bfe6fe64aa844bd0',false),
  ('finance_hr_private.finance_hr_post_voucher','574bf7be65ce8c6684c4458359152fbd',true),
  ('public.finance_hr_post_voucher','40c8ac77d8792d6d9ce4e167a12fd7e9',false),
  ('finance_hr_private.finance_hr_attachment_scope','2767c0835ce92b1437eb39522e9c35d1',true),
  ('public.finance_hr_attachment_scope','84f399e41236bb191a79d2305d246ab0',false)
 ) pins(name,body_md5,is_definer) loop
  select p.*,n.nspname into fn from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname||'.'||p.proname=expected.name;
  if fn.oid is null or md5(fn.prosrc)<>expected.body_md5 or fn.prosecdef is distinct from expected.is_definer or fn.proconfig is distinct from array['search_path=""']::text[] then raise exception 'HR bridge function differs from sealed source: %',expected.name;end if;
  rpc_name:=fn.proname;
  foreach role_name in array array['anon','authenticated','service_role'] loop
   allowed:=(role_name='authenticated' and rpc_name in ('finance_hr_snapshot','finance_hr_command','finance_hr_callback_authorize','finance_hr_post_voucher','finance_hr_voucher_options','finance_hr_accounting_scope','finance_hr_attachment_scope')) or (role_name='service_role' and rpc_name in ('finance_hr_intake','finance_hr_applicant_confirm','finance_hr_callback_claim','finance_hr_callback_ack'));
   if has_function_privilege(role_name,fn.oid,'execute') is distinct from allowed then raise exception 'HR bridge execution boundary changed: % / %',role_name,expected.name;end if;
  end loop;
  seen:=seen+1;
 end loop;
 if (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','finance_hr_private') and p.proname like 'finance_hr_%')<>seen then raise exception 'HR bridge unexpected public/private function';end if;
 foreach t in array array['events','requests','callback_outbox','voucher_claims','postings'] loop
  if not exists(select 1 from pg_trigger where tgrelid=to_regclass('finance_hr_private.finance_hr_'||t) and tgname='immutable' and tgenabled='O' and tgtype=27 and tgfoid='finance_hr_private.finance_hr_immutable()'::regprocedure) then raise exception 'HR bridge append-only trigger missing: %',t;end if;
 end loop;
 if not exists(select 1 from pg_trigger where tgrelid='finance_hr_private.finance_hr_obligations'::regclass and tgname='source_frozen' and tgenabled='O' and tgtype=27 and tgfoid='finance_hr_private.finance_hr_guard_source()'::regprocedure) or not exists(select 1 from pg_trigger where tgrelid='finance_hr_private.finance_hr_routes'::regclass and tgname='route_frozen' and tgenabled='O' and tgtype=27 and tgfoid='finance_hr_private.finance_hr_guard_route()'::regprocedure) then raise exception 'HR bridge source/route freeze missing';end if;
 if not exists(select 1 from pg_index i join pg_class c on c.oid=i.indexrelid where c.relname='hr_payroll_ledger_once' and i.indrelid='public.ledger_entries'::regclass and i.indisunique and i.indisvalid and pg_get_indexdef(i.indexrelid)='CREATE UNIQUE INDEX hr_payroll_ledger_once ON public.ledger_entries USING btree (tenant_id, data_environment, posting_key) WHERE (source_type = ''hr_payroll''::text)') then raise exception 'HR duplicate ledger guard changed';end if;
 -- Salary-bearing books, derivative tables, and attachments require the exact
 -- restrictive policy even when another existing SELECT policy permits a row.
 foreach t in array array['vouchers','ledger_entries','cash_movement_evidence_links','finance_ledger_source_chains','accounting_posting_locks','cash_flow_bank_support_cases'] loop
  if not exists(select 1 from pg_class where oid=to_regclass('public.'||t) and relrowsecurity) or not exists(select 1 from pg_policy where polrelid=to_regclass('public.'||t) and polname='hr_salary_complete_scope' and not polpermissive and polcmd='r' and polroles=array[(select oid from pg_roles where rolname='authenticated')] and pg_get_expr(polqual,polrelid)='finance_hr_accounting_scope(tenant_id, entity_id, data_environment)') then raise exception 'HR salary book policy changed: %',t;end if;
 end loop;
 if not exists(select 1 from pg_class where oid='public.file_attachments'::regclass and relrowsecurity) or not exists(select 1 from pg_policy where polrelid='public.file_attachments'::regclass and polname='hr_salary_attachment_scope' and not polpermissive and polcmd='r' and polroles=array[(select oid from pg_roles where rolname='authenticated')] and pg_get_expr(polqual,polrelid)='finance_hr_attachment_scope(tenant_id, record_type, record_no, data_environment)') then raise exception 'HR salary attachment policy changed';end if;
 foreach t in array array['vouchers','ledger_entries'] loop
  if not exists(select 1 from pg_trigger where tgrelid=to_regclass('public.'||t) and tgname='hr_atomic_posting' and tgenabled='O' and tgtype=7 and tgfoid='finance_hr_private.finance_hr_guard_book_insert()'::regprocedure) then raise exception 'HR atomic posting guard missing: %',t;end if;
 end loop;
 for expected in select * from (values
  ('private.finance_ar_reconciliation_scope_v1','3bcf8e913c31899d80f77d01fff08996'),
  ('private.finance_audit_source_v1','911ae3e16749621fe35b77667529ec16'),
  ('public.finance_can_read_voucher_attachment_v2','88217aa61c6b4b185c1fc2329e47cf34'),
  ('public.finance_executive_dashboard_v2','7734154b2b22e212c5dc0774cd4f7a06'),
  ('public.finance_executive_dashboard_v3','3d370f03d925cb8318a65e382b83cae1')
 ) patches(name,body_md5) loop
  if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname||'.'||p.proname=expected.name and md5(p.prosrc)=expected.body_md5) then raise exception 'HR salary report or storage guard differs: %',expected.name;end if;
 end loop;
end;
$finance_hr_bridge_postflight$;
