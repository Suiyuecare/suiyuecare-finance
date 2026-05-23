-- Centralized anomaly alert center for HRIS operations.

create table if not exists public.alert_center_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  source_type text not null
    check (source_type in ('attendance','payroll','license','compliance','notification','background_job','security','file_generation')),
  source_table text,
  source_id uuid,
  severity text not null default 'warning'
    check (severity in ('info','warning','critical','blocking')),
  status text not null default 'open'
    check (status in ('open','acknowledged','in_progress','resolved','dismissed')),
  title text not null,
  description text,
  action_label text,
  action_href text,
  detected_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  owner_user_id uuid references public.users(id) on delete set null,
  created_by uuid references public.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

drop trigger if exists trg_alert_center_items_updated_at on public.alert_center_items;
create trigger trg_alert_center_items_updated_at before update on public.alert_center_items
for each row execute function public.set_updated_at();

create unique index if not exists idx_alert_center_items_source
on public.alert_center_items(company_id, source_type, source_table, source_id)
where source_id is not null and deleted_at is null;

create index if not exists idx_alert_center_items_company_status
on public.alert_center_items(company_id, status, severity, detected_at desc)
where deleted_at is null;

create index if not exists idx_alert_center_items_detected
on public.alert_center_items(detected_at desc)
where deleted_at is null;

alter table public.alert_center_items enable row level security;

drop policy if exists "alert center managers view company alerts" on public.alert_center_items;
create policy "alert center managers view company alerts"
on public.alert_center_items for select
to authenticated
using (
  deleted_at is null
  and private.is_hr_admin()
  and (company_id = private.current_company_id() or company_id is null)
);

drop policy if exists "alert center managers manage company alerts" on public.alert_center_items;
create policy "alert center managers manage company alerts"
on public.alert_center_items for all
to authenticated
using (
  private.is_hr_admin()
  and (company_id = private.current_company_id() or company_id is null)
)
with check (
  private.is_hr_admin()
  and (company_id = private.current_company_id() or company_id is null)
);

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
  'alert_center',
  'security_settings',
  '異常告警中心',
  'Aggregates attendance, payroll, license, notification, background job, file generation, and security alerts into one operational command center.',
  jsonb_build_object(
    'enabled', true,
    'sync_route', '/api/alerts/sync',
    'sync_interval_minutes', 15,
    'sources', jsonb_build_array(
      'attendance_records',
      'payroll_blockers',
      'licenses',
      'notification_email_deliveries',
      'background_job_runs',
      'generated_file_exports',
      'error_logs'
    ),
    'visibility', jsonb_build_object(
      'hr', 'company',
      'admin_director', 'company',
      'ceo', 'all_companies'
    )
  ),
  'active',
  current_date
from public.companies
where companies.deleted_at is null
on conflict (company_id, setting_key)
do update set
  settings = excluded.settings,
  status = 'active',
  updated_at = now();
