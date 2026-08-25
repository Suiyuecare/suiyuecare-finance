-- Finance -> eDoc published organization synchronization v2.
--
-- Finance remains the only writable organization master. A published graph is
-- copied into the existing durable outbox and delivered asynchronously. The
-- existing once-per-minute cron remains the recovery path; the new outbox
-- trigger only queues a best-effort pg_net wake after the source commit.
-- This migration is intentionally NON-RERUNNABLE and forward-only.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '90s';

do $preflight$
begin
  if to_regclass('private.finance_membership_org_versions_v1') is null
     or to_regclass('private.finance_edoc_sync_outbox_v1') is null
     or to_regprocedure('private.finance_wake_edoc_sync_worker_v1()') is null
     or to_regprocedure('public.finance_edoc_sync_claim_v1(integer,text,integer)') is null
     or to_regclass('cron.job') is null
     or to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null then
    raise exception 'Finance -> eDoc organization sync prerequisites are missing';
  end if;

  if to_regprocedure('public.finance_edoc_organization_sync_snapshot_v2(uuid,bigint)') is not null
     or to_regprocedure('private.finance_edoc_enqueue_organization_published_v2(uuid,bigint)') is not null
     or to_regprocedure('private.finance_edoc_enqueue_published_org_v2()') is not null
     or to_regprocedure('private.finance_edoc_wake_after_outbox_insert_v2()') is not null
     or exists (
       select 1
       from pg_catalog.pg_trigger trigger_row
       where trigger_row.tgname in (
         'finance_membership_org_versions_edoc_v2',
         'finance_edoc_outbox_fast_wake_v2'
       )
         and not trigger_row.tgisinternal
     ) then
    raise exception 'Finance -> eDoc organization sync v2 is already installed';
  end if;

  if not exists (
    select 1
    from cron.job job_row
    where job_row.jobname = 'finance-edoc-member-company-sync'
      and job_row.schedule = '* * * * *'
      and job_row.active
  ) then
    raise exception 'Finance -> eDoc recovery cron must remain active';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = 'private.finance_edoc_sync_outbox_v1'::regclass
      and constraint_row.conname = 'finance_edoc_sync_outbox_aggregate_type_v1'
      and constraint_row.convalidated
  ) or not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = 'private.finance_edoc_sync_outbox_v1'::regclass
      and constraint_row.conname = 'finance_edoc_sync_outbox_event_type_v1'
      and constraint_row.convalidated
  ) then
    raise exception 'Finance -> eDoc v1 outbox constraints changed; review before applying v2';
  end if;

  if exists (
    select 1
    from private.finance_membership_org_versions_v1 version_row
    where version_row.status = 'published'
      and (
        version_row.version_no <= 0
        or version_row.published_at is null
        or version_row.etag !~ '^[0-9a-f]{64}$'
        or coalesce(version_row.snapshot ->> 'schema_version', '') <> '2'
        or pg_catalog.jsonb_typeof(version_row.snapshot) is distinct from 'object'
        or pg_catalog.jsonb_typeof(version_row.snapshot -> 'units') is distinct from 'array'
        or pg_catalog.jsonb_typeof(version_row.snapshot -> 'assignments') is distinct from 'array'
        or pg_catalog.jsonb_typeof(
          coalesce(version_row.snapshot -> 'reporting_overrides', '[]'::jsonb)
        ) is distinct from 'array'
      )
  ) then
    raise exception 'A published Finance organization graph is not safe to synchronize';
  end if;
end;
$preflight$;

alter table private.finance_edoc_sync_outbox_v1
  drop constraint finance_edoc_sync_outbox_aggregate_type_v1,
  drop constraint finance_edoc_sync_outbox_event_type_v1;

alter table private.finance_edoc_sync_outbox_v1
  add constraint finance_edoc_sync_outbox_aggregate_type_v2
    check (aggregate_type in ('member', 'company', 'organization')),
  add constraint finance_edoc_sync_outbox_event_type_v2
    check (
      (aggregate_type = 'member' and event_type = 'member.changed')
      or (aggregate_type = 'company' and event_type = 'company.changed')
      or (aggregate_type = 'organization' and event_type = 'organization.published')
    );

