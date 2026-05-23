"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Banknote,
  Download,
  FileSpreadsheet,
  FileText,
  LockKeyhole,
  Search,
  ShieldCheck,
  Table2,
  WalletCards,
} from "lucide-react";
import { csv, downloadTextFile } from "@/lib/client/download";
import { canViewIndividualPayrollData } from "@/lib/auth/privacy";
import { can } from "@/lib/auth/rbac";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import {
  loadLivePayrollDrafts,
  toPayrollRosterRows,
  type PayrollRosterRow,
} from "@/lib/payroll/payroll-store";

function currency(value: number) {
  return new Intl.NumberFormat("zh-TW", { style: "currency", currency: "TWD", maximumFractionDigits: 0 }).format(value);
}

function maskBankAccount(account: string) {
  return `${"*".repeat(Math.max(account.length - 5, 0))}${account.slice(-5)}`;
}

function toCsv(rows: PayrollRosterRow[]) {
  const headers: Array<string | number> = [
    "薪資月份",
    "公司",
    "員工編號",
    "姓名",
    "部門",
    "據點",
    "銀行代碼",
    "銀行帳號",
    "本薪",
    "津貼",
    "加班費",
    "獎金",
    "應發總額",
    "勞保扣款",
    "健保扣款",
    "所得稅",
    "其他扣款",
    "實發金額",
    "草稿狀態",
  ];
  const body = rows.map((row) =>
    [
      row.month,
      row.company,
      row.employeeNo,
      row.name,
      row.department,
      row.branch,
      row.bankCode,
      row.bankAccount,
      row.baseSalary,
      row.allowances,
      row.overtimePay,
      row.bonus,
      row.grossPay,
      row.laborInsuranceDeduction,
      row.healthInsuranceDeduction,
      row.incomeTax,
      row.otherDeductions,
      row.netPay,
      row.status,
    ],
  );
  return csv([headers, ...body]);
}

function toAggregateCsv(rows: PayrollAggregateRow[]) {
  const headers: Array<string | number> = ["薪資月份", "公司", "部門", "據點", "人數", "應發總額", "扣款總額", "實發總額"];
  const body = rows.map((row) => [row.month, row.company, row.department, row.branch, row.employees, row.grossPay, row.deductions, row.netPay]);
  return csv([headers, ...body]);
}

function toPayslipSummaryCsv(rows: PayrollRosterRow[]) {
  const headers: Array<string | number> = [
    "薪資月份",
    "公司",
    "員工編號",
    "姓名",
    "部門",
    "據點",
    "應發項目總額",
    "扣款項目總額",
    "公司負擔項",
    "實發金額",
    "匯款帳號末五碼",
    "發薪日期",
    "狀態",
  ];
  const body = rows.map((row) => [
    row.month,
    row.company,
    row.employeeNo,
    row.name,
    row.department,
    row.branch,
    row.grossPay,
    row.laborInsuranceDeduction + row.healthInsuranceDeduction + row.incomeTax + row.otherDeductions,
    row.employerContribution,
    row.netPay,
    row.bankAccount.slice(-5),
    row.paymentDate,
    row.status,
  ]);
  return csv([headers, ...body]);
}

type PayrollAggregateRow = {
  key: string;
  month: string;
  company: string;
  department: string;
  branch: string;
  employees: number;
  grossPay: number;
  deductions: number;
  netPay: number;
};

type ReportMode = "roster" | "payslip";
type ReportScope = "company" | "department" | "employee";

const reportModeLabels: Record<ReportMode, string> = {
  roster: "工資清冊",
  payslip: "薪資袋",
};

const scopeLabels: Record<ReportScope, string> = {
  company: "公司",
  department: "部門",
  employee: "個人",
};

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

function reportPeriodLabel(months: string[]) {
  if (!months.length) return "";
  if (months.length === 1) return months[0];
  return `${months[0]} 至 ${months[months.length - 1]}`;
}

