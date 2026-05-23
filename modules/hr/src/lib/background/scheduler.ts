import { syncAlertCenter } from "@/lib/alerts/alert-center";
import { processNotificationEmailQueue } from "@/lib/notifications/email-worker";
import { processBackupAutomation } from "@/lib/security/backup-worker";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

type JobKey = "notification_email_queue" | "backup_health_check" | "alert_center_sync";
type JobStatus = "completed" | "failed" | "blocked" | "skipped";

type JobDefinition = {
  key: JobKey;
  name: string;
  schedule: string;
  intervalMinutes: number;
  route: string;
  run: () => Promise<Record<string, unknown> & { ok?: boolean; configMissing?: boolean; errors?: string[] }>;
};

type RunRow = {
  id: string;
};

type LatestRunRow = {
  completed_at: string | null;
  started_at: string | null;
  status: string;
};

type SchedulerClient = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: unknown) => {
        is: (column: string, value: unknown) => {
          order: (column: string, options: { ascending: boolean }) => {
            limit: (count: number) => Promise<{ data: LatestRunRow[] | null; error: { message: string } | null }>;
          };
        };
      };
    };
    insert: (payload: Record<string, unknown>) => {
      select: (columns: string) => {
        single: () => Promise<{ data: RunRow | null; error: { message: string } | null }>;
      };
    };
    update: (payload: Record<string, unknown>) => {
      eq: (column: string, value: unknown) => Promise<{ error: { message: string } | null }>;
    };
  };
};

export type BackgroundSchedulerResult = {
  ok: boolean;
  startedAt: string;
  completedAt: string;
  jobs: Array<{
    key: JobKey;
    name: string;
    status: JobStatus;
    skippedReason?: string;
    durationMs: number;
    result?: Record<string, unknown>;
    error?: string;
  }>;
  errors: string[];
};

const jobs: JobDefinition[] = [
  {
    key: "notification_email_queue",
    name: "Email 通知佇列",
    schedule: "*/5 * * * *",
    intervalMinutes: 5,
    route: "/api/notifications/email-worker",
    run: () => processNotificationEmailQueue() as Promise<Record<string, unknown> & { ok?: boolean; configMissing?: boolean; errors?: string[] }>,
  },
  {
    key: "backup_health_check",
    name: "每日備份健康檢查",
    schedule: "30 18 * * *",
    intervalMinutes: 1440,
    route: "/api/security/backup-worker",
    run: () => processBackupAutomation() as Promise<Record<string, unknown> & { ok?: boolean; configMissing?: boolean; errors?: string[] }>,
  },
  {
    key: "alert_center_sync",
    name: "異常告警中心同步",
    schedule: "*/15 * * * *",
    intervalMinutes: 15,
    route: "/api/alerts/sync",
    run: () => syncAlertCenter() as Promise<Record<string, unknown> & { ok?: boolean; configMissing?: boolean; errors?: string[] }>,
  },
];

