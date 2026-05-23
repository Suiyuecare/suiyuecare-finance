import type { CurrentUser } from "@/lib/auth/current-user";
import { supabaseAccountOptions } from "@/lib/auth/current-user";
import type { HrRole } from "@/lib/auth/rbac";
import { emitNotificationEvent, type NotificationEventType } from "@/lib/notifications/notification-events";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

export type DemoRequestType = "請假" | "加班" | "補卡" | "換班" | "人事異動" | "薪資調整" | "文件證明" | "遠端辦公" | "內部簽核" | "會議記錄" | "異常通報" | "總務";
export type DemoRequestStatus = "草稿" | "待我簽核" | "簽核中" | "已核准" | "已駁回" | "已取消" | "被退回";
export type DemoStepState = "done" | "current" | "pending" | "returned" | "rejected";

export type DemoApprovalStep = {
  step: string;
  ownerRole: HrRole | "applicant" | "done";
  ownerLabel: string;
  state: DemoStepState;
  actedAt?: string;
  comment?: string;
};

export type DemoWorkflowRequest = {
  id: string;
  requestNo?: string;
  formId?: string;
  formTitle?: string;
  applicantId: string;
  applicant: string;
  applicantRole: HrRole;
  type: DemoRequestType;
  date: string;
  reason: string;
  details: Record<string, string>;
  department: string;
  branch: string;
  submittedAt: string;
  status: DemoRequestStatus;
  currentStep: string;
  currentOwnerRole: HrRole | "applicant" | "done";
  attachmentNames: string[];
  attachmentStatus?: "not_required" | "missing" | "uploaded" | "verified";
  integrationStatus?: "pending" | "linked" | "synced" | "blocked" | "not_required";
  integrationSummary?: Record<string, unknown>;
  revisionNo?: number;
  lastActionAt?: string;
  returnReason?: string;
  auditLogs: string[];
  timeline: DemoApprovalStep[];
};

export type WorkflowDecisionAction = "approve" | "return" | "reject" | "cancel" | "submit" | "resubmit";

export type WorkflowDecisionEventInput = {
  before: DemoWorkflowRequest;
  after: DemoWorkflowRequest;
  actorUserId: string;
  actorRole: string;
  actorName: string;
  action: WorkflowDecisionAction;
  reason: string;
  decisionSnapshot?: Record<string, unknown>;
};

const requestTypeToSubmittedNotification: Partial<Record<DemoRequestType, NotificationEventType>> = {
  請假: "請假送出",
  加班: "加班送出",
  補卡: "補卡送出",
};

export const demoWorkflowStorageKey = "suiyue-hris-demo-workflow-requests";
export const demoWorkflowChangedEvent = "suiyue-hris-demo-workflow-changed";
const fixedWorkflowStepNames = ["申請人", "申請人主管", "申請人部門主管", "行政部門主任", "人資", "申請人確認"];

