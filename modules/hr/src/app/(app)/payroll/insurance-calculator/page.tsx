"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  HeartPulse,
  Landmark,
  Loader2,
  Percent,
  RefreshCcw,
  Save,
  ShieldCheck,
  UsersRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import { can } from "@/lib/auth/rbac";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import {
  calculateInsurancePremiums,
  defaultHealthInsuranceGrades,
  defaultInsuranceRateSettings,
  defaultLaborInsuranceGrades,
  type InsuranceRateSettings,
} from "@/lib/payroll/insurance-calculation-service";

type EmployeePayrollSettingRow = {
  id: string;
  employee_id: string;
  salary_type: string;
  base_salary: number | string | null;
  meal_allowance: number | string | null;
  position_allowance: number | string | null;
  license_allowance: number | string | null;
  transportation_allowance: number | string | null;
  attendance_bonus: number | string | null;
  supervisor_allowance: number | string | null;
  labor_insurance_grade: number | string | null;
  health_insurance_grade: number | string | null;
  labor_pension_rate: number | string | null;
  supplementary_nhi_setting: string | null;
  effective_from: string | null;
  status: "draft" | "active" | "inactive";
  updated_at: string | null;
  employees: {
    id: string;
    employee_no: string;
    full_name: string;
    employment_status: string;
    labor_insurance_salary: number | string | null;
    health_insurance_salary: number | string | null;
    pension_salary: number | string | null;
    departments: { name: string | null } | null;
    branches: { name: string | null } | null;
  } | null;
};

type InsuranceLedgerRow = {
  settingId: string;
  employeeId: string;
  employeeNo: string;
  employeeName: string;
  branch: string;
  department: string;
  employmentStatus: string;
  status: string;
  salaryType: string;
  monthlyWage: number;
  laborGrade: number;
  healthGrade: number;
  pensionSalary: number;
  pensionRate: number;
  laborEmployeePremium: number;
  laborEmployerPremium: number;
  healthEmployeePremium: number;
  healthEmployerPremium: number;
  laborPensionEmployerContribution: number;
  employeePremiumTotal: number;
  employerCostTotal: number;
  effectiveFrom: string;
  updatedAt: string;
  risk: "正常" | "需補齊" | "低於法定";
  riskReason: string;
};

const settingKey = "insurance_pension_rate_settings";

const salaryTypeLabels: Record<string, string> = {
  monthly: "月薪",
  hourly: "時薪",
  daily: "日薪",
  piece_rate: "件計",
};

function currency(value: number) {
  return new Intl.NumberFormat("zh-TW", { style: "currency", currency: "TWD", maximumFractionDigits: 0 }).format(value);
}

function percent(value: number) {
  return `${(Number(value) * 100).toFixed(2)}%`;
}

function toNumber(value: number | string | null | undefined) {
  const next = Number(value ?? 0);
  return Number.isFinite(next) ? next : 0;
}

function fixedMonthlyWage(row: EmployeePayrollSettingRow): number {
  const wageItems: Array<number | string | null | undefined> = [
    row.base_salary,
    row.meal_allowance,
    row.position_allowance,
    row.license_allowance,
    row.transportation_allowance,
    row.attendance_bonus,
    row.supervisor_allowance,
  ];
  return wageItems.reduce<number>((total, value) => total + toNumber(value), 0);
}

function formatDate(value: string | null | undefined) {
  if (!value) return "未設定";
  return value.slice(0, 10);
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "未更新";
  return new Date(value).toLocaleString("zh-TW", { hour12: false });
}

function buildRisk(row: EmployeePayrollSettingRow, laborGrade: number, healthGrade: number, pensionRate: number) {
  const missing = [];
  if (!row.employee_id || !row.employees) missing.push("未連結員工");
  if (!laborGrade) missing.push("勞保級距");
  if (!healthGrade) missing.push("健保級距");
  if (!pensionRate) missing.push("勞退提繳率");
  if (missing.length) return { risk: "需補齊" as const, reason: `缺少：${missing.join("、")}` };
  if (pensionRate < 6) return { risk: "低於法定" as const, reason: "勞退公司提繳率不得低於 6%" };
  return { risk: "正常" as const, reason: "投保級距與勞退提繳資料完整" };
}

