-- Verified departmental payroll accrual, separate from the existing net-payment
-- settlement. Gross salary/deductions/employer costs are entered from evidence,
-- never inferred from the net payment. Only an independent reviewer can post.
set local lock_timeout='5s';
set local statement_timeout='120s';
create table private.finance_payroll_accruals_v1(
 id uuid primary key,obligation_id uuid not null references finance_hr_private.finance_hr_obligations(obligation_id),
 tenant_id uuid not null,entity_id text not null,period text not null,
 status text not null default 'submitted' check(status in('submitted','returned','posted')),
 version integer not null default 1,author_id text not null,reviewer_id text,review_reason text,
 source_hash text not null,entries jsonb not null,evidence jsonb not null,payload_hash text not null,
 gross_cents bigint not null,deduction_cents bigint not null,net_cents bigint not null,
 employer_cents bigint not null,voucher_id text unique,writing_transaction text,
 created_at timestamptz not null default now(),reviewed_at timestamptz,
 check(gross_cents>0 and deduction_cents>=0 and net_cents>0 and gross_cents=deduction_cents+net_cents and employer_cents>=0),
 check(reviewer_id is null or reviewer_id<>author_id)
);
create unique index finance_payroll_accrual_once_v1 on private.finance_payroll_accruals_v1(obligation_id) where status in('submitted','posted');
create index finance_payroll_accrual_period_v1 on private.finance_payroll_accruals_v1(tenant_id,entity_id,period,created_at desc);
create table private.finance_payroll_evidence_intents_v1(
 id uuid primary key,obligation_id uuid not null references finance_hr_private.finance_hr_obligations(obligation_id),
 tenant_id uuid not null,author_id text not null,auth_user_id uuid not null,path text not null unique,
 created_at timestamptz not null default now()
);
create table private.finance_payroll_accrual_events_v1(
 id uuid primary key default gen_random_uuid(),accrual_id uuid not null references private.finance_payroll_accruals_v1(id),
 version integer not null,action text not null,actor_id text not null,reason text,evidence jsonb not null,
 created_at timestamptz not null default now(),unique(accrual_id,version)
);
do $$declare t text;begin foreach t in array array['finance_payroll_accruals_v1','finance_payroll_evidence_intents_v1','finance_payroll_accrual_events_v1'] loop
 execute format('alter table private.%I enable row level security',t);
 execute format('alter table private.%I force row level security',t);
 execute format('revoke all on private.%I from public,anon,authenticated,service_role',t);
end loop;end $$;
create trigger payroll_event_immutable before update or delete on private.finance_payroll_accrual_events_v1 for each row execute function finance_hr_private.finance_hr_immutable();
create trigger payroll_intent_immutable before update or delete on private.finance_payroll_evidence_intents_v1 for each row execute function finance_hr_private.finance_hr_immutable();

create function private.finance_payroll_actor_v1(p_obligation_id uuid,p_write boolean) returns public.finance_users
 language plpgsql stable security definer set search_path='' as $$
declare a public.finance_users;o finance_hr_private.finance_hr_obligations;
begin
 a:=public.current_finance_user();select * into o from finance_hr_private.finance_hr_obligations where obligation_id=p_obligation_id;
 if auth.uid() is null or a.id is null or a.auth_user_id is distinct from auth.uid() or a.active is distinct from true
  or o.obligation_id is null or o.tenant_id is distinct from a.tenant_id
  or coalesce(public.current_finance_role(),'') not in('accountant','ceo','admin_director')
  or not finance_hr_private.finance_hr_reader(o.tenant_id,o.source_employer_id,a.id)
  or (p_write and coalesce(public.current_finance_role(),'')<>'accountant') then
  raise exception 'PAYROLL_ACCRUAL_FORBIDDEN' using errcode='42501';
 end if;
 perform private.finance_reporting_actor_v1(o.legal_entity_code,'production');
 if not private.finance_expense_optional_permission_allows(o.tenant_id,a.id,'finance.accounting.subject.edit',
  jsonb_build_object('entity_id',o.legal_entity_code,'company_id',o.legal_entity_code,'resource_type','payroll_accrual','resource_id',o.obligation_id)) then
  raise exception 'PAYROLL_ACCRUAL_ACCOUNTING_PERMISSION_REQUIRED' using errcode='42501';
 end if;
 return a;
end $$;
create function private.finance_payroll_storage_scope_v1(p_path text,p_write boolean) returns boolean
 language plpgsql stable security definer set search_path='' as $$
