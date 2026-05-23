-- HRIS production integration links.
-- Purpose: make every major form/workflow traceable across requests, approvals,
-- attendance, payroll, notifications, reports, imports and audit logs.

alter table public.hr_requests
  add column if not exists company_id uuid references public.companies(id),
  add column if not exists employee_id uuid references public.employees(id),
  add column if not exists approval_flow_id uuid references public.approval_flows(id),
  add column if not exists linked_target_table text,
  add column if not exists linked_target_uuid uuid,
  add column if not exists linked_target_text text,
  add column if not exists source_module text not null default 'hris',
  add column if not exists integration_status text not null default 'linked'
    check (integration_status in ('draft','linked','pending_sync','synced','blocked','failed','archived')),
  add column if not exists integration_error text;

update public.hr_requests
set
  company_id = coalesce(hr_requests.company_id, users.company_id),
  employee_id = coalesce(hr_requests.employee_id, users.employee_id)
from public.users
where users.id = hr_requests.applicant_id
  and (hr_requests.company_id is null or hr_requests.employee_id is null);

alter table public.leave_requests
  add column if not exists hr_request_id text references public.hr_requests(id) on delete set null,
  add column if not exists schedule_id uuid references public.schedules(id) on delete set null,
  add column if not exists payroll_record_id uuid references public.payroll_records(id) on delete set null,
  add column if not exists integration_status text not null default 'linked'
    check (integration_status in ('draft','linked','pending_sync','synced','blocked','failed','archived')),
  add column if not exists compliance_result jsonb not null default '{}'::jsonb;

alter table public.overtime_requests
  add column if not exists hr_request_id text references public.hr_requests(id) on delete set null,
  add column if not exists schedule_id uuid references public.schedules(id) on delete set null,
  add column if not exists attendance_record_id uuid references public.attendance_records(id) on delete set null,
  add column if not exists payroll_record_id uuid references public.payroll_records(id) on delete set null,
  add column if not exists integration_status text not null default 'linked'
    check (integration_status in ('draft','linked','pending_sync','synced','blocked','failed','archived')),
  add column if not exists compliance_result jsonb not null default '{}'::jsonb;

alter table public.punch_correction_requests
  add column if not exists hr_request_id text references public.hr_requests(id) on delete set null,
  add column if not exists payroll_record_id uuid references public.payroll_records(id) on delete set null,
  add column if not exists applied_to_attendance_at timestamptz,
  add column if not exists applied_by uuid references public.users(id),
  add column if not exists integration_status text not null default 'linked'
    check (integration_status in ('draft','linked','pending_sync','synced','blocked','failed','archived')),
  add column if not exists compliance_result jsonb not null default '{}'::jsonb;

alter table public.shift_change_requests
  add column if not exists hr_request_id text references public.hr_requests(id) on delete set null,
  add column if not exists approval_flow_id uuid references public.approval_flows(id) on delete set null,
  add column if not exists integration_status text not null default 'linked'
    check (integration_status in ('draft','linked','pending_sync','synced','blocked','failed','archived')),
  add column if not exists compliance_result jsonb not null default '{}'::jsonb;

alter table public.employee_change_logs
  add column if not exists hr_request_id text references public.hr_requests(id) on delete set null,
  add column if not exists approval_flow_id uuid references public.approval_flows(id) on delete set null,
  add column if not exists payroll_record_id uuid references public.payroll_records(id) on delete set null,
  add column if not exists integration_status text not null default 'linked'
    check (integration_status in ('draft','linked','pending_sync','synced','blocked','failed','archived'));

alter table public.attendance_records
  add column if not exists source_request_id text references public.hr_requests(id) on delete set null,
  add column if not exists source_punch_correction_id uuid references public.punch_correction_requests(id) on delete set null,
  add column if not exists payroll_record_id uuid references public.payroll_records(id) on delete set null,
  add column if not exists payroll_blocked_reason text,
  add column if not exists compliance_result jsonb not null default '{}'::jsonb;

