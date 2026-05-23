-- Simplify launch punch rules to fixed-site employees only.
-- Complex homecare/daycare scheduling and remote punch policies are intentionally hidden for the first release.

with punch_rule_payload as (
  select
    company_id,
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
        jsonb_build_object('id','branch-admin','name','行政辦公室','type','company_branch','latitude',25.033,'longitude',121.5654,'radiusMeters',120,'address','台北市信義區松仁路 100 號','allowAbnormalSubmit',true)
      ),
      'networkRules', jsonb_build_array(
        jsonb_build_object('id','net-hq','branchName','總公司','allowedWifiSsids',jsonb_build_array('SuiYue-HQ','SuiYue-Admin'),'allowedIpAddresses',jsonb_build_array('203.0.113.18','203.0.113.19'),'forceRestriction',true,'allowAbnormalReview',true),
        jsonb_build_object('id','net-admin','branchName','行政辦公室','allowedWifiSsids',jsonb_build_array('SuiYue-Office','SuiYue-Admin'),'allowedIpAddresses',jsonb_build_array('198.51.100.24'),'forceRestriction',false,'allowAbnormalReview',true)
      ),
      'employeePolicies', jsonb_build_array(
        jsonb_build_object('employeeNo','E001','employeeName','潘雨柔','policyMode','fixed_site','primaryLocationRuleId','branch-hq','remoteAllowed',false,'radiusOverrideMeters',null,'note','預設總公司定點上班。'),
        jsonb_build_object('employeeNo','E002','employeeName','陳怡霖','policyMode','fixed_site','primaryLocationRuleId','branch-admin','remoteAllowed',false,'radiusOverrideMeters',null,'note','行政辦公室定點上班。')
      ),
      'legalNotes', jsonb_build_array(
        '目前版本僅開放定點上班人員打卡。',
        '一般週期每 7 日應有 1 日例假、1 日休息日。',
        '四週彈性工時每二週內至少 2 日例假，每四週例假加休息日至少 8 日。',
        '例假日出勤須符合天災、事變或突發事件等法定例外，系統預設阻擋任意打卡。'
      )
    ) as settings
  from public.system_settings
  where setting_key = 'punch_rules'
)
update public.system_settings target
set
  description = '固定據點 GPS 半徑、平假日與四週變形工時例休打卡規則。',
  settings = payload.settings,
  version = target.version + 1,
  updated_at = now()
from punch_rule_payload payload
where target.company_id = payload.company_id
  and target.setting_key = 'punch_rules';
