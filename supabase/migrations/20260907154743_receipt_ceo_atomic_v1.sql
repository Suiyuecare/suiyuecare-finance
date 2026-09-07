-- Receipt submission, CEO review, posting and batch status are one transaction.
-- A private transaction-bound capability closes old REST/legacy-RPC bypasses.
set local lock_timeout='5s';
set local statement_timeout='60s';
create table private.finance_receipt_operations_v1(
 tenant_id uuid not null,data_environment text not null check(data_environment in ('production','test')),
 actor_id text not null,operation_key text not null,digest text not null,
 invoice_ids text[] not null,writing_transaction text,response jsonb,
 created_at timestamptz not null default now(),
 primary key(tenant_id,data_environment,actor_id,operation_key)
);
alter table private.finance_receipt_operations_v1 enable row level security;
revoke all on private.finance_receipt_operations_v1 from public,anon,authenticated,service_role;

create function private.finance_receipt_write_allowed_v1(p_tenant uuid,p_environment text,p_id text)
returns boolean language sql stable security definer set search_path='' as $f$
 select exists(select 1 from private.finance_receipt_operations_v1 o
  where o.tenant_id=p_tenant and o.data_environment=p_environment and p_id=any(o.invoice_ids)
   and o.operation_key=current_setting('app.finance_receipt_operation',true)
   and o.actor_id=current_setting('app.finance_receipt_actor',true)
   and o.writing_transaction=pg_current_xact_id()::text);
$f$;
create function private.finance_receipt_guard_v1()
returns trigger language plpgsql security definer set search_path='' as $f$
begin
 if tg_op='DELETE' then
  if old.status in ('paid','pending_receipt_review') or old.cash_receipt_posted_at is not null then
   raise exception '已有收款證明或入帳的發票不可刪除，請循更正／沖銷程序' using errcode='42501';
  end if;
  return old;
 end if;
 if tg_op='INSERT' then
  if new.status in ('paid','pending_receipt_review') or new.paid_at is not null
   or coalesce(new.receipt_files,'[]'::jsonb)<>'[]'::jsonb or new.receipt_submitted_at is not null
   or nullif(new.receipt_submitted_by,'') is not null or nullif(new.receipt_note,'') is not null
   or new.receipt_reviewed_at is not null or nullif(new.receipt_reviewed_by,'') is not null
   or nullif(new.receipt_review_note,'') is not null or new.cash_receipt_posted_at is not null then
   raise exception '新發票必須由正常申請及收款覆核流程建立，不可預先標記收款' using errcode='42501';
  end if;
  return new;
 end if;
 if new.status is distinct from old.status and (new.status in ('paid','pending_receipt_review') or old.status in ('pending_receipt_review','paid'))
  or (old.status='paid' and (new.steps is distinct from old.steps or new.approval_status is distinct from old.approval_status or new.approval_step is distinct from old.approval_step))
  or (old.status in ('pending_receipt_review','paid') and (new.amount is distinct from old.amount
   or new.total is distinct from old.total or new.tax is distinct from old.tax or new.entity_id is distinct from old.entity_id
   or new.department_code is distinct from old.department_code or new.no is distinct from old.no or new.batch_id is distinct from old.batch_id))
  or new.paid_at is distinct from old.paid_at
  or new.receipt_files is distinct from old.receipt_files
  or new.receipt_submitted_at is distinct from old.receipt_submitted_at
  or new.receipt_submitted_by is distinct from old.receipt_submitted_by
  or new.receipt_note is distinct from old.receipt_note
  or new.receipt_reviewed_at is distinct from old.receipt_reviewed_at
  or new.receipt_reviewed_by is distinct from old.receipt_reviewed_by
  or new.receipt_review_note is distinct from old.receipt_review_note
  or new.cash_receipt_posted_at is distinct from old.cash_receipt_posted_at then
   if not private.finance_receipt_write_allowed_v1(new.tenant_id,new.data_environment,new.id) then
    raise exception '收款資料必須使用會計送證明／執行長覆核交易，請更新頁面後再處理' using errcode='42501',detail='RECEIPT_ATOMIC_ACTION_REQUIRED';
   end if;
 end if;
 return new;
