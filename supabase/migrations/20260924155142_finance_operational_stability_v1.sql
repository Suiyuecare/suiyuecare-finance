-- Adds tenant-scoped source indexes, avoids duplicate scans in approval identity
-- health, and pins known mutable function paths.
-- No approval policy, tenant boundary, business row, or writer is changed.
set local lock_timeout = '5s';

do $preflight$
declare
  r record;
  p pg_catalog.pg_proc%rowtype;
begin
  for r in
    select * from (values
      ('public.touch_application_accounting_lines_updated_at()','9b1889f56258bf9d6554213c05019c76'),
      ('public.touch_payee_bank_accounts_updated_at()','9b1889f56258bf9d6554213c05019c76'),
      ('public.hr_department_type_from_code(text,text)','d561637a2b653cebab1b49d6b1ed764f'),
      ('public.hr_role_scope(text)','f2e681731cf8844e1b73307b7970ede9'),
      ('private.finance_approval_steps_array(jsonb)','70c0fe6dcdcf257da351bede246d592e'),
      ('private.finance_approval_step_role_key(jsonb)','bc8e15b8ada8b22248ada4e15f4be9e8'),
      ('private.finance_approval_step_is_approved(jsonb)','b37d58840473bb7027c6a92a20d65d5e'),
      ('private.finance_steps_role_approved(jsonb,text[])','e08d86689b08e0d54de8cd9e27b74068'),
      ('private.finance_unapproved_step_count(jsonb)','6a41c6da09c7b5f65d6c071d26f90b32')
    ) v(signature, body_md5)
  loop
    select * into p from pg_catalog.pg_proc where oid=pg_catalog.to_regprocedure(r.signature);
    if p.oid is null or pg_catalog.md5(p.prosrc)<>r.body_md5 or p.prosecdef
       or pg_catalog.pg_get_userbyid(p.proowner)<>'postgres'
       or p.proconfig is not null then
      raise exception 'Operational stability helper changed from reviewed baseline: %',r.signature;
    end if;
  end loop;

  select * into p from pg_catalog.pg_proc
  where oid='public.current_hr_user_company_id()'::pg_catalog.regprocedure;
  if p.oid is null or pg_catalog.md5(p.prosrc)<>'23299be734759a421b3e2bd9383cd589'
     or not p.prosecdef or p.provolatile<>'s' or p.proconfig is distinct from array['search_path=public']::text[]
     or pg_catalog.pg_get_userbyid(p.proowner)<>'postgres'
     or not pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE')
     or not pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE')
     or not pg_catalog.has_function_privilege('service_role',p.oid,'EXECUTE')
     or exists(select 1 from pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
               where a.grantee=0 and a.privilege_type='EXECUTE') then
    raise exception 'Current HR company helper changed from reviewed baseline';
  end if;

  select * into p from pg_catalog.pg_proc
  where oid='public.finance_approval_actor_health(text)'::pg_catalog.regprocedure;
  if p.oid is null or pg_catalog.md5(p.prosrc)<>'77d395c61eaea88183d6ea3ca70ed089'
     or p.prosecdef or p.provolatile<>'s' or p.proconfig is distinct from array['search_path=public']::text[]
     or pg_catalog.pg_get_userbyid(p.proowner)<>'postgres'
     or pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE')
     or not pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE')
     or not pg_catalog.has_function_privilege('service_role',p.oid,'EXECUTE')
     or exists(select 1 from pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
               where a.grantee=0 and a.privilege_type='EXECUTE') then
    raise exception 'Approval actor health RPC changed from reviewed baseline';
  end if;

  if exists (
    select 1 from pg_catalog.pg_class c
    where c.oid in ('public.expense_requests'::pg_catalog.regclass,
                    'public.bills'::pg_catalog.regclass,
                    'public.invoices'::pg_catalog.regclass)
      and not c.relrowsecurity
  ) then
    raise exception 'Statement source tables must retain row-level security';
  end if;
end;
$preflight$;

