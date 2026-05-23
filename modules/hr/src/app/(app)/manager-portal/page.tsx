"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  BarChart3,
  ChevronRight,
  ClipboardCheck,
  FileClock,
  RefreshCw,
  ShieldAlert,
  UsersRound,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { OperationFeedback } from "@/components/ui/operation-feedback";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import { type DemoWorkflowRequest } from "@/lib/requests/workflow-store";
import {
  emptyManagerStats,
  formatBackofficeWarnings,
  loadManagerBackofficeData,
  type ManagerStats,
} from "@/lib/supabase/backoffice-data";

type ManagerAction = {
  title: string;
  description: string;
  href: string;
  icon: LucideIcon;
  tone: string;
  count: string;
};

type ManagerTodo = {
  title: string;
  description: string;
  href: string;
  icon: LucideIcon;
  count: number;
  actionLabel: string;
  priority: "high" | "medium" | "normal";
};

function buildActionCards(stats: ManagerStats): ManagerAction[] {
  return [
    {
      title: "待簽核",
      description: "請假、加班、補卡一次處理",
      href: "/approvals",
      icon: ClipboardCheck,
      tone: stats.pendingApprovals > 0 ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-700",
      count: `${stats.pendingApprovals} 筆`,
    },
    {
      title: "出勤異常",
      description: "遲到、未打卡、位置異常",
      href: "/attendance/anomalies",
      icon: ShieldAlert,
      tone: stats.abnormalPunches > 0 ? "bg-rose-50 text-rose-700" : "bg-slate-100 text-slate-700",
      count: `${stats.abnormalPunches} 筆`,
    },
    {
      title: "補卡審核",
      description: "確認原因、時間與附件",
      href: "/punch-corrections",
      icon: FileClock,
      tone: stats.pendingPunchReviews > 0 ? "bg-cyan-50 text-cyan-700" : "bg-slate-100 text-slate-700",
      count: `${stats.pendingPunchReviews} 筆`,
    },
    {
      title: "部門名單",
      description: "安全視圖，只看管理必要欄位",
      href: "/employees",
      icon: UsersRound,
      tone: "bg-sky-50 text-sky-700",
      count: `${stats.departmentEmployees} 人`,
    },
    {
      title: "固定時段出勤",
      description: "看今日到班與遲到狀態",
      href: "/attendance",
      icon: AlertTriangle,
      tone: "bg-emerald-50 text-emerald-700",
      count: `${stats.upcomingSchedules} 筆`,
    },
    {
      title: "部門摘要",
      description: "只看主管必要統計",
      href: "/manager-portal",
      icon: BarChart3,
      tone: "bg-orange-50 text-orange-700",
      count: "安全視圖",
    },
  ];
}

function todoPriorityStyle(priority: ManagerTodo["priority"]) {
  if (priority === "high") return "border-rose-200 bg-rose-50 text-rose-800";
  if (priority === "medium") return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-emerald-200 bg-emerald-50 text-emerald-800";
}

function todoPriorityLabel(priority: ManagerTodo["priority"]) {
  if (priority === "high") return "優先處理";
  if (priority === "medium") return "今日處理";
  return "可稍後";
}

