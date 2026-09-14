-- Search compact business values before hydrating the requested full-document page.
-- Identity, actor scope, full batch members and immutable history are preserved.
set local lock_timeout = '8s';
set local statement_timeout = '60s';

do $history_page_first_preflight$
declare p record; helper record;
begin
 select * into p from pg_proc where oid=to_regprocedure('public.finance_approval_participant_history_for_current_user(integer,integer,text,text)');
 if p.oid is null or md5(p.prosrc)<>'53f526628bded4241c3bbe61de6efcd3'
  or pg_get_userbyid(p.proowner)<>'postgres' or not p.prosecdef or p.provolatile<>'s'
  or p.proconfig is distinct from array['search_path=""']::text[]
  or not has_function_privilege('authenticated',p.oid,'EXECUTE') or not has_function_privilege('service_role',p.oid,'EXECUTE')
  or has_function_privilege('anon',p.oid,'EXECUTE')
  or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE') then
  raise exception 'History page-first baseline or authority changed; refusing overwrite';
 end if;
 for helper in select * from (values
  ('private.finance_history_search_text_v1(text)','1eb1ef6c6f8cff67b658419d915f4902'),
  ('private.finance_history_document_search_v1(text,text,jsonb)','5da309be87536901cae62266e7ef8ad0')
 ) expected(signature,source_hash) loop
  select * into p from pg_proc where oid=to_regprocedure(helper.signature);
  if p.oid is null or md5(p.prosrc)<>helper.source_hash or p.prosecdef or p.provolatile<>'i'
   or pg_get_userbyid(p.proowner)<>'postgres' or p.proconfig is distinct from array['search_path=""']::text[]
   or has_function_privilege('anon',p.oid,'execute') or has_function_privilege('authenticated',p.oid,'execute')
   or has_function_privilege('service_role',p.oid,'execute') then
   raise exception 'History search helper baseline or authority changed: %',helper.signature;
  end if;
 end loop;
end;
$history_page_first_preflight$;