create or replace function private.finance_edoc_enqueue_organization_published_v2(
  p_tenant_id uuid,
  p_source_revision bigint
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_event_id uuid;
begin
  if p_tenant_id is null
     or p_source_revision is null
     or p_source_revision <= 0 then
    raise exception 'Invalid Finance -> eDoc organization aggregate'
      using errcode = '22023';
  end if;

  insert into private.finance_edoc_sync_outbox_v1 (
    tenant_id,
    aggregate_type,
    aggregate_id,
    event_type,
    source_revision
  )
  values (
    p_tenant_id,
    'organization',
    p_tenant_id::text,
    'organization.published',
    p_source_revision
  )
  on conflict (tenant_id, aggregate_type, aggregate_id, source_revision)
    do nothing
  returning id into v_event_id;

  if v_event_id is null then
    select event_row.id
    into v_event_id
    from private.finance_edoc_sync_outbox_v1 event_row
    where event_row.tenant_id = p_tenant_id
      and event_row.aggregate_type = 'organization'
      and event_row.aggregate_id = p_tenant_id::text
      and event_row.source_revision = p_source_revision;
  end if;

  return v_event_id;
end;
$function$;

alter function private.finance_edoc_enqueue_organization_published_v2(uuid,bigint)
  owner to postgres;
revoke all on function private.finance_edoc_enqueue_organization_published_v2(uuid,bigint)
  from public, anon, authenticated, service_role;

create or replace function private.finance_edoc_enqueue_published_org_v2()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.status <> 'published' then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and old.status is not distinct from new.status
     and old.etag is not distinct from new.etag then
    return new;
  end if;

  perform private.finance_edoc_enqueue_organization_published_v2(
    new.tenant_id,
    new.version_no
  );
  return new;
end;
$function$;

alter function private.finance_edoc_enqueue_published_org_v2() owner to postgres;
revoke all on function private.finance_edoc_enqueue_published_org_v2()
  from public, anon, authenticated, service_role;

create trigger finance_membership_org_versions_edoc_v2
after insert or update of status, etag
on private.finance_membership_org_versions_v1
for each row execute function private.finance_edoc_enqueue_published_org_v2();

create or replace function public.finance_edoc_organization_sync_snapshot_v2(
  p_tenant_id uuid,
  p_expected_revision bigint
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_version private.finance_membership_org_versions_v1%rowtype;
  v_units jsonb := '[]'::jsonb;
  v_assignments jsonb := '[]'::jsonb;
  v_reporting_overrides jsonb := '[]'::jsonb;
begin
  if p_tenant_id is null
     or p_expected_revision is null
     or p_expected_revision <= 0 then
    raise exception 'Invalid Finance -> eDoc organization snapshot request'
      using errcode = '22023';
  end if;

  select version_row.*
  into v_version
  from private.finance_membership_org_versions_v1 version_row
  where version_row.tenant_id = p_tenant_id
    and version_row.version_no = p_expected_revision
    and version_row.status in ('published', 'archived')
    and version_row.published_at is not null
  limit 1;

  if not found then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'error', 'organization_revision_not_found'
    );
  end if;

  if coalesce((v_version.snapshot ->> 'schema_version')::integer, 0) <> 2 then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'error', 'unsupported_organization_schema',
      'currentSourceRevision', v_version.version_no
    );
  end if;

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'id', unit_row.value ->> 'id',
        'code', unit_row.value ->> 'code',
        'name', unit_row.value ->> 'name',
        'parentOrgUnitId', nullif(unit_row.value ->> 'parent_org_unit_id', ''),
        'unitType', lower(pg_catalog.btrim(unit_row.value ->> 'unit_type')),
        'sortOrder', coalesce((unit_row.value ->> 'sort_order')::integer, 0),
        'active', coalesce((unit_row.value ->> 'active')::boolean, true),
        'isPostingUnit', coalesce((unit_row.value ->> 'is_posting_unit')::boolean, false),
        'entityScopeMode', lower(pg_catalog.btrim(
          coalesce(unit_row.value ->> 'entity_scope_mode', 'inherit')
        )),
        'entityCodes', coalesce(unit_row.value -> 'entity_codes', '[]'::jsonb)
      )
      order by
        coalesce((unit_row.value ->> 'sort_order')::integer, 0),
        unit_row.value ->> 'code',
        unit_row.value ->> 'id'
    ),
    '[]'::jsonb
  )
  into v_units
  from pg_catalog.jsonb_array_elements(v_version.snapshot -> 'units') unit_row(value);

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'id', assignment_row.value ->> 'id',
        'financeUserId', assignment_row.value ->> 'finance_user_id',
        'orgUnitId', assignment_row.value ->> 'org_unit_id',
        'positionCode', upper(pg_catalog.btrim(
          coalesce(assignment_row.value ->> 'position_code', 'MEMBER')
        )),
        'assignmentKind', lower(pg_catalog.btrim(
          coalesce(assignment_row.value ->> 'assignment_kind', 'secondary')
        )),
        'headKind', nullif(lower(pg_catalog.btrim(
          coalesce(assignment_row.value ->> 'head_kind', '')
        )), ''),
        'canApprove', coalesce((assignment_row.value ->> 'can_approve')::boolean, false),
        'effectiveFrom', nullif(assignment_row.value ->> 'effective_from', ''),
        'effectiveTo', nullif(assignment_row.value ->> 'effective_to', ''),
        'active', coalesce((assignment_row.value ->> 'active')::boolean, true)
      )
      order by
        assignment_row.value ->> 'org_unit_id',
        assignment_row.value ->> 'finance_user_id',
        assignment_row.value ->> 'id'
    ),
    '[]'::jsonb
  )
  into v_assignments
  from pg_catalog.jsonb_array_elements(v_version.snapshot -> 'assignments') assignment_row(value);

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'id', override_row.value ->> 'id',
        'financeUserId', override_row.value ->> 'finance_user_id',
        'supervisorFinanceUserId', override_row.value ->> 'supervisor_finance_user_id',
        'effectiveFrom', nullif(override_row.value ->> 'effective_from', ''),
        'effectiveTo', nullif(override_row.value ->> 'effective_to', ''),
        'active', coalesce((override_row.value ->> 'active')::boolean, true)
      )
      order by
        override_row.value ->> 'finance_user_id',
        override_row.value ->> 'id'
    ),
    '[]'::jsonb
  )
  into v_reporting_overrides
  from pg_catalog.jsonb_array_elements(
    coalesce(v_version.snapshot -> 'reporting_overrides', '[]'::jsonb)
  ) override_row(value);

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'source', 'finance',
    'schemaVersion', 2,
    'snapshotAt', clock_timestamp(),
    'sourceRevision', v_version.version_no,
    'organization', pg_catalog.jsonb_build_object(
      'tenantId', v_version.tenant_id,
      'versionId', v_version.id,
      'versionNo', v_version.version_no,
      'etag', v_version.etag,
      'schemaVersion', 2,
      'publishedAt', v_version.published_at,
      'units', v_units,
      'assignments', v_assignments,
      'reportingOverrides', v_reporting_overrides
    )
  );
