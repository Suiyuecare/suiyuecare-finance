\set ON_ERROR_STOP on
do $operational_stability_postflight$
declare
  p pg_catalog.pg_proc%rowtype;
  r record;
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

  if exists(select 1 from pg_catalog.pg_class c
            where c.oid in ('public.expense_requests'::pg_catalog.regclass,
                            'public.bills'::pg_catalog.regclass,
                            'public.invoices'::pg_catalog.regclass)
              and not c.relrowsecurity) then
    raise exception 'Statement source row-level security is disabled';
  end if;

  for r in select * from (values
    ('expense_requests_tenant_environment_id_stability_idx','expense_requests'),
    ('bills_tenant_environment_id_stability_idx','bills'),
    ('invoices_tenant_environment_id_stability_idx','invoices')
  ) v(index_name,table_name) loop
    if not exists(select 1 from pg_catalog.pg_index i
                  join pg_catalog.pg_class index_row on index_row.oid=i.indexrelid
                  where index_row.relname=r.index_name
                    and i.indrelid=pg_catalog.to_regclass('public.'||r.table_name)
                    and i.indisvalid and i.indisready and not i.indisunique
                    and i.indpred is null and i.indexprs is null
                    and pg_catalog.pg_get_indexdef(i.indexrelid)=pg_catalog.format(
                      'CREATE INDEX %I ON public.%I USING btree (tenant_id, data_environment, id)',
                      r.index_name,r.table_name)) then
      raise exception 'Statement source index definition missing or invalid: %',r.index_name;
    end if;
  end loop;
end;
$operational_stability_postflight$;
select jsonb_build_object('check','finance_operational_stability_v1','ok',true) as operational_stability_postflight;
