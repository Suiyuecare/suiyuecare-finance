-- Reconcile the Finance notification runtime contract and Portal Finance entry.
--
-- This migration is intentionally additive and rerunnable:
--   * existing non-null notification environment/tenant values are preserved;
--   * invalid pre-existing values fail closed during constraint validation;
--   * storage_path remains canonical while a generated, read-only path alias
--     keeps the currently published browser compatible during the rollout;
--   * only the known retired duplicate employee projection is reconciled;
--   * notification access is restricted to the authenticated tenant and the
--     production data lane;
--   * every active Portal role with a Finance role receives a Finance entry;
--   * every non-module role/scope/action/limit field is frozen row by row and
--     postflight compared so a visible entry can never become authorization.
--
-- Do not add transaction-control or pipeline-incompatible statements here.
-- The pinned Supabase CLI owns the atomic migration + ledger transaction.

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $preflight$
declare
  v_default_tenant_id uuid;
  v_column_type text;
  v_required_role_count integer;
begin
  if pg_catalog.to_regclass('public.notifications') is null
     or pg_catalog.to_regclass('public.file_attachments') is null
     or pg_catalog.to_regclass('public.finance_portal_roles') is null
     or pg_catalog.to_regclass('public.employees') is null
     or pg_catalog.to_regclass('public.tenants') is null then
    raise exception 'Notification/Portal reconciliation prerequisites are missing'
      using errcode = '55000',
            detail = 'Required relations: public.notifications, public.file_attachments, public.finance_portal_roles, public.employees, public.tenants.',
            hint = 'Apply the canonical Finance schema before this reconciliation migration.';
  end if;

  if pg_catalog.to_regprocedure('public.current_tenant_id()') is null then
    raise exception 'public.current_tenant_id() is required for notification tenant isolation'
      using errcode = '55000';
  end if;

  if pg_catalog.to_regprocedure('public.default_tenant_id()') is null then
    raise exception 'public.default_tenant_id() is required for notification tenant backfill'
      using errcode = '55000';
  end if;

  select public.default_tenant_id()
    into v_default_tenant_id;

  if v_default_tenant_id is null
     or not exists (
       select 1
       from public.tenants tenant_row
       where tenant_row.id = v_default_tenant_id
     ) then
    raise exception 'The canonical default tenant is missing; refusing to guess notification ownership'
      using errcode = '55000';
  end if;

  -- A partially applied migration may already have these columns. Accept only
  -- the canonical types; never coerce live data through an implicit rewrite.
  select pg_catalog.format_type(attribute_row.atttypid, attribute_row.atttypmod)
    into v_column_type
  from pg_catalog.pg_attribute attribute_row
  where attribute_row.attrelid = 'public.notifications'::pg_catalog.regclass
    and attribute_row.attname = 'data_environment'
    and attribute_row.attnum > 0
    and not attribute_row.attisdropped;

  if v_column_type is not null and v_column_type <> 'text' then
    raise exception 'public.notifications.data_environment has an incompatible type: %', v_column_type
      using errcode = '42804';
  end if;

  select pg_catalog.format_type(attribute_row.atttypid, attribute_row.atttypmod)
    into v_column_type
  from pg_catalog.pg_attribute attribute_row
  where attribute_row.attrelid = 'public.notifications'::pg_catalog.regclass
    and attribute_row.attname = 'tenant_id'
    and attribute_row.attnum > 0
    and not attribute_row.attisdropped;

  if v_column_type is not null and v_column_type <> 'uuid' then
    raise exception 'public.notifications.tenant_id has an incompatible type: %', v_column_type
      using errcode = '42804';
  end if;

  if not exists (
       select 1
       from pg_catalog.pg_attribute attribute_row
       where attribute_row.attrelid = 'public.file_attachments'::pg_catalog.regclass
         and attribute_row.attname = 'storage_path'
         and attribute_row.attnum > 0
         and not attribute_row.attisdropped
     ) then
    raise exception 'Canonical public.file_attachments.storage_path is missing'
      using errcode = '55000';
  end if;

  if exists (
       select 1
       from pg_catalog.pg_attribute attribute_row
       left join pg_catalog.pg_attrdef default_row
         on default_row.adrelid = attribute_row.attrelid
        and default_row.adnum = attribute_row.attnum
       where attribute_row.attrelid = 'public.file_attachments'::pg_catalog.regclass
         and attribute_row.attname = 'path'
         and attribute_row.attnum > 0
         and not attribute_row.attisdropped
         and (
           attribute_row.attgenerated <> 's'
           or pg_catalog.format_type(attribute_row.atttypid, attribute_row.atttypmod) <> 'text'
           or pg_catalog.pg_get_expr(default_row.adbin, default_row.adrelid) <> 'storage_path'
         )
     ) then
    raise exception 'public.file_attachments.path exists but is not the exact generated rollout alias'
      using errcode = '55000',
            detail = 'Only path text generated always as (storage_path) stored is accepted during the expand phase.';
  end if;

  -- Portal module visibility is only an entry gate. Every active Portal row is
  -- already mapped to an internal Finance role, whose scope/actions/limits
  -- remain authoritative after the entry is added. Pin the six audited rows so
  -- this migration cannot silently sweep in an unrelated catalog drift.
  select pg_catalog.count(*)::integer
    into v_required_role_count
  from (
    values
      ('business-director'::text, 'dept_manager'::text),
      ('ga-chief'::text, 'general_affairs'::text),
      ('hr-chief'::text, 'hr'::text),
      ('section-chief'::text, 'section_chief'::text),
      ('staff'::text, 'employee'::text),
      ('team-lead'::text, 'section_chief'::text)
  ) expected_role(id, finance_role)
  join public.finance_portal_roles portal_role
    on portal_role.id = expected_role.id
   and portal_role.finance_role = expected_role.finance_role
   and portal_role.active;

  if v_required_role_count <> 6 then
    raise exception 'Expected six audited active Portal roles mapped to their Finance roles; found %', v_required_role_count
      using errcode = '55000',
            hint = 'Reconcile the Portal role catalog before granting Finance module entries.';
  end if;

  if exists (
       select 1
       from public.finance_portal_roles portal_role
       where portal_role.active
         and nullif(pg_catalog.btrim(portal_role.finance_role), '') is null
     ) then
    raise exception 'Every active Portal role must map to a non-empty Finance role before entry reconciliation'
      using errcode = '55000';
  end if;

  if exists (
       select 1
       from public.finance_portal_roles portal_role
       where portal_role.active
         and coalesce(pg_catalog.cardinality(pg_catalog.array_positions(portal_role.modules, '會計系統')), 0) = 0
         and coalesce(pg_catalog.cardinality(pg_catalog.array_positions(portal_role.modules, '全部模組')), 0) = 0
         and portal_role.id not in (
           'business-director', 'ga-chief', 'hr-chief',
           'section-chief', 'staff', 'team-lead'
         )
     ) then
    raise exception 'An unaudited active Portal role is missing its Finance entry; refusing a broad module update'
      using errcode = '55000';
  end if;

  -- This release repairs one already-audited duplicate projection only. Any
  -- other active row carrying retirement metadata is an unexpected data state
  -- and stops the migration instead of being swept into a broad update.
  if exists (
       select 1
       from public.employees employee_row
       where employee_row.deleted_at is null
         and employee_row.employment_status = 'active'
         and nullif(pg_catalog.btrim(employee_row.metadata ->> 'retired_at'), '') is not null
         and not (
           employee_row.id = '6c101aa3-b91d-4590-ae7a-5df070af2793'::uuid
           and employee_row.employee_no = 'u_1785138353548'
           and pg_catalog.lower(pg_catalog.btrim(employee_row.email)) = 'admin.ntpc@suiyuecare.com'
           and employee_row.full_name = '蘇之瑄'
         )
     ) then
    raise exception 'Unexpected active employee projection contains retired_at metadata; refusing a broad retirement update'
      using errcode = '55000';
  end if;

  if exists (
       select 1
       from public.employees employee_row
       where employee_row.id = '6c101aa3-b91d-4590-ae7a-5df070af2793'::uuid
         and employee_row.deleted_at is null
         and employee_row.employment_status = 'active'
         and (
           employee_row.employee_no is distinct from 'u_1785138353548'
           or pg_catalog.lower(pg_catalog.btrim(employee_row.email)) is distinct from 'admin.ntpc@suiyuecare.com'
           or employee_row.full_name is distinct from '蘇之瑄'
           or nullif(pg_catalog.btrim(employee_row.metadata ->> 'retired_at'), '') is null
           or employee_row.metadata ->> 'retired_at'
                !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?([+-]\d{2}:\d{2}|Z)$'
           or case
                when employee_row.metadata ->> 'retired_at'
                     ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?([+-]\d{2}:\d{2}|Z)$'
                then (employee_row.metadata ->> 'retired_at')::timestamptz > pg_catalog.clock_timestamp()
                else false
              end
         )
     ) then
    raise exception 'The expected retired duplicate projection does not match the audited fingerprint'
      using errcode = '55000';
  end if;