export default function PayrollRosterPage() {
  const currentUser = useCurrentUser();
  const [reportMode, setReportMode] = useState<ReportMode>("roster");
  const [reportYear, setReportYear] = useState("2026");
  const [monthFrom, setMonthFrom] = useState("01");
  const [monthTo, setMonthTo] = useState("12");
  const [reportScope, setReportScope] = useState<ReportScope>("company");
  const [scopeValue, setScopeValue] = useState("全部");
  const [query, setQuery] = useState("");
  const [exportMessage, setExportMessage] = useState("正在讀取 Supabase 薪資清冊。");
  const [rosterRows, setRosterRows] = useState<PayrollRosterRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const selectedMonths = useMemo(() => buildMonthRange(reportYear, monthFrom, monthTo), [monthFrom, monthTo, reportYear]);
  const periodLabel = reportPeriodLabel(selectedMonths);

  useEffect(() => {
    void refreshRoster();
  }, [selectedMonths.join("|")]);

  useEffect(() => {
    setScopeValue("全部");
  }, [reportScope]);

  async function refreshRoster() {
    setIsLoading(true);
    try {
      const draftGroups = await Promise.all(selectedMonths.map((month) => loadLivePayrollDrafts(month)));
      const drafts = draftGroups.flat();
      setRosterRows(toPayrollRosterRows(drafts));
      setExportMessage(`${periodLabel} 已同步 Supabase payroll_payslips / payroll_items，共 ${drafts.length} 筆。`);
    } catch (error) {
      setExportMessage(error instanceof Error ? error.message : "讀取 Supabase 薪資清冊失敗。");
    } finally {
      setIsLoading(false);
    }
  }

  const years = Array.from(new Set([...rosterRows.map((row) => row.month.slice(0, 4)), "2026", String(new Date().getFullYear())])).sort((a, b) => Number(b) - Number(a));
  const monthOptions = Array.from({ length: 12 }, (_, index) => monthNumber(String(index + 1)));
  const scopeOptions = useMemo(() => {
    if (reportScope === "company") return ["全部", ...Array.from(new Set(rosterRows.map((row) => row.company)))];
    if (reportScope === "department") return ["全部", ...Array.from(new Set(rosterRows.map((row) => row.department)))];
    return ["全部", ...Array.from(new Set(rosterRows.map((row) => `${row.employeeNo} ${row.name}`)))];
  }, [reportScope, rosterRows]);

  const filteredRows = useMemo(
    () =>
      rosterRows.filter((row) => {
        const matchesScope =
          scopeValue === "全部" ||
          (reportScope === "company" && row.company === scopeValue) ||
          (reportScope === "department" && row.department === scopeValue) ||
          (reportScope === "employee" && `${row.employeeNo} ${row.name}` === scopeValue);
        const keyword = query.trim().toLowerCase();
        const matchesQuery = !keyword || [row.month, row.company, row.employeeNo, row.name, row.department, row.branch, row.bankCode].join(" ").toLowerCase().includes(keyword);
        return matchesScope && matchesQuery;
      }),
    [query, reportScope, rosterRows, scopeValue],
  );

  const totals = useMemo(
    () => ({
      employees: filteredRows.length,
      grossPay: filteredRows.reduce((sum, row) => sum + row.grossPay, 0),
      deductions: filteredRows.reduce((sum, row) => sum + row.laborInsuranceDeduction + row.healthInsuranceDeduction + row.incomeTax + row.otherDeductions, 0),
      netPay: filteredRows.reduce((sum, row) => sum + row.netPay, 0),
    }),
    [filteredRows],
  );

  const canViewPersonalPayroll = canViewIndividualPayrollData(currentUser);
  const canExportPayrollRoster = can(currentUser.role, "payroll:roster_export");
  const aggregateRows = useMemo(() => {
    const rows = new Map<string, PayrollAggregateRow>();
    filteredRows.forEach((row) => {
      const key = `${row.month}-${row.company}-${row.department}-${row.branch}`;
      const current = rows.get(key) ?? {
        key,
        month: row.month,
        company: row.company,
        department: row.department,
        branch: row.branch,
        employees: 0,
        grossPay: 0,
        deductions: 0,
        netPay: 0,
      };
      current.employees += 1;
      current.grossPay += row.grossPay;
      current.deductions += row.laborInsuranceDeduction + row.healthInsuranceDeduction + row.incomeTax + row.otherDeductions;
      current.netPay += row.netPay;
      rows.set(key, current);
    });
    return Array.from(rows.values()).sort((a, b) => a.month.localeCompare(b.month) || b.netPay - a.netPay);
  }, [filteredRows]);

  const exportExcel = () => {
    if (!canExportPayrollRoster) {
      setExportMessage("此帳號沒有「薪資清冊匯出」權限。");
      return;
    }
    const exportRows = reportMode === "payslip" && canViewPersonalPayroll ? toPayslipSummaryCsv(filteredRows) : canViewPersonalPayroll ? toCsv(filteredRows) : toAggregateCsv(aggregateRows);
    const filePrefix = reportMode === "payslip" ? "payroll-payslips" : canViewPersonalPayroll ? "payroll-roster" : "payroll-summary";
    downloadTextFile(
      `${filePrefix}-${periodLabel}-${reportScope}-${scopeValue}.xls`,
      `<html><head><meta charset="utf-8" /></head><body><table>${exportRows
        .split("\n")
        .map((line) => `<tr>${line.split(",").map((cell) => `<td>${cell.replaceAll("\"", "")}</td>`).join("")}</tr>`)
        .join("")}</table></body></html>`,
      "application/vnd.ms-excel;charset=utf-8",
    );
    setExportMessage(canViewPersonalPayroll ? `${periodLabel} ${reportModeLabels[reportMode]} Excel 匯出完成，共 ${filteredRows.length} 筆。` : `${periodLabel} 薪資彙總 Excel 匯出完成，共 ${aggregateRows.length} 組。`);
  };

  const exportCsv = () => {
    if (!canExportPayrollRoster) {
      setExportMessage("此帳號沒有「薪資清冊匯出」權限。");
      return;
    }
    const rosterCsv = reportMode === "payslip" && canViewPersonalPayroll ? toPayslipSummaryCsv(filteredRows) : canViewPersonalPayroll ? toCsv(filteredRows) : toAggregateCsv(aggregateRows);
    const filePrefix = reportMode === "payslip" ? "payroll-payslips" : canViewPersonalPayroll ? "payroll-roster" : "payroll-summary";
    downloadTextFile(`${filePrefix}-${periodLabel}-${reportScope}-${scopeValue}.csv`, rosterCsv);
    setExportMessage(canViewPersonalPayroll ? `${periodLabel} ${reportModeLabels[reportMode]} CSV 匯出完成，共 ${filteredRows.length} 筆，${rosterCsv.length} 個字元。` : `${periodLabel} 薪資彙總 CSV 匯出完成，共 ${aggregateRows.length} 組，${rosterCsv.length} 個字元。`);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-medium text-emerald-700">Payroll Roster</p>
          <h1 className="text-2xl font-semibold text-slate-950">薪資清冊</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-500">
            {canViewPersonalPayroll
              ? "可依公司、部門、個人查詢 1-12 個月工資清冊與薪資袋彙總，資料來自 Supabase 正式 payroll_payslips / payroll_items。"
              : "經營層僅顯示部門與據點薪資總額，不揭露員工姓名、個人薪資、銀行帳號與個別扣款明細。"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => void refreshRoster()}
            disabled={isLoading}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            重新同步
          </button>
          <button
            onClick={exportExcel}
            disabled={!canExportPayrollRoster}
            className="inline-flex items-center gap-2 rounded-lg border border-emerald-200 px-4 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <FileSpreadsheet className="h-4 w-4" />
            Excel 匯出
          </button>
          <button
            onClick={exportCsv}
            disabled={!canExportPayrollRoster}
            className="inline-flex items-center gap-2 rounded-lg border border-sky-200 px-4 py-2 text-sm font-semibold text-sky-700 hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <FileText className="h-4 w-4" />
            CSV 匯出
          </button>
        </div>
      </div>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "清冊人數", value: `${totals.employees} 人`, icon: Table2, tone: "bg-emerald-50 text-emerald-700" },
          { label: "應發總額", value: currency(totals.grossPay), icon: WalletCards, tone: "bg-sky-50 text-sky-700" },
          { label: "扣款總額", value: currency(totals.deductions), icon: LockKeyhole, tone: "bg-rose-50 text-rose-700" },
          { label: "實發金額", value: currency(totals.netPay), icon: Banknote, tone: "bg-amber-50 text-amber-700" },
        ].map((item) => (
          <div key={item.label} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-slate-500">{item.label}</p>
              <span className={`rounded-lg p-2 ${item.tone}`}>
                <item.icon className="h-5 w-5" />
              </span>
            </div>
            <p className="mt-3 text-2xl font-semibold text-slate-950">{item.value}</p>
          </div>
        ))}
      </section>

      {!canViewPersonalPayroll ? (
        <section className="rounded-lg border border-sky-200 bg-sky-50 p-5 shadow-sm">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 h-5 w-5 text-sky-700" />
            <div>
              <h2 className="font-semibold text-sky-950">經營層薪資彙總視圖</h2>
              <p className="mt-1 text-sm leading-6 text-sky-800">
                此帳號可看薪資總額、扣款總額與實發總額；個人清冊與銀行資訊只開放人資與行政薪資權限。
              </p>
            </div>
          </div>
        </section>
      ) : null}

      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid gap-3 xl:grid-cols-[1fr_auto] xl:items-end">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
            <label className="grid gap-1 text-xs font-semibold text-slate-500">
              報表
              <select
                value={reportMode}
                onChange={(event) => setReportMode(event.target.value as ReportMode)}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800"
              >
                <option value="roster">工資清冊</option>
                <option value="payslip" disabled={!canViewPersonalPayroll}>薪資袋</option>
              </select>
            </label>
            <label className="grid gap-1 text-xs font-semibold text-slate-500">
              年度
              <select
                value={reportYear}
                onChange={(event) => setReportYear(event.target.value)}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800"
              >
                {years.map((year) => (
                  <option key={year}>{year}</option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-xs font-semibold text-slate-500">
              起始月份
              <select
                value={monthFrom}
                onChange={(event) => setMonthFrom(event.target.value)}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800"
              >
                {monthOptions.map((month) => (
                  <option key={month} value={month}>{month} 月</option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-xs font-semibold text-slate-500">
              結束月份
              <select
                value={monthTo}
                onChange={(event) => setMonthTo(event.target.value)}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800"
              >
                {monthOptions.map((month) => (
                  <option key={month} value={month}>{month} 月</option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-xs font-semibold text-slate-500">
              範圍
              <select
                value={reportScope}
                onChange={(event) => setReportScope(event.target.value as ReportScope)}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800"
              >
                <option value="company">公司</option>
                <option value="department">部門</option>
                <option value="employee" disabled={!canViewPersonalPayroll}>個人</option>
              </select>
            </label>
            <label className="grid gap-1 text-xs font-semibold text-slate-500">
              對象
              <select
                value={scopeValue}
                onChange={(event) => setScopeValue(event.target.value)}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800"
              >
                {scopeOptions.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </label>
          </div>
          {canViewPersonalPayroll ? (
            <div className="relative w-full max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜尋員工編號、姓名、部門、據點、銀行代碼"
                className="w-full rounded-lg border border-slate-200 py-2 pl-9 pr-3 text-sm outline-none focus:border-emerald-300"
              />
            </div>
          ) : (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-600">
              個人搜尋已關閉，僅保留部門篩選
            </div>
          )}
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-2 border-b border-slate-200 p-5 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">{periodLabel} {canViewPersonalPayroll ? reportModeLabels[reportMode] : "薪資彙總"}</h2>
            <p className="text-sm text-slate-500">
              {canViewPersonalPayroll ? `${scopeLabels[reportScope]}：${scopeValue}。銀行帳號畫面遮罩顯示；匯出檔依權限包含完整帳號或薪資袋摘要。` : "此視圖只顯示部門、據點、人數與總額，匯出檔也不包含個人資料。"}
            </p>
          </div>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">{exportMessage}</span>
        </div>
        <div className="overflow-x-auto">
          {canViewPersonalPayroll ? (
          <table className="w-full min-w-[1320px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">員工編號</th>
                <th className="px-4 py-3">月份</th>
                <th className="px-4 py-3">公司</th>
                <th className="px-4 py-3">姓名</th>
                <th className="px-4 py-3">部門</th>
                <th className="px-4 py-3">據點</th>
                <th className="px-4 py-3">銀行代碼</th>
                <th className="px-4 py-3">銀行帳號</th>
                <th className="px-4 py-3">本薪</th>
                <th className="px-4 py-3">津貼</th>
                <th className="px-4 py-3">加班費</th>
                <th className="px-4 py-3">獎金</th>
                <th className="px-4 py-3">應發總額</th>
                <th className="px-4 py-3">勞保扣款</th>
                <th className="px-4 py-3">健保扣款</th>
                <th className="px-4 py-3">所得稅</th>
                <th className="px-4 py-3">其他扣款</th>
                <th className="px-4 py-3">實發金額</th>
                <th className="px-4 py-3">草稿狀態</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredRows.map((row) => (
                <tr key={`${row.month}-${row.employeeNo}`} className="hover:bg-slate-50">
                  <td className="px-4 py-4 font-semibold text-slate-950">{row.employeeNo}</td>
                  <td className="px-4 py-4 text-slate-700">{row.month}</td>
                  <td className="px-4 py-4 text-slate-700">{row.company}</td>
                  <td className="px-4 py-4 text-slate-700">{row.name}</td>
                  <td className="px-4 py-4 text-slate-700">{row.department}</td>
                  <td className="px-4 py-4 text-slate-700">{row.branch}</td>
                  <td className="px-4 py-4 text-slate-700">{row.bankCode}</td>
                  <td className="px-4 py-4">
                    <span className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-700">
                      {maskBankAccount(row.bankAccount)}
                    </span>
                  </td>
                  <td className="px-4 py-4 text-slate-700">{currency(row.baseSalary)}</td>
                  <td className="px-4 py-4 text-slate-700">{currency(row.allowances)}</td>
                  <td className="px-4 py-4 text-slate-700">{currency(row.overtimePay)}</td>
                  <td className="px-4 py-4 text-slate-700">{currency(row.bonus)}</td>
                  <td className="px-4 py-4 font-semibold text-slate-950">{currency(row.grossPay)}</td>
                  <td className="px-4 py-4 text-slate-700">{currency(row.laborInsuranceDeduction)}</td>
                  <td className="px-4 py-4 text-slate-700">{currency(row.healthInsuranceDeduction)}</td>
                  <td className="px-4 py-4 text-slate-700">{currency(row.incomeTax)}</td>
                  <td className="px-4 py-4 text-slate-700">{currency(row.otherDeductions)}</td>
                  <td className="px-4 py-4 font-semibold text-emerald-700">{currency(row.netPay)}</td>
                  <td className="px-4 py-4">
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">{row.status}</span>
                  </td>
                </tr>
              ))}
              {!filteredRows.length ? (
                <tr>
                  <td colSpan={19} className="px-4 py-8 text-center text-sm text-slate-500">
                    目前期間沒有可匯出的正式薪資資料。
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
          ) : (
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">部門</th>
                  <th className="px-4 py-3">月份</th>
                  <th className="px-4 py-3">公司</th>
                  <th className="px-4 py-3">據點</th>
                  <th className="px-4 py-3">人數</th>
                  <th className="px-4 py-3">應發總額</th>
                  <th className="px-4 py-3">扣款總額</th>
                  <th className="px-4 py-3">實發總額</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {aggregateRows.map((row) => (
                  <tr key={row.key} className="hover:bg-slate-50">
                    <td className="px-4 py-4 font-semibold text-slate-950">{row.department}</td>
                    <td className="px-4 py-4 text-slate-700">{row.month}</td>
                    <td className="px-4 py-4 text-slate-700">{row.company}</td>
                    <td className="px-4 py-4 text-slate-700">{row.branch}</td>
                    <td className="px-4 py-4 text-slate-700">{row.employees} 人</td>
                    <td className="px-4 py-4 font-semibold text-slate-950">{currency(row.grossPay)}</td>
                    <td className="px-4 py-4 text-slate-700">{currency(row.deductions)}</td>
                    <td className="px-4 py-4 font-semibold text-emerald-700">{currency(row.netPay)}</td>
                  </tr>
                ))}
                {!aggregateRows.length ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-sm text-slate-500">
                      目前期間沒有可彙總的薪資資料。
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <section className="grid gap-5 md:grid-cols-2">
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-5">
          <div className="mb-3 flex items-center gap-2">
            <Download className="h-5 w-5 text-emerald-700" />
            <h2 className="font-semibold text-emerald-900">Excel 匯出</h2>
          </div>
          <p className="text-sm text-emerald-800">提供會計、人資檢核用清冊格式，包含完整薪資欄位與銀行轉帳資訊。</p>
        </div>
        <div className="rounded-lg border border-sky-200 bg-sky-50 p-5">
          <div className="mb-3 flex items-center gap-2">
            <FileText className="h-5 w-5 text-sky-700" />
            <h2 className="font-semibold text-sky-900">CSV 匯出</h2>
          </div>
          <p className="text-sm text-sky-800">提供銀行轉帳檔或外部會計系統匯入，可再依銀行格式客製欄位順序。</p>
        </div>
      </section>
    </div>
  );
}
