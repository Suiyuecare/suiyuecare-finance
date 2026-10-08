-- Immutable follow-on to 20261008055528. Keep the two RPC signatures and
-- their document-level predicates while enforcing the current approvals page
-- permission in the database. The legacy role_permissions page setting governs
-- only while the whole optional Membership plane is absent. Once installed,
-- Membership's current allow, explicit deny and revocation govern the page.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $preflight$
declare
  v_helper pg_catalog.pg_proc%rowtype;
  v_signature text;
  v_proc pg_catalog.pg_proc%rowtype;
begin
  if pg_catalog.to_regprocedure('private.finance_history_actor_v1()') is null
     or pg_catalog.to_regprocedure('private.finance_expense_optional_permission_allows(uuid,text,text,jsonb)') is null then
    raise exception 'Personal history permission guard requires verified actor and Membership helper' using errcode='55000';
  end if;
  select * into v_proc from pg_catalog.pg_proc
   where oid=pg_catalog.to_regprocedure('private.finance_history_actor_v1()');
  if pg_catalog.pg_get_userbyid(v_proc.proowner)<>'postgres'
     or v_proc.prosecdef or v_proc.provolatile<>'s'
     or v_proc.proconfig is distinct from array['search_path=""']::text[]
     or pg_catalog.md5(v_proc.prosrc)<>'8d218d188d9bc054554c83007e838990' then
    raise exception 'Approval history actor baseline drifted' using errcode='55000';
  end if;
  select * into v_helper from pg_catalog.pg_proc
   where oid=pg_catalog.to_regprocedure('private.finance_expense_optional_permission_allows(uuid,text,text,jsonb)');
  if pg_catalog.pg_get_userbyid(v_helper.proowner)<>'postgres'
     or not v_helper.prosecdef or v_helper.provolatile<>'s'
     or v_helper.prosrc not like '%membership_has_explicit_deny%'
     or v_helper.prosrc not like '%membership_can%'
     or v_helper.prosrc not like '%legacy_finance_user_id%'
     or v_helper.prosrc not like '%auth.uid()%' then
    raise exception 'Trusted Membership permission helper drifted' using errcode='55000';
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
      raise exception 'Legacy grouped history RPC baseline drifted: %',v_signature using errcode='55000';
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
      raise exception 'Personal history RPC baseline drifted: %',v_signature using errcode='55000';
    end if;
  end loop;
end;
$preflight$;

-- This private helper mirrors the approvals page's legacy role_permissions
-- semantics without trusting a browser snapshot. In the complete Membership
-- plane the existing tenant/auth-bound permission helper is authoritative.
create function private.finance_personal_history_page_allows_v1(
  p_user public.finance_users
) returns boolean
language plpgsql stable security definer set search_path = ''
as $page$
declare
  v_saved jsonb;
  v_modules jsonb;
  v_core jsonb;
  v_raw jsonb;
  v_value text;
  v_default boolean := p_user.role in (
    'employee','section_chief','dept_manager','admin_director',
    'general_affairs','hr','accountant','cashier','ceo'
  );
  v_membership_absent boolean;
