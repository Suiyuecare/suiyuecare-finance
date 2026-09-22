-- AUTH-01/02/03 and ORG-01: identity precedence, parent-scoped attachments,
-- and appointment-specific approval capability. No operational rows are changed.
do $preflight$
declare r record; p record;
begin
 for r in select * from (values
  ('private.finance_claim_attachment_metadata_v2()','eb4b26ea5e72f766c53ffd03e97ae325',true),
  ('private.finance_membership_org_departments_v1(uuid,jsonb)','717a04b8c8df8229ca19942ccb9587a5',true),
  ('public.can_read_bill(bills)','d3edce0bf795e39536362a2637b20568',false),
  ('public.can_read_expense_request(expense_requests)','5697a0a0f61f6832176680b67fa39084',false),
  ('public.can_read_finance_attachment(file_attachments)','275203331d2c70000a4cf930371ef49b',false),
  ('public.can_read_invoice(invoices)','d761ec0bbd1544410ae52bd860ec78b6',false),
  ('public.can_update_expense_request(expense_requests)','8cb0219a3184c025cf2cf46d3bd25e23',false),
  ('public.can_update_invoice(invoices)','fa132a77bd4f0220279d56d9452d6297',false),
  ('public.is_bill_owner(bills)','954ae726cc6dc32b6795ad778f35ec37',false),
  ('public.json_steps_include_current_user(jsonb)','0ead7350fbf4cad04b46f33374f05ef1',false),
  ('public.json_steps_role_matches(jsonb)','7df078bc30330ef9888a69dd11a53328',false)
 ) v(signature,body_md5,definer) loop
  select * into p from pg_catalog.pg_proc where oid=pg_catalog.to_regprocedure(r.signature);
  if p.oid is null or md5(p.prosrc)<>r.body_md5 or p.prosecdef<>r.definer then
   raise exception 'Finance document authority drift: %',r.signature;
  end if;
 end loop;
 if has_any_column_privilege('authenticated','public.file_attachments','update')
  or exists(select 1 from pg_policy where polrelid='public.file_attachments'::regclass and polcmd in ('w','*'))
  or not exists(select 1 from pg_proc where oid='public.finance_can_insert_attachment_metadata_v2(public.file_attachments)'::regprocedure and md5(prosrc)='9d1fbc21a10716eab5c57fae872876f9' and prosecdef) then
  raise exception 'Trusted claimed attachment binding is not immutable to browser';
 end if;
 if not exists(select 1 from pg_catalog.pg_policy where polrelid='public.file_attachments'::regclass and polname='hr_salary_attachment_scope' and not polpermissive) then
  raise exception 'HR restrictive attachment policy is required';
 end if;
end $preflight$;

-- Only a boolean about the authenticated caller is exposed. The definer lookup
-- includes inactive namesakes so RLS or offboarding cannot make an ambiguous
-- historical display name appear unique. Stable identities never use this path.
create function public.finance_legacy_name_matches_current_v1(p_names text[])
returns boolean language sql stable security definer set search_path='' as $function$
 select coalesce(
  nullif(public.current_finance_user_id(),'') is not null
  and nullif(public.finance_current_verified_google_email_v2(),'') is not null
  and exists(select 1 from public.finance_users f
    where f.tenant_id=public.current_tenant_id()
      and f.id=public.current_finance_user_id() and f.active=true
      and nullif(btrim(f.name),'')=any(p_names)
      and not exists(select 1 from public.finance_users other
        where other.tenant_id=f.tenant_id and other.id<>f.id
          and btrim(other.name)=btrim(f.name))),false)
$function$;

create function public.finance_identity_matches_current_v1(p_ids text[],p_emails text[],p_names text[])
returns boolean language sql stable security invoker set search_path='' as $function$
 with identifiers as (
  select array(select btrim(v) from unnest(p_ids) v where nullif(btrim(v),'') is not null) ids,
    array(select lower(btrim(v)) from unnest(p_emails) v where nullif(btrim(v),'') is not null) emails,
    array(select btrim(v) from unnest(p_names) v where nullif(btrim(v),'') is not null) names
 )
 select coalesce(nullif(public.current_finance_user_id(),'') is not null
  and nullif(public.finance_current_verified_google_email_v2(),'') is not null
  and case when cardinality(ids)>0 then public.current_finance_user_id()=any(ids)
    when cardinality(emails)>0 then public.finance_current_verified_google_email_v2()=any(emails)
    else public.finance_legacy_name_matches_current_v1(names) end,false)
 from identifiers
$function$;
revoke all on function public.finance_legacy_name_matches_current_v1(text[]),public.finance_identity_matches_current_v1(text[],text[],text[]) from public,anon,service_role;
grant execute on function public.finance_legacy_name_matches_current_v1(text[]),public.finance_identity_matches_current_v1(text[],text[],text[]) to authenticated;

