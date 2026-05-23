create table if not exists public.policy_acknowledgements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  employee_id uuid references public.employees(id) on delete set null,
  policy_key text not null,
  policy_title text not null,
  policy_version text not null,
  acknowledgement_text text not null,
  acknowledgement_snapshot jsonb not null default '{}'::jsonb,
  acknowledged_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique(policy_key, policy_version, user_id)
);

create index if not exists idx_policy_acknowledgements_company_policy
on public.policy_acknowledgements(company_id, policy_key, policy_version, acknowledged_at desc)
where deleted_at is null;

create index if not exists idx_policy_acknowledgements_employee
on public.policy_acknowledgements(employee_id, policy_key, acknowledged_at desc)
where deleted_at is null;

drop trigger if exists trg_policy_acknowledgements_updated_at on public.policy_acknowledgements;
create trigger trg_policy_acknowledgements_updated_at before update on public.policy_acknowledgements
for each row execute function public.set_updated_at();

alter table public.policy_acknowledgements enable row level security;

drop policy if exists "employees can view own policy acknowledgements" on public.policy_acknowledgements;
create policy "employees can view own policy acknowledgements"
on public.policy_acknowledgements for select
to authenticated
using (
  auth.uid() is not null
  and (
    employee_id = public.current_employee_id()
    or public.can_manage_announcements()
    or public.can_manage_system_settings()
  )
);

drop policy if exists "employees can insert own policy acknowledgements" on public.policy_acknowledgements;
create policy "employees can insert own policy acknowledgements"
on public.policy_acknowledgements for insert
to authenticated
with check (
  auth.uid() is not null
  and employee_id = public.current_employee_id()
);

drop policy if exists "employees can update own policy acknowledgements" on public.policy_acknowledgements;
create policy "employees can update own policy acknowledgements"
on public.policy_acknowledgements for update
to authenticated
using (
  auth.uid() is not null
  and employee_id = public.current_employee_id()
)
with check (
  auth.uid() is not null
  and employee_id = public.current_employee_id()
);
