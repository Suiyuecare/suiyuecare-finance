-- Owner-scoped cloud drafts and resumable staging. Staging is never a formal
-- invoice/bill and never creates a notification. Publication is one transaction.
set local lock_timeout = '5s';
set local statement_timeout = '120s';

create table private.finance_cloud_drafts_v1 (
  id uuid primary key,
  tenant_id uuid not null references public.tenants(id),
  owner_auth_uid uuid not null,
  owner_finance_user_id text not null,
  data_environment text not null check (data_environment in ('production','test')),
  document_type text not null check (document_type in ('invoice','bill')),
  revision bigint not null default 1 check (revision > 0),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  files jsonb not null default '[]'::jsonb check (jsonb_typeof(files) = 'array'),
  content_fingerprint text not null,
  state text not null default 'draft' check (state in ('draft','staging','ready','committed','discarded')),
  expected_count integer check (expected_count between 1 and 2000),
  operation_key text not null unique,
  staged_fingerprint text,
  result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  committed_at timestamptz
);
create index finance_cloud_drafts_owner_v1 on private.finance_cloud_drafts_v1
  (tenant_id,owner_auth_uid,owner_finance_user_id,data_environment,updated_at desc,id);
create index finance_cloud_drafts_files_v1 on private.finance_cloud_drafts_v1 using gin(files jsonb_path_ops)
  where state in ('draft','staging','ready');
create table private.finance_cloud_draft_items_v1 (
  draft_id uuid not null references private.finance_cloud_drafts_v1(id) on delete cascade,
  ordinal integer not null check (ordinal between 0 and 1999),
  client_item_key text not null,
  item jsonb not null check (jsonb_typeof(item) = 'object'),
  item_fingerprint text not null,
  primary key (draft_id,ordinal),
  unique(draft_id,client_item_key)
);
alter table private.finance_cloud_drafts_v1 enable row level security;
alter table private.finance_cloud_draft_items_v1 enable row level security;
revoke all on private.finance_cloud_drafts_v1, private.finance_cloud_draft_items_v1
  from public,anon,authenticated,service_role;

create function private.finance_cloud_actor_v1(p_environment text)
returns public.finance_users language plpgsql stable security invoker set search_path = ''
as $fn$
declare a public.finance_users%rowtype;
begin
  if p_environment is null or p_environment not in ('production','test') then
    raise exception '資料環境不正確' using errcode='22023';
  end if;
  a := public.current_finance_user();
  if auth.uid() is null or a.id is null or a.auth_user_id is distinct from auth.uid()
     or a.tenant_id is distinct from public.current_tenant_id() or a.active is not true then
    raise exception '登入或人員權限已失效，請重新登入' using errcode='42501';
  end if;
  return a;
end;
$fn$;

-- Only recorded, currently present, same-owner objects can be called saved.
-- A browser File, data URL, or guessed path cannot become a cloud attachment.
create function private.finance_cloud_check_files_v1(p_files jsonb,p_actor public.finance_users,p_kind text,p_environment text)
returns void language plpgsql security invoker set search_path = ''
as $fn$
declare f jsonb; v_path text;
begin
  if p_files is null or pg_catalog.jsonb_typeof(p_files) is distinct from 'array'
     or pg_catalog.jsonb_array_length(p_files)>100 then
    raise exception '雲端附件清單格式或件數錯誤' using errcode='22023';
  end if;
  for f in select value from pg_catalog.jsonb_array_elements(p_files) loop
    v_path := f->>'path';
    if pg_catalog.jsonb_typeof(f) is distinct from 'object'
       or coalesce(f->>'bucket','') <> 'finance-attachments'
       or coalesce(v_path,'')='' or f ? 'url' or f ? 'dataUrl' then
      raise exception '附件尚未確認上傳，不能標記為雲端保存' using errcode='22023';
    end if;
    perform 1 from public.file_attachments a join storage.objects o
        on o.bucket_id=a.bucket_id and o.name=a.storage_path
      where a.tenant_id=p_actor.tenant_id and a.data_environment=p_environment
        and a.record_type=p_kind||'s' and a.uploaded_by=p_actor.id
        and a.bucket_id='finance-attachments' and a.storage_path=v_path
        and o.owner_id=auth.uid()::text
        and (o.metadata->>'size')::bigint>0
      for share of a,o;
    if not found then
      raise exception '附件不存在、尚未完成上傳或不屬於目前申請人' using errcode='42501';
    end if;
  end loop;
end;
$fn$;

create function private.finance_cloud_snapshot_v1(d private.finance_cloud_drafts_v1,p_include_payload boolean)
returns jsonb language sql stable security invoker set search_path = ''
as $fn$
  select pg_catalog.jsonb_build_object(
    'ok',true,'id',d.id,'documentType',d.document_type,'dataEnvironment',d.data_environment,
    'revision',d.revision,'state',d.state,'operationKey',d.operation_key,'title',coalesce(d.payload->>'title',''),
    'contentFingerprint',d.content_fingerprint,'stagedFingerprint',d.staged_fingerprint,
    'expectedCount',d.expected_count,
    'stagedCount',(select pg_catalog.count(*) from private.finance_cloud_draft_items_v1 i where i.draft_id=d.id),
    'result',d.result,'createdAt',d.created_at,'updatedAt',d.updated_at,
    'payload',case when p_include_payload then d.payload else null end,
    'files',case when p_include_payload then d.files else null end)
