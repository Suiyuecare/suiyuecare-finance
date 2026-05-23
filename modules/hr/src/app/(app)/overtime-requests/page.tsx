"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Coins,
  FileText,
  Gift,
  Loader2,
  Paperclip,
  Send,
  Timer,
  WalletCards,
  XCircle,
} from "lucide-react";
import {
  validateRequestSubmission,
  formatComplianceMessage,
  type ComplianceIssue,
} from "@/lib/compliance/compliance-engine";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

type SupabaseClient = {
  // The live HR schema is ahead of the generated Database type in this repo.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  auth: any;
};

type OvertimeDayType = "weekday" | "rest_day" | "holiday" | "regular_holiday";
type CompensationType = "overtime_pay" | "compensatory_leave";
type RequestStatus = "draft" | "pending" | "approved" | "rejected" | "cancelled";
type WorkflowStage = "draft" | "applicant_submitted" | "direct_manager" | "department_manager" | "admin_director" | "hr_confirm" | "completed" | "rejected" | "cancelled";

type EmployeeRow = {
  id: string;
  company_id: string;
  employee_no: string;
  full_name: string;
  primary_branch_id: string | null;
  primary_department_id: string | null;
};

type ApprovalFlowRow = {
  id: string;
  name: string;
};

type UserProfileRow = {
  employee_id: string | null;
};

type OvertimeRequestRow = {
  id: string;
  company_id: string;
  employee_id: string;
  approval_flow_id: string | null;
  work_date: string;
  starts_at: string;
  ends_at: string;
  total_hours: number;
  overtime_type: OvertimeDayType;
  compensation_type?: CompensationType;
  attachment_ids?: string[];
  workflow_stage?: WorkflowStage;
  review_note?: string | null;
  reason: string | null;
  status: RequestStatus;
  submitted_at: string | null;
  approved_at: string | null;
  created_at: string;
  employees?: { employee_no: string | null; full_name: string | null } | null;
  approval_flows?: { name: string | null } | null;
};

type OvertimeForm = {
  employeeId: string;
  overtimeDate: string;
  startTime: string;
  endTime: string;
  reason: string;
  compensationType: CompensationType;
  attachmentNames: string;
  laborMeetingConsent: boolean;
};

const defaultForm: OvertimeForm = {
  employeeId: "",
  overtimeDate: todayKey(),
  startTime: "18:30",
  endTime: "21:30",
  reason: "",
  compensationType: "overtime_pay",
  attachmentNames: "",
  laborMeetingConsent: false,
};

const overtimeTypeLabels: Record<OvertimeDayType, string> = {
  weekday: "平日",
  rest_day: "休息日",
  holiday: "國定假日",
  regular_holiday: "例假日",
};

const compensationLabels: Record<CompensationType, string> = {
  overtime_pay: "加班費",
  compensatory_leave: "補休",
};

const stageLabels: Record<WorkflowStage, string> = {
  draft: "草稿",
  applicant_submitted: "申請人已送出",
  direct_manager: "申請人主管",
  department_manager: "申請人部門主管",
  admin_director: "行政部門主任",
  hr_confirm: "人資確認",
  completed: "申請人結案通知",
  rejected: "已駁回",
  cancelled: "已取消",
};

const statusLabels: Record<RequestStatus, string> = {
  draft: "草稿",
  pending: "簽核中",
  approved: "已核准",
  rejected: "已駁回",
  cancelled: "已取消",
};

const typeStyles: Record<OvertimeDayType, string> = {
  weekday: "bg-emerald-50 text-emerald-700",
  rest_day: "bg-amber-50 text-amber-700",
  regular_holiday: "bg-rose-50 text-rose-700",
  holiday: "bg-violet-50 text-violet-700",
};

const statusStyles: Record<RequestStatus, string> = {
  draft: "border-slate-200 bg-slate-50 text-slate-700",
  pending: "border-amber-200 bg-amber-50 text-amber-700",
  approved: "border-emerald-200 bg-emerald-50 text-emerald-700",
  rejected: "border-rose-200 bg-rose-50 text-rose-700",
  cancelled: "border-slate-200 bg-slate-50 text-slate-500",
};