const seededRequests: DemoWorkflowRequest[] = [
  {
    id: "REQ-20260518-001",
    applicantId: "hr-u1",
    applicant: "潘雨柔",
    applicantRole: "team_member",
    type: "請假",
    date: "2026-05-20 09:00-18:00",
    reason: "家庭照顧假，需陪同家人就醫。",
    details: { 假別: "家庭照顧假", 請假時數: "8", 職務代理人: "陳怡霖" },
    department: "居家服務部",
    branch: "台北居服站",
    submittedAt: "2026-05-18 09:10",
    status: "待我簽核",
    currentStep: "申請人主管",
    currentOwnerRole: "supervisor",
    attachmentNames: ["就醫陪同證明.pdf"],
    auditLogs: ["2026-05-18 09:10 潘雨柔送出請假申請"],
    timeline: [
      { step: "申請人", ownerRole: "applicant", ownerLabel: "申請人", state: "done", actedAt: "2026-05-18 09:10" },
      { step: "申請人主管", ownerRole: "supervisor", ownerLabel: "申請人主管", state: "current" },
      { step: "申請人部門主管", ownerRole: "supervisor", ownerLabel: "申請人部門主管", state: "pending" },
      { step: "行政部門主任", ownerRole: "admin_director", ownerLabel: "行政部門主任", state: "pending" },
      { step: "人資", ownerRole: "hr", ownerLabel: "人資", state: "pending" },
      { step: "申請人確認", ownerRole: "applicant", ownerLabel: "申請人", state: "pending" },
    ],
  },
  {
    id: "REQ-20260518-002",
    applicantId: "hr-u2",
    applicant: "陳怡霖",
    applicantRole: "supervisor",
    type: "加班",
    date: "2026-05-18 18:30-21:30",
    reason: "日照中心活動後續整理與照護紀錄補登。",
    details: { 加班類型: "平日加班", 補休或加班費: "加班費" },
    department: "日照中心",
    branch: "新北日照中心",
    submittedAt: "2026-05-18 10:25",
    status: "簽核中",
    currentStep: "申請人部門主管",
    currentOwnerRole: "supervisor",
    attachmentNames: [],
    auditLogs: ["2026-05-18 10:25 陳怡霖送出加班申請", "2026-05-18 11:00 主管核准"],
    timeline: [
      { step: "申請人", ownerRole: "applicant", ownerLabel: "申請人", state: "done", actedAt: "2026-05-18 10:25" },
      { step: "申請人主管", ownerRole: "supervisor", ownerLabel: "申請人主管", state: "done", actedAt: "2026-05-18 11:00" },
      { step: "申請人部門主管", ownerRole: "supervisor", ownerLabel: "申請人部門主管", state: "current" },
      { step: "行政部門主任", ownerRole: "admin_director", ownerLabel: "行政部門主任", state: "pending" },
      { step: "人資", ownerRole: "hr", ownerLabel: "人資", state: "pending" },
      { step: "申請人確認", ownerRole: "applicant", ownerLabel: "申請人", state: "pending" },
    ],
  },
  {
    id: "REQ-20260517-003",
    applicantId: "hr-u1",
    applicant: "潘雨柔",
    applicantRole: "team_member",
    type: "補卡",
    date: "2026-05-17 下班卡",
    reason: "服務結束後手機電量不足，返家後補提申請。",
    details: { 補卡類型: "補下班卡", 補卡時間: "18:02" },
    department: "居家服務部",
    branch: "台北居服站",
    submittedAt: "2026-05-17 20:40",
    status: "被退回",
    currentStep: "申請人補件",
    currentOwnerRole: "applicant",
    attachmentNames: [],
    auditLogs: ["2026-05-17 20:40 潘雨柔送出補卡申請", "2026-05-18 08:50 主管退回補件：請補服務紀錄截圖"],
    timeline: [
      { step: "申請人", ownerRole: "applicant", ownerLabel: "申請人", state: "done", actedAt: "2026-05-17 20:40" },
      { step: "申請人主管", ownerRole: "supervisor", ownerLabel: "申請人主管", state: "returned", comment: "請補服務紀錄截圖" },
      { step: "申請人補件", ownerRole: "applicant", ownerLabel: "申請人", state: "current" },
      { step: "申請人主管", ownerRole: "supervisor", ownerLabel: "申請人主管", state: "pending" },
      { step: "申請人部門主管", ownerRole: "supervisor", ownerLabel: "申請人部門主管", state: "pending" },
      { step: "行政部門主任", ownerRole: "admin_director", ownerLabel: "行政部門主任", state: "pending" },
      { step: "人資", ownerRole: "hr", ownerLabel: "人資", state: "pending" },
      { step: "申請人確認", ownerRole: "applicant", ownerLabel: "申請人", state: "pending" },
    ],
  },
];

export function getInitialWorkflowRequests() {
  return seededRequests;
}

type HrRequestRow = {
  id: string;
  no: string | null;
  request_no: string | null;
  form_id: string | null;
  form_title: string | null;
  request_type: string;
  applicant_id: string;
  status: string;
  current_step: string;
  current_owner_role: string;
  reason: string | null;
  submitted_at: string | null;
  approved_at: string | null;
  rejected_at: string | null;
  returned_at: string | null;
  resubmitted_at: string | null;
  return_reason: string | null;
  attachment_status: DemoWorkflowRequest["attachmentStatus"] | null;
  integration_status: DemoWorkflowRequest["integrationStatus"] | null;
  integration_summary: Record<string, unknown> | null;
  revision_no: number | null;
  last_action_at: string | null;
  payload: Record<string, string> | null;
  files: string[] | null;
  timeline: DemoApprovalStep[] | null;
  audit_logs: string[] | null;
  created_at: string;
  users: {
    display_name: string | null;
    roles: { key: string | null } | null;
    employees: {
      primary_branch_id: string | null;
      departments: { name: string | null } | null;
    } | null;
  } | null;
};

