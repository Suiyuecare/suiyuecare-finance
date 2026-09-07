-- A proposal is NOT a change to approved principal or a cash confirmation.
-- Ordinary expenses only; purchase/advance/petty-cash retain their own existing
-- settlement contracts. No finalize or ledger authorization is relaxed here.
-- The release phase runner owns BEGIN/COMMIT for the entire phase; do not
-- terminate its transaction inside an individual forward migration.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $preflight$
begin
  if to_regprocedure('private.finance_accounting_human_event_is_fresh_v2(jsonb,jsonb)') is null
    or to_regprocedure('public.finance_org_role_members(text,text)') is null
    or to_regprocedure('public.can_read_expense_request(public.expense_requests)') is null then
    raise exception 'F05 requires the reviewed human audit and organization/permission contracts';
  end if;
end;
$preflight$;

create table private.expense_accounting_corrections_v1 (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  data_environment text not null check(data_environment in ('production','test')),
  request_id text not null references public.expense_requests(id) on delete restrict,
  request_no text not null,
  proposer_id text not null,
  reviewer_id text,
  cashier_id text,
  status text not null check(status in ('pending_review','pending_cash','applied','rejected','cancelled')),
  version integer not null default 1,
  original_amount numeric not null check(original_amount >= 0),
  proposed_amount numeric not null check(proposed_amount > 0),
  original_cash_amount numeric,
  cash_posted_at timestamptz,
  base_steps jsonb not null,
  base_payload jsonb not null,
  proposed_patch jsonb not null,
  reason text not null,
  approved_by text,
  approved_at timestamptz,
  settled_by text,
  settled_at timestamptz,
  bank_transaction_id text references public.bank_transactions(id) on delete restrict,
  cash_event jsonb,
  history jsonb not null default '[]',
  writing_transaction text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(reviewer_id is null or reviewer_id <> proposer_id),
  check(proposed_amount <> original_amount)
);
create unique index expense_correction_one_open_v1 on private.expense_accounting_corrections_v1(tenant_id,data_environment,request_id)
  where status in ('pending_review','pending_cash');
create unique index expense_correction_bank_once_v1 on private.expense_accounting_corrections_v1(tenant_id,data_environment,bank_transaction_id)
  where bank_transaction_id is not null;
create index expense_correction_actor_queue_v1 on private.expense_accounting_corrections_v1(tenant_id,data_environment,status,reviewer_id,cashier_id);
create table private.expense_correction_operations_v1 (
  tenant_id uuid not null,data_environment text not null,actor_id text not null,
  operation_key text not null,digest text not null,response jsonb not null,
  created_at timestamptz not null default now(),
  primary key(tenant_id,data_environment,actor_id,operation_key)
);
alter table private.expense_accounting_corrections_v1 enable row level security;
alter table private.expense_correction_operations_v1 enable row level security;
revoke all on private.expense_accounting_corrections_v1,private.expense_correction_operations_v1 from public,anon,authenticated,service_role;

create function private.finance_correction_role_v1(p_tenant uuid,p_user text,p_department text,p_roles text[])
returns boolean language sql stable set search_path='' as $function$
  -- The existing Finance actor resolver deliberately uses role_members(role,
  -- NULL) for these company-wide control roles. An EDR employment department
  -- is not an approval scope. Keep the EDR intersection to reject the legacy
  -- finance_users.role fallback; request/entity scope is still checked by the
  -- existing permission evaluator at each operation below.
  select p_tenant=public.current_tenant_id() and exists(select 1 from public.finance_users u join public.employee_department_roles r
    on r.tenant_id=u.tenant_id and r.finance_user_id=u.id
    where u.tenant_id=p_tenant and u.id=p_user and u.active is true and u.auth_user_id is not null
    and r.role_key=any(p_roles) and r.active is true and r.can_approve is true
    and r.effective_from<=(statement_timestamp() at time zone 'Asia/Taipei')::date and (r.effective_to is null or r.effective_to>=(statement_timestamp() at time zone 'Asia/Taipei')::date)
    and exists(select 1 from public.finance_org_role_members(case when r.role_key='accountant_final' then 'accountant' else r.role_key end,null) m
      where m.finance_user_id=u.id and m.can_approve is true));
$function$;