$fn$;

create function private.finance_cloud_has_unstored_file_v1(p_value jsonb)
returns boolean language plpgsql immutable security invoker set search_path = ''
as $fn$
declare child jsonb;
begin
  if pg_catalog.jsonb_typeof(p_value)='string' then return (p_value#>>'{}')~*'^(blob:|data:[^,]*,)';end if;
  if pg_catalog.jsonb_typeof(p_value)='object' then
    for child in select value from pg_catalog.jsonb_each(p_value) loop
      if private.finance_cloud_has_unstored_file_v1(child) then return true;end if;
    end loop;
  elsif pg_catalog.jsonb_typeof(p_value)='array' then
    for child in select value from pg_catalog.jsonb_array_elements(p_value) loop
      if private.finance_cloud_has_unstored_file_v1(child) then return true;end if;
    end loop;
  end if;
  return false;
end;
$fn$;

create function public.finance_cloud_draft_save_v1(
  p_draft_id uuid,p_expected_revision bigint,p_document_type text,p_payload jsonb,
  p_files jsonb default '[]'::jsonb,p_data_environment text default 'production'
) returns jsonb language plpgsql security definer set search_path = ''
as $fn$
declare a public.finance_users%rowtype; d private.finance_cloud_drafts_v1%rowtype; fp text;
begin
  a := private.finance_cloud_actor_v1(p_data_environment);
  if p_draft_id is null or p_expected_revision is null or p_expected_revision<0
     or p_document_type is null or p_document_type not in ('invoice','bill')
     or pg_catalog.jsonb_typeof(p_payload) is distinct from 'object'
     or pg_catalog.octet_length(p_payload::text)>8388608 then
    raise exception '草稿格式、版本或大小錯誤' using errcode='22023';
  end if;
  if private.finance_cloud_has_unstored_file_v1(p_payload) then raise exception '本機檔案尚未上傳，請先完成上傳再保存雲端草稿' using errcode='22023';end if;
  perform private.finance_cloud_check_files_v1(p_files,a,p_document_type,p_data_environment);
  fp := private.finance_income_request_digest(pg_catalog.jsonb_build_object('kind',p_document_type,'payload',p_payload,'files',p_files));
  -- A UUID insert and its replay are serialized even before the row exists.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('finance-cloud:'||p_draft_id::text,0));
  select * into d from private.finance_cloud_drafts_v1 where id=p_draft_id for update;
  if found then
    if d.tenant_id<>a.tenant_id or d.owner_auth_uid<>auth.uid() or d.owner_finance_user_id<>a.id
       or d.data_environment<>p_data_environment or d.document_type<>p_document_type then
      raise exception '找不到本人可用的草稿' using errcode='42501';
    end if;
    if d.state<>'draft' then raise exception '送件內容已鎖定，請確認原送件結果' using errcode='55000';end if;
    if d.content_fingerprint=fp and d.revision in (p_expected_revision,p_expected_revision+1) then
      return private.finance_cloud_snapshot_v1(d,true)||'{"idempotentReplay":true}'::jsonb;
    end if;
    if d.revision<>p_expected_revision then raise exception '其他裝置已修改草稿，請重新讀取；目前內容仍保留' using errcode='PT409';end if;
    update private.finance_cloud_drafts_v1 set payload=p_payload,files=p_files,
      revision=revision+1,content_fingerprint=fp,updated_at=pg_catalog.now()
      where id=d.id returning * into d;
  else
    if p_expected_revision<>0 then raise exception '草稿不存在或版本不正確' using errcode='PT409';end if;
    insert into private.finance_cloud_drafts_v1(id,tenant_id,owner_auth_uid,owner_finance_user_id,
      data_environment,document_type,payload,files,content_fingerprint,operation_key)
    values(p_draft_id,a.tenant_id,auth.uid(),a.id,p_data_environment,p_document_type,p_payload,p_files,fp,
      'cloud_'||p_document_type||'_'||p_draft_id::text) returning * into d;
  end if;
  return private.finance_cloud_snapshot_v1(d,true);
end;
$fn$;

create function public.finance_cloud_draft_read_v1(p_draft_id uuid,p_data_environment text default 'production')
returns jsonb language plpgsql stable security definer set search_path = ''
as $fn$
declare a public.finance_users%rowtype; d private.finance_cloud_drafts_v1%rowtype;
begin
  a := private.finance_cloud_actor_v1(p_data_environment);
  select * into d from private.finance_cloud_drafts_v1 where id=p_draft_id
    and tenant_id=a.tenant_id and owner_auth_uid=auth.uid() and owner_finance_user_id=a.id and data_environment=p_data_environment;
  if not found then raise exception '找不到本人可用的草稿' using errcode='42501';end if;
  return private.finance_cloud_snapshot_v1(d,true);
