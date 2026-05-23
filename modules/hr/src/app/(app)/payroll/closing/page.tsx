"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Banknote,
  CheckCircle2,
  ClipboardCheck,
  Download,
  FileArchive,
  FileSpreadsheet,
  FileText,
  LockKeyhole,
  PencilLine,
  RefreshCw,
  ShieldCheck,
  Upload,
  WalletCards,
} from "lucide-react";
import { OperationFeedback, OperationTimeline } from "@/components/ui/operation-feedback";
import { csv, downloadTextFile } from "@/lib/client/download";
import { can } from "@/lib/auth/rbac";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import {
  formatComplianceMessage,
  validatePayrollClosing,
  type ComplianceIssue,
} from "@/lib/compliance/compliance-engine";
import {
  derivePayrollBatch,
  derivePayrollProcessBlockers,
  createLivePayrollAdjustment,
  generateLivePayrollDrafts,
  loadLivePayrollWorkspace,
  lockLivePayrollBatch,
  moveLivePayrollBatchToReview,
  releaseLivePayslips,
  toPayrollRosterRows,
  type BatchStatus,
  type PayrollAdjustmentRecord,
  type PayrollBatch,
  type PayrollDraft,
  type SourceCheck,
} from "@/lib/payroll/payroll-store";
import {
  canRunPayrollRiskAction,
  evaluatePayrollRiskControls,
  summarizePayrollRiskControls,
  type PayrollRiskAction,
} from "@/lib/payroll/payroll-risk-controls";

type PayrollStepStatus = "完成" | "進行中" | "待處理" | "鎖定";

type PayrollStep = {
  order: number;
  name: string;
  description: string;
  status: PayrollStepStatus;
};

const initialSteps: PayrollStep[] = [
  { order: 1, name: "選擇薪資月份", description: "設定本次結算月份與公司範圍。", status: "完成" },
  { order: 2, name: "匯入或同步出勤資料", description: "同步班表、打卡、請假、加班與補卡。", status: "完成" },
  { order: 3, name: "檢查異常出勤", description: "確認遲到、早退、未打卡、GPS 異常與補卡狀態。", status: "進行中" },
  { order: 4, name: "產生薪資草稿", description: "由出勤轉薪資、薪資項目與員工薪資設定產生草稿。", status: "待處理" },
  { order: 5, name: "人資檢查", description: "人資檢查假勤、津貼、扣款與人事異動。", status: "待處理" },
  { order: 6, name: "會計檢查", description: "會計檢查應發、應扣、勞健保、所得稅與銀行資料。", status: "待處理" },
  { order: 7, name: "主管確認", description: "主管確認薪資總表與異常處理紀錄。", status: "待處理" },
  { order: 8, name: "鎖定薪資", description: "鎖定後不可任意修改，調整需建立調整紀錄。", status: "待處理" },
  { order: 9, name: "發布薪資單", description: "發布電子薪資單並通知員工。", status: "待處理" },
  { order: 10, name: "匯出銀行轉帳檔與薪資清冊", description: "匯出銀行轉帳檔、薪資清冊與會計拋轉資料。", status: "待處理" },
];

const batchStatusStyles: Record<BatchStatus, string> = {
  草稿: "border-slate-200 bg-slate-50 text-slate-600",
  人資檢查: "border-sky-200 bg-sky-50 text-sky-700",
  會計檢查: "border-amber-200 bg-amber-50 text-amber-700",
  主管確認: "border-indigo-200 bg-indigo-50 text-indigo-700",
  已鎖定: "border-violet-200 bg-violet-50 text-violet-700",
  已發布: "border-emerald-200 bg-emerald-50 text-emerald-700",
};

const stepFeedbackStatus: Record<PayrollStepStatus, "idle" | "loading" | "success" | "warning" | "blocked"> = {
  完成: "success",
  進行中: "loading",
  待處理: "idle",
  鎖定: "blocked",
};

function currency(value: number) {
  return new Intl.NumberFormat("zh-TW", { style: "currency", currency: "TWD", maximumFractionDigits: 0 }).format(value);
}

