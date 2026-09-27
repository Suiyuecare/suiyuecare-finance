-- Forward-only controls. No existing accounting entries or employee values change.
set local lock_timeout='5s';
set local statement_timeout='120s';
-- Identity isolation applies even when older permissive policies are OR-combined.
alter policy finance_identity_links_manage_people_admin_20260610 on public.finance_identity_links
 using(tenant_id=(select public.current_tenant_id()) and (select public.current_finance_role()) in('ceo','admin_director','hr'))
 with check(tenant_id=(select public.current_tenant_id()) and (select public.current_finance_role()) in('ceo','admin_director','hr'));
alter policy finance_portal_roles_select_authenticated on public.finance_portal_roles to authenticated
 using(tenant_id=(select public.current_tenant_id()));
create policy finance_identity_tenant_boundary_v1 on public.finance_identity_links
 as restrictive for all to authenticated
 using (tenant_id=(select public.current_tenant_id()))
 with check (tenant_id=(select public.current_tenant_id()));
create policy finance_portal_role_tenant_boundary_v1 on public.finance_portal_roles
 as restrictive for all to authenticated
 using (tenant_id=(select public.current_tenant_id()))
 with check (tenant_id=(select public.current_tenant_id()));
create or replace function private.finance_identity_reference_scope_v1() returns trigger
 language plpgsql security definer set search_path='' as $$
begin
 if new.finance_user_id is not null and not exists(select 1 from public.finance_users u where u.id=new.finance_user_id and u.tenant_id=new.tenant_id) then
  raise exception '身分連結的人員不屬於目前租戶' using errcode='23514';
 end if;
 if new.logging_role_id is not null and not exists(select 1 from public.finance_portal_roles r where r.id=new.logging_role_id and r.tenant_id=new.tenant_id) then
  raise exception '身分連結的角色不屬於目前租戶' using errcode='23514';
 end if;
 return new;
end $$;
revoke all on function private.finance_identity_reference_scope_v1() from public,anon,authenticated,service_role;
create trigger finance_identity_reference_scope_v1 before insert or update of tenant_id,finance_user_id,logging_role_id
 on public.finance_identity_links for each row execute function private.finance_identity_reference_scope_v1();
create unique index if not exists finance_users_tenant_identity_v1 on public.finance_users(tenant_id,id);
create unique index if not exists finance_portal_roles_tenant_identity_v1 on public.finance_portal_roles(tenant_id,id);
alter table public.finance_identity_links add constraint finance_identity_user_tenant_v1 foreign key(tenant_id,finance_user_id) references public.finance_users(tenant_id,id);
alter table public.finance_identity_links add constraint finance_identity_role_tenant_v1 foreign key(tenant_id,logging_role_id) references public.finance_portal_roles(tenant_id,id);

-- Posting and closing hold the same transaction lock. This function must be
-- VOLATILE so the close check receives a fresh READ COMMITTED snapshot after wait.
create or replace function private.finance_assert_period_open(p_tenant_id uuid,p_data_environment text,p_entity_id text,p_posting_date date,p_action text)
 returns void language plpgsql volatile security definer set search_path='' as $$
begin
 if p_tenant_id is null or coalesce(p_data_environment,'') not in ('production','test') or nullif(btrim(p_entity_id),'') is null or p_posting_date is null then
  raise exception '帳務期間檢查缺少租戶、環境、法人或日期' using errcode='22023';
 end if;
 perform pg_advisory_xact_lock(hashtextextended('finance_period|'||p_tenant_id::text||'|'||p_data_environment||'|'||p_entity_id||'|'||to_char(p_posting_date,'YYYY-MM'),0));
 if exists(select 1 from public.period_closes c where c.tenant_id=p_tenant_id and c.data_environment=p_data_environment and c.entity_id=p_entity_id and c.period=to_char(p_posting_date,'YYYY-MM') and c.status='closed') then
  raise exception '法人 % 的 % 會計期間已關閉，禁止執行 %',p_entity_id,to_char(p_posting_date,'YYYY-MM'),coalesce(nullif(p_action,''),'帳務入帳') using errcode='23514';
 end if;
