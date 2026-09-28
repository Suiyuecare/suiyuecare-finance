-- External lecturer remuneration: immutable course coverage, signed evidence,
-- gross service accrual, and separately evidenced actual bank settlements.
set local lock_timeout='5s';
set local statement_timeout='120s';

create table private.finance_labor_statements_v1 (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null,
 data_environment text not null default 'production' check(data_environment='production'),
 entity_id text not null, request_id text not null unique references public.expense_requests(id),
 period text not null check(period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
 signer_name text not null, invite_email text not null, planned_payment_dates jsonb not null,
 total_gross_cents bigint not null check(total_gross_cents>0),
 status text not null default 'invited' check(status in
  ('invited','signed_pending_archive','signed','returned','reviewed','accrued','partially_paid','paid','revoked')),
 version integer not null default 1, created_by text not null, reviewed_by text,
 accrued_by text, created_at timestamptz not null default clock_timestamp(),
 signed_at timestamptz, reviewed_at timestamptz, accrued_at timestamptz,
 snapshot_text text, snapshot_hash text, archive_path text, archive_hash text,
 identity_method text check(identity_method is null or identity_method='bearer_link_only'),
 private_profile jsonb, writing_transaction text,
 check ((snapshot_text is null and snapshot_hash is null and archive_path is null)
  or (snapshot_text is not null and snapshot_hash ~ '^[a-f0-9]{64}$' and archive_path is not null))
);
create index finance_labor_statement_list_v1 on private.finance_labor_statements_v1
 (tenant_id,entity_id,period,status,created_at,id);
create index finance_labor_uninvited_requests_v1 on public.expense_requests(tenant_id,entity_id,id)
 where data_environment='production' and type='hr_expense_request'
  and form_payload->'electronicLabor'->>'version'='1';
create unique index finance_labor_one_teacher_month_v1 on private.finance_labor_statements_v1
 (tenant_id,entity_id,period,lower(invite_email)) where status<>'revoked';
create table private.finance_labor_lines_v1 (
 id uuid primary key, statement_id uuid not null references private.finance_labor_statements_v1(id),
 tenant_id uuid not null, entity_id text not null, course_ref text not null,
 course_type text not null, description text not null, service_date date not null,
 department_code text not null, gross_cents bigint not null check(gross_cents>0),
 income_category text check(income_category is null or income_category in('50','9A','9B')),
 expense_account text, classification_basis text, accrual_voucher_no text unique,
 accrued_at timestamptz,writing_transaction text,
 created_at timestamptz not null default clock_timestamp()
);
create index finance_labor_lines_statement_v1 on private.finance_labor_lines_v1(statement_id,service_date,id);
create table private.finance_labor_invites_v1 (
 id uuid primary key default gen_random_uuid(), statement_id uuid not null references private.finance_labor_statements_v1(id),
 token_hash text not null unique check(token_hash ~ '^[a-f0-9]{64}$'),
 expires_at timestamptz not null, revoked_at timestamptz, created_by text not null,
 created_at timestamptz not null default clock_timestamp()
);
create unique index finance_labor_one_live_invite_v1 on private.finance_labor_invites_v1(statement_id) where revoked_at is null;
create table private.finance_labor_uploads_v1 (
 id uuid primary key default gen_random_uuid(), statement_id uuid not null references private.finance_labor_statements_v1(id),
 invite_id uuid not null references private.finance_labor_invites_v1(id),
 kind text not null check(kind in('identity_front','identity_back','bank_proof','signature')),
 bucket text not null default 'finance-external-labor' check(bucket='finance-external-labor'),
 path text not null unique, mime text not null, size_bytes bigint not null check(size_bytes between 1 and 10485760),
 sha256 text check(sha256 is null or sha256 ~ '^[a-f0-9]{64}$'),
 committed_at timestamptz, created_at timestamptz not null default clock_timestamp()
);
create table private.finance_labor_submissions_v1 (
 submit_id uuid primary key, statement_id uuid not null references private.finance_labor_statements_v1(id),
 snapshot_hash text not null, request_hash text not null check(request_hash ~ '^[a-f0-9]{64}$'),
 created_at timestamptz not null default clock_timestamp()
);
create table private.finance_labor_payment_evidence_intents_v1 (
 id uuid primary key default gen_random_uuid(),statement_id uuid not null references private.finance_labor_statements_v1(id),
 path text not null unique,mime text not null,size_bytes bigint not null check(size_bytes between 1 and 10485760),
 created_by text not null,created_at timestamptz not null default clock_timestamp()
);
create table private.finance_labor_operations_v1 (
 request_key uuid primary key, statement_id uuid not null references private.finance_labor_statements_v1(id),
 operation text not null, payload_hash text not null, result jsonb not null,
 created_at timestamptz not null default clock_timestamp()
);
create table private.finance_labor_payments_v1 (
 id uuid primary key, statement_id uuid not null references private.finance_labor_statements_v1(id),
 tenant_id uuid not null, entity_id text not null, paid_on date not null,
 bank_ref text not null, evidence jsonb not null, gross_cents bigint not null check(gross_cents>0),
 net_cents bigint not null check(net_cents>0), tax_cents bigint not null check(tax_cents>=0),
 nhi_cents bigint not null check(nhi_cents>=0), voucher_no text not null unique,
 writing_transaction text not null, posted_by text not null,
 posted_at timestamptz not null default clock_timestamp(),
 check(gross_cents=net_cents+tax_cents+nhi_cents),
 unique(tenant_id,entity_id,bank_ref)
);
create table private.finance_labor_payment_lines_v1 (
 payment_id uuid not null references private.finance_labor_payments_v1(id),
 service_line_id uuid not null references private.finance_labor_lines_v1(id),
 gross_cents bigint not null check(gross_cents>0),
 tax_cents bigint not null check(tax_cents>=0),
 nhi_cents bigint not null check(nhi_cents>=0),
 primary key(payment_id,service_line_id),
 check(gross_cents>tax_cents+nhi_cents)
);
create index finance_labor_payment_line_cap_v1 on private.finance_labor_payment_lines_v1(service_line_id);
create table private.finance_labor_events_v1 (
 id bigint generated always as identity primary key,
 statement_id uuid not null references private.finance_labor_statements_v1(id),
 action text not null, actor text not null, reason text,
 version integer not null, created_at timestamptz not null default clock_timestamp(),
 unique(statement_id,version)
);

do $labor_acl$ declare name text; begin
 foreach name in array array['finance_labor_statements_v1','finance_labor_lines_v1','finance_labor_invites_v1',
  'finance_labor_uploads_v1','finance_labor_submissions_v1','finance_labor_operations_v1',
  'finance_labor_payment_evidence_intents_v1',
  'finance_labor_payments_v1','finance_labor_payment_lines_v1','finance_labor_events_v1'] loop
  execute format('alter table private.%I enable row level security',name);
  execute format('alter table private.%I force row level security',name);
  execute format('revoke all on private.%I from public,anon,authenticated,service_role',name);
 end loop;
end $labor_acl$;
revoke all on sequence private.finance_labor_events_v1_id_seq from public,anon,authenticated,service_role;

insert into storage.buckets(id,name,public,file_size_limit)
 values('finance-external-labor','finance-external-labor',false,10485760)
 on conflict(id) do update set public=false,file_size_limit=10485760;
-- No browser principal may read, overwrite, list, or delete identity/bank/signature files.
create policy finance_external_labor_authenticated_deny_v1 on storage.objects as restrictive
 for all to authenticated using(bucket_id<>'finance-external-labor')
 with check(bucket_id<>'finance-external-labor');
create policy finance_external_labor_anon_deny_v1 on storage.objects as restrictive
 for all to anon using(bucket_id<>'finance-external-labor')
 with check(bucket_id<>'finance-external-labor');

create function private.finance_labor_hash_v1(p_text text) returns text
 language sql immutable set search_path='' as $$select encode(sha256(convert_to(p_text,'UTF8')),'hex')$$;
create function private.finance_labor_object_sha_v1(p_object storage.objects) returns text
 language sql stable set search_path='' as $$select coalesce(
  to_jsonb(p_object)->'user_metadata'->>'sha256',p_object.metadata->>'sha256')$$;
create function private.finance_labor_service_role_v1() returns void
 language plpgsql stable security definer set search_path='' as $$begin
 if auth.role() is distinct from 'service_role' then
  raise exception 'LABOR_GATEWAY_ONLY' using errcode='42501';
 end if;
end $$;
create function private.finance_labor_actor_v1(p_entity text,p_write boolean default true) returns public.finance_users
 language plpgsql stable security definer set search_path='' as $$
declare a public.finance_users;scope jsonb;begin
 a:=public.current_finance_user();
 if auth.uid() is null or a.id is null or a.auth_user_id is distinct from auth.uid()
  or a.active is distinct from true or coalesce(public.current_finance_role(),'')
  not in('accountant','ceo','admin_director') then
  raise exception 'LABOR_STAFF_FORBIDDEN' using errcode='42501';
 end if;
 scope:=private.finance_reporting_actor_v1(p_entity,'production');
 if (scope->>'tenantId')::uuid is distinct from a.tenant_id
  or (p_write and not private.finance_expense_optional_permission_allows(a.tenant_id,a.id,
   'finance.accounting.subject.edit',jsonb_build_object('entity_id',p_entity,'company_id',p_entity,
    'resource_type','external_labor'))) then
  raise exception 'LABOR_STAFF_SCOPE_FORBIDDEN' using errcode='42501';
 end if;
 return a;
end $$;
create function private.finance_labor_safe_statement_v1(p_statement private.finance_labor_statements_v1) returns jsonb
 language sql stable set search_path='' as $$
 select jsonb_build_object('statementId',p_statement.id,'requestId',p_statement.request_id,
 'entityId',p_statement.entity_id,'period',p_statement.period,'version',p_statement.version,
 'status',p_statement.status,'totalGrossCents',p_statement.total_gross_cents,
 'totalPaidGrossCents',coalesce((select sum(p.gross_cents) from private.finance_labor_payments_v1 p
   where p.statement_id=p_statement.id),0),
 'outstandingGrossCents',p_statement.total_gross_cents-coalesce((select sum(p.gross_cents)
   from private.finance_labor_payments_v1 p where p.statement_id=p_statement.id),0),
 'signedAt',p_statement.signed_at,'snapshotHash',p_statement.snapshot_hash,
 'plannedPaymentDates',p_statement.planned_payment_dates,
 'serviceLines',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'courseRef',l.course_ref,
  'courseType',l.course_type,'description',l.description,'serviceDate',l.service_date,
  'departmentCode',l.department_code,'grossCents',l.gross_cents,
  'paidGrossCents',coalesce((select sum(pl.gross_cents) from private.finance_labor_payment_lines_v1 pl
    where pl.service_line_id=l.id),0),
  'outstandingGrossCents',l.gross_cents-coalesce((select sum(pl.gross_cents)
    from private.finance_labor_payment_lines_v1 pl where pl.service_line_id=l.id),0),
  'incomeCategory',l.income_category,
  'expenseAccount',l.expense_account,'accrualVoucherNo',l.accrual_voucher_no)
  order by l.service_date,l.id) from private.finance_labor_lines_v1 l
  where l.statement_id=p_statement.id),'[]'::jsonb),
 'payments',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'paidOn',p.paid_on,
  'grossCents',p.gross_cents,'netCents',p.net_cents,'incomeTaxCents',p.tax_cents,
  'nhiCents',p.nhi_cents,'voucherNo',p.voucher_no) order by p.paid_on,p.id)
  from private.finance_labor_payments_v1 p where p.statement_id=p_statement.id),'[]'::jsonb))$$;

-- Reject the legacy whole-request bank/expense path from the first submitted
-- electronic intent, including after the lecturer document has been reviewed.
create function private.finance_labor_request_guard_v1() returns trigger
 language plpgsql security definer set search_path='' as $$