begin
  if p_user.auth_user_id is null or p_user.auth_user_id is distinct from auth.uid()
     or p_user.tenant_id is distinct from public.current_tenant_id()
     or p_user.id is distinct from public.current_finance_user_id()
     or p_user.active is distinct from true then
    return false;
  end if;
  select s.value into v_modules from public.system_settings s
  where s.tenant_id=p_user.tenant_id and s.key='product_modules';
  if pg_catalog.jsonb_typeof(v_modules)='array' then
    select module.value into v_core
    from pg_catalog.jsonb_array_elements(v_modules) with ordinality as module(value,position)
    where module.value->>'id'='finance-core'
    order by module.position desc limit 1;
    if v_core->'enabled'='false'::jsonb or v_core->>'status'='disabled' then
      return false;
    end if;
  end if;
  if private.finance_expense_optional_permission_allows(
       p_user.tenant_id,p_user.id,'finance.page.approvals.view','{}'::jsonb
     ) is distinct from true then
    return false;
  end if;
  v_membership_absent :=
    pg_catalog.to_regclass('public.membership_users') is null
    and pg_catalog.to_regprocedure('public.membership_current_user_id()') is null
    and pg_catalog.to_regprocedure('public.membership_can(uuid,text,jsonb)') is null
    and pg_catalog.to_regprocedure('public.membership_has_explicit_deny(uuid,text,jsonb)') is null;
  if not v_membership_absent then
    return true;
  end if;
  select s.value -> p_user.role into v_saved
  from public.system_settings s
  where s.tenant_id=p_user.tenant_id and s.key='role_permissions';
  if v_saved is null or v_saved='null'::jsonb then
    return v_default;
  end if;
  if pg_catalog.jsonb_typeof(v_saved)='array' then
    return v_saved ? 'approvals';
  end if;
  if pg_catalog.jsonb_typeof(v_saved)<>'object' then
    return false;
  end if;
  if not (v_saved ? 'approvals') then
    return v_default;
  end if;
  v_raw:=v_saved->'approvals';
  if v_raw='true'::jsonb then return true; end if;
  if pg_catalog.jsonb_typeof(v_raw)='number' then
    return (v_raw #>> '{}')::numeric >= 3
      or (v_raw #>> '{}')::numeric in (1,2);
  end if;
  v_value:=pg_catalog.lower(pg_catalog.btrim(v_saved->>'approvals'));
  return v_value in (
    'view','read','view_only','readonly','edit','write','manage',
    'admin','approve','delete','remove'
  );
end;
$page$;

alter function private.finance_personal_history_page_allows_v1(public.finance_users) owner to postgres;
revoke all on function private.finance_personal_history_page_allows_v1(public.finance_users)
  from public,anon,authenticated,service_role;

-- Existing history RPCs share this actor. Preserve identity matching while
-- enforcing the same current page grant before either endpoint reads records.
create or replace function private.finance_history_actor_v1() returns public.finance_users
language plpgsql stable set search_path='' as $actor$
declare v_auth_user_id uuid:=auth.uid();v_verified_email text;v_user public.finance_users%rowtype;v_member_count integer;
begin
  if v_auth_user_id is null then
    raise exception 'Authentication is required for approval history'
      using errcode = '42501';
  end if;

  v_verified_email := public.finance_verified_google_email(v_auth_user_id);
  if nullif(v_verified_email, '') is null then
    raise exception 'A verified Google identity is required for approval history'
      using errcode = '42501';
  end if;

  select count(*)::integer
  into v_member_count
  from public.finance_users fu
  join public.tenant_members tm
    on tm.tenant_id = fu.tenant_id
   and tm.finance_user_id = fu.id
   and tm.auth_user_id = v_auth_user_id
   and tm.active = true
  where fu.auth_user_id = v_auth_user_id
    and lower(btrim(fu.email)) = lower(btrim(v_verified_email))
    and fu.active = true;

  if v_member_count <> 1 then
    raise exception 'Approval history identity is not uniquely bound to an active tenant member'
      using errcode = '42501';
  end if;

  select fu.*
  into v_user
  from public.finance_users fu
  join public.tenant_members tm
    on tm.tenant_id = fu.tenant_id
   and tm.finance_user_id = fu.id
   and tm.auth_user_id = v_auth_user_id
   and tm.active = true
  where fu.auth_user_id = v_auth_user_id
    and lower(btrim(fu.email)) = lower(btrim(v_verified_email))
    and fu.active = true;

  if private.finance_personal_history_page_allows_v1(v_user) is distinct from true then
    raise exception 'Personal history page access is unavailable'
      using errcode = '42501';
  end if;
return v_user;
end;
$actor$;

-- The three legacy history endpoints use grouped bill/invoice batches. Retire
-- direct access so an allowed sibling cannot disclose another source row.
revoke all on function public.finance_approval_participant_history_for_current_user(integer,integer,text,text)
  from public,anon,authenticated,service_role;
revoke all on function public.finance_approval_history_summary_v1(integer,integer,text,text)
  from public,anon,authenticated,service_role;
revoke all on function public.finance_approval_history_detail_v1(text,text)
  from public,anon,authenticated,service_role;

create or replace function public.finance_personal_document_summary_v1(
  p_scope text default 'all',
  p_limit integer default 50,
  p_offset integer default 0,
  p_search text default null,
  p_data_environment text default 'production'
)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $summary$
declare
  v_user public.finance_users%rowtype;
  v_scope text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_scope, 'all')));
  v_environment text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_data_environment, 'production')));
  v_limit integer := coalesce(p_limit, 50);
  v_offset integer := coalesce(p_offset, 0);
  v_search text := pg_catalog.btrim(coalesce(p_search, ''));
  v_result jsonb;