function buildSteps(batch: PayrollBatch, sourceChecks: SourceCheck[], drafts: PayrollDraft[]): PayrollStep[] {
  const sourceReady = sourceChecks.length > 0 && sourceChecks.every((source) => source.ready);
  const hasDrafts = drafts.length > 0;
  const reviewDone = batch.needsReview === 0 && hasDrafts;
  const statusRank: Record<BatchStatus, number> = {
    草稿: 0,
    人資檢查: 1,
    會計檢查: 2,
    主管確認: 3,
    已鎖定: 4,
    已發布: 5,
  };
  const rank = statusRank[batch.status];

  return initialSteps.map((step) => {
    if (step.order === 1) return { ...step, status: "完成" };
    if (step.order === 2) return { ...step, status: sourceReady ? "完成" : "進行中" };
    if (step.order === 3) return { ...step, status: sourceReady ? "完成" : "待處理" };
    if (step.order === 4) return { ...step, status: hasDrafts ? "完成" : "待處理" };
    if (step.order === 5) return { ...step, status: rank >= 1 && reviewDone ? "完成" : rank >= 1 ? "進行中" : "待處理" };
    if (step.order === 6) return { ...step, status: rank >= 2 ? "完成" : "待處理" };
    if (step.order === 7) return { ...step, status: rank >= 3 ? "完成" : "待處理" };
    if (step.order === 8) return { ...step, status: batch.locked ? "鎖定" : "待處理" };
    if (step.order === 9) return { ...step, status: batch.published ? "完成" : batch.locked ? "進行中" : "待處理" };
    if (step.order === 10) return { ...step, status: batch.published ? "完成" : "待處理" };
    return step;
  });
}

