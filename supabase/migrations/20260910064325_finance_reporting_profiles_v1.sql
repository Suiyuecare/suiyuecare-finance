-- Company-scoped report preparation settings. No journal/source writes or filing API.
-- Existing verified identity and report/settings restrictions remain authoritative.
create table public.finance_reporting_profiles (
 tenant_id uuid not null, data_environment text not null check(data_environment in ('production','test')),
 entity_id text not null check(btrim(entity_id)<>'' and entity_id<>'all'), revision bigint not null check(revision>0),
 profile jsonb not null check(jsonb_typeof(profile)='object'), updated_by text not null,
 updated_at timestamptz not null default clock_timestamp(), primary key(tenant_id,data_environment,entity_id)
);
create table private.finance_reporting_profile_revisions_v1 (
 tenant_id uuid not null, data_environment text not null, entity_id text not null, revision bigint not null,
 profile jsonb not null, reason text not null check(length(btrim(reason)) between 1 and 2000),
 actor_id text not null, created_at timestamptz not null default clock_timestamp(),
 primary key(tenant_id,data_environment,entity_id,revision)
);
alter table public.finance_reporting_profiles enable row level security;
alter table private.finance_reporting_profile_revisions_v1 enable row level security;
revoke all on public.finance_reporting_profiles,private.finance_reporting_profile_revisions_v1 from public,anon,authenticated,service_role;

create function private.finance_reporting_default_v1() returns jsonb language sql immutable set search_path='' as $$
 select '{"schemaVersion":1,"accountingFramework":null,"tax":{},"accountMappings":{},"costCenters":[],"budgets":[],"allocations":[],"eliminations":[],"periodChecks":{},"documents":{}}'::jsonb
$$;