end;
$fn$;

create function public.finance_cloud_draft_list_v1(p_data_environment text default 'production',p_before_time timestamptz default null,p_before_id uuid default null,p_limit integer default 50)
returns jsonb language plpgsql stable security definer set search_path = ''
as $fn$
declare a public.finance_users%rowtype; rows jsonb;
begin
  a := private.finance_cloud_actor_v1(p_data_environment);
  if p_limit is null or p_limit not between 1 and 100 or (p_before_time is null)<>(p_before_id is null) then
    raise exception '分頁參數錯誤' using errcode='22023';end if;
  select coalesce(pg_catalog.jsonb_agg(private.finance_cloud_snapshot_v1(d,false) order by d.updated_at desc,d.id desc),'[]'::jsonb)
    into rows from (select * from private.finance_cloud_drafts_v1
      where tenant_id=a.tenant_id and owner_auth_uid=auth.uid() and owner_finance_user_id=a.id
        and data_environment=p_data_environment and state<>'discarded'
        and (p_before_time is null or (updated_at,id)<(p_before_time,p_before_id))
      order by updated_at desc,id desc limit p_limit) d;
  return pg_catalog.jsonb_build_object('ok',true,'rows',rows,'pageSize',p_limit,
    'nextCursor',case when pg_catalog.jsonb_array_length(rows)=p_limit then
      pg_catalog.jsonb_build_object('id',rows->-1->>'id','updatedAt',rows->-1->>'updatedAt') else null end);
end;
$fn$;

create function public.finance_cloud_submission_begin_v1(p_draft_id uuid,p_expected_revision bigint,p_expected_count integer,p_data_environment text default 'production')
returns jsonb language plpgsql security definer set search_path = ''
as $fn$
declare a public.finance_users%rowtype; d private.finance_cloud_drafts_v1%rowtype;
begin
  a := private.finance_cloud_actor_v1(p_data_environment);
  select * into d from private.finance_cloud_drafts_v1 where id=p_draft_id
    and tenant_id=a.tenant_id and owner_auth_uid=auth.uid() and owner_finance_user_id=a.id and data_environment=p_data_environment for update;
  if not found then raise exception '找不到本人可用的草稿' using errcode='42501';end if;
  if p_expected_revision is null or d.revision<>p_expected_revision then raise exception '草稿已更新，請重新讀取' using errcode='PT409';end if;
  if p_expected_count is null or p_expected_count not between 1 and 2000 then raise exception '一張申請最多 2000 筆' using errcode='22023';end if;
  if pg_catalog.jsonb_typeof(d.payload->'items') is distinct from 'array' or pg_catalog.jsonb_array_length(d.payload->'items')<>p_expected_count then
    raise exception '請先將完整送件明細保存到雲端草稿' using errcode='23514';end if;
  if d.state in ('staging','ready','committed') and d.expected_count=p_expected_count then return private.finance_cloud_snapshot_v1(d,true);end if;
  if d.state<>'draft' then raise exception '原送件筆數或狀態不同，請查核原結果' using errcode='55000';end if;
  perform private.finance_cloud_check_files_v1(d.files,a,d.document_type,p_data_environment);
  update private.finance_cloud_drafts_v1 set state='staging',expected_count=p_expected_count,updated_at=pg_catalog.now() where id=d.id returning * into d;
  return private.finance_cloud_snapshot_v1(d,true);
end;
$fn$;

create function private.finance_cloud_assert_items_v1(p_items jsonb)
returns void language plpgsql immutable security invoker set search_path = ''
as $fn$
begin
  if pg_catalog.jsonb_typeof(p_items) is distinct from 'array' or pg_catalog.jsonb_array_length(p_items) not between 1 and 2000 then
    raise exception '一張申請必須有 1 到 2000 筆' using errcode='22023';end if;
  if exists(select 1 from pg_catalog.jsonb_array_elements(p_items) x where pg_catalog.jsonb_typeof(x)<>'object' or coalesce(x->>'client_item_key','')!~'^[A-Za-z0-9][A-Za-z0-9._:-]{2,199}$') then
    raise exception '明細識別碼格式錯誤' using errcode='22023';end if;
  if (select pg_catalog.count(*) from pg_catalog.jsonb_array_elements(p_items))<>(select pg_catalog.count(distinct x->>'client_item_key') from pg_catalog.jsonb_array_elements(p_items) x) then
    raise exception '明細識別碼重複' using errcode='23505';end if;
end;
$fn$;

