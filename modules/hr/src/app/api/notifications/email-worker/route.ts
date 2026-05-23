import type { NextRequest } from "next/server";
import { jsonApiResponse, requireCronRequest, withCronOrApiPermission } from "@/lib/auth/api-guard";
import { processNotificationEmailQueue } from "@/lib/notifications/email-worker";
import { writeAuditLog, writeErrorLog } from "@/lib/security/audit";

export const dynamic = "force-dynamic";

async function runWorker(request: NextRequest, source: "cron" | "manual") {
  const result = await processNotificationEmailQueue();

  if (!result.ok) {
    await writeErrorLog(request, {
      source: source === "cron" ? "cron" : "api",
      severity: result.configMissing ? "warning" : "error",
      message: "Notification Email worker failed.",
      metadata: result,
    });
    return jsonApiResponse(result, { status: result.configMissing ? 503 : 500 });
  }

  await writeAuditLog(request, {
    action: "notification.email_worker.run",
    resourceType: "notification_email_deliveries",
    metadata: { ...result, source },
  });

  return jsonApiResponse(result);
}

export async function GET(request: NextRequest) {
  const cronGuard = await requireCronRequest(request);
  if (!cronGuard.ok) return cronGuard.response;

  return runWorker(request, "cron");
}

export async function POST(request: NextRequest) {
  return withCronOrApiPermission(request, "notification:send", async ({ source, user }) => {
    const response = await runWorker(request, source === "cron" ? "cron" : "manual");
    if (user) {
      await writeAuditLog(request, {
        companyId: user.companyId,
        actorUserId: user.userId,
        actorEmployeeId: user.employeeId,
        action: "notification.email_worker.manual_run",
        resourceType: "notification_email_deliveries",
      });
    }
    return response;
  });
}
