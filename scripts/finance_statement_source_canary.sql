-- Entirely synthetic Auth / Google / Finance employee; never borrow a real
-- employee's claims. Existing non-person company/posting metadata is read only.
-- Normal Auth, HR, identity, eDoc and source triggers remain enabled.
-- pg_net HTTP requests start only after COMMIT; this file always ROLLBACKs.
-- https://supabase.com/docs/guides/database/extensions/pg_net#http_post
begin isolation level repeatable read;
set local lock_timeout='5s';
set local statement_timeout='120s';
-- FINANCE_AUTHENTICATED_CANARY_CORE_BEGIN
do $statement_source_canary$
declare
 t uuid:=public.default_tenant_id();
 other_t constant uuid:='d9130426-2900-4000-8000-000000000002';
 uid constant uuid:='d9130426-2900-4000-8000-000000000001';
 fid constant text:='__statement_source_employee_20260913__';
 v_email constant text:='statement-source-canary-20260913@suiyuecare.com';
 label constant text:='STATEMENT-SOURCE-ROLLBACK-ONLY-20260913';
 prefix constant text:='__statement_source_canary_20260913__';
 company_code text;dept text;source text;result jsonb;expected jsonb;received jsonb;source_before jsonb;
 page_offset integer;expected_count integer;denied boolean;row_id text;
 old_claims text:=current_setting('request.jwt.claims',true);old_sub text:=current_setting('request.jwt.claim.sub',true);old_tenant text:=current_setting('app.current_tenant_id',true);
