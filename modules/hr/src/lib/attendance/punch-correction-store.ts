export type CorrectionType = "clock_in" | "clock_out" | "modify_time";

export type RequestStatus =
  | "draft"
  | "manager_review"
  | "department_review"
  | "admin_director_review"
  | "hr_confirm"
  | "applicant_confirm"
  | "written_back"
  | "rejected";

export type PunchCorrectionRequest = {
  id: string;
  employeeId: string;
  employeeName: string;
  correctionType: CorrectionType;
  workDate: string;
  requestedClockIn: string;
  requestedClockOut: string;
  reason: string;
  attachmentName: string;
  status: RequestStatus;
  currentStep: number;
  submittedAt: string;
  updatedAt: string;
  workflowRequestId?: string;
  sourceAnomalyId?: string;
  sourceAnomalyReason?: string;
  sourcePunchTime?: string;
  sourceAddress?: string;
  auditLogs: string[];
};

type CorrectionDraftInput = {
  anomalyId: string;
  employeeId: string;
  employeeName: string;
  punchType: string;
  workDate: string;
  punchTime: string;
  reason: string;
  address: string;
  actorName: string;
};

const storageKey = "suiyue-hris-punch-correction-requests";
export const punchCorrectionChangedEvent = "suiyue-hris-punch-correction-changed";

function canUseStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function formatNow() {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(
    now.getHours(),
  )}:${pad(now.getMinutes())}`;
}

function correctionTypeFromPunch(punchType: string): CorrectionType {
  if (punchType === "clock_out") return "clock_out";
  if (punchType === "clock_in") return "clock_in";
  return "modify_time";
}

export function loadPunchCorrectionRequests() {
  if (!canUseStorage()) return [] as PunchCorrectionRequest[];
  const raw = window.localStorage.getItem(storageKey);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as PunchCorrectionRequest[];
  } catch {
    return [];
  }
}

export function savePunchCorrectionRequests(requests: PunchCorrectionRequest[]) {
  if (!canUseStorage()) return;
  window.localStorage.setItem(storageKey, JSON.stringify(requests));
  window.dispatchEvent(new CustomEvent(punchCorrectionChangedEvent));
}

export function buildCorrectionFromAnomaly(input: CorrectionDraftInput): PunchCorrectionRequest {
  const nowText = formatNow();
  const correctionType = correctionTypeFromPunch(input.punchType);
  const requestedClockIn = correctionType === "clock_in" || correctionType === "modify_time" ? input.punchTime : "";
  const requestedClockOut = correctionType === "clock_out" || correctionType === "modify_time" ? input.punchTime : "";
  const id = `PCR-${input.workDate.replaceAll("-", "")}-${input.anomalyId.slice(0, 6)}`;

  return {
    id,
    employeeId: input.employeeId,
    employeeName: input.employeeName,
    correctionType,
    workDate: input.workDate,
    requestedClockIn,
    requestedClockOut,
    reason: input.reason || "由部門出勤異常轉入，請補充原因。",
    attachmentName: "待補附件",
    status: "manager_review",
    currentStep: 1,
    submittedAt: nowText,
    updatedAt: nowText,
    workflowRequestId: id,
    sourceAnomalyId: input.anomalyId,
    sourceAnomalyReason: input.reason,
    sourcePunchTime: input.punchTime,
    sourceAddress: input.address,
    auditLogs: [`${nowText} ${input.actorName}由出勤異常轉入補卡待處理`],
  };
}

export function upsertPunchCorrectionFromAnomaly(input: CorrectionDraftInput) {
  const current = loadPunchCorrectionRequests();
  const nextRequest = buildCorrectionFromAnomaly(input);
  const exists = current.some((request) => request.sourceAnomalyId === input.anomalyId);
  const nextRequests = exists
    ? current.map((request) =>
        request.sourceAnomalyId === input.anomalyId
          ? {
              ...request,
              updatedAt: formatNow(),
              auditLogs: [...request.auditLogs, `${formatNow()} ${input.actorName}重新同步出勤異常來源`],
            }
          : request,
      )
    : [nextRequest, ...current];
  savePunchCorrectionRequests(nextRequests);
  return nextRequest;
}
