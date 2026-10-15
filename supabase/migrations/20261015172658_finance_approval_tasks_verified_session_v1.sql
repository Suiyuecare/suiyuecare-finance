-- The legacy task RPC is callable directly by authenticated clients. Its old
-- auth.uid()-only lookup could still return tasks after a session was revoked.
-- Keep the task query and return contract intact; use the already verified,
-- tenant-scoped finance identity for its single `me` CTE instead.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $migration$
declare
  v_target_oid oid := pg_catalog.to_regprocedure('public.finance_approval_tasks_for_current_user(text)');
  v_identity_oid oid := pg_catalog.to_regprocedure('public.current_finance_user()');
  v_definition text;
  v_replacement text;
  v_owner oid;
  v_acl aclitem[];
  v_security_definer boolean;
  v_volatility "char";
  v_config text[];
  v_old_me constant text := $old_me$with me as (
  select id, auth_user_id, email, role, department_code, tenant_id
  from public.finance_users
  where active is true
    and auth_user_id = auth.uid()
  order by created_at, id
  limit 1
),$old_me$;
  v_verified_me constant text := $verified_me$with me as (
  select id, auth_user_id, email, role, department_code, tenant_id
  from public.current_finance_user()
  where id is not null
),$verified_me$;
begin
  if v_target_oid is null or v_identity_oid is null then
    raise exception 'FINANCE_APPROVAL_TASKS_VERIFIED_SESSION_SOURCE_MISSING';
  end if;

  -- Freeze both the vulnerable predecessor and the verified identity helper.
  -- A changed source must be reviewed, rather than silently rewritten.
  if pg_catalog.md5(pg_catalog.pg_get_functiondef(v_identity_oid)) <> '138acd5e90d5546d28de5874b83305ef'
     or not exists (
       select 1 from pg_catalog.pg_proc
       where oid = v_identity_oid and prosecdef and provolatile = 's'
     ) then
    raise exception 'FINANCE_APPROVAL_TASKS_VERIFIED_IDENTITY_DRIFT';
  end if;

  select pg_catalog.pg_get_functiondef(p.oid), p.proowner, p.proacl,
         p.prosecdef, p.provolatile, p.proconfig
  into v_definition, v_owner, v_acl, v_security_definer, v_volatility, v_config
  from pg_catalog.pg_proc p
  where p.oid = v_target_oid;

  if pg_catalog.md5(v_definition) <> 'a99f1dd41923ab610c88095c8cf1ab89'
     or pg_catalog.md5((select p.prosrc from pg_catalog.pg_proc p where p.oid = v_target_oid)) <> 'db3c16f498ac978dcfb5e4af5f8581c2'
     or not v_security_definer or v_volatility <> 's'
     or pg_catalog.strpos(v_definition, v_old_me) = 0 then
    raise exception 'FINANCE_APPROVAL_TASKS_VERIFIED_SESSION_PREDECESSOR_DRIFT';
  end if;

  v_replacement := pg_catalog.replace(v_definition, v_old_me, v_verified_me);
  if pg_catalog.md5(v_replacement) <> '765a6b9f47b54802c86cea8423d6d90d' then
    raise exception 'FINANCE_APPROVAL_TASKS_VERIFIED_SESSION_REWRITE_DRIFT';
  end if;

  execute v_replacement;

  if not exists (
    select 1
    from pg_catalog.pg_proc p
    where p.oid = v_target_oid
      and pg_catalog.md5(pg_catalog.pg_get_functiondef(p.oid)) = '765a6b9f47b54802c86cea8423d6d90d'
      and pg_catalog.md5(p.prosrc) = 'cd3e46a7242dbd872c81ac742d7d4197'
      and p.proowner = v_owner
      and p.proacl is not distinct from v_acl
      and p.prosecdef is not distinct from v_security_definer
      and p.provolatile is not distinct from v_volatility
      and p.proconfig is not distinct from v_config
  ) then
    raise exception 'FINANCE_APPROVAL_TASKS_VERIFIED_SESSION_POSTCHECK_FAILED';
  end if;
end;
$migration$;

notify pgrst, 'reload schema';