function getClient() {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) {
    throw new Error("Supabase 尚未設定，無法讀寫表單資料。");
  }
  return supabase;
}

function mapRequestRow(row: HrRequestRow): DemoWorkflowRequest {
  const payload = row.payload ?? {};
  return normalizeWorkflowRequest({
    id: row.id,
    requestNo: row.request_no ?? row.no ?? row.id,
    formId: row.form_id ?? undefined,
    formTitle: row.form_title ?? row.request_type,
    applicantId: row.applicant_id,
    applicant: row.users?.display_name ?? "未命名使用者",
    applicantRole: (row.users?.roles?.key as HrRole | null) ?? "team_member",
    type: row.request_type as DemoRequestType,
    date: payload["申請日期"] ?? payload["開始日期"] ?? payload["加班日期"] ?? payload["補卡日期"] ?? "未指定",
    reason: row.reason ?? "",
    details: payload,
    department: row.users?.employees?.departments?.name ?? "",
    branch: row.users?.employees?.primary_branch_id ?? "",
    submittedAt: new Date(row.submitted_at ?? row.created_at).toLocaleString("zh-TW", { hour12: false }),
    status: row.status as DemoRequestStatus,
    currentStep: row.current_step,
    currentOwnerRole: row.current_owner_role as DemoWorkflowRequest["currentOwnerRole"],
    attachmentNames: row.files ?? [],
    attachmentStatus: row.attachment_status ?? ((row.files ?? []).length > 0 ? "uploaded" : "not_required"),
    integrationStatus: row.integration_status ?? "pending",
    integrationSummary: row.integration_summary ?? {},
    revisionNo: row.revision_no ?? 1,
    lastActionAt: row.last_action_at ? new Date(row.last_action_at).toLocaleString("zh-TW", { hour12: false }) : undefined,
    returnReason: row.return_reason ?? undefined,
    auditLogs: row.audit_logs ?? [],
    timeline: row.timeline ?? getDefaultTimeline(),
  });
}

function statusTimestampPatch(request: DemoWorkflowRequest) {
  const now = new Date().toISOString();
  if (request.status === "已核准") return { approved_at: now };
  if (request.status === "已駁回") return { rejected_at: now };
  if (request.status === "已取消") return { cancelled_at: now };
  if (request.status === "被退回") return { returned_at: now };
  if (request.status !== "草稿") return { submitted_at: now };
  return {};
}

function getAttachmentStatus(request: DemoWorkflowRequest): NonNullable<DemoWorkflowRequest["attachmentStatus"]> {
  if (request.attachmentStatus) return request.attachmentStatus;
  return request.attachmentNames.length > 0 ? "uploaded" : "not_required";
}

function getIntegrationStatus(request: DemoWorkflowRequest): NonNullable<DemoWorkflowRequest["integrationStatus"]> {
  if (request.integrationStatus) return request.integrationStatus;
  if (request.status === "已核准") return "synced";
  if (request.status === "已駁回" || request.status === "已取消") return "not_required";
  return "pending";
}

function toHrRequestPayload(request: DemoWorkflowRequest) {
  const now = new Date().toISOString();
  return {
    id: request.id,
    no: request.requestNo ?? request.id,
    request_no: request.requestNo ?? request.id,
    form_id: request.formId ?? null,
    form_title: request.formTitle ?? request.type,
    request_type: request.type,
    applicant_id: request.applicantId,
    entity_id: "hr",
    department_code: request.department,
    status: request.status,
    current_step: request.currentStep,
    current_owner_role: request.currentOwnerRole,
    reason: request.reason,
    payload: { ...request.details, 申請日期: request.date },
    files: request.attachmentNames,
    timeline: request.timeline,
    audit_logs: request.auditLogs,
    attachment_status: getAttachmentStatus(request),
    integration_status: getIntegrationStatus(request),
    integration_summary: request.integrationSummary ?? {
      linkedModules: getIntegrationStatus(request) === "synced" ? ["表單追蹤", "待簽核中心", "通知中心"] : ["表單追蹤", "待簽核中心"],
      nextAction: request.status === "被退回" ? "補件重送" : request.currentStep,
    },
    revision_no: request.revisionNo ?? 1,
    return_reason: request.returnReason ?? null,
    last_action_at: now,
    ...statusTimestampPatch(request),
    updated_at: now,
  };
}

