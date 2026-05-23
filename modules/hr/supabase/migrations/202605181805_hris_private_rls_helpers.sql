create schema if not exists private;

revoke all on schema private from public;
grant usage on schema private to authenticated;

create or replace function private.current_employee_id()
returns uuid
language sql
stable
security definer
set search_path = public, auth
as $$
  select employee_id
  from public.users
  where auth_user_id = auth.uid()
    and status = 'active'
    and deleted_at is null
  limit 1;
$$;

create or replace function private.current_role_key()
returns text
language sql
stable
security definer
set search_path = public, auth
as $$
  select r.key
  from public.users u
  join public.roles r on r.id = u.role_id
  where u.auth_user_id = auth.uid()
    and u.status = 'active'
    and u.deleted_at is null
  limit 1;
$$;

create or replace function private.current_company_id()
returns uuid
language sql
stable
security definer
set search_path = public, auth
as $$
  select company_id
  from public.users
  where auth_user_id = auth.uid()
    and status = 'active'
    and deleted_at is null
  limit 1;
$$;

create or replace function private.is_hr_admin()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select coalesce(
    private.current_role_key() in (
      'super_admin',
      'company_admin',
      'hr_manager',
      'hr_staff',
      'accountant',
      'admin_director',
      'ceo',
      'hr'
    ),
    false
  );
$$;

revoke all on function private.current_employee_id() from public, anon;
revoke all on function private.current_role_key() from public, anon;
revoke all on function private.current_company_id() from public, anon;
revoke all on function private.is_hr_admin() from public, anon;
grant execute on function private.current_employee_id() to authenticated;
grant execute on function private.current_role_key() to authenticated;
grant execute on function private.current_company_id() to authenticated;
grant execute on function private.is_hr_admin() to authenticated;

do $$
declare
  p record;
  using_expr text;
  check_expr text;
  create_sql text;
begin
  for p in
    select schemaname, tablename, policyname, cmd, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and (
        coalesce(qual, '') like '%current_employee_id()%'
        or coalesce(qual, '') like '%current_company_id()%'
        or coalesce(qual, '') like '%current_role_key()%'
        or coalesce(qual, '') like '%is_hr_admin()%'
        or coalesce(with_check, '') like '%current_employee_id()%'
        or coalesce(with_check, '') like '%current_company_id()%'
        or coalesce(with_check, '') like '%current_role_key()%'
        or coalesce(with_check, '') like '%is_hr_admin()%'
      )
  loop
    using_expr := replace(replace(replace(replace(p.qual,
      'current_employee_id()', 'private.current_employee_id()'),
      'current_company_id()', 'private.current_company_id()'),
      'current_role_key()', 'private.current_role_key()'),
      'is_hr_admin()', 'private.is_hr_admin()');

    check_expr := replace(replace(replace(replace(p.with_check,
      'current_employee_id()', 'private.current_employee_id()'),
      'current_company_id()', 'private.current_company_id()'),
      'current_role_key()', 'private.current_role_key()'),
      'is_hr_admin()', 'private.is_hr_admin()');

    execute format('drop policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);

    create_sql := format(
      'create policy %I on %I.%I for %s to authenticated',
      p.policyname,
      p.schemaname,
      p.tablename,
      lower(p.cmd)
    );

    if using_expr is not null then
      create_sql := create_sql || ' using (' || using_expr || ')';
    end if;

    if check_expr is not null then
      create_sql := create_sql || ' with check (' || check_expr || ')';
    end if;

    execute create_sql;
  end loop;
end $$;

drop function if exists public.is_hr_admin();
drop function if exists public.current_company_id();
drop function if exists public.current_role_key();
drop function if exists public.current_employee_id();
