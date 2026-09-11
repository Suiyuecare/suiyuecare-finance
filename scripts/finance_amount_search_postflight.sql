\set ON_ERROR_STOP on
-- Read-only, repeatable before migration-ledger insertion and after release.
do $amount_search_postflight$
declare p record; signature text; actor text; source text; marker text; denied boolean:=false;
begin
 select * into p from pg_proc where oid=to_regprocedure('public.finance_approval_participant_history_for_current_user(integer,integer,text,text)');
 if p.oid is null or not p.prosecdef or p.provolatile<>'s' or pg_get_userbyid(p.proowner)<>'postgres' or p.proconfig is distinct from array['search_path=""']::text[]
  or not has_function_privilege('authenticated',p.oid,'EXECUTE') or not has_function_privilege('service_role',p.oid,'EXECUTE') or has_function_privilege('anon',p.oid,'EXECUTE')
  or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE') then raise exception 'History amount search RPC authority drifted';end if;
 source:=p.prosrc;
 foreach marker in array array['auth.uid()','public.finance_verified_google_email(v_auth_user_id)','v_member_count <> 1','tm.active = true','fu.active = true',
  'lower(btrim(fu.email)) = lower(btrim(v_verified_email))','snapshot.tenant_id = v_user.tenant_id','snapshot.data_environment = v_environment','snapshot.resolved_user_id = v_user.id',
  'request_row.tenant_id = matched.tenant_id','bill_row.tenant_id = matched.tenant_id','invoice_row.tenant_id = matched.tenant_id',
  'private.finance_history_document_search_v1(v_search','jsonb_build_array(group_amount)','limit v_limit','offset v_offset','v_limit > 50','length(v_search) > 120'] loop
  if position(marker in source)=0 then raise exception 'History amount search scope/page contract missing: %',marker;end if;
 end loop;
 foreach signature in array array['private.finance_history_search_text_v1(text)','private.finance_history_amount_text_v1(text)','private.finance_history_document_search_v1(text,text,jsonb)'] loop
  select * into p from pg_proc where oid=to_regprocedure(signature);
  if p.oid is null or p.prosecdef or p.provolatile<>'i' or p.proconfig is distinct from array['search_path=""']::text[] or pg_get_userbyid(p.proowner)<>'postgres' then raise exception 'History pure helper contract drifted: %',signature;end if;
  foreach actor in array array['anon','authenticated','service_role'] loop
   if has_function_privilege(actor,p.oid,'EXECUTE') then raise exception 'History pure helper exposed: % to %',signature,actor;end if;
  end loop;
 end loop;
 if not private.finance_history_document_search_v1('燈塔 NT$ 1,250元','燈塔虛構資料','[1250]')
  or not private.finance_history_document_search_v1('１２．５００','虛構','[12.5]')
  or not private.finance_history_document_search_v1('−12.50','虛構','[-12.5]')
  or not private.finance_history_document_search_v1('1250','虛構','[12500]')
  or private.finance_history_document_search_v1('12.00','虛構','[1250]')
  or private.finance_history_document_search_v1('12.50','虛構','[1250]')
  or private.finance_history_document_search_v1('12.50','112.50','[]')
  or private.finance_history_document_search_v1('12.50','-12.50','[]')
  or private.finance_history_document_search_v1('12.50','12.5000','[]')
  or private.finance_history_document_search_v1('1,25','虛構','[125]')
  or private.finance_history_document_search_v1('%','虛構','[]')
  or private.finance_history_document_search_v1('0','虛構','[null,false,""]') then raise exception 'History amount formatting/token semantics drifted';end if;
 if auth.uid() is null then
  begin perform public.finance_approval_participant_history_for_current_user(1,0,'NT$ 1,250','test');exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'Unauthenticated history amount search was not denied';end if;
 end if;
end;
$amount_search_postflight$;
