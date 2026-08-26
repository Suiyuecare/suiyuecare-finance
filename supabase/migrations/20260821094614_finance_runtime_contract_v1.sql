-- Finance runtime contract v1 (candidate only, NON-RERUNNABLE).
--
-- This endpoint is deliberately read-only and fail-closed.  It gives an
-- authenticated client one authoritative answer about the server API/schema
-- contract before the client enables any write UI.  This first revision is
-- shipped in a blocked state: a later reviewed migration must name the first
-- accepted frontend build and explicitly activate writes.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $preflight$
declare
  v_missing_auth_procedures text[];
begin
  -- Only the Supabase Auth primitives are compile/runtime prerequisites for
  -- the contract itself. Application capabilities are detected dynamically
  -- below, so this migration remains safe even when sorted before a later
  -- application migration: missing capabilities keep writes blocked.
  select pg_catalog.array_agg(required_procedure.signature order by required_procedure.signature)
    into v_missing_auth_procedures
  from (
    values
      ('auth.uid()'),
      ('auth.jwt()')
  ) as required_procedure(signature)
  where pg_catalog.to_regprocedure(required_procedure.signature) is null;

  if v_missing_auth_procedures is not null then
    raise exception 'Finance runtime contract Auth prerequisites are missing'
      using errcode = '55000',
            detail = 'Missing procedures: ' || pg_catalog.array_to_string(v_missing_auth_procedures, ', '),
            hint = 'This project is not a compatible Supabase Auth database; do not publish the contract.';
  end if;

  -- This is a new public API and is intentionally non-rerunnable. Reject every
  -- existing same-name function, including the zero-argument signature,
  -- instead of silently replacing an unknown live definition.
  if exists (
    select 1
    from pg_catalog.pg_proc procedure_row
    join pg_catalog.pg_namespace namespace_row
      on namespace_row.oid = procedure_row.pronamespace
    where namespace_row.nspname = 'public'
      and procedure_row.proname = 'finance_runtime_contract'
  ) then
    raise exception 'public.finance_runtime_contract already exists; refusing a non-rerunnable install'
      using errcode = '55000',
            hint = 'Inspect the live definition and reconcile it in a separately reviewed migration.';
  end if;
end;
$preflight$;

create function public.finance_runtime_contract()
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_db_role text := current_user;
  v_auth_user_id uuid := auth.uid();
  v_is_anonymous boolean := coalesce(auth.jwt() ->> 'is_anonymous', 'false') = 'true';
  v_member_admin_ready boolean;
  v_org_runtime_ready boolean;
  v_expense_submit_ready boolean;
  v_expense_resubmit_ready boolean;
  v_approval_history_ready boolean;
  v_all_required_present boolean;
  v_missing_required_capabilities jsonb := '[]'::jsonb;
