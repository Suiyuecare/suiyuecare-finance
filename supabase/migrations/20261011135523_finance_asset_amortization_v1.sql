-- Fixed assets / prepaid expense register. No automatic initial cost booking.
-- Every registered cost is allocated from an existing immutable asset debit.
set local lock_timeout='5s';
set local statement_timeout='120s';
create table private.finance_asset_register_v1(
 id uuid primary key,tenant_id uuid not null,entity_id text not null,data_environment text not null check(data_environment in('production','test')),
 source_ledger_id uuid not null references public.ledger_entries(id),revision bigint not null check(revision>0),data jsonb not null,
 source_fingerprint text not null,prepared_by text not null,prepared_auth_id uuid not null,updated_at timestamptz not null default clock_timestamp()
);
create index finance_asset_scope_v1 on private.finance_asset_register_v1(tenant_id,data_environment,entity_id);
create index finance_asset_source_v1 on private.finance_asset_register_v1(source_ledger_id);
create table private.finance_asset_plans_v1(
 id uuid primary key default gen_random_uuid(),asset_id uuid not null references private.finance_asset_register_v1(id),period text not null,
 version bigint not null check(version>0),asset_revision bigint not null,source_fingerprint text not null,amount_cents bigint not null check(amount_cents>0),
 entries jsonb not null,status text not null check(status in('submitted','returned','posted')),author_id text not null,author_auth_id uuid not null,
 reviewer_id text,reviewer_auth_id uuid,review_reason text,voucher_id text,writing_transaction text,created_at timestamptz not null default clock_timestamp(),reviewed_at timestamptz,
 unique(asset_id,period)
);
create table private.finance_asset_events_v1(
 id uuid primary key default gen_random_uuid(),asset_id uuid not null references private.finance_asset_register_v1(id),action text not null,actor_id text not null,
 reason text not null,payload jsonb not null,created_at timestamptz not null default clock_timestamp()
);
create table private.finance_asset_operations_v1(
 tenant_id uuid not null,operation_id uuid not null,request_hash text not null,result jsonb not null,created_at timestamptz not null default clock_timestamp(),primary key(tenant_id,operation_id)
);
alter table private.finance_asset_register_v1 enable row level security;
alter table private.finance_asset_plans_v1 enable row level security;
alter table private.finance_asset_events_v1 enable row level security;
alter table private.finance_asset_operations_v1 enable row level security;
revoke all on private.finance_asset_register_v1,private.finance_asset_plans_v1,private.finance_asset_events_v1,private.finance_asset_operations_v1 from public,anon,authenticated,service_role;
create trigger finance_asset_events_immutable_v1 before update or delete on private.finance_asset_events_v1 for each row execute function private.finance_month_immutable_v1();
create trigger finance_asset_operations_immutable_v1 before update or delete on private.finance_asset_operations_v1 for each row execute function private.finance_month_immutable_v1();

create function private.finance_asset_actor_v1(e text,env text,d text default null,w boolean default false) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare a jsonb;
begin
 a:=private.finance_reporting_actor_v1(e,env);
 if coalesce(public.current_finance_role(),'') not in('accountant','ceo','admin_director') or (w and coalesce((a->>'canEditWorkpaper')::boolean,false) is not true) then raise exception '資產及攤提作業未授權' using errcode='42501';end if;
 -- List entrypoints assert complete-company visibility once, then check each
 -- department without repeatedly hashing the entire ledger for every asset.
 if d is null or w then perform private.finance_audit_source_v1((a->>'tenantId')::uuid,e,env);end if;
 if d is not null then
  perform private.finance_reporting_department_v1((a->>'tenantId')::uuid,e,d);
  if private.finance_expense_optional_permission_allows((a->>'tenantId')::uuid,a->>'actorId',case when w then 'finance.accounting.subject.edit' else 'finance.request.view.all' end,
   jsonb_build_object('entity_id',e,'entityId',e,'company_id',e,'legal_entity_code',e,'department_code',d,'departmentCode',d,'data_environment',env)) is distinct from true then raise exception '資產部門或會計操作未授權' using errcode='42501';end if;
 end if;
 return a;
end $$;

