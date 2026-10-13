-- One personal-history application per durable bill or invoice batch.
-- Authorization still precedes same-table/tenant/environment batch grouping.
-- The identity-once private helper, source rows, projections and business actions
-- remain unchanged. These existing public RPCs retain their owners and ACLs.
set local lock_timeout='5s';
set local statement_timeout='60s';
do $income_batch_ledger_preflight$
begin
  if exists(select 1 from supabase_migrations.schema_migrations
       where version='20261013091838')
     or not exists(select 1 from supabase_migrations.schema_migrations
       where version='20261012112652'
         and name='finance_personal_history_identity_once_v1') then
    raise exception 'Personal income batch history prerequisite or target ledger drift'
      using errcode='55000';
  end if;
end;
$income_batch_ledger_preflight$;

do $income_batch_preflight$
declare v_expected record;v_proc pg_catalog.pg_proc%rowtype;
begin
  for v_expected in select * from (values
    ('private.finance_personal_document_authorized_v1(public.finance_users,text,text,text)',false,'1db71550a2ec13ece520e25abb211e09'),
    ('public.finance_personal_document_summary_v1(text,integer,integer,text,text)',true,'f68644d4f30ee10fd4b2bd76da4a2b83'),
    ('public.finance_personal_document_detail_v1(text,text)',true,'34989c18188536e079e63ff81370c2cf'),
    ('private.finance_history_actor_v1()',false,'4fa4b048271075bade4b7ddd3f424fc4'),
    ('private.finance_personal_history_page_allows_v1(public.finance_users)',true,'b2fed44ca1b66208649d50c7bfae921d')
  ) x(signature,security_definer,source_md5) loop
    select * into v_proc from pg_catalog.pg_proc
    where oid=pg_catalog.to_regprocedure(v_expected.signature);
    if v_proc.oid is null or pg_catalog.pg_get_userbyid(v_proc.proowner)<>'postgres'
       or v_proc.prosecdef is distinct from v_expected.security_definer
       or v_proc.provolatile<>'s'
       or v_proc.proconfig is distinct from array['search_path=""']::text[]
       or pg_catalog.md5(v_proc.prosrc) is distinct from v_expected.source_md5
       or pg_catalog.has_function_privilege('anon',v_proc.oid,'EXECUTE')
       or pg_catalog.has_function_privilege('service_role',v_proc.oid,'EXECUTE')
       or pg_catalog.has_function_privilege('authenticated',v_proc.oid,'EXECUTE')
         is distinct from (v_expected.signature like 'public.%')
       or exists(select 1 from pg_catalog.aclexplode(coalesce(v_proc.proacl,
         pg_catalog.acldefault('f',v_proc.proowner))) acl
         where acl.grantee=0 and acl.privilege_type='EXECUTE') then
      raise exception 'Personal income batch preflight source or authority drift: %',
        v_expected.signature using errcode='55000';
    end if;
  end loop;
end;
$income_batch_preflight$;

