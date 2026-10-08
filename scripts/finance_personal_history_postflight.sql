\set ON_ERROR_STOP on

-- Read-only check after migration and again after promotion.
do $postflight$
declare
  v_signature text;
  v_proc pg_catalog.pg_proc%rowtype;
begin
  if not exists (select 1 from supabase_migrations.schema_migrations
      where version = '20261008055528'
        and name = 'finance_personal_document_history_v1') then
    raise exception 'Personal history migration ledger entry is absent';
  end if;
  foreach v_signature in array array[
    'public.finance_personal_document_summary_v1(text,integer,integer,text,text)',
    'public.finance_personal_document_detail_v1(text,text)',
    'private.finance_personal_document_authorized_v1(public.finance_users,text,text,text)'
  ] loop
    select * into v_proc from pg_catalog.pg_proc
      where oid = pg_catalog.to_regprocedure(v_signature);
    if v_proc.oid is null
       or pg_catalog.pg_get_userbyid(v_proc.proowner) <> 'postgres'
       or v_proc.provolatile <> 's'
       or v_proc.proconfig is distinct from array['search_path=""']::text[]
       or v_proc.prosecdef is distinct from (v_signature like 'public.%')
       or pg_catalog.has_function_privilege('anon', v_proc.oid, 'EXECUTE')
       or pg_catalog.has_function_privilege('service_role', v_proc.oid, 'EXECUTE')
       or pg_catalog.has_function_privilege('authenticated', v_proc.oid, 'EXECUTE')
            is distinct from (v_signature like 'public.%')
       or exists (select 1 from pg_catalog.aclexplode(coalesce(v_proc.proacl,
         pg_catalog.acldefault('f',v_proc.proowner))) a
         where a.grantee = 0 and a.privilege_type = 'EXECUTE') then
      raise exception 'Personal history function authority drifted: %', v_signature;
    end if;
    if v_signature like 'private.%'
       and (v_proc.prosrc not like '%raw_step ->> ''autoSkip''%'
         or v_proc.prosrc not like '%finance_identity_matches_current_v1%'
         or v_proc.prosrc not like '%coalesce(source.applied, false) or coalesce(matched.acted, false)%'
         or v_proc.prosrc not like '%s.record_id = p_record_id%') then
      raise exception 'Personal history owner/signature predicate drifted';
    end if;
    if v_signature like '%detail_v1%'
       and (v_proc.prosrc not like '%s.raw_step ->> ''autoSkip''%'
         or v_proc.prosrc not like '%r.id = v_record_id%'
         or v_proc.prosrc not like '%b.id = v_record_id%'
         or v_proc.prosrc not like '%i.id = v_record_id%'
         or v_proc.prosrc not like '%finance_personal_document_authorized_v1%') then
      raise exception 'Personal history detail key/scope predicate drifted';
    end if;
    if v_signature like '%summary_v1%'
       and (v_proc.prosrc not like '%v_scope = ''all'' or a.personally_applied%'
         or v_proc.prosrc not like '%p.tenant_id = v_user.tenant_id%'
         or v_proc.prosrc not like '%p.source_id = a.record_id%'
         or v_proc.prosrc not like '%projection_complete%') then
      raise exception 'Personal history summary tenant/environment/projection predicate drifted';
    end if;
  end loop;
  if pg_catalog.has_table_privilege('authenticated',
       'private.finance_history_source_projection_v1', 'SELECT')
    or pg_catalog.has_table_privilege('anon',
       'private.finance_history_source_projection_v1', 'SELECT') then
    raise exception 'Personal history private projection exposure';
  end if;
  if exists (
    with source_rows as (
      select tenant_id, data_environment, 'expense_requests'::text record_type, id source_id
        from public.expense_requests
      union all select tenant_id, data_environment, 'bills', id from public.bills
      union all select tenant_id, data_environment, 'invoices', id from public.invoices
    )
    select 1 from source_rows s left join private.finance_history_source_projection_v1 p
      on p.tenant_id = s.tenant_id and p.data_environment = s.data_environment
     and p.record_type = s.record_type and p.source_id = s.source_id
    where s.tenant_id is not null and s.data_environment in ('production','test')
      and p.source_id is null
  ) then
    raise exception 'Personal history projection coverage incomplete';
  end if;
end;
$postflight$;

select 'FINANCE_PERSONAL_HISTORY_POSTFLIGHT_OK' as marker;
