-- One physical document per result. A batch ID is display context, never an
-- authorization key: sharing a batch must not reveal a sibling document.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $preflight$
begin
  if to_regprocedure('private.finance_history_actor_v1()') is null
     or to_regprocedure('public.finance_identity_matches_current_v1(text[],text[],text[])') is null
     or to_regprocedure('private.finance_history_document_search_v1(text,text,jsonb)') is null
     or to_regclass('private.finance_history_source_projection_v1') is null
     or to_regclass('public.approval_step_actor_snapshots') is null then
    raise exception 'Personal document history requires verified identity, actor snapshots and the current source projection'
      using errcode = '55000';
  end if;
end;
$preflight$;

create function private.finance_personal_document_authorized_v1(
  p_user public.finance_users,
  p_environment text,
  p_record_type text default null,
  p_record_id text default null
)
returns table (
  record_type text,
  kind text,
  record_id text,
  record_no text,
  batch_id text,
  last_participated_at timestamptz,
  personally_applied boolean,
  personally_acted boolean
)
language sql stable security invoker set search_path = ''
as $authorized$
  with matched_snapshots as (
    select
      s.record_type,
      s.record_id,
      max(case when candidate.actually_acted then
        case
          when nullif(pg_catalog.btrim(s.acted_at_text), '') is not null
           and pg_catalog.pg_input_is_valid(pg_catalog.btrim(s.acted_at_text), 'timestamp with time zone')
            then pg_catalog.btrim(s.acted_at_text)::timestamptz
          else s.updated_at
        end
      end) as participated_at,
      bool_or(
        candidate.actually_acted
      ) as acted
    from public.approval_step_actor_snapshots s
    cross join lateral (select
        coalesce(s.role_key, '') not like 'applicant_%'
        and coalesce(s.raw_step ->> 'autoSkip', 'false') <> 'true'
        and (
          s.step_status in ('approved', 'rejected', 'rejected_all', 'returned')
          or (
            nullif(pg_catalog.btrim(s.acted_at_text), '') is not null
            and (s.step_status is null or s.step_status = 'cancelled')
          )
        )
        and (
          s.acted_by_user_id in (p_user.id, p_user.auth_user_id::text)
          or (
            nullif(pg_catalog.btrim(s.acted_by_user_id), '') is null
            and (
              s.raw_actor_user_id in (p_user.id, p_user.auth_user_id::text)
              or (
                nullif(pg_catalog.btrim(s.raw_actor_user_id), '') is null
                and pg_catalog.lower(pg_catalog.btrim(coalesce(s.raw_actor_email, '')))
                  = pg_catalog.lower(pg_catalog.btrim(p_user.email))
              )
            )
          )
        )
      as actually_acted) candidate
    where s.tenant_id = p_user.tenant_id
      and s.data_environment = p_environment
      and s.record_type in ('expense_requests', 'bills', 'invoices')
      and (p_record_type is null or s.record_type = p_record_type)
      and (p_record_id is null or s.record_id = p_record_id)
      and (
        s.resolved_user_id = p_user.id
        or s.acted_by_user_id in (p_user.id, p_user.auth_user_id::text)
        or s.raw_actor_user_id in (p_user.id, p_user.auth_user_id::text)
        or pg_catalog.lower(pg_catalog.btrim(coalesce(s.resolved_email, '')))
           = pg_catalog.lower(pg_catalog.btrim(p_user.email))
        or pg_catalog.lower(pg_catalog.btrim(coalesce(s.raw_actor_email, '')))
           = pg_catalog.lower(pg_catalog.btrim(p_user.email))
      )
    group by s.record_type, s.record_id
  ),
  source_rows as (
    select
      'expense_requests'::text as record_type,
      'req'::text as kind,
      r.id as record_id,
      coalesce(r.no, r.id) as record_no,
      ''::text as batch_id,
      r.created_at,
      public.finance_identity_matches_current_v1(
        array[coalesce(nullif(pg_catalog.btrim(r.applicant_id), ''),
                       nullif(pg_catalog.btrim(r.form_payload #>> '{applicantProfile,id}'), ''))],
        array[r.applicant_email, r.form_payload #>> '{applicantProfile,email}'],
        array[r.applicant, r.form_payload #>> '{applicantProfile,name}']
      ) as applied
    from public.expense_requests r
    where r.tenant_id = p_user.tenant_id
      and r.data_environment = p_environment
      and (p_record_type is null or p_record_type = 'expense_requests')
      and (p_record_id is null or r.id = p_record_id)

    union all

    select
      'bills'::text,
      'bill'::text,
      b.id,
      coalesce(b.no, b.id),
      coalesce(nullif(pg_catalog.btrim(b.batch_id), ''), ''),
      b.created_at,
      public.finance_identity_matches_current_v1(
        array[b.applicant_id], array[b.applicant_email], array[b.applicant]
      )
    from public.bills b
    where b.tenant_id = p_user.tenant_id
      and b.data_environment = p_environment
      and (p_record_type is null or p_record_type = 'bills')
      and (p_record_id is null or b.id = p_record_id)

    union all

    select
      'invoices'::text,
      'inv'::text,
      i.id,
      coalesce(i.no, i.id),
      coalesce(nullif(pg_catalog.btrim(i.batch_id), ''), ''),
      i.created_at,
      public.finance_identity_matches_current_v1(
        array[i.applicant_id], array[]::text[], array[i.applicant]
      )
    from public.invoices i
    where i.tenant_id = p_user.tenant_id
      and i.data_environment = p_environment
      and (p_record_type is null or p_record_type = 'invoices')
      and (p_record_id is null or i.id = p_record_id)
  )
  select
    source.record_type,
    source.kind,
    source.record_id,
    source.record_no,
    source.batch_id,
    greatest(source.created_at, matched.participated_at),
    coalesce(source.applied, false),
    coalesce(matched.acted, false)
  from source_rows source
  left join matched_snapshots matched
    on matched.record_type = source.record_type
   and matched.record_id = source.record_id
  where coalesce(source.applied, false) or coalesce(matched.acted, false);
$authorized$;

alter function private.finance_personal_document_authorized_v1(public.finance_users,text,text,text) owner to postgres;
revoke all on function private.finance_personal_document_authorized_v1(public.finance_users,text,text,text)
  from public, anon, authenticated, service_role;

create function public.finance_personal_document_summary_v1(
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

create function public.finance_personal_document_detail_v1(
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

alter function public.finance_personal_document_summary_v1(text,integer,integer,text,text) owner to postgres;
alter function public.finance_personal_document_detail_v1(text,text) owner to postgres;
revoke all on function public.finance_personal_document_summary_v1(text,integer,integer,text,text)
  from public, anon, authenticated, service_role;
revoke all on function public.finance_personal_document_detail_v1(text,text)
  from public, anon, authenticated, service_role;
grant execute on function public.finance_personal_document_summary_v1(text,integer,integer,text,text)
  to authenticated;
grant execute on function public.finance_personal_document_detail_v1(text,text)
  to authenticated;

comment on function public.finance_personal_document_summary_v1(text,integer,integer,text,text)
  is 'One-row-per-document, verified-person, tenant-scoped submitted/participant history. Source projection is search-only; no full source rows leave this endpoint.';
comment on function public.finance_personal_document_detail_v1(text,text)
  is 'Fresh, independently authorized single-document detail. Batch siblings are never returned by a shared batch ID.';

notify pgrst, 'reload schema';

do $postflight$
declare v_signature text; v_proc pg_catalog.pg_proc%rowtype;
begin
  foreach v_signature in array array[
    'public.finance_personal_document_summary_v1(text,integer,integer,text,text)',
    'public.finance_personal_document_detail_v1(text,text)'
  ] loop
    select * into v_proc from pg_catalog.pg_proc
    where oid = pg_catalog.to_regprocedure(v_signature);
    if v_proc.oid is null
       or pg_catalog.pg_get_userbyid(v_proc.proowner) <> 'postgres'
       or not v_proc.prosecdef
       or v_proc.provolatile <> 's'
       or v_proc.proconfig is distinct from array['search_path=""']::text[]
       or pg_catalog.has_function_privilege('anon', v_proc.oid, 'EXECUTE')
       or pg_catalog.has_function_privilege('service_role', v_proc.oid, 'EXECUTE')
       or not pg_catalog.has_function_privilege('authenticated', v_proc.oid, 'EXECUTE')
       or exists(select 1 from pg_catalog.aclexplode(coalesce(v_proc.proacl,
         pg_catalog.acldefault('f', v_proc.proowner))) acl
         where acl.grantee = 0 and acl.privilege_type = 'EXECUTE') then
      raise exception 'Personal document RPC authority or grants drifted: %', v_signature
        using errcode = '23514';
    end if;
  end loop;
end;
$postflight$;
