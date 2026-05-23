"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarRange,
  ClipboardCopy,
  FileUp,
  Grid3X3,
  Layers,
  ListChecks,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import {
  formatComplianceMessage,
  validateSchedulePublication,
  type ComplianceIssue,
} from "@/lib/compliance/compliance-engine";

type SupabaseClient = {
  // The live HR schema is ahead of the generated Database type in this repo.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any;
};

type ViewMode = "month" | "week" | "day";
type ScheduleScope = "employee" | "department" | "branch";
type ScheduleType = "regular" | "support" | "temporary" | "training" | "leave" | "holiday";

type EmployeeRow = {
  id: string;
  company_id: string;
  employee_no: string;
  full_name: string;
  primary_branch_id: string | null;
  primary_department_id: string | null;
  branches?: { name: string | null } | null;
  departments?: { name: string | null } | null;
};

type ShiftRow = {
  id: string;
  company_id: string;
  branch_id: string | null;
  code: string;
  name: string;
  start_time: string;
  end_time: string;
  crosses_midnight: boolean;
  is_active: boolean;
};

type ScheduleRow = {
  id: string;
  company_id: string;
  branch_id: string | null;
  department_id: string | null;
  employee_id: string;
  shift_id: string | null;
  work_date: string;
  planned_start: string | null;
  planned_end: string | null;
  schedule_type: ScheduleType;
  note: string | null;
  employees?: {
    employee_no: string | null;
    full_name: string | null;
    branches?: { name: string | null } | null;
    departments?: { name: string | null } | null;
  } | null;
  shifts?: {
    name: string | null;
    start_time: string | null;
    end_time: string | null;
  } | null;
};

type ScheduleItem = {
  id: string;
  companyId: string;
  branchId: string | null;
  departmentId: string | null;
  employeeId: string;
  shiftId: string | null;
  date: string;
  employee: string;
  employeeNo: string;
  department: string;
  branch: string;
  shift: string;
  time: string;
  color: string;
  scheduleType: ScheduleType;
};

const colorClasses = [
  "bg-emerald-600",
  "bg-sky-600",
  "bg-amber-600",
  "bg-violet-600",
  "bg-indigo-600",
  "bg-cyan-600",
  "bg-slate-600",
];

function getClient() {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase 尚未設定，無法讀寫排班資料。");
  return supabase as unknown as SupabaseClient;
}

function getCurrentMonthValue() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function formatDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function getMonthRange(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const first = new Date(year, monthNumber - 1, 1);
  const last = new Date(year, monthNumber, 0);
  return {
    year,
    monthNumber,
    firstDate: formatDateKey(first),
    lastDate: formatDateKey(last),
    daysInMonth: last.getDate(),
    leadingBlankDays: first.getDay(),
  };
}

