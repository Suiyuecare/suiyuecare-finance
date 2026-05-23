-- Production backup automation evidence for HRIS.
-- Supabase provides managed database backups; this worker records daily backup
-- health, latest backup evidence, and HRIS artifact snapshots for auditability.

alter table public.backup_restore_runs
add column if not exists backup_provider text not null default 'Supabase managed backups',
add column if not exists backup_reference text,
add column if not exists backup_kind text,
add column if not exists latest_backup_at timestamptz,
add column if not exists health_status text check (health_status in ('healthy','warning','blocked','failed','unknown')),
add column if not exists checked_at timestamptz,
add column if not exists next_check_at timestamptz;

create index if not exists idx_backup_restore_runs_checked_at
on public.backup_restore_runs(checked_at desc)
where deleted_at is null;

create index if not exists idx_backup_restore_runs_health_status
on public.backup_restore_runs(health_status, checked_at desc)
where deleted_at is null;

with backup_policy as (
  select jsonb_build_object(
    'automation_enabled', true,
    'worker_route', '/api/security/backup-worker',
    'worker_schedule', '30 18 * * *',
    'worker_schedule_timezone_note', 'Vercel Cron uses UTC; 18:30 UTC equals 02:30 Asia/Taipei next day.',
    'management_api_required_env', 'SUPABASE_ACCESS_TOKEN',
    'project_ref_required_env', 'SUPABASE_PROJECT_REF',
    'backup_worker_required_env', 'CRON_SECRET',
    'evidence_table', 'backup_restore_runs',
    'automated_checks',
    '[
      "Supabase Management API available backups",
      "latest backup freshness against RPO",
      "critical HRIS table row-count snapshot",
      "payroll/audit/document metadata coverage",
      "scheduled backup run audit evidence"
    ]'::jsonb,
    'critical_tables',
    '[
      "companies",
      "users",
      "employees",
      "attendance_records",
      "leave_requests",
      "overtime_requests",
      "punch_correction_requests",
      "payroll_records",
      "payroll_items",
      "payroll_payslips",
      "approval_flows",
      "approval_steps",
      "documents",
      "licenses",
      "training_records",
      "audit_logs",
      "notifications"
    ]'::jsonb,
    'last_policy_reviewed_at', now()
  ) as settings
)
update public.system_settings existing
set
  settings = existing.settings || backup_policy.settings,
  status = 'active',
  updated_at = now()
from backup_policy
where existing.setting_key = 'backup_restore_policy'
  and existing.deleted_at is null;

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
  'backup_automation_worker',
  'security_settings',
  '正式備份自動化 Worker',
  'Daily Vercel Cron worker that verifies Supabase managed backups and records backup evidence snapshots.',
  jsonb_build_object(
    'automation_enabled', true,
    'worker_route', '/api/security/backup-worker',
    'worker_schedule', '30 18 * * *',
    'worker_schedule_timezone_note', 'Vercel Cron uses UTC; 18:30 UTC equals 02:30 Asia/Taipei next day.',
    'management_api_required_env', 'SUPABASE_ACCESS_TOKEN',
    'project_ref_required_env', 'SUPABASE_PROJECT_REF',
    'backup_worker_required_env', 'CRON_SECRET',
    'evidence_table', 'backup_restore_runs',
    'minimum_retention_days', 30,
    'rpo_minutes', 1440,
    'rto_minutes', 240
  ),
  'active',
  current_date
from public.companies
where companies.deleted_at is null
  and not exists (
    select 1
    from public.system_settings existing
    where existing.company_id = companies.id
      and existing.setting_key = 'backup_automation_worker'
      and existing.deleted_at is null
  );