create function private.finance_asset_validate_v1(t uuid,e text,env text,p jsonb,asset uuid) returns text
language plpgsql stable security definer set search_path='' as $$
declare l public.ledger_entries;cost bigint;residual bigint;months integer;allocated numeric;account jsonb;c text;account_count bigint;
begin
 perform private.finance_reporting_shape_v1(p,'{"kind":"fixed_asset|prepaid","name":"text","sourceLedgerId":"text","costCents":"amount","residualCents":"amount","months":"amount","startMonth":"month","departmentCode":"text","expenseAccount":"text","offsetAccount":"text","note":"text"}',array['kind','name','sourceLedgerId','costCents','residualCents','months','startMonth','departmentCode','expenseAccount','offsetAccount','note']);
 if coalesce(p->>'kind','') not in('fixed_asset','prepaid') or coalesce(p->>'startMonth','')!~'^[1-9][0-9]{3}-(0[1-9]|1[0-2])$' or coalesce(p->>'sourceLedgerId','')!~'^[0-9a-f-]{36}$' or nullif(btrim(p->>'departmentCode'),'') is null or length(btrim(coalesce(p->>'name',''))) not between 1 and 200 or length(coalesce(p->>'note',''))>2000 or coalesce(p->>'costCents','')!~'^[0-9]{1,14}$' or coalesce(p->>'residualCents','')!~'^[0-9]{1,14}$' or coalesce(p->>'months','')!~'^[0-9]{1,3}$' then raise exception '資產名稱、來源、月份、金額分位、殘值或月數格式無效' using errcode='22023';end if;
 cost:=(p->>'costCents')::bigint;residual:=(p->>'residualCents')::bigint;months:=(p->>'months')::integer;
 if cost<=0 or residual<0 or residual>=cost or months not between 1 and 600 or cost-residual<months or (p->>'kind'='prepaid' and residual<>0) then raise exception '成本、殘值及攤提月數不合理；預付費用殘值須為零' using errcode='22023';end if;
 select * into l from public.ledger_entries where id=(p->>'sourceLedgerId')::uuid and tenant_id=t and entity_id=e and data_environment=env;
 if l.id is null or l.voided_at is not null or nullif(l.posting_key,'') is null or coalesce(l.account_code,'')!~'^1' or coalesce(l.debit,0)<=0 or coalesce(l.credit,0)<>0
  or l.entry_date is null or l.entry_date>=(to_date(p->>'startMonth'||'-01','YYYY-MM-DD')+interval '1 month') then raise exception '成本須連結同法人環境已入帳且未作廢的資產借方，攤提不得早於取得月份' using errcode='23514';end if;
 perform private.finance_asset_actor_v1(e,env,p->>'departmentCode',true);
 if l.department_code is not null then perform private.finance_asset_actor_v1(e,env,l.department_code,false);end if;
 if p->>'expenseAccount'!~'^[56]' or p->>'offsetAccount'!~'^1' or (p->>'kind'='prepaid' and p->>'offsetAccount' is distinct from l.account_code) or (p->>'kind'='fixed_asset' and p->>'offsetAccount'=l.account_code) then raise exception '請選擇費用借方及正確累計折舊／預付資產貸方' using errcode='22023';end if;
 foreach c in array array[p->>'expenseAccount',p->>'offsetAccount'] loop
  perform private.finance_reporting_account_v1(t,c);
  select count(*) into account_count from public.system_settings s cross join lateral jsonb_array_elements(s.value) x where s.tenant_id=t and s.key='accounts' and coalesce(x->>'c',x->>'code')=c;
  if account_count<>1 then raise exception '科目代碼重複或缺少，請先整理正式會計科目' using errcode='22023';end if;
  select x into account from public.system_settings s cross join lateral jsonb_array_elements(s.value) x where s.tenant_id=t and s.key='accounts' and coalesce(x->>'c',x->>'code')=c;
  if account->>'active'='false' or account->>'on'='false' or account->>'enabled'='false' or coalesce(nullif(account->>'n',''),nullif(account->>'name','')) is null then raise exception '入帳科目必須啟用且有正式名稱' using errcode='22023';end if;
 end loop;
 select coalesce(sum((r.data->>'costCents')::numeric),0) into allocated from private.finance_asset_register_v1 r where r.source_ledger_id=l.id and r.id<>asset;
 if allocated+cost>floor(l.debit*100) then raise exception '登錄成本合計超過來源資產分錄，不能重複登錄成本' using errcode='23514';end if;
 return encode(sha256(convert_to(to_jsonb(l)::text,'UTF8')),'hex');
end $$;

