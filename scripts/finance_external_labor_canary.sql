-- Read-only promotion proof. No lecturer/employee identity, payroll, or accounting writes.
begin isolation level repeatable read read only;
set local lock_timeout='5s';
set local statement_timeout='20s';
-- FINANCE_AUTHENTICATED_CANARY_CORE_BEGIN
do $finance_external_labor_canary$ declare role_name text;begin
 if auth.uid() is not null or current_user in('anon','authenticated','service_role') then
  raise exception 'External labor canary cannot borrow a user identity';end if;
 if not exists(select 1 from pg_trigger where tgrelid='public.expense_requests'::regclass
  and tgname='finance_labor_request_guard_v1' and tgenabled='O')
  or (select count(*) from pg_trigger where tgname='finance_labor_legacy_book_v1'
   and tgrelid in('public.vouchers'::regclass,'public.ledger_entries'::regclass) and tgenabled='O')<>2
  or (select count(*) from pg_trigger where tgname='finance_labor_atomic_post_v1'
   and tgrelid in('public.vouchers'::regclass,'public.ledger_entries'::regclass) and tgenabled='O')<>2 then
  raise exception 'External labor legacy finalization or posting seal changed';end if;
 foreach role_name in array array['anon','authenticated'] loop
  if has_function_privilege(role_name,'public.finance_labor_guest_lookup_v1(text)','execute')
   or has_function_privilege(role_name,'public.finance_labor_guest_submit_v1(text,integer,uuid,jsonb,jsonb,text)','execute')
   or has_table_privilege(role_name,'private.finance_labor_statements_v1','SELECT') then
   raise exception 'External labor guest privacy boundary changed';end if;
 end loop;
 if not has_function_privilege('service_role','public.finance_labor_guest_lookup_v1(text)','execute')
  or has_function_privilege('service_role','public.finance_labor_staff_archive_repair_v1(uuid)','execute')
  or not has_function_privilege('authenticated','public.finance_labor_staff_archive_repair_v1(uuid)','execute')
  or not exists(select 1 from storage.buckets where id='finance-external-labor' and public=false) then
  raise exception 'External labor gateway/storage boundary changed';end if;
end $finance_external_labor_canary$;
-- FINANCE_AUTHENTICATED_CANARY_CORE_END
rollback;
-- FINANCE_AUTHENTICATED_CANARY_ROLLBACK_CHECK_BEGIN
do $finance_external_labor_rollback$ begin
 if auth.uid() is not null or current_user in('anon','authenticated','service_role') then
  raise exception 'External labor canary left identity context';end if;
end $finance_external_labor_rollback$;
-- FINANCE_AUTHENTICATED_CANARY_ROLLBACK_CHECK_END
select jsonb_build_object('canary','readonly_external_labor_v1','ok',true,'rolled_back',true,
 'privacy_preserved',true,'legacy_finalization_blocked',true,'posting_sealed',true)
 as finance_external_labor_canary_result;