begin
  v_user := private.finance_history_actor_v1();
  -- Recheck the current tenant/auth-bound approvals page grant on every RPC.
  if private.finance_personal_history_page_allows_v1(v_user) is distinct from true then
    raise exception 'Personal history page access is unavailable'
      using errcode = '42501';
  end if;
  if v_scope not in ('mine', 'all')
     or v_environment not in ('production', 'test')
     or v_limit < 1 or v_limit > 50
     or v_offset < 0 or pg_catalog.length(v_search) > 120 then
    raise exception 'Invalid personal history scope, page, search or environment'
      using errcode = '22023';
  end if;

  -- Search only compact, transactionally refreshed source projections. Both
  -- counts are exact across every authorized row; no bootstrap-page cutoff.
  with authorized as materialized (
    select *
    from private.finance_personal_document_authorized_v1(v_user, v_environment, null, null) a
    where v_scope = 'all' or a.personally_applied
  ), projected as materialized (
    select
      a.*,
      p.source_id as projected_id,
      p.summary,
      p.summary_amount,
      p.search_text,
      p.amounts
    from authorized a
    left join private.finance_history_source_projection_v1 p
      on p.tenant_id = v_user.tenant_id
     and p.data_environment = v_environment
     and p.record_type = a.record_type
     and p.source_id = a.record_id
  ), filtered as materialized (
    select * from projected p
    where v_search = ''
       or private.finance_history_document_search_v1(v_search, p.search_text, p.amounts)
  ), page_rows as (
    select * from filtered
    order by last_participated_at desc nulls last, record_type, record_no, record_id
    limit v_limit offset v_offset
  )
  select pg_catalog.jsonb_build_object(
    'ok', true,
    'mode', 'summary',
    'identity', pg_catalog.jsonb_build_object(
      'auth_user_id', v_user.auth_user_id,
      'finance_user_id', v_user.id,
      'tenant_id', v_user.tenant_id,
      'email', v_user.email,
      'data_environment', v_environment
    ),
    'all_total', (select count(*) from authorized),
    'total', (select count(*) from filtered),
    'projection_complete', not exists(select 1 from projected where projected_id is null),
    'page', pg_catalog.jsonb_build_object(
      'limit', v_limit,
      'offset', v_offset,
      'has_more', v_offset + v_limit < (select count(*) from filtered)
    ),
    'items', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'history_key', p.record_type || ':' || p.record_id,
        'kind', p.kind,
        'record_type', p.record_type,
        'record_id', p.record_id,
        'record_no', p.record_no,
        'batch_id', p.batch_id,
        'source_count', 1,
        'last_participated_at', p.last_participated_at,
        'personally_applied', p.personally_applied,
        'personally_acted', p.personally_acted,
        'participation_label', case
          when p.personally_applied then '我申請的'
          when p.personally_acted then '本人已處理'
          else '曾列入流程'
        end,
        'summary', p.summary || pg_catalog.jsonb_build_object(
          'source_count', 1, 'amount', p.summary_amount
        )
      ) order by p.last_participated_at desc nulls last, p.record_type, p.record_no, p.record_id)
      from page_rows p
    ), '[]'::jsonb)
  ) into v_result;

  if not (v_result ->> 'projection_complete')::boolean then
    raise exception 'Personal history search projection is incomplete'
      using errcode = '55000';
  end if;
  if pg_catalog.octet_length(v_result::text) > 200000 then
    raise exception 'Personal history summary exceeds safe page size'
      using errcode = '54000';
  end if;
  return v_result;
