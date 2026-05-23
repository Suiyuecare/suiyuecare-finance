-- Compatibility patch used when merging Module_HR into the Finance Supabase project.
-- The Finance production database already had several legacy tables with older
-- column shapes. These non-destructive changes let the HR schema and migrations
-- coexist with existing Finance data without dropping business records.

alter table public.notifications
  add column if not exists company_id uuid references public.companies(id),
  add column if not exists recipient_user_id uuid references public.users(id),
  add column if not exists notification_type text not null default 'system',
  add column if not exists content text not null default '',
  add column if not exists channels jsonb not null default '[]'::jsonb,
  add column if not exists status text not null default 'unread',
  add column if not exists source_module text,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists deleted_at timestamptz,
  add column if not exists read_at timestamptz,
  add column if not exists action_url text,
  add column if not exists email_last_attempt_at timestamptz,
  add column if not exists email_sent_at timestamptz,
  add column if not exists email_provider_message_id text,
  add column if not exists email_error_message text;

alter table public.report_export_batches
  add column if not exists report_key text not null default 'legacy',
  add column if not exists filters jsonb not null default '{}'::jsonb,
  add column if not exists sort_by text,
  add column if not exists format text not null default 'excel',
  add column if not exists record_count int not null default 0,
  add column if not exists storage_path text,
  add column if not exists completed_at timestamptz,
  add column if not exists error_message text,
  add column if not exists source_tables jsonb not null default '[]'::jsonb,
  add column if not exists source_request_id text references public.hr_requests(id) on delete set null,
  add column if not exists generated_from_snapshot jsonb not null default '{}'::jsonb;

alter table public.system_settings
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists company_id uuid references public.companies(id),
  add column if not exists category text not null default 'system_parameters',
  add column if not exists setting_key text,
  add column if not exists setting_value jsonb not null default '{}'::jsonb,
  add column if not exists is_active boolean not null default true,
  add column if not exists effective_from timestamptz not null default now(),
  add column if not exists effective_to timestamptz,
  add column if not exists deleted_at timestamptz,
  add column if not exists status text not null default 'active',
  add column if not exists display_name text,
  add column if not exists description text,
  add column if not exists settings jsonb not null default '{}'::jsonb,
  add column if not exists validation_schema jsonb not null default '{}'::jsonb,
  add column if not exists version integer not null default 1;

update public.system_settings
set
  setting_key = coalesce(setting_key, key),
  setting_value = case when setting_value = '{}'::jsonb then value else setting_value end,
  settings = case when settings = '{}'::jsonb then setting_value else settings end
where setting_key is null
  or setting_value = '{}'::jsonb
  or settings = '{}'::jsonb;

alter table public.system_settings alter column key set default ('legacy-' || gen_random_uuid()::text);
alter table public.system_settings alter column value set default '{}'::jsonb;
alter table public.system_settings replica identity full;
alter table public.system_settings drop constraint if exists system_settings_pkey;
update public.system_settings set id = gen_random_uuid() where id is null;
alter table public.system_settings alter column id set not null;
alter table public.system_settings add constraint system_settings_pkey primary key (id);
create unique index if not exists system_settings_company_setting_key_unique
on public.system_settings(company_id, setting_key);

create table if not exists public.notification_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  event_type text not null,
  title text not null,
  body text,
  channels jsonb not null default '[]'::jsonb,
  recipient_user_ids uuid[] not null default '{}',
  status text not null default 'queued',
  source_module text,
  metadata jsonb not null default '{}'::jsonb,
  request_id text references public.hr_requests(id) on delete set null,
  source_table text,
  source_uuid uuid,
  source_text text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table public.notifications
  add column if not exists event_id uuid references public.notification_events(id) on delete set null;

create table if not exists public.notification_email_deliveries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  notification_id text not null,
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

alter table public.payroll_payslips
  add column if not exists items jsonb not null default '[]'::jsonb;
