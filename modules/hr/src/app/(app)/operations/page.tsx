"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  ArchiveRestore,
  BellRing,
  CheckCircle2,
  Clock3,
  DatabaseBackup,
  MailWarning,
  RefreshCw,
  ServerCog,
  ShieldCheck,
  Siren,
  TimerReset,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { OperationFeedback } from "@/components/ui/operation-feedback";
import { can } from "@/lib/auth/rbac";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import { getLiveClient } from "@/lib/supabase/live-modules";
import { cn } from "@/lib/utils";

type JobRun = {
  id: string;
  jobKey: string;
  jobName: string;
  status: string;
  route: string;
  startedAt: string;
  completedAt: string;
  durationMs: number | null;
  errorMessage: string;
};

type BackupRun = {
  id: string;
  runType: string;
  status: string;
  healthStatus: string;
  checkedAt: string;
  latestBackupAt: string;
  evidenceUrl: string;
  notes: string;
};

type EmailDelivery = {
  id: string;
  subject: string;
  recipientEmail: string;
  status: string;
  attempts: number;
  nextAttemptAt: string;
  errorMessage: string;
};

type ErrorLog = {
  id: string;
  source: string;
  severity: string;
  message: string;
  createdAt: string;
};

const statusStyles: Record<string, string> = {
  completed: "border-emerald-200 bg-emerald-50 text-emerald-800",
  healthy: "border-emerald-200 bg-emerald-50 text-emerald-800",
  warning: "border-amber-200 bg-amber-50 text-amber-800",
  queued: "border-amber-200 bg-amber-50 text-amber-800",
  sending: "border-sky-200 bg-sky-50 text-sky-800",
  running: "border-sky-200 bg-sky-50 text-sky-800",
  sent: "border-emerald-200 bg-emerald-50 text-emerald-800",
  skipped: "border-slate-200 bg-slate-50 text-slate-700",
  blocked: "border-red-200 bg-red-50 text-red-800",
  failed: "border-rose-200 bg-rose-50 text-rose-800",
  config_missing: "border-orange-200 bg-orange-50 text-orange-800",
  unknown: "border-slate-200 bg-slate-50 text-slate-700",
};

function formatDate(value?: string | null) {
  if (!value) return "-";
  return new Date(value).toLocaleString("zh-TW", { hour12: false });
}

function statusClass(status: string) {
  return statusStyles[status] ?? statusStyles.unknown;
}

