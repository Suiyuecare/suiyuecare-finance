"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Banknote,
  Calculator,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  FileSpreadsheet,
  HandCoins,
  HeartPulse,
  LockKeyhole,
  Percent,
  ReceiptText,
  RefreshCw,
  Scale,
  ShieldCheck,
  Table2,
  WalletCards,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import { canViewIndividualPayrollData } from "@/lib/auth/privacy";
import {
  derivePayrollBatch,
  loadLivePayrollBatches,
  loadLivePayrollDrafts,
  loadLivePayrollSourceChecks,
  type PayrollBatch,
  type PayrollDraft,
  type SourceCheck,
} from "@/lib/payroll/payroll-store";

type PayrollModule = {
  title: string;
  description: string;
  href: string;
  icon: LucideIcon;
  badge: string;
  tone: string;
};

function currency(value: number) {
  return new Intl.NumberFormat("zh-TW", { style: "currency", currency: "TWD", maximumFractionDigits: 0 }).format(value);
}

function buildModules(batch: PayrollBatch, sourceBlockers: number): PayrollModule[] {
  return [
    {
      title: "薪資設定",
      description: "薪資型態、本薪、津貼、投保級距、所得稅與銀行帳號。",
      href: "/payroll/employee-settings",
      icon: HandCoins,
      badge: "人員",
      tone: "bg-sky-50 text-sky-700",
    },
    {
      title: "薪資項目",
      description: "固定加項、變動加項、固定扣項、公司負擔與員工自付。",
      href: "/payroll/items",
      icon: ReceiptText,
      badge: "項目",
      tone: "bg-violet-50 text-violet-700",
    },
    {
      title: "出勤轉薪資",
      description: "班表、打卡、請假、加班、補卡與異常出勤轉入薪資草稿。",
      href: "/payroll/attendance-calculation",
      icon: Calculator,
      badge: sourceBlockers > 0 ? `${sourceBlockers} 阻擋` : "可檢查",
      tone: sourceBlockers > 0 ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700",
    },
    {
      title: "加班費試算",
      description: "平日、休息日、例假日、國定假日與補休換算。",
      href: "/payroll/overtime-calculator",
      icon: Scale,
      badge: "法規",
      tone: "bg-indigo-50 text-indigo-700",
    },
    {
      title: "請假扣薪",
      description: "事假、病假半薪、特休、公假、無薪假與支薪比例。",
      href: "/payroll/leave-deduction",
      icon: Percent,
      badge: "規則",
      tone: "bg-orange-50 text-orange-700",
    },
    {
      title: "勞健保勞退",
      description: "投保級距、員工自付、公司負擔、勞退與二代健保。",
      href: "/payroll/insurance-calculator",
      icon: HeartPulse,
      badge: "級距",
      tone: "bg-rose-50 text-rose-700",
    },
    {
      title: "薪資結算",
      description: "人資檢查、會計檢查、主管確認、鎖定、發布薪資單。",
      href: "/payroll/closing",
      icon: ClipboardCheck,
      badge: batch.status,
      tone: "bg-emerald-50 text-emerald-700",
    },
    {
      title: "薪資清冊",
      description: "銀行轉帳檔、薪資清冊 Excel / CSV 與會計串接資料。",
      href: "/payroll/roster",
      icon: Table2,
      badge: `${batch.employees} 人`,
      tone: "bg-slate-100 text-slate-700",
    },
  ];
}

