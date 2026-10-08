\set ON_ERROR_STOP on

-- Read-only release gate. The source projection must already cover every
-- physical document before the personal history RPC can rely on it.
do $preflight$
declare
  v_actor pg_catalog.pg_proc%rowtype;
  v_match pg_catalog.pg_proc%rowtype;
begin
  if not exists (select 1 from supabase_migrations.schema_migrations
      where version = '20260915050313')
     or not exists (select 1 from supabase_migrations.schema_migrations
      where version = '20260922133752')
     or exists (select 1 from supabase_migrations.schema_migrations
      where version = '20261008055528')
     or pg_catalog.to_regclass('private.finance_history_source_projection_v1') is null
     or pg_catalog.to_regclass('public.approval_step_actor_snapshots') is null
     or pg_catalog.to_regprocedure('private.finance_history_document_search_v1(text,text,jsonb)') is null
     or pg_catalog.to_regprocedure('public.finance_personal_document_summary_v1(text,integer,integer,text,text)') is not null
     or pg_catalog.to_regprocedure('public.finance_personal_document_detail_v1(text,text)') is not null then
    raise exception 'Personal history preflight requires the reviewed prior baseline and no prior installation';
  end if;

  select * into v_actor from pg_catalog.pg_proc
    where oid = pg_catalog.to_regprocedure('private.finance_history_actor_v1()');
  select * into v_match from pg_catalog.pg_proc
    where oid = pg_catalog.to_regprocedure('public.finance_identity_matches_current_v1(text[],text[],text[])');
  if v_actor.oid is null or v_match.oid is null
     or pg_catalog.pg_get_userbyid(v_actor.proowner) <> 'postgres'
     or v_actor.prosecdef or v_actor.provolatile <> 's'
     or v_actor.proconfig is distinct from array['search_path=""']::text[]
     or not v_actor.prosrc like '%finance_verified_google_email%'
     or pg_catalog.pg_get_userbyid(v_match.proowner) <> 'postgres'
     or v_match.prosecdef or v_match.provolatile <> 's'
     or v_match.proconfig is distinct from array['search_path=""']::text[]
     or not v_match.prosrc like '%cardinality(ids)>0%'
     or not v_match.prosrc like '%finance_current_verified_google_email_v2%' then
    raise exception 'Personal history verified identity authority drifted';
  end if;
  if pg_catalog.has_table_privilege('authenticated',
      'private.finance_history_source_projection_v1', 'SELECT')
     or pg_catalog.has_table_privilege('anon',
      'private.finance_history_source_projection_v1', 'SELECT')
     or pg_catalog.has_table_privilege('service_role',
      'private.finance_history_source_projection_v1', 'SELECT') then
    raise exception 'Personal history source projection is publicly readable';
  end if;

  if exists (
    with source_rows as (
      select tenant_id, data_environment, 'expense_requests'::text record_type, id source_id
        from public.expense_requests
      union all
      select tenant_id, data_environment, 'bills', id from public.bills
      union all
      select tenant_id, data_environment, 'invoices', id from public.invoices
    )
    select 1 from source_rows s
    left join private.finance_history_source_projection_v1 p
      on p.tenant_id = s.tenant_id and p.data_environment = s.data_environment
     and p.record_type = s.record_type and p.source_id = s.source_id
    where s.tenant_id is not null and s.data_environment in ('production', 'test')
      and p.source_id is null
  ) then
    raise exception 'Personal history source projection does not cover all documents';
  end if;
end;
$preflight$;

select 'FINANCE_PERSONAL_HISTORY_PREFLIGHT_OK' as marker;
