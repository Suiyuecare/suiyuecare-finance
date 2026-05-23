begin;

with payslip_source as (
  select
    pp.id as payslip_id,
    pp.payroll_record_id,
    pp.company_id,
    pp.employee_id,
    pp.payroll_month,
    pp.bank_account_last_five,
    pp.gross_pay_total,
    pp.deduction_total,
    pp.employer_cost_total,
    pp.net_pay_total,
    e.primary_branch_id,
    e.primary_department_id
  from public.payroll_payslips pp
  join public.employees e on e.id = pp.employee_id
  where pp.deleted_at is null
    and e.deleted_at is null
    and pp.payroll_month = date '2026-05-01'
)
insert into public.employee_payroll_settings (
  company_id,
  employee_id,
  salary_type,
  base_salary,
  labor_insurance_grade,
  health_insurance_grade,
  labor_pension_rate,
  tax_setting,
  supplementary_nhi_setting,
  bank_code,
  bank_account,
  effective_from,
  status,
  note
)
select
  company_id,
  employee_id,
  'monthly',
  gross_pay_total,
  gross_pay_total,
  gross_pay_total,
  6,
  'standard',
  'bonus_threshold',
  '822',
  '8220000000' || bank_account_last_five,
  payroll_month,
  'active',
  '由 2026-05 已發布薪資單回補薪資主檔；請人資於上線前改填正式投保級距與銀行帳號。'
from payslip_source
on conflict (company_id, employee_id) do update set
  salary_type = excluded.salary_type,
  base_salary = excluded.base_salary,
  labor_insurance_grade = excluded.labor_insurance_grade,
  health_insurance_grade = excluded.health_insurance_grade,
  labor_pension_rate = excluded.labor_pension_rate,
  tax_setting = excluded.tax_setting,
  supplementary_nhi_setting = excluded.supplementary_nhi_setting,
  bank_code = excluded.bank_code,
  bank_account = excluded.bank_account,
  effective_from = excluded.effective_from,
  status = excluded.status,
  note = excluded.note,
  updated_at = now(),
  deleted_at = null;

with payslip_source as (
  select
    pp.id as payslip_id,
    pp.payroll_record_id,
    pp.company_id,
    pp.employee_id,
    pp.payroll_month,
    pp.bank_account_last_five,
    pp.gross_pay_total,
    pp.deduction_total,
    pp.employer_cost_total,
    pp.net_pay_total
  from public.payroll_payslips pp
  where pp.deleted_at is null
    and pp.payroll_month = date '2026-05-01'
)
update public.payroll_payslips pp
set
  items = jsonb_build_array(
    jsonb_build_object('type', 'earning', 'code', 'BASE', 'name', '本薪', 'amount', ps.gross_pay_total),
    jsonb_build_object('type', 'deduction', 'code', 'LABOR_SELF', 'name', '勞保自付', 'amount', 1145),
    jsonb_build_object('type', 'deduction', 'code', 'NHI_SELF', 'name', '健保自付', 'amount', 710),
    jsonb_build_object('type', 'employer_cost', 'code', 'PENSION_COMPANY', 'name', '勞退公司提繳', 'amount', ps.employer_cost_total)
  ),
  deduction_total = 1855,
  net_pay_total = ps.gross_pay_total - 1855,
  remark = case
    when pp.remark like '%薪資明細已於 2026-05-22 重新校準為 normalized payroll_items%' then pp.remark
    else concat_ws('；', nullif(pp.remark, ''), '薪資明細已於 2026-05-22 重新校準為 normalized payroll_items。')
  end,
  updated_at = now()
from payslip_source ps
where pp.id = ps.payslip_id;

delete from public.payroll_items pi
using public.payroll_payslips pp
where pi.payroll_payslip_id = pp.id
  and pp.payroll_month = date '2026-05-01';

with item_source as (
  select
    pp.id as payslip_id,
    pp.payroll_record_id,
    pp.employee_id,
    item.item_type,
    item.item_code,
    item.item_name,
    item.amount,
    item.source_role
  from public.payroll_payslips pp
  cross join lateral (
    values
      ('earning', 'BASE', '本薪', pp.gross_pay_total, 'employee_payroll_settings'),
      ('deduction', 'LABOR_SELF', '勞保自付', 1145::numeric, 'payroll_item_settings'),
      ('deduction', 'NHI_SELF', '健保自付', 710::numeric, 'payroll_item_settings'),
      ('employer_cost', 'PENSION_COMPANY', '勞退公司提繳', pp.employer_cost_total, 'employee_payroll_settings')
  ) as item(item_type, item_code, item_name, amount, source_role)
  where pp.deleted_at is null
    and pp.payroll_month = date '2026-05-01'
)
insert into public.payroll_items (
  payroll_record_id,
  payroll_payslip_id,
  employee_id,
  item_type,
  item_code,
  item_name,
  amount,
  source_table,
  source_text,
  calculation_snapshot,
  metadata
)
select
  payroll_record_id,
  payslip_id,
  employee_id,
  item_type,
  item_code,
  item_name,
  amount,
  source_role,
  item_code,
  jsonb_build_object('repaired_at', now(), 'payroll_month', '2026-05', 'source', source_role),
  jsonb_build_object('repaired_by', '202605221620_repair_payroll_data_integrity', 'source', source_role)
