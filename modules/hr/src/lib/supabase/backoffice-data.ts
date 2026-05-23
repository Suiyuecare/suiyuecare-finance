"use client";

import type { CurrentUser } from "@/lib/auth/current-user";
import type { HrRole } from "@/lib/auth/rbac";
import { getLiveClient } from "@/lib/supabase/live-modules";
import { loadWorkflowRequests, type DemoWorkflowRequest } from "@/lib/requests/workflow-store";

type CountQuery = PromiseLike<{ count: number | null; error: Error | null }> & {
  eq: (column: string, value: unknown) => CountQuery;
  gte: (column: string, value: unknown) => CountQuery;
  lt: (column: string, value: unknown) => CountQuery;
  in: (column: string, values: unknown[]) => CountQuery;
  is: (column: string, value: unknown) => CountQuery;
};

type SupabaseWarning = {
  table: string;
  message: string;
};

export type BackofficeResult<T> = {
  data: T;
  warnings: SupabaseWarning[];
};

export type DashboardStats = {
  myPendingRequests: number;
  approvalsForMe: number;
  unreadNotifications: number;
  todayPunches: number;
  attendanceAnomalies: number;
  pendingLeaveRequests: number;
  pendingOvertimeRequests: number;
  pendingPunchCorrections: number;
  licenseAlerts: number;
  trainingIncomplete: number;
  payrollDrafts: number;
  activeEmployees: number;
  newHires30Days: number;
  retentionHighRisk: number;
  documentsMissingReview: number;
  reportExports: number;
};

export type HrAdminStats = {
  activeEmployees: number;
  newHires30Days: number;
  terminatedEmployees: number;
  pendingWorkflowRequests: number;
  pendingLeaveRequests: number;
  pendingOvertimeRequests: number;
  pendingPunchCorrections: number;
  attendanceAbnormal: number;
  payrollDrafts: number;
  releasedPayslips: number;
  licenseAlerts: number;
  trainingIncomplete: number;
  unreadNotifications: number;
  reportExportsPending: number;
  assessmentExportsPending: number;
  importBatchesPending: number;
  retentionHighRisk: number;
  auditLogs24h: number;
  documentsMissingReview: number;
};

export type AuditLogRow = {
  id: string;
  action: string | null;
  resource_type: string | null;
  created_at: string | null;
  users: { display_name: string | null } | null;
};

export type ManagerEmployeeRow = {
  id: string;
  employee_no: string | null;
  full_name: string | null;
  employment_status: string | null;
  branches: { name: string | null } | null;
  departments: { name: string | null } | null;
  positions: { title: string | null } | null;
};

export type ManagerStats = {
  departmentEmployees: number;
  pendingApprovals: number;
  abnormalPunches: number;
  pendingPunchReviews: number;
  leavePending: number;
  overtimePending: number;
  monthlyLeaveHours: number;
  monthlyOvertimeHours: number;
  upcomingSchedules: number;
  scheduleWarnings: number;
};

export const emptyDashboardStats: DashboardStats = {
  myPendingRequests: 0,
  approvalsForMe: 0,
  unreadNotifications: 0,
  todayPunches: 0,
  attendanceAnomalies: 0,
  pendingLeaveRequests: 0,
  pendingOvertimeRequests: 0,
  pendingPunchCorrections: 0,
  licenseAlerts: 0,
  trainingIncomplete: 0,
  payrollDrafts: 0,
  activeEmployees: 0,
  newHires30Days: 0,
  retentionHighRisk: 0,
  documentsMissingReview: 0,
  reportExports: 0,
};

export const emptyHrAdminStats: HrAdminStats = {
  activeEmployees: 0,
  newHires30Days: 0,
  terminatedEmployees: 0,
  pendingWorkflowRequests: 0,
  pendingLeaveRequests: 0,
  pendingOvertimeRequests: 0,
  pendingPunchCorrections: 0,
  attendanceAbnormal: 0,
  payrollDrafts: 0,
  releasedPayslips: 0,
  licenseAlerts: 0,
  trainingIncomplete: 0,
  unreadNotifications: 0,
  reportExportsPending: 0,
  assessmentExportsPending: 0,
  importBatchesPending: 0,
  retentionHighRisk: 0,
  auditLogs24h: 0,
  documentsMissingReview: 0,
};

