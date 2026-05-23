"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Banknote,
  BarChart3,
  Bell,
  CalendarCheck2,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Clock3,
  ClipboardCheck,
  FileClock,
  FileCheck2,
  FileSpreadsheet,
  IdCard,
  Landmark,
  LockKeyhole,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  UserCheck,
  UserPlus,
  UserRound,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { OperationFeedback } from "@/components/ui/operation-feedback";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import type { HrRole } from "@/lib/auth/rbac";
import { getRoleLabel } from "@/lib/auth/rbac";
import { careScenarios, careWorkstreams } from "@/lib/long-term-care/industry-profile";
import {
  emptyDashboardStats,
  formatBackofficeWarnings,
  loadDashboardBackofficeData,
  type DashboardStats,
} from "@/lib/supabase/backoffice-data";

type WorkflowAction = {
  title: string;
  description: string;
  href: string;
  icon: LucideIcon;
  tone: string;
  badge: string;
};

type RoleHome = {
  eyebrow: string;
  title: string;
  description: string;
  primaryHref: string;
  primaryLabel: string;
  actions: WorkflowAction[];
};

type PriorityItem = {
  title: string;
  detail: string;
  href: string;
  tone: string;
};

type StatusItem = {
  label: string;
  value: string;
  icon: LucideIcon;
};

type HrWorkItem = {
  title: string;
  detail: string;
  value: number;
  href: string;
  icon: LucideIcon;
  severity: "critical" | "warning" | "normal";
  action: string;
};

type ExecutiveMetric = {
  label: string;
  value: string;
  detail: string;
  href: string;
  icon: LucideIcon;
  tone: string;
};

type ExecutiveRisk = {
  title: string;
  detail: string;
  impact: string;
  href: string;
  value: number;
  severity: "critical" | "warning" | "stable";
};

const hrWorkStyles: Record<HrWorkItem["severity"], string> = {
  critical: "border-rose-200 bg-rose-50 text-rose-950",
  warning: "border-amber-200 bg-amber-50 text-amber-950",
  normal: "border-emerald-200 bg-emerald-50 text-emerald-950",
};

function isHrWorkbenchRole(role: HrRole) {
  return ["hr", "admin_director"].includes(role);
}

function isExecutiveRole(role: HrRole) {
  return role === "ceo";
}

function buildHrWorkItems(stats: DashboardStats): HrWorkItem[] {
  const items: HrWorkItem[] = [
    {
      title: "待簽核表單",
      detail: `請假 ${stats.pendingLeaveRequests}、加班 ${stats.pendingOvertimeRequests}，含流程中與退回補件。`,
      value: stats.approvalsForMe,
      href: "/approvals",
      icon: ClipboardCheck,
      severity: stats.approvalsForMe > 10 ? "critical" : stats.approvalsForMe > 0 ? "warning" : "normal",
      action: "處理簽核",
    },
    {
      title: "補卡待審",
      detail: "補卡會影響出勤、加班與薪資結算，需在結薪前清空。",
      value: stats.pendingPunchCorrections,
      href: "/punch-corrections",
      icon: FileClock,
      severity: stats.pendingPunchCorrections > 0 ? "critical" : "normal",
      action: "審補卡",
    },
    {
      title: "出勤異常",
      detail: "遲到、未打卡、GPS/IP 異常與工時異常需先釐清責任。",
      value: stats.attendanceAnomalies,
      href: "/attendance/anomalies",
      icon: ShieldAlert,
      severity: stats.attendanceAnomalies > 10 ? "critical" : stats.attendanceAnomalies > 0 ? "warning" : "normal",
      action: "看異常",
    },
    {
      title: "證照/訓練缺口",
      detail: `證照提醒 ${stats.licenseAlerts}、訓練未完成 ${stats.trainingIncomplete}，會影響長照排班與評鑑。`,
      value: stats.licenseAlerts + stats.trainingIncomplete,
      href: "/licenses",
      icon: IdCard,
      severity: stats.licenseAlerts + stats.trainingIncomplete > 0 ? "warning" : "normal",
      action: "補資格",
    },
    {
      title: "新進與留任風險",
      detail: `30 天內新進 ${stats.newHires30Days} 人，高風險留任 ${stats.retentionHighRisk} 人。`,
      value: stats.newHires30Days + stats.retentionHighRisk,
      href: "/retention",
      icon: UserPlus,
      severity: stats.retentionHighRisk > 0 ? "warning" : "normal",
      action: "追留任",
    },
    {
      title: "薪資前置阻擋",
      detail: `薪資草稿 ${stats.payrollDrafts} 批；補卡、出勤異常與表單未清會阻擋結薪。`,
      value: stats.payrollDrafts + stats.pendingPunchCorrections + stats.attendanceAnomalies,
      href: "/payroll/attendance-calculation",
      icon: Banknote,
      severity: stats.pendingPunchCorrections + stats.attendanceAnomalies > 0 ? "critical" : stats.payrollDrafts > 0 ? "warning" : "normal",
      action: "結薪前檢查",
    },
  ];

  return items.sort((a, b) => {
    const rank = { critical: 0, warning: 1, normal: 2 };
    return rank[a.severity] - rank[b.severity] || b.value - a.value;
  });
}