function mapLedger(row: EmployeePayrollSettingRow, rates: InsuranceRateSettings): InsuranceLedgerRow {
  const monthlyWage = fixedMonthlyWage(row);
  const laborGradeAmount = toNumber(row.labor_insurance_grade || row.employees?.labor_insurance_salary || monthlyWage);
  const healthGradeAmount = toNumber(row.health_insurance_grade || row.employees?.health_insurance_salary || monthlyWage);
  const pensionRate = toNumber(row.labor_pension_rate || 6);
  const calculation = calculateInsurancePremiums({
    monthlySalary: monthlyWage,
    dependents: 0,
    supplementaryIncome: 0,
    laborGrades: defaultLaborInsuranceGrades,
    healthGrades: defaultHealthInsuranceGrades,
    rates: {
      ...rates,
      laborPensionEmployerRate: pensionRate / 100,
    },
  });
  const risk = buildRisk(row, laborGradeAmount, healthGradeAmount, pensionRate);

  return {
    settingId: row.id,
    employeeId: row.employee_id,
    employeeNo: row.employees?.employee_no ?? "未連結",
    employeeName: row.employees?.full_name ?? "未連結員工",
    branch: row.employees?.branches?.name ?? "未設定據點",
    department: row.employees?.departments?.name ?? "未設定部門",
    employmentStatus: row.employees?.employment_status ?? "unknown",
    status: row.status,
    salaryType: salaryTypeLabels[row.salary_type] ?? row.salary_type,
    monthlyWage,
    laborGrade: laborGradeAmount,
    healthGrade: healthGradeAmount,
    pensionSalary: toNumber(row.employees?.pension_salary || laborGradeAmount),
    pensionRate,
    laborEmployeePremium: calculation.laborEmployeePremium,
    laborEmployerPremium: calculation.laborEmployerPremium,
    healthEmployeePremium: calculation.healthEmployeePremium,
    healthEmployerPremium: calculation.healthEmployerPremium,
    laborPensionEmployerContribution: Math.round((toNumber(row.employees?.pension_salary || laborGradeAmount) * pensionRate) / 100),
    employeePremiumTotal: calculation.laborEmployeePremium + calculation.healthEmployeePremium,
    employerCostTotal: calculation.laborEmployerPremium + calculation.healthEmployerPremium + Math.round((toNumber(row.employees?.pension_salary || laborGradeAmount) * pensionRate) / 100),
    effectiveFrom: formatDate(row.effective_from),
    updatedAt: formatDateTime(row.updated_at),
    risk: risk.risk,
    riskReason: risk.reason,
  };
}

