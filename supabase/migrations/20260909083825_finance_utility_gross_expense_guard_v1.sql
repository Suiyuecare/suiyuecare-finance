-- New/changed water and electricity accounting lines use gross expense.
-- Existing records are never rewritten or backfilled by this migration.
set local lock_timeout='5s';
set local statement_timeout='120s';

create function private.finance_utility_line_v1(p_line jsonb)
returns boolean language plpgsql immutable set search_path='' as $function$
declare v_key text;v_text text;v_spaces text:='';v_code integer;
begin
  -- Match JavaScript String.trim()/\s: choose the first nonblank item,
  -- description, label or itemName, then remove whitespace. Do not infer from
  -- a whole-request purpose or account 6202 (which also includes gas).
  foreach v_code in array array[9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279] loop
    v_spaces:=v_spaces||pg_catalog.chr(v_code);
  end loop;
  foreach v_key in array array['item','description','label','itemName'] loop
    v_text:=pg_catalog.translate(coalesce(p_line->>v_key,''),v_spaces,'');
    exit when v_text<>'';
  end loop;
  return coalesce(v_text ~ '(水費|電費|水電費)' and v_text !~ '(瓦斯|郵電|電信|電話|工程|修繕|維修|安裝|材料|設備|補助|補貼|飲水機|電腦)',false);
end;
$function$;
revoke all on function private.finance_utility_line_v1(jsonb) from public,anon,authenticated,service_role;

create function private.finance_assert_utility_lines_v1(p_lines jsonb)
returns void language plpgsql immutable set search_path='' as $function$
declare v_line jsonb;v_index integer:=0;v_key text;v_amounts boolean;
begin
  -- Shape/authorization validation stays with existing writers. This guard
  -- adds only the utility expense invariant, not another payload normalizer.
  if pg_catalog.jsonb_typeof(p_lines) is distinct from 'array' then return;end if;
  for v_line in select value from pg_catalog.jsonb_array_elements(p_lines) loop
    v_index:=v_index+1;
    if not private.finance_utility_line_v1(v_line) then continue;end if;
    v_amounts:=true;
    foreach v_key in array array['netAmount','taxAmount','grossAmount'] loop
      if coalesce(v_line->>v_key,'') !~ '^[0-9]+([.][0-9]+)?$' then v_amounts:=false;end if;
    end loop;
    if not v_amounts then
      raise exception '第 % 列水費或電費金額不完整；請回會計覆核，將進項稅額設為 0、費用金額設為帳單總額，再送出。',v_index
        using errcode='23514',detail='UTILITY_GROSS_EXPENSE_REVIEW_REQUIRED';
    end if;
    if (v_line->>'taxAmount')::numeric<>0
      or (v_line->>'netAmount')::numeric<>(v_line->>'grossAmount')::numeric
      or v_line->>'debitAccount'='1144' or v_line->>'creditAccount'='1144' then
      raise exception '第 % 列水費或電費須以帳單總額列費用，不可列進項稅額；請回會計覆核修改後再送出。既有人工覆核紀錄未被改寫。',v_index
        using errcode='23514',detail='UTILITY_GROSS_EXPENSE_REVIEW_REQUIRED';
    end if;
  end loop;
end;
$function$;
revoke all on function private.finance_assert_utility_lines_v1(jsonb) from public,anon,authenticated,service_role;

create function private.finance_utility_expense_guard_v1()
returns trigger language plpgsql security definer set search_path='' as $function$
declare v_posting boolean:=false;
begin
  if tg_op='UPDATE' then
    v_posting:=(old.ledger_posted_at is null and new.ledger_posted_at is not null)
      or (old.posting_locked_at is null and new.posting_locked_at is not null);
    if new.form_payload->'accountingLines' is not distinct from old.form_payload->'accountingLines' and not v_posting then
      return new;
    end if;
  end if;
  perform private.finance_assert_utility_lines_v1(new.form_payload->'accountingLines');
  return new;
end;
$function$;
alter function private.finance_utility_expense_guard_v1() owner to postgres;
revoke all on function private.finance_utility_expense_guard_v1() from public,anon,authenticated,service_role;
-- PostgreSQL runs same-kind triggers in name order. Check the effective value
-- after the existing human-authority merge, so stale input cannot erase audit.
create trigger trg_zzz_finance_utility_expense_guard_v1
before insert or update on public.expense_requests
for each row execute function private.finance_utility_expense_guard_v1();

