-- Finance -> eDoc personnel and company master synchronization v1.
--
-- Finance remains the only writable master. Source transactions only enqueue
-- durable work; HTTP delivery is performed later by an Edge worker.
-- This migration is intentionally NON-RERUNNABLE.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '90s';

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

do $preflight$
begin
  if to_regclass('public.finance_users') is null
     or to_regclass('public.tenants') is null
     or to_regclass('public.system_settings') is null
     or to_regclass('public.employee_department_roles') is null
     or to_regclass('public.departments') is null
     or to_regclass('public.finance_department_units') is null
     or to_regclass('public.approval_role_responsibility_matrix') is null
     or to_regprocedure('public.finance_edoc_identity_snapshot(text)') is null
     or to_regprocedure('public.finance_edoc_actor_payload(uuid,text)') is null
     or to_regnamespace('private') is null
     or to_regclass('vault.decrypted_secrets') is null
     or to_regprocedure('extensions.digest(bytea,text)') is null
     or to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null then
    raise exception 'Finance -> eDoc sync prerequisites are missing';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_attribute attribute_row
    where attribute_row.attrelid = 'public.finance_users'::regclass
      and attribute_row.attname = 'member_revision'
      and not attribute_row.attisdropped
  ) then
    raise exception 'finance_users.member_revision must be installed first';
  end if;

  if exists (
    select 1
    from public.system_settings setting_row
    where setting_row.key = 'entities'
      and pg_catalog.jsonb_typeof(setting_row.value) <> 'array'
  ) then
    raise exception 'Every entities setting must be a JSON array';
  end if;

  if exists (
    select setting_row.tenant_id
    from public.system_settings setting_row
    where setting_row.key = 'entities'
    group by setting_row.tenant_id
    having count(*) > 1
  ) then
    raise exception 'Each tenant must have at most one canonical entities setting';
  end if;

  if to_regclass('private.finance_edoc_sync_outbox_v1') is not null
     or to_regclass('private.finance_edoc_member_state_v1') is not null
     or to_regclass('private.finance_edoc_company_state_v1') is not null
     or to_regprocedure('public.finance_edoc_sync_claim_v1(integer,text,integer)') is not null then
    raise exception 'Finance -> eDoc sync v1 is already installed';
  end if;
end;
$preflight$;

create table private.finance_edoc_member_state_v1 (
  tenant_id uuid not null
    references public.tenants(id) on update cascade on delete restrict,
  finance_user_id text not null,
  source_revision bigint not null,
  finance_member_revision bigint not null,
  source_updated_at timestamptz not null default clock_timestamp(),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (tenant_id, finance_user_id),
  constraint finance_edoc_member_state_source_revision_v1
    check (source_revision > 0),
  constraint finance_edoc_member_state_finance_revision_v1
    check (finance_member_revision > 0)
);

create table private.finance_edoc_company_state_v1 (
  tenant_id uuid not null
    references public.tenants(id) on update cascade on delete restrict,
  entity_id text not null,
  source_revision bigint not null default 1,
  payload jsonb not null,
  payload_hash text not null,
  active boolean not null default true,
  source_updated_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (tenant_id, entity_id),
  constraint finance_edoc_company_state_entity_id_v1
    check (char_length(entity_id) between 1 and 80),
  constraint finance_edoc_company_state_revision_v1
    check (source_revision > 0),
  constraint finance_edoc_company_state_payload_v1
    check (pg_catalog.jsonb_typeof(payload) = 'object'),
  constraint finance_edoc_company_state_hash_v1
    check (payload_hash ~ '^[0-9a-f]{64}$')
);

create table private.finance_edoc_sync_outbox_v1 (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null
    references public.tenants(id) on update cascade on delete restrict,
  aggregate_type text not null,
  aggregate_id text not null,
  event_type text not null,
  source_revision bigint not null,
  status text not null default 'pending',
  attempt_count integer not null default 0,
  max_attempts integer not null default 12,
  next_attempt_at timestamptz not null default clock_timestamp(),
  last_attempt_at timestamptz,
  delivered_at timestamptz,
  locked_at timestamptz,
  locked_by text,
  last_error_code text,
  last_http_status integer,
  response_digest text,
  delivery_outcome text,
  retry_history jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint finance_edoc_sync_outbox_aggregate_type_v1
    check (aggregate_type in ('member', 'company')),
  constraint finance_edoc_sync_outbox_event_type_v1
    check (
      (aggregate_type = 'member' and event_type = 'member.changed')
      or (aggregate_type = 'company' and event_type = 'company.changed')
    ),
  constraint finance_edoc_sync_outbox_aggregate_id_v1
    check (char_length(aggregate_id) between 1 and 160),
  constraint finance_edoc_sync_outbox_revision_v1
    check (source_revision > 0),
  constraint finance_edoc_sync_outbox_status_v1
    check (status in ('pending', 'processing', 'failed', 'delivered', 'dead', 'superseded')),
  constraint finance_edoc_sync_outbox_attempts_v1
    check (attempt_count >= 0 and max_attempts between 1 and 30),
  constraint finance_edoc_sync_outbox_retry_history_v1
    check (pg_catalog.jsonb_typeof(retry_history) = 'array'),
  constraint finance_edoc_sync_outbox_http_status_v1
    check (last_http_status is null or last_http_status between 100 and 599),
  constraint finance_edoc_sync_outbox_response_digest_v1
    check (response_digest is null or response_digest ~ '^[0-9a-f]{64}$'),
  constraint finance_edoc_sync_outbox_delivery_outcome_v1
    check (delivery_outcome is null or delivery_outcome in ('applied', 'stale', 'replayed', 'superseded')),
  unique (tenant_id, aggregate_type, aggregate_id, source_revision)
);

create index finance_edoc_sync_outbox_due_v1
  on private.finance_edoc_sync_outbox_v1 (next_attempt_at, created_at)
  where status in ('pending', 'failed', 'processing');

create index finance_edoc_sync_outbox_aggregate_latest_v1
  on private.finance_edoc_sync_outbox_v1 (
    tenant_id,
    aggregate_type,
    aggregate_id,
    source_revision desc
  );

alter table private.finance_edoc_member_state_v1 enable row level security;
alter table private.finance_edoc_member_state_v1 force row level security;
alter table private.finance_edoc_company_state_v1 enable row level security;
alter table private.finance_edoc_company_state_v1 force row level security;
alter table private.finance_edoc_sync_outbox_v1 enable row level security;
alter table private.finance_edoc_sync_outbox_v1 force row level security;

alter table private.finance_edoc_member_state_v1 owner to postgres;
alter table private.finance_edoc_company_state_v1 owner to postgres;
alter table private.finance_edoc_sync_outbox_v1 owner to postgres;

revoke all on table private.finance_edoc_member_state_v1
  from public, anon, authenticated;
revoke all on table private.finance_edoc_company_state_v1
  from public, anon, authenticated;
