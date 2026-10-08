-- Bind one historical invoice item to one accounting line without changing money,
-- subjects, approval steps, or the original invoice evidence. The stable source
-- identity and accounting reference are written in the same request transaction.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $preflight$
begin
  if pg_catalog.to_regclass('public.expense_requests') is null
     or pg_catalog.to_regclass('public.application_accounting_lines') is null
     or pg_catalog.to_regclass('public.module_audit_logs') is null
     or pg_catalog.to_regprocedure('private.finance_expense_actor_can_act(uuid,public.expense_requests,integer,jsonb,text,text,text)') is null
     or pg_catalog.to_regprocedure('private.finance_expense_optional_permission_allows(uuid,text,text,jsonb)') is null
     or pg_catalog.to_regprocedure('private.finance_income_begin_operation(uuid,text,text,text,text,text)') is null
     or pg_catalog.to_regprocedure('private.finance_income_finish_operation(uuid,text,text,text,jsonb)') is null
     or pg_catalog.to_regprocedure('private.finance_income_request_digest(jsonb)') is null
     or pg_catalog.to_regprocedure('private.finance_income_active_step_index(jsonb)') is null
     or pg_catalog.to_regprocedure('private.finance_income_step_role(jsonb)') is null
     or not exists (
       select 1 from pg_catalog.pg_trigger t
       where t.tgrelid = 'public.expense_requests'::pg_catalog.regclass
         and t.tgname = 'trg_finance_expense_controlled_write' and t.tgenabled = 'O'
     )
     or not exists (
       select 1 from pg_catalog.pg_trigger t
       where t.tgrelid = 'public.expense_requests'::pg_catalog.regclass
         and t.tgname = 'trg_zz_finance_sync_request_accounting_lines' and t.tgenabled = 'O'
     ) then
    raise exception 'Invoice item binding requires the reviewed request guard, accounting sync and operation contracts'
      using errcode = '55000';
  end if;
end;
$preflight$;

