create table if not exists public.policy_documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  document_id uuid references public.documents(id) on delete set null,
  policy_key text not null,
  title text not null,
  category text not null
    check (category in ('work_rules','hr_policy','sexual_harassment','labor_contract_template','payroll_policy','attendance_policy','other')),
  version text not null,
  effective_from date not null default current_date,
  expires_at date,
  target_scope jsonb not null default '{}'::jsonb,
  requires_acknowledgement boolean not null default true,
  owner_department text,
  status text not null default 'draft'
    check (status in ('draft','active','expired','revoked')),
  note text,
  created_by uuid references public.users(id),
  updated_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique(company_id, policy_key, version)
);

create index if not exists idx_policy_documents_company_status
on public.policy_documents(company_id, status, category, effective_from desc)
where deleted_at is null;

create index if not exists idx_policy_documents_document
on public.policy_documents(document_id)
where deleted_at is null;

drop trigger if exists trg_policy_documents_updated_at on public.policy_documents;
create trigger trg_policy_documents_updated_at before update on public.policy_documents
for each row execute function public.set_updated_at();

alter table public.policy_documents enable row level security;

drop policy if exists "company users can view active policy documents" on public.policy_documents;
create policy "company users can view active policy documents"
on public.policy_documents for select
to authenticated
using (
  company_id = (
    select users.company_id
    from public.users
    where users.auth_user_id = auth.uid()
      and users.deleted_at is null
      and users.status = 'active'
    limit 1
  )
  and (
    status = 'active'
    or public.can_manage_announcements()
    or public.can_manage_system_settings()
    or public.can_manage_employee_data()
  )
);

drop policy if exists "policy managers can manage company policy documents" on public.policy_documents;
create policy "policy managers can manage company policy documents"
on public.policy_documents for all
to authenticated
using (
  (public.can_manage_announcements() or public.can_manage_system_settings() or public.can_manage_employee_data())
  and company_id = (
    select users.company_id
    from public.users
    where users.auth_user_id = auth.uid()
      and users.deleted_at is null
      and users.status = 'active'
    limit 1
  )
)
with check (
  (public.can_manage_announcements() or public.can_manage_system_settings() or public.can_manage_employee_data())
  and company_id = (
    select users.company_id
    from public.users
    where users.auth_user_id = auth.uid()
      and users.deleted_at is null
      and users.status = 'active'
    limit 1
  )
);
