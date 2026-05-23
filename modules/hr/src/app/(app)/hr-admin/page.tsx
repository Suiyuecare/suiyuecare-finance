"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Archive,
  BarChart3,
  Bell,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  FileSpreadsheet,
  GraduationCap,
  IdCard,
  Landmark,
  LockKeyhole,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Timer,
  UploadCloud,
  UserPlus,
  UsersRound,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { OperationFeedback } from "@/components/ui/operation-feedback";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import { careComplianceChecks, careWorkstreams } from "@/lib/long-term-care/industry-profile";
import { type DemoWorkflowRequest } from "@/lib/requests/workflow-store";
import {
  emptyHrAdminStats,
  formatBackofficeWarnings,
  loadHrAdminBackofficeData,
  type AuditLogRow,
  type HrAdminStats,
} from "@/lib/supabase/backoffice-data";

type HrWorkLane = {
  title: string;
  description: string;
  href: string;
  icon: LucideIcon;
  value: string;
  badge: string;
  tone: string;
};

type HrLinkCard = {
  title: string;
  description: string;
  href: string;
  icon: LucideIcon;
};

type HrRiskItem = {
  title: string;
  description: string;
  href: string;
  icon: LucideIcon;
  count: number;
  impact: string;
  priority: "P0" | "P1" | "P2";
  owner: string;
};

function formatDateTime(value: string | null) {
  if (!value) return "未記錄";
  return new Date(value).toLocaleString("zh-TW", { hour12: false });
}

function riskStyle(priority: HrRiskItem["priority"]) {
  if (priority === "P0") return "border-rose-200 bg-rose-50 text-rose-800";
  if (priority === "P1") return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-sky-200 bg-sky-50 text-sky-800";
}

function priorityLabel(priority: HrRiskItem["priority"]) {
  if (priority === "P0") return "今天必清";
  if (priority === "P1") return "本週處理";
  return "追蹤觀察";
}

function buildRiskItems(stats: HrAdminStats): HrRiskItem[] {
  const items: HrRiskItem[] = [
    {
      title: "出勤異常卡薪資",
      description: "未處理的異常與補卡會阻擋出勤轉薪資、薪資鎖定與薪資袋發布。",
      href: "/attendance/anomalies",
      icon: AlertTriangle,
      count: stats.attendanceAbnormal + stats.pendingPunchCorrections,
      impact: "薪資結算 / 出勤回寫",
      priority: stats.attendanceAbnormal + stats.pendingPunchCorrections > 0 ? "P0" : "P2",
      owner: "人資 + 主管",
    },
    {
      title: "待簽核表單逾期風險",
      description: "請假、加班、補卡未簽核會影響出勤、薪資與員工申訴。",
      href: "/approvals",
      icon: ClipboardCheck,
      count: stats.pendingWorkflowRequests,
      impact: "簽核 SLA / 員工體驗",
      priority: stats.pendingWorkflowRequests >= 5 ? "P0" : stats.pendingWorkflowRequests > 0 ? "P1" : "P2",
      owner: "主管 + 人資",
    },
    {
      title: "證照到期與訓練缺口",
      description: "長照證照或訓練時數不足，會影響評鑑資料完整性與服務資格管理。",
      href: "/licenses",
      icon: IdCard,
      count: stats.licenseAlerts + stats.trainingIncomplete,
      impact: "長照評鑑 / 排班資格",
      priority: stats.licenseAlerts > 0 ? "P0" : stats.trainingIncomplete > 0 ? "P1" : "P2",
      owner: "人資",
    },
    {
      title: "高離職風險",
      description: "新進、試用期或主管標記高風險人員需安排關懷紀錄。",
      href: "/retention",
      icon: UsersRound,
      count: stats.retentionHighRisk,
      impact: "留任率 / 人力穩定",
      priority: stats.retentionHighRisk > 0 ? "P1" : "P2",
      owner: "主管 + 人資",
    },
    {
      title: "匯入匯出待確認",
      description: "Excel 匯入與評鑑匯出未確認，會讓報表與上線資料不一致。",
      href: "/excel-imports",
      icon: FileSpreadsheet,
      count: stats.importBatchesPending + stats.reportExportsPending + stats.assessmentExportsPending,
      impact: "資料品質 / 評鑑輸出",
      priority: stats.importBatchesPending + stats.assessmentExportsPending > 0 ? "P1" : "P2",
      owner: "人資",
    },
  ];

  return items.sort((a, b) => {
    const order: Record<HrRiskItem["priority"], number> = { P0: 0, P1: 1, P2: 2 };
    return order[a.priority] - order[b.priority] || b.count - a.count;
  });
}