end;
$preflight$;

-- Snapshot every Portal row. Postflight compares every non-module field as one
-- JSON value and requires the exact expected module array for each row.
create temporary table notification_finance_entry_reconciliation_role_before
on commit drop
as
select portal_role.id,
       portal_role.modules as modules_before,
       portal_role.updated_at as updated_at_before,
       case
         when portal_role.active
          and portal_role.id in (
            'business-director', 'ga-chief', 'hr-chief',
            'section-chief', 'staff', 'team-lead'
          )
          and coalesce(pg_catalog.cardinality(pg_catalog.array_positions(portal_role.modules, '會計系統')), 0) = 0
          and coalesce(pg_catalog.cardinality(pg_catalog.array_positions(portal_role.modules, '全部模組')), 0) = 0
         then pg_catalog.array_append(portal_role.modules, '會計系統')
         else portal_role.modules
       end as modules_expected,
       to_jsonb(portal_role) - array['modules', 'updated_at']::text[] as immutable_payload
from public.finance_portal_roles portal_role;

create temporary table notification_staff_reconciliation_acl_before
on commit drop
as
select relation_row.oid as relation_oid,
       relation_row.relacl
from pg_catalog.pg_class relation_row
where relation_row.oid in (
  'public.notifications'::pg_catalog.regclass,
  'public.finance_portal_roles'::pg_catalog.regclass,
  'public.file_attachments'::pg_catalog.regclass
);

