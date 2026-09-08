-- Preserve the final accountant's reviewed lines with the voucher and ledger.
-- No historical rows are rewritten. Advance settlement and initial petty-cash
-- funding retain their separate, existing finalization contracts.
set local lock_timeout = '5s';
set local statement_timeout = '120s';

create function private.finance_finalize_accounting_patch_v1(
  p_request public.expense_requests,p_payload jsonb,p_entries jsonb,p_amount numeric,p_actor text
) returns jsonb language plpgsql stable set search_path='' as $function$
declare
  v_lines jsonb;v_old_lines jsonb;v_line jsonb;v_old jsonb;v_merged jsonb;v_canonical jsonb:='[]';
  v_field text;v_name text;v_total numeric;v_fee numeric;v_expected jsonb;v_actual jsonb;
  v_changed boolean;v_history_changed boolean;v_fresh boolean;
  v_fields constant text[]:=array['netAmount','taxAmount','grossAmount','debitAccount','creditAccount'];
  v_keys constant text[]:=array['id','source','description','grossAmount','netAmount','taxAmount',
    'debitAccount','debitAccountName','creditAccount','creditAccountName','departmentCode','aiReason',
    'systemFee','locked','reviewedBy','reviewedAt','manualOverride','valueAuthority','manualFields',
    'manualOverrideBy','manualOverrideAt','manualOverrideSource','manualOverrideHistory'];
begin
  -- These contracts build settlement/asset entries from dedicated controls, not
  -- from accountingLines. Do not reinterpret them as ordinary expense lines.
  if p_request.type='advance_request' or (p_request.type='petty_cash_request'
      and coalesce(p_request.petty_mode,'general')='initial') then return '{}'::jsonb;end if;
  if jsonb_typeof(coalesce(p_payload,'{}')) is distinct from 'object' then
    raise exception '最終會計資料格式不正確' using errcode='22023';end if;
  v_old_lines:=coalesce(p_request.form_payload->'accountingLines','[]');
  v_lines:=case when p_payload ? 'accountingLines' then p_payload->'accountingLines' else v_old_lines end;
  if jsonb_typeof(v_lines) is distinct from 'array' or jsonb_array_length(v_lines) not between 1 and 200
    or jsonb_typeof(v_old_lines) is distinct from 'array' then
    raise exception '最終入帳需有 1 至 200 列可核對的會計明細，請重新載入覆核' using errcode='22023';end if;
  for v_line in select value from jsonb_array_elements(v_lines) loop
    if jsonb_typeof(v_line) is distinct from 'object' or nullif(v_line->>'id','') is null
      or coalesce(v_line->>'systemFee','false')<>'false' or coalesce(v_line->>'locked','false')<>'false' then
      raise exception '最終會計明細不得包含手續費、鎖定列或無識別碼列' using errcode='22023';end if;
    -- Copy only accounting fields. Browser bookkeeping/identity/approvals never
    -- become source request fields through this patch.
    select jsonb_object_agg(key,value) into v_line from jsonb_each(v_line) where key=any(v_keys);
    foreach v_field in array array['netAmount','taxAmount','grossAmount'] loop
      if coalesce(v_line->>v_field,'') !~ '^[0-9]+([.][0-9]{1,2})?$' then
        raise exception '最終會計明細金額格式不正確' using errcode='22023';end if;
    end loop;
    if (v_line->>'grossAmount')::numeric<=0 or (v_line->>'netAmount')::numeric+(v_line->>'taxAmount')::numeric<>(v_line->>'grossAmount')::numeric then
      raise exception '會計明細未稅加稅額必須等於含稅金額' using errcode='23514';end if;
    foreach v_field in array array['debitAccount','creditAccount'] loop
      v_name:=private.finance_tenant_account_name(p_request.tenant_id,v_line->>v_field);
      if v_name is null then raise exception '最終會計明細包含不存在或停用的科目' using errcode='23503';end if;
      v_line:=jsonb_set(v_line,array[v_field||'Name'],to_jsonb(v_name));
    end loop;
    v_line:=v_line||jsonb_build_object('departmentCode',p_request.department_code);
    select value into v_old from jsonb_array_elements(v_old_lines) where value->>'id'=v_line->>'id';
    select exists(select 1 from unnest(v_fields) f where v_old->f is distinct from v_line->f) into v_changed;
    v_history_changed:=coalesce(v_old->'manualOverrideHistory','[]') is distinct from coalesce(v_line->'manualOverrideHistory','[]');
    v_fresh:=private.finance_accounting_human_event_is_fresh_v2(coalesce(v_old,'{}'),v_line);
    if v_history_changed or (v_old is not null and v_changed) or (private.finance_accounting_line_is_human(v_line) and not private.finance_accounting_line_is_human(coalesce(v_old,'{}'))) then
      if not v_fresh or v_line#>>'{manualOverrideBy,id}' is distinct from p_actor then
        raise exception '最終人工覆核與目前人員或已保存版本不一致，請重新載入核對' using errcode='40001',detail='HUMAN_ACCOUNTING_REVISION_CONFLICT';end if;
      if not private.finance_expense_optional_permission_allows(p_request.tenant_id,p_actor,'finance.accounting.subject.edit',
        jsonb_build_object('assignee_finance_user_id',p_actor,'owner_finance_user_id',p_request.applicant_id,
          'company_id',p_request.entity_id,'entity_id',p_request.entity_id,'department_code',p_request.department_code,
          'resource_type','expense_request','resource_id',p_request.id,'workflow_step_key','accountant_final')) then
        raise exception '目前人員無權修改此單的會計明細' using errcode='42501';end if;
    end if;
    v_canonical:=v_canonical||jsonb_build_array(v_line);
  end loop;
  if jsonb_array_length(v_canonical)<>(select count(distinct value->>'id') from jsonb_array_elements(v_canonical)) then
    raise exception '最終會計明細識別碼重複' using errcode='23505';end if;
  v_merged:=private.finance_merge_human_accounting_lines(v_old_lines,v_canonical);
  if jsonb_array_length(v_merged)<>jsonb_array_length(v_canonical) then
    raise exception '人工覆核明細不可在最終入帳時遺失' using errcode='40001';end if;
  select sum((value->>'grossAmount')::numeric) into v_total from jsonb_array_elements(v_merged);
  if v_total is distinct from p_amount then
    raise exception '最終會計明細合計與鎖定本金不一致' using errcode='23514';end if;
  v_fee:=greatest(coalesce(p_request.bank_fee_amount,0),0);
  -- Compare full account/side totals, including tax, cash replenishment and
  -- the separately locked bank fee. Balanced but different subjects are denied.
  with expected as (
    select 'dr' side,value->>'debitAccount' account,(value->>'netAmount')::numeric amount from jsonb_array_elements(v_merged)
    union all select 'dr','1144',(value->>'taxAmount')::numeric from jsonb_array_elements(v_merged)
    union all select 'dr','6290',v_fee
    union all select 'cr',value->>'creditAccount',(value->>'grossAmount')::numeric from jsonb_array_elements(v_merged) where p_request.type<>'petty_cash_request'
    union all select 'cr',v_merged->0->>'creditAccount',v_fee where p_request.type<>'petty_cash_request'
    union all select 'cr','1111',p_amount where p_request.type='petty_cash_request'
    union all select 'dr','1111',p_amount where p_request.type='petty_cash_request'
    union all select 'cr','1112',p_amount+v_fee where p_request.type='petty_cash_request'
  ), grouped as (select side,account,sum(amount) amount from expected where amount>0 group by side,account)
  select jsonb_agg(to_jsonb(g) order by side,account) into v_expected from grouped g;
  select jsonb_agg(to_jsonb(g) order by side,account) into v_actual from (
    select value->>'t' side,value->>'ac' account,sum((value->>'amt')::numeric) amount
    from jsonb_array_elements(p_entries) group by value->>'t',value->>'ac') g;
  if v_expected is distinct from v_actual then
    raise exception '最終會計明細與傳票科目、稅額或付款分錄不一致，整筆尚未入帳' using errcode='23514',detail='FINAL_ACCOUNTING_VOUCHER_MISMATCH';end if;
  return jsonb_build_object('accountingLines',v_merged,'accountingLinePolicy','human_override_authoritative_v1',
    'accountingLinesNeedReview',false,'accountingFinalization',jsonb_build_object('version',1,'at',now(),'actorId',p_actor));