create function private.finance_cloud_route_v1(p_steps jsonb)
returns jsonb language sql immutable security invoker set search_path = ''
as $fn$
  select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(
    pg_catalog.lower(coalesce(nullif(s.value->>'rk',''),nullif(s.value->>'role_key',''),nullif(s.value->>'roleKey',''),s.value->>'role','')),
    coalesce(nullif(s.value->>'uid',''),nullif(s.value->>'user_id',''),nullif(s.value->>'userId',''),s.value->>'finance_user_id',''),
    coalesce(s.value->>'a',''),coalesce(s.value->>'autoSkip','false'),coalesce(s.value->>'autoSkipReason',''),coalesce(s.value->>'status','')
  ) order by s.ordinality) from pg_catalog.jsonb_array_elements(p_steps) with ordinality s(value,ordinality)
$fn$;

create function public.finance_cloud_submission_stage_v1(p_draft_id uuid,p_expected_revision bigint,p_start integer,p_items jsonb,p_data_environment text default 'production')
returns jsonb language plpgsql security definer set search_path = ''
as $fn$
declare a public.finance_users%rowtype; d private.finance_cloud_drafts_v1%rowtype; x jsonb; n integer; fp text; stored private.finance_cloud_draft_items_v1%rowtype; items jsonb;
begin
  a := private.finance_cloud_actor_v1(p_data_environment);
  select * into d from private.finance_cloud_drafts_v1 where id=p_draft_id
    and tenant_id=a.tenant_id and owner_auth_uid=auth.uid() and owner_finance_user_id=a.id and data_environment=p_data_environment for update;
  if not found then raise exception '找不到本人可用的草稿' using errcode='42501';end if;
  if p_expected_revision is null or d.revision<>p_expected_revision then raise exception '草稿已更新' using errcode='PT409';end if;
  if d.state not in ('staging','ready') then raise exception '此草稿目前不可上傳明細' using errcode='55000';end if;
  if pg_catalog.jsonb_typeof(p_items) is distinct from 'array' then raise exception '分段明細必須為陣列' using errcode='22023';end if;
  perform private.finance_income_assert_items_with_limit(p_items,100);
  if p_start is null or p_start<0 or p_start+pg_catalog.jsonb_array_length(p_items)>d.expected_count then raise exception '明細位置超出本張申請' using errcode='22023';end if;
  for x,n in select value,p_start+ordinality::integer-1 from pg_catalog.jsonb_array_elements(p_items) with ordinality loop
    if x is distinct from d.payload->'items'->n then raise exception '分段內容與已保存草稿不同' using errcode='PT409';end if;
    if pg_catalog.octet_length(x::text)>65536 then raise exception '明細內容過大' using errcode='22023';end if;
    perform private.finance_income_validate_scope(a.tenant_id,pg_catalog.btrim(x->>'entity_id'),pg_catalog.upper(pg_catalog.btrim(x->>'department_code')));
    perform private.finance_income_validate_submission_steps(x->'steps',a.id,a.tenant_id);
    if coalesce(x->>'amount','')!~'^[0-9]+([.][0-9]{1,2})?$' then raise exception '第 % 筆金額格式錯誤',n+1 using errcode='22003';end if;
    if d.document_type='invoice' then
      if coalesce(pg_catalog.btrim(x->>'buyer'),'')='' or coalesce(x->>'tax','')!~'^[0-9]+([.][0-9]{1,2})?$' or coalesce(x->>'total','')!~'^[0-9]+([.][0-9]{1,2})?$' then raise exception '第 % 筆發票資料不完整',n+1 using errcode='22023';end if;
      if (x->>'total')::numeric<=0 or (x->>'amount')::numeric+(x->>'tax')::numeric<>(x->>'total')::numeric then raise exception '第 % 筆發票金額不平衡',n+1 using errcode='23514';end if;
    else
      if coalesce(pg_catalog.btrim(x->>'payer_name'),'')='' or coalesce(pg_catalog.btrim(x->>'item'),'')='' or (x->>'amount')::numeric<=0 then raise exception '第 % 筆繳費單資料不完整',n+1 using errcode='22023';end if;
    end if;
    fp := private.finance_income_request_digest(x);
    select * into stored from private.finance_cloud_draft_items_v1 where draft_id=d.id and ordinal=n;
    if found then
      if stored.item_fingerprint<>fp or stored.item<>x then raise exception '此段已保存不同內容，請查核原草稿' using errcode='PT409';end if;
    else
      insert into private.finance_cloud_draft_items_v1 values(d.id,n,x->>'client_item_key',x,fp);
    end if;
  end loop;
  if (select pg_catalog.count(*) from private.finance_cloud_draft_items_v1 where draft_id=d.id)=d.expected_count then
    select pg_catalog.jsonb_agg(item order by ordinal) into items from private.finance_cloud_draft_items_v1 where draft_id=d.id;
    perform private.finance_cloud_assert_items_v1(items);
    -- One application has one company, department and approval route. Different
    -- reasons/companies are never merged merely because text looks similar.
    if (select pg_catalog.count(distinct pg_catalog.jsonb_build_array(entry.value->>'entity_id',entry.value->>'department_code',private.finance_cloud_route_v1(entry.value->'steps'))) from pg_catalog.jsonb_array_elements(items) entry(value))<>1 then
      raise exception '同張申請的法人、部門及簽核流程必須一致' using errcode='23514';end if;
    update private.finance_cloud_drafts_v1 set state='ready',staged_fingerprint=private.finance_income_request_digest(items),updated_at=pg_catalog.now() where id=d.id returning * into d;
  else update private.finance_cloud_drafts_v1 set updated_at=pg_catalog.now() where id=d.id returning * into d;
  end if;
  return private.finance_cloud_snapshot_v1(d,false);
