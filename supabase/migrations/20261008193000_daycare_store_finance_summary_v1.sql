-- Draft PR only: read-only Finance -> daycare direct-department summary boundary.
-- Not applied to any live database. No seed bindings or ledger writes.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $preflight$
begin
  if to_regclass('public.ledger_entries') is null or to_regclass('public.tenants') is null
     or to_regclass('public.finance_department_units') is null
     or to_regclass('public.finance_department_entity_scopes') is null
     or not exists (select 1 from pg_namespace where nspname = 'private') then
    raise exception 'Canonical Finance schema is required' using errcode = '55000';
  end if;
  if to_regclass('private.finance_daycare_summary_bindings_v1') is not null
     or to_regprocedure('public.finance_daycare_store_summary_v1(uuid,uuid,uuid,text)') is not null then
    raise exception 'Daycare summary boundary already exists; review migration lineage' using errcode = '55000';
  end if;
end;
$preflight$;

create table private.finance_daycare_summary_bindings_v1 (
  id uuid primary key,
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  organization_id uuid not null,
  branch_id uuid not null,
  entity_id text not null check (entity_id ~ '^[A-Za-z0-9_-]{1,80}$'),
  entity_name text not null check (length(btrim(entity_name)) between 1 and 200),
  department_code text not null check (department_code ~ '^[A-Z][0-9]{4}$'),
  scope_basis text not null check (scope_basis = 'department_direct_only'),
  verification_reference text not null check (length(btrim(verification_reference)) between 1 and 200),
  verified_by uuid not null,
  verified_at timestamptz not null,
  valid_until timestamptz not null,
  earliest_month date not null check (extract(day from earliest_month) = 1 and earliest_month >= date '2000-01-01'),
  active boolean not null default false,
  check (valid_until > verified_at and valid_until <= verified_at + interval '180 days'),
  unique (organization_id, branch_id)
);
alter table private.finance_daycare_summary_bindings_v1 enable row level security;
alter table private.finance_daycare_summary_bindings_v1 force row level security;
revoke all on table private.finance_daycare_summary_bindings_v1 from public, anon, authenticated, service_role;
grant usage on schema private to service_role;
grant select on private.finance_daycare_summary_bindings_v1 to service_role;
create policy finance_daycare_summary_binding_service_read
  on private.finance_daycare_summary_bindings_v1 for select to service_role using (true);

-- No new ledger grants or index. Existing scope/date index can support this
-- read; representative-volume plans must be checked before lineage adoption.

create function public.finance_daycare_store_summary_v1(
  p_binding_id uuid, p_organization_id uuid, p_branch_id uuid, p_month text
)
returns jsonb
language plpgsql stable security invoker
set search_path = ''
as $function$
declare
  v_binding private.finance_daycare_summary_bindings_v1%rowtype;
  v_start date;
  v_income numeric;
  v_expenses numeric;
  v_count bigint;
  v_ambiguous bigint;
  v_incomplete bigint;
