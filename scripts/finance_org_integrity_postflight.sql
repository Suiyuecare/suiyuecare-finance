-- Read-only and repeatable after apply or inside the release rollback rehearsal.
-- No migration-ledger or temporary-table dependency.
do $postflight$
declare v record;
begin
 for v in select * from private.finance_membership_org_versions_v1 where status='published' loop
   if not coalesce((private.finance_membership_org_validate_v1(v.tenant_id,v.snapshot)->>'ok')::boolean,false) then raise exception 'Published organization validation failed';end if;
   if v.source_runtime_revision is distinct from private.finance_org_runtime_revision_v2(v.tenant_id) then raise exception 'Published runtime revision mismatch';end if;
 end loop;
 if exists(select 1 from private.finance_org_integrity_backup_v2 b join private.finance_membership_org_versions_v1 history_row on history_row.id=(b.payload->>'id')::uuid where b.kind='published_version' and (history_row.snapshot is distinct from b.payload->'snapshot' or history_row.status<>'archived')) then raise exception 'Historical published snapshot changed';end if;
 if has_function_privilege('authenticated','public.save_finance_org_chart_rows(jsonb)','EXECUTE') or has_function_privilege('anon','public.finance_save_org_chart_versioned_v2(jsonb,text,text)','EXECUTE') or has_function_privilege('anon','public.finance_org_chart_editor_state_v2()','EXECUTE') then raise exception 'Organization RPC privilege regression';end if;
 if private.finance_org_effective_now_v2('{"effective_to":"2020-01-02"}'::jsonb,'2026-09-07T00:00:00Z') or private.finance_org_effective_now_v2('{"effective_from":"2099-01-01"}'::jsonb,'2026-09-07T00:00:00Z') then raise exception 'Organization effective-period regression';end if;
 if to_regprocedure('public.finance_save_org_chart_versioned_v2(jsonb,text,text)') is null or to_regprocedure('private.finance_org_current_manager_v2(uuid,text,text,text)') is null then raise exception 'Versioned organization RPC missing';end if;
end;$postflight$;
