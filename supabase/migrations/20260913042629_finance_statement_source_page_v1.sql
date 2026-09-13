-- One RLS-visible source relation supplies both the page and exact count.
-- No policy, identity helper, business row, or existing writer is changed.
create function public.finance_statement_source_page_v1(
  p_source text,
  p_data_environment text default 'production',
  p_limit integer default 1000,
  p_offset integer default 0
) returns jsonb
language plpgsql stable security invoker
set search_path = ''
as $function$
declare
  v_tenant_id uuid;
  v_actor_id text;
  v_rows jsonb;
  v_total bigint;
begin
  if p_source is null or p_source not in ('expense_requests', 'bills', 'invoices')
     or p_data_environment is null or p_data_environment not in ('production', 'test')
     or p_limit is null or p_limit < 1 or p_limit > 1000
     or p_offset is null or p_offset < 0 then
    raise exception using errcode = '22023', message = '來源、資料環境或分頁範圍無效。';
  end if;

  if auth.uid() is null then
    raise exception using errcode = '42501', message = '請使用已驗證的本人帳號讀取正式資料。';
  end if;
  v_tenant_id := public.current_tenant_id();
  v_actor_id := public.current_finance_user_id();
  if v_tenant_id is null or nullif(v_actor_id, '') is null then
    raise exception using errcode = '42501', message = '目前帳號沒有有效的財務系統身分。';
  end if;

  if p_source = 'expense_requests' then
    with visible as materialized (
      select source_row.*
      from public.expense_requests source_row
      where source_row.tenant_id = v_tenant_id
        and source_row.data_environment = p_data_environment
    ), page as (
      select * from visible order by id asc limit p_limit offset p_offset
    )
    select coalesce((select jsonb_agg(to_jsonb(page) order by page.id) from page), '[]'::jsonb),
           (select count(*) from visible)
    into v_rows, v_total;
  elsif p_source = 'bills' then
    with visible as materialized (
      select source_row.*
      from public.bills source_row
      where source_row.tenant_id = v_tenant_id
        and source_row.data_environment = p_data_environment
    ), page as (
      select * from visible order by id asc limit p_limit offset p_offset
    )
    select coalesce((select jsonb_agg(to_jsonb(page) order by page.id) from page), '[]'::jsonb),
           (select count(*) from visible)
    into v_rows, v_total;
  elsif p_source = 'invoices' then
    with visible as materialized (
      select source_row.*
      from public.invoices source_row
      where source_row.tenant_id = v_tenant_id
        and source_row.data_environment = p_data_environment
    ), page as (
      select * from visible order by id asc limit p_limit offset p_offset
    )
    select coalesce((select jsonb_agg(to_jsonb(page) order by page.id) from page), '[]'::jsonb),
           (select count(*) from visible)
    into v_rows, v_total;
  end if;

  return jsonb_build_object(
    'ok', true, 'source', p_source, 'tenantId', v_tenant_id,
    'dataEnvironment', p_data_environment, 'rows', v_rows, 'total', v_total,
    'limit', p_limit, 'offset', p_offset,
    'hasMore', p_offset::bigint + jsonb_array_length(v_rows) < v_total
  );
end;
$function$;

alter function public.finance_statement_source_page_v1(text,text,integer,integer) owner to postgres;
revoke all on function public.finance_statement_source_page_v1(text,text,integer,integer) from public, anon, service_role;
grant execute on function public.finance_statement_source_page_v1(text,text,integer,integer) to authenticated;
comment on function public.finance_statement_source_page_v1(text,text,integer,integer)
  is 'Authenticated statement source page: SECURITY INVOKER, existing RLS, server tenant, exact same-snapshot count/page.';

do $postflight$
declare
  v_proc record;
begin
  select p.*, r.rolname as owner_name into v_proc
  from pg_proc p join pg_roles r on r.oid = p.proowner
  where p.oid = 'public.finance_statement_source_page_v1(text,text,integer,integer)'::regprocedure;
  if md5(v_proc.prosrc) <> 'fe39d7ec0b151e30cc36e9e2cb7538dc' or v_proc.prosecdef or v_proc.provolatile <> 's' or v_proc.owner_name <> 'postgres'
     or not (coalesce(v_proc.proconfig, array[]::text[]) @> array['search_path=""'])
     or not has_function_privilege('authenticated',v_proc.oid,'EXECUTE')
     or has_function_privilege('anon',v_proc.oid,'EXECUTE')
     or has_function_privilege('service_role',v_proc.oid,'EXECUTE')
     or exists (
       select 1 from aclexplode(coalesce(v_proc.proacl,acldefault('f',v_proc.proowner)))
       where grantee=0 and privilege_type='EXECUTE'
     ) then
    raise exception 'Statement source paging authority contract failed';
  end if;
  if exists (
    select 1 from pg_class c
    where c.oid in ('public.expense_requests'::regclass,'public.bills'::regclass,'public.invoices'::regclass)
      and not c.relrowsecurity
  ) then
    raise exception 'Statement source tables must retain row-level security';
  end if;
end;
$postflight$;

notify pgrst, 'reload schema';
