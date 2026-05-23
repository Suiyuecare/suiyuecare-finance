"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, FileBarChart, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { getCurrentAppUser, getDefaultCompanyId, getLiveClient, writeAuditLog } from "@/lib/supabase/live-modules";

type ReportKey =
  | "personal_detail"
  | "department_summary"
  | "branch_summary"
  | "late_early"
  | "absence"
  | "missing_punch"
  | "field_punch"
  | "anomaly_list";

type ReportRow = Record<string, string | number>;

type AttendancePunchRow = {
  id: string;
  user_id: string;
  employee_id: string | null;
  punched_at: string;
  punch_type: string;
  address: string | null;
  rule_name: string | null;
  passed_rule: string | null;
  is_abnormal: boolean;
  abnormal_reason: string | null;
  review_status: string;
  users?: {
    display_name?: string | null;
    employees?: {
      employee_no?: string | null;
      full_name?: string | null;
      companies?: { name?: string | null } | null;
      departments?: { name?: string | null } | null;
      branches?: { name?: string | null } | null;
    } | null;
  } | null;
};

type ReportScope = "company" | "department" | "employee";

const reportLabels: Record<ReportKey, string> = {
  personal_detail: "個人出勤明細",
  department_summary: "部門出勤統計",
  branch_summary: "據點出勤統計",
  late_early: "遲到早退統計",
  absence: "曠職統計",
  missing_punch: "未打卡統計",
  field_punch: "外勤打卡統計",
  anomaly_list: "異常出勤清單",
};

const scopeLabels: Record<ReportScope, string> = {
  company: "公司",
  department: "部門",
  employee: "個人",
};

const monthOptions = Array.from({ length: 12 }, (_, index) => index + 1);

function padMonth(month: number) {
  return String(month).padStart(2, "0");
}

function getMonthEndDate(year: string, month: number) {
  return new Date(Number(year), month, 0).getDate();
}

function getDateRangeFromMonths(year: string, monthFrom: number, monthTo: number) {
  const startMonth = Math.min(monthFrom, monthTo);
  const endMonth = Math.max(monthFrom, monthTo);
  return {
    dateFrom: `${year}-${padMonth(startMonth)}-01`,
    dateTo: `${year}-${padMonth(endMonth)}-${getMonthEndDate(year, endMonth)}`,
    months: Array.from({ length: endMonth - startMonth + 1 }, (_, index) => startMonth + index),
  };
}

function formatTime(value: string | null) {
  if (!value) return "未打卡";
  return new Intl.DateTimeFormat("zh-TW", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Taipei",
  }).format(new Date(value));
}

function groupBy(rows: ReportRow[], key: string) {
  return rows.reduce<Record<string, ReportRow[]>>((acc, row) => {
    const groupKey = String(row[key] ?? "未分類");
    acc[groupKey] = [...(acc[groupKey] ?? []), row];
    return acc;
  }, {});
}

function normalizePunchType(type: string) {
  const labels: Record<string, string> = {
    clock_in: "上班",
    clock_out: "下班",
    out: "外出",
    return: "返回",
  };
  return labels[type] ?? type;
}

function buildBaseRows(punches: AttendancePunchRow[]): ReportRow[] {
  return punches.map((punch) => {
    const employee = punch.users?.employees;
    const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date(punch.punched_at));
    return {
      員工編號: employee?.employee_no ?? punch.user_id.slice(0, 8),
      姓名: employee?.full_name ?? punch.users?.display_name ?? "未命名使用者",
      公司: employee?.companies?.name ?? "未分類",
      部門: employee?.departments?.name ?? "未分類",
      據點: employee?.branches?.name ?? "未分類",
      日期: date,
      打卡類型: normalizePunchType(punch.punch_type),
      打卡時間: formatTime(punch.punched_at),
      地址: punch.address ?? "未提供",
      通過規則: punch.passed_rule ?? punch.rule_name ?? "未標記",
      異常數: punch.is_abnormal ? 1 : 0,
      異常類型: punch.is_abnormal ? (punch.abnormal_reason ?? "異常打卡") : "正常",
      審核狀態: punch.review_status,
    };
  });
}

