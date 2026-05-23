"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BadgeAlert,
  CalendarClock,
  CheckCircle2,
  FileWarning,
  Filter,
  Loader2,
  MapPin,
  RefreshCw,
  ShieldCheck,
  TimerReset,
  UserMinus,
  UsersRound,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

type SupabaseClient = {
  // The live HR schema is ahead of the generated Database type in this repo.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any;
};

type Severity = "block" | "warning" | "info";

type GuardType =
  | "連續上班天數過多"
  | "每日工時過長"
  | "每週工時過長"
  | "休息時間不足"
  | "同一員工同時段重複排班"
  | "請假期間被排班"
  | "離職員工被排班"
  | "證照不符者被排班"
  | "據點人力不足"
  | "班別衝突";

type Rule = {
  type: GuardType;
  description: string;
  threshold: string;
  severity: Severity;
  enabled: boolean;
  icon: LucideIcon;
};

type GuardStatus = "待處理" | "已調整" | "需主管確認";

type GuardIssue = {
  id: string;
  type: GuardType;
  employee: string;
  branch: string;
  department: string;
  date: string;
  shift: string;
  detail: string;
  recommendation: string;
  severity: Severity;
  status: GuardStatus;
  scheduleId?: string;
};

type StaffingGap = {
  id: string;
  date: string;
  branch: string;
  branchId: string | null;
  department: string;
  role: string;
  shift: string;
  required: number;
  available: number;
  shortage: number;
  impact: string;
  supportSource: string;
  action: string;
  severity: Severity;
  status: "待補人" | "已補足" | "需跨據點支援";
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
  schedule_type: string;
  source_module: string;
  note: string | null;
  employees?: {
    full_name: string | null;
    employee_no: string | null;
    employment_status: string | null;
    termination_date: string | null;
    metadata?: { daycare_role?: string; employee_group?: string } | null;
    positions?: { title: string | null } | null;
  } | null;
  branches?: { name: string | null; branch_type: string | null } | null;
  departments?: { name: string | null; department_type: string | null } | null;
  shifts?: { name: string | null; start_time: string | null; end_time: string | null } | null;
};

type LeaveRow = {
  id: string;
  employee_id: string;
  leave_type: string;
  starts_at: string;
  ends_at: string;
  status: string;
};

type LicenseRow = {
  employee_id: string;
  license_name: string;
  expires_at: string | null;
  status: string;
  attachment_status: string;
};

type SettingsRow = {
  id: string;
  settings: {
    rules?: Record<string, boolean>;
    resolutions?: Record<string, ResolutionRecord>;
  } | null;
};

type ResolutionRecord = {
  status: "resolved" | "manager_review";
  note: string;
  resolvedAt: string;
  resolvedBy: string;
};

const ruleDefaults: Rule[] = [
  {
    type: "連續上班天數過多",
    description: "避免員工連續工作過長，降低疲勞與職災風險。",
    threshold: "連續上班超過 6 天提醒，超過 7 天阻擋",
    severity: "warning",
    enabled: true,
    icon: CalendarClock,
  },
  {
    type: "每日工時過長",
    description: "檢查單日排班總工時是否超出可接受上限。",
    threshold: "單日工時超過 12 小時阻擋",
    severity: "block",
    enabled: true,
    icon: TimerReset,
  },
  {
    type: "每週工時過長",
    description: "依週期加總排班時數，避免過度排班。",
    threshold: "每週工時超過 48 小時提醒",
    severity: "warning",
    enabled: true,
    icon: TimerReset,
  },
  {
    type: "休息時間不足",
    description: "檢查前後班間隔，避免下班後過早再次上班。",
    threshold: "班間休息少於 11 小時提醒",
    severity: "warning",
    enabled: true,
    icon: BadgeAlert,
  },
  {
    type: "同一員工同時段重複排班",
    description: "同一員工不可在相同時間被排入兩個班或服務。",
    threshold: "時間區間重疊即阻擋",
    severity: "block",
    enabled: true,
    icon: RefreshCw,
  },
  {
    type: "請假期間被排班",
    description: "員工已核准請假期間不可再被排班。",
    threshold: "與核准假單重疊即阻擋",
    severity: "block",
    enabled: true,
    icon: UserMinus,
  },
  {
    type: "離職員工被排班",
    description: "離職或預計離職日後不得排班。",
    threshold: "排班日期晚於離職日即阻擋",
    severity: "block",
    enabled: true,
    icon: UserMinus,
  },
  {
    type: "證照不符者被排班",
    description: "特定服務或職務需符合有效證照與訓練資格。",
    threshold: "證照缺漏、過期或職務不符即阻擋",
    severity: "block",
    enabled: true,
    icon: ShieldCheck,
  },
  {
    type: "據點人力不足",
    description: "依據點、部門、職務最低人力檢查當日配置。",
    threshold: "低於最低人力需求即提醒",
    severity: "warning",
    enabled: true,
    icon: UsersRound,
  },
  {
    type: "班別衝突",
    description: "避免休假班、國定假日、特休、夜班等班別互相衝突。",
    threshold: "同日互斥班別並存即阻擋",
    severity: "block",
    enabled: true,
    icon: FileWarning,
  },
];

