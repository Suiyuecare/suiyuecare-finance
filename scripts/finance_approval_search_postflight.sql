\set ON_ERROR_STOP on
-- Read-only exact implementation and authority contract for the reviewed search.
do $approval_search_postflight$
declare expected record;p record;role_name text;f jsonb;denied boolean:=false;
begin
 for expected in select * from (values
  ('private.finance_history_search_fields_v1(jsonb)','c057f3b6a4fa9af04f60d7331e380eb8',false),
  ('private.finance_history_search_text_v1(text)','b4774eeebdd6e6aa2886966d9cb0bf1e',false),
  ('private.finance_history_document_search_v1(text,text,jsonb)','2b7a6a206a9451f0c898c5344d56f175',false),
  ('public.finance_approval_participant_history_for_current_user(integer,integer,text,text)','3474c4a2001ee6e299634d68213b3f92',true)
 ) functions(signature,source_hash,is_rpc) loop
  select * into p from pg_proc where oid=to_regprocedure(expected.signature);
  if p.oid is null or md5(p.prosrc)<>expected.source_hash or p.prosecdef is distinct from expected.is_rpc
   or p.provolatile<>(case when expected.is_rpc then 's' else 'i' end)
   or pg_get_userbyid(p.proowner)<>'postgres' or p.proconfig is distinct from array['search_path=""']::text[]
   or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE') then
   raise exception 'Approval search reviewed implementation or authority changed: %',expected.signature;
  end if;
  foreach role_name in array array['anon','authenticated','service_role'] loop
   if has_function_privilege(role_name,p.oid,'execute') is distinct from (expected.is_rpc and role_name<>'anon') then
    raise exception 'Approval search privilege changed: % / %',expected.signature,role_name;
   end if;
  end loop;
 end loop;
 f:=private.finance_history_search_fields_v1('{"description":"自費服務","amount":1250,"form_payload":{"requestPurpose":"九月照顧","accountingLines":[{"description":"接送車資","grossAmount":12.5}],"metadata":{"note":"PRIVATE_METADATA_MARKER","amount":98123}},"files":[{"n":"自費附件.pdf","url":"https://example.invalid/PRIVATE_STORAGE_MARKER","fileData":"PRIVATE_BINARY_MARKER"}]}'::jsonb);
 if not private.finance_history_document_search_v1('自費 NT$ 1,250',f->>'text',f->'amounts')
  or not private.finance_history_document_search_v1('九月 接送 12.50',f->>'text',f->'amounts')
  or not private.finance_history_document_search_v1('自費附件.pdf',f->>'text',f->'amounts')
  or private.finance_history_document_search_v1('PRIVATE_METADATA_MARKER',f->>'text',f->'amounts')
  or private.finance_history_document_search_v1('PRIVATE_STORAGE_MARKER',f->>'text',f->'amounts')
  or private.finance_history_document_search_v1('PRIVATE_BINARY_MARKER',f->>'text',f->'amounts')
  or private.finance_history_document_search_v1('98123',f->>'text',f->'amounts')
  or private.finance_history_document_search_v1('12.00',f->>'text',f->'amounts') then
  raise exception 'Approval search business values or amount semantics changed';
 end if;
 if auth.uid() is null then
  begin perform public.finance_approval_participant_history_for_current_user(1,0,'自費','production');exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'Approval search accepted an unauthenticated reader';end if;
 end if;
end;
$approval_search_postflight$;