async function saveRequestAttachments(request: DemoWorkflowRequest) {
  if (request.attachmentNames.length === 0) return;
  const supabase = getClient();
  // The generated Database type in this repo is older than the live HR schema.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase as any)
    .from("hr_request_attachments")
    .upsert(
      request.attachmentNames.map((fileName) => ({
        request_id: request.id,
        uploaded_by: request.applicantId,
        file_name: fileName,
        attachment_status: "uploaded",
        updated_at: new Date().toISOString(),
      })),
      { onConflict: "request_id,file_name" },
    );
}

async function saveRequestRevision(input: {
  request: DemoWorkflowRequest;
  actorUserId: string;
  action: string;
  reason: string;
}) {
  const supabase = getClient();
  // The generated Database type in this repo is older than the live HR schema.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase as any).from("hr_request_revisions").insert({
    request_id: input.request.id,
    revision_no: input.request.revisionNo ?? 1,
    actor_user_id: input.actorUserId,
    action: input.action,
    reason: input.reason,
    values_snapshot: input.request.details,
    attachment_snapshot: input.request.attachmentNames,
  });
}

export async function loadWorkflowRequests() {
  const supabase = getClient();
  // The generated Database type in this repo is older than the live HR schema.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("hr_requests")
    .select(`
      id,
      no,
      request_no,
      form_id,
      form_title,
      request_type,
      applicant_id,
      status,
      current_step,
      current_owner_role,
      reason,
      submitted_at,
      approved_at,
      rejected_at,
      returned_at,
      resubmitted_at,
      return_reason,
      attachment_status,
      integration_status,
      integration_summary,
      revision_no,
      last_action_at,
      payload,
      files,
      timeline,
      audit_logs,
      created_at,
      users(
        display_name,
        roles(key),
        employees(
          primary_branch_id,
          departments(name)
        )
      )
    `)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return ((data ?? []) as HrRequestRow[]).map(mapRequestRow);
}

export async function saveWorkflowRequests(requests: DemoWorkflowRequest[]) {
  const supabase = getClient();
  // The generated Database type in this repo is older than the live HR schema.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from("hr_requests")
    .upsert(requests.map(toHrRequestPayload), { onConflict: "id" });
  if (error) throw error;
  await Promise.all(requests.map(saveRequestAttachments));
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(demoWorkflowChangedEvent, { detail: requests }));
  }
}

export async function saveWorkflowDecision(input: WorkflowDecisionEventInput) {
  const supabase = getClient();
  const nextPayload = toHrRequestPayload(input.after);

  // The generated Database type in this repo is older than the live HR schema.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: requestError } = await (supabase as any)
    .from("hr_requests")
    .upsert(nextPayload, { onConflict: "id" });
  if (requestError) throw requestError;
  await saveRequestAttachments(input.after);
  await saveRequestRevision({
    request: input.after,
    actorUserId: input.actorUserId,
    action: input.action,
    reason: input.reason,
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: eventError } = await (supabase as any)
    .from("hr_approval_events")
    .insert({
      request_id: input.after.id,
      actor_user_id: input.actorUserId,
      actor_role: input.actorRole,
      actor_name: input.actorName,
      action: input.action,
      step_name: input.before.currentStep,
      decision_reason: input.reason,
      decision_snapshot: input.decisionSnapshot ?? {},
      before_status: input.before.status,
      after_status: input.after.status,
      before_owner_role: input.before.currentOwnerRole,
      after_owner_role: input.after.currentOwnerRole,
    });
  if (eventError) throw eventError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase as any).from("audit_logs").insert({
    actor_user_id: input.actorUserId,
    action: `workflow.${input.action}`,
    resource_type: "hr_requests",
    resource_id: input.after.id,
    request_id: input.after.id,
    before_data: {
      status: input.before.status,
      current_step: input.before.currentStep,
      current_owner_role: input.before.currentOwnerRole,
    },
    after_data: {
      status: input.after.status,
      current_step: input.after.currentStep,
      current_owner_role: input.after.currentOwnerRole,
    },
    metadata: {
      actor_role: input.actorRole,
      actor_name: input.actorName,
      decision_reason: input.reason,
      source: "approval-center",
    },
  });

  try {
    const approved = input.action === "approve";
    const rejected = input.action === "reject";
    const returned = input.action === "return";
    const nextOwnerRole = input.after.currentOwnerRole;
    const recipientRoles = approved && !["applicant", "done"].includes(nextOwnerRole)
      ? [nextOwnerRole as HrRole]
      : [];
    const recipientUserIds = returned || rejected || nextOwnerRole === "applicant" || nextOwnerRole === "done"
      ? [input.after.applicantId]
      : [];
    const eventType: NotificationEventType = rejected
      ? "簽核駁回"
      : returned
        ? "簽核駁回"
        : input.after.status === "已核准"
          ? "簽核通過"
          : requestTypeToSubmittedNotification[input.after.type] ?? "簽核通過";

    await emitNotificationEvent({
      type: eventType,
      title: `${input.after.type}申請${input.action === "approve" ? "已推進" : returned ? "退回補件" : rejected ? "已駁回" : "已更新"}`,
      content: `${input.after.applicant} 的 ${input.after.type} 申請目前關卡：${input.after.currentStep}。決策理由：${input.reason}`,
      sourceModule: "待簽核中心",
      sourceId: input.after.id,
      channels: ["站內通知", "Email"],
      recipientUserIds,
      recipientRoles,
      metadata: {
        requestId: input.after.id,
        beforeStatus: input.before.status,
        afterStatus: input.after.status,
        action: input.action,
        actorName: input.actorName,
      },
    });
  } catch {
    // Notification delivery should not roll back the approval decision.
  }
}

