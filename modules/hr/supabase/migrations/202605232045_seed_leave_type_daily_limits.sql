begin;

insert into public.system_settings (
  company_id,
  setting_key,
  category,
  display_name,
  description,
  settings,
  status,
  version,
  effective_from,
  updated_at
)
select
  companies.id,
  'leave_type_rules',
  'leave_rules',
  '假別管理規則',
  '假別支薪、扣全勤、單日最少申請分鐘、單日最多申請時數、年度額度與附件要求。',
  $json$
  {
    "version": 2,
    "dailyLimitPolicy": {
      "minimumUnitSource": "minimumUnitMinutes",
      "defaultMaxDailyHours": 8,
      "blocking": true
    },
    "rules": [
      { "id": "LT-001", "name": "特休", "isPaid": true, "payMode": "全薪", "deductAttendanceBonus": false, "minimumUnitMinutes": 60, "minimumUnitHours": 1, "maxDailyHours": 8, "annualQuotaHours": null, "attachmentRequirement": "不需附件", "attachmentNote": "依到職年資自動計算額度", "enabled": true },
      { "id": "LT-002", "name": "事假", "isPaid": false, "payMode": "不支薪", "deductAttendanceBonus": true, "minimumUnitMinutes": 60, "minimumUnitHours": 1, "maxDailyHours": 8, "annualQuotaHours": 112, "attachmentRequirement": "達門檻需附件", "attachmentNote": "連續 3 日以上需說明或附件", "enabled": true },
      { "id": "LT-003", "name": "病假", "isPaid": true, "payMode": "半薪", "deductAttendanceBonus": true, "minimumUnitMinutes": 60, "minimumUnitHours": 1, "maxDailyHours": 8, "annualQuotaHours": 240, "attachmentRequirement": "達門檻需附件", "attachmentNote": "連續或特定時數以上需診斷證明", "enabled": true },
      { "id": "LT-004", "name": "生理假", "isPaid": true, "payMode": "半薪", "deductAttendanceBonus": false, "minimumUnitMinutes": 480, "minimumUnitHours": 8, "maxDailyHours": 8, "annualQuotaHours": 24, "attachmentRequirement": "不需附件", "attachmentNote": "每月以 1 日為常用門檻", "enabled": true },
      { "id": "LT-005", "name": "婚假", "isPaid": true, "payMode": "全薪", "deductAttendanceBonus": false, "minimumUnitMinutes": 480, "minimumUnitHours": 8, "maxDailyHours": 8, "annualQuotaHours": 64, "attachmentRequirement": "必須附件", "attachmentNote": "需上傳結婚證明文件", "enabled": true },
      { "id": "LT-006", "name": "喪假", "isPaid": true, "payMode": "全薪", "deductAttendanceBonus": false, "minimumUnitMinutes": 480, "minimumUnitHours": 8, "maxDailyHours": 8, "annualQuotaHours": null, "attachmentRequirement": "必須附件", "attachmentNote": "依親等設定可請額度", "enabled": true },
      { "id": "LT-007", "name": "產假", "isPaid": true, "payMode": "依規則", "deductAttendanceBonus": false, "minimumUnitMinutes": 480, "minimumUnitHours": 8, "maxDailyHours": 8, "annualQuotaHours": null, "attachmentRequirement": "必須附件", "attachmentNote": "需生產或醫療相關證明", "enabled": true },
      { "id": "LT-008", "name": "產檢假", "isPaid": true, "payMode": "全薪", "deductAttendanceBonus": false, "minimumUnitMinutes": 240, "minimumUnitHours": 4, "maxDailyHours": 8, "annualQuotaHours": 56, "attachmentRequirement": "達門檻需附件", "attachmentNote": "七日且薪資照給，必要時上傳產檢證明", "enabled": true },
      { "id": "LT-009", "name": "陪產檢及陪產假", "isPaid": true, "payMode": "全薪", "deductAttendanceBonus": false, "minimumUnitMinutes": 240, "minimumUnitHours": 4, "maxDailyHours": 8, "annualQuotaHours": 56, "attachmentRequirement": "必須附件", "attachmentNote": "七日且薪資照給，需出生、配偶生產或產檢證明", "enabled": true },
      { "id": "LT-010", "name": "公假", "isPaid": true, "payMode": "全薪", "deductAttendanceBonus": false, "minimumUnitMinutes": 60, "minimumUnitHours": 1, "maxDailyHours": 8, "annualQuotaHours": null, "attachmentRequirement": "必須附件", "attachmentNote": "需公文、派訓或主管核准文件", "enabled": true },
      { "id": "LT-011", "name": "補休", "isPaid": true, "payMode": "全薪", "deductAttendanceBonus": false, "minimumUnitMinutes": 30, "minimumUnitHours": 0.5, "maxDailyHours": 8, "annualQuotaHours": null, "attachmentRequirement": "不需附件", "attachmentNote": "由加班轉補休額度控管", "enabled": true },
      { "id": "LT-012", "name": "家庭照顧假", "isPaid": false, "payMode": "不支薪", "deductAttendanceBonus": false, "minimumUnitMinutes": 60, "minimumUnitHours": 1, "maxDailyHours": 8, "annualQuotaHours": 56, "attachmentRequirement": "達門檻需附件", "attachmentNote": "全年七日併入事假計算，但不得影響全勤、考績或不利處分", "enabled": true },
      { "id": "LT-013", "name": "防疫照顧假", "isPaid": false, "payMode": "依規則", "deductAttendanceBonus": false, "minimumUnitMinutes": 60, "minimumUnitHours": 1, "maxDailyHours": 8, "annualQuotaHours": null, "attachmentRequirement": "必須附件", "attachmentNote": "需隔離、停課或主管機關文件", "enabled": true },
      { "id": "LT-014", "name": "育嬰留職停薪", "isPaid": false, "payMode": "不支薪", "deductAttendanceBonus": false, "minimumUnitMinutes": 480, "minimumUnitHours": 8, "maxDailyHours": 8, "annualQuotaHours": null, "attachmentRequirement": "必須附件", "attachmentNote": "任職滿六個月且子女未滿三歲，連動員工狀態與復職", "enabled": true }
    ]
  }
  $json$::jsonb,
  'active',
  1,
  current_date,
  now()
from public.companies
where companies.deleted_at is null
on conflict (company_id, setting_key) do nothing;

commit;
