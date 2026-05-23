-- Shared core bridge for Finance OS + HRIS.
-- Apply this to the Finance Supabase project (udtlppnrugmtzhigdsxo).
-- It keeps HR identity/organization tables synced from finance system_settings and finance_users.

create extension if not exists pgcrypto;

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  legal_name text,
  tax_id text unique,
  industry text not null default 'long_term_care',
  phone text,
  email text,
  address jsonb not null default '{}'::jsonb,
  timezone text not null default 'Asia/Taipei',
  status text not null default 'active' check (status in ('active','inactive','suspended')),
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.branches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  parent_branch_id uuid references public.branches(id),
  code text not null,
  name text not null,
  branch_type text not null default 'headquarters'
    check (branch_type in ('headquarters','branch','site','homecare_station','daycare_center')),
  phone text,
  email text,
  address jsonb not null default '{}'::jsonb,
  geo_location jsonb not null default '{}'::jsonb,
  status text not null default 'active' check (status in ('active','inactive','closed')),
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique(company_id, code)
);

create table if not exists public.departments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  branch_id uuid references public.branches(id),
  parent_department_id uuid references public.departments(id),
  code text not null,
  name text not null,
  department_type text not null default 'administration'
    check (department_type in ('administration','hr','finance','homecare','daycare','operations','support')),
  status text not null default 'active' check (status in ('active','inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique(company_id, code)
);

create table if not exists public.positions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  department_id uuid references public.departments(id),
  code text not null,
  title text not null,
  level text,
  employment_type text not null default 'full_time'
    check (employment_type in ('full_time','part_time','contract','intern','temporary')),
  is_manager boolean not null default false,
  status text not null default 'active' check (status in ('active','inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique(company_id, code)
);

create table if not exists public.roles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  key text not null,
  name text not null,
  description text,
  permissions jsonb not null default '[]'::jsonb,
  data_scope text not null default 'self'
    check (data_scope in ('all_companies','company','branch','department','team','self')),
  is_system_role boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique(company_id, key)
);

create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  primary_branch_id uuid references public.branches(id),
  primary_department_id uuid references public.departments(id),
  position_id uuid references public.positions(id),
  manager_employee_id uuid references public.employees(id),
  employee_no text not null,
  full_name text not null,
  preferred_name text,
  phone text,
  email text,
  address jsonb not null default '{}'::jsonb,
  emergency_contact jsonb not null default '{}'::jsonb,
  hire_date date,
  termination_date date,
  employment_status text not null default 'active'
    check (employment_status in ('active','on_leave','suspended','terminated')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique(company_id, employee_no)
);

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete set null,
  company_id uuid references public.companies(id),
  employee_id uuid references public.employees(id),
  role_id uuid references public.roles(id),
  email text not null unique,
  display_name text not null,
  avatar_url text,
  status text not null default 'active' check (status in ('active','invited','disabled')),
  last_sign_in_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create or replace function public.hr_department_type_from_code(code text, name text)
returns text
language sql
immutable
as $$
  select case
    when code like 'A1102%' or name like '%人資%' then 'hr'
    when code like 'A1101%' or name like '%會計%' then 'finance'
    when name like '%居家%' or name like '%到宅%' then 'homecare'
    when name like '%日照%' then 'daycare'
    when name like '%總務%' or name like '%行政%' then 'administration'
    else 'operations'
  end
$$;

create or replace function public.hr_role_scope(role_key text)
returns text
language sql
immutable
as $$
  select case
    when role_key in ('ceo','admin_director','hr','accountant') then 'all_companies'
    when role_key = 'dept_manager' then 'department'
    when role_key = 'section_chief' then 'team'
    else 'self'
  end
$$;

create or replace function public.sync_finance_core_to_hr()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  entity jsonb;
  dept jsonb;
  role_row record;
  user_row record;
  company_uuid uuid;
  branch_uuid uuid;
  department_uuid uuid;
  position_uuid uuid;
  role_uuid uuid;
  employee_uuid uuid;
begin
  for entity in
    select value
    from jsonb_array_elements(coalesce((select value from public.system_settings where key = 'entities'), '[]'::jsonb))
  loop
    insert into public.companies (code, name, legal_name, tax_id, address, settings, updated_at, deleted_at)
    values (
      entity->>'id',
      coalesce(entity->>'s', entity->>'full', entity->>'id'),
      coalesce(entity->>'full', entity->>'s', entity->>'id'),
      nullif(entity->>'taxId', ''),
      jsonb_build_object('full', coalesce(entity->>'address', '')),
      entity,
      now(),
      null
    )
    on conflict (code) do update
    set name = excluded.name,
        legal_name = excluded.legal_name,
        tax_id = excluded.tax_id,
        address = excluded.address,
        settings = excluded.settings,
        status = 'active',
        deleted_at = null,
        updated_at = now();

    select id into company_uuid from public.companies where code = entity->>'id';

    insert into public.branches (company_id, code, name, branch_type, address, updated_at, deleted_at)
    values (
      company_uuid,
      (entity->>'id') || '-HQ',
      coalesce(entity->>'s', entity->>'full', entity->>'id'),
      'headquarters',
      jsonb_build_object('full', coalesce(entity->>'address', '')),
      now(),
      null
    )
    on conflict (company_id, code) do update
    set name = excluded.name,
        address = excluded.address,
        status = 'active',
        deleted_at = null,
        updated_at = now();
  end loop;

  for dept in
    select value
    from jsonb_array_elements(coalesce((select value from public.system_settings where key = 'departments'), '[]'::jsonb))
  loop
    select id into company_uuid from public.companies where code = dept->>'eid';
    if company_uuid is null then
      continue;
    end if;

    select id into branch_uuid
    from public.branches
    where company_id = company_uuid
    order by created_at
    limit 1;

    insert into public.departments (company_id, branch_id, code, name, department_type, updated_at, deleted_at)
    values (
      company_uuid,
      branch_uuid,
      dept->>'c',
      dept->>'n',
      public.hr_department_type_from_code(dept->>'c', dept->>'n'),
      now(),
      null
    )
    on conflict (company_id, code) do update
    set name = excluded.name,
        branch_id = excluded.branch_id,
        department_type = excluded.department_type,
        status = 'active',
        deleted_at = null,
        updated_at = now();
  end loop;

  for role_row in
    select *
    from (values
      ('employee','一般組員'),
      ('section_chief','課長'),
      ('dept_manager','部門主管'),
      ('admin_director','行政部門主任'),
      ('general_affairs','總務'),
      ('hr','人資'),
      ('accountant','會計'),
      ('ceo','執行長')
    ) as roles(key, name)
  loop
    insert into public.roles (company_id, key, name, data_scope, is_system_role, updated_at, deleted_at)
    values (null, role_row.key, role_row.name, public.hr_role_scope(role_row.key), true, now(), null)
    on conflict (company_id, key) do update
    set name = excluded.name,
        data_scope = excluded.data_scope,
        deleted_at = null,
        updated_at = now();
  end loop;

  for user_row in
    select *
    from public.finance_users
    where email is not null
  loop
    select id into company_uuid from public.companies where code = user_row.entity_id;
    if company_uuid is null then
      select id into company_uuid from public.companies order by created_at limit 1;
    end if;

    select id into branch_uuid from public.branches where company_id = company_uuid order by created_at limit 1;
    select id into department_uuid from public.departments where code = user_row.department_code limit 1;
    select id into role_uuid from public.roles where company_id is null and key = user_row.role limit 1;

    insert into public.positions (company_id, department_id, code, title, level, is_manager, updated_at, deleted_at)
    values (
      company_uuid,
      department_uuid,
      coalesce(user_row.role, 'employee'),
      coalesce(user_row.role_label, user_row.role, '一般組員'),
      coalesce(user_row.role_label, user_row.role, '一般組員'),
      user_row.role in ('section_chief','dept_manager','admin_director','hr','accountant','ceo'),
      now(),
      null
    )
    on conflict (company_id, code) do update
    set title = excluded.title,
        level = excluded.level,
        is_manager = excluded.is_manager,
        deleted_at = null,
        updated_at = now()
    returning id into position_uuid;

    insert into public.employees (
      company_id,
      primary_branch_id,
      primary_department_id,
      position_id,
      employee_no,
      full_name,
      preferred_name,
      email,
      employment_status,
      metadata,
      updated_at,
      deleted_at
    )
    values (
      company_uuid,
      branch_uuid,
      department_uuid,
      position_uuid,
      user_row.id,
      user_row.name,
      user_row.name,
      lower(user_row.email),
      case when user_row.active then 'active' else 'terminated' end,
      jsonb_build_object('finance_user_id', user_row.id, 'finance_role', user_row.role),
      now(),
      case when user_row.active then null else now() end
    )
    on conflict (company_id, employee_no) do update
    set primary_branch_id = excluded.primary_branch_id,
        primary_department_id = excluded.primary_department_id,
        position_id = excluded.position_id,
        full_name = excluded.full_name,
        preferred_name = excluded.preferred_name,
        email = excluded.email,
        employment_status = excluded.employment_status,
        metadata = excluded.metadata,
        deleted_at = excluded.deleted_at,
        updated_at = now()
    returning id into employee_uuid;

    insert into public.users (
      auth_user_id,
      company_id,
      employee_id,
      role_id,
      email,
      display_name,
      status,
      updated_at,
      deleted_at
    )
    values (
      (select id from auth.users where lower(email) = lower(user_row.email) limit 1),
      company_uuid,
      employee_uuid,
      role_uuid,
      lower(user_row.email),
      user_row.name,
      case when user_row.active then 'active' else 'disabled' end,
      now(),
      case when user_row.active then null else now() end
    )
    on conflict (email) do update
    set auth_user_id = coalesce(excluded.auth_user_id, public.users.auth_user_id),
        company_id = excluded.company_id,
        employee_id = excluded.employee_id,
        role_id = excluded.role_id,
        display_name = excluded.display_name,
        status = excluded.status,
        deleted_at = excluded.deleted_at,
        updated_at = now();
  end loop;
end;
$$;

create or replace function public.trigger_sync_finance_core_to_hr()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.sync_finance_core_to_hr();
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_sync_hr_core_after_finance_users on public.finance_users;
create trigger trg_sync_hr_core_after_finance_users
after insert or update or delete on public.finance_users
for each statement execute function public.trigger_sync_finance_core_to_hr();

drop trigger if exists trg_sync_hr_core_after_system_settings on public.system_settings;
create trigger trg_sync_hr_core_after_system_settings
after insert or update on public.system_settings
for each row
when (new.key in ('entities','departments'))
execute function public.trigger_sync_finance_core_to_hr();

alter table public.companies enable row level security;
alter table public.branches enable row level security;
alter table public.departments enable row level security;
alter table public.positions enable row level security;
alter table public.roles enable row level security;
alter table public.employees enable row level security;
alter table public.users enable row level security;

grant select on public.companies, public.branches, public.departments, public.positions, public.roles, public.employees, public.users to authenticated;

drop policy if exists "shared core read companies" on public.companies;
create policy "shared core read companies" on public.companies
for select to authenticated
using (deleted_at is null);

drop policy if exists "shared core read branches" on public.branches;
create policy "shared core read branches" on public.branches
for select to authenticated
using (deleted_at is null);

drop policy if exists "shared core read departments" on public.departments;
create policy "shared core read departments" on public.departments
for select to authenticated
using (deleted_at is null);

drop policy if exists "shared core read positions" on public.positions;
create policy "shared core read positions" on public.positions
for select to authenticated
using (deleted_at is null);

drop policy if exists "shared core read roles" on public.roles;
create policy "shared core read roles" on public.roles
for select to authenticated
using (deleted_at is null);

drop policy if exists "shared core read employees" on public.employees;
create policy "shared core read employees" on public.employees
for select to authenticated
using (
  deleted_at is null and (
    lower(email) = lower(auth.jwt() ->> 'email')
    or exists (
      select 1
      from public.finance_users fu
      where lower(fu.email) = lower(auth.jwt() ->> 'email')
        and fu.active = true
        and fu.role in ('hr','admin_director','ceo','accountant')
    )
  )
);

drop policy if exists "shared core read users" on public.users;
create policy "shared core read users" on public.users
for select to authenticated
using (
  deleted_at is null and (
    lower(email) = lower(auth.jwt() ->> 'email')
    or exists (
      select 1
      from public.finance_users fu
      where lower(fu.email) = lower(auth.jwt() ->> 'email')
        and fu.active = true
        and fu.role in ('hr','admin_director','ceo')
    )
  )
);

select public.sync_finance_core_to_hr();
