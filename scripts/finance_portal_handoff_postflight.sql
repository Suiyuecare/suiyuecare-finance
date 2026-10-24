\set ON_ERROR_STOP on
-- Catalog and ledger only: function source, authority and private receipt table. No identity rows.
do $portal_handoff_postflight$
declare expected record; proc pg_catalog.pg_proc%rowtype; relation pg_catalog.pg_class%rowtype;
begin
  if not exists(select 1 from supabase_migrations.schema_migrations where version='20261024210000' and name='finance_portal_handoff_v1'
      and pg_catalog.md5(pg_catalog.array_to_string(statements,''))='54578a7b09c112923efc44e0fb06026f') then
    raise exception 'Portal handoff sealed ledger is absent or differs' using errcode='55000';
  end if;
  for expected in select * from (values
    ('public.finance_portal_handoff_consume(jsonb)','49cdf9178c6838a179a3ec16a3e79fbf'),
    ('public.finance_portal_handoff_finalize(jsonb)','0e464eb64ccbc9431a31beb939e2d594')
  ) x(signature,source_md5) loop
    select * into proc from pg_catalog.pg_proc where oid=pg_catalog.to_regprocedure(expected.signature);
    if proc.oid is null or pg_catalog.pg_get_userbyid(proc.proowner) is distinct from 'postgres'
       or proc.prosecdef is distinct from true or proc.proconfig is distinct from array['search_path=""']::text[]
       or pg_catalog.md5(proc.prosrc) is distinct from expected.source_md5
       or pg_catalog.has_function_privilege('service_role',proc.oid,'EXECUTE') is distinct from true
       or pg_catalog.has_function_privilege('anon',proc.oid,'EXECUTE')
       or pg_catalog.has_function_privilege('authenticated',proc.oid,'EXECUTE')
       or exists(select 1 from pg_catalog.aclexplode(coalesce(proc.proacl,pg_catalog.acldefault('f',proc.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE') then
      raise exception 'Portal handoff authority/source drift: %',expected.signature using errcode='55000';
    end if;
  end loop;
  select * into relation from pg_catalog.pg_class where oid=pg_catalog.to_regclass('portal_handoff_private.consumed');
  if relation.oid is null or pg_catalog.pg_get_userbyid(relation.relowner) is distinct from 'postgres'
     or relation.relrowsecurity is distinct from true or relation.relforcerowsecurity is distinct from true
     or exists(select 1 from pg_catalog.pg_policy where polrelid=relation.oid)
     or exists(select 1 from pg_catalog.pg_roles r where r.rolname in ('anon','authenticated','service_role')
       and pg_catalog.has_table_privilege(r.oid,relation.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))
     or pg_catalog.has_schema_privilege('anon','portal_handoff_private','USAGE')
     or pg_catalog.has_schema_privilege('authenticated','portal_handoff_private','USAGE')
     or pg_catalog.has_schema_privilege('service_role','portal_handoff_private','USAGE') then
    raise exception 'Portal handoff private receipt authority drift' using errcode='55000';
  end if;
  if (select pg_catalog.array_agg(a.attname||':'||pg_catalog.format_type(a.atttypid,a.atttypmod)||':'||a.attnotnull::text order by a.attnum)
        from pg_catalog.pg_attribute a where a.attrelid=relation.oid and a.attnum>0 and not a.attisdropped)
       is distinct from array['jti:uuid:true','user_id:uuid:true','google_subject:text:true','verified_email:text:true','issued_at:timestamp with time zone:true','expires_at:timestamp with time zone:true','created_at:timestamp with time zone:true']::text[] then
    raise exception 'Portal handoff receipt fields differ' using errcode='55000';
  end if;
end;
$portal_handoff_postflight$;
select 'FINANCE_PORTAL_HANDOFF_POSTFLIGHT_OK' as marker;