end;
$f$;
create trigger trg_finance_receipt_guard_v1 before insert or update or delete on public.invoices for each row execute function private.finance_receipt_guard_v1();
create function private.finance_receipt_ledger_guard_v1()
returns trigger language plpgsql security definer set search_path='' as $f$
begin
 if (coalesce(new.posting_key,'') like 'invoice:%:receipt:%' or coalesce(new.posting_key,'') like 'tenant:%:invoice:%:receipt:%')
  and not private.finance_receipt_write_allowed_v1(new.tenant_id,new.data_environment,new.source_id) then
  raise exception '收款分錄只能由執行長收款覆核交易建立' using errcode='42501',detail='RECEIPT_ATOMIC_ACTION_REQUIRED';
 end if;
 return new;
end;
$f$;
create trigger trg_finance_receipt_ledger_guard_v1 before insert on public.ledger_entries for each row execute function private.finance_receipt_ledger_guard_v1();

create function private.finance_receipt_files_valid_v1(p_invoice public.invoices,p_files jsonb,p_actor text default null)
returns boolean language plpgsql stable security definer set search_path='' as $f$
declare f jsonb;p text;b text;
begin
 if jsonb_typeof(p_files) is distinct from 'array' or jsonb_array_length(p_files) not between 1 and 20 then return false;end if;
 if (select count(distinct coalesce(value->>'path',value->>'storagePath',value->>'storage_path','')) from jsonb_array_elements(p_files))<>jsonb_array_length(p_files) then return false;end if;
 for f in select value from jsonb_array_elements(p_files) loop
  p:=coalesce(f->>'path',f->>'storagePath',f->>'storage_path','');b:=coalesce(f->>'bucket',f->>'storage_bucket','');
  if jsonb_typeof(f) is distinct from 'object' or b<>'finance-attachments' or p='' or not exists(
   select 1 from public.file_attachments a join storage.objects o on o.bucket_id=a.bucket_id and o.name=a.storage_path
   where a.tenant_id=p_invoice.tenant_id and a.data_environment=p_invoice.data_environment
    and a.bucket_id=b and a.storage_path=p and a.record_type='invoices' and a.file_kind='receipt_proof'
    and exists(select 1 from public.finance_users u where u.tenant_id=a.tenant_id and u.id=a.uploaded_by and u.auth_user_id::text=o.owner_id)
    and (a.record_no=p_invoice.no or (nullif(p_invoice.batch_id,'') is not null and a.record_no in (p_invoice.batch_id,replace(p_invoice.batch_id,'batch_','整批 '))))
    and (p_actor is null or a.uploaded_by=p_actor)
    and (p_actor is not null or (a.attachment_state='claimed' and a.claimed_at is not null))
  ) then return false;end if;
 end loop;
 return true;
end;
$f$;
create function private.finance_receipt_route_ready_v1(p_steps jsonb)
returns boolean language sql immutable set search_path='' as $f$
 select jsonb_typeof(p_steps)='array' and exists(select 1 from jsonb_array_elements(p_steps) s where s->>'rk'='accountant_invoice' and s->>'a'='approved')
 and not exists(select 1 from jsonb_array_elements(p_steps) s where coalesce(s->>'a','')<>'approved' and not(coalesce(s->>'rk','')='applicant_invoice_delivery' and coalesce(s->>'a','')=''));
$f$;

-- Receipt of an already recognized receivable belongs to today's cash period.
-- Validate the existing ledger without reopening or reposting its invoice period.
-- Three historical key families are supported, each as one complete set; keys
-- never substitute for tenant/environment/source/entity/amount verification.
create function private.finance_receipt_revenue_ready_v1(p_invoice_id text)
returns jsonb language plpgsql security definer set search_path='' as $f$
declare i public.invoices%rowtype;v_total numeric;v_tax numeric;v_net numeric;v_version integer;
 v_prefix text;v_keys text[];v_family_ok boolean;v_matches integer:=0;