create or replace function public.json_steps_include_current_user(steps jsonb)
returns boolean language sql stable set search_path='' as $function$
 with step_rows as (
  select value as step from jsonb_array_elements(case when jsonb_typeof(steps)='array' then steps else '[]'::jsonb end)
 ), participants as (
  select step as participant from step_rows
  union all
  -- Legacy completed steps may record the actual actor separately from the
  -- assigned uid. Never interpret pending assignee labels as performed actions.
  select jsonb_build_object(
    'actorId',step->'actorId','actor_id',step->'actor_id',
    'actorFinanceUserId',step->'actorFinanceUserId','actor_finance_user_id',step->'actor_finance_user_id',
    'byId',step->'byId','by_id',step->'by_id',
    'actorEmail',step->'actorEmail','actor_email',step->'actor_email',
    'byEmail',step->'byEmail','by_email',step->'by_email',
    'actor',step->'actor','actorName',step->'actorName','actor_name',step->'actor_name','by',step->'by')
  from step_rows where lower(coalesce(step->>'a',step->>'status','')) in ('approved','completed','rejected','returned','confirmed')
  union all
  select value from step_rows cross join lateral jsonb_array_elements(
   (case when jsonb_typeof(step->'actionLog')='array' then step->'actionLog' else '[]'::jsonb end)
   ||(case when jsonb_typeof(step->'action_log')='array' then step->'action_log' else '[]'::jsonb end)
   ||(case when jsonb_typeof(step->'actions')='array' then step->'actions' else '[]'::jsonb end))
 )
 select exists(select 1 from participants where public.finance_identity_matches_current_v1(
  array[participant->>'uid', participant->>'userId', participant->>'user_id', participant->>'approverId', participant->>'approver_id', participant->>'actorId', participant->>'actor_id', participant->>'actorFinanceUserId', participant->>'actor_finance_user_id', participant->>'financeUserId', participant->>'finance_user_id', participant->>'byId', participant->>'by_id'],
  array[participant->>'email', participant->>'userEmail', participant->>'user_email', participant->>'approverEmail', participant->>'approver_email', participant->>'actorEmail', participant->>'actor_email', participant->>'byEmail', participant->>'by_email'],
  array[participant->>'n', participant->>'name', participant->>'approver', participant->>'approverName', participant->>'approver_name', participant->>'actor', participant->>'actorName', participant->>'actor_name', participant->>'by', participant->>'reviewer', participant->>'reviewerName', participant->>'reviewer_name']))
$function$;

create or replace function public.json_steps_role_matches(steps jsonb)
returns boolean language sql stable set search_path='' as $function$
 select coalesce(nullif(public.current_finance_user_id(),'') is not null
  and nullif(public.finance_current_verified_google_email_v2(),'') is not null
  and exists(select 1 from jsonb_array_elements(case when jsonb_typeof(steps)='array' then steps else '[]'::jsonb end) s
   where public.current_finance_role()=any(array[s->>'rk', s->>'role', s->>'approver_role', s->>'approverRole', s->>'role_key', s->>'roleKey', s->>'key'])
    -- An individually assigned step is never a shared role queue.
    and not exists(select 1 from unnest(array[s->>'uid', s->>'userId', s->>'user_id', s->>'approverId', s->>'approver_id', s->>'actorId', s->>'actor_id', s->>'actorFinanceUserId', s->>'actor_finance_user_id', s->>'financeUserId', s->>'finance_user_id', s->>'byId', s->>'by_id', s->>'email', s->>'userEmail', s->>'user_email', s->>'approverEmail', s->>'approver_email', s->>'actorEmail', s->>'actor_email', s->>'byEmail', s->>'by_email', s->>'n', s->>'name', s->>'approver', s->>'approverName', s->>'approver_name', s->>'actor', s->>'actorName', s->>'actor_name', s->>'by', s->>'reviewer', s->>'reviewerName', s->>'reviewer_name']) identity_value
      where nullif(btrim(identity_value),'') is not null)),false)
$function$;

-- A role queue is local to the current department and legal entity. Global
-- accounting / procurement / HR business permissions remain in the parent guards.
create function public.finance_role_queue_scope_v1(p_department text,p_entity text)
returns boolean language sql stable security invoker set search_path='' as $function$
 select coalesce(nullif(p_department,'')=public.current_finance_department()
  and nullif(p_entity,'')=(public.current_finance_user()).entity_id,false)
$function$;
revoke all on function public.finance_role_queue_scope_v1(text,text) from public,anon,service_role;
grant execute on function public.finance_role_queue_scope_v1(text,text) to authenticated;