end;
$fn$;

create function public.finance_cloud_submission_commit_v1(p_draft_id uuid,p_expected_revision bigint,p_staged_fingerprint text,p_data_environment text default 'production')
returns jsonb language plpgsql security definer set search_path = '' set lock_timeout='5s' set statement_timeout='50s'
as $fn$
declare a public.finance_users%rowtype; d private.finance_cloud_drafts_v1%rowtype; items jsonb; res jsonb;
begin
  a := private.finance_cloud_actor_v1(p_data_environment);
  select * into d from private.finance_cloud_drafts_v1 where id=p_draft_id
    and tenant_id=a.tenant_id and owner_auth_uid=auth.uid() and owner_finance_user_id=a.id and data_environment=p_data_environment for update;
  if not found then raise exception '找不到本人可用的草稿' using errcode='42501';end if;
  if p_expected_revision is null or d.revision<>p_expected_revision or p_staged_fingerprint is null or d.staged_fingerprint<>p_staged_fingerprint then raise exception '送件版本不符' using errcode='PT409';end if;
  if d.state='committed' then return private.finance_cloud_snapshot_v1(d,false)||'{"idempotentReplay":true}'::jsonb;end if;
  if d.state<>'ready' then raise exception '明細未完整保存，尚未建立正式單據' using errcode='55000';end if;
  select pg_catalog.jsonb_agg(item order by ordinal) into items from private.finance_cloud_draft_items_v1 where draft_id=d.id;
  if pg_catalog.jsonb_array_length(items)<>d.expected_count or private.finance_income_request_digest(items)<>d.staged_fingerprint then raise exception '明細件數或雜湊不符' using errcode='23514';end if;
  perform private.finance_cloud_check_files_v1(d.files,a,d.document_type,p_data_environment);
  if exists(select 1 from pg_catalog.jsonb_array_elements(d.files) f where not private.finance_json_contains_attachment_path_v2(items,f->>'path')) then
    raise exception '雲端附件尚未綁入本張申請明細，尚未送件' using errcode='23514';end if;
  -- Exact same per-row business validation and triggers as the production RPC.
  -- Any exception rolls back ALL official rows; staging remains available.
  if d.document_type='invoice' then res := private.finance_cloud_submit_invoice_v1(d.operation_key,items,p_data_environment);
  else res := private.finance_cloud_submit_bill_v1(d.operation_key,items,p_data_environment);end if;
  if res->>'ok' is distinct from 'true' or (res->>'count')::integer<>d.expected_count then raise exception '整批正式回執不完整' using errcode='23514';end if;
  if d.expected_count>1 and (coalesce(res->>'batch_id','')='' or (select pg_catalog.count(distinct x->>'batch_id') from pg_catalog.jsonb_array_elements(res->'rows') x)<>1) then raise exception '整批申請沒有唯一批次' using errcode='23514';end if;
  update private.finance_cloud_drafts_v1 set state='committed',result=res,committed_at=pg_catalog.now(),updated_at=pg_catalog.now() where id=d.id returning * into d;
  return private.finance_cloud_snapshot_v1(d,false);
end;
$fn$;

-- Discarding only affects an unsubmitted draft. Committed requests use the
-- existing applicant withdrawal, with its accounting and audit restrictions.
create function public.finance_cloud_draft_discard_v1(p_draft_id uuid,p_expected_revision bigint,p_data_environment text default 'production')
returns jsonb language plpgsql security definer set search_path = ''
as $fn$
declare a public.finance_users%rowtype; d private.finance_cloud_drafts_v1%rowtype;
begin
  a := private.finance_cloud_actor_v1(p_data_environment);
  select * into d from private.finance_cloud_drafts_v1 where id=p_draft_id
    and tenant_id=a.tenant_id and owner_auth_uid=auth.uid() and owner_finance_user_id=a.id and data_environment=p_data_environment for update;
  if not found then raise exception '找不到本人可用的草稿' using errcode='42501';end if;
  if p_expected_revision is null or d.revision<>p_expected_revision then raise exception '草稿已更新' using errcode='PT409';end if;
  if d.state='committed' then raise exception '正式申請請使用抽單流程' using errcode='55000';end if;
  update private.finance_cloud_drafts_v1 set state='discarded',updated_at=pg_catalog.now() where id=d.id returning * into d;
  return private.finance_cloud_snapshot_v1(d,false);
end;
$fn$;