export const emptyManagerStats: ManagerStats = {
  departmentEmployees: 0,
  pendingApprovals: 0,
  abnormalPunches: 0,
  pendingPunchReviews: 0,
  leavePending: 0,
  overtimePending: 0,
  monthlyLeaveHours: 0,
  monthlyOvertimeHours: 0,
  upcomingSchedules: 0,
  scheduleWarnings: 0,
};

export function formatBackofficeWarnings(warnings: SupabaseWarning[]) {
  if (!warnings.length) return "";
  const names = warnings.map((warning) => warning.table).slice(0, 4).join("、");
  return `部分後台資料尚未可讀：${names}${warnings.length > 4 ? ` 等 ${warnings.length} 項` : ""}。請檢查 Supabase Data API / RLS / 欄位 schema。`;
}

function todayIso() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date());
}

function isoDate(offsetDays = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(date);
}

function isoDateTime(offsetDays = 0) {
  return `${isoDate(offsetDays)}T00:00:00+08:00`;
}

function monthStartIso() {
  const now = new Date();
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date(now.getFullYear(), now.getMonth(), 1));
}

function nextWeekIso() {
  const nextWeek = new Date();
  nextWeek.setDate(nextWeek.getDate() + 7);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(nextWeek);
}

function isCurrentApprover(request: DemoWorkflowRequest, currentUserId: string, currentRole: HrRole) {
  if (!["待我簽核", "簽核中"].includes(request.status)) return false;
  if (request.currentOwnerRole === "applicant") return request.applicantId === currentUserId;
  return request.currentOwnerRole === currentRole || ["hr", "admin_director", "ceo"].includes(currentRole);
}

async function safeCount(table: string, configure?: (query: CountQuery) => CountQuery) {
  try {
    const supabase = getLiveClient();
    const baseQuery = supabase.from(table).select("id", { count: "exact", head: true }).is("deleted_at", null) as CountQuery;
    const query = configure ? configure(baseQuery) : baseQuery;
    const { count, error } = await query;
    if (error) throw error;
    return { value: count ?? 0, warning: null };
  } catch (error) {
    return {
      value: 0,
      warning: { table, message: error instanceof Error ? error.message : "Supabase 查詢失敗" },
    };
  }
}

async function safeWorkflowRequests() {
  try {
    return { rows: await loadWorkflowRequests(), warning: null };
  } catch (error) {
    return {
      rows: [] as DemoWorkflowRequest[],
      warning: { table: "hr_requests", message: error instanceof Error ? error.message : "Supabase 表單查詢失敗" },
    };
  }
}

async function safeRecentAuditLogs() {
  try {
    const supabase = getLiveClient();
    const { data, error } = await supabase
      .from("audit_logs")
      .select("id, action, resource_type, created_at, users(display_name)")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(6);
    if (error) throw error;
    return { rows: (data ?? []) as AuditLogRow[], warning: null };
  } catch (error) {
    return {
      rows: [] as AuditLogRow[],
      warning: { table: "audit_logs", message: error instanceof Error ? error.message : "Supabase 稽核查詢失敗" },
    };
  }
}

async function safeEmployeeRows(currentUser: CurrentUser) {
  try {
    const supabase = getLiveClient();
    let query = supabase
      .from("employees")
      .select("id, employee_no, full_name, employment_status, branches(name), departments(name), positions(title)")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(8);

    if (currentUser.departmentId) {
      query = query.eq("primary_department_id", currentUser.departmentId);
    }

    const { data, error } = await query;
    if (error) throw error;
    return { rows: (data ?? []) as ManagerEmployeeRow[], warning: null };
  } catch (error) {
    return {
      rows: [] as ManagerEmployeeRow[],
      warning: { table: "employees", message: error instanceof Error ? error.message : "Supabase 員工查詢失敗" },
    };
  }
}

