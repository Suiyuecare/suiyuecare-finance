\set ON_ERROR_STOP on
-- Fixed additive migration only. Reads catalog and ledger rows; no identity, session or business row.
do $portal_handoff_preflight$
begin
  if not exists(select 1 from supabase_migrations.schema_migrations where version='20261014123017' and name='finance_bounded_global_logout')
     or exists(select 1 from supabase_migrations.schema_migrations where version='20261024210000')
     or pg_catalog.to_regclass('logout_private.module_receipts') is null
     or pg_catalog.to_regprocedure('public.portal_session_status()') is null
     or pg_catalog.to_regclass('public.finance_users') is null then
    raise exception 'Portal handoff prerequisite is missing' using errcode='55000';
  end if;
  if exists(select 1 from pg_catalog.pg_namespace where nspname='portal_handoff_private')
     or pg_catalog.to_regprocedure('public.finance_portal_handoff_consume(jsonb)') is not null
     or pg_catalog.to_regprocedure('public.finance_portal_handoff_finalize(jsonb)') is not null then
    raise exception 'Portal handoff target collision' using errcode='55000';
  end if;
end;
$portal_handoff_preflight$;
select 'FINANCE_PORTAL_HANDOFF_PREFLIGHT_OK' as marker;