function buildWorkLanes(stats: HrAdminStats): HrWorkLane[] {
  return [
    {
      title: "人員主檔與異動",
      description: "新增員工、編輯任職資料、異動紀錄、留任風險與離職流程。",
      href: "/employees",
      icon: UsersRound,
      value: `${stats.activeEmployees} 人`,
      badge: `新進 ${stats.newHires30Days}`,
      tone: "bg-sky-50 text-sky-700",
    },
    {
      title: "假勤與簽核",
      description: "表單簽核、請假、加班、補卡與出勤異常。",
      href: "/approvals",
      icon: ClipboardCheck,
      value: `${stats.pendingWorkflowRequests} 件`,
      badge: `異常 ${stats.attendanceAbnormal}`,
      tone: "bg-amber-50 text-amber-700",
    },
    {
      title: "薪資前置作業",
      description: "出勤轉薪資、薪資草稿、薪資清冊、薪資袋發布與會計串接。",
      href: "/payroll/closing",
      icon: Landmark,
      value: `${stats.payrollDrafts} 批`,
      badge: `已發 ${stats.releasedPayslips}`,
      tone: "bg-emerald-50 text-emerald-700",
    },
    {
      title: "證照與教育訓練",
      description: "長照證照到期、附件審核、年度訓練時數與評鑑資料。",
      href: "/licenses",
      icon: IdCard,
      value: `${stats.licenseAlerts} 件`,
      badge: `訓練 ${stats.trainingIncomplete}`,
      tone: "bg-violet-50 text-violet-700",
    },
    {
      title: "報表與評鑑匯出",
      description: "員工名冊、出勤、薪資、證照訓練與長照評鑑包。",
      href: "/analytics",
      icon: BarChart3,
      value: `${stats.reportExportsPending + stats.assessmentExportsPending} 批`,
      badge: "匯出",
      tone: "bg-orange-50 text-orange-700",
    },
    {
      title: "系統設定與法規",
      description: "角色權限、班別、假別、加班、薪資、通知、法規檢核規則。",
      href: "/settings",
      icon: Settings2,
      value: `${stats.auditLogs24h} 筆`,
      badge: "稽核",
      tone: "bg-slate-100 text-slate-700",
    },
  ];
}

