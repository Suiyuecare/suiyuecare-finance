"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CalendarDays, Clock3, FileClock, Loader2, Moon, Plane, PlusCircle, RefreshCw, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import { can } from "@/lib/auth/rbac";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

type SupabaseClient = {
  // The live HR schema is ahead of the generated Database type in this repo.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any;
};

type DayStatus = "normal" | "abnormal" | "leave" | "overtime" | "holiday" | "no_data";

type EmployeeOption = {
  id: string;
  employee_no: string;
  full_name: string;
  company_id: string;
  primary_branch_id: string | null;
  primary_department_id: string | null;
  branches?: { name: string | null } | null;
  departments?: { name: string | null } | null;
};

type ScheduleRow = {
  id: string;
  employee_id: string;
  work_date: string;
  planned_start: string | null;
  planned_end: string | null;
  schedule_type: "regular" | "support" | "temporary" | "training" | "leave" | "holiday";
  note: string | null;
  shifts?: { name: string | null; start_time: string | null; end_time: string | null } | null;
};

type AttendanceRecordRow = {
  id: string;
  employee_id: string;
  schedule_id: string | null;
  work_date: string;
  clock_in_at: string | null;
  clock_out_at: string | null;
  status: "normal" | "late" | "early_leave" | "absent" | "missing_punch" | "overtime" | "exception";
  anomaly_code: string | null;
  note: string | null;
};

type LeaveRequestRow = {
  id: string;
  employee_id: string;
  leave_type: string;
  starts_at: string;
  ends_at: string;
  total_hours: number;
  status: "draft" | "pending" | "approved" | "rejected" | "cancelled";
};

type OvertimeRequestRow = {
  id: string;
  employee_id: string;
  work_date: string;
  starts_at: string;
  ends_at: string;
  total_hours: number;
  overtime_type: "weekday" | "rest_day" | "holiday" | "regular_holiday";
  status: "draft" | "pending" | "approved" | "rejected" | "cancelled";
};

type PunchCorrectionRow = {
  id: string;
  employee_id: string;
  work_date: string;
  correction_type: "clock_in" | "clock_out" | "both";
  requested_clock_in_at: string | null;
  requested_clock_out_at: string | null;
  status: "draft" | "pending" | "approved" | "rejected" | "cancelled";
};

type AttendanceDay = {
  date: string;
  day: number;
  weekday: string;
  shift: string;
  scheduledStart: string;
  scheduledEnd: string;
  actualClockIn: string;
  actualClockOut: string;
  leave: string;
  overtime: string;
  anomaly: string;
  punchCorrection: string;
  status: DayStatus;
};

type AttendanceSourceState = {
  schedules: ScheduleRow[];
  attendanceRecords: AttendanceRecordRow[];
  leaveRequests: LeaveRequestRow[];
  overtimeRequests: OvertimeRequestRow[];
  punchCorrections: PunchCorrectionRow[];
};

const emptySources: AttendanceSourceState = {
  schedules: [],
  attendanceRecords: [],
  leaveRequests: [],
  overtimeRequests: [],
  punchCorrections: [],
};

const statusStyles: Record<DayStatus, string> = {
  normal: "border-emerald-200 bg-emerald-50",
  abnormal: "border-rose-200 bg-rose-50",
  leave: "border-sky-200 bg-sky-50",
  overtime: "border-amber-200 bg-amber-50",
  holiday: "border-slate-200 bg-slate-50",
  no_data: "border-slate-200 bg-white",
};

const statusLabels: Record<DayStatus, string> = {
  normal: "正常",
  abnormal: "異常",
  leave: "請假",
  overtime: "加班",
  holiday: "休假",
  no_data: "無資料",
};

const statusBadgeClass: Record<DayStatus, string> = {
  normal: "bg-emerald-600",
  abnormal: "bg-rose-600",
  leave: "bg-sky-600",
  overtime: "bg-amber-600",
  holiday: "bg-slate-500",
  no_data: "bg-slate-400",
};

