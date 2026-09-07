-- F01: permit only a JSON false preservation marker at exact procurement gates.
-- F06: compare and append a value-bound human event, independent of UI history
-- length. These changes do not grant an actor permission to edit a request.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $procurement_contract$
declare
  v_oid oid := 'private.finance_expense_guard_direct_update()'::regprocedure::oid;
  v_definition text;
  v_source text;
  v_expected text;
  v_acl aclitem[];
  v_old_keys constant text := $anchor$        'accountingLines',
        'accountingLinesNeedReview',$anchor$;
  v_new_keys constant text := $anchor$        'accountingLines',
        'accountingLinesPreservedForReview',
        'accountingLinesNeedReview',$anchor$;
  v_old_guard constant text := $anchor$       or coalesce(new.form_payload, '{}'::jsonb) ?
          'accountingLines'$anchor$;
  v_new_guard constant text := $anchor$       or (
         (
           coalesce(old.form_payload, '{}'::jsonb) ? 'accountingLinesPreservedForReview'
           or coalesce(new.form_payload, '{}'::jsonb) ? 'accountingLinesPreservedForReview'
         )
         and (new.form_payload -> 'accountingLinesPreservedForReview')
           is distinct from 'false'::jsonb
       )
       or coalesce(new.form_payload, '{}'::jsonb) ?
          'accountingLines'$anchor$;
begin
  select pg_catalog.pg_get_functiondef(p.oid), p.prosrc, p.proacl
    into v_definition, v_source, v_acl
  from pg_catalog.pg_proc p
  where p.oid = v_oid
    and pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
    and p.prosecdef
    and p.proconfig = array['search_path=""']::text[];
  if v_definition is null or pg_catalog.encode(extensions.digest(v_source::bytea, 'sha256'), 'hex')
      <> '6e28da9898c46d97b3a41fa8cc250a18f068b4264047bfe1d04b46a8fdc10287' then
    raise exception 'F01 procurement guard differs from the reviewed production baseline';
  end if;
  if (pg_catalog.length(v_source) - pg_catalog.length(pg_catalog.replace(v_source, v_old_keys, '')))
      / pg_catalog.length(v_old_keys) <> 2
     or (pg_catalog.length(v_source) - pg_catalog.length(pg_catalog.replace(v_source, v_old_guard, '')))
      / pg_catalog.length(v_old_guard) <> 1 then
    raise exception 'F01 procurement guard anchors are missing or duplicated';
  end if;
  v_expected := pg_catalog.replace(pg_catalog.replace(v_source, v_old_keys, v_new_keys), v_old_guard, v_new_guard);
  execute pg_catalog.replace(v_definition, v_source, v_expected);
  if not exists (
    select 1 from pg_catalog.pg_proc p where p.oid = v_oid
      and p.prosrc = v_expected and p.proacl is not distinct from v_acl
      and pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
      and p.prosecdef and p.proconfig = array['search_path=""']::text[]
  ) then
    raise exception 'F01 procurement guard postflight failed';
  end if;
end;
$procurement_contract$;

-- Pure concurrency/audit validation, NOT authorization. Only already guarded
-- request transactions can persist accounting fields. No client role can call
-- this private helper directly. An old 50-event UI may send the saved tail plus
-- one event; the merge below restores the complete database-owned history.
create or replace function private.finance_accounting_human_event_is_fresh_v2(
  p_old_line jsonb,
  p_new_line jsonb
)
returns boolean
language plpgsql
immutable
set search_path = ''
as $function$
declare
  v_old_history jsonb := coalesce(p_old_line -> 'manualOverrideHistory', '[]'::jsonb);
  v_new_history jsonb := coalesce(p_new_line -> 'manualOverrideHistory', '[]'::jsonb);
  v_old_count integer;
  v_new_count integer;
  v_event jsonb;
  v_offset integer;
  v_index integer;
  v_field text;
  v_changed integer := 0;
  v_fields constant text[] := array['netAmount','taxAmount','grossAmount','debitAccount','creditAccount'];
