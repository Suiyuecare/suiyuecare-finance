-- Read-only deployment assertions. Every ok value must be true.
with expected(signature,hash) as(values
 ('public.finance_bill_act_active_step_v2(text[],text,text,text,jsonb,text,jsonb,text)','d120d590078c424f77afb0862c9ae491'),
 ('public.finance_invoice_act_active_step_v2(text[],text,text,text,jsonb,text,jsonb,jsonb,text)','ae243ddc66db3953809f5602422fcdb3'),
 ('public.finance_invoice_receipt_action_v2(text[],text,text,jsonb,text,jsonb,text,jsonb,date)','58002d8974c8300a58507ef8359eda34'),
 ('public.finance_resubmit_bill_applicant_revision_v2(text,jsonb,text)','1589969c730218f89814090b655c7b41'),
 ('public.finance_resubmit_invoice_applicant_revision_v2(text,jsonb,text)','1b659d6fe639b0d0ad86aa15662acca0'),
 ('private.finance_income_resubmit_revision_rows_v2(text,uuid,text,text,text,jsonb)','a1fb48b62999bb526db2ea92483db467'),
 ('private.finance_income_withdraw_applicant_v1(text,text[],text,text,jsonb,text)','1752c69ab68622c1b2702512f29afbfa')
), rpc(signature) as(values
 ('public.finance_cloud_draft_save_v1(uuid,bigint,text,jsonb,jsonb,text)'),
 ('public.finance_cloud_draft_read_v1(uuid,text)'),
 ('public.finance_cloud_draft_list_v1(text,timestamptz,uuid,integer)'),
 ('public.finance_cloud_draft_reopen_v1(uuid,bigint,text)'),
 ('public.finance_cloud_draft_discard_v1(uuid,bigint,text)'),
 ('public.finance_cloud_submission_begin_v1(uuid,bigint,integer,text)'),
 ('public.finance_cloud_submission_stage_v1(uuid,bigint,integer,jsonb,text)'),
 ('public.finance_cloud_submission_commit_v1(uuid,bigint,text,text)')
),checks as(
 select 'source:'||signature check_name,coalesce((select md5(prosrc)=hash from pg_proc where oid=to_regprocedure(signature)),false) ok from expected
 union all
 select 'rpc-auth:'||signature,coalesce((select prosecdef and proconfig @> array['search_path=""'] and has_function_privilege('authenticated',oid,'execute') and not has_function_privilege('anon',oid,'execute') from pg_proc where oid=to_regprocedure(signature)),false) from rpc
 union all
 select 'private submit only:'||kind,coalesce((select not has_function_privilege('authenticated',oid,'execute') and not has_function_privilege('anon',oid,'execute') and not has_function_privilege('service_role',oid,'execute') from pg_proc where oid=to_regprocedure('private.finance_cloud_submit_'||kind||'_v1(text,jsonb,text)')),false) from unnest(array['invoice','bill']) kind
 union all
 select 'private drafts RLS:'||name,coalesce((select relrowsecurity and not has_table_privilege('authenticated',oid,'select,insert,update,delete') and not has_table_privilege('anon',oid,'select,insert,update,delete') from pg_class where oid=to_regclass('private.'||name)),false) from unnest(array['finance_cloud_drafts_v1','finance_cloud_draft_items_v1']) name
 union all
 select 'bounded 50-second cloud commit',coalesce((select proconfig @> array['statement_timeout=50s'] from pg_proc where oid=to_regprocedure('public.finance_cloud_submission_commit_v1(uuid,bigint,text,text)')),false)
 union all
 select 'draft attachment preservation triggers',(select count(*)=2 from pg_trigger where not tgisinternal and tgenabled='O' and tgname in ('finance_cloud_preserve_storage_v1','finance_cloud_preserve_metadata_v1'))
)
select check_name,ok from checks order by check_name;