-- Same saved page semantics as FinancePermissionEngine.permissionMapForRole:
-- missing role/object key uses defaults; legacy arrays are explicit page allowlists.
create function private.finance_reporting_page_level_v1(p_tenant uuid,p_role text,p_page text) returns text
language plpgsql stable security definer set search_path='' as $$
declare v jsonb; raw jsonb; fallback text:='none'; s text;
begin
 if p_page='reports' and p_role in ('accountant','ceo','admin_director','external_audit','board') then fallback:='edit'; end if;
 if p_page='settings' and p_role in ('ceo','admin_director') then fallback:='edit'; end if;
 select value->p_role into v from public.system_settings where tenant_id=p_tenant and key='role_permissions';
 if v is null or v='null'::jsonb then return fallback; end if;
 if jsonb_typeof(v)='array' then return case when v ? p_page then 'edit' else 'none' end; end if;
 if jsonb_typeof(v)<>'object' then return 'none'; end if;
 if not v ? p_page then return fallback; end if;
 raw:=v->p_page;s:=lower(btrim(v->>p_page));
 if raw='true'::jsonb then return 'edit'; end if;
 if jsonb_typeof(raw)='number' then return case when (raw#>>'{}')::numeric>=3 then 'delete' when (raw#>>'{}')::numeric=2 then 'edit' when (raw#>>'{}')::numeric=1 then 'view' else 'none' end; end if;
 if s in ('view','read','view_only','readonly') then return 'view'; end if;
 if s in ('edit','write','manage','admin','approve') then return 'edit'; end if;
 if s in ('delete','remove') then return 'delete'; end if;
 return 'none';
end $$;

create function private.finance_reporting_actor_v1(p_entity text,p_environment text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare t uuid:=public.current_tenant_id(); a text:=public.current_finance_user_id(); r text:=public.current_finance_role(); read_level text; settings_level text; can_edit boolean; can_work boolean;
begin
 if auth.uid() is null or t is null or a is null or not exists(select 1 from public.finance_users u where u.tenant_id=t and u.id=a and u.auth_user_id=auth.uid() and u.active=true and u.google_link_status in ('bound','pending_rebind')) then raise exception using errcode='42501',message='Reporting requires a verified active Finance identity'; end if;
 if p_environment is null or p_environment not in ('production','test') or nullif(btrim(p_entity),'') is null or p_entity='all' then raise exception using errcode='22023',message='Select one company and an explicit data environment'; end if;
 if r not in ('accountant','ceo','admin_director','external_audit','board') then raise exception using errcode='42501',message='Reporting role is not authorized'; end if;
 read_level:=private.finance_reporting_page_level_v1(t,r,'reports');
 if read_level='none' or not coalesce(private.finance_expense_optional_permission_allows(t,a,'finance.request.view.all',jsonb_build_object('entity_id',p_entity,'entityId',p_entity,'legal_entity_code',p_entity,'data_environment',p_environment)),false) then raise exception using errcode='42501',message='Reporting scope is not authorized'; end if;
 if not exists(select 1 from public.system_settings s cross join lateral jsonb_array_elements(case when jsonb_typeof(s.value)='array' then s.value else '[]'::jsonb end) e where s.tenant_id=t and s.key='entities' and e->>'id'=p_entity) then raise exception using errcode='42501',message='Company is outside the current tenant scope'; end if;
 settings_level:=private.finance_reporting_page_level_v1(t,r,'settings');
 can_edit:=coalesce(public.is_finance_admin(),false) and settings_level in ('edit','delete');
 can_work:=can_edit or (r='accountant' and read_level in ('edit','delete'));
 return jsonb_build_object('tenantId',t,'actorId',a,'canEdit',can_edit,'canEditWorkpaper',can_work);
end $$;

-- Strict nullable scalar/shape validation. Missing data can be saved as a draft;
-- this is not a declaration that an incomplete tax return is ready for filing.
create function private.finance_reporting_shape_v1(p jsonb,spec jsonb,required text[] default '{}'::text[]) returns void
language plpgsql immutable set search_path='' as $$
declare kv record; ty text; v jsonb; s text; d date; n numeric;
begin
 if jsonb_typeof(p) is distinct from 'object' then raise exception using errcode='22023',message='Reporting object expected'; end if;
 if exists(select 1 from jsonb_object_keys(p) k where not spec ? k) then raise exception using errcode='22023',message='Unknown reporting configuration field'; end if;
 foreach s in array required loop if not p ? s or p->s='null'::jsonb or (jsonb_typeof(p->s)='string' and btrim(p->>s)='') then raise exception using errcode='22023',message='Required reporting configuration field: '||s; end if; end loop;
 for kv in select key,value from jsonb_each(p) loop
  ty:=spec->>kv.key;v:=kv.value;if v='null'::jsonb then continue; end if;s:=v#>>'{}';
  if ty in ('object','array','boolean') then if jsonb_typeof(v)<>ty then raise exception using errcode='22023',message='Invalid reporting type: '||kv.key; end if;
  elsif ty in ('amount','ratio') then
   if jsonb_typeof(v)<>'number' then raise exception using errcode='22023',message='Numeric reporting field required: '||kv.key; end if;
   n:=s::numeric;if n<0 or n>1000000000000 or (ty='amount' and n<>round(n,2)) or (ty='ratio' and n>1) then raise exception using errcode='22023',message='Invalid reporting numeric range: '||kv.key; end if;
  else
   if jsonb_typeof(v)<>'string' or length(s)>2000 then raise exception using errcode='22023',message='Invalid reporting text: '||kv.key; end if;
   if ty='date' then begin d:=s::date;exception when others then raise exception using errcode='22023',message='Invalid reporting date';end;if s!~'^\d{4}-\d{2}-\d{2}$' or to_char(d,'YYYY-MM-DD')<>s then raise exception using errcode='22023',message='Invalid reporting date';end if;
   elsif ty='month' then if s!~'^\d{4}-(0[1-9]|1[0-2])$' then raise exception using errcode='22023',message='Invalid reporting month';end if;
   elsif ty='taxid' then if s!~'^\d{8}$' or s='00000000' then raise exception using errcode='22023',message='Invalid tax identifier';end if;
   elsif ty not in ('text','date','month','taxid') and not s=any(string_to_array(ty,'|')) then raise exception using errcode='22023',message='Invalid reporting classification: '||kv.key;end if;
  end if;
 end loop;
end $$;

create function private.finance_reporting_account_v1(t uuid,c text) returns void language plpgsql stable security definer set search_path='' as $$
begin
 if nullif(btrim(c),'') is null or not exists(select 1 from public.system_settings s cross join lateral jsonb_array_elements(case when jsonb_typeof(s.value)='array' then s.value else '[]'::jsonb end) a where s.tenant_id=t and s.key='accounts' and coalesce(a->>'c',a->>'code')=c) then raise exception using errcode='22023',message='Unknown company reporting account'; end if;
end $$;
create function private.finance_reporting_department_v1(t uuid,e text,c text) returns void language plpgsql stable security definer set search_path='' as $$
begin
 if nullif(btrim(c),'') is null or not exists(select 1 from public.finance_department_units u join public.finance_department_entity_scopes s on s.tenant_id=u.tenant_id and s.unit_id=u.id and s.active=true where u.tenant_id=t and u.active=true and u.is_posting_unit=true and u.code=c and s.entity_code=e) then raise exception using errcode='22023',message='Department is outside the active company posting scope'; end if;
end $$;
create function private.finance_reporting_documents_scope_v1(t uuid,e text,env text,docs jsonb) returns void language plpgsql stable security definer set search_path='' as $$
declare kv record; d jsonb; valid boolean;
begin
 if jsonb_typeof(docs) is distinct from 'object' then raise exception using errcode='22023',message='Document classification map expected';end if;
 for kv in select key,value from jsonb_each(docs) loop
  d:=kv.value;valid:=false;
  if d->>'sourceType'='invoice' then select exists(select 1 from public.invoices i where i.tenant_id=t and coalesce(i.data_environment,'production')=env and i.entity_id=e and i.id=d->>'sourceId') into valid;
  elsif d->>'sourceType'='expense_request' then select exists(select 1 from public.expense_requests r where r.tenant_id=t and coalesce(r.data_environment,'production')=env and r.entity_id=e and r.id=d->>'sourceId') into valid;end if;
  if not valid then raise exception using errcode='42501',message='Document is outside this company reporting scope';end if;
 end loop;
end $$;

create function private.finance_reporting_validate_v1(t uuid,e text,env text,p jsonb,old jsonb,actor text,next_revision bigint) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare kv record; k text; row jsonb; prev jsonb; output jsonb:=p; tax jsonb; item jsonb; sub jsonb; ids text[]; names text[]; section text; list jsonb; total numeric; dr numeric; cr numeric; metadata text[]:=array['reviewedBy','reviewedAt','reviewedRevision']; spec jsonb; d text; cp text; authz jsonb;
begin
 if octet_length(p::text)>8388608 then raise exception using errcode='22023',message='Reporting profile exceeds 8 MB';end if;
 perform private.finance_reporting_shape_v1(p,'{"schemaVersion":"amount","accountingFramework":"eas|ifrs","tax":"object","accountMappings":"object","costCenters":"array","budgets":"array","allocations":"array","eliminations":"array","periodChecks":"object","documents":"object"}',array['schemaVersion','tax','accountMappings','costCenters','budgets','allocations','eliminations','periodChecks','documents']);
 if p->'schemaVersion'<>'1'::jsonb then raise exception using errcode='22023',message='Unsupported reporting schema version';end if;
 tax:=p->'tax';perform private.finance_reporting_shape_v1(tax,'{"formType":"401|403","taxId":"taxid","legalName":"text","taxRegistrationNo":"text","responsiblePerson":"text","address":"text","filingFrequency":"bimonthly|monthly","monthlyApprovalReference":"text","filingMode":"individual|head_office_aggregate","deductionMethod":"proportional|direct","directMethodSince":"date","periods":"object"}');
 for kv in select key,value from jsonb_each(coalesce(tax->'periods','{}'::jsonb)) loop
  if kv.key!~'^\d{4}-\d{2}-\d{2}/\d{4}-\d{2}-\d{2}$' then raise exception using errcode='22023',message='Invalid tax reporting period key';end if;
  perform private.finance_reporting_shape_v1(jsonb_build_object('start',split_part(kv.key,'/',1),'end',split_part(kv.key,'/',2)),'{"start":"date","end":"date"}');
  if split_part(kv.key,'/',1)>split_part(kv.key,'/',2) then raise exception using errcode='22023',message='Tax reporting period is reversed';end if;
  perform private.finance_reporting_shape_v1(kv.value,'{"priorCarryforwardTax":"amount","foreignServicePayableTax":"amount","specialTaxPayableTax":"amount","annualAdjustmentPayableTax":"amount","annualAdjustmentRefundTax":"amount","refundLimitConfirmedTax":"amount","yearEndAdjustmentRequired":"boolean","annualAdjustmentReviewed":"boolean","nonDeductibleRatio":"ratio","ratioExclusionsReviewed":"boolean","annualTotals":"object"}');
  if kv.value->'annualTotals' is not null and kv.value->'annualTotals'<>'null'::jsonb then perform private.finance_reporting_shape_v1(kv.value->'annualTotals','{"inputTax":"amount","article19ExcludedTax":"amount","exemptOnlyInputTax":"amount","commonInputTax":"amount","deductedInputTax":"amount","nonDeductibleRatio":"ratio"}');end if;
 end loop;
 for kv in select key,value from jsonb_each(p->'accountMappings') loop perform private.finance_reporting_account_v1(t,kv.key);perform private.finance_reporting_shape_v1(kv.value,'{"statementClass":"asset|liability|equity|revenue|cost|expense|otherIncome|otherExpense|incomeTax","cashFlowClass":"operating|investing|financing|noncash|unclassified","ociCategory":"reclassifiable|nonreclassifiable","normalSide":"debit|credit"}');end loop;
 ids:='{}';for row in select value from jsonb_array_elements(p->'costCenters') loop
  perform private.finance_reporting_shape_v1(row,'{"departmentCode":"text","kind":"profit|cost|shared","name":"text"}',array['departmentCode','kind','name']);d:=row->>'departmentCode';if d=any(ids) then raise exception using errcode='22023',message='Duplicate cost center';end if;ids:=array_append(ids,d);perform private.finance_reporting_department_v1(t,e,d);
 end loop;
 for kv in select key,value from jsonb_each(p->'periodChecks') loop
  perform private.finance_reporting_shape_v1(jsonb_build_object('period',kv.key),' {"period":"month"}');
  perform private.finance_reporting_shape_v1(kv.value,'{"ociReviewed":"boolean","periodCloseReady":"boolean","openingBalanceVerified":"boolean","bankReconciled":"boolean","taxReconciled":"boolean"}');
 end loop;
 foreach section in array array['budgets','allocations','eliminations'] loop
  if jsonb_array_length(p->section)>2000 then raise exception using errcode='22023',message='Too many reporting rules';end if;
  list:='[]';ids:='{}';
  for row in select value from jsonb_array_elements(p->section) loop
   select value into prev from jsonb_array_elements(coalesce(old->section,'[]'::jsonb)) where value->>'id'=row->>'id';
   spec:='{"id":"text","status":"draft|reviewed","effectiveFrom":"date","effectiveTo":"date","reviewReason":"text","reviewedBy":"text","reviewedAt":"text","reviewedRevision":"amount"}';
   if section='budgets' then spec:=spec||'{"period":"month","departmentCode":"text","accountCode":"text","amount":"amount"}';
   elsif section='allocations' then spec:=spec||'{"name":"text","sourceDepartmentCode":"text","accountCodes":"array","basis":"fixed_percentage|headcount|area|revenue|manual","targets":"array"}';
   else spec:=spec||'{"name":"text","counterpartyEntityId":"text","period":"month","lines":"array"}';end if;
   perform private.finance_reporting_shape_v1(row,spec,array['id','status','effectiveFrom']);
   if row->>'id'=any(ids) then raise exception using errcode='22023',message='Duplicate reporting rule identifier';end if;ids:=array_append(ids,row->>'id');
   if row->>'effectiveTo'<row->>'effectiveFrom' then raise exception using errcode='22023',message='Reporting rule effective period is reversed';end if;
   if section='budgets' then
    perform private.finance_reporting_shape_v1(row,spec,array['period','departmentCode','accountCode','amount']);perform private.finance_reporting_department_v1(t,e,row->>'departmentCode');perform private.finance_reporting_account_v1(t,row->>'accountCode');
   elsif section='allocations' then
    perform private.finance_reporting_shape_v1(row,spec,array['name','sourceDepartmentCode','accountCodes','basis','targets']);perform private.finance_reporting_department_v1(t,e,row->>'sourceDepartmentCode');
    if jsonb_array_length(row->'accountCodes')=0 or jsonb_array_length(row->'targets')=0 then raise exception using errcode='22023',message='Allocation requires explicit accounts and targets';end if;
    names:='{}';for sub in select value from jsonb_array_elements(row->'accountCodes') loop
     if jsonb_typeof(sub)<>'string' or (sub#>>'{}')=any(names) then raise exception using errcode='22023',message='Invalid or duplicate allocation account';end if;names:=array_append(names,sub#>>'{}');perform private.finance_reporting_account_v1(t,sub#>>'{}');end loop;
    total:=0;names:='{}';for sub in select value from jsonb_array_elements(row->'targets') loop
     perform private.finance_reporting_shape_v1(sub,'{"departmentCode":"text","weight":"ratio"}',array['departmentCode','weight']);perform private.finance_reporting_department_v1(t,e,sub->>'departmentCode');
     if sub->>'departmentCode'=any(names) or (sub->>'weight')::numeric<=0 then raise exception using errcode='22023',message='Allocation target must be unique and have a positive weight';end if;names:=array_append(names,sub->>'departmentCode');total:=total+(sub->>'weight')::numeric;
    end loop;
    if row->>'status'='reviewed' and abs(total-1)>0.000000001 then raise exception using errcode='22023',message='Reviewed allocation weights must total 1';end if;
   else
    perform private.finance_reporting_shape_v1(row,spec,array['name','counterpartyEntityId','period','lines']);cp:=row->>'counterpartyEntityId';
    if cp=e then raise exception using errcode='22023',message='Elimination needs two distinct companies';end if;authz:=private.finance_reporting_actor_v1(cp,env);
    if (row-metadata) is distinct from (prev-metadata) and not (authz->>'canEdit')::boolean then raise exception using errcode='42501',message='Counterparty reporting settings are not editable';end if;
    dr:=0;cr:=0;names:='{}';for sub in select value from jsonb_array_elements(row->'lines') loop
     perform private.finance_reporting_shape_v1(sub,'{"entityId":"text","departmentCode":"text","accountCode":"text","debit":"amount","credit":"amount","sourceRef":"text"}',array['entityId','departmentCode','accountCode','debit','credit']);
     if sub->>'entityId' not in (e,cp) then raise exception using errcode='42501',message='Elimination line is outside the pair of companies';end if;
     perform private.finance_reporting_account_v1(t,sub->>'accountCode');perform private.finance_reporting_department_v1(t,sub->>'entityId',sub->>'departmentCode');
     if (sub->>'debit')::numeric>0 and (sub->>'credit')::numeric>0 then raise exception using errcode='22023',message='Elimination line cannot contain both debit and credit';end if;
     if row->>'status'='reviewed' and nullif(btrim(sub->>'sourceRef'),'') is null then raise exception using errcode='22023',message='Reviewed elimination needs source references';end if;
     dr:=dr+(sub->>'debit')::numeric;cr:=cr+(sub->>'credit')::numeric;names:=array_append(names,sub->>'entityId');
    end loop;
    if row->>'status'='reviewed' and (dr<=0 or dr<>cr or not e=any(names) or not cp=any(names)) then raise exception using errcode='22023',message='Reviewed elimination must balance and include both companies';end if;
   end if;
   select value into prev from jsonb_array_elements(coalesce(old->section,'[]'::jsonb)) where value->>'id'=row->>'id';
   if (row-metadata) is not distinct from (prev-metadata) then row:=(row-metadata)||(prev-(select array_agg(key) from jsonb_object_keys(prev-metadata) key));
   elsif prev->>'status'='reviewed' then
    -- Editing a reviewed rule invalidates that review. A second explicit save
    -- from draft, with a reason, is required to attest the revised rule.
    row:=(row-metadata)||'{"status":"draft"}'::jsonb;
   elsif row->>'status'='reviewed' then
    if nullif(btrim(row->>'reviewReason'),'') is null then raise exception using errcode='22023',message='Review reason is required';end if;
    row:=(row-metadata)||jsonb_build_object('reviewedBy',actor,'reviewedAt',clock_timestamp(),'reviewedRevision',next_revision);
   else row:=row-metadata;end if;
   list:=list||jsonb_build_array(row);
  end loop;
  output:=jsonb_set(output,array[section],list);
 end loop;
 if (select count(*) from jsonb_object_keys(p->'documents'))>20000 then raise exception using errcode='22023',message='Too many classified documents';end if;
 perform private.finance_reporting_documents_scope_v1(t,e,env,p->'documents');
 for kv in select key,value from jsonb_each(p->'documents') loop
  row:=kv.value;
  perform private.finance_reporting_shape_v1(row,'{"sourceType":"invoice|expense_request","sourceId":"text","sourceLineId":"text","formatCode":"text","taxClass":"taxable|zero_rated|exempt|out_of_scope|special","deduction":"eligible|article19_excluded|not_claimed_policy","usage":"taxable_only|exempt_only|common","assetKind":"expense|fixed_asset","number":"text","date":"date","originalNetAmount":"amount","originalTaxAmount":"amount","grossAmount":"amount","sellerTaxId":"taxid","buyerTaxId":"taxid","zeroRateExport":"customs|non_customs","isReturn":"boolean","originalDocumentId":"text","evidenceReference":"text","classificationReason":"text"}',array['sourceType','sourceId']);
  if row is distinct from old->'documents'->kv.key and nullif(btrim(row->>'classificationReason'),'') is null then raise exception using errcode='22023',message='Changed document classification requires a reason';end if;
  if row->>'originalNetAmount' is not null and row->>'originalTaxAmount' is not null and row->>'grossAmount' is not null and (row->>'originalNetAmount')::numeric+(row->>'originalTaxAmount')::numeric<>(row->>'grossAmount')::numeric then raise exception using errcode='22023',message='Original certificate net plus tax must equal gross';end if;
 end loop;
 return output;
end $$;

create function private.finance_reporting_profile_scope_v1(t uuid,e text,env text,p jsonb) returns void
language plpgsql stable security definer set search_path='' as $$
declare row jsonb;
begin
 perform private.finance_reporting_documents_scope_v1(t,e,env,p->'documents');
 for row in select value from jsonb_array_elements(p->'eliminations') loop perform private.finance_reporting_actor_v1(row->>'counterpartyEntityId',env);end loop;
end $$;

create function public.finance_reporting_profile_read_v1(p_entity_id text,p_data_environment text default 'production') returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare a jsonb:=private.finance_reporting_actor_v1(p_entity_id,p_data_environment); row public.finance_reporting_profiles%rowtype; p jsonb;
begin
 select * into row from public.finance_reporting_profiles where tenant_id=(a->>'tenantId')::uuid and data_environment=p_data_environment and entity_id=p_entity_id;
 p:=coalesce(row.profile,private.finance_reporting_default_v1());perform private.finance_reporting_profile_scope_v1((a->>'tenantId')::uuid,p_entity_id,p_data_environment,p);
 return jsonb_build_object('ok',true,'entityId',p_entity_id,'dataEnvironment',p_data_environment,'revision',coalesce(row.revision,0),'profile',p,'updatedAt',row.updated_at,'canEdit',a->'canEdit','canEditWorkpaper',a->'canEditWorkpaper');
end $$;
create function public.finance_reporting_profile_save_v1(p_entity_id text,p_expected_revision bigint,p_profile jsonb,p_reason text,p_data_environment text default 'production') returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare a jsonb:=private.finance_reporting_actor_v1(p_entity_id,p_data_environment); t uuid:=(a->>'tenantId')::uuid; actor text:=a->>'actorId'; row public.finance_reporting_profiles%rowtype; old jsonb; p jsonb; rev bigint;
begin
 if not coalesce((a->>'canEditWorkpaper')::boolean,false) then raise exception using errcode='42501',message='Reporting workpaper editing is not authorized';end if;
 if p_expected_revision is null or p_expected_revision<0 or length(btrim(coalesce(p_reason,''))) not between 1 and 2000 then raise exception using errcode='22023',message='Exact revision and a nonempty change reason are required';end if;
 perform pg_advisory_xact_lock(hashtextextended('finance_reporting_profile|'||t::text||'|'||p_data_environment||'|'||p_entity_id,0));
 select * into row from public.finance_reporting_profiles where tenant_id=t and data_environment=p_data_environment and entity_id=p_entity_id for update;
 rev:=coalesce(row.revision,0);old:=coalesce(row.profile,private.finance_reporting_default_v1());
 if rev<>p_expected_revision then raise exception using errcode='40001',message='Reporting profile changed; reload before saving';end if;
 if not (a->>'canEdit')::boolean and ((p_profile-'documents'-'tax') is distinct from (old-'documents'-'tax') or ((p_profile->'tax')-'periods') is distinct from ((old->'tax')-'periods')) then raise exception using errcode='42501',message='Accountant may edit only document classifications and tax period workpapers';end if;
 p:=private.finance_reporting_validate_v1(t,p_entity_id,p_data_environment,p_profile,old,actor,rev+1);
 insert into public.finance_reporting_profiles(tenant_id,data_environment,entity_id,revision,profile,updated_by) values(t,p_data_environment,p_entity_id,rev+1,p,actor)
 on conflict(tenant_id,data_environment,entity_id) do update set revision=excluded.revision,profile=excluded.profile,updated_by=excluded.updated_by,updated_at=clock_timestamp();
 insert into private.finance_reporting_profile_revisions_v1(tenant_id,data_environment,entity_id,revision,profile,reason,actor_id) values(t,p_data_environment,p_entity_id,rev+1,p,btrim(p_reason),actor);
 return public.finance_reporting_profile_read_v1(p_entity_id,p_data_environment);
end $$;
create function public.finance_reporting_profile_history_v1(p_entity_id text,p_data_environment text default 'production') returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare a jsonb:=private.finance_reporting_actor_v1(p_entity_id,p_data_environment); row record; out jsonb:='[]';
begin
 for row in select * from private.finance_reporting_profile_revisions_v1 where tenant_id=(a->>'tenantId')::uuid and data_environment=p_data_environment and entity_id=p_entity_id order by revision desc limit 50 loop
  perform private.finance_reporting_profile_scope_v1((a->>'tenantId')::uuid,p_entity_id,p_data_environment,row.profile);
  out:=out||jsonb_build_array(jsonb_build_object('revision',row.revision,'reason',row.reason,'createdAt',row.created_at,'actorId',row.actor_id,'profile',row.profile));
 end loop;return out;
end $$;
create function private.finance_reporting_revision_immutable_v1() returns trigger language plpgsql set search_path='' as $$
begin raise exception using errcode='42501',message='Reporting revision history is immutable';end $$;
create trigger finance_reporting_revision_immutable_v1 before update or delete on private.finance_reporting_profile_revisions_v1 for each row execute function private.finance_reporting_revision_immutable_v1();

revoke all on function public.finance_reporting_profile_read_v1(text,text),public.finance_reporting_profile_save_v1(text,bigint,jsonb,text,text),public.finance_reporting_profile_history_v1(text,text) from public,anon,authenticated,service_role;
grant execute on function public.finance_reporting_profile_read_v1(text,text),public.finance_reporting_profile_save_v1(text,bigint,jsonb,text,text),public.finance_reporting_profile_history_v1(text,text) to authenticated;
do $$ declare p regprocedure;begin
 for p in select oid::regprocedure from pg_proc where pronamespace='private'::regnamespace and proname like 'finance_reporting_%_v1' loop execute format('revoke all on function %s from public,anon,authenticated,service_role',p);end loop;
 if not exists(select 1 from pg_class where oid='public.finance_reporting_profiles'::regclass and relrowsecurity) or has_table_privilege('authenticated','public.finance_reporting_profiles','UPDATE') or has_function_privilege('anon','public.finance_reporting_profile_save_v1(text,bigint,jsonb,text,text)','EXECUTE') then raise exception 'Reporting profile security postflight failed';end if;
end $$;
