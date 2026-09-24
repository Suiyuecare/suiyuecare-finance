\set ON_ERROR_STOP on
-- Read-only adoption check recovered from production migration 20260924043205.
-- No employee or company rows are read or emitted.
do $hr_directory_export_postflight$
declare
  r record;
  role_name text;
begin
  for r in select * from (values
    ('private.hr_directory_cursor'),
    ('private.hr_directory_outbox')
  ) x(relation_name) loop
    if to_regclass(r.relation_name) is null
      or not exists(select 1 from pg_class c where c.oid=to_regclass(r.relation_name)
        and c.relowner='postgres'::regrole and c.relrowsecurity and c.relforcerowsecurity)
      or exists(select 1 from pg_policy where polrelid=to_regclass(r.relation_name)) then
      raise exception 'HR directory private storage catalog differs: %',r.relation_name;
    end if;
    foreach role_name in array array['anon','authenticated','service_role'] loop
      if has_table_privilege(role_name,to_regclass(r.relation_name),
        'select,insert,update,delete,truncate,references,trigger') then
        raise exception 'HR directory private storage is directly exposed: %',role_name;
      end if;
    end loop;
  end loop;

  for r in select * from (values
    ('private.hr_directory_changed()','ec057d9df50f5f27907dd9dcf08b82b9',true,'{postgres=X/postgres}'),
    ('private.hr_directory_export(text,jsonb)','f9a6b76125f2112dbbb94003ded39227',true,'{postgres=X/postgres,service_role=X/postgres}'),
    ('public.finance_hr_directory_transport(text,jsonb)','52ba81d3b713847f4e62dbcab666c6bf',false,'{postgres=X/postgres,service_role=X/postgres}')
  ) x(signature,body_md5,security_definer,acl) loop
    if not exists(select 1 from pg_proc p
      where p.oid=to_regprocedure(r.signature)
        and md5(p.prosrc)=r.body_md5
        and p.prosecdef=r.security_definer
        and p.provolatile='v'
        and p.proconfig=array['search_path=""']::text[]
        and p.proacl::text=r.acl
        and pg_get_userbyid(p.proowner)='postgres') then
      raise exception 'HR directory export function differs from the reviewed source: %',r.signature;
    end if;
  end loop;

  foreach role_name in array array['anon','authenticated'] loop
    if has_schema_privilege(role_name,'private','usage')
      or has_function_privilege(role_name,'private.hr_directory_export(text,jsonb)','execute')
      or has_function_privilege(role_name,'public.finance_hr_directory_transport(text,jsonb)','execute') then
      raise exception 'HR directory export is available to an untrusted database role: %',role_name;
    end if;
  end loop;
  if not has_schema_privilege('service_role','private','usage')
    or not has_function_privilege('service_role','private.hr_directory_export(text,jsonb)','execute')
    or not has_function_privilege('service_role','public.finance_hr_directory_transport(text,jsonb)','execute')
    or has_function_privilege('service_role','private.hr_directory_changed()','execute') then
    raise exception 'HR directory export service-role boundary differs';
  end if;

  if (select count(*) from pg_trigger t
    where t.tgname='hr_directory_changed'
      and t.tgenabled='O'
      and t.tgtype=29
      and t.tgfoid='private.hr_directory_changed()'::regprocedure
      and t.tgrelid in (
        'public.finance_users'::regclass,
        'public.companies'::regclass,
        'public.employees'::regclass,
        'public.finance_department_units'::regclass,
        'private.finance_membership_org_versions_v1'::regclass
      ))<>5 then
    raise exception 'HR directory change tracking triggers differ';
  end if;
end;
$hr_directory_export_postflight$;
