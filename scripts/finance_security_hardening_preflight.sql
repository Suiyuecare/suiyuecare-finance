\set ON_ERROR_STOP on

-- Read-only prerequisites for 20261024100000. No business rows are read.
do $security_hardening_preflight$
declare offenders text; item record; body text;
begin
  -- The reviewed adjustment RPCs are converted to owner rights by the
  -- migration; any other body, or any other caller-rights routine that
  -- writes or row-locks the books, stops the phase here.
  for item in select * from (values
    ('post_adjustment_voucher', 'public.post_adjustment_voucher(text,text,jsonb,date)', '64a7c3f64e03baf89a357d21c7e6caa0'),
    ('reverse_voucher', 'public.reverse_voucher(text,text,date)', '989c5af145cb9675bb30cc8019b9b1cc')
  ) reviewed(name, signature, body_md5) loop
    body := null;
    select p.prosrc into body from pg_catalog.pg_proc p
    where p.oid = pg_catalog.to_regprocedure(item.signature);
    if body is null or pg_catalog.md5(body) <> item.body_md5 then
      raise exception '% differs from the reviewed baseline: %', item.name,
        coalesce(pg_catalog.md5(body), 'missing') using errcode = '55000';
    end if;
  end loop;
  select pg_catalog.string_agg(p.oid::pg_catalog.regprocedure::text, ', ' order by p.oid::pg_catalog.regprocedure::text)
  into offenders
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where (n.nspname in ('public', 'private', 'logout_private') or n.nspname like 'finance\_%')
    and p.prokind = 'f'
    and not p.prosecdef
    and p.oid not in (pg_catalog.to_regprocedure('public.post_adjustment_voucher(text,text,jsonb,date)'),
      pg_catalog.to_regprocedure('public.reverse_voucher(text,text,date)'))
    and (p.prosrc ~* '(insert[[:space:]]+into|update|delete[[:space:]]+from)[[:space:]]+("?public"?[[:space:]]*\.[[:space:]]*)?"?(ledger_entries|vouchers)"?([^[:alnum:]_]|$)'
      or p.prosrc ~* 'from[[:space:]]+("?public"?[[:space:]]*\.[[:space:]]*)?"?(ledger_entries|vouchers)"?([^[:alnum:]_][^;]*)?\mfor[[:space:]]+(update|share|no[[:space:]]+key[[:space:]]+update|key[[:space:]]+share)\M')
    and (pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
      or p.prorettype = 'pg_catalog.trigger'::pg_catalog.regtype);
  if offenders is not null then
    raise exception 'Caller-rights routine writes ledger_entries or vouchers: %', offenders
      using errcode = '55000';
  end if;
  if pg_catalog.to_regclass('public.ledger_entries') is null
     or pg_catalog.to_regclass('public.vouchers') is null then
    raise exception 'Finance books tables are missing' using errcode = '55000';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_policy
    where polrelid = 'storage.objects'::pg_catalog.regclass
      and polname = 'finance_attachments_select_verified_tenant_metadata_v2'
      and polpermissive and polcmd = 'r'
  ) then
    raise exception 'Verified attachment read policy is missing' using errcode = '55000';
  end if;
  if pg_catalog.to_regclass('public.payee_bank_accounts') is null
     or pg_catalog.to_regclass('public.draft_requests') is null
     or pg_catalog.to_regprocedure('public.current_finance_user_id()') is null
     or not pg_catalog.has_function_privilege('authenticated', 'public.current_finance_user_id()', 'EXECUTE') then
    raise exception 'Verified identity helper or protected tables are missing' using errcode = '55000';
  end if;
end;
$security_hardening_preflight$;
select 'FINANCE_SECURITY_HARDENING_PREFLIGHT_OK' as marker;
