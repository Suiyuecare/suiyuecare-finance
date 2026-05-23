import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

const checks = [
  {
    name: "通知事件必須寫入 notification_events",
    file: "src/lib/notifications/notification-events.ts",
    patterns: [".from(\"notification_events\")", "recipient_strategy", "recipient_user_ids", "notification.event.processed"],
  },
  {
    name: "站內通知必須寫入 notifications 並保留 Email 狀態",
    file: "src/lib/notifications/notification-events.ts",
    patterns: [".from(\"notifications\").insert", "email_status", "event_id"],
  },
  {
    name: "Email 必須有 server-side delivery queue",
    file: "supabase/migrations/20260522154810_notification_email_worker.sql",
    patterns: ["create table if not exists public.notification_email_deliveries", "enqueue_notification_email_delivery", "trg_notifications_enqueue_email_delivery"],
  },
  {
    name: "Email worker 必須支援寄送、失敗、設定缺漏與重試",
    file: "src/lib/notifications/email-worker.ts",
    patterns: ["processNotificationEmailQueue", "sendWithResend", "config_missing", "nextAttemptAt", "email_error_message"],
  },
  {
    name: "通知 API 必須檢查權限或 cron secret",
    file: "src/app/api/notifications/email-worker/route.ts",
    patterns: ["requireCronRequest", "withCronOrApiPermission", "notification:send"],
  },
  {
    name: "通知頁必須顯示正式營運狀態與佇列",
    file: "src/app/(app)/notifications/page.tsx",
    patterns: ["正式通知營運狀態", "Email 佇列與失敗追蹤", "deliveryStats", "notification_email_deliveries"],
  },
  {
    name: "通知頁必須提供失敗重送與 worker 執行",
    file: "src/app/(app)/notifications/page.tsx",
    patterns: ["retryEmail", "runEmailWorker", "立即處理佇列", "重送失敗"],
  },
  {
    name: "通知必須寫入稽核紀錄",
    file: "src/app/(app)/notifications/page.tsx",
    patterns: ["notification.send", "notification.mark_read", "notification.retry_email", "notification.rules.update"],
  },
];

let failed = 0;

for (const check of checks) {
  const content = readFileSync(join(root, check.file), "utf8");
  const missing = check.patterns.filter((pattern) => !content.includes(pattern));
  if (missing.length) {
    failed += 1;
    console.error(`FAIL ${check.name}`);
    console.error(`  file: ${check.file}`);
    console.error(`  missing: ${missing.join(", ")}`);
  } else {
    console.log(`PASS ${check.name}`);
  }
}

if (failed) {
  console.error(`\n${failed} notification system checks failed.`);
  process.exit(1);
}

console.log(`\nAll ${checks.length} notification system checks passed.`);