function buildExecutiveMetrics(stats: DashboardStats): ExecutiveMetric[] {
  const payrollRisk = stats.pendingPunchCorrections + stats.attendanceAnomalies + stats.pendingLeaveRequests + stats.pendingOvertimeRequests;
  const complianceRisk = stats.licenseAlerts + stats.trainingIncomplete;
  const operatingBacklog = stats.myPendingRequests + stats.approvalsForMe + stats.pendingLeaveRequests + stats.pendingOvertimeRequests + stats.pendingPunchCorrections;
  const retentionPressure = stats.retentionHighRisk + stats.newHires30Days;

  return [
    {
      label: "全集團人力",
      value: `${stats.activeEmployees} 人`,
      detail: `30 天新進 ${stats.newHires30Days} 人，高風險留任 ${stats.retentionHighRisk} 人。`,
      href: "/analytics",
      icon: Users,
      tone: "border-sky-200 bg-sky-50 text-sky-950",
    },
    {
      label: "薪資結算風險",
      value: `${payrollRisk} 件`,
      detail: `補卡、出勤異常與未決表單會阻擋結薪；草稿 ${stats.payrollDrafts} 批。`,
      href: "/payroll/attendance-calculation",
      icon: Banknote,
      tone: payrollRisk > 0 ? "border-rose-200 bg-rose-50 text-rose-950" : "border-emerald-200 bg-emerald-50 text-emerald-950",
    },
    {
      label: "法遵與評鑑缺口",
      value: `${complianceRisk} 件`,
      detail: `證照提醒 ${stats.licenseAlerts}，教育訓練未完成 ${stats.trainingIncomplete}。`,
      href: "/compliance",
      icon: ShieldCheck,
      tone: complianceRisk > 0 ? "border-amber-200 bg-amber-50 text-amber-950" : "border-emerald-200 bg-emerald-50 text-emerald-950",
    },
    {
      label: "組織穩定度",
      value: `${retentionPressure} 件`,
      detail: `新進照顧與留任風險需主管關懷與人資追蹤。`,
      href: "/retention",
      icon: UserCheck,
      tone: retentionPressure > 0 ? "border-violet-200 bg-violet-50 text-violet-950" : "border-emerald-200 bg-emerald-50 text-emerald-950",
    },
    {
      label: "營運待決事項",
      value: `${operatingBacklog} 件`,
      detail: "跨部門簽核與流程中申請會影響排班、薪資與服務交付。",
      href: "/approvals",
      icon: ClipboardCheck,
      tone: operatingBacklog > 0 ? "border-amber-200 bg-amber-50 text-amber-950" : "border-emerald-200 bg-emerald-50 text-emerald-950",
    },
    {
      label: "資料輸出治理",
      value: `${stats.reportExports} 批`,
      detail: "評鑑、薪資、人力成本與會計拋轉報表需可追溯。",
      href: "/analytics",
      icon: FileSpreadsheet,
      tone: "border-slate-200 bg-slate-50 text-slate-950",
    },
  ];
}

function buildExecutiveRisks(stats: DashboardStats): ExecutiveRisk[] {
  const risks: ExecutiveRisk[] = [
    {
      title: "薪資發布可能被出勤資料卡住",
      detail: `補卡待審 ${stats.pendingPunchCorrections}、出勤異常 ${stats.attendanceAnomalies}、請假/加班未決 ${stats.pendingLeaveRequests + stats.pendingOvertimeRequests}。`,
      impact: "影響結薪準時性、員工信任與會計拋轉。",
      href: "/payroll/attendance-calculation",
      value: stats.pendingPunchCorrections + stats.attendanceAnomalies + stats.pendingLeaveRequests + stats.pendingOvertimeRequests,
      severity: stats.pendingPunchCorrections + stats.attendanceAnomalies > 0 ? "critical" : stats.pendingLeaveRequests + stats.pendingOvertimeRequests > 0 ? "warning" : "stable",
    },
    {
      title: "長照服務資格與評鑑資料缺口",
      detail: `證照到期/待審 ${stats.licenseAlerts}，年度教育訓練未完成 ${stats.trainingIncomplete}。`,
      impact: "影響服務資格管理，也會拖慢評鑑資料匯出。",
      href: "/licenses",
      value: stats.licenseAlerts + stats.trainingIncomplete,
      severity: stats.licenseAlerts > 0 ? "critical" : stats.trainingIncomplete > 0 ? "warning" : "stable",
    },
    {
      title: "離職與留任壓力",
      detail: `高風險留任 ${stats.retentionHighRisk} 人，30 天內新進 ${stats.newHires30Days} 人。`,
      impact: "影響服務量能、主管負荷與招募成本。",
      href: "/retention",
      value: stats.retentionHighRisk + stats.newHires30Days,
      severity: stats.retentionHighRisk > 0 ? "warning" : "stable",
    },
    {
      title: "簽核流程堆積",
      detail: `待簽核 ${stats.approvalsForMe}，我的流程中申請 ${stats.myPendingRequests}，補卡待審 ${stats.pendingPunchCorrections}。`,
      impact: "造成員工等待、主管補件成本與排班薪資延遲。",
      href: "/approvals",
      value: stats.approvalsForMe + stats.myPendingRequests + stats.pendingPunchCorrections,
      severity: stats.approvalsForMe + stats.myPendingRequests + stats.pendingPunchCorrections > 10 ? "critical" : stats.approvalsForMe + stats.myPendingRequests + stats.pendingPunchCorrections > 0 ? "warning" : "stable",
    },
  ];

  const rank = { critical: 0, warning: 1, stable: 2 };
  return risks.sort((a, b) => rank[a.severity] - rank[b.severity] || b.value - a.value);
}