end;
$summary$;

create or replace function public.finance_personal_document_detail_v1(
  p_history_key text,
  p_data_environment text default 'production'
)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $detail$
declare
  v_user public.finance_users%rowtype;
  v_environment text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_data_environment, 'production')));
  v_record_type text;
  v_record_id text;
  v_authorized record;
  v_source jsonb;
  v_projection record;
  v_steps jsonb;
begin
  v_user := private.finance_history_actor_v1();
  -- Recheck the current tenant/auth-bound approvals page grant on every RPC.
  if private.finance_personal_history_page_allows_v1(v_user) is distinct from true then
    raise exception 'Personal history page access is unavailable'
      using errcode = '42501';
  end if;
  if v_environment not in ('production', 'test')
     or p_history_key is null
     or pg_catalog.length(p_history_key) > 512
     or pg_catalog.strpos(p_history_key, ':') < 2 then
    raise exception 'Invalid personal history key or environment'
      using errcode = '22023';
  end if;
  v_record_type := pg_catalog.split_part(p_history_key, ':', 1);
  v_record_id := pg_catalog.substr(p_history_key, pg_catalog.strpos(p_history_key, ':') + 1);
  if v_record_type not in ('expense_requests', 'bills', 'invoices')
     or nullif(v_record_id, '') is null then
    raise exception 'Invalid personal history key'
      using errcode = '22023';
  end if;

  select * into v_authorized
  from private.finance_personal_document_authorized_v1(
    v_user, v_environment, v_record_type, v_record_id
  );
  if not found then
    -- An absent row and an unauthorized row have identical behavior.
    raise exception 'Personal history document is unavailable'
      using errcode = '42501';
  end if;

  select p.summary, p.summary_amount into v_projection
  from private.finance_history_source_projection_v1 p
  where p.tenant_id = v_user.tenant_id
    and p.data_environment = v_environment
    and p.record_type = v_record_type
    and p.source_id = v_record_id;
  if not found then
    raise exception 'Personal history search projection is incomplete'
      using errcode = '55000';
  end if;

  select source_row into v_source
  from (
    select pg_catalog.to_jsonb(r) as source_row
    from public.expense_requests r
    where v_record_type = 'expense_requests'
      and r.tenant_id = v_user.tenant_id
      and r.data_environment = v_environment
      and r.id = v_record_id
    union all
    select pg_catalog.to_jsonb(b)
    from public.bills b
    where v_record_type = 'bills'
      and b.tenant_id = v_user.tenant_id
      and b.data_environment = v_environment
      and b.id = v_record_id
    union all
    select pg_catalog.to_jsonb(i)
    from public.invoices i
    where v_record_type = 'invoices'
      and i.tenant_id = v_user.tenant_id
      and i.data_environment = v_environment
      and i.id = v_record_id
  ) source;
  if v_source is null then
    raise exception 'Personal history document is unavailable'
      using errcode = '42501';
  end if;

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'record_id', s.record_id,
    'step_index', s.step_index,
    'step_title', s.step_title,
    'step_status', s.step_status,
    'workflow_status', s.workflow_status,
    'role_key', s.role_key,
    'resolved_user_id', s.resolved_user_id,
    'acted_by_user_id', s.acted_by_user_id,
    'acted_by_name', s.acted_by_name,
    'acted_at', s.acted_at_text,
    'participation_at', case
      when nullif(pg_catalog.btrim(s.acted_at_text), '') is not null
       and pg_catalog.pg_input_is_valid(pg_catalog.btrim(s.acted_at_text), 'timestamp with time zone')
        then pg_catalog.btrim(s.acted_at_text)::timestamptz
      else s.updated_at
    end,
    'personally_acted', coalesce(s.role_key, '') not like 'applicant_%'
      and coalesce(s.raw_step ->> 'autoSkip', 'false') <> 'true'
      and (
        s.step_status in ('approved', 'rejected', 'rejected_all', 'returned')
        or (
          nullif(pg_catalog.btrim(s.acted_at_text), '') is not null
          and (s.step_status is null or s.step_status = 'cancelled')
        )
      )
      and (
        s.acted_by_user_id in (v_user.id, v_user.auth_user_id::text)
        or (
          nullif(pg_catalog.btrim(s.acted_by_user_id), '') is null
          and (
            s.raw_actor_user_id in (v_user.id, v_user.auth_user_id::text)
            or (
              nullif(pg_catalog.btrim(s.raw_actor_user_id), '') is null
              and pg_catalog.lower(pg_catalog.btrim(coalesce(s.raw_actor_email, '')))
                = pg_catalog.lower(pg_catalog.btrim(v_user.email))
            )
          )
        )
      )
  ) order by s.updated_at desc, s.record_id, s.step_index), '[]'::jsonb)
  into v_steps
  from public.approval_step_actor_snapshots s
  where s.tenant_id = v_user.tenant_id
    and s.data_environment = v_environment
    and s.record_type = v_record_type
    and s.record_id = v_record_id
    and (
      s.resolved_user_id = v_user.id
      or s.acted_by_user_id in (v_user.id, v_user.auth_user_id::text)
      or s.raw_actor_user_id in (v_user.id, v_user.auth_user_id::text)
      or pg_catalog.lower(pg_catalog.btrim(coalesce(s.resolved_email, '')))
         = pg_catalog.lower(pg_catalog.btrim(v_user.email))
      or pg_catalog.lower(pg_catalog.btrim(coalesce(s.raw_actor_email, '')))
         = pg_catalog.lower(pg_catalog.btrim(v_user.email))
    );

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'identity', pg_catalog.jsonb_build_object(
      'auth_user_id', v_user.auth_user_id,
      'finance_user_id', v_user.id,
      'tenant_id', v_user.tenant_id,
      'email', v_user.email,
      'data_environment', v_environment
    ),
    'item', pg_catalog.jsonb_build_object(
      'history_key', v_record_type || ':' || v_record_id,
      'kind', v_authorized.kind,
      'record_type', v_record_type,
      'record_id', v_record_id,
      'record_no', v_authorized.record_no,
      'batch_id', v_authorized.batch_id,
      'source_count', 1,
      'last_participated_at', v_authorized.last_participated_at,
      'personally_applied', v_authorized.personally_applied,
      'personally_acted', v_authorized.personally_acted,
      'participation_label', case
        when v_authorized.personally_applied then '我申請的'
        when v_authorized.personally_acted then '本人已處理'
        else '曾列入流程'
      end,
      'summary', v_projection.summary || pg_catalog.jsonb_build_object(
        'source_count', 1, 'amount', v_projection.summary_amount
      ),
      'participant_steps', v_steps,
      'source_rows', pg_catalog.jsonb_build_array(v_source)
    )
  );
