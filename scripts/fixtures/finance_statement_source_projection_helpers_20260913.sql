-- Exact read-only catalog definitions; no data or credentials.
CREATE OR REPLACE FUNCTION public.normalize_invoice_identifier_type(p_type text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select case
    when coalesce(nullif(trim(p_type), ''), '電子發票') in ('電子發票','統一編號','電子發票（載具）','領據')
      then coalesce(nullif(trim(p_type), ''), '電子發票')
    when trim(p_type) in ('載具','電子載具','手機載具') then '電子發票（載具）'
    else '電子發票'
  end
$function$;

CREATE OR REPLACE FUNCTION private.finance_assert_form_department_scope(p_tenant_id uuid, p_department_code text, p_entity_code text, p_original_department_code text DEFAULT NULL::text, p_original_entity_code text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  -- OLD is the authoritative historical snapshot.  An existing form whose
  -- tenant/entity/department pair is unchanged is grandfathered even when its
  -- old code no longer appears in the current catalog.  Any change, and every
  -- new form, must pass the narrower new-form allowlist.
  if nullif(pg_catalog.btrim(p_original_department_code), '') is not null
     and nullif(pg_catalog.btrim(p_original_entity_code), '') is not null
     and pg_catalog.upper(pg_catalog.btrim(p_department_code)) =
         pg_catalog.upper(pg_catalog.btrim(p_original_department_code))
     and pg_catalog.upper(pg_catalog.btrim(p_entity_code)) =
         pg_catalog.upper(pg_catalog.btrim(p_original_entity_code))
  then
    return;
  end if;

  if not private.finance_department_allows_new_form(
           p_tenant_id,
           p_department_code,
           p_entity_code
         ) then
    raise exception '所選部門 % 不適用於法人 % 的新申請',
      p_department_code,
      p_entity_code
      using errcode = '23514';
  end if;
end;
$function$;
CREATE OR REPLACE FUNCTION private.finance_department_allows_new_form(p_tenant_id uuid, p_department_code text, p_entity_code text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_match_count integer := 0;
  v_allowed boolean := false;
begin
  if p_tenant_id is null
     or nullif(pg_catalog.btrim(p_department_code), '') is null
     or nullif(pg_catalog.btrim(p_entity_code), '') is null then
    return false;
  end if;

  select pg_catalog.count(*)::integer,
         coalesce(pg_catalog.bool_and(
           coalesce(nullif(department_item ->> 'active', '')::boolean, true)
           and coalesce(
             nullif(department_item ->> 'isPostingUnit', '')::boolean,
             true
           )
           and not coalesce(
             nullif(department_item ->> 'historicalOnly', '')::boolean,
             false
           )
           and exists (
             select 1
             from pg_catalog.jsonb_array_elements_text(
               case
                 when pg_catalog.jsonb_typeof(
                        department_item -> 'newFormEntityCodes'
                      ) = 'array'
                   then department_item -> 'newFormEntityCodes'
                 else '[]'::jsonb
               end
             ) new_scope(entity_code)
             where pg_catalog.upper(pg_catalog.btrim(new_scope.entity_code)) =
                   pg_catalog.upper(pg_catalog.btrim(p_entity_code))
           )
         ), false)
    into v_match_count, v_allowed
  from public.system_settings setting_row
  cross join lateral pg_catalog.jsonb_array_elements(setting_row.value)
    department_item
  where setting_row.tenant_id = p_tenant_id
    and setting_row.key = 'departments'
    and pg_catalog.upper(pg_catalog.btrim(department_item ->> 'c')) =
        pg_catalog.upper(pg_catalog.btrim(p_department_code));

  return v_match_count = 1 and v_allowed;
end;
$function$;

CREATE OR REPLACE FUNCTION private.finance_google_normalized_email_v2(p_email text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select lower(btrim(coalesce(p_email, '')))
$function$;

CREATE OR REPLACE FUNCTION private.finance_google_replace_projection_email_v2(p_value jsonb, p_finance_user_id text, p_person_name text, p_previous_email text, p_new_email text)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_result jsonb;
  v_key text;
  v_child jsonb;
  v_matches_id boolean;
  v_matches_named_email boolean;
  v_previous_email text := private.finance_google_normalized_email_v2(p_previous_email);
  v_new_email text := private.finance_google_normalized_email_v2(p_new_email);
begin
  if p_value is null then
    return null;
  end if;

  if jsonb_typeof(p_value) = 'array' then
    select coalesce(
      jsonb_agg(
        private.finance_google_replace_projection_email_v2(
          entry.value,
          p_finance_user_id,
          p_person_name,
          v_previous_email,
          v_new_email
        )
        order by entry.ordinality
      ),
      '[]'::jsonb
    )
    into v_result
    from jsonb_array_elements(p_value) with ordinality as entry(value, ordinality);
    return v_result;
  end if;

  if jsonb_typeof(p_value) <> 'object' then
    return p_value;
  end if;

  v_result := '{}'::jsonb;
  for v_key, v_child in
    select key, value from jsonb_each(p_value)
  loop
    v_result := v_result || jsonb_build_object(
      v_key,
      private.finance_google_replace_projection_email_v2(
        v_child,
        p_finance_user_id,
        p_person_name,
        v_previous_email,
        v_new_email
      )
    );
  end loop;

  v_matches_id := coalesce(v_result ->> 'userId', '') = p_finance_user_id
    or coalesce(v_result ->> 'finance_user_id', '') = p_finance_user_id
    or coalesce(v_result ->> 'financeUserId', '') = p_finance_user_id;

  v_matches_named_email := coalesce(v_result ->> 'name', '') = p_person_name
    and exists (
      select 1
      from jsonb_each_text(v_result) pair
      where pair.key in (
        'loginEmail',
        'contactEmail',
        'userEmail',
        'email'
      )
        and private.finance_google_normalized_email_v2(pair.value)
            in (v_previous_email, v_new_email)
    );

  if v_matches_id then
    if v_result ? 'userEmail' then
      v_result := jsonb_set(v_result, '{userEmail}', to_jsonb(v_new_email), false);
    end if;
    if v_result ? 'loginEmail' then
      v_result := jsonb_set(v_result, '{loginEmail}', to_jsonb(v_new_email), false);
    end if;
    if v_result ? 'contactEmail'
       and private.finance_google_normalized_email_v2(v_result ->> 'contactEmail')
           in (v_previous_email, v_new_email) then
      v_result := jsonb_set(v_result, '{contactEmail}', to_jsonb(v_new_email), false);
    end if;
  elsif v_matches_named_email then
    if v_result ? 'loginEmail' then
      v_result := jsonb_set(v_result, '{loginEmail}', to_jsonb(v_new_email), false);
    end if;
    if v_result ? 'contactEmail'
       and private.finance_google_normalized_email_v2(v_result ->> 'contactEmail')
           in (v_previous_email, v_new_email) then
      v_result := jsonb_set(v_result, '{contactEmail}', to_jsonb(v_new_email), false);
    end if;
    if v_result ? 'userEmail' then
      v_result := jsonb_set(v_result, '{userEmail}', to_jsonb(v_new_email), false);
    end if;
  end if;

  return v_result;
end;
$function$;
