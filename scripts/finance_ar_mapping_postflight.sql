\set ON_ERROR_STOP on
-- Repeatable read-only catalog and absent-identity checks.
do $finance_ar_mapping_postflight$
declare hr_bridge_installed boolean:=false;p record;spec record;denied boolean;
begin
 if to_regclass('supabase_migrations.schema_migrations') is not null then
  execute $hr_ledger$select count(*)=2 from supabase_migrations.schema_migrations where version in ('20260922072109','20260922075604')$hr_ledger$ into hr_bridge_installed;
 end if;
 select * into p from pg_proc where oid=to_regprocedure('private.finance_ar_ledger_v1(uuid,text,date,text)');
 if p.oid is null or md5(p.prosrc)<>'328871795ff8787e301008540a1b4bee' or not p.prosecdef or p.provolatile<>'s'
  or pg_get_userbyid(p.proowner)<>'postgres' or p.proconfig is distinct from array['search_path=""']::text[]
  or has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('authenticated',p.oid,'EXECUTE')
  or has_function_privilege('service_role',p.oid,'EXECUTE')
  or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE') then
  raise exception 'Canonical AR mapper source/authority differs';
 end if;
 for spec in select * from (values
  ('private.finance_ar_invoice_v1(public.invoices,date,jsonb)','60d4707fabaf84287a521b2b58ac7324'),
  ('private.finance_receivables_payload_v1(date,text,text,text,boolean)','d9a4cde2bf54f8c447d9a3a22df226c6'),
  ('private.finance_ar_reconciliation_scope_v1(uuid,text,date,text,text)',(case when hr_bridge_installed then '26608ab5d0e8aca1e74294f53b4c884f' else '481d1d0b1ec6a302b2a44f5a22996ea9' end)),
  ('private.finance_ar_reconciliation_v1(uuid,text,date,text,text,jsonb)','e9cb655eca0ebd5d4c7f72a66d13ce33'),
  ('public.finance_receivables_v1(date,text,text,text)','3919420d06b2c7818615f757fa759195'),
  ('public.finance_executive_dashboard_v3(date,date,date,date,date,text,text)',(case when hr_bridge_installed then '3d370f03d925cb8318a65e382b83cae1' else '36e536eb3ccfc071a8541719022597f1' end))
 ) baseline(signature,source_md5) loop
  if not exists(select 1 from pg_proc where oid=to_regprocedure(spec.signature) and md5(prosrc)=spec.source_md5) then
   raise exception 'Canonical AR mapper caller or financial scope changed: %',spec.signature;
  end if;
 end loop;
 if auth.uid() is null then
  denied:=false;
  begin perform public.finance_receivables_v1(current_date,null,null,'test');
  exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'Canonical AR accepted absent identity';end if;
 end if;
end;
$finance_ar_mapping_postflight$;