create function private.finance_correction_permission_v1(p_request public.expense_requests,p_user text,p_permission text)
returns boolean language sql stable set search_path='' as $function$
  select private.finance_expense_optional_permission_allows(p_request.tenant_id,p_user,p_permission,
    jsonb_build_object('assignee_finance_user_id',p_user,'owner_finance_user_id',p_request.applicant_id,
      'department_code',p_request.department_code,'company_id',p_request.entity_id,'entity_id',p_request.entity_id,
      'resource_type','expense_request','resource_id',p_request.id,'workflow_step_key','accountant_final'));
$function$;

create function private.finance_correction_actor_v1()
returns public.finance_users language plpgsql stable security definer set search_path='' as $function$
declare v_actor public.finance_users%rowtype;v_count integer;
begin
  if auth.uid() is null or public.current_tenant_id() is null then
    raise exception '請先使用正式帳號登入' using errcode='42501';
  end if;
  select count(*) into v_count from public.finance_users u where u.tenant_id=public.current_tenant_id()
    and u.auth_user_id=auth.uid() and u.active is true;
  if v_count<>1 then raise exception '正式人員身分必須唯一且有效' using errcode='42501'; end if;
  select u.* into v_actor from public.finance_users u where u.tenant_id=public.current_tenant_id()
    and u.auth_user_id=auth.uid() and u.active is true;
  return v_actor;
end;
$function$;

-- Blocks both old browsers and existing RPCs while an independent correction
-- is pending. A transaction-bound private row permits only this module's exact
-- controlled writes; no client can insert that row or retain the marker.
create function private.finance_expense_correction_guard_v1()
returns trigger language plpgsql security definer set search_path='' as $function$
declare v_allowed boolean;
begin
  select exists(select 1 from private.expense_accounting_corrections_v1 c
    where c.tenant_id=old.tenant_id and c.data_environment=old.data_environment and c.request_id=old.id
      and c.id::text=coalesce(current_setting('app.finance_correction_write_id',true),'')
      and c.writing_transaction=pg_current_xact_id()::text) into v_allowed;
  if v_allowed then return new; end if;
  if (new.form_payload->'accountingCorrection') is distinct from (old.form_payload->'accountingCorrection')
    or (new.form_payload->'correctionCashEvents') is distinct from (old.form_payload->'correctionCashEvents')
    or ((old.form_payload ? 'correctionCashEvents') and (new.form_payload->'cashAmount') is distinct from (old.form_payload->'cashAmount')) then
    raise exception '金額更正與差額現金紀錄只能透過更正流程修改' using errcode='42501';
  end if;
  if exists(select 1 from private.expense_accounting_corrections_v1 c where c.tenant_id=old.tenant_id
    and c.data_environment=old.data_environment and c.request_id=old.id and c.status in ('pending_review','pending_cash'))
    and (to_jsonb(new)-'updated_at') is distinct from (to_jsonb(old)-'updated_at') then
    raise exception '此單有尚未完成的金額更正／差額處理，不能簽核或入帳' using errcode='55000',detail='ACCOUNTING_CORRECTION_PENDING';
  end if;
  return new;
end;
$function$;
create trigger trg_finance_expense_correction_guard_v1 before update on public.expense_requests
  for each row execute function private.finance_expense_correction_guard_v1();