export function buildRequestId(date = new Date()) {
  const day = date.toISOString().slice(0, 10).replaceAll("-", "");
  const suffix = String(date.getTime()).slice(-4);
  return `REQ-${day}-${suffix}`;
}

export function getDefaultTimeline(): DemoApprovalStep[] {
  return [
    { step: "申請人", ownerRole: "applicant", ownerLabel: "申請人", state: "done" },
    { step: "申請人主管", ownerRole: "supervisor", ownerLabel: "申請人主管", state: "current" },
    { step: "申請人部門主管", ownerRole: "supervisor", ownerLabel: "申請人部門主管", state: "pending" },
    { step: "行政部門主任", ownerRole: "admin_director", ownerLabel: "行政部門主任", state: "pending" },
    { step: "人資", ownerRole: "hr", ownerLabel: "人資", state: "pending" },
    { step: "申請人確認", ownerRole: "applicant", ownerLabel: "申請人", state: "pending" },
  ];
}

function findProxyUser(proxyName: string) {
  const trimmed = proxyName.trim();
  if (!trimmed) return null;
  return supabaseAccountOptions.find((user) => user.name === trimmed || user.email === trimmed || user.name.includes(trimmed)) ?? null;
}

function buildLeaveProxyTimeline(proxyName: string): DemoApprovalStep[] {
  const proxyUser = findProxyUser(proxyName);
  const proxyOwnerRole = proxyUser?.role ?? "team_member";
  const now = new Date().toLocaleString("zh-TW", { hour12: false });

  return [
    { step: "申請人", ownerRole: "applicant", ownerLabel: "申請人", state: "done", actedAt: now },
    { step: "職務代理人同意", ownerRole: proxyOwnerRole, ownerLabel: proxyUser ? `職務代理人：${proxyUser.name}` : `職務代理人：${proxyName}`, state: "current" },
    { step: "申請人主管", ownerRole: "supervisor", ownerLabel: "申請人主管", state: "pending" },
    { step: "申請人部門主管", ownerRole: "supervisor", ownerLabel: "申請人部門主管", state: "pending" },
    { step: "行政部門主任", ownerRole: "admin_director", ownerLabel: "行政部門主任", state: "pending" },
    { step: "人資", ownerRole: "hr", ownerLabel: "人資", state: "pending" },
    { step: "申請人確認", ownerRole: "applicant", ownerLabel: "申請人", state: "pending" },
  ];
}

function withLeaveProxyDetails(details: Record<string, string>) {
  const proxyName = details["職務代理人"]?.trim() ?? "";
  if (!proxyName) return details;
  const proxyUser = findProxyUser(proxyName);
  return {
    ...details,
    職務代理人: proxyUser?.name ?? proxyName,
    職務代理人ID: proxyUser?.id ?? "",
    職務代理人角色: proxyUser?.role ?? "team_member",
    職務代理同意狀態: "待同意",
    請假生效狀態: "待代理人與主管同意",
  };
}

