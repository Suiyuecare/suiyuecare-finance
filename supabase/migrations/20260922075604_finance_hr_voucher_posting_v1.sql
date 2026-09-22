-- Dedicated HR settlement posting. Never writes payroll people/bank details to general books.
set local lock_timeout='5s';
set local statement_timeout='120s';
create table finance_hr_private.finance_hr_postings (
 obligation_id uuid primary key references finance_hr_private.finance_hr_obligations(obligation_id),
 voucher_id text unique not null, tenant_id uuid not null, entity_id text not null,
 actor_id text not null, voucher_date date not null, entries jsonb not null,
 total numeric not null check(total>0), description text not null,
 writing_transaction text not null, created_at timestamptz not null default now()
);
alter table finance_hr_private.finance_hr_postings enable row level security;
alter table finance_hr_private.finance_hr_postings force row level security;
revoke all on finance_hr_private.finance_hr_postings from public,anon,authenticated,service_role;
create trigger immutable before update or delete on finance_hr_private.finance_hr_postings for each row execute function finance_hr_private.finance_hr_immutable();

-- Fail the entire affected-company query instead of returning incomplete totals.
create function finance_hr_private.finance_hr_accounting_scope(p_tenant uuid,p_entity text,p_environment text) returns boolean language plpgsql stable security definer set search_path='' as $$
declare a public.finance_users;env text:=coalesce(nullif(btrim(p_environment),''),'production');begin
 if env='test' then return true;end if;
 if env<>'production' then raise exception 'FINANCE_HR_INVALID_ENVIRONMENT' using errcode='22023';end if;
 a:=public.current_finance_user();
 if exists(select 1 from finance_hr_private.finance_hr_postings p join finance_hr_private.finance_hr_obligations o using(obligation_id)
 where p.tenant_id=p_tenant and (p_entity is null or p.entity_id=p_entity)
 and (auth.uid() is null or a.id is null or a.auth_user_id is distinct from auth.uid() or a.tenant_id is distinct from p_tenant or not finance_hr_private.finance_hr_reader(o.tenant_id,o.source_employer_id,a.id))) then
 raise exception 'FINANCE_HR_COMPLETE_REPORT_AUTHORIZATION_REQUIRED' using errcode='42501';end if;
 return true;
end $$;
create function public.finance_hr_accounting_scope(p_tenant uuid,p_entity text,p_environment text) returns boolean language sql security invoker set search_path='' as $$select finance_hr_private.finance_hr_accounting_scope(p_tenant,p_entity,p_environment)$$;
do $$ declare t text; begin
 foreach t in array array['vouchers','ledger_entries','cash_movement_evidence_links','finance_ledger_source_chains','accounting_posting_locks','cash_flow_bank_support_cases'] loop
  execute format('create policy hr_salary_complete_scope on public.%I as restrictive for select to authenticated using (public.finance_hr_accounting_scope(tenant_id,entity_id,data_environment))',t);
 end loop;
end $$;
-- These report functions bypass RLS. Patch only their reviewed exact baseline;
-- all original authority/period/completeness checks remain in place.
do $guard_reports$
declare item record;def text;body text;begin_count integer; begin
 for item in select * from (values
 ('public.finance_executive_dashboard_v2(date,date,date,date,date,text,text)','84043dbdd33bd3e4152f61727e25b202',E'  perform finance_hr_private.finance_hr_accounting_scope((public.current_finance_user()).tenant_id,nullif(nullif(btrim(p_entity_id),\'\'),\'all\'),p_data_environment);\n'),
 ('public.finance_executive_dashboard_v3(date,date,date,date,date,text,text)','36e536eb3ccfc071a8541719022597f1',E' perform finance_hr_private.finance_hr_accounting_scope((public.current_finance_user()).tenant_id,nullif(nullif(btrim(p_entity_id),\'\'),\'all\'),p_data_environment);\n'),
 ('private.finance_ar_reconciliation_scope_v1(uuid,text,date,text,text)','edaf8ff23d45c773419606e543e4632e',E' perform finance_hr_private.finance_hr_accounting_scope(p_tenant,nullif(p_entity,\'all\'),p_environment);\n'),
 ('private.finance_audit_source_v1(uuid,text,text)','47626680b97580121d172b6b79feb806',E' perform finance_hr_private.finance_hr_accounting_scope(t,e,env);\n')
 ) p(signature,body_md5,guard) loop
  select pg_get_functiondef(oid),prosrc into def,body from pg_proc where oid=item.signature::regprocedure;
  if md5(body)<>item.body_md5 then raise exception 'HR report guard requires reviewed baseline: %',item.signature;end if;
  def:=regexp_replace(def,E'\\mbegin\\M',E'begin\n'||item.guard,'i');
  execute def;
 end loop;