create temporary table notification_staff_reconciliation_policies_before
on commit drop
as
select policy_row.policyname,
       policy_row.permissive,
       policy_row.roles,
       policy_row.cmd,
       policy_row.qual,
       policy_row.with_check
from pg_catalog.pg_policies policy_row
where policy_row.schemaname = 'public'
  and policy_row.tablename = 'notifications';

-- Expand before changing the production alias. The currently published
-- browser probes file_attachments.path whenever a submission has attachments.
-- A stored generated column is read-only and cannot diverge from storage_path;
-- the v2 contract removes it only after the storage_path-only candidate is live.
alter table public.file_attachments
  add column if not exists path text generated always as (storage_path) stored;

comment on column public.file_attachments.path is
  'Temporary read-only rollout alias for the pre-storage_path Finance browser; removed by expense route authority v2.';

alter table public.notifications
  add column if not exists data_environment text;

alter table public.notifications
  add column if not exists tenant_id uuid;

-- Existing rows predate environment and tenant stamping. This deployment has
-- one canonical default tenant; only NULL values are backfilled. Any existing
-- non-null unexpected value is preserved and then rejected by validation.
update public.notifications notification_row
set data_environment = 'production'
where notification_row.data_environment is null;

update public.notifications notification_row
set tenant_id = public.default_tenant_id()
where notification_row.tenant_id is null;

alter table public.notifications
  alter column data_environment set default 'production'::text,
  alter column data_environment set not null,
  alter column tenant_id set default public.default_tenant_id(),
  alter column tenant_id set not null;

do $constraints$
declare
  v_constraint_type "char";
  v_constraint_expression text;
  v_referenced_relation oid;
  v_constraint_keys smallint[];
  v_tenant_attnum smallint;
