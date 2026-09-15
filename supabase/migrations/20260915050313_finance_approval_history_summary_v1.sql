-- Indexed read projection for approval history. Business sources remain authoritative.
-- No participant grant is cached: both public RPCs verify Google, tenant membership
-- and the original immutable participation predicates on every request.
set local lock_timeout='8s';
set local statement_timeout='120s';

do $preflight$
declare p record;
begin
 select * into p from pg_proc where oid=to_regprocedure('public.finance_approval_participant_history_for_current_user(integer,integer,text,text)');
 if p.oid is null or md5(p.prosrc)<>'3474c4a2001ee6e299634d68213b3f92' or not p.prosecdef or p.provolatile<>'s'
  or pg_get_userbyid(p.proowner)<>'postgres' or p.proconfig is distinct from array['search_path=""']::text[]
  or has_function_privilege('anon',p.oid,'execute') or not has_function_privilege('authenticated',p.oid,'execute') then
  raise exception 'Exact a31 approval history authority baseline required';
 end if;
end;
$preflight$;
-- Atomic backfill needs a consistent source/department snapshot and trigger install.
-- A busy writer causes bounded failure; never publish a partially populated index.
lock table public.expense_requests,public.bills,public.invoices,public.finance_department_units in share row exclusive mode;

create table private.finance_history_source_projection_v1(
 tenant_id uuid not null,data_environment text not null,record_type text not null,source_id text not null,
 group_key text not null,batch_id text not null,source_no text,department_code text,
 search_text text not null,amounts jsonb not null,amount numeric,summary_amount numeric,summary jsonb not null,
 primary key(tenant_id,data_environment,record_type,source_id),
 check(record_type in ('expense_requests','bills','invoices')),check(data_environment in ('production','test'))
);
create index finance_history_source_group_v1 on private.finance_history_source_projection_v1(tenant_id,data_environment,record_type,group_key,source_no,source_id);
create index finance_history_source_department_v1 on private.finance_history_source_projection_v1(tenant_id,department_code);
create table private.finance_history_group_projection_v1(
 tenant_id uuid not null,data_environment text not null,record_type text not null,group_key text not null,
 search_text text not null,normalized_text text not null,plain_text text not null,amounts text[] not null,search_grams text[] not null,
 source_count integer not null,summary jsonb not null,
 primary key(tenant_id,data_environment,record_type,group_key),check(source_count>0)
);
create index finance_history_group_search_v1 on private.finance_history_group_projection_v1 using gin(search_grams);
alter table private.finance_history_source_projection_v1 owner to postgres;
alter table private.finance_history_group_projection_v1 owner to postgres;
alter table private.finance_history_source_projection_v1 enable row level security;
alter table private.finance_history_group_projection_v1 enable row level security;
revoke all on private.finance_history_source_projection_v1,private.finance_history_group_projection_v1 from public,anon,authenticated,service_role;

create function private.finance_history_index_grams_v1(p_text text) returns text[]
language sql immutable set search_path='' as $grams$
 select coalesce(array_agg(distinct gram),'{}'::text[]) from(
  select substr(coalesce(p_text,''),n,k) gram from generate_series(1,length(coalesce(p_text,''))) n cross join generate_series(1,2) k
  where n+k-1<=length(coalesce(p_text,''))
 ) g;
$grams$;
create function private.finance_history_compile_query_v1(p_query text) returns jsonb
language sql immutable set search_path='' as $query$
 select coalesce(jsonb_agg(jsonb_build_object('word',word,'amount',private.finance_history_amount_text_v1(word),
  'decimal',position('.' in word)>0,'literal',word ~ '^[a-z一-龥]+$' and word !~ '[ntwd新臺台幣元]')),'[]'::jsonb)
 from regexp_split_to_table(private.finance_history_search_text_v1(p_query),' ') word where word<>'';
$query$;
create function private.finance_history_index_matches_v1(p_terms jsonb,p_plain text,p_normalized text,p_amounts text[]) returns boolean
language plpgsql immutable set search_path='' as $match$
declare t jsonb; word text; term text; candidate text; matched boolean;
begin
 for t in select value from jsonb_array_elements(p_terms) loop
  word:=t->>'word';term:=t->>'amount';matched:=false;
  if term is not null then
   foreach candidate in array coalesce(p_amounts,'{}'::text[]) loop
    if (case when (t->>'decimal')::boolean then candidate=term else position(term in candidate)>0 end) then matched:=true;exit;end if;
   end loop;
   if matched then continue;end if;
  elsif (t->>'literal')::boolean then
   if position(word in p_plain)>0 then continue;else return false;end if;
  end if;
  if term is not null and (t->>'decimal')::boolean then
   if p_normalized ~ ('(^|[^\d.+-])'||replace(replace(word,'.','\.'),'+','\+')||'(?![\d.])') then continue;end if;
  elsif position(word in p_normalized)>0 then continue;
  end if;
  return false;
 end loop;
 return true;
end;
$match$;
create function private.finance_history_source_business_v1(p_table text,p_row jsonb,p_department text) returns jsonb
language plpgsql immutable set search_path='' as $business$
begin

