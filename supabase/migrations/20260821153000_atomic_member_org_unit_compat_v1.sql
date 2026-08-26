-- Non-rerunnable forward compatibility patch.
-- Applied after versioned_org_designer_v1: member administration may select any
-- active unit in the currently published organization, while expense forms still
-- expose only posting units.

do $preflight$
declare
  v_hash text;
begin
  if to_regclass('private.finance_membership_org_versions_v1') is null then
    raise exception 'versioned organization substrate is missing';
  end if;

  select encode(extensions.digest(pg_get_functiondef(
    'public.finance_admin_upsert_member_atomic_v1(jsonb,bigint)'::regprocedure
  ), 'sha256'), 'hex')
  into v_hash;

  if v_hash <> '5dfab2afbd62d9d8b9f029051ee7cd9d68ddfa1ea61ac419fe7ba4cfe7b69b0f' then
    raise exception 'atomic member RPC drifted before org-unit compatibility patch: %', v_hash;
  end if;
end;
$preflight$;

do $patch$
declare
  v_definition text;
  v_old constant text := $old$
  if not exists (
    select 1
    from public.finance_department_units unit_row
    join public.finance_department_entity_scopes scope_row
      on scope_row.tenant_id = unit_row.tenant_id
     and scope_row.unit_id = unit_row.id
     and scope_row.active = true
     and scope_row.entity_code = v_entity_code
    where unit_row.tenant_id = v_tenant_id
      and unit_row.code = v_department_code
      and unit_row.active = true
      and unit_row.present_in_source = true
  ) then
    raise exception '所選部門未啟用、已不屬於該公司，或尚未正式發布。'
      using errcode = '23514';
  end if;
$old$;
  v_new constant text := $new$
  if not exists (
    select 1
    from public.finance_department_units unit_row
    join public.finance_department_entity_scopes scope_row
      on scope_row.tenant_id = unit_row.tenant_id
     and scope_row.unit_id = unit_row.id
     and scope_row.active = true
     and scope_row.entity_code = v_entity_code
    where unit_row.tenant_id = v_tenant_id
      and unit_row.code = v_department_code
      and unit_row.active = true
      and unit_row.present_in_source = true
  ) and not exists (
    select 1
    from private.finance_membership_org_versions_v1 version_row
    cross join lateral jsonb_array_elements(version_row.snapshot -> 'units') unit_json
    where version_row.tenant_id = v_tenant_id
      and version_row.status = 'published'
      and unit_json @> '{"active":true}'::jsonb
      and upper(btrim(coalesce(unit_json ->> 'code', ''))) = v_department_code
      and exists (
        select 1
        from jsonb_array_elements_text(coalesce(unit_json -> 'entity_codes', '[]'::jsonb)) entity_json
        where upper(btrim(entity_json)) = v_entity_code
      )
  ) then
    raise exception '所選組織單位未啟用、已不屬於該公司，或尚未正式發布。'
      using errcode = '23514';
  end if;
$new$;
begin
  v_definition := pg_get_functiondef(
    'public.finance_admin_upsert_member_atomic_v1(jsonb,bigint)'::regprocedure
  );

  if (length(v_definition) - length(replace(v_definition, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'atomic member org-unit guard replacement target is not exact-once';
  end if;

  execute replace(v_definition, v_old, v_new);
end;
$patch$;

comment on function public.finance_admin_upsert_member_atomic_v1(jsonb, bigint) is
  'Atomically maintains members, Google login reservation, finance permissions, and published organization-unit assignment compatibility.';

do $postflight$
declare
  v_hash text;
  v_count integer;
begin
  select encode(extensions.digest(pg_get_functiondef(
    'public.finance_admin_upsert_member_atomic_v1(jsonb,bigint)'::regprocedure
  ), 'sha256'), 'hex')
  into v_hash;

  if v_hash <> '3b7d375406107d9904637d5938c767e9ec3e5b32f30c3ee4d84a237dadf2837e' then
    raise exception 'atomic member org-unit compatibility hash mismatch: %', v_hash;
  end if;

  select count(*) into v_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'finance_admin_upsert_member_atomic_v1'
    and p.oid = 'public.finance_admin_upsert_member_atomic_v1(jsonb,bigint)'::regprocedure
    and p.prosecdef
    and coalesce(p.proconfig, '{}'::text[]) @> array['search_path=""'];
  if v_count <> 1 then
    raise exception 'atomic member RPC security identity changed';
  end if;

  if has_function_privilege('public', 'public.finance_admin_upsert_member_atomic_v1(jsonb,bigint)', 'execute')
     or has_function_privilege('anon', 'public.finance_admin_upsert_member_atomic_v1(jsonb,bigint)', 'execute')
     or not has_function_privilege('authenticated', 'public.finance_admin_upsert_member_atomic_v1(jsonb,bigint)', 'execute')
     or not has_function_privilege('service_role', 'public.finance_admin_upsert_member_atomic_v1(jsonb,bigint)', 'execute') then
    raise exception 'atomic member RPC ACL changed';
  end if;
end;
$postflight$;

notify pgrst, 'reload schema';