end $$;
create or replace function private.finance_ledger_period_guard_v1() returns trigger
 language plpgsql security definer set search_path='' as $$
begin
 if tg_op='DELETE' then
  perform private.finance_assert_period_open(old.tenant_id,old.data_environment,old.entity_id,old.entry_date,'刪除分類帳');return old;
 end if;
 if tg_op='UPDATE' then
  perform private.finance_assert_period_open(old.tenant_id,old.data_environment,old.entity_id,old.entry_date,'更正分類帳');
 end if;
 perform private.finance_assert_period_open(new.tenant_id,new.data_environment,new.entity_id,new.entry_date,'分類帳入帳');return new;
end $$;
revoke all on function private.finance_ledger_period_guard_v1() from public,anon,authenticated,service_role;
create trigger aa_finance_ledger_period_guard_v1 before insert or update or delete on public.ledger_entries
 for each row execute function private.finance_ledger_period_guard_v1();
create table private.finance_period_close_events_v1(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,entity_id text not null,data_environment text not null,
 period text not null,status text not null,actor_id text not null,reason text not null,debit numeric,credit numeric,
 created_at timestamptz not null default clock_timestamp()
);
alter table private.finance_period_close_events_v1 enable row level security;
revoke all on private.finance_period_close_events_v1 from public,anon,authenticated,service_role;
create or replace function private.finance_period_close_guard_v1() returns trigger
 language plpgsql security definer set search_path='' as $$
declare a jsonb; dr numeric; cr numeric;
begin
 if tg_op='DELETE' then raise exception '關帳紀錄不可刪除；需由執行長註明原因重新開帳' using errcode='23514';end if;
 if auth.uid() is null or new.tenant_id is distinct from public.current_tenant_id() or public.is_finance_accounting() is distinct from true then
  raise exception '未授權此法人關帳' using errcode='42501';
 end if;
 a:=private.finance_reporting_actor_v1(new.entity_id,new.data_environment);
 if coalesce(new.period,'') !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' or coalesce(new.status,'') not in ('closed','open') then raise exception '關帳月份或狀態無效' using errcode='22023';end if;
 if tg_op='UPDATE' and (old.tenant_id,old.entity_id,old.period,old.data_environment) is distinct from (new.tenant_id,new.entity_id,new.period,new.data_environment) then raise exception '關帳範圍不可變更' using errcode='23514';end if;
 if tg_op='UPDATE' and old.status='closed' and new.status='open' and(public.current_finance_role() is distinct from 'ceo' or nullif(btrim(coalesce(to_jsonb(new)->>'note','')),'') is null or to_jsonb(new)->>'note' is not distinct from to_jsonb(old)->>'note') then
  raise exception '重新開帳須由執行長填寫新的原因' using errcode='42501';
 end if;
 perform pg_advisory_xact_lock(hashtextextended('finance_period|'||new.tenant_id::text||'|'||new.data_environment||'|'||new.entity_id||'|'||new.period,0));
 if new.status='closed' then
  select coalesce(sum(l.debit),0),coalesce(sum(l.credit),0) into dr,cr from public.ledger_entries l
   where l.tenant_id=new.tenant_id and l.data_environment=new.data_environment and l.entity_id=new.entity_id
     and l.entry_date>=to_date(new.period||'-01','YYYY-MM-DD') and l.entry_date<(to_date(new.period||'-01','YYYY-MM-DD')+interval '1 month');
  if abs(dr-cr)>=0.005 then raise exception '正式分類帳借貸不平，不能關帳（差額 %）',dr-cr using errcode='23514';end if;
 end if;
 insert into private.finance_period_close_events_v1(tenant_id,entity_id,data_environment,period,status,actor_id,reason,debit,credit)
  values(new.tenant_id,new.entity_id,new.data_environment,new.period,new.status,a->>'actorId',coalesce(to_jsonb(new)->>'note',''),dr,cr);
 return new;
