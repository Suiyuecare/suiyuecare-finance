create table if not exists public.notification_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id),
  event_type text not null,
  source_module text not null,
  source_id text,
  title text not null,
  content text not null,
  channels jsonb not null default '["站內通知"]'::jsonb,
  actor_user_id uuid references public.users(id),
  recipient_strategy text not null default 'explicit'
    check (recipient_strategy in ('explicit','role','applicant','self','broadcast')),
  recipient_user_ids uuid[] not null default '{}'::uuid[],
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'processed'
    check (status in ('queued','processed','failed','cancelled')),
  processed_at timestamptz,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table public.notifications
  add column if not exists event_id uuid references public.notification_events(id) on delete set null,
  add column if not exists read_at timestamptz;

create index if not exists idx_notification_events_company_created
on public.notification_events(company_id, created_at desc)
where deleted_at is null;

create index if not exists idx_notification_events_type_status
on public.notification_events(event_type, status, created_at desc)
where deleted_at is null;

create index if not exists idx_notifications_event_id
on public.notifications(event_id)
where deleted_at is null;

drop trigger if exists trg_notification_events_updated_at on public.notification_events;
create trigger trg_notification_events_updated_at before update on public.notification_events
for each row execute function public.set_updated_at();

alter table public.notification_events enable row level security;

drop policy if exists "notification managers can view company events" on public.notification_events;
create policy "notification managers can view company events"
on public.notification_events for select
to authenticated
using (
  deleted_at is null
  and (
    private.is_hr_admin()
    or company_id in (
      select users.company_id
      from public.users
      where users.auth_user_id = auth.uid()
        and users.deleted_at is null
    )
  )
);

drop policy if exists "authenticated users can emit own company notification events" on public.notification_events;
create policy "authenticated users can emit own company notification events"
on public.notification_events for insert
to authenticated
with check (
  company_id in (
    select users.company_id
    from public.users
    where users.auth_user_id = auth.uid()
      and users.deleted_at is null
  )
);

drop policy if exists "notification managers can update company events" on public.notification_events;
create policy "notification managers can update company events"
on public.notification_events for update
to authenticated
using (
  private.is_hr_admin()
  and company_id in (
    select users.company_id
    from public.users
    where users.auth_user_id = auth.uid()
      and users.deleted_at is null
  )
)
with check (
  private.is_hr_admin()
  and company_id in (
    select users.company_id
    from public.users
    where users.auth_user_id = auth.uid()
      and users.deleted_at is null
  )
);
