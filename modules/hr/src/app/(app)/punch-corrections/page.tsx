"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  FileClock,
  FileUp,
  RotateCcw,
  Send,
  UserCheck,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  loadPunchCorrectionRequests,
  punchCorrectionChangedEvent,
  savePunchCorrectionRequests,
  type CorrectionType,
  type PunchCorrectionRequest,
  type RequestStatus,
} from "@/lib/attendance/punch-correction-store";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import {
  derivePayrollProcessBlockers,
  loadLivePayrollSourceChecks,
  type PayrollProcessBlocker,
} from "@/lib/payroll/payroll-store";
import {
  createWorkflowRequest,
  getDefaultTimeline,
  loadWorkflowRequests,
  saveWorkflowRequests,
  type DemoRequestStatus,
} from "@/lib/requests/workflow-store";
import { emitNotificationEvent } from "@/lib/notifications/notification-events";

type FormErrors = Partial<Record<"workDate" | "time" | "reason" | "attachment", string>>;

const correctionTypeLabels: Record<CorrectionType, string> = {
  clock_in: "補上班卡",
  clock_out: "補下班卡",
  modify_time: "修正打卡時間",
};

const statusLabels: Record<RequestStatus, string> = {
  draft: "草稿",
  manager_review: "申請人主管",
  department_review: "申請人部門主管",
  admin_director_review: "行政部門主任",
  hr_confirm: "人資確認",
  applicant_confirm: "申請人確認",
  written_back: "已回寫出勤",
  rejected: "已退回",
};