function addDays(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T00:00:00+08:00`);
  date.setDate(date.getDate() + days);
  return formatDateKey(date);
}

function toDateTime(dateKey: string, time: string | null | undefined, crossesMidnight = false) {
  const normalized = (time || "00:00").slice(0, 5);
  const base = new Date(`${dateKey}T${normalized}:00+08:00`);
  if (crossesMidnight) base.setDate(base.getDate() + 1);
  return base.toISOString();
}

function formatTime(value: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("zh-TW", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Taipei",
  }).format(new Date(value));
}

function colorFromShift(shiftId: string | null) {
  const seed = shiftId ? Array.from(shiftId).reduce((sum, char) => sum + char.charCodeAt(0), 0) : 0;
  return colorClasses[seed % colorClasses.length];
}

function mapSchedule(row: ScheduleRow): ScheduleItem {
  return {
    id: row.id,
    companyId: row.company_id,
    branchId: row.branch_id,
    departmentId: row.department_id,
    employeeId: row.employee_id,
    shiftId: row.shift_id,
    date: row.work_date,
    employee: row.employees?.full_name ?? "未設定員工",
    employeeNo: row.employees?.employee_no ?? "",
    department: row.employees?.departments?.name ?? "未設定部門",
    branch: row.employees?.branches?.name ?? "未設定據點",
    shift: row.shifts?.name ?? row.note ?? "未設定班別",
    time: `${formatTime(row.planned_start)}-${formatTime(row.planned_end)}`,
    color: colorFromShift(row.shift_id),
    scheduleType: row.schedule_type,
  };
}

function getVisibleDates(mode: ViewMode, month: string) {
  const range = getMonthRange(month);
  const dates = Array.from({ length: range.daysInMonth }, (_, index) => `${month}-${String(index + 1).padStart(2, "0")}`);
  if (mode === "day") return [dates.find((date) => date >= formatDateKey(new Date())) ?? dates[0]];
  if (mode === "week") {
    const today = formatDateKey(new Date());
    const anchor = dates.includes(today) ? today : dates[0];
    const anchorDate = new Date(`${anchor}T00:00:00+08:00`);
    const start = new Date(anchorDate);
    start.setDate(anchorDate.getDate() - anchorDate.getDay());
    return Array.from({ length: 7 }, (_, index) => formatDateKey(new Date(start.getFullYear(), start.getMonth(), start.getDate() + index)))
      .filter((date) => date.startsWith(month));
  }
  return dates;
}

export default function ScheduleCalendarPage() {
  const currentUser = useCurrentUser();
  const [viewMode, setViewMode] = useState<ViewMode>("month");
  const [scope, setScope] = useState<ScheduleScope>("employee");
  const [month, setMonth] = useState(getCurrentMonthValue);
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [shifts, setShifts] = useState<ShiftRow[]>([]);
  const [schedules, setSchedules] = useState<ScheduleItem[]>([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");
  const [selectedShiftId, setSelectedShiftId] = useState("");
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [complianceIssues, setComplianceIssues] = useState<ComplianceIssue[]>([]);
  const [message, setMessage] = useState("可拖曳排班卡片到其他日期，調整會直接更新 Supabase schedules。");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const range = useMemo(() => getMonthRange(month), [month]);
  const visibleDates = useMemo(() => getVisibleDates(viewMode, month), [viewMode, month]);
  const visibleSchedules = useMemo(
    () => schedules.filter((item) => visibleDates.includes(item.date)),
    [schedules, visibleDates],
  );

  const selectedEmployee = employees.find((employee) => employee.id === selectedEmployeeId);
  const selectedShift = shifts.find((shift) => shift.id === selectedShiftId);

  async function loadData() {
    setLoading(true);
    try {
      const supabase = getClient();
      let employeeQuery = supabase
        .from("employees")
        .select("id, company_id, employee_no, full_name, primary_branch_id, primary_department_id, branches(name), departments(name)")
        .is("deleted_at", null)
        .order("employee_no");
      let shiftQuery = supabase
        .from("shifts")
        .select("id, company_id, branch_id, code, name, start_time, end_time, crosses_midnight, is_active")
        .is("deleted_at", null)
        .eq("is_active", true)
        .order("code");
      let scheduleQuery = supabase
        .from("schedules")
        .select(`
          id,
          company_id,
          branch_id,
          department_id,
          employee_id,
          shift_id,
          work_date,
          planned_start,
          planned_end,
          schedule_type,
          note,
          employees(employee_no, full_name, branches(name), departments(name)),
          shifts(name, start_time, end_time)
        `)
        .is("deleted_at", null)
        .gte("work_date", range.firstDate)
        .lte("work_date", range.lastDate)
        .order("work_date");

      if (currentUser.companyId && currentUser.role !== "ceo") {
        employeeQuery = employeeQuery.eq("company_id", currentUser.companyId);
        shiftQuery = shiftQuery.eq("company_id", currentUser.companyId);
        scheduleQuery = scheduleQuery.eq("company_id", currentUser.companyId);
      }
      if (currentUser.role === "supervisor" && currentUser.departmentId) {
        employeeQuery = employeeQuery.eq("primary_department_id", currentUser.departmentId);
        scheduleQuery = scheduleQuery.eq("department_id", currentUser.departmentId);
      }

      const [employeeResult, shiftResult, scheduleResult] = await Promise.all([employeeQuery, shiftQuery, scheduleQuery]);
      if (employeeResult.error) throw employeeResult.error;
      if (shiftResult.error) throw shiftResult.error;
      if (scheduleResult.error) throw scheduleResult.error;

      const employeeRows = (employeeResult.data ?? []) as unknown as EmployeeRow[];
      const shiftRows = (shiftResult.data ?? []) as unknown as ShiftRow[];
      const scheduleRows = ((scheduleResult.data ?? []) as unknown as ScheduleRow[]).map(mapSchedule);
      setEmployees(employeeRows);
      setShifts(shiftRows);
      setSchedules(scheduleRows);
      setSelectedEmployeeId((current) => (current && employeeRows.some((employee) => employee.id === current) ? current : employeeRows[0]?.id ?? ""));
      setSelectedShiftId((current) => (current && shiftRows.some((shift) => shift.id === current) ? current : shiftRows[0]?.id ?? ""));
      setMessage("排班資料已從 Supabase schedules 載入。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "排班資料載入失敗。");
      setSchedules([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, [currentUser.companyId, currentUser.role, currentUser.departmentId, month]);

  function runCompliance(items: ScheduleItem[]) {
    const compliance = validateSchedulePublication(items);
    setComplianceIssues(compliance.issues);
    if (compliance.blocked) {
      setMessage(formatComplianceMessage(compliance));
      return false;
    }
    return true;
  }

  async function updateScheduleDate(schedule: ScheduleItem, targetDate: string) {
    const shift = shifts.find((item) => item.id === schedule.shiftId);
    const plannedStart = toDateTime(targetDate, shift?.start_time, false);
    const plannedEnd = toDateTime(targetDate, shift?.end_time, shift?.crosses_midnight);
    const supabase = getClient();
    const { error } = await supabase
      .from("schedules")
      .update({
        work_date: targetDate,
        planned_start: plannedStart,
        planned_end: plannedEnd,
        updated_at: new Date().toISOString(),
      })
      .eq("id", schedule.id);
    if (error) throw error;
  }

  async function moveSchedule(targetDate: string) {
    if (!draggedId) return;
    const target = schedules.find((item) => item.id === draggedId);
    if (!target) return;
    const nextSchedules = schedules.map((item) => (item.id === draggedId ? { ...item, date: targetDate } : item));
    if (!runCompliance(nextSchedules)) {
      setDraggedId(null);
      return;
    }

    setSaving(true);
    try {
      await updateScheduleDate(target, targetDate);
      setMessage("已拖曳調整班別日期，並寫入 Supabase schedules。");
      await loadData();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "拖曳調整班別失敗。");
    } finally {
      setSaving(false);
      setDraggedId(null);
    }
  }

  function buildSchedulePayload(employee: EmployeeRow, shift: ShiftRow, date: string, source: string) {
    return {
      company_id: employee.company_id,
      branch_id: employee.primary_branch_id,
      department_id: employee.primary_department_id,
      employee_id: employee.id,
      shift_id: shift.id,
      work_date: date,
      planned_start: toDateTime(date, shift.start_time, false),
      planned_end: toDateTime(date, shift.end_time, shift.crosses_midnight),
      schedule_type: "regular" as ScheduleType,
      source_module: source,
      note: `${source}: ${shift.name}`,
      updated_at: new Date().toISOString(),
    };
  }

  async function copyPreviousWeek() {
    const copiedSource = schedules.filter((item) => {
      const targetDate = addDays(item.date, 7);
      return targetDate >= range.firstDate && targetDate <= range.lastDate;
    });
    if (!copiedSource.length) {
      setMessage("找不到可複製到本月的上週班表。");
      return;
    }

    setSaving(true);
    try {
      const supabase = getClient();
      const payloads = copiedSource
        .map((item) => {
          const employee = employees.find((row) => row.id === item.employeeId);
          const shift = shifts.find((row) => row.id === item.shiftId);
          if (!employee || !shift) return null;
          return buildSchedulePayload(employee, shift, addDays(item.date, 7), "copy_previous_week");
        })
        .filter(Boolean);
      const { error } = await supabase.from("schedules").upsert(payloads, { onConflict: "employee_id,work_date" });
      if (error) throw error;
      setMessage(`已複製 ${payloads.length} 筆上週班表，並寫入 Supabase schedules。`);
      await loadData();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "複製上週班表失敗。");
    } finally {
      setSaving(false);
    }
  }

  async function batchSchedule() {
    if (!selectedEmployee || !selectedShift) {
      setMessage("請先選擇員工與班別，才能批次排班。");
      return;
    }
    const batchDates = visibleDates.slice(0, 5);
    const previewItems: ScheduleItem[] = batchDates.map((date, index) => ({
      id: `preview-${index}`,
      companyId: selectedEmployee.company_id,
      branchId: selectedEmployee.primary_branch_id,
      departmentId: selectedEmployee.primary_department_id,
      employeeId: selectedEmployee.id,
      shiftId: selectedShift.id,
      date,
      employee: selectedEmployee.full_name,
      employeeNo: selectedEmployee.employee_no,
      department: selectedEmployee.departments?.name ?? "未設定部門",
      branch: selectedEmployee.branches?.name ?? "未設定據點",
      shift: selectedShift.name,
      time: `${selectedShift.start_time.slice(0, 5)}-${selectedShift.end_time.slice(0, 5)}`,
      color: colorFromShift(selectedShift.id),
      scheduleType: "regular",
    }));
    if (!runCompliance([...schedules, ...previewItems])) return;

    setSaving(true);
    try {
      const supabase = getClient();
      const payloads = batchDates.map((date) => buildSchedulePayload(selectedEmployee, selectedShift, date, "batch_schedule"));
      const { error } = await supabase.from("schedules").upsert(payloads, { onConflict: "employee_id,work_date" });
      if (error) throw error;
      setMessage(`已批次排入 ${payloads.length} 天班表，並寫入 Supabase schedules。`);
      await loadData();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "批次排班失敗。");
    } finally {
      setSaving(false);
    }
  }

  function publishSchedules() {
    const passed = runCompliance(schedules);
    setMessage(passed ? "班表發布前法規檢核通過；現有排班已存在 Supabase，可通知員工。" : message);
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="text-sm font-semibold tracking-[0.14em] text-primary">SCHEDULE CALENDAR</p>
          <h1 className="mt-2 text-2xl font-black text-foreground">排班月曆</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            支援月、週、日檢視，拖曳調整、複製上週與批次排班會直接寫入 Supabase schedules。
          </p>
        </div>
        <Badge variant="secondary">{loading ? "載入中" : `${visibleSchedules.length} 筆排班`}</Badge>
      </div>

      <Card className="rounded-lg">
        <CardContent className="space-y-4 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2">
              {([
                ["month", "月檢視"],
                ["week", "週檢視"],
                ["day", "日檢視"],
              ] as Array<[ViewMode, string]>).map(([mode, label]) => (
                <Button
                  key={mode}
                  size="sm"
                  variant={viewMode === mode ? "default" : "outline"}
                  onClick={() => setViewMode(mode)}
                >
                  <Grid3X3 className="h-4 w-4" />
                  {label}
                </Button>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              {([
                ["employee", "員工排班"],
                ["department", "部門排班"],
                ["branch", "據點排班"],
              ] as Array<[ScheduleScope, string]>).map(([nextScope, label]) => (
                <Button
                  key={nextScope}
                  size="sm"
                  variant={scope === nextScope ? "default" : "outline"}
                  onClick={() => setScope(nextScope)}
                >
                  <Users className="h-4 w-4" />
                  {label}
                </Button>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => void loadData()} disabled={loading || saving}>
                <RefreshCw className="h-4 w-4" />
                重新整理
              </Button>
              <Button size="sm" variant="outline" onClick={() => void copyPreviousWeek()} disabled={saving || loading}>
                <ClipboardCopy className="h-4 w-4" />
                複製上週班表
              </Button>
              <Button size="sm" variant="outline" onClick={() => void batchSchedule()} disabled={saving || loading}>
                <ListChecks className="h-4 w-4" />
                批次排班
              </Button>
              <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()}>
                <FileUp className="h-4 w-4" />
                匯入 Excel 排班
              </Button>
              <Button size="sm" onClick={publishSchedules} disabled={saving || loading}>
                <ShieldCheck className="h-4 w-4" />
                發布班表
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={(event) => setMessage(`已選擇匯入檔案：${event.target.files?.[0]?.name ?? ""}；匯入解析會由 Excel 匯入中心寫入 schedules。`)}
              />
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <label className="space-y-1 text-sm font-semibold">
              月份
              <input
                type="month"
                value={month}
                onChange={(event) => setMonth(event.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
            </label>
            <label className="space-y-1 text-sm font-semibold">
              批次員工
              <select
                value={selectedEmployeeId}
                onChange={(event) => setSelectedEmployeeId(event.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                {employees.map((employee) => (
                  <option key={employee.id} value={employee.id}>
                    {employee.employee_no} / {employee.full_name}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-sm font-semibold">
              批次班別
              <select
                value={selectedShiftId}
                onChange={(event) => setSelectedShiftId(event.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                {shifts.map((shift) => (
                  <option key={shift.id} value={shift.id}>
                    {shift.code} / {shift.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </CardContent>
      </Card>

      <div className="rounded-lg bg-muted/70 p-3 text-sm text-muted-foreground">
        {loading ? "正在從 Supabase 載入排班..." : saving ? "正在寫入 Supabase schedules..." : message} 目前模式：
        {scope === "employee" ? "員工排班" : scope === "department" ? "部門排班" : "據點排班"}。
      </div>

      {complianceIssues.length ? (
        <Card className="rounded-lg border-amber-200 bg-amber-50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-amber-950">
              <ShieldCheck className="h-5 w-5" />
              排班法規合規檢核
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            {complianceIssues.map((issue) => (
              <div key={issue.code} className="rounded-lg bg-white p-4 text-sm shadow-sm">
                <div className={issue.severity === "blocking" ? "font-bold text-rose-700" : "font-bold text-amber-800"}>
                  {issue.severity === "blocking" ? "阻擋" : "提醒"} · {issue.title}
                </div>
                <p className="mt-2 text-slate-700">{issue.message}</p>
                <p className="mt-2 text-xs font-semibold text-slate-500">{issue.law} · {issue.article}</p>
                <p className="mt-1 text-xs text-slate-500">{issue.remediation}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Card className="rounded-lg">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarRange className="h-5 w-5 text-primary" />
            {range.year} 年 {range.monthNumber} 月排班
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex min-h-60 items-center justify-center gap-2 rounded-lg border text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              正在載入排班月曆...
            </div>
          ) : (
            <div className="grid grid-cols-1 overflow-hidden rounded-lg border text-sm md:grid-cols-7">
              {["日", "一", "二", "三", "四", "五", "六"].map((weekday) => (
                <div key={weekday} className="hidden border-b bg-muted/70 p-3 text-center font-bold text-muted-foreground md:block">
                  {weekday}
                </div>
              ))}
              {viewMode === "month"
                ? Array.from({ length: range.leadingBlankDays }).map((_, index) => (
                    <div key={`blank-${index}`} className="hidden min-h-44 border-b border-r bg-muted/30 md:block" />
                  ))
                : null}
              {visibleDates.map((date) => {
                const dateSchedules = schedules.filter((item) => item.date === date);
                return (
                  <div
                    key={date}
                    className="min-h-44 border-b border-r bg-card p-3"
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={() => void moveSchedule(date)}
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <div className="font-black">{Number(date.slice(-2))}</div>
                      <Badge variant="secondary">{dateSchedules.length} 班</Badge>
                    </div>
                    <div className="space-y-2">
                      {dateSchedules.map((item) => (
                        <div
                          key={item.id}
                          draggable
                          onDragStart={() => setDraggedId(item.id)}
                          className={`cursor-move rounded-md p-2 text-xs text-white shadow-sm ${item.color}`}
                          title="拖曳調整班別，放開後會寫入 Supabase"
                        >
                          <div className="font-bold">
                            {scope === "employee"
                              ? item.employee
                              : scope === "department"
                                ? item.department
                                : item.branch}
                          </div>
                          <div className="mt-1 opacity-90">
                            {item.shift} / {item.time}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="rounded-lg">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Layers className="h-5 w-5 text-primary" />
            排班清單
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-hidden rounded-lg border">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[960px] text-left text-sm">
                <thead className="bg-muted/70 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-bold">日期</th>
                    <th className="px-4 py-3 font-bold">員工</th>
                    <th className="px-4 py-3 font-bold">部門</th>
                    <th className="px-4 py-3 font-bold">據點</th>
                    <th className="px-4 py-3 font-bold">班別</th>
                    <th className="px-4 py-3 font-bold">時間</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {visibleSchedules.map((item) => (
                    <tr key={`${item.id}-row`} className="bg-card hover:bg-muted/40">
                      <td className="px-4 py-3">{item.date}</td>
                      <td className="px-4 py-3 font-bold">{item.employeeNo} / {item.employee}</td>
                      <td className="px-4 py-3">{item.department}</td>
                      <td className="px-4 py-3">{item.branch}</td>
                      <td className="px-4 py-3">
                        <Badge className={item.color}>{item.shift}</Badge>
                      </td>
                      <td className="px-4 py-3">{item.time}</td>
                    </tr>
                  ))}
                  {!visibleSchedules.length ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-10 text-center text-sm font-semibold text-muted-foreground">
                        此區間尚無排班資料。
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
