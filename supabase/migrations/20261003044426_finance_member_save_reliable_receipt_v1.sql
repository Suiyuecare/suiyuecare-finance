-- A request UUID gives a personnel save a durable result. If the browser loses
-- the response, the same actor can safely retry the same payload and receive
-- the original atomic result without creating or updating a person twice.
do $member_reliable_preflight$
begin
  if to_regprocedure('public.finance_admin_upsert_member_atomic_v1(jsonb,bigint)') is null
     or to_regprocedure('private.finance_admin_upsert_member_org_base_v1(jsonb,bigint)') is null
     or to_regprocedure('private.finance_membership_org_actor_v1(boolean,boolean)') is null then
    raise exception 'Reliable personnel save prerequisites are missing';
  end if;
  if encode(extensions.digest(pg_get_functiondef(
       'public.finance_admin_upsert_member_atomic_v1(jsonb,bigint)'::regprocedure
     ), 'sha256'), 'hex') <> '6679fa1fd91141a94d91923ed266940ba4ece0eb1d0fba29d9a737e1a43e816b'
     or encode(extensions.digest(pg_get_functiondef(
       'private.finance_admin_upsert_member_org_base_v1(jsonb,bigint)'::regprocedure
     ), 'sha256'), 'hex') <> '4bdf93b7d07c2a38e9c01089fb45fc8e4661044976043b9651f4184ed817354c'
     or encode(extensions.digest(pg_get_functiondef(
       'private.finance_membership_org_actor_v1(boolean,boolean)'::regprocedure
     ), 'sha256'), 'hex') <> '6a1cc3b287fa47be2efd15cee1939626e15ea8bf01a59dcf88f6de423cf07c3e' then
    raise exception 'Reliable personnel save prerequisite source changed';
  end if;
  if not exists (
    select 1 from pg_proc p
    where p.oid = 'public.finance_admin_upsert_member_atomic_v1(jsonb,bigint)'::regprocedure
      and pg_get_userbyid(p.proowner) = 'postgres'
      and p.prosecdef
      and p.proconfig = array['search_path=""']::text[]
      and p.proacl::text = '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}'
  ) then
    raise exception 'Reliable personnel save prerequisite authority changed';
  end if;
end;
$member_reliable_preflight$;

create table private.finance_member_save_receipts_v1 (
  tenant_id uuid not null,
  actor_auth_user_id uuid not null,
  actor_finance_user_id text not null,
  actor_role text not null check (actor_role in ('ceo', 'admin_director', 'hr')),
  request_id uuid not null,
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  result jsonb not null check (jsonb_typeof(result) = 'object'),
  created_at timestamptz not null default clock_timestamp(),
  primary key (tenant_id, actor_auth_user_id, request_id)
);
alter table private.finance_member_save_receipts_v1 owner to postgres;
alter table private.finance_member_save_receipts_v1 enable row level security;
revoke all on table private.finance_member_save_receipts_v1
  from public, anon, authenticated, service_role;

