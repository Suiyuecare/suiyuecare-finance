import { getSupabaseAdminClient } from "@/lib/supabase/admin";

type DeliveryRow = {
  id: string;
  company_id: string | null;
  notification_id: string;
  event_id: string | null;
  recipient_user_id: string | null;
  recipient_email: string | null;
  subject: string;
  attempts: number;
  metadata: Record<string, unknown> | null;
  notifications: {
    title: string;
    content: string;
    source_module: string | null;
    action_url: string | null;
    metadata: Record<string, unknown> | null;
  } | null;
  users: {
    display_name: string | null;
    email: string | null;
  } | null;
};

type WorkerResult = {
  ok: boolean;
  processed: number;
  sent: number;
  failed: number;
  skipped: number;
  configMissing: boolean;
  errors: string[];
};

type DbError = { message: string };

type SelectQueueBuilder = {
  in: (column: string, values: string[]) => SelectQueueBuilder;
  lte: (column: string, value: string) => SelectQueueBuilder;
  is: (column: string, value: null) => SelectQueueBuilder;
  order: (column: string, options: { ascending: boolean }) => SelectQueueBuilder;
  limit: (count: number) => Promise<{ data: unknown[] | null; error: DbError | null }>;
};

type UpdateBuilder = {
  eq: (column: string, value: string) => Promise<{ error: DbError | null }>;
};

type WorkerSupabaseClient = {
  from: (table: string) => {
    select: (columns: string) => SelectQueueBuilder;
    update: (payload: Record<string, unknown>) => UpdateBuilder;
  };
};

const defaultBatchSize = 25;
const retryBackoffMinutes = [5, 15, 60, 240, 720];

function getAppUrl() {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL;
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    const url = process.env.VERCEL_PROJECT_PRODUCTION_URL;
    return url.startsWith("http") ? url : `https://${url}`;
  }
  return "http://127.0.0.1:3001";
}

function getWorkerConfig() {
  return {
    resendApiKey: process.env.RESEND_API_KEY,
    from: process.env.EMAIL_FROM || "歲悅長照 HRIS <no-reply@suiyuecare.com>",
    replyTo: process.env.EMAIL_REPLY_TO || process.env.SECURITY_ALERT_EMAIL || undefined,
    batchSize: Number(process.env.EMAIL_WORKER_BATCH_SIZE || defaultBatchSize),
    appUrl: getAppUrl(),
  };
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function buildEmailHtml(delivery: DeliveryRow, appUrl: string) {
  const notification = delivery.notifications;
  const recipientName = delivery.users?.display_name || "您好";
  const title = notification?.title || delivery.subject;
  const content = notification?.content || "";
  const sourceModule = notification?.source_module || "HRIS 通知中心";
  const actionUrl = notification?.action_url
    ? new URL(notification.action_url, appUrl).toString()
    : new URL("/notifications", appUrl).toString();

  return `<!doctype html>
<html lang="zh-Hant">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
  </head>
  <body style="margin:0;background:#fbfaf8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#172033;">
    <div style="padding:24px;">
      <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #ead8c2;border-radius:12px;overflow:hidden;">
        <div style="background:#fff7ed;border-bottom:1px solid #ead8c2;padding:18px 20px;">
          <div style="font-size:12px;letter-spacing:.12em;font-weight:800;color:#b45309;">SUIYUE HRIS</div>
          <h1 style="margin:8px 0 0;font-size:20px;line-height:1.35;color:#172033;">${escapeHtml(title)}</h1>
        </div>
        <div style="padding:20px;">
          <p style="margin:0 0 14px;font-size:15px;">${escapeHtml(recipientName)}，您好：</p>
          <p style="margin:0 0 18px;font-size:14px;line-height:1.75;color:#334155;white-space:pre-line;">${escapeHtml(content)}</p>
          <div style="margin:18px 0;padding:12px;border-radius:10px;background:#fffaf4;border:1px solid #ead8c2;font-size:13px;color:#64748b;">
            來源模組：${escapeHtml(sourceModule)}
          </div>
          <a href="${actionUrl}" style="display:inline-block;background:#d97706;color:#fff;text-decoration:none;border-radius:8px;padding:10px 14px;font-size:14px;font-weight:800;">
            前往通知中心
          </a>
        </div>
        <div style="border-top:1px solid #ead8c2;padding:14px 20px;font-size:12px;line-height:1.6;color:#94a3b8;">
          此信由歲悅長照 HRIS 自動發送，請勿直接回覆。若您不應收到此通知，請聯絡人資或系統管理員。
        </div>
      </div>
    </div>
  </body>
</html>`;
}

function nextAttemptAt(attempts: number) {
  const minutes = retryBackoffMinutes[Math.min(attempts, retryBackoffMinutes.length - 1)] ?? 720;
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}

async function sendWithResend(input: {
  apiKey: string;
  from: string;
  replyTo?: string;
  to: string;
  subject: string;
  html: string;
}) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: input.from,
      to: [input.to],
      subject: input.subject,
      html: input.html,
      reply_to: input.replyTo ? [input.replyTo] : undefined,
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof payload?.message === "string" ? payload.message : `Resend HTTP ${response.status}`;
    throw new Error(message);
  }

  return String(payload?.id ?? "");
}

