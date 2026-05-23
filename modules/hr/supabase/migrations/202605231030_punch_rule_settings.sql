-- Persist backend-controlled punch rules for GPS radius, remote/fixed-site policies,
-- day-type rules, and four-week flexible workweek rest-day governance.

with first_company as (
  select id
  from public.companies
  where deleted_at is null
  order by created_at
  limit 1
),
punch_rule_payload as (
  select
    first_company.id as company_id,
    jsonb_build_object(
      'mode', 'four_week_flexible',
      'effectiveFrom', '2026-05-01',
      'fourWeekCycleStartDate', '2026-05-04',
      'regularHolidayWeekdays', jsonb_build_array('sunday'),
      'restDayWeekdays', jsonb_build_array('saturday'),
      'defaultPolicyMode', 'fixed_site',
      'defaultRadiusMeters', 120,
      'dayRules', jsonb_build_object(
        'weekday', jsonb_build_object(
          'label', '平日',
          'requireGps', true,
          'requireNetwork', false,
          'allowRemote', false,
          'blockIfOutside', false,
          'allowAbnormalReview', true,
          'radiusMeters', 120
        ),
        'rest_day', jsonb_build_object(
          'label', '休息日',
          'requireGps', true,
          'requireNetwork', false,
          'allowRemote', false,
          'blockIfOutside', false,
          'allowAbnormalReview', true,
          'radiusMeters', 120
        ),
        'regular_holiday', jsonb_build_object(
          'label', '例假日',
          'requireGps', true,
          'requireNetwork', true,
          'allowRemote', false,
          'blockIfOutside', true,
          'allowAbnormalReview', false,
          'radiusMeters', 120
        ),
        'national_holiday', jsonb_build_object(
          'label', '國定假日',
          'requireGps', true,
          'requireNetwork', false,
          'allowRemote', false,
          'blockIfOutside', false,
          'allowAbnormalReview', true,
          'radiusMeters', 120
        )
      ),
      'locationRules', jsonb_build_array(
        jsonb_build_object('id','branch-hq','name','總公司','type','company_branch','latitude',25.0478,'longitude',121.517,'radiusMeters',120,'address','台北市中正區仁愛路一段 1 號','allowAbnormalSubmit',true),
        jsonb_build_object('id','branch-homecare','name','台北居服站','type','company_branch','latitude',25.033,'longitude',121.5654,'radiusMeters',150,'address','台北市信義區松仁路 100 號','allowAbnormalSubmit',true),
        jsonb_build_object('id','case-a102','name','居服個案 A102 服務地點','type','homecare_service','latitude',25.0412,'longitude',121.5486,'radiusMeters',80,'address','台北市大安區忠孝東路四段 88 號','allowAbnormalSubmit',true)
      ),
      'networkRules', jsonb_build_array(
        jsonb_build_object('id','net-hq','branchName','總公司','allowedWifiSsids',jsonb_build_array('SuiYue-HQ','SuiYue-Admin'),'allowedIpAddresses',jsonb_build_array('203.0.113.18','203.0.113.19'),'forceRestriction',true,'allowAbnormalReview',true),
        jsonb_build_object('id','net-homecare','branchName','台北居服站','allowedWifiSsids',jsonb_build_array('SuiYue-Homecare','SuiYue-Mobile'),'allowedIpAddresses',jsonb_build_array('198.51.100.24'),'forceRestriction',false,'allowAbnormalReview',true),
        jsonb_build_object('id','net-case-a102','branchName','居服個案 A102 服務地點','allowedWifiSsids',jsonb_build_array('Case-A102-WiFi'),'allowedIpAddresses',jsonb_build_array('192.0.2.88'),'forceRestriction',false,'allowAbnormalReview',true)
      ),
      'employeePolicies', jsonb_build_array(
        jsonb_build_object('employeeNo','E001','employeeName','潘雨柔','policyMode','fixed_site','primaryLocationRuleId','branch-hq','remoteAllowed',false,'radiusOverrideMeters',null,'note','預設總公司定點上班。'),
        jsonb_build_object('employeeNo','E002','employeeName','陳怡霖','policyMode','remote_allowed','primaryLocationRuleId','branch-hq','remoteAllowed',true,'radiusOverrideMeters',300,'note','主管可遠端，超出據點仍需留下定位。'),
        jsonb_build_object('employeeNo','H001','employeeName','居服員範例','policyMode','field_service','primaryLocationRuleId','case-a102','remoteAllowed',false,'radiusOverrideMeters',80,'note','依服務排班地點打卡。')
      ),
      'legalNotes', jsonb_build_array(
        '一般週期每 7 日應有 1 日例假、1 日休息日。',
        '四週彈性工時每二週內至少 2 日例假，每四週例假加休息日至少 8 日。',
        '例假日出勤須符合天災、事變或突發事件等法定例外，系統預設阻擋任意打卡。'
      )
    ) as settings
  from first_company
)
insert into public.system_settings (
  company_id,
  setting_key,
  category,
  display_name,
  description,
  settings,
  status,
  effective_from
)
select
  company_id,
  'punch_rules',
  'punch_rules',
  '打卡規則',
  'GPS 半徑、定點/遠端/外勤、平假日與四週變形工時例休打卡規則。',
  settings,
  'active',
  current_date
from punch_rule_payload
on conflict (company_id, setting_key)
do update set
  category = excluded.category,
  display_name = excluded.display_name,
  description = excluded.description,
  settings = public.system_settings.settings || excluded.settings,
  status = 'active',
  version = public.system_settings.version + 1,
  updated_at = now();
