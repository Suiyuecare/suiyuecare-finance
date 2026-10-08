\set ON_ERROR_STOP on

-- One digest only. The rehearsal compares it before and after rollback;
-- no finance records or identities are printed.
with signatures(signature) as (
  values
    ('private.finance_history_actor_v1()'),
    ('public.finance_identity_matches_current_v1(text[],text[],text[])'),
    ('private.finance_history_document_search_v1(text,text,jsonb)'),
    ('private.finance_personal_document_authorized_v1(public.finance_users,text,text,text)'),
    ('private.finance_expense_optional_permission_allows(uuid,text,text,jsonb)'),
    ('private.finance_personal_history_page_allows_v1(public.finance_users)'),
    ('public.finance_approval_history_summary_v1(integer,integer,text,text)'),
    ('public.finance_approval_history_detail_v1(text,text)'),
    ('public.finance_approval_participant_history_for_current_user(integer,integer,text,text)'),
    ('public.finance_personal_document_summary_v1(text,integer,integer,text,text)'),
    ('public.finance_personal_document_detail_v1(text,text)')
), function_parts as (
  select 'function:' || signature as key,
    coalesce(pg_catalog.md5(pg_catalog.concat_ws('|',
      p.proowner::text, p.prosecdef::text, p.provolatile::text,
      p.proconfig::text, p.proacl::text,
      pg_catalog.pg_get_functiondef(p.oid))), 'absent') as value
  from signatures s
  left join pg_catalog.pg_proc p on p.oid = pg_catalog.to_regprocedure(s.signature)
), data_parts as (
  select 'public.expense_requests'::text as key,
    pg_catalog.md5(coalesce(pg_catalog.string_agg(pg_catalog.md5(pg_catalog.to_jsonb(r)::text),
      E'\n' order by pg_catalog.to_jsonb(r)::text),'')) as value
    from public.expense_requests r
  union all
  select 'public.bills',
    pg_catalog.md5(coalesce(pg_catalog.string_agg(pg_catalog.md5(pg_catalog.to_jsonb(r)::text),
      E'\n' order by pg_catalog.to_jsonb(r)::text),''))
    from public.bills r
  union all
  select 'public.invoices',
    pg_catalog.md5(coalesce(pg_catalog.string_agg(pg_catalog.md5(pg_catalog.to_jsonb(r)::text),
      E'\n' order by pg_catalog.to_jsonb(r)::text),''))
    from public.invoices r
  union all
  select 'public.approval_step_actor_snapshots',
    pg_catalog.md5(coalesce(pg_catalog.string_agg(pg_catalog.md5(pg_catalog.to_jsonb(r)::text),
      E'\n' order by pg_catalog.to_jsonb(r)::text),''))
    from public.approval_step_actor_snapshots r
  union all
  select 'private.finance_history_source_projection_v1',
    pg_catalog.md5(coalesce(pg_catalog.string_agg(pg_catalog.md5(pg_catalog.to_jsonb(r)::text),
      E'\n' order by pg_catalog.to_jsonb(r)::text),''))
    from private.finance_history_source_projection_v1 r
  union all
  select 'public.system_settings',
    pg_catalog.md5(coalesce(pg_catalog.string_agg(pg_catalog.md5(pg_catalog.to_jsonb(r)::text),
      E'\n' order by pg_catalog.to_jsonb(r)::text),''))
    from public.system_settings r
  union all
  select 'supabase_migrations.schema_migrations',
    pg_catalog.md5(coalesce(pg_catalog.string_agg(pg_catalog.md5(pg_catalog.to_jsonb(r)::text),
      E'\n' order by pg_catalog.to_jsonb(r)::text),''))
    from supabase_migrations.schema_migrations r
), parts as (
  select * from function_parts
  union all select * from data_parts
)
select pg_catalog.md5(pg_catalog.string_agg(key || '=' || value, E'\n' order by key)) as fingerprint
from parts;