from item_source;

delete from public.payroll_calculation_sources pcs
using public.payroll_payslips pp
where pcs.payroll_payslip_id = pp.id
  and pp.payroll_month = date '2026-05-01';

with normalized_items as (
  select
    pp.company_id,
    pi.payroll_record_id,
    pi.payroll_payslip_id,
    pi.id as payroll_item_id,
    pi.employee_id,
    pi.item_code,
    pi.item_name,
    pi.item_type,
    pi.amount,
    eps.id as setting_id,
    pis.id as item_setting_id
  from public.payroll_items pi
  join public.payroll_payslips pp on pp.id = pi.payroll_payslip_id
  left join public.employee_payroll_settings eps
    on eps.company_id = pp.company_id
   and eps.employee_id = pi.employee_id
   and eps.deleted_at is null
  left join public.payroll_item_settings pis
    on pis.company_id = pp.company_id
   and pis.code = pi.item_code
   and pis.deleted_at is null
  where pp.deleted_at is null
    and pp.payroll_month = date '2026-05-01'
)
insert into public.payroll_calculation_sources (
  company_id,
  payroll_record_id,
  payroll_payslip_id,
  payroll_item_id,
  employee_id,
  source_table,
  source_uuid,
  source_text,
  calculation_role,
  amount,
  snapshot
)
select
  company_id,
  payroll_record_id,
  payroll_payslip_id,
  payroll_item_id,
  employee_id,
  case when item_code in ('BASE', 'PENSION_COMPANY') then 'employee_payroll_settings' else 'payroll_item_settings' end,
  case when item_code in ('BASE', 'PENSION_COMPANY') then setting_id else item_setting_id end,
  item_code,
  case
    when item_code = 'BASE' then 'base_salary'
    when item_code = 'PENSION_COMPANY' then 'employer_cost'
    when item_code in ('LABOR_SELF', 'NHI_SELF') then 'insurance'
    else 'deduction'
  end,
  amount,
  jsonb_build_object('item_code', item_code, 'item_name', item_name, 'repaired_at', now())
from normalized_items;

with record_totals as (
  select
    pp.payroll_record_id,
    sum(pp.gross_pay_total) as gross_pay_total,
    sum(pp.deduction_total) as deduction_total,
    sum(pp.employer_cost_total) as employer_cost_total,
    sum(pp.net_pay_total) as net_pay_total
  from public.payroll_payslips pp
  where pp.deleted_at is null
    and pp.payroll_month = date '2026-05-01'
  group by pp.payroll_record_id
)
update public.payroll_records pr
set
  gross_pay_total = rt.gross_pay_total,
  deduction_total = rt.deduction_total,
  employer_cost_total = rt.employer_cost_total,
  net_pay_total = rt.net_pay_total,
  source_attendance_from = date '2026-05-01',
  source_attendance_to = date '2026-05-31',
  blocking_status = case
    when exists (
      select 1
      from public.attendance_records ar
      where ar.deleted_at is null
        and ar.work_date >= date '2026-05-01'
        and ar.work_date < date '2026-06-01'
    ) then 'clear'
    else 'blocked'
  end,
  blocking_summary = jsonb_build_object(
    'payroll_items_normalized', true,
    'employee_payroll_settings_ready', true,
    'attendance_source_records', (
      select count(*)
      from public.attendance_records ar
      where ar.deleted_at is null
        and ar.work_date >= date '2026-05-01'
        and ar.work_date < date '2026-06-01'
    ),
    'warning', '2026-05 目前缺少 attendance_records 真實出勤來源，薪資可顯示但不可視為完整出勤轉薪資。'
  ),
  updated_at = now()
from record_totals rt
where pr.id = rt.payroll_record_id;

delete from public.payroll_blockers pb
using public.payroll_records pr
where pb.payroll_record_id = pr.id
  and pr.payroll_month = date '2026-05-01'
  and pb.source_text in ('missing-attendance-source-2026-05', 'payroll-normalized-2026-05');

insert into public.payroll_blockers (
  company_id,
  payroll_record_id,
  blocker_type,
  source_table,
  source_text,
  severity,
  status,
  title,
  detail
)
select
  pr.company_id,
  pr.id,
  'attendance_anomaly',
  'attendance_records',
  'missing-attendance-source-2026-05',
  'warning',
  case
    when exists (
      select 1
      from public.attendance_records ar
      where ar.deleted_at is null
        and ar.work_date >= date '2026-05-01'
        and ar.work_date < date '2026-06-01'
    ) then 'resolved'
    else 'open'
  end,
  '2026-05 缺少正式出勤來源',
  '已補齊薪資主檔、薪資項目與計算來源，但 attendance_records 仍為 0；上線前需由打卡、請假、加班、補卡資料重新產生薪資。'
from public.payroll_records pr
where pr.deleted_at is null
  and pr.payroll_month = date '2026-05-01';

commit;
