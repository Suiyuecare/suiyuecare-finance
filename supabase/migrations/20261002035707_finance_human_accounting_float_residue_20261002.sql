-- Allow only IEEE-754 serialization residue in previously human-reviewed lines.
-- The stored human amounts, accounts, metadata, and audit trail remain unchanged.
-- A 0.000000001 absolute tolerance is far below the smallest cent and below
-- the three-decimal detail amounts already present in historical requests.
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
    -- New evidence can intentionally rebuild lines; old values remain in audit.
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
        or pg_catalog.abs(
          coalesce((line_item.value ->> 'netAmount')::numeric, 0)
          + coalesce((line_item.value ->> 'taxAmount')::numeric, 0)
          - coalesce((line_item.value ->> 'grossAmount')::numeric, 0)
        ) > 0.000000001::numeric
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

comment on function private.finance_preserve_human_accounting_authority()
is 'Preserve audited human accounting values on workflow updates; reject negative, materially unbalanced (>1e-9), or accountless human lines while tolerating historical IEEE-754 serialization residue without modifying stored amounts.';
