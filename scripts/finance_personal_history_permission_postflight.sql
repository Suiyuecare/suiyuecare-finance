\set ON_ERROR_STOP on

do $postflight$
declare v_signature text; v_proc pg_catalog.pg_proc%rowtype;
begin
  if not exists (select 1 from supabase_migrations.schema_migrations
      where version='20261008055528' and name='finance_personal_document_history_v1')
     or not exists (select 1 from supabase_migrations.schema_migrations
      where version='20261008090000' and name='finance_personal_history_permission_guard_v1') then
    raise exception 'Personal history permission migration ledger is incomplete';
  end if;
  select * into v_proc from pg_catalog.pg_proc
    where oid=pg_catalog.to_regprocedure('private.finance_personal_history_page_allows_v1(public.finance_users)');
  if v_proc.oid is null or pg_catalog.pg_get_userbyid(v_proc.proowner)<>'postgres'
     or not v_proc.prosecdef or v_proc.provolatile<>'s'
     or v_proc.proconfig is distinct from array['search_path=""']::text[]
     or v_proc.prosrc not like '%p_user.auth_user_id is distinct from auth.uid()%'
     or v_proc.prosrc not like '%p_user.tenant_id is distinct from public.current_tenant_id()%'
     or v_proc.prosrc not like '%private.finance_expense_optional_permission_allows(%'
     or v_proc.prosrc not like '%finance.page.approvals.view%'
     or v_proc.prosrc not like '%product_modules%'
     or v_proc.prosrc not like '%role_permissions%'
     or pg_catalog.has_function_privilege('authenticated',v_proc.oid,'EXECUTE')
     or pg_catalog.has_function_privilege('anon',v_proc.oid,'EXECUTE')
     or pg_catalog.has_function_privilege('service_role',v_proc.oid,'EXECUTE') then
    raise exception 'Personal history page permission helper drifted';
  end if;
  select * into v_proc from pg_catalog.pg_proc
    where oid=pg_catalog.to_regprocedure('private.finance_history_actor_v1()');
  if v_proc.oid is null or pg_catalog.pg_get_userbyid(v_proc.proowner)<>'postgres'
     or v_proc.prosecdef or v_proc.provolatile<>'s'
     or v_proc.proconfig is distinct from array['search_path=""']::text[]
     or v_proc.prosrc not like '%private.finance_personal_history_page_allows_v1(v_user)%'
     or pg_catalog.has_function_privilege('anon',v_proc.oid,'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated',v_proc.oid,'EXECUTE')
     or pg_catalog.has_function_privilege('service_role',v_proc.oid,'EXECUTE') then
    raise exception 'Approval history actor permission guard drifted';
  end if;
  foreach v_signature in array array[
    'public.finance_approval_participant_history_for_current_user(integer,integer,text,text)',
    'public.finance_approval_history_summary_v1(integer,integer,text,text)',
    'public.finance_approval_history_detail_v1(text,text)'
  ] loop
    select * into v_proc from pg_catalog.pg_proc where oid=pg_catalog.to_regprocedure(v_signature);
    if v_proc.oid is null or pg_catalog.pg_get_userbyid(v_proc.proowner)<>'postgres'
       or not v_proc.prosecdef or v_proc.provolatile<>'s'
       or v_proc.proconfig is distinct from array['search_path=""']::text[]
       or pg_catalog.has_function_privilege('anon',v_proc.oid,'EXECUTE')
       or pg_catalog.has_function_privilege('authenticated',v_proc.oid,'EXECUTE')
       or pg_catalog.has_function_privilege('service_role',v_proc.oid,'EXECUTE') then
      raise exception 'Legacy grouped history RPC remains callable: %',v_signature;
    end if;
  end loop;
  foreach v_signature in array array[
    'public.finance_personal_document_summary_v1(text,integer,integer,text,text)',
    'public.finance_personal_document_detail_v1(text,text)'
  ] loop
    select * into v_proc from pg_catalog.pg_proc where oid=pg_catalog.to_regprocedure(v_signature);
    if v_proc.oid is null or pg_catalog.pg_get_userbyid(v_proc.proowner)<>'postgres'
       or not v_proc.prosecdef or v_proc.provolatile<>'s'
       or v_proc.proconfig is distinct from array['search_path=""']::text[]
       or v_proc.prosrc not like '%private.finance_personal_history_page_allows_v1(v_user)%'
       or v_proc.prosrc not like '%is distinct from true%'
       or pg_catalog.has_function_privilege('anon',v_proc.oid,'EXECUTE')
       or pg_catalog.has_function_privilege('service_role',v_proc.oid,'EXECUTE')
       or not pg_catalog.has_function_privilege('authenticated',v_proc.oid,'EXECUTE') then
      raise exception 'Personal history permission RPC drifted: %',v_signature;
    end if;
  end loop;
end;
$postflight$;

select 'FINANCE_PERSONAL_HISTORY_PERMISSION_POSTFLIGHT_OK' as marker;