create function public.finance_bind_expense_invoice_item_v1(
  p_request_id text,
  p_expected_ver integer,
  p_source_index integer,
  p_accounting_line_id text,
  p_idempotency_key text,
  p_data_environment text default 'production'
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_tenant uuid;
  v_environment text := pg_catalog.lower(coalesce(p_data_environment, ''));
  v_actor public.finance_users%rowtype;
  v_actor_count integer;
  v_request public.expense_requests%rowtype;
  v_saved public.expense_requests%rowtype;
  v_active_index integer;
  v_step jsonb;
  v_step_role text;
  v_context jsonb;
  v_sources jsonb;
  v_lines jsonb;
  v_source jsonb;
  v_line jsonb;
  v_line_index integer;
  v_source_id text;
  v_existing_link text;
  v_source_name text;
  v_source_net_text text;
  v_source_tax_text text;
  v_source_gross_text text;
  v_source_tax_mode text;
  v_line_net_text text;
  v_line_tax_text text;
  v_line_gross_text text;
  v_digest text;
  v_cached jsonb;
  v_result jsonb;
  v_previous_context text;
  v_row_count integer;
  v_synced jsonb;
begin
  if auth.uid() is null then
    raise exception '請先登入後再核對發票品項' using errcode = '42501';
  end if;
  if coalesce(pg_catalog.btrim(p_request_id), '') = ''
     or coalesce(pg_catalog.btrim(p_accounting_line_id), '') = ''
     or pg_catalog.length(p_accounting_line_id) > 200
     or p_expected_ver is null or p_expected_ver < 1
     or p_source_index is null or p_source_index < 1
     or v_environment not in ('production', 'test') then
    raise exception '發票品項核對參數不完整' using errcode = '22023';
  end if;

  v_tenant := public.current_tenant_id();
  if v_tenant is null then
    raise exception '目前租戶身分無法確認' using errcode = '42501';
  end if;
  select pg_catalog.count(*), (pg_catalog.array_agg(u.id))[1]
    into v_actor_count, v_existing_link
  from public.finance_users u
  where u.tenant_id = v_tenant and u.auth_user_id = auth.uid() and u.active is true;
  if v_actor_count <> 1 then
    raise exception '目前登入帳號須有唯一且有效的財務人員身分' using errcode = '42501';
  end if;
  select u.* into v_actor from public.finance_users u
  where u.tenant_id = v_tenant and u.id = v_existing_link;
  if v_actor.role not in ('accountant', 'ceo', 'admin_director') then
    raise exception '只有會計、執行長或行政部門主任可核對會計品項' using errcode = '42501';
  end if;

  v_digest := private.finance_income_request_digest(pg_catalog.jsonb_build_object(
    'operation', 'expense_invoice_item_bind_v1',
    'requestId', p_request_id,
    'expectedVer', p_expected_ver,
    'sourceIndex', p_source_index,
    'accountingLineId', p_accounting_line_id,
    'environment', v_environment
  ));
  v_cached := private.finance_income_begin_operation(
    v_tenant, v_environment, 'expense_invoice_item_bind_v1',
    p_idempotency_key, v_digest, v_actor.id
  );
  if v_cached is not null then
    return v_cached || pg_catalog.jsonb_build_object('idempotentReplay', true);
  end if;

  select r.* into v_request from public.expense_requests r
  where r.tenant_id = v_tenant and r.data_environment = v_environment
    and r.id = p_request_id
  for update;
  if not found then
    raise exception '申請單不存在或不屬於目前租戶與資料環境' using errcode = 'P0002';
  end if;
  if coalesce(v_request.ver, 1) <> p_expected_ver then
    raise exception '申請單已由其他操作更新，請重新載入後核對'
      using errcode = '40001', detail = 'INVOICE_ITEM_BIND_VERSION_CONFLICT';
  end if;
  if v_request.posting_locked_at is not null or v_request.ledger_posted_at is not null
     or v_request.voided_at is not null or coalesce(v_request.voucher_id, '') <> ''
     or v_request.status in ('completed', 'paid', 'settled', 'closed', 'rejected', 'cancelled') then
    raise exception '已入帳、結案或作廢的申請單不可重新配對品項' using errcode = '55000';
  end if;
  if pg_catalog.jsonb_typeof(v_request.steps) is distinct from 'array' then
    raise exception '申請單簽核步驟格式錯誤' using errcode = '22023';
  end if;
  v_active_index := private.finance_income_active_step_index(v_request.steps);
  if v_active_index is null then
    raise exception '申請單目前沒有可核對的簽核關卡' using errcode = '55000';
  end if;
  v_step := v_request.steps -> v_active_index;
  v_step_role := private.finance_income_step_role(v_step);
  if v_step_role not in ('accountant', 'accountant_final', 'admin_director', 'ceo')
     or not private.finance_expense_actor_can_act(
       v_tenant, v_request, v_active_index, v_step,
       v_actor.id, v_actor.email, v_actor.role
     ) then
    raise exception '目前不是您可處理的會計或執行長簽核關卡' using errcode = '42501';
  end if;
  v_context := pg_catalog.jsonb_build_object(
    'assignee_finance_user_id', v_actor.id,
    'owner_finance_user_id', v_request.applicant_id,
    'department_code', v_request.department_code,
    'company_id', v_request.entity_id,
    'entity_id', v_request.entity_id,
    'resource_type', 'expense_request',
    'resource_id', v_request.id,
    'workflow_step_key', v_step_role
  );
  if not private.finance_expense_optional_permission_allows(
    v_tenant, v_actor.id, 'finance.accounting.subject.edit', v_context
  ) then
    raise exception '目前人員無權修改此單的會計明細' using errcode = '42501';
  end if;

  v_sources := v_request.form_payload -> 'lazyRows';
  v_lines := v_request.form_payload -> 'accountingLines';
  if pg_catalog.jsonb_typeof(v_sources) is distinct from 'array'
     or pg_catalog.jsonb_array_length(v_sources) not between 1 and 200
     or p_source_index > pg_catalog.jsonb_array_length(v_sources)
     or pg_catalog.jsonb_typeof(v_lines) is distinct from 'array'
     or pg_catalog.jsonb_array_length(v_lines) not between 1 and 200 then
    raise exception '來源品項或會計明細不存在，請重新載入核對' using errcode = '22023';
  end if;
  v_source := v_sources -> (p_source_index - 1);
  if pg_catalog.jsonb_typeof(v_source) is distinct from 'object'
     or coalesce(v_source ->> 'systemFee', 'false') <> 'false' then
    raise exception '銀行手續費或無效來源品項不可配對' using errcode = '22023';
  end if;
  select item.value, item.ordinality::integer into v_line, v_line_index
  from pg_catalog.jsonb_array_elements(v_lines) with ordinality item(value, ordinality)
  where item.value ->> 'id' = p_accounting_line_id;
  if not found or (
    select pg_catalog.count(*) from pg_catalog.jsonb_array_elements(v_lines) item
    where item ->> 'id' = p_accounting_line_id
  ) <> 1 or pg_catalog.jsonb_typeof(v_line) is distinct from 'object'
     or coalesce(v_line ->> 'systemFee', 'false') <> 'false'
     or coalesce(v_line ->> 'locked', 'false') <> 'false' then
    raise exception '會計列不存在、不唯一或已鎖定' using errcode = '22023';
  end if;

  -- A historical source has no ID. Exact amounts and description gate the
  -- human selection; the invoice/date/file identity remains on that source row.
  v_source_name := pg_catalog.btrim(coalesce(
    nullif(v_source ->> 'item', ''),
    nullif(v_source ->> 'description', ''),
    nullif(v_source ->> 'label', ''), ''
  ));
  v_source_net_text := coalesce(nullif(v_source ->> 'netAmount', ''), nullif(v_source ->> 'subtotal', ''), nullif(v_source ->> 'net', ''));
  v_source_tax_text := coalesce(nullif(v_source ->> 'taxAmount', ''), nullif(v_source ->> 'tax', ''));
  v_source_gross_text := coalesce(nullif(v_source ->> 'grossAmount', ''), nullif(v_source ->> 'total', ''), nullif(v_source ->> 'amount', ''));
  v_source_tax_mode := pg_catalog.btrim(coalesce(
    nullif(v_source ->> 'taxMode', ''), nullif(v_source ->> 'amountTaxMode', ''),
    nullif(v_source ->> 'tax_mode', ''), ''
  ));
  v_line_net_text := v_line ->> 'netAmount';
  v_line_tax_text := v_line ->> 'taxAmount';
  v_line_gross_text := v_line ->> 'grossAmount';
  if (v_source_net_text is not null and v_source_net_text !~ '^[0-9]+([.][0-9]{1,4})?$')
     or (v_source_tax_text is not null and v_source_tax_text !~ '^[0-9]+([.][0-9]{1,4})?$')
     or (v_source_gross_text is not null and v_source_gross_text !~ '^[0-9]+([.][0-9]{1,4})?$') then
    raise exception '來源品項金額格式錯誤，請先核對原單'
      using errcode = '23514', detail = 'INVOICE_ITEM_BIND_SOURCE_MISMATCH';
  end if;
  -- Older lazyRows can carry only the gross amount. Match the displayed
  -- gross-inclusive/exempt parts, including JavaScript's whole-dollar tax
  -- rounding; do not infer incomplete net-exclusive rows.
  if v_source_gross_text is not null and v_source_tax_mode not in ('net_exclusive', '未稅') then
    if v_source_tax_mode in ('exempt', '免稅', '不計稅', 'no_tax')
       or (v_source_tax_mode not in ('gross_inclusive', '含稅')
           and v_source_tax_text is not null and v_source_tax_text::numeric = 0) then
      v_source_net_text := v_source_gross_text;
      v_source_tax_text := '0';
    elsif v_source_net_text is null or v_source_tax_text is null then
      if v_source_tax_text is not null and v_source_tax_text::numeric > 0 then
        v_source_net_text := (v_source_gross_text::numeric - v_source_tax_text::numeric)::text;
      elsif v_source_net_text is not null and v_source_net_text::numeric > 0
            and v_source_gross_text::numeric > v_source_net_text::numeric then
        v_source_tax_text := (v_source_gross_text::numeric - v_source_net_text::numeric)::text;
      else
        v_source_net_text := pg_catalog.round(v_source_gross_text::numeric / 1.05)::text;
        v_source_tax_text := (v_source_gross_text::numeric - v_source_net_text::numeric)::text;
      end if;
    end if;
  end if;
  if v_source_name = ''
     or v_source_name is distinct from pg_catalog.btrim(coalesce(v_line ->> 'description', ''))
     or coalesce(v_source_net_text, '') !~ '^[0-9]+([.][0-9]{1,4})?$'
     or coalesce(v_source_tax_text, '') !~ '^[0-9]+([.][0-9]{1,4})?$'
     or coalesce(v_source_gross_text, '') !~ '^[0-9]+([.][0-9]{1,4})?$'
     or coalesce(v_line_net_text, '') !~ '^[0-9]+([.][0-9]{1,4})?$'
     or coalesce(v_line_tax_text, '') !~ '^[0-9]+([.][0-9]{1,4})?$'
     or coalesce(v_line_gross_text, '') !~ '^[0-9]+([.][0-9]{1,4})?$' then
    raise exception '來源品項與會計列的名稱或金額不完整，請會計核對原單'
      using errcode = '23514', detail = 'INVOICE_ITEM_BIND_SOURCE_MISMATCH';
  end if;
  if v_source_net_text::numeric is distinct from v_line_net_text::numeric
     or v_source_tax_text::numeric is distinct from v_line_tax_text::numeric
     or v_source_gross_text::numeric is distinct from v_line_gross_text::numeric
     or v_source_net_text::numeric + v_source_tax_text::numeric is distinct from v_source_gross_text::numeric
     or v_source_gross_text::numeric <= 0 then
    raise exception '來源品項與會計列的未稅、稅額或含稅金額不同，請重新核對'
      using errcode = '23514', detail = 'INVOICE_ITEM_BIND_SOURCE_MISMATCH';
  end if;

  v_source_id := pg_catalog.btrim(coalesce(v_source ->> 'id', ''));
  v_existing_link := pg_catalog.btrim(coalesce(v_line ->> 'sourceItemId', ''));
  if v_existing_link <> '' and (v_source_id = '' or v_existing_link <> v_source_id) then
    raise exception '這列會計明細已有其他來源品項，不可覆蓋配對' using errcode = '23505';
  end if;
  if v_source_id <> '' and exists (
    select 1 from pg_catalog.jsonb_array_elements(v_sources) with ordinality item(value, ordinality)
    where item.ordinality <> p_source_index and item.value ->> 'id' = v_source_id
  ) then
    raise exception '來源品項識別碼不唯一，已停止配對' using errcode = '23505';
  end if;
  if v_source_id <> '' and exists (
    select 1 from pg_catalog.jsonb_array_elements(v_lines) item
    where item ->> 'sourceItemId' = v_source_id
      and item ->> 'id' <> p_accounting_line_id
  ) then
    raise exception '來源品項已配對另一列會計明細，不可重複配對' using errcode = '23505';
  end if;

  if v_source_id <> '' and v_existing_link = v_source_id then
    v_result := pg_catalog.jsonb_build_object(
      'ok', true, 'requestId', v_request.id, 'sourceIndex', p_source_index,
      'accountingLineId', p_accounting_line_id, 'sourceItemId', v_source_id,
      'ver', v_request.ver, 'alreadyBound', true, 'idempotentReplay', false
    );
    perform private.finance_income_finish_operation(
      v_tenant, v_environment, 'expense_invoice_item_bind_v1', p_idempotency_key, v_result
    );
    return v_result;
  end if;
  if v_source_id = '' then
    v_source_id := pg_catalog.gen_random_uuid()::text;
  end if;
  v_sources := pg_catalog.jsonb_set(
    v_sources, array[(p_source_index - 1)::text, 'id'], pg_catalog.to_jsonb(v_source_id), true
  );
  v_lines := pg_catalog.jsonb_set(
    v_lines, array[(v_line_index - 1)::text, 'sourceItemId'], pg_catalog.to_jsonb(v_source_id), true
  );
  v_previous_context := coalesce(pg_catalog.current_setting('app.finance_expense_write_context', true), '');
  perform pg_catalog.set_config('app.finance_expense_write_context', 'active_step', true);
  update public.expense_requests r
     set form_payload = pg_catalog.jsonb_set(
           pg_catalog.jsonb_set(coalesce(r.form_payload, '{}'::jsonb), '{lazyRows}', v_sources, true),
           '{accountingLines}', v_lines, true
         ),
         ver = coalesce(r.ver, 1) + 1,
         updated_at = pg_catalog.now()
   where r.tenant_id = v_tenant and r.data_environment = v_environment
     and r.id = v_request.id and coalesce(r.ver, 1) = p_expected_ver
   returning r.* into v_saved;
  get diagnostics v_row_count = row_count;
  perform pg_catalog.set_config('app.finance_expense_write_context', v_previous_context, true);
  if v_row_count <> 1
     or v_saved.form_payload #>> array['lazyRows', (p_source_index - 1)::text, 'id'] is distinct from v_source_id
     or v_saved.form_payload #>> array['accountingLines', (v_line_index - 1)::text, 'sourceItemId'] is distinct from v_source_id then
    raise exception '發票品項與會計列未能一致保存，請重新載入' using errcode = '40001';
  end if;
  select a.payload into v_synced from public.application_accounting_lines a
  where a.request_id = v_saved.id and a.line_index = v_line_index
    and a.data_environment = v_environment;
  if v_synced is distinct from (v_saved.form_payload -> 'accountingLines' -> (v_line_index - 1)) then
    raise exception '會計明細同步未完成，已回復本次配對' using errcode = '40001';
  end if;

  insert into public.module_audit_logs (
    table_name, row_id, action, actor_email, before_data, after_data
  ) values (
    'expense_requests', v_request.id, 'INVOICE_ITEM_MANUAL_BIND', v_actor.email,
    pg_catalog.jsonb_build_object(
      'actorId', v_actor.id, 'sourceIndex', p_source_index,
      'sourceRow', v_source, 'accountingLineId', p_accounting_line_id,
      'sourceItemId', v_existing_link, 'requestVer', v_request.ver
    ),
    pg_catalog.jsonb_build_object(
      'actorId', v_actor.id, 'sourceIndex', p_source_index,
      'sourceRow', v_saved.form_payload -> 'lazyRows' -> (p_source_index - 1),
      'accountingLineId', p_accounting_line_id, 'sourceItemId', v_source_id,
      'requestVer', v_saved.ver, 'idempotencyKey', p_idempotency_key
    )
  );
  v_result := pg_catalog.jsonb_build_object(
    'ok', true, 'requestId', v_saved.id, 'sourceIndex', p_source_index,
    'accountingLineId', p_accounting_line_id, 'sourceItemId', v_source_id,
    'ver', v_saved.ver, 'alreadyBound', false, 'idempotentReplay', false
  );
  perform private.finance_income_finish_operation(
    v_tenant, v_environment, 'expense_invoice_item_bind_v1', p_idempotency_key, v_result
  );
  return v_result;
end;
$function$;

alter function public.finance_bind_expense_invoice_item_v1(text,integer,integer,text,text,text) owner to postgres;
revoke all on function public.finance_bind_expense_invoice_item_v1(text,integer,integer,text,text,text)
  from public, anon, authenticated, service_role;
grant execute on function public.finance_bind_expense_invoice_item_v1(text,integer,integer,text,text,text)
  to authenticated;
comment on function public.finance_bind_expense_invoice_item_v1(text,integer,integer,text,text,text)
  is 'A current accounting/CEO approver binds one historical invoice item to one matching accounting line, atomically preserving source identity and audit.';

-- Final posting copies only an allowlisted accounting-line shape. Preserve the
-- verified source link in ordinary and utility-advance final accounting.
do $final_source_link$
declare
  v_signature text;
  v_oid oid;
  v_definition text;
  v_source text;
  v_acl aclitem[];
  v_anchor constant text := $anchor$array['id','source','description'$anchor$;
  v_replacement constant text := $anchor$array['id','sourceItemId','source','description'$anchor$;
begin
  foreach v_signature in array array[
    'private.finance_finalize_accounting_patch_v1(public.expense_requests,jsonb,jsonb,numeric,text)',
    'private.finance_finalize_utility_advance_patch_v1(public.expense_requests,jsonb,jsonb,numeric,text)'
  ] loop
    v_oid := pg_catalog.to_regprocedure(v_signature)::oid;
    if v_oid is null then
      raise exception 'Final accounting source-link helper is missing: %', v_signature using errcode = '55000';
    end if;
    select pg_catalog.pg_get_functiondef(p.oid), p.prosrc, p.proacl
      into v_definition, v_source, v_acl
    from pg_catalog.pg_proc p
    where p.oid = v_oid and pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
      and not p.prosecdef and p.proconfig = array['search_path=""']::text[];
    if v_definition is null
       or (pg_catalog.length(v_source) - pg_catalog.length(pg_catalog.replace(v_source, v_anchor, '')))
          / pg_catalog.length(v_anchor) <> 1
       or v_source not like '%v_keys constant text[]%'
       or v_source not like '%jsonb_object_agg(key,value)%' then
      raise exception 'Final accounting source-link helper differs from the reviewed allowlist: %', v_signature
        using errcode = '55000';
    end if;
    execute pg_catalog.replace(v_definition, v_source,
      pg_catalog.replace(v_source, v_anchor, v_replacement));
    if not exists (
      select 1 from pg_catalog.pg_proc p where p.oid = v_oid
        and p.prosrc = pg_catalog.replace(v_source, v_anchor, v_replacement)
        and p.proacl is not distinct from v_acl
        and pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
    ) then
      raise exception 'Final accounting source-link helper postflight failed: %', v_signature
        using errcode = '55000';
    end if;
  end loop;
end;
$final_source_link$;

do $postflight$
begin
  if not exists (
    select 1 from pg_catalog.pg_proc p
    where p.oid = 'public.finance_bind_expense_invoice_item_v1(text,integer,integer,text,text,text)'::pg_catalog.regprocedure
      and p.prosecdef and p.proconfig = array['search_path=""']::text[]
      and pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
      and p.prosrc like '%INVOICE_ITEM_MANUAL_BIND%'
      and p.prosrc like '%app.finance_expense_write_context%'
  ) or pg_catalog.has_function_privilege('anon',
    'public.finance_bind_expense_invoice_item_v1(text,integer,integer,text,text,text)', 'EXECUTE')
    or pg_catalog.has_function_privilege('service_role',
      'public.finance_bind_expense_invoice_item_v1(text,integer,integer,text,text,text)', 'EXECUTE')
    or not pg_catalog.has_function_privilege('authenticated',
      'public.finance_bind_expense_invoice_item_v1(text,integer,integer,text,text,text)', 'EXECUTE') then
    raise exception 'Invoice item binding RPC ownership, audit or execute grants differ from the reviewed contract'
      using errcode = '55000';
  end if;
end;
$postflight$;

notify pgrst, 'reload schema';
