-- Internal audit preparation only. A source fingerprint is an as-of comparison,
-- not an archive, accounting lock, audit opinion, or statutory filing.
create table private.finance_audit_cases_v1 (
 tenant_id uuid not null, data_environment text not null check(data_environment in ('production','test')),
 entity_id text not null check(btrim(entity_id)<>'' and entity_id<>'all'), period text not null,
 revision bigint not null check(revision>0), case_data jsonb not null check(jsonb_typeof(case_data)='object'),
 source_fingerprint text not null, updated_by text not null, updated_at timestamptz not null default clock_timestamp(),
 primary key(tenant_id,data_environment,entity_id,period)
);
create table private.finance_audit_case_revisions_v1 (
 tenant_id uuid not null, data_environment text not null, entity_id text not null, period text not null,
 revision bigint not null, case_data jsonb not null, source_fingerprint text not null,
 reason text not null check(length(btrim(reason)) between 1 and 2000), actor_id text not null,
 created_at timestamptz not null default clock_timestamp(),
 primary key(tenant_id,data_environment,entity_id,period,revision)
);
alter table private.finance_audit_cases_v1 enable row level security;
alter table private.finance_audit_case_revisions_v1 enable row level security;
revoke all on private.finance_audit_cases_v1,private.finance_audit_case_revisions_v1 from public,anon,authenticated,service_role;

create function private.finance_audit_period_v1(p text) returns void language plpgsql immutable set search_path='' as $$
begin
 if p is null or p!~'^[1-9][0-9]{3}(-((0[1-9]|1[0-2])|Q[1-4]))?$' then
  raise exception '查帳期間須為 YYYY、YYYY-MM 或 YYYY-Q1 至 Q4' using errcode='22023';end if;
end $$;
create function private.finance_audit_item_default_v1() returns jsonb language sql immutable set search_path='' as $$
 select '{"ownerId":null,"dueDate":null,"evidenceReference":"","notes":"","sourceLinks":[],"applicability":"unknown","status":"pending","preparedBy":null,"preparedAt":null,"reviewedBy":null,"reviewedAt":null,"reviewedFingerprint":null}'::jsonb
$$;
create function private.finance_audit_case_default_v1() returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('schemaVersion',1,'engagementType','both','legalForm',null,'auditorName',null,'engagementReference',null,
  'items',(select jsonb_object_agg('A'||lpad(i::text,2,'0'),private.finance_audit_item_default_v1()) from generate_series(1,12) i))
$$;