declare marked boolean;labor_source private.finance_labor_statements_v1;
 old_accountant_approved boolean;new_accountant_approved boolean;begin
 marked:=coalesce(new.form_payload->'electronicLabor'->>'version','')='1'
   or exists(select 1 from private.finance_labor_statements_v1 s where s.request_id=new.id);
 if tg_op='UPDATE' then marked:=marked or coalesce(old.form_payload->'electronicLabor'->>'version','')='1';end if;
 if marked then
  select * into labor_source from private.finance_labor_statements_v1 where request_id=new.id;
  if new.type is distinct from 'hr_expense_request' or new.data_environment is distinct from 'production'
   or new.voucher_id is not null or new.cash_posted_at is not null
   or new.ledger_posted_at is not null or new.posting_locked_at is not null
   or nullif(new.form_payload->>'cashPostedAt','') is not null
   or nullif(new.form_payload->>'cashPostingRule','') is not null then
   raise exception 'LABOR_LEGACY_FINALIZE_BLOCKED' using errcode='23514';
  end if;
  if tg_op='UPDATE' and labor_source.id is not null
   and (old.amount,old.entity_id,old.department_code,old.type,old.tenant_id,old.data_environment,
    old.form_payload->'electronicLabor') is distinct from
    (new.amount,new.entity_id,new.department_code,new.type,new.tenant_id,new.data_environment,
     new.form_payload->'electronicLabor') then
   raise exception 'LABOR_SIGNED_SOURCE_IMMUTABLE' using errcode='23514';
  end if;
  if tg_op='INSERT' and new.status in('pending_cashier','pending_applicant_confirm',
   'pending_voucher','pending_external_labor_settlement','completed') then
   raise exception 'LABOR_ELECTRONIC_ROUTE_NOT_READY' using errcode='23514';end if;
  if tg_op='UPDATE' then
   old_accountant_approved:=exists(select 1 from jsonb_array_elements(case
    when jsonb_typeof(old.steps)='array' then old.steps else '[]'::jsonb end) x
    where x->>'rk'='accountant' and (x->>'a' in('approved','AUTO')
     or x->>'status' in('approved','auto_approved')));
   new_accountant_approved:=exists(select 1 from jsonb_array_elements(case
    when jsonb_typeof(new.steps)='array' then new.steps else '[]'::jsonb end) x
    where x->>'rk'='accountant' and (x->>'a' in('approved','AUTO')
     or x->>'status' in('approved','auto_approved')));
   if ((new_accountant_approved and not old_accountant_approved)
     or (new.status in('pending_ceo','pending_cashier')
      and old.status is distinct from new.status))
    and (labor_source.id is null or labor_source.status not in('reviewed','accrued','partially_paid','paid')) then
    raise exception 'LABOR_SIGNED_ACCOUNTING_REVIEW_REQUIRED' using errcode='23514';end if;
   if old.status='pending_cashier' and (new.status is distinct from old.status
     or new.steps is distinct from old.steps or new.step is distinct from old.step)
    and not (new.status='pending_external_labor_settlement' and labor_source.status='accrued'
     and labor_source.writing_transaction=pg_current_xact_id()::text) then
    raise exception 'LABOR_LEGACY_CASHIER_ROUTE_BLOCKED' using errcode='23514';end if;
   if old.status='pending_external_labor_settlement' and (new.status is distinct from old.status
     or new.steps is distinct from old.steps or new.step is distinct from old.step)
    and not (new.status='completed' and labor_source.status='paid'
     and labor_source.writing_transaction=pg_current_xact_id()::text) then
    raise exception 'LABOR_SETTLEMENT_ONLY_COMPLETION' using errcode='23514';end if;
   if new.status in('pending_applicant_confirm','pending_voucher','completed')
    and old.status is distinct from 'pending_external_labor_settlement' then
    raise exception 'LABOR_LEGACY_COMPLETION_ROUTE_BLOCKED' using errcode='23514';end if;
  end if;
 end if;
 return new;
end $$;
create trigger finance_labor_request_guard_v1 before insert or update on public.expense_requests
 for each row execute function private.finance_labor_request_guard_v1();
create function private.finance_labor_legacy_book_guard_v1() returns trigger
 language plpgsql security definer set search_path='' as $$begin
 if tg_table_name='vouchers' then
  if new.request_id is not null and exists(select 1 from public.expense_requests r
   where r.id=new.request_id and r.form_payload->'electronicLabor'->>'version'='1') then
   raise exception 'LABOR_LEGACY_VOUCHER_BLOCKED' using errcode='23514';end if;
 else
  if new.source_type='external_labor' then return new;end if;
  if exists(select 1 from public.expense_requests r
   where r.form_payload->'electronicLabor'->>'version'='1'
    and (r.id=new.source_id or r.no=new.source_no or r.no=new.reference_no)) then
   raise exception 'LABOR_LEGACY_LEDGER_BLOCKED' using errcode='23514';end if;
 end if;return new;
end $$;
create trigger finance_labor_legacy_book_v1 before insert on public.vouchers
 for each row execute function private.finance_labor_legacy_book_guard_v1();
create trigger finance_labor_legacy_book_v1 before insert on public.ledger_entries
 for each row execute function private.finance_labor_legacy_book_guard_v1();

create function private.finance_labor_create_invite_v1(p_request_id text,p_entity_id text,
 p_invite_email text,p_token_hash text,p_expires_at timestamptz,p_lines jsonb) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare a public.finance_users;r public.expense_requests;s private.finance_labor_statements_v1;
 marker jsonb;line jsonb;total bigint:=0;row_count integer:=0;inv private.finance_labor_invites_v1;
begin
 a:=private.finance_labor_actor_v1(p_entity_id,true);
 if public.current_finance_role()<>'accountant' then
  raise exception 'LABOR_INVITE_ACCOUNTANT_ONLY' using errcode='42501';end if;
 if nullif(p_request_id,'') is null or p_token_hash !~ '^[a-f0-9]{64}$'
  or p_expires_at not between clock_timestamp()+interval '5 minutes' and clock_timestamp()+interval '30 days'
  or jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) not between 1 and 100
  or octet_length(p_lines::text)>65536 then
  raise exception 'LABOR_INVITE_INVALID' using errcode='22023';
 end if;
 perform pg_advisory_xact_lock(hashtextextended('labor_request|'||p_request_id,0));
 select * into r from public.expense_requests where id=p_request_id for update;
 marker:=r.form_payload->'electronicLabor';
 if r.id is null or r.tenant_id is distinct from a.tenant_id or r.entity_id is distinct from p_entity_id
  or r.data_environment is distinct from 'production' or r.type<>'hr_expense_request'
  or marker->>'version' is distinct from '1' or marker->>'status' is distinct from 'pending_invite'
  or marker->>'period' !~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
  or marker->'serviceLines' is distinct from p_lines
  or lower(btrim(coalesce(marker->>'inviteEmail',''))) is distinct from lower(btrim(coalesce(p_invite_email,'')))
  or length(btrim(coalesce(marker->>'signerName',''))) not between 1 and 200
  or coalesce(marker->>'totalGrossCents','') !~ '^[1-9][0-9]{0,12}$'
  or jsonb_typeof(marker->'plannedPaymentDates') is distinct from 'array'
  or jsonb_array_length(marker->'plannedPaymentDates') not between 1 and 12
  or r.voucher_id is not null or r.cash_posted_at is not null or r.ledger_posted_at is not null
  or exists(select 1 from public.vouchers v where v.request_id=r.id)
  or exists(select 1 from public.ledger_entries l where l.source_id=r.id or l.source_no=r.no)
 then raise exception 'LABOR_INVITE_SOURCE_NOT_READY' using errcode='23514';end if;
 -- The lecturer invitation starts at the existing accounting gate, after all
 -- earlier management approvals. CEO review remains later in the route.
 if r.status<>'pending_accountant' or jsonb_typeof(r.steps) is distinct from 'array'
  or not exists(select 1 from jsonb_array_elements(r.steps) with ordinality current_step(value,position)
   where current_step.value->>'rk'='accountant'
    and coalesce(current_step.value->>'a','')=''
    and not exists(select 1 from jsonb_array_elements(r.steps) with ordinality prior(value,position)
     where prior.position<current_step.position
      and not (prior.value->>'a' in('approved','AUTO')
       or prior.value->>'status' in('approved','auto_approved','skipped')))) then
  raise exception 'LABOR_INVITE_REQUIRES_ACCOUNTING_STAGE' using errcode='23514';end if;
 if p_invite_email !~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' or length(p_invite_email)>254
  or r.amount*100<>(marker->>'totalGrossCents')::bigint then
  raise exception 'LABOR_INVITE_SOURCE_TOTAL_MISMATCH' using errcode='23514';end if;
 if exists(select 1 from jsonb_array_elements_text(marker->'plannedPaymentDates') x
  where x !~ '^\d{4}-\d{2}-\d{2}$' or to_char(x::date,'YYYY-MM-DD')<>x)
  or (select count(distinct x) from jsonb_array_elements_text(marker->'plannedPaymentDates') x)
   <>jsonb_array_length(marker->'plannedPaymentDates') then
  raise exception 'LABOR_PLANNED_PAYMENT_DATES_INVALID' using errcode='22023';end if;
 select * into s from private.finance_labor_statements_v1 where request_id=r.id;
 if found then
  select * into inv from private.finance_labor_invites_v1 where statement_id=s.id and revoked_at is null;
  if inv.token_hash is distinct from p_token_hash or s.total_gross_cents<>(marker->>'totalGrossCents')::bigint
   or inv.expires_at is distinct from p_expires_at then
   raise exception 'LABOR_INVITE_ALREADY_EXISTS_USE_ROTATE' using errcode='23505';end if;
  return private.finance_labor_safe_statement_v1(s)||jsonb_build_object('inviteId',inv.id,'expiresAt',inv.expires_at,'replayed',true);
 end if;
 for line in select value from jsonb_array_elements(p_lines) loop
  row_count:=row_count+1;
  if jsonb_typeof(line) is distinct from 'object' or
   exists(select 1 from jsonb_object_keys(line) k where k<>all(array['id','courseRef','courseType','description','serviceDate','departmentCode','grossCents']))
   or coalesce(line->>'id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   or length(btrim(coalesce(line->>'courseRef',''))) not between 1 and 120
   or length(btrim(coalesce(line->>'courseType',''))) not between 1 and 120
   or length(btrim(coalesce(line->>'description',''))) not between 1 and 1000
   or coalesce(line->>'serviceDate','') !~ '^\d{4}-\d{2}-\d{2}$'
   or to_char((line->>'serviceDate')::date,'YYYY-MM-DD')<>line->>'serviceDate'
   or to_char((line->>'serviceDate')::date,'YYYY-MM')<>marker->>'period'
   or coalesce(line->>'grossCents','') !~ '^[1-9][0-9]{0,12}$'
   or line->>'departmentCode' is null
   or not exists(select 1 from public.system_settings st cross join lateral jsonb_array_elements(
    case when jsonb_typeof(st.value)='array' then st.value else '[]'::jsonb end) d
    where st.tenant_id=a.tenant_id and st.key='departments' and d->>'c'=line->>'departmentCode'
     and d->>'eid'=p_entity_id and coalesce(d->>'active','true')='true') then
   raise exception 'LABOR_SERVICE_LINE_INVALID' using errcode='22023';end if;
  total:=total+(line->>'grossCents')::bigint;
 end loop;
 if total<>(marker->>'totalGrossCents')::bigint
  or (select count(distinct x->>'id') from jsonb_array_elements(p_lines) x)<>row_count then
  raise exception 'LABOR_SERVICE_LINE_TOTAL_OR_ID_MISMATCH' using errcode='23514';end if;
 insert into private.finance_labor_statements_v1(tenant_id,entity_id,request_id,period,signer_name,invite_email,
  planned_payment_dates,total_gross_cents,created_by)
 values(a.tenant_id,p_entity_id,r.id,marker->>'period',btrim(marker->>'signerName'),lower(btrim(p_invite_email)),
  marker->'plannedPaymentDates',total,a.id) returning * into s;
 for line in select value from jsonb_array_elements(p_lines) loop
  insert into private.finance_labor_lines_v1(id,statement_id,tenant_id,entity_id,course_ref,course_type,
   description,service_date,department_code,gross_cents)
  values((line->>'id')::uuid,s.id,a.tenant_id,p_entity_id,btrim(line->>'courseRef'),
   btrim(line->>'courseType'),btrim(line->>'description'),(line->>'serviceDate')::date,
   line->>'departmentCode',(line->>'grossCents')::bigint);
 end loop;
 insert into private.finance_labor_invites_v1(statement_id,token_hash,expires_at,created_by)
 values(s.id,p_token_hash,p_expires_at,a.id) returning * into inv;
 insert into private.finance_labor_events_v1(statement_id,action,actor,version)
 values(s.id,'invited',a.id,1);
 return private.finance_labor_safe_statement_v1(s)||jsonb_build_object('inviteId',inv.id,'expiresAt',inv.expires_at,'replayed',false);
end $$;

create function private.finance_labor_guest_access_v1(p_token_hash text,p_expected_version integer default null)
 returns private.finance_labor_statements_v1 language plpgsql security definer set search_path='' as $$
declare inv private.finance_labor_invites_v1;s private.finance_labor_statements_v1;begin
 perform private.finance_labor_service_role_v1();
 if coalesce(p_token_hash,'') !~ '^[a-f0-9]{64}$' then raise exception 'LABOR_LINK_INVALID' using errcode='42501';end if;
 select * into inv from private.finance_labor_invites_v1 where token_hash=p_token_hash;
 if inv.id is null or inv.revoked_at is not null then
  raise exception 'LABOR_LINK_EXPIRED_OR_REVOKED' using errcode='42501';end if;
 select * into s from private.finance_labor_statements_v1 where id=inv.statement_id;
 -- An already-signed snapshot may be archived again after refresh or a short
 -- link expiry. It cannot be edited or signed again in this state.
 if (s.status='invited' and inv.expires_at<=clock_timestamp())
  or (s.status='signed_pending_archive' and clock_timestamp()>s.signed_at+interval '7 days') then
  raise exception 'LABOR_LINK_EXPIRED_OR_REVOKED' using errcode='42501';end if;
 if s.id is null or s.status not in('invited','signed_pending_archive')
  or (p_expected_version is not null and s.version<>p_expected_version) then
  raise exception 'LABOR_LINK_NOT_AVAILABLE' using errcode='40001';end if;
 if not exists(select 1 from public.expense_requests r where r.id=s.request_id
  and r.tenant_id=s.tenant_id and r.entity_id=s.entity_id
  and r.status='pending_accountant' and r.data_environment='production'
  and r.form_payload->'electronicLabor'->>'version'='1') then
  raise exception 'LABOR_PARENT_REQUEST_NOT_ACTIVE' using errcode='23514';end if;
 return s;
end $$;
create function private.finance_labor_guest_lookup_v1(p_token_hash text) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare s private.finance_labor_statements_v1;name text;begin
 s:=private.finance_labor_guest_access_v1(p_token_hash,null);
 select coalesce(nullif(e->>'full',''),nullif(e->>'legalName',''),nullif(e->>'s',''),nullif(e->>'n',''),s.entity_id)
 into name from public.system_settings st cross join lateral jsonb_array_elements(
 case when jsonb_typeof(st.value)='array' then st.value else '[]'::jsonb end) e
 where st.tenant_id=s.tenant_id and st.key='entities' and e->>'id'=s.entity_id limit 1;
 return jsonb_build_object('statementId',s.id,'version',s.version,'status',s.status,
  'entityId',s.entity_id,'entityName',coalesce(name,s.entity_id),
  'serviceLines',(private.finance_labor_safe_statement_v1(s))->'serviceLines',
  'totalGrossCents',s.total_gross_cents,'expiresAt',
   (select i.expires_at from private.finance_labor_invites_v1 i where i.statement_id=s.id and i.revoked_at is null),
  'requiredUploads',jsonb_build_object('identityFront',true,'identityBack',true,'bankProof',true,'signature',true),
  'consentVersion','labor-v1')||case when s.status='signed_pending_archive' then
   jsonb_build_object('signedSnapshotText',s.snapshot_text,'snapshotHash',s.snapshot_hash,
    'archivePath',s.archive_path) else '{}'::jsonb end;
end $$;
create function private.finance_labor_guest_upload_authorize_v1(p_token_hash text,p_expected_version integer,
 p_kind text,p_file_name text,p_mime text,p_size_bytes bigint) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare s private.finance_labor_statements_v1;u private.finance_labor_uploads_v1;
 inv private.finance_labor_invites_v1;begin
 s:=private.finance_labor_guest_access_v1(p_token_hash,p_expected_version);
 if s.status<>'invited' or p_kind not in('identity_front','identity_back','bank_proof','signature')
  or length(coalesce(p_file_name,'')) not between 1 and 200
  or p_file_name ~ '[\\/]' or coalesce(p_mime,'') not in('image/jpeg','image/png','application/pdf')
  or p_size_bytes not between 1 and 10485760 then
  raise exception 'LABOR_UPLOAD_INVALID' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('labor_statement|'||s.id::text,0));
 select * into inv from private.finance_labor_invites_v1
  where statement_id=s.id and token_hash=p_token_hash and revoked_at is null for update;
 if inv.id is null or inv.expires_at<=clock_timestamp() then
  raise exception 'LABOR_LINK_EXPIRED_OR_REVOKED' using errcode='42501';end if;
 if (select count(*) from private.finance_labor_uploads_v1 x where x.invite_id=inv.id)>=20
  or (select count(*) from private.finance_labor_uploads_v1 x
   where x.invite_id=inv.id and x.kind=p_kind)>=5 then
  raise exception 'LABOR_UPLOAD_QUOTA_EXCEEDED' using errcode='23514';end if;
 insert into private.finance_labor_uploads_v1(statement_id,invite_id,kind,path,mime,size_bytes)
 values(s.id,inv.id,p_kind,s.tenant_id::text||'/'||s.id::text||'/uploads/'||gen_random_uuid()::text,
  p_mime,p_size_bytes) returning * into u;
 return jsonb_build_object('uploadId',u.id,'bucket',u.bucket,'path',u.path,'maxBytes',10485760);