const flowSteps = [
  "申請人",
  "申請人主管",
  "申請人部門主管",
  "行政部門主任",
  "人資",
  "申請人確認",
  "回寫出勤紀錄",
];
function formatNow() {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(
    now.getHours(),
  )}:${pad(now.getMinutes())}`;
}

function getNextStatus(status: RequestStatus): RequestStatus {
  if (status === "manager_review") return "department_review";
  if (status === "department_review") return "admin_director_review";
  if (status === "admin_director_review") return "hr_confirm";
  if (status === "hr_confirm") return "applicant_confirm";
  if (status === "applicant_confirm") return "written_back";
  return status;
}

function getStepByStatus(status: RequestStatus) {
  const steps: Record<RequestStatus, number> = {
    draft: 0,
    manager_review: 1,
    department_review: 2,
    admin_director_review: 3,
    hr_confirm: 4,
    applicant_confirm: 5,
    written_back: 6,
    rejected: 0,
  };
  return steps[status];
}

function getWorkflowStateByPunchStatus(status: RequestStatus) {
  const ownerByStatus = {
    draft: "applicant",
    manager_review: "supervisor",
    department_review: "supervisor",
    admin_director_review: "admin_director",
    hr_confirm: "hr",
    applicant_confirm: "applicant",
    written_back: "done",
    rejected: "done",
  } as const;
  const stepByStatus = {
    draft: "草稿",
    manager_review: "申請人主管",
    department_review: "申請人部門主管",
    admin_director_review: "行政部門主任",
    hr_confirm: "人資",
    applicant_confirm: "申請人確認",
    written_back: "流程完成",
    rejected: "已駁回",
  } as const;
  const workflowStatus: DemoRequestStatus = status === "written_back" ? "已核准" : status === "rejected" ? "已駁回" : "簽核中";
  const currentStepIndex = getStepByStatus(status);
  const timeline = getDefaultTimeline().map((step, index) => {
    if (status === "written_back") return { ...step, state: "done" as const };
    if (status === "rejected") return index === currentStepIndex ? { ...step, state: "rejected" as const } : step;
    return {
      ...step,
      state: index < currentStepIndex ? "done" as const : index === currentStepIndex ? "current" as const : "pending" as const,
    };
  });

  return {
    currentOwnerRole: ownerByStatus[status],
    currentStep: stepByStatus[status],
    status: workflowStatus,
    timeline,
  };
}

async function updateLinkedWorkflowRequest(requestId: string, punchStatus: RequestStatus, actorName: string, actionText: string) {
  const nextWorkflowState = getWorkflowStateByPunchStatus(punchStatus);
  const nowText = formatNow();
  const currentWorkflowRequests = await loadWorkflowRequests();
  const nextWorkflowRequests = currentWorkflowRequests.map((request) =>
    request.id === requestId
      ? {
          ...request,
          ...nextWorkflowState,
          auditLogs: [...request.auditLogs, `${nowText} ${actorName}${actionText}`],
        }
      : request,
  );
  await saveWorkflowRequests(nextWorkflowRequests);
}

export default function PunchCorrectionsPage() {
  const currentUser = useCurrentUser();
  const [requests, setRequests] = useState<PunchCorrectionRequest[]>([]);
  const [correctionType, setCorrectionType] = useState<CorrectionType>("clock_in");
  const [workDate, setWorkDate] = useState("");
  const [requestedClockIn, setRequestedClockIn] = useState("");
  const [requestedClockOut, setRequestedClockOut] = useState("");
  const [reason, setReason] = useState("");
  const [attachmentName, setAttachmentName] = useState("");
  const [errors, setErrors] = useState<FormErrors>({});
  const [message, setMessage] = useState("");
  const [sourceBlockers, setSourceBlockers] = useState<PayrollProcessBlocker[]>([]);
  const [sourceMessage, setSourceMessage] = useState("正在檢查補卡與薪資阻擋關係。");
  const canReviewAll = ["hr", "admin_director", "ceo", "supervisor"].includes(currentUser.role);
  const canSeeCompany = ["hr", "admin_director", "ceo"].includes(currentUser.role);
  const [showCompanyRequests, setShowCompanyRequests] = useState(false);
  const payrollMonth = "2026-05";

  useEffect(() => {
    setRequests(loadPunchCorrectionRequests());
    const refresh = () => setRequests(loadPunchCorrectionRequests());
    window.addEventListener(punchCorrectionChangedEvent, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(punchCorrectionChangedEvent, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function loadBlockers() {
      try {
        const sourceChecks = await loadLivePayrollSourceChecks(payrollMonth);
        if (!isMounted) return;
        const blockers = derivePayrollProcessBlockers(sourceChecks).filter(
          (blocker) => blocker.stage === "attendance" || blocker.stage === "punch_correction",
        );
        setSourceBlockers(blockers);
        setSourceMessage(
          blockers.length
            ? `目前有 ${blockers.length} 個出勤或補卡阻擋會影響薪資。`
            : "補卡與出勤前置檢核目前沒有阻擋。",
        );
      } catch (error) {
        if (!isMounted) return;
        setSourceMessage(error instanceof Error ? error.message : "讀取 Supabase 出勤與補卡阻擋關係失敗。");
      }
    }

    void loadBlockers();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!canSeeCompany && showCompanyRequests) {
      setShowCompanyRequests(false);
    }
  }, [canSeeCompany, showCompanyRequests]);

  const pendingStatuses: RequestStatus[] = ["manager_review", "department_review", "admin_director_review", "hr_confirm", "applicant_confirm"];
  const pendingCount = useMemo(
    () => requests.filter((request) => pendingStatuses.includes(request.status)).length,
    [requests],
  );
  const anomalyLinkedCount = useMemo(
    () => requests.filter((request) => Boolean(request.sourceAnomalyId)).length,
    [requests],
  );
  const visibleRequests = useMemo(
    () => showCompanyRequests && canSeeCompany
      ? requests
      : requests.filter((request) => request.employeeId === currentUser.id),
    [canSeeCompany, currentUser.id, requests, showCompanyRequests],
  );
  const myRequestCount = useMemo(
    () => requests.filter((request) => request.employeeId === currentUser.id).length,
    [currentUser.id, requests],
  );

  function validateForm() {
    const nextErrors: FormErrors = {};

    if (!workDate) nextErrors.workDate = "請選擇補卡日期";
    if (correctionType === "clock_in" && !requestedClockIn) nextErrors.time = "請填寫補上班時間";
    if (correctionType === "clock_out" && !requestedClockOut) nextErrors.time = "請填寫補下班時間";
    if (correctionType === "modify_time" && !requestedClockIn && !requestedClockOut) {
      nextErrors.time = "請至少填寫一個要修正的打卡時間";
    }
    if (!reason.trim()) nextErrors.reason = "請說明補卡原因";
    if (!attachmentName.trim()) nextErrors.attachment = "請上傳佐證附件";

    return nextErrors;
  }

  function submitRequest() {
    const nextErrors = validateForm();
    setErrors(nextErrors);

    if (Object.keys(nextErrors).length > 0) {
      setMessage("請先修正紅色提示欄位，再送出補打卡申請。");
      return;
    }

    const requestId = `PCR-${workDate.replaceAll("-", "")}-${String(requests.length + 1).padStart(3, "0")}`;
    const nowText = formatNow();
    const details = {
      補卡類型: correctionTypeLabels[correctionType],
      補卡日期: workDate,
      補上班時間: requestedClockIn || "未修正",
      補下班時間: requestedClockOut || "未修正",
    };
    const workflowRequest = {
      ...createWorkflowRequest({
        currentUser,
        type: "補卡",
        date: `${workDate} ${requestedClockIn || requestedClockOut || ""}`.trim(),
        reason,
        details,
        attachmentNames: [attachmentName],
      }),
      id: requestId,
    };
    loadWorkflowRequests()
      .then(async (currentWorkflowRequests) => {
        await saveWorkflowRequests([workflowRequest, ...currentWorkflowRequests]);
        await emitNotificationEvent({
          type: "補卡送出",
          title: `${currentUser.name} 送出補打卡申請`,
          content: `${requestId} 已送出，補卡日期 ${workDate}，等待 ${workflowRequest.currentStep} 處理。`,
          sourceModule: "補打卡",
          sourceId: requestId,
          channels: ["站內通知", "Email"],
          recipientRoles: workflowRequest.currentOwnerRole === "applicant" || workflowRequest.currentOwnerRole === "done" ? undefined : [workflowRequest.currentOwnerRole],
          metadata: { requestId, workDate, correctionType },
        });
      })
      .catch((error) => {
        setMessage(error instanceof Error ? error.message : "補打卡申請寫入 Supabase 表單追蹤失敗。");
      });

    const nextRequest: PunchCorrectionRequest = {
      id: requestId,
      employeeId: currentUser.id,
      employeeName: currentUser.name,
      correctionType,
      workDate,
      requestedClockIn,
      requestedClockOut,
      reason,
      attachmentName,
      status: "manager_review",
      currentStep: 1,
      submittedAt: nowText,
      updatedAt: nowText,
      workflowRequestId: requestId,
      auditLogs: [`${nowText} ${currentUser.name}送出補打卡申請`],
    };

    setRequests((current) => {
      const nextRequests = [nextRequest, ...current];
      savePunchCorrectionRequests(nextRequests);
      return nextRequests;
    });
    setMessage("補打卡申請已送出，已同步進入表單追蹤與簽核中心。");
    setWorkDate("");
    setRequestedClockIn("");
    setRequestedClockOut("");
    setReason("");
    setAttachmentName("");
  }

  function advanceFlow(id: string) {
    const target = requests.find((request) => request.id === id);
    const canApplicantConfirm = target?.status === "applicant_confirm" && target.employeeId === currentUser.id;
    if (!canReviewAll && !canApplicantConfirm) {
      setMessage("目前角色沒有簽核補打卡申請的權限。");
      return;
    }

    setRequests((current) => {
      const nextRequests = current.map((request) => {
        if (request.id !== id) return request;
        const nextStatus = getNextStatus(request.status);
        const nowText = formatNow();
        void updateLinkedWorkflowRequest(request.workflowRequestId ?? request.id, nextStatus, currentUser.name, `通過${statusLabels[request.status]}`);
        return {
          ...request,
          status: nextStatus,
          currentStep: getStepByStatus(nextStatus),
          updatedAt: nowText,
          auditLogs: [...request.auditLogs, `${nowText} ${currentUser.name}通過 ${statusLabels[request.status]}`],
        };
      });
      savePunchCorrectionRequests(nextRequests);
      return nextRequests;
    });
  }

  function rejectRequest(id: string) {
    if (!canReviewAll) {
      setMessage("目前角色沒有退回補打卡申請的權限。");
      return;
    }

    setRequests((current) => {
      const nextRequests = current.map((request) =>
        request.id === id
          ? {
              ...request,
              status: "rejected" as const,
              currentStep: 0,
              updatedAt: formatNow(),
              auditLogs: [...request.auditLogs, `${formatNow()} ${currentUser.name}退回補打卡申請`],
            }
          : request,
      );
      void updateLinkedWorkflowRequest(id, "rejected", currentUser.name, "退回補打卡申請");
      savePunchCorrectionRequests(nextRequests);
      return nextRequests;
    });
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-semibold tracking-[0.14em] text-primary">PUNCH CORRECTION</p>
          <h1 className="mt-2 text-2xl font-black text-foreground">補打卡申請</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            員工可申請補上班卡、補下班卡或修正打卡時間，送出後依流程審核並回寫出勤紀錄。
          </p>
        </div>
        <Badge variant="secondary">{pendingCount} 筆簽核中</Badge>
      </div>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "目前使用者", value: currentUser.name, detail: currentUser.roleLabel },
          { label: "我的補卡", value: `${myRequestCount} 筆`, detail: "本人送出的申請" },
          { label: "待處理", value: `${pendingCount} 筆`, detail: "簽核中或待確認" },
          { label: "異常轉入", value: `${anomalyLinkedCount} 筆`, detail: "由部門出勤異常建立" },
        ].map((item) => (
          <Card key={item.label} className="rounded-lg">
            <CardContent className="p-4">
              <p className="text-sm font-semibold text-muted-foreground">{item.label}</p>
              <p className="mt-2 text-xl font-black">{item.value}</p>
              <p className="mt-2 text-xs text-muted-foreground">{item.detail}</p>
            </CardContent>
          </Card>
        ))}
      </section>

      <Card className="rounded-lg border-rose-200 bg-rose-50/70">
        <CardContent className="p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-700" />
              <div>
                <div className="font-black text-rose-950">補卡與薪資阻擋關係</div>
              <p className="mt-1 text-sm text-rose-800">
                  未打卡、修正時間或位置異常可直接從部門出勤異常轉入補卡；補卡未核准或未回寫時，出勤不能結案，薪資不能鎖定或發布。
                </p>
                <p className="mt-2 text-xs font-semibold text-rose-700">{sourceMessage}</p>
              </div>
            </div>
            <div className="w-fit rounded-full bg-white px-3 py-1 text-xs font-black text-rose-700">
              影響月份 {payrollMonth}
            </div>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            {[
              ["1. 出勤異常", "系統偵測未打卡、時間異常、位置異常或非排班打卡。"],
              ["2. 補卡簽核", "申請人送出後依主管、部門主管、行政主任、人資、申請人確認。"],
              ["3. 回寫結薪", "補卡核准才回寫出勤，出勤清空後才能進薪資草稿與鎖定。"],
            ].map(([title, detail]) => (
              <div key={title} className="rounded-lg bg-white p-3">
                <div className="font-bold text-slate-950">{title}</div>
                <div className="mt-1 text-sm text-slate-600">{detail}</div>
              </div>
            ))}
          </div>
          {sourceBlockers.length ? (
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {sourceBlockers.map((blocker) => (
                <a
                  key={blocker.id}
                  href={blocker.href}
                  className="rounded-lg bg-white p-3 text-sm transition hover:bg-rose-100"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-bold text-rose-900">{blocker.title}</span>
                    <span className="rounded-full bg-rose-50 px-2 py-1 text-xs font-bold text-rose-700">
                      {blocker.count}
                    </span>
                  </div>
                  <p className="mt-2 text-slate-700">{blocker.description}</p>
                  <p className="mt-2 text-xs font-semibold text-rose-700">{blocker.blocks}</p>
                </a>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <section className="grid gap-4 md:grid-cols-3 xl:grid-cols-7">
        {flowSteps.map((step, index) => (
          <Card key={step} className="rounded-lg">
            <CardContent className="flex items-center gap-3 p-4">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-sm font-black text-primary-foreground">
                {index + 1}
              </div>
              <div className="text-sm font-bold">{step}</div>
            </CardContent>
          </Card>
        ))}
      </section>

      <Card className="rounded-lg">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileClock className="h-5 w-5 text-primary" />
            建立補打卡申請
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {message ? (
            <div
              className={`rounded-lg p-3 text-sm font-semibold ${
                Object.keys(errors).length ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700"
              }`}
            >
              {message}
            </div>
          ) : null}

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <label className="grid gap-1.5 text-sm font-semibold">
              申請類型
              <select
                value={correctionType}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                onChange={(event) => setCorrectionType(event.target.value as CorrectionType)}
              >
                {Object.entries(correctionTypeLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1.5 text-sm font-semibold">
              補卡日期
              <Input type="date" value={workDate} onChange={(event) => setWorkDate(event.target.value)} />
              {errors.workDate ? <span className="text-xs text-rose-600">{errors.workDate}</span> : null}
            </label>
            <label className="grid gap-1.5 text-sm font-semibold">
              補上班時間
              <Input
                type="time"
                value={requestedClockIn}
                onChange={(event) => setRequestedClockIn(event.target.value)}
              />
            </label>
            <label className="grid gap-1.5 text-sm font-semibold">
              補下班時間
              <Input
                type="time"
                value={requestedClockOut}
                onChange={(event) => setRequestedClockOut(event.target.value)}
              />
            </label>
            <label className="grid gap-1.5 text-sm font-semibold xl:col-span-3">
              說明原因
              <Input
                value={reason}
                placeholder="請說明忘刷、裝置異常、外出返回或其他補卡原因"
                onChange={(event) => setReason(event.target.value)}
              />
              {errors.reason ? <span className="text-xs text-rose-600">{errors.reason}</span> : null}
              {errors.time ? <span className="text-xs text-rose-600">{errors.time}</span> : null}
            </label>
            <label className="grid gap-1.5 text-sm font-semibold">
              上傳附件
              <div className="flex h-10 items-center gap-2 rounded-md border bg-background px-3 text-sm">
                <FileUp className="h-4 w-4 text-primary" />
                <input
                  type="file"
                  className="w-full text-xs"
                  onChange={(event) => setAttachmentName(event.target.files?.[0]?.name ?? "")}
                />
              </div>
              {errors.attachment ? <span className="text-xs text-rose-600">{errors.attachment}</span> : null}
            </label>
          </div>

          <div className="flex justify-end">
            <Button onClick={submitRequest}>
              <Send className="h-4 w-4" />
              送出申請
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-lg">
        <CardHeader>
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <CardTitle>補打卡申請紀錄</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                送出後會同步出現在表單追蹤與表單簽核；本人可追蹤自己的補卡，人資與高階主管可看公司補卡。
              </p>
            </div>
            {canSeeCompany ? (
              <Button variant="outline" onClick={() => setShowCompanyRequests((current) => !current)}>
                {showCompanyRequests ? "只看我的補卡" : "查看公司補卡"}
              </Button>
            ) : null}
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-hidden rounded-lg border">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1120px] text-left text-sm">
                <thead className="bg-muted/70 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-bold">申請單號</th>
                    <th className="px-4 py-3 font-bold">員工</th>
                    <th className="px-4 py-3 font-bold">類型</th>
                    <th className="px-4 py-3 font-bold">來源異常</th>
                    <th className="px-4 py-3 font-bold">日期</th>
                    <th className="px-4 py-3 font-bold">修正時間</th>
                    <th className="px-4 py-3 font-bold">原因</th>
                    <th className="px-4 py-3 font-bold">附件</th>
                    <th className="px-4 py-3 font-bold">流程狀態</th>
                    <th className="px-4 py-3 font-bold">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {visibleRequests.map((request) => (
                    <tr key={request.id} className="bg-card hover:bg-muted/40">
                      <td className="px-4 py-3 font-semibold">{request.id}</td>
                      <td className="px-4 py-3">
                        <div className="font-bold">{request.employeeName}</div>
                        <div className="text-xs text-muted-foreground">{request.employeeId}</div>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant="secondary">{correctionTypeLabels[request.correctionType]}</Badge>
                      </td>
                      <td className="px-4 py-3">
                        {request.sourceAnomalyId ? (
                          <div className="max-w-[240px]">
                            <Badge className="bg-cyan-600">出勤異常轉入</Badge>
                            <div className="mt-1 text-xs text-muted-foreground">{request.sourceAnomalyReason || "待補原因"}</div>
                            <div className="mt-1 text-xs text-muted-foreground">{request.sourceAddress || "未提供地址"}</div>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">員工自行申請</span>
                        )}
                      </td>
                      <td className="px-4 py-3">{request.workDate}</td>
                      <td className="px-4 py-3">
                        {request.requestedClockIn || "未修正"} / {request.requestedClockOut || "未修正"}
                      </td>
                      <td className="px-4 py-3">{request.reason}</td>
                      <td className="px-4 py-3">{request.attachmentName}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {flowSteps.map((step, index) => (
                            <Badge
                              key={`${request.id}-${step}`}
                              className={
                                index <= request.currentStep
                                  ? "bg-primary"
                                  : "bg-muted text-muted-foreground"
                              }
                            >
                              {index < request.currentStep ? (
                                <CheckCircle2 className="mr-1 h-3 w-3" />
                              ) : index === request.currentStep ? (
                                <Clock3 className="mr-1 h-3 w-3" />
                              ) : null}
                              {step}
                            </Badge>
                          ))}
                        </div>
                        <div className="mt-2 text-xs text-muted-foreground">
                          目前：{statusLabels[request.status]} / 更新：{request.updatedAt}
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          表單追蹤：{request.workflowRequestId ?? request.id}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {pendingStatuses.includes(request.status) ? (
                          <div className="flex flex-wrap gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => advanceFlow(request.id)}
                              disabled={!canReviewAll && !(request.status === "applicant_confirm" && request.employeeId === currentUser.id)}
                            >
                              <UserCheck className="h-4 w-4" />
                              {request.status === "applicant_confirm" ? "申請人確認" : "通過此關"}
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => rejectRequest(request.id)} disabled={!canReviewAll}>
                              退回
                            </Button>
                          </div>
                        ) : request.status === "written_back" ? (
                          <Badge className="bg-emerald-600">
                            <RotateCcw className="mr-1 h-3 w-3" />
                            已回寫
                          </Badge>
                        ) : (
                          <Badge variant="secondary">{statusLabels[request.status]}</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                  {visibleRequests.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="px-4 py-8 text-center text-muted-foreground">
                        目前沒有補打卡申請
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
