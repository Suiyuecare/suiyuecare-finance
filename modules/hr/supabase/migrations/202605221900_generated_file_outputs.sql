-- Server-side Email / PDF-print / file generation records.

create table if not exists public.generated_file_exports (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  employee_id uuid references public.employees(id) on delete set null,
  requested_by uuid references public.users(id) on delete set null,
  artifact_type text not null check (artifact_type in ('report_summary','payroll_roster','payslip','employment_certificate','assessment_package')),
  format text not null check (format in ('csv','json','html','pdf_print')),
  delivery_method text not null default 'download' check (delivery_method in ('download','email','record')),
  file_name text not null,
  mime_type text not null,
  file_size bigint not null default 0,
  content_sha256 text,
  storage_bucket text,
  storage_path text,
  recipient_email text,
  email_status text check (email_status in ('not_required','queued','sent','failed','config_missing')),
  status text not null default 'generated' check (status in ('queued','generating','generated','sent','failed','cancelled')),
  filters jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  error_message text,
  generated_at timestamptz not null default now(),
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

drop trigger if exists trg_generated_file_exports_updated_at on public.generated_file_exports;
create trigger trg_generated_file_exports_updated_at before update on public.generated_file_exports
for each row execute function public.set_updated_at();

create index if not exists idx_generated_file_exports_company_created
on public.generated_file_exports(company_id, created_at desc)
where deleted_at is null;

create index if not exists idx_generated_file_exports_requested_by
on public.generated_file_exports(requested_by, created_at desc)
where deleted_at is null;

create index if not exists idx_generated_file_exports_artifact_status
on public.generated_file_exports(artifact_type, status, created_at desc)
where deleted_at is null;

alter table public.generated_file_exports enable row level security;

drop policy if exists "generated file managers view company exports" on public.generated_file_exports;
create policy "generated file managers view company exports"
on public.generated_file_exports for select
to authenticated
using (
  deleted_at is null
  and (
    private.is_hr_admin()
    or exists (
      select 1
      from public.users u
      where u.auth_user_id = auth.uid()
        and u.id = generated_file_exports.requested_by
        and u.deleted_at is null
    )
  )
  and (company_id = private.current_company_id() or company_id is null)
);

drop policy if exists "generated file managers manage company exports" on public.generated_file_exports;
create policy "generated file managers manage company exports"
on public.generated_file_exports for all
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
  'file_generation_outputs',
  'report_formats',
  'Email / PDF / 檔案產出設定',
  'Server-side generated file outputs for HR reports, payslips, certificates, and assessment packages.',
  jsonb_build_object(
    'enabled', true,
    'api_route', '/api/files/generate',
    'evidence_table', 'generated_file_exports',
    'supported_formats', jsonb_build_array('csv','json','html','pdf_print'),
    'supported_delivery_methods', jsonb_build_array('download','email','record'),
    'email_provider', 'Resend',
    'storage_bucket_env', 'GENERATED_FILES_BUCKET',
    'go_live_note', 'pdf_print is a print-ready HTML artifact unless a binary PDF renderer is configured.'
  ),
  'active',
  current_date
from public.companies
where companies.deleted_at is null
  and not exists (
    select 1
    from public.system_settings existing
    where existing.company_id = companies.id
      and existing.setting_key = 'file_generation_outputs'
      and existing.deleted_at is null
  );
