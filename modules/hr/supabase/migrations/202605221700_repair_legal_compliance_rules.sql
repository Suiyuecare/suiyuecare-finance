begin;

alter table public.system_settings
  add column if not exists description text,
  add column if not exists validation_schema jsonb not null default '{}'::jsonb,
  add column if not exists effective_from date,
  add column if not exists effective_to date;

insert into public.system_settings (
  company_id,
  setting_key,
  category,
  display_name,
  description,
  settings,
  validation_schema,
  status,
  version,
  effective_from
)
select
  companies.id,
  'legal_compliance_rules_2026',
  'system_parameters',
  '2026 台灣勞動法規合規規則',
  '勞動基準法、性別平等工作法與最低工資底線；低於法規的表單、排班、薪資與設定不得發布。',
  jsonb_build_object(
    'verified_at', '2026-05-22',
    'source_urls', jsonb_build_array(
      'https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=N0030001',
      'https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=N0030014',
      'https://www.mol.gov.tw/1607/28162/28166/28180/28182/28188/29022/?cprint=pt'
    ),
    'rules', jsonb_build_array(
      jsonb_build_object('code', 'LSA_WEEKLY_NORMAL_HOURS', 'law', '勞動基準法', 'article', '第30條', 'blocking', true, 'minimum', '每日正常工時 8 小時、每週 40 小時；超出需進加班流程。', 'enforced_at', jsonb_build_array('班別管理', '排班發布', '出勤異常', '薪資結算')),
      jsonb_build_object('code', 'LSA_OVERTIME_LIMIT', 'law', '勞動基準法', 'article', '第32條', 'blocking', true, 'minimum', '正常工時加延長工時每日不得超過 12 小時；一般每月延長工時不得超過 46 小時。', 'enforced_at', jsonb_build_array('加班申請', '排班防呆', '薪資結算')),
      jsonb_build_object('code', 'LSA_SHIFT_REST_INTERVAL', 'law', '勞動基準法', 'article', '第34條', 'blocking', true, 'minimum', '輪班換班至少連續 11 小時休息；例外需合法程序。', 'enforced_at', jsonb_build_array('班別管理', '排班月曆', '換班代班')),
      jsonb_build_object('code', 'LSA_REST_DAY', 'law', '勞動基準法', 'article', '第36條', 'blocking', true, 'minimum', '每 7 日應有 1 日例假與 1 日休息日；彈性制度需留程序紀錄。', 'enforced_at', jsonb_build_array('排班月曆', '居服排班', '日照排班')),
      jsonb_build_object('code', 'LSA_MINIMUM_WAGE_2026', 'law', '勞動基準法/最低工資法', 'article', '第21條', 'blocking', true, 'minimum', '2026-01-01 起月薪不得低於 29,500 元、時薪不得低於 196 元。', 'enforced_at', jsonb_build_array('員工薪資設定', '薪資結算', '薪資項目')),
      jsonb_build_object('code', 'GEEA_MENSTRUAL_LEAVE', 'law', '性別平等工作法', 'article', '第14條', 'blocking', true, 'minimum', '生理假每月 1 日，薪資不得低於半薪，不得作不利處分。', 'enforced_at', jsonb_build_array('假別管理', '請假申請', '薪資結算')),
      jsonb_build_object('code', 'GEEA_PRENATAL_PATERNITY_LEAVE', 'law', '性別平等工作法', 'article', '第15條', 'blocking', true, 'minimum', '產檢假 7 日、陪產檢及陪產假 7 日，薪資照給。', 'enforced_at', jsonb_build_array('假別管理', '請假申請', '薪資結算')),
      jsonb_build_object('code', 'GEEA_FAMILY_CARE', 'law', '性別平等工作法', 'article', '第20條、第21條', 'blocking', true, 'minimum', '家庭照顧假全年 7 日；不得拒絕、不得影響全勤、考績或為不利處分。', 'enforced_at', jsonb_build_array('假別管理', '請假申請', '員工異動')),
      jsonb_build_object('code', 'GEEA_SEXUAL_HARASSMENT_CHANNEL', 'law', '性別平等工作法', 'article', '第13條', 'blocking', true, 'minimum', '依員工人數建立申訴管道、防治措施、調查通知與保密流程。', 'enforced_at', jsonb_build_array('系統設定', '公告通知', '教育訓練'))
    )
  ),
  jsonb_build_object(
    'required_checks', jsonb_build_array('form_submit', 'schedule_publish', 'payroll_close', 'setting_publish'),
    'cannot_disable_blocking_rules', true
  ),
  'active',
  1,
  date '2026-01-01'
from public.companies
where companies.deleted_at is null
on conflict (company_id, setting_key) do update set
  display_name = excluded.display_name,
  description = excluded.description,
  settings = excluded.settings,
  validation_schema = excluded.validation_schema,
  status = 'active',
  version = public.system_settings.version + 1,
  effective_from = excluded.effective_from,
  updated_at = now(),
  deleted_at = null;

update public.system_settings
set
  settings = jsonb_set(
    jsonb_set(
      jsonb_set(
        settings,
        '{rules}',
        (
          select jsonb_agg(
            case
              when rule ->> 'name' = '陪產假' then rule || '{"name":"陪產檢及陪產假","annualQuotaHours":56,"deductAttendanceBonus":false,"payMode":"全薪"}'::jsonb
              when rule ->> 'name' = '留職停薪' then rule || '{"name":"育嬰留職停薪","deductAttendanceBonus":false}'::jsonb
              when rule ->> 'name' = '家庭照顧假' then rule || '{"deductAttendanceBonus":false,"annualQuotaHours":56}'::jsonb
              else rule
            end
          )
          from jsonb_array_elements(settings -> 'rules') as rule
        )
      ),
      '{verifiedAt}',
      to_jsonb('2026-05-22'::text),
      true
    ),
    '{source}',
    to_jsonb('legal_compliance_rules_2026'::text),
    true
  ),
  version = version + 1,
  updated_at = now()
where setting_key = 'leave_type_rules'
  and category = 'leave_rules'
  and deleted_at is null
  and jsonb_typeof(settings -> 'rules') = 'array';

commit;
