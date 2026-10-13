\set ON_ERROR_STOP on

-- One personal-history application per durable bill or invoice batch.
-- Authorization still precedes same-table/tenant/environment batch grouping.
-- The identity-once private helper, source rows, projections and business actions
-- remain unchanged. These existing public RPCs retain their owners and ACLs.
set local lock_timeout='5s';
set local statement_timeout='60s';
do $income_batch_ledger_preflight$
begin
  if exists(select 1 from supabase_migrations.schema_migrations
       where version='20261013091838')
     or not exists(select 1 from supabase_migrations.schema_migrations
       where version='20261012112652'
         and name='finance_personal_history_identity_once_v1') then
    raise exception 'Personal income batch history prerequisite or target ledger drift'
      using errcode='55000';
  end if;
end;
$income_batch_ledger_preflight$;

do $income_batch_preflight$
declare v_expected record;v_proc pg_catalog.pg_proc%rowtype;
begin
  for v_expected in select * from (values
    ('private.finance_personal_document_authorized_v1(public.finance_users,text,text,text)',false,'1db71550a2ec13ece520e25abb211e09'),
    ('public.finance_personal_document_summary_v1(text,integer,integer,text,text)',true,'f68644d4f30ee10fd4b2bd76da4a2b83'),
    ('public.finance_personal_document_detail_v1(text,text)',true,'34989c18188536e079e63ff81370c2cf'),
    ('private.finance_history_actor_v1()',false,'4fa4b048271075bade4b7ddd3f424fc4'),
    ('private.finance_personal_history_page_allows_v1(public.finance_users)',true,'b2fed44ca1b66208649d50c7bfae921d')
  ) x(signature,security_definer,source_md5) loop
    select * into v_proc from pg_catalog.pg_proc
    where oid=pg_catalog.to_regprocedure(v_expected.signature);
    if v_proc.oid is null or pg_catalog.pg_get_userbyid(v_proc.proowner)<>'postgres'
       or v_proc.prosecdef is distinct from v_expected.security_definer
       or v_proc.provolatile<>'s'
       or v_proc.proconfig is distinct from array['search_path=""']::text[]
       or pg_catalog.md5(v_proc.prosrc) is distinct from v_expected.source_md5
       or pg_catalog.has_function_privilege('anon',v_proc.oid,'EXECUTE')
       or pg_catalog.has_function_privilege('service_role',v_proc.oid,'EXECUTE')
       or pg_catalog.has_function_privilege('authenticated',v_proc.oid,'EXECUTE')
         is distinct from (v_expected.signature like 'public.%')
       or exists(select 1 from pg_catalog.aclexplode(coalesce(v_proc.proacl,
         pg_catalog.acldefault('f',v_proc.proowner))) acl
         where acl.grantee=0 and acl.privilege_type='EXECUTE') then
      raise exception 'Personal income batch preflight source or authority drift: %',
        v_expected.signature using errcode='55000';
    end if;
  end loop;
end;
$income_batch_preflight$;

select 'FINANCE_PERSONAL_INCOME_BATCH_HISTORY_PREFLIGHT_OK' as marker;
