"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  FileClock,
  FileText,
  RotateCcw,
  Search,
  Send,
  Shuffle,
  UserRoundCheck,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import {
  loadWorkflowRequests,
  saveWorkflowRequests,
  saveWorkflowDecision,
  type DemoRequestStatus,
  type DemoWorkflowRequest,
  type WorkflowDecisionAction,
} from "@/lib/requests/workflow-store";
import { FinanceStyleApprovalFlow } from "@/components/workflow/finance-style-approval-flow";

type ApprovalCategory =
  | "待我簽核"
  | "我已簽核"
  | "我發起的申請"
  | "被退回的申請"
  | "簽核中"
  | "已核准"
  | "已駁回"
  | "已取消";

const categories: ApprovalCategory[] = ["待我簽核", "我已簽核", "我發起的申請", "被退回的申請", "簽核中", "已核准", "已駁回", "已取消"];
type DecisionLevel = "可核准" | "需確認" | "建議退回";
type DecisionReasonStatus = "pass" | "warning" | "block";

type DecisionReason = {
  label: string;
  status: DecisionReasonStatus;
  detail: string;
};

type ApprovalDecision = {
  level: DecisionLevel;
  summary: string;
  impact: string;
  checks: string[];
  reasons: DecisionReason[];
  nextAction: "approve" | "review" | "return";
};

const flowStepDescriptions: Record<string, string> = {
  申請人: "申請人送出表單並保留原始申請內容。",
  申請人主管: "確認申請內容、工作交接與部門人力影響。",
  申請人部門主管: "確認部門制度、跨組別影響與核准權責。",
  行政部門主任: "確認行政流程、附件完整性與公司內控需求。",
  人資: "確認假勤、出勤、薪資與法規底線。",
  申請人確認: "申請人確認最終結果，完成流程留痕。",
};

const statusStyles: Record<DemoRequestStatus, string> = {
  草稿: "border-slate-200 bg-slate-50 text-slate-600",
  待我簽核: "border-amber-200 bg-amber-50 text-amber-700",
  簽核中: "border-sky-200 bg-sky-50 text-sky-700",
  已核准: "border-emerald-200 bg-emerald-50 text-emerald-700",
  已駁回: "border-rose-200 bg-rose-50 text-rose-700",
  已取消: "border-slate-200 bg-slate-50 text-slate-600",
  被退回: "border-violet-200 bg-violet-50 text-violet-700",
};

const categoryIcons: Record<ApprovalCategory, typeof ClipboardCheck> = {
  待我簽核: ClipboardCheck,
  我已簽核: UserRoundCheck,
  我發起的申請: Send,
  被退回的申請: RotateCcw,
  簽核中: Clock3,
  已核准: CheckCircle2,
  已駁回: XCircle,
  已取消: AlertCircle,
};

const decisionStyles: Record<DecisionLevel, string> = {
  可核准: "border-emerald-200 bg-emerald-50 text-emerald-700",
  需確認: "border-amber-200 bg-amber-50 text-amber-700",
  建議退回: "border-rose-200 bg-rose-50 text-rose-700",
};

const reasonStyles: Record<DecisionReasonStatus, string> = {
  pass: "border-emerald-200 bg-emerald-50 text-emerald-700",
  warning: "border-amber-200 bg-amber-50 text-amber-700",
  block: "border-rose-200 bg-rose-50 text-rose-700",
};

const reasonLabels: Record<DecisionReasonStatus, string> = {
  pass: "通過",
  warning: "確認",
  block: "阻擋",
};

function getDetailValue(request: DemoWorkflowRequest, keywords: string[]) {
  const entry = Object.entries(request.details).find(([key]) => keywords.some((keyword) => key.includes(keyword)));
  return entry?.[1] ?? "";
}

