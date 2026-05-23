"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarDays, CheckCircle2, FileSpreadsheet, FileText, Paperclip, Search, Timer } from "lucide-react";
import { csv, downloadTextFile } from "@/lib/client/download";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

type ReportScope = "company" | "department" | "employee";
type LeaveStatus = "draft" | "pending" | "approved" | "rejected" | "cancelled" | "草稿" | "待我簽核" | "簽核中" | "已核准" | "已駁回" | "已取消" | "被退回";

type LeaveRequestRow = {
  id: string;
  company_id: string;
  employee_id: string;
  leave_type: string;
  starts_at: string;
  ends_at: string;
  total_hours: number | string;
  reason: string | null;
  attachment_ids: string[] | null;
  status: LeaveStatus;
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

type HrLeaveRequestRow = {
  id: string;
  request_type: string;
  status: LeaveStatus;
  current_step: string | null;
  reason: string | null;
  payload: Record<string, string> | null;
  files: string[] | null;
  submitted_at: string | null;
  approved_at: string | null;
  created_at: string;
  users: {
    display_name: string | null;
    employees: {
      employee_no: string | null;
      full_name: string | null;
      companies: { name: string | null } | null;
      branches: { name: string | null } | null;
      departments: { name: string | null } | null;
    } | null;
  } | null;
};

type LeaveReportRow = {
  id: string;
  source: "leave_requests" | "hr_requests";
  month: string;
  company: string;
  department: string;
  branch: string;
  employeeNo: string;
  employeeName: string;
  leaveType: string;
  startsAt: string;
  endsAt: string;
  totalHours: number;
  status: LeaveStatus;
  currentStep: string;
  reason: string;
  attachments: string[];
  submittedAt: string;
  approvedAt: string;
};

const scopeLabels: Record<ReportScope, string> = {
  company: "公司",
  department: "部門",
  employee: "個人",
};

const statusLabels: Record<string, string> = {
  draft: "草稿",
  pending: "簽核中",
  approved: "已核准",
  rejected: "已駁回",
  cancelled: "已取消",
};

const statusStyles: Record<string, string> = {
  草稿: "bg-slate-50 text-slate-700",
  待我簽核: "bg-amber-50 text-amber-700",
  簽核中: "bg-amber-50 text-amber-700",
  已核准: "bg-emerald-50 text-emerald-700",
  已駁回: "bg-rose-50 text-rose-700",
  已取消: "bg-slate-50 text-slate-500",
  被退回: "bg-orange-50 text-orange-700",
};

function normalizeStatus(status: LeaveStatus) {
  return statusLabels[status] ?? status;
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
  if (!value) return "未記錄";
  return new Intl.DateTimeFormat("zh-TW", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Taipei",
  }).format(new Date(value));
}

function toIsoDate(date?: string, time?: string) {
  if (!date) return "";
  if (!time) return `${date}T00:00:00+08:00`;
  return `${date}T${time}:00+08:00`;
}

function hoursFromPayload(payload: Record<string, string> | null) {
  return Number(payload?.["請假時數"] ?? 0);
}

function exportRows(rows: LeaveReportRow[]) {
  return csv([
    ["月份", "來源", "公司", "部門", "據點", "員工編號", "姓名", "假別", "開始", "結束", "時數", "狀態", "目前關卡", "附件狀態", "附件", "原因", "送出時間", "核准時間"],
    ...rows.map((row) => [
      row.month,
      row.source,
      row.company,
      row.department,
      row.branch,
      row.employeeNo,
      row.employeeName,
      row.leaveType,
      formatDateTime(row.startsAt),
      formatDateTime(row.endsAt),
      row.totalHours,
      normalizeStatus(row.status),
      row.currentStep,
      row.attachments.length ? "已附" : "未附",
      row.attachments.join("、"),
      row.reason,
      row.submittedAt ? formatDateTime(row.submittedAt) : "未送出",
      row.approvedAt ? formatDateTime(row.approvedAt) : "未核准",
    ]),
  ]);
}

function toExcelTable(csvText: string) {
  return `<html><head><meta charset="utf-8" /></head><body><table>${csvText
    .split("\n")
    .map((line) => `<tr>${line.split(",").map((cell) => `<td>${cell.replaceAll("\"", "")}</td>`).join("")}</tr>`)
    .join("")}</table></body></html>`;
}