export default function HrAdminPage() {
  const currentUser = useCurrentUser();
  const [stats, setStats] = useState<HrAdminStats>(emptyHrAdminStats);
  const [workflowRequests, setWorkflowRequests] = useState<DemoWorkflowRequest[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogRow[]>([]);
  const [loadMessage, setLoadMessage] = useState("正在同步人資後台資料...");
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    if (!currentUser.id) return;
    void loadHrAdminData();
  }, [currentUser.id]);

  async function loadHrAdminData() {
    setIsRefreshing(true);
    try {
      const result = await loadHrAdminBackofficeData();
      setWorkflowRequests(result.data.workflowRequests);
      setAuditLogs(result.data.auditLogs);
      setStats(result.data.stats);
      setLoadMessage(formatBackofficeWarnings(result.warnings) || "已同步 Supabase：人員、簽核、假勤、薪資、證照訓練、匯入匯出、通知與稽核紀錄。");
      setLastSyncedAt(new Date());
    } catch (error) {
      setLoadMessage(error instanceof Error ? error.message : "人資後台資料同步失敗。");
    } finally {
      setIsRefreshing(false);
    }
  }

  const workLanes = useMemo(() => buildWorkLanes(stats), [stats]);
  const riskItems = useMemo(() => buildRiskItems(stats), [stats]);
  const urgentCount = stats.pendingWorkflowRequests + stats.pendingPunchCorrections + stats.attendanceAbnormal + stats.licenseAlerts + stats.retentionHighRisk;
  const p0RiskCount = riskItems.filter((item) => item.priority === "P0" && item.count > 0).length;
  const payrollReady = stats.attendanceAbnormal === 0 && stats.pendingPunchCorrections === 0;
  const dataLinks: HrLinkCard[] = [
    { title: "員工主檔", description: "employees → 出勤、薪資、證照、報表", href: "/employees", icon: UsersRound },
    { title: "表單流程", description: "hr_requests → 簽核、追蹤、通知", href: "/approvals", icon: ClipboardCheck },
    { title: "出勤紀錄", description: "attendance_punches → 異常、結薪", href: "/attendance/anomalies", icon: Timer },
    { title: "薪資資料", description: "payroll_records/items → 清冊、薪資袋", href: "/payroll/closing", icon: Landmark },
    { title: "證照訓練", description: "licenses/training_records → 評鑑匯出", href: "/assessment-exports", icon: GraduationCap },
    { title: "匯入匯出", description: "excel_import_batches/report_export_batches", href: "/excel-imports", icon: UploadCloud },
  ];
  const utilityLinks: HrLinkCard[] = [
    { title: "公告與通知", description: `${stats.unreadNotifications} 則未讀通知`, href: "/notifications", icon: Bell },
    { title: "長照評鑑匯出", description: `${stats.assessmentExportsPending} 批待處理`, href: "/assessment-exports", icon: Archive },
    { title: "Excel 匯入", description: `${stats.importBatchesPending} 批待確認`, href: "/excel-imports", icon: UploadCloud },
    { title: "法規規則庫", description: "低於法規不得送出", href: "/compliance", icon: ShieldCheck },
  ];

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-[#ead8c2] bg-white shadow-sm">
        <div className="flex flex-col gap-4 p-5 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-sm font-bold tracking-[0.12em] text-[#b45309]">HR ADMIN BACK OFFICE</p>
            <h1 className="mt-1 text-2xl font-black text-slate-950">人資後台總控台</h1>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-500">
              這裡補上人資每天最需要的後台入口：人員主檔、異動、假勤、簽核、固定時段出勤、薪資前置、證照訓練、報表匯出、Excel 匯入、法規規則與系統設定，所有數字都從 Supabase 權限可讀資料載入。
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Button variant="outline" onClick={() => void loadHrAdminData()} disabled={isRefreshing}>
              <RefreshCw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
              重新整理
            </Button>
            <Button asChild>
              <Link href="/employees">
                <UserPlus className="h-4 w-4" />
                新增/管理員工
              </Link>
            </Button>
          </div>
        </div>
      </section>

      <OperationFeedback
        title="人資後台同步"
        message={loadMessage}
        status={isRefreshing ? "loading" : undefined}
        updatedAt={lastSyncedAt ?? undefined}
        details={["人員", "簽核", "薪資", "證照訓練", "稽核"]}
        actionLabel="看稽核紀錄"
        actionHref="/hr-admin"
      />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        {[
          { label: "在職員工", value: `${stats.activeEmployees}`, detail: `新進 ${stats.newHires30Days} / 離職 ${stats.terminatedEmployees}`, icon: UsersRound, tone: "bg-sky-50 text-sky-700" },
          { label: "待處理表單", value: `${stats.pendingWorkflowRequests}`, detail: `請假 ${stats.pendingLeaveRequests} / 加班 ${stats.pendingOvertimeRequests}`, icon: ClipboardCheck, tone: "bg-amber-50 text-amber-700" },
          { label: "出勤異常", value: `${stats.attendanceAbnormal}`, detail: `補卡待審 ${stats.pendingPunchCorrections}`, icon: AlertTriangle, tone: "bg-rose-50 text-rose-700" },
          { label: "薪資前置", value: `${stats.payrollDrafts}`, detail: payrollReady ? "可進行結薪檢查" : "需先清異常", icon: Landmark, tone: "bg-emerald-50 text-emerald-700" },
          { label: "證照提醒", value: `${stats.licenseAlerts}`, detail: `訓練待完成 ${stats.trainingIncomplete}`, icon: IdCard, tone: "bg-violet-50 text-violet-700" },
          { label: "稽核紀錄", value: `${stats.auditLogs24h}`, detail: "最近 24 小時操作", icon: LockKeyhole, tone: "bg-slate-100 text-slate-700" },
        ].map((item) => (
          <div key={item.label} className="rounded-lg border border-[#ead8c2] bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-bold text-slate-600">{item.label}</p>
              <span className={`rounded-lg p-2 ${item.tone}`}>
                <item.icon className="h-4 w-4" />
              </span>
            </div>
            <p className="mt-3 text-2xl font-black text-slate-950">{item.value}</p>
            <p className="mt-1 text-xs text-slate-500">{item.detail}</p>
          </div>
        ))}
      </section>

      <section className={`rounded-lg border p-5 ${urgentCount > 0 ? "border-amber-200 bg-amber-50" : "border-emerald-200 bg-emerald-50"}`}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-3">
            {urgentCount > 0 ? <AlertTriangle className="mt-0.5 h-5 w-5 text-amber-700" /> : <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-700" />}
            <div>
              <h2 className={`font-black ${urgentCount > 0 ? "text-amber-950" : "text-emerald-950"}`}>
                {urgentCount > 0 ? `人資今日有 ${urgentCount} 項需要處理` : "目前沒有高優先人資待辦"}
              </h2>
              <p className={`mt-1 text-sm ${urgentCount > 0 ? "text-amber-800" : "text-emerald-800"}`}>
                系統會先提醒表單、補卡、出勤異常、證照到期與高離職風險；薪資結算前必須先把出勤與補卡清乾淨。
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/approvals" className="rounded-lg border border-white/70 bg-white px-3 py-2 text-sm font-bold text-slate-700 shadow-sm">簽核中心</Link>
            <Link href="/attendance/anomalies" className="rounded-lg border border-white/70 bg-white px-3 py-2 text-sm font-bold text-slate-700 shadow-sm">出勤異常</Link>
            <Link href="/payroll/attendance-calculation" className="rounded-lg border border-white/70 bg-white px-3 py-2 text-sm font-bold text-slate-700 shadow-sm">出勤轉薪資</Link>
          </div>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[1fr_340px]">
        <div className="rounded-lg border border-[#ead8c2] bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-[#ead8c2] p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-black tracking-[0.12em] text-[#b45309]">RISK RANKING</p>
              <h2 className="mt-1 text-xl font-black text-slate-950">人資風險排序</h2>
              <p className="mt-1 text-sm text-slate-500">
                系統依「薪資阻擋、法遵風險、長照評鑑、留任影響」排序，讓人資先清最會出事的項目。
              </p>
            </div>
            <span className={`w-fit rounded-full border px-3 py-1 text-xs font-black ${p0RiskCount > 0 ? "border-rose-200 bg-rose-50 text-rose-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>
              P0 {p0RiskCount} 項
            </span>
          </div>
          <div className="divide-y divide-slate-100">
            {riskItems.map((risk, index) => (
              <Link key={risk.title} href={risk.href} className="block p-4 transition hover:bg-[#fffaf4]">
                <div className="grid gap-3 md:grid-cols-[auto_1fr_auto] md:items-center">
                  <span className={`flex h-12 w-12 items-center justify-center rounded-lg border ${riskStyle(risk.priority)}`}>
                    <risk.icon className="h-5 w-5" />
                  </span>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-black text-slate-600">#{index + 1}</span>
                      <h3 className="font-black text-slate-950">{risk.title}</h3>
                      <span className={`rounded-full border px-2.5 py-1 text-xs font-black ${riskStyle(risk.priority)}`}>
                        {risk.priority} · {priorityLabel(risk.priority)}
                      </span>
                    </div>
                    <p className="mt-1 text-sm leading-6 text-slate-500">{risk.description}</p>
                    <div className="mt-2 flex flex-wrap gap-2 text-xs font-bold text-slate-500">
                      <span className="rounded-full bg-[#fffaf4] px-2.5 py-1">影響：{risk.impact}</span>
                      <span className="rounded-full bg-[#fffaf4] px-2.5 py-1">負責：{risk.owner}</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-3 md:justify-end">
                    <div className="text-right">
                      <div className="text-2xl font-black text-slate-950">{risk.count}</div>
                      <div className="text-xs text-slate-500">件</div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-slate-400" />
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-[#ead8c2] bg-[#fffaf4] p-5 shadow-sm">
          <p className="text-xs font-black tracking-[0.12em] text-[#b45309]">HR TRIAGE</p>
          <h2 className="mt-1 text-lg font-black text-slate-950">今天處理順序</h2>
          <div className="mt-4 space-y-3">
            {riskItems.slice(0, 3).map((risk, index) => (
              <Link key={risk.title} href={risk.href} className="block rounded-lg bg-white p-3 text-sm hover:bg-[#fff3de]">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-black text-slate-950">{index + 1}. {risk.title}</span>
                  <span className={`rounded-full border px-2 py-0.5 text-[11px] font-black ${riskStyle(risk.priority)}`}>{risk.priority}</span>
                </div>
                <p className="mt-1 text-xs leading-5 text-slate-500">{risk.impact}</p>
              </Link>
            ))}
          </div>
          <div className="mt-4 rounded-lg bg-white p-3 text-xs leading-5 text-slate-500">
            建議每天先清 P0，再處理 P1。P2 保留追蹤即可，不要讓首頁變成所有事情都很急。
          </div>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-lg border border-[#ead8c2] bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-sm font-bold tracking-[0.12em] text-[#b45309]">CARE INDUSTRY CONTROL</p>
              <h2 className="mt-1 text-lg font-black text-slate-950">長照營運差異化總控</h2>
              <p className="mt-2 text-sm leading-6 text-slate-500">
                人資後台需同時服務居服站與日照中心，核心不是只管員工，而是確保「人員資格、服務排班、打卡證據、評鑑資料」能串起來。
              </p>
            </div>
            <Link href="/attendance/homecare-schedules" className="inline-flex items-center justify-center rounded-lg bg-[#b45309] px-3 py-2 text-sm font-bold text-white">
              居服排班
              <ChevronRight className="ml-1 h-4 w-4" />
            </Link>
          </div>
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            {careWorkstreams.slice(0, 4).map((stream) => (
              <Link key={stream.key} href={stream.href} className="rounded-lg border border-[#ead8c2] bg-[#fffaf4] p-4 hover:border-[#d97706]">
                <div className="flex items-start justify-between gap-3">
                  <span className={`rounded-lg p-2 ${stream.tone}`}>
                    <stream.icon className="h-5 w-5" />
                  </span>
                  <span className="rounded-full bg-white px-2 py-1 text-xs font-bold text-slate-600">{stream.owner}</span>
                </div>
                <h3 className="mt-3 font-black text-slate-950">{stream.title}</h3>
                <p className="mt-1 text-xs leading-5 text-slate-500">{stream.description}</p>
              </Link>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-[#ead8c2] bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-[#b45309]" />
            <h2 className="text-lg font-black text-slate-950">長照上線檢核</h2>
          </div>
          <div className="space-y-3">
            {careComplianceChecks.map((check) => (
              <Link key={check.label} href="/attendance/schedule-guards" className="flex items-start gap-3 rounded-lg bg-[#fffaf4] p-3 hover:bg-[#fff3de]">
                <span className="rounded-lg bg-white p-2 text-[#b45309]">
                  <check.icon className="h-4 w-4" />
                </span>
                <div>
                  <div className="font-bold text-slate-950">{check.label}</div>
                  <p className="mt-1 text-xs leading-5 text-slate-500">{check.detail}</p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {workLanes.map((lane) => (
          <Link key={lane.title} href={lane.href} className="rounded-lg border border-[#ead8c2] bg-white p-5 shadow-sm transition hover:border-[#d97706] hover:shadow-md">
            <div className="flex items-start justify-between gap-3">
              <span className={`rounded-lg p-2 ${lane.tone}`}>
                <lane.icon className="h-5 w-5" />
              </span>
              <span className="rounded-full bg-[#fff3de] px-2.5 py-1 text-xs font-bold text-[#8a4b06]">{lane.badge}</span>
            </div>
            <div className="mt-4 flex items-end justify-between gap-3">
              <h2 className="font-black text-slate-950">{lane.title}</h2>
              <span className="text-lg font-black text-slate-950">{lane.value}</span>
            </div>
            <p className="mt-2 text-sm leading-6 text-slate-500">{lane.description}</p>
          </Link>
        ))}
      </section>

      <section className="grid gap-5 xl:grid-cols-[1fr_380px]">
        <div className="rounded-lg border border-[#ead8c2] bg-white shadow-sm">
          <div className="border-b border-[#ead8c2] p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-black text-slate-950">人資待辦流程</h2>
                <p className="text-sm text-slate-500">表單會一路串到追蹤、簽核、出勤、薪資與通知。</p>
              </div>
              <ClipboardCheck className="h-5 w-5 text-[#b45309]" />
            </div>
          </div>
          <div className="divide-y divide-slate-100">
            {workflowRequests.length > 0 ? workflowRequests.map((request) => (
              <Link key={request.id} href="/approvals" className="block p-4 hover:bg-[#fffaf4]">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-[#fff3de] px-2.5 py-1 text-xs font-bold text-[#8a4b06]">{request.type}</span>
                      <span className="font-black text-slate-950">{request.applicant}</span>
                      <span className="text-xs text-slate-500">{request.status}</span>
                    </div>
                    <p className="mt-2 text-sm text-slate-600">{request.reason || "未填寫原因"}</p>
                    <p className="mt-1 text-xs text-slate-500">目前關卡：{request.currentStep} · 申請日期：{request.date}</p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-slate-400" />
                </div>
              </Link>
            )) : (
              <div className="p-6 text-sm text-slate-500">目前沒有待處理表單。</div>
            )}
          </div>
        </div>

        <div className="rounded-lg border border-[#ead8c2] bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-[#b45309]" />
            <h2 className="text-lg font-black text-slate-950">上線前 HR 檢核</h2>
          </div>
          <div className="space-y-3">
            {[
              ["出勤異常清零", stats.attendanceAbnormal === 0 && stats.pendingPunchCorrections === 0, "結薪前必做"],
              ["證照到期處理", stats.licenseAlerts === 0, "避免排班資格不符"],
              ["薪資草稿覆核", stats.payrollDrafts > 0, "出勤轉薪資需留紀錄"],
              ["高風險留任追蹤", stats.retentionHighRisk === 0, "主管關懷需回寫"],
              ["稽核紀錄可追蹤", stats.auditLogs24h >= 0, "操作需進 audit_logs"],
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

      <section className="grid gap-5 xl:grid-cols-2">
        <div className="rounded-lg border border-[#ead8c2] bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-[#b45309]" />
            <h2 className="text-lg font-black text-slate-950">資料串接地圖</h2>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {dataLinks.map((item) => (
              <Link key={item.title} href={item.href} className="rounded-lg border border-[#ead8c2] bg-[#fffaf4] p-4 hover:border-[#d97706]">
                <item.icon className="h-5 w-5 text-[#b45309]" />
                <div className="mt-3 font-black text-slate-950">{item.title}</div>
                <div className="mt-1 text-xs leading-5 text-slate-500">{item.description}</div>
              </Link>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-[#ead8c2] bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <LockKeyhole className="h-5 w-5 text-[#b45309]" />
            <h2 className="text-lg font-black text-slate-950">最近操作紀錄</h2>
          </div>
          <div className="space-y-3">
            {auditLogs.length > 0 ? auditLogs.map((log) => (
              <div key={log.id} className="rounded-lg border border-[#ead8c2] bg-[#fffaf4] p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-bold text-slate-950">{log.action ?? "未命名操作"}</div>
                    <div className="mt-1 text-xs text-slate-500">{log.resource_type ?? "unknown"} · {log.users?.display_name ?? "系統或未知使用者"}</div>
                  </div>
                  <div className="text-right text-xs text-slate-500">{formatDateTime(log.created_at)}</div>
                </div>
              </div>
            )) : (
              <div className="rounded-lg border border-[#ead8c2] bg-[#fffaf4] p-4 text-sm text-slate-500">目前沒有可顯示的操作紀錄。</div>
            )}
          </div>
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {utilityLinks.map((item) => (
          <Link key={item.title} href={item.href} className="flex items-center justify-between gap-3 rounded-lg border border-[#ead8c2] bg-white p-4 shadow-sm hover:border-[#d97706]">
            <div className="flex items-center gap-3">
              <span className="rounded-lg bg-[#fff3de] p-2 text-[#b45309]">
                <item.icon className="h-5 w-5" />
              </span>
              <div>
                <div className="font-black text-slate-950">{item.title}</div>
                <div className="mt-1 text-xs text-slate-500">{item.description}</div>
              </div>
            </div>
            <ChevronRight className="h-4 w-4 text-slate-400" />
          </Link>
        ))}
      </section>
    </div>
  );
}
