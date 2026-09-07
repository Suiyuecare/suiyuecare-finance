-- Attendance security boundary: browser actors and roles come from verified identity.
-- Existing trusted server callers retain the public signatures and service-role path.
-- The protected release verifies this migration and records its ledger atomically.
-- The release runner supplies the single transaction; this source must not
-- commit independently of its migration ledger/postflight.
set local lock_timeout='5s';
set local statement_timeout='30s';
do $preflight$
declare x record; actual text;
begin
  for x in select * from (values
    ('hris_create_attendance_punch','e8b230b688b46a13ab2854ed1206858a'),
    ('hris_list_attendance_punches','406775167bfe5e491104dc465e9dfcc8'),
    ('hris_review_attendance_punch','0d036faa1bdce09ae2c2981f9379ca8f')
  ) a(name, hash) loop
    select md5(pg_get_functiondef(p.oid)) into actual from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=x.name;
    if actual is distinct from x.hash then raise exception 'HRIS function drift: %',x.name; end if;
  end loop;
end;
$preflight$;

create function private.hris_attendance_company_in_tenant_v1(p_company_id uuid,p_tenant_id uuid,p_entity_id text)
returns boolean language sql stable security definer set search_path=''
as $company$
  with configured_entities as (
    select entity_item from public.system_settings ss
    cross join lateral jsonb_array_elements(case when jsonb_typeof(ss.value)='array' then ss.value else '[]'::jsonb end) entity_item
    where ss.tenant_id=p_tenant_id and ss.key='entities'
      and coalesce(nullif(entity_item->>'id',''),nullif(entity_item->>'eid',''),nullif(entity_item->>'code',''),nullif(entity_item->>'c',''))=p_entity_id
  ), mapped as (
    select distinct c.id from public.companies c join configured_entities e
      on c.code=p_entity_id and nullif(btrim(c.tax_id),'')=nullif(btrim(e.entity_item->>'taxId'),'')
    where c.deleted_at is null
  )
  select count(*)=1 and coalesce(bool_and(id=p_company_id),false) from mapped
$company$;
alter function private.hris_attendance_company_in_tenant_v1(uuid,uuid,text) owner to postgres;
revoke all on function private.hris_attendance_company_in_tenant_v1(uuid,uuid,text) from public,anon,authenticated,service_role;

-- HR-only staff may use their verified HR account for their own attendance.
-- This is separate from Finance authority: an existing Finance binding never
-- falls back here after being disabled, moved, or losing its verified email.
create function private.hris_attendance_hr_identity_v1(p_user_id uuid)
returns boolean language sql stable security definer set search_path=''
as $hr_identity$
  select exists (
    select 1 from public.users u
    join auth.users a on a.id=u.auth_user_id and a.email_confirmed_at is not null
      and lower(btrim(a.email))=lower(btrim(u.email))
    join public.employees e on e.id=u.employee_id and e.company_id=u.company_id
      and e.deleted_at is null and e.employment_status='active'
      and lower(btrim(e.email))=lower(btrim(u.email))
    join public.companies c on c.id=u.company_id and c.deleted_at is null and c.status='active'
    join public.roles r on r.id=u.role_id and r.deleted_at is null
      and (r.company_id is null or r.company_id=u.company_id)
    where u.id=p_user_id and u.deleted_at is null and u.status='active'
      and not exists(select 1 from public.finance_users f where f.auth_user_id=u.auth_user_id)
  )
$hr_identity$;
alter function private.hris_attendance_hr_identity_v1(uuid) owner to postgres;
revoke all on function private.hris_attendance_hr_identity_v1(uuid) from public,anon,authenticated,service_role;

-- HR-only records are visible to Finance reviewers only when their company has
-- one unambiguous tenant mapping. Unmapped HR companies still support self use.
create function private.hris_attendance_hr_company_tenant_v1(p_company_id uuid)
returns uuid language sql stable security definer set search_path=''
as $hr_tenant$
  with mapped as (
    select distinct ss.tenant_id from public.companies c join public.system_settings ss on ss.key='entities'
    cross join lateral jsonb_array_elements(case when jsonb_typeof(ss.value)='array' then ss.value else '[]'::jsonb end) item
    where c.id=p_company_id and c.deleted_at is null and c.status='active'
      and coalesce(nullif(item->>'id',''),nullif(item->>'eid',''),nullif(item->>'code',''),nullif(item->>'c',''))=c.code
      and nullif(btrim(c.tax_id),'')=nullif(btrim(item->>'taxId'),'')
      and private.hris_attendance_company_in_tenant_v1(c.id,ss.tenant_id,c.code)
  ) select case when count(*)=1 then (array_agg(tenant_id))[1] end from mapped