function parseTaiwanDate(value: string) {
  if (!value) return null;
  const normalized = value.includes("T") ? value : `${value}T23:59:59+08:00`;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isLeaveProxyConsentStep(request: DemoWorkflowRequest) {
  return request.type === "請假" && request.currentStep === "職務代理人同意";
}

function isProxyDelegatedApproval(request: DemoWorkflowRequest) {
  return request.details["代理簽核中"] === "是";
}

function isProxyActor(request: DemoWorkflowRequest, currentUserId: string) {
  return Boolean(request.details["職務代理人ID"]) && request.details["職務代理人ID"] === currentUserId;
}

function canReturnToOriginalOwner(request: DemoWorkflowRequest) {
  const leaveEndDate = parseTaiwanDate(request.details["結束日期"] ?? "");
  if (!leaveEndDate) return false;
  return leaveEndDate.getTime() < Date.now();
}

function getProxySummary(request: DemoWorkflowRequest) {
  if (isLeaveProxyConsentStep(request)) {
    return "此請假單需先由職務代理人同意，主管同意後才會正式生效。";
  }
  if (isProxyDelegatedApproval(request)) {
    return canReturnToOriginalOwner(request)
      ? "原職務人已過請假結束日，可一鍵加簽回原職務人確認。"
      : "原職務人尚未回來，簽核需留在職務代理人這邊繼續處理。";
  }
  return "";
}

function getApprovalDecision(request: DemoWorkflowRequest): ApprovalDecision {
  const hasAttachment = request.attachmentNames.length > 0;

  if (request.type === "補卡") {
    const hasTime = Boolean(getDetailValue(request, ["時間", "日期"])) || request.date.length > 0;
    return {
      level: hasAttachment ? "需確認" : "建議退回",
      summary: hasAttachment ? "確認補卡時間與佐證是否一致" : "補卡缺少附件，建議退回補件",
      impact: "影響出勤異常、遲到扣款、薪資草稿與補卡回寫。",
      checks: ["補卡類型", "補卡日期/時間", "佐證附件", "是否已產生出勤異常"],
      reasons: [
        { label: "補卡時間", status: hasTime ? "pass" : "block", detail: hasTime ? "已提供補卡日期或時段。" : "缺少補卡日期或時間，無法回寫出勤。" },
        { label: "佐證附件", status: hasAttachment ? "warning" : "block", detail: hasAttachment ? "已有附件，需確認內容是否可採認。" : "補卡未附佐證，建議退回補件。" },
        { label: "薪資影響", status: "warning", detail: "補卡會影響遲到、未打卡與薪資前置檢核。" },
      ],
      nextAction: hasAttachment ? "review" : "return",
    };
  }

  if (request.type === "加班") {
    const compensation = getDetailValue(request, ["補休", "加班費"]);
    const hasConcreteReason = request.reason.trim().length >= 10;
    return {
      level: "需確認",
      summary: `確認加班必要性與補償方式${compensation ? `：${compensation}` : ""}`,
      impact: "影響月加班時數、加班費、補休與勞基法上限。",
      checks: ["加班日期/時段", "加班類型", "原因是否具體", "補休或加班費"],
      reasons: [
        { label: "加班原因", status: hasConcreteReason ? "pass" : "warning", detail: hasConcreteReason ? "原因描述足夠主管判斷必要性。" : "原因偏短，建議確認是否為工作必要。" },
        { label: "補償方式", status: compensation ? "pass" : "warning", detail: compensation ? `已選擇 ${compensation}。` : "尚未明確選擇加班費或補休。" },
        { label: "法規風險", status: "warning", detail: "需確認是否超過月加班上限與休息日/例假日規則。" },
      ],
      nextAction: "review",
    };
  }

  if (request.type === "請假") {
    const leaveType = getDetailValue(request, ["假別"]);
    const deputy = getDetailValue(request, ["代理"]);
    const proxyConsent = request.details["職務代理同意狀態"];
    const leaveEffective = request.details["請假生效狀態"];
    const needsAttachment = ["病假", "家庭照顧假", "公假", "婚假", "喪假"].some((type) => request.reason.includes(type) || leaveType.includes(type));
    return {
      level: needsAttachment && !hasAttachment ? "建議退回" : deputy && proxyConsent !== "代理人拒絕" ? "可核准" : "需確認",
      summary: isLeaveProxyConsentStep(request) ? `等待職務代理人 ${deputy || "未指定"} 同意` : deputy ? `已有代理人${leaveType ? `，${leaveType}` : ""}` : "請確認職務代理與班表影響",
      impact: "影響部門人力、請假生效、代理簽核、假勤餘額與薪資扣薪。",
      checks: ["假別與時數", "職務代理人同意", "主管同意後生效", "必要附件"],
      reasons: [
        { label: "假別", status: leaveType ? "pass" : "warning", detail: leaveType ? `申請假別為 ${leaveType}。` : "尚未清楚辨識假別，需確認。" },
        { label: "職務代理", status: deputy ? "pass" : "block", detail: deputy ? `已填職務代理人：${deputy}，狀態：${proxyConsent || "待同意"}。` : "未填職務代理人，請假不得生效。" },
        { label: "生效條件", status: leaveEffective === "已生效" ? "pass" : "warning", detail: leaveEffective === "已生效" ? "代理人與主管皆已同意，請假已生效。" : "需職務代理人同意，且申請人主管核准後才生效。" },
        { label: "附件要求", status: needsAttachment && !hasAttachment ? "block" : "pass", detail: needsAttachment && !hasAttachment ? "此假別可能需要附件，建議退回補件。" : "附件要求目前無阻擋。" },
        { label: "部門人力", status: "warning", detail: "核准前需確認當日人力是否足夠。" },
      ],
      nextAction: needsAttachment && !hasAttachment ? "return" : deputy ? "approve" : "review",
    };
  }

  if (request.type === "薪資調整") {
    return {
      level: "需確認",
      summary: "薪資調整需確認原因、金額與核准權限",
      impact: "影響薪資清冊、調整紀錄、會計覆核與稽核軌跡。",
      checks: ["調整原因", "調整金額", "生效月份", "是否需會計覆核"],
      reasons: [
        { label: "權限層級", status: "warning", detail: "薪資調整需確認是否由授權層級核准。" },
        { label: "調整原因", status: request.reason.trim().length >= 10 ? "pass" : "warning", detail: "需保留可稽核的調整理由。" },
        { label: "會計影響", status: "warning", detail: "核准後會影響薪資清冊與會計覆核。" },
      ],
      nextAction: "review",
    };
  }

  return {
    level: hasAttachment ? "需確認" : "可核准",
    summary: hasAttachment ? "確認附件與申請內容一致" : "低風險申請，確認內容即可",
    impact: "影響表單追蹤、通知與後續人資資料。",
    checks: ["申請內容", "目前關卡", "附件", "是否需補件"],
    reasons: [
      { label: "申請內容", status: request.reason.trim().length >= 8 ? "pass" : "warning", detail: request.reason.trim().length >= 8 ? "申請原因足以判斷。" : "申請原因偏短，建議確認。" },
      { label: "附件", status: hasAttachment ? "warning" : "pass", detail: hasAttachment ? "有附件，需確認內容一致。" : "此申請目前無附件阻擋。" },
      { label: "流程", status: "pass", detail: `目前停在 ${request.currentStep}。` },
    ],
    nextAction: hasAttachment ? "review" : "approve",
  };
}

function nowText() {
  return new Date().toLocaleString("zh-TW", { hour12: false });
}

function isCurrentActor(request: DemoWorkflowRequest, currentUserId: string, currentRole: string) {
  if ((isLeaveProxyConsentStep(request) || isProxyDelegatedApproval(request)) && request.details["職務代理人ID"]) {
    return isProxyActor(request, currentUserId);
  }

  if (request.currentOwnerRole === "applicant") {
    return request.applicantId === currentUserId;
  }

  return request.currentOwnerRole === currentRole;
}

function hasCategory(request: DemoWorkflowRequest, category: ApprovalCategory, currentUserId: string, currentRole: string) {
  if (category === "待我簽核") return isCurrentActor(request, currentUserId, currentRole) && ["待我簽核", "簽核中"].includes(request.status);
  if (category === "我已簽核") return request.auditLogs.some((log) => log.includes("核准") && log.includes(currentRole));
  if (category === "我發起的申請") return request.applicantId === currentUserId;
  if (category === "被退回的申請") return request.status === "被退回";
  return request.status === category;
}

function advanceRequest(request: DemoWorkflowRequest, actorLabel: string, actorRole: string, reason = "依決策理由核准"): DemoWorkflowRequest {
  const currentIndex = request.timeline.findIndex((step) => step.state === "current");
  const isApprovingProxyConsent = isLeaveProxyConsentStep(request);
  const isApprovingLeaveSupervisor = request.type === "請假" && request.currentStep === "申請人主管";
  const nextTimeline = request.timeline.map((step, index) => {
    if (index === currentIndex) {
      return { ...step, state: "done" as const, actedAt: nowText(), comment: `${actorLabel}核准：${reason}` };
    }
    if (index === currentIndex + 1) {
      return step.ownerRole === "done"
        ? { ...step, state: "done" as const, actedAt: nowText(), comment: "系統自動完成" }
        : { ...step, state: "current" as const };
    }
    return step;
  });
  const nextStep = nextTimeline.find((step) => step.state === "current");
  const approved = !nextStep;

  return {
    ...request,
    status: approved ? "已核准" : "簽核中",
    currentStep: approved ? "流程完成" : nextStep.step,
    currentOwnerRole: approved ? "done" : nextStep.ownerRole,
    integrationStatus: approved ? "synced" : "linked",
    integrationSummary: {
      ...(request.integrationSummary ?? {}),
      lastDecision: "核准",
      lastDecisionReason: reason,
      nextAction: approved ? "流程完成，回寫關聯資料" : nextStep.step,
    },
    returnReason: undefined,
    lastActionAt: nowText(),
    details: {
      ...request.details,
      ...(isApprovingProxyConsent ? { 職務代理同意狀態: "已同意", 代理同意時間: nowText() } : {}),
      ...(isApprovingLeaveSupervisor ? { 請假生效狀態: "已生效", 請假生效時間: nowText() } : {}),
    },
    auditLogs: [
      ...request.auditLogs,
      `${nowText()} ${actorLabel}(${actorRole})核准 ${request.currentStep}；理由：${reason}`,
      ...(isApprovingProxyConsent ? [`${nowText()} 職務代理人已同意代理，請假單進入主管生效關卡`] : []),
      ...(isApprovingLeaveSupervisor ? [`${nowText()} 主管已同意，請假正式生效；請假期間原職務簽核由職務代理人承接`] : []),
    ],
    timeline: nextTimeline,
  };
}

function closeRequest(request: DemoWorkflowRequest, actorLabel: string, action: "駁回" | "退回補件", reason = "請補充說明或附件"): DemoWorkflowRequest {
  const rejected = action === "駁回";
  return {
    ...request,
    status: rejected ? "已駁回" : "被退回",
    currentStep: rejected ? "已駁回" : "申請人補件",
    currentOwnerRole: rejected ? "done" : "applicant",
    integrationStatus: rejected ? "not_required" : "blocked",
    integrationSummary: {
      ...(request.integrationSummary ?? {}),
      lastDecision: action,
      lastDecisionReason: reason,
      nextAction: rejected ? "流程終止" : "申請人補件重送",
    },
    returnReason: rejected ? undefined : reason,
    revisionNo: rejected ? request.revisionNo : (request.revisionNo ?? 1) + 1,
    lastActionAt: nowText(),
    auditLogs: [...request.auditLogs, `${nowText()} ${actorLabel}${action}：${reason}`],
    timeline: request.timeline.map((step) =>
      step.state === "current"
        ? { ...step, state: rejected ? "rejected" : "returned", actedAt: nowText(), comment: `${action}：${reason}` }
        : step,
    ),
  };
}

function toDecisionAction(action: "核准" | "退回補件" | "駁回"): WorkflowDecisionAction {
  if (action === "核准") return "approve";
  if (action === "退回補件") return "return";
  return "reject";
}

function returnDelegatedApprovalToOriginalOwner(request: DemoWorkflowRequest, actorLabel: string) {
  if (!isProxyDelegatedApproval(request) || !canReturnToOriginalOwner(request)) return request;
  return {
    ...request,
    currentOwnerRole: "applicant" as const,
    currentStep: "原職務人加簽確認",
    details: {
      ...request.details,
      代理簽核中: "否",
      代理簽核交還時間: nowText(),
      代理簽核交還人: actorLabel,
    },
    auditLogs: [
      ...request.auditLogs,
      `${nowText()} ${actorLabel}一鍵加簽回原職務人；原職務人已回來，可接回後續簽核。`,
    ],
    timeline: request.timeline.map((step) =>
      step.state === "current"
        ? { ...step, step: "原職務人加簽確認", ownerRole: "applicant" as const, ownerLabel: "原職務人", comment: "由職務代理人加簽交還" }
        : step,
    ),
  };
}

function shouldActivateLeaveProxy(before: DemoWorkflowRequest, after: DemoWorkflowRequest) {
  return before.type === "請假" && before.currentStep === "申請人主管" && after.details["請假生效狀態"] === "已生效";
}

function applyLeaveProxyDelegation(requests: DemoWorkflowRequest[], leaveRequest: DemoWorkflowRequest) {
  const proxyUserId = leaveRequest.details["職務代理人ID"];
  const proxyName = leaveRequest.details["職務代理人"];
  const proxyRole = leaveRequest.details["職務代理人角色"] as DemoWorkflowRequest["currentOwnerRole"] | undefined;
  if (!proxyUserId || !proxyName || !proxyRole || proxyRole === "applicant" || proxyRole === "done") return requests;

  return requests.map((request) => {
    const isActive = ["待我簽核", "簽核中"].includes(request.status);
    const isSameRequest = request.id === leaveRequest.id;
    const isDelegatableRole = request.currentOwnerRole === leaveRequest.applicantRole;
    const alreadyDelegated = request.details["代理簽核中"] === "是";
    if (!isActive || isSameRequest || !isDelegatableRole || alreadyDelegated) return request;

    return {
      ...request,
      currentOwnerRole: proxyRole,
      details: {
        ...request.details,
        代理簽核中: "是",
        原職務人ID: leaveRequest.applicantId,
        原職務人: leaveRequest.applicant,
        原職務角色: leaveRequest.applicantRole,
        職務代理人ID: proxyUserId,
        職務代理人: proxyName,
        職務代理人角色: proxyRole,
        代理來源請假單: leaveRequest.id,
        代理開始日: leaveRequest.details["開始日期"] ?? "",
        代理結束日: leaveRequest.details["結束日期"] ?? "",
      },
      auditLogs: [
        ...request.auditLogs,
        `${nowText()} 因 ${leaveRequest.applicant} 請假已生效，待簽核表單改由職務代理人 ${proxyName} 承接。`,
      ],
      timeline: request.timeline.map((step) =>
        step.state === "current"
          ? { ...step, ownerRole: proxyRole, ownerLabel: `職務代理人：${proxyName}`, comment: `代理 ${leaveRequest.applicant} 簽核` }
          : step,
      ),
    };
  });
}

function createDecisionSnapshot(request: DemoWorkflowRequest, decision: ApprovalDecision) {
  return {
    request_type: request.type,
    decision_level: decision.level,
    decision_summary: decision.summary,
    impact: decision.impact,
    checks: decision.checks,
    reasons: decision.reasons,
    next_action: decision.nextAction,
  };
}

export default function ApprovalsPage() {
  const currentUser = useCurrentUser();
  const [activeCategory, setActiveCategory] = useState<ApprovalCategory>("待我簽核");
  const [query, setQuery] = useState("");
  const [requests, setRequests] = useState<DemoWorkflowRequest[]>([]);
  const [dataMessage, setDataMessage] = useState("");
  const [decisionNotes, setDecisionNotes] = useState<Record<string, string>>({});

  useEffect(() => {
    let isMounted = true;

    async function refresh() {
      try {
        const rows = await loadWorkflowRequests();
        if (isMounted) setRequests(rows);
      } catch (error) {
        if (isMounted) setDataMessage(error instanceof Error ? error.message : "讀取 Supabase 簽核資料失敗。");
      }
    }

    void refresh();

    return () => {
      isMounted = false;
    };
  }, []);

  async function updateRequest(id: string, action: "核准" | "退回補件" | "駁回", updater: (request: DemoWorkflowRequest) => DemoWorkflowRequest) {
    const before = requests.find((request) => request.id === id);
    if (!before) return;
    const decision = getApprovalDecision(before);
    const reason = decisionNotes[id]?.trim() || decision.summary;
    if (reason.length < 4) {
      setDataMessage("請填寫明確的決策理由，至少 4 個字。");
      return;
    }
    const after = updater(before);
    const replacedRequests = requests.map((request) => (request.id === id ? after : request));
    const nextRequests = shouldActivateLeaveProxy(before, after) ? applyLeaveProxyDelegation(replacedRequests, after) : replacedRequests;
    setRequests(nextRequests);
    try {
      await saveWorkflowDecision({
        before,
        after,
        actorUserId: currentUser.id,
        actorRole: currentUser.role,
        actorName: currentUser.name,
        action: toDecisionAction(action),
        reason,
        decisionSnapshot: createDecisionSnapshot(before, decision),
      });
      if (shouldActivateLeaveProxy(before, after)) {
        await saveWorkflowRequests(nextRequests);
      }
      setDataMessage(`${action}已寫入 hr_requests 與 hr_approval_events。`);
    } catch (error) {
      setDataMessage(error instanceof Error ? error.message : "寫入 Supabase 簽核資料失敗。");
    }
  }

  async function returnProxyRequest(id: string) {
    const before = requests.find((request) => request.id === id);
    if (!before) return;
    const reason = "原職務人已回來，職務代理人一鍵加簽交還原職務人。";
    if (!canReturnToOriginalOwner(before)) {
      setDataMessage("請假人尚未回來，簽核需留在職務代理人這邊繼續處理。");
      return;
    }
    const after = returnDelegatedApprovalToOriginalOwner(before, currentUser.name);
    const nextRequests = requests.map((request) => (request.id === id ? after : request));
    setRequests(nextRequests);
    try {
      await saveWorkflowDecision({
        before,
        after,
        actorUserId: currentUser.id,
        actorRole: currentUser.role,
        actorName: currentUser.name,
        action: "submit",
        reason,
        decisionSnapshot: {
          request_type: before.type,
          proxy_action: "return_to_original_owner",
          proxy_name: before.details["職務代理人"],
          leave_end_date: before.details["結束日期"],
        },
      });
      setDataMessage("已一鍵加簽回原職務人，表單追蹤同步更新。");
    } catch (error) {
      setDataMessage(error instanceof Error ? error.message : "寫入代理加簽資料失敗。");
    }
  }

  async function batchUpdateVisible(action: "核准" | "退回補件") {
    const actionableIds = new Set(actionableVisibleRequests.map((request) => request.id));
    if (actionableIds.size === 0) {
      setDataMessage("目前篩選結果沒有可批次處理的表單。");
      return;
    }
    const decisionEvents: Array<{
      before: DemoWorkflowRequest;
      after: DemoWorkflowRequest;
      action: WorkflowDecisionAction;
      reason: string;
      decision: ApprovalDecision;
    }> = [];
    let nextRequests = requests.map((request) => {
      if (!actionableIds.has(request.id)) return request;
      const decision = getApprovalDecision(request);
      const reason = decisionNotes[request.id]?.trim() || decision.summary;
      const after = action === "核准"
        ? advanceRequest(request, currentUser.name, currentUser.role, reason)
        : closeRequest(request, currentUser.name, "退回補件", reason);
      decisionEvents.push({ before: request, after, action: toDecisionAction(action), reason, decision });
      return after;
    });
    decisionEvents.forEach((event) => {
      if (shouldActivateLeaveProxy(event.before, event.after)) {
        nextRequests = applyLeaveProxyDelegation(nextRequests, event.after);
      }
    });
    setRequests(nextRequests);
    try {
      await Promise.all(decisionEvents.map((event) => saveWorkflowDecision({
        before: event.before,
        after: event.after,
        actorUserId: currentUser.id,
        actorRole: currentUser.role,
        actorName: currentUser.name,
        action: event.action,
        reason: event.reason,
        decisionSnapshot: createDecisionSnapshot(event.before, event.decision),
      })));
      if (decisionEvents.some((event) => shouldActivateLeaveProxy(event.before, event.after))) {
        await saveWorkflowRequests(nextRequests);
      }
      setDataMessage(`已批次${action} ${actionableIds.size} 張表單，表單追蹤同步更新。`);
    } catch (error) {
      setDataMessage(error instanceof Error ? error.message : "批次寫入 Supabase 簽核資料失敗。");
    }
  }

  const counts = useMemo(
    () =>
      categories.reduce<Record<ApprovalCategory, number>>((acc, category) => {
        acc[category] = requests.filter((request) => hasCategory(request, category, currentUser.id, currentUser.role)).length;
        return acc;
      }, {} as Record<ApprovalCategory, number>),
    [currentUser.id, currentUser.role, requests],
  );

  const visibleRequests = useMemo(
    () =>
      requests.filter((request) => {
        const matchesCategory = hasCategory(request, activeCategory, currentUser.id, currentUser.role);
        const keyword = query.trim().toLowerCase();
        const matchesQuery =
          !keyword ||
          [request.id, request.applicant, request.type, request.date, request.reason, request.currentStep]
            .join(" ")
            .toLowerCase()
            .includes(keyword);
        return matchesCategory && matchesQuery;
      }),
    [activeCategory, currentUser.id, currentUser.role, query, requests],
  );

  const actionableVisibleRequests = useMemo(
    () => visibleRequests.filter((request) => isCurrentActor(request, currentUser.id, currentUser.role) && ["待我簽核", "簽核中"].includes(request.status)),
    [currentUser.id, currentUser.role, visibleRequests],
  );
  const decisionSummary = useMemo(() => {
    const decisions = actionableVisibleRequests.map(getApprovalDecision);
    return {
      approve: decisions.filter((decision) => decision.nextAction === "approve").length,
      review: decisions.filter((decision) => decision.nextAction === "review").length,
      return: decisions.filter((decision) => decision.nextAction === "return").length,
    };
  }, [actionableVisibleRequests]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-bold tracking-[0.12em] text-[#b45309]">APPROVAL CENTER</p>
          <h1 className="mt-1 text-2xl font-black text-slate-900">待簽核中心</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-500">
            所有表單一律依申請人、申請人主管、申請人部門主管、行政部門主任、人資、申請人流程推進，所有核准、退回、駁回都會同步回表單追蹤並留下操作紀錄。
          </p>
          {dataMessage ? <p className="mt-2 text-sm font-semibold text-rose-700">{dataMessage}</p> : null}
        </div>
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜尋申請人、類型、日期、原因、關卡"
            className="w-full rounded-lg border border-[#dfc9b1] bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-[#d97706]"
          />
        </div>
      </div>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {categories.map((category) => {
          const Icon = categoryIcons[category];
          const active = activeCategory === category;
          return (
            <button
              key={category}
              onClick={() => setActiveCategory(category)}
              className={`rounded-lg border p-4 text-left shadow-sm transition ${
                active ? "border-[#d97706] bg-[#fff7ed]" : "border-[#ead8c2] bg-white hover:bg-[#fffaf4]"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-slate-700">{category}</span>
                <Icon className={`h-5 w-5 ${active ? "text-[#b45309]" : "text-slate-400"}`} />
              </div>
              <p className="mt-3 text-2xl font-black text-slate-950">{counts[category]} 筆</p>
            </button>
          );
        })}
      </section>

      <section className="grid gap-3 md:grid-cols-3">
        {[
          { label: "可直接核准", value: decisionSummary.approve, detail: "資料完整、風險較低", tone: "border-emerald-200 bg-emerald-50 text-emerald-800" },
          { label: "需主管確認", value: decisionSummary.review, detail: "需看班表、附件或薪資影響", tone: "border-amber-200 bg-amber-50 text-amber-800" },
          { label: "建議退回", value: decisionSummary.return, detail: "缺附件、缺代理或補卡佐證不足", tone: "border-rose-200 bg-rose-50 text-rose-800" },
        ].map((item) => (
          <div key={item.label} className={`rounded-lg border p-4 ${item.tone}`}>
            <div className="text-2xl font-black">{item.value}</div>
            <div className="mt-1 font-bold">{item.label}</div>
            <div className="mt-1 text-xs opacity-80">{item.detail}</div>
          </div>
        ))}
      </section>

      <section className="rounded-lg border border-[#ead8c2] bg-white shadow-sm">
        <div className="flex flex-col gap-2 border-b border-[#ead8c2] p-5 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-950">{activeCategory}</h2>
          <p className="text-sm text-slate-500">主管先看決策理由、影響與檢核點，再決定核准、退回或駁回；處理理由會寫入追蹤紀錄。</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="rounded-full bg-[#fff3de] px-3 py-1 text-xs font-bold text-[#8a4b06]">顯示 {visibleRequests.length} 筆</span>
            <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">可處理 {actionableVisibleRequests.length} 筆</span>
            <Button size="sm" variant="outline" onClick={() => batchUpdateVisible("核准")} disabled={actionableVisibleRequests.length === 0}>
              <CheckCircle2 className="h-3.5 w-3.5" />
              批次核准
            </Button>
            <Button size="sm" variant="outline" onClick={() => batchUpdateVisible("退回補件")} disabled={actionableVisibleRequests.length === 0}>
              <RotateCcw className="h-3.5 w-3.5" />
              批次退回
            </Button>
          </div>
        </div>

        <div className="mobile-card-list p-3">
          {visibleRequests.map((request) => {
            const canAct = isCurrentActor(request, currentUser.id, currentUser.role) && ["待我簽核", "簽核中"].includes(request.status);
            const decision = getApprovalDecision(request);
            const proxySummary = getProxySummary(request);
            const canReturnProxy = canAct && isProxyDelegatedApproval(request) && canReturnToOriginalOwner(request);
            return (
              <article key={request.id} className="mobile-record-card space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-[#fff3de] px-2.5 py-1 text-xs font-bold text-[#8a4b06]">{request.type}</span>
                      <span className={`rounded-full border px-2.5 py-1 text-xs font-bold ${statusStyles[request.status]}`}>{request.status}</span>
                    </div>
                    <h3 className="mt-2 text-base font-black text-slate-950">{request.applicant}</h3>
                    <p className="mt-1 text-xs font-semibold text-slate-500">{request.department} · {request.branch}</p>
                  </div>
                  <div className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-black ${decisionStyles[decision.level]}`}>
                    {decision.level}
                  </div>
                </div>

                <div className="rounded-lg bg-[#fffaf4] p-3">
                  <p className="text-xs font-black tracking-[0.12em] text-[#b45309]">建議判斷</p>
                  <p className="mt-1 text-sm font-black text-slate-950">{decision.summary}</p>
                  <p className="mt-1 text-xs leading-5 text-slate-600">{decision.impact}</p>
                </div>

                {proxySummary ? (
                  <div className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-xs font-semibold leading-5 text-sky-800">
                    {proxySummary}
                  </div>
                ) : null}

                <div className="grid gap-2">
                  <div className="mobile-card-row">
                    <span className="mobile-card-label">日期</span>
                    <span className="mobile-card-value">{request.date}</span>
                  </div>
                  <div className="mobile-card-row">
                    <span className="mobile-card-label">原因</span>
                    <span className="mobile-card-value">{request.reason}</span>
                  </div>
                  <div className="mobile-card-row">
                    <span className="mobile-card-label">目前關卡</span>
                    <span className="mobile-card-value">{request.currentStep}</span>
                  </div>
                  <div className="mobile-card-row">
                    <span className="mobile-card-label">附件</span>
                    <span className="mobile-card-value">{request.attachmentNames.length ? request.attachmentNames.join("、") : "無附件"}</span>
                  </div>
                </div>

                <div className="flex flex-wrap gap-1">
                  {decision.checks.slice(0, 4).map((check) => (
                    <span key={check} className="rounded bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-600">
                      {check}
                    </span>
                  ))}
                </div>

                {canAct ? (
                  <label className="grid gap-1 text-xs font-bold text-slate-600">
                    本次決策備註
                    <textarea
                      value={decisionNotes[request.id] ?? ""}
                      onChange={(event) => setDecisionNotes((current) => ({ ...current, [request.id]: event.target.value }))}
                      className="min-h-20 rounded-lg border border-[#dfc9b1] bg-white px-3 py-2 text-sm font-normal text-slate-700 outline-none focus:border-[#d97706]"
                      placeholder={`預設：${decision.summary}`}
                    />
                  </label>
                ) : null}

                <div className="grid grid-cols-3 gap-2">
                  <Button size="sm" onClick={() => updateRequest(request.id, "核准", (item) => advanceRequest(item, currentUser.name, currentUser.role, decisionNotes[request.id]?.trim() || decision.summary))} disabled={!canAct}>
                    核准
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => updateRequest(request.id, "退回補件", (item) => closeRequest(item, currentUser.name, "退回補件", decisionNotes[request.id]?.trim() || decision.summary))} disabled={!canAct}>
                    退回
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => updateRequest(request.id, "駁回", (item) => closeRequest(item, currentUser.name, "駁回", decisionNotes[request.id]?.trim() || decision.summary))} disabled={!canAct}>
                    駁回
                  </Button>
                </div>
                {isProxyDelegatedApproval(request) ? (
                  <Button size="sm" variant="outline" onClick={() => returnProxyRequest(request.id)} disabled={!canReturnProxy}>
                    <Shuffle className="h-3.5 w-3.5" />
                    一鍵加簽回原職務人
                  </Button>
                ) : null}
              </article>
            );
          })}
        </div>

        <div className="desktop-data-table overflow-x-auto">
          <table className="w-full min-w-[1380px] text-left text-sm">
            <thead className="bg-[#fffaf4] text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">申請人</th>
                <th className="px-4 py-3">快速判斷</th>
                <th className="px-4 py-3">決策理由</th>
                <th className="px-4 py-3">申請內容</th>
                <th className="px-4 py-3">影響與附件</th>
                <th className="px-4 py-3">目前關卡</th>
                <th className="px-4 py-3">狀態</th>
                <th className="px-4 py-3">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visibleRequests.map((request) => {
                const canAct = isCurrentActor(request, currentUser.id, currentUser.role) && ["待我簽核", "簽核中"].includes(request.status);
                const decision = getApprovalDecision(request);
                const proxySummary = getProxySummary(request);
                const canReturnProxy = canAct && isProxyDelegatedApproval(request) && canReturnToOriginalOwner(request);
                return (
                  <tr key={request.id} className="align-top hover:bg-[#fffaf4]">
                    <td className="px-4 py-4">
                      <p className="font-bold text-slate-950">{request.applicant}</p>
                      <p className="text-xs text-slate-500">{request.id}</p>
                        <p className="mt-1 text-xs text-slate-500">{request.department} · {request.branch}</p>
                      </td>
                      <td className="px-4 py-4">
                        <div className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-bold ${decisionStyles[decision.level]}`}>
                          {decision.level}
                        </div>
                        <p className="mt-2 max-w-[220px] text-sm font-semibold text-slate-900">{decision.summary}</p>
                        {proxySummary ? (
                          <p className="mt-2 max-w-[240px] rounded-lg border border-sky-200 bg-sky-50 p-2 text-xs font-semibold leading-5 text-sky-800">
                            {proxySummary}
                          </p>
                        ) : null}
                        <div className="mt-2 flex flex-wrap gap-1">
                          {decision.checks.slice(0, 3).map((check) => (
                            <span key={check} className="rounded bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                              {check}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <div className="grid max-w-[320px] gap-2">
                          {decision.reasons.map((reason) => (
                            <div key={`${request.id}-${reason.label}`} className={`rounded-lg border p-2 ${reasonStyles[reason.status]}`}>
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-xs font-black">{reason.label}</span>
                                <span className="rounded-full bg-white/70 px-2 py-0.5 text-[10px] font-black">
                                  {reasonLabels[reason.status]}
                                </span>
                              </div>
                              <p className="mt-1 text-xs leading-5 opacity-90">{reason.detail}</p>
                            </div>
                          ))}
                          {canAct ? (
                            <label className="grid gap-1 text-xs font-bold text-slate-600">
                              本次決策備註
                              <textarea
                                value={decisionNotes[request.id] ?? ""}
                                onChange={(event) =>
                                  setDecisionNotes((current) => ({ ...current, [request.id]: event.target.value }))
                                }
                                className="min-h-16 rounded-md border border-[#dfc9b1] bg-white px-2 py-1.5 text-xs font-normal text-slate-700 outline-none focus:border-[#d97706]"
                                placeholder={`預設：${decision.summary}`}
                              />
                            </label>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <span className="rounded-full bg-[#fff3de] px-2.5 py-1 text-xs font-bold text-[#8a4b06]">{request.type}</span>
                        <p className="mt-2 font-medium text-slate-800">{request.date}</p>
                        <p className="mt-1 max-w-xs text-sm text-slate-600">{request.reason}</p>
                        <p className="mt-1 text-xs text-slate-500">送出：{request.submittedAt}</p>
                      </td>
                      <td className="px-4 py-4">
                        <p className="max-w-[260px] text-sm text-slate-700">{decision.impact}</p>
                        <div className="mt-2 text-xs font-semibold text-slate-500">
                          附件：{request.attachmentNames.length ? request.attachmentNames.join("、") : "無附件"}
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <p className="font-bold text-slate-900">{request.currentStep}</p>
                        <p className="mt-1 text-xs text-slate-500">簽核人：{request.timeline.find((step) => step.state === "current")?.ownerLabel ?? "無"}</p>
                        <div className="mt-3 max-w-[360px]">
                          <FinanceStyleApprovalFlow
                            compact
                            title="簽核流程"
                            steps={request.timeline.map((step) => ({
                              label: step.step,
                              detail: `${flowStepDescriptions[step.step] ?? step.ownerLabel} 處理角色：${step.ownerLabel}。`,
                              state: step.state,
                              actedAt: step.actedAt,
                              comment: step.comment,
                            }))}
                          />
                        </div>
                      </td>
                    <td className="px-4 py-4">
                      <span className={`rounded-full border px-2.5 py-1 text-xs font-bold ${statusStyles[request.status]}`}>
                        {request.status}
                      </span>
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex flex-col gap-2">
                        <Button size="sm" onClick={() => updateRequest(request.id, "核准", (item) => advanceRequest(item, currentUser.name, currentUser.role, decisionNotes[request.id]?.trim() || decision.summary))} disabled={!canAct}>
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          核准
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => updateRequest(request.id, "退回補件", (item) => closeRequest(item, currentUser.name, "退回補件", decisionNotes[request.id]?.trim() || decision.summary))} disabled={!canAct}>
                          <RotateCcw className="h-3.5 w-3.5" />
                          退回
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => updateRequest(request.id, "駁回", (item) => closeRequest(item, currentUser.name, "駁回", decisionNotes[request.id]?.trim() || decision.summary))} disabled={!canAct}>
                          <XCircle className="h-3.5 w-3.5" />
                          駁回
                        </Button>
                        {isProxyDelegatedApproval(request) ? (
                          <Button size="sm" variant="outline" onClick={() => returnProxyRequest(request.id)} disabled={!canReturnProxy}>
                            <Shuffle className="h-3.5 w-3.5" />
                            加簽回原職務人
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid gap-5 md:grid-cols-3">
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-5">
          <div className="mb-3 flex items-center gap-2"><CheckCircle2 className="h-5 w-5 text-emerald-700" /><h2 className="font-bold text-emerald-900">決策理由</h2></div>
          <p className="text-sm text-emerald-800">每筆核准、退回、駁回都會帶入決策備註，並同步到表單追蹤的操作紀錄。</p>
        </div>
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-5">
          <div className="mb-3 flex items-center gap-2"><FileClock className="h-5 w-5 text-amber-700" /><h2 className="font-bold text-amber-900">待我簽核</h2></div>
          <p className="text-sm text-amber-800">只有目前角色是該關卡簽核人時，核准、退回、駁回按鈕才會啟用。</p>
        </div>
        <div className="rounded-lg border border-[#f0c987] bg-[#fff7ed] p-5">
          <div className="mb-3 flex items-center gap-2"><FileText className="h-5 w-5 text-[#b45309]" /><h2 className="font-bold text-[#7c3f00]">流程追蹤</h2></div>
          <p className="text-sm text-[#8a4b06]">表單申請、表單追蹤與簽核中心共用同一份展示資料。</p>
        </div>
      </section>
    </div>
  );
}