end $$;
revoke all on function private.finance_period_close_guard_v1() from public,anon,authenticated,service_role;
create trigger finance_period_close_guard_v1 before insert or update or delete on public.period_closes
 for each row execute function private.finance_period_close_guard_v1();
create policy finance_period_close_tenant_boundary_v1 on public.period_closes as restrictive for all to authenticated
 using(tenant_id=(select public.current_tenant_id())) with check(tenant_id=(select public.current_tenant_id()));
create index if not exists finance_close_balance_scope_v1 on public.ledger_entries(tenant_id,data_environment,entity_id,entry_date);

-- Original copies: private bucket, immutable objects and immutable sealed manifests.
insert into storage.buckets(id,name,public,file_size_limit) values('finance-audit-archives','finance-audit-archives',false,52428800)
 on conflict(id) do nothing;
create table public.finance_document_archives_v1(
 id uuid primary key,tenant_id uuid not null references public.tenants(id),entity_id text not null,period text not null,
 manifest jsonb not null,created_by text not null,created_at timestamptz not null default clock_timestamp(),
 check(period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
);
alter table public.finance_document_archives_v1 enable row level security;
alter table public.finance_document_archives_v1 force row level security;
revoke all on public.finance_document_archives_v1 from public,anon,authenticated,service_role;
create index finance_document_archives_scope_v1 on public.finance_document_archives_v1(tenant_id,entity_id,period,created_at);
create function private.finance_archive_path_allowed_v1(p_path text) returns boolean
 language plpgsql stable security definer set search_path='' as $$
declare parts text[]:=string_to_array(p_path,'/');a jsonb;
begin
 if auth.uid() is null or p_path is null or cardinality(parts)<>5 or parts[1] is distinct from public.current_tenant_id()::text or parts[2] !~ '^[A-Za-z0-9_-]{1,80}$' or parts[3] !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' or parts[4] !~ '^[0-9a-f-]{36}$' or parts[5] !~ '^[A-Za-z0-9._-]{1,180}$' then return false;end if;
 a:=private.finance_reporting_actor_v1(parts[2],'production');
 return true;
exception when insufficient_privilege then return false;
end $$;
revoke all on function private.finance_archive_path_allowed_v1(text) from public,anon,authenticated,service_role;
grant usage on schema private to authenticated;
grant execute on function private.finance_archive_path_allowed_v1(text) to authenticated;
create policy finance_archive_insert_v1 on storage.objects for insert to authenticated
 with check(bucket_id='finance-audit-archives' and public.is_finance_accounting() and private.finance_archive_path_allowed_v1(name));
create policy finance_archive_select_v1 on storage.objects for select to authenticated
 using(bucket_id='finance-audit-archives' and private.finance_archive_path_allowed_v1(name));
create policy finance_archive_read_boundary_v1 on storage.objects as restrictive for select to authenticated
 using(bucket_id<>'finance-audit-archives' or private.finance_archive_path_allowed_v1(name));
create policy finance_archive_write_boundary_v1 on storage.objects as restrictive for insert to authenticated
 with check(bucket_id<>'finance-audit-archives' or(private.finance_archive_path_allowed_v1(name) and not exists(select 1 from public.finance_document_archives_v1 a where a.id::text=split_part(name,'/',4))));
create policy finance_archive_no_update_v1 on storage.objects as restrictive for update to authenticated
 using(bucket_id<>'finance-audit-archives') with check(bucket_id<>'finance-audit-archives');
create policy finance_archive_no_delete_v1 on storage.objects as restrictive for delete to authenticated using(bucket_id<>'finance-audit-archives');
create policy finance_archive_no_anon_v1 on storage.objects as restrictive for all to anon
 using(bucket_id<>'finance-audit-archives') with check(bucket_id<>'finance-audit-archives');
-- Storage policy must not access a manifest table hidden from authenticated.
create function private.finance_archive_is_sealed_v1(p_id text) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.finance_document_archives_v1 where id::text=p_id)$$;
revoke all on function private.finance_archive_is_sealed_v1(text) from public,anon,authenticated,service_role;
grant execute on function private.finance_archive_is_sealed_v1(text) to authenticated;
alter policy finance_archive_write_boundary_v1 on storage.objects with check(bucket_id<>'finance-audit-archives' or(public.is_finance_accounting() and private.finance_archive_path_allowed_v1(name) and not private.finance_archive_is_sealed_v1(split_part(name,'/',4))));
create function public.finance_seal_document_archive_v1(p_entity_id text,p_period text,p_manifest jsonb) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare a jsonb:=private.finance_reporting_actor_v1(p_entity_id,'production');t uuid:=(a->>'tenantId')::uuid;f jsonb;archive_id uuid;path text;size bigint;obj_size bigint;existing public.finance_document_archives_v1%rowtype;
begin
 if not coalesce((a->>'canEditWorkpaper')::boolean,false) then raise exception '未授權封存原件' using errcode='42501';end if;
 if coalesce(p_period,'') !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' or coalesce(p_manifest->>'version','')<>'1' or p_manifest->>'tenantId' is distinct from t::text or p_manifest->>'dataEnvironment' is distinct from 'production' or p_manifest->'scope'->>'entityId' is distinct from p_entity_id or p_manifest->'scope'->>'period' is distinct from p_period or jsonb_typeof(p_manifest->'files') is distinct from 'array' or jsonb_array_length(p_manifest->'files') not between 1 and 10000 or octet_length(p_manifest::text)>8388608 then raise exception '原件封存清單無效' using errcode='22023';end if;
 archive_id:=(p_manifest->>'archiveId')::uuid;
 if archive_id is null then raise exception '缺少原件封存識別碼' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('finance_archive|'||archive_id::text,0));
 select * into existing from public.finance_document_archives_v1 where id=archive_id;
 if found then
  if existing.tenant_id<>t or existing.entity_id<>p_entity_id or existing.period<>p_period or existing.manifest<>p_manifest then raise exception '封存重試內容不一致' using errcode='23514';end if;
  return jsonb_build_object('ok',true,'archiveId',archive_id,'replayed',true,'fileCount',jsonb_array_length(p_manifest->'files'));
 end if;
 if (select count(distinct value->>'path') from jsonb_array_elements(p_manifest->'files'))<>jsonb_array_length(p_manifest->'files') then raise exception '封存檔案路徑重複' using errcode='22023';end if;
 for f in select value from jsonb_array_elements(p_manifest->'files') loop
  path:=f->>'path';
  if not private.finance_archive_path_allowed_v1(path) or split_part(path,'/',2)<>p_entity_id or split_part(path,'/',3)<>p_period or split_part(path,'/',4)<>archive_id::text or coalesce(f->>'sha256','') !~ '^[a-f0-9]{64}$' or coalesce(f->>'size','') !~ '^[0-9]+$' or nullif(btrim(f->>'name'),'') is null or coalesce(f->>'sourceType','') not in ('expense_requests','invoices','bills') or nullif(f->>'sourceId','') is null then raise exception '原件封存檔案或來源無效' using errcode='22023';end if;
  size:=(f->>'size')::bigint;
  select (o.metadata->>'size')::bigint into obj_size from storage.objects o where o.bucket_id='finance-audit-archives' and o.name=path;
  if not found or size<1 or size>52428800 or obj_size is distinct from size then raise exception '原件尚未完整上傳或大小不符' using errcode='23514';end if;
  if f->>'sourceType'='expense_requests' and not exists(select 1 from public.expense_requests r where r.id=f->>'sourceId' and r.tenant_id=t and r.entity_id=p_entity_id and r.data_environment='production' and to_char(coalesce(r.request_date,(r.created_at at time zone 'UTC')::date),'YYYY-MM')=p_period) then raise exception '封存申請來源不屬於此法人或月份' using errcode='42501';end if;
  if f->>'sourceType'='invoices' and not exists(select 1 from public.invoices r where r.id=f->>'sourceId' and r.tenant_id=t and r.entity_id=p_entity_id and r.data_environment='production' and to_char(coalesce(r.invoice_date,(r.created_at at time zone 'UTC')::date),'YYYY-MM')=p_period) then raise exception '封存發票來源不屬於此法人或月份' using errcode='42501';end if;
  if f->>'sourceType'='bills' and not exists(select 1 from public.bills r where r.id=f->>'sourceId' and r.tenant_id=t and r.entity_id=p_entity_id and r.data_environment='production' and to_char(coalesce((r.created_at at time zone 'UTC')::date,r.due_date),'YYYY-MM')=p_period) then raise exception '封存繳費來源不屬於此法人或月份' using errcode='42501';end if;
 end loop;
 insert into public.finance_document_archives_v1(id,tenant_id,entity_id,period,manifest,created_by) values(archive_id,t,p_entity_id,p_period,p_manifest,a->>'actorId');
 return jsonb_build_object('ok',true,'archiveId',archive_id,'replayed',false,'fileCount',jsonb_array_length(p_manifest->'files'));