const severityStyles: Record<Severity, string> = {
  block: "border-rose-200 bg-rose-50 text-rose-700",
  warning: "border-amber-200 bg-amber-50 text-amber-700",
  info: "border-sky-200 bg-sky-50 text-sky-700",
};

const severityLabels: Record<Severity, string> = {
  block: "阻擋",
  warning: "提醒",
  info: "提示",
};

function getClient() {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase 尚未設定，無法讀寫排班防呆資料。");
  return supabase as unknown as SupabaseClient;
}

function formatDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function addDays(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T00:00:00+08:00`);
  date.setDate(date.getDate() + days);
  return formatDateKey(date);
}

function hoursBetween(start: string | null, end: string | null) {
  if (!start || !end) return 0;
  return Math.max((new Date(end).getTime() - new Date(start).getTime()) / 3_600_000, 0);
}

function restHours(previousEnd: string | null, nextStart: string | null) {
  if (!previousEnd || !nextStart) return 24;
  return (new Date(nextStart).getTime() - new Date(previousEnd).getTime()) / 3_600_000;
}

function overlaps(aStart: string | null, aEnd: string | null, bStart: string | null, bEnd: string | null) {
  if (!aStart || !aEnd || !bStart || !bEnd) return false;
  return new Date(aStart) < new Date(bEnd) && new Date(bStart) < new Date(aEnd);
}

function shiftLabel(schedule: ScheduleRow) {
  const name = schedule.shifts?.name ?? schedule.note ?? "未設定班別";
  const start = schedule.shifts?.start_time?.slice(0, 5) ?? schedule.planned_start?.slice(11, 16) ?? "";
  const end = schedule.shifts?.end_time?.slice(0, 5) ?? schedule.planned_end?.slice(11, 16) ?? "";
  return `${name}${start && end ? ` ${start}-${end}` : ""}`;
}

function roleFromSchedule(schedule: ScheduleRow) {
  const noteRole = schedule.note?.match(/日照職務：([^；\n]+)/)?.[1];
  const source = [
    noteRole,
    schedule.employees?.metadata?.daycare_role,
    schedule.employees?.positions?.title,
    schedule.departments?.department_type,
  ].filter(Boolean).join(" ");
  if (source.includes("護理")) return "護理師";
  if (source.includes("社工")) return "社工";
  if (source.includes("行政")) return "行政人員";
  if (source.includes("司機") || source.includes("駕駛")) return "司機";
  if (source.includes("廚")) return "廚工";
  if (source.includes("居服")) return "居服員";
  return "照服員";
}

function employeeName(schedule: ScheduleRow) {
  return `${schedule.employees?.employee_no ? `${schedule.employees.employee_no} / ` : ""}${schedule.employees?.full_name ?? "未設定員工"}`;
}

function applyResolutionStatus<T extends { id: string }>(items: T[], resolutions: Record<string, ResolutionRecord>) {
  return items.map((item) => ({ item, resolution: resolutions[item.id] }));
}

function generateIssues(schedules: ScheduleRow[], leaves: LeaveRow[], licenses: LicenseRow[], resolutions: Record<string, ResolutionRecord>) {
  const issues: GuardIssue[] = [];
  const activeSchedules = schedules.filter((schedule) => schedule.schedule_type !== "leave" && schedule.schedule_type !== "holiday");
  const byEmployee = new Map<string, ScheduleRow[]>();
  activeSchedules.forEach((schedule) => {
    const list = byEmployee.get(schedule.employee_id) ?? [];
    list.push(schedule);
    byEmployee.set(schedule.employee_id, list);
  });

  activeSchedules.forEach((schedule) => {
    const hours = hoursBetween(schedule.planned_start, schedule.planned_end);
    if (hours > 12) {
      issues.push({
        id: `daily-hours-${schedule.id}`,
        type: "每日工時過長",
        employee: employeeName(schedule),
        branch: schedule.branches?.name ?? "未設定據點",
        department: schedule.departments?.name ?? "未設定部門",
        date: schedule.work_date,
        shift: shiftLabel(schedule),
        detail: `單日排班 ${hours.toFixed(1)} 小時，超過單日上限 12 小時。`,
        recommendation: "拆分服務時段、縮短班別，或安排臨時代班。",
        severity: "block",
        status: "待處理",
        scheduleId: schedule.id,
      });
    }

    const approvedLeave = leaves.find((leave) => leave.employee_id === schedule.employee_id && overlaps(schedule.planned_start, schedule.planned_end, leave.starts_at, leave.ends_at));
    if (approvedLeave) {
      issues.push({
        id: `leave-overlap-${schedule.id}-${approvedLeave.id}`,
        type: "請假期間被排班",
        employee: employeeName(schedule),
        branch: schedule.branches?.name ?? "未設定據點",
        department: schedule.departments?.name ?? "未設定部門",
        date: schedule.work_date,
        shift: shiftLabel(schedule),
        detail: `該時段已有核准${approvedLeave.leave_type}。`,
        recommendation: "移除排班或改派支援人員，並同步更新人力缺口。",
        severity: "block",
        status: "待處理",
        scheduleId: schedule.id,
      });
    }

    if (schedule.employees?.termination_date && schedule.work_date > schedule.employees.termination_date) {
      issues.push({
        id: `terminated-${schedule.id}`,
        type: "離職員工被排班",
        employee: employeeName(schedule),
        branch: schedule.branches?.name ?? "未設定據點",
        department: schedule.departments?.name ?? "未設定部門",
        date: schedule.work_date,
        shift: shiftLabel(schedule),
        detail: `員工離職日為 ${schedule.employees.termination_date}，排班日期晚於離職日。`,
        recommendation: "停用該排班，改派在職人員。",
        severity: "block",
        status: "待處理",
        scheduleId: schedule.id,
      });
    }

    const role = roleFromSchedule(schedule);
    const needsLicense = ["照服員", "護理師", "社工", "司機"].includes(role);
    const relatedLicenses = licenses.filter((license) => license.employee_id === schedule.employee_id);
    const hasBadLicense = relatedLicenses.some((license) => license.status === "expired" || license.attachment_status === "missing" || (license.expires_at && license.expires_at < schedule.work_date));
    if (needsLicense && (!relatedLicenses.length || hasBadLicense)) {
      issues.push({
        id: `license-${schedule.id}`,
        type: "證照不符者被排班",
        employee: employeeName(schedule),
        branch: schedule.branches?.name ?? "未設定據點",
        department: schedule.departments?.name ?? "未設定部門",
        date: schedule.work_date,
        shift: shiftLabel(schedule),
        detail: relatedLicenses.length ? "此職務相關證照缺件、逾期或附件未完成驗證。" : "此職務尚未建立可供排班檢核的有效證照。",
        recommendation: "補上有效證照並完成審核，或改派證照有效人員。",
        severity: "block",
        status: "待處理",
        scheduleId: schedule.id,
      });
    }
  });

  byEmployee.forEach((employeeSchedules) => {
    const sorted = employeeSchedules.sort((a, b) => `${a.work_date}${a.planned_start ?? ""}`.localeCompare(`${b.work_date}${b.planned_start ?? ""}`));
    const byDate = new Map<string, ScheduleRow[]>();
    sorted.forEach((schedule) => {
      const list = byDate.get(schedule.work_date) ?? [];
      list.push(schedule);
      byDate.set(schedule.work_date, list);
    });

    byDate.forEach((daySchedules) => {
      if (daySchedules.length > 1) {
        const hasLeaveConflict = daySchedules.some((schedule) => ["休假", "特休", "國定假日"].includes(schedule.shifts?.name ?? schedule.note ?? ""));
        for (let index = 0; index < daySchedules.length; index += 1) {
          for (let nextIndex = index + 1; nextIndex < daySchedules.length; nextIndex += 1) {
            const first = daySchedules[index];
            const second = daySchedules[nextIndex];
            if (overlaps(first.planned_start, first.planned_end, second.planned_start, second.planned_end)) {
              issues.push({
                id: `overlap-${first.id}-${second.id}`,
                type: "同一員工同時段重複排班",
                employee: employeeName(first),
                branch: first.branches?.name ?? "未設定據點",
                department: first.departments?.name ?? "未設定部門",
                date: first.work_date,
                shift: `${shiftLabel(first)} / ${shiftLabel(second)}`,
                detail: "同一員工同時段被排入兩筆排班。",
                recommendation: "取消其中一筆排班或指定代班人員。",
                severity: "block",
                status: "待處理",
                scheduleId: second.id,
              });
            }
          }
        }
        if (hasLeaveConflict) {
          const target = daySchedules[0];
          issues.push({
            id: `shift-conflict-${target.employee_id}-${target.work_date}`,
            type: "班別衝突",
            employee: employeeName(target),
            branch: target.branches?.name ?? "未設定據點",
            department: target.departments?.name ?? "未設定部門",
            date: target.work_date,
            shift: daySchedules.map(shiftLabel).join(" / "),
            detail: "同日休假、特休或國定假日班別與工作班別並存。",
            recommendation: "移除工作班或取消休假班，並重新走簽核。",
            severity: "block",
            status: "待處理",
            scheduleId: target.id,
          });
        }
      }
    });

    let consecutive = 0;
    let previousDate = "";
    sorted.forEach((schedule) => {
      if (previousDate && addDays(previousDate, 1) === schedule.work_date) {
        consecutive += 1;
      } else {
        consecutive = 1;
      }
      previousDate = schedule.work_date;
      if (consecutive > 6) {
        issues.push({
          id: `consecutive-${schedule.employee_id}-${schedule.work_date}`,
          type: "連續上班天數過多",
          employee: employeeName(schedule),
          branch: schedule.branches?.name ?? "未設定據點",
          department: schedule.departments?.name ?? "未設定部門",
          date: schedule.work_date,
          shift: shiftLabel(schedule),
          detail: `已連續排班 ${consecutive} 天。`,
          recommendation: "建議安排休假或改派可支援人員。",
          severity: consecutive > 7 ? "block" : "warning",
          status: consecutive > 7 ? "待處理" : "需主管確認",
          scheduleId: schedule.id,
        });
      }
    });

    for (let index = 1; index < sorted.length; index += 1) {
      const previous = sorted[index - 1];
      const current = sorted[index];
      const gap = restHours(previous.planned_end, current.planned_start);
      if (gap > 0 && gap < 11) {
        issues.push({
          id: `rest-${previous.id}-${current.id}`,
          type: "休息時間不足",
          employee: employeeName(current),
          branch: current.branches?.name ?? "未設定據點",
          department: current.departments?.name ?? "未設定部門",
          date: current.work_date,
          shift: shiftLabel(current),
          detail: `前後班間隔僅 ${gap.toFixed(1)} 小時，低於 11 小時提醒值。`,
          recommendation: "延後上班、改派他人或取消其中一班。",
          severity: "warning",
          status: "待處理",
          scheduleId: current.id,
        });
      }
    }

    const byWeek = new Map<string, { hours: number; latest: ScheduleRow }>();
    sorted.forEach((schedule) => {
      const date = new Date(`${schedule.work_date}T00:00:00+08:00`);
      const weekStart = new Date(date);
      weekStart.setDate(date.getDate() - date.getDay());
      const key = formatDateKey(weekStart);
      const current = byWeek.get(key) ?? { hours: 0, latest: schedule };
      byWeek.set(key, { hours: current.hours + hoursBetween(schedule.planned_start, schedule.planned_end), latest: schedule });
    });
    byWeek.forEach((week) => {
      if (week.hours > 48) {
        issues.push({
          id: `weekly-hours-${week.latest.employee_id}-${week.latest.work_date}`,
          type: "每週工時過長",
          employee: employeeName(week.latest),
          branch: week.latest.branches?.name ?? "未設定據點",
          department: week.latest.departments?.name ?? "未設定部門",
          date: week.latest.work_date,
          shift: shiftLabel(week.latest),
          detail: `本週已排 ${week.hours.toFixed(1)} 小時，超過 48 小時提醒值。`,
          recommendation: "調整本週後段班別，並保留主管確認紀錄。",
          severity: "warning",
          status: "需主管確認",
          scheduleId: week.latest.id,
        });
      }
    });
  });

  return applyResolutionStatus(issues, resolutions).map(({ item, resolution }) => ({
    ...item,
    status: resolution?.status === "resolved" ? "已調整" : resolution?.status === "manager_review" ? "需主管確認" : item.status,
  }));
}

function generateStaffingGaps(schedules: ScheduleRow[], resolutions: Record<string, ResolutionRecord>) {
  const requirements: Record<string, number> = {
    照服員: 6,
    護理師: 1,
    社工: 1,
    行政人員: 1,
    司機: 2,
    廚工: 1,
  };
  const grouped = new Map<string, { branch: string; branchId: string | null; date: string; counts: Record<string, number> }>();
  schedules
    .filter((schedule) => schedule.schedule_type !== "leave" && schedule.schedule_type !== "holiday")
    .filter((schedule) => schedule.branches?.branch_type === "daycare_center" || schedule.departments?.department_type === "daycare" || schedule.source_module === "daycare")
    .forEach((schedule) => {
      const key = `${schedule.branch_id ?? "no-branch"}-${schedule.work_date}`;
      const current = grouped.get(key) ?? {
        branch: schedule.branches?.name ?? "未設定日照中心",
        branchId: schedule.branch_id,
        date: schedule.work_date,
        counts: {},
      };
      const role = roleFromSchedule(schedule);
      current.counts[role] = (current.counts[role] ?? 0) + 1;
      grouped.set(key, current);
    });

  const gaps: StaffingGap[] = [];
  grouped.forEach((group) => {
    Object.entries(requirements).forEach(([role, required]) => {
      const available = group.counts[role] ?? 0;
      if (available < required) {
        const id = `staffing-${group.branchId ?? "no-branch"}-${group.date}-${role}`;
        const resolution = resolutions[id];
        gaps.push({
          id,
          date: group.date,
          branch: group.branch,
          branchId: group.branchId,
          department: "日照中心",
          role,
          shift: role === "司機" ? "早班/晚班接送" : "日間照顧時段",
          required,
          available: resolution?.status === "resolved" ? required : available,
          shortage: resolution?.status === "resolved" ? 0 : required - available,
          impact: role === "司機" ? "接送路線可能無法完整覆蓋。" : "低於日照最低人力，阻擋班表發布與服務人力配置表匯出。",
          supportSource: role === "司機" ? "行政支援司機、外包車隊、跨據點司機" : "同中心其他班、跨據點支援、臨時代班池",
          action: `補 ${required - available} 名${role}或調整當日配置。`,
          severity: role === "照服員" || role === "護理師" ? "block" : "warning",
          status: resolution?.status === "resolved" ? "已補足" : role === "照服員" ? "待補人" : "需跨據點支援",
        });
      }
    });
  });
  return gaps;
}

export default function ScheduleGuardsPage() {
  const currentUser = useCurrentUser();
  const [rules, setRules] = useState<Rule[]>(ruleDefaults);
  const [schedules, setSchedules] = useState<ScheduleRow[]>([]);
  const [leaves, setLeaves] = useState<LeaveRow[]>([]);
  const [licenses, setLicenses] = useState<LicenseRow[]>([]);
  const [resolutions, setResolutions] = useState<Record<string, ResolutionRecord>>({});
  const [settingsId, setSettingsId] = useState("");
  const [selectedType, setSelectedType] = useState<GuardType | "全部">("全部");
  const [startDate, setStartDate] = useState(formatDateKey(new Date()));
  const [endDate, setEndDate] = useState(addDays(formatDateKey(new Date()), 7));
  const [message, setMessage] = useState("排班防呆會從 Supabase 讀取 schedules、leave_requests、licenses 與員工狀態。");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const enabledRules = useMemo(() => new Set(rules.filter((rule) => rule.enabled).map((rule) => rule.type)), [rules]);
  const allIssues = useMemo(
    () => generateIssues(schedules, leaves, licenses, resolutions).filter((issue) => enabledRules.has(issue.type)),
    [enabledRules, leaves, licenses, resolutions, schedules],
  );
  const staffingGaps = useMemo(
    () => enabledRules.has("據點人力不足") ? generateStaffingGaps(schedules, resolutions) : [],
    [enabledRules, resolutions, schedules],
  );
  const filteredIssues = useMemo(
    () => allIssues.filter((item) => selectedType === "全部" || item.type === selectedType),
    [allIssues, selectedType],
  );

  const enabledRuleCount = rules.filter((rule) => rule.enabled).length;
  const blockCount = allIssues.filter((item) => item.severity === "block" && item.status !== "已調整").length;
  const warningCount = allIssues.filter((item) => item.severity === "warning" && item.status !== "已調整").length;
  const unresolvedCount = allIssues.filter((item) => item.status !== "已調整").length;
  const openStaffingGaps = staffingGaps.filter((gap) => gap.status !== "已補足");
  const totalShortage = openStaffingGaps.reduce((sum, gap) => sum + gap.shortage, 0);
  const blockingGapCount = openStaffingGaps.filter((gap) => gap.severity === "block").length;

  async function saveSettings(nextRules: Rule[], nextResolutions: Record<string, ResolutionRecord>) {
    const supabase = getClient();
    const companyId = currentUser.companyId || schedules[0]?.company_id;
    if (!companyId) throw new Error("尚未取得公司資料，無法儲存排班防呆設定。");
    const payload = {
      company_id: companyId,
      setting_key: "schedule_guard_rules",
      category: "shift_rules",
      display_name: "排班防呆規則與處理紀錄",
      description: "儲存排班防呆規則啟用狀態、違規處理與缺口補足紀錄。",
      settings: {
        rules: Object.fromEntries(nextRules.map((rule) => [rule.type, rule.enabled])),
        resolutions: nextResolutions,
      },
      status: "active",
      updated_by: currentUser.id || null,
      updated_at: new Date().toISOString(),
    };
    const { data, error: upsertError } = await supabase
      .from("system_settings")
      .upsert(payload, { onConflict: "company_id,setting_key" })
      .select("id, settings")
      .maybeSingle();
    if (upsertError) throw upsertError;
    if (data?.id) setSettingsId(data.id);
  }

  async function writeAudit(action: string, resourceType: string, resourceId: string, beforeData: unknown, afterData: unknown) {
    const supabase = getClient();
    const { error: auditError } = await supabase.from("audit_logs").insert({
      company_id: currentUser.companyId || schedules[0]?.company_id || null,
      actor_user_id: currentUser.id || null,
      action,
      resource_type: resourceType,
      resource_id: resourceId,
      before_data: beforeData,
      after_data: afterData,
      metadata: { module: "schedule_guards", source: "attendance/schedule-guards" },
    });
    if (auditError) throw auditError;
  }

  async function loadData() {
    setLoading(true);
    setError("");
    try {
      const supabase = getClient();
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
          source_module,
          note,
          employees(full_name, employee_no, employment_status, termination_date, metadata, positions(title)),
          branches(name, branch_type),
          departments(name, department_type),
          shifts(name, start_time, end_time)
        `)
        .gte("work_date", startDate)
        .lte("work_date", endDate)
        .is("deleted_at", null)
        .order("work_date");
      let leaveQuery = supabase
        .from("leave_requests")
        .select("id, employee_id, leave_type, starts_at, ends_at, status")
        .eq("status", "approved")
        .lte("starts_at", `${endDate}T23:59:59+08:00`)
        .gte("ends_at", `${startDate}T00:00:00+08:00`)
        .is("deleted_at", null);
      let licenseQuery = supabase
        .from("licenses")
        .select("employee_id, license_name, expires_at, status, attachment_status")
        .is("deleted_at", null);
      let settingsQuery = supabase
        .from("system_settings")
        .select("id, settings")
        .eq("setting_key", "schedule_guard_rules")
        .is("deleted_at", null)
        .maybeSingle();

      if (currentUser.companyId && currentUser.role !== "ceo") {
        scheduleQuery = scheduleQuery.eq("company_id", currentUser.companyId);
        leaveQuery = leaveQuery.eq("company_id", currentUser.companyId);
        licenseQuery = licenseQuery.eq("company_id", currentUser.companyId);
        settingsQuery = settingsQuery.eq("company_id", currentUser.companyId);
      }

      const [scheduleResult, leaveResult, licenseResult, settingsResult] = await Promise.all([scheduleQuery, leaveQuery, licenseQuery, settingsQuery]);
      if (scheduleResult.error) throw scheduleResult.error;
      if (leaveResult.error) throw leaveResult.error;
      if (licenseResult.error) throw licenseResult.error;
      if (settingsResult.error) throw settingsResult.error;

      const settings = settingsResult.data as SettingsRow | null;
      const savedRules = settings?.settings?.rules ?? {};
      setSettingsId(settings?.id ?? "");
      setRules(ruleDefaults.map((rule) => ({ ...rule, enabled: savedRules[rule.type] ?? rule.enabled })));
      setResolutions(settings?.settings?.resolutions ?? {});
      setSchedules((scheduleResult.data ?? []) as unknown as ScheduleRow[]);
      setLeaves((leaveResult.data ?? []) as unknown as LeaveRow[]);
      setLicenses((licenseResult.data ?? []) as unknown as LicenseRow[]);
      setMessage("已從 Supabase 重新計算排班防呆結果。");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "排班防呆資料載入失敗。");
      setSchedules([]);
      setLeaves([]);
      setLicenses([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, [currentUser.companyId, currentUser.role, startDate, endDate]);

  async function toggleRule(type: GuardType) {
    const target = rules.find((rule) => rule.type === type);
    if (!target) return;
    const nextRules = rules.map((rule) => (rule.type === type ? { ...rule, enabled: !rule.enabled } : rule));
    setSaving(true);
    try {
      await saveSettings(nextRules, resolutions);
      await writeAudit("schedule_guard.rule.toggle", "system_settings", settingsId || "schedule_guard_rules", target, { type, enabled: !target.enabled });
      setRules(nextRules);
      setMessage(`${type} 規則已${target.enabled ? "停用" : "啟用"}，並寫入 Supabase system_settings。`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "規則儲存失敗。");
    } finally {
      setSaving(false);
    }
  }

  async function resolveIssue(issue: GuardIssue) {
    const nextResolutions = {
      ...resolutions,
      [issue.id]: {
        status: issue.severity === "block" ? "resolved" : "manager_review",
        note: issue.recommendation,
        resolvedAt: new Date().toISOString(),
        resolvedBy: currentUser.name || currentUser.email || "system",
      } satisfies ResolutionRecord,
    };
    setSaving(true);
    try {
      const supabase = getClient();
      if (issue.scheduleId) {
        const schedule = schedules.find((item) => item.id === issue.scheduleId);
        const note = `${schedule?.note ?? ""}\n[排班防呆處理] ${issue.type}：${issue.recommendation}`.trim();
        const { error: scheduleError } = await supabase
          .from("schedules")
          .update({ note, source_reference_id: issue.id, updated_at: new Date().toISOString() })
          .eq("id", issue.scheduleId);
        if (scheduleError) throw scheduleError;
      }
      await saveSettings(rules, nextResolutions);
      await writeAudit("schedule_guard.violation.resolve", "schedule_guard_violation", issue.id, issue, nextResolutions[issue.id]);
      setResolutions(nextResolutions);
      setMessage(`${issue.employee} 的「${issue.type}」已寫入處理紀錄與稽核紀錄。`);
      await loadData();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "違規處理失敗。");
    } finally {
      setSaving(false);
    }
  }

  async function resolveStaffingGap(gap: StaffingGap) {
    const nextResolutions = {
      ...resolutions,
      [gap.id]: {
        status: "resolved",
        note: gap.action,
        resolvedAt: new Date().toISOString(),
        resolvedBy: currentUser.name || currentUser.email || "system",
      } satisfies ResolutionRecord,
    };
    setSaving(true);
    try {
      await saveSettings(rules, nextResolutions);
      await writeAudit("schedule_guard.staffing_gap.resolve", "schedule_guard_staffing_gap", gap.id, gap, nextResolutions[gap.id]);
      setResolutions(nextResolutions);
      setMessage(`${gap.branch} ${gap.role} 缺口已寫入補足紀錄與 audit_logs。`);
      await loadData();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "缺口處理失敗。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-medium text-rose-700">排班規則引擎</p>
          <h1 className="text-2xl font-semibold text-slate-950">排班防呆規則</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-500">
            從 Supabase 排班、請假、證照與員工狀態即時計算違規；處理結果會寫入 system_settings 與 audit_logs。
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs font-medium">
          <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-slate-600">啟用 {enabledRuleCount} / {rules.length} 條</span>
          <span className="rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-rose-700">阻擋 {blockCount} 筆</span>
          <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-amber-700">提醒 {warningCount} 筆</span>
        </div>
      </div>

      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
          <label className="space-y-1 text-sm font-medium text-slate-700">
            起日
            <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
          </label>
          <label className="space-y-1 text-sm font-medium text-slate-700">
            迄日
            <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
          </label>
          <button
            type="button"
            onClick={() => void loadData()}
            disabled={loading || saving}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60 md:self-end"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            重新檢核
          </button>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "啟用規則", value: `${enabledRuleCount} 條`, icon: ShieldCheck, tone: "bg-emerald-50 text-emerald-700" },
          { label: "排班缺口", value: `${totalShortage} 人`, icon: UsersRound, tone: "bg-rose-50 text-rose-700" },
          { label: "阻擋缺口", value: `${blockingGapCount} 項`, icon: AlertTriangle, tone: "bg-red-50 text-red-700" },
          { label: "待處理問題", value: `${unresolvedCount} 筆`, icon: FileWarning, tone: "bg-amber-50 text-amber-700" },
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

      <section className="rounded-lg border border-rose-200 bg-rose-50 p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-rose-950">排班缺口總表</h2>
            <p className="mt-1 text-sm text-rose-800">
              缺口由日照中心每日 `schedules` 計算，按下補足會保存處理紀錄，不再只是前端標記。
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs font-bold">
            <span className="rounded-full bg-white px-3 py-1 text-rose-700">缺口 {totalShortage} 人</span>
            <span className="rounded-full bg-white px-3 py-1 text-rose-700">阻擋 {blockingGapCount} 項</span>
          </div>
        </div>

        <div className="mt-4 grid gap-3 xl:grid-cols-3">
          {openStaffingGaps.length ? openStaffingGaps.map((gap) => (
            <div key={gap.id} className="rounded-lg bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-bold text-slate-950">{gap.branch}</div>
                  <div className="mt-1 text-xs text-slate-500">{gap.date} · {gap.shift}</div>
                </div>
                <span className={`rounded-full border px-2.5 py-1 text-xs font-bold ${severityStyles[gap.severity]}`}>
                  缺 {gap.shortage} 人
                </span>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                <div className="rounded bg-slate-50 p-2">
                  <div className="font-black text-slate-950">{gap.required}</div>
                  <div className="text-slate-500">最低</div>
                </div>
                <div className="rounded bg-slate-50 p-2">
                  <div className="font-black text-slate-950">{gap.available}</div>
                  <div className="text-slate-500">可出勤</div>
                </div>
                <div className="rounded bg-rose-50 p-2">
                  <div className="font-black text-rose-700">{gap.shortage}</div>
                  <div className="text-rose-600">缺口</div>
                </div>
              </div>
              <div className="mt-3">
                <div className="font-semibold text-slate-900">{gap.role}</div>
                <p className="mt-1 text-xs leading-5 text-slate-600">{gap.impact}</p>
                <p className="mt-2 text-xs font-semibold text-slate-500">支援來源：{gap.supportSource}</p>
                <p className="mt-1 text-xs font-bold text-rose-700">{gap.action}</p>
              </div>
              <button
                type="button"
                onClick={() => void resolveStaffingGap(gap)}
                disabled={saving}
                className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-emerald-200 px-3 py-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-60"
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                寫入補足紀錄
              </button>
            </div>
          )) : (
            <div className="rounded-lg bg-white p-4 text-sm font-semibold text-emerald-700">目前沒有未補足的排班缺口。</div>
          )}
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">規則設定</h2>
            <p className="text-sm text-slate-500">規則啟停會寫入 Supabase system_settings。</p>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600">
            <Filter className="h-4 w-4" />
            <select
              value={selectedType}
              onChange={(event) => setSelectedType(event.target.value as GuardType | "全部")}
              className="bg-transparent outline-none"
            >
              <option>全部</option>
              {rules.map((rule) => (
                <option key={rule.type}>{rule.type}</option>
              ))}
            </select>
          </div>
        </div>

        <div className={`mb-4 rounded-lg border px-3 py-2 text-sm font-semibold ${error ? "border-rose-200 bg-rose-50 text-rose-700" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>
          {loading ? "正在從 Supabase 檢核排班..." : saving ? "正在寫入 Supabase..." : error || message}
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          {rules.map((rule) => {
            const Icon = rule.icon;
            return (
              <button
                key={rule.type}
                onClick={() => void toggleRule(rule.type)}
                disabled={saving}
                className={`rounded-lg border p-4 text-left transition hover:border-slate-300 disabled:opacity-60 ${
                  rule.enabled ? "border-slate-200 bg-white" : "border-slate-200 bg-slate-50 opacity-60"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="rounded-lg bg-slate-100 p-2 text-slate-700">
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${severityStyles[rule.severity]}`}>
                    {severityLabels[rule.severity]}
                  </span>
                </div>
                <p className="mt-3 font-semibold text-slate-950">{rule.type}</p>
                <p className="mt-1 line-clamp-2 text-xs text-slate-500">{rule.description}</p>
                <p className="mt-3 text-xs font-medium text-slate-600">{rule.threshold}</p>
                <p className="mt-2 text-xs text-slate-400">{rule.enabled ? "已啟用，點擊可停用" : "已停用，點擊可啟用"}</p>
              </button>
            );
          })}
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.35fr_0.65fr]">
        <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 p-5">
            <h2 className="text-lg font-semibold text-slate-950">防呆檢核結果</h2>
            <p className="text-sm text-slate-500">列出目前 Supabase 排班資料中需要阻擋或提醒的問題。</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1080px] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">規則</th>
                  <th className="px-4 py-3">員工 / 據點</th>
                  <th className="px-4 py-3">日期與班別</th>
                  <th className="px-4 py-3">問題說明</th>
                  <th className="px-4 py-3">處理建議</th>
                  <th className="px-4 py-3">狀態</th>
                  <th className="px-4 py-3">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-sm font-semibold text-slate-500">正在檢核排班...</td>
                  </tr>
                ) : filteredIssues.map((item) => (
                  <tr key={item.id} className={item.status === "已調整" ? "bg-slate-50/70 text-slate-400" : "hover:bg-slate-50"}>
                    <td className="px-4 py-4">
                      <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${severityStyles[item.severity]}`}>
                        {severityLabels[item.severity]}
                      </span>
                      <p className="mt-2 font-semibold text-slate-900">{item.type}</p>
                    </td>
                    <td className="px-4 py-4">
                      <p className="font-semibold text-slate-900">{item.employee}</p>
                      <p className="text-xs text-slate-500">{item.department}</p>
                      <p className="mt-1 inline-flex items-center gap-1 text-xs text-slate-500">
                        <MapPin className="h-3.5 w-3.5" />
                        {item.branch}
                      </p>
                    </td>
                    <td className="px-4 py-4">
                      <p className="font-medium text-slate-800">{item.date}</p>
                      <p className="text-xs text-slate-500">{item.shift}</p>
                    </td>
                    <td className="max-w-xs px-4 py-4 text-slate-700">{item.detail}</td>
                    <td className="max-w-xs px-4 py-4 text-slate-600">{item.recommendation}</td>
                    <td className="px-4 py-4">
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">{item.status}</span>
                    </td>
                    <td className="px-4 py-4">
                      <button
                        onClick={() => void resolveIssue(item)}
                        disabled={saving || item.status === "已調整"}
                        className="inline-flex items-center gap-2 rounded-lg border border-emerald-200 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        寫入處理
                      </button>
                    </td>
                  </tr>
                ))}
                {!loading && !filteredIssues.length ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-sm font-semibold text-emerald-700">
                      此區間沒有未處理的排班防呆問題。
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-5">
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-5">
            <div className="mb-3 flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-rose-700" />
              <h2 className="font-semibold text-rose-900">阻擋規則</h2>
            </div>
            <p className="text-sm text-rose-800">
              每日工時過長、重複排班、請假期間排班、離職後排班、證照不符與班別衝突，預設不允許發布班表。
            </p>
          </div>

          <div className="rounded-lg border border-amber-200 bg-amber-50 p-5">
            <div className="mb-3 flex items-center gap-2">
              <BadgeAlert className="h-5 w-5 text-amber-700" />
              <h2 className="font-semibold text-amber-900">提醒規則</h2>
            </div>
            <p className="text-sm text-amber-800">
              連續上班、每週工時、休息時間與據點人力不足可由主管確認，但會保留處理紀錄。
            </p>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-950">資料來源</h2>
            <div className="mt-4 space-y-3">
              {[
                `schedules：${schedules.length} 筆`,
                `leave_requests：${leaves.length} 筆`,
                `licenses：${licenses.length} 筆`,
                `system_settings：${settingsId ? "已連結" : "尚未建立"}`,
                "audit_logs：處理時寫入",
              ].map((step, index) => (
                <div key={step} className="flex items-center gap-3 text-sm">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">
                    {index + 1}
                  </span>
                  <span className="text-slate-700">{step}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
