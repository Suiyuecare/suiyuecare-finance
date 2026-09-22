\set ON_ERROR_STOP on
-- Pure catalog checks. No claims, source writes, grants, or policy mutations.
do $invoice_select_postflight$
declare audit_security_installed boolean:=false;expected record;proc record;policy record;old_path text:=current_setting('search_path');
begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    execute $audit_ledger$select exists(select 1 from supabase_migrations.schema_migrations where version='20260922133752')$audit_ledger$ into audit_security_installed;
  end if;
  perform set_config('search_path','public, pg_catalog',true);
  for expected in select * from (values
    ('public.can_read_invoice(public.invoices)',(case when audit_security_installed then '5ccbaefe4040cdb85ceb123d05aef6db' else 'd761ec0bbd1544410ae52bd860ec78b6' end),false,'search_path=""'),
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
  if md5(regexp_replace(pg_get_expr(policy.polqual,policy.polrelid),'[[:space:]]','','g')) is distinct from 'e50dd8e96ba20f4a64eb6d3158a53535' then
    raise exception 'Invoice SELECT optimized policy differs from the sealed expression';
  end if;
  if not has_function_privilege('authenticated','public.finance_statement_source_page_v1(text,text,integer,integer)','execute')
     or has_function_privilege('anon','public.finance_statement_source_page_v1(text,text,integer,integer)','execute')
     or has_function_privilege('service_role','public.finance_statement_source_page_v1(text,text,integer,integer)','execute') then
    raise exception 'Invoice source paging execution boundary changed';
  end if;
  perform set_config('search_path',old_path,true);
end;
$invoice_select_postflight$;
