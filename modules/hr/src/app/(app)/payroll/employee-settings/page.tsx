"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useEffect, useMemo, useState } from "react";
import {
  BadgeDollarSign,
  Banknote,
  Building2,
  CheckCircle2,
  CreditCard,
  HandCoins,
  Landmark,
  Loader2,
  Pencil,
  RefreshCcw,
  Save,
  ShieldCheck,
  UserRoundCog,
  WalletCards,
} from "lucide-react";
import { canViewIndividualPayrollData } from "@/lib/auth/privacy";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

type SalaryType = "月薪" | "時薪" | "日薪" | "件計";
type DbSalaryType = "monthly" | "hourly" | "daily" | "piece_rate";
type TaxSetting = "標準扣繳" | "固定稅率" | "免扣繳" | "依員工申報";
type DbTaxSetting = "standard" | "fixed_rate" | "exempt" | "employee_declaration";
type SupplementaryNhiSetting = "不啟用" | "獎金達門檻計算" | "兼職所得計算" | "全部啟用";
type DbSupplementaryNhiSetting = "disabled" | "bonus_threshold" | "part_time_income" | "all_enabled";

type EmployeeRow = {
  id: string;
  employee_no: string;
  full_name: string;
  employment_status: string;
  labor_insurance_salary: number | string | null;
  health_insurance_salary: number | string | null;
  departments: { name: string | null } | null;
  branches: { name: string | null } | null;
};

type PayrollSettingRow = {
  id: string;
  employee_id: string;
  company_id: string;
  salary_type: DbSalaryType;
  base_salary: number | string;
  meal_allowance: number | string;
  position_allowance: number | string;
  license_allowance: number | string;
  transportation_allowance: number | string;
  attendance_bonus: number | string;
  supervisor_allowance: number | string;
  labor_insurance_grade: number | string;
  health_insurance_grade: number | string;
  labor_pension_rate: number | string;
  tax_setting: DbTaxSetting;
  supplementary_nhi_setting: DbSupplementaryNhiSetting;
  bank_code: string | null;
  bank_account: string | null;
  bank_account_last_five: string | null;
  effective_from: string;
  effective_to: string | null;
  status: "draft" | "active" | "inactive";
  note: string | null;
  updated_at: string;
  employees: EmployeeRow | null;
};

type PayrollSetting = {
  id: string;
  employeeId: string;
  employeeNo: string;
  employeeName: string;
  department: string;
  branch: string;
  salaryType: SalaryType;
  baseSalary: number;
  mealAllowance: number;
  positionAllowance: number;
  licenseAllowance: number;
  transportationAllowance: number;
  attendanceBonus: number;
  supervisorAllowance: number;
  laborInsuranceGrade: string;
  healthInsuranceGrade: string;
  laborPensionRate: number;
  taxSetting: TaxSetting;
  supplementaryNhiSetting: SupplementaryNhiSetting;
  bankCode: string;
  bankAccount: string;
  bankAccountLastFive: string;
  effectiveFrom: string;
  status: "draft" | "active" | "inactive";
  note: string;
  updatedAt: string;
};

type PayrollForm = {
  employeeId: string;
  salaryType: SalaryType;
  baseSalary: number;
  mealAllowance: number;
  positionAllowance: number;
  licenseAllowance: number;
  transportationAllowance: number;
  attendanceBonus: number;
  supervisorAllowance: number;
  laborInsuranceGrade: string;
  healthInsuranceGrade: string;
  laborPensionRate: number;
  taxSetting: TaxSetting;
  supplementaryNhiSetting: SupplementaryNhiSetting;
  bankCode: string;
  bankAccount: string;
  effectiveFrom: string;
  status: "draft" | "active" | "inactive";
  note: string;
};

const salaryTypes: SalaryType[] = ["月薪", "時薪", "日薪", "件計"];
const taxSettings: TaxSetting[] = ["標準扣繳", "固定稅率", "免扣繳", "依員工申報"];
const supplementaryNhiSettings: SupplementaryNhiSetting[] = ["不啟用", "獎金達門檻計算", "兼職所得計算", "全部啟用"];
const laborInsuranceGrades = ["27600", "28800", "30300", "31800", "33300", "34800", "36300", "38200", "40100", "42000", "43900", "45800"];
const healthInsuranceGrades = ["27600", "28800", "30300", "31800", "33300", "34800", "36300", "38200", "40100", "42000", "43900", "45800"];