const leaveTypeLabels: Record<string, string> = {
  annual_leave: "特休",
  personal_leave: "事假",
  sick_leave: "病假",
  menstrual_leave: "生理假",
  marriage_leave: "婚假",
  bereavement_leave: "喪假",
  maternity_leave: "產假",
  prenatal_leave: "產檢假",
  paternity_leave: "陪產檢及陪產假",
  official_leave: "公假",
  compensatory_leave: "補休",
  family_care_leave: "家庭照顧假",
  unpaid_leave: "育嬰留職停薪",
};

const overtimeTypeLabels: Record<string, string> = {
  weekday: "平日加班",
  rest_day: "休息日加班",
  holiday: "國定假日加班",
  regular_holiday: "例假日出勤",
};

const anomalyLabels: Record<string, string> = {
  normal: "",
  late: "遲到",
  early_leave: "早退",
  absent: "曠職",
  missing_punch: "未打卡",
  overtime: "工時超過",
  exception: "出勤異常",
};

const weekdays = ["日", "一", "二", "三", "四", "五", "六"];

function getClient() {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase 尚未設定，無法讀取出勤月曆。");
  return supabase as unknown as SupabaseClient;
}

function getCurrentMonthValue() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function getMonthRange(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const first = new Date(year, monthNumber - 1, 1);
  const last = new Date(year, monthNumber, 0);
  const nextFirst = new Date(year, monthNumber, 1);
  return {
    year,
    monthNumber,
    firstDate: formatDateKey(first),
    lastDate: formatDateKey(last),
    nextFirstDate: formatDateKey(nextFirst),
    daysInMonth: last.getDate(),
    leadingBlankDays: first.getDay(),
  };
}

function formatDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
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

function isDateWithinRange(dateKey: string, startsAt: string, endsAt: string) {
  const date = new Date(`${dateKey}T12:00:00+08:00`).getTime();
  const start = new Date(startsAt).getTime();
  const end = new Date(endsAt).getTime();
  return date >= start && date <= end;
}

function getShiftLabel(schedule?: ScheduleRow) {
  if (!schedule) return "未排班";
  if (schedule.schedule_type === "holiday") return "休假";
  if (schedule.schedule_type === "leave") return "請假排程";
  return schedule.shifts?.name ?? schedule.note ?? "已排班";
}

function getPunchCorrectionLabel(correction?: PunchCorrectionRow) {
  if (!correction) return "";
  const correctionType = correction.correction_type === "both" ? "補上下班卡" : correction.correction_type === "clock_in" ? "補上班卡" : "補下班卡";
  const status = correction.status === "approved" ? "已核准" : correction.status === "pending" ? "簽核中" : correction.status === "rejected" ? "已駁回" : correction.status === "cancelled" ? "已取消" : "草稿";
  return `${correctionType} ${status}`;
}

function buildCalendarDays(month: string, sources: AttendanceSourceState): AttendanceDay[] {
  const range = getMonthRange(month);

  return Array.from({ length: range.daysInMonth }, (_, index) => {
    const day = index + 1;
    const date = new Date(range.year, range.monthNumber - 1, day);
    const dateKey = formatDateKey(date);
    const schedule = sources.schedules.find((item) => item.work_date === dateKey);
    const attendance = sources.attendanceRecords.find((item) => item.work_date === dateKey);
    const leave = sources.leaveRequests.find((item) => item.status !== "cancelled" && item.status !== "rejected" && isDateWithinRange(dateKey, item.starts_at, item.ends_at));
    const overtime = sources.overtimeRequests.find((item) => item.status !== "cancelled" && item.status !== "rejected" && item.work_date === dateKey);
    const correction = sources.punchCorrections.find((item) => item.status !== "cancelled" && item.work_date === dateKey);
    const abnormal = attendance?.status && attendance.status !== "normal" && attendance.status !== "overtime";
    const isHoliday = schedule?.schedule_type === "holiday" || (!schedule && !attendance && !leave && !overtime && (date.getDay() === 0 || date.getDay() === 6));

    const status: DayStatus = abnormal
      ? "abnormal"
      : leave
        ? "leave"
        : overtime || attendance?.status === "overtime"
          ? "overtime"
          : schedule || attendance
            ? "normal"
            : isHoliday
              ? "holiday"
              : "no_data";

    return {
      date: dateKey,
      day,
      weekday: weekdays[date.getDay()],
      shift: getShiftLabel(schedule),
      scheduledStart: formatTime(schedule?.planned_start ?? null),
      scheduledEnd: formatTime(schedule?.planned_end ?? null),
      actualClockIn: formatTime(attendance?.clock_in_at ?? null),
      actualClockOut: formatTime(attendance?.clock_out_at ?? null),
      leave: leave ? `${leaveTypeLabels[leave.leave_type] ?? leave.leave_type} ${Number(leave.total_hours)}h / ${leave.status === "approved" ? "已核准" : "簽核中"}` : "",
      overtime: overtime ? `${overtimeTypeLabels[overtime.overtime_type] ?? overtime.overtime_type} ${Number(overtime.total_hours)}h / ${overtime.status === "approved" ? "已核准" : "簽核中"}` : "",
      anomaly: abnormal ? anomalyLabels[attendance.status] || attendance.anomaly_code || "出勤異常" : "",
      punchCorrection: getPunchCorrectionLabel(correction),
      status,
    };
  });
}