create function public.finance_admin_upsert_member_reliable_v1(
  p_member jsonb,
  p_expected_revision bigint,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor jsonb;
  v_tenant_id uuid;
  v_actor_auth_user_id uuid;
  v_actor_finance_user_id text;
  v_actor_role text;
  v_receipt_target_role text;
  v_payload_hash text;
  v_receipt private.finance_member_save_receipts_v1%rowtype;
  v_result jsonb;
begin
  -- Re-evaluate current authority before reading a previous receipt. A former
  -- administrator must not replay data after their role or account is revoked.
  v_actor := private.finance_membership_org_actor_v1(true, false);
  v_tenant_id := (v_actor ->> 'tenant_id')::uuid;
  v_actor_auth_user_id := auth.uid();
  v_actor_finance_user_id := v_actor ->> 'finance_user_id';
  v_actor_role := v_actor ->> 'role';
  if v_actor_auth_user_id is null
     or v_tenant_id is null
     or nullif(v_actor_finance_user_id, '') is null
     or coalesce(v_actor_role, '') not in ('ceo', 'admin_director', 'hr')
     or coalesce(public.current_finance_role(), '') is distinct from v_actor_role
     or not exists (
       select 1 from public.finance_users actor_row
       where actor_row.tenant_id = v_tenant_id
         and actor_row.id = v_actor_finance_user_id
         and actor_row.auth_user_id = v_actor_auth_user_id
         and actor_row.active = true
         and actor_row.role = v_actor_role
     ) then
    raise exception '只有執行長、行政部門主任或人資可以維護人員。'
      using errcode = '42501';
  end if;
  if v_actor_role = 'hr' then
    if lower(btrim(coalesce(p_member ->> 'role', 'employee'))) in
       ('ceo', 'admin_director', 'accountant', 'cashier', 'external_audit', 'board', 'shareholder')
       or exists (
         select 1 from public.finance_users target_row
         where target_row.tenant_id = v_tenant_id
           and target_row.id = nullif(btrim(coalesce(p_member ->> 'id', '')), '')
           and target_row.role in
             ('ceo', 'admin_director', 'accountant', 'cashier', 'external_audit', 'board', 'shareholder')
       ) then
      raise exception '人資不能修改或讀取財務控制、董事會、股東或執行長的人員異動。'
        using errcode = '42501';
    end if;
  end if;
  if p_request_id is null
     or p_request_id = '00000000-0000-0000-0000-000000000000'::uuid then
    raise exception '請求識別碼不正確。' using errcode = '22023';
  end if;

  v_payload_hash := encode(extensions.digest(
    jsonb_build_object('member', p_member, 'expected_revision', p_expected_revision)::text,
    'sha256'
  ), 'hex');
  if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(
    'finance-member-save-reliable-v1:' || v_tenant_id::text || ':'
      || v_actor_auth_user_id::text || ':' || p_request_id::text,
    20261003
  )) then
    raise exception '這筆人員儲存仍在處理，請稍後以同一請求重試。'
      using errcode = 'PT409', detail = 'MEMBER_REQUEST_PENDING';
  end if;

  select receipt.* into v_receipt
  from private.finance_member_save_receipts_v1 receipt
  where receipt.tenant_id = v_tenant_id
    and receipt.actor_auth_user_id = v_actor_auth_user_id
    and receipt.request_id = p_request_id;
  if found then
    -- Lock only on replay: the first write keeps the existing atomic RPC's
    -- lock order. A concurrent demotion or target-role change must either
    -- commit before these reads (and be denied) or wait until replay ends.
    perform 1 from public.finance_users actor_row
    where actor_row.tenant_id = v_tenant_id
      and actor_row.id = v_actor_finance_user_id
      and actor_row.auth_user_id = v_actor_auth_user_id
      and actor_row.active = true
      and actor_row.role = v_actor_role
    for share;
    if not found then
      raise exception '目前人員身分或權限已變更。' using errcode = '42501';
    end if;
    if v_receipt.actor_finance_user_id is distinct from v_actor_finance_user_id then
      raise exception '目前人員身分與原請求不一致。' using errcode = '42501';
    end if;
    if v_receipt.actor_role is distinct from v_actor_role then
      raise exception '目前人員權限與原請求不一致。' using errcode = '42501';
    end if;
    if v_receipt.payload_hash is distinct from v_payload_hash then
      raise exception '同一請求識別碼不能用於不同的人員內容或版本。'
        using errcode = 'PT409', detail = 'MEMBER_REQUEST_PAYLOAD_MISMATCH';
    end if;
    select target_row.role into v_receipt_target_role
    from public.finance_users target_row
    where target_row.tenant_id = v_tenant_id
      and target_row.id = v_receipt.result #>> '{member,id}'
    for share;
    if not found
       or (v_actor_role = 'hr' and v_receipt_target_role in
         ('ceo', 'admin_director', 'accountant', 'cashier', 'external_audit', 'board', 'shareholder')) then
      raise exception '目前已無權查看這筆人員儲存結果。' using errcode = '42501';
    end if;
    return v_receipt.result || jsonb_build_object('replayed', true);
  end if;

  -- The unchanged atomic RPC performs all member, Google login, organization
  -- projection and outbox writes. The receipt shares its transaction.
  v_result := public.finance_admin_upsert_member_atomic_v1(p_member, p_expected_revision);
  if jsonb_typeof(v_result) is distinct from 'object'
     or coalesce((v_result ->> 'ok')::boolean, false) is not true
     or coalesce((v_result ->> 'atomic')::boolean, false) is not true
     or jsonb_typeof(v_result -> 'member') is distinct from 'object' then
    raise exception '人員異動未完整寫入，請求憑證未建立。' using errcode = '55000';
  end if;

  insert into private.finance_member_save_receipts_v1 (
    tenant_id, actor_auth_user_id, actor_finance_user_id, actor_role,
    request_id, payload_hash, result
  ) values (
    v_tenant_id, v_actor_auth_user_id, v_actor_finance_user_id, v_actor_role,
    p_request_id, v_payload_hash, v_result
  );
  return v_result;
end;
$function$;

alter function public.finance_admin_upsert_member_reliable_v1(jsonb,bigint,uuid)
  owner to postgres;
revoke all on function public.finance_admin_upsert_member_reliable_v1(jsonb,bigint,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.finance_admin_upsert_member_reliable_v1(jsonb,bigint,uuid)
  to authenticated, service_role;

notify pgrst, 'reload schema';