begin
 if exists(select 1 from auth.users u where u.id=uid or lower(btrim(u.email))=v_email)
  or exists(select 1 from auth.identities i where i.user_id=uid or lower(btrim(i.identity_data->>'email'))=v_email)
  or exists(select 1 from public.finance_users u where u.id=fid or lower(btrim(u.email))=v_email or u.name=label)
  or exists(select 1 from public.employees e where e.employee_no=fid or e.metadata->>'finance_user_id'=fid or lower(btrim(e.email))=v_email)
  or exists(select 1 from public.users u where lower(btrim(u.email))=v_email)
  or exists(select 1 from public.tenant_members m where m.finance_user_id=fid or m.auth_user_id=uid or lower(btrim(m.email))=v_email)
  or exists(select 1 from public.finance_identity_links l where l.finance_user_id=fid or l.logging_user_id=uid::text or lower(btrim(l.logging_email))=v_email)
  or exists(select 1 from private.finance_edoc_member_state_v1 s where s.finance_user_id=fid)
  or exists(select 1 from private.finance_edoc_sync_outbox_v1 o where o.aggregate_type='member' and o.aggregate_id=fid)
  or exists(select 1 from public.tenants x where x.id=other_t or x.slug='statement-source-canary-20260913')
  or exists(select 1 from public.invoices i where left(i.id,length(prefix))=prefix or left(i.no,length(prefix))=prefix)
 then raise exception 'Statement canary identifiers already exist; refusing overwrite';end if;
 select s.entity_code,d.code into company_code,dept
 from public.finance_department_units d join public.finance_department_entity_scopes s on s.tenant_id=d.tenant_id and s.unit_id=d.id
 where d.tenant_id=t and d.active and d.present_in_source and d.is_posting_unit and s.active
  and private.finance_department_allows_new_form(d.tenant_id,d.code,s.entity_code)
  and exists(select 1 from public.companies c where c.code=s.entity_code and c.deleted_at is null)
 order by s.entity_code,d.code limit 1;
 if company_code is null or dept is null then raise exception 'Statement canary needs a valid non-person posting scope';end if;
 perform set_config('request.jwt.claim.sub','',true);perform set_config('request.jwt.claims','{}',true);perform set_config('app.current_tenant_id',t::text,true);
 -- Auth identity arrives before the Finance candidate, as in the real first
 -- login contract. The ordinary identity trigger finds no existing person.
 insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
 values(uid,'authenticated','authenticated',v_email,now(),'{"provider":"google","providers":["google"]}',jsonb_build_object('email',v_email,'email_verified',true,'name',label),now(),now());
 insert into auth.identities(provider_id,user_id,provider,identity_data,created_at,updated_at)
 values(uid::text,uid,'google',jsonb_build_object('sub',uid::text,'email',v_email,'email_verified',true),now(),now());
 insert into public.finance_users(id,tenant_id,auth_user_id,email,name,role,role_label,entity_id,department_code,active,google_link_status)
 values(fid,t,uid,v_email,label,'employee','Synthetic rollback-only employee',company_code,dept,true,'bound');
 insert into public.tenants(id,slug,name) values(other_t,'statement-source-canary-20260913',label);
 if not exists(select 1 from public.employees e where e.employee_no=fid and e.email=v_email)
  or not exists(select 1 from public.users u where u.auth_user_id=uid and u.email=v_email)
  or not exists(select 1 from public.tenant_members m where m.tenant_id=t and m.finance_user_id=fid and m.auth_user_id=uid and m.active)
  or not exists(select 1 from public.finance_identity_links l where l.finance_user_id=fid and l.logging_user_id=uid::text and l.active)
  or not exists(select 1 from private.finance_edoc_member_state_v1 s where s.tenant_id=t and s.finance_user_id=fid)
  or not exists(select 1 from private.finance_edoc_sync_outbox_v1 o where o.tenant_id=t and o.aggregate_type='member' and o.aggregate_id=fid)
 then raise exception 'Statement canary normal identity / HR / eDoc projections did not run';end if;
 insert into public.invoices(id,no,tenant_id,data_environment,entity_id,entity_name,department_code,applicant_id,applicant,invoice_date,buyer,description,amount,tax,total,status,approval_status,approval_step,steps,invoice_identifier_type)
 select prefix||suffix,prefix||suffix,t,'test',company_code,label,dept,case when suffix='secret' then null else fid end,
  case when suffix='secret' then label||'-UNASSIGNED' else label end,current_date,label,label,amount,0,amount,'unpaid','draft',1,'[]'::jsonb,'領據'
 from (values('a',1250.25::numeric),('b',136::numeric),('c',1050::numeric),('secret',99999::numeric)) v(suffix,amount);
 select jsonb_agg(to_jsonb(i) order by id) into source_before from public.invoices i where left(i.id,length(prefix))=prefix;
 perform set_config('request.jwt.claim.sub',uid::text,true);perform set_config('request.jwt.claims',jsonb_build_object('sub',uid,'role','authenticated','email',v_email)::text,true);
 execute 'set local role authenticated';
 if current_user<>'authenticated' or auth.uid() is distinct from uid or public.current_finance_user_id() is distinct from fid or public.current_tenant_id() is distinct from t or public.current_finance_role() is distinct from 'employee' then raise exception 'Synthetic employee did not resolve through real identity helpers';end if;
 foreach source in array array['expense_requests','bills','invoices'] loop
  -- Compare every RLS-visible test row, without returning any document to the
  -- caller or assuming a new employee sees zero role-assigned test history.
  execute format('select coalesce(jsonb_agg(to_jsonb(s) order by id),''[]''::jsonb) from public.%I s where tenant_id=$1 and data_environment=''test''',source) into expected using t;
  expected_count:=jsonb_array_length(expected);received:='[]';page_offset:=0;
  loop
   result:=public.finance_statement_source_page_v1(source,'test',2,page_offset);
   if result->>'ok' is distinct from 'true' or result->>'source' is distinct from source or result->>'tenantId' is distinct from t::text
    or result->>'dataEnvironment' is distinct from 'test' or (result->>'total')::int is distinct from expected_count
    or (result->>'limit')::int is distinct from 2 or (result->>'offset')::int is distinct from page_offset
    or (result->>'hasMore')::boolean is distinct from (page_offset+jsonb_array_length(result->'rows')<expected_count)
   then raise exception 'Statement source count / scope / page contract failed for %',source;end if;
   received:=received||(result->'rows');
   exit when (result->>'hasMore')::boolean is false;
   page_offset:=page_offset+2;
   if page_offset>expected_count then raise exception 'Statement source pagination failed to terminate';end if;
  end loop;
  if received is distinct from expected then raise exception 'Statement source full page payload changed or dropped RLS-visible rows';end if;
  if source='invoices' then
   if (select count(*) from jsonb_array_elements(received) r where left(r->>'id',length(prefix))=prefix)<>3
    or exists(select 1 from jsonb_array_elements(received) r where r->>'id'=prefix||'secret')
    or not exists(select 1 from jsonb_array_elements(received) r where r->>'id'=prefix||'a' and (r->>'total')::numeric=1250.25)
   then raise exception 'Statement source owner / unassigned / decimal payload changed';end if;
  end if;
  result:=public.finance_statement_source_page_v1(source,'test',2,expected_count+2);
  if result->'rows'<>'[]'::jsonb or (result->>'total')::int<>expected_count or result->>'hasMore'<>'false' then raise exception 'Statement source out-of-range page fabricated data';end if;
 end loop;
 denied:=false;begin perform public.finance_statement_source_page_v1('finance_users','test',2,0);exception when invalid_parameter_value then denied:=true;end;if not denied then raise exception 'Statement source arbitrary relation accepted';end if;
 denied:=false;begin perform public.finance_statement_source_page_v1('invoices','test',1001,0);exception when invalid_parameter_value then denied:=true;end;if not denied then raise exception 'Statement source page cap weakened';end if;
 perform set_config('app.current_tenant_id',other_t::text,true);
 denied:=false;begin perform public.finance_statement_source_page_v1('invoices','test',2,0);exception when insufficient_privilege then denied:=true;end;if not denied then raise exception 'Statement source accepted a foreign tenant claim';end if;
 perform set_config('app.current_tenant_id',t::text,true);
 execute 'reset role';
 if (select jsonb_agg(to_jsonb(i) order by id) from public.invoices i where left(i.id,length(prefix))=prefix) is distinct from source_before then raise exception 'Statement read changed source documents';end if;
 if exists(select 1 from public.ledger_entries l where left(coalesce(l.source_id,''),length(prefix))=prefix)
  or exists(select 1 from public.notification_delivery_events n where left(coalesce(n.request_id,''),length(prefix))=prefix or left(coalesce(n.payload->>'source_id',''),length(prefix))=prefix)
 then raise exception 'Statement fixture unexpectedly posted or delivered a notification';end if;
 execute 'set local role anon';denied:=false;begin perform public.finance_statement_source_page_v1('invoices','test',2,0);exception when insufficient_privilege then denied:=true;end;if not denied then raise exception 'Statement source anonymous access accepted';end if;execute 'reset role';
 perform set_config('request.jwt.claim.sub',coalesce(old_sub,''),true);perform set_config('request.jwt.claims',coalesce(old_claims,''),true);perform set_config('app.current_tenant_id',coalesce(old_tenant,''),true);
