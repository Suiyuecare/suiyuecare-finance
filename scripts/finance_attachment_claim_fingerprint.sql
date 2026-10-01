\set ON_ERROR_STOP on

-- Stable schema-only fingerprint. No attachment filenames or request data leave
-- the database, and ordinary production submissions cannot change the result.
with parts as (
  select
    'function'::text as kind,
    'private.finance_claim_attachment_metadata_v2()'::text as name,
    pg_catalog.concat_ws(
      '|',
      pg_catalog.pg_get_userbyid(proc_row.proowner),
      proc_row.prosecdef::text,
      proc_row.proconfig::text,
      proc_row.proacl::text,
      pg_catalog.encode(
        extensions.digest(proc_row.prosrc::bytea, 'sha256'),
        'hex'
      )
    ) as definition
  from pg_catalog.pg_proc proc_row
  where proc_row.oid =
    'private.finance_claim_attachment_metadata_v2()'::regprocedure::oid

  union all

  select
    'index',
    index_row.indexname,
    index_row.indexdef
  from pg_catalog.pg_indexes index_row
  where index_row.schemaname = 'public'
    and index_row.tablename = 'file_attachments'
    and index_row.indexname = 'file_attachments_storage_path_key'

  union all

  select
    'trigger',
    table_row.relname || '.' || trigger_row.tgname,
    pg_catalog.concat_ws(
      '|',
      trigger_row.tgenabled,
      pg_catalog.pg_get_triggerdef(trigger_row.oid, true)
    )
  from pg_catalog.pg_trigger trigger_row
  join pg_catalog.pg_class table_row
    on table_row.oid = trigger_row.tgrelid
  where trigger_row.tgfoid =
    'private.finance_claim_attachment_metadata_v2()'::regprocedure::oid
)
select
  'FINANCE_ATTACHMENT_CLAIM_FINGERPRINT' as marker,
  pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(coalesce(
        pg_catalog.string_agg(
          kind || '|' || name || '|' || definition,
          E'\n' order by kind, name
        ),
        ''
      ), 'UTF8'),
      'sha256'
    ),
    'hex'
  ) as schema_sha256,
  count(*) as part_count
from parts;