declare i private.finance_payroll_evidence_intents_v1;a public.finance_users;
begin
 select * into i from private.finance_payroll_evidence_intents_v1 where path=p_path;
 if i.id is null then return false;end if;
 begin a:=private.finance_payroll_actor_v1(i.obligation_id,p_write);
 exception when insufficient_privilege then return false;end;
 return i.tenant_id=a.tenant_id and (not p_write or (i.author_id=a.id and i.auth_user_id=auth.uid()
  and not exists(select 1 from private.finance_payroll_accruals_v1 r where r.id=i.id)));
end $$;
insert into storage.buckets(id,name,public,file_size_limit) values('finance-payroll-evidence','finance-payroll-evidence',false,10485760);
create policy payroll_evidence_read_v1 on storage.objects for select to authenticated using(bucket_id='finance-payroll-evidence' and private.finance_payroll_storage_scope_v1(name,false));
create policy payroll_evidence_insert_v1 on storage.objects for insert to authenticated with check(bucket_id='finance-payroll-evidence' and owner_id=auth.uid()::text and private.finance_payroll_storage_scope_v1(name,true));
-- No UPDATE/DELETE: originals are append-only, including an evidence file used by
-- a returned workpaper. A corrected submission receives a new identifier/path.
create policy payroll_evidence_boundary_v1 on storage.objects as restrictive for all to authenticated
 using(bucket_id<>'finance-payroll-evidence' or private.finance_payroll_storage_scope_v1(name,false))
 with check(bucket_id<>'finance-payroll-evidence' or private.finance_payroll_storage_scope_v1(name,true));
create policy payroll_evidence_no_update_v1 on storage.objects as restrictive for update to authenticated using(bucket_id<>'finance-payroll-evidence') with check(bucket_id<>'finance-payroll-evidence');
create policy payroll_evidence_no_delete_v1 on storage.objects as restrictive for delete to authenticated using(bucket_id<>'finance-payroll-evidence');
create policy payroll_evidence_no_anon_v1 on storage.objects as restrictive for all to anon using(bucket_id<>'finance-payroll-evidence') with check(bucket_id<>'finance-payroll-evidence');

create function private.finance_payroll_entries_v1(p_obligation_id uuid,p_entries jsonb) returns jsonb
 language plpgsql stable security definer set search_path='' as $$
declare o finance_hr_private.finance_hr_obligations;a public.finance_users;e jsonb;canonical jsonb:='[]';
 amount numeric;account_name text;component text;dept text;gross bigint:=0;deduction bigint:=0;net bigint:=0;employer bigint:=0;employer_payable bigint:=0;