$hr_tenant$;
alter function private.hris_attendance_hr_company_tenant_v1(uuid) owner to postgres;
revoke all on function private.hris_attendance_hr_company_tenant_v1(uuid) from public,anon,authenticated,service_role;

-- Departed Finance staff history retains its Finance identity. HR-only history
-- stays with its HR employee/company mapping; actor authorization is separate.
create function private.hris_attendance_user_in_tenant_v1(p_user_id uuid,p_company_id uuid,p_tenant_id uuid)
returns boolean language sql stable security definer set search_path=''
as $scope$
  select exists (
    select 1 from public.users u where u.id=p_user_id and u.company_id=p_company_id
      and (
        (select count(*)=1 from public.finance_users fu where fu.auth_user_id=u.auth_user_id
          and lower(btrim(fu.email))=lower(btrim(u.email)) and fu.tenant_id=p_tenant_id
          and private.hris_attendance_company_in_tenant_v1(p_company_id,fu.tenant_id,fu.entity_id))
        or (
          not exists(select 1 from public.finance_users f where f.auth_user_id=u.auth_user_id)
          and exists(select 1 from public.employees e where e.id=u.employee_id and e.company_id=u.company_id)
          and private.hris_attendance_hr_company_tenant_v1(p_company_id)=p_tenant_id
        )
      )
  )
$scope$;
alter function private.hris_attendance_user_in_tenant_v1(uuid,uuid,uuid) owner to postgres;
revoke all on function private.hris_attendance_user_in_tenant_v1(uuid,uuid,uuid) from public,anon,authenticated,service_role;

create function private.hris_verified_attendance_actor_v1(p_user_id uuid,p_email text)
returns jsonb language plpgsql stable security definer set search_path=''
as $actor$
declare
  v_user public.users%rowtype;
  v_finance public.finance_users%rowtype;
  v_count integer;
  v_service boolean := coalesce(auth.jwt()->>'role','')='service_role';
begin
  if auth.uid() is null and not v_service then
    raise exception 'Verified session required' using errcode='42501';
  end if;
  select * into v_user from public.users u where u.id=p_user_id and u.deleted_at is null and u.status='active'
    and lower(btrim(u.email))=lower(btrim(p_email));
  if v_user.id is null or v_user.auth_user_id is null then
    raise exception 'Active bound HR identity required' using errcode='42501';
  end if;
  if not v_service and v_user.auth_user_id is distinct from auth.uid() then
    raise exception 'Attendance actor must be the authenticated employee' using errcode='42501';
  end if;
  if not exists(select 1 from public.finance_users f where f.auth_user_id=v_user.auth_user_id) then
    if not private.hris_attendance_hr_identity_v1(v_user.id) then
      raise exception 'Verified active HR employee identity required' using errcode='42501';
    end if;
    -- Backend HR roles are retained as audit context. They do not manufacture
    -- Finance attendance-review authority, including when input_role is forged.
    return jsonb_build_object('id',v_user.id,'email',v_user.email,'role','employee',
      'hr_role',(select r.key from public.roles r where r.id=v_user.role_id),
      'identity_source','hr','tenant_id',private.hris_attendance_hr_company_tenant_v1(v_user.company_id),
      'auth_user_id',v_user.auth_user_id,'company_id',v_user.company_id,'employee_id',v_user.employee_id);
  end if;
  select count(*) into v_count from public.finance_users fu
    where fu.auth_user_id=v_user.auth_user_id and fu.active=true
      and fu.google_link_status in ('bound','pending_rebind')
      and lower(btrim(fu.email))=public.finance_verified_google_email(v_user.auth_user_id)
      and lower(btrim(fu.email))=lower(btrim(v_user.email))
      and private.hris_attendance_company_in_tenant_v1(v_user.company_id,fu.tenant_id,fu.entity_id)
      and (v_service or fu.tenant_id=public.current_tenant_id());
  if v_count<>1 then raise exception 'Unique approved Finance identity required' using errcode='42501'; end if;
  select fu.* into v_finance from public.finance_users fu
    where fu.auth_user_id=v_user.auth_user_id and fu.active=true
      and fu.google_link_status in ('bound','pending_rebind')
      and lower(btrim(fu.email))=public.finance_verified_google_email(v_user.auth_user_id)
      and lower(btrim(fu.email))=lower(btrim(v_user.email))
      and private.hris_attendance_company_in_tenant_v1(v_user.company_id,fu.tenant_id,fu.entity_id)
      and (v_service or fu.tenant_id=public.current_tenant_id());
  return jsonb_build_object('id',v_user.id,'email',v_user.email,'role',v_finance.role,
    'identity_source','finance','tenant_id',v_finance.tenant_id,'auth_user_id',v_user.auth_user_id,'company_id',v_user.company_id,'employee_id',v_user.employee_id);