end $$;
create function private.finance_labor_guest_file_commit_v1(p_token_hash text,p_upload_id uuid,
 p_path text,p_kind text,p_sha256 text,p_size_bytes bigint,p_mime text) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare s private.finance_labor_statements_v1;u private.finance_labor_uploads_v1;obj storage.objects;begin
 s:=private.finance_labor_guest_access_v1(p_token_hash,null);
 select * into u from private.finance_labor_uploads_v1 where id=p_upload_id for update;
 select * into obj from storage.objects where bucket_id='finance-external-labor' and name=p_path;
 if s.status<>'invited' or u.id is null or u.statement_id<>s.id or u.path is distinct from p_path
  or not exists(select 1 from private.finance_labor_invites_v1 i
   where i.id=u.invite_id and i.statement_id=s.id and i.token_hash=p_token_hash and i.revoked_at is null)
  or u.kind is distinct from p_kind or u.mime is distinct from p_mime
  or u.size_bytes is distinct from p_size_bytes or p_sha256 !~ '^[a-f0-9]{64}$'
  or obj.id is null or (obj.metadata->>'size')::bigint is distinct from p_size_bytes
  or private.finance_labor_object_sha_v1(obj) is distinct from p_sha256 then
  raise exception 'LABOR_UPLOAD_RECEIPT_MISMATCH' using errcode='23514';end if;
 if u.committed_at is not null and u.sha256 is distinct from p_sha256 then
  raise exception 'LABOR_UPLOAD_REPLAY_CONFLICT' using errcode='40001';end if;
 update private.finance_labor_uploads_v1 set sha256=p_sha256,committed_at=coalesce(committed_at,clock_timestamp())
 where id=u.id;
 return jsonb_build_object('uploadId',u.id,'committed',true);
end $$;

create function private.finance_labor_guest_submit_v1(p_token_hash text,p_expected_version integer,
 p_submit_id uuid,p_profile jsonb,p_uploads jsonb,p_consent_version text) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare s private.finance_labor_statements_v1;prior private.finance_labor_submissions_v1;
 snap jsonb;u jsonb;receipt private.finance_labor_uploads_v1;k text;uploads jsonb:='{}'::jsonb;
 key text;actual_name text;ts timestamptz:=clock_timestamp();request_hash text;
begin
 perform private.finance_labor_service_role_v1();
 if p_submit_id is null then raise exception 'LABOR_SUBMISSION_ID_REQUIRED' using errcode='22023';end if;
 request_hash:=private.finance_labor_hash_v1(jsonb_build_object('tokenHash',p_token_hash,
  'expectedVersion',p_expected_version,'profile',p_profile,'uploads',p_uploads,
  'consentVersion',p_consent_version)::text);
 select * into prior from private.finance_labor_submissions_v1 where submit_id=p_submit_id;
 if found then
  if prior.request_hash is distinct from request_hash then
   raise exception 'LABOR_SUBMISSION_REPLAY_CONFLICT' using errcode='40001';end if;
  select * into s from private.finance_labor_statements_v1 where id=prior.statement_id;
  if s.snapshot_hash is distinct from prior.snapshot_hash
   or not exists(select 1 from public.expense_requests r where r.id=s.request_id
    and r.tenant_id=s.tenant_id and r.entity_id=s.entity_id
    and r.status='pending_accountant') or not exists
   (select 1 from private.finance_labor_invites_v1 i where i.statement_id=s.id
    and i.token_hash=p_token_hash and i.revoked_at is null
    and (i.expires_at>clock_timestamp() or
     (s.status='signed_pending_archive' and clock_timestamp()<=s.signed_at+interval '7 days'))) then
   raise exception 'LABOR_SUBMISSION_REPLAY_FORBIDDEN' using errcode='42501';end if;
  if s.status='signed' and s.archive_hash=s.snapshot_hash then
   return jsonb_build_object('statementId',s.id,'version',s.version,'status',s.status,
    'snapshotHash',s.snapshot_hash,'identityMethod','bearer_link_only','replayed',true);
  end if;
  if s.status<>'signed_pending_archive' then
   raise exception 'LABOR_SUBMISSION_REPLAY_FORBIDDEN' using errcode='42501';end if;
  return jsonb_build_object('statementId',s.id,'version',s.version,'status',s.status,
   'snapshotHash',s.snapshot_hash,'archivePath',s.archive_path,'signedSnapshotText',s.snapshot_text,
   'identityMethod','bearer_link_only','replayed',true);
 end if;
 s:=private.finance_labor_guest_access_v1(p_token_hash,p_expected_version);
 perform pg_advisory_xact_lock(hashtextextended('labor_statement|'||s.id::text,0));
 select * into s from private.finance_labor_statements_v1 where id=s.id for update;
 perform 1 from public.expense_requests r where r.id=s.request_id
  and r.tenant_id=s.tenant_id and r.entity_id=s.entity_id
  and r.status='pending_accountant' for update;
 if not found then raise exception 'LABOR_PARENT_REQUEST_NOT_ACTIVE' using errcode='23514';end if;
 if s.status<>'invited' or s.version<>p_expected_version or p_consent_version is distinct from 'labor-v1'
  or jsonb_typeof(p_profile) is distinct from 'object' or jsonb_typeof(p_uploads) is distinct from 'object'
  or octet_length(p_profile::text)>8192 or octet_length(p_uploads::text)>8192
  or (select count(*) from jsonb_object_keys(p_profile))<>9
  or exists(select 1 from jsonb_object_keys(p_profile) x where x<>all(array[
   'fullName','idNumber','phone','address','bankCode','bankName','branchName','accountNumber','accountHolder']))
  or (select count(*) from jsonb_object_keys(p_uploads))<>4
  or exists(select 1 from jsonb_object_keys(p_uploads) x where x<>all(array[
   'identityFront','identityBack','bankProof','signature'])) then
  raise exception 'LABOR_SIGNATURE_PAYLOAD_INVALID' using errcode='22023';end if;
 foreach key in array array['fullName','idNumber','phone','address','bankCode','bankName','branchName','accountNumber','accountHolder'] loop
  if jsonb_typeof(p_profile->key) is distinct from 'string' or
   length(btrim(p_profile->>key)) not between 1 and 300 then
   raise exception 'LABOR_PROFILE_INCOMPLETE' using errcode='22023';end if;
 end loop;
 if btrim(p_profile->>'fullName') is distinct from s.signer_name
  or btrim(p_profile->>'accountHolder') is distinct from s.signer_name then
  raise exception 'LABOR_SIGNER_ACCOUNT_MISMATCH_REVIEW_REQUIRED' using errcode='23514';end if;
 foreach key in array array['identityFront','identityBack','bankProof','signature'] loop
  actual_name:=case key when 'identityFront' then 'identity_front' when 'identityBack' then 'identity_back'
   when 'bankProof' then 'bank_proof' else 'signature' end;
  u:=p_uploads->key;
  if jsonb_typeof(u) is distinct from 'object' or coalesce(u->>'sha256','') !~ '^[a-f0-9]{64}$' then
   raise exception 'LABOR_REQUIRED_UPLOAD_MISSING' using errcode='23514';end if;
  begin
   select * into receipt from private.finance_labor_uploads_v1
    where id=(u->>'uploadId')::uuid and statement_id=s.id and kind=actual_name
     and invite_id=(select i.id from private.finance_labor_invites_v1 i
      where i.statement_id=s.id and i.token_hash=p_token_hash and i.revoked_at is null);
  exception when invalid_text_representation then
   raise exception 'LABOR_REQUIRED_UPLOAD_MISSING' using errcode='23514';
  end;
  if receipt.id is null or receipt.path is distinct from u->>'path'
   or receipt.sha256 is distinct from u->>'sha256' or receipt.committed_at is null
   or not exists(select 1 from storage.objects obj where obj.bucket_id=receipt.bucket
    and obj.name=receipt.path and (obj.metadata->>'size')::bigint=receipt.size_bytes
    and private.finance_labor_object_sha_v1(obj)=receipt.sha256) then
   raise exception 'LABOR_REQUIRED_UPLOAD_NOT_PERSISTED' using errcode='23514';end if;
  uploads:=uploads||jsonb_build_object(key,jsonb_build_object('uploadId',receipt.id,'path',receipt.path,
    'sha256',receipt.sha256,'sizeBytes',receipt.size_bytes));
 end loop;
 snap:=jsonb_build_object('version',1,'statementId',s.id,'requestId',s.request_id,
  'tenantId',s.tenant_id,'entityId',s.entity_id,'period',s.period,
  'serviceLines',(private.finance_labor_safe_statement_v1(s))->'serviceLines',
  'totalGrossCents',s.total_gross_cents,'profile',p_profile,'uploads',uploads,
  'consentVersion',p_consent_version,'signedAt',ts,
  'identityMethod','bearer_link_only','submitId',p_submit_id);
 update private.finance_labor_statements_v1
 set status='signed_pending_archive',version=version+1,signed_at=ts,
  identity_method='bearer_link_only',private_profile=p_profile,
  snapshot_text=snap::text,snapshot_hash=private.finance_labor_hash_v1(snap::text),
  archive_path=s.tenant_id::text||'/'||s.id::text||'/signed/'||private.finance_labor_hash_v1(snap::text)||'.json'
 where id=s.id returning * into s;
 insert into private.finance_labor_submissions_v1(submit_id,statement_id,snapshot_hash,request_hash)
 values(p_submit_id,s.id,s.snapshot_hash,request_hash);
 insert into private.finance_labor_events_v1(statement_id,action,actor,version)
 values(s.id,'signed_pending_archive','bearer_link_only',s.version);
 return jsonb_build_object('statementId',s.id,'version',s.version,'status',s.status,
  'snapshotHash',s.snapshot_hash,'archivePath',s.archive_path,'signedSnapshotText',s.snapshot_text,
  'identityMethod','bearer_link_only','replayed',false);
