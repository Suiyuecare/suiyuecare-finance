"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  FileText,
  Search,
  Timer,
  WalletCards,
} from "lucide-react";
import { csv, downloadTextFile } from "@/lib/client/download";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import {
  calculateOvertimePay,
  type OvertimeCompensation,
  type OvertimeDayType,
} from "@/lib/payroll/overtime-calculation-service";

type ReportScope = "company" | "department" | "employee";
type RequestStatus = "draft" | "pending" | "approved" | "rejected" | "cancelled";
type DbOvertimeType = "weekday" | "rest_day" | "holiday" | "regular_holiday";
type DbCompensationType = "overtime_pay" | "compensatory_leave";

type OvertimeRequestRow = {
  id: string;
  company_id: string;
  employee_id: string;
  work_date: string;
  starts_at: string;
  ends_at: string;
  total_hours: number | string;
  overtime_type: DbOvertimeType;
  compensation_type: DbCompensationType | null;
  workflow_stage: string | null;
  reason: string | null;
  status: RequestStatus;
  submitted_at: string | null;
  approved_at: string | null;
  companies: { name: string | null } | null;
  employees: {
    employee_no: string | null;
    full_name: string | null;
    branches: { name: string | null } | null;
    departments: { name: string | null } | null;
  } | null;
};

type PayrollSettingRow = {
  employee_id: string;
  base_salary: number | string | null;
};

type OvertimeReportRow = {
  id: string;
  month: string;
  company: string;
  department: string;
  branch: string;
  employeeId: string;
  employeeNo: string;
  employeeName: string;
  workDate: string;
  startsAt: string;
  endsAt: string;
  totalHours: number;
  overtimeType: OvertimeDayType;
  compensation: OvertimeCompensation;
  status: RequestStatus;
  stage: string;
  reason: string;
  monthlySalary: number;
  hourlyWage: number;
  calculatedPay: number;
  approvedPay: number;
  compLeaveHours: number;
  warnings: string[];
};

const scopeLabels: Record<ReportScope, string> = {
  company: "公司",
  department: "部門",
  employee: "個人",
};

const statusLabels: Record<RequestStatus, string> = {
  draft: "草稿",
  pending: "簽核中",
  approved: "已核准",
  rejected: "已駁回",
  cancelled: "已取消",
};

const statusStyles: Record<RequestStatus, string> = {
  draft: "bg-slate-50 text-slate-700",
  pending: "bg-amber-50 text-amber-700",
  approved: "bg-emerald-50 text-emerald-700",
  rejected: "bg-rose-50 text-rose-700",
  cancelled: "bg-slate-50 text-slate-500",
};

function currency(value: number) {
  return new Intl.NumberFormat("zh-TW", { style: "currency", currency: "TWD", maximumFractionDigits: 0 }).format(value);
}

function monthNumber(value: string) {
  return String(value).padStart(2, "0");
}

function buildMonthRange(year: string, fromMonth: string, toMonth: string) {
  const start = Number(fromMonth);
  const end = Number(toMonth);
  const safeStart = Math.min(start, end);
  const safeEnd = Math.max(start, end);
  return Array.from({ length: safeEnd - safeStart + 1 }, (_, index) => `${year}-${monthNumber(String(safeStart + index))}`);
}