end;
$statement_source_canary$;
-- FINANCE_AUTHENTICATED_CANARY_CORE_END
rollback;
-- FINANCE_AUTHENTICATED_CANARY_ROLLBACK_CHECK_BEGIN
do $statement_source_rollback$
declare
 uid constant uuid:='d9130426-2900-4000-8000-000000000001';fid constant text:='__statement_source_employee_20260913__';prefix constant text:='__statement_source_canary_20260913__';
begin
 if exists(select 1 from auth.users where id=uid) or exists(select 1 from auth.identities where user_id=uid)
  or exists(select 1 from public.finance_users where id=fid)
  or exists(select 1 from public.employees where employee_no=fid or metadata->>'finance_user_id'=fid)
  or exists(select 1 from public.users where auth_user_id=uid or email='statement-source-canary-20260913@suiyuecare.com')
  or exists(select 1 from public.tenant_members where finance_user_id=fid or auth_user_id=uid)
  or exists(select 1 from public.finance_identity_links where finance_user_id=fid or logging_user_id=uid::text)
  or exists(select 1 from private.finance_edoc_member_state_v1 where finance_user_id=fid)
  or exists(select 1 from private.finance_edoc_sync_outbox_v1 where aggregate_type='member' and aggregate_id=fid)
  or exists(select 1 from public.tenants where id='d9130426-2900-4000-8000-000000000002')
  or exists(select 1 from public.invoices where left(id,length(prefix))=prefix)
  or exists(select 1 from public.approval_step_actor_snapshots where left(record_id,length(prefix))=prefix)
  or exists(select 1 from public.invoice_revenue_rule_assignments where left(invoice_id,length(prefix))=prefix)
  or exists(select 1 from public.income_document_closure_cases where left(source_id,length(prefix))=prefix)
 then raise exception 'Statement canary rollback left synthetic source / identity / projection data';end if;
end;
$statement_source_rollback$;
-- FINANCE_AUTHENTICATED_CANARY_ROLLBACK_CHECK_END
select jsonb_build_object('canary','authenticated_statement_source_v1','ok',true,'rolled_back',true,'source_scope_preserved',true) as statement_source_canary_result;