export default function PayrollClosingPage() {
  const currentUser = useCurrentUser();
  const [payrollMonth, setPayrollMonth] = useState("2026-05");
  const [steps, setSteps] = useState<PayrollStep[]>(initialSteps);
  const [drafts, setDrafts] = useState<PayrollDraft[]>([]);
  const [sourceChecks, setSourceChecks] = useState<SourceCheck[]>([]);
  const [batch, setBatch] = useState<PayrollBatch>(() => derivePayrollBatch("2026-05", []));
  const [adjustments, setAdjustments] = useState<PayrollAdjustmentRecord[]>([]);
  const [adjustmentReason, setAdjustmentReason] = useState("");
  const [complianceIssues, setComplianceIssues] = useState<ComplianceIssue[]>([]);
  const [complianceMessage, setComplianceMessage] = useState("薪資鎖定、發布與匯出前會強制檢核法規底線。");
  const [isLoading, setIsLoading] = useState(false);
  const [operationMessage, setOperationMessage] = useState("正在讀取 Supabase 薪資結算資料。");
  const [lastOperationAt, setLastOperationAt] = useState<Date | null>(null);

  useEffect(() => {
    void refreshClosingData();
  }, [payrollMonth]);

  async function refreshClosingData() {
    setIsLoading(true);
    try {
      const workspace = await loadLivePayrollWorkspace(payrollMonth);
      setDrafts(workspace.drafts);
      setSourceChecks(workspace.sourceChecks);
      setBatch(workspace.batch);
      setAdjustments(workspace.adjustments);
      setSteps(buildSteps(workspace.batch, workspace.sourceChecks, workspace.drafts));
      setOperationMessage(`${payrollMonth} 已同步 Supabase payroll_records / payroll_payslips / payroll_items / audit_logs。`);
      setLastOperationAt(new Date());
    } catch (error) {
      setOperationMessage(error instanceof Error ? error.message : "讀取 Supabase 薪資結算資料失敗。");
      setLastOperationAt(new Date());
    } finally {
      setIsLoading(false);
    }
  }

  const monthDrafts = useMemo(
    () => drafts.filter((draft) => draft.month === payrollMonth),
    [drafts, payrollMonth],
  );

  const rosterRows = useMemo(() => toPayrollRosterRows(monthDrafts), [monthDrafts]);
  const sourceBlockers = sourceChecks.filter((source) => !source.ready).length;
  const processBlockers = useMemo(
    () => derivePayrollProcessBlockers(sourceChecks, monthDrafts),
    [monthDrafts, sourceChecks],
  );
  const canGenerateDraft = can(currentUser.role, "payroll:draft:generate");
  const canLockPayroll = can(currentUser.role, "payroll:lock");
  const canPublishPayslips = can(currentUser.role, "payroll:payslip:publish");
  const canExportBankFile = can(currentUser.role, "payroll:bank_export");
  const canExportPayrollRoster = can(currentUser.role, "payroll:roster_export");
  const canCreateAdjustment = can(currentUser.role, "payroll:adjust");
  const payrollRiskControls = useMemo(
    () => evaluatePayrollRiskControls({
      sourceChecks,
      drafts: monthDrafts,
      batch,
      adjustmentReason,
      permissions: {
        canGenerateDraft,
        canLockPayroll,
        canPublishPayslips,
        canExportBankFile,
        canExportPayrollRoster,
        canCreateAdjustment,
      },
    }),
    [
      adjustmentReason,
      batch,
      canCreateAdjustment,
      canExportBankFile,
      canExportPayrollRoster,
      canGenerateDraft,
      canLockPayroll,
      canPublishPayslips,
      monthDrafts,
      sourceChecks,
    ],
  );
  const payrollRiskSummary = useMemo(() => summarizePayrollRiskControls(payrollRiskControls), [payrollRiskControls]);
  const failedPayrollRiskControls = payrollRiskControls.filter((control) => !control.passed);

  function blockPayrollAction(action: PayrollRiskAction) {
    if (canRunPayrollRiskAction(action, payrollRiskControls)) return false;
    const failed = payrollRiskControls.filter((control) => control.action === action && !control.passed && control.severity === "blocking");
    setComplianceMessage(`薪資高風險控管阻擋：${failed.map((control) => control.title).join("、")}`);
    setLastOperationAt(new Date());
    return true;
  }

  const progress = useMemo(
    () => Math.round((steps.filter((step) => step.status === "完成" || step.status === "鎖定").length / steps.length) * 100),
    [steps],
  );

  const runPayrollCompliance = (nextBatch: PayrollBatch = batch, release = false) => {
    const compliance = validatePayrollClosing({
      employees: nextBatch.employees,
      needsReview: nextBatch.needsReview,
      locked: nextBatch.locked,
      published: release ? true : nextBatch.published,
      rosterRows,
    });
    setComplianceIssues(compliance.issues);
    setComplianceMessage(formatComplianceMessage(compliance));
    setLastOperationAt(new Date());
    return compliance;
  };

  async function advanceStep() {
    if (batch.status === "主管確認") {
      const compliance = runPayrollCompliance({ ...batch, locked: true, status: "已鎖定" });
      if (compliance.blocked) return;
      await lockPayroll();
      return;
    }
    if (batch.status === "已鎖定") {
      await publishPayslips();
      return;
    }

    setSteps((current) => {
      const nextIndex = current.findIndex((step) => step.status === "進行中" || step.status === "待處理");
      if (nextIndex === -1) return current;
      return current.map((step, index) => {
        if (index < nextIndex) return step;
        if (index === nextIndex) return { ...step, status: step.name === "鎖定薪資" ? "鎖定" : "完成" };
        if (index === nextIndex + 1) return { ...step, status: "進行中" };
        return step;
      });
    });

    setBatch((current) => {
      if (current.status === "人資檢查") return { ...current, status: "會計檢查" };
      if (current.status === "會計檢查") return { ...current, status: "主管確認" };
      return current;
    });
    setOperationMessage("流程已推進。會計檢查與主管確認會留在前端流程狀態，鎖定/發布時才寫回 Supabase。");
    setLastOperationAt(new Date());
  }

  const syncAttendance = () => {
    if (processBlockers.some((blocker) => blocker.stage === "attendance" || blocker.stage === "punch_correction")) {
      setOperationMessage("出勤或補卡仍有阻擋事項，不能標記為已同步完成。請先處理補卡、異常出勤或打卡來源。");
      setLastOperationAt(new Date());
      return;
    }
    setSteps((current) =>
      current.map((step) =>
        step.name === "匯入或同步出勤資料" || step.name === "檢查異常出勤" ? { ...step, status: "完成" } : step,
      ),
    );
    setOperationMessage(sourceBlockers > 0 ? `仍有 ${sourceBlockers} 個來源檢核未通過，請先回出勤轉薪資處理。` : "來源檢核已通過，可進入薪資草稿檢查。");
    setLastOperationAt(new Date());
  };

  async function createDraft() {
    if (!canGenerateDraft) {
      setOperationMessage("此帳號沒有「產生薪資草稿」權限。");
      setLastOperationAt(new Date());
      return;
    }
    if (blockPayrollAction("generate_draft")) return;
    const hardBlockers = processBlockers.filter((blocker) => (
      blocker.stage === "attendance" ||
      blocker.stage === "punch_correction" ||
      (blocker.stage === "payroll" && blocker.id !== "source-薪資單草稿")
    ));
    if (hardBlockers.length) {
      setOperationMessage("出勤資料尚未可結薪：補卡與出勤異常需先結案，才能產生薪資草稿。");
      setLastOperationAt(new Date());
      return;
    }
    setSteps((current) =>
      current.map((step) => (step.name === "產生薪資草稿" ? { ...step, status: "完成" } : step)),
    );
    try {
      if (!monthDrafts.length) {
        const generated = await generateLivePayrollDrafts(payrollMonth);
        setOperationMessage(`已由 employee_payroll_settings 產生薪資草稿：${generated.employees} 位員工、${generated.items} 筆薪資項目。`);
      }
      await moveLivePayrollBatchToReview(payrollMonth);
      await refreshClosingData();
      setOperationMessage("已產生/同步薪資草稿，並將 payroll_records 推進為 reviewing。");
      setLastOperationAt(new Date());
    } catch (error) {
      setOperationMessage(error instanceof Error ? error.message : "薪資草稿狀態寫回 Supabase 失敗。");
      setLastOperationAt(new Date());
    }
  }

  async function lockPayroll() {
    if (!canLockPayroll) {
      setComplianceMessage("此帳號沒有「鎖定薪資」權限。");
      return;
    }
    if (blockPayrollAction("lock_payroll")) return;
    const compliance = runPayrollCompliance({ ...batch, locked: true, status: "已鎖定" });
    if (compliance.blocked) return;
    if (sourceBlockers > 0) {
      setComplianceMessage(`仍有 ${sourceBlockers} 個薪資來源未通過檢核，不可鎖定薪資。`);
      return;
    }
    if (processBlockers.length > 0) {
      setComplianceMessage(`仍有 ${processBlockers.length} 個出勤、補卡或薪資阻擋關係未排除，不可鎖定薪資。`);
      return;
    }

    try {
      await lockLivePayrollBatch(payrollMonth);
      await refreshClosingData();
      setOperationMessage("已鎖定薪資並寫回 Supabase payroll_records.status = approved。");
      setLastOperationAt(new Date());
    } catch (error) {
      setOperationMessage(error instanceof Error ? error.message : "鎖定薪資寫回 Supabase 失敗。");
      setLastOperationAt(new Date());
    }
  }

  async function publishPayslips() {
    if (!canPublishPayslips) {
      setComplianceMessage("此帳號沒有「發布薪資袋」權限。");
      return;
    }
    if (blockPayrollAction("publish_payslips")) return;
    if (!batch.locked) return;
    const compliance = runPayrollCompliance(batch, true);
    if (compliance.blocked) return;

    try {
      await releaseLivePayslips(payrollMonth);
      await refreshClosingData();
      setOperationMessage("已發布電子薪資單並寫回 Supabase payroll_payslips.status = released。");
      setLastOperationAt(new Date());
    } catch (error) {
      setOperationMessage(error instanceof Error ? error.message : "發布薪資單寫回 Supabase 失敗。");
      setLastOperationAt(new Date());
    }
  }

  async function createAdjustment() {
    if (!batch.locked || !adjustmentReason.trim() || !canCreateAdjustment) return;
    if (blockPayrollAction("create_adjustment")) return;
    try {
      await createLivePayrollAdjustment({
        payrollMonth,
        employee: monthDrafts[0]?.employeeName ?? "未指定員工",
        item: "鎖定後薪資調整",
        amount: 0,
        reason: adjustmentReason.trim(),
      });
      setAdjustmentReason("");
      await refreshClosingData();
      setOperationMessage("調整紀錄已寫入 Supabase audit_logs，不覆蓋原薪資資料。");
      setLastOperationAt(new Date());
    } catch (error) {
      setOperationMessage(error instanceof Error ? error.message : "建立調整紀錄失敗。");
      setLastOperationAt(new Date());
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-medium text-indigo-700">Payroll Closing Workflow</p>
          <h1 className="text-2xl font-semibold text-slate-950">薪資結算流程</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-500">
            從選擇薪資月份、同步出勤、檢查異常、產生薪資草稿，到人資、會計、主管確認、鎖定、發布薪資單與匯出銀行轉帳檔。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="month"
            value={payrollMonth}
            onChange={(event) => setPayrollMonth(event.target.value)}
            disabled={batch.locked}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm disabled:bg-slate-100"
          />
          <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${batchStatusStyles[batch.status]}`}>
            {batch.status}
          </span>
          <button
            onClick={() => void refreshClosingData()}
            disabled={isLoading}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
            重新同步
          </button>
        </div>
      </div>

      <OperationFeedback
        title="薪資結算操作回饋"
        message={operationMessage}
        status={isLoading ? "loading" : complianceIssues.some((issue) => issue.severity === "blocking") || processBlockers.length ? "blocked" : undefined}
        updatedAt={lastOperationAt ?? undefined}
        details={[payrollMonth, batch.status, `${progress}% 完成`]}
        actionLabel={sourceBlockers > 0 ? "回出勤轉薪資" : "查看薪資清冊"}
        actionHref={sourceBlockers > 0 ? "/payroll/attendance-calculation" : "/payroll/roster"}
      />

      <section className="rounded-lg border border-rose-200 bg-rose-50 p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-rose-950">結薪前阻擋關係</h2>
            <p className="mt-1 text-sm text-rose-800">
              規則固定為：出勤異常先處理，補卡通過後回寫出勤，出勤來源清空後才可產生草稿、鎖定與發布薪資。
            </p>
          </div>
          <span className="w-fit rounded-full bg-white px-3 py-1 text-xs font-black text-rose-700">
            {processBlockers.length ? `${processBlockers.length} 個阻擋` : "可進入結薪"}
          </span>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          {[
            ["出勤", processBlockers.filter((blocker) => blocker.stage === "attendance").length, "班表、打卡與異常審核"],
            ["補卡", processBlockers.filter((blocker) => blocker.stage === "punch_correction").length, "補卡簽核與回寫"],
            ["薪資", processBlockers.filter((blocker) => blocker.stage === "payroll").length, "草稿、項目與覆核"],
          ].map(([label, value, detail]) => (
            <div key={label} className="rounded-lg bg-white p-4">
              <div className="text-sm font-semibold text-slate-500">{label}</div>
              <div className="mt-2 text-2xl font-black text-slate-950">{value}</div>
              <div className="mt-1 text-xs text-slate-500">{detail}</div>
            </div>
          ))}
        </div>
        {processBlockers.length ? (
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {processBlockers.map((blocker) => (
              <a key={blocker.id} href={blocker.href} className="rounded-lg bg-white p-4 text-sm shadow-sm transition hover:bg-rose-100">
                <div className="flex items-center justify-between gap-3">
                  <div className="font-bold text-rose-900">{blocker.title}</div>
                  <span className="rounded-full bg-rose-50 px-2 py-1 text-xs font-bold text-rose-700">{blocker.count}</span>
                </div>
                <p className="mt-2 text-slate-700">{blocker.description}</p>
                <p className="mt-2 text-xs font-semibold text-rose-700">{blocker.blocks}</p>
                <p className="mt-3 text-xs font-black text-slate-950">{blocker.actionLabel} →</p>
              </a>
            ))}
          </div>
        ) : null}
      </section>

      <section className="rounded-lg border border-[#ead8c2] bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-sm font-bold tracking-[0.12em] text-[#b45309]">PAYROLL RISK GATE</p>
            <h2 className="mt-1 text-xl font-black text-slate-950">薪資最高風險壓力測試</h2>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-500">
              薪資作業要同時通過來源資料、流程阻擋、草稿覆核、金額公式、銀行資料、鎖定狀態、發布狀態與角色權限。未通過時，系統會阻擋產生草稿、鎖定、發布、匯出與調整紀錄。
            </p>
          </div>
          <span className={`w-fit rounded-lg border px-4 py-3 text-sm font-black ${
            payrollRiskSummary.blockingFailed
              ? "border-rose-200 bg-rose-50 text-rose-700"
              : "border-emerald-200 bg-emerald-50 text-emerald-700"
          }`}>
            {payrollRiskSummary.blockingFailed ? "需排除" : "已通過"} · {payrollRiskSummary.passed}/{payrollRiskSummary.total}
          </span>
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-4">
          {[
            ["測試項目", payrollRiskSummary.total, "角色、來源、金額、鎖定、匯出"],
            ["已通過", payrollRiskSummary.passed, "可繼續操作"],
            ["阻擋失敗", payrollRiskSummary.blockingFailed, "上線前必須排除"],
            ["警示失敗", payrollRiskSummary.warningFailed, "需人工複核"],
          ].map(([label, value, detail]) => (
            <div key={label} className="rounded-lg border border-[#ead8c2] bg-[#fffaf4] p-4">
              <p className="text-sm font-bold text-slate-500">{label}</p>
              <p className="mt-2 text-2xl font-black text-slate-950">{value}</p>
              <p className="mt-1 text-xs text-slate-500">{detail}</p>
            </div>
          ))}
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {failedPayrollRiskControls.slice(0, 9).map((control) => (
            <div key={control.id} className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="font-black text-rose-900">{control.title}</div>
                <span className="rounded-full bg-white px-2.5 py-1 text-xs font-black text-rose-700">阻擋</span>
              </div>
              <p className="mt-2 text-rose-800">{control.description}</p>
              <p className="mt-2 text-xs font-semibold text-slate-600">證據：{control.evidence}</p>
              <p className="mt-1 text-xs font-semibold text-rose-700">處理：{control.remediation}</p>
            </div>
          ))}
          {!failedPayrollRiskControls.length ? (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-800 md:col-span-2 xl:col-span-3">
              薪資高風險壓力測試全部通過，可以依流程進入下一步。
            </div>
          ) : null}
        </div>
      </section>

	      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
	        {[
	          { label: "結算員工", value: `${batch.employees} 人`, icon: ClipboardCheck, tone: "bg-indigo-50 text-indigo-700" },
	          { label: "應發總額", value: currency(batch.grossPay), icon: WalletCards, tone: "bg-emerald-50 text-emerald-700" },
	          { label: "扣款總額", value: currency(batch.deductions), icon: ReceiptIcon, tone: "bg-rose-50 text-rose-700" },
	          { label: "實發總額", value: currency(batch.netPay), icon: Banknote, tone: "bg-sky-50 text-sky-700" },
	          { label: "需檢查", value: `${batch.needsReview} 筆`, icon: AlertTriangle, tone: "bg-amber-50 text-amber-700" },
	        ].map((item) => (
          <div key={item.label} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-slate-500">{item.label}</p>
              <span className={`rounded-lg p-2 ${item.tone}`}>
                <item.icon className="h-5 w-5" />
              </span>
            </div>
            <p className="mt-3 text-2xl font-semibold text-slate-950">{item.value}</p>
          </div>
        ))}
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div>
	              <h2 className="text-lg font-semibold text-slate-950">10 步驟結算流程</h2>
	              <p className="text-sm text-slate-500">每一步都可留存操作紀錄，薪資鎖定後不可直接修改。完成度 {progress}%</p>
            </div>
            <FileArchive className="h-5 w-5 text-indigo-600" />
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <OperationTimeline
              steps={steps.map((step) => ({
                label: `${step.order}. ${step.name}`,
                detail: `${step.description}（${step.status}）`,
                status: stepFeedbackStatus[step.status],
              }))}
            />
          </div>
        </div>

        <div className="space-y-5">
          <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-950">流程操作</h2>
            <div className="mt-3 rounded-lg border border-indigo-100 bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-800">
              {complianceMessage}
            </div>
            <div className="mt-4 grid gap-2">
              <button onClick={syncAttendance} className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                <Upload className="h-4 w-4" />
                匯入或同步出勤資料
              </button>
              <button onClick={() => void createDraft()} disabled={!canGenerateDraft || !canRunPayrollRiskAction("generate_draft", payrollRiskControls)} className="inline-flex items-center justify-center gap-2 rounded-lg border border-indigo-200 px-4 py-2 text-sm font-semibold text-indigo-700 hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-40">
                <RefreshCw className="h-4 w-4" />
                產生薪資草稿
              </button>
              <button onClick={() => void advanceStep()} className="inline-flex items-center justify-center gap-2 rounded-lg border border-emerald-200 px-4 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-50">
                <CheckCircle2 className="h-4 w-4" />
                推進下一關
              </button>
              <button onClick={() => void lockPayroll()} disabled={batch.locked || !canLockPayroll || !canRunPayrollRiskAction("lock_payroll", payrollRiskControls)} className="inline-flex items-center justify-center gap-2 rounded-lg border border-violet-200 px-4 py-2 text-sm font-semibold text-violet-700 hover:bg-violet-50 disabled:cursor-not-allowed disabled:opacity-40">
                <LockKeyhole className="h-4 w-4" />
                鎖定薪資
              </button>
              <button onClick={() => void publishPayslips()} disabled={!batch.locked || batch.published || !canPublishPayslips || !canRunPayrollRiskAction("publish_payslips", payrollRiskControls)} className="inline-flex items-center justify-center gap-2 rounded-lg border border-sky-200 px-4 py-2 text-sm font-semibold text-sky-700 hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-40">
                <FileText className="h-4 w-4" />
                發布薪資單
              </button>
            </div>
          </div>

          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-5">
            <div className="mb-3 flex items-center gap-2">
              <Download className="h-5 w-5 text-emerald-700" />
              <h2 className="font-semibold text-emerald-900">匯出銀行轉帳檔與薪資清冊</h2>
            </div>
            <div className="grid gap-2">
              <button
                type="button"
                onClick={() => {
                  if (blockPayrollAction("export_bank_file")) return;
                  const compliance = runPayrollCompliance(batch);
                  if (compliance.blocked) return;
                  downloadTextFile(
                    `bank-transfer-${batch.month}.csv`,
	                    csv([
	                      ["公司", "月份", "銀行代碼", "銀行帳號", "員工", "轉帳金額"],
	                      ...rosterRows.map((row) => [batch.company, batch.month, row.bankCode, row.bankAccount, row.name, row.netPay]),
	                    ]),
                  );
                }}
                disabled={!batch.locked || !canExportBankFile || !canRunPayrollRiskAction("export_bank_file", payrollRiskControls)}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Banknote className="h-4 w-4" />
                匯出銀行轉帳檔
              </button>
              <button
                type="button"
                onClick={() => {
                  if (blockPayrollAction("export_roster")) return;
                  const compliance = runPayrollCompliance(batch);
                  if (compliance.blocked) return;
                  downloadTextFile(
                    `payroll-roster-${batch.month}.csv`,
	                    csv([
	                      ["月份", "員工編號", "姓名", "部門", "據點", "本薪", "津貼", "加班費", "獎金", "應發總額", "扣款總額", "實發總額", "狀態"],
	                      ...rosterRows.map((row) => [
	                        batch.month,
	                        row.employeeNo,
	                        row.name,
	                        row.department,
	                        row.branch,
	                        row.baseSalary,
	                        row.allowances,
	                        row.overtimePay,
	                        row.bonus,
	                        row.grossPay,
	                        row.laborInsuranceDeduction + row.healthInsuranceDeduction + row.incomeTax + row.otherDeductions,
	                        row.netPay,
	                        row.status,
	                      ]),
	                    ]),
                  );
                }}
                disabled={!batch.locked || !canExportPayrollRoster || !canRunPayrollRiskAction("export_roster", payrollRiskControls)}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <FileSpreadsheet className="h-4 w-4" />
                匯出薪資清冊
              </button>
            </div>
          </div>

          <div className="rounded-lg border border-amber-200 bg-amber-50 p-5">
            <div className="mb-3 flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-700" />
              <h2 className="font-semibold text-amber-900">鎖定後限制</h2>
            </div>
            <p className="text-sm text-amber-800">薪資鎖定後不可任意修改，若需修改需建立調整紀錄，保留原因、建立人與時間。</p>
          </div>
        </div>
      </section>

      {complianceIssues.length ? (
        <section className="rounded-lg border border-amber-200 bg-amber-50 p-5">
          <div className="mb-4 flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-amber-800" />
            <h2 className="text-lg font-semibold text-amber-950">薪資法規合規檢核</h2>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {complianceIssues.map((issue) => (
              <div key={issue.code} className="rounded-lg bg-white p-4 text-sm shadow-sm">
                <div className={issue.severity === "blocking" ? "font-bold text-rose-700" : "font-bold text-amber-800"}>
                  {issue.severity === "blocking" ? "阻擋" : "提醒"} · {issue.title}
                </div>
                <p className="mt-2 text-slate-700">{issue.message}</p>
                <p className="mt-2 text-xs font-semibold text-slate-500">{issue.law} · {issue.article}</p>
                <p className="mt-1 text-xs text-slate-500">{issue.remediation}</p>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="grid gap-5 xl:grid-cols-[0.8fr_1.2fr]">
        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <PencilLine className="h-5 w-5 text-amber-700" />
            <h2 className="text-lg font-semibold text-slate-950">建立調整紀錄</h2>
          </div>
          <p className="text-sm text-slate-500">此區只有薪資鎖定後可建立，用於補發、沖回或扣款調整。</p>
          <textarea
            value={adjustmentReason}
            onChange={(event) => setAdjustmentReason(event.target.value)}
            placeholder="輸入調整原因，例如：補卡核准後沖回遲到扣款"
            rows={4}
            className="mt-4 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />
          <button
            onClick={() => void createAdjustment()}
            disabled={!batch.locked || !canRunPayrollRiskAction("create_adjustment", payrollRiskControls)}
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <PencilLine className="h-4 w-4" />
            建立調整紀錄
          </button>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 p-5">
            <h2 className="text-lg font-semibold text-slate-950">調整紀錄</h2>
            <p className="text-sm text-slate-500">調整紀錄不覆蓋原薪資，會以補發、沖回或扣款項目進入下一次薪資處理。</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">員工</th>
                  <th className="px-4 py-3">項目</th>
                  <th className="px-4 py-3">金額</th>
                  <th className="px-4 py-3">原因</th>
                  <th className="px-4 py-3">建立人</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {adjustments.map((record) => (
                  <tr key={record.id} className="hover:bg-slate-50">
                    <td className="px-4 py-4 font-semibold text-slate-950">{record.employee}</td>
                    <td className="px-4 py-4 text-slate-700">{record.item}</td>
                    <td className="px-4 py-4 font-semibold text-slate-800">{currency(record.amount)}</td>
                    <td className="px-4 py-4 text-slate-600">{record.reason}</td>
                    <td className="px-4 py-4 text-slate-500">{record.createdBy} · {record.createdAt}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 h-5 w-5 text-slate-700" />
          <div>
            <h2 className="font-semibold text-slate-950">薪資鎖定控管</h2>
            <p className="mt-1 text-sm text-slate-500">
              薪資鎖定後，原始薪資草稿、出勤來源、檢查紀錄與匯出紀錄都應不可覆蓋；任何差異需透過調整紀錄追蹤，避免薪資稽核斷點。
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}

function ReceiptIcon({ className }: { className?: string }) {
  return <FileSpreadsheet className={className} />;
}