revoke all on table private.finance_edoc_sync_outbox_v1
  from public, anon, authenticated;
grant usage on schema private to service_role;
grant select, insert, update, delete on table private.finance_edoc_member_state_v1
  to service_role;
grant select, insert, update, delete on table private.finance_edoc_company_state_v1
  to service_role;
grant select, insert, update, delete on table private.finance_edoc_sync_outbox_v1
  to service_role;

create or replace function private.finance_edoc_company_payload_v1(
  p_tenant_id uuid,
  p_entity jsonb,
  p_active boolean,
  p_source_updated_at timestamptz
)
returns jsonb
language sql
stable
set search_path = ''
as $function$
  select pg_catalog.jsonb_build_object(
    'tenantId', p_tenant_id,
    'entityId', coalesce(
      nullif(pg_catalog.btrim(p_entity ->> 'id'), ''),
      nullif(pg_catalog.btrim(p_entity ->> 'c'), '')
    ),
    'name', coalesce(
      nullif(pg_catalog.btrim(p_entity ->> 'full'), ''),
      nullif(pg_catalog.btrim(p_entity ->> 's'), ''),
      nullif(pg_catalog.btrim(p_entity ->> 'name'), ''),
      ''
    ),
    'taxId', coalesce(
      nullif(pg_catalog.btrim(p_entity ->> 'taxId'), ''),
      nullif(pg_catalog.btrim(p_entity ->> 'tax_id'), ''),
      ''
    ),
    'address', coalesce(pg_catalog.btrim(p_entity ->> 'address'), ''),
    'active', coalesce(p_active, false),
    'sourceUpdatedAt', p_source_updated_at
  );
$function$;

alter function private.finance_edoc_company_payload_v1(uuid,jsonb,boolean,timestamptz)
  owner to postgres;
revoke all on function private.finance_edoc_company_payload_v1(uuid,jsonb,boolean,timestamptz)
  from public, anon, authenticated, service_role;