async function safeSumHours(table: "leave_requests" | "overtime_requests", column: "starts_at" | "work_date") {
  try {
    const supabase = getLiveClient();
    const lowerBound = column === "work_date" ? monthStartIso() : `${monthStartIso()}T00:00:00+08:00`;
    const { data, error } = await supabase
      .from(table)
      .select("total_hours")
      .is("deleted_at", null)
      .gte(column, lowerBound)
      .in("status", ["pending", "approved"]);
    if (error) throw error;
    return {
      value: (data ?? []).reduce((total: number, row: { total_hours: number | string | null }) => total + Number(row.total_hours ?? 0), 0),
      warning: null,
    };
  } catch (error) {
    return {
      value: 0,
      warning: { table, message: error instanceof Error ? error.message : "Supabase 工時查詢失敗" },
    };
  }
}

function collectWarnings(results: Array<{ warning: SupabaseWarning | null }>) {
  return results.map((result) => result.warning).filter((warning): warning is SupabaseWarning => Boolean(warning));
}

export async function loadDashboardBackofficeData(currentUser: CurrentUser): Promise<BackofficeResult<DashboardStats>> {
  const today = todayIso();
  const workflow = await safeWorkflowRequests();
  const approvalsForMe = workflow.rows.filter((request) => isCurrentApprover(request, currentUser.id, currentUser.role)).length;

  const [
    myPendingRequests,
    unreadNotifications,
    todayPunches,
    attendanceAnomalies,
    pendingLeaveRequests,
    pendingOvertimeRequests,
    pendingPunchCorrections,
    licenseAlerts,
    trainingIncomplete,
    payrollDrafts,
    activeEmployees,
    newHires30Days,
    retentionHighRisk,
    documentsMissingReview,
    reportExports,
  ] = await Promise.all([
    safeCount("hr_requests", (query) => query.eq("applicant_id", currentUser.id).in("status", ["待我簽核", "簽核中", "被退回", "pending", "in_progress", "returned"])),
    safeCount("notifications", (query) => query.eq("recipient_user_id", currentUser.id).eq("status", "unread")),
    safeCount("attendance_punches", (query) => query.eq("user_id", currentUser.id).gte("punched_at", `${today}T00:00:00+08:00`).lt("punched_at", `${today}T23:59:59+08:00`)),
    safeCount("attendance_punches", (query) => query.eq("is_abnormal", true).in("review_status", ["none", "pending"])),
    safeCount("leave_requests", (query) => query.eq("status", "pending")),
    safeCount("overtime_requests", (query) => query.eq("status", "pending")),
    safeCount("punch_correction_requests", (query) => query.eq("status", "pending")),
    safeCount("licenses", (query) => query.in("status", ["expiring", "expired", "pending_review", "missing_attachment"])),
    safeCount("training_records", (query) => query.in("status", ["planned", "in_progress", "failed"])),
    safeCount("payroll_records", (query) => query.in("status", ["draft", "calculating", "reviewing"])),
    safeCount("employees", (query) => query.eq("employment_status", "active")),
    safeCount("employees", (query) => query.gte("hire_date", isoDate(-30))),
    safeCount("employee_retention_records", (query) => query.eq("risk_level", "high").in("status", ["active", "watching", "leaving"])),
    safeCount("documents", (query) => query.in("status", ["active", "expired"])),
    safeCount("report_export_batches", (query) => query.in("status", ["pending", "processing", "failed"])),
  ]);

  return {
    data: {
      myPendingRequests: myPendingRequests.value,
      approvalsForMe,
      unreadNotifications: unreadNotifications.value,
      todayPunches: todayPunches.value,
      attendanceAnomalies: attendanceAnomalies.value,
      pendingLeaveRequests: pendingLeaveRequests.value,
      pendingOvertimeRequests: pendingOvertimeRequests.value,
      pendingPunchCorrections: pendingPunchCorrections.value,
      licenseAlerts: licenseAlerts.value,
      trainingIncomplete: trainingIncomplete.value,
      payrollDrafts: payrollDrafts.value,
      activeEmployees: activeEmployees.value,
      newHires30Days: newHires30Days.value,
      retentionHighRisk: retentionHighRisk.value,
      documentsMissingReview: documentsMissingReview.value,
      reportExports: reportExports.value,
    },
    warnings: collectWarnings([
      workflow,
      myPendingRequests,
      unreadNotifications,
      todayPunches,
      attendanceAnomalies,
      pendingLeaveRequests,
      pendingOvertimeRequests,
      pendingPunchCorrections,
      licenseAlerts,
      trainingIncomplete,
      payrollDrafts,
      activeEmployees,
      newHires30Days,
      retentionHighRisk,
      documentsMissingReview,
      reportExports,
    ]),
  };
}

