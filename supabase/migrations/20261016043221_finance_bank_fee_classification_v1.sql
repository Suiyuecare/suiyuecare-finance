-- Correct only bank classification during an authorized applicant revision.
-- Existing documents, bank fees, authorization, route checks and audit history
-- are untouched. Stored fees remain authoritative until a real revision action.
do $bank_fee_classification_patch$
declare
  v_oid oid := 'private.finance_expense_resubmit_applicant_revision_v1_unsafe(text,text,text,integer,timestamptz,integer,text,jsonb,jsonb,text)'::regprocedure;
  v_definition text; v_acl aclitem[]; v_owner oid; v_config text[];
  v_wrapper_md5 text;
  v_old_hr text := $old_hr$        and not (
          pg_catalog.regexp_replace(
            coalesce(
              detail_row ->> '銀行代號',
              detail_row ->> 'bank_code',
              ''
            ),
            '[^0-9]',
            '',
            'g'
          ) like '017%'
          or pg_catalog.concat_ws(
               ' ',
               detail_row ->> '銀行別',
               detail_row ->> '銀行',
               detail_row ->> 'bank_name'
             ) like '%兆豐%'
          or (
            pg_catalog.btrim(pg_catalog.concat_ws(
              '',
              detail_row ->> '銀行代號',
              detail_row ->> 'bank_code',
              detail_row ->> '銀行別',
              detail_row ->> '銀行',
              detail_row ->> 'bank_name'
            )) = ''
            and coalesce(p_form_patch ->> 'bank_type', '') = 'mega'
          )
        );$old_hr$;
  v_new_hr text := $new_hr$        and not (
          -- finance_bank_fee_classification_v1: negative bank labels must not
          -- match the positive Mega name. Keep per-row banks authoritative.
          case
            when pg_catalog.concat_ws(' ', detail_row ->> '銀行代號',
                   detail_row ->> 'bank_code', detail_row ->> '銀行別',
                   detail_row ->> '銀行', detail_row ->> 'bank_name')
                 ~* '(非|不是)[[:space:]]*兆豐|\mnon[[:space:]-]*mega\M'
              then false
            when pg_catalog.regexp_replace(coalesce(
                   detail_row ->> '銀行代號', detail_row ->> 'bank_code', ''),
                   '[^0-9]', '', 'g') like '017%'
              or pg_catalog.concat_ws(' ', detail_row ->> '銀行別',
                   detail_row ->> '銀行', detail_row ->> 'bank_name')
                 ~* '兆豐|\mmega\M|(^|[^0-9])017([^0-9]|$)'
              then true
            when pg_catalog.btrim(pg_catalog.concat_ws('',
                   detail_row ->> '銀行代號', detail_row ->> 'bank_code',
                   detail_row ->> '銀行別', detail_row ->> '銀行',
                   detail_row ->> 'bank_name')) = ''
              then pg_catalog.lower(pg_catalog.btrim(coalesce(
                   p_form_patch ->> 'bank_type', ''))) = 'mega'
            else false
          end
        );$new_hr$;
  v_old_bank text := $old_bank$          or coalesce(p_form_patch ->> 'bank_type', '') = 'mega'
          or coalesce(p_form_patch ->> 'bank_name', '') like '%兆豐%'
          or coalesce(p_form_patch ->> 'bank_name', '') ~
               '(^|[^0-9])017([^0-9]|$)'$old_bank$;
  v_new_bank text := $new_bank$          or case
            when pg_catalog.lower(pg_catalog.btrim(coalesce(
                   p_form_patch ->> 'bank_type', ''))) = 'mega' then true
            when pg_catalog.lower(pg_catalog.btrim(coalesce(
                   p_form_patch ->> 'bank_type', ''))) = 'other' then false
            when pg_catalog.concat_ws(' ', p_form_patch ->> 'bank_name',
                   p_form_patch ->> 'bank_account')
                 ~* '(非|不是)[[:space:]]*兆豐|\mnon[[:space:]-]*mega\M'
              then false
            else pg_catalog.concat_ws(' ', p_form_patch ->> 'bank_name',
                   p_form_patch ->> 'bank_account')
                 ~* '兆豐|\mmega\M|(^|[^0-9])017([^0-9]|$)'
          end$new_bank$;
begin
  select pg_get_functiondef(oid),proacl,proowner,proconfig
    into v_definition,v_acl,v_owner,v_config from pg_proc
    where oid=v_oid and prosecdef and provolatile='v';
  select md5(pg_get_functiondef('public.finance_expense_resubmit_applicant_revision(text,text,text,integer,timestamptz,integer,text,jsonb,jsonb,text)'::regprocedure)) into v_wrapper_md5;
  if md5(v_definition) is distinct from '5dedbec02d1440f855c69cdab2684515'
     or pg_get_userbyid(v_owner) is distinct from 'postgres'
     or v_config is distinct from array['search_path=""']::text[]
     or v_wrapper_md5 is distinct from '6af47c58cd50b60f0a500ac8221a57e3'
     or has_function_privilege('anon',v_oid,'EXECUTE')
     or has_function_privilege('authenticated',v_oid,'EXECUTE')
     or has_function_privilege('service_role',v_oid,'EXECUTE') then
    raise exception 'Bank fee classification requires the exact reviewed revision baseline' using errcode='55000';
  end if;
  if (length(v_definition)-length(replace(v_definition,v_old_hr,'')))/length(v_old_hr) <> 1
     or (length(v_definition)-length(replace(v_definition,v_old_bank,'')))/length(v_old_bank) <> 1 then
    raise exception 'Bank fee classification anchors must occur exactly once' using errcode='55000';
  end if;
  v_definition:=replace(replace(v_definition,v_old_hr,v_new_hr),v_old_bank,v_new_bank);
  if md5(v_definition) is distinct from 'ccaad5b351be270e9597a02271518585' then
    raise exception 'Bank fee classification candidate differs from reviewed body' using errcode='55000';
  end if;
  execute v_definition;
  if not exists(select 1 from pg_proc where oid=v_oid
      and md5(pg_get_functiondef(oid))='ccaad5b351be270e9597a02271518585'
      and proacl is not distinct from v_acl and proowner=v_owner
      and prosecdef and provolatile='v' and proconfig is not distinct from v_config)
     or md5(pg_get_functiondef('public.finance_expense_resubmit_applicant_revision(text,text,text,integer,timestamptz,integer,text,jsonb,jsonb,text)'::regprocedure)) is distinct from v_wrapper_md5 then
    raise exception 'Bank fee classification altered unrelated authority or wrapper' using errcode='55000';
  end if;
end;
$bank_fee_classification_patch$;
