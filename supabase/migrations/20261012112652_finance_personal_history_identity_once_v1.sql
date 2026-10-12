-- Compute the current server-verified identity once per private history query.
-- Each source still applies the exact ID/email/unique-legacy-name and actual
-- action predicates before complete invoice grouping, search and pagination.
-- No table, policy, owner, ACL, summary/detail function or business row changes.
set local lock_timeout='5s';
set local statement_timeout='60s';
do $history_identity_once_ledger_preflight$
begin
  if exists(select 1 from supabase_migrations.schema_migrations where version='20261012112652')
     or not exists(select 1 from supabase_migrations.schema_migrations where version='20261008055528' and name='finance_personal_document_history_v1')
     or not exists(select 1 from supabase_migrations.schema_migrations where version='20261008090000' and name='finance_personal_history_permission_guard_v1')
     or not exists(select 1 from supabase_migrations.schema_migrations where version='20261010130000' and name='finance_personal_invoice_batch_history_v1') then
    raise exception 'Personal history identity-once prerequisite or target ledger drift' using errcode='55000';
  end if;
end;
$history_identity_once_ledger_preflight$;
do $history_identity_once_preflight$
declare v_expected record; v_proc pg_catalog.pg_proc%rowtype;
begin
  for v_expected in select * from (values
      ('private.finance_personal_document_authorized_v1(public.finance_users,text,text,text)',false,'4a41edefa622a9c252315c0f6be673c0'),
      ('public.finance_personal_document_summary_v1(text,integer,integer,text,text)',true,'f68644d4f30ee10fd4b2bd76da4a2b83'),
      ('public.finance_personal_document_detail_v1(text,text)',true,'34989c18188536e079e63ff81370c2cf'),
      ('private.finance_history_actor_v1()',false,'4fa4b048271075bade4b7ddd3f424fc4'),
      ('private.finance_personal_history_page_allows_v1(public.finance_users)',true,'b2fed44ca1b66208649d50c7bfae921d')
  ) x(signature,security_definer,source_md5) loop
    select * into v_proc from pg_catalog.pg_proc where oid=pg_catalog.to_regprocedure(v_expected.signature);
    if v_proc.oid is null or pg_catalog.pg_get_userbyid(v_proc.proowner)<>'postgres'
       or v_proc.prosecdef is distinct from v_expected.security_definer
       or v_proc.provolatile<>'s' or v_proc.proconfig is distinct from array['search_path=""']::text[]
       or pg_catalog.md5(v_proc.prosrc) is distinct from v_expected.source_md5
       or pg_catalog.has_function_privilege('anon',v_proc.oid,'EXECUTE')
       or pg_catalog.has_function_privilege('service_role',v_proc.oid,'EXECUTE')
       or pg_catalog.has_function_privilege('authenticated',v_proc.oid,'EXECUTE') is distinct from (v_expected.signature like 'public.%')
       or exists(select 1 from pg_catalog.aclexplode(coalesce(v_proc.proacl,pg_catalog.acldefault('f',v_proc.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE') then
      raise exception 'Personal history identity-once authority/source drift: %',v_expected.signature using errcode='55000';
    end if;
  end loop;
end;
$history_identity_once_preflight$;

CREATE OR REPLACE FUNCTION private.finance_personal_document_authorized_v1(p_user public.finance_users, p_environment text, p_record_type text DEFAULT NULL::text, p_record_id text DEFAULT NULL::text)
 RETURNS TABLE(record_type text, kind text, record_id text, record_no text, batch_id text, last_participated_at timestamp with time zone, personally_applied boolean, personally_acted boolean)
 LANGUAGE sql
 STABLE SECURITY INVOKER
 SET search_path TO ''
AS $function$
  with current_identity as materialized (
    select public.current_finance_user_id() as current_id,
      public.finance_current_verified_google_email_v2() as current_email
  ), identity as materialized (
    select c.current_id,c.current_email,
      case when f.active is true and nullif(btrim(f.name),'') is not null
        and not exists(select 1 from public.finance_users other
          where other.tenant_id=f.tenant_id and other.id<>f.id
            and btrim(other.name)=btrim(f.name)) then btrim(f.name) end as unique_name
    from current_identity c
    left join public.finance_users f on f.id=c.current_id and f.tenant_id=p_user.tenant_id
    where nullif(c.current_id,'') is not null and nullif(c.current_email,'') is not null
  ), matched_snapshots as (
    select
      s.record_type,
      s.record_id,
      max(case when candidate.actually_acted then
        case
          when nullif(pg_catalog.btrim(s.acted_at_text), '') is not null
           and pg_catalog.pg_input_is_valid(pg_catalog.btrim(s.acted_at_text), 'timestamp with time zone')
            then pg_catalog.btrim(s.acted_at_text)::timestamptz
          else s.updated_at
        end
      end) as participated_at,
      bool_or(
        candidate.actually_acted
      ) as acted
    from public.approval_step_actor_snapshots s
    cross join lateral (select
        coalesce(s.role_key, '') not like 'applicant_%'
        and coalesce(s.raw_step ->> 'autoSkip', 'false') <> 'true'
        and (
          s.step_status in ('approved', 'rejected', 'rejected_all', 'returned')
          or (
            nullif(pg_catalog.btrim(s.acted_at_text), '') is not null
            and (s.step_status is null or s.step_status = 'cancelled')
          )
        )
        and (
          s.acted_by_user_id in (p_user.id, p_user.auth_user_id::text)
          or (
            nullif(pg_catalog.btrim(s.acted_by_user_id), '') is null
            and (
              s.raw_actor_user_id in (p_user.id, p_user.auth_user_id::text)
              or (
                nullif(pg_catalog.btrim(s.raw_actor_user_id), '') is null
                and pg_catalog.lower(pg_catalog.btrim(coalesce(s.raw_actor_email, '')))
                  = pg_catalog.lower(pg_catalog.btrim(p_user.email))
              )
            )
          )
        )
      as actually_acted) candidate
    where s.tenant_id = p_user.tenant_id
      and s.data_environment = p_environment
      and s.record_type in ('expense_requests', 'bills', 'invoices')
      and (p_record_type is null or s.record_type = p_record_type)
      and (p_record_id is null or s.record_id = p_record_id)
      and (
        s.resolved_user_id = p_user.id
        or s.acted_by_user_id in (p_user.id, p_user.auth_user_id::text)
        or s.raw_actor_user_id in (p_user.id, p_user.auth_user_id::text)
        or pg_catalog.lower(pg_catalog.btrim(coalesce(s.resolved_email, '')))
           = pg_catalog.lower(pg_catalog.btrim(p_user.email))
        or pg_catalog.lower(pg_catalog.btrim(coalesce(s.raw_actor_email, '')))
           = pg_catalog.lower(pg_catalog.btrim(p_user.email))
      )
    group by s.record_type, s.record_id
  ),
  source_rows as (
    select
      'expense_requests'::text as record_type,
      'req'::text as kind,
      r.id as record_id,
      coalesce(r.no, r.id) as record_no,
      ''::text as batch_id,
      r.created_at,
      (case when nullif(btrim(coalesce(nullif(btrim(r.applicant_id),''),nullif(btrim(r.form_payload #>> '{applicantProfile,id}'),''))), '') is not null then identity.current_id=btrim(coalesce(nullif(btrim(r.applicant_id),''),nullif(btrim(r.form_payload #>> '{applicantProfile,id}'),'')))
 when (nullif(btrim(r.applicant_email),'') is not null or nullif(btrim(r.form_payload #>> '{applicantProfile,email}'),'') is not null) then identity.current_email=any(array[lower(btrim(r.applicant_email)),lower(btrim(r.form_payload #>> '{applicantProfile,email}'))])
 else identity.unique_name=any(array[btrim(r.applicant),btrim(r.form_payload #>> '{applicantProfile,name}')]) end) as applied
    from public.expense_requests r
    cross join identity
    where r.tenant_id = p_user.tenant_id
      and r.data_environment = p_environment
      and (p_record_type is null or p_record_type = 'expense_requests')
      and (p_record_id is null or r.id = p_record_id)

    union all

    select
      'bills'::text,
      'bill'::text,
      b.id,
      coalesce(b.no, b.id),
      coalesce(nullif(pg_catalog.btrim(b.batch_id), ''), ''),
      b.created_at,
      (case when nullif(btrim(b.applicant_id), '') is not null then identity.current_id=btrim(b.applicant_id)
 when (nullif(btrim(b.applicant_email),'') is not null) then identity.current_email=any(array[lower(btrim(b.applicant_email))])
 else identity.unique_name=any(array[btrim(b.applicant)]) end)
    from public.bills b
    cross join identity
    where b.tenant_id = p_user.tenant_id
      and b.data_environment = p_environment
      and (p_record_type is null or p_record_type = 'bills')
      and (p_record_id is null or b.id = p_record_id)

    union all

    select
      'invoices'::text,
      'inv'::text,
      i.id,
      coalesce(i.no, i.id),
      coalesce(nullif(pg_catalog.btrim(i.batch_id), ''), ''),
      i.created_at,
      (case when nullif(btrim(i.applicant_id), '') is not null then identity.current_id=btrim(i.applicant_id)
 else identity.unique_name=any(array[btrim(i.applicant)]) end)
    from public.invoices i
    cross join identity
    where i.tenant_id = p_user.tenant_id
      and i.data_environment = p_environment
      and (p_record_type is null or p_record_type = 'invoices')
      and (p_record_id is null or i.id = p_record_id)
  )
  select
    source.record_type,
    source.kind,
    source.record_id,
    source.record_no,
    source.batch_id,
    greatest(source.created_at, matched.participated_at),
    coalesce(source.applied, false),
    coalesce(matched.acted, false)
  from source_rows source
  left join matched_snapshots matched
    on matched.record_type = source.record_type
   and matched.record_id = source.record_id
  where coalesce(source.applied, false) or coalesce(matched.acted, false);
$function$;

do $history_identity_once_migration_postflight$
declare v_expected record; v_proc pg_catalog.pg_proc%rowtype;
begin
  for v_expected in select * from (values
      ('private.finance_personal_document_authorized_v1(public.finance_users,text,text,text)',false,'1db71550a2ec13ece520e25abb211e09'),
      ('public.finance_personal_document_summary_v1(text,integer,integer,text,text)',true,'f68644d4f30ee10fd4b2bd76da4a2b83'),
      ('public.finance_personal_document_detail_v1(text,text)',true,'34989c18188536e079e63ff81370c2cf'),
      ('private.finance_history_actor_v1()',false,'4fa4b048271075bade4b7ddd3f424fc4'),
      ('private.finance_personal_history_page_allows_v1(public.finance_users)',true,'b2fed44ca1b66208649d50c7bfae921d')
  ) x(signature,security_definer,source_md5) loop
    select * into v_proc from pg_catalog.pg_proc where oid=pg_catalog.to_regprocedure(v_expected.signature);
    if v_proc.oid is null or pg_catalog.pg_get_userbyid(v_proc.proowner)<>'postgres'
       or v_proc.prosecdef is distinct from v_expected.security_definer
       or v_proc.provolatile<>'s' or v_proc.proconfig is distinct from array['search_path=""']::text[]
       or pg_catalog.md5(v_proc.prosrc) is distinct from v_expected.source_md5
       or pg_catalog.has_function_privilege('anon',v_proc.oid,'EXECUTE')
       or pg_catalog.has_function_privilege('service_role',v_proc.oid,'EXECUTE')
       or pg_catalog.has_function_privilege('authenticated',v_proc.oid,'EXECUTE') is distinct from (v_expected.signature like 'public.%')
       or exists(select 1 from pg_catalog.aclexplode(coalesce(v_proc.proacl,pg_catalog.acldefault('f',v_proc.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE') then
      raise exception 'Personal history identity-once authority/source drift: %',v_expected.signature using errcode='55000';
    end if;
  end loop;
end;
$history_identity_once_migration_postflight$;

notify pgrst, 'reload schema';
