-- The eighth-step GA actual amount and receipt are the only source of the
-- purchase principal finalized by the ninth-step accountant. A one-cent
-- tolerance previously let the RPC replace that amount before posting.
-- Patch only the reviewed production finalizer; do not rewrite old requests.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $purchase_final_amount_exact_lock$
declare
  v_oid oid := 'public.finalize_expense_request(text,text,integer,jsonb,numeric,numeric,text,text,text,jsonb,numeric,text,date,jsonb)'::regprocedure::oid;
  v_definition text;
  v_original_source text;
  v_source text;
  v_updated_definition text;
  v_acl aclitem[];
  v_index integer;
  v_old constant text[] := array[
    $anchor$pg_catalog.abs(p_amount - v_locked_actual_amount) > 0.01$anchor$,
    $anchor$pg_catalog.abs(
         (
           p_form_payload ->> 'purchaseFinalizedAmount'
         )::numeric - v_locked_actual_amount
       ) > 0.01$anchor$,
    $anchor$pg_catalog.abs(
           (
             v_request.form_payload
               -> 'purchaseActual'
               ->> 'actualAmount'
           )::numeric - v_locked_actual_amount
         ) > 0.01$anchor$,
    $anchor$when request_row.type in (
             'advance_request',
             'purchase_request'
           ) then p_amount
           else request_row.actual_amount$anchor$
  ];
  v_new constant text[] := array[
    $anchor$p_amount IS DISTINCT FROM v_locked_actual_amount$anchor$,
    $anchor$(
           p_form_payload ->> 'purchaseFinalizedAmount'
         )::numeric IS DISTINCT FROM v_locked_actual_amount$anchor$,
    $anchor$(
             v_request.form_payload
               -> 'purchaseActual'
               ->> 'actualAmount'
           )::numeric IS DISTINCT FROM v_locked_actual_amount$anchor$,
    $anchor$when request_row.type = 'purchase_request'
             then v_locked_actual_amount
           when request_row.type = 'advance_request'
             then p_amount
           else request_row.actual_amount$anchor$
  ];
begin
  select pg_catalog.pg_get_functiondef(p.oid), p.prosrc, p.proacl
    into v_definition, v_original_source, v_acl
  from pg_catalog.pg_proc p
  where p.oid = v_oid
    and pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
    and p.prosecdef
    and p.proconfig = array['search_path=""']::text[];

  if v_definition is null
     or pg_catalog.md5(v_definition) <> '5a205c5dab0c9a521f09f2dc2c053be6'
     or v_original_source not like '%private.finance_finalize_accounting_patch_v1(%'
     or v_original_source not like '%private.finance_assert_utility_posting_v1(%' then
    raise exception 'Purchase final amount lock differs from the reviewed production finalizer';
  end if;

  v_source := v_original_source;
  for v_index in 1..pg_catalog.array_length(v_old, 1) loop
    if (pg_catalog.length(v_source) - pg_catalog.length(pg_catalog.replace(v_source, v_old[v_index], '')))
        / pg_catalog.length(v_old[v_index]) <> 1 then
      raise exception 'Purchase final amount anchor % is missing or duplicated', v_index;
    end if;
    v_source := pg_catalog.replace(v_source, v_old[v_index], v_new[v_index]);
  end loop;
  v_updated_definition := pg_catalog.replace(v_definition, v_original_source, v_source);
  if pg_catalog.md5(v_updated_definition) <> '3f0bbc58dfcca1a293bc1abb4cefbdb4' then
    raise exception 'Purchase final amount generated an unreviewed finalizer';
  end if;

  execute v_updated_definition;
  if not exists (
    select 1 from pg_catalog.pg_proc p
    where p.oid = v_oid
      and p.prosrc = v_source
      and p.proacl is not distinct from v_acl
      and pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
      and p.prosecdef
      and p.proconfig = array['search_path=""']::text[]
  ) then
    raise exception 'Purchase final amount lock postflight failed';
  end if;
end;
$purchase_final_amount_exact_lock$;