export default function OperationsPage() {
  const currentUser = useCurrentUser();
  const canOperate = can(currentUser.role, "system:settings");
  const [jobRuns, setJobRuns] = useState<JobRun[]>([]);
  const [backupRuns, setBackupRuns] = useState<BackupRun[]>([]);
  const [emailDeliveries, setEmailDeliveries] = useState<EmailDelivery[]>([]);
  const [errorLogs, setErrorLogs] = useState<ErrorLog[]>([]);
  const [feedback, setFeedback] = useState("正在讀取上線營運中心...");
  const [isLoading, setIsLoading] = useState(true);
  const [isRunning, setIsRunning] = useState<string | null>(null);

  useEffect(() => {
    void loadOperations();
  }, [currentUser.companyId]);

  const summary = useMemo(() => {
    const failedJobs = jobRuns.filter((item) => ["failed", "blocked"].includes(item.status)).length;
    const emailFailures = emailDeliveries.filter((item) => ["failed", "config_missing"].includes(item.status)).length;
    const emailQueued = emailDeliveries.filter((item) => ["queued", "sending"].includes(item.status)).length;
    const backupRisk = backupRuns.filter((item) => ["blocked", "failed"].includes(item.healthStatus || item.status)).length;
    const severeErrors = errorLogs.filter((item) => ["error", "critical"].includes(item.severity)).length;
    const blockers = failedJobs + emailFailures + backupRisk + severeErrors;
    return {
      blockers,
      failedJobs,
      emailFailures,
      emailQueued,
      backupRisk,
      severeErrors,
      ready: blockers === 0,
    };
  }, [backupRuns, emailDeliveries, errorLogs, jobRuns]);

  async function loadOperations() {
    setIsLoading(true);
    const supabase = getLiveClient();
    try {
      let jobQuery = supabase
        .from("background_job_runs")
        .select("id, job_key, job_name, status, route, started_at, completed_at, duration_ms, error_message")
        .is("deleted_at", null)
        .order("started_at", { ascending: false })
        .limit(20);
      let backupQuery = supabase
        .from("backup_restore_runs")
        .select("id, run_type, status, health_status, checked_at, latest_backup_at, evidence_url, notes")
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(10);
      let emailQuery = supabase
        .from("notification_email_deliveries")
        .select("id, subject, recipient_email, status, attempts, next_attempt_at, error_message")
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(20);
      let errorQuery = supabase
        .from("error_logs")
        .select("id, source, severity, message, created_at")
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(20);

      if (currentUser.companyId) {
        jobQuery = jobQuery.eq("company_id", currentUser.companyId);
        backupQuery = backupQuery.eq("company_id", currentUser.companyId);
        emailQuery = emailQuery.eq("company_id", currentUser.companyId);
        errorQuery = errorQuery.eq("company_id", currentUser.companyId);
      }

      const [jobs, backups, emails, errors] = await Promise.all([jobQuery, backupQuery, emailQuery, errorQuery]);
      const firstError = jobs.error ?? backups.error ?? emails.error ?? errors.error;
      if (firstError) throw firstError;

      setJobRuns(((jobs.data ?? []) as any[]).map((row) => ({
        id: row.id,
        jobKey: row.job_key,
        jobName: row.job_name,
        status: row.status ?? "unknown",
        route: row.route ?? "-",
        startedAt: formatDate(row.started_at),
        completedAt: formatDate(row.completed_at),
        durationMs: row.duration_ms ?? null,
        errorMessage: row.error_message ?? "",
      })));
      setBackupRuns(((backups.data ?? []) as any[]).map((row) => ({
        id: row.id,
        runType: row.run_type ?? "scheduled_backup",
        status: row.status ?? "unknown",
        healthStatus: row.health_status ?? row.status ?? "unknown",
        checkedAt: formatDate(row.checked_at),
        latestBackupAt: formatDate(row.latest_backup_at),
        evidenceUrl: row.evidence_url ?? "",
        notes: row.notes ?? "",
      })));
      setEmailDeliveries(((emails.data ?? []) as any[]).map((row) => ({
        id: row.id,
        subject: row.subject ?? "未命名通知",
        recipientEmail: row.recipient_email ?? "未設定 Email",
        status: row.status ?? "unknown",
        attempts: Number(row.attempts ?? 0),
        nextAttemptAt: formatDate(row.next_attempt_at),
        errorMessage: row.error_message ?? "",
      })));
      setErrorLogs(((errors.data ?? []) as any[]).map((row) => ({
        id: row.id,
        source: row.source ?? "system",
        severity: row.severity ?? "warning",
        message: row.message ?? "未命名錯誤",
        createdAt: formatDate(row.created_at),
      })));
      setFeedback("上線營運資料已同步。請優先處理紅色阻擋，再開放正式營運。");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "上線營運中心讀取失敗。");
    } finally {
      setIsLoading(false);
    }
  }

  async function runOperation(label: string, route: string) {
    if (!canOperate) {
      setFeedback("此帳號沒有執行上線營運工具的權限。");
      return;
    }
    setIsRunning(label);
    setFeedback(`正在執行：${label}...`);
    try {
      const response = await fetch(route, { method: "POST" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? payload.errors?.join("；") ?? `${label} 執行失敗。`);
      setFeedback(`${label} 已完成。`);
      await loadOperations();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : `${label} 執行失敗。`);
    } finally {
      setIsRunning(null);
    }
  }

  const launchChecklist = [
    { label: "背景排程最近一輪成功", ok: summary.failedJobs === 0 && jobRuns.length > 0, href: "#jobs" },
    { label: "Email 佇列沒有失敗或設定缺漏", ok: summary.emailFailures === 0, href: "/notifications" },
    { label: "備份健康檢查沒有阻擋", ok: summary.backupRisk === 0 && backupRuns.length > 0, href: "/security" },
    { label: "錯誤紀錄沒有重大未排除", ok: summary.severeErrors === 0, href: "#errors" },
    { label: "告警中心已同步", ok: true, href: "/alerts" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-black text-amber-700">
            <ServerCog className="h-4 w-4" />
            Production Operations
          </div>
          <h1 className="mt-2 text-3xl font-black text-slate-950">上線營運中心</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
            集中監控背景排程、Email 佇列、備份健康、錯誤紀錄與告警同步。正式上線後，行政主任、人資與執行長可以在這裡先判斷系統是否可以安全營運。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={loadOperations} disabled={isLoading}>
            <RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} />
            重新讀取
          </Button>
          <Button type="button" onClick={() => runOperation("背景排程總控", "/api/background/scheduler")} disabled={Boolean(isRunning)}>
            <Activity className={cn("h-4 w-4", isRunning === "背景排程總控" && "animate-pulse")} />
            執行總控
          </Button>
        </div>
      </div>

      <OperationFeedback
        title="上線營運狀態"
        message={feedback}
        status={isLoading || isRunning ? "loading" : summary.ready ? "success" : "blocked"}
        details={[
          `阻擋 ${summary.blockers}`,
          `Email 待寄 ${summary.emailQueued}`,
          `排程失敗 ${summary.failedJobs}`,
          `重大錯誤 ${summary.severeErrors}`,
        ]}
      />

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        {[
          { label: "上線阻擋", value: summary.blockers, icon: ShieldCheck, tone: summary.ready ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-800" },
          { label: "排程失敗", value: summary.failedJobs, icon: TimerReset, tone: "border-rose-200 bg-rose-50 text-rose-800" },
          { label: "Email 失敗", value: summary.emailFailures, icon: MailWarning, tone: "border-orange-200 bg-orange-50 text-orange-800" },
          { label: "備份風險", value: summary.backupRisk, icon: DatabaseBackup, tone: "border-amber-200 bg-amber-50 text-amber-800" },
          { label: "重大錯誤", value: summary.severeErrors, icon: AlertTriangle, tone: "border-slate-200 bg-white text-slate-800" },
        ].map((metric) => (
          <Card key={metric.label} className={metric.tone}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <p className="text-xs font-black">{metric.label}</p>
                <metric.icon className="h-4 w-4" />
              </div>
              <p className="mt-3 text-3xl font-black">{metric.value}</p>
            </CardContent>
          </Card>
        ))}
      </section>

      <section className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
        <Card>
          <CardHeader>
            <CardTitle>上線前營運檢核</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {launchChecklist.map((item) => (
              <Link
                key={item.label}
                href={item.href}
                className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-black text-slate-700 hover:border-amber-300 hover:bg-amber-50"
              >
                <span className="flex items-center gap-2">
                  {item.ok ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <AlertTriangle className="h-4 w-4 text-rose-600" />}
                  {item.label}
                </span>
                <span className={cn("rounded-full px-2.5 py-1 text-xs", item.ok ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700")}>
                  {item.ok ? "通過" : "需處理"}
                </span>
              </Link>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>營運工具快捷操作</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            {[
              { label: "同步告警中心", route: "/api/alerts/sync", icon: Siren, detail: "重新掃描薪資、通知、排程與錯誤" },
              { label: "處理 Email 佇列", route: "/api/notifications/email-worker", icon: BellRing, detail: "寄送 queued / failed Email" },
              { label: "備份健康檢查", route: "/api/security/backup-worker", icon: ArchiveRestore, detail: "確認 Supabase 備份證據" },
              { label: "背景排程總控", route: "/api/background/scheduler", icon: Activity, detail: "強制跑所有排程任務" },
            ].map((tool) => (
              <button
                key={tool.label}
                type="button"
                onClick={() => runOperation(tool.label, tool.route)}
                disabled={!canOperate || Boolean(isRunning)}
                className="rounded-lg border border-slate-200 bg-white p-4 text-left hover:border-amber-300 hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <div className="flex items-center gap-2 text-sm font-black text-slate-950">
                  <tool.icon className={cn("h-4 w-4 text-amber-700", isRunning === tool.label && "animate-pulse")} />
                  {tool.label}
                </div>
                <p className="mt-2 text-xs leading-5 text-slate-500">{tool.detail}</p>
              </button>
            ))}
          </CardContent>
        </Card>
      </section>

      <section id="jobs" className="grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>背景排程執行紀錄</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {jobRuns.length ? jobRuns.slice(0, 8).map((job) => (
              <div key={job.id} className="rounded-lg border border-slate-200 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-black text-slate-950">{job.jobName}</p>
                    <p className="mt-1 text-xs text-slate-500">{job.route}</p>
                  </div>
                  <span className={cn("rounded-full border px-2.5 py-1 text-xs font-black", statusClass(job.status))}>{job.status}</span>
                </div>
                <div className="mt-3 grid gap-2 text-xs text-slate-500 sm:grid-cols-3">
                  <span>開始：{job.startedAt}</span>
                  <span>完成：{job.completedAt}</span>
                  <span>耗時：{job.durationMs ?? "-"} ms</span>
                </div>
                {job.errorMessage ? <p className="mt-2 text-xs font-semibold text-rose-700">{job.errorMessage}</p> : null}
              </div>
            )) : <p className="rounded-lg border border-dashed border-slate-200 p-4 text-sm font-semibold text-slate-500">尚無背景排程紀錄，請先執行總控。</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>備份健康檢查</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {backupRuns.length ? backupRuns.slice(0, 6).map((backup) => (
              <div key={backup.id} className="rounded-lg border border-slate-200 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-black text-slate-950">{backup.runType}</p>
                    <p className="mt-1 text-xs text-slate-500">檢查：{backup.checkedAt} · 最近備份：{backup.latestBackupAt}</p>
                  </div>
                  <span className={cn("rounded-full border px-2.5 py-1 text-xs font-black", statusClass(backup.healthStatus))}>{backup.healthStatus}</span>
                </div>
                {backup.notes ? <p className="mt-2 text-xs leading-5 text-slate-600">{backup.notes}</p> : null}
                {backup.evidenceUrl ? <a className="mt-2 inline-block text-xs font-black text-amber-700" href={backup.evidenceUrl} target="_blank" rel="noreferrer">查看備份證據</a> : null}
              </div>
            )) : <p className="rounded-lg border border-dashed border-slate-200 p-4 text-sm font-semibold text-slate-500">尚無備份健康檢查紀錄。</p>}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Email 佇列快照</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {emailDeliveries.length ? emailDeliveries.slice(0, 8).map((email) => (
              <div key={email.id} className="rounded-lg border border-slate-200 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-black text-slate-950">{email.subject}</p>
                    <p className="mt-1 text-xs text-slate-500">{email.recipientEmail}</p>
                  </div>
                  <span className={cn("rounded-full border px-2.5 py-1 text-xs font-black", statusClass(email.status))}>{email.status}</span>
                </div>
                <p className="mt-2 text-xs text-slate-500">嘗試 {email.attempts} 次 · 下次重試 {email.nextAttemptAt}</p>
                {email.errorMessage ? <p className="mt-2 text-xs font-semibold text-rose-700">{email.errorMessage}</p> : null}
              </div>
            )) : <p className="rounded-lg border border-dashed border-slate-200 p-4 text-sm font-semibold text-slate-500">目前沒有 Email 佇列。</p>}
          </CardContent>
        </Card>

        <Card id="errors">
          <CardHeader>
            <CardTitle>最近錯誤紀錄</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {errorLogs.length ? errorLogs.slice(0, 8).map((log) => (
              <div key={log.id} className="rounded-lg border border-slate-200 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-black text-slate-950">{log.source}</p>
                    <p className="mt-1 text-xs text-slate-500">{log.createdAt}</p>
                  </div>
                  <span className={cn("rounded-full border px-2.5 py-1 text-xs font-black", statusClass(log.severity))}>{log.severity}</span>
                </div>
                <p className="mt-2 text-sm leading-6 text-slate-600">{log.message}</p>
              </div>
            )) : <p className="rounded-lg border border-dashed border-slate-200 p-4 text-sm font-semibold text-slate-500">目前沒有錯誤紀錄。</p>}
          </CardContent>
        </Card>
      </section>

      <section className="rounded-lg border border-amber-200 bg-amber-50 p-5">
        <div className="flex items-start gap-3">
          <Clock3 className="mt-0.5 h-5 w-5 text-amber-700" />
          <div>
            <h2 className="font-black text-amber-950">正式營運提醒</h2>
            <p className="mt-2 text-sm leading-6 text-amber-800">
              這一頁負責「看系統是否能營運」，不是取代各模組細節。若看到阻擋，請依序回到通知中心、資安與權限、異常告警、薪資結算處理來源問題，再重新執行總控。
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