CREATE OR REPLACE FUNCTION public.finance_personal_document_summary_v1(p_scope text DEFAULT 'all'::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0, p_search text DEFAULT NULL::text, p_data_environment text DEFAULT 'production'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  if private.finance_personal_history_page_allows_v1(v_user) is distinct from true then
    raise exception 'Personal history page access is unavailable' using errcode='42501';
  end if;
  if v_scope not in ('mine', 'all')
     or v_environment not in ('production', 'test')
     or v_limit < 1 or v_limit > 50 or v_offset < 0
     or pg_catalog.length(v_search) > 120 then
    raise exception 'Invalid personal history scope, page, search or environment'
      using errcode='22023';
  end if;

  -- Group the *complete authorized set* first. Filtering mine before grouping
  -- would make mine/all detail membership disagree for mixed participation.
  with authorized as materialized (
    select * from private.finance_personal_document_authorized_v1(
      v_user, v_environment, null, null)
  ), projected as materialized (
    select a.*,
      case when a.record_type in ('bills','invoices') and a.batch_id<>''
        then 'batch:'||a.batch_id else 'row:'||a.record_id end as group_key,
      p.source_id as projected_id, p.summary, p.summary_amount,
      p.search_text, p.amounts
    from authorized a
    left join private.finance_history_source_projection_v1 p
      on p.tenant_id=v_user.tenant_id
     and p.data_environment=v_environment
     and p.record_type=a.record_type and p.source_id=a.record_id
  ), grouped as materialized (
    select p.record_type, min(p.kind) as kind, p.group_key,
      min(p.record_id) as record_id,
      (pg_catalog.array_agg(p.record_no order by p.record_id))[1] as record_no,
      max(p.batch_id) as batch_id,
      max(p.last_participated_at) as last_participated_at,
      pg_catalog.bool_or(p.personally_applied) as personally_applied,
      pg_catalog.bool_or(p.personally_acted) as personally_acted,
      count(*)::integer as source_count,
      pg_catalog.array_agg(p.record_id order by p.record_no,p.record_id) as source_ids,
      case when count(p.summary_amount)=count(*) then sum(p.summary_amount) end as total_amount,
      pg_catalog.bool_or(coalesce(p.summary->'has_attachments','false'::jsonb)='true'::jsonb) as has_attachments,
      (pg_catalog.array_agg(p.summary order by p.record_id))[1] as first_summary,
      pg_catalog.string_agg(coalesce(p.search_text,'')||' '||coalesce(p.record_no,''), ' ' order by p.record_id)
        ||' '||max(p.batch_id) as search_text
    from projected p
    group by p.record_type,p.group_key
  ), group_status_rows as (
    -- Every authorized source contributes exactly one current projection state.
    select p.record_type,p.group_key,
      coalesce(nullif(pg_catalog.btrim(p.summary->>'approval_status'),''),
        nullif(pg_catalog.btrim(p.summary->>'status'),''),'unknown') as approval_status,
      count(*)::integer as source_count
    from projected p
    group by p.record_type,p.group_key,
      coalesce(nullif(pg_catalog.btrim(p.summary->>'approval_status'),''),
        nullif(pg_catalog.btrim(p.summary->>'status'),''),'unknown')
  ), group_statuses as (
    select s.record_type,s.group_key,
      pg_catalog.jsonb_object_agg(s.approval_status,s.source_count) as approval_status_counts,
      case when count(*)=1 then min(s.approval_status) else 'mixed' end as approval_status
    from group_status_rows s
    group by s.record_type,s.group_key
  ), group_amounts as (
    select p.record_type,p.group_key,pg_catalog.jsonb_agg(value.value) as amounts
    from projected p
    cross join lateral pg_catalog.jsonb_array_elements(
      case when pg_catalog.jsonb_typeof(p.amounts)='array' then p.amounts else '[]'::jsonb end
    ) value
    group by p.record_type,p.group_key
  ), eligible as materialized (
    select g.*,coalesce(a.amounts,'[]'::jsonb)
      ||case when g.total_amount is null then '[]'::jsonb
          else pg_catalog.jsonb_build_array(g.total_amount) end as search_amounts,
      s.approval_status_counts,s.approval_status
    from grouped g
    left join group_amounts a on a.record_type=g.record_type and a.group_key=g.group_key
    join group_statuses s on s.record_type=g.record_type and s.group_key=g.group_key
    where v_scope='all' or g.personally_applied
  ), filtered as materialized (
    select * from eligible g
    where v_search=''
       or private.finance_history_document_search_v1(
         v_search,g.search_text,g.search_amounts)
  ), page_rows as (
    select * from filtered
    order by last_participated_at desc nulls last,record_type,record_no,record_id
    limit v_limit offset v_offset
  )
  select pg_catalog.jsonb_build_object(
    'ok',true,'mode','summary',
    'identity',pg_catalog.jsonb_build_object(
      'auth_user_id',v_user.auth_user_id,'finance_user_id',v_user.id,
      'tenant_id',v_user.tenant_id,'email',v_user.email,
      'data_environment',v_environment),
    'all_total',(select count(*) from eligible),
    'total',(select count(*) from filtered),
    'projection_complete',not exists(select 1 from projected where projected_id is null),
    'page',pg_catalog.jsonb_build_object(
      'limit',v_limit,'offset',v_offset,
      'has_more',v_offset+v_limit<(select count(*) from filtered)),
    'items',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'history_key',p.record_type||':'||p.record_id,
      'kind',p.kind,'record_type',p.record_type,'record_id',p.record_id,
      'record_no',case when p.record_type in ('bills','invoices') and p.source_count>1
        then (case when p.record_type='bills' then '整批繳費單 ' else '整批 ' end)
          ||p.batch_id else p.record_no end,
      'batch_id',p.batch_id,'source_count',p.source_count,
      'source_ids',pg_catalog.to_jsonb(p.source_ids),
      'last_participated_at',p.last_participated_at,
      'personally_applied',p.personally_applied,
      'personally_acted',p.personally_acted,
      'participation_label',case when p.personally_applied then '我申請的'
        when p.personally_acted then '本人已處理' else '曾列入流程' end,
      'summary',p.first_summary||pg_catalog.jsonb_build_object(
        'source_count',p.source_count,'amount',p.total_amount,
        'has_attachments',p.has_attachments,
        'approval_status',p.approval_status,
        'approval_status_counts',p.approval_status_counts)
    ) order by p.last_participated_at desc nulls last,p.record_type,p.record_no,p.record_id)
      from page_rows p),'[]'::jsonb)
  ) into v_result;

  if not (v_result->>'projection_complete')::boolean then
    raise exception 'Personal history search projection is incomplete' using errcode='55000';
  end if;
  if pg_catalog.octet_length(v_result::text)>200000 then
    raise exception 'Personal history summary exceeds safe page size' using errcode='54000';
  end if;
  return v_result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.finance_personal_document_detail_v1(p_history_key text, p_data_environment text DEFAULT 'production'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user public.finance_users%rowtype;
  v_environment text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_data_environment,'production')));
  v_record_type text;
  v_record_id text;
  v_anchor record;
  v_projection record;
  v_count integer;
  v_ids text[];
  v_rows jsonb;
  v_steps jsonb;
  v_amount numeric;
  v_attachments boolean;
  v_applied boolean;
  v_acted boolean;
  v_last timestamptz;
  v_record_no text;
  v_status_counts jsonb;
  v_approval_status text;