begin
 a:=private.finance_payroll_actor_v1(p_obligation_id,false);select * into o from finance_hr_private.finance_hr_obligations where obligation_id=p_obligation_id;
 if o.period!~'^[0-9]{4}-(0[1-9]|1[0-2])$' or jsonb_typeof(p_entries) is distinct from 'array'
  or jsonb_array_length(p_entries) not between 2 and 100 or octet_length(p_entries::text)>64000 then raise exception 'PAYROLL_ACCRUAL_INVALID_ENTRIES' using errcode='22023';end if;
 for e in select * from jsonb_array_elements(p_entries) loop
  if jsonb_typeof(e) is distinct from 'object' or exists(select 1 from jsonb_object_keys(e) k where k<>all(array['t','ac','amt','dept','component','an']))
   or coalesce(e->>'amt','')!~'^[0-9]{1,12}([.][0-9]{1,2})?$' then raise exception 'PAYROLL_ACCRUAL_INVALID_ENTRY' using errcode='22023';end if;
  amount:=(e->>'amt')::numeric;component:=e->>'component';dept:=nullif(btrim(e->>'dept'),'');
  account_name:=private.finance_tenant_account_name(o.tenant_id,e->>'ac');
  if amount<=0 or account_name is null or dept is null or component is null or coalesce(e->>'t','') not in('dr','cr')
   or (component in('gross_salary','employer_cost') and (e->>'t'<>'dr' or e->>'ac'!~'^[56]'))
   or (component in('deduction','net_payable','employer_payable') and (e->>'t'<>'cr' or e->>'ac'!~'^2'))
   or component not in('gross_salary','employer_cost','deduction','net_payable','employer_payable')
   or not exists(select 1 from public.system_settings s cross join lateral jsonb_array_elements(case when jsonb_typeof(s.value)='array' then s.value else '[]'::jsonb end) d
     where s.tenant_id=o.tenant_id and s.key='departments' and d->>'c'=dept and d->>'eid'=o.legal_entity_code and coalesce(d->>'active','true')='true')
   or not private.finance_expense_optional_permission_allows(o.tenant_id,a.id,'finance.accounting.subject.edit',
    jsonb_build_object('entity_id',o.legal_entity_code,'company_id',o.legal_entity_code,'department_code',dept)) then
   raise exception 'PAYROLL_ACCRUAL_INVALID_ACCOUNT_DEPARTMENT_OR_COMPONENT' using errcode='22023';end if;
  canonical:=canonical||jsonb_build_array(jsonb_build_object('t',e->>'t','ac',e->>'ac','an',account_name,'amt',amount,'dept',dept,'component',component));
  case component when 'gross_salary' then gross:=gross+(amount*100)::bigint;
   when 'deduction' then deduction:=deduction+(amount*100)::bigint;when 'net_payable' then net:=net+(amount*100)::bigint;
   when 'employer_cost' then employer:=employer+(amount*100)::bigint;when 'employer_payable' then employer_payable:=employer_payable+(amount*100)::bigint;end case;
 end loop;
 if gross<=0 or net<>o.total_net_cents or gross<>deduction+net or employer<>employer_payable then raise exception 'PAYROLL_ACCRUAL_SOURCE_TOTAL_OR_BALANCE_MISMATCH' using errcode='23514';end if;
 -- Compare with approved gross/deductions where the source provides them.
 -- Monthly approved additions/deductions and bonus employee totals are explicit
 -- source amounts; the net amount alone never creates a gross amount.
 if o.kind='monthly' and jsonb_typeof(o.source_snapshot->'lines')='array' then
  if gross<>(select coalesce(sum((x->>'amountCents')::bigint),0) from jsonb_array_elements(o.source_snapshot->'lines') x where x->>'kind'='addition')
   or deduction<>(select coalesce(sum((x->>'amountCents')::bigint),0) from jsonb_array_elements(o.source_snapshot->'lines') x where x->>'kind'='deduction') then
   raise exception 'PAYROLL_ACCRUAL_APPROVED_GROSS_DEDUCTION_MISMATCH' using errcode='23514';end if;
 elsif o.kind='bonus' and jsonb_typeof(o.source_snapshot->'employees')='array' then
  if gross<>(select coalesce(sum((x->>'grossCents')::bigint),0) from jsonb_array_elements(o.source_snapshot->'employees') x)
   or deduction<>(select coalesce(sum((x->>'deductionsCents')::bigint),0) from jsonb_array_elements(o.source_snapshot->'employees') x) then
   raise exception 'PAYROLL_ACCRUAL_APPROVED_GROSS_DEDUCTION_MISMATCH' using errcode='23514';end if;
 end if;
 if exists(select 1 from jsonb_array_elements(canonical) x group by x->>'dept'
  having sum(case when x->>'t'='dr' then (x->>'amt')::numeric else -(x->>'amt')::numeric end)<>0
  or sum(case when x->>'component'='employer_cost' then (x->>'amt')::numeric when x->>'component'='employer_payable' then -(x->>'amt')::numeric else 0 end)<>0) then
  raise exception 'PAYROLL_ACCRUAL_DEPARTMENT_BALANCE_MISMATCH' using errcode='23514';end if;
 return jsonb_build_object('entries',canonical,'grossCents',gross,'deductionCents',deduction,'netCents',net,'employerCents',employer);
end $$;
create function private.finance_payroll_accrual_json_v1(r private.finance_payroll_accruals_v1) returns jsonb
 language sql stable set search_path='' as $$select jsonb_build_object('id',r.id,'obligationId',r.obligation_id,'entityId',r.entity_id,'period',r.period,
 'status',r.status,'version',r.version,'authorId',r.author_id,'reviewerId',r.reviewer_id,'reviewReason',r.review_reason,
 'sourceHash',r.source_hash,'entries',r.entries,'evidence',r.evidence,'grossCents',r.gross_cents,'deductionCents',r.deduction_cents,
 'netCents',r.net_cents,'employerCents',r.employer_cents,'voucherId',r.voucher_id,'createdAt',r.created_at,'reviewedAt',r.reviewed_at)$$;
