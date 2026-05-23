"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BellRing,
  CheckCircle2,
  ClipboardCheck,
  FileClock,
  History,
  Loader2,
  RefreshCw,
  Repeat2,
  Send,
  ShieldCheck,
  UserCheck,
  UsersRound,
  XCircle,
} from "lucide-react";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

type SupabaseClient = {
  // The live HR schema is ahead of the generated Database type in this repo.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  auth: any;
};

type RequestType = "swap" | "substitute";
type RequestStatus = "draft" | "pending_counterpart" | "pending_manager" | "pending_hr" | "completed" | "rejected" | "cancelled";
type WorkflowStage = "applicant" | "counterpart" | "manager" | "hr" | "schedule_updated" | "notified" | "rejected" | "cancelled";

type EmployeeRow = {
  id: string;
  company_id: string;
  employee_no: string;
  full_name: string;
};

type ScheduleRow = {
  id: string;
  company_id: string;
  branch_id: string | null;
  department_id: string | null;
  team_id: string | null;
  employee_id: string;
  shift_id: string | null;
  work_date: string;
  planned_start: string | null;
  planned_end: string | null;
  schedule_type: string;
  note: string | null;
  employees?: { employee_no: string | null; full_name: string | null } | null;
  branches?: { name: string | null } | null;
  departments?: { name: string | null } | null;
  shifts?: { name: string | null; start_time: string | null; end_time: string | null } | null;
};

type ShiftChangeRequestRow = {
  id: string;
  company_id: string;
  applicant_employee_id: string;
  counterpart_employee_id: string;
  original_schedule_id: string;
  target_schedule_id: string | null;
  request_type: RequestType;
  reason: string;
  status: RequestStatus;
  workflow_stage: WorkflowStage;
  original_snapshot: Record<string, unknown>;
  target_snapshot: Record<string, unknown>;
  notifications: string[];
  created_at: string;
  completed_at: string | null;
  applicant?: { employee_no: string | null; full_name: string | null } | null;
  counterpart?: { employee_no: string | null; full_name: string | null } | null;
  original_schedule?: ScheduleRow | null;
  target_schedule?: ScheduleRow | null;
};

type UserProfileRow = {
  employee_id: string | null;
};

type RequestForm = {
  type: RequestType;
  applicantEmployeeId: string;
  counterpartEmployeeId: string;
  originalScheduleId: string;
  targetScheduleId: string;
  reason: string;
};

const requestTypeLabels: Record<RequestType, string> = {
  swap: "換班",
  substitute: "代班",
};

const statusLabels: Record<RequestStatus, string> = {
  draft: "草稿",
  pending_counterpart: "待對方同意",
  pending_manager: "待主管審核",
  pending_hr: "待人資確認",
  completed: "已完成",
  rejected: "已駁回",
  cancelled: "已取消",
};

const stageLabels: Record<WorkflowStage, string> = {
  applicant: "員工發起",
  counterpart: "對方同意",
  manager: "主管審核",
  hr: "人資確認",
  schedule_updated: "自動更新班表",
  notified: "通知相關人員",
  rejected: "已駁回",
  cancelled: "已取消",
};

const stepOrder: WorkflowStage[] = ["applicant", "counterpart", "manager", "hr", "schedule_updated", "notified"];

const statusStyles: Record<RequestStatus, string> = {
  draft: "border-slate-200 bg-slate-50 text-slate-700",
  pending_counterpart: "border-sky-200 bg-sky-50 text-sky-700",
  pending_manager: "border-amber-200 bg-amber-50 text-amber-700",
  pending_hr: "border-violet-200 bg-violet-50 text-violet-700",
  completed: "border-emerald-200 bg-emerald-50 text-emerald-700",
  rejected: "border-rose-200 bg-rose-50 text-rose-700",
  cancelled: "border-slate-200 bg-slate-50 text-slate-500",
};

function getClient() {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase 尚未設定，無法讀寫換班代班。");
  return supabase as unknown as SupabaseClient;
}

function todayKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function addDays(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T00:00:00+08:00`);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function scheduleLabel(schedule?: ScheduleRow | null) {
  if (!schedule) return "未選擇班表";
  const employee = schedule.employees?.full_name ?? "未設定員工";
  const shift = schedule.shifts?.name ?? schedule.note ?? "未設定班別";
  const time = schedule.shifts?.start_time && schedule.shifts?.end_time
    ? `${schedule.shifts.start_time.slice(0, 5)}-${schedule.shifts.end_time.slice(0, 5)}`
    : "";
  return `${schedule.work_date} ${shift} ${time} / ${employee} / ${schedule.branches?.name ?? "未設定據點"}`;
}

function canApprove(role: string) {
  return ["supervisor", "hr", "admin_director", "ceo"].includes(role);
}

function stepDone(request: ShiftChangeRequestRow, stage: WorkflowStage) {
  const order = stepOrder.indexOf(stage);
  const current = stepOrder.indexOf(request.workflow_stage);
  return request.status === "completed" || order <= current || request.workflow_stage === "notified";
}

export default function ShiftChangeRequestsPage() {
  const currentUser = useCurrentUser();
  const [profile, setProfile] = useState<UserProfileRow | null>(null);
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [schedules, setSchedules] = useState<ScheduleRow[]>([]);
  const [requests, setRequests] = useState<ShiftChangeRequestRow[]>([]);
  const [form, setForm] = useState<RequestForm>({
    type: "swap",
    applicantEmployeeId: "",
    counterpartEmployeeId: "",
    originalScheduleId: "",
    targetScheduleId: "",
    reason: "",
  });
  const [message, setMessage] = useState("送出後會寫入 Supabase shift_change_requests，完成後自動更新 schedules。");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const originalSchedule = schedules.find((schedule) => schedule.id === form.originalScheduleId);
  const targetSchedule = schedules.find((schedule) => schedule.id === form.targetScheduleId);

  const stats = useMemo(
    () => ({
      total: requests.length,
      swap: requests.filter((request) => request.request_type === "swap").length,
      substitute: requests.filter((request) => request.request_type === "substitute").length,
      pending: requests.filter((request) => !["completed", "rejected", "cancelled"].includes(request.status)).length,
      completed: requests.filter((request) => request.status === "completed").length,
    }),
    [requests],
  );

  async function loadData() {
    setLoading(true);
    setError("");
    try {
      const supabase = getClient();
      const { data: authData } = await supabase.auth.getUser();
      let currentProfile: UserProfileRow | null = null;
      if (authData.user) {
        const { data: userData } = await supabase
          .from("users")
          .select("employee_id")
          .eq("auth_user_id", authData.user.id)
          .maybeSingle();
        currentProfile = (userData ?? null) as UserProfileRow | null;
      }
      setProfile(currentProfile);

      let employeeQuery = supabase
        .from("employees")
        .select("id, company_id, employee_no, full_name")
        .eq("employment_status", "active")
        .is("deleted_at", null)
        .order("employee_no");
      let scheduleQuery = supabase
        .from("schedules")
        .select(`
          id,
          company_id,
          branch_id,
          department_id,
          team_id,
          employee_id,
          shift_id,
          work_date,
          planned_start,
          planned_end,
          schedule_type,
          note,
          employees(employee_no, full_name),
          branches(name),
          departments(name),
          shifts(name, start_time, end_time)
        `)
        .gte("work_date", todayKey())
        .lte("work_date", addDays(todayKey(), 45))
        .is("deleted_at", null)
        .order("work_date");
      let requestQuery = supabase
        .from("shift_change_requests")
        .select(`
          id,
          company_id,
          applicant_employee_id,
          counterpart_employee_id,
          original_schedule_id,
          target_schedule_id,
          request_type,
          reason,
          status,
          workflow_stage,
          original_snapshot,
          target_snapshot,
          notifications,
          created_at,
          completed_at,
          applicant:employees!shift_change_requests_applicant_employee_id_fkey(employee_no, full_name),
          counterpart:employees!shift_change_requests_counterpart_employee_id_fkey(employee_no, full_name),
          original_schedule:schedules!shift_change_requests_original_schedule_id_fkey(id, work_date, note, employees(employee_no, full_name), branches(name), departments(name), shifts(name, start_time, end_time)),
          target_schedule:schedules!shift_change_requests_target_schedule_id_fkey(id, work_date, note, employees(employee_no, full_name), branches(name), departments(name), shifts(name, start_time, end_time))
        `)
        .is("deleted_at", null)
        .order("created_at", { ascending: false });

      if (currentUser.companyId && currentUser.role !== "ceo") {
        employeeQuery = employeeQuery.eq("company_id", currentUser.companyId);
        scheduleQuery = scheduleQuery.eq("company_id", currentUser.companyId);
        requestQuery = requestQuery.eq("company_id", currentUser.companyId);
      }
      if (currentUser.role === "team_member" && currentProfile?.employee_id) {
        scheduleQuery = scheduleQuery.eq("employee_id", currentProfile.employee_id);
      }

      const [employeeResult, scheduleResult, requestResult] = await Promise.all([employeeQuery, scheduleQuery, requestQuery]);
      if (employeeResult.error) throw employeeResult.error;
      if (scheduleResult.error) throw scheduleResult.error;
      if (requestResult.error) throw requestResult.error;

      const employeeRows = (employeeResult.data ?? []) as unknown as EmployeeRow[];
      const scheduleRows = (scheduleResult.data ?? []) as unknown as ScheduleRow[];
      setEmployees(employeeRows);
      setSchedules(scheduleRows);
      setRequests((requestResult.data ?? []) as unknown as ShiftChangeRequestRow[]);
      setForm((current) => {
        const applicant = currentProfile?.employee_id && employeeRows.some((employee) => employee.id === currentProfile?.employee_id)
          ? currentProfile.employee_id
          : current.applicantEmployeeId || employeeRows[0]?.id || "";
        return {
          ...current,
          applicantEmployeeId: applicant,
          counterpartEmployeeId: current.counterpartEmployeeId || employeeRows.find((employee) => employee.id !== applicant)?.id || "",
          originalScheduleId: current.originalScheduleId || scheduleRows.find((schedule) => schedule.employee_id === applicant)?.id || scheduleRows[0]?.id || "",
          targetScheduleId: current.targetScheduleId || scheduleRows.find((schedule) => schedule.employee_id !== applicant)?.id || "",
        };
      });
      setMessage("已從 Supabase 載入班表與換班代班申請。");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "換班代班資料載入失敗。");
      setRequests([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, [currentUser.companyId, currentUser.role]);

  async function writeAudit(action: string, resourceId: string | null, beforeData: unknown, afterData: unknown, companyId?: string) {
    const supabase = getClient();
    const { error: auditError } = await supabase.from("audit_logs").insert({
      company_id: companyId || currentUser.companyId || null,
      actor_user_id: currentUser.id || null,
      action,
      resource_type: "shift_change_requests",
      resource_id: resourceId,
      before_data: beforeData,
      after_data: afterData,
      metadata: { module: "shift_change_requests" },
    });
    if (auditError) throw auditError;
  }

  async function submitRequest() {
    setError("");
    if (!form.reason.trim()) {
      setError("請填寫申請原因，主管才能判斷人力與班別合理性。");
      return;
    }
    if (form.applicantEmployeeId === form.counterpartEmployeeId) {
      setError("申請人與對方員工不可為同一人。");
      return;
    }
    if (!originalSchedule) {
      setError("請選擇原班表。");
      return;
    }
    if (form.type === "swap" && !targetSchedule) {
      setError("換班需選擇目標班表。");
      return;
    }

    setSaving(true);
    try {
      const supabase = getClient();
      const counterpart = employees.find((employee) => employee.id === form.counterpartEmployeeId);
      const payload = {
        company_id: originalSchedule.company_id,
        applicant_employee_id: form.applicantEmployeeId,
        counterpart_employee_id: form.counterpartEmployeeId,
        original_schedule_id: form.originalScheduleId,
        target_schedule_id: form.type === "swap" ? form.targetScheduleId : null,
        request_type: form.type,
        reason: form.reason.trim(),
        status: "pending_counterpart",
        workflow_stage: "counterpart",
        original_snapshot: originalSchedule,
        target_snapshot: form.type === "swap" ? targetSchedule : { substitute_employee_id: form.counterpartEmployeeId, substitute_employee_name: counterpart?.full_name },
        notifications: [`已通知${counterpart?.full_name ?? "對方員工"}確認${requestTypeLabels[form.type]}`, "已建立站內通知與 Email 通知"],
        created_by: currentUser.id || null,
      };
      const { data, error: insertError } = await supabase
        .from("shift_change_requests")
        .insert(payload)
        .select("id")
        .maybeSingle();
      if (insertError) throw insertError;
      await writeAudit("shift_change.submit", data?.id ?? null, null, payload, originalSchedule.company_id);
      setForm((current) => ({ ...current, reason: "" }));
      setMessage(`已送出${requestTypeLabels[form.type]}申請，並通知對方確認。`);
      await loadData();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "送出換班代班申請失敗。");
    } finally {
      setSaving(false);
    }
  }

  function nextWorkflow(request: ShiftChangeRequestRow) {
    if (request.workflow_stage === "counterpart") return { stage: "manager" as WorkflowStage, status: "pending_manager" as RequestStatus };
    if (request.workflow_stage === "manager") return { stage: "hr" as WorkflowStage, status: "pending_hr" as RequestStatus };
    if (request.workflow_stage === "hr") return { stage: "schedule_updated" as WorkflowStage, status: "completed" as RequestStatus };
    return { stage: "counterpart" as WorkflowStage, status: "pending_counterpart" as RequestStatus };
  }

  async function updateSchedulesForRequest(request: ShiftChangeRequestRow) {
    const supabase = getClient();
    if (request.request_type === "swap") {
      if (!request.target_schedule_id) throw new Error("換班申請缺少目標班表，無法更新 schedules。");
      const original = request.original_snapshot as Partial<ScheduleRow>;
      const target = request.target_snapshot as Partial<ScheduleRow>;
      const { error: firstError } = await supabase
        .from("schedules")
        .update({
          employee_id: request.counterpart_employee_id,
          note: `${original.note ?? ""}\n[換班完成] 與 ${request.counterpart?.full_name ?? "對方員工"} 換班，申請 ${request.id}`.trim(),
          source_module: "shift_change",
          source_reference_id: request.id,
          updated_at: new Date().toISOString(),
        })
        .eq("id", request.original_schedule_id);
      if (firstError) throw firstError;
      const { error: secondError } = await supabase
        .from("schedules")
        .update({
          employee_id: request.applicant_employee_id,
          note: `${target.note ?? ""}\n[換班完成] 與 ${request.applicant?.full_name ?? "申請人"} 換班，申請 ${request.id}`.trim(),
          source_module: "shift_change",
          source_reference_id: request.id,
          updated_at: new Date().toISOString(),
        })
        .eq("id", request.target_schedule_id);
      if (secondError) throw secondError;
      return;
    }

    const original = request.original_snapshot as Partial<ScheduleRow>;
    const { error } = await supabase
      .from("schedules")
      .update({
        employee_id: request.counterpart_employee_id,
        schedule_type: "temporary",
        note: `${original.note ?? ""}\n[代班完成] ${request.counterpart?.full_name ?? "代班員工"} 代班，原員工 ${request.applicant?.full_name ?? ""}，申請 ${request.id}`.trim(),
        source_module: "shift_change",
        source_reference_id: request.id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", request.original_schedule_id);
    if (error) throw error;
  }

  async function approveNext(request: ShiftChangeRequestRow) {
    setSaving(true);
    setError("");
    try {
      const next = nextWorkflow(request);
      if (next.stage === "manager" && profile?.employee_id !== request.counterpart_employee_id && currentUser.role === "team_member") {
        throw new Error("目前關卡需由對方員工同意。");
      }
      if (["manager", "hr"].includes(request.workflow_stage) && !canApprove(currentUser.role)) {
        throw new Error("目前角色沒有主管或人資審核權限。");
      }
      if (next.stage === "schedule_updated") {
        await updateSchedulesForRequest(request);
      }
      const notifications = Array.from(new Set([...(request.notifications ?? []), `已由 ${currentUser.name || "使用者"} 推進至 ${stageLabels[next.stage]}`]));
      const updatePayload = {
        workflow_stage: next.stage,
        status: next.status,
        notifications,
        reviewed_by: currentUser.id || null,
        reviewed_at: new Date().toISOString(),
        completed_at: next.status === "completed" ? new Date().toISOString() : request.completed_at,
        updated_at: new Date().toISOString(),
      };
      const supabase = getClient();
      const { error: updateError } = await supabase.from("shift_change_requests").update(updatePayload).eq("id", request.id);
      if (updateError) throw updateError;
      await writeAudit("shift_change.approve_step", request.id, request, updatePayload, request.company_id);
      setMessage(next.status === "completed" ? `${request.id} 已完成人資確認並更新 schedules。` : `${request.id} 已推進至「${stageLabels[next.stage]}」。`);
      await loadData();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "推進流程失敗。");
    } finally {
      setSaving(false);
    }
  }

  async function rejectRequest(request: ShiftChangeRequestRow) {
    setSaving(true);
    setError("");
    try {
      const updatePayload = {
        workflow_stage: "rejected",
        status: "rejected",
        notifications: Array.from(new Set([...(request.notifications ?? []), "已通知申請人流程駁回"])),
        reviewed_by: currentUser.id || null,
        reviewed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      const supabase = getClient();
      const { error: updateError } = await supabase.from("shift_change_requests").update(updatePayload).eq("id", request.id);
      if (updateError) throw updateError;
      await writeAudit("shift_change.reject", request.id, request, updatePayload, request.company_id);
      setMessage(`${request.id} 已駁回並通知申請人。`);
      await loadData();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "駁回流程失敗。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-medium text-cyan-700">排班異動申請</p>
          <h1 className="text-2xl font-semibold text-slate-950">換班與代班申請</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-500">
            正式流程資料寫入 `shift_change_requests`；人資確認後更新 `schedules`，並保留原始班表快照。
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs font-medium">
          <span className="rounded-full border border-cyan-200 bg-cyan-50 px-3 py-1 text-cyan-700">對方同意</span>
          <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-amber-700">主管審核</span>
          <span className="rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-violet-700">人資確認</span>
        </div>
      </div>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "申請總數", value: `${stats.total} 筆`, icon: ClipboardCheck, tone: "bg-cyan-50 text-cyan-700" },
          { label: "換班申請", value: `${stats.swap} 筆`, icon: Repeat2, tone: "bg-sky-50 text-sky-700" },
          { label: "代班申請", value: `${stats.substitute} 筆`, icon: UsersRound, tone: "bg-violet-50 text-violet-700" },
          { label: "待處理", value: `${stats.pending} 筆`, icon: FileClock, tone: "bg-amber-50 text-amber-700" },
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

      <section className="grid gap-5 xl:grid-cols-[0.85fr_1.15fr]">
        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">發起申請</h2>
              <p className="text-sm text-slate-500">從真實班表選擇原班表與目標班表，送出後通知對方確認。</p>
            </div>
            <Send className="h-5 w-5 text-cyan-600" />
          </div>

          <div className="grid gap-4">
            <div className={`rounded-lg px-3 py-2 text-sm font-semibold ${error ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700"}`}>
              {loading ? "正在從 Supabase 載入..." : saving ? "正在寫入 Supabase workflow..." : error || message}
            </div>

            <div className="grid grid-cols-2 gap-2 rounded-lg bg-slate-100 p-1">
              {(["swap", "substitute"] as RequestType[]).map((type) => (
                <button
                  key={type}
                  onClick={() => setForm((current) => ({ ...current, type }))}
                  className={`rounded-md px-3 py-2 text-sm font-semibold ${form.type === type ? "bg-white text-cyan-700 shadow-sm" : "text-slate-500"}`}
                >
                  員工發起{requestTypeLabels[type]}
                </button>
              ))}
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <label className="space-y-1 text-sm font-medium text-slate-700">
                申請人
                <select value={form.applicantEmployeeId} onChange={(event) => setForm((current) => ({ ...current, applicantEmployeeId: event.target.value }))} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
                  {employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.employee_no} / {employee.full_name}</option>)}
                </select>
              </label>
              <label className="space-y-1 text-sm font-medium text-slate-700">
                對方員工
                <select value={form.counterpartEmployeeId} onChange={(event) => setForm((current) => ({ ...current, counterpartEmployeeId: event.target.value }))} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
                  {employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.employee_no} / {employee.full_name}</option>)}
                </select>
              </label>
            </div>

            <label className="space-y-1 text-sm font-medium text-slate-700">
              原班表
              <select value={form.originalScheduleId} onChange={(event) => setForm((current) => ({ ...current, originalScheduleId: event.target.value }))} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
                {schedules.map((schedule) => <option key={schedule.id} value={schedule.id}>{scheduleLabel(schedule)}</option>)}
              </select>
            </label>
            {form.type === "swap" ? (
              <label className="space-y-1 text-sm font-medium text-slate-700">
                目標班表
                <select value={form.targetScheduleId} onChange={(event) => setForm((current) => ({ ...current, targetScheduleId: event.target.value }))} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
                  {schedules.filter((schedule) => schedule.id !== form.originalScheduleId).map((schedule) => <option key={schedule.id} value={schedule.id}>{scheduleLabel(schedule)}</option>)}
                </select>
              </label>
            ) : (
              <div className="rounded-lg border border-cyan-200 bg-cyan-50 p-3 text-sm text-cyan-800">
                代班會把原班表員工改為對方員工，並將該班表標記為臨時代班。
              </div>
            )}
            <label className="space-y-1 text-sm font-medium text-slate-700">
              申請原因
              <textarea value={form.reason} onChange={(event) => setForm((current) => ({ ...current, reason: event.target.value }))} placeholder="請說明換班或代班原因" rows={4} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
            </label>
          </div>

          <button onClick={() => void submitRequest()} disabled={loading || saving} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-cyan-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-700 disabled:opacity-60">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            送出申請並通知對方
          </button>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">簽核流程架構</h2>
              <p className="text-sm text-slate-500">換班與代班共用流程，完成後自動更新班表並通知相關人員。</p>
            </div>
            <ShieldCheck className="h-5 w-5 text-emerald-600" />
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            {stepOrder.map((step, index) => (
              <div key={step} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-sm font-semibold text-slate-600">{index + 1}</span>
                <p className="mt-3 font-semibold text-slate-950">{stageLabels[step]}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {step === "schedule_updated" ? "完成人資確認後回寫 schedules" : step === "notified" ? "站內通知與 Email 同步發送" : "留下簽核人、時間與意見"}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.35fr_0.65fr]">
        <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 p-5">
            <h2 className="text-lg font-semibold text-slate-950">申請清單</h2>
            <p className="text-sm text-slate-500">資料來源：Supabase `shift_change_requests`。</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1080px] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">申請</th>
                  <th className="px-4 py-3">員工</th>
                  <th className="px-4 py-3">班表異動</th>
                  <th className="px-4 py-3">流程</th>
                  <th className="px-4 py-3">狀態</th>
                  <th className="px-4 py-3">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr><td colSpan={6} className="px-4 py-10 text-center text-sm font-semibold text-slate-500">正在載入換班代班申請...</td></tr>
                ) : requests.map((request) => (
                  <tr key={request.id} className="align-top hover:bg-slate-50">
                    <td className="px-4 py-4">
                      <span className="rounded-full bg-cyan-50 px-2.5 py-1 text-xs font-semibold text-cyan-700">{requestTypeLabels[request.request_type]}</span>
                      <p className="mt-2 font-semibold text-slate-950">{request.id.slice(0, 8)}</p>
                      <p className="text-xs text-slate-500">{new Date(request.created_at).toLocaleString("zh-TW", { hour12: false })}</p>
                    </td>
                    <td className="px-4 py-4">
                      <p className="font-semibold text-slate-900">{request.applicant?.full_name}</p>
                      <p className="text-xs text-slate-500">對方：{request.counterpart?.full_name}</p>
                    </td>
                    <td className="px-4 py-4">
                      <p className="font-medium text-slate-800">原：{scheduleLabel(request.original_schedule)}</p>
                      <p className="mt-1 text-slate-600">新：{request.request_type === "swap" ? scheduleLabel(request.target_schedule) : `${request.counterpart?.full_name} 代班`}</p>
                      <p className="mt-2 max-w-md text-xs text-slate-500">{request.reason}</p>
                    </td>
                    <td className="px-4 py-4">
                      <div className="grid grid-cols-3 gap-1.5">
                        {stepOrder.map((step) => (
                          <span key={`${request.id}-${step}`} className={`rounded-full px-2 py-1 text-center text-[11px] font-semibold ${stepDone(request, step) ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-400"}`}>
                            {stageLabels[step]}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${statusStyles[request.status]}`}>{statusLabels[request.status]}</span>
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex flex-col gap-2">
                        <button onClick={() => void approveNext(request)} disabled={saving || ["completed", "rejected", "cancelled"].includes(request.status)} className="inline-flex items-center justify-center gap-2 rounded-lg border border-emerald-200 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-40">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          推進下一關
                        </button>
                        <button onClick={() => void rejectRequest(request)} disabled={saving || ["completed", "rejected", "cancelled"].includes(request.status)} className="inline-flex items-center justify-center gap-2 rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-40">
                          <XCircle className="h-3.5 w-3.5" />
                          駁回
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {!loading && !requests.length ? (
                  <tr><td colSpan={6} className="px-4 py-10 text-center text-sm font-semibold text-slate-500">目前沒有換班代班申請。</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-5">
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-5">
            <div className="mb-3 flex items-center gap-2">
              <RefreshCw className="h-5 w-5 text-emerald-700" />
              <h2 className="font-semibold text-emerald-900">自動更新班表</h2>
            </div>
            <p className="text-sm text-emerald-800">人資確認後更新 `schedules`，原班表快照保存在 `shift_change_requests`。</p>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-3 flex items-center gap-2">
              <History className="h-5 w-5 text-slate-700" />
              <h2 className="font-semibold text-slate-950">保留原始紀錄</h2>
            </div>
            <div className="space-y-3">
              {requests.slice(0, 3).map((request) => (
                <div key={request.id} className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
                  原始快照：{scheduleLabel(request.original_schedule)}
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-cyan-200 bg-cyan-50 p-5">
            <div className="mb-3 flex items-center gap-2">
              <BellRing className="h-5 w-5 text-cyan-700" />
              <h2 className="font-semibold text-cyan-900">通知相關人員</h2>
            </div>
            <div className="space-y-2">
              {requests[0]?.notifications?.map((notice) => (
                <div key={notice} className="rounded-lg bg-white/80 px-3 py-2 text-sm text-cyan-800">{notice}</div>
              )) ?? <div className="text-sm text-cyan-800">尚無通知紀錄。</div>}
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-3 flex items-center gap-2">
              <UserCheck className="h-5 w-5 text-violet-700" />
              <h2 className="font-semibold text-slate-950">角色責任</h2>
            </div>
            <div className="space-y-2 text-sm text-slate-600">
              <p>員工：發起申請並填寫原因。</p>
              <p>對方：確認同意換班或代班。</p>
              <p>主管：審核人力與班別合理性。</p>
              <p>人資：最終確認並更新班表。</p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