create function private.finance_audit_source_v1(t uuid,e text,env text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 -- A complete-company count/digest must never expose the complement of a
 -- partially visible set. All rows (including voided/future rows) participate.
 with inv as materialized (
  select i.*,public.can_read_invoice(i) is true as readable from public.invoices i where i.tenant_id=t and i.entity_id=e and coalesce(i.data_environment,'production')=env
 ), req as materialized (
  select r.*,public.can_read_expense_request(r) is true as readable from public.expense_requests r where r.tenant_id=t and r.entity_id=e and coalesce(r.data_environment,'production')=env
 ), led as materialized (
  select l.* from public.ledger_entries l where l.tenant_id=t and l.entity_id=e and coalesce(l.data_environment,'production')=env
 ), dims as (
  select department_code from inv union select department_code from req union select department_code from led
 ), allowed as (
  select not exists(select 1 from inv where not readable) and not exists(select 1 from req where not readable)
   and not exists(select 1 from dims d where private.finance_expense_optional_permission_allows(t,public.current_finance_user_id(),'finance.request.view.all',
    jsonb_build_object('entity_id',e,'entityId',e,'legal_entity_code',e,'department_code',d.department_code,'departmentCode',d.department_code,'data_environment',env)) is distinct from true) as ok
 ), parts as (
  select 'invoices'::text as kind,count(*) as n,coalesce(string_agg(encode(sha256(convert_to((to_jsonb(i)-'readable')::text,'UTF8')),'hex'),'' order by i.id),'') as digest from inv i
  union all select 'expense_requests',count(*),coalesce(string_agg(encode(sha256(convert_to((to_jsonb(r)-'readable')::text,'UTF8')),'hex'),'' order by r.id),'') from req r
  union all select 'ledger',count(*),coalesce(string_agg(encode(sha256(convert_to(to_jsonb(l)::text,'UTF8')),'hex'),'' order by l.id),'') from led l
  union all select 'reporting_profile',count(*),coalesce(string_agg(encode(sha256(convert_to(to_jsonb(p)::text,'UTF8')),'hex'),'' order by p.entity_id),'')
   from public.finance_reporting_profiles p where p.tenant_id=t and p.entity_id=e and p.data_environment=env
 ) select jsonb_build_object('allowed',(select ok from allowed),'fingerprint',encode(sha256(convert_to(t::text||'|'||e||'|'||env||'|'||string_agg(kind||':'||n||':'||digest,'|' order by kind),'UTF8')),'hex'),
  'counts',jsonb_object_agg(kind,n) filter(where kind<>'reporting_profile')) into result from parts;
 if result->>'allowed' is distinct from 'true' then raise exception '查帳來源未取得此公司全部資料的調閱權限' using errcode='42501';end if;
 return result-'allowed';
end $$;

create function private.finance_audit_links_v1(t uuid,e text,env text,p jsonb) returns void
language plpgsql stable security definer set search_path='' as $$
declare item jsonb;link jsonb;seen text[];k text;valid boolean;
begin
 for item in select value from jsonb_each(p->'items') loop
  if jsonb_typeof(item->'sourceLinks') is distinct from 'array' or jsonb_array_length(item->'sourceLinks')>30 then raise exception '每項查帳資料最多可連結30張來源單' using errcode='22023';end if;
  seen:='{}';
  for link in select value from jsonb_array_elements(item->'sourceLinks') loop
   perform private.finance_reporting_shape_v1(link,'{"sourceType":"invoice|expense_request","sourceId":"text"}',array['sourceType','sourceId']);
   k:=(link->>'sourceType')||':'||(link->>'sourceId');if k=any(seen) then raise exception '查帳來源不得重複' using errcode='22023';end if;seen:=array_append(seen,k);
   if link->>'sourceType'='invoice' then
    select exists(select 1 from public.invoices i where i.tenant_id=t and i.entity_id=e and coalesce(i.data_environment,'production')=env and i.id=link->>'sourceId' and public.can_read_invoice(i) is true) into valid;
   else
    select exists(select 1 from public.expense_requests r where r.tenant_id=t and r.entity_id=e and coalesce(r.data_environment,'production')=env and r.id=link->>'sourceId' and public.can_read_expense_request(r) is true) into valid;
   end if;
   if not valid then raise exception '查帳來源不存在或不在目前公司調閱範圍' using errcode='42501';end if;
  end loop;
 end loop;
end $$;

create function private.finance_audit_validate_v1(t uuid,e text,env text,p jsonb,old jsonb,actor text,fingerprint text) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare output jsonb;row jsonb;prev jsonb;key text;i integer;content_changed boolean;header_changed boolean;has_evidence boolean;
 metadata text[]:=array['preparedBy','preparedAt','reviewedBy','reviewedAt','reviewedFingerprint'];
begin
 if octet_length(p::text)>2097152 then raise exception '查帳資料超過2MB限制' using errcode='22023';end if;
 perform private.finance_reporting_shape_v1(p,'{"schemaVersion":"amount","engagementType":"both|financial|tax","legalForm":"text","auditorName":"text","engagementReference":"text","items":"object"}',array['schemaVersion','engagementType','items']);
 if p->'schemaVersion'<>'1'::jsonb or (select count(*) from jsonb_object_keys(p->'items'))<>12 or exists(select 1 from jsonb_object_keys(p->'items') k where k!~'^A(0[1-9]|1[0-2])$') then raise exception '查帳清單須包含完整A01至A12項目' using errcode='22023';end if;
 output:=(private.finance_audit_case_default_v1()||p)-'items';
 header_changed:=output is distinct from (old-'items');
 output:=output||'{"items":{}}'::jsonb;
 for i in 1..12 loop
  key:='A'||lpad(i::text,2,'0');row:=private.finance_audit_item_default_v1()||(p->'items'->key);prev:=old->'items'->key;
  perform private.finance_reporting_shape_v1(row,'{"ownerId":"text","dueDate":"date","evidenceReference":"text","notes":"text","sourceLinks":"array","applicability":"unknown|applicable|not_applicable","status":"pending|provided|reviewed","preparedBy":"text","preparedAt":"text","reviewedBy":"text","reviewedAt":"text","reviewedFingerprint":"text"}',array['sourceLinks','applicability','status']);
  if length(coalesce(row->>'evidenceReference',''))>4000 or length(coalesce(row->>'notes',''))>8000 then raise exception '查帳佐證或備註超過長度限制' using errcode='22023';end if;
  if nullif(btrim(row->>'ownerId'),'') is not null and not exists(select 1 from public.finance_users u where u.tenant_id=t and u.id=row->>'ownerId' and u.active=true) then raise exception '負責人須為目前租戶的有效人員' using errcode='42501';end if;
  if row->>'applicability'='not_applicable' and nullif(btrim(row->>'notes'),'') is null then raise exception '不適用項目必須填寫理由' using errcode='22023';end if;
  has_evidence:=nullif(btrim(row->>'evidenceReference'),'') is not null or jsonb_array_length(row->'sourceLinks')>0;
  if row->>'status' in ('provided','reviewed') and not has_evidence then raise exception '已提供或覆核項目須有佐證位置或來源單據' using errcode='22023';end if;
  content_changed:=header_changed or (row-metadata-'status') is distinct from (prev-metadata-'status');
  if content_changed then
   row:=(row-metadata)||jsonb_build_object('status',case when row->>'status'='pending' or not has_evidence then 'pending' else 'provided' end,
    'preparedBy',actor,'preparedAt',clock_timestamp(),'reviewedBy',null,'reviewedAt',null,'reviewedFingerprint',null);
  elsif row->>'status'='reviewed' and (prev->>'status' is distinct from 'reviewed' or (row->>'reviewedFingerprint' is distinct from prev->>'reviewedFingerprint' and row->>'reviewedFingerprint'=fingerprint)) then
   if row->>'applicability'='unknown' then raise exception '內部覆核前須確認此項目是否適用' using errcode='22023';end if;
   if prev->>'status' not in ('provided','reviewed') or nullif(prev->>'preparedBy','') is null or prev->>'preparedBy'=actor then raise exception '內部覆核須由不同於準備人的授權人員執行' using errcode='42501';end if;
   if not has_evidence then raise exception '覆核前須提供佐證位置或來源單據' using errcode='22023';end if;
   row:=(row-metadata)||jsonb_build_object('preparedBy',prev->'preparedBy','preparedAt',prev->'preparedAt','reviewedBy',actor,'reviewedAt',clock_timestamp(),'reviewedFingerprint',fingerprint);
  elsif row->>'status' is distinct from prev->>'status' then
   if row->>'status'='provided' and not has_evidence then raise exception '已提供項目須有佐證位置或來源單據' using errcode='22023';end if;
   row:=(row-metadata)||jsonb_build_object('preparedBy',actor,'preparedAt',clock_timestamp(),'reviewedBy',null,'reviewedAt',null,'reviewedFingerprint',null);
  else
   row:=(row-metadata)||jsonb_build_object('preparedBy',prev->'preparedBy','preparedAt',prev->'preparedAt','reviewedBy',prev->'reviewedBy','reviewedAt',prev->'reviewedAt','reviewedFingerprint',prev->'reviewedFingerprint');
  end if;
  output:=jsonb_set(output,array['items',key],row);
 end loop;
 perform private.finance_audit_links_v1(t,e,env,output);
 return output;
end $$;

create function public.finance_audit_case_read_v1(p_entity_id text,p_period text,p_data_environment text default 'production') returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare a jsonb:=private.finance_reporting_actor_v1(p_entity_id,p_data_environment);t uuid:=(a->>'tenantId')::uuid;row private.finance_audit_cases_v1%rowtype;p jsonb;source jsonb;
begin
 perform private.finance_audit_period_v1(p_period);
 source:=private.finance_audit_source_v1(t,p_entity_id,p_data_environment);
 select * into row from private.finance_audit_cases_v1 where tenant_id=t and data_environment=p_data_environment and entity_id=p_entity_id and period=p_period;
 p:=coalesce(row.case_data,private.finance_audit_case_default_v1());perform private.finance_audit_links_v1(t,p_entity_id,p_data_environment,p);
 return jsonb_build_object('ok',true,'entityId',p_entity_id,'period',p_period,'revision',coalesce(row.revision,0),'caseData',p,
  'sourceFingerprint',source->'fingerprint','currentFingerprint',source->'fingerprint','sourceCounts',source->'counts','sourceAsOf',statement_timestamp(),
  'canEdit',a->'canEditWorkpaper','actorId',a->'actorId','updatedAt',row.updated_at);
end $$;
create function public.finance_audit_case_save_v1(p_entity_id text,p_period text,p_expected_revision bigint,p_expected_source_fingerprint text,p_case_data jsonb,p_reason text,p_data_environment text default 'production') returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare a jsonb:=private.finance_reporting_actor_v1(p_entity_id,p_data_environment);t uuid:=(a->>'tenantId')::uuid;actor text:=a->>'actorId';row private.finance_audit_cases_v1%rowtype;old jsonb;p jsonb;rev bigint;source jsonb;
begin
 perform private.finance_audit_period_v1(p_period);
 if not coalesce((a->>'canEditWorkpaper')::boolean,false) then raise exception '此帳號只能調閱查帳資料' using errcode='42501';end if;
 if p_expected_revision is null or p_expected_revision<0 or p_expected_source_fingerprint is null or p_expected_source_fingerprint!~'^[0-9a-f]{64}$' or length(btrim(coalesce(p_reason,''))) not between 1 and 2000 then raise exception '儲存須附正確版本、來源指紋與異動原因' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('finance_audit_case|'||t::text||'|'||p_data_environment||'|'||p_entity_id||'|'||p_period,0));
 select * into row from private.finance_audit_cases_v1 where tenant_id=t and data_environment=p_data_environment and entity_id=p_entity_id and period=p_period for update;
 rev:=coalesce(row.revision,0);old:=coalesce(row.case_data,private.finance_audit_case_default_v1());
 if rev<>p_expected_revision then raise exception '查帳清單已更新，請重新讀取後再儲存' using errcode='40001';end if;
 source:=private.finance_audit_source_v1(t,p_entity_id,p_data_environment);
 if source->>'fingerprint' is distinct from p_expected_source_fingerprint then raise exception '帳務或報表來源已更新，請重新核對後再儲存' using errcode='40001';end if;
 p:=private.finance_audit_validate_v1(t,p_entity_id,p_data_environment,p_case_data,old,actor,source->>'fingerprint');
 insert into private.finance_audit_cases_v1(tenant_id,data_environment,entity_id,period,revision,case_data,source_fingerprint,updated_by)
 values(t,p_data_environment,p_entity_id,p_period,rev+1,p,source->>'fingerprint',actor)
 on conflict(tenant_id,data_environment,entity_id,period) do update set revision=excluded.revision,case_data=excluded.case_data,source_fingerprint=excluded.source_fingerprint,updated_by=excluded.updated_by,updated_at=clock_timestamp();
 insert into private.finance_audit_case_revisions_v1(tenant_id,data_environment,entity_id,period,revision,case_data,source_fingerprint,reason,actor_id)
 values(t,p_data_environment,p_entity_id,p_period,rev+1,p,source->>'fingerprint',btrim(p_reason),actor);
 return public.finance_audit_case_read_v1(p_entity_id,p_period,p_data_environment);