create function private.finance_payroll_settlement_accounts_v1(p_accrual jsonb,p_settlement jsonb) returns boolean
 language sql immutable set search_path='' as $$
 select not exists(select 1 from
  (select x->>'ac' ac,sum((x->>'amt')::numeric) amount from jsonb_array_elements(p_accrual) x where x->>'component'='net_payable' group by x->>'ac') accrued
  full join (select x->>'ac' ac,sum((x->>'amt')::numeric) amount from jsonb_array_elements(p_settlement) x where x->>'t'='dr' group by x->>'ac') settled using(ac)
  where accrued.amount is distinct from settled.amount)$$;
create function private.finance_payroll_accrual_evidence_prepare_v1(p_request_id uuid,p_obligation_id uuid) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare a public.finance_users;o finance_hr_private.finance_hr_obligations;i private.finance_payroll_evidence_intents_v1;p text;
begin
 a:=private.finance_payroll_actor_v1(p_obligation_id,true);
 if p_request_id is null then raise exception 'PAYROLL_ACCRUAL_ID_REQUIRED' using errcode='22023';end if;
 select * into o from finance_hr_private.finance_hr_obligations where obligation_id=p_obligation_id;
 perform pg_advisory_xact_lock(hashtextextended('payroll_evidence|'||p_request_id::text,0));
 select * into i from private.finance_payroll_evidence_intents_v1 where id=p_request_id;
 if found then
  if i.obligation_id<>p_obligation_id or i.author_id<>a.id or i.auth_user_id<>auth.uid() then raise exception 'PAYROLL_ACCRUAL_REPLAY_CONFLICT' using errcode='40001';end if;
  return jsonb_build_object('bucket','finance-payroll-evidence','path',i.path);
 end if;
 p:=o.tenant_id::text||'/'||o.obligation_id::text||'/'||p_request_id::text||'/source';
 insert into private.finance_payroll_evidence_intents_v1(id,obligation_id,tenant_id,author_id,auth_user_id,path) values(p_request_id,o.obligation_id,o.tenant_id,a.id,auth.uid(),p);
 return jsonb_build_object('bucket','finance-payroll-evidence','path',p);
end $$;
create function private.finance_payroll_accrual_save_v1(p_request_id uuid,p_obligation_id uuid,p_entries jsonb,p_evidence jsonb) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare a public.finance_users;o finance_hr_private.finance_hr_obligations;r private.finance_payroll_accruals_v1;i private.finance_payroll_evidence_intents_v1;
 validated jsonb;h text;
begin
 a:=private.finance_payroll_actor_v1(p_obligation_id,true);
 if p_request_id is null or jsonb_typeof(p_evidence) is distinct from 'object' or octet_length(p_evidence::text)>4096
  or coalesce(p_evidence->>'reference','')!~'[^[:space:]]' or length(p_evidence->>'reference')>200
  or coalesce(p_evidence->>'sha256','')!~'^[a-f0-9]{64}$' then raise exception 'PAYROLL_ACCRUAL_EVIDENCE_REQUIRED' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_obligation_id::text,617));
 select * into o from finance_hr_private.finance_hr_obligations where obligation_id=p_obligation_id for share;
 if exists(select 1 from finance_hr_private.finance_hr_postings p cross join lateral jsonb_array_elements(p.entries) e
  where p.obligation_id=o.obligation_id and e->>'t'='dr' and e->>'ac'~'^[56]') then
  raise exception 'PAYROLL_ACCRUAL_SETTLEMENT_ALREADY_EXPENSED' using errcode='23514';end if;
 validated:=private.finance_payroll_entries_v1(p_obligation_id,p_entries);
 if exists(select 1 from finance_hr_private.finance_hr_postings p where p.obligation_id=o.obligation_id
  and not private.finance_payroll_settlement_accounts_v1(validated->'entries',p.entries)) then
  raise exception 'PAYROLL_ACCRUAL_PRIOR_SETTLEMENT_PAYABLE_MISMATCH' using errcode='23514';end if;
 h:=finance_hr_private.finance_hr_hash(jsonb_build_object('obligation',p_obligation_id,'sourceHash',o.source_hash,'entries',validated->'entries','evidence',p_evidence));
 select * into r from private.finance_payroll_accruals_v1 where id=p_request_id;
 if found then
  if r.author_id<>a.id or r.obligation_id<>p_obligation_id or r.payload_hash<>h then raise exception 'PAYROLL_ACCRUAL_REPLAY_CONFLICT' using errcode='40001';end if;
  return jsonb_build_object('ok',true,'replayed',true,'accrual',private.finance_payroll_accrual_json_v1(r));
 end if;
 if exists(select 1 from private.finance_payroll_accruals_v1 where obligation_id=o.obligation_id and status in('submitted','posted')) then raise exception 'PAYROLL_ACCRUAL_ALREADY_SUBMITTED' using errcode='23505';end if;
 select * into i from private.finance_payroll_evidence_intents_v1 where id=p_request_id;
 if i.id is null or i.author_id<>a.id or i.obligation_id<>o.obligation_id or i.tenant_id<>a.tenant_id
  or p_evidence->>'bucket' is distinct from 'finance-payroll-evidence' or p_evidence->>'path' is distinct from i.path
  or not exists(select 1 from storage.objects obj where obj.bucket_id='finance-payroll-evidence' and obj.name=i.path and obj.owner_id=i.auth_user_id::text
    and (obj.metadata->>'size')::bigint between 1 and 10485760) then raise exception 'PAYROLL_ACCRUAL_PERSISTED_EVIDENCE_REQUIRED' using errcode='23514';end if;
 perform private.finance_assert_period_open(o.tenant_id,'production',o.legal_entity_code,(to_date(o.period||'-01','YYYY-MM-DD')+interval '1 month - 1 day')::date,'薪資應計送審');
 insert into private.finance_payroll_accruals_v1(id,obligation_id,tenant_id,entity_id,period,author_id,source_hash,entries,evidence,payload_hash,gross_cents,deduction_cents,net_cents,employer_cents)
 values(p_request_id,o.obligation_id,o.tenant_id,o.legal_entity_code,o.period,a.id,o.source_hash,validated->'entries',p_evidence,h,
  (validated->>'grossCents')::bigint,(validated->>'deductionCents')::bigint,(validated->>'netCents')::bigint,(validated->>'employerCents')::bigint) returning * into r;
 insert into private.finance_payroll_accrual_events_v1(accrual_id,version,action,actor_id,evidence) values(r.id,1,'submitted',a.id,p_evidence);
 return jsonb_build_object('ok',true,'replayed',false,'accrual',private.finance_payroll_accrual_json_v1(r));
