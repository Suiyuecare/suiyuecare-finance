-- Reject generic approval/countersign at purchase-specific data-entry gates.
-- No document, file ownership, accounting rule, grant or trigger is changed.
-- Reviewed against production function source on 2026-10-05. Fail closed on drift.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $procurement_action_guard$
declare
  v_oid oid := 'public.finance_expense_act_active_step(text[],text,text,text,jsonb,text,jsonb,jsonb,text)'::regprocedure::oid;
  v_definition text;
  v_source text;
  v_expected text;
  v_acl aclitem[];
  v_anchor constant text := $anchor$    v_patch := coalesce(p_patches -> v_request_id, '{}'::jsonb);$anchor$;
  v_replacement constant text := $anchor$    -- procurement_specialized_action_guard_v1: these gates must persist their
    -- validated payment / actual receipt payload through the dedicated handler.
    -- Generic approve and approve-with-countersign cannot supply that payload.
    if coalesce(v_expense.type, '') = 'purchase_request'
       and v_role_key in (
         'procurement_payment',
         'procurement_receipt',
         'procurement_review'
       )
       and v_action in ('approve', 'add_sign') then
      raise exception
        '採購付款資料與憑據必須使用總務專用送出功能，不可直接核准或加簽：%',
        v_request_id
        using errcode = '55000',
              detail = 'PROCUREMENT_SPECIALIZED_SUBMISSION_REQUIRED';
    end if;

    v_patch := coalesce(p_patches -> v_request_id, '{}'::jsonb);$anchor$;
begin
  select pg_catalog.pg_get_functiondef(p.oid), p.prosrc, p.proacl
    into v_definition, v_source, v_acl
  from pg_catalog.pg_proc p
  where p.oid = v_oid
    and pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
    and p.prosecdef
    and p.proconfig = array['search_path=""']::text[];
  if v_definition is null or pg_catalog.encode(extensions.digest(v_source::bytea, 'sha256'), 'hex')
      <> '5c3fbeba07cd9ed76627425d61f678dec22aa2adb3833736b546e08d710d82fb' then
    raise exception 'Procurement action guard differs from the reviewed production baseline';
  end if;
  if (pg_catalog.length(v_source) - pg_catalog.length(pg_catalog.replace(v_source, v_anchor, '')))
      / pg_catalog.length(v_anchor) <> 1 then
    raise exception 'Procurement action guard anchor is missing or duplicated';
  end if;
  v_expected := pg_catalog.replace(v_source, v_anchor, v_replacement);
  if pg_catalog.encode(extensions.digest(v_expected::bytea, 'sha256'), 'hex')
      <> '060fc08af5f4002c017694cbaa572f6976964054c92be5265511a0dcb5f0067f' then
    raise exception 'Procurement action guard generated an unreviewed definition';
  end if;
  execute pg_catalog.replace(v_definition, v_source, v_expected);
  if not exists (
    select 1 from pg_catalog.pg_proc p where p.oid = v_oid
      and p.prosrc = v_expected and p.proacl is not distinct from v_acl
      and pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
      and p.prosecdef and p.proconfig = array['search_path=""']::text[]
  ) then
    raise exception 'Procurement action guard postflight failed';
  end if;
end;
$procurement_action_guard$;