create function private.finance_finalize_utility_advance_patch_v1(
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
  -- Advance entries keep their verified disbursement/difference contract.
  -- Only utility-related settlement lines gain canonical atomic persistence;
  -- the actor, whitelist and human-revision checks below match ordinary finalization.
  if p_request.type<>'advance_request' then return '{}'::jsonb;end if;
  if not exists(select 1 from jsonb_array_elements(case when jsonb_typeof(p_payload->'accountingLines')='array' then p_payload->'accountingLines' else '[]'::jsonb end) l where private.finance_utility_line_v1(l.value))
    and not exists(select 1 from jsonb_array_elements(case when jsonb_typeof(p_request.form_payload->'accountingLines')='array' then p_request.form_payload->'accountingLines' else '[]'::jsonb end) l where private.finance_utility_line_v1(l.value))
    and not exists(select 1 from jsonb_array_elements(case when jsonb_typeof(p_request.form_payload->'lazyRows')='array' then p_request.form_payload->'lazyRows' else '[]'::jsonb end) l where private.finance_utility_line_v1(l.value)) then return '{}'::jsonb;end if;
  if coalesce(p_payload->'accountingLines',p_request.form_payload->'accountingLines','[]'::jsonb)='[]'::jsonb
    and coalesce(p_request.form_payload->'accountingLines','[]'::jsonb)='[]'::jsonb then return '{}'::jsonb;end if;
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
  -- Original principal/disbursement evidence is already checked by the
  -- public finalizer. Bind this review to its exact expense and refund/supplement
  -- entries; never add the original disbursement bank fee to settlement again.
  with expected as (
    select 'dr' side,value->>'debitAccount' account,(value->>'netAmount')::numeric amount from jsonb_array_elements(v_merged)
    union all select 'dr','1144',(value->>'taxAmount')::numeric from jsonb_array_elements(v_merged)
    union all select 'cr','1191',coalesce(p_request.estimated_amount,p_request.amount)
    union all select 'dr','1112',greatest(coalesce(p_request.estimated_amount,p_request.amount)-p_amount,0)
    union all select 'cr','1112',greatest(p_amount-coalesce(p_request.estimated_amount,p_request.amount),0)
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
alter function private.finance_finalize_utility_advance_patch_v1(public.expense_requests,jsonb,jsonb,numeric,text) owner to postgres;
revoke all on function private.finance_finalize_utility_advance_patch_v1(public.expense_requests,jsonb,jsonb,numeric,text) from public,anon,authenticated,service_role;

create function private.finance_assert_utility_posting_v1(
  p_request public.expense_requests,p_payload jsonb,p_entries jsonb
) returns void language plpgsql stable set search_path='' as $function$
declare
  v_lines jsonb;v_sources jsonb;v_source_utility boolean;v_source_other boolean;v_line_utility boolean;
  v_limit numeric:=0;v_actual numeric:=0;v_row jsonb;v_tax text;
begin
  -- Initial petty funding is an asset transfer, not expense recognition.
  if p_request.type='petty_cash_request' and coalesce(p_request.petty_mode,'general')='initial' then return;end if;
  v_lines:=coalesce(p_payload->'accountingLines',p_request.form_payload->'accountingLines','[]');
  if pg_catalog.jsonb_typeof(v_lines) is distinct from 'array' then v_lines:='[]';end if;
  v_sources:=coalesce(p_request.form_payload->'lazyRows','[]');
  if pg_catalog.jsonb_typeof(v_sources) is distinct from 'array' then v_sources:='[]';end if;
  select exists(select 1 from pg_catalog.jsonb_array_elements(v_lines) l where private.finance_utility_line_v1(l.value)) into v_line_utility;
  select exists(select 1 from pg_catalog.jsonb_array_elements(v_sources) l where private.finance_utility_line_v1(l.value)),
    exists(select 1 from pg_catalog.jsonb_array_elements(v_sources) l where not private.finance_utility_line_v1(l.value)
      and coalesce(l.value->>'systemFee','false')<>'true') into v_source_utility,v_source_other;
  if not v_line_utility and not v_source_utility then return;end if;
  perform private.finance_assert_utility_lines_v1(v_lines);
  -- An all-utility saved receipt set can never contribute input tax, even if
  -- purchase actuals have been collapsed into a generic accounting line.
  if v_source_utility and not v_source_other then
    v_limit:=0;
  else
    -- Canonical ordinary/utility-advance lines have already been bound to the
    -- real accountant and exact voucher totals. If no canonical utility lines
    -- exist, only saved receipt amounts may establish the nonutility tax limit.
    for v_row in select value from pg_catalog.jsonb_array_elements(
      case when v_line_utility then v_lines else v_sources end
    ) loop
      if private.finance_utility_line_v1(v_row) or coalesce(v_row->>'systemFee','false')='true' then continue;end if;
      v_tax:=coalesce(nullif(v_row->>'taxAmount',''),v_row->>'tax','0');
      if v_tax ~ '^[0-9]+([.][0-9]+)?$' then v_limit:=v_limit+v_tax::numeric;end if;
    end loop;
  end if;
  select coalesce(sum((entry.value->>'amt')::numeric),0) into v_actual
    from pg_catalog.jsonb_array_elements(p_entries) entry where entry.value->>'ac'='1144';
  if v_actual>v_limit then
    raise exception '水費或電費帳單不得拆列進項稅額，這張傳票尚未入帳。請回會計覆核，以帳單總額列費用；混合單請逐筆保留非水電項目的稅額。'
      using errcode='23514',detail='UTILITY_INPUT_TAX_POSTING_REJECTED';
  end if;
end;
$function$;
revoke all on function private.finance_assert_utility_posting_v1(public.expense_requests,jsonb,jsonb) from public,anon,authenticated,service_role;

do $patch$
declare
  v_oid oid:='public.finalize_expense_request(text,text,integer,jsonb,numeric,numeric,text,text,text,jsonb,numeric,text,date,jsonb)'::regprocedure;
  v_definition text;v_acl aclitem[];
  v_anchor constant text:=$anchor$  v_final_form_patch := v_final_form_patch || private.finance_finalize_accounting_patch_v1(
    v_request, p_form_payload, v_normalized_entries, p_amount, v_actor.id
  );
$anchor$;
begin
  select pg_catalog.pg_get_functiondef(oid),proacl into v_definition,v_acl from pg_catalog.pg_proc
    where oid=v_oid and prosecdef and pg_catalog.pg_get_userbyid(proowner)='postgres' and proconfig=array['search_path=""'];
  if v_definition is null
    or v_definition not like '%saved.form_payload->''accountingLines''=v_final_form_patch->''accountingLines''%'
    or (length(v_definition)-length(replace(v_definition,v_anchor,'')))/length(v_anchor)<>1
    or v_definition like '%private.finance_assert_utility_posting_v1(%' then
    raise exception 'Utility posting guard requires the reviewed final accounting persistence contract';
  end if;
  execute replace(v_definition,v_anchor,v_anchor||$addition$
  v_final_form_patch := v_final_form_patch || private.finance_finalize_utility_advance_patch_v1(
    v_request, p_form_payload, v_normalized_entries, p_amount, v_actor.id
  );
  perform private.finance_assert_utility_posting_v1(
    v_request, coalesce(p_form_payload,'{}'::jsonb)||v_final_form_patch, v_normalized_entries
  );
$addition$);
  if (select proacl from pg_catalog.pg_proc where oid=v_oid) is distinct from v_acl then
    raise exception 'Utility posting guard changed the existing finalizer ACL';end if;
end;
$patch$;

-- Reject an invalid correction proposal while the accountant is still editing,
-- before it becomes a pending CEO review. Keep the existing payload, actor,
-- amount and human-history validation unchanged.
do $correction_patch$
declare
  v_oid oid:='private.finance_correction_patch_v1(public.expense_requests,jsonb,text)'::regprocedure;
  v_definition text;v_acl aclitem[];
  v_anchor constant text:=$anchor$  return jsonb_set(p_patch,'{accounting_lines}',v_merged);$anchor$;
begin
  select pg_catalog.pg_get_functiondef(oid),proacl into v_definition,v_acl from pg_catalog.pg_proc
    where oid=v_oid and not prosecdef and pg_catalog.pg_get_userbyid(proowner)='postgres' and proconfig=array['search_path=""'];
  if v_definition is null or v_definition not like '%private.finance_merge_human_accounting_lines(%'
    or (length(v_definition)-length(replace(v_definition,v_anchor,'')))/length(v_anchor)<>1
    or v_definition like '%private.finance_assert_utility_lines_v1(%' then
    raise exception 'Utility correction guard requires the reviewed canonical correction contract';end if;
  execute replace(v_definition,v_anchor,'  perform private.finance_assert_utility_lines_v1(v_merged);'||chr(10)||v_anchor);
  if (select proacl from pg_catalog.pg_proc where oid=v_oid) is distinct from v_acl then
    raise exception 'Utility correction guard changed the existing private ACL';end if;
end;
$correction_patch$;

do $postflight$
declare v_rejected boolean:=false;
begin
  if not private.finance_utility_line_v1('{"item":"115年8月電費"}')
    or private.finance_utility_line_v1('{"item":"水電工程"}')
    or private.finance_utility_line_v1('{"debitAccount":"6202","description":"瓦斯費"}') then
    raise exception 'Utility classifier postflight failed';end if;
  perform private.finance_assert_utility_lines_v1('[{"description":"水費11508","netAmount":1050,"taxAmount":0,"grossAmount":1050,"debitAccount":"6202","creditAccount":"1112"}]');
  begin
    perform private.finance_assert_utility_lines_v1('[{"description":"水費11508","netAmount":1000,"taxAmount":50,"grossAmount":1050}]');
  exception when check_violation then v_rejected:=true;end;
  if not v_rejected then raise exception 'Utility amount postflight did not reject input tax';end if;
  if not exists(select 1 from pg_catalog.pg_trigger where tgrelid='public.expense_requests'::regclass
    and tgname='trg_zzz_finance_utility_expense_guard_v1' and tgenabled='O' and not tgisinternal)
    or not exists(select 1 from pg_catalog.pg_proc where oid='public.finalize_expense_request(text,text,integer,jsonb,numeric,numeric,text,text,text,jsonb,numeric,text,date,jsonb)'::regprocedure
      and prosrc like '%private.finance_assert_utility_posting_v1(%') then
    raise exception 'Utility posting guard installation postflight failed';end if;
end;
$postflight$;
