"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, CheckCircle2, ChevronRight, Eye, Paperclip, Printer, Save, Send, ShieldCheck, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { OperationFeedback, type OperationStatus } from "@/components/ui/operation-feedback";
import { FinanceStyleApprovalFlow } from "@/components/workflow/finance-style-approval-flow";
import { canAny } from "@/lib/auth/rbac";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import {
  formatComplianceMessage,
  isAttachmentRequiredForRequest,
  validateRequestSubmission,
  type ComplianceIssue,
} from "@/lib/compliance/compliance-engine";
import {
  createWorkflowRequest,
  loadWorkflowRequests,
  saveWorkflowRequests,
  getDefaultTimeline,
} from "@/lib/requests/workflow-store";
import {
  getInitialRequestValues,
  getRequestFormDefinition,
  requestFormDefinitions,
} from "@/lib/requests/form-catalog";
import { emitNotificationEvent } from "@/lib/notifications/notification-events";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

type DraftPayload = {
  values: Record<string, string>;
  reason: string;
  attachments: string[];
  savedAt: string;
};

type LeaveTypeRule = {
  id: string;
  name: string;
  minimumUnitMinutes?: number;
  minimumUnitHours?: number;
  maxDailyHours?: number;
  enabled?: boolean;
};

type LeaveRulesSetting = {
  rules?: LeaveTypeRule[];
};

const formSteps = ["填寫內容", "附件與法規", "預覽送出"] as const;

const flowStepDescriptions: Record<string, string> = {
  申請人: "申請人建立表單、填寫原因與附件，送出後正式開始簽核流程。",
  申請人主管: "確認申請內容是否合理、是否影響部門人力與工作交接。",
  申請人部門主管: "確認部門制度、跨組別影響與人力配置，避免重複或越權核准。",
  行政部門主任: "確認行政流程、附件完整性、制度版本與公司內控需求。",
  人資: "確認假勤、出勤、薪資與法規底線，必要時回寫員工主檔與紀錄。",
  申請人確認: "流程完成後由申請人確認結果，後續可在表單追蹤查看完整紀錄。",
};

function getRequestDate(values: Record<string, string>) {
  return (
    values["開始日期"] ||
    values["預計加班日期"] ||
    values["加班日期"] ||
    values["補卡日期"] ||
    values["辦公日期"] ||
    values["生效日期"] ||
    values["預計離職日"] ||
    values["到職日"] ||
    values["申請日期"] ||
    values["會議日期"] ||
    values["事件日期"] ||
    values["需求日期"] ||
    values["借閱日期"] ||
    values["收件日期"] ||
    values["用印日期"] ||
    values["使用日期"] ||
    values["故障日期"] ||
    values["出差期間"] ||
    "未指定"
  );
}

function getReasonPlaceholder(formId: string) {
  if (formId === "leave") return "例如：5/24 上午因家人就醫需請家庭照顧假，工作已交由王小明代理。";
  if (formId === "punch") return "例如：服務地點網路異常，無法即時打卡，已補上服務紀錄截圖。";
  if (formId === "pre-overtime") return "例如：5/24 預計處理月結報表，需事前申請 18:00-20:00 加班。";
  if (formId === "overtime") return "例如：配合臨時個案交接與紀錄補登，需延長工作至 20:00。";
  if (formId === "remote") return "例如：因家中臨時照顧需求，申請 5/24 居家遠端辦公，會於 09:00-18:00 保持聯繫。";
  if (formId === "position-change") return "例如：因組織調整，申請 6/1 起由行政組調至人資組，直屬主管改為陳怡霖。";
  if (formId === "salary-change") return "例如：因通過試用期與職務調整，申請 6/1 起調整本薪與職務津貼。";
  if (formId === "resignation") return "例如：因個人生涯規劃，預計 6/30 離職，交接至王小明並完成離職面談。";
  if (formId === "new-hire") return "例如：新進人員預計 6/1 到職，需建立員工主檔、帳號、薪資與證照訓練待辦。";
  if (formId === "document") return "例如：因申請機關要求，需要一份通用證明文件，以 Email 領取。";
  if (formId === "labor-health-insurance-certificate") return "例如：因銀行貸款申請，需要最近六個月勞健保投保證明，以 Email 領取。";
  if (formId === "employment-certificate") return "例如：因租屋申請，需要中文在職證明，不顯示薪資，以 Email 領取。";
  if (formId === "internal-approval") return "例如：申請採購行政部共用設備，預計 5/30 前完成，會影響行政與人資日常作業。";
  if (formId === "meeting-minutes") return "例如：上傳 5/23 行政會議紀錄，內含本週決議事項、負責人與完成期限。";
  if (formId === "incident-report") return "例如：5/23 上午發現服務紀錄異常，已先通知主管並保留截圖，需要後續追蹤改善。";
  if (formId === "equipment-request") return "例如：因新人到職需請領筆電與門禁卡，使用地點為總公司行政辦公室。";
  if (formId === "document-access-general") return "例如：因合約續約作業，需要調閱 2025 年原始合約，預計 5/30 歸還。";
  if (formId === "official-mail-receipt") return "例如：收到主管機關來文，需交由行政部承辦並於期限內回覆。";
  if (formId === "company-seal-request") return "例如：因合作單位要求，需要於 5/25 前完成合約用印並留存正本。";
  if (formId === "venue-rental") return "例如：申請 6/1 下午借用會議室進行教育訓練，預估 12 人參加。";
  if (formId === "equipment-repair") return "例如：印表機無法列印，已附錯誤畫面照片，需安排維修或備用設備。";
  if (formId === "asset-disposal") return "例如：舊筆電已無法維修，申請報廢回收並更新財產台帳。";
  return "請簡短說明申請原因、日期、時段與需要主管知道的事項。";
}