end;
$detail$;
-- Fail if either RPC lost the new guard or its existing signature/ACL.
do $postflight$
declare v_signature text; v_proc pg_catalog.pg_proc%rowtype;
begin
  select * into v_proc from pg_catalog.pg_proc
    where oid=pg_catalog.to_regprocedure('private.finance_history_actor_v1()');
  if v_proc.oid is null or pg_catalog.pg_get_userbyid(v_proc.proowner)<>'postgres'
     or v_proc.prosecdef or v_proc.provolatile<>'s'
     or v_proc.proconfig is distinct from array['search_path=""']::text[]
     or v_proc.prosrc not like '%private.finance_personal_history_page_allows_v1(v_user)%'
     or pg_catalog.has_function_privilege('anon',v_proc.oid,'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated',v_proc.oid,'EXECUTE')
     or pg_catalog.has_function_privilege('service_role',v_proc.oid,'EXECUTE') then
    raise exception 'Approval history actor permission guard drifted' using errcode='23514';
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
      raise exception 'Legacy grouped history RPC remains callable: %',v_signature using errcode='23514';
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
      raise exception 'Personal history permission guard or RPC grants drifted: %',v_signature using errcode='23514';
    end if;
  end loop;
end;
$postflight$;

notify pgrst, 'reload schema';