end $$;

create function private.finance_labor_guest_archive_commit_v1(p_statement_id uuid,p_snapshot_hash text,
 p_path text,p_file_sha256 text) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare s private.finance_labor_statements_v1;obj storage.objects;begin
 perform private.finance_labor_service_role_v1();
 select * into s from private.finance_labor_statements_v1 where id=p_statement_id for update;
 if s.id is null or s.snapshot_hash is distinct from p_snapshot_hash or s.archive_path is distinct from p_path
  or s.snapshot_hash is distinct from p_file_sha256 then
  raise exception 'LABOR_ARCHIVE_BINDING_MISMATCH' using errcode='23514';end if;
 if s.status='signed' and s.archive_hash=s.snapshot_hash then
  return jsonb_build_object('statementId',s.id,'version',s.version,'status',s.status,
   'snapshotHash',s.snapshot_hash,'replayed',true);
 end if;
 select * into obj from storage.objects where bucket_id='finance-external-labor' and name=s.archive_path;
 if s.status<>'signed_pending_archive' or obj.id is null
  or (obj.metadata->>'size')::bigint is distinct from octet_length(convert_to(s.snapshot_text,'UTF8'))
  or private.finance_labor_object_sha_v1(obj) is distinct from s.snapshot_hash then
  raise exception 'LABOR_ARCHIVE_ORIGINAL_NOT_VERIFIED' using errcode='23514';end if;
 update private.finance_labor_statements_v1 set status='signed',version=version+1,
  archive_hash=s.snapshot_hash where id=s.id returning * into s;
 insert into private.finance_labor_events_v1(statement_id,action,actor,version)
 values(s.id,'signed','archive_gateway',s.version);
 return jsonb_build_object('statementId',s.id,'version',s.version,'status',s.status,
  'snapshotHash',s.snapshot_hash,'replayed',false);
end $$;

-- Accountant-only recovery for a submitted but unarchived original after the
-- invitation recovery window. The Edge server must verify the object's bytes
-- and call archive_commit; browser responses must never include this snapshot.
create function private.finance_labor_staff_archive_repair_v1(p_statement_id uuid) returns jsonb
 language plpgsql stable security definer set search_path='' as $$
declare s private.finance_labor_statements_v1;a public.finance_users;begin
 select * into s from private.finance_labor_statements_v1 where id=p_statement_id;
 if s.id is null then raise exception 'LABOR_ARCHIVE_REPAIR_NOT_FOUND' using errcode='42501';end if;
 a:=private.finance_labor_actor_v1(s.entity_id,false);
 if public.current_finance_role()<>'accountant' or a.tenant_id<>s.tenant_id then
  raise exception 'LABOR_ARCHIVE_REPAIR_FORBIDDEN' using errcode='42501';end if;
 if s.status in('signed','reviewed','accrued','partially_paid','paid')
  and s.archive_hash=s.snapshot_hash then
  return jsonb_build_object('statementId',s.id,'status','signed','version',s.version,
   'snapshotHash',s.snapshot_hash,'replayed',true);
 end if;
 if s.status<>'signed_pending_archive' or s.snapshot_text is null
  or s.snapshot_hash is distinct from private.finance_labor_hash_v1(s.snapshot_text)
  or s.archive_path is null then
  raise exception 'LABOR_ARCHIVE_REPAIR_FORBIDDEN' using errcode='42501';end if;
 return jsonb_build_object('statementId',s.id,'status',s.status,'version',s.version,
  'signedSnapshotText',s.snapshot_text,'snapshotHash',s.snapshot_hash,'archivePath',s.archive_path);
end $$;

create function private.finance_labor_staff_list_v1(p_entity_id text,p_period text,p_status text,
 p_limit integer,p_cursor uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare a public.finance_users;s private.finance_labor_statements_v1;items jsonb:='[]'::jsonb;
 next_id uuid;lim integer:=least(greatest(coalesce(p_limit,50),1),100);n integer:=0;begin
 a:=private.finance_labor_actor_v1(p_entity_id,false);
 if coalesce(p_period,'') !~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
  or (p_status is not null and p_status not in('invited','signed_pending_archive','signed','returned',
   'reviewed','accrued','partially_paid','paid','revoked')) then
  raise exception 'LABOR_LIST_FILTER_INVALID' using errcode='22023';end if;
 for s in select * from private.finance_labor_statements_v1 x
  where x.tenant_id=a.tenant_id and x.entity_id=p_entity_id and x.period=p_period
   and (p_status is null or x.status=p_status)
   and (p_cursor is null or x.id>p_cursor)
  order by x.id limit lim+1 loop
  n:=n+1;if n>lim then exit;end if;
  next_id:=s.id;
  items:=items||jsonb_build_array(jsonb_build_object('statementId',s.id,'requestId',s.request_id,
    'status',s.status,'version',s.version,'entityId',s.entity_id,'period',s.period,
    'totalGrossCents',s.total_gross_cents,'totalPaidGrossCents',coalesce((select sum(p.gross_cents)
     from private.finance_labor_payments_v1 p where p.statement_id=s.id),0),
    'plannedPaymentDates',s.planned_payment_dates,'signedAt',s.signed_at,
    'paidDates',coalesce((select jsonb_agg(p.paid_on order by p.paid_on) from
     private.finance_labor_payments_v1 p where p.statement_id=s.id),'[]'::jsonb)));
 end loop;
 return jsonb_build_object('items',items,'nextCursor',case when n>lim then next_id else null end);
end $$;
create function private.finance_labor_staff_get_v1(p_statement_id uuid) returns jsonb
 language plpgsql stable security definer set search_path='' as $$
declare s private.finance_labor_statements_v1;a public.finance_users;begin
 select * into s from private.finance_labor_statements_v1 where id=p_statement_id;
 if s.id is null then raise exception 'LABOR_STATEMENT_NOT_FOUND' using errcode='42501';end if;
 a:=private.finance_labor_actor_v1(s.entity_id,false);
 if a.tenant_id<>s.tenant_id then raise exception 'LABOR_STATEMENT_FORBIDDEN' using errcode='42501';end if;
 return private.finance_labor_safe_statement_v1(s)||jsonb_build_object('reviewedBy',s.reviewed_by,
  'reviewedAt',s.reviewed_at,'accruedAt',s.accrued_at);
end $$;
create function private.finance_labor_staff_for_request_v1(p_request_id text) returns jsonb
 language plpgsql stable security definer set search_path='' as $$
declare s private.finance_labor_statements_v1;r public.expense_requests;a public.finance_users;begin
 select * into r from public.expense_requests where id=p_request_id;
 if r.id is null or r.form_payload->'electronicLabor'->>'version'<>'1' then
  raise exception 'LABOR_REQUEST_NOT_FOUND' using errcode='42501';end if;
 a:=private.finance_labor_actor_v1(r.entity_id,false);
 if a.tenant_id<>r.tenant_id then raise exception 'LABOR_REQUEST_FORBIDDEN' using errcode='42501';end if;
 select * into s from private.finance_labor_statements_v1 where request_id=r.id;
 if s.id is null then return jsonb_build_object('requestId',r.id,'status','pending_invite',
  'entityId',r.entity_id,'totalGrossCents',(r.amount*100)::bigint);end if;
 return private.finance_labor_safe_statement_v1(s)||jsonb_build_object('reviewedBy',s.reviewed_by,
  'reviewedAt',s.reviewed_at,'accruedAt',s.accrued_at);
end $$;
create function private.finance_labor_request_status_v1(p_request_id text) returns jsonb
 language plpgsql stable security definer set search_path='' as $$
declare r public.expense_requests;s private.finance_labor_statements_v1;a public.finance_users;
 allowed boolean:=false;begin
 a:=public.current_finance_user();
 select * into r from public.expense_requests where id=p_request_id;
 if auth.uid() is null or a.id is null or a.auth_user_id is distinct from auth.uid()
  or a.active is distinct from true or r.id is null or r.tenant_id is distinct from a.tenant_id
  or r.form_payload->'electronicLabor'->>'version'<>'1' then
  raise exception 'LABOR_REQUEST_STATUS_FORBIDDEN' using errcode='42501';end if;
 allowed:=r.applicant_id=a.id or exists(select 1 from jsonb_array_elements(
  case when jsonb_typeof(r.steps)='array' then r.steps else '[]'::jsonb end) x
  where x->>'uid'=a.id);
 if not allowed and a.role in('accountant','ceo','admin_director') then
  perform private.finance_labor_actor_v1(r.entity_id,false);allowed:=true;end if;
 if not allowed then raise exception 'LABOR_REQUEST_STATUS_FORBIDDEN' using errcode='42501';end if;
 select * into s from private.finance_labor_statements_v1 where request_id=r.id;
 return jsonb_build_object('requestId',r.id,'statementId',s.id,
  'status',coalesce(s.status,'pending_invite'),'version',s.version,
  'signedAt',s.signed_at,'reviewedAt',s.reviewed_at);
end $$;
create function private.finance_labor_rotate_invite_v1(p_statement_id uuid,p_expected_version integer,
 p_token_hash text,p_expires_at timestamptz,p_reason text) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare s private.finance_labor_statements_v1;a public.finance_users;i private.finance_labor_invites_v1;begin
 select * into s from private.finance_labor_statements_v1 where id=p_statement_id;
 if s.id is null then raise exception 'LABOR_INVITE_NOT_FOUND' using errcode='42501';end if;
 a:=private.finance_labor_actor_v1(s.entity_id,true);
 if a.tenant_id<>s.tenant_id or public.current_finance_role()<>'accountant'
  or s.status<>'invited' or s.version<>p_expected_version
  or p_token_hash !~ '^[a-f0-9]{64}$'
  or p_expires_at not between clock_timestamp()+interval '5 minutes' and clock_timestamp()+interval '30 days'
  or length(btrim(coalesce(p_reason,''))) not between 4 and 500 then
  raise exception 'LABOR_INVITE_ROTATION_FORBIDDEN' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('labor_statement|'||s.id::text,0));
 select * into s from private.finance_labor_statements_v1 where id=s.id for update;
 if s.status<>'invited' or s.version<>p_expected_version then raise exception 'LABOR_INVITE_VERSION_CONFLICT' using errcode='40001';end if;
 update private.finance_labor_invites_v1 set revoked_at=clock_timestamp()
 where statement_id=s.id and revoked_at is null;
 insert into private.finance_labor_invites_v1(statement_id,token_hash,expires_at,created_by)
 values(s.id,p_token_hash,p_expires_at,a.id) returning * into i;
 update private.finance_labor_statements_v1 set version=version+1 where id=s.id returning * into s;
 insert into private.finance_labor_events_v1(statement_id,action,actor,reason,version)
 values(s.id,'invite_rotated',a.id,btrim(p_reason),s.version);
 return jsonb_build_object('statementId',s.id,'inviteId',i.id,'version',s.version,
  'status',s.status,'expiresAt',i.expires_at);