begin
  if v_db_role not in ('authenticated', 'service_role') then
    raise exception 'Authentication is required for the Finance runtime contract'
      using errcode = '42501';
  end if;

  -- Anonymous Supabase users also assume the authenticated database role.
  -- They are intentionally excluded from this internal Finance endpoint.
  if v_db_role = 'authenticated'
     and (v_auth_user_id is null or v_is_anonymous) then
    raise exception 'A permanent authenticated user is required for the Finance runtime contract'
      using errcode = '42501';
  end if;

  v_member_admin_ready :=
    pg_catalog.to_regprocedure('public.finance_admin_upsert_member_atomic_v1(jsonb,bigint)') is not null;

  v_org_runtime_ready :=
    exists (
      select 1
      from pg_catalog.pg_class relation_row
      join pg_catalog.pg_namespace namespace_row
        on namespace_row.oid = relation_row.relnamespace
      where namespace_row.nspname = 'private'
        and relation_row.relname = 'finance_membership_org_versions_v1'
        and relation_row.relkind in ('r', 'p')
    )
    and pg_catalog.to_regprocedure('public.membership_org_get_published_graph()') is not null
    and pg_catalog.to_regprocedure('public.membership_org_validate_draft(uuid)') is not null
    and pg_catalog.to_regprocedure('public.membership_org_publish_draft(uuid,timestamp with time zone)') is not null;

  v_expense_submit_ready :=
    pg_catalog.to_regprocedure('public.finance_submit_expense_request(jsonb,uuid,text,jsonb)') is not null;

  v_expense_resubmit_ready :=
    pg_catalog.to_regprocedure('public.finance_resubmit_expense_request(text,jsonb,uuid,text,jsonb)') is not null;

  v_approval_history_ready :=
    pg_catalog.to_regprocedure(
      'public.finance_approval_participant_history_for_current_user(integer,integer,text,text)'
    ) is not null;

  v_all_required_present :=
    v_member_admin_ready
    and v_org_runtime_ready
    and v_expense_submit_ready
    and v_expense_resubmit_ready
    and v_approval_history_ready;

  select coalesce(
           pg_catalog.jsonb_agg(capability_row.name order by capability_row.ordinal),
           '[]'::jsonb
         )
    into v_missing_required_capabilities
  from (
    values
      (1, 'member_admin_atomic_v1', v_member_admin_ready),
      (2, 'organization_versions_v1', v_org_runtime_ready),
      (3, 'expense_submit_org_guard_v1', v_expense_submit_ready),
      (4, 'expense_resubmit_org_guard_v1', v_expense_resubmit_ready),
      (5, 'approval_participant_history_v1', v_approval_history_ready)
  ) as capability_row(ordinal, name, available)
  where capability_row.available is not true;

  return pg_catalog.jsonb_build_object(
    'contract_name', 'finance_runtime_contract',
    'contract_version', 1,
    'generated_at', pg_catalog.statement_timestamp(),
    'api_contract', pg_catalog.jsonb_build_object(
      'name', 'finance-api',
      'version', '2026-08-21.1',
      'rpc', 'finance_runtime_contract',
      'rpc_arguments', pg_catalog.jsonb_build_array(),
      'overloads_supported', false
    ),
    'schema_contract', pg_catalog.jsonb_build_object(
      'name', 'finance-schema',
      'version', '2026-08-21.1',
      'migration', '20260821094614_finance_runtime_contract_v1',
      'verification_scope', 'required_relations_and_rpc_signatures'
    ),
    'deployment_manifest', pg_catalog.jsonb_build_object(
      'manifest_version', 1,
      'contract_migration', '20260821094614',
      'required_migration_head', null,
      'candidate_local_prerequisite_floor', '20260821170000',
      'observed_migration_head', null,
      'migration_history_verified', false,
      'source', 'embedded_candidate_manifest',
      'update_policy', 'new_migration_only'
    ),
    'release', pg_catalog.jsonb_build_object(
      'phase', 'candidate_blocked',
      'server_contract_build', '20260821094614',
      'writes_enabled', false,
      'block_reason', 'minimum_client_build_not_activated'
    ),
    'client_compatibility', pg_catalog.jsonb_build_object(
      'minimum_protocol', 1,
      'maximum_protocol', 1,
      'minimum_client_build', null,
      'build_gate_configured', false,
      'server_accepts_writes', false,
      'on_mismatch', 'read_only_no_fallback'
    ),
    'required_capabilities', pg_catalog.jsonb_build_array(
      'member_admin_atomic_v1',
      'organization_versions_v1',
      'expense_submit_org_guard_v1',
      'expense_resubmit_org_guard_v1',
      'approval_participant_history_v1'
    ),
    'capability_policy', pg_catalog.jsonb_build_object(
      'required_core', 'all_must_be_verified_before_activation',
      'optional_or_dormant', 'disabled_unless_declared_available',
      'unknown_capability', 'deny',
      'fallback_to_legacy_rpc', false
    ),
    'capability_verification', 'signature_presence_only',
    'required_capabilities_present', v_all_required_present,
    'server_capabilities_ready', false,
    'missing_required_capabilities', v_missing_required_capabilities,
    'capabilities', pg_catalog.jsonb_build_object(
      'member_admin_atomic_v1', pg_catalog.jsonb_build_object(
        'present', v_member_admin_ready,
        'available', false,
        'rpc', 'finance_admin_upsert_member_atomic_v1'
      ),
      'organization_versions_v1', pg_catalog.jsonb_build_object(
        'present', v_org_runtime_ready,
        'available', false,
        'read_rpc', 'membership_org_get_published_graph',
        'validate_rpc', 'membership_org_validate_draft',
        'publish_rpc', 'membership_org_publish_draft'
      ),
      'expense_submit_org_guard_v1', pg_catalog.jsonb_build_object(
        'present', v_expense_submit_ready,
        'available', false,
        'rpc', 'finance_submit_expense_request'
      ),
      'expense_resubmit_org_guard_v1', pg_catalog.jsonb_build_object(
        'present', v_expense_resubmit_ready,
        'available', false,
        'rpc', 'finance_resubmit_expense_request'
      ),
      'approval_participant_history_v1', pg_catalog.jsonb_build_object(
        'present', v_approval_history_ready,
        'available', false,
        'rpc', 'finance_approval_participant_history_for_current_user'
      ),
      'bulk_jobs_v1', pg_catalog.jsonb_build_object(
        'available', false,
        'policy', 'unsupported_no_client_side_fallback'
      ),
      'workflow_command_ledger_v1', pg_catalog.jsonb_build_object(
        'available', false,
        'policy', 'not_yet_installed'
      ),
      'workflow_admin_v1', pg_catalog.jsonb_build_object(
        'available', false,
        'policy', 'disabled_until_manifested'
      ),
      'membership_change_sets_v1', pg_catalog.jsonb_build_object(
        'available', false,
        'policy', 'disabled_until_manifested'
      ),
      'membership_permission_catalog_v1', pg_catalog.jsonb_build_object(
        'available', false,
        'policy', 'disabled_until_manifested'
      ),
      'membership_org_bulk_v1', pg_catalog.jsonb_build_object(
        'available', false,
        'policy', 'disabled_until_manifested'
      )
    ),
    'limits', pg_catalog.jsonb_build_object(
      'approval_history_page', pg_catalog.jsonb_build_object(
        'default', 50,
        'maximum', 50
      ),
      'organization_version_page', pg_catalog.jsonb_build_object(
        'default', 40,
        'maximum', 100
      ),
      'expense_actor_requests', pg_catalog.jsonb_build_object(
        'maximum', 50
      ),
      'organization_snapshot_schema_version', 2,
      'bulk_submit', pg_catalog.jsonb_build_object(
        'supported', false,
        'maximum_items', null,
        'policy', 'do_not_split_or_fallback'
      )
    ),
    'caller', pg_catalog.jsonb_build_object(
      'kind', case when v_db_role = 'service_role' then 'service_role' else 'authenticated_user' end,
      'permanent_user', case when v_db_role = 'service_role' then null else true end
    )
  );