end $$;

create function private.finance_payroll_accrual_review_v1(p_id uuid,p_expected_version integer,p_reason text,p_return boolean) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare a public.finance_users;r private.finance_payroll_accruals_v1;o finance_hr_private.finance_hr_obligations;
 validated jsonb;e jsonb;num text;date date;description text;idx integer:=0;
begin
 if p_return is null then raise exception 'PAYROLL_ACCRUAL_REVIEW_OPERATION_REQUIRED' using errcode='22023';end if;
 select * into r from private.finance_payroll_accruals_v1 where id=p_id;
 if r.id is null then raise exception 'PAYROLL_ACCRUAL_FORBIDDEN' using errcode='42501';end if;
 a:=private.finance_payroll_actor_v1(r.obligation_id,false);
 if coalesce(public.current_finance_role(),'') not in('ceo','admin_director') or a.id=r.author_id then raise exception 'PAYROLL_ACCRUAL_INDEPENDENT_REVIEW_REQUIRED' using errcode='42501';end if;
 if nullif(btrim(p_reason),'') is null or length(p_reason)>500 or p_expected_version is null then raise exception 'PAYROLL_ACCRUAL_REVIEW_REASON_REQUIRED' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(r.obligation_id::text,617));
 select * into r from private.finance_payroll_accruals_v1 where id=p_id for update;
 if r.status<>'submitted' then
  if r.version=p_expected_version+1 and r.reviewer_id=a.id and r.review_reason=btrim(p_reason) and r.status=(case when p_return then 'returned' else 'posted' end) then
   return jsonb_build_object('ok',true,'replayed',true,'accrual',private.finance_payroll_accrual_json_v1(r));
  end if;raise exception 'PAYROLL_ACCRUAL_VERSION_CONFLICT' using errcode='40001';
 end if;
 if r.version<>p_expected_version then raise exception 'PAYROLL_ACCRUAL_VERSION_CONFLICT' using errcode='40001';end if;
 select * into o from finance_hr_private.finance_hr_obligations where obligation_id=r.obligation_id for share;
 if o.source_hash is distinct from r.source_hash then raise exception 'PAYROLL_ACCRUAL_SOURCE_CHANGED' using errcode='40001';end if;
 -- Revalidate current department/account/authorization configuration on approval.
 if not p_return then
  if exists(select 1 from finance_hr_private.finance_hr_postings p cross join lateral jsonb_array_elements(p.entries) settled_entry
   where p.obligation_id=r.obligation_id and settled_entry->>'t'='dr' and settled_entry->>'ac'~'^[56]') then
   raise exception 'PAYROLL_ACCRUAL_SETTLEMENT_ALREADY_EXPENSED' using errcode='23514';end if;
  validated:=private.finance_payroll_entries_v1(r.obligation_id,r.entries);
  if exists(select 1 from finance_hr_private.finance_hr_postings p where p.obligation_id=r.obligation_id
   and not private.finance_payroll_settlement_accounts_v1(validated->'entries',p.entries)) then
   raise exception 'PAYROLL_ACCRUAL_PRIOR_SETTLEMENT_PAYABLE_MISMATCH' using errcode='23514';end if;
  date:=(to_date(r.period||'-01','YYYY-MM-DD')+interval '1 month - 1 day')::date;
  perform private.finance_assert_period_open(r.tenant_id,'production',r.entity_id,date,'薪資應計覆核入帳');
  num:=private.finance_next_voucher_no_for_tenant(r.tenant_id,'PAYACC',date,'production');
 end if;
 update private.finance_payroll_accruals_v1 set status=case when p_return then 'returned' else 'posted' end,
  version=version+1,reviewer_id=a.id,review_reason=btrim(p_reason),reviewed_at=clock_timestamp(),
  voucher_id=num,writing_transaction=case when p_return then null else pg_current_xact_id()::text end where id=r.id returning * into r;
 if not p_return then
  description:='薪資應計 '||r.period||'（部門彙總）';
  insert into public.vouchers(id,no,request_id,entity_id,entity_name,voucher_date,description,entries,total,creator,posted,posted_at,posting_locked_at,data_environment,tenant_id)
   values(num,num,'payroll_accrual:'||r.id,r.entity_id,r.entity_id,date,description,r.entries,(r.gross_cents+r.employer_cents)/100.0,a.name,true,clock_timestamp(),clock_timestamp(),'production',r.tenant_id);
  for e in select * from jsonb_array_elements(r.entries) loop
   idx:=idx+1;
   insert into public.ledger_entries(entry_date,description,entity_id,department_code,debit,credit,account_code,account_name,reference_no,posting_key,source_type,source_id,source_no,voucher_no,data_environment,tenant_id)
    values(date,description,r.entity_id,e->>'dept',case when e->>'t'='dr' then (e->>'amt')::numeric else 0 end,
     case when e->>'t'='cr' then (e->>'amt')::numeric else 0 end,e->>'ac',e->>'an',num,
     'payroll_accrual:'||r.id||':'||idx,'payroll_accrual',r.id::text,num,num,'production',r.tenant_id);
  end loop;
 end if;
 insert into private.finance_payroll_accrual_events_v1(accrual_id,version,action,actor_id,reason,evidence)
  values(r.id,r.version,r.status,a.id,r.review_reason,r.evidence);
 return jsonb_build_object('ok',true,'replayed',false,'accrual',private.finance_payroll_accrual_json_v1(r));