end;
$actor$;
alter function private.hris_verified_attendance_actor_v1(uuid,text) owner to postgres;
revoke all on function private.hris_verified_attendance_actor_v1(uuid,text) from public,anon,authenticated,service_role;

alter function public.hris_create_attendance_punch(uuid,text,text,numeric,numeric,text,text,text,text,boolean,text,text,text,integer,text) set schema private;
revoke all on function private.hris_create_attendance_punch(uuid,text,text,numeric,numeric,text,text,text,text,boolean,text,text,text,integer,text) from public,anon,authenticated,service_role;
create function public.hris_create_attendance_punch(input_user_id uuid, input_email text, input_punch_type text, input_latitude numeric, input_longitude numeric, input_address text, input_device_info text, input_wifi_ssid text, input_ip_address text, input_is_abnormal boolean, input_abnormal_reason text, input_rule_name text, input_passed_rule text, input_distance_meters integer, input_review_status text)
 RETURNS public.attendance_punches
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor jsonb; v_row public.attendance_punches%rowtype;
begin
  v_actor:=private.hris_verified_attendance_actor_v1(input_user_id,input_email);
  if input_punch_type is null or input_punch_type not in ('clock_in','clock_out','out','return') then
    raise exception 'Invalid punch type' using errcode='22023';
  end if;
  if coalesce(input_review_status,'none') not in ('none','pending') then
    raise exception 'A new punch cannot self-approve or self-reject' using errcode='42501';
  end if;
  v_row:=private.hris_create_attendance_punch((v_actor->>'id')::uuid,v_actor->>'email',
    input_punch_type,input_latitude,input_longitude,input_address,input_device_info,input_wifi_ssid,
    input_ip_address,input_is_abnormal,input_abnormal_reason,input_rule_name,input_passed_rule,input_distance_meters,
    case when coalesce(input_is_abnormal,false) or input_review_status='pending' then 'pending' else 'none' end);
  insert into public.module_audit_logs(table_name,row_id,action,actor_email,before_data,after_data)
    values('attendance_punches',v_row.id::text,'ATTENDANCE_SELF_PUNCH',v_actor->>'email',null,
      jsonb_build_object('actor',v_actor,'review_status',v_row.review_status,'punched_at',v_row.punched_at));
  return v_row;
end;
$function$;
alter function public.hris_create_attendance_punch(uuid,text,text,numeric,numeric,text,text,text,text,boolean,text,text,text,integer,text) owner to postgres;
revoke all on function public.hris_create_attendance_punch(uuid,text,text,numeric,numeric,text,text,text,text,boolean,text,text,text,integer,text) from public,anon;
grant execute on function public.hris_create_attendance_punch(uuid,text,text,numeric,numeric,text,text,text,text,boolean,text,text,text,integer,text) to authenticated,service_role;

