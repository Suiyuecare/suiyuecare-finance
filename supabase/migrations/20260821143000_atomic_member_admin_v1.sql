-- Atomic member administration v1.
--
-- This migration is intentionally non-rerunnable.  The column, trigger and RPC
-- are installed as one forward-only release so a member can never be saved as
-- three unrelated browser writes (profile, Google login reservation, runtime).

set lock_timeout = '5s';
set statement_timeout = '60s';

do $preflight$
begin
  if to_regclass('public.finance_users') is null
     or to_regclass('public.employee_department_roles') is null
     or to_regclass('public.finance_department_units') is null
     or to_regclass('public.finance_department_entity_scopes') is null then
    raise exception 'Atomic member administration prerequisites are missing';
  end if;

  if to_regprocedure('public.finance_admin_save_user_google_login_v2(text,text,bigint)') is null
     or to_regprocedure('public.sync_finance_user_permission_runtime(text,text)') is null then
    raise exception 'Google reservation or permission runtime prerequisite is missing';
  end if;

  if encode(extensions.digest(
       pg_get_functiondef('public.finance_admin_save_user_google_login_v2(text,text,bigint)'::regprocedure),
       'sha256'
     ), 'hex') <> '9898abc1966d39560c53f16fee8ccd92c4a04ed1b1f9a2aa6cda65c6b421cc2d'
     or encode(extensions.digest(
       pg_get_functiondef('public.sync_finance_user_permission_runtime(text,text)'::regprocedure),
       'sha256'
     ), 'hex') <> '7fbb60bccf0822028d4606ef2ca91603f92194715ffa3d979653d159be9c7b77' then
    raise exception 'Atomic member administration prerequisite definitions changed; review before applying';
  end if;

  if exists (
    select lower(btrim(user_row.pending_login_email))
    from public.finance_users user_row
    where user_row.pending_login_email is not null
    group by lower(btrim(user_row.pending_login_email))
    having count(*) > 1
  ) then
    raise exception 'Duplicate pending Google login reservations must be resolved before applying';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_attribute
    where attrelid = 'public.finance_users'::regclass
      and attname = 'member_revision'
      and not attisdropped
  ) or to_regprocedure('public.finance_admin_upsert_member_atomic_v1(jsonb,bigint)') is not null then
    raise exception 'Atomic member administration v1 is already installed';
  end if;
end;
$preflight$;

alter table public.finance_users
  add column member_revision bigint not null default 1;

alter table public.finance_users
  add constraint finance_users_member_revision_positive_v1
  check (member_revision > 0);

create or replace function private.finance_bump_member_revision_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if tg_op = 'INSERT' then
    new.member_revision := 1;
  elsif new is distinct from old then
    if old.member_revision = 9223372036854775807 then
      raise exception 'Member revision exhausted for finance user %', old.id
        using errcode = '54000';
    end if;
    new.member_revision := old.member_revision + 1;
  end if;
  return new;
end;
$function$;

alter function private.finance_bump_member_revision_v1() owner to postgres;
revoke all on function private.finance_bump_member_revision_v1() from public, anon, authenticated, service_role;

create trigger finance_users_member_revision_v1
before insert or update on public.finance_users
for each row execute function private.finance_bump_member_revision_v1();

create unique index finance_users_pending_login_email_unique_v1
  on public.finance_users (lower(btrim(pending_login_email)))
  where pending_login_email is not null;

do $roles$
begin
  alter table public.finance_users drop constraint finance_users_role_check;
  alter table public.finance_users
    add constraint finance_users_role_check
    check (role = any (array[
      'employee'::text,
      'section_chief'::text,
      'dept_manager'::text,
      'admin_director'::text,
      'general_affairs'::text,
      'hr'::text,
      'accountant'::text,
      'cashier'::text,
      'ceo'::text,
      'external_audit'::text,
      'board'::text,
      'shareholder'::text
    ]));
end;
$roles$;