end $$;

create function private.finance_labor_staff_review_v1(p_statement_id uuid,p_expected_version integer,
 p_request_key uuid,p_line_decisions jsonb,p_reason text) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare s private.finance_labor_statements_v1;a public.finance_users;d jsonb;l private.finance_labor_lines_v1;
 r public.expense_requests;h text;op private.finance_labor_operations_v1;result jsonb;counted integer:=0;begin
 select * into s from private.finance_labor_statements_v1 where id=p_statement_id;
 if s.id is null then raise exception 'LABOR_REVIEW_NOT_FOUND' using errcode='42501';end if;
 a:=private.finance_labor_actor_v1(s.entity_id,true);
 if a.tenant_id<>s.tenant_id or public.current_finance_role()<>'accountant'
  or p_request_key is null or jsonb_typeof(p_line_decisions) is distinct from 'array'
  or jsonb_array_length(p_line_decisions) not between 1 and 100
  or length(btrim(coalesce(p_reason,''))) not between 4 and 500 then
  raise exception 'LABOR_REVIEW_INVALID' using errcode='22023';end if;
 h:=private.finance_labor_hash_v1(jsonb_build_object('statementId',p_statement_id,
  'expectedVersion',p_expected_version,'decisions',p_line_decisions,'reason',p_reason)::text);
 perform pg_advisory_xact_lock(hashtextextended('labor_statement|'||s.id::text,0));
 select * into op from private.finance_labor_operations_v1 where request_key=p_request_key;
 if found then
  if op.statement_id<>s.id or op.operation<>'review' or op.payload_hash<>h then
   raise exception 'LABOR_OPERATION_REPLAY_CONFLICT' using errcode='40001';end if;
  return op.result||jsonb_build_object('replayed',true);
 end if;
 select * into s from private.finance_labor_statements_v1 where id=s.id for update;
 select * into r from public.expense_requests where id=s.request_id for update;
 if s.status<>'signed' or s.version<>p_expected_version or s.archive_hash is distinct from s.snapshot_hash
  or r.id is null or r.tenant_id<>s.tenant_id or r.entity_id<>s.entity_id
  or r.status<>'pending_accountant'
  or not exists(select 1 from storage.objects obj where obj.bucket_id='finance-external-labor'
   and obj.name=s.archive_path and private.finance_labor_object_sha_v1(obj)=s.archive_hash) then
  raise exception 'LABOR_REVIEW_REQUIRES_SIGNED_ARCHIVE' using errcode='23514';end if;
 if (select count(*) from private.finance_labor_lines_v1 x where x.statement_id=s.id)
   <>jsonb_array_length(p_line_decisions) or
  (select count(distinct x->>'serviceLineId') from jsonb_array_elements(p_line_decisions) x)
   <>jsonb_array_length(p_line_decisions) then
  raise exception 'LABOR_REVIEW_COVERAGE_MISMATCH' using errcode='23514';end if;
 for d in select value from jsonb_array_elements(p_line_decisions) loop
  if jsonb_typeof(d) is distinct from 'object'
   or exists(select 1 from jsonb_object_keys(d) k where k<>all(array['serviceLineId','incomeCategory','expenseAccount','classificationBasis']))
   or coalesce(d->>'incomeCategory','') not in('50','9A','9B')
   or coalesce(d->>'expenseAccount','') !~ '^[56][0-9]{3,5}$'
   or length(btrim(coalesce(d->>'classificationBasis',''))) not between 8 and 1000 then
   raise exception 'LABOR_REVIEW_CLASSIFICATION_REQUIRED' using errcode='22023';end if;
  select * into l from private.finance_labor_lines_v1 where id=(d->>'serviceLineId')::uuid
   and statement_id=s.id for update;
  if l.id is null or private.finance_tenant_account_name(s.tenant_id,d->>'expenseAccount') is null then
   raise exception 'LABOR_REVIEW_LINE_OR_ACCOUNT_INVALID' using errcode='23514';end if;
  update private.finance_labor_lines_v1 set income_category=d->>'incomeCategory',
   expense_account=d->>'expenseAccount',classification_basis=btrim(d->>'classificationBasis') where id=l.id;
  counted:=counted+1;
 end loop;
 update private.finance_labor_statements_v1 set status='reviewed',version=version+1,
  reviewed_by=a.id,reviewed_at=clock_timestamp() where id=s.id returning * into s;
 insert into private.finance_labor_events_v1(statement_id,action,actor,reason,version)
 values(s.id,'reviewed',a.id,btrim(p_reason),s.version);
 result:=private.finance_labor_safe_statement_v1(s)||jsonb_build_object('reviewedBy',a.id,
  'reviewedAt',s.reviewed_at,'replayed',false);
 insert into private.finance_labor_operations_v1(request_key,statement_id,operation,payload_hash,result)
 values(p_request_key,s.id,'review',h,result);
 return result;
end $$;

create function private.finance_labor_post_book_v1(p_tenant uuid,p_entity text,p_department text,
 p_date date,p_voucher_no text,p_request_ref text,p_source_type text,p_source_id text,p_source_no text,
 p_entries jsonb,p_creator text,p_description text) returns void
 language plpgsql security definer set search_path='' as $$
declare e jsonb;idx integer:=0;total numeric:=0;begin
 if jsonb_typeof(p_entries) is distinct from 'array' or jsonb_array_length(p_entries) not between 2 and 105
  or (select coalesce(sum(case when x->>'t'='dr' then (x->>'amt')::numeric else -(x->>'amt')::numeric end),0)
    from jsonb_array_elements(p_entries) x)<>0 then
  raise exception 'LABOR_POST_UNBALANCED' using errcode='23514';end if;
 select coalesce(sum((x->>'amt')::numeric),0) into total
 from jsonb_array_elements(p_entries) x where x->>'t'='dr';
 insert into public.vouchers(id,no,request_id,entity_id,entity_name,voucher_date,description,entries,total,
  creator,posted,posted_at,posting_locked_at,data_environment,tenant_id)
 values(p_voucher_no,p_voucher_no,p_request_ref,p_entity,p_entity,p_date,p_description,p_entries,total,
  p_creator,true,clock_timestamp(),clock_timestamp(),'production',p_tenant);
 for e in select value from jsonb_array_elements(p_entries) loop
  idx:=idx+1;
  insert into public.ledger_entries(entry_date,description,entity_id,department_code,debit,credit,
   account_code,account_name,reference_no,posting_key,source_type,source_id,source_no,voucher_no,
   data_environment,tenant_id)
  values(p_date,p_description,p_entity,coalesce(e->>'dept',p_department),
   case when e->>'t'='dr' then (e->>'amt')::numeric else 0 end,
   case when e->>'t'='cr' then (e->>'amt')::numeric else 0 end,
   e->>'ac',e->>'an',p_voucher_no,'external_labor:'||p_source_type||':'||p_source_id||':'||idx,
   'external_labor',p_source_id,p_source_no,p_voucher_no,'production',p_tenant);
 end loop;
end $$;
create function private.finance_labor_staff_accrue_v1(p_statement_id uuid,p_expected_version integer,
 p_request_key uuid,p_reason text) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare s private.finance_labor_statements_v1;a public.finance_users;r public.expense_requests;
 l private.finance_labor_lines_v1;op private.finance_labor_operations_v1;h text;entries jsonb;
 num text;name text;payable text;result jsonb;vouchers jsonb:='[]'::jsonb;begin
 select * into s from private.finance_labor_statements_v1 where id=p_statement_id;
 if s.id is null then raise exception 'LABOR_ACCRUAL_NOT_FOUND' using errcode='42501';end if;
 a:=private.finance_labor_actor_v1(s.entity_id,true);
 if a.tenant_id<>s.tenant_id or public.current_finance_role() not in('ceo','admin_director')
  or a.id=s.reviewed_by or p_request_key is null
  or length(btrim(coalesce(p_reason,''))) not between 4 and 500 then
  raise exception 'LABOR_INDEPENDENT_ACCRUAL_REVIEW_REQUIRED' using errcode='42501';end if;
 h:=private.finance_labor_hash_v1(jsonb_build_object('statementId',p_statement_id,
  'expectedVersion',p_expected_version,'reason',p_reason)::text);
 perform pg_advisory_xact_lock(hashtextextended('labor_statement|'||s.id::text,0));
 select * into op from private.finance_labor_operations_v1 where request_key=p_request_key;
 if found then
  if op.statement_id<>s.id or op.operation<>'accrue' or op.payload_hash<>h then
   raise exception 'LABOR_OPERATION_REPLAY_CONFLICT' using errcode='40001';end if;
  return op.result||jsonb_build_object('replayed',true);
 end if;
 select * into s from private.finance_labor_statements_v1 where id=s.id for update;
 select * into r from public.expense_requests where id=s.request_id for update;
 if s.status<>'reviewed' or s.version<>p_expected_version
  or s.archive_hash is distinct from s.snapshot_hash
  or not exists(select 1 from storage.objects obj where obj.bucket_id='finance-external-labor'
   and obj.name=s.archive_path and private.finance_labor_object_sha_v1(obj)=s.archive_hash)
  or r.id is null or r.tenant_id<>s.tenant_id or r.entity_id<>s.entity_id
  or r.status<>'pending_cashier'
  or r.amount*100<>s.total_gross_cents
  or not exists(select 1 from jsonb_array_elements(r.steps) x
   where x->>'rk'='ceo' and (x->>'a' in('approved','AUTO') or x->>'status' in('approved','auto_approved')))
  or exists(select 1 from jsonb_array_elements(r.steps) x
   where x->>'rk' not in('cashier','applicant_confirm','voucher','accountant_final')
    and not (x->>'a' in('approved','AUTO') or x->>'status' in('approved','auto_approved','skipped')
     or x->>'auto'='true' or x->>'autoSkip'='true')) then
  raise exception 'LABOR_ACCRUAL_REQUIRES_SIGNED_REVIEWED_MANAGER_APPROVAL' using errcode='23514';end if;
 if (select count(*) from private.finance_labor_lines_v1 x where x.statement_id=s.id
  and x.income_category is not null and x.expense_account is not null and x.accrual_voucher_no is null)
  <>(select count(*) from private.finance_labor_lines_v1 x where x.statement_id=s.id) then
  raise exception 'LABOR_ACCRUAL_LINES_NOT_READY' using errcode='23514';end if;
 payable:=private.finance_tenant_account_name(s.tenant_id,'2131');
 if payable is null then raise exception 'LABOR_PAYABLE_ACCOUNT_MISSING' using errcode='23514';end if;
 for l in select * from private.finance_labor_lines_v1 where statement_id=s.id order by service_date,id for update loop
  perform private.finance_assert_period_open(s.tenant_id,'production',s.entity_id,l.service_date,'電子勞報課程毛額應計');
  name:=private.finance_tenant_account_name(s.tenant_id,l.expense_account);
  if name is null or l.expense_account !~ '^[56][0-9]{3,5}$' then
   raise exception 'LABOR_EXPENSE_ACCOUNT_NO_LONGER_VALID' using errcode='23514';end if;
  num:=private.finance_next_voucher_no_for_tenant(s.tenant_id,'LACC',l.service_date,'production');
  entries:=jsonb_build_array(
   jsonb_build_object('t','dr','ac',l.expense_account,'an',name,'amt',l.gross_cents/100.0,'dept',l.department_code),
   jsonb_build_object('t','cr','ac','2131','an',payable,'amt',l.gross_cents/100.0,'dept',l.department_code));
  update private.finance_labor_lines_v1 set accrual_voucher_no=num,
   accrued_at=clock_timestamp(),writing_transaction=pg_current_xact_id()::text where id=l.id;
  perform private.finance_labor_post_book_v1(s.tenant_id,s.entity_id,l.department_code,l.service_date,
   num,'labor:accrual:'||l.id,'accrual',l.id::text,r.no,entries,a.name,
   '外聘講師課程毛額應計 '||l.course_ref);
  vouchers:=vouchers||jsonb_build_array(num);
 end loop;
 update private.finance_labor_statements_v1 set status='accrued',version=version+1,
  accrued_by=a.id,accrued_at=clock_timestamp(),writing_transaction=pg_current_xact_id()::text
  where id=s.id returning * into s;
 -- The legacy cashier/confirmation/final-voucher steps have no authority over
 -- this separately posted gross accrual and bank allocation. Preserve every
 -- completed management step, skip only these superseded steps.
 update public.expense_requests set status='pending_external_labor_settlement',
  step=jsonb_array_length(r.steps),
  steps=(select jsonb_agg(case when x.value->>'rk' in
    ('cashier','applicant_confirm','voucher','accountant_final') then
     jsonb_set(jsonb_set(x.value,'{a}','"AUTO"'::jsonb,true),'{status}','"skipped"'::jsonb,true)
    else x.value end order by x.ordinality)
   from jsonb_array_elements(r.steps) with ordinality x(value,ordinality))
 where id=r.id;
 insert into private.finance_labor_events_v1(statement_id,action,actor,reason,version)
 values(s.id,'accrued',a.id,btrim(p_reason),s.version);
 result:=private.finance_labor_safe_statement_v1(s)||jsonb_build_object('accrualVoucherNos',vouchers,
  'accruedAt',s.accrued_at,'replayed',false);
 insert into private.finance_labor_operations_v1(request_key,statement_id,operation,payload_hash,result)
 values(p_request_key,s.id,'accrue',h,result);
 return result;