begin
  if not private.finance_accounting_line_is_human(p_new_line)
     or pg_catalog.jsonb_typeof(v_old_history) is distinct from 'array'
     or pg_catalog.jsonb_typeof(v_new_history) is distinct from 'array' then
    return false;
  end if;
  v_old_count := pg_catalog.jsonb_array_length(v_old_history);
  v_new_count := pg_catalog.jsonb_array_length(v_new_history);
  if not (v_new_count = v_old_count + 1 or (v_new_count = 50 and v_old_count >= 50)) then
    return false;
  end if;
  v_offset := v_old_count - (v_new_count - 1);
  if v_new_count > 1 then
    for v_index in 0..v_new_count - 2 loop
      if v_new_history -> v_index is distinct from v_old_history -> (v_offset + v_index) then
        return false;
      end if;
    end loop;
  end if;
  v_event := v_new_history -> (v_new_count - 1);
  if pg_catalog.jsonb_typeof(v_event) is distinct from 'object'
     or pg_catalog.jsonb_typeof(v_event -> 'changes') is distinct from 'object'
     or pg_catalog.jsonb_typeof(v_event -> 'actor') is distinct from 'object'
     or coalesce(v_event #>> '{actor,id}', '') = ''
     or coalesce(v_event ->> 'at', '') = ''
     or coalesce(v_event ->> 'source', '') = ''
     or (v_event -> 'actor') is distinct from (p_new_line -> 'manualOverrideBy')
     or (v_event -> 'at') is distinct from (p_new_line -> 'manualOverrideAt')
     or (v_event -> 'source') is distinct from (p_new_line -> 'manualOverrideSource') then
    return false;
  end if;
  if exists (
    select 1 from pg_catalog.jsonb_array_elements(v_old_history) old_event(value)
    where old_event.value = v_event
       or (coalesce(v_event ->> 'operationId', '') <> ''
           and old_event.value ->> 'operationId' = v_event ->> 'operationId')
  ) then
    return false;
  end if;
  -- New clients send the entire five-field before/after image. It binds a
  -- change to the exact current values even if an unrelated field also moved.
  if (v_event ? 'beforeValues') or (v_event ? 'afterValues') then
    if pg_catalog.jsonb_typeof(v_event -> 'beforeValues') is distinct from 'object'
       or pg_catalog.jsonb_typeof(v_event -> 'afterValues') is distinct from 'object' then
      return false;
    end if;
    foreach v_field in array v_fields loop
      if (v_event #> array['beforeValues',v_field]) is distinct from (p_old_line -> v_field)
         or (v_event #> array['afterValues',v_field]) is distinct from (p_new_line -> v_field) then
        return false;
      end if;
    end loop;
  end if;
  foreach v_field in array v_fields loop
    if (p_old_line -> v_field) is distinct from (p_new_line -> v_field) then
      v_changed := v_changed + 1;
      if not (v_field = any(private.finance_accounting_manual_fields(p_new_line)))
         or (v_event #> array['changes',v_field,'before']) is distinct from (p_old_line -> v_field)
         or (v_event #> array['changes',v_field,'after']) is distinct from (p_new_line -> v_field) then
        return false;
      end if;
    end if;
  end loop;
  for v_field in select pg_catalog.jsonb_object_keys(v_event -> 'changes') loop
    if not (v_field = any(v_fields))
       or not (v_field = any(private.finance_accounting_manual_fields(p_new_line)))
       or (v_event #> array['changes',v_field,'before']) is distinct from (p_old_line -> v_field)
       or (v_event #> array['changes',v_field,'after']) is distinct from (p_new_line -> v_field) then
      return false;
    end if;
  end loop;
  -- Selecting the current value explicitly is still a human confirmation; a
  -- metadata-only append with an empty changes object is not one.
  return v_changed > 0 or (v_event -> 'changes') <> '{}'::jsonb;
end;
$function$;

revoke all on function private.finance_accounting_human_event_is_fresh_v2(jsonb,jsonb)
  from public, anon, authenticated, service_role;

do $human_event_contract$
declare
  v_oid oid := 'private.finance_merge_human_accounting_line(jsonb,jsonb)'::regprocedure::oid;
  v_definition text;
  v_source text;
  v_expected text;
  v_acl aclitem[];
  v_old_fresh constant text := $anchor$  v_new_has_fresh_human_audit :=
    private.finance_accounting_line_is_human(p_new_line)
    and v_new_history_length > v_old_history_length;$anchor$;
  v_new_fresh constant text := $anchor$  v_new_has_fresh_human_audit :=
    private.finance_accounting_human_event_is_fresh_v2(p_old_line, p_new_line);
  if not v_new_has_fresh_human_audit
     and private.finance_accounting_line_is_human(p_new_line)
     and exists (
       select 1 from pg_catalog.unnest(v_new_fields) changed_field(name)
       where (p_old_line -> changed_field.name) is distinct from (p_new_line -> changed_field.name)
     ) then
    raise exception '人工覆核版本已更新或修訂紀錄不完整；請保留目前輸入，重新載入最新版本後再套用修改'
      using errcode = '40001', detail = 'HUMAN_ACCOUNTING_REVISION_CONFLICT';
  end if;$anchor$;
  v_old_history constant text := $anchor$      when v_new_has_fresh_human_audit then coalesce(p_new_line -> 'manualOverrideHistory', '[]'::jsonb)$anchor$;
  v_new_history constant text := $anchor$      when v_new_has_fresh_human_audit then
        coalesce(p_old_line -> 'manualOverrideHistory', '[]'::jsonb)
        || pg_catalog.jsonb_build_array(p_new_line -> 'manualOverrideHistory' -> -1)$anchor$;
begin
  select pg_catalog.pg_get_functiondef(p.oid), p.prosrc, p.proacl
    into v_definition, v_source, v_acl
  from pg_catalog.pg_proc p
  where p.oid = v_oid and pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
    and not p.prosecdef and p.proconfig = array['search_path=""']::text[];
  if v_definition is null or pg_catalog.encode(extensions.digest(v_source::bytea, 'sha256'), 'hex')
      <> '69b97c327bd84888d70a0b9a1e00eca081921a083fcec09fd3c2d6d1d6917400' then
    raise exception 'F06 human merge differs from the reviewed production baseline';
  end if;
  if (pg_catalog.length(v_source) - pg_catalog.length(pg_catalog.replace(v_source, v_old_fresh, '')))
      / pg_catalog.length(v_old_fresh) <> 1
     or (pg_catalog.length(v_source) - pg_catalog.length(pg_catalog.replace(v_source, v_old_history, '')))
      / pg_catalog.length(v_old_history) <> 1 then
    raise exception 'F06 human merge anchors are missing or duplicated';
  end if;
  v_expected := pg_catalog.replace(pg_catalog.replace(v_source, v_old_fresh, v_new_fresh), v_old_history, v_new_history);
  execute pg_catalog.replace(v_definition, v_source, v_expected);
  if not exists (
    select 1 from pg_catalog.pg_proc p where p.oid = v_oid
      and p.prosrc = v_expected and p.proacl is not distinct from v_acl
      and pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
      and not p.prosecdef and p.proconfig = array['search_path=""']::text[]
  ) then
    raise exception 'F06 human merge postflight failed';
  end if;
end;
$human_event_contract$;
