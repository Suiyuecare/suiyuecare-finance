import type { NextRequest } from "next/server";
import { jsonApiResponse, requireCronRequest, withApiPermission } from "@/lib/auth/api-guard";
import { runBackgroundScheduler } from "@/lib/background/scheduler";
import { writeAuditLog, writeErrorLog } from "@/lib/security/audit";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const cronGuard = await requireCronRequest(request);
  if (!cronGuard.ok) return cronGuard.response;

  const result = await runBackgroundScheduler();
  if (!result.ok) {
    await writeErrorLog(request, {
      source: "cron",
      severity: "error",
      message: "Background scheduler completed with errors.",
      metadata: result,
    });
    return jsonApiResponse(result, { status: 500 });
  }

  await writeAuditLog(request, {
    action: "background.scheduler.run",
    resourceType: "background_job_runs",
    metadata: result,
  });
  return jsonApiResponse(result);
}

export async function POST(request: NextRequest) {
  return withApiPermission(request, "system:settings", async ({ user }) => {
    const result = await runBackgroundScheduler({ force: true });
    if (!result.ok) {
      await writeErrorLog(request, {
        companyId: user?.companyId,
        userId: user?.userId,
        employeeId: user?.employeeId,
        source: "api",
        severity: "error",
        message: "Manual background scheduler run completed with errors.",
        metadata: result,
      });
      return jsonApiResponse(result, { status: 500 });
    }

    await writeAuditLog(request, {
      companyId: user?.companyId,
      actorUserId: user?.userId,
      actorEmployeeId: user?.employeeId,
      action: "background.scheduler.manual_run",
      resourceType: "background_job_runs",
      metadata: result,
    });

    return jsonApiResponse(result);
  });
}