end;
$function$;
alter function private.finance_finalize_accounting_patch_v1(public.expense_requests,jsonb,jsonb,numeric,text) owner to postgres;
revoke all on function private.finance_finalize_accounting_patch_v1(public.expense_requests,jsonb,jsonb,numeric,text) from public,anon,authenticated,service_role;

do $patch$
declare
  v_oid oid:='public.finalize_expense_request(text,text,integer,jsonb,numeric,numeric,text,text,text,jsonb,numeric,text,date,jsonb)'::regprocedure;
  v_definition text;v_acl aclitem[];v_old text;v_new text;
begin
  select pg_get_functiondef(oid),proacl into v_definition,v_acl from pg_proc where oid=v_oid and prosecdef
    and pg_get_userbyid(proowner)='postgres' and proconfig=array['search_path=""'];
  if v_definition is null or md5(v_definition)<>'03b4e8db9ba60bae0d35ed84a111ec67' then
    raise exception 'Final accounting line fix requires the reviewed production finalize baseline';end if;
  v_old:=$anchor$  v_voucher_total := v_expected_voucher_total;
$anchor$;
  v_new:=v_old||$anchor$
  v_final_form_patch := v_final_form_patch || private.finance_finalize_accounting_patch_v1(
    v_request, p_form_payload, v_normalized_entries, p_amount, v_actor.id
  );
