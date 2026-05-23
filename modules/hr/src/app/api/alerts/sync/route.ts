import type { NextRequest } from "next/server";
import { jsonApiResponse, withCronOrApiPermission } from "@/lib/auth/api-guard";
import { syncAlertCenter } from "@/lib/alerts/alert-center";
import { writeAuditLog, writeErrorLog } from "@/lib/security/audit";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return withCronOrApiPermission(request, "compliance:manage", async ({ source, user }) => {
    const result = await syncAlertCenter();

    if (!result.ok) {
      await writeErrorLog(request, {
        companyId: user?.companyId,
        userId: user?.userId,
        employeeId: user?.employeeId,
        severity: "error",
        source: source === "cron" ? "cron" : "api",
        message: "Alert center sync completed with errors.",
        metadata: result,
      });
      return jsonApiResponse(result, { status: 500 });
    }

    await writeAuditLog(request, {
      companyId: user?.companyId,
      actorUserId: user?.userId,
      actorEmployeeId: user?.employeeId,
      action: source === "cron" ? "alert_center.sync.cron" : "alert_center.sync.manual",
      resourceType: "alert_center_items",
      metadata: result,
    });

    return jsonApiResponse(result);
  });
}

export async function POST(request: NextRequest) {
  return GET(request);
}