function downloadCsv(fileName: string, rows: InsuranceLedgerRow[]) {
  const headers = [
    "員工編號",
    "姓名",
    "據點",
    "部門",
    "薪資型態",
    "月投保薪資來源",
    "勞保投保級距",
    "健保投保級距",
    "勞退提繳工資",
    "勞退提繳率",
    "勞保自付",
    "勞保公司負擔",
    "健保自付",
    "健保公司負擔",
    "勞退公司提繳",
    "員工自付合計",
    "公司負擔合計",
    "生效日",
    "狀態",
    "檢核",
    "原因",
  ];
  const body = rows.map((row) => [
    row.employeeNo,
    row.employeeName,
    row.branch,
    row.department,
    row.salaryType,
    row.monthlyWage,
    row.laborGrade,
    row.healthGrade,
    row.pensionSalary,
    `${row.pensionRate}%`,
    row.laborEmployeePremium,
    row.laborEmployerPremium,
    row.healthEmployeePremium,
    row.healthEmployerPremium,
    row.laborPensionEmployerContribution,
    row.employeePremiumTotal,
    row.employerCostTotal,
    row.effectiveFrom,
    row.status,
    row.risk,
    row.riskReason,
  ]);
  const csv = [headers, ...body]
    .map((line) => line.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

export default function InsuranceCalculatorPage() {
  const currentUser = useCurrentUser();
  const canManage = can(currentUser.role, "payroll:manage") || can(currentUser.role, "system:settings");
  const [rows, setRows] = useState<InsuranceLedgerRow[]>([]);
  const [rates, setRates] = useState<InsuranceRateSettings>(defaultInsuranceRateSettings);
  const [branchFilter, setBranchFilter] = useState("全部");
  const [departmentFilter, setDepartmentFilter] = useState("全部");
  const [statusFilter, setStatusFilter] = useState("active");
  const [message, setMessage] = useState("資料會從 employee_payroll_settings 與 employees 即時同步。");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const filteredRows = useMemo(() => rows.filter((row) => {
    const branchMatched = branchFilter === "全部" || row.branch === branchFilter;
    const departmentMatched = departmentFilter === "全部" || row.department === departmentFilter;
    const statusMatched = statusFilter === "all" || row.status === statusFilter;
    return branchMatched && departmentMatched && statusMatched;
  }), [branchFilter, departmentFilter, rows, statusFilter]);

  const branches = useMemo(() => ["全部", ...Array.from(new Set(rows.map((row) => row.branch))).sort()], [rows]);
  const departments = useMemo(() => ["全部", ...Array.from(new Set(rows.map((row) => row.department))).sort()], [rows]);

  const stats = useMemo(() => {
    const activeRows = filteredRows.filter((row) => row.status === "active");
    return {
      employees: activeRows.length,
      issues: filteredRows.filter((row) => row.risk !== "正常").length,
      employeePremium: filteredRows.reduce((total, row) => total + row.employeePremiumTotal, 0),
      employerCost: filteredRows.reduce((total, row) => total + row.employerCostTotal, 0),
      pensionTotal: filteredRows.reduce((total, row) => total + row.laborPensionEmployerContribution, 0),
    };
  }, [filteredRows]);

  async function loadData() {
    const supabase = getSupabaseBrowserClient();
    if (!supabase || !currentUser.companyId) {
      setMessage("尚未登入公司或 Supabase 尚未設定，無法同步投保資料。");
      return;
    }
    setLoading(true);
    try {
      const [rateResult, settingResult] = await Promise.all([
        (supabase as any)
          .from("system_settings")
          .select("settings")
          .eq("company_id", currentUser.companyId)
          .eq("setting_key", settingKey)
          .is("deleted_at", null)
          .maybeSingle(),
        (supabase as any)
          .from("employee_payroll_settings")
          .select(`
            id,
            employee_id,
            salary_type,
            base_salary,
            meal_allowance,
            position_allowance,
            license_allowance,
            transportation_allowance,
            attendance_bonus,
            supervisor_allowance,
            labor_insurance_grade,
            health_insurance_grade,
            labor_pension_rate,
            supplementary_nhi_setting,
            effective_from,
            status,
            updated_at,
            employees(
              id,
              employee_no,
              full_name,
              employment_status,
              labor_insurance_salary,
              health_insurance_salary,
              pension_salary,
              departments(name),
              branches(name)
            )
          `)
          .eq("company_id", currentUser.companyId)
          .is("deleted_at", null)
          .order("status", { ascending: true })
          .order("updated_at", { ascending: false }),
      ]);
      if (rateResult.error) throw rateResult.error;
      if (settingResult.error) throw settingResult.error;
      const nextRates = { ...defaultInsuranceRateSettings, ...((rateResult.data?.settings ?? {}) as Partial<InsuranceRateSettings>) };
      setRates(nextRates);
      setRows(((settingResult.data ?? []) as EmployeePayrollSettingRow[]).map((row) => mapLedger(row, nextRates)));
      setMessage(`已同步 ${settingResult.data?.length ?? 0} 筆員工勞健保、勞退投保資料。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "同步投保資料失敗。");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, [currentUser.companyId]);

  async function saveRates() {
    const supabase = getSupabaseBrowserClient();
    if (!supabase || !currentUser.companyId || !canManage) {
      setMessage("只有薪資權限或系統設定權限可以維護費率。");
      return;
    }
    if (rates.laborPensionEmployerRate < 0.06) {
      setMessage("勞退公司提繳率不得低於 6%，系統已阻擋發布。");
      return;
    }
    setSaving(true);
    const { error } = await (supabase as any).from("system_settings").upsert({
      company_id: currentUser.companyId,
      setting_key: settingKey,
      category: "payroll_settings",
      display_name: "勞健保、勞退費率與級距設定",
      description: "供勞保、健保、勞退投保資料清冊與薪資結算引用。",
      settings: rates,
      status: "active",
      updated_by: currentUser.id || null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "company_id,setting_key" });
    if (error) {
      setMessage(error.message);
      setSaving(false);
      return;
    }
    setMessage("已儲存費率設定，並重新計算投保資料清冊。");
    setRows((current) => current.map((row) => ({
      ...row,
      laborEmployeePremium: calculateInsurancePremiums({ monthlySalary: row.monthlyWage, dependents: 0, supplementaryIncome: 0, laborGrades: defaultLaborInsuranceGrades, healthGrades: defaultHealthInsuranceGrades, rates }).laborEmployeePremium,
    })));
    await loadData();
    setSaving(false);
  }

  const rateFields: Array<[keyof InsuranceRateSettings, string, "percent" | "number"]> = [
    ["laborInsuranceRate", "勞保費率", "percent"],
    ["laborEmployeeShare", "勞保員工自付比例", "percent"],
    ["laborEmployerShare", "勞保公司負擔比例", "percent"],
    ["healthInsuranceRate", "健保費率", "percent"],
    ["healthEmployeeShare", "健保員工自付比例", "percent"],
    ["healthEmployerShare", "健保公司負擔比例", "percent"],
    ["healthDependentCap", "健保眷屬人數上限", "number"],
    ["healthEmployerDependentFactor", "健保雇主平均眷口係數", "number"],
    ["laborPensionEmployerRate", "勞退公司提繳比例", "percent"],
    ["supplementaryNhiRate", "二代健保補充保費率", "percent"],
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-bold tracking-[0.12em] text-[#b45309]">INSURANCE & PENSION LEDGER</p>
          <h1 className="mt-1 text-2xl font-black text-slate-950">勞健保、勞退投保級距與提繳資料</h1>
          <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-500">
            從員工薪資主檔產生正式投保清冊，呈現勞保級距、健保級距、勞退提繳工資、公司提繳率、自付與公司負擔，供薪資結算、勞檢與稽核使用。
          </p>
          <p className="mt-2 text-sm font-semibold text-[#8a4b06]">{message}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => void loadData()} disabled={loading}>
            <RefreshCcw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            重新同步
          </Button>
          <Button variant="outline" onClick={() => downloadCsv(`勞健保勞退投保清冊-${new Date().toISOString().slice(0, 10)}.csv`, filteredRows)}>
            <Download className="h-4 w-4" />
            匯出 CSV
          </Button>
        </div>
      </div>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        {[
          { label: "啟用投保人數", value: `${stats.employees} 人`, icon: UsersRound, tone: "bg-sky-50 text-sky-700" },
          { label: "需補齊/阻擋", value: `${stats.issues} 筆`, icon: AlertTriangle, tone: stats.issues ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700" },
          { label: "員工自付合計", value: currency(stats.employeePremium), icon: HeartPulse, tone: "bg-emerald-50 text-emerald-700" },
          { label: "公司負擔合計", value: currency(stats.employerCost), icon: Landmark, tone: "bg-violet-50 text-violet-700" },
          { label: "勞退提繳合計", value: currency(stats.pensionTotal), icon: Percent, tone: "bg-amber-50 text-amber-700" },
        ].map((item) => (
          <div key={item.label} className="rounded-lg border border-[#ead8c2] bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="text-sm font-bold text-slate-500">{item.label}</div>
              <span className={`rounded-lg p-2 ${item.tone}`}><item.icon className="h-5 w-5" /></span>
            </div>
            <div className="mt-3 text-2xl font-black text-slate-950">{item.value}</div>
          </div>
        ))}
      </section>

      <section className="grid gap-5 xl:grid-cols-[0.82fr_1.18fr]">
        <div className="rounded-lg border border-[#ead8c2] bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-[#b45309]" />
            <h2 className="font-black text-slate-950">費率設定</h2>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {rateFields.map(([key, label, kind]) => (
              <label key={key} className="space-y-1 text-sm font-bold text-slate-700">
                {label}
                <Input
                  type="number"
                  min="0"
                  step={kind === "percent" ? "0.0001" : "0.01"}
                  value={rates[key]}
                  onChange={(event) => setRates((current) => ({ ...current, [key]: Number(event.target.value) }))}
                  disabled={!canManage || saving}
                />
                {kind === "percent" ? <span className="text-xs text-slate-400">目前：{percent(Number(rates[key]))}</span> : null}
              </label>
            ))}
          </div>
          <Button className="mt-4" onClick={() => void saveRates()} disabled={!canManage || saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            儲存費率設定
          </Button>
        </div>

        <div className="rounded-lg border border-[#ead8c2] bg-white p-5 shadow-sm">
          <h2 className="font-black text-slate-950">篩選清冊</h2>
          <p className="mt-1 text-sm text-slate-500">可依據點、部門、啟用狀態篩選後匯出。</p>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <label className="space-y-1 text-sm font-bold text-slate-700">
              據點
              <select value={branchFilter} onChange={(event) => setBranchFilter(event.target.value)} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
                {branches.map((branch) => <option key={branch}>{branch}</option>)}
              </select>
            </label>
            <label className="space-y-1 text-sm font-bold text-slate-700">
              部門
              <select value={departmentFilter} onChange={(event) => setDepartmentFilter(event.target.value)} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
                {departments.map((department) => <option key={department}>{department}</option>)}
              </select>
            </label>
            <label className="space-y-1 text-sm font-bold text-slate-700">
              主檔狀態
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
                <option value="active">啟用</option>
                <option value="draft">草稿</option>
                <option value="inactive">停用</option>
                <option value="all">全部</option>
              </select>
            </label>
          </div>
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
            薪資結算前，若員工缺少勞保級距、健保級距或勞退低於 6%，應先回到「薪資設定」補齊，避免結薪資料低於法規底線。
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-[#ead8c2] bg-white shadow-sm">
        <div className="border-b border-[#ead8c2] p-5">
          <h2 className="font-black text-slate-950">投保級距與提繳清冊</h2>
          <p className="mt-1 text-sm text-slate-500">資料來源：employee_payroll_settings、employees。金額依目前費率即時計算。</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1500px] text-left text-sm">
            <thead className="bg-[#fff7ed] text-xs uppercase tracking-wide text-[#9a5a16]">
              <tr>
                <th className="px-4 py-3">檢核</th>
                <th className="px-4 py-3">員工</th>
                <th className="px-4 py-3">部門/據點</th>
                <th className="px-4 py-3">月投保薪資來源</th>
                <th className="px-4 py-3">勞保級距</th>
                <th className="px-4 py-3">健保級距</th>
                <th className="px-4 py-3">勞退提繳</th>
                <th className="px-4 py-3">員工自付</th>
                <th className="px-4 py-3">公司負擔</th>
                <th className="px-4 py-3">生效/更新</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={10} className="px-4 py-10 text-center text-sm font-semibold text-slate-500">
                    <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin text-[#b45309]" />
                    正在同步 Supabase 投保資料
                  </td>
                </tr>
              ) : filteredRows.length ? filteredRows.map((row) => (
                <tr key={row.settingId} className="align-top hover:bg-[#fffaf4]">
                  <td className="px-4 py-4">
                    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ${
                      row.risk === "正常" ? "bg-emerald-50 text-emerald-700" : row.risk === "低於法定" ? "bg-rose-50 text-rose-700" : "bg-amber-50 text-amber-700"
                    }`}>
                      {row.risk === "正常" ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
                      {row.risk}
                    </span>
                    <div className="mt-2 max-w-[180px] text-xs leading-5 text-slate-500">{row.riskReason}</div>
                  </td>
                  <td className="px-4 py-4">
                    <div className="font-black text-slate-950">{row.employeeName}</div>
                    <div className="text-xs text-slate-500">{row.employeeNo} · {row.salaryType}</div>
                    <div className="mt-1 text-xs text-slate-500">{row.status === "active" ? "啟用" : row.status}</div>
                  </td>
                  <td className="px-4 py-4 text-slate-700">
                    <div>{row.department}</div>
                    <div className="text-xs text-slate-500">{row.branch}</div>
                  </td>
                  <td className="px-4 py-4 font-semibold text-slate-800">{currency(row.monthlyWage)}</td>
                  <td className="px-4 py-4 text-slate-700">
                    <div className="font-semibold">{currency(row.laborGrade)}</div>
                    <div className="text-xs text-slate-500">自付 {currency(row.laborEmployeePremium)}</div>
                    <div className="text-xs text-slate-500">公司 {currency(row.laborEmployerPremium)}</div>
                  </td>
                  <td className="px-4 py-4 text-slate-700">
                    <div className="font-semibold">{currency(row.healthGrade)}</div>
                    <div className="text-xs text-slate-500">自付 {currency(row.healthEmployeePremium)}</div>
                    <div className="text-xs text-slate-500">公司 {currency(row.healthEmployerPremium)}</div>
                  </td>
                  <td className="px-4 py-4 text-slate-700">
                    <div className="font-semibold">{currency(row.pensionSalary)}</div>
                    <div className="text-xs text-slate-500">提繳率 {row.pensionRate}%</div>
                    <div className="text-xs text-slate-500">公司提繳 {currency(row.laborPensionEmployerContribution)}</div>
                  </td>
                  <td className="px-4 py-4 font-semibold text-slate-800">{currency(row.employeePremiumTotal)}</td>
                  <td className="px-4 py-4 font-semibold text-slate-800">{currency(row.employerCostTotal)}</td>
                  <td className="px-4 py-4 text-xs text-slate-500">
                    <div>生效：{row.effectiveFrom}</div>
                    <div>更新：{row.updatedAt}</div>
                  </td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={10} className="px-4 py-10 text-center text-sm font-semibold text-slate-500">
                    尚無可顯示的投保資料，請先至「薪資設定」建立員工薪資主檔。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
