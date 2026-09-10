-- Rollback-only synthetic test invoices and participation snapshots. The
-- authenticated operation is read-only: it never posts or changes a document.
begin isolation level repeatable read;
set local lock_timeout='5s';
set local statement_timeout='120s';
-- FINANCE_AUTHENTICATED_CANARY_CORE_BEGIN
do $amount_search_canary$
declare
 t constant uuid:='00000000-0000-0000-0000-000000000001';
 prefix constant text:='__finance_amount_search_canary_20260910__';
 label constant text:='AMOUNTSEARCHCANARYONLY20260910';
 actor public.finance_users%rowtype;result jsonb;before_rows jsonb;after_rows jsonb;row_id text;denied boolean:=false;
 old_claims text:=current_setting('request.jwt.claims',true);old_sub text:=current_setting('request.jwt.claim.sub',true);
 old_tenant text:=current_setting('app.current_tenant_id',true);
begin
 if exists(select 1 from public.invoices where left(id,length(prefix))=prefix) or exists(select 1 from public.approval_step_actor_snapshots where left(record_id,length(prefix))=prefix) then raise exception 'Amount search canary IDs already exist; refusing overwrite';end if;
 select u.* into actor from public.finance_users u where u.tenant_id=t and u.active is true and u.auth_user_id is not null
  and lower(btrim(u.email))=lower(btrim(public.finance_verified_google_email(u.auth_user_id)))
  and (select count(*) from public.finance_users f join public.tenant_members m on m.tenant_id=f.tenant_id and m.finance_user_id=f.id and m.auth_user_id=f.auth_user_id and m.active=true
   where f.auth_user_id=u.auth_user_id and f.active=true and lower(btrim(f.email))=lower(btrim(public.finance_verified_google_email(u.auth_user_id))))=1 order by u.id limit 1;
 if actor.id is null then raise exception 'Amount search canary requires an existing uniquely verified Finance member';end if;
 perform set_config('request.jwt.claim.sub',actor.auth_user_id::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',actor.auth_user_id,'role','authenticated','email',actor.email)::text,true);
 perform set_config('app.current_tenant_id',t::text,true);
 insert into public.invoices(id,no,tenant_id,data_environment,entity_id,entity_name,department_code,invoice_date,buyer,description,amount,tax,total,batch_id,status,approval_status,approval_step,steps,invoice_identifier_type)
 select prefix||suffix,prefix||suffix,t,'test','E6','Rollback-only fixture','J1101',current_date,label,label,amount,0,amount,batch,'unpaid','draft',1,'[]'::jsonb,'領據'
 from (values('a',1250::numeric,null::text),('b',1000::numeric,prefix||'batch'),('c',250::numeric,prefix||'batch'),('decimal',12.5::numeric,null::text),('secret',1250::numeric,null::text)) v(suffix,amount,batch);
 -- Only the dedicated fixture rows receive synthetic immutable participation.
 insert into public.approval_step_actor_snapshots(tenant_id,data_environment,record_type,record_id,record_no,step_index,resolved_user_id,acted_by_user_id,acted_at_text)
 select t,'test','invoices',id,no,0,actor.id,actor.id,clock_timestamp()::text from public.invoices where left(id,length(prefix))=prefix and id<>prefix||'secret';
 select jsonb_agg(to_jsonb(i) order by id) into before_rows from public.invoices i where left(id,length(prefix))=prefix;
 execute 'set local role authenticated';
 if current_user<>'authenticated' then raise exception 'Amount search canary did not enter browser role';end if;
 result:=public.finance_approval_participant_history_for_current_user(50,0,label||' NT$ 1,250','test');
 if result->'identity'->>'finance_user_id' is distinct from actor.id or (result->>'total')::int<>2 or jsonb_array_length(result->'items')<>2
  or exists(select 1 from jsonb_array_elements(result->'items') i cross join lateral jsonb_array_elements(i->'source_rows') s where s->>'id'=prefix||'secret') then raise exception 'Amount search scalar/batch or participant scope failed';end if;
 result:=public.finance_approval_participant_history_for_current_user(50,0,label||' 12.50','test');
 if (result->>'total')::int<>1 or result->'items'->0->>'record_id'<>prefix||'decimal' then raise exception 'Amount search decimal equality failed';end if;
 result:=public.finance_approval_participant_history_for_current_user(50,0,label||' 12.00','test');
 if (result->>'total')::int<>0 then raise exception 'Amount search decimal matched an integer prefix';end if;
 result:=public.finance_approval_participant_history_for_current_user(1,1,label||' 1,250','test');
 if (result->>'total')::int<>2 or jsonb_array_length(result->'items')<>1 or (result->'page'->>'has_more')::boolean then raise exception 'Amount search pagination changed';end if;
 result:=public.finance_approval_participant_history_for_current_user(50,0,label,'production');
 if (result->>'total')::int<>0 then raise exception 'Amount search crossed data environment';end if;
 execute 'reset role';
 perform set_config('request.jwt.claim.sub','',true);perform set_config('request.jwt.claims','{}',true);
 execute 'set local role authenticated';
 begin perform public.finance_approval_participant_history_for_current_user(1,0,label,'test');exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Amount search accepted an absent authenticated identity';end if;
 execute 'reset role';
 select jsonb_agg(to_jsonb(i) order by id) into after_rows from public.invoices i where left(id,length(prefix))=prefix;
 if after_rows is distinct from before_rows then raise exception 'Read-only amount search changed source invoices';end if;
 if exists(select 1 from public.ledger_entries where left(coalesce(source_id,''),length(prefix))=prefix)
  or exists(select 1 from public.notification_delivery_events where left(coalesce(request_id,''),length(prefix))=prefix or left(coalesce(payload->>'source_id',''),length(prefix))=prefix) then raise exception 'Amount search fixture unexpectedly posted or notified';end if;
 perform set_config('request.jwt.claim.sub',coalesce(old_sub,''),true);perform set_config('request.jwt.claims',coalesce(old_claims,''),true);perform set_config('app.current_tenant_id',coalesce(old_tenant,''),true);
end;
$amount_search_canary$;
-- FINANCE_AUTHENTICATED_CANARY_CORE_END
rollback;
-- FINANCE_AUTHENTICATED_CANARY_ROLLBACK_CHECK_BEGIN
do $amount_search_rollback$
begin
 if exists(select 1 from public.invoices where left(id,length('__finance_amount_search_canary_20260910__'))='__finance_amount_search_canary_20260910__')
  or exists(select 1 from public.approval_step_actor_snapshots where left(record_id,length('__finance_amount_search_canary_20260910__'))='__finance_amount_search_canary_20260910__') then raise exception 'Amount search canary rollback left fixture data';end if;
end;
$amount_search_rollback$;
-- FINANCE_AUTHENTICATED_CANARY_ROLLBACK_CHECK_END
select jsonb_build_object('canary','authenticated_amount_search_v1','ok',true,'rolled_back',true,'participant_scope_preserved',true) as amount_search_canary_result;