end $$;
create function public.finance_audit_case_history_v1(p_entity_id text,p_period text,p_data_environment text default 'production') returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare a jsonb:=private.finance_reporting_actor_v1(p_entity_id,p_data_environment);t uuid:=(a->>'tenantId')::uuid;row record;result jsonb:='[]';
begin
 perform private.finance_audit_period_v1(p_period);perform private.finance_audit_source_v1(t,p_entity_id,p_data_environment);
 for row in select * from private.finance_audit_case_revisions_v1 where tenant_id=t and data_environment=p_data_environment and entity_id=p_entity_id and period=p_period order by revision desc limit 100 loop
  perform private.finance_audit_links_v1(t,p_entity_id,p_data_environment,row.case_data);
  result:=result||jsonb_build_array(jsonb_build_object('revision',row.revision,'caseData',row.case_data,'sourceFingerprint',row.source_fingerprint,'reason',row.reason,'actorId',row.actor_id,'createdAt',row.created_at));
 end loop;
 return jsonb_build_object('ok',true,'entityId',p_entity_id,'period',p_period,'rows',result);
end $$;
create function private.finance_audit_revision_immutable_v1() returns trigger language plpgsql set search_path='' as $$
begin raise exception '查帳異動歷史不可覆寫或刪除' using errcode='42501';end $$;
create trigger finance_audit_revision_immutable_v1 before update or delete on private.finance_audit_case_revisions_v1 for each row execute function private.finance_audit_revision_immutable_v1();

