select version || ':' || encode(extensions.digest(convert_to(array_to_string(statements, E'\n'),'UTF8'),'sha256'),'hex') as source_identity
from supabase_migrations.schema_migrations
where version in ('20261020022748','20261020022750','20261020022751','20261020023444','20261020025210')
order by version;
