-- Bank file preparation is not approval, bank submission, or payment.
-- Supplementary recipient names and routing codes never enter general expense payloads.
create table private.finance_mega_recipient_supplements_v1 (
 tenant_id uuid not null, data_environment text not null check(data_environment in ('production','test')),
 request_id text not null, source_hash text not null check(source_hash ~ '^[0-9a-f]{64}$'),
 row_key text not null check(row_key ~ '^(hr|refund|payment):[1-9][0-9]{0,6}$'),
 row_fingerprint text not null, payee_name text, bank_code text,
 actor_id text not null, updated_at timestamptz not null default clock_timestamp(),
 primary key(tenant_id,data_environment,request_id,source_hash,row_key)
);
alter table private.finance_mega_recipient_supplements_v1 enable row level security;
alter table private.finance_mega_recipient_supplements_v1 force row level security;
revoke all on private.finance_mega_recipient_supplements_v1 from public,anon,authenticated,service_role;
create table private.finance_mega_recipient_events_v1 (
 id bigint generated always as identity primary key,
 tenant_id uuid not null,data_environment text not null,request_id text not null,
 source_hash text not null,row_key text not null,previous_hash text,value_hash text not null,
 actor_id text not null,occurred_at timestamptz not null default clock_timestamp()
);
alter table private.finance_mega_recipient_events_v1 enable row level security;
alter table private.finance_mega_recipient_events_v1 force row level security;
revoke all on private.finance_mega_recipient_events_v1 from public,anon,authenticated,service_role;
create function private.finance_mega_event_immutable_v1() returns trigger
language plpgsql security invoker set search_path='' as $$
begin raise exception 'MEGA_AUDIT_IMMUTABLE' using errcode='55000';end $$;
create trigger mega_recipient_event_immutable before update or delete on private.finance_mega_recipient_events_v1
for each row execute function private.finance_mega_event_immutable_v1();
create function private.finance_mega_hash_v1(p_value jsonb) returns text
language sql immutable security invoker set search_path='' as $$
 select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_value::text,'UTF8')),'hex')
$$;
create function private.finance_mega_first_v1(p_row jsonb,p_keys text[]) returns jsonb
language sql immutable security invoker set search_path='' as $$
 select p_row->k from pg_catalog.unnest(p_keys) with ordinality as keys(k,n)
 where p_row->k is not null and p_row->k<>'null'::jsonb and p_row->k<>'""'::jsonb order by n limit 1
$$;
create function private.finance_mega_bank_code_v1(p_text text) returns text
language plpgsql immutable security invoker set search_path='' as $$
declare codes text[];
begin
 select array_agg(distinct m[1]) into codes from regexp_matches(coalesce(p_text,''),'(?:^|[^0-9])([0-9]{7}|[0-9]{3})(?=$|[^0-9])','g') m;
 if cardinality(codes)=1 then return codes[1];end if;return null;
