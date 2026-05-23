create table if not exists public.hr_requests (
  id text primary key,
  no text not null,
  request_type text not null,
  applicant_id uuid not null references public.users(id) on delete cascade,
  entity_id text not null default 'hr',
  department_code text,
  status text not null default '草稿'
    check (status in ('草稿','待我簽核','簽核中','已核准','已駁回','已取消','被退回')),
  current_step text not null default '草稿',
  current_owner_role text not null default 'applicant',
  reason text,
  payload jsonb not null default '{}'::jsonb,
  files text[] not null default '{}'::text[],
  timeline jsonb not null default '[]'::jsonb,
  audit_logs text[] not null default '{}'::text[],
  submitted_at timestamptz,
  approved_at timestamptz,
  rejected_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_hr_requests_applicant_status on public.hr_requests(applicant_id, status, created_at desc);
create index if not exists idx_hr_requests_owner_status on public.hr_requests(current_owner_role, status, created_at desc);
create index if not exists idx_hr_requests_type_status on public.hr_requests(request_type, status);

drop trigger if exists trg_hr_requests_updated_at on public.hr_requests;
create trigger trg_hr_requests_updated_at before update on public.hr_requests
for each row execute function public.set_updated_at();

alter table public.hr_requests enable row level security;

drop policy if exists "employees can manage own hr requests" on public.hr_requests;
create policy "employees can manage own hr requests"
on public.hr_requests for all
to authenticated
using (
  auth.uid() is not null
  and deleted_at is null
  and applicant_id = (
    select users.id
    from public.users
    where users.auth_user_id = auth.uid()
      and users.deleted_at is null
    limit 1
  )
)
with check (
  auth.uid() is not null
  and applicant_id = (
    select users.id
    from public.users
    where users.auth_user_id = auth.uid()
      and users.deleted_at is null
    limit 1
  )
);

drop policy if exists "request approvers can manage company hr requests" on public.hr_requests;
create policy "request approvers can manage company hr requests"
on public.hr_requests for all
to authenticated
using (
  public.current_role_key() in ('super_admin','company_admin','hr_manager','hr_staff','department_manager','homecare_supervisor','admin_director','ceo','hr','supervisor')
  and exists (
    select 1
    from public.users applicant
    join public.users actor on actor.auth_user_id = auth.uid()
    where applicant.id = hr_requests.applicant_id
      and applicant.company_id = actor.company_id
      and applicant.deleted_at is null
      and actor.deleted_at is null
  )
)
with check (
  public.current_role_key() in ('super_admin','company_admin','hr_manager','hr_staff','department_manager','homecare_supervisor','admin_director','ceo','hr','supervisor')
  and exists (
    select 1
    from public.users applicant
    join public.users actor on actor.auth_user_id = auth.uid()
    where applicant.id = hr_requests.applicant_id
      and applicant.company_id = actor.company_id
      and applicant.deleted_at is null
      and actor.deleted_at is null
  )
);
