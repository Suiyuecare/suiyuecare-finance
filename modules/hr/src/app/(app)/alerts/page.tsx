"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  BellRing,
  CheckCircle2,
  ChevronRight,
  Clock3,
  FileWarning,
  MailWarning,
  RefreshCw,
  ShieldAlert,
  Siren,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { OperationFeedback } from "@/components/ui/operation-feedback";
import type { AlertCenterItem, AlertCenterSummary, AlertSeverity, AlertStatus } from "@/lib/alerts/alert-center";
import { can } from "@/lib/auth/rbac";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import { cn } from "@/lib/utils";

type AlertResponse = {
  items: AlertCenterItem[];
  summary: AlertCenterSummary;
};

const severityLabels: Record<AlertSeverity, string> = {
  info: "提示",
  warning: "需處理",
  critical: "重大",
  blocking: "已阻擋",
};

const statusLabels: Record<AlertStatus, string> = {
  open: "未處理",
  acknowledged: "已確認",
  in_progress: "處理中",
  resolved: "已結案",
  dismissed: "不處理",
};

const sourceLabels: Record<string, string> = {
  attendance: "出勤",
  payroll: "薪資",
  license: "證照",
  compliance: "法遵",
  notification: "通知",
  background_job: "排程",
  security: "系統",
  file_generation: "檔案",
};

const severityStyles: Record<AlertSeverity, string> = {
  info: "border-sky-200 bg-sky-50 text-sky-950",
  warning: "border-amber-200 bg-amber-50 text-amber-950",
  critical: "border-rose-200 bg-rose-50 text-rose-950",
  blocking: "border-red-300 bg-red-50 text-red-950",
};

const sourceIcons: Record<string, typeof ShieldAlert> = {
  attendance: ShieldAlert,
  payroll: FileWarning,
  license: AlertTriangle,
  notification: MailWarning,
  background_job: RefreshCw,
  security: Siren,
  file_generation: FileWarning,
};