end $$;

create function private.finance_labor_staff_evidence_authorize_v1(p_statement_id uuid,
 p_file_name text,p_mime text,p_size_bytes bigint) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare s private.finance_labor_statements_v1;a public.finance_users;i private.finance_labor_payment_evidence_intents_v1;begin
 select * into s from private.finance_labor_statements_v1 where id=p_statement_id;
 if s.id is null then raise exception 'LABOR_EVIDENCE_STATEMENT_NOT_FOUND' using errcode='42501';end if;
 a:=private.finance_labor_actor_v1(s.entity_id,true);
 if a.tenant_id<>s.tenant_id or public.current_finance_role()<>'accountant'
  or s.status not in('accrued','partially_paid')
  or not exists(select 1 from public.expense_requests r where r.id=s.request_id
   and r.tenant_id=s.tenant_id and r.entity_id=s.entity_id
   and r.status='pending_external_labor_settlement')
  or length(btrim(coalesce(p_file_name,''))) not between 1 and 200
  or p_file_name ~ '[\\/]' or p_mime not in('application/pdf','image/png','image/jpeg')
  or p_size_bytes not between 1 and 10485760 then
  raise exception 'LABOR_PAYMENT_EVIDENCE_AUTHORIZATION_DENIED' using errcode='42501';end if;
 insert into private.finance_labor_payment_evidence_intents_v1(statement_id,path,mime,size_bytes,created_by)
 values(s.id,s.tenant_id::text||'/'||s.id::text||'/payment_evidence/'||gen_random_uuid()::text,
  p_mime,p_size_bytes,a.id) returning * into i;
 return jsonb_build_object('evidenceId',i.id,'bucket','finance-external-labor',
  'path',i.path,'maxBytes',10485760);
end $$;

create function private.finance_labor_staff_pay_v1(p_statement_id uuid,p_expected_version integer,
 p_request_key uuid,p_paid_on date,p_bank_ref text,p_allocations jsonb,p_evidence jsonb)
 returns jsonb language plpgsql security definer set search_path='' as $$
declare s private.finance_labor_statements_v1;a public.finance_users;
 l private.finance_labor_lines_v1;alloc jsonb;op private.finance_labor_operations_v1;
 payment private.finance_labor_payments_v1;h text;gross bigint:=0;tax bigint:=0;nhi bigint:=0;
 remaining bigint;entries jsonb:='[]'::jsonb;name text;num text;parent_no text;result jsonb;begin
 select * into s from private.finance_labor_statements_v1 where id=p_statement_id;
 if s.id is null then raise exception 'LABOR_PAYMENT_NOT_FOUND' using errcode='42501';end if;
 a:=private.finance_labor_actor_v1(s.entity_id,true);
 if a.tenant_id<>s.tenant_id or public.current_finance_role()<>'accountant'
  or p_request_key is null or p_paid_on is null or p_paid_on>current_date
  or length(btrim(coalesce(p_bank_ref,''))) not between 8 and 120
  or jsonb_typeof(p_allocations) is distinct from 'array'
  or jsonb_array_length(p_allocations) not between 1 and 100
  or (select count(distinct x->>'serviceLineId') from jsonb_array_elements(p_allocations) x)
    <>jsonb_array_length(p_allocations)
  or jsonb_typeof(p_evidence) is distinct from 'object' or octet_length(p_evidence::text)>8192
  or p_evidence->>'verifiedBankReference' is distinct from p_bank_ref
  or coalesce(p_evidence->>'bankStatementSha256','') !~ '^[a-f0-9]{64}$'
  or length(btrim(coalesce(p_evidence->>'taxBasis',''))) not between 8 and 1000
  or length(btrim(coalesce(p_evidence->>'nhiBasis',''))) not between 8 and 1000 then
  raise exception 'LABOR_PAYMENT_BANK_EVIDENCE_REQUIRED' using errcode='22023';end if;
 h:=private.finance_labor_hash_v1(jsonb_build_object('statementId',p_statement_id,
  'expectedVersion',p_expected_version,'paidOn',p_paid_on,'bankRef',p_bank_ref,
  'allocations',p_allocations,'evidence',p_evidence)::text);
 perform pg_advisory_xact_lock(hashtextextended('labor_statement|'||s.id::text,0));
 select * into op from private.finance_labor_operations_v1 where request_key=p_request_key;
 if found then
  if op.statement_id<>s.id or op.operation<>'pay' or op.payload_hash<>h then
   raise exception 'LABOR_OPERATION_REPLAY_CONFLICT' using errcode='40001';end if;
  return op.result||jsonb_build_object('replayed',true);
 end if;
 select * into s from private.finance_labor_statements_v1 where id=s.id for update;
 if not exists(select 1 from public.expense_requests r where r.id=s.request_id
  and r.tenant_id=s.tenant_id and r.entity_id=s.entity_id
  and r.status='pending_external_labor_settlement') then
  raise exception 'LABOR_PARENT_REQUEST_NOT_ACTIVE' using errcode='23514';end if;
 if s.status not in('accrued','partially_paid') or s.version<>p_expected_version
  or not exists(select 1 from storage.objects obj where obj.bucket_id='finance-external-labor'
   and obj.name=p_evidence->>'bankStatementPath'
   and private.finance_labor_object_sha_v1(obj)=p_evidence->>'bankStatementSha256'
   and exists(select 1 from private.finance_labor_payment_evidence_intents_v1 i
    where i.statement_id=s.id and i.path=obj.name and i.size_bytes=(obj.metadata->>'size')::bigint
     and i.created_by=a.id)) then
  raise exception 'LABOR_PAYMENT_REQUIRES_ACCRUAL_AND_BANK_PROOF' using errcode='23514';end if;
 perform private.finance_assert_period_open(s.tenant_id,'production',s.entity_id,p_paid_on,'電子勞報實際付款');
 if exists(select 1 from private.finance_labor_payments_v1 p where p.tenant_id=s.tenant_id
  and p.entity_id=s.entity_id and p.bank_ref=p_bank_ref) then
  raise exception 'LABOR_BANK_REFERENCE_ALREADY_POSTED' using errcode='23505';end if;
 name:=private.finance_tenant_account_name(s.tenant_id,'2131');
 if name is null or private.finance_tenant_account_name(s.tenant_id,'1112') is null
  or private.finance_tenant_account_name(s.tenant_id,'21953') is null
  or private.finance_tenant_account_name(s.tenant_id,'21955') is null then
  raise exception 'LABOR_SETTLEMENT_ACCOUNT_MISSING' using errcode='23514';end if;
 for alloc in select value from jsonb_array_elements(p_allocations) loop
  if jsonb_typeof(alloc) is distinct from 'object'
   or exists(select 1 from jsonb_object_keys(alloc) k where k<>all(array['serviceLineId','grossCents','incomeTaxCents','nhiCents']))
   or coalesce(alloc->>'grossCents','') !~ '^[1-9][0-9]{0,12}$'
   or coalesce(alloc->>'incomeTaxCents','') !~ '^[0-9]{1,13}$'
   or coalesce(alloc->>'nhiCents','') !~ '^[0-9]{1,13}$' then
   raise exception 'LABOR_PAYMENT_ALLOCATION_INVALID' using errcode='22023';end if;
  select * into l from private.finance_labor_lines_v1
   where id=(alloc->>'serviceLineId')::uuid and statement_id=s.id for update;
  if l.id is null or l.accrual_voucher_no is null then
   raise exception 'LABOR_PAYMENT_LINE_NOT_ACCRUED' using errcode='23514';end if;
  remaining:=l.gross_cents-coalesce((select sum(pl.gross_cents)
   from private.finance_labor_payment_lines_v1 pl where pl.service_line_id=l.id),0);
  if (alloc->>'grossCents')::bigint>remaining
   or (alloc->>'incomeTaxCents')::bigint+(alloc->>'nhiCents')::bigint >= (alloc->>'grossCents')::bigint then
   raise exception 'LABOR_PAYMENT_ALLOCATION_EXCEEDS_OUTSTANDING' using errcode='23514';end if;
  gross:=gross+(alloc->>'grossCents')::bigint;
  tax:=tax+(alloc->>'incomeTaxCents')::bigint;
  nhi:=nhi+(alloc->>'nhiCents')::bigint;
  entries:=entries||jsonb_build_array(jsonb_build_object('t','dr','ac','2131','an',name,
   'amt',(alloc->>'grossCents')::bigint/100.0,'dept',l.department_code));
 end loop;
 entries:=entries||jsonb_build_array(jsonb_build_object('t','cr','ac','1112',
  'an',private.finance_tenant_account_name(s.tenant_id,'1112'),'amt',(gross-tax-nhi)/100.0));
 if tax>0 then entries:=entries||jsonb_build_array(jsonb_build_object('t','cr','ac','21953',
  'an',private.finance_tenant_account_name(s.tenant_id,'21953'),'amt',tax/100.0));end if;
 if nhi>0 then entries:=entries||jsonb_build_array(jsonb_build_object('t','cr','ac','21955',
  'an',private.finance_tenant_account_name(s.tenant_id,'21955'),'amt',nhi/100.0));end if;
 num:=private.finance_next_voucher_no_for_tenant(s.tenant_id,'LPAY',p_paid_on,'production');
 select r.no into parent_no from public.expense_requests r where r.id=s.request_id;
 insert into private.finance_labor_payments_v1(id,statement_id,tenant_id,entity_id,paid_on,bank_ref,
  evidence,gross_cents,net_cents,tax_cents,nhi_cents,voucher_no,writing_transaction,posted_by)
 values(p_request_key,s.id,s.tenant_id,s.entity_id,p_paid_on,p_bank_ref,p_evidence,
  gross,gross-tax-nhi,tax,nhi,num,pg_current_xact_id()::text,a.id) returning * into payment;
 for alloc in select value from jsonb_array_elements(p_allocations) loop
  insert into private.finance_labor_payment_lines_v1(payment_id,service_line_id,gross_cents,tax_cents,nhi_cents)
  values(payment.id,(alloc->>'serviceLineId')::uuid,(alloc->>'grossCents')::bigint,
   (alloc->>'incomeTaxCents')::bigint,(alloc->>'nhiCents')::bigint);
 end loop;
 perform private.finance_labor_post_book_v1(s.tenant_id,s.entity_id,null,p_paid_on,num,
  'labor:payment:'||payment.id,'payment',payment.id::text,parent_no,entries,a.name,
  '外聘講師實際付款 '||p_bank_ref);
 remaining:=s.total_gross_cents-(select sum(p.gross_cents) from private.finance_labor_payments_v1 p
  where p.statement_id=s.id);
 update private.finance_labor_statements_v1 set status=case when remaining=0 then 'paid' else 'partially_paid' end,
  version=version+1,writing_transaction=pg_current_xact_id()::text where id=s.id returning * into s;
 if remaining=0 then
  update public.expense_requests set status='completed',step=jsonb_array_length(steps)
   where id=s.request_id and status='pending_external_labor_settlement';
  if not found then raise exception 'LABOR_PARENT_COMPLETION_CONFLICT' using errcode='40001';end if;
 end if;
 insert into private.finance_labor_events_v1(statement_id,action,actor,reason,version)
 values(s.id,'payment_posted',a.id,'銀行交易 '||p_bank_ref,s.version);
 result:=private.finance_labor_safe_statement_v1(s)||jsonb_build_object('paymentId',payment.id,
  'voucherNo',num,'replayed',false);
 insert into private.finance_labor_operations_v1(request_key,statement_id,operation,payload_hash,result)
 values(p_request_key,s.id,'pay',h,result);
 return result;