begin
  if current_user <> 'service_role' then
    raise exception 'summary_access_denied' using errcode = '42501';
  end if;
  if p_binding_id is null or p_organization_id is null or p_branch_id is null
     or p_month is null or p_month !~ '^(20[0-9]{2}|21[0-9]{2}|2200)-(0[1-9]|1[0-2])$' then
    raise exception 'summary_invalid_request' using errcode = '22023';
  end if;
  v_start := (p_month || '-01')::date;
  select binding.* into v_binding
  from private.finance_daycare_summary_bindings_v1 binding
  where binding.id = p_binding_id
    and binding.organization_id = p_organization_id and binding.branch_id = p_branch_id
    and binding.active and binding.verified_at <= statement_timestamp()
    and binding.valid_until > statement_timestamp()
    and v_start >= binding.earliest_month
    and exists (
      select 1 from public.finance_department_units unit
      join public.finance_department_entity_scopes scope
        on scope.tenant_id = unit.tenant_id and scope.unit_id = unit.id
      where unit.tenant_id = binding.tenant_id
        and unit.code = binding.department_code
        and unit.primary_entity_code = binding.entity_id
        and unit.active and unit.is_posting_unit and unit.present_in_source
        and scope.entity_code = binding.entity_id
        and scope.active and scope.present_in_source
    );
  if not found then
    return jsonb_build_object('status', 'unavailable', 'error_code', 'FINANCE_SCOPE_NOT_VERIFIED');
  end if;

  -- STABLE uses one statement snapshot for binding, master, ambiguity and totals.
  -- Rows with this department but another/missing entity make the direct scope
  -- ambiguous. Other departments and unallocated common costs are excluded.
  select count(*) filter (where entry.entity_id is distinct from v_binding.entity_id),
         count(*) filter (where entry.entity_id = v_binding.entity_id
           and (nullif(btrim(entry.account_code), '') is null
             or entry.debit is null or entry.credit is null))
  into v_ambiguous, v_incomplete
  from public.ledger_entries entry
  where entry.tenant_id = v_binding.tenant_id and entry.data_environment = 'production'
    and entry.department_code = v_binding.department_code
    and entry.voided_at is null
    and coalesce(entry.source_type, '') not in ('period_close', 'closing_entry', 'year_end_close')
    and entry.entry_date >= v_start and entry.entry_date < v_start + interval '1 month';
  if v_ambiguous <> 0 or v_incomplete <> 0 then
    return jsonb_build_object('status', 'unavailable', 'error_code', 'FINANCE_SCOPE_INCOMPLETE');
  end if;
  with scoped as materialized (
    select btrim(entry.account_code) as account_code, entry.debit, entry.credit
    from public.ledger_entries entry
    where entry.tenant_id = v_binding.tenant_id and entry.data_environment = 'production'
      and entry.entity_id = v_binding.entity_id
      and entry.department_code = v_binding.department_code
      and entry.voided_at is null
      and coalesce(entry.source_type, '') not in ('period_close', 'closing_entry', 'year_end_close')
      and entry.entry_date >= v_start and entry.entry_date < v_start + interval '1 month'
  ), grouped as (
    select account_code, sum(credit - debit) as credit_net
    from scoped group by account_code
  )
  select
    coalesce(sum(case when left(account_code, 1) in ('4','7') and abs(credit_net) >= 0.005 then credit_net else 0 end), 0),
    coalesce(sum(case when left(account_code, 1) in ('5','6','9') and abs(credit_net) >= 0.005 then -credit_net else 0 end), 0),
    (select count(*) from scoped)
  into v_income, v_expenses, v_count
  from grouped;

  -- Same ledger account classes as Finance P&L, but direct-department and
  -- non-void only. Do not infer approval/payment status or sum invoices.
  -- The Finance statement engine's groupRows excludes account groups with
  -- absolute net < 0.005. Apply its threshold to groups, never individual lines.
  -- Finance's statement engine also removes voided and closing entries and
  -- trims account codes. This store contract differs by exact department scope.
  if v_count > 1000000 or abs(v_income) >= 1000000000000000 or abs(v_expenses) >= 1000000000000000 then
    return jsonb_build_object('status', 'unavailable', 'error_code', 'FINANCE_SUMMARY_LIMIT_EXCEEDED');
  end if;
  return jsonb_build_object(
    'status', 'ready', 'organization_id', v_binding.organization_id,
    'branch_id', v_binding.branch_id, 'month', p_month,
    'binding_id', v_binding.id, 'entity_id', v_binding.entity_id,
    'department_code', v_binding.department_code,
    'scope_basis', v_binding.scope_basis, 'entity_name', v_binding.entity_name,
    'currency', 'TWD', 'basis', 'finance_pnl_ledger',
    'income', (v_income::numeric(18,2))::text,
    'expenses', (v_expenses::numeric(18,2))::text,
    'entry_count', v_count, 'generated_at', statement_timestamp()
  );
end;
$function$;
revoke all on function public.finance_daycare_store_summary_v1(uuid,uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.finance_daycare_store_summary_v1(uuid,uuid,uuid,text) to service_role;
comment on function public.finance_daycare_store_summary_v1(uuid,uuid,uuid,text) is
  'Service-only, single-statement-snapshot, verified direct-department monthly ledger summary; no end-user or browser access and no accounting writes.';

do $postflight$
begin
  if has_function_privilege('anon', 'public.finance_daycare_store_summary_v1(uuid,uuid,uuid,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.finance_daycare_store_summary_v1(uuid,uuid,uuid,text)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.finance_daycare_store_summary_v1(uuid,uuid,uuid,text)', 'EXECUTE')
     or has_table_privilege('service_role', 'private.finance_daycare_summary_bindings_v1', 'INSERT,UPDATE,DELETE')
     or exists (select 1 from private.finance_daycare_summary_bindings_v1) then
    raise exception 'Daycare summary isolation postflight failed' using errcode = '55000';
  end if;
end;
$postflight$;
notify pgrst, 'reload schema';