end $guard_reports$;

create function finance_hr_private.finance_hr_guard_book_insert() returns trigger language plpgsql security definer set search_path='' as $$
declare p finance_hr_private.finance_hr_postings; line jsonb; begin
 if tg_table_name='vouchers' then
  if coalesce(new.request_id,'') not like 'hr:%' and coalesce(new.id,'') not like 'HRV%' then return new;end if;
  select * into p from finance_hr_private.finance_hr_postings where voucher_id=new.id;
  if p.voucher_id is null or p.writing_transaction is distinct from pg_current_xact_id()::text or p.tenant_id is distinct from new.tenant_id or p.entity_id is distinct from new.entity_id or new.no is distinct from p.voucher_id or new.posting_locked_at is null or new.adjusts_voucher_no is not null or new.adjustment_type is not null or new.request_id is distinct from 'hr:'||p.obligation_id::text or new.entries is distinct from p.entries or new.total is distinct from p.total or new.description is distinct from p.description or new.voucher_date is distinct from p.voucher_date or new.posted is distinct from true or new.posted_at is null or new.data_environment is distinct from 'production' then raise exception 'FINANCE_HR_ATOMIC_POSTING_REQUIRED' using errcode='42501';end if;
 else
  if coalesce(new.source_type,'')<>'hr_payroll' and coalesce(new.voucher_no,'') not like 'HRV%' and coalesce(new.posting_key,'') not like 'hr:%' then return new;end if;
  select * into p from finance_hr_private.finance_hr_postings where voucher_id=new.voucher_no;
  if p.voucher_id is null or p.writing_transaction is distinct from pg_current_xact_id()::text or p.tenant_id is distinct from new.tenant_id or p.entity_id is distinct from new.entity_id or new.source_type is distinct from 'hr_payroll' or new.source_id is distinct from p.obligation_id::text or new.reference_no is distinct from p.voucher_id or new.source_no is distinct from p.voucher_id or new.description is distinct from p.description or new.entry_date is distinct from p.voucher_date or new.data_environment is distinct from 'production' or not exists(select 1 from jsonb_array_elements(p.entries) with ordinality e(value,ordinal) where new.posting_key='hr:'||p.obligation_id::text||':'||e.ordinal and e.value->>'ac'=new.account_code and e.value->>'an'=new.account_name and coalesce(new.department_code,'')='' and (case when e.value->>'t'='dr' then (e.value->>'amt')::numeric else 0 end)=new.debit and (case when e.value->>'t'='cr' then (e.value->>'amt')::numeric else 0 end)=new.credit) then raise exception 'FINANCE_HR_ATOMIC_POSTING_REQUIRED' using errcode='42501';end if;
 end if; return new;
end $$;
create unique index hr_payroll_ledger_once on public.ledger_entries(tenant_id,data_environment,posting_key) where source_type='hr_payroll';
create trigger hr_atomic_posting before insert on public.vouchers for each row execute function finance_hr_private.finance_hr_guard_book_insert();
create trigger hr_atomic_posting before insert on public.ledger_entries for each row execute function finance_hr_private.finance_hr_guard_book_insert();