end $$;
create function private.finance_payroll_accrual_list_v1(p_entity_id text,p_period text) returns jsonb
 language plpgsql stable security definer set search_path='' as $$
declare a public.finance_users;r private.finance_payroll_accruals_v1;items jsonb:='[]';count integer:=0;begin
 a:=public.current_finance_user();
 if auth.uid() is null or a.id is null or a.auth_user_id is distinct from auth.uid() or a.active is distinct from true
  or coalesce(public.current_finance_role(),'') not in('accountant','ceo','admin_director') then raise exception 'PAYROLL_ACCRUAL_FORBIDDEN' using errcode='42501';end if;
 if coalesce(p_period,'')!~'^[0-9]{4}-(0[1-9]|1[0-2])$' then raise exception 'PAYROLL_ACCRUAL_PERIOD_REQUIRED' using errcode='22023';end if;
 for r in select p.* from private.finance_payroll_accruals_v1 p join finance_hr_private.finance_hr_obligations o on o.obligation_id=p.obligation_id
  where p.tenant_id=a.tenant_id and (nullif(p_entity_id,'') is null or p.entity_id=p_entity_id) and p.period=p_period
   and finance_hr_private.finance_hr_reader(o.tenant_id,o.source_employer_id,a.id) order by p.created_at desc limit 501 loop
  count:=count+1;if count>500 then raise exception 'PAYROLL_ACCRUAL_LIST_REQUIRES_COMPANY_FILTER' using errcode='54000';end if;
  -- Read paths use the same current verified identity, complete company report
  -- and accounting permissions as prepare/save/review. Revocation fails closed.
  perform private.finance_payroll_actor_v1(r.obligation_id,false);
  items:=items||jsonb_build_array(private.finance_payroll_accrual_json_v1(r));
 end loop;
 return jsonb_build_object('items',items);
