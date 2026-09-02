-- Human accounting review is authoritative.
--
-- This migration adds a database-side last line of defence so AI/rule
-- recalculation, workflow returns, browser retries, or later approval steps
-- cannot silently replace manually reviewed amounts or account subjects. It
-- also keeps expense_requests.form_payload.accountingLines and the normalized
-- application_accounting_lines table in the same database transaction.

set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $preflight$
begin
  if pg_catalog.to_regclass('public.expense_requests') is null
     or pg_catalog.to_regclass('public.application_accounting_lines') is null
     or pg_catalog.to_regclass('public.module_audit_logs') is null then
    raise exception using
      errcode = '55000',
      message = 'Human accounting authority preflight requires the formal request, accounting-line, and audit tables';
  end if;

  if not exists (
    select 1
    from information_schema.columns column_info
    where column_info.table_schema = 'public'
      and column_info.table_name = 'expense_requests'
      and column_info.column_name = 'form_payload'
      and column_info.data_type = 'jsonb'
  ) then
    raise exception using
      errcode = '55000',
      message = 'Human accounting authority preflight requires expense_requests.form_payload jsonb';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_info
    join pg_catalog.pg_class relation_info
      on relation_info.oid = constraint_info.conrelid
    join pg_catalog.pg_namespace namespace_info
      on namespace_info.oid = relation_info.relnamespace
    where namespace_info.nspname = 'public'
      and relation_info.relname = 'application_accounting_lines'
      and constraint_info.contype in ('p', 'u')
      and pg_catalog.pg_get_constraintdef(constraint_info.oid)
        like 'UNIQUE (request_id, line_index)%'
  ) then
    raise exception using
      errcode = '55000',
      message = 'Human accounting authority preflight requires unique (request_id, line_index)';
  end if;
end;
$preflight$;

create or replace function private.finance_accounting_manual_fields(
  p_line jsonb
)
returns text[]
language sql
immutable
set search_path = ''
as $function$
  select coalesce(
    pg_catalog.array_agg(field_name order by field_name),
    array[]::text[]
  )
  from (
    select distinct field_item.value as field_name
    from pg_catalog.jsonb_array_elements_text(
      case
        when pg_catalog.jsonb_typeof(p_line -> 'manualFields') = 'array'
          then p_line -> 'manualFields'
        else '[]'::jsonb
      end
    ) field_item(value)
    where field_item.value in (
      'netAmount',
      'taxAmount',
      'grossAmount',
      'debitAccount',
      'creditAccount'
    )
  ) valid_fields;
$function$;

create or replace function private.finance_accounting_line_is_human(
  p_line jsonb
)
returns boolean
language sql
immutable
set search_path = ''
as $function$
  select coalesce(
    (
      coalesce((p_line ->> 'manualOverride')::boolean, false)
      or coalesce(p_line ->> 'valueAuthority', '') = 'human'
    )
    and pg_catalog.cardinality(
      private.finance_accounting_manual_fields(p_line)
    ) > 0,
    false
  );
$function$;

create or replace function private.finance_merge_human_accounting_line(
  p_old_line jsonb,
  p_new_line jsonb
)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $function$
declare
  v_result jsonb := coalesce(p_new_line, '{}'::jsonb);
  v_old_fields text[] := private.finance_accounting_manual_fields(p_old_line);
  v_new_fields text[] := private.finance_accounting_manual_fields(p_new_line);
  v_union_fields text[];
  v_field text;
  v_old_history_length integer := pg_catalog.jsonb_array_length(
    case
      when pg_catalog.jsonb_typeof(p_old_line -> 'manualOverrideHistory') = 'array'
        then p_old_line -> 'manualOverrideHistory'
      else '[]'::jsonb
    end
  );
  v_new_history_length integer := pg_catalog.jsonb_array_length(
    case
      when pg_catalog.jsonb_typeof(p_new_line -> 'manualOverrideHistory') = 'array'
        then p_new_line -> 'manualOverrideHistory'
      else '[]'::jsonb
    end
  );
  v_new_has_fresh_human_audit boolean;