create function finance_hr_private.finance_hr_voucher_options(p_obligation_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare a public.finance_users;o finance_hr_private.finance_hr_obligations;begin
 a:=public.current_finance_user();select * into o from finance_hr_private.finance_hr_obligations where obligation_id=p_obligation_id;
 if auth.uid() is null or a.id is null or a.auth_user_id is distinct from auth.uid() or o.tenant_id is distinct from a.tenant_id or not finance_hr_private.finance_hr_reader(o.tenant_id,o.source_employer_id,a.id) then raise exception 'FINANCE_HR_FORBIDDEN' using errcode='42501';end if;
 return jsonb_build_object('accounts',coalesce((select jsonb_agg(jsonb_build_object('code',i->>'c','name',i->>'n') order by i->>'c') from public.system_settings s cross join lateral jsonb_array_elements(case when jsonb_typeof(s.value)='array' then s.value else '[]' end) i where s.tenant_id=o.tenant_id and s.key='accounts' and i->>'c'<>'1144' and private.finance_tenant_account_name(o.tenant_id,i->>'c') is not null),'[]'::jsonb),
 'voucher',(select jsonb_build_object('id',p.voucher_id,'date',p.voucher_date,'entries',p.entries,'total',p.total,'description',p.description) from finance_hr_private.finance_hr_postings p where p.obligation_id=o.obligation_id));
end $$;
create function public.finance_hr_voucher_options(p_obligation_id uuid) returns jsonb language sql security invoker set search_path='' as $$select finance_hr_private.finance_hr_voucher_options(p_obligation_id)$$;

create function finance_hr_private.finance_hr_post_voucher(p_obligation_id uuid,p_expected_version integer,p_request_id uuid,p_voucher_date date,p_entries jsonb,p_evidence jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.finance_users;o finance_hr_private.finance_hr_obligations;r finance_hr_private.finance_hr_routes;existing finance_hr_private.finance_hr_requests;
 h text;entry jsonb;canonical jsonb:='[]';name text;amount numeric;dr numeric:=0;cr numeric:=0;num text;description text;idx integer:=0;result jsonb;inner_request uuid;
begin
 a:=public.current_finance_user();
 if auth.uid() is null or a.id is null or a.auth_user_id is distinct from auth.uid() or not a.active then raise exception 'FINANCE_HR_FORBIDDEN' using errcode='42501';end if;
 if p_request_id is null or p_expected_version is null or p_voucher_date is null or jsonb_typeof(p_entries) is distinct from 'array' or jsonb_array_length(p_entries) not between 2 and 50 or octet_length(p_entries::text)>32000 then raise exception 'FINANCE_HR_INVALID_POSTING';end if;
 h:=finance_hr_private.finance_hr_hash(jsonb_build_object('id',p_obligation_id,'version',p_expected_version,'date',p_voucher_date,'entries',p_entries,'evidence',p_evidence));
 perform pg_advisory_xact_lock(hashtextextended(p_obligation_id::text,617));
 select * into o from finance_hr_private.finance_hr_obligations where obligation_id=p_obligation_id for update;
 if o.obligation_id is null or o.tenant_id<>a.tenant_id or not finance_hr_private.finance_hr_reader(o.tenant_id,o.source_employer_id,a.id) then raise exception 'FINANCE_HR_FORBIDDEN' using errcode='42501';end if;
 select * into r from finance_hr_private.finance_hr_routes where id=o.route_id;
 if not finance_hr_private.finance_hr_route_active(r) then raise exception 'FINANCE_HR_ROUTE_UNVERIFIED';end if;
 if o.route_snapshot->4->>'actorId' is distinct from a.id then raise exception 'FINANCE_HR_NOT_ASSIGNEE' using errcode='42501';end if;
 perform public.assert_accounting_actor();
 if not private.finance_expense_optional_permission_allows(o.tenant_id,a.id,'finance.accounting.subject.edit',jsonb_build_object('assignee_finance_user_id',a.id,'company_id',o.legal_entity_code,'entity_id',o.legal_entity_code,'resource_type','hr_payroll','resource_id',o.obligation_id,'workflow_step_key','accountant_final')) then raise exception 'FINANCE_HR_ACCOUNTING_PERMISSION_REQUIRED' using errcode='42501';end if;
 select * into existing from finance_hr_private.finance_hr_requests where request_id=p_request_id;
 if found then if existing.operation<>'post_voucher' or existing.actor_id<>a.id or existing.obligation_id<>o.obligation_id or existing.payload_hash<>h then raise exception 'FINANCE_HR_REPLAY_CONFLICT';end if;return existing.result||jsonb_build_object('replayed',true);end if;
 if o.version<>p_expected_version then raise exception 'FINANCE_HR_VERSION_CONFLICT' using errcode='40001';end if;
 if o.status<>'pending_voucher' or o.stage_index<>4 then raise exception 'FINANCE_HR_ACTION_OUT_OF_ORDER';end if;
 perform finance_hr_private.finance_hr_evidence(p_evidence,'posted_voucher');
 perform private.finance_assert_period_open(o.tenant_id,'production',o.legal_entity_code,p_voucher_date,'人資付款傳票入帳');
 for entry in select * from jsonb_array_elements(p_entries) loop
  if jsonb_typeof(entry) is distinct from 'object' or exists(select 1 from jsonb_object_keys(entry) k where k<>all(array['t','ac','amt'])) or coalesce(entry->>'t','') not in ('dr','cr') or coalesce(entry->>'amt','') !~ '^[0-9]{1,12}([.][0-9]{1,2})?$' or entry->>'ac'='1144' then raise exception 'FINANCE_HR_INVALID_ENTRY';end if;
  amount:=(entry->>'amt')::numeric;name:=private.finance_tenant_account_name(o.tenant_id,entry->>'ac');
  if amount<=0 or name is null then raise exception 'FINANCE_HR_INVALID_ACCOUNT_OR_AMOUNT';end if;
  canonical:=canonical||jsonb_build_array(jsonb_build_object('t',entry->>'t','ac',entry->>'ac','an',name,'dept','','amt',amount));
  if entry->>'t'='dr' then dr:=dr+amount;else cr:=cr+amount;end if;
 end loop;
 if dr<>cr or dr<>o.total_net_cents/100.0 then raise exception 'FINANCE_HR_ENTRIES_UNBALANCED_OR_AMOUNT_MISMATCH';end if;
 -- Post only the net payment settlement; gross payroll accrual/deductions remain
 -- separate accounting work and are never guessed from the net amount.
 num:=private.finance_next_voucher_no_for_tenant(o.tenant_id,'HRV',p_voucher_date,'production');
 description:='人資核准付款結算 '||o.period||case when o.kind='bonus' then ' 獎金' else ' 薪資' end;
 insert into finance_hr_private.finance_hr_postings(obligation_id,voucher_id,tenant_id,entity_id,actor_id,voucher_date,entries,total,description,writing_transaction) values(o.obligation_id,num,o.tenant_id,o.legal_entity_code,a.id,p_voucher_date,canonical,dr,description,pg_current_xact_id()::text);
 insert into public.vouchers(id,no,request_id,entity_id,entity_name,voucher_date,description,entries,total,creator,posted,posted_at,posting_locked_at,data_environment,tenant_id)
 values(num,num,'hr:'||o.obligation_id::text,o.legal_entity_code,o.legal_entity_code,p_voucher_date,description,canonical,dr,a.name,true,clock_timestamp(),clock_timestamp(),'production',o.tenant_id);
 for entry in select * from jsonb_array_elements(canonical) loop
  idx:=idx+1;
  insert into public.ledger_entries(entry_date,description,entity_id,department_code,debit,credit,account_code,account_name,reference_no,posting_key,source_type,source_id,source_no,voucher_no,data_environment,tenant_id)
  values(p_voucher_date,description,o.legal_entity_code,'',case when entry->>'t'='dr' then (entry->>'amt')::numeric else 0 end,case when entry->>'t'='cr' then (entry->>'amt')::numeric else 0 end,entry->>'ac',entry->>'an',num,'hr:'||o.obligation_id::text||':'||idx,'hr_payroll',o.obligation_id::text,num,num,'production',o.tenant_id);
 end loop;
 result:=finance_hr_private.finance_hr_command(o.obligation_id,o.version,gen_random_uuid(),'posted_voucher',p_evidence||jsonb_build_object('voucherId',num));
 result:=result||jsonb_build_object('voucherId',num,'voucherNo',num,'replayed',false);
 insert into finance_hr_private.finance_hr_requests(request_id,operation,actor_id,obligation_id,payload_hash,result) values(p_request_id,'post_voucher',a.id,o.obligation_id,h,result);
 return result;
end $$;
create function public.finance_hr_post_voucher(p_obligation_id uuid,p_expected_version integer,p_request_id uuid,p_voucher_date date,p_entries jsonb,p_evidence jsonb) returns jsonb language sql security invoker set search_path='' as $$select finance_hr_private.finance_hr_post_voucher(p_obligation_id,p_expected_version,p_request_id,p_voucher_date,p_entries,p_evidence)$$;
do $$declare f record;begin
 for f in select p.oid::regprocedure signature,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','finance_hr_private') and p.proname in('finance_hr_accounting_scope','finance_hr_guard_book_insert','finance_hr_voucher_options','finance_hr_post_voucher') loop
 execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
 if f.proname<>'finance_hr_guard_book_insert' then execute format('grant execute on function %s to authenticated',f.signature);end if;
 end loop;
end $$;

create function finance_hr_private.finance_hr_attachment_scope(p_tenant uuid,p_record_type text,p_record_no text,p_environment text) returns boolean language plpgsql stable security definer set search_path='' as $$
declare p finance_hr_private.finance_hr_postings;begin
 if p_record_type is distinct from 'vouchers' then return true;end if;
 select * into p from finance_hr_private.finance_hr_postings where tenant_id=p_tenant and voucher_id=p_record_no;
 if p.voucher_id is not null then return finance_hr_private.finance_hr_accounting_scope(p_tenant,p.entity_id,'production');end if;
 if coalesce(p_record_no,'') like 'HRV%' then raise exception 'FINANCE_HR_VOUCHER_ATTACHMENT_SOURCE_REQUIRED' using errcode='42501';end if;
 return true;
end $$;
create function public.finance_hr_attachment_scope(p_tenant uuid,p_record_type text,p_record_no text,p_environment text) returns boolean language sql security invoker set search_path='' as $$select finance_hr_private.finance_hr_attachment_scope(p_tenant,p_record_type,p_record_no,p_environment)$$;
revoke all on function finance_hr_private.finance_hr_attachment_scope(uuid,text,text,text),public.finance_hr_attachment_scope(uuid,text,text,text) from public,anon,authenticated,service_role;
grant execute on function finance_hr_private.finance_hr_attachment_scope(uuid,text,text,text),public.finance_hr_attachment_scope(uuid,text,text,text) to authenticated;
create policy hr_salary_attachment_scope on public.file_attachments as restrictive for select to authenticated using(public.finance_hr_attachment_scope(tenant_id,record_type,record_no,data_environment));
do $guard_attachment$
declare def text;body text;anchor text:=E'        and attachment.storage_path = p_storage_path';begin
 select pg_get_functiondef(oid),prosrc into def,body from pg_proc where oid='public.finance_can_read_voucher_attachment_v2(text)'::regprocedure;
 if md5(body)<>'89722164d300f094f9e2254481a61d60' or (length(def)-length(replace(def,anchor,'')))/length(anchor)<>1 then raise exception 'HR attachment guard requires reviewed baseline';end if;
 execute replace(def,anchor,anchor||E'\n        and finance_hr_private.finance_hr_attachment_scope(attachment.tenant_id,attachment.record_type,attachment.record_no,attachment.data_environment)');
end $guard_attachment$;