begin
  select constraint_row.contype,
         pg_catalog.pg_get_expr(constraint_row.conbin, constraint_row.conrelid)
    into v_constraint_type, v_constraint_expression
  from pg_catalog.pg_constraint constraint_row
  where constraint_row.conrelid = 'public.notifications'::pg_catalog.regclass
    and constraint_row.conname = 'notifications_data_environment_check_v1';

  if v_constraint_type is null then
    alter table public.notifications
      add constraint notifications_data_environment_check_v1
      check (data_environment in ('production', 'test'))
      not valid;
  elsif v_constraint_type <> 'c'
        or v_constraint_expression not like '%data_environment%'
        or v_constraint_expression not like '%production%'
        or v_constraint_expression not like '%test%' then
    raise exception 'notifications_data_environment_check_v1 exists with an incompatible definition'
      using errcode = '55000';
  end if;

  select attribute_row.attnum
    into strict v_tenant_attnum
  from pg_catalog.pg_attribute attribute_row
  where attribute_row.attrelid = 'public.notifications'::pg_catalog.regclass
    and attribute_row.attname = 'tenant_id'
    and attribute_row.attnum > 0
    and not attribute_row.attisdropped;

  select constraint_row.contype,
         constraint_row.confrelid,
         constraint_row.conkey
    into v_constraint_type, v_referenced_relation, v_constraint_keys
  from pg_catalog.pg_constraint constraint_row
  where constraint_row.conrelid = 'public.notifications'::pg_catalog.regclass
    and constraint_row.conname = 'notifications_tenant_id_fkey_v1';

  if v_constraint_type is null then
    alter table public.notifications
      add constraint notifications_tenant_id_fkey_v1
      foreign key (tenant_id)
      references public.tenants(id)
      on update cascade
      on delete restrict
      not valid;
  elsif v_constraint_type <> 'f'
        or v_referenced_relation <> 'public.tenants'::pg_catalog.regclass
        or v_constraint_keys is distinct from array[v_tenant_attnum]::smallint[] then
    raise exception 'notifications_tenant_id_fkey_v1 exists with an incompatible definition'
      using errcode = '55000';
  end if;

  select constraint_row.contype,
         pg_catalog.pg_get_expr(constraint_row.conbin, constraint_row.conrelid)
    into v_constraint_type, v_constraint_expression
  from pg_catalog.pg_constraint constraint_row
  where constraint_row.conrelid = 'public.finance_portal_roles'::pg_catalog.regclass
    and constraint_row.conname = 'finance_portal_roles_active_finance_entry_check_v1';

  if v_constraint_type is null then
    alter table public.finance_portal_roles
      add constraint finance_portal_roles_active_finance_entry_check_v1
      check (
        not active
        or (
          nullif(pg_catalog.btrim(finance_role), '') is not null
          and coalesce(pg_catalog.cardinality(pg_catalog.array_positions(modules, '會計系統')), 0) <= 1
          and coalesce(pg_catalog.cardinality(pg_catalog.array_positions(modules, '全部模組')), 0) <= 1
          and (
            coalesce(pg_catalog.cardinality(pg_catalog.array_positions(modules, '會計系統')), 0)
            + coalesce(pg_catalog.cardinality(pg_catalog.array_positions(modules, '全部模組')), 0)
          ) >= 1
        )
      )
      not valid;
  elsif v_constraint_type <> 'c'
        or v_constraint_expression not like '%active%'
        or v_constraint_expression not like '%finance_role%'
        or v_constraint_expression not like '%modules%'
        or v_constraint_expression not like '%會計系統%'
        or v_constraint_expression not like '%全部模組%' then
    raise exception 'finance_portal_roles_active_finance_entry_check_v1 exists with an incompatible definition'
      using errcode = '55000';
  end if;
end;
$constraints$;

alter table public.notifications
  validate constraint notifications_data_environment_check_v1;

alter table public.notifications
  validate constraint notifications_tenant_id_fkey_v1;

create index if not exists notifications_tenant_environment_created_idx_v1
  on public.notifications (tenant_id, data_environment, created_at desc);

-- Existing permissive policies continue to decide which rows a person may
-- access. This restrictive policy is AND-ed with all of them, so no policy can
-- cross the verified tenant or read/write a test-lane notification in the
-- production database.
do $notification_policy$
declare
  v_policy record;