begin
  if not private.finance_accounting_line_is_human(p_old_line) then
    return v_result;
  end if;

  v_new_has_fresh_human_audit :=
    private.finance_accounting_line_is_human(p_new_line)
    and v_new_history_length > v_old_history_length;

  foreach v_field in array v_old_fields loop
    if not (
      v_field = any(v_new_fields)
      and (
        v_result -> v_field is not distinct from p_old_line -> v_field
        or v_new_has_fresh_human_audit
      )
    ) then
      v_result := pg_catalog.jsonb_set(
        v_result,
        array[v_field],
        coalesce(p_old_line -> v_field, 'null'::jsonb),
        true
      );
    end if;
  end loop;

  select pg_catalog.array_agg(field_name order by field_name)
    into v_union_fields
  from (
    select distinct field_name
    from pg_catalog.unnest(v_old_fields || v_new_fields) field_row(field_name)
    where field_name in (
      'netAmount',
      'taxAmount',
      'grossAmount',
      'debitAccount',
      'creditAccount'
    )
  ) union_rows;

  v_result := v_result || pg_catalog.jsonb_build_object(
    'manualOverride', true,
    'valueAuthority', 'human',
    'manualFields', pg_catalog.to_jsonb(coalesce(v_union_fields, v_old_fields)),
    'manualOverrideBy', case
      when v_new_has_fresh_human_audit then coalesce(p_new_line -> 'manualOverrideBy', '{}'::jsonb)
      else coalesce(p_old_line -> 'manualOverrideBy', '{}'::jsonb)
    end,
    'manualOverrideAt', case
      when v_new_has_fresh_human_audit then coalesce(p_new_line ->> 'manualOverrideAt', '')
      else coalesce(p_old_line ->> 'manualOverrideAt', '')
    end,
    'manualOverrideSource', case
      when v_new_has_fresh_human_audit then coalesce(p_new_line ->> 'manualOverrideSource', '')
      else coalesce(p_old_line ->> 'manualOverrideSource', '')
    end,
    'manualOverrideHistory', case
      when v_new_has_fresh_human_audit then coalesce(p_new_line -> 'manualOverrideHistory', '[]'::jsonb)
      else coalesce(p_old_line -> 'manualOverrideHistory', '[]'::jsonb)
    end,
    'reviewedBy', case
      when v_new_has_fresh_human_audit then coalesce(p_new_line ->> 'reviewedBy', '')
      else coalesce(p_old_line ->> 'reviewedBy', '')
    end,
    'reviewedAt', case
      when v_new_has_fresh_human_audit then p_new_line -> 'reviewedAt'
      else p_old_line -> 'reviewedAt'
    end
  );

  return v_result;
end;
$function$;

create or replace function private.finance_merge_human_accounting_lines(
  p_old_lines jsonb,
  p_new_lines jsonb
)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $function$
declare
  v_result jsonb := '[]'::jsonb;
  v_new_line jsonb;
  v_old_line jsonb;
  v_ordinality bigint;
begin
  if pg_catalog.jsonb_typeof(p_old_lines) <> 'array' then
    return coalesce(p_new_lines, '[]'::jsonb);
  end if;
  if pg_catalog.jsonb_typeof(p_new_lines) <> 'array' then
    return p_old_lines;
  end if;

  for v_new_line, v_ordinality in
    select line_item.value, line_item.ordinality
    from pg_catalog.jsonb_array_elements(p_new_lines)
      with ordinality line_item(value, ordinality)
    order by line_item.ordinality
  loop
    select old_item.value
      into v_old_line
    from pg_catalog.jsonb_array_elements(p_old_lines)
      with ordinality old_item(value, ordinality)
    where (
      coalesce(v_new_line ->> 'id', '') <> ''
      and old_item.value ->> 'id' = v_new_line ->> 'id'
    ) or (
      coalesce(v_new_line ->> 'id', '') = ''
      and old_item.ordinality = v_ordinality
    )
    order by case
      when old_item.value ->> 'id' = v_new_line ->> 'id' then 0
      else 1
    end
    limit 1;

    v_result := v_result || pg_catalog.jsonb_build_array(
      case
        when v_old_line is null then v_new_line
        else private.finance_merge_human_accounting_line(v_old_line, v_new_line)
      end
    );
    v_old_line := null;
  end loop;

  -- A missing manually reviewed line must not disappear without a new audited
  -- human revision. Keep it at the end so the discrepancy remains visible.
  for v_old_line in
    select old_item.value
    from pg_catalog.jsonb_array_elements(p_old_lines)
      with ordinality old_item(value, ordinality)
    where private.finance_accounting_line_is_human(old_item.value)
      and not exists (
        select 1
        from pg_catalog.jsonb_array_elements(p_new_lines)
          with ordinality new_item(value, ordinality)
        where (
          coalesce(old_item.value ->> 'id', '') <> ''
          and new_item.value ->> 'id' = old_item.value ->> 'id'
        ) or (
          coalesce(old_item.value ->> 'id', '') = ''
          and new_item.ordinality = old_item.ordinality
        )
      )
    order by old_item.ordinality
  loop
    v_result := v_result || pg_catalog.jsonb_build_array(v_old_line);
  end loop;

  return v_result;
