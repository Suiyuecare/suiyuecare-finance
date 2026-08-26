-- Retire one historical HR projection that duplicated the canonical CEO
-- identity and accidentally stored its employee number in finance_users.entity_id.
-- The canonical person remains active; this row has never been Auth-bound and
-- has no pending approvals, reports or delegations. Updating finance_users
-- intentionally drives the existing Finance -> eDoc revisioned outbox.
begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $repair$
declare
  v_tenant constant uuid := '00000000-0000-0000-0000-000000000001'::uuid;
  v_duplicate constant text := 'hrlog007';
  v_canonical constant text := 'u_entrepreneur';
  v_count integer;
  v_preview jsonb;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'finance-master-data-duplicate-retirement:' || v_tenant::text || ':' || v_duplicate,
      0
    )
  );

  select count(*) into v_count
  from public.finance_users duplicate_row
  join public.finance_users canonical_row
    on canonical_row.tenant_id = duplicate_row.tenant_id
   and canonical_row.id = v_canonical
   and canonical_row.active is true
   and canonical_row.org_status = 'active'
   and canonical_row.role = 'ceo'
   and canonical_row.entity_id = 'E1'
   and lower(pg_catalog.regexp_replace(pg_catalog.btrim(canonical_row.name), '\s+', '', 'g')) =
       lower(pg_catalog.regexp_replace(pg_catalog.btrim(duplicate_row.name), '\s+', '', 'g'))
  where duplicate_row.tenant_id = v_tenant
    and duplicate_row.id = v_duplicate
    and duplicate_row.active is true
    and duplicate_row.org_status = 'active'
    and duplicate_row.auth_user_id is null
    and duplicate_row.google_link_status = 'pending_first_login'
    and duplicate_row.shared_identity_source = 'hr_shared_identity'
    and duplicate_row.shared_identity_employee_no = 'HR-LOG-007'
    and duplicate_row.entity_id = 'HR-LOG-007'
    and duplicate_row.department_code = 'A1000';
  if v_count <> 1 then
    raise exception 'Duplicate identity retirement preflight drifted: expected one exact pair, found %', v_count
      using errcode = '23514';
  end if;

  select count(*) into v_count
  from public.employee_department_roles assignment
  join public.departments department_row
    on department_row.id = assignment.department_id
   and department_row.status = 'active'
  join public.companies company_row
    on company_row.id = department_row.company_id
   and company_row.status = 'active'
   and company_row.deleted_at is null
   and company_row.code = 'E1'
  where assignment.tenant_id = v_tenant
    and assignment.finance_user_id = v_duplicate
    and assignment.active is true
    and assignment.is_primary is true
    and assignment.department_code = 'A1000';
  if v_count <> 1 then
    raise exception 'Duplicate identity canonical department/company preflight drifted: %', v_count
      using errcode = '23514';
  end if;

  select private.finance_user_offboarding_preview_for_tenant(v_tenant, v_duplicate)
    into v_preview;
  if coalesce((v_preview #>> '{counts,steps}')::integer, 0) <> 0
     or coalesce((v_preview #>> '{counts,documents}')::integer, 0) <> 0
     or coalesce((v_preview #>> '{counts,direct_reports}')::integer, 0) <> 0
     or coalesce((v_preview #>> '{counts,delegate_routes}')::integer, 0) <> 0
     or pg_catalog.jsonb_array_length(coalesce(v_preview -> 'blockers', '[]'::jsonb)) <> 0
     or coalesce((v_preview ->> 'requires_successor')::boolean, false) then
    raise exception 'Duplicate identity unexpectedly owns workflow state; retirement aborted'
      using errcode = '23514';
  end if;

  update public.employee_department_roles assignment
  set active = false,
      can_approve = false,
      effective_to = case
        when assignment.effective_to is null or assignment.effective_to > current_date
          then greatest(assignment.effective_from, current_date)
        else assignment.effective_to
      end,
      metadata = coalesce(assignment.metadata, '{}'::jsonb) || pg_catalog.jsonb_build_object(
        'master_data_repair', '20260823204632_retire_hrlog007_duplicate_identity',
        'retirement_reason', 'historical_duplicate_of_canonical_identity',
        'retired_at', pg_catalog.now()
      ),
      updated_at = pg_catalog.now()
  where assignment.tenant_id = v_tenant
    and assignment.finance_user_id = v_duplicate
    and assignment.active is true;

  update public.finance_users finance_user
  set entity_id = 'E1',
      active = false,
      org_status = 'duplicate_retired',
      org_source = 'master_data_governance_repair',
      org_source_updated_at = pg_catalog.now()
  where finance_user.tenant_id = v_tenant
    and finance_user.id = v_duplicate
    and finance_user.active is true;
  if not found then
    raise exception 'Duplicate identity retirement update did not affect the expected row'
      using errcode = '23514';
  end if;

  update public.tenant_members tenant_member
  set entity_id = 'E1',
      active = false,
      updated_at = pg_catalog.now()
  where tenant_member.tenant_id = v_tenant
    and tenant_member.finance_user_id = v_duplicate;

  if exists (
    select 1
    from public.finance_users finance_user
    where finance_user.tenant_id = v_tenant
      and finance_user.id = v_duplicate
      and (
        finance_user.active is true
        or finance_user.org_status <> 'duplicate_retired'
        or finance_user.auth_user_id is not null
      )
  ) or exists (
    select 1
    from public.employee_department_roles assignment
    where assignment.tenant_id = v_tenant
      and assignment.finance_user_id = v_duplicate
      and (assignment.active is true or assignment.can_approve is true)
  ) or exists (
    select 1
    from public.tenant_members tenant_member
    where tenant_member.tenant_id = v_tenant
      and tenant_member.finance_user_id = v_duplicate
      and tenant_member.active is true
  ) then
    raise exception 'Duplicate identity retirement postcondition failed'
      using errcode = '23514';
  end if;
end
$repair$;

commit;