export async function processNotificationEmailQueue(): Promise<WorkerResult> {
  const supabase = getSupabaseAdminClient();
  const config = getWorkerConfig();
  const result: WorkerResult = { ok: true, processed: 0, sent: 0, failed: 0, skipped: 0, configMissing: false, errors: [] };

  if (!supabase) {
    return {
      ok: false,
      processed: 0,
      sent: 0,
      failed: 0,
      skipped: 0,
      configMissing: true,
      errors: ["SUPABASE_SERVICE_ROLE_KEY 或 NEXT_PUBLIC_SUPABASE_URL 尚未設定。"],
    };
  }

  const queryClient = supabase as unknown as WorkerSupabaseClient;
  const { data, error } = await queryClient
    .from("notification_email_deliveries")
    .select(`
      id,
      company_id,
      notification_id,
      event_id,
      recipient_user_id,
      recipient_email,
      subject,
      attempts,
      metadata,
      notifications(title, content, source_module, action_url, metadata),
      users(display_name, email)
    `)
    .in("status", ["queued", "failed", "config_missing"])
    .lte("next_attempt_at", new Date().toISOString())
    .is("deleted_at", null)
    .order("created_at", { ascending: true })
    .limit(Number.isFinite(config.batchSize) && config.batchSize > 0 ? config.batchSize : defaultBatchSize);

  if (error) {
    return { ...result, ok: false, errors: [error.message] };
  }

  const deliveries = ((data ?? []) as DeliveryRow[]).map((row) => ({
    ...row,
    notifications: Array.isArray(row.notifications) ? row.notifications[0] ?? null : row.notifications,
    users: Array.isArray(row.users) ? row.users[0] ?? null : row.users,
  }));

  for (const delivery of deliveries) {
    result.processed += 1;
    const recipientEmail = delivery.recipient_email || delivery.users?.email;
    const nextAttempts = Number(delivery.attempts ?? 0) + 1;

    if (!recipientEmail) {
      result.skipped += 1;
      await markDelivery(supabase, delivery, {
        status: "skipped",
        attempts: nextAttempts,
        errorMessage: "收件人沒有 Email。",
      });
      continue;
    }

    if (!config.resendApiKey) {
      result.configMissing = true;
      result.failed += 1;
      await markDelivery(supabase, delivery, {
        status: "config_missing",
        attempts: nextAttempts,
        errorMessage: "RESEND_API_KEY 尚未設定。",
      });
      continue;
    }

    await queryClient
      .from("notification_email_deliveries")
      .update({ status: "sending", last_attempt_at: new Date().toISOString(), attempts: nextAttempts, updated_at: new Date().toISOString() })
      .eq("id", delivery.id);

    try {
      const providerMessageId = await sendWithResend({
        apiKey: config.resendApiKey,
        from: config.from,
        replyTo: config.replyTo,
        to: recipientEmail,
        subject: delivery.subject,
        html: buildEmailHtml(delivery, config.appUrl),
      });
      result.sent += 1;
      await markDelivery(supabase, delivery, {
        status: "sent",
        attempts: nextAttempts,
        providerMessageId,
        recipientEmail,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Email provider failed.";
      result.failed += 1;
      result.errors.push(`${delivery.id}: ${message}`);
      await markDelivery(supabase, delivery, {
        status: "failed",
        attempts: nextAttempts,
        errorMessage: message,
        nextAttemptAt: nextAttemptAt(nextAttempts),
        recipientEmail,
      });
    }
  }

  return result;
}

async function markDelivery(
  supabase: ReturnType<typeof getSupabaseAdminClient>,
  delivery: DeliveryRow,
  input: {
    status: "sent" | "failed" | "skipped" | "config_missing";
    attempts: number;
    providerMessageId?: string;
    errorMessage?: string;
    nextAttemptAt?: string;
    recipientEmail?: string;
  },
) {
  if (!supabase) return;
  const queryClient = supabase as unknown as WorkerSupabaseClient;
  const now = new Date().toISOString();
  const emailStatus = input.status === "sent" ? "sent" : input.status === "skipped" ? "skipped" : input.status === "config_missing" ? "config_missing" : "failed";
  const metadata = {
    ...(delivery.metadata ?? {}),
    last_worker_run_at: now,
    email_status: emailStatus,
  };

  await queryClient
    .from("notification_email_deliveries")
    .update({
      status: input.status,
      attempts: input.attempts,
      recipient_email: input.recipientEmail ?? delivery.recipient_email,
      provider_message_id: input.providerMessageId ?? null,
      error_message: input.errorMessage ?? null,
      next_attempt_at: input.status === "failed" || input.status === "config_missing" ? input.nextAttemptAt ?? nextAttemptAt(input.attempts) : now,
      last_attempt_at: now,
      sent_at: input.status === "sent" ? now : null,
      metadata,
      updated_at: now,
    })
    .eq("id", delivery.id);

  await queryClient
    .from("notifications")
    .update({
      status: input.status === "sent" ? "delivered" : input.status === "failed" || input.status === "config_missing" ? "failed" : "unread",
      email_last_attempt_at: now,
      email_sent_at: input.status === "sent" ? now : null,
      email_provider_message_id: input.providerMessageId ?? null,
      email_error_message: input.errorMessage ?? null,
      metadata: {
        ...(delivery.notifications?.metadata ?? {}),
        email_status: emailStatus,
        email_attempts: input.attempts,
        email_last_attempt_at: now,
        email_provider_message_id: input.providerMessageId ?? null,
        email_error_message: input.errorMessage ?? null,
      },
      updated_at: now,
    })
    .eq("id", delivery.notification_id);
}