-- Extract exact references only for the one-time historical link snapshot.
-- Display names, URL
-- substrings and basename guesses are deliberately excluded.
create function public.finance_attachment_paths_v1(p_documents jsonb[])
returns text[] language sql immutable security invoker set search_path='' as $function$
 select coalesce(array_agg(distinct path order by path),'{}'::text[]) from (
  select value #>> '{}' path from unnest(p_documents) d
  cross join lateral (
   select value from jsonb_path_query(d,'$.**.path') q(value)
   union all select value from jsonb_path_query(d,'$.**.storagePath') q(value)
   union all select value from jsonb_path_query(d,'$.**.storage_path') q(value)
  ) paths where jsonb_typeof(value)='string' and nullif(value #>> '{}','') is not null
 ) exact_paths
$function$;
revoke all on function public.finance_attachment_paths_v1(jsonb[]) from public,anon;
grant execute on function public.finance_attachment_paths_v1(jsonb[]) to authenticated,service_role;
-- The existing claim trigger stores the display batch number from bill.note.
create function public.finance_bill_attachment_batch_no_v1(p_note text)
returns text language plpgsql immutable security invoker set search_path='' as $function$
declare n jsonb;begin
 begin n:=nullif(p_note,'')::jsonb;exception when invalid_text_representation then return null;end;
 return coalesce(nullif(n->>'batchNo',''),nullif(n->>'batch_no',''));
end
$function$;
revoke all on function public.finance_bill_attachment_batch_no_v1(text) from public,anon,service_role;
grant execute on function public.finance_bill_attachment_batch_no_v1(text) to authenticated;

-- Capture only reviewed historical associations once. Subsequent applicant JSON
-- edits cannot add authorization links. Invoice references shared by many rows
-- are accepted only when all rows belong to one canonical batch.
create table private.finance_legacy_attachment_links_v1(
 attachment_id uuid not null,tenant_id uuid not null,data_environment text not null,
 record_type text not null check(record_type in('expense_requests','invoices','bills','vouchers')),
 original_record_no text not null,storage_path text not null,
 parent_kind text not null check(parent_kind='id'),parent_key text not null,
 source_reference_count integer not null check(source_reference_count>0),
 source_scope jsonb not null,source_fingerprint text not null,captured_at timestamptz not null default now(),
 primary key(attachment_id,parent_key)
);
create index finance_attachment_source_identity_lookup_v1 on private.finance_legacy_attachment_links_v1(record_type,parent_key);
alter table private.finance_legacy_attachment_links_v1 enable row level security;
alter table private.finance_legacy_attachment_links_v1 force row level security;
revoke all on private.finance_legacy_attachment_links_v1 from public,anon,authenticated,service_role;
create function private.finance_legacy_attachment_links_immutable_v1()
returns trigger language plpgsql security invoker set search_path='' as $function$
begin raise exception 'Historical attachment associations are immutable' using errcode='42501';end
$function$;
revoke all on function private.finance_legacy_attachment_links_immutable_v1() from public,anon,authenticated,service_role;
create trigger immutable before update or delete on private.finance_legacy_attachment_links_v1
 for each row execute function private.finance_legacy_attachment_links_immutable_v1();
with parents as materialized(
 select 'expense_requests'::text record_type,p.tenant_id,p.data_environment,p.id,
  'id:'||p.id parent_group,array[p.id,p.no] aliases,
  public.finance_attachment_paths_v1(array[p.files,p.actual_files,p.steps,p.form_payload]) paths,
  jsonb_build_object('entity',p.entity_id,'department',p.department_code,'applicant',p.applicant_id,'batch',p.batch_id) source_scope
 from public.expense_requests p
 union all
 select 'invoices',p.tenant_id,p.data_environment,p.id,
  case when nullif(p.batch_id,'') is null then 'id:'||p.id else 'batch:'||p.batch_id end,
  array[p.id,p.no,p.batch_id],public.finance_attachment_paths_v1(array[p.receipt_files,p.steps]),jsonb_build_object('entity',p.entity_id,'department',p.department_code,'applicant',p.applicant_id,'batch',p.batch_id)
 from public.invoices p
 union all
 select 'bills',p.tenant_id,p.data_environment,p.id,
  coalesce('batch:'||nullif(p.batch_id,''),'display:'||public.finance_bill_attachment_batch_no_v1(p.note),'id:'||p.id),
  array[p.id,p.no,p.batch_id,public.finance_bill_attachment_batch_no_v1(p.note)],'{}'::text[],jsonb_build_object('entity',p.entity_id,'department',p.department_code,'applicant',p.applicant_id,'batch',p.batch_id)
 from public.bills p
 union all
 select 'vouchers',p.tenant_id,p.data_environment,p.id,'id:'||p.id,array[p.id,p.no,p.request_id],'{}'::text[],jsonb_build_object('entity',p.entity_id)
 from public.vouchers p
), attachments as materialized(
 select a.* from public.file_attachments a where a.attachment_state='claimed'
  and a.bucket_id='finance-attachments' and a.record_no is not null
), keyed as materialized(
 select a.id attachment_id,p.id parent_id,p.parent_group,p.source_scope from attachments a join parents p
 on p.record_type=a.record_type and p.tenant_id=a.tenant_id and p.data_environment=a.data_environment
 and a.record_no=any(p.aliases)
), candidates as materialized(
 select * from keyed
 union all
 select a.id,p.id,p.parent_group,p.source_scope from attachments a join parents p
 on p.record_type=a.record_type and p.tenant_id=a.tenant_id and p.data_environment=a.data_environment
 and p.paths @> array[a.storage_path]
 where not exists(select 1 from keyed k where k.attachment_id=a.id)
), unambiguous as(
 select attachment_id,count(distinct parent_id) ref_count from candidates
 group by attachment_id having count(distinct parent_group)=1 and count(distinct source_scope)=1
)
insert into private.finance_legacy_attachment_links_v1(
 attachment_id,tenant_id,data_environment,record_type,original_record_no,storage_path,
 parent_kind,parent_key,source_reference_count,source_scope,source_fingerprint)
select distinct a.id,a.tenant_id,a.data_environment,a.record_type,a.record_no,a.storage_path,
 'id',c.parent_id,u.ref_count,p.source_scope,md5(jsonb_build_object('path',a.storage_path,'parent',c.parent_id)::text)
from attachments a join candidates c on c.attachment_id=a.id join unambiguous u on u.attachment_id=a.id
join parents p on p.record_type=a.record_type and p.tenant_id=a.tenant_id and p.data_environment=a.data_environment and p.id=c.parent_id;

-- A sealed source ID cannot be renamed or reused after its row is deleted.
-- Existing-row UPSERT remains valid; its UPDATE branch keeps the same ID.
create function private.finance_attachment_source_identity_v1()
returns trigger language plpgsql security definer set search_path='' as $function$
declare source_exists boolean;begin
 if tg_table_schema<>'public' or tg_table_name not in ('expense_requests','invoices','bills','vouchers') then
  raise exception 'Invalid attachment source identity trigger' using errcode='42501';
 end if;
 if tg_op='UPDATE' and new.id is distinct from old.id then
  raise exception '單據內部識別碼不可修改' using errcode='23514';
 end if;
 if tg_op='INSERT' and exists(select 1 from private.finance_legacy_attachment_links_v1 l
   where l.record_type=tg_table_name and l.parent_key=new.id) then
  execute format('select exists(select 1 from public.%I where id=$1)',tg_table_name) into source_exists using new.id;
  if not source_exists then raise exception '已封存附件的單據識別碼不可重複使用' using errcode='23514';end if;
 end if;
 return new;
end
$function$;
revoke all on function private.finance_attachment_source_identity_v1() from public,anon,authenticated,service_role;
do $source_identity_triggers$
declare source_table text;begin
 foreach source_table in array array['expense_requests','invoices','bills','vouchers'] loop
  execute format('create trigger finance_attachment_source_identity_v1 before insert or update on public.%I for each row execute function private.finance_attachment_source_identity_v1()',source_table);
 end loop;
end $source_identity_triggers$;

-- Private, non-API lookup returns only immutable internal IDs. Parent tables
-- are read by the outer SECURITY INVOKER function, so ALL parent RLS applies.
-- No attachment metadata is read here, avoiding attachment-policy recursion.
create schema finance_attachment_private;
revoke all on schema finance_attachment_private from public,anon,service_role;
grant usage on schema finance_attachment_private to authenticated;
create function finance_attachment_private.parent_links_v1(
 p_attachment_id uuid,p_record_type text,p_record_no text,p_storage_path text,p_environment text)
returns table(parent_key text) language sql stable security definer set search_path='' as $function$
 select l.parent_key from private.finance_legacy_attachment_links_v1 l
 where l.attachment_id=p_attachment_id and l.tenant_id=public.current_tenant_id()
  and l.record_type=p_record_type and l.original_record_no=p_record_no
  and l.storage_path=p_storage_path and l.data_environment=p_environment
  and nullif(public.current_finance_user_id(),'') is not null
  and nullif(public.finance_current_verified_google_email_v2(),'') is not null
$function$;
revoke all on function finance_attachment_private.parent_links_v1(uuid,text,text,text,text) from public,anon,service_role;
grant execute on function finance_attachment_private.parent_links_v1(uuid,text,text,text,text) to authenticated;

CREATE OR REPLACE FUNCTION public.can_read_expense_request(p_request expense_requests)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select
    nullif(public.current_finance_user_id(), '') is not null
    and nullif(public.finance_current_verified_google_email_v2(), '') is not null
    and p_request.tenant_id = public.current_tenant_id()
    and (
      public.is_finance_accounting()
      or public.finance_identity_matches_current_v1(
        array[coalesce(nullif(btrim(p_request.applicant_id),''),nullif(btrim(p_request.form_payload->'applicantProfile'->>'id'),''))],
        array[p_request.form_payload->'applicantProfile'->>'email'],array[p_request.applicant])
      or public.json_steps_include_current_user(p_request.steps)
      or (public.json_steps_role_matches(p_request.steps)
        and public.finance_role_queue_scope_v1(p_request.department_code,p_request.entity_id))
      or (
        public.current_finance_role() in ('section_chief', 'dept_manager')
        and p_request.department_code = public.current_finance_department()
      )
      or (
        public.current_finance_role() = 'hr'
        and p_request.type = 'welfare_request'
      )
      or (
        public.current_finance_role() = 'general_affairs'
        and p_request.type = 'purchase_request'
      )
    )
$function$;

CREATE OR REPLACE FUNCTION public.can_read_invoice(p_invoice invoices)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select
    nullif(public.current_finance_user_id(), '') is not null
    and nullif(public.finance_current_verified_google_email_v2(), '') is not null
    and p_invoice.tenant_id = public.current_tenant_id()
    and (
      public.is_finance_accounting()
      or public.finance_identity_matches_current_v1(array[p_invoice.applicant_id],array[]::text[],array[p_invoice.applicant])
      or public.json_steps_include_current_user(p_invoice.steps)
      or (public.json_steps_role_matches(p_invoice.steps)
        and public.finance_role_queue_scope_v1(p_invoice.department_code,p_invoice.entity_id))
      or (
        public.current_finance_role() in ('section_chief', 'dept_manager')
        and p_invoice.department_code = public.current_finance_department()
      )
    )
$function$;

CREATE OR REPLACE FUNCTION public.is_bill_owner(p_bill bills)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select
    nullif(public.current_finance_user_id(), '') is not null
    and nullif(public.finance_current_verified_google_email_v2(), '') is not null
    and p_bill.tenant_id = public.current_tenant_id()
    and public.finance_identity_matches_current_v1(array[p_bill.applicant_id],array[p_bill.applicant_email],array[p_bill.applicant])
$function$;

CREATE OR REPLACE FUNCTION public.can_read_bill(p_bill bills)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select
    nullif(public.current_finance_user_id(), '') is not null
    and nullif(public.finance_current_verified_google_email_v2(), '') is not null
    and p_bill.tenant_id = public.current_tenant_id()
    and (
      public.is_finance_accounting()
      or public.is_bill_owner(p_bill)
      or public.json_steps_include_current_user(p_bill.steps)
      or (public.json_steps_role_matches(p_bill.steps)
        and public.finance_role_queue_scope_v1(p_bill.department_code,p_bill.entity_id))
      or (
        public.current_finance_role() in ('section_chief', 'dept_manager')
        and p_bill.department_code = public.current_finance_department()
      )
    )
$function$;

CREATE OR REPLACE FUNCTION public.can_update_expense_request(p_request expense_requests)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select
    nullif(public.current_finance_user_id(), '') is not null
    and nullif(public.finance_current_verified_google_email_v2(), '') is not null
    and p_request.tenant_id = public.current_tenant_id()
    and (
      public.is_finance_accounting()
      or public.json_steps_include_current_user(p_request.steps)
      or (public.json_steps_role_matches(p_request.steps)
        and public.finance_role_queue_scope_v1(p_request.department_code,p_request.entity_id))
      or (
        public.finance_identity_matches_current_v1(
        array[coalesce(nullif(btrim(p_request.applicant_id),''),nullif(btrim(p_request.form_payload->'applicantProfile'->>'id'),''))],
        array[p_request.form_payload->'applicantProfile'->>'email'],array[p_request.applicant])
        and p_request.status in ('pending_applicant_confirm', 'returned')
      )
      or (
        public.current_finance_role() = 'general_affairs'
        and p_request.type = 'purchase_request'
        and p_request.status = 'pending_procurement'
      )
    )
$function$;

CREATE OR REPLACE FUNCTION public.can_update_invoice(p_invoice invoices)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select
    nullif(public.current_finance_user_id(), '') is not null
    and nullif(public.finance_current_verified_google_email_v2(), '') is not null
    and p_invoice.tenant_id = public.current_tenant_id()
    and (
      public.is_finance_accounting()
      or public.json_steps_include_current_user(p_invoice.steps)
      or (public.json_steps_role_matches(p_invoice.steps)
        and public.finance_role_queue_scope_v1(p_invoice.department_code,p_invoice.entity_id))
      or p_invoice.applicant_id = public.current_finance_user_id()
    )
$function$;

-- Parent table reads run as the caller, retaining all parent RLS (including
-- the restrictive HR salary policies). Never call the voucher attachment
-- helper here: it reads file_attachments and would cause policy recursion.
create or replace function public.can_read_finance_attachment(p_attachment file_attachments)
returns boolean language plpgsql stable security invoker set search_path='' as $function$
begin
 if p_attachment.id is null or p_attachment.bucket_id is distinct from 'finance-attachments'
    or auth.uid() is null or nullif(public.current_finance_user_id(),'') is null
    or nullif(public.finance_current_verified_google_email_v2(),'') is null
    or p_attachment.tenant_id is distinct from public.current_tenant_id() then return false; end if;
 if p_attachment.attachment_state='staged' then
  return coalesce(p_attachment.uploaded_by=public.current_finance_user_id(),false);
 end if;
 if p_attachment.attachment_state is distinct from 'claimed' then return false; end if;
 -- Explicitly retain HR guard for direct helper callers as well as table RLS.
 if not public.finance_hr_attachment_scope(p_attachment.tenant_id,p_attachment.record_type,p_attachment.record_no,p_attachment.data_environment) then return false; end if;
 case p_attachment.record_type
 when 'expense_requests' then
  return exists(select 1 from public.expense_requests p
    join finance_attachment_private.parent_links_v1(p_attachment.id,p_attachment.record_type,p_attachment.record_no,p_attachment.storage_path,p_attachment.data_environment) l on p.id=l.parent_key
    where p.tenant_id=p_attachment.tenant_id and p.data_environment=p_attachment.data_environment);
 when 'invoices' then
  return exists(select 1 from public.invoices p
    join finance_attachment_private.parent_links_v1(p_attachment.id,p_attachment.record_type,p_attachment.record_no,p_attachment.storage_path,p_attachment.data_environment) l on p.id=l.parent_key
    where p.tenant_id=p_attachment.tenant_id and p.data_environment=p_attachment.data_environment);
 when 'bills' then
  return exists(select 1 from public.bills p
    join finance_attachment_private.parent_links_v1(p_attachment.id,p_attachment.record_type,p_attachment.record_no,p_attachment.storage_path,p_attachment.data_environment) l on p.id=l.parent_key
    where p.tenant_id=p_attachment.tenant_id and p.data_environment=p_attachment.data_environment);
 when 'vouchers' then
  return exists(select 1 from public.vouchers p
    join finance_attachment_private.parent_links_v1(p_attachment.id,p_attachment.record_type,p_attachment.record_no,p_attachment.storage_path,p_attachment.data_environment) l on p.id=l.parent_key
    where p.tenant_id=p_attachment.tenant_id and p.data_environment=p_attachment.data_environment);
 else return false;
 end case;
end
$function$;

CREATE OR REPLACE FUNCTION private.finance_membership_org_departments_v1(p_tenant_id uuid, p_snapshot jsonb)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with recursive
  units as (
    select
      item ->> 'id' id,
      upper(btrim(item ->> 'code')) code,
      btrim(item ->> 'name') name,
      lower(btrim(item ->> 'unit_type')) unit_type,
      nullif(item ->> 'parent_org_unit_id', '') parent_id,
      coalesce((item ->> 'sort_order')::integer, 0) sort_order,
      coalesce((item ->> 'is_posting_unit')::boolean, false) is_posting_unit,
      lower(btrim(coalesce(item ->> 'entity_scope_mode', 'inherit'))) scope_mode,
      coalesce(item -> 'entity_codes', '[]'::jsonb) entity_codes,
      coalesce((item ->> 'active')::boolean, true) active,
      item
    from jsonb_array_elements(coalesce(p_snapshot -> 'units', '[]'::jsonb)) item
  ),
  entity_settings as (
    select entity ->> 'id' entity_code
    from public.system_settings setting_row
    cross join lateral jsonb_array_elements(setting_row.value) entity
    where setting_row.tenant_id = p_tenant_id and setting_row.key = 'entities'
  ),
  ancestor_chain as (
    select u.id root_id, u.id current_id, u.parent_id, u.scope_mode, u.entity_codes, 0 depth
    from units u
    union all
    select chain.root_id, parent.id, parent.parent_id, parent.scope_mode, parent.entity_codes, chain.depth + 1
    from ancestor_chain chain
    join units parent on parent.id = chain.parent_id
    where chain.depth < 32
  ),
  effective_scopes as (
    select root.id,
      coalesce((
        select case
          when chain.scope_mode = 'all' then (
            select coalesce(jsonb_agg(entity_code order by entity_code), '[]'::jsonb)
            from entity_settings
          )
          else chain.entity_codes
        end
        from ancestor_chain chain
        where chain.root_id = root.id
          and chain.scope_mode in ('all', 'explicit')
        order by chain.depth
        limit 1
      ), '[]'::jsonb) entity_codes
    from units root
  ),
  parent_chain as (
    select u.id root_id, u.parent_id current_id, 1 depth
    from units u
    union all
    select chain.root_id, parent.parent_id, chain.depth + 1
    from parent_chain chain
    join units parent on parent.id = chain.current_id
    where chain.depth < 32
  ),
  projected as (
    select
      u.*,
      case u.unit_type when 'department' then 3 when 'section' then 4 when 'team' then 5 end level_no,
      scope.entity_codes effective_entities,
      (
        select parent.code
        from parent_chain chain
        join units parent on parent.id = chain.current_id
        where chain.root_id = u.id
          and parent.active
          and parent.unit_type in ('department', 'section', 'team')
        order by chain.depth
        limit 1
      ) parent_code
    from units u
    join effective_scopes scope on scope.id = u.id
    where u.active and u.unit_type in ('department', 'section', 'team')
  ),
  rows as (
    select jsonb_build_object(
      'c', p.code,
      'n', p.name,
      'lv', p.level_no,
      'eid', coalesce((select value #>> '{}' from jsonb_array_elements(p.effective_entities) with ordinality e(value, ord) order by ord limit 1), ''),
      'sort', p.sort_order,
      'active', true,
      'parent', coalesce(p.parent_code, ''),
      'parentCode', p.parent_code,
      'parent_department_code', p.parent_code,
      'shared', jsonb_array_length(p.effective_entities) > 1,
      'unitType', p.unit_type,
      'entityCodes', p.effective_entities,
      'newFormEntityCodes', p.effective_entities,
      'isPostingUnit', p.is_posting_unit,
      'managerId', (
        select assignment ->> 'finance_user_id'
        from jsonb_array_elements(coalesce(p_snapshot -> 'assignments', '[]'::jsonb)) assignment
        where assignment ->> 'org_unit_id' = p.id
          and private.finance_org_effective_now_v2(assignment)
          and coalesce((assignment ->> 'can_approve')::boolean,false)
          and exists(select 1 from public.finance_users signer where signer.tenant_id=p_tenant_id and signer.id=assignment->>'finance_user_id' and signer.active=true)
          and public.finance_org_signer_is_runtime_ready(p_tenant_id,assignment->>'finance_user_id')
          and assignment ->> 'head_kind' in ('permanent', 'acting')
        order by case assignment ->> 'head_kind' when 'permanent' then 0 else 1 end
        limit 1
      ),
      'directorId', (
        select assignment ->> 'finance_user_id'
        from parent_chain chain
        join units parent on parent.id = chain.current_id
        cross join lateral jsonb_array_elements(coalesce(p_snapshot -> 'assignments', '[]'::jsonb)) assignment
        where chain.root_id = p.id
          and assignment ->> 'org_unit_id' = parent.id
          and private.finance_org_effective_now_v2(assignment)
          and coalesce((assignment ->> 'can_approve')::boolean,false)
          and exists(select 1 from public.finance_users signer where signer.tenant_id=p_tenant_id and signer.id=assignment->>'finance_user_id' and signer.active=true)
          and public.finance_org_signer_is_runtime_ready(p_tenant_id,assignment->>'finance_user_id')
          and assignment ->> 'head_kind' in ('permanent', 'acting')
        order by chain.depth, case assignment ->> 'head_kind' when 'permanent' then 0 else 1 end
        limit 1
      )
    ) row_value,
    p.level_no,
    p.sort_order,
    p.code
    from projected p
  )
  select coalesce(jsonb_agg(row_value order by level_no, sort_order, code), '[]'::jsonb)
  from rows
$function$;

CREATE OR REPLACE FUNCTION private.finance_claim_attachment_metadata_v2()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_document jsonb := pg_catalog.to_jsonb(new);
  v_old_document jsonb := '{}'::jsonb;
  v_tenant_id uuid;
  v_record_type text;
  v_environment text;
  v_primary_identifier text;
  v_batch_identifier text;
  v_batch_display_no text;
  v_note jsonb;
  v_actor_finance_user_id text;
  v_actor_auth_user_id uuid;
begin
  if tg_op = 'UPDATE' then
    v_old_document := pg_catalog.to_jsonb(old);
  end if;

  v_tenant_id := nullif(v_document ->> 'tenant_id', '')::uuid;
  v_environment := coalesce(
    nullif(v_document ->> 'data_environment', ''),
    'production'
  );

  -- Staged metadata can only be promoted by the same verified signed-in user
  -- who uploaded the corresponding Storage object.  Document actor fields are
  -- deliberately not accepted as a substitute for the live OAuth identity.
  v_actor_auth_user_id := auth.uid();
  v_actor_finance_user_id := nullif(
    public.current_finance_user_id(),
    ''
  );

  case tg_table_name
    when 'expense_requests' then
      v_record_type := 'expense_requests';
      v_primary_identifier := coalesce(
        nullif(v_document ->> 'no', ''),
        nullif(v_document ->> 'id', '')
      );
    when 'invoices' then
      v_record_type := 'invoices';
      v_batch_identifier := nullif(v_document ->> 'batch_id', '');
      v_primary_identifier := coalesce(
        v_batch_identifier,
        nullif(v_document ->> 'no', ''),
        nullif(v_document ->> 'id', '')
      );
    when 'bills' then
      v_record_type := 'bills';
      v_batch_identifier := nullif(v_document ->> 'batch_id', '');
      begin
        v_note := coalesce(
          nullif(v_document ->> 'note', '')::jsonb,
          '{}'::jsonb
        );
      exception
        when invalid_text_representation then
          v_note := '{}'::jsonb;
      end;
      v_batch_display_no := coalesce(
        nullif(v_note ->> 'batchNo', ''),
        nullif(v_note ->> 'batch_no', '')
      );
      v_primary_identifier := coalesce(
        v_batch_display_no,
        v_batch_identifier,
        nullif(v_document ->> 'no', ''),
        nullif(v_document ->> 'id', '')
      );
    when 'vouchers' then
      v_record_type := 'vouchers';
      v_primary_identifier := coalesce(
        nullif(v_document ->> 'no', ''),
        nullif(v_document ->> 'id', ''),
        nullif(v_document ->> 'request_id', '')
      );
    else
      return new;
  end case;

  if v_tenant_id is null
     or v_primary_identifier is null then
    return new;
  end if;

  -- Exact path membership replaces provisional record-number equality.  Every
  -- other trust boundary remains mandatory, including the live OAuth actor and
  -- storage.objects.owner_id.  On UPDATE, only newly added paths are eligible;
  -- this prevents a harmless edit from mutating historical attachment rows.
  if v_actor_finance_user_id is not null
     and v_actor_auth_user_id is not null then
    with newly_claimed as (
    update public.file_attachments attachment
    set
      record_no = v_primary_identifier,
      attachment_state = 'claimed',
      claimed_at = coalesce(
        attachment.claimed_at,
        pg_catalog.clock_timestamp()
      ),
      claim_key = v_record_type || ':' || v_primary_identifier
    from storage.objects object_row,
         public.finance_users uploader
    where attachment.tenant_id = v_tenant_id
      and attachment.bucket_id = 'finance-attachments'
      and attachment.record_type = v_record_type
      and attachment.data_environment = v_environment
      and attachment.attachment_state = 'staged'
      and attachment.uploaded_by = v_actor_finance_user_id
      and private.finance_is_current_document_attachment_path_v3(
        attachment.storage_path,
        v_tenant_id,
        v_record_type,
        v_environment
      )
      and private.finance_json_contains_attachment_path_v2(
        v_document,
        attachment.storage_path
      )
      and (
        tg_op = 'INSERT'
        or not private.finance_json_contains_attachment_path_v2(
          v_old_document,
          attachment.storage_path
        )
      )
      and object_row.bucket_id = attachment.bucket_id
      and object_row.name = attachment.storage_path
      and object_row.owner_id = v_actor_auth_user_id::text
      and uploader.tenant_id = attachment.tenant_id
      and uploader.id = attachment.uploaded_by
      and uploader.auth_user_id = v_actor_auth_user_id
    returning attachment.*
    )
    insert into private.finance_legacy_attachment_links_v1(
      attachment_id,tenant_id,data_environment,record_type,original_record_no,storage_path,
      parent_kind,parent_key,source_reference_count,source_scope,source_fingerprint)
    select claimed.id,claimed.tenant_id,claimed.data_environment,claimed.record_type,
      claimed.record_no,claimed.storage_path,'id',v_document->>'id',1,jsonb_build_object('entity',v_document->>'entity_id','department',v_document->>'department_code','applicant',v_document->>'applicant_id','batch',v_document->>'batch_id'),
      md5(jsonb_build_object('path',claimed.storage_path,'parent',v_document->>'id')::text)
    from newly_claimed claimed
    on conflict(attachment_id,parent_key) do nothing;
  end if;

  if v_actor_finance_user_id is not null and v_actor_auth_user_id is not null then
    insert into private.finance_legacy_attachment_links_v1(
      attachment_id,tenant_id,data_environment,record_type,original_record_no,storage_path,
      parent_kind,parent_key,source_reference_count,source_scope,source_fingerprint)
    select attachment.id,attachment.tenant_id,attachment.data_environment,attachment.record_type,
      attachment.record_no,attachment.storage_path,'id',v_document->>'id',1,jsonb_build_object('entity',v_document->>'entity_id','department',v_document->>'department_code','applicant',v_document->>'applicant_id','batch',v_document->>'batch_id'),
      md5(jsonb_build_object('path',attachment.storage_path,'parent',v_document->>'id')::text)
    from public.file_attachments attachment join storage.objects object_row
      on object_row.bucket_id=attachment.bucket_id and object_row.name=attachment.storage_path
    where attachment.tenant_id=v_tenant_id and attachment.data_environment=v_environment
      and attachment.record_type=v_record_type and attachment.record_no=v_primary_identifier
      and attachment.attachment_state='claimed' and attachment.uploaded_by=v_actor_finance_user_id
      and object_row.owner_id=v_actor_auth_user_id::text
      and private.finance_json_contains_attachment_path_v2(v_document,attachment.storage_path)
      and (tg_op='INSERT' or not private.finance_json_contains_attachment_path_v2(v_old_document,attachment.storage_path))
      and public.can_read_finance_attachment(attachment)
      and exists(select 1 from private.finance_legacy_attachment_links_v1 original_link
        where original_link.attachment_id=attachment.id
          and original_link.tenant_id=v_tenant_id and original_link.record_type=v_record_type
          and original_link.data_environment=v_environment
          and case v_record_type
            when 'expense_requests' then exists(select 1 from public.expense_requests origin
              where origin.id=original_link.parent_key and origin.tenant_id=v_tenant_id
                and public.can_read_expense_request(origin))
            when 'invoices' then exists(select 1 from public.invoices origin
              where origin.id=original_link.parent_key and origin.tenant_id=v_tenant_id
                and public.can_read_invoice(origin))
            when 'bills' then exists(select 1 from public.bills origin
              where origin.id=original_link.parent_key and origin.tenant_id=v_tenant_id
                and public.can_read_bill(origin))
            when 'vouchers' then public.is_finance_accounting()
            else false end
          and (original_link.parent_key=v_document->>'id'
            or (v_record_type in ('invoices','bills')
              and nullif(original_link.source_scope->>'batch','') is not null
              and original_link.source_scope=jsonb_build_object('entity',v_document->>'entity_id','department',v_document->>'department_code','applicant',v_document->>'applicant_id','batch',v_document->>'batch_id'))))
    on conflict(attachment_id,parent_key) do nothing;
  end if;

  -- INSERT is strict for every new-format Finance Storage reference.  UPDATE is
  -- strict only for paths absent from OLD, so a historical missing object does
  -- not block unrelated workflow or accounting changes.
  if exists (
    select 1
    from private.finance_attachment_paths_in_document_v2(v_document)
      referenced_path(storage_path)
    where private.finance_is_current_finance_attachment_path_v3(
      referenced_path.storage_path
    )
      and (
        tg_op = 'INSERT'
        or not private.finance_json_contains_attachment_path_v2(
          v_old_document,
          referenced_path.storage_path
        )
      )
      and not exists (
        select 1
        from public.file_attachments attachment
        join storage.objects object_row
          on object_row.bucket_id = attachment.bucket_id
         and object_row.name = attachment.storage_path
        join public.finance_users uploader
          on uploader.tenant_id = attachment.tenant_id
         and uploader.id = attachment.uploaded_by
         and uploader.auth_user_id::text = object_row.owner_id
        where attachment.tenant_id = v_tenant_id
          and attachment.bucket_id = 'finance-attachments'
          and attachment.storage_path = referenced_path.storage_path
          and attachment.record_type = v_record_type
          and attachment.record_no = v_primary_identifier
          and attachment.data_environment = v_environment
          and attachment.attachment_state = 'claimed'
          and attachment.claimed_at is not null
          and attachment.uploaded_by = v_actor_finance_user_id
          and uploader.auth_user_id = v_actor_auth_user_id
      )
  ) then
    raise exception
      '附件尚未依正式單號完成綁定，系統已取消本次寫入，請重新整理後再試'
      using errcode = '55000';
  end if;

  if exists(select 1 from public.file_attachments attachment
    where attachment.tenant_id=v_tenant_id and attachment.data_environment=v_environment
      and attachment.bucket_id='finance-attachments' and attachment.attachment_state='claimed'
      and private.finance_json_contains_attachment_path_v2(v_document,attachment.storage_path)
      and (tg_op='INSERT' or not private.finance_json_contains_attachment_path_v2(v_old_document,attachment.storage_path))
      and not exists(select 1 from private.finance_legacy_attachment_links_v1 l
        where l.attachment_id=attachment.id and l.record_type=v_record_type
          and l.parent_key=v_document->>'id' and l.tenant_id=v_tenant_id and l.data_environment=v_environment)) then
    raise exception '附件尚未與本單據完成授權綁定，請重新上傳本人有權使用的附件' using errcode='42501';
  end if;
  return new;
end
$function$;
