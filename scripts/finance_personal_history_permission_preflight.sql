\set ON_ERROR_STOP on

-- This release starts only after the immutable personal-history migration.
do $preflight$
declare v_helper pg_catalog.pg_proc%rowtype; v_signature text; v_proc pg_catalog.pg_proc%rowtype;
begin
  if not exists (select 1 from supabase_migrations.schema_migrations
      where version='20261008055528' and name='finance_personal_document_history_v1')
     or exists (select 1 from supabase_migrations.schema_migrations
      where version='20261008090000') then
    raise exception 'Personal history permission baseline ledger is unexpected';
  end if;
  select * into v_helper from pg_catalog.pg_proc
    where oid=pg_catalog.to_regprocedure('private.finance_expense_optional_permission_allows(uuid,text,text,jsonb)');
  if v_helper.oid is null or pg_catalog.pg_get_userbyid(v_helper.proowner)<>'postgres'
     or not v_helper.prosecdef or v_helper.provolatile<>'s'
     or v_helper.prosrc not like '%membership_has_explicit_deny%'
     or v_helper.prosrc not like '%membership_can%'
     or v_helper.prosrc not like '%legacy_finance_user_id%'
     or v_helper.prosrc not like '%auth.uid()%' then
    raise exception 'Trusted Membership permission helper drifted';
  end if;
  if pg_catalog.to_regclass('public.system_settings') is null
     or pg_catalog.to_regprocedure('public.current_tenant_id()') is null
     or pg_catalog.to_regprocedure('public.current_finance_user_id()') is null then
    raise exception 'Trusted tenant, finance user or role settings baseline is absent';
  end if;
  select * into v_proc from pg_catalog.pg_proc
    where oid=pg_catalog.to_regprocedure('private.finance_history_actor_v1()');
  if v_proc.oid is null or pg_catalog.pg_get_userbyid(v_proc.proowner)<>'postgres'
     or v_proc.prosecdef or v_proc.provolatile<>'s'
     or v_proc.proconfig is distinct from array['search_path=""']::text[]
     or pg_catalog.md5(v_proc.prosrc)<>'8d218d188d9bc054554c83007e838990' then
    raise exception 'Approval history actor baseline drifted';
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
       or pg_catalog.md5(v_proc.prosrc) is distinct from
         (case when v_signature like '%participant_history_for_current_user%' then '3474c4a2001ee6e299634d68213b3f92'
               when v_signature like '%summary_v1%' then '30eca33cceb1d47970546741b066a326'
              else '9dc8508ca37333396009d6a5b79539c4' end)
       or pg_catalog.has_function_privilege('anon',v_proc.oid,'EXECUTE')
       or not pg_catalog.has_function_privilege('authenticated',v_proc.oid,'EXECUTE')
       or not pg_catalog.has_function_privilege('service_role',v_proc.oid,'EXECUTE') then
      raise exception 'Legacy grouped history RPC baseline drifted: %',v_signature;
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
       or pg_catalog.md5(v_proc.prosrc) is distinct from
         (case when v_signature like '%summary_v1%' then '48c146e073e8680c612541633e6924a4'
              else 'ac0abbd921abe42d54805a723a834093' end) then
      raise exception 'Personal history RPC baseline drifted: %',v_signature;
    end if;
  end loop;
end;
$preflight$;

select 'FINANCE_PERSONAL_HISTORY_PERMISSION_PREFLIGHT_OK' as marker;
