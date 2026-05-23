import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

const checks = [
  {
    name: "上線營運中心頁面存在並集中讀取營運資料",
    file: "src/app/(app)/operations/page.tsx",
    patterns: ["上線營運中心", "background_job_runs", "backup_restore_runs", "notification_email_deliveries", "error_logs"],
  },
  {
    name: "營運中心提供正式快捷操作",
    file: "src/app/(app)/operations/page.tsx",
    patterns: ["/api/background/scheduler", "/api/alerts/sync", "/api/notifications/email-worker", "/api/security/backup-worker"],
  },
  {
    name: "營運中心具有上線檢核與阻擋摘要",
    file: "src/app/(app)/operations/page.tsx",
    patterns: ["上線前營運檢核", "上線阻擋", "summary.blockers", "正式營運提醒"],
  },
  {
    name: "背景排程 API 有權限與 cron 保護",
    file: "src/app/api/background/scheduler/route.ts",
    patterns: ["requireCronRequest", "withApiPermission", "system:settings", "background.scheduler.manual_run"],
  },
  {
    name: "背景排程涵蓋通知、備份與告警",
    file: "src/lib/background/scheduler.ts",
    patterns: ["notification_email_queue", "backup_health_check", "alert_center_sync", "background_job_runs"],
  },
  {
    name: "側邊導覽有上線營運中心入口",
    file: "src/lib/config/navigation.ts",
    patterns: ["上線營運中心", "/operations", "ServerCog"],
  },
  {
    name: "路由權限限制為系統設定權限",
    file: "src/lib/auth/route-permissions.ts",
    patterns: ["/operations", "system:settings"],
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
  console.error(`\n${failed} operations center checks failed.`);
  process.exit(1);
}

console.log(`\nAll ${checks.length} operations center checks passed.`);
