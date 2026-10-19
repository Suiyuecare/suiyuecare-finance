-- Historical reconstruction is a marked reference copy, never a new payment.
-- Original expense, approval, fee, account and posting records are not updated.
-- The previously deployed Mega v1 contract remains unchanged.
create function private.finance_remittance_export_scope_v1(p_request_id text,p_data_environment text,p_lock boolean default false) returns public.expense_requests
language plpgsql security definer set search_path='' as $$
declare actor public.finance_users; r public.expense_requests;
begin
 actor:=public.current_finance_user();
 if auth.uid() is null or actor.id is null or actor.auth_user_id is distinct from auth.uid() or not coalesce(actor.active,false) or coalesce(actor.role,'') not in ('admin_director','accountant','ceo','cashier','hr') then raise exception 'MEGA_FORBIDDEN' using errcode='42501';end if;
 if p_data_environment not in ('production','test') or p_data_environment is null then raise exception 'MEGA_INVALID_ENVIRONMENT' using errcode='22023';end if;
 if p_lock then select * into r from public.expense_requests where id=p_request_id and tenant_id=actor.tenant_id and data_environment=p_data_environment for update;
 else select * into r from public.expense_requests where id=p_request_id and tenant_id=actor.tenant_id and data_environment=p_data_environment;end if;
 if r.id is null or not coalesce(public.can_read_expense_request(r),false) then raise exception 'MEGA_FORBIDDEN' using errcode='42501';end if;
 if actor.role='hr' and (r.type<>'hr_expense_request' or actor.entity_id is distinct from r.entity_id) then raise exception 'MEGA_FORBIDDEN' using errcode='42501';end if;
 if actor.role='cashier' and (jsonb_typeof(r.steps) is distinct from 'array' or not exists(select 1 from jsonb_array_elements(r.steps) s where private.finance_income_step_role(s)='cashier' and private.finance_income_step_user_id(s)=actor.id)) then raise exception 'MEGA_FORBIDDEN' using errcode='42501';end if;
 return r;
