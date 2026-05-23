"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  BadgeDollarSign,
  Calculator,
  CheckCircle2,
  FileText,
  ListChecks,
  LockKeyhole,
  ReceiptText,
  RefreshCw,
  WalletCards,
} from "lucide-react";
import {
  loadLivePayrollDrafts,
  loadLivePayrollSourceChecks,
  recalculatePayrollDraft,
  updateLivePayslipStatus,
  derivePayrollProcessBlockers,
  type SourceCheck,
  type DraftStatus,
  type PayrollDraft,
} from "@/lib/payroll/payroll-store";

const statusStyles: Record<DraftStatus, string> = {
  待產生: "border-slate-200 bg-slate-50 text-slate-600",
  草稿: "border-emerald-200 bg-emerald-50 text-emerald-700",
  需檢查: "border-amber-200 bg-amber-50 text-amber-700",
  已鎖定: "border-sky-200 bg-sky-50 text-sky-700",
};

function currency(value: number) {
  return new Intl.NumberFormat("zh-TW", { style: "currency", currency: "TWD", maximumFractionDigits: 0 }).format(value);
}

function blockerStageTone(count: number) {
  return count > 0 ? "border-rose-200 bg-rose-50 text-rose-800" : "border-emerald-200 bg-emerald-50 text-emerald-800";
}