end $$;
create function public.finance_document_archives_v1(p_entity_id text,p_period text) returns jsonb
 language plpgsql stable security definer set search_path='' as $$
declare a jsonb:=private.finance_reporting_actor_v1(p_entity_id,'production');result jsonb;
begin
 select coalesce(jsonb_agg(jsonb_build_object('archiveId',id,'manifest',manifest,'createdBy',created_by,'createdAt',created_at) order by created_at desc),'[]') into result from public.finance_document_archives_v1 where tenant_id=(a->>'tenantId')::uuid and entity_id=p_entity_id and period=p_period;
 return jsonb_build_object('ok',true,'archives',result);
end $$;
revoke all on function public.finance_seal_document_archive_v1(text,text,jsonb),public.finance_document_archives_v1(text,text) from public,anon,authenticated,service_role;
grant execute on function public.finance_seal_document_archive_v1(text,text,jsonb),public.finance_document_archives_v1(text,text) to authenticated;
create table private.finance_archive_verifications_v1(
 id uuid primary key default gen_random_uuid(),archive_id uuid not null references public.finance_document_archives_v1(id),
 verified_by text not null,verified_count integer not null,verified_at timestamptz not null default clock_timestamp(),
 method text not null default 'authenticated_client_sha256_readback'
);
alter table private.finance_archive_verifications_v1 enable row level security;
revoke all on private.finance_archive_verifications_v1 from public,anon,authenticated,service_role;
create function public.finance_verify_document_archive_v1(p_archive_id uuid,p_verified_count integer) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare row public.finance_document_archives_v1%rowtype;a jsonb;
begin
 select * into row from public.finance_document_archives_v1 where id=p_archive_id and tenant_id=public.current_tenant_id();
 if not found then raise exception '封存紀錄不存在或未授權' using errcode='42501';end if;
 a:=private.finance_reporting_actor_v1(row.entity_id,'production');
 if p_verified_count is null or p_verified_count<>jsonb_array_length(row.manifest->'files') then raise exception '原件驗證件數不符' using errcode='23514';end if;
 insert into private.finance_archive_verifications_v1(archive_id,verified_by,verified_count) values(row.id,a->>'actorId',p_verified_count);
 return jsonb_build_object('ok',true,'archiveId',row.id,'method','authenticated_client_sha256_readback');