create or replace function private.finance_edoc_enqueue_event_v1(
  p_tenant_id uuid,
  p_aggregate_type text,
  p_aggregate_id text,
  p_source_revision bigint
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_event_id uuid;
  v_event_type text;
begin
  if p_aggregate_type not in ('member', 'company')
     or nullif(pg_catalog.btrim(p_aggregate_id), '') is null
     or p_source_revision is null
     or p_source_revision <= 0 then
    raise exception 'Invalid Finance -> eDoc outbox aggregate'
      using errcode = '22023';
  end if;

  v_event_type := p_aggregate_type || '.changed';

  insert into private.finance_edoc_sync_outbox_v1 (
    tenant_id,
    aggregate_type,
    aggregate_id,
    event_type,
    source_revision
  )
  values (
    p_tenant_id,
    p_aggregate_type,
    pg_catalog.btrim(p_aggregate_id),
    v_event_type,
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
      and event_row.aggregate_type = p_aggregate_type
      and event_row.aggregate_id = pg_catalog.btrim(p_aggregate_id)
      and event_row.source_revision = p_source_revision;
  end if;

  return v_event_id;
end;
$function$;

alter function private.finance_edoc_enqueue_event_v1(uuid,text,text,bigint)
  owner to postgres;
revoke all on function private.finance_edoc_enqueue_event_v1(uuid,text,text,bigint)
  from public, anon, authenticated, service_role;

create or replace function private.finance_edoc_touch_member_v1(
  p_tenant_id uuid,
  p_finance_user_id text
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_finance_revision bigint;
  v_state private.finance_edoc_member_state_v1%rowtype;
  v_source_revision bigint;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'finance-edoc-member:' || p_tenant_id::text || ':' || coalesce(p_finance_user_id, ''),
      20260822
    )
  );

  select user_row.member_revision
  into v_finance_revision
  from public.finance_users user_row
  where user_row.tenant_id = p_tenant_id
    and user_row.id = p_finance_user_id
  limit 1;

  if not found then
    return null;
  end if;

  select state_row.*
  into v_state
  from private.finance_edoc_member_state_v1 state_row
  where state_row.tenant_id = p_tenant_id
    and state_row.finance_user_id = p_finance_user_id
  for update;

  if not found then
    v_source_revision := greatest(v_finance_revision, 1);
    insert into private.finance_edoc_member_state_v1 (
      tenant_id,
      finance_user_id,
      source_revision,
      finance_member_revision
    ) values (
      p_tenant_id,
      p_finance_user_id,
      v_source_revision,
      v_finance_revision
    );
  else
    if v_state.source_revision = 9223372036854775807 then
      raise exception 'eDoc member revision exhausted for %', p_finance_user_id
        using errcode = '54000';
    end if;
    v_source_revision := greatest(v_state.source_revision + 1, v_finance_revision);
    update private.finance_edoc_member_state_v1 state_row
    set source_revision = v_source_revision,
        finance_member_revision = v_finance_revision,
        source_updated_at = clock_timestamp(),
        updated_at = clock_timestamp()
    where state_row.tenant_id = p_tenant_id
      and state_row.finance_user_id = p_finance_user_id;
  end if;

  perform private.finance_edoc_enqueue_event_v1(
    p_tenant_id,
    'member',
    p_finance_user_id,
    v_source_revision
  );
  return v_source_revision;
end;
$function$;

alter function private.finance_edoc_touch_member_v1(uuid,text) owner to postgres;
revoke all on function private.finance_edoc_touch_member_v1(uuid,text)
  from public, anon, authenticated, service_role;

create or replace function private.finance_edoc_enqueue_member_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if tg_op = 'INSERT' then
    perform private.finance_edoc_touch_member_v1(new.tenant_id, new.id);
  elsif new.member_revision is distinct from old.member_revision then
    perform private.finance_edoc_touch_member_v1(new.tenant_id, new.id);
  end if;
  return new;
end;
$function$;

alter function private.finance_edoc_enqueue_member_v1() owner to postgres;
revoke all on function private.finance_edoc_enqueue_member_v1()
  from public, anon, authenticated, service_role;

create trigger finance_users_edoc_outbox_v1
after insert or update on public.finance_users
for each row execute function private.finance_edoc_enqueue_member_v1();

create or replace function private.finance_edoc_touch_role_member_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_old_tenant_id uuid;
  v_new_tenant_id uuid;
  v_old_finance_user_id text;
  v_new_finance_user_id text;
  v_old_department_id uuid;
  v_new_department_id uuid;
  v_old_department_code text;
  v_new_department_code text;
  v_member record;
begin
  if tg_op = 'UPDATE' then
    if new is not distinct from old then return new; end if;
  end if;

  if tg_op in ('UPDATE', 'DELETE') then
    v_old_tenant_id := old.tenant_id;
    v_old_finance_user_id := old.finance_user_id;
    v_old_department_id := old.department_id;
    v_old_department_code := old.department_code;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    v_new_tenant_id := new.tenant_id;
    v_new_finance_user_id := new.finance_user_id;
    v_new_department_id := new.department_id;
    v_new_department_code := new.department_code;
  end if;

  -- A manager/director role can affect every applicant in that department,
  -- not only the row owner. Distinct unioning gives each impacted member one
  -- and only one new CAS revision for this source-row mutation.
  for v_member in
    select distinct impacted.tenant_id, impacted.finance_user_id
    from (
      select v_old_tenant_id as tenant_id, v_old_finance_user_id as finance_user_id
      union
      select v_new_tenant_id, v_new_finance_user_id
      union
      select user_row.tenant_id, user_row.id
      from public.finance_users user_row
      where (user_row.tenant_id = v_old_tenant_id and user_row.department_code = v_old_department_code)
         or (user_row.tenant_id = v_new_tenant_id and user_row.department_code = v_new_department_code)
      union
      select role_row.tenant_id, role_row.finance_user_id
      from public.employee_department_roles role_row
      where role_row.department_id in (v_old_department_id, v_new_department_id)
         or (role_row.tenant_id = v_old_tenant_id and role_row.department_code = v_old_department_code)
         or (role_row.tenant_id = v_new_tenant_id and role_row.department_code = v_new_department_code)
    ) impacted
    where impacted.tenant_id is not null
      and nullif(impacted.finance_user_id, '') is not null
  loop
    perform private.finance_edoc_touch_member_v1(
      v_member.tenant_id,
      v_member.finance_user_id
    );
  end loop;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$function$;

alter function private.finance_edoc_touch_role_member_v1() owner to postgres;
revoke all on function private.finance_edoc_touch_role_member_v1()
  from public, anon, authenticated, service_role;

create trigger employee_department_roles_edoc_member_outbox_v1
after insert or update or delete on public.employee_department_roles
for each row execute function private.finance_edoc_touch_role_member_v1();

create or replace function private.finance_edoc_touch_department_members_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_old_id uuid;
  v_new_id uuid;
  v_old_code text;
  v_new_code text;
  v_member record;
begin
  if tg_op = 'UPDATE' then
    if new is not distinct from old then return new; end if;
  end if;
  if tg_op in ('UPDATE', 'DELETE') then
    v_old_id := old.id;
    v_old_code := old.code;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    v_new_id := new.id;
    v_new_code := new.code;
  end if;

  for v_member in
    select distinct impacted.tenant_id, impacted.finance_user_id
    from (
      select role_row.tenant_id, role_row.finance_user_id
      from public.employee_department_roles role_row
      where role_row.department_id in (v_old_id, v_new_id)
         or role_row.department_code in (v_old_code, v_new_code)
      union
      select user_row.tenant_id, user_row.id
      from public.finance_users user_row
      where user_row.department_code in (v_old_code, v_new_code)
    ) impacted
    where impacted.tenant_id is not null
      and nullif(impacted.finance_user_id, '') is not null
  loop
    perform private.finance_edoc_touch_member_v1(
      v_member.tenant_id,
      v_member.finance_user_id
    );
  end loop;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$function$;

alter function private.finance_edoc_touch_department_members_v1() owner to postgres;
revoke all on function private.finance_edoc_touch_department_members_v1()
  from public, anon, authenticated, service_role;

create trigger departments_edoc_member_outbox_v1
after insert or update or delete on public.departments
for each row execute function private.finance_edoc_touch_department_members_v1();

create or replace function private.finance_edoc_touch_unit_members_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_old_tenant_id uuid;
  v_new_tenant_id uuid;
  v_old_code text;
  v_new_code text;
  v_member record;
begin
  if tg_op = 'UPDATE' then
    if new is not distinct from old then return new; end if;
  end if;
  if tg_op in ('UPDATE', 'DELETE') then
    v_old_tenant_id := old.tenant_id;
    v_old_code := old.code;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    v_new_tenant_id := new.tenant_id;
    v_new_code := new.code;
  end if;

  for v_member in
    select distinct impacted.tenant_id, impacted.finance_user_id
    from (
      select user_row.tenant_id, user_row.id as finance_user_id
      from public.finance_users user_row
      where (user_row.tenant_id = v_old_tenant_id and user_row.department_code = v_old_code)
         or (user_row.tenant_id = v_new_tenant_id and user_row.department_code = v_new_code)
      union
      select role_row.tenant_id, role_row.finance_user_id
      from public.employee_department_roles role_row
      where (role_row.tenant_id = v_old_tenant_id and role_row.department_code = v_old_code)
         or (role_row.tenant_id = v_new_tenant_id and role_row.department_code = v_new_code)
    ) impacted
  loop
    perform private.finance_edoc_touch_member_v1(
      v_member.tenant_id,
      v_member.finance_user_id
    );
  end loop;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$function$;

alter function private.finance_edoc_touch_unit_members_v1() owner to postgres;
revoke all on function private.finance_edoc_touch_unit_members_v1()
  from public, anon, authenticated, service_role;

create trigger finance_department_units_edoc_member_outbox_v1
after insert or update or delete on public.finance_department_units
for each row execute function private.finance_edoc_touch_unit_members_v1();

create or replace function private.finance_edoc_touch_matrix_members_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_member record;
begin
  -- The responsibility matrix is global and tiny. One statement-level bump of
  -- every Finance member avoids row-trigger multiplication while guaranteeing
  -- that a changed CEO/admin responsibility cannot reuse an older CAS value.
  for v_member in
    select user_row.tenant_id, user_row.id as finance_user_id
    from public.finance_users user_row
    order by user_row.tenant_id, user_row.id
  loop
    perform private.finance_edoc_touch_member_v1(
      v_member.tenant_id,
      v_member.finance_user_id
    );
  end loop;
  return null;
end;
$function$;

alter function private.finance_edoc_touch_matrix_members_v1() owner to postgres;
revoke all on function private.finance_edoc_touch_matrix_members_v1()
  from public, anon, authenticated, service_role;

create trigger approval_role_matrix_edoc_member_outbox_v1
after insert or update or delete on public.approval_role_responsibility_matrix
for each statement execute function private.finance_edoc_touch_matrix_members_v1();

create or replace function private.finance_edoc_refresh_companies_v1(
  p_tenant_id uuid,
  p_old_entities jsonb,
  p_new_entities jsonb,
  p_source_updated_at timestamptz
)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_old_entities jsonb := coalesce(p_old_entities, '[]'::jsonb);
  v_new_entities jsonb := coalesce(p_new_entities, '[]'::jsonb);
  v_entity_id text;
  v_old_entity jsonb;
  v_new_entity jsonb;
  v_source_entity jsonb;
  v_payload jsonb;
  v_hash text;
  v_state private.finance_edoc_company_state_v1%rowtype;
  v_member record;
  v_revision bigint;
  v_changed integer := 0;
begin
  if p_tenant_id is null
     or pg_catalog.jsonb_typeof(v_old_entities) <> 'array'
     or pg_catalog.jsonb_typeof(v_new_entities) <> 'array' then
    raise exception 'Canonical Finance entities must be a tenant-scoped JSON array'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(v_new_entities) entity_row(item)
    where nullif(pg_catalog.btrim(coalesce(item ->> 'id', item ->> 'c', '')), '') is null
       or char_length(pg_catalog.btrim(coalesce(item ->> 'id', item ->> 'c', ''))) > 80
       or char_length(coalesce(item ->> 'full', item ->> 's', item ->> 'name', '')) > 200
       or char_length(coalesce(item ->> 'taxId', item ->> 'tax_id', '')) > 30
       or char_length(coalesce(item ->> 'address', '')) > 500
  ) then
    raise exception 'Canonical Finance entity contains an invalid identifier or field length'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from (
      select pg_catalog.btrim(coalesce(item ->> 'id', item ->> 'c', '')) as entity_id
      from pg_catalog.jsonb_array_elements(v_new_entities) entity_row(item)
    ) normalized
    group by normalized.entity_id
    having count(*) > 1
  ) then
    raise exception 'Canonical Finance entities contain a duplicate identifier'
      using errcode = '23505';
  end if;

  for v_entity_id in
    select distinct normalized.entity_id
    from (
      select pg_catalog.btrim(coalesce(item ->> 'id', item ->> 'c', '')) as entity_id
      from pg_catalog.jsonb_array_elements(v_old_entities) entity_row(item)
      union all
      select pg_catalog.btrim(coalesce(item ->> 'id', item ->> 'c', '')) as entity_id
      from pg_catalog.jsonb_array_elements(v_new_entities) entity_row(item)
    ) normalized
    where nullif(normalized.entity_id, '') is not null
    order by normalized.entity_id
  loop
    select item
    into v_old_entity
    from pg_catalog.jsonb_array_elements(v_old_entities) entity_row(item)
    where pg_catalog.btrim(coalesce(item ->> 'id', item ->> 'c', '')) = v_entity_id
    limit 1;

    select item
    into v_new_entity
    from pg_catalog.jsonb_array_elements(v_new_entities) entity_row(item)
    where pg_catalog.btrim(coalesce(item ->> 'id', item ->> 'c', '')) = v_entity_id
    limit 1;

    v_source_entity := coalesce(v_new_entity, v_old_entity);
    v_payload := private.finance_edoc_company_payload_v1(
      p_tenant_id,
      v_source_entity,
      v_new_entity is not null,
      coalesce(p_source_updated_at, clock_timestamp())
    );
    v_hash := pg_catalog.encode(
      extensions.digest(
        pg_catalog.convert_to((v_payload - 'sourceUpdatedAt')::text, 'UTF8'),
        'sha256'
      ),
      'hex'
    );

    select state_row.*
    into v_state
    from private.finance_edoc_company_state_v1 state_row
    where state_row.tenant_id = p_tenant_id
      and state_row.entity_id = v_entity_id
    for update;

    if not found then
      v_revision := 1;
      insert into private.finance_edoc_company_state_v1 (
        tenant_id,
        entity_id,
        source_revision,
        payload,
        payload_hash,
        active,
        source_updated_at
      )
      values (
        p_tenant_id,
        v_entity_id,
        v_revision,
        v_payload,
        v_hash,
        v_new_entity is not null,
        coalesce(p_source_updated_at, clock_timestamp())
      );
    elsif v_state.payload_hash is distinct from v_hash then
      if v_state.source_revision = 9223372036854775807 then
        raise exception 'Company revision exhausted for %', v_entity_id
          using errcode = '54000';
      end if;
      v_revision := v_state.source_revision + 1;
      update private.finance_edoc_company_state_v1 state_row
      set source_revision = v_revision,
          payload = v_payload,
          payload_hash = v_hash,
          active = v_new_entity is not null,
          source_updated_at = coalesce(p_source_updated_at, clock_timestamp()),
          updated_at = clock_timestamp()
      where state_row.tenant_id = p_tenant_id
        and state_row.entity_id = v_entity_id;
    else
      v_revision := null;
    end if;

    if v_revision is not null then
      perform private.finance_edoc_enqueue_event_v1(
        p_tenant_id,
        'company',
        v_entity_id,
        v_revision
      );

      -- Company master data is cached on every eDoc member projection. Touch
      -- only users of the entity whose canonical payload hash actually
      -- changed; the member helper writes an independent monotonic revision
      -- and cannot recurse back into company refresh.
      for v_member in
        select user_row.tenant_id, user_row.id as finance_user_id
        from public.finance_users user_row
        where user_row.tenant_id = p_tenant_id
          and user_row.entity_id = v_entity_id
        order by user_row.id
      loop
        perform private.finance_edoc_touch_member_v1(
          v_member.tenant_id,
          v_member.finance_user_id
        );
      end loop;

      v_changed := v_changed + 1;
    end if;

    v_old_entity := null;
    v_new_entity := null;
    v_state := null;
  end loop;

  return v_changed;
