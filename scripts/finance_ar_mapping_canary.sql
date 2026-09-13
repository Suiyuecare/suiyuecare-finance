-- Read-only canonical mapper parity; no synthetic data or real employee claims.
-- The private query runs as the release operator and exposes only aggregate proof.
begin isolation level repeatable read read only;
set local lock_timeout='5s';
set local statement_timeout='60s';
-- FINANCE_AUTHENTICATED_CANARY_CORE_BEGIN
do $ar_mapping_canary$
declare t constant uuid:='00000000-0000-0000-0000-000000000001';env text;r record;denied boolean;
 d date:=(statement_timestamp() at time zone 'Asia/Taipei')::date;
begin
 if auth.uid() is not null then raise exception 'AR mapping proof must not assume an employee identity';end if;
 foreach env in array array['production','test'] loop
  execute $ar_original_compare$
with original(invoice_id,entity_id,department_code,entry_date,debit,credit,category,source_ref) as materialized (select case when x.n=1 then x.invoice_id end,l.entity_id,l.department_code,l.entry_date,
 coalesce(l.debit,0),coalesce(l.credit,0),
 case when x.lifecycle then 'allowance' when coalesce(l.posting_key,'') like '%:receipt:%' then 'receipt' else 'recognition' end,
 coalesce(nullif(l.reference_no,''),nullif(l.source_no,''),nullif(l.source_id,''),l.voucher_no)
 from public.ledger_entries l
 left join lateral (
  select count(distinct i.id) n,min(i.id) invoice_id,bool_or(e.id is not null) lifecycle
  from public.invoices i
  left join public.invoice_lifecycle_events e on e.tenant_id=i.tenant_id and e.data_environment=i.data_environment and e.invoice_id=i.id
   and (e.id=l.source_id or e.event_no=l.source_no or e.event_no=l.reference_no)
  where i.tenant_id=$1::uuid and i.data_environment=$2::text and ($4::text is null or i.id=$4::text) and i.entity_id is not distinct from l.entity_id
   and ((l.source_id=i.id and l.source_type in ('invoice','invoice_reversal'))
    or (coalesce(l.source_type,'') in ('invoice','invoice_reversal','') and nullif(l.source_id,'') is null and (i.no=l.source_no or i.no=l.reference_no))
    or (coalesce(l.source_type,'') in ('invoice','invoice_reversal') and (i.no=l.source_no or i.no=l.reference_no)
      and not exists(select 1 from public.invoices other_i where other_i.tenant_id=$1::uuid and other_i.data_environment=$2::text and other_i.id=l.source_id))
    or e.id is not null)
 ) x on true
 where l.tenant_id=$1::uuid and l.data_environment=$2::text and l.voided_at is null
  and l.account_code='1123' and l.entry_date<=$3::date), candidate as materialized (select * from private.finance_ar_ledger_v1($1::uuid,$2::text,$3::date,$4::text))
select (select count(*) from original) old_count,(select count(*) from candidate) new_count,
(select md5(coalesce(string_agg(to_jsonb(x)::text,'|' order by to_jsonb(x)::text),'')) from original x) old_hash,
(select md5(coalesce(string_agg(to_jsonb(x)::text,'|' order by to_jsonb(x)::text),'')) from candidate x) new_hash,
(select count(*) from ((select * from original except all select * from candidate) union all (select * from candidate except all select * from original)) differences) differences
$ar_original_compare$ into r using t,env,d,null::text;
  if r.old_count is distinct from r.new_count or r.old_hash is distinct from r.new_hash or r.differences<>0 then
   raise exception 'Canonical AR mapper differs from the original financial rows';end if;
 end loop;
 -- Both browser roles remain unable to invoke the privileged internal mapper.
 execute 'set local role anon';
 denied:=false;
 begin perform private.finance_ar_ledger_v1(t,'test',d);
 exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Anonymous direct mapper access accepted';end if;
 execute 'reset role';
 execute 'set local role authenticated';
 denied:=false;
 begin perform private.finance_ar_ledger_v1(t,'test',d);
 exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Browser direct mapper access accepted';end if;
 denied:=false;
 begin perform public.finance_receivables_v1(d,null,null,'test');
 exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'AR reader accepted absent verified actor';end if;
 execute 'reset role';
end;
$ar_mapping_canary$;
-- FINANCE_AUTHENTICATED_CANARY_CORE_END
rollback;
-- FINANCE_AUTHENTICATED_CANARY_ROLLBACK_CHECK_BEGIN
do $ar_mapping_rollback$
begin
 if current_user in ('anon','authenticated') or auth.uid() is not null then
  raise exception 'Read-only AR proof left a browser role or employee context';end if;
end;
$ar_mapping_rollback$;
-- FINANCE_AUTHENTICATED_CANARY_ROLLBACK_CHECK_END
select jsonb_build_object('canary','readonly_ar_mapping_v1','ok',true,'rolled_back',true,'mapping_preserved',true) as ar_mapping_canary_result;