end;
$function$;

create or replace function private.finance_preserve_human_accounting_authority()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_old_lines jsonb := coalesce(old.form_payload -> 'accountingLines', '[]'::jsonb);
  v_new_lines jsonb := new.form_payload -> 'accountingLines';
  v_merged_lines jsonb;
  v_write_context text := coalesce(
    pg_catalog.current_setting('app.finance_expense_write_context', true),
    ''
  );
begin
  if tg_op <> 'UPDATE'
     or pg_catalog.jsonb_typeof(v_old_lines) <> 'array'
     or not exists (
       select 1
       from pg_catalog.jsonb_array_elements(v_old_lines) line_item(value)
       where private.finance_accounting_line_is_human(line_item.value)
     ) then
    return new;
  end if;

  if pg_catalog.jsonb_typeof(v_new_lines) = 'array' then
    v_merged_lines := private.finance_merge_human_accounting_lines(
      v_old_lines,
      v_new_lines
    );
  elsif v_write_context = 'active_step' then
    v_merged_lines := v_old_lines;
  else
    -- A legitimate new-evidence stage (for example procurement actual
    -- receipts) may intentionally rebuild accounting lines. The old values
    -- remain available in the request version/audit trail.
    return new;
  end if;

  if v_merged_lines is distinct from v_new_lines then
    new.form_payload := pg_catalog.jsonb_set(
      coalesce(new.form_payload, '{}'::jsonb),
      '{accountingLines}',
      v_merged_lines,
      true
    ) || pg_catalog.jsonb_build_object(
      'accountingLinePolicy', 'human_override_authoritative_v1',
      'accountingLinesPreservedForReview', true,
      'accountingLinesPreservedAt', pg_catalog.now()
    );
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(v_merged_lines) line_item(value)
    where private.finance_accounting_line_is_human(line_item.value)
      and (
        coalesce((line_item.value ->> 'netAmount')::numeric, 0) < 0
        or coalesce((line_item.value ->> 'taxAmount')::numeric, 0) < 0
        or coalesce((line_item.value ->> 'grossAmount')::numeric, 0) < 0
        or coalesce((line_item.value ->> 'netAmount')::numeric, 0)
           + coalesce((line_item.value ->> 'taxAmount')::numeric, 0)
           <> coalesce((line_item.value ->> 'grossAmount')::numeric, 0)
        or coalesce(line_item.value ->> 'debitAccount', '') = ''
        or coalesce(line_item.value ->> 'creditAccount', '') = ''
      )
  ) then
    raise exception '人工覆核的會計明細金額或借貸科目不完整，已停止保存'
      using errcode = '23514';
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_zz_finance_preserve_human_accounting_authority
  on public.expense_requests;
create trigger trg_zz_finance_preserve_human_accounting_authority
before update on public.expense_requests
for each row
execute function private.finance_preserve_human_accounting_authority();

create or replace function private.finance_sync_request_accounting_lines()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_lines jsonb := new.form_payload -> 'accountingLines';
  v_line jsonb;
  v_line_index integer;
  v_line_count integer := 0;
  v_old_lines jsonb := case
    when tg_op = 'UPDATE' then old.form_payload -> 'accountingLines'
    else null
  end;
