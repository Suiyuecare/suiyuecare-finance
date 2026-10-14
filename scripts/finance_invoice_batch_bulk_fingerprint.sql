\set ON_ERROR_STOP on
with f as (
 select p.oid::regprocedure::text name,concat_ws('|',md5(pg_get_functiondef(p.oid)),pg_get_userbyid(p.proowner),p.proacl::text,p.prosecdef::text,p.proconfig::text) value
 from pg_proc p where p.oid in(
 to_regprocedure('public.finance_submit_invoice_batch(text,jsonb,text)'),
 to_regprocedure('public.finance_submit_bill_batch(text,jsonb,text)'),
 to_regprocedure('private.finance_refresh_invoice_batch_approval_notification_v1()'),
 to_regprocedure('private.finance_refresh_invoice_batch_approval_notification_statement_v2()'),
 to_regprocedure('private.finance_history_projection_source_trigger_v1()'),
 to_regprocedure('private.finance_enqueue_current_approval_email()'))
),t as (
 select tgname name,concat_ws('|',pg_get_triggerdef(oid),tgenabled) value from pg_trigger where tgrelid='public.invoices'::regclass and not tgisinternal
),i as (
 select indexrelid::regclass::text name,pg_get_indexdef(indexrelid)||indisvalid::text||indisready::text value from pg_index where indrelid='public.invoices'::regclass
),d as (
 select 'public.finance_users' name,md5(coalesce(string_agg(md5(to_jsonb(r)::text),',' order by to_jsonb(r)::text),'')) value from public.finance_users r
 union all
 select 'public.tenant_members' name,md5(coalesce(string_agg(md5(to_jsonb(r)::text),',' order by to_jsonb(r)::text),'')) value from public.tenant_members r
 union all
 select 'auth.identities' name,md5(coalesce(string_agg(md5(to_jsonb(r)::text),',' order by to_jsonb(r)::text),'')) value from auth.identities r
 union all
 select 'auth.sessions' name,md5(coalesce(string_agg(md5(to_jsonb(r)::text),',' order by to_jsonb(r)::text),'')) value from auth.sessions r
 union all
 select 'public.bills' name,md5(coalesce(string_agg(md5(to_jsonb(r)::text),',' order by to_jsonb(r)::text),'')) value from public.bills r
 union all
 select 'public.invoices' name,md5(coalesce(string_agg(md5(to_jsonb(r)::text),',' order by to_jsonb(r)::text),'')) value from public.invoices r
 union all
 select 'public.approval_step_actor_snapshots' name,md5(coalesce(string_agg(md5(to_jsonb(r)::text),',' order by to_jsonb(r)::text),'')) value from public.approval_step_actor_snapshots r
 union all
 select 'private.finance_history_source_projection_v1' name,md5(coalesce(string_agg(md5(to_jsonb(r)::text),',' order by to_jsonb(r)::text),'')) value from private.finance_history_source_projection_v1 r
 union all
 select 'private.finance_history_group_projection_v1' name,md5(coalesce(string_agg(md5(to_jsonb(r)::text),',' order by to_jsonb(r)::text),'')) value from private.finance_history_group_projection_v1 r
 union all
 select 'public.notification_delivery_events' name,md5(coalesce(string_agg(md5(to_jsonb(r)::text),',' order by to_jsonb(r)::text),'')) value from public.notification_delivery_events r
 union all
 select 'private.approval_notification_assignment_state' name,md5(coalesce(string_agg(md5(to_jsonb(r)::text),',' order by to_jsonb(r)::text),'')) value from private.approval_notification_assignment_state r
 union all
 select 'private.finance_income_document_operations' name,md5(coalesce(string_agg(md5(to_jsonb(r)::text),',' order by to_jsonb(r)::text),'')) value from private.finance_income_document_operations r
 union all
 select 'private.finance_income_document_sequences' name,md5(coalesce(string_agg(md5(to_jsonb(r)::text),',' order by to_jsonb(r)::text),'')) value from private.finance_income_document_sequences r
 union all
 select 'public.collection_followups' name,md5(coalesce(string_agg(md5(to_jsonb(r)::text),',' order by to_jsonb(r)::text),'')) value from public.collection_followups r
 union all
 select 'public.invoice_revenue_rule_assignments' name,md5(coalesce(string_agg(md5(to_jsonb(r)::text),',' order by to_jsonb(r)::text),'')) value from public.invoice_revenue_rule_assignments r
 union all
 select 'public.cash_movement_evidence_links' name,md5(coalesce(string_agg(md5(to_jsonb(r)::text),',' order by to_jsonb(r)::text),'')) value from public.cash_movement_evidence_links r
 union all
 select 'public.income_document_closure_cases' name,md5(coalesce(string_agg(md5(to_jsonb(r)::text),',' order by to_jsonb(r)::text),'')) value from public.income_document_closure_cases r
),all_parts as (select * from f union all select * from t union all select * from i union all select * from d)
select md5(coalesce(string_agg(name||'|'||value,E'\n' order by name),'')) fingerprint from all_parts;