function roleHome(role: HrRole, stats: DashboardStats): RoleHome {
  if (role === "team_member") {
    return {
      eyebrow: "EMPLOYEE HOME",
      title: "我的今日工作",
      description: "先完成打卡、確認班表，再處理表單、公告與薪資袋。",
      primaryHref: "/employee-portal",
      primaryLabel: "進入員工入口",
      actions: [
        { title: stats.todayPunches > 0 ? "查看今日打卡" : "我要打卡", description: "上班、下班、外出、返回一鍵完成。", href: "/clock", icon: Clock3, tone: stats.todayPunches > 0 ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700", badge: `${stats.todayPunches} 筆` },
        { title: "表單申請", description: "請假、加班、補卡各自進入獨立頁填寫。", href: "/requests/new", icon: FileCheck2, tone: "bg-sky-50 text-sky-700", badge: "申請" },
        { title: "追蹤我的表單", description: "查看目前關卡、退回補件與簽核結果。", href: "/requests", icon: ClipboardCheck, tone: "bg-violet-50 text-violet-700", badge: `${stats.myPendingRequests} 件` },
        { title: "薪資袋", description: "輸入薪資袋密碼後查看本人薪資單。", href: "/payslip", icon: LockKeyhole, tone: "bg-rose-50 text-rose-700", badge: "本人" },
      ],
    };
  }

  if (role === "supervisor") {
    return {
      eyebrow: "MANAGER HOME",
      title: "主管今日待辦",
      description: "先簽核，再看部門出勤異常與補卡待確認。",
      primaryHref: "/manager-portal",
      primaryLabel: "進入主管入口",
      actions: [
        { title: "待我簽核", description: "請假、加班、補卡集中處理。", href: "/approvals", icon: ClipboardCheck, tone: "bg-amber-50 text-amber-700", badge: `${stats.approvalsForMe} 件` },
        { title: "部門出勤異常", description: "遲到、未打卡、GPS/IP 異常需追蹤。", href: "/attendance/anomalies", icon: AlertTriangle, tone: "bg-rose-50 text-rose-700", badge: `${stats.attendanceAnomalies} 筆` },
        { title: "固定上班時段", description: "確認 08:00-08:30 / 08:30-09:00 到班狀態。", href: "/attendance", icon: CalendarDays, tone: "bg-emerald-50 text-emerald-700", badge: "出勤" },
        { title: "部門報表", description: "查看請假、加班、異常與人力統計。", href: "/attendance/reports", icon: BarChart3, tone: "bg-sky-50 text-sky-700", badge: "報表" },
      ],
    };
  }

  if (role === "hr") {
    return {
      eyebrow: "HR HOME",
      title: "人資今日工作台",
      description: "先處理人員異動、假勤簽核、出勤異常，再檢查證照訓練與薪資前置。",
      primaryHref: "/hr-admin",
      primaryLabel: "進入人資後台",
      actions: [
        { title: "人員主檔", description: "新增、編輯、異動與員工生命週期。", href: "/employees", icon: Users, tone: "bg-sky-50 text-sky-700", badge: `${stats.activeEmployees} 人` },
        { title: "待簽核/補件", description: "表單流程、退回補件與簽核軌跡。", href: "/approvals", icon: ClipboardCheck, tone: "bg-amber-50 text-amber-700", badge: `${stats.approvalsForMe} 件` },
        { title: "證照訓練", description: "到期、缺附件、年度訓練時數與評鑑資料。", href: "/licenses", icon: IdCard, tone: "bg-violet-50 text-violet-700", badge: `${stats.licenseAlerts} 件` },
        { title: "薪資前置", description: "出勤轉薪資、草稿覆核與清冊。", href: "/payroll", icon: Banknote, tone: "bg-emerald-50 text-emerald-700", badge: `${stats.payrollDrafts} 批` },
      ],
    };
  }

  if (role === "admin_director") {
    return {
      eyebrow: "ADMIN DIRECTOR HOME",
      title: "行政部門主任總覽",
      description: "聚焦跨部門簽核、薪資覆核、報表匯出、權限與法規設定。",
      primaryHref: "/hr-admin",
      primaryLabel: "進入行政總控",
      actions: [
        { title: "跨部門簽核", description: "行政部門主任關卡與例外流程。", href: "/approvals", icon: ClipboardCheck, tone: "bg-amber-50 text-amber-700", badge: `${stats.approvalsForMe} 件` },
        { title: "薪資後台", description: "薪資結算、清冊、銀行檔與會計串接。", href: "/payroll", icon: Landmark, tone: "bg-emerald-50 text-emerald-700", badge: `${stats.payrollDrafts} 批` },
        { title: "系統設定", description: "角色權限、假勤、加班、通知與報表格式。", href: "/settings", icon: ShieldCheck, tone: "bg-slate-100 text-slate-700", badge: "設定" },
        { title: "報表中心", description: "員工、出勤、薪資、證照與人力成本。", href: "/analytics", icon: FileSpreadsheet, tone: "bg-sky-50 text-sky-700", badge: `${stats.reportExports} 批` },
      ],
    };
  }

  return {
    eyebrow: "EXECUTIVE HOME",
    title: "執行長決策總覽",
    description: "看全集團人力、薪資風險、法遵狀態、報表與跨模組串接。",
    primaryHref: "/analytics",
    primaryLabel: "進入報表中心",
    actions: [
      { title: "全集團人力", description: "在職、新進、離職、留任與部門分布。", href: "/hr-admin", icon: Users, tone: "bg-sky-50 text-sky-700", badge: `${stats.activeEmployees} 人` },
      { title: "薪資風險", description: "薪資草稿、覆核、鎖定與發布狀態。", href: "/payroll", icon: Banknote, tone: "bg-emerald-50 text-emerald-700", badge: `${stats.payrollDrafts} 批` },
      { title: "法規合規", description: "低於法規不得送出、排班、結薪或發布設定。", href: "/compliance", icon: ShieldCheck, tone: "bg-rose-50 text-rose-700", badge: "阻擋" },
      { title: "會計串接", description: "薪資清冊、銀行檔與會計系統拋轉。", href: "/finance-handoff", icon: Landmark, tone: "bg-violet-50 text-violet-700", badge: "串接" },
    ],
  };
}

export default function DashboardPage() {
  const currentUser = useCurrentUser();
  const [stats, setStats] = useState<DashboardStats>(emptyDashboardStats);
  const [message, setMessage] = useState("正在整理你的首頁工作流...");
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!currentUser.id) return;
    void refreshDashboard();
  }, [currentUser.id, currentUser.role]);

  async function refreshDashboard() {
    setIsLoading(true);
    try {
      const result = await loadDashboardBackofficeData(currentUser);
      setStats(result.data);
      setMessage(formatBackofficeWarnings(result.warnings) || "已依你的角色整理今日工作與待辦入口，資料來源為 Supabase 後台服務層。");
      setLastSyncedAt(new Date());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "首頁工作流同步失敗。");
    } finally {
      setIsLoading(false);
    }
  }

  const home = useMemo(() => roleHome(currentUser.role, stats), [currentUser.role, stats]);
  const hrWorkItems = useMemo(() => buildHrWorkItems(stats), [stats]);
  const executiveMetrics = useMemo(() => buildExecutiveMetrics(stats), [stats]);
  const executiveRisks = useMemo(() => buildExecutiveRisks(stats), [stats]);
  const executiveCriticalCount = executiveRisks.filter((risk) => risk.severity === "critical").length;
  const hrCriticalCount = hrWorkItems.filter((item) => item.severity === "critical").length;
  const payrollBlockers = stats.pendingPunchCorrections + stats.attendanceAnomalies + stats.pendingLeaveRequests + stats.pendingOvertimeRequests;
  const priorityItems = useMemo(() => {
    const items: Array<PriorityItem | null> = [
      stats.unreadNotifications > 0 ? { title: "查看未讀通知", detail: `${stats.unreadNotifications} 則公告或系統通知尚未讀取。`, href: "/notifications", tone: "border-violet-200 bg-violet-50 text-violet-900" } : null,
      stats.approvalsForMe > 0 ? { title: "處理待簽核", detail: `${stats.approvalsForMe} 件表單正在等待你處理。`, href: "/approvals", tone: "border-amber-200 bg-amber-50 text-amber-900" } : null,
      stats.attendanceAnomalies > 0 && currentUser.role !== "team_member" ? { title: "追蹤出勤異常", detail: `${stats.attendanceAnomalies} 筆打卡或補卡異常需處理。`, href: "/attendance/anomalies", tone: "border-rose-200 bg-rose-50 text-rose-900" } : null,
      stats.licenseAlerts > 0 && ["hr", "admin_director", "ceo"].includes(currentUser.role) ? { title: "處理證照到期", detail: `${stats.licenseAlerts} 筆證照到期、缺件或待審。`, href: "/licenses", tone: "border-sky-200 bg-sky-50 text-sky-900" } : null,
    ];
    const visibleItems = items.filter((item): item is PriorityItem => Boolean(item));

    return visibleItems.length
      ? visibleItems
      : [{ title: "目前沒有急件", detail: "可以從下方常用功能開始今天的工作。", href: home.primaryHref, tone: "border-emerald-200 bg-emerald-50 text-emerald-900" }];
  }, [currentUser.role, home.primaryHref, stats]);

  const statusItems: StatusItem[] = [
    { label: "我的表單", value: `${stats.myPendingRequests} 件`, icon: UserRound },
    { label: "待我簽核", value: `${stats.approvalsForMe} 件`, icon: UserCheck },
    { label: "未讀通知", value: `${stats.unreadNotifications} 則`, icon: Bell },
    { label: "新進員工", value: `${stats.newHires30Days} 人`, icon: UserPlus },
  ];

  const financeStyleMetrics = [
    {
      title: "今日待辦",
      value: `${stats.approvalsForMe + stats.myPendingRequests} 件`,
      detail: `待簽核 ${stats.approvalsForMe} 件，流程中 ${stats.myPendingRequests} 件`,
      href: "/approvals",
      icon: ClipboardCheck,
    },
    {
      title: "薪資前置阻擋",
      value: `${payrollBlockers} 件`,
      detail: `補卡、出勤異常、請假與加班會影響結薪`,
      href: "/payroll/attendance-calculation",
      icon: Banknote,
    },
    {
      title: "人員與通知",
      value: `${stats.activeEmployees} 人`,
      detail: `新進 ${stats.newHires30Days} 人，未讀通知 ${stats.unreadNotifications} 則`,
      href: "/employees",
      icon: Users,
    },
  ];

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-[16px] border border-[#ead8c2] bg-white shadow-[0_18px_45px_rgba(120,72,20,0.12)]">
        <div className="bg-[linear-gradient(135deg,#c86b00_0%,#e47d00_48%,#f4a737_100%)] p-5 text-white sm:p-6">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <p className="text-sm font-bold uppercase tracking-[0.14em] text-white/80">SUIYUE CARE GROUP</p>
              <h1 className="mt-2 text-3xl font-black sm:text-4xl">歲悅人資管理系統 V3</h1>
              <p className="mt-3 max-w-4xl text-sm font-medium leading-6 text-white/88 sm:text-base">
                {currentUser.name}，你目前是「{getRoleLabel(currentUser.role)}」。{home.description}
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Button className="border border-white/35 bg-white/10 text-white hover:bg-white/20 hover:text-white" variant="outline" onClick={() => void refreshDashboard()} disabled={isLoading}>
                <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
                重新整理
              </Button>
              <Button asChild className="bg-white text-[#8a4b06] hover:bg-[#fff7ed]">
                <Link href={home.primaryHref}>
                  {home.primaryLabel}
                  <ChevronRight className="h-4 w-4" />
                </Link>
              </Button>
            </div>
          </div>
        </div>

        <div className="grid gap-3 border-t border-[#ead8c2] bg-[#fffaf4] p-4 md:grid-cols-3">
          {financeStyleMetrics.map((metric) => (
            <Link key={metric.title} href={metric.href} className="rounded-[12px] border border-[#ead8c2] bg-white p-4 transition hover:border-[#d97706] hover:shadow-md">
              <div className="flex items-start justify-between gap-3">
                <span className="rounded-[10px] border border-[#f5c98d] bg-[#fff7ed] p-2 text-[#9a4f00]">
                  <metric.icon className="h-5 w-5" />
                </span>
                <ChevronRight className="h-4 w-4 text-[#b45309]" />
              </div>
              <div className="mt-4 text-sm font-black text-[#7c3f00]">{metric.title}</div>
              <div className="mt-1 text-3xl font-black text-slate-950">{metric.value}</div>
              <p className="mt-2 text-xs font-semibold leading-5 text-slate-500">{metric.detail}</p>
            </Link>
          ))}
        </div>
      </section>

      <OperationFeedback
        title="首頁同步狀態"
        message={message}
        status={isLoading ? "loading" : undefined}
        updatedAt={lastSyncedAt ?? undefined}
        details={["Supabase", getRoleLabel(currentUser.role), "角色工作流"]}
        actionLabel="查看通知"
        actionHref="/notifications"
      />

      {isExecutiveRole(currentUser.role) ? (
        <section className="grid gap-5 xl:grid-cols-[1fr_380px]">
          <div className="rounded-lg border border-[#ead8c2] bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p className="text-sm font-bold tracking-[0.12em] text-[#b45309]">EXECUTIVE BUSINESS DASHBOARD</p>
                <h2 className="mt-1 text-xl font-black text-slate-950">老闆經營儀表板</h2>
                <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-500">
                  這裡只呈現跨公司、跨據點的經營訊號，不列員工個資。重點是人力量能、薪資準時性、法規風險、長照評鑑與組織穩定度。
                </p>
              </div>
              <Link href="/analytics" className="inline-flex items-center justify-center rounded-lg bg-[#b45309] px-3 py-2 text-sm font-bold text-white hover:bg-[#92400e]">
                查看完整經營報表
                <ChevronRight className="ml-1 h-4 w-4" />
              </Link>
            </div>

            <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {executiveMetrics.map((metric) => (
                <Link key={metric.label} href={metric.href} className={`rounded-lg border p-4 transition hover:shadow-md ${metric.tone}`}>
                  <div className="flex items-start justify-between gap-3">
                    <span className="rounded-lg bg-white/70 p-2">
                      <metric.icon className="h-5 w-5" />
                    </span>
                    <ChevronRight className="h-4 w-4 opacity-70" />
                  </div>
                  <div className="mt-4 text-sm font-black">{metric.label}</div>
                  <div className="mt-1 text-3xl font-black">{metric.value}</div>
                  <p className="mt-2 text-xs leading-5 opacity-80">{metric.detail}</p>
                </Link>
              ))}
            </div>
          </div>

          <div className="space-y-5">
            <div className={`rounded-lg border p-5 shadow-sm ${executiveCriticalCount > 0 ? "border-rose-200 bg-rose-50" : "border-emerald-200 bg-emerald-50"}`}>
              <div className="flex items-start gap-3">
                {executiveCriticalCount > 0 ? <AlertTriangle className="mt-0.5 h-5 w-5 text-rose-700" /> : <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-700" />}
                <div>
                  <h2 className={`font-black ${executiveCriticalCount > 0 ? "text-rose-950" : "text-emerald-950"}`}>
                    {executiveCriticalCount > 0 ? `目前有 ${executiveCriticalCount} 個高風險經營議題` : "今日沒有高風險經營阻擋"}
                  </h2>
                  <p className={`mt-2 text-sm leading-6 ${executiveCriticalCount > 0 ? "text-rose-800" : "text-emerald-800"}`}>
                    {executiveCriticalCount > 0 ? "建議先要求主管與人資清出勤、補卡與資格缺口，避免拖到薪資與服務排班。" : "可查看趨勢報表、評鑑輸出與本月人力成本。"}
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-[#ead8c2] bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-center gap-2">
                <ShieldAlert className="h-5 w-5 text-[#b45309]" />
                <h2 className="font-black text-slate-950">經營風險排序</h2>
              </div>
              <div className="space-y-3">
                {executiveRisks.map((risk, index) => (
                  <Link key={risk.title} href={risk.href} className="block rounded-lg border border-[#ead8c2] bg-[#fffaf4] p-3 hover:border-[#d97706] hover:bg-white">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="rounded-full bg-white px-2 py-0.5 text-xs font-black text-[#8a4b06]">#{index + 1}</span>
                          <h3 className="text-sm font-black text-slate-950">{risk.title}</h3>
                        </div>
                        <p className="mt-2 text-xs leading-5 text-slate-500">{risk.detail}</p>
                        <p className="mt-1 text-xs font-semibold leading-5 text-[#7c3f00]">{risk.impact}</p>
                      </div>
                      <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-black ${risk.severity === "critical" ? "bg-rose-50 text-rose-700" : risk.severity === "warning" ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}>
                        {risk.severity === "critical" ? "需決策" : risk.severity === "warning" ? "追蹤" : "穩定"}
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {isHrWorkbenchRole(currentUser.role) ? (
        <section className="grid gap-5 xl:grid-cols-[1fr_360px]">
          <div className="rounded-lg border border-[#ead8c2] bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p className="text-sm font-bold tracking-[0.12em] text-[#b45309]">HR DAILY COMMAND CENTER</p>
                <h2 className="mt-1 text-xl font-black text-slate-950">人資今日必處理</h2>
                <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-500">
                  先清會影響薪資的阻擋事項，再處理證照訓練、留任與報表。這裡只放人資今天真的要動手的工作。
                </p>
              </div>
              <Link href="/hr-admin" className="inline-flex items-center justify-center rounded-lg bg-[#b45309] px-3 py-2 text-sm font-bold text-white hover:bg-[#92400e]">
                進入人資總控
                <ChevronRight className="ml-1 h-4 w-4" />
              </Link>
            </div>

            <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {hrWorkItems.map((item) => (
                <Link key={item.title} href={item.href} className={`rounded-lg border p-4 transition hover:shadow-md ${hrWorkStyles[item.severity]}`}>
                  <div className="flex items-start justify-between gap-3">
                    <span className="rounded-lg bg-white/70 p-2">
                      <item.icon className="h-5 w-5" />
                    </span>
                    <span className="rounded-full bg-white/70 px-2.5 py-1 text-xs font-black">
                      {item.severity === "critical" ? "優先" : item.severity === "warning" ? "追蹤" : "正常"}
                    </span>
                  </div>
                  <div className="mt-4 flex items-end justify-between gap-3">
                    <h3 className="font-black">{item.title}</h3>
                    <span className="text-2xl font-black">{item.value}</span>
                  </div>
                  <p className="mt-2 text-xs leading-5 opacity-80">{item.detail}</p>
                  <div className="mt-3 inline-flex items-center text-sm font-black">
                    {item.action}
                    <ChevronRight className="ml-1 h-4 w-4" />
                  </div>
                </Link>
              ))}
            </div>
          </div>

          <div className="space-y-5">
            <div className={`rounded-lg border p-5 shadow-sm ${hrCriticalCount > 0 ? "border-rose-200 bg-rose-50" : "border-emerald-200 bg-emerald-50"}`}>
              <div className="flex items-start gap-3">
                {hrCriticalCount > 0 ? <AlertTriangle className="mt-0.5 h-5 w-5 text-rose-700" /> : <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-700" />}
                <div>
                  <h2 className={`font-black ${hrCriticalCount > 0 ? "text-rose-950" : "text-emerald-950"}`}>
                    {hrCriticalCount > 0 ? `有 ${hrCriticalCount} 類人資阻擋事項` : "目前沒有高優先阻擋"}
                  </h2>
                  <p className={`mt-2 text-sm leading-6 ${hrCriticalCount > 0 ? "text-rose-800" : "text-emerald-800"}`}>
                    {hrCriticalCount > 0 ? "請先處理補卡、出勤異常與薪資前置，否則薪資結算會卡住。" : "可進入例行的人員主檔、證照訓練與報表檢查。"}
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-[#ead8c2] bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-center gap-2">
                <Landmark className="h-5 w-5 text-[#b45309]" />
                <h2 className="font-black text-slate-950">結薪前阻擋</h2>
              </div>
              <div className="space-y-3">
                {[
                  ["補卡待審", stats.pendingPunchCorrections, "/punch-corrections"],
                  ["出勤異常", stats.attendanceAnomalies, "/attendance/anomalies"],
                  ["請假待審", stats.pendingLeaveRequests, "/approvals"],
                  ["加班待審", stats.pendingOvertimeRequests, "/approvals"],
                ].map(([label, value, href]) => (
                  <Link key={String(label)} href={String(href)} className="flex items-center justify-between rounded-lg bg-[#fffaf4] px-3 py-2 hover:bg-[#fff3de]">
                    <span className="text-sm font-bold text-slate-700">{label}</span>
                    <span className={`rounded-full px-2.5 py-1 text-xs font-black ${Number(value) > 0 ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700"}`}>
                      {String(value)} 件
                    </span>
                  </Link>
                ))}
              </div>
              <div className="mt-4 rounded-lg border border-[#ead8c2] bg-[#fffaf4] p-3 text-sm font-semibold text-[#7c3f00]">
                {payrollBlockers > 0 ? `目前有 ${payrollBlockers} 件資料會影響薪資，建議先清完再進入薪資結算。` : "薪資前置阻擋已清空，可以進入薪資結算流程。"}
              </div>
            </div>
          </div>
        </section>
      ) : null}

      <section className="grid gap-3 md:grid-cols-3">
        {priorityItems.slice(0, 3).map((item) => (
          <Link key={item.title} href={item.href} className={`rounded-lg border p-4 shadow-sm transition hover:shadow-md ${item.tone}`}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-black">{item.title}</h2>
                <p className="mt-2 text-sm leading-6">{item.detail}</p>
              </div>
              <ChevronRight className="h-4 w-4 shrink-0" />
            </div>
          </Link>
        ))}
      </section>

      <section className="rounded-lg border border-[#ead8c2] bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-bold tracking-[0.12em] text-[#b45309]">FIXED SITE HR OPERATIONS</p>
            <h2 className="mt-1 text-xl font-black text-slate-950">定點上班工作流</h2>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-500">
              目前版本先聚焦固定據點上班：08:00-08:30 或 08:30-09:00 到班、GPS/Wi-Fi/IP 打卡、補卡、假勤、薪資與評鑑資料，避免複雜排班干擾日常使用。
            </p>
          </div>
          <Link href="/assessment-exports" className="inline-flex items-center justify-center rounded-lg border border-[#ead8c2] bg-[#fffaf4] px-3 py-2 text-sm font-bold text-[#8a4b06] hover:border-[#d97706]">
            檢查評鑑資料
            <ChevronRight className="ml-1 h-4 w-4" />
          </Link>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {careWorkstreams.map((stream) => (
            <Link key={stream.key} href={stream.href} className="rounded-lg border border-[#ead8c2] bg-[#fffaf4] p-4 transition hover:border-[#d97706] hover:bg-white">
              <div className="flex items-start justify-between gap-3">
                <span className={`rounded-lg p-2 ${stream.tone}`}>
                  <stream.icon className="h-5 w-5" />
                </span>
                <span className="rounded-full bg-white px-2.5 py-1 text-xs font-bold text-slate-600">{stream.owner}</span>
              </div>
              <h3 className="mt-3 font-black text-slate-950">{stream.title}</h3>
              <p className="mt-1 text-xs leading-5 text-slate-500">{stream.description}</p>
              <div className="mt-3 space-y-1">
                {stream.checks.slice(0, 2).map((check) => (
                  <div key={check} className="flex items-start gap-2 text-xs text-slate-600">
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#b45309]" />
                    {check}
                  </div>
                ))}
              </div>
            </Link>
          ))}
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {careScenarios.map((scenario) => (
            <Link key={scenario.title} href={scenario.href} className="rounded-lg border border-slate-200 bg-white p-4 hover:border-[#d97706]">
              <div className="text-sm font-black text-slate-950">{scenario.title}</div>
              <p className="mt-2 text-xs leading-5 text-slate-500">{scenario.trigger}</p>
              <p className="mt-2 text-xs font-semibold leading-5 text-[#8a4b06]">{scenario.systemAction}</p>
            </Link>
          ))}
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {home.actions.map((action) => (
          <Link key={action.href} href={action.href} className="rounded-lg border border-[#ead8c2] bg-white p-4 shadow-sm transition hover:border-[#d97706] hover:shadow-md">
            <div className="flex items-start justify-between gap-3">
              <span className={`rounded-lg p-2 ${action.tone}`}>
                <action.icon className="h-5 w-5" />
              </span>
              <span className="rounded-full bg-[#fff3de] px-2.5 py-1 text-xs font-bold text-[#8a4b06]">{action.badge}</span>
            </div>
            <h2 className="mt-3 font-black text-slate-950">{action.title}</h2>
            <p className="mt-1 text-xs leading-5 text-slate-500">{action.description}</p>
          </Link>
        ))}
      </section>

      <section className="grid gap-5 xl:grid-cols-[1fr_380px]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CalendarCheck2 className="h-5 w-5 text-[#b45309]" />
              今天的工作順序
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            {[
              ["先處理急件", "待簽核、出勤異常、證照到期與未讀通知優先。", home.primaryHref],
              ["再完成例行工作", "打卡、表單、班表、員工主檔或薪資檢核。", currentUser.role === "team_member" ? "/employee-portal" : home.primaryHref],
              ["最後看報表", "用報表中心確認趨勢與跨據點資料。", "/analytics"],
              ["需要協助時", "回到角色入口，系統會依權限顯示下一步。", home.primaryHref],
            ].map(([title, detail, href]) => (
              <Link key={title} href={href} className="rounded-lg border border-[#ead8c2] bg-[#fffaf4] p-4 hover:border-[#d97706]">
                <div className="font-black text-slate-950">{title}</div>
                <p className="mt-2 text-sm leading-6 text-slate-500">{detail}</p>
              </Link>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bell className="h-5 w-5 text-[#b45309]" />
              快速狀態
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {statusItems.map((item) => (
              <div key={item.label} className="flex items-center justify-between rounded-lg bg-[#fffaf4] p-3">
                <div className="flex items-center gap-2 text-sm font-bold text-slate-700">
                  <item.icon className="h-4 w-4 text-[#b45309]" />
                  {item.label}
                </div>
                <div className="font-black text-slate-950">{item.value}</div>
              </div>
            ))}
          </CardContent>
        </Card>
      </section>

      <section className="rounded-lg border border-[#ead8c2] bg-white p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="mt-0.5 h-5 w-5 text-[#b45309]" />
          <div>
            <h2 className="font-black text-slate-950">首頁已改為角色工作流</h2>
            <p className="mt-1 text-sm leading-6 text-slate-500">
              之後新增功能時，請優先掛到對應角色的「今日工作」或「常用動作」，不要只新增側邊欄項目，這樣整套系統才會接近 104 / NUEIP 的使用感。
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
