-- Read-only result check for a lost post_invoice_revenue_v2 response. The
-- applicant can approve delivery but cannot SELECT accounting ledger rows.
-- This function returns only the disposition of an invoice the caller may read.
do $preflight$
declare v_missing text;
begin
 if to_regclass('public.invoices') is null or to_regclass('public.ledger_entries') is null
  or to_regprocedure('public.current_tenant_id()') is null
  or to_regprocedure('public.current_finance_user_id()') is null
  or to_regprocedure('public.can_read_invoice(public.invoices)') is null then
  raise exception 'invoice revenue result prerequisites are missing' using errcode='55000';
 end if;
 select c.table_name||'.'||c.column_name into v_missing from (values
  ('invoices','id'),('invoices','tenant_id'),('invoices','data_environment'),
  ('invoices','no'),('invoices','entity_id'),('invoices','department_code'),
  ('invoices','total'),('invoices','amount'),('invoices','tax'),
  ('invoices','revenue_account_code'),('invoices','revenue_posted'),
  ('invoices','revenue_posted_at'),('invoices','revenue_posting_state'),
  ('invoices','revenue_posting_version'),('invoices','voided_at'),
  ('ledger_entries','tenant_id'),('ledger_entries','data_environment'),
  ('ledger_entries','voided_at'),('ledger_entries','posting_key'),
  ('ledger_entries','source_type'),('ledger_entries','source_id'),
  ('ledger_entries','reference_no'),('ledger_entries','entity_id'),
  ('ledger_entries','department_code'),('ledger_entries','account_code'),
  ('ledger_entries','debit'),('ledger_entries','credit')
 ) c(table_name,column_name)
 where not exists(select 1 from information_schema.columns col
  where col.table_schema='public' and col.table_name=c.table_name and col.column_name=c.column_name)
 limit 1;
 if v_missing is not null then
  raise exception 'invoice revenue result prerequisite column missing: %',v_missing using errcode='55000';
 end if;
end;
$preflight$;

create function public.finance_invoice_revenue_result_v1(p_invoice_id text,p_data_environment text)
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare
 v_tenant uuid:=public.current_tenant_id();
 v_actor text:=public.current_finance_user_id();
 i public.invoices%rowtype;
 v_total numeric;v_tax numeric;v_net numeric;v_version integer;
 v_prefix text;v_keys text[];v_family_ok boolean;v_matches integer:=0;
begin
 if auth.uid() is null or v_tenant is null or nullif(v_actor,'') is null
  or nullif(btrim(p_invoice_id),'') is null
  or p_data_environment is null or p_data_environment not in ('production','test') then
  raise exception '無權核對此發票收入結果' using errcode='42501';
 end if;
 select * into i from public.invoices invoice_row
  where invoice_row.id=p_invoice_id and invoice_row.tenant_id=v_tenant
   and invoice_row.data_environment=p_data_environment;
 if not found or public.can_read_invoice(i) is distinct from true then
  raise exception '無權核對此發票收入結果' using errcode='42501';
 end if;
 -- Flags alone are not proof: a failed or historical partial posting can
 -- leave them inconsistent. Require exactly one complete, balanced family of
 -- source-bound journal rows, including the legacy key formats already used
 -- by finance_receipt_revenue_ready_v1.
 if i.voided_at is null and coalesce(i.revenue_posted,false) is true
  and i.revenue_posted_at is not null and i.revenue_posting_state='posted' then
  v_total:=coalesce(i.total,i.amount,0);v_tax:=coalesce(i.tax,0);v_net:=v_total-v_tax;
  if v_total>0 and v_tax>=0 and v_net>0 and nullif(i.revenue_account_code,'') is not null then
   v_version:=greatest(2,coalesce(i.revenue_posting_version,2));
   foreach v_prefix in array array[
    'tenant:'||i.tenant_id::text||':invoice:'||i.no||':revenue:v'||v_version,
    'invoice:'||i.no||':revenue:v'||v_version,
    'invoice:'||i.no||':revenue'
   ] loop
    v_keys:=array[v_prefix||':ar',v_prefix||':income',v_prefix||':output_tax'];
    select count(*)=case when v_tax>0 then 3 else 2 end
     and count(*) filter(where l.source_type='invoice' and l.source_id=i.id and l.reference_no=i.no
      and l.entity_id=i.entity_id and l.department_code is not distinct from i.department_code)=count(*)
     and count(*) filter(where l.posting_key=v_keys[1] and l.account_code='1123'
      and abs(coalesce(l.debit,0)-v_total)<=0.01 and coalesce(l.credit,0)=0)=1
     and count(*) filter(where l.posting_key=v_keys[2] and l.account_code=i.revenue_account_code
      and abs(coalesce(l.credit,0)-v_net)<=0.01 and coalesce(l.debit,0)=0)=1
     and ((v_tax=0 and count(*) filter(where l.posting_key=v_keys[3])=0)
      or (v_tax>0 and count(*) filter(where l.posting_key=v_keys[3] and l.account_code='2134'
       and abs(coalesce(l.credit,0)-v_tax)<=0.01 and coalesce(l.debit,0)=0)=1))
     and abs(coalesce(sum(l.debit),0)-coalesce(sum(l.credit),0))<=0.01 into v_family_ok
    from public.ledger_entries l where l.tenant_id=i.tenant_id and l.data_environment=i.data_environment
     and l.voided_at is null and l.posting_key=any(v_keys);
    if v_family_ok then
     if exists(select 1 from public.ledger_entries l where l.tenant_id=i.tenant_id
      and l.data_environment=i.data_environment and l.source_type='invoice' and l.source_id=i.id
      and l.voided_at is null and position(':revenue:' in coalesce(l.posting_key,''))>0
      and not(l.posting_key=any(v_keys))) then
      v_matches:=0;exit;
     end if;
     v_matches:=v_matches+1;
    end if;
   end loop;
  end if;
 end if;
 return jsonb_build_object('invoice_id',i.id,'tenant_id',i.tenant_id,
  'data_environment',i.data_environment,'confirmed',v_matches=1,
  'posted_at',case when v_matches=1 then i.revenue_posted_at else null end,
  'posting_version',case when v_matches=1 then v_version else null end);
end;
$function$;

revoke all on function public.finance_invoice_revenue_result_v1(text,text) from public,anon,authenticated,service_role;
grant execute on function public.finance_invoice_revenue_result_v1(text,text) to authenticated;
notify pgrst, 'reload schema';
