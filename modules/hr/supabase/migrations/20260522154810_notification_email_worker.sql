-- Server-side Email delivery queue for notification worker.

create table if not exists public.notification_email_deliveries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  notification_id uuid not null references public.notifications(id) on delete cascade,
  event_id uuid references public.notification_events(id) on delete set null,
  recipient_user_id uuid references public.users(id) on delete set null,
  recipient_email text,
  subject text not null,
  provider text not null default 'resend',
  provider_message_id text,
  status text not null default 'queued'
    check (status in ('queued','sending','sent','failed','skipped','config_missing')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  last_attempt_at timestamptz,
  sent_at timestamptz,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique(notification_id)
);

drop trigger if exists trg_notification_email_deliveries_updated_at on public.notification_email_deliveries;
create trigger trg_notification_email_deliveries_updated_at before update on public.notification_email_deliveries
for each row execute function public.set_updated_at();

create index if not exists idx_notification_email_deliveries_queue
on public.notification_email_deliveries(status, next_attempt_at, created_at)
where deleted_at is null;

create index if not exists idx_notification_email_deliveries_company_created
on public.notification_email_deliveries(company_id, created_at desc)
where deleted_at is null;

alter table public.notifications
  add column if not exists email_last_attempt_at timestamptz,
  add column if not exists email_sent_at timestamptz,
  add column if not exists email_provider_message_id text,
  add column if not exists email_error_message text;

alter table public.notification_email_deliveries enable row level security;

drop policy if exists "notification email managers view company deliveries" on public.notification_email_deliveries;
create policy "notification email managers view company deliveries"
on public.notification_email_deliveries for select
to authenticated
using (
  deleted_at is null
  and private.is_hr_admin()
  and company_id = private.current_company_id()
);

drop policy if exists "notification email managers manage company deliveries" on public.notification_email_deliveries;
create policy "notification email managers manage company deliveries"
on public.notification_email_deliveries for all
to authenticated
using (
  private.is_hr_admin()
  and company_id = private.current_company_id()
)
with check (
  private.is_hr_admin()
  and company_id = private.current_company_id()
);

create or replace function private.enqueue_notification_email_delivery()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  recipient_email text;
begin
  if new.deleted_at is null
    and new.channels ? 'Email'
    and coalesce(new.metadata->>'email_status', 'queued') in ('queued','failed','config_missing')
  then
    select users.email
      into recipient_email
    from public.users
    where users.id = new.recipient_user_id
      and users.deleted_at is null;

    insert into public.notification_email_deliveries (
      company_id,
      notification_id,
      event_id,
      recipient_user_id,
      recipient_email,
      subject,
      status,
      metadata
    )
    values (
      new.company_id,
      new.id,
      new.event_id,
      new.recipient_user_id,
      recipient_email,
      new.title,
      'queued',
      jsonb_build_object('triggered_from_notification', true)
    )
    on conflict (notification_id) do update
      set status = case
            when public.notification_email_deliveries.status = 'sent' then public.notification_email_deliveries.status
            else 'queued'
          end,
          subject = excluded.subject,
          recipient_email = coalesce(excluded.recipient_email, public.notification_email_deliveries.recipient_email),
          next_attempt_at = now(),
          updated_at = now();
  end if;

  return new;
end;
$$;

drop trigger if exists trg_notifications_enqueue_email_delivery on public.notifications;
create trigger trg_notifications_enqueue_email_delivery
after insert or update of channels, metadata, title, recipient_user_id, deleted_at
on public.notifications
for each row execute function private.enqueue_notification_email_delivery();

insert into public.notification_email_deliveries (
  company_id,
  notification_id,
  event_id,
  recipient_user_id,
  recipient_email,
  subject,
  status,
  metadata
)
select
  notifications.company_id,
  notifications.id,
  notifications.event_id,
  notifications.recipient_user_id,
  users.email,
  notifications.title,
  'queued',
  jsonb_build_object('seeded_from_existing_notification', true)
from public.notifications
left join public.users on users.id = notifications.recipient_user_id
where notifications.deleted_at is null
  and notifications.channels ? 'Email'
  and coalesce(notifications.metadata->>'email_status', 'not_required') in ('queued','failed','config_missing')
on conflict (notification_id) do nothing;

with email_worker_settings as (
  select jsonb_build_object(
    'provider', 'resend',
    'from_env', 'EMAIL_FROM',
    'reply_to_env', 'EMAIL_REPLY_TO',
    'api_key_env', 'RESEND_API_KEY',
    'worker_secret_env', 'CRON_SECRET',
    'route', '/api/notifications/email-worker',
    'schedule', '*/5 * * * *',
    'max_attempts', 5,
    'batch_size', 25,
    'retry_backoff_minutes', '[5,15,60,240,720]'::jsonb,
    'status', 'active'
  ) as settings
)
insert into public.system_settings (
  company_id,
  setting_key,
  category,
  display_name,
  description,
  settings,
  status,
  effective_from
)
select
  companies.id,
  'notification_email_worker',
  'notification_settings',
  'Email 通知 Worker',
  'Server-side Resend worker for queued notification Email delivery.',
  email_worker_settings.settings,
  'active',
  current_date
from public.companies
cross join email_worker_settings
where companies.deleted_at is null
  and not exists (
    select 1
    from public.system_settings existing
    where existing.company_id = companies.id
      and existing.setting_key = 'notification_email_worker'
      and existing.deleted_at is null
  );