-- Integer cents; final month absorbs remainder. Never loses rounding pennies.
create function private.finance_asset_schedule_v1(p jsonb) returns jsonb language sql immutable set search_path='' as $$
 with cfg as(select (p->>'costCents')::bigint cost,(p->>'residualCents')::bigint residual,(p->>'months')::integer months,to_date(p->>'startMonth'||'-01','YYYY-MM-DD') start_date),
 rows as(select i,to_char(start_date+(i-1)*interval '1 month','YYYY-MM') period,case when i=months then cost-residual-((cost-residual)/months)*(months-1) else (cost-residual)/months end cents,cost,residual from cfg cross join lateral generate_series(1,months) i)
 select jsonb_agg(jsonb_build_object('monthIndex',i,'period',period,'amountCents',cents,'remainingCents',cost-(select sum(r2.cents) from rows r2 where r2.i<=r.i)) order by i) from rows r
$$;

create function public.finance_asset_save_v1(p_id uuid,p_entity_id text,p_data jsonb,p_expected_revision bigint,p_operation_id uuid,p_reason text,p_data_environment text default 'production') returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare a jsonb;t uuid;r private.finance_asset_register_v1;h text;prior private.finance_asset_operations_v1;fingerprint text;out jsonb;
begin
 a:=private.finance_asset_actor_v1(p_entity_id,p_data_environment,p_data->>'departmentCode',true);t:=(a->>'tenantId')::uuid;
 if p_id is null or p_operation_id is null or p_expected_revision is null or p_expected_revision<0 or length(coalesce(btrim(p_reason),'')) not between 1 and 2000 then raise exception '登錄需要識別碼、版本及原因' using errcode='22023';end if;
 h:=encode(sha256(convert_to(jsonb_build_array(p_id,p_entity_id,p_data_environment,p_data,p_expected_revision,p_reason,a->>'actorId',auth.uid())::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended('asset_op|'||t::text||'|'||p_operation_id,0));
 select * into prior from private.finance_asset_operations_v1 where tenant_id=t and operation_id=p_operation_id;
 if found then if prior.request_hash<>h then raise exception '操作識別碼已用於不同內容' using errcode='23514';end if;return prior.result||'{"replayed":true}';end if;
 perform pg_advisory_xact_lock(hashtextextended('asset|'||p_id,0));
 perform pg_advisory_xact_lock(hashtextextended('asset_source|'||coalesce(p_data->>'sourceLedgerId',''),0));
 select * into r from private.finance_asset_register_v1 where id=p_id;
 if found and (r.tenant_id<>t or r.entity_id<>p_entity_id or r.data_environment<>p_data_environment) then raise exception '資產不在授權範圍' using errcode='42501';end if;
 if coalesce(r.revision,0)<>p_expected_revision then raise exception '資產登錄版本已更新，請重新載入' using errcode='40001';end if;
 if r.id is not null and r.source_ledger_id::text is distinct from p_data->>'sourceLedgerId' then raise exception '來源分錄不可更換，請先核對原始資產' using errcode='23514';end if;
 if exists(select 1 from private.finance_asset_plans_v1 where asset_id=p_id and status='posted') then raise exception '已有攤提入帳，原成本及方法不得改寫，須另作調整傳票' using errcode='23514';end if;
 fingerprint:=private.finance_asset_validate_v1(t,p_entity_id,p_data_environment,p_data,p_id);
 insert into private.finance_asset_register_v1(id,tenant_id,entity_id,data_environment,source_ledger_id,revision,data,source_fingerprint,prepared_by,prepared_auth_id)
 values(p_id,t,p_entity_id,p_data_environment,(p_data->>'sourceLedgerId')::uuid,p_expected_revision+1,p_data,fingerprint,a->>'actorId',auth.uid())
 on conflict(id) do update set revision=excluded.revision,data=excluded.data,source_fingerprint=excluded.source_fingerprint,prepared_by=excluded.prepared_by,prepared_auth_id=excluded.prepared_auth_id,updated_at=clock_timestamp();
 out:=jsonb_build_object('id',p_id,'revision',p_expected_revision+1,'replayed',false);
 insert into private.finance_asset_events_v1(asset_id,action,actor_id,reason,payload) values(p_id,'registered',a->>'actorId',p_reason,jsonb_build_object('revision',p_expected_revision+1,'data',p_data,'sourceFingerprint',fingerprint));
 insert into private.finance_asset_operations_v1(tenant_id,operation_id,request_hash,result) values(t,p_operation_id,h,out);return out;
end $$;

create function private.finance_asset_plan_source_v1(r private.finance_asset_register_v1,p_period text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare fingerprint text;amount bigint;entries jsonb;names jsonb;
begin
 fingerprint:=private.finance_asset_validate_v1(r.tenant_id,r.entity_id,r.data_environment,r.data,r.id);
 if fingerprint<>r.source_fingerprint then raise exception '原始資產分錄已變動，請重新核對登錄' using errcode='40001';end if;
 select (x->>'amountCents')::bigint into amount from jsonb_array_elements(private.finance_asset_schedule_v1(r.data)) x where x->>'period'=p_period;
 if amount is null then raise exception '月份不在資產折舊／攤提期間內' using errcode='22023';end if;
 select jsonb_object_agg(coalesce(x->>'c',x->>'code'),coalesce(x->>'n',x->>'name')) into names from public.system_settings s cross join lateral jsonb_array_elements(s.value) x where s.tenant_id=r.tenant_id and s.key='accounts' and coalesce(x->>'c',x->>'code') in(r.data->>'expenseAccount',r.data->>'offsetAccount');
 entries:=jsonb_build_array(jsonb_build_object('t','dr','ac',r.data->>'expenseAccount','an',names->>(r.data->>'expenseAccount'),'amt',amount/100.0,'dept',r.data->>'departmentCode'),jsonb_build_object('t','cr','ac',r.data->>'offsetAccount','an',names->>(r.data->>'offsetAccount'),'amt',amount/100.0,'dept',r.data->>'departmentCode'));
 return jsonb_build_object('amountCents',amount,'entries',entries,'sourceFingerprint',encode(sha256(convert_to(jsonb_build_array(r.id,r.revision,r.data,fingerprint,p_period,entries)::text,'UTF8')),'hex'));
end $$;

create function public.finance_asset_prepare_plan_v1(p_asset_id uuid,p_period text,p_expected_asset_revision bigint,p_expected_plan_version bigint,p_operation_id uuid,p_reason text) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare r private.finance_asset_register_v1;a jsonb;s jsonb;p private.finance_asset_plans_v1;h text;prior private.finance_asset_operations_v1;out jsonb;
begin
 select * into r from private.finance_asset_register_v1 where id=p_asset_id and tenant_id=public.current_tenant_id();if not found then raise exception '資產不存在或無權調閱' using errcode='42501';end if;
 a:=private.finance_asset_actor_v1(r.entity_id,r.data_environment,r.data->>'departmentCode',true);
 if p_operation_id is null or p_expected_asset_revision is null or p_expected_plan_version is null or p_expected_plan_version<0 or length(coalesce(btrim(p_reason),'')) not between 1 and 2000 then raise exception '攤提方案需要版本、操作識別碼及原因' using errcode='22023';end if;
 h:=encode(sha256(convert_to(jsonb_build_array('prepare',p_asset_id,p_period,p_expected_asset_revision,p_expected_plan_version,p_reason,a->>'actorId',auth.uid())::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended('asset_op|'||r.tenant_id::text||'|'||p_operation_id,0));
 select * into prior from private.finance_asset_operations_v1 where tenant_id=r.tenant_id and operation_id=p_operation_id;
 if found then if prior.request_hash<>h then raise exception '操作識別碼已用於不同內容' using errcode='23514';end if;return prior.result||'{"replayed":true}';end if;
 perform pg_advisory_xact_lock(hashtextextended('asset|'||p_asset_id,0));select * into r from private.finance_asset_register_v1 where id=p_asset_id;
 select * into p from private.finance_asset_plans_v1 where asset_id=r.id and period=p_period;
 if r.revision<>p_expected_asset_revision or coalesce(p.version,0)<>p_expected_plan_version then raise exception '資產或攤提方案已更新' using errcode='40001';end if;
 if p.status='posted' then raise exception '此資產本月已入帳，不可再次攤提' using errcode='23514';end if;
 s:=private.finance_asset_plan_source_v1(r,p_period);
 perform private.finance_assert_period_open(r.tenant_id,r.data_environment,r.entity_id,(to_date(p_period||'-01','YYYY-MM-DD')+interval '1 month - 1 day')::date,'提出資產攤提');
 insert into private.finance_asset_plans_v1(asset_id,period,version,asset_revision,source_fingerprint,amount_cents,entries,status,author_id,author_auth_id)
 values(r.id,p_period,p_expected_plan_version+1,r.revision,s->>'sourceFingerprint',(s->>'amountCents')::bigint,s->'entries','submitted',a->>'actorId',auth.uid())
 on conflict(asset_id,period) do update set version=excluded.version,asset_revision=excluded.asset_revision,source_fingerprint=excluded.source_fingerprint,amount_cents=excluded.amount_cents,entries=excluded.entries,status='submitted',author_id=excluded.author_id,author_auth_id=excluded.author_auth_id,reviewer_id=null,reviewer_auth_id=null,review_reason=null,reviewed_at=null returning * into p;
 out:=jsonb_build_object('id',p.id,'version',p.version,'status',p.status,'amountCents',p.amount_cents,'entries',p.entries,'replayed',false);
 insert into private.finance_asset_events_v1(asset_id,action,actor_id,reason,payload) values(r.id,'submitted',a->>'actorId',p_reason,to_jsonb(p)-'writing_transaction');
 insert into private.finance_asset_operations_v1(tenant_id,operation_id,request_hash,result) values(r.tenant_id,p_operation_id,h,out);return out;
end $$;

create function public.finance_asset_review_plan_v1(p_plan_id uuid,p_expected_version bigint,p_reason text,p_return boolean default false) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare p private.finance_asset_plans_v1;r private.finance_asset_register_v1;a jsonb;s jsonb;num text;d date;description text;line jsonb;idx integer:=0;
begin
 select * into p from private.finance_asset_plans_v1 where id=p_plan_id;select * into r from private.finance_asset_register_v1 where id=p.asset_id and tenant_id=public.current_tenant_id();
 if r.id is null then raise exception '攤提方案不存在或無權覆核' using errcode='42501';end if;
 a:=private.finance_asset_actor_v1(r.entity_id,r.data_environment,r.data->>'departmentCode',true);
 if p.author_id=a->>'actorId' or p.author_auth_id=auth.uid() or r.prepared_by=a->>'actorId' or r.prepared_auth_id=auth.uid() then raise exception '覆核人不可是方案或資產成本準備人' using errcode='42501';end if;
 if p_expected_version is null or p_return is null or length(coalesce(btrim(p_reason),'')) not between 1 and 2000 then raise exception '覆核需要版本及說明' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('asset|'||r.id,0));select * into r from private.finance_asset_register_v1 where id=r.id;select * into p from private.finance_asset_plans_v1 where id=p_plan_id for update;
 a:=private.finance_asset_actor_v1(r.entity_id,r.data_environment,r.data->>'departmentCode',true);
 if p.author_id=a->>'actorId' or p.author_auth_id=auth.uid() or r.prepared_by=a->>'actorId' or r.prepared_auth_id=auth.uid() then raise exception '覆核人不可是方案或資產成本準備人' using errcode='42501';end if;
 if p.status<>'submitted' then
  if p.version=p_expected_version+1 and p.reviewer_auth_id=auth.uid() and p.review_reason=p_reason and p.status=(case when p_return then 'returned' else 'posted' end) then return jsonb_build_object('id',p.id,'status',p.status,'version',p.version,'voucherId',p.voucher_id,'replayed',true);end if;
  raise exception '攤提方案狀態或版本已更新' using errcode='40001';
 end if;
 if p.version<>p_expected_version or p.asset_revision<>r.revision then raise exception '攤提方案或資產版本已更新' using errcode='40001';end if;
 if not p_return then
  s:=private.finance_asset_plan_source_v1(r,p.period);
  if s->>'sourceFingerprint' is distinct from p.source_fingerprint or s->'entries' is distinct from p.entries or (s->>'amountCents')::bigint<>p.amount_cents then raise exception '來源或會計科目已變動，請重新提出方案' using errcode='40001';end if;
  -- Enforce chronological booking; a later month cannot conceal missing accruals.
  if exists(select 1 from jsonb_array_elements(private.finance_asset_schedule_v1(r.data)) m where m->>'period'<p.period and not exists(select 1 from private.finance_asset_plans_v1 x where x.asset_id=r.id and x.period=m->>'period' and x.status='posted')) then raise exception '請先完成較早月份的攤提，不能跳月入帳' using errcode='23514';end if;
  d:=(to_date(p.period||'-01','YYYY-MM-DD')+interval '1 month - 1 day')::date;
  perform private.finance_assert_period_open(r.tenant_id,r.data_environment,r.entity_id,d,'資產折舊／預付攤提入帳');
  num:=private.finance_next_voucher_no_for_tenant(r.tenant_id,'ASTAM',d,r.data_environment);
 end if;
 update private.finance_asset_plans_v1 set version=version+1,status=case when p_return then 'returned' else 'posted' end,reviewer_id=a->>'actorId',reviewer_auth_id=auth.uid(),review_reason=p_reason,reviewed_at=clock_timestamp(),voucher_id=num,writing_transaction=case when p_return then null else pg_current_xact_id()::text end where id=p.id returning * into p;
 if not p_return then
  description:=case when r.data->>'kind'='fixed_asset' then '固定資產折舊 ' else '預付費用攤提 ' end||(r.data->>'name')||' '||p.period;
  insert into public.vouchers(id,no,request_id,entity_id,entity_name,voucher_date,description,entries,total,creator,posted,posted_at,posting_locked_at,data_environment,tenant_id)
   values(num,num,'asset_amortization:'||p.id,r.entity_id,r.entity_id,d,description,p.entries,p.amount_cents/100.0,a->>'actorId',true,clock_timestamp(),clock_timestamp(),r.data_environment,r.tenant_id);
  for line in select * from jsonb_array_elements(p.entries) loop
   idx:=idx+1;
   insert into public.ledger_entries(entry_date,description,entity_id,department_code,debit,credit,account_code,account_name,reference_no,posting_key,source_type,source_id,source_no,voucher_no,data_environment,tenant_id)
    values(d,description,r.entity_id,line->>'dept',case when line->>'t'='dr' then (line->>'amt')::numeric else 0 end,case when line->>'t'='cr' then (line->>'amt')::numeric else 0 end,line->>'ac',line->>'an',num,'asset_amortization:'||p.id||':'||idx,'asset_amortization',p.id::text,num,num,r.data_environment,r.tenant_id);
  end loop;
 end if;
 insert into private.finance_asset_events_v1(asset_id,action,actor_id,reason,payload) values(r.id,p.status,a->>'actorId',p_reason,to_jsonb(p)-'writing_transaction');
 return jsonb_build_object('id',p.id,'status',p.status,'version',p.version,'voucherId',p.voucher_id,'replayed',false);
end $$;

create function private.finance_asset_book_guard_v1() returns trigger language plpgsql security definer set search_path='' as $$
declare p private.finance_asset_plans_v1;r private.finance_asset_register_v1;v public.vouchers;
begin
 if tg_op<>'INSERT' then
  if (tg_table_name='vouchers' and (coalesce(to_jsonb(old)->>'request_id','') like 'asset_amortization:%' or coalesce(to_jsonb(new)->>'request_id','') like 'asset_amortization:%' or coalesce(to_jsonb(new)->>'no','') like 'ASTAM%')) or (tg_table_name='ledger_entries' and (coalesce(to_jsonb(old)->>'source_type','')='asset_amortization' or coalesce(to_jsonb(new)->>'source_type','')='asset_amortization' or coalesce(to_jsonb(new)->>'posting_key','') like 'asset_amortization:%' or coalesce(to_jsonb(new)->>'voucher_no','') like 'ASTAM%')) then raise exception '資產攤提分錄不可改寫或刪除，請另作更正傳票' using errcode='23514';end if;return coalesce(new,old);
 end if;
 if tg_table_name='vouchers' then
  if coalesce(new.request_id,'') not like 'asset_amortization:%' and coalesce(new.no,'') not like 'ASTAM%' then return new;end if;
  select * into p from private.finance_asset_plans_v1 where voucher_id=new.id;select * into r from private.finance_asset_register_v1 where id=p.asset_id;
  if p.id is null or p.status<>'posted' or p.writing_transaction is distinct from pg_current_xact_id()::text or new.request_id is distinct from 'asset_amortization:'||p.id or new.no is distinct from p.voucher_id or new.tenant_id is distinct from r.tenant_id or new.entity_id is distinct from r.entity_id or new.data_environment is distinct from r.data_environment or new.entries is distinct from p.entries or new.total is distinct from p.amount_cents/100.0 or new.posted is distinct from true or new.posting_locked_at is null or new.adjustment_type is not null or new.adjusts_voucher_no is not null or new.voucher_date is distinct from (to_date(p.period||'-01','YYYY-MM-DD')+interval '1 month - 1 day')::date then raise exception '資產攤提必須透過原子覆核交易建立傳票' using errcode='42501';end if;
 else
  if coalesce(new.source_type,'')<>'asset_amortization' and coalesce(new.posting_key,'') not like 'asset_amortization:%' and coalesce(new.voucher_no,'') not like 'ASTAM%' then return new;end if;
  select * into p from private.finance_asset_plans_v1 where voucher_id=new.voucher_no;select * into r from private.finance_asset_register_v1 where id=p.asset_id;
  if p.id is null or p.status<>'posted' or p.writing_transaction is distinct from pg_current_xact_id()::text or new.tenant_id is distinct from r.tenant_id or new.entity_id is distinct from r.entity_id or new.data_environment is distinct from r.data_environment or new.source_type is distinct from 'asset_amortization' or new.source_id is distinct from p.id::text or new.reference_no is distinct from p.voucher_id or new.source_no is distinct from p.voucher_id or new.entry_date is distinct from (to_date(p.period||'-01','YYYY-MM-DD')+interval '1 month - 1 day')::date or not exists(select 1 from jsonb_array_elements(p.entries) with ordinality x(line,i) where new.posting_key='asset_amortization:'||p.id||':'||x.i and new.department_code=x.line->>'dept' and new.account_code=x.line->>'ac' and new.account_name=x.line->>'an' and new.debit=case when x.line->>'t'='dr' then (x.line->>'amt')::numeric else 0 end and new.credit=case when x.line->>'t'='cr' then (x.line->>'amt')::numeric else 0 end) then raise exception '資產攤提必須透過原子覆核交易建立分類帳' using errcode='42501';end if;
 end if;return new;
end $$;
create trigger finance_asset_atomic_voucher_v1 before insert or update or delete on public.vouchers for each row execute function private.finance_asset_book_guard_v1();
create trigger finance_asset_atomic_ledger_v1 before insert or update or delete on public.ledger_entries for each row execute function private.finance_asset_book_guard_v1();

create function public.finance_asset_workspace_v1(p_entity_id text,p_period text,p_data_environment text default 'production') returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare a jsonb;r private.finance_asset_register_v1;items jsonb:='[]';item jsonb;p private.finance_asset_plans_v1;amount bigint;n integer:=0;
begin
 a:=private.finance_asset_actor_v1(p_entity_id,p_data_environment);
 if p_period is null or p_period!~'^[1-9][0-9]{3}-(0[1-9]|1[0-2])$' then raise exception '請指定月份' using errcode='22023';end if;
 for r in select * from private.finance_asset_register_v1 where tenant_id=(a->>'tenantId')::uuid and entity_id=p_entity_id and data_environment=p_data_environment order by data->>'name',id limit 501 loop
  n:=n+1;if n>500 then raise exception '資產超過500筆，請由管理員擴充分頁後調閱，不能截斷總額' using errcode='54000';end if;
  perform private.finance_asset_actor_v1(r.entity_id,r.data_environment,r.data->>'departmentCode');
  select * into p from private.finance_asset_plans_v1 where asset_id=r.id and period=p_period;
  select (x->>'amountCents')::bigint into amount from jsonb_array_elements(private.finance_asset_schedule_v1(r.data)) x where x->>'period'=p_period;
  item:=jsonb_build_object('id',r.id,'revision',r.revision,'data',r.data,'schedule',private.finance_asset_schedule_v1(r.data),'amountCents',amount,'preparedBy',r.prepared_by,'postedCents',(select coalesce(sum(amount_cents),0) from private.finance_asset_plans_v1 where asset_id=r.id and status='posted'),
   'plan',case when p.id is null then null else (to_jsonb(p)-'writing_transaction'-'author_auth_id'-'reviewer_auth_id')||jsonb_build_object('canReview',p.status='submitted' and p.author_auth_id<>auth.uid() and r.prepared_auth_id<>auth.uid() and (a->>'canEditWorkpaper')::boolean) end);
  items:=items||jsonb_build_array(item);
 end loop;
 return jsonb_build_object('entityId',p_entity_id,'period',p_period,'environment',p_data_environment,'items',items,'canWrite',(a->>'canEditWorkpaper')::boolean,'method','straight_line_monthly_cents');
end $$;

create function public.finance_asset_sources_v1(p_entity_id text,p_query text default '',p_offset integer default 0,p_limit integer default 50,p_data_environment text default 'production') returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare a jsonb;out jsonb;
begin
 a:=private.finance_asset_actor_v1(p_entity_id,p_data_environment);
 if p_offset is null or p_offset<0 or p_limit is null or p_limit not between 1 and 100 or length(coalesce(p_query,''))>200 then raise exception '來源搜尋範圍無效' using errcode='22023';end if;
 with eligible as materialized(select l.*,coalesce((select sum((r.data->>'costCents')::numeric) from private.finance_asset_register_v1 r where r.source_ledger_id=l.id),0) allocated
  from public.ledger_entries l where l.tenant_id=(a->>'tenantId')::uuid and l.entity_id=p_entity_id and l.data_environment=p_data_environment and l.voided_at is null and l.posting_key is not null and l.account_code~'^1' and l.debit>0 and coalesce(l.credit,0)=0
   and (coalesce(p_query,'')='' or concat_ws(' ',l.description,l.reference_no,l.account_code,l.account_name,l.id::text) ilike '%'||replace(replace(replace(p_query,'\','\\'),'%','\%'),'_','\_')||'%')),
 page as(select * from eligible order by entry_date desc,id offset p_offset limit p_limit)
 select jsonb_build_object('total',(select count(*) from eligible),'offset',p_offset,'limit',p_limit,'items',coalesce((select jsonb_agg(jsonb_build_object('id',id,'date',entry_date,'description',description,'referenceNo',reference_no,'accountCode',account_code,'accountName',account_name,'departmentCode',department_code,'costCents',floor(debit*100),'availableCents',floor(debit*100)-allocated) order by entry_date desc,id) from page),'[]')) into out;
 return out;
end $$;

revoke all on function private.finance_asset_actor_v1(text,text,text,boolean),private.finance_asset_validate_v1(uuid,text,text,jsonb,uuid),private.finance_asset_schedule_v1(jsonb),private.finance_asset_plan_source_v1(private.finance_asset_register_v1,text),private.finance_asset_book_guard_v1() from public,anon,authenticated,service_role;
revoke all on function public.finance_asset_save_v1(uuid,text,jsonb,bigint,uuid,text,text),public.finance_asset_prepare_plan_v1(uuid,text,bigint,bigint,uuid,text),public.finance_asset_review_plan_v1(uuid,bigint,text,boolean),public.finance_asset_workspace_v1(text,text,text),public.finance_asset_sources_v1(text,text,integer,integer,text) from public,anon,service_role;
grant execute on function public.finance_asset_save_v1(uuid,text,jsonb,bigint,uuid,text,text),public.finance_asset_prepare_plan_v1(uuid,text,bigint,bigint,uuid,text),public.finance_asset_review_plan_v1(uuid,bigint,text,boolean),public.finance_asset_workspace_v1(text,text,text),public.finance_asset_sources_v1(text,text,integer,integer,text) to authenticated;

-- Include unposted asset work in monthly facts and source fingerprints. The
-- immutable report snapshot now captures the original register and plans too.
alter function private.finance_month_source_v1(text,text,text) rename to finance_month_source_before_assets_v1;
create function private.finance_month_source_v1(e text,p text,env text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare s jsonb;w jsonb;registers jsonb;plans jsonb;summary jsonb;t uuid;
begin
 s:=private.finance_month_source_before_assets_v1(e,p,env)-'sourceFingerprint';t:=(s->>'tenantId')::uuid;
 w:=public.finance_asset_workspace_v1(e,p,env);
 select coalesce(jsonb_agg(to_jsonb(r)-'prepared_auth_id' order by r.id),'[]') into registers from private.finance_asset_register_v1 r where r.tenant_id=t and r.entity_id=e and r.data_environment=env;
 select coalesce(jsonb_agg(to_jsonb(x)-'writing_transaction'-'author_auth_id'-'reviewer_auth_id' order by x.asset_id,x.period),'[]') into plans from private.finance_asset_plans_v1 x join private.finance_asset_register_v1 r on r.id=x.asset_id where r.tenant_id=t and r.entity_id=e and r.data_environment=env;
 select jsonb_build_object('registeredCount',count(*),'scheduledCount',count(*) filter(where x->>'amountCents' is not null),'postedCount',count(*) filter(where x#>>'{plan,status}'='posted'),
  'pendingCount',count(*) filter(where x->>'amountCents' is not null and coalesce(x#>>'{plan,status}','')<>'posted'),
  'status',case when count(*)=0 then 'no_register_records' when count(*) filter(where x->>'amountCents' is not null)=0 then 'no_due_this_month' when count(*) filter(where x->>'amountCents' is not null and coalesce(x#>>'{plan,status}','')<>'posted')>0 then 'pending_amortization' else 'posted_records' end)
  into summary from jsonb_array_elements(w->'items') x;
 s:=s||jsonb_build_object('assets',summary,'assetRegister',registers,'assetPlans',plans);
 if octet_length(s::text)>16777216 then raise exception '月結來源超過16MB，請聯絡管理員安排分批封存' using errcode='54000';end if;
 return s||jsonb_build_object('sourceFingerprint',encode(sha256(convert_to(s::text,'UTF8')),'hex'));
end $$;
revoke all on function private.finance_month_source_before_assets_v1(text,text,text),private.finance_month_source_v1(text,text,text) from public,anon,authenticated,service_role;