-- Source-locked delegation: retain every current authorization, row-version,
-- batch-completeness, accounting and withdrawal guard; change capacity only.
do $capacity$
declare source text; changed text; sig text;
begin
  sig := 'public.finance_submit_invoice_batch(text,jsonb,text)';
  if (select pg_catalog.md5(prosrc) from pg_catalog.pg_proc where oid=pg_catalog.to_regprocedure(sig)) is distinct from '9a5ffcb22087913916545381e28a7158' then raise exception 'Cloud submission source drift: %',sig;end if;
  source := pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(sig));
  changed := pg_catalog.replace(source,'public.finance_submit_invoice_batch(','private.finance_cloud_submit_invoice_v1(');
  changed := pg_catalog.replace(changed,'private.finance_income_assert_items_with_limit(p_items, 500)','private.finance_cloud_assert_items_v1(p_items)');
  if changed=source or pg_catalog.strpos(changed,'private.finance_cloud_assert_items_v1(p_items)')=0 then raise exception 'Cloud submit transform missing';end if;
  execute changed;
  sig := 'public.finance_submit_bill_batch(text,jsonb,text)';
  if (select pg_catalog.md5(prosrc) from pg_catalog.pg_proc where oid=pg_catalog.to_regprocedure(sig)) is distinct from 'cb5815484b3f90c0f4a73bf4461021d5' then raise exception 'Cloud submission source drift: %',sig;end if;
  source := pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(sig));
  changed := pg_catalog.replace(source,'public.finance_submit_bill_batch(','private.finance_cloud_submit_bill_v1(');
  changed := pg_catalog.replace(changed,'private.finance_income_assert_items_with_limit(p_items, 150)','private.finance_cloud_assert_items_v1(p_items)');
  -- jsonb || rebuilt every previously prepared row on every iteration. Keep
  -- the same validated objects in expanded PostgreSQL arrays and serialize
  -- once, avoiding quadratic buffer copies at the 2000-row ceiling.
  changed := pg_catalog.replace(changed,'v_prepared_rows jsonb := ''[]''::jsonb;','v_prepared_rows jsonb[] := ''{}''::jsonb[];');
  changed := pg_catalog.replace(changed,'v_result_rows jsonb := ''[]''::jsonb;','v_result_rows jsonb[] := ''{}''::jsonb[];');
  changed := pg_catalog.replace(changed,'v_prepared_rows := v_prepared_rows || pg_catalog.jsonb_build_array(','v_prepared_rows := pg_catalog.array_append(v_prepared_rows,');
  changed := pg_catalog.replace(changed,'v_result_rows := v_result_rows || pg_catalog.jsonb_build_array(','v_result_rows := pg_catalog.array_append(v_result_rows,');
  changed := pg_catalog.replace(changed,'null::public.bills, v_prepared_rows','null::public.bills, pg_catalog.to_jsonb(v_prepared_rows)');
  changed := pg_catalog.replace(changed,'pg_catalog.jsonb_array_length(v_result_rows)','pg_catalog.cardinality(v_result_rows)');
  if pg_catalog.strpos(changed,'v_prepared_rows := pg_catalog.array_append(v_prepared_rows,')=0 or pg_catalog.strpos(changed,'v_result_rows := pg_catalog.array_append(v_result_rows,')=0
    or pg_catalog.strpos(changed,'v_prepared_rows ||')>0 or pg_catalog.strpos(changed,'v_result_rows ||')>0 then raise exception 'Cloud bill linear buffer transform missing';end if;
  if changed=source or pg_catalog.strpos(changed,'private.finance_cloud_assert_items_v1(p_items)')=0 then raise exception 'Cloud submit transform missing';end if;
  execute changed;
  sig := 'public.finance_bill_act_active_step_v2(text[],text,text,text,jsonb,text,jsonb,text)';
  if (select pg_catalog.md5(prosrc) from pg_catalog.pg_proc where oid=pg_catalog.to_regprocedure(sig)) is distinct from 'b6f348ec65ffc8c951d963ab9fbafbe6' then raise exception 'Cloud downstream source drift: %',sig;end if;
  source := pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(sig));
  changed := source;
  if pg_catalog.strpos(changed,'cardinality(p_bill_ids) > 150')=0 then raise exception 'Cloud capacity transform missing: %',sig;end if;
  changed := pg_catalog.replace(changed,'cardinality(p_bill_ids) > 150','cardinality(p_bill_ids) > 2000');
  if pg_catalog.strpos(changed,'1 到 150 張繳費單')=0 then raise exception 'Cloud capacity transform missing: %',sig;end if;
  changed := pg_catalog.replace(changed,'1 到 150 張繳費單','1 到 2000 張繳費單');
  execute changed;
  sig := 'public.finance_invoice_act_active_step_v2(text[],text,text,text,jsonb,text,jsonb,jsonb,text)';
  if (select pg_catalog.md5(prosrc) from pg_catalog.pg_proc where oid=pg_catalog.to_regprocedure(sig)) is distinct from 'ad103c477833a5a1d94e7fced1913831' then raise exception 'Cloud downstream source drift: %',sig;end if;
  source := pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(sig));
  changed := source;
  if pg_catalog.strpos(changed,'cardinality(p_invoice_ids) > 500')=0 then raise exception 'Cloud capacity transform missing: %',sig;end if;
  changed := pg_catalog.replace(changed,'cardinality(p_invoice_ids) > 500','cardinality(p_invoice_ids) > 2000');
  if pg_catalog.strpos(changed,'1 到 500 張發票')=0 then raise exception 'Cloud capacity transform missing: %',sig;end if;
  changed := pg_catalog.replace(changed,'1 到 500 張發票','1 到 2000 張發票');
  execute changed;
  sig := 'public.finance_invoice_receipt_action_v2(text[],text,text,jsonb,text,jsonb,text,jsonb,date)';
  if (select pg_catalog.md5(prosrc) from pg_catalog.pg_proc where oid=pg_catalog.to_regprocedure(sig)) is distinct from 'e208945d06131b74e296f136d6e9abd3' then raise exception 'Cloud downstream source drift: %',sig;end if;
  source := pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(sig));
  changed := source;
  if pg_catalog.strpos(changed,'cardinality(p_invoice_ids) not between 1 and 150')=0 then raise exception 'Cloud capacity transform missing: %',sig;end if;
  changed := pg_catalog.replace(changed,'cardinality(p_invoice_ids) not between 1 and 150','cardinality(p_invoice_ids) not between 1 and 2000');
  execute changed;
  sig := 'public.finance_resubmit_bill_applicant_revision_v2(text,jsonb,text)';
  if (select pg_catalog.md5(prosrc) from pg_catalog.pg_proc where oid=pg_catalog.to_regprocedure(sig)) is distinct from '0d8be74cf915d5498866136ad22c6ea3' then raise exception 'Cloud downstream source drift: %',sig;end if;
  source := pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(sig));
  changed := source;
  if pg_catalog.strpos(changed,'private.finance_income_assert_items_with_limit(p_items, 150)')=0 then raise exception 'Cloud capacity transform missing: %',sig;end if;
  changed := pg_catalog.replace(changed,'private.finance_income_assert_items_with_limit(p_items, 150)','private.finance_cloud_assert_items_v1(p_items)');
  execute changed;
  sig := 'public.finance_resubmit_invoice_applicant_revision_v2(text,jsonb,text)';
  if (select pg_catalog.md5(prosrc) from pg_catalog.pg_proc where oid=pg_catalog.to_regprocedure(sig)) is distinct from 'a82bd87571b5d382eb49ea5d32f04f9f' then raise exception 'Cloud downstream source drift: %',sig;end if;
  source := pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(sig));
  changed := source;
  if pg_catalog.strpos(changed,'private.finance_income_assert_items_with_limit(p_items, 500)')=0 then raise exception 'Cloud capacity transform missing: %',sig;end if;
  changed := pg_catalog.replace(changed,'private.finance_income_assert_items_with_limit(p_items, 500)','private.finance_cloud_assert_items_v1(p_items)');
  execute changed;
  sig := 'private.finance_income_resubmit_revision_rows_v2(text,uuid,text,text,text,jsonb)';
  if (select pg_catalog.md5(prosrc) from pg_catalog.pg_proc where oid=pg_catalog.to_regprocedure(sig)) is distinct from '02e82f514ebff4a7dc445cde3738a7db' then raise exception 'Cloud downstream source drift: %',sig;end if;
  source := pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(sig));
  changed := source;
  if pg_catalog.strpos(changed,'private.finance_income_assert_items_with_limit(p_items, case when p_document_type = ''invoice'' then 500 else 150 end)')=0 then raise exception 'Cloud capacity transform missing: %',sig;end if;
  changed := pg_catalog.replace(changed,'private.finance_income_assert_items_with_limit(p_items, case when p_document_type = ''invoice'' then 500 else 150 end)','private.finance_cloud_assert_items_v1(p_items)');
  execute changed;
  sig := 'private.finance_income_withdraw_applicant_v1(text,text[],text,text,jsonb,text)';
  if (select pg_catalog.md5(prosrc) from pg_catalog.pg_proc where oid=pg_catalog.to_regprocedure(sig)) is distinct from 'a9d73b87ed5c098c5d29100f2ea686cd' then raise exception 'Cloud downstream source drift: %',sig;end if;
  source := pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(sig));
  changed := source;
  if pg_catalog.strpos(changed,'v_max_items := 150')=0 then raise exception 'Cloud capacity transform missing: %',sig;end if;
  changed := pg_catalog.replace(changed,'v_max_items := 150','v_max_items := 2000');
  if pg_catalog.strpos(changed,'v_max_items := 500')=0 then raise exception 'Cloud capacity transform missing: %',sig;end if;
  changed := pg_catalog.replace(changed,'v_max_items := 500','v_max_items := 2000');
  execute changed;