-- Pure transient projection: filenames and business values are searchable;
-- storage URLs, binary contents and internal security metadata are not.
create function private.finance_history_search_fields_v1(p_row jsonb)
returns jsonb language sql immutable set search_path='' as $fields$
 with recursive containers(value, depth) as (
  select p_row,0
  union all
  select child.value,c.depth+1 from containers c
  cross join lateral (
   select key,value from jsonb_each(case when jsonb_typeof(c.value)='object' then c.value else '{}'::jsonb end)
   union all
   select '',value from jsonb_array_elements(case when jsonb_typeof(c.value)='array' then c.value else '[]'::jsonb end)
  ) child
  where c.depth<12 and jsonb_typeof(child.value) in ('object','array')
   and child.key !~* '(metadata|auth|token|secret|credential|password|storage|binary|base64|raw|manualOverrideHistory|revenue_rule_snapshot|steps)'
 ), leaves as (
  select leaf.key as field_key,leaf.value from containers c
  cross join lateral jsonb_each(case when jsonb_typeof(c.value)='object' then c.value else '{}'::jsonb end) leaf
  where jsonb_typeof(leaf.value) in ('string','number')
   and leaf.key !~* '(url|uri|path|storage|bucket|token|secret|auth|base64|digest|hash|etag|nonce|signature|signed|blob|binary|raw|metadata|password|credential|session|cookie|file.?data|file.?content|attachment.?data|attachment.?content)'
   and (c.depth<2 or leaf.key=any(array['id','no','item','itemName','item_name','description','reason','note','memo','name','label','n','file','fileName','filename','requestPurpose','requestNote','purpose','payeeName','summary','project','outcome','shareholderName','transactionType','account','accountName','debitAccount','creditAccount','debitAccountName','creditAccountName','amount','amt','total','gross','net','tax','price','unitPrice','taxAmount','grossAmount','netAmount','untaxedAmount','姓名','備註','部門名稱','部門代碼','金額','匯款金額','給付總額','扣繳稅額','補充保費','轉帳費用','轉帳金額']))
 ), business_values as (
  select * from leaves where jsonb_typeof(value)='string'
    and (value#>>'{}') !~* '^(data:|https?://)'
  union all
  select * from leaves where jsonb_typeof(value)='number'
    and field_key ~* '(amount|amt|total|gross|net|tax|price|fee|金額|總額|稅額|保費|費用)'
 )
 select jsonb_build_object(
  'text',coalesce(string_agg(value#>>'{}',' ') filter(where jsonb_typeof(value)='string'),''),
  'amounts',coalesce(jsonb_agg(value) filter(where jsonb_typeof(value)='number'),'[]'::jsonb)
 ) from business_values;
$fields$;
alter function private.finance_history_search_fields_v1(jsonb) owner to postgres;
revoke all on function private.finance_history_search_fields_v1(jsonb) from public,anon,authenticated,service_role;

-- Keep existing currency semantics, skipping the thousands scan when unused.
create or replace function private.finance_history_search_text_v1(p_value text) returns text
language plpgsql immutable set search_path='' as $search$
declare s text; m text[];
begin
 s:=lower(normalize(coalesce(p_value,''),NFKC));
 s:=btrim(regexp_replace(replace(s,'−','-'),'[[:space:]]+',' ','g'));
 s:=regexp_replace(s,'(?:nt\$|ntd|twd|新臺幣|新台幣|\$)\s*([+-]?\d[\d,]*(?:\.\d+)?)','\1','g');
 s:=regexp_replace(s,'(\d)\s*元','\1','g');
 -- A comma-free value cannot contain thousands groups.
 if position(',' in s)>0 then
 for m in select regexp_matches(s,'(^|[^\d,])([+-]?\d{1,3}(?:,\d{3})+)(?![\d,])','g') loop
  s:=replace(s,m[1]||m[2],m[1]||replace(m[2],',',''));
 end loop;
 end if;
 return s;
end;
$search$;

-- Parse money only when a numeric token actually needs it. Chinese/text
-- searches must not normalize every monetary value in the entire batch.
create or replace function private.finance_history_document_search_v1(p_query text,p_text text,p_amounts jsonb) returns boolean
language plpgsql immutable set search_path='' as $search$
declare word text;term text;candidate text;haystack text;plain_text text;amounts text[];matched boolean;amounts_ready boolean:=false;
begin
 for word in select value from regexp_split_to_table(private.finance_history_search_text_v1(p_query),' ') value where value<>'' loop
  term:=private.finance_history_amount_text_v1(word);
  -- Monetary values are already typed. Check them before scanning long text.
  if term is not null then
   if not amounts_ready then
    select array_agg(case when jsonb_typeof(value)='number' then trim_scale((value#>>'{}')::numeric)::text
      else private.finance_history_amount_text_v1(value#>>'{}') end) into amounts
    from jsonb_array_elements(case when jsonb_typeof(p_amounts)='array' then p_amounts else '[]'::jsonb end)
    where jsonb_typeof(value) in ('number','string');
    amounts_ready:=true;
   end if;
   matched:=false;
   foreach candidate in array coalesce(amounts,'{}'::text[]) loop
    if candidate is not null and (case when position('.' in word)>0 then candidate=term else position(term in candidate)>0 end) then matched:=true;exit;end if;
   end loop;
   if matched then continue;end if;
  elsif word ~ '^[a-z一-龥]+$' and word !~ '[ntwd新臺台幣元]' then
   -- Currency rewriting cannot create/remove these literal words. This path
   -- covers Chinese purposes/names without normalizing thousands of amounts.
   if plain_text is null then plain_text:=lower(normalize(coalesce(p_text,''),NFKC));end if;
   if position(word in plain_text)>0 then continue;else return false;end if;
  end if;
  if haystack is null then haystack:=private.finance_history_search_text_v1(p_text);end if;
  if term is not null and position('.' in word)>0 then
   if haystack ~ ('(^|[^\d.+-])'||replace(replace(word,'.','\.'),'+','\+')||'(?![\d.])') then continue;end if;
  elsif position(word in haystack)>0 then continue;
  end if;
  return false;
 end loop;
 return true;
end;
$search$;

create or replace function public.finance_approval_participant_history_for_current_user(
  p_limit integer default 50,
  p_offset integer default 0,
  p_search text default null,
  p_data_environment text default 'production'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_auth_user_id uuid := auth.uid();
  v_verified_email text;
  v_user public.finance_users%rowtype;
  v_member_count integer;
  v_limit integer := coalesce(p_limit, 50);
  v_offset integer := coalesce(p_offset, 0);
  v_search text := lower(btrim(coalesce(p_search, '')));
  v_environment text := lower(btrim(coalesce(p_data_environment, 'production')));
  v_payload jsonb;
begin
  if v_auth_user_id is null then
    raise exception 'Authentication is required for approval history'
      using errcode = '42501';
  end if;

  if v_limit < 1 or v_limit > 50 then
    raise exception 'History limit must be between 1 and 50'
      using errcode = '22023';
  end if;
  if v_offset < 0 then
    raise exception 'History offset must be zero or greater'
      using errcode = '22023';
  end if;
  if v_environment not in ('production', 'test') then
    raise exception 'Unsupported data environment'
      using errcode = '22023';
  end if;
  if length(v_search) > 120 then
    raise exception 'History search is too long'
      using errcode = '22023';
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
        snapshot.acted_by_user_id in (v_user.id, v_auth_user_id::text)
        or snapshot.raw_actor_user_id in (v_user.id, v_auth_user_id::text)
        or lower(btrim(coalesce(snapshot.raw_actor_email, ''))) = lower(btrim(v_user.email))
      ) as personally_acted
    from public.approval_step_actor_snapshots snapshot
    where snapshot.tenant_id = v_user.tenant_id
      and snapshot.data_environment = v_environment
      and snapshot.record_type in ('expense_requests', 'bills', 'invoices')
      and (
        snapshot.resolved_user_id = v_user.id
        or snapshot.acted_by_user_id in (v_user.id, v_auth_user_id::text)
        or snapshot.raw_actor_user_id in (v_user.id, v_auth_user_id::text)
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
  ),
  -- Project only searchable document values. Full rows (including audit,
  -- security metadata and attachment storage details) are hydrated after paging.
  department_names as materialized (
    select u.code,string_agg(u.name,' ' order by u.name) as department_name
    from public.finance_department_units u
    where v_search<>'' and u.tenant_id=v_user.tenant_id
    group by u.code
  ),
  search_sources as materialized (
    select
      group_row.kind,
      group_row.record_type,
      group_row.group_key,
      request_row.id as source_id,
      request_row.no as source_no,
      jsonb_build_object(
        'id',request_row.id,'no',request_row.no,'entity_id',request_row.entity_id,
        'department_code',request_row.department_code,'applicant',request_row.applicant,'status',request_row.status,
        'amount',request_row.amount,'created_at',request_row.created_at,'type',request_row.type,
        'type_label',request_row.type_label,'description',request_row.description,'request_date',request_row.request_date,
        'expected_pay_date',request_row.expected_pay_date,'estimated_amount',request_row.estimated_amount,'actual_amount',request_row.actual_amount,
        'bank_fee_amount',request_row.bank_fee_amount,'debit_account',request_row.debit_account,'debit_account_name',request_row.debit_account_name,
        'credit_account',request_row.credit_account,'credit_account_name',request_row.credit_account_name,'payee',request_row.payee,
        'fee_bearer',request_row.fee_bearer,'petty_mode',request_row.petty_mode,'department_name',department.department_name,
        'status_label',case request_row.status when 'completed' then '已完成' when 'rejected' then '被駁回' when 'cancelled' then '已抽單取消' when 'pending_section_chief' then '待上一層主管' when 'pending_dept_manager' then '待申請人部門主任' when 'pending_admin_director' then '待行政部門主任' when 'pending_procurement' then '待總務採購審核' when 'pending_hr' then '待人資' when 'pending_accountant' then '待會計' when 'pending_ceo' then '待執行長檢視科目' when 'pending_cashier' then '待出納放款' when 'pending_applicant_confirm' then '待申請人確認' when 'pending_voucher' then '待會計入帳' when 'pending_countersign' then '待指定員工加簽' else '' end,'files',(select coalesce(jsonb_agg(jsonb_build_object('n',f->'n','name',f->'name','fileName',f->'fileName','filename',f->'filename')),'[]'::jsonb) from jsonb_array_elements(case when jsonb_typeof(request_row.files)='array' then request_row.files else '[]'::jsonb end) f where jsonb_typeof(f)='object'),'actual_files',(select coalesce(jsonb_agg(jsonb_build_object('n',f->'n','name',f->'name','fileName',f->'fileName','filename',f->'filename')),'[]'::jsonb) from jsonb_array_elements(case when jsonb_typeof(request_row.actual_files)='array' then request_row.actual_files else '[]'::jsonb end) f where jsonb_typeof(f)='object'),
        'form_payload',(select coalesce(jsonb_object_agg(e.key,case when e.key=any(array['attachments','files','actualFiles','passbookFiles'])
            then (select coalesce(jsonb_agg(jsonb_build_object('n',f->'n','name',f->'name','fileName',f->'fileName','filename',f->'filename')),'[]'::jsonb) from jsonb_array_elements(case when jsonb_typeof(e.value)='array' then e.value else '[]'::jsonb end) f where jsonb_typeof(f)='object') else e.value end),'{}'::jsonb)
          from jsonb_each(case when jsonb_typeof(request_row.form_payload)='object' then request_row.form_payload else '{}'::jsonb end) e
          where e.key=any(array['requestPurpose','requestNote','description','reason','note','memo','purpose','summary','project','outcome','item','itemName','item_name','payeeName','shareholderName','transactionType','amount','amt','total','gross','net','tax','price','unitPrice','taxAmount','grossAmount','netAmount','untaxedAmount','receiptType','paymentType','hrItem','pettyMode','accountingLines','lazyRows','refundRows','purchaseRows','hrRows','travelInfo','refundInfo','purchaseInfo','hrInfo','shareholderTxn','shareholderAccounting','rows','nested','ordinaryNested','attachments','files','actualFiles','passbookFiles']))
      ) as source_row
    from group_keys group_row
    join public.expense_requests request_row
      on v_search <> '' and group_row.record_type = 'expense_requests'
     and request_row.tenant_id = v_user.tenant_id
     and request_row.data_environment = v_environment
     and request_row.id = group_row.representative_id
    left join department_names department on department.code=request_row.department_code

    union all

    select
      group_row.kind,
      group_row.record_type,
      group_row.group_key,
      bill_row.id,
      coalesce(bill_row.no, bill_row.id),
      jsonb_build_object(
        'id',bill_row.id,'no',bill_row.no,'entity_id',bill_row.entity_id,
        'department_code',bill_row.department_code,'applicant',bill_row.applicant,'status',bill_row.status,
        'amount',bill_row.amount,'created_at',bill_row.created_at,'entity_name',bill_row.entity_name,
        'batch_id',bill_row.batch_id,'item',bill_row.item,'payer_name',bill_row.payer_name,
        'note',bill_row.note,'approval_status',bill_row.approval_status,'service_period',bill_row.service_period,
        'method',bill_row.method,'due_date',bill_row.due_date,'paid_at',bill_row.paid_at,
        'invoice_followup_status',bill_row.invoice_followup_status,'invoice_followup_note',bill_row.invoice_followup_note,'department_name',department.department_name
      )
    from group_keys group_row
    join public.bills bill_row
      on v_search <> '' and group_row.record_type = 'bills'
     and bill_row.tenant_id = v_user.tenant_id
     and bill_row.data_environment = v_environment
     and group_row.batch_id <> ''
     and nullif(btrim(bill_row.batch_id), '') = group_row.batch_id
    left join department_names department on department.code=bill_row.department_code

    union all

    select
      group_row.kind,
      group_row.record_type,
      group_row.group_key,
      bill_row.id,
      coalesce(bill_row.no, bill_row.id),
      jsonb_build_object(
        'id',bill_row.id,'no',bill_row.no,'entity_id',bill_row.entity_id,
        'department_code',bill_row.department_code,'applicant',bill_row.applicant,'status',bill_row.status,
        'amount',bill_row.amount,'created_at',bill_row.created_at,'entity_name',bill_row.entity_name,
        'batch_id',bill_row.batch_id,'item',bill_row.item,'payer_name',bill_row.payer_name,
        'note',bill_row.note,'approval_status',bill_row.approval_status,'service_period',bill_row.service_period,
        'method',bill_row.method,'due_date',bill_row.due_date,'paid_at',bill_row.paid_at,
        'invoice_followup_status',bill_row.invoice_followup_status,'invoice_followup_note',bill_row.invoice_followup_note,'department_name',department.department_name
      )
    from group_keys group_row
    join public.bills bill_row
      on v_search <> '' and group_row.record_type = 'bills'
     and bill_row.tenant_id = v_user.tenant_id
     and bill_row.data_environment = v_environment
     and group_row.batch_id = ''
     and bill_row.id = group_row.representative_id
    left join department_names department on department.code=bill_row.department_code

    union all

    select
      group_row.kind,
      group_row.record_type,
      group_row.group_key,
      invoice_row.id,
      coalesce(invoice_row.no, invoice_row.id),
      jsonb_build_object(
        'id',invoice_row.id,'no',invoice_row.no,'entity_id',invoice_row.entity_id,
        'department_code',invoice_row.department_code,'applicant',invoice_row.applicant,'status',invoice_row.status,
        'amount',invoice_row.amount,'created_at',invoice_row.created_at,'entity_name',invoice_row.entity_name,
        'batch_id',invoice_row.batch_id,'buyer',invoice_row.buyer,'description',invoice_row.description,
        'tax',invoice_row.tax,'total',invoice_row.total,'invoice_date',invoice_row.invoice_date,
        'paid_at',invoice_row.paid_at,'approval_status',invoice_row.approval_status,'invoice_identifier_type',invoice_row.invoice_identifier_type,
        'invoice_item_type',invoice_row.invoice_item_type,'payer_type',invoice_row.payer_type,'funding_source',invoice_row.funding_source,
        'service_period',invoice_row.service_period,'contract_no',invoice_row.contract_no,'revenue_account_code',invoice_row.revenue_account_code,
        'revenue_account_name',invoice_row.revenue_account_name,'receipt_note',invoice_row.receipt_note,'department_name',department.department_name,
        'receipt_files',(select coalesce(jsonb_agg(jsonb_build_object('n',f->'n','name',f->'name','fileName',f->'fileName','filename',f->'filename')),'[]'::jsonb) from jsonb_array_elements(case when jsonb_typeof(invoice_row.receipt_files)='array' then invoice_row.receipt_files else '[]'::jsonb end) f where jsonb_typeof(f)='object')
      )
    from group_keys group_row
    join public.invoices invoice_row
      on v_search <> '' and group_row.record_type = 'invoices'
     and invoice_row.tenant_id = v_user.tenant_id
     and invoice_row.data_environment = v_environment
     and group_row.batch_id <> ''
     and nullif(btrim(invoice_row.batch_id), '') = group_row.batch_id
    left join department_names department on department.code=invoice_row.department_code

    union all

    select
      group_row.kind,
      group_row.record_type,
      group_row.group_key,
      invoice_row.id,
      coalesce(invoice_row.no, invoice_row.id),
      jsonb_build_object(
        'id',invoice_row.id,'no',invoice_row.no,'entity_id',invoice_row.entity_id,
        'department_code',invoice_row.department_code,'applicant',invoice_row.applicant,'status',invoice_row.status,
        'amount',invoice_row.amount,'created_at',invoice_row.created_at,'entity_name',invoice_row.entity_name,
        'batch_id',invoice_row.batch_id,'buyer',invoice_row.buyer,'description',invoice_row.description,
        'tax',invoice_row.tax,'total',invoice_row.total,'invoice_date',invoice_row.invoice_date,
        'paid_at',invoice_row.paid_at,'approval_status',invoice_row.approval_status,'invoice_identifier_type',invoice_row.invoice_identifier_type,
        'invoice_item_type',invoice_row.invoice_item_type,'payer_type',invoice_row.payer_type,'funding_source',invoice_row.funding_source,
        'service_period',invoice_row.service_period,'contract_no',invoice_row.contract_no,'revenue_account_code',invoice_row.revenue_account_code,
        'revenue_account_name',invoice_row.revenue_account_name,'receipt_note',invoice_row.receipt_note,'department_name',department.department_name,
        'receipt_files',(select coalesce(jsonb_agg(jsonb_build_object('n',f->'n','name',f->'name','fileName',f->'fileName','filename',f->'filename')),'[]'::jsonb) from jsonb_array_elements(case when jsonb_typeof(invoice_row.receipt_files)='array' then invoice_row.receipt_files else '[]'::jsonb end) f where jsonb_typeof(f)='object')
      )
    from group_keys group_row
    join public.invoices invoice_row
      on v_search <> '' and group_row.record_type = 'invoices'
     and invoice_row.tenant_id = v_user.tenant_id
     and invoice_row.data_environment = v_environment
     and group_row.batch_id = ''
     and invoice_row.id = group_row.representative_id
    left join department_names department on department.code=invoice_row.department_code
  ),
  -- A necessary-condition group filter runs before recursive field projection.
  -- Alphabetic/Han tokens cannot be changed by JSON escaping. Canonical money
  -- uses a signless substring, so '-00012.50' is retained for '-12.5'; commas
  -- are removed over-inclusively and the actual batch sum is included below.
  -- Other tokens bypass this filter; the original matcher remains authoritative
  -- for signs, decimals, currency formatting, field scope and final inclusion.
  search_plain_terms as materialized (
    select distinct case when token ~ '^[a-z一-龥]+$' then token
      else ltrim(canonical_amount,'-') end as token
    from (
      select token,private.finance_history_amount_text_v1(token) as canonical_amount
      from regexp_split_to_table(private.finance_history_search_text_v1(v_search),' ') token
    ) words
    where token ~ '^[a-z一-龥]+$' or canonical_amount is not null
  ),
  search_coarse_groups as materialized (
    select s.kind,s.record_type,s.group_key,
      replace(replace(lower(normalize(string_agg(s.source_row::text,' '),NFKC)),'−','-'),',','')
        ||' '||coalesce(sum(case when s.kind='inv'
          then coalesce((s.source_row->>'total')::numeric,(s.source_row->>'amount')::numeric)
          else (s.source_row->>'amount')::numeric end)::text,'') as coarse_text
    from search_sources s
    where exists(select 1 from search_plain_terms)
    group by s.kind,s.record_type,s.group_key
  ),
  search_candidate_keys as materialized (
    select kind,record_type,group_key from group_keys
    where not exists(select 1 from search_plain_terms)
    union all
    select c.kind,c.record_type,c.group_key from search_coarse_groups c
    where not exists(select 1 from search_plain_terms t where position(t.token in c.coarse_text)=0)
  ),
  search_fields as materialized (
    select s.kind,s.record_type,s.group_key,s.source_id,s.source_no,
      private.finance_history_search_fields_v1(s.source_row) as fields,
      case when s.kind='inv' then coalesce((s.source_row->>'total')::numeric,(s.source_row->>'amount')::numeric)
        else (s.source_row->>'amount')::numeric end as amount
    from search_sources s
    join search_candidate_keys candidate using(kind,record_type,group_key)
  ),
  search_groups as materialized (
    select kind,record_type,group_key,
      string_agg(fields->>'text',' ' order by source_no,source_id) as searchable_text,
      jsonb_path_query_array(jsonb_agg(fields->'amounts'),'$[*][*]') as amounts,
      sum(amount) as group_amount
    from search_fields group by kind,record_type,group_key
  ),
  filtered_keys as materialized (
    select * from group_keys where v_search=''
    union all
    select g.* from group_keys g join search_groups s using(kind,record_type,group_key)
    where v_search<>'' and private.finance_history_document_search_v1(v_search,
      coalesce(g.record_no,'')||' '||s.searchable_text,s.amounts||jsonb_build_array(group_amount))
  ),
  candidate_groups as materialized (
    select * from filtered_keys
    order by last_participated_at desc,record_type,record_no,group_key
    limit v_limit offset v_offset
  ),
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
     and request_row.tenant_id = v_user.tenant_id
     and request_row.data_environment = v_environment
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
     and bill_row.tenant_id = v_user.tenant_id
     and bill_row.data_environment = v_environment
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
     and bill_row.tenant_id = v_user.tenant_id
     and bill_row.data_environment = v_environment
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
     and invoice_row.tenant_id = v_user.tenant_id
     and invoice_row.data_environment = v_environment
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
     and invoice_row.tenant_id = v_user.tenant_id
     and invoice_row.data_environment = v_environment
     and group_row.batch_id = ''
     and invoice_row.id = group_row.representative_id
  ),
  grouped as (
    select
      group_row.kind,
      group_row.record_type,
      group_row.group_key,
      group_row.representative_id,
      group_row.batch_id,
      group_row.record_no,
      group_row.last_participated_at,
      group_row.personally_acted,
      jsonb_agg(source.source_row order by source.source_no, source.source_id) as source_rows
    from candidate_groups group_row
    join source_records source
      on source.kind = group_row.kind
     and source.record_type = group_row.record_type
     and source.group_key = group_row.group_key
    group by
      group_row.kind,
      group_row.record_type,
      group_row.group_key,
      group_row.representative_id,
      group_row.batch_id,
      group_row.record_no,
      group_row.last_participated_at,
      group_row.personally_acted
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
  ),
  paged as (
    select * from grouped
  )
  select jsonb_build_object(
    'ok', true,
    'identity', jsonb_build_object(
      'tenant_id', v_user.tenant_id,
      'finance_user_id', v_user.id,
      'auth_user_id', v_auth_user_id,
      'email', v_user.email,
      'data_environment', v_environment
    ),
    'all_total', (select count(*) from group_keys),
    'total', (select count(*) from filtered_keys),
    'page', jsonb_build_object(
      'limit', v_limit,
      'offset', v_offset,
      'has_more', v_offset + v_limit < (select count(*) from filtered_keys)
    ),
    'items', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'history_key', page_row.record_type || ':' || page_row.group_key,
          'kind', page_row.kind,
          'record_type', page_row.record_type,
          'record_id', page_row.representative_id,
          'record_no', page_row.record_no,
          'batch_id', page_row.batch_id,
          'last_participated_at', page_row.last_participated_at,
          'personally_acted', page_row.personally_acted,
          'participation_label', case when page_row.personally_acted then '本人已處理' else '曾列入流程' end,
          'participant_steps', coalesce(participant_group.steps, '[]'::jsonb),
          'source_row', page_row.source_rows -> 0,
          'source_rows', page_row.source_rows
        )
        order by page_row.last_participated_at desc, page_row.record_type, page_row.record_no, page_row.group_key
      )
      from paged page_row
      left join participant_groups participant_group
        on participant_group.kind = page_row.kind
       and participant_group.group_key = page_row.group_key
    ), '[]'::jsonb)
  )
  into v_payload;

  return v_payload;
end
$function$;

notify pgrst, 'reload schema';