end;
$function$;

alter function public.finance_runtime_contract() owner to postgres;

revoke all on function public.finance_runtime_contract()
  from public, anon, authenticated, service_role;
grant execute on function public.finance_runtime_contract()
  to authenticated, service_role;

comment on function public.finance_runtime_contract() is
  'Read-only authenticated Finance API/schema/build compatibility contract. Candidate v1 is intentionally write-blocked.';

do $postflight_catalog$
declare
  v_count integer;
  v_procedure pg_catalog.pg_proc%rowtype;
  v_postgres_oid oid := (select role_row.oid from pg_catalog.pg_roles role_row where role_row.rolname = 'postgres');
  v_authenticated_oid oid := (select role_row.oid from pg_catalog.pg_roles role_row where role_row.rolname = 'authenticated');
  v_service_role_oid oid := (select role_row.oid from pg_catalog.pg_roles role_row where role_row.rolname = 'service_role');
  v_acl_count integer;
  v_acl_exact boolean;
  v_acl_postgres integer;
  v_acl_authenticated integer;
  v_acl_service_role integer;
begin
  select pg_catalog.count(*)::integer
    into v_count
  from pg_catalog.pg_proc procedure_row
  join pg_catalog.pg_namespace namespace_row
    on namespace_row.oid = procedure_row.pronamespace
  where namespace_row.nspname = 'public'
    and procedure_row.proname = 'finance_runtime_contract';

  if v_count <> 1 then
    raise exception 'Finance runtime contract postflight failed: expected exactly one non-overloaded function';
  end if;

  select procedure_row.*
    into strict v_procedure
  from pg_catalog.pg_proc procedure_row
  join pg_catalog.pg_namespace namespace_row
    on namespace_row.oid = procedure_row.pronamespace
  where namespace_row.nspname = 'public'
    and procedure_row.proname = 'finance_runtime_contract';

  if v_procedure.proowner <> v_postgres_oid
     or v_procedure.prosecdef is not false
     or v_procedure.provolatile <> 's'
     or v_procedure.prokind <> 'f'
     or v_procedure.pronargs <> 0
     or v_procedure.pronargdefaults <> 0
     or v_procedure.prorettype <> 'pg_catalog.jsonb'::pg_catalog.regtype
     or v_procedure.proconfig is distinct from array['search_path=""']::text[] then
    raise exception 'Finance runtime contract postflight failed: identity, owner, signature, return type, security, or search_path drifted';
  end if;

  select pg_catalog.count(*)::integer,
         coalesce(pg_catalog.bool_and(
           acl_row.privilege_type = 'EXECUTE'
           and acl_row.grantor = v_postgres_oid
           and acl_row.grantee in (v_postgres_oid, v_authenticated_oid, v_service_role_oid)
           and acl_row.is_grantable is false
         ), false),
         pg_catalog.count(*) filter (where acl_row.grantee = v_postgres_oid),
         pg_catalog.count(*) filter (where acl_row.grantee = v_authenticated_oid),
         pg_catalog.count(*) filter (where acl_row.grantee = v_service_role_oid)
    into v_acl_count, v_acl_exact, v_acl_postgres, v_acl_authenticated, v_acl_service_role
  from pg_catalog.aclexplode(
    coalesce(v_procedure.proacl, pg_catalog.acldefault('f', v_procedure.proowner))
  ) acl_row;

  if v_acl_count <> 3
     or v_acl_exact is not true
     or v_acl_postgres <> 1
     or v_acl_authenticated <> 1
     or v_acl_service_role <> 1 then
    raise exception 'Finance runtime contract postflight failed: ACL must be exact and non-grantable for postgres/authenticated/service_role only';
  end if;