const salaryTypeToDb: Record<SalaryType, DbSalaryType> = { 月薪: "monthly", 時薪: "hourly", 日薪: "daily", 件計: "piece_rate" };
const salaryTypeFromDb: Record<DbSalaryType, SalaryType> = { monthly: "月薪", hourly: "時薪", daily: "日薪", piece_rate: "件計" };
const taxToDb: Record<TaxSetting, DbTaxSetting> = { 標準扣繳: "standard", 固定稅率: "fixed_rate", 免扣繳: "exempt", 依員工申報: "employee_declaration" };
const taxFromDb: Record<DbTaxSetting, TaxSetting> = { standard: "標準扣繳", fixed_rate: "固定稅率", exempt: "免扣繳", employee_declaration: "依員工申報" };
const nhiToDb: Record<SupplementaryNhiSetting, DbSupplementaryNhiSetting> = { 不啟用: "disabled", 獎金達門檻計算: "bonus_threshold", 兼職所得計算: "part_time_income", 全部啟用: "all_enabled" };
const nhiFromDb: Record<DbSupplementaryNhiSetting, SupplementaryNhiSetting> = { disabled: "不啟用", bonus_threshold: "獎金達門檻計算", part_time_income: "兼職所得計算", all_enabled: "全部啟用" };

const allowanceFields: Array<[keyof Pick<PayrollForm, "baseSalary" | "mealAllowance" | "positionAllowance" | "licenseAllowance" | "transportationAllowance" | "attendanceBonus" | "supervisorAllowance">, string]> = [
  ["baseSalary", "本薪"],
  ["mealAllowance", "伙食津貼"],
  ["positionAllowance", "職務津貼"],
  ["licenseAllowance", "證照津貼"],
  ["transportationAllowance", "交通津貼"],
  ["attendanceBonus", "全勤獎金"],
  ["supervisorAllowance", "主管加給"],
];

function today() {
  return new Date().toISOString().slice(0, 10);
}

const defaultForm: PayrollForm = {
  employeeId: "",
  salaryType: "月薪",
  baseSalary: 40000,
  mealAllowance: 2400,
  positionAllowance: 0,
  licenseAllowance: 0,
  transportationAllowance: 0,
  attendanceBonus: 2000,
  supervisorAllowance: 0,
  laborInsuranceGrade: "42000",
  healthInsuranceGrade: "42000",
  laborPensionRate: 6,
  taxSetting: "標準扣繳",
  supplementaryNhiSetting: "獎金達門檻計算",
  bankCode: "",
  bankAccount: "",
  effectiveFrom: today(),
  status: "active",
  note: "",
};

function currency(value: number) {
  return new Intl.NumberFormat("zh-TW", { style: "currency", currency: "TWD", maximumFractionDigits: 0 }).format(value);
}

function maskBankAccount(bankCode: string, account: string, lastFive: string) {
  const digits = account.replace(/\D/g, "");
  if (!digits && !lastFive) return "未設定";
  const visible = lastFive || digits.slice(-5);
  return `${bankCode || "---"}-${"*".repeat(Math.max(digits.length - 5, 7))}${visible}`;
}

function monthlyFixedTotal(setting: PayrollSetting | PayrollForm) {
  return setting.baseSalary + setting.mealAllowance + setting.positionAllowance + setting.licenseAllowance + setting.transportationAllowance + setting.attendanceBonus + setting.supervisorAllowance;
}