begin
  v_user := private.finance_history_actor_v1();
  if private.finance_personal_history_page_allows_v1(v_user) is distinct from true then
    raise exception 'Personal history page access is unavailable' using errcode='42501';
  end if;
  if v_environment not in ('production','test') or p_history_key is null
     or pg_catalog.length(p_history_key)>512
     or pg_catalog.strpos(p_history_key,':')<2 then
    raise exception 'Invalid personal history key or environment' using errcode='22023';
  end if;
  v_record_type:=pg_catalog.split_part(p_history_key,':',1);
  v_record_id:=pg_catalog.substr(p_history_key,pg_catalog.strpos(p_history_key,':')+1);
  if v_record_type not in ('expense_requests','bills','invoices')
     or nullif(v_record_id,'') is null then
    raise exception 'Invalid personal history key' using errcode='22023';
  end if;

  select * into v_anchor from private.finance_personal_document_authorized_v1(
    v_user,v_environment,v_record_type,v_record_id);
  if not found then
    raise exception 'Personal history document is unavailable' using errcode='42501';
  end if;
  select p.summary,p.summary_amount into v_projection
  from private.finance_history_source_projection_v1 p
  where p.tenant_id=v_user.tenant_id and p.data_environment=v_environment
    and p.record_type=v_record_type and p.source_id=v_record_id;
  if not found then
    raise exception 'Personal history search projection is incomplete' using errcode='55000';
  end if;

  -- This second call freshly re-authorizes every member. Joining the source
  -- table by batch_id alone would disclose documents the actor cannot see.
  with authorized as materialized (
    select a.* from private.finance_personal_document_authorized_v1(
      v_user,v_environment,v_record_type,null) a
    where a.record_id=v_record_id
       or (v_record_type in ('bills','invoices') and v_anchor.batch_id<>''
           and a.batch_id=v_anchor.batch_id)
  ), source_records as materialized (
    select a.*,
      coalesce(pg_catalog.to_jsonb(r),pg_catalog.to_jsonb(b),pg_catalog.to_jsonb(i)) as source_row,
      p.source_id as projected_id,p.summary_amount,
      p.summary
    from authorized a
    left join public.expense_requests r
      on a.record_type='expense_requests' and r.id=a.record_id
     and r.tenant_id=v_user.tenant_id and r.data_environment=v_environment
    left join public.bills b
      on a.record_type='bills' and b.id=a.record_id
     and b.tenant_id=v_user.tenant_id and b.data_environment=v_environment
    left join public.invoices i
      on a.record_type='invoices' and i.id=a.record_id
     and i.tenant_id=v_user.tenant_id and i.data_environment=v_environment
    left join private.finance_history_source_projection_v1 p
      on p.tenant_id=v_user.tenant_id and p.data_environment=v_environment
     and p.record_type=a.record_type and p.source_id=a.record_id
  )
  select count(*)::integer,
    pg_catalog.array_agg(s.record_id order by s.record_no,s.record_id),
    pg_catalog.jsonb_agg(s.source_row order by s.record_no,s.record_id),
    case when count(s.summary_amount)=count(*) then sum(s.summary_amount) end,
    pg_catalog.bool_or(coalesce(s.summary->'has_attachments','false'::jsonb)='true'::jsonb),
    pg_catalog.bool_or(s.personally_applied),pg_catalog.bool_or(s.personally_acted),
    max(s.last_participated_at),
    (pg_catalog.array_agg(s.record_no order by s.record_id))[1],
    (select pg_catalog.jsonb_object_agg(state.approval_status,state.source_count)
      from (
        select coalesce(nullif(pg_catalog.btrim(sr.summary->>'approval_status'),''),
          nullif(pg_catalog.btrim(sr.summary->>'status'),''),'unknown') as approval_status,
          count(*)::integer as source_count
        from source_records sr
        group by coalesce(nullif(pg_catalog.btrim(sr.summary->>'approval_status'),''),
          nullif(pg_catalog.btrim(sr.summary->>'status'),''),'unknown')
      ) state)
  into v_count,v_ids,v_rows,v_amount,v_attachments,v_applied,v_acted,v_last,v_record_no,v_status_counts
  from source_records s
  having count(*)>0
     and count(s.source_row)=count(*) and count(s.projected_id)=count(*);
  if v_count is null or v_ids is null
     or not (v_record_id=any(v_ids)) then
    raise exception 'Personal history batch is incomplete or unavailable' using errcode='55000';
  end if;

  select case when count(*)=1 then min(state.key) else 'mixed' end
  into v_approval_status
  from pg_catalog.jsonb_object_keys(v_status_counts) state(key);

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'record_id',s.record_id,'step_index',s.step_index,
    'step_title',s.step_title,'step_status',s.step_status,
    'workflow_status',s.workflow_status,'role_key',s.role_key,
    'resolved_user_id',s.resolved_user_id,'acted_by_user_id',s.acted_by_user_id,
    'acted_by_name',s.acted_by_name,'acted_at',s.acted_at_text,
    'participation_at',case
      when nullif(pg_catalog.btrim(s.acted_at_text),'') is not null
       and pg_catalog.pg_input_is_valid(pg_catalog.btrim(s.acted_at_text),'timestamp with time zone')
        then pg_catalog.btrim(s.acted_at_text)::timestamptz else s.updated_at end,
    'personally_acted',coalesce(s.role_key,'') not like 'applicant_%'
      and coalesce(s.raw_step->>'autoSkip','false')<>'true'
      and (s.step_status in ('approved','rejected','rejected_all','returned')
        or (nullif(pg_catalog.btrim(s.acted_at_text),'') is not null
          and (s.step_status is null or s.step_status='cancelled')))
      and (s.acted_by_user_id in (v_user.id,v_user.auth_user_id::text)
        or (nullif(pg_catalog.btrim(s.acted_by_user_id),'') is null
          and (s.raw_actor_user_id in (v_user.id,v_user.auth_user_id::text)
            or (nullif(pg_catalog.btrim(s.raw_actor_user_id),'') is null
              and pg_catalog.lower(pg_catalog.btrim(coalesce(s.raw_actor_email,'')))
                =pg_catalog.lower(pg_catalog.btrim(v_user.email))))))
    ) order by s.updated_at desc,s.record_id,s.step_index),'[]'::jsonb)
  into v_steps
  from public.approval_step_actor_snapshots s
  where s.tenant_id=v_user.tenant_id and s.data_environment=v_environment
    and s.record_type=v_record_type and s.record_id=any(v_ids)
    and (s.resolved_user_id=v_user.id
      or s.acted_by_user_id in (v_user.id,v_user.auth_user_id::text)
      or s.raw_actor_user_id in (v_user.id,v_user.auth_user_id::text)
      or pg_catalog.lower(pg_catalog.btrim(coalesce(s.resolved_email,'')))
        =pg_catalog.lower(pg_catalog.btrim(v_user.email))
      or pg_catalog.lower(pg_catalog.btrim(coalesce(s.raw_actor_email,'')))
        =pg_catalog.lower(pg_catalog.btrim(v_user.email)));

  return pg_catalog.jsonb_build_object(
    'ok',true,
    'identity',pg_catalog.jsonb_build_object(
      'auth_user_id',v_user.auth_user_id,'finance_user_id',v_user.id,
      'tenant_id',v_user.tenant_id,'email',v_user.email,
      'data_environment',v_environment),
    'item',pg_catalog.jsonb_build_object(
      'history_key',v_record_type||':'||v_record_id,
      'kind',v_anchor.kind,'record_type',v_record_type,'record_id',v_record_id,
      'record_no',case when v_record_type in ('bills','invoices') and v_count>1
        then (case when v_record_type='bills' then '整批繳費單 ' else '整批 ' end)
          ||v_anchor.batch_id else v_record_no end,
      'batch_id',v_anchor.batch_id,'source_count',v_count,
      'source_ids',pg_catalog.to_jsonb(v_ids),
      'last_participated_at',v_last,
      'personally_applied',v_applied,'personally_acted',v_acted,
      'participation_label',case when v_applied then '我申請的'
        when v_acted then '本人已處理' else '曾列入流程' end,
      'summary',v_projection.summary||pg_catalog.jsonb_build_object(
        'source_count',v_count,'amount',v_amount,
        'has_attachments',v_attachments,
        'approval_status',v_approval_status,
        'approval_status_counts',v_status_counts),
      'participant_steps',v_steps,'source_rows',v_rows)
  );