begin
  select policy_row.*
    into v_policy
  from pg_catalog.pg_policies policy_row
  where policy_row.schemaname = 'public'
    and policy_row.tablename = 'notifications'
    and policy_row.policyname = 'notifications_tenant_production_isolation_v1';

  if not found then
    create policy notifications_tenant_production_isolation_v1
      on public.notifications
      as restrictive
      for all
      to authenticated
      using (
        tenant_id = public.current_tenant_id()
        and data_environment = 'production'
      )
      with check (
        tenant_id = public.current_tenant_id()
        and data_environment = 'production'
      );
  elsif v_policy.permissive <> 'RESTRICTIVE'
        or v_policy.cmd <> 'ALL'
        or v_policy.roles is distinct from array['authenticated'::name]
        or v_policy.qual not ilike '%tenant_id%current_tenant_id%data_environment%production%'
        or v_policy.with_check not ilike '%tenant_id%current_tenant_id%data_environment%production%' then
    raise exception 'notifications_tenant_production_isolation_v1 exists with an incompatible definition'
      using errcode = '55000';
  end if;
end;
$notification_policy$;

-- Only the six audited active role rows receive one module label. Their
-- Finance role, scope, actions, limits, other modules and every other field
-- remain unchanged; Finance continues to enforce those internal permissions.
update public.finance_portal_roles portal_role
set modules = pg_catalog.array_append(portal_role.modules, '會計系統'),
    updated_at = pg_catalog.clock_timestamp()
from (
  values
    ('business-director'::text, 'dept_manager'::text),
    ('ga-chief'::text, 'general_affairs'::text),
    ('hr-chief'::text, 'hr'::text),
    ('section-chief'::text, 'section_chief'::text),
    ('staff'::text, 'employee'::text),
    ('team-lead'::text, 'section_chief'::text)
) expected_role(id, finance_role)
where portal_role.id = expected_role.id
  and portal_role.finance_role = expected_role.finance_role
  and portal_role.active
  and coalesce(pg_catalog.cardinality(pg_catalog.array_positions(portal_role.modules, '會計系統')), 0) = 0
  and coalesce(pg_catalog.cardinality(pg_catalog.array_positions(portal_role.modules, '全部模組')), 0) = 0;

alter table public.finance_portal_roles
  validate constraint finance_portal_roles_active_finance_entry_check_v1;

-- A prior repair recorded retirement provenance but left this one duplicate
-- projection active. Lock the update to its audited UUID and identity
-- fingerprint; a future or unrelated retired_at value is never swept in.
update public.employees employee_row
set employment_status = 'terminated',
    termination_date = coalesce(
      employee_row.termination_date,
      ((employee_row.metadata ->> 'retired_at')::timestamptz)::date
    ),
    deleted_at = coalesce(
      employee_row.deleted_at,
      (employee_row.metadata ->> 'retired_at')::timestamptz
    ),
    updated_at = pg_catalog.clock_timestamp()
where employee_row.id = '6c101aa3-b91d-4590-ae7a-5df070af2793'::uuid
  and employee_row.employee_no = 'u_1785138353548'
  and pg_catalog.lower(pg_catalog.btrim(employee_row.email)) = 'admin.ntpc@suiyuecare.com'
  and employee_row.full_name = '蘇之瑄'
  and employee_row.deleted_at is null
  and employee_row.employment_status = 'active'
  and nullif(pg_catalog.btrim(employee_row.metadata ->> 'retired_at'), '') is not null
  and (employee_row.metadata ->> 'retired_at')::timestamptz <= pg_catalog.clock_timestamp();

-- These relations were already exposed. Keep the existing policies and ACLs,
-- but guarantee that schema reconciliation cannot disable row protection.
alter table public.notifications enable row level security;
alter table public.notifications force row level security;
alter table public.finance_portal_roles enable row level security;
alter table public.finance_portal_roles force row level security;
alter table public.file_attachments enable row level security;
alter table public.file_attachments force row level security;

comment on column public.notifications.data_environment is
  'Finance data lane. Allowed values are production and test.';

comment on column public.notifications.tenant_id is
  'Tenant boundary for Finance notification runtime reads and writes.';

do $postflight$
declare
  v_constraint_expression text;
  v_relation record;