-- Match both the tenant/environment equality predicates and the stable ID order.
create index if not exists expense_requests_tenant_environment_id_stability_idx
  on public.expense_requests (tenant_id, data_environment, id);
create index if not exists bills_tenant_environment_id_stability_idx
  on public.bills (tenant_id, data_environment, id);
create index if not exists invoices_tenant_environment_id_stability_idx
  on public.invoices (tenant_id, data_environment, id);

-- This check previously opened 4 source scans and expanded the same JSON steps twice.
create or replace function public.finance_approval_actor_health(p_data_environment text default 'production')
returns jsonb
language plpgsql stable security invoker
set search_path = ''
as $function$
declare
  v_tenant uuid := public.current_tenant_id();
  legacy_or_missing_count int := 0;
  role_only_count int := 0;
begin
  with steps as (
    select jsonb_array_elements(coalesce(r.steps, '[]'::jsonb)) as step
    from public.expense_requests r
    where r.tenant_id = v_tenant
      and coalesce(r.data_environment, 'production') = coalesce(p_data_environment, 'production')
    union all
    select jsonb_array_elements(coalesce(i.steps, '[]'::jsonb)) as step
    from public.invoices i
    where i.tenant_id = v_tenant
      and coalesce(i.data_environment, 'production') = coalesce(p_data_environment, 'production')
  )
  select count(*) filter (
           where coalesce(step ->> 'uid', '') like '%legacy%'
              or coalesce(step ->> 'uid', '') = 'u6_legacy'
         ),
         count(*) filter (
           where coalesce(step ->> 'uid', '') = ''
             and coalesce(step ->> 'rk', step ->> 'approver_role', '') <> ''
         )
  into legacy_or_missing_count, role_only_count
  from steps;

  return jsonb_build_object(
    'ok', legacy_or_missing_count = 0 and role_only_count = 0,
    'tenant_id', v_tenant,
    'data_environment', coalesce(p_data_environment, 'production'),
    'legacy_or_missing_count', legacy_or_missing_count,
    'role_only_count', role_only_count,
    'compatibility_mode', true
  );
end;
$function$;
alter function public.finance_approval_actor_health(text) owner to postgres;
revoke all on function public.finance_approval_actor_health(text) from public, anon;
grant execute on function public.finance_approval_actor_health(text) to authenticated, service_role;

-- The HR helper is SECURITY DEFINER but reads only the caller's active row and
-- already uses fully qualified names. Pin its path and close the anonymous grant.
alter function public.current_hr_user_company_id() set search_path = '';
revoke all on function public.current_hr_user_company_id() from public, anon;
grant execute on function public.current_hr_user_company_id() to authenticated, service_role;

-- These helpers are not SECURITY DEFINER and keep their existing ACLs. Pinning
-- search_path to pg_catalog-only resolution prevents search-path hijacking.
alter function public.touch_application_accounting_lines_updated_at() set search_path = '';
alter function public.touch_payee_bank_accounts_updated_at() set search_path = '';
alter function public.hr_department_type_from_code(text,text) set search_path = '';
alter function public.hr_role_scope(text) set search_path = '';
alter function private.finance_approval_steps_array(jsonb) set search_path = '';
alter function private.finance_approval_step_role_key(jsonb) set search_path = '';
alter function private.finance_approval_step_is_approved(jsonb) set search_path = '';
alter function private.finance_steps_role_approved(jsonb,text[]) set search_path = '';
alter function private.finance_unapproved_step_count(jsonb) set search_path = '';

do $postflight$
declare
  p pg_catalog.pg_proc%rowtype;
  r record;
  role_name text;
  expected boolean;