end;
$capacity$;

-- PostgREST honors per-RPC timeouts. Keep the ordinary role's 8-second bound;
-- only these authenticated, bounded complete-application operations get 50s.
alter function public.finance_bill_act_active_step_v2(text[],text,text,text,jsonb,text,jsonb,text) set statement_timeout='50s';
alter function public.finance_invoice_act_active_step_v2(text[],text,text,text,jsonb,text,jsonb,jsonb,text) set statement_timeout='50s';
alter function public.finance_invoice_receipt_action_v2(text[],text,text,jsonb,text,jsonb,text,jsonb,date) set statement_timeout='50s';
alter function public.finance_resubmit_bill_applicant_revision_v2(text,jsonb,text) set statement_timeout='50s';
alter function public.finance_resubmit_invoice_applicant_revision_v2(text,jsonb,text) set statement_timeout='50s';
alter function public.finance_bill_withdraw_applicant_v1(text[],text,text,jsonb,text) set statement_timeout='50s';
alter function public.finance_invoice_withdraw_applicant_v1(text[],text,text,jsonb,text) set statement_timeout='50s';

-- Draft-linked staged objects must survive orphan cleanup and cannot be
-- replaced underneath a draft. Discard/remove the reference before cleanup.
create function private.finance_cloud_preserve_attachment_v1()
returns trigger language plpgsql security definer set search_path = ''
as $fn$
declare bucket text; object_path text;
begin
  if tg_op='UPDATE' then
    if tg_table_schema='storage' then
      if pg_catalog.jsonb_build_array(new.bucket_id,new.name,new.owner_id,new.metadata)
        is not distinct from pg_catalog.jsonb_build_array(old.bucket_id,old.name,old.owner_id,old.metadata) then return new;end if;
    else
      if pg_catalog.jsonb_build_array(new.bucket_id,new.storage_path,new.tenant_id,new.data_environment,new.record_type,new.uploaded_by)
        is not distinct from pg_catalog.jsonb_build_array(old.bucket_id,old.storage_path,old.tenant_id,old.data_environment,old.record_type,old.uploaded_by) then return new;end if;
    end if;
  end if;
  if tg_table_schema='storage' then bucket:=old.bucket_id;object_path:=old.name;
  else bucket:=old.bucket_id;object_path:=old.storage_path;end if;
  if bucket='finance-attachments' and exists(
    select 1 from private.finance_cloud_drafts_v1 d
    where d.state in ('draft','staging','ready') and d.files @> pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('path',object_path))
  ) then
    raise exception '附件仍由雲端草稿使用，請先在草稿移除或放棄草稿' using errcode='23514';
  end if;
  if tg_op='DELETE' then return old;else return new;end if;