function buildReportRows(report: ReportKey, punches: AttendancePunchRow[]): ReportRow[] {
  const baseRows = buildBaseRows(punches);

  if (report === "personal_detail") return baseRows;

  if (report === "department_summary" || report === "branch_summary") {
    const groupKey = report === "department_summary" ? "部門" : "據點";
    return Object.entries(groupBy(baseRows, groupKey)).map(([name, rows]) => ({
      [groupKey]: name,
      出勤人數: rows.length,
      異常人次: rows.reduce((sum, row) => sum + Number(row.異常數), 0),
      打卡筆數: rows.length,
      正常率: `${Math.round((rows.filter((row) => Number(row.異常數) === 0).length / rows.length) * 100)}%`,
    }));
  }

  if (report === "anomaly_list") {
    return baseRows.filter((row) => Number(row.異常數) > 0);
  }

  if (report === "field_punch") {
    return baseRows.filter((row) => ["外出", "返回"].includes(String(row.打卡類型)) || String(row.通過規則).includes("GPS"));
  }

  if (report === "late_early") {
    return baseRows.filter((row) => String(row.異常類型).includes("遲到") || String(row.異常類型).includes("早退"));
  }

  if (report === "absence") {
    return baseRows.filter((row) => String(row.異常類型).includes("曠職"));
  }

  if (report === "missing_punch") {
    return baseRows.filter((row) => String(row.異常類型).includes("未打"));
  }

  return baseRows.filter((row) => Number(row.異常數) > 0);
}

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function toExcelHtml(rows: ReportRow[]) {
  if (!rows.length) {
    return '<html><head><meta charset="utf-8" /></head><body><table><tr><td>無資料</td></tr></table></body></html>';
  }
  const headers = Object.keys(rows[0]);
  const body = rows.map((row) => headers.map((header) => row[header] ?? ""));
  return `<html><head><meta charset="utf-8" /></head><body><table>${[headers, ...body]
    .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(String(cell))}</td>`).join("")}</tr>`)
    .join("")}</table></body></html>`;
}

