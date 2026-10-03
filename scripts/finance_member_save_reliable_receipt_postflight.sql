\set ON_ERROR_STOP on

-- Read only. Confirm the adopted writer is unchanged and the receipt wrapper
-- has the reviewed body, privilege boundary and composite request identity.
begin read only;
do $member_reliable_postflight$
declare
  v_table oid := to_regclass('private.finance_member_save_receipts_v1');
  v_rpc oid := to_regprocedure('public.finance_admin_upsert_member_reliable_v1(jsonb,bigint,uuid)');
begin
  if v_table is null or v_rpc is null then
    raise exception 'Reliable personnel save table or RPC is missing';
  end if;
  if encode(extensions.digest(pg_get_functiondef(
       'public.finance_admin_upsert_member_atomic_v1(jsonb,bigint)'::regprocedure
     ), 'sha256'), 'hex') <> '6679fa1fd91141a94d91923ed266940ba4ece0eb1d0fba29d9a737e1a43e816b'
     or encode(extensions.digest(pg_get_functiondef(
       'private.finance_admin_upsert_member_org_base_v1(jsonb,bigint)'::regprocedure
     ), 'sha256'), 'hex') <> '4bdf93b7d07c2a38e9c01089fb45fc8e4661044976043b9651f4184ed817354c' then
    raise exception 'Reliable personnel save changed an adopted writer';
  end if;
  if encode(extensions.digest(pg_get_functiondef(
       'private.finance_membership_org_actor_v1(boolean,boolean)'::regprocedure
     ), 'sha256'), 'hex') <> '6a1cc3b287fa47be2efd15cee1939626e15ea8bf01a59dcf88f6de423cf07c3e' then
    raise exception 'Reliable personnel save actor authorization drifted';
  end if;
  if not exists (
    select 1 from pg_proc p
    where p.oid = v_rpc
      and pg_get_userbyid(p.proowner) = 'postgres'
      and p.prosecdef
      and p.proconfig = array['search_path=""']::text[]
      and p.prorettype = 'jsonb'::regtype
      and p.proacl::text = '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}'
      and encode(extensions.digest(p.prosrc, 'sha256'), 'hex') =
        '3acd9950adaa5ad01906e9e6ddc78c028fdc56ec94a047aeb15a0efca6fbbb52'
  ) then
    raise exception 'Reliable personnel save RPC source or authority drifted';
  end if;
  if not has_function_privilege('authenticated', v_rpc, 'EXECUTE')
     or not has_function_privilege('service_role', v_rpc, 'EXECUTE')
     or has_function_privilege('anon', v_rpc, 'EXECUTE')
     or exists (
       select 1
       from pg_proc p
       cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
       where p.oid = v_rpc
         and acl.grantee = 0
         and acl.privilege_type = 'EXECUTE'
     ) then
    raise exception 'Reliable personnel save RPC grants drifted';
  end if;
  if not exists (
    select 1 from pg_class c
    where c.oid = v_table
      and c.relkind = 'r'
      and c.relrowsecurity
      and pg_get_userbyid(c.relowner) = 'postgres'
  )
     or not exists (
       select 1 from pg_constraint k
       where k.conrelid = v_table
         and k.contype = 'p'
         and pg_get_constraintdef(k.oid) =
           'PRIMARY KEY (tenant_id, actor_auth_user_id, request_id)'
     ) then
    raise exception 'Reliable personnel receipt table or key drifted';
  end if;
  if has_table_privilege('anon', v_table, 'SELECT')
     or has_table_privilege('authenticated', v_table, 'SELECT')
     or has_table_privilege('service_role', v_table, 'SELECT')
     or has_table_privilege('anon', v_table, 'INSERT')
     or has_table_privilege('authenticated', v_table, 'INSERT')
     or has_table_privilege('service_role', v_table, 'INSERT')
     or has_table_privilege('anon', v_table, 'UPDATE')
     or has_table_privilege('authenticated', v_table, 'UPDATE')
     or has_table_privilege('service_role', v_table, 'UPDATE')
     or has_table_privilege('anon', v_table, 'DELETE')
     or has_table_privilege('authenticated', v_table, 'DELETE')
     or has_table_privilege('service_role', v_table, 'DELETE') then
    raise exception 'Reliable personnel receipt table is directly accessible';
  end if;
end;
$member_reliable_postflight$;
select 'FINANCE_MEMBER_SAVE_RELIABLE_RECEIPT_POSTFLIGHT_OK' as marker;
rollback;
