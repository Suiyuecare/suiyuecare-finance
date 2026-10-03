-- Reliable wrapper and exact-replay live personnel-save canary. Run only after the PT409 conflict migration is
-- deployed, with a privileged SQL connection, and review before execution.
-- It borrows an existing, currently active CEO Google session only as the
-- database's authenticated actor context; it never creates or changes Auth.
-- Both synthetic @suiyuecare.com addresses are deliberately not real mailboxes.
-- Every Finance/HR/portal/outbox/org/audit write is enclosed by ROLLBACK.
-- The Finance -> eDoc wake path uses pg_net; net.http_post does not send until
-- COMMIT (https://supabase.com/docs/guides/database/extensions/pg_net).
-- This proves Finance's source outbox, not delivery to the separate eDoc DB.

begin isolation level read committed;
set local lock_timeout = '10s';
set local statement_timeout = '120s';

do $personnel_save_canary$
declare
  v_tenant uuid := public.default_tenant_id();
  v_actor record;
  v_entity text;
  v_department text;
  v_email_create constant text := 'personnel-save-live-canary-20261003@suiyuecare.com';
  v_email_edit constant text := 'personnel-save-live-canary-edit-20261003@suiyuecare.com';
  v_name_create constant text := '人員儲存回滾驗證甲';
  v_name_edit constant text := '人員儲存回滾驗證乙';
  v_member_id text;
  v_create jsonb;
  v_edit jsonb;
  v_create_request uuid := gen_random_uuid();
  v_edit_request uuid := gen_random_uuid();
  v_replayed jsonb;
  v_mismatch text;
  v_create_revision bigint;
  v_edit_revision bigint;
  v_stale_state text;
  v_before_stale jsonb;
  v_after_stale jsonb;
  v_member_snapshot jsonb;
  v_outbox_revision bigint;
begin
  if pg_catalog.to_regprocedure('public.finance_admin_upsert_member_reliable_v1(jsonb,bigint,uuid)') is null
     or pg_catalog.to_regprocedure('private.finance_wake_edoc_sync_worker_v1()') is null
     or pg_catalog.to_regprocedure('private.finance_edoc_wake_after_outbox_insert_v2()') is null
     or pg_catalog.to_regclass('private.hr_directory_cursor') is null then
    raise exception 'Personnel canary prerequisites are missing';
  end if;
  if pg_catalog.strpos(
       pg_catalog.pg_get_functiondef(
         'private.finance_wake_edoc_sync_worker_v1()'::regprocedure
       ), 'net.http_post'
     ) = 0
     or pg_catalog.strpos(
       pg_catalog.pg_get_functiondef(
         'private.finance_edoc_wake_after_outbox_insert_v2()'::regprocedure
       ), 'private.finance_wake_edoc_sync_worker_v1'
     ) = 0 then
    raise exception 'eDoc wake no longer follows the post-commit pg_net path';
  end if;

  if exists (
       select 1 from auth.users u
       where lower(pg_catalog.btrim(u.email)) in (v_email_create, v_email_edit)
     )
     or exists (
       select 1 from public.finance_users fu
       where lower(pg_catalog.btrim(fu.email)) in (v_email_create, v_email_edit)
          or lower(pg_catalog.btrim(coalesce(fu.pending_login_email, ''))) in
             (v_email_create, v_email_edit)
          or fu.name in (v_name_create, v_name_edit)
     )
     or exists (
       select 1 from public.employees e
       where lower(pg_catalog.btrim(e.email)) in (v_email_create, v_email_edit)
          or e.full_name in (v_name_create, v_name_edit)
     )
     or exists (
       select 1 from public.users u
       where lower(pg_catalog.btrim(u.email)) in (v_email_create, v_email_edit)
          or u.display_name in (v_name_create, v_name_edit)
     ) then
    raise exception 'Synthetic personnel canary identity already exists; refusing to overwrite';
  end if;

  -- Select the real, current CEO identity and session at execution time. No
  -- real person row is updated, and no session or Auth identity is inserted.
  select fu.id as finance_user_id, fu.auth_user_id, fu.email, s.id as session_id
    into v_actor
  from public.finance_users fu
  join auth.sessions s on s.user_id = fu.auth_user_id
  where fu.tenant_id = v_tenant
    and fu.role = 'ceo'
    and fu.active = true
    and fu.google_link_status in ('bound', 'pending_rebind')
    and lower(pg_catalog.btrim(fu.email)) =
        public.finance_verified_google_email(fu.auth_user_id)
    and (s.not_after is null or s.not_after > pg_catalog.statement_timestamp())
  order by s.created_at desc, s.id
  limit 1;
  if not found then
    raise exception 'No active verified CEO Google session; canary cannot impersonate an authorized actor';
  end if;

  select scope.entity_code, unit.code
    into v_entity, v_department
  from public.finance_department_units unit
  join public.finance_department_entity_scopes scope
    on scope.tenant_id = unit.tenant_id
   and scope.unit_id = unit.id
  join public.companies company on company.code = scope.entity_code
  where unit.tenant_id = v_tenant
    and unit.active = true
    and unit.present_in_source = true
    and unit.is_posting_unit = true
    and scope.active = true
    and company.deleted_at is null
  order by unit.is_posting_unit desc, scope.entity_code, unit.code
  limit 1;
  if v_entity is null or v_department is null then
    raise exception 'No published company/department scope for personnel canary';
  end if;

  perform pg_catalog.set_config('app.current_tenant_id', v_tenant::text, true);
  perform pg_catalog.set_config('request.jwt.claim.sub', v_actor.auth_user_id::text, true);
  perform pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object(
      'sub', v_actor.auth_user_id,
      'session_id', v_actor.session_id,
      'role', 'authenticated',
      'email', v_actor.email
    )::text,
    true
  );
  execute 'set local role authenticated';
  if auth.uid() is distinct from v_actor.auth_user_id
     or public.current_finance_user_id() is distinct from v_actor.finance_user_id
     or public.current_finance_role() is distinct from 'ceo'
     or public.current_tenant_id() is distinct from v_tenant
     or not public.finance_auth_session_active() then
    raise exception 'CEO actor did not resolve through the normal authenticated guards';
  end if;

  v_create := public.finance_admin_upsert_member_reliable_v1(
    pg_catalog.jsonb_build_object(
      'name', v_name_create,
      'login_email', v_email_create,
      'contact_email', v_email_create,
      'job_title', '回滾驗證',
      'role', 'employee',
      'entity_id', v_entity,
      'department_code', v_department,
      'active', true
    ),
    0, v_create_request
  );
  execute 'reset role';
  if v_create ->> 'action' is distinct from 'create'
     or v_create ->> 'ok' is distinct from 'true'
     or v_create #>> '{member,email}' is distinct from v_email_create then
    raise exception 'Atomic personnel create did not return the expected identity';
  end if;
  execute 'set local role authenticated';
  v_replayed := public.finance_admin_upsert_member_reliable_v1(
    pg_catalog.jsonb_build_object(
      'name', v_name_create, 'login_email', v_email_create,
      'contact_email', v_email_create, 'job_title', '回滾驗證',
      'role', 'employee', 'entity_id', v_entity,
      'department_code', v_department, 'active', true
    ), 0, v_create_request
  );
  execute 'reset role';
  if v_replayed ->> 'replayed' is distinct from 'true'
     or (v_replayed - 'replayed') is distinct from (v_create - 'replayed') then
    raise exception 'Exact request replay did not return the original atomic receipt';
  end if;
  execute 'set local role authenticated';
  begin
    perform public.finance_admin_upsert_member_reliable_v1(
      pg_catalog.jsonb_build_object(
        'name', '不應套用的新內容', 'login_email', v_email_create,
        'contact_email', v_email_create, 'job_title', '回滾驗證',
        'role', 'employee', 'entity_id', v_entity,
        'department_code', v_department, 'active', true
      ), 0, v_create_request
    );
  exception when others then
    v_mismatch := SQLSTATE;
  end;
  execute 'reset role';
  if v_mismatch is distinct from 'PT409' then
    raise exception 'Same request ID with different payload must fail with PT409';
  end if;
  v_member_id := v_create #>> '{member,id}';
  v_create_revision := (v_create #>> '{member,member_revision}')::bigint;
  if nullif(v_member_id, '') is null or v_create_revision < 1 then
    raise exception 'Atomic personnel create omitted ID or revision';
  end if;

  if not exists (
       select 1 from public.employees e
       where e.employee_no = v_member_id
         and e.full_name = v_name_create
         and e.email = v_email_create
         and e.employment_status = 'active'
     )
     or not exists (
       select 1 from public.users u
       join public.employees e on e.id = u.employee_id
       where e.employee_no = v_member_id
         and u.email = v_email_create
         and u.display_name = v_name_create
         and u.status = 'active'
         and u.auth_user_id is null
     )
     or not exists (
       select 1 from public.employee_department_roles edr
       where edr.tenant_id = v_tenant
         and edr.finance_user_id = v_member_id
         and edr.is_primary = true
         and edr.active = true
         and edr.role_key = 'employee'
         and edr.department_code = v_department
     )
     or not exists (
       select 1 from private.finance_edoc_sync_outbox_v1 o
       where o.tenant_id = v_tenant
         and o.aggregate_type = 'member'
         and o.aggregate_id = v_member_id
     ) then
    raise exception 'Create did not project Finance / HR / portal / approval role / eDoc source outbox';
  end if;
  if exists (
       select 1 from public.finance_identity_links l
       where l.tenant_id = v_tenant
         and l.finance_user_id = v_member_id
         and l.active = true
     ) then
    raise exception 'An unverified synthetic login gained an active identity link';
  end if;

  -- Edit the *same synthetic person* to exercise name and unbound Google email
  -- editing. This is intentionally distinct from replacing a departed person.
  execute 'set local role authenticated';
  v_edit := public.finance_admin_upsert_member_reliable_v1(
    pg_catalog.jsonb_build_object(
      'id', v_member_id,
      'name', v_name_edit,
      'login_email', v_email_edit,
      'contact_email', v_email_edit,
      'job_title', '回滾驗證更新',
      'role', 'employee',
      'entity_id', v_entity,
      'department_code', v_department,
      'active', true
    ),
    v_create_revision, v_edit_request
  );
  execute 'reset role';
  v_edit_revision := (v_edit #>> '{member,member_revision}')::bigint;
  if v_edit ->> 'ok' is distinct from 'true'
     or v_edit ->> 'action' is distinct from 'update'
     or v_edit #>> '{member,id}' is distinct from v_member_id
     or v_edit #>> '{member,name}' is distinct from v_name_edit
     or v_edit #>> '{member,email}' is distinct from v_email_edit
     or v_edit_revision <= v_create_revision then
    raise exception 'Atomic personnel edit did not preserve the ID and advance revision';
  end if;

  if not exists (
       select 1 from public.finance_users fu
       where fu.tenant_id = v_tenant
         and fu.id = v_member_id
         and fu.name = v_name_edit
         and fu.email = v_email_edit
         and fu.auth_user_id is null
         and fu.google_link_status = 'pending_first_login'
     )
     or not exists (
       select 1 from public.employees e
       where e.employee_no = v_member_id
         and e.full_name = v_name_edit
         and e.email = v_email_edit
     )
     or not exists (
       select 1 from public.users u
       join public.employees e on e.id = u.employee_id
       where e.employee_no = v_member_id
         and u.email = v_email_edit
         and u.display_name = v_name_edit
         and u.auth_user_id is null
     )
     or (select count(*) from private.finance_member_admin_events_v1 event
         where event.tenant_id = v_tenant
           and event.finance_user_id = v_member_id
           and event.action in ('create', 'update')) <> 2 then
    raise exception 'Edited member / HR / portal projection or audit trail is inconsistent';
  end if;
  select state.source_revision
    into v_outbox_revision
  from private.finance_edoc_member_state_v1 state
  where state.tenant_id = v_tenant
    and state.finance_user_id = v_member_id;
  if v_outbox_revision is null
     or (select count(*) from private.finance_edoc_sync_outbox_v1 o
           where o.tenant_id = v_tenant
             and o.aggregate_type = 'member'
             and o.aggregate_id = v_member_id) < 2 then
    raise exception 'Edit did not advance the eDoc member source outbox';
  end if;
  v_member_snapshot := public.finance_edoc_member_sync_snapshot_v1(
    v_tenant, v_member_id, v_outbox_revision
  );
  if v_member_snapshot ->> 'ok' is distinct from 'true'
     or v_member_snapshot #>> '{identity,financeUserId}' is distinct from v_member_id
     or v_member_snapshot #>> '{identity,email}' is distinct from v_email_edit
     or v_member_snapshot ->> 'workflowReady' is distinct from 'false' then
    raise exception 'eDoc source snapshot exposed stale identity or enabled unverified login';
  end if;

  -- Capture all directly affected persisted state. An old revision must be a
  -- business conflict (PT409), without retry or any partial write.
  select pg_catalog.jsonb_build_object(
    'finance', (select to_jsonb(fu) from public.finance_users fu where fu.id = v_member_id),
    'employees', (select coalesce(jsonb_agg(to_jsonb(e) order by e.id), '[]'::jsonb)
                    from public.employees e where e.employee_no = v_member_id),
    'portal', (select coalesce(jsonb_agg(to_jsonb(u) order by u.id), '[]'::jsonb)
                 from public.users u join public.employees e on e.id = u.employee_id
                 where e.employee_no = v_member_id),
    'roles', (select coalesce(jsonb_agg(to_jsonb(r) order by r.id), '[]'::jsonb)
                from public.employee_department_roles r where r.finance_user_id = v_member_id),
    'edoc_state', (select to_jsonb(s) from private.finance_edoc_member_state_v1 s
                   where s.finance_user_id = v_member_id),
    'edoc_outbox', (select coalesce(jsonb_agg(to_jsonb(o) order by o.id), '[]'::jsonb)
                     from private.finance_edoc_sync_outbox_v1 o
                     where o.aggregate_type = 'member' and o.aggregate_id = v_member_id),
    'admin_events', (select coalesce(jsonb_agg(to_jsonb(e) order by e.id), '[]'::jsonb)
                       from private.finance_member_admin_events_v1 e
                       where e.finance_user_id = v_member_id),
    'org_versions', (select coalesce(jsonb_agg(to_jsonb(v) order by v.version_no), '[]'::jsonb)
                       from private.finance_membership_org_versions_v1 v
                       where v.tenant_id = v_tenant),
    'hr_cursor', (select to_jsonb(c) from private.hr_directory_cursor c where c.id = true)
  ) into v_before_stale;

  execute 'set local role authenticated';
  v_stale_state := null;
  begin
    perform public.finance_admin_upsert_member_reliable_v1(
      pg_catalog.jsonb_build_object(
        'id', v_member_id,
        'name', '這筆舊版不應儲存',
        'login_email', v_email_edit,
        'contact_email', v_email_edit,
        'role', 'employee',
        'entity_id', v_entity,
        'department_code', v_department,
        'active', true
      ),
      v_create_revision, gen_random_uuid()
    );
  exception when others then
    v_stale_state := SQLSTATE;
  end;
  execute 'reset role';
  if v_stale_state is distinct from 'PT409' then
    raise exception 'Stale personnel edit expected PT409, received %',
      coalesce(v_stale_state, 'success');
  end if;

  select pg_catalog.jsonb_build_object(
    'finance', (select to_jsonb(fu) from public.finance_users fu where fu.id = v_member_id),
    'employees', (select coalesce(jsonb_agg(to_jsonb(e) order by e.id), '[]'::jsonb)
                    from public.employees e where e.employee_no = v_member_id),
    'portal', (select coalesce(jsonb_agg(to_jsonb(u) order by u.id), '[]'::jsonb)
                 from public.users u join public.employees e on e.id = u.employee_id
                 where e.employee_no = v_member_id),
    'roles', (select coalesce(jsonb_agg(to_jsonb(r) order by r.id), '[]'::jsonb)
                from public.employee_department_roles r where r.finance_user_id = v_member_id),
    'edoc_state', (select to_jsonb(s) from private.finance_edoc_member_state_v1 s
                   where s.finance_user_id = v_member_id),
    'edoc_outbox', (select coalesce(jsonb_agg(to_jsonb(o) order by o.id), '[]'::jsonb)
                     from private.finance_edoc_sync_outbox_v1 o
                     where o.aggregate_type = 'member' and o.aggregate_id = v_member_id),
    'admin_events', (select coalesce(jsonb_agg(to_jsonb(e) order by e.id), '[]'::jsonb)
                       from private.finance_member_admin_events_v1 e
                       where e.finance_user_id = v_member_id),
    'org_versions', (select coalesce(jsonb_agg(to_jsonb(v) order by v.version_no), '[]'::jsonb)
                       from private.finance_membership_org_versions_v1 v
                       where v.tenant_id = v_tenant),
    'hr_cursor', (select to_jsonb(c) from private.hr_directory_cursor c where c.id = true)
  ) into v_after_stale;
  if v_after_stale is distinct from v_before_stale then
    raise exception 'Stale edit changed a Finance, HR, portal, organization, audit, or outbox row';
  end if;
end;
$personnel_save_canary$;

rollback;

-- Fixed labels make the rollback externally verifiable without retaining any
-- synthetic ID in a permanent table. A session closes with zero Auth writes.
do $personnel_save_rollback$
begin
  if exists (
       select 1 from public.finance_users fu
       where fu.email in (
         'personnel-save-live-canary-20261003@suiyuecare.com',
         'personnel-save-live-canary-edit-20261003@suiyuecare.com'
       ) or fu.name in ('人員儲存回滾驗證甲', '人員儲存回滾驗證乙')
     )
     or exists (
       select 1 from public.employees e
       where e.email in (
         'personnel-save-live-canary-20261003@suiyuecare.com',
         'personnel-save-live-canary-edit-20261003@suiyuecare.com'
       ) or e.full_name in ('人員儲存回滾驗證甲', '人員儲存回滾驗證乙')
     )
     or exists (
       select 1 from public.users u
       where u.email in (
         'personnel-save-live-canary-20261003@suiyuecare.com',
         'personnel-save-live-canary-edit-20261003@suiyuecare.com'
       ) or u.display_name in ('人員儲存回滾驗證甲', '人員儲存回滾驗證乙')
     ) then
    raise exception 'Personnel canary rollback left synthetic identity data';
  end if;
end;
$personnel_save_rollback$;

select pg_catalog.jsonb_build_object(
  'canary', 'finance_personnel_reliable_save_live_v1',
  'ok', true,
  'rolled_back', true,
  'auth_rows_created', false,
  'edoc_target_delivery_proven', false
) as personnel_save_canary_result;