export default function AttendanceReportsPage() {
  const [activeReport, setActiveReport] = useState<ReportKey>("personal_detail");
  const [reportYear, setReportYear] = useState("2026");
  const [monthFrom, setMonthFrom] = useState(1);
  const [monthTo, setMonthTo] = useState(12);
  const [scope, setScope] = useState<ReportScope>("company");
  const [selectedScopeValue, setSelectedScopeValue] = useState("全部");
  const [keyword, setKeyword] = useState("");
  const [punches, setPunches] = useState<AttendancePunchRow[]>([]);
  const [message, setMessage] = useState("正在讀取 Supabase 出勤打卡資料...");

  useEffect(() => {
    void loadPunches();
  }, []);

  async function loadPunches() {
    try {
      const supabase = getLiveClient();
      const { data, error } = await supabase
        .from("attendance_punches")
        .select("id,user_id,employee_id,punched_at,punch_type,address,rule_name,passed_rule,is_abnormal,abnormal_reason,review_status,users(display_name,employees(employee_no,full_name,companies(name),departments(name),branches(name)))")
        .is("deleted_at", null)
        .order("punched_at", { ascending: false })
        .limit(2000);
      if (error) throw error;
      setPunches((data ?? []) as AttendancePunchRow[]);
      setMessage(`已連線 Supabase，載入 ${(data ?? []).length} 筆正式打卡資料。`);
    } catch (error) {
      setPunches([]);
      setMessage(error instanceof Error ? error.message : "出勤報表資料讀取失敗。");
    }
  }

  const reportRows = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLowerCase();
    const range = getDateRangeFromMonths(reportYear, monthFrom, monthTo);
    const scopeKey = scopeLabels[scope];
    const scopedPunches = punches.filter((punch) => {
      const row = buildBaseRows([punch])[0];
      const rowText = Object.values(row).join(" ").toLowerCase();
      const rowDate = String(row.日期 ?? "");
      const scopeMatched = selectedScopeValue === "全部" || String(row[scopeKey] ?? "") === selectedScopeValue;
      return (
        scopeMatched &&
        (!normalizedKeyword || rowText.includes(normalizedKeyword)) &&
        rowDate >= range.dateFrom &&
        rowDate <= range.dateTo
      );
    });

    return buildReportRows(activeReport, scopedPunches);
  }, [activeReport, keyword, monthFrom, monthTo, punches, reportYear, scope, selectedScopeValue]);

  const baseRows = useMemo(() => buildBaseRows(punches), [punches]);
  const scopeOptions = useMemo(() => {
    const key = scopeLabels[scope];
    return ["全部", ...Array.from(new Set(baseRows.map((row) => String(row[key] ?? "")).filter(Boolean))).sort()];
  }, [baseRows, scope]);
  const activeDateRange = useMemo(() => getDateRangeFromMonths(reportYear, monthFrom, monthTo), [monthFrom, monthTo, reportYear]);
  const monthCount = activeDateRange.months.length;

  function updateScope(nextScope: ReportScope) {
    setScope(nextScope);
    setSelectedScopeValue("全部");
    if (nextScope === "department") setActiveReport("department_summary");
    if (nextScope === "employee") setActiveReport("personal_detail");
  }

  async function exportExcel() {
    const blob = new Blob([toExcelHtml(reportRows)], {
      type: "application/vnd.ms-excel;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `attendance-${activeReport}-${scope}-${selectedScopeValue}-${activeDateRange.dateFrom}-${activeDateRange.dateTo}.xls`;
    link.click();
    URL.revokeObjectURL(url);
    try {
      const supabase = getLiveClient();
      const [companyId, user] = await Promise.all([getDefaultCompanyId(), getCurrentAppUser()]);
      const fileName = `attendance-${activeReport}-${scope}-${selectedScopeValue}-${activeDateRange.dateFrom}-${activeDateRange.dateTo}.xls`;
      const { error } = await supabase.from("report_export_batches").insert({
        company_id: companyId,
        requested_by: user.id,
        report_name: reportLabels[activeReport],
        report_category: "出勤",
        filter_params: {
          dateFrom: activeDateRange.dateFrom,
          dateTo: activeDateRange.dateTo,
          months: activeDateRange.months,
          reportYear,
          monthFrom,
          monthTo,
          scope,
          selectedScopeValue,
          keyword,
          activeReport,
        },
        row_count: reportRows.length,
        export_format: "xls",
        status: "completed",
        file_name: fileName,
      });
      if (error) throw error;
      await writeAuditLog({
        action: "attendance_report.export",
        resourceType: "report_export_batches",
        afterData: { activeReport, scope, selectedScopeValue, dateFrom: activeDateRange.dateFrom, dateTo: activeDateRange.dateTo, keyword, rowCount: reportRows.length },
      });
      setMessage(`已匯出 ${scopeLabels[scope]}「${selectedScopeValue}」${monthCount} 個月 ${reportLabels[activeReport]}，共 ${reportRows.length} 筆，並寫入匯出批次。`);
    } catch (error) {
      setMessage(error instanceof Error ? `檔案已下載，但匯出批次寫入失敗：${error.message}` : "檔案已下載，但匯出批次寫入失敗。");
    }
  }

  const headers = reportRows[0] ? Object.keys(reportRows[0]) : ["報表"];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-semibold tracking-[0.14em] text-primary">ATTENDANCE REPORTS</p>
          <h1 className="mt-2 text-2xl font-black text-foreground">出勤報表</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            支援公司、部門、個人三種範圍，並可選擇 1-12 個月出勤紀錄匯出。
          </p>
        </div>
        <Button onClick={() => void exportExcel()}>
          <Download className="h-4 w-4" />
          匯出 Excel
        </Button>
      </div>

      <Card className="rounded-lg">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileBarChart className="h-5 w-5 text-primary" />
            報表條件
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">{message}</div>
          <div className="flex flex-wrap gap-2">
            {Object.entries(reportLabels).map(([key, label]) => (
              <Button
                key={key}
                size="sm"
                variant={activeReport === key ? "default" : "outline"}
                onClick={() => setActiveReport(key as ReportKey)}
              >
                {label}
              </Button>
            ))}
          </div>

          <div className="grid gap-3 md:grid-cols-4">
            <label className="grid gap-1.5 text-sm font-semibold">
              年度
              <Input value={reportYear} onChange={(event) => setReportYear(event.target.value.replace(/\D/g, "").slice(0, 4) || "2026")} />
            </label>
            <label className="grid gap-1.5 text-sm font-semibold">
              起始月份
              <select value={monthFrom} onChange={(event) => setMonthFrom(Number(event.target.value))} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
                {monthOptions.map((month) => <option key={month} value={month}>{month} 月</option>)}
              </select>
            </label>
            <label className="grid gap-1.5 text-sm font-semibold">
              結束月份
              <select value={monthTo} onChange={(event) => setMonthTo(Number(event.target.value))} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
                {monthOptions.map((month) => <option key={month} value={month}>{month} 月</option>)}
              </select>
            </label>
            <label className="grid gap-1.5 text-sm font-semibold">
              報表範圍
              <select value={scope} onChange={(event) => updateScope(event.target.value as ReportScope)} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
                <option value="company">公司</option>
                <option value="department">部門</option>
                <option value="employee">個人</option>
              </select>
            </label>
          </div>

          <div className="grid gap-3 md:grid-cols-[1fr_1.4fr]">
            <label className="grid gap-1.5 text-sm font-semibold">
              {scopeLabels[scope]}對象
              <select value={selectedScopeValue} onChange={(event) => setSelectedScopeValue(event.target.value)} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
                {scopeOptions.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
            <label className="grid gap-1.5 text-sm font-semibold">
              關鍵字
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  className="pl-9"
                  value={keyword}
                  placeholder="搜尋員工、部門、據點、異常類型"
                  onChange={(event) => setKeyword(event.target.value)}
                />
              </div>
            </label>
          </div>
        </CardContent>
      </Card>

      <section className="grid gap-4 md:grid-cols-4">
        <Card className="rounded-lg">
          <CardContent className="p-4">
            <div className="text-sm text-muted-foreground">目前報表</div>
            <div className="mt-2 text-lg font-black">{reportLabels[activeReport]}</div>
          </CardContent>
        </Card>
        <Card className="rounded-lg">
          <CardContent className="p-4">
            <div className="text-sm text-muted-foreground">資料筆數</div>
            <div className="mt-2 text-2xl font-black">{reportRows.length}</div>
          </CardContent>
        </Card>
        <Card className="rounded-lg">
          <CardContent className="p-4">
            <div className="text-sm text-muted-foreground">月份區間</div>
            <div className="mt-2 text-sm font-bold">{reportYear} 年 {Math.min(monthFrom, monthTo)}-{Math.max(monthFrom, monthTo)} 月，共 {monthCount} 個月</div>
          </CardContent>
        </Card>
        <Card className="rounded-lg">
          <CardContent className="p-4">
            <div className="text-sm text-muted-foreground">報表範圍</div>
            <div className="mt-2 text-sm font-black">{scopeLabels[scope]}：{selectedScopeValue}</div>
          </CardContent>
        </Card>
      </section>

      <Card className="rounded-lg">
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle>{reportLabels[activeReport]}</CardTitle>
          <Badge variant="secondary">{reportRows.length} 筆</Badge>
        </CardHeader>
        <CardContent>
          <div className="overflow-hidden rounded-lg border">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] text-left text-sm">
                <thead className="bg-muted/70 text-xs text-muted-foreground">
                  <tr>
                    {headers.map((header) => (
                      <th key={header} className="px-4 py-3 font-bold">
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {reportRows.length ? (
                    reportRows.map((row, index) => (
                      <tr key={`${activeReport}-${index}`} className="bg-card hover:bg-muted/40">
                        {headers.map((header) => (
                          <td key={header} className="px-4 py-3">
                            {row[header] ?? ""}
                          </td>
                        ))}
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td className="px-4 py-8 text-center text-muted-foreground" colSpan={headers.length}>
                        此條件查無資料。
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