begin
  if pg_catalog.jsonb_typeof(v_lines) = 'array' then
    v_line_count := pg_catalog.jsonb_array_length(v_lines);
    for v_line, v_line_index in
      select line_item.value, line_item.ordinality::integer
      from pg_catalog.jsonb_array_elements(v_lines)
        with ordinality line_item(value, ordinality)
      order by line_item.ordinality
    loop
      insert into public.application_accounting_lines (
        id,
        request_id,
        request_no,
        line_index,
        source,
        description,
        entity_id,
        department_code,
        gross_amount,
        net_amount,
        tax_amount,
        debit_account,
        debit_account_name,
        credit_account,
        credit_account_name,
        ai_reason,
        reviewed_by,
        reviewed_at,
        payload,
        data_environment
      ) values (
        new.id || '_' || v_line_index::text,
        new.id,
        new.no,
        v_line_index,
        coalesce(v_line ->> 'source', 'detail'),
        coalesce(v_line ->> 'description', ''),
        new.entity_id,
        coalesce(v_line ->> 'departmentCode', new.department_code),
        coalesce((v_line ->> 'grossAmount')::numeric, 0),
        coalesce((v_line ->> 'netAmount')::numeric, 0),
        coalesce((v_line ->> 'taxAmount')::numeric, 0),
        coalesce(v_line ->> 'debitAccount', ''),
        coalesce(v_line ->> 'debitAccountName', ''),
        coalesce(v_line ->> 'creditAccount', ''),
        coalesce(v_line ->> 'creditAccountName', ''),
        coalesce(v_line ->> 'aiReason', ''),
        coalesce(v_line ->> 'reviewedBy', ''),
        nullif(v_line ->> 'reviewedAt', '')::timestamptz,
        v_line,
        coalesce(new.data_environment, 'production')
      )
      on conflict (request_id, line_index) do update set
        request_no = excluded.request_no,
        source = excluded.source,
        description = excluded.description,
        entity_id = excluded.entity_id,
        department_code = excluded.department_code,
        gross_amount = excluded.gross_amount,
        net_amount = excluded.net_amount,
        tax_amount = excluded.tax_amount,
        debit_account = excluded.debit_account,
        debit_account_name = excluded.debit_account_name,
        credit_account = excluded.credit_account,
        credit_account_name = excluded.credit_account_name,
        ai_reason = excluded.ai_reason,
        reviewed_by = excluded.reviewed_by,
        reviewed_at = excluded.reviewed_at,
        payload = excluded.payload,
        data_environment = excluded.data_environment,
        updated_at = pg_catalog.now();
    end loop;
  end if;

  delete from public.application_accounting_lines accounting_line
  where accounting_line.request_id = new.id
    and accounting_line.line_index > v_line_count;

  if v_lines is distinct from v_old_lines
     and pg_catalog.jsonb_typeof(v_lines) = 'array'
     and exists (
       select 1
       from pg_catalog.jsonb_array_elements(v_lines) line_item(value)
       where private.finance_accounting_line_is_human(line_item.value)
     ) then
    insert into public.module_audit_logs (
      table_name,
      row_id,
      action,
      actor_email,
      before_data,
      after_data
    ) values (
      'application_accounting_lines',
      new.id,
      'HUMAN_ACCOUNTING_SYNC',
      auth.jwt() ->> 'email',
      v_old_lines,
      v_lines
    );
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_zz_finance_sync_request_accounting_lines
  on public.expense_requests;
create trigger trg_zz_finance_sync_request_accounting_lines
after insert or update of form_payload on public.expense_requests
for each row
execute function private.finance_sync_request_accounting_lines();

comment on function private.finance_preserve_human_accounting_authority()
is 'Preserves audited human accounting amounts and subjects against AI/rule overwrites and workflow returns.';

comment on function private.finance_sync_request_accounting_lines()
is 'Atomically synchronizes expense request accountingLines into application_accounting_lines and records human-review audit snapshots.';

do $postflight$
begin
  if pg_catalog.to_regprocedure('private.finance_accounting_manual_fields(jsonb)') is null
     or pg_catalog.to_regprocedure('private.finance_accounting_line_is_human(jsonb)') is null
     or pg_catalog.to_regprocedure('private.finance_merge_human_accounting_line(jsonb,jsonb)') is null
     or pg_catalog.to_regprocedure('private.finance_merge_human_accounting_lines(jsonb,jsonb)') is null
     or pg_catalog.to_regprocedure('private.finance_preserve_human_accounting_authority()') is null
     or pg_catalog.to_regprocedure('private.finance_sync_request_accounting_lines()') is null then
    raise exception using
      errcode = '55000',
      message = 'Human accounting authority postflight did not install every required function';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_trigger trigger_info
    join pg_catalog.pg_class relation_info on relation_info.oid = trigger_info.tgrelid
    join pg_catalog.pg_namespace namespace_info on namespace_info.oid = relation_info.relnamespace
    where namespace_info.nspname = 'public'
      and relation_info.relname = 'expense_requests'
      and trigger_info.tgname = 'trg_zz_finance_preserve_human_accounting_authority'
      and not trigger_info.tgisinternal
  ) or not exists (
    select 1
    from pg_catalog.pg_trigger trigger_info
    join pg_catalog.pg_class relation_info on relation_info.oid = trigger_info.tgrelid
    join pg_catalog.pg_namespace namespace_info on namespace_info.oid = relation_info.relnamespace
    where namespace_info.nspname = 'public'
      and relation_info.relname = 'expense_requests'
      and trigger_info.tgname = 'trg_zz_finance_sync_request_accounting_lines'
      and not trigger_info.tgisinternal
  ) then
    raise exception using
      errcode = '55000',
      message = 'Human accounting authority postflight did not install both request triggers';
  end if;
end;
$postflight$;

notify pgrst, 'reload schema';
