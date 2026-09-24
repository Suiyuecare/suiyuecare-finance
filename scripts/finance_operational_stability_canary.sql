-- Catalog and access checks only. No employee claims or business data are read.
begin isolation level repeatable read read only;
set local statement_timeout='15s';
-- FINANCE_AUTHENTICATED_CANARY_CORE_BEGIN
do $operational_stability_canary$
declare
  p pg_catalog.pg_proc%rowtype;
begin
  select * into p from pg_catalog.pg_proc where oid='public.current_hr_user_company_id()'::pg_catalog.regprocedure;
  if p.proconfig is distinct from array['search_path=""']::text[]
     or pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE')
     or not pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE') then
    raise exception 'Current HR helper access boundary changed';
  end if;
  select * into p from pg_catalog.pg_proc where oid='public.finance_approval_actor_health(text)'::pg_catalog.regprocedure;
  if p.proconfig is distinct from array['search_path=""']::text[] or p.prosecdef
     or pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE')
     or not pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE') then
    raise exception 'Approval actor health boundary changed';
  end if;
  select * into p from pg_catalog.pg_proc where oid='public.finance_statement_source_page_v1(text,text,integer,integer)'::pg_catalog.regprocedure;
  if p.proconfig is distinct from array['search_path=""']::text[] or p.prosecdef
     or not pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE')
     or pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE') then
    raise exception 'Statement source paging boundary changed';
  end if;
  if exists(select 1 from pg_catalog.pg_class c
            where c.oid in ('public.expense_requests'::pg_catalog.regclass,
                            'public.bills'::pg_catalog.regclass,
                            'public.invoices'::pg_catalog.regclass)
              and not c.relrowsecurity) then
    raise exception 'Statement source RLS disabled';
  end if;
  if not exists(select 1 from pg_catalog.pg_index i
                join pg_catalog.pg_class index_row on index_row.oid=i.indexrelid
                where index_row.relname='expense_requests_tenant_environment_id_stability_idx'
                  and i.indrelid='public.expense_requests'::pg_catalog.regclass
                  and i.indisvalid and i.indisready and pg_catalog.pg_get_indexdef(i.indexrelid)=
                    'CREATE INDEX expense_requests_tenant_environment_id_stability_idx ON public.expense_requests USING btree (tenant_id, data_environment, id)')
     or not exists(select 1 from pg_catalog.pg_index i
                   join pg_catalog.pg_class index_row on index_row.oid=i.indexrelid
                   where index_row.relname='bills_tenant_environment_id_stability_idx'
                     and i.indrelid='public.bills'::pg_catalog.regclass
                     and i.indisvalid and i.indisready and pg_catalog.pg_get_indexdef(i.indexrelid)=
                       'CREATE INDEX bills_tenant_environment_id_stability_idx ON public.bills USING btree (tenant_id, data_environment, id)')
     or not exists(select 1 from pg_catalog.pg_index i
                   join pg_catalog.pg_class index_row on index_row.oid=i.indexrelid
                   where index_row.relname='invoices_tenant_environment_id_stability_idx'
                     and i.indrelid='public.invoices'::pg_catalog.regclass
                     and i.indisvalid and i.indisready and pg_catalog.pg_get_indexdef(i.indexrelid)=
                       'CREATE INDEX invoices_tenant_environment_id_stability_idx ON public.invoices USING btree (tenant_id, data_environment, id)') then
    raise exception 'Statement source indexes do not match the reviewed tenant page contract';
  end if;
end;
$operational_stability_canary$;
-- FINANCE_AUTHENTICATED_CANARY_CORE_END
rollback;
-- FINANCE_AUTHENTICATED_CANARY_ROLLBACK_CHECK_BEGIN
do $operational_stability_rollback$
begin
  if auth.uid() is not null or current_user in ('anon','authenticated','service_role') then
    raise exception 'Operational stability canary left an employee/browser context';
  end if;
end;
$operational_stability_rollback$;
-- FINANCE_AUTHENTICATED_CANARY_ROLLBACK_CHECK_END
select jsonb_build_object('canary','finance_operational_stability_v1','ok',true,'rolled_back',true) as operational_stability_canary_result;
