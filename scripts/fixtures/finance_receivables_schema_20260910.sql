-- Structural fixture captured from the production catalog, no operational rows.
create table public.bank_reconciliation_matches(id text default ('brm_'::text || replace((gen_random_uuid())::text, '-'::text, ''::text)),data_environment text default 'production'::text,bank_transaction_id text,match_type text,target_table text,target_id text,target_no text,matched_amount numeric,confidence numeric,match_method text default 'manual'::text,matched_by text,matched_at timestamptz default now(),note text,created_at timestamptz default now(),updated_at timestamptz default now(),tenant_id uuid default default_tenant_id());
create table public.bank_transactions(id text default ('bt_'::text || replace((gen_random_uuid())::text, '-'::text, ''::text)),data_environment text default 'production'::text,import_id text,bank_account_id text,entity_id text,transaction_date date,value_date date,description text,counterparty text,reference_no text,bank_trace_no text,amount numeric,balance_after numeric,raw_payload jsonb default '{}'::jsonb,match_status text default 'unmatched'::text,ignored_reason text,created_at timestamptz default now(),updated_at timestamptz default now(),tenant_id uuid default default_tenant_id());
create table public.invoice_lifecycle_events(id text,data_environment text default 'production'::text,invoice_id text,invoice_no text,event_type text,event_no text,event_date date default CURRENT_DATE,reason text,amount numeric default 0,tax numeric default 0,total numeric default 0,settlement_account_code text,settlement_account_name text,voucher_id text,voucher_no text,status text default 'posted'::text,refund_amount numeric default 0,refund_voucher_id text,refund_voucher_no text,refund_bank_transaction_id text,refunded_at timestamptz,replacement_invoice_id text,replacement_invoice_no text,created_by text,created_at timestamptz default now(),updated_at timestamptz default now(),tenant_id uuid default default_tenant_id());
create table public.receivable_followup_events(id uuid default gen_random_uuid(),followup_id uuid,source_table text,source_id text,source_no text,data_environment text default 'production'::text,event_type text,event_key text default ''::text,event_note text,event_payload jsonb default '{}'::jsonb,created_by text,created_at timestamptz default now(),tenant_id uuid default default_tenant_id());
create table public.vouchers(id text,no text,request_id text,entity_id text,entity_name text,voucher_date date,description text,entries jsonb default '[]'::jsonb,total numeric default 0,creator text,posted bool default true,created_at timestamptz default now(),posted_at timestamptz default now(),posting_locked_at timestamptz,voided_at timestamptz,adjusts_voucher_no text,adjustment_type text,data_environment text default 'production'::text,tenant_id uuid default default_tenant_id());
create table public.collection_followups(id uuid default gen_random_uuid(),source_table text,source_id text,source_no text,data_environment text default 'production'::text,entity_id text,department_code text,applicant_id text,applicant_name text,payer_name text,source_amount numeric default 0,outstanding_amount numeric default 0,issue_date date,due_date date,paid_at timestamptz,payment_status text default 'unpaid'::text,followup_status text default 'open'::text,followup_stage text default 'not_due'::text,priority text default 'normal'::text,owner_user_id text,owner_name text,last_followup_at timestamptz,next_followup_at date,last_note text,evidence jsonb default '{}'::jsonb,created_at timestamptz default now(),updated_at timestamptz default now(),tenant_id uuid default default_tenant_id());
alter table public.invoices add column source_bill_id text,add column entity_name text,add column created_at timestamptz default now(),add column applicant_id text;
alter table public.bills add column due_date date,add column entity_id text;
alter table public.ledger_entries add column voucher_no text;
alter table public.bank_transactions add constraint fixture_bank_status check(match_status in ('unmatched','matched','manual_review','ignored'));
alter table public.bank_reconciliation_matches add constraint fixture_match_type check(match_type in ('invoice','bill','ledger','expense','manual')),add constraint fixture_match_target check(target_table in ('invoices','bills','ledger_entries','expense_requests','vouchers','manual'));
create unique index fixture_bank_match_unique on public.bank_reconciliation_matches(tenant_id,data_environment,bank_transaction_id,target_table,target_id);
create unique index fixture_voucher_id on public.vouchers(id);
create unique index fixture_lifecycle_id on public.invoice_lifecycle_events(id);
create unique index fixture_bank_id on public.bank_transactions(id);
create sequence private.fixture_voucher_no;create function public.next_voucher_no(text,date,text) returns text language sql as $$select 'FICT-V-'||nextval('private.fixture_voucher_no')::text$$;
create function public.current_finance_role() returns text language sql stable security definer as $$select role from public.finance_users where auth_user_id=auth.uid()$$;
create function public.current_finance_user_name() returns text language sql stable security definer as $$select name from public.finance_users where auth_user_id=auth.uid()$$;
create function public.assert_accounting_actor() returns void language plpgsql as $$begin if public.current_finance_role() not in ('accountant','admin_director','ceo') then raise exception 'denied' using errcode='42501';end if;end;$$;
create function public.finance_executive_dashboard_v2(date,date,date,date,date,text,text) returns jsonb language sql as $$select '{}'::jsonb$$;
CREATE OR REPLACE FUNCTION public.invoice_lifecycle_credit_account(inv invoices)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
begin
  if inv.status = 'paid' or inv.cash_receipt_posted_at is not null or inv.paid_at is not null then
    return jsonb_build_object('code','2131','name','應付費用');
  end if;
  return jsonb_build_object('code','1123','name','應收帳款');