begin
 select * into i from public.invoices where id=p_invoice_id and tenant_id=public.current_tenant_id() for update;
 if not found or not public.can_read_invoice(i) then raise exception '找不到本租戶可核對的發票收入紀錄' using errcode='42501';end if;
 if not (coalesce(i.revenue_posted,false) or i.revenue_posted_at is not null or coalesce(i.revenue_posting_state,'')='posted') then
  -- This remains the full production writer, including approval, original
  -- invoice-period, active recognition rule, account and partial-ledger guards.
  return private.post_invoice_revenue_v2_internal(i.id,true);
 end if;
 if i.voided_at is not null or coalesce(i.revenue_posted,false) is not true or i.revenue_posted_at is null
  or coalesce(i.revenue_posting_state,'')<>'posted' then
  raise exception '收入認列旗標不一致，請先核對原收入傳票；收款尚未入帳' using errcode='23514';
 end if;
 v_total:=coalesce(i.total,i.amount,0);v_tax:=coalesce(i.tax,0);v_net:=v_total-v_tax;
 if v_total<=0 or v_tax<0 or v_net<=0 or nullif(i.revenue_account_code,'') is null then
  raise exception '原發票收入／稅額／科目不完整，收款尚未入帳' using errcode='23514';
 end if;
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
   and count(*) filter(where l.posting_key=v_keys[1] and l.account_code='1123' and abs(coalesce(l.debit,0)-v_total)<=0.01 and coalesce(l.credit,0)=0)=1
   and count(*) filter(where l.posting_key=v_keys[2] and l.account_code=i.revenue_account_code and abs(coalesce(l.credit,0)-v_net)<=0.01 and coalesce(l.debit,0)=0)=1
   and ((v_tax=0 and count(*) filter(where l.posting_key=v_keys[3])=0)
     or (v_tax>0 and count(*) filter(where l.posting_key=v_keys[3] and l.account_code='2134' and abs(coalesce(l.credit,0)-v_tax)<=0.01 and coalesce(l.debit,0)=0)=1))
   and abs(coalesce(sum(l.debit),0)-coalesce(sum(l.credit),0))<=0.01 into v_family_ok
  from public.ledger_entries l where l.tenant_id=i.tenant_id and l.data_environment=i.data_environment
   and l.voided_at is null and l.posting_key=any(v_keys);
  if v_family_ok then
   if exists(select 1 from public.ledger_entries l where l.tenant_id=i.tenant_id and l.data_environment=i.data_environment
    and l.source_type='invoice' and l.source_id=i.id and l.voided_at is null
    and position(':revenue:' in coalesce(l.posting_key,''))>0 and not(l.posting_key=any(v_keys))) then
    raise exception '原收入存在重複或混用版本分錄，收款尚未入帳' using errcode='23514';
   end if;
   v_matches:=v_matches+1;
  end if;
 end loop;
 if v_matches<>1 then
  raise exception '收入認列旗標與應收／收入／銷項稅完整分錄不一致，收款尚未入帳' using errcode='23514';
 end if;
 return jsonb_build_object('ok',true,'idempotent',true,'deferred',false,'invoice_id',i.id,'existing_revenue_verified',true);
end;
$f$;

create function public.finance_invoice_receipt_action_v1(
 p_invoice_ids text[],p_action text,p_idempotency_key text,p_expected_versions jsonb,
 p_note text default '',p_files jsonb default '[]',p_data_environment text default 'production')
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='5s' as $f$
declare a public.finance_users%rowtype;i public.invoices%rowtype;v_id text;v_digest text;v_cached jsonb;v_saved_digest text;
 v_result jsonb;v_rows jsonb:='[]';v_steps jsonb;v_files jsonb;v_now timestamptz:=clock_timestamp();v_date date;
 v_prev_key text:=coalesce(current_setting('app.finance_receipt_operation',true),'');v_prev_actor text:=coalesce(current_setting('app.finance_receipt_actor',true),'');