alter function public.hris_list_attendance_punches(uuid,text,text,integer) set schema private;
revoke all on function private.hris_list_attendance_punches(uuid,text,text,integer) from public,anon,authenticated,service_role;
create function public.hris_list_attendance_punches(input_user_id uuid, input_email text, input_role text, input_limit integer DEFAULT 200)
 RETURNS TABLE(id uuid, company_id uuid, user_id uuid, employee_id uuid, punched_at timestamp with time zone, punch_type text, latitude numeric, longitude numeric, address text, device_info text, wifi_ssid text, ip_address text, is_abnormal boolean, abnormal_reason text, rule_name text, passed_rule text, distance_meters integer, review_status text, reviewed_by uuid, reviewed_at timestamp with time zone, review_note text, deleted_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor jsonb;
begin
  v_actor:=private.hris_verified_attendance_actor_v1(input_user_id,input_email);
  -- Apply tenant scope before LIMIT, not after the legacy company-wide list.
  return query select p.id,p.company_id,p.user_id,p.employee_id,p.punched_at,p.punch_type,p.latitude,p.longitude,
    p.address,p.device_info,p.wifi_ssid,p.ip_address,p.is_abnormal,p.abnormal_reason,p.rule_name,p.passed_rule,
    p.distance_meters,p.review_status,p.reviewed_by,p.reviewed_at,p.review_note,p.deleted_at
  from public.attendance_punches p
  where p.deleted_at is null and p.company_id=(v_actor->>'company_id')::uuid
    and (p.user_id=(v_actor->>'id')::uuid
      or (v_actor->>'identity_source'='finance' and v_actor->>'role' in ('hr','admin_director','ceo')
        and private.hris_attendance_user_in_tenant_v1(p.user_id,p.company_id,(v_actor->>'tenant_id')::uuid)))
  order by p.punched_at desc,p.id desc
  limit least(greatest(coalesce(input_limit,200),1),500);
end;
$function$;
alter function public.hris_list_attendance_punches(uuid,text,text,integer) owner to postgres;
revoke all on function public.hris_list_attendance_punches(uuid,text,text,integer) from public,anon;
grant execute on function public.hris_list_attendance_punches(uuid,text,text,integer) to authenticated,service_role;

alter function public.hris_review_attendance_punch(uuid,text,text,uuid,text) set schema private;
revoke all on function private.hris_review_attendance_punch(uuid,text,text,uuid,text) from public,anon,authenticated,service_role;
create function public.hris_review_attendance_punch(input_user_id uuid, input_email text, input_role text, input_punch_id uuid, input_review_status text)
 RETURNS public.attendance_punches
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor jsonb; v_old public.attendance_punches%rowtype; v_row public.attendance_punches%rowtype;
begin
  v_actor:=private.hris_verified_attendance_actor_v1(input_user_id,input_email);
  if input_review_status is null or input_review_status not in ('approved','rejected') then
    raise exception 'Invalid punch review status' using errcode='22023';
  end if;
  if v_actor->>'identity_source' is distinct from 'finance' or coalesce(v_actor->>'role','') not in ('hr','admin_director','ceo') then
    raise exception 'Approved reviewer role required' using errcode='42501';
  end if;
  select * into v_old from public.attendance_punches p where p.id=input_punch_id
    and p.company_id=(v_actor->>'company_id')::uuid and p.deleted_at is null
    and private.hris_attendance_user_in_tenant_v1(p.user_id,p.company_id,(v_actor->>'tenant_id')::uuid) for update;
  if v_old.id is null or v_old.user_id=(v_actor->>'id')::uuid
    or exists(select 1 from public.users u where u.id=v_old.user_id and u.auth_user_id=(v_actor->>'auth_user_id')::uuid)
    or v_old.employee_id is not null and v_old.employee_id=(v_actor->>'employee_id')::uuid then
    raise exception 'Cannot review own punch or another company punch' using errcode='42501';
  end if;
  if v_old.review_status in ('approved','rejected') and v_old.review_status=input_review_status
    and v_old.reviewed_by=(v_actor->>'id')::uuid then return v_old; end if;
  if v_old.review_status is distinct from 'pending' then
    raise exception 'Punch review is stale or not pending' using errcode='40001';
  end if;
  v_row:=private.hris_review_attendance_punch((v_actor->>'id')::uuid,v_actor->>'email',
    v_actor->>'role',input_punch_id,input_review_status);
  insert into public.module_audit_logs(table_name,row_id,action,actor_email,before_data,after_data)
    values('attendance_punches',v_row.id::text,'ATTENDANCE_REVIEW',v_actor->>'email',
      jsonb_build_object('review_status',v_old.review_status),
      jsonb_build_object('actor',v_actor,'review_status',v_row.review_status,'reviewed_at',v_row.reviewed_at));
  return v_row;
end;
$function$;
alter function public.hris_review_attendance_punch(uuid,text,text,uuid,text) owner to postgres;
revoke all on function public.hris_review_attendance_punch(uuid,text,text,uuid,text) from public,anon;
grant execute on function public.hris_review_attendance_punch(uuid,text,text,uuid,text) to authenticated,service_role;

-- Raw punches and corrections must not be edited by browser clients. The old
-- self-update RLS is insufficient: a client could approve or rewrite timestamps.
revoke all on public.attendance_punches,public.punch_correction_requests from public,anon,authenticated;
grant select on public.attendance_punches,public.punch_correction_requests to authenticated;
alter table public.attendance_punches enable row level security;
alter table public.punch_correction_requests enable row level security;
-- A restrictive read policy also closes the old global is_hr_admin() policy.
-- This boolean-only helper is not an alternative mutation API.
create function private.hris_can_read_attendance_punch_v1(p_user_id uuid,p_company_id uuid)
returns boolean language plpgsql stable security definer set search_path=''
as $read$
declare v_actor public.finance_users%rowtype := public.current_finance_user();
begin
  if auth.uid() is null then return false; end if;
  if exists(select 1 from public.users u where u.id=p_user_id and u.company_id=p_company_id
      and u.auth_user_id=auth.uid() and private.hris_attendance_hr_identity_v1(u.id)) then return true; end if;
  if auth.uid() is null or v_actor.id is null or v_actor.active is distinct from true
    or v_actor.auth_user_id is distinct from auth.uid() or v_actor.tenant_id is distinct from public.current_tenant_id() then return false; end if;
  if not private.hris_attendance_company_in_tenant_v1(p_company_id,v_actor.tenant_id,v_actor.entity_id)
    or not private.hris_attendance_user_in_tenant_v1(p_user_id,p_company_id,v_actor.tenant_id) then return false; end if;
  return v_actor.role in ('hr','admin_director','ceo')
    or exists(select 1 from public.users u where u.id=p_user_id and u.auth_user_id=auth.uid());
end;
$read$;
alter function private.hris_can_read_attendance_punch_v1(uuid,uuid) owner to postgres;
revoke all on function private.hris_can_read_attendance_punch_v1(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function private.hris_can_read_attendance_punch_v1(uuid,uuid) to authenticated;
create policy attendance_tenant_read_boundary_v1 on public.attendance_punches as restrictive
for select to authenticated using(deleted_at is null and private.hris_can_read_attendance_punch_v1(user_id,company_id));
-- Correction read/workflow policy is deliberately not invented here. Without
-- an existing authorized policy it remains unavailable to browser roles.
do $postflight$
declare x record;
begin
  for x in select p.oid,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('hris_create_attendance_punch','hris_list_attendance_punches','hris_review_attendance_punches','hris_review_attendance_punch') loop
    if has_function_privilege('anon',x.oid,'EXECUTE') then raise exception 'Anonymous HRIS RPC remains executable'; end if;
  end loop;
  for x in select p.oid,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='private' and p.proname in ('hris_attendance_hr_identity_v1','hris_attendance_hr_company_tenant_v1',
      'hris_attendance_user_in_tenant_v1','hris_verified_attendance_actor_v1') loop
    if has_function_privilege('anon',x.oid,'EXECUTE') or has_function_privilege('authenticated',x.oid,'EXECUTE')
      or has_function_privilege('service_role',x.oid,'EXECUTE') then raise exception 'Attendance internal helper exposed: %',x.proname; end if;
  end loop;
  if not exists(select 1 from pg_policy where polrelid='public.attendance_punches'::regclass
      and polname='attendance_tenant_read_boundary_v1' and not polpermissive)
    or not exists(select 1 from pg_class where oid='public.attendance_punches'::regclass and relrowsecurity)
    then raise exception 'Attendance read boundary is missing'; end if;
  if has_table_privilege('authenticated','public.attendance_punches','UPDATE')
    or has_table_privilege('authenticated','public.attendance_punches','TRUNCATE')
    or has_table_privilege('anon','public.attendance_punches','SELECT') then raise exception 'Unsafe attendance table grants remain'; end if;
end;
$postflight$;
notify pgrst,'reload schema';
