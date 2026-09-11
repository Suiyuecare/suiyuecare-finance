-- Read-only production catalog snapshot; no operational data.
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
