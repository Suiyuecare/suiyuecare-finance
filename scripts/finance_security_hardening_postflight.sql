\set ON_ERROR_STOP on

-- Catalog only: privileges, routine metadata, view options and policy names. No business rows.
do $security_hardening_postflight$
declare role_name text; v pg_catalog.regclass; offenders text; item record; routine pg_catalog.regprocedure;
begin
  for item in select * from (values
    ('public.post_adjustment_voucher(text,text,jsonb,date)', '71651cad4f5d74b901939b08afe5f824'),
    ('public.reverse_voucher(text,text,date)', '07e84ca7824b43ea09a15675432a6ab8')
  ) reviewed(signature, body_md5) loop
    routine := pg_catalog.to_regprocedure(item.signature);
    if routine is null or not exists (
      select 1 from pg_catalog.pg_proc p
      where p.oid = routine and p.prosecdef
        and p.proconfig = array['search_path=""']::text[]
        and pg_catalog.md5(p.prosrc) = item.body_md5
        and pg_catalog.has_table_privilege(p.proowner, 'public.vouchers', 'INSERT,UPDATE')
        and pg_catalog.has_table_privilege(p.proowner, 'public.ledger_entries', 'INSERT')
    ) or not pg_catalog.has_function_privilege('authenticated', routine, 'EXECUTE')
       or pg_catalog.has_function_privilege('anon', routine, 'EXECUTE') then
      raise exception 'Adjustment voucher RPC is not the reviewed owner-rights version: %', item.signature
        using errcode = '55000';
    end if;
  end loop;
  select pg_catalog.string_agg(p.oid::pg_catalog.regprocedure::text, ', ' order by p.oid::pg_catalog.regprocedure::text)
  into offenders
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where (n.nspname in ('public', 'private', 'logout_private') or n.nspname like 'finance\_%')
    and p.prokind = 'f'
    and not p.prosecdef
    and (p.prosrc ~* '(insert[[:space:]]+into|update|delete[[:space:]]+from)[[:space:]]+("?public"?[[:space:]]*\.[[:space:]]*)?"?(ledger_entries|vouchers)"?([^[:alnum:]_]|$)'
      or p.prosrc ~* 'from[[:space:]]+("?public"?[[:space:]]*\.[[:space:]]*)?"?(ledger_entries|vouchers)"?([^[:alnum:]_][^;]*)?\mfor[[:space:]]+(update|share|no[[:space:]]+key[[:space:]]+update|key[[:space:]]+share)\M')
    and (pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
      or p.prorettype = 'pg_catalog.trigger'::pg_catalog.regtype);
  if offenders is not null then
    raise exception 'Caller-rights routine writes ledger_entries or vouchers: %', offenders
      using errcode = '55000';
  end if;
  foreach role_name in array array['anon', 'authenticated'] loop
    if pg_catalog.has_table_privilege(role_name, 'public.ledger_entries', 'INSERT,UPDATE,DELETE,TRUNCATE')
       or pg_catalog.has_table_privilege(role_name, 'public.vouchers', 'INSERT,UPDATE,DELETE,TRUNCATE')
       or pg_catalog.has_any_column_privilege(role_name, 'public.ledger_entries', 'INSERT,UPDATE')
       or pg_catalog.has_any_column_privilege(role_name, 'public.vouchers', 'INSERT,UPDATE') then
      raise exception 'Browser role can still write the books: %', role_name using errcode = '55000';
    end if;
  end loop;
  if not pg_catalog.has_table_privilege('authenticated', 'public.ledger_entries', 'SELECT')
     or not pg_catalog.has_table_privilege('authenticated', 'public.vouchers', 'SELECT') then
    raise exception 'Authenticated reads of the books were removed' using errcode = '55000';
  end if;
  foreach v in array array[
    pg_catalog.to_regclass('public.finance_production_ledger_entries'),
    pg_catalog.to_regclass('public.finance_test_ledger_entries')
  ] loop
    if v is not null and (
      not exists (
        select 1 from pg_catalog.pg_class c
        where c.oid = v and c.relkind = 'v'
          and c.reloptions && array['security_invoker=true', 'security_invoker=on']::text[]
      )
      or pg_catalog.has_table_privilege('anon', v, 'SELECT')
    ) then
      raise exception 'Environment ledger view bypasses caller RLS or is anonymous: %', v using errcode = '55000';
    end if;
  end loop;
  if exists (
    select 1 from pg_catalog.pg_policy
    where polrelid = 'storage.objects'::pg_catalog.regclass and polname = 'finance attachment read scoped'
  ) then
    raise exception 'Legacy folder-wide attachment read policy remains' using errcode = '55000';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_policy
    where polrelid = 'storage.objects'::pg_catalog.regclass
      and polname = 'finance_attachments_select_verified_tenant_metadata_v2'
      and polpermissive and polcmd = 'r'
  ) then
    raise exception 'Verified attachment read policy is missing' using errcode = '55000';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_policy
    where polrelid = 'public.payee_bank_accounts'::pg_catalog.regclass
      and polname = 'payee_bank_accounts_verified_identity_v1' and not polpermissive and polcmd = '*'
      and polroles = array[(select oid from pg_catalog.pg_roles where rolname = 'authenticated')]
      and pg_catalog.pg_get_expr(polqual, polrelid) ~ '^\(\( SELECT (public\.)?current_finance_user_id\(\) AS current_finance_user_id\) IS NOT NULL\)$'
      and pg_catalog.pg_get_expr(polwithcheck, polrelid) ~ '^\(\( SELECT (public\.)?current_finance_user_id\(\) AS current_finance_user_id\) IS NOT NULL\)$'
  ) then
    raise exception 'Payee bank accounts do not require a verified Finance identity' using errcode = '55000';
  end if;
  if (select count(*) from pg_catalog.pg_policy
      where polrelid = 'public.draft_requests'::pg_catalog.regclass and not polpermissive
        and ((polname = 'draft_requests_insert_caller_owner_v1' and polcmd = 'a')
          or (polname = 'draft_requests_update_caller_owner_v1' and polcmd = 'w'))
        and polroles = array[(select oid from pg_catalog.pg_roles where rolname = 'authenticated')]
        and pg_catalog.pg_get_expr(polwithcheck, polrelid) ~ '^\(owner_id = \( SELECT (public\.)?current_finance_user_id\(\) AS current_finance_user_id\)\)$') <> 2 then
    raise exception 'Drafts can be written for another owner' using errcode = '55000';
  end if;
end;
$security_hardening_postflight$;
select 'FINANCE_SECURITY_HARDENING_POSTFLIGHT_OK' as marker;
