\set ON_ERROR_STOP on
-- Repeatable read-only invariant/ACL checks. No source/profile writes.
do $tax_source_integrity_postflight$
declare signature text; definition text; r text; source jsonb; snapshot jsonb;
begin
 foreach signature in array array['private.finance_tax_source_snapshot_v1(text,jsonb,text)','private.finance_tax_source_read_v1(uuid,text,text,text,text,text,boolean)','private.finance_tax_source_bind_documents_v1(uuid,text,text,jsonb,jsonb)','public.finance_reporting_tax_sources_v1(text,jsonb,text)'] loop
  if not exists(select 1 from pg_proc where oid=to_regprocedure(signature) and proowner='postgres'::regrole and proconfig @> array['search_path=""']) then raise exception 'Tax source function owner/path missing: %',signature;end if;
  foreach r in array array['anon','service_role'] loop if has_function_privilege(r,signature,'EXECUTE') then raise exception 'Tax source API exposed to %',r;end if;end loop;
  if has_function_privilege('authenticated',signature,'EXECUTE') is distinct from (left(signature,7)='public.') then raise exception 'Tax source private/API privilege mismatch';end if;
 end loop;
 definition:=pg_get_functiondef('public.finance_reporting_tax_sources_v1(text,jsonb,text)'::regprocedure);
 if position('finance_reporting_actor_v1' in definition)=0 or position('jsonb_array_length(p_documents)>100' in definition)=0 or position('result ? k' in definition)=0 then raise exception 'Tax source batch authority/bounds missing';end if;
 definition:=pg_get_functiondef('private.finance_tax_source_read_v1(uuid,text,text,text,text,text,boolean)'::regprocedure);
 if position('for update' in definition)=0 or position('sha256' in definition)=0 or position('source->''form_payload''' in definition)=0 or position('source->''files''' in definition)=0 or position('public.can_read_invoice(i) is true' in definition)=0 or position('public.can_read_expense_request(r) is true' in definition)=0 or position('private.finance_expense_optional_permission_allows' in definition)=0 then raise exception 'Tax source locking/evidence digest absent';end if;
 definition:=pg_get_functiondef('private.finance_reporting_validate_v1(uuid,text,text,jsonb,jsonb,text,bigint)'::regprocedure);
 if position('finance_tax_source_bind_documents_v1(t,e,env,output,old)' in definition)=0 or position('"sourceBinding":"object"' in definition)=0 then raise exception 'Tax source validation is not wired to profile save';end if;
 definition:=pg_get_functiondef('private.finance_tax_source_bind_documents_v1(uuid,text,text,jsonb,jsonb)'::regprocedure);
 if position('d is not distinct from old->''documents''->kv.key' in definition)=0 or position('d->''sourceBinding'' is distinct from current_source->''binding''' in definition)=0 or position('errcode=''40001''' in definition)=0 then raise exception 'Tax source stale/legacy preservation contract missing';end if;
 source:='{"id":"fixture","entity_id":"A","ver":1,"amount":105,"form_payload":{"lazyRows":[{"no":"AA00000001","grossAmount":105}]}}';
 snapshot:=private.finance_tax_source_snapshot_v1('expense_request',source,'0');
 if snapshot#>>'{line,no}'<>'AA00000001' or snapshot->>'amount'<>'105' then raise exception 'Tax source line snapshot failed';end if;
 if private.finance_tax_source_snapshot_v1('expense_request',jsonb_set(source,'{form_payload,lazyRows}','[{"id":"duplicate"},{"id":"duplicate"}]'),'duplicate') is not null
  or private.finance_tax_source_snapshot_v1('expense_request',source,'missing') is not null
  or private.finance_tax_source_snapshot_v1('expense_request',source||'{"voided_at":"2099-01-01"}','0') is not null then raise exception 'Tax source missing/duplicate/void guard failed';end if;
end;
$tax_source_integrity_postflight$;