end $$;

-- Transactions reserve exact book rows. A caller cannot forge an accrual or
-- append extra journal lines even in the same database transaction.
create function private.finance_payroll_book_guard_v1() returns trigger language plpgsql security definer set search_path='' as $$
declare r private.finance_payroll_accruals_v1;begin
 if tg_table_name='vouchers' then
  if coalesce(new.request_id,'') not like 'payroll_accrual:%' and coalesce(new.id,'') not like 'PAYACC%' then return new;end if;
  select * into r from private.finance_payroll_accruals_v1 where voucher_id=new.id;
  if r.id is null or r.status<>'posted' or r.writing_transaction is distinct from pg_current_xact_id()::text
   or new.tenant_id is distinct from r.tenant_id or new.entity_id is distinct from r.entity_id
   or new.entries is distinct from r.entries or new.total is distinct from (r.gross_cents+r.employer_cents)/100.0
   or new.request_id is distinct from 'payroll_accrual:'||r.id or new.data_environment is distinct from 'production'
   or new.no is distinct from r.voucher_id or new.posted is distinct from true or new.posting_locked_at is null
   or new.voucher_date is distinct from (to_date(r.period||'-01','YYYY-MM-DD')+interval '1 month - 1 day')::date
   or new.adjusts_voucher_no is not null or new.adjustment_type is not null then raise exception 'PAYROLL_ACCRUAL_ATOMIC_POST_REQUIRED' using errcode='42501';end if;
 else
  if coalesce(new.source_type,'')<>'payroll_accrual' and coalesce(new.posting_key,'') not like 'payroll_accrual:%' and coalesce(new.voucher_no,'') not like 'PAYACC%' then return new;end if;
  select * into r from private.finance_payroll_accruals_v1 where voucher_id=new.voucher_no;
  if r.id is null or r.writing_transaction is distinct from pg_current_xact_id()::text or r.status<>'posted'
   or new.tenant_id is distinct from r.tenant_id or new.entity_id is distinct from r.entity_id or new.data_environment is distinct from 'production'
   or new.source_type is distinct from 'payroll_accrual' or new.source_id is distinct from r.id::text or new.source_no is distinct from r.voucher_id or new.reference_no is distinct from r.voucher_id
   or new.entry_date is distinct from (to_date(r.period||'-01','YYYY-MM-DD')+interval '1 month - 1 day')::date
   or not exists(select 1 from jsonb_array_elements(r.entries) with ordinality e(value,ordinal) where new.posting_key='payroll_accrual:'||r.id||':'||e.ordinal
     and new.department_code=e.value->>'dept' and new.account_code=e.value->>'ac' and new.account_name=e.value->>'an'
     and new.debit=case when e.value->>'t'='dr' then (e.value->>'amt')::numeric else 0 end
     and new.credit=case when e.value->>'t'='cr' then (e.value->>'amt')::numeric else 0 end) then raise exception 'PAYROLL_ACCRUAL_ATOMIC_POST_REQUIRED' using errcode='42501';end if;
 end if;return new;
end $$;
create trigger payroll_accrual_atomic before insert on public.vouchers for each row execute function private.finance_payroll_book_guard_v1();
create trigger payroll_accrual_atomic before insert on public.ledger_entries for each row execute function private.finance_payroll_book_guard_v1();
create unique index payroll_accrual_book_once_v1 on public.ledger_entries(tenant_id,data_environment,posting_key) where source_type='payroll_accrual';
-- Keep the sealed HR settlement body, adding only a no-double-expense guard.
do $settlement$ declare definition text;needle text:=E' if dr<>cr or dr<>o.total_net_cents/100.0 then';begin
 if (select md5(prosrc) from pg_proc where oid='finance_hr_private.finance_hr_post_voucher(uuid,integer,uuid,date,jsonb,jsonb)'::regprocedure)<>'574bf7be65ce8c6684c4458359152fbd' then
  raise exception 'PAYROLL_ACCRUAL_UNREVIEWED_HR_SETTLEMENT_SOURCE';end if;
 definition:=pg_get_functiondef('finance_hr_private.finance_hr_post_voucher(uuid,integer,uuid,date,jsonb,jsonb)'::regprocedure);
 if position(needle in definition)=0 then raise exception 'PAYROLL_ACCRUAL_SETTLEMENT_PATCH_MISSING';end if;
 definition:=replace(definition,needle,E' if exists(select 1 from private.finance_payroll_accruals_v1 p where p.obligation_id=o.obligation_id and p.status=''posted'' and not private.finance_payroll_settlement_accounts_v1(p.entries,canonical)) then raise exception ''FINANCE_HR_SETTLEMENT_MUST_CLEAR_ACCRUED_PAYABLE'' using errcode=''23514'';end if;\n'||needle);
 execute definition;