export default function PayrollBackofficePage() {
  const currentUser = useCurrentUser();
  const [payrollMonth, setPayrollMonth] = useState("2026-05");
  const [batch, setBatch] = useState<PayrollBatch>(() => derivePayrollBatch("2026-05", []));
  const [drafts, setDrafts] = useState<PayrollDraft[]>([]);
  const [sourceChecks, setSourceChecks] = useState<SourceCheck[]>([]);
  const [message, setMessage] = useState("正在同步薪資後台資料...");
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    void refreshPayroll();
  }, [payrollMonth]);

  async function refreshPayroll() {
    setIsLoading(true);
    try {
      const [liveDrafts, liveBatches, liveSources] = await Promise.all([
        loadLivePayrollDrafts(payrollMonth),
        loadLivePayrollBatches(),
        loadLivePayrollSourceChecks(payrollMonth),
      ]);
      setDrafts(liveDrafts);
      setSourceChecks(liveSources);
      setBatch(liveBatches[payrollMonth] ?? derivePayrollBatch(payrollMonth, liveDrafts));
      setMessage(`${payrollMonth} 已同步 Supabase payroll_records、payroll_payslips、payroll_items 與假勤來源。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "薪資後台同步 Supabase 失敗。");
    } finally {
      setIsLoading(false);
    }
  }

  const sourceBlockers = sourceChecks.filter((item) => !item.ready).length;
  const needsReview = drafts.filter((draft) => draft.status === "需檢查").length;
  const canViewPersonalPayroll = canViewIndividualPayrollData(currentUser);
  const modules = useMemo(() => {
    const nextModules = buildModules({ ...batch, employees: drafts.length, needsReview }, sourceBlockers);
    if (canViewPersonalPayroll) return nextModules;
    return nextModules.filter((module) => module.href !== "/payroll/employee-settings");
  }, [batch, canViewPersonalPayroll, drafts.length, needsReview, sourceBlockers]);
  const lockedCanPublish = batch.locked && sourceBlockers === 0 && needsReview === 0;
  const canLock = drafts.length > 0 && sourceBlockers === 0 && needsReview === 0;

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-[#ead8c2] bg-white shadow-sm">
        <div className="flex flex-col gap-4 p-5 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-sm font-bold tracking-[0.12em] text-[#b45309]">PAYROLL BACK OFFICE</p>
            <h1 className="mt-1 text-2xl font-black text-slate-950">薪資後台</h1>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-500">
              薪資後台集中處理薪資設定、薪資項目、出勤轉薪資、加班費、請假扣薪、勞健保勞退、薪資結算、薪資清冊與電子薪資單發布。結薪前會檢查出勤異常、補卡、薪資草稿與法規規則。
            </p>
            <p className="mt-2 text-sm font-semibold text-[#8a4b06]">{message}</p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              type="month"
              value={payrollMonth}
              onChange={(event) => setPayrollMonth(event.target.value)}
              className="rounded-lg border border-[#ead8c2] bg-white px-3 py-2 text-sm"
            />
            <Button variant="outline" onClick={() => void refreshPayroll()} disabled={isLoading}>
              <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
              重新同步
            </Button>
          </div>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {[
          { label: "薪資員工", value: `${drafts.length} 人`, detail: "payroll_payslips", icon: WalletCards, tone: "bg-sky-50 text-sky-700" },
          { label: "應發總額", value: currency(batch.grossPay), detail: "gross_pay_total", icon: Banknote, tone: "bg-emerald-50 text-emerald-700" },
          { label: "扣款總額", value: currency(batch.deductions), detail: "deduction_total", icon: LockKeyhole, tone: "bg-rose-50 text-rose-700" },
          { label: "實發總額", value: currency(batch.netPay), detail: "net_pay_total", icon: FileSpreadsheet, tone: "bg-amber-50 text-amber-700" },
          { label: "需檢查", value: `${needsReview + sourceBlockers} 項`, detail: `${needsReview} 薪資 / ${sourceBlockers} 來源`, icon: AlertTriangle, tone: "bg-orange-50 text-orange-700" },
        ].map((item) => (
          <div key={item.label} className="rounded-lg border border-[#ead8c2] bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-bold text-slate-600">{item.label}</p>
              <span className={`rounded-lg p-2 ${item.tone}`}>
                <item.icon className="h-4 w-4" />
              </span>
            </div>
            <p className="mt-3 text-xl font-black text-slate-950">{item.value}</p>
            <p className="mt-1 text-xs text-slate-500">{item.detail}</p>
          </div>
        ))}
      </section>

      {!canViewPersonalPayroll ? (
        <section className="rounded-lg border border-sky-200 bg-sky-50 p-5 shadow-sm">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 h-5 w-5 text-sky-700" />
            <div>
              <h2 className="font-black text-sky-950">經營層薪資視圖</h2>
              <p className="mt-1 text-sm leading-6 text-sky-800">
                你可以查看薪資總額、扣款總額、實發總額、公司負擔、結薪狀態與阻擋風險；個人本薪、銀行帳號、個別薪資清冊與員工薪資設定不在此角色揭露。
              </p>
            </div>
          </div>
        </section>
      ) : null}

      <section className={`rounded-lg border p-5 ${canLock ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-3">
            {canLock ? <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-700" /> : <AlertTriangle className="mt-0.5 h-5 w-5 text-amber-700" />}
            <div>
              <h2 className={`font-black ${canLock ? "text-emerald-950" : "text-amber-950"}`}>
                {canLock ? "此月份可進入薪資鎖定檢查" : "此月份尚不可直接鎖定薪資"}
              </h2>
              <p className={`mt-1 text-sm ${canLock ? "text-emerald-800" : "text-amber-800"}`}>
                {canLock
                  ? lockedCanPublish ? "已鎖定且符合發布條件，可前往薪資結算發布薪資單。" : "來源資料與薪資草稿已通過初步檢查，仍需依流程經人資、會計與主管確認。"
                  : "請先處理未同步來源、出勤異常、補卡待審或薪資草稿覆核，避免低於勞基法或薪資資料不完整。"}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/payroll/attendance-calculation" className="rounded-lg border border-white/70 bg-white px-3 py-2 text-sm font-bold text-slate-700 shadow-sm">檢查來源</Link>
            <Link href="/payroll/closing" className="rounded-lg border border-white/70 bg-white px-3 py-2 text-sm font-bold text-slate-700 shadow-sm">進入結算</Link>
            <Link href="/payroll/roster" className="rounded-lg border border-white/70 bg-white px-3 py-2 text-sm font-bold text-slate-700 shadow-sm">查看清冊</Link>
          </div>
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {modules.map((item) => (
          <Link key={item.href} href={item.href} className="rounded-lg border border-[#ead8c2] bg-white p-4 shadow-sm transition hover:border-[#d97706] hover:shadow-md">
            <div className="flex items-start justify-between gap-3">
              <span className={`rounded-lg p-2 ${item.tone}`}>
                <item.icon className="h-5 w-5" />
              </span>
              <span className="rounded-full bg-[#fff3de] px-2.5 py-1 text-xs font-bold text-[#8a4b06]">{item.badge}</span>
            </div>
            <h2 className="mt-3 font-black text-slate-950">{item.title}</h2>
            <p className="mt-1 text-xs leading-5 text-slate-500">{item.description}</p>
          </Link>
        ))}
      </section>

      <section className="grid gap-5 xl:grid-cols-[1fr_420px]">
        <div className="rounded-lg border border-[#ead8c2] bg-white shadow-sm">
          <div className="border-b border-[#ead8c2] p-5">
            <h2 className="text-lg font-black text-slate-950">薪資來源檢核</h2>
            <p className="text-sm text-slate-500">這裡不是展示數字，會讀 Supabase 來源表判斷能不能結薪。</p>
          </div>
          <div className="grid gap-3 p-5 md:grid-cols-2">
            {sourceChecks.map((source) => (
              <Link key={source.name} href="/payroll/attendance-calculation" className="rounded-lg border border-[#ead8c2] bg-[#fffaf4] p-4 hover:border-[#d97706]">
                <div className="flex items-start justify-between gap-3">
                  <span className="rounded-lg bg-white p-2 text-[#b45309] shadow-sm">
                    <source.icon className="h-5 w-5" />
                  </span>
                  <span className={`rounded-full px-2 py-1 text-xs font-bold ${source.ready ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
                    {source.ready ? "通過" : "需處理"}
                  </span>
                </div>
                <div className="mt-3 font-black text-slate-950">{source.name}</div>
                <div className="mt-1 text-xs leading-5 text-slate-500">{source.description}</div>
                <div className="mt-3 text-sm font-bold text-slate-700">{source.records} 筆</div>
              </Link>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-[#ead8c2] bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-[#b45309]" />
            <h2 className="text-lg font-black text-slate-950">薪資上線缺口控管</h2>
          </div>
          <div className="space-y-3">
            {[
              ["正式薪資資料", drafts.length > 0, "必須有 payroll_payslips 與 payroll_items"],
              ["來源資料完整", sourceBlockers === 0, "班表、打卡、補卡、異常都要可追溯"],
              ["草稿覆核完成", needsReview === 0, "reviewing 狀態不可直接發布"],
              ["薪資鎖定流程", batch.locked || !canLock, "鎖定後只能走調整紀錄"],
              ["員工權限限制", true, canViewPersonalPayroll ? "員工只能看自己的薪資袋" : "經營層只看彙總，不看個人薪資明細"],
            ].map(([label, passed, note]) => (
              <div key={String(label)} className="flex items-start gap-3 rounded-lg bg-[#fffaf4] p-3">
                {passed ? <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600" /> : <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-600" />}
                <div>
                  <div className="font-bold text-slate-900">{label}</div>
                  <div className="mt-0.5 text-xs text-slate-500">{note}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-[#ead8c2] bg-white p-5 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-black text-slate-950">薪資後台資料流</h2>
            <p className="mt-1 text-sm text-slate-500">
              `schedules / attendance_punches / leave_requests / overtime_requests / punch_correction_requests` 進入出勤轉薪資，產生 `payroll_records / payroll_payslips / payroll_items`，鎖定後發布薪資袋並提供薪資清冊與會計串接。
            </p>
          </div>
          <ChevronRight className="mt-1 h-5 w-5 text-slate-400" />
        </div>
      </section>
    </div>
  );
}
