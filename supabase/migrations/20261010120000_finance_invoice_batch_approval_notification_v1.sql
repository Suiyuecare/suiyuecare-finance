-- Preserve the existing one-event-per-assignment queue and its first-invoice
-- direct link. A batch submit inserts invoices one row at a time, so the first
-- row's notification cannot know the final count or gross amount yet. This
-- later AFTER ROW trigger refreshes only the pending event inside that same
-- transaction; the worker cannot claim the event until the batch commits.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $preflight$
declare
  v_enqueue oid := pg_catalog.to_regprocedure('private.finance_enqueue_current_approval_email()')::oid;
begin
  if pg_catalog.to_regclass('public.invoices') is null
     or pg_catalog.to_regclass('public.notification_delivery_events') is null
     or pg_catalog.to_regclass('private.approval_notification_assignment_state') is null
     or v_enqueue is null
     or pg_catalog.to_regprocedure('private.finance_refresh_invoice_batch_approval_notification_v1()') is not null
     or exists (
       select 1 from pg_catalog.pg_trigger t
       where t.tgrelid = 'public.invoices'::pg_catalog.regclass
         and t.tgname = 'trg_zz_invoices_refresh_batch_approval_notification_v1'
     )
     or not exists (
       select 1 from pg_catalog.pg_proc p
       where p.oid = v_enqueue
         and pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
         and p.prosecdef
         and pg_catalog.md5(p.prosrc) = 'ebae3a8045744a11bfa2892f04d80f2f'
     )
     or not exists (
       select 1 from pg_catalog.pg_trigger t
       where t.tgrelid = 'public.invoices'::pg_catalog.regclass
         and t.tgname = 'trg_invoices_enqueue_approval_email'
         and t.tgenabled = 'O'
         and t.tgtype = 21 -- AFTER INSERT OR UPDATE, FOR EACH ROW
         and t.tgfoid = v_enqueue
     ) then
    raise exception 'Invoice batch notification source or trigger drifted; review before installation'
      using errcode = '55000';
  end if;
end;
$preflight$;

create function private.finance_refresh_invoice_batch_approval_notification_v1()
returns trigger
language plpgsql security definer set search_path = ''
as $refresh$
declare
  v_batch_id text := nullif(pg_catalog.btrim(new.batch_id), '');
  v_invoice_count bigint;
  v_total_count bigint;
  v_gross_total numeric;
  v_gross_display text;
begin
  if v_batch_id is null or new.data_environment <> 'production' then
    return new;
  end if;

  -- This scope is identical to the enqueue trigger's tenant/environment/group
  -- identity. Never total a sibling from another tenant or environment.
  select pg_catalog.count(*), pg_catalog.count(i.total), pg_catalog.sum(i.total)
  into v_invoice_count, v_total_count, v_gross_total
  from public.invoices i
  where i.tenant_id = new.tenant_id
    and i.data_environment = new.data_environment
    and i.batch_id = v_batch_id;

  -- The canonical submit RPC validates every gross total. An incomplete
  -- legacy row must never be presented as a confirmed gross batch amount.
  if v_invoice_count < 2 or v_total_count <> v_invoice_count then
    return new;
  end if;

  v_gross_display := pg_catalog.regexp_replace(
    pg_catalog.to_char(v_gross_total, 'FM999,999,999,999,999,999,990.00'),
    '[.]00$', ''
  );

  update public.notification_delivery_events e
  set title = '待您簽核｜開立發票 ' || v_invoice_count::text || ' 張・NT$'
      || v_gross_display || '｜'
      || coalesce(nullif(e.payload ->> 'approval_role_label', ''), '簽核人'),
      body = coalesce(nullif(e.payload ->> 'recipient_name', ''), '同仁')
      || '您好，您已收到一批開立發票簽核待辦，共 ' || v_invoice_count::text
      || ' 張，含稅總額 NT$' || v_gross_display || '。批次編號：' || v_batch_id
      || '。目前關卡為「'
      || coalesce(nullif(e.payload ->> 'approval_role_label', ''), '簽核人')
      || '」。請登入歲悅財務系統檢視並簽核整批，以利流程進入下一關。',
      payload = e.payload || pg_catalog.jsonb_build_object(
        'batch_count', v_invoice_count,
        'batch_total', v_gross_total::text,
        'amount', v_gross_total::text,
        'amount_kind', 'gross_batch_total'
      )
  from private.approval_notification_assignment_state s
  where s.tenant_id = new.tenant_id
    and s.data_environment = new.data_environment
    and s.source_table = 'invoices'
    and s.source_group_id = v_batch_id
    and s.notification_event_id = e.id
    and e.tenant_id = new.tenant_id
    and e.data_environment = new.data_environment
    and e.event_type = 'approval_task_assigned'
    and e.status = 'pending'
    and e.payload ->> 'source_table' = 'invoices'
    and e.payload ->> 'source_group_id' = v_batch_id
    and e.payload ->> 'source_id' = s.source_record_id
    and e.payload ->> 'source_no' = e.request_id
    and e.payload ->> 'recipient_finance_user_id' = s.recipient_finance_user_id;

  return new;
end;
$refresh$;

alter function private.finance_refresh_invoice_batch_approval_notification_v1()
  owner to postgres;
revoke all on function private.finance_refresh_invoice_batch_approval_notification_v1()
  from public, anon, authenticated, service_role;

-- PostgreSQL fires triggers of the same kind in name order. This name runs
-- after trg_invoices_enqueue_approval_email, including bulk INSERT statements.
create trigger trg_zz_invoices_refresh_batch_approval_notification_v1
after insert or update of status, approval_status, approval_step, steps,
  batch_id, amount, tax, total
on public.invoices
for each row execute function private.finance_refresh_invoice_batch_approval_notification_v1();

comment on function private.finance_refresh_invoice_batch_approval_notification_v1()
  is 'Refresh an unsent invoice-batch approval notification with authorized batch count and gross total while preserving its first-invoice deep link.';
comment on trigger trg_zz_invoices_refresh_batch_approval_notification_v1 on public.invoices
  is 'Runs after the approval enqueue trigger; the last invoice row gives the pending event its final batch total before commit.';

do $postflight$
declare
  v_refresh oid := pg_catalog.to_regprocedure('private.finance_refresh_invoice_batch_approval_notification_v1()')::oid;
begin
  if v_refresh is null
     or not exists (
       select 1 from pg_catalog.pg_proc p
       where p.oid = v_refresh
         and pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
         and p.prosecdef
         and p.proconfig = array['search_path=""']::text[]
     )
     or not exists (
       select 1 from pg_catalog.pg_trigger t
       where t.tgrelid = 'public.invoices'::pg_catalog.regclass
         and t.tgname = 'trg_zz_invoices_refresh_batch_approval_notification_v1'
         and t.tgenabled = 'O'
         and t.tgtype = 21
         and t.tgfoid = v_refresh
     )
     or pg_catalog.has_function_privilege('anon', v_refresh, 'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated', v_refresh, 'EXECUTE')
     or pg_catalog.has_function_privilege('service_role', v_refresh, 'EXECUTE')
     or exists (
       select 1 from pg_catalog.pg_proc p,
         pg_catalog.aclexplode(coalesce(p.proacl,
           pg_catalog.acldefault('f', p.proowner))) acl
       where p.oid = v_refresh
         and acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
     ) then
    raise exception 'Invoice batch notification trigger or authority installation incomplete'
      using errcode = '23514';
  end if;
end;
$postflight$;
