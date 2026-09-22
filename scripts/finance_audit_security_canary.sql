-- No employee claims, no document contents, and no business writes.
begin isolation level repeatable read read only;
set local lock_timeout='5s';
set local statement_timeout='15s';
-- Catalog only: no employee impersonation or business-data writes.
-- FINANCE_AUTHENTICATED_CANARY_CORE_BEGIN
do $audit_security_catalog$
declare r record;p record;role_name text;expected boolean;policy_count integer;
begin
 for r in select * from (values
  ('finance_attachment_private.parent_links_v1(uuid,text,text,text,text)','5fbafda67ee3f17d8236773d537980af',true,'s',true,false),
  ('private.finance_attachment_source_identity_v1()','152eea04a6a26b126841680d4389ac03',true,'v',false,false),
  ('private.finance_claim_attachment_metadata_v2()','addd18c5a918fb28b9781e41622eda30',true,'v',false,true),
  ('private.finance_legacy_attachment_links_immutable_v1()','9d0344a150ce76d8fb07cf81e9344389',false,'v',false,false),
  ('private.finance_membership_org_departments_v1(uuid,jsonb)','8ac26ef3b163ffec91f94c56bb15c99a',true,'s',false,false),
  ('public.can_read_bill(bills)','b7d87db93261207fd22c8b1ec3f1034c',false,'s',true,true),
  ('public.can_read_expense_request(expense_requests)','31f35d252a859753b8e13458c05e3b42',false,'s',true,true),
  ('public.can_read_finance_attachment(file_attachments)','c5e68ac17d3d5c5983564815a1e5b6ad',false,'s',true,true),
  ('public.can_read_invoice(invoices)','5ccbaefe4040cdb85ceb123d05aef6db',false,'s',true,true),
  ('public.can_update_expense_request(expense_requests)','54856821824e08f705e09adc08ab7b5c',false,'s',true,true),
  ('public.can_update_invoice(invoices)','334f53ce42d493091b00569d4018f496',false,'s',true,true),
  ('public.finance_attachment_paths_v1(jsonb[])','a6f3a8ec60073acad4112100ba2ee95f',false,'i',true,true),
  ('public.finance_bill_attachment_batch_no_v1(text)','ed5d50944e6e69d3fe3b250d609bf20e',false,'i',true,false),
  ('public.finance_identity_matches_current_v1(text[],text[],text[])','4600e2a4c8f7091c8b1d94507d8ee8ad',false,'s',true,false),
  ('public.finance_legacy_name_matches_current_v1(text[])','c20e11f6c4f1d4d64661f8523b69cb16',true,'s',true,false),
  ('public.finance_role_queue_scope_v1(text,text)','ce01867ba22b18e001672ce59489888f',false,'s',true,false),
  ('public.is_bill_owner(bills)','a1080c3b88f3e3dcbcc2d9686ef9091a',false,'s',true,true),
  ('public.json_steps_include_current_user(jsonb)','ad5a9add21b00169dd5c84ff2dba01a6',false,'s',true,true),
  ('public.json_steps_role_matches(jsonb)','ded9f06c2f59c4162485b6e58741edb6',false,'s',true,true)
 ) v(signature,body_md5,definer,volatility,authenticated_execute,service_execute) loop
  select * into p from pg_catalog.pg_proc where oid=pg_catalog.to_regprocedure(r.signature);
  if p.oid is null or md5(p.prosrc)<>r.body_md5 or p.prosecdef<>r.definer
   or p.provolatile::text<>r.volatility or p.proconfig is distinct from array['search_path=""']::text[]
   or pg_get_userbyid(p.proowner)<>'postgres' then
   raise exception 'Audit security function differs from sealed source: %',r.signature;
  end if;
  if exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE') then
   raise exception 'Audit security function exposed to PUBLIC: %',r.signature;
  end if;
  foreach role_name in array array['anon','authenticated','service_role'] loop
   expected:=case role_name when 'authenticated' then r.authenticated_execute when 'service_role' then r.service_execute else false end;
   if has_function_privilege(role_name,p.oid,'execute')<>expected then raise exception 'Audit security execution boundary changed: % / %',r.signature,role_name;end if;
  end loop;
 end loop;
 if not exists(select 1 from pg_class where oid='public.file_attachments'::regclass and relrowsecurity)
  or not exists(select 1 from pg_class where oid='storage.objects'::regclass and relrowsecurity) then raise exception 'Attachment RLS is disabled';end if;
 for r in select * from (values
  ('public.file_attachments','file_attachments_delete_verified_uploader_cleanup_v2','d',true,'204422c8dc2726bd407e4f72f86c7fdd',null),
  ('public.file_attachments','file_attachments_insert_verified_google_v2','a',true,null,'351752cc978fe6b5695a77529c873f62'),
  ('public.file_attachments','file_attachments_select_verified_tenant_v2','r',true,'5784ee6adb0c4e83251330786a066737',null),
  ('public.file_attachments','hr_salary_attachment_scope','r',false,'99557404af2117bfeb495e7c25a39af9',null),
  ('storage.objects','finance_attachments_select_verified_tenant_metadata_v2','r',true,'0ae6f39c68b612afe734c319430a5203',null)
 ) v(table_name,policy_name,command,permissive,using_md5,check_md5) loop
  if not exists(select 1 from pg_policy x where x.polrelid=to_regclass(r.table_name) and x.polname=r.policy_name
   and x.polcmd::text=r.command and x.polpermissive=r.permissive
   and md5(pg_get_expr(x.polqual,x.polrelid)) is not distinct from r.using_md5
   and md5(pg_get_expr(x.polwithcheck,x.polrelid)) is not distinct from r.check_md5
   and x.polroles=array[(select oid from pg_roles where rolname='authenticated')]) then
   raise exception 'Attachment policy differs: %',r.policy_name;
  end if;
 end loop;
 select count(*) into policy_count from pg_policy where polrelid='public.file_attachments'::regclass;
 if policy_count<>4 then raise exception 'Unexpected attachment policy';end if;
 if has_table_privilege('authenticated','public.file_attachments','update')
  or has_any_column_privilege('authenticated','public.file_attachments','update') then raise exception 'Claimed attachment metadata is mutable by browser';end if;
 if not exists(select 1 from pg_proc where oid='public.finance_can_insert_attachment_metadata_v2(public.file_attachments)'::regprocedure and md5(prosrc)='9d1fbc21a10716eab5c57fae872876f9' and prosecdef and proconfig=array['search_path=""']::text[]) then raise exception 'Attachment claim INSERT boundary changed';end if;
 if not has_schema_privilege('authenticated','finance_attachment_private','usage') or has_schema_privilege('anon','finance_attachment_private','usage') or has_schema_privilege('service_role','finance_attachment_private','usage') then raise exception 'Attachment lookup namespace boundary changed';end if;
 foreach role_name in array array['anon','authenticated','service_role'] loop
  if has_schema_privilege(role_name,'finance_attachment_private','create') then raise exception 'Attachment lookup namespace permits object creation';end if;
 end loop;
 if (select count(*) from pg_proc where pronamespace='finance_attachment_private'::regnamespace)<>1 then raise exception 'Unexpected attachment lookup entrypoint';end if;
 for r in select unnest(array['expense_requests','invoices','bills','vouchers']) source_table loop
  if not exists(select 1 from pg_trigger where tgrelid=to_regclass('public.'||r.source_table) and tgname='finance_attachment_source_identity_v1' and tgenabled='O' and tgtype=23 and tgfoid='private.finance_attachment_source_identity_v1()'::regprocedure) then raise exception 'Immutable attachment source ID guard changed: %',r.source_table;end if;
 end loop;
 if not exists(select 1 from pg_class where oid='private.finance_legacy_attachment_links_v1'::regclass and relrowsecurity and relforcerowsecurity) then raise exception 'Legacy attachment map RLS changed';end if;
 foreach role_name in array array['anon','authenticated','service_role'] loop
  if has_table_privilege(role_name,'private.finance_legacy_attachment_links_v1','select,insert,update,delete,truncate,references,trigger') then raise exception 'Legacy attachment map exposed: %',role_name;end if;
 end loop;
 if exists(select 1 from pg_policy where polrelid='private.finance_legacy_attachment_links_v1'::regclass) then raise exception 'Legacy attachment map policy changed';end if;
 if not exists(select 1 from pg_trigger where tgrelid='private.finance_legacy_attachment_links_v1'::regclass and tgname='immutable' and tgenabled='O' and tgtype=27 and tgfoid='private.finance_legacy_attachment_links_immutable_v1()'::regprocedure) then raise exception 'Legacy attachment map immutability changed';end if;
 if not exists(select 1 from pg_index i join pg_class c on c.oid=i.indexrelid
  where c.relname='finance_attachment_source_identity_lookup_v1' and i.indrelid='private.finance_legacy_attachment_links_v1'::regclass
    and i.indisvalid and i.indisready and md5(pg_get_indexdef(i.indexrelid))='863088cb5edbdaebf88aa774093c69a3') then raise exception 'Attachment source identity lookup index changed';end if;