function nextMonthDate(month: string) {
  const date = new Date(`${month}-01T00:00:00+08:00`);
  date.setMonth(date.getMonth() + 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-01`;
}

function periodLabel(months: string[]) {
  if (months.length === 1) return months[0];
  return `${months[0]} 至 ${months[months.length - 1]}`;
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("zh-TW", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Taipei",
  }).format(new Date(value));
}

function mapOvertimeType(value: DbOvertimeType): OvertimeDayType {
  if (value === "rest_day") return "休息日加班";
  if (value === "regular_holiday") return "例假日出勤";
  if (value === "holiday") return "國定假日出勤";
  return "平日加班";
}

function mapCompensation(value: DbCompensationType | null): OvertimeCompensation {
  return value === "compensatory_leave" ? "補休" : "加班費";
}

function exportRows(rows: OvertimeReportRow[]) {
  return csv([
    [
      "月份",
      "公司",
      "部門",
      "據點",
      "員工編號",
      "姓名",
      "加班日期",
      "開始",
      "結束",
      "時數",
      "加班類型",
      "補償方式",
      "申請狀態",
      "目前關卡",
      "月薪",
      "平日時薪",
      "試算加班費",
      "核准入薪加班費",
      "補休時數",
      "原因",
      "提醒",
    ],
    ...rows.map((row) => [
      row.month,
      row.company,
      row.department,
      row.branch,
      row.employeeNo,
      row.employeeName,
      row.workDate,
      formatDateTime(row.startsAt),
      formatDateTime(row.endsAt),
      row.totalHours,
      row.overtimeType,
      row.compensation,
      statusLabels[row.status],
      row.stage,
      row.monthlySalary,
      Math.round(row.hourlyWage),
      row.calculatedPay,
      row.approvedPay,
      row.compLeaveHours,
      row.reason,
      row.warnings.join("；"),
    ]),
  ]);
}

function toExcelTable(csvText: string) {
  return `<html><head><meta charset="utf-8" /></head><body><table>${csvText
    .split("\n")
    .map((line) => `<tr>${line.split(",").map((cell) => `<td>${cell.replaceAll("\"", "")}</td>`).join("")}</tr>`)
    .join("")}</table></body></html>`;
}

export default function OvertimeReportsPage() {
  const currentUser = useCurrentUser();
  const [reportYear, setReportYear] = useState("2026");
  const [monthFrom, setMonthFrom] = useState("01");
  const [monthTo, setMonthTo] = useState("12");
  const [reportScope, setReportScope] = useState<ReportScope>("company");
  const [scopeValue, setScopeValue] = useState("全部");
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<OvertimeReportRow[]>([]);
  const [message, setMessage] = useState("正在讀取 Supabase 加班申請與薪資設定。");
  const [loading, setLoading] = useState(false);

  const selectedMonths = useMemo(() => buildMonthRange(reportYear, monthFrom, monthTo), [monthFrom, monthTo, reportYear]);
  const selectedPeriod = periodLabel(selectedMonths);

  useEffect(() => {
    void loadReport();
  }, [selectedMonths.join("|"), currentUser.companyId, currentUser.role]);

  useEffect(() => {
    setScopeValue("全部");
  }, [reportScope]);

  async function loadReport() {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      setMessage("Supabase 尚未設定，無法讀取加班報表。");
      return;
    }
    setLoading(true);
    try {
      const startDate = `${selectedMonths[0]}-01`;
      const endDate = nextMonthDate(selectedMonths[selectedMonths.length - 1]);
      let requestQuery = supabase
        .from("overtime_requests")
        .select(`
          id,
          company_id,
          employee_id,
          work_date,
          starts_at,
          ends_at,
          total_hours,
          overtime_type,
          compensation_type,
          workflow_stage,
          reason,
          status,
          submitted_at,
          approved_at,
          companies(name),
          employees(employee_no, full_name, branches(name), departments(name))
        `)
        .gte("work_date", startDate)
        .lt("work_date", endDate)
        .is("deleted_at", null)
        .order("work_date", { ascending: false });

      if (currentUser.companyId && currentUser.role !== "ceo") {
        requestQuery = requestQuery.eq("company_id", currentUser.companyId);
      }

      const { data, error } = await requestQuery;
      if (error) throw error;
      const requestRows = (data ?? []) as unknown as OvertimeRequestRow[];
      const employeeIds = Array.from(new Set(requestRows.map((row) => row.employee_id)));
      let salaryMap = new Map<string, number>();

      if (employeeIds.length) {
        const { data: settingsData, error: settingsError } = await supabase
          .from("employee_payroll_settings")
          .select("employee_id, base_salary")
          .in("employee_id", employeeIds)
          .eq("status", "active")
          .is("deleted_at", null);
        if (settingsError) throw settingsError;
        salaryMap = new Map(((settingsData ?? []) as PayrollSettingRow[]).map((setting) => [setting.employee_id, Number(setting.base_salary ?? 0)]));
      }

      const monthHours = new Map<string, number>();
      requestRows
        .filter((row) => !["rejected", "cancelled"].includes(row.status))
        .forEach((row) => {
          const key = `${row.employee_id}-${row.work_date.slice(0, 7)}`;
          monthHours.set(key, (monthHours.get(key) ?? 0) + Number(row.total_hours));
        });

      setRows(requestRows.map((row) => {
        const totalHours = Number(row.total_hours);
        const compensation = mapCompensation(row.compensation_type);
        const monthlySalary = salaryMap.get(row.employee_id) ?? 0;
        const month = row.work_date.slice(0, 7);
        const result = calculateOvertimePay({
          monthlySalary,
          overtimeHours: totalHours,
          monthAccumulatedHours: Math.max((monthHours.get(`${row.employee_id}-${month}`) ?? 0) - totalHours, 0),
          dayType: mapOvertimeType(row.overtime_type),
          compensation,
        });
        const calculatedPay = result.totalPay;
        const approvedPay = row.status === "approved" && compensation === "加班費" ? calculatedPay : 0;

        return {
          id: row.id,
          month,
          company: row.companies?.name ?? "未設定公司",
          department: row.employees?.departments?.name ?? "未設定部門",
          branch: row.employees?.branches?.name ?? "未設定據點",
          employeeId: row.employee_id,
          employeeNo: row.employees?.employee_no ?? "未設定",
          employeeName: row.employees?.full_name ?? "未命名員工",
          workDate: row.work_date,
          startsAt: row.starts_at,
          endsAt: row.ends_at,
          totalHours,
          overtimeType: result.dayType,
          compensation,
          status: row.status,
          stage: row.workflow_stage ?? "未設定",
          reason: row.reason ?? "",
          monthlySalary,
          hourlyWage: result.hourlyWage,
          calculatedPay,
          approvedPay,
          compLeaveHours: result.compensatoryLeaveHours,
          warnings: monthlySalary <= 0 ? ["缺少員工薪資主檔，無法產生可信加班費"] : result.warnings,
        };
      }));
      setMessage(`${selectedPeriod} 已同步 Supabase overtime_requests / employee_payroll_settings。`);
    } catch (error) {
      setRows([]);
      setMessage(error instanceof Error ? error.message : "加班報表讀取失敗。");
    } finally {
      setLoading(false);
    }
  }

  const years = Array.from(new Set([...rows.map((row) => row.month.slice(0, 4)), "2026", String(new Date().getFullYear())])).sort((a, b) => Number(b) - Number(a));
  const monthOptions = Array.from({ length: 12 }, (_, index) => monthNumber(String(index + 1)));
  const scopeOptions = useMemo(() => {
    if (reportScope === "company") return ["全部", ...Array.from(new Set(rows.map((row) => row.company)))];
    if (reportScope === "department") return ["全部", ...Array.from(new Set(rows.map((row) => row.department)))];
    return ["全部", ...Array.from(new Set(rows.map((row) => `${row.employeeNo} ${row.employeeName}`)))];
  }, [reportScope, rows]);

  const filteredRows = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return rows.filter((row) => {
      const matchesScope =
        scopeValue === "全部" ||
        (reportScope === "company" && row.company === scopeValue) ||
        (reportScope === "department" && row.department === scopeValue) ||
        (reportScope === "employee" && `${row.employeeNo} ${row.employeeName}` === scopeValue);
      const matchesQuery = !keyword || [
        row.month,
        row.company,
        row.department,
        row.branch,
        row.employeeNo,
        row.employeeName,
        row.overtimeType,
        row.compensation,
        statusLabels[row.status],
      ].join(" ").toLowerCase().includes(keyword);
      return matchesScope && matchesQuery;
    });
  }, [query, reportScope, rows, scopeValue]);

  const totals = useMemo(() => ({
    requests: filteredRows.length,
    approved: filteredRows.filter((row) => row.status === "approved").length,
    hours: filteredRows.reduce((sum, row) => sum + row.totalHours, 0),
    approvedPay: filteredRows.reduce((sum, row) => sum + row.approvedPay, 0),
  }), [filteredRows]);

  function downloadCsv() {
    const content = exportRows(filteredRows);
    downloadTextFile(`overtime-report-${selectedPeriod}-${reportScope}-${scopeValue}.csv`, content);
    setMessage(`${selectedPeriod} 加班報表 CSV 匯出完成，共 ${filteredRows.length} 筆。`);
  }

  function downloadExcel() {
    const content = exportRows(filteredRows);
    downloadTextFile(
      `overtime-report-${selectedPeriod}-${reportScope}-${scopeValue}.xls`,
      toExcelTable(content),
      "application/vnd.ms-excel;charset=utf-8",
    );
    setMessage(`${selectedPeriod} 加班報表 Excel 匯出完成，共 ${filteredRows.length} 筆。`);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-medium text-indigo-700">Overtime Reports</p>
          <h1 className="text-2xl font-semibold text-slate-950">加班申請、核准與加班費計算表</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-500">
            可依公司、部門、個人查詢 1-12 個月加班申請，核准後的加班費會依台灣加班費 service 計算並可匯出。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => void loadReport()} disabled={loading} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            重新同步
          </button>
          <button onClick={downloadExcel} className="inline-flex items-center gap-2 rounded-lg border border-emerald-200 px-4 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-50">
            <FileSpreadsheet className="h-4 w-4" />
            Excel 匯出
          </button>
          <button onClick={downloadCsv} className="inline-flex items-center gap-2 rounded-lg border border-sky-200 px-4 py-2 text-sm font-semibold text-sky-700 hover:bg-sky-50">
            <FileText className="h-4 w-4" />
            CSV 匯出
          </button>
        </div>
      </div>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "申請筆數", value: `${totals.requests} 筆`, icon: BarChart3, tone: "bg-indigo-50 text-indigo-700" },
          { label: "已核准", value: `${totals.approved} 筆`, icon: CheckCircle2, tone: "bg-emerald-50 text-emerald-700" },
          { label: "加班時數", value: `${totals.hours.toFixed(1)} 小時`, icon: Timer, tone: "bg-amber-50 text-amber-700" },
          { label: "核准加班費", value: currency(totals.approvedPay), icon: WalletCards, tone: "bg-sky-50 text-sky-700" },
        ].map((item) => (
          <div key={item.label} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-slate-500">{item.label}</p>
              <span className={`rounded-lg p-2 ${item.tone}`}>
                <item.icon className="h-5 w-5" />
              </span>
            </div>
            <p className="mt-3 text-2xl font-semibold text-slate-950">{loading ? "..." : item.value}</p>
          </div>
        ))}
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid gap-3 xl:grid-cols-[1fr_auto] xl:items-end">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            <label className="grid gap-1 text-xs font-semibold text-slate-500">
              年度
              <select value={reportYear} onChange={(event) => setReportYear(event.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800">
                {years.map((year) => <option key={year}>{year}</option>)}
              </select>
            </label>
            <label className="grid gap-1 text-xs font-semibold text-slate-500">
              起始月份
              <select value={monthFrom} onChange={(event) => setMonthFrom(event.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800">
                {monthOptions.map((month) => <option key={month} value={month}>{month} 月</option>)}
              </select>
            </label>
            <label className="grid gap-1 text-xs font-semibold text-slate-500">
              結束月份
              <select value={monthTo} onChange={(event) => setMonthTo(event.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800">
                {monthOptions.map((month) => <option key={month} value={month}>{month} 月</option>)}
              </select>
            </label>
            <label className="grid gap-1 text-xs font-semibold text-slate-500">
              範圍
              <select value={reportScope} onChange={(event) => setReportScope(event.target.value as ReportScope)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800">
                <option value="company">公司</option>
                <option value="department">部門</option>
                <option value="employee">個人</option>
              </select>
            </label>
            <label className="grid gap-1 text-xs font-semibold text-slate-500">
              對象
              <select value={scopeValue} onChange={(event) => setScopeValue(event.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800">
                {scopeOptions.map((item) => <option key={item}>{item}</option>)}
              </select>
            </label>
          </div>
          <div className="relative w-full max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜尋公司、部門、員工、類型、狀態"
              className="w-full rounded-lg border border-slate-200 py-2 pl-9 pr-3 text-sm outline-none focus:border-indigo-300"
            />
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-2 border-b border-slate-200 p-5 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">{selectedPeriod} 加班費計算表</h2>
            <p className="text-sm text-slate-500">{scopeLabels[reportScope]}：{scopeValue}。已核准且補償方式為加班費者才列入核准入薪金額。</p>
          </div>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">{message}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1500px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">月份</th>
                <th className="px-4 py-3">公司</th>
                <th className="px-4 py-3">部門</th>
                <th className="px-4 py-3">員工</th>
                <th className="px-4 py-3">日期</th>
                <th className="px-4 py-3">時間</th>
                <th className="px-4 py-3">時數</th>
                <th className="px-4 py-3">類型</th>
                <th className="px-4 py-3">補償</th>
                <th className="px-4 py-3">狀態</th>
                <th className="px-4 py-3">月薪</th>
                <th className="px-4 py-3">時薪</th>
                <th className="px-4 py-3">試算</th>
                <th className="px-4 py-3">核准入薪</th>
                <th className="px-4 py-3">提醒</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredRows.map((row) => (
                <tr key={row.id} className="align-top hover:bg-slate-50">
                  <td className="px-4 py-4 font-semibold text-slate-950">{row.month}</td>
                  <td className="px-4 py-4 text-slate-700">{row.company}</td>
                  <td className="px-4 py-4 text-slate-700">{row.department}</td>
                  <td className="px-4 py-4">
                    <p className="font-semibold text-slate-950">{row.employeeName}</p>
                    <p className="text-xs text-slate-500">{row.employeeNo} / {row.branch}</p>
                  </td>
                  <td className="px-4 py-4 text-slate-700">{row.workDate}</td>
                  <td className="px-4 py-4 text-slate-700">{formatDateTime(row.startsAt)} - {formatDateTime(row.endsAt)}</td>
                  <td className="px-4 py-4 font-semibold text-slate-950">{row.totalHours.toFixed(1)}</td>
                  <td className="px-4 py-4 text-slate-700">{row.overtimeType}</td>
                  <td className="px-4 py-4 text-slate-700">{row.compensation}</td>
                  <td className="px-4 py-4">
                    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusStyles[row.status]}`}>{statusLabels[row.status]}</span>
                    <p className="mt-2 text-xs text-slate-500">{row.stage}</p>
                  </td>
                  <td className="px-4 py-4 text-slate-700">{currency(row.monthlySalary)}</td>
                  <td className="px-4 py-4 text-slate-700">{currency(row.hourlyWage)}</td>
                  <td className="px-4 py-4 font-semibold text-slate-950">{currency(row.calculatedPay)}</td>
                  <td className="px-4 py-4 font-semibold text-emerald-700">{currency(row.approvedPay)}</td>
                  <td className="px-4 py-4 text-xs text-amber-700">{row.warnings.join("；") || "無"}</td>
                </tr>
              ))}
              {!filteredRows.length ? (
                <tr>
                  <td colSpan={15} className="px-4 py-10 text-center text-sm font-semibold text-slate-500">
                    目前期間沒有符合條件的加班申請。
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid gap-5 md:grid-cols-2">
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-5">
          <div className="mb-3 flex items-center gap-2">
            <Download className="h-5 w-5 text-emerald-700" />
            <h2 className="font-semibold text-emerald-900">核准與入薪分開</h2>
          </div>
          <p className="text-sm text-emerald-800">報表會保留所有申請狀態；只有已核准且選擇加班費的紀錄才列入核准入薪金額。</p>
        </div>
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-5">
          <div className="mb-3 flex items-center gap-2">
            <WalletCards className="h-5 w-5 text-amber-700" />
            <h2 className="font-semibold text-amber-900">薪資設定連動</h2>
          </div>
          <p className="text-sm text-amber-800">加班費會讀取員工薪資主檔的本薪換算平日時薪；缺少薪資主檔會在報表中標示提醒。</p>
        </div>
      </section>
    </div>
  );
}