export async function runBackgroundScheduler({ force = false }: { force?: boolean } = {}): Promise<BackgroundSchedulerResult> {
  const startedAt = new Date();
  const supabase = getSupabaseAdminClient();
  const errors: string[] = [];
  const results: BackgroundSchedulerResult["jobs"] = [];

  if (!supabase) {
    return {
      ok: false,
      startedAt: startedAt.toISOString(),
      completedAt: new Date().toISOString(),
      jobs: [],
      errors: ["SUPABASE_SERVICE_ROLE_KEY 或 NEXT_PUBLIC_SUPABASE_URL 尚未設定，背景排程無法寫入執行紀錄。"],
    };
  }

  const client = supabase as unknown as SchedulerClient;

  for (const job of jobs) {
    const jobStartedAt = new Date();
    const due = force ? { due: true as const } : await isJobDue(client, job, jobStartedAt);

    if (!due.due) {
      results.push({
        key: job.key,
        name: job.name,
        status: "skipped",
        skippedReason: due.reason,
        durationMs: 0,
      });
      continue;
    }

    const run = await createRun(client, job, jobStartedAt);
    if (!run) {
      const message = `${job.name} 無法建立 background_job_runs。`;
      errors.push(message);
      results.push({ key: job.key, name: job.name, status: "failed", durationMs: 0, error: message });
      continue;
    }

    try {
      const result = await job.run();
      const status: JobStatus = result.ok === false ? result.configMissing ? "blocked" : "failed" : "completed";
      const completedAt = new Date();
      const durationMs = completedAt.getTime() - jobStartedAt.getTime();
      const errorMessage = normalizeErrors(result.errors) ?? (status === "failed" ? `${job.name} 執行失敗。` : null);

      await finishRun(client, run.id, {
        status,
        completedAt,
        durationMs,
        result,
        errorMessage,
      });

      if (errorMessage) errors.push(errorMessage);
      results.push({ key: job.key, name: job.name, status, durationMs, result, error: errorMessage ?? undefined });
    } catch (error) {
      const completedAt = new Date();
      const durationMs = completedAt.getTime() - jobStartedAt.getTime();
      const message = error instanceof Error ? error.message : `${job.name} 發生未知錯誤。`;
      await finishRun(client, run.id, {
        status: "failed",
        completedAt,
        durationMs,
        result: { ok: false },
        errorMessage: message,
      });
      errors.push(message);
      results.push({ key: job.key, name: job.name, status: "failed", durationMs, error: message });
    }
  }

  return {
    ok: errors.length === 0,
    startedAt: startedAt.toISOString(),
    completedAt: new Date().toISOString(),
    jobs: results,
    errors,
  };
}

async function isJobDue(client: SchedulerClient, job: JobDefinition, now: Date) {
  const { data, error } = await client
    .from("background_job_runs")
    .select("completed_at, started_at, status")
    .eq("job_key", job.key)
    .is("deleted_at", null)
    .order("started_at", { ascending: false })
    .limit(1);

  if (error) return { due: true as const };
  const latest = data?.[0];
  if (!latest) return { due: true as const };
  if (latest.status === "running") return { due: false as const, reason: "上一輪仍在執行中。" };

  const lastTime = latest.completed_at ?? latest.started_at;
  if (!lastTime) return { due: true as const };

  const elapsedMinutes = Math.floor((now.getTime() - new Date(lastTime).getTime()) / 60000);
  if (elapsedMinutes >= job.intervalMinutes) return { due: true as const };

  return {
    due: false as const,
    reason: `尚未到排程時間，還需 ${job.intervalMinutes - elapsedMinutes} 分鐘。`,
  };
}

async function createRun(client: SchedulerClient, job: JobDefinition, startedAt: Date) {
  const { data, error } = await client
    .from("background_job_runs")
    .insert({
      job_key: job.key,
      job_name: job.name,
      job_type: "cron",
      status: "running",
      schedule: job.schedule,
      route: job.route,
      started_at: startedAt.toISOString(),
      locked_until: new Date(startedAt.getTime() + 10 * 60 * 1000).toISOString(),
      metadata: { source: "background_scheduler" },
    })
    .select("id")
    .single();

  if (error || !data) return null;
  return data;
}

async function finishRun(
  client: SchedulerClient,
  id: string,
  input: {
    status: JobStatus;
    completedAt: Date;
    durationMs: number;
    result: Record<string, unknown>;
    errorMessage: string | null;
  },
) {
  await client
    .from("background_job_runs")
    .update({
      status: input.status,
      completed_at: input.completedAt.toISOString(),
      duration_ms: input.durationMs,
      locked_until: null,
      error_message: input.errorMessage,
      result: input.result,
    })
    .eq("id", id);
}

function normalizeErrors(errors?: string[]) {
  if (!errors?.length) return null;
  return errors.join("；");
}
