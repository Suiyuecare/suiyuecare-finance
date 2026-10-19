\set ON_ERROR_STOP on
-- Hashes/counts only; contains no identity, organization content or bank data.
with org_snapshot as (select pg_catalog.jsonb_build_object('version_rows',count(*),'published_count',count(*) filter(where status='published'),
 'versions_hash',pg_catalog.encode(extensions.digest(pg_catalog.string_agg(id::text||':'||status||':'||pg_catalog.md5(snapshot::text)||':'||coalesce(source_runtime_revision,''),',' order by version_no),'sha256'),'hex'),
 'runtime_hash',private.finance_org_runtime_revision_v2('00000000-0000-0000-0000-000000000001')) as fingerprint
from private.finance_membership_org_versions_v1 where tenant_id='00000000-0000-0000-0000-000000000001')
select fingerprint from org_snapshot;