end;
$function$;

do $income_batch_postflight$
declare v_expected record;v_proc pg_catalog.pg_proc%rowtype;
begin
  for v_expected in select * from (values
    ('private.finance_personal_document_authorized_v1(public.finance_users,text,text,text)',false,'1db71550a2ec13ece520e25abb211e09'),
    ('public.finance_personal_document_summary_v1(text,integer,integer,text,text)',true,'2af52ffb295bd15d59092f400dfd70f7'),
    ('public.finance_personal_document_detail_v1(text,text)',true,'07b0d08b0dc4207b38bcae747e5624bb'),
    ('private.finance_history_actor_v1()',false,'4fa4b048271075bade4b7ddd3f424fc4'),
    ('private.finance_personal_history_page_allows_v1(public.finance_users)',true,'b2fed44ca1b66208649d50c7bfae921d')
  ) x(signature,security_definer,source_md5) loop
    select * into v_proc from pg_catalog.pg_proc
    where oid=pg_catalog.to_regprocedure(v_expected.signature);
    if v_proc.oid is null or pg_catalog.pg_get_userbyid(v_proc.proowner)<>'postgres'
       or v_proc.prosecdef is distinct from v_expected.security_definer
       or v_proc.provolatile<>'s'
       or v_proc.proconfig is distinct from array['search_path=""']::text[]
       or pg_catalog.md5(v_proc.prosrc) is distinct from v_expected.source_md5
       or pg_catalog.has_function_privilege('anon',v_proc.oid,'EXECUTE')
       or pg_catalog.has_function_privilege('service_role',v_proc.oid,'EXECUTE')
       or pg_catalog.has_function_privilege('authenticated',v_proc.oid,'EXECUTE')
         is distinct from (v_expected.signature like 'public.%')
       or exists(select 1 from pg_catalog.aclexplode(coalesce(v_proc.proacl,
         pg_catalog.acldefault('f',v_proc.proowner))) acl
         where acl.grantee=0 and acl.privilege_type='EXECUTE') then
      raise exception 'Personal income batch postflight source or authority drift: %',
        v_expected.signature using errcode='55000';
    end if;
  end loop;
end;
$income_batch_postflight$;

comment on function public.finance_personal_document_summary_v1(text,integer,integer,text,text)
  is 'Group authorized bill/invoice sources by durable batch before search/pagination; retain exact source IDs, amounts and per-source approval state counts.';
comment on function public.finance_personal_document_detail_v1(text,text)
  is 'Re-authorize each bill/invoice batch member before full detail; durable batch IDs never grant source access. Mixed stages are reported explicitly.';

notify pgrst, 'reload schema';
