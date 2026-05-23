-- HRIS demo seed data and QA test cases.
-- Safe to re-run after applying supabase/hris_schema_v1.sql.

create extension if not exists pgcrypto;

create table if not exists public.hris_test_cases (
  id uuid primary key default gen_random_uuid(),
  case_key text not null unique,
  case_name text not null,
  case_type text not null
    check (case_type in ('attendance','leave','overtime','punch_correction','schedule','shift_change','payroll_closing','license_expiry','training','report_export')),
  company_id uuid references public.companies(id),
  employee_id uuid references public.employees(id),
  scenario jsonb not null default '{}'::jsonb,
  expected_result jsonb not null default '{}'::jsonb,
  status text not null default 'ready' check (status in ('ready','running','passed','failed','blocked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

drop trigger if exists trg_hris_test_cases_updated_at on public.hris_test_cases;
create trigger trg_hris_test_cases_updated_at before update on public.hris_test_cases
for each row execute function public.set_updated_at();

alter table public.hris_test_cases enable row level security;

drop policy if exists "test case managers can manage company cases" on public.hris_test_cases;
create policy "test case managers can manage company cases"
on public.hris_test_cases for all
to authenticated
using (
  public.current_role_key() in ('super_admin','company_admin','hr_manager','hr_staff')
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
  public.current_role_key() in ('super_admin','company_admin','hr_manager','hr_staff')
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

insert into public.companies (code, name, legal_name, tax_id, phone, email, address, settings)
values
  ('DEMO-A', '歲月照護股份有限公司', '歲月照護股份有限公司', '90000001', '02-7700-1001', 'hr@suiyue-care.test', '{"city":"台北市","district":"大安區","line1":"仁愛路三段 100 號"}', '{"demo":true,"service_lines":["homecare","daycare"]}'),
  ('DEMO-B', '安晴長照服務有限公司', '安晴長照服務有限公司', '90000002', '02-7700-2001', 'hr@anching-care.test', '{"city":"新北市","district":"板橋區","line1":"文化路一段 88 號"}', '{"demo":true,"service_lines":["homecare"]}'),
  ('DEMO-C', '樂齡日照社團法人', '樂齡日照社團法人', '90000003', '03-3300-3001', 'hr@lohas-daycare.test', '{"city":"桃園市","district":"桃園區","line1":"中正路 66 號"}', '{"demo":true,"service_lines":["daycare"]}')
on conflict (code) do update set
  name = excluded.name,
  legal_name = excluded.legal_name,
  phone = excluded.phone,
  email = excluded.email,
  address = excluded.address,
  settings = excluded.settings;

with company_refs as (
  select code, id from public.companies where code in ('DEMO-A','DEMO-B','DEMO-C')
)
insert into public.branches (company_id, code, name, branch_type, phone, email, address, geo_location, settings)
select company_refs.id, branch.code, branch.name, branch.branch_type, branch.phone, branch.email, branch.address::jsonb, branch.geo_location::jsonb, '{"demo":true}'::jsonb
from (
  values
    ('DEMO-A','A-HQ','歲月總部','headquarters','02-7700-1100','hq@suiyue-care.test','{"city":"台北市","line1":"仁愛路三段 100 號"}','{"lat":25.0375,"lng":121.5637,"radius_m":150}'),
    ('DEMO-A','A-HC','台北居服站','homecare_station','02-7700-1110','homecare@suiyue-care.test','{"city":"台北市","line1":"和平東路二段 66 號"}','{"lat":25.0264,"lng":121.5421,"radius_m":200}'),
    ('DEMO-B','B-HQ','安晴總部','headquarters','02-7700-2200','hq@anching-care.test','{"city":"新北市","line1":"文化路一段 88 號"}','{"lat":25.0143,"lng":121.4638,"radius_m":150}'),
    ('DEMO-B','B-HC','新北居服站','homecare_station','02-7700-2210','homecare@anching-care.test','{"city":"新北市","line1":"中山路一段 12 號"}','{"lat":25.0128,"lng":121.4655,"radius_m":220}'),
    ('DEMO-C','C-HQ','樂齡總部','headquarters','03-3300-3300','hq@lohas-daycare.test','{"city":"桃園市","line1":"中正路 66 號"}','{"lat":24.9936,"lng":121.3010,"radius_m":150}'),
    ('DEMO-C','C-DC','桃園日照中心','daycare_center','03-3300-3310','daycare@lohas-daycare.test','{"city":"桃園市","line1":"民生路 168 號"}','{"lat":24.9951,"lng":121.3102,"radius_m":180}')
) as branch(company_code, code, name, branch_type, phone, email, address, geo_location)
join company_refs on company_refs.code = branch.company_code
on conflict (company_id, code) do update set
  name = excluded.name,
  branch_type = excluded.branch_type,
  phone = excluded.phone,
  email = excluded.email,
  address = excluded.address,
  geo_location = excluded.geo_location,
  settings = excluded.settings;

with company_refs as (
  select code, id from public.companies where code in ('DEMO-A','DEMO-B','DEMO-C')
), branch_refs as (
  select companies.code as company_code, branches.code, branches.id
  from public.branches
  join public.companies on companies.id = branches.company_id
  where companies.code in ('DEMO-A','DEMO-B','DEMO-C')
)
insert into public.departments (company_id, branch_id, code, name, department_type)
select company_refs.id, branch_refs.id, dept.code, dept.name, dept.department_type
from (
  values
    ('DEMO-A','A-HQ','HR','人資部','hr'),
    ('DEMO-A','A-HQ','FIN','財會部','finance'),
    ('DEMO-A','A-HC','HOMECARE','居家服務部','homecare'),
    ('DEMO-A','A-HQ','DAYCARE','日照營運部','daycare'),
    ('DEMO-B','B-HQ','HR','人資行政部','hr'),
    ('DEMO-B','B-HC','HOMECARE','新北居服部','homecare'),
    ('DEMO-B','B-HQ','OPS','營運管理部','operations'),
    ('DEMO-C','C-HQ','HR','行政人資部','hr'),
    ('DEMO-C','C-DC','DAYCARE','桃園日照部','daycare'),
    ('DEMO-C','C-HQ','SUPPORT','支援服務部','support')
) as dept(company_code, branch_code, code, name, department_type)
join company_refs on company_refs.code = dept.company_code
join branch_refs on branch_refs.company_code = dept.company_code and branch_refs.code = dept.branch_code
on conflict (company_id, code) do update set
  branch_id = excluded.branch_id,
  name = excluded.name,
  department_type = excluded.department_type;

with companies as (
  select id, code from public.companies where code in ('DEMO-A','DEMO-B','DEMO-C')
), departments as (
  select departments.id, departments.company_id, departments.code
  from public.departments
  join companies on companies.id = departments.company_id
)
insert into public.positions (company_id, department_id, code, title, level, employment_type, is_manager)
select companies.id, departments.id, position.code, position.title, position.level, position.employment_type, position.is_manager
from companies
cross join (
  values
    ('SYS_ADMIN','系統管理員','L6','full_time',true,'HR'),
    ('HR_MANAGER','人資主管','L5','full_time',true,'HR'),
    ('HR_STAFF','人資人員','L3','full_time',false,'HR'),
    ('ACCOUNTANT','會計人員','L3','full_time',false,'FIN'),
    ('DEPT_MANAGER','部門主管','L4','full_time',true,'OPS'),
    ('HOMECARE_WORKER','居服員','L2','full_time',false,'HOMECARE'),
    ('DAYCARE_STAFF','日照中心人員','L2','full_time',false,'DAYCARE'),
    ('EMPLOYEE','一般員工','L1','full_time',false,'SUPPORT')
) as position(code, title, level, employment_type, is_manager, preferred_department_code)
left join departments on departments.company_id = companies.id
  and departments.code = case
    when position.preferred_department_code = 'FIN' and companies.code <> 'DEMO-A' then 'HR'
    when position.preferred_department_code = 'OPS' and companies.code <> 'DEMO-B' then 'HR'
    when position.preferred_department_code = 'SUPPORT' and companies.code <> 'DEMO-C' then 'HR'
    when position.preferred_department_code = 'DAYCARE' and companies.code = 'DEMO-B' then 'HR'
    when position.preferred_department_code = 'HOMECARE' and companies.code = 'DEMO-C' then 'HR'
    else position.preferred_department_code
  end
on conflict (company_id, code) do update set
  department_id = excluded.department_id,
  title = excluded.title,
  level = excluded.level,
  is_manager = excluded.is_manager;

with companies as (
  select id from public.companies where code in ('DEMO-A','DEMO-B','DEMO-C')
)
insert into public.roles (company_id, key, name, description, permissions, data_scope, is_system_role)
select companies.id, role.key, role.name, role.description, role.permissions::jsonb, role.data_scope, true
from companies
cross join (
  values
    ('super_admin','超級管理員','跨公司最高權限','["module:admin","system:settings","employee:manage","payroll:manage"]','all_companies'),
    ('company_admin','公司管理員','公司層級管理權限','["module:admin","system:settings","employee:manage","analytics:view"]','company'),
    ('hr_manager','人資主管','人資規則與人員管理','["system:settings","employee:manage","attendance:manage","request:admin","training:manage"]','company'),
    ('hr_staff','人資人員','人資日常作業','["employee:manage","attendance:manage","request:admin","training:manage"]','company'),
    ('accountant','會計人員','薪資與會計資料','["payroll:all:view","finance_handoff:manage","analytics:view"]','company'),
    ('department_manager','部門主管','部門簽核與排班','["employee:view","request:approve","attendance:approve"]','department'),
    ('employee','一般員工','員工自助入口','["dashboard:view","request:create","payroll:self:view"]','self'),
    ('homecare_supervisor','居服督導','居服排班與簽核','["care_schedule:manage","request:approve","attendance:approve"]','team'),
    ('homecare_worker','居服員','居服員行動入口','["attendance:view","care_schedule:view","request:create"]','self'),
    ('daycare_staff','日照中心人員','日照中心人員入口','["attendance:view","care_schedule:view","request:create"]','team')
) as role(key, name, description, permissions, data_scope)
on conflict (company_id, key) do update set
  name = excluded.name,
  description = excluded.description,
  permissions = excluded.permissions,
  data_scope = excluded.data_scope;

with department_refs as (
  select companies.code as company_code, departments.company_id, departments.id, departments.code
  from public.departments
  join public.companies on companies.id = departments.company_id
  where companies.code in ('DEMO-A','DEMO-B','DEMO-C')
)
insert into public.teams (company_id, branch_id, department_id, code, name, team_type)
select department_refs.company_id, departments.branch_id, department_refs.id, team.code, team.name, team.team_type
from (
  values
    ('DEMO-A','HOMECARE','A-HC-T1','台北居服一組','homecare_worker'),
    ('DEMO-A','DAYCARE','A-DC-T1','日照支援組','daycare_shift'),
    ('DEMO-B','HOMECARE','B-HC-T1','新北居服一組','homecare_worker'),
    ('DEMO-B','OPS','B-OPS-T1','營運支援組','admin'),
    ('DEMO-C','DAYCARE','C-DC-T1','桃園日照早班','daycare_shift'),
    ('DEMO-C','SUPPORT','C-SUP-T1','行政支援組','admin')
) as team(company_code, department_code, code, name, team_type)
join department_refs on department_refs.company_code = team.company_code and department_refs.code = team.department_code
join public.departments on departments.id = department_refs.id
on conflict (company_id, code) do update set
  branch_id = excluded.branch_id,
  department_id = excluded.department_id,
  name = excluded.name,
  team_type = excluded.team_type;

with company_refs as (
  select id, code from public.companies where code in ('DEMO-A','DEMO-B','DEMO-C')
), branch_refs as (
  select branches.id, branches.code, branches.company_id
  from public.branches
  join company_refs on company_refs.id = branches.company_id
), department_refs as (
  select departments.id, departments.code, departments.company_id
  from public.departments
  join company_refs on company_refs.id = departments.company_id
), position_refs as (
  select positions.id, positions.code, positions.company_id
  from public.positions
  join company_refs on company_refs.id = positions.company_id
), generated as (
  select
    n,
    case when n <= 40 then 'DEMO-A' when n <= 60 then 'DEMO-B' else 'DEMO-C' end as company_code,
    case
      when n <= 3 then 'DEPT_MANAGER'
      when n <= 5 then 'HR_STAFF'
      when n = 6 then 'ACCOUNTANT'
      when n = 7 then 'SYS_ADMIN'
      when n between 8 and 27 then 'HOMECARE_WORKER'
      when n between 28 and 37 then 'DAYCARE_STAFF'
      else 'EMPLOYEE'
    end as position_code,
    case
      when n <= 7 then 'HR'
      when n between 8 and 27 then 'HOMECARE'
      when n between 28 and 37 then 'DAYCARE'
      when n <= 40 then 'HR'
      when n <= 60 then 'OPS'
      else 'SUPPORT'
    end as desired_department_code,
    case
      when n <= 40 then case when n between 8 and 27 then 'A-HC' else 'A-HQ' end
      when n <= 60 then case when n between 41 and 52 then 'B-HC' else 'B-HQ' end
      else case when n between 61 and 70 then 'C-DC' else 'C-HQ' end
    end as branch_code
  from generate_series(1, 80) as n
)
insert into public.employees (
  company_id,
  primary_branch_id,
  primary_department_id,
  position_id,
  employee_no,
  full_name,
  preferred_name,
  national_id_cipher,
  birthday,
  gender,
  phone,
  email,
  address,
  emergency_contact,
  hire_date,
  employment_status,
  labor_insurance_salary,
  health_insurance_salary,
  pension_salary,
  metadata
)
select
  company_refs.id,
  branch_refs.id,
  coalesce(department_refs.id, fallback_department.id),
  position_refs.id,
  'DEMO-' || lpad(generated.n::text, 3, '0'),
  (array['林','陳','王','張','李','黃','吳','劉','蔡','楊'])[(generated.n - 1) % 10 + 1] ||
    (array['佳穎','柏宏','淑芬','志明','雅婷','冠宇','怡君','建豪','佩珊','宗翰'])[(generated.n - 1) % 10 + 1],
  'Demo ' || generated.n,
  encode(digest('DEMO-NID-' || generated.n, 'sha256'), 'hex'),
  date '1980-01-01' + (generated.n * 97 % 9000),
  case when generated.n % 3 = 0 then 'male' when generated.n % 3 = 1 then 'female' else 'not_disclosed' end,
  '09' || lpad((10000000 + generated.n)::text, 8, '0'),
  'demo' || lpad(generated.n::text, 3, '0') || '@hris.test',
  jsonb_build_object('city', case generated.company_code when 'DEMO-A' then '台北市' when 'DEMO-B' then '新北市' else '桃園市' end, 'line1', '測試路 ' || generated.n || ' 號'),
  jsonb_build_object('name', '緊急聯絡人' || generated.n, 'phone', '02-8800-' || lpad(generated.n::text, 4, '0')),
  date '2023-01-01' + (generated.n * 11 % 1050),
  'active',
  case when generated.position_code in ('DEPT_MANAGER','SYS_ADMIN','HR_MANAGER') then 50600 else 42000 end,
  case when generated.position_code in ('DEPT_MANAGER','SYS_ADMIN','HR_MANAGER') then 50600 else 42000 end,
  case when generated.position_code in ('DEPT_MANAGER','SYS_ADMIN','HR_MANAGER') then 50600 else 42000 end,
  jsonb_build_object(
    'demo', true,
    'employee_group',
    case
      when generated.n <= 3 then 'manager'
      when generated.n <= 5 then 'hr'
      when generated.n = 6 then 'accountant'
      when generated.n = 7 then 'system_admin'
      when generated.n between 8 and 27 then 'homecare_worker'
      when generated.n between 28 and 37 then 'daycare_staff'
      else 'general_employee'
    end
  )
from generated
join company_refs on company_refs.code = generated.company_code
join branch_refs on branch_refs.company_id = company_refs.id and branch_refs.code = generated.branch_code
left join department_refs on department_refs.company_id = company_refs.id and department_refs.code = generated.desired_department_code
left join department_refs fallback_department on fallback_department.company_id = company_refs.id and fallback_department.code = 'HR'
left join position_refs on position_refs.company_id = company_refs.id and position_refs.code = generated.position_code
on conflict (company_id, employee_no) do update set
  primary_branch_id = excluded.primary_branch_id,
  primary_department_id = excluded.primary_department_id,
  position_id = excluded.position_id,
  full_name = excluded.full_name,
  phone = excluded.phone,
  email = excluded.email,
  employment_status = excluded.employment_status,
  metadata = excluded.metadata;

update public.employees employee
set manager_employee_id = manager.id
from public.employees manager
where employee.company_id = manager.company_id
  and manager.employee_no = case
    when employee.employee_no between 'DEMO-008' and 'DEMO-027' then 'DEMO-001'
    when employee.employee_no between 'DEMO-028' and 'DEMO-037' then 'DEMO-002'
    else 'DEMO-003'
  end
  and employee.employee_no like 'DEMO-%';

with employees as (
  select employees.*, companies.code as company_code
  from public.employees
  join public.companies on companies.id = employees.company_id
  where employees.employee_no like 'DEMO-%'
), roles as (
  select roles.id, roles.company_id, roles.key
  from public.roles
  join public.companies on companies.id = roles.company_id
  where companies.code in ('DEMO-A','DEMO-B','DEMO-C')
)
insert into public.users (company_id, employee_id, role_id, email, display_name, status, last_sign_in_at)
select
  employees.company_id,
  employees.id,
  roles.id,
  employees.email,
  employees.full_name,
  'active',
  now() - ((substring(employees.employee_no from 6)::int % 9) || ' days')::interval
from employees
join roles on roles.company_id = employees.company_id
  and roles.key = case
    when employees.employee_no = 'DEMO-007' then 'super_admin'
    when employees.employee_no in ('DEMO-004','DEMO-005') then 'hr_staff'
    when employees.employee_no = 'DEMO-006' then 'accountant'
    when employees.employee_no in ('DEMO-001','DEMO-002','DEMO-003') then 'department_manager'
    when employees.metadata ->> 'employee_group' = 'homecare_worker' then 'homecare_worker'
    when employees.metadata ->> 'employee_group' = 'daycare_staff' then 'daycare_staff'
    else 'employee'
  end
on conflict (email) do update set
  company_id = excluded.company_id,
  employee_id = excluded.employee_id,
  role_id = excluded.role_id,
  display_name = excluded.display_name,
  status = excluded.status,
  last_sign_in_at = excluded.last_sign_in_at;

with employees as (
  select id, company_id, primary_branch_id, primary_department_id, primary_team_id, employee_no, metadata
  from public.employees
  where employee_no like 'DEMO-%'
)
insert into public.employee_branch_assignments (company_id, employee_id, branch_id, department_id, assignment_type, position_title, effective_from, weekly_hours, note)
select
  employees.company_id,
  employees.id,
  employees.primary_branch_id,
  employees.primary_department_id,
  'primary',
  employees.metadata ->> 'employee_group',
  date '2026-01-01',
  case when employees.metadata ->> 'employee_group' = 'homecare_worker' then 40 else 42 end,
  'SEED: primary assignment'
from employees
on conflict do nothing;

with companies as (
  select id from public.companies where code in ('DEMO-A','DEMO-B','DEMO-C')
), branches as (
  select branches.id, branches.company_id, branches.code
  from public.branches
  join companies on companies.id = branches.company_id
)
insert into public.shifts (company_id, branch_id, code, name, start_time, end_time, break_minutes, crosses_midnight, is_active)
select branches.company_id, branches.id, shift.code, shift.name, shift.start_time::time, shift.end_time::time, shift.break_minutes, shift.crosses_midnight, true
from branches
cross join (
  values
    ('D','日班','08:30','17:30',60,false),
    ('E','晚班','13:00','22:00',60,false),
    ('N','夜班','22:00','07:00',60,true),
    ('OFF','休假','00:00','00:00',0,false)
) as shift(code, name, start_time, end_time, break_minutes, crosses_midnight)
on conflict (company_id, code) do update set
  name = excluded.name,
  start_time = excluded.start_time,
  end_time = excluded.end_time,
  break_minutes = excluded.break_minutes,
  crosses_midnight = excluded.crosses_midnight,
  is_active = excluded.is_active;

with employees as (
  select employees.id, employees.company_id, employees.primary_branch_id, employees.primary_department_id, employees.employee_no
  from public.employees
  where employees.employee_no between 'DEMO-001' and 'DEMO-040'
), shifts as (
  select id, company_id from public.shifts where code = 'D'
), days as (
  select generate_series(date '2026-05-13', date '2026-05-19', interval '1 day')::date as work_date
)
insert into public.schedules (company_id, branch_id, department_id, employee_id, shift_id, work_date, planned_start, planned_end, schedule_type, source_module, note)
select
  employees.company_id,
  employees.primary_branch_id,
  employees.primary_department_id,
  employees.id,
  shifts.id,
  days.work_date,
  days.work_date + time '08:30',
  days.work_date + time '17:30',
  'regular',
  'seed',
  'SEED: monthly schedule test data'
from employees
join shifts on shifts.company_id = employees.company_id
cross join days
where extract(isodow from days.work_date) between 1 and 6
on conflict (employee_id, work_date) do update set
  shift_id = excluded.shift_id,
  planned_start = excluded.planned_start,
  planned_end = excluded.planned_end,
  schedule_type = excluded.schedule_type,
  note = excluded.note;

with schedules as (
  select schedules.*, employees.employee_no
  from public.schedules
  join public.employees on employees.id = schedules.employee_id
  where schedules.note = 'SEED: monthly schedule test data'
    and schedules.work_date = date '2026-05-18'
)
insert into public.attendance_records (
  company_id,
  branch_id,
  employee_id,
  schedule_id,
  work_date,
  clock_in_at,
  clock_out_at,
  clock_in_location,
  clock_out_location,
  source,
  status,
  anomaly_code,
  note
)
select
  schedules.company_id,
  schedules.branch_id,
  schedules.employee_id,
  schedules.id,
  schedules.work_date,
  schedules.work_date + case when schedules.employee_no in ('DEMO-010','DEMO-011') then time '09:05' else time '08:26' end,
  schedules.work_date + case when schedules.employee_no = 'DEMO-012' then time '16:50' else time '17:39' end,
  jsonb_build_object('lat', 25.0375, 'lng', 121.5637, 'address', '測試打卡地點', 'rule', 'gps'),
  jsonb_build_object('lat', 25.0378, 'lng', 121.5639, 'address', '測試打卡地點', 'rule', 'wifi'),
  'mobile',
  case when schedules.employee_no in ('DEMO-010','DEMO-011') then 'late' when schedules.employee_no = 'DEMO-012' then 'early_leave' else 'normal' end,
  case when schedules.employee_no in ('DEMO-010','DEMO-011') then 'late' when schedules.employee_no = 'DEMO-012' then 'early_leave' else null end,
  'SEED: attendance punch test case'
from schedules
where schedules.employee_no between 'DEMO-001' and 'DEMO-012'
on conflict (employee_id, work_date) do update set
  schedule_id = excluded.schedule_id,
  clock_in_at = excluded.clock_in_at,
  clock_out_at = excluded.clock_out_at,
  clock_in_location = excluded.clock_in_location,
  clock_out_location = excluded.clock_out_location,
  source = excluded.source,
  status = excluded.status,
  anomaly_code = excluded.anomaly_code,
  note = excluded.note;

delete from public.leave_requests where reason like 'SEED:%';
delete from public.overtime_requests where reason like 'SEED:%';
delete from public.punch_correction_requests where reason like 'SEED:%';

with refs as (
  select employees.id as employee_id, employees.company_id, employees.employee_no
  from public.employees
  where employees.employee_no in ('DEMO-013','DEMO-014','DEMO-015','DEMO-016','DEMO-017','DEMO-018')
), flow_refs as (
  insert into public.approval_flows (company_id, name, request_type, applies_to, is_active)
  select distinct refs.company_id, 'SEED 主管與人資雙層簽核', flow_type.request_type, '{"demo":true}'::jsonb, true
  from refs
  cross join (values ('leave'), ('overtime'), ('punch_correction')) as flow_type(request_type)
  on conflict (company_id, request_type, name) do update set is_active = excluded.is_active
  returning id, company_id, request_type
)
insert into public.leave_requests (company_id, employee_id, approval_flow_id, leave_type, starts_at, ends_at, total_hours, reason, status, submitted_at, approved_at)
select refs.company_id, refs.employee_id, flow_refs.id, leave_case.leave_type, leave_case.starts_at, leave_case.ends_at, leave_case.total_hours, leave_case.reason, leave_case.status, now() - interval '2 days', case when leave_case.status = 'approved' then now() - interval '1 day' else null end
from refs
join flow_refs on flow_refs.company_id = refs.company_id and flow_refs.request_type = 'leave'
join (
  values
    ('DEMO-013','annual_leave', timestamptz '2026-05-20 08:30+08', timestamptz '2026-05-20 17:30+08', 8, 'SEED: 特休申請測試', 'approved'),
    ('DEMO-014','sick_leave', timestamptz '2026-05-21 13:30+08', timestamptz '2026-05-21 17:30+08', 4, 'SEED: 病假半日申請測試', 'pending')
) as leave_case(employee_no, leave_type, starts_at, ends_at, total_hours, reason, status) on leave_case.employee_no = refs.employee_no;

with refs as (
  select employees.id as employee_id, employees.company_id, employees.employee_no
  from public.employees
  where employees.employee_no in ('DEMO-015','DEMO-016')
), flows as (
  select id, company_id from public.approval_flows where name = 'SEED 主管與人資雙層簽核' and request_type = 'overtime'
)
insert into public.overtime_requests (company_id, employee_id, approval_flow_id, work_date, starts_at, ends_at, total_hours, overtime_type, reason, status, submitted_at, approved_at)
select refs.company_id, refs.employee_id, flows.id, overtime_case.work_date, overtime_case.starts_at, overtime_case.ends_at, overtime_case.total_hours, overtime_case.overtime_type, overtime_case.reason, overtime_case.status, now() - interval '1 day', case when overtime_case.status = 'approved' then now() - interval '12 hours' else null end
from refs
join flows on flows.company_id = refs.company_id
join (
  values
    ('DEMO-015', date '2026-05-18', timestamptz '2026-05-18 18:00+08', timestamptz '2026-05-18 20:00+08', 2, 'weekday', 'SEED: 平日加班費試算測試', 'approved'),
    ('DEMO-016', date '2026-05-17', timestamptz '2026-05-17 09:00+08', timestamptz '2026-05-17 13:00+08', 4, 'rest_day', 'SEED: 休息日加班送審測試', 'pending')
) as overtime_case(employee_no, work_date, starts_at, ends_at, total_hours, overtime_type, reason, status) on overtime_case.employee_no = refs.employee_no;

with refs as (
  select employees.id as employee_id, employees.company_id, employees.employee_no
  from public.employees
  where employees.employee_no in ('DEMO-017','DEMO-018')
), flows as (
  select id, company_id from public.approval_flows where name = 'SEED 主管與人資雙層簽核' and request_type = 'punch_correction'
), attendance as (
  select attendance_records.id, attendance_records.employee_id
  from public.attendance_records
)
insert into public.punch_correction_requests (company_id, employee_id, attendance_record_id, approval_flow_id, work_date, correction_type, requested_clock_in_at, requested_clock_out_at, reason, status, submitted_at, approved_at)
select refs.company_id, refs.employee_id, attendance.id, flows.id, date '2026-05-18', correction.correction_type, correction.clock_in_at, correction.clock_out_at, correction.reason, correction.status, now() - interval '8 hours', case when correction.status = 'approved' then now() - interval '2 hours' else null end
from refs
join flows on flows.company_id = refs.company_id
left join attendance on attendance.employee_id = refs.employee_id
join (
  values
    ('DEMO-017','clock_in', timestamptz '2026-05-18 08:31+08', null, 'SEED: 補上班卡測試', 'approved'),
    ('DEMO-018','both', timestamptz '2026-05-18 08:32+08', timestamptz '2026-05-18 17:42+08', 'SEED: 補上下班卡測試', 'pending')
) as correction(employee_no, correction_type, clock_in_at, clock_out_at, reason, status) on correction.employee_no = refs.employee_no;

with companies as (
  select id, code from public.companies where code in ('DEMO-A','DEMO-B','DEMO-C')
), branches as (
  select id, company_id, code from public.branches
  where code in ('A-HQ','A-HC','B-HQ','B-HC','C-HQ','C-DC')
), approvers as (
  select users.id, users.company_id
  from public.users
  join public.employees on employees.id = users.employee_id
  where employees.employee_no in ('DEMO-006','DEMO-007')
)
insert into public.payroll_records (company_id, branch_id, payroll_month, period_start, period_end, status, gross_pay_total, deduction_total, employer_cost_total, net_pay_total, approved_by, approved_at, finance_reference_id)
select
  branches.company_id,
  branches.id,
  date '2026-05-01',
  date '2026-05-01',
  date '2026-05-31',
  'reviewing',
  1280000 + (row_number() over (order by branches.code) * 50000),
  182000 + (row_number() over (order by branches.code) * 3000),
  196000 + (row_number() over (order by branches.code) * 4000),
  1098000 + (row_number() over (order by branches.code) * 43000),
  (select approvers.id from approvers where approvers.company_id = branches.company_id limit 1),
  now() - interval '6 hours',
  'SEED-FIN-' || branches.code || '-202605'
from branches
on conflict (company_id, branch_id, payroll_month) do update set
  period_start = excluded.period_start,
  period_end = excluded.period_end,
  status = excluded.status,
  gross_pay_total = excluded.gross_pay_total,
  deduction_total = excluded.deduction_total,
  employer_cost_total = excluded.employer_cost_total,
  net_pay_total = excluded.net_pay_total,
  approved_by = excluded.approved_by,
  approved_at = excluded.approved_at,
  finance_reference_id = excluded.finance_reference_id;

delete from public.payroll_items where metadata ->> 'seed' = 'true';
delete from public.payroll_payslips where remark like 'SEED:%';

with employees as (
  select * from public.employees where employee_no between 'DEMO-001' and 'DEMO-012'
), payroll as (
  select * from public.payroll_records where payroll_month = date '2026-05-01'
), releasers as (
  select users.id, users.company_id
  from public.users
  join public.employees on employees.id = users.employee_id
  where employees.employee_no in ('DEMO-006','DEMO-007')
), payslips as (
  insert into public.payroll_payslips (payroll_record_id, company_id, branch_id, employee_id, payroll_month, payment_date, bank_account_last_five, gross_pay_total, deduction_total, employer_cost_total, net_pay_total, remark, status, released_at, released_by)
  select
    payroll.id,
    employees.company_id,
    employees.primary_branch_id,
    employees.id,
    date '2026-05-01',
    date '2026-06-05',
    lpad((90000 + substring(employees.employee_no from 6)::int)::text, 5, '0'),
    42000,
    4200,
    2700,
    37800,
    'SEED: 五月薪資單測試',
    'released',
    now() - interval '1 hour',
    (select releasers.id from releasers where releasers.company_id = employees.company_id limit 1)
  from employees
  join payroll on payroll.company_id = employees.company_id and payroll.branch_id = employees.primary_branch_id
  on conflict (employee_id, payroll_month) do update set
    payroll_record_id = excluded.payroll_record_id,
    gross_pay_total = excluded.gross_pay_total,
    deduction_total = excluded.deduction_total,
    employer_cost_total = excluded.employer_cost_total,
    net_pay_total = excluded.net_pay_total,
    remark = excluded.remark,
    status = excluded.status,
    released_at = excluded.released_at,
    released_by = excluded.released_by
  returning *
)
insert into public.payroll_items (payroll_record_id, payroll_payslip_id, employee_id, item_type, item_code, item_name, quantity, unit_amount, amount, taxable, metadata)
select payroll_record_id, id, employee_id, item.item_type, item.item_code, item.item_name, item.quantity, item.unit_amount, item.amount, item.taxable, '{"seed":true}'::jsonb
from payslips
cross join (
  values
    ('earning','BASE','本薪',1,42000,42000,true),
    ('earning','OT','加班費',2,240,480,true),
    ('deduction','LABOR_INS','勞保自付',1,1050,-1050,false),
    ('deduction','HEALTH_INS','健保自付',1,651,-651,false),
    ('tax','INCOME_TAX','所得稅',1,2500,-2500,false),
    ('employer_cost','PENSION','勞退公司提繳',1,2520,2520,false)
) as item(item_type, item_code, item_name, quantity, unit_amount, amount, taxable);

delete from public.licenses where note like 'SEED:%';
delete from public.training_records where course_code like 'SEED-%';

with employees as (
  select * from public.employees where employee_no between 'DEMO-008' and 'DEMO-037'
), verifiers as (
  select users.id, users.company_id
  from public.users
  join public.employees on employees.id = users.employee_id
  where employees.employee_no in ('DEMO-004','DEMO-005')
)
insert into public.licenses (company_id, employee_id, license_type, license_name, license_no, issuing_authority, issued_at, expires_at, reminder_days, attachment_status, verified_by, verified_at, status, note)
select
  employees.company_id,
  employees.id,
  case when employees.metadata ->> 'employee_group' = 'homecare_worker' then 'long_term_care_card' else 'care_worker_certificate' end,
  case when employees.metadata ->> 'employee_group' = 'homecare_worker' then '長照小卡' else '照顧服務員證明' end,
  'LIC-' || employees.employee_no,
  '衛生福利部',
  date '2024-06-01',
  case when employees.employee_no in ('DEMO-008','DEMO-009','DEMO-028') then date '2026-06-15' else date '2027-12-31' end,
  45,
  'verified',
  (select verifiers.id from verifiers where verifiers.company_id = employees.company_id limit 1),
  now() - interval '5 days',
  case when employees.employee_no in ('DEMO-008','DEMO-009','DEMO-028') then 'expiring' else 'active' end,
  'SEED: license expiry test data'
from employees;

with employees as (
  select * from public.employees where employee_no between 'DEMO-008' and 'DEMO-037'
)
insert into public.training_records (company_id, employee_id, branch_id, department_id, course_code, course_name, provider, instructor, training_type, started_at, completed_at, class_date, hours, attendees, attendance_status, score, status)
select
  employees.company_id,
  employees.id,
  employees.primary_branch_id,
  employees.primary_department_id,
  'SEED-LTC-2026-' || right(employees.employee_no, 3),
  case when employees.metadata ->> 'employee_group' = 'homecare_worker' then '居服員年度長照服務訓練' else '日照中心感染管制與安全訓練' end,
  'HRIS 測試訓練中心',
  '測試講師',
  case when employees.metadata ->> 'employee_group' = 'homecare_worker' then 'long_term_care_professional' else 'infection_control' end,
  timestamptz '2026-05-10 09:00+08',
  timestamptz '2026-05-10 16:00+08',
  date '2026-05-10',
  6,
  jsonb_build_array(jsonb_build_object('employee_no', employees.employee_no, 'signed', true)),
  'signed',
  85 + (substring(employees.employee_no from 6)::int % 10),
  'completed'
from employees;

delete from public.report_export_batches where report_key like 'seed_%';

with companies as (
  select * from public.companies where code in ('DEMO-A','DEMO-B','DEMO-C')
), requesters as (
  select users.id, users.company_id
  from public.users
  join public.employees on employees.id = users.employee_id
  where employees.employee_no in ('DEMO-004','DEMO-005','DEMO-007')
)
insert into public.report_export_batches (company_id, report_key, report_name, filters, sort_by, format, record_count, storage_path, status, requested_by, completed_at)
select
  companies.id,
  report.report_key,
  report.report_name,
  report.filters::jsonb,
  report.sort_by,
  report.format,
  report.record_count,
  'reports/seed/' || companies.code || '/' || report.report_key || '.xlsx',
  'completed',
  (select requesters.id from requesters where requesters.company_id = companies.id limit 1),
  now() - interval '30 minutes'
from companies
cross join (
  values
    ('seed_employee_roster','SEED 員工名冊','{"date":"2026-05-18"}','employee_no','excel',80),
    ('seed_attendance_exception','SEED 出勤異常清單','{"from":"2026-05-13","to":"2026-05-19"}','work_date','excel',3),
    ('seed_payroll_roster','SEED 薪資清冊','{"payroll_month":"2026-05"}','department','csv',12)
) as report(report_key, report_name, filters, sort_by, format, record_count);

delete from public.hris_test_cases where case_key like 'seed_%';

with employee_refs as (
  select employees.id, employees.company_id, employees.employee_no
  from public.employees
  where employees.employee_no in ('DEMO-010','DEMO-013','DEMO-015','DEMO-017','DEMO-018','DEMO-020','DEMO-006','DEMO-008','DEMO-028','DEMO-004')
), company_ref as (
  select id from public.companies where code = 'DEMO-A'
)
insert into public.hris_test_cases (case_key, case_name, case_type, company_id, employee_id, scenario, expected_result, status)
values
  ('seed_attendance_punch', '打卡：正常與遲到早退自動標記', 'attendance', (select id from company_ref), (select id from employee_refs where employee_no = 'DEMO-010'), '{"steps":["員工上班打卡","員工下班打卡","系統比對班表"],"data":"attendance_records"}', '{"expected":"DEMO-010 顯示 late，DEMO-012 顯示 early_leave，其餘正常"}', 'ready'),
  ('seed_leave_request', '請假：特休核准與病假待簽', 'leave', (select id from company_ref), (select id from employee_refs where employee_no = 'DEMO-013'), '{"steps":["員工送出請假","主管簽核","人資確認"],"data":"leave_requests"}', '{"expected":"特休為 approved，病假為 pending"}', 'ready'),
  ('seed_overtime_request', '加班：平日與休息日加班', 'overtime', (select id from company_ref), (select id from employee_refs where employee_no = 'DEMO-015'), '{"steps":["送出加班申請","依日期判斷加班類型","簽核"],"data":"overtime_requests"}', '{"expected":"weekday approved，rest_day pending"}', 'ready'),
  ('seed_punch_correction', '補卡：補上班卡與上下班補卡', 'punch_correction', (select id from company_ref), (select id from employee_refs where employee_no = 'DEMO-017'), '{"steps":["員工補卡","主管核准","人資回寫出勤"],"data":"punch_correction_requests"}', '{"expected":"DEMO-017 approved，DEMO-018 pending"}', 'ready'),
  ('seed_schedule_calendar', '排班：月排班與班別顯示', 'schedule', (select id from company_ref), (select id from employee_refs where employee_no = 'DEMO-018'), '{"steps":["開啟排班月曆","檢查 2026-05-13 至 2026-05-19"],"data":"schedules"}', '{"expected":"前 40 位員工具有日班排班資料"}', 'ready'),
  ('seed_shift_change', '換班：員工發起換班並保留原始紀錄', 'shift_change', (select id from company_ref), (select id from employee_refs where employee_no = 'DEMO-020'), '{"requester":"DEMO-020","target":"DEMO-021","original_date":"2026-05-18","target_date":"2026-05-19","steps":["員工發起","對方同意","主管審核","人資確認"]}', '{"expected":"正式換班表尚未建立前，使用 hris_test_cases 驗證流程與通知"}', 'ready'),
  ('seed_payroll_closing', '薪資結算：五月薪資草稿與薪資單發布', 'payroll_closing', (select id from company_ref), (select id from employee_refs where employee_no = 'DEMO-006'), '{"steps":["同步出勤","產生薪資草稿","會計檢查","發布薪資單"],"data":["payroll_records","payroll_payslips","payroll_items"]}', '{"expected":"6 個據點有 payroll_records，前 12 位員工有 released payslip"}', 'ready'),
  ('seed_license_expiry', '證照到期：長照小卡與照服證即將到期', 'license_expiry', (select id from company_ref), (select id from employee_refs where employee_no = 'DEMO-008'), '{"steps":["查詢 45 天內到期證照","發送提醒"],"data":"licenses"}', '{"expected":"DEMO-008、DEMO-009、DEMO-028 為 expiring"}', 'ready'),
  ('seed_training_record', '教育訓練：年度訓練時數與簽到成績', 'training', (select id from company_ref), (select id from employee_refs where employee_no = 'DEMO-028'), '{"steps":["查詢課程","檢查簽到","彙總年度時數"],"data":"training_records"}', '{"expected":"居服員與日照人員各有 6 小時 completed 訓練"}', 'ready'),
  ('seed_report_export', '報表匯出：員工名冊、出勤異常、薪資清冊', 'report_export', (select id from company_ref), (select id from employee_refs where employee_no = 'DEMO-004'), '{"steps":["選擇報表","套用篩選","匯出 Excel/CSV"],"data":"report_export_batches"}', '{"expected":"每家公司各有 3 筆 completed report_export_batches"}', 'ready')
on conflict (case_key) do update set
  case_name = excluded.case_name,
  case_type = excluded.case_type,
  company_id = excluded.company_id,
  employee_id = excluded.employee_id,
  scenario = excluded.scenario,
  expected_result = excluded.expected_result,
  status = excluded.status;

select
  'HRIS seed summary' as summary,
  (select count(*) from public.companies where code like 'DEMO-%') as companies,
  (select count(*) from public.branches where code in ('A-HQ','A-HC','B-HQ','B-HC','C-HQ','C-DC')) as branches,
  (select count(*) from public.departments join public.companies on companies.id = departments.company_id where companies.code like 'DEMO-%') as departments,
  (select count(*) from public.employees where employee_no like 'DEMO-%') as employees,
  (select count(*) from public.employees where metadata ->> 'employee_group' = 'homecare_worker') as homecare_workers,
  (select count(*) from public.employees where metadata ->> 'employee_group' = 'daycare_staff') as daycare_staff,
  (select count(*) from public.employees where metadata ->> 'employee_group' = 'manager') as managers,
  (select count(*) from public.employees where metadata ->> 'employee_group' = 'hr') as hr_staff,
  (select count(*) from public.employees where metadata ->> 'employee_group' = 'accountant') as accountants,
  (select count(*) from public.employees where metadata ->> 'employee_group' = 'system_admin') as system_admins,
  (select count(*) from public.hris_test_cases where case_key like 'seed_%') as test_cases;