end $$;
revoke all on function public.finance_verify_document_archive_v1(uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.finance_verify_document_archive_v1(uuid,integer) to authenticated;

-- Second-person workpaper review without changing historical reviewed values.
create table private.finance_reporting_rule_preparers_v1(
 tenant_id uuid not null,data_environment text not null,entity_id text not null,section text not null,rule_id text not null,prepared_by text not null,prepared_revision bigint not null,
 primary key(tenant_id,data_environment,entity_id,section,rule_id)
);
alter table private.finance_reporting_rule_preparers_v1 enable row level security;
revoke all on private.finance_reporting_rule_preparers_v1 from public,anon,authenticated,service_role;
alter function public.finance_reporting_profile_save_v1(text,bigint,jsonb,text,text) rename to finance_reporting_profile_save_pre_review_v1;
revoke all on function public.finance_reporting_profile_save_pre_review_v1(text,bigint,jsonb,text,text) from public,anon,authenticated,service_role;
create function public.finance_reporting_profile_save_v1(p_entity_id text,p_expected_revision bigint,p_profile jsonb,p_reason text,p_data_environment text default 'production') returns jsonb
 language plpgsql security definer set search_path='' as $$
declare a jsonb:=private.finance_reporting_actor_v1(p_entity_id,p_data_environment);t uuid:=(a->>'tenantId')::uuid;actor text:=a->>'actorId';old jsonb;row jsonb;prev jsonb;rule_section text;preparer text;result jsonb;ignore text[]:=array['status','reviewReason','reviewedBy','reviewedAt','reviewedRevision'];
begin
 if not coalesce((a->>'canEditWorkpaper')::boolean,false) then raise exception '未授權修改報表底稿' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('finance_reporting_profile|'||t::text||'|'||p_data_environment||'|'||p_entity_id,0));
 select profile into old from public.finance_reporting_profiles where tenant_id=t and data_environment=p_data_environment and entity_id=p_entity_id;
 old:=coalesce(old,private.finance_reporting_default_v1());
 foreach rule_section in array array['budgets','allocations','eliminations'] loop
  for row in select value from jsonb_array_elements(coalesce(p_profile->rule_section,'[]'::jsonb)) loop
   select value into prev from jsonb_array_elements(coalesce(old->rule_section,'[]'::jsonb)) where value->>'id'=row->>'id';
   if row->>'status'='reviewed' and coalesce(prev->>'status','')<>'reviewed' then
    if prev is null or (row-ignore) is distinct from(prev-ignore) then raise exception '請先保存草稿，再由另一位授權人員覆核' using errcode='23514';end if;
    select prepared_by into preparer from private.finance_reporting_rule_preparers_v1 where tenant_id=t and data_environment=p_data_environment and entity_id=p_entity_id and finance_reporting_rule_preparers_v1.section=rule_section and rule_id=row->>'id';
    if preparer is null then
     -- Existing draft: reconstruct the actor at its latest business-value change.
     select x.actor_id into preparer from (
      select h.revision,h.actor_id,v.value-ignore as biz,lag(v.value-ignore) over(order by h.revision) as prior_biz
       from private.finance_reporting_profile_revisions_v1 h cross join lateral jsonb_array_elements(coalesce(h.profile->rule_section,'[]'::jsonb)) v
       where h.tenant_id=t and h.data_environment=p_data_environment and h.entity_id=p_entity_id and v.value->>'id'=row->>'id'
     ) x where x.biz=prev-ignore and x.biz is distinct from x.prior_biz order by x.revision desc limit 1;
    end if;
    if preparer is null or preparer=actor then raise exception '編製人不得覆核自己的設定，請另一位授權人員確認' using errcode='42501';end if;
   end if;
  end loop;
 end loop;
 result:=public.finance_reporting_profile_save_pre_review_v1(p_entity_id,p_expected_revision,p_profile,p_reason,p_data_environment);
 foreach rule_section in array array['budgets','allocations','eliminations'] loop
  for row in select value from jsonb_array_elements(coalesce(p_profile->rule_section,'[]'::jsonb)) loop
   select value into prev from jsonb_array_elements(coalesce(old->rule_section,'[]'::jsonb)) where value->>'id'=row->>'id';
   if (row-ignore) is distinct from(prev-ignore) then
    insert into private.finance_reporting_rule_preparers_v1 values(t,p_data_environment,p_entity_id,rule_section,row->>'id',actor,p_expected_revision+1)
     on conflict(tenant_id,data_environment,entity_id,section,rule_id) do update set prepared_by=excluded.prepared_by,prepared_revision=excluded.prepared_revision;
   end if;
  end loop;
 end loop;
 return result;
end $$;
revoke all on function public.finance_reporting_profile_save_v1(text,bigint,jsonb,text,text) from public,anon,authenticated,service_role;
grant execute on function public.finance_reporting_profile_save_v1(text,bigint,jsonb,text,text) to authenticated;
notify pgrst,'reload schema';