function mapSetting(row: PayrollSettingRow): PayrollSetting {
  const employee = row.employees;
  return {
    id: row.id,
    employeeId: row.employee_id,
    employeeNo: employee?.employee_no ?? "未連結",
    employeeName: employee?.full_name ?? "未連結員工",
    department: employee?.departments?.name ?? "未設定部門",
    branch: employee?.branches?.name ?? "未設定據點",
    salaryType: salaryTypeFromDb[row.salary_type],
    baseSalary: Number(row.base_salary ?? 0),
    mealAllowance: Number(row.meal_allowance ?? 0),
    positionAllowance: Number(row.position_allowance ?? 0),
    licenseAllowance: Number(row.license_allowance ?? 0),
    transportationAllowance: Number(row.transportation_allowance ?? 0),
    attendanceBonus: Number(row.attendance_bonus ?? 0),
    supervisorAllowance: Number(row.supervisor_allowance ?? 0),
    laborInsuranceGrade: String(Number(row.labor_insurance_grade ?? 0)),
    healthInsuranceGrade: String(Number(row.health_insurance_grade ?? 0)),
    laborPensionRate: Number(row.labor_pension_rate ?? 6),
    taxSetting: taxFromDb[row.tax_setting],
    supplementaryNhiSetting: nhiFromDb[row.supplementary_nhi_setting],
    bankCode: row.bank_code ?? "",
    bankAccount: row.bank_account ?? "",
    bankAccountLastFive: row.bank_account_last_five ?? "",
    effectiveFrom: row.effective_from,
    status: row.status,
    note: row.note ?? "",
    updatedAt: new Date(row.updated_at).toLocaleString("zh-TW", { hour12: false }),
  };
}

function buildPayload(form: PayrollForm, companyId: string, userId: string) {
  return {
    company_id: companyId,
    employee_id: form.employeeId,
    salary_type: salaryTypeToDb[form.salaryType],
    base_salary: form.baseSalary,
    meal_allowance: form.mealAllowance,
    position_allowance: form.positionAllowance,
    license_allowance: form.licenseAllowance,
    transportation_allowance: form.transportationAllowance,
    attendance_bonus: form.attendanceBonus,
    supervisor_allowance: form.supervisorAllowance,
    labor_insurance_grade: Number(form.laborInsuranceGrade),
    health_insurance_grade: Number(form.healthInsuranceGrade),
    labor_pension_rate: form.laborPensionRate,
    tax_setting: taxToDb[form.taxSetting],
    supplementary_nhi_setting: nhiToDb[form.supplementaryNhiSetting],
    bank_code: form.bankCode.trim() || null,
    bank_account: form.bankAccount.replace(/\s/g, "") || null,
    effective_from: form.effectiveFrom,
    status: form.status,
    note: form.note.trim() || null,
    updated_by: userId,
  };
}

function canManagePayrollSettings(role: string) {
  return ["hr", "admin_director"].includes(role);
}