export default function AttendancePayrollCalculationPage() {
  const [payrollMonth, setPayrollMonth] = useState("2026-05");
  const [drafts, setDrafts] = useState<PayrollDraft[]>([]);
  const [sourceChecks, setSourceChecks] = useState<SourceCheck[]>([]);
  const [message, setMessage] = useState("正在讀取 Supabase 薪資與出勤來源。");
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    void refreshPayrollData();
  }, [payrollMonth]);

  async function refreshPayrollData() {
    setIsLoading(true);
    try {
      const [nextDrafts, nextSourceChecks] = await Promise.all([
        loadLivePayrollDrafts(payrollMonth),
        loadLivePayrollSourceChecks(payrollMonth),
      ]);
      setDrafts(nextDrafts);
      setSourceChecks(nextSourceChecks);
      setMessage(`${payrollMonth} 已同步 Supabase payroll_payslips、payroll_items 與假勤來源資料。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "讀取 Supabase 薪資來源失敗。");
    } finally {
      setIsLoading(false);
    }
  }

  const monthDrafts = useMemo(
    () => drafts.filter((draft) => draft.month === payrollMonth),
    [drafts, payrollMonth],
  );

  const stats = useMemo(
    () => ({
      employees: monthDrafts.length,
      grossPay: monthDrafts.reduce((sum, draft) => sum + draft.grossPay, 0),
      deductions: monthDrafts.reduce((sum, draft) => sum + draft.deductionTotal, 0),
      netPay: monthDrafts.reduce((sum, draft) => sum + draft.netPay, 0),
      needsReview: monthDrafts.filter((draft) => draft.status === "需檢查").length,
    }),
    [monthDrafts],
  );
  const processBlockers = useMemo(
    () => derivePayrollProcessBlockers(sourceChecks, monthDrafts),
    [monthDrafts, sourceChecks],
  );
  const stageCounts = useMemo(
    () => ({
      attendance: processBlockers.filter((blocker) => blocker.stage === "attendance").length,
      punchCorrection: processBlockers.filter((blocker) => blocker.stage === "punch_correction").length,
      payroll: processBlockers.filter((blocker) => blocker.stage === "payroll").length,
    }),
    [processBlockers],
  );
  const visualStages = useMemo(
    () => [
      {
        key: "attendance",
        title: "1. 出勤來源",
        detail: "班表、打卡、請假、加班、異常",
        blockers: stageCounts.attendance,
        icon: ListChecks,
        href: "/attendance/anomalies",
      },
      {
        key: "punch",
        title: "2. 補卡回寫",
        detail: "補卡簽核完成並回寫出勤",
        blockers: stageCounts.punchCorrection,
        icon: FileText,
        href: "/punch-corrections",
      },
      {
        key: "draft",
        title: "3. 薪資草稿",
        detail: "產生草稿並完成複核",
        blockers: stageCounts.payroll,
        icon: Calculator,
        href: "/payroll/attendance-calculation",
      },
      {
        key: "lock",
        title: "4. 鎖定發布",
        detail: "薪資鎖定後發布薪資袋",
        blockers: processBlockers.length,
        icon: LockKeyhole,
        href: "/payroll/closing",
      },
    ],
    [processBlockers.length, stageCounts.attendance, stageCounts.payroll, stageCounts.punchCorrection],
  );
  const topBlockers = processBlockers.slice(0, 3);

  const runCalculation = () => {
    if (processBlockers.length) {
      setMessage(`仍有 ${processBlockers.length} 個阻擋關係未排除，請先處理出勤、補卡或薪資前置資料。`);
      return;
    }
    if (!drafts.length) {
      setMessage(`${payrollMonth} 尚未有 payroll_payslips 正式薪資單資料，請先在薪資結算建立薪資草稿。`);
      return;
    }
    setDrafts((current) => {
      const nextDrafts = current.map((draft) =>
        draft.month === payrollMonth ? recalculatePayrollDraft({ ...draft, month: payrollMonth }) : draft,
      );
      return nextDrafts;
    });
    setMessage(`${payrollMonth} 已依 Supabase 薪資項目重新整理畫面草稿；正式寫入需由薪資結算流程鎖定。`);
  };

  async function markReviewed(id: string) {
    const target = drafts.find((draft) => draft.id === id);
    try {
      await updateLivePayslipStatus(id, "draft");
      setDrafts((current) => current.map((draft) => (draft.id === id ? { ...draft, status: "草稿" as const, warnings: [] } : draft)));
      if (target) setMessage(`${target.employeeName} 已標記為檢查完成，已寫回 Supabase payroll_payslips.status = draft。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "薪資單狀態寫回 Supabase 失敗。");
    }
  }

  async function sendToReview(id: string) {
    const target = drafts.find((draft) => draft.id === id);
    try {
      await updateLivePayslipStatus(id, "reviewing");
      setDrafts((current) => current.map((draft) => (draft.id === id ? { ...draft, status: "需檢查" as const, warnings: ["已送人資複核，需於薪資結算流程鎖定後才可發布。"] } : draft)));
      if (target) setMessage(`${target.employeeName} 的薪資草稿已送人資複核，已寫回 Supabase payroll_payslips.status = reviewing。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "薪資單複核狀態寫回 Supabase 失敗。");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-medium text-indigo-700">Payroll Calculation</p>
          <h1 className="text-2xl font-semibold text-slate-950">出勤轉薪資計算</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-500">
            根據班表、實際打卡、請假紀錄、加班紀錄、補卡紀錄、異常出勤、津貼設定與扣款設定，自動產生每位員工當月薪資草稿。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="month"
            value={payrollMonth}
            onChange={(event) => setPayrollMonth(event.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
          />
          <button
            onClick={runCalculation}
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
          >
            <Calculator className="h-4 w-4" />
            產生薪資草稿
          </button>
          <button
            onClick={() => void refreshPayrollData()}
            disabled={isLoading}
            className="inline-flex items-center gap-2 rounded-lg border border-indigo-200 px-4 py-2 text-sm font-semibold text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
            同步資料
          </button>
        </div>
      </div>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        {[
          { label: "員工草稿", value: `${stats.employees} 筆`, icon: ListChecks, tone: "bg-indigo-50 text-indigo-700" },
          { label: "應發總額", value: currency(stats.grossPay), icon: BadgeDollarSign, tone: "bg-emerald-50 text-emerald-700" },
          { label: "扣款總額", value: currency(stats.deductions), icon: ReceiptText, tone: "bg-rose-50 text-rose-700" },
          { label: "實發總額", value: currency(stats.netPay), icon: WalletCards, tone: "bg-sky-50 text-sky-700" },
          { label: "需檢查", value: `${stats.needsReview} 筆`, icon: AlertTriangle, tone: "bg-amber-50 text-amber-700" },
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

      <div className="rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm font-semibold text-indigo-800">
        {message}
      </div>

      <section className="rounded-lg border border-rose-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">出勤 → 補卡 → 薪資阻擋關係</h2>
            <p className="mt-1 text-sm text-slate-500">
              出勤來源未完整會先要求補卡或異常審核；補卡未回寫就不能確認出勤；出勤未確認就不能產生、鎖定或發布薪資。
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs font-semibold">
            <span className="rounded-full bg-rose-50 px-3 py-1 text-rose-700">出勤阻擋 {stageCounts.attendance}</span>
            <span className="rounded-full bg-amber-50 px-3 py-1 text-amber-700">補卡阻擋 {stageCounts.punchCorrection}</span>
            <span className="rounded-full bg-indigo-50 px-3 py-1 text-indigo-700">薪資阻擋 {stageCounts.payroll}</span>
          </div>
        </div>

        <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-4">
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="font-black text-slate-950">薪資阻擋管線</h3>
              <p className="mt-1 text-sm text-slate-500">紅色代表該階段仍卡住；全部轉綠後才可進入鎖定與發布。</p>
            </div>
            <span className={`w-fit rounded-full border px-3 py-1 text-xs font-black ${processBlockers.length ? "border-rose-200 bg-rose-50 text-rose-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>
              {processBlockers.length ? `仍有 ${processBlockers.length} 個阻擋` : "可往下結薪"}
            </span>
          </div>
          <div className="grid gap-3 lg:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr] lg:items-stretch">
            {visualStages.map((stage, index) => {
              const StageIcon = stage.icon;
              const blocked = stage.blockers > 0;

              return (
                <div key={stage.key} className="contents">
                  <a href={stage.href} className={`block rounded-lg border p-4 transition hover:shadow-sm ${blockerStageTone(stage.blockers)}`}>
                    <div className="flex items-start justify-between gap-3">
                      <span className="rounded-lg bg-white/70 p-2">
                        <StageIcon className="h-5 w-5" />
                      </span>
                      <span className="rounded-full bg-white/70 px-2.5 py-1 text-xs font-black">
                        {blocked ? `${stage.blockers} 阻擋` : "通過"}
                      </span>
                    </div>
                    <div className="mt-3 font-black">{stage.title}</div>
                    <p className="mt-1 text-xs leading-5 opacity-80">{stage.detail}</p>
                  </a>
                  {index < visualStages.length - 1 ? (
                    <div className="hidden items-center justify-center text-slate-300 lg:flex">
                      <ArrowRight className="h-5 w-5" />
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>

        {topBlockers.length ? (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4">
            <div className="mb-3 font-black text-amber-950">建議處理順序</div>
            <div className="grid gap-2 md:grid-cols-3">
              {topBlockers.map((blocker, index) => (
                <a key={blocker.id} href={blocker.href} className="rounded-lg bg-white p-3 text-sm transition hover:bg-amber-100">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-black text-slate-950">{index + 1}. {blocker.title}</span>
                    <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-bold text-amber-700">{blocker.count}</span>
                  </div>
                  <p className="mt-2 text-xs leading-5 text-slate-600">{blocker.blocks}</p>
                  <p className="mt-2 text-xs font-black text-[#8a4b06]">{blocker.actionLabel} →</p>
                </a>
              ))}
            </div>
          </div>
        ) : null}

        <div className="mt-4 grid gap-3 lg:grid-cols-3">
          {[
            ["1", "出勤來源", "班表、實際打卡、請假、加班與異常判斷必須完成。"],
            ["2", "補卡回寫", "未打卡、時間修正與附件佐證需簽核通過並回寫。"],
            ["3", "薪資結算", "來源清乾淨後才允許產生草稿、鎖定薪資與發布薪資單。"],
          ].map(([order, title, detail]) => (
            <div key={order} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center gap-3">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-950 text-sm font-black text-white">{order}</span>
                <div className="font-semibold text-slate-950">{title}</div>
              </div>
              <p className="mt-3 text-sm text-slate-600">{detail}</p>
            </div>
          ))}
        </div>

        {processBlockers.length ? (
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {processBlockers.map((blocker) => (
              <a
                key={blocker.id}
                href={blocker.href}
                className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm transition hover:bg-rose-100"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="font-bold text-rose-900">{blocker.title}</div>
                  <span className="rounded-full bg-white px-2 py-1 text-xs font-bold text-rose-700">{blocker.count}</span>
                </div>
                <p className="mt-2 text-rose-800">{blocker.description}</p>
                <p className="mt-2 text-xs font-semibold text-rose-700">{blocker.blocks}</p>
                <p className="mt-3 text-xs font-black text-rose-900">{blocker.actionLabel} →</p>
              </a>
            ))}
          </div>
        ) : (
          <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-800">
            出勤、補卡與薪資來源檢核已通過，可進入薪資草稿產生與後續結算。
          </div>
        )}
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">資料來源檢核</h2>
            <p className="text-sm text-slate-500">薪資草稿產生前，需確認八大來源資料是否同步完成。</p>
          </div>
          <RefreshCw className="h-5 w-5 text-indigo-600" />
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {sourceChecks.map((source) => {
            const Icon = source.icon;
            return (
              <div key={source.name} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-start justify-between gap-3">
                  <span className="rounded-lg bg-white p-2 text-indigo-700">
                    <Icon className="h-5 w-5" />
                  </span>
                  <span className={`rounded-full px-2 py-1 text-xs font-semibold ${source.ready ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
                    {source.ready ? "已同步" : "需檢查"}
                  </span>
                </div>
                <p className="mt-3 font-semibold text-slate-950">{source.name}</p>
                <p className="mt-1 text-sm text-slate-500">{source.description}</p>
                <p className="mt-3 text-xs font-medium text-slate-600">{source.records} 筆資料</p>
              </div>
            );
          })}
          {!sourceChecks.length ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
              尚未讀到來源檢核資料。
            </div>
          ) : null}
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 p-5">
          <h2 className="text-lg font-semibold text-slate-950">當月薪資草稿</h2>
          <p className="text-sm text-slate-500">依出勤資料自動計算應發、應扣與實發金額，異常資料會標記需人資檢查。</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1220px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">員工</th>
                <th className="px-4 py-3">班表 / 打卡</th>
                <th className="px-4 py-3">請假 / 加班 / 補卡</th>
                <th className="px-4 py-3">異常</th>
                <th className="px-4 py-3">津貼設定</th>
                <th className="px-4 py-3">扣款設定</th>
                <th className="px-4 py-3">薪資草稿</th>
                <th className="px-4 py-3">狀態</th>
                <th className="px-4 py-3">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {monthDrafts.map((draft) => (
                <tr key={draft.id} className="align-top hover:bg-slate-50">
                  <td className="px-4 py-4">
                    <p className="font-semibold text-slate-950">{draft.employeeName}</p>
                    <p className="text-xs text-slate-500">{draft.employeeNo}</p>
                    <p className="mt-1 text-xs text-slate-500">{draft.department} · {draft.branch}</p>
                  </td>
                  <td className="px-4 py-4">
                    <p className="text-slate-700">班表 {draft.scheduledHours} 小時</p>
                    <p className="text-slate-700">實際打卡 {draft.actualPunchHours} 小時</p>
                  </td>
                  <td className="px-4 py-4">
                    <p className="text-slate-700">請假 {draft.leaveHours} 小時</p>
                    <p className="text-slate-700">加班 {draft.overtimeHours} 小時</p>
                    <p className="text-slate-700">補卡 {draft.correctionHours} 小時</p>
                  </td>
                  <td className="px-4 py-4">
                    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${draft.anomalyCount ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}>
                      {draft.anomalyCount ? `${draft.anomalyCount} 筆異常` : "無異常"}
                    </span>
                    {draft.warnings.length ? (
                      <div className="mt-2 space-y-1">
                        {draft.warnings.map((warning) => (
                          <p key={warning} className="text-xs text-amber-700">{warning}</p>
                        ))}
                      </div>
                    ) : null}
                  </td>
	                  <td className="px-4 py-4">
	                    <p className="text-slate-700">本薪 {currency(draft.baseSalary)}</p>
	                    <p className="text-slate-700">津貼 {currency(draft.allowanceAmount)}</p>
	                    <p className="text-slate-700">加班費 {currency(draft.overtimePay)}</p>
	                    <p className="text-slate-700">獎金 {currency(draft.bonus)}</p>
	                  </td>
	                  <td className="px-4 py-4">
	                    <p className="text-slate-700">請假扣薪 {currency(draft.leaveDeduction)}</p>
	                    <p className="text-slate-700">遲到扣款 {currency(draft.lateDeduction)}</p>
	                    <p className="text-slate-700">勞健保/稅 {currency(draft.laborInsuranceDeduction + draft.healthInsuranceDeduction + draft.incomeTax)}</p>
	                    <p className="text-slate-700">其他扣款 {currency(draft.otherDeduction)}</p>
	                  </td>
                  <td className="px-4 py-4">
                    <p className="text-slate-700">應發 {currency(draft.grossPay)}</p>
                    <p className="text-slate-700">應扣 {currency(draft.deductionTotal)}</p>
                    <p className="font-semibold text-slate-950">實發 {currency(draft.netPay)}</p>
                  </td>
                  <td className="px-4 py-4">
                    <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${statusStyles[draft.status]}`}>{draft.status}</span>
                  </td>
                  <td className="px-4 py-4">
                    <div className="flex flex-col gap-2">
                      <button
                        onClick={() => void markReviewed(draft.id)}
                        disabled={draft.status !== "需檢查"}
                        className="inline-flex items-center justify-center gap-2 rounded-lg border border-emerald-200 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        標記已檢查
                      </button>
                      <button
                        onClick={() => void sendToReview(draft.id)}
                        disabled={draft.status !== "草稿"}
                        className="inline-flex items-center justify-center gap-2 rounded-lg border border-sky-200 px-3 py-1.5 text-xs font-semibold text-sky-700 hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <FileText className="h-3.5 w-3.5" />
                        送人資複核
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!monthDrafts.length ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-sm text-slate-500">
                    目前月份沒有正式薪資草稿。請先於薪資結算流程建立 payroll_records / payroll_payslips。
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid gap-5 md:grid-cols-3">
        <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-5">
          <div className="mb-3 flex items-center gap-2">
            <Calculator className="h-5 w-5 text-indigo-700" />
            <h2 className="font-semibold text-indigo-900">自動產生薪資草稿</h2>
          </div>
          <p className="text-sm text-indigo-800">系統會將出勤、假勤、加班、補卡、異常、津貼與扣款彙整成每位員工當月薪資草稿。</p>
        </div>
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-5">
          <div className="mb-3 flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-700" />
            <h2 className="font-semibold text-amber-900">異常先檢查</h2>
          </div>
          <p className="text-sm text-amber-800">補卡未核准、GPS 異常、遲到早退與未打卡會標記需檢查，避免直接進入薪資鎖定。</p>
        </div>
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-5">
          <div className="mb-3 flex items-center gap-2">
            <WalletCards className="h-5 w-5 text-emerald-700" />
            <h2 className="font-semibold text-emerald-900">銜接薪資結算</h2>
          </div>
          <p className="text-sm text-emerald-800">草稿確認後可進入人資檢查、會計檢查、主管確認、鎖定薪資與發布薪資單流程。</p>
        </div>
      </section>
    </div>
  );
}
