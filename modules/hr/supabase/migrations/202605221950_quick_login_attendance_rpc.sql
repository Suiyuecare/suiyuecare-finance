-- API-backed attendance punches for the card-login HRIS flow.

create or replace function public.hris_list_attendance_punches(
  input_user_id uuid,
  input_email text,
  input_role text,
  input_limit integer default 200
)
returns table (
  id uuid,
  company_id uuid,
  user_id uuid,
  employee_id uuid,
  punched_at timestamptz,
  punch_type text,
  latitude numeric,
  longitude numeric,
  address text,
  device_info text,
  wifi_ssid text,
  ip_address text,
  is_abnormal boolean,
  abnormal_reason text,
  rule_name text,
  passed_rule text,
  distance_meters integer,
  review_status text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  review_note text,
  deleted_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.users%rowtype;
  safe_limit integer := least(greatest(coalesce(input_limit, 200), 1), 500);
begin
  select *
  into actor
  from public.users
  where users.id = input_user_id
    and users.email = input_email
    and users.status = 'active'
    and users.deleted_at is null;

  if actor.id is null then
    raise exception 'Active HRIS user profile was not found.';
  end if;

  return query
  select
    punches.id,
    punches.company_id,
    punches.user_id,
    punches.employee_id,
    punches.punched_at,
    punches.punch_type,
    punches.latitude,
    punches.longitude,
    punches.address,
    punches.device_info,
    punches.wifi_ssid,
    punches.ip_address,
    punches.is_abnormal,
    punches.abnormal_reason,
    punches.rule_name,
    punches.passed_rule,
    punches.distance_meters,
    punches.review_status,
    punches.reviewed_by,
    punches.reviewed_at,
    punches.review_note,
    punches.deleted_at
  from public.attendance_punches punches
  where punches.deleted_at is null
    and punches.company_id = actor.company_id
    and (
      input_role in ('hr','admin_director','ceo')
      or punches.user_id = actor.id
    )
  order by punches.punched_at desc
  limit safe_limit;
end;
$$;

create or replace function public.hris_create_attendance_punch(
  input_user_id uuid,
  input_email text,
  input_punch_type text,
  input_latitude numeric,
  input_longitude numeric,
  input_address text,
  input_device_info text,
  input_wifi_ssid text,
  input_ip_address text,
  input_is_abnormal boolean,
  input_abnormal_reason text,
  input_rule_name text,
  input_passed_rule text,
  input_distance_meters integer,
  input_review_status text
)
returns public.attendance_punches
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.users%rowtype;
  inserted public.attendance_punches%rowtype;
begin
  select *
  into actor
  from public.users
  where users.id = input_user_id
    and users.email = input_email
    and users.status = 'active'
    and users.deleted_at is null;

  if actor.id is null then
    raise exception 'Active HRIS user profile was not found.';
  end if;

  if input_punch_type not in ('clock_in','clock_out','out','return') then
    raise exception 'Invalid punch type.';
  end if;

  if coalesce(input_review_status, 'none') not in ('none','pending','approved','rejected') then
    raise exception 'Invalid review status.';
  end if;

  insert into public.attendance_punches (
    company_id,
    user_id,
    employee_id,
    punch_type,
    latitude,
    longitude,
    address,
    device_info,
    wifi_ssid,
    ip_address,
    is_abnormal,
    abnormal_reason,
    rule_name,
    passed_rule,
    distance_meters,
    review_status
  )
  values (
    actor.company_id,
    actor.id,
    actor.employee_id,
    input_punch_type,
    input_latitude,
    input_longitude,
    nullif(input_address, ''),
    nullif(input_device_info, ''),
    nullif(input_wifi_ssid, ''),
    nullif(input_ip_address, ''),
    coalesce(input_is_abnormal, false),
    nullif(input_abnormal_reason, ''),
    nullif(input_rule_name, ''),
    nullif(input_passed_rule, ''),
    input_distance_meters,
    coalesce(input_review_status, 'none')
  )
  returning * into inserted;

  return inserted;
end;
$$;

create or replace function public.hris_review_attendance_punch(
  input_user_id uuid,
  input_email text,
  input_role text,
  input_punch_id uuid,
  input_review_status text
)
returns public.attendance_punches
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.users%rowtype;
  updated public.attendance_punches%rowtype;
begin
  select *
  into actor
  from public.users
  where users.id = input_user_id
    and users.email = input_email
    and users.status = 'active'
    and users.deleted_at is null;

  if actor.id is null then
    raise exception 'Active HRIS user profile was not found.';
  end if;

  if input_role not in ('hr','admin_director','ceo') then
    raise exception 'Only HR, admin director, or CEO can review abnormal punches.';
  end if;

  if input_review_status not in ('approved','rejected') then
    raise exception 'Invalid review status.';
  end if;

  update public.attendance_punches punches
  set
    review_status = input_review_status,
    reviewed_by = actor.id,
    reviewed_at = now(),
    review_note = case
      when input_review_status = 'approved' then '異常原因可接受，准予採認。'
      else '異常原因不足，請補打卡或重新說明。'
    end,
    abnormal_reason = concat_ws(
      '；',
      nullif(punches.abnormal_reason, ''),
      case
        when input_review_status = 'approved' then '人資已核准異常打卡'
        else '人資已退回異常打卡'
      end
    ),
    updated_at = now()
  where punches.id = input_punch_id
    and punches.company_id = actor.company_id
    and punches.deleted_at is null
  returning * into updated;

  if updated.id is null then
    raise exception 'Attendance punch was not found.';
  end if;

  return updated;
end;
$$;

revoke all on function public.hris_list_attendance_punches(uuid, text, text, integer) from public;
revoke all on function public.hris_create_attendance_punch(uuid, text, text, numeric, numeric, text, text, text, text, boolean, text, text, text, integer, text) from public;
revoke all on function public.hris_review_attendance_punch(uuid, text, text, uuid, text) from public;

grant execute on function public.hris_list_attendance_punches(uuid, text, text, integer) to anon, authenticated;
grant execute on function public.hris_create_attendance_punch(uuid, text, text, numeric, numeric, text, text, text, text, boolean, text, text, text, integer, text) to anon, authenticated;
grant execute on function public.hris_review_attendance_punch(uuid, text, text, uuid, text) to anon, authenticated;