export async function loadHrAdminBackofficeData(): Promise<BackofficeResult<{
  stats: HrAdminStats;
  workflowRequests: DemoWorkflowRequest[];
  auditLogs: AuditLogRow[];
}>> {
  const workflow = await safeWorkflowRequests();
  const activeWorkflowRows = workflow.rows.filter((request) => ["待我簽核", "簽核中", "被退回"].includes(request.status));

  const [
    activeEmployees,
    newHires30Days,
    terminatedEmployees,
    pendingLeaveRequests,
    pendingOvertimeRequests,
    pendingPunchCorrections,
    attendanceAbnormal,
    payrollDrafts,
    releasedPayslips,
    licenseAlerts,
    trainingIncomplete,
    unreadNotifications,
    reportExportsPending,
    assessmentExportsPending,
    importBatchesPending,
    retentionHighRisk,
    auditLogs24h,
    documentsMissingReview,
    recentAuditLogs,
  ] = await Promise.all([
    safeCount("employees", (query) => query.eq("employment_status", "active")),
    safeCount("employees", (query) => query.gte("hire_date", isoDate(-30))),
    safeCount("employees", (query) => query.eq("employment_status", "terminated")),
    safeCount("leave_requests", (query) => query.eq("status", "pending")),
    safeCount("overtime_requests", (query) => query.eq("status", "pending")),
    safeCount("punch_correction_requests", (query) => query.eq("status", "pending")),
    safeCount("attendance_punches", (query) => query.eq("is_abnormal", true).in("review_status", ["none", "pending"])),
    safeCount("payroll_records", (query) => query.in("status", ["draft", "calculating", "reviewing"])),
    safeCount("payroll_payslips", (query) => query.eq("status", "released")),
    safeCount("licenses", (query) => query.in("status", ["expiring", "expired", "pending_review", "missing_attachment"])),
    safeCount("training_records", (query) => query.in("status", ["planned", "in_progress", "failed"])),
    safeCount("notifications", (query) => query.eq("status", "unread")),
    safeCount("report_export_batches", (query) => query.in("status", ["pending", "processing", "failed"])),
    safeCount("assessment_export_batches", (query) => query.in("status", ["pending", "processing", "failed"])),
    safeCount("excel_import_batches", (query) => query.in("status", ["uploaded", "validated", "failed"])),
    safeCount("employee_retention_records", (query) => query.eq("risk_level", "high").in("status", ["active", "watching", "leaving"])),
    safeCount("audit_logs", (query) => query.gte("created_at", isoDateTime(-1))),
    safeCount("documents", (query) => query.in("status", ["active", "expired"])),
    safeRecentAuditLogs(),
  ]);

  return {
    data: {
      workflowRequests: activeWorkflowRows.slice(0, 6),
      auditLogs: recentAuditLogs.rows,
      stats: {
        activeEmployees: activeEmployees.value,
        newHires30Days: newHires30Days.value,
        terminatedEmployees: terminatedEmployees.value,
        pendingWorkflowRequests: activeWorkflowRows.length,
        pendingLeaveRequests: pendingLeaveRequests.value,
        pendingOvertimeRequests: pendingOvertimeRequests.value,
        pendingPunchCorrections: pendingPunchCorrections.value,
        attendanceAbnormal: attendanceAbnormal.value,
        payrollDrafts: payrollDrafts.value,
        releasedPayslips: releasedPayslips.value,
        licenseAlerts: licenseAlerts.value,
        trainingIncomplete: trainingIncomplete.value,
        unreadNotifications: unreadNotifications.value,
        reportExportsPending: reportExportsPending.value,
        assessmentExportsPending: assessmentExportsPending.value,
        importBatchesPending: importBatchesPending.value,
        retentionHighRisk: retentionHighRisk.value,
        auditLogs24h: auditLogs24h.value,
        documentsMissingReview: documentsMissingReview.value,
      },
    },
    warnings: collectWarnings([
      workflow,
      activeEmployees,
      newHires30Days,
      terminatedEmployees,
      pendingLeaveRequests,
      pendingOvertimeRequests,
      pendingPunchCorrections,
      attendanceAbnormal,
      payrollDrafts,
      releasedPayslips,
      licenseAlerts,
      trainingIncomplete,
      unreadNotifications,
      reportExportsPending,
      assessmentExportsPending,
      importBatchesPending,
      retentionHighRisk,
      auditLogs24h,
      documentsMissingReview,
      recentAuditLogs,
    ]),
  };
}