function normalizeWorkflowRequest(request: DemoWorkflowRequest): DemoWorkflowRequest {
  const hasFixedTimeline = fixedWorkflowStepNames.every((stepName, index) => request.timeline[index]?.step === stepName);
  if (hasFixedTimeline) return request;

  if (request.status === "草稿") {
    return {
      ...request,
      currentStep: "草稿",
      currentOwnerRole: "applicant",
      timeline: getDefaultTimeline().map((step) => ({ ...step, state: "pending" })),
    };
  }

  if (request.status === "已核准") {
    return {
      ...request,
      currentStep: "流程完成",
      currentOwnerRole: "done",
      timeline: getDefaultTimeline().map((step) => ({ ...step, state: "done" })),
    };
  }

  if (request.status === "被退回") {
    return {
      ...request,
      currentStep: "申請人補件",
      currentOwnerRole: "applicant",
      timeline: [
        { step: "申請人", ownerRole: "applicant", ownerLabel: "申請人", state: "done" },
        { step: "申請人主管", ownerRole: "supervisor", ownerLabel: "申請人主管", state: "returned", comment: "退回補件" },
        { step: "申請人補件", ownerRole: "applicant", ownerLabel: "申請人", state: "current" },
        { step: "申請人主管", ownerRole: "supervisor", ownerLabel: "申請人主管", state: "pending" },
        { step: "申請人部門主管", ownerRole: "supervisor", ownerLabel: "申請人部門主管", state: "pending" },
        { step: "行政部門主任", ownerRole: "admin_director", ownerLabel: "行政部門主任", state: "pending" },
        { step: "人資", ownerRole: "hr", ownerLabel: "人資", state: "pending" },
        { step: "申請人確認", ownerRole: "applicant", ownerLabel: "申請人", state: "pending" },
      ],
    };
  }

  const ownerStepIndex = request.currentOwnerRole === "hr"
    ? 4
    : request.currentOwnerRole === "admin_director"
      ? 3
      : request.currentOwnerRole === "applicant"
        ? 5
        : 1;
  const timeline = getDefaultTimeline().map((step, index) => ({
    ...step,
    state: index < ownerStepIndex ? "done" as const : index === ownerStepIndex ? "current" as const : "pending" as const,
  }));
  const currentStep = timeline[ownerStepIndex] ?? timeline[1];

  return {
    ...request,
    status: request.status === "待我簽核" ? "待我簽核" : "簽核中",
    currentStep: currentStep.step,
    currentOwnerRole: currentStep.ownerRole,
    timeline,
  };
}

export function createWorkflowRequest(input: {
  currentUser: CurrentUser;
  type: DemoRequestType;
  formId?: string;
  formTitle?: string;
  date: string;
  reason: string;
  details: Record<string, string>;
  attachmentNames: string[];
}) {
  const now = new Date();
  const isLeaveRequest = input.type === "請假";
  const proxyName = input.details["職務代理人"]?.trim() ?? "";
  const timeline = isLeaveRequest && proxyName
    ? buildLeaveProxyTimeline(proxyName)
    : getDefaultTimeline().map((step, index) => ({
        ...step,
        actedAt: index === 0 ? now.toLocaleString("zh-TW", { hour12: false }) : step.actedAt,
      }));
  const currentStep = timeline.find((step) => step.state === "current") ?? timeline[1];
  const details = isLeaveRequest ? withLeaveProxyDetails(input.details) : input.details;
  const requestId = buildRequestId(now);

  return {
    id: requestId,
    requestNo: requestId,
    formId: input.formId,
    formTitle: input.formTitle ?? input.type,
    applicantId: input.currentUser.id,
    applicant: input.currentUser.name,
    applicantRole: input.currentUser.role,
    type: input.type,
    date: input.date,
    reason: input.reason,
    details,
    department: input.currentUser.departmentId ?? input.currentUser.departmentCode,
    branch: input.currentUser.primaryBranchId,
    submittedAt: now.toLocaleString("zh-TW", { hour12: false }),
    status: "待我簽核" as const,
    currentStep: currentStep.step,
    currentOwnerRole: currentStep.ownerRole,
    attachmentNames: input.attachmentNames,
    attachmentStatus: input.attachmentNames.length > 0 ? "uploaded" as const : "not_required" as const,
    integrationStatus: "pending" as const,
    integrationSummary: {
      linkedModules: ["表單追蹤", "待簽核中心", "通知中心"],
      nextAction: currentStep.step,
      productizedAt: now.toISOString(),
    },
    revisionNo: 1,
    lastActionAt: now.toLocaleString("zh-TW", { hour12: false }),
    auditLogs: [`${now.toLocaleString("zh-TW", { hour12: false })} ${input.currentUser.name}送出${input.type}申請`],
    timeline,
  };
}
