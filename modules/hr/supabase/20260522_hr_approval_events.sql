create table if not exists public.hr_approval_events (
  id uuid primary key default gen_random_uuid(),
  request_id text not null references public.hr_requests(id) on delete cascade,
  actor_user_id uuid not null references public.users(id),
  actor_role text not null,
  actor_name text not null,
  action text not null
    check (action in ('submit','approve','return','reject','cancel','resubmit','delegate','comment')),
  step_name text not null,
  decision_reason text not null,
  decision_snapshot jsonb not null default '{}'::jsonb,
  before_status text,
  after_status text,
  before_owner_role text,
  after_owner_role text,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_hr_approval_events_request_created on public.hr_approval_events(request_id, created_at);
create index if not exists idx_hr_approval_events_actor_created on public.hr_approval_events(actor_user_id, created_at desc);
create index if not exists idx_hr_approval_events_action on public.hr_approval_events(action, created_at desc);

alter table public.hr_approval_events enable row level security;

drop policy if exists "employees can view own request approval events" on public.hr_approval_events;
create policy "employees can view own request approval events"
on public.hr_approval_events for select
to authenticated
using (
  exists (
    select 1
    from public.hr_requests
    join public.users applicant on applicant.id = hr_requests.applicant_id
    where hr_requests.id = hr_approval_events.request_id
      and hr_requests.deleted_at is null
      and applicant.auth_user_id = auth.uid()
      and applicant.deleted_at is null
  )
);

drop policy if exists "request approvers can manage company approval events" on public.hr_approval_events;
create policy "request approvers can manage company approval events"
on public.hr_approval_events for all
to authenticated
using (
  public.current_role_key() in ('super_admin','company_admin','hr_manager','hr_staff','department_manager','homecare_supervisor','admin_director','ceo','hr','supervisor')
  and exists (
    select 1
    from public.hr_requests
    join public.users applicant on applicant.id = hr_requests.applicant_id
    join public.users actor on actor.auth_user_id = auth.uid()
    where hr_requests.id = hr_approval_events.request_id
      and applicant.company_id = actor.company_id
      and applicant.deleted_at is null
      and actor.deleted_at is null
  )
)
with check (
  public.current_role_key() in ('super_admin','company_admin','hr_manager','hr_staff','department_manager','homecare_supervisor','admin_director','ceo','hr','supervisor')
  and actor_user_id = (
    select users.id
    from public.users
    where users.auth_user_id = auth.uid()
      and users.deleted_at is null
    limit 1
  )
  and exists (
    select 1
    from public.hr_requests
    join public.users applicant on applicant.id = hr_requests.applicant_id
    join public.users actor on actor.auth_user_id = auth.uid()
    where hr_requests.id = hr_approval_events.request_id
      and applicant.company_id = actor.company_id
      and applicant.deleted_at is null
      and actor.deleted_at is null
  )
);