export default function EmployeePayrollSettingsPage() {
  const currentUser = useCurrentUser();
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [settings, setSettings] = useState<PayrollSetting[]>([]);
  const [form, setForm] = useState<PayrollForm>(defaultForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [message, setMessage] = useState("員工薪資主檔會直接寫入 Supabase，並提供薪資結算、清冊與所得扣繳來源。");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const canViewPersonalPayroll = canViewIndividualPayrollData(currentUser);
  const canEditPayroll = canManagePayrollSettings(currentUser.role);
  const selectedEmployee = employees.find((employee) => employee.id === form.employeeId) ?? null;

  const stats = useMemo(
    () => ({
      employees: settings.length,
      active: settings.filter((item) => item.status === "active").length,
      monthly: settings.filter((item) => item.salaryType === "月薪").length,
      hourly: settings.filter((item) => item.salaryType === "時薪").length,
      averageFixed: settings.reduce((sum, item) => sum + monthlyFixedTotal(item), 0) / Math.max(settings.length, 1),
    }),
    [settings],
  );

  const writeAudit = async (action: string, resourceId: string | null, beforeData: unknown, afterData: unknown) => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase || !currentUser.companyId || !currentUser.id) return;
    await (supabase as any).from("audit_logs").insert({
      company_id: currentUser.companyId,
      actor_user_id: currentUser.id,
      action,
      resource_type: "employee_payroll_settings",
      resource_id: resourceId,
      before_data: beforeData,
      after_data: afterData,
      metadata: { page: "payroll/employee-settings" },
    });
  };

  const loadData = async () => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      setError("尚未設定 Supabase 連線，無法讀取員工薪資主檔。");
      setLoading(false);
      return;
    }
    if (!currentUser.companyId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");
    const [employeeResult, settingResult] = await Promise.all([
      (supabase as any)
        .from("employees")
        .select("id, employee_no, full_name, employment_status, labor_insurance_salary, health_insurance_salary, departments(name), branches(name)")
        .eq("company_id", currentUser.companyId)
        .is("deleted_at", null)
        .order("employee_no", { ascending: true }),
      (supabase as any)
        .from("employee_payroll_settings")
        .select("*, employees(id, employee_no, full_name, employment_status, departments(name), branches(name))")
        .eq("company_id", currentUser.companyId)
        .is("deleted_at", null)
        .order("status", { ascending: true })
        .order("updated_at", { ascending: false }),
    ]);

    if (employeeResult.error || settingResult.error) {
      setError(employeeResult.error?.message ?? settingResult.error?.message ?? "讀取 Supabase 失敗。");
      setMessage("請確認 employee_payroll_settings migration 與 RLS 已套用。");
      setLoading(false);
      return;
    }

    const nextEmployees = (employeeResult.data ?? []) as EmployeeRow[];
    const nextSettings = ((settingResult.data ?? []) as PayrollSettingRow[]).map(mapSetting);
    setEmployees(nextEmployees);
    setSettings(nextSettings);
    setForm((current) => ({ ...current, employeeId: current.employeeId || nextEmployees[0]?.id || "" }));
    setMessage(`已同步 Supabase 員工薪資主檔，共 ${nextSettings.length} 筆。`);
    setLoading(false);
  };

  useEffect(() => {
    void loadData();
  }, [currentUser.companyId]);

  const updateForm = <K extends keyof PayrollForm>(key: K, value: PayrollForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setError("");
  };

  const resetForm = () => {
    setEditingId(null);
    setForm({ ...defaultForm, employeeId: employees[0]?.id ?? "" });
    setError("");
  };

  const saveSetting = async () => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase || !currentUser.companyId) {
      setError("尚未登入公司帳號，無法儲存薪資主檔。");
      return;
    }
    if (!canEditPayroll) {
      setError("只有人資與行政主任可以維護員工個別薪資主檔。");
      return;
    }
    if (!form.employeeId || !form.bankCode.trim() || !form.bankAccount.trim()) {
      setError("請選擇員工並填寫銀行代碼與銀行帳號，避免薪資清冊資料不完整。");
      return;
    }
    if (form.baseSalary < 0 || form.laborPensionRate < 6) {
      setError("本薪不可小於 0；勞退公司提繳比例不得低於 6%。");
      return;
    }

    setSaving(true);
    const previous = editingId ? settings.find((item) => item.id === editingId) ?? null : null;
    const payload = buildPayload(form, currentUser.companyId, currentUser.id);
    const mutation = editingId
      ? (supabase as any).from("employee_payroll_settings").update(payload).eq("id", editingId).select("*, employees(id, employee_no, full_name, employment_status, departments(name), branches(name))").single()
      : (supabase as any).from("employee_payroll_settings").upsert({ ...payload, created_by: currentUser.id }, { onConflict: "company_id,employee_id" }).select("*, employees(id, employee_no, full_name, employment_status, departments(name), branches(name))").single();

    const { data, error: mutationError } = await mutation;
    if (mutationError) {
      setError(mutationError.message);
      setSaving(false);
      return;
    }

    await (supabase as any)
      .from("employees")
      .update({
        labor_insurance_salary: Number(form.laborInsuranceGrade),
        health_insurance_salary: Number(form.healthInsuranceGrade),
        pension_salary: Number(form.laborInsuranceGrade),
      })
      .eq("id", form.employeeId);

    await writeAudit(editingId ? "employee_payroll_setting.update" : "employee_payroll_setting.upsert", data.id, previous, data);
    await loadData();
    setMessage(`已儲存 ${data.employees?.full_name ?? selectedEmployee?.full_name ?? "員工"} 的薪資主檔，並同步員工投保級距。`);
    resetForm();
    setSaving(false);
  };

  const editSetting = (setting: PayrollSetting) => {
    setEditingId(setting.id);
    setForm({
      employeeId: setting.employeeId,
      salaryType: setting.salaryType,
      baseSalary: setting.baseSalary,
      mealAllowance: setting.mealAllowance,
      positionAllowance: setting.positionAllowance,
      licenseAllowance: setting.licenseAllowance,
      transportationAllowance: setting.transportationAllowance,
      attendanceBonus: setting.attendanceBonus,
      supervisorAllowance: setting.supervisorAllowance,
      laborInsuranceGrade: setting.laborInsuranceGrade,
      healthInsuranceGrade: setting.healthInsuranceGrade,
      laborPensionRate: setting.laborPensionRate,
      taxSetting: setting.taxSetting,
      supplementaryNhiSetting: setting.supplementaryNhiSetting,
      bankCode: setting.bankCode,
      bankAccount: setting.bankAccount,
      effectiveFrom: setting.effectiveFrom,
      status: setting.status,
      note: setting.note,
    });
    setMessage(`正在編輯 ${setting.employeeName} 的薪資主檔。`);
    setError("");
  };

  const toggleStatus = async (setting: PayrollSetting) => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase || !canEditPayroll) {
      setError("只有人資與行政主任可以啟用或停用薪資主檔。");
      return;
    }
    const nextStatus = setting.status === "active" ? "inactive" : "active";
    setSaving(true);
    const { data, error: mutationError } = await (supabase as any)
      .from("employee_payroll_settings")
      .update({ status: nextStatus, updated_by: currentUser.id })
      .eq("id", setting.id)
      .select("*")
      .single();
    if (mutationError) {
      setError(mutationError.message);
      setSaving(false);
      return;
    }
    await writeAudit(nextStatus === "active" ? "employee_payroll_setting.activate" : "employee_payroll_setting.deactivate", setting.id, setting, data);
    await loadData();
    setMessage(`${setting.employeeName} 的薪資主檔已${nextStatus === "active" ? "啟用" : "停用"}。`);
    setSaving(false);
  };

  const statCards = [
    { label: "已設定員工", value: `${stats.employees} 人`, icon: UserRoundCog, tone: "bg-emerald-50 text-emerald-700" },
    { label: "啟用中", value: `${stats.active} 人`, icon: CheckCircle2, tone: "bg-teal-50 text-teal-700" },
    { label: "月薪人員", value: `${stats.monthly} 人`, icon: WalletCards, tone: "bg-sky-50 text-sky-700" },
    { label: "平均固定成本", value: currency(stats.averageFixed), icon: HandCoins, tone: "bg-amber-50 text-amber-700" },
  ];

  if (!canViewPersonalPayroll) {
    return (
      <div className="space-y-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-medium text-sky-700">Payroll Aggregate View</p>
            <h1 className="text-2xl font-semibold text-slate-950">薪資設定彙總</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
              你可以查看薪資制度覆蓋率、薪資型態分布與平均固定成本；個人本薪、津貼、銀行帳號與編輯功能僅開放人資與行政薪資權限。
            </p>
          </div>
          <button onClick={() => void loadData()} disabled={loading} className="inline-flex items-center gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm font-semibold text-sky-700 disabled:opacity-50">
            <RefreshCcw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            重新同步
          </button>
        </div>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {statCards.map((item) => (
            <div key={item.label} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-slate-500">{item.label}</p>
                <span className={`rounded-lg p-2 ${item.tone}`}><item.icon className="h-5 w-5" /></span>
              </div>
              <p className="mt-3 text-2xl font-semibold text-slate-950">{item.value}</p>
            </div>
          ))}
        </section>

        <section className="rounded-lg border border-sky-200 bg-sky-50 p-5 shadow-sm">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 h-5 w-5 text-sky-700" />
            <div>
              <h2 className="font-semibold text-sky-950">個人薪資主檔已依角色保護</h2>
              <p className="mt-1 text-sm leading-6 text-sky-800">主管與一般員工不會看到個人薪資設定；若要看總額，請使用薪資後台或薪資清冊彙總頁。</p>
            </div>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-medium text-emerald-700">Payroll Profile</p>
          <h1 className="text-2xl font-semibold text-slate-950">員工薪資資料設定</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-500">維護薪資型態、本薪、津貼、勞保、健保、勞退、所得稅、二代健保與銀行帳號，供薪資結算與扣繳資料使用。</p>
        </div>
        <button onClick={() => void loadData()} disabled={loading || saving} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50">
          <RefreshCcw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          重新同步
        </button>
      </div>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {statCards.map((item) => (
          <div key={item.label} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-slate-500">{item.label}</p>
              <span className={`rounded-lg p-2 ${item.tone}`}><item.icon className="h-5 w-5" /></span>
            </div>
            <p className="mt-3 text-2xl font-semibold text-slate-950">{item.value}</p>
          </div>
        ))}
      </section>

      <section className="grid gap-5 xl:grid-cols-[0.82fr_1.18fr]">
        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">{editingId ? "編輯薪資主檔" : "新增薪資主檔"}</h2>
              <p className="text-sm text-slate-500">薪資主檔是正式結薪來源，變更會留稽核紀錄。</p>
            </div>
            {saving ? <Loader2 className="h-5 w-5 animate-spin text-emerald-600" /> : <BadgeDollarSign className="h-5 w-5 text-emerald-600" />}
          </div>

          <div className={`mb-4 rounded-lg px-3 py-2 text-sm font-semibold ${error ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700"}`}>
            {error || message}
          </div>

          <div className="grid gap-4">
            <label className="space-y-1 text-sm font-medium text-slate-700">
              員工
              <select value={form.employeeId} onChange={(event) => updateForm("employeeId", event.target.value)} disabled={!canEditPayroll || saving || Boolean(editingId)} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm disabled:bg-slate-50">
                <option value="">請選擇員工</option>
                {employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.employee_no} · {employee.full_name}</option>)}
              </select>
              {selectedEmployee && <span className="text-xs text-slate-500">{selectedEmployee.departments?.name ?? "未設定部門"} · {selectedEmployee.branches?.name ?? "未設定據點"}</span>}
            </label>

            <div className="grid gap-3 md:grid-cols-2">
              <label className="space-y-1 text-sm font-medium text-slate-700">
                薪資型態
                <select value={form.salaryType} onChange={(event) => updateForm("salaryType", event.target.value as SalaryType)} disabled={!canEditPayroll || saving} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm disabled:bg-slate-50">
                  {salaryTypes.map((type) => <option key={type}>{type}</option>)}
                </select>
              </label>
              <label className="space-y-1 text-sm font-medium text-slate-700">
                生效日
                <input type="date" value={form.effectiveFrom} onChange={(event) => updateForm("effectiveFrom", event.target.value)} disabled={!canEditPayroll || saving} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm disabled:bg-slate-50" />
              </label>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              {allowanceFields.map(([key, label]) => (
                <label key={key} className="space-y-1 text-sm font-medium text-slate-700">
                  {label}
                  <input type="number" min="0" value={form[key]} onChange={(event) => updateForm(key, Number(event.target.value))} disabled={!canEditPayroll || saving} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm disabled:bg-slate-50" />
                </label>
              ))}
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <label className="space-y-1 text-sm font-medium text-slate-700">
                勞保投保級距
                <select value={form.laborInsuranceGrade} onChange={(event) => updateForm("laborInsuranceGrade", event.target.value)} disabled={!canEditPayroll || saving} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm disabled:bg-slate-50">
                  {laborInsuranceGrades.map((grade) => <option key={grade} value={grade}>{currency(Number(grade))}</option>)}
                </select>
              </label>
              <label className="space-y-1 text-sm font-medium text-slate-700">
                健保投保級距
                <select value={form.healthInsuranceGrade} onChange={(event) => updateForm("healthInsuranceGrade", event.target.value)} disabled={!canEditPayroll || saving} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm disabled:bg-slate-50">
                  {healthInsuranceGrades.map((grade) => <option key={grade} value={grade}>{currency(Number(grade))}</option>)}
                </select>
              </label>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <label className="space-y-1 text-sm font-medium text-slate-700">
                勞退提繳比例（%）
                <input type="number" min="6" step="1" value={form.laborPensionRate} onChange={(event) => updateForm("laborPensionRate", Number(event.target.value))} disabled={!canEditPayroll || saving} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm disabled:bg-slate-50" />
              </label>
              <label className="space-y-1 text-sm font-medium text-slate-700">
                所得稅設定
                <select value={form.taxSetting} onChange={(event) => updateForm("taxSetting", event.target.value as TaxSetting)} disabled={!canEditPayroll || saving} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm disabled:bg-slate-50">
                  {taxSettings.map((setting) => <option key={setting}>{setting}</option>)}
                </select>
              </label>
            </div>

            <label className="space-y-1 text-sm font-medium text-slate-700">
              二代健保設定
              <select value={form.supplementaryNhiSetting} onChange={(event) => updateForm("supplementaryNhiSetting", event.target.value as SupplementaryNhiSetting)} disabled={!canEditPayroll || saving} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm disabled:bg-slate-50">
                {supplementaryNhiSettings.map((setting) => <option key={setting}>{setting}</option>)}
              </select>
            </label>

            <div className="grid gap-3 md:grid-cols-[0.35fr_0.65fr]">
              <label className="space-y-1 text-sm font-medium text-slate-700">
                銀行代碼
                <input value={form.bankCode} onChange={(event) => updateForm("bankCode", event.target.value)} placeholder="例：808" disabled={!canEditPayroll || saving} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm disabled:bg-slate-50" />
              </label>
              <label className="space-y-1 text-sm font-medium text-slate-700">
                銀行帳號
                <input value={form.bankAccount} onChange={(event) => updateForm("bankAccount", event.target.value)} placeholder="例：123456789012" disabled={!canEditPayroll || saving} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm disabled:bg-slate-50" />
              </label>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <label className="space-y-1 text-sm font-medium text-slate-700">
                狀態
                <select value={form.status} onChange={(event) => updateForm("status", event.target.value as PayrollForm["status"])} disabled={!canEditPayroll || saving} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm disabled:bg-slate-50">
                  <option value="active">啟用</option>
                  <option value="draft">草稿</option>
                  <option value="inactive">停用</option>
                </select>
              </label>
              <label className="space-y-1 text-sm font-medium text-slate-700">
                備註
                <input value={form.note} onChange={(event) => updateForm("note", event.target.value)} disabled={!canEditPayroll || saving} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm disabled:bg-slate-50" />
              </label>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <button onClick={() => void saveSetting()} disabled={!canEditPayroll || saving || loading} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {editingId ? "儲存修改" : "儲存主檔"}
            </button>
            {editingId && <button onClick={resetForm} disabled={saving} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50">取消編輯</button>}
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 p-5">
            <h2 className="text-lg font-semibold text-slate-950">員工薪資主檔清單</h2>
            <p className="text-sm text-slate-500">銀行帳號只顯示末五碼；完整資料只留在 Supabase 主檔與稽核紀錄。</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1180px] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">員工</th>
                  <th className="px-4 py-3">薪資型態</th>
                  <th className="px-4 py-3">本薪</th>
                  <th className="px-4 py-3">津貼與獎金</th>
                  <th className="px-4 py-3">勞健保 / 勞退</th>
                  <th className="px-4 py-3">稅務</th>
                  <th className="px-4 py-3">銀行帳號</th>
                  <th className="px-4 py-3">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr><td colSpan={8} className="px-4 py-10 text-center text-sm font-semibold text-slate-500"><Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin text-emerald-600" />正在同步 Supabase 薪資主檔</td></tr>
                ) : settings.length === 0 ? (
                  <tr><td colSpan={8} className="px-4 py-10 text-center text-sm text-slate-500">尚無員工薪資主檔，請選擇員工後新增。</td></tr>
                ) : settings.map((setting) => (
                  <tr key={setting.id} className="align-top hover:bg-slate-50">
                    <td className="px-4 py-4">
                      <p className="font-semibold text-slate-950">{setting.employeeName}</p>
                      <p className="text-xs text-slate-500">{setting.employeeNo}</p>
                      <p className="mt-1 text-xs text-slate-500">{setting.department} · {setting.branch}</p>
                    </td>
                    <td className="px-4 py-4">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${setting.status === "active" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{setting.salaryType} · {setting.status === "active" ? "啟用" : setting.status === "draft" ? "草稿" : "停用"}</span>
                      <p className="mt-2 text-xs text-slate-500">生效：{setting.effectiveFrom}</p>
                      <p className="text-xs text-slate-500">更新：{setting.updatedAt}</p>
                    </td>
                    <td className="px-4 py-4 font-semibold text-slate-800">{currency(setting.baseSalary)}</td>
                    <td className="px-4 py-4">
                      <div className="grid gap-1 text-xs text-slate-600">
                        <span>伙食津貼 {currency(setting.mealAllowance)}</span>
                        <span>職務津貼 {currency(setting.positionAllowance)}</span>
                        <span>證照津貼 {currency(setting.licenseAllowance)}</span>
                        <span>交通津貼 {currency(setting.transportationAllowance)}</span>
                        <span>全勤獎金 {currency(setting.attendanceBonus)}</span>
                        <span>主管加給 {currency(setting.supervisorAllowance)}</span>
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <div className="grid gap-1 text-xs text-slate-600">
                        <span>勞保投保級距 {currency(Number(setting.laborInsuranceGrade))}</span>
                        <span>健保投保級距 {currency(Number(setting.healthInsuranceGrade))}</span>
                        <span>勞退提繳比例 {setting.laborPensionRate}%</span>
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <div className="grid gap-1 text-xs text-slate-600">
                        <span>所得稅設定：{setting.taxSetting}</span>
                        <span>二代健保設定：{setting.supplementaryNhiSetting}</span>
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <span className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-700">
                        <CreditCard className="h-3.5 w-3.5" />
                        {maskBankAccount(setting.bankCode, setting.bankAccount, setting.bankAccountLastFive)}
                      </span>
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex flex-col gap-2">
                        <button onClick={() => editSetting(setting)} disabled={!canEditPayroll || saving} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                          <Pencil className="h-3.5 w-3.5" />編輯
                        </button>
                        <button onClick={() => void toggleStatus(setting)} disabled={!canEditPayroll || saving} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                          {setting.status === "active" ? "停用" : "啟用"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="grid gap-5 md:grid-cols-3">
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-5">
          <div className="mb-3 flex items-center gap-2"><Banknote className="h-5 w-5 text-emerald-700" /><h2 className="font-semibold text-emerald-900">固定薪資與津貼</h2></div>
          <p className="text-sm text-emerald-800">本薪、伙食津貼、職務津貼、證照津貼、交通津貼、全勤獎金與主管加給會進入薪資草稿。</p>
        </div>
        <div className="rounded-lg border border-sky-200 bg-sky-50 p-5">
          <div className="mb-3 flex items-center gap-2"><Landmark className="h-5 w-5 text-sky-700" /><h2 className="font-semibold text-sky-900">勞健保與勞退</h2></div>
          <p className="text-sm text-sky-800">薪資主檔會同步員工表的投保級距，供勞健保勞退計算模組使用。</p>
        </div>
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-5">
          <div className="mb-3 flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-amber-700" /><h2 className="font-semibold text-amber-900">個資與薪資保護</h2></div>
          <p className="text-sm text-amber-800">銀行帳號與薪資資料受角色權限、RLS、欄位遮罩與稽核紀錄保護，一般員工不能查看他人薪資。</p>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <Building2 className="mt-0.5 h-5 w-5 text-slate-700" />
          <div>
            <h2 className="font-semibold text-slate-950">薪資主檔已產品化</h2>
            <p className="mt-1 text-sm text-slate-500">此頁資料來源為 `employee_payroll_settings`，薪資結算前會檢查薪資主檔、薪資項目、出勤與補卡資料是否完整。</p>
          </div>
        </div>
      </section>
    </div>
  );
}
