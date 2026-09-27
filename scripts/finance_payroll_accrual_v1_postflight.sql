\set ON_ERROR_STOP on
-- Catalog-only assertions. The release guard supplies its enclosing transaction.
do $payroll_postflight$
declare contractor_installed boolean:=exists(select 1 from pg_constraint where conrelid=to_regclass('finance_hr_private.finance_hr_obligations') and conname='finance_hr_obligations_kind_check' and position('contractor' in pg_get_constraintdef(oid))>0);f record;pin record;r text;policy_name text;allowed boolean;relation text;
begin
 for pin in select * from (values
('finance_hr_private.finance_hr_accounting_scope','abddcba56b7640031bbd0dbcff11764d'),
('finance_hr_private.finance_hr_post_voucher',case when contractor_installed then '01682ebe60f7774a0874404a4c13af18' else '9456cbe480d95c56bd665d589fbaf6da' end),
('private.finance_payroll_accrual_evidence_prepare_v1','beac1cba903258b46926fe28c1e1af65'),
('private.finance_payroll_accrual_json_v1','67ddf0e2d5a37e65ffb1d33c50526e7e'),
('private.finance_payroll_accrual_list_v1','09cd05602aa8c1aa5d94bcf0ee99e684'),
('private.finance_payroll_accrual_review_v1','dee94499bb63d436b02d7cea54e1521a'),
('private.finance_payroll_accrual_save_v1','5a64a65f42e8d11258cd8e816088a298'),
('private.finance_payroll_actor_v1',case when contractor_installed then 'f2551099f51dec0098a20fee5ae85dfa' else 'ec87b7b049655fd858da8b71998e1f37' end),
('private.finance_payroll_book_guard_v1','b4d7ed385e40a3a9032b91f5404d8cf0'),
('private.finance_payroll_entries_v1','bf15cbca29885e790dc1d9fca43ee536'),
('private.finance_payroll_settlement_accounts_v1','c94d56ae505c6e7c619ea0cebf67684b'),
('private.finance_payroll_storage_scope_v1','a5f0f1acd07249b461a382c8d1b331a9'),
('public.finance_payroll_accrual_evidence_prepare_v1','978dc0925f8699fc466b14332b37ffca'),
('public.finance_payroll_accrual_list_v1','99066402d6284e5209c4b5f3dd5e6872'),
('public.finance_payroll_accrual_return_v1','40208a559ede861ed6aadc8622613c7c'),
('public.finance_payroll_accrual_review_v1','593fb3a91bddeb2df9f478ef35cb0b3a'),
('public.finance_payroll_accrual_save_v1','b28387e924c4ec6b2c0d0499806eb916')
 ) seals(name,hash) loop
  select p.* into f from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname||'.'||p.proname=pin.name;
  if f.oid is null or md5(f.prosrc)<>pin.hash or f.proconfig is distinct from array['search_path=""']::text[] then raise exception 'Payroll sealed function changed: %',pin.name;end if;
  if pin.name like 'public.finance_payroll_%' and (not f.prosecdef or f.proowner<>'postgres'::regrole) then raise exception 'Payroll RPC must be bounded postgres definer: %',pin.name;end if;
  if pin.name like 'private.finance_payroll_%' then
   if f.prosecdef is distinct from (f.proname not in('finance_payroll_accrual_json_v1','finance_payroll_settlement_accounts_v1')) then raise exception 'Payroll private security mode changed: %',pin.name;end if;
  end if;
  if pin.name like '%.finance_payroll_%' then
   if exists(select 1 from aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE') then raise exception 'Payroll PUBLIC execute is forbidden: %',pin.name;end if;
   foreach r in array array['anon','authenticated','service_role'] loop
    allowed:=r='authenticated' and (pin.name like 'public.%' or f.proname in('finance_payroll_storage_scope_v1','finance_payroll_accrual_evidence_prepare_v1','finance_payroll_accrual_save_v1','finance_payroll_accrual_review_v1','finance_payroll_accrual_list_v1'));
    if has_function_privilege(r,f.oid,'EXECUTE') is distinct from allowed then raise exception 'Payroll function ACL changed: %, %',pin.name,r;end if;
   end loop;
  end if;
 end loop;
 if (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','private') and p.proname like 'finance_payroll_%')<>15 then raise exception 'Payroll unreviewed function or overload';end if;
 foreach r in array array['anon','authenticated'] loop
  if has_schema_privilege(r,'private','USAGE') then raise exception 'Payroll must preserve private namespace isolation: %',r;end if;
 end loop;
 foreach relation in array array['finance_payroll_accruals_v1','finance_payroll_evidence_intents_v1','finance_payroll_accrual_events_v1'] loop
  if not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relname=relation and c.relrowsecurity and c.relforcerowsecurity) then raise exception 'Payroll relation RLS missing: %',relation;end if;
  foreach r in array array['anon','authenticated','service_role'] loop
   if has_table_privilege(r,'private.'||relation,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then raise exception 'Payroll private table ACL changed: %, %',relation,r;end if;
  end loop;
 end loop;
 if not exists(select 1 from storage.buckets where id='finance-payroll-evidence' and name='finance-payroll-evidence' and public=false and file_size_limit=10485760) then raise exception 'Payroll evidence bucket privacy changed';end if;
 for pin in select * from (values
 ('payroll_evidence_read_v1',true,'r','authenticated'),
 ('payroll_evidence_insert_v1',true,'a','authenticated'),
 ('payroll_evidence_boundary_v1',false,'*','authenticated'),
 ('payroll_evidence_no_update_v1',false,'w','authenticated'),
 ('payroll_evidence_no_delete_v1',false,'d','authenticated'),
 ('payroll_evidence_no_anon_v1',false,'*','anon')) policies(name,permissive,command,role_name) loop
  if not exists(select 1 from pg_policy p where p.polrelid='storage.objects'::regclass and p.polname=pin.name and p.polpermissive=pin.permissive and p.polcmd::text=pin.command and p.polroles=array[(select oid from pg_roles where rolname=pin.role_name)]) then raise exception 'Payroll Storage policy missing: %',pin.name;end if;
 end loop;
 if not exists(select 1 from pg_policy p where p.polrelid='storage.objects'::regclass and p.polname='payroll_evidence_boundary_v1' and position('finance_payroll_storage_scope_v1(name, false)' in pg_get_expr(p.polqual,p.polrelid))>0 and position('finance_payroll_storage_scope_v1(name, true)' in pg_get_expr(p.polwithcheck,p.polrelid))>0) then raise exception 'Payroll evidence current-reader boundary changed';end if;
 foreach policy_name in array array['payroll_evidence_no_update_v1','payroll_evidence_no_delete_v1','payroll_evidence_no_anon_v1'] loop
  if not exists(select 1 from pg_policy p where p.polrelid='storage.objects'::regclass and p.polname=policy_name and pg_get_expr(p.polqual,p.polrelid)='(bucket_id <> ''finance-payroll-evidence''::text)') then raise exception 'Payroll immutable Storage boundary changed: %',policy_name;end if;
 end loop;
 if not exists(select 1 from pg_trigger where tgrelid='public.vouchers'::regclass and tgname='payroll_accrual_atomic' and tgenabled='O' and tgfoid='private.finance_payroll_book_guard_v1()'::regprocedure) or not exists(select 1 from pg_trigger where tgrelid='public.ledger_entries'::regclass and tgname='payroll_accrual_atomic' and tgenabled='O' and tgfoid='private.finance_payroll_book_guard_v1()'::regprocedure) then raise exception 'Payroll atomic book guards changed';end if;
 if not exists(select 1 from pg_index where indexrelid='private.finance_payroll_accrual_once_v1'::regclass and indisunique and indisvalid) or not exists(select 1 from pg_index where indexrelid='public.payroll_accrual_book_once_v1'::regclass and indisunique and indisvalid) then raise exception 'Payroll deduplication indexes missing';end if;
 if exists(select 1 from private.finance_payroll_accruals_v1 a where a.status='posted' and (a.reviewer_id is null or a.reviewer_id=a.author_id or a.voucher_id is null or not exists(select 1 from public.vouchers v where v.id=a.voucher_id and v.tenant_id=a.tenant_id and v.entries=a.entries and v.posted))) then raise exception 'Payroll posted workpaper/voucher invariant broken';end if;
end $payroll_postflight$;