export default function LeaveReportsPage() {
  const currentUser = useCurrentUser();
  const [reportYear, setReportYear] = useState("2026");
  const [monthFrom, setMonthFrom] = useState("01");
  const [monthTo, setMonthTo] = useState("12");
  const [reportScope, setReportScope] = useState<ReportScope>("company");
  const [scopeValue, setScopeValue] = useState("全部");
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<LeaveReportRow[]>([]);
  const [message, setMessage] = useState("正在讀取 Supabase 請假紀錄與附件。");
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
      setMessage("Supabase 尚未設定，無法讀取請假紀錄。");
      return;
    }
    setLoading(true);
    try {
      const startDate = `${selectedMonths[0]}-01`;
      const endDate = nextMonthDate(selectedMonths[selectedMonths.length - 1]);
      let leaveQuery = supabase
        .from("leave_requests")
        .select(`
          id,
          company_id,
          employee_id,
          leave_type,
          starts_at,
          ends_at,
          total_hours,
          reason,
          attachment_ids,
          status,
          submitted_at,
          approved_at,
          companies(name),
          employees(employee_no, full_name, branches(name), departments(name))
        `)
        .gte("starts_at", `${startDate}T00:00:00+08:00`)
        .lt("starts_at", `${endDate}T00:00:00+08:00`)
        .is("deleted_at", null)
        .order("starts_at", { ascending: false });

      if (currentUser.companyId && currentUser.role !== "ceo") {
        leaveQuery = leaveQuery.eq("company_id", currentUser.companyId);
      }

      const hrQuery = supabase
        .from("hr_requests")
        .select(`
          id,
          request_type,
          status,
          current_step,
          reason,
          payload,
          files,
          submitted_at,
          approved_at,
          created_at,
          users(display_name, employees(employee_no, full_name, companies(name), branches(name), departments(name)))
        `)
        .eq("request_type", "請假")
        .is("deleted_at", null)
        .order("created_at", { ascending: false });

      const [leaveResult, hrResult] = await Promise.all([leaveQuery, hrQuery]);
      if (leaveResult.error) throw leaveResult.error;
      if (hrResult.error) throw hrResult.error;

      const formalRows = ((leaveResult.data ?? []) as unknown as LeaveRequestRow[]).map((row): LeaveReportRow => ({
        id: row.id,
        source: "leave_requests",
        month: row.starts_at.slice(0, 7),
        company: row.companies?.name ?? "未設定公司",
        department: row.employees?.departments?.name ?? "未設定部門",
        branch: row.employees?.branches?.name ?? "未設定據點",
        employeeNo: row.employees?.employee_no ?? "未設定",
        employeeName: row.employees?.full_name ?? "未命名員工",
        leaveType: row.leave_type,
        startsAt: row.starts_at,
        endsAt: row.ends_at,
        totalHours: Number(row.total_hours),
        status: row.status,
        currentStep: normalizeStatus(row.status),
        reason: row.reason ?? "",
        attachments: row.attachment_ids ?? [],
        submittedAt: row.submitted_at ?? "",
        approvedAt: row.approved_at ?? "",
      }));

      const workflowRows = ((hrResult.data ?? []) as unknown as HrLeaveRequestRow[])
        .map((row): LeaveReportRow => {
          const payload = row.payload ?? {};
          const startsAt = toIsoDate(payload["開始日期"] ?? payload["申請日期"], payload["開始時間"]);
          return {
            id: row.id,
            source: "hr_requests",
            month: (payload["開始日期"] ?? row.created_at).slice(0, 7),
            company: row.users?.employees?.companies?.name ?? "未設定公司",
            department: row.users?.employees?.departments?.name ?? "未設定部門",
            branch: row.users?.employees?.branches?.name ?? "未設定據點",
            employeeNo: row.users?.employees?.employee_no ?? "未設定",
            employeeName: row.users?.employees?.full_name ?? row.users?.display_name ?? "未命名員工",
            leaveType: payload["假別"] ?? "未設定",
            startsAt,
            endsAt: toIsoDate(payload["結束日期"] ?? payload["開始日期"], payload["結束時間"]),
            totalHours: hoursFromPayload(payload),
            status: row.status,
            currentStep: row.current_step ?? normalizeStatus(row.status),
            reason: row.reason ?? "",
            attachments: row.files ?? [],
            submittedAt: row.submitted_at ?? "",
            approvedAt: row.approved_at ?? "",
          };
        })
        .filter((row) => row.month >= selectedMonths[0] && row.month <= selectedMonths[selectedMonths.length - 1]);

      setRows([...formalRows, ...workflowRows].sort((a, b) => b.startsAt.localeCompare(a.startsAt)));
      setMessage(`${selectedPeriod} 已同步 leave_requests / hr_requests，含附件狀態。`);
    } catch (error) {
      setRows([]);
      setMessage(error instanceof Error ? error.message : "請假紀錄讀取失敗。");
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
        row.company,
        row.department,
        row.employeeNo,
        row.employeeName,
        row.leaveType,
        normalizeStatus(row.status),
        row.attachments.join(" "),
      ].join(" ").toLowerCase().includes(keyword);
      return matchesScope && matchesQuery;
    });
  }, [query, reportScope, rows, scopeValue]);

  const totals = useMemo(() => ({
    requests: filteredRows.length,
    approved: filteredRows.filter((row) => normalizeStatus(row.status) === "已核准").length,
    hours: filteredRows.reduce((sum, row) => sum + row.totalHours, 0),
    attachments: filteredRows.filter((row) => row.attachments.length > 0).length,
  }), [filteredRows]);

  function downloadCsv() {
    const content = exportRows(filteredRows);
    downloadTextFile(`leave-records-${selectedPeriod}-${reportScope}-${scopeValue}.csv`, content);
    setMessage(`${selectedPeriod} 請假紀錄 CSV 匯出完成，共 ${filteredRows.length} 筆。`);
  }

  function downloadExcel() {
    const content = exportRows(filteredRows);
    downloadTextFile(
      `leave-records-${selectedPeriod}-${reportScope}-${scopeValue}.xls`,
      toExcelTable(content),
      "application/vnd.ms-excel;charset=utf-8",
    );
    setMessage(`${selectedPeriod} 請假紀錄 Excel 匯出完成，共 ${filteredRows.length} 筆。`);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-medium text-sky-700">Leave Records</p>
          <h1 className="text-2xl font-semibold text-slate-950">請假紀錄與附件</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-500">
            可依公司、部門、個人查詢 1-12 個月請假紀錄，並檢查附件是否已留存；資料同步正式請假表與 HR 表單流程。
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
          { label: "請假筆數", value: `${totals.requests} 筆`, icon: CalendarDays, tone: "bg-sky-50 text-sky-700" },
          { label: "已核准", value: `${totals.approved} 筆`, icon: CheckCircle2, tone: "bg-emerald-50 text-emerald-700" },
          { label: "請假時數", value: `${totals.hours.toFixed(1)} 小時`, icon: Timer, tone: "bg-amber-50 text-amber-700" },
          { label: "有附件", value: `${totals.attachments} 筆`, icon: Paperclip, tone: "bg-violet-50 text-violet-700" },
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
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜尋員工、假別、狀態、附件" className="w-full rounded-lg border border-slate-200 py-2 pl-9 pr-3 text-sm outline-none focus:border-sky-300" />
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-2 border-b border-slate-200 p-5 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">{selectedPeriod} 請假紀錄</h2>
            <p className="text-sm text-slate-500">{scopeLabels[reportScope]}：{scopeValue}。附件欄會顯示正式附件 ID 或表單上傳檔名。</p>
          </div>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">{message}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1380px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">月份</th>
                <th className="px-4 py-3">公司</th>
                <th className="px-4 py-3">部門</th>
                <th className="px-4 py-3">員工</th>
                <th className="px-4 py-3">假別</th>
                <th className="px-4 py-3">期間</th>
                <th className="px-4 py-3">時數</th>
                <th className="px-4 py-3">狀態</th>
                <th className="px-4 py-3">附件</th>
                <th className="px-4 py-3">原因</th>
                <th className="px-4 py-3">來源</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredRows.map((row) => (
                <tr key={`${row.source}-${row.id}`} className="align-top hover:bg-slate-50">
                  <td className="px-4 py-4 font-semibold text-slate-950">{row.month}</td>
                  <td className="px-4 py-4 text-slate-700">{row.company}</td>
                  <td className="px-4 py-4 text-slate-700">{row.department}</td>
                  <td className="px-4 py-4">
                    <p className="font-semibold text-slate-950">{row.employeeName}</p>
                    <p className="text-xs text-slate-500">{row.employeeNo} / {row.branch}</p>
                  </td>
                  <td className="px-4 py-4 text-slate-700">{row.leaveType}</td>
                  <td className="px-4 py-4 text-slate-700">{formatDateTime(row.startsAt)} - {formatDateTime(row.endsAt)}</td>
                  <td className="px-4 py-4 font-semibold text-slate-950">{row.totalHours.toFixed(1)}</td>
                  <td className="px-4 py-4">
                    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusStyles[normalizeStatus(row.status)] ?? "bg-slate-50 text-slate-700"}`}>{normalizeStatus(row.status)}</span>
                    <p className="mt-2 text-xs text-slate-500">{row.currentStep}</p>
                  </td>
                  <td className="px-4 py-4">
                    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${row.attachments.length ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>
                      {row.attachments.length ? "已附" : "未附"}
                    </span>
                    <p className="mt-2 max-w-xs text-xs text-slate-500">{row.attachments.join("、") || "無附件紀錄"}</p>
                  </td>
                  <td className="px-4 py-4 max-w-xs text-slate-600">{row.reason || "未填寫"}</td>
                  <td className="px-4 py-4 text-xs text-slate-500">{row.source}</td>
                </tr>
              ))}
              {!filteredRows.length ? (
                <tr>
                  <td colSpan={11} className="px-4 py-10 text-center text-sm font-semibold text-slate-500">目前期間沒有符合條件的請假紀錄。</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid gap-5 md:grid-cols-2">
        <div className="rounded-lg border border-sky-200 bg-sky-50 p-5">
          <div className="mb-3 flex items-center gap-2">
            <FileText className="h-5 w-5 text-sky-700" />
            <h2 className="font-semibold text-sky-900">雙資料源確認</h2>
          </div>
          <p className="text-sm text-sky-800">頁面同時讀取正式 `leave_requests` 與一般表單 `hr_requests`，避免舊流程資料漏掉。</p>
        </div>
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-5">
          <div className="mb-3 flex items-center gap-2">
            <Paperclip className="h-5 w-5 text-amber-700" />
            <h2 className="font-semibold text-amber-900">附件稽核</h2>
          </div>
          <p className="text-sm text-amber-800">附件欄會標示已附或未附，匯出時保留附件 ID / 檔名供人資補件追蹤。</p>
        </div>
      </section>
    </div>
  );
}