export async function loadManagerBackofficeData(currentUser: CurrentUser): Promise<BackofficeResult<{
  stats: ManagerStats;
  employees: ManagerEmployeeRow[];
  approvalTasks: DemoWorkflowRequest[];
}>> {
  const today = todayIso();
  const nextWeek = nextWeekIso();
  const workflow = await safeWorkflowRequests();
  const pendingTasks = workflow.rows.filter((request) => isCurrentApprover(request, currentUser.id, currentUser.role));

  const [
    employeeRows,
    departmentEmployees,
    abnormalPunches,
    pendingPunchReviews,
    leavePending,
    overtimePending,
    monthlyLeaveHours,
    monthlyOvertimeHours,
    upcomingSchedules,
  ] = await Promise.all([
    safeEmployeeRows(currentUser),
    safeCount("employees", (query) => currentUser.departmentId ? query.eq("primary_department_id", currentUser.departmentId) : query),
    safeCount("attendance_punches", (query) => query.eq("is_abnormal", true).gte("punched_at", `${today}T00:00:00+08:00`)),
    safeCount("attendance_punches", (query) => query.eq("review_status", "pending")),
    safeCount("leave_requests", (query) => query.eq("status", "pending")),
    safeCount("overtime_requests", (query) => query.eq("status", "pending")),
    safeSumHours("leave_requests", "starts_at"),
    safeSumHours("overtime_requests", "work_date"),
    safeCount("schedules", (query) => query.gte("work_date", today).lt("work_date", nextWeek)),
  ]);

  const scheduleWarnings = abnormalPunches.value + pendingPunchReviews.value > 0 ? Math.min(abnormalPunches.value + pendingPunchReviews.value, 9) : 0;

  return {
    data: {
      employees: employeeRows.rows,
      approvalTasks: pendingTasks.slice(0, 5),
      stats: {
        departmentEmployees: departmentEmployees.value,
        pendingApprovals: pendingTasks.length,
        abnormalPunches: abnormalPunches.value,
        pendingPunchReviews: pendingPunchReviews.value,
        leavePending: leavePending.value,
        overtimePending: overtimePending.value,
        monthlyLeaveHours: monthlyLeaveHours.value,
        monthlyOvertimeHours: monthlyOvertimeHours.value,
        upcomingSchedules: upcomingSchedules.value,
        scheduleWarnings,
      },
    },
    warnings: collectWarnings([workflow, employeeRows, departmentEmployees, abnormalPunches, pendingPunchReviews, leavePending, overtimePending, monthlyLeaveHours, monthlyOvertimeHours, upcomingSchedules]),
  };
}