create function private.finance_correction_patch_v1(p_request public.expense_requests,p_patch jsonb,p_actor text)
returns jsonb language plpgsql stable set search_path='' as $function$
declare v_lines jsonb;v_merged jsonb;v_line jsonb;v_total numeric;v_account jsonb;v_field text;
begin
  if jsonb_typeof(p_patch) is distinct from 'object' or not (p_patch ?& array['amount','debit_account','debit_account_name','credit_account','credit_account_name','accounting_lines','accounting_line_policy'])
    or p_patch - array['amount','debit_account','debit_account_name','credit_account','credit_account_name','accounting_lines','accounting_line_policy'] <> '{}'::jsonb
    or coalesce(p_patch->>'amount','') !~ '^[0-9]+([.][0-9]{1,2})?$' then
    raise exception '更正提案欄位不完整或金額格式錯誤' using errcode='22023';
  end if;
  v_lines:=p_patch->'accounting_lines';
  if jsonb_typeof(v_lines) is distinct from 'array' or jsonb_array_length(v_lines) not between 1 and 200 then
    raise exception '更正明細需有 1 至 200 列' using errcode='22023';
  end if;
  for v_line in select value from jsonb_array_elements(v_lines) loop
    if jsonb_typeof(v_line) is distinct from 'object' or coalesce(v_line->>'id','')=''
      or coalesce(v_line->>'systemFee','false')<>'false' or coalesce(v_line->>'locked','false')<>'false' then
      raise exception '更正不得包含銀行手續費、鎖定列或無識別碼列' using errcode='22023';
    end if;
    foreach v_field in array array['netAmount','taxAmount','grossAmount'] loop
      if coalesce(v_line->>v_field,'') !~ '^[0-9]+([.][0-9]{1,2})?$' then raise exception '更正明細金額格式錯誤' using errcode='22023'; end if;
    end loop;
    if (v_line->>'netAmount')::numeric+(v_line->>'taxAmount')::numeric<>(v_line->>'grossAmount')::numeric then
      raise exception '未稅加稅額必須等於含稅金額' using errcode='23514';
    end if;
    foreach v_field in array array['debitAccount','creditAccount'] loop
      if not exists(select 1 from public.system_settings s cross join lateral jsonb_array_elements(case when jsonb_typeof(s.value)='array' then s.value else '[]'::jsonb end) a
        where s.tenant_id=p_request.tenant_id and s.key='accounts' and a->>'c'=v_line->>v_field
        and a->>'n'=v_line->>(v_field||'Name') and coalesce((a->>'on')::boolean,true)) then
        raise exception '更正包含不存在、停用或名稱不一致的科目' using errcode='23503';
      end if;
    end loop;
    -- Bind the last new human event to the real proposer, never an arbitrary
    -- browser-supplied identity. Unchanged carried-forward lines are allowed.
    if not exists(select 1 from jsonb_array_elements(coalesce(p_request.form_payload->'accountingLines','[]')) old_line
      where old_line->>'id'=v_line->>'id' and old_line->'manualOverrideHistory'=v_line->'manualOverrideHistory')
      and (v_line#>>'{manualOverrideBy,id}') is distinct from p_actor then
      raise exception '人工更正紀錄與目前提案人不一致' using errcode='42501';
    end if;
  end loop;
  if (select count(*) from jsonb_array_elements(v_lines))<>(select count(distinct value->>'id') from jsonb_array_elements(v_lines)) then
    raise exception '更正明細識別碼重複' using errcode='23505';
  end if;
  v_merged:=private.finance_merge_human_accounting_lines(coalesce(p_request.form_payload->'accountingLines','[]'),v_lines);
  select sum((value->>'grossAmount')::numeric) into v_total from jsonb_array_elements(v_merged);
  if v_total<>(p_patch->>'amount')::numeric or jsonb_array_length(v_merged)<>jsonb_array_length(v_lines) then
    raise exception '更正明細與人工覆核版本或總額不一致' using errcode='40001',detail='HUMAN_ACCOUNTING_REVISION_CONFLICT';
  end if;
  if p_patch->>'debit_account' is distinct from v_merged->0->>'debitAccount'
    or p_patch->>'debit_account_name' is distinct from v_merged->0->>'debitAccountName'
    or p_patch->>'credit_account' is distinct from v_merged->0->>'creditAccount'
    or p_patch->>'credit_account_name' is distinct from v_merged->0->>'creditAccountName' then
    raise exception '表頭科目必須與第一列更正明細一致' using errcode='23514';
  end if;
  return jsonb_set(p_patch,'{accounting_lines}',v_merged);
end;
$function$;

create function public.finance_expense_correction_action_v1(
  p_request_id text,p_action text,p_operation_key text,p_expected_version integer,
  p_reason text default '',p_patch jsonb default '{}'::jsonb,p_reviewer_id text default null,
  p_correction_id uuid default null,p_bank_transaction_id text default null,p_data_environment text default 'production')
returns jsonb language plpgsql security definer set search_path='' as $function$
declare
  a public.finance_users%rowtype;r public.expense_requests%rowtype;c private.expense_accounting_corrections_v1%rowtype;
  b public.bank_transactions%rowtype;v_cached jsonb;v_digest text;v_saved_digest text;v_result jsonb;
  v_patch jsonb;v_index integer;v_cashier text;v_cashier_count integer;v_apply boolean:=false;
  v_context text;v_marker text;v_payload jsonb;v_delta numeric;v_event jsonb;v_now timestamptz:=clock_timestamp();
begin
  a:=private.finance_correction_actor_v1();
  if p_data_environment not in ('production','test') or p_action not in ('propose','assign','approve','reject','settle','cancel')
    or coalesce(p_operation_key,'') !~ '^[A-Za-z0-9_-]{8,100}$' or length(btrim(coalesce(p_reason,''))) not between 3 and 2000 then
    raise exception '更正動作、原因或操作識別碼格式錯誤' using errcode='22023';
  end if;
  select * into r from public.expense_requests where tenant_id=a.tenant_id and data_environment=p_data_environment and id=p_request_id for update;
  if not found then raise exception '找不到此租戶／環境的申請單' using errcode='P0002'; end if;
  v_digest:=encode(sha256(jsonb_build_object('request',p_request_id,'action',p_action,'version',p_expected_version,'reason',p_reason,'patch',p_patch,'reviewer',p_reviewer_id,'correction',p_correction_id,'bank',p_bank_transaction_id)::text::bytea),'hex');
  select digest,response into v_saved_digest,v_cached from private.expense_correction_operations_v1
    where tenant_id=a.tenant_id and data_environment=p_data_environment and actor_id=a.id and operation_key=p_operation_key;
  if found then
    if v_saved_digest<>v_digest then raise exception '相同操作識別碼不可套用不同內容' using errcode='22023'; end if;
    return v_cached||jsonb_build_object('idempotent_replay',true);
  end if;
  if r.status<>'pending_voucher' or r.ledger_posted_at is not null or r.posting_locked_at is not null
    or r.voucher_id is not null or r.voided_at is not null then
    raise exception '只有尚未入帳的最終會計關可提出或處理更正' using errcode='55000';
  end if;
  if r.type not in ('expense_reimbursement','payment_request','travel_request','refund_request','welfare_request','hr_expense_request') then
    raise exception '此類單據需使用既有核銷／差額／沖銷流程，不適用一般支出更正' using errcode='55000';
  end if;
  v_index:=private.finance_income_active_step_index(r.steps);
  if v_index is null or v_index<>jsonb_array_length(r.steps)-1
    or private.finance_income_step_role(r.steps->v_index) not in ('accountant_final','accounting') then
    raise exception '更正必須保留唯一最後會計關' using errcode='55000';
  end if;
  if p_action='propose' then
    if r.ver is distinct from p_expected_version then raise exception '單據版本已更新，請保留草稿後重新載入' using errcode='40001'; end if;
    if not private.finance_expense_actor_can_act(a.tenant_id,r,v_index,r.steps->v_index,a.id,a.email,a.role)
      or not private.finance_correction_role_v1(a.tenant_id,a.id,r.department_code,array['accountant','accountant_final','admin_director','ceo'])
      or not private.finance_correction_permission_v1(r,a.id,'finance.accounting.subject.edit') then
      raise exception '目前人員無權提出此單的會計更正' using errcode='42501';
    end if;
    if p_reviewer_id is not null and (p_reviewer_id=a.id or not private.finance_correction_role_v1(a.tenant_id,p_reviewer_id,r.department_code,array['ceo','admin_director'])
      or not private.finance_correction_permission_v1(r,p_reviewer_id,'finance.approval.approve')) then
      raise exception '覆核人須為有效執行長／行政部門主任且不得為提案人' using errcode='42501';
    end if;
    v_patch:=private.finance_correction_patch_v1(r,p_patch,a.id);
    if (v_patch->>'amount')::numeric<=0 then raise exception '更正至零元需使用退款／取消或沖銷程序，不可切零元支出傳票' using errcode='22023'; end if;
    if (v_patch->>'amount')::numeric=r.amount then raise exception '總額未變更，請直接使用原會計覆核功能' using errcode='22023'; end if;
    if r.cash_posted_at is null and exists(select 1 from jsonb_array_elements(r.steps) s where s->>'rk'='cashier' and s->>'a'='approved') then
      raise exception '已核准出納但缺正式付款時間，須先確認原放款紀錄' using errcode='55000';
    end if;
    insert into private.expense_accounting_corrections_v1(tenant_id,data_environment,request_id,request_no,proposer_id,reviewer_id,status,
      original_amount,proposed_amount,original_cash_amount,cash_posted_at,base_steps,base_payload,proposed_patch,reason)
      values(a.tenant_id,p_data_environment,r.id,r.no,a.id,p_reviewer_id,'pending_review',r.amount,(v_patch->>'amount')::numeric,
      case when r.cash_posted_at is not null then coalesce(nullif(r.form_payload->>'cashAmount','')::numeric,r.amount+coalesce(r.bank_fee_amount,0)) end,
      r.cash_posted_at,r.steps,r.form_payload,v_patch,p_reason) returning * into c;
  else
    select * into c from private.expense_accounting_corrections_v1 where id=p_correction_id and tenant_id=a.tenant_id
      and data_environment=p_data_environment and request_id=r.id for update;
    if not found then raise exception '找不到更正提案' using errcode='P0002'; end if;
    if c.version is distinct from p_expected_version then raise exception '更正提案版本已更新，請重新載入' using errcode='40001'; end if;
    if c.status not in ('pending_review','pending_cash') then raise exception '此更正提案已結束' using errcode='55000'; end if;
    if r.amount<>c.original_amount or r.steps is distinct from c.base_steps
      or (r.form_payload-'accountingCorrection') is distinct from (c.base_payload-'accountingCorrection') then
      raise exception '原單資料已變更，更正提案不可套用' using errcode='40001';
    end if;
    if p_action in ('assign','cancel') then
      if c.proposer_id<>a.id or c.status<>'pending_review' then raise exception '只有提案人在覆核前可取消／指定覆核人' using errcode='42501'; end if;
      if p_action='cancel' then c.status:='cancelled';
      else
        if p_reviewer_id is null or p_reviewer_id=a.id or not private.finance_correction_role_v1(a.tenant_id,p_reviewer_id,r.department_code,array['ceo','admin_director'])
          or not private.finance_correction_permission_v1(r,p_reviewer_id,'finance.approval.approve') then
          raise exception '請指定有效且非提案人的覆核主管' using errcode='42501';
        end if;
        c.reviewer_id:=p_reviewer_id;
      end if;
    elsif p_action in ('approve','reject') then
      if c.status<>'pending_review' or c.reviewer_id is distinct from a.id or c.proposer_id=a.id
        or not private.finance_correction_role_v1(a.tenant_id,a.id,r.department_code,array['ceo','admin_director'])
        or not private.finance_correction_permission_v1(r,a.id,'finance.approval.approve') then
        raise exception '只有正式指定且有效的覆核主管可處理，提案人不可自核' using errcode='42501';
      end if;
      if p_action='reject' then c.status:='rejected';
      else
        c.approved_by:=a.id;c.approved_at:=v_now;
        if c.cash_posted_at is null then c.status:='applied';v_apply:=true;
        else
          select count(*),min(u.id) into v_cashier_count,v_cashier from public.finance_users u where u.tenant_id=a.tenant_id
            and private.finance_correction_role_v1(a.tenant_id,u.id,r.department_code,array['cashier'])
            and private.finance_correction_permission_v1(r,u.id,'finance.approval.approve');
          c.cashier_id:=case when v_cashier_count=1 then v_cashier else null end;
          c.status:='pending_cash';
        end if;
      end if;
    elsif p_action='settle' then
      if c.status<>'pending_cash' or not private.finance_correction_role_v1(a.tenant_id,a.id,r.department_code,array['cashier'])
        or not private.finance_correction_permission_v1(r,a.id,'finance.approval.approve') then
        raise exception '差額只能由正式出納處理' using errcode='42501';
      end if;
      select count(*),min(u.id) into v_cashier_count,v_cashier from public.finance_users u where u.tenant_id=a.tenant_id
        and private.finance_correction_role_v1(a.tenant_id,u.id,r.department_code,array['cashier'])
        and private.finance_correction_permission_v1(r,u.id,'finance.approval.approve');
      if v_cashier_count<>1 or v_cashier<>a.id or (c.cashier_id is not null and c.cashier_id<>a.id) then
        raise exception '正式出納未唯一指定，不能改派其他角色代處理' using errcode='42501';
      end if;
      c.cashier_id:=a.id;v_delta:=c.proposed_amount-c.original_amount;
      select * into b from public.bank_transactions where tenant_id=a.tenant_id and data_environment=p_data_environment
        and id=p_bank_transaction_id and entity_id=r.entity_id for update;
      if not found or b.amount<>-v_delta or b.match_status<>'unmatched' or b.transaction_date<c.cash_posted_at::date
        or exists(select 1 from public.bank_reconciliation_matches m where m.tenant_id=a.tenant_id and m.bank_transaction_id=b.id)
        or exists(select 1 from private.expense_accounting_corrections_v1 x where x.tenant_id=a.tenant_id and x.bank_transaction_id=b.id) then
        raise exception '需提供同公司、未重複使用且金額／收支方向完全相符的實際銀行交易' using errcode='23514';
      end if;
      insert into public.bank_reconciliation_matches(id,tenant_id,data_environment,bank_transaction_id,match_type,target_table,target_id,target_no,matched_amount,confidence,match_method,matched_by,matched_at,note)
        values('correction_'||c.id,a.tenant_id,p_data_environment,b.id,'manual','manual',c.id::text,r.no,abs(v_delta),1,'manual',a.id,v_now,
          '一般支出金額更正差額；原單 '||r.no||'；更正 '||c.id||'；'||p_reason);
      update public.bank_transactions set match_status='matched',updated_at=v_now where id=b.id and tenant_id=a.tenant_id;
      c.bank_transaction_id:=b.id;c.settled_by:=a.id;c.settled_at:=v_now;c.status:='applied';v_apply:=true;
      c.cash_event:=jsonb_build_object('correctionId',c.id,'bankTransactionId',b.id,'date',b.transaction_date,'amount',b.amount,'difference',v_delta,'confirmedBy',a.id,'confirmedAt',v_now);
    else raise exception '不支援的更正動作' using errcode='22023'; end if;
    c.version:=c.version+1;
  end if;
  v_event:=jsonb_build_object('action',p_action,'actorId',a.id,'actorEmail',a.email,'at',v_now,'reason',p_reason,'version',c.version,'status',c.status);
  c.history:=c.history||jsonb_build_array(v_event);
  c.writing_transaction:=pg_current_xact_id()::text;
  update private.expense_accounting_corrections_v1 set reviewer_id=c.reviewer_id,cashier_id=c.cashier_id,status=c.status,version=c.version,
    approved_by=c.approved_by,approved_at=c.approved_at,settled_by=c.settled_by,settled_at=c.settled_at,bank_transaction_id=c.bank_transaction_id,
    cash_event=c.cash_event,history=c.history,writing_transaction=c.writing_transaction,updated_at=v_now where id=c.id;
  v_payload:=r.form_payload||jsonb_build_object('accountingCorrection',jsonb_build_object('id',c.id,'status',c.status,'originalAmount',c.original_amount,'proposedAmount',c.proposed_amount,'version',c.version));
  if v_apply then
    v_patch:=c.proposed_patch;
    v_payload:=v_payload||jsonb_build_object('accountingLines',v_patch->'accounting_lines','accountingLinePolicy','human_override_authoritative_v1');
    if c.cash_posted_at is not null then
      v_payload:=v_payload||jsonb_build_object('cashAmount',c.original_cash_amount,'correctionCashEvents',coalesce(r.form_payload->'correctionCashEvents','[]')||jsonb_build_array(c.cash_event));
    end if;
  end if;
  v_context:=coalesce(current_setting('app.finance_expense_write_context',true),'');
  v_marker:=coalesce(current_setting('app.finance_correction_write_id',true),'');
  perform set_config('app.finance_expense_write_context','active_step',true);
  perform set_config('app.finance_correction_write_id',c.id::text,true);
  update public.expense_requests set form_payload=v_payload,ver=coalesce(r.ver,1)+1,updated_at=v_now,
    amount=case when v_apply then c.proposed_amount else r.amount end,
    debit_account=case when v_apply then v_patch->>'debit_account' else r.debit_account end,
    debit_account_name=case when v_apply then v_patch->>'debit_account_name' else r.debit_account_name end,
    credit_account=case when v_apply then v_patch->>'credit_account' else r.credit_account end,
    credit_account_name=case when v_apply then v_patch->>'credit_account_name' else r.credit_account_name end
    where tenant_id=a.tenant_id and data_environment=p_data_environment and id=r.id;
  perform set_config('app.finance_expense_write_context',v_context,true);
  perform set_config('app.finance_correction_write_id',v_marker,true);
  update private.expense_accounting_corrections_v1 set writing_transaction=null where id=c.id;
  insert into public.module_audit_logs(table_name,row_id,action,actor_email,before_data,after_data)
    values('expense_accounting_corrections',c.id::text,upper(p_action),a.email,jsonb_build_object('requestAmount',r.amount,'requestVersion',r.ver),
      jsonb_build_object('correctionId',c.id,'status',c.status,'originalAmount',c.original_amount,'proposedAmount',c.proposed_amount,'history',c.history,'cashEvent',c.cash_event,'patch',c.proposed_patch));
  v_result:=jsonb_build_object('ok',true,'correction_id',c.id,'status',c.status,'version',c.version,'request_id',r.id,'request_version',r.ver+1,'amount_applied',v_apply);
  insert into private.expense_correction_operations_v1(tenant_id,data_environment,actor_id,operation_key,digest,response)
    values(a.tenant_id,p_data_environment,a.id,p_operation_key,v_digest,v_result);
  return v_result;
end;
$function$;

create function public.finance_expense_correction_read_v1(p_request_id text default null,p_data_environment text default 'production')
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare a public.finance_users%rowtype;r public.expense_requests%rowtype;v_rows jsonb;v_reviewers jsonb;
begin
  a:=private.finance_correction_actor_v1();
  if p_data_environment not in ('production','test') then raise exception '資料環境不正確' using errcode='22023'; end if;
  if p_request_id is not null then
    select * into r from public.expense_requests where id=p_request_id and tenant_id=a.tenant_id and data_environment=p_data_environment;
    if not found or not public.can_read_expense_request(r) then raise exception '無權讀取此申請單' using errcode='42501'; end if;
    select coalesce(jsonb_agg(jsonb_build_object('id',u.id,'name',u.name) order by u.name),'[]') into v_reviewers from public.finance_users u
      where u.tenant_id=a.tenant_id and u.id<>a.id and private.finance_correction_role_v1(a.tenant_id,u.id,r.department_code,array['ceo','admin_director'])
      and private.finance_correction_permission_v1(r,u.id,'finance.approval.approve');
  end if;
  select coalesce(jsonb_agg(x.data order by x.created_at desc),'[]') into v_rows from (
    select c.created_at,jsonb_build_object('id',c.id,'requestId',c.request_id,'requestNo',c.request_no,'status',c.status,'version',c.version,
      'originalAmount',c.original_amount,'proposedAmount',c.proposed_amount,'cashPostedAt',c.cash_posted_at,
      'proposerId',c.proposer_id,'reviewerId',c.reviewer_id,'cashierId',c.cashier_id,'reason',c.reason,'history',c.history,'patch',c.proposed_patch,'cashEvent',c.cash_event,
      'canReview',c.status='pending_review' and c.reviewer_id=a.id and c.proposer_id<>a.id and private.finance_correction_role_v1(a.tenant_id,a.id,e.department_code,array['ceo','admin_director']) and private.finance_correction_permission_v1(e,a.id,'finance.approval.approve'),
      'canSettle',c.status='pending_cash' and (c.cashier_id is null or c.cashier_id=a.id) and private.finance_correction_role_v1(a.tenant_id,a.id,e.department_code,array['cashier']) and private.finance_correction_permission_v1(e,a.id,'finance.approval.approve'),
      'canCancel',c.status='pending_review' and c.proposer_id=a.id,
      'bankCandidates',case when c.status='pending_cash' and private.finance_correction_role_v1(a.tenant_id,a.id,e.department_code,array['cashier']) then
        (select coalesce(jsonb_agg(jsonb_build_object('id',b.id,'date',b.transaction_date,'amount',b.amount,'reference',b.reference_no)),'[]') from public.bank_transactions b
          where b.tenant_id=a.tenant_id and b.data_environment=p_data_environment and b.entity_id=e.entity_id and b.amount=c.original_amount-c.proposed_amount
            and b.match_status='unmatched' and b.transaction_date>=c.cash_posted_at::date
            and not exists(select 1 from public.bank_reconciliation_matches m where m.tenant_id=a.tenant_id and m.bank_transaction_id=b.id)) else '[]'::jsonb end) data
      from private.expense_accounting_corrections_v1 c join public.expense_requests e on e.id=c.request_id and e.tenant_id=c.tenant_id
      where c.tenant_id=a.tenant_id and c.data_environment=p_data_environment and (p_request_id is null or c.request_id=p_request_id)
        and (p_request_id is not null or c.status in ('pending_review','pending_cash'))
        and public.can_read_expense_request(e)
        and (p_request_id is not null or a.id in (c.proposer_id,c.reviewer_id,c.cashier_id)
          or private.finance_correction_role_v1(a.tenant_id,a.id,e.department_code,array['accountant','accountant_final','admin_director','ceo','cashier']))
      order by c.created_at desc limit 100
  ) x;
  return jsonb_build_object('ok',true,'rows',v_rows,'reviewers',coalesce(v_reviewers,'[]'));
end;
$function$;

revoke all on function private.finance_correction_role_v1(uuid,text,text,text[]),private.finance_correction_actor_v1(),private.finance_correction_permission_v1(public.expense_requests,text,text),
  private.finance_expense_correction_guard_v1(),private.finance_correction_patch_v1(public.expense_requests,jsonb,text) from public,anon,authenticated,service_role;
revoke all on function public.finance_expense_correction_action_v1(text,text,text,integer,text,jsonb,text,uuid,text,text),
  public.finance_expense_correction_read_v1(text,text) from public,anon,service_role;
grant execute on function public.finance_expense_correction_action_v1(text,text,text,integer,text,jsonb,text,uuid,text,text),
  public.finance_expense_correction_read_v1(text,text) to authenticated;

-- Keep the original bank-evidence link at its original paid amount. Difference
-- transactions have their own bank reconciliation match and correction event.
-- Never rewrite the amount of the historical transfer to the new invoice total.
do $cash_evidence$
declare
  v_oid oid:='private.upsert_cash_evidence_for_expense(text)'::regprocedure::oid;
  v_definition text;v_source text;v_expected text;v_acl aclitem[];
  v_old constant text:=$anchor$  v_amount := greatest(coalesce(er.actual_amount, er.estimated_amount, er.amount, 0), 0)
    + greatest(coalesce(er.bank_fee_amount, 0), 0);$anchor$;
  v_new constant text:=$anchor$  v_amount := case
    when er.cash_posted_at is not null
      and er.form_payload ? 'correctionCashEvents'
      and coalesce(er.form_payload ->> 'cashAmount', '') ~ '^[0-9]+([.][0-9]{1,2})?$'
      then (er.form_payload ->> 'cashAmount')::numeric
    else greatest(coalesce(er.actual_amount, er.estimated_amount, er.amount, 0), 0)
      + greatest(coalesce(er.bank_fee_amount, 0), 0)
  end;$anchor$;
begin
  select pg_get_functiondef(p.oid),p.prosrc,p.proacl into v_definition,v_source,v_acl from pg_proc p
    where p.oid=v_oid and pg_get_userbyid(p.proowner)='postgres' and p.prosecdef
      and p.proconfig=array['search_path=public, pg_temp'];
  if v_definition is null or encode(sha256(v_source::bytea),'hex')<>'a8144d0ae4e2707d80b9de00cae84fa6dd8a0ca33ab1e06d8de34a48499e54fe'
    or (length(v_source)-length(replace(v_source,v_old,'')))/length(v_old)<>1 then
    raise exception 'F05 cash evidence function differs from reviewed production baseline';
  end if;
  v_expected:=replace(v_source,v_old,v_new);
  execute replace(v_definition,v_source,v_expected);
  if not exists(select 1 from pg_proc p where p.oid=v_oid and p.prosrc=v_expected and p.proacl is not distinct from v_acl
    and p.prosecdef and p.proconfig=array['search_path=public, pg_temp'] and pg_get_userbyid(p.proowner)='postgres') then
    raise exception 'F05 cash evidence postflight failed';
  end if;
end;
$cash_evidence$;

do $postflight$
declare v_name text;v_oid oid;
begin
  foreach v_name in array array['expense_accounting_corrections_v1','expense_correction_operations_v1'] loop
    if not exists(select 1 from pg_class c where c.oid=('private.'||v_name)::regclass and c.relrowsecurity)
      or has_table_privilege('authenticated','private.'||v_name,'INSERT,UPDATE,DELETE')
      or has_table_privilege('anon','private.'||v_name,'SELECT') then
      raise exception 'F05 private correction storage policy postflight failed';
    end if;
  end loop;
  for v_oid in select p.oid from pg_proc p where p.pronamespace='private'::regnamespace
    and p.proname in ('finance_correction_role_v1','finance_correction_actor_v1','finance_correction_permission_v1','finance_correction_patch_v1','finance_expense_correction_guard_v1') loop
    if has_function_privilege('public',v_oid,'EXECUTE') or has_function_privilege('authenticated',v_oid,'EXECUTE')
      or has_function_privilege('anon',v_oid,'EXECUTE') or has_function_privilege('service_role',v_oid,'EXECUTE') then
      raise exception 'F05 internal correction helper ACL postflight failed';
    end if;
  end loop;
  if not exists(select 1 from pg_trigger where tgrelid='public.expense_requests'::regclass
    and tgname='trg_finance_expense_correction_guard_v1' and tgenabled='O') then
    raise exception 'F05 pending correction guard postflight failed';
  end if;
end;
$postflight$;
notify pgrst,'reload schema';
