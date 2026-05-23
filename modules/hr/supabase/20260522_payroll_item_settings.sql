create or replace function public.can_manage_payroll()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    public.current_role_key() in ('super_admin','company_admin','hr_manager','hr_staff','accountant','hr','admin_director','ceo'),
    false
  )
$$;

create table if not exists public.payroll_item_settings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  code text not null,
  name text not null,
  category text not null
    check (category in ('fixed_earning','variable_earning','fixed_deduction','variable_deduction','employer_cost','employee_contribution')),
  calculation_basis text not null
    check (calculation_basis in ('fixed_amount','attendance','overtime','rate_table','percentage','manual')),
  default_amount numeric(14,2) not null default 0,
  taxable boolean not null default true,
  include_in_insurance_wage boolean not null default false,
  is_active boolean not null default true,
  legal_basis text,
  description text,
  created_by uuid references public.users(id),
  updated_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique(company_id, code)
);

create index if not exists idx_payroll_item_settings_company on public.payroll_item_settings(company_id, is_active, deleted_at);
create index if not exists idx_payroll_item_settings_category on public.payroll_item_settings(company_id, category);

drop trigger if exists trg_payroll_item_settings_updated_at on public.payroll_item_settings;
create trigger trg_payroll_item_settings_updated_at before update on public.payroll_item_settings
for each row execute function public.set_updated_at();

alter table public.payroll_item_settings enable row level security;

drop policy if exists "payroll managers can view company payroll item settings" on public.payroll_item_settings;
create policy "payroll managers can view company payroll item settings"
on public.payroll_item_settings for select
to authenticated
using (
  public.can_manage_payroll()
  and deleted_at is null
  and company_id = (
    select users.company_id
    from public.users
    where users.auth_user_id = auth.uid()
      and users.deleted_at is null
    limit 1
  )
);

drop policy if exists "payroll managers can manage company payroll item settings" on public.payroll_item_settings;
create policy "payroll managers can manage company payroll item settings"
on public.payroll_item_settings for all
to authenticated
using (
  public.can_manage_payroll()
  and company_id = (
    select users.company_id
    from public.users
    where users.auth_user_id = auth.uid()
      and users.deleted_at is null
    limit 1
  )
)
with check (
  public.can_manage_payroll()
  and company_id = (
    select users.company_id
    from public.users
    where users.auth_user_id = auth.uid()
      and users.deleted_at is null
    limit 1
  )
);

insert into public.payroll_item_settings (
  company_id,
  code,
  name,
  category,
  calculation_basis,
  default_amount,
  taxable,
  include_in_insurance_wage,
  is_active,
  legal_basis,
  description
)
select
  companies.id,
  item.code,
  item.name,
  item.category,
  item.calculation_basis,
  item.default_amount,
  item.taxable,
  item.include_in_insurance_wage,
  true,
  item.legal_basis,
  item.description
from public.companies
cross join (
  values
    ('BASE', '本薪', 'fixed_earning', 'fixed_amount', 0::numeric, true, true, '勞動契約、工資清冊', '員工主要薪資基礎，依薪資型態與員工薪資設定帶入。'),
    ('OT', '加班費', 'variable_earning', 'overtime', 0::numeric, true, false, '勞動基準法第24條、第39條', '依平日、休息日、例假日、國定假日加班規則計算。'),
    ('ALLOWANCE', '津貼', 'fixed_earning', 'fixed_amount', 0::numeric, true, true, '勞動契約、公司薪資規則', '伙食津貼、職務津貼、證照津貼、交通津貼等可彙總或拆項。'),
    ('BONUS', '獎金', 'variable_earning', 'manual', 0::numeric, true, false, '公司獎金辦法或核准紀錄', '績效獎金、留任獎金或專案獎金。'),
    ('ATTENDANCE', '全勤', 'fixed_earning', 'attendance', 2000::numeric, true, true, '公司全勤獎金規則', '依出勤異常、請假扣全勤規則判斷。'),
    ('LEAVE_DEDUCT', '請假扣薪', 'variable_deduction', 'attendance', 0::numeric, false, false, '勞動基準法、性別平等工作法、公司假別規則', '依假別支薪比例與請假時數計算扣薪。'),
    ('LATE_DEDUCT', '遲到扣款', 'variable_deduction', 'attendance', 0::numeric, false, false, '公司出勤規則、工資扣款同意紀錄', '依遲到早退與公司扣款規則計算。'),
    ('LABOR_SELF', '勞保自付', 'employee_contribution', 'rate_table', 0::numeric, false, false, '勞工保險條例與級距表', '依勞保級距與員工負擔比例計算。'),
    ('NHI_SELF', '健保自付', 'employee_contribution', 'rate_table', 0::numeric, false, false, '全民健康保險法與級距表', '依健保級距、眷屬人數與員工負擔比例計算。'),
    ('PENSION_COMPANY', '勞退公司提繳', 'employer_cost', 'percentage', 0::numeric, false, false, '勞工退休金條例', '依勞退提繳工資與公司提繳比例計算。'),
    ('SUPPLEMENT_NHI', '補充保費', 'employee_contribution', 'rate_table', 0::numeric, false, false, '全民健康保險法補充保險費規定', '依二代健保補充保費規則計算。'),
    ('INCOME_TAX', '所得稅', 'fixed_deduction', 'percentage', 0::numeric, false, false, '所得稅法與扣繳辦法', '依員工所得稅設定與扣繳規則計算。')
) as item(code, name, category, calculation_basis, default_amount, taxable, include_in_insurance_wage, legal_basis, description)
where companies.deleted_at is null
on conflict (company_id, code) do nothing;