end;
$function$;

alter function private.finance_edoc_refresh_companies_v1(uuid,jsonb,jsonb,timestamptz)
  owner to postgres;
revoke all on function private.finance_edoc_refresh_companies_v1(uuid,jsonb,jsonb,timestamptz)
  from public, anon, authenticated, service_role;

create or replace function private.finance_edoc_enqueue_companies_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_tenant_id uuid;
  v_old_entities jsonb := '[]'::jsonb;
  v_new_entities jsonb := '[]'::jsonb;
  v_source_updated_at timestamptz := clock_timestamp();
begin
  if tg_op in ('UPDATE', 'DELETE') then
    if old.key = 'entities' then
      v_tenant_id := old.tenant_id;
      v_old_entities := old.value;
    end if;
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    if new.key = 'entities' then
      if v_tenant_id is not null and v_tenant_id is distinct from new.tenant_id then
        raise exception 'An entities setting cannot move across tenants'
          using errcode = '23514';
      end if;
      v_tenant_id := new.tenant_id;
      v_new_entities := new.value;
      v_source_updated_at := coalesce(new.updated_at, clock_timestamp());
    end if;
  end if;

  if v_tenant_id is not null then
    perform private.finance_edoc_refresh_companies_v1(
      v_tenant_id,
      v_old_entities,
      v_new_entities,
      v_source_updated_at
    );
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$function$;

alter function private.finance_edoc_enqueue_companies_v1() owner to postgres;
revoke all on function private.finance_edoc_enqueue_companies_v1()
  from public, anon, authenticated, service_role;

create trigger system_settings_edoc_company_outbox_v1
after insert or update or delete on public.system_settings
for each row execute function private.finance_edoc_enqueue_companies_v1();