export default function ManagerPortalPage() {
  const currentUser = useCurrentUser();
  const [stats, setStats] = useState<ManagerStats>(emptyManagerStats);
  const [approvalTasks, setApprovalTasks] = useState<DemoWorkflowRequest[]>([]);
  const [loadMessage, setLoadMessage] = useState("正在同步主管端資料...");
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    if (!currentUser.id) return;
    void loadManagerData();
  }, [currentUser.id, currentUser.role, currentUser.departmentId]);

  async function loadManagerData() {
    setIsRefreshing(true);
    try {
      const result = await loadManagerBackofficeData(currentUser);
      setApprovalTasks(result.data.approvalTasks);
      setStats(result.data.stats);
      setLoadMessage(formatBackofficeWarnings(result.warnings) || "已同步 Supabase：簽核、部門員工、出勤、請假、加班與補卡資料。");
      setLastSyncedAt(new Date());
    } catch (error) {
      setLoadMessage(error instanceof Error ? error.message : "主管端資料同步失敗。");
    } finally {
      setIsRefreshing(false);
    }
  }

  const actionCards = useMemo(() => buildActionCards(stats), [stats]);
  const hasUrgentWork = stats.pendingApprovals + stats.abnormalPunches + stats.pendingPunchReviews > 0;
  const todoItems = useMemo<ManagerTodo[]>(
    () => [
      {
        title: "表單簽核",
        description: "請假、加班、補卡等申請正在等你決定。",
        href: "/approvals",
        icon: ClipboardCheck,
        count: stats.pendingApprovals,
        actionLabel: "去簽核",
        priority: stats.pendingApprovals >= 3 ? "high" : stats.pendingApprovals > 0 ? "medium" : "normal",
      },
      {
        title: "出勤待確認",
        description: "員工打卡位置或時間需要主管協助判斷。",
        href: "/attendance/anomalies",
        icon: ShieldAlert,
        count: stats.abnormalPunches,
        actionLabel: "處理出勤",
        priority: stats.abnormalPunches > 0 ? "high" : "normal",
      },
      {
        title: "補卡待審",
        description: "確認員工補卡原因、日期、時間與附件。",
        href: "/punch-corrections",
        icon: FileClock,
        count: stats.pendingPunchReviews,
        actionLabel: "審補卡",
        priority: stats.pendingPunchReviews > 0 ? "medium" : "normal",
      },
    ],
    [stats.abnormalPunches, stats.pendingApprovals, stats.pendingPunchReviews],
  );
  const sortedTodoItems = useMemo(
    () =>
      [...todoItems].sort((a, b) => {
        const priorityOrder = { high: 0, medium: 1, normal: 2 };
        return priorityOrder[a.priority] - priorityOrder[b.priority] || b.count - a.count;
      }),
    [todoItems],
  );
  const totalTodos = todoItems.reduce((sum, item) => sum + item.count, 0);
  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-[#ead8c2] bg-white shadow-sm">
        <div className="flex flex-col gap-3 p-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-sm font-bold tracking-[0.12em] text-[#b45309]">MANAGER PORTAL</p>
            <h1 className="mt-1 text-2xl font-black text-slate-950">主管待辦中心</h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-500">
              先把今天需要主管決定的事情處理完：簽核、補卡與出勤確認都集中在這裡。
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <Button variant="outline" onClick={() => void loadManagerData()} disabled={isRefreshing}>
              <RefreshCw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
              重新整理
            </Button>
            <Link href="/approvals" className="inline-flex items-center justify-center rounded-lg bg-[#b45309] px-4 py-2 text-sm font-bold text-white hover:bg-[#92400e]">
              處理待簽核
              <ChevronRight className="ml-1 h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1fr_320px]">
        <div className="rounded-lg border border-[#ead8c2] bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-[#ead8c2] p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-black tracking-[0.12em] text-[#b45309]">TODAY TODO</p>
              <h2 className="mt-1 text-xl font-black text-slate-950">今天等你處理</h2>
              <p className="mt-1 text-sm text-slate-500">
                共 {totalTodos} 件待辦，系統已依急迫性排序。
              </p>
            </div>
            <Link href="/approvals" className="inline-flex items-center justify-center rounded-lg bg-[#b45309] px-4 py-2 text-sm font-bold text-white hover:bg-[#92400e]">
              開始處理
              <ChevronRight className="ml-1 h-4 w-4" />
            </Link>
          </div>
          <div className="divide-y divide-slate-100">
            {sortedTodoItems.map((todo) => (
              <Link key={todo.title} href={todo.href} className="block p-4 transition hover:bg-[#fffaf4]">
                <div className="grid gap-3 md:grid-cols-[auto_1fr_auto] md:items-center">
                  <span className={`flex h-11 w-11 items-center justify-center rounded-lg ${todoPriorityStyle(todo.priority)}`}>
                    <todo.icon className="h-5 w-5" />
                  </span>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-black text-slate-950">{todo.title}</h3>
                      <span className={`rounded-full border px-2.5 py-1 text-xs font-black ${todoPriorityStyle(todo.priority)}`}>
                        {todoPriorityLabel(todo.priority)}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-slate-500">{todo.description}</p>
                  </div>
                  <div className="flex items-center justify-between gap-3 md:justify-end">
                    <div className="text-right">
                      <div className="text-2xl font-black text-slate-950">{todo.count}</div>
                      <div className="text-xs text-slate-500">件</div>
                    </div>
                    <span className="inline-flex items-center rounded-lg border border-[#ead8c2] bg-white px-3 py-2 text-sm font-bold text-[#8a4b06]">
                      {todo.actionLabel}
                      <ChevronRight className="ml-1 h-4 w-4" />
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-[#ead8c2] bg-[#fffaf4] p-5 shadow-sm">
          <p className="text-xs font-black tracking-[0.12em] text-[#b45309]">TODAY SUMMARY</p>
          <h2 className="mt-1 text-lg font-black text-slate-950">
            {hasUrgentWork ? "今天有待辦" : "今天很乾淨"}
          </h2>
          <p className="mt-2 text-sm text-slate-500">
            {hasUrgentWork ? "建議先處理紅色與黃色項目，避免影響員工出勤與薪資資料。" : "目前沒有主管急件，可以查看部門出勤或部門狀態。"}
          </p>
          <div className="mt-4 grid gap-2">
            {todoItems.map((item) => (
              <Link key={item.title} href={item.href} className="flex items-center justify-between rounded-lg bg-white px-3 py-2 text-sm">
                <span className="font-bold text-slate-700">{item.title}</span>
                <span className="font-black text-slate-950">{item.count}</span>
              </Link>
            ))}
          </div>
          <div className="mt-4 rounded-lg bg-white p-3 text-xs leading-5 text-slate-500">
            首頁只放主管需要立即判斷的事情；員工個資、薪資與完整報表不在主管首頁揭露。
          </div>
        </div>
      </section>

      <OperationFeedback
        title="資料同步"
        message={loadMessage}
        status={isRefreshing ? "loading" : undefined}
        updatedAt={lastSyncedAt ?? undefined}
        details={["簽核", "出勤確認", "補卡", "部門狀態"]}
        actionLabel="處理待辦"
        actionHref="/approvals"
      />

      <section className="space-y-3">
        <div>
          <h2 className="font-black text-slate-950">快速入口</h2>
          <p className="mt-1 text-sm text-slate-500">待辦處理完後，再進入部門名冊、出勤與摘要工具。</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {actionCards.map((action) => (
            <Link key={action.title} href={action.href} className="rounded-lg border border-[#ead8c2] bg-white p-4 shadow-sm transition hover:border-[#d97706] hover:shadow-md">
              <div className="flex items-start justify-between gap-3">
                <span className={`rounded-lg p-2 ${action.tone}`}>
                  <action.icon className="h-5 w-5" />
                </span>
                <span className="rounded-full bg-[#fff3de] px-2 py-1 text-xs font-bold text-[#8a4b06]">{action.count}</span>
              </div>
              <h2 className="mt-3 font-bold text-slate-950">{action.title}</h2>
              <p className="mt-1 text-xs leading-5 text-slate-500">{action.description}</p>
            </Link>
          ))}
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1fr_320px]">
        <div className="rounded-lg border border-[#ead8c2] bg-white shadow-sm">
          <div className="flex items-center justify-between gap-3 border-b border-[#ead8c2] p-4">
            <div>
              <h2 className="font-bold text-slate-950">待我簽核</h2>
              <p className="text-sm text-slate-500">只顯示最需要主管動手的前 3 筆。</p>
            </div>
            <ClipboardCheck className="h-5 w-5 text-[#b45309]" />
          </div>
          <div className="divide-y divide-slate-100">
            {approvalTasks.slice(0, 3).map((task) => (
              <Link key={task.id} href="/approvals" className="block p-4 hover:bg-[#fffaf4]">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-[#fff3de] px-2.5 py-1 text-xs font-bold text-[#8a4b06]">{task.type}</span>
                      <span className="font-bold text-slate-950">{task.applicant}</span>
                    </div>
                    <p className="mt-2 line-clamp-1 text-sm text-slate-600">{task.reason}</p>
                    <p className="mt-1 text-xs text-slate-500">{task.currentStep} · {task.submittedAt}</p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-slate-400" />
                </div>
              </Link>
            ))}
            {approvalTasks.length === 0 ? (
              <div className="p-5 text-sm text-slate-500">目前沒有輪到你簽核的表單。</div>
            ) : null}
          </div>
        </div>

        <div className="rounded-lg border border-[#ead8c2] bg-white p-4 shadow-sm">
          <h2 className="font-bold text-slate-950">本月部門狀態</h2>
          <div className="mt-3 space-y-2">
            {[
              ["部門人數", `${stats.departmentEmployees} 人`, "/employees"],
              ["請假待審", `${stats.leavePending} 筆`, "/approvals"],
              ["加班待審", `${stats.overtimePending} 筆`, "/approvals"],
              ["今日出勤", `${stats.upcomingSchedules} 筆`, "/attendance"],
            ].map(([label, value, href]) => (
              <Link key={label} href={href} className="flex items-center justify-between rounded-lg bg-[#fffaf4] px-3 py-2 text-sm hover:bg-[#fff3de]">
                <span className="text-slate-600">{label}</span>
                <span className="font-black text-slate-950">{value}</span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-[#ead8c2] bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="font-bold text-slate-950">主管常用</h2>
            <p className="mt-1 text-sm text-slate-500">
              部門名單採安全視圖；主管首頁只保留出勤、報表與部門名單，不展開不必要個資。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {[
              ["出勤異常", "/attendance/anomalies"],
              ["補卡審核", "/punch-corrections"],
              ["出勤報表", "/attendance/reports"],
              ["部門名單", "/employees"],
            ].map(([label, href]) => (
              <Link key={label} href={href} className="rounded-lg border border-[#ead8c2] bg-[#fffaf4] px-3 py-2 text-sm font-bold text-[#8a4b06] hover:border-[#d97706]">
                {label}
              </Link>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