begin
 a:=private.finance_correction_actor_v1();
 if p_action is null or p_action not in ('submit','approve','return') or p_data_environment is null or p_data_environment not in ('production','test')
  or p_invoice_ids is null or cardinality(p_invoice_ids) not between 1 and 150
  or cardinality(p_invoice_ids)<>(select count(distinct x) from unnest(p_invoice_ids) x)
  or coalesce(p_idempotency_key,'') !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$'
  or length(coalesce(p_note,''))>2000 or (p_action='return' and length(btrim(coalesce(p_note,'')))<3)
  or jsonb_typeof(p_expected_versions) is distinct from 'object' then
  raise exception '收款操作、原因、版本或識別碼格式不正確' using errcode='22023';
 end if;
 if (select count(*) from jsonb_object_keys(p_expected_versions))<>cardinality(p_invoice_ids)
  or exists(select 1 from unnest(p_invoice_ids) id where coalesce(p_expected_versions->>id,'') !~ '^[1-9][0-9]{0,18}$') then
  raise exception '收款資料版本不完整，請重新開啟核對' using errcode='40001';
 end if;
 if not private.finance_correction_role_v1(a.tenant_id,a.id,null,array[case when p_action='submit' then 'accountant' else 'ceo' end]) then
  raise exception '收款證明只能由正式會計提交，收款確認與退回只能由有效執行長執行' using errcode='42501';
 end if;
 v_digest:=encode(sha256(jsonb_build_object('ids',p_invoice_ids,'action',p_action,'versions',p_expected_versions,'note',coalesce(p_note,''),'files',p_files)::text::bytea),'hex');
 insert into private.finance_receipt_operations_v1(tenant_id,data_environment,actor_id,operation_key,digest,invoice_ids)
  values(a.tenant_id,p_data_environment,a.id,p_idempotency_key,v_digest,p_invoice_ids) on conflict do nothing;
 select digest,response into v_saved_digest,v_cached from private.finance_receipt_operations_v1
  where tenant_id=a.tenant_id and data_environment=p_data_environment and actor_id=a.id and operation_key=p_idempotency_key for update;
 if v_saved_digest is distinct from v_digest then raise exception '相同操作識別碼不可使用不同收款內容' using errcode='23505';end if;
 if v_cached is not null then return v_cached||jsonb_build_object('idempotent_replay',true);end if;
 update private.finance_receipt_operations_v1 set writing_transaction=pg_current_xact_id()::text
  where tenant_id=a.tenant_id and data_environment=p_data_environment and actor_id=a.id and operation_key=p_idempotency_key;
 perform set_config('app.finance_receipt_operation',p_idempotency_key,true);perform set_config('app.finance_receipt_actor',a.id,true);
 -- All locks and checks precede any mutation. A later failing row aborts the
 -- entire RPC, including posted ledger rows and the operation receipt.
 for v_id in select id from unnest(p_invoice_ids) id order by id loop
  select * into i from public.invoices where tenant_id=a.tenant_id and data_environment=p_data_environment and id=v_id for update;
  if not found or not public.can_read_invoice(i) then raise exception '無權讀取此租戶／環境的發票' using errcode='42501';end if;
  if i.row_version is distinct from (p_expected_versions->>v_id)::bigint then raise exception '收款內容已更新，請重新開啟核對' using errcode='40001';end if;
  if i.voided_at is not null or i.approval_status in ('rejected','cancelled','voided') or i.status in ('paid','void','voided','cancelled','rejected')
   or i.cash_receipt_posted_at is not null or not private.finance_receipt_route_ready_v1(i.steps)
   or i.status is distinct from (case when p_action='submit' then 'unpaid' else 'pending_receipt_review' end) then
   raise exception '發票尚未完成必要簽核、已結案或不在此收款關卡，整批未更新' using errcode='55000';
  end if;
  v_files:=case when jsonb_typeof(p_files)='object' then p_files->i.id else p_files end;
  if p_action='submit' and not private.finance_receipt_files_valid_v1(i,v_files,a.id) then
   raise exception '收款證明須為本人上傳、屬於此單或批次且原檔存在的正式附件' using errcode='42501';
  end if;
  if p_action='approve' and (i.receipt_submitted_at is null or not private.finance_receipt_files_valid_v1(i,i.receipt_files)) then
   raise exception '未有完整正式收款證明，不能確認入帳' using errcode='23514';
  end if;
  if p_action='approve' then
   if coalesce(i.total,i.amount,0)<=0 then raise exception '收款金額必須大於零' using errcode='23514';end if;
   v_date:=(v_now at time zone 'Asia/Taipei')::date;
   perform private.finance_assert_period_open(a.tenant_id,p_data_environment,i.entity_id,v_date,'發票收款入帳');
   if exists(select 1 from public.ledger_entries l where l.tenant_id=a.tenant_id and l.data_environment=p_data_environment
    and (l.posting_key in ('invoice:'||i.no||':receipt:bank','invoice:'||i.no||':receipt:ar')
     or (l.source_type='invoice' and l.source_id=i.id and l.posting_key like '%:receipt:%'))) then
    raise exception '此單已有收款分錄，請先核對既有收款／沖銷紀錄，整批未更新' using errcode='55000';
   end if;
  end if;
 end loop;
 for v_id in select id from unnest(p_invoice_ids) id order by id loop
  select * into i from public.invoices where tenant_id=a.tenant_id and data_environment=p_data_environment and id=v_id;
  if p_action='submit' then
   v_files:=case when jsonb_typeof(p_files)='object' then p_files->i.id else p_files end;
   -- Previously returned proof remains in the audit snapshot, while the exact
   -- newly reviewed proof set replaces it. The caller never sends old URLs.
   update public.invoices set status='pending_receipt_review',receipt_files=v_files,receipt_submitted_at=v_now,receipt_submitted_by=a.name,receipt_note=coalesce(p_note,''),updated_at=v_now where id=i.id;
  elsif p_action='return' then
   update public.invoices set status='unpaid',receipt_reviewed_at=v_now,receipt_reviewed_by=a.name,receipt_review_note=p_note,updated_at=v_now where id=i.id;
  else
   v_steps:=i.steps;
   select jsonb_agg(case when s->>'rk'='applicant_invoice_delivery' and coalesce(s->>'a','')='' then
    private.finance_income_append_step_action(s,a.id,a.name,'執行長確認收款後完成交付','已檢查正式收款證明','[]')
    ||jsonb_build_object('a','approved','autoSkip',true,'autoSkipReason','receipt_confirmed_by_ceo') else s end order by ord) into v_steps
    from jsonb_array_elements(i.steps) with ordinality t(s,ord);
   -- The existing final-approval trigger may defer a failed revenue posting.
   -- Explicit validation below makes that failure abort this entire receipt.
   update public.invoices set status='paid',paid_at=v_now,receipt_reviewed_at=v_now,receipt_reviewed_by=a.name,receipt_review_note=coalesce(p_note,''),
    cash_receipt_posted_at=v_now,steps=v_steps,approval_status='completed',approval_step=jsonb_array_length(v_steps),updated_at=v_now where id=i.id;
   v_result:=private.finance_receipt_revenue_ready_v1(i.id);
   if v_result->>'ok' is distinct from 'true' or coalesce((v_result->>'deferred')::boolean,false) then
    raise exception '收入認列尚未完成，收款整批未入帳' using errcode='23514';
   end if;
   insert into public.ledger_entries(entry_date,description,entity_id,department_code,debit,credit,account_code,account_name,reference_no,posting_key,source_type,source_id,source_no,tenant_id,data_environment)
    values(v_date,'發票收款入帳 — '||coalesce(i.buyer,''),i.entity_id,i.department_code,coalesce(i.total,i.amount),0,'1112','銀行存款',i.no,'tenant:'||a.tenant_id::text||':env:'||p_data_environment||':invoice:'||i.id||':receipt:bank','invoice',i.id,i.no,a.tenant_id,p_data_environment),
     (v_date,'沖轉應收帳款 — '||coalesce(i.buyer,''),i.entity_id,i.department_code,0,coalesce(i.total,i.amount),'1123','應收帳款',i.no,'tenant:'||a.tenant_id::text||':env:'||p_data_environment||':invoice:'||i.id||':receipt:ar','invoice',i.id,i.no,a.tenant_id,p_data_environment);
  end if;
  insert into public.module_audit_logs(table_name,row_id,action,actor_email,before_data,after_data)
   values('invoice_receipt',i.id,upper(p_action),a.email,jsonb_build_object('status',i.status,'row_version',i.row_version,'receipt_files',i.receipt_files),jsonb_build_object('actorId',a.id,'note',p_note,'at',v_now,'operationKey',p_idempotency_key));
  v_rows:=v_rows||jsonb_build_array(jsonb_build_object('id',i.id,'action',p_action));
 end loop;
 v_result:=jsonb_build_object('ok',true,'count',cardinality(p_invoice_ids),'rows',v_rows,'idempotent_replay',false);
 update private.finance_receipt_operations_v1 set response=v_result,writing_transaction=null
  where tenant_id=a.tenant_id and data_environment=p_data_environment and actor_id=a.id and operation_key=p_idempotency_key;
 perform set_config('app.finance_receipt_operation',v_prev_key,true);perform set_config('app.finance_receipt_actor',v_prev_actor,true);
 return v_result;