create or replace function private.finance_edoc_enrich_person_projection_v1(
  p_tenant_id uuid,
  p_projection jsonb
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_finance_user_id text := nullif(pg_catalog.btrim(p_projection ->> 'financeUserId'), '');
  v_identity public.finance_users%rowtype;
  v_member_state private.finance_edoc_member_state_v1%rowtype;
  v_department_name text;
  v_unit_name text;
begin
  if p_projection is null
     or pg_catalog.jsonb_typeof(p_projection) <> 'object'
     or v_finance_user_id is null then
    return p_projection;
  end if;

  select user_row.*
  into v_identity
  from public.finance_users user_row
  where user_row.tenant_id = p_tenant_id
    and user_row.id = v_finance_user_id
  limit 1;

  if not found then
    return p_projection;
  end if;

  select state_row.*
  into v_member_state
  from private.finance_edoc_member_state_v1 state_row
  where state_row.tenant_id = p_tenant_id
    and state_row.finance_user_id = v_finance_user_id
  limit 1;

  select department_row.name, unit_row.name
  into v_department_name, v_unit_name
  from public.employee_department_roles role_row
  left join public.departments department_row
    on department_row.id = role_row.department_id
   and department_row.deleted_at is null
  left join public.finance_department_units unit_row
    on unit_row.tenant_id = role_row.tenant_id
   and unit_row.code = coalesce(nullif(role_row.department_code, ''), v_identity.department_code)
   and unit_row.active = true
   and unit_row.present_in_source = true
  where role_row.tenant_id = p_tenant_id
    and role_row.finance_user_id = v_finance_user_id
    and role_row.active = true
    and (role_row.effective_from is null or role_row.effective_from <= current_date)
    and (role_row.effective_to is null or role_row.effective_to >= current_date)
  order by role_row.is_primary desc,
           role_row.updated_at desc nulls last,
           role_row.created_at,
           role_row.id
  limit 1;

  if v_unit_name is null then
    select unit_row.name
    into v_unit_name
    from public.finance_department_units unit_row
    where unit_row.tenant_id = p_tenant_id
      and unit_row.code = v_identity.department_code
      and unit_row.active = true
      and unit_row.present_in_source = true
    order by unit_row.sort_order, unit_row.id
    limit 1;
  end if;

  return p_projection || pg_catalog.jsonb_build_object(
    'tenantId', v_identity.tenant_id,
    'memberRevision', coalesce(v_member_state.source_revision, v_identity.member_revision),
    'jobTitle', v_identity.job_title,
    'extension', v_identity.extension,
    'contactEmail', lower(pg_catalog.btrim(
      coalesce(nullif(v_identity.org_contact_email, ''), v_identity.email)
    )),
    'departmentName', coalesce(v_department_name, v_unit_name),
    'unitName', coalesce(v_unit_name, v_department_name),
    'sourceActive', coalesce(v_identity.active, false),
    -- active and orgStatus preserve the raw Finance employment state. eDoc
    -- separately classifies org_status=system_account and pending first login.
    'active', coalesce(v_identity.active, false),
    'orgStatus', coalesce(nullif(v_identity.org_status, ''), 'active'),
    'authUserBound', v_identity.auth_user_id is not null,
    'googleLoginVerified', v_identity.google_login_verified_at is not null,
    'sourceUpdatedAt', coalesce(v_identity.org_source_updated_at, v_identity.created_at)
  ) || case
    when v_identity.auth_user_id is null then '{}'::jsonb
    else pg_catalog.jsonb_build_object('authUserId', v_identity.auth_user_id)
  end;
end;
$function$;

alter function private.finance_edoc_enrich_person_projection_v1(uuid,jsonb)
  owner to postgres;
revoke all on function private.finance_edoc_enrich_person_projection_v1(uuid,jsonb)
  from public, anon, authenticated;
grant execute on function private.finance_edoc_enrich_person_projection_v1(uuid,jsonb)
  to service_role;

create or replace function public.finance_edoc_member_sync_snapshot_v1(
  p_tenant_id uuid,
  p_finance_user_id text,
  p_expected_revision bigint
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_identity public.finance_users%rowtype;
  v_member_state private.finance_edoc_member_state_v1%rowtype;
  v_snapshot jsonb;
  v_company jsonb;
  v_actor_key text;
  v_actor jsonb;
  v_projection jsonb;
begin
  select user_row.*
  into v_identity
  from public.finance_users user_row
  where user_row.tenant_id = p_tenant_id
    and user_row.id = p_finance_user_id
  limit 1;

  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'member_not_found');
  end if;

  select state_row.*
  into v_member_state
  from private.finance_edoc_member_state_v1 state_row
  where state_row.tenant_id = p_tenant_id
    and state_row.finance_user_id = p_finance_user_id
  limit 1;

  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'member_sync_state_missing');
  end if;

  if v_member_state.source_revision > p_expected_revision then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'error', 'source_revision_superseded',
      'currentSourceRevision', v_member_state.source_revision
    );
  elsif v_member_state.source_revision < p_expected_revision then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'error', 'source_revision_ahead',
      'currentSourceRevision', v_member_state.source_revision
    );
  end if;

  v_snapshot := public.finance_edoc_identity_snapshot(lower(pg_catalog.btrim(v_identity.email)));
  if coalesce(v_snapshot ->> 'source', '') <> 'finance'
     or coalesce(v_snapshot #>> '{identity,financeUserId}', '') <> v_identity.id then
    -- Inactive, pending-first-login and legacy system rows must still reach
    -- eDoc so an old enabled projection can be disabled. Build a bounded
    -- canonical member projection even when the approval snapshot cannot be
    -- resolved by email. It is forcibly non-workflow-ready.
    v_projection := public.finance_edoc_actor_payload(v_identity.tenant_id, v_identity.id);
    if v_projection is null then
      v_projection := pg_catalog.jsonb_build_object(
        'financeUserId', v_identity.id,
        'name', v_identity.name,
        'email', lower(pg_catalog.btrim(v_identity.email)),
        'role', v_identity.role,
        'roleLabel', coalesce(nullif(v_identity.role_label, ''), v_identity.role, ''),
        'entityId', v_identity.entity_id,
        'departmentCode', v_identity.department_code,
        'active', false,
        'authUserBound', v_identity.auth_user_id is not null,
        'googleLoginVerified', v_identity.google_login_verified_at is not null,
        'orgStatus', coalesce(nullif(v_identity.org_status, ''), 'active'),
        'sourceUpdatedAt', coalesce(v_identity.org_source_updated_at, v_identity.created_at)
      ) || case
        when v_identity.auth_user_id is null then '{}'::jsonb
        else pg_catalog.jsonb_build_object('authUserId', v_identity.auth_user_id)
      end;
    end if;
    v_snapshot := pg_catalog.jsonb_build_object(
      'ok', true,
      'source', 'finance',
      'schemaVersion', 1,
      'snapshotAt', clock_timestamp(),
      'identity', v_projection || pg_catalog.jsonb_build_object(
        'sourceActive', coalesce(v_identity.active, false),
        'active', coalesce(v_identity.active, false)
      ),
      'company', '{}'::jsonb,
      'actors', '{}'::jsonb,
      'workflowReady', false,
      'issues', pg_catalog.jsonb_build_array('identity_not_ready')
    );
  end if;

  select state_row.payload
  into v_company
  from private.finance_edoc_company_state_v1 state_row
  where state_row.tenant_id = v_identity.tenant_id
    and state_row.entity_id = v_identity.entity_id
  limit 1;

  v_company := coalesce(
    v_company,
    v_snapshot -> 'company',
    '{}'::jsonb
  ) || pg_catalog.jsonb_build_object(
    'tenantId', v_identity.tenant_id,
    'entityId', v_identity.entity_id
  );

  v_snapshot := pg_catalog.jsonb_set(
    v_snapshot,
    '{identity}',
    private.finance_edoc_enrich_person_projection_v1(
      v_identity.tenant_id,
      coalesce(v_snapshot -> 'identity', '{}'::jsonb)
    ),
    true
  );

  foreach v_actor_key in array array[
    'applicantManager',
    'departmentHead',
    'ceo',
    'adminDirector',
    'generalAffairs'
  ]
  loop
    v_actor := v_snapshot #> array['actors', v_actor_key];
    if v_actor is not null and v_actor <> 'null'::jsonb then
      v_snapshot := pg_catalog.jsonb_set(
        v_snapshot,
        array['actors', v_actor_key],
        private.finance_edoc_enrich_person_projection_v1(v_identity.tenant_id, v_actor),
        true
      );
    end if;
  end loop;

  v_snapshot := pg_catalog.jsonb_set(v_snapshot, '{company}', v_company, true);

  return v_snapshot || pg_catalog.jsonb_build_object(
    'sourceRevision', v_member_state.source_revision
  );
end;
$function$;

create or replace function public.finance_edoc_company_sync_snapshot_v1(
  p_tenant_id uuid,
  p_entity_id text,
  p_expected_revision bigint
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_state private.finance_edoc_company_state_v1%rowtype;
begin
  select state_row.*
  into v_state
  from private.finance_edoc_company_state_v1 state_row
  where state_row.tenant_id = p_tenant_id
    and state_row.entity_id = p_entity_id
  limit 1;

  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'company_not_found');
  end if;

  if v_state.source_revision > p_expected_revision then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'error', 'source_revision_superseded',
      'currentSourceRevision', v_state.source_revision
    );
  elsif v_state.source_revision < p_expected_revision then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'error', 'source_revision_ahead',
      'currentSourceRevision', v_state.source_revision
    );
  end if;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'source', 'finance',
    'schemaVersion', 1,
    'snapshotAt', clock_timestamp(),
    'sourceRevision', v_state.source_revision,
    'company', v_state.payload
  );