alter table public.payroll_records
  add column if not exists source_attendance_from date,
  add column if not exists source_attendance_to date,
  add column if not exists blocking_status text not null default 'unchecked'
    check (blocking_status in ('unchecked','blocked','clear','overridden')),
  add column if not exists blocking_summary jsonb not null default '{}'::jsonb,
  add column if not exists approved_by uuid references public.users(id),
  add column if not exists locked_by uuid references public.users(id),
  add column if not exists released_by uuid references public.users(id);

alter table public.payroll_payslips
  add column if not exists source_payroll_record_id uuid references public.payroll_records(id) on delete set null,
  add column if not exists read_at timestamptz,
  add column if not exists acknowledged_at timestamptz,
  add column if not exists access_policy jsonb not null default '{"scope":"self_only"}'::jsonb;

update public.payroll_payslips
set source_payroll_record_id = coalesce(source_payroll_record_id, payroll_record_id)
where source_payroll_record_id is null;

alter table public.payroll_items
  add column if not exists source_table text,
  add column if not exists source_uuid uuid,
  add column if not exists source_text text,
  add column if not exists calculation_snapshot jsonb not null default '{}'::jsonb;

alter table public.notification_events
  add column if not exists request_id text references public.hr_requests(id) on delete set null,
  add column if not exists source_table text,
  add column if not exists source_uuid uuid,
  add column if not exists source_text text;

alter table public.notifications
  add column if not exists event_id uuid references public.notification_events(id) on delete set null,
  add column if not exists request_id text references public.hr_requests(id) on delete set null,
  add column if not exists read_at timestamptz,
  add column if not exists action_url text;

alter table public.report_export_batches
  add column if not exists source_tables jsonb not null default '[]'::jsonb,
  add column if not exists source_request_id text references public.hr_requests(id) on delete set null,
  add column if not exists generated_from_snapshot jsonb not null default '{}'::jsonb;

alter table public.assessment_export_batches
  add column if not exists source_tables jsonb not null default '[]'::jsonb,
  add column if not exists generated_from_snapshot jsonb not null default '{}'::jsonb;

alter table public.excel_import_batches
  add column if not exists affected_table text,
  add column if not exists affected_record_ids jsonb not null default '[]'::jsonb,
  add column if not exists audit_log_id uuid references public.audit_logs(id) on delete set null;