end $settlement$;
-- Preserve the existing HR settlement confidentiality guard and extend it to
-- departmental accruals. Reports already call this complete-company guard.
create or replace function finance_hr_private.finance_hr_accounting_scope(p_tenant uuid,p_entity text,p_environment text) returns boolean language plpgsql stable security definer set search_path='' as $$
declare a public.finance_users;env text:=coalesce(nullif(btrim(p_environment),''),'production');begin
 if env='test' then return true;end if;
 if env<>'production' then raise exception 'FINANCE_HR_INVALID_ENVIRONMENT' using errcode='22023';end if;
 a:=public.current_finance_user();
 if exists(select 1 from finance_hr_private.finance_hr_postings p join finance_hr_private.finance_hr_obligations o using(obligation_id)
 where p.tenant_id=p_tenant and (p_entity is null or p.entity_id=p_entity)
 and (auth.uid() is null or a.id is null or a.auth_user_id is distinct from auth.uid() or a.tenant_id is distinct from p_tenant or not finance_hr_private.finance_hr_reader(o.tenant_id,o.source_employer_id,a.id)))
 or exists(select 1 from private.finance_payroll_accruals_v1 p join finance_hr_private.finance_hr_obligations o on o.obligation_id=p.obligation_id
 where p.status='posted' and p.tenant_id=p_tenant and (p_entity is null or p.entity_id=p_entity)
 and (auth.uid() is null or a.id is null or a.auth_user_id is distinct from auth.uid() or a.tenant_id is distinct from p_tenant or not finance_hr_private.finance_hr_reader(o.tenant_id,o.source_employer_id,a.id))) then
 raise exception 'FINANCE_HR_COMPLETE_REPORT_AUTHORIZATION_REQUIRED' using errcode='42501';end if;
 return true;
end $$;

-- Bounded public entrypoints preserve the directory's private namespace denial.
-- Each implementation authenticates the original JWT through auth.uid(), then
-- checks its active Finance identity, tenant, salary reader and company scope.
create function public.finance_payroll_accrual_evidence_prepare_v1(p_request_id uuid,p_obligation_id uuid) returns jsonb language sql security definer set search_path='' as $$select private.finance_payroll_accrual_evidence_prepare_v1(p_request_id,p_obligation_id)$$;
create function public.finance_payroll_accrual_save_v1(p_request_id uuid,p_obligation_id uuid,p_entries jsonb,p_evidence jsonb) returns jsonb language sql security definer set search_path='' as $$select private.finance_payroll_accrual_save_v1(p_request_id,p_obligation_id,p_entries,p_evidence)$$;
create function public.finance_payroll_accrual_review_v1(p_id uuid,p_expected_version integer,p_reason text) returns jsonb language sql security definer set search_path='' as $$select private.finance_payroll_accrual_review_v1(p_id,p_expected_version,p_reason,false)$$;
create function public.finance_payroll_accrual_return_v1(p_id uuid,p_expected_version integer,p_reason text) returns jsonb language sql security definer set search_path='' as $$select private.finance_payroll_accrual_review_v1(p_id,p_expected_version,p_reason,true)$$;
create function public.finance_payroll_accrual_list_v1(p_entity_id text default null,p_period text default null) returns jsonb language sql security definer set search_path='' as $$select private.finance_payroll_accrual_list_v1(p_entity_id,p_period)$$;
do $$declare f record;begin
 for f in select p.oid::regprocedure signature,p.proname,n.nspname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','private') and p.proname like 'finance_payroll_%_v1' loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
  if f.nspname='public' or f.proname in('finance_payroll_storage_scope_v1','finance_payroll_accrual_evidence_prepare_v1','finance_payroll_accrual_save_v1','finance_payroll_accrual_review_v1','finance_payroll_accrual_list_v1') then execute format('grant execute on function %s to authenticated',f.signature);end if;
 end loop;
end $$;
notify pgrst,'reload schema';