end;
$function$;

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
  where (
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

create or replace function public.finance_edoc_sync_complete_v1(
  p_event_id uuid,
  p_worker_id text,
  p_outcome text,
  p_http_status integer default null,
  p_response_digest text default null
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_updated integer := 0;
begin
  if p_outcome not in ('applied', 'stale', 'replayed', 'superseded')
     or (p_http_status is not null and p_http_status not between 100 and 599)
     or (
       p_response_digest is not null
       and p_response_digest !~ '^[0-9a-f]{64}$'
     ) then
    raise exception 'Invalid Finance -> eDoc completion result'
      using errcode = '22023';
  end if;

  update private.finance_edoc_sync_outbox_v1 event_row
  set status = case when p_outcome = 'superseded' then 'superseded' else 'delivered' end,
      delivery_outcome = p_outcome,
      delivered_at = case when p_outcome = 'superseded' then null else clock_timestamp() end,
      last_http_status = p_http_status,
      response_digest = p_response_digest,
      next_attempt_at = clock_timestamp(),
      locked_at = null,
      locked_by = null,
      last_error_code = null,
      updated_at = clock_timestamp()
  where event_row.id = p_event_id
    and event_row.status = 'processing'
    and event_row.locked_by = left(coalesce(p_worker_id, ''), 100);

  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$function$;

create or replace function public.finance_edoc_sync_fail_v1(
  p_event_id uuid,
  p_worker_id text,
  p_error_code text,
  p_http_status integer default null,
  p_retry_after_seconds integer default null
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_updated integer := 0;
begin
  if p_error_code is null
     or char_length(p_error_code) not between 1 and 160
     or p_error_code !~ '^[a-z0-9_.:-]+$'
     or (p_http_status is not null and p_http_status not between 100 and 599) then
    raise exception 'Invalid Finance -> eDoc failure result'
      using errcode = '22023';
  end if;

  update private.finance_edoc_sync_outbox_v1 event_row
  set status = case
        when event_row.attempt_count >= event_row.max_attempts then 'dead'
        else 'failed'
      end,
      next_attempt_at = case
        when event_row.attempt_count >= event_row.max_attempts then clock_timestamp()
        else clock_timestamp() + (
          least(
            21600,
            greatest(
              30,
              coalesce(
                p_retry_after_seconds,
                (30 * power(3::numeric, least(greatest(event_row.attempt_count - 1, 0), 6)))::integer
              )
            )
          ) * interval '1 second'
        )
      end,
      last_error_code = p_error_code,
      last_http_status = p_http_status,
      locked_at = null,
      locked_by = null,
      updated_at = clock_timestamp(),
      retry_history = (
        select coalesce(
          pg_catalog.jsonb_agg(history_item order by ordinal),
          '[]'::jsonb
        )
        from (
          select history_item, ordinal
          from pg_catalog.jsonb_array_elements(
            event_row.retry_history || pg_catalog.jsonb_build_array(
              pg_catalog.jsonb_build_object(
                'at', clock_timestamp(),
                'attempt', event_row.attempt_count,
                'errorCode', p_error_code,
                'httpStatus', p_http_status
              )
            )
          ) with ordinality history(history_item, ordinal)
          order by ordinal desc
          limit 20
        ) recent
      )
  where event_row.id = p_event_id
    and event_row.status = 'processing'
    and event_row.locked_by = left(coalesce(p_worker_id, ''), 100);

  get diagnostics v_updated = row_count;
  return v_updated = 1;
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
    and not exists (
      select 1
      from private.finance_edoc_sync_outbox_v1 newer
      where newer.tenant_id = event_row.tenant_id
        and newer.aggregate_type = event_row.aggregate_type
        and newer.aggregate_id = event_row.aggregate_id
        and newer.source_revision > event_row.source_revision
    );

  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$function$;

alter function public.finance_edoc_member_sync_snapshot_v1(uuid,text,bigint) owner to postgres;
alter function public.finance_edoc_company_sync_snapshot_v1(uuid,text,bigint) owner to postgres;
alter function public.finance_edoc_sync_claim_v1(integer,text,integer) owner to postgres;
alter function public.finance_edoc_sync_complete_v1(uuid,text,text,integer,text) owner to postgres;
alter function public.finance_edoc_sync_fail_v1(uuid,text,text,integer,integer) owner to postgres;
alter function public.finance_edoc_sync_retry_v1(uuid) owner to postgres;

revoke all on function public.finance_edoc_member_sync_snapshot_v1(uuid,text,bigint)
  from public, anon, authenticated;
revoke all on function public.finance_edoc_company_sync_snapshot_v1(uuid,text,bigint)
  from public, anon, authenticated;
revoke all on function public.finance_edoc_sync_claim_v1(integer,text,integer)
  from public, anon, authenticated;
revoke all on function public.finance_edoc_sync_complete_v1(uuid,text,text,integer,text)
  from public, anon, authenticated;
revoke all on function public.finance_edoc_sync_fail_v1(uuid,text,text,integer,integer)
  from public, anon, authenticated;
revoke all on function public.finance_edoc_sync_retry_v1(uuid)
  from public, anon, authenticated;

grant execute on function public.finance_edoc_member_sync_snapshot_v1(uuid,text,bigint)
  to service_role;
grant execute on function public.finance_edoc_company_sync_snapshot_v1(uuid,text,bigint)
  to service_role;
grant execute on function public.finance_edoc_sync_claim_v1(integer,text,integer)
  to service_role;
grant execute on function public.finance_edoc_sync_complete_v1(uuid,text,text,integer,text)
  to service_role;
grant execute on function public.finance_edoc_sync_fail_v1(uuid,text,text,integer,integer)
  to service_role;
grant execute on function public.finance_edoc_sync_retry_v1(uuid)
  to service_role;

-- Seed every member state before refreshing companies. Company refresh touches
-- affected members, so this order prevents duplicate state insertion while
-- still producing a latest member event containing the canonical company.
insert into private.finance_edoc_member_state_v1 (
  tenant_id,
  finance_user_id,
  source_revision,
  finance_member_revision,
  source_updated_at
)
select
  user_row.tenant_id,
  user_row.id,
  greatest(user_row.member_revision, 1),
  user_row.member_revision,
  coalesce(user_row.org_source_updated_at, user_row.created_at, clock_timestamp())
from public.finance_users user_row;

-- Seed every canonical company. No network request runs in this transaction;
-- the cron-triggered worker will drain the durable rows only after commit.
do $seed_companies$
declare
  v_setting public.system_settings%rowtype;
begin
  for v_setting in
    select setting_row.*
    from public.system_settings setting_row
    where setting_row.key = 'entities'
    order by setting_row.tenant_id, setting_row.created_at, setting_row.id
  loop
    perform private.finance_edoc_refresh_companies_v1(
      v_setting.tenant_id,
      '[]'::jsonb,
      v_setting.value,
      coalesce(v_setting.updated_at, v_setting.created_at, clock_timestamp())
    );
  end loop;
end;
$seed_companies$;

insert into private.finance_edoc_sync_outbox_v1 (
  tenant_id,
  aggregate_type,
  aggregate_id,
  event_type,
  source_revision
)
select
  state_row.tenant_id,
  'member',
  state_row.finance_user_id,
  'member.changed',
  state_row.source_revision
from private.finance_edoc_member_state_v1 state_row
on conflict (tenant_id, aggregate_type, aggregate_id, source_revision)
  do nothing;

create or replace function private.finance_wake_edoc_sync_worker_v1()
returns bigint
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_worker_url text;
  v_notification_worker_url text;
  v_worker_secret text;
  v_worker_api_key text;
  v_request_id bigint;
begin
  select secret_row.decrypted_secret
  into v_worker_url
  from vault.decrypted_secrets secret_row
  where secret_row.name = 'finance_edoc_sync_worker_url'
  order by secret_row.created_at desc
  limit 1;

  if nullif(pg_catalog.btrim(v_worker_url), '') is null then
    select secret_row.decrypted_secret
    into v_notification_worker_url
    from vault.decrypted_secrets secret_row
    where secret_row.name = 'finance_notification_worker_url'
    order by secret_row.created_at desc
    limit 1;

    if pg_catalog.btrim(coalesce(v_notification_worker_url, ''))
       ~ '^https://[a-z0-9-]+[.]supabase[.]co/functions/v1/deliver-finance-notifications/?$' then
      v_worker_url := pg_catalog.regexp_replace(
        pg_catalog.btrim(v_notification_worker_url),
        '/deliver-finance-notifications/?$',
        '/sync-finance-members-to-edoc'
      );
    end if;
  end if;

  select secret_row.decrypted_secret
  into v_worker_secret
  from vault.decrypted_secrets secret_row
  where secret_row.name = 'finance_edoc_sync_worker_secret'
  order by secret_row.created_at desc
  limit 1;

  if nullif(pg_catalog.btrim(v_worker_secret), '') is null then
    select secret_row.decrypted_secret
    into v_worker_secret
    from vault.decrypted_secrets secret_row
    where secret_row.name = 'finance_notification_worker_secret'
    order by secret_row.created_at desc
    limit 1;
  end if;

  -- Reuse the existing project-level publishable/anon key. The dedicated
  -- worker secret remains the actual authorization boundary.
  select secret_row.decrypted_secret
  into v_worker_api_key
  from vault.decrypted_secrets secret_row
  where secret_row.name = 'finance_notification_worker_anon_key'
  order by secret_row.created_at desc
  limit 1;

  if nullif(pg_catalog.btrim(v_worker_url), '') is null
     or pg_catalog.btrim(v_worker_url)
       !~ '^https://[a-z0-9-]+[.]supabase[.]co/functions/v1/sync-finance-members-to-edoc/?$'
     or nullif(pg_catalog.btrim(v_worker_secret), '') is null
     or pg_catalog.octet_length(pg_catalog.btrim(v_worker_secret)) < 32
     or nullif(pg_catalog.btrim(v_worker_api_key), '') is null then
    return null;
  end if;

  select net.http_post(
    url := pg_catalog.btrim(v_worker_url),
    headers := pg_catalog.jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', pg_catalog.btrim(v_worker_api_key),
      'x-finance-sync-worker-secret', pg_catalog.btrim(v_worker_secret)
    ),
    body := pg_catalog.jsonb_build_object(
      'limit', 50,
      'worker_id', 'database-' || pg_catalog.pg_backend_pid()::text
    ),
    timeout_milliseconds := 15000
  ) into v_request_id;

  return v_request_id;
exception
  when others then
    raise warning 'Unable to wake Finance -> eDoc sync worker (%).', sqlstate;
    return null;
end;
$function$;

alter function private.finance_wake_edoc_sync_worker_v1() owner to postgres;
revoke all on function private.finance_wake_edoc_sync_worker_v1()
  from public, anon, authenticated, service_role;

do $schedule$
begin
  if exists (
    select 1
    from cron.job job_row
    where job_row.jobname = 'finance-edoc-member-company-sync'
  ) then
    raise exception 'Finance -> eDoc sync cron job already exists';
  end if;

  perform cron.schedule(
    'finance-edoc-member-company-sync',
    '* * * * *',
    'select private.finance_wake_edoc_sync_worker_v1();'
  );
end;
$schedule$;

do $postflight$
declare
  v_function regprocedure;
  v_relation regclass;
begin
  if not exists (
    select 1
    from pg_catalog.pg_trigger trigger_row
    where trigger_row.tgrelid = 'public.finance_users'::regclass
      and trigger_row.tgname = 'finance_users_edoc_outbox_v1'
      and trigger_row.tgenabled = 'O'
      and not trigger_row.tgisinternal
  ) or not exists (
    select 1
    from pg_catalog.pg_trigger trigger_row
    where trigger_row.tgrelid = 'public.system_settings'::regclass
      and trigger_row.tgname = 'system_settings_edoc_company_outbox_v1'
      and trigger_row.tgenabled = 'O'
      and not trigger_row.tgisinternal
  ) or not exists (
    select 1
    from pg_catalog.pg_trigger trigger_row
    where trigger_row.tgrelid = 'public.employee_department_roles'::regclass
      and trigger_row.tgname = 'employee_department_roles_edoc_member_outbox_v1'
      and trigger_row.tgenabled = 'O'
      and not trigger_row.tgisinternal
  ) or not exists (
    select 1
    from pg_catalog.pg_trigger trigger_row
    where trigger_row.tgrelid = 'public.departments'::regclass
      and trigger_row.tgname = 'departments_edoc_member_outbox_v1'
      and trigger_row.tgenabled = 'O'
      and not trigger_row.tgisinternal
  ) or not exists (
    select 1
    from pg_catalog.pg_trigger trigger_row
    where trigger_row.tgrelid = 'public.finance_department_units'::regclass
      and trigger_row.tgname = 'finance_department_units_edoc_member_outbox_v1'
      and trigger_row.tgenabled = 'O'
      and not trigger_row.tgisinternal
  ) or not exists (
    select 1
    from pg_catalog.pg_trigger trigger_row
    where trigger_row.tgrelid = 'public.approval_role_responsibility_matrix'::regclass
      and trigger_row.tgname = 'approval_role_matrix_edoc_member_outbox_v1'
      and trigger_row.tgenabled = 'O'
      and not trigger_row.tgisinternal
  ) then
    raise exception 'Finance -> eDoc source triggers are incomplete';
  end if;

  if (
    select count(*)
    from pg_catalog.pg_class class_row
    where class_row.oid in (
      'private.finance_edoc_member_state_v1'::regclass,
      'private.finance_edoc_sync_outbox_v1'::regclass,
      'private.finance_edoc_company_state_v1'::regclass
    )
      and class_row.relrowsecurity
      and class_row.relforcerowsecurity
  ) <> 3 then
    raise exception 'Finance -> eDoc private tables must force RLS';
  end if;

  foreach v_relation in array array[
    'private.finance_edoc_member_state_v1'::regclass,
    'private.finance_edoc_company_state_v1'::regclass,
    'private.finance_edoc_sync_outbox_v1'::regclass
  ]
  loop
    if pg_catalog.has_table_privilege('anon', v_relation, 'SELECT')
       or pg_catalog.has_table_privilege('anon', v_relation, 'INSERT')
       or pg_catalog.has_table_privilege('anon', v_relation, 'UPDATE')
       or pg_catalog.has_table_privilege('anon', v_relation, 'DELETE')
       or pg_catalog.has_table_privilege('authenticated', v_relation, 'SELECT')
       or pg_catalog.has_table_privilege('authenticated', v_relation, 'INSERT')
       or pg_catalog.has_table_privilege('authenticated', v_relation, 'UPDATE')
       or pg_catalog.has_table_privilege('authenticated', v_relation, 'DELETE')
       or not pg_catalog.has_table_privilege('service_role', v_relation, 'SELECT')
       or not pg_catalog.has_table_privilege('service_role', v_relation, 'INSERT')
       or not pg_catalog.has_table_privilege('service_role', v_relation, 'UPDATE')
       or not pg_catalog.has_table_privilege('service_role', v_relation, 'DELETE') then
      raise exception 'Finance -> eDoc private table ACL is invalid for %', v_relation;
    end if;
  end loop;

  foreach v_function in array array[
    'public.finance_edoc_member_sync_snapshot_v1(uuid,text,bigint)'::regprocedure,
    'public.finance_edoc_company_sync_snapshot_v1(uuid,text,bigint)'::regprocedure,
    'public.finance_edoc_sync_claim_v1(integer,text,integer)'::regprocedure,
    'public.finance_edoc_sync_complete_v1(uuid,text,text,integer,text)'::regprocedure,
    'public.finance_edoc_sync_fail_v1(uuid,text,text,integer,integer)'::regprocedure,
    'public.finance_edoc_sync_retry_v1(uuid)'::regprocedure
  ]
  loop
    if pg_catalog.has_function_privilege('anon', v_function, 'EXECUTE')
       or pg_catalog.has_function_privilege('authenticated', v_function, 'EXECUTE')
       or not pg_catalog.has_function_privilege('service_role', v_function, 'EXECUTE') then
      raise exception 'Finance -> eDoc RPC ACL is invalid for %', v_function;
    end if;
  end loop;

  if (
    select count(*)
    from cron.job job_row
    where job_row.jobname = 'finance-edoc-member-company-sync'
      and job_row.schedule = '* * * * *'
      and job_row.active
  ) <> 1 then
    raise exception 'Finance -> eDoc cron schedule is incomplete';
  end if;

  if exists (
    select 1
    from public.finance_users user_row
    left join private.finance_edoc_member_state_v1 state_row
      on state_row.tenant_id = user_row.tenant_id
     and state_row.finance_user_id = user_row.id
    left join private.finance_edoc_sync_outbox_v1 event_row
      on event_row.tenant_id = state_row.tenant_id
     and event_row.aggregate_type = 'member'
     and event_row.aggregate_id = state_row.finance_user_id
     and event_row.source_revision = state_row.source_revision
    where state_row.finance_user_id is null
       or event_row.id is null
  ) then
    raise exception 'Finance -> eDoc did not seed every Finance user';
  end if;

  if exists (
    select 1
    from private.finance_edoc_company_state_v1 state_row
    left join private.finance_edoc_sync_outbox_v1 event_row
      on event_row.tenant_id = state_row.tenant_id
     and event_row.aggregate_type = 'company'
     and event_row.aggregate_id = state_row.entity_id
     and event_row.source_revision = state_row.source_revision
    where event_row.id is null
  ) then
    raise exception 'Finance -> eDoc did not seed every canonical company';
  end if;
end;
$postflight$;

notify pgrst, 'reload schema';

commit;
