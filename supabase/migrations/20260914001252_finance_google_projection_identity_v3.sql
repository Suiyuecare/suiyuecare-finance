-- Read-only diagnostic correction. The release runner owns the atomic transaction.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create or replace function private.finance_google_projection_email_mismatch_v3(
  p_key text, p_value jsonb, p_finance_user_id text, p_email text
) returns boolean
language sql immutable
set search_path = ''
as $body$
  -- Only documented person containers and exact stable-ID/email pairs are read.
  -- A name-only PPT presentation cannot establish or refute an account binding.
  with branches as (
    select b from jsonb_array_elements(case when jsonb_typeof(p_value->'branches')='array' then p_value->'branches' else '[]'::jsonb end) b
  ), people as (
    select r as person from jsonb_array_elements(case when p_key='organization_chart' and jsonb_typeof(p_value)='array' then p_value else '[]'::jsonb end) r
    union all select p_value->'executive' where p_key='pptx_organization_roster'
    union all select b->'manager' from branches where p_key='pptx_organization_roster'
    union all select person from branches
      cross join lateral jsonb_array_elements(case when jsonb_typeof(b->'units')='array' then b->'units' else '[]'::jsonb end) unit
      cross join lateral jsonb_array_elements(case when jsonb_typeof(unit->'people')='array' then unit->'people' else '[]'::jsonb end) person
      where p_key='pptx_organization_roster'
  ), pairs as (
    select person, id_key, email_key
    from people cross join (values
      ('organization_chart','userId','userEmail'),('organization_chart','user_id','user_email'),
      ('pptx_organization_roster','financeUserId','loginEmail'),('pptx_organization_roster','finance_user_id','loginEmail'),
      ('pptx_organization_roster','userId','loginEmail'),('pptx_organization_roster','user_id','loginEmail'),
      ('organization_chart','supervisorId','supervisorEmail'),('organization_chart','effectiveSupervisorId','effectiveSupervisorEmail'),
      ('organization_chart','routingSupervisorId','routingSupervisorEmail'),('organization_chart','delegateId','delegateEmail'),
      ('organization_chart','approvalDelegateId','delegateEmail'),('organization_chart','approval_delegate_finance_user_id','delegateEmail')
    ) fields(kind,id_key,email_key) where kind=p_key
  )
  select exists(select 1 from pairs
    where nullif(p_finance_user_id,'') is not null
      and jsonb_typeof(person->id_key)='string'
      and person->>id_key=p_finance_user_id
      and (jsonb_typeof(person->email_key) is distinct from 'string'
        or lower(btrim(coalesce(person->>email_key,'')))<>lower(btrim(coalesce(p_email,'')))));
$body$;
alter function private.finance_google_projection_email_mismatch_v3(text,jsonb,text,text) owner to postgres;
revoke all on function private.finance_google_projection_email_mismatch_v3(text,jsonb,text,text) from public, anon, authenticated, service_role;

do $migration$
declare definition text;
begin
  if (select md5(prosrc) from pg_proc where oid=to_regprocedure('private.finance_google_projection_health_v2(uuid,text)')) is distinct from '1fd1f2f05536d7cdb96668c5ebdab02a' then
    raise exception 'Google projection health source differs from the reviewed baseline';
  end if;
  definition := pg_get_functiondef('private.finance_google_projection_health_v2(uuid,text)'::regprocedure);
  if position($old$  select count(*)::integer
  into v_org_email_mismatch_count
  from public.system_settings ss
  where ss.tenant_id = v_finance.tenant_id
    and ss.key in ('organization_chart', 'pptx_organization_roster')
    and (
      ss.value::text like '%' || v_finance.id || '%'
      or position(v_finance.name in ss.value::text) > 0
    )
    and position(v_finance.email in ss.value::text) = 0;$old$ in definition)=0 then
    raise exception 'Google projection health query replacement was not found';
  end if;
  execute replace(definition,$old$  select count(*)::integer
  into v_org_email_mismatch_count
  from public.system_settings ss
  where ss.tenant_id = v_finance.tenant_id
    and ss.key in ('organization_chart', 'pptx_organization_roster')
    and (
      ss.value::text like '%' || v_finance.id || '%'
      or position(v_finance.name in ss.value::text) > 0
    )
    and position(v_finance.email in ss.value::text) = 0;$old$,$new$  -- PERSONNEL_PROJECTION_STABLE_ID_V3: presentation names are not account identities.
  select count(*)::integer
  into v_org_email_mismatch_count
  from public.system_settings ss
  where ss.tenant_id = v_finance.tenant_id
    and ss.key in ('organization_chart', 'pptx_organization_roster')
    and private.finance_google_projection_email_mismatch_v3(ss.key, ss.value, v_finance.id, v_finance.email);$new$);
end;
$migration$;
alter function private.finance_google_projection_health_v2(uuid,text) owner to postgres;
