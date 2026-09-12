-- Bound empty-search hydration to the requested page; all history and actor scope stay intact.
set local lock_timeout = '8s';
set local statement_timeout = '60s';

do $history_page_first_preflight$
declare p record;
begin
 select * into p from pg_proc where oid=to_regprocedure('public.finance_approval_participant_history_for_current_user(integer,integer,text,text)');
 if p.oid is null or md5(p.prosrc)<>'08f88c03990425a076e88d49fa016ad0'
  or pg_get_userbyid(p.proowner)<>'postgres' or not p.prosecdef or p.provolatile<>'s'
  or p.proconfig is distinct from array['search_path=""']::text[]
  or not has_function_privilege('authenticated',p.oid,'EXECUTE') or not has_function_privilege('service_role',p.oid,'EXECUTE')
  or has_function_privilege('anon',p.oid,'EXECUTE')
  or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE') then
  raise exception 'History page-first baseline or authority changed; refusing overwrite';
 end if;
end;
$history_page_first_preflight$;

create or replace function public.finance_approval_participant_history_for_current_user(
  p_limit integer default 50,
  p_offset integer default 0,
  p_search text default null,
  p_data_environment text default 'production'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_auth_user_id uuid := auth.uid();
  v_verified_email text;
  v_user public.finance_users%rowtype;
  v_member_count integer;
  v_limit integer := coalesce(p_limit, 50);
  v_offset integer := coalesce(p_offset, 0);
  v_search text := lower(btrim(coalesce(p_search, '')));
  v_environment text := lower(btrim(coalesce(p_data_environment, 'production')));
  v_payload jsonb;
begin
  if v_auth_user_id is null then
    raise exception 'Authentication is required for approval history'
      using errcode = '42501';
  end if;

  if v_limit < 1 or v_limit > 50 then
    raise exception 'History limit must be between 1 and 50'
      using errcode = '22023';
  end if;
  if v_offset < 0 then
    raise exception 'History offset must be zero or greater'
      using errcode = '22023';
  end if;
  if v_environment not in ('production', 'test') then
    raise exception 'Unsupported data environment'
      using errcode = '22023';
  end if;
  if length(v_search) > 120 then
    raise exception 'History search is too long'
      using errcode = '22023';
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

  with matched_steps as (
    select
      snapshot.*,
      case
        when nullif(btrim(snapshot.acted_at_text), '') is not null
         and pg_catalog.pg_input_is_valid(btrim(snapshot.acted_at_text), 'timestamp with time zone')
          then btrim(snapshot.acted_at_text)::timestamptz
        else snapshot.updated_at
      end as participation_at,
      (
        snapshot.acted_by_user_id in (v_user.id, v_auth_user_id::text)
        or snapshot.raw_actor_user_id in (v_user.id, v_auth_user_id::text)
        or lower(btrim(coalesce(snapshot.raw_actor_email, ''))) = lower(btrim(v_user.email))
      ) as personally_acted
    from public.approval_step_actor_snapshots snapshot
    where snapshot.tenant_id = v_user.tenant_id
      and snapshot.data_environment = v_environment
      and snapshot.record_type in ('expense_requests', 'bills', 'invoices')
      and (
        snapshot.resolved_user_id = v_user.id
        or snapshot.acted_by_user_id in (v_user.id, v_auth_user_id::text)
        or snapshot.raw_actor_user_id in (v_user.id, v_auth_user_id::text)
        or lower(btrim(coalesce(snapshot.resolved_email, ''))) = lower(btrim(v_user.email))
        or lower(btrim(coalesce(snapshot.raw_actor_email, ''))) = lower(btrim(v_user.email))
      )
  ),
  record_matches as (
    select
      'req'::text as kind,
      'expense_requests'::text as record_type,
      request_row.id as group_key,
      request_row.id as record_id,
      ''::text as batch_id,
      request_row.no as record_no,
      max(matched.participation_at) as last_participated_at,
      bool_or(matched.personally_acted) as personally_acted
    from matched_steps matched
    join public.expense_requests request_row
      on matched.record_type = 'expense_requests'
     and request_row.tenant_id = matched.tenant_id
     and request_row.data_environment = matched.data_environment
     and request_row.id = matched.record_id
    group by request_row.id, request_row.no

    union all

    select
      'bill'::text,
      'bills'::text,
      coalesce(nullif(btrim(bill_row.batch_id), ''), bill_row.id),
      bill_row.id,
      coalesce(nullif(btrim(bill_row.batch_id), ''), ''),
      coalesce(bill_row.no, bill_row.id),
      max(matched.participation_at),
      bool_or(matched.personally_acted)
    from matched_steps matched
    join public.bills bill_row
      on matched.record_type = 'bills'
     and bill_row.tenant_id = matched.tenant_id
     and bill_row.data_environment = matched.data_environment
     and bill_row.id = matched.record_id
    group by bill_row.id, bill_row.batch_id, bill_row.no

    union all

    select
      'inv'::text,
      'invoices'::text,
      coalesce(nullif(btrim(invoice_row.batch_id), ''), invoice_row.id),
      invoice_row.id,
      coalesce(nullif(btrim(invoice_row.batch_id), ''), ''),
      coalesce(invoice_row.no, invoice_row.id),
      max(matched.participation_at),
      bool_or(matched.personally_acted)
    from matched_steps matched
    join public.invoices invoice_row
      on matched.record_type = 'invoices'
     and invoice_row.tenant_id = matched.tenant_id
     and invoice_row.data_environment = matched.data_environment
     and invoice_row.id = matched.record_id
    group by invoice_row.id, invoice_row.batch_id, invoice_row.no
  ),
  group_keys as (
    select
      kind,
      record_type,
      group_key,
      min(record_id) as representative_id,
      max(batch_id) as batch_id,
      min(record_no) as record_no,
      max(last_participated_at) as last_participated_at,
      bool_or(personally_acted) as personally_acted
    from record_matches
    group by kind, record_type, group_key
  ),
  -- Empty search can count/page stable group identities without materializing
  -- every historical document, its attachments and accounting payload first.
  candidate_groups as materialized (
    select * from group_keys where v_search <> ''
    union all
    (select * from group_keys where v_search = ''
     order by last_participated_at desc, record_type, record_no, group_key
     limit v_limit offset v_offset)
  ),
  source_records as (
    select
      group_row.kind,
      group_row.record_type,
      group_row.group_key,
      request_row.id as source_id,
      request_row.no as source_no,
      to_jsonb(request_row) as source_row
    from candidate_groups group_row
    join public.expense_requests request_row
      on group_row.record_type = 'expense_requests'
     and request_row.tenant_id = v_user.tenant_id
     and request_row.data_environment = v_environment
     and request_row.id = group_row.representative_id

    union all

    select
      group_row.kind,
      group_row.record_type,
      group_row.group_key,
      bill_row.id,
      coalesce(bill_row.no, bill_row.id),
      to_jsonb(bill_row)
    from candidate_groups group_row
    join public.bills bill_row
      on group_row.record_type = 'bills'
     and bill_row.tenant_id = v_user.tenant_id
     and bill_row.data_environment = v_environment
     and (
       (group_row.batch_id <> '' and nullif(btrim(bill_row.batch_id), '') = group_row.batch_id)
       or (group_row.batch_id = '' and bill_row.id = group_row.representative_id)
     )

    union all

    select
      group_row.kind,
      group_row.record_type,
      group_row.group_key,
      invoice_row.id,
      coalesce(invoice_row.no, invoice_row.id),
      to_jsonb(invoice_row)
    from candidate_groups group_row
    join public.invoices invoice_row
      on group_row.record_type = 'invoices'
     and invoice_row.tenant_id = v_user.tenant_id
     and invoice_row.data_environment = v_environment
     and (
       (group_row.batch_id <> '' and nullif(btrim(invoice_row.batch_id), '') = group_row.batch_id)
       or (group_row.batch_id = '' and invoice_row.id = group_row.representative_id)
     )
  ),
  grouped as (
    select
      group_row.kind,
      group_row.record_type,
      group_row.group_key,
      group_row.representative_id,
      group_row.batch_id,
      group_row.record_no,
      group_row.last_participated_at,
      group_row.personally_acted,
      jsonb_agg(source.source_row order by source.source_no, source.source_id) as source_rows,
      case when v_search <> '' then lower(string_agg((source.source_row-array['amount','total','tax','estimated_amount','actual_amount','bank_fee_amount'])::text, ' ' order by source.source_no, source.source_id)) else '' end as searchable_text,
      sum(case when source.kind='inv' then coalesce((source.source_row->>'total')::numeric,(source.source_row->>'amount')::numeric) else (source.source_row->>'amount')::numeric end) as group_amount
    from candidate_groups group_row
    join source_records source
      on source.kind = group_row.kind
     and source.record_type = group_row.record_type
     and source.group_key = group_row.group_key
    group by
      group_row.kind,
      group_row.record_type,
      group_row.group_key,
      group_row.representative_id,
      group_row.batch_id,
      group_row.record_no,
      group_row.last_participated_at,
      group_row.personally_acted
  ),
  filtered as (
    select *
    from grouped
    where v_search = '' or private.finance_history_document_search_v1(v_search,coalesce(record_no,'')||' '||searchable_text,
      jsonb_path_query_array(source_rows,'$[*].amount')||jsonb_path_query_array(source_rows,'$[*].total')||jsonb_path_query_array(source_rows,'$[*].tax')||
      jsonb_path_query_array(source_rows,'$[*].estimated_amount')||jsonb_path_query_array(source_rows,'$[*].actual_amount')||jsonb_path_query_array(source_rows,'$[*].bank_fee_amount')||jsonb_build_array(group_amount))
  ),
  participant_groups as materialized (
    select record_match.kind, record_match.group_key,
      jsonb_agg(
              jsonb_build_object(
                'record_id', matched.record_id,
                'step_index', matched.step_index,
                'step_title', matched.step_title,
                'step_status', matched.step_status,
                'workflow_status', matched.workflow_status,
                'role_key', matched.role_key,
                'resolved_user_id', matched.resolved_user_id,
                'acted_by_user_id', matched.acted_by_user_id,
                'acted_by_name', matched.acted_by_name,
                'acted_at', matched.acted_at_text,
                'participation_at', matched.participation_at,
                'personally_acted', matched.personally_acted
              )
              order by matched.participation_at desc, matched.record_id, matched.step_index
            ) as steps
    from matched_steps matched
    join record_matches record_match
      on record_match.record_type = matched.record_type
     and record_match.record_id = matched.record_id
    group by record_match.kind, record_match.group_key
  ),
  paged as (
    select *
    from filtered
    order by last_participated_at desc, record_type, record_no, group_key
    limit v_limit
    offset case when v_search = '' then 0 else v_offset end
  )
  select jsonb_build_object(
    'ok', true,
    'identity', jsonb_build_object(
      'tenant_id', v_user.tenant_id,
      'finance_user_id', v_user.id,
      'auth_user_id', v_auth_user_id,
      'email', v_user.email,
      'data_environment', v_environment
    ),
    'all_total', (select count(*) from group_keys),
    'total', case when v_search = '' then (select count(*) from group_keys) else (select count(*) from filtered) end,
    'page', jsonb_build_object(
      'limit', v_limit,
      'offset', v_offset,
      'has_more', v_offset + v_limit < case when v_search = '' then (select count(*) from group_keys) else (select count(*) from filtered) end
    ),
    'items', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'history_key', page_row.record_type || ':' || page_row.group_key,
          'kind', page_row.kind,
          'record_type', page_row.record_type,
          'record_id', page_row.representative_id,
          'record_no', page_row.record_no,
          'batch_id', page_row.batch_id,
          'last_participated_at', page_row.last_participated_at,
          'personally_acted', page_row.personally_acted,
          'participation_label', case when page_row.personally_acted then '本人已處理' else '曾列入流程' end,
          'participant_steps', coalesce(participant_group.steps, '[]'::jsonb),
          'source_row', page_row.source_rows -> 0,
          'source_rows', page_row.source_rows
        )
        order by page_row.last_participated_at desc, page_row.record_type, page_row.record_no, page_row.group_key
      )
      from paged page_row
      left join participant_groups participant_group
        on participant_group.kind = page_row.kind
       and participant_group.group_key = page_row.group_key
    ), '[]'::jsonb)
  )
  into v_payload;

  return v_payload;
end
$function$;

notify pgrst, 'reload schema';