end $$;

-- Every labor voucher and line must belong to this SQL transaction's sealed
-- source. A generic request finalizer cannot imitate a labor posting.
create function private.finance_labor_book_guard_v1() returns trigger
 language plpgsql security definer set search_path='' as $$
declare l private.finance_labor_lines_v1;p private.finance_labor_payments_v1;
 v public.vouchers;source_id text;kind text;entry jsonb;idx integer;parent_no text;
 expected_debit numeric;expected_credit numeric;begin
 if tg_table_name='vouchers' then
  if coalesce(new.request_id,'') not like 'labor:%' and coalesce(new.no,'') not like 'LACC%'
   and coalesce(new.no,'') not like 'LPAY%' then return new;end if;
  kind:=split_part(new.request_id,':',2);source_id:=split_part(new.request_id,':',3);
  if kind='accrual' then
   select * into l from private.finance_labor_lines_v1 where id::text=source_id;
   select r.no into parent_no from private.finance_labor_statements_v1 s
    join public.expense_requests r on r.id=s.request_id where s.id=l.statement_id;
   if l.id is null or l.writing_transaction is distinct from pg_current_xact_id()::text
    or l.accrual_voucher_no is distinct from new.no
    or new.voucher_date is distinct from l.service_date
    or new.entity_id is distinct from l.entity_id or new.tenant_id is distinct from l.tenant_id then
    raise exception 'LABOR_ATOMIC_ACCRUAL_REQUIRED' using errcode='42501';end if;
  elsif kind='payment' then
   select * into p from private.finance_labor_payments_v1 where id::text=source_id;
   select r.no into parent_no from private.finance_labor_statements_v1 s
    join public.expense_requests r on r.id=s.request_id where s.id=p.statement_id;
   if p.id is null or p.writing_transaction is distinct from pg_current_xact_id()::text
    or p.voucher_no is distinct from new.no or new.voucher_date is distinct from p.paid_on
    or new.entity_id is distinct from p.entity_id or new.tenant_id is distinct from p.tenant_id then
    raise exception 'LABOR_ATOMIC_PAYMENT_REQUIRED' using errcode='42501';end if;
  else raise exception 'LABOR_POSTING_SOURCE_INVALID' using errcode='42501';end if;
  if new.id is distinct from new.no or new.data_environment is distinct from 'production'
   or new.posted is distinct from true or new.posting_locked_at is null
   or new.adjusts_voucher_no is not null or new.adjustment_type is not null
   or new.total is distinct from (select sum((e->>'amt')::numeric)
    from jsonb_array_elements(new.entries) e where e->>'t'='dr')
   or (select sum(case when e->>'t'='dr' then (e->>'amt')::numeric else -(e->>'amt')::numeric end)
    from jsonb_array_elements(new.entries) e)<>0 then
   raise exception 'LABOR_ATOMIC_VOUCHER_INVALID' using errcode='42501';end if;
 else
  if coalesce(new.source_type,'')<>'external_labor'
   and coalesce(new.posting_key,'') not like 'external_labor:%'
   and coalesce(new.voucher_no,'') not like 'LACC%'
   and coalesce(new.voucher_no,'') not like 'LPAY%' then return new;end if;
  select * into v from public.vouchers where no=new.voucher_no;
  kind:=split_part(v.request_id,':',2);source_id:=split_part(v.request_id,':',3);
  if kind='accrual' then
   select * into l from private.finance_labor_lines_v1 where id::text=source_id;
   select r.no into parent_no from private.finance_labor_statements_v1 s
    join public.expense_requests r on r.id=s.request_id where s.id=l.statement_id;
   if l.id is null or l.writing_transaction is distinct from pg_current_xact_id()::text then
    raise exception 'LABOR_LEDGER_ACCRUAL_SOURCE_INVALID' using errcode='42501';end if;
  elsif kind='payment' then
   select * into p from private.finance_labor_payments_v1 where id::text=source_id;
   select r.no into parent_no from private.finance_labor_statements_v1 s
    join public.expense_requests r on r.id=s.request_id where s.id=p.statement_id;
   if p.id is null or p.writing_transaction is distinct from pg_current_xact_id()::text then
    raise exception 'LABOR_LEDGER_PAYMENT_SOURCE_INVALID' using errcode='42501';end if;
  else raise exception 'LABOR_LEDGER_SOURCE_INVALID' using errcode='42501';end if;
  if v.no is null or new.source_type is distinct from 'external_labor'
   or new.source_id is distinct from source_id or new.source_no is distinct from parent_no
   or new.reference_no is distinct from v.no or new.entry_date is distinct from v.voucher_date
   or new.tenant_id is distinct from v.tenant_id or new.entity_id is distinct from v.entity_id
   or new.data_environment is distinct from 'production'
   or new.posting_key !~ '^external_labor:(accrual|payment):[0-9a-f-]{36}:[1-9][0-9]*$' then
   raise exception 'LABOR_LEDGER_ATOMIC_SOURCE_REQUIRED' using errcode='42501';end if;
  idx:=split_part(new.posting_key,':',4)::integer;
  entry:=v.entries->(idx-1);
  expected_debit:=case when entry->>'t'='dr' then (entry->>'amt')::numeric else 0 end;
  expected_credit:=case when entry->>'t'='cr' then (entry->>'amt')::numeric else 0 end;
  if new.posting_key is distinct from 'external_labor:'||kind||':'||source_id||':'||idx
   or entry is null or new.account_code is distinct from entry->>'ac'
   or new.account_name is distinct from entry->>'an'
   or new.department_code is distinct from nullif(entry->>'dept','')
   or new.debit is distinct from expected_debit
   or new.credit is distinct from expected_credit then
   raise exception 'LABOR_LEDGER_ATOMIC_LINE_REQUIRED' using errcode='42501';end if;
 end if;return new;
end $$;
create trigger finance_labor_atomic_post_v1 before insert on public.vouchers
 for each row execute function private.finance_labor_book_guard_v1();
create trigger finance_labor_atomic_post_v1 before insert on public.ledger_entries
 for each row execute function private.finance_labor_book_guard_v1();
create unique index finance_labor_posting_once_v1 on public.ledger_entries
 (tenant_id,data_environment,posting_key) where source_type='external_labor';

create function private.finance_labor_export_page_v1(p_entity_id text,p_paid_from date,p_paid_to date,
 p_limit integer,p_cursor jsonb,p_as_of timestamptz default null) returns jsonb
 language plpgsql stable security definer set search_path='' as $$
declare a public.finance_users;p private.finance_labor_payments_v1;
 s private.finance_labor_statements_v1;items jsonb:='[]'::jsonb;cursor_date date;
 cursor_id uuid;next_cursor jsonb;lim integer:=least(greatest(coalesce(p_limit,50),1),100);n integer:=0;
 incomplete text;as_of timestamptz:=coalesce(p_as_of,statement_timestamp());begin
 a:=private.finance_labor_actor_v1(p_entity_id,false);
 if public.current_finance_role()<>'accountant' or p_paid_from is null or p_paid_to is null
  or p_paid_from>=p_paid_to or p_paid_to>p_paid_from+interval '32 days'
  or as_of>statement_timestamp()
  or (p_cursor is not null and (jsonb_typeof(p_cursor)<>'object'
    or coalesce(p_cursor->>'paidOn','') !~ '^\d{4}-\d{2}-\d{2}$'
    or coalesce(p_cursor->>'paymentId','') !~* '^[0-9a-f-]{36}$')) then
  raise exception 'LABOR_EXPORT_SCOPE_INVALID' using errcode='42501';end if;
 if p_cursor is not null then cursor_date:=(p_cursor->>'paidOn')::date;
  cursor_id:=(p_cursor->>'paymentId')::uuid;end if;
 for p in select * from private.finance_labor_payments_v1 q
  where q.tenant_id=a.tenant_id and q.entity_id=p_entity_id
   and q.paid_on>=p_paid_from and q.paid_on<p_paid_to
   and q.posted_at<=as_of
   and (p_cursor is null or (q.paid_on,q.id)>(cursor_date,cursor_id))
  order by q.paid_on,q.id limit lim+1 loop
  n:=n+1;if n>lim then exit;end if;
  next_cursor:=jsonb_build_object('paidOn',p.paid_on,'paymentId',p.id);
  select * into s from private.finance_labor_statements_v1 where id=p.statement_id;
  incomplete:=case when s.snapshot_hash is null then 'missing_signed_snapshot'
   when s.archive_hash is distinct from s.snapshot_hash then 'archive_not_verified'
   when s.private_profile is null then 'missing_profile'
   when not exists(select 1 from storage.objects obj where obj.bucket_id='finance-external-labor'
    and obj.name=s.archive_path and private.finance_labor_object_sha_v1(obj)=s.snapshot_hash) then 'archive_object_missing'
   else null end;
  items:=items||jsonb_build_array(jsonb_build_object('statementId',s.id,'requestId',s.request_id,
   'payerEntityId',s.entity_id,'period',s.period,'status',s.status,
   'paymentId',p.id,'paidAt',p.paid_on,'paidMonth',to_char(p.paid_on,'YYYY-MM'),
   'paidCents',p.gross_cents,'withheldCents',p.tax_cents+p.nhi_cents,
   'incomeTaxCents',p.tax_cents,'nhiCents',p.nhi_cents,'netCents',p.net_cents,
   'bankRef',p.bank_ref,'voucherNo',p.voucher_no,'paymentEvidence',p.evidence,
   'profile',s.private_profile,'serviceLines',(private.finance_labor_safe_statement_v1(s))->'serviceLines',
   'paymentAllocations',coalesce((select jsonb_agg(jsonb_build_object('serviceLineId',pl.service_line_id,
    'grossCents',pl.gross_cents,'incomeTaxCents',pl.tax_cents,'nhiCents',pl.nhi_cents)
    order by pl.service_line_id) from private.finance_labor_payment_lines_v1 pl
    where pl.payment_id=p.id),'[]'::jsonb),
   'archive',jsonb_build_object('bucket','finance-external-labor','path',s.archive_path,
    'sha256',s.snapshot_hash),'incompleteReason',incomplete));
 end loop;
 return jsonb_build_object('items',items,'nextCursor',case when n>lim then next_cursor else null end,
  'asOf',as_of);
end $$;

create function private.finance_labor_month_roster_v1(p_entity_id text,p_payment_from date,
 p_payment_to date,p_limit integer,p_cursor uuid,p_as_of timestamptz default null)
 returns jsonb language plpgsql stable security definer set search_path='' as $$