begin
  for r in select * from (values
    ('public.touch_application_accounting_lines_updated_at()','9b1889f56258bf9d6554213c05019c76'),
    ('public.touch_payee_bank_accounts_updated_at()','9b1889f56258bf9d6554213c05019c76'),
    ('public.hr_department_type_from_code(text,text)','d561637a2b653cebab1b49d6b1ed764f'),
    ('public.hr_role_scope(text)','f2e681731cf8844e1b73307b7970ede9'),
    ('private.finance_approval_steps_array(jsonb)','70c0fe6dcdcf257da351bede246d592e'),
    ('private.finance_approval_step_role_key(jsonb)','bc8e15b8ada8b22248ada4e15f4be9e8'),
    ('private.finance_approval_step_is_approved(jsonb)','b37d58840473bb7027c6a92a20d65d5e'),
    ('private.finance_steps_role_approved(jsonb,text[])','e08d86689b08e0d54de8cd9e27b74068'),
    ('private.finance_unapproved_step_count(jsonb)','6a41c6da09c7b5f65d6c071d26f90b32')
  ) v(signature,body_md5) loop
    select * into p from pg_catalog.pg_proc where oid=pg_catalog.to_regprocedure(r.signature);
    if p.oid is null or pg_catalog.md5(p.prosrc)<>r.body_md5 or p.prosecdef
       or p.proconfig is distinct from array['search_path=""']::text[]
       or pg_catalog.pg_get_userbyid(p.proowner)<>'postgres' then
      raise exception 'Function search_path postflight failed: %',r.signature;
    end if;
  end loop;

  select * into p from pg_catalog.pg_proc where oid='public.current_hr_user_company_id()'::pg_catalog.regprocedure;
  if not p.prosecdef or p.provolatile<>'s' or pg_catalog.md5(p.prosrc)<>'23299be734759a421b3e2bd9383cd589'
     or p.proconfig is distinct from array['search_path=""']::text[]
     or pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE')
     or not pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE')
     or not pg_catalog.has_function_privilege('service_role',p.oid,'EXECUTE')
     or exists(select 1 from pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE') then
    raise exception 'Current HR company helper access contract failed';
  end if;

  select * into p from pg_catalog.pg_proc where oid='public.finance_approval_actor_health(text)'::pg_catalog.regprocedure;
  if p.prosecdef or p.provolatile<>'s' or p.proconfig is distinct from array['search_path=""']::text[]
     or pg_catalog.md5(p.prosrc)<>'96acac6e2745bc4786bcc5b7fd58fd5a'
     or pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE')
     or not pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE')
     or not pg_catalog.has_function_privilege('service_role',p.oid,'EXECUTE')
     or exists(select 1 from pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE') then
    raise exception 'Approval actor health access or calculation contract failed';
  end if;

  select * into p from pg_catalog.pg_proc where oid='public.finance_statement_source_page_v1(text,text,integer,integer)'::pg_catalog.regprocedure;
  if p.prosecdef or p.provolatile<>'s' or p.proconfig is distinct from array['search_path=""']::text[]
     or pg_catalog.md5(p.prosrc)<>'fe39d7ec0b151e30cc36e9e2cb7538dc'
     or not pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE')
     or pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE')
     or pg_catalog.has_function_privilege('service_role',p.oid,'EXECUTE')
     or exists(select 1 from pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE') then
    raise exception 'Statement source page access or result contract failed';
  end if;

  for r in select unnest(array[
    'expense_requests_tenant_environment_id_stability_idx',
    'bills_tenant_environment_id_stability_idx',
    'invoices_tenant_environment_id_stability_idx'
  ]) index_name loop
    if not exists(select 1 from pg_catalog.pg_index i join pg_catalog.pg_class c on c.oid=i.indexrelid
                  where c.relname=r.index_name and i.indisvalid and i.indisready) then
      raise exception 'Statement source index missing or invalid: %',r.index_name;
    end if;
  end loop;
  foreach role_name in array array['anon','authenticated','service_role'] loop
    if role_name='anon' and pg_catalog.has_function_privilege(role_name,'public.current_hr_user_company_id()'::pg_catalog.regprocedure,'EXECUTE') then
      raise exception 'Anonymous access remains on current HR company helper';
    end if;
  end loop;
end;
$postflight$;

notify pgrst, 'reload schema';