end;
$function$;

alter function public.finance_edoc_organization_sync_snapshot_v2(uuid,bigint)
  owner to postgres;
revoke all on function public.finance_edoc_organization_sync_snapshot_v2(uuid,bigint)
  from public, anon, authenticated;
grant execute on function public.finance_edoc_organization_sync_snapshot_v2(uuid,bigint)
  to service_role;

-- Member and company projections are latest-state aggregates and may safely
-- supersede an older pending event. Published organization revisions are
-- immutable historical facts, so every revision remains deliverable. eDoc
-- resolves a late older revision as stale using its own tenant CAS.
create or replace function public.finance_edoc_sync_claim_v1(
  p_limit integer default 20,
  p_worker_id text default 'edge',
  p_stale_seconds integer default 900
)
returns table (
  event_id uuid,
  event_type text,
  tenant_id uuid,
  aggregate_id text,
  source_revision bigint,
  occurred_at timestamptz,
  attempt_count integer,
  max_attempts integer
)
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_worker_id text := left(coalesce(nullif(pg_catalog.btrim(p_worker_id), ''), 'edge'), 100);
  v_stale_seconds integer := least(greatest(coalesce(p_stale_seconds, 900), 60), 3600);
begin
  update private.finance_edoc_sync_outbox_v1 older
  set status = 'superseded',
      delivery_outcome = 'superseded',
      next_attempt_at = clock_timestamp(),
      locked_at = null,
      locked_by = null,
      updated_at = clock_timestamp()
  where older.aggregate_type <> 'organization'
    and (
      older.status in ('pending', 'failed')
      or (
        older.status = 'processing'
        and older.locked_at < clock_timestamp() - (v_stale_seconds * interval '1 second')
      )
    )
    and exists (
      select 1
      from private.finance_edoc_sync_outbox_v1 newer
      where newer.tenant_id = older.tenant_id
        and newer.aggregate_type = older.aggregate_type
        and newer.aggregate_id = older.aggregate_id
        and newer.source_revision > older.source_revision
    );

  return query
  with due as (
    select event_row.id
    from private.finance_edoc_sync_outbox_v1 event_row
    where event_row.attempt_count < event_row.max_attempts
      and (
        (
          event_row.status in ('pending', 'failed')
          and event_row.next_attempt_at <= clock_timestamp()
        )
        or (
          event_row.status = 'processing'
          and event_row.locked_at < clock_timestamp() - (v_stale_seconds * interval '1 second')
        )
      )
    order by event_row.next_attempt_at, event_row.created_at, event_row.id
    limit least(greatest(coalesce(p_limit, 20), 1), 50)
    for update of event_row skip locked
  )
  update private.finance_edoc_sync_outbox_v1 event_row
  set status = 'processing',
      attempt_count = event_row.attempt_count + 1,
      last_attempt_at = clock_timestamp(),
      locked_at = clock_timestamp(),
      locked_by = v_worker_id,
      last_error_code = null,
      updated_at = clock_timestamp()
  from due
  where event_row.id = due.id
  returning
    event_row.id,
    event_row.event_type,
    event_row.tenant_id,
    event_row.aggregate_id,
    event_row.source_revision,
    event_row.created_at,
    event_row.attempt_count,
    event_row.max_attempts;