declare a public.finance_users;s private.finance_labor_statements_v1;
 items jsonb:='[]'::jsonb;next_id uuid;lim integer:=least(greatest(coalesce(p_limit,50),1),100);
 n integer:=0;as_of timestamptz:=coalesce(p_as_of,statement_timestamp());paid bigint;begin
 a:=private.finance_labor_actor_v1(p_entity_id,false);
 if public.current_finance_role()<>'accountant' or p_payment_from is null or p_payment_to is null
  or p_payment_from>=p_payment_to or p_payment_to>p_payment_from+interval '32 days'
  or as_of>statement_timestamp() then
  raise exception 'LABOR_ROSTER_SCOPE_INVALID' using errcode='42501';end if;
 for s in select * from private.finance_labor_statements_v1 x
  where x.tenant_id=a.tenant_id and x.entity_id=p_entity_id and x.created_at<=as_of
   and (p_cursor is null or x.id>p_cursor)
   and exists(select 1 from jsonb_array_elements_text(x.planned_payment_dates) d
    where d::date>=p_payment_from and d::date<p_payment_to)
  order by x.id limit lim+1 loop
  n:=n+1;if n>lim then exit;end if;
  next_id:=s.id;
  select coalesce(sum(p.gross_cents),0) into paid from private.finance_labor_payments_v1 p
   where p.statement_id=s.id and p.posted_at<=as_of;
  items:=items||jsonb_build_array(jsonb_build_object('statementId',s.id,
   'requestId',s.request_id,'payerEntityId',s.entity_id,'period',s.period,
   'signerName',s.signer_name,'status',s.status,'totalGrossCents',s.total_gross_cents,
   'totalPaidGrossCents',paid,'plannedPaymentDates',s.planned_payment_dates,
   'archive',case when s.status in('signed','reviewed','accrued','partially_paid','paid')
     and s.archive_hash=s.snapshot_hash and s.snapshot_hash is not null
     and s.signed_at<=as_of then jsonb_build_object('bucket','finance-external-labor',
      'path',s.archive_path,'sha256',s.snapshot_hash) else null end,
   'incompleteReason',case when s.status='paid' and paid=s.total_gross_cents then null
    when s.status='invited' then 'unsigned'
    when s.status='signed_pending_archive' then 'archive_pending'
    when s.status='signed' then 'accounting_review_pending'
    when s.status='reviewed' then 'accrual_pending'
    when s.status='accrued' then 'payment_pending'
    when s.status='partially_paid' then 'partial_payment'
    else s.status end));
 end loop;
 return jsonb_build_object('items',items,'nextCursor',case when n>lim then next_id else null end,
  'asOf',as_of);
end $$;

-- A monthly packet must also name a submitted request that never reached the
-- invitation RPC. The request id is TEXT in the existing schema, so this
-- separate page intentionally uses a TEXT cursor and null statementId.
create function private.finance_labor_uninvited_roster_v1(p_entity_id text,p_payment_from date,
 p_payment_to date,p_limit integer,p_cursor text,p_as_of timestamptz default null)
 returns jsonb language plpgsql stable security definer set search_path='' as $$
declare a public.finance_users;r public.expense_requests;marker jsonb;
 items jsonb:='[]'::jsonb;next_id text;lim integer:=least(greatest(coalesce(p_limit,50),1),100);
 n integer:=0;as_of timestamptz:=coalesce(p_as_of,statement_timestamp());begin
 a:=private.finance_labor_actor_v1(p_entity_id,false);
 if public.current_finance_role()<>'accountant' or p_payment_from is null or p_payment_to is null
  or p_payment_from>=p_payment_to or p_payment_to>p_payment_from+interval '32 days'
  or as_of>statement_timestamp() or length(coalesce(p_cursor,''))>512 then
  raise exception 'LABOR_UNINVITED_ROSTER_SCOPE_INVALID' using errcode='42501';end if;
 for r in select * from public.expense_requests x
  where x.tenant_id=a.tenant_id and x.entity_id=p_entity_id and x.data_environment='production'
   and x.type='hr_expense_request' and x.form_payload->'electronicLabor'->>'version'='1'
   and x.created_at<=as_of and x.status not in('cancelled','rejected')
   and (p_cursor is null or x.id>p_cursor)
   and not exists(select 1 from private.finance_labor_statements_v1 s
    where s.request_id=x.id and s.created_at<=as_of)
   and exists(select 1 from jsonb_array_elements_text(case
     when jsonb_typeof(x.form_payload->'electronicLabor'->'plannedPaymentDates')='array'
      then x.form_payload->'electronicLabor'->'plannedPaymentDates' else '[]'::jsonb end) d
    where d ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' and d>=to_char(p_payment_from,'YYYY-MM-DD')
     and d<to_char(p_payment_to,'YYYY-MM-DD'))
  order by x.id limit lim+1 loop
  n:=n+1;if n>lim then exit;end if;
  next_id:=r.id;marker:=r.form_payload->'electronicLabor';
  items:=items||jsonb_build_array(jsonb_build_object('statementId',null,'requestId',r.id,
   'payerEntityId',r.entity_id,'period',marker->>'period','signerName',marker->>'signerName',
   'status','pending_invite','totalGrossCents',case when marker->>'totalGrossCents' ~ '^[0-9]{1,13}$'
    then (marker->>'totalGrossCents')::bigint else null end,'totalPaidGrossCents',0,
   'plannedPaymentDates',marker->'plannedPaymentDates','incompleteReason','invitation_pending'));
 end loop;
 return jsonb_build_object('items',items,'nextCursor',case when n>lim then next_id else null end,
  'asOf',as_of);
end $$;

create function public.finance_labor_create_invite_v1(p_request_id text,p_entity_id text,
 p_invite_email text,p_token_hash text,p_expires_at timestamptz,p_lines jsonb) returns jsonb
 language sql security definer set search_path='' as $$select private.finance_labor_create_invite_v1(
 p_request_id,p_entity_id,p_invite_email,p_token_hash,p_expires_at,p_lines)$$;
create function public.finance_labor_rotate_invite_v1(p_statement_id uuid,p_expected_version integer,
 p_token_hash text,p_expires_at timestamptz,p_reason text) returns jsonb
 language sql security definer set search_path='' as $$select private.finance_labor_rotate_invite_v1(
 p_statement_id,p_expected_version,p_token_hash,p_expires_at,p_reason)$$;
create function public.finance_labor_staff_list_v1(p_entity_id text,p_period text,p_status text,
 p_limit integer,p_cursor uuid) returns jsonb
 language sql stable security definer set search_path='' as $$select private.finance_labor_staff_list_v1(
 p_entity_id,p_period,p_status,p_limit,p_cursor)$$;
create function public.finance_labor_staff_get_v1(p_statement_id uuid) returns jsonb
 language sql stable security definer set search_path='' as $$select private.finance_labor_staff_get_v1(p_statement_id)$$;
create function public.finance_labor_staff_for_request_v1(p_request_id text) returns jsonb
 language sql stable security definer set search_path='' as $$select private.finance_labor_staff_for_request_v1(p_request_id)$$;
create function public.finance_labor_request_status_v1(p_request_id text) returns jsonb
 language sql stable security definer set search_path='' as $$select private.finance_labor_request_status_v1(p_request_id)$$;
create function public.finance_labor_staff_review_v1(p_statement_id uuid,p_expected_version integer,
 p_request_key uuid,p_line_decisions jsonb,p_reason text) returns jsonb
 language sql security definer set search_path='' as $$select private.finance_labor_staff_review_v1(
 p_statement_id,p_expected_version,p_request_key,p_line_decisions,p_reason)$$;
create function public.finance_labor_staff_accrue_v1(p_statement_id uuid,p_expected_version integer,
 p_request_key uuid,p_reason text) returns jsonb
 language sql security definer set search_path='' as $$select private.finance_labor_staff_accrue_v1(
 p_statement_id,p_expected_version,p_request_key,p_reason)$$;
create function public.finance_labor_staff_pay_v1(p_statement_id uuid,p_expected_version integer,
 p_request_key uuid,p_paid_on date,p_bank_ref text,p_allocations jsonb,p_evidence jsonb) returns jsonb
 language sql security definer set search_path='' as $$select private.finance_labor_staff_pay_v1(
 p_statement_id,p_expected_version,p_request_key,p_paid_on,p_bank_ref,p_allocations,p_evidence)$$;
create function public.finance_labor_staff_evidence_authorize_v1(p_statement_id uuid,
 p_file_name text,p_mime text,p_size_bytes bigint) returns jsonb
 language sql security definer set search_path='' as $$select private.finance_labor_staff_evidence_authorize_v1(
 p_statement_id,p_file_name,p_mime,p_size_bytes)$$;
create function public.finance_labor_staff_archive_repair_v1(p_statement_id uuid) returns jsonb
 language sql stable security definer set search_path='' as $$select private.finance_labor_staff_archive_repair_v1(
 p_statement_id)$$;
create function public.finance_labor_export_page_v1(p_entity_id text,p_paid_from date,p_paid_to date,
 p_limit integer,p_cursor jsonb,p_as_of timestamptz default null) returns jsonb
 language sql stable security definer set search_path='' as $$select private.finance_labor_export_page_v1(
 p_entity_id,p_paid_from,p_paid_to,p_limit,p_cursor,p_as_of)$$;
create function public.finance_labor_month_roster_v1(p_entity_id text,p_payment_from date,
 p_payment_to date,p_limit integer,p_cursor uuid,p_as_of timestamptz default null) returns jsonb
 language sql stable security definer set search_path='' as $$select private.finance_labor_month_roster_v1(
 p_entity_id,p_payment_from,p_payment_to,p_limit,p_cursor,p_as_of)$$;
create function public.finance_labor_uninvited_roster_v1(p_entity_id text,p_payment_from date,
 p_payment_to date,p_limit integer,p_cursor text,p_as_of timestamptz default null) returns jsonb
 language sql stable security definer set search_path='' as $$select private.finance_labor_uninvited_roster_v1(
 p_entity_id,p_payment_from,p_payment_to,p_limit,p_cursor,p_as_of)$$;

create function public.finance_labor_guest_lookup_v1(p_token_hash text) returns jsonb
 language sql security definer set search_path='' as $$select private.finance_labor_guest_lookup_v1(p_token_hash)$$;
create function public.finance_labor_guest_upload_authorize_v1(p_token_hash text,p_expected_version integer,
 p_kind text,p_file_name text,p_mime text,p_size_bytes bigint) returns jsonb
 language sql security definer set search_path='' as $$select private.finance_labor_guest_upload_authorize_v1(
 p_token_hash,p_expected_version,p_kind,p_file_name,p_mime,p_size_bytes)$$;
create function public.finance_labor_guest_file_commit_v1(p_token_hash text,p_upload_id uuid,
 p_path text,p_kind text,p_sha256 text,p_size_bytes bigint,p_mime text) returns jsonb
 language sql security definer set search_path='' as $$select private.finance_labor_guest_file_commit_v1(
 p_token_hash,p_upload_id,p_path,p_kind,p_sha256,p_size_bytes,p_mime)$$;
create function public.finance_labor_guest_submit_v1(p_token_hash text,p_expected_version integer,
 p_submit_id uuid,p_profile jsonb,p_uploads jsonb,p_consent_version text) returns jsonb
 language sql security definer set search_path='' as $$select private.finance_labor_guest_submit_v1(
 p_token_hash,p_expected_version,p_submit_id,p_profile,p_uploads,p_consent_version)$$;
create function public.finance_labor_guest_archive_commit_v1(p_statement_id uuid,p_snapshot_hash text,
 p_path text,p_file_sha256 text) returns jsonb
 language sql security definer set search_path='' as $$select private.finance_labor_guest_archive_commit_v1(
 p_statement_id,p_snapshot_hash,p_path,p_file_sha256)$$;

do $labor_function_acl$ declare fn record;begin
 for fn in select p.oid::regprocedure::text signature,n.nspname,p.proname
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where p.proname like 'finance_labor_%_v1' and n.nspname in('private','public') loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',fn.signature);
  if fn.nspname='public' then
   if fn.proname like 'finance_labor_guest_%' then
    execute format('grant execute on function %s to service_role',fn.signature);
   else execute format('grant execute on function %s to authenticated',fn.signature);end if;
  end if;
 end loop;
end $labor_function_acl$;
notify pgrst,'reload schema';