end;
$function$;
CREATE OR REPLACE FUNCTION public.post_invoice_lifecycle_voucher(p_invoice_id text, p_event_type text, p_event_no text, p_reason text, p_amount numeric, p_tax numeric, p_total numeric, p_event_date date DEFAULT CURRENT_DATE)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  inv public.invoices%rowtype;
  v_env text;
  v_event_type text;
  v_event_no text;
  v_reason text;
  v_date date;
  v_amount numeric;
  v_tax numeric;
  v_total numeric;
  v_prior_total numeric := 0;
  credit jsonb;
  credit_code text;
  credit_name text;
  voucher_no text;
  event_id text;
  entries jsonb := '[]'::jsonb;
  entry_idx int := 0;
  entry jsonb;
begin
  perform public.assert_accounting_actor();
  v_event_type := lower(coalesce(nullif(p_event_type,''),''));
  if v_event_type not in ('void','allowance') then raise exception 'Unsupported invoice lifecycle posting event: %', p_event_type; end if;
  v_reason := trim(coalesce(p_reason,''));
  if v_reason='' then raise exception 'Invoice lifecycle reason is required'; end if;
  select * into inv from public.invoices where id=p_invoice_id for update;
  if not found then raise exception 'Invoice not found: %', p_invoice_id; end if;
  v_env := coalesce(inv.data_environment,'production');
  v_date := coalesce(p_event_date,current_date);
  if v_event_type='void' and exists (select 1 from public.invoice_lifecycle_events e where e.data_environment=v_env and e.invoice_id=inv.id and e.event_type='void' and e.status <> 'voided') then raise exception 'Invoice % already has a void lifecycle event', inv.no; end if;
  if v_event_type='allowance' and inv.voided_at is not null then raise exception 'Voided invoice cannot receive an allowance: %', inv.no; end if;
  v_total := round(coalesce(p_total,0),2);
  v_tax := round(coalesce(p_tax,0),2);
  v_amount := round(coalesce(p_amount,v_total-v_tax),2);
  if v_event_type='void' then
    v_total := round(coalesce(inv.total, coalesce(inv.amount,0)+coalesce(inv.tax,0),0),2);
    v_tax := round(greatest(0,coalesce(inv.tax,0)),2);
    v_amount := round(greatest(0,v_total-v_tax),2);
  end if;
  if v_total <= 0 then raise exception 'Invoice lifecycle total must be positive'; end if;
  if round(v_amount+v_tax-v_total,2)<>0 then raise exception 'Invoice lifecycle amount + tax must equal total'; end if;
  select coalesce(sum(total),0) into v_prior_total from public.invoice_lifecycle_events e where e.data_environment=v_env and e.invoice_id=inv.id and e.event_type in ('void','allowance') and e.status <> 'voided';
  if v_prior_total + v_total > coalesce(inv.total,0) + 0.5 then raise exception 'Invoice lifecycle events exceed invoice total: invoice %, prior %, new %', inv.no, v_prior_total, v_total; end if;
  credit := public.invoice_lifecycle_credit_account(inv);
  credit_code := credit ->> 'code'; credit_name := credit ->> 'name';
  v_event_no := coalesce(nullif(p_event_no,''), upper(v_event_type)||'-'||coalesce(inv.no,inv.id));
  voucher_no := public.next_voucher_no(case when v_event_type='void' then 'IVVOID' else 'IVALW' end, v_date, v_env);
  event_id := 'ile_' || md5(v_env || ':' || v_event_no);
  entries := jsonb_build_array(jsonb_build_object('t','dr','ac','4198','an','銷貨退回及折讓','dept',inv.department_code,'amt',v_amount));
  if v_tax > 0 then entries := entries || jsonb_build_array(jsonb_build_object('t','dr','ac','2134','an','銷項稅額','dept',inv.department_code,'amt',v_tax)); end if;
  entries := entries || jsonb_build_array(jsonb_build_object('t','cr','ac',credit_code,'an',credit_name,'dept',inv.department_code,'amt',v_total));
  insert into public.vouchers(id,no,request_id,entity_id,entity_name,voucher_date,description,entries,total,creator,posted,posted_at,posting_locked_at,adjusts_voucher_no,adjustment_type,data_environment)
  values (voucher_no,voucher_no,inv.id,inv.entity_id,inv.entity_name,v_date,case when v_event_type='void' then '發票作廢沖銷 — ' else '發票折讓沖銷 — ' end || coalesce(inv.no,inv.id) || ' — ' || v_reason,entries,v_total,coalesce(public.current_finance_user_name(),'system'),true,now(),now(),inv.no,'adjustment',v_env);
  for entry in select * from jsonb_array_elements(entries) loop
    entry_idx := entry_idx + 1;
    insert into public.ledger_entries(entry_date,description,entity_id,department_code,debit,credit,account_code,account_name,reference_no,posting_key,source_type,source_id,source_no,voucher_no,data_environment)
    values (v_date,case when v_event_type='void' then '發票作廢沖銷 — ' else '發票折讓沖銷 — ' end || coalesce(inv.no,inv.id),inv.entity_id,coalesce(entry ->> 'dept',inv.department_code),case when entry ->> 't'='dr' then (entry ->> 'amt')::numeric else 0 end,case when entry ->> 't'='cr' then (entry ->> 'amt')::numeric else 0 end,entry ->> 'ac',entry ->> 'an',v_event_no,'invoice_lifecycle:'||v_event_no||':'||entry_idx||':'||(entry ->> 'ac')||':'||(entry ->> 't'),v_event_type||'_invoice',event_id,v_event_no,voucher_no,v_env)
    on conflict (data_environment, posting_key) where posting_key is not null do nothing;
  end loop;
  insert into public.invoice_lifecycle_events(id,data_environment,invoice_id,invoice_no,event_type,event_no,event_date,reason,amount,tax,total,settlement_account_code,settlement_account_name,voucher_id,voucher_no,status,created_by)
  values (event_id,v_env,inv.id,coalesce(inv.no,inv.id),v_event_type,v_event_no,v_date,v_reason,v_amount,v_tax,v_total,credit_code,credit_name,voucher_no,voucher_no,'posted',coalesce(public.current_finance_user_name(),'system'));
  if v_event_type='void' then update public.invoices set status='voided', voided_at=coalesce(voided_at,now()) where id=inv.id; end if;
  return jsonb_build_object('ok',true,'event_id',event_id,'event_no',v_event_no,'voucher_id',voucher_no,'voucher_no',voucher_no,'settlement_account_code',credit_code,'total',v_total);
end;
$function$;-- The legacy lifecycle writer is invoker-secured in production. Reproduce its
-- table privileges in the fixture; its accounting-role gate remains real.
grant select,insert,update on public.invoice_lifecycle_events,public.vouchers,public.bank_transactions,public.bank_reconciliation_matches to authenticated;
grant usage on schema private to authenticated;
grant usage on sequence private.fixture_voucher_no to authenticated;
alter table public.ledger_entries alter column tenant_id set default public.default_tenant_id();

create function public.is_finance_accounting() returns boolean language sql stable as $$select public.current_finance_role() in ('accountant','admin_director','ceo')$$;
create function public.is_finance_admin() returns boolean language sql stable as $$select false$$;
alter table public.ledger_entries add column id uuid default gen_random_uuid();