create table private.finance_member_admin_events_v1 (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on update cascade on delete restrict,
  finance_user_id text not null references public.finance_users(id) on update cascade on delete restrict,
  action text not null check (action in ('create', 'update', 'activate')),
  actor_finance_user_id text not null,
  actor_auth_user_id uuid not null,
  before_state jsonb not null default '{}'::jsonb,
  after_state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp()
);

create index finance_member_admin_events_v1_tenant_target_created_idx
  on private.finance_member_admin_events_v1 (tenant_id, finance_user_id, created_at desc);

alter table private.finance_member_admin_events_v1 owner to postgres;
revoke all on table private.finance_member_admin_events_v1 from public, anon, authenticated, service_role;

create or replace function public.finance_admin_upsert_member_atomic_v1(
  p_member jsonb,
  p_expected_revision bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_actor_id text := public.current_finance_user_id();
  v_actor_role text := public.current_finance_role();
  v_actor_auth_user_id uuid := auth.uid();
  v_target public.finance_users%rowtype;
  v_after public.finance_users%rowtype;
  v_existing boolean := false;
  v_finance_user_id text := nullif(btrim(coalesce(p_member ->> 'id', '')), '');
  v_name text := btrim(coalesce(p_member ->> 'name', ''));
  v_requested_email text := lower(btrim(coalesce(p_member ->> 'login_email', p_member ->> 'email', '')));
  v_contact_email text := lower(btrim(coalesce(p_member ->> 'contact_email', '')));
  v_job_title text := nullif(btrim(coalesce(p_member ->> 'job_title', '')), '');
  v_extension text := nullif(btrim(coalesce(p_member ->> 'extension', '')), '');
  v_role text := lower(btrim(coalesce(p_member ->> 'role', 'employee')));
  v_role_label text;
  v_entity_code text := upper(btrim(coalesce(p_member ->> 'entity_id', '')));
  v_department_code text := upper(btrim(coalesce(p_member ->> 'department_code', '')));
  v_active boolean := coalesce((p_member ->> 'active')::boolean, true);
  v_google_result jsonb := '{}'::jsonb;
  v_runtime_result jsonb := '{}'::jsonb;
  v_action text;
  v_before jsonb := '{}'::jsonb;
begin
  if v_actor_auth_user_id is null
     or v_tenant_id is null
     or nullif(v_actor_id, '') is null
     or v_actor_role not in ('ceo', 'admin_director', 'hr') then
    raise exception '只有執行長、行政部門主任或人資可以維護人員。'
      using errcode = '42501';
  end if;

  if jsonb_typeof(p_member) is distinct from 'object' then
    raise exception '人員資料格式不正確。' using errcode = '22023';
  end if;

  if v_name = '' or char_length(v_name) > 120 then
    raise exception '請填寫 1 至 120 字的姓名。' using errcode = '22023';
  end if;
  if v_requested_email !~ '^[^@[:space:]]+@suiyuecare[.]com$' then
    raise exception '請填寫本人實際使用的公司 Google Workspace 信箱。'
      using errcode = '22023';
  end if;
  if v_contact_email = '' then
    v_contact_email := v_requested_email;
  elsif v_contact_email !~ '^[^@[:space:]]+@suiyuecare[.]com$' then
    raise exception '組織圖聯絡信箱必須是公司信箱。' using errcode = '22023';
  end if;
  if v_extension is not null and v_extension !~ '^[0-9A-Za-z#*+-]{1,20}$' then
    raise exception '分機格式不正確。' using errcode = '22023';
  end if;
  if v_role not in (
    'employee', 'section_chief', 'dept_manager', 'admin_director',
    'general_affairs', 'hr', 'accountant', 'cashier', 'ceo',
    'external_audit', 'board', 'shareholder'
  ) then
    raise exception '系統權限角色不正確。' using errcode = '22023';
  end if;

  if v_actor_role = 'hr'
     and v_role in ('ceo', 'admin_director', 'accountant', 'cashier', 'external_audit', 'board', 'shareholder') then
    raise exception '人資不能自行授予財務控制、董事會、股東或執行長權限。'
      using errcode = '42501';
  end if;

  if v_entity_code = '' or v_department_code = '' then
    raise exception '公司別與部門都必須選擇。' using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.finance_department_units unit_row
    join public.finance_department_entity_scopes scope_row
      on scope_row.tenant_id = unit_row.tenant_id
     and scope_row.unit_id = unit_row.id
     and scope_row.active = true
     and scope_row.entity_code = v_entity_code
    where unit_row.tenant_id = v_tenant_id
      and unit_row.code = v_department_code
      and unit_row.active = true
      and unit_row.present_in_source = true
  ) then
    raise exception '所選部門未啟用、已不屬於該公司，或尚未正式發布。'
      using errcode = '23514';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('finance-member-admin:' || v_tenant_id::text, 20260821)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('finance-google-email:' || v_requested_email, 20260804)
  );

  if v_finance_user_id is not null then
    select fu.* into v_target
    from public.finance_users fu
    where fu.tenant_id = v_tenant_id
      and fu.id = v_finance_user_id
    for update;
    if not found then
      raise exception '找不到目前租戶的人員資料。' using errcode = 'P0002';
    end if;
    v_existing := true;
    v_before := jsonb_build_object(
      'name', v_target.name,
      'login_email', v_target.email,
      'pending_login_email', v_target.pending_login_email,
      'contact_email', v_target.org_contact_email,
      'job_title', v_target.job_title,
      'extension', v_target.extension,
      'role', v_target.role,
      'entity_id', v_target.entity_id,
      'department_code', v_target.department_code,
      'active', v_target.active,
      'member_revision', v_target.member_revision
    );

    if p_expected_revision is null or p_expected_revision <> v_target.member_revision then
      raise exception '人員資料已由其他人更新，請重新整理後再儲存。'
        using errcode = '40001';
    end if;
    if v_actor_role = 'hr'
       and v_target.role in ('ceo', 'admin_director', 'accountant', 'cashier', 'external_audit', 'board', 'shareholder') then
      raise exception '人資不能修改財務控制、董事會、股東或執行長帳號。'
        using errcode = '42501';
    end if;
    if not v_active and coalesce(v_target.active, false) then
      raise exception '停用人員必須使用離職交接流程，不能在一般編輯中直接停用。'
        using errcode = '23514';
    end if;
  else
    if coalesce(p_expected_revision, 0) <> 0 then
      raise exception '新增人員的版本必須為 0。' using errcode = '40001';
    end if;
    if not v_active then
      raise exception '新建人員必須先設為啟用。' using errcode = '23514';
    end if;
    v_finance_user_id := 'u_' || replace(gen_random_uuid()::text, '-', '');
  end if;

  if exists (
    select 1
    from public.finance_users other
    where other.id <> v_finance_user_id
      and other.active = true
      and (
        lower(btrim(other.email)) = v_requested_email
        or lower(btrim(coalesce(other.pending_login_email, ''))) = v_requested_email
      )
  ) then
    raise exception '這個 Google 主帳號已由其他啟用中的人員使用或保留。'
      using errcode = '23505';
  end if;

  v_role_label := case v_role
    when 'employee' then '一般組員'
    when 'section_chief' then '課長'
    when 'dept_manager' then '部門主管'
    when 'admin_director' then '行政部門主任'
    when 'general_affairs' then '總務'
    when 'hr' then '人資'
    when 'accountant' then '會計'
    when 'cashier' then '出納'
    when 'ceo' then '執行長'
    when 'external_audit' then '外部檢核單位'
    when 'board' then '董事會'
    when 'shareholder' then '股東'
    else v_role
  end;

  if v_existing then
    update public.finance_users fu
    set name = v_name,
        role = v_role,
        role_label = v_role_label,
        entity_id = v_entity_code,
        department_code = v_department_code,
        init = substr(v_name, 1, 1),
        active = v_active,
        job_title = v_job_title,
        extension = v_extension,
        org_contact_email = v_contact_email,
        org_status = case when v_active then 'active' else 'inactive' end,
        org_source = 'atomic_member_admin_v1',
        org_source_updated_at = clock_timestamp()
    where fu.tenant_id = v_tenant_id
      and fu.id = v_finance_user_id
      and fu.member_revision = p_expected_revision;
    if not found then
      raise exception '人員資料已由其他人更新，請重新整理後再儲存。'
        using errcode = '40001';
    end if;
    v_action := case when not coalesce(v_target.active, false) and v_active then 'activate' else 'update' end;
  else
    insert into public.finance_users (
      id, tenant_id, name, email, role, role_label, entity_id,
      department_code, init, active, job_title, extension,
      org_contact_email, org_status, org_source, org_source_updated_at,
      google_link_status, pending_login_email, google_link_revision,
      google_link_status_detail
    ) values (
      v_finance_user_id, v_tenant_id, v_name, v_requested_email, v_role,
      v_role_label, v_entity_code, v_department_code, substr(v_name, 1, 1),
      true, v_job_title, v_extension, v_contact_email, 'active',
      'atomic_member_admin_v1', clock_timestamp(), 'pending_first_login',
      null, 0, '等待本人首次使用指定的公司 Google 主帳號登入。'
    );
    v_action := 'create';
  end if;

  select fu.* into v_after
  from public.finance_users fu
  where fu.tenant_id = v_tenant_id and fu.id = v_finance_user_id
  for update;

  if (not v_existing)
     or v_requested_email <> lower(btrim(v_after.email))
     or (
       v_after.pending_login_email is not null
       and v_requested_email <> lower(btrim(v_after.pending_login_email))
     ) then
    v_google_result := public.finance_admin_save_user_google_login_v2(
      v_finance_user_id,
      v_requested_email,
      v_after.google_link_revision
    );
    if coalesce((v_google_result ->> 'ok')::boolean, false) is not true then
      raise exception 'Google 登入信箱預留沒有完成，這次人員資料不會儲存。'
        using errcode = '55000';
    end if;
  else
    v_google_result := jsonb_build_object(
      'ok', true,
      'status', v_after.google_link_status,
      'current_login_email', v_after.email,
      'pending_login_email', v_after.pending_login_email,
      'revision', v_after.google_link_revision,
      'next_action', case
        when v_after.google_link_status = 'pending_first_login' then '請本人使用指定的公司 Google 主帳號登入一次。'
        when v_after.google_link_status = 'pending_rebind' then '原帳號仍可使用；請本人改用新公司 Google 主帳號登入一次。'
        else '不需其他處理。'
      end
    );
  end if;

  v_runtime_result := public.sync_finance_user_permission_runtime(
    v_finance_user_id,
    case v_action
      when 'create' then 'atomic_member_admin_create_v1'
      when 'activate' then 'atomic_member_admin_activate_v1'
      else 'atomic_member_admin_update_v1'
    end
  );

  if not exists (
    select 1
    from public.employee_department_roles edr
    where edr.tenant_id = v_tenant_id
      and edr.finance_user_id = v_finance_user_id
      and edr.is_primary = true
      and edr.active = v_active
      and edr.department_code = v_department_code
      and edr.role_key = v_role
  ) then
    raise exception '人員資料已寫入但簽核角色沒有同步；整筆變更已回復。'
      using errcode = '55000';
  end if;

  select fu.* into v_after
  from public.finance_users fu
  where fu.tenant_id = v_tenant_id and fu.id = v_finance_user_id;

  insert into private.finance_member_admin_events_v1 (
    tenant_id, finance_user_id, action, actor_finance_user_id,
    actor_auth_user_id, before_state, after_state
  ) values (
    v_tenant_id, v_finance_user_id, v_action, v_actor_id,
    v_actor_auth_user_id, v_before,
    jsonb_build_object(
      'name', v_after.name,
      'login_email', v_after.email,
      'pending_login_email', v_after.pending_login_email,
      'contact_email', v_after.org_contact_email,
      'job_title', v_after.job_title,
      'extension', v_after.extension,
      'role', v_after.role,
      'entity_id', v_after.entity_id,
      'department_code', v_after.department_code,
      'active', v_after.active,
      'member_revision', v_after.member_revision,
      'google_link_status', v_after.google_link_status
    )
  );

  return jsonb_build_object(
    'ok', true,
    'atomic', true,
    'action', v_action,
    'member', jsonb_build_object(
      'id', v_after.id,
      'tenant_id', v_after.tenant_id,
      'name', v_after.name,
      'email', v_after.email,
      'pending_login_email', v_after.pending_login_email,
      'role', v_after.role,
      'role_label', v_after.role_label,
      'entity_id', v_after.entity_id,
      'department_code', v_after.department_code,
      'init', v_after.init,
      'active', v_after.active,
      'job_title', v_after.job_title,
      'extension', v_after.extension,
      'org_contact_email', v_after.org_contact_email,
      'org_status', v_after.org_status,
      'auth_user_id', v_after.auth_user_id,
      'google_link_status', v_after.google_link_status,
      'google_link_revision', v_after.google_link_revision,
      'google_link_status_detail', v_after.google_link_status_detail,
      'member_revision', v_after.member_revision
    ),
    'login', v_google_result,
    'permission_runtime', v_runtime_result,
    'saved_at', clock_timestamp()
  );
