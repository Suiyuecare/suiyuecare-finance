-- 2026-10-24 audit hardening. Privileges, view options, one Storage policy and
-- the owner rights of two reviewed RPCs; no business row is read for output,
-- inserted, updated or deleted.
--
-- 1. Browser roles lose direct INSERT/UPDATE/DELETE/TRUNCATE on the books.
--    Every posting path is a SECURITY DEFINER RPC; a direct REST write could
--    create an unbalanced voucher, edit unkeyed history or squat posting keys.
-- 2. The optional environment ledger views run with the caller's rights so the
--    ledger RLS, including the restrictive HR salary scope, applies to them.
-- 3. The legacy folder-wide Storage read rule is removed. The verified
--    parent-scoped read policy from the 2026-09-22 release remains.
-- 4. Shared payee bank accounts require a verified, bound Finance identity,
--    not merely a token whose email claim matches an active user.
-- 5. A draft can only be written as the caller's own, so nobody can place a
--    draft into another person's (for example the CEO's) draft list.
--
-- The adjustment RPCs public.post_adjustment_voucher and public.reverse_voucher
-- predate the migration lineage and write or row-lock the books with the
-- caller's rights, so they would break once those rights are revoked. Only
-- their reviewed 2026-09-22 bodies are converted to owner rights; the
-- source-voucher scoping that RLS used to apply (tenant and complete salary
-- scope) becomes explicit, and every adjustment stays in the source voucher's
-- tenant. Any other body stops the release unchanged.
do $adjustment_baseline$
declare item record; body text;
begin
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
end
$adjustment_baseline$;

