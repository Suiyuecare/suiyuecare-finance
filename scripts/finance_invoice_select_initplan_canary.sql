-- Read-only catalog and absent-identity canary. Positive authorization parity
-- is tested with fictional identities against the exact original SQL bodies.
-- Never installs, borrows, or replaces an employee's Google identity/claims.
begin isolation level repeatable read read only;
set local statement_timeout='15s';
-- FINANCE_AUTHENTICATED_CANARY_CORE_BEGIN
do $invoice_select_canary$
declare expression_hash text;denied boolean:=false;
begin
  -- pg_get_expr qualifies the public functions only when public is absent from
  -- the caller path. Normalize that qualifier without changing caller context.
  select md5(regexp_replace(regexp_replace(pg_get_expr(polqual,polrelid),'\mpublic\.','','g'),'[[:space:]]','','g'))
    into expression_hash from pg_policy
    where polrelid='public.invoices'::regclass and polname='invoices_select_scoped';
  if expression_hash is distinct from 'e50dd8e96ba20f4a64eb6d3158a53535' then
    raise exception 'Invoice SELECT canary requires the exact optimized predicate';
  end if;
  if auth.uid() is not null then
    raise exception 'Invoice SELECT canary requires an absent-identity release context';
  end if;
  begin
    perform public.finance_statement_source_page_v1('invoices','production',1,0);
  exception when insufficient_privilege then denied:=true;
  end;
  if not denied then raise exception 'Invoice source paging accepted absent identity';end if;
  if has_function_privilege('anon','public.finance_statement_source_page_v1(text,text,integer,integer)','execute')
    or has_function_privilege('service_role','public.finance_statement_source_page_v1(text,text,integer,integer)','execute') then
    raise exception 'Invoice source paging execution boundary changed';
  end if;
end;
$invoice_select_canary$;
-- FINANCE_AUTHENTICATED_CANARY_CORE_END
rollback;
-- FINANCE_AUTHENTICATED_CANARY_ROLLBACK_CHECK_BEGIN
do $invoice_select_rollback$
begin
  -- Both rehearsals and installed releases use this marker. The surrounding
  -- complete catalog/data fingerprint proves restoration of the policy itself.
  if exists(select 1 from pg_proc where oid=to_regprocedure('public.finance_statement_source_page_v1(text,text,integer,integer)')
      and (prosecdef or md5(prosrc)<>'fe39d7ec0b151e30cc36e9e2cb7538dc'))
    or to_regprocedure('public.finance_statement_source_page_v1(text,text,integer,integer)') is null then
    raise exception 'Invoice source paging changed across the read-only canary';
  end if;
end;
$invoice_select_rollback$;
-- FINANCE_AUTHENTICATED_CANARY_ROLLBACK_CHECK_END
select jsonb_build_object('canary','readonly_invoice_select_initplan_v1','ok',true,'rolled_back',true,'ordinary_scope_preserved',true) as invoice_select_initplan_canary_result;
