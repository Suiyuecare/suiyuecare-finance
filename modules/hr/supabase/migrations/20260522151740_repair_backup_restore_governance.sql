-- Backup and restore governance for HRIS production readiness.

create table if not exists public.backup_restore_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  run_type text not null check (run_type in ('scheduled_backup','manual_backup','restore_drill','pre_migration_backup','pre_payroll_close_backup','bulk_import_backup')),
  scope text not null default 'database' check (scope in ('database','payroll_artifacts','audit_logs','storage_documents','full_system')),
  status text not null default 'planned' check (status in ('planned','running','completed','failed','cancelled','blocked')),
  backup_started_at timestamptz,
  backup_completed_at timestamptz,
  restore_tested_at timestamptz,
  rpo_minutes integer not null default 1440 check (rpo_minutes >= 0),
  rto_minutes integer not null default 240 check (rto_minutes >= 0),
  retention_days integer not null default 30 check (retention_days >= 7),
  storage_location text,
  evidence_url text,
  checksum text,
  notes text,
  verified_by uuid references public.users(id),
  created_by uuid references public.users(id),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

drop trigger if exists trg_backup_restore_runs_updated_at on public.backup_restore_runs;
create trigger trg_backup_restore_runs_updated_at before update on public.backup_restore_runs
for each row execute function public.set_updated_at();

create index if not exists idx_backup_restore_runs_company_created
on public.backup_restore_runs(company_id, created_at desc)
where deleted_at is null;

create index if not exists idx_backup_restore_runs_status
on public.backup_restore_runs(status, run_type, created_at desc)
where deleted_at is null;

alter table public.backup_restore_runs enable row level security;

drop policy if exists "backup governance managers view company runs" on public.backup_restore_runs;
create policy "backup governance managers view company runs"
on public.backup_restore_runs for select
to authenticated
using (
  deleted_at is null
  and private.is_hr_admin()
  and company_id = private.current_company_id()
);

drop policy if exists "backup governance managers manage company runs" on public.backup_restore_runs;
create policy "backup governance managers manage company runs"
on public.backup_restore_runs for all
to authenticated
using (
  private.is_hr_admin()
  and company_id = private.current_company_id()
)
with check (
  private.is_hr_admin()
  and company_id = private.current_company_id()
);

with backup_policy as (
  select jsonb_build_object(
    'production_required', true,
    'provider', 'Supabase managed backups',
    'manual_export_required_before', '["schema_migration","payroll_close","bulk_import","permission_publish","legal_rule_publish"]'::jsonb,
    'rpo_minutes', 1440,
    'rto_minutes', 240,
    'minimum_retention_days', 30,
    'quarterly_restore_drill_required', true,
    'payroll_artifact_retention_years', 7,
    'audit_log_retention_years', 7,
    'storage_documents_backup_required', true,
    'restore_target', 'non-production Supabase project',
    'go_live_blockers',
    '[
      "尚未在 Supabase 專案確認 Production daily backups 或 PITR 狀態",
      "尚未完成一次非正式環境還原演練",
      "尚未確認 payroll_payslips/payroll_items/audit_logs 匯出保存位置",
      "尚未記錄備份負責人、復原負責人與聯絡窗口"
    ]'::jsonb,
    'last_policy_reviewed_at', now()
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
  'backup_restore_policy',
  'security_settings',
  '備份與復原策略',
  'HRIS Production database, payroll artifacts, audit logs, and documents backup/restore governance.',
  backup_policy.settings,
  'active',
  current_date
from public.companies
cross join backup_policy
where companies.deleted_at is null
  and not exists (
    select 1
    from public.system_settings existing
    where existing.company_id = companies.id
      and existing.setting_key = 'backup_restore_policy'
      and existing.deleted_at is null
  );

with backup_policy as (
  select jsonb_build_object(
    'production_required', true,
    'provider', 'Supabase managed backups',
    'manual_export_required_before', '["schema_migration","payroll_close","bulk_import","permission_publish","legal_rule_publish"]'::jsonb,
    'rpo_minutes', 1440,
    'rto_minutes', 240,
    'minimum_retention_days', 30,
    'quarterly_restore_drill_required', true,
    'payroll_artifact_retention_years', 7,
    'audit_log_retention_years', 7,
    'storage_documents_backup_required', true,
    'restore_target', 'non-production Supabase project',
    'go_live_blockers',
    '[
      "尚未在 Supabase 專案確認 Production daily backups 或 PITR 狀態",
      "尚未完成一次非正式環境還原演練",
      "尚未確認 payroll_payslips/payroll_items/audit_logs 匯出保存位置",
      "尚未記錄備份負責人、復原負責人與聯絡窗口"
    ]'::jsonb,
    'last_policy_reviewed_at', now()
  ) as settings
)
update public.system_settings existing
set
  category = 'security_settings',
  display_name = '備份與復原策略',
  description = 'HRIS Production database, payroll artifacts, audit logs, and documents backup/restore governance.',
  settings = existing.settings || backup_policy.settings,
  status = 'active',
  effective_from = coalesce(existing.effective_from, current_date),
  updated_at = now()
from backup_policy
where existing.setting_key = 'backup_restore_policy'
  and existing.deleted_at is null;

insert into public.backup_restore_runs (
  company_id,
  run_type,
  scope,
  status,
  rpo_minutes,
  rto_minutes,
  retention_days,
  storage_location,
  notes,
  metadata
)
select
  companies.id,
  'restore_drill',
  'full_system',
  'planned',
  1440,
  240,
  30,
  'Supabase non-production restore target',
  '上線前需完成一次非正式環境還原演練，確認 HRIS tables、RLS、payroll artifacts、audit logs 與 documents 可復原。',
  jsonb_build_object('go_live_required', true, 'source', 'migration_seed')
from public.companies
where companies.deleted_at is null
  and not exists (
    select 1
    from public.backup_restore_runs runs
    where runs.company_id = companies.id
      and runs.run_type = 'restore_drill'
      and runs.scope = 'full_system'
      and runs.deleted_at is null
  );