end;
$function$;

alter function public.finance_admin_upsert_member_atomic_v1(jsonb, bigint) owner to postgres;
revoke all on function public.finance_admin_upsert_member_atomic_v1(jsonb, bigint) from public, anon, authenticated;
grant execute on function public.finance_admin_upsert_member_atomic_v1(jsonb, bigint) to authenticated, service_role;

do $postflight$
declare
  v_count integer;
  v_oid oid;
begin
  if encode(extensions.digest(
       pg_get_functiondef('public.finance_admin_save_user_google_login_v2(text,text,bigint)'::regprocedure),
       'sha256'
     ), 'hex') <> '9898abc1966d39560c53f16fee8ccd92c4a04ed1b1f9a2aa6cda65c6b421cc2d'
     or encode(extensions.digest(
       pg_get_functiondef('public.sync_finance_user_permission_runtime(text,text)'::regprocedure),
       'sha256'
     ), 'hex') <> '7fbb60bccf0822028d4606ef2ca91603f92194715ffa3d979653d159be9c7b77' then
    raise exception 'Atomic member administration changed prerequisite definitions';
  end if;
  select count(*), min(p.oid)
    into v_count, v_oid
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'finance_admin_upsert_member_atomic_v1';
  if v_count <> 1
     or v_oid <> 'public.finance_admin_upsert_member_atomic_v1(jsonb,bigint)'::regprocedure then
    raise exception 'Atomic member RPC identity postflight failed';
  end if;
  if not (select p.prosecdef from pg_catalog.pg_proc p where p.oid = v_oid)
     or coalesce((select p.proconfig from pg_catalog.pg_proc p where p.oid = v_oid), '{}'::text[])
        <> array['search_path=""']::text[] then
    raise exception 'Atomic member RPC security postflight failed';
  end if;
  if has_function_privilege('anon', v_oid, 'EXECUTE')
     or exists (
       select 1
       from pg_catalog.aclexplode(coalesce((select p.proacl from pg_catalog.pg_proc p where p.oid = v_oid), acldefault('f', (select p.proowner from pg_catalog.pg_proc p where p.oid = v_oid)))) acl
       where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
     )
     or not has_function_privilege('authenticated', v_oid, 'EXECUTE')
     or not has_function_privilege('service_role', v_oid, 'EXECUTE') then
    raise exception 'Atomic member RPC ACL postflight failed';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_trigger t
    where t.tgrelid = 'public.finance_users'::regclass
      and t.tgname = 'finance_users_member_revision_v1'
      and t.tgenabled = 'O'
      and t.tgtype = 23
      and t.tgqual is null
  ) then
    raise exception 'Member revision trigger postflight failed';
  end if;
end;
$postflight$;

notify pgrst, 'reload schema';