if p_table='expense_requests' then return jsonb_build_object(
        'id',(p_row->'id'),'no',(p_row->'no'),'entity_id',(p_row->'entity_id'),
        'department_code',(p_row->'department_code'),'applicant',(p_row->'applicant'),'status',(p_row->'status'),
        'amount',(p_row->'amount'),'created_at',(p_row->'created_at'),'type',(p_row->'type'),
        'type_label',(p_row->'type_label'),'description',(p_row->'description'),'request_date',(p_row->'request_date'),
        'expected_pay_date',(p_row->'expected_pay_date'),'estimated_amount',(p_row->'estimated_amount'),'actual_amount',(p_row->'actual_amount'),
        'bank_fee_amount',(p_row->'bank_fee_amount'),'debit_account',(p_row->'debit_account'),'debit_account_name',(p_row->'debit_account_name'),
        'credit_account',(p_row->'credit_account'),'credit_account_name',(p_row->'credit_account_name'),'payee',(p_row->'payee'),
        'fee_bearer',(p_row->'fee_bearer'),'petty_mode',(p_row->'petty_mode'),'department_name',p_department,
        'status_label',case (p_row->>'status') when 'completed' then '已完成' when 'rejected' then '被駁回' when 'cancelled' then '已抽單取消' when 'pending_section_chief' then '待上一層主管' when 'pending_dept_manager' then '待申請人部門主任' when 'pending_admin_director' then '待行政部門主任' when 'pending_procurement' then '待總務採購審核' when 'pending_hr' then '待人資' when 'pending_accountant' then '待會計' when 'pending_ceo' then '待執行長檢視科目' when 'pending_cashier' then '待出納放款' when 'pending_applicant_confirm' then '待申請人確認' when 'pending_voucher' then '待會計入帳' when 'pending_countersign' then '待指定員工加簽' else '' end,'files',(select coalesce(jsonb_agg(jsonb_build_object('n',f->'n','name',f->'name','fileName',f->'fileName','filename',f->'filename')),'[]'::jsonb) from jsonb_array_elements(case when jsonb_typeof((p_row->'files'))='array' then (p_row->'files') else '[]'::jsonb end) f where jsonb_typeof(f)='object'),'actual_files',(select coalesce(jsonb_agg(jsonb_build_object('n',f->'n','name',f->'name','fileName',f->'fileName','filename',f->'filename')),'[]'::jsonb) from jsonb_array_elements(case when jsonb_typeof((p_row->'actual_files'))='array' then (p_row->'actual_files') else '[]'::jsonb end) f where jsonb_typeof(f)='object'),
        'form_payload',(select coalesce(jsonb_object_agg(e.key,case when e.key=any(array['attachments','files','actualFiles','passbookFiles'])
            then (select coalesce(jsonb_agg(jsonb_build_object('n',f->'n','name',f->'name','fileName',f->'fileName','filename',f->'filename')),'[]'::jsonb) from jsonb_array_elements(case when jsonb_typeof(e.value)='array' then e.value else '[]'::jsonb end) f where jsonb_typeof(f)='object') else e.value end),'{}'::jsonb)
          from jsonb_each(case when jsonb_typeof((p_row->'form_payload'))='object' then (p_row->'form_payload') else '{}'::jsonb end) e
          where e.key=any(array['requestPurpose','requestNote','description','reason','note','memo','purpose','summary','project','outcome','item','itemName','item_name','payeeName','shareholderName','transactionType','amount','amt','total','gross','net','tax','price','unitPrice','taxAmount','grossAmount','netAmount','untaxedAmount','receiptType','paymentType','hrItem','pettyMode','accountingLines','lazyRows','refundRows','purchaseRows','hrRows','travelInfo','refundInfo','purchaseInfo','hrInfo','shareholderTxn','shareholderAccounting','rows','nested','ordinaryNested','attachments','files','actualFiles','passbookFiles']))
      ) || jsonb_build_object('department_alias',case when position('日間照顧' in coalesce(p_department,''))>0 then '日照' else null end);end if;

if p_table='bills' then return jsonb_build_object(
        'id',(p_row->'id'),'no',(p_row->'no'),'entity_id',(p_row->'entity_id'),
        'department_code',(p_row->'department_code'),'applicant',(p_row->'applicant'),'status',(p_row->'status'),
        'amount',(p_row->'amount'),'created_at',(p_row->'created_at'),'entity_name',(p_row->'entity_name'),
        'batch_id',(p_row->'batch_id'),'item',(p_row->'item'),'payer_name',(p_row->'payer_name'),
        'note',(p_row->'note'),'approval_status',(p_row->'approval_status'),'service_period',(p_row->'service_period'),
        'method',(p_row->'method'),'due_date',(p_row->'due_date'),'paid_at',(p_row->'paid_at'),
        'invoice_followup_status',(p_row->'invoice_followup_status'),'invoice_followup_note',(p_row->'invoice_followup_note'),'department_name',p_department
      ) || jsonb_build_object('department_alias',case when position('日間照顧' in coalesce(p_department,''))>0 then '日照' else null end);end if;

if p_table='invoices' then return jsonb_build_object(
        'id',(p_row->'id'),'no',(p_row->'no'),'entity_id',(p_row->'entity_id'),
        'department_code',(p_row->'department_code'),'applicant',(p_row->'applicant'),'status',(p_row->'status'),
        'amount',(p_row->'amount'),'created_at',(p_row->'created_at'),'entity_name',(p_row->'entity_name'),
        'batch_id',(p_row->'batch_id'),'buyer',(p_row->'buyer'),'description',(p_row->'description'),
        'tax',(p_row->'tax'),'total',(p_row->'total'),'invoice_date',(p_row->'invoice_date'),
        'paid_at',(p_row->'paid_at'),'approval_status',(p_row->'approval_status'),'invoice_identifier_type',(p_row->'invoice_identifier_type'),
        'invoice_item_type',(p_row->'invoice_item_type'),'payer_type',(p_row->'payer_type'),'funding_source',(p_row->'funding_source'),
        'service_period',(p_row->'service_period'),'contract_no',(p_row->'contract_no'),'revenue_account_code',(p_row->'revenue_account_code'),
        'revenue_account_name',(p_row->'revenue_account_name'),'receipt_note',(p_row->'receipt_note'),'department_name',p_department,
        'receipt_files',(select coalesce(jsonb_agg(jsonb_build_object('n',f->'n','name',f->'name','fileName',f->'fileName','filename',f->'filename')),'[]'::jsonb) from jsonb_array_elements(case when jsonb_typeof((p_row->'receipt_files'))='array' then (p_row->'receipt_files') else '[]'::jsonb end) f where jsonb_typeof(f)='object')
      ) || jsonb_build_object('department_alias',case when position('日間照顧' in coalesce(p_department,''))>0 then '日照' else null end);end if;

raise exception 'Unsupported history source' using errcode='22023';
end;
$business$;