$anchor$;
  if (length(v_definition)-length(replace(v_definition,v_old,'')))/length(v_old)<>1 then raise exception 'Final accounting validation anchor differs';end if;
  v_definition:=replace(v_definition,v_old,v_new);
  v_old:=$anchor$         form_payload =
           coalesce(request_row.form_payload, '{}'::jsonb)$anchor$;
  v_new:=$anchor$         debit_account = coalesce(v_final_form_patch #>> '{accountingLines,0,debitAccount}',request_row.debit_account),
         debit_account_name = coalesce(v_final_form_patch #>> '{accountingLines,0,debitAccountName}',request_row.debit_account_name),
         credit_account = coalesce(v_final_form_patch #>> '{accountingLines,0,creditAccount}',request_row.credit_account),
         credit_account_name = coalesce(v_final_form_patch #>> '{accountingLines,0,creditAccountName}',request_row.credit_account_name),
         form_payload =
           coalesce(request_row.form_payload, '{}'::jsonb)$anchor$;
  if (length(v_definition)-length(replace(v_definition,v_old,'')))/length(v_old)<>1 then raise exception 'Final accounting save anchor differs';end if;
  v_definition:=replace(v_definition,v_old,v_new);
  v_old:=$anchor$  perform pg_catalog.set_config(
    'app.finance_expense_write_context',
    coalesce(v_previous_write_context, ''),
    true
  );$anchor$;
  v_new:=$anchor$  if v_final_form_patch ? 'accountingLines' and not exists (
    select 1 from public.expense_requests saved
    where saved.tenant_id=v_tenant_id and saved.data_environment=v_environment and saved.id=v_request.id
      and saved.form_payload->'accountingLines'=v_final_form_patch->'accountingLines'
      and saved.debit_account=v_final_form_patch#>>'{accountingLines,0,debitAccount}'
      and saved.debit_account_name=v_final_form_patch#>>'{accountingLines,0,debitAccountName}'
      and saved.credit_account=v_final_form_patch#>>'{accountingLines,0,creditAccount}'
      and saved.credit_account_name=v_final_form_patch#>>'{accountingLines,0,creditAccountName}'
      and (select jsonb_agg(line.payload order by line.line_index)
        from public.application_accounting_lines line where line.request_id=saved.id
          and line.data_environment=saved.data_environment)=v_final_form_patch->'accountingLines'
  ) then
    raise exception '最終會計明細未能與入帳版本一致保存，已回復本次交易' using errcode='40001';
  end if;

$anchor$||v_old;
  if (length(v_definition)-length(replace(v_definition,v_old,'')))/length(v_old)<>1 then raise exception 'Final accounting post-save anchor differs';end if;
  v_definition:=replace(v_definition,v_old,v_new);
  execute v_definition;
  if (select proacl from pg_proc where oid=v_oid) is distinct from v_acl then raise exception 'Finalization ACL changed unexpectedly';end if;
end;
$patch$;

do $postflight$
declare v_request public.expense_requests%rowtype;v_rejected boolean:=false;
begin
  if not exists(select 1 from pg_proc where oid='public.finalize_expense_request(text,text,integer,jsonb,numeric,numeric,text,text,text,jsonb,numeric,text,date,jsonb)'::regprocedure
    and prosecdef and proconfig=array['search_path=""'] and prosrc like '%private.finance_finalize_accounting_patch_v1(%'
    and prosrc like '%saved.form_payload->''accountingLines''=v_final_form_patch->''accountingLines''%') then
    raise exception 'Final accounting atomic persistence postflight failed';end if;
  if not exists(select 1 from pg_trigger where tgrelid='public.expense_requests'::regclass
    and tgfoid='private.finance_sync_request_accounting_lines()'::regprocedure and not tgisinternal and tgenabled='O') then
    raise exception 'Final accounting requires the active transactional accounting-line sync trigger';end if;
  if has_function_privilege('anon','private.finance_finalize_accounting_patch_v1(public.expense_requests,jsonb,jsonb,numeric,text)','EXECUTE')
    or has_function_privilege('authenticated','private.finance_finalize_accounting_patch_v1(public.expense_requests,jsonb,jsonb,numeric,text)','EXECUTE')
    or has_function_privilege('service_role','private.finance_finalize_accounting_patch_v1(public.expense_requests,jsonb,jsonb,numeric,text)','EXECUTE') then
    raise exception 'Final accounting private helper has unexpected caller privileges';end if;
  v_request:=jsonb_populate_record(null::public.expense_requests,'{"type":"payment_request","form_payload":{"accountingLines":[]}}');
  begin
    perform private.finance_finalize_accounting_patch_v1(v_request,'{"accountingLines":[]}','[]',100,'postflight');
  exception when invalid_parameter_value then v_rejected:=true;end;
  if not v_rejected then raise exception 'Final accounting accepted an empty accounting revision';end if;
  v_request.type:='advance_request';
  if private.finance_finalize_accounting_patch_v1(v_request,'{}','[]',100,'postflight')<>'{}'::jsonb then
    raise exception 'Final accounting changed the separate advance settlement contract';end if;
end;
$postflight$;