end $$;
create function private.finance_remittance_export_principal_v1(r public.expense_requests) returns numeric
language plpgsql immutable security invoker set search_path='' as $$
declare value jsonb;
begin
 if r.type='purchase_request' then
  value:=coalesce(to_jsonb(r.estimated_amount),private.finance_mega_first_v1(r.form_payload->'purchaseEstimate',array['procurementAmount']),private.finance_mega_first_v1(r.form_payload->'procurementPaymentInfo',array['amount']));
 elsif r.type='advance_request' then
  value:=coalesce(private.finance_mega_first_v1(r.form_payload,array['advanceOriginalAmount','advanceDisbursementAmount']),to_jsonb(r.estimated_amount));
 else value:=to_jsonb(r.amount);end if;
 if jsonb_typeof(value) not in ('number','string') or coalesce(value#>>'{}','') !~ '^[0-9]+([.]0{1,2})?$' then return null;end if;
 if (value#>>'{}')::numeric<=0 or (value#>>'{}')::numeric>9007199254740991 then return null;end if;
 return (value#>>'{}')::numeric;
end $$;
create function private.finance_remittance_export_state_v1(r public.expense_requests) returns jsonb
language plpgsql security definer set search_path='' as $$
declare info jsonb; fp jsonb:=coalesce(r.form_payload,'{}'::jsonb); cash_step jsonb; cash_index integer; cash_count integer; principal numeric; cash_total numeric;
begin
 info:=jsonb_build_object('exportPurpose','unavailable','eligible',false,'canSupplement',false,'stage',r.status,'requestId',r.id,'submittedAt',r.created_at,'submissionSource','server_created_at','historyCutoff','2026-09-30T16:00:00Z');
 if r.created_at is null or r.created_at<'2026-09-30T16:00:00Z'::timestamptz then return info||jsonb_build_object('reason','before_history_cutoff');end if;
 -- created_at is server stamped by formal submit. Client request_date and
 -- submissionStartedAt never participate in eligibility. Require its formal
 -- submission marker and completed applicant step; imported/partial rows fail closed.
 if coalesce(fp->>'_submissionPayloadSha256V3','') !~ '^[0-9a-f]{64}$' or jsonb_typeof(r.steps) is distinct from 'array' or private.finance_income_step_role(r.steps->0) is distinct from 'applicant_submit' or r.steps->0->>'a' is distinct from 'approved' or private.finance_income_step_user_id(r.steps->0) is distinct from r.applicant_id then return info||jsonb_build_object('reason','submission_evidence_missing');end if;
 if r.voided_at is not null or coalesce(r.status,'') in ('','draft','cancelled','canceled','rejected','withdrawn','void','voided') or exists(select 1 from jsonb_array_elements(r.steps) s where s->>'a' in ('rejected','cancelled','canceled')) then return info||jsonb_build_object('reason','cancelled_or_rejected');end if;
 if coalesce(r.type,'') not in ('expense_reimbursement','payment_request','advance_request','petty_cash_request','travel_request','purchase_request','refund_request','welfare_request','hr_expense_request') or coalesce(nullif(fp->>'paymentType',''),fp->>'payment_type','') not in ('bank','transfer','匯款','銀行轉帳') or coalesce(fp->'electronicLabor','null'::jsonb) not in ('null'::jsonb,'false'::jsonb,'0'::jsonb,'""'::jsonb) or coalesce(fp->'hrInfo'->'digital','null'::jsonb) not in ('null'::jsonb,'false'::jsonb,'0'::jsonb,'""'::jsonb) or fp->>'hrItem'='labor_electronic' or fp->'hrInfo'->>'item'='labor_electronic' then return info||jsonb_build_object('reason','payment_not_applicable');end if;
 if coalesce(fp->'correctionCashEvents','null'::jsonb) not in ('null'::jsonb,'[]'::jsonb) or coalesce(fp->'accountingCorrection','null'::jsonb) not in ('null'::jsonb,'{}'::jsonb) or exists(select 1 from private.expense_accounting_corrections_v1 c where c.tenant_id=r.tenant_id and c.data_environment=r.data_environment and c.request_id=r.id and c.status in ('pending_review','pending_cash','applied')) then return info||jsonb_build_object('reason','accounting_correction_requires_review');end if;
 select count(*) into cash_count from jsonb_array_elements(r.steps) s where private.finance_income_step_role(s)='cashier';
 if cash_count<>1 then return info||jsonb_build_object('reason','cashier_evidence_missing');end if;
 select s,n::integer-1 into cash_step,cash_index from jsonb_array_elements(r.steps) with ordinality as x(s,n) where private.finance_income_step_role(s)='cashier';
 if r.cash_posted_at is null then
  if coalesce(cash_step->>'a','')<>'' or r.ledger_posted_at is not null or r.posting_locked_at is not null or nullif(btrim(r.voucher_id),'') is not null then return info||jsonb_build_object('reason','payment_evidence_incomplete');end if;
  return info||jsonb_build_object('exportPurpose','waiting','reason','awaiting_cashier');
 end if;
 if cash_step->>'a' is distinct from 'approved' or exists(select 1 from jsonb_array_elements(r.steps) with ordinality as x(s,n) where n<=cash_index and coalesce(s->>'a','') not in ('approved','AUTO')) then return info||jsonb_build_object('reason','cashier_evidence_incomplete');end if;
 if r.cash_posted_at<r.created_at or r.cash_posted_at>clock_timestamp() then return info||jsonb_build_object('reason','payment_timestamp_invalid');end if;
 principal:=private.finance_remittance_export_principal_v1(r);
 if principal is null or jsonb_typeof(fp->'cashAmount') not in ('number','string') or coalesce(fp->>'cashAmount','') !~ '^[0-9]+([.]0{1,2})?$' or r.bank_fee_amount is null or r.bank_fee_amount<0 or r.bank_fee_amount<>trunc(r.bank_fee_amount) then return info||jsonb_build_object('reason','historical_amount_incomplete');end if;
 cash_total:=(fp->>'cashAmount')::numeric;
 if cash_total-r.bank_fee_amount<>principal then return info||jsonb_build_object('reason','historical_amount_mismatch');end if;
 return info||jsonb_build_object('exportPurpose','historical','eligible',true,'reason','paid_reference_only','historicalPrincipal',principal,'historicalCashAmount',cash_total,'historicalBankFeeAmount',r.bank_fee_amount,'cashPostedAt',r.cash_posted_at);
end $$;
create function private.finance_remittance_export_snapshot_for_row_v1(r public.expense_requests) returns jsonb
language plpgsql security definer set search_path='' as $$
declare info jsonb; snap jsonb;
begin
 if r.status='pending_cashier' then
  snap:=private.finance_mega_remittance_snapshot_v1(r.id,r.data_environment);
  return snap||jsonb_build_object('exportPurpose','payment','submittedAt',r.created_at,'submissionSource','server_created_at','historyCutoff','2026-09-30T16:00:00Z');
 end if;
 info:=private.finance_remittance_export_state_v1(r);
 if info->>'exportPurpose'<>'historical' then return jsonb_build_object('ok',true,'sourceVersion',r.ver,'sourceDigest',private.finance_mega_hash_v1(to_jsonb(r)))||info;end if;
 snap:=private.finance_mega_snapshot_v1(r);
 -- Use the raw saved row and its exact existing supplement digest. Its real
 -- workflow status remains intact; historical is not disguised as pending_cashier.
 return snap||info||jsonb_build_object('canSupplement',(public.current_finance_user()).role in ('admin_director','accountant','hr'));
end $$;
create function private.finance_remittance_export_row_v1(r public.expense_requests,p_row_key text) returns jsonb
language plpgsql immutable security invoker set search_path='' as $$
declare result jsonb; principal numeric;
begin
 result:=private.finance_mega_row_v1(r,p_row_key);
 if p_row_key='payment:1' then
  principal:=private.finance_remittance_export_principal_v1(r);
  if principal is null then raise exception 'MEGA_HISTORICAL_AMOUNT_INCOMPLETE' using errcode='55000';end if;
  result:=result||jsonb_build_object('amount',principal,'fingerprint',private.finance_mega_hash_v1(jsonb_build_object('row',result->>'fingerprint','principal',principal)));
 end if;
 return result;
end $$;
create function private.finance_remittance_export_snapshot_v1(p_request_id text,p_data_environment text) returns jsonb
language plpgsql security definer set search_path='' as $$
begin return private.finance_remittance_export_snapshot_for_row_v1(private.finance_remittance_export_scope_v1(p_request_id,p_data_environment,false));end $$;
create function private.finance_remittance_export_supplement_save_v1(p_request_id text,p_data_environment text,p_expected_digest text,p_rows jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.expense_requests; actor public.finance_users; snap jsonb; v_source_hash text; item jsonb; original jsonb; old_value private.finance_mega_recipient_supplements_v1; v_row_key text; new_name text; new_code text; existing_name text; existing_code text; merged_value jsonb;
begin
 r:=private.finance_remittance_export_scope_v1(p_request_id,p_data_environment,true);actor:=public.current_finance_user();
 if r.status='pending_cashier' then
  perform private.finance_mega_remittance_supplement_save_v1(p_request_id,p_data_environment,p_expected_digest,p_rows);
  return private.finance_remittance_export_snapshot_for_row_v1(r);
 end if;
 if private.finance_remittance_export_state_v1(r)->>'exportPurpose' is distinct from 'historical' then raise exception 'MEGA_HISTORY_NOT_READY' using errcode='55000';end if;
 if coalesce(actor.role,'') not in ('admin_director','accountant','hr') then raise exception 'MEGA_SUPPLEMENT_FORBIDDEN' using errcode='42501';end if;
 snap:=private.finance_remittance_export_snapshot_for_row_v1(r);v_source_hash:=private.finance_mega_hash_v1(to_jsonb(r));
 if snap->>'sourceDigest' is distinct from p_expected_digest then raise exception 'MEGA_VERSION_CONFLICT' using errcode='40001';end if;
 if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 1000 or octet_length(p_rows::text)>262144 then raise exception 'MEGA_INVALID_SUPPLEMENT' using errcode='22023';end if;
 if exists(select 1 from jsonb_array_elements(p_rows) x group by x->>'rowKey' having count(*)>1) then raise exception 'MEGA_DUPLICATE_ROW' using errcode='22023';end if;
 for item in select * from jsonb_array_elements(p_rows) loop
  if jsonb_typeof(item) is distinct from 'object' or exists(select 1 from jsonb_object_keys(item) k where k<>all(array['rowKey','name','bankCode'])) then raise exception 'MEGA_INVALID_SUPPLEMENT' using errcode='22023';end if;
  v_row_key:=item->>'rowKey';original:=private.finance_remittance_export_row_v1(r,v_row_key);
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
 return private.finance_remittance_export_snapshot_for_row_v1(r);
end $$;
create function public.finance_remittance_export_snapshot_v1(p_request_id text,p_data_environment text default 'production') returns jsonb
language sql security invoker set search_path='' as $$select private.finance_remittance_export_snapshot_v1(p_request_id,p_data_environment)$$;
create function public.finance_remittance_export_supplement_save_v1(p_request_id text,p_data_environment text,p_expected_digest text,p_rows jsonb) returns jsonb
language sql security invoker set search_path='' as $$select private.finance_remittance_export_supplement_save_v1(p_request_id,p_data_environment,p_expected_digest,p_rows)$$;
revoke all on function private.finance_remittance_export_scope_v1(text,text,boolean),private.finance_remittance_export_principal_v1(public.expense_requests),private.finance_remittance_export_state_v1(public.expense_requests),private.finance_remittance_export_snapshot_for_row_v1(public.expense_requests),private.finance_remittance_export_row_v1(public.expense_requests,text),private.finance_remittance_export_snapshot_v1(text,text),private.finance_remittance_export_supplement_save_v1(text,text,text,jsonb),public.finance_remittance_export_snapshot_v1(text,text),public.finance_remittance_export_supplement_save_v1(text,text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.finance_remittance_export_snapshot_v1(text,text),private.finance_remittance_export_supplement_save_v1(text,text,text,jsonb),public.finance_remittance_export_snapshot_v1(text,text),public.finance_remittance_export_supplement_save_v1(text,text,text,jsonb) to authenticated;
notify pgrst,'reload schema';