create or replace function public.post_adjustment_voucher(p_source_voucher_id text, p_reason text, p_entries jsonb, p_voucher_date date default current_date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  src public.vouchers%rowtype;
  entry jsonb;
  entry_idx int := 0;
  entry_type text;
  entry_account text;
  entry_name text;
  entry_dept text;
  entry_amount numeric;
  debit_total numeric := 0;
  credit_total numeric := 0;
  post_date date;
  adj_no text;
  adj_desc text;
  adj_type text := 'adjustment';
  src_env text;
begin
  perform public.assert_accounting_actor();
  if coalesce(trim(p_reason),'') = '' then raise exception 'Adjustment reason is required'; end if;
  if p_entries is null or jsonb_typeof(p_entries) <> 'array' or jsonb_array_length(p_entries)=0 then raise exception 'Adjustment entries are required'; end if;
  select * into src from public.vouchers where id=p_source_voucher_id for share;
  if not found or src.tenant_id is distinct from (public.current_finance_user()).tenant_id then
    raise exception 'Source voucher not found: %', p_source_voucher_id;
  end if;
  perform finance_hr_private.finance_hr_accounting_scope(src.tenant_id, src.entity_id, src.data_environment);
  if src.voided_at is not null then raise exception 'Voided source voucher cannot be adjusted: %', src.no; end if;
  post_date := coalesce(p_voucher_date,current_date);
  src_env := coalesce(src.data_environment,'production');
  for entry in select * from jsonb_array_elements(p_entries) loop
    entry_idx := entry_idx + 1;
    entry_type := lower(coalesce(entry ->> 't', entry ->> 'type', ''));
    entry_account := nullif(entry ->> 'ac', '');
    entry_name := coalesce(nullif(entry ->> 'an',''), nullif(entry ->> 'account_name',''), entry_account);
    entry_amount := coalesce(nullif(entry ->> 'amt','')::numeric, nullif(entry ->> 'amount','')::numeric, 0);
    if entry_type not in ('dr','cr') then raise exception 'Invalid adjustment entry type at row %', entry_idx; end if;
    if entry_account is null then raise exception 'Adjustment account is required at row %', entry_idx; end if;
    if entry_amount <= 0 then raise exception 'Adjustment amount must be positive at row %', entry_idx; end if;
    if entry_type='dr' then debit_total := debit_total + entry_amount; else credit_total := credit_total + entry_amount; end if;
  end loop;
  if round(debit_total-credit_total,2) <> 0 then raise exception 'Adjustment voucher is not balanced: debit %, credit %', debit_total, credit_total; end if;
  if trim(p_reason) like '沖銷 %' then adj_type := 'reversal'; end if;
  adj_no := public.next_voucher_no(case when adj_type='reversal' then 'RV' else 'ADJ' end, post_date, src_env);
  adj_desc := case when adj_type='reversal' then trim(p_reason) else '調整 '||src.no||' — '||trim(p_reason) end;
  insert into public.vouchers(id,no,request_id,entity_id,entity_name,voucher_date,description,entries,total,creator,posted,posted_at,posting_locked_at,adjusts_voucher_no,adjustment_type,data_environment,tenant_id)
  values (adj_no,adj_no,src.request_id,src.entity_id,src.entity_name,post_date,adj_desc,p_entries,debit_total,coalesce(public.current_finance_user_name(),'system'),true,now(),now(),src.no,adj_type,src_env,src.tenant_id);
  entry_idx := 0;
  for entry in select * from jsonb_array_elements(p_entries) loop
    entry_idx := entry_idx + 1;
    entry_type := lower(coalesce(entry ->> 't', entry ->> 'type', ''));
    entry_account := nullif(entry ->> 'ac', '');
    entry_name := coalesce(nullif(entry ->> 'an',''), nullif(entry ->> 'account_name',''), entry_account);
    entry_dept := coalesce(nullif(entry ->> 'dept',''), nullif(entry ->> 'department_code',''));
    entry_amount := coalesce(nullif(entry ->> 'amt','')::numeric, nullif(entry ->> 'amount','')::numeric, 0);
    insert into public.ledger_entries(entry_date,description,entity_id,department_code,debit,credit,account_code,account_name,reference_no,posting_key,source_type,source_id,source_no,voucher_no,data_environment,tenant_id)
    values (post_date,adj_desc,src.entity_id,entry_dept,case when entry_type='dr' then entry_amount else 0 end,case when entry_type='cr' then entry_amount else 0 end,entry_account,entry_name,adj_no,'voucher:'||adj_no||':'||entry_idx||':'||entry_account||':'||entry_type,'adjustment_voucher',adj_no,adj_no,adj_no,src_env,src.tenant_id)
    on conflict (data_environment, posting_key) where posting_key is not null do nothing;
  end loop;
  return jsonb_build_object('ok',true,'voucher_id',adj_no,'voucher_no',adj_no,'total',debit_total);
end;
$function$;

create or replace function public.reverse_voucher(p_voucher_id text, p_reason text, p_reversal_date date default current_date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  src public.vouchers%rowtype;
  existing public.vouchers%rowtype;
  row public.ledger_entries%rowtype;
  entries jsonb := '[]'::jsonb;
  src_env text;
begin
  perform public.assert_accounting_actor();
  if coalesce(trim(p_reason),'') = '' then raise exception 'Reversal reason is required'; end if;
  select * into src from public.vouchers where id=p_voucher_id for share;
  if not found or src.tenant_id is distinct from (public.current_finance_user()).tenant_id then
    raise exception 'Source voucher not found: %', p_voucher_id;
  end if;
  perform finance_hr_private.finance_hr_accounting_scope(src.tenant_id, src.entity_id, src.data_environment);
  if src.voided_at is not null then raise exception 'Voided source voucher cannot be reversed: %', src.no; end if;
  src_env := coalesce(src.data_environment,'production');
  select * into existing from public.vouchers where adjusts_voucher_no=src.no and adjustment_type='reversal' and coalesce(data_environment,'production')=src_env and tenant_id=src.tenant_id order by created_at asc limit 1;
  if found then return jsonb_build_object('ok',true,'idempotent',true,'voucher_id',existing.id,'voucher_no',existing.no); end if;
  for row in select * from public.ledger_entries where voucher_no=src.no and coalesce(data_environment,'production')=src_env and tenant_id=src.tenant_id and voided_at is null order by id asc loop
    if row.debit > 0 then entries := entries || jsonb_build_array(jsonb_build_object('t','cr','ac',row.account_code,'an',coalesce(row.account_name,row.account_code),'dept',coalesce(row.department_code,''),'amt',row.debit)); end if;
    if row.credit > 0 then entries := entries || jsonb_build_array(jsonb_build_object('t','dr','ac',row.account_code,'an',coalesce(row.account_name,row.account_code),'dept',coalesce(row.department_code,''),'amt',row.credit)); end if;
  end loop;
  if jsonb_array_length(entries)=0 then
    entries := (select coalesce(jsonb_agg(jsonb_build_object('t',case when lower(e.value ->> 't')='dr' then 'cr' else 'dr' end,'ac',e.value ->> 'ac','an',coalesce(e.value ->> 'an', e.value ->> 'ac'),'dept',coalesce(e.value ->> 'dept',''),'amt',coalesce(nullif(e.value ->> 'amt','')::numeric,0))),'[]'::jsonb) from jsonb_array_elements(coalesce(src.entries,'[]'::jsonb)) as e(value) where coalesce(nullif(e.value ->> 'amt','')::numeric,0)>0);
  end if;
  return public.post_adjustment_voucher(src.id,'沖銷 '||src.no||' — '||trim(p_reason),entries,coalesce(p_reversal_date,current_date));
end;
$function$;

revoke all on function public.post_adjustment_voucher(text,text,jsonb,date), public.reverse_voucher(text,text,date) from public, anon;
grant execute on function public.post_adjustment_voucher(text,text,jsonb,date), public.reverse_voucher(text,text,date) to authenticated;

do $preflight$
declare offenders text;
begin
  -- Revoking browser writes must not strand a routine that writes or
  -- row-locks the books with the caller's rights; such routines stop the
  -- release unchanged and are all named at once.
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
    raise exception 'Verified attachment read policy is missing; the legacy rule cannot be removed'
      using errcode = '55000';
  end if;

  if pg_catalog.to_regclass('public.payee_bank_accounts') is null
     or pg_catalog.to_regclass('public.draft_requests') is null
     or pg_catalog.to_regprocedure('public.current_finance_user_id()') is null
     or not pg_catalog.has_function_privilege('authenticated', 'public.current_finance_user_id()', 'EXECUTE') then
    raise exception 'Verified identity helper or protected tables are missing' using errcode = '55000';
  end if;
end
$preflight$;

revoke insert, update, delete, truncate on table public.ledger_entries, public.vouchers
  from public, anon, authenticated;

-- Column grants survive a table-level REVOKE, so remove any that exist.
do $column_grants$
declare r record;
begin
  for r in
    select c.oid::pg_catalog.regclass as relation, a.attname, grantee.rolname, acl.privilege_type
    from pg_catalog.pg_class c
    join pg_catalog.pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
    cross join lateral pg_catalog.aclexplode(a.attacl) acl
    join pg_catalog.pg_roles grantee on grantee.oid = acl.grantee
    where c.oid in ('public.ledger_entries'::pg_catalog.regclass, 'public.vouchers'::pg_catalog.regclass)
      and grantee.rolname in ('anon', 'authenticated')
      and acl.privilege_type in ('INSERT', 'UPDATE')
  loop
    execute pg_catalog.format('revoke %s (%I) on table %s from %I',
      r.privilege_type, r.attname, r.relation, r.rolname);
  end loop;
end
$column_grants$;

do $environment_views$
declare v pg_catalog.regclass;
begin
  foreach v in array array[
    pg_catalog.to_regclass('public.finance_production_ledger_entries'),
    pg_catalog.to_regclass('public.finance_test_ledger_entries')
  ] loop
    if v is not null then
      execute pg_catalog.format('alter view %s set (security_invoker = true)', v);
      execute pg_catalog.format('revoke all on table %s from public, anon', v);
    end if;
  end loop;
end
$environment_views$;

drop policy if exists "finance attachment read scoped" on storage.objects;

drop policy if exists payee_bank_accounts_verified_identity_v1 on public.payee_bank_accounts;
create policy payee_bank_accounts_verified_identity_v1 on public.payee_bank_accounts
  as restrictive for all to authenticated
  using ((select public.current_finance_user_id()) is not null)
  with check ((select public.current_finance_user_id()) is not null);

drop policy if exists draft_requests_insert_caller_owner_v1 on public.draft_requests;
create policy draft_requests_insert_caller_owner_v1 on public.draft_requests
  as restrictive for insert to authenticated
  with check (owner_id = (select public.current_finance_user_id()));

drop policy if exists draft_requests_update_caller_owner_v1 on public.draft_requests;
create policy draft_requests_update_caller_owner_v1 on public.draft_requests
  as restrictive for update to authenticated
  using (true)
  with check (owner_id = (select public.current_finance_user_id()));