end $audit_security_catalog$;

do $audit_security_absent_identity$
declare denied boolean;browser_role text;
begin
 if auth.uid() is not null then raise exception 'Audit canary must not impersonate an employee';end if;
 foreach browser_role in array array['anon','authenticated','service_role'] loop
  execute format('set local role %I',browser_role);
  if browser_role='authenticated' then
   if public.finance_identity_matches_current_v1(array['fictional-canary'],array['fixture@example.invalid'],array['Fictional'])
    or public.json_steps_include_current_user('[{"uid":"fictional-canary"}]'::jsonb)
    or public.json_steps_role_matches('[{"rk":"accountant"}]'::jsonb)
    or public.can_read_finance_attachment(null::public.file_attachments) then
    raise exception 'Audit document scope accepted absent verified identity';
   end if;
  else
   denied:=false;
   begin perform public.finance_legacy_name_matches_current_v1(array['Fictional']);
   exception when insufficient_privilege then denied:=true;end;
   if not denied then raise exception 'Legacy identity helper exposed to %',browser_role;end if;
  end if;
  execute 'reset role';
 end loop;
end $audit_security_absent_identity$;
-- FINANCE_AUTHENTICATED_CANARY_CORE_END
select jsonb_agg(to_jsonb(health) order by record_type) as attachment_parent_link_health
from (
 select a.record_type,count(*) as claimed,
  count(*) filter(where exists(select 1 from private.finance_legacy_attachment_links_v1 l where l.attachment_id=a.id)) as mapped,
  count(*) filter(where not exists(select 1 from private.finance_legacy_attachment_links_v1 l where l.attachment_id=a.id)) as unresolved
 from public.file_attachments a where a.attachment_state='claimed' and a.bucket_id='finance-attachments'
 group by a.record_type
) health;
rollback;
-- FINANCE_AUTHENTICATED_CANARY_ROLLBACK_CHECK_BEGIN
do $audit_security_rollback$
begin
 if current_user in ('anon','authenticated','service_role') or auth.uid() is not null then
  raise exception 'Audit proof left a browser role or employee context';end if;
end $audit_security_rollback$;
-- FINANCE_AUTHENTICATED_CANARY_ROLLBACK_CHECK_END
select jsonb_build_object('canary','readonly_audit_security_v1','ok',true,'rolled_back',true,'identity_scope_preserved',true,'attachment_scope_preserved',true) as audit_security_canary_result;