end;
$f$;
-- Retain the API name to give old clients an explicit upgrade error, never
-- infer a fresh expected version from a row the operator has not reviewed.
create or replace function public.post_invoice_cash_receipt(p_invoice_id text,p_paid_at timestamptz default now(),p_reviewed_by text default null,p_review_note text default null)
returns jsonb language plpgsql set search_path='' as $f$
begin raise exception '收款覆核已更新，請重新載入頁面並使用執行長確認收款功能；本次未入帳' using errcode='55000',detail='RECEIPT_ATOMIC_ACTION_REQUIRED';end;
$f$;
revoke all on function private.finance_receipt_write_allowed_v1(uuid,text,text),private.finance_receipt_guard_v1(),private.finance_receipt_ledger_guard_v1(),private.finance_receipt_files_valid_v1(public.invoices,jsonb,text),private.finance_receipt_route_ready_v1(jsonb),private.finance_receipt_revenue_ready_v1(text) from public,anon,authenticated,service_role;
revoke all on function public.finance_invoice_receipt_action_v1(text[],text,text,jsonb,text,jsonb,text),public.post_invoice_cash_receipt(text,timestamptz,text,text) from public,anon,service_role;
grant execute on function public.finance_invoice_receipt_action_v1(text[],text,text,jsonb,text,jsonb,text),public.post_invoice_cash_receipt(text,timestamptz,text,text) to authenticated;

alter table public.notifications add column record_type text;
alter table public.notifications add constraint notifications_record_type_v1 check(record_type is null or record_type in ('expense_requests','invoices','bills'));
-- Preserve ambiguous legacy IDs for runtime resolution, never guess a target.
update public.notifications n set record_type=x.record_type from (
 select tenant_id,data_environment,id,min(record_type) record_type from (
 select tenant_id,data_environment,id,'expense_requests'::text record_type from public.expense_requests
 union all select tenant_id,data_environment,id,'invoices' from public.invoices
 union all select tenant_id,data_environment,id,'bills' from public.bills) r
 group by tenant_id,data_environment,id having count(*)=1
) x where n.tenant_id=x.tenant_id and n.data_environment=x.data_environment and n.request_id=x.id and n.record_type is null;
notify pgrst,'reload schema';