function getInclusiveDateCount(startDate: string, endDate: string) {
  if (!startDate || !endDate) return 1;
  const start = new Date(`${startDate}T00:00:00+08:00`);
  const end = new Date(`${endDate}T00:00:00+08:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return 1;
  return Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1;
}

function normalizeLeaveRule(rule: LeaveTypeRule) {
  const minimumUnitMinutes = Number.isFinite(rule.minimumUnitMinutes)
    ? Number(rule.minimumUnitMinutes)
    : Math.round((Number(rule.minimumUnitHours) || 1) * 60);

  return {
    ...rule,
    minimumUnitMinutes,
    maxDailyHours: Number.isFinite(rule.maxDailyHours) ? Number(rule.maxDailyHours) : 8,
  };
}

export default function RequestFormPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const params = useParams<{ formId: string }>();
  const currentUser = useCurrentUser();
  const form = getRequestFormDefinition(params.formId);
  const [values, setValues] = useState<Record<string, string>>(() => getInitialRequestValues(form?.fields ?? []));
  const [reason, setReason] = useState("");
  const [attachments, setAttachments] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [complianceIssues, setComplianceIssues] = useState<ComplianceIssue[]>([]);
  const [message, setMessage] = useState("");
  const [lastOperationAt, setLastOperationAt] = useState<Date | null>(null);
  const [activeStep, setActiveStep] = useState<(typeof formSteps)[number]>("填寫內容");
  const [draftMessage, setDraftMessage] = useState("尚未載入草稿");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [leaveRules, setLeaveRules] = useState<LeaveTypeRule[]>([]);

  const draftKey = useMemo(() => `suiyue-hris-form-draft:${currentUser.id || "anonymous"}:${params.formId}`, [currentUser.id, params.formId]);
  const draftId = searchParams.get("draftId");

  useEffect(() => {
    if (!form || !currentUser.id) return;
    if (draftId) return;
    const rawDraft = window.localStorage.getItem(draftKey);
    if (!rawDraft) {
      setDraftMessage("沒有暫存草稿");
      return;
    }
    try {
      const draft = JSON.parse(rawDraft) as DraftPayload;
      setValues({ ...getInitialRequestValues(form.fields), ...draft.values });
      setReason(draft.reason ?? "");
      setAttachments(draft.attachments ?? []);
      setDraftMessage(`已載入 ${new Date(draft.savedAt).toLocaleString("zh-TW", { hour12: false })} 的草稿`);
    } catch {
      setDraftMessage("草稿格式無法讀取，已略過。");
    }
  }, [currentUser.id, draftId, draftKey, form]);

  useEffect(() => {
    if (!form || !currentUser.id || !draftId) return;
    const activeDraftForm = form;
    let isMounted = true;
    async function loadSavedDraft() {
      try {
        const rows = await loadWorkflowRequests();
        const draft = rows.find((request) => request.id === draftId && request.applicantId === currentUser.id);
        if (!isMounted || !draft) return;
        setValues({ ...getInitialRequestValues(activeDraftForm.fields), ...draft.details });
        setReason(draft.reason);
        setAttachments(draft.attachmentNames);
        setMessage(`已載入草稿：${draft.id}`);
        setLastOperationAt(new Date());
        setDraftMessage(`已載入 Supabase 草稿 ${draft.id}`);
      } catch (error) {
        if (isMounted) {
          setMessage(error instanceof Error ? error.message : "讀取 Supabase 草稿失敗。");
          setLastOperationAt(new Date());
        }
      }
    }
    void loadSavedDraft();
    return () => {
      isMounted = false;
    };
  }, [currentUser.id, draftId, form]);

  useEffect(() => {
    if (!form || !currentUser.id) return;
    const timer = window.setTimeout(() => {
      const payload: DraftPayload = {
        values,
        reason,
        attachments,
        savedAt: new Date().toISOString(),
      };
      window.localStorage.setItem(draftKey, JSON.stringify(payload));
      setDraftMessage(`已自動暫存 ${new Date(payload.savedAt).toLocaleTimeString("zh-TW", { hour12: false })}`);
    }, 600);
    return () => window.clearTimeout(timer);
  }, [attachments, currentUser.id, draftKey, form, reason, values]);

  useEffect(() => {
    if (!currentUser.id) return;
    let isMounted = true;
    async function loadLeaveRules() {
      try {
        const supabase = getSupabaseBrowserClient();
        if (!supabase) return;
        let resolvedCompanyId = currentUser.companyId;
        if (!resolvedCompanyId) {
          const { data: company } = await supabase
            .from("companies")
            .select("id")
            .is("deleted_at", null)
            .order("created_at", { ascending: true })
            .limit(1)
            .maybeSingle();
          resolvedCompanyId = (company as { id?: string } | null)?.id ?? "";
        }
        if (!resolvedCompanyId) return;
        const { data, error } = await supabase
          .from("system_settings")
          .select("settings")
          .eq("company_id", resolvedCompanyId)
          .eq("setting_key", "leave_type_rules")
          .is("deleted_at", null)
          .maybeSingle();
        if (error) throw error;
        const settings = (data as { settings: LeaveRulesSetting | null } | null)?.settings;
        const rules = Array.isArray(settings?.rules) ? settings.rules.map(normalizeLeaveRule) : [];
        if (isMounted) setLeaveRules(rules);
      } catch {
        if (isMounted) setLeaveRules([]);
      }
    }
    void loadLeaveRules();
    return () => {
      isMounted = false;
    };
  }, [currentUser.companyId, currentUser.id]);

  if (!form) {
    return (
      <div className="space-y-5">
        <Button asChild variant="outline">
          <Link href="/requests/new">
            <ArrowLeft className="h-4 w-4" />
            返回表單申請
          </Link>
        </Button>
        <Card>
          <CardContent className="p-8 text-center">
            <h1 className="text-xl font-black text-slate-900">找不到這張表單</h1>
            <p className="mt-2 text-sm text-slate-500">請回到表單申請入口重新選擇要填寫的表單。</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!canAny(currentUser.role, form.permissions)) {
    return (
      <div className="space-y-5">
        <Button asChild variant="outline">
          <Link href="/requests/new">
            <ArrowLeft className="h-4 w-4" />
            返回表單申請
          </Link>
        </Button>
        <Card>
          <CardContent className="p-8 text-center">
            <h1 className="text-xl font-black text-slate-900">此角色沒有這張表單權限</h1>
            <p className="mt-2 text-sm text-slate-500">
              請由人資、行政部門主任或執行長到「系統設定 → 角色權限」勾選對應表單類別。
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const activeForm = form;
  if (activeForm.hiddenFromRequestMenu) {
    return (
      <div className="space-y-5">
        <Button asChild variant="outline">
          <Link href="/requests/new">
            <ArrowLeft className="h-4 w-4" />
            返回表單申請
          </Link>
        </Button>
        <Card>
          <CardContent className="p-8 text-center">
            <h1 className="text-xl font-black text-slate-900">請先送出預先加班單</h1>
            <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-500">
              系統已取消直接填寫加班單。請先建立「預先加班單」，待預先單核准後，再到「表單追蹤」將該筆預先加班轉正，填入實際加班時數。
            </p>
            <Button asChild className="mt-5">
              <Link href="/requests/new/pre-overtime">建立預先加班單</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const ActiveIcon = form.icon;
  const flow = getDefaultTimeline();
  const operationStatus: OperationStatus | undefined = isSubmitting
    ? "loading"
    : complianceIssues.some((issue) => issue.severity === "blocking")
      ? "blocked"
      : undefined;
  const requiredFields = activeForm.fields.filter((field) => field.required);
  const completedRequiredFields = requiredFields.filter((field) => values[field.name]?.trim()).length;
  const isReasonReady = Boolean(reason.trim());
  const attachmentIsRequired = isAttachmentRequiredForRequest(activeForm.id, values);
  const isAttachmentReady = !attachmentIsRequired || attachments.length > 0;
  const stepIndex = formSteps.indexOf(activeStep);
  const completionItems = [
    { label: "必填欄位", ready: completedRequiredFields === requiredFields.length, detail: `${completedRequiredFields}/${requiredFields.length}` },
    { label: "申請原因", ready: isReasonReady, detail: isReasonReady ? "已填" : "未填" },
    { label: "附件", ready: isAttachmentReady, detail: attachmentIsRequired ? (attachments.length ? "已附" : "必附") : "選填" },
  ];
  const selectedLeaveRule = activeForm.id === "leave"
    ? leaveRules.find((item) => item.name === values["假別"] && item.enabled !== false)
    : undefined;

  function clearFieldError(fieldName: string) {
    setErrors((current) => {
      if (!current[fieldName]) return current;
      const next = { ...current };
      delete next[fieldName];
      return next;
    });
  }

  function updateFieldValue(fieldName: string, value: string) {
    setValues((current) => ({ ...current, [fieldName]: value }));
    if (value.trim()) clearFieldError(fieldName);
  }

  function updateReason(value: string) {
    setReason(value);
    if (value.trim()) clearFieldError("reason");
  }

  function updateAttachments(fileNames: string[]) {
    setAttachments(fileNames);
    if (fileNames.length > 0) clearFieldError("attachments");
  }

  function getLeaveRuleErrors() {
    const nextErrors: Record<string, string> = {};
    if (activeForm.id !== "leave") return nextErrors;
    const leaveType = values["假別"];
    if (!leaveType) return nextErrors;
    const rule = leaveRules.find((item) => item.name === leaveType && item.enabled !== false);
    if (!rule) return nextErrors;

    const leaveHours = Number(values["請假時數"]);
    if (!Number.isFinite(leaveHours) || leaveHours <= 0) return nextErrors;

    const leaveMinutes = Math.round(leaveHours * 60);
    const minimumUnitMinutes = Number(rule.minimumUnitMinutes) || Math.round((Number(rule.minimumUnitHours) || 1) * 60);
    const maxDailyHours = Number(rule.maxDailyHours) || 8;
    const dateCount = getInclusiveDateCount(values["開始日期"], values["結束日期"]);
    const maxTotalHours = maxDailyHours * dateCount;

    if (leaveMinutes < minimumUnitMinutes) {
      nextErrors["請假時數"] = `${leaveType} 單日最少需申請 ${minimumUnitMinutes} 分鐘。`;
    } else if (leaveMinutes % minimumUnitMinutes !== 0) {
      nextErrors["請假時數"] = `${leaveType} 需以 ${minimumUnitMinutes} 分鐘為申請單位。`;
    } else if (leaveHours > maxTotalHours) {
      nextErrors["請假時數"] = `${leaveType} 單日最多 ${maxDailyHours} 小時，本次 ${dateCount} 日最多 ${maxTotalHours} 小時。`;
    }

    return nextErrors;
  }

  function validate() {
    const nextErrors: Record<string, string> = {};

    activeForm.fields.forEach((field) => {
      if (field.required && !values[field.name]?.trim()) {
        nextErrors[field.name] = "此欄位必填";
      }
    });

    if (activeForm.id === "leave" && values["職務代理人"]?.trim() === currentUser.name) {
      nextErrors["職務代理人"] = "職務代理人不可選自己";
    }

    if (!reason.trim()) {
      nextErrors.reason = "請填寫申請原因";
    }

    if (isAttachmentRequiredForRequest(activeForm.id, values) && attachments.length === 0) {
      nextErrors.attachments = "此表單需要附件";
    }

    if (values["開始日期"] && values["結束日期"] && values["開始日期"] > values["結束日期"]) {
      nextErrors["結束日期"] = "結束日期不可早於開始日期";
    }

    if (Number(values["請假時數"] ?? 1) <= 0 || Number(values["預估費用"] ?? 1) < 0) {
      nextErrors.amount = "數值需大於 0";
    }

    Object.assign(nextErrors, getLeaveRuleErrors());

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }

  function validateCurrentStep() {
    if (activeStep === "填寫內容") {
      const nextErrors: Record<string, string> = {};
      activeForm.fields.forEach((field) => {
        if (field.required && !values[field.name]?.trim()) {
          nextErrors[field.name] = "此欄位必填";
        }
      });
      if (activeForm.id === "leave" && values["職務代理人"]?.trim() === currentUser.name) {
        nextErrors["職務代理人"] = "職務代理人不可選自己";
      }
      Object.assign(nextErrors, getLeaveRuleErrors());
      if (!reason.trim()) nextErrors.reason = "請填寫申請原因";
      setErrors(nextErrors);
      return Object.keys(nextErrors).length === 0;
    }

    if (activeStep === "附件與法規") {
      if (isAttachmentRequiredForRequest(activeForm.id, values) && attachments.length === 0) {
        setErrors({ attachments: "此表單需要附件" });
        return false;
      }
      const compliance = validateRequestSubmission({
        formId: activeForm.id,
        values,
        reason,
        attachmentNames: attachments,
      });
      setComplianceIssues(compliance.issues);
      setMessage(formatComplianceMessage(compliance));
      setLastOperationAt(new Date());
      return !compliance.blocked;
    }

    return true;
  }

  function goNextStep() {
    if (!validateCurrentStep()) {
      setMessage("請先完成目前步驟。");
      setLastOperationAt(new Date());
      return;
    }
    const currentIndex = formSteps.indexOf(activeStep);
    setActiveStep(formSteps[Math.min(currentIndex + 1, formSteps.length - 1)]);
  }

  function clearDraft() {
    window.localStorage.removeItem(draftKey);
    setValues(getInitialRequestValues(activeForm.fields));
    setReason("");
    setAttachments([]);
    setErrors({});
    setComplianceIssues([]);
    setMessage("已清除本表單草稿。");
    setLastOperationAt(new Date());
    setDraftMessage("沒有暫存草稿");
  }

  async function handleSubmit(asDraft = false) {
    setIsSubmitting(true);
    setMessage(asDraft ? "正在儲存草稿，請稍候..." : "正在送出申請並建立簽核流程，請稍候...");
    setLastOperationAt(new Date());

    const localDraftPayload: DraftPayload = {
      values,
      reason,
      attachments,
      savedAt: new Date().toISOString(),
    };
    if (asDraft) {
      window.localStorage.setItem(draftKey, JSON.stringify(localDraftPayload));
      setDraftMessage(`已本機暫存 ${new Date(localDraftPayload.savedAt).toLocaleTimeString("zh-TW", { hour12: false })}`);
    }

    if (!asDraft && !validate()) {
      setMessage("請先修正紅字欄位後再送出。");
      setLastOperationAt(new Date());
      setIsSubmitting(false);
      return;
    }

    if (!asDraft) {
      const compliance = validateRequestSubmission({
        formId: activeForm.id,
        values,
        reason,
        attachmentNames: attachments,
      });
      setComplianceIssues(compliance.issues);
      if (compliance.blocked) {
        setMessage(formatComplianceMessage(compliance));
        setLastOperationAt(new Date());
        setIsSubmitting(false);
        return;
      }
    }

    const request = createWorkflowRequest({
      currentUser,
      type: activeForm.type,
      formId: activeForm.id,
      formTitle: activeForm.title,
      date: getRequestDate(values),
      reason: reason.trim() || "草稿未填原因",
      details: values,
      attachmentNames: attachments,
    });
    const nextRequest = asDraft
      ? { ...request, status: "草稿" as const, currentStep: "草稿", currentOwnerRole: "applicant" as const }
      : request;

    try {
      if (asDraft) {
        const response = await fetch("/api/requests/drafts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ request: nextRequest }),
        });
        const result = await response.json().catch(() => null) as { error?: string } | null;
        if (!response.ok) throw new Error(result?.error ?? "雲端草稿寫入失敗。");
      } else {
        await saveWorkflowRequests([nextRequest]);
      }
      if (!asDraft) {
        await emitNotificationEvent({
          type: activeForm.type === "請假" ? "請假送出" : activeForm.type === "加班" ? "加班送出" : activeForm.type === "補卡" ? "補卡送出" : "系統公告",
          title: `${currentUser.name} 送出${activeForm.type}申請`,
          content: `申請單 ${request.requestNo ?? request.id} 已送出，目前關卡為 ${request.currentStep}。原因：${reason.trim() || "未填寫"}`,
          sourceModule: "表單申請",
          sourceId: request.id,
          channels: ["站內通知", "Email"],
          recipientRoles: request.currentOwnerRole === "applicant" || request.currentOwnerRole === "done" ? undefined : [request.currentOwnerRole],
          metadata: { requestId: request.id, formId: activeForm.id },
        });
      }
      setErrors({});
      setMessage(asDraft ? `已儲存雲端草稿：${request.requestNo ?? request.id}` : `已送出申請：${request.requestNo ?? request.id}，目前關卡為 ${request.currentStep}`);
      setLastOperationAt(new Date());
    } catch (error) {
      if (asDraft) {
        setMessage("已先儲存在此裝置，雲端草稿暫時未同步；請稍後再按一次儲存草稿。");
        setLastOperationAt(new Date());
        setIsSubmitting(false);
        return;
      }
      setMessage(error instanceof Error ? error.message : "寫入 Supabase 表單資料失敗。");
      setLastOperationAt(new Date());
      setIsSubmitting(false);
      return;
    }

    if (!asDraft) {
      window.localStorage.removeItem(draftKey);
      window.setTimeout(() => router.push("/requests"), 700);
    } else {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <Button asChild variant="outline" className="mb-4">
            <Link href="/requests/new">
              <ArrowLeft className="h-4 w-4" />
              返回表單申請
            </Link>
          </Button>
          <p className="text-sm font-bold tracking-[0.12em] text-[#b45309]">FORM APPLICATION</p>
          <h1 className="mt-1 flex items-center gap-3 text-2xl font-black text-slate-900">
            <span className="rounded-xl bg-[#fff3de] p-2 text-[#b45309]">
              <ActiveIcon className="h-6 w-6" />
            </span>
            {form.title}
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">{activeForm.description}</p>
          <div className="mt-3 flex flex-wrap gap-2 text-xs font-bold">
            <span className="rounded-full bg-[#fff3de] px-3 py-1 text-[#8a4b06]">{activeForm.estimatedMinutes} 分鐘</span>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-600">負責人：{activeForm.owner}</span>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-600">{draftMessage}</span>
          </div>
        </div>
        <div className="rounded-full border border-[#f0c987] bg-[#fff7ed] px-4 py-2 text-sm font-bold text-[#7c3f00]">
          申請人：{currentUser.name} · {currentUser.roleLabel}
        </div>
      </div>

      <section className="grid gap-5 xl:grid-cols-[1fr_360px]">
        <Card>
          <CardHeader className="suiyue-section-head border-b">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <CardTitle>{activeForm.title}填寫內容</CardTitle>
              <ol className="flex flex-wrap gap-2" aria-label="表單填寫流程">
                {formSteps.map((step, index) => (
                  <li
                    key={step}
                    aria-current={activeStep === step ? "step" : undefined}
                    className={`rounded-full border px-3 py-1.5 text-xs font-bold ${
                      activeStep === step ? "border-[#d97706] bg-[#fff3de] text-[#8a4b06]" : "border-[#ead8c2] bg-white text-slate-500"
                    }`}
                  >
                    {index + 1}. {step}
                  </li>
                ))}
              </ol>
            </div>
          </CardHeader>
          <CardContent className="pt-5">
            <div className="mb-5 rounded-lg border border-[#ead8c2] bg-[#fffaf4] p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <div className="font-black text-slate-950">照著填就好</div>
                  <div className="mt-1 text-sm text-slate-500">完成必填欄位、申請原因、附件檢查後就能送出。</div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {completionItems.map((item) => (
                    <span
                      key={item.label}
                      className={`rounded-full px-3 py-1 text-xs font-bold ${
                        item.ready ? "bg-emerald-100 text-emerald-800" : "bg-white text-slate-500"
                      }`}
                    >
                      {item.label} {item.detail}
                    </span>
                  ))}
                </div>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2">
                {formSteps.map((step, index) => (
                  <div key={step} className="h-2 rounded-full bg-white">
                    <div
                      className={`h-2 rounded-full ${index <= stepIndex ? "bg-[#d97706]" : "bg-transparent"}`}
                      style={{ width: index <= stepIndex ? "100%" : "0%" }}
                    />
                  </div>
                ))}
              </div>
            </div>

            {activeStep === "填寫內容" ? (
              <div className="grid gap-4 md:grid-cols-2">
                {activeForm.fields.map((field) => (
                  <label key={field.name} className="space-y-2 text-sm font-semibold text-slate-700">
                    {field.name}{field.required ? <span className="text-rose-500"> *</span> : null}
                    {field.type === "select" ? (
                      <select
                        value={values[field.name] ?? ""}
                        onChange={(event) => updateFieldValue(field.name, event.target.value)}
                        className="h-10 w-full rounded-md border border-[#dfc9b1] bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-[#d97706]/20"
                      >
                        <option value="">請選擇{field.name}</option>
                        {field.options?.map((option) => <option key={option}>{option}</option>)}
                      </select>
                    ) : (
                      <Input
                        type={field.type ?? "text"}
                        value={values[field.name] ?? ""}
                        onChange={(event) => updateFieldValue(field.name, event.target.value)}
                        placeholder={field.placeholder ?? `請輸入${field.name}`}
                      />
                    )}
                    {errors[field.name] ? <p className="text-xs text-rose-600">{errors[field.name]}</p> : null}
                    {activeForm.id === "leave" && field.name === "請假時數" && selectedLeaveRule ? (
                      <p className="text-xs font-medium text-[#8a4b06]">
                        {values["假別"]}：最少 {selectedLeaveRule.minimumUnitMinutes ?? Math.round((selectedLeaveRule.minimumUnitHours ?? 1) * 60)} 分鐘，單日最多 {selectedLeaveRule.maxDailyHours ?? 8} 小時。
                      </p>
                    ) : null}
                  </label>
                ))}

                <label className="space-y-2 text-sm font-semibold text-slate-700 md:col-span-2">
                  申請原因 <span className="text-rose-500">*</span>
                  <textarea
                    value={reason}
                    onChange={(event) => updateReason(event.target.value)}
                    className="min-h-32 w-full rounded-md border border-[#dfc9b1] bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#d97706]/20"
                    placeholder={getReasonPlaceholder(activeForm.id)}
                  />
                  {errors.reason ? <p className="text-xs text-rose-600">{errors.reason}</p> : null}
                </label>
              </div>
            ) : null}

            {activeStep === "附件與法規" ? (
              <div className="space-y-4">
                <label className="block rounded-lg border border-dashed border-[#dfc9b1] bg-[#fffaf4] p-4">
                  <div className="flex items-center gap-2 font-bold text-slate-800">
                    <Paperclip className="h-4 w-4 text-[#b45309]" />
                    附件上傳{isAttachmentRequiredForRequest(activeForm.id, values) ? <span className="text-rose-500"> *</span> : null}
                  </div>
                  <input
                    type="file"
                    multiple
                    className="mt-3 block w-full text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-[#d97706] file:px-3 file:py-2 file:text-sm file:font-bold file:text-white"
                    onChange={(event) => updateAttachments(Array.from(event.target.files ?? []).map((file) => file.name))}
                  />
                  <p className="mt-2 text-xs text-slate-500">{activeForm.attachmentHint}</p>
                  <p className="mt-2 text-xs text-slate-500">
                    {attachments.length ? `已選擇：${attachments.join("、")}` : "支援 PDF、圖片、Word、Excel。"}
                  </p>
                  {errors.attachments ? <p className="mt-2 text-xs text-rose-600">{errors.attachments}</p> : null}
                </label>

                <div className="rounded-lg border border-[#ead8c2] bg-white p-4">
                  <div className="mb-3 flex items-center gap-2 font-black text-slate-900">
                    <ShieldCheck className="h-5 w-5 text-[#b45309]" />
                    送出前政策檢查
                  </div>
                  <div className="grid gap-2">
                    {activeForm.policyNotes.map((note) => (
                      <div key={note} className="flex items-start gap-2 rounded-lg bg-[#fffaf4] p-3 text-sm text-slate-600">
                        <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600" />
                        {note}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}

            {activeStep === "預覽送出" ? (
              <div className="space-y-4">
                <div className="rounded-lg border border-[#ead8c2] bg-[#fffaf4] p-4">
                  <div className="mb-3 flex items-center gap-2 font-black text-slate-900">
                    <Eye className="h-5 w-5 text-[#b45309]" />
                    表單預覽
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    {activeForm.fields.map((field) => (
                      <div key={field.name} className="rounded-lg bg-white p-3">
                        <div className="text-xs font-bold text-slate-400">{field.name}</div>
                        <div className="mt-1 text-sm font-semibold text-slate-800">{values[field.name] || "未填寫"}</div>
                      </div>
                    ))}
                    <div className="rounded-lg bg-white p-3 md:col-span-2">
                      <div className="text-xs font-bold text-slate-400">申請原因</div>
                      <div className="mt-1 text-sm font-semibold text-slate-800">{reason || "未填寫"}</div>
                    </div>
                    <div className="rounded-lg bg-white p-3 md:col-span-2">
                      <div className="text-xs font-bold text-slate-400">附件</div>
                      <div className="mt-1 text-sm font-semibold text-slate-800">{attachments.length ? attachments.join("、") : "無附件"}</div>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}

            {errors.amount ? <p className="mt-3 text-sm font-semibold text-rose-600">{errors.amount}</p> : null}
            {complianceIssues.length ? (
              <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-4">
                <div className="text-sm font-black text-amber-900">法規合規檢核</div>
                <div className="mt-3 space-y-3">
                  {complianceIssues.map((issue) => (
                    <div key={issue.code} className="rounded-md bg-white/80 p-3 text-sm">
                      <div className={issue.severity === "blocking" ? "font-bold text-rose-700" : "font-bold text-amber-800"}>
                        {issue.severity === "blocking" ? "阻擋" : "提醒"} · {issue.title}
                      </div>
                      <p className="mt-1 text-slate-700">{issue.message}</p>
                      <p className="mt-1 text-xs font-semibold text-slate-500">{issue.law} · {issue.article}</p>
                      <p className="mt-1 text-xs text-slate-500">{issue.remediation}</p>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            {message ? (
              <OperationFeedback
                className="mt-5"
                title="表單操作回饋"
                message={message}
                status={operationStatus}
                updatedAt={lastOperationAt ?? undefined}
                details={[activeForm.title, activeStep, draftMessage]}
                actionLabel={message.includes("已送出") ? "查看表單追蹤" : undefined}
                actionHref={message.includes("已送出") ? "/requests" : undefined}
              />
            ) : null}

            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="outline" type="button" onClick={clearDraft}>
                <Trash2 className="h-4 w-4" />
                清除草稿
              </Button>
              <Button variant="outline" type="button" onClick={() => window.print()}>
                <Printer className="h-4 w-4" />
                列印
              </Button>
              <Button variant="outline" type="button" onClick={() => handleSubmit(true)} disabled={isSubmitting}>
                <Save className="h-4 w-4" />
                {isSubmitting ? "處理中..." : "儲存草稿"}
              </Button>
              {activeStep !== "預覽送出" ? (
                <Button type="button" onClick={goNextStep}>
                  下一步
                  <ChevronRight className="h-4 w-4" />
                </Button>
              ) : (
              <Button type="button" onClick={() => handleSubmit(false)} disabled={isSubmitting}>
                <Send className="h-4 w-4" />
                {isSubmitting ? "送出中..." : "送出申請"}
              </Button>
              )}
            </div>
          </CardContent>
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader className="suiyue-section-head border-b">
              <CardTitle className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-[#b45309]" />
                簽核流程
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-5">
              <div className="mb-4 rounded-lg bg-[#fffaf4] p-3 text-xs text-slate-600">
                成熟表單會保留每次操作、補件、附件與簽核意見；送出後可在表單追蹤查看完整軌跡。
              </div>
              <div className="mb-4 rounded-lg border border-[#f0c987] bg-[#fffaf4] p-3 text-xs leading-5 text-[#7c3f00]">
                送出時會強制檢核勞基法與性別平等工作法底線；低於法規的申請不得送出，只能儲存草稿。
              </div>
              <FinanceStyleApprovalFlow
                compact
                title="固定串簽流程"
                steps={flow.map((step, index) => ({
                  label: step.step,
                  detail: flowStepDescriptions[step.step] ?? step.ownerLabel,
                  state: index === 0 ? "done" : message.includes("已送出") && index === 1 ? "current" : "pending",
                  badge: index === 0 ? "我" : undefined,
                }))}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="suiyue-section-head border-b">
              <CardTitle className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-[#b45309]" />
                其他表單
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 pt-5">
              {requestFormDefinitions.filter((item) => !item.hiddenFromRequestMenu && item.id !== activeForm.id).map((item) => (
                <Link
                  key={item.id}
                  href={`/requests/new/${item.id}`}
                  className="rounded-lg border border-[#ead8c2] bg-white px-3 py-2 text-sm font-bold text-slate-700 transition hover:border-[#d97706] hover:bg-[#fffaf4]"
                >
                  {item.title}
                </Link>
              ))}
            </CardContent>
          </Card>
        </div>
      </section>
    </div>
  );
}