export default function AlertCenterPage() {
  const { role } = useCurrentUser();
  const canManage = can(role, "compliance:manage");
  const [items, setItems] = useState<AlertCenterItem[]>([]);
  const [summary, setSummary] = useState<AlertCenterSummary>({ totalOpen: 0, blocking: 0, critical: 0, warning: 0, bySource: {} });
  const [sourceFilter, setSourceFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("active");
  const [feedback, setFeedback] = useState("正在讀取異常告警中心...");
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);

  useEffect(() => {
    void loadAlerts();
  }, []);

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      const sourceMatched = sourceFilter === "all" || item.source_type === sourceFilter;
      const statusMatched =
        statusFilter === "all"
          ? true
          : statusFilter === "active"
            ? !["resolved", "dismissed"].includes(item.status)
            : item.status === statusFilter;
      return sourceMatched && statusMatched;
    });
  }, [items, sourceFilter, statusFilter]);

  async function loadAlerts() {
    setIsLoading(true);
    try {
      const response = await fetch("/api/alerts", { cache: "no-store" });
      const payload = await response.json() as AlertResponse | { error?: string };
      if (!response.ok || "error" in payload) throw new Error("error" in payload ? payload.error : "讀取失敗");
      const alertPayload = payload as AlertResponse;
      setItems(alertPayload.items);
      setSummary(alertPayload.summary);
      setFeedback(alertPayload.items.length ? `已讀取 ${alertPayload.items.length} 筆告警，請先處理阻擋與重大項目。` : "目前沒有未處理告警，系統狀態穩定。");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "異常告警中心讀取失敗。");
    } finally {
      setIsLoading(false);
    }
  }

  async function syncAlerts() {
    setIsSyncing(true);
    setFeedback("正在同步最新異常來源...");
    try {
      const response = await fetch("/api/alerts/sync", { method: "POST" });
      const payload = await response.json() as { generated?: number; errors?: string[]; error?: string };
      if (!response.ok) throw new Error(payload.error ?? payload.errors?.join("；") ?? "同步失敗");
      setFeedback(`同步完成，已更新 ${payload.generated ?? 0} 筆來源告警。`);
      await loadAlerts();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "同步失敗。");
    } finally {
      setIsSyncing(false);
    }
  }

  async function updateStatus(alertId: string, status: AlertStatus) {
    setFeedback("正在更新告警狀態...");
    try {
      const response = await fetch("/api/alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alertId, status }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "狀態更新失敗");
      setFeedback(status === "resolved" ? "告警已結案。" : "告警狀態已更新。");
      await loadAlerts();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "狀態更新失敗。");
    }
  }

  const sourceOptions = [
    { key: "all", label: "全部" },
    ...Object.entries(summary.bySource).map(([key, count]) => ({ key, label: `${sourceLabels[key] ?? key} ${count}` })),
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-black text-orange-600">
            <Siren className="h-4 w-4" />
            HRIS 風險收斂
          </div>
          <h1 className="mt-2 text-3xl font-black text-slate-950">異常告警中心</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
            集中追蹤出勤異常、薪資阻擋、證照缺口、Email 失敗、背景排程與系統錯誤，讓人資先處理會影響結薪、法遵與上線穩定的項目。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={loadAlerts} disabled={isLoading}>
            <RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} />
            重新讀取
          </Button>
          {canManage ? (
            <Button type="button" onClick={syncAlerts} disabled={isSyncing}>
              <BellRing className={cn("h-4 w-4", isSyncing && "animate-pulse")} />
              同步告警
            </Button>
          ) : null}
        </div>
      </div>

      <OperationFeedback
        title="告警中心狀態"
        message={feedback}
        status={isLoading || isSyncing ? "loading" : summary.blocking + summary.critical > 0 ? "blocked" : summary.warning > 0 ? "warning" : "success"}
        details={[
          `未處理 ${summary.totalOpen}`,
          `阻擋 ${summary.blocking}`,
          `重大 ${summary.critical}`,
          `需處理 ${summary.warning}`,
        ]}
      />

      <div className="grid gap-3 md:grid-cols-4">
        {[
          { label: "未處理告警", value: summary.totalOpen, detail: "所有尚未結案項目", tone: "border-slate-200 bg-white" },
          { label: "阻擋項", value: summary.blocking, detail: "不可結薪/不可發布", tone: "border-red-200 bg-red-50" },
          { label: "重大項", value: summary.critical, detail: "需優先排除", tone: "border-rose-200 bg-rose-50" },
          { label: "一般警示", value: summary.warning, detail: "需確認與追蹤", tone: "border-amber-200 bg-amber-50" },
        ].map((metric) => (
          <Card key={metric.label} className={metric.tone}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-black text-slate-600">{metric.label}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-black text-slate-950">{metric.value}</div>
              <div className="mt-1 text-xs font-semibold text-slate-500">{metric.detail}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="space-y-4 p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap gap-2">
              {sourceOptions.map((source) => (
                <button
                  key={source.key}
                  type="button"
                  onClick={() => setSourceFilter(source.key)}
                  className={cn(
                    "rounded-full border px-3 py-2 text-sm font-black",
                    sourceFilter === source.key ? "border-orange-300 bg-orange-50 text-orange-700" : "border-slate-200 bg-white text-slate-600",
                  )}
                >
                  {source.label}
                </button>
              ))}
            </div>
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700"
            >
              <option value="active">未結案</option>
              <option value="open">未處理</option>
              <option value="acknowledged">已確認</option>
              <option value="in_progress">處理中</option>
              <option value="resolved">已結案</option>
              <option value="dismissed">不處理</option>
              <option value="all">全部狀態</option>
            </select>
          </div>

          <div className="grid gap-3">
            {filteredItems.length ? filteredItems.map((item) => {
              const Icon = sourceIcons[item.source_type] ?? ShieldAlert;
              return (
                <div
                  key={item.id}
                  className={cn(
                    "rounded-lg border p-4 shadow-sm",
                    severityStyles[item.severity],
                  )}
                >
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/80">
                          <Icon className="h-5 w-5" />
                        </span>
                        <span className="rounded-full bg-white/80 px-2.5 py-1 text-xs font-black">
                          {sourceLabels[item.source_type] ?? item.source_type}
                        </span>
                        <span className="rounded-full bg-white/80 px-2.5 py-1 text-xs font-black">
                          {severityLabels[item.severity]}
                        </span>
                        <span className="rounded-full bg-white/80 px-2.5 py-1 text-xs font-black">
                          {statusLabels[item.status]}
                        </span>
                        <span className="inline-flex items-center gap-1 text-xs font-bold opacity-75">
                          <Clock3 className="h-3.5 w-3.5" />
                          {new Date(item.detected_at).toLocaleString("zh-TW", { hour12: false })}
                        </span>
                      </div>
                      <h2 className="mt-3 text-lg font-black text-slate-950">{item.title}</h2>
                      <p className="mt-1 text-sm leading-6 text-slate-700">{item.description}</p>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      {item.action_href ? (
                        <Button asChild variant="outline">
                          <Link href={item.action_href}>
                            {item.action_label ?? "前往處理"}
                            <ChevronRight className="h-4 w-4" />
                          </Link>
                        </Button>
                      ) : null}
                      {canManage && item.status === "open" ? (
                        <Button type="button" variant="outline" onClick={() => updateStatus(item.id, "acknowledged")}>
                          已確認
                        </Button>
                      ) : null}
                      {canManage && !["resolved", "dismissed"].includes(item.status) ? (
                        <Button type="button" onClick={() => updateStatus(item.id, "resolved")}>
                          <CheckCircle2 className="h-4 w-4" />
                          結案
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            }) : (
              <EmptyState
                icon={CheckCircle2}
                title="目前沒有符合條件的告警"
                description="切換來源或狀態篩選，或重新同步最新資料。若仍沒有資料，代表目前沒有出勤、薪資、證照、通知或系統層級的未處理風險。"
                primaryAction={canManage ? { label: "同步告警", onClick: syncAlerts } : undefined}
                secondaryAction={{ label: "看資安中心", href: "/security" }}
              />
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