create function private.finance_history_summary_number_v1(p_value jsonb) returns numeric
language sql immutable set search_path='' as $number$
 select private.finance_history_amount_text_v1(p_value#>>'{}')::numeric;
$number$;
create function private.finance_history_summary_amount_v1(p_table text,p_row jsonb) returns numeric
language plpgsql immutable set search_path='' as $amount$
declare v numeric; x jsonb;
begin
 if p_table='invoices' then return coalesce(private.finance_history_summary_number_v1(p_row->'total'),private.finance_history_summary_number_v1(p_row->'amount'));end if;
 if p_table='expense_requests' and p_row->>'type'='purchase_request' then
  for x in select value from jsonb_array_elements(jsonb_build_array(p_row->'actual_amount',p_row#>'{form_payload,purchaseActual,actualAmount}',p_row#>'{form_payload,procurementReceiptInfo,actualAmount}',
    p_row->'estimated_amount',p_row#>'{form_payload,purchaseEstimate,procurementAmount}',p_row#>'{form_payload,procurementPaymentInfo,amount}',p_row#>'{form_payload,purchaseEstimate,requestAmount}',p_row#>'{form_payload,purchaseInfo,total}' )) loop
   v:=private.finance_history_summary_number_v1(x);if v is not null and v<>0 then return v;end if;
  end loop;
 elsif p_table='expense_requests' and p_row->>'type'='advance_request' then
  return coalesce(nullif(private.finance_history_summary_number_v1(p_row->'actual_amount'),0),nullif(private.finance_history_summary_number_v1(p_row->'estimated_amount'),0),private.finance_history_summary_number_v1(p_row->'amount'));
 end if;
 return private.finance_history_summary_number_v1(p_row->'amount');
end;
$amount$;
create function private.finance_history_project_source_v1(p_table text,p_row jsonb) returns boolean
language plpgsql volatile set search_path='' as $project$
declare t uuid:=(p_row->>'tenant_id')::uuid;e text:=p_row->>'data_environment';id text:=p_row->>'id';b text;d text;business jsonb;f jsonb;summary jsonb;affected integer;
begin
 if t is null or e not in ('production','test') or id is null then return false;end if;
 b:=case when p_table='expense_requests' then '' else coalesce(nullif(btrim(p_row->>'batch_id'),''),'') end;
 select string_agg(u.name,' ' order by u.name) into d from public.finance_department_units u where u.tenant_id=t and u.code=p_row->>'department_code';
 business:=private.finance_history_source_business_v1(p_table,p_row,d);
 f:=private.finance_history_search_fields_v1(business);
 summary:=jsonb_build_object('type',left(p_row->>'type',40),'type_label',left(p_row->>'type_label',60),
  'status',left(p_row->>'status',80),'approval_status',left(p_row->>'approval_status',80),
  'entity_id',left(p_row->>'entity_id',80),'entity_name',left(p_row->>'entity_name',80),
  'department_code',left(p_row->>'department_code',60),'department_name',left(d,80),
  'applicant',left(p_row->>'applicant',80),
  'description',left(coalesce(nullif(btrim(p_row->>'description'),''),nullif(btrim(p_row->>'item'),''),nullif(btrim(p_row#>>'{form_payload,requestPurpose}'),''),p_row#>>'{form_payload,purpose}',''),200),
  'request_date',left(coalesce(p_row->>'request_date',p_row->>'invoice_date',p_row->>'created_at'),40),
  'expected_pay_date',left(coalesce(p_row->>'expected_pay_date',p_row->>'due_date'),40),
  'has_attachments',case when p_table='bills' then null else exists(select 1 from jsonb_array_elements(jsonb_build_array(p_row->'files',p_row->'actual_files',p_row->'receipt_files',p_row#>'{form_payload,attachments}',p_row#>'{form_payload,passbookFiles}' )) files where jsonb_typeof(files)='array' and files<>'[]'::jsonb) end);
 insert into private.finance_history_source_projection_v1 as p(tenant_id,data_environment,record_type,source_id,group_key,batch_id,source_no,department_code,search_text,amounts,amount,summary_amount,summary)
 values(t,e,p_table,id,coalesce(nullif(b,''),id),b,coalesce(p_row->>'no',id),p_row->>'department_code',f->>'text',f->'amounts',
  case when p_table='invoices' then coalesce(private.finance_history_summary_number_v1(p_row->'total'),private.finance_history_summary_number_v1(p_row->'amount')) else private.finance_history_summary_number_v1(p_row->'amount') end,
  private.finance_history_summary_amount_v1(p_table,p_row),summary)
 on conflict(tenant_id,data_environment,record_type,source_id) do update set group_key=excluded.group_key,batch_id=excluded.batch_id,source_no=excluded.source_no,department_code=excluded.department_code,search_text=excluded.search_text,amounts=excluded.amounts,amount=excluded.amount,summary_amount=excluded.summary_amount,summary=excluded.summary
 where row(p.group_key,p.batch_id,p.source_no,p.department_code,p.search_text,p.amounts,p.amount,p.summary_amount,p.summary)
 is distinct from row(excluded.group_key,excluded.batch_id,excluded.source_no,excluded.department_code,excluded.search_text,excluded.amounts,excluded.amount,excluded.summary_amount,excluded.summary);
 get diagnostics affected=row_count;return affected>0;
end;
$project$;
create function private.finance_history_refresh_group_v1(p_tenant uuid,p_environment text,p_table text,p_key text) returns void
language plpgsql volatile set search_path='' as $refresh$
declare raw text;norm text;plain text;a text[];cnt integer;summary jsonb;display_amount numeric;
begin
 select count(*)::integer,string_agg(s.search_text,' ' order by s.source_no,s.source_id),
  case when count(s.summary_amount)=count(*) then sum(s.summary_amount) end
 into cnt,raw,display_amount from private.finance_history_source_projection_v1 s
 where s.tenant_id=p_tenant and s.data_environment=p_environment and s.record_type=p_table and s.group_key=p_key;
 if cnt=0 then delete from private.finance_history_group_projection_v1 where tenant_id=p_tenant and data_environment=p_environment and record_type=p_table and group_key=p_key;return;end if;
 select s.summary into summary from private.finance_history_source_projection_v1 s where s.tenant_id=p_tenant and s.data_environment=p_environment and s.record_type=p_table and s.group_key=p_key order by s.source_no,s.source_id limit 1;
 summary:=summary||jsonb_build_object('source_count',cnt,'amount',display_amount);
 select coalesce(array_agg(distinct value),'{}'::text[]) into a from (
  select trim_scale((value#>>'{}')::numeric)::text value
  from private.finance_history_source_projection_v1 s cross join lateral jsonb_array_elements(s.amounts) value
  where s.tenant_id=p_tenant and s.data_environment=p_environment and s.record_type=p_table and s.group_key=p_key and jsonb_typeof(value)='number'
  union all
  select trim_scale(sum(amount))::text from private.finance_history_source_projection_v1 s
  where s.tenant_id=p_tenant and s.data_environment=p_environment and s.record_type=p_table and s.group_key=p_key having sum(amount) is not null
 ) amount_values;
 norm:=private.finance_history_search_text_v1(raw);plain:=lower(normalize(raw,NFKC));
 insert into private.finance_history_group_projection_v1 as p(tenant_id,data_environment,record_type,group_key,search_text,normalized_text,plain_text,amounts,search_grams,source_count,summary)
 values(p_tenant,p_environment,p_table,p_key,raw,norm,plain,a,private.finance_history_index_grams_v1(norm||' '||plain||' '||array_to_string(a,' ')),cnt,summary)
 on conflict(tenant_id,data_environment,record_type,group_key) do update set search_text=excluded.search_text,normalized_text=excluded.normalized_text,plain_text=excluded.plain_text,amounts=excluded.amounts,search_grams=excluded.search_grams,source_count=excluded.source_count,summary=excluded.summary;
end;
$refresh$;

create function private.finance_history_actor_v1() returns public.finance_users
language plpgsql stable set search_path='' as $actor$
declare v_auth_user_id uuid:=auth.uid();v_verified_email text;v_user public.finance_users%rowtype;v_member_count integer;
begin
  if v_auth_user_id is null then
    raise exception 'Authentication is required for approval history'
      using errcode = '42501';
  end if;

  v_verified_email := public.finance_verified_google_email(v_auth_user_id);
  if nullif(v_verified_email, '') is null then
    raise exception 'A verified Google identity is required for approval history'
      using errcode = '42501';
  end if;

  select count(*)::integer
  into v_member_count
  from public.finance_users fu
  join public.tenant_members tm
    on tm.tenant_id = fu.tenant_id
   and tm.finance_user_id = fu.id
   and tm.auth_user_id = v_auth_user_id
   and tm.active = true
  where fu.auth_user_id = v_auth_user_id
    and lower(btrim(fu.email)) = lower(btrim(v_verified_email))
    and fu.active = true;

  if v_member_count <> 1 then
    raise exception 'Approval history identity is not uniquely bound to an active tenant member'
      using errcode = '42501';
  end if;

  select fu.*
  into v_user
  from public.finance_users fu
  join public.tenant_members tm
    on tm.tenant_id = fu.tenant_id
   and tm.finance_user_id = fu.id
   and tm.auth_user_id = v_auth_user_id
   and tm.active = true
  where fu.auth_user_id = v_auth_user_id
    and lower(btrim(fu.email)) = lower(btrim(v_verified_email))
    and fu.active = true;

return v_user;
end;
$actor$;
create function private.finance_history_groups_v1(v_user public.finance_users,v_environment text)
returns table(kind text,record_type text,group_key text,representative_id text,batch_id text,record_no text,last_participated_at timestamptz,personally_acted boolean)
language sql stable set search_path='' as $groups$
  with matched_steps as (
    select
      snapshot.*,
      case
        when nullif(btrim(snapshot.acted_at_text), '') is not null
         and pg_catalog.pg_input_is_valid(btrim(snapshot.acted_at_text), 'timestamp with time zone')
          then btrim(snapshot.acted_at_text)::timestamptz
        else snapshot.updated_at
      end as participation_at,
      (
        snapshot.acted_by_user_id in (v_user.id, v_user.auth_user_id::text)
        or snapshot.raw_actor_user_id in (v_user.id, v_user.auth_user_id::text)
        or lower(btrim(coalesce(snapshot.raw_actor_email, ''))) = lower(btrim(v_user.email))
      ) as personally_acted
    from public.approval_step_actor_snapshots snapshot
    where snapshot.tenant_id = v_user.tenant_id
      and snapshot.data_environment = v_environment
      and snapshot.record_type in ('expense_requests', 'bills', 'invoices')
      and (
        snapshot.resolved_user_id = v_user.id
        or snapshot.acted_by_user_id in (v_user.id, v_user.auth_user_id::text)
        or snapshot.raw_actor_user_id in (v_user.id, v_user.auth_user_id::text)
        or lower(btrim(coalesce(snapshot.resolved_email, ''))) = lower(btrim(v_user.email))
        or lower(btrim(coalesce(snapshot.raw_actor_email, ''))) = lower(btrim(v_user.email))
      )
  ),
  record_matches as (
    select
      'req'::text as kind,
      'expense_requests'::text as record_type,
      request_row.id as group_key,
      request_row.id as record_id,
      ''::text as batch_id,
      request_row.no as record_no,
      max(matched.participation_at) as last_participated_at,
      bool_or(matched.personally_acted) as personally_acted
    from matched_steps matched
    join public.expense_requests request_row
      on matched.record_type = 'expense_requests'
     and request_row.tenant_id = matched.tenant_id
     and request_row.data_environment = matched.data_environment
     and request_row.id = matched.record_id
    group by request_row.id, request_row.no

    union all

    select
      'bill'::text,
      'bills'::text,
      coalesce(nullif(btrim(bill_row.batch_id), ''), bill_row.id),
      bill_row.id,
      coalesce(nullif(btrim(bill_row.batch_id), ''), ''),
      coalesce(bill_row.no, bill_row.id),
      max(matched.participation_at),
      bool_or(matched.personally_acted)
    from matched_steps matched
    join public.bills bill_row
      on matched.record_type = 'bills'
     and bill_row.tenant_id = matched.tenant_id
     and bill_row.data_environment = matched.data_environment
     and bill_row.id = matched.record_id
    group by bill_row.id, bill_row.batch_id, bill_row.no

    union all

    select
      'inv'::text,
      'invoices'::text,
      coalesce(nullif(btrim(invoice_row.batch_id), ''), invoice_row.id),
      invoice_row.id,
      coalesce(nullif(btrim(invoice_row.batch_id), ''), ''),
      coalesce(invoice_row.no, invoice_row.id),
      max(matched.participation_at),
      bool_or(matched.personally_acted)
    from matched_steps matched
    join public.invoices invoice_row
      on matched.record_type = 'invoices'
     and invoice_row.tenant_id = matched.tenant_id
     and invoice_row.data_environment = matched.data_environment
     and invoice_row.id = matched.record_id
    group by invoice_row.id, invoice_row.batch_id, invoice_row.no
  ),
  group_keys as (
    select
      kind,
      record_type,
      group_key,
      min(record_id) as representative_id,
      max(batch_id) as batch_id,
      min(record_no) as record_no,
      max(last_participated_at) as last_participated_at,
      bool_or(personally_acted) as personally_acted
    from record_matches
    group by kind, record_type, group_key
  ) select * from group_keys;
$groups$;

create function public.finance_approval_history_summary_v1(p_limit integer default 50,p_offset integer default 0,p_search text default null,p_data_environment text default 'production') returns jsonb
language plpgsql stable security definer set search_path='' as $summary$
declare u public.finance_users%rowtype; e text:=lower(btrim(coalesce(p_data_environment,'production')));lim integer:=coalesce(p_limit,50);off integer:=coalesce(p_offset,0);q text:=lower(btrim(coalesce(p_search,'')));terms jsonb;grams text[];result jsonb;
begin
 u:=private.finance_history_actor_v1();
 if lim<1 or lim>50 or off<0 or e not in ('test','production') or length(q)>120 then raise exception 'Invalid history search page/environment' using errcode='22023';end if;
 terms:=private.finance_history_compile_query_v1(q);
 select coalesce(array_agg(distinct gram),'{}'::text[]) into grams from jsonb_array_elements(terms) term cross join lateral unnest(private.finance_history_index_grams_v1(coalesce(ltrim(term->>'amount','-'),term->>'word'))) gram;
 with authorized as materialized(select * from private.finance_history_groups_v1(u,e)),
 eligible as materialized(
  select a.*,p.summary,p.source_count from private.finance_history_group_projection_v1 p join authorized a on a.record_type=p.record_type and a.group_key=p.group_key
  where p.tenant_id=u.tenant_id and p.data_environment=e
   and (q='' or (p.search_grams @> grams and private.finance_history_index_matches_v1(terms,p.plain_text,p.normalized_text,p.amounts)))
 ), page_rows as(select * from eligible order by last_participated_at desc,record_type,record_no,group_key limit lim offset off)
 select jsonb_build_object('ok',true,'mode','summary','identity',jsonb_build_object('auth_user_id',u.auth_user_id,'finance_user_id',u.id,'tenant_id',u.tenant_id,'email',u.email,'data_environment',e),
  'total',(select count(*) from eligible),'all_total',(select count(*) from authorized),
  'projection_complete',not exists(select 1 from authorized a where not exists(select 1 from private.finance_history_group_projection_v1 p where p.tenant_id=u.tenant_id and p.data_environment=e and p.record_type=a.record_type and p.group_key=a.group_key)),
  'page',jsonb_build_object('limit',lim,'offset',off,'has_more',off+lim<(select count(*) from eligible)),
  'items',coalesce((select jsonb_agg(jsonb_build_object('history_key',p.record_type||':'||p.group_key,'kind',p.kind,'record_type',p.record_type,'record_id',p.representative_id,'record_no',p.record_no,'batch_id',p.batch_id,'last_participated_at',p.last_participated_at,'personally_acted',coalesce(p.personally_acted,false),'participation_label',case when p.personally_acted then '本人已處理' else '曾列入流程' end,'summary',p.summary) order by p.last_participated_at desc,p.record_type,p.record_no,p.group_key) from page_rows p),'[]'::jsonb)
 ) into result;
 if not (result->>'projection_complete')::boolean then raise exception 'History search index is incomplete; no partial results returned' using errcode='55000';end if;
 if octet_length(result::text)>200000 then raise exception 'History summary exceeds safe page size; please contact support' using errcode='54000';end if;
 return result;
end;
$summary$;

create function public.finance_approval_history_detail_v1(p_history_key text,p_data_environment text default 'production') returns jsonb
language plpgsql stable security definer set search_path='' as $detail$
declare u public.finance_users%rowtype;e text:=lower(btrim(coalesce(p_data_environment,'production')));result jsonb;
begin
 u:=private.finance_history_actor_v1();
 if e not in ('test','production') or nullif(p_history_key,'') is null then raise exception 'Invalid history detail scope' using errcode='22023';end if;
  with matched_steps as (
    select
      snapshot.*,
      case
        when nullif(btrim(snapshot.acted_at_text), '') is not null
         and pg_catalog.pg_input_is_valid(btrim(snapshot.acted_at_text), 'timestamp with time zone')
          then btrim(snapshot.acted_at_text)::timestamptz
        else snapshot.updated_at
      end as participation_at,
      (
        snapshot.acted_by_user_id in (u.id, u.auth_user_id::text)
        or snapshot.raw_actor_user_id in (u.id, u.auth_user_id::text)
        or lower(btrim(coalesce(snapshot.raw_actor_email, ''))) = lower(btrim(u.email))
      ) as personally_acted
    from public.approval_step_actor_snapshots snapshot
    where snapshot.tenant_id = u.tenant_id
      and snapshot.data_environment = e
      and snapshot.record_type in ('expense_requests', 'bills', 'invoices')
      and (
        snapshot.resolved_user_id = u.id
        or snapshot.acted_by_user_id in (u.id, u.auth_user_id::text)
        or snapshot.raw_actor_user_id in (u.id, u.auth_user_id::text)
        or lower(btrim(coalesce(snapshot.resolved_email, ''))) = lower(btrim(u.email))
        or lower(btrim(coalesce(snapshot.raw_actor_email, ''))) = lower(btrim(u.email))
      )
  ),
  record_matches as (
    select
      'req'::text as kind,
      'expense_requests'::text as record_type,
      request_row.id as group_key,
      request_row.id as record_id,
      ''::text as batch_id,
      request_row.no as record_no,
      max(matched.participation_at) as last_participated_at,
      bool_or(matched.personally_acted) as personally_acted
    from matched_steps matched
    join public.expense_requests request_row
      on matched.record_type = 'expense_requests'
     and request_row.tenant_id = matched.tenant_id
     and request_row.data_environment = matched.data_environment
     and request_row.id = matched.record_id
    group by request_row.id, request_row.no

    union all

    select
      'bill'::text,
      'bills'::text,
      coalesce(nullif(btrim(bill_row.batch_id), ''), bill_row.id),
      bill_row.id,
      coalesce(nullif(btrim(bill_row.batch_id), ''), ''),
      coalesce(bill_row.no, bill_row.id),
      max(matched.participation_at),
      bool_or(matched.personally_acted)
    from matched_steps matched
    join public.bills bill_row
      on matched.record_type = 'bills'
     and bill_row.tenant_id = matched.tenant_id
     and bill_row.data_environment = matched.data_environment
     and bill_row.id = matched.record_id
    group by bill_row.id, bill_row.batch_id, bill_row.no

    union all

    select
      'inv'::text,
      'invoices'::text,
      coalesce(nullif(btrim(invoice_row.batch_id), ''), invoice_row.id),
      invoice_row.id,
      coalesce(nullif(btrim(invoice_row.batch_id), ''), ''),
      coalesce(invoice_row.no, invoice_row.id),
      max(matched.participation_at),
      bool_or(matched.personally_acted)
    from matched_steps matched
    join public.invoices invoice_row
      on matched.record_type = 'invoices'
     and invoice_row.tenant_id = matched.tenant_id
     and invoice_row.data_environment = matched.data_environment
     and invoice_row.id = matched.record_id
    group by invoice_row.id, invoice_row.batch_id, invoice_row.no
  ),
  group_keys as (
    select
      kind,
      record_type,
      group_key,
      min(record_id) as representative_id,
      max(batch_id) as batch_id,
      min(record_no) as record_no,
      max(last_participated_at) as last_participated_at,
      bool_or(personally_acted) as personally_acted
    from record_matches
    group by kind, record_type, group_key
  ), candidate_groups as materialized(select * from group_keys where record_type||':'||group_key=p_history_key),
  source_records as (
    select
      group_row.kind,
      group_row.record_type,
      group_row.group_key,
      request_row.id as source_id,
      request_row.no as source_no,
      to_jsonb(request_row) as source_row
    from candidate_groups group_row
    join public.expense_requests request_row
      on group_row.record_type = 'expense_requests'
     and request_row.tenant_id = u.tenant_id
     and request_row.data_environment = e
     and request_row.id = group_row.representative_id

    union all

    select
      group_row.kind,
      group_row.record_type,
      group_row.group_key,
      bill_row.id,
      coalesce(bill_row.no, bill_row.id),
      to_jsonb(bill_row)
    from candidate_groups group_row
    join public.bills bill_row
      on group_row.record_type = 'bills'
     and bill_row.tenant_id = u.tenant_id
     and bill_row.data_environment = e
     and group_row.batch_id <> ''
     and nullif(btrim(bill_row.batch_id), '') = group_row.batch_id

    union all

    select
      group_row.kind,
      group_row.record_type,
      group_row.group_key,
      bill_row.id,
      coalesce(bill_row.no, bill_row.id),
      to_jsonb(bill_row)
    from candidate_groups group_row
    join public.bills bill_row
      on group_row.record_type = 'bills'
     and bill_row.tenant_id = u.tenant_id
     and bill_row.data_environment = e
     and group_row.batch_id = ''
     and bill_row.id = group_row.representative_id

    union all

    select
      group_row.kind,
      group_row.record_type,
      group_row.group_key,
      invoice_row.id,
      coalesce(invoice_row.no, invoice_row.id),
      to_jsonb(invoice_row)
    from candidate_groups group_row
    join public.invoices invoice_row
      on group_row.record_type = 'invoices'
     and invoice_row.tenant_id = u.tenant_id
     and invoice_row.data_environment = e
     and group_row.batch_id <> ''
     and nullif(btrim(invoice_row.batch_id), '') = group_row.batch_id

    union all

    select
      group_row.kind,
      group_row.record_type,
      group_row.group_key,
      invoice_row.id,
      coalesce(invoice_row.no, invoice_row.id),
      to_jsonb(invoice_row)
    from candidate_groups group_row
    join public.invoices invoice_row
      on group_row.record_type = 'invoices'
     and invoice_row.tenant_id = u.tenant_id
     and invoice_row.data_environment = e
     and group_row.batch_id = ''
     and invoice_row.id = group_row.representative_id
  ),
  participant_groups as materialized (
    select record_match.kind, record_match.group_key,
      jsonb_agg(
              jsonb_build_object(
                'record_id', matched.record_id,
                'step_index', matched.step_index,
                'step_title', matched.step_title,
                'step_status', matched.step_status,
                'workflow_status', matched.workflow_status,
                'role_key', matched.role_key,
                'resolved_user_id', matched.resolved_user_id,
                'acted_by_user_id', matched.acted_by_user_id,
                'acted_by_name', matched.acted_by_name,
                'acted_at', matched.acted_at_text,
                'participation_at', matched.participation_at,
                'personally_acted', matched.personally_acted
              )
              order by matched.participation_at desc, matched.record_id, matched.step_index
            ) as steps
    from matched_steps matched
    join record_matches record_match
      on record_match.record_type = matched.record_type
     and record_match.record_id = matched.record_id
    join candidate_groups candidate on candidate.kind=record_match.kind and candidate.group_key=record_match.group_key
    group by record_match.kind, record_match.group_key
  )
 select jsonb_build_object('ok',true,'identity',jsonb_build_object('auth_user_id',u.auth_user_id,'finance_user_id',u.id,'tenant_id',u.tenant_id,'email',u.email,'data_environment',e),
 'item',jsonb_build_object('history_key',g.record_type||':'||g.group_key,'kind',g.kind,'record_type',g.record_type,'record_id',g.representative_id,'record_no',g.record_no,'batch_id',g.batch_id,'last_participated_at',g.last_participated_at,'personally_acted',g.personally_acted,'participation_label',case when g.personally_acted then '本人已處理' else '曾列入流程' end,
  'source_count',(select count(*) from source_records),'source_rows',(select jsonb_agg(s.source_row order by s.source_no,s.source_id) from source_records s),'participant_steps',coalesce(p.steps,'[]'::jsonb)))
 into result from candidate_groups g left join participant_groups p on p.kind=g.kind and p.group_key=g.group_key;
 if result is null or coalesce((result#>>'{item,source_count}')::integer,0)=0 then raise exception 'History detail is not available to the current participant' using errcode='42501';end if;
 return result;
end;
$detail$;

create function private.finance_history_projection_source_trigger_v1() returns trigger
language plpgsql security definer set search_path='' as $trigger$
declare changes jsonb;r jsonb;oldrow jsonb;newrow jsonb;keys text[]:='{}';lockkey text;compare_sql text;t uuid;e text;k text;dirty boolean:=false;affected integer;
begin
 if tg_op='INSERT' then select coalesce(jsonb_agg(jsonb_build_object('new',to_jsonb(n))),'[]'::jsonb) into changes from new_source n;
 elsif tg_op='DELETE' then select coalesce(jsonb_agg(jsonb_build_object('old',to_jsonb(o))),'[]'::jsonb) into changes from old_source o;
 else
 if tg_table_name='expense_requests' then compare_sql:='row(n.id,n.no,n.tenant_id,n.data_environment,n.entity_id,n.department_code,n.applicant,n.status,n.amount,n.created_at,n.type,n.type_label,n.description,n.request_date,n.expected_pay_date,n.estimated_amount,n.actual_amount,n.bank_fee_amount,n.debit_account,n.debit_account_name,n.credit_account,n.credit_account_name,n.payee,n.fee_bearer,n.petty_mode,n.files,n.actual_files,n.form_payload) is distinct from row(o.id,o.no,o.tenant_id,o.data_environment,o.entity_id,o.department_code,o.applicant,o.status,o.amount,o.created_at,o.type,o.type_label,o.description,o.request_date,o.expected_pay_date,o.estimated_amount,o.actual_amount,o.bank_fee_amount,o.debit_account,o.debit_account_name,o.credit_account,o.credit_account_name,o.payee,o.fee_bearer,o.petty_mode,o.files,o.actual_files,o.form_payload)';end if;
 if tg_table_name='bills' then compare_sql:='row(n.id,n.no,n.tenant_id,n.data_environment,n.entity_id,n.department_code,n.applicant,n.status,n.amount,n.created_at,n.entity_name,n.batch_id,n.item,n.payer_name,n.note,n.approval_status,n.service_period,n.method,n.due_date,n.paid_at,n.invoice_followup_status,n.invoice_followup_note) is distinct from row(o.id,o.no,o.tenant_id,o.data_environment,o.entity_id,o.department_code,o.applicant,o.status,o.amount,o.created_at,o.entity_name,o.batch_id,o.item,o.payer_name,o.note,o.approval_status,o.service_period,o.method,o.due_date,o.paid_at,o.invoice_followup_status,o.invoice_followup_note)';end if;
 if tg_table_name='invoices' then compare_sql:='row(n.id,n.no,n.tenant_id,n.data_environment,n.entity_id,n.department_code,n.applicant,n.status,n.amount,n.created_at,n.entity_name,n.batch_id,n.buyer,n.description,n.tax,n.total,n.invoice_date,n.paid_at,n.approval_status,n.invoice_identifier_type,n.invoice_item_type,n.payer_type,n.funding_source,n.service_period,n.contract_no,n.revenue_account_code,n.revenue_account_name,n.receipt_note,n.receipt_files) is distinct from row(o.id,o.no,o.tenant_id,o.data_environment,o.entity_id,o.department_code,o.applicant,o.status,o.amount,o.created_at,o.entity_name,o.batch_id,o.buyer,o.description,o.tax,o.total,o.invoice_date,o.paid_at,o.approval_status,o.invoice_identifier_type,o.invoice_item_type,o.payer_type,o.funding_source,o.service_period,o.contract_no,o.revenue_account_code,o.revenue_account_name,o.receipt_note,o.receipt_files)';end if;
 if compare_sql is null then raise exception 'Unexpected projection source';end if;
 execute 'select coalesce(jsonb_agg(jsonb_build_object(''new'',to_jsonb(n),''old'',to_jsonb(o))),''[]''::jsonb) from new_source n full join old_source o on n.id=o.id where '||compare_sql into changes;
 end if;
 if changes='[]'::jsonb then return null;end if;
 -- Source writers share department locks. Renames take the exclusive form.
 for r in select x.row from jsonb_array_elements(changes) c cross join lateral(values(c->'old'),(c->'new')) x(row) where x.row is not null and x.row<>'null'::jsonb loop
  if nullif(r->>'tenant_id','') is not null then keys:=array_append(keys,'history-dept:'||(r->>'tenant_id')||':'||coalesce(r->>'department_code',''));end if;
 end loop;
 for lockkey in select distinct unnest(keys) order by 1 loop perform pg_advisory_xact_lock_shared(hashtextextended(lockkey,0));end loop;
 keys:='{}';
 for r in select x.row from jsonb_array_elements(changes) c cross join lateral(values(c->'old'),(c->'new')) x(row) where x.row is not null and x.row<>'null'::jsonb loop
  if nullif(r->>'tenant_id','') is not null then keys:=array_append(keys,'history-group:'||(r->>'tenant_id')||':'||(r->>'data_environment')||':'||tg_table_name||':'||case when tg_table_name='expense_requests' then r->>'id' else coalesce(nullif(btrim(r->>'batch_id'),''),r->>'id') end);end if;
 end loop;
 -- All keys for this statement are held before projection changes or aggregates.
 for lockkey in select distinct unnest(keys) order by 1 loop perform pg_advisory_xact_lock(hashtextextended(lockkey,0));end loop;
 for r in select value from jsonb_array_elements(changes) loop
  oldrow:=nullif(r->'old','null'::jsonb);newrow:=nullif(r->'new','null'::jsonb);
  if oldrow is not null and (newrow is null or row(oldrow->>'tenant_id',oldrow->>'data_environment',oldrow->>'id') is distinct from row(newrow->>'tenant_id',newrow->>'data_environment',newrow->>'id')) then
   delete from private.finance_history_source_projection_v1 where tenant_id=(oldrow->>'tenant_id')::uuid and data_environment=oldrow->>'data_environment' and record_type=tg_table_name and source_id=oldrow->>'id';
   get diagnostics affected=row_count;dirty:=dirty or affected>0;
  end if;
 end loop;
 for r in select value from jsonb_array_elements(changes) loop
  newrow:=nullif(r->'new','null'::jsonb);
  if newrow is not null then dirty:=private.finance_history_project_source_v1(tg_table_name,newrow) or dirty;end if;
 end loop;
 if not dirty then return null;end if;
 for r in select distinct jsonb_build_object('tenant_id',x.row->>'tenant_id','data_environment',x.row->>'data_environment','group_key',case when tg_table_name='expense_requests' then x.row->>'id' else coalesce(nullif(btrim(x.row->>'batch_id'),''),x.row->>'id') end)
  from jsonb_array_elements(changes) c cross join lateral(values(c->'old'),(c->'new')) x(row) where x.row is not null and x.row<>'null'::jsonb loop
  t:=(r->>'tenant_id')::uuid;e:=r->>'data_environment';k:=r->>'group_key';
  if t is not null then perform private.finance_history_refresh_group_v1(t,e,tg_table_name,k);end if;
 end loop;
 return null;
end;
$trigger$;
create function private.finance_history_projection_department_trigger_v1() returns trigger
language plpgsql security definer set search_path='' as $department$
declare r record;s record;t uuid;c text;keys text[]:='{}';k text;
begin
 if tg_op<>'INSERT' then keys:=array_append(keys,old.tenant_id::text||':'||old.code);end if;
 if tg_op<>'DELETE' then keys:=array_append(keys,new.tenant_id::text||':'||new.code);end if;
 for k in select distinct unnest(keys) order by 1 loop perform pg_advisory_xact_lock(hashtextextended('history-dept:'||k,0));end loop;
 for r in select distinct p.tenant_id,p.data_environment,p.record_type,p.group_key from private.finance_history_source_projection_v1 p
   where p.tenant_id::text||':'||p.department_code=any(keys) order by p.tenant_id,p.data_environment,p.record_type,p.group_key loop
  perform pg_advisory_xact_lock(hashtextextended('history-group:'||r.tenant_id::text||':'||r.data_environment||':'||r.record_type||':'||r.group_key,0));
  -- Read the affected exact source rows; this is an organization write, never a search.
  for s in execute format('select to_jsonb(x) as row from public.%I x join private.finance_history_source_projection_v1 p on p.source_id=x.id and p.tenant_id=x.tenant_id and p.data_environment=x.data_environment where p.tenant_id=$1 and p.data_environment=$2 and p.record_type=$3 and p.group_key=$4',r.record_type)
   using r.tenant_id,r.data_environment,r.record_type,r.group_key loop
   perform private.finance_history_project_source_v1(r.record_type,s.row);
  end loop;
  perform private.finance_history_refresh_group_v1(r.tenant_id,r.data_environment,r.record_type,r.group_key);
 end loop;
 return null;
end;
$department$;
create function private.finance_history_projection_truncate_trigger_v1() returns trigger
language plpgsql security definer set search_path='' as $truncate$
declare r record;
begin
 if tg_table_name='finance_department_units' then
  -- Administrative truncation still maintains the derived index atomically.
  for r in select 'expense_requests'::text table_name,to_jsonb(x) row from public.expense_requests x where tenant_id is not null and data_environment in('production','test')
   union all select 'bills',to_jsonb(x) from public.bills x where tenant_id is not null and data_environment in('production','test')
   union all select 'invoices',to_jsonb(x) from public.invoices x where tenant_id is not null and data_environment in('production','test') loop
   perform private.finance_history_project_source_v1(r.table_name,r.row);
  end loop;
  for r in select tenant_id,data_environment,record_type,group_key from private.finance_history_group_projection_v1 order by tenant_id,data_environment,record_type,group_key loop
   perform pg_advisory_xact_lock(hashtextextended('history-group:'||r.tenant_id::text||':'||r.data_environment||':'||r.record_type||':'||r.group_key,0));
   perform private.finance_history_refresh_group_v1(r.tenant_id,r.data_environment,r.record_type,r.group_key);
  end loop;
  return null;
 end if;
 delete from private.finance_history_source_projection_v1 where record_type=tg_table_name;
 delete from private.finance_history_group_projection_v1 where record_type=tg_table_name;
 return null;
end;
$truncate$;

create trigger finance_history_projection_insert_v1 after insert on public.expense_requests referencing new table as new_source for each statement execute function private.finance_history_projection_source_trigger_v1();
create trigger finance_history_projection_update_v1 after update on public.expense_requests referencing old table as old_source new table as new_source for each statement execute function private.finance_history_projection_source_trigger_v1();
create trigger finance_history_projection_delete_v1 after delete on public.expense_requests referencing old table as old_source for each statement execute function private.finance_history_projection_source_trigger_v1();
create trigger finance_history_projection_truncate_v1 after truncate on public.expense_requests for each statement execute function private.finance_history_projection_truncate_trigger_v1();

create trigger finance_history_projection_insert_v1 after insert on public.bills referencing new table as new_source for each statement execute function private.finance_history_projection_source_trigger_v1();
create trigger finance_history_projection_update_v1 after update on public.bills referencing old table as old_source new table as new_source for each statement execute function private.finance_history_projection_source_trigger_v1();
create trigger finance_history_projection_delete_v1 after delete on public.bills referencing old table as old_source for each statement execute function private.finance_history_projection_source_trigger_v1();
create trigger finance_history_projection_truncate_v1 after truncate on public.bills for each statement execute function private.finance_history_projection_truncate_trigger_v1();

create trigger finance_history_projection_insert_v1 after insert on public.invoices referencing new table as new_source for each statement execute function private.finance_history_projection_source_trigger_v1();
create trigger finance_history_projection_update_v1 after update on public.invoices referencing old table as old_source new table as new_source for each statement execute function private.finance_history_projection_source_trigger_v1();
create trigger finance_history_projection_delete_v1 after delete on public.invoices referencing old table as old_source for each statement execute function private.finance_history_projection_source_trigger_v1();
create trigger finance_history_projection_truncate_v1 after truncate on public.invoices for each statement execute function private.finance_history_projection_truncate_trigger_v1();

create trigger finance_history_projection_department_v1 after insert or delete or update of tenant_id,code,name on public.finance_department_units for each row execute function private.finance_history_projection_department_trigger_v1();
create trigger finance_history_projection_truncate_v1 after truncate on public.finance_department_units for each statement execute function private.finance_history_projection_truncate_trigger_v1();
do $backfill$
declare r record;
begin
 for r in select 'expense_requests'::text table_name,to_jsonb(x) row from public.expense_requests x where tenant_id is not null and data_environment in('production','test')
 union all select 'bills',to_jsonb(x) from public.bills x where tenant_id is not null and data_environment in('production','test')
 union all select 'invoices',to_jsonb(x) from public.invoices x where tenant_id is not null and data_environment in('production','test') loop
  perform private.finance_history_project_source_v1(r.table_name,r.row);
 end loop;
 for r in select distinct tenant_id,data_environment,record_type,group_key from private.finance_history_source_projection_v1 loop
  perform private.finance_history_refresh_group_v1(r.tenant_id,r.data_environment,r.record_type,r.group_key);
 end loop;
end;
$backfill$;

alter function private.finance_history_index_grams_v1(text) owner to postgres;
revoke all on function private.finance_history_index_grams_v1(text) from public,anon,authenticated,service_role;

alter function private.finance_history_compile_query_v1(text) owner to postgres;
revoke all on function private.finance_history_compile_query_v1(text) from public,anon,authenticated,service_role;

alter function private.finance_history_index_matches_v1(jsonb,text,text,text[]) owner to postgres;
revoke all on function private.finance_history_index_matches_v1(jsonb,text,text,text[]) from public,anon,authenticated,service_role;

alter function private.finance_history_source_business_v1(text,jsonb,text) owner to postgres;
revoke all on function private.finance_history_source_business_v1(text,jsonb,text) from public,anon,authenticated,service_role;

alter function private.finance_history_summary_number_v1(jsonb) owner to postgres;
revoke all on function private.finance_history_summary_number_v1(jsonb) from public,anon,authenticated,service_role;

alter function private.finance_history_summary_amount_v1(text,jsonb) owner to postgres;
revoke all on function private.finance_history_summary_amount_v1(text,jsonb) from public,anon,authenticated,service_role;

alter function private.finance_history_project_source_v1(text,jsonb) owner to postgres;
revoke all on function private.finance_history_project_source_v1(text,jsonb) from public,anon,authenticated,service_role;

alter function private.finance_history_refresh_group_v1(uuid,text,text,text) owner to postgres;
revoke all on function private.finance_history_refresh_group_v1(uuid,text,text,text) from public,anon,authenticated,service_role;

alter function private.finance_history_actor_v1() owner to postgres;
revoke all on function private.finance_history_actor_v1() from public,anon,authenticated,service_role;

alter function private.finance_history_groups_v1(public.finance_users,text) owner to postgres;
revoke all on function private.finance_history_groups_v1(public.finance_users,text) from public,anon,authenticated,service_role;

alter function private.finance_history_projection_source_trigger_v1() owner to postgres;
revoke all on function private.finance_history_projection_source_trigger_v1() from public,anon,authenticated,service_role;

alter function private.finance_history_projection_department_trigger_v1() owner to postgres;
revoke all on function private.finance_history_projection_department_trigger_v1() from public,anon,authenticated,service_role;

alter function private.finance_history_projection_truncate_trigger_v1() owner to postgres;
revoke all on function private.finance_history_projection_truncate_trigger_v1() from public,anon,authenticated,service_role;

alter function public.finance_approval_history_summary_v1(integer,integer,text,text) owner to postgres;
revoke all on function public.finance_approval_history_summary_v1(integer,integer,text,text) from public,anon,authenticated,service_role;
grant execute on function public.finance_approval_history_summary_v1(integer,integer,text,text) to authenticated,service_role;

alter function public.finance_approval_history_detail_v1(text,text) owner to postgres;
revoke all on function public.finance_approval_history_detail_v1(text,text) from public,anon,authenticated,service_role;
grant execute on function public.finance_approval_history_detail_v1(text,text) to authenticated,service_role;

notify pgrst,'reload schema';