create table if not exists public.hr_request_links (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  request_id text not null references public.hr_requests(id) on delete cascade,
  target_table text not null
    check (target_table in (
      'leave_requests',
      'overtime_requests',
      'punch_correction_requests',
      'shift_change_requests',
      'employee_change_logs',
      'attendance_records',
      'payroll_records',
      'payroll_payslips',
      'licenses',
      'training_records',
      'documents',
      'announcements',
      'report_export_batches',
      'assessment_export_batches',
      'excel_import_batches'
    )),
  target_uuid uuid,
  target_text text,
  relation_type text not null default 'primary'
    check (relation_type in ('primary','source','generated','blocked_by','resolved_by','notification','audit')),
  status text not null default 'active' check (status in ('active','archived','deleted')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (target_uuid is not null or target_text is not null),
  unique(request_id, target_table, target_uuid, target_text, relation_type)
);

create table if not exists public.payroll_calculation_sources (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  payroll_record_id uuid not null references public.payroll_records(id) on delete cascade,
  payroll_payslip_id uuid references public.payroll_payslips(id) on delete cascade,
  payroll_item_id uuid references public.payroll_items(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  source_table text not null
    check (source_table in (
      'schedules',
      'attendance_records',
      'attendance_punches',
      'leave_requests',
      'overtime_requests',
      'punch_correction_requests',
      'employee_payroll_settings',
      'payroll_item_settings',
      'system_settings'
    )),
  source_uuid uuid,
  source_text text,
  calculation_role text not null
    check (calculation_role in ('base_salary','attendance','leave_deduction','overtime','allowance','deduction','insurance','tax','employer_cost','blocker','adjustment')),
  amount numeric(14,2),
  hours numeric(8,2),
  snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (source_uuid is not null or source_text is not null)
);

create table if not exists public.payroll_blockers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  payroll_record_id uuid references public.payroll_records(id) on delete cascade,
  employee_id uuid references public.employees(id) on delete cascade,
  blocker_type text not null
    check (blocker_type in ('attendance_anomaly','missing_punch','pending_punch_correction','pending_leave','pending_overtime','schedule_conflict','missing_payroll_setting','compliance_violation','approval_not_completed')),
  source_table text,
  source_uuid uuid,
  source_text text,
  severity text not null default 'block' check (severity in ('block','warning','info')),
  status text not null default 'open' check (status in ('open','resolved','overridden','dismissed')),
  title text not null,
  detail text,
  resolved_by uuid references public.users(id),
  resolved_at timestamptz,
  resolution_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.form_integration_checks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  form_key text not null,
  form_name text not null,
  source_table text not null,
  workflow_table text not null default 'hr_requests',
  required_links jsonb not null default '[]'::jsonb,
  status text not null default 'active' check (status in ('active','needs_review','archived')),
  last_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique(company_id, form_key)
);

insert into public.hr_request_links (company_id, request_id, target_table, target_uuid, relation_type, status, metadata)
select hr_requests.company_id, hr_requests.id, 'leave_requests', leave_requests.id, 'primary', 'active', '{"backfilled":true}'::jsonb
from public.leave_requests
join public.hr_requests on hr_requests.id = leave_requests.hr_request_id
where leave_requests.hr_request_id is not null
  and hr_requests.company_id is not null
on conflict do nothing;

insert into public.hr_request_links (company_id, request_id, target_table, target_uuid, relation_type, status, metadata)
select hr_requests.company_id, hr_requests.id, 'overtime_requests', overtime_requests.id, 'primary', 'active', '{"backfilled":true}'::jsonb
from public.overtime_requests
join public.hr_requests on hr_requests.id = overtime_requests.hr_request_id
where overtime_requests.hr_request_id is not null
  and hr_requests.company_id is not null
on conflict do nothing;

insert into public.hr_request_links (company_id, request_id, target_table, target_uuid, relation_type, status, metadata)
select hr_requests.company_id, hr_requests.id, 'punch_correction_requests', punch_correction_requests.id, 'primary', 'active', '{"backfilled":true}'::jsonb
from public.punch_correction_requests
join public.hr_requests on hr_requests.id = punch_correction_requests.hr_request_id
where punch_correction_requests.hr_request_id is not null
  and hr_requests.company_id is not null
on conflict do nothing;

insert into public.form_integration_checks (company_id, form_key, form_name, source_table, required_links)
select companies.id, form.form_key, form.form_name, form.source_table, form.required_links::jsonb
from public.companies
cross join (
  values
    ('leave', '請假申請', 'leave_requests', '["hr_requests","approval_flows","approval_steps","schedules","payroll_calculation_sources","notifications","audit_logs"]'),
    ('overtime', '加班申請', 'overtime_requests', '["hr_requests","approval_flows","approval_steps","attendance_records","payroll_calculation_sources","notifications","audit_logs"]'),
    ('punch_correction', '補打卡申請', 'punch_correction_requests', '["hr_requests","approval_flows","approval_steps","attendance_records","payroll_blockers","notifications","audit_logs"]'),
    ('shift_change', '換班代班申請', 'shift_change_requests', '["hr_requests","approval_flows","approval_steps","schedules","notifications","audit_logs"]'),
    ('employee_change', '員工異動申請', 'employee_change_logs', '["hr_requests","approval_flows","approval_steps","employees","payroll_records","notifications","audit_logs"]'),
    ('payroll_closing', '薪資結算', 'payroll_records', '["attendance_records","leave_requests","overtime_requests","punch_correction_requests","payroll_payslips","payroll_items","payroll_blockers","finance_handoff","audit_logs"]'),
    ('license_upload', '證照上傳', 'licenses', '["documents","notifications","assessment_export_batches","audit_logs"]'),
    ('training_record', '教育訓練', 'training_records', '["documents","assessment_export_batches","report_export_batches","audit_logs"]'),
    ('announcement', '公告發布', 'announcements', '["announcement_targets","announcement_reads","notification_events","notifications","audit_logs"]'),
    ('report_export', '報表匯出', 'report_export_batches', '["employees","attendance_records","leave_requests","overtime_requests","payroll_records","licenses","training_records","audit_logs"]'),
    ('excel_import', 'Excel 匯入', 'excel_import_batches', '["target_table","audit_logs","error_logs"]')
) as form(form_key, form_name, source_table, required_links)
where companies.deleted_at is null
on conflict (company_id, form_key) do update
set
  form_name = excluded.form_name,
  source_table = excluded.source_table,
  required_links = excluded.required_links,
  status = 'active',
  updated_at = now();

create index if not exists idx_hr_requests_company_status on public.hr_requests(company_id, status, created_at desc);
create index if not exists idx_hr_requests_employee_status on public.hr_requests(employee_id, status, created_at desc);
create index if not exists idx_hr_requests_target on public.hr_requests(linked_target_table, linked_target_uuid, linked_target_text);
create index if not exists idx_hr_request_links_request on public.hr_request_links(request_id, target_table, relation_type);
create index if not exists idx_hr_request_links_target_uuid on public.hr_request_links(target_table, target_uuid);
create index if not exists idx_hr_request_links_company on public.hr_request_links(company_id, status, created_at desc);
create index if not exists idx_leave_requests_hr_request on public.leave_requests(hr_request_id);
create index if not exists idx_overtime_requests_hr_request on public.overtime_requests(hr_request_id);
create index if not exists idx_punch_correction_hr_request on public.punch_correction_requests(hr_request_id);
create index if not exists idx_shift_change_hr_request on public.shift_change_requests(hr_request_id);
create index if not exists idx_employee_change_logs_hr_request on public.employee_change_logs(hr_request_id);
create index if not exists idx_attendance_records_payroll on public.attendance_records(payroll_record_id, status);
create index if not exists idx_payroll_sources_record_employee on public.payroll_calculation_sources(payroll_record_id, employee_id);
create index if not exists idx_payroll_sources_source on public.payroll_calculation_sources(source_table, source_uuid, source_text);
create index if not exists idx_payroll_blockers_record_status on public.payroll_blockers(payroll_record_id, status, severity);
create index if not exists idx_payroll_blockers_employee_status on public.payroll_blockers(employee_id, status);
create index if not exists idx_notification_events_request on public.notification_events(request_id);
create index if not exists idx_notifications_event on public.notifications(event_id, recipient_user_id);
create index if not exists idx_form_integration_checks_company on public.form_integration_checks(company_id, status);

drop trigger if exists trg_hr_request_links_updated_at on public.hr_request_links;
create trigger trg_hr_request_links_updated_at before update on public.hr_request_links
for each row execute function public.set_updated_at();

drop trigger if exists trg_payroll_calculation_sources_updated_at on public.payroll_calculation_sources;
create trigger trg_payroll_calculation_sources_updated_at before update on public.payroll_calculation_sources
for each row execute function public.set_updated_at();

drop trigger if exists trg_payroll_blockers_updated_at on public.payroll_blockers;
create trigger trg_payroll_blockers_updated_at before update on public.payroll_blockers
for each row execute function public.set_updated_at();

drop trigger if exists trg_form_integration_checks_updated_at on public.form_integration_checks;
create trigger trg_form_integration_checks_updated_at before update on public.form_integration_checks
for each row execute function public.set_updated_at();

alter table public.hr_request_links enable row level security;
alter table public.payroll_calculation_sources enable row level security;
alter table public.payroll_blockers enable row level security;
alter table public.form_integration_checks enable row level security;

grant select, insert, update, delete on public.hr_request_links to authenticated;
grant select, insert, update, delete on public.payroll_calculation_sources to authenticated;
grant select, insert, update, delete on public.payroll_blockers to authenticated;
grant select, insert, update, delete on public.form_integration_checks to authenticated;

drop policy if exists "request users can view scoped request links" on public.hr_request_links;
create policy "request users can view scoped request links"
on public.hr_request_links for select
to authenticated
using (
  exists (
    select 1
    from public.hr_requests
    join public.users actor on actor.auth_user_id = auth.uid()
    where hr_requests.id = hr_request_links.request_id
      and actor.deleted_at is null
      and (
        hr_requests.applicant_id = actor.id
        or (
          public.current_role_key() in ('super_admin','company_admin','hr_manager','hr_staff','department_manager','homecare_supervisor','admin_director','ceo','hr','supervisor')
          and hr_request_links.company_id = actor.company_id
        )
      )
  )
);

drop policy if exists "request approvers can manage scoped request links" on public.hr_request_links;
create policy "request approvers can manage scoped request links"
on public.hr_request_links for all
to authenticated
using (
  public.current_role_key() in ('super_admin','company_admin','hr_manager','hr_staff','department_manager','homecare_supervisor','admin_director','ceo','hr','supervisor')
  and company_id = (
    select users.company_id
    from public.users
    where users.auth_user_id = auth.uid()
      and users.deleted_at is null
    limit 1
  )
)
with check (
  public.current_role_key() in ('super_admin','company_admin','hr_manager','hr_staff','department_manager','homecare_supervisor','admin_director','ceo','hr','supervisor')
  and company_id = (
    select users.company_id
    from public.users
    where users.auth_user_id = auth.uid()
      and users.deleted_at is null
    limit 1
  )
);

drop policy if exists "payroll managers can manage calculation sources" on public.payroll_calculation_sources;
create policy "payroll managers can manage calculation sources"
on public.payroll_calculation_sources for all
to authenticated
using (
  public.can_manage_payroll()
  and company_id = (
    select users.company_id
    from public.users
    where users.auth_user_id = auth.uid()
      and users.deleted_at is null
    limit 1
  )
)
with check (
  public.can_manage_payroll()
  and company_id = (
    select users.company_id
    from public.users
    where users.auth_user_id = auth.uid()
      and users.deleted_at is null
    limit 1
  )
);

drop policy if exists "payroll managers can manage payroll blockers" on public.payroll_blockers;
create policy "payroll managers can manage payroll blockers"
on public.payroll_blockers for all
to authenticated
using (
  public.can_manage_payroll()
  and company_id = (
    select users.company_id
    from public.users
    where users.auth_user_id = auth.uid()
      and users.deleted_at is null
    limit 1
  )
)
with check (
  public.can_manage_payroll()
  and company_id = (
    select users.company_id
    from public.users
    where users.auth_user_id = auth.uid()
      and users.deleted_at is null
    limit 1
  )
);

drop policy if exists "settings managers can manage form integration checks" on public.form_integration_checks;
create policy "settings managers can manage form integration checks"
on public.form_integration_checks for all
to authenticated
using (
  public.can_manage_system_settings()
  and (
    company_id is null
    or company_id = (
      select users.company_id
      from public.users
      where users.auth_user_id = auth.uid()
        and users.deleted_at is null
      limit 1
    )
  )
)
with check (
  public.can_manage_system_settings()
  and (
    company_id is null
    or company_id = (
      select users.company_id
      from public.users
      where users.auth_user_id = auth.uid()
        and users.deleted_at is null
      limit 1
    )
  )
);