function getClient() {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase 尚未設定，無法讀寫加班申請。");
  return supabase as unknown as SupabaseClient;
}

function todayKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function toDateTime(dateKey: string, time: string) {
  return new Date(`${dateKey}T${time}:00+08:00`);
}

function toDateTimeIso(dateKey: string, time: string, endTime?: string) {
  const dateTime = toDateTime(dateKey, time);
  if (endTime && endTime <= time) dateTime.setDate(dateTime.getDate() + 1);
  return dateTime.toISOString();
}

function calculateHours(startTime: string, endTime: string) {
  const start = toDateTime(todayKey(), startTime);
  const end = toDateTime(todayKey(), endTime);
  if (end <= start) end.setDate(end.getDate() + 1);
  return Math.max((end.getTime() - start.getTime()) / 3_600_000, 0);
}

function calculateOvertimeType(date: string): OvertimeDayType {
  const day = new Date(`${date}T00:00:00+08:00`).getDay();
  if (day === 0) return "regular_holiday";
  if (day === 6) return "rest_day";
  return "weekday";
}

function mapOvertimeTypeForCompliance(type: OvertimeDayType) {
  if (type === "weekday") return "平日加班";
  if (type === "rest_day") return "休息日加班";
  if (type === "regular_holiday") return "例假日出勤";
  return "國定假日出勤";
}

function overtimeDescription(type: OvertimeDayType) {
  if (type === "weekday") return "平日延長工時，可選加班費或補休。";
  if (type === "rest_day") return "休息日出勤，會列入薪資加班與工時上限檢核。";
  if (type === "regular_holiday") return "例假日出勤屬高風險情境，須符合天災、事變或突發事件。";
  return "國定假日出勤，需連動薪資計算與補休紀錄。";
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("zh-TW", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Taipei",
  }).format(new Date(value));
}

function attachmentArray(value: string) {
  return value.split(/[,\n]/).map((item) => item.trim()).filter(Boolean);
}

function canApprove(role: string) {
  return ["supervisor", "hr", "admin_director", "ceo"].includes(role);
}

