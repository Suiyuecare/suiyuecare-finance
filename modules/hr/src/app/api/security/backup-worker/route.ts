import type { NextRequest } from "next/server";
import { jsonApiResponse, requireCronRequest, withCronOrApiPermission } from "@/lib/auth/api-guard";
import { processBackupAutomation } from "@/lib/security/backup-worker";
import { writeAuditLog, writeErrorLog } from "@/lib/security/audit";

export const dynamic = "force-dynamic";

async function runBackupWorker(request: NextRequest, source: "cron" | "manual") {
  try {
    const result = await processBackupAutomation();

    if (!result.ok) {
      await writeErrorLog(request, {
        source: source === "cron" ? "cron" : "api",
        severity: result.configMissing ? "warning" : "error",
        message: "Backup automation worker did not complete successfully.",
        metadata: { ...result, source },
      });
      return jsonApiResponse(result, { status: result.configMissing ? 503 : 500 });
    }

    await writeAuditLog(request, {
      action: "security.backup_worker.run",
      resourceType: "backup_restore_runs",
      metadata: { ...result, source },
    });

    return jsonApiResponse(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Backup automation worker failed.";
    await writeErrorLog(request, {
      source: source === "cron" ? "cron" : "api",
      severity: "error",
      message,
      metadata: { source },
    });
    return jsonApiResponse({ ok: false, error: message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const cronGuard = await requireCronRequest(request);
  if (!cronGuard.ok) return cronGuard.response;

  return runBackupWorker(request, "cron");
}

export async function POST(request: NextRequest) {
  return withCronOrApiPermission(request, "system:settings", async ({ source, user }) => {
    const response = await runBackupWorker(request, source === "cron" ? "cron" : "manual");
    if (user) {
      await writeAuditLog(request, {
        companyId: user.companyId,
        actorUserId: user.userId,
        actorEmployeeId: user.employeeId,
        action: "security.backup_worker.manual_run",
        resourceType: "backup_restore_runs",
      });
    }
    return response;
  });
}