end;
$fn$;
create trigger finance_cloud_preserve_storage_v1 before update or delete on storage.objects
for each row execute function private.finance_cloud_preserve_attachment_v1();
create trigger finance_cloud_preserve_metadata_v1 before update or delete on public.file_attachments
for each row execute function private.finance_cloud_preserve_attachment_v1();

create function public.finance_cloud_draft_reopen_v1(p_draft_id uuid,p_expected_revision bigint,p_data_environment text default 'production')
returns jsonb language plpgsql security definer set search_path = ''
as $fn$
declare a public.finance_users%rowtype; d private.finance_cloud_drafts_v1%rowtype;
begin
  a := private.finance_cloud_actor_v1(p_data_environment);
  select * into d from private.finance_cloud_drafts_v1 where id=p_draft_id
    and tenant_id=a.tenant_id and owner_auth_uid=auth.uid() and owner_finance_user_id=a.id and data_environment=p_data_environment for update;
  if not found then raise exception '找不到本人可用的草稿' using errcode='42501';end if;
  if p_expected_revision is null or d.revision<>p_expected_revision then raise exception '草稿已更新' using errcode='PT409';end if;
  if d.state not in ('staging','ready') then raise exception '僅尚未成立的送件可回到草稿' using errcode='55000';end if;
  -- Commit takes the same row lock. A late old commit cannot pass new revision.
  delete from private.finance_cloud_draft_items_v1 where draft_id=d.id;
  update private.finance_cloud_drafts_v1 set state='draft',revision=revision+1,expected_count=null,staged_fingerprint=null,
    operation_key='cloud_'||document_type||'_'||id::text||'_'||(revision+1)::text,updated_at=pg_catalog.now()
    where id=d.id returning * into d;
  return private.finance_cloud_snapshot_v1(d,true);
end;
$fn$;

do $acl$
declare r record;
begin
  for r in select n.nspname,p.proname,pg_catalog.pg_get_function_identity_arguments(p.oid) args
    from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('public','private') and p.proname like 'finance_cloud_%_v1'
  loop
    execute pg_catalog.format('alter function %I.%I(%s) owner to postgres',r.nspname,r.proname,r.args);
    execute pg_catalog.format('revoke all on function %I.%I(%s) from public,anon,authenticated,service_role',r.nspname,r.proname,r.args);
    if r.nspname='public' then execute pg_catalog.format('grant execute on function %I.%I(%s) to authenticated',r.nspname,r.proname,r.args);end if;
  end loop;
end;
$acl$;