end;
$postflight_catalog$;

set local role service_role;

do $postflight_payload$
declare
  v_contract jsonb := public.finance_runtime_contract();
  v_required_top_level_keys text[] := array[
    'contract_name',
    'contract_version',
    'generated_at',
    'api_contract',
    'schema_contract',
    'deployment_manifest',
    'release',
    'client_compatibility',
    'required_capabilities',
    'capability_policy',
    'capability_verification',
    'required_capabilities_present',
    'server_capabilities_ready',
    'missing_required_capabilities',
    'capabilities',
    'limits',
    'caller'
  ];
  v_required_capability_names text[] := array[
    'member_admin_atomic_v1',
    'organization_versions_v1',
    'expense_submit_org_guard_v1',
    'expense_resubmit_org_guard_v1',
    'approval_participant_history_v1'
  ];
  v_all_capability_names text[] := array[
    'member_admin_atomic_v1',
    'organization_versions_v1',
    'expense_submit_org_guard_v1',
    'expense_resubmit_org_guard_v1',
    'approval_participant_history_v1',
    'bulk_jobs_v1',
    'workflow_command_ledger_v1',
    'workflow_admin_v1',
    'membership_change_sets_v1',
    'membership_permission_catalog_v1',
    'membership_org_bulk_v1'
  ];
  v_expected_missing_required jsonb;
