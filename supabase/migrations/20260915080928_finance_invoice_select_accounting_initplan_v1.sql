-- Preserve the existing accounting permission exactly; compute only its
-- row-independent identity checks once per statement. Other users retain the
-- complete existing can_read_invoice predicate. No function, grant, writer,
-- business row, tenant/environment rule, or existing migration is changed.
do $invoice_select_baseline$
declare expected record;proc record;policy record;old_path text:=current_setting('search_path');
begin
  perform set_config('search_path','public, pg_catalog',true);
  for expected in select * from (values
    ('public.can_read_invoice(public.invoices)','d761ec0bbd1544410ae52bd860ec78b6',false,'search_path=""'),
    ('public.current_finance_role()','21dee4f613511ba49f259a8371005e9d',false,'search_path=public'),
    ('public.current_finance_user()','5fc4f077185c7e351c730378e4d0eca4',true,'search_path=""'),
    ('public.current_finance_user_id()','14764ed0aa1758b0d159b8506b0f8c26',false,'search_path=public'),
    ('public.current_tenant_id()','7db91f7dbfb876063cd14610b2c310e4',true,'search_path=""'),
    ('public.finance_current_verified_google_email_v2()','9d9d0c836e527510ca3a76b569c95f82',true,'search_path=""'),
    ('public.finance_statement_source_page_v1(text,text,integer,integer)','fe39d7ec0b151e30cc36e9e2cb7538dc',false,'search_path=""'),
    ('public.finance_verified_google_email(uuid)','cc9904d39d410a933a2a31ccddc91038',true,'search_path=public, auth, pg_temp'),
    ('public.is_finance_accounting()','b615fdf7d194eab2ef2003874db09318',false,'search_path=public')
  ) pins(signature,body_md5,is_definer,path_setting) loop
    select * into proc from pg_proc where oid=to_regprocedure(expected.signature);
    if proc.oid is null or md5(proc.prosrc)<>expected.body_md5 or proc.provolatile<>'s'
       or proc.prosecdef is distinct from expected.is_definer
       or proc.proconfig is distinct from array[expected.path_setting]::text[]
       or pg_get_userbyid(proc.proowner)<>'postgres' then
      raise exception 'Invoice SELECT identity/helper baseline changed: %',expected.signature;
    end if;
  end loop;
  if not exists(select 1 from pg_class where oid='public.invoices'::regclass
      and relrowsecurity and relforcerowsecurity and pg_get_userbyid(relowner)='postgres') then
    raise exception 'Invoice SELECT requires the existing forced RLS relation';
  end if;
  select * into policy from pg_policy where polrelid='public.invoices'::regclass and polname='invoices_select_scoped';
  if policy.oid is null or policy.polcmd<>'r' or not policy.polpermissive
     or policy.polwithcheck is not null
     or policy.polroles is distinct from array[(select oid from pg_roles where rolname='authenticated')]::oid[]
     or (select count(*) from pg_policy where polrelid='public.invoices'::regclass and polcmd in ('r','*'))<>1 then
    raise exception 'Invoice SELECT policy authority changed';
  end if;
  if md5(pg_get_expr(policy.polqual,policy.polrelid)) is distinct from 'b98ae2a33d3ea921e69911f4f350e677' then
    raise exception 'Invoice SELECT expected the exact pre-optimization policy';
  end if;
  perform set_config('search_path',old_path,true);
end;
$invoice_select_baseline$;

alter policy invoices_select_scoped on public.invoices using (
  tenant_id = (select public.current_tenant_id())
  and case when (select public.is_finance_accounting()) then
    (select nullif(public.current_finance_user_id(), '') is not null
        and nullif(public.finance_current_verified_google_email_v2(), '') is not null)
  else public.can_read_invoice(invoices.*) end
);

do $invoice_select_installed$
declare expression_hash text;old_path text:=current_setting('search_path');
begin
  perform set_config('search_path','public, pg_catalog',true);
  select md5(regexp_replace(pg_get_expr(polqual,polrelid),'[[:space:]]','','g'))
    into expression_hash from pg_policy
    where polrelid='public.invoices'::regclass and polname='invoices_select_scoped';
  if expression_hash is distinct from 'e50dd8e96ba20f4a64eb6d3158a53535' then
    raise exception 'Invoice SELECT optimization did not install the sealed expression';
  end if;
  perform set_config('search_path',old_path,true);
end;
$invoice_select_installed$;

notify pgrst, 'reload schema';