do $audit_acl$
declare sig text;
begin
 foreach sig in array array['private.finance_audit_period_v1(text)','private.finance_audit_item_default_v1()','private.finance_audit_case_default_v1()','private.finance_audit_source_v1(uuid,text,text)','private.finance_audit_links_v1(uuid,text,text,jsonb)','private.finance_audit_validate_v1(uuid,text,text,jsonb,jsonb,text,text)','private.finance_audit_revision_immutable_v1()','public.finance_audit_case_read_v1(text,text,text)','public.finance_audit_case_save_v1(text,text,bigint,text,jsonb,text,text)','public.finance_audit_case_history_v1(text,text,text)'] loop
  execute 'alter function '||sig||' owner to postgres';execute 'revoke all on function '||sig||' from public,anon,authenticated,service_role';
  if left(sig,7)='public.' then execute 'grant execute on function '||sig||' to authenticated';end if;
 end loop;
end;
$audit_acl$;

-- Read-only schema/authority checks. This does not certify financial statements.
do $finance_audit_readiness_postflight$
declare sig text;p record;rel text;denied boolean:=false;sample jsonb;
begin
 foreach sig in array array['private.finance_audit_period_v1(text)','private.finance_audit_item_default_v1()','private.finance_audit_case_default_v1()','private.finance_audit_source_v1(uuid,text,text)','private.finance_audit_links_v1(uuid,text,text,jsonb)','private.finance_audit_validate_v1(uuid,text,text,jsonb,jsonb,text,text)','private.finance_audit_revision_immutable_v1()','public.finance_audit_case_read_v1(text,text,text)','public.finance_audit_case_save_v1(text,text,bigint,text,jsonb,text,text)','public.finance_audit_case_history_v1(text,text,text)'] loop
  select * into p from pg_proc where oid=to_regprocedure(sig);
  if p.oid is null or pg_get_userbyid(p.proowner)<>'postgres' or p.proconfig is distinct from array['search_path=""']::text[]
   or has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('service_role',p.oid,'EXECUTE')
   or has_function_privilege('authenticated',p.oid,'EXECUTE') is distinct from (left(sig,7)='public.')
   or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE') then raise exception 'Audit readiness RPC ACL/path differs: %',sig;end if;
  if left(sig,7)='public.' and (not p.prosecdef or position('private.finance_reporting_actor_v1' in p.prosrc)=0) then raise exception 'Audit readiness verified reporting scope missing';end if;
 end loop;
 foreach rel in array array['private.finance_audit_cases_v1','private.finance_audit_case_revisions_v1'] loop
  if not exists(select 1 from pg_class where oid=to_regclass(rel) and relrowsecurity)
   or has_table_privilege('anon',rel,'SELECT,INSERT,UPDATE,DELETE') or has_table_privilege('authenticated',rel,'SELECT,INSERT,UPDATE,DELETE') or has_table_privilege('service_role',rel,'SELECT,INSERT,UPDATE,DELETE') then raise exception 'Audit readiness table directly exposed';end if;
 end loop;
 if not exists(select 1 from pg_trigger where tgrelid=to_regclass('private.finance_audit_case_revisions_v1') and tgname='finance_audit_revision_immutable_v1' and tgenabled='O' and tgfoid=to_regprocedure('private.finance_audit_revision_immutable_v1()')) then raise exception 'Audit revision immutability missing';end if;
 select * into p from pg_proc where oid=to_regprocedure('public.finance_audit_case_save_v1(text,text,bigint,text,jsonb,text,text)');
 if not p.prosecdef or p.provolatile<>'v' or p.prosrc not like '%canEditWorkpaper%' or p.prosrc not like '%pg_advisory_xact_lock%' or p.prosrc not like '%for update%'
  or p.prosrc not like '%rev<>p_expected_revision%' or p.prosrc not like '%is distinct from p_expected_source_fingerprint%'
  or p.prosrc not like '%insert into private.finance_audit_case_revisions_v1%' then raise exception 'Audit atomic source/revision/write authority missing';end if;
 select * into p from pg_proc where oid=to_regprocedure('private.finance_audit_source_v1(uuid,text,text)');
 if not p.prosecdef or p.provolatile<>'s' or p.prosrc not like '%public.can_read_invoice(i) is true%' or p.prosrc not like '%public.can_read_expense_request(r) is true%'
  or p.prosrc not like '%private.finance_expense_optional_permission_allows%' or p.prosrc not like '%public.finance_reporting_profiles%' or p.prosrc not like '%sha256%'
  or p.prosrc not like '%coalesce(l.data_environment,''production'')=env%' then raise exception 'Audit source scope/digest differs';end if;
 select * into p from pg_proc where oid=to_regprocedure('private.finance_audit_validate_v1(uuid,text,text,jsonb,jsonb,text,text)');
 if p.prosrc not like '%prev->>''preparedBy''=actor%' or p.prosrc not like '%content_changed%' or p.prosrc not like '%''reviewedFingerprint'',fingerprint%' or p.prosrc not like '%private.finance_audit_links_v1%' or p.prosrc not like '%if row->>''applicability''=''unknown'' then raise exception%' then raise exception 'Audit reviewer/source-link authority missing';end if;
 sample:=private.finance_audit_case_default_v1();if (select count(*) from jsonb_object_keys(sample->'items'))<>12 or sample#>>'{items,A01,status}'<>'pending' or sample#>>'{items,A12,applicability}'<>'unknown' then raise exception 'Audit checklist default contract differs';end if;
 perform private.finance_audit_period_v1('2026');perform private.finance_audit_period_v1('2026-09');perform private.finance_audit_period_v1('2026-Q4');
 begin perform private.finance_audit_period_v1('2026-13');exception when invalid_parameter_value then denied:=true;end;
 if not denied then raise exception 'Audit invalid period accepted';end if;
 if auth.uid() is null then
  denied:=false;begin perform public.finance_audit_case_read_v1('A','2026','test');exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'Audit accepted missing authenticated identity';end if;
 end if;
end;
$finance_audit_readiness_postflight$;