export default function OvertimeRequestsPage() {
  const currentUser = useCurrentUser();
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [approvalFlow, setApprovalFlow] = useState<ApprovalFlowRow | null>(null);
  const [requests, setRequests] = useState<OvertimeRequestRow[]>([]);
  const [form, setForm] = useState<OvertimeForm>(defaultForm);
  const [message, setMessage] = useState("送出後會寫入 Supabase overtime_requests，並進入正式簽核流程。");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [complianceIssues, setComplianceIssues] = useState<ComplianceIssue[]>([]);

  const computedType = calculateOvertimeType(form.overtimeDate);
  const computedHours = calculateHours(form.startTime, form.endTime);
  const selectedEmployee = employees.find((employee) => employee.id === form.employeeId);

  const stats = useMemo(
    () => ({
      total: requests.length,
      fee: requests.filter((request) => (request.compensation_type ?? "overtime_pay") === "overtime_pay").length,
      compLeave: requests.filter((request) => request.compensation_type === "compensatory_leave").length,
      hours: requests.reduce((sum, request) => sum + Number(request.total_hours), 0),
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

      let employeeQuery = supabase
        .from("employees")
        .select("id, company_id, employee_no, full_name, primary_branch_id, primary_department_id")
        .eq("employment_status", "active")
        .is("deleted_at", null)
        .order("employee_no");
      let requestQuery = supabase
        .from("overtime_requests")
        .select(`
          id,
          company_id,
          employee_id,
          approval_flow_id,
          work_date,
          starts_at,
          ends_at,
          total_hours,
          overtime_type,
          compensation_type,
          attachment_ids,
          workflow_stage,
          review_note,
          reason,
          status,
          submitted_at,
          approved_at,
          created_at,
          employees(employee_no, full_name),
          approval_flows(name)
        `)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(100);
      let flowQuery = supabase
        .from("approval_flows")
        .select("id, name")
        .eq("request_type", "overtime")
        .eq("is_active", true)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (currentUser.companyId && currentUser.role !== "ceo") {
        employeeQuery = employeeQuery.eq("company_id", currentUser.companyId);
        requestQuery = requestQuery.eq("company_id", currentUser.companyId);
        flowQuery = flowQuery.eq("company_id", currentUser.companyId);
      }
      if (currentUser.role === "team_member" && currentProfile?.employee_id) {
        employeeQuery = employeeQuery.eq("id", currentProfile.employee_id);
        requestQuery = requestQuery.eq("employee_id", currentProfile.employee_id);
      }

      const [employeeResult, requestResult, flowResult] = await Promise.all([employeeQuery, requestQuery, flowQuery]);
      if (employeeResult.error) throw employeeResult.error;
      if (requestResult.error) throw requestResult.error;
      if (flowResult.error) throw flowResult.error;

      const employeeRows = (employeeResult.data ?? []) as unknown as EmployeeRow[];
      setEmployees(employeeRows);
      setRequests((requestResult.data ?? []) as unknown as OvertimeRequestRow[]);
      setApprovalFlow((flowResult.data ?? null) as ApprovalFlowRow | null);
      setForm((current) => ({
        ...current,
        employeeId: current.employeeId && employeeRows.some((employee) => employee.id === current.employeeId)
          ? current.employeeId
          : employeeRows[0]?.id ?? "",
      }));
      setMessage("已從 Supabase 載入加班申請與簽核流程。");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "加班申請資料載入失敗。");
      setRequests([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, [currentUser.companyId, currentUser.role]);

  function runCompliance() {
    const monthlyHours = requests
      .filter((request) => request.employee_id === form.employeeId)
      .filter((request) => request.work_date.slice(0, 7) === form.overtimeDate.slice(0, 7))
      .filter((request) => !["rejected", "cancelled"].includes(request.status))
      .reduce((sum, request) => sum + Number(request.total_hours), 0);
    const result = validateRequestSubmission({
      formId: "overtime",
      values: {
        "加班類型": mapOvertimeTypeForCompliance(computedType),
        "開始時間": form.startTime,
        "結束時間": form.endTime,
        "本月加班累計": String(monthlyHours),
        "勞資會議同意": form.laborMeetingConsent ? "是" : "否",
      },
      reason: form.reason,
      attachmentNames: attachmentArray(form.attachmentNames),
    });
    setComplianceIssues(result.issues);
    if (result.blocked) {
      setError(formatComplianceMessage(result));
      return false;
    }
    return true;
  }

  async function submitRequest() {
    setError("");
    if (!selectedEmployee) {
      setError("請先選擇申請人。");
      return;
    }
    if (!form.reason.trim()) {
      setError("請填寫加班原因，避免主管與人資無法判斷必要性。");
      return;
    }
    if (computedHours <= 0) {
      setError("加班開始與結束時間不成立，請重新確認。");
      return;
    }
    if (!runCompliance()) return;

    setSaving(true);
    try {
      const supabase = getClient();
      const payload = {
        company_id: selectedEmployee.company_id,
        employee_id: selectedEmployee.id,
        approval_flow_id: approvalFlow?.id ?? null,
        work_date: form.overtimeDate,
        starts_at: toDateTimeIso(form.overtimeDate, form.startTime),
        ends_at: toDateTimeIso(form.overtimeDate, form.endTime, form.startTime),
        total_hours: computedHours,
        overtime_type: computedType,
        compensation_type: form.compensationType,
        attachment_ids: attachmentArray(form.attachmentNames),
        workflow_stage: "direct_manager",
        reason: form.reason.trim(),
        status: "pending",
        submitted_at: new Date().toISOString(),
      };
      const { data, error: insertError } = await supabase
        .from("overtime_requests")
        .insert(payload)
        .select("id")
        .maybeSingle();
      if (insertError) throw insertError;
      await supabase.from("audit_logs").insert({
        company_id: selectedEmployee.company_id,
        actor_user_id: currentUser.id || null,
        action: "overtime_request.submit",
        resource_type: "overtime_requests",
        resource_id: data?.id ?? null,
        after_data: payload,
        metadata: { module: "overtime_requests", approval_flow_id: approvalFlow?.id ?? null },
      });
      setForm({ ...defaultForm, employeeId: selectedEmployee.id });
      setMessage(`已送出加班申請，關卡進入「${stageLabels.direct_manager}」。`);
      await loadData();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "加班申請送出失敗。");
    } finally {
      setSaving(false);
    }
  }

  function nextStage(stage: WorkflowStage): WorkflowStage {
    if (stage === "direct_manager") return "department_manager";
    if (stage === "department_manager") return "admin_director";
    if (stage === "admin_director") return "hr_confirm";
    if (stage === "hr_confirm") return "completed";
    return "direct_manager";
  }

  async function progressRequest(request: OvertimeRequestRow) {
    if (!canApprove(currentUser.role)) {
      setError("目前角色沒有加班簽核權限。");
      return;
    }
    const currentStage = request.workflow_stage ?? "direct_manager";
    const next = nextStage(currentStage);
    const approved = next === "completed";
    setSaving(true);
    try {
      const supabase = getClient();
      const updatePayload = {
        workflow_stage: next,
        status: approved ? "approved" : "pending",
        approved_at: approved ? new Date().toISOString() : request.approved_at,
        review_note: `${currentUser.name || "簽核人"} 通過 ${stageLabels[currentStage]}`,
        updated_at: new Date().toISOString(),
      };
      const { error: updateError } = await supabase
        .from("overtime_requests")
        .update(updatePayload)
        .eq("id", request.id);
      if (updateError) throw updateError;
      await supabase.from("audit_logs").insert({
        company_id: request.company_id,
        actor_user_id: currentUser.id || null,
        action: approved ? "overtime_request.approve_final" : "overtime_request.approve_step",
        resource_type: "overtime_requests",
        resource_id: request.id,
        before_data: request,
        after_data: updatePayload,
        metadata: { module: "overtime_requests", from_stage: currentStage, to_stage: next },
      });
      setMessage(approved ? `${request.id} 已核准完成，後續可進入薪資或補休。` : `${request.id} 已推進至「${stageLabels[next]}」。`);
      await loadData();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "簽核推進失敗。");
    } finally {
      setSaving(false);
    }
  }

  async function rejectRequest(request: OvertimeRequestRow) {
    if (!canApprove(currentUser.role)) {
      setError("目前角色沒有加班簽核權限。");
      return;
    }
    setSaving(true);
    try {
      const supabase = getClient();
      const updatePayload = {
        workflow_stage: "rejected",
        status: "rejected",
        review_note: `${currentUser.name || "簽核人"} 駁回加班申請`,
        updated_at: new Date().toISOString(),
      };
      const { error: updateError } = await supabase.from("overtime_requests").update(updatePayload).eq("id", request.id);
      if (updateError) throw updateError;
      await supabase.from("audit_logs").insert({
        company_id: request.company_id,
        actor_user_id: currentUser.id || null,
        action: "overtime_request.reject",
        resource_type: "overtime_requests",
        resource_id: request.id,
        before_data: request,
        after_data: updatePayload,
        metadata: { module: "overtime_requests" },
      });
      setMessage(`${request.id} 已駁回，申請人可重新送出。`);
      await loadData();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "駁回加班申請失敗。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-medium text-indigo-700">員工自助申請</p>
          <h1 className="text-2xl font-semibold text-slate-950">加班申請</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-500">
            送出後寫入 `overtime_requests`，流程為申請人、主管、部門主管、行政部門主任、人資、申請人結案通知。
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs font-medium">
          {Object.entries(overtimeTypeLabels).map(([key, label]) => (
            <span key={key} className={`rounded-full px-3 py-1 ${typeStyles[key as OvertimeDayType]}`}>{label}</span>
          ))}
        </div>
      </div>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "申請總數", value: `${stats.total} 筆`, icon: FileText, tone: "bg-indigo-50 text-indigo-700" },
          { label: "加班費", value: `${stats.fee} 筆`, icon: WalletCards, tone: "bg-emerald-50 text-emerald-700" },
          { label: "補休", value: `${stats.compLeave} 筆`, icon: Gift, tone: "bg-sky-50 text-sky-700" },
          { label: "加班時數", value: `${stats.hours.toFixed(1)} 小時`, icon: Timer, tone: "bg-amber-50 text-amber-700" },
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
              <h2 className="text-lg font-semibold text-slate-950">新增加班申請</h2>
              <p className="text-sm text-slate-500">送出後進入正式簽核流程，並可被表單追蹤與薪資結算讀取。</p>
            </div>
            <Coins className="h-5 w-5 text-indigo-600" />
          </div>

          <div className={`mb-4 rounded-lg px-3 py-2 text-sm font-semibold ${error ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700"}`}>
            {loading ? "正在從 Supabase 載入..." : saving ? "正在寫入 Supabase workflow..." : error || message}
          </div>

          {complianceIssues.length ? (
            <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
              {complianceIssues.map((issue) => <div key={issue.code}>{issue.title}：{issue.message}</div>)}
            </div>
          ) : null}

          <div className="grid gap-4">
            <label className="space-y-1 text-sm font-medium text-slate-700">
              申請人
              <select
                value={form.employeeId}
                onChange={(event) => setForm((current) => ({ ...current, employeeId: event.target.value }))}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
              >
                {employees.map((employee) => (
                  <option key={employee.id} value={employee.id}>{employee.employee_no} / {employee.full_name}</option>
                ))}
              </select>
            </label>

            <label className="space-y-1 text-sm font-medium text-slate-700">
              加班日期
              <input type="date" value={form.overtimeDate} onChange={(event) => setForm((current) => ({ ...current, overtimeDate: event.target.value }))} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
            </label>

            <div className="grid gap-3 md:grid-cols-2">
              <label className="space-y-1 text-sm font-medium text-slate-700">
                加班開始時間
                <input type="time" value={form.startTime} onChange={(event) => setForm((current) => ({ ...current, startTime: event.target.value }))} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
              </label>
              <label className="space-y-1 text-sm font-medium text-slate-700">
                加班結束時間
                <input type="time" value={form.endTime} onChange={(event) => setForm((current) => ({ ...current, endTime: event.target.value }))} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
              </label>
            </div>

            <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-indigo-900">加班類型自動判斷</p>
                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${typeStyles[computedType]}`}>{overtimeTypeLabels[computedType]}</span>
              </div>
              <p className="mt-2 text-sm text-indigo-800">{overtimeDescription(computedType)}</p>
              <p className="mt-1 text-xs text-indigo-700">試算時數：{computedHours.toFixed(1)} 小時</p>
            </div>

            <label className="space-y-1 text-sm font-medium text-slate-700">
              選擇加班費或補休
              <select value={form.compensationType} onChange={(event) => setForm((current) => ({ ...current, compensationType: event.target.value as CompensationType }))} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
                {Object.entries(compensationLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
              </select>
            </label>

            <label className="space-y-1 text-sm font-medium text-slate-700">
              加班原因
              <textarea value={form.reason} onChange={(event) => setForm((current) => ({ ...current, reason: event.target.value }))} rows={4} placeholder="請說明加班原因" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
            </label>

            <label className="space-y-1 text-sm font-medium text-slate-700">
              附件
              <div className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2">
                <Paperclip className="h-4 w-4 text-slate-400" />
                <input value={form.attachmentNames} onChange={(event) => setForm((current) => ({ ...current, attachmentNames: event.target.value }))} placeholder="輸入附件檔名，多個請用逗號或換行分隔" className="w-full text-sm outline-none" />
              </div>
            </label>

            <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700">
              <input type="checkbox" checked={form.laborMeetingConsent} onChange={(event) => setForm((current) => ({ ...current, laborMeetingConsent: event.target.checked }))} />
              本月加班超過 46 小時時，已具備勞資會議或合法程序紀錄
            </label>
          </div>

          <button onClick={() => void submitRequest()} disabled={loading || saving} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            送出加班申請
          </button>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 p-5">
            <h2 className="text-lg font-semibold text-slate-950">加班申請清單</h2>
            <p className="text-sm text-slate-500">資料來源：Supabase `overtime_requests`，可被待簽核、出勤月曆、薪資結算讀取。</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1080px] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">申請</th>
                  <th className="px-4 py-3">加班日期</th>
                  <th className="px-4 py-3">開始</th>
                  <th className="px-4 py-3">結束</th>
                  <th className="px-4 py-3">加班類型</th>
                  <th className="px-4 py-3">加班費或補休</th>
                  <th className="px-4 py-3">附件</th>
                  <th className="px-4 py-3">關卡</th>
                  <th className="px-4 py-3">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr><td colSpan={9} className="px-4 py-10 text-center text-sm font-semibold text-slate-500">正在載入加班申請...</td></tr>
                ) : requests.map((request) => (
                  <tr key={request.id} className="align-top hover:bg-slate-50">
                    <td className="px-4 py-4">
                      <p className="font-semibold text-slate-950">{request.employees?.full_name ?? "未設定員工"}</p>
                      <p className="text-xs text-slate-500">{request.employees?.employee_no} / {request.id.slice(0, 8)}</p>
                      <p className="mt-2 max-w-xs text-xs text-slate-500">{request.reason}</p>
                    </td>
                    <td className="px-4 py-4 text-slate-700">{request.work_date}</td>
                    <td className="px-4 py-4 text-slate-700">{formatTime(request.starts_at)}</td>
                    <td className="px-4 py-4 text-slate-700">{formatTime(request.ends_at)}</td>
                    <td className="px-4 py-4">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${typeStyles[request.overtime_type]}`}>{overtimeTypeLabels[request.overtime_type]}</span>
                      <p className="mt-2 text-xs text-slate-500">{Number(request.total_hours).toFixed(1)} 小時</p>
                    </td>
                    <td className="px-4 py-4">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${(request.compensation_type ?? "overtime_pay") === "overtime_pay" ? "bg-emerald-50 text-emerald-700" : "bg-sky-50 text-sky-700"}`}>
                        {compensationLabels[request.compensation_type ?? "overtime_pay"]}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-slate-600">{request.attachment_ids?.length ? request.attachment_ids.join("、") : "未上傳附件"}</td>
                    <td className="px-4 py-4">
                      <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${statusStyles[request.status]}`}>{statusLabels[request.status]}</span>
                      <p className="mt-2 text-xs text-slate-500">{stageLabels[request.workflow_stage ?? "direct_manager"]}</p>
                    </td>
                    <td className="px-4 py-4">
                      <button onClick={() => void progressRequest(request)} disabled={saving || ["approved", "rejected", "cancelled"].includes(request.status)} className="inline-flex items-center gap-2 rounded-lg border border-emerald-200 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-40">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        推進審核
                      </button>
                      <button onClick={() => void rejectRequest(request)} disabled={saving || ["approved", "rejected", "cancelled"].includes(request.status)} className="ml-2 inline-flex items-center gap-2 rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-40">
                        <XCircle className="h-3.5 w-3.5" />
                        駁回
                      </button>
                    </td>
                  </tr>
                ))}
                {!loading && !requests.length ? (
                  <tr><td colSpan={9} className="px-4 py-10 text-center text-sm font-semibold text-slate-500">目前沒有加班申請。</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="grid gap-5 md:grid-cols-3">
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-5">
          <div className="mb-3 flex items-center gap-2">
            <WalletCards className="h-5 w-5 text-emerald-700" />
            <h2 className="font-semibold text-emerald-900">加班費</h2>
          </div>
          <p className="text-sm text-emerald-800">核准後可由薪資結算讀取 `overtime_requests` 產生加班費明細。</p>
        </div>
        <div className="rounded-lg border border-sky-200 bg-sky-50 p-5">
          <div className="mb-3 flex items-center gap-2">
            <Gift className="h-5 w-5 text-sky-700" />
            <h2 className="font-semibold text-sky-900">補休</h2>
          </div>
          <p className="text-sm text-sky-800">選擇補休會保存在 `compensation_type`，後續可轉入補休額度。</p>
        </div>
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-5">
          <div className="mb-3 flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-700" />
            <h2 className="font-semibold text-amber-900">法規檢核</h2>
          </div>
          <p className="text-sm text-amber-800">送出前會檢查加班時段、平日加班上限、月加班時數與例假日出勤原因。</p>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <CalendarClock className="mt-0.5 h-5 w-5 text-slate-700" />
          <div>
            <h2 className="font-semibold text-slate-950">正式 workflow</h2>
            <p className="mt-1 text-sm text-slate-500">
              加班申請會連到 `approval_flows` 的 overtime 流程，並以 `workflow_stage` 保留目前關卡；每次送出、通過、駁回都會寫入 `audit_logs`。
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