begin
  if exists (
       select 1
       from information_schema.columns column_row
       where column_row.table_schema = 'public'
         and column_row.table_name = 'notifications'
         and column_row.column_name = 'data_environment'
         and (
           column_row.data_type <> 'text'
           or column_row.is_nullable <> 'NO'
           or column_row.column_default is distinct from '''production''::text'
         )
     )
     or not exists (
       select 1
       from information_schema.columns column_row
       where column_row.table_schema = 'public'
         and column_row.table_name = 'notifications'
         and column_row.column_name = 'data_environment'
     ) then
    raise exception 'Notification data_environment postflight failed';
  end if;

  if exists (
       select 1
       from information_schema.columns column_row
       where column_row.table_schema = 'public'
         and column_row.table_name = 'notifications'
         and column_row.column_name = 'tenant_id'
         and (
           column_row.data_type <> 'uuid'
           or column_row.is_nullable <> 'NO'
           or column_row.column_default not like '%default_tenant_id%'
         )
     )
     or not exists (
       select 1
       from information_schema.columns column_row
       where column_row.table_schema = 'public'
         and column_row.table_name = 'notifications'
         and column_row.column_name = 'tenant_id'
     ) then
    raise exception 'Notification tenant_id postflight failed';
  end if;

  if exists (
       select 1
       from public.notifications notification_row
       where notification_row.data_environment not in ('production', 'test')
          or notification_row.tenant_id is null
     ) then
    raise exception 'Notification environment/tenant backfill postflight failed';
  end if;

  if not exists (
       select 1
       from pg_catalog.pg_constraint constraint_row
       where constraint_row.conrelid = 'public.notifications'::pg_catalog.regclass
         and constraint_row.conname in (
           'notifications_data_environment_check_v1',
           'notifications_tenant_id_fkey_v1'
         )
         and constraint_row.convalidated
       group by constraint_row.conrelid
       having pg_catalog.count(*) = 2
     ) then
    raise exception 'Notification constraints are absent or unvalidated';
  end if;

  if not exists (
       select 1
       from pg_catalog.pg_indexes index_row
       where index_row.schemaname = 'public'
         and index_row.tablename = 'notifications'
         and index_row.indexname = 'notifications_tenant_environment_created_idx_v1'
         and index_row.indexdef ilike '%(tenant_id, data_environment, created_at desc)%'
     ) then
    raise exception 'Notification tenant/environment lookup index is missing';
  end if;

  select pg_catalog.pg_get_expr(constraint_row.conbin, constraint_row.conrelid)
    into v_constraint_expression
  from pg_catalog.pg_constraint constraint_row
  where constraint_row.conrelid = 'public.finance_portal_roles'::pg_catalog.regclass
    and constraint_row.conname = 'finance_portal_roles_active_finance_entry_check_v1'
    and constraint_row.contype = 'c'
    and constraint_row.convalidated;

  if v_constraint_expression is null
     or v_constraint_expression not like '%active%'
     or v_constraint_expression not like '%finance_role%'
     or v_constraint_expression not like '%modules%'
     or v_constraint_expression not like '%會計系統%'
     or v_constraint_expression not like '%全部模組%' then
    raise exception 'Active Portal Finance entry invariant is absent, invalid or unvalidated';
  end if;

  if exists (
       select 1
       from public.finance_portal_roles portal_role
       where portal_role.active
         and (
           nullif(pg_catalog.btrim(portal_role.finance_role), '') is null
           or coalesce(pg_catalog.cardinality(pg_catalog.array_positions(portal_role.modules, '會計系統')), 0) > 1
           or coalesce(pg_catalog.cardinality(pg_catalog.array_positions(portal_role.modules, '全部模組')), 0) > 1
           or (
             coalesce(pg_catalog.cardinality(pg_catalog.array_positions(portal_role.modules, '會計系統')), 0)
             + coalesce(pg_catalog.cardinality(pg_catalog.array_positions(portal_role.modules, '全部模組')), 0)
           ) < 1
         )
     ) then
    raise exception 'Every active Portal role must have one Finance entry and a non-empty Finance role';
  end if;

  if exists (
       select 1
       from public.employees employee_row
       where employee_row.id = '6c101aa3-b91d-4590-ae7a-5df070af2793'::uuid
         and employee_row.employee_no = 'u_1785138353548'
         and pg_catalog.lower(pg_catalog.btrim(employee_row.email)) = 'admin.ntpc@suiyuecare.com'
         and employee_row.full_name = '蘇之瑄'
         and employee_row.deleted_at is null
         and employee_row.employment_status = 'active'
     ) then
    raise exception 'The audited retired duplicate employee projection is still active after reconciliation';
  end if;

  if not exists (
       select 1
       from pg_catalog.pg_policies policy_row
       where policy_row.schemaname = 'public'
         and policy_row.tablename = 'notifications'
         and policy_row.policyname = 'notifications_tenant_production_isolation_v1'
         and policy_row.permissive = 'RESTRICTIVE'
         and policy_row.cmd = 'ALL'
         and policy_row.roles = array['authenticated'::name]
         and policy_row.qual ilike '%tenant_id%current_tenant_id%data_environment%production%'
         and policy_row.with_check ilike '%tenant_id%current_tenant_id%data_environment%production%'
     ) then
    raise exception 'Notification tenant/environment restrictive policy postflight failed';
  end if;

  if exists (
       select 1
       from notification_staff_reconciliation_policies_before before_policy
       left join pg_catalog.pg_policies after_policy
         on after_policy.schemaname = 'public'
        and after_policy.tablename = 'notifications'
        and after_policy.policyname = before_policy.policyname
       where after_policy.policyname is null
          or after_policy.permissive is distinct from before_policy.permissive
          or after_policy.roles is distinct from before_policy.roles
          or after_policy.cmd is distinct from before_policy.cmd
          or after_policy.qual is distinct from before_policy.qual
          or after_policy.with_check is distinct from before_policy.with_check
     ) then
    raise exception 'An existing notification policy drifted during reconciliation';
  end if;

  if exists (
       select 1
       from notification_finance_entry_reconciliation_role_before before_row
       full join public.finance_portal_roles after_row
         on after_row.id = before_row.id
       where before_row.id is null
          or after_row.id is null
          or (to_jsonb(after_row) - array['modules', 'updated_at']::text[])
               is distinct from before_row.immutable_payload
          or after_row.modules is distinct from before_row.modules_expected
          or (
            before_row.modules_expected is not distinct from before_row.modules_before
            and after_row.updated_at is distinct from before_row.updated_at_before
          )
     ) then
    raise exception 'Portal Finance entry reconciliation changed a non-module permission or an unexpected module row';
  end if;

  for v_relation in
    select relation_row.oid,
           relation_row.relname,
           relation_row.relrowsecurity,
           relation_row.relforcerowsecurity,
           relation_row.relacl
    from pg_catalog.pg_class relation_row
    where relation_row.oid in (
      'public.notifications'::pg_catalog.regclass,
      'public.finance_portal_roles'::pg_catalog.regclass,
      'public.file_attachments'::pg_catalog.regclass
    )
  loop
    if not v_relation.relrowsecurity or not v_relation.relforcerowsecurity then
      raise exception 'RLS protection is not enabled and forced on public.%', v_relation.relname;
    end if;

    if not exists (
         select 1
         from notification_staff_reconciliation_acl_before before_acl
         where before_acl.relation_oid = v_relation.oid
           and before_acl.relacl is not distinct from v_relation.relacl
       ) then
      raise exception 'ACL drift detected on public.%', v_relation.relname;
    end if;
  end loop;

  if not exists (
       select 1
       from pg_catalog.pg_attribute attribute_row
       where attribute_row.attrelid = 'public.file_attachments'::pg_catalog.regclass
         and attribute_row.attname = 'storage_path'
         and attribute_row.attnum > 0
         and not attribute_row.attisdropped
     )
     or not exists (
       select 1
       from pg_catalog.pg_attribute attribute_row
       join pg_catalog.pg_attrdef default_row
         on default_row.adrelid = attribute_row.attrelid
        and default_row.adnum = attribute_row.attnum
       where attribute_row.attrelid = 'public.file_attachments'::pg_catalog.regclass
         and attribute_row.attname = 'path'
         and attribute_row.attnum > 0
         and not attribute_row.attisdropped
         and attribute_row.attgenerated = 's'
         and pg_catalog.format_type(attribute_row.atttypid, attribute_row.atttypmod) = 'text'
         and pg_catalog.pg_get_expr(default_row.adbin, default_row.adrelid) = 'storage_path'
     ) then
    raise exception 'Attachment rollout compatibility alias is absent or can diverge from storage_path';
  end if;
end;
$postflight$;

notify pgrst, 'reload schema';