end $$;
create function private.finance_mega_code_from_row_v1(p_source jsonb) returns jsonb
language plpgsql immutable security invoker set search_path='' as $$
declare code jsonb; branch jsonb; bank_name text; bank_type text;
begin
 code:=private.finance_mega_first_v1(p_source,array['轉入銀行代號','銀行代號','bankCode','bank_code','payee_bank_code']);
 bank_name:=private.finance_mega_first_v1(p_source,array['銀行別','銀行','bankName','bank_name','payee_bank_name'])#>>'{}';
 branch:=private.finance_mega_first_v1(p_source,array['分行代號','branchCode','branch_code','bank_branch_code']);
 bank_type:=private.finance_mega_first_v1(p_source,array['bankType','bank_type'])#>>'{}';
 if code is null then code:=to_jsonb(private.finance_mega_bank_code_v1(bank_name));end if;
 if code is null and bank_type='mega' and coalesce(bank_name,'') !~* '(非|不是)[[:space:]]*兆豐|non[ -]*mega' then code:='"017"'::jsonb;end if;
 if code is not null and jsonb_typeof(code) is distinct from 'string' then raise exception 'MEGA_SOURCE_BANK_CODE_INVALID' using errcode='22023';end if;
 if code#>>'{}' ~ '^[0-9]{3}$' and branch is not null then
  if jsonb_typeof(branch) is distinct from 'string' or branch#>>'{}' !~ '^[0-9]{4}$' then raise exception 'MEGA_SOURCE_BRANCH_CODE_INVALID' using errcode='22023';end if;
  code:=to_jsonb((code#>>'{}')||(branch#>>'{}'));
 end if;
 if code is not null and ((bank_type='mega' and code#>>'{}' !~ '^017([0-9]{4})?$') or (bank_type='other' and code#>>'{}' ~ '^017([0-9]{4})?$')) then raise exception 'MEGA_SOURCE_BANK_TYPE_CONFLICT' using errcode='22023';end if;
 return code;
end $$;
create function private.finance_mega_row_v1(p_request public.expense_requests,p_row_key text) returns jsonb
language plpgsql immutable security invoker set search_path='' as $$
declare row_no integer; source_rows jsonb; source_row jsonb; fp jsonb:=coalesce(p_request.form_payload,'{}'::jsonb); name_value jsonb; code_value jsonb; account_value jsonb; amount_value jsonb;
begin
 if coalesce(p_row_key,'') !~ '^(hr|refund|payment):[1-9][0-9]{0,6}$' then raise exception 'MEGA_INVALID_ROW' using errcode='22023';end if;
 row_no:=split_part(p_row_key,':',2)::integer;
 if p_request.type='hr_expense_request' and p_row_key like 'hr:%' then
  source_rows:=case when jsonb_typeof(fp->'hrInfo'->'rows')='array' then fp->'hrInfo'->'rows' else fp->'hrRows' end;
  if jsonb_typeof(source_rows) is distinct from 'array' or row_no>jsonb_array_length(source_rows) then raise exception 'MEGA_INVALID_ROW' using errcode='22023';end if;
  source_row:=source_rows->(row_no-1);
  name_value:=private.finance_mega_first_v1(source_row,array['收款人姓名','戶名','姓名','accountName','account_name','payee','payee_name','name']);
  code_value:=private.finance_mega_code_from_row_v1(source_row);
  account_value:=private.finance_mega_first_v1(source_row,array['銀行帳號','轉入帳號','帳號','accountNo','account_no','bankNo','bank_no','bank_account','account_number','account']);
  amount_value:=private.finance_mega_first_v1(source_row,array['金額','轉帳金額','匯款金額','payment_amount','amount']);
 elsif p_request.type='refund_request' and p_row_key like 'refund:%' then
  source_rows:=case when jsonb_typeof(fp->'refundInfo'->'rows')='array' then fp->'refundInfo'->'rows' else fp->'refundRows' end;
  if jsonb_typeof(source_rows) is distinct from 'array' or row_no>jsonb_array_length(source_rows) then raise exception 'MEGA_INVALID_ROW' using errcode='22023';end if;
  source_row:=source_rows->(row_no-1);
  if source_row->>'method' in ('現金','cash') then raise exception 'MEGA_CASH_ROW' using errcode='22023';end if;
  if coalesce(source_row->>'method','') not in ('bank','銀行轉帳') then raise exception 'MEGA_SOURCE_METHOD_INVALID' using errcode='22023';end if;
  name_value:=private.finance_mega_first_v1(source_row,array['accountName','account_name']);
  code_value:=private.finance_mega_code_from_row_v1(source_row);
  account_value:=private.finance_mega_first_v1(source_row,array['accountNo','account_no']);
  amount_value:=private.finance_mega_first_v1(source_row,array['refundAmount','refund_amount']);
 elsif p_row_key='payment:1' and p_request.type<>'hr_expense_request' and p_request.type<>'refund_request' then
  source_row:=jsonb_build_object('payee',p_request.payee,'bank_name',p_request.bank_name,'bank_type',p_request.bank_type,'bank_branch',p_request.bank_branch,'bank_no',p_request.bank_no,'amount',p_request.amount);
  name_value:=to_jsonb(p_request.payee);code_value:=private.finance_mega_code_from_row_v1(to_jsonb(p_request));
  account_value:=to_jsonb(p_request.bank_no);amount_value:=to_jsonb(p_request.amount);
 else raise exception 'MEGA_INVALID_ROW' using errcode='22023';end if;
 if jsonb_typeof(source_row) is distinct from 'object' or jsonb_typeof(account_value) is distinct from 'string' or coalesce(account_value#>>'{}','')='' or amount_value is null then raise exception 'MEGA_SOURCE_INCOMPLETE' using errcode='22023';end if;
 return jsonb_build_object('name',name_value,'bankCode',code_value,'account',account_value,'amount',amount_value,'bankType',private.finance_mega_first_v1(source_row,array['bankType','bank_type']),'bankName',private.finance_mega_first_v1(source_row,array['銀行別','銀行','bankName','bank_name','payee_bank_name']),'branchCode',private.finance_mega_first_v1(source_row,array['分行代號','branchCode','branch_code','bank_branch_code']),'fingerprint',private.finance_mega_hash_v1(jsonb_build_object('rowKey',p_row_key,'row',source_row)));
end $$;
create function private.finance_mega_expense_v1(p_request_id text,p_data_environment text,p_lock boolean default false) returns public.expense_requests
language plpgsql security definer set search_path='' as $$
declare actor public.finance_users; r public.expense_requests; idx integer; active_step jsonb;
begin
 actor:=public.current_finance_user();
 if auth.uid() is null or actor.id is null or actor.auth_user_id is distinct from auth.uid() or not coalesce(actor.active,false) or coalesce(actor.role,'') not in ('admin_director','accountant','ceo','cashier','hr') then raise exception 'MEGA_FORBIDDEN' using errcode='42501';end if;
 if p_data_environment not in ('production','test') or p_data_environment is null then raise exception 'MEGA_INVALID_ENVIRONMENT' using errcode='22023';end if;
 if p_lock then select * into r from public.expense_requests where id=p_request_id and tenant_id=actor.tenant_id and data_environment=p_data_environment for update;
 else select * into r from public.expense_requests where id=p_request_id and tenant_id=actor.tenant_id and data_environment=p_data_environment;end if;
 if r.id is null or not coalesce(public.can_read_expense_request(r),false) then raise exception 'MEGA_FORBIDDEN' using errcode='42501';end if;
 if actor.role='hr' and (r.type<>'hr_expense_request' or actor.entity_id is distinct from r.entity_id) then raise exception 'MEGA_FORBIDDEN' using errcode='42501';end if;
 if nullif(btrim(r.voucher_id),'') is not null or r.status is distinct from 'pending_cashier' or r.voided_at is not null or r.cash_posted_at is not null or r.posting_locked_at is not null or r.ledger_posted_at is not null then raise exception 'MEGA_NOT_READY' using errcode='55000';end if;
 if jsonb_typeof(r.steps) is distinct from 'array' then raise exception 'MEGA_NOT_READY' using errcode='55000';end if;
 idx:=private.finance_income_active_step_index(r.steps);active_step:=r.steps->idx;
 if idx is null or private.finance_income_step_role(active_step) is distinct from 'cashier' then raise exception 'MEGA_NOT_READY' using errcode='55000';end if;
 if exists(select 1 from jsonb_array_elements(r.steps) with ordinality as previous(s,n) where n<=idx and coalesce(s->>'a','') not in ('approved','AUTO')) then raise exception 'MEGA_NOT_READY' using errcode='55000';end if;
 if actor.role='cashier' and private.finance_income_step_user_id(active_step) is distinct from actor.id then raise exception 'MEGA_FORBIDDEN' using errcode='42501';end if;
 if coalesce(r.type,'') not in ('expense_reimbursement','payment_request','advance_request','petty_cash_request','travel_request','purchase_request','refund_request','welfare_request','hr_expense_request') or r.form_payload->>'paymentType' in ('cash','現金','offset','沖帳') or coalesce(nullif(r.form_payload->>'paymentType',''),r.form_payload->>'payment_type','') not in ('bank','transfer','匯款','銀行轉帳') or coalesce(r.form_payload->'electronicLabor','null'::jsonb) not in ('null'::jsonb,'false'::jsonb,'0'::jsonb,'""'::jsonb) or coalesce(r.form_payload->'hrInfo'->'digital','null'::jsonb) not in ('null'::jsonb,'false'::jsonb,'0'::jsonb,'""'::jsonb) or r.form_payload->>'hrItem'='labor_electronic' or r.form_payload->'hrInfo'->>'item'='labor_electronic' then raise exception 'MEGA_NOT_APPLICABLE' using errcode='55000';end if;
 return r;
end $$;
create function private.finance_mega_snapshot_v1(p_request public.expense_requests) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_source_hash text:=private.finance_mega_hash_v1(to_jsonb(p_request)); supplements jsonb; actor public.finance_users:=public.current_finance_user();
begin
 select coalesce(jsonb_agg(jsonb_build_object('rowKey',s.row_key,'name',s.payee_name,'bankCode',s.bank_code) order by s.row_key),'[]'::jsonb) into supplements
 from private.finance_mega_recipient_supplements_v1 s where s.tenant_id=p_request.tenant_id and s.data_environment=p_request.data_environment and s.request_id=p_request.id and s.source_hash=v_source_hash;
 return jsonb_build_object('ok',true,'eligible',true,'stage','pending_cashier','request',to_jsonb(p_request),'sourceVersion',p_request.ver,'sourceDigest',private.finance_mega_hash_v1(jsonb_build_object('source',v_source_hash,'supplements',supplements)),'supplements',supplements,'canSupplement',actor.role in ('admin_director','accountant','hr'));
end $$;
create function private.finance_mega_remittance_snapshot_v1(p_request_id text,p_data_environment text) returns jsonb
language plpgsql security definer set search_path='' as $$
begin return private.finance_mega_snapshot_v1(private.finance_mega_expense_v1(p_request_id,p_data_environment,false));end $$;
create function private.finance_mega_remittance_supplement_save_v1(p_request_id text,p_data_environment text,p_expected_digest text,p_rows jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.expense_requests; actor public.finance_users; snap jsonb; v_source_hash text; item jsonb; original jsonb; old_value private.finance_mega_recipient_supplements_v1; v_row_key text; new_name text; new_code text; existing_name text; existing_code text; merged_value jsonb;
begin
 r:=private.finance_mega_expense_v1(p_request_id,p_data_environment,true);actor:=public.current_finance_user();
 if coalesce(actor.role,'') not in ('admin_director','accountant','hr') then raise exception 'MEGA_SUPPLEMENT_FORBIDDEN' using errcode='42501';end if;
 snap:=private.finance_mega_snapshot_v1(r);v_source_hash:=private.finance_mega_hash_v1(to_jsonb(r));
 if snap->>'sourceDigest' is distinct from p_expected_digest then raise exception 'MEGA_VERSION_CONFLICT' using errcode='40001';end if;
 if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 1000 or octet_length(p_rows::text)>262144 then raise exception 'MEGA_INVALID_SUPPLEMENT' using errcode='22023';end if;
 if exists(select 1 from jsonb_array_elements(p_rows) x group by x->>'rowKey' having count(*)>1) then raise exception 'MEGA_DUPLICATE_ROW' using errcode='22023';end if;
 for item in select * from jsonb_array_elements(p_rows) loop
  if jsonb_typeof(item) is distinct from 'object' or exists(select 1 from jsonb_object_keys(item) k where k<>all(array['rowKey','name','bankCode'])) then raise exception 'MEGA_INVALID_SUPPLEMENT' using errcode='22023';end if;
  v_row_key:=item->>'rowKey';original:=private.finance_mega_row_v1(r,v_row_key);
  select * into old_value from private.finance_mega_recipient_supplements_v1 s where s.tenant_id=r.tenant_id and s.data_environment=r.data_environment and s.request_id=r.id and s.source_hash=v_source_hash and s.row_key=v_row_key;
  new_name:=coalesce(old_value.payee_name,'');new_code:=coalesce(old_value.bank_code,'');existing_name:=btrim(coalesce(original->>'name',''));existing_code:=btrim(coalesce(original->>'bankCode',''));
  if item ? 'name' then
   if jsonb_typeof(item->'name') is distinct from 'string' or length(btrim(item->>'name')) not between 1 and 200 or item->>'name' ~ '[[:cntrl:]]' then raise exception 'MEGA_INVALID_NAME' using errcode='22023';end if;
   new_name:=btrim(item->>'name');
   if existing_name<>'' and new_name<>existing_name then raise exception 'MEGA_APPROVED_NAME_IMMUTABLE' using errcode='22023';end if;
  end if;
  if item ? 'bankCode' then
   if jsonb_typeof(item->'bankCode') is distinct from 'string' or item->>'bankCode' !~ '^([0-9]{3}|[0-9]{7})$' then raise exception 'MEGA_INVALID_BANK_CODE' using errcode='22023';end if;
   new_code:=item->>'bankCode';
   if (original->>'bankType'='mega' and new_code !~ '^017([0-9]{4})?$') or (original->>'bankType'='other' and new_code ~ '^017([0-9]{4})?$') or (coalesce(original->>'bankName','') ~* '(非|不是)[[:space:]]*兆豐|non[ -]*mega' and new_code ~ '^017([0-9]{4})?$') then raise exception 'MEGA_SOURCE_BANK_TYPE_CONFLICT' using errcode='22023';end if;
   if original->>'branchCode' is not null and (jsonb_typeof(original->'branchCode') is distinct from 'string' or original->>'branchCode' !~ '^[0-9]{4}$' or (length(new_code)=7 and right(new_code,4)<>original->>'branchCode')) then raise exception 'MEGA_SOURCE_BRANCH_CODE_INVALID' using errcode='22023';end if;
   if existing_code<>'' and new_code<>existing_code and not(existing_code ~ '^[0-9]{3}$' and length(new_code)=7 and left(new_code,3)=existing_code) then raise exception 'MEGA_APPROVED_BANK_IMMUTABLE' using errcode='22023';end if;
  end if;
  if not(item ? 'name' or item ? 'bankCode') then raise exception 'MEGA_INVALID_SUPPLEMENT' using errcode='22023';end if;
  merged_value:=jsonb_build_object('name',new_name,'bankCode',new_code,'fingerprint',original->>'fingerprint');
  insert into private.finance_mega_recipient_supplements_v1(tenant_id,data_environment,request_id,source_hash,row_key,row_fingerprint,payee_name,bank_code,actor_id)
  values(r.tenant_id,r.data_environment,r.id,v_source_hash,v_row_key,original->>'fingerprint',nullif(new_name,''),nullif(new_code,''),actor.id)
  on conflict(tenant_id,data_environment,request_id,source_hash,row_key) do update set row_fingerprint=excluded.row_fingerprint,payee_name=excluded.payee_name,bank_code=excluded.bank_code,actor_id=excluded.actor_id,updated_at=clock_timestamp();
  insert into private.finance_mega_recipient_events_v1(tenant_id,data_environment,request_id,source_hash,row_key,previous_hash,value_hash,actor_id)
  values(r.tenant_id,r.data_environment,r.id,v_source_hash,v_row_key,case when old_value.request_id is null then null else private.finance_mega_hash_v1(jsonb_build_object('name',old_value.payee_name,'bankCode',old_value.bank_code,'fingerprint',old_value.row_fingerprint))end,private.finance_mega_hash_v1(merged_value),actor.id);
 end loop;
 return private.finance_mega_snapshot_v1(r);
end $$;
create function public.finance_mega_remittance_snapshot_v1(p_request_id text,p_data_environment text default 'production') returns jsonb
language sql security invoker set search_path='' as $$select private.finance_mega_remittance_snapshot_v1(p_request_id,p_data_environment)$$;
create function public.finance_mega_remittance_supplement_save_v1(p_request_id text,p_data_environment text,p_expected_digest text,p_rows jsonb) returns jsonb
language sql security invoker set search_path='' as $$select private.finance_mega_remittance_supplement_save_v1(p_request_id,p_data_environment,p_expected_digest,p_rows)$$;
revoke all on function private.finance_mega_event_immutable_v1(),private.finance_mega_hash_v1(jsonb),private.finance_mega_bank_code_v1(text),private.finance_mega_code_from_row_v1(jsonb),private.finance_mega_first_v1(jsonb,text[]),private.finance_mega_row_v1(public.expense_requests,text),private.finance_mega_expense_v1(text,text,boolean),private.finance_mega_snapshot_v1(public.expense_requests),private.finance_mega_remittance_snapshot_v1(text,text),private.finance_mega_remittance_supplement_save_v1(text,text,text,jsonb),public.finance_mega_remittance_snapshot_v1(text,text),public.finance_mega_remittance_supplement_save_v1(text,text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.finance_mega_remittance_snapshot_v1(text,text),private.finance_mega_remittance_supplement_save_v1(text,text,text,jsonb),public.finance_mega_remittance_snapshot_v1(text,text),public.finance_mega_remittance_supplement_save_v1(text,text,text,jsonb) to authenticated;
comment on table private.finance_mega_recipient_supplements_v1 is 'Private bank-file-only recipient identity. Approved account and amount cannot be edited. Source updates invalidate all supplements; no bank transfer is initiated.';
grant usage on schema private to authenticated;
notify pgrst,'reload schema';