end;
$function$;

create or replace function public.finance_edoc_sync_retry_v1(
  p_event_id uuid
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_updated integer := 0;
begin
  update private.finance_edoc_sync_outbox_v1 event_row
  set status = 'pending',
      attempt_count = 0,
      next_attempt_at = clock_timestamp(),
      locked_at = null,
      locked_by = null,
      last_error_code = null,
      updated_at = clock_timestamp()
  where event_row.id = p_event_id
    and event_row.status in ('failed', 'dead')
    and (
      event_row.aggregate_type = 'organization'
      or not exists (
        select 1
        from private.finance_edoc_sync_outbox_v1 newer
        where newer.tenant_id = event_row.tenant_id
          and newer.aggregate_type = event_row.aggregate_type
          and newer.aggregate_id = event_row.aggregate_id
          and newer.source_revision > event_row.source_revision
      )
    );

  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$function$;

alter function public.finance_edoc_sync_claim_v1(integer,text,integer) owner to postgres;
alter function public.finance_edoc_sync_retry_v1(uuid) owner to postgres;
revoke all on function public.finance_edoc_sync_claim_v1(integer,text,integer)
  from public, anon, authenticated;
revoke all on function public.finance_edoc_sync_retry_v1(uuid)
  from public, anon, authenticated;
grant execute on function public.finance_edoc_sync_claim_v1(integer,text,integer)
  to service_role;
grant execute on function public.finance_edoc_sync_retry_v1(uuid)
  to service_role;

-- Queue one best-effort wake per source transaction. pg_net performs the HTTP
-- request asynchronously after commit; a failure here never replaces the
-- durable outbox or the existing recovery cron.
create or replace function private.finance_edoc_wake_after_outbox_insert_v2()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if pg_catalog.current_setting('finance.edoc_sync_wake_queued', true) = '1' then
    return null;
  end if;

  perform pg_catalog.set_config('finance.edoc_sync_wake_queued', '1', true);
  perform private.finance_wake_edoc_sync_worker_v1();
  return null;
exception
  when others then
    raise warning 'Unable to queue immediate Finance -> eDoc wake (%).', sqlstate;
    return null;
end;
$function$;

alter function private.finance_edoc_wake_after_outbox_insert_v2() owner to postgres;
revoke all on function private.finance_edoc_wake_after_outbox_insert_v2()
  from public, anon, authenticated, service_role;

create trigger finance_edoc_outbox_fast_wake_v2
after insert on private.finance_edoc_sync_outbox_v1
for each statement execute function private.finance_edoc_wake_after_outbox_insert_v2();

-- Backfill the one currently published version for every tenant. The unique
-- outbox key makes this idempotent at the event level, while the migration
-- itself intentionally remains non-rerunnable.
insert into private.finance_edoc_sync_outbox_v1 (
  tenant_id,
  aggregate_type,
  aggregate_id,
  event_type,
  source_revision
)
select
  version_row.tenant_id,
  'organization',
  version_row.tenant_id::text,
  'organization.published',
  version_row.version_no
from private.finance_membership_org_versions_v1 version_row
where version_row.status = 'published'
on conflict (tenant_id, aggregate_type, aggregate_id, source_revision)
  do nothing;

do $postflight$
declare
  v_function regprocedure;
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = 'private.finance_edoc_sync_outbox_v1'::regclass
      and constraint_row.conname = 'finance_edoc_sync_outbox_aggregate_type_v2'
      and constraint_row.convalidated
  ) or not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = 'private.finance_edoc_sync_outbox_v1'::regclass
      and constraint_row.conname = 'finance_edoc_sync_outbox_event_type_v2'
      and constraint_row.convalidated
  ) then
    raise exception 'Finance -> eDoc organization outbox constraints are incomplete';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_trigger trigger_row
    where trigger_row.tgrelid = 'private.finance_membership_org_versions_v1'::regclass
      and trigger_row.tgname = 'finance_membership_org_versions_edoc_v2'
      and trigger_row.tgenabled = 'O'
      and not trigger_row.tgisinternal
  ) or not exists (
    select 1
    from pg_catalog.pg_trigger trigger_row
    where trigger_row.tgrelid = 'private.finance_edoc_sync_outbox_v1'::regclass
      and trigger_row.tgname = 'finance_edoc_outbox_fast_wake_v2'
      and trigger_row.tgenabled = 'O'
      and not trigger_row.tgisinternal
  ) then
    raise exception 'Finance -> eDoc organization triggers are incomplete';
  end if;

  foreach v_function in array array[
    'public.finance_edoc_organization_sync_snapshot_v2(uuid,bigint)'::regprocedure,
    'public.finance_edoc_sync_claim_v1(integer,text,integer)'::regprocedure,
    'public.finance_edoc_sync_retry_v1(uuid)'::regprocedure
  ]
  loop
    if pg_catalog.has_function_privilege('anon', v_function, 'EXECUTE')
       or pg_catalog.has_function_privilege('authenticated', v_function, 'EXECUTE')
       or not pg_catalog.has_function_privilege('service_role', v_function, 'EXECUTE') then
      raise exception 'Finance -> eDoc organization RPC ACL is invalid for %', v_function;
    end if;
  end loop;

  if pg_catalog.strpos(
       pg_catalog.lower(pg_catalog.pg_get_functiondef(
         'public.finance_edoc_organization_sync_snapshot_v2(uuid,bigint)'::regprocedure
       )),
       'version_row.status in (''published'', ''archived'')'
     ) = 0
     or pg_catalog.strpos(
       pg_catalog.lower(pg_catalog.pg_get_functiondef(
         'public.finance_edoc_sync_claim_v1(integer,text,integer)'::regprocedure
       )),
       'older.aggregate_type <> ''organization'''
     ) = 0
     or pg_catalog.strpos(
       pg_catalog.lower(pg_catalog.pg_get_functiondef(
         'public.finance_edoc_sync_retry_v1(uuid)'::regprocedure
       )),
       'event_row.aggregate_type = ''organization'''
     ) = 0 then
    raise exception 'Finance -> eDoc immutable organization revision handling is incomplete';
  end if;

  if not exists (
    select 1
    from cron.job job_row
    where job_row.jobname = 'finance-edoc-member-company-sync'
      and job_row.schedule = '* * * * *'
      and job_row.active
  ) then
    raise exception 'Finance -> eDoc recovery cron was not preserved';
  end if;

  if exists (
    select 1
    from private.finance_membership_org_versions_v1 version_row
    left join private.finance_edoc_sync_outbox_v1 event_row
      on event_row.tenant_id = version_row.tenant_id
     and event_row.aggregate_type = 'organization'
     and event_row.aggregate_id = version_row.tenant_id::text
     and event_row.event_type = 'organization.published'
     and event_row.source_revision = version_row.version_no
    where version_row.status = 'published'
      and event_row.id is null
  ) then
    raise exception 'Finance -> eDoc did not seed every published organization';
  end if;
end;
$postflight$;

notify pgrst, 'reload schema';

commit;