begin
  select coalesce(
           pg_catalog.jsonb_agg(required_capability.name order by required_capability.ordinal),
           '[]'::jsonb
         )
    into v_expected_missing_required
  from pg_catalog.unnest(v_required_capability_names) with ordinality
       as required_capability(name, ordinal)
  where v_contract -> 'capabilities' -> required_capability.name -> 'present'
        is distinct from 'true'::jsonb;

  if pg_catalog.jsonb_typeof(v_contract) is distinct from 'object'
     or not (v_contract ?& v_required_top_level_keys)
     or pg_catalog.jsonb_object_length(v_contract)
        is distinct from pg_catalog.cardinality(v_required_top_level_keys)
     or v_contract -> 'contract_name' is distinct from '"finance_runtime_contract"'::jsonb
     or v_contract -> 'contract_version' is distinct from '1'::jsonb
     or pg_catalog.jsonb_typeof(v_contract -> 'generated_at') is distinct from 'string'
     or v_contract -> 'api_contract' is distinct from pg_catalog.jsonb_build_object(
       'name', 'finance-api',
       'version', '2026-08-21.1',
       'rpc', 'finance_runtime_contract',
       'rpc_arguments', pg_catalog.jsonb_build_array(),
       'overloads_supported', false
     )
     or v_contract -> 'schema_contract' is distinct from pg_catalog.jsonb_build_object(
       'name', 'finance-schema',
       'version', '2026-08-21.1',
       'migration', '20260821094614_finance_runtime_contract_v1',
       'verification_scope', 'required_relations_and_rpc_signatures'
     )
     or v_contract -> 'deployment_manifest' is distinct from pg_catalog.jsonb_build_object(
       'manifest_version', 1,
       'contract_migration', '20260821094614',
       'required_migration_head', null,
       'candidate_local_prerequisite_floor', '20260821170000',
       'observed_migration_head', null,
       'migration_history_verified', false,
       'source', 'embedded_candidate_manifest',
       'update_policy', 'new_migration_only'
     )
     or v_contract -> 'release' is distinct from pg_catalog.jsonb_build_object(
       'phase', 'candidate_blocked',
       'server_contract_build', '20260821094614',
       'writes_enabled', false,
       'block_reason', 'minimum_client_build_not_activated'
     )
     or v_contract -> 'client_compatibility' is distinct from pg_catalog.jsonb_build_object(
       'minimum_protocol', 1,
       'maximum_protocol', 1,
       'minimum_client_build', null,
       'build_gate_configured', false,
       'server_accepts_writes', false,
       'on_mismatch', 'read_only_no_fallback'
     )
     or v_contract -> 'required_capabilities'
        is distinct from pg_catalog.to_jsonb(v_required_capability_names)
     or v_contract -> 'capability_policy' is distinct from pg_catalog.jsonb_build_object(
       'required_core', 'all_must_be_verified_before_activation',
       'optional_or_dormant', 'disabled_unless_declared_available',
       'unknown_capability', 'deny',
       'fallback_to_legacy_rpc', false
     )
     or v_contract -> 'capability_verification' is distinct from '"signature_presence_only"'::jsonb
     or v_contract -> 'required_capabilities_present' is distinct from
        case
          when v_expected_missing_required = '[]'::jsonb then 'true'::jsonb
          else 'false'::jsonb
        end
     or v_contract -> 'server_capabilities_ready' is distinct from 'false'::jsonb
     or v_contract -> 'missing_required_capabilities' is distinct from v_expected_missing_required
     or pg_catalog.jsonb_typeof(v_contract -> 'capabilities') is distinct from 'object'
     or not ((v_contract -> 'capabilities') ?& v_all_capability_names)
     or pg_catalog.jsonb_object_length(v_contract -> 'capabilities')
        is distinct from pg_catalog.cardinality(v_all_capability_names)
     or exists (
       select 1
       from pg_catalog.jsonb_each(v_contract -> 'capabilities') capability_row
       where pg_catalog.jsonb_typeof(capability_row.value) is distinct from 'object'
          or capability_row.value -> 'available' is distinct from 'false'::jsonb
     )
     or exists (
       select 1
       from pg_catalog.unnest(v_required_capability_names) required_capability(name)
       where pg_catalog.jsonb_typeof(
         v_contract -> 'capabilities' -> required_capability.name -> 'present'
       ) is distinct from 'boolean'
     ) then
    raise exception 'Finance runtime contract postflight failed: invalid fail-closed payload';
  end if;

  if v_contract #>> '{capabilities,member_admin_atomic_v1,rpc}'
       is distinct from 'finance_admin_upsert_member_atomic_v1'
     or v_contract #>> '{capabilities,organization_versions_v1,read_rpc}'
       is distinct from 'membership_org_get_published_graph'
     or v_contract #>> '{capabilities,organization_versions_v1,validate_rpc}'
       is distinct from 'membership_org_validate_draft'
     or v_contract #>> '{capabilities,organization_versions_v1,publish_rpc}'
       is distinct from 'membership_org_publish_draft'
     or v_contract #>> '{capabilities,expense_submit_org_guard_v1,rpc}'
       is distinct from 'finance_submit_expense_request'
     or v_contract #>> '{capabilities,expense_resubmit_org_guard_v1,rpc}'
       is distinct from 'finance_resubmit_expense_request'
     or v_contract #>> '{capabilities,approval_participant_history_v1,rpc}'
       is distinct from 'finance_approval_participant_history_for_current_user'
     or v_contract #>> '{capabilities,bulk_jobs_v1,policy}'
       is distinct from 'unsupported_no_client_side_fallback'
     or v_contract #>> '{capabilities,workflow_command_ledger_v1,policy}'
       is distinct from 'not_yet_installed'
     or v_contract #>> '{capabilities,workflow_admin_v1,policy}'
       is distinct from 'disabled_until_manifested'
     or v_contract #>> '{capabilities,membership_change_sets_v1,policy}'
       is distinct from 'disabled_until_manifested'
     or v_contract #>> '{capabilities,membership_permission_catalog_v1,policy}'
       is distinct from 'disabled_until_manifested'
     or v_contract #>> '{capabilities,membership_org_bulk_v1,policy}'
       is distinct from 'disabled_until_manifested'
     or v_contract -> 'limits' is distinct from pg_catalog.jsonb_build_object(
       'approval_history_page', pg_catalog.jsonb_build_object('default', 50, 'maximum', 50),
       'organization_version_page', pg_catalog.jsonb_build_object('default', 40, 'maximum', 100),
       'expense_actor_requests', pg_catalog.jsonb_build_object('maximum', 50),
       'organization_snapshot_schema_version', 2,
       'bulk_submit', pg_catalog.jsonb_build_object(
         'supported', false,
         'maximum_items', null,
         'policy', 'do_not_split_or_fallback'
       )
     )
     or v_contract -> 'caller' is distinct from pg_catalog.jsonb_build_object(
       'kind', 'service_role',
       'permanent_user', null
     ) then
    raise exception 'Finance runtime contract postflight failed: nested contract scalar or type drifted';
  end if;
end;
$postflight_payload$;

reset role;

notify pgrst, 'reload schema';

commit;