export default function AttendanceCalendarPage() {
  const currentUser = useCurrentUser();
  const [month, setMonth] = useState(getCurrentMonthValue);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");
  const [sources, setSources] = useState<AttendanceSourceState>(emptySources);
  const [employeeQuery, setEmployeeQuery] = useState("");
  const [loadingEmployees, setLoadingEmployees] = useState(true);
  const [loadingCalendar, setLoadingCalendar] = useState(false);
  const [message, setMessage] = useState("月曆會依 Supabase 的排班、打卡、請假、加班與補卡資料即時產生。");

  const canSwitchEmployee = can(currentUser.role, "attendance:view") && currentUser.role !== "team_member";
  const monthRange = useMemo(() => getMonthRange(month), [month]);
  const calendarDays = useMemo(() => buildCalendarDays(month, sources), [month, sources]);
  const selectedEmployee = employees.find((employee) => employee.id === selectedEmployeeId);
  const filteredEmployees = employees.filter((employee) => {
    const query = employeeQuery.trim().toLowerCase();
    if (!query) return true;
    return [employee.employee_no, employee.full_name, employee.branches?.name, employee.departments?.name].some((value) =>
      value?.toLowerCase().includes(query),
    );
  });

  const counts = calendarDays.reduce(
    (acc, day) => {
      acc[day.status] += 1;
      return acc;
    },
    { normal: 0, abnormal: 0, leave: 0, overtime: 0, holiday: 0, no_data: 0 } as Record<DayStatus, number>,
  );

  async function loadEmployees() {
    setLoadingEmployees(true);
    try {
      const supabase = getClient();
      let selfEmployeeId = "";

      if (currentUser.id) {
        const { data: profile, error: profileError } = await supabase
          .from("users")
          .select("employee_id")
          .eq("id", currentUser.id)
          .is("deleted_at", null)
          .maybeSingle();
        if (profileError) throw profileError;
        selfEmployeeId = (profile as { employee_id: string | null } | null)?.employee_id ?? "";
      }

      let query = supabase
        .from("employees")
        .select("id, employee_no, full_name, company_id, primary_branch_id, primary_department_id, branches(name), departments(name)")
        .is("deleted_at", null)
        .order("employee_no", { ascending: true });

      if (!canSwitchEmployee) {
        if (!selfEmployeeId) {
          setEmployees([]);
          setSelectedEmployeeId("");
          setMessage("找不到目前登入者對應的員工主檔，無法產生個人出勤月曆。");
          return;
        }
        query = query.eq("id", selfEmployeeId);
      } else if (currentUser.role === "supervisor") {
        if (currentUser.departmentId) query = query.eq("primary_department_id", currentUser.departmentId);
        else if (currentUser.primaryBranchId) query = query.eq("primary_branch_id", currentUser.primaryBranchId);
        else query = query.eq("company_id", currentUser.companyId);
      } else if (currentUser.companyId && currentUser.role !== "ceo") {
        query = query.eq("company_id", currentUser.companyId);
      }

      const { data, error } = await query;
      if (error) throw error;
      const rows = (data ?? []) as unknown as EmployeeOption[];
      setEmployees(rows);
      setSelectedEmployeeId((current) => (current && rows.some((employee) => employee.id === current) ? current : rows[0]?.id ?? ""));
      setMessage(rows.length ? "可查看員工已從 Supabase 載入。" : "目前查無可查看的員工。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "員工清單載入失敗。");
      setEmployees([]);
      setSelectedEmployeeId("");
    } finally {
      setLoadingEmployees(false);
    }
  }

  async function loadCalendar(employeeId = selectedEmployeeId, targetMonth = month) {
    if (!employeeId) {
      setSources(emptySources);
      return;
    }
    setLoadingCalendar(true);
    try {
      const supabase = getClient();
      const range = getMonthRange(targetMonth);
      const monthStart = `${range.firstDate}T00:00:00+08:00`;
      const nextMonthStart = `${range.nextFirstDate}T00:00:00+08:00`;

      const [scheduleResult, attendanceResult, leaveResult, overtimeResult, correctionResult] = await Promise.all([
        supabase
          .from("schedules")
          .select("id, employee_id, work_date, planned_start, planned_end, schedule_type, note, shifts(name,start_time,end_time)")
          .eq("employee_id", employeeId)
          .is("deleted_at", null)
          .gte("work_date", range.firstDate)
          .lte("work_date", range.lastDate)
          .order("work_date"),
        supabase
          .from("attendance_records")
          .select("id, employee_id, schedule_id, work_date, clock_in_at, clock_out_at, status, anomaly_code, note")
          .eq("employee_id", employeeId)
          .is("deleted_at", null)
          .gte("work_date", range.firstDate)
          .lte("work_date", range.lastDate)
          .order("work_date"),
        supabase
          .from("leave_requests")
          .select("id, employee_id, leave_type, starts_at, ends_at, total_hours, status")
          .eq("employee_id", employeeId)
          .is("deleted_at", null)
          .lte("starts_at", nextMonthStart)
          .gte("ends_at", monthStart)
          .order("starts_at"),
        supabase
          .from("overtime_requests")
          .select("id, employee_id, work_date, starts_at, ends_at, total_hours, overtime_type, status")
          .eq("employee_id", employeeId)
          .is("deleted_at", null)
          .gte("work_date", range.firstDate)
          .lte("work_date", range.lastDate)
          .order("work_date"),
        supabase
          .from("punch_correction_requests")
          .select("id, employee_id, work_date, correction_type, requested_clock_in_at, requested_clock_out_at, status")
          .eq("employee_id", employeeId)
          .is("deleted_at", null)
          .gte("work_date", range.firstDate)
          .lte("work_date", range.lastDate)
          .order("work_date"),
      ]);

      const firstError = [scheduleResult, attendanceResult, leaveResult, overtimeResult, correctionResult].find((result) => result.error)?.error;
      if (firstError) throw firstError;

      setSources({
        schedules: (scheduleResult.data ?? []) as unknown as ScheduleRow[],
        attendanceRecords: (attendanceResult.data ?? []) as AttendanceRecordRow[],
        leaveRequests: (leaveResult.data ?? []) as LeaveRequestRow[],
        overtimeRequests: (overtimeResult.data ?? []) as OvertimeRequestRow[],
        punchCorrections: (correctionResult.data ?? []) as PunchCorrectionRow[],
      });
      setMessage("出勤月曆已由 Supabase 真實資料重新產生。");
    } catch (error) {
      setSources(emptySources);
      setMessage(error instanceof Error ? error.message : "出勤月曆載入失敗。");
    } finally {
      setLoadingCalendar(false);
    }
  }

  useEffect(() => {
    if (!currentUser.id) return;
    void loadEmployees();
  }, [currentUser.id, currentUser.role, currentUser.companyId, currentUser.departmentId, currentUser.primaryBranchId]);

  useEffect(() => {
    void loadCalendar(selectedEmployeeId, month);
  }, [selectedEmployeeId, month]);

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="text-sm font-semibold tracking-[0.14em] text-primary">ATTENDANCE CALENDAR</p>
          <h1 className="mt-2 text-2xl font-black text-foreground">員工出勤月曆</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            由 Supabase 的班表、實際打卡、請假、加班與補卡申請合併產生，不再使用固定假資料。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">
            {selectedEmployee ? `${selectedEmployee.full_name} / ${selectedEmployee.employee_no}` : "未選擇員工"}
          </Badge>
          <Button onClick={() => void loadCalendar()} variant="outline" disabled={loadingCalendar || !selectedEmployeeId}>
            <RefreshCw className="mr-2 h-4 w-4" />
            重新整理
          </Button>
        </div>
      </div>

      <Card className="rounded-lg">
        <CardContent className="grid gap-3 p-4 lg:grid-cols-[180px_1fr_1fr]">
          <label className="space-y-1 text-sm font-semibold">
            月份
            <input
              type="month"
              value={month}
              onChange={(event) => setMonth(event.target.value)}
              className="w-full rounded-lg border bg-background px-3 py-2 text-sm font-normal outline-none focus:border-primary"
            />
          </label>

          {canSwitchEmployee ? (
            <label className="space-y-1 text-sm font-semibold">
              員工
              <select
                value={selectedEmployeeId}
                onChange={(event) => setSelectedEmployeeId(event.target.value)}
                disabled={loadingEmployees}
                className="w-full rounded-lg border bg-background px-3 py-2 text-sm font-normal outline-none focus:border-primary"
              >
                {filteredEmployees.map((employee) => (
                  <option key={employee.id} value={employee.id}>
                    {employee.employee_no} / {employee.full_name} / {employee.branches?.name ?? "未設據點"} / {employee.departments?.name ?? "未設部門"}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <div className="rounded-lg border bg-muted/40 px-3 py-2 text-sm">
              <div className="font-semibold">個人月曆</div>
              <div className="mt-1 text-muted-foreground">組員只能查看自己的出勤資料。</div>
            </div>
          )}

          <label className="relative space-y-1 text-sm font-semibold">
            搜尋員工
            <Search className="absolute bottom-2.5 left-3 h-4 w-4 text-muted-foreground" />
            <input
              value={employeeQuery}
              onChange={(event) => setEmployeeQuery(event.target.value)}
              disabled={!canSwitchEmployee}
              placeholder="搜尋員編、姓名、據點、部門"
              className="w-full rounded-lg border bg-background py-2 pl-9 pr-3 text-sm font-normal outline-none focus:border-primary disabled:bg-muted/50"
            />
          </label>

          <div className="rounded-lg border border-cyan-200 bg-cyan-50 px-3 py-2 text-sm font-semibold text-cyan-800 lg:col-span-3">
            {loadingEmployees || loadingCalendar ? "正在載入 Supabase 出勤資料..." : message}
          </div>
        </CardContent>
      </Card>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
        {[
          ["正常", counts.normal, "bg-emerald-600"],
          ["異常", counts.abnormal, "bg-rose-600"],
          ["請假", counts.leave, "bg-sky-600"],
          ["加班", counts.overtime, "bg-amber-600"],
          ["休假", counts.holiday, "bg-slate-500"],
          ["無資料", counts.no_data, "bg-slate-400"],
        ].map(([label, value, color]) => (
          <Card key={String(label)} className="rounded-lg">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span className={`h-3 w-3 rounded-full ${String(color)}`} />
                {String(label)}
              </div>
              <div className="mt-2 text-2xl font-black">{String(value)}</div>
            </CardContent>
          </Card>
        ))}
      </section>

      <Card className="rounded-lg">
        <CardHeader className="flex-col items-start gap-3 space-y-0 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <CalendarDays className="h-5 w-5 text-primary" />
              {monthRange.year} 年 {monthRange.monthNumber} 月
            </CardTitle>
            <p className="mt-2 text-sm text-muted-foreground">
              資料來源：schedules、attendance_records、leave_requests、overtime_requests、punch_correction_requests。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {Object.entries(statusLabels).map(([key, label]) => (
              <Badge key={key} className={statusBadgeClass[key as DayStatus]}>
                {label}
              </Badge>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          {loadingCalendar ? (
            <div className="flex min-h-60 items-center justify-center gap-2 rounded-lg border text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              正在產生出勤月曆...
            </div>
          ) : (
            <div className="grid grid-cols-1 overflow-hidden rounded-lg border text-sm md:grid-cols-7">
              {["日", "一", "二", "三", "四", "五", "六"].map((weekday) => (
                <div key={weekday} className="hidden border-b bg-muted/70 p-3 text-center font-bold text-muted-foreground md:block">
                  {weekday}
                </div>
              ))}
              {Array.from({ length: monthRange.leadingBlankDays }).map((_, index) => (
                <div key={`blank-${index}`} className="hidden min-h-40 border-b border-r bg-muted/30 md:block" />
              ))}
              {calendarDays.map((day) => (
                <div
                  key={day.date}
                  className={`min-h-40 border-b border-r p-3 ${statusStyles[day.status]}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-lg font-black">{day.day}</div>
                      <div className="text-xs text-muted-foreground">週{day.weekday}</div>
                    </div>
                    <Badge className={statusBadgeClass[day.status]}>{statusLabels[day.status]}</Badge>
                  </div>

                  <div className="mt-3 space-y-1.5 text-xs">
                    <div className="flex items-center gap-1 font-semibold">
                      <CalendarDays className="h-3.5 w-3.5 text-primary" />
                      {day.shift}
                    </div>
                    <div className="flex items-center gap-1 text-muted-foreground">
                      <Clock3 className="h-3.5 w-3.5" />
                      排班 {day.scheduledStart} - {day.scheduledEnd}
                    </div>
                    <div className="flex items-center gap-1 text-muted-foreground">
                      <Clock3 className="h-3.5 w-3.5" />
                      實際 {day.actualClockIn} - {day.actualClockOut}
                    </div>
                    {day.leave ? (
                      <div className="flex items-center gap-1 font-semibold text-sky-700">
                        <Plane className="h-3.5 w-3.5" />
                        {day.leave}
                      </div>
                    ) : null}
                    {day.overtime ? (
                      <div className="flex items-center gap-1 font-semibold text-amber-700">
                        <PlusCircle className="h-3.5 w-3.5" />
                        {day.overtime}
                      </div>
                    ) : null}
                    {day.anomaly ? (
                      <div className="flex items-center gap-1 font-semibold text-rose-700">
                        <AlertTriangle className="h-3.5 w-3.5" />
                        {day.anomaly}
                      </div>
                    ) : null}
                    {day.punchCorrection ? (
                      <div className="flex items-center gap-1 font-semibold text-violet-700">
                        <FileClock className="h-3.5 w-3.5" />
                        {day.punchCorrection}
                      </div>
                    ) : null}
                    {day.status === "holiday" && !day.overtime ? (
                      <div className="flex items-center gap-1 text-muted-foreground">
                        <Moon className="h-3.5 w-3.5" />
                        無排班
                      </div>
                    ) : null}
                    {day.status === "no_data" ? (
                      <div className="flex items-center gap-1 text-muted-foreground">
                        <Moon className="h-3.5 w-3.5" />
                        Supabase 尚無當日排班或打卡
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="rounded-lg">
        <CardHeader>
          <CardTitle>資料連動檢查</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-5">
          <SourceMetric label="排班" value={sources.schedules.length} />
          <SourceMetric label="打卡" value={sources.attendanceRecords.length} />
          <SourceMetric label="請假" value={sources.leaveRequests.length} />
          <SourceMetric label="加班" value={sources.overtimeRequests.length} />
          <SourceMetric label="補卡" value={sources.punchCorrections.length} />
        </CardContent>
      </Card>
    </div>
  );
}

function SourceMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border bg-muted/40 p-3">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-black">{value}</div>
    </div>
  );
}
