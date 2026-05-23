-- Background scheduler registry and execution history.

create table if not exists public.background_job_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  job_key text not null,
  job_name text not null,
  job_type text not null default 'cron' check (job_type in ('cron','manual','worker','maintenance')),
  status text not null default 'running' check (status in ('queued','running','completed','failed','blocked','skipped')),
  schedule text,
  route text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  duration_ms integer,
  locked_until timestamptz,
  error_message text,
  result jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

drop trigger if exists trg_background_job_runs_updated_at on public.background_job_runs;
create trigger trg_background_job_runs_updated_at before update on public.background_job_runs
for each row execute function public.set_updated_at();

create index if not exists idx_background_job_runs_key_started
on public.background_job_runs(job_key, started_at desc)
where deleted_at is null;

create index if not exists idx_background_job_runs_status
on public.background_job_runs(status, started_at desc)
where deleted_at is null;

alter table public.background_job_runs enable row level security;

drop policy if exists "background job managers view company runs" on public.background_job_runs;
create policy "background job managers view company runs"
on public.background_job_runs for select
to authenticated
using (
  deleted_at is null
  and private.is_hr_admin()
  and (company_id = private.current_company_id() or company_id is null)
);

drop policy if exists "background job managers manage company runs" on public.background_job_runs;
create policy "background job managers manage company runs"
on public.background_job_runs for all
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
  'background_scheduler',
  'security_settings',
  '背景排程中心',
  'Central Vercel Cron scheduler for notification, backup, compliance, payroll, and maintenance workers.',
  jsonb_build_object(
    'enabled', true,
    'worker_route', '/api/background/scheduler',
    'worker_schedule', '*/5 * * * *',
    'timezone_note', 'Vercel Cron uses UTC; job due logic is recorded in Asia/Taipei-facing pages.',
    'required_env', jsonb_build_array('CRON_SECRET','SUPABASE_SERVICE_ROLE_KEY'),
    'jobs',
    jsonb_build_array(
      jsonb_build_object(
        'job_key','notification_email_queue',
        'job_name','Email 通知佇列',
        'interval_minutes',5,
        'route','/api/notifications/email-worker',
        'status','active'
      ),
      jsonb_build_object(
        'job_key','backup_health_check',
        'job_name','每日備份健康檢查',
        'interval_minutes',1440,
        'route','/api/security/backup-worker',
        'status','active'
      )
    )
  ),
  'active',
  current_date
from public.companies
where companies.deleted_at is null
  and not exists (
    select 1
    from public.system_settings existing
    where existing.company_id = companies.id
      and existing.setting_key = 'background_scheduler'
      and existing.deleted_at is null
  );
